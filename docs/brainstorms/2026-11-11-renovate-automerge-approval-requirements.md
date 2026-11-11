---
date: 2026-11-11
topic: renovate-automerge-approval
---

# Fro Bot Approves the Renovate PRs That Config Marks Automerge

## Summary

A non-agent job gives Renovate PRs labelled `automerge` the one approval that `main` protection needs. It approves as the `fro-bot` user, pinned to the PR head, after the required checks pass on that head. GitHub's native auto-merge, which Renovate already turns on for those PRs, then merges. The job starts in dry run behind its own switch.

---

## Problem Frame

Renovate opens its PRs as the Fro Bot App. `main` protection requires one approval, a code-owner review and approval of the most recent push. Nothing but the operator gives that approval.

- Of 61 Renovate PRs merged since 2026-09-23, 56 carry the operator's approval. The other five merged during the two windows on 11-07 and 11-08 when protection had been edited by hand.
- Fro Bot's agent never reviews them. The `fro-bot` job skips any PR whose author login ends in `[bot]`, and it posted no review on any of the 64 Renovate PRs in that period.
- The wait is the approval, not CI. Two Renovate PRs failed their first CI run in the last 30 days, and both went green without a commit from the operator.

Time from open to merge:

| Class                           | PRs | Median | p90   |
| ------------------------------- | --- | ------ | ----- |
| `fro-bot/agent` pin             | 19  | 1.5 h  | 31 h  |
| Renovate itself                 | 15  | 13 h   | 47 h  |
| Action or reusable-workflow pin | 16  | 11.5 h | 146 h |
| npm devDependency               | 8   | 10.5 h | 153 h |
| mise, Node, python              | 5   | 22 h   | 182 h |

Renovate's config already says which updates are safe to merge unattended. `default.json` sets `automerge`, `platformAutomerge` and the `automerge` label for minor and patch updates of the operator's own projects: `fro-bot/**`, `@fro-bot/**`, `@fro.bot/wiki-write-core`, `bfra-me/**` and `@bfra.me/**`. Those PRs wait like every other, because the approval is missing.

The daily promotion run now gives exactly this kind of approval to `data` promotions (`docs/brainstorms/2026-11-09-promotion-self-merge-requirements.md`). That work deferred Renovate to its own brainstorm.

---

## Requirements

**Which PRs qualify**

- R1. A PR qualifies only when all of these hold: it is open against `main`; the Fro Bot App authored it; its head is a Renovate branch in this repository; it carries the `automerge` label; it does not carry `hold-merge`; and every commit on it is the App's.
- R2. The `automerge` label is the only class rule. The job holds no list of packages or update types. Widening or narrowing what merges unattended is a change to the Renovate config, reviewed like any other PR.
- R3. The job never acts on a PR without the label, a major update, a `data` promotion, a drafted-solutions PR, or a PR that a person opened or pushed to.

**The approval**

- R4. The job approves only after every required check for `main` has passed on the PR's current head, using the live required list.
- R5. The approval is given as the `fro-bot` user and is pinned to that head commit.
- R6. When the head changes, the job treats the PR as new: it waits for the checks on the new head and approves again.
- R7. The job does not merge. GitHub's native auto-merge, armed by Renovate, merges once the approval and checks are in place.
- R8. Each approval says why it was given: the label, the head commit and that the required checks passed.

**Control and failure**

