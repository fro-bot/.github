---
date: 2026-11-15
topic: repeat-surveys-update-in-place
---

# Repeat Surveys Update the Page in Place

## Summary

A repeat survey updates its page to describe the repository as it is now. It changes a statement only when it has evidence against it, adds a dated note only for a material change, and adds no duplicate source entry. A survey that finds nothing to change leaves the page as it was and succeeds, and every survey leaves one log entry where it leaves two today.

---

## Problem Frame

A survey writes a wiki page about one tracked repository. Tracked repositories are re-surveyed every 14 to 30 days. In the 30 days to 2026-11-14 there were about 16 surveys a week, and 49 of 50 survey writes were repeats.

A repeat survey does not rewrite its page. It appends. In 20 sampled pairs of consecutive surveys of the same repository, every repeat added between 31 and 119 lines and removed one, the old `updated:` date. The amount added does not follow the amount that changed upstream: 4 commits produced 59 new lines, and 128 commits produced 71. In 5 of the 20 pairs the repository's head commit had not moved, and the survey still appended 31 to 56 lines restating that nothing had changed. Each survey also adds an entry to the page's `sources` list; one page has 11 entries for the same repository.

Two rules produce this. The survey's instructions say to update pages additively and never overwrite accumulated knowledge, and `knowledge/schema.md` says the same for every page. And a survey counts as successful only if it changed wiki content, so a survey with nothing new to say has to write something.

---

## Requirements

**What a repeat survey writes**

- R1. A repeat survey changes a statement about the repository's current state only when it has evidence against it, and changes it where it stands. After a survey, the statements it checked match what it found.
- R2. A statement the survey did not check stays as it is. The survey reads a limited set of files, and not having read something is not evidence that a statement about it is false.
- R3. Dated history stays: past findings that carry a date, corrections and their attribution are not removed or reworded. When the only statement of a changed fact sits in a dated section, the dated text stays and the survey adds a short current-state statement near the top of the page. The page is not restructured.
- R4. A repeat survey does not reword, reorder or restate text that is still true.
- R5. A repeat survey adds a dated note only for a material change. Material changes are a change to: the default branch, visibility or archived state; the language, runtime or package manager; how the repository builds, tests or releases; whether Fro Bot or Renovate is set up; the license; what the project is for. Dependency and version bumps, counts, CI status and anything that only confirms what the page says are not material and add no text.
- R6. A repeat survey adds no `sources` entry for the repository when the page already lists one for it, and leaves the existing entries and their dates alone. "Lists one for it" uses the same URL match as the privacy gate.
- R7. A first survey of a repository, and a survey the operator asks to rewrite, behave as today.

**A survey that finds nothing to change**

- R8. A repeat survey that finds nothing to change leaves the page byte for byte as it was. The trusted writer processes only the pages the survey handed off, so a page the agent did not touch is not rewritten.
- R9. The agent still writes its entry in the wiki log, naming the repository and saying that it verified the page and changed nothing.
- R10. That survey succeeds on its first attempt. It is not retried for having left the page alone, and a retry's instructions ask for a page edit only when one is warranted.
- R11. A run in which the agent failed or handed off nothing is still a failure, as today.

**The log**

- R12. Each survey leaves one entry in the wiki log. The trusted writer builds it from the agent's report and the sources it was given; it does not append the agent's entry and a second summary of its own.
- R13. The entry for a survey that changed no page says so. It does not say the wiki was updated.

**The schema**

- R14. `knowledge/schema.md` states the rule for repository pages written by surveys as an exception to its additive rule, so the schema and the survey's instructions agree.

**Evidence**

- R15. For 30 days after the change, each successfully written repeat survey that was not a rewrite is reported with the lines added to and removed from its own page in its own commit, with a zero for a survey that changed nothing, and the count of surveys. Failed runs are counted separately.
- R16. The change is judged to work when the median lines added per repeat survey is below 10. Any survey that removes more than 20 lines is read by the operator. Passing both does not prove that nothing of value was removed.

---

## Acceptance Examples

