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

- **With a hand-off, the manifest's changed pages are the page input.** The manifest lists exactly what the agent changed, and the apply step has already copied those pages into the working tree. Git status is not consulted for pages in that case, so a handed-off page whose bytes happen to equal `main`'s is still written. Deletions keep coming from the manifest's deleted list, as today. This applies to the event and Observe ingests too: they have the same defect. Without a hand-off nothing changes.
- **The single log entry is an option of the build function, off by default.** The CLI sets it from the environment, and only the survey's persist step sets that. The other ingests keep their output byte for byte, which a differential test shows.
- **The single entry is built by the writer from the agent's text as data.** The transformation is fixed:
  1. Take the agent's append-only log suffix. A suffix that is not append-only is dropped with today's warning, and the outcome for that case is today's.
  2. Normalise line breaks (CRLF and bare CR become LF), then drop every line that starts with `## [` or `Sources:` once its leading whitespace is removed. Nothing in the agent's text can then start an entry or name a source.
  3. Trim, and collapse runs of blank lines. Keep at most 4,000 characters; when text is cut, end with a fixed line saying so.
  4. Emit one entry: the trusted heading (timestamp, operation, target), the summary sentence, the kept text if any, then `Sources:` from the trusted input.

  The agent's headings, timestamps, targets and sources are never used. Several agent entries become one body in order. With no kept text the entry is the summary and sources alone.

- **The summary sentence depends on the hand-off.** When the hand-off carries no changed and no deleted page, the sentence says the target was verified and no page changed. Otherwise it is the caller's summary. The test is the hand-off's contents, not a byte comparison with `data`.
- **Known limit, unchanged:** `mergeWikiLogs` keys entries by minute and target, so two surveys of one repository in the same minute collapse when logs are merged. Today's trusted entries have the same key.
- **Two pull requests, the writer first.** The writer change releases the package; the prompt change must not touch the package. The prompt's claims about other pages and about the log need the writer change.
- **The agent is told how to recognise a repeat.** The prompt has no first-survey branch. It gains a sentence: when the target repository's page exists, the repeat rules apply to that page.
- **The repeat rules cover the target repository's page only.** Topic, entity and comparison pages the survey touches keep the additive rule.
- **The prompt carries the whole rule and says it overrides the schema for that page.** Between this change merging and `main` reaching `data`, surveys read the old schema. The schema edit is the durable record, not what makes the run coherent.
- **A rewrite overrides every repeat rule.** The rewrite text names them, since "the rule against overwriting" no longer identifies one sentence.
- **Retries keep their conditions.** A log-only attempt already counts as changed, so no retry fires. Only the retry text changes: the log entry is required, a page edit only when warranted, and no wiki change at all when the survey cannot be completed.
- **The schema exception is scoped** to repository pages written by surveys.
- **No second source entry is an instruction, not an enforced rule.** The writer leaves a non-empty `sources` list alone, so an agent that adds a duplicate still lands it. The measure does not catch that; Unit 5 reads `sources` on the first three surveys.

## Open Questions

### Resolved During Planning

- Whether the writer rewrites pages the survey did not hand off: yes, shown with a fixture on the real entry point.
- Who reads log entries: the writer's own merge and parse functions and `rebuild-wiki-index`. Not checked: the dashboard.
- How the schema change reaches surveys: a pull request to `main`, then the daily merge into `data`.
- How the measure is computed: one documented `git log` command over `origin/data`. The 14-day baseline is 23 repeat surveys, median 69 lines added and 1 removed.

### Deferred to Implementation

- The exact wording of the prompt rules, the retry text and the two log sentences.
- The names of the build option and the environment variable.
- The wording of the cut-off line.

## Implementation Units

### Pull request 1: the writer

- [x] **Unit 1: Write only the pages a hand-off carries**

**Goal:** With a hand-off present, the writer processes the hand-off's pages and no others.

**Requirements:** R8.

**Dependencies:** None.

**Files:**

- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`
- Test: `scripts/wiki-ingest.test.ts`
- Modify: `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- In the CLI's hand-off branch, the page input is the manifest's changed page paths, without the shared log and index files. The empty check, the committed-page list and the reported page count use that list. Deleted pages come from the manifest as today.
- Without a hand-off, behaviour is unchanged.
- Read the event and Observe ingest steps first and confirm neither depends on pages outside its hand-off.

**Execution note:** Test-first. Start with a status that lists pages the hand-off does not.

**Patterns to follow:** The existing hand-off tests in `scripts/wiki-ingest.test.ts` and the Git Data fake from `@fro-bot/test-kit`.

**Test scenarios:**

- Happy path: status lists pages A and B, the hand-off carries A; A is written and B is not in the commit.
- Edge case: a log-only hand-off with status listing A and B writes neither page, and the reported count of pages changed is 0. This replaces the empty-status version of the log-only test.
- Edge case: B has non-canonical frontmatter and is not handed off; its bytes on `data` are unchanged.
- Error path: B has invalid frontmatter and is not handed off; the write succeeds.
- Error path: a handed-off page with invalid frontmatter still fails as today.
- Edge case: a handed-off page whose bytes equal the checkout's, so status does not list it, is still in the write.
- Edge case: a hand-off that deletes a page, and one that deletes a page and adds another (a rename), commit the deletion and the addition as today.
- Integration: with no hand-off, the pages written match today's for the same status.
- Integration: the index is still rebuilt from every page in the working tree.

