---
title: "feat: run domain programs through repository agents that answer before they work"
type: feat
status: active
date: 2026-11-25
origin: docs/brainstorms/2026-11-25-foreman-domain-programs-requirements.md
---

# feat: run domain programs through repository agents that answer before they work

## Overview

Fro Bot becomes a foreman over GitHub (see origin: `docs/brainstorms/2026-11-25-foreman-domain-programs-requirements.md`). A reviewed domain file groups repositories and gives each domain a brief. A program is started the way the program-tracker skill starts one, opens a cross-repo goal that dispatches one part per repository, and the tracker shows each repository agent's answer, its outcome and any stall. Observe can propose a program from a recurring domain-wide gap. The first program is automation parity for the harness tools, with a Part 0 that brings dispatch-to-pull-request routing to the two repositories that lack it.

The plan extends four existing parts and adds no state store, writer layer or comment syntax: cross-repo dispatch, the program-tracker start and bootstrap, the tracker snapshot, and Observe's attention-list rules.

## Problem Frame

The origin document covers the problem. In short: the specialists exist (24 of 31 public tracked repositories run their own Fro Bot agent), cross-repo dispatch and the program tracker work, but no repository knows its domain, no domain carries a brief, dispatch and trackers don't talk to each other, and a dispatched agent can only do the work or fail. Nothing has been dispatched since 2026-10-23.

## Requirements Trace

- Domains: R1-R4 (Unit 1).
- Offered programs: R5-R7 (Units 2, 5).
- Proposed programs: R8-R11 (Unit 6).
- Repository agents: R12-R15 (Units 2, 4, 5); R16-R17 (Unit 3).
- First program: R18-R19 (Units 5, 7).
- Success criteria: Unit 7 records answers, avoided rework and operator actions.

## Scope Boundaries

- No new trigger for answers: the tracker reads them on its daily run, which lands 5-9 hours late (`.agents/skills/cross-repo-program/SKILL.md`).
- No new workflow for proposal approval: the next daily pass acts on the approval label.
- No reach beyond the `fro-bot` and `marcusrbrown` owners; no automatic rerouting; no Space Bus coupling; no freshness leases (see origin: Scope Boundaries).

### Deferred to Separate Tasks

- Surfacing dispatch's silent `skippedUnsafePrompt` on the goal issue for all goals: today it shows only in the step summary. This plan stops the foreman's own oversize case at program start instead.
- Governed label creation in target repositories: this plan has the agent create its answer label when missing, as the tracker's bootstrap does today.

## Context & Research

### Relevant Code and Patterns

- Dispatch: goal issue labelled `cross-repo-goal`, planner `GOAL_DECOMPOSITION_PROMPT` in `.github/workflows/fro-bot.yaml` (it skips issues authored by `fro-bot`), checklist grammar `CHECKLIST_LINE` in `packages/dispatch/src/dispatch-receipts.ts`, approval by `dispatch-approved` from the operator (`.github/workflows/cross-repo-dispatch.yaml`), eligibility `gateTarget` in `packages/dispatch/src/dispatch-plan.ts`, worker prompt `buildDispatchPrompt` (receipt contract), receipts `success | noop | failed` with the earliest authentic receipt final, 24-hour `needs-attention/no-receipt` SLA from the dispatch epoch (`dispatch-model.ts`, `dispatch-run.ts` `runTrack`). The approval fingerprint is the set of `target:promptHash` pairs, so a prompt that names a commit binds the approval to it.
- Program tracker: start flow in `.agents/skills/cross-repo-program/SKILL.md` (credentialed dispatch run, tracker issue and Project, one start PR adding the `program-trackers.json` entry and the content-job exclusion literal), config parser `packages/status-truth/src/program-trackers.ts` (in Stryker `mutate`, shard 3), bootstrap duty in `.github/workflows/gateway-rollout-tracker.yaml` (files one part issue per repository with no body template), snapshot and wake hash in `packages/status-truth/src/rollout-tracker-snapshot.ts` (`toGatingEvidence` zeroes labels; `decideComment` has no clock; preflight outputs such as `bootstrap_repos` force a wake without a hash change; one failed issue read fails the run).
- Attention list: `key:` lines, `first seen` walk-back, escalation after three consecutive reports, operator-closed means declined, at most two new issues per run, public-only rule (`OBSERVE_OUTPUT` in `fro-bot.yaml`). Composed prompts are built with `format()` over named env keys, so new duties go inside an existing composed string.
- Committed-config precedent: `program-trackers.json` is parsed with fixed-message errors, loaded by its own test, listed in `FIXED_TRIGGER_FILES` (`packages/ci-checks/src/check-mutation-guards.ts`) and pinned in `RUNTIME_READ_TRIGGERS` (`packages/ci-checks/src/mutation-guards-config.test.ts`).
- Labels in this repository are declared in `.github/settings.yml` and pinned by `settings-labels-effective-set.test.ts`.

