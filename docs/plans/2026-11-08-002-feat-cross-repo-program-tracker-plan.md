---
title: "feat: run cross-repo programs from one config-driven tracker and a program skill"
type: feat
status: active
date: 2026-11-08
origin: docs/brainstorms/2026-11-08-cross-repo-program-tracker-requirements.md
---

# feat: run cross-repo programs from one config-driven tracker and a program skill

## Overview

The rollout tracker becomes one workflow that serves every cross-repo program. Each program has an entry in `program-trackers.json` and a labeled tracker issue, and #3512 is the first program.

The tracker does five things:

- It answers each new operator `@fro-bot` comment and each operator edit once.
- It picks up Project field changes on its next poll.
- It checks what it wrote.
- It ticks a gate only on one of the operator's own comments, or on a linked run, PR or release.
- It keeps one comment that lists the acceptance steps still open for the deployed build.

A deterministic post job writes the marker, which holds the wake hash and a map of the comment versions already answered. A repo skill describes how to run a program. A program starts from any `fro-bot.yaml` dispatch that asks for one. That run opens a config PR, and merging the PR is the operator's confirmation.

## Problem Frame

See origin: `docs/brainstorms/2026-11-08-cross-repo-program-tracker-requirements.md`. #4146 (merged as `7c6bce2`) made the tracker read every Project item, list only open matrix rows, check the body size before writing, and drop the snapshot from the marker. Its first run brought #3512 to 59,801 bytes and the marker comment to 2,116 characters.

## Requirements Trace

| Requirement | Units |
| --- | --- |
| R1–R4: per-program config, routing, #3512 as first entry, gateway evidence kept | 1, 2 |
| R5: Project field changes wake the tracker; its own writes don't | 3 |
| R6: operator edits are answered | 1, 3, 4 |
| R7: self-check | 4 |
| R8–R10: evidence rules and the reported/verified label | 4 |
| R11: authorized trigger comments | 2 |
| R12–R14: acceptance list | 4 |
| R15–R16: program skill | 5 |
| R17: program start | 6 |
| R18: public repos only | 3, 6 |

| Acceptance example | Covered by |
| --- | --- |
| AE1, AE2 | Unit 3 |
| AE3 | Units 1 and 3 (answered map), Unit 4 (reply) |
| AE4 | Unit 4 (self-check) |
| AE5, AE6 | Unit 4 (evidence) |
| AE7 | Unit 4 (acceptance comment) |
| AE8 | Unit 6 |
| AE9 | Unit 3 (preflight visibility) |

## Scope Boundaries

- External evidence keeps its current shape. Only #3512 has any, and it is gateway evidence. A general evidence schema waits for program #2.
- No new state file. The marker gains one field, `answered`, and the agent never writes it.
- This plan changes no fro-bot/agent code.

### Deferred to Separate Tasks

- Denylist gate on `/fro-bot dispatch` and a dashboard dispatch route: fro-bot/agent#2130.
- Native repo-skill loading in CI: fro-bot/agent#2129. Until then, prompts read the skill by path.
- Filing missing dependency issues in owning repos outside program start: follow-up.
- Deleting the old 48,792-character marker comment `6721866155` on #3512. `findLatestMarkerComment` already ignores it, so deleting it is cosmetic.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/gateway-rollout-tracker.yaml`: the preflight job, then the agent through `fro-bot.yaml` with `workflow_call`. Its concurrency group is `gateway-rollout-tracker`, and dispatch takes one input, `comment_id`.
- `.github/workflows/rollout-tracker-mention.yaml`: the credential-free relay, triggered on `created` only.
- `.github/workflows/fro-bot.yaml`:
  - the content job's tracker exclusion, about lines 520–525;
  - the `issues` branch, about 503–507, which has no tracker exclusion;
  - the daily prompt's #3512 mention, about 426–432;
  - category 8, the report-only drift check;
  - `fro-bot-remediate`, which checks out without `persist-credentials: false`. Do not copy that.
- `packages/status-truth/src/rollout-tracker-snapshot.ts`:
  - `OPERATOR_LOGIN`, `GATE_FIELD_NAME` and the Project number and owner are literals;
  - `toGatingEvidence` nulls the item fields;
  - `extractPreviousMarker` is a linear scan pinned by `detect-extract-linear.test.ts`;
  - `scanOperatorMentions` takes a dispatched trigger ID without checking author or issue (about 426–427);
  - `fetchTrackerComments` returns id, login and body.