**Verification:**

- Type check, lint, tests, `bun run check:wiki-write-core-package` (after `bun run build`) and `bun run check:mutation-guards` pass.

---

- [x] **Unit 2: One log entry when the caller asks for it**

**Goal:** A caller can have the writer leave one log entry per ingest.

**Requirements:** R12, R13.

**Dependencies:** Unit 1 (the count of pages written).

**Files:**

- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`
- Test: `scripts/wiki-ingest.test.ts`
- Modify: `packages/wiki-write-core/README.md`, `packages/wiki-write-core/dist/gate-contract.json` (regenerated)

**Approach:**

- An optional parameter of the function that builds the ingest's changes, off by default. The CLI sets it from one environment variable. The repository's wrapper script passes nothing extra.
- In the mode, the writer applies the four-step transformation under Key Technical Decisions and emits one entry in the schema's format.
- The summary sentence follows the hand-off: no changed or deleted page gives the verified, no-page-changed sentence.
- The entry parses as exactly one entry with `parseWikiLogEntries`.
- The existing two-entry tests stay as they are, as the default-mode tests. The empty-status log-only test stays too; Unit 1 adds the realistic one beside it.

**Execution note:** Test-first.

**Patterns to follow:** `appendLogEntry` for the entry format; the existing two-entry tests, which stay as the default-mode tests.

**Test scenarios:**

- Happy path: mode on, the agent wrote one entry and one page; the log gains exactly one entry with the trusted heading, the agent's body and the trusted sources. (Origin AE6b.)
- Happy path: mode on, log-only hand-off; exactly one entry, and it says no page changed. (Origin AE6.)
- Edge case: mode on, the agent wrote two entries; one entry holds both bodies in order, with neither agent heading.
- Edge case: mode on, the agent's text has lines before its first heading; they are kept as body.
- Edge case: mode on, the agent's heading names another repository or operation; the entry's heading is still the trusted one and the agent's is gone.
- Edge case: mode on, the agent's text has `Sources:` lines at the end and in the middle; none survives, and the entry's only `Sources:` is the trusted one.
- Edge case: mode on, a body line starts with `## [` and a valid-looking timestamp; the log still parses as one new entry.
- Edge case: mode on, the agent's entry has no body; the entry is the summary and sources.
- Edge case: mode on, the agent's text is longer than the limit; it is cut at the limit and ends with the fixed line.
- Error path: mode on, the agent's log change is not append-only; it is dropped with today's warning. With a page in the hand-off the write proceeds with the summary-only entry; with nothing else in the hand-off nothing is committed, as today.
- Happy path: mode on, a hand-off that only deletes a page uses the caller's summary, not the no-page-changed sentence.
- Integration: mode off, the log output is byte for byte today's for every existing log test.
- Integration: the single entry round-trips through `parseWikiLogEntries` and `mergeWikiLogs`.

**Verification:**

- Type check, lint, tests, `bun run check:wiki-write-core-package` and `bun run check:mutation-guards` pass.
- The pull request title is `feat(wiki-write-core): …`, which releases 0.4.0.

### Pull request 2: the survey

- [x] **Unit 3: The survey's instructions, retry text and schema**

**Goal:** A repeat survey follows the in-place rules, a quiet one succeeds with one log entry, and the schema agrees.

**Requirements:** R1–R7, R9–R14.

**Dependencies:** Pull request 1 merged.

**Files:**

- Modify: `.github/workflows/survey-repo.yaml`, `knowledge/schema.md`
- Test: `scripts/survey-repo-workflow.test.ts`

**Approach:**

