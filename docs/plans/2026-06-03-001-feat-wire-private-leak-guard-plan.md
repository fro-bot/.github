---
title: 'feat: Gate the data→main promotion with the private-leak scan'
type: feat
status: complete
date: 2026-06-03
origin: 'GitHub issue #3407'
deepened: 2026-06-03
---

# feat: Gate the data→main promotion with the private-leak scan

## Overview

`scripts/check-private-leak.ts` carries a tested pure core — `checkPrivateLeak(privateNames, diff, override)`
(33 tests) — that scans a unified diff for case-insensitive matches of private-repo tokens (`owner/name`
canonical + `owner--slug` wiki form) across added lines, new-file paths, and rename/copy destinations,
returning matched FILE paths only (never the name). The names are resolved from `data`'s redacted
`node_id` entries via a broad-scope classic PAT (`FRO_BOT_POLL_PAT`) — the only credential that can read
cross-account private repos.

This plan wires that scan into the **`data→main` promotion gate** in `.github/workflows/merge-data.yaml`,
as a blocking step beside the existing `check-wiki-private-presence` gate. It scans the promotion delta
(`main...data`) for private repo names before the promotion PR is opened, and blocks promotion on
detection.

**This is the correct enforcement point.** The leak chased on 2026-06-03 (a private `owner/name` in a wiki
page *body*) entered via the autonomous agent writing to `data`, then surfaced toward `main` through the
weekly promotion — not via a human PR. The slug-based `check-wiki-private-presence` gate misses in-body
mentions; `check-private-leak` resolves the actual names and scans the promotion content, catching exactly
that class. The promotion job is already a trusted, scheduled context with no PR-author code, so the broad
PAT runs safely there — eliminating the `workflow_run` topology, status-spoofing surface, fork-PR
derivation, and per-PR PAT fragility that a PR-time gate would require.

## Problem Frame

