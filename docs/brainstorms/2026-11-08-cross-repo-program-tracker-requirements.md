---
date: 2026-11-08
topic: cross-repo-program-tracker
---

# Cross-Repo Program Tracker

## Summary

Fro Bot learns to run a cross-repo program from start to finish, and fro-bot/.github#3512 is the first program. The rollout tracker becomes one workflow driven by a per-program config. It keeps itself current: it wakes on outside changes, runs on time, checks its own output, links evidence for every gate, and lists the live acceptance steps it still needs from the operator for the build that is deployed. A repo skill captures how to run such a program, so the operator can ask Fro Bot for a new one in one sentence and get a tracker issue, a Project and the first wiring PR.

---

## Problem Frame

#3512 tracks the Gateway operator control-surface rollout across fro-bot/agent, fro-bot/dashboard, marcusrbrown/infra and this repo. It has 146 Project items and 12 open acceptance sections. Its owner is `.github/workflows/gateway-rollout-tracker.yaml`. A preflight builds a snapshot and a hash (`packages/status-truth/src/rollout-tracker-snapshot.ts`), and an agent job then rewrites the body and the Project fields. A check against the source on 2026-11-08 found these gaps:

- **The snapshot reads only the first 100 Project items.** It calls `gh project item-list` with `--limit 100` (`rollout-tracker-snapshot.ts:706`), and the Project has 146 items. The other 46 never reach the hash, so changes to them never wake the tracker.
- **Project fields never wake it.** The wake hash nulls each item's status, readiness, gate, labels and close date (`toGatingEvidence`, `rollout-tracker-snapshot.ts:265-287`, unchanged since #3517). This probably keeps the tracker's own field writes from waking it, but changes made by the operator or another repo's agent are missed too.
- **Comment edits never wake it.** `rollout-tracker-mention.yaml` fires only on new comments.
- **The daily run is late.** The `0 6 * * *` cron has landed between 12:42 and 15:13Z on every scheduled run from 11-01 to 11-07.
- **Nothing checks its own output.** The marker stores the snapshot hash. Nothing compares the body or the Project fields to the snapshot after the write.
- **Gates are ticked on judgment.** The prompt says to "check off a gate when the evidence supports it", but gates don't link the evidence.
- **It waits for the operator.** Most of the 12 open sections need live runs on the operator's devices, Discord or production. The tracker records reports when they arrive but never says which run comes next for the deployed build.
- **#4018 is observed, not asserted.** `data` survived the 11-02 promotions, but `merge-data.yaml` has no step that asserts it.

The tracker is also wired to this one program. The issue number, Project 1 and the gateway-specific evidence are hardcoded in the workflow prompt (`gateway-rollout-tracker.yaml:102-167`) and in the snapshot code. The evidence is the agent and dashboard releases, the infra deploy runs and the dashboard health contract. Starting a second program would mean copying about 1,000 lines. The operator plans one next: OpenCode v2 compatibility and broader harness support across his OpenCode plugins.

This is the A2 self-maintenance and A3 cross-repo coordination thread in `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`, applied to the program-management surface Fro Bot already owns. Project memory 12220 sets the direction: fix trigger routing, prompt duties and acceptance coverage so Fro Bot verifies, acts and reports on its own, without adding a state file, a writer layer or new comment syntax.

---

## Requirements

**One tracker, per-program config**

- R1. One tracker workflow and one snapshot serve every program. Each program is a config entry naming its tracker issue, its GitHub Project, the operator who may drive it, and the evidence sources that count for it: releases, deploy runs, health endpoints or checks.
- R2. #3512 becomes the first config entry, and its tracker behaves as it does today except where this document changes it.
- R3. Adding a program changes only its config entry and its tracker issue. It needs no new workflow and no change to the snapshot code.

**Wake and cadence**

- R4. The snapshot reads every Project item, and fails rather than truncating silently.
- R5. A change to a Project item's status, readiness, gate or labels wakes the tracker, unless the tracker made that change itself.
- R6. An edit by the program's operator to their own comment on the tracker issue wakes the tracker, just as a new comment does.
- R7. The scheduled run starts within an hour of its nominal time on most days.

**Self-check and evidence**

- R8. After writing, the tracker re-reads its issue body and Project fields in the same run and corrects any drift from the snapshot before it finishes. This is Fro Bot's own duty, not a separate verifier.
- R9. Every gate the tracker ticks from now on links its evidence: a comment, a run, a PR or a release. A gate it can't link stays open and says what evidence is missing. Gates already accepted stay ticked.
- R10. Each gate entry still says whether it is operator-reported or agent-verified. Visual evidence such as a screenshot or a recording attached to an operator comment counts as operator-reported evidence and is linked.

**Driving acceptance**

