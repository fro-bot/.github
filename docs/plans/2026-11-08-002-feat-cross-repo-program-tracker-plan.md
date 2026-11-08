---
title: "feat: run cross-repo programs from one config-driven tracker and a program skill"
type: feat
status: active
date: 2026-11-08
origin: docs/brainstorms/2026-11-08-cross-repo-program-tracker-requirements.md
---

# feat: run cross-repo programs from one config-driven tracker and a program skill

## Overview

The rollout tracker becomes one workflow that serves every cross-repo program. Each program has a config entry and a labeled tracker issue, and #3512 is the first. The tracker:

- wakes on Project field changes and on the operator's edits;
- re-checks what it wrote;
- ticks a gate only when the operator posted the evidence or a linked run, PR or release backs it;
- lists the live acceptance steps still open for the deployed build.

A trusted post job writes the marker from a rehash of live state. A repo skill describes how to run a program. Starting a program from a gateway launch depends on a fro-bot/agent change, so that unit is gated.

## Problem Frame

See origin: `docs/brainstorms/2026-11-08-cross-repo-program-tracker-requirements.md`. PR #4146 is a prerequisite: it reads every Project item, keeps #3512's body under the size limit, and drops the snapshot from the marker. This plan builds on it.

## Requirements Trace

| Requirement | Units |
| --- | --- |
| R1–R4: per-program config, routing, #3512 as the first entry, gateway evidence kept as is | 1, 2 |
| R5: Project field changes wake the tracker, except its own writes | 3 |
| R6: operator edits wake the tracker | 4 |
| R7: self-check | 5 |
| R8–R11: evidence rules and operator-authored triggers | 3, 5 |
| R12–R14: acceptance list | 5 |
| R15–R16: program skill | 6 |
| R17: credentialed program start | 7 (gated) |
| R18: public repos only | 5, 7 |

## Scope Boundaries

- Each program's external evidence keeps its current form. Only #3512 has any, and that is gateway evidence. A general evidence schema waits for program #2.
- No new state file or comment syntax. The marker gains one field, and a deterministic post job writes it.
- This plan changes no fro-bot/agent code. It files the gateway-dispatch request (Unit 7).

### Deferred to Separate Tasks

- Program start from a gateway launch: Unit 7 is blocked on the fro-bot/agent issue for credentialed workflow dispatch from a gateway launch.
- Filing missing dependency issues in owning repos, outside program start: a follow-up.
- Loading repo skills natively in CI: fro-bot/agent#2129. Until then, prompts read the skill by path.

## Context & Research

### Relevant Code and Patterns

- **Tracker workflows.** `.github/workflows/gateway-rollout-tracker.yaml` runs a preflight job and then the agent through `fro-bot.yaml` with `workflow_call`. `.github/workflows/rollout-tracker-mention.yaml` is a credential-free relay that dispatches it.
- **Content-job exclusion.** `.github/workflows/fro-bot.yaml` (around lines 520–525) excludes the operator's #3512 comments from the content job. The daily prompt mentions #3512 and Project 1 again around lines 426–432.
- **Snapshot.** `packages/status-truth/src/rollout-tracker-snapshot.ts` holds these pieces:
  - `OPERATOR_LOGIN`, `GATE_FIELD_NAME`, the `ROLLOUT_TRACKER_ISSUE` default, and Project number 1 with owner `fro-bot`.
  - `hashSnapshot` and `toGatingEvidence`. These null the status, readiness, gate, labels and close date.
  - `extractPreviousMarker`. Its linear scan is pinned by `detect-extract-linear.test.ts`.
  - `scanOperatorMentions` and `fetchTrackerComments`.
- **Snapshot without a program.** `.github/workflows/status-truth.yaml` (around lines 73–95) runs the snapshot with no program selected, so a default program must remain.
- **Agent job then trusted publisher.** This repo already follows the pattern in several places:
  - `capture-learnings.yaml`
  - `capture-patterns.yaml`
  - `draft-solutions.yaml`
  - `survey-repo.yaml` (`survey-persist`)
  - `fro-bot.yaml` (`fro-bot-observe-announce`, which recomputes values on the trusted side)
