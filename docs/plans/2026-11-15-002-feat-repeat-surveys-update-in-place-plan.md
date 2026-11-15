---
title: "feat: repeat surveys update the page in place"
type: feat
status: active
date: 2026-11-15
origin: docs/brainstorms/2026-11-15-repeat-surveys-update-in-place-requirements.md
---

# feat: repeat surveys update the page in place

## Overview

A repeat survey appends 31 to 119 lines to its page whatever changed upstream. Two pull requests change that. The first changes the trusted wiki writer: it writes only the pages a hand-off carries, and it can write one log entry for a survey where it writes two today. The second changes the survey's instructions, its retry text and the wiki schema, and turns the single log entry on for surveys.

## Problem Frame

See the origin document. Planning confirmed one defect the origin listed as unconfirmed: the trusted writer takes its page list from the checkout's git status after `data` is laid over `main`, so it processes every page that differs between the two branches. A page in that set with non-canonical frontmatter is rewritten by a survey that never touched it, and one with invalid frontmatter fails the survey.

## Requirements Trace

Requirement IDs are the origin document's.

- R1–R7. What a repeat survey writes. Unit 3.
- R8. A quiet survey leaves the page byte for byte unchanged, and the writer processes only handed-off pages. Units 1 and 3.
- R9, R10, R11. The agent's log entry, first-attempt success, retries. Unit 3.
- R12, R13. One log entry per survey, worded for what happened. Units 2 and 3.
- R14. The schema states the exception. Unit 3.
- R15, R16. The 30-day measure. Unit 5.

## Scope Boundaries

