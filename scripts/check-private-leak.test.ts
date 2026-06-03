import type {NodeIdResolver} from './private-repo-resolution.ts'
import {Buffer} from 'node:buffer'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {checkPrivateLeak, main, runPromotionScan} from './check-private-leak.ts'

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
// Round-3 FIX #2 — access-lost should SKIP, not fail-closed
// Round-3 FIX #3 — stderr sanitization
// Round-3 FIX #4 — no bare-name false positives (pure function)
// ---------------------------------------------------------------------------

function makeEvent(opts: {title?: string; author?: string; prNumber?: number} = {}): string {
  return JSON.stringify({
    pull_request: {
      number: opts.prNumber ?? 42,
      title: opts.title ?? 'some PR',
      user: {login: opts.author ?? 'some-user'},
      base: {repo: {full_name: 'fro-bot/.github'}},
    },
  })
}

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
    mockReadFile.mockResolvedValue(makeEvent())
    mockExecFileSync.mockReset()
    mockExecFileSync
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
    try {
      await expect(main()).rejects.toThrow('process.exit called')

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
      mockExecFileSync.mockReset()
    }
  })

  it('exits non-zero when ALL node_ids fail to resolve and no override', async () => {
    mockReadFile.mockResolvedValue(makeEvent())
    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce(makeYamlBase64(['R_x'])).mockImplementationOnce(() => {
      throw new Error('server error')
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    process.env.GITHUB_EVENT_PATH = '/fake/event.json'
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      mockExecFileSync.mockReset()
    }
  })

  it('passes with bypass log when operator override is active and resolution fails', async () => {
    // #given: operator override active + one node_id fails
    mockReadFile.mockResolvedValue(makeEvent({title: '[allow-private-leak] my PR', author: 'marcusrbrown'}))
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce(makeYamlBase64(['R_y'])) // fetchPrivateNodeIds
      .mockImplementationOnce(() => {
        throw new Error('outage')
      }) // resolver R_y — fails
      .mockReturnValueOnce('') // fetchPrDiff → empty diff

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
    try {
      await main() // should NOT throw

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
      mockExecFileSync.mockReset()
    }
  })
})

// ---------------------------------------------------------------------------
// Round-3 FIX #2 — access-lost should SKIP, not fail-closed (CLI-level)
// ---------------------------------------------------------------------------

describe('main() — access-lost skip vs error fail-closed (Round-3 FIX #2)', () => {
  it('proceeds (no exit 1) when one resolves + one access-lost; access-lost node_id in stderr', async () => {
    // #given: two private node_ids — one resolves, one is access-lost (null node)
    mockReadFile.mockResolvedValue(makeEvent())
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce(makeYamlBase64(['R_resolved', 'R_gone'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: {nameWithOwner: 'acme/resolved-repo'}}})) // R_resolved → ok
      .mockReturnValueOnce(JSON.stringify({data: {node: null}})) // R_gone → access-lost
      .mockReturnValueOnce('') // fetchPrDiff → empty diff (nothing to scan)

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
    try {
      await main() // must NOT throw

      // #then: no exit called
      expect(exitSpy).not.toHaveBeenCalled()

      const stderrText = stderrOutput.join('')
      // #then: access-lost node_id appears in stderr
      expect(stderrText).toContain('R_gone')
      expect(stderrText).toContain('access-lost')
      // #then: the resolved canonical name does NOT appear in stderr
      expect(stderrText).not.toContain('acme/resolved-repo')
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      mockExecFileSync.mockReset()
    }
  })

  it('fails-closed (exit 1) when one resolved + one error-class failure', async () => {
    mockReadFile.mockResolvedValue(makeEvent())
    mockExecFileSync.mockReset()
    mockExecFileSync
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
    try {
      await expect(main()).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
      mockExecFileSync.mockReset()
    }
  })

  it('proceeds when ALL node_ids are access-lost (nothing to scan → guard passes)', async () => {
    // #given: both private repos are access-lost (deleted/inaccessible)
    mockReadFile.mockResolvedValue(makeEvent())
    mockExecFileSync.mockReset()
    mockExecFileSync
      .mockReturnValueOnce(makeYamlBase64(['R_gone1', 'R_gone2'])) // fetchPrivateNodeIds
      .mockReturnValueOnce(JSON.stringify({data: {node: null}})) // R_gone1 → access-lost
      .mockReturnValueOnce(JSON.stringify({data: {node: null}})) // R_gone2 → access-lost
      .mockReturnValueOnce('') // fetchPrDiff → empty diff

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
    try {
      await main() // must NOT throw

      expect(exitSpy).not.toHaveBeenCalled()

      const stderrText = stderrOutput.join('')
      // Both access-lost node_ids appear in stderr
      expect(stderrText).toContain('R_gone1')
      expect(stderrText).toContain('R_gone2')
      expect(stderrText).toContain('access-lost')
    } finally {
      stderrSpy.mockRestore()
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      delete process.env.GITHUB_EVENT_PATH
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
    mockReadFile.mockResolvedValue(makeEvent())
    mockExecFileSync.mockReset()

    // The gh error body contains a canonical owner/name — must NOT appear in logged output.
    const poisonedStderr = 'GraphQL error for someowner/private-repo: Not Found\n'
    mockExecFileSync
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
    try {
      await expect(main()).rejects.toThrow('process.exit called')

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
// runPromotionScan — promotion-mode entry path (Unit 1)
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

describe('runPromotionScan — edge: private token as new wiki page path → detected', () => {
  it('returns ok:false when a new wiki page path contains the owner--slug form', async () => {
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

    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/repos/acme--private-repo.md']})
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

describe('runPromotionScan — edge: access-lost node_id is skipped, scan proceeds', () => {
  it('skips access-lost node_ids and scans with remaining resolved names', async () => {
    // #given: one access-lost, one resolves; diff has no private name → ok
    const reposYaml = makeReposYaml(['R_gone', 'R_present'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_gone') return {error: 'access-lost'}
      if (nodeId === 'R_present') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/foo.md', ['some content'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    // access-lost is skipped; scan proceeds with the resolved name; no match → ok
    expect(result).toEqual({ok: true})
  })

  it('skips access-lost and still blocks when the remaining resolved name appears in diff', async () => {
    // #given: one access-lost, one resolves; diff DOES contain the resolved name
    const reposYaml = makeReposYaml(['R_gone', 'R_present'])
    const resolver: NodeIdResolver = async nodeId => {
      if (nodeId === 'R_gone') return {error: 'access-lost'}
      if (nodeId === 'R_present') return {nameWithOwner: 'acme/private-repo'}
      return {error: 'error'}
    }
    const diff = makePromoDiff('docs/foo.md', ['See acme/private-repo for details.'])

    const result = await runPromotionScan({reposYaml, resolver, diff})

    expect(result).toEqual({ok: false, matchedFiles: ['docs/foo.md']})
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
