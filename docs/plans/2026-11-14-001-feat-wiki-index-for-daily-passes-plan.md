---
title: "feat: replace the wiki excerpt with an index for the daily passes"
type: feat
status: active
date: 2026-11-14
origin: docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md
---

# feat: replace the wiki excerpt with an index for the daily passes

## Overview

The three agent jobs in `.github/workflows/fro-bot.yaml` each start with a wiki excerpt chosen by a scorer that favours long pages. The pull request, issue and comment job stops receiving any wiki context. Remediate and Observe receive a derived index of every wiki page. The scorer, the excerpt, the selected-page hand-off and the `wiki_linked` tool are removed.

## Problem Frame

See the origin document. In short: the excerpt is one page cut at 5 KiB, usually about another repository; no matching rule tested against recent titles selects useful pages without selecting unrelated ones; the daily passes get six dated notes from one topic and no view of the rest of the wiki.

## Requirements Trace

Requirement IDs are the origin document's.

- R1, R2. Pull request, issue and comment runs get no wiki excerpt or index, and their prompt says so. Unit 3.
- R3–R9. Remediate and Observe get an index: path, title, type, opening sentence; no tags; fixed order; 12 KiB limit with sentences dropped first, then an incomplete index that says so; listed and held counts. Units 2 and 3.
- R10–R12. Prompt wording for the index, for an unavailable index, and for Remediate's older checkout. Unit 3.
- R13. Scoring, the excerpt, the 5 KiB limit and the hand-off are removed. Units 1 and 3.
- R14. `wiki_linked` is removed from the server and every prompt. Unit 1.
- R15. One step-log line per daily pass. Units 2 and 3.
- R16–R18. Solutions baseline, survey runs and the two search tools are unchanged. Checked in Units 1 and 3.

## Scope Boundaries

- `knowledge/index.md` is neither read nor written. The current loader reads it; the index builder must not.
- No frontmatter summary field, and no change to the survey or the wiki writer.
- `@fro.bot/wiki-write-core` is not changed, so no package release is cut.
- The operator command `scripts/wiki-context-expand.ts` stays, without its linked mode.
- The knowledge-tool prompt duties already on this branch are changed only where they describe `wiki_linked` or "the baseline context above".
- No dependency, permission, token or lockfile change.

### Deferred to Separate Tasks

- The 14-day knowledge-tool count and the removal decision it triggers: `docs/brainstorms/2026-11-14-knowledge-tools-prompt-duties-requirements.md`, counted from the merge date of this work.
- Removing the operator expansion command, if it proves unused.

## Context & Research

### Relevant Code and Patterns

- `packages/wiki-ops/src/wiki-query.ts`: reusable parts are the disk loader (without its `knowledge/index.md` read), `collectPages` (shared frontmatter splitter, skip list), `skippedPageReason`, `encodePath` and the skipped-page warning, and the fail-soft catch in `runWikiQuery`. The scorer, token collector, section renderer, `slugify`, the size constant and the hand-off writer go.
- `packages/wiki-ops/src/wiki-query-cli.ts` and `scripts/wiki-query.ts`: the `*-cli.ts` plus six-line shim shape to keep.
- `packages/wiki-ops/src/wiki-context-expand.ts`: linked mode is separable from query mode; `wiki_search` runs on query mode and the shared assembly. `wiki-context-safety.ts` stays.
- `packages/wiki-ops/src/knowledge-mcp.ts`: tools register in `buildKnowledgeCli`; `knowledgeToolNames` is the allowlist; `fromExpand` is an exhaustive switch over expansion reasons.
- `.github/actions/knowledge-mcp-config/action.yaml` (`handoff-path` input) and `.github/actions/knowledge-mcp-summary/action.yaml` (tool-name pattern).
- Conditional prompt text in `fro-bot.yaml`: `PROGRAM_NOTE` and `DELIVERY_NOTE` are rendered from top-level `env:` notes with `${{ cond && env.NOTE || '' }}` and tested with `evaluateExpressionValue` from `@fro-bot/test-kit`.
- The three `Query wiki context` steps run behind `scripts/route-stderr.ts` with two routes. `packages/wiki-ops/src/route-stderr-prefixes.test.ts` reads the emitted warning kinds from the module source.
- Remediate's step order: sync, persona, wiki query, solutions query, restore `knowledge/` to `HEAD`, config, agent. `scripts/data-sync-callers.test.ts` pins that the sync precedes the step with id `wiki-query`.