- `rollout-tracker-snapshot-cli.ts` is `readOnly: true` with zero argv, and tests pin both.
- `status-truth.yaml` (about 73–95) reads `.snapshot` from the preflight's stdout without choosing a program.
- Patterns to reuse:
  - Agent job, then a trusted publisher job that recomputes: `survey-repo.yaml` (`survey-persist`).
  - Root JSON config held in line by a guard test: `mutation-guards.json`.
  - Label routing from the event payload: `fro-bot.yaml` around line 643.
  - Skill shape: `.agents/skills/generating-project-docs/SKILL.md`.
  - Workflow step tests: `@fro-bot/test-kit` `runStepWithStubs`.

### Institutional Learnings

- `docs/solutions/workflow-issues/autonomous-rollout-tracker-workflow-2026-06-17.md`: a single writer, state taken from the Project, and never parsing prose back as state.
- `docs/plans/2026-10-22-001-feat-rollout-tracker-autonomy-plan.md` is complete. This plan generalizes it.
- Project memory 12220: Fro Bot verifies its own surfaces. The post job keeps deterministic bookkeeping and never judges the agent's content.

### Facts the research established

- User-owned Projects emit no `projects_v2_item` webhook, and an item has no last-editor field, so field changes have to be polled.
- Scheduled runs have landed 5–9 hours late, so polling is best effort.
- The `Gateway Unit Gate` field is free text. The structured gate list is the body's "Acceptance criteria" checkboxes (147 total, 66 open), and that section is about 48 KB.
- Comment edits bump `updated_at` and reactions do not (comment `4758484951`).
- GitHub queues one pending run per concurrency group, and a newer pending run cancels an older one. That is harmless here, because pending work comes from the marker, not from the dispatched ID.
- A `workflow_dispatch` sent with `GITHUB_TOKEN` starts a run, which is the documented exception to the no-recursion rule.
- `/fro-bot dispatch` dispatches with the gateway App token, so the run's `triggering_actor` is the App, not the operator.
- Fro Bot's link-in-reply convention is not reliable state: 5 of 135 Fro Bot comments use it, and most links are citations.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "fro-bot/.github (workflows, packages/status-truth, packages/dispatch, packages/registry, metadata/, common-settings.yaml, .github/actions); fro-bot/agent@28c55ed gateway launch and dispatch paths (read-only)",
  "freshness": { "vcs_reference": "7c6bce2" },
  "budget": { "max_search_passes": 18, "max_candidate_inspections": 28, "exhausted": false },
  "candidates": [
    { "path_or_symbol": "packages/status-truth/src/rollout-tracker-snapshot.ts#runRolloutTrackerSnapshot", "description": "Preflight snapshot, gating hash, marker and pending-mention scan, hardcoded to #3512 and Project 1", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/gateway-rollout-tracker.yaml", "description": "Preflight job, then the agent through fro-bot.yaml", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/rollout-tracker-mention.yaml#dispatch-tracker", "description": "Credential-free issue_comment relay with literal issue and operator", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/fro-bot.yaml#fro-bot", "description": "Content job with an inline tracker exclusion", "disposition": "extend" },
    { "path_or_symbol": "metadata/repos.yaml", "description": "Per-repo entity config on the data branch", "disposition": "insufficient", "insufficiency_reason": "Wrong entity, and its path is labeled for auto-merge on promotion, so an operator identity there would bypass human review." },
    { "path_or_symbol": "packages/dispatch", "description": "Goal coordination issue with an HTML state marker", "disposition": "insufficient", "insufficiency_reason": "One issue per goal with constants in code and no Project or operator config; only its marker discipline is reused." },
    { "path_or_symbol": "mutation-guards.json", "description": "Root JSON config held in line by a guard test", "disposition": "reuse" },
    { "path_or_symbol": "survey-repo.yaml#survey-persist", "description": "Agent job followed by a trusted publisher job that recomputes state", "disposition": "reuse" },
    { "path_or_symbol": "Fro Bot reply links (\"Replying only to\")", "description": "Agent-written links from a reply to the comment it answers", "disposition": "insufficient", "insufficiency_reason": "Used in 5 of 135 Fro Bot comments, and most links are citations; free text cannot be the answered record." },
    { "path_or_symbol": "fro-bot/agent discord/commands/dispatch.ts", "description": "/fro-bot dispatch: dispatches the bound repo's fro-bot.yaml with a prompt using the App token", "disposition": "reuse" }
  ]
}
```

## Key Technical Decisions

- **One routing predicate: the label plus a configured operator.**
  - Tracker issues carry the `program-tracker` label. `program-trackers.json` maps each tracker issue to its program and to the operator's numeric user ID and login.
  - The relay checks three things: the label, a config entry for the issue (read through the contents API), and the author's ID.
  - The content job's exclusion checks the label, the issue number and the operator ID, using literals that a drift test ties to the config. So a stray label on an unconfigured issue never silences the operator.
  - A labeled issue that has no config entry fails the relay run visibly.
  - The content job also skips operator `issues` events on configured tracker issues.
- **The marker records answered versions.**
  - The marker becomes `{hash, answered}`, where `answered` maps operator comment IDs to the `updated_at` that was read when the comment was answered.
  - The preflight lists operator comments on the issue. A comment is **pending** in two cases: its ID is absent from the map and it mentions `@fro-bot`, or its ID is present and its `updated_at` differs from the map.
  - The preflight passes `{id: updated_at}` for every operator comment it read to the post job through job outputs.
  - The post job merges those values into the map. A comment edited during the run therefore has a newer `updated_at` and comes up as pending on the next run.
  - Seeding: a legacy marker without `answered` is seeded with every operator comment's current `updated_at`, except comments that are still pending under the legacy `last_mention_id` rule. That keeps today's behaviour.
  - The map is pruned to comments that still exist. #3512 has about 80 operator comments, which is roughly 3 KB.
  - The pending rule and the merge are pure functions in a mutated module.
- **The post job writes the marker.**
  - A new `rollout-tracker-marker-cli` (`readOnly: false`, zero argv, its own shim) re-runs the snapshot in-process, merges `answered` and writes the marker. It edits the latest `fro-bot` marker comment, or creates a bare one if none exists.
  - It runs only when the agent job succeeds. It uses `FRO_BOT_PAT` with `persist-credentials: false` and reads only the preflight's outputs.
  - The agent writes no marker.
- **A skipped body write retries once.**
  - When the agent skips a body write because the body would exceed 65,000 bytes, its tracker comment starts with the exact line `Body write skipped: over 65,000 bytes`.
  - If a `fro-bot` comment created after the preflight started begins with that line, the post job keeps the old hash and sets `held: true`. It still merges `answered`.
  - When a held marker is followed by another skip, the hash advances, so the tracker retries once. That skip notice asks the operator to archive sections.
  - If the agent leaves the line out, the daily category 8 drift check is the backstop.
- **The hash covers the fields people change**: status, readiness, gate, labels and close date. The first run after this lands wakes once.
- **Fan-out uses one dispatch per program.**
  - On the cron schedule (`23 */3 * * *`, best effort), a `programs` job reads the config and dispatches `gateway-rollout-tracker.yaml -f program=<key>` once per key. It uses `GITHUB_TOKEN` with `actions: write`.
  - Every other job requires a program input.
  - The concurrency group is `program-tracker-${{ inputs.program || 'fanout' }}`.
  - `program` is validated against the config, and an unknown key fails.
- **Private items never reach the snapshot.**
  - The preflight reads each distinct repo's visibility and leaves out any item whose repo is not `public`, with no count and no name.
  - A failed visibility read fails the preflight, so an outage can't produce an empty snapshot.
- **The acceptance list lives in its own comment.** It is the latest `fro-bot` comment whose first line is exactly `## Open acceptance steps`. The agent replaces that comment, or creates one if none exists. The list holds the open "Acceptance criteria" checkboxes for the latest successful deploy run.
- **Evidence comes from a list.**
  - The preflight passes the operator's comment IDs on the issue to the agent.
  - An operator-reported tick cites one of those IDs. An agent-verified tick links a run, PR or release.
  - Each tick says which kind it is.
