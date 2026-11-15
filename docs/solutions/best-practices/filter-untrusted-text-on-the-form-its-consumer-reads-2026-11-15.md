---
title: Filter untrusted text on the form its consumer reads
date: 2026-11-15
category: best-practices
module: packages/wiki-write-core/src/wiki-ingest.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - untrusted text joins a file that another tool parses
  - a filter runs before a later normalisation, trim, join or truncation
  - the filter and the consumer can disagree about line endings, indentation or other syntax
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

Filter untrusted text in the form its consumer will read it: normalise it first, and make sure no later step can recreate a shape the filter removed. The consumer is the code that parses the text afterwards; here the log reader (`mergeWikiLogs`) and Markdown.

With `WIKI_LOG_MODE=single` the writer builds one log entry from a trusted heading, the trusted `Sources:` line and the agent's log text. It drops every line of the agent's text that starts with `## [` or `Sources:` (a prefix test). Before [1b7a653](https://github.com/fro-bot/.github/commit/1b7a653), `singleEntryBody` tested the raw line and then called `trim()` on the joined text. An indented first line, `  ## [2030-01-01 00:00] ingest | repo:forged/repo`, did not match the prefix, so it was kept, and `trim()` removed its indent: the log gained a forged heading beside the trusted one. The same shape left a second `Sources:` line. A bare CR (a carriage return with no line feed, as in `a\r## […`) was not a split point for `split('\n')`, yet Markdown treats it as a line ending, so a heading after it passed. [f1084f1](https://github.com/fro-bot/.github/commit/f1084f1) introduced the function inside #4244, and 1b7a653 corrected both cases in the same pull request.

## Guidance

1. **Normalise line endings first, then split.** `singleEntryBody` turns CRLF and then bare CR into LF before it splits (`packages/wiki-write-core/src/wiki-ingest.ts:1009`). The filter sees the lines the consumer will see.
2. **Test the line as the consumer sees it.** Remove leading whitespace with `trimStart()`, test the prefix with `startsWith()` (`:1010-1011`) and drop the whole line; do not edit it into something that passes. `trimStart()` is broader than Markdown's indentation rules (it also strips U+FEFF and U+2028), which errs towards dropping.
3. **Account for transformations after the filter.** A later trim, join, split or cut can expose a forbidden shape. Filter after them, or test conservatively for the shapes they can create. Here the later `trim()` removes leading whitespace from the first line, so the test removes leading whitespace from every line.
4. **Use direct prefix checks when the rule is a fixed prefix.** `trimStart()` and `startsWith()` express it without a regular expression, and the function's comment records that choice (`:998-1003`).
5. **Test each way a line can start or end that the consumer accepts.** The tests cover a space, a tab, U+FEFF and U+2028 before the marker, the marker in the middle of the text, CR-only and CRLF breaks, and a line that starts with a zero-width space, which is kept (`scripts/wiki-ingest.test.ts:2889-2975`). Assert on what the consumer parses (`mergeWikiLogs` sees one new entry), not only on the output string.
6. **Keep the lines that only look similar.** `## Notes` and `Sources are above.` stay (`scripts/wiki-ingest.test.ts:2871-2877`). A filter that drops more than the forged shapes loses the agent's text.

## Why This Matters

The filter is the only barrier between agent text and a trusted file. A heading the agent can forge starts an entry under any repository or time it names, and a forged `Sources:` line puts a source on the entry that the trusted writer did not vouch for. The defect was in the order of the steps, not in the prefix test, so a test of the prefix check alone passes it.

## When to Apply

- Untrusted text joins a file that another tool parses.
- A filter runs before a later normalisation, trim, join or truncation.
- The filter and the consumer can disagree about line endings, indentation or other syntax.

## Examples

Before 1b7a653 the filter tested the raw line, so the indented heading above passed it and `trim()` turned it into a heading. The corrected loop normalises first and tests the line as the consumer reads it (`packages/wiki-write-core/src/wiki-ingest.ts:1009-1017`):

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

The production function also collapses runs of blank lines and cuts the text at 4,000 characters (`packages/wiki-write-core/src/wiki-ingest.ts:1005-1024`).

## Related

- [A policy scanner must parse tokens, not prose](a-policy-scanner-must-parse-tokens-not-prose-2026-09-08.md): the same family, a check that reads a different form than the thing it guards.
- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): split into lines before matching one line.
- [#4244](https://github.com/fro-bot/.github/pull/4244).
