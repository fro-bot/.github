---
date: 2026-11-11
topic: renovate-automerge-approval
---

# Fro Bot Approves the Renovate PRs That Config Marks Automerge

## Summary

A non-agent approver gives Renovate PRs labelled `automerge` the one approval that `main` protection needs. It approves as the `fro-bot` user, pinned to the PR head, after the required checks pass on that head. GitHub's native auto-merge, which Renovate already arms on those PRs, then merges. Today the label covers nearly every non-major update. The approver starts in dry run behind its own switch.

---

## Problem Frame

Renovate opens its PRs as the Fro Bot App. `main` protection requires one approval, a code-owner review and approval of the most recent push. Nothing but the operator gives that approval.

- Of 61 Renovate PRs merged since 2026-09-23, 56 carry the operator's approval. The other five merged during the two windows on 11-07 and 11-08 when protection had been edited by hand.
- Fro Bot's agent never reviews them. The `fro-bot` job skips any PR whose author login ends in `[bot]`.
- The wait is the approval, not CI. Two Renovate PRs failed their first CI run in the last 30 days, and both went green without a commit from the operator.

Median time from open to merge runs from 1.5 hours (`fro-bot/agent` pins) to 22 hours (mise, Node and python), and the 90th percentile reaches 31 to 182 hours by class.

Renovate's config already says which updates may merge unattended. `default.json` extends the `bfra-me/renovate-config` preset, which labels every stable minor, patch and digest update `automerge` and arms native auto-merge on it. `default.json` adds the same for own-project updates. The result:

- 60 of the last 82 Renovate PRs carry `automerge`. They include `fro-bot/agent` pins, Renovate itself, GitHub Action pins, npm devDependencies and tool versions.
- Majors do not carry it.
- Third-party updates wait three days after release before Renovate opens them. Own-project updates do not.
- This repository disables most third-party patch updates, so the third-party PRs are mostly minors and digests.

The label has no effect today, because every PR still waits for the approval.

The daily promotion run now gives exactly this kind of approval to `data` promotions (`docs/brainstorms/2026-11-09-promotion-self-merge-requirements.md`). That work deferred Renovate to its own brainstorm.

---

## Requirements

**Which PRs qualify**

- R1. A PR qualifies only when all of these hold: it is open against `main`; the Fro Bot App authored it; its head is a Renovate branch in this repository; it carries the `automerge` label; it does not carry `hold-merge`; and every commit on it is the App's.
- R2. The `automerge` label is the only class rule. The approver holds no list of packages or update types. What merges unattended is whatever the effective Renovate config labels, and changing that is a change to the Renovate config.
- R3. A PR that changes the Renovate config itself (`default.json` or `.github/renovate.json5`) never qualifies, so the rule that decides qualification cannot change unseen.
- R4. The approver never acts on a PR without the label, a `data` promotion, a drafted-solutions PR, or a PR that a person opened or pushed to. A label that a person adds by hand counts: it is the operator's decision for that PR.

**The approval**

- R5. The approver approves only after every required check for `main` has passed on the PR's current head, using the live required list.
- R6. Right before approving, the approver reads the PR again. It approves only if the PR still qualifies and its head is the commit whose checks it read. The approval is given as the `fro-bot` user and is pinned to that commit.
- R7. When the head changes, the approver treats the PR as new: it waits for the checks on the new head and approves again.
- R8. The approver does not merge. GitHub's native auto-merge, armed by Renovate, merges once the approval and checks are in place.
- R9. Each approval says why it was given: the label, the head commit and that the required checks passed. Reports name only the PR, its labels and commits.

**Control and failure**

- R10. The approver runs the default branch's definition and code, never the PR's, because agent and action pin updates edit workflows.
- R11. A repository variable turns the approver on. Unset means dry run: it does everything except approve, and reports what it would have approved. A run's mode is fixed when it starts.
- R12. The `hold-merge` label, removing `automerge`, and turning the variable off each stop an approval that has not been given yet. They do not undo one. After an approval, GitHub can merge within seconds.
- R13. A qualifying PR whose checks fail, or that cannot get up to date with `main`, gets no approval and stays visible to the operator as it is today.
- R14. `main` protection does not change: no bypass, no lower approval count, no relaxed up-to-date rule.

**Rollout**

- R15. Before the variable is turned on, a dry run on a real qualifying PR is read back: the PR's identity, labels, head, the checks it read, and that no review was given.
- R16. The first live approval is read back: the review's author and commit, that protection counted it, that auto-merge merged the PR, and the result. If any part differs, the variable is turned off.

---

## Acceptance Examples

