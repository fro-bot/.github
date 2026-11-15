---
date: 2026-11-15
topic: repeat-surveys-update-in-place
---

# Repeat Surveys Update the Page in Place

## Summary

A repeat survey updates its page to describe the repository as it is now. It changes a statement only when it has evidence against it, adds a dated note only for a material change, and adds no duplicate source entry. A survey that finds nothing to change leaves the page as it was, writes its log entry, and succeeds.

---

## Problem Frame

A survey writes a wiki page about one tracked repository. Tracked repositories are re-surveyed every 14 to 30 days. In the 30 days to 2026-11-14 there were about 16 surveys a week, and 49 of 50 survey writes were repeats.

A repeat survey does not rewrite its page. It appends. In 20 sampled pairs of consecutive surveys of the same repository, every repeat added between 31 and 119 lines and removed one, the old `updated:` date. The amount added does not follow the amount that changed upstream: 4 commits produced 59 new lines, and 128 commits produced 71. In 5 of the 20 pairs the repository's head commit had not moved, and the survey still appended 31 to 56 lines restating that nothing had changed. Each survey also adds an entry to the page's `sources` list; one page has 11 entries for the same repository.

Two rules produce this. The survey's instructions say to update pages additively and never overwrite accumulated knowledge, and `knowledge/schema.md` says the same for every page. And a survey counts as successful only if it changed wiki content, so a survey with nothing new to say has to write something.

---

## Requirements

**What a repeat survey writes**

- R1. A repeat survey leaves the page describing the repository as it is now. A statement about the current state is changed where it stands, and only when the survey has evidence against it.
- R2. A statement the survey did not check stays as it is. The survey reads a limited set of files, and not having read something is not evidence that a statement about it is false.
- R3. Dated history stays: past findings that carry a date, corrections and their attribution are not removed or reworded.
- R4. A repeat survey does not reword, reorder or restate text that is still true.
- R5. A repeat survey adds a dated note only for a material change: one that would make a reader of the page act differently. Confirming that a fact still holds adds no text.
- R6. A repeat survey adds no `sources` entry for a URL the page already lists, and leaves the existing entries and their dates alone.
- R7. A first survey of a repository, and a survey the operator asks to rewrite, behave as today.

**A survey that finds nothing to change**

- R8. A repeat survey that finds nothing to change leaves the page byte for byte as it was.
- R9. It still writes its entry in the wiki log, saying that it verified the page and changed nothing.
- R10. That survey succeeds on its first attempt. It is not retried for having left the page alone.
- R11. A run in which the agent failed, refused or handed off nothing is still a failure, as today.

**The schema**

- R12. `knowledge/schema.md` states the rule for repository pages written by surveys as an exception to its additive rule, so the schema and the survey's instructions agree.

**Evidence**

- R13. For 30 days after the change, each repeat survey's page change is reported as lines added and lines removed, with a zero for a survey that changed nothing, and the count of surveys.
- R14. The change is judged to work when the median lines added per repeat survey is below 10. Any survey that removes more than 20 lines is read by the operator.

---

## Acceptance Examples

- AE1. **Covers R1, R5.** Given a page that says a repository uses one package manager and a repository that has moved to another, the repeat survey changes that statement where it stands and adds one dated note about the move.
- AE2. **Covers R2.** Given a page that records a finding about release history, and a survey that did not read releases, the finding stays as written.
- AE3. **Covers R3.** Given a page with a dated finding from an earlier survey that is now superseded, the dated finding stays, and the current-state statement above it is updated.
- AE4. **Covers R4, R5.** Given a repository whose README changed one sentence that the page does not describe, the page is not reworded and gains no section.
- AE5. **Covers R6.** Given a page with a `sources` entry for the repository's URL dated last month, the repeat survey leaves that entry as it is and adds none for the same URL.
- AE6. **Covers R8, R9, R10.** Given a repeat survey that finds every checked statement still true, the page is unchanged, the wiki log gains one entry saying so, and the survey succeeds on its first attempt.
- AE7. **Covers R11.** Given a survey run in which the agent refuses or writes nothing at all, the run fails as it does today.
- AE8. **Covers R7.** Given a repository with no page, the survey writes a full page as today.
- AE9. **Covers R14.** Given a repeat survey that removes 60 lines and adds 5, it is listed for the operator to read, whatever the median.