- **The skill is read by path** at `.agents/skills/cross-repo-program/SKILL.md`, until fro-bot/agent#2129 ships.
- **Program start: merge is the confirmation.**
  - A program starts from any `fro-bot.yaml` dispatch whose prompt asks for one: `gh workflow run`, the Actions UI, or Discord `/fro-bot dispatch`. The run uses `branch-pr`.
  - It reads the skill and searches for an existing program. It resolves each proposed repo as public. Then it creates the tracker issue (unlabeled) and an empty Project with the standard fields, and opens one PR. The PR adds the config entry and updates the content-job literals.
  - Nothing reads the new entry until the operator merges, so no actor gate is needed. The operator's review and merge, with CODEOWNERS on the config, is the gate.
  - The tracker's first run after merge sees an entry with confirmed `repos` and no items. It labels the issue, files one issue per repo and adds each one to the Project.
  - If the PR is closed unmerged, the PR body names the two leftover objects to close. This is manual.

## Open Questions

### Resolved During Planning

- Where config lives: a root JSON file, with CODEOWNERS set to the operator.
- How "answered" is recorded: an `answered` map in the marker, written only by the post job.
- How the tracker skips its own writes: the post job rehashes after the agent.
- Where the acceptance list lives: its own comment, found by its exact first line.
- How a program starts: any `fro-bot.yaml` dispatch, with merge as confirmation.
- Whether reactions count as edits: they don't bump `updated_at`.

