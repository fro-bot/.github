import type {
  DataBranchChecker,
  GitDiffRunner,
  MainReposYamlReader,
  PrApiResolver,
  ReposYamlReader,
  ResolverFactory,
  WorkflowRunReader,
} from './check-private-leak.ts'
import type {NodeIdResolver} from './private-repo-resolution.ts'
import {Buffer} from 'node:buffer'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {
  assertCompareNotTruncated,
  checkPrivateLeak,
  isGh404Error,
  largeOutputMaxBufferBytes,
  main,
  runPromotionCli,
  runPromotionScan,
} from './check-private-leak.ts'

// ---------------------------------------------------------------------------
// Module-level hoisted mocks — shared across all describe blocks.
// ---------------------------------------------------------------------------

const {mockExecFileSync} = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

const {mockReadFile} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}))

vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {...real, readFile: mockReadFile}
})

const {mockAppendFileSync, mockReadFileSync} = vi.hoisted(() => ({
  mockAppendFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}))

vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {...real, appendFileSync: mockAppendFileSync, readFileSync: mockReadFileSync}
})

// ---------------------------------------------------------------------------
// Pure function: checkPrivateLeak
// ---------------------------------------------------------------------------

/**
 * Build a minimal compare JSON response (as returned by the GitHub compare API without
 * a diff media type). Used to mock the truncation-check call in fetchDiffForSha.
 * Returns a well-formed response with one file entry that has a patch field.
 */
function makeCompareJson(filePath = 'docs/public.md'): string {
  return JSON.stringify({
    total_commits: 1,
    files: [{filename: filePath, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'}],
  })
}

/**
 * Build a minimal unified diff with added lines. Each line in `additions` appears
 * as a `+` line under a synthetic file header so file-path tracking works.
 */
function makeDiff(filePath: string, additions: string[]): string {
  const lines = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1,0 +1 @@',
    ...additions.map(l => `+${l}`),
  ]
  return lines.join('\n')
}

describe('largeOutputMaxBufferBytes() — exact value', () => {
  it('is exactly 32 MiB (32 * 1024 * 1024), not a mis-multiplied/mis-divided value', () => {
    // Direct value assertion, not indirected through a call site: this discriminates every
    // ArithmeticOperator variant on `32 * 1024 * 1024` (both `*`->`/` swaps) in one place,
    // regardless of which downstream execFileSync call the mutation report happens to attribute
    // the mutant to. Computed inside a function (not a top-level const) so Stryker can scope
    // per-test coverage — a top-level arithmetic initializer is a "static" mutant, unkillable by
    // any test regardless of assertion strength.
    expect(largeOutputMaxBufferBytes()).toBe(33_554_432)
  })
})

describe('checkPrivateLeak — pure function', () => {
  const override = {titlePrefixed: false, isOperator: false}

  // Scenario 1: no private names in diff → pass
  it('passes when there are no private names to scan against', () => {
    // #given a diff that contains arbitrary text but no private name list
    const diff = makeDiff('knowledge/wiki/topics/rust.md', ['Some content about Rust.'])
    // #when evaluated against an empty private name list
    const result = checkPrivateLeak([], diff, override)
    // #then the check passes
    expect(result).toEqual({ok: true})
  })

  // Scenario 2: diff introduces a private owner/name in a wiki page → fail
  it('fails when a private name appears in an added line of a wiki file', () => {
    // #given a private name and a diff that adds a line containing it
    const diff = makeDiff('knowledge/wiki/repos/testowner--private-fixture.md', [
      'See also testowner/private-fixture for details.',
    ])
    // #when evaluated against that private name
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the check fails and reports the FILE path, not the name
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/testowner--private-fixture.md']})
  })

  // Scenario 3: redaction PR (only removes canonical names) → pass
  it('passes when the private name only appears on removed lines (redaction PR)', () => {
    // #given a diff that only removes a line containing the private name
    const diff = [
      'diff --git a/knowledge/wiki/topics/rust.md b/knowledge/wiki/topics/rust.md',
      '--- a/knowledge/wiki/topics/rust.md',
      '+++ b/knowledge/wiki/topics/rust.md',
      '@@ -1 +1,0 @@',
      '-See also testowner/private-fixture for details.',
    ].join('\n')
    // #when evaluated against that private name
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the check passes — only added lines are scanned
    expect(result).toEqual({ok: true})
  })

  // Scenario 4: empty diff → pass
  it('passes when the diff is empty', () => {
    const result = checkPrivateLeak(['testowner/private-fixture'], '', override)
    expect(result).toEqual({ok: true})
  })

  // Scenario 5: diff includes a private node_id (not the name) → pass
  it('passes when only a node_id appears in the diff (not the resolved name)', () => {
    // #given a diff that adds the raw node_id (not the owner/name)
    const diff = makeDiff('docs/some-doc.md', ['Repository node_id: R_kgDOABCDEFG'])
    // #when evaluated against the private NAME (not the node_id)
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the check passes — only the name is scanned, not node_ids
    expect(result).toEqual({ok: true})
  })

  // Scenario 6: data repos.yaml has no private entries → pass regardless of diff
  it('passes when the private name list is empty even if diff is non-trivial', () => {
    // #given a diff that adds some content
    const diff = makeDiff('scripts/foo.ts', ['export const x = 1'])
    // #when no private names are provided
    const result = checkPrivateLeak([], diff, override)
    // #then the check passes regardless
    expect(result).toEqual({ok: true})
  })

  // Scenario 7: case sensitivity: diff has TESTOWNER/PRIVATE-FIXTURE → fail
  it('fails on case-insensitive match (UPPERCASED name in diff)', () => {
    // #given a private name in lowercase and the diff adds it in uppercase
    const diff = makeDiff('knowledge/wiki/repos/test.md', ['Check TESTOWNER/PRIVATE-FIXTURE out'])
    // #when evaluated case-insensitively
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the check fails
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/test.md']})
  })

  // Scenario 8: flip private:true→false in metadata AND introduce canonical name elsewhere → fail
  it('fails when name is added in one file even if another file removes private:true', () => {
    // #given two file hunks in one diff: metadata change (remove private) + wiki addition (adds name)
    const diff = [
      'diff --git a/metadata/repos.yaml b/metadata/repos.yaml',
      '--- a/metadata/repos.yaml',
      '+++ b/metadata/repos.yaml',
      '@@ -5 +5 @@',
      '-  private: true',
      '+  private: false',
      'diff --git a/knowledge/wiki/topics/rust.md b/knowledge/wiki/topics/rust.md',
      '--- a/knowledge/wiki/topics/rust.md',
      '+++ b/knowledge/wiki/topics/rust.md',
      '@@ -1,0 +1 @@',
      '+See testowner/private-fixture for more.',
    ].join('\n')
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the name addition triggers a fail
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/rust.md']})
  })

  // Scenario 9: override: title [allow-private-leak]... + author marcusrbrown → pass with logged warning
  it('honors override when title is prefixed and author is the operator', () => {
    // #given a diff with a private name added
    const diff = makeDiff('knowledge/wiki/repos/test.md', ['See testowner/private-fixture'])
    // #when override is active (title prefixed + operator)
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, {titlePrefixed: true, isOperator: true})
    // #then the check passes despite the match
    expect(result).toEqual({ok: true})
  })

  // Scenario 10: override: title prefixed but author fro-bot[bot] → NOT honored, fails normally
  it('does NOT honor override when title is prefixed but author is not the operator', () => {
    // #given a diff with a private name added
    const diff = makeDiff('knowledge/wiki/repos/test.md', ['See testowner/private-fixture'])
    // #when title is prefixed but author is not the operator
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, {titlePrefixed: true, isOperator: false})
    // #then the check fails normally
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/test.md']})
  })

  // Scenario 11: comment containing a private name added → fail
  it('fails when a code comment in an added line contains the private name', () => {
    // #given a diff adding a TS comment with the private name
    const diff = makeDiff('scripts/foo.ts', ['// TODO: remove testowner/private-fixture reference'])
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the check fails — substring match doesn't care about comment vs code
    expect(result).toEqual({ok: false, matchedFiles: ['scripts/foo.ts']})
  })

  // Extra: +++ header lines are NOT treated as added content
  it('does not match on the +++ diff header line', () => {
    // #given a diff where the file path itself contains a private name (edge case)
    const diff = [
      'diff --git a/knowledge/wiki/repos/testowner--private-fixture.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      '--- a/knowledge/wiki/repos/testowner--private-fixture.md',
      '+++ b/knowledge/wiki/repos/testowner--private-fixture.md',
      '@@ -1 +1 @@',
      '+Some unrelated content',
    ].join('\n')
    // #when evaluating against a name not present in the added content
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    // #then the check passes — +++ header is skipped, body line has no match
    expect(result).toEqual({ok: true})
  })

  // Extra: multiple files, only one matches — matchedFiles lists only the matching file
  it('lists only the files with matching added lines, not all files in the diff', () => {
    // #given a multi-file diff where only the second file has the private name
    const diff = [
      'diff --git a/scripts/foo.ts b/scripts/foo.ts',
      '--- a/scripts/foo.ts',
      '+++ b/scripts/foo.ts',
      '@@ -1,0 +1 @@',
      '+export const x = 1',
      'diff --git a/knowledge/wiki/topics/rust.md b/knowledge/wiki/topics/rust.md',
      '--- a/knowledge/wiki/topics/rust.md',
      '+++ b/knowledge/wiki/topics/rust.md',
      '@@ -1,0 +1 @@',
      '+See testowner/private-fixture for more.',
    ].join('\n')
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/rust.md']})
  })
})

// ---------------------------------------------------------------------------
// FIX #2 (prev round): path-based leak detection (new files)
// ---------------------------------------------------------------------------

describe('checkPrivateLeak — path-based detection (new files)', () => {
  const override = {titlePrefixed: false, isOperator: false}

  it('FAILS when a new file is added with a slug-named path (--- /dev/null)', () => {
    // #given a new file being added whose path contains the slug form of a private repo
    const diff = [
      'diff --git a/knowledge/wiki/repos/testowner--private-fixture.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/knowledge/wiki/repos/testowner--private-fixture.md',
      '@@ -0,0 +1 @@',
      '+Some unrelated content',
    ].join('\n')
    // #when evaluated with the slug token in privateNames
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    // #then the path itself is the leak — check fails
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/testowner--private-fixture.md']})
  })

  it('FAILS when added content line contains the slug form (owner--slug)', () => {
    // #given a diff adding content that contains the wiki slug token
    const diff = [
      'diff --git a/knowledge/wiki/topics/rust.md b/knowledge/wiki/topics/rust.md',
      '--- a/knowledge/wiki/topics/rust.md',
      '+++ b/knowledge/wiki/topics/rust.md',
      '@@ -1,0 +1 @@',
      '+See testowner--private-fixture for details.',
    ].join('\n')
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/rust.md']})
  })

  it('passes when a file with a slug-named path is DELETED (not added)', () => {
    // #given a deletion diff for a slug-named wiki page
    const diff = [
      'diff --git a/knowledge/wiki/repos/testowner--private-fixture.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      'deleted file mode 100644',
      '--- a/knowledge/wiki/repos/testowner--private-fixture.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-old content',
    ].join('\n')
    // #when evaluated with the slug token — deletion does not add disclosure
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    expect(result).toEqual({ok: true})
  })

  it('passes when a slug-named file is MODIFIED (not new) — path not flagged', () => {
    // #given a modification diff for a slug-named wiki page (already existed)
    const diff = [
      'diff --git a/knowledge/wiki/repos/testowner--private-fixture.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      '--- a/knowledge/wiki/repos/testowner--private-fixture.md',
      '+++ b/knowledge/wiki/repos/testowner--private-fixture.md',
      '@@ -1 +1 @@',
      '-old line',
      '+new unrelated content',
    ].join('\n')
    // #when the slug token is not in the added content, check passes
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    expect(result).toEqual({ok: true})
  })

  it('FAILS when canonical owner/name appears in added content (existing behavior preserved)', () => {
    // #given the canonical name in content
    const diff = [
      'diff --git a/knowledge/wiki/topics/rust.md b/knowledge/wiki/topics/rust.md',
      '--- a/knowledge/wiki/topics/rust.md',
      '+++ b/knowledge/wiki/topics/rust.md',
      '@@ -1,0 +1 @@',
      '+See testowner/private-fixture for more.',
    ].join('\n')
    const result = checkPrivateLeak(['testowner/private-fixture'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/rust.md']})
  })
})

// ---------------------------------------------------------------------------
// Round-3 FIX #1 — rename/copy path detection
// ---------------------------------------------------------------------------

describe('checkPrivateLeak — rename/copy path detection (Round-3 FIX #1)', () => {
  const override = {titlePrefixed: false, isOperator: false}

  it('FAILS when a file is renamed to a private-slug path via `rename to` header', () => {
    // #given a rename diff where the destination path contains the private slug
    const diff = [
      'diff --git a/knowledge/wiki/repos/old-public.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      'similarity index 100%',
      'rename from knowledge/wiki/repos/old-public.md',
      'rename to knowledge/wiki/repos/testowner--private-fixture.md',
    ].join('\n')
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    // #then the destination path is the leak surface
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/testowner--private-fixture.md']})
  })

  it('FAILS when a file is copied to a private-slug path via `copy to` header', () => {
    // #given a copy diff where the destination path contains the private slug
    const diff = [
      'diff --git a/knowledge/wiki/repos/template.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      'similarity index 100%',
      'copy from knowledge/wiki/repos/template.md',
      'copy to knowledge/wiki/repos/testowner--private-fixture.md',
    ].join('\n')
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/testowner--private-fixture.md']})
  })

  it('FAILS on rename-with-edits diff (has --- and +++ headers) to a private-slug path', () => {
    // #given a rename diff that also has content edits (produces ---/+++ headers)
    const diff = [
      'diff --git a/knowledge/wiki/repos/old-name.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      'similarity index 60%',
      'rename from knowledge/wiki/repos/old-name.md',
      'rename to knowledge/wiki/repos/testowner--private-fixture.md',
      '--- a/knowledge/wiki/repos/old-name.md',
      '+++ b/knowledge/wiki/repos/testowner--private-fixture.md',
      '@@ -1 +1 @@',
      '-old content',
      '+updated content',
    ].join('\n')
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/testowner--private-fixture.md']})
  })

  it('PASSES when a file is renamed to a non-private path', () => {
    // #given a rename to a path that does not contain any private token
    const diff = [
      'diff --git a/docs/old.md b/docs/new-public-name.md',
      'similarity index 100%',
      'rename from docs/old.md',
      'rename to docs/new-public-name.md',
    ].join('\n')
    const result = checkPrivateLeak(['testowner--private-fixture', 'testowner/private-fixture'], diff, override)
    expect(result).toEqual({ok: true})
  })

  it('FAILS via diff --git header when a/X b/Y differ and b-path has slug (no-content rename, no --- headers)', () => {
    // #given only the diff --git header with differing paths and no ---/+++ lines
    // (rename without content change in some git configs; `rename to` is still present)
    const diff = [
      'diff --git a/knowledge/wiki/repos/old.md b/knowledge/wiki/repos/testowner--private-fixture.md',
      'similarity index 100%',
      'rename from knowledge/wiki/repos/old.md',
      'rename to knowledge/wiki/repos/testowner--private-fixture.md',
    ].join('\n')
    const result = checkPrivateLeak(['testowner--private-fixture'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/testowner--private-fixture.md']})
  })
})

// ---------------------------------------------------------------------------
// Round-3 FIX #2 — access-lost and error fail-closed
// Round-3 FIX #3 — stderr sanitization
// Round-3 FIX #4 — no bare-name false positives (pure function)
// ---------------------------------------------------------------------------

function makeYamlBase64(nodeIds: string[]): string {
  if (nodeIds.length === 0) {
    return Buffer.from('version: 1\nrepos: []\n').toString('base64')
  }
  const entries = nodeIds
    .map(
      (id, i) =>
        `  - owner: "[REDACTED]"\n    name: repo-${i}\n    private: true\n    node_id: ${id}\n    added: "2024-01-01"\n    onboarding_status: onboarded\n    last_survey_at: null\n    last_survey_status: null\n    has_fro_bot_workflow: false\n    has_renovate: false`,
    )
    .join('\n')
  return Buffer.from(`version: 1\nrepos:\n${entries}\n`).toString('base64')
}

describe('main() — fail-closed and no-name-leak (FIX #1, FIX #4)', () => {
  it('exits non-zero (fail-closed) when one node_id resolves and TWO fail — private name NOT in stderr, node_ids joined with ", " (StringLiteral on `.join`)', async () => {
    // #given: three private node_ids; one resolves, TWO fail (a single-failure fixture can't
    // discriminate `.join(', ')` from `.join('')` since both produce the same one-element output).
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix1-a'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix1-a'})})
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_ok', 'R_fail1', 'R_fail2'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // R_ok
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('gh failed'), {stderr: 'Bad credentials\n'})
      }) // R_fail1
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('gh failed'), {stderr: 'Bad credentials\n'})
      }) // R_fail2

    const stderrOutput: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    mockAppendFileSync.mockReset()
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')

      const stderrText = stderrOutput.join('')

      // #then: failing node_ids appear in stderr, joined with ', '
      expect(stderrText).toContain('R_fail1, R_fail2')
      expect(stderrText).toContain(
        'check-private-leak: cannot guarantee a complete scan — refusing to pass the PR without full resolution',
      )

      // #then: the resolved private name 'acme/private-repo' does NOT appear anywhere
      expect(stderrText).not.toContain('acme/private-repo')
      expect(stderrText).not.toContain('acme')
      expect(stderrText).not.toContain('private-repo')

      // #then: exit was called with 1 (fail-closed), exactly once (CallExpression on process.exit)
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(exitSpy).toHaveBeenCalledTimes(1)
      // #then: scan_result is the literal 'error', not an emptied StringLiteral mutant.
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=error\n')
      // #then: execution stopped AT this exit — exactly 5 execFileSync calls happened (repo view,
      // repos.yaml read, R_ok resolve, R_fail1, R_fail2). If `process.exit(1)` here were a no-op
      // (CallExpression mutant), execution would fall through to fetchDiffForSha's own
      // execFileSync call, producing a 6th call.
      expect(mockExecFileSync).toHaveBeenCalledTimes(5)
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockExecFileSync.mockReset()
      mockAppendFileSync.mockReset()
    }
  })

  it('exits non-zero when ALL node_ids fail to resolve and no override', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix1-b'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix1-b'})})
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_x'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        throw new Error('server error')
      }) // resolver R_x — fails

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('passes with bypass log when operator override is active and resolution fails, joining multiple failed node_ids with ", " (StringLiteral on `.join`)', async () => {
    // #given: operator override active + TWO node_ids fail (a single-element array can't
    // discriminate `.join(', ')` from `.join('')` since both produce the same one-element output).
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix1-c'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-fix1-c',
        title: '[allow-private-leak] my PR',
        author: 'marcusrbrown',
      }),
    })
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_y1', 'R_y2'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        throw new Error('outage')
      }) // resolver R_y1 — fails
      .mockImplementationOnce(() => {
        throw new Error('outage')
      }) // resolver R_y2 — fails
      .mockReturnValueOnce(makeCompareJson()) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce('') // fetchDiffForSha: raw diff → empty

    const stderrOutput: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver) // should NOT throw

      // #then: exit was NOT called
      expect(exitSpy).not.toHaveBeenCalled()

      // #then: bypass was logged with both node_ids joined by ', '
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('R_y1, R_y2')
      expect(stderrText).toContain('operator override active')
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// Round-3 FIX #2 — access-lost skip vs error fail-closed (CLI-level, PR path)
// ---------------------------------------------------------------------------

