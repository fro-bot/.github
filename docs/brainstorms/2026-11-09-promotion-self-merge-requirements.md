---
date: 2026-11-09
topic: promotion-self-merge
---

# Fro Bot Merges Its Own Data Promotions

## Summary

The `Merge Data Branch` run now finishes the promotion itself, and it runs daily instead of weekly. The run already does the merge-back, the promotion gates and the PR. When the PR's live diff touches only `knowledge/` and `metadata/`, the run also waits for the required checks on that exact head, approves as the `fro-bot` user and merges pinned to that head. Changes to `main` protection made outside the settings automation are reported within minutes.

---

## Problem Frame

`Merge Data Branch` (`.github/workflows/merge-data.yaml`, weekly on Sundays plus dispatch) does the following:

- merges `main` back into `data`;
- runs the promotion leak gates as steps;
- opens or updates one PR from `data` into `main`, authored by the Fro Bot App (`packages/registry/src/merge-data-pr.ts`).

It labels the PR `automerge` when every changed path is under `knowledge/` or `metadata/`, and `needs-review` otherwise. Nothing reads either label. The operator approved and merged the last ten promotions by hand, and they stayed open anywhere from minutes to six days.

`main` protection requires all of the following:

- one approval;
- code-owner review;
- approval of the most recent push;
- dismissal of stale approvals;
- branches up to date before merge (`strict: true`).

`main` takes several merges a day, so a promotion PR falls behind within hours. Only the next weekly run brings it up to date. `fro-bot` is a user account, so the repo cannot name bypass actors. The operator confirmed this from the live rule.

Five Renovate PRs merged with no review between 2026-11-07 and 2026-11-08: #4108, #4135, #4134, #4142 and #4137. Scorecard's `branch_protection_rule` runs show two edits to `main` protection by the user `fro-bot`, at 06:06:34Z and 13:13:25Z on 11-07. Each edit landed seconds before `fro-bot` merged #4132 or #4133. The daily settings runs at 10:59Z on 11-07 and 11:13Z on 11-08 rewrote protection.

The five merges fall inside the windows those edits open. That the edits removed the review requirement is inferred, not verified: #4125 waited for an approval inside the second window. Nothing reported either edit.

---

## Requirements

**Self-merge in the promotion run**

- R1. A promotion qualifies when the PR's live diff against `main`, read in the same run, changes only paths under `knowledge/` or `metadata/`. Both the old and the new path of a rename count. A diff the API truncates does not qualify. Labels never decide qualification. The run sets exactly one of `automerge` and `needs-review` and removes the other.
- R2. A qualifying promotion is merged only after the promotion gates pass in the same run, on the commit that becomes the PR head. If the PR head differs from the commit the gates checked, the run stops without approving.
- R3. After the gates pass, the run waits a bounded time for the required checks on that head. It reads the required checks from the branch's live protection. That list must contain every context declared for `main` in `.github/settings.yml`; if it is missing, empty or short, the run stops without approving. Each check must be success, skipped or neutral. If they do not settle in time, the run leaves the PR open and ends successfully without merging, saying so in its summary.
- R4. The run approves the PR as the `fro-bot` user, pinned to that head commit. The review body is one line naming the commit and the rule it met. It never claims anyone read the content.
- R5. The run then merges the PR, pinned to that head commit. If the head has moved, GitHub refuses the merge and the run stops without retrying.
- R6. Every decision is deterministic. No agent or LLM step is involved.
- R7. A promotion that does not qualify, or whose gates or checks fail, stays open with the failure visible and waits for the operator, as today.
- R8. `Merge Data Branch` runs daily instead of weekly. A behind or moved qualifying promotion is then caught up and merged by the next day's run.
- R8a. The daily run does not move the head of an open `needs-review` promotion. Its merge-back and update stay on today's weekly run, which is the Sunday schedule or a dispatch that asks for it, so an operator approval is not dismissed daily. Qualification is decided before the merge-back from what `data` changes relative to `main`, ignoring content `main` already has.

**Protection drift**

- R13. The operator can stop self-merge without editing workflows: a repository variable must be `on` for any approval or merge, a `hold-merge` label stops it for one promotion, and a promotion PR the operator closed is not recreated by any scheduled run.
- R9. When `main` protection changes and the actor is not the settings automation, or the resulting rule no longer matches the declared settings, Fro Bot opens an issue in fro-bot/.github within 15 minutes. The issue names the actor, the time, the change GitHub reports, and the settings workflow that will restore protection.
- R10. The settings automation is identified by actor type and numeric ID, not by login. The `fro-bot` user is always reported.
- R11. The drift report does not block or revert the change. Restoration stays with the existing daily settings run.
- R12. Further drift while an issue is open adds a comment to it. The issue closes on its own when a later write by the settings automation shows every declared setting present and matching. A field the event does not report never counts as matching or as drift.