### Institutional Learnings

- `docs/solutions/best-practices/a-status-line-must-not-mean-two-things-2026-11-14.md`: one fixed line per state, each state tested.
- `docs/solutions/best-practices/replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md`: read frontmatter through the shared splitter; do not add a parser.
- `docs/solutions/best-practices/an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md`: a `*-cli.ts` change starts the mutation gate.
- `docs/solutions/best-practices/moving-a-script-into-a-workspace-package-leaves-its-guards-pointing-at-the-shim-2026-11-05.md`: a renamed module needs its guard entries moved with it.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "fro-bot/.github main@ab4e5e1: packages/wiki-ops/src, scripts/, .github/workflows, .github/actions, docs/",
  "freshness": {
    "vcs_reference": "fro-bot/.github main ab4e5e1"
  },
  "budget": {
    "max_search_passes": 6,
    "max_candidate_inspections": 20,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "packages/wiki-ops/src/wiki-query.ts",
      "description": "Loads wiki pages from disk through the shared splitter, skips unreadable pages with encoded warnings, fails soft, and writes step outputs. Also owns the scorer and excerpt being removed.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/wiki-ops/src/rebuild-wiki-index.ts",
      "description": "Rebuilds knowledge/index.md, whose entries average 5 KB. It writes a file on data and has no per-page one-line form.",
      "disposition": "insufficient"
    },
    {
      "path_or_symbol": "packages/wiki-ops/src/wiki-context-expand.ts",
      "description": "Query and linked expansion behind the knowledge tools. Query mode stays; linked mode is removed.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/wiki-ops/src/wiki-repair.ts",
      "description": "Has a private first-line heading check. No paragraph or sentence extraction to reuse.",
      "disposition": "insufficient"
    }
  ]
}
```

## Key Technical Decisions

- **Rename the query to `wiki-index`.** Module, command module, script, step id, output name and warning prefix all change. Keeping the old names would leave `excerpt` and `wiki-query` describing something that no longer exists.
- **One module and one command.** The index builder replaces the query module. It stays outside the mutation set, with unit tests for the sentence rule, the size rule and the status line.
- **Remove `wiki_linked` first.** The reader of the hand-off goes before its writer, so each unit is green alone.
- **Opening sentence by a single linear scan, in `wiki-ops`.** No regular expression per terminator, and no change to `wiki-write-core`. The rule is in Unit 2.
- **A sentence over 200 characters is omitted, not cut.** R5 asks for a complete sentence.
- **The index is data, the guidance is prompt.** Index lines go inside `<wiki_context>`. The sentences for R10–R12 go in `<wiki_context_expansion>`, outside the untrusted text.
- **Unavailable is carried by an empty output.** The agent env reads the step's `index` output or a fixed note from the top-level `env:`. The command exits 0 whenever it can write its output, as the query does today, so the step needs no `continue-on-error`. An output file that cannot be written fails the step and the job, as for any other step.
- **Loader outcomes are fixed.** `held` is the number of `.md` files found in the wiki directories. A missing wiki root, a directory that cannot be listed, or zero files found makes the index unavailable. A file that cannot be read, or whose frontmatter is unreadable, counts in `held`, is skipped with a warning, and is not listed. A missing optional directory is not an error.
- **Every field is one line.** The path uses the existing percent-encoding. In the title and the sentence, each control character and line break becomes a space, runs of spaces collapse, and `<`, `>` and the field separator are replaced. One page gives exactly one line.
- **Title and type come from the shared page parser.** That is the frontmatter title, falling back to the slug, and the frontmatter type, falling back to the directory.
- **The limit is UTF-8 bytes of the whole `index` value,** counting the count line, every separator and newline, and the incomplete marker.
- **The summary action is not changed.** A rerun of an older run uses that run's own copy of the action, so no log with a `wiki_linked` row reaches the new one.
- **The step log gets one fixed line of counts.** It replaces the JSON line that printed excerpt text. It holds integers and fixed words only.
- **The pull request job loses its wiki query step.** Its wiki sync stays, because the search tools and the wiki hand-off baseline read the checkout.

## Open Questions

### Resolved During Planning

- Opening-sentence rule: see Unit 2. Measured on the wiki at `data`: 38 of 48 pages yield one, the longest is 181 characters, and the index is 7.4 KiB with sentences and 3.9 KiB without.
- Prompt placement: see Unit 3.
- What remains of the query module: see Unit 2.
- Expansion module after `wiki_linked`: query mode and shared assembly stay; `mode: 'query'` stays in the result so tool output is unchanged.
- Step-log line: stdout, fixed prefix, one line.

### Deferred to Implementation

- Final wording of the prompt sentences, within the meanings fixed in Unit 3.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

States of the index step and what each consumer sees:

| State | `index` output | Step-log line | Agent sees in `<wiki_context>` |
| --- | --- | --- | --- |
| Full, sentences kept | count line, then all readable pages with sentences | `wiki-index: listed=L held=H skipped=S sentences=kept bytes=B` | the index |
| Full, sentences dropped | count line, then all readable pages, no sentences | `wiki-index: listed=L held=H skipped=S sentences=dropped bytes=B` | the index |
| Incomplete | count line, the lines that fit, then a line saying it is incomplete | `wiki-index: listed=L held=H skipped=S sentences=dropped incomplete bytes=B` | the index, marked incomplete |
| Unavailable | empty | `wiki-index: unavailable` | the fixed unavailable note |

`S` is the number of pages that could not be read (a file that failed to read, or frontmatter that could not be parsed). `incomplete` means the size limit cut pages off. The numbers add up: `H = L + S + C`, where `C` is the number of pages cut off, and `C` is zero unless `incomplete` is present. Both can be true at once. The status line has `skipped=0` when nothing was skipped.

Index line shape: `path | title | type | opening sentence`, with the last field absent when a page has none. Order: type, then path, by code unit. The first line of the index is `Wiki index: L of H pages listed.`, followed by ` S could not be read.` when `S` is above zero.

## Implementation Units

- [x] **Unit 1: Remove the `wiki_linked` tool**

**Goal:** The server offers two tools, nothing reads or writes the selected-page hand-off, and no prompt names `wiki_linked`.

**Requirements:** R14, R13 (hand-off), R18.

**Dependencies:** None.

**Files:**

- Modify: `packages/wiki-ops/src/knowledge-mcp.ts`, `packages/wiki-ops/src/wiki-context-expand.ts`, `packages/wiki-ops/src/wiki-context-expand-cli.ts`, `packages/wiki-ops/src/wiki-query.ts` (hand-off writer only)
- Modify: `.github/actions/knowledge-mcp-config/action.yaml`
- Modify: `.github/workflows/fro-bot.yaml` (the `handoff-path` inputs, every `WIKI_CONTEXT_HANDOFF_PATH`, the `knowledge_wiki_linked` sentence in three prompts), `.github/workflows/survey-repo.yaml` (one comment)
- Modify: `mutation-guards.json` (the `wiki-context-expand.ts` reason)
- Test: `packages/wiki-ops/src/knowledge-mcp.test.ts`, `packages/wiki-ops/src/wiki-context-expand.test.ts`, `packages/wiki-ops/src/wiki-query.test.ts`, `packages/wiki-ops/src/wiki-query-route.test.ts`, `packages/wiki-ops/src/route-stderr-prefixes.test.ts`, `scripts/wiki-ops-flows.test.ts`, `scripts/knowledge-mcp-server.test.ts`, `scripts/knowledge-mcp-callers.test.ts`, `scripts/knowledge-mcp-config-action.test.ts`, `scripts/fro-bot-workflow-wiki-handoff.test.ts`, `scripts/fro-bot-workflow.test.ts`, `scripts/survey-repo-workflow.test.ts`

**Approach:**

- Remove the tool's registration, handler, allowlist entry, hand-off import and the two error codes only it produced. Shrink `fromExpand` to the reasons query mode can return.
- Remove linked mode from the expansion module and its command. Keep query mode, the shared assembly and the safety filter.
- Drop the config action's `handoff-path` input and the server env it set.
- The wiki query step still runs in this unit. It stops writing the hand-off, so the `handoff-write-failed` warning kind goes, and the prefix guard that reads warning kinds from the query module's source is updated with it.
- In the query tests, the route test and the flow test, remove the hand-off and linked-mode cases and keep the output and router cases.
- The prompt tests added with the knowledge-tool duties assert a `knowledge_wiki_linked` description sentence. Remove that assertion here. The three blocks stay identical apart from the repository-duty paragraph.

**Execution note:** Test-first. Start from the server test's tool list.

**Patterns to follow:** How `knowledge-mcp.test.ts` imports the module by relative path, so mutants are killed.

**Test scenarios:**

- Happy path: the server lists exactly `wiki_search` and `solutions_search`.
- Happy path: `wiki_search` returns the same JSON, with `mode: 'query'`, for the fixture query it returns today.
- Error path: a call to `wiki_linked` is refused as an unknown tool.
- Edge case: every expansion reason query mode can return maps to a tool error code; no case for the removed reasons remains.
- Integration: the config action's output has no hand-off env, with and without a fork.
- Integration: in each of the three `fro-bot.yaml` prompts, the tool descriptions name two tools; in each survey prompt, the same two.
- Integration: no step in either workflow sets `WIKI_CONTEXT_HANDOFF_PATH` or passes `handoff-path`.

**Verification:**

- Type check, lint and tests pass. The mutation gate runs and `knowledge-mcp.ts` stays at 100%.

- [x] **Unit 2: Add the index builder**

**Goal:** A module and command that build the index from a wiki tree and report one status line. Not yet called by a workflow.

**Requirements:** R4–R9, R15, and the unavailable state behind R11.

**Dependencies:** Unit 1.

**Files:**

- Create: `packages/wiki-ops/src/wiki-index.ts`, `packages/wiki-ops/src/wiki-index-cli.ts`, `scripts/wiki-index.ts`
- Modify: `packages/wiki-ops/package.json` (exports), `mutation-guards.json` (`not-mutated` entries, each with a reason, for the three new files)
- Test: `packages/wiki-ops/src/wiki-index.test.ts`, `packages/wiki-ops/src/wiki-index-cli.test.ts`, `packages/wiki-ops/src/wiki-index-route.test.ts`, `packages/wiki-ops/src/regex-scaling.test.ts`, `scripts/wiki-ops-flows.test.ts`

**Approach:**

- Load pages from the wiki directories through the shared splitter, after removing one leading U+FEFF from each file. Do not read `knowledge/index.md`. Skip an unreadable page with the existing encoded warning, under the new prefix.
- One line per page: path, title, type, opening sentence.
- Opening sentence, by one linear scan:
  - The first non-blank body line must be an ATX top heading (`# `). A body with no such heading, or a setext heading, has no sentence.
  - Skip blank lines after the heading. The paragraph is the following non-blank lines up to the next blank line, joined by single spaces.
  - There is no sentence when the paragraph's first line starts with `#`, a list marker, `|`, `>`, a code fence, `<`, a tab or four spaces. A line that starts with bold text or a link is prose.
  - While scanning, text inside a closed code span, a `[[wikilink]]` or a link target `](...)` is skipped. Whether a span that opens inside the sentence closes is decided by looking to the end of the paragraph, and a span that closes beyond 200 characters gives no sentence. A span or bracket with no closer anywhere in the paragraph is ordinary text. A bare URL needs no rule: it holds no space, so no sentence can end inside it.
  - A `.`, `!` or `?`, with any closing quote or bracket after it, ends the sentence when the paragraph ends there, or when a space and then a capital, a digit or an opening mark follow.
  - A period after a single capital letter does not end it. Nor does a period after `e.g`, `i.e`, `vs`, `etc`, `dr`, `mr`, `mrs`, `ms`, `inc`, `ltd`, `co` or `st`, compared without case.
  - No terminator, or more than 200 characters, gives no sentence.