---

## Success Criteria

- Repository pages stop growing with each survey: the median lines added per repeat survey falls from the 31-to-119 range to below 10.
- A reader of a page sees what is true now, with dated notes only where something changed, and with the history that was there before.
- A quiet repository's survey ends in a success and one log line.
- A planner can write the change from this document without deciding what a repeat survey may change, what it must keep, or what counts as success.

---

## Scope Boundaries

- Skipping a survey when the repository has not changed. It is parked with its open decisions in [#4242](https://github.com/fro-bot/.github/issues/4242).
- Shrinking pages that have already grown, including their repeated source entries. One topic page is about 433 KB.
- Giving the agent a diff or a commit list to read, and changing what a survey may read.
- Changing how often repositories are surveyed.
- Topic and entity pages, and pages written by the daily passes.
- The conflict re-run path and the privacy gates.

---

## Key Decisions

- The page is left byte for byte unchanged when nothing changed, and the log entry is the record that the survey ran. Updating a date on the page would make every survey a page change again.
- The existing success test stays: something was handed off. The log entry satisfies it, so a quiet survey succeeds without a new mechanism. A log entry shows that the survey reported a verification; it does not prove the verification was sound.
- Change only on contrary evidence. The survey reads little, so it cannot know that an unchecked statement is false, and silent deletion of sound knowledge is the main risk of an in-place rule.
- The rule is an explicit exception in the schema. Left unstated, the schema and the instructions would contradict each other and the agent would follow whichever it read last.
- The measure reports removals as well as additions. Lines added alone would pass a survey that deleted a page's history.
- Skipping unchanged repositories is not built now. It needs separate dates for the last attempt and the last full survey, a new result value that the published schema and the scheduler reject today, removal of a recorded commit when a repository turns private, and a release, to save about four agent runs a week. Recorded as unexplored in `docs/ideation/2026-11-07-open-ideation.md` (item 5).

---

## Dependencies / Assumptions

- The survey's instructions require a log entry today, and the change detection that decides success counts the wiki log as wiki content. Not checked: whether a hand-off holding only a log change passes every step between the agent and the trusted writer.
- The trusted writer keeps a page's existing `sources` list and dates. The duplicate entries come from the agent's own edits.
- Instructions are followed by a model, so the result is likely, not certain. R13 and R14 are the check.
- Other writers also edit repository pages, so a page can change between surveys for reasons that are not a survey.
- The 20-pair sample sizes the problem. It used the commit the agent wrote into each page, which is not trusted.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8–R11][Technical] The path a log-only hand-off takes through change detection, the hand-off build, the trusted writer and the result record, and what each step needs so that it succeeds.
- [Affects R12][Technical] How the schema change reaches `data`, since `knowledge/` is promoted from `data` to `main`.
- [Affects R13][Technical] How a survey's page change is attributed and counted from the `data` branch's history, given other writers and conflict re-runs.
- [Affects R5][Technical] The wording that tells the agent what a material change is, with examples in the instructions.

---

## Sources / Research

- Survey workflow and instructions: `.github/workflows/survey-repo.yaml` (the additive rule in the ingest prompt; the three attempts; the success rule that requires a wiki change).
- Page rules: `knowledge/schema.md`.
- Source stamping by the trusted writer: `packages/wiki-write-core/src/wiki-ingest.ts`.
- Result write-back: `packages/registry/src/record-survey-result.ts`.
- Ideation item 5: `docs/ideation/2026-11-07-open-ideation.md`.
- Sample: 20 pairs of consecutive survey writes across 19 repositories on the `data` branch, and 70 survey runs from 2026-10-15 to 2026-11-14.
