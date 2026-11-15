---
date: 2026-11-15
topic: repeat-surveys-skip-and-update-in-place
---

# Repeat Surveys: Skip When Unchanged, Update in Place When Changed

## Summary

Two changes to repeat surveys, shipped separately. Trusted code records the head commit each survey saw, and a repeat survey of a repository whose head has not moved skips the agent until the last full survey is 30 days old. When a repeat survey does run, it updates the page to describe the repository as it is now and adds a dated note only for a material change.

---

## Problem Frame

A survey writes a wiki page about one tracked repository. Tracked repositories are re-surveyed on a cadence of 14 to 30 days. In the 30 days to 2026-11-14 there were about 16 surveys a week, and 49 of 50 survey writes were repeats.

A repeat survey does not rewrite its page. It appends. In 20 sampled pairs of consecutive surveys of the same repository, every repeat added between 31 and 119 lines and removed one, the old `updated:` date. The amount added does not follow the amount that changed upstream: 4 commits produced 59 new lines, and 128 commits produced 71. Each survey also adds an entry to the page's `sources` list; one page has 11 entries for the same repository.

In 5 of the 20 pairs the repository's head commit was the same at both surveys. Those surveys still ran the agent and still appended 31 to 56 lines, restating that nothing had changed.

Nothing trusted records which commit a survey saw. The commit in a page's `sources` is written by the agent. `metadata/repos.yaml`, which trusted code writes, records when a survey ran and whether it succeeded, and no commit.

A survey counts as successful only if the page changed. A survey that finds nothing to change is retried up to twice and then fails.

The ideation item behind this work proposed giving the agent only the changes since the last survey. Surveys already read little: the agent never checks out the target and reads listings, READMEs, manifests and workflow files through the API. Narrowing what it reads is not part of this work.

---

## Requirements

**Recording what a survey saw**

- R1. Trusted code reads the target's default-branch head commit before the agent runs and records it with the survey's result in `metadata/repos.yaml`. The agent does not supply it.
- R2. The record is written for public repositories only, and only when the survey succeeded.
- R3. The record also identifies what the survey was asked to do, so that a change to the survey's instructions makes every repository due for a full survey.

**Skipping**

- R4. A repeat survey is skipped when the head commit equals the recorded one, the survey's instructions are unchanged since that record, and the last full survey is less than 30 days old.
- R5. Any other state runs a full survey: no record, a different head, a head that cannot be read, changed instructions, or a last full survey 30 or more days old.
- R6. A skipped survey runs no agent. Its visibility and onboarding checks still run, and a repository that fails them is handled as it is today.
- R7. A skipped survey is recorded as its own outcome, distinct from success and failure. It moves the repository's next eligible date as a completed survey does. It does not move the date of the last full survey.
- R8. An operator can force a full survey of a repository regardless of the record.

**Shadow period**

- R9. The skip ships in shadow. For each repeat survey that R4 would skip, the run says so in its summary and still runs the agent.
- R10. Each would-skip run's page change is classified as re-verification only or as substantive, and the count of each is reported.
- R11. Skipping turns on by an explicit operator decision after at least 10 would-skip runs, when none of them was substantive. If any was, the decision and the rule come back for review with that run as evidence.

**Writing in place**

- R12. A repeat survey updates the page so that it describes the repository as it is now. Statements that are no longer true are corrected or removed where they stand.
- R13. A repeat survey adds a dated note only for a material change: something a reader of the page would act on differently. Re-verifying that a fact still holds is not a material change and adds no text.
- R14. A repeat survey does not add a `sources` entry for a URL the page already lists. It updates that entry's date.
- R15. A repeat survey that finds nothing to change is a success. It is recorded as verified with no change, it is not retried, and it does not fail.
- R16. A first survey of a repository, and a survey the operator asks to rewrite, behave as today.

**Evidence**

- R17. For 30 days after the write rule ships, the lines added per repeat survey are reported against the baseline of 31 to 119. The write rule is judged to work when the median falls below 10.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a successful survey of a public repository whose head is commit A, the repository's metadata row records A after the survey. Given the same survey of a repository that is not public, no commit is recorded.
- AE2. **Covers R4, R6, R7.** Given a recorded commit A from a full survey 10 days ago, unchanged instructions and a head still at A, the survey runs no agent, records a skipped outcome and moves the next eligible date. The date of the last full survey stays.
- AE3. **Covers R5.** Given the same repository with its head at commit B, a full survey runs. Given a head that cannot be read, a full survey runs.
- AE4. **Covers R5.** Given a recorded commit A, a head still at A and a last full survey 31 days ago, a full survey runs.
- AE5. **Covers R3, R5.** Given the survey's instructions changed after the record was written, every repository's next survey is a full survey even where the head has not moved.
- AE6. **Covers R9, R10.** Given the shadow period and a repeat survey that R4 would skip, the run's summary says it would have been skipped, the agent runs, and the resulting page change is classified.
- AE7. **Covers R11.** Given 10 would-skip runs classified as re-verification only, the operator can turn skipping on. Given 9 such runs and one substantive, skipping stays off.
- AE8. **Covers R12, R13.** Given a page that says a repository uses one package manager and a repository that has moved to another, the repeat survey changes that statement where it stands and adds one dated note about the move. It does not append a section restating the unchanged facts.
- AE9. **Covers R14.** Given a page with a `sources` entry for the repository's URL dated last month, the repeat survey leaves one entry for that URL, with today's date.
- AE10. **Covers R15.** Given a repeat survey that finds every statement on the page still true, the page is unchanged, the survey succeeds on its first attempt and the result records verified with no change.
- AE11. **Covers R8.** Given a repository whose record would skip it, an operator's forced survey runs the agent.