- Encode every field to one line as the Key Technical Decisions state.
- Size rule, in UTF-8 bytes of the whole value: build with sentences; over 12 KiB, rebuild without; still over, admit lines in order while the count line, the admitted lines and the incomplete marker fit together. The count line carries `S could not be read.` when `S` is above zero and is recomputed for the final listed count.
- Loader outcomes as the Key Technical Decisions state.
- Write the `index` output and print the one status line. When the index is unavailable, write an empty `index`, warn under the unavailable prefix, print `wiki-index: unavailable`, and exit 0.
- The route test builds its own router invocation with the routes Unit 3 will use. The workflow fixture and the prefix guard still describe the old steps until Unit 3.

**Execution note:** Test-first. Begin with the sentence rule against fixture pages.

**Patterns to follow:** `wiki-query-cli.ts` for the command shape; `encodePath` and the skipped-page warning for log-safe paths; `regex-scaling.test.ts` for linear-growth cases.

**Test scenarios:**

- Happy path: three pages of different types give three lines in type-then-path order, each with path, title and type.
- Happy path: a page whose top heading is followed by a prose sentence gets that sentence; a page whose top heading is followed by a sub-heading gets none. (Origin AE3.)
- Edge case: `Marcus R. Brown's repository. Second sentence.` yields the first sentence whole.
- Edge case: a sentence containing a Markdown link, a code span with a period, and a wikilink is not split inside them.
- Edge case: a paragraph ending in a colon, a paragraph with no terminator, and a 201-character sentence each yield none.
- Edge case: a title or sentence containing `</wiki_context>` or the field separator is neutralised.
- Edge case: page tags never appear in a line.
- Edge case: a paragraph that opens with bold text or a link yields its sentence; a body with a setext heading or no heading yields none; an unclosed backtick does not hide the rest of the paragraph.
- Edge case: a title containing a line break, and a file name containing a line break or a control character, each give exactly one line and cannot forge a count line or an incomplete marker.
- Edge case: a page with no frontmatter type takes its type from its directory, and a page with no frontmatter title takes its slug.
- Edge case: a tree that would be 15 KiB with sentences and 9 KiB without gives all pages, no sentences, equal counts. (Origin AE4.)
- Edge case: a tree that is 14 KiB without sentences gives the pages that fit, the incomplete line, and unequal counts, and the whole value is at most 12 KiB. (Origin AE5.)
- Edge case: the limit holds with multi-byte titles, and when admitting one more line changes the width of the count.
- Edge case: one valid page and one page with invalid frontmatter give `Wiki index: 1 of 2 pages listed. 1 could not be read.` and `skipped=1`; so do one valid page and one file that cannot be read. With no skipped page the count line has no extra sentence and the status line says `skipped=0`. A title cannot forge the new sentence.
- Edge case: skipped pages and a size-limited index together keep `held = listed + skipped + cut off`, and the count line is measured with its extra sentence.
- Edge case: a page that starts with U+FEFF keeps its title and sentence.
- Edge case: a code span, wikilink or link target that opens inside the first sentence and closes beyond 200 characters gives no sentence; one that closes nowhere in the paragraph does not hide the sentence.
- Edge case: the same tree read twice gives byte-identical output.
- Error path: one page with unclosed frontmatter and one with invalid frontmatter are each skipped with an encoded warning naming the right reason, the others are listed, and listed is two below held.
- Error path: a file that cannot be read is skipped with a warning and counted in held.
- Error path: a missing wiki root, a directory that cannot be listed, and a tree with no pages each give an empty `index`, the unavailable status line and exit 0. (Origin AE6.)
- Edge case: a missing optional directory beside readable ones is not an error.
- Error path: a closed stderr does not stop the output or change the exit code.
- Integration: run behind `route-stderr`, the command's stdout, outputs and exit code equal a bare run, and the two warning kinds reach the summary under their headings.
- Integration: scaling cases show linear growth for a long paragraph of periods, of brackets and of backticks, and for an early opener with a late closer or none.

