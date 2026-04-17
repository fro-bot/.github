---
title: Repo Reconciliation
type: feat
status: active
date: 2026-04-17
deepened: 2026-04-17
origin: docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md
---

# Repo Reconciliation

## Overview

Add a daily reconciliation workflow that keeps `metadata/repos.yaml` in sync with fro-bot's actual GitHub collaborator access. Closes partial-failure orphans (invitation accepted but metadata never written), out-of-band acceptances (collaborator added via GitHub UI), unsolicited grants (allowlist-gated for safety), lost-access events (revoked, archived, deleted), and field drift on tracked fields (`has_fro_bot_workflow`, `has_renovate`).

## Problem Frame

`metadata/repos.yaml` is Fro Bot's local projection of its collaborator reality; GitHub is the source of truth. Five failure modes cause drift today — see origin doc for full list. Left unreconciled, the projection becomes unreliable and Fro Bot operates on a stale mental model. This plan delivers the reconciler that brings the projection back to truth within 24 hours, with an explicit allowlist gate to defend against unsolicited collaborator grants.

## Requirements Trace

- **R1** — Discover new access with allowlist gate (see origin: docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md)
- **R2** — Flag lost access across revoked / archived / deleted
- **R3** — Refresh drift-prone fields via existence checks
- **R4** — Sequential dispatches with non-blocking failure
- **R5** — Commit-before-dispatch, one atomic commit per run
- **R6** — Silent when unchanged
- **R7** — Scheduled cron + manual dispatch
- **R8** — Dual credentials (user PAT for enumeration, app token for writes/dispatches)
- **R9** — Regained access rehydrates the entry

## Scope Boundaries

- Does not modify Poll Invitations behavior.
- Does not auto-dispatch Survey Repo for non-allowlisted owners (security gate).
- Does not delete metadata entries. Lost-access entries are preserved for audit.
- Does not include repo names in commit messages or workflow logs (private-repo name protection).
- Does not read file contents for field refresh — existence checks only.
- **Allowlist TOCTOU:** reconcile reads `metadata/allowlist.yaml` once at the start of the run. Mid-run operator changes to the allowlist take effect on the NEXT run, not the current one. Documented by design; daily cadence makes this acceptable.

## Context & Research

### Relevant Code and Patterns

- `scripts/commit-metadata.ts` — atomic data-branch write with 409 retry. Used for the metadata commit. Restricts path to `metadata/<name>.yaml`, restricts branch to `data`, checks branch protection. Mutator contract: pure function of current state.
- `scripts/handle-invitation.ts` — closest existing loop pattern: per-repo processing with classified outcomes (accepted / skipped / failed). Borrow the shape for reconcile's per-repo processing but note reconcile classifies into more states (new-allowlisted / new-pending-review / revoked / archived / deleted / field-drift / unchanged / regained).
- `scripts/data-branch-bootstrap.ts` — idempotent bootstrap of the `data` branch. Reconcile should call `bootstrapDataBranch` before its first commit, same as `handleInvitations`.
- `scripts/wiki-ingest.ts` — Octokit type derivation pattern (`type OctokitClient = Octokit`) and the `createOctokitFromEnv` shape. Reconcile needs two clients so the pattern extends rather than reuses.
- `scripts/schemas.ts` — runtime type guards for metadata schemas. Must extend `OnboardingStatus` enum and `isOnboardingStatus` guard before reconcile can write the new status values.
- `.github/workflows/poll-invitations.yaml` — scheduled cron pattern. Reconcile's workflow mirrors its shape (checkout + setup + node script invocation).
- `.github/workflows/merge-data.yaml` — app-token flow via `actions/create-github-app-token@v3.1.1` with `secrets.APPLICATION_ID` + `secrets.APPLICATION_PRIVATE_KEY`. Reconcile uses this pattern for the app-token half of its dual credentials.
- `.github/workflows/survey-repo.yaml` — dispatch target. Reconcile calls its `workflow_dispatch` with `owner` + `repo` inputs.
- `metadata/allowlist.yaml` — `approved_inviters` list. Reconcile reads this to classify new access.

### Institutional Learnings

- `docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md` — derive `OctokitClient` from real `Octokit`; never handwrite SDK interfaces. Handwritten types silently hallucinate method names and drop nullability. Reconcile follows this rule from the start.

### External References

- GitHub REST: `GET /user/repos?affiliation=collaborator` returns repos where the authenticated user is a collaborator (not owner, not member). Requires `repo` scope on a classic PAT. Paginated (default 30/page, max 100). Returned entries include `archived`, `owner.login`, `name`, `id`, `node_id`.
- GitHub REST: `GET /repos/{owner}/{repo}` returns 404 for deleted repos and 200 with `archived` field for existing ones.
- GitHub REST: `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` is the workflow_dispatch endpoint (already used by `handle-invitation.ts`).

## Key Technical Decisions

