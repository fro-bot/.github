import {describe, expect, it, vi} from 'vitest'
import {checkPrivateLeak, checkPrivateLeakWithAdapter} from './private-leak.ts'

// Dedicated source-side exerciser for checkPrivateLeak. Its two existing same-tree callers
// (private-leak-adapter.test.ts, via checkPrivateLeakWithAdapter, and one it() in
// wiki-write-core.test.ts) only cover the happy path with one fixed diff shape.
// regex-redos-regressions.test.ts also calls checkPrivateLeak directly with richer diff-path
// cases, but that file is deliberately excluded from Stryker's testFiles (see
// scripts/mutation-guards-config.test.ts's "redos-regression test file is not in testFiles"
// Test 4), so under mutation testing this module was effectively uncovered. This file exists
// so Stryker sees real assertions, not just plain vitest coverage.

const NO_OVERRIDE = {titlePrefixed: false, isOperator: false}

function diffGit(aPath: string, bPath: string): string {
  return `diff --git a/${aPath} b/${bPath}`
}

describe('checkPrivateLeak — override bypass', () => {
  it('bypasses detection ONLY when both titlePrefixed and isOperator are true', () => {
    const diff = [
      diffGit('private-repo.md', 'private-repo.md'),
      '+++ b/private-repo.md',
      '+mentions private-repo',
    ].join('\n')

    expect(checkPrivateLeak(['private-repo'], diff, {titlePrefixed: true, isOperator: true})).toEqual({ok: true})
  })

  it('does NOT bypass when only titlePrefixed is true (requires both, not either)', () => {
    const diff = [diffGit('a.md', 'private-repo.md'), '+++ b/private-repo.md'].join('\n')

    expect(checkPrivateLeak(['private-repo'], diff, {titlePrefixed: true, isOperator: false})).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('does NOT bypass when only isOperator is true (requires both, not either)', () => {
    const diff = [diffGit('a.md', 'private-repo.md'), '+++ b/private-repo.md'].join('\n')

    expect(checkPrivateLeak(['private-repo'], diff, {titlePrefixed: false, isOperator: true})).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })
})

describe('checkPrivateLeak — empty-input early return', () => {
  it('returns ok:true for an empty privateNames list even with leak-shaped diff content', () => {
    const diff = [diffGit('a.md', 'private-repo.md'), '+++ b/private-repo.md'].join('\n')
    expect(checkPrivateLeak([], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('returns ok:true for an empty diff', () => {
    expect(checkPrivateLeak(['private-repo'], '', NO_OVERRIDE)).toEqual({ok: true})
  })
})

describe("checkPrivateLeak — 'diff --git a/X b/Y' path extraction", () => {
  it('extracts a standard destination path with no leak', () => {
    const diff = diffGit('docs/readme.md', 'docs/readme.md')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('detects a private destination path when renamed (aPath !== bPath)', () => {
    const diff = diffGit('docs/public.md', 'docs/private-repo.md')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/private-repo.md'],
    })
  })

  it('does NOT check the path when aPath === bPath, even if the shared path matches a private name', () => {
    // Same path on both sides (a normal edit, not a rename) — checkPath is intentionally not
    // called from this branch for an unchanged path; the leak-by-filename case is a rename
    // (aPath !== bPath), not an ordinary edit.
    const diff = [diffGit('private-repo.md', 'private-repo.md'), '--- a/private-repo.md', '+++ b/private-repo.md'].join(
      '\n',
    )
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('uses the final literal separator when paths contain " b/"', () => {
    const diff = 'diff --git a/source b/archive b/private-repo.md b/private-repo.md'
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('falls back to the previous separator when the final one has no destination characters', () => {
    const diff = 'diff --git a/public.md b/private-repo b/'
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo b/'],
    })
  })

  it('treats an incomplete destination path as unparseable (currentFile stays null)', () => {
    // No valid separator: falls into the "else" branch (currentFile = null, checkPathAsNew =
    // false), not the happy path — proves the else-branch reset, not just the happy path.
    const diff = ['diff --git a/docs/readme.md b/', '+++ b/private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('rejects a separator found exactly at the diffPrefix boundary (separatorIndex === diffPrefix.length)', () => {
    // 'diff --git a/' is 14 chars; an empty aPath (nothing between 'a/' and ' b/') makes
    // lastIndexOf return exactly 14 — the boundary the `>` comparison must reject (an `>=`
    // mutant, an always-true/false ConditionalExpression, or an `||` LogicalOperator would
    // all incorrectly accept this as a valid separator instead of falling back to the else
    // branch).
    const diff = 'diff --git a/ b/private-repo.md'
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })
})

describe("checkPrivateLeak — 'rename to '/'copy to ' destination", () => {
  it('detects a private path named only in a rename destination', () => {
    const diff = ['diff --git a/old.md b/old.md', 'rename to private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('detects a private path named only in a copy destination (requires OR, not AND, of the two prefixes)', () => {
    const diff = ['diff --git a/old.md b/old.md', 'copy to private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('ignores an empty rename destination instead of checking an empty path', () => {
    const diff = ['diff --git a/old.md b/old.md', 'rename to '].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('does not treat an empty rename destination as a match even when privateNames contains an empty string', () => {
    // schemas.ts's assertRepoEntry only requires `typeof owner/name === 'string'` -- it does
    // not reject an empty string, so privateNames CAN legitimately contain '' and this must be
    // handled, not assumed away. ''.toLowerCase().includes('') is true for ANY string, so if
    // the empty-destination guard were skipped, checkPath('') would incorrectly match.
    const diff = ['diff --git a/old.md b/old.md', 'rename to '].join('\n')
    expect(checkPrivateLeak([''], diff, NO_OVERRIDE)).toEqual({ok: true})
  })
})

describe("checkPrivateLeak — '--- '/'+++' new-file detection", () => {
  it('detects a private path in a brand-new file (--- /dev/null, then +++)', () => {
    // aPath === bPath so the diff --git line's OWN checkPath call (line 63-65) never fires;
    // the only way this test can detect the leak is through the '--- /dev/null' + '+++'
    // new-file mechanism this test exists to isolate.
    const diff = [diffGit('private-repo.md', 'private-repo.md'), '--- /dev/null', '+++ b/private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('does NOT treat an existing-file "--- a/X" header as a new file', () => {
    const diff = [diffGit('private-repo.md', 'private-repo.md'), '--- a/private-repo.md', '+++ b/private-repo.md'].join(
      '\n',
    )
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('does not check +++ path when currentFile is null (no preceding diff --git header at all)', () => {
    const diff = ['--- /dev/null', '+++ b/private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('resets checkPathAsNew to false at the start of a new diff --git section (line 62), not carried over', () => {
    // First section: a genuinely new, non-private file, whose "--- /dev/null" flips
    // checkPathAsNew true but is never explicitly reset by a "+++" line (none follows) before
    // the next "diff --git" line starts. The second section's own diff --git line must reset
    // checkPathAsNew on entry, or its "+++" line would wrongly treat an ordinary edit as new.
    const diff = [
      diffGit('first.md', 'first.md'),
      '--- /dev/null',
      diffGit('private-repo.md', 'private-repo.md'),
      '+++ b/private-repo.md',
    ].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('checkPathAsNew does not start true by default (no leading "--- " header at all)', () => {
    const diff = [diffGit('private-repo.md', 'private-repo.md'), '+++ b/private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('resets a stale currentFile and checkPathAsNew when a later diff --git line cannot be parsed', () => {
    // First section sets currentFile to a private-matching path (without an immediate match,
    // since aPath === bPath) and flips checkPathAsNew true via '--- /dev/null'. The next
    // section's diff --git line is malformed (no ' b/' separator at all) and must reset BOTH
    // currentFile to null and checkPathAsNew to false — if that reset is skipped, the stale
    // state survives into the next '+++' line and wrongly reports a leak.
    const diff = [
      diffGit('private-repo.md', 'private-repo.md'),
      '--- /dev/null',
      'diff --git a/unparseable-no-separator',
      '+++ b/unrelated.md',
    ].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })
})

describe("checkPrivateLeak — '+' added-line content scan", () => {
  it('detects a private name mentioned only in added-line content, not the path', () => {
    const diff = [diffGit('docs/readme.md', 'docs/readme.md'), '+See acme/private-repo for details.'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/readme.md'],
    })
  })

  it('ignores a context/removed line containing the private name (only "+"-prefixed lines are scanned)', () => {
    const diff = [diffGit('docs/readme.md', 'docs/readme.md'), '-See acme/private-repo for details.'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it("strips the leading '+' from added-line content before matching (a name that only matches WITH the '+' retained must not match)", () => {
    // schemas.ts places no character-class constraint on RepoEntry.owner/name (unlike node_id
    // or the allowlist's approved_contrib_repos, which are pattern-checked) -- there is no
    // enforced upstream guarantee that a private name can't literally start with '+'. This
    // must be handled structurally: content is the '+'-stripped line, so a name of '+leaked'
    // can only match a raw, unstripped line, never the real, stripped content.
    const diff = [diffGit('docs/readme.md', 'docs/readme.md'), '+leaked repo mentioned'].join('\n')
    expect(checkPrivateLeak(['+leaked'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('does not scan the "+++" header line itself as added content', () => {
    // The path itself (b/private-repo.md) would match if the "+++" line were scanned as a "+"
    // content line; it must be consumed by the header branch instead and never reach here.
    const diff = [diffGit('docs/readme.md', 'docs/readme.md'), '--- a/docs/readme.md', '+++ b/private-repo.md'].join(
      '\n',
    )
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('does not scan added-line content before any diff --git header sets currentFile', () => {
    const diff = '+See acme/private-repo for details.'
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('matches added-line content case-insensitively (kills content.toLowerCase() mutation)', () => {
    const diff = [diffGit('docs/readme.md', 'docs/readme.md'), '+See ACME/PRIVATE-REPO for details.'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/readme.md'],
    })
  })

  it('deduplicates the same file matched via both the path and later added-line content', () => {
    const diff = [
      diffGit('a.md', 'private-repo.md'),
      '+++ b/private-repo.md',
      '+private-repo mentioned again here',
    ].join('\n')
    const result = checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)
    expect(result).toEqual({ok: false, matchedFiles: ['private-repo.md']})
  })
})

describe('checkPrivateLeak — checkPath multi-name matching', () => {
  it('matches when ANY private name is present, not requiring ALL of them (kills .some -> .every)', () => {
    const diff = diffGit('docs/public.md', 'docs/private-repo.md')
    expect(checkPrivateLeak(['private-repo', 'other-secret'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/private-repo.md'],
    })
  })
})

describe('checkPrivateLeak — checkPath de-duplication and negative match', () => {
  it('does not push a path that does not match any private name', () => {
    const diff = diffGit('public.md', 'public2.md')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('does not duplicate a path reached twice via two separate rename destinations', () => {
    const diff = [
      diffGit('a.md', 'a.md'),
      'rename to private-repo.md',
      diffGit('b.md', 'b.md'),
      'rename to private-repo.md',
    ].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('is case-insensitive against both the path and the private name', () => {
    const diff = diffGit('docs/public.md', 'docs/PRIVATE-REPO.md')
    expect(checkPrivateLeak(['Private-Repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/PRIVATE-REPO.md'],
    })
  })
})

describe('checkPrivateLeakWithAdapter', () => {
  it('forwards exactly {content, snapshotSha} to the adapter (kills the resolvePrivateRepositoryNames param object mutation)', async () => {
    const resolvePrivateRepositoryNames = vi.fn().mockResolvedValue(['private-repo'])

    const result = await checkPrivateLeakWithAdapter(
      {resolvePrivateRepositoryNames},
      {
        content: 'the pull request title',
        snapshotSha: 'abc123',
        diff: diffGit('docs/public.md', 'docs/private-repo.md'),
        override: NO_OVERRIDE,
      },
    )

    expect(resolvePrivateRepositoryNames).toHaveBeenCalledWith({
      content: 'the pull request title',
      snapshotSha: 'abc123',
    })
    expect(result).toEqual({ok: false, matchedFiles: ['docs/private-repo.md']})
  })
})
