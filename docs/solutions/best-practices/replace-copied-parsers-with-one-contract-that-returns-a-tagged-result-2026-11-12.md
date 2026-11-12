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

- The close was a prefix match, so a `---x`, `----` or `--- text` line ended the block early.
- None read a block with no lines.
- A block that opened and never closed read as "no frontmatter", with no error.

At the wiki privacy gate a `---x` line placed before `sources` cut the block. The gate saw a mapping with no `sources` key and judged the page by a URL in its body.

The first fix patched each copy (#4185, closed unmerged). Each tightened copy exposed the defect in a new shape. A close line with trailing spaces stopped closing. A `---x` line followed by a later `---` made the YAML parse fail, and the gate took its weaker path. An empty block counted as unclosed. Each parser error had its own special case in each copy.

The replacement is one splitter, `splitFrontmatterBlock`, at `packages/wiki-write-core/src/frontmatter-block.ts:49`. It shipped in #4201 (the published package's five readers) and #4203 (the seven sites in the private packages).

## Guidance

1. **Define the lexical rule once and return a tagged result.** The `FrontmatterBlockSplit` type at `packages/wiki-write-core/src/frontmatter-block.ts:13-32` has three outcomes: `none`, `malformed` and `block`. "Opened and never closed" is its own outcome, so no caller can mistake it for "absent". The first two carry no content. The splitter does not parse YAML: each caller keeps its own parse and its own policy.
2. **Return pieces that concatenate back to the input.** A block is five strings, `opening + text + textEnding + closing + body`. An editor that changes one line rebuilds the file from the result alone, as `correctPlanConsistencyStatusLine` does at `packages/status-truth/src/detect-plan-consistency.ts:321-331`. Strings need no offset arithmetic, and they keep CRLF endings and trailing spaces on the close.
3. **Prove the shape against its later users before it ships.** The result became public API when the package released. The first change therefore carried a test that splices a line and reassembles the file for LF, CRLF and a close with trailing spaces (`packages/wiki-write-core/src/frontmatter-block.test.ts:155-194`). The second change then needed no new field and no second release.
4. **Write a table of what each caller does with each outcome before writing code.** "Treat malformed as invalid YAML" is not defined for a caller that never parsed YAML. The table in `docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md` gives one reaction per site: throw the existing error, skip with the existing warning, count as invalid, or return no metadata.
5. **List every intended behaviour change in one place, and test against the list.** Keep each old regex as a frozen reference. Outside the listed changes, old and new must be equal. Inside them, the new result must equal an expected value recorded when the test case was built (`packages/wiki-write-core/src/frontmatter-block.test.ts:447-469`). A check that only recognises the shape of an input and calls the difference intended proves nothing.
6. **Test the test.** Inject one wrong offset and one prefix-match close, and require the comparison to fail for each (`packages/wiki-write-core/src/frontmatter-block.test.ts:481-503`). Also require each changed condition to differ from the old reader on its own, so a generator that stops producing a condition is noticed.
7. **Measure real files as well as generated ones.** Run the old and new readers over every Markdown blob at a recorded commit (`git ls-tree -r`, then `git show`), and record the commits and the counts. This catches a regression on real data. It cannot replace the generated cases, because real files hold no adversarial shapes: #4185 parsed all real files unchanged and still had two blocking defects.
8. **Stop a copy from coming back.** `scripts/frontmatter-sites.test.ts:179-197` fails when a production file outside the splitter has a regex literal that starts with `^---`.

### Smaller rules from the same work

- **Bound a scan by construction.** `splitFrontmatterBlock` cuts the content at its line feeds once and visits each piece once (`packages/wiki-write-core/src/frontmatter-block.ts:50-57`), so no change to the loop body can make it run forever. This was a new scanner with an intended change of rule. For a refactor that must keep behaviour, the advice in the equivalence-refactors document below still holds: do not rewrite an algorithm to shrink its mutant surface.
- **An empty string can mean two things.** A block with no lines and a block of one blank line both have empty `text`. Only the first is an empty mapping, so the readers also check `textEnding` (`packages/wiki-write-core/src/frontmatter.ts:22`).
- **Match one line at a time when the edit is one line.** A multiline `^status:\s*…\s*$` lets `\s*` cross line endings: it dropped a CRLF, deleted blank lines after the match, and treated U+2028 as a line start. `findPlanStatusLine` at `packages/status-truth/src/detect-plan-consistency.ts:29-38` splits at `\n`, removes one trailing `\r`, and matches each line without the multiline flag.

## Why This Matters

Copies drift, and a patch to each copy moves the defect instead of removing it. One rule with one test set removes the class.

A prefix-match close in front of a trust decision is a bypass, not only a parsing bug. The structured-attribution document below covers that side.

A shape that later changes must build on is hard to change after release. Proving it against those users first costs one test.

## When to Apply

- The same parsing rule exists in three or more places.
- A fix to one copy changes what its consumers see for malformed input.
- A parser sits in front of a trust decision.
- An editor must keep every byte it does not change.

## Examples

A reader that treats the three outcomes separately, with the empty-block rule:

<!-- verify: splitFrontmatterBlock from packages/wiki-write-core/src/frontmatter-block.ts -->

```ts
function readBlock(content: string): unknown {
  const split = splitFrontmatterBlock(content)
  if (split.kind !== "block") throw new Error("missing or unclosed frontmatter")
  // Only a block with no lines is an empty mapping; one blank line parses to null.
  return split.text === "" && split.textEnding === "" ? {} : parse(split.text)
}
```

An editor that changes one line and rebuilds the file from the pieces:

<!-- verify: splitFrontmatterBlock from packages/wiki-write-core/src/frontmatter-block.ts -->

```ts
function setStatus(content: string, index: number): string | null {
  const split = splitFrontmatterBlock(content)
  if (split.kind !== "block") return null
  const lines = split.text.split("\n")
  const original = lines[index] ?? ""
  lines[index] = original.endsWith("\r") ? "status: complete\r" : "status: complete"
  return split.opening + lines.join("\n") + split.textEnding + split.closing + split.body
}
```

The input that hid `sources` from the old regex:

<!-- verify: splitFrontmatterBlock from packages/wiki-write-core/src/frontmatter-block.ts -->

```ts
const content = "---\ntitle: a\n---x\nsources: [z]\n---\nbody"
const old = /^---\n([\s\S]+?)\n---\n?/u.exec(content)?.[1] // 'title: a'
const split = splitFrontmatterBlock(content)
split.kind === "block" && split.text // 'title: a\n---x\nsources: [z]'
```

## Related

- [Structured-First Attribution for Public-Allowlist Privacy Gates](wiki-page-structured-attribution-2026-06-04.md): what the privacy gate requires now, and why the writer had to supply it before the gate became strict.
- [Shared invariants need one implementation](shared-invariants-need-one-implementation-2026-08-31.md): the general rule this applies to a parser.
- [Make failure boundaries and predicates explicit](make-failure-boundaries-and-predicates-explicit-2026-08-25.md): separate results for "absent" and "could not read".
- [Equivalence refactors need differential proofs past the bound](equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md): reference implementations and seeded inputs.
- [Loose-then-tight schema migration](loose-then-tight-schema-migration-pattern-2026-05-05.md): change the producer before the consumer becomes strict.
- `docs/plans/2026-11-12-001-refactor-shared-frontmatter-splitter-plan.md` and `docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md`: the plan and the per-site table.
- Issues and pull requests: #4148, #4183, closed #4185, #4201, #4203.
