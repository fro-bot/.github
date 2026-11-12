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

Added during planning, confirmed by the operator:

- P1. When the ingest writes a repo page for a `repo:` target, the page's `sources` includes that repository's URL. The ingest adds it when it is missing.

## Scope Boundaries

- New kinds of message in sites that are silent on bad frontmatter today.
- The YAML parser and its options, and the gate's URL match.
- The three test-only parsers the origin document excludes.
- `GATE_CONTRACT_VERSION` stays at 1.
- Wiring the dashboard to the new release. Renovate raises that PR in `fro-bot/dashboard`.

### Deferred to Separate Tasks

- One page with bad frontmatter empties the baseline wiki context for every agent run, because wiki query throws and the run continues without context. An unclosed block now counts as bad, so this is easier to hit. A fix that skips the one page is a separate change.

## Context & Research

### Relevant Code and Patterns

- The five in-package sites: `packages/wiki-write-core/src/frontmatter.ts` (`parseFrontmatterDocument`), `wiki-utils.ts` (`splitFrontmatter`), `wiki-ingest.ts` (`parseFrontmatter` and a private `parseFrontmatterDocument`) and `repo-page-move.ts` (`editRelatedText`).
- The seven private sites: `packages/wiki-ops/src/solutions-query.ts`, `packages/knowledge/src/capture-learnings-harvest.ts`, `packages/knowledge/src/capture-patterns-synthesis.ts`, `packages/reports/src/improvement-metrics-detect.ts`, `packages/privacy/src/check-wiki-private-presence.ts` (`parseFrontmatterSources`) and `packages/status-truth/src/detect-plan-consistency.ts` (`parsePlanFrontmatterStatus`, `correctPlanConsistencyStatusLine`).
- Linear scanners that replaced regexes, with their tests: `packages/knowledge/src/drafted-solutions-pr-body.ts` (`findCoverageBlock`) with `drafted-solutions-coverage-block-scan.test.ts`, and `packages/wiki-write-core/src/line-scanners.ts` with `line-scanners.test.ts`. Both keep the old regex as a reference and compare on seeded inputs.
- A differential test inside a mutated module's test set: `packages/registry/src/required-checks-differential.test.ts`.
- Growth tests that do not depend on wall-clock limits: `packages/wiki-write-core/src/regex-redos-regressions.test.ts` (`measureScalingRatio`) and the `regex-scaling.test.ts` files in `knowledge`, `reports` and `wiki-ops`.
- The rename path already adds a repository's URL to a moved page's `sources` (`repo-page-move.ts`, the block that pushes `target.newUrl`). `updateRepoPageFrontmatter` in `wiki-ingest.ts` is where the ingest edits a repo page's identity fields.
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

- **Two PRs, one release.** The first PR changes only the published package: the splitter, its five readers and the writer change (P1). Its title is a `feat`, which cuts 0.2.0. The second PR changes the private packages, makes the gate strict and updates the docs, and cuts no release. In that order the writer guarantees `sources` before the gate requires them. Between the two PRs the gate behaves as it does today.
- **The splitter lives in its own module and is exported through `./frontmatter`.** `frontmatter.ts` is already in the root entry and has its own subpath, so no manifest or export-list edit is needed. A separate module keeps the mutation target small.
- **The new export does not reuse the name `splitFrontmatter`.** That name is already exported at the root through `wiki-lint.ts`, and a second export of it fails to compile.
- **The splitter's result carries the original layout.** With a block it gives the block text, the body and the offsets or slices of the opening and closing lines. The two sites that rewrite a file in place need them to keep every byte they do not change (R17).
- **`GATE_CONTRACT_VERSION` stays at 1.** A bump makes every dashboard save fail until the dashboard ships a release. Nothing becomes less strict for a page shape that exists, and the dashboard already has a message for both lint finding kinds. `dist/gate-contract.json` is regenerated because the source hash changes.
- **The writer adds the target's URL (P1).** A page written for a `repo:` target gets `https://github.com/<owner>/<name>` in `sources` when it is not already listed, as the rename path does. The trusted job sets the target from the resolved repository, so the stamp records who the page was written for.
- **The corrector checks the mapping with the package's reader.** `parseFrontmatterDocument` already throws unless the block is a YAML mapping. `status-truth` needs the package edge for the splitter anyway, so it takes no second parser dependency.
- **The splitter joins the mutation gate.** The privacy decision depends on it, and the gate's own module imports it by package name, so the gate's mutants do not exercise it.
- **The real-corpus check runs outside CI for `data`.** CI has no `data` checkout. Before each PR the implementer runs every site's old and new reader over the Markdown blobs at pinned commits of `data` and `main` and records the commits and the result in the PR. A CI test covers `docs/`, which is in the checkout.