---

## Success Criteria

- A repeat survey of an unchanged repository costs no agent run, and the operator turned that on from evidence, not from assumption.
- Repository pages stop growing with each survey: the median lines added per repeat survey falls from the 31-to-119 range to below 10.
- A reader of a page sees what is true now, with dated notes only where something changed.
- A planner can write both changes from this document without deciding what is recorded, when a survey is skipped, or what a repeat survey writes.

---

## Scope Boundaries

- Shrinking pages that have already grown. One topic page is about 433 KB. That is a separate piece of work.
- Giving the agent a diff or a commit list to read.
- Changing how often repositories are surveyed.
- The conflict re-run path, the privacy gates and the survey's read limits. They stay as they are.
- Topic and entity pages. This covers repository pages written by surveys.

---

## Key Decisions

- Two changes, shipped separately. The write rule is a change to the survey's instructions and its success rule. The skip needs a new metadata field, which changes the published package and needs a release.
- The commit is recorded by trusted code in metadata, not read from the page. The page is written by the agent, and a wrong value there could make a skip fire when it should not.
- A skip requires an equal head, nothing weaker. A rewritten history or a renamed default branch gives a different head and therefore a full survey, with no comparison between commits.
- A maximum age of 30 days. A head commit says nothing about settings, releases or whether a workflow is present, and wiki lint flags pages untouched for 90 days.
- Shadow first. Five of 20 sampled repeats had an unchanged head, and whether their page changes carried anything beyond re-verification was not classified. The shadow period measures that before any survey is skipped.
- A survey that changes nothing succeeds. Without this, the write rule would turn every quiet repository into a failed survey.
- Narrowing what the survey reads is dropped. Recorded as unexplored in `docs/ideation/2026-11-07-open-ideation.md` (item 5); the evidence here does not support it.

---

## Dependencies / Assumptions

- `metadata/repos.yaml` rows are written by trusted code after a survey. Adding a field to the row changes the schema in `@fro.bot/wiki-write-core`, which is published; a merge that adds it cuts a release. Not checked: whether the dashboard reads that file with a parser that rejects an unknown field.
- A skipped survey leaves the page's `updated:` date alone. With a 30-day maximum age no page goes 90 days without a full survey.
- The 20-pair sample used the commit the agent wrote into each page, which is not trusted. It sizes the problem and decides nothing.
- Other writers also edit repository pages, so a page can change between surveys for reasons that are not a survey.
- Per-run cost appears in each job summary and is not aggregated. The saving from skipping is counted in agent runs, not in money.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R3][Technical] The metadata field or fields, and how the survey's instructions are identified.
- [Affects R6, R7][Technical] Where the skip decision sits among the survey's jobs so that the visibility and onboarding checks still run, and how the skipped outcome is stored.
- [Affects R10][Technical] How a would-skip run's page change is classified, and by what.
- [Affects R15][Technical] How the survey tells "verified, nothing to change" from "the agent did nothing", given that both leave the page unchanged.
- [Affects R14][Technical] Whether the `sources` rule is enforced by the trusted writer or stated in the survey's instructions.
- [Affects R1][Needs research] Whether the published package's consumers accept the new field.

---

## Sources / Research

- Survey workflow: `.github/workflows/survey-repo.yaml` (resolve, agent attempts, persist, re-dispatch; the success rule requires a page change).
- Result write-back and cadence: `packages/registry/src/record-survey-result.ts`, `packages/registry/src/repos-metadata.ts`, `packages/registry/src/reconcile-plan.ts`, `packages/registry/src/reconcile-effects.ts`.
- Metadata schema: `packages/wiki-write-core/src/schemas.ts`.
- Page schema: `knowledge/schema.md`.
- Ideation item 5: `docs/ideation/2026-11-07-open-ideation.md`.
- Sample: 20 pairs of consecutive survey writes across 19 repositories on the `data` branch, and 70 survey runs from 2026-10-15 to 2026-11-14.
