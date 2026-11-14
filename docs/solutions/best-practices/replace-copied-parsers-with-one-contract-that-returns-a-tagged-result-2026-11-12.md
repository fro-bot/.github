---
title: Replace copied parsers with one contract that returns a tagged result
date: 2026-11-12
category: best-practices
module: packages/wiki-write-core/src/frontmatter-block.ts
problem_type: design_pattern
component: development_workflow
severity: high
applies_when:
  - several modules each carry their own regex or scan for the same text structure
  - a fix to one copy turns up the same defect in another shape
  - a trust gate reads a structure that other code also reads
  - an editor rewrites part of a file and must keep every other byte
  - a shared helper becomes public API that a later change builds on
tags:
  - shared-parser
  - frontmatter
  - tagged-result
  - differential-testing
  - refactor-parity
  - fail-closed
  - anti-recurrence
  - wiki
---

# Replace copied parsers with one contract that returns a tagged result

## Context

Twelve production sites in six packages each found a YAML frontmatter block with their own regex. Nine used `/^---\n([\s\S]+?)\n---\n?/u`, and three were variants that accepted CRLF. All twelve shared three defects:

- They accepted any line that began with `---` as the closing line, so `---x`, `----` or `--- text` ended the block early.
- None read a block with no lines.
- A block that opened and never closed read as "no frontmatter", with no error.

At the wiki privacy gate a `---x` line placed before `sources` cut the block short, and the gate judged the page by a weaker test.

The first fix patched each copy (#4185, closed unmerged). Each tightened copy showed the defect in a new shape: a closing line with trailing spaces stopped closing, a YAML parse failure sent the gate down its weaker path, and an empty block counted as unclosed. Patching each copy left different callers with different error cases.

One splitter replaced the copies: `splitFrontmatterBlock` at `packages/wiki-write-core/src/frontmatter-block.ts:49`. It finds the block and does not parse YAML.

## Guidance

1. **Define the block boundaries once and return distinct results.** The `FrontmatterBlockSplit` type at `packages/wiki-write-core/src/frontmatter-block.ts:13-32` has three: `none`, `malformed` (opened and never closed) and `block`. The first two carry no content. Each caller parses the content and chooses its own response.
2. **If callers edit the block, return pieces that rebuild the input when joined.** A block is five strings, `opening + text + textEnding + closing + body`. `correctPlanConsistencyStatusLine` at `packages/status-truth/src/detect-plan-consistency.ts:321-331` changes one line and joins them. Line endings and spaces after the closing line survive without offset arithmetic.
3. **Before the result type is published, test it with each kind of caller that will use it, editors included.** `packages/wiki-write-core/src/frontmatter-block.test.ts:155-194` splices a line and rebuilds the file for LF, CRLF and a closing line with trailing spaces. The later callers needed no new field.
4. **List each caller's response to every result before changing the callers.** "Treat an unclosed block as invalid YAML" means nothing for a caller that never parsed YAML. The table in `docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md` gives one response per site: throw the existing error, skip with the existing warning, count as invalid, or return no metadata.
5. **List every intended behaviour change, and test against the list.** Keep a copy of each old parser in the test. Where no listed change applies, old and new must agree. Where one applies, the new result must equal an expected value recorded when the test case was built (`packages/wiki-write-core/src/frontmatter-block.test.ts:447-469`). A check that only sees the input has a certain shape and calls the difference intended proves nothing.
6. **Test the comparison.** Insert known defects and require the tests to fail (`packages/wiki-write-core/src/frontmatter-block.test.ts:481-503`). Require the generated inputs to reach each intended change, so a generator that stops producing one is noticed.
7. **Compare old and new results on real files at a recorded commit, and also on generated malformed inputs.** `git ls-tree -r` and `git show` read every Markdown file at a commit without a checkout. Real files alone are not enough: #4185 reported that all 230 checked files still parsed, and it still had two blocking defects.
8. **Add a test that detects a new copy.** `scripts/frontmatter-sites.test.ts:179-197` fails when a non-test TypeScript file in a `src` directory under `packages/`, outside the splitter, has a regex literal that starts with `^---`.

### Smaller rules from the same work

- **A scan can stop by construction.** `splitFrontmatterBlock` splits the content into lines once and visits each line once (`packages/wiki-write-core/src/frontmatter-block.ts:50-57`), so no change to the loop body can make it run forever.
- **An empty string can mean two things.** A block with no lines and a block of one blank line both have empty `text`. Only the first is an empty mapping, so the readers also check `textEnding` (`packages/wiki-write-core/src/frontmatter.ts:22`).
- **Split into lines before matching one line.** In a multiline regular expression `\s` matches line endings, so `^status:\s*…\s*$` removed a CRLF and the blank lines after the match. `findPlanStatusLine` at `packages/status-truth/src/detect-plan-consistency.ts:29-38` splits at `\n` and matches each line on its own.

## Why This Matters

Copies drift, and a patch to each copy moves the defect instead of removing it. One rule with one set of tests removes the class. A result type that later changes build on is hard to change after release, and proving it first costs one test.

## When to Apply

- Several modules parse the same structure, and a fix to one would change what its callers see for malformed input.
- A parser sits in front of a trust decision, or an editor must keep every byte it does not change.

## Examples

A reader that rejects an absent or unclosed block and handles an empty one:

<!-- verify: splitFrontmatterBlock from packages/wiki-write-core/src/frontmatter-block.ts -->
```ts
function readBlock(content: string): unknown {
  const split = splitFrontmatterBlock(content)
  if (split.kind !== "block") throw new Error("missing or unclosed frontmatter")
  // Only a block with no lines is an empty mapping; one blank line parses to null.
  return split.text === "" && split.textEnding === "" ? {} : parse(split.text)
}
```

An editor that replaces a status line it has already found and rebuilds the file from the pieces:

<!-- verify: splitFrontmatterBlock from packages/wiki-write-core/src/frontmatter-block.ts -->
```ts
function setStatus(content: string, index: number): string | null {
  const split = splitFrontmatterBlock(content)
  if (split.kind !== "block") return null
  const lines = split.text.split("\n")
  const original = lines[index]
  if (original === undefined || !original.startsWith("status:")) return null
  lines[index] = original.endsWith("\r") ? "status: complete\r" : "status: complete"
  return split.opening + lines.join("\n") + split.textEnding + split.closing + split.body
}
```

## Related

- [Structured-First Attribution for Public-Allowlist Privacy Gates](wiki-page-structured-attribution-2026-06-04.md): what the privacy gate requires now, and why the writer had to supply it before the gate became strict.
- [Shared invariants need one implementation](shared-invariants-need-one-implementation-2026-08-31.md): the general rule this applies to a parser.
- [Make failure boundaries and predicates explicit](make-failure-boundaries-and-predicates-explicit-2026-08-25.md): separate results for "absent" and "could not read".
- [Equivalence refactors need differential proofs past the bound](equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md): reference implementations and seeded inputs, for a refactor that must keep behaviour.
- [Loose-then-tight schema migration](loose-then-tight-schema-migration-pattern-2026-05-05.md): change the producer before the consumer becomes strict.
- `docs/plans/2026-11-12-001-refactor-shared-frontmatter-splitter-plan.md` and `docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md`: the plan and the per-site table.
- Issues and pull requests: #4148, #4183, closed #4185, #4201, #4203.