- AE1. **Covers R1, R5, R6, R8, R9.** Renovate opens a `fro-bot/agent` patch bump labelled `automerge`. The required checks pass. The approver approves at that head as `fro-bot`, the review states its reason, and GitHub merges the PR with no operator action.
- AE2. **Covers R2.** Renovate opens a minor update of a third-party devDependency three days after its release, labelled `automerge`. It is approved and merges the same way.
- AE3. **Covers R7.** `main` moves and Renovate rebases an approved PR. Protection dismisses the approval. The approver approves again once the checks pass on the new head.
- AE4. **Covers R4.** Renovate opens a major update with no `automerge` label. The approver does nothing. The operator adds the label by hand, and the approver then treats the PR like any labelled one.
- AE5. **Covers R1, R4.** The operator pushes a fix commit to a labelled Renovate branch. The approver does not approve. A person opens a PR from a branch named like a Renovate branch. The approver does not approve.
- AE6. **Covers R3.** Renovate opens a labelled PR that bumps the preset version in `default.json`. The approver does not approve.
- AE7. **Covers R6.** Renovate force-pushes between the approver's check read and its approval. The approver gives no approval for the new head until that head's checks pass.
- AE8. **Covers R11.** With the variable unset, a qualifying PR passes its checks. The approver reports that it would approve and gives no review. Turning the variable on while that run is waiting does not make it approve.
- AE9. **Covers R12, R13.** A labelled PR gets `hold-merge` before its checks finish, or one of its required checks fails. The approver gives no approval. `hold-merge` added after the approval does not stop the merge.
- AE10. **Covers R1, R4.** The daily promotion PR from `data`, which the App also authors and which also carries `automerge`, is never approved by this approver.
- AE11. **Covers R10.** A labelled agent pin bump edits the workflow that runs the approver. The approver that judges that PR is the one on `main`.

---

## Success Criteria

- Over the first four weeks with the variable on, every Renovate PR that qualified, kept qualifying and passed its checks on an up-to-date head merged with no operator action. PRs that were held, pushed to by a person, failed checks or stayed behind `main` are listed separately.
- Every approval the approver gave is on a PR that carried the label and met R1 when the approver last read it.
- For those PRs, the median time from the last required check passing to merge is under 30 minutes. This is a target to measure during rollout.

---

## Scope Boundaries

- **Deferred: an advisory brief.** A short, non-blocking summary from the agent on the Renovate PRs still left to the operator (upstream notes, advisories, holds, lockfile delta). The agent does not review its own App's PRs today (fro-bot/agent#1520), so this needs an agent change first.
- **Out: narrowing or widening the label.** The approver follows the label as the config sets it. Changing which updates are labelled is a separate Renovate config change.
- **Out: other repositories.** The shared Renovate preset serves other repos. The approver runs in `fro-bot/.github` only.
- **Out: content review.** The approver checks conditions. It does not read release notes or diffs.
- **Out: undoing an approval.** Stopping an approved PR is the operator's action on the PR.
- **Out: the three-day release age, override floors and frozen installs.** They stay as they are.

---

## Key Decisions

- **The label decides, with its real reach.** The operator chose the `automerge` label as the single rule, knowing that the inherited preset puts it on nearly every non-major update, third-party ones included.
- **Conditions only.** A release that passes CI merges, whether or not it is sound. For third-party updates the limits are the three-day age, the required checks and the mutation gate. For own-project updates the operator already merges every change upstream. Action pin updates can edit workflows that hold secrets, and they merge the same way.
- **Config changes are the exception.** A PR that edits the Renovate config is the one kind that can change what the label means, so it stays with the operator.
- **A deterministic approver, not the agent.** The promotion run proved on 2026-11-11 that GitHub counts the `fro-bot` user's approval as the required code-owner review on an App-authored PR (#4175). The agent path would wait on an upstream change and put a model's verdict in the merge path.
- **Native auto-merge does the merge.** Renovate arms it on labelled PRs, and it stays armed across Renovate's force-pushes (seen on #4170). The cost is that nothing can stop a merge after the approval.
- **Its own switch, a dry run and a read-back of the first live approval.** The promotion work showed that only a live run proves the approval path (`docs/solutions/best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md`).

Past work with the same surface:

- Recorded as deferred in `docs/plans/2026-11-09-001-feat-promotion-self-merge-plan.md`: Renovate approval. This document is that brainstorm.
- Recorded as rejected in `docs/ideation/2026-11-07-open-ideation.md`: a merge queue and relaxed strictness. Neither is used here.

---

## Dependencies / Assumptions

- `FRO_BOT_PAT` can approve an App-authored PR and the approval satisfies code-owner review and last-push approval. Proven for the promotion PR; R16 checks it for a Renovate PR.
- Renovate rebases a labelled PR that falls behind `main`, so an approved PR that loses its approval comes back with a new head.
- The read before the approval and the approval itself are two calls. A label or head change between them is possible and is accepted.
- How Renovate labels a PR that groups updates of different kinds has not been observed. Planning checks one before the variable is turned on.

---

## Outstanding Questions

### Deferred to Planning

- What starts the approver and how it notices finished checks, a new head, a new label and a missed event, within the 30-minute target.
- How to tell a Renovate branch and an App-only commit list reliably. Renovate's commits are authored by the App and committed by GitHub's web flow.
- Whether to reuse the promotion step's check-waiting code, and how, now that there would be two users. Some required checks are skipped on bot-authored PRs.
- What the approver does when a qualifying PR has no auto-merge armed.
- How a labelled PR that is stuck behind `main` or on failing checks is made easy to see.

---

## Next Steps

Plan the implementation from this document.