- **Root JSON config with a guard test.** `mutation-guards.json` and `packages/ci-checks/src/mutation-guards-config.test.ts`.
- **Label routing in the event payload.** `fro-bot.yaml` around line 643, and `cross-repo-dispatch.yaml` around line 34.
- **Public repo check.** `.github/actions/resolve-public-repo` (reuse it for R18).
- **Skill shape.** `.agents/skills/generating-project-docs/SKILL.md`, listed in `.agents/README.md`.
- **Workflow test helpers.** `@fro-bot/test-kit` provides `workflow-step` (`runStepWithStubs`) and `workflow-expression`. `scripts/rollout-tracker-mention-workflow.test.ts` pins the relay.

### Institutional Learnings

- `docs/solutions/workflow-issues/autonomous-rollout-tracker-workflow-2026-06-17.md`: this is the tracker's design. It has a single writer, takes state from the Project and never parses prose tables back as state.
- `docs/brainstorms/2026-10-22-rollout-tracker-autonomy-requirements.md` and its plan record the 10-22 autonomy change. Do not edit them.
- Project memory 12220 sets the direction: Fro Bot verifies its own surfaces, with no lockdown or writer layer. The post job does bookkeeping that the agent cannot get right deterministically. It does not judge the agent's content.

### Facts the research surfaced

