---
date: 2026-11-08
topic: actionable-attention-list
---

# Actionable "Needs Human Attention" List

## Summary

The daily report's "Needs Human Attention" section should list only items that are still live and actionable. The agent re-checks every cited PR, issue, run and alert just before it publishes, and drops anything that has resolved. Each item is keyed by the URL it cites, and shows its first-seen date, its owner and one next action. Items only the operator can do sit at the top under "Awaiting you". When an item appears unchanged on three reports, Fro Bot files or links a tracking issue for it, and from then on the report points to that issue instead of restating the item.

---

## Problem Frame

The Observe job writes the daily report from the prompt in `.github/workflows/fro-bot.yaml`. The body structure is at `:452-472`, and the routing rules that send items to "Needs Human Attention" are `SCOPE CAP`, `TRUSTED AUTHORS` and `AGENT NOTES` at `:219-261`. No script builds the section. It is agent prose.

Across the five reports #4103 to #4131, the section held 32 items:

| Kind | Count |
| --- | --- |
| Actionable | 11 |
| Vague | 8 |
| Already resolved | 9 |
| Operator-only | 4 |

- **Resolved items stay listed.** #4131, the report for 11-07, asked for a review of #4129, which had merged seven minutes before the report was created. Reports cited #4116 and #4112 as open on the day they merged.
- **Items repeat with nothing changing.** The rollout reconciliation item appeared in 5 of 5 reports, the permission posture item in 5 of 5, and the TypeScript 6→7 item in 4 of 5. Each day restates them with fresh run IDs.
- **Items lack what the operator needs to act.** They carry no stable key, no first-seen date and no named owner. Owners are roles such as "Renovate" or "operator". Several items mix a verified link with an inference.

The operator reads this section to decide what to do next. Stale and vague items make him re-check everything by hand, which is the toil Fro Bot exists to remove.

---

## Requirements

**Live items only**

- R1. Immediately before publishing the report, the agent re-reads the current state of every PR, issue, workflow run and alert that an attention item cites. It drops items whose cited object has merged, closed or recovered.
- R2. If the agent cannot read an item's cited object, it keeps the item and marks it "could not re-check", naming the source. It does not drop the item on a failed read.

**Item shape**

- R3. Each item is keyed by the URL of its primary cited object. An item with no citable object names the file path or workflow it concerns.
- R4. Each item shows its first-seen date. The agent reads that date from the previous daily report's entry with the same key. If the previous report is missing or unreadable, first-seen is today's date. It never guesses an older date.
- R5. Each item names its owner: a GitHub handle, or "you" for the operator.
- R6. Each item states exactly one next action, concrete enough to start on without further research.
- R7. An item says whether its claim is observed (backed by a cited read) or inferred.

**Operator items**

- R8. Items only the operator can do appear first, under "Awaiting you". Each one gives the exact step to take: the PR to approve or merge, the setting to change, or the run to start.

**Escalation**

- R9. When an item's key appears on three consecutive daily reports with no change in its cited object's state, Fro Bot files a tracking issue in fro-bot/.github, or links an existing one. The issue carries one dedicated label and states the root cause, the smallest safe fix and how to verify it, following `AGENT NOTES`.
- R10. Before filing, Fro Bot searches open issues with that label for one citing the same key, and reuses it if found.
- R11. Once an item has a tracking issue, the report shows it as one line linking that issue.
- R12. When the cited object resolves, Fro Bot closes the tracking issue with a comment that links the evidence.

---

## Acceptance Examples

- AE1. **Covers R1.** A PR cited as "awaiting review" merges at 05:39Z, and the report is published at 05:46Z. The report does not list it.
- AE2. **Covers R2.** The agent's read of a cited run returns 404. The item stays, marked "could not re-check: run 123 returned 404".
- AE3. **Covers R4.** The rollout item appeared in yesterday's report with first-seen 11-03. Today's entry shows first-seen 11-03.
- AE4. **Covers R8.** Renovate PR #4137 needs the operator's approval. It appears under "Awaiting you" as "Approve #4137 (Fro Bot cannot approve App-authored PRs)".
- AE5. **Covers R9, R10, R11.** The permission posture item appears unchanged on its third report. Fro Bot finds no open labeled issue for it, files one, and the report shows a single line linking the new issue.
- AE6. **Covers R12.** The cited Scorecard alert closes. On its next run Fro Bot closes the tracking issue and links the closed alert.

---

## Success Criteria

- Over the first ten reports after release, no attention item cites an object that had already resolved when the report was published.
- No item key is restated in full on more than three consecutive reports. After that it is a single linked line.
- Every item has an owner and one next action.

---

## Scope Boundaries

- No collector script. The behavior lives in the Observe prompt and its contract tests.
- The signals the daily passes inspect do not change.
- The report's other sections do not change.
- Remediate's own fixes are unchanged. This affects only what gets reported.

---

## Key Decisions

- **Prompt duties, not a collector.** The #4129 miss was a stale read, and re-checking just before publishing fixes it. A collector script would duplicate reads the agent already makes. Per memory 12220, Fro Bot verifies its own surface.
- **Recurring items become issues Fro Bot owns.** An issue gives an item a durable home and a lifecycle that Fro Bot closes, so the daily report stops being the system of record.
- **The cited URL is the key.** URLs are stable, and they let the agent match an item across reports without a state file.

---

## Dependencies / Assumptions

- The Observe job holds a credential that can create, label and close issues in fro-bot/.github. It already creates and closes the daily report issues.
- The previous daily report is still readable after the agent closes it, since closed issues stay readable.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9][Technical] The label's name, and whether an existing repo label fits.
- [Affects R1][Technical] Which prompt contract tests pin the re-check and item-shape rules, and how far the next reports can serve as the live check.

---

## Next Steps

-> `/ce:plan` for structured implementation planning.
