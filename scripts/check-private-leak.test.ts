import type {
  GitDiffRunner,
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
  const entries = nodeIds
    .map(
      (id, i) =>
        `  - owner: "[REDACTED]"\n    name: repo-${i}\n    private: true\n    node_id: ${id}\n    added: "2024-01-01"\n    onboarding_status: onboarded\n    last_survey_at: null\n    last_survey_status: null\n    has_fro_bot_workflow: false\n    has_renovate: false`,
    )
    .join('\n')
  return Buffer.from(`version: 1\nrepos:\n${entries}\n`).toString('base64')
}

describe('main() — fail-closed and no-name-leak (FIX #1, FIX #4)', () => {
  it('exits non-zero (fail-closed) when one node_id resolves and one fails — private name NOT in stderr', async () => {
    // #given: two private node_ids; one resolves, one fails
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-fix1-a'})
    const prApiResolver = makePrApiResolver({prByNumber: makePrApiResponse({number: 42, headSha: 'sha-fix1-a'})})
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_ok', 'R_fail'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // R_ok
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('gh failed'), {stderr: 'Bad credentials\n'})
      }) // R_fail

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

      // #then: failing node_id appears in stderr
      expect(stderrText).toContain('R_fail')

      // #then: the resolved private name 'acme/private-repo' does NOT appear anywhere
      expect(stderrText).not.toContain('acme/private-repo')
      expect(stderrText).not.toContain('acme')
      expect(stderrText).not.toContain('private-repo')

      // #then: exit was called with 1 (fail-closed)
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
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

  it('passes with bypass log when operator override is active and resolution fails', async () => {
    // #given: operator override active + one node_id fails
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
      .mockReturnValueOnce(makeYamlBase64(['R_y'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        throw new Error('outage')
      }) // resolver R_y — fails
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

      // #then: bypass was logged with node_id reference
      const stderrText = stderrOutput.join('')
      expect(stderrText).toContain('R_y')
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

  it('returns 1 when repos.yaml cannot be read', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        reposYamlThrows: new Error('ENOENT: no such file'),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('returns 1 when git diff fails', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: [],
        gitThrows: new Error('git: not a git repository'),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(1)
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      vi.restoreAllMocks()
    }
  })

  it('returns 0 when all node_ids resolve and diff is clean', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.FRO_BOT_POLL_PAT = 'test-pat'
    try {
      const {gitDiffRunner, reposYamlReader, resolverFactory} = makeSeams({
        nodeIds: ['R_clean'],
        resolverResult: async () => ({nameWithOwner: 'acme/private-repo'}),
        diffOutput: makePromoDiff('docs/public.md', ['some public content']),
      })
      const exitCode = await runPromotionCli(gitDiffRunner, reposYamlReader, resolverFactory)

      expect(exitCode).toBe(0)
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
      // #then: no exit called (override honored)
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

// ---------------------------------------------------------------------------
// FIX 1 (token coverage) — buildTokensForName raw double-dash form
// ---------------------------------------------------------------------------

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

  // Scenario: a file is missing its patch field (individually too large) → fail closed
  it('throws when any file entry is missing its patch field', () => {
    // #given: two files, the second has no patch (API omits it for very large files)
    const compareJson = {
      total_commits: 1,
      files: [
        {filename: 'small-file.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'},
        {filename: 'huge-file.ts', status: 'modified'}, // patch intentionally absent
      ],
    }

    // #when / #then: throws because a file has no patch — and the filename is NOT echoed
    // (a path could embed a private slug; the message stays redacted).
    expect(() => assertCompareNotTruncated(compareJson)).toThrow(/file patch was omitted.*fail closed/i)
    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow(/huge-file\.ts/)
  })

  // Scenario: first file missing patch → fail closed (order doesn't matter)
  it('throws when the first file entry is missing its patch field', () => {
    const compareJson = {
      total_commits: 1,
      files: [
        {filename: 'huge-first.ts', status: 'added'}, // no patch
        {filename: 'normal.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'},
      ],
    }

    // Throws on the missing-patch signal without echoing the filename.
    expect(() => assertCompareNotTruncated(compareJson)).toThrow(/file patch was omitted.*fail closed/i)
    expect(() => assertCompareNotTruncated(compareJson)).not.toThrow(/huge-first\.ts/)
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
    try {
      // #when: main() runs with a truncated compare response
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      // #then: fail closed — process.exit(1) was called
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: stderr mentions the truncation (not a private name)
      const stderrText = stderrOutput.join('')
      expect(stderrText).toMatch(/diff too large|truncat|fail closed/i)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      delete process.env.FRO_BOT_POLL_PAT
      mockExecFileSync.mockReset()
    }
  })

  it('fails closed (process.exit(1)) when compare JSON has a file with no patch field', async () => {
    // #given: workflow_run payload; compare JSON has a file with no patch (too large)
    const eventJson = makeWorkflowRunEvent({headSha: 'sha-no-patch'})
    const prApiResolver = makePrApiResolver({
      prByNumber: makePrApiResponse({number: 42, headSha: 'sha-no-patch'}),
    })

    // Compare JSON with one normal file and one file missing its patch
    const compareJsonWithMissingPatch = JSON.stringify({
      total_commits: 1,
      files: [
        {filename: 'normal.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new'},
        {filename: 'huge-binary.bin', status: 'modified'}, // no patch — too large
      ],
    })

    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce('fro-bot/.github') // gh repo view (fullName)
      .mockReturnValueOnce(makeYamlBase64(['R_no_patch'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/private-repo'}}})) // resolver
      .mockReturnValueOnce(compareJsonWithMissingPatch) // fetchDiffForSha: compare JSON (missing patch)
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
    try {
      // #when: main() runs with a compare response that has a file missing its patch
      await expect(main(makeWorkflowRunReader(eventJson), prApiResolver)).rejects.toThrow('process.exit called')
      // #then: fail closed — process.exit(1) was called
      expect(exitSpy).toHaveBeenCalledWith(1)
      // #then: stderr mentions the truncation
      const stderrText = stderrOutput.join('')
      expect(stderrText).toMatch(/patch omitted|fail closed/i)
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