- **Two Octokit clients, one script.** `userOctokit` authenticated via `FRO_BOT_POLL_PAT` for user-scoped reads (`/user/repos`, `/repos/{owner}/{repo}`). `appOctokit` authenticated via `fro-bot[bot]` installation token for data-branch writes (`commitMetadata`), workflow dispatches, and `pending-review` issue creation. Split is load-bearing: the app token cannot call `/user/repos` (user-scoped endpoint); the user PAT commits as `fro-bot` the user, not `fro-bot[bot]` the app, which contradicts the established identity preference.
- **Pure-logic core, thin I/O shell.** The decision-making (classify each repo, compute next metadata state, produce a dispatch queue, produce a pending-review issue list) lives in pure functions taking `(currentRepos, accessList, perRepoStatus, allowlist, now)` and returning `(nextRepos, dispatchQueue, issuesQueue, summary)`. I/O (fetch access list, fetch per-repo status, commit, dispatch, create issues) sits in a thin outer layer. This mirrors the testing ergonomics of `handle-invitation.ts` and makes the reconciler easy to verify without mocking Octokit exhaustively.
- **Single-script architecture.** Enumeration, classification, commit, dispatch, and issue creation all happen in one script invocation (one workflow run). Rejected: split into two workflows (enumerator → commit, then dispatcher). Rationale: operator-observability (one run log tells the whole story), atomicity (no intermediate state visible between runs), and the read→commit→dispatch ordering is easier to reason about as a linear script than as a message-passing pipeline. Cost: the script is long (~400 lines projected). Accepted.
- **Mutator contract: re-compute on each invocation, not precompute.** The `commitMetadata` mutator passed by reconcile re-runs `reconcileRepos({currentRepos: current, accessList, perRepoStatus, allowlist, fieldProbes, now})` inside the closure — not a precomputed `nextRepos` snapshot. `accessList`, `perRepoStatus`, `allowlist`, and `fieldProbes` are captured once from the outer scope; `currentRepos` is supplied by `commitMetadata` on each attempt (including 409 retries). This guarantees concurrent-writer safety: if `poll-invitations` commits a new entry between reconcile's read and reconcile's commit, the 409 triggers a retry, the mutator re-runs against the post-poll `current`, and the merged result preserves the new entry. Load-bearing for correctness — without this, whole-state replacement under retry would silently drop concurrently-added entries.
- **Lost-access detection uses Pass 1 for archived, Pass 2 for deleted/revoked.** Pass 1: fetch `/user/repos?affiliation=collaborator` (paginated, collect all). Archived repos appear in Pass 1 as entries with `archived: true` — these are classified as `lost-access` directly from Pass 1 data, no Pass 2 call needed. Pass 2: for each tracked entry **missing** from Pass 1, call `GET /repos/{owner}/{repo}` to disambiguate deleted (404) vs revoked (200, not in the collaborator access list). Avoid calling `GET /repos/{owner}/{repo}/collaborators` because it may be gated.
- **Field-refresh via contents endpoint, no content bodies.** `has_fro_bot_workflow` checks the presence of any `fro-bot*.yaml` under `.github/workflows/` via `GET /repos/{owner}/{repo}/contents/.github/workflows` (directory listing). `has_renovate` checks existence of `renovate.json`, `.github/renovate.json`, `.renovaterc.json`, or `.renovaterc` via per-path HEAD (or `GET /repos/{owner}/{repo}/contents/<path>` returning 200/404). Do not read file contents. Normalize 404 to "absent".
- **Commit-before-dispatch ordering.** Reconcile writes the atomic metadata commit first (via `commitMetadata`), then walks the dispatch queue sequentially. A dispatch failure logs and continues; the entry remains `pending` and the next daily run retries. This makes metadata state durable before any external side effects and makes the reconciler self-healing.
- **Pre-commit `data`-branch integrity check.** Before reconcile calls `commitMetadata`, it fetches the current `data` branch HEAD and verifies the commit author matches the expected autonomous-writer identities (`fro-bot[bot]` for app-token commits, plus an operator-override allowlist for manual maintenance commits such as the initial bootstrap by Marcus). On mismatch, reconcile aborts with a typed error and files a tamper-alert GitHub issue labeled `reconcile:integrity-alert` — no commit happens. This is defense-in-depth for the unprotected `data` branch: if an actor with `contents:write` rewrites history, the next reconcile run catches it before compounding on top of the tampered state.
- **Private-repo privacy: issue bodies differ by repo visibility.** The `GET /repos/{owner}/{repo}` response carries a `private: boolean` flag. For public repos, `pending-review` issues include the full `owner/repo` name and link. For private repos, the issue body omits the name and uses a stable opaque key (the repo `node_id`, which is not a URL and does not reveal the name); the operator cross-references via their own access to the metadata commit on `data`. Rationale: `fro-bot/.github` is public; naming a private repo in its issue body leaks the name to anyone reading the public issue stream.
- **Aggregate-only audit artifacts for non-issue channels.** Commit message is a count summary (`chore(reconcile): +N new, M pending-review, K lost-access, J refreshes`). Workflow logs print aggregate counts and per-outcome summaries (not repo names). The only places repo names appear are: (a) `pending-review` issues for **public** repos, and (b) the `metadata/repos.yaml` commit itself (which stays in git history on the `data` branch — visible but not broadcast).
- **Run summary emitted on stdout as JSON.** Matches `handle-invitation.ts` convention (`process.stdout.write(JSON.stringify(result))`). Enables downstream inspection via run logs without leaking repo names in the JSON payload (aggregate counts only).

## Open Questions

### Resolved During Planning

- **How to handle org-owned repos when `approved_inviters` lists only user logins?** For this plan, treat any owner login not present in `approved_inviters.username` as non-allowlisted → `pending-review`. If operator later needs to allowlist an org, they add the org login as an `approved_inviters` entry. The allowlist schema already accepts any login string; no schema change needed. Noted in origin doc as a tracked assumption.
- **Two Octokit clients in one script — pattern established?** No existing script uses two Octokits. Reconcile introduces the pattern. Follow the `createOctokitFromEnv` shape from `wiki-ingest.ts` but parameterize by token env var. Keep both clients as `Octokit` type aliases.
- **Is the enumeration endpoint paginated, and how is it consumed?** Yes, paginated. Use `octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, { affiliation: 'collaborator', per_page: 100 })` — available on the real Octokit because `paginate` is a core method. Mocks cast via `as unknown as OctokitClient` already, so there's no type impact.
- **Does `addRepoEntry` already exist?** Yes — `scripts/handle-invitation.ts:282 addRepoEntry({current, owner, repo, now}) → ReposFile`. It hardcodes `onboarding_status: 'pending'` and is idempotent (returns unchanged if an entry already exists). To support reconcile's two newcomer statuses (`pending` for allowlisted, `pending-review` for non-allowlisted), the helper lifts to a shared module with an extended signature `(current, { owner, repo, now, onboarding_status? })`. `handle-invitation.ts` is updated to import from the shared module and continues to default to `'pending'`. See Unit 1 and the System-Wide Impact section.
- **Is `fro-bot/.github` publicly visible?** Yes (verified via `repos/fro-bot/.github` — `visibility: public`, `private: false`). This drives the per-repo issue-body privacy decision above.
- **Single script or two workflows?** One script, one workflow. See the architecture decision in Key Technical Decisions for rationale.