### Institutional Learnings

- `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md`: only an allowlisted author with a matching item and valid nonce hash makes a receipt; missing receipts stay visible.
- `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md`: test the planner comment → marker → dispatch → tracking path with production-shaped input.
- `docs/solutions/workflow-issues/autonomous-rollout-tracker-workflow-2026-06-17.md`: route through the one serialized tracker writer; snapshot read failures fail closed.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`: a green agent run is not proof of a handoff.
- Agent delivery mode: `output-mode` applies only to schedule and dispatch runs; `working-dir` discards edits. Verify each target's routing before promising a pull request.

### Harness-tools inventory (2026-11-25)

All four repositories pin agent v0.148.0 and run `isolate-agent` and `persist-credentials: false`. Against this repository's automation: none of the three sets `repo-skills`, none uses the agent-model resolver (each reads `vars.FRO_BOT_MODEL` directly), none reviews `fro-bot`-user pull requests, none runs Renovate Approve. `marcusrbrown/systematic` and `fro-bot/dashboard` have `.agents/skills/`; `fro-bot/space-bus` has none. `marcusrbrown/systematic` has copilot-setup-steps. No `AGENTS.md` forbids any item. Dispatch routing: dashboard sends a custom prompt to `branch-pr`; systematic keeps it comment-only by a documented contract; space-bus runs it in a discarded working directory. `fro-bot` pull requests that change `.github/workflows/` exist in systematic (3 of 60) and this repository (6 of 59), none yet in space-bus or dashboard.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "fro-bot/.github repository root at origin/main; target repositories' workflows surveyed separately for the inventory",
  "freshness": {
    "vcs_reference": "origin/main e16eeb97b93bb7ad0c6db6ef8463a8475d163566"
  },
  "budget": {
    "max_search_passes": 6,
    "max_candidate_inspections": 12,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "packages/dispatch (runDispatch, runTrack, planDispatch, gateTarget, buildDispatchPrompt, resolveReceipts)",
      "description": "assigns checklist items to repositories, operator-approved, hash-bound completion receipts, 24-hour no-receipt SLA",
      "disposition": "extend"
    },
    {
      "path_or_symbol": ".agents/skills/cross-repo-program/SKILL.md, program-trackers.json, packages/status-truth/src/program-trackers.ts",
      "description": "program start, confirmed-repository config, per-repository part issue bootstrap",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/status-truth/src/rollout-tracker-snapshot.ts, .github/workflows/gateway-rollout-tracker.yaml",
      "description": "tracker issue and Project, snapshot wake hash, derived wake lists, marker",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "fro-bot.yaml GOAL_DECOMPOSITION_PROMPT",
      "description": "turns an operator's goal issue into checklist lines; skips fro-bot-authored issues",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "fro-bot.yaml OBSERVE_CATEGORIES and OBSERVE_OUTPUT attention rules",
      "description": "stable keys, first-seen walk, escalation, operator-closed means declined, public-only",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/status-truth proposal-markers.ts and proposal-labels.ts",
      "description": "fingerprint-keyed proposal issues with outcome labels and a cooldown, scoped to status-truth claims",
      "disposition": "insufficient",
      "insufficiency_reason": "keyed on status-truth claim fingerprints, not domain gaps; the attention-list rules fit the evidence Observe already produces"
    },
    {
      "path_or_symbol": "metadata/repos.yaml with gateTarget",
      "description": "registry of tracked public onboarded repositories and the dispatch gate",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/dispatch/src/dispatch-renovate.ts",
      "description": "fan-out dispatch to registry repositories",
      "disposition": "insufficient",
      "insufficiency_reason": "no per-repository answer, receipt or status"
    }
  ]
}
```

## Key Technical Decisions