- Keep the additive rule for topic, entity and comparison pages. Add the repeat rules for the target repository's page when it already exists, and say they override the schema's additive and contradiction rules for that page:
  - change a current-state statement only on contrary evidence, where it stands;
  - leave statements the survey did not check;
  - keep dated findings, corrections and attribution as written; when the only statement of a changed fact is inside a dated section, leave it and add one short current-state statement near the top, without restructuring the page;
  - do not reword, reorder or restate what is still true;
  - add a dated note only for a material change, with the origin's list of what is and is not material;
  - add no `sources` entry for the repository when one is already listed for it (the repository's URL, with or without a path under it), and leave existing entries and dates alone;
  - when nothing changes, leave the page untouched and write the log entry naming the repository and saying it was verified and not changed.
- A first survey, with no page, writes a full page as today.
- `REWRITE_PROMPT` says a rewrite replaces all of the repeat rules.
- Both retry prefixes: the log entry is required, a page edit only when warranted, and no wiki change when the survey cannot be completed. The existing assertion that the prefix does not contain "append a log entry" is kept or changed on purpose, with the reason in the test.
- The persist job turns on the single log entry.
- `knowledge/schema.md`: the update rules gain the exception for repository pages written by surveys.

**Execution note:** Test-first. Change the prompt-contract tests, watch them fail, then edit the YAML.

**Patterns to follow:** The `INGEST_PROMPT` assertions and the `renderPrompt` helper in `scripts/survey-repo-workflow.test.ts`.

**Test scenarios:**

- Happy path: the base prompt carries each repeat rule, scoped to the target repository's page, and the material-change list with both its halves. (Origin AE1, AE2, AE4, AE4a.)
- Happy path: the prompt carries the dated-only case: keep the dated text, add one current-state statement near the top. (Origin AE3, AE3a.)
- Happy path: the prompt carries the sources rule with its URL match and the instruction to leave existing dates. (Origin AE5.)
- Happy path: the prompt says a first survey writes a full page, and that the repeat rules override the schema for the target page. (Origin AE8.)
- Happy path: the additive rule remains for other page types.
- Happy path: the rewrite prompt overrides the repeat rules by name, and a non-rewrite render is the base prompt.
- Happy path: both retry prefixes require the log entry, do not require a page change, and still say to make no wiki changes when the survey cannot be completed.
- Edge case: the success expression still requires a wiki change, so a run that hands off nothing fails. (Origin AE7.)
- Happy path: the persist job's ingest step sets the single-entry mode; the event and Observe ingest steps in `fro-bot.yaml` do not.
- Edge case: the prompt still limits writes to `knowledge/wiki/**` and `knowledge/log.md` and still has one line about the index.
- Integration: the retry conditions and the success expression are unchanged.

**Verification:**

- Type check, lint, tests and `actionlint` pass. Nothing under `packages/wiki-write-core/` changes.

---

- [x] **Unit 4: Documentation**

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

- Read the first three scheduled repeat surveys: lines added to and removed from the page, the page's `sources` list, the log entry count and wording, the attempt count.
- At 30 days, run the measure in the operational notes. It takes the surveyed page from each commit's subject, prints zero for a quiet survey, and leaves out first surveys.
- By hand: remove rewrite surveys (operator dispatches with the rewrite input) and count failed runs from the workflow's run list. Record anything ambiguous instead of classifying it.
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
| An entry body forges a second log entry or a source | Heading-shaped and `Sources:` lines are dropped from the agent's text; Unit 2 tests both. |
| The agent adds a duplicate source anyway | Not enforced by the writer. Unit 5 reads `sources` on the first surveys. |
| Two surveys of one repository in the same minute collapse in a log merge | Unchanged from today. Recorded as a limit. |
| The dashboard reads log entries | Not checked. The single entry keeps the schema's format. |
| The second pull request touches the package and releases it | Unit 3's verification checks that it does not. |
| A survey runs between the two merges | With only the first merged, surveys behave as today apart from the page filter. |

## Documentation / Operational Notes

- The measure is a Python script run from the repository root as `python3 measure.py <since> <until>`. It derives the surveyed page from each commit's subject, prints zero for a survey that left the page alone, and skips first surveys. Rewrite surveys and failed runs are reconciled by hand.

```python
import re
import statistics
import subprocess
import sys

since, until = sys.argv[1:3]


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def slug(segment):
    return re.sub(r"[^a-z0-9-]+", "-", segment.lower()).strip("-")


commits = git(
    "log", "origin/data", f"--since={since}", f"--until={until}",
    "--format=%H", "-E", r"--grep=^feat\(knowledge\): survey ",
).splitlines()

rows = []
for commit in commits:
    target = git("show", "-s", "--format=%s", commit).removeprefix("feat(knowledge): survey ")
    owner, repo = target.split("/", 1)
    path = f"knowledge/wiki/repos/{slug(owner)}--{slug(repo)}.md"
    if subprocess.run(["git", "cat-file", "-e", f"{commit}^:{path}"], capture_output=True).returncode != 0:
        continue
    diff = git("diff", "--numstat", f"{commit}^", commit, "--", path)
    added, removed = diff.split("\t", 2)[:2] if diff else ("0", "0")
    rows.append((commit[:12], target, int(added), int(removed)))

for row in rows:
    print(*row)
print("count:", len(rows))
if rows:
    print("median added:", statistics.median(row[2] for row in rows))
    print("median removed:", statistics.median(row[3] for row in rows))
    print("removed more than 20:", [row for row in rows if row[3] > 20])
```

Baseline, 2026-11-01 to 2026-11-14: 23 repeat surveys, median 69 lines added and 1 removed.

## Sources & References

- Origin: `docs/brainstorms/2026-11-15-repeat-surveys-update-in-place-requirements.md`
- Writer: `packages/wiki-write-core/src/wiki-ingest.ts`; hand-off: `packages/wiki-ops/src/wiki-handoff-core.ts`
- Survey workflow: `.github/workflows/survey-repo.yaml`; tests: `scripts/survey-repo-workflow.test.ts`, `scripts/wiki-ingest.test.ts`
- Schema: `knowledge/schema.md`
- Parked: [#4242](https://github.com/fro-bot/.github/issues/4242)