- R11. When a program's deployed build changes (a new release, deploy or contract version), the tracker publishes the list of live acceptance steps still open for that build. Each step names its gate, what to run and what passes.
- R12. The list lives in one place on the tracker issue and is replaced, not appended, so the issue doesn't fill with stale lists.
- R13. The tracker never marks a step done from the list alone. Steps close only through the evidence rules in R9 and R10.

**Program skill**

- R14. A repo skill in `.agents/skills/` holds the guidance for running a cross-repo program in this repo:
  - opening the tracker issue and the Project with its fields;
  - adding dependencies across repos;
  - defining acceptance gates and the evidence each needs, including visual evidence;
  - handing live steps to the operator;
  - keeping the program current;
  - closing it out.
- R15. When the operator asks Fro Bot in this repo for a new cross-repo program in one sentence, the skill leads Fro Bot to:
  - open the tracker issue with an initial body;
  - create the Project, or reuse one if the operator names it;
  - open the first PR that adds the program's config entry.
- R16. The skill draws on #3512's history: what worked, what drifted and what the operator corrected. It also links the tracker's code and docs rather than restating them.

**Data branch survival (#4018)**

- R17. `merge-data` fails when `data` is missing after a promotion, or when its tip no longer contains the commits it had before the promotion.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** The operator moves a Project item past the 100th from "In Progress" to "Done". The next preflight wakes the tracker with that item as the reason.
- AE2. **Covers R5.** The tracker sets an item's readiness to "waiting" during a run. The next preflight does not wake on that change.
- AE3. **Covers R6.** The operator edits an earlier #3512 comment to add a passing G2c result. The tracker wakes and replies to that comment.
- AE4. **Covers R8.** The tracker's body write drops a dependency row. Before the run ends, the same run notices that the body has fewer rows than the snapshot and restores the row.
- AE5. **Covers R9.** An operator comment says "G4c pass" with no run, screenshot or link. The tracker leaves G4c open and asks for the run ID or a screenshot.
- AE6. **Covers R11, R12.** Gateway v0.136.5 is deployed. The tracker replaces the acceptance list with the steps still open on v0.136.5, each naming its gate and pass criteria.
- AE7. **Covers R14, R15.** The operator tells Fro Bot here: "Let's ensure OpenCode v2 compatibility across my OpenCode plugins and broaden harness support". Fro Bot opens a tracker issue, a Project with one item per plugin repo, and a PR adding the program's config entry.
- AE8. **Covers R17.** A promotion run leaves `data` missing. The run fails and names the missing branch.

---

## Success Criteria

- For two weeks after it ships, every #3512 body and Project change that #3512's history shows comes from a tracker run that linked its evidence.
- The operator no longer has to work out which acceptance run to do next: the list on #3512 names it.
- The OpenCode v2 plugin program starts from one operator sentence and reaches an open tracker, a Project and a first PR without the operator writing any of them.

---

## Scope Boundaries

- The tracker does not run acceptance steps itself. Most need the operator's devices, Discord or production faults.
- Code fixes for #3512's open sections stay in fro-bot/agent, fro-bot/dashboard and marcusrbrown/infra.
- No harness plugin. The guidance ships as a repo skill.
- No new state file, writer layer or comment syntax. The existing marker and Project fields carry the state.
- Programs outside fro-bot and marcusrbrown repos are out of scope.

---

## Key Decisions

- **Generalize now.** The OpenCode v2 plugin program is a concrete second user, and copying about 1,000 lines per program costs more than one config schema.
- **The self-check is the agent's own duty.** Per memory 12220, Fro Bot verifies its own surface. There is no trusted-writer layer.
- **The acceptance list is replaced, not appended,** to keep #3512 readable.
- **Evidence links apply from now on.** Past operator acceptances are not reopened.

---

## Dependencies / Assumptions

- *Unverified:* the Fro Bot agent's OpenCode loads repo skills from `.agents/skills/`. Planning must confirm this, or name where the skill must live.
- *Unverified:* the tracker's `FRO_BOT_PAT` can create a user Project and add items for a new program. Today it only edits Project 1.
- Scheduled-run lateness is GitHub's queueing. Moving off the top of the hour is the usual fix and needs measuring.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] How to tell the tracker's own field writes from other writers without a state file. For example, the marker could record the hash of the fields as written, or the Project item's last editor could be checked.
- [Affects R1, R3][Technical] Where the per-program config lives and what shape the evidence sources take. Gateway evidence is releases, deploy runs and a health contract. Plugin evidence is likely CI runs and releases across many repos.
- [Affects R6][Technical] Whether comment edits arrive through `issue_comment: edited` on the mention workflow, or through a preflight check of `updated_at`.
- [Affects R11][Needs research] Where the open live steps for a build come from: the gate list in the body, or a per-gate field.
- [Affects R14][Technical] The skill's name and structure, and which #3512 history it cites.

---

## Next Steps

-> `/ce:plan` for structured implementation planning.