- **Domain file:** `program-domains.json` at the repository root, parsed by a new `packages/status-truth/src/program-domains.ts` beside `program-trackers.ts`, with the same fixed-message errors. `program-trackers.json` gains an optional `domain` key that must name a domain in it. Rationale: same shape, same package, same review path as program configs (see origin: Key Decisions).
- **Brief pinning:** a part's checklist line names the domain file at a commit (`program-domains.json@<sha>#<domain>`). Dispatch fingerprints the prompt text, so approval covers that brief revision, and a changed commit is a new item that needs fresh approval (R12). No dispatch code change.
- **Answer surface:** the part issue the tracker's bootstrap already files carries a fixed body: the goal, the pinned brief, and the answer protocol. The repository agent answers with one of `part-accepted`, `part-declined`, `part-countered` (created if missing) plus a prose reason comment. No comment syntax.
- **Decline and counter end the dispatch attempt:** the receipt vocabulary gains `declined` and `countered`, posted with the same nonce as any receipt, so the answer is bound to the agent and attempt. `runTrack` maps both to terminal `blocked` with the status as reason, so neither completes the item nor ages into `needs-attention/no-receipt` (R15). An accept posts no receipt; the completion receipt stays the only success.
- **Dispatch and tracker link:** the program start writes the goal issue and its checklist comment itself as `fro-bot`, so the planner (which skips `fro-bot` authors) does not decompose it again, and adds the goal issue to the program's Project. The tracker then reads the goal's state and labels with no new code, and reads the dispatch marker for each item's epoch (Unit 3).
- **Clocks:** the answer clock starts at the item's dispatch epoch from the goal marker; the outcome clock at the `part-accepted` label's time. Held (no epoch yet, or Part 0 unmerged) is not stalled. Windows: 3 days to answer, 14 days to an outcome after accept, constants in the snapshot module.
- **Wake inputs without moving #3512:** answer labels and stall, hold and unknown lists enter the snapshot only when a program has a `domain`, so #3512's golden hash is unchanged. Ages are derived lists in the preflight output, like `bootstrap_repos`, never hash inputs.
- **Per-part unknown:** a failed read of one part issue marks that part unknown and continues, for domain programs only; #3512 keeps its fail-the-run behaviour.
- **Proposals:** Observe's category 6 records domain-wide gaps as attention items keyed `domain:<name> — <gap>`; the existing three-report escalation files a `program-proposal` issue instead of an `attention-tracking` one, at most one open. An operator-closed proposal is declined; a new one needs a material change named in it. The operator approves with `program-approved`; the next daily pass (Observe holds `FRO_BOT_PAT`) starts the program through the skill and comments the tracker link.
- **Part 0:** the bootstrap files Part 0 as its own part issue in systematic and space-bus, marked as a prerequisite, and the operator asks the repository agent on it. The parity checklist for a repository is posted only after the tracker shows its Part 0 merged.

## Open Questions

### Resolved During Planning

- Can a fro-bot-authored goal be dispatched? The workflow gate checks the label's sender, not the issue author, and seeding reads checklist comments by `fro-bot`; Unit 5 pins this with a flow test before relying on it.
- Where does "answer before work" live? In the part issue body the bootstrap writes, not in dispatch's fixed prompt, which serves every goal.
- Why not reuse status-truth proposals? Their fingerprints are claim-shaped; Observe already produces keyed, dated items.

### Deferred to Implementation

- Whether `packages/status-truth` may import `@fro-bot/dispatch`'s marker parser, or the epoch read moves behind a seam; `scripts/package-layout.test.ts` decides.
- Whether systematic's and space-bus's issue paths can open a pull request that changes workflows; observed on Part 0 itself (R19 fallback: the operator authors it).
- The exact part issue title and body wording; pinned by the bootstrap prompt tests.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant Op as Operator
    participant FB as Fro Bot (program start / Observe)
    participant T as Tracker
    participant D as Cross-repo dispatch
    participant R as Repository agent
    Op->>FB: offer (dispatch run) or program-approved label on a proposal
    FB->>FB: accept or decline with reason
    FB->>Op: start PR (config entry with domain)
    Op->>T: merge start PR
    T->>R: part issues (goal, pinned brief, answer protocol; Part 0 where needed)
    FB->>D: goal issue + checklist (brief@sha)
    Op->>D: dispatch-approved
    D->>R: prompt + receipt contract
    R->>R: check AGENTS.md and repo state
    alt accept
        R->>T: part-accepted label + reason
        R->>D: completion receipt when done
    else decline or counter
        R->>T: part-declined / part-countered + reason
        R->>D: declined / countered receipt (attempt ends, blocked)
    end
    T->>Op: answers, outcomes, held / stalled / unknown parts (daily)