### Deferred to Implementation

- Whether the `issue_comment` payload carries `issue.labels`. The research expects it to, but it is unverified; check it on the first relay run.
- Whether `FRO_BOT_PAT` can create a user Project. Unit 6's first live start exercises this, and a failure stops that run and gets reported.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Relay as relay (no credential)
  participant Fan as programs job (cron)
  participant Pre as preflight[key]
  participant Agent as tracker agent
  participant Post as marker job
  Op->>Relay: comment created/edited on configured tracker issue
  Relay->>Pre: dispatch(program, comment_id)
  Fan->>Pre: dispatch(program) per config key
  Pre->>Pre: public-only snapshot, hash, operator comments,<br/>pending = new @fro-bot or updated_at != answered
  Pre-->>Agent: wake + pending IDs + operator comment IDs + acceptance comment ID
  Agent->>Agent: body, Project, acceptance comment, replies, self-check
  Agent-->>Post: success
  Post->>Post: rehash; merge answered from preflight outputs;<br/>hold hash once on a skip notice; write marker
```

## Implementation Units

- [ ] **Unit 1: Program config, label and pure predicates**

**Goal:** Add `program-trackers.json` with #3512 as its first entry, and label #3512. Add a mutated module of pure routing, pending and merge predicates. Load the snapshot's program from config.

**Requirements:** R1, R3, R4, R6

**Dependencies:** none (#4146 is merged)

**Files:**
- Create: `program-trackers.json`
- Create: `packages/status-truth/src/program-trackers.ts`. It holds the config loader and validator and these pure functions:
  - `isOperatorComment`
  - `pendingComments(comments, answered, legacyFloor)`
  - `mergeAnswered(answered, read, existingIds)`
  - `seedAnswered(comments, legacyFloor)`
- Create: `packages/status-truth/src/program-trackers.test.ts`
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`. The config entry replaces the literals, and the program comes from `ROLLOUT_TRACKER_PROGRAM`, defaulting to `gateway`.
- Modify: `.github/CODEOWNERS` (`program-trackers.json @marcusrbrown`), `packages/status-truth/package.json` (exports), `stryker.config.json` (add `program-trackers.ts` to `mutate`), `mutation-guards.json` (shard assignment) and `rollout-tracker-snapshot.test.ts`.
- Docs: `packages/status-truth/README.md`, and the key configuration files in the root `README.md`.

**Approach:**
- An entry has these fields:
  - `key`
  - `issue` (`owner/repo#n`)
  - `project` (`owner`, `number`, `gateField`)
  - `operator` (`id`, `login`)
  - `evidence` (`gateway` or `none`)
  - an optional `repos` list (`nameWithOwner`, `nodeId`), used to bootstrap a new program
- The label is applied to #3512 once through the API, as an operator-approved write.

**Execution note:** characterize first. With the config loaded, #3512's stdout snapshot and hash must be byte-identical to before.