describe('main() — access-lost fail-closed (Round-3 FIX #2, updated for Finding A)', () => {
  it('fails closed (exit 1) when one resolves + one access-lost; access-lost node_id in stderr', async () => {
    // #given: two private node_ids — one resolves, one is access-lost (null node)
    // Finding A: access-lost is now fail-closed (same as error class) — not skipped.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix2-a'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix2-a'})})
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_resolved', 'R_gone'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/resolved-repo'}}})) // R_resolved → ok
      .mockReturnValueOnce(JSON.stringify({data: {node: null}})) // R_gone → access-lost

    const stderrOutput: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: access-lost → fail closed (process.exit(1))
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)

      const stderrText = stderrOutput.join('')
      // #then: access-lost node_id appears in stderr with BLOCKING message
      expect(stderrText).toContain('R_gone')
      expect(stderrText).toContain('BLOCKING')
      // #then: the resolved canonical name does NOT appear in stderr
      expect(stderrText).not.toContain('acme/resolved-repo')
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails-closed (exit 1) when one resolved + one error-class failure', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix2-b'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix2-b'})})
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_ok2', 'R_err'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/resolved-repo'}}})) // R_ok2 → ok
      .mockImplementationOnce(() => {
        throw new Error('network timeout')
      }) // R_err → error class

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails closed when ALL node_ids are access-lost (Finding A: cannot guarantee complete scan)', async () => {
    // #given: both private repos are access-lost (deleted/inaccessible or mis-scoped PAT)
    // Finding A: access-lost is indistinguishable from no-access/mis-scoped-token → fail closed.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix2-c'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix2-c'})})
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_gone1', 'R_gone2'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: null}})) // R_gone1 → access-lost
      .mockReturnValueOnce(JSON.stringify({data: {node: null}})) // R_gone2 → access-lost

    const stderrOutput: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: all access-lost → fail closed
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)

      const stderrText = stderrOutput.join('')
      // Both access-lost node_ids appear in stderr with BLOCKING message
      expect(stderrText).toContain('R_gone1')
      expect(stderrText).toContain('R_gone2')
      expect(stderrText).toContain('BLOCKING')
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// Round-3 FIX #3 — stderr never echoes raw gh output (sanitization)
// ---------------------------------------------------------------------------

describe('main() — stderr sanitization on error-class failure (Round-3 FIX #3)', () => {
  it('never echoes raw gh stderr containing owner/name on error-class resolution failure', async () => {
    // #given: one private node_id fails with a poisoned gh stderr body containing owner/name
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix3'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix3'})})
    mockExecFileSync.mockReset()

    // The gh error body contains a canonical owner/name — must NOT appear in logged output.
    const poisonedStderr = 'GraphQL error for someowner/private-repo: Not Found\n'
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_leak_test'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('gh failed'), {stderr: poisonedStderr})
      }) // R_leak_test → error class with poisoned stderr

    const stderrOutput: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')

      const stderrText = stderrOutput.join('')

      // #then: node_id and coarse error class appear in stderr
      expect(stderrText).toContain('R_leak_test')
      expect(stderrText).toContain('error')

      // #then: the raw poisoned stderr string NEVER appears
      expect(stderrText).not.toContain('someowner/private-repo')
      expect(stderrText).not.toContain(poisonedStderr)
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// Round-3 FIX #4 — no bare-name false positives (pure function level)
// ---------------------------------------------------------------------------

describe('checkPrivateLeak — no bare-name false positives (Round-3 FIX #4)', () => {
  const override = {titlePrefixed: false, isOperator: false}

  it('PASSES when diff contains only bare short name but not canonical or slug', () => {
    // #given: token list as built by main() WITHOUT bare name (only canonical + slug)
    // A diff that adds a line containing just "go" should NOT match acme/go or acme--go
    const diff = [
      'diff --git a/scripts/foo.ts b/scripts/foo.ts',
      '--- a/scripts/foo.ts',
      '+++ b/scripts/foo.ts',
      '@@ -1,0 +1 @@',
      '+// written in go',
    ].join('\n')
    const result = checkPrivateLeak(['acme/go', 'acme--go'], diff, override)
    expect(result).toEqual({ok: true})
  })

  it('FAILS when canonical `acme/go` appears in added content', () => {
    // #given the full canonical form in the diff
    const diff = [
      'diff --git a/docs/tech.md b/docs/tech.md',
      '--- a/docs/tech.md',
      '+++ b/docs/tech.md',
      '@@ -1,0 +1 @@',
      '+See acme/go for the private implementation.',
    ].join('\n')
    const result = checkPrivateLeak(['acme/go', 'acme--go'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['docs/tech.md']})
  })

  it('FAILS when wiki slug `acme--go` appears in added content', () => {
    // #given the slug form in the diff
    const diff = [
      'diff --git a/docs/tech.md b/docs/tech.md',
      '--- a/docs/tech.md',
      '+++ b/docs/tech.md',
      '@@ -1,0 +1 @@',
      '+See wiki page acme--go for details.',
    ].join('\n')
    const result = checkPrivateLeak(['acme/go', 'acme--go'], diff, override)
    expect(result).toEqual({ok: false, matchedFiles: ['docs/tech.md']})
  })
})

// ---------------------------------------------------------------------------
// runPromotionScan — promotion-mode entry path
// ---------------------------------------------------------------------------

/**
 * Build a minimal repos.yaml YAML string with the given private node_ids.
 */
function makeReposYaml(nodeIds: string[]): string {
  if (nodeIds.length === 0) {
    return 'version: 1\nrepos: []\n'
  }
  const entries = nodeIds
    .map(
      (id, i) =>
        `  - owner: "[REDACTED]"\n    name: repo-${i}\n    private: true\n    node_id: ${id}\n    added: "2024-01-01"\n    onboarding_status: onboarded\n    last_survey_at: null\n    last_survey_status: null\n    has_fro_bot_workflow: false\n    has_renovate: false`,
    )
    .join('\n')
  return `version: 1\nrepos:\n${entries}\n`
}

/**
 * Build a minimal repos.yaml with a private entry that has no node_id field.
 */
function makeReposYamlMissingNodeId(): string {
  return `version: 1
repos:
  - owner: "[REDACTED]"
    name: repo-no-id
    private: true
    added: "2024-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
}

/**
 * Build a minimal repos.yaml with two private entries: one with a node_id, one without.
 * Used to test that a missing node_id blocks even when other entries are valid.
 */
function makeReposYamlOneMissingOnePresent(): string {
  return `version: 1
repos:
  - owner: "[REDACTED]"
    name: repo-no-id
    private: true
    added: "2024-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
  - owner: "[REDACTED]"
    name: repo-with-id
    private: true
    node_id: R_valid
    added: "2024-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
}

/**
 * Build a minimal unified diff with added lines for promotion-scan tests.
 */
function makePromoDiff(filePath: string, additions: string[]): string {
  const lines = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1,0 +1 @@',
    ...additions.map(l => `+${l}`),
  ]
  return lines.join('\n')
}

