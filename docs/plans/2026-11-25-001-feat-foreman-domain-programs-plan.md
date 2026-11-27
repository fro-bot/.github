---
title: "feat: run domain programs through repository agents that answer before they work"
type: feat
status: active
date: 2026-11-25
origin: docs/brainstorms/2026-11-25-foreman-domain-programs-requirements.md
---

# feat: run domain programs through repository agents that answer before they work

## Overview

Fro Bot becomes a foreman over GitHub (see origin: `docs/brainstorms/2026-11-25-foreman-domain-programs-requirements.md`). A reviewed domain file groups repositories and gives each domain a brief. A program is started the way the program-tracker skill starts one, opens a cross-repo goal that dispatches one part per repository, and the tracker shows each repository agent's answer, its outcome and any stall. Observe can propose a program from a recurring domain-wide gap. The first program is automation parity for the harness tools, with a Part 0 that brings dispatch-to-pull-request routing to the repositories that lack it (two when this plan was written, six after the 2026-11-27 inventory; see Unit 7 results).

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
- One small workflow for proposal approval (`program-approved.yaml`): the operator's label dispatches the start request, so Observe never starts a program and no later daily pass is waited for.
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
- **Brief pinning and validation:** the tracker's preflight reads `program-domains.json` at the main commit it runs on, checks the program's domain exists with a non-empty brief, and emits that commit. A goal's checklist line names the brief as `program-domains.json@<sha>#<domain>`. Dispatch fingerprints the prompt text, so an approval covers exactly that brief; a later brief change applies to the next goal, which needs its own approval (R12). A missing domain or empty brief makes preflight emit a fixed error, and the tracker reports it instead of opening a goal.
- **The approved prompt carries the ask; the part issue carries answers:** each checklist line holds the exact per-repository ask with the pinned brief, so the operator's approval fingerprints the ask itself. The part issue the bootstrap files holds the answer protocol and status, never instructions the agent acts on; an edit to it changes nothing that was approved. The repository agent answers with one of `part-accepted`, `part-declined`, `part-countered` (created if missing) plus a prose reason comment. No comment syntax.
- **Answers bind to the current attempt:** the tracker counts an accept only from a `labeled` event that adds `part-accepted`, by the account the repository's agent posts as (`fro-bot`), after the attempt's anchor: the part issue's creation for the first attempt, and for the next one (its parity ask after Part 0) the tracker's own comment on the part issue saying the parity ask follows. The tracker posts that comment before it opens the parity goal, whether or not it cleared a label, so the anchor exists even when the operator authored Part 0 and no answer label was ever set. The dispatch epoch is not the anchor, because dispatch's recovery can set it after the agent already answered. The label is display state; the anchor, not a timestamp near dispatch, decides which attempt an accept belongs to. Declines and counters count only from the attempt's authenticated `declined` or `countered` receipt, which carries the correlation ID; the label and reason comment are for people. An authenticated accept receipt is not added, because the earliest receipt is final and would block the completion receipt.
- **Decline and counter end the dispatch attempt:** the receipt vocabulary gains `declined` and `countered`, posted with the same nonce as any receipt, so the answer is bound to the agent and attempt. `runTrack` maps them to terminal `blocked`, and the marker item gains an optional, backward-compatible `blockedReason` (`declined | countered`) that the guard accepts when absent. Neither completes the item nor ages into `needs-attention/no-receipt` (R15). An accept posts no receipt; the completion receipt stays the only success.
- **Dispatch and tracker link, one goal per batch:** the start run stops at its PR, as today, so the tracker's post-merge duty opens the goals. Once every part issue exists, it opens one `cross-repo-goal` issue as `fro-bot` with one checklist comment for the repositories that need no Part 0, and later one goal per repository whose Part 0 merged. A goal is found again by its batch key in the body (`program:<key> batch:<name>`), so a re-run reuses it. The planner skips `fro-bot`-authored goals by its job condition, and dispatch seeds a goal from a `fro-bot` checklist on the operator's label, so each batch is a fresh marker with its own approval; no item is ever added to an existing marker. Each goal is added to the program's Project, and the tracker reads its dispatch marker for item epochs.
- **Clocks:** the answer clock starts at the item's dispatch epoch from the goal marker; the outcome clock at the time of the `labeled` event that added `part-accepted`, read from the part issue's events. Held (no epoch yet, or Part 0 unmerged) is not stalled. Windows: 3 days to answer, 14 days to an outcome after accept, constants in the snapshot module.
- **Wake inputs without moving #3512:** answer labels enter the gating evidence only when a program has a `domain`, so #3512's golden hash is unchanged. Stalled, held and unknown parts are derived lists in the preflight output, like `bootstrap_repos`, and `decideComment` gains one domain-only wake condition: a non-empty stalled or unknown list whose contents differ from the last marker's. The marker records that list's digest, so a part stays stalled without waking every day.
- **Per-part unknown:** a failed read of one part issue or its events marks that part unknown and continues, for domain programs only; #3512 keeps its fail-the-run behaviour and its decision logic.
- **Marker parser import:** `packages/status-truth` imports the exported marker parser from `@fro-bot/dispatch`, adding the workspace dependency and lock entry; `dispatch` does not import `status-truth`, so no cycle. The root README dependency graph and the package descriptions in `.github/copilot-instructions.md` change with it.
- **Proposals:** Observe's category 6 records domain-wide gaps as attention items keyed `domain:<name> — <gap>`; the existing three-report escalation files a `program-proposal` issue instead of an `attention-tracking` one, at most one open. An operator-closed proposal is declined; a new one needs a material change named in it. The operator approves with `program-approved`; `program-approved.yaml` (an `issues: labeled` workflow with no agent step) dispatches one start request, which the skill re-checks against the label's events before it creates anything, and closes the proposal naming the tracker (or as already covered). Observe only files and updates proposals.
- **Part 0 on the same part issue:** each repository has one part issue. For a repository listed with Part 0, the issue's first ask is Part 0, which the operator raises with the repository's agent on that issue; its pull request is linked there. When the tracker sees that pull request merged, it removes any answer label from the issue, notes on it that the parity ask follows, and opens that repository's parity goal; the agent's parity accept is then always a fresh `labeled` event. One issue per repository keeps bootstrap's existing per-repository discovery.

