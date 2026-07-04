---
date: 2026-07-04
topic: a3-cross-repo-dispatch
title: Cross-repo planning and agent dispatch (A3 v1)
---

# Cross-repo planning and agent dispatch (A3 v1)

## Summary

Give Fro Bot its first goal-level coordination surface: the operator states a goal that spans managed
repos in a coordination issue; an agent run proposes a per-repo work-item decomposition into that
issue; the operator approves; a dispatch loop launches one agent run per approved item in the target
repos and tracks completion back on the issue until close. Planning is agent-proposed and
human-approved; dispatch is registry-gated, sequential, and bounded. A3 composes existing
surfaces — the reusable agent workflow, cross-repo `workflow_dispatch`, the managed-repo
registry, and the tracker-snapshot pattern — and adds no new agent authority.

---

## Problem Frame

Every transport primitive for cross-repo work already exists: the reusable `fro-bot.yaml`
agent surface, owner-scoped App-token dispatch (reconcile, invitations), the registry of repos
carrying the workflow, and snapshot bookkeeping over multi-repo state (rollout tracker). What
does not exist is anything that takes a goal spanning repos, decomposes it into per-repo work,
dispatches agents against those repos, and drives the items to completion. Today that
coordination lives in the operator's head and gets re-typed into N separate prompts.

The north-star names this A3 and rates it high-risk. The risk is concentrated in autonomy
posture, not transport — so v1 climbs the same earned-autonomy ladder every prior loop used:
propose → approve → act, with the human gate on dispatch.

---

## Actors

(The slice is A3; actors are named to avoid colliding with that label.)

- **Operator**: states goals, edits and approves decompositions, reviews the resulting PRs. The
  sole approval authority.
- **Planner** (Fro Bot planning run): proposes the per-repo work-item decomposition on the
  coordination issue via the existing mention-triggered agent surface.
- **Control loop** (deterministic control-plane script + its workflow): validates approval,
  dispatches one agent run per item, snapshots completion state back to the issue.
- **Worker** (Fro Bot per-repo runs): ordinary agent runs executing individual items — existing
  surface, unchanged.

---

## Key Flows

- F1. Goal → proposed decomposition
  - **Trigger:** The operator opens a coordination issue (label `cross-repo-goal`) describing the goal and
    mentions `@fro-bot`.
  - **Actors:** A1, A2
  - **Steps:** The mention-triggered agent run reads the goal, the managed-repo registry, and
    relevant repo context, then posts a decomposition comment: a per-repo work-item checklist
    (target repo + item prompt) plus a hidden state marker. It never dispatches anything.
  - **Outcome:** A reviewable, editable plan artifact on the issue.
  - **Covered by:** R1, R2, R3, R12
- F2. Approval → dispatch
  - **Trigger:** The operator applies the approval label. A dedicated control-plane workflow reacts to
    the `issues.labeled` event.
  - **Actors:** Operator, Control loop
  - **Steps:** The control loop verifies the labeling actor is the operator, snapshots the approval
    fingerprint (hash of the bot-authored decomposition marker at label time), validates every
    target against the registry gate, then dispatches one agent run per item (sequential,
    per-item marker persistence, bounded per run), and posts a counts-only summary.
  - **Outcome:** Worker runs launched in target repos; the issue is the dispatch ledger.
  - **Covered by:** R4, R5, R6, R7, R8, R13, R14, R15
- F3. Tracking → completion
  - **Trigger:** Scheduled snapshot (and manual dispatch). Scheduled runs only track — they
    never dispatch new items.
  - **Actors:** Control loop
  - **Steps:** The loop resolves each dispatched item's terminal state by the precedence table
    (R9), updates the checklist/marker idempotently, and when every item is terminal, closes the
    issue with a summary comment.
  - **Outcome:** Goal state is always visible on the issue; completion is machine-derived.
  - **Covered by:** R9, R10, R11
- F4. Post-approval edit
  - **Trigger:** The checklist is edited after the approval label was applied.
  - **Actors:** A1, A3
  - **Steps:** The control loop detects the fingerprint mismatch, refuses to dispatch the
    changed set, removes the approval label, and comments that re-approval is required.
  - **Outcome:** Only the exact reviewed set is ever dispatched.
  - **Covered by:** R5
- F5. Failed-item recovery
  - **Trigger:** After the goal issue closed with a failed/blocked item, the operator reopens the
    issue, edits the checklist to correct the item, and re-applies the approval label.
  - **Actors:** Operator, Control loop
  - **Steps:** Reopening is required before re-approval; the corrected checklist yields a new
    fingerprint, and the control loop dispatches only items not already terminal-succeeded under
    the new fingerprint.
  - **Outcome:** Recovery has a defined path; a closed issue never self-dispatches.
  - **Covered by:** R10b