## Open Questions

### Resolved During Planning

- Does the wiki page reader's new error need a gate-contract version bump? No. See Key Technical Decisions.
- How is the work split? Two PRs, package first.
- How does the corrector check for a YAML mapping? With `parseFrontmatterDocument` in a `try`.
- Does the splitter join `mutate`? Yes, in one shard.
- What does solutions search report for an unclosed block? Its existing skip warning, with one fixed reason token in place of a parser code.
- What does the repo-page move do with a CRLF page? Its text edit declines and the caller re-renders the block structurally, as it does today for a layout it does not recognise.
- What does pattern synthesis do when its reader throws? Its caller catches, counts the document as invalid and continues.

### Deferred to Implementation

- The splitter's exported name and the exact shape of its result.
- Which shard list takes the splitter. Use the lightest by the procedure in `packages/ci-checks/README.md`.
- The mutant count and run time of the splitter at a 100% score.
- Whether the differential corpus for the private sites lives in `@fro-bot/test-kit` or is generated in each test. The published package cannot depend on the test kit.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

What each site does with the three outcomes, after both PRs:

| Site | No block | Block | Malformed block |
| --- | --- | --- | --- |
| Frontmatter document reader, both copies | Throws missing-frontmatter | Parses; empty text is an empty mapping; throws unless a mapping | Throws missing-frontmatter |
| Wiki page reader | Empty metadata, whole text as body | Parses; a parse error becomes its frontmatter error | Frontmatter error |
| Wiki ingest page parser | Throws its missing-frontmatter error | Parses and checks required fields | Throws its missing-frontmatter error |
| Repo-page move text edit | Not reached; the document reader throws first | Edits the related lines for an LF layout, else declines | Not reached |
| Solutions search | Keeps the document with no metadata | Parses; a parse error skips with a warning | Skips with the warning |
| Learnings harvest | Keeps the document with no metadata | Parses; a parse error skips silently | Skips silently |
| Pattern synthesis | Keeps the document with no metadata | Parses; a parse error counts as invalid | Counts as invalid |
| Improvement metrics | No metadata | Parses; any failure is no metadata | No metadata |
| Privacy gate, public repo page | Blocked | Passes only as a mapping with a matching source | Blocked |
| Plan-status resolver | Unavailable | Reads the status line | Unavailable |
| Plan-status corrector | No correction | Corrects only when the block is a YAML mapping | No correction |

## Implementation Units

### Phase 1: the published package (first PR, one minor release)

- [ ] **Unit 1: The splitter**

**Goal:** Add the splitter as a new module in the published package, exported through `./frontmatter`, with its proof.

**Requirements:** R1–R9, R10, R20, R21.

**Dependencies:** None.

**Files:**