## Open Questions

### Resolved During Planning

- Can a fro-bot-authored goal be dispatched? The workflow gate checks the label's sender, not the issue author, and seeding reads checklist comments by `fro-bot`; the planner is skipped by its own job condition. Unit 5 pins both with separate tests.
- How do later items reach dispatch? They don't join an existing marker, which seeds only once; each batch is its own goal with its own approval.
- Who opens goals after the start PR merges? The tracker's post-merge duty, since the start run stops at its PR.
- Where does "answer before work" live? In the part issue body the bootstrap writes, not in dispatch's fixed prompt, which serves every goal.
- Why not reuse status-truth proposals? Their fingerprints are claim-shaped; Observe already produces keyed, dated items.

### Deferred to Implementation

- Whether systematic's and space-bus's issue paths can open a pull request that changes workflows; observed on Part 0 itself (R19 fallback: the operator authors it). Answered 2026-11-27 for all six Part 0 repositories: they cannot, so the operator authors Part 0 (Unit 7 results).
- The exact part issue title and body wording; pinned by the bootstrap prompt tests.
- Unit 3, parity anchor: a parity batch is listed only after the tracker's parity-follows anchor comment exists on the part issue (Unit 5 lists it as soon as a merged pull request in the repo references the part issue).
- Unit 3, wake on goal problems: a goal batch stopped with an `error`, and a `goal_error`, wake the tracker when they change, with the domain-state digest (Unit 5 reports them only when the tracker wakes for another reason, as `bootstrap_blocked` does).

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
    T->>D: one goal per batch + checklist (brief@sha); Part 0 repos later, after their Part 0 merges
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
- The domain file's pull request checks structure only: a repository in two domains, or a node ID listed twice anywhere in the file, fails. Eligibility is checked at use, so a registry change never blocks a promotion: `checkDomainReposInRegistry` is a pure function that requires each listed repository's name and node ID to resolve to exactly one `metadata/repos.yaml` row that is public and not archived (a name or node ID matching several rows, or pointing at different rows, fails). The tracker's preflight (Unit 2) calls it and reports an ineligible repository; dispatch's eligibility gate (`gateTarget`) refuses it.
- Seed the harness-tools domain with the three repositories and an inventory-based brief (Unit 7 fills the parity bar).

**Execution note:** Test-first; the module joins `mutate`, so tests import it by relative path.

**Patterns to follow:** `packages/status-truth/src/program-trackers.ts` and its committed-file test.