- Project 1 is user-owned. User-owned Projects emit no `projects_v2_item` webhook, and a Project item has no last-editor field. Field changes are therefore found by polling.
- The `Gateway Unit Gate` field is free text on every item. The structured gate list is the set of checkboxes under "Acceptance criteria" in the issue body: 147 checkboxes, 66 of them open.
- A gateway-launched agent's environment has no GitHub token. Brokered push only reaches an existing same-repo PR head on `issue_comment`, and its path allowlist excludes `.github` and `scripts`.
- `fro-bot.yaml` declares no `workflow_call` outputs. The post job needs none: it recomputes everything.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "fro-bot/.github (workflows, packages/status-truth, packages/dispatch, packages/registry, metadata/, common-settings.yaml, .github/actions); fro-bot/agent@28c55ed gateway launch path (read-only)",
  "freshness": { "vcs_reference": "6ad9d7b" },
  "budget": { "max_search_passes": 14, "max_candidate_inspections": 22, "exhausted": false },
  "candidates": [
    { "path_or_symbol": "packages/status-truth/src/rollout-tracker-snapshot.ts#runRolloutTrackerSnapshot", "description": "Preflight snapshot, gating hash, marker and pending-mention scan; reads the tracker issue from env with a #3512 default and hardcodes Project 1", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/gateway-rollout-tracker.yaml", "description": "Preflight job, then the agent through fro-bot.yaml with a #3512 and Project 1 prompt", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/rollout-tracker-mention.yaml#dispatch-tracker", "description": "Credential-free issue_comment relay with a literal issue number and operator", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/fro-bot.yaml#fro-bot", "description": "Content job with an inline exclusion of the operator's #3512 comments", "disposition": "extend" },
    { "path_or_symbol": "metadata/repos.yaml", "description": "Per-repo entity config on the data branch", "disposition": "insufficient", "insufficiency_reason": "Wrong entity, and its path is automatically labeled for merge on promotion, so an operator identity there would bypass human review." },
    { "path_or_symbol": "packages/dispatch", "description": "Goal coordination issue with an HTML state marker", "disposition": "insufficient", "insufficiency_reason": "One issue per goal, with constants in code and no Project or operator config; only its marker discipline is reused." },
    { "path_or_symbol": "common-settings.yaml", "description": "Probot repository settings", "disposition": "insufficient", "insufficiency_reason": "No workflow reads it, and its schema has no notion of a program." },
    { "path_or_symbol": "mutation-guards.json", "description": "Root JSON config held in line by a guard test", "disposition": "reuse" },
    { "path_or_symbol": ".github/actions/resolve-public-repo", "description": "Succeeds only when GitHub reports a repository as definitively public", "disposition": "reuse" },
    { "path_or_symbol": "survey-repo.yaml#survey-persist", "description": "Agent job followed by a trusted publisher job that recomputes state", "disposition": "reuse" },
    { "path_or_symbol": "fro-bot/agent packages/gateway launchWork", "description": "Gateway launch of a run in a bound repo checkout", "disposition": "insufficient", "insufficiency_reason": "The launched agent has no GitHub token and cannot dispatch a credentialed workflow; Unit 7 waits on an agent change." }
  ]
}
```

## Key Technical Decisions

- **Route by label, describe the program in config.**
  - Tracker issues carry the `program-tracker` label.
  - The relay and the content-job exclusion read that label from the event payload, combined with the operator check from config. A label alone is not enough, since anyone with triage access can set one.
  - A root JSON file, `program-trackers.json`, maps each tracker issue to its Project owner and number, gate field name, operator login and evidence kind. Today only #3512 has an evidence kind, `gateway`.
  - A guard test keeps the file valid and checks that every entry's issue carries the label.
- **The relay reads config through the contents API.** It keeps no checkout. A step fetches `program-trackers.json` at the default branch, decides in shell and dispatches with the program key and comment ID. Permissions become `contents: read` and `actions: write`.
- **The content-job exclusion stays expression-only.** It skips `issue_comment` events on issues labeled `program-tracker` whose author is the configured operator. The operator's login is checked against a literal that a drift test ties to the config. That is the repo's existing drift-guard pattern, and it avoids putting a route job in front of every event.
- **A post job writes the marker.**
  - It runs after the agent job when the agent succeeds. It re-runs the snapshot, writes `{hash, last_mention_id, last_edit_at}` to the marker comment (editing the latest one, or creating it when none exists), and is the only writer of the marker.
  - The agent no longer copies a marker.
  - When the agent fails, the old marker stays, so the next poll retries.
  - Rehashing after the agent's writes means those writes don't wake the next run. An operator change that lands in the seconds between the agent's write and the rehash is absorbed. This is accepted.
- **The hash covers the fields people change.** It now includes status, readiness, gate, labels and close date. The first run after the change wakes once.
- **Poll every three hours.** The cron is `23 */3 * * *`. The preflight is cheap, and the agent starts only on a change or pending input.
- **Answer the latest version of each edit.** An operator-authored comment counts as pending when it has been edited and its `updated_at` is later than the marker's `last_edit_at`. The run answers the latest version, and the post job advances `last_edit_at` only to the versions that run actually answered. Delivery is at least once.
- **Authorize the trigger comment.** The preflight fetches the dispatched `comment_id`. It counts it as pending only when the program's operator wrote it on that program's tracker issue.
- **Build the acceptance list from the body's checkboxes.** The agent owns the "Acceptance criteria" checkboxes and lists the open ones for the deployed build. The deployed build is the latest successful deploy run among the program's evidence. The list replaces itself in one section.
- **Skill read by path.** CI prompts that need it say to read `.agents/skills/cross-repo-program/SKILL.md`, until fro-bot/agent#2129 ships.

## Open Questions

### Resolved During Planning

- Where config lives: a root JSON file, not `metadata/`, `common-settings.yaml` or `vars`.
- How the tracker skips its own writes: the post job rehashes after them.
- Which gate source to use: the body's checkboxes, because the Project field is free text.
- Where program start begins: on a gateway launch, gated on an agent change (Unit 7).

### Deferred to Implementation

- Whether reactions bump a comment's `updated_at`. Check on a live comment. If they do, the preflight also compares body text against the last answered version, which the post job records.
- The exact step shape of the relay's config read: `gh api` contents plus `jq`.
- Byte headroom once the acceptance list and evidence links are added, measured on #3512 after #4146.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Relay as rollout-tracker-mention (no credential)
  participant Pre as preflight (snapshot)
  participant Agent as tracker agent (fro-bot.yaml)
  participant Post as marker post job
  Op->>Relay: comment created/edited on a program-tracker issue
  Relay->>Relay: read program-trackers.json, check label + operator
  Relay->>Pre: workflow_dispatch(program, comment_id)
  Note over Pre: also every 3h by cron
  Pre->>Pre: snapshot all items, hash incl. fields, pending mentions + edits
  Pre-->>Agent: should_comment, pending ids, program identity
  Agent->>Agent: update body, Project, acceptance list; self-check; reply
  Agent-->>Post: success
  Post->>Post: re-run snapshot, write marker {hash, last_mention_id, last_edit_at}
```

## Implementation Units

- [ ] **Unit 1: Program config and label**

**Goal:** Add `program-trackers.json` with #3512 as its first entry, label #3512 `program-tracker`, and make the snapshot load its program from config.

**Requirements:** R1, R3, R4

**Dependencies:** #4146 merged

**Files:**

