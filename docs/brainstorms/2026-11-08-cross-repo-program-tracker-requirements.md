---
date: 2026-11-08
topic: cross-repo-program-tracker
---

# Cross-Repo Program Tracker

## Summary

The rollout tracker becomes one workflow that can serve more than one cross-repo program, with fro-bot/.github#3512 as the first program. It keeps itself current. It wakes on outside changes and on the operator's edits, re-checks what it wrote, ticks a gate only on operator-authored or linked evidence, and lists the live acceptance steps it still needs from the operator for the deployed build. A repo skill captures how to run such a program. A credentialed request to Fro Bot can then start a new program after Fro Bot confirms the repo list with the operator. Starting a program means opening a tracker issue, a Project and the first wiring PR.

---

## Problem Frame

#3512 tracks the Gateway operator control-surface rollout across fro-bot/agent, fro-bot/dashboard, marcusrbrown/infra and this repo. It has 146 Project items and 12 open acceptance sections. `.github/workflows/gateway-rollout-tracker.yaml` owns it: a preflight builds a snapshot and a wake hash (`packages/status-truth/src/rollout-tracker-snapshot.ts`), and an agent job rewrites the body and the Project fields.

Two defects are being fixed separately in `fix/rollout-tracker-item-cap`. The snapshot read only the first 100 Project items. The body is 64,575 bytes against GitHub's 65,536-byte limit. A review of the source and recent runs found these gaps that remain:

- **Project-field changes never wake the tracker.** The wake hash nulls status, readiness, gate, labels and close date (`toGatingEvidence`, `rollout-tracker-snapshot.ts:265-287`). The marker stores the hash from before the run's own writes, so counting those fields as-is would make each run wake the next one. User-owned Projects get no `projects_v2_item` webhook, and a Project item has no last-editor field.
- **Operator edits are missed.** `rollout-tracker-mention.yaml` fires only on new comments that contain `@fro-bot`, and the snapshot only counts comment IDs above its baseline. Comment `6717940148` was edited at 06:30Z on 11-08, and the edit reached the body at 13:06Z, on the next scheduled run.
- **Nothing checks what the tracker wrote.** Nothing compares the body or the Project fields to the snapshot after the write.
- **Evidence is not bound to anyone.** #3512 is public and unlocked. The prompt treats "the operator's posted acceptance runs" as evidence, but nothing checks who wrote a comment. A comment that the workflow dispatches as `comment_id` joins the pending set without an author check (`rollout-tracker-snapshot.ts:427`).
- **The tracker waits on the operator.** Most open sections need live runs on the operator's devices, Discord or production. The tracker records results when they are reported, but it never says which run comes next for the deployed build.
- **It serves one program only.** #3512 and Project 1 are hardcoded in four places:
  - the mention workflow (`rollout-tracker-mention.yaml:24`)
  - the content job's exclusion (`fro-bot.yaml:520-525`)
  - the agent prompt (`gateway-rollout-tracker.yaml:102-167`)
  - the snapshot (`rollout-tracker-snapshot.ts:684-706`)

  The external evidence is also gateway-only: agent and dashboard releases, infra deploy runs and the dashboard health contract. The operator's next program is OpenCode v2 compatibility and broader harness support across his OpenCode plugins.

Scheduled runs are a known limit, not a requirement here. All 15 scheduled runs checked landed 5h01m to 9h14m after the nominal 06:00Z, and GitHub documents schedules as best-effort. This doc relies on event wakes instead.

This is the A2 self-maintenance and A3 cross-repo coordination thread in `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`, applied to a surface Fro Bot already owns. Project memory 12220 sets the direction: fix trigger routing, prompt duties and acceptance coverage so Fro Bot verifies, acts and reports on its own, without a state file, a writer layer or new comment syntax.

---

## Requirements

**One tracker, per-program config**

- R1. Each program is a config entry naming:
  - its tracker issue
  - its GitHub Project
  - its operator, the one login whose comments drive it
- R2. The mention workflow, the content job's exclusion, the agent prompt and the snapshot all read the program from config. Nothing hardcodes #3512 or Project 1.
- R3. #3512 is the first entry, and its tracker behaves as it does today except where this doc changes it.
- R4. Adding a program whose evidence is GitHub issue and PR state changes only its config entry and its tracker issue. Program-specific external evidence, such as #3512's releases, deploy runs and health contract, keeps its current form until program #2 shows what a general form needs.

**Wake**

- R5. A change to a Project item's status, readiness, gate or labels wakes the tracker, unless the tracker itself made the change in its previous run.
- R6. An edit by the program's operator to one of their own comments on the tracker issue wakes the tracker, even without `@fro-bot`. The tracker answers each edit once.

**Self-check**

- R7. Before a run finishes, the tracker re-reads its issue body and Project fields and corrects any drift from the snapshot. Drift here means dependency rows and Project field values. This is Fro Bot's own duty, not a separate verifier.

**Evidence**

- R8. A gate is ticked only on evidence:
  - a comment written by the program's operator, judged by the API author
  - a run, a PR or a release that the tracker links

  Comments from anyone else are data, never evidence.
- R9. Every gate ticked from now on links its evidence. Gates already accepted stay ticked.
- R10. Each gate still says whether it is operator-reported or agent-verified. A screenshot or recording in an operator comment is linked by comment ID. The tracker never transcribes text from an image.
- R11. A comment ID that triggers a run counts as pending only if the program's operator wrote it.

**Driving acceptance**