**Test scenarios:**
- Happy path: the committed file parses; harness-tools lists three repositories.
- Error path: duplicate domain key, a repository in two domains (including one of several shared), a node ID listed twice, an empty brief and a missing `nodeId` each fail the parser with a fixed message naming no content. `checkDomainReposInRegistry` fails the same way for a repository that is private, archived, absent from the registry, with a node ID that differs, or that does not resolve to exactly one registry row (name or node ID matching several rows, in either order; name and node ID pointing at different rows).
- Edge case: case-only duplicate `nameWithOwner` is a duplicate.
- Integration: a program config with `domain: "harness-tools"` parses; with an unknown domain it fails.

**Verification:** The parser and committed-file test pass; the mutation gate covers the new module with no surviving mutants.

- [ ] **Unit 2: Part issues carry the brief and the answer protocol**

**Goal:** The tracker's bootstrap files each domain program's part issue with a fixed body the repository agent can act on; for a Part 0 repository the first ask is Part 0.

**Requirements:** R6, R12, R13, R14, R19

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/gateway-rollout-tracker.yaml` (bootstrap duty), `packages/status-truth/src/rollout-tracker-snapshot.ts` (preflight emits the domain, brief commit and Part 0 repositories for the program)
- Test: `scripts/gateway-rollout-tracker-workflow.test.ts`, `packages/status-truth/src/rollout-tracker-snapshot.test.ts`

**Approach:**
- For a program with a `domain`, the bootstrap body states the goal, links `program-domains.json` at the commit on main the preflight read, and gives the protocol: check the ask against your `AGENTS.md` and repository state; answer with `part-accepted`, `part-declined` or `part-countered` (create the label if missing) and one comment with the reason; start work only after accepting; never override your own rules.
- For a repository listed with Part 0, the body's first ask is Part 0 (adopt dispatch-to-pull-request routing), with the parity ask to follow on the same issue.
- Preflight emits the brief commit, or a fixed brief error that stops goal creation (Key Technical Decisions).
- Preflight runs `checkDomainReposInRegistry` against `metadata/repos.yaml` and reports a listed repository that is not eligible (private, archived, untracked or ambiguous), leaving it out of the part issues and goal batches.
- A program without a `domain` keeps today's bootstrap text exactly.

**Test scenarios:**
- Happy path: the domain program's bootstrap prompt contains the pinned brief link format, the three labels, "only after accepting" and the never-override rule.
- Edge case: #3512's config (no domain) yields byte-identical bootstrap text and golden stdout.
- Integration: a Part 0 repository's part issue body leads with the Part 0 ask; a re-run reuses the same issue.
- Error path: a program whose domain is missing from `program-domains.json`, or whose brief is empty, yields the fixed brief error in preflight and no goal.
- Error path: a domain repository that has turned private or been archived is reported as ineligible by preflight and gets no part issue; the domain file's pull request is unaffected.

**Verification:** Prompt pins pass; #3512's golden hash test is unchanged.

- [ ] **Unit 3: The tracker reads answers, holds and stalls**

**Goal:** For domain programs, the tracker shows each part's answer and reason, wakes when an answer changes, and lists held, stalled and unknown parts.

**Requirements:** R13, R16, R17

**Dependencies:** Units 1, 2, 5 (epochs come from the goal marker); build after Unit 5

**Files:**
- Modify: `packages/status-truth/src/rollout-tracker-snapshot.ts`, `packages/status-truth/package.json` (`@fro-bot/dispatch` dependency), `bun.lock`, `.github/workflows/gateway-rollout-tracker.yaml` (preflight outputs and prompt duty), `.github/workflows/fro-bot.yaml` OBSERVE category 8 (daily report lists stalled parts), `README.md` (package graph), `.github/copilot-instructions.md` (status-truth imports)
- Test: `packages/status-truth/src/rollout-tracker-snapshot.test.ts`, `scripts/gateway-rollout-tracker-workflow.test.ts`, `scripts/fro-bot-workflow-progressive-improvement.test.ts`, `scripts/package-layout.test.ts`

**Approach:**
- Copy the answer into gating evidence only for domain programs: an accept from a `labeled` event adding `part-accepted` by `fro-bot` after the current attempt's anchor (issue creation, or the tracker's parity-follows comment), and a decline or counter from the attempt's `blockedReason` in the goal marker. Derive `stalled_parts`, `held_parts` and `unknown_parts` in preflight from those against the two windows.
- Add the domain-only wake: a non-empty stalled or unknown list whose digest differs from the last marker's. The marker records the digest.
- A part issue or events read failure marks that part unknown and continues, for domain programs only.

**Test scenarios:**
- Happy path: a new `part-declined` label changes the hash and wakes the tracker; the prompt shows the reason comment's link.
- Edge case: a part with no epoch is held, not stalled; an epoch three days old with no answer is stalled; an accept 14 days old with no completion is stalled.
- Edge case: the same stalled list on the next run does not wake the tracker again; a new stalled part does.
- Edge case: a `part-accepted` label left from Part 0 does not count for the parity attempt; with no new accept after the parity-follows comment, the part waits for an answer and the answer clock starts at the parity epoch.
- Happy path: after the tracker clears the Part 0 label, the agent's parity accept adds `part-accepted` again and is recorded as the parity answer.
- Edge case: the agent accepts after its run started but before a later reconciliation writes the dispatch epoch; the accept is after the anchor, so it is kept, and the outcome clock starts at the accept.
- Edge case: the operator authored Part 0 and no answer label was ever set; the tracker's parity-follows comment is the anchor, and the agent's parity accept after it starts the outcome clock.
- Error path: if clearing the label fails, the tracker opens no parity goal for that repository and reports why.
- Error path: a `part-accepted` added by an account other than `fro-bot` is not an accept.
- Error path: one part issue 500s; the run continues and the part is unknown. For #3512 the same failure still fails the run.
- Edge case: #3512's golden hash and stdout are unchanged.

**Verification:** Snapshot tests pass; a dry run against a fixture program with one answer of each kind prints the expected lists.

- [ ] **Unit 4: Decline and counter end the dispatch attempt**

**Goal:** A repository agent's decline or counter is a verified, attempt-bound receipt that ends the item without completing it or raising a missing-receipt alert.

**Requirements:** R15

**Dependencies:** None

**Files:**
- Modify: `packages/dispatch/src/dispatch-model.ts` (`ResultStatus`, optional `blockedReason` on the item and its guard), `packages/dispatch/src/dispatch-marker.ts` (serialize and reload the field), `packages/dispatch/src/dispatch-receipts.ts`, `packages/dispatch/src/dispatch-run.ts` (`runTrack` mapping), `packages/dispatch/src/dispatch-plan.ts` (`buildDispatchPrompt` names the two statuses)
- Test: `packages/dispatch/src/dispatch-receipts.test.ts`, `packages/dispatch/src/dispatch-run.test.ts`, `scripts/dispatch-flows.test.ts`

**Approach:**
- Add `declined` and `countered`; both pass the same author, correlation and nonce gates; `runTrack` maps them to `blocked` and sets `blockedReason`. Today every non-`failed` receipt maps to `completed`, so the mapping becomes explicit per status. The earliest authentic receipt stays final, so a later completion receipt for a declined attempt is ignored.

**Execution note:** Characterization first: pin today's three statuses and the SLA before adding the two.

**Test scenarios:**
- Happy path: a `declined` receipt with a valid nonce sets the item `blocked` with `blockedReason: declined`; the marker reloads with the reason; the goal closes when all items are terminal.
- Edge case: a marker written before this change (no `blockedReason`) still loads.
- Edge case: `countered` before the 24-hour SLA stops aging; no `needs-attention` appears after 48 hours.
- Error path: a `declined` receipt with a wrong nonce or from an unlisted author is ignored and the item ages as today.
- Edge case: a `success` receipt after a `declined` one is ignored.
- Integration: planner comment → marker → dispatch → `declined` receipt → track, with production-shaped input.

**Verification:** Dispatch tests and the flow test pass; existing goals' behaviour is unchanged.

- [ ] **Unit 5: Program start links dispatch to the tracker**

**Goal:** After a domain program's start PR merges, the tracker opens one goal per batch with its checklist, adds each goal to the program's Project, and opens a repository's parity goal only after its Part 0 merges.

**Requirements:** R5, R6, R7, R12, R19

**Dependencies:** Units 1, 4

**Files:**
- Modify: `.agents/skills/cross-repo-program/SKILL.md` (start step accepts or declines; goals are the tracker's), `.github/workflows/fro-bot.yaml` (`PROGRAM_REQUEST_NOTE`), `.github/workflows/gateway-rollout-tracker.yaml` (goal duty), `packages/status-truth/src/rollout-tracker-snapshot.ts` (preflight lists batches to open: `goal_batches`)
- Test: `scripts/agent-skills.test.ts`, `scripts/fro-bot-workflow.test.ts` (the planner's job condition skips a `fro-bot`-authored goal), `scripts/dispatch-flows.test.ts` (a `fro-bot` checklist on a `fro-bot` goal seeds on the operator's label), `scripts/gateway-rollout-tracker-workflow.test.ts`, `packages/status-truth/src/rollout-tracker-snapshot.test.ts`

**Approach:**
- The skill's start step accepts or declines the offer with a reason and writes the config entry with `domain`; it stops at the PR as today.
- Preflight lists `goal_batches` to open: the first batch once every part issue exists (repositories without Part 0), then one batch per repository whose Part 0 pull request merged. A batch whose keyed goal, checklist comment and Project item all exist is not listed again; any other batch stays listed.
- The tracker's goal duty validates every checklist line first, then opens each listed goal as `fro-bot` with the batch key in its body and one checklist comment, each line `owner/repo: <exact ask for this repository>. Brief: program-domains.json@<sha>#<domain>. Part issue: <url>` under 4,000 characters, adds the goal to the Project and links it on the tracker. A line over the limit stops that batch with a reason on the tracker before anything is written.
- A re-run reuses an existing keyed goal and writes only the missing checklist comment or Project item.
- The operator approves each goal with `dispatch-approved`.