**Test scenarios:**
- Happy path: with the config loaded, the snapshot gives the same stdout and hash as before.
- Happy path: a new operator `@fro-bot` comment absent from the map is pending. An operator comment without `@fro-bot` that is absent from the map is not pending.
- Happy path: an answered comment whose `updated_at` now differs is pending (AE3). The same `updated_at` is not pending.
- Edge case: `mergeAnswered` writes the preflight's read `updated_at`, not the current one, so an edit made mid-run stays pending.
- Edge case: `seedAnswered` on a legacy marker records every comment, except those that are still pending under the `last_mention_id` rule.
- Edge case: pruning drops IDs that no longer exist.
- Edge case: Fro Bot's comments are never pending.
- Error path: a missing file, malformed JSON, a duplicate key or issue, a non-numeric operator ID or an unknown program key exits 1 with a fixed message.

**Verification:** #3512's output is unchanged, and `program-trackers.ts` scores 100% under Stryker.

- [ ] **Unit 2: Config-driven routing, edits relay, authorized triggers and fan-out**

**Goal:** The relay, the content job, the tracker workflow and the daily prompt all take the program from config. Edits relay to the tracker. A trigger comment counts only when it is authorized. The cron fans out one dispatch per program.

**Requirements:** R2, R6, R11

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/rollout-tracker-mention.yaml`.
  - It triggers on `types: [created, edited]`.
  - One step checks the label, reads the config through the contents API, checks the operator ID and dispatches with `program` and `comment_id`.
  - Permissions are `contents: read` and `actions: write`.
  - A labeled issue with no config entry fails.
- Modify: `.github/workflows/gateway-rollout-tracker.yaml`.
  - It gains a `program` input, validated against the config.
  - A `programs` job runs on the schedule and dispatches once per key; the other jobs require a program.
  - The concurrency group is `program-tracker-${{ inputs.program || 'fanout' }}`.
  - The prompt is templated from the preflight outputs.
- Modify: `.github/workflows/fro-bot.yaml`.
  - The content job excludes operator `issue_comment` and `issues` events on configured tracker issues (label, number and operator ID literals).
  - The daily prompt refers to configured trackers.
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`. A dispatched `comment_id` joins the pending set only when the operator wrote it on this program's issue (`issue_url` plus author ID).
- Test: `scripts/rollout-tracker-mention-workflow.test.ts` (stub `gh`, `runStepWithStubs`), `scripts/fro-bot-workflow.test.ts`, a drift test that ties the content-job literals to the config, the snapshot trigger tests, and the prompt contracts.
- Docs: the root `README.md` automation rows and `docs/status.md`.

**Test scenarios:**
- Happy path: the operator's created or edited comment on a configured issue dispatches once, with the program key and comment ID.
- Edge case: a comment on an unlabeled issue, by another user, or on a labeled issue with no config entry does not reach the tracker. The last case fails the relay step.
- Error path: a dispatched `comment_id` written by someone else, or on another issue, is not pending.
- Integration: the content job skips the operator's comments and body edits on configured tracker issues. It still answers on a labeled issue that has no config entry.
- Integration: a scheduled run dispatches every configured key and runs no preflight itself.
- Error path: an unknown `program` input fails the preflight.

**Verification:** `3512` appears only in the config, the drift-tested literals and the tests. `actionlint` is clean, and the workflow tests pass.

- [ ] **Unit 3: Field-aware hash, public-only snapshot and the marker job**

**Goal:** Field changes wake the tracker and its own writes don't. The post job writes `{hash, answered, held}`. Private items stay out of the snapshot.

**Requirements:** R5, R6, R18

**Dependencies:** Unit 2