```

## Implementation Units

- [ ] **Unit 1: Domain file and its checks**

**Goal:** A reviewed `program-domains.json` names domains, their repositories and briefs, and a program config can name its domain.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Create: `program-domains.json`, `packages/status-truth/src/program-domains.ts`
- Modify: `packages/status-truth/src/program-trackers.ts` (optional `domain`), `packages/status-truth/package.json` (export), `stryker.config.json` (`mutate`), `mutation-guards.json` (one shard list), `packages/ci-checks/src/check-mutation-guards.ts` (`FIXED_TRIGGER_FILES`)
- Test: `packages/status-truth/src/program-domains.test.ts`, `packages/status-truth/src/program-trackers.test.ts`, `packages/ci-checks/src/mutation-guards-config.test.ts` (`RUNTIME_READ_TRIGGERS`)

**Approach:**
- Parse domains with `key`, `repos[{nameWithOwner, nodeId}]` and `brief` (security, automation, developer-experience standards, per-repository exceptions). Fixed-message errors that never echo content.
- The committed-file test also checks every listed repository against `metadata/repos.yaml` on main: present, `private: false`, not archived. A repository in two domains fails.
- Seed the harness-tools domain with the three repositories and an inventory-based brief (Unit 7 fills the parity bar).

**Execution note:** Test-first; the module joins `mutate`, so tests import it by relative path.

**Patterns to follow:** `packages/status-truth/src/program-trackers.ts` and its committed-file test.

**Test scenarios:**
- Happy path: the committed file parses; harness-tools lists three repositories.
- Error path: duplicate domain key, a repository in two domains, an empty brief, a missing `nodeId`, a repository marked private or archived or absent from the registry each fail with a fixed message naming no content.
- Edge case: case-only duplicate `nameWithOwner` is a duplicate.
- Integration: a program config with `domain: "harness-tools"` parses; with an unknown domain it fails.

**Verification:** The parser and committed-file test pass; the mutation gate covers the new module with no surviving mutants.

- [ ] **Unit 2: Part issues carry the brief and the answer protocol**

**Goal:** The tracker's bootstrap files each domain program's part issue with a fixed body the repository agent can act on, and Part 0 as its own prerequisite part where needed.

**Requirements:** R6, R12, R13, R14, R19

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/gateway-rollout-tracker.yaml` (bootstrap duty), `packages/status-truth/src/rollout-tracker-snapshot.ts` (preflight emits the domain, brief commit and Part 0 repositories for the program)
- Test: `scripts/gateway-rollout-tracker-workflow.test.ts`, `packages/status-truth/src/rollout-tracker-snapshot.test.ts`

**Approach:**
- For a program with a `domain`, the bootstrap body states the goal, links `program-domains.json` at the commit on main the preflight read, and gives the protocol: check the ask against your `AGENTS.md` and repository state; answer with `part-accepted`, `part-declined` or `part-countered` (create the label if missing) and one comment with the reason; start work only after accepting; never override your own rules.
- A repository listed as needing Part 0 gets a separate part issue titled as a prerequisite.
- A program without a `domain` keeps today's bootstrap text exactly.

**Test scenarios:**
- Happy path: the domain program's bootstrap prompt contains the pinned brief link format, the three labels, "only after accepting" and the never-override rule.
- Edge case: #3512's config (no domain) yields byte-identical bootstrap text and golden stdout.
- Integration: Part 0 repositories get a separate prerequisite part in the preflight output.

**Verification:** Prompt pins pass; #3512's golden hash test is unchanged.

- [ ] **Unit 3: The tracker reads answers, holds and stalls**

**Goal:** For domain programs, the tracker shows each part's answer and reason, wakes when an answer changes, and lists held, stalled and unknown parts.

**Requirements:** R13, R16, R17

**Dependencies:** Units 1, 2, 5 (epochs come from the goal marker)