- R9. A repository variable turns the job on. Unset means dry run: the job does everything except approve, and reports what it would have approved. A run's mode is fixed when it starts.
- R10. The `hold-merge` label stops the job for one PR.
- R11. A qualifying PR whose checks fail, or that stops qualifying, gets no approval and is left for the operator exactly as today.
- R12. `main` protection does not change: no bypass, no lower approval count, no relaxed up-to-date rule.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R5, R7.** Renovate opens a `fro-bot/agent` patch bump labelled `automerge`. The required checks pass. The job approves at that head as `fro-bot`, and GitHub merges the PR with no operator action.
- AE2. **Covers R6.** `main` moves and Renovate rebases an approved PR. Protection dismisses the approval. The job approves again once the checks pass on the new head.
- AE3. **Covers R2, R3.** Renovate opens a major update of an own-project action, with no `automerge` label. The job does nothing.
- AE4. **Covers R1, R3.** The operator pushes a fix commit to a labelled Renovate branch. The job does not approve.
- AE5. **Covers R9.** With the variable unset, a qualifying PR passes its checks. The job reports that it would approve and gives no review. Turning the variable on while that run is waiting does not make it approve.
- AE6. **Covers R10, R11.** A labelled PR carries `hold-merge`, or one of its required checks fails. The job gives no approval.
- AE7. **Covers R3.** The daily promotion PR from `data`, which the App also authors and which also carries `automerge`, is never approved by this job.

---

## Success Criteria

- Over the first four weeks with the switch on, every Renovate PR that keeps the `automerge` label and passes its checks merges with no operator action.
- The job approves no PR that lacks the label, and no major update.
- For labelled PRs, the median time from the last required check passing to merge is under 30 minutes.

---

## Scope Boundaries

- **Deferred: an advisory brief.** A short, non-blocking summary from the agent on the Renovate PRs still left to the operator (upstream notes, advisories, holds, lockfile delta). The agent does not review its own App's PRs today (fro-bot/agent#1520), so this needs an agent change first.
- **Deferred: wider classes.** Renovate's own updates, third-party action pins and npm devDependencies stay with the operator. Each can join later through a Renovate config PR, once this has run clean.
- **Out: other repositories.** The shared Renovate preset serves other repos. This job runs in `fro-bot/.github` only.
- **Out: content review.** The job checks conditions. It does not read release notes or diffs.
- **Out: the three-day release age, override floors and frozen installs.** They stay as they are.

---

## Key Decisions

- **Config decides, not code.** The operator chose the `automerge` label as the single rule, so merge authority widens only through a reviewed config PR.
- **A deterministic approver, not the agent.** The promotion run proved on 2026-11-11 that GitHub counts the `fro-bot` user's approval as the required code-owner review on an App-authored PR (#4175). The agent path would wait on an upstream change and put a model's verdict in the merge path.
- **Conditions only.** A bad own-project release that passes CI will merge. The operator already merges every `fro-bot/agent` change upstream, and own-project updates already skip the release age, so the operator accepted this.
- **Agent pin bumps are included.** They are the largest labelled class and reach the control plane's workflows without a second look here.
- **Native auto-merge does the merge.** Renovate already arms it on these PRs. The five PRs that merged unapproved during the protection windows were merged by the App through it.
- **Its own switch and a dry run first.** The promotion work showed that only a live run proves the approval path, and that a dry run must not turn live midway.

Past work with the same surface:

- Recorded as deferred in `docs/plans/2026-11-09-001-feat-promotion-self-merge-plan.md`: Renovate approval. This document is that brainstorm.
- Recorded as rejected in `docs/ideation/2026-11-07-open-ideation.md`: a merge queue and relaxed strictness. Neither is used here.

---

## Dependencies / Assumptions

- `FRO_BOT_PAT` can approve an App-authored PR and the approval satisfies code-owner review and last-push approval. Proven for the promotion PR; assumed to hold for Renovate PRs, which have the same author.
- Renovate arms native auto-merge on PRs it labels `automerge`. Supported by the five App merges during the protection windows; not yet checked on an open PR.
- The `automerge` label on a Renovate PR comes from the Renovate config. A person with write access can also add or remove it, and the job treats that as the operator's decision for that PR.

---

## Outstanding Questions

### Deferred to Planning

- What starts the job, and from which workflow definition. A job that holds `FRO_BOT_PAT` should run the default branch's definition, not the PR head's.
- How to tell a Renovate branch and an App-only commit list reliably.
- Whether to reuse the promotion step's check-waiting code, and how, now that there would be two users.
- What the job does when a qualifying PR has no auto-merge armed.
- How approvals and stops are reported so a stuck labelled PR is easy to see.

---

## Next Steps

Plan the implementation from this document.