**Verification:**

- Type check, lint and tests pass. The mutation gate runs, because a command module was added.
- `packages/wiki-ops` exports resolve, `scripts/package-layout.test.ts` passes, and the new modules load under Node's strip-only mode as the `Test Scripts Load` job requires.
- One manual run against a checkout of the wiki at a named `data` commit: record the commit, the status line and the number of pages with a sentence in this plan. It is not a test, because `data` moves.
- Recorded: `data` at `07793befb79c72f2dae9c5e71e75f9b2193dfbd3`, status line `wiki-index: listed=48 held=48 skipped=0 sentences=kept bytes=7374`, 38 of 48 pages with a sentence.

- [x] **Unit 3: Wire the workflow and delete the query**

**Goal:** The daily passes receive the index, the pull request job receives no wiki context, and the old query is gone.

**Requirements:** R1–R3, R10–R13, R15–R17.

**Dependencies:** Unit 2.

**Files:**

- Modify: `.github/workflows/fro-bot.yaml`
- Delete: `packages/wiki-ops/src/wiki-query.ts`, `packages/wiki-ops/src/wiki-query-cli.ts`, `scripts/wiki-query.ts`, and their tests (`wiki-query.test.ts`, `wiki-query-bad-page.test.ts`, `wiki-query-reason.test.ts`, `wiki-query-slugify.test.ts`, `wiki-query-cli.test.ts`, `wiki-query-route.test.ts`)
- Modify: `packages/wiki-ops/package.json` (exports), `mutation-guards.json` (remove the query entries)
- Modify: `packages/wiki-ops/fixtures/route-stderr-workflow-steps.ts`, `packages/wiki-ops/src/wiki-context-expand.ts` (a comment naming the query tokenizer), `llms.txt` (its link to the deleted module)
- Test: `scripts/fro-bot-workflow-wiki-query.test.ts` (becomes the index-step test), `scripts/fro-bot-workflow-wiki-handoff.test.ts`, `scripts/fro-bot-workflow.test.ts`, `scripts/data-sync-callers.test.ts`, `packages/wiki-ops/src/route-stderr-prefixes.test.ts`, `packages/wiki-ops/src/route-stderr-cli.test.ts`, `packages/wiki-ops/src/regex-scaling.test.ts`, `scripts/wiki-ops-flows.test.ts`, `scripts/knowledge-mcp-callers.test.ts`