---

## Acceptance Examples

- AE1. **Covers R1–R5.** A daily run promotes changes only to `knowledge/` and `metadata/`. The gates pass and the required checks settle. The run approves as `fro-bot` and merges, with no operator action.
- AE2. **Covers R1, R7.** A promotion includes a file outside `knowledge/` and `metadata/`. The run labels it `needs-review`, removes `automerge`, and does not approve.
- AE3. **Covers R1.** A promotion renames `scripts/x.ts` to `knowledge/x.md`. The old path disqualifies it.
- AE4. **Covers R2, R7.** The leak gate fails. The run does not open or update the PR for merge, and nothing is approved.
- AE5. **Covers R3, R8.** The required checks have not settled when the wait ends. The PR stays open, and the next day's run catches it up and merges it.
- AE6. **Covers R5.** `data` moves between the approval and the merge. The merge is refused, and the next run handles the new head.
- AE7. **Covers R9, R10, R12.** The user `fro-bot` turns off required reviews in the web UI. Within 15 minutes an issue names `fro-bot`, the time and the change. The next settings run re-enables required reviews, and the issue closes.
- AE8. **Covers R3.** The live required-check list comes back empty. The run does not approve, and it says why in its summary.
- AE10. **Covers R13.** The operator closes a promotion PR. No scheduled run recreates or approves it. With the variable unset, a qualifying run logs what it would approve and merges nothing.
- AE9. **Covers R8a.** A `needs-review` promotion has the operator's approval on a Tuesday. The Wednesday daily run does not push to `data`, and the approval stands.

---

## Success Criteria

- Over the next four weeks, every qualifying promotion merges with no operator action, unless a gate or check fails.
- Fro Bot approves no promotion that has a path outside `knowledge/` or `metadata/`.
- The next manual edit to `main` protection opens a drift issue within 15 minutes, and that issue closes after the next settings run.

---

## Scope Boundaries

- Renovate PRs, both a review brief and any automatic approval. They get a separate brainstorm.
- Drafted-solution PRs from `draft-solutions.yaml`. These stay manual.
- Changing `main` protection itself: no bypass, no lower approval count, no change to `strict`.
- Rulesets and repository-level settings drift. Only the `main` branch protection rule is watched.
- Restoring drifted protection immediately. The daily settings run stays the restorer.
- Content review of `knowledge/` and `metadata/`. Qualification is by path, and the existing promotion gates are the content check.

---

## Key Decisions

- **The promotion run merges; no separate approver.** The strong leak gates run as steps in that run, not as PR checks. No event fires reliably after all required checks finish on an Actions-authored head. GitHub also refuses to arm auto-merge on a PR that is already clean. Merging in the run binds the approval and the merge to the head the gates checked.
- **A `fro-bot` approval, not a bypass.** A personal repo cannot name bypass actors, and the operator keeps the review rule. `fro-bot` is a code owner. Only the App pushes `data`, so a `fro-bot` approval satisfies the last-push rule.
- **Daily cadence.** `strict: true` makes a promotion fall behind within hours. A daily run brings it up to date and merges it within a day, instead of up to a week.
- **Report drift, don't block it.** The known drift came from merges in the web session. A report keeps that path open and makes the gap visible.
- **Prior work.**
  - `docs/ideation/2026-11-07-open-ideation.md` records the self-merge idea as unexplored. That proposal assumed an App bypass.
  - fro-bot/agent#1520 recorded that App-authored PRs keep manual review because the review agent cannot approve its own App's PRs. This design adds no agent review.
  - The drafted-solution manual-review rule in `docs/plans/2026-10-09-002-feat-drafted-solution-docs-plan.md` (complete) stays in force.

---

## Dependencies / Assumptions

- `FRO_BOT_PAT` can submit an approving review as `fro-bot` on an App-authored PR, and that approval counts as a code-owner approval. Verify this with one live approval before relying on it.
- Each `branch_protection_rule` event carries the rule name, the sender and the reported changes.
- A write token can read the required checks from `GET /repos/{owner}/{repo}/branches/main`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] The wait bound and job timeout (a recent `Main` run took 38 minutes). How the run tells a check that has not started from one that never will. Whether its token needs `checks: read` and `statuses: read` to see the leak status.
- [Affects R8][Technical] Whether a run with nothing to promote should still update a behind PR.
- [Affects R9][Technical] How to confirm a write came from the settings automation: by actor ID alone, or matched against an active settings run.

---

## Next Steps

`ce:plan` from this document.