### Deferred to Implementation

- Exact dispatch timeout. Start with `15_000 ms` per `createWorkflowDispatch` call; revise if observed dispatches regularly exceed that.
- Exact pending-review issue template (title, body, labels). Draft during Unit 3; the simplest form is `title: "Unsolicited collaborator grant: {owner}/{repo}"`, body lists context + the reconcile run URL + next-step options, label `reconcile:pending-review`.
- Node_id tracking for rename/transfer stability. Deferred; first pass matches by `owner/name` only. If we observe renames drifting entries into lost-access incorrectly, add node_id cross-reference in a follow-up.
- Secondary rate-limit backoff. Respect `retry-after` when present; otherwise log and continue. Exact wait-and-retry shape during implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Reconcile splits into a **pure decision engine** and an **I/O shell**. The decision engine takes snapshots in and produces a change plan out; the shell turns the plan into API calls and a commit.

```
                          +------------------------+
    /user/repos  ───────► |                        |
    per-repo status ────► |  reconcileRepos()      | ──► next repos.yaml state
    metadata/repos.yaml ─►|  (pure function)       | ──► dispatch queue
    metadata/allowlist ─► |                        | ──► pending-review queue
                          +------------------------+ ──► summary (counts)
                                                                │
                                                                ▼
                                                   +------------------------+
                                                   |  I/O shell             |
                                                   |  1. commitMetadata(    |
                                                   |       next, summary)   |
                                                   |  2. for each dispatch: |
                                                   |       createWorkflow…  |
                                                   |  3. for each issue:    |
                                                   |       issues.create    |
                                                   +------------------------+
```

Per-repo classification decision table:

| Current state         | Accessible now? | Owner allowlisted? | Outcome                                      |
| --------------------- | --------------- | ------------------ | -------------------------------------------- |
| untracked             | yes             | yes                | new → add with `pending`, dispatch Survey    |
| untracked             | yes             | no                 | new → add with `pending-review`, file issue  |
| `pending`/`onboarded` | yes             | (any)              | refresh fields, no dispatch, no issue        |
| `pending-review`      | yes             | (any)              | refresh fields only; operator promotes       |
| `lost-access`         | yes             | yes                | regain → `pending`, dispatch Survey          |
| `lost-access`         | yes             | no                 | regain → `pending-review`, file issue        |
| tracked (any)         | no              | (any)              | classify via `GET /repos`: revoked/archived/deleted → `lost-access` |
| `lost-access`         | no              | (any)              | unchanged                                    |

## Implementation Units

- [ ] **Unit 1: Extend schema and extract shared `addRepoEntry` helper**

**Goal:** Land the two prerequisites reconcile needs before Unit 2: (a) extend `OnboardingStatus` enum + guard to include `lost-access` and `pending-review`; (b) lift `addRepoEntry` from `scripts/handle-invitation.ts` into a shared module so reconcile can produce entries with the exact same shape.

**Requirements:** R1 (pending-review shape), R2 (lost-access), R9 (regained → pending/pending-review)

**Dependencies:** None — prerequisite for all downstream units.

**Files:**
- Modify: `scripts/schemas.ts`
- Test: `scripts/schemas.test.ts`
- Create: `scripts/repos-metadata.ts` (exports `addRepoEntry`)
- Test: `scripts/repos-metadata.test.ts`
- Modify: `scripts/handle-invitation.ts` (remove local `addRepoEntry`, import from shared module)
- (No change to `scripts/handle-invitation.test.ts` required — it imports only `OctokitClient`, `handleInvitations`, and `InvitationHandlingError` from `handle-invitation.ts`, not `addRepoEntry` directly.)

**Approach:**
- Schema extension: widen `OnboardingStatus` union to `'pending' | 'onboarded' | 'failed' | 'lost-access' | 'pending-review'`; extend `isOnboardingStatus` guard's value set. No schema-version bump (additive, backwards compatible).
- Helper lift: move `addRepoEntry` to `scripts/repos-metadata.ts`. Extend signature to `addRepoEntry(current: unknown, input: { owner: string; repo: string; now: Date; onboarding_status?: OnboardingStatus }) → ReposFile`. Default `onboarding_status` to `'pending'` when omitted, preserving `handle-invitation.ts` behavior byte-for-byte.
- Helper remains idempotent: returns unchanged `current` if an entry with the same `owner + name` already exists (regardless of the requested `onboarding_status`).
- `handle-invitation.ts` imports `addRepoEntry` from the new module. Local copy deleted.

**Execution note:** Test-first. Pin the existing behavioral contract first (call with no status → pending; call with explicit status → that status; idempotent on duplicate), then widen `OnboardingStatus`. Run `pnpm test scripts/handle-invitation.test.ts` unchanged to prove parity preserved.

**Patterns to follow:**
- Existing enums + guards in `scripts/schemas.ts` (e.g., `isSurveyStatus`, `isInviterRole`).
- Mutator purity contract enforced by `commitMetadata` (no in-place mutation; return fresh objects).

