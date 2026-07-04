---
title: 'feat: Cross-repo planning and agent dispatch (A3 v1)'
type: feat
status: complete
completed: 2026-07-04
date: 2026-07-04
origin: docs/brainstorms/2026-07-04-a3-cross-repo-dispatch-requirements.md
---

# feat: Cross-repo planning and agent dispatch (A3 v1)

## Overview

Give Fro Bot its first goal-level coordination surface. The operator opens a coordination issue
describing a goal spanning owner repos and mentions the bot; a planning agent run proposes a
per-repo work-item decomposition as a bot-authored marker comment; the operator approves by labeling;
a dedicated `issues.labeled` control-plane workflow (actor-bound to the operator) dispatches one worker
agent run per approved item into the target repos and tracks each item to a terminal state on the
issue, closing it when all items settle. Planning is agent-proposed and human-approved; dispatch
is registry-gated, fingerprint-bound, per-item-persisted, and owner-repos-only. A3 composes
existing surfaces (reusable agent workflow, `workflow_dispatch`, the managed-repo registry, the
tracker-snapshot pattern) and grants no new agent authority.

## Problem Frame

Every transport primitive for cross-repo work exists; no planning/coordination layer does. Today
The operator re-types a multi-repo goal into N separate prompts and tracks completion by hand. The
north-star names this A3 (high-risk). The risk is autonomy posture, not transport, so v1 climbs
the same propose → approve → act ladder every prior loop used, with the human gate on dispatch.
See origin: `docs/brainstorms/2026-07-04-a3-cross-repo-dispatch-requirements.md`.

## Requirements Trace

R1 (planner has no dispatch capability), R2 (bot-marker decomposition artifact), R3 (editable
before approval), R4 (`issues.labeled`, actor-bound to the operator (`marcusrbrown`), control-plane script),
R5 (immutable fingerprint of the bot marker, re-checked per dispatch), R6 (registry gate,
owner-only, fail-closed), R7 (sequential, per-item persistence, no auto-retry), R8 (existing
reusable workflow + item-prompt safety policy), R9 (terminal-state precedence table), R10/R10b
(close-on-terminal; reopen-before-reapprove), R11 (idempotent snapshots), R12 (public-surface
privacy), R13 (counts-only telemetry), R14 (least-privilege per-target mint), R15 (bot-marker
trust + same-target serialization).

## Scope Boundaries

- Owner repos only (`fro-bot/*`, `marcusrbrown/*`); no private targets, no contrib-org targets.
- No autonomous dispatch (label is the only trigger); no graduation path in v1.
- No cross-item dependency ordering (independent items; sequential is an impl detail).
- No retry/self-healing of failed worker runs.
- No new agent permissions; no gateway involvement; no LLM in the control loop.

### Deferred to Separate Tasks

- Contrib-org targets (needs the allowlist path + its own review).
- A graduation/arming path toward reduced approval friction.
- Cross-item DAG ordering.

## Context & Research

### Relevant Code and Patterns

- `scripts/rollout-tracker-snapshot.ts` — REUSE: marker `<!-- <prefix>:{json} -->`
  (`MARKER_PREFIX`), `extractPreviousMarker(body)`, `selectLatestMarkerCommentBody(comments)`
  (author-filter: `FROBOT_COMMENT_AUTHORS.has(login) && extractPreviousMarker !== null`,
  `findLast`), and the hash idempotency gate (`decideComment` → `should_comment:false` when
  `hash === previousMarker.hash`). Backs R2/R11/R15.
- `scripts/wiki-lint-issues.ts` — REUSE: issue lifecycle octokit calls (`issues.create`,
  `issues.createComment`, `issues.update{state}`), fingerprint marker, close-on-clear. Backs
  the coordination-issue lifecycle (R10).
- `scripts/reconcile-repos.ts` — REUSE: `createWorkflowDispatch({owner, repo, workflow_id,
  ref, inputs})` (`:2591-2602`); the fail-closed public gate `accessPrivateForStorage` (`:1185`)
  and `entry.private` semantics. Backs R6 dispatch + gate.
