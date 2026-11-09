---
date: 2026-11-09
topic: promotion-self-merge
---

# Fro Bot Merges Its Own Data Promotions

## Summary

Fro Bot merges its own `data` → `main` promotions without an operator step, under the existing `main` protection. When a knowledge/metadata-only promotion passes every required check on its current head, a deterministic job approves it as `fro-bot` and the App enables auto-merge. Any change to `main` protection made outside the settings automation is reported within minutes.

---

## Problem Frame

`Merge Data Branch` opens one promotion PR per run, authored by the Fro Bot App (`packages/registry/src/merge-data-pr.ts`). It labels the PR `automerge` when every changed path is under `knowledge/` or `metadata/`, and `needs-review` otherwise. Nothing reads either label. The operator approved and merged the last ten promotions by hand. They stayed open from minutes to six days, and on #4088 every merge-back push dismissed his approval.

`main` protection is declared in `common-settings.yaml`, merged with `.github/settings.yml`. It requires one approval, code-owner review, approval of the most recent push, and the dismissal of stale approvals. `fro-bot` is a user account, so the repo can't name bypass actors. The operator confirmed this from the live rule.

Five Renovate PRs merged with no review between 2026-11-07 and 2026-11-08: #4108, #4135, #4134, #4142 and #4137. Scorecard's `branch_protection_rule` runs show two edits to `main` protection by the user `fro-bot`, at 06:06:34Z and 13:13:25Z on 11-07. Each landed seconds before `fro-bot` merged #4132 or #4133. Each edit removed the review requirement until the next daily settings run restored it, at 10:59Z on 11-07 and 11:13Z on 11-08. All five merges fall inside those two windows. Nothing reported the drift.

---

## Requirements

**Promotion approval**

- R1. A promotion qualifies for self-merge only when every changed path is under `knowledge/` or `metadata/`. This is the same rule that picks the `automerge` label today. A promotion that does not qualify keeps `needs-review` and waits for the operator, as it does now.
- R2. For a qualifying promotion, Fro Bot approves the PR as the `fro-bot` user only after every required status check has passed on the PR's current head, including `Security: Private Leak Scan`. The approval names that head commit.
- R3. The approval comes from a deterministic job with no agent or LLM step. The job's only inputs are the PR's author, base, head commit, changed paths, labels and check results.
- R4. The job approves only PRs opened by the Fro Bot App from `data` into `main` that carry the `automerge` label. It ignores every other PR, whatever its paths.
- R5. After approving, Fro Bot enables squash auto-merge on the PR, so GitHub merges it once protection is satisfied.
- R6. When the head moves after approval, for example after a merge-back push, the stale approval is dismissed as it is today. Fro Bot approves again after the required checks pass on the new head, without waiting for the next scheduled promotion run.
- R7. If any required check fails on the current head, Fro Bot does not approve. The PR stays open with its failure visible. The promotion gates keep failing closed.
- R8. Each approval says why it was given, in one line naming the head commit and the rule it met. It never claims that anyone reviewed the content.

**Protection drift**

- R9. When `main` protection changes and the actor is anyone other than the settings automation, Fro Bot opens an issue in fro-bot/.github within minutes. The issue names the actor, the time and the link to the settings run that restores the protection.
- R10. Changes made by the settings automation itself do not raise an issue.
- R11. The drift report does not block or revert the change. Restoration stays with the existing daily settings run.
- R12. Repeated drift reuses the open drift issue and adds a comment, rather than opening a new issue each time.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5.** A Sunday promotion changes only `knowledge/` and `metadata/` files. All required checks pass. Fro Bot approves the PR as `fro-bot`, enables auto-merge, and the PR merges with no operator action.
- AE2. **Covers R1.** A promotion changes a file outside `knowledge/` and `metadata/`. It is labeled `needs-review` and Fro Bot never approves it.
- AE3. **Covers R6.** After approval, merge-back pushes a new commit to `data`. GitHub dismisses the approval. When the checks pass on the new head, Fro Bot approves again and the PR merges.
- AE4. **Covers R7.** The leak scan fails on a promotion's head. Fro Bot does not approve, and the PR stays open with the failed check.
- AE5. **Covers R4.** A PR from any other branch touches only `knowledge/`. Fro Bot does not approve it.
- AE6. **Covers R9, R10.** The user `fro-bot` turns off required reviews in the web UI. Within minutes an issue names `fro-bot`, the time and the restoring run. The next daily settings run restores protection without opening a second issue.

---

## Success Criteria

- The next four scheduled promotions merge with no operator action, unless one fails a check.
- No promotion with a path outside `knowledge/` or `metadata/` is approved by Fro Bot.
- The next manual edit to `main` protection produces a drift issue within 15 minutes.

---

## Scope Boundaries

- Renovate PRs, both a review brief and any automatic approval. These get a separate brainstorm.
- Drafted-solution PRs from `draft-solutions.yaml`, which stay manual.
- Changing `main` protection itself. No bypass, no lower approval count, no new required check.
- Restoring drifted protection immediately. The daily settings run stays the restorer.

---

## Key Decisions

- **A deterministic approval from the `fro-bot` user, not a bypass.** A personal repo can't name bypass actors, and the operator keeps the review rule. `fro-bot` is a code owner. The App pushes promotion heads, so a `fro-bot` approval meets the last-push rule with no protection change. fro-bot/agent#1520 recorded that App-authored PRs keep manual review, because the review agent can't approve its own App's PRs. This design adds no agent review. It is a gate-bound approval from a non-agent job.
- **The approval follows the head, not the run.** Promotions run weekly, so an approval tied to the promotion run would leave a merge-back-moved head waiting a week. The approval reacts to check completion on the PR.
- **Report drift, don't block it.** Drift so far has come from the operator merging through the web session. A report keeps that path open and makes the gap visible.
- Prior work: the self-merge idea is recorded as unexplored in `docs/ideation/2026-11-07-open-ideation.md`. That proposal assumed an App bypass, which a personal repo cannot have. The drafted-solution manual-review rule in `docs/plans/2026-10-09-002-feat-drafted-solution-docs-plan.md` (complete) stays in force.

---

## Dependencies / Assumptions

- `FRO_BOT_PAT` can submit a PR review as `fro-bot`. It already posts Fro Bot's PR reviews.
- The `branch_protection_rule` event reaches workflows in this repo with the actor. Scorecard already runs on it, and its run records show the actor.
- The promotion leak gates in `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` stay required checks on the PR.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R6][Technical] Which event triggers the approval job: check-suite or workflow-run completion on the PR head, or a short poll. How it confirms every required context, given that the list lives in settings.
- [Affects R9][Technical] Whether drift detection runs on `branch_protection_rule` alone. How it tells settings writes (`settings[bot]`, `fro-bot[bot]`) apart from other actors.

---

## Next Steps

`ce:plan` from this document.