**Approach:**

- Pull request job: delete the wiki query step. The `<wiki_context>` wrapper holds a fixed sentence saying no wiki context is provided for this run. Keep the wiki sync and the solutions query.
- Remediate and Observe: the step becomes `Build wiki index`, id `wiki-index`, run behind `route-stderr` with routes for skipped pages and an unavailable index. The agent env reads the `index` output or a fixed unavailable note defined in the top-level `env:`.
- In `<wiki_context_expansion>` for both daily jobs: the index lists what the wiki holds; read a page from disk or find it with `knowledge_wiki_search`. Replace "reach past the baseline context above" in all three jobs with wording that fits a job with no wiki context.
- Remediate only: the index reflects the wiki on `data`; the checkout may hold an older copy of a listed page or lack it.
- Keep the index step before Remediate's restore of `knowledge/`, and update the restore step's comment.
- The workflow fixture and the prefix guard now expect two index steps and read warning kinds from the index module. Tests that counted three query steps count two index steps.
- Remove the remaining old-command cases from the flow test and the old import from the scaling test.
- The identical-blocks test compares a shared core and then checks each job's own sentences.

**Execution note:** Test-first. Change the workflow tests, watch them fail, then edit the YAML.

**Patterns to follow:** `DELIVERY_NOTE` and `PROGRAM_NOTE` for an env note with an expression fallback; the existing identical-blocks test for prompt copies.