- `scripts/handle-invitation.ts` — REUSE: `createWorkflowDispatch` with `node_id`-only inputs
  (`:246`), privacy-refresh fail-closed. Pattern for the dispatch payload.
- `scripts/schemas.ts` — `RepoEntry` shape: `has_fro_bot_workflow: boolean` (required),
  `private?` (optional, fail-safe). Backs the registry read.
- `.github/workflows/fro-bot.yaml:4-28` — CONFIRMED: target-repo workflow already accepts
  `workflow_dispatch` with a `prompt` input. The item prompt dispatches through the existing
  contract — no agent-surface change needed for owner repos (dissolves the origin's R8
  "reviewed extension" assumption).
- `.github/workflows/status-truth.yaml:205-216,368-378` — REUSE: repo-scoped App-token mint
  (`repositories:` + `permission-*`) for R14 least-privilege dispatch mint.
- `.github/workflows/reconcile-repos.yaml:26-36` — owner-installation mint (contrast; too broad
  for R14, kept only where owner-wide is required).
- Tests: `rollout-tracker-snapshot.test.ts` (marker fixtures, author-login accept/reject incl.
  `marcusrbrown`), `wiki-lint-issues.test.ts` (octokit mock stubbing create/createComment/
  update) — fixture patterns for the A3 suite.

### Institutional Learnings

- `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`:
  planner/shell independence, never trust untrusted text — the control loop trusts only its own
  bot marker (R15).
- `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md`: mint the
  write token in the job that writes, scoped at mint time (R14).
- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`: enumerate every
  public surface for identity leaks (R12/R13).
- `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md`:
  recover machine state from markers, not free text, against a closed vocabulary.
- `docs/solutions/workflow-issues/jq-falsy-coalesce-trap-in-shell-gates-2026-05-17.md`: the
  `issues.labeled` gate compares booleans/strings correctly (numeric-vs-boolean lesson).

### Known constraints (memory)

- Cross-repo `create-github-app-token` must pass `owner` (or explicit `repositories`) or it only
  sees the calling repo (memory 4815). R14 mint passes `repositories:` = approved targets.
- `createWorkflowDispatch` requires the target ref to exist and the workflow to have a
  `workflow_dispatch` trigger — satisfied by `fro-bot.yaml`.
- Commit identity: the control loop writes issue comments as the bot App identity; no repo commits
  in this feature (dispatch + issue I/O only).

## Key Technical Decisions

- **Run correlation by unique token, not epoch-alone.** Epoch+actor+workflow filtering
  false-matches a coincidental non-A3 `fro-bot.yaml` run in the target repo. Instead the control
  loop passes a unique `correlation-id` (goal+item+nonce) as a `workflow_dispatch` input; the
  target run echoes it into its run-name (via the existing workflow's `run-name:` or an early
  step that sets it), and `runTrack` identifies the exact run by that id — epoch is only a
  coarse pre-filter. This requires the target `fro-bot.yaml` to surface the correlation id in a
  queryable field; if it cannot today, that is the one reviewed target-workflow addition v1
  needs (a `run-name` suffix), scoped in Unit 5.
- **Completion = run-conclusion-primary, bot-authored-PR refinement.** v1's hard terminal signal
  is the worker run's conclusion (identified by correlation-id above). The item prompt embeds the
  same opaque id and instructs the worker to reference it in any PR it opens; the tracker refines
  run-success into merged/closed-unmerged **only for a PR authored by the bot/worker identity**
  carrying the id — a third party forging a PR with the token cannot spoof completion (author
  check required). A run that concludes success with no bot-authored tagged PR resolves to
  no-op-success = `completed` (R9). PR-tag linkage is best-effort refinement, never the sole
  terminal gate.
- **Pure core / thin shells, four modules.** `scripts/cross-repo-dispatch.ts` hosts the pure
  planner (decomposition parse, registry gate, fingerprint, terminal-state resolver, snapshot
  decision) + two thin shells (`runDispatch` for the labeled event, `runTrack` for the snapshot).
  Planner never does I/O; shells never re-derive policy. Mirrors the status-truth split.
- **Bot-marker as the only state source.** All state (item set, fingerprint, per-item dispatch
  status, terminal states) lives in a single bot-authored marker comment on the coordination
  issue, read via the `selectLatestMarkerCommentBody` author-filter. User comments are inert
  (R15). The marker schema is a closed-vocabulary JSON (item ids, targets, prompts-hash,
  fingerprint, per-item status) — never free text.
- **Fingerprint = hash of the bot decomposition marker at label time.** `runDispatch` computes
  the current marker hash on the labeled event, stores it as the approval record in the state
  marker, and re-reads+re-compares before each item dispatch (R5). Any edit (which, being a
  human edit of the bot comment, changes the bytes) mismatches → halt + label removal.
- **Two-phase dispatch persistence (intent → confirm).** A dispatch-then-persist-fail window
  duplicates runs. So the shell writes an `intent` record (item id + correlation-id + nonce)
  to the marker **before** `createWorkflowDispatch`, then flips it to `dispatched` (+ epoch)
  after. On resume: an item in `dispatched` is skipped; an item in `intent` is reconciled by
  querying the target repo for a run carrying its correlation-id — if found, flip to
  `dispatched` (no re-dispatch); if not found within a grace window, it is safe to dispatch
  under the same nonce. This closes the split-brain window (R7, AE9). Serial, bounded per run.
- **Actor-bound labeled trigger, gated in workflow AND script.** A new
  `cross-repo-dispatch.yaml` triggers on `issues.labeled`; a first job step gates on
  `github.event.label.name == '<approve-label>'` AND `github.event.sender.login ==
  'marcusrbrown'` (boolean-safe comparison), removing the label + exiting counted otherwise.
  The mint step runs only AFTER that gate passes — a refused event never mints a cross-repo
  token. Defense-in-depth: `runDispatch` re-reads `sender.login` from the event payload and
  refuses before any dispatch, so a workflow misedit/misfire cannot bypass the actor bind (R4,
  AE8).
- **Least-privilege per-target mint.** The dispatch job mints an App token with
  `repositories:` = the approved target set and the narrowest scope that permits
  `createWorkflowDispatch` (`actions: write`), job-scoped (R14, AE10). No owner-wide mint.
- **Same-target serialization.** Before dispatching an item, the planner checks all other open
  goal markers for an in-flight (`intent`/`dispatched`, non-terminal) item targeting the same
  repo; if found, the colliding item defers (counted), never concurrent (R15, AE13).
- **Single-writer marker discipline (compare-and-swap).** The labeled dispatch job and the
  scheduled track job both write the same marker → lost-update risk. Every marker write
  re-reads the latest bot marker immediately before writing and aborts+retries on hash mismatch
  (optimistic CAS on the marker's own hash, the field the idempotency gate already computes).
  Bounded retries; a persistent mismatch defers to the next run rather than clobbering. This is
  the concurrency guard for both shells sharing one marker.
- **Bounded marker size.** The marker stores only latest per-item state (status, epoch,
  correlation-id) — never history; superseded epochs are overwritten, not appended. A hard
  item-count cap per goal (checked at decomposition parse, Unit 1) keeps the serialized marker
  well under GitHub's 65536-char comment limit; goals exceeding the cap are rejected at parse
  with a comment asking the operator to split the goal.
- **Owner-only registry gate, fail-closed.** Reuse `accessPrivateForStorage`/`entry.private`
  semantics: a target dispatches only if it's in `repos.yaml`, `has_fro_bot_workflow: true`,
  owner ∈ {`fro-bot`, `marcusrbrown`}, and definitively public; else `blocked`, counted (R6, AE4).
  Re-checked at dispatch time (privacy-flip safety). `has_fro_bot_workflow: false` is a
  first-class `blocked` reason distinct from a policy block, so the checklist tells the operator
  "target not onboarded" vs "target ineligible" — several owner repos currently carry
  `has_fro_bot_workflow: false` and must surface as an actionable rollout gap, not a silent drop.
- **Reopen recovery forces a fresh label event.** Recovery (F5/R10b) needs an `issues.labeled`
  event, but a reopened issue may still carry the approve label (no new event fires). The
  control-plane workflow adds an `issues.reopened` handler that removes the approve label and
  clears the approval record from the marker, so the operator's re-apply is guaranteed to emit a fresh
  `labeled` event under a new fingerprint. A closed issue's label is inert until reopened.

## Open Questions

### Resolved During Planning

- Target `fro-bot.yaml` accepts a `prompt` `workflow_dispatch` input today → no agent-surface
  change for owner repos except possibly a `run-name` suffix to surface the correlation-id.
- Run correlation keys on a unique correlation-id echoed into the run-name (epoch is a
  pre-filter only); PR linkage is a bot-authored-PR refinement, never a closure gate.
- Marker/author-filter/hash-gate all reuse `rollout-tracker-snapshot.ts` primitives; every write
  is compare-and-swap to serialize the two shells.
- Track job needs `actions: read` + `pull-requests: read` on targets; dispatch job needs
  `actions: write`; both minted after their gates.

### Deferred to Implementation

- Exact marker JSON field names, the correlation-id/nonce format, the item-count cap value, and
  the approve/`cross-repo-goal` label strings (register in `.github/settings.yml`).
- Result JSON shape for counts (mirror status-truth).
- The precise `run-name` echo format if the target-workflow change is needed.

## Implementation Units

- [x] **Unit 1: Marker schema, decomposition parser, fingerprint — pure**

**Goal:** The closed-vocabulary state marker and its parse/serialize/fingerprint core.

**Requirements:** R2, R5, R12, R13, R15 (marker trust)

**Dependencies:** None

**Files:**
- Create: `scripts/cross-repo-dispatch.ts`
- Create: `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- Define the marker: `<!-- cross-repo-dispatch:{json} -->` with a strict schema — goal id, items
  (`{id, target, promptHash, status}`), approval fingerprint, per-item epochs. Reuse the
  `MARKER_PREFIX` + `extractPreviousMarker` shape from `rollout-tracker-snapshot.ts`.