**Test scenarios:**
- `isOnboardingStatus` accepts both new values.
- `isOnboardingStatus` still rejects unknown strings.
- `assertReposFile` passes when a repo entry carries `onboarding_status: 'lost-access'` or `'pending-review'`.
- `assertReposFile` rejects `onboarding_status: 'archived'` (not in the set).
- `addRepoEntry(current, { owner, repo, now })` produces an entry with `onboarding_status: 'pending'` and all expected defaults (`added`, `last_survey_at: null`, `last_survey_status: null`, `has_fro_bot_workflow: false`, `has_renovate: false`).
- `addRepoEntry(current, { owner, repo, now, onboarding_status: 'pending-review' })` produces an entry with that status and the same other defaults.
- `addRepoEntry` is idempotent: calling with an existing `owner+name` returns `current` unchanged, even if a different `onboarding_status` is requested (the existing entry's status is preserved — reconcile uses a different code path to change status of existing entries).
- `addRepoEntry` returns a fresh top-level object (no in-place mutation of `current`).
- `handle-invitation.test.ts` continues to pass without modification (parity preserved).

**Verification:**
- `pnpm check-types` clean.
- `pnpm test scripts/schemas.test.ts scripts/repos-metadata.test.ts scripts/handle-invitation.test.ts` all pass.
- `pnpm lint` clean on all modified files.

---

- [ ] **Unit 2: Pure reconciliation engine (`reconcileRepos`)**

**Goal:** Implement `reconcileRepos(inputs) → changePlan` as a pure function with exhaustive tests covering every entry in the classification decision table.

**Requirements:** R1, R2, R3, R6, R9

**Dependencies:** Unit 1 (schema).

**Files:**
- Create: `scripts/reconcile-repos.ts` (only the pure logic export plus its type shapes in this unit; I/O wiring lands in Unit 3)
- Create: `scripts/reconcile-repos.test.ts`

**Approach:**
- Inputs: `currentRepos: ReposFile`, `accessList: Array<{ owner: string; name: string; archived: boolean; private: boolean }>`, `perRepoStatus: Map<string, RepoStatusProbe>` (result of the Pass-2 `GET /repos/{owner}/{repo}` for tracked-but-missing repos: `{ status: 'deleted' } | { status: 'archived' } | { status: 'revoked' } | { status: 'still-accessible', private: boolean }`), `allowlist: AllowlistFile`, `fieldProbes: Map<string, { has_fro_bot_workflow: boolean; has_renovate: boolean }>`, `now: Date`.
- Output: `{ nextRepos: ReposFile, dispatches: Array<{ owner: string; repo: string }>, issues: IssueQueue, summary: { added: number; pendingReview: number; regained: number; lostAccess: number; refreshed: number; unchanged: number } }` where `IssueQueue = Array<PerRepoIssue | PerOwnerRollupIssue>` with `PerRepoIssue = { kind: 'per-repo'; owner: string; repo: string; reason: 'unsolicited-new' | 'unsolicited-regain'; private: boolean; node_id: string }` and `PerOwnerRollupIssue = { kind: 'per-owner-rollup'; owner: string; entries: Array<{ repo: string; private: boolean; node_id: string }>; reason: 'unsolicited-new' | 'unsolicited-regain' }`.
- Decision flow drives the classification table in the technical design above.
- Builds new entries via the shared `addRepoEntry` helper (Unit 1), passing the appropriate `onboarding_status` so reconcile and `handle-invitation.ts` produce identical entry shapes.
- Status transitions on existing entries (`lost-access` set, regained access flip) use a separate helper (e.g. `updateRepoStatus(current, { owner, name, onboarding_status })`) distinct from `addRepoEntry`. The helper produces a fresh entry with updated `onboarding_status` while preserving every other field verbatim. `addRepoEntry` is for NEW entries only; its idempotency would prevent status flips on existing entries.
- No mutation of inputs. All updates produce fresh objects (follows the mutator purity contract `commitMetadata` expects).
- The `issues` output is tagged by `kind`: `per-repo` for single-repo events (one per newcomer when an owner grants only one repo), `per-owner-rollup` for events where a single non-allowlisted owner grants ≥2 repos in the same run. Per-owner rollup collapses all of that owner's non-allowlisted newcomers into one issue. Allowlisted newcomers always get their own `per-repo` dispatch/entry — rollup only applies to non-allowlisted (security-relevant) events.
- The `per-repo` and `per-owner-rollup` entries carry `private` and `node_id` for each subject repo. The I/O shell (Unit 3) decides whether to surface `owner/repo` in the issue body based on `private`.
- Edge case: field-probe absence for an accessible tracked repo (probe request failed mid-run) — treat as "no change to fields" rather than overwriting with `undefined`.
- Edge case: repo has no `.github/workflows` directory at all — the contents-endpoint probe returns 404. Normalize to `has_fro_bot_workflow: false`, not an error. Same for any other field-probe 404 — 404 means "absent", never an exception.

**Execution note:** Test-first. The pure logic is the decision surface; cover every table row and edge case before writing any code.

**Patterns to follow:**
- Mutator purity in `scripts/commit-metadata.ts` (no in-place mutation).
- Functional loop-and-accumulate pattern from `handle-invitation.ts` `processInvitation`.

**Test scenarios:**
- New accessible repo, owner allowlisted → added with `onboarding_status: 'pending'`, dispatch queued, no issue.
- New accessible repo, owner not allowlisted, single repo from that owner → added with `onboarding_status: 'pending-review'`, no dispatch, `per-repo` issue queued with `reason: 'unsolicited-new'`.
- **Per-owner rollup:** two accessible newcomers from the same non-allowlisted owner in one run → both added with `onboarding_status: 'pending-review'`, one `per-owner-rollup` issue queued covering both entries (not two `per-repo` issues).
- **Mixed batch:** three accessible newcomers — one from allowlisted owner A, two from non-allowlisted owner B — → one dispatch queued for A, one `per-owner-rollup` issue queued for B's pair, zero `per-repo` issues.
- Tracked `pending` repo, still accessible, no field change → no metadata change, no dispatch, counted as `unchanged`.
- Tracked `onboarded` repo with `has_renovate: false` in metadata but `true` in probe → field flip only, `onboarding_status` unchanged, counted as `refreshed`.
- Tracked repo absent from access list, probe says `deleted` → flip to `lost-access`, preserve all other fields.
- Tracked repo **present** in access list with `archived: true` → flip to `lost-access` directly from Pass 1 data (no probe needed).
- Tracked repo absent from access list, probe says `revoked` → flip to `lost-access`.
- Tracked repo absent from access list, probe says `still-accessible` (transient inconsistency) → no change.
- `lost-access` repo back in access list, owner allowlisted → flip to `pending`, dispatch queued, preserve `last_survey_at` / `last_survey_status` / wiki-side-effects history.
- `lost-access` repo back in access list, owner not allowlisted → flip to `pending-review`, issue queued with `reason: 'unsolicited-regain'`.
- `pending-review` repo still accessible → refresh fields only; operator decides to promote.
- Multiple simultaneous changes (new + lost + refresh in one run) → all present in one `nextRepos` object, summary counts correct.
- Zero changes → `nextRepos === currentRepos` (by value, via serialized-form compare), dispatches empty, issues empty, summary all zero → caller can detect silent case (R6).
- Empty `currentRepos.repos` + empty `accessList` → no-op, no errors.
- **Concurrent-writer safety (mutator re-run):** call `reconcileRepos` twice with the same outer inputs but a `currentRepos` that gained an unrelated entry between calls (simulates 409-retry scenario). Expected: the second call merges correctly — the newly-added entry is preserved in `nextRepos`, no incorrect `lost-access` flagging, counts match what the post-retry state dictates.
- New entries produced by reconcile's classification use the shared `addRepoEntry` helper; their shape matches entries produced by `handle-invitation.ts` byte-for-byte (schema-validated comparison).
- Status flips on existing entries use `updateRepoStatus` (not `addRepoEntry`). Calling `addRepoEntry` with an existing `owner+name` returns the entry unchanged, which would silently drop the status flip — this must not happen.

**Verification:**
- `pnpm test scripts/reconcile-repos.test.ts` all scenarios pass.
- `pnpm check-types` clean on the pure logic module.
- `pnpm lint` clean.

---

- [ ] **Unit 3: I/O shell — Octokit wiring, `commitMetadata` integration, dispatch + issue loop**

**Goal:** Implement the outer layer that fetches inputs, invokes `reconcileRepos`, commits via `commitMetadata`, then walks the dispatch and issue queues sequentially with non-blocking failure. Expose a CLI entrypoint (`if (import.meta.url === …) { await main() }`) mirroring other scripts.

**Requirements:** R4, R5, R6, R7 (entrypoint surface), R8 (dual credentials)

**Dependencies:** Unit 2 (pure logic).

**Files:**
- Modify: `scripts/reconcile-repos.ts` (add I/O layer, CLI)
- Modify: `scripts/reconcile-repos.test.ts` (add I/O shell tests with mocked Octokits)

**Approach:**
- Export `handleReconcile({ userOctokit, appOctokit, owner, repo, allowlistPath, reposPath, now, commitMetadata: injected, readMetadata: injected, bootstrapDataBranch: injected })` so tests can substitute each I/O boundary the way `handle-invitation.ts` does. `owner` and `repo` are the control-plane repo's own identity (supplied by `main()` from `process.env.GITHUB_REPOSITORY`, which Actions populates as `owner/repo`).
- I/O steps in order:
  1. Call `bootstrapDataBranch({ octokit: appOctokit, owner, repo })` (idempotent; ensures `data` branch exists).
  2. Read `metadata/allowlist.yaml` and `metadata/repos.yaml` via `readMetadata` (disk reads on main branch).
  3. Fetch access list via `userOctokit.paginate(userOctokit.rest.repos.listForAuthenticatedUser, { affiliation: 'collaborator', per_page: 100 })`.
  4. For each tracked entry missing from the access list: `userOctokit.rest.repos.get({ owner, repo })` — 404 → `deleted`; 200 → `revoked`. (Archived repos are detected in Pass 1 via the access list's `archived: true` flag and do not reach Pass 2.)
  5. For each still-accessible tracked entry: fetch field probes (workflows listing + renovate-path existence checks).
  6. Invoke `reconcileRepos(inputs)` → change plan.
  7. **Pre-commit integrity check:** fetch the current `data` branch HEAD via `appOctokit.rest.repos.getBranch({ owner, repo, branch: 'data' })` and verify the tip commit's author login is in the expected-author allowlist (`fro-bot[bot]` plus any operator override configured via `RECONCILE_OPERATOR_LOGINS` env). On mismatch, abort with `DATA_BRANCH_TAMPER` error, create a `reconcile:integrity-alert` issue summarizing the unexpected author + tip SHA, do NOT commit. If `data` doesn't exist yet (first run), skip this check (bootstrap is the expected path).
  8. If `summary` shows any non-zero counter: build a mutator closure that re-runs `reconcileRepos({ currentRepos: current, accessList, perRepoStatus, allowlist, fieldProbes, now })` on each invocation and returns the recomputed `nextRepos`; do NOT return a precomputed `nextRepos` snapshot. Then `commitMetadata({ octokit: appOctokit, path: reposPath, message: summaryCommitMessage, mutator })`. Otherwise skip commit (R6). The re-run contract makes the 409-retry concurrent-writer safety work correctly (see Key Technical Decisions).
  9. For each entry in `dispatches`: `appOctokit.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: 'survey-repo.yaml', ref: 'main', inputs: { owner: dispatch.owner, repo: dispatch.repo } })`. Serial `await` in a loop. On failure, log and continue (R4).
  10. For each entry in `issues`: `appOctokit.rest.issues.create({ ..., title, body, labels: ['reconcile:pending-review'] })`. Serial; non-blocking on failure. Honors the per-owner grouping rule from the `issues` queue (see classification output below).
  11. **Auto-close stale pending-review issues:** list open issues labeled `reconcile:pending-review`, cross-reference against `nextRepos`, and close any whose subject repo is no longer in `onboarding_status: pending-review` (promoted or removed). Serial; non-blocking on failure.
  12. **Self-healing rollup re-file:** if `nextRepos` has ≥2 entries in `onboarding_status: pending-review` for the same non-allowlisted owner AND no open roll-up issue labeled `reconcile:rollup-pending-review` is associated with that owner, create one. This ensures operator attention even if a previous roll-up was closed or missed.
  13. Print run summary as JSON on stdout.
- Dispatch timeout: wrap each `createWorkflowDispatch` call with `AbortController` + 15s timeout. Timeout counts as "failure, continue".
- Error classification on top-level: `MISSING_TOKEN`, `OCTOKIT_LOAD_FAILED`, `METADATA_READ_ERROR`, `COMMIT_ERROR` (let `commitMetadata` errors bubble; they already carry `code`+`remediation`), `DATA_BRANCH_TAMPER` (pre-commit integrity check failed; issue filed, no commit), `API_ERROR` (fall-through for unexpected status codes during enumeration/probing — dispatch/issue failures are non-blocking, not top-level errors).
- `main()` reads both tokens from env: `FRO_BOT_POLL_PAT` → `userOctokit`; app token (generated in the workflow via `actions/create-github-app-token`, passed as `GITHUB_TOKEN` env var into this script) → `appOctokit`. `main()` also parses `GITHUB_REPOSITORY` into `owner` and `repo` before calling `handleReconcile`.
- **Token value hygiene:** no code path logs a token value, partial or otherwise. Error paths reference tokens by env-var name only (`FRO_BOT_POLL_PAT`, `GITHUB_TOKEN`). This is a hard rule, tested via the MISSING_TOKEN scenario.

**Execution note:** Test-first for the wiring — mock both Octokit clients, inject `commitMetadata` and `readMetadata`, verify the commit-before-dispatch ordering by asserting call order on spies. Do NOT re-test the pure classification logic here; trust Unit 2's coverage.

**Patterns to follow:**
- `scripts/handle-invitation.ts` — `handleInvitations(params)` shape with injected collaborators.
- `scripts/wiki-ingest.ts` — `createOctokitFromEnv` + `as unknown as OctokitClient` cast in tests.
- Error class shape from `CommitMetadataError` / `InvitationHandlingError` (`code` + `remediation`).

**Test scenarios:**
- Happy path: new allowlisted repo discovered → commit happens first, then single Survey dispatch, then JSON summary on stdout.
- Happy path with both allowlisted and non-allowlisted newcomers → one commit, one dispatch, one issue created (dispatch and issue ordering don't depend on each other).
- All dispatches succeed but one issue creation fails → logged, run completes, remaining issues still attempted.
- Dispatch #2 of 3 fails → log, continue with #3.
- Dispatch #2 of 3 hits 15s timeout → treated as failure, continue.
- Commit fails with `CONFLICT_EXHAUSTED` → bubble as top-level error; no dispatches fire (commit-before-dispatch rule preserved).
- **409-retry scenario:** first mutator invocation receives `currentRepos@v1`; `commitMetadata` fails with 409 and re-invokes the mutator with `currentRepos@v2` (simulating a concurrent write by `handle-invitation.ts`). Assert the mutator re-runs `reconcileRepos` against v2 (not a memoized v1 result) and the resulting `nextRepos` merges the concurrent entry correctly.
- Newcomer is a **private** repo with non-allowlisted owner → issue is created, but the issue body omits `owner/repo` and uses a generic title + `node_id` reference; the full name appears in no public audit artifact.
- Newcomer is a **public** repo with non-allowlisted owner → issue body includes the full `owner/repo` and link.
- **App token minting failure (simulated)**: the outer `main()` wrapper (tested via its env parsing and error-surfacing path) exits with a clear error code when `GITHUB_TOKEN` is missing or malformed, before any API call.
- **Data branch integrity check — clean HEAD:** tip commit on `data` was authored by `fro-bot[bot]` → integrity check passes, commit proceeds normally.
- **Data branch integrity check — operator override:** tip commit on `data` was authored by a login listed in `RECONCILE_OPERATOR_LOGINS` env (e.g., `marcusrbrown`) → integrity check passes, commit proceeds.
- **Data branch integrity check — unexpected author:** tip commit on `data` was authored by an unlisted login → abort with `DATA_BRANCH_TAMPER`, create `reconcile:integrity-alert` issue, no commit.
- **Data branch integrity check — bootstrap case:** `data` branch does not exist (first run) → integrity check skipped, `bootstrapDataBranch` creates it, commit proceeds.
- **Auto-close stale pending-review issue:** an open `reconcile:pending-review` issue exists for `owner/repo` but `nextRepos` shows that entry is now `onboarding_status: 'pending'` (operator approved) → issue gets closed during the auto-close step.
- **Self-healing rollup re-file:** 3 `pending-review` entries exist for same non-allowlisted owner, previous roll-up issue was closed → reconcile files a new roll-up issue for that owner.
- **Self-healing rollup no-op:** 2 `pending-review` entries exist for same owner, open roll-up issue already exists for that owner → no new issue created.
- **MISSING_TOKEN error message contains no token substring:** assert the error message contains the env-var name (e.g. `FRO_BOT_POLL_PAT`) and a remediation pointer, but NO substring from any actual token-shaped value. Applies to every token-related error path.
- No changes detected → `commitMetadata` NOT called, `createWorkflowDispatch` NOT called, `issues.create` NOT called; JSON summary written with all zero counters.
- Field probe for one repo throws → probe result omitted from map; `reconcileRepos` treats as "no change" (covered in Unit 2, verified end-to-end here with one integration scenario).
- `/user/repos` returns 0 repos and `currentRepos` has entries → all get classified via probe and flipped to `lost-access`.
- Missing `FRO_BOT_POLL_PAT` → `MISSING_TOKEN` error before any API call.
- `bootstrapDataBranch` is called exactly once per run, before any metadata read/write.

**Verification:**
- `pnpm test scripts/reconcile-repos.test.ts` passes all scenarios.
- `pnpm check-types` clean.
- `pnpm lint` clean.
- Smoke test: `FRO_BOT_POLL_PAT=... GITHUB_TOKEN=... node scripts/reconcile-repos.ts` locally against a personal-access fixture works end-to-end (dry-run mode or actual, operator's call).

---

- [ ] **Unit 4: Scheduled workflow (`reconcile-repos.yaml`)**

**Goal:** Ship the scheduled cron + manual dispatch workflow that mints the app token, runs `scripts/reconcile-repos.ts` with both credentials available, and reports the JSON summary in the run log.

**Requirements:** R7 (trigger), R8 (credential mounting), R5 (atomicity is preserved because the script does the commit; the workflow just invokes it)

**Dependencies:** Unit 3 (working script).

**Files:**
- Create: `.github/workflows/reconcile-repos.yaml`

**Approach:**
- Triggers: `schedule: [{ cron: '17 5 * * *' }]` (daily 05:17 UTC, off-peak relative to existing Poll Invitations every 15 minutes `*/15 * * * *` and Merge Data Branch at 22:00 Sunday) + `workflow_dispatch`.
- `permissions: {}` at workflow level; per-job grants `contents: write`, `actions: write`, `issues: write`.
- `concurrency: { group: reconcile-repos, cancel-in-progress: false }` to avoid overlapping runs.
- `timeout-minutes: 10`.
- Steps:
  1. `actions/checkout@<pinned>` — needed so `scripts/` is available.
  2. `./.github/actions/setup` — standard Node + pnpm setup.
  3. `actions/create-github-app-token@<pinned>` with `id: get-workflow-app-token`, `app-id: secrets.APPLICATION_ID`, `private-key: secrets.APPLICATION_PRIVATE_KEY` → exposes `outputs.token` (the `fro-bot[bot]` installation token).
  4. Run `node scripts/reconcile-repos.ts` with env: `FRO_BOT_POLL_PAT: secrets.FRO_BOT_POLL_PAT`, `GITHUB_TOKEN: steps.get-workflow-app-token.outputs.token`. The script internally treats `GITHUB_TOKEN` as the app token (matches the convention `merge-data.yaml` uses).
- Pin all third-party actions to commit SHA with version comment (repo convention).

**Execution note:** No test harness for the workflow itself beyond `actionlint` + `check-workflows`. Verify via manual dispatch after merge.

**Patterns to follow:**
- `.github/workflows/merge-data.yaml` — app-token minting + passing to script as `GITHUB_TOKEN`.
- `.github/workflows/poll-invitations.yaml` — scheduled cron shape.

**Test scenarios:**
- `actionlint` clean on the new workflow.
- `Check Workflows` job passes on PR.
- Post-merge manual dispatch completes without error on a state that requires no changes → exits 0, prints all-zero JSON summary.

**Verification:**
- CI `Check Workflows` green.
- One manual dispatch after merge confirms the end-to-end flow in a real environment.

## System-Wide Impact

- **Interaction graph:** Reconcile reads `metadata/allowlist.yaml` + `metadata/repos.yaml`, writes `metadata/repos.yaml` on the `data` branch (through `commitMetadata`), dispatches `survey-repo.yaml`, and creates GitHub issues. It does not touch the wiki directly — Survey Repo remains the only writer of wiki content. It does not modify `poll-invitations.yaml`; it does modify `handle-invitation.ts` to replace the local `addRepoEntry` with the shared-module import (Unit 1) — a byte-compatible refactor, not a behavior change.
- **Error propagation:** Top-level `ReconcileError` mirrors `InvitationHandlingError` / `CommitMetadataError` (typed `code` + `remediation`). Dispatch/issue failures are non-blocking by design — they log to stdout and do not propagate. Enumeration, probe, token-mint, and commit failures are fatal (can't safely reconcile with partial truth).
- **State lifecycle risks:** Commit-before-dispatch ordering + self-healing retry on the next daily run keeps the state machine eventually consistent even through partial failures. The main risk is a commit succeeding then every dispatch failing — entries would sit in `pending` until the next run and survey dispatches would retry. Acceptable.
- **Concurrent-writer safety:** `poll-invitations.yaml` (every 15 minutes) and `reconcile-repos.yaml` (daily) can run simultaneously and both write `metadata/repos.yaml` on the `data` branch. The 15-minute cadence makes concurrent-run overlap realistic on any day where reconcile has non-trivial work. `commitMetadata`'s 409-retry loop handles SHA conflicts at the Git layer, but the semantic correctness depends on reconcile's mutator being idempotent against a re-read `current`. The mutator contract in Key Technical Decisions makes this explicit: the mutator re-runs `reconcileRepos` on each invocation, so a concurrent append by `handle-invitation.ts` between reconcile's read and reconcile's commit is absorbed by the retry. Without this contract, reconcile would silently overwrite the concurrently-added entry.
- **API surface parity:** `handle-invitation.ts` adds repos to `metadata/repos.yaml` via the local helper at `scripts/handle-invitation.ts:282 addRepoEntry`. Unit 1 lifts this helper to `scripts/repos-metadata.ts` with an extended signature accepting `onboarding_status`. Both `handle-invitation.ts` and `reconcile-repos.ts` import the shared helper, guaranteeing byte-compatible entry shapes across the two entry points. The helper remains idempotent on duplicate `owner+name`, so reconcile and poll can both safely attempt to add the same repo.
- **Integration coverage:** The classification table (Unit 2) is the hot spot for integration bugs. The test-scenario list for Unit 2 covers every row including the concurrent-writer re-run case. Unit 3 covers the ordering invariant (commit-before-dispatch) and the 409-retry semantics via spy call-order assertions. Unit 1 covers the parity invariant (schema-validated shape comparison between reconcile-produced and handle-invitation-produced entries).

## Risks & Dependencies

- **Risk (P1): Private repo name leak in public issues.** `fro-bot/.github` is public. If `pending-review` issues include the full `owner/repo` of a private repo, the name becomes discoverable by anyone reading the public issue stream. **Mitigation (in scope):** the classification output carries `private: boolean` and `node_id` for each issue-worthy event; Unit 3 conditionally includes/omits the name based on `private`. Private-repo issues use a generic title (e.g., `Unsolicited collaborator grant: private repo`) and reference the opaque `node_id` in the body; the operator cross-references via their own access to the metadata commit. Covered by Unit 3 test scenarios.
- **Risk (P1): Mass-grant DoS via issue spam.** If an actor grants fro-bot collaborator access to many repos at once (scripted or intentional), a single reconcile run could file one `pending-review` issue per non-allowlisted repo. At scale the issue stream becomes noise and may exhaust API quotas for `issues.create`. **Mitigation (in scope):** per-owner grouping — if one non-allowlisted owner grants ≥2 repos in the same run, reconcile collapses all of that owner's newcomers into a single roll-up issue (`Unsolicited collaborator grants from {owner}: N new repos require review`). Aggregate count threshold (e.g. cap at 10 per-owner rollups in one run) still protects against attack-fan-out across many owners. Per-owner grouping is more surgical than a global cap: signals stay grouped by attacker identity, making triage straightforward. Metadata entries are still created for all of them; only the issue stream is collapsed. Covered by Unit 3 test scenarios.
- **Risk (P1): Tampered `data` branch silently corrupts reconciliation state.** `data` is unprotected by design; an actor with `contents:write` could rewrite history to flip onboarding statuses, inject fake entries, or force-push. **Mitigation (in scope):** pre-commit integrity check (see Key Technical Decisions) verifies the current `data` HEAD author is in the expected-writer allowlist (`fro-bot[bot]` + operator overrides via `RECONCILE_OPERATOR_LOGINS` env) before each commit. On mismatch, reconcile aborts and files a `reconcile:integrity-alert` issue naming the unexpected author and tip SHA. Does not prevent tampering; does catch it within 24h and refuses to compound on top of tampered state.
- **Risk (P2): App token minting fails.** `actions/create-github-app-token` can fail on: installation uninstalled, `APPLICATION_ID` rotated, `APPLICATION_PRIVATE_KEY` rotated, GitHub API outage. **Mitigation (in scope):** the workflow fails loudly (non-zero exit) when token mint fails — no silent fallback. The script's `MISSING_TOKEN` error path covers the case where `GITHUB_TOKEN` arrives empty. Failure shows up in the workflow run badge and the scheduled-cron failure notification path the operator already monitors.
- **Risk (P2): `FRO_BOT_POLL_PAT` scope insufficient to call `/user/repos`.** The PAT was originally scoped for invitation accept. Requires `repo` scope for `?affiliation=collaborator`. **Mitigation (in scope):** verify secret scope before first dispatch; if insufficient, operator rotates with broader scope. Runbook step included (see Documentation / Operational Notes). Failure mode at runtime is a 403/404 surfaced as a typed `API_ERROR` — not silent.
- **Risk (P3): rename/transfer causes false lost-access flag, then new-access detection re-adds the renamed repo.** First run would produce one `lost-access` + one `pending`/`pending-review` for the same underlying repo. Node_id tracking would fix this. Deferred. Real-world frequency: low. If observed, elevate to an in-plan requirement and add node_id cross-reference in a follow-up.
- **Dependency: `fro-bot[bot]` app must have `issues: write` and `actions: write` permissions on the control-plane repo**, plus `contents: write` on the `data` branch (already required by existing workflows). Verify installation permissions before first deploy; the workflow step for `actions/create-github-app-token` fails loudly if permissions are insufficient.

## Documentation / Operational Notes

- Update `metadata/README.md` to document the new `lost-access` and `pending-review` values, the reconcile workflow that sets them, and the public/private issue-body distinction.
- Add a note in `scripts/` README (or AGENTS.md) about the dual-Octokit convention introduced here, so future scripts follow the same pattern when they need user-scoped reads alongside app-scoped writes.
- **Operational runbook additions:**
  - **After rotating `FRO_BOT_POLL_PAT`:** confirm the rotated PAT has `repo` scope sufficient for `GET /user/repos?affiliation=collaborator`. The first scheduled reconcile run after rotation will fail with `API_ERROR` (403) if scope is insufficient; rotate again with correct scope.
  - **After rotating `APPLICATION_PRIVATE_KEY` or updating `APPLICATION_ID`:** verify `fro-bot[bot]` installation still has `contents: write`, `actions: write`, `issues: write` on `fro-bot/.github`. First reconcile run after key rotation will fail at the `create-github-app-token` step if the installation is broken.
  - **First production dispatch:** operator runs manually once after merge (`gh workflow run reconcile-repos.yaml -R fro-bot/.github`), reviews the output, confirms counts match expectations (empty state → all-zero summary; existing ha-config + any other accessible repos properly classified) before letting the daily cron take over.
- **Pending-review issue lifecycle:**
  - Operator closes issues manually after deciding: approve → change the corresponding metadata entry to `pending` and let reconcile or manual dispatch trigger Survey Repo; reject → remove the entry from `repos.yaml` via a `data`-branch commit.
  - Reconcile auto-closes any open `reconcile:pending-review` issue whose subject repo is no longer in `onboarding_status: pending-review` (promoted or removed). A small additional loop in Unit 3's issue step: list open issues with the label, cross-reference against the current `nextRepos` state, close those whose subject has moved on.
- **Pre-deploy verification (required before first dispatch):**
  - Confirm `fro-bot[bot]` installation has the required scopes on this repo: `gh api /repos/fro-bot/.github/installation --jq .permissions`. Expect `issues: write`, `actions: write`, `contents: write`.
  - Confirm `FRO_BOT_POLL_PAT` has `repo` scope (needed for `GET /user/repos?affiliation=collaborator`). If scope is narrower, rotate with broader scope before first dispatch.
- **Cross-repo impact:** Unit 1's `addRepoEntry` lift is a refactor of `scripts/handle-invitation.ts`. Post-merge, the 15-minute `poll-invitations.yaml` run continues to add entries via the shared helper. Verify on the first post-merge poll run that no regression in invitation handling occurred (metadata entries still produced with correct shape).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md](../brainstorms/2026-04-17-repo-reconciliation-requirements.md)
- Related code: `scripts/commit-metadata.ts`, `scripts/handle-invitation.ts`, `scripts/data-branch-bootstrap.ts`, `scripts/schemas.ts`, `.github/workflows/merge-data.yaml`, `.github/workflows/poll-invitations.yaml`
- Related learnings: [docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md](../solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md)
- GitHub REST: [`GET /user/repos`](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user), [`GET /repos/{owner}/{repo}`](https://docs.github.com/en/rest/repos/repos#get-a-repository)