**Test scenarios:**
- Happy path: the skill text names the goal issue, the checklist format with a pinned commit, and adding the goal to the Project.
- Integration (dispatch flow): a `fro-bot` checklist on a `fro-bot`-authored goal seeds a marker when the operator applies `dispatch-approved`.
- Integration (workflow condition): the content job's planner condition is false for a `fro-bot`-authored `cross-repo-goal`.
- Happy path: preflight lists the first batch once all part issues exist; after a Part 0 merges it lists that repository's batch; a re-run with the goal, checklist and Project item all present lists nothing.
- Error path: a run that created the keyed goal but stopped before the checklist leaves the batch listed; the next run reuses the goal and posts the checklist.
- Edge case: editing the part issue's text after approval changes no dispatched prompt.
- Error path: a line over 4,000 characters stops that batch with a reason on the tracker.
- Edge case: a repository with Part 0 unmerged is in no batch.

**Verification:** Skill and workflow pins pass; the flow test proves seeding of a fro-bot-authored goal.

- [ ] **Unit 6: Observe proposes domain programs**

**Goal:** Observe turns a recurring domain-wide gap into at most one open proposal, and the operator's approval label starts the program through a small workflow.

**Requirements:** R8, R9, R10, R11

**Dependencies:** Units 1, 5