- Create: `program-trackers.json`
- Create: `packages/status-truth/src/program-trackers.ts`, which loads and validates the file and returns the entry for a key or an issue
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`. Replace `OPERATOR_LOGIN`, `GATE_FIELD_NAME`, the Project owner and number, and the issue default with the loaded entry. The program is selected by `ROLLOUT_TRACKER_PROGRAM`. `status-truth.yaml`, which selects none, defaults to the single `gateway` program.
- Modify: `packages/status-truth/package.json` (exports), `mutation-guards.json` (put `program-trackers.ts` in `mutate` and assign it to a shard), `stryker.config.json`
- Test: `packages/status-truth/src/program-trackers.test.ts`, and update `rollout-tracker-snapshot.test.ts`
- Docs: `packages/status-truth/README.md`, plus the key configuration files table in the root `README.md`

**Approach:**

- An entry holds:
  - `key`
  - `issue` (`owner/repo#n`)
  - `project` (`owner`, `number`, `gateField`)
  - `operator` (login)
  - `evidence` (`gateway` or `none`)
- When the evidence is `none`, the snapshot skips the external signals.
- Apply the label to #3512 once, through the API. That is an operator-approved write.

**Execution note:** characterize the snapshot's current output for #3512 first. With the config loaded, the stdout JSON and the hash must be byte-identical before Unit 3 changes the hash.

**Patterns to follow:** `mutation-guards.json` and its guard test.

**Test scenarios:**

- Happy path: loading by key and by issue returns the #3512 entry.
- Happy path: the snapshot run with the config gives the same stdout and hash as before.
- Error path: a missing file, malformed JSON, a duplicate key or issue, or an unknown program key each makes the CLI exit 1 with a fixed message.
- Edge case: with no program selected and exactly one `gateway` entry, the snapshot uses that entry (the `status-truth.yaml` case).
- Edge case: an entry with `evidence: none` produces an empty `external` and makes no external reads.

**Verification:** #3512's snapshot output is unchanged, the config guard test passes, and the new module scores 100% under Stryker.

- [ ] **Unit 2: Config-driven routing**

**Goal:** The relay, the content-job exclusion, the tracker prompt and the daily prompt get the program from config and the label, not from literals.

**Requirements:** R2, R11

**Dependencies:** Unit 1

**Files:**

- Modify:
  - `.github/workflows/rollout-tracker-mention.yaml`: label check, then a config read, then the operator check, then a dispatch with `program` and `comment_id`
  - `.github/workflows/gateway-rollout-tracker.yaml`: a `program` input, and a prompt built from preflight outputs (issue, Project URL, operator)
  - `.github/workflows/fro-bot.yaml`: the content-job exclusion moves to the label plus operator form, and the daily prompt mentions the tracker by label
- Test:
  - `scripts/rollout-tracker-mention-workflow.test.ts`, moving from the expression pin to `runStepWithStubs` with a stub `gh`
  - `scripts/fro-bot-workflow.test.ts`, for the exclusion pin
  - a drift test showing the exclusion's operator literal equals the config
  - the prompt contracts in `rollout-tracker-snapshot.test.ts`
- Docs: the root `README.md` automation rows, and `docs/status.md`

**Approach:**

- The relay passes the comment body only through `env`.
- The tracker workflow keeps its `concurrency` group. The group name gains the program key.

**Test scenarios:**

- Happy path: an operator comment with `@fro-bot` on a labeled tracker issue dispatches once, with the right program key and comment ID.
- Edge case: a comment on an unlabeled issue, or by a non-operator on a labeled one, does not dispatch.
- Edge case: a labeled issue that is missing from the config does not dispatch, and the step writes a fixed warning.
- Error path: if the config read fails, the step fails and nothing is dispatched.
- Integration: the content job's `if` skips the operator's comment on a labeled tracker issue and still runs for every other comment.
- Integration: the prompt names the issue and Project from outputs, and no `#3512` literal remains in the prompt.

**Verification:** `grep` finds `3512` only in the config and in tests, `actionlint` is clean, and the workflow tests pass.

- [ ] **Unit 3: Field-aware hash, post-job marker and authorized trigger**

**Goal:** Project field changes wake the tracker and its own writes do not. The marker is written by a deterministic post job, and trigger comments are authorized.

**Requirements:** R5, R11

**Dependencies:** Unit 2

**Files:**

- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`:
  - `toGatingEvidence` includes the fields;
  - `buildMarker` adds `last_edit_at`;
  - the trigger comment is fetched and its author checked;
  - a `--write-marker` mode in the CLI writes the marker comment, editing the latest one or creating it.
- Modify: `packages/status-truth/src/rollout-tracker-snapshot-cli.ts` and its shim, if the mode needs an argument. Keep the zero-option contract by using env.
- Modify: `.github/workflows/gateway-rollout-tracker.yaml`:
  - a new `publish-marker` job with `needs: [preflight, update-rollout-tracker]` and `if: needs.update-rollout-tracker.result == 'success'`, which uses `FRO_BOT_PAT`;
  - the prompt drops the marker-copy instruction;
  - the cron becomes `23 */3 * * *`.
- Test: `rollout-tracker-snapshot.test.ts`. The three tests that pin "field changes do not change the hash" are replaced. Also update the workflow tests.

**Approach:**

- The post job's rehash uses the same snapshot code as the preflight.
- The agent's reply comment no longer carries a marker. The post job edits the latest Fro Bot marker comment, or creates one.

**Test scenarios:**

- Happy path: a status change on any item changes the hash.
- Happy path: after the post job writes the marker, a preflight with no further change does not wake (AE2).
- Happy path: an operator status change made after the post job wakes the next preflight and names the item (AE1).
- Error path: when the agent job fails, the post job is skipped, the old marker stays, and the next preflight wakes.
- Error path: a dispatched `comment_id` written by a non-operator, or on another issue, is not pending.
- Edge case: a legacy marker with `snapshot` and without `last_edit_at` still parses, and `last_edit_at` reads as null.
- Integration: the workflow test pins the `publish-marker` job's needs, `if` and secret, and checks that the agent prompt has no marker text.

**Verification:** the wake tests pass, `actionlint` is clean, and the first live run after merge wakes once and then stays quiet.

- [ ] **Unit 4: Operator edit wake**

**Goal:** An edit the operator makes to their own comment wakes the tracker and gets answered.

**Requirements:** R6

**Dependencies:** Unit 3

**Files:**

- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts` (`fetchTrackerComments` returns `created_at` and `updated_at`, and the preflight lists pending edits)
- Modify: `.github/workflows/rollout-tracker-mention.yaml` (`types: [created, edited]`; an edit dispatches even without `@fro-bot`)
- Modify: `.github/workflows/gateway-rollout-tracker.yaml` (the prompt answers the pending edits, and the post job advances `last_edit_at`)
- Test: the snapshot tests and the relay workflow test

**Test scenarios:**

- Happy path: the operator edits an answered comment without `@fro-bot`. That comment's latest version is pending, and it is answered once (AE3).
- Edge case: two edits before a run produce one answer, to the latest version.
- Edge case: an edit by `fro-bot`, including to its own marker comment, is never pending.
- Error path: when the run fails after replying, the post job doesn't advance `last_edit_at`, so the next run may answer again. That is at-least-once delivery, and it is documented.
- Edge case: a reaction alone does not make a comment pending, if reactions turn out to bump `updated_at`.

**Verification:** the tests pass, and an edit to a test comment on #3512 produces exactly one reply. The operator runs this check.

- [ ] **Unit 5: Prompt duties: self-check, evidence, acceptance list, public repos**

**Goal:** The tracker prompt carries R7–R10, R12–R14 and R18 as duties.

**Requirements:** R7, R8, R9, R10, R12, R13, R14, R18

**Dependencies:** Unit 3

**Files:**

- Modify: `.github/workflows/gateway-rollout-tracker.yaml` (prompt)
- Test: the prompt contracts in `rollout-tracker-snapshot.test.ts`

**Approach:** the prompt tells the agent to:

1. Re-read the body and the Project fields before finishing, and fix any dependency row or field value that differs from the snapshot.
2. Tick a gate only on evidence the operator wrote, judged by the API author, or on a linked run, PR or release. Any other comment is data. Every new tick links its evidence. Link images by comment ID and never transcribe them.
3. Keep one "Next acceptance steps" section, listing the open Acceptance-criteria checkboxes for the latest successful deploy. Each line names its gate, what to run and what passes. Carry open gates forward, and replace the section rather than appending to it.
4. Refuse to add a Project item from a private repo, and say so in the run comment without naming the repo.

**Test scenarios:**

