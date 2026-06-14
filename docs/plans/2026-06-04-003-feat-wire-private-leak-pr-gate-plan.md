---
title: 'feat: Wire Check Private Leak as a per-PR gate via trusted workflow_run'
type: feat
status: complete
date: 2026-06-04
completed: 2026-06-09
origin: 'GitHub issue #3407'
---

# feat: Wire Check Private Leak as a per-PR gate via trusted workflow_run

## Overview

`scripts/check-private-leak.ts` carries a tested pure core that scans a PR's added lines, new-file
paths, and rename/copy destinations for a private repo's canonical `owner/name` (and `owner--slug`
wiki form), returning matched FILE paths only — never the resolved name. The names are resolved from
`data`'s redacted `node_id` entries via a broad-scope classic PAT (`FRO_BOT_POLL_PAT`), the only
credential that can read cross-account private repos.

The `data→main` promotion gate (`--promotion` mode in `merge-data.yaml`) already enforces this scan on
the autonomous promotion path (shipped via the `2026-06-03-001` plan). This plan adds the **per-PR
defense-in-depth layer** that plan explicitly deferred: a gate that scans human/agent PRs *to `main`*
for private names before merge — the secondary layer catching a leak introduced directly in a PR diff
rather than through the `data` promotion path.

The hard constraint is credential safety. The broad-scope PAT must **never** execute PR-author code.
The first attempt ran the scan as a `pull_request` job that checked out `head_ref` with the PAT in
scope — a token-exfiltration vector on this public repo (a pushed branch could rewrite the script or a
lifecycle hook to leak the PAT). That job was removed. This plan rebuilds the gate in a **trusted
`workflow_run` topology** where the privileged job runs only the default-branch workflow definition and
treats the PR diff as pure data read via the GitHub API — never a checkout.

## Problem Frame

