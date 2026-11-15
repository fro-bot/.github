---
title: Filter untrusted text on the form its consumer reads
date: 2026-11-15
category: best-practices
module: packages/wiki-write-core/src/wiki-ingest.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a line filter drops lines of agent or user text before the text joins a file that a parser reads
  - the text is trimmed, joined, split again or cut after the filter has run
  - the consumer treats more characters as a line ending or as indentation than the filter does
  - the filter is the only thing that stops text from forging a heading, a source or another entry
tags:
  - untrusted-input
  - line-filter
  - normalisation
  - log-injection
  - wiki-ingest
  - prefix-match
---

# Filter untrusted text on the form its consumer reads

## Context

With `WIKI_LOG_MODE=single` the writer builds one log entry from a trusted heading, the trusted `Sources:` line and the agent's log text. It drops every line of the agent's text that starts with `## [` or `Sources:`. The first version of `singleEntryBody` tested the raw line, then joined the kept lines and called `trim()` on the result ([f1084f1](https://github.com/fro-bot/.github/commit/f1084f1), inside #4244).

Two inputs got past it. A first line of `  ## [2030-01-01 00:00] ingest | repo:forged/repo` failed the prefix test, so it was kept, and `trim()` then removed its indent. The log gained two headings, the trusted one and the forged one, where one was expected. The same shape left a second `Sources:` line. A bare CR (`a\r## […`) was not a split point for `split('\n')`, and Markdown treats a bare CR as a line ending. [1b7a653](https://github.com/fro-bot/.github/commit/1b7a653), in the same pull request, fixed both.

## Guidance

1. **Normalise line endings first, then split.** `singleEntryBody` turns CRLF and then bare CR into LF before it splits (`packages/wiki-write-core/src/wiki-ingest.ts:1009`). The filter sees the lines the consumer will see.
2. **Test each line in the form the consumer will test it.** The consumer may ignore leading whitespace, so the filter calls `trimStart()` and then `startsWith` (`:1010-1011`). Drop the whole line; do not edit it into something that passes.
3. **Make sure no later step can undo the filter.** `trim()`, `join`, a second split or a cut can create the very shape the filter removed. Here `trim()` ran after the filter and turned an indented first line into a heading. Either filter last, or make the filter's test equal to what the later step does: `trimStart()` in the test is what `trim()` does to the first line.
4. **Prefer `startsWith` and `trimStart` to a regular expression for text you do not control.** A prefix test has no backtracking to attack, and the code comment states the rule: "not matched with a pattern, because the text is untrusted" (`:998-1003`).
5. **Test each way a line can start or end that the consumer accepts.** The tests cover a space, a tab, U+FEFF and U+2028 before the marker, the marker in the middle of the text, CR-only and CRLF breaks, and a line that starts with a zero-width space, which is kept (`scripts/wiki-ingest.test.ts:2889-2975`). Assert on what the consumer parses (`mergeWikiLogs` sees one new entry), not only on the output string.
6. **Keep the lines that only look similar.** `## Notes` and `Sources are above.` stay (`scripts/wiki-ingest.test.ts:2871-2877`). A filter that drops more than the forged shapes loses the agent's text.

## Why This Matters

The filter is the only barrier between agent text and a trusted file. A heading the agent can forge starts an entry under any repository or time it names, and a forged `Sources:` line puts a source on the entry that the trusted writer did not vouch for. The defect was in the order of the steps, not in the prefix test, so a test of the prefix check alone passes it.

## When to Apply

- A step drops, masks or rewrites lines of untrusted text and the result joins a file that another tool parses.
- The text goes through `trim`, `join`, `split`, `slice` or an encoding step after the check.
- The consumer is Markdown, YAML, a log format or a shell: each has its own idea of a line end and of indentation.

## Examples

The first version, which tests the raw line and trims afterwards:

```ts
function body(text: string): string {
  const kept: string[] = []
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("## [") || line.startsWith("Sources:")) continue
    kept.push(line)
  }
  return kept.join("\n").trim()
}
```

The fixed version normalises first and tests the line as the consumer reads it (`packages/wiki-write-core/src/wiki-ingest.ts:1009-1017`):

```ts
function body(text: string): string {
  const kept: string[] = []
  for (const line of text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const start = line.trimStart()
    if (start.startsWith("## [") || start.startsWith("Sources:")) continue
    kept.push(line)
  }
  return kept.join("\n").trim()
}
```

## Related

- [A policy scanner must parse tokens, not prose](a-policy-scanner-must-parse-tokens-not-prose-2026-09-08.md): the same family, a check that reads a different form than the thing it guards.
- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): split into lines before matching one line.
- [#4244](https://github.com/fro-bot/.github/pull/4244).