- Happy path: each duty is present in the prompt, pinned by wording.
- Integration (live, after merge): a third-party "G4c pass" comment leaves G4c open (AE5). An operator "G4c pass" ticks it with a link (AE6). The next deploy replaces the list (AE7).

**Verification:** the prompt contracts pass. The live checks are recorded on #3512 after the next deploy.

- [ ] **Unit 6: Program skill**

**Goal:** Write `.agents/skills/cross-repo-program/SKILL.md` and have the tracker prompt read it.

**Requirements:** R15, R16

**Dependencies:** Units 2–5, since the skill describes them

**Files:**

- Create: `.agents/skills/cross-repo-program/SKILL.md`
- Modify: `.agents/README.md` (the skills table), and `.github/workflows/gateway-rollout-tracker.yaml` (a by-path read)
- Test: a contract test that the prompt names the skill path and that the file exists with valid frontmatter

**Approach:**

- Follow the shape of `generating-project-docs`: frontmatter, overview, when to use it, the flow, quality checks and common mistakes.
- The flow covers:
  - starting a program: the config entry, the label, the Project and its fields, and one issue per confirmed public repo;
  - dependencies;
  - acceptance gates with evidence;
  - handing steps to the operator;
  - staying current;
  - closing out.
- Draw on #3512's history: the item-cap and body-size defects, operator corrections, the edit gap and the evidence rules.
- Link the code and docs rather than restating them.

**Test scenarios:**

- Happy path: the prompt contains the path, and the file parses with `name` and `description`.

**Verification:** `bun run lint` passes on the skill, and a local OpenCode session lists it.

- [ ] **Unit 7: Program start from a gateway launch (gated)**

**Goal:** One operator request through the gateway proposes a program, gets confirmation, and opens the tracker issue, the Project, one issue per repo and the config PR.

**Requirements:** R17, R18

**Dependencies:** a fro-bot/agent change that lets a gateway launch start an allowlisted credentialed workflow run in fro-bot/.github. The issue is to be filed. Also depends on Unit 6.

**Files:** to plan once the agent contract exists. Expect a `workflow_dispatch` entry on `fro-bot.yaml` or a dedicated workflow with `branch-pr`, plus the skill's start flow.

**Approach:**

- The gateway carries the request.
- The credentialed run proposes a list of repos, checked as public through `resolve-public-repo`, on the request surface and waits.
- After the operator confirms, a second credentialed run:
  1. searches for an existing program and stops if it finds one;
  2. creates the issue, the Project with its fields, and one issue per repo;
  3. opens the config PR.

**Test scenarios:** deferred until the agent contract exists.

**Verification:** AE8 on the OpenCode v2 plugin program.

## System-Wide Impact

- **Interaction graph:** the relay, the tracker workflow, `fro-bot.yaml`'s content job and daily prompt, and `status-truth.yaml`, which uses the snapshot's default program.
- **Error propagation:**
  - A config read failure fails the relay or the preflight; it is never treated as "no program".
  - An agent failure leaves the marker unchanged.
  - A post-job failure leaves the old marker, and the next poll wakes the tracker.
- **State lifecycle:** the marker gains `last_edit_at`, legacy markers still parse, and the first run after Unit 3 wakes once.
- **Unchanged invariants:**
  - the tracker is the single writer of the #3512 body and Project fields;
  - Project 1 is the source of truth for items;
  - the gateway evidence sources;
  - `status-truth.yaml`'s use of `.snapshot`.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The label is set on a non-tracker issue | Routing also needs a config entry and the operator check. The guard test checks that configured issues carry the label. |
| Polling every 3 h uses runner minutes | The preflight takes about a minute, and the agent runs only on a change. |
| Reactions bump `updated_at` | Checked in Unit 4. If they do, compare body text as well. |
| Prompt duties drift | Prompt contract tests, plus the live checks in Units 4 and 5. |
| Gateway dispatch never ships | Units 1–6 stand alone. Unit 7 waits. |

## Sources & References

- **Origin document:** `docs/brainstorms/2026-11-08-cross-repo-program-tracker-requirements.md`
- Related past work: `docs/plans/2026-10-22-001-feat-rollout-tracker-autonomy-plan.md`, status complete. This plan generalizes that tracker and adds the wakes it lacks.
- Related PRs and issues: #4146, fro-bot/agent#2129, #3512, #3517.
- Research: `.context/program-tracker-plan/lanes/` (local, untracked).