- R12. When a program's deployed build changes, the tracker publishes the list of live acceptance steps still open for that build. A build changes on a new release, a deploy or a contract version. The list comes from the Project's `Gate` field. Each step names its gate, what to run and what passes.
- R13. The list lives in one place on the tracker issue and is replaced, not appended. Open gates carry forward across builds until they close.
- R14. A step closes only through R8 and R9, never because it appeared on the list.

**Program skill**

- R15. A repo skill in `.agents/skills/` holds the guidance for running a cross-repo program in this repo:
  - opening the tracker issue and the Project with its fields
  - adding cross-repo dependencies
  - defining acceptance gates and the evidence each needs
  - handing live steps to the operator
  - keeping the program current
  - closing it out
- R16. The skill draws on #3512's history: what worked, what drifted and what the operator corrected. It links the tracker's code and docs rather than restating them.
- R17. A program starts from a credentialed request to Fro Bot. That is a gateway launch from Discord or the dashboard, or a `workflow_dispatch`, never an issue comment. The skill leads Fro Bot through these steps:
  1. find any existing program that covers the request
  2. propose the repo list and ask the operator to confirm it
  3. after confirmation, open the tracker issue, create the Project and its items, and open the PR that adds the config entry
- R18. A program covers public repos only. The tracker refuses to add an item from a private repo and says why.

---

## Acceptance Examples

- AE1. **Covers R5.** The operator moves a Project item from "In Progress" to "Done". The next preflight wakes the tracker and names that item as the reason.
- AE2. **Covers R5.** The tracker sets an item's readiness to "waiting" during a run. The next preflight does not wake on that change.
- AE3. **Covers R6.** The operator edits an earlier #3512 comment to add a passing G2c result, without `@fro-bot`. The tracker wakes and answers that edit once.
- AE4. **Covers R7.** The tracker's body write drops a dependency row. Before the run ends, the tracker finds the row missing from the body and restores it.
- AE5. **Covers R8.** A third party comments "G4c pass" on #3512. G4c stays open, and the tracker treats the comment as data.
- AE6. **Covers R8, R9.** The operator comments "G4c pass". The tracker ticks G4c as operator-reported and links that comment.
- AE7. **Covers R12, R13.** Gateway v0.136.5 is deployed while two gates from v0.136.4 are still open. The new list names those two gates and every other gate still open for v0.136.5.
- AE8. **Covers R17.** The operator asks Fro Bot through the gateway: "Let's ensure OpenCode v2 compatibility across my OpenCode plugins and broaden harness support". Fro Bot finds no existing program and proposes a list of plugin repos. Once the operator confirms the list, it opens the tracker issue, the Project with one item per repo, and the config PR.
- AE9. **Covers R18.** A dependency points at a private repo. The tracker leaves it out and notes the refusal in its run comment, without naming the repo.

---

## Success Criteria

- Two weeks after release, every gate the tracker has ticked links operator-authored evidence or a run, PR or release. Any gate without one is a defect.
- An operator edit or Project change reaches #3512 within one run of its wake. It no longer waits for the next scheduled run.
- #3512 always shows which acceptance steps come next for the deployed build.
- The OpenCode v2 plugin program goes from one operator request to an open tracker issue, a Project and a config PR. The operator only confirms the repo list.

---

## Scope Boundaries

- The tracker does not run acceptance steps. Most of them need the operator's devices, Discord or production faults.
- Code fixes for #3512's open sections stay in fro-bot/agent, fro-bot/dashboard and marcusrbrown/infra.
- The skill is a repo skill, not a harness plugin.
- The existing marker and Project fields carry all state, with no new state file, writer layer or comment syntax.
- The external-evidence schema is deferred until program #2.
- Programs that cover private repos are out of scope.
- Scheduled-run timing is out of scope (see Problem Frame).
- #4018: ruleset `25556841` ("data branch: no deletion", no bypass) already prevents `data` from being deleted, so this doc adds no merge-data assertion. #3512's #4018 dependency can close on that ruleset as evidence.
- The tracker filing missing dependency issues in the owning repos is a natural next push. It is a follow-up, not part of this doc.

---

## Key Decisions

- **Generalize the routing now, defer the evidence schema.** Program #2 is real, so routing by config pays now. Its evidence isn't known yet, so a general evidence shape would be a guess.
- **The tracker excludes its own writes using its own marker.** After writing, it rebuilds the snapshot and stores that hash. This needs no state file. The cost is that an operator change landing in the moments between write and rehash is absorbed. The next operator change or edit still wakes it.
- **Operator-authored comments are evidence.** The API author is the identity check. This settles AE5 and AE6 and closes the public-issue forgery path, without treating Fro Bot as an untrusted proposer.
- **Starting a program is credentialed and confirmed.** Comment runs carry no write credential. The confirmation step keeps a guessed repo list from creating junk issues and Projects.
- **Declined:** narrowing the content job to the operator only. That would be a lockdown, contrary to memory 12220.

---

## Dependencies / Assumptions

- *Spike before planning:* one CI agent run lists a skill from `.agents/skills/`. OpenCode documents that directory as a project source, but no run has shown it.
- *Spike before planning:* `FRO_BOT_PAT` creates and deletes a throwaway user Project. The token already edits Project 1 and is documented with `project` scope.
- Gateway launches can open PRs in this repo through the brokered push path. Planning confirms that this covers starting a program.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] Where the "answered edits" watermark lives in the existing marker, and how the tracker skips edits to its own marker comment.
- [Affects R12][Technical] How the `Gate` field values map to runnable steps and pass criteria.
- [Affects R15][Technical] The skill's name, structure, and which #3512 history it cites.

---

## Next Steps

-> Run the two spikes, then `/ce:plan`.