**Files:**
- Create: `.github/workflows/program-approved.yaml`
- Modify: `.github/workflows/fro-bot.yaml` (`OBSERVE_CATEGORIES` category 6, `OBSERVE_OUTPUT` attention rules), `.github/settings.yml` (`program-proposal`, `program-approved` labels), `.agents/skills/cross-repo-program/SKILL.md` (a start from a proposal), `packages/test-kit/src/workflow-expression.ts` (`.*.` object filter for the job condition test)
- Test: `scripts/fro-bot-workflow.test.ts`, `scripts/settings-labels-effective-set.test.ts`, `scripts/program-approved-workflow.test.ts`, `scripts/agent-skills.test.ts`, `packages/test-kit/src/workflow-expression.test.ts`

**Approach:**
- Category 6 reads `program-domains.json` and records a gap shared by repositories of one domain as an attention item keyed `domain:<key> — <gap>`, with the usual first-seen walk.
- On the existing three-report escalation, file a `program-proposal` issue in `fro-bot/.github` naming the domain, the gap, the repositories and the dated reports, unless one is already open. An operator-closed proposal for the key is declined; a new one requires a named material change (a new repository, a regression, a changed condition).
- The operator's `program-approved` label on a `program-proposal` issue starts the program: `program-approved.yaml` runs on `issues: labeled`, its job condition requires the label name, the sender `marcusrbrown`, an open issue by `fro-bot` carrying `program-proposal`, and its one step reads only the key line (fixed-prefix parse, the domain-key rule, a domain `program-domains.json` lists on the default branch) before it runs `gh workflow run fro-bot.yaml` with a fixed request. Any failed check dispatches nothing. The skill's start step re-checks the approval, accepts or declines (R5), puts the proposal URL in the start PR body and closes the proposal naming the tracker, or closes it as already covered when a program covers the domain. A decline comments the reason and leaves the proposal open; a failed run leaves it open for the operator to reapply the label.