- AE1. **Covers R1, R5.** Given a page that says a repository uses one package manager and a repository that has moved to another, the repeat survey changes that statement where it stands and adds one dated note about the move.
- AE2. **Covers R2.** Given a page that records a finding about release history, and a survey that did not read releases, the finding stays as written.
- AE3. **Covers R3.** Given a page with a dated finding from an earlier survey that is now superseded and an undated statement of the same fact, the dated finding stays and the undated statement is updated.
- AE3a. **Covers R3.** Given a page where the superseded fact appears only inside a dated section, the dated text stays and one short current-state statement is added near the top.
- AE4. **Covers R4, R5.** Given a repository whose README changed one sentence that the page does not describe, the page is not reworded and gains no section.
- AE4a. **Covers R5.** Given a repository that bumped twelve dependencies and whose star count rose, the page gains no note. Given a repository that was archived, the page gains one dated note.
- AE5. **Covers R6.** Given a page with a `sources` entry for the repository's URL dated last month, the repeat survey leaves that entry as it is and adds none for the same URL.
- AE6. **Covers R8–R10, R12, R13.** Given a repeat survey that finds every checked statement still true, the page is unchanged, the wiki log gains exactly one entry saying the page was verified and not changed, and the survey succeeds on its first attempt.
- AE6a. **Covers R8.** Given a quiet survey of one repository while another repository's page differs between `main` and `data`, neither page is rewritten by the survey's write.
- AE6b. **Covers R12.** Given a survey that changed its page, the wiki log gains exactly one entry for it.
- AE7. **Covers R11.** Given a survey run in which the agent writes nothing at all, the run fails as it does today.
- AE8. **Covers R7.** Given a repository with no page, the survey writes a full page as today.
- AE9. **Covers R16.** Given a repeat survey that removes 60 lines and adds 5, it is listed for the operator to read, whatever the median.

---

## Success Criteria

- Repository pages stop growing with each survey: the median lines added per repeat survey falls from the 31-to-119 range to below 10.
- A reader of a page sees what is true now, with dated notes only where something changed, and with the history that was there before.
- A quiet repository's survey ends in a success and one log entry.
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
- The existing success test stays: something was handed off. The agent's log entry satisfies it, so a quiet survey succeeds without a new mechanism. This does not detect a refusal written into the log, and it does not today either. A log entry shows that the survey reported a verification; it does not prove the verification was sound. The 30-day report is the check.
- One log entry per survey. Today the trusted writer keeps the agent's entry and appends its own summary, which says the wiki was updated whatever happened. The writer lives in `@fro.bot/wiki-write-core`, so this change cuts a package release.
- Change only on contrary evidence. The survey reads little, so it cannot know that an unchecked statement is false, and silent deletion of sound knowledge is the main risk of an in-place rule.
- The rule is an explicit exception in the schema. Left unstated, the schema and the instructions would contradict each other and the agent would follow whichever it read last.
- The measure reports removals as well as additions. Lines added alone would pass a survey that deleted a page's history.
- Skipping unchanged repositories is not built now. It needs separate dates for the last attempt and the last full survey, a new result value that the published schema and the scheduler reject today, removal of a recorded commit when a repository turns private, and a release, to save about four agent runs a week. Recorded as unexplored in `docs/ideation/2026-11-07-open-ideation.md` (item 5).

---

## Dependencies / Assumptions

- A hand-off holding only a log change passes change detection, the hand-off build, the trusted writer and the result record today, and no retry fires. A test covers the log-only case in the writer.
- Not confirmed: the trusted writer finds changed pages from the checkout's git status after `data` is laid over `main`, not from the hand-off, so a page that differs between the branches may be processed as if the survey had edited it. R8 requires that it is not. Planning confirms the behaviour with a fixture before choosing the fix.
- The trusted writer's current stamping does not add a second entry for a repository already in a page's `sources`. The repeated entries on today's pages match the agent's own edits; the author of every old entry is not established.
- A schema change is an ordinary pull request against `main`. Surveys read the `data` branch's copy of `knowledge/`, so the new rule takes effect after the next merge of `main` into `data`.
- The log is read by other tools. Not checked: whether any reader depends on the trusted summary's current wording.
- Instructions are followed by a model, so the result is likely, not certain. R15 and R16 are the check.
- Other writers also edit repository pages, so a page can change between surveys for reasons that are not a survey.
- The 20-pair sample sizes the problem. It used the commit the agent wrote into each page, which is not trusted.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Technical] Whether the trusted writer rewrites pages the survey did not hand off, and the smallest change that stops it for surveys without changing the other writers' behaviour.
- [Affects R12, R13][Technical] The shape of the single log entry, which callers of the writer besides the survey get it, every reader of the log's current entries, and the release type.
- [Affects R15][Technical] How a survey's commit is told apart as first, repeat or rewrite, and tied to its run, from the `data` branch's history.
- [Affects R10][Technical] The retry instructions' new wording.
- [Technical] Whether the prompt change and the writer change ship as one pull request or two.

---

## Sources / Research

- Survey workflow and instructions: `.github/workflows/survey-repo.yaml` (the additive rule in the ingest prompt; the three attempts; the success rule that requires a wiki change).
- Page rules: `knowledge/schema.md`.
- Source stamping by the trusted writer: `packages/wiki-write-core/src/wiki-ingest.ts`.
- Result write-back: `packages/registry/src/record-survey-result.ts`.
- Ideation item 5: `docs/ideation/2026-11-07-open-ideation.md`.
- Sample: 20 pairs of consecutive survey writes across 19 repositories on the `data` branch, and 70 survey runs from 2026-10-15 to 2026-11-14.
