---
title: 'feat: auto-star contributor/collaborator repos during reconcile'
type: feat
status: complete
date: 2026-06-21
completed: 2026-06-20
origin: operator request (auto-star repos Fro Bot is a contributor/collaborator of)
---

# feat: auto-star contributor/collaborator repos during reconcile

## Overview

Fro Bot should star the repos it is a contributor/collaborator of. This happens in two
places:

1. **On invitation ingest** — already implemented: `scripts/handle-invitation.ts` calls
   `activity.starRepoForAuthenticatedUser` right after accepting an invitation (a fresh
   accept, so an unconditional star is correct there). **No change needed.**
2. **During reconciliation** — new work: for each repo Fro Bot currently has
   collaborator/contributor access to, if it is not already starred by `@fro-bot`, star it
   via the GitHub API. Self-healing: a repo that loses its star (manual unstar) is re-starred
   on the next reconcile.

This plan covers only the new **reconcile-time** path.

## Problem Frame

The invitation path stars a repo once, at accept time. But the star is never re-asserted: if
a repo is unstarred, or was added to the tracked set by reconcile discovery (owned/contrib
channels never flow through the invitation accept path), it is never starred. Reconcile is
the steady-state loop that already enumerates Fro Bot's live access; it is the natural place
to keep the star set in sync.

## Key Technical Decisions

- **Credential: `FRO_BOT_POLL_PAT` (the user PAT), NOT the App token.** A star is a *user*
  action — it must be attributed to `@fro-bot` the user. The App installation token acts as
  `fro-bot[bot]` and cannot star as the user. `handleReconcile` already holds `userOctokit`
  (`FRO_BOT_POLL_PAT`, classic `repo` scope) for `/user/repos` enumeration; the star path
  reuses it. No workflow change — the PAT is already in the reconcile job env.
- **Stateless check-then-star (no schema field).** For each candidate, call
  `activity.checkRepoIsStarredByAuthenticatedUser({owner, repo})` (cheap; 204 = starred,
  404 = not). If 404, call `activity.starRepoForAuthenticatedUser({owner, repo})`. No
  `starred` field in `metadata/repos.yaml` — the GitHub star set is the source of truth, and
  the check is self-healing (re-stars an externally-unstarred repo). Matches the operator's
  literal "if there's no star from @fro-bot, star it" and this program's
  observability/derive-over-store posture (see the `stuckCandidates` canary doc).
- **Candidate set: collab + contrib channel repos** (the literal "contributor/collaborator"
  set), resolved from `accessList` + `accessChannelByKey`. **Owned repos (`fro-bot/*`) are
  excluded** — Fro Bot owns them, it is not a collaborator there; self-starring owned repos is
  pointless. _Flippable: if owned repos should also be starred, drop the channel filter._
- **Private repos included.** A star on a private repo is visible only to those with access —
  not a public surface — so starring private collaborator repos is in scope. The check/star
  calls use the canonical `owner/name` from `accessList` **in-memory only**; telemetry is
  **counts-only** (`starsAdded` / `starFailures`), never the canonical name in any log, issue,
  or commit — same privacy discipline as the rest of reconcile.
- **Non-blocking side-effect, mirrors `runDispatches`.** A star check/call failure increments
  `starFailures` and continues; it never aborts the reconcile run (the substantive
  classification/commit work is already done). Injectable for tests.

## Context & Research

### Relevant Code and Patterns (grounded)

- `scripts/handle-invitation.ts:229` — existing invitation-time star
  (`activity.starRepoForAuthenticatedUser`). Trigger 1; unchanged.
- `scripts/reconcile-repos.ts`:
  - `handleReconcile` (I/O shell) — `userOctokit` = `FRO_BOT_POLL_PAT`; the new step slots in
    alongside the dispatch/issue side-effects (after the dispatch loop, non-blocking).
  - `runDispatches` — the exact side-effect pattern to mirror (async, per-item try/catch,
    counts-only `{succeeded, failed}`, injectable `sleep`, logger warn on failure).
  - `AccessListEntry` `{owner, name, archived, private, node_id}` + `accessChannelByKey` —
    the candidate source.
  - `HandleReconcileResult` / `ReconcileSummary` — where star counters surface.