**Test scenarios:**
- Happy path: pins for the key form, the one-open rule, the decline rule and the material-change rule; the workflow's job condition and its step shell, run with a stubbed `gh`.
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
- Offer the program; Part 0 in the six repositories whose dispatched prompt does not reach a pull request (systematic, space-bus, metacogs, opencode-copilot-delegate, dev-like, mothership; dashboard needs none); then parity dispatches.
- Record per part: answer, pull request, outcome; whether an answer avoided rework; operator actions counted.
- Observe at the pilot's first live start, accepted as known retry cases of a start from a proposal (Unit 6): (a) a run that creates the tracker issue and fails before the start pull request, where a retry's body search may miss the new tracker (search indexing lags) and create a second one; (b) a Project created but not yet recorded in the tracker body, which a retry treats as missing and recreates. The worst case of either is a duplicate tracker issue or Project to delete. Nothing dispatches before the start pull request merges and the operator applies `dispatch-approved`, so neither can send work to a repository. Record whether either happened.

**Test expectation:** none -- live operational unit; evidence is the tracker, the pull requests and the run links recorded here.

**Verification:** Every part answered; every accepted part merged or a recorded no-op; counts recorded.

**Results (2026-11-27, inventory before the first dispatch):**
- Seven repositories, not three or four, and the agent is pinned at v0.150.0 (by commit SHA, version in a comment) in all seven, not v0.148.0. The inventory section above is the 2026-11-25 state.
- Dispatch routing: only `fro-bot/dashboard` routes a dispatched prompt to a branch and pull request (`branch-pr`). The other six resolve it to a discarded working directory, or keep it comment-only (systematic, by a documented contract), so Part 0 is needed in all six, not two. Part 0 now covers six repositories; the requirements document (R19) keeps its original two-repository wording.
- Part 0 is operator-authored in all six: an agent cannot change `.github/**` from an issue or comment event, because `.github/**` is outside the brokered-push allowlist and no repository adds it. A `branch-pr` run can deliver workflow changes (evidence: #3880, systematic#1038). Whether `branch-pr` shares the brokered-push allowlist stays to be observed on Part 0 itself.
- Brief reworded so each standard is checkable against repository state: the model standard no longer names this repository's composite, `repo-skills` applies only where `.agents/skills/` exists, Renovate Approve only where the Renovate config enables automerge, the pin is by commit SHA with the version in a comment. One recorded exception: `marcusrbrown/systematic`, whose release-notes prompt dispatch stays comment-only by contract.
- Non-blocking (#4355): a goal with its full checklist but missing from the Project can be reattached and shown awaiting approval with fewer repos than its checklist; watch at the pilot.

## System-Wide Impact

- **Interaction graph:** dispatch receipts, the tracker snapshot, the start skill and Observe's attention list all change; #3512 must behave exactly as today.
- **Error propagation:** per-part unknown is new and limited to domain programs; dispatch keeps its fail-closed gates.
- **State lifecycle risks:** a parity item posted after Part 0 is a new checklist item; an approval fingerprint never covers it until the operator labels again.
- **Unchanged invariants:** existing goals' receipt semantics, #3512's hash and bootstrap text, the planner for operator-authored goals, `dispatch-approved` as the only dispatch gate.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| A target agent ignores the part issue protocol | The tracker shows no answer as stalled after 3 days; Unit 7 records it |
| An issue path can't open a workflow-changing PR (confirmed for all six Part 0 repositories, 2026-11-27) | R19 fallback: the operator authors Part 0 in each |
| Hash change wakes #3512 | Domain-only evidence; golden hash test |
| Status-truth importing dispatch breaks the package graph | Declared dependency and lock entry, no reverse import; layout test in Unit 3 |
| A retried start from a proposal creates a second tracker or Project (the tracker's body search misses a just-created issue, or the Project was not yet recorded in the body) | Accepted for the pilot; observed at Unit 7's first live start. Worst case is a duplicate to delete: nothing dispatches before the start pull request merges and `dispatch-approved` |

## Sources & References

- **Origin document:** `docs/brainstorms/2026-11-25-foreman-domain-programs-requirements.md`
- Related past work: `docs/plans/2026-11-08-002-feat-cross-repo-program-tracker-plan.md`, recorded complete (this plan adds domains, answers and dispatch linking); `docs/plans/2026-07-04-001-feat-cross-repo-dispatch-loop-plan.md`, recorded complete (this plan adds two receipt statuses); `docs/plans/2026-11-08-003-feat-actionable-attention-list-plan.md`, recorded complete (this plan reuses its key and escalation rules).
- Related issues: #3512, #3633, #3640, #4050