**Test scenarios:**

- Happy path: the pull request job has no wiki step, its rendered prompt says no wiki context is provided, and its solutions excerpt is still wired. (Origin AE1.)
- Happy path: Remediate and Observe each have one `wiki-index` step behind the router, and each agent env reads its `index` output.
- Happy path: the rendered prompt of each daily job, on the schedule and on a custom dispatch, carries the index inside `<wiki_context>`. (Origin AE2.)
- Edge case: with an empty `index` output, the env expression evaluates to the unavailable note. With a non-empty output, it evaluates to the output. Neither note says the wiki is empty.
- Edge case: the daily prompts carry the read-from-disk-or-search sentence; the pull request prompt does not.
- Edge case: only Remediate's prompt carries the older-checkout sentence.
- Edge case: the three expansion blocks share one core and differ only by the stated per-job sentences.
- Integration: in Remediate, the wiki sync precedes the index step, and the index step precedes the `knowledge/` restore.
- Integration: no workflow, script or package file refers to `wiki-query`, `excerpt` as a wiki output, or the 5 KiB limit.
- Integration: every `route-stderr` route prefix in the workflow is a kind the index module emits.
- Integration: `actionlint` passes on `fro-bot.yaml`.

**Verification:**

- Type check, lint, tests and `actionlint` pass. The mutation gate runs.
- The link check passes with the module deleted.
- A search of code, workflows, tests and configuration finds no reference to the deleted files. Prose in current documents is corrected in Unit 4. `docs/plans/`, `docs/brainstorms/`, `docs/solutions/` and `docs/archive/` are history and keep theirs.

- [x] **Unit 4: Documentation**

**Goal:** Current documentation describes the index, the two tools and the missing excerpt.

**Requirements:** Supports R1–R18; no behaviour.

**Dependencies:** Unit 3.

**Files:**

- Modify: `README.md` (Knowledge Wiki paragraph), `packages/wiki-ops/README.md` (module list, C4 diagram, tool section), `.github/copilot-instructions.md` (the `packages/wiki-ops` sentence: module names, two tools, the daily index steps), `llms.txt` (its descriptions)
- Modify: `docs/solutions/best-practices/a-status-line-must-not-mean-two-things-2026-11-14.md` and `docs/solutions/best-practices/an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md` (cited line numbers in `knowledge-mcp.ts` and its test)
- Modify: `docs/brainstorms/2026-11-14-knowledge-tools-prompt-duties-requirements.md` (its description of the baseline, if still stale)