- `parseDecomposition(commentBody)`: parse a planner-proposed checklist into items against the
  closed vocabulary; unrecognized content → parse error (no items), never free-text passthrough.
- `computeApprovalFingerprint(markerState)`: stable hash of the item set (targets + promptHash),
  matching the rollout-tracker hash discipline.
- `selectStateMarker(comments)`: author-filtered latest bot marker (reject non-bot authors incl.
  `marcusrbrown`).
- Privacy: item targets/prompts are owner-repo-only by construction; the marker carries no
  private identifiers (nothing private can be a target, R6).

**Test scenarios:** marker round-trip; author-filter rejects a spoofed non-bot marker (AE11);
fingerprint stable under reorder-invariance decision (pin: order-sensitive or -insensitive —
choose order-insensitive so cosmetic reordering doesn't invalidate approval); parse error on
malformed checklist; no free text enters item fields.

**Verification:** `pnpm vitest run scripts/cross-repo-dispatch.test.ts` green; pure (no octokit).

- [x] **Unit 2: Planner — registry gate, terminal-state resolver, snapshot decision — pure**

**Goal:** All dispatch/track policy as pure functions over marker state + inputs.

**Requirements:** R6, R9, R10, R10b, R11, R15 (serialization)

**Dependencies:** Unit 1

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`, `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- `gateTarget(entry)`: owner ∈ {fro-bot, marcusrbrown} AND `has_fro_bot_workflow` AND
  definitively-public (reuse `accessPrivateForStorage`/`entry.private`); else `blocked`.
- `resolveItemTerminalState({runConclusion, prs})`: the R9 precedence table
  (gate-block > run-failure > PR-outcome > run-success), returning exactly one of
  `blocked|failed|completed|dispatched`.
- `planDispatch({markerState, fingerprint, otherOpenGoals})`: which items to dispatch now
  (skip already-dispatched under fingerprint; defer same-target collisions), which are blocked.
- `planSnapshot({markerState, signals})`: updated marker + whether all terminal (→ close) +
  idempotency (no change → no write).

**Test scenarios:** owner/non-owner/private/missing-workflow gating (AE4); every R9 precedence
cell incl. no-op success=completed, multi-PR, closed-unmerged=failed; all-terminal → close;
same-target collision defers (AE13); reopen-reapprove skips prior-completed (AE12); idempotent
no-op snapshot (AE6).

**Verification:** pure; full table coverage green.

- [x] **Unit 3: Dispatch shell — actor/fingerprint gate, two-phase dispatch, CAS marker**

**Goal:** `runDispatch()` executes an approved goal on the labeled event.

**Requirements:** R4, R5, R7, R8, R14, R15 (serialization + CAS)

**Dependencies:** Units 1–2

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`, `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- Read event: label name + `sender.login`; refuse (remove label, count) unless `marcusrbrown` +
  approve label — script-side re-check independent of the workflow gate (R4).
- Compute current marker fingerprint; store as approval record. For each planned item
  (sequential): re-read+re-compare fingerprint (halt on mismatch); write `intent` (item id +
  correlation-id + nonce) via CAS; `createWorkflowDispatch` ({owner, repo, workflow_id:
  'fro-bot.yaml', ref: default branch, inputs:{prompt: itemPrompt, correlation_id}}); flip to
  `dispatched`+epoch via CAS. On resume, reconcile `intent` items by correlation-id lookup
  before any re-dispatch.
- Every marker write is compare-and-swap on the marker hash (abort+retry on mismatch, bounded).
- Item-prompt safety policy (R8): length cap, reject credential/secret patterns, owner-target
  only; unparseable item → skip, counted.
- Result JSON: counts only (proposed/approved/dispatched/blocked/deferred/refused).

**Test scenarios:** non-operator label → script refuses even if workflow gate bypassed (AE8);
happy 3-item sequential dispatch (AE2); edit-after-approval mid-loop → halt (AE3); intent
written before dispatch, crash between intent and confirm → resume reconciles by correlation-id,
no duplicate (AE9); crash after confirm → item skipped; blocked target dispatches the rest
(AE4); token mint scoped to targets asserted via injected mint (AE10); CAS mismatch → retry then
defer; no `issues.*` state write beyond the marker comment.

**Verification:** octokit-mocked shell tests (dispatch call shapes, intent-then-confirm marker
writes, CAS retry); counts-only result asserted leak-free.

- [x] **Unit 4: Tracking shell — run correlation, PR-tag refinement, close-on-terminal**

**Goal:** `runTrack()` snapshots dispatched goals to terminal and closes completed issues.

**Requirements:** R9, R10, R10b, R11, R12, R13

**Dependencies:** Units 1–2

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`, `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- For each open goal marker: identify each dispatched item's run by its `correlation-id`
  (epoch is a coarse pre-filter; the id in the run-name is the unique key — never
  epoch+actor+workflow alone); fetch run conclusion; refine via a **bot-authored** PR carrying
  the id (author check defeats forged-PR completion spoofing).
- Feed signals to `resolveItemTerminalState`; write the updated marker via CAS + idempotency
  hash gate; when all terminal, post counts-only summary + close (R10). Reopen handled by the
  workflow's `issues.reopened` step (clears approval), not here.
- Token scope: the track job needs `actions: read` (list target runs) + `pull-requests: read`
  (PR author/state) on the target repos, plus `issues: write` on this repo — minted accordingly.
- Privacy: summary + marker counts-only; no target names beyond what the public issue already
  shows; no private identifiers (structurally impossible — owner-only targets).

**Test scenarios:** correct run picked by correlation-id when a coincidental run shares the
epoch window; run-success-no-PR → completed; run-success + bot-merged PR → completed;
forged non-bot PR with the id → ignored (no false completion); run-success + closed-unmerged →
failed; run-failure → failed; partial → issue stays open; all terminal → close + summary (AE6);
idempotent re-run no-op; CAS mismatch vs the dispatch job → retry/defer; counts-only leak check
(AE7).

**Verification:** octokit-mocked; terminal precedence + correlation-id disambiguation asserted.

- [x] **Unit 5: Planner wiring + decomposition contract**

**Goal:** The mention-triggered agent, on a `cross-repo-goal` issue, emits a valid decomposition marker
and never dispatches.

**Requirements:** R1, R2, R3

**Dependencies:** Units 1–2

**Files:**
- Modify: `.github/workflows/fro-bot.yaml` (planner-context wiring only)
- Modify: persona/context assets as needed for the decomposition prompt

**Approach:**
- When the triggering issue carries the `cross-repo-goal` label, inject guidance so the agent reads the
  goal + managed-repo registry and posts a decomposition comment in the exact marker schema from
  Unit 1 (per-repo items, owner targets only). The planner run gets no new trigger, no new
  permission, no dispatch capability (R1); its output is a proposal the operator edits/approves (R3).
- The decomposition must be parseable by Unit 1's `parseDecomposition`; malformed output is a
  planning-quality issue the operator catches at review (nothing dispatches unapproved).

**Test scenarios:** none executable (prompt/context wiring) — validated by the rehearsal in
Unit 6 and by Unit 1's parser accepting a representative decomposition fixture.

**Verification:** a sample decomposition round-trips through `parseDecomposition`; no dispatch
path exists in the planner run.

- [x] **Unit 6: Control-plane workflows + labels**

**Goal:** Wire the event surfaces, the approve label, and least-privilege mints.

**Requirements:** R4, R10b, R11, R14

**Dependencies:** Units 3–5

**Files:**
- Create: `.github/workflows/cross-repo-dispatch.yaml`
- Modify: `.github/settings.yml` (register the `cross-repo-goal` + approve labels)
- Modify (if correlation needs it): target `fro-bot.yaml` `run-name` to surface `correlation_id`

**Approach:**
- `dispatch` job on `issues.labeled`: actor+label gate step (boolean-safe, fail-closed, remove
  label on refusal) → **only then** mint a token scoped `repositories:` = approved targets with
  `actions: write` → `node scripts/cross-repo-dispatch.ts dispatch` → counts-only summary.
- `reopen` job on `issues.reopened`: remove the approve label + clear the approval record so
  recovery re-fires a fresh `labeled` event (R10b).
- `track` job on `schedule` + `workflow_dispatch`: mint a token with `actions: read` +
  `pull-requests: read` on target repos and `issues: write` on this repo → `runTrack` → counts-
  only summary.
- `settings.yml`: add the goal + approve labels (byte-exact strings the workflow gates on).
- If `fro-bot.yaml` cannot surface `correlation_id` in a queryable field today, add a minimal
  reviewed `run-name` suffix echoing the dispatch input — the one target-workflow change v1 may
  need (KTD).

**Test scenarios:** none (YAML) — verified by `Check Workflows` actionlint, eslint yml rules,
pinned-SHA parity, and the post-merge rehearsal.

**Verification:** YAML parses; eslint clean; action SHAs byte-identical; actor/label gate uses
boolean-safe comparisons; mint steps sit after their gates.

- [x] **Unit 7: Operator documentation**

**Goal:** Document the goal → approve → track lifecycle and its bounds.

**Requirements:** R4, R6, R12 (documented boundaries)

**Dependencies:** Units 1–6

**Files:**
- Modify: `README.md` (or `metadata/README.md` — wherever automation lifecycle is documented)

**Approach:**
- Document: how to open a goal issue, what the decomposition looks like, that only an
  operator-applied approve label dispatches, owner-repos-only, how items reach terminal state, and
  that closure is machine-derived. No plan/unit/R-number references.

**Verification:** markdown lint; a reader can run one goal end to end from the doc.

## System-Wide Impact

- **Interaction graph:** new edges — goal issue → planner run (existing agent surface) →
  decomposition marker → labeled event → dispatch loop → target `fro-bot.yaml` runs → tracker
  snapshot → issue close. No existing loop is modified; `fro-bot.yaml` gains only planner-context
  wiring (no trigger/permission change).
- **Error propagation:** every refusal/blocked/deferred path is counted and non-fatal; the
  dispatch job cannot corrupt existing workflows (separate workflow). A worker run failure is an
  item terminal state, never a control-loop failure.
- **State lifecycle:** state lives only in the bot marker; idempotent snapshots prevent churn;
  reopen-before-reapprove prevents closed-issue self-dispatch.
- **Unchanged invariants:** `main` protection, data-branch model (untouched — A3 does no repo
  commits), agent authority, privacy perimeter (owner-only targets make private leakage
  structurally impossible), counts-only telemetry.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cross-repo dispatch token over-broad | Mint is owner-scoped (`owner: github.repository_owner`, no `repositories:` narrowing), not per-target: the approved target set is data-driven from the bot marker and unknown at YAML mint time, so a static per-target `repositories:` list isn't expressible at mint time. Effective blast radius is bounded instead by the owner-only registry gate (`ELIGIBLE_OWNERS` — only `fro-bot`/`marcusrbrown`-owned, public, onboarded repos ever receive a dispatch) plus the actor+label gate that must pass before mint. Job-scoped, minted only after the actor gate (R14). |
| Label spoofing / self-approval | Actor-bound gate in BOTH workflow and script (`sender.login == marcusrbrown`), fail-closed label removal (R4). |
| Prompt injection via public issue | Human approval + bot-marker-only trust + item-prompt policy + owner-only targets (R8/R15/R6). |
| Duplicate worker runs on crash | Two-phase intent→confirm persistence + correlation-id reconciliation on resume (R7). |
| Wrong-run correlation (coincidental run) | Unique correlation-id in dispatch inputs echoed to run-name; epoch is only a pre-filter. |
| Completion spoofing via forged PR | PR refinement requires a bot-authored PR carrying the id; run-conclusion is the hard gate. |
| Concurrent marker writers (dispatch vs track) | Compare-and-swap on the marker hash, bounded retry, defer on persistent mismatch. |
| Marker exceeds comment size limit | Latest-state-only marker (no history) + hard item-count cap at parse. |
| Concurrent same-target runs | Same-target serialization defers colliding items (R15). |
| Privacy leak on public issue | Owner-only targets (no private repo can be a target) + counts-only telemetry (R6/R12/R13). |
| App private-key compromise | Residual (accepted): per-target mint bounds a leaked *run token*, but the App key + id can mint full install scope regardless (memory 6271); key storage/rotation stays the real control — documented, not solved here. |

## Documentation / Operational Notes

- Rehearsal after merge: open a low-stakes goal (e.g. a trivial doc-touch across 2 owner repos),
  let the planner decompose, approve, watch two worker runs dispatch and the issue track to
  close. Confirm a non-operator label application is refused.

## Sources & References

- **Origin:** [docs/brainstorms/2026-07-04-a3-cross-repo-dispatch-requirements.md](../brainstorms/2026-07-04-a3-cross-repo-dispatch-requirements.md)
- Reuse: `scripts/rollout-tracker-snapshot.ts`, `scripts/wiki-lint-issues.ts`,
  `scripts/reconcile-repos.ts`, `scripts/handle-invitation.ts`, `scripts/schemas.ts`,
  `.github/workflows/fro-bot.yaml`, `.github/workflows/status-truth.yaml`
- Prior plans: [docs/plans/2026-07-03-001-feat-bounded-correction-pr-execution-plan.md](2026-07-03-001-feat-bounded-correction-pr-execution-plan.md),
  [docs/plans/2026-07-03-002-feat-wiki-authority-repair-loop-plan.md](2026-07-03-002-feat-wiki-authority-repair-loop-plan.md)