- Create: `packages/wiki-write-core/src/frontmatter-block.ts`
- Create: `packages/wiki-write-core/src/frontmatter-block.test.ts`
- Modify: `packages/wiki-write-core/src/frontmatter.ts` (re-export)
- Modify: `packages/wiki-write-core/src/regex-redos-regressions.test.ts` (growth test)
- Modify: `stryker.config.json` (`mutate`, `testFiles`), `mutation-guards.json` (one `shards` list)
- Modify: `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- A line-based scan from offset 0 that never backtracks. It returns no block, a block or a malformed block.
- The block result carries the block text, the body, and the layout of the opening and closing lines.
- No module-level constants that a mutant could hide in.

**Execution note:** Implement test-first.

**Patterns to follow:** `findCoverageBlock` and `line-scanners.ts` for the scan and docblock-as-spec style; `line-scanners.test.ts` for the seeded differential; `regex-redos-regressions.test.ts` for growth.

**Test scenarios:**

- Happy path: a block with LF, with CRLF, and with mixed endings gives the block text and the body after the closing line.
- Happy path: a close followed by spaces or tabs closes the block, and the body starts on the next line.
- Edge case: a first line of `--- ` with a trailing space, a byte-order mark before `---`, and a blank first line each give no block.
- Edge case: `---` directly followed by `---` gives a block with empty text; the same at the end of the content with no final line ending gives an empty body.
- Edge case: a closing `---` that is the last line with no line ending closes the block.
- Edge case: `---x`, `----` and `--- text` lines inside a block are content, and the block ends at the later exact close.
- Edge case: a lone CR is not a line ending.
- Edge case: a body that starts with `---` is not split again.
- Error path: an opened block with no close is malformed; so is a file that is only `---`.
- Integration: for every input in a seeded corpus, the opening, block text, closing and body pieces concatenate back to the original content.
- Integration: against each of the four old regex shapes over the seeded corpus, every difference falls in one of the intended changes, and the corpus reaches each outcome in volume.
- Growth: time on an unclosed block and on many near-close lines grows linearly between a size and four times that size. This test stays out of `testFiles`.

**Verification:** The new module scores 100% in the mutation gate with no disable directives. The package check passes with a regenerated `dist/gate-contract.json`. The root entry still compiles.

- [ ] **Unit 2: The five in-package readers and the writer stamp**

**Goal:** Move the package's own readers onto the splitter and make the ingest add the target's URL.

**Requirements:** R6, R10, R16, R17, R19, P1.

**Dependencies:** Unit 1.

**Files:**

- Modify: `packages/wiki-write-core/src/frontmatter.ts`, `wiki-utils.ts`, `wiki-ingest.ts`, `repo-page-move.ts`
- Modify: `mutation-guards.json` (the `frontmatter.ts` and `wiki-utils.ts` not-mutated reasons, which stop being true)
- Modify: `packages/wiki-write-core/README.md` (the splitter's contract, the finding-kind change, the unchanged gate version)
- Test: `packages/wiki-write-core/src/wiki-write-core.test.ts`, `scripts/wiki-utils.test.ts`, `scripts/wiki-ingest.test.ts`, `scripts/wiki-lint.test.ts`, `packages/privacy/src/repo-page-move.test.ts`, `packages/wiki-ops/src/wiki-query.test.ts`, `packages/wiki-ops/src/wiki-repair.test.ts`, `packages/wiki-ops/src/regex-scaling.test.ts`
- Modify: `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- Each reader keeps its error texts and its body handling. The two document readers and the ingest parser treat a malformed block as a missing one. The wiki page reader returns its frontmatter error with a fixed description.
- Each site that parses treats empty block text as an empty mapping before its own checks.
- The private `parseFrontmatterDocument` in `wiki-ingest.ts` goes; the module uses the exported one.
- `editRelatedText` uses the splitter's layout and declines for a CRLF block, so its caller re-renders structurally.
- The ingest adds the target's URL to a repo page's `sources` when the target is a `repo:` target and the URL is not listed. It leaves other entries alone.

**Execution note:** Add characterization tests for the ingest's document reader and the move's text edit before changing them.

**Patterns to follow:** The rename path's `sources` handling in `repo-page-move.ts`; `updateRepoPageFrontmatter` for where identity fields are set.

**Test scenarios:**

- Happy path: every existing reader test for a well-formed LF page passes unchanged.
- Happy path: a CRLF page is read with its metadata by the wiki page reader and both document readers.
- Edge case: an empty block gives an empty mapping from the document readers; the ingest parser rejects it for its missing required fields.
- Error path: an unclosed page gives the wiki page reader's frontmatter error; wiki lint reports `invalid-frontmatter` for it, where it reported `missing-frontmatter`.
- Error path: an unclosed page makes the ingest parser and both document readers throw their existing missing-frontmatter errors, with unchanged text.
- Error path: wiki repair counts an unclosed page as out of scope and does not rewrite it.
- Edge case: the move's text edit on an LF page keeps every byte outside the edited lines; on a CRLF page the result is the structural re-render.
- Happy path: the ingest writes a new repo page whose frontmatter has no `sources`; the written page lists the target's URL.
- Edge case: a page that already lists the target's URL is not changed; a page with other sources keeps them and gains the target's.
- Edge case: a non-repo page and a write with no `repo:` target get no stamp.
- Integration: wiki query on a wiki with one unclosed page returns an empty context, as it does today for a page with invalid YAML.

