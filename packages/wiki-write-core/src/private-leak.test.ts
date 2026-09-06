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

describe('checkPrivateLeak — empty privateNames/diff converge to ok:true through the main path', () => {
  // No early return exists for these cases (removed as dead code per review: falling through
  // converges to the same result). These tests pin that convergence directly.
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
    // No valid separator: falls into the "else" branch (currentFile = null), not the happy path
    // — proves the else-branch reset, not just the happy path. The "+++" line here is also not
    // preceded by a "--- " line, so it is never treated as a header either way.
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

  it('(#3838 fix) a diff --git line breaks a stale "+++" expectation from an earlier "--- /dev/null", so the next "+++" line is scanned as content', () => {
    // First section: a private-adjacent file (no immediate match, aPath === bPath), whose
    // "--- /dev/null" sets the header expectation true but is never consumed by a "+++" line
    // before the next "diff --git" section starts. The pending expectation is unconditionally
    // cleared at the top of every loop iteration (not just when a "+++" line consumes it), so
    // the second section's "diff --git" line already clears it before its own "+++" line is
    // reached -- that "+++" line's content, which happens to literally repeat the filename,
    // must then be content-scanned rather than silently swallowed as a header.
    const diff = [
      diffGit('first.md', 'first.md'),
      '--- /dev/null',
      diffGit('private-repo.md', 'private-repo.md'),
      '+++ b/private-repo.md',
    ].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('(#3838 fix) a "+++" line with no preceding "--- " at all is scanned as content, not swallowed as a header', () => {
    const diff = [diffGit('private-repo.md', 'private-repo.md'), '+++ b/private-repo.md'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })

  it('a "+++" line consumed as a header clears the header expectation, so an unrelated second "+++" line (no preceding "--- ") is content but does not match', () => {
    // No preceding "--- " line at all here, so neither "+++" line is ever treated as a header;
    // both fall to content scan. Uses a private name that doesn't appear in either line's own
    // text, so this only proves neither line spuriously matches -- see the dedicated #3838 test
    // below for the shape where a second "+++" line's content DOES contain a private name.
    const diff = [diffGit('unrelated.md', 'unrelated.md'), '+++ b/unrelated', '+++ b/unrelated'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('(#3838) after a "--- " header, only the immediately following "+++" line is a header -- a second consecutive "+++" line is content', () => {
    const diff = [diffGit('x.md', 'x.md'), '--- /dev/null', '+++ b/x.md', '+++ b/secret-repo'].join('\n')
    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['x.md'],
    })
  })

  it('resets a stale currentFile to null on a later unparseable diff --git line, observable through a subsequent content match', () => {
    // The dedicated stale-reset test above ("resets a stale currentFile and checkPathAsNew...")
    // uses a following "+++" line, which after the #3838 fix is no longer treated as a header at
    // all in that position (no immediately preceding "--- " line) -- so it falls through to a
    // content scan whose text never contains the private name, and cannot by itself prove the
    // currentFile reset happened. This test proves it with an ordinary "+"-content line instead:
    // stale currentFile is an innocent filename that shares no text with the private name, so a
    // real reset to null must produce {ok: true}; a stale, un-reset currentFile would instead
    // surface a match under that stale filename.
    const diff = [
      diffGit('stale-file.md', 'stale-file.md'),
      'diff --git a/unparseable-no-separator',
      '+mentions private-repo here',
    ].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('(#3838) a "+++"-shaped check must match the literal string, not just any line, when a header IS expected', () => {
    // Preceding line is "--- a/safe.md" (an ordinary modified-file header, not /dev/null), so a
    // header IS expected next -- but the actual next line is genuine added content that merely
    // happens to start with a single "+" ("+mentions..."), not "+++". It must be content-scanned,
    // not swallowed by the header branch: currentFile ("safe.md") shares no text with the private
    // name, so the header path (even if wrongly entered) would never itself produce a match --
    // only the content scan finds it, proving the header branch does NOT run here.
    const diff = [diffGit('safe.md', 'safe.md'), '--- a/safe.md', '+mentions private-repo here'].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['safe.md'],
    })
  })

  it('does not treat a "+++" line as a header when the preceding line was an unparseable diff --git, not a "--- " line', () => {
    // After #3838's fix, a header is expected only when the IMMEDIATELY preceding line was
    // '--- '; here it's a malformed 'diff --git' line instead, so this '+++' line is never a
    // header candidate regardless of the earlier '--- /dev/null'. See the dedicated stale-reset
    // test above ("resets a stale currentFile to null on a later unparseable diff --git
    // line...") for the test that actually discriminates the currentFile reset itself, via a
    // subsequent content match rather than a '+++' line.
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

  it('(#3838 fix) a genuine "--- a/x" / "+++ b/x" pair still parses as a header, not content', () => {
    // Control for #3838's fix: this pairing is a real, ordinary modified-file diff header (not
    // a new-file one -- the pending-new-file flag is only ever true for '--- /dev/null').
    // Discriminates on whether the '+++' line is correctly consumed as a header versus
    // mis-scanned as content: the header path never reads the '+++' line's own text at all (the
    // flag is false here, so checkPath(currentFile) doesn't fire), so a private name embedded
    // in the '+++' line's own path ('secret.md') must NOT surface a match. If '+++' were instead mis-scanned
    // as content, `line.slice(1).toLowerCase()` = "++ b/secret.md" DOES contain 'secret', and
    // the match would be pushed via `currentFile` ('x.md') -- so a regression here reads
    // {ok: false, matchedFiles: ['x.md']} instead of {ok: true}.
    const diff = [diffGit('x.md', 'x.md'), '--- a/x.md', '+++ b/secret.md'].join('\n')
    expect(checkPrivateLeak(['secret'], diff, NO_OVERRIDE)).toEqual({ok: true})
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

describe('checkPrivateLeak — #3838: ++-prefixed added lines must not escape the content scan', () => {
  it('scans an added line beginning with "++" as content instead of parsing it as a "+++" header (issue reproduction)', () => {
    // Exact reproduction from #3838: the raw diff line is "+++ see acme/secret-repo for the
    // rollout plan" -- one leading "+" from the diff format itself, then the added content's
    // own text, which happens to start with "++". Before the fix, `line.startsWith('+++')`
    // routed this to the header branch unconditionally, so it was never content-scanned.
    const diff = [
      'diff --git a/docs/notes.md b/docs/notes.md',
      '--- a/docs/notes.md',
      '+++ b/docs/notes.md',
      '@@ -1,1 +1,2 @@',
      '+++ see acme/secret-repo for the rollout plan',
    ].join('\n')
    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/notes.md'],
    })
  })
})

describe('checkPrivateLeak — #3839: "---"/"+++" are headers only before the first "@@" hunk', () => {
  it('a modified line rendering as "--- " then "+++ " INSIDE a hunk is content, not a header (issue reproduction)', () => {
    // The adjacency-only rule from #3838 still leaked on the single most common diff shape: a
    // modified line. Its removed half renders as "--- see acme/public-repo..." (arming
    // pendingNewFileCheck = false) and its added replacement renders as "+++ see
    // acme/secret-repo...", which the adjacency rule alone would treat as a header and skip.
    const diff = [
      diffGit('docs/notes.md', 'docs/notes.md'),
      '--- a/docs/notes.md',
      '+++ b/docs/notes.md',
      '@@ -1,2 +1,2 @@',
      '--- see acme/public-repo for the rollout plan',
      '+++ see acme/secret-repo for the rollout plan',
    ].join('\n')
    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/notes.md'],
    })
  })

  it('a genuine "--- a/x" / "+++ b/x" pair appearing AFTER a "@@" line is content, not a header', () => {
    // Inverse control: this pairing is textually identical to a real header, but it appears
    // after a hunk has already started, so it must be content-scanned. Uses a private name
    // embedded in the "+++" line's own path so the assertion depends on it actually being
    // scanned as content -- the (now gated-off) header path would never read this line's own
    // text at all.
    const diff = [
      diffGit('docs/notes.md', 'docs/notes.md'),
      '--- a/docs/notes.md',
      '+++ b/docs/notes.md',
      '@@ -1,2 +1,2 @@',
      '--- a/x.md',
      '+++ b/secret-repo.md',
    ].join('\n')
    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/notes.md'],
    })
  })

  it('a "@@" line\'s trailing context is not content-scanned (pins fall-through over continue)', () => {
    // A "@@" line can carry function-context text after the second "@@" marker. This module
    // chose fall-through (not an early continue) when setting inHunk, on the principle the
    // guard should scan more, not less -- though a "@@ ..." line never starts with "+" so this
    // is currently a no-op either way; this test exists to pin the choice, not to prove a
    // reachable difference between the two options today.
    const diff = [diffGit('docs/notes.md', 'docs/notes.md'), '@@ -1 +1 @@ secret-repo'].join('\n')
    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })

  it('a hunk marker with trailing context text after the second "@@" still gates a later header-shaped pair as content', () => {
    // Discriminates startsWith('@@') from an endsWith('@@') mutant: this hunk marker line ends
    // with trailing context text, not '@@' itself, so an endsWith check would fail to arm
    // inHunk at all -- leaving a later '--- '/'+++' pair wrongly eligible for header parsing.
    const diff = [
      diffGit('docs/notes.md', 'docs/notes.md'),
      '--- a/docs/notes.md',
      '+++ b/docs/notes.md',
      '@@ -1,2 +1,2 @@ trailing-context',
      '--- see acme/public-repo for the rollout plan',
      '+++ see acme/secret-repo for the rollout plan',
    ].join('\n')
    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['docs/notes.md'],
    })
  })

  it('a new "diff --git a/" section resets the hunk state, so its own header block is recognized again', () => {
    const diff = [
      diffGit('first.md', 'first.md'),
      '--- a/first.md',
      '+++ b/first.md',
      '@@ -1 +1 @@',
      diffGit('private-repo.md', 'private-repo.md'),
      '--- /dev/null',
      '+++ b/private-repo.md',
    ].join('\n')
    expect(checkPrivateLeak(['private-repo'], diff, NO_OVERRIDE)).toEqual({
      ok: false,
      matchedFiles: ['private-repo.md'],
    })
  })
})

// ---------------------------------------------------------------------------
// Inverse controls (promised by docs/solutions/security-issues/
// mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md): for each structural
// token this parser recognizes, prove a private name appearing as CONTENT (inside a hunk,
// `+`-prefixed) carrying that token's own text is still caught, not misread as structure.
// Ref: scripts/check-private-leak.ts Unit 5A-2 (PR fix/mutation-5a-check-private-leak).
// ---------------------------------------------------------------------------

describe('checkPrivateLeak — inverse controls: structural-token text as added content', () => {
  it('scans an added line whose text is a "diff --git a/... b/..." header as content, not as a new file section', () => {
    // A `+`-prefixed line can never actually satisfy `line.startsWith('diff --git a/')` (the `+`
    // is the first character), so this is grammar-safe by construction -- but pin it directly
    // rather than only inferring it from the prefix check.
    const diff = [
      diffGit('notes.md', 'notes.md'),
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,1 +1,2 @@',
      ' unrelated context line',
      '+diff --git a/secret-repo b/secret-repo',
    ].join('\n')

    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({ok: false, matchedFiles: ['notes.md']})
  })

  it('scans an added line whose text is a "rename to <path>" line as content, not as a rename destination', () => {
    // The `rename to `/`copy to ` branch is intentionally not `inHunk`-gated (unlike `--- `/
    // `+++ `), but it is still grammar-safe: a real diff's rename/copy destination line is
    // never `+`-prefixed, and a `+`-prefixed content line can never satisfy
    // `line.startsWith('rename to ')` for the same first-character reason as `diff --git`.
    const diff = [
      diffGit('notes.md', 'notes.md'),
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,1 +1,2 @@',
      ' unrelated context line',
      '+rename to secret-repo',
    ].join('\n')

    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({ok: false, matchedFiles: ['notes.md']})
  })

  it('scans an added line whose text is a "copy to <path>" line as content, not as a copy destination', () => {
    const diff = [
      diffGit('notes.md', 'notes.md'),
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,1 +1,2 @@',
      ' unrelated context line',
      '+copy to secret-repo',
    ].join('\n')

    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({ok: false, matchedFiles: ['notes.md']})
  })

  it('documents CURRENT behavior (known gap, tracked in #3842): a real "@@" hunk marker\'s own trailing context text is never scanned', () => {
    // A hunk-marker line is not `+`-prefixed, so the `!line.startsWith('+')` filter drops it
    // before the content scan. A private name in the trailing function-context text
    // ("@@ -1,2 +1,2 @@ function secret() {") is NOT caught. Flip this test when fixing #3842.
    const diff = [
      diffGit('notes.md', 'notes.md'),
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,2 +1,2 @@ function secret-repo() {',
      ' unrelated context line',
      '+added line with no private name',
    ].join('\n')

    expect(checkPrivateLeak(['secret-repo'], diff, NO_OVERRIDE)).toEqual({ok: true})
  })
})