**Files:**
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`, `.github/workflows/gateway-rollout-tracker.yaml` (preflight outputs and prompt duty), `fro-bot.yaml` OBSERVE category 8 (daily report lists stalled parts)
- Test: `packages/status-truth/src/rollout-tracker-snapshot.test.ts`, `scripts/gateway-rollout-tracker-workflow.test.ts`, `scripts/fro-bot-workflow-progressive-improvement.test.ts`

**Approach:**
- Copy the answer label into gating evidence only for domain programs; derive `stalled_parts`, `held_parts` and `unknown_parts` in preflight from the goal marker's epochs and the label's time against the two windows.
- A part issue read failure marks that part unknown and continues, for domain programs only.

**Test scenarios:**
- Happy path: a new `part-declined` label changes the hash and wakes the tracker; the prompt shows the reason comment's link.
- Edge case: a part with no epoch is held, not stalled; an epoch three days old with no answer is stalled; an accept 14 days old with no completion is stalled.
- Error path: one part issue 500s; the run continues and the part is unknown. For #3512 the same failure still fails the run.
- Edge case: #3512's golden hash and stdout are unchanged.

**Verification:** Snapshot tests pass; a dry run against a fixture program with one answer of each kind prints the expected lists.

- [ ] **Unit 4: Decline and counter end the dispatch attempt**

**Goal:** A repository agent's decline or counter is a verified, attempt-bound receipt that ends the item without completing it or raising a missing-receipt alert.

**Requirements:** R15

**Dependencies:** None

**Files:**
- Modify: `packages/dispatch/src/dispatch-model.ts` (`ResultStatus`), `packages/dispatch/src/dispatch-receipts.ts`, `packages/dispatch/src/dispatch-run.ts` (`runTrack` mapping), `packages/dispatch/src/dispatch-plan.ts` (`buildDispatchPrompt` names the two statuses)
- Test: `packages/dispatch/src/dispatch-receipts.test.ts`, `packages/dispatch/src/dispatch-run.test.ts`, `scripts/dispatch-flows.test.ts`

**Approach:**
- Add `declined` and `countered`; both pass the same author, correlation and nonce gates; `runTrack` maps them to `blocked` with the status as the reason. The earliest authentic receipt stays final, so a later completion receipt for a declined attempt is ignored.

**Execution note:** Characterization first: pin today's three statuses and the SLA before adding the two.

**Test scenarios:**
- Happy path: a `declined` receipt with a valid nonce sets the item `blocked/declined`; the goal closes when all items are terminal.
- Edge case: `countered` before the 24-hour SLA stops aging; no `needs-attention` appears after 48 hours.
- Error path: a `declined` receipt with a wrong nonce or from an unlisted author is ignored and the item ages as today.
- Edge case: a `success` receipt after a `declined` one is ignored.
- Integration: planner comment → marker → dispatch → `declined` receipt → track, with production-shaped input.

**Verification:** Dispatch tests and the flow test pass; existing goals' behaviour is unchanged.

- [ ] **Unit 5: Program start links dispatch to the tracker**

**Goal:** Starting a domain program opens the goal issue and checklist itself, adds the goal to the program's Project, and holds parity items until Part 0 merges.

**Requirements:** R5, R6, R7, R12, R19

**Dependencies:** Units 1, 4

**Files:**
- Modify: `.agents/skills/cross-repo-program/SKILL.md`, `.github/workflows/fro-bot.yaml` (`PROGRAM_REQUEST_NOTE`), `.github/workflows/gateway-rollout-tracker.yaml` (post the parity checklist when a Part 0 merges)
- Test: `scripts/agent-skills.test.ts`, `scripts/fro-bot-workflow.test.ts`, `scripts/dispatch-flows.test.ts` (a fro-bot-authored goal with a fro-bot checklist is seeded after the operator's label)

**Approach:**
- The skill's start step accepts or declines the offer with a reason, writes the config entry with `domain`, and after the start PR merges opens the `cross-repo-goal` issue as `fro-bot` with one checklist comment: one line per repository without Part 0, each `owner/repo: <goal>. Brief: program-domains.json@<sha>#<domain>. Part issue: <tracker link>`, under 4,000 characters, or the start stops and says why.
- When the tracker sees a Part 0 merged, it posts the parity line for that repository as a new checklist item, which needs a fresh `dispatch-approved`.