**Verification:** The package check passes. The dashboard's calls (`parseFrontmatterDocument`, `reconstructFrontmatter`, `lintWikiSnapshot`, `buildWikiIngestChanges`) behave as before on LF pages. The real-corpus check over pinned `data` and `main` commits shows no difference and is recorded in the PR.

### Phase 2: the private packages and the gate (second PR, no release)

- [ ] **Unit 3: The privacy gate**

**Goal:** The gate reads attribution through the splitter and blocks every public repo page without a valid block and a matching source.

**Requirements:** R12–R15, R20.

**Dependencies:** Units 1 and 2 merged, and at least one promotion run since.

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
- Error path: a body that contains the repository's URL does not rescue a page with no block, an unclosed block, invalid YAML, a list block, a scalar block, an empty block, or a mapping with no `sources` key. Each reports `unattributable-page`.
- Error path: non-matching sources, then a `---x` line, then a later `---`, with the URL in the body: blocked. The same with `----` and with `--- text`.
- Edge case: a CRLF page and a page whose close has trailing spaces are read and judged on their sources.
- Edge case: present-but-empty and non-array `sources` are still blocked.
- Edge case: a slug shared by two public repositories still reports `ambiguous-public-slug`.
- Edge case: a non-public page equal to its `main` copy passes without its block being read; a changed one is blocked.
- Error path: the gate writes no warning line and no page content or YAML message for any blocked page.
- Integration: wiki repair with one blocked public page aborts as `privacy-leak` before any commit.
- Integration: over the seeded corpus, the gate's old and new decisions differ only where the fallback used to pass or the block rule changed.

**Verification:** `check-wiki-private-presence.ts` keeps a 100% mutation score. The gate run over pinned `data` and `main` commits blocks no page, recorded in the PR.

- [ ] **Unit 4: The other six private sites and the dependency edges**

**Goal:** Move solutions search, learnings harvest, pattern synthesis, improvement metrics and the two plan-status sites onto the splitter.

**Requirements:** R11, R16–R19, R20.

**Dependencies:** Units 1 and 2 merged.

**Files:**

- Modify: `packages/wiki-ops/src/solutions-query.ts`, `packages/knowledge/src/capture-learnings-harvest.ts`, `packages/knowledge/src/capture-patterns-synthesis.ts`, `packages/reports/src/improvement-metrics-detect.ts`, `packages/status-truth/src/detect-plan-consistency.ts`
- Modify: `packages/knowledge/package.json`, `packages/reports/package.json`, `packages/status-truth/package.json`, `bun.lock`
- Test: `packages/wiki-ops/src/solutions-query.test.ts`, `packages/knowledge/src/capture-learnings-harvest.test.ts`, `packages/knowledge/src/capture-patterns-synthesis.test.ts`, `packages/reports/src/improvement-metrics-detect.test.ts`, `packages/status-truth/src/status-truth-detect.test.ts`, and the `regex-scaling.test.ts` files in `knowledge` and `reports`

**Approach:**

- Each site keeps its reaction and its body handling from the table above. Solutions search reports an unclosed block through its existing warning with one fixed reason token.
- The plan-status resolver stays line-based. The corrector makes no correction unless `parseFrontmatterDocument` accepts the block, and splices through the splitter's layout.
- `knowledge` moves the package from a development dependency to a production one. `reports` and `status-truth` add it. The lockfile changes by those four lines only.

**Execution note:** Add raw-input characterization tests for harvest, synthesis and metrics before changing them. They have no frontmatter-shape tests today.

**Test scenarios:**