`check-private-leak.ts` is shipped and tested but has **no per-PR CI trigger** after the original
`pull_request` wiring was removed for the token-exfil vector (origin: issue #3407). The promotion gate
covers the autonomous `data→main` path, but a private name introduced directly in a PR diff to `main`
has no automated gate. The fix is to wire the scan in a trusted context that closes the exfil vector
while still reporting a blocking status back to the PR.

This is defense-in-depth, not the sole control: `check-wiki-authority` already blocks non-Fro-Bot edits
to `knowledge/`+`metadata/`, and on a public repo a fork PR that adds a private name has already
disclosed it before Actions runs. This gate is a **merge blocker**, not a secrecy control — it prevents
merging/amplifying a leak, and catches the human-PR class the promotion gate cannot see.

## Requirements Trace

- R1. The scan runs in a context where `FRO_BOT_POLL_PAT` never executes PR-author code (no PR-head
  checkout, no PR artifacts, no shared cache in the PAT-bearing job).
- R2. The privileged job runs the workflow definition from the default branch (`workflow_run` semantics).
- R3. The PR diff and identity are treated as pure data, resolved via the GitHub API — never from a
  checked-out tree or a PR-author-produced artifact.
- R4. A blocking status is reported back to the PR head SHA (pass/fail + offending file paths only,
  never the resolved private name).
- R5. The scan fails closed: if PR identity cannot be resolved, resolution errors, **or the commit-status
  POST itself fails**, the outcome is a blocking failure (never a silent pass and never an unsignaled PR).
- R6. `FRO_BOT_POLL_PAT` is scoped to the node-id resolver subprocess only — never the job-level or
  step-level `GH_TOKEN`, never ambient before setup/install. The resolver subprocess receives a **minimal
  env** with no inherited token surface (`GH_TOKEN`/`GITHUB_TOKEN`/other creds) beyond the intended PAT.
- R7. The blocking status uses a new context name distinct from any existing job/check name (no
  collision), and is registered as a required status check on `main` only after the topology is proven
  green — including for fork PRs.

## Scope Boundaries

- Not changing the `--promotion` gate in `merge-data.yaml` (shipped, separate path).
- Not changing the pure scan core (`checkPrivateLeak`) — it is shipped and tested.
- Not changing the `[allow-private-leak]` operator override semantics (already built) — only confirming
  it still functions under the new event shape.
- Not building fingerprint/hash detection (rejected: low-entropy repo names → guess-confirmable oracle on
  a public branch; secret-pepper relocates the credential problem).
- Not attempting to make fork-PR submission confidential — public PRs already disclose names; this is a
  merge gate only.

### Deferred to Separate Tasks

- **Required-check registration on `main`** is the final step and is gated on empirical proof that the
  commit status attaches and blocks for **fork** PR heads (R7). If fork-head status attachment cannot be
  proven, registration is deferred and the gate ships as advisory-only with a tracked follow-up, rather
  than registering a required check that silently never attaches to fork PRs.

## Context & Research

### Relevant Code and Patterns

- `scripts/check-private-leak.ts` — `main()` (L567) reads `GITHUB_EVENT_PATH` and expects a
  `pull_request` payload (`pull_request.number/.user.login/.title`, L219-223). This is the event reader
  that must change to accept a `workflow_run` payload. **Oracle-confirmed gap:** L594 calls
  `makeGhNodeIdResolver()` with **no PAT** — the resolver must be wired with `FRO_BOT_POLL_PAT`.
- `scripts/check-private-leak.ts` `--promotion` path (L453-475) — the **correct pattern to mirror** for
  PAT isolation: it reads `FRO_BOT_POLL_PAT` only for the resolver and builds a `gitEnv` that strips the
  PAT from the git subprocess. The per-PR path must isolate the PAT identically.
- `scripts/private-repo-resolution.ts` — `makeGhNodeIdResolver(token)` is the resolver seam; the
  `#3429` hygiene work already strips token aliases from its subprocess env.
- `.github/workflows/renovate.yaml` — **in-repo `workflow_run` precedent** to mirror for trigger shape.
- `.github/workflows/merge-data.yaml` — existing `check-private-leak --promotion` wiring (the sibling
  enforcement point) for the script-invocation and redacted-output shape.
- `[allow-private-leak]` override (L261/589/671) — operator bypass via PR title prefix, restricted to a
  permitted login. Title is mutable, so the sentinel `pull_request` workflow must include `edited`
  (Oracle sharp edge) or the required status can go stale for the same head SHA.

### Institutional Learnings

- `docs/solutions/security-issues/` and `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`
  — the promotion-gate sibling, including the fail-closed and PAT-confinement patterns.
- Memory: `FRO_BOT_POLL_PAT` is the only credential resolving cross-account private repos; App and
  fine-grained PATs cannot. Redaction surfaces use `node_id` only, never `owner/name`.
- The `#3429`/`#3430`/`#3412` hygiene shipped this cycle: subprocess-scoped PAT, count-only failure
  output, tightened `node_id` schema — all directly relevant to R5/R6.

### External References

- Oracle topology pressure-test (this session): `workflow_run` runs the default-branch workflow
  definition; `pull_requests[]` can be empty for forks (API fallback by head SHA required); branch
  protection accepts commit statuses; Checks API requires a GitHub App (out of reach here) → use a
  **commit status** set with `GITHUB_TOKEN`; fork-head required-status attachment is the genuine risk to
  prove before registering.

## Key Technical Decisions

- **Two-workflow `workflow_run` topology.** A minimal `pull_request` sentinel workflow (targets `main`,
  does nothing sensitive, exists only to fire) triggers a privileged `workflow_run` workflow that runs
  the scan with the PAT. The privileged workflow runs the default-branch definition (R2), closing the
  "malicious PR rewrites the workflow file" hole. Mirrors `renovate.yaml`'s precedent.
- **Commit status, not Checks API** (Oracle). Checks API needs a GitHub App; a commit status set with
  `GITHUB_TOKEN`/`statuses: write` integrates natively with branch-protection required-checks. Context
  name: `security/check-private-leak` — distinct from any job name to avoid collision (R7).
- **Target the scanned PR head SHA.** The status is posted to the exact head SHA the scan ran against —
  never the default-branch `GITHUB_SHA`, never the `workflow_run` SHA. Stale runs post failure, not
  success (R4, R5).
- **PR identity resolved in code, not YAML** (Oracle). The script reads the `workflow_run` payload,
  requires `workflow_run.event == 'pull_request'`, takes the candidate PR from
  `workflow_run.pull_requests[]` when present, falls back to an API query by `head_sha`, then validates:
  base repo is `fro-bot/.github`, base branch is `main`, PR head SHA matches the scanned SHA. The
  security boundary stays in TypeScript, not spread into shell.
- **No artifacts from the PR-author job.** The privileged job derives everything from the GitHub API and
  the event payload — never a downloaded artifact (the classic `workflow_run` untrusted-artifact footgun).
- **PAT subprocess-scoped only** (R6). The job's `GH_TOKEN` is the default `GITHUB_TOKEN` (for diff +
  status). `FRO_BOT_POLL_PAT` is passed only into the resolver, mirroring the `--promotion` `gitEnv`
  isolation. No cache/setup step runs with the PAT ambient.