**Test scenarios:**
- Happy path: the skill text names the goal issue, the checklist format with a pinned commit, and adding the goal to the Project.
- Integration: a fro-bot-authored goal with a fro-bot checklist is not decomposed by the planner and is seeded when the operator applies `dispatch-approved`.
- Error path: a line over 4,000 characters stops the start with a reason on the tracker.
- Edge case: a repository with Part 0 unmerged has no checklist line.

**Verification:** Skill and workflow pins pass; the flow test proves seeding of a fro-bot-authored goal.

- [ ] **Unit 6: Observe proposes domain programs**

**Goal:** Observe turns a recurring domain-wide gap into at most one open proposal, and starts the program the operator approves.

**Requirements:** R8, R9, R10, R11

**Dependencies:** Units 1, 5

**Files:**
- Modify: `.github/workflows/fro-bot.yaml` (`OBSERVE_CATEGORIES` category 6, `OBSERVE_OUTPUT` attention rules), `.github/settings.yml` (`program-proposal`, `program-approved` labels)
- Test: `scripts/fro-bot-workflow.test.ts`, `scripts/settings-labels-effective-set.test.ts`

**Approach:**
- Category 6 reads `program-domains.json` and records a gap shared by repositories of one domain as an attention item keyed `domain:<key> — <gap>`, with the usual first-seen walk.
- On the existing three-report escalation, file a `program-proposal` issue in `fro-bot/.github` naming the domain, the gap, the repositories and the dated reports, unless one is already open. An operator-closed proposal for the key is declined; a new one requires a named material change (a new repository, a regression, a changed condition).
- A `program-proposal` issue the operator labelled `program-approved` is started through the skill on the next daily pass, which comments the tracker link.

**Test scenarios:**
- Happy path: pins for the key form, the one-open rule, the decline rule, the material-change rule and the approval pickup.
- Edge case: a second gap while a proposal is open stays an attention item.
- Error path: an approval label applied by someone other than the operator is ignored.

**Verification:** Prompt and label pins pass.

- [ ] **Unit 7: First program: harness-tools automation parity**

**Goal:** Run the first program end to end and record what it shows.

**Requirements:** R18, R19, success criteria

**Dependencies:** Units 1-6 merged

**Files:**
- Modify: `program-domains.json` (harness-tools brief from the inventory), this plan (dated results)

**Approach:**
- Brief: repo skills, the agent-model resolver, `fro-bot`-user pull request review, dispatch-to-pull-request routing; Renovate Approve only where the repository uses Renovate automerge; exceptions recorded per repository.
- Offer the program; Part 0 in systematic and space-bus; then parity dispatches.
- Record per part: answer, pull request, outcome; whether an answer avoided rework; operator actions counted.

**Test expectation:** none -- live operational unit; evidence is the tracker, the pull requests and the run links recorded here.

**Verification:** Every part answered; every accepted part merged or a recorded no-op; counts recorded.

## System-Wide Impact

- **Interaction graph:** dispatch receipts, the tracker snapshot, the start skill and Observe's attention list all change; #3512 must behave exactly as today.
- **Error propagation:** per-part unknown is new and limited to domain programs; dispatch keeps its fail-closed gates.
- **State lifecycle risks:** a parity item posted after Part 0 is a new checklist item; an approval fingerprint never covers it until the operator labels again.
- **Unchanged invariants:** existing goals' receipt semantics, #3512's hash and bootstrap text, the planner for operator-authored goals, `dispatch-approved` as the only dispatch gate.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| A target agent ignores the part issue protocol | The tracker shows no answer as stalled after 3 days; Unit 7 records it |
| Systematic's issue path can't open a workflow-changing PR | R19 fallback: the operator authors Part 0 there |
| Hash change wakes #3512 | Domain-only evidence; golden hash test |
| Status-truth importing dispatch breaks the package graph | Resolve in Unit 3 with the layout test |

## Sources & References

- **Origin document:** `docs/brainstorms/2026-11-25-foreman-domain-programs-requirements.md`
- Related past work: `docs/plans/2026-11-08-002-feat-cross-repo-program-tracker-plan.md`, recorded complete (this plan adds domains, answers and dispatch linking); `docs/plans/2026-07-04-001-feat-cross-repo-dispatch-loop-plan.md`, recorded complete (this plan adds two receipt statuses); `docs/plans/2026-11-08-003-feat-actionable-attention-list-plan.md`, recorded complete (this plan reuses its key and escalation rules).
- Related issues: #3512, #3633, #3640, #4050
