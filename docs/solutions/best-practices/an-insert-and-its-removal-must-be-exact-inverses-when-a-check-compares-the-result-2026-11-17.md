---
title: An insert and its removal must be exact inverses when a check compares the result
date: 2026-11-17
category: best-practices
module: packages/wiki-write-core/src/wiki-utils.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a writer adds or removes a marker in text that another check compares before and after
  - the insert tidies whitespace around the place it writes
  - the text can have no blank line, several blank lines or CRLF line endings at that place
tags:
  - round-trip
  - inverse-functions
  - change-policy
  - archive-notice
  - crlf
  - wiki-page
---

# An insert and its removal must be exact inverses when a check compares the result

## Context

When a check compares a text before and after a marker is added or removed, removing the marker must give back exactly the text it was added to. Test that round trip for every shape of input that has no marker yet. If the two functions are only close, the check refuses valid inputs.

The `archive` action of the lifecycle workflow adds a one-sentence notice under a wiki page's heading, and `unarchive` removes it. Before either action commits, `assertLifecyclePolicy` (`packages/registry/src/rename-tracked-repo.ts:922`) checks that the action changed nothing else in the page body. It removes the notice from the body as it was and from the body as it will be, trims the outer whitespace of each, and compares them (`packages/registry/src/rename-tracked-repo.ts:963`). A difference stops the action with `PATH_POLICY`.

Review of [#4281](https://github.com/fro-bot/.github/pull/4281) found two bodies the action could not archive:

- `# Repo\n\n\nNotes.`: the insert collapsed the blank lines after the heading, so the two sides differed. Fixed in `c61b11c`.
- `# Repo\nNotes.`, with no blank line: the insert added a blank line that the removal left behind. The test for this body checked the insert and never the removal. Fixed in `4339ac3`.

## Guidance

1. **Insert one known span without changing the text around it, and remove that same span.** A helper that tidies blank lines when it inserts cannot have a removal that restores them. `withArchiveNotice` puts the body's own line ending, the notice and the line ending again directly after the heading's line ending, and moves no other byte (`packages/wiki-write-core/src/wiki-utils.ts:392`). `withoutArchiveNotice` removes that span (`packages/wiki-write-core/src/wiki-utils.ts:405`). Each special form (a heading that is the last line, a body with no heading) has its own fixed span.
2. **Take the line ending from the text.** `bodyEol` returns CRLF when the body has one and LF otherwise (`packages/wiki-write-core/src/wiki-utils.ts:377`), so the inserted span matches the page.
3. **Test the round trip over every shape you can name, not the insert alone.** The table at `scripts/wiki-utils.test.ts:384` holds twelve body shapes, each in LF and CRLF, and asserts that removing after inserting returns the original.
4. **Fix the helpers, not the check.** The comparison was left as it was.

## Why This Matters

A pair that is nearly inverse fails only on inputs its author did not think of. Here those were ordinary pages: the result would have been an operator action that refused to archive a valid page, with an error that names a policy and not the spacing that caused it. Accepting an awkward result in one shape (in the no-blank-line body the notice shares a paragraph with the text after it) is the price of one rule that holds for every body.

## When to Apply

- A writer adds or removes a marker, a banner or a generated block in a file that people also edit.
- A policy check, a diff or a hash compares the file from before and after that change.
- The insert and the removal are written as two separate functions.

## Examples

The round trip over several shapes, including the two that failed, in both line endings:

<!-- verify: withArchiveNotice from packages/wiki-write-core/src/wiki-utils.ts -->
<!-- verify: withoutArchiveNotice from packages/wiki-write-core/src/wiki-utils.ts -->
```ts
const shapes = ['# Repo\n\nNotes.', '# Repo\n\n\nNotes.', '# Repo\nNotes.', '# Repo', 'Notes only.', '']
for (const shape of shapes) {
  for (const body of [shape, shape.replaceAll('\n', '\r\n')]) {
    if (withoutArchiveNotice(withArchiveNotice(body)) !== body) throw new Error(JSON.stringify(body))
  }
}
```

## Related

- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): rebuilding a file from pieces that concatenate back to the original.
- [Equivalence refactors need differential proofs past the bound](equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md): what a table of shapes does and does not prove.
- [#4281](https://github.com/fro-bot/.github/pull/4281).