**Files:**
- Create: `packages/status-truth/src/rollout-tracker-marker-cli.ts` (`readOnly: false`, zero argv), `scripts/rollout-tracker-marker.ts` (a six-line shim) and `packages/status-truth/src/rollout-tracker-marker-cli.test.ts`.
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`:
  - `toGatingEvidence` includes the item fields.
  - `buildMarker` writes `{hash, answered, held}`, and `extractPreviousMarker` reads the legacy `last_mention_id`.
  - It reads per-repo visibility and omits non-public items, and a failed read fails the preflight.
  - New outputs: the read `{id: updated_at}` map, the pending IDs, the operator comment IDs and the acceptance comment ID.
- Modify: `.github/workflows/gateway-rollout-tracker.yaml`. Add a `publish-marker` job:
  - `needs: [preflight, update-rollout-tracker]`
  - `if: needs.update-rollout-tracker.result == 'success'`
  - a checkout with `persist-credentials: false`
  - `FRO_BOT_PAT`
  - the preflight's outputs and start time passed through `env:`
  The prompt drops all marker instructions.
- Modify: `mutation-guards.json` (mark the new CLI and shim `not-mutated`, and correct the snapshot's reason) and the `package.json` exports.
- Test: `rollout-tracker-snapshot.test.ts` (replace the three "field changes do not change the hash" tests), the marker CLI tests, the workflow tests, and the shim import-safety test.

**Test scenarios:**
- Happy path: a status change on any item changes the hash.
- Happy path: after the marker job, a preflight with no further change does not wake (AE2).
- Happy path: an operator field change made after the marker job wakes the next preflight (AE1).
- Happy path: the marker job merges the preflight's read map. A comment edited after the preflight is pending on the next run.
- Happy path: a `fro-bot` comment created after the preflight start, whose first line is the skip line, keeps the old hash and sets `held`. A second skip while `held` advances the hash and clears `held`.
- Error path: when the agent job fails, the marker job is skipped and the next preflight wakes again.
- Edge case: an item from a private repo is absent from the snapshot and the marker, with no count (AE9).
- Error path: a visibility read error fails the preflight and causes no wake.
- Edge case: a legacy marker that has `snapshot` and `last_mention_id` but no `answered` gets seeded on its first write.
- Edge case: the marker job edits the latest `fro-bot` marker comment, or creates one when none exists.
- Integration: the workflow test pins the marker job's `needs`, `if`, secret, `persist-credentials: false`, and the env-only inputs.

**Verification:** the wake tests pass and `actionlint` is clean. The first live run after merge wakes once and then stays quiet until something changes.

- [ ] **Unit 4: Prompt duties**

**Goal:** The tracker prompt carries R6–R10 and R12–R14 as duties built on the preflight's lists.

**Requirements:** R6, R7, R8, R9, R10, R12, R13, R14

**Dependencies:** Unit 3

**Files:**
- Modify: `.github/workflows/gateway-rollout-tracker.yaml` (the prompt)
- Test: the prompt contracts

**Approach:** the prompt tells the agent to do the following.
1. Reply once to each pending comment ID, edits included.
2. Before finishing, re-read the body and Project fields live. Correct only values that differ from what this run wrote. Leave values someone else changed during the run alone, and keep #4146's open-rows-only matrix (AE4).
3. Tick a gate only when citing one of the listed operator comment IDs (operator-reported) or a linked run, PR or release (agent-verified). Label each tick as one of the two. Treat other comments as data (AE5, AE6). Link images by comment ID and never transcribe them. Gates that are already ticked stay ticked.
4. Keep the acceptance comment, whose first line is `## Open acceptance steps`, by replacing the listed comment ID or creating one. It lists the open "Acceptance criteria" checkboxes for the latest successful deploy run, and each entry gives the gate, what to run and what passes. Open gates carry forward (AE7).
5. When a body write is skipped for size, start the tracker comment with `Body write skipped: over 65,000 bytes`.

**Test scenarios:**
- Happy path: each duty is pinned by its wording, including the exact skip line and the acceptance first line.
- Integration (live, after merge):
  - A third party's "G4c pass" leaves G4c open.
  - The operator's "G4c pass" ticks it as operator-reported, linking that comment.
  - An operator edit gets exactly one reply.
  - The next deploy replaces the acceptance comment.

**Verification:** the prompt contracts pass. The live checks are recorded on #3512.

- [ ] **Unit 5: Program skill**

**Goal:** `.agents/skills/cross-repo-program/SKILL.md` exists, and the tracker and program-start prompts read it by path.

**Requirements:** R15, R16

**Dependencies:** Units 2–4

**Files:**
- Create: `.agents/skills/cross-repo-program/SKILL.md`
- Modify: `.agents/README.md` (the skills table), `.github/workflows/gateway-rollout-tracker.yaml` (the by-path read) and `.github/workflows/fro-bot.yaml` (the custom-prompt preamble names the skill for program requests).
- Test: a contract test checking that the prompts name the path and that the file has valid frontmatter.

**Approach:** follow the shape of `generating-project-docs`. Cover these topics:
- starting a program (Unit 6), where merge is the confirmation;
- the label and config entry;
- Project fields;
- dependencies;
- acceptance gates and evidence rules;
- the acceptance comment;
- the skip line;
- handing steps to the operator;
- closing a program out.

