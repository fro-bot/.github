---
title: "refactor: replace the copied frontmatter regexes with one shared splitter"
type: refactor
status: active
date: 2026-11-12
origin: docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md
---

# refactor: replace the copied frontmatter regexes with one shared splitter

## Overview

Twelve sites in six packages find a YAML frontmatter block with their own regex. This plan adds one splitter to the published `@fro.bot/wiki-write-core`, moves every site onto it, and makes the wiki privacy gate require a valid block with a matching source. The work lands as two PRs and one npm release.

## Problem Frame

Every copy ends the block at the first line that starts with `---`, so a `---x` or `----` line cuts the block short. Nine copies ignore CRLF files, none reads an empty block, and an unclosed block is read as "no frontmatter" without an error. At the privacy gate these gaps let a page hide its real `sources` and pass on a URL in its body. A first fix that patched each copy (#4185) was closed after its review reproduced the decoy route again (see origin: `docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md`).

## Requirements Trace

Carried from the origin document:

- R1–R9. One splitter with a defined block rule: exact opening line, whole-line close with optional trailing spaces or tabs, LF and CRLF, three outcomes, an empty block is a block, the body is byte-exact, linear time, no YAML parsing.
- R10–R11. The splitter is an export of the published package, and `knowledge`, `reports` and `status-truth` gain a production dependency on it.
- R12–R15. The privacy gate passes a public repo page only with a valid mapping block whose `sources` matches. The body-URL fallback is removed, every blocked case reports `unattributable-page`, and the gate's other rules stay.
- R16–R19. Each other site reacts to a malformed block with a behaviour it already has, keeps its own body handling, and returns today's result for unaffected files. The plan-status corrector makes no correction for a block that is malformed or not a YAML mapping.
- R20–R22. A differential test per site against its old regex, a linear-growth test, and the solution docs and package-graph docs updated in the same change.
- R23. When the ingest writes the target repository's page and that page lists no sources, the page's `sources` holds that repository's URL.

## Scope Boundaries

- New kinds of message in sites that are silent on bad frontmatter today.
- The YAML parser and its options, and the gate's URL match.
- The three test-only parsers the origin document excludes.
- `GATE_CONTRACT_VERSION` stays at 1.
- Wiring the dashboard to the new release. Renovate raises that PR in `fro-bot/dashboard`.
- A write-time attribution gate, in the ingest or in the dashboard.

### Deferred to Separate Tasks

- One page with bad frontmatter empties the baseline wiki context for every agent run, because wiki query throws and the run continues without context. An unclosed block now counts as bad, so this is easier to hit. A fix that skips the one page is a separate change.

## Intended Behaviour Changes

Every observable change, in one place. The differential tests and the pinned-corpus check measure differences against this list. A difference that is not on it is a defect.

- The origin's other seven: a line that starts with `---` but is not a close no longer ends the block; spaces or tabs after the close belong to the close; CRLF files are read by the nine sites that were LF only; an empty block is a block; an unclosed block is malformed; the privacy gate blocks a public repo page without a valid block and a matching source; the plan-status corrector makes no correction for a block that is not a YAML mapping.
- The writer stamp (R23): the ingest adds the target's URL to the target's page when that page lists no sources, and to a page it migrates by a trusted node ID when no entry matches the target.
- Wiki lint reports an unclosed page as `invalid-frontmatter`. It reported `missing-frontmatter`.
- Wiki repair no longer rewrites an unclosed page. It counts the page as out of scope, as it does for any `invalid-frontmatter` finding.
- Solutions search's skip warning for an unclosed block carries the fixed reason `unclosed-frontmatter`, with no position.
- The wiki page reader's error for an unclosed block is the fixed string `Invalid frontmatter: missing closing --- delimiter`.
- The repo-page move reads a CRLF page, which its reader rejected before. Where it must repair `related` on one, it re-renders the block structurally. That writes LF line endings and canonical layout in the block, and it trims the body at both ends, as it does for any layout the text edit does not recognise.
- The rename path (`packages/registry/src/rename-tracked-repo.ts`) reads CRLF pages and `---x` blocks through `parseFrontmatterDocument`. Each of its reads returned false or fell back when the reader threw, so a CRLF page that was treated as unattributed is now attributed when its node ID and sources match.
- A document whose first line is `---` with no later close is malformed at every site. A thematic break at the top of a file with no frontmatter is one example. The sites read it as no block before.
- The `legacy-substring-attribution` warning is gone. Only the gate emitted it, and nothing else in the repository reads it.

## Context & Research

### Relevant Code and Patterns

- The five in-package sites: `packages/wiki-write-core/src/frontmatter.ts` (`parseFrontmatterDocument`), `wiki-utils.ts` (`splitFrontmatter`), `wiki-ingest.ts` (`parseFrontmatter` and a private `parseFrontmatterDocument`) and `repo-page-move.ts` (`editRelatedText`).
- The seven private sites: `packages/wiki-ops/src/solutions-query.ts`, `packages/knowledge/src/capture-learnings-harvest.ts`, `packages/knowledge/src/capture-patterns-synthesis.ts`, `packages/reports/src/improvement-metrics-detect.ts`, `packages/privacy/src/check-wiki-private-presence.ts` (`parseFrontmatterSources`) and `packages/status-truth/src/detect-plan-consistency.ts` (`parsePlanFrontmatterStatus`, `correctPlanConsistencyStatusLine`).
- Linear scanners that replaced regexes, with their tests: `packages/knowledge/src/drafted-solutions-pr-body.ts` (`findCoverageBlock`) with `drafted-solutions-coverage-block-scan.test.ts`, and `packages/wiki-write-core/src/line-scanners.ts` with `line-scanners.test.ts`. Both keep the old regex as a reference and compare on seeded inputs.
- A differential test inside a mutated module's test set: `packages/registry/src/required-checks-differential.test.ts`.
- Growth tests that do not depend on wall-clock limits: `packages/wiki-write-core/src/regex-redos-regressions.test.ts` (`measureScalingRatio`) and the `regex-scaling.test.ts` files in `knowledge`, `reports` and `wiki-ops`.
- The rename path already adds a repository's URL to a moved page's `sources` (`repo-page-move.ts`, the block that pushes `target.newUrl`). `prepareWikiPage` in `wiki-ingest.ts` decides each repo page's identity. It has three return paths that write a page: the untrusted-identity path and the plain path, both through `updateRepoPageFrontmatter`, and the node-ID migration through `mergeRepoPageContent`. It already tells the target's page from the others with `isTargetPage`.
- The private packages resolve the published package from the workspace as `.ts` source, so no npm release is needed before they import a new export.
- `scripts/package-layout.test.ts` enforces dependency declarations, `workspace:*`, lock parity and cycles. It does not check the README diagrams or the "imports only" prose.
- The dashboard imports the package's root entry and calls `parseFrontmatterDocument`, `reconstructFrontmatter`, `lintWikiSnapshot` and `buildWikiIngestChanges`. It compares only the integer `version` in `dist/gate-contract.json` and answers every save with HTTP 424 on a mismatch.

### Institutional Learnings

- `docs/solutions/best-practices/equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md`: keep a verbatim reference, and pair explicit cases with seeded inputs past any bound.
- `docs/solutions/best-practices/moving-a-script-into-a-workspace-package-changes-its-contract-2026-11-05.md`: an exported function's input is library input for CodeQL.
- `docs/solutions/best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md`: absent, unreadable and present are separate results.
- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`: tests that must kill mutants import the module by relative path, and constants live inside functions.
- `docs/solutions/best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md`: read the first live run of each changed path.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "build-new-within-scope",
  "scope": "fro-bot/.github main@9a62f27: packages/*/src, scripts/, .github/, quartz-site/, bun.lock, test-kit, and the closed branch fix/frontmatter-closing-delimiter@ed92577",
  "freshness": {
    "vcs_reference": "fro-bot/.github main 9a62f27"
  },
  "budget": {
    "max_search_passes": 8,
    "max_candidate_inspections": 30,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "packages/wiki-write-core/src/frontmatter.ts:parseFrontmatterDocument",
      "description": "Exported. Finds the block with a regex, parses it as YAML, throws when there is no match or the value is not a record, returns the values and body.",
      "disposition": "insufficient",
      "insufficiency_reason": "Fuses the split with the YAML parse and throws for every failure. LF only, prefix-match close, no empty block, unclosed is the same as absent. It becomes a caller of the splitter."
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-utils.ts:splitFrontmatter",
      "description": "Exported. Same regex; returns the parsed frontmatter, a trimmed body and an error only for a YAML parse failure.",
      "disposition": "insufficient",
      "insufficiency_reason": "No block text without a YAML parse, no malformed outcome, LF only, trims the body. Its name is taken in the root entry, so the new export needs another name."
    },
    {
      "path_or_symbol": "packages/privacy/src/check-wiki-private-presence.ts:parseFrontmatterSources",
      "description": "Private. CRLF-tolerant regex; returns null for absent, unparseable, non-mapping or no sources key, else the URL list.",
      "disposition": "insufficient",
      "insufficiency_reason": "Prefix-match close, no empty block, and null conflates every failure, which is the decoy route."
    },
    {
      "path_or_symbol": "packages/status-truth/src/detect-plan-consistency.ts:correctPlanConsistencyStatusLine",
      "description": "Exported. Regex captures opener, block and closer, rewrites the status line and splices the original bytes back.",
      "disposition": "insufficient",
      "insufficiency_reason": "Its closer capture omits trailing whitespace and it never parses YAML. It needs the splitter's byte layout."
    },
    {
      "path_or_symbol": "packages/knowledge/src/drafted-solutions-pr-body.ts:findCoverageBlock",
      "description": "Linear scan for a marker line, a payload and a terminator; returns the payload or undefined.",
      "disposition": "insufficient",
      "insufficiency_reason": "Different delimiters, and unclosed is reported as undefined. Its shape and its reference test are the pattern to follow."
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/line-scanners.ts:findIndexEntryLines",
      "description": "Linear replacement for the wiki index line regexes, with a seeded differential against the old regexes.",
      "disposition": "insufficient",
      "insufficiency_reason": "Finds index entry lines, not a leading block. Precedent for placement and tests."
    },
    {
      "path_or_symbol": "fix/frontmatter-closing-delimiter@ed92577:packages/wiki-write-core/src/wiki-utils.ts",
      "description": "The closed attempt: a per-copy regex patch plus an unclosed check.",
      "disposition": "insufficient",
      "insufficiency_reason": "Review reproduced the decoy route through ---x and ---- lines and a wrongly blocked empty block. Its test cases are reusable as corpus entries."
    },
    {
      "path_or_symbol": "micromark-extension-frontmatter@2.0.0 (bun.lock)",
      "description": "Transitive dev-tool dependency: a micromark tokenizer extension for a frontmatter fence.",
      "disposition": "insufficient",
      "insufficiency_reason": "Needs a micromark pipeline, would be a new production dependency of the published package, and defines its own fence grammar."
    }
  ]
}
```

The eight other regex copies and the three test-only parsers were inspected too. Each is a copy of one of the shapes above.

## Key Technical Decisions

- **Two PRs, one release.** The first PR changes the published package, the tests elsewhere that pin its readers, and the mutation config: the splitter, its five readers and the writer stamp (R23). Its title is a `feat`, which cuts 0.2.0. Unit 3 records the live checks for it. The second PR changes the private packages, makes the gate strict and updates the docs, and cuts no release. In that order the writer stamps the target's page before the gate requires `sources`. Between the two PRs the privacy gate behaves as it does today. Wiki repair reads pages through the package's reader, so it changes in the first PR (see Intended Behaviour Changes). `wiki-repair.test.ts` and `packages/privacy/src/repo-page-move.test.ts` are edited in both PRs.
- **The splitter lives in its own module and is exported through `./frontmatter`.** `frontmatter.ts` is already in the root entry and has its own subpath, so no manifest or export-list edit is needed. A separate module keeps the mutation target small.
- **The new export does not reuse the name `splitFrontmatter`.** That name is already exported at the root through `wiki-lint.ts`, and a second export of it fails to compile.
- **The splitter's result is public API from 0.2.0, so Unit 1 fixes its shape before the first PR merges.** With a block it gives the block text, the body and the offsets or slices of the opening and closing lines. The two sites that rewrite a file in place (the repo-page move and the plan-status corrector) need them to keep every byte they do not change (R17), and Unit 1 proves that they can splice through the result alone. Needing more from the shape in the second PR would mean a second release. The no-block and malformed results carry no content.
- **The splitter module has no regular expression, uses erasable TypeScript syntax only and has no import side effects.** The close test is a character loop. Node strip-only loading in `Test Scripts Load` must work, and an exported function with no regular expression adds nothing for CodeQL to report as library input.
- **`GATE_CONTRACT_VERSION` stays at 1.** A bump makes every dashboard save fail until the dashboard ships a release. No page on `data` is affected at the measured commit, and the dashboard already has a message for both lint finding kinds. The dashboard builds and writes with its own installed package, so on 0.1.4 it can write a page that `main`'s readers refuse; see Risks. `dist/gate-contract.json` is regenerated because the source hash changes.
- **The writer stamps the target's page (R23).** The ingest adds `{url, accessed}` to the page whose slug is the `repo:` target's slug (the existing `isTargetPage` test in `prepareWikiPage`), and only when that page's frontmatter has no `sources` key or an empty `sources` array. The `url` is `https://github.com/<owner>/<name>` from the parsed target. The `accessed` value is the date of the ingest's `timestamp`. Outside a migration, a page that lists sources is never changed, whether or not they include the target: a target page with sources that do not match stays blocked at the gate, exactly as today. The one exception is the node-ID migration merge. There the ingest has matched the old page to the target by a trusted node ID, so the merged page gains the target's URL when no entry matches it, and keeps every other entry. The rename path does the same. Other repo pages in the same write are never stamped. The stamp applies on every return path of `prepareWikiPage` that writes the target page, including the node-ID migration merge through `mergeRepoPageContent`. The stamp applies only when the target's owner and name are each a plain GitHub name: non-empty, only ASCII letters, digits, `.`, `_` and `-`, and not `.` or `..`. For any other target the page is written without a stamp, as before, and the ingest does not throw. When the incoming page has no sources and the existing page on `data` at that slug has a `sources` array with an entry for the target, the written page carries that array whole and unchanged, so a repeat survey produces no diff in `sources` and a repeat after a node-ID migration keeps the migrated page's other URLs. When the existing array has no entry for the target, or there is no existing page, the page gets the one new entry.
  - Trust basis: the survey's target is the repository `resolve-public-repo` resolved. The Fro Bot content and Observe jobs set the target to this repository, so the stamp only ever applies to this repository's own page there. The dashboard passes a page path, not a `repo:` target, so its saves are never stamped.
  - Limit: the stamp records which repository the write was for. It does not check what the page says, and the gate never did.
- **The corrector checks the mapping with the package's reader.** `parseFrontmatterDocument` already throws unless the block is a YAML mapping. `status-truth` needs the package edge for the splitter anyway, so it takes no second parser dependency.
- **Only a block whose text is the empty string is an empty mapping.** A block of only whitespace, only comments, `null` or `...` parses to `null`. Each caller then applies the rule it has today for a non-mapping.
- **The splitter joins the mutation gate.** The privacy decision depends on it, and the gate's own module imports it by package name, so the gate's mutants do not exercise it.
- **Differential tests keep an independent oracle.** Each test keeps the old regex as a frozen reference and states an independent expected result for each changed condition. Outside the changed conditions, old and new must be equal. Inside them, new must equal the stated expected result. A classifier that only notices the shape of the input is not an oracle. A test-of-the-test shows that a deliberately wrong offset or decision fails. The corpus is a seeded generator copied into each package's test, because the published package cannot depend on the test kit.
- **The real-corpus check runs outside CI for `data`.** CI has no `data` checkout. Before each PR the implementer enumerates the Markdown blobs with `git ls-tree -r` at a recorded commit of `origin/data` and of `origin/main`, and reads each with `git show`. A scratch script that is not committed runs each site's frozen old reader and new reader over the paths that site reads. It reports counts only. The PR records the two commits and the counts. The check covers readers only: the writer stamp is an intended output change and is excluded. If the objects are not available, the check is reported blocked. At the measured commits, `origin/data` `62f9a45` has 266 Markdown blobs and none opens an unclosed block, and `docs/` at `f9affca` has 188 files and none does. A CI test covers `docs/`, which is in the checkout.

## Open Questions

### Resolved During Planning

- Does the wiki page reader's new error need a gate-contract version bump? No. See Key Technical Decisions.
- How is the work split? Two PRs, package first.
- How does the corrector check for a YAML mapping? With `parseFrontmatterDocument` in a `try`.
- Does the splitter join `mutate`? Yes, in one shard.
- What does solutions search report for an unclosed block? Its existing skip warning, with the fixed reason `unclosed-frontmatter` in place of a parser code.
- What does the repo-page move do with a CRLF page? Its text edit declines and the caller re-renders the block structurally, as it does today for a layout it does not recognise. That writes LF line endings in the block.
- What does pattern synthesis do when its reader throws? Its caller catches, counts the document as invalid and continues.

### Deferred to Implementation

- The splitter's exported name and the exact fields of its result, which Unit 1 fixes before the first PR merges.
- Which shard list takes the splitter. Use the lightest by the procedure in `packages/ci-checks/README.md`.
- The mutant count and run time of the splitter at a 100% score.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

What each site does with the three outcomes, after both PRs:

| Site | No block | Block | Malformed block |
| --- | --- | --- | --- |
| Frontmatter document reader (one function after Unit 2; the ingest's private copy is removed) | Throws missing-frontmatter | Parses; empty text is an empty mapping; throws unless a mapping | Throws missing-frontmatter |
| Wiki page reader | Empty metadata, whole text as body | Parses; a parse error becomes its frontmatter error | Frontmatter error |
| Wiki ingest page parser (`parseFrontmatter`) | Throws its missing-frontmatter error | Parses and checks required fields | Throws its missing-frontmatter error |
| Repo-page move text edit | Not reached; the document reader throws first | Edits the related lines for an LF layout, else declines | Not reached |
| Solutions search | Keeps the document with no metadata | Parses; a parse error skips with a warning | Skips with the warning |
| Learnings harvest | Keeps the document with no metadata | Parses; a parse error skips silently | Skips silently |
| Pattern synthesis | Keeps the document with no metadata | Parses; a parse error counts as invalid | Counts as invalid |
| Improvement metrics | No metadata | Parses; any failure is no metadata | No metadata |
| Privacy gate, public repo page | Blocked | Passes only as a mapping with a matching source | Blocked |
| Plan-status resolver | Unavailable | Reads the status line | Unavailable |
| Plan-status corrector | No correction | Corrects only when the block is a YAML mapping | No correction |

## Implementation Units

### Phase 1: the published package (first PR, one minor release) and its live checks

- [x] **Unit 1: The splitter**

**Goal:** Add the splitter as a new module in the published package, exported through `./frontmatter`, with its proof.

**Requirements:** R1–R9, R10, R20, R21.

**Dependencies:** None.

**Files:**

- Create: `packages/wiki-write-core/src/frontmatter-block.ts`
- Create: `packages/wiki-write-core/src/frontmatter-block.test.ts`
- Create: `packages/wiki-write-core/src/frontmatter-block-scaling.test.ts` (growth test, outside `testFiles`)
- Modify: `packages/wiki-write-core/src/frontmatter.ts` (re-export)
- Modify: `stryker.config.json` (`mutate`, `testFiles`), `mutation-guards.json` (one `shards` list)
- Modify: `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- A line-based scan from offset 0 that never backtracks. It returns no block, a block or a malformed block.
- The block result carries the block text, the body, and the layout of the opening and closing lines. The shape is public API from 0.2.0, so it is fixed here, with the in-place editors in mind, before the first PR merges. Needing more from it in the second PR would mean a second release.
- The no-block and malformed results carry no content.
- No regular expression, erasable TypeScript syntax only, no import side effects, and no module-level constants that a mutant could hide in.
- The growth test goes in its own file. `regex-redos-regressions.test.ts` holds only guards that fail on pre-fix code, and the old regexes are linear.
- The seeded corpus is a generator in the test file. Later tests copy it, because the published package cannot depend on the test kit.

**Execution note:** Implement test-first.

**Patterns to follow:** `findCoverageBlock` and `line-scanners.ts` for the scan and docblock-as-spec style; `line-scanners.test.ts` for the seeded differential; `regex-redos-regressions.test.ts` for the growth measurement (`measureScalingRatio`).

**Test scenarios:**

- Happy path: a block with LF, with CRLF, and with mixed endings gives the block text and the body after the closing line.
- Happy path: a close followed by spaces or tabs closes the block, and the body starts on the next line.
- Edge case: a first line of `--- ` with a trailing space, a byte-order mark before `---`, and a blank first line each give no block.
- Edge case: `---` directly followed by `---` gives a block with empty text; the same at the end of the content with no final line ending gives an empty body.
- Edge case: a closing `---` that is the last line with no line ending closes the block.
- Edge case: `---x`, `----` and `--- text` lines inside a block are content, and the block ends at the later exact close.
- Edge case: a lone CR is not a line ending. A close of `---\r` at the end of the content is content, so the block is unclosed. A close of `---\r\n` inside otherwise LF content closes the block.
- Edge case: a body that starts with `---` is not split again.
- Error path: an opened block with no close is malformed; so is a file that is only `---`. Neither result carries content.
- Integration: for every input in a seeded corpus, the opening, block text, closing and body pieces concatenate back to the original content.
- Integration: splicing a changed line into the block and reassembling the file from the result alone gives the original bytes plus that one change, for LF, for CRLF and for a close with trailing spaces.
- Integration: the module's source has no import, no regular expression literal and no `RegExp` call.
- Integration: against each of the four old regex shapes, kept as frozen references, over the seeded corpus, old and new are equal outside the changed conditions, and inside them new equals an independently stated expected result (block text, body and decision). The corpus reaches each outcome in volume.
- Test of the test: a deliberately wrong offset, and a deliberately wrong decision for a changed condition, each make the differential fail.
- Growth: time on an unclosed block, on many near-close lines and on one very long line grows linearly between a size and four times that size.

**Verification:** The new module scores 100% in the mutation gate with no disable directives. The package check passes with a regenerated `dist/gate-contract.json`. The root entry still compiles.

- [x] **Unit 2: The five in-package readers and the writer stamp**

**Goal:** Move the package's own readers onto the splitter and make the ingest stamp the target's page.

**Requirements:** R6, R10, R16, R17, R19, R20, R23.

**Dependencies:** Unit 1.

**Files:**

- Modify: `packages/wiki-write-core/src/frontmatter.ts`, `wiki-utils.ts`, `wiki-ingest.ts`, `repo-page-move.ts`
- Create: `packages/wiki-write-core/src/frontmatter-readers-differential.test.ts`
- Modify: `mutation-guards.json` (the `frontmatter.ts` and `wiki-utils.ts` not-mutated reasons, which stop being true)
- Modify: `packages/wiki-write-core/README.md` (the splitter's contract, the finding-kind change, the stamp, the unchanged gate version)
- Test: `packages/wiki-write-core/src/wiki-write-core.test.ts`, `scripts/wiki-utils.test.ts`, `scripts/wiki-ingest.test.ts`, `scripts/wiki-lint.test.ts`, `packages/privacy/src/repo-page-move.test.ts`, `packages/privacy/src/check-wiki-private-presence.test.ts`, `packages/registry/src/rename-tracked-repo.test.ts`, `packages/wiki-ops/src/wiki-query.test.ts`, `packages/wiki-ops/src/wiki-repair.test.ts`
- Modify: `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- Each reader keeps its error texts and its body handling. The document reader and the ingest page parser treat a malformed block as a missing one. The wiki page reader returns `Invalid frontmatter: missing closing --- delimiter`.
- Only a block whose text is the empty string is an empty mapping. The document reader and the ingest parser use an empty mapping for empty text before their mapping check. A block that parses to `null` (whitespace, comments, `null`, `...`) keeps each reader's rule for a non-mapping: the document reader and the ingest parser throw their not-an-object error, and the wiki page reader returns empty frontmatter, as it does now.
- The private `parseFrontmatterDocument` in `wiki-ingest.ts` goes; the module uses the exported one.
- `editRelatedText` uses the splitter's layout and declines for a CRLF block, so its caller re-renders structurally.
- The stamp follows the Key Technical Decision. It runs on the final page of every return path of `prepareWikiPage` that writes the target page, which is the plain path, the untrusted-identity path and the node-ID migration merge. A page counts as having an entry for the target by the gate's URL rule (`https`, host `github.com`, owner and name compared without case, trailing path allowed). The package cannot import the gate, so the matcher is a small copy, and a test runs it against the gate's own cases. The `accessed` date comes from `params.timestamp`.
- A `sources` value that is not an array, such as `null` or a string, is left as it is.
- The stamp validates the target's owner and name before it applies (a name with a slash, a space, `?`, `#` or a newline gets none), without changing what `repoTargetParts` returns to its other callers.

**Execution note:** Add characterization tests for the ingest's document reader and the move's text edit before changing them.

**Patterns to follow:** The rename path's `sources` handling in `repo-page-move.ts`; `isTargetPage` in `prepareWikiPage` for the target test.

**Test scenarios:**

- Happy path: every existing reader test for a well-formed LF page passes unchanged.
- Happy path: a CRLF page is read with its metadata by the wiki page reader and the document reader.
- Edge case: an empty block gives an empty mapping from the document reader; the ingest parser rejects it for its missing required fields.
- Edge case: a block of only whitespace, only comments, `null` or `...` is not an empty mapping. The document reader and the ingest parser throw their not-an-object error, and the wiki page reader returns empty frontmatter.
- Edge case: `a: 1` followed by `...` is a mapping. `...` between two keys is invalid YAML and gives each reader the error it has today for invalid YAML.
- Error path: an unclosed page, and a file that is only `---`, give the wiki page reader's frontmatter error; wiki lint reports `invalid-frontmatter` for each, where it reported `missing-frontmatter`.
- Error path: an unclosed page makes the ingest parser and the document reader throw their existing missing-frontmatter errors, with unchanged text.
- Error path: wiki repair counts an unclosed page as out of scope and does not rewrite it.
- Edge case: the move's text edit on an LF page keeps every byte outside the edited lines; on a CRLF page the result is the structural re-render.
- Edge case: the rename path reads a CRLF page: `isAttributedPage` is true for a CRLF page whose node ID or sources match, and false for an unclosed page.
- Happy path: the ingest writes a new repo page for the target whose frontmatter has no `sources`; the written page lists `{url, accessed}` with the target's URL and the date of the timestamp. The same for `sources: []`.
- Edge case: a target page that lists any sources is not changed, whether or not they include the target. A target page whose sources do not match is written unchanged, and the gate still blocks it.
- Edge case: a target page whose `sources` is `null` or a string is written unchanged.
- Edge case: a write with several repo pages stamps only the target's page. The other pages gain no `sources`.
- Edge case: a node-ID migration merge whose merged page has no sources gets the stamp. One whose merged page lists the old URL only keeps that entry and gains the target's URL, so the gate passes it. One whose merged page already lists the target's URL is written with no added entry. A write through the untrusted-identity path for the target's page gets the stamp.
- Edge case: a non-repo page, and a write whose target is a page path rather than a `repo:` target (the dashboard's case), get no stamp.
- Idempotence: a second ingest of source-less incoming content over the first one's output leaves `sources` byte for byte the same, and the package's source reader returns the entry.
- Edge case: when the existing page already has an entry for the target and the incoming page has none, the existing `sources` array is carried whole and unchanged, including the target entry's `accessed` date and every other entry in order. A second and third ingest after a node-ID migration leave `sources` as the first one wrote it.
- Edge case: a target whose owner or name has a slash, a space, `?`, `#` or a newline is written without a stamp, on both the plain and the migration path; a name with dots, underscores and dashes is stamped.
- Integration: a page written by the ingest for its target passes the gate. The same page with non-matching sources is blocked.
- Integration: wiki query on a wiki with one unclosed page throws, and the baseline run continues with no wiki context, as it does today for a page with invalid YAML.
- Integration: per site, over the seeded corpus, the frozen old regex and the new reader are equal outside the changed conditions, and inside them the new reader equals the stated expected result. This covers `frontmatter.ts`, `wiki-utils.ts`, the ingest's page parser, the ingest's former private document reader and the move's text edit. A deliberately wrong offset or decision fails each.
- Rewritten: the ingest test that asserts the target's URL is absent after a refresh ('falls back to the current slug for legacy pages and backfills node_id') now expects the existing entry kept with its original date. The collision test that pins the full output ('keeps a collision page distinct while merging the node-matched page into the target slug') now expects the stamp in that output.

**Verification:** The package check passes. The dashboard's calls (`parseFrontmatterDocument`, `reconstructFrontmatter`, `lintWikiSnapshot`, `buildWikiIngestChanges`) return unchanged results on LF inputs that no intended change affects, and a page-path target is never stamped. The pinned-corpus check shows no reader difference and is recorded in the PR with its two commits and counts.

- [ ] **Unit 3: Live checks after the first PR**

**Goal:** Confirm the release and the stamp on their first real runs, before the gate changes.

**Requirements:** R23.

**Dependencies:** Units 1 and 2 merged.

**Files:**

- Modify: `docs/plans/2026-11-12-001-refactor-shared-frontmatter-splitter-plan.md` (record the results)

**Approach:**

- The release publishes as 0.2.0.
- One survey persist writes a page that lists the target's URL in `sources`. Read the page from `data`.
- The next promotion passes both gates.
- The next wiki lint run reports no new finding.
- The dashboard's marker fetch still sees version 1.

**Test expectation:** none -- live verification of shipped behaviour.

**Verification:** Each item above is recorded in this plan with its run. Unit 4 does not start before the survey persist is recorded.

### Phase 2: the private packages and the gate (second PR, no release)

- [ ] **Unit 4: The privacy gate**

**Goal:** The gate reads attribution through the splitter and blocks every public repo page without a valid block and a matching source.

**Requirements:** R12–R15, R20.

**Dependencies:** Units 1 and 2 merged and Unit 3 recorded.

**Files:**

- Modify: `packages/privacy/src/check-wiki-private-presence.ts`
- Test: `packages/privacy/src/check-wiki-private-presence.test.ts`, `packages/wiki-ops/src/wiki-repair.test.ts`, `packages/privacy/src/repo-page-move.test.ts`

**Approach:**

- `parseFrontmatterSources` keeps its name and its one-argument call, because the solution doc's example is checked against it.
- No block, a malformed block, invalid YAML, a non-mapping and a mapping with no `sources` key all end in `unattributable-page`. The body is never read, and no parser message reaches the output.
- The fallback branch and its `legacy-substring-attribution` warning are removed.
- The ambiguous-slug block and the unchanged-from-`main` pass run as before, ahead of the attribution read.

**Execution note:** Rewrite the tests that pin the fallback first, so they fail on the current gate.

**Test scenarios:**

- Happy path: a public repo page with a matching source passes, whatever its body contains.
- Error path: a body that contains the repository's URL does not rescue a page with no block, an unclosed block, invalid YAML, a list block, a scalar block, an empty block, a block of only comments, or a mapping with no `sources` key. Each reports `unattributable-page`.
- Error path: non-matching sources, then a `---x` line, then a later `---`, with the URL in the body: blocked. The same with `----` and with `--- text`.
- Edge case: a CRLF page and a page whose close has trailing spaces are read and judged on their sources.
- Edge case: present-but-empty and non-array `sources` are still blocked.
- Edge case: a slug shared by two public repositories still reports `ambiguous-public-slug`.
- Edge case: a non-public page equal to its `main` copy passes without its block being read; a changed one is blocked.
- Error path: the gate writes no warning line and no page content or YAML message for any blocked page.
- Integration: wiki repair with one blocked public page aborts as `privacy-leak` before any commit.
- Integration: over the seeded corpus, the gate's frozen old decision and the new decision are equal outside the changed conditions (the fallback and the block rule), and inside them the new decision equals the stated expected result. A deliberately wrong decision fails the test.

**Verification:** `check-wiki-private-presence.ts` keeps a 100% mutation score. Immediately before the second PR is pushed, the strict gate runs over the then-current `data` and `main` commits and blocks no page. The two commits are recorded in the PR.

- [ ] **Unit 5: The other six private sites and the dependency edges**

**Goal:** Move solutions search, learnings harvest, pattern synthesis, improvement metrics and the two plan-status sites onto the splitter.

**Requirements:** R1, R11, R16–R19, R20.

**Dependencies:** Units 1 and 2 merged.

**Files:**

- Modify: `packages/wiki-ops/src/solutions-query.ts`, `packages/knowledge/src/capture-learnings-harvest.ts`, `packages/knowledge/src/capture-patterns-synthesis.ts`, `packages/reports/src/improvement-metrics-detect.ts`, `packages/status-truth/src/detect-plan-consistency.ts`
- Modify: `packages/knowledge/package.json`, `packages/reports/package.json`, `packages/status-truth/package.json`, `bun.lock`
- Modify: `mutation-guards.json` (the not-mutated reasons for `capture-patterns-synthesis.ts` ("splitFrontmatter (9)"), `improvement-metrics-detect.ts` ("splitFrontmatter (15)") and `solutions-query.ts` ("the frontmatter parse that skips a malformed doc"), which describe functions this unit removes)
- Test: `packages/wiki-ops/src/solutions-query.test.ts`, `packages/knowledge/src/capture-learnings-harvest.test.ts`, `packages/knowledge/src/capture-patterns-synthesis.test.ts`, `packages/reports/src/improvement-metrics-detect.test.ts`, `packages/status-truth/src/status-truth-detect.test.ts`, `scripts/package-layout.test.ts`, and the `regex-scaling.test.ts` files in `wiki-ops` (its solutions-search cases build the unclosed-fence inputs), `knowledge` and `reports`

**Approach:**

- Each site keeps its reaction and its body handling from the table above. Solutions search reports an unclosed block through its existing warning with the fixed reason `unclosed-frontmatter`, and the closed-vocabulary test in `solutions-query.test.ts` gains it.
- Only empty block text becomes an empty mapping. The four sites that parse already return empty frontmatter for a block that parses to a non-mapping, so they need no change for `null`.
- The plan-status resolver stays line-based. The corrector makes no correction unless `parseFrontmatterDocument` accepts the block, and splices through the splitter's layout.
- `reports` keeps its exported `splitFrontmatter` as a thin wrapper over the splitter. No production code imports it. It stays for its own `regex-scaling.test.ts` and the README row.
- `knowledge` moves the package from a development dependency to a production one. `reports` and `status-truth` add it. The lockfile changes by those four lines only.

**Execution note:** Add raw-input characterization tests for harvest, synthesis and metrics before changing them. They have no frontmatter-shape tests today.

**Test scenarios:**

- Happy path: each site returns today's result for a well-formed LF document.
- Happy path: a CRLF document's metadata is read by solutions search, harvest, synthesis and metrics.
- Error path: an unclosed document, and a file that is only `---`, are skipped with the warning by solutions search, skipped silently by harvest, counted invalid by synthesis, and read as no metadata by metrics.
- Edge case: an empty block gives each site an empty mapping and its usual fallbacks.
- Edge case: a block of only whitespace, only comments, `null` or `...` gives each site the result it has today for a non-mapping: empty metadata. `a: 1` followed by `...` is a mapping. `...` between two keys is invalid YAML and gets each site's invalid-YAML reaction.
- Edge case: a close with trailing spaces leaves no stray whitespace at the start of the body.
- Error path: the resolver reports unavailable for an unclosed plan and still reads a status line from a closed block.
- Error path: the corrector makes no correction for an unclosed plan, for a block with a `--- text` line before the status line, for a list block and for a block of `null`.
- Edge case: the corrector still corrects a valid mapping and keeps every other byte, with LF and with CRLF, and with a close that has trailing spaces.
- Edge case: a `---x: y` line followed by `status:` is a valid mapping, and the corrector still corrects that status.
- Integration: per site, over the seeded corpus, the frozen old regex and the new reader are equal outside the changed conditions, and inside them the new reader equals the stated expected result. A deliberately wrong offset or decision fails each.
- Integration: every Markdown file under `docs/` reads the same before and after at every site that reads `docs/`.
- Integration: a source scan over the non-test files of `packages/*/src` finds no regular expression literal that starts with `^---` outside `frontmatter-block.ts`.

**Verification:** The layout test passes with the three new edges and matching lock entries. The mutation gate is clean. The package graph has no cycle. The pinned-corpus check shows no reader difference for these sites, and the PR records its two commits and counts.

- [ ] **Unit 6: Records**

**Goal:** Bring the solution docs and the package-graph descriptions in line with the new behaviour.

**Requirements:** R22.

**Dependencies:** Units 4 and 5.

**Files:**

- Modify: `docs/solutions/best-practices/wiki-page-structured-attribution-2026-06-04.md`, `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`, `docs/solutions/best-practices/exact-match-trust-gates-need-type-discipline-2026-09-08.md`, `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`
- Modify: `README.md` (dependency flowchart, container view, the knowledge and reports rows), `.github/copilot-instructions.md` (the knowledge and reports import lists)
- Modify: `packages/knowledge/README.md`, `packages/reports/README.md`, `packages/status-truth/README.md` (import sentences and C4 diagrams)

**Approach:**

- The attribution doc's rule becomes: no valid block, or no `sources` key, is blocked. Its fallback guidance and its fallback code example go. Its `verify:` markers must still resolve against the gate.
- The other docs lose their references to a substring fallback and a three-state read.
- The graph gains three edges to the published package; the `knowledge` development edge goes.

**Test expectation:** none -- documentation. `check-solutions-examples` and the Markdown lint cover the edited files.

**Verification:** `bun run lint` passes, including the solution-example check.

- [ ] **Unit 7: Live checks after the second PR**

**Goal:** Confirm each path the second PR changed on its first real run.

**Requirements:** R12–R15, and the origin's success criteria.

**Dependencies:** The second PR merged.

**Files:**

- Modify: `docs/plans/2026-11-12-001-refactor-shared-frontmatter-splitter-plan.md` (record the results)

**Approach:**

- The next promotion passes the strict gate; the knowledge tools still return results in an agent run; a capture run and a metrics run complete.
- If the strict gate blocks a public repo page, a survey of that repository rewrites the page, or a dashboard edit restores its source. A changed non-public page is blocked today as well and is outside this change. Reverting the gate is the last resort, and it reopens the body-URL route.

**Test expectation:** none -- live verification of shipped behaviour.

**Verification:** Each item above is recorded in this plan with its run.

## System-Wide Impact

- **Interaction graph:** Surveys and the Fro Bot content and Observe jobs write pages through the ingest. The dashboard writes through the same code from its own installed package. Promotion and wiki repair run the privacy gate. Wiki query, context expansion and the knowledge tools read pages through the wiki page reader. Capture and metrics read `docs/solutions`. The status-truth PR path uses the corrector. The rename path reads pages through the document reader.
- **Error propagation:** A malformed block becomes each site's existing failure. The gate reports only a reason code. More pages (CRLF pages and `---x` blocks) now reach the wiki page reader's YAML error, whose text carries the parser message as it does today.
- **State lifecycle risks:** Between the two PRs the package's readers are stricter than the gate. A page with an unclosed block would fail the ingest while the old gate would still accept it. No such page exists at the measured commit (`origin/data` `62f9a45`: 266 Markdown blobs, none opens an unclosed block).
- **API surface parity:** The dashboard stays on 0.1.4 until Renovate moves it. On that version it refuses a CRLF page that `main` accepts, which is the safe direction. It builds and writes with its own installed package, so it accepts a page with a `--- text` line inside its block that `main`'s readers refuse. Such a page is written by the dashboard, reported by wiki lint and, for a public repo page, blocked at promotion until it is edited in the dashboard. No page of that shape exists at the measured commit.
- **Integration coverage:** That a surveyed page carries its source, that promotion passes the strict gate, and that the release publishes are shown only by live runs (Units 3 and 7).
- **Unchanged invariants:** `GATE_CONTRACT_VERSION`, the gate's URL match, the node-ID leak gates, each site's body handling, every error text except those listed under Intended Behaviour Changes, and the package's existing exports.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The strict gate blocks a page and promotions stop | The writer stamps the target's page one PR earlier. Unit 3 reads a stamped page from `data`. The strict gate runs over the then-current `data` and `main` commits immediately before the second PR is pushed, and Unit 7 reads the first promotion. |
| A repo page for another repository, written by the content or Observe job without `sources`, or a dashboard save that removes a page's sources, is written and then blocked at promotion. Today its body URL would pass it. | No writer stamps such a page: the stamp covers only the target's page, and those jobs target this repository. Recovery is a survey of that repository, which rewrites its page, or a dashboard edit that restores the source. No page on `data` is in this state at `62f9a45`. No write-time gate is added. |
| A public repo page is blocked after the second PR | A survey of that repository or a dashboard edit fixes it. A changed non-public page is blocked today as well and is outside this change. Reverting the gate is the last resort and reopens the body-URL route. |
| A reader's result changes for a real file | The differential test per site, the CI test over `docs/`, and the pinned-corpus run recorded in each PR. At the measured commits (`origin/data` `62f9a45`, `docs/` at `f9affca`) no file has a changed shape. |
| One unclosed page empties the wiki context for every agent run | It behaves as invalid YAML does today. Wiki lint reports the page. The fix is deferred to a separate task. |
| The dashboard disagrees with `main` while it is on 0.1.4 | The version integer is unchanged, so saves keep working. The one looser case is written by the dashboard, reported by wiki lint and, for a public repo page, blocked at promotion until it is edited in the dashboard. |
| The splitter's result shape is public from 0.2.0 | Unit 1 fixes it against the in-place editors before the first PR merges. A change to it after that needs a second release. |
| The splitter cannot reach a 100% mutation score without disable directives | It is a small pure function with no module-level state. If a mutant is equivalent, enumerate the mutator's variants before any directive. |
| The lockfile edit is missed, since a frozen install does not catch it | The layout test fails on a manifest and lock mismatch. |
| A doc example stops resolving | `parseFrontmatterSources` keeps its name and call shape, and the solution-example check runs in lint. |
| The second PR merges before the writer change has run | Unit 4 depends on Unit 3, which needs the release published and one survey persist that wrote a stamped page, read from `data`. |

## Documentation / Operational Notes

- The first PR's title is a `feat(wiki-write-core)`. The second PR touches nothing under `packages/wiki-write-core/`, so its title has no release effect.
- A new lint finding kind for an unclosed page (`invalid-frontmatter`) may show once as new in any baseline keyed by kind.
- The package README records why the gate-contract version did not change.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md](../brainstorms/2026-11-12-shared-frontmatter-splitter-requirements.md)
- Related code: the twelve sites listed under Relevant Code and Patterns; `scripts/package-layout.test.ts`; `scripts/build-wiki-write-core.ts`; `packages/ci-checks/src/check-solutions-examples.ts`
- Related past work: `docs/plans/2026-10-24-001-refactor-scripts-workspace-packages-plan.md`, recorded active. It kept the published package's helper copies in place; this plan replaces them with one export that the private packages import.
- Related past work: `docs/plans/2026-10-18-001-feat-publish-wiki-write-core-plan.md`, recorded complete. It defines the release rules this plan relies on.
- Related PRs/issues: #4148, #4183, closed #4185