---

## Requirements

**Planning (proposal-shaped)**

- R1. Decomposition is produced by the existing mention-triggered agent surface on the
  coordination issue; the planning run has no dispatch capability and no new permissions.
- R2. The decomposition artifact is a per-repo work-item checklist in an issue comment: each
  item names exactly one target repo and one item prompt, plus a hidden machine-readable
  marker (item ids, targets, fingerprint) following the existing hidden-marker conventions.
- R3. The operator can edit items freely before approval; the artifact is the review surface.

**Dispatch (human-gated, registry-bounded)**

- R4. Dispatch is triggered only by the `issues.labeled` event adding the approval label, and is
  performed by a dedicated control-plane workflow + deterministic script (pure planner + serial
  side effects), never by the planning agent run and never by a scheduled run. The control loop
  verifies the labeling actor is `marcusrbrown`; an approval label applied by any other actor is
  refused (label removed, counted) — the label alone is not authority.
- R5. Dispatch binds to an immutable approval fingerprint: at label time the control loop hashes
  the bot-authored decomposition marker and stores that hash as the approval record. It
  dispatches exactly the item set matching that hash. Any post-approval edit to the checklist
  produces a different current hash, so the mismatch invalidates approval (label removed,
  re-approval required). The dispatch step re-reads and re-compares the stored hash immediately
  before each item dispatch, so an edit mid-loop halts further dispatch.
- R6. Every dispatch target must pass the registry gate: present in `metadata/repos.yaml` with
  `has_fro_bot_workflow: true` and definitively public (private or indeterminate targets fail
  closed and are counted). v1 is owner-repos-only (`fro-bot/*`, `marcusrbrown/*`); the contrib
  allowlist path is explicitly out of v1. Targets failing the gate are marked blocked on the
  checklist, never dispatched. A target that flips private between approval and dispatch fails
  the gate re-checked at dispatch time and is blocked, not dispatched.
- R7. Dispatches are sequential with a per-run cap; dispatched state is persisted to the marker
  **per item, immediately after each successful dispatch**, so a crash-resume skips any item
  already marked dispatched under the active fingerprint (each item dispatches at most once per
  approval). No auto-retry in v1 — a failed item is terminal-failed until recovery (F5).
- R8. Worker runs are ordinary per-repo agent runs via the existing reusable workflow with the
  item prompt; A3 grants them no authority beyond what those runs already have. Item prompts are
  bound by a v1 safety policy: bounded length, no embedded credential/secret patterns, no
  private repo identifiers, and nothing dispatches whose target/prompt the control loop cannot
  parse from the trusted marker. The human approval step is the primary injection mitigation;
  the policy is defense-in-depth against a mistaken approval.
- R14. The control loop mints a least-privilege token scoped at mint time to exactly the target
  repo(s) of the approved set (`actions: write` for dispatch only), job-scoped lifetime, no
  long-lived reusable credential. A per-goal mint bounds blast radius to the approved targets.

**Tracking and lifecycle**

- R9. Each item resolves to exactly one terminal state by a fixed precedence table, machine-
  derived and recorded on the issue:
  - `blocked` — failed the registry gate; never dispatched.
  - `failed` — dispatched, worker run concluded failure, OR the run produced PRs that all closed
    unmerged.
  - `completed` — dispatched, worker run concluded success AND (produced no PR — a no-op success
    where the agent decided no change was needed — OR produced at least one PR that merged). If a
    run produces multiple PRs, the item is terminal only when all its PRs are terminal; it is
    `completed` if at least one merged, else `failed`.
  - `dispatched` (non-terminal) — awaiting run conclusion / PR resolution.
  Precedence when signals conflict: gate-block > run-failure > PR-outcome > run-success.
- R10. When all items are terminal (`completed`, `failed`, or `blocked`), the loop posts a
  counts-only summary and closes the issue; a goal with any non-terminal item stays open.
- R10b. A closed goal issue never self-dispatches. Recovery requires reopening the issue first
  (F5); an approval label on a closed issue is inert until it is reopened. On reopen and
  re-approval, the new fingerprint governs and items already `completed` under a prior
  fingerprint are not re-dispatched.
- R11. Snapshot updates are idempotent (marker-hash gated, tracker-snapshot pattern): unchanged
  state produces no comment/edit churn.
- R15. The control loop trusts only markers in comments authored by the bot/control-plane
  identity (the `selectLatestMarkerCommentBody` author-filter pattern); user-authored comments
  containing marker-like content are ignored for state, fingerprinting, and completion. A given
  target repo is touched by at most one goal's dispatch at a time: overlapping approved goals
  sharing a target serialize on it (the colliding item defers, counted), so two goals never
  launch concurrent worker runs into the same repo.