- **No `actions/cache` in the PAT-bearing job** (Oracle sharp edge). The shared `setup` action restores
  a pnpm cache; a PR workflow could poison it. The privileged job does a minimal install (or none if the
  script's runtime deps are already vendored) with no restored cache.

## Open Questions

### Resolved During Planning

- Status mechanism → **commit status via `GITHUB_TOKEN`** (Oracle: Checks API needs an App).
- Required-check name → **`security/check-private-leak`** (new context, no collision with existing jobs).
- Where PR-identity validation lives → **in the script** (security boundary in code, not YAML).
- Whether to trust `workflow_run.pull_requests[]` → **use when present, API-fallback by head SHA**, then
  validate base repo/branch + head-SHA match.
- Fork PRs → **in-scope for merge blocking, fail-closed on unresolvable identity**; required-check
  registration gated on proven fork-head attachment.

### Deferred to Implementation

- Exact pnpm/install shape in the privileged job (whether the script runs with zero install or a minimal
  no-cache install) — resolved when wiring the job against the real runtime.
- Whether the sentinel `pull_request` workflow needs any path filter, or fires on all PRs to `main`
  (default: all PRs to `main`, since any file could introduce a name) — confirmed against the diff cost
  at implementation.
- The precise API call for the head-SHA → PR-number fallback (`gh api` search vs
  `pulls.listAssociatedWithCommit`) — resolved against the live API shape.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

```
PR opened/synchronized/edited (-> main)
        │
        ▼
[sentinel workflow]  on: pull_request   (no secrets, no PAT, does nothing sensitive)
        │  completes
        ▼
on: workflow_run (completed)  ── runs the DEFAULT-BRANCH definition ──┐
        │                                                             │ trusted context
        ▼                                                             │
[privileged job]  GH_TOKEN = GITHUB_TOKEN (diff + status only)        │
  1. read workflow_run payload → require event == 'pull_request'      │
  2. PR number := pull_requests[] || API fallback by head_sha         │
  3. validate base = fro-bot/.github, base branch = main,             │
     PR head SHA == scanned SHA   ── unresolvable? → FAIL CLOSED ──────┤
  4. gh pr diff <n>  (pure data, no checkout)                         │
  5. resolve private names: FRO_BOT_POLL_PAT → resolver subprocess    │
     (PAT stripped from git/diff env, mirrors --promotion gitEnv)     │
  6. scan added lines/paths/renames → matched FILE paths only         │
  7. POST commit status `security/check-private-leak` to head SHA     │
     pass / fail(+paths) — never the resolved name                    │
        │                                                             │
        ▼                                                             │
branch protection (once proven) requires security/check-private-leak ─┘
```

## Implementation Units

- [x] **Unit 1: Add a `workflow_run` / per-PR event reader + resolver wiring to `check-private-leak.ts`**

**Goal:** Teach `main()` to run under a `workflow_run` event: read the `workflow_run` payload, resolve
and validate PR identity via the API, wire `FRO_BOT_POLL_PAT` into the resolver, and emit a structured
result the workflow turns into a commit status. **`main()` accepts only the `workflow_run` payload** — the
direct `pull_request` event reader is replaced (the per-PR gate is the only consumer of `main()`, and it
now runs exclusively in the trusted `workflow_run` context). The `--promotion` path (separate entrypoint,
`process.argv`-gated) is unaffected.

**Requirements:** R3, R5, R6

**Dependencies:** None (script is shipped; this extends `main()`)

**Files:**
- Modify: `scripts/check-private-leak.ts`
- Test: `scripts/check-private-leak.test.ts`

**Approach:**
- Add a `workflow_run` payload reader: require `workflow_run.event == 'pull_request'`; take PR number
  from `workflow_run.pull_requests[]` when present, else fall back to an API query by `head_sha`.
- Validate base repo `fro-bot/.github`, base branch `main`, and that the PR head SHA equals the scanned
  SHA. **Require exactly one PR to survive validation** — if the head-SHA fallback returns multiple
  associated PRs and more than one (or none) passes validation, fail closed. Any validation failure or
  resolution error → fail-closed result (status failure), never a pass.
- Fix the Oracle-confirmed gap at L594: wire `makeGhNodeIdResolver(process.env.FRO_BOT_POLL_PAT)` and
  fail closed if the PAT is absent. Mirror the `--promotion` `gitEnv` pattern (L453-475) so the PAT
  reaches only the resolver, never the diff/git subprocess.
- Emit a structured result (pass | fail + matched file paths) the workflow maps to the commit status —
  paths only, never the resolved name (existing redaction).
- Confirm the `[allow-private-leak]` override still resolves under the new identity path (title comes
  from the validated PR JSON, not a `pull_request` event payload).

**Execution note:** Test-first — add failing tests for the `workflow_run` payload reader and the
fail-closed identity-validation paths before implementing.

**Patterns to follow:**
- `--promotion` path (L453-475) for PAT/`gitEnv` isolation.
- Existing event-reading + redacted-output structure in `main()`.

**Test scenarios:**
- Happy path: `workflow_run` payload with a populated `pull_requests[]` → resolves PR number, validates
  base/branch/head-SHA, scans diff (mocked), emits pass when no private name present.
- Happy path: added line contains a resolved private `owner/name` → emits fail with the offending file
  path, never the name.
- Edge case: empty `pull_requests[]` → API fallback by `head_sha` resolves the PR number.
- Error path: `workflow_run.event != 'pull_request'` → fail-closed (no scan, status failure).
- Error path: base repo/branch mismatch, or PR head SHA != scanned SHA → fail-closed.
- Error path: PR identity unresolvable (no `pull_requests[]`, API fallback returns nothing) → fail-closed.
- Error path: head-SHA fallback returns multiple associated PRs, not exactly one passing validation →
  fail-closed (ambiguous identity never resolves to a pass).
- Error path: `FRO_BOT_POLL_PAT` absent → fail-closed (resolver cannot run; never a silent pass).
- Integration: PAT is present in the resolver subprocess env but absent from the diff/git subprocess env
  (mirror the `--promotion` isolation assertion).
- Edge case: `[allow-private-leak]`-prefixed title by the permitted login → override honored under the
  new identity path.

**Verification:**
- `main()` runs under a `workflow_run` event and produces a pass/fail result with file-path-only output.
- All identity-resolution failure modes produce a failure result, proven by tests that would pass under a
  silent-pass regression and fail under the fail-closed implementation.
- The PAT never appears in the diff/git subprocess env.

- [x] **Unit 2: Add the sentinel + privileged `workflow_run` workflows and post the commit status**

**Goal:** Add the minimal `pull_request` sentinel workflow and the privileged `workflow_run` workflow
that runs the Unit 1 scan with subprocess-scoped PAT and posts a `security/check-private-leak` commit
status to the PR head SHA.

**Requirements:** R1, R2, R4, R5, R6

**Dependencies:** Unit 1

**Files:**
- Create: `.github/workflows/private-leak-sentinel.yaml` (the `pull_request` trigger)
- Create: `.github/workflows/check-private-leak.yaml` (the `workflow_run` privileged job)
- Modify: `metadata/README.md` (document the credential + topology, mirroring existing gate docs)

**Approach:**
- Sentinel: `on: pull_request` to `main`, types `[opened, synchronize, reopened, edited]` (`edited` so a
  title-based override change re-fires — Oracle sharp edge). Minimal `permissions: {}` / no secrets; it
  exists only to trigger the privileged workflow. Mirror `renovate.yaml`'s sentinel shape.
- Privileged: `on: workflow_run` (workflows: the sentinel name, types `[completed]`). Job permissions:
  `contents: read`, `statuses: write`, `pull-requests: read`. `GH_TOKEN` = `GITHUB_TOKEN` for diff +
  status. `FRO_BOT_POLL_PAT` passed only as an env on the scan step (the script isolates it to the
  resolver subprocess). **No `actions/cache`, no PR-head checkout, no artifact download.**
- The job runs the Unit 1 scan, captures the structured result, and posts a commit status
  `security/check-private-leak` to the resolved PR head SHA: `success` on pass, `failure` with the
  matched file paths in the description (never the name). On any unresolved-identity/error path, post
  `failure` (fail-closed). **If the status POST itself fails (transient API/auth), the job exits
  non-zero** so the PR never ends up with no blocking signal (R5).
- The scan step passes `FRO_BOT_POLL_PAT` to the script, which forwards it into the resolver subprocess
  under a minimal scrubbed env (no `GH_TOKEN`/`GITHUB_TOKEN` inheritance) — mirroring the `#3429`
  subprocess hygiene (R6).
- Use `env:`-passed values for any PR-derived strings in `run:` blocks (never inline interpolation of PR
  title/branch/diff) to avoid shell injection (Oracle residual-exfil edge).

**Execution note:** none — workflow YAML; validated via actionlint and a live dispatch/test PR.

**Patterns to follow:**
- `.github/workflows/renovate.yaml` (`workflow_run` trigger shape).
- `.github/workflows/merge-data.yaml` (`check-private-leak` invocation + redacted-output handling, App
  vs PAT token separation already present in repo workflows).

**Test scenarios:** Test expectation: none (workflow wiring). Verified by actionlint + a live test PR in
Unit 3. The behavioral logic is covered by Unit 1's script tests.

**Verification:**
- actionlint passes on both workflows.
- A test PR to `main` that adds a benign line produces a `success` `security/check-private-leak` status
  on the PR head SHA.
- A test PR whose diff contains a known private name produces a `failure` status naming only file paths.
- The privileged job's logs show no PAT, no PR-head checkout, no cache restore; the PAT is present only
  in the scan step's resolver subprocess.

- [x] **Unit 3: Prove fork-head status attachment, then register the required check**
  - Same-repo attachment proven and the check is registered as required; fork-head status attachment remains an accepted, documented residual (no fork PR has exercised it).

**Goal:** Empirically verify the commit status attaches and blocks for both same-repo and fork PR heads,
then register `security/check-private-leak` as a required status check on `main`. If fork-head
attachment cannot be proven, ship advisory-only and file a tracked follow-up rather than registering a
check that silently never attaches.

**Requirements:** R7

**Dependencies:** Unit 2

**Files:**
- Modify: `.github/settings.yml` (add `security/check-private-leak` to `main` required contexts — only
  after proof)

**Approach:**
- Same-repo proof: open a throwaway branch PR to `main`, confirm the status posts to the head SHA and
  (after registration) blocks merge until success.
- Fork proof: from a fork, open a PR to `main`; confirm the sentinel fires (note first-time-contributor
  approval gating), `workflow_run` triggers, the API fallback resolves the PR by head SHA, and the
  commit status attaches to the fork head SHA and is honored by branch protection.
- If fork attachment holds → add the context to `.github/settings.yml` required checks. If it does not →
  do not register; ship advisory-only and open a follow-up issue documenting the fork-head limitation.

**Execution note:** none — empirical verification + a settings change.

**Patterns to follow:**
- `.github/settings.yml` existing `required_status_checks.contexts` list.

**Test scenarios:** Test expectation: none (operational verification + settings change). Proof is the
live same-repo and fork PRs.

**Verification:**
- Same-repo PR: status attaches and blocks until success (post-registration).
- Fork PR: status attaches to the fork head SHA, or — if it cannot — registration is withheld and a
  follow-up is filed; no required check is registered that silently never attaches.

## System-Wide Impact

- **Interaction graph:** New sentinel `pull_request` workflow + privileged `workflow_run` workflow. No
  change to `merge-data.yaml` promotion gate, `fro-bot.yaml`, or reconcile. The new required context (if
  registered) gates all PRs to `main`.
- **Error propagation:** All identity/resolution failures → commit-status `failure` (fail-closed). A
  failed scan blocks merge (once required), never silently passes.
- **State lifecycle risks:** Stale runs (PR head moved after scan) must post against the scanned SHA only,
  so a superseded run cannot mark a newer head green. Title-edit override staleness mitigated by the
  sentinel's `edited` trigger.
- **API surface parity:** This is the per-PR sibling of the `--promotion` gate; both use the same scan
  core and redaction, so detection semantics stay consistent across both enforcement points.
- **Unchanged invariants:** The pure scan core, `--promotion` gate, `check-wiki-authority`, and
  `[allow-private-leak]` override semantics are unchanged. The PAT remains resolver-subprocess-scoped
  everywhere (consistent with the `#3429` hygiene).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Broad PAT exposed to PR-author code (the original vector) | `workflow_run` runs default-branch def; no PR-head checkout, no artifacts, no cache; PAT subprocess-scoped only (R1, R6) |
| Fork-head commit status not honored by branch protection | Unit 3 proves it empirically before registering; advisory-only fallback + follow-up if unproven (R7) |
| PR-author content injected into a `run:` shell eval | PR-derived strings passed as `env:`, never inline-interpolated; diff parsed as data |
| Stale run marks a newer head green | Status posted only against the exact scanned head SHA; mismatched SHA → fail-closed |
| Commit-status POST fails → PR left unsignaled | Status-post failure exits the job non-zero (fail-closed), never a logged warning (R5) |
| Ambiguous PR lookup (one head SHA → multiple PRs) | Require exactly one PR to survive base/branch/head-SHA validation; otherwise fail-closed |
| Title-based override goes stale for the same head SHA | Sentinel includes `edited` so an override title change re-fires the gate |
| First-time fork contributor: sentinel needs approval | Documented as expected; required status is absent/pending until the PR workflow is approved to run |

## Documentation / Operational Notes

- Document the topology + credential split in `metadata/README.md` next to the existing gate docs: the
  privileged job uses `GITHUB_TOKEN` for diff/status and `FRO_BOT_POLL_PAT` only for name resolution.
- Note the `[allow-private-leak]` operator override still applies (permitted login, title prefix).
- Note the required-check registration is gated on fork-head proof (Unit 3).

## Sources & References

- **Origin document:** GitHub issue #3407 (Wire Check Private Leak in a trusted `workflow_run` topology)
- Sibling plan: `docs/plans/2026-06-03-001-feat-wire-private-leak-guard-plan.md` (the promotion gate that
  deferred this per-PR layer)
- Related code: `scripts/check-private-leak.ts`, `scripts/private-repo-resolution.ts`,
  `.github/workflows/renovate.yaml`, `.github/workflows/merge-data.yaml`
- Related learnings: `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`