describe('runPromotionScan — happy path: all resolve, no match → exit 0', () => {
  it('returns ok:true when all node_ids resolve and diff has no private token', async () => {
    // #given: one private node_id resolves; diff has no private name
    const reposYaml = makeReposYaml(['R_promo_1'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_promo_1') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('knowledge/wiki/topics/rust.md', ['Some content about Rust.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    expect(result).toEqual({ok: true})
  })

  it('does not flag a diff line containing literal "Stryker was here" text (ArrayDeclaration seed-pollution check on privateTokens)', async () => {
    // #given: a single resolved private name, and a diff whose added content happens to contain
    // the literal text Stryker's placeholder mutant would seed into `privateTokens: string[] = []`
    // ("Stryker was here"). If that array literal were mutated to `["Stryker was here"]`, the seed
    // token would survive into the scan (nothing removes it) and this diff line would wrongly match.
    const reposYaml = makeReposYaml(['R_promo_seed'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_promo_seed') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/changelog.md', ['Stryker was here during the mutation test run.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    expect(result).toEqual({ok: true})
  })
})

describe('runPromotionScan — happy path: diff contains private owner/name → block', () => {
  it('returns ok:false with matchedFiles when diff added line contains the private name', async () => {
    // #given: one private node_id resolves to acme/private-repo; diff adds that name in body
    const reposYaml = makeReposYaml(['R_promo_2'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_promo_2') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('knowledge/wiki/topics/rust.md', ['See acme/private-repo for details.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: blocked, file listed, no resolved name in matchedFiles (paths only)
    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/rust.md']})
    // Verify the result does NOT contain the resolved name itself (only file paths)
    if (!result.ok && 'matchedFiles' in result) {
      for (const file of result.matchedFiles) {
        expect(file).not.toContain('acme/private-repo')
      }
    }
  })
})

describe('runPromotionScan — edge: private token as new wiki page path → detected and redacted', () => {
  it('returns ok:false when a new wiki page path contains the owner--slug form; path is redacted', async () => {
    // #given: private repo resolves; diff adds a new file whose path is the slug form
    const reposYaml = makeReposYaml(['R_promo_3'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_promo_3') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    // New file added with slug path — the path itself is the leak surface
    const diff = [
      'diff --git a/knowledge/wiki/repos/acme--private-repo.md b/knowledge/wiki/repos/acme--private-repo.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/knowledge/wiki/repos/acme--private-repo.md',
      '@@ -0,0 +1 @@',
      '+Some unrelated content',
    ].join('\n')

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: blocked; the matched file path has the private token redacted
    expect(result.ok).toBe(false)
    if (!result.ok && 'matchedFiles' in result) {
      // The path must NOT contain the literal private token
      for (const file of result.matchedFiles) {
        expect(file).not.toContain('acme--private-repo')
        expect(file).not.toContain('acme/private-repo')
        // The redaction marker must be present
        expect(file).toContain('[REDACTED]')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Fix D — redaction: matched path containing a private token is redacted
// ---------------------------------------------------------------------------

describe('runPromotionScan — Fix D: matched path redaction', () => {
  it('redacts the private token from a matched file path in the returned result', async () => {
    // #given: private repo resolves; diff adds content to a file whose path contains the slug
    const reposYaml = makeReposYaml(['R_redact'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_redact') return {nameWithOwner: 'secretowner/secret-repo'}
      return {error: 'error'}
    }
    // The matched file path contains the slug form of the private repo
    const diff = makePromoDiff('knowledge/wiki/repos/secretowner--secret-repo.md', [
      'See secretowner/secret-repo for details.',
    ])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: blocked
    expect(result.ok).toBe(false)
    if (!result.ok && 'matchedFiles' in result) {
      const serialized = JSON.stringify(result)
      // The literal private tokens must NOT appear in the result
      expect(serialized).not.toContain('secretowner/secret-repo')
      expect(serialized).not.toContain('secretowner--secret-repo')
      expect(serialized).not.toContain('secretowner')
      // The redaction marker must be present
      expect(serialized).toContain('[REDACTED]')
    }
  })

  it('does not redact paths that do not contain a private token', async () => {
    // #given: private repo resolves; diff adds content to a public-named file
    const reposYaml = makeReposYaml(['R_no_redact'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_no_redact') return {nameWithOwner: 'secretowner/secret-repo'}
      return {error: 'error'}
    }
    // The matched file path does NOT contain the private token
    const diff = makePromoDiff('docs/public-doc.md', ['See secretowner/secret-repo for details.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: blocked; path is preserved (no token in path)
    expect(result.ok).toBe(false)
    if (!result.ok && 'matchedFiles' in result) {
      // The path itself is public — it should be preserved as-is
      expect(result.matchedFiles).toContain('docs/public-doc.md')
    }
  })
})

describe('runPromotionScan — error: non-access-lost failure → BLOCK (fail-closed)', () => {
  it('returns a resolution-failure result when a node_id returns a transient/auth error', async () => {
    // #given: one node_id fails with a non-access-lost error (transient/auth)
    const reposYaml = makeReposYaml(['R_promo_fail'])
    const resolver: NodeIdResolver = async () => ({error: 'error'})
    const diff = makePromoDiff('knowledge/wiki/topics/rust.md', ['Some content.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: fail-closed — resolution failure blocks promotion
    expect(result).toEqual({ok: false, resolutionFailed: true, failedNodeIds: ['R_promo_fail']})
  })

  it('does not leak the resolved name in the failure result', async () => {
    // #given: one resolves, one fails — the resolved name must not appear in the result
    const reposYaml = makeReposYaml(['R_ok', 'R_fail'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_ok') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    expect(result).toEqual({ok: false, resolutionFailed: true, failedNodeIds: ['R_fail']})
    // The resolved name must not appear anywhere in the result object
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('acme/private-repo')
    expect(serialized).not.toContain('acme')
  })
})

// ---------------------------------------------------------------------------
// Fix A — access-lost must BLOCK in promotion mode (not skip)
// ---------------------------------------------------------------------------

describe('runPromotionScan — Fix A: access-lost BLOCKS (fail-closed)', () => {
  it('BLOCKS when a node_id returns access-lost — includes it in failedNodeIds', async () => {
    // #given: one node_id returns access-lost
    // access-lost is indistinguishable between "deleted" and "no-access/mis-scoped-token".
    // A mis-scoped PAT makes every private repo look access-lost → must block, not skip.
    const reposYaml = makeReposYaml(['R_access_lost'])
    const resolver: NodeIdResolver = async () => ({error: 'access-lost'})
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: fail-closed — access-lost blocks promotion
    expect(result).toEqual({ok: false, resolutionFailed: true, failedNodeIds: ['R_access_lost']})
  })

  it('BLOCKS when one node_id is access-lost and one resolves successfully', async () => {
    // #given: one access-lost, one resolves; diff has no private name
    const reposYaml = makeReposYaml(['R_gone', 'R_present'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_gone') return {error: 'access-lost'}
      if (nodeId === 'R_present') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: access-lost blocks — R_gone is in failedNodeIds
    expect(result).toEqual({ok: false, resolutionFailed: true, failedNodeIds: ['R_gone']})
  })

  it('BLOCKS when ALL node_ids are access-lost', async () => {
    // #given: all private repos are access-lost
    const reposYaml = makeReposYaml(['R_gone1', 'R_gone2'])
    const resolver: NodeIdResolver = async () => ({error: 'access-lost'})
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: all access-lost → all in failedNodeIds
    expect(result).toEqual({ok: false, resolutionFailed: true, failedNodeIds: ['R_gone1', 'R_gone2']})
  })
})

// ---------------------------------------------------------------------------
// Fix B — missing/empty node_id on a private entry must BLOCK
// ---------------------------------------------------------------------------

describe('runPromotionScan — Fix B: missing/empty node_id BLOCKS', () => {
  it('BLOCKS when a private entry has no node_id field', async () => {
    // #given: repos.yaml with a private entry that has no node_id
    const reposYaml = makeReposYamlMissingNodeId()
    const resolver: NodeIdResolver = vi.fn()
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: fail-closed — missing node_id blocks promotion
    expect(result.ok).toBe(false)
    if (!result.ok && 'resolutionFailed' in result) {
      expect(result.resolutionFailed).toBe(true)
      // The sentinel placeholder must appear (never any owner/name)
      expect(result.failedNodeIds).toContain('<missing-node-id>')
      // The resolver must NOT have been called (no node_id to resolve)
      expect(resolver).not.toHaveBeenCalled()
    }
  })

  it('BLOCKS when mix of missing node_id and valid node_id — missing entry blocks regardless', async () => {
    // #given: one entry with missing node_id, one with a valid node_id that resolves
    // The schema allows node_id to be omitted (undefined) but not empty string.
    const reposYaml = makeReposYamlOneMissingOnePresent()
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_valid') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: blocked because of the missing node_id entry
    expect(result.ok).toBe(false)
    if (!result.ok && 'resolutionFailed' in result) {
      expect(result.resolutionFailed).toBe(true)
      expect(result.failedNodeIds).toContain('<missing-node-id>')
    }
  })

  it('never calls the resolver with `undefined` for a missing-node_id entry, and excludes it from the resolved count (ConditionalExpression on hasNonEmptyNodeId)', async () => {
    // #given: one entry with a missing node_id (undefined), one with a valid node_id. If
    // `hasNonEmptyNodeId`'s `r.node_id.length > 0` clause were forced to `true` in a way that also
    // bypassed the `typeof r.node_id === 'string'` guard, an `undefined` node_id would slip through
    // the filter and reach the resolver loop directly.
    const reposYaml = makeReposYamlOneMissingOnePresent()
    const calledWith: (string | undefined)[] = []
    const resolver: NodeIdResolver = async nodeId => {
      calledWith.push(nodeId)
      if (nodeId === 'R_valid') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    await runPromotionScan({reposYaml, resolver, diff})

    // #then: the resolver is called only for the valid node_id, never with `undefined`.
    expect(calledWith).toEqual(['R_valid'])
    expect(calledWith).not.toContain(undefined)
  })

  it('the sentinel placeholder never contains owner or name', async () => {
    // #given: private entry with no node_id
    const reposYaml = makeReposYamlMissingNodeId()
    const resolver: NodeIdResolver = vi.fn()
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    const serialized = JSON.stringify(result)
    // The sentinel must not contain any owner/name information
    expect(serialized).not.toContain('repo-no-id')
    expect(serialized).not.toContain('REDACTED"') // the owner field value
    // But the sentinel placeholder itself is present
    expect(serialized).toContain('<missing-node-id>')
  })
})

describe('runPromotionScan — edge: zero private entries → exit 0 (nothing to scan)', () => {
  it('returns ok:true immediately when repos.yaml has no private entries', async () => {
    // #given: repos.yaml with only public entries (no private: true)
    const reposYaml = `version: 1
repos:
  - owner: "publicowner"
    name: "public-repo"
    private: false
    added: "2024-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const resolverSpy = vi.fn<NodeIdResolver>()
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver: resolverSpy, diff})

    // #then: ok immediately, resolver never called
    expect(result).toEqual({ok: true})
    expect(resolverSpy).not.toHaveBeenCalled()
  })

  it('returns ok:true when repos.yaml has an empty repos array', async () => {
    const reposYaml = 'version: 1\nrepos: []\n'
    const resolverSpy = vi.fn<NodeIdResolver>()
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver: resolverSpy, diff})

    expect(result).toEqual({ok: true})
    expect(resolverSpy).not.toHaveBeenCalled()
  })
})

describe('runPromotionScan — integration: PAT passed only to resolver, diff needs no token', () => {
  it('passes the resolver as an injectable dependency (token wiring is caller responsibility)', async () => {
    // #given: a resolver spy that captures what it was called with
    const reposYaml = makeReposYaml(['R_token_test'])
    const capturedNodeIds: string[] = []
    const resolver: NodeIdResolver = async nodeId => {
      capturedNodeIds.push(nodeId)
      return {nameWithOwner: 'acme/private-repo'}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    await runPromotionScan({reposYaml, resolver, diff})

    // #then: resolver was called with the node_id from repos.yaml
    expect(capturedNodeIds).toEqual(['R_token_test'])
    // The diff is passed directly — no token involved in obtaining it (caller's responsibility)
    // This test verifies the seam: resolver is injectable, diff is injectable, no ambient token
  })

  it('the resolver receives each private node_id exactly once', async () => {
    // #given: two private node_ids
    const reposYaml = makeReposYaml(['R_a', 'R_b'])
    const calls: string[] = []
    const resolver: NodeIdResolver = async nodeId => {
      calls.push(nodeId)
      return {nameWithOwner: `acme/repo-${nodeId}`}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    await runPromotionScan({reposYaml, resolver, diff})

    expect(calls).toEqual(['R_a', 'R_b'])
  })
})

// ---------------------------------------------------------------------------
// Fix E — runPromotionCli: CLI-level tests via injectable seams
// ---------------------------------------------------------------------------

/**
 * Build a minimal repos.yaml string for CLI tests.
 */
function makeCliReposYaml(nodeIds: string[]): string {
  return makeReposYaml(nodeIds)
}

interface SeamOpts {
  nodeIds?: string[]
  resolverResult?: NodeIdResolver
  diffOutput?: string
  reposYamlContent?: string
  gitThrows?: Error
  reposYamlThrows?: Error
}

interface SeamResult {
  gitDiffRunner: GitDiffRunner
  reposYamlReader: ReposYamlReader
  resolverFactory: ResolverFactory
  capturedGitEnvs: NodeJS.ProcessEnv[]
}

/**
 * Build standard seam fakes for runPromotionCli tests.
 * Moved to outer scope to satisfy unicorn/consistent-function-scoping.
 */
function makeSeams(opts: SeamOpts = {}): SeamResult {
  const capturedGitEnvs: NodeJS.ProcessEnv[] = []

  const gitDiffRunner: GitDiffRunner = (_args, env) => {
    capturedGitEnvs.push({...env})
    if (opts.gitThrows !== undefined) throw opts.gitThrows
    return opts.diffOutput ?? ''
  }

  const reposYamlReader: ReposYamlReader = async () => {
    if (opts.reposYamlThrows !== undefined) throw opts.reposYamlThrows
    return opts.reposYamlContent ?? makeCliReposYaml(opts.nodeIds ?? [])
  }

  const resolverFactory: ResolverFactory = (_pat: string): NodeIdResolver =>
    opts.resolverResult ?? (async () => ({nameWithOwner: 'acme/private-repo'}))

  return {gitDiffRunner, reposYamlReader, resolverFactory, capturedGitEnvs}
}

describe('runPromotionScan — assertReposFile is actually called (CallExpression)', () => {
  it('rejects a well-formed-YAML, schema-invalid reposYaml with the schema-validation message, not a generic TypeError', async () => {
    // #given: reposYaml decodes to valid YAML but violates the ReposFile schema (`repos` is a
    // string, not an array). If `assertReposFile(parsed)` were removed (CallExpression mutant),
    // execution would fall through to `parsed.repos.filter(...)` and throw a DIFFERENT TypeError
    // ("parsed.repos.filter is not a function") instead of the real SchemaValidationError.
    const badYaml = 'version: 1\nrepos: not-an-array\n'
    const resolver: NodeIdResolver = async () => ({error: 'error'})
    await expect(runPromotionScan({reposYaml: badYaml, resolver, diff: ''})).rejects.toThrow(
      /repos\.repos.*expected array/,
    )
  })

  it('rejects an empty-string node_id at the schema layer before hasNonEmptyNodeId ever runs (pins the assertRepoEntry invariant hasNonEmptyNodeId depends on)', async () => {
    // #given: a private entry with `node_id: ""` (empty string, not omitted). `hasNonEmptyNodeId`'s
    // own body assumes assertRepoEntry (packages/wiki-write-core/src/schemas.ts:295-296) already
    // rejects this shape before any entry reaches its filter -- that assumption is load-bearing
    // (the tautological-length-check deletion in `hasNonEmptyNodeId` depends on it) but
    // `schemas.ts` itself is `not-mutated`, so nothing else in this suite pins it directly. This
    // test fails closed on the schema's own message, not a downstream TypeError or a silent
    // miscount, proving the invariant actually holds for the exact input `hasNonEmptyNodeId`'s
    // reasoning depends on.
    const reposYaml = [
      'version: 1',
      'repos:',
      '  - owner: "[REDACTED]"',
      '    name: repo-empty-id',
      '    private: true',
      '    node_id: ""',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '',
    ].join('\n')
    const resolver: NodeIdResolver = async () => ({error: 'error'})

    await expect(runPromotionScan({reposYaml, resolver, diff: ''})).rejects.toThrow(
      /node_id.*expected non-empty string or omitted/,
    )
  })
})

describe('runPromotionCli — assertReposFile is actually called for logging (CallExpression)', () => {
  it('rejects a well-formed-YAML, schema-invalid reposYaml with the schema-validation message, not a generic TypeError', async () => {
    // #given: reposYaml decodes to valid YAML but violates the ReposFile schema (repos is not an
    // array). Discriminates the CallExpression on `assertReposFile(parsedForLog)`: if removed,
    // `parsedForLog.repos.filter(...)` would throw a DIFFERENT TypeError instead.
    const badYaml = 'version: 1\nrepos: not-an-array\n'
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, resolverFactory} = makeSeams({diffOutput: ''})
      const reposYamlReader: ReposYamlReader = async () => badYaml
      await expect(runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)).rejects.toThrow(
        /repos\.repos.*expected array/,
      )
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('only counts entries with private===true (MethodExpression/ConditionalExpression on the filter)', async () => {
    // #given: repos.yaml has one private:true entry with no node_id, and one private:false entry
    // ALSO with no node_id. If `.filter(r => r.private === true)` were dropped (MethodExpression,
    // returning the unfiltered array) or `r.private === true` forced to `true`
    // (ConditionalExpression), the public entry would ALSO be counted as "private with no node_id",
    // reporting 2 instead of the correct 1.
    const reposYaml = [
      'version: 1',
      'repos:',
      '  - owner: "[REDACTED]"',
      '    name: private-no-id',
      '    private: true',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '  - owner: acme',
      '    name: public-repo',
      '    private: false',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '',
    ].join('\n')

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, resolverFactory} = makeSeams({diffOutput: ''})
      const reposYamlReader: ReposYamlReader = async () => reposYaml
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain(
        'check-private-leak [promotion]: 1 private entry/entries have no node_id — will block',
      )
      expect(stderrText).not.toContain('2 private entry/entries have no node_id')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })
})

describe("runPromotionCli — loggingResolver: access-lost/error branch discrimination (ConditionalExpression on `'nameWithOwner' in result`)", () => {
  it('does NOT log an access-lost/error message for a successfully resolved node_id', async () => {
    // #given: a resolver that succeeds for every node_id. If `'nameWithOwner' in result` were
    // forced to `false` (ConditionalExpression), a successful result would fall into the
    // access-lost/error else-if chain and wrongly emit a BLOCKING or could-not-resolve stderr line.
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_success_only'],
        resolverResult: async () => ({nameWithOwner: 'acme/private-repo'}),
        diffOutput: '',
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(0)
      const stderrText = stderrOutput.join('')
      expect(stderrText).not.toContain('BLOCKING')
      expect(stderrText).not.toContain('could not resolve')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })
})

describe('runPromotionCli — Fix E: CLI-level tests via injectable seams', () => {
  it('returns 1 when FRO_BOT_POLL_PAT is not set', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    const savedPat = process.env.FRO_BOT_POLL_PAT
    delete process.env.FRO_BOT_POLL_PAT

    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams()
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      expect(stderrOutput.join('')).toContain('FRO_BOT_POLL_PAT not set')
    } finally {
      if (savedPat !== undefined) process.env.FRO_BOT_POLL_PAT = savedPat
      vi.restoreAllMocks()
    }
  })

  it('returns 1 when FRO_BOT_POLL_PAT is the empty string (defined but empty, LogicalOperator: `||` not `&&`)', async () => {
    // #given: PAT === '' — defined (not undefined). Discriminates `||` from `&&`: with `&&`,
    // `pat === undefined` is false here, so the whole condition would be false and this would NOT
    // return 1.
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    const savedPat = process.env.FRO_BOT_POLL_PAT
    process.env.FRO_BOT_POLL_PAT = ''

    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams()
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      expect(stderrOutput.join('')).toContain('FRO_BOT_POLL_PAT not set')
    } finally {
      if (savedPat === undefined) delete process.env.FRO_BOT_POLL_PAT
      else process.env.FRO_BOT_POLL_PAT = savedPat
      vi.restoreAllMocks()
    }
  })

  it('reads from PROMOTION_REPOS_YAML_PATH when set, not the default (LogicalOperator: `??` not `&&`)', async () => {
    // #given: PROMOTION_REPOS_YAML_PATH set to a custom, truthy path. Discriminates `??` from
    // `&&`: with `&&`, a truthy env string evaluates to the SECOND operand ('metadata/repos.yaml'),
    // not the env value itself — the reader would receive the wrong path.
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.PROMOTION_REPOS_YAML_PATH = 'custom/path/repos.yaml'
    const receivedPaths: string[] = []
    const {gitDiffRunner, resolverFactory} = makeSeams({nodeIds: [], diffOutput: ''})
    const reposYamlReader: ReposYamlReader = async (path: string) => {
      receivedPaths.push(path)
      return makeCliReposYaml([])
    }

    try {
      await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)
      expect(receivedPaths).toEqual(['custom/path/repos.yaml'])
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.PROMOTION_REPOS_YAML_PATH
      vi.restoreAllMocks()
    }
  })

  it('returns 1 when repos.yaml cannot be read', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        reposYamlThrows: new Error('ENOENT: no such file'),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      expect(stderrOutput.join('')).toContain(
        'check-private-leak: could not read repos.yaml at metadata/repos.yaml: ENOENT: no such file',
      )
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('returns 1 when git diff fails', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: [],
        gitThrows: new Error('git: not a git repository'),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      expect(stderrOutput.join('')).toContain(
        'check-private-leak: could not obtain main...data diff: git: not a git repository',
      )
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('returns 0 when all node_ids resolve and diff is clean', async () => {
    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_clean'],
        resolverResult: async () => ({nameWithOwner: 'acme/private-repo'}),
        diffOutput: makePromoDiff('docs/public.md', ['some public content']),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(0)
      expect(stdoutOutput.join('')).toContain('check-private-leak [promotion]: ok (scanned 1 private node_id(s))')
      // #then: zero missing node_ids → the "have no node_id" warning must NOT print (EqualityOperator
      // `missingCount > 0` -> `missingCount >= 0` would wrongly print it here, since missingCount is 0).
      expect(stderrOutput.join('')).not.toContain('have no node_id')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('returns 1 when resolution fails (access-lost) — blocks promotion', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_access_lost_cli'],
        resolverResult: async () => ({error: 'access-lost'}),
        diffOutput: '',
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')
      // access-lost is now a blocking condition
      expect(stderrText).toContain('BLOCKING')
      expect(stderrText).toContain('R_access_lost_cli')
      expect(stderrText).toContain(
        'check-private-leak [promotion]: node_id=R_access_lost_cli access-lost (deleted or token cannot see it) — BLOCKING',
      )
      expect(stderrText).toContain('check-private-leak [promotion]: FAILED — could not resolve 1 private node_id(s)')
      expect(stderrText).toContain(
        'check-private-leak [promotion]: cannot guarantee a complete scan — blocking promotion',
      )
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('logs the exact could-not-resolve message for a non-access-lost error class', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_generic_error'],
        resolverResult: async () => ({error: 'error'}),
        diffOutput: '',
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('check-private-leak [promotion]: could not resolve node_id=R_generic_error (error)')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('logs the exact missing-node_id-count message when entries lack a node_id', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const reposYaml = makeReposYamlMissingNodeId()
      const {gitDiffRunner, resolverFactory} = makeSeams({diffOutput: ''})
      const reposYamlReader: ReposYamlReader = async () => reposYaml
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain(
        'check-private-leak [promotion]: 1 private entry/entries have no node_id — will block',
      )
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('computes missingCount by subtraction, not addition, when both present and missing node_ids coexist (ArithmeticOperator)', async () => {
    // #given: 2 private entries — one WITH a node_id (resolves successfully), one WITHOUT.
    // allPrivateEntries.length=2, privateNodeIds.length=1. Real: missingCount = 2 - 1 = 1.
    // Mutant (`+`): missingCount = 2 + 1 = 3. A single-node_id fixture (privateNodeIds.length=0)
    // cannot discriminate `-` from `+` since both give the same answer when the subtrahend is 0.
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const reposYaml = makeReposYamlOneMissingOnePresent()
      const {gitDiffRunner, resolverFactory} = makeSeams({diffOutput: '', nodeIds: ['R_valid']})
      const reposYamlReader: ReposYamlReader = async () => reposYaml
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      // #then: blocked (the missing node_id still resolves to a failedNodeId in runPromotionScan)
      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain(
        'check-private-leak [promotion]: 1 private entry/entries have no node_id — will block',
      )
      expect(stderrText).not.toContain('3 private entry/entries have no node_id')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('returns 1 when diff contains a matched private file', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_match'],
        resolverResult: async () => ({nameWithOwner: 'acme/private-repo'}),
        diffOutput: makePromoDiff('docs/foo.md', ['See acme/private-repo for details.']),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')
      // The private name must NOT appear in stderr (redacted)
      expect(stderrText).not.toContain('acme/private-repo')
      expect(stderrText).not.toContain('acme--private-repo')
      // #then: every literal prose string in the matched-files branch is present exactly.
      expect(stderrText).toContain(
        'check-private-leak [promotion]: FAILED — private repository name(s) detected in promotion diff',
      )
      expect(stderrText).toContain('Matched files (private tokens redacted):')
      expect(stderrText).toContain(
        'To look up the private repository locally, run: GH_TOKEN=<operator-PAT> node scripts/resolve-private.ts metadata/repos.yaml',
      )
      expect(stderrText).toContain('(This prints a node_id → owner/name table for all private entries.)')
      expect(stderrText).toContain('To resolve: redact the private name from the data branch and re-run the promotion.')
      expect(stderrText).toContain('  - docs/foo.md')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('#3430: resolutionFailed stderr prints COUNT not raw node_ids', async () => {
    // #given: one private node_id fails to resolve (non-access-lost error)
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_promo_fail'],
        resolverResult: async () => ({error: 'error'}),
        diffOutput: '',
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
      const stderrText = stderrOutput.join('')

      // #then: stderr contains the count-based summary message (not the raw node_id)
      expect(stderrText).toMatch(/could not resolve \d+ private node_id\(s\)/)

      // #then: the summary line (count form) must NOT contain the raw node_id
      // The per-node logging line may contain it, but the FAILED summary must not.
      const summaryLine = stderrText.split('\n').find(l => /could not resolve \d+ private node_id\(s\)/.test(l))
      expect(summaryLine).toBeDefined()
      expect(summaryLine).not.toContain('R_promo_fail')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('Fix C: git runner env does NOT contain FRO_BOT_POLL_PAT', async () => {
    // #given: FRO_BOT_POLL_PAT is set in process.env
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'super-secret-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory, capturedGitEnvs} = makeSeams({
        nodeIds: ['R_env_test'],
        resolverResult: async () => ({nameWithOwner: 'acme/private-repo'}),
        diffOutput: '',
      })
      await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      // #then: the git runner was called at least once
      expect(capturedGitEnvs.length).toBeGreaterThan(0)
      // #then: FRO_BOT_POLL_PAT must NOT be in the env passed to git
      for (const env of capturedGitEnvs) {
        expect(env).not.toHaveProperty('FRO_BOT_POLL_PAT')
        expect(Object.values(env)).not.toContain('super-secret-pat')
        // #then: the REST of process.env is still present — `{...process.env}` was actually
        // spread, not emptied (ObjectLiteral mutant: `{...process.env}` -> `{}`).
        expect(Object.keys(env).length).toBeGreaterThan(0)
        expect(env).toHaveProperty('PATH')
      }
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('Fix C: PAT reaches the resolver factory but not the git runner', async () => {
    // #given: FRO_BOT_POLL_PAT is set
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'resolver-only-pat'
    const capturedPats: string[] = []

    try {
      const {gitDiffRunner, reposYamlReader, capturedGitEnvs} = makeSeams({
        nodeIds: ['R_pat_routing'],
        diffOutput: '',
      })

      // Custom resolver factory that captures the PAT
      const resolverFactory: ResolverFactory = (pat: string): NodeIdResolver => {
        capturedPats.push(pat)
        return async () => ({nameWithOwner: 'acme/private-repo'})
      }

      await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      // #then: PAT reached the resolver factory
      expect(capturedPats).toContain('resolver-only-pat')
      // #then: PAT did NOT reach the git runner
      for (const env of capturedGitEnvs) {
        expect(env).not.toHaveProperty('FRO_BOT_POLL_PAT')
      }
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('no resolved private name appears in captured stdout+stderr', async () => {
    // #given: a private repo resolves; diff matches it
    const stdoutOutput: string[] = []
    const stderrOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_no_leak'],
        resolverResult: async () => ({nameWithOwner: 'secretowner/secret-repo'}),
        diffOutput: makePromoDiff('docs/foo.md', ['See secretowner/secret-repo for details.']),
      })
      await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      const allOutput = [...stdoutOutput, ...stderrOutput].join('')
      // The private name must NEVER appear in any output
      expect(allOutput).not.toContain('secretowner/secret-repo')
      expect(allOutput).not.toContain('secretowner--secret-repo')
      expect(allOutput).not.toContain('secretowner')
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })
})

// ---------------------------------------------------------------------------
// main() — workflow_run main() behavior tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal workflow_run event payload.
 *
 * The pull_requests[] entries are ABBREVIATED (as GitHub actually sends them):
 * they carry base.repo.name/id/url but NOT base.repo.full_name.
 * This matches the live behavior that caused the production bug — the old code
 * tried to validate these abbreviated objects with validatePrIdentity (which
 * requires base.repo.full_name) and always got 0 valid PRs → fail-closed.
 *
 * The new code treats pull_requests[] entries as hints (number only) and fetches
 * the full PR via fetchPrByNumber for validation.
 */
function makeWorkflowRunEvent(
  opts: {
    event?: string
    headSha?: string
    /**
     * Abbreviated PR objects as GitHub sends in workflow_run.pull_requests[].
     * Each entry has number + abbreviated head/base (no full_name on repos).
     */
    pullRequests?: {
      number: number
      head: {sha: string; repo: {name: string; id: number; url: string}}
      base: {ref: string; repo: {name: string; id: number; url: string}}
    }[]
  } = {},
): string {
  return JSON.stringify({
    workflow_run: {
      event: opts.event ?? 'pull_request',
      head_sha: opts.headSha ?? 'abc123',
      pull_requests: opts.pullRequests ?? [
        {
          // Abbreviated object: has name/id/url but NOT full_name — matches live GitHub behavior.
          number: 42,
          head: {
            sha: opts.headSha ?? 'abc123',
            repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
          },
          base: {ref: 'main', repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'}},
        },
      ],
    },
  })
}

/**
 * Build a minimal PR API response (as returned by the GitHub API).
 */
function makePrApiResponse(
  opts: {
    number?: number
    title?: string
    author?: string
    headSha?: string
    baseRef?: string
    baseRepoFullName?: string
    headRepoFullName?: string
  } = {},
): Record<string, unknown> {
  return {
    number: opts.number ?? 42,
    title: opts.title ?? 'some PR',
    user: {login: opts.author ?? 'some-user'},
    head: {sha: opts.headSha ?? 'abc123', repo: {full_name: opts.headRepoFullName ?? 'fro-bot/.github'}},
    base: {ref: opts.baseRef ?? 'main', repo: {full_name: opts.baseRepoFullName ?? 'fro-bot/.github'}},
  }
}

/**
 * Build a minimal WorkflowRunReader seam for main() tests.
 */
function makeWorkflowRunReader(eventJson: string): WorkflowRunReader {
  return async (_path: string) => eventJson
}

/**
 * Build a minimal PrApiResolver seam for main() tests.
 * Returns a PR by number, or by head SHA (fallback).
 */
function makePrApiResolver(
  opts: {
    prByNumber?: Record<string, unknown>
    prsByHeadSha?: Record<string, unknown>[]
    throwOnNumber?: boolean
    throwOnSha?: boolean
  } = {},
): PrApiResolver {
  return {
    fetchPrByNumber: async (_prNumber: number) => {
      if (opts.throwOnNumber === true) throw new Error('API error fetching PR by number')
      return opts.prByNumber ?? makePrApiResponse()
    },
    fetchPrsByHeadSha: async (_headSha: string) => {
      if (opts.throwOnSha === true) throw new Error('API error fetching PRs by SHA')
      return opts.prsByHeadSha ?? []
    },
  }
}

describe('main() — fullName is trimmed before use (MethodExpression on .trim())', () => {
  it('strips a trailing newline from gh repo view output before building downstream API paths', async () => {
    // #given: gh repo view returns fullName with a trailing newline (as real gh/subprocess output
    // often does). If `.trim()` were dropped, the untrimmed value (with embedded `\n`) would flow
    // into every downstream `repos/${fullName}/...` API path string.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-trim'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-trim'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github\n') // gh repo view — untrimmed
      .mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const contentCall = calls.find(c => String(c[1][1]).includes('/contents/metadata/repos.yaml'))
      expect(contentCall?.[1][1]).toBe('repos/fro-bot/.github/contents/metadata/repos.yaml?ref=data')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — workflow_run event: happy path with pull_requests[] populated', () => {
  it('resolves PR identity from pull_requests[], validates, scans diff, passes when no private name', async () => {
    // #given: workflow_run payload with pull_requests[] populated; no private names in diff
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-happy'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-happy'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_wf_1'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/public.md')) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    mockAppendFileSync.mockReset()
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called (pass)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutOutput.join('')).toContain('check-private-leak: ok (scanned 1 private name(s))')
      // #then: the fullName lookup hit the exact documented gh repo view invocation.
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const repoViewCall = calls.find(c => c[1][0] === 'repo' && c[1][1] === 'view')
      expect(repoViewCall).toEqual([
        'gh',
        ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
        {encoding: 'utf8'},
      ])
      // #then: scan_result is the literal 'success' from the result.ok branch, not an emptied
      // StringLiteral mutant.
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=success\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockExecFileSync.mockReset()
      mockAppendFileSync.mockReset()
    }
  })

  it('does not flag a diff line containing literal "Stryker was here" text (ArrayDeclaration seed-pollution check on privateTokens)', async () => {
    // #given: a resolved private name, and a diff whose added content happens to contain the
    // literal text Stryker's placeholder mutant would seed into `privateTokens: string[] = []`
    // ("Stryker was here"). If that array literal were mutated to `["Stryker was here"]`, the
    // seed token would survive into the scan (nothing removes it) and this diff line would wrongly
    // match, failing the scan.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-seed-pollution'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-seed-pollution'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_seed'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/changelog.md')) // fetchDiffForSha: compare JSON
      .mockReturnValueOnce(makeDiff('docs/changelog.md', ['Stryker was here during the mutation test run.'])) // fetchDiffForSha: raw diff

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutOutput.join('')).toContain('check-private-leak: ok (scanned 1 private name(s))')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails with offending file path (never the name) when diff contains a private name', async () => {
    // #given: workflow_run payload; diff adds a line with the private name
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fail'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fail'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_wf_2'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/leak.md')) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce(makeDiff('docs/leak.md', ['See acme/private-repo for details.'])) // fetchDiffForSha: raw diff

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)

      const stderrText = stderrOutput.join('')
      // #then: file path appears in output
      expect(stderrText).toContain('docs/leak.md')
      // #then: the private name does NOT appear
      expect(stderrText).not.toContain('acme/private-repo')
      expect(stderrText).not.toContain('acme--private-repo')
      // #then: the exact detection message printed.
      expect(stderrText).toContain('check-private-leak: FAILED — private repository name(s) detected in PR diff')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — compare fetch buffer handling', () => {
  it('passes an explicit large-output buffer to both compare API fetches', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-buffer-options'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-buffer-options'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_buffer_options']))
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'org/repo'}}}))
      .mockReturnValueOnce(makeCompareJson())
      .mockReturnValueOnce('')

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)

      const compareCalls = (mockExecFileSync.mock.calls as unknown[][]).filter(
        call => call[0] === 'gh' && Array.isArray(call[1]) && String(call[1][1]).includes('/compare/'),
      )
      expect(compareCalls).toHaveLength(2)
      for (const call of compareCalls) {
        const options: unknown = call[2]
        if (
          typeof options !== 'object' ||
          options === null ||
          !('maxBuffer' in options) ||
          typeof options.maxBuffer !== 'number'
        ) {
          throw new TypeError('compare call did not receive a numeric maxBuffer')
        }
        expect(options.maxBuffer).toBeGreaterThan(1024 * 1024)
      }
      expect(exitSpy).not.toHaveBeenCalled()
      // #then: the two compare calls hit the exact JSON-truncation-check and raw-diff endpoints.
      const anyObjectMatcher: object = expect.any(Object) as object
      expect(compareCalls[0]).toEqual([
        'gh',
        ['api', 'repos/{owner}/{repo}/compare/main...sha-buffer-options'],
        {encoding: 'utf8', env: anyObjectMatcher, maxBuffer: largeOutputMaxBufferBytes()},
      ])
      expect(compareCalls[1]).toEqual([
        'gh',
        [
          'api',
          'repos/{owner}/{repo}/compare/main...sha-buffer-options',
          '-H',
          'Accept: application/vnd.github.v3.diff',
        ],
        {encoding: 'utf8', env: anyObjectMatcher, maxBuffer: largeOutputMaxBufferBytes()},
      ])
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails closed when the compare fetch exceeds its output buffer', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-buffer-exceeded'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-buffer-exceeded'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_buffer_exceeded']))
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'org/repo'}}}))
      .mockImplementationOnce(() => {
        const error = new Error('spawnSync gh ENOBUFS') as Error & {code?: string}
        error.code = 'ENOBUFS'
        throw error
      })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((message: unknown) => {
      stderrOutput.push(String(message))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(mockExecFileSync).toHaveBeenCalledTimes(4)
      expect(stderrOutput.join('')).toContain('ENOBUFS')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// Regression lock: abbreviated pull_requests[] objects must NOT fail-closed
// This is the exact live bug: abbreviated entries lack base.repo.full_name, so
// the old validatePrIdentity call always returned false → 0 valid → fail-closed.
// The fix: extract numbers only from pull_requests[], fetch full PR via fetchPrByNumber.
// ---------------------------------------------------------------------------

describe('main() — regression: abbreviated pull_requests[] entry resolves successfully (live bug fix)', () => {
  it('resolves PR identity when pull_requests[] has abbreviated objects (no base.repo.full_name)', async () => {
    // #given: workflow_run payload with abbreviated pull_requests[] entry — exactly as GitHub sends it.
    // The abbreviated object has base.repo.name/id/url but NOT base.repo.full_name.
    // OLD behavior: validatePrIdentity(abbreviatedObj) → false → 0 valid → fail-closed (blocks every legit PR).
    // NEW behavior: extract number 42 → fetchPrByNumber(42) → validatePrIdentity(fullObj) → true → resolves.
    const eventJson = JSON.stringify({
      workflow_run: {
        event: 'pull_request',
        head_sha: 'sha-abbrev-regression',
        pull_requests: [
          {
            // Abbreviated object: has name/id/url but NOT full_name — this is what GitHub actually sends.
            number: 42,
            head: {
              sha: 'sha-abbrev-regression',
              repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
            },
            base: {
              ref: 'main',
              repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
            },
          },
        ],
      },
    })
    // fetchPrByNumber returns the FULL PR object (with base.repo.full_name) — this is what validates.
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-abbrev-regression'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_abbrev_regression'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/public.md')) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs with abbreviated pull_requests[] entry
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called — the gate PASSES (regression: old code would fail-closed here)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('mutation check: reverting to validate abbreviated object directly causes this test to fail', async () => {
    // This test documents the mutation check: if validatePrIdentity were called on the abbreviated
    // object (which lacks base.repo.full_name), it would return false → 0 valid → fail-closed.
    // The abbreviated object below has NO base.repo.full_name — validatePrIdentity returns false for it.
    const abbreviatedPr: Record<string, unknown> = {
      number: 42,
      head: {
        sha: 'sha-mutation-check',
        repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
      },
      base: {ref: 'main', repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'}},
    }
    // Verify the abbreviated object lacks full_name (the root cause of the bug).
    const base = abbreviatedPr.base
    const baseRepo =
      base !== null && typeof base === 'object' && 'repo' in base ? (base as Record<string, unknown>).repo : undefined
    const fullName =
      baseRepo !== null && typeof baseRepo === 'object' && 'full_name' in (baseRepo as Record<string, unknown>)
        ? (baseRepo as Record<string, unknown>).full_name
        : undefined
    // #then: abbreviated object has no full_name — the old code would fail here
    expect(fullName).toBeUndefined()

    // The fix: the code now extracts the number (42) and calls fetchPrByNumber(42),
    // which returns a FULL object with base.repo.full_name. That full object validates correctly.
    const eventJson = JSON.stringify({
      workflow_run: {
        event: 'pull_request',
        head_sha: 'sha-mutation-check',
        pull_requests: [abbreviatedPr],
      },
    })
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-mutation-check'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_mutation'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/public.md')) // fetchDiffForSha: compare JSON
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs — with the fix, this PASSES (no exit)
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called — the fix works
      // If you revert to validating the abbreviated object directly, this assertion fails
      // because the gate would fail-closed (process.exit(1) would be called).
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — workflow_run event: empty pull_requests[] → API fallback by head_sha', () => {
  it('falls back to fetchPrsByHeadSha when pull_requests[] is empty and resolves PR', async () => {
    // #given: workflow_run payload with empty pull_requests[]; API fallback returns one PR
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback', pullRequests: []})
    const fallbackPr = makePrApiResponse({number: 99, headSha: 'sha-fallback'})
    const prApiResolver = makePrApiResolver({
      prsByHeadSha: [fallbackPr],
      prByNumber: fallbackPr,
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_wf_fallback'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/public.md')) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called (pass)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — workflow_run event: error paths (fail-closed)', () => {
  it('fails closed when workflow_run.event != "pull_request"', async () => {
    // #given: workflow_run payload with event = 'push' (not pull_request)
    const eventJson = makeWorkflowRunEvent({event: 'push'})
    const prApiResolver = makePrApiResolver()

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('workflow_run.event is "push", expected "pull_request" — fail-closed')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when workflow_run.head_sha is an empty string (LogicalOperator: `||` not `&&`)', async () => {
    // #given: head_sha === '' — typeof check passes (it IS a string) but the emptiness check
    // must independently trigger the fail-closed throw. Discriminates `||` from `&&`: with `&&`,
    // `typeof !== 'string'` is false here, so the whole condition would be false and this would
    // NOT throw.
    const eventJson = makeWorkflowRunEvent({headSha: ''})
    const prApiResolver = makePrApiResolver()

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('workflow_run.head_sha is missing or empty')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when workflow_run.head_sha is a non-empty non-string (LogicalOperator: `||` not `&&`)', async () => {
    // #given: head_sha is a number — emptiness check (`=== ''`) is false (it's not a string at
    // all), so ONLY the `typeof !== 'string'` half can trigger the throw. Discriminates `||` from
    // `&&`: with `&&`, both halves would need to be true, but `headSha === ''` is always false for
    // a number, so a mutant `&&` would never throw here — it would fall through to
    // `String(headSha)`-style downstream use of a numeric head_sha.
    const eventJson = JSON.stringify({
      workflow_run: {event: 'pull_request', head_sha: 12345, pull_requests: []},
    })
    const prApiResolver = makePrApiResolver()

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('workflow_run.head_sha is missing or empty')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when the event payload is not an object (ConditionalExpression)', async () => {
    const prApiResolver = makePrApiResolver()
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    mockAppendFileSync.mockReset()
    try {
      await expect(main(makeWorkflowRunReader('42'), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('workflow_run event payload is not an object')
      // #then: scan_result is the literal 'error' from the readWorkflowRunContext-throws catch,
      // not an emptied StringLiteral mutant.
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=error\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_OUTPUT
      mockAppendFileSync.mockReset()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when the event payload is missing workflow_run entirely (ConditionalExpression)', async () => {
    const prApiResolver = makePrApiResolver()
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(
        main(makeWorkflowRunReader(JSON.stringify({not_workflow_run: true})), prApiResolver),
      ).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('event payload missing workflow_run field')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed with the pull_requests[]-specific message when candidates came from pull_requests[] (BooleanLiteral: usedHeadShaFallback)', async () => {
    // #given: pull_requests[] is populated (non-empty) but validation fails — the error message
    // must be the pull_requests[]-specific variant, not the head-SHA-fallback variant. Discriminates
    // `usedHeadShaFallback`'s initial `false` literal: the ONLY variant a BooleanLiteral mutator
    // produces for `false` is `true`, which would swap this message to the wrong branch.
    const eventJson = makeWorkflowRunEvent({
      headSha: 'sha-msg-variant',
      pullRequests: [
        {
          number: 42,
          head: {sha: 'sha-msg-variant', repo: {name: 'other', id: 1, url: 'x'}},
          base: {ref: 'develop', repo: {name: 'other', id: 1, url: 'x'}},
        },
      ],
    })
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-msg-variant', baseRef: 'develop'}),
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('expected exactly 1 valid PR in pull_requests[], found 0')
      expect(stderrText).not.toContain('head-SHA fallback')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed with the head-SHA-fallback-specific message when pull_requests[] is empty (BooleanLiteral: usedHeadShaFallback)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-msg', pullRequests: []})
    const prApiResolver = makePrApiResolver({
      prsByHeadSha: [makePrApiResponse({number: 99, headSha: 'sha-fallback-msg'})],
      prByNumber: makePrApiResponse({number: 99, headSha: 'sha-fallback-msg', baseRef: 'develop'}),
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('expected exactly 1 valid PR from head-SHA fallback, found 0')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed with the head-SHA-specific zero-candidates message when the fallback API returns nothing', async () => {
    // #given: pull_requests[] empty AND fetchPrsByHeadSha returns zero PRs — must hit the
    // `nums.length === 0` throw inside the fallback IIFE with its own distinct message.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-zero-fallback', pullRequests: []})
    const prApiResolver = makePrApiResolver({prsByHeadSha: []})

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('head-SHA fallback returned 0 valid PR(s), expected exactly 1')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('workflow_run.pull_requests non-array falls back to head-SHA resolution (ArrayDeclaration default [])', async () => {
    // #given: pull_requests is a string, not an array — must be treated as empty (not iterated,
    // not crash), forcing the head-SHA fallback path.
    const eventJson = JSON.stringify({
      workflow_run: {event: 'pull_request', head_sha: 'sha-nonarray-prs', pull_requests: 'not-an-array'},
    })
    const prApiResolver = makePrApiResolver({
      prsByHeadSha: [makePrApiResponse({number: 55, headSha: 'sha-nonarray-prs'})],
      prByNumber: makePrApiResponse({number: 55, headSha: 'sha-nonarray-prs'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('fro-bot/.github').mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails closed when fetchPrByNumber returns a PR missing prNumber-referencing details (OptionalChaining on user)', async () => {
    // #given: user is present but not an object (isRecord(prDetails.user) false branch) — author
    // resolves to undefined via the ternary, distinct from user.login being non-string.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-user-not-object'})
    const prApiResolver = makePrApiResolver({
      prByNumber: {
        number: 42,
        title: 'a PR',
        user: 'not-an-object',
        head: {sha: 'sha-user-not-object', repo: {full_name: 'fro-bot/.github'}},
        base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
      },
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('missing user.login field')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when user.login is present but not a string (OptionalChaining/typeof guard)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-login-not-string'})
    const prApiResolver = makePrApiResolver({
      prByNumber: {
        number: 42,
        title: 'a PR',
        user: {login: 12345},
        head: {sha: 'sha-login-not-string', repo: {full_name: 'fro-bot/.github'}},
        base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
      },
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('missing user.login field')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when title is missing/non-string (ConditionalExpression on title check)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-title-missing'})
    const prApiResolver = makePrApiResolver({
      prByNumber: {
        number: 42,
        title: 12345,
        user: {login: 'someone'},
        head: {sha: 'sha-title-missing', repo: {full_name: 'fro-bot/.github'}},
        base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
      },
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('missing title field')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when base repo does not match fro-bot/.github', async () => {
    // #given: workflow_run payload with abbreviated pull_requests[] entry (number hint only).
    // Validation happens via fetchPrByNumber which returns a PR targeting a different base repo.
    const eventJson = makeWorkflowRunEvent({
      headSha: 'sha-wrong-repo',
      pullRequests: [
        {
          number: 42,
          head: {
            sha: 'sha-wrong-repo',
            repo: {name: 'other-repo', id: 99, url: 'https://api.github.com/repos/other-org/other-repo'},
          },
          base: {
            ref: 'main',
            repo: {name: 'other-repo', id: 99, url: 'https://api.github.com/repos/other-org/other-repo'},
          },
        },
      ],
    })
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-wrong-repo', baseRepoFullName: 'other-org/other-repo'}),
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when base branch is not main', async () => {
    // #given: workflow_run payload with abbreviated pull_requests[] entry (number hint only).
    // Validation happens via fetchPrByNumber which returns a PR targeting a non-main branch.
    const eventJson = makeWorkflowRunEvent({
      headSha: 'sha-wrong-branch',
      pullRequests: [
        {
          number: 42,
          head: {
            sha: 'sha-wrong-branch',
            repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
          },
          base: {
            ref: 'develop',
            repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
          },
        },
      ],
    })
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-wrong-branch', baseRef: 'develop'}),
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when PR head SHA does not match the scanned workflow_run head_sha', async () => {
    // #given: workflow_run payload with abbreviated pull_requests[] entry (number hint only).
    // Validation happens via fetchPrByNumber which returns a PR whose head SHA doesn't match.
    const eventJson = makeWorkflowRunEvent({
      headSha: 'sha-scanned',
      pullRequests: [
        {
          number: 42,
          head: {
            sha: 'sha-different',
            repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
          },
          base: {ref: 'main', repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'}},
        },
      ],
    })
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-different'}),
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when pull_requests[] is empty and API fallback returns nothing', async () => {
    // #given: workflow_run payload with empty pull_requests[]; API fallback returns empty array
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-pr', pullRequests: []})
    const prApiResolver = makePrApiResolver({prsByHeadSha: []})

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when head-SHA fallback returns multiple PRs and both pass validation', async () => {
    // #given: workflow_run payload with empty pull_requests[]; API fallback returns two PRs.
    // Numbers are extracted from the fallback results; fetchPrByNumber returns a valid full PR
    // for both numbers → exactly-one guard triggers → fail-closed.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-ambiguous', pullRequests: []})
    // prsByHeadSha provides the number hints (abbreviated objects are fine here too).
    const pr1 = makePrApiResponse({number: 10, headSha: 'sha-ambiguous'})
    const pr2 = makePrApiResponse({number: 11, headSha: 'sha-ambiguous'})
    // fetchPrByNumber returns a valid full PR for any number — both 10 and 11 pass validation.
    const prApiResolver: PrApiResolver = {
      fetchPrsByHeadSha: async () => [pr1, pr2],
      fetchPrByNumber: async (num: number) => makePrApiResponse({number: num, headSha: 'sha-ambiguous'}),
    }

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when FRO_BOT_POLL_PAT is absent', async () => {
    // #given: workflow_run payload is valid; but FRO_BOT_POLL_PAT is not set
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-pat'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-no-pat'}),
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    delete process.env.FRO_BOT_POLL_PAT
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
    }
  })
})

describe('main() — GITHUB_EVENT_PATH/FRO_BOT_POLL_PAT empty-string guards (LogicalOperator: `||` not `&&`)', () => {
  it('fails closed when GITHUB_EVENT_PATH is the empty string (defined but empty)', async () => {
    // #given: GITHUB_EVENT_PATH === '' — defined (not undefined) but empty. Discriminates `||`
    // from `&&`: with `&&`, `eventPath === undefined` is false here, so the whole condition would
    // be false and this would NOT fail closed.
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = ''
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    const workflowRunReaderSpy = vi.fn(async () => '{}')
    try {
      await expect(main(workflowRunReaderSpy)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(exitSpy).toHaveBeenCalledTimes(1)
      expect(stderrOutput.join('')).toContain('GITHUB_EVENT_PATH not set')
      // #then: execution stopped at the guard — if `process.exit(1)` here were a no-op
      // (CallExpression mutant), main() would fall through and call the injected reader.
      expect(workflowRunReaderSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when FRO_BOT_POLL_PAT is the empty string (defined but empty)', async () => {
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = ''
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    mockAppendFileSync.mockReset()
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('FRO_BOT_POLL_PAT not set')
      // #then: scan_result is the literal 'error', not an emptied StringLiteral mutant.
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=error\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockAppendFileSync.mockReset()
    }
  })
})

// Each case forces a different ternary/optional-chain branch in validatePrIdentity to take its
// "missing" arm via a *type* mismatch (not a value mismatch, which the repo/branch/sha tests
// below already cover). If any `?.` were a plain `.`, these malformed shapes would throw a
// TypeError instead of cleanly falling through to "expected exactly 1 valid PR ... found 0" —
// asserting the exact message (and its absence of a crash) discriminates both failure modes.
const MALFORMED_PR_EXPECTED_NOT_FOUND = 'expected exactly 1 valid PR in pull_requests[], found 0'

async function runMalformedPrCase(malformedPr: Record<string, unknown>): Promise<string> {
  const eventJson = makeWorkflowRunEvent({headSha: 'sha-malformed'})
  const prApiResolver: PrApiResolver = {
    fetchPrByNumber: async () => malformedPr,
    fetchPrsByHeadSha: async () => [malformedPr],
  }

  const stderrOutput: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
    stderrOutput.push(String(msg))
    return true
  })
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called')
  })

  process.env.GITHUB_EVENT_PATH = '/fake/event.json'
  process.env.FRO_BOT_POLL_PAT = 'test-pat'
  try {
    await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    return stderrOutput.join('')
  } finally {
    exitSpy.mockRestore()
    vi.restoreAllMocks()
    delete process.env.GITHUB_EVENT_PATH
    delete process.env.FRO_BOT_POLL_PAT
  }
}

describe('main() — validatePrIdentity: malformed PR shapes (OptionalChaining/ConditionalExpression discrimination)', () => {
  it('pr.base is not an object → base undefined, baseRepo short-circuits without throwing', async () => {
    const stderrText = await runMalformedPrCase({number: 42, head: {sha: 'sha-malformed'}, base: null})
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
    expect(stderrText).not.toContain('Cannot read propert')
  })

  it('pr.base.repo is not an object → baseRepo undefined, baseRepoFullName falls through cleanly', async () => {
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: {sha: 'sha-malformed'},
      base: {ref: 'main', repo: null},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
    expect(stderrText).not.toContain('Cannot read propert')
  })

  it('pr.head is not an object → headSha undefined via optional chaining, no throw', async () => {
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: null,
      base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
    expect(stderrText).not.toContain('Cannot read propert')
  })

  it('head.sha is a number, not a string → headSha undefined (typeof guard, not a value check)', async () => {
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: {sha: 12345},
      base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
  })

  it('base.ref is a number, not a string → baseRef undefined (typeof guard, not a value check)', async () => {
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: {sha: 'sha-malformed'},
      base: {ref: 12345, repo: {full_name: 'fro-bot/.github'}},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
  })

  it('baseRepo.full_name is a number, not a string → baseRepoFullName undefined (typeof guard)', async () => {
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: {sha: 'sha-malformed'},
      base: {ref: 'main', repo: {full_name: 12345}},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
  })

  it('extractNumbers skips a non-record entry and a non-number `number` field in pull_requests[]', async () => {
    // #given: pull_requests[] mixes a valid abbreviated entry with a non-record entry (string), a
    // `null` entry, and a record whose `number` is a string, not a number. All three bad entries
    // must be filtered out of the candidate list rather than crashing or being coerced into a
    // candidate. `null` specifically discriminates the `if (!isRecord(pr)) continue` guard: skipping
    // that `continue` would fall through to `pr.number` on `null`, which throws a TypeError — the
    // string entry alone does not throw on property access, so it cannot discriminate this guard.
    const eventJson = JSON.stringify({
      workflow_run: {
        event: 'pull_request',
        head_sha: 'sha-extract-numbers',
        pull_requests: [
          'not-a-record',
          null,
          {number: '42-as-string', head: {sha: 'x'}, base: {ref: 'main'}},
          {
            number: 42,
            head: {sha: 'sha-extract-numbers', repo: {name: '.github', id: 1, url: 'x'}},
            base: {ref: 'main', repo: {name: '.github', id: 1, url: 'x'}},
          },
        ],
      },
    })
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-extract-numbers'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('fro-bot/.github').mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: the single valid numeric candidate (42) resolves and validates — no exit(1).
      // If the non-record entry crashed isRecord(), or the string "number" were accepted as a
      // candidate, fetchPrByNumber would be called with a bad value and validation would diverge.
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails closed when base.repo.full_name is the empty string (EXPECTED_BASE_REPO StringLiteral)', async () => {
    // #given: base.repo.full_name === '' — must never match EXPECTED_BASE_REPO. If the constant
    // were mutated to '', an empty full_name would wrongly satisfy the equality.
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: {sha: 'sha-malformed'},
      base: {ref: 'main', repo: {full_name: ''}},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
  })

  it('fails closed when base.ref is the empty string (EXPECTED_BASE_BRANCH StringLiteral)', async () => {
    const stderrText = await runMalformedPrCase({
      number: 42,
      head: {sha: 'sha-malformed'},
      base: {ref: '', repo: {full_name: 'fro-bot/.github'}},
    })
    expect(stderrText).toContain(MALFORMED_PR_EXPECTED_NOT_FOUND)
  })

  it('throws "missing user.login field" for an empty-string author with a downstream path that would otherwise pass (StringLiteral/ConditionalExpression)', async () => {
    // #given: user.login === '' — a benign downstream (zero private entries) so the ONLY reason
    // this run could fail-closed is the author-empty guard itself. If the guard's StringLiteral
    // (`''` -> junk) or ConditionalExpression (`false`) mutant fired, author='' would flow through
    // unblocked and this run would pass cleanly instead.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-empty-login-only-reason'})
    const prApiResolver = makePrApiResolver({
      prByNumber: {
        number: 42,
        title: 'a PR',
        user: {login: ''},
        head: {sha: 'sha-empty-login-only-reason', repo: {full_name: 'fro-bot/.github'}},
        base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
      },
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('missing user.login field')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('all fields well-formed and matching → validates true (positive control for the ternaries)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-malformed-ok'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-malformed-ok'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('fro-bot/.github').mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — workflow_run event: PAT isolation (resolver vs diff subprocess)', () => {
  it('PAT is present in resolver subprocess env but absent from diff subprocess env', async () => {
    // #given: workflow_run payload; FRO_BOT_POLL_PAT is set
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-pat-isolation'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-pat-isolation'}),
    })

    // We capture the env passed to execFileSync calls.
    // The resolver (gh api graphql) call should have GH_TOKEN = PAT (makeGhNodeIdResolver sets it).
    // The diff (gh api repos/.../compare/...) call should NOT have FRO_BOT_POLL_PAT.
    const capturedEnvs: {args: string[]; env: NodeJS.ProcessEnv | undefined}[] = []
    mockExecFileSync.mockReset()
    mockExecFileSync.mockImplementation((cmd: string, args: string[], opts: {env?: NodeJS.ProcessEnv} | undefined) => {
      capturedEnvs.push({args: [cmd, ...args], env: opts?.env})
      // fetchPrivateNodeIds: gh api repos/.../contents/...
      if (args[0] === 'api' && String(args[1]).startsWith('repos/') && String(args[1]).includes('/contents/')) {
        return makeYamlBase64(['R_pat_iso'])
      }
      // resolver: gh api graphql
      if (args[0] === 'api' && args[1] === 'graphql') {
        return JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})
      }
      // fetchDiffForSha: gh api repos/.../compare/main...{sha}
      // Two calls: first is the JSON truncation check (no -H header), second is the raw diff.
      if (args[0] === 'api' && String(args[1]).includes('/compare/')) {
        if (args.includes('-H') && args.some(a => String(a).includes('application/vnd.github'))) {
          return makeDiff('docs/public.md', ['some public content'])
        }
        return makeCompareJson('docs/public.md')
      }
      return ''
    })

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'super-secret-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)

      // Find the diff calls (gh api repos/.../compare/main...{sha} — both JSON check and raw diff)
      const diffCalls = capturedEnvs.filter(c => c.args[1] === 'api' && String(c.args[2]).includes('/compare/'))
      expect(diffCalls.length).toBeGreaterThan(0)
      for (const call of diffCalls) {
        // FRO_BOT_POLL_PAT must NOT be in the diff subprocess env
        expect(call.env).not.toHaveProperty('FRO_BOT_POLL_PAT')
        if (call.env !== undefined) {
          expect(Object.values(call.env)).not.toContain('super-secret-pat')
          // #then: the REST of process.env is still present — `{...process.env}` was actually
          // spread, not emptied (ObjectLiteral mutant: `{...process.env}` -> `{}`).
          expect(call.env).toHaveProperty('PATH')
        }
      }

      // Find the resolver call (gh api graphql)
      const resolverCalls = capturedEnvs.filter(c => c.args[1] === 'api' && c.args[2] === 'graphql')
      expect(resolverCalls.length).toBeGreaterThan(0)
      for (const call of resolverCalls) {
        // The resolver subprocess should have GH_TOKEN = PAT (set by makeGhNodeIdResolver)
        // and FRO_BOT_POLL_PAT stripped (makeGhNodeIdResolver strips it)
        expect(call.env).not.toHaveProperty('FRO_BOT_POLL_PAT')
        if (call.env !== undefined) {
          expect(call.env.GH_TOKEN).toBe('super-secret-pat')
        }
      }
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — workflow_run event: [allow-private-leak] override honored under new identity path', () => {
  it('honors override when title is prefixed and author is the operator (title from validated PR JSON)', async () => {
    // #given: workflow_run payload; PR title has [allow-private-leak] prefix; author is marcusrbrown
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-override'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-override',
        title: '[allow-private-leak] my PR',
        author: 'marcusrbrown',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_override'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        throw new Error('outage')
      }) // resolver R_override — fails (but override should allow proceeding)
      .mockReturnValueOnce(makeCompareJson()) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce('') // fetchDiffForSha: raw diff → empty
      .mockImplementationOnce(() => {
        throw new Error('gh: could not post comment')
      }) // postOverrideComment — fails; must be swallowed, not propagated

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called (override honored, postOverrideComment failure swallowed)
      expect(exitSpy).not.toHaveBeenCalled()
      // #then: override was logged
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('operator override active')
      // #then: the postOverrideComment failure was logged with the exact message (BlockStatement/
      // StringLiteral on the catch block — an emptied catch would silently swallow this log, and
      // a mutated string wouldn't match).
      expect(stderrText).toContain('check-private-leak: could not post override transparency comment')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('honors override at the checkPrivateLeak call site when the resolver succeeds and the diff genuinely matches (ObjectLiteral on `override`)', async () => {
    // #given: resolver SUCCEEDS for the node_id (no failedNodeIds — the earlier override gate at
    // line ~1128 never fires) AND the diff genuinely contains the resolved private name. The ONLY
    // way this run passes is the `checkPrivateLeak(privateTokens, diff, override)` call itself
    // honoring the override object. If `override` were emptied to `{}` (ObjectLiteral mutant),
    // `override.titlePrefixed`/`override.isOperator` would both be `undefined`, checkPrivateLeak's
    // own gate would NOT bypass, and the genuine match would fail the scan (exit 1) instead.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-override-checkPrivateLeak'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-override-checkPrivateLeak',
        title: '[allow-private-leak] my PR',
        author: 'marcusrbrown',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_override_match'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/override-match-repo'}}})) // resolver succeeds
      .mockReturnValueOnce(makeCompareJson('docs/leak.md')) // fetchDiffForSha: compare JSON
      .mockReturnValueOnce(makeDiff('docs/leak.md', ['See acme/override-match-repo for details.'])) // genuine match

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called (override honored despite genuine match)
      expect(exitSpy).not.toHaveBeenCalled()
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('override honored for operator marcusrbrown')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// FIX 1 (token coverage) — buildTokensForName raw double-dash form
// ---------------------------------------------------------------------------

describe('main() — OPERATOR_LOGIN exact-value discrimination', () => {
  it('does NOT honor override when author is the empty string, even with the title prefix', async () => {
    // #given: title is prefixed, but author is '' — must never equal OPERATOR_LOGIN. If the
    // constant were mutated to '', an empty author would wrongly satisfy `author === OPERATOR_LOGIN`.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-empty-author'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-empty-author',
        title: '[allow-private-leak] my PR',
        author: '',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_empty_author']))
      .mockImplementationOnce(() => {
        throw new Error('outage')
      })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: empty-string author must fail closed — readWorkflowRunContext itself rejects an
      // empty author before OPERATOR_LOGIN is even compared (author === '' throws in main's PR
      // details check is a different path; here the PR API returns author: '' which fails the
      // `author === undefined || author === ''` guard in readWorkflowRunContext).
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).not.toContain('operator override active')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('does NOT honor override for the operator author when the title lacks the [allow-private-leak] prefix (StringLiteral on the prefix literal)', async () => {
    // #given: author IS the operator, but the title has no prefix at all. If the literal
    // '[allow-private-leak]' were mutated to '' (StringLiteral), `title.startsWith('')` is always
    // true for ANY title, wrongly setting titlePrefixed=true and honoring the override here.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-prefix-operator'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-no-prefix-operator',
        title: 'a totally unrelated PR title',
        author: 'marcusrbrown',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_no_prefix']))
      .mockImplementationOnce(() => {
        throw new Error('outage')
      })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).not.toContain('operator override active')
      expect(stderrText).toContain('FAILED')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('does NOT honor override for a non-operator author, even with the title prefix', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-non-operator'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-non-operator',
        title: '[allow-private-leak] my PR',
        author: 'not-the-operator',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_non_operator']))
      .mockImplementationOnce(() => {
        throw new Error('outage')
      })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).not.toContain('operator override active')
      expect(stderrText).toContain('FAILED')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('extractPrivateNodeIds — assertReposFile is actually called (CallExpression)', () => {
  it('fails closed with the schema-validation message, not a generic TypeError, when data content is a well-formed-base64 but schema-invalid YAML (repos is not an array)', async () => {
    // #given: content decodes to valid YAML but violates the ReposFile schema (`repos` is a string,
    // not an array). If `assertReposFile(parsed)` were removed (CallExpression mutant), execution
    // would fall through to `parsed.repos.filter(...)`, and `.filter` is not a function on a
    // string — a DIFFERENT TypeError ("parsed.repos.filter is not a function") than the real
    // SchemaValidationError this test asserts on.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-schema-invalid'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-schema-invalid'}),
    })

    const badYaml = 'version: 1\nrepos: not-an-array\n'
    const badYamlBase64 = Buffer.from(badYaml).toString('base64')

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('fro-bot/.github').mockReturnValueOnce(badYamlBase64)

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('repos.repos')
      expect(stderrText).toContain('expected array')
      expect(stderrText).not.toContain('is not a function')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — zero private entries: exact success message', () => {
  it('prints the exact "no private entries" message and does not scan a diff', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-zero-entries-msg'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-zero-entries-msg'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('fro-bot/.github').mockReturnValueOnce(makeYamlBase64([]))

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutOutput.join('')).toContain(
        'check-private-leak: no private entries found in metadata/repos.yaml — skipping scan',
      )
      // #then: exactly two execFileSync calls (repo view + content fetch) — no diff/compare fetch.
      expect(mockExecFileSync).toHaveBeenCalledTimes(2)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — successful-scan override gate (LogicalOperator: `&&` not `||`)', () => {
  it('does NOT post an override comment for a non-operator author, even with the title prefix, on a clean scan', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-clean-nonoperator'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-clean-nonoperator',
        title: '[allow-private-leak] my PR',
        author: 'not-the-operator',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_clean_nonoperator']))
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/clean-nonoperator-repo'}}}))
      .mockReturnValueOnce(makeCompareJson('docs/public.md'))
      .mockReturnValueOnce(makeDiff('docs/public.md', ['nothing private here']))

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      const stderrText = stderrOutput.join('')
      expect(stderrText).not.toContain('override honored')
      // #then: postOverrideComment's own execFileSync call (issues/.../comments) must NOT fire.
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const commentCall = calls.find(c => String(c[1][1]).includes('/comments'))
      expect(commentCall).toBeUndefined()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — postOverrideComment: exact args on a successful-scan override', () => {
  it('posts the exact gh api comment endpoint and body when result.ok && titlePrefixed && isOperator', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-post-override'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-post-override',
        title: '[allow-private-leak] my PR',
        author: 'marcusrbrown',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_post_override']))
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/post-override-repo'}}}))
      .mockReturnValueOnce(makeCompareJson('docs/public.md'))
      .mockReturnValueOnce(makeDiff('docs/public.md', ['nothing private here']))
      .mockReturnValueOnce('') // postOverrideComment's own execFileSync call

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const commentCall = calls.find(c => String(c[1][1]).includes('/issues/42/comments'))
      expect(commentCall).toEqual([
        'gh',
        [
          'api',
          'repos/{owner}/{repo}/issues/42/comments',
          '--method',
          'POST',
          '-f',
          'body=\u26A0\uFE0F **[allow-private-leak] override honored** \u2014 `marcusrbrown` bypassed the private-leak guard on this PR. Operator-approved.',
        ],
        {encoding: 'utf8'},
      ])
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('buildTokensForName — raw double-dash form (FIX 1)', () => {
  // buildTokensForName is not exported; exercise it via runPromotionScan which
  // calls it internally and uses the returned tokens for both matching and redaction.

  it('includes the raw double-dash form for a name with underscore (acme/private_repo)', async () => {
    // #given: a private repo whose name contains an underscore.
    // The slug sanitizes underscore → hyphen (acme--private-repo), but the raw form preserves it
    // (acme--private_repo). Without the raw form in the token set, a diff containing
    // "acme--private_repo" would not be detected.
    const reposYaml = makeReposYaml(['R_underscore'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_underscore') return {nameWithOwner: 'acme/private_repo'}
      return {error: 'error'}
    }
    // Diff adds a content line containing the raw double-dash form (underscore preserved).
    // The slug form (acme--private-repo) would NOT match this line — only the raw form does.
    const diff = makePromoDiff('docs/some-doc.md', ['See acme--private_repo for details.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: the raw double-dash form is in the token set → detected as a leak
    expect(result.ok).toBe(false)
  })

  it('redacts the raw double-dash form (acme--private_repo) in the matched path output', async () => {
    // #given: same scenario — raw double-dash form in a new file path
    const reposYaml = makeReposYaml(['R_underscore_redact'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_underscore_redact') return {nameWithOwner: 'acme/private_repo'}
      return {error: 'error'}
    }
    const diff = [
      'diff --git a/knowledge/wiki/repos/acme--private_repo.md b/knowledge/wiki/repos/acme--private_repo.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/knowledge/wiki/repos/acme--private_repo.md',
      '@@ -0,0 +1 @@',
      '+Some unrelated content',
    ].join('\n')

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: blocked; the matched path must NOT contain the literal private_repo token
    expect(result.ok).toBe(false)
    if (!result.ok && 'matchedFiles' in result) {
      for (const file of result.matchedFiles) {
        expect(file).not.toContain('private_repo')
        expect(file).not.toContain('acme--private_repo')
        expect(file).toContain('[REDACTED]')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// FIX 2 (PR-path redaction parity) — matched files redacted in main() stderr
// ---------------------------------------------------------------------------

describe('main() — PR-path matched file redaction (FIX 2)', () => {
  it('redacts the private token from matched file paths printed to stderr on failure', async () => {
    // #given: a private repo resolves; diff adds a new file whose path contains the slug
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix2-redact'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix2-redact'}),
    })
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_pr_redact'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'synth-owner/synth_private'}}})) // resolver → resolves
      // fetchDiffForSha: compare JSON (truncation check — well-formed, under cap)
      .mockReturnValueOnce(makeCompareJson('knowledge/wiki/repos/synth-owner--synth_private.md'))
      // fetchDiffForSha: raw diff — adds a new file whose path contains the slug form
      .mockReturnValueOnce(
        [
          'diff --git a/knowledge/wiki/repos/synth-owner--synth_private.md b/knowledge/wiki/repos/synth-owner--synth_private.md',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/knowledge/wiki/repos/synth-owner--synth_private.md',
          '@@ -0,0 +1 @@',
          '+Some content',
        ].join('\n'),
      )

    const stderrOutput: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')

      const stderrText = stderrOutput.join('')

      // #then: the "Matched files:" header is present
      expect(stderrText).toContain('Matched files:')

      // #then: the private token does NOT appear literally in stderr
      expect(stderrText).not.toContain('synth_private')
      expect(stderrText).not.toContain('synth-owner--synth_private')
      expect(stderrText).not.toContain('synth-owner/synth_private')

      // #then: the redaction marker IS present (path was redacted, not dropped)
      expect(stderrText).toContain('[REDACTED]')
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// FIX 3 (correctness) — regex-metachar token redacted literally, not as pattern
// ---------------------------------------------------------------------------

describe('redactPathTokens — regex-metachar token (FIX 3)', () => {
  // redactPathTokens is not exported; exercise via runPromotionScan which calls it
  // on matched file paths before returning them.

  it('redacts a token containing regex metacharacters literally without throwing', async () => {
    // #given: a synthetic owner/name that produces regex metacharacters in the slug.
    // "a.c/d+e" → raw double-dash form "a.c--d+e" contains '.' and '+' which are regex metacharacters.
    // The redaction must treat them as literals, not regex operators.
    const reposYaml = makeReposYaml(['R_metachar'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_metachar') return {nameWithOwner: 'a.c/d+e'}
      return {error: 'error'}
    }
    // Diff adds a new file whose path contains the raw double-dash form of the token.
    // If '.' or '+' were interpreted as regex metacharacters, the match/redaction would be wrong.
    const diff = [
      'diff --git a/knowledge/wiki/repos/a.c--d+e.md b/knowledge/wiki/repos/a.c--d+e.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/knowledge/wiki/repos/a.c--d+e.md',
      '@@ -0,0 +1 @@',
      '+Some content',
    ].join('\n')

    // #when: runPromotionScan is called — must not throw a regex error
    let result: Awaited<ReturnType<typeof runPromotionScan>>
    expect(() => {
      result = undefined as unknown as typeof result
    }).not.toThrow()

    result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: the literal path is detected (not a regex false-negative)
    expect(result.ok).toBe(false)

    if (!result.ok && 'matchedFiles' in result) {
      for (const file of result.matchedFiles) {
        // The literal token must be redacted, not left as-is or partially matched
        expect(file).not.toContain('a.c--d+e')
        expect(file).toContain('[REDACTED]')
      }
    }
  })

  it('does not match unrelated paths when token contains regex metacharacters', async () => {
    // #given: token "a.c/d+e" — the '.' would match any char and '+' is a quantifier if unescaped.
    // A path like "axc--dde.md" should NOT be matched (only the literal "a.c--d+e" should match).
    const reposYaml = makeReposYaml(['R_metachar_no_false_pos'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_metachar_no_false_pos') return {nameWithOwner: 'a.c/d+e'}
      return {error: 'error'}
    }
    // Diff adds a file whose path would match if '.' and '+' were regex metacharacters,
    // but should NOT match because the literal token is different.
    const diff = makePromoDiff('knowledge/wiki/repos/axc--dde.md', ['Some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // #then: no match — the path does not contain the literal token
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Finding F: regression-lock tests for Finding A (access-lost fail-closed in PR mode)
// and Finding B (head-SHA moved → fail-closed)
// ---------------------------------------------------------------------------

describe('main() — Finding A regression lock: access-lost in PR mode → fail-closed', () => {
  it('fails closed (process.exit(1)) when resolver returns access-lost without operator override', async () => {
    // #given: workflow_run payload; resolver returns access-lost for the private node_id
    // This is the critical regression lock: if access-lost goes back to being skipped,
    // this test must fail.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-access-lost'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-access-lost'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_access_lost_pr'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        // resolver: returns access-lost (simulate mis-scoped/expired PAT)
        return JSON.stringify({data: {node: null}, errors: [{type: 'NOT_FOUND'}]})
      })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs with an access-lost resolver result
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      // #then: process.exit(1) was called — fail closed
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: stderr mentions BLOCKING (not "skipping")
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('BLOCKING')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('proceeds (no exit) when access-lost occurs AND operator override is active', async () => {
    // #given: workflow_run payload; resolver returns access-lost; operator override is active
    // Parity with the existing failedNodeIds override test.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-access-lost-override'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({
        number: 42,
        headSha: 'sha-access-lost-override',
        title: '[allow-private-leak] operator override',
        author: 'marcusrbrown',
      }),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_access_lost_override'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        // resolver: returns access-lost
        return JSON.stringify({data: {node: null}, errors: [{type: 'NOT_FOUND'}]})
      })
      .mockReturnValueOnce(makeCompareJson()) // fetchDiffForSha: compare JSON (truncation check)
      .mockReturnValueOnce('') // fetchDiffForSha: raw diff → empty (no leak)

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs with access-lost + operator override
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called — operator override allows proceeding
      expect(exitSpy).not.toHaveBeenCalled()
      // #then: override was logged
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('operator override active')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — Finding B regression lock: diff pinned to immutable scannedHeadSha (no TOCTOU)', () => {
  it('scans the diff for the scanned SHA even when the PR head has since moved (force-push)', async () => {
    // #given: workflow_run payload with headSha='sha-scanned-b'; a force-push has since moved
    // the PR head to 'sha-moved'. With the old revalidation approach this would fail-closed.
    // With the new pinned-SHA approach, main() fetches the diff for 'sha-scanned-b' (immutable)
    // and proceeds — the status is posted to 'sha-scanned-b' and the diff is for that exact SHA.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-scanned-b'})
    // readWorkflowRunContext calls fetchPrByNumber once (returns sha-scanned-b → validates OK).
    // No second revalidation call — the pinned-SHA approach eliminates it.
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-scanned-b'}),
    })

    // Capture which SHA the compare-API diff call uses.
    const capturedCompareArgs: string[] = []
    mockExecFileSync.mockReset()
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      // gh repo view
      if (cmd === 'gh' && args[0] === 'repo') return 'fro-bot/.github'
      // fetchPrivateNodeIds
      if (cmd === 'gh' && args[0] === 'api' && String(args[1]).includes('/contents/')) {
        return makeYamlBase64(['R_sha_moved'])
      }
      // resolver
      if (cmd === 'gh' && args[0] === 'api' && args[1] === 'graphql') {
        return JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})
      }
      // fetchDiffForSha: gh api repos/.../compare/main...{sha}
      // Two calls: first is the JSON truncation check (no -H header), second is the raw diff.
      if (cmd === 'gh' && args[0] === 'api' && String(args[1]).includes('/compare/')) {
        capturedCompareArgs.push(String(args[1]))
        // If the call includes the diff Accept header, return the raw diff.
        // Otherwise return the JSON truncation-check response.
        if (args.includes('-H') && args.some(a => String(a).includes('application/vnd.github'))) {
          return makeDiff('docs/public.md', ['some public content'])
        }
        return makeCompareJson('docs/public.md')
      }
      return ''
    })

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs — even though the PR head has "moved" (no revalidation), it proceeds
      await main(makeWorkflowRunReader(eventJson), prApiResolver)

      // #then: no exit called — the scan passed (diff is clean)
      expect(exitSpy).not.toHaveBeenCalled()

      // #then: the compare-API diff call used the scanned SHA (immutable), not any "current" head
      expect(capturedCompareArgs.length).toBeGreaterThan(0)
      for (const compareArg of capturedCompareArgs) {
        // The compare endpoint must reference the scanned SHA, not 'sha-moved'
        expect(compareArg).toContain('sha-scanned-b')
        expect(compareArg).not.toContain('sha-moved')
      }
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — Finding F: pull_requests[] with two validating PRs → fail-closed', () => {
  it('fails closed when pull_requests[] contains two PRs that both pass validation', async () => {
    // #given: workflow_run payload with two abbreviated PR entries (numbers 10 and 11).
    // fetchPrByNumber returns a valid full PR for BOTH numbers → exactly-one guard triggers.
    const eventJson = JSON.stringify({
      workflow_run: {
        event: 'pull_request',
        head_sha: 'sha-two-prs',
        // Abbreviated entries — only numbers are extracted; full objects fetched via fetchPrByNumber.
        pull_requests: [
          {
            number: 10,
            head: {
              sha: 'sha-two-prs',
              repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
            },
            base: {
              ref: 'main',
              repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
            },
          },
          {
            number: 11,
            head: {
              sha: 'sha-two-prs',
              repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
            },
            base: {
              ref: 'main',
              repo: {name: '.github', id: 12345, url: 'https://api.github.com/repos/fro-bot/.github'},
            },
          },
        ],
      },
    })
    // fetchPrByNumber returns a valid full PR for any number — both 10 and 11 pass validation.
    const prApiResolver: PrApiResolver = {
      fetchPrByNumber: async (num: number) => makePrApiResponse({number: num, headSha: 'sha-two-prs'}),
      fetchPrsByHeadSha: async () => [],
    }

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs with two validating PRs
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      // #then: fail closed — exactly-one guard triggered (2 valid, not 1)
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })
})

// ---------------------------------------------------------------------------
// FIX 1 (P1, fail-open): compare-API diff truncation must fail closed
// Regression lock: a compare response at the 300-file cap (or a file with a
// dropped patch) must cause the gate to fail closed (throw), never silently pass.
// ---------------------------------------------------------------------------

describe('assertCompareNotTruncated — truncation detection (FIX 1, P1)', () => {
  // Scenario: files.length exactly at the 300-file cap → fail closed
  it('throws when files.length is exactly 300 (at the API cap)', () => {
    // #given: a compare JSON response with exactly 300 files, each with a patch field
    const files = Array.from({length: 300}, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      patch: `@@ -1 +1 @@\n-old\n+new`,
    }))
    const compareJson = {total_commits: 1, files}

    // #when / #then: throws because files.length >= 300 (the cap)
    expect(() => assertCompareNotTruncated(compareJson)).toThrow(
      /diff too large to scan completely.*300.*file.*cap.*fail closed/i,
    )
  })

  // Scenario: files.length above the cap → fail closed
  it('throws when files.length exceeds 300', () => {
    // #given: 301 files (impossible in practice but validates the >= check)
    const files = Array.from({length: 301}, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      patch: `@@ -1 +1 @@\n-old\n+new`,
    }))
    const compareJson = {total_commits: 1, files}

    expect(() => assertCompareNotTruncated(compareJson)).toThrow(/fail closed/i)
  })

  // Scenario: a file is missing its patch field (JSON omits it for large files) → NOT a truncation signal
  it('does not throw when a file entry is missing its patch field (JSON omission is not truncation)', () => {
    // #given: two files, the second has no patch — GitHub omits `patch` in JSON for large files,
    // but the raw diff media response always includes the full content and is the actual scan source.
    const compareJson = {
      total_commits: 1,
      files: [
        {filename: 'small-file.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'},
        {filename: 'huge-file.ts', status: 'modified'}, // patch absent in JSON — raw diff has it
      ],
    }

    // #when / #then: does NOT throw — missing JSON patch is not a truncation signal.
    // fetchDiffForSha will fetch the raw diff which includes the full patch content.
    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow()
  })

  // Scenario: first file missing patch → still not a truncation signal
  it('does not throw when the first file entry is missing its patch field', () => {
    const compareJson = {
      total_commits: 1,
      files: [
        {filename: 'huge-first.ts', status: 'added'}, // no patch in JSON
        {filename: 'normal.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'},
      ],
    }

    // Missing JSON patch is not fatal — raw diff fetch covers it.
    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow()
  })

  // Scenario: well-formed response under the cap → does NOT throw
  it('does not throw for a well-formed response with fewer than 300 files', () => {
    // #given: 5 files, all with patch fields
    const files = Array.from({length: 5}, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      patch: `@@ -1 +1 @@\n-old\n+new`,
    }))
    const compareJson = {total_commits: 1, files}

    // #when / #then: no throw — response is complete
    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow()
  })

  // Scenario: empty files array → does NOT throw (zero-file diff is valid)
  it('does not throw for an empty files array (zero-file diff)', () => {
    const compareJson = {total_commits: 0, files: []}

    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow()
  })

  // Scenario: non-object JSON → fail closed
  it('throws when compareJson is not an object', () => {
    expect(() => assertCompareNotTruncated('not an object')).toThrow(/non-object JSON.*fail closed/i)
    expect(() => assertCompareNotTruncated(null)).toThrow(/non-object JSON.*fail closed/i)
    expect(() => assertCompareNotTruncated(42)).toThrow(/non-object JSON.*fail closed/i)
  })

  // Scenario: missing files array → fail closed
  it('throws when compareJson is missing the files array', () => {
    expect(() => assertCompareNotTruncated({total_commits: 1})).toThrow(/missing files array.*fail closed/i)
    expect(() => assertCompareNotTruncated({total_commits: 1, files: 'not-an-array'})).toThrow(
      /missing files array.*fail closed/i,
    )
  })

  // Scenario: 299 files all with patches → does NOT throw (one below the cap)
  it('does not throw for 299 files all with patch fields (one below the cap)', () => {
    const files = Array.from({length: 299}, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      patch: `@@ -1 +1 @@\n-old\n+new`,
    }))
    const compareJson = {total_commits: 1, files}

    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// FIX 1 (P1): main() fails closed when compare JSON signals truncation
// Integration: the truncation check is wired into fetchDiffForSha which is
// called by main(). Verify that a truncated compare response causes process.exit(1).
// ---------------------------------------------------------------------------

describe('main() — FIX 1 (P1): truncation in compare JSON → fail closed', () => {
  it('fails closed (process.exit(1)) when compare JSON has files.length at the 300-file cap', async () => {
    // #given: workflow_run payload; compare JSON returns 300 files (truncated)
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-truncated-300'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-truncated-300'}),
    })

    // Build a compare JSON with 300 files (all with patches — the cap itself is the signal)
    const truncatedFiles = Array.from({length: 300}, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      patch: `@@ -1 +1 @@\n-old\n+new`,
    }))
    const truncatedCompareJson = JSON.stringify({total_commits: 1, files: truncatedFiles})

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_trunc_300'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(truncatedCompareJson) // fetchDiffForSha: compare JSON (truncated)
    // Note: the raw diff fetch is NOT reached — truncation throws before it

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    mockAppendFileSync.mockReset()
    try {
      // #when: main() runs with a truncated compare response
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      // #then: fail closed — process.exit(1) was called
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: stderr mentions the truncation (not a private name)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toMatch(/diff too large|truncat|fail closed/i)
      // #then: scan_result is the literal 'error' from the fetchDiffForSha-throws catch, not an
      // emptied StringLiteral mutant.
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=error\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockExecFileSync.mockReset()
      mockAppendFileSync.mockReset()
    }
  })

  it('proceeds and scans raw diff when compare JSON has a file with no patch field', async () => {
    // #given: workflow_run payload; compare JSON has a file with no patch (JSON omits it for large files).
    // The raw diff media response always includes the full content — it is the actual scan source.
    // A missing JSON patch is NOT a truncation signal and must not cause a false failure.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-patch'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-no-patch'}),
    })

    // Compare JSON: one file has no patch (JSON omission for large file), file count is under cap.
    const compareJsonWithMissingPatch = JSON.stringify({
      total_commits: 1,
      files: [
        {filename: 'normal.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'},
        {filename: 'huge-binary.bin', status: 'modified'}, // patch absent in JSON — raw diff has it
      ],
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_no_patch'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(compareJsonWithMissingPatch) // fetchDiffForSha: compare JSON (missing patch — not fatal)
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff (scanned)

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs with a compare response that has a file missing its JSON patch
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called — missing JSON patch is not fatal; raw diff was fetched and scanned
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('proceeds and detects private token in raw diff even when compare JSON patch is absent', async () => {
    // #given: compare JSON has a file with no patch; raw diff contains a private token in added lines.
    // This proves the raw diff is scanned (not the JSON patch) and the gate still catches leaks.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-patch-leak'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-no-patch-leak'}),
    })

    const compareJsonWithMissingPatch = JSON.stringify({
      total_commits: 1,
      files: [
        {filename: 'docs/leak.md', status: 'modified'}, // patch absent in JSON
      ],
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_no_patch_leak'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(compareJsonWithMissingPatch) // fetchDiffForSha: compare JSON (missing patch)
      .mockReturnValueOnce(makeDiff('docs/leak.md', ['See acme/private-repo for details.'])) // raw diff has the leak

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs — raw diff is scanned and the private token is detected
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      // #then: fail closed because the raw diff contains a private token
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: the matched file path appears in stderr (not the private name)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('docs/leak.md')
      expect(stderrText).not.toContain('acme/private-repo')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('proceeds normally when compare JSON is well-formed and under the cap', async () => {
    // #given: workflow_run payload; compare JSON has 2 files, all with patches
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-not-truncated'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-not-truncated'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_not_trunc'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(makeCompareJson('docs/public.md')) // fetchDiffForSha: compare JSON (ok)
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #when: main() runs with a well-formed compare response
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      // #then: no exit called — scan passed
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — Finding F: malformed PR details → fail-closed', () => {
  it('fails closed when fetchPrByNumber returns a PR missing the title field', async () => {
    // #given: workflow_run payload; fetchPrByNumber returns a PR with no title
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-title'})
    const prApiResolver = makePrApiResolver({
      prByNumber: {
        number: 42,
        // title intentionally omitted
        user: {login: 'some-user'},
        head: {sha: 'sha-no-title', repo: {full_name: 'fro-bot/.github'}},
        base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
      },
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })

  it('fails closed when fetchPrByNumber returns a PR missing user.login', async () => {
    // #given: workflow_run payload; fetchPrByNumber returns a PR with no user.login
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-login'})
    const prApiResolver = makePrApiResolver({
      prByNumber: {
        number: 42,
        title: 'some PR',
        // user intentionally omitted
        head: {sha: 'sha-no-login', repo: {full_name: 'fro-bot/.github'}},
        base: {ref: 'main', repo: {full_name: 'fro-bot/.github'}},
      },
    })

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
    }
  })
})

// ---------------------------------------------------------------------------
// fetchPrivateNodeIds — data-absent fallback (Oracle-specified tests)
// ---------------------------------------------------------------------------

/**
 * Build a minimal repos.yaml string for main-branch fallback tests.
 * Uses the same format as makeReposYaml but for the local-file reader.
 */
function makeMainReposYaml(nodeIds: string[]): string {
  if (nodeIds.length === 0) {
    return 'version: 1\nrepos: []\n'
  }
  const entries = nodeIds
    .map(
      (id, i) =>
        `  - owner: "[REDACTED]"\n    name: repo-${i}\n    private: true\n    node_id: ${id}\n    added: "2024-01-01"\n    onboarding_status: onboarded\n    last_survey_at: null\n    last_survey_status: null\n    has_fro_bot_workflow: false\n    has_renovate: false`,
    )
    .join('\n')
  return `version: 1\nrepos:\n${entries}\n`
}

/**
 * Build a fake DataBranchChecker that returns a fixed value or throws.
 */
function makeDataBranchChecker(opts: {exists?: boolean; throws?: Error} = {}): DataBranchChecker {
  return (_fullName: string): boolean => {
    if (opts.throws !== undefined) throw opts.throws
    return opts.exists ?? false
  }
}

/**
 * Build a fake MainReposYamlReader that returns fixed content or throws.
 */
function makeMainReposYamlReader(content: string): MainReposYamlReader {
  return (_path: string): string => content
}

/**
 * Build a fake execFileSync mock sequence for the data-absent fallback tests.
 *
 * The mock sequence for main() in the 404-fallback scenario:
 * 1. gh repo view → fullName
 * 2. gh api repos/.../contents/metadata/repos.yaml?ref=data → throws 404 (fetchPrivateNodeIds)
 * 3. (dataBranchChecker is injectable — no execFileSync call)
 * 4. (mainReposYamlReader is injectable — no execFileSync call)
 * 5. gh graphql → resolver call(s)
 * 6. gh api compare JSON → fetchDiffForSha truncation check
 * 7. gh api compare diff → fetchDiffForSha raw diff
 */
function make404Error(): Error {
  return Object.assign(new Error('gh: Not Found (HTTP 404)'), {
    stdout: '{"status":"404"}',
    stderr: 'gh: Not Found (HTTP 404)',
  })
}

describe('extractPrivateNodeIds — filter predicate discrimination (via fetchPrivateNodeIds)', () => {
  it('includes only entries where private===true AND node_id is a non-empty string', async () => {
    const mixedYaml = [
      'version: 1',
      'repos:',
      '  - owner: "a"',
      '    name: included',
      '    private: true',
      '    node_id: R_included',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '  - owner: "b"',
      '    name: not-private',
      '    private: false',
      '    node_id: R_not_private',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '  - owner: "c"',
      '    name: missing-node-id',
      '    private: true',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '',
    ].join('\n')
    const encoded = Buffer.from(mixedYaml).toString('base64')

    const eventJson = makeWorkflowRunEvent({headSha: 'sha-extract-filter'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-extract-filter'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(encoded)
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/included-repo'}}}))
      .mockReturnValueOnce(makeCompareJson())
      .mockReturnValueOnce('')

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: exactly ONE resolver call (for R_included) — the other two entries were filtered
      // out (private===false, and node_id omitted entirely, respectively — assertReposFile itself
      // rejects an empty-string node_id, so "present but empty" cannot reach this filter; "absent"
      // is the real excluded shape). If either half of the `&&` were dropped or swapped to `||`, a
      // different set of entries would be resolved and the resolver graphql call count would diverge
      // from exactly 1.
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const graphqlCalls = calls.filter(c => c[1][1] === 'graphql')
      expect(graphqlCalls).toHaveLength(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

describe('main() — fetchPrivateNodeIds: data-absent fallback (Oracle-specified tests)', () => {
  // Test 1: data content 404 + data ref ABSENT + main has a private node_id whose name
  // appears in the PR diff added lines ⇒ gate FAILS (catches the leak via main fallback).
  it('Test 1: data 404 + branch absent + main has private entry matching diff → gate FAILS', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-1'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-1'})})

    // data branch absent → fall back to main which has one private node_id
    const dataBranchChecker = makeDataBranchChecker({exists: false})
    const mainReposYamlReader = makeMainReposYamlReader(makeMainReposYaml(['R_main_private']))

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404
      // dataBranchChecker is injectable — no execFileSync call
      // mainReposYamlReader is injectable — no execFileSync call
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-leak-repo'}}})) // resolver R_main_private
      .mockReturnValueOnce(makeCompareJson('docs/leak.md')) // fetchDiffForSha: compare JSON
      .mockReturnValueOnce(makeDiff('docs/leak.md', ['See acme/private-leak-repo for details.'])) // fetchDiffForSha: raw diff

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: gate FAILS — leak detected via main fallback
      await expect(
        main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader),
      ).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)

      // #then: fallback warning was emitted
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('data branch absent')
      // #then: private name NOT in stderr (redacted)
      expect(stderrText).not.toContain('acme/private-leak-repo')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  // Test 2: data content 404 + data ref ABSENT + main has ZERO private entries ⇒ gate PASSES.
  it('Test 2: data 404 + branch absent + main has zero private entries → gate PASSES', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-2'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-2'})})

    // data branch absent → fall back to main which has NO private entries
    const dataBranchChecker = makeDataBranchChecker({exists: false})
    const mainReposYamlReader = makeMainReposYamlReader(makeMainReposYaml([]))

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: gate PASSES — no private entries in main
      await main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  // Test 3: data content 404 + data ref EXISTS + retry still 404 ⇒ FAIL CLOSED.
  it('Test 3: data 404 + branch exists + retry still 404 → FAIL CLOSED', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-3'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-3'})})

    // data branch EXISTS but content is 404 (create/race) → retry also 404
    const dataBranchChecker = makeDataBranchChecker({exists: true})
    const mainReposYamlReader = makeMainReposYamlReader(makeMainReposYaml(['R_should_not_be_used']))

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404 (first attempt)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404 (retry)

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: FAIL CLOSED — branch exists but file missing after retry
      await expect(
        main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader),
      ).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: the EXACT retry-failure message fired — if the retry's catch block were emptied
      // (BlockStatement mutant), `retryEncoded` would stay `undefined` and
      // `retryEncoded.replaceAll(...)` would throw a DIFFERENT, unrelated TypeError instead, which
      // main()'s outer catch also turns into exit(1) but with different stderr text.
      expect(stderrOutput.join('')).toContain(
        'data branch exists but metadata/repos.yaml is missing/corrupt after retry — fail closed',
      )
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  // Test 4: data content 403 / 500 / network / rate-limit ⇒ FAIL CLOSED (no main fallback).
  it('Test 4: data content 403/500/network/rate-limit → FAIL CLOSED (no main fallback)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-4'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-4'})})

    // dataBranchChecker should NOT be called for non-404 errors
    let dataBranchCheckerCalled = false
    const dataBranchChecker: DataBranchChecker = (_fullName: string): boolean => {
      dataBranchCheckerCalled = true
      return false
    }
    const mainReposYamlReader = makeMainReposYamlReader(makeMainReposYaml(['R_should_not_be_used']))

    // Test with a 403 error (not a 404)
    const error403 = Object.assign(new Error('gh: Forbidden (HTTP 403)'), {
      stdout: '{"status":"403"}',
      stderr: 'gh: Forbidden (HTTP 403)',
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw error403
      }) // fetchPrivateNodeIds: 403 (not 404)

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    mockAppendFileSync.mockReset()
    try {
      // #then: FAIL CLOSED — non-404 error, no main fallback
      await expect(
        main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader),
      ).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: dataBranchChecker was NOT called (non-404 path skips branch check)
      expect(dataBranchCheckerCalled).toBe(false)
      // #then: the exact fetchPrivateNodeIds-throws message and scan_result fired.
      expect(stderrOutput.join('')).toContain('check-private-leak: failed to fetch private node_ids — fail closed')
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=error\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockExecFileSync.mockReset()
      mockAppendFileSync.mockReset()
    }
  })

  // Test 5: data content 404 + ref-existence check itself returns 500/network ⇒ FAIL CLOSED.
  it('Test 5: data 404 + branch-existence check throws (500/network) → FAIL CLOSED', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-5'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-5'})})

    // dataBranchChecker throws (simulating 500/network error)
    const dataBranchChecker = makeDataBranchChecker({throws: new Error('network error checking branch')})
    const mainReposYamlReader = makeMainReposYamlReader(makeMainReposYaml(['R_should_not_be_used']))

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: FAIL CLOSED — branch existence check failed
      await expect(
        main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader),
      ).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  // Test 1b (regression lock): fallback warning must NOT leak the repo name or fullName.
  // Uses 'fro-bot/.github' as the fullName and a private entry with a recognizable owner/name.
  // Asserts the warning is identifier-free — locks the redaction guarantee.
  it('Test 1b: fallback warning is identifier-free (does not contain fullName or private repo name)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-1b'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-1b'})})

    // data branch absent → fall back to main which has one private entry with a recognizable name
    const dataBranchChecker = makeDataBranchChecker({exists: false})
    // Build a repos.yaml with a private entry whose owner/name is clearly identifiable
    const privateRepoOwner = 'fro-bot'
    const privateRepoName = 'super-secret-private-repo'
    const mainReposYaml = [
      'version: 1',
      'repos:',
      `  - owner: "${privateRepoOwner}"`,
      `    name: "${privateRepoName}"`,
      '    private: true',
      '    node_id: R_redaction_lock',
      '    added: "2024-01-01"',
      '    onboarding_status: onboarded',
      '    last_survey_at: null',
      '    last_survey_status: null',
      '    has_fro_bot_workflow: false',
      '    has_renovate: false',
      '',
    ].join('\n')
    const mainReposYamlReader = makeMainReposYamlReader(mainReposYaml)

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404
      // dataBranchChecker is injectable — no execFileSync call
      // mainReposYamlReader is injectable — no execFileSync call
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: `${privateRepoOwner}/${privateRepoName}`}}})) // resolver R_redaction_lock
      .mockReturnValueOnce(makeCompareJson('docs/leak.md')) // fetchDiffForSha: compare JSON
      .mockReturnValueOnce(makeDiff('docs/leak.md', [`See ${privateRepoOwner}/${privateRepoName} for details.`])) // fetchDiffForSha: raw diff

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: gate FAILS — leak detected via main fallback
      await expect(
        main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader),
      ).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)

      // #then: fallback warning was emitted
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('data branch absent')

      // #then: warning is identifier-free — does NOT contain the private repo name
      expect(stderrText).not.toContain(`${privateRepoOwner}/${privateRepoName}`)
      // #then: warning does NOT contain the fullName ('fro-bot/.github')
      expect(stderrText).not.toContain('fro-bot/.github')
      // #then: warning does NOT contain the private repo owner alone
      expect(stderrText).not.toContain(privateRepoName)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  // Test 6: Race: first content 404, ref exists, retry SUCCEEDS ⇒ uses data node_ids.
  it('Test 6: data 404 + branch exists + retry succeeds → uses data node_ids (race win)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fallback-6'})

    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fallback-6'})})

    // data branch EXISTS → retry succeeds with data content
    const dataBranchChecker = makeDataBranchChecker({exists: true})
    // mainReposYamlReader should NOT be called (retry succeeded)
    let mainReaderCalled = false
    const mainReposYamlReader: MainReposYamlReader = (_path: string): string => {
      mainReaderCalled = true
      return makeMainReposYaml(['R_should_not_be_used'])
    }

    // Retry returns data content with a different node_id than main would have
    const dataNodeId = 'R_data_race_win'
    const retryBase64 = makeYamlBase64([dataNodeId])

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content 404 (first attempt)
      .mockReturnValueOnce(retryBase64) // fetchPrivateNodeIds: retry succeeds with data content
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/data-race-repo'}}})) // resolver R_data_race_win
      .mockReturnValueOnce(makeCompareJson('docs/public.md')) // fetchDiffForSha: compare JSON
      .mockReturnValueOnce(makeDiff('docs/public.md', ['some public content'])) // fetchDiffForSha: raw diff

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      // #then: gate PASSES — retry succeeded, data node_ids used
      await main(makeWorkflowRunReader(eventJson), prApiResolver, dataBranchChecker, mainReposYamlReader)
      expect(exitSpy).not.toHaveBeenCalled()
      // #then: main fallback was NOT used
      expect(mainReaderCalled).toBe(false)
      // #then: both the first attempt and the retry hit the exact documented content endpoint.
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const contentCalls = calls.filter(c => String(c[1][1]).includes('contents/metadata/repos.yaml?ref=data'))
      expect(contentCalls).toHaveLength(2)
      for (const call of contentCalls) {
        expect(call).toEqual([
          'gh',
          ['api', 'repos/fro-bot/.github/contents/metadata/repos.yaml?ref=data', '--jq', '.content'],
          {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: largeOutputMaxBufferBytes()},
        ])
      }
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// isGh404Error — direct unit tests for 404-detection regex logic
// ---------------------------------------------------------------------------

describe('CLI self-invoke guard (import.meta.url === file://<argv[1]>)', () => {
  // The guard at the bottom of the module only differs from a real invocation when the module is
  // run directly (`node check-private-leak.ts`), not imported by a test. Every other test in this
  // file imports the module without ever setting process.argv[1] to its own path, so the `false`
  // branch of every mutator variant here is trivially exercised (real code and every mutant behave
  // identically when the condition is never true) -- that is NOT sufficient to kill the mutants;
  // a genuine discriminating test must make the condition true for the *real* code and observe
  // main()/runPromotionCli() actually run. Cache-busts the dynamic import (unique query string) so
  // the module's top-level code re-executes with the manipulated argv, rather than returning the
  // already-cached module instance from every earlier `import` in this file.
  it("invokes main() when process.argv[1] matches the module's own path and --promotion is absent", async () => {
    const modulePath = new URL('./check-private-leak.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    delete process.env.GITHUB_EVENT_PATH
    try {
      // #then: the guard fired and called main(), which fails closed on GITHUB_EVENT_PATH being
      // unset -- the exact, unmistakable signature of main() actually running. If the guard's
      // ConditionalExpression/EqualityOperator/StringLiteral mutants forced this branch to never
      // fire, this import would resolve cleanly with no exit call and no stderr message.
      await expect(import(`${modulePath.href}?guard-test-main`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('GITHUB_EVENT_PATH not set')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      delete process.env.GITHUB_EVENT_PATH
    }
  })

  it("invokes runPromotionCli() when process.argv[1] matches the module's own path and --promotion is present", async () => {
    const modulePath = new URL('./check-private-leak.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname, '--promotion']
    delete process.env.FRO_BOT_POLL_PAT
    delete process.env.GITHUB_EVENT_PATH
    try {
      // #then: the guard fired and called runPromotionCli() specifically (not main()) -- asserted
      // via runPromotionCli's own unmistakable message text, distinct from main()'s "GITHUB_EVENT_PATH
      // not set" message. Discriminates the StringLiteral mutant on `'--promotion'` -> `''`: with
      // argv containing '--promotion' but the mutant checking `.includes('')` (always false, argv
      // never contains an empty string), the else branch would wrongly call main() instead --
      // main() would ALSO exit(1) here (GITHUB_EVENT_PATH is also unset), so only the exact message
      // text discriminates which function actually ran.
      await expect(import(`${modulePath.href}?guard-test-promotion`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('FRO_BOT_POLL_PAT not set. This is required for promotion mode')
      expect(stderrText).not.toContain('GITHUB_EVENT_PATH not set')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_EVENT_PATH
    }
  })

  it("does NOT invoke main() when process.argv[1] does not match the module's own path (positive control)", async () => {
    const modulePath = new URL('./check-private-leak.ts', import.meta.url)
    const originalArgv = [...process.argv]

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', '/some/unrelated/entrypoint.js']
    delete process.env.GITHUB_EVENT_PATH
    try {
      // #then: with a non-matching argv[1], the module imports cleanly — no exit call.
      await import(`${modulePath.href}?guard-test-noop`)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
    }
  })
})

describe('isGh404Error()', () => {
  it('detects HTTP 404 via stderr containing "HTTP 404"', () => {
    const error = Object.assign(new Error('gh: Not Found (HTTP 404)'), {
      stderr: 'gh: Not Found (HTTP 404)',
      stdout: '',
    })
    expect(isGh404Error(error)).toBe(true)
  })

  it('detects HTTP 404 via stdout containing "status":"404"', () => {
    const error = Object.assign(new Error('API error'), {
      stderr: '',
      stdout: '{"status":"404","message":"Not Found"}',
    })
    expect(isGh404Error(error)).toBe(true)
  })

  it('does NOT detect 404 for generic "Not Found" without "HTTP 404" in stderr', () => {
    // Must not false-positive on a plain "Not Found" message that lacks the HTTP status token
    const error = Object.assign(new Error('Not Found'), {
      stderr: 'Not Found',
      stdout: '{"message":"Not Found"}',
    })
    expect(isGh404Error(error)).toBe(false)
  })

  it('does NOT detect 404 for HTTP 403 (Forbidden)', () => {
    const error = Object.assign(new Error('gh: Forbidden (HTTP 403)'), {
      stderr: 'gh: Forbidden (HTTP 403)',
      stdout: '{"status":"403"}',
    })
    expect(isGh404Error(error)).toBe(false)
  })

  it('does NOT detect 404 for HTTP 500 (Internal Server Error)', () => {
    const error = Object.assign(new Error('gh: Internal Server Error (HTTP 500)'), {
      stderr: 'gh: Internal Server Error (HTTP 500)',
      stdout: '{"status":"500"}',
    })
    expect(isGh404Error(error)).toBe(false)
  })

  it('does NOT detect 404 when error has no stdout/stderr properties', () => {
    const error = new Error('network timeout')
    expect(isGh404Error(error)).toBe(false)
  })

  it('does NOT detect 404 when error is not a record at all (isRecord() false branch)', () => {
    // A non-object error (e.g. a thrown string) must fall through both isRecord() ternaries to
    // the '' defaults rather than crash on error.stdout/error.stderr property access.
    expect(isGh404Error('plain string throw')).toBe(false)
    expect(isGh404Error(null)).toBe(false)
    expect(isGh404Error(undefined)).toBe(false)
  })

  it('does NOT detect 404 when a non-record value carries stdout/stderr-shaped own properties (ConditionalExpression: `isRecord(error) &&`)', () => {
    // #given: a function is `typeof 'function'`, so isRecord() is false for it — but functions can
    // still carry arbitrary own properties. Forcing the ternary's condition to `true` (dropping
    // the isRecord() guard) would read these function properties directly instead of falling
    // through to the `''` default, flipping the result to a false positive.
    const fakeError = (): void => {
      /* not a real error object */
    }
    Object.assign(fakeError, {stdout: '{"status":"404"}', stderr: 'HTTP 404'})
    expect(isGh404Error(fakeError)).toBe(false)
  })

  it('does NOT detect 404 when stdout/stderr are present but not strings (typeof guard)', () => {
    // isRecord(error) is true here, but error.stdout/error.stderr are numbers, not strings --
    // must fall through to the '' default rather than call .test() on a non-string.
    const error = {stdout: 404, stderr: 404}
    expect(isGh404Error(error)).toBe(false)
  })

  it('does NOT detect 404 when stdout is a record whose typeof-coercion would match (EqualityOperator/ConditionalExpression on the typeof check)', () => {
    // #given: isRecord(error) is true (a plain object), but error.stdout is itself an object
    // (not a string) whose `toString()` happens to render 404-shaped text. If the `typeof
    // error.stdout === 'string'` half of the `&&` were forced to `true` (ignoring the real typeof
    // result), `error.stdout` would be read and coerced by the regex's `.test()`, producing a
    // false positive that a plain non-string value like `404` (see the test above) cannot expose,
    // because `String(404)` never contains the literal `"status"` text.
    const error = {stdout: {toString: () => '"status":"404"'}, stderr: ''}
    expect(isGh404Error(error)).toBe(false)
  })

  it('does NOT detect 404 when stderr is a record whose typeof-coercion would match (EqualityOperator/ConditionalExpression on the typeof check)', () => {
    const error = {stdout: '', stderr: {toString: () => 'HTTP 404'}}
    expect(isGh404Error(error)).toBe(false)
  })

  it('detects "status":"404" in stdout with whitespace on BOTH sides of the colon', () => {
    // Discriminates both /"status"\s*:\S*"404"/ and /"status"\S*:\s*"404"/ from the real
    // /"status"\s*:\s*"404"/: a swapped \S* on either side cannot match a literal space there,
    // so this single payload (space before AND after the colon) fails both mutant variants
    // while the real regex's \s* on both sides matches it.
    const error = Object.assign(new Error('API error'), {
      stderr: '',
      stdout: '{"status" : "404","message":"Not Found"}',
    })
    expect(isGh404Error(error)).toBe(true)
  })
})
// ---------------------------------------------------------------------------
// writeScanResult (via main()) — GITHUB_OUTPUT machine-readable result
// ---------------------------------------------------------------------------

describe('writeScanResult (via main()) — GITHUB_OUTPUT', () => {
  it('appends scan_result=error to GITHUB_OUTPUT when GITHUB_EVENT_PATH is unset', async () => {
    mockAppendFileSync.mockReset()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    delete process.env.GITHUB_EVENT_PATH
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=error\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_OUTPUT
      mockAppendFileSync.mockReset()
    }
  })

  it('does NOT append to GITHUB_OUTPUT when the env var is unset (undefined branch)', async () => {
    mockAppendFileSync.mockReset()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    delete process.env.GITHUB_EVENT_PATH
    delete process.env.GITHUB_OUTPUT
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(mockAppendFileSync).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      mockAppendFileSync.mockReset()
    }
  })

  it('does NOT append to GITHUB_OUTPUT when the env var is the empty string (empty-string branch)', async () => {
    mockAppendFileSync.mockReset()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    delete process.env.GITHUB_EVENT_PATH
    process.env.GITHUB_OUTPUT = ''
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(mockAppendFileSync).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_OUTPUT
      mockAppendFileSync.mockReset()
    }
  })

  it('appends scan_result=success to GITHUB_OUTPUT when there are zero private entries', async () => {
    mockAppendFileSync.mockReset()
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-scanresult-success'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-scanresult-success'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('fro-bot/.github').mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=success\n')
    } finally {
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockExecFileSync.mockReset()
      mockAppendFileSync.mockReset()
    }
  })

  it('appends scan_result=detection to GITHUB_OUTPUT when a private name is found in the PR diff', async () => {
    mockAppendFileSync.mockReset()
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-scanresult-detect'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-scanresult-detect'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64(['R_scanresult_detect']))
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/scanresult-detect'}}}))
      .mockReturnValueOnce(makeCompareJson('docs/leak.md'))
      .mockReturnValueOnce(makeDiff('docs/leak.md', ['See acme/scanresult-detect for details.']))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    process.env.GITHUB_OUTPUT = '/fake/output.txt'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(mockAppendFileSync).toHaveBeenCalledWith('/fake/output.txt', 'scan_result=detection\n')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      delete process.env.GITHUB_OUTPUT
      mockExecFileSync.mockReset()
      mockAppendFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// main() — default seam coverage: the uninjected production path
// ---------------------------------------------------------------------------

describe('main() — default seam coverage (uninjected production defaults)', () => {
  it('runs the full happy path with every seam defaulted (defaultWorkflowRunReader, defaultPrApiResolver)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-seams'})
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValueOnce(eventJson)

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce(JSON.stringify(makePrApiResponse({number: 42, headSha: 'sha-default-seams'})))
      .mockReturnValueOnce(JSON.stringify(makePrApiResponse({number: 42, headSha: 'sha-default-seams'})))
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main()
      expect(exitSpy).not.toHaveBeenCalled()
      // #then: defaultWorkflowRunReader called the real readFile with the 'utf8' encoding — a
      // dropped/emptied encoding arg would return a Buffer instead of a string and JSON.parse
      // would receive the wrong type.
      expect(mockReadFile).toHaveBeenCalledWith('/fake/event.json', 'utf8')
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const pullsCall = calls.find(c => c[1].includes('api') && String(c[1][1]).includes('/pulls/42'))
      expect(pullsCall).toBeDefined()
      expect(pullsCall).toEqual(['gh', ['api', 'repos/{owner}/{repo}/pulls/42', '--jq', '.'], {encoding: 'utf8'}])
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFile.mockReset()
    }
  })

  it('defaultPrApiResolver.fetchPrsByHeadSha is used when pull_requests[] is empty', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-sha-fallback', pullRequests: []})
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValueOnce(eventJson)

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce(JSON.stringify([makePrApiResponse({number: 77, headSha: 'sha-default-sha-fallback'})]))
      .mockReturnValueOnce(JSON.stringify(makePrApiResponse({number: 77, headSha: 'sha-default-sha-fallback'})))
      .mockReturnValueOnce(JSON.stringify(makePrApiResponse({number: 77, headSha: 'sha-default-sha-fallback'})))
      .mockReturnValueOnce('fro-bot/.github')
      .mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main()
      expect(exitSpy).not.toHaveBeenCalled()
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const shaCall = calls.find(c => String(c[1][1]).includes('/commits/sha-default-sha-fallback/pulls'))
      expect(shaCall).toBeDefined()
      expect(shaCall).toEqual([
        'gh',
        ['api', 'repos/{owner}/{repo}/commits/sha-default-sha-fallback/pulls', '--jq', '.'],
        {encoding: 'utf8', maxBuffer: largeOutputMaxBufferBytes()},
      ])
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFile.mockReset()
    }
  })

  it('defaultPrApiResolver.fetchPrByNumber throws TypeError on a non-object gh response', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-nonobj'})
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValueOnce(eventJson)

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('42')

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('fetchPrByNumber returned non-object')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFile.mockReset()
    }
  })

  it('defaultPrApiResolver.fetchPrsByHeadSha throws TypeError on a non-array gh response', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-nonarray', pullRequests: []})
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValueOnce(eventJson)

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({not: 'an array'}))

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('fetchPrsByHeadSha returned non-array')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFile.mockReset()
    }
  })

  it('defaultDataBranchChecker returns false on a 404 and defaultMainReposYamlReader reads the fallback file', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-branch-absent'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-default-branch-absent'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockImplementationOnce(() => {
        throw make404Error()
      })
      .mockImplementationOnce(() => {
        throw make404Error()
      })

    mockReadFileSync.mockReset()
    mockReadFileSync.mockReturnValueOnce(makeMainReposYaml([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(mockReadFileSync).toHaveBeenCalledWith('metadata/repos.yaml', 'utf8')
      // #then: the default branch-existence check hit the exact documented endpoint and options.
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const branchCheckCall = calls.find(c => String(c[1][1]).includes('/branches/data'))
      expect(branchCheckCall).toEqual([
        'gh',
        ['api', 'repos/fro-bot/.github/branches/data'],
        {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']},
      ])
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFileSync.mockReset()
    }
  })

  it('defaultDataBranchChecker re-throws a non-404 error from the branches/data call (BlockStatement/ConditionalExpression)', async () => {
    // #given: content fetch 404s, then the branches/data existence check itself throws a NON-404
    // error (e.g. 500). Discriminates two mutants at once: BlockStatement emptying the catch block
    // (silently returns `undefined` instead of re-throwing) and ConditionalExpression forcing
    // `isGh404Error(error)` to always `true` (misclassifies the 500 as a 404 and returns `false`).
    // Either mutant makes `dataBranchChecker(fullName)` return a falsy value instead of throwing,
    // which `fetchPrivateNodeIds`'s own try/catch never sees, so it takes the "branch absent"
    // fallback path (reads main's repos.yaml) instead of the real "existence check failed" fail
    // -closed path -- these are only distinguishable by which path executes, so the two seams
    // (defaultMainReposYamlReader vs the exit) are the observable signal.
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-branch-check-500'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-default-branch-check-500'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockImplementationOnce(() => {
        throw make404Error()
      }) // fetchPrivateNodeIds: data content fetch — 404
      .mockImplementationOnce(() => {
        const err = new Error('gh: Internal Server Error (HTTP 500)') as Error & {stderr?: string; stdout?: string}
        err.stderr = 'HTTP 500'
        err.stdout = ''
        throw err
      }) // defaultDataBranchChecker: branches/data — non-404 error

    mockReadFileSync.mockReset()

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('data branch existence check failed')
      // #then: the fallback (main checkout read) must NEVER fire — a mutant taking the wrong path
      // would call it instead of failing closed.
      expect(mockReadFileSync).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFileSync.mockReset()
    }
  })

  it('defaultDataBranchChecker returns true when branches/data exists (retry path taken, not fallback)', async () => {
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-default-branch-exists'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-default-branch-exists'}),
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github')
      .mockImplementationOnce(() => {
        throw make404Error()
      })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(makeYamlBase64([]))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      await main(makeWorkflowRunReader(eventJson), prApiResolver)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(mockReadFileSync).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// runPromotionCli — default seam coverage: the uninjected production path
// ---------------------------------------------------------------------------

describe('runPromotionCli — default seam coverage (uninjected production defaults)', () => {
  it('runs the full happy path with every seam defaulted (defaultGitDiffRunner, defaultReposYamlReader, defaultResolverFactory)', async () => {
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValueOnce(makeCliReposYaml(['R_default_cli']))

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce(makePromoDiff('docs/public.md', ['nothing private here']))
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/default-cli-repo'}}}))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const exitCode = await runPromotionCli()
      expect(exitCode).toBe(0)
      const calls = mockExecFileSync.mock.calls as [string, string[], unknown][]
      const gitCall = calls.find(c => c[0] === 'git')
      expect(gitCall?.[1]).toEqual(['diff', 'origin/main...origin/data'])
      // #then: the git call's options object carried the real encoding/env/maxBuffer, not an
      // emptied `{}`.
      const gitOptions = gitCall?.[2] as {encoding?: string; env?: unknown; maxBuffer?: number} | undefined
      expect(gitOptions?.encoding).toBe('utf8')
      expect(gitOptions?.env).toBeDefined()
      expect(gitOptions?.maxBuffer).toBe(largeOutputMaxBufferBytes())
    } finally {
      vi.restoreAllMocks()
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFile.mockReset()
    }
  })

  it("defaultReposYamlReader calls the real readFile with the 'utf8' encoding", async () => {
    mockReadFile.mockReset()
    mockReadFile.mockResolvedValueOnce(makeCliReposYaml([]))

    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce(makePromoDiff('docs/public.md', ['nothing private here']))

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const exitCode = await runPromotionCli()
      expect(exitCode).toBe(0)
      expect(mockReadFile).toHaveBeenCalledWith('metadata/repos.yaml', 'utf8')
    } finally {
      vi.restoreAllMocks()
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
      mockReadFile.mockReset()
    }
  })

  it('defaultReposYamlReader propagates a read failure from PROMOTION_REPOS_YAML_PATH', async () => {
    mockReadFile.mockReset()
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'))

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const exitCode = await runPromotionCli()
      expect(exitCode).toBe(1)
      expect(stderrOutput.join('')).toContain('could not read repos.yaml')
    } finally {
      vi.restoreAllMocks()
      delete process.env.FRO_BOT_POLL_PAT
      mockReadFile.mockReset()
    }
  })
})