**Privacy and telemetry**

- R12. Coordination issues, decomposition comments, and all A3 output live in this repo and are
  public surfaces: no private repo identifiers ever appear in items, markers, comments, or
  summaries. Private targets are structurally excluded by R6.
- R13. Loop telemetry is counts-only (proposed, approved, dispatched, blocked, completed,
  failed); workflow summaries carry no item prompts or repo lists beyond what the public issue
  already shows.

---

## Acceptance Examples

- AE1. **Covers R1–R3.** Given a labeled goal issue mentioning the bot, when the planning run
  completes, the issue has a decomposition comment with a per-repo checklist and hidden marker,
  and nothing was dispatched.
- AE2. **Covers R4–R6, R8.** Given the operator applies the approval label to a three-item plan whose
  targets all pass the registry gate, when the dispatch loop runs, exactly three worker runs
  are dispatched sequentially and the marker records all three as dispatched.
- AE3. **Covers R5.** Given the checklist is edited after approval, when the dispatch loop
  runs, nothing dispatches, the approval label is removed, and a re-approval comment is posted.
- AE4. **Covers R6.** Given one item targets a repo without the Fro Bot workflow (or a private/
  indeterminate one), when the loop runs, that item is marked blocked, the rest dispatch, and
  the blocked count increments.
- AE5. **Covers R7.** Given a dispatched item's worker run fails, when the snapshot runs, the
  item shows terminal-failed and no automatic re-dispatch ever occurs for that fingerprint.
- AE6. **Covers R9–R11.** Given all items reach terminal state, when the snapshot runs, the
  issue closes with a counts-only summary; an identical follow-up snapshot produces no edits.
- AE7. **Covers R12–R13.** Given any A3 run, when its outputs render (issue, marker, workflow
  summary), no private repo identifier appears anywhere.
- AE8. **Covers R4.** Given the approval label is applied by an actor other than the operator, when
  the control loop runs, it dispatches nothing, removes the label, and counts the refusal.
- AE9. **Covers R7 (crash resume).** Given the loop dispatched item 1 of 3 and crashed before
  item 2, when it restarts on the same fingerprint, item 1 is skipped (already marked) and only
  items 2–3 dispatch — no duplicate run for item 1.
- AE10. **Covers R14.** Given a two-target approved set, when the control loop mints its token,
  the token is scoped to exactly those two repos with `actions: write` only.
- AE11. **Covers R15 (marker trust).** Given a non-bot comment contains a spoofed marker with a
  different fingerprint, when the loop reads state, it ignores the spoofed marker and uses only
  the bot-authored one.
- AE12. **Covers R10b.** Given a closed goal with a corrected checklist, when the operator re-applies
  the label without reopening, nothing dispatches; after reopening + re-approval, only the
  non-completed items dispatch under the new fingerprint.
- AE13. **Covers R15 (serialization).** Given two open goals both target the same repo, when
  both are approved, the second goal's item for that repo defers until the first goal's item is
  terminal — never concurrent.

---

## Success Criteria

- One real multi-repo goal (e.g. a config or convention rollout across 3+ managed repos) goes
  goal → proposal → approval → dispatch → tracked completion → issue close without the operator
  hand-dispatching anything.
- The approval gate provably binds: no dispatch has ever occurred without the label on the
  exact fingerprinted set.
- Worker-run outcomes are visible on the coordination issue without visiting the target repos.

---

## Scope Boundaries

- No autonomous dispatch: the approval label (actor-bound to the operator) is the only trigger; no
  graduation path is designed in v1 (that's a later slice with its own review, mirroring the
  bounded-PR arc).
- No cross-item dependency ordering: items are independent; sequential dispatch is an
  implementation detail, not a DAG. Goals needing ordered phases use multiple goals.
- No private-repo targets, and no contrib-org (non-owner) targets in v1 — owner repos only.
- No retry/self-healing of failed worker runs.
- No new agent permissions and no gateway involvement. Target-repo `fro-bot.yaml` may need a
  small, reviewed `workflow_dispatch` input extension to accept a per-item prompt (deferred
  question); if so, that extension is in scope, but no change to the agent action's authority.
- No LLM in the dispatch loop: planning is the only model-touching step; the loop is
  deterministic control-plane TypeScript.

---

## Threat Model (v1)

- **Public, attacker-writable surface.** The goal issue and any comment are writable by anyone
  who can comment. Mitigations: state is read only from bot-authored markers (R15); the planner
  has no dispatch capability (R1); dispatch requires an operator-applied label (R4) bound to an
  immutable fingerprint of the bot marker (R5).