- Skipping unchanged repositories: [#4242](https://github.com/fro-bot/.github/issues/4242).
- The single log entry applies to surveys only. The pull request, issue and Observe ingests keep two entries.
- Pages that have already grown are not shrunk.
- No new script for the measure, and no commit trailer. A rewrite survey is dispatched by the operator and is left out of the measure by hand.
- No change to change detection, the hand-off build, the privacy gates or the result record.

### Deferred to Separate Tasks

- One log entry for the other ingests, if the survey's proves better.

## Context & Research

### Relevant Code and Patterns

- `packages/wiki-write-core/src/wiki-ingest.ts`: `runWikiIngestCli` takes changed paths from git status and passes them all as pages; `loadHandoff` and `readHandoffManifest` already return the hand-off's page paths; `buildWikiIngestChanges` writes every input page after `prepareWikiPage`; `appendAgentLogEntries` keeps the agent's entries and `appendLogEntry` adds the trusted one.
- `packages/wiki-ops/src/wiki-handoff-core.ts`: `buildWikiHandoff` writes the manifest that lists the hand-off's pages.
- `.github/actions/sync-data/action.yaml`: restores `knowledge/` from `data` into the working tree and leaves the index on `main`.
- Callers of the CLI path with a hand-off: the survey persist job (`survey-repo.yaml`), the event ingest and the Observe ingest (`fro-bot.yaml`). Wiki repair and the repository rename call the writer's functions directly.
- Readers of log entries: `mergeWikiLogs`, `parseWikiLogEntries` and `parseWikiLogHeader` in the writer, used by `rebuild-wiki-index --merge-logs`. `knowledge/schema.md` gives the entry format: heading, body, `Sources:`.
- `scripts/wiki-ingest.test.ts`: the log-only test passes an empty changed-path list, which production never produces. Several tests pin the two-entry output.
- `survey-repo.yaml`: the additive rule and the numbered steps in `INGEST_PROMPT`, `REWRITE_PROMPT`, both retry prefixes, and `WIKI_SUMMARY` in the persist job. `scripts/survey-repo-workflow.test.ts` pins the prompt sentences through `workflowParsed.env.INGEST_PROMPT` and a `renderPrompt` helper.
- `knowledge/schema.md` is the same on `main` and `data`, is not a guarded wiki path, and reaches `data` at the next merge of `main` into `data`.
- Release: `@fro.bot/wiki-write-core` is at 0.3.0. A `feat` title releases a minor. A change under `src/` changes the source hash in `dist/gate-contract.json`.

### Institutional Learnings

- `docs/solutions/best-practices/an-inventory-handed-to-an-agent-must-say-when-it-is-partial-2026-11-14.md` and `a-status-line-must-not-mean-two-things-2026-11-14.md`: the log entry must say whether a page changed.
- `docs/solutions/best-practices/equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md`: for callers whose behaviour must not change, compare old and new output.
- `docs/solutions/best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md`: read the first live survey.

## Key Technical Decisions

- **The writer filters git status by the hand-off's page list.** The manifest already lists exactly what the agent changed. The filter applies whenever a hand-off is present, so the event and Observe ingests get the fix too: they have the same defect. Without a hand-off nothing changes.
- **The single log entry is a mode the caller turns on.** Only the survey sets it. The other ingests keep their output byte for byte, which a differential test shows.
- **The single entry is built by the writer.** Heading from the trusted timestamp, operation and target; body from the agent's entry with its own heading and `Sources:` line removed; `Sources:` from the trusted input. The agent's timestamp is not used: real entries show it out of order.
- **The entry's wording comes from the pages written.** The workflow's fixed summary says the wiki was updated. In single mode, when no page was written, the writer says the page was verified and not changed.
- **Two pull requests, the writer first.** The writer change releases the package; the prompt change must not touch the package. The prompt's claims about other pages and about the log need the writer change.
- **The agent is told how to recognise a repeat.** The prompt has no first-survey branch. It gains a sentence: when the repository's page exists, the repeat rules apply.
- **Retries keep their conditions.** A log-only attempt already counts as changed, so no retry fires. Only the retry text changes.
- **The schema exception is scoped** to repository pages written by surveys.

## Open Questions

### Resolved During Planning

- Whether the writer rewrites pages the survey did not hand off: yes, shown with a fixture on the real entry point.
- Who reads log entries: the writer's own merge and parse functions and `rebuild-wiki-index`. Not checked: the dashboard.
- How the schema change reaches surveys: a pull request to `main`, then the daily merge into `data`.
- How the measure is computed: one documented `git log` command over `origin/data`. The 14-day baseline is 23 repeat surveys, median 69 lines added and 1 removed.

### Deferred to Implementation

- The exact wording of the prompt rules, the retry text and the two log sentences.
- What the single entry contains when the agent wrote more than one entry, or none. Expected: bodies joined in order; with none, the trusted summary alone.
- The name of the mode's environment variable.

## Implementation Units

### Pull request 1: the writer

- [ ] **Unit 1: Write only the pages a hand-off carries**

**Goal:** With a hand-off present, the writer processes the hand-off's pages and no others.

**Requirements:** R8.

**Dependencies:** None.

**Files:**

- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`
- Test: `scripts/wiki-ingest.test.ts`
- Modify: `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- In the CLI's hand-off branch, keep only the status paths the hand-off's manifest lists. The empty check and the committed-page list use the filtered list.
- Without a hand-off, behaviour is unchanged.

**Execution note:** Test-first. Start with a status that lists pages the hand-off does not.

**Patterns to follow:** The existing hand-off tests in `scripts/wiki-ingest.test.ts` and the Git Data fake from `@fro-bot/test-kit`.

**Test scenarios:**

- Happy path: status lists pages A and B, the hand-off carries A; A is written and B is not in the commit.
- Edge case: a log-only hand-off with status listing A and B writes neither page, and the reported count of pages changed is 0. This replaces the empty-status version of the log-only test.
- Edge case: B has non-canonical frontmatter and is not handed off; its bytes on `data` are unchanged.
- Error path: B has invalid frontmatter and is not handed off; the write succeeds.
- Error path: a handed-off page with invalid frontmatter still fails as today.
- Integration: with no hand-off, the pages written match today's for the same status.

**Verification:**

- Type check, lint, tests and `bun run check:wiki-write-core-package` pass after `bun run build`.

---

- [ ] **Unit 2: One log entry when the caller asks for it**

**Goal:** A caller can have the writer leave one log entry per ingest.

**Requirements:** R12, R13.

**Dependencies:** Unit 1 (the count of pages written).

**Files:**

- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`
- Test: `scripts/wiki-ingest.test.ts`
- Modify: `packages/wiki-write-core/README.md`, `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- A mode read from the environment by the CLI. Off by default.
- In the mode, the writer emits one entry in the schema's format: trusted heading, the agent's body without its heading and `Sources:` line, trusted `Sources:`.
- When no page was written, the entry's summary says the target was verified and no page changed. Otherwise it uses the caller's summary.
- The entry stays parseable by `parseWikiLogEntries` and mergeable by `mergeWikiLogs`.

**Execution note:** Test-first.

**Patterns to follow:** `appendLogEntry` for the entry format; the existing two-entry tests, which stay as the default-mode tests.

**Test scenarios:**

- Happy path: mode on, the agent wrote one entry and one page; the log gains exactly one entry with the trusted heading, the agent's body and the trusted sources. (Origin AE6b.)
- Happy path: mode on, log-only hand-off; exactly one entry, and it says no page changed. (Origin AE6.)
- Edge case: mode on, the agent wrote two entries; one entry holds both bodies in order.
- Edge case: mode on, the agent's entry has no body or no `Sources:` line; the entry is still well formed.
- Edge case: mode on, the agent's body contains a line that looks like an entry heading; it cannot start a second entry.
- Error path: mode on, the agent's log change is not append-only; it is dropped as today and the outcome matches today's for that case.
- Integration: mode off, the log output is byte for byte today's for every existing log test.
- Integration: the single entry round-trips through `parseWikiLogEntries` and `mergeWikiLogs`.

**Verification:**

- Type check, lint, tests, `bun run check:wiki-write-core-package` and `bun run check:mutation-guards` pass.
- The pull request title is `feat(wiki-write-core): …`, which releases 0.4.0.

### Pull request 2: the survey

- [ ] **Unit 3: The survey's instructions, retry text and schema**

**Goal:** A repeat survey follows the in-place rules, a quiet one succeeds with one log entry, and the schema agrees.

**Requirements:** R1–R7, R9–R14.

**Dependencies:** Pull request 1 merged.

**Files:**

- Modify: `.github/workflows/survey-repo.yaml`, `knowledge/schema.md`
- Test: `scripts/survey-repo-workflow.test.ts`

**Approach:**

- Replace the additive rule in `INGEST_PROMPT` with the repeat rules: change a current-state statement only on contrary evidence; keep unchecked statements and dated history; do not reword; a dated note only for a material change, with the origin's list; no second `sources` entry for the repository; when nothing changes, leave the page alone and write the log entry saying so.
- Add the sentence that tells the agent the repeat rules apply when the repository's page exists, and that a first survey writes a full page.
- `REWRITE_PROMPT` still replaces the rule for a rewrite.
- Both retry prefixes ask for the log entry, and for a page edit only when one is warranted.
- The persist job turns on the single log entry.
- `knowledge/schema.md`: the update rules gain the exception for repository pages written by surveys.

**Execution note:** Test-first. Change the prompt-contract tests, watch them fail, then edit the YAML.

**Patterns to follow:** The `INGEST_PROMPT` assertions and the `renderPrompt` helper in `scripts/survey-repo-workflow.test.ts`.

**Test scenarios:**

- Happy path: the base prompt carries each repeat rule and the material-change list, and no longer carries the additive sentence.
- Happy path: the rewrite prompt still replaces the rule, and a non-rewrite render is the base prompt.
- Happy path: both retry prefixes require the log entry and do not require a page change.
- Happy path: the persist job's ingest step sets the single-entry mode; the event and Observe ingest steps in `fro-bot.yaml` do not.
- Edge case: the prompt still limits writes to `knowledge/wiki/**` and `knowledge/log.md` and still has one line about the index.
- Integration: the retry conditions and the success expression are unchanged.

**Verification:**

- Type check, lint, tests and `actionlint` pass. Nothing under `packages/wiki-write-core/` changes.

---

- [ ] **Unit 4: Documentation**

**Goal:** The documentation describes the repeat rule and the single entry.

**Requirements:** Supports R1–R14.

**Dependencies:** Unit 3.

**Files:**

- Modify: `README.md`, `.github/copilot-instructions.md`, `docs/ideation/2026-11-07-open-ideation.md`

**Approach:**

- Where surveys are described: a repeat survey updates in place and a quiet one changes only the log.
- Ideation item 5: an Outcome line naming this work and #4242.

**Test expectation:** none -- documentation only.

**Verification:**

- `bun run lint` passes.

---

- [ ] **Unit 5: Live checks and the 30-day measure**

**Goal:** The first surveys show the rule working, and the measure is taken.

**Requirements:** R15, R16 and the origin's success criteria.

**Dependencies:** Units 1–4 merged, and `main` merged into `data` so surveys read the new schema.

**Files:**

- Modify: `docs/plans/2026-11-15-002-feat-repeat-surveys-update-in-place-plan.md` (record the results)

**Approach:**

- Read the first three scheduled repeat surveys: lines added to and removed from the page, the log entry count and wording, the attempt count.
- At 30 days, run the measure over `origin/data` survey commits: per commit, lines added to and removed from the surveyed page, repeats only. Failed runs come from the workflow's run list.
- Read every survey that removed more than 20 lines.

**Test expectation:** none -- live verification.

**Verification:**

- The results are recorded here with run and commit references. The median lines added is compared with 10 and with the baseline of 69.

## System-Wide Impact

- **Interaction graph:** the writer serves the survey, the event ingest and the Observe ingest through the same CLI path. Repair and rename call its functions directly and are not touched.
- **Error propagation:** a page outside the hand-off can no longer fail an ingest.
- **State lifecycle risks:** the schema change reaches `data` a day or so after it merges. Until then surveys read the old schema with the new prompt.
- **API surface parity:** the package gains one optional mode. The gate contract's version stays; its source hash changes.
- **Unchanged invariants:** change detection, the hand-off build and checks, the privacy gates, the result record, retry conditions, and the other ingests' log output.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The event or Observe ingest relied on writing pages outside its hand-off | Unit 1's no-hand-off test and a read of both callers before the change. A page outside the hand-off was never the agent's edit. |
| The agent deletes sound history | The rules keep unchecked statements and dated history. Unit 5 reads every survey that removes more than 20 lines. |
| The agent ignores the rule and keeps appending | The 30-day median is the check. |
| An entry body forges a second log entry | Unit 2 tests a body with a heading-shaped line. |
| The dashboard reads log entries | Not checked. The single entry keeps the schema's format. |
| The second pull request touches the package and releases it | Unit 3's verification checks that it does not. |
| A survey runs between the two merges | With only the first merged, surveys behave as today apart from the page filter. |

## Documentation / Operational Notes

- The measure, run from the repository root:

```sh
git log origin/data --since=<date> --format=%h -E --grep='^feat\(knowledge\): survey' | while read -r c; do
  p=$(git show --name-only --format= "$c" | grep '^knowledge/wiki/repos/' | head -1)
  git cat-file -e "$c^:$p" 2>/dev/null || continue
  git show --numstat --format= "$c" -- "$p" | awk -v c="$c" '{print c, $1, $2}'
done
```

A survey commit with no repository page in it is a quiet survey and counts as zero added and zero removed.

## Sources & References

- Origin: `docs/brainstorms/2026-11-15-repeat-surveys-update-in-place-requirements.md`
- Writer: `packages/wiki-write-core/src/wiki-ingest.ts`; hand-off: `packages/wiki-ops/src/wiki-handoff-core.ts`
- Survey workflow: `.github/workflows/survey-repo.yaml`; tests: `scripts/survey-repo-workflow.test.ts`, `scripts/wiki-ingest.test.ts`
- Schema: `knowledge/schema.md`
- Parked: [#4242](https://github.com/fro-bot/.github/issues/4242)
