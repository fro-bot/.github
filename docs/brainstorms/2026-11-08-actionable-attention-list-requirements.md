---
date: 2026-11-08
topic: actionable-attention-list
---

# Actionable "Needs Human Attention" List

## Summary

The daily report's "Needs Human Attention" section should list only live, actionable problems. Each item is keyed by the object its next action works on: an issue, a PR, a Project item, a file path, or a repo and workflow. Runs and comments are cited only as evidence. The agent re-checks each key just before it publishes and drops any item whose key has resolved. Each item shows its first-seen date, its owner and one next action. Items that only the operator can do come first, under "Awaiting you". When a key stays live on three consecutive reports and nothing tracks it yet, Fro Bot files a tracking issue for it, and Fro Bot closes that issue when the key resolves.

---

## Problem Frame

The Observe job writes the daily report from the prompt in `.github/workflows/fro-bot.yaml`. The body structure is defined at `:452-472`. The rules `SCOPE CAP`, `TRUSTED AUTHORS` and `AGENT NOTES` at `:219-261` decide what goes into "Needs Human Attention". The section is agent prose; no script builds it.

The five reports #4103 to #4131 held 32 bullets in this section. Eleven were actionable, 8 vague, 9 already resolved or informational, and 4 operator-only. Three problems stand out:

- **Resolved items stay listed.** #4131 still asked for a review of #4129 when #4129 had merged six and a half minutes before the report was created. The TypeScript 6→7 drift in that same item was still real, so a bullet can carry a resolved PR and a live problem at the same time.
- **Problems repeat without a stable key.** The items cite a different run, handoff comment or document each day. The permission-posture item cited #4092's comment, then a solutions doc twice, then nothing, then #4129's comment. The rollout item is stable on #3512, but it is missing from two of the five reports. So a key built from cited URLs churns daily.
- **Items lack an owner and a next action.** Owners are given as roles ("Renovate", "operator"). Several bullets bundle four runs or mix a verified read with an inference.

The operator reads this section to decide what to do next. When items are stale, vague or repeated, he has to re-check everything by hand.

---

## Requirements

**Keys and items**

- R1. Each item covers one problem and is keyed by the object its next action works on:
  - an issue, a PR or a Project item, by URL;
  - a file, by normalized repo path;
  - a failing workflow, by repo and workflow file.

  Runs, comments and documents are evidence. They are never keys. A bullet that bundles several problems is split.
- R2. Each item shows:
  - its owner: a GitHub handle, such as the PR author, the issue assignee or a bot handle like `renovate[bot]`, or "you" for the operator;
  - one next action, concrete enough to start without further research;
  - whether its claim is observed (backed by a cited read) or inferred.

**Live items only**

- R3. Just before publishing, the agent re-reads the current state of each item's key and drops items whose key has resolved: merged or closed, the path fixed, or the workflow passing again. When evidence has resolved but the key has not, the agent refreshes the evidence and keeps the item.
- R4. If the agent cannot read a key, it keeps the item and marks it "could not re-check", naming the source.

**Carry-over**

- R5. The agent finds the open predecessor report and reads it before it creates today's report. The order is: find, read, create, read back, close.
- R6. An item's first-seen date comes from the oldest consecutive prior report that lists the same key. The agent walks back through reports by key. A report written before this change counts when it plainly lists the same key. If no prior report has the key, first-seen is today. The agent never guesses an older date.

**Operator items**

- R7. Items only the operator can do appear first, under "Awaiting you". Each one gives the exact step: the PR to approve or merge, the setting to change, or the run to start.

**Escalation**

- R8. When a key stays live on three consecutive reports, Fro Bot files a tracking issue in fro-bot/.github with one dedicated label. The issue states the root cause, the smallest safe fix and how to verify it, following `AGENT NOTES`. From then on the report shows the item as one line linking that issue.
- R9. Fro Bot does not escalate:
  - an item whose key is already an issue, such as #3512, which is just linked;
  - an item that is already tracked;
  - an "Awaiting you" item;
  - an item whose fix belongs to Renovate under `DEPENDENCY OWNERSHIP`.
- R10. Before filing, Fro Bot searches the label's issues, open and closed, for one with the same key. It reuses an open one. If the operator closed it as not planned, it does not refile, and the report lists the item once as declined.
- R11. On every run, Fro Bot checks the open issues that carry the label and closes the ones whose key has resolved. The evidence goes in an edit to the issue body rather than a comment.
- R12. Applying and removing this label is an explicit exception to the report-only rule in category 5 at `fro-bot.yaml:396`.

**Privacy**

- R13. Items, evidence and tracking issues name public repos only. A problem in a private repo is reported without the repo's name or contents. When the agent cannot confirm a repo is public, it treats it as private.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** #4129, the TypeScript bump PR, merges at 05:39Z. The TypeScript item is keyed to `package.json`, which still pins 6.0.3, so the 05:46Z report keeps it with refreshed evidence and does not ask for a review of #4129.
- AE2. **Covers R4.** A cited registry lookup returns 404. The item stays, marked "could not re-check".
- AE3. **Covers R6.** The first report after release finds the rollout item's key, #3512, in the previous three reports. Its first-seen date is the oldest of those three.
- AE4. **Covers R7.** Renovate PR #4137 needs the operator's approval. It appears under "Awaiting you" as "Approve #4137 (Fro Bot cannot approve App-authored PRs)".
- AE5. **Covers R8, R9.** The permission-posture item is keyed to `.github/workflows/scorecard.yaml`, which is live on its third consecutive report. Fro Bot files one tracking issue for it. The rollout item, keyed to #3512, is linked and never escalated.
- AE6. **Covers R10.** The operator closes a tracking issue as not planned. The next report lists the item once as declined and files no new issue.
- AE7. **Covers R11.** The Scorecard permissions are fixed. On its next run Fro Bot closes the tracking issue and records the evidence in the issue body.
- AE8. **Covers R13.** A failing workflow in a private repo appears as "a workflow in a private repository is failing", with no name.

---

## Success Criteria

Measured over the first ten reports after release:

- At publish time, no item's key has already resolved.
- Every key that stays live on three consecutive reports is linked to a tracking issue, unless R9 excludes it.
- Every item has an owner and one next action.
- No report or tracking issue names a private repo.

---

## Scope Boundaries

- There is no collector script. The behavior lives in the Observe prompt and its contract tests.
- The signals the daily passes inspect, the report's other sections, and Remediate's fixes are unchanged.
- The only rule changed outside this section is category 5's label exception (R12).

---

## Key Decisions

- **Key by the object the next action works on, not by the cited URL.** Cited URLs churn daily. The object being acted on is stable.
- **Prompt duties, not a collector.** The #4129 miss was a stale read, and a re-check just before publishing fixes that. Per memory 12220, Fro Bot verifies its own surface.
- **Recurring items become issues Fro Bot owns,** and Fro Bot closes them when they resolve. Items that only the operator or Renovate can act on stay in the report, since a tracking issue would not move them.
- **Evidence for closing goes in the issue body,** because reports note that the harness allows a single comment per run. That limit has not been verified in fro-bot/agent.

---

## Dependencies / Assumptions

- `FRO_BOT_PAT` can create, label and close issues in fro-bot/.github. It already creates and closes the daily reports. Applying labels has not been verified.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Technical] The label name.
- [Affects R11][Needs research] Whether the agent's per-run comment budget is real, and where it is set.

---

## Next Steps

-> `/ce:plan` for structured implementation planning.