- **Prompt injection → cross-repo execution.** A hostile item prompt, if approved, would run an
  agent with write authority in a target repo. Mitigations: human approval gate (R4), item-prompt
  policy (R8), owner-repos-only targets (R6), least-privilege per-target mint (R14). Residual risk
  (accepted, documented): the operator is a single high-trust reviewer; a careless approval is the
  remaining hole, which is why v1 stays owner-repos-only and proposal-shaped.
- **Label spoofing / self-approval.** Actor-bound approval (R4) rejects labels not applied by
  the operator. Residual: anyone with triage can *apply* the label, but the actor check refuses it.

## Key Decisions

- **Propose → approve → act, again:** planning autonomy without dispatch autonomy. The agent
  writes plans; only the operator's label moves the world. Matches the posture ladder of every
  shipped loop (proposals → disarmed PR machinery → graduation-by-signal).
- **Coordination issue as the artifact:** visible, editable, commentable, closeable — and the
  tracker-snapshot pattern already proves issues work as machine-readable multi-repo ledgers.
- **Fingerprint-bound approval:** approval attaches to bytes, not vibes — post-approval edits
  structurally cannot ride an old approval (the TOCTOU lesson from the repair loop applied to
  human gates).
- **Registry as the blast-radius boundary:** dispatch eligibility is data (`repos.yaml`), not
  code — growing A3's reach is a metadata change with existing review gates. v1 is
  owner-repos-only; contrib-org targets are a later slice once the approval/dispatch chain is
  battle-tested.
- **Approval binds to bytes and to an actor:** the label is necessary but not sufficient — the
  applying actor must be the operator, and the approval hashes the exact bot-authored marker, so
  neither a spoofed label nor a post-approval edit can move the world.
- **Composition over construction:** the only new machinery is the dispatch/tracking script and
  its workflow; planner runs, worker runs, tokens, and the registry are all existing surfaces.

---

## Dependencies / Assumptions

- The mention-triggered agent surface can be prompted (via persona/context wiring) to emit the
  decomposition format reliably; malformed decompositions are a planning-quality issue the operator
  catches at review, not a safety issue (nothing dispatches unapproved).
- Cross-repo `workflow_dispatch` of target-repo `fro-bot.yaml` works with an owner-scoped App
  token for owner repos (proven by reconcile/invitation dispatch); contrib-org targets may need
  the allowlist probe pattern.
- Worker-run → PR linkage for completion signals is derivable (run conclusion via Actions API;
  PR linkage via branch/marker conventions) — exact mechanism is a planning-phase decision.
- Assumption (labeled): per-item `workflow_dispatch` inputs (item prompt) fit the existing
  target-repo workflow's dispatch contract; if target workflows only accept the standard
  trigger set, the dispatch shape may need a small, reviewed extension to `fro-bot.yaml`
  consumers — surfaced during planning, contradicting "no changes" only if proven necessary.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R9][Technical] Dispatch→run→PR correlation contract: the control loop writes a
  dispatch-epoch + goal/item id into the `workflow_dispatch` inputs and correlates the resulting
  run by `createdAt > epoch` (existing pattern); the run→PR link is by a marker the worker writes
  into its PR body (or a head-branch convention). Pin the exact keys in planning — feasibility
  confirmed the epoch pattern exists but the PR-link key is unproven.

### Deferred to Planning

- [Affects R2][Technical] Exact marker schema and checklist grammar (reuse rollout-tracker
  marker conventions vs status-truth fingerprint style).
- [Affects R8][Technical] Whether target-repo `fro-bot.yaml` accepts a per-item prompt via
  `workflow_dispatch` as-is, or needs a small reviewed input extension (feasibility flagged the
  bottom-of-doc assumption as load-bearing).
- [Affects R13][Technical] Result JSON shape, mirroring the status-truth counts pattern.

---

## Sources / Research

- North-star A3 definition: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`
- Transport primitives: `.github/workflows/fro-bot.yaml`, `scripts/reconcile-repos.ts`
  (dispatch planner + gates), `scripts/handle-invitation.ts` (node_id-only dispatch),
  `metadata/repos.yaml`, `metadata/allowlist.yaml`
- Tracking pattern: `scripts/rollout-tracker-snapshot.ts`
- Posture prior art: `docs/brainstorms/2026-06-26-a2-self-maintenance-portfolio-requirements.md`
  (proposal-first ladder), `docs/brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md`
  (arming/graduation model), `docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md`
  (commit-before-dispatch, sequential dispatch, trusted-owner gates)