**Approach:**

- State current facts only. Old plans and brainstorms are history and stay as written.

**Test scenarios:**

- Test expectation: none -- documentation only. `bun run lint` covers links and solution examples.

**Verification:**

- Lint passes. No current document names `wiki_linked`, `wiki-query` or a wiki excerpt as present behaviour.

- [ ] **Unit 5: Live checks after merge**

**Goal:** The first runs show the change working.

**Requirements:** Origin success criteria.

**Dependencies:** Units 1–4 merged.

**Files:**

- Modify: this plan (record results)

**Approach:**

- First pull request run: the job has no wiki step, and the agent connects to a server with two tools.
- First scheduled run: both daily jobs print a `wiki-index:` line with equal listed and held counts, and the knowledge summary prints as before.
- Note the merge date as the start of the 14-day knowledge-tool count.

**Test scenarios:**

- Test expectation: none -- live verification of shipped behaviour.

**Verification:**

- Each check is recorded in this plan with its run.

## System-Wide Impact

- **Interaction graph:** the pull request job, Remediate and Observe in `fro-bot.yaml`; the `knowledge` server; the config action; `route-stderr`. Survey runs are touched only where their prompt and one comment name `wiki_linked`.
- **Error propagation:** an index that cannot be built never fails the job. It yields the unavailable note and a status line.
- **State lifecycle risks:** none persisted. The index is built per run and written only to a step output.
- **API surface parity:** `packages/wiki-ops` exports lose `wiki-query` and `wiki-query-cli` and gain `wiki-index` and `wiki-index-cli`. Nothing outside the package imports the removed ones.
- **Integration coverage:** the env fallback, the step order in Remediate and the route prefixes are proved by workflow tests, not unit tests.
- **Unchanged invariants:** the solutions baseline in all three jobs; survey runs get no wiki baseline; `wiki_search` and `solutions_search` output; the knowledge summary's three lines; the wiki sync in every job.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The agent ignores the index, so the daily passes lose the little wiki text they had | Accepted. The measured excerpt was six dated notes from one topic. The search duty for a specific repository is already in the prompt. |
| A page's opening text carries instructions | Index lines sit inside the untrusted wrapper; fields are neutralised; one sentence of at most 200 characters per page. |
| The sentence rule cuts a sentence wrongly | Unit tests on abbreviations, links and code spans; the count on the real wiki is pinned; a wrong cut costs one index line, not correctness. |
| The wiki grows past the limit | Sentences drop first; then the index says it is incomplete and gives both counts. The status line shows it. |
| Removing a tool breaks a run that expects three | The prompt and the server change together in Unit 1. The summary action is unchanged. |
| The wiki is public-only by rule, enforced for repository pages and by authoring discipline elsewhere | Unchanged by this work. The index exposes paths, titles and one sentence, where the excerpt exposed 5 KiB of body. |
| A rerun of a run created before the merge executes the old workflow | It runs the old code from its own commit, which still exists there. No shared state is involved. |
| The mutation gate adds time to each unit | Expected. Run it once per unit, after the unit's tests are green. |

## Documentation / Operational Notes

- This ships with the knowledge-tool prompt duties already on the branch. The 14-day count in that requirements document starts on the merge date.
- No repository variable, secret or setting changes.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md](../brainstorms/2026-11-14-wiki-baseline-index-requirements.md)
- Companion requirements: [docs/brainstorms/2026-11-14-knowledge-tools-prompt-duties-requirements.md](../brainstorms/2026-11-14-knowledge-tools-prompt-duties-requirements.md)
- Related past work: `docs/plans/2026-11-06-001-feat-agent-knowledge-mcp-tools-plan.md`, recorded complete. It added the three tools and the hand-off this plan removes one of.
- Related past work: `docs/brainstorms/2026-07-07-a1-phase-3-deep-wiki-traversal-requirements.md`, recorded as completed. It introduced linked expansion from the baseline pages; with no baseline pages there is nothing to expand.
- Related past work: `docs/plans/2025-04-15-001-feat-frobot-control-plane-plan.md`, recorded as completed. It set the 5 KiB limit and type-priority ranking for the excerpt.