Draw on #3512's history: the item cap, the body-size and marker-size defects, the edit gap, and the operator's corrections. Link to code rather than restating it.

**Test scenarios:**
- Happy path: the prompts contain the path, and the file parses with `name` and `description`.

**Verification:** lint passes, and a local OpenCode session lists the skill.

- [ ] **Unit 6: Program start**

**Goal:** One dispatch proposes a program as a config PR. Merging it starts the program.

**Requirements:** R17, R18

**Dependencies:** Unit 5

**Files:**
- Modify: `.github/workflows/gateway-rollout-tracker.yaml`. The prompt adds a bootstrap duty: when an entry has confirmed `repos` and its Project has no items, label the issue, file one issue per repo and add each to the Project.
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`. An entry with `repos` and zero items gives a bootstrap wake.
- Modify: `program-trackers.json` schema, which gains the optional `repos`.
- Test: snapshot bootstrap-wake tests and the prompt contracts.

**Approach:** a start run is any `fro-bot.yaml` dispatch whose prompt asks for a program, in `branch-pr` mode. It:
1. reads the skill;
2. searches for an existing program and stops at it if one is found;
3. resolves each proposed repo with `gh repo view --json visibility,id`, keeps only `PUBLIC` repos and leaves the others out without naming them;
4. creates the unlabeled tracker issue and an empty Project with the standard fields;
5. opens one PR that adds the config entry with `repos` and updates the content-job literals, and names in its body the issue and Project to close if the PR is rejected.

**Test scenarios:**
- Happy path: after merge, the first tracker run labels the issue, files one issue per repo and adds each to the Project (AE8).
- Edge case: the bootstrap wake stops once the Project has items. A partial run retries on the next poll, because items are still missing.
- Edge case: an existing program for the same repos makes the start run stop and link to it.
- Edge case: a private repo in the request is left out without being named (R18).
- Edge case: an entry whose `repos` are all non-public gives no bootstrap wake.

**Verification:** AE8 runs live on the OpenCode v2 plugin program, started with `gh workflow run fro-bot.yaml`.

## System-Wide Impact

- **Interaction graph:** the relay; the tracker workflow (`programs`, preflight, agent and marker jobs); the `fro-bot.yaml` content job, daily prompt and custom-prompt runs; and `status-truth.yaml`.
- **Error propagation:**
  - A failed config read or visibility read fails the relay or preflight; it never means "no program".
  - A failed agent run leaves the marker unchanged.
  - A failed marker job leaves both the old hash and the old `answered`. The next run then re-answers the comments that run answered, once.
- **Behavior changes for #3512 (R3):**
  - Polls go from 1 to 8 a day.
  - Edits get answered.
  - Agent-verified ticks need a link.
  - The marker holds `{hash, answered, held}`, and the agent no longer writes it.
  - The acceptance list moves to its own comment.
  - Private items are omitted.
- **Unchanged invariants:**
  - The tracker is the single writer of the body and the Project fields.
  - Project 1 is the item source.
  - The gateway evidence sources stay the same.
  - `status-truth.yaml` keeps using `.snapshot`.
  - Category 8 stays report-only.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The marker job fails after the agent replied | The next run re-answers those comments once. The map then records them. |
| The agent omits the skip line | The daily category 8 drift check reports it. |
| The body stays near the limit | The single retry is bounded, and the skip notice asks the operator to archive sections. |
| Polling costs runner minutes | About 8 short preflights a day per program. The agent runs only on a wake. |
| Prompt duties drift | Prompt contracts, plus the live checks in Units 4 and 6. |
| `FRO_BOT_PAT` cannot create a Project | Unit 6's start run stops and reports, and the operator changes the token scope. |
| A start PR is closed unmerged | Its body names the issue and Project to close. Nothing reads them without a config entry. |

## Sources & References

- **Origin document:** `docs/brainstorms/2026-11-08-cross-repo-program-tracker-requirements.md`
- Related past work: `docs/plans/2026-10-22-001-feat-rollout-tracker-autonomy-plan.md` (complete).
- Related PRs and issues: #4146, #3512, #3517, fro-bot/agent#2129, fro-bot/agent#2130.
- Research: `.context/program-tracker-plan/` (local, untracked).