A private repo name can reach `main` in any promoted file — wiki body text, metadata, docs. The existing
promotion gate (`check-wiki-private-presence`) is slug/attribution-based: it blocks a private *page*
(filename) and checks public-repo attribution, but does not scan page *bodies* for arbitrary private-name
mentions. The 2026-06-03 incident proved the gap: `marcusrbrown/poly` sat in `renovate-config.md`'s body
and promoted cleanly. `check-private-leak` closes that gap by resolving the private names and scanning the
promotion delta. It exists and is tested; it needs a trusted execution context and a blocking wire-in (see
origin: issue #3407).

## Requirements Trace

- R1. The private-leak scan runs in `merge-data.yaml` and blocks the `data→main` promotion when a private
  repo name appears in the promotion delta.
- R2. The broad-scope `FRO_BOT_POLL_PAT` runs only in this trusted, no-PR-author-code job, scoped to the
  resolution step.
- R3. The gate is fail-closed: if private names cannot be fully resolved (transient/auth/rate-limit), the
  promotion is blocked, not allowed through.
- R4. Failure output names only file paths, never the resolved private name (already true in the script;
  must remain true through logs and step summaries).
- R5. The scan covers in-body mentions (the class the slug-based gate misses), reusing the existing pure
  `checkPrivateLeak` core unchanged.

## Scope Boundaries

- The pure `checkPrivateLeak` scanning core and `scripts/resolve-private.ts` are shipped — not redesigned.
- The slug-based `check-wiki-private-presence` gate stays; this scan is additive, not a replacement.
- Pre-existing leaks already on both `data` and `main` (e.g. the accepted commit-history exposure, #3424)
  are out of scope — the gate scans the promotion *delta*, consistent with that acceptance.

### Deferred to Separate Tasks

- **Per-PR-to-`main` defense-in-depth gate** (the original `workflow_run` design): a secondary layer that
  would catch a private name added by a *direct human PR* to `main` (e.g. fixtures/docs, the #3406 class).
  Deferred because (a) `check-wiki-authority` already blocks non-Fro-Bot edits to `knowledge/`+`metadata/`,
  (b) it requires the full `workflow_run` topology (status-spoofing surface, fork derivation, per-PR PAT
  SPOF) that the promotion gate avoids, and (c) the promotion gate already covers the motivating class.
  If built later, it must use an App-pinned check (not a `github.token` status) to avoid the spoofing
  surface, derive PR context from `GET /commits/{sha}/pulls` with an exact identity chain, and keep the
  PAT off PR-author code.
- **Agent-write-path invariant** (upstream): the ultimate source is the agent writing the name to `data`
  (publicly readable before promotion). A machine-checkable invariant emitted at agent-write time —
  tracked in `fro-bot/agent`, not here.
- `#3408` (agent-actionable BLOCKED output / operator-report mode).

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/merge-data.yaml` — the promotion job. Already: checks out `data` into
  `data-branch-check`, runs `check-wiki-private-presence.ts` as a blocking step (`working-directory:
  data-branch-check`), then `merge-data-pr.ts` opens the PR. Mints an App token; `permissions: contents:
  read`. The new scan slots in beside the wiki gate, before `merge-data-pr.ts`.
- `scripts/check-private-leak.ts` — pure `checkPrivateLeak(privateNames, diff, override)` (unchanged).
  `main()` currently derives a *PR* context (event payload, `gh pr diff`); this plan adds a **promotion
  mode** that instead resolves names from `data`'s `repos.yaml` and scans the `main...data` git diff.
- `scripts/private-repo-resolution.ts` — `makeGhNodeIdResolver(token)` is the seam for passing the PAT to
  only the resolution step.
- `scripts/check-wiki-private-presence.ts` — the sibling gate; mirror its blocking-step shape and redacted
  output. Note it is slug/attribution-based (the gap this scan fills).

### Institutional Learnings

- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — verify privacy inside
  the trusted workflow before any public side effect.
- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — keep canonical
  `owner/repo` opaque; fail-closed with opaque IDs.
- `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md` — never
  `2>/dev/null` a gate's stderr; PAT policy failures hide until runtime.
- `docs/solutions/best-practices/autonomous-pipeline-minimum-progress-floor-2026-05-17.md` — a fallback
  path must reuse the exact fail-closed predicates of the main gate.

### External References

- The promotion gate needs no `workflow_run`/status/branch-protection mechanics — it is a blocking job
  step, identical in shape to the existing `check-wiki-private-presence` gate. (The `workflow_run` research
  from the prior plan revision applies only to the deferred per-PR layer.)

## Key Technical Decisions

- **Enforce at the `data→main` promotion, not per-PR.** This is the trusted chokepoint where private names
  reach the canonical public branch, it matches the motivating leak's actual path (agent→`data`→promotion),
  and it runs the broad PAT safely (no PR-author code). It dissolves the status-spoofing, fork-derivation,
  override-forgery, and per-PR-PAT-SPOF findings the per-PR design carried.
- **Scan the promotion delta (`main...data`).** Newly-promoted content is what this gate is responsible
  for; pre-existing both-branch content is out of scope (consistent with the #3424 history acceptance).
  Use a three-dot diff (`git diff origin/main...origin/data`) so the scan reflects what promotion adds to
  `main`.
- **Reuse the pure core; add a promotion entry path.** Feed `checkPrivateLeak` the git diff + the resolved
  names. The PR-context derivation (`readPullRequestContext`, `gh pr diff`) is not used in this path.
- **PAT scoped to the resolver step.** Pass `FRO_BOT_POLL_PAT` only to `makeGhNodeIdResolver(token)`; the
  diff is local git, no token needed for it.
- **Exhaustive resolution matrix (fail-closed).** Define the outcome for every resolution result:
  `access-lost` (deleted/no-access) → skip that node_id (no current content to leak); any other failure
  (transient/auth/rate-limit/unknown) → **block promotion** (cannot guarantee a complete scan); all
  resolved + no diff match → allow.
- **Block exactly like the wiki gate.** On detection or unresolved-failure, the step exits non-zero before
  `merge-data-pr.ts` runs, so no promotion PR is opened. Redacted output (file paths only) to stderr +
  step summary.

## Open Questions

### Resolved During Planning

- Enforcement point → **`data→main` promotion gate** (document-review convergent finding; per-PR deferred
  to defense-in-depth).
- Scan target → **`main...data` three-dot diff** (the promotion delta).
- Override mechanism → **none needed** — the promotion job is operator-supervised (scheduled/dispatch); an
  operator who must promote a flagged-but-acceptable state edits `data` or re-runs after redaction.
- Status posting / required-check registration → **not applicable** — blocking step, not a posted status.

### Deferred to Implementation

- Whether promotion mode is a flag/subcommand of `check-private-leak.ts` or a thin sibling entrypoint that
  imports `checkPrivateLeak` — decide when writing Unit 1 (favor the smallest change that keeps the PR
  path intact and untested-by-this-plan).
- Exact git plumbing for the delta in CI (the job has both `main` checkout and the `data-branch-check`
  subtree; whether to `git fetch origin main data` and diff refs, or diff the two working trees) — settle
  against the live checkout layout.
- Whether to also emit a GitHub step-summary table of matched files (paths only) for operator visibility.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

```
merge-data.yaml (schedule / workflow_dispatch — trusted, no PR-author code)
  ├─ mint App token
  ├─ checkout main (scripts)  +  checkout data → data-branch-check
  ├─ step: check-wiki-private-presence.ts        (existing slug/attribution gate — blocks)
  ├─ step: check-private-leak.ts  [promotion mode]   ← NEW blocking gate
  │     1. resolve private node_ids → names      (FRO_BOT_POLL_PAT, this step only)
  │          └─ any non-access-lost failure → exit 1 (block, fail-closed)
  │     2. diff = git diff origin/main...origin/data
  │     3. checkPrivateLeak(names, diff) → ok | matchedFiles
  │          └─ matchedFiles → exit 1 (block), redacted report (paths only)
  └─ step: merge-data-pr.ts                       (only runs if both gates pass)
```

## Implementation Units

- [x] **Unit 1: Add a promotion-scan path to `check-private-leak.ts`**

**Goal:** Resolve private names from `data`'s `repos.yaml` and scan the `main...data` diff using the
existing pure core, with an exhaustive fail-closed resolution matrix — without disturbing the existing
PR-path code.

**Requirements:** R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `scripts/check-private-leak.ts`
- Modify: `scripts/check-private-leak.test.ts`
- Reference (no change): `scripts/private-repo-resolution.ts`, `scripts/check-private-leak.ts`'s pure
  `checkPrivateLeak`

**Approach:**
- Add a promotion entry path (flag/subcommand or sibling entrypoint — decided in implementation) that:
  reads private node_ids from `data`'s `repos.yaml` (the job already has the `data` subtree), resolves each
  via `makeGhNodeIdResolver(FRO_BOT_POLL_PAT)`, builds the `owner/name` + `owner--slug` token set, obtains
  the `main...data` diff, runs `checkPrivateLeak(tokens, diff)`, and exits non-zero with a redacted report
  on match.
- Implement the exhaustive resolution matrix: `access-lost` → skip; any other failure → exit non-zero
  (block); success → include token. Keep all redaction guarantees (paths only; no resolved name in any
  output).
- Leave the existing PR-context path (`readPullRequestContext`, `fetchPrDiff`, override comment) intact and
  unused by this path, so the shipped PR-path tests stay green.

**Execution note:** Test-first. Add failing tests for the resolution matrix and the diff-scan promotion
path before adding the entry code.

**Patterns to follow:**
- `makeGhNodeIdResolver(token)` token-injection seam.
- The existing redacted-output + fail-closed-on-unresolved logic already in `check-private-leak.ts`.
- `check-wiki-private-presence.ts` reads `data`'s `repos.yaml` from the subtree — mirror that input source.

**Test scenarios:**
- Happy path: all private node_ids resolve; `main...data` diff has no private token → exit 0 (allow).
- Happy path: diff added line contains a private `owner/name` (in-body mention) → exit non-zero,
  `matchedFiles` lists the file, output contains no resolved name.
- Edge case: a private token appears as a new wiki page path (`owner--slug.md`) → detected via the new-path
  surface.
- Error path: a node_id returns a non-`access-lost` failure (transient/auth) → exit non-zero (block), no
  name leaked.
- Edge case: an `access-lost` node_id is skipped (not fatal); scan proceeds on the rest.
- Edge case: no private entries in `data`'s `repos.yaml` → exit 0 (nothing to scan).
- Integration: the broad PAT is passed only to the resolver; the diff is obtained from local git with no
  token (assert via injected client/spy).

**Verification:** New promotion-path tests cover the full resolution matrix and diff/new-path detection;
the pure `checkPrivateLeak` tests and the existing PR-path tests remain green; no resolved name appears in
any asserted output.

- [x] **Unit 2: Wire the promotion scan into `merge-data.yaml` as a blocking gate**

**Goal:** Run the promotion scan in the trusted promotion job, with `FRO_BOT_POLL_PAT` scoped to that step,
blocking the promotion before `merge-data-pr.ts` on detection or unresolved failure.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/merge-data.yaml`

**Approach:**
- Add a step after `🔒 Block private wiki pages` and before `🔀 Open weekly data merge PR` that runs the
  promotion scan. Provide `FRO_BOT_POLL_PAT` in that step's `env` only (not job-level); keep the diff
  computed from local git refs (`git fetch origin main data` as needed, three-dot diff).
- Because the step exits non-zero on detection/unresolved-failure, `merge-data-pr.ts` does not run and no
  promotion PR is opened — identical blocking semantics to the existing wiki gate.
- Add `FRO_BOT_POLL_PAT` to the workflow's secret usage. Keep `permissions: contents: read`.

**Execution note:** YAML-only; validate with `actionlint`. Confirm the secret is declared where the
workflow contract requires it.

**Patterns to follow:**
- The existing `🔒 Block private wiki pages` step (blocking gate shape, `data-branch-check` subtree).
- Per-step secret scoping used across the App-token workflows (secret in step `env`, never job-level).

**Test scenarios:** Test expectation: none — workflow YAML with no executable unit surface. Validation is
`actionlint` + a live `workflow_dispatch` of `Merge Data Branch` confirming a seeded private-name in the
`data` delta blocks promotion and a clean delta promotes.

**Verification:** `actionlint` clean; a `workflow_dispatch` run with a private name present in the `data`
delta exits at the new gate and opens no PR; a clean run proceeds to `merge-data-pr.ts`; the PAT appears
only in the new step's environment.

## System-Wide Impact

- **Interaction graph:** Adds one blocking step to `merge-data.yaml`; no change to `check-wiki-private-presence`,
  `merge-data-pr.ts`, or the PR-path of `check-private-leak.ts`.
- **Error propagation:** Detection or unresolved-resolution → non-zero exit → promotion PR not opened
  (fail-closed). No new status or branch-protection surface.
- **State lifecycle risks:** None of the SHA-race / fork-derivation / status-staleness risks of the per-PR
  design apply — there is no PR context and no posted status here.
- **API surface parity:** None — internal gate.
- **Integration coverage:** A live `workflow_dispatch` must confirm the blocking behavior end-to-end
  (resolution + diff + block) before relying on the gate; unit tests cover the script, not the wiring.
- **Unchanged invariants:** The pure `checkPrivateLeak`, `resolve-private.ts`, the existing PR-path,
  `check-wiki-private-presence`, and `merge-data-pr.ts` are all unchanged.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PAT rotation/expiry/rate-limit blocks the weekly promotion (fail-closed) | Med | Med | Scope shrunk from "every PR" to "weekly promotion" (operator-supervised); resolution failure is observable in the run; operator re-runs after token fix |
| Pre-existing both-branch leak not caught (delta-only scan) | Low | Low | Intentional — pre-existing/historical exposure is accepted (#3424); the agent-write-path invariant (upstream) is the ultimate source control |
| Data branch publicly readable before promotion — gate is downstream of the true source | Med | Med | Accepted: promotion gate is the best trusted chokepoint in this repo before the canonical `main` record; agent-write-path hardening tracked upstream in `fro-bot/agent` |
| Resolved private name leaks via step output/log | Low | High | Reuse the script's redaction (paths only); assert no name in output; never `2>/dev/null` the step |

## Documentation / Operational Notes

- Note the new promotion gate in `metadata/README.md` (promotion section) once Unit 2 lands.
- After the live `workflow_dispatch` exercise, capture the promotion-gate pattern in a
  `docs/solutions/security-issues/` learning (the in-body scan closes the gap the slug gate left).

## Sources & References

- **Origin document:** GitHub issue #3407 (Wire Check Private Leak in a trusted topology)
- Related code: `scripts/check-private-leak.ts`, `scripts/private-repo-resolution.ts`,
  `.github/workflows/merge-data.yaml`, `scripts/check-wiki-private-presence.ts`
- Related issues: #3408 (operator-report mode), #3424 (history-exposure acceptance), #3327 (defense-in-depth
  parent, closed)
- Decision context: document-review on 2026-06-03 (adversarial 0.96 + product-lens 0.94 convergent finding)
  pivoted enforcement from per-PR to the promotion gate, dissolving the status-spoofing, fork-derivation,
  override-forgery, and per-PR-PAT-SPOF risks of the prior revision.