- Happy path: each site returns today's result for a well-formed LF document.
- Happy path: a CRLF document's metadata is read by solutions search, harvest, synthesis and metrics.
- Error path: an unclosed document is skipped with the warning by solutions search, skipped silently by harvest, counted invalid by synthesis, and read as no metadata by metrics.
- Edge case: an empty block gives each site an empty mapping and its usual fallbacks.
- Edge case: a close with trailing spaces leaves no stray whitespace at the start of the body.
- Error path: the resolver reports unavailable for an unclosed plan and still reads a status line from a closed block.
- Error path: the corrector makes no correction for an unclosed plan, for a block with a `--- text` line before the status line, and for a list block.
- Edge case: the corrector still corrects a valid mapping and keeps every other byte, with LF and with CRLF.
- Edge case: a `---x: y` line followed by `status:` is a valid mapping, and the corrector still corrects that status.
- Integration: per site, over the seeded corpus, every difference from the old regex is one of the intended changes.
- Integration: every Markdown file under `docs/` reads the same before and after at every site that reads `docs/`.

**Verification:** The layout test passes with the three new edges and matching lock entries. The mutation gate is clean. The package graph has no cycle.

- [ ] **Unit 5: Records**

**Goal:** Bring the solution docs and the package-graph descriptions in line with the new behaviour.

**Requirements:** R22.

**Dependencies:** Units 3 and 4.

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

- [ ] **Unit 6: Live checks**

**Goal:** Confirm each changed path on its first real run.

**Requirements:** P1, R12–R15, and the origin's success criteria.

**Dependencies:** Each PR merged.

**Files:**

- Modify: `docs/plans/2026-11-12-001-refactor-shared-frontmatter-splitter-plan.md` (record the results)

**Approach:**

- After the first PR: the release publishes 0.2.0; the next survey persists and its page lists the target's URL in `sources`; the next promotion passes both gates; the next wiki lint run reports no new finding; the dashboard's marker fetch still sees version 1.
- After the second PR: the next promotion passes the strict gate; the knowledge tools still return results in an agent run; a capture run and a metrics run complete.
- If the strict gate blocks a page, fix that page's frontmatter on `data` through the normal writers. Reverting the gate reopens the body-URL route, so it is a last resort.

**Test expectation:** none -- live verification of shipped behaviour.

**Verification:** Each item above is recorded in this plan with its run.

## System-Wide Impact

- **Interaction graph:** Surveys and the Fro Bot content job write pages through the ingest. Promotion and wiki repair run the privacy gate. Wiki query, context expansion and the knowledge tools read pages through the wiki page reader. Capture and metrics read `docs/solutions`. The status-truth PR path uses the corrector. The dashboard uses the package's readers, lint and ingest from npm.
- **Error propagation:** A malformed block becomes each site's existing failure. The gate reports only a reason code.
- **State lifecycle risks:** Between the two PRs the package's readers are stricter than the gate. A page with an unclosed block would fail the ingest while the old gate would still accept it. No such page exists on `data`.
- **API surface parity:** The dashboard stays on 0.1.4 until Renovate moves it. On that version it refuses a CRLF page that `main` accepts, which is the safe direction. It accepts a page with a `--- text` line inside its block that `main` refuses; the ingest on `main` rejects that page at write time.
- **Integration coverage:** That a surveyed page carries its source, that promotion passes the strict gate, and that the release publishes are shown only by live runs (Unit 6).
- **Unchanged invariants:** `GATE_CONTRACT_VERSION`, the gate's URL match, the node-ID leak gates, each site's body handling, every error text and the package's existing exports.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The strict gate blocks a page and promotions stop | The writer stamps the target's URL one PR earlier. The gate is run over pinned `data` before the second PR, and Unit 6 reads the first promotion. |
| A reader's result changes for a real file | The differential test per site, the CI test over `docs/`, and the pinned-corpus run recorded in each PR. Two scans found no affected file on `data` or under `docs/`. |
| One unclosed page empties the wiki context for every agent run | It behaves as invalid YAML does today. Wiki lint reports the page. The fix is deferred to a separate task. |
| The dashboard disagrees with `main` while it is on 0.1.4 | The version integer is unchanged, so saves keep working. The one looser case on the dashboard is stopped by the ingest on `main`. |
| The splitter cannot reach a 100% mutation score without disable directives | It is a small pure function with no module-level state. If a mutant is equivalent, enumerate the mutator's variants before any directive. |
| The lockfile edit is missed, since a frozen install does not catch it | The layout test fails on a manifest and lock mismatch. |
| A doc example stops resolving | `parseFrontmatterSources` keeps its name and call shape, and the solution-example check runs in lint. |
| The second PR merges before the writer change has run | Unit 3 depends on a promotion run after the first PR. |

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