- Octokit methods (verified real, not hallucinated): `activity.starRepoForAuthenticatedUser`,
  `activity.checkRepoIsStarredByAuthenticatedUser` (the historical `starRepo` hallucination is
  documented in `commit-metadata.ts` and a solutions doc — use the `*ForAuthenticatedUser`
  forms).

## Implementation Units

- [x] **Unit 1: reconcile-time star sync (test-first)**

**Goal:** Star collab/contrib-channel accessible repos that `@fro-bot` has not yet starred,
during each reconcile run, idempotently and non-blocking.

**Files (`fro-bot/.github`):**
- Modify: `scripts/reconcile-repos.ts` — add a `syncStars(...)` side-effect function
  (mirroring `runDispatches`); wire it into `handleReconcile` after the dispatch loop using
  `userOctokit`; iterate `accessList` filtered to collab/contrib via `accessChannelByKey`;
  check-then-star; add `starsAdded` / `starFailures` (and `starsAlreadyPresent`) to the
  result/summary; emit counts-only telemetry.
- Modify: `scripts/reconcile-repos.test.ts` — TDD coverage.
- Modify: `.github/workflows/reconcile-repos.yaml` — surface star counts in the step summary
  (counts-only) if a summary block exists; **no credential change** (PAT already present).
- Modify: `metadata/README.md` — document the reconcile auto-star behavior.

**Approach:** New `syncStars({userOctokit, candidates, logger, sleep?})`: for each candidate
`{owner, name}`, `checkRepoIsStarredByAuthenticatedUser`; on 404 (not starred)
`starRepoForAuthenticatedUser`; on 204 increment `starsAlreadyPresent`; per-item try/catch →
`starFailures` + `logger.warn` (status/kind only, no name). Candidates = `accessList` entries
whose `accessChannelByKey` channel is `collab` or `contrib`. Return `{starsAdded,
starFailures, starsAlreadyPresent}`; fold into `HandleReconcileResult` + the JSON summary.
Place the call after the dispatch loop (step ~9.5), non-blocking.

**Test scenarios:**
- Happy: an unstarred collab repo (check → 404) is starred (`starsAdded` increments,
  `starRepoForAuthenticatedUser` called with its owner/name).
- Idempotent: an already-starred repo (check → 204) is NOT re-starred (`starsAlreadyPresent`
  increments, no star call).
- Channel filter: an owned-channel repo is NOT considered (no check/star call for it).
- Private included: a private collab repo (check → 404) IS starred; assert no canonical name
  in any logged/telemetry output (counts-only).
- Non-blocking: a check or star call that rejects increments `starFailures` and the reconcile
  run still completes; subsequent candidates are still processed.
- Credential: star calls go through `userOctokit` (the PAT), never `appOctokit`.

**Verification:** `pnpm check-types`, `pnpm lint`, `pnpm test` green; strip-only load clean;
no canonical repo name reaches any log/telemetry line; star path uses the user PAT only.

## System-Wide Impact

- Adds per-repo `checkRepoIsStarredByAuthenticatedUser` calls (one per collab/contrib repo per
  reconcile) on the user PAT — negligible at the current repo count, well within rate budget;
  consistent with the per-repo field-probe calls reconcile already makes.
- No metadata schema change, no new workflow credential, no change to the data-branch
  authority model or the dispatch/commit ordering.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Star attributed to `fro-bot[bot]` instead of `@fro-bot` | Use `userOctokit` (PAT), never the App token — a star is a user action |
| Private repo name leaks via star telemetry | Canonical names used in-memory only; telemetry counts-only; per-program privacy discipline |
| Star call failure aborts reconcile | Per-item try/catch, non-blocking, counts-only `starFailures`, mirrors `runDispatches` |
| Hallucinated Octokit method | Use verified `*ForAuthenticatedUser` forms; the `starRepo` hallucination is already documented |

## Sources & References

- Existing invitation-time star: `scripts/handle-invitation.ts:229`
- Side-effect pattern: `scripts/reconcile-repos.ts` `runDispatches`
- Octokit method-name discipline: `docs/solutions/runtime-errors/` (the `starRepo` →
  `starRepoForAuthenticatedUser` learning)
