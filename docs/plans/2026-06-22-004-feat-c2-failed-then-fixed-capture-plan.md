---
title: 'feat: C2 failed-then-fixed capture trigger'
type: feat
status: active
date: 2026-06-22
origin: docs/brainstorms/2026-06-22-c2-failed-then-fixed-capture-requirements.md
---

# feat: C2 failed-then-fixed capture trigger

## Overview

Add a second candidate source to the learning-capture pipeline: merged PRs whose CI checks
transitioned **failed → passed** before merge. For each, the digest carries the fixing diff
(primary signal, always available) plus a best-effort failing-log excerpt, privacy-scanned —
including a new secret/redaction scan because logs and diffs leak more than repo names. Both
triggers share the existing propose-only pipeline (opaque digest → agent authors → privacy
gate → `learning-proposal` issue); a discriminated `Candidate` union keeps dedup, cap, and
privacy uniform. This broadens the "grow" half of grow-and-learn with one more clean,
high-signal trigger (see origin).

## Problem Frame

A CI failure that gets fixed before merge is a concentrated mistake→correction event: a named
check went red, a diff turned it green. That structured signal is exactly what produced good
learnings from review prose, and what the title-only first cut lacked. Today the capture run
only learns from review-heavy PRs; C2 adds the failed-then-fixed source. The origin doc gated
C2 on "multi-round-review precision proven," which is met; the accepted value-gate risk
(corpus adoption not yet measured) is recorded in the origin.

## Requirements Trace

- R1. Identify merged PRs (same lookback, this repo) whose checks transitioned failed→passed
  before merge (see origin R1).
- R2. The digest carries the fixing diff (primary) + best-effort failing-log excerpt + failed
  check name(s); the agent distills "this failure → this fix" (origin R2).
- R3. New log/diff content passes the existing private-repo-name scan **plus a new
  secret/URL/path scan** before reaching the agent (origin R3).
- R3a. On a secret/private hit: redact in the harvest excerpt where safe, else drop the
  enriched content; the candidate may proceed only on already-clean signal; the open-step body
  scan blocks any residual secret (origin R3a).
- R4. One learning-proposal per merge SHA — a PR matching both triggers yields one proposal
  (origin R4); the existing merge-SHA marker dedups.
- R5. Reuse the pipeline end to end: opaque digest, shared privacy module, marker, label, cap,
  workflow — a new candidate source, not a new pipeline (origin R5).
- R6. Counts-only telemetry; the harvest summary gains per-trigger candidate counts (origin R6).

## Scope Boundaries

- C2 (failed-then-fixed) only, this repo only, same `LOOKBACK_DAYS = 30`.
- "Failed then passed" requires a real fixing diff (not a bare green re-run with no change).
- No change to the propose-only model, dedup marker, or per-run cap (shared budget).

### Deferred to Separate Tasks

- C3 (issue triage) — murky free-text signal; revisit with a structured proxy after C2 proves out.
- C4 (cross-run synthesis) — Phase 3.
- Cross-repo C2 — later; v1 is this repo.
- High-entropy generic-blob secret detection — too noisy for v1 (origin defers; add later with a context scorer).

## Context & Research

### Relevant Code and Patterns

- `scripts/capture-learnings-harvest.ts` — `harvestCandidates` (I/O shell), `buildCandidateDigest`
  (pure core: filter + cap + privacy-scan + emit), `Candidate` interface (currently
  review-specific: `{mergeSha, reviewRounds, signals, reviewExcerpts}`), `buildReviewExcerpts`
  (truncate-then-scan privacy-ordering invariant), `LOOKBACK_DAYS = 30`, `MAX_LEARNINGS_PER_RUN = 5`,
  `HarvestStageCounts`. The opacity test asserts emitted candidates carry exactly the allowed keys.
- `scripts/capture-learnings-privacy.ts` — the shared gate: `learningBodyHasPrivateLeak(body, tokens)`
  (pure, lowercase `includes`), `loadPrivateTokensFromDisk` (I/O, fail-closed throw). Both
  chokepoints (harvest + open) import this module. The new secret scan lives here.
- `scripts/wiki-slug.ts` — `buildPrivateTokenSet` (owner/name token forms).
- `scripts/check-private-leak.ts` — `redactPathTokens(path, tokens)` (case-insensitive regex
  replace → `[REDACTED]`); the established `[REDACTED]` marker. Copy this shape for redaction.
- `scripts/private-repo-resolution.ts` (`execFileSync('gh', ['api', 'graphql', ...])`) and
  `scripts/reconcile-repos.ts` — the established `gh api graphql` pattern (no `@octokit/graphql` dep).
- `.github/workflows/capture-learnings.yaml` — the harvest step, the trigger-aware agent prompt,
  the step summary, the metadata overlay (needed for the privacy token set).

### Institutional Learnings

- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md` — enumerate every
  public surface before declaring non-leaking; C2 adds "agent input digest" and "harvest run logs"
  to that surface list.
- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md` — the new
  secret scan must be pure-core in the shared module, with a mutation-proof test that goes red when
  the gate is removed; two chokepoints import one module so they can't diverge.
- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` — "scan
  content, not just identifiers"; fail-closed on ambiguous resolution.

## Key Technical Decisions

- **Transition detection: one GraphQL query per candidate PR.** `pullRequest.commits(first:100)
  .nodes.commit.statusCheckRollup.contexts(first:100).nodes{... CheckRun{name conclusion} ...
  StatusContext{context state}}` returns per-commit per-check conclusions across the PR's SHA
  history in a single call (proven pattern). Walk commits oldest→newest: last-failing SHA = latest
  commit where the target check is FAILURE/TIMED_OUT/etc.; first-passing SHA = first SUCCESS after
  it. Invoked via `execFileSync('gh', ['api', 'graphql', ...])` with the workflow token — no new dep.
- **Required-checks: current branch-protection set, strict, with a documented approximation.**
  One `getBranchProtection` call per run yields `required_status_checks.checks[].context`; match
  fail→pass only against that set. Caveat (in code): it's current config, not merge-time state. This
  repo currently enforces none, so effectively any failed→passed check counts — the abstraction
  generalizes to repos that do enforce.
- **Fixing diff is the primary signal; logs are best-effort.** `repos.compareCommits(lastFailingSha,
  firstPassingSha)` gives the fixing change and is always available. The failing-log excerpt
  (`actions.downloadJobLogsForWorkflowRun` for the failed job) degrades to a `[failure log purged]`
  placeholder on 404/410 or when unavailable — the candidate never blocks on log availability.
- **Discriminated `Candidate` union.** `Candidate = ReviewCandidate | CiFixCandidate`, sharing
  `mergeSha` + `signals`, with a `trigger` discriminant and a per-source `evidence` block. This
  keeps the opacity guarantee (exact allowed keys per trigger), lets the agent prompt branch, and
  avoids overloading review-specific fields with CI data.
- **New secret/redaction scan in the shared privacy module.** Add `logDiffHasSecret(body)` (block)
  and `redactLogDiffSecrets(body)` (structural redact → `[REDACTED]`). Block on PATs
  (`gh[pousr]_…`, `github_pat_…`), private-key blocks, credential-bearing connection strings, and
  cloud/LLM key shapes; redact file paths (`/home`, `/Users`, `~/.ssh`, …), internal hostnames
  (`*.fro.bot`), and `Bearer`/`Authorization` values. The existing private-repo-name scan still runs.
- **Per-run cap stays shared.** Both sources compete for `MAX_LEARNINGS_PER_RUN`; no per-trigger budget.

## Open Questions

### Resolved During Planning

- Transition detection mechanism/cost → 1 GraphQL query per PR (resolved; the gating risk).
- Required-checks determination → current branch-protection set, strict, documented approximation.
- Log retention → best-effort fetch with `[purged]` degrade; diff is the primary signal.
- Evidence model → discriminated union with per-source `evidence`.
- Privacy hit policy → redact-where-safe in harvest, block residual in open (origin R3a).
- Cap → shared budget.

### Deferred to Implementation

- Exact GraphQL field selection / pagination handling for PRs with >100 commits (cursor walk).
- The precise secret-pattern regex set and the redact-vs-block threshold per pattern (research
  gives a defensible v1 list; finalize against real fixtures during implementation).
- Whether to extract `LOOKBACK_DAYS` to a shared constants module or import from the harvest file.
- Exact `HarvestStageCounts` field names for the per-trigger + secret-blocked counters.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not
> implementation specification. The implementing agent should treat it as context, not code.*

```
harvest (I/O shell)
 ├─ harvestReviewHeavyCandidates(...)         → Candidate[]  (existing, unchanged)
 └─ harvestCiFixCandidates(...)               → Candidate[]  (new)
       per merged PR in window:
         1 GraphQL query → per-commit per-check conclusions
         find lastFailingSha / firstPassingSha for a required check
         compareCommits(lastFailingSha, firstPassingSha)         → fixing diff
         downloadJobLogsForWorkflowRun(failed job)  [best-effort] → log excerpt | [purged]
         build CiFixEvidence { trigger:'ci-fail-then-pass', lastFailingSha, firstPassingSha,
                               failingCheckName, diffExcerpt, logExcerpt? }
 ↓ concat both arrays
buildCandidateDigest (pure core)  — generalized over the union
   dedup by mergeSha · solutions dedup by signals · cap · PRIVACY:
     private-repo-name scan + NEW secret scan (redact-where-safe / drop-else)
 ↓ opaque digest (merge SHA + per-trigger evidence only — no owner/repo/number)
agent authors bodies (prompt branches on trigger)
 ↓
open step — body privacy scan (private-name + secret block) → learning-proposal issue
```

## Implementation Units

- [x] **Unit 1: Secret/redaction scan in the shared privacy module**

**Goal:** Add log/diff secret detection + structural redaction to the shared gate, callable from
both chokepoints, without touching the existing private-repo-name scan.

**Requirements:** R3, R3a.

**Dependencies:** None.

**Files:**
- Modify: `scripts/capture-learnings-privacy.ts`
- Test: `scripts/capture-learnings-privacy.test.ts`

**Approach:**
- Add pure `logDiffHasSecret(body): boolean` (block patterns) and `redactLogDiffSecrets(body): string`
  (redact patterns → `[REDACTED]`, mirroring `redactPathTokens` in `check-private-leak.ts`). Keep
  them pure; no I/O. Block list and redact list per the KTD. The existing
  `learningBodyHasPrivateLeak` / `loadPrivateTokensFromDisk` stay unchanged.

**Execution note:** Test-first; the mutation-proof test is the load-bearing coverage.

**Patterns to follow:** `learningBodyHasPrivateLeak` (pure shape), `redactPathTokens`
(`check-private-leak.ts`) for the redact form, the `[REDACTED]` marker convention.

**Test scenarios:**
- Happy: a clean diff/log → `logDiffHasSecret` false, `redactLogDiffSecrets` unchanged.
- Block: bodies containing a `ghp_…` PAT, a `github_pat_…` token, a private-key block, and a
  credential-bearing connection string each → `logDiffHasSecret` true.
- Redact: a `/Users/...` path, a `*.fro.bot` hostname, and a `Bearer <token>` each → redacted to
  `[REDACTED]` with surrounding prose preserved.
- Edge: a placeholder/short value (`token=x`) → not over-redacted; an empty body → false/unchanged.
- Mutation proof: with the secret scan disabled/short-circuited, a `ghp_` token reaches the
  output → the test fails (proves the gate is load-bearing).

**Verification:** gates green; the mutation-proof test bites; no secret value appears in any
test assertion message.

- [x] **Unit 2: Discriminated Candidate union + generalized digest core**

**Goal:** Refactor `Candidate` into a `trigger`-discriminated union with per-source `evidence`,
and generalize `buildCandidateDigest` to iterate the union uniformly (dedup, cap, privacy), with
no behavior change for the existing review source.

**Requirements:** R4, R5.

**Dependencies:** Unit 1 (the digest privacy step calls the new scan).

**Files:**
- Modify: `scripts/capture-learnings-harvest.ts`
- Modify: `scripts/capture-learnings-open.ts` (consume the union's shape if needed)
- Test: `scripts/capture-learnings-harvest.test.ts`, `scripts/capture-learnings-open.test.ts`

**Approach:**
- Introduce `ReviewCandidate` / `CiFixCandidate` sharing `{mergeSha, trigger, signals}` with a
  per-source `evidence`. Keep the review path producing the same emitted shape. Generalize
  `buildCandidateDigest`: dedup by `mergeSha`, solutions dedup by `signals`, cap, then privacy —
  private-name scan + the Unit 1 secret scan over the evidence text (redact-where-safe in the
  harvest excerpt; clear + count when redaction would gut it). Preserve the truncate-then-scan
  privacy-ordering invariant. Update the opacity test to assert exact allowed keys per trigger.

**Execution note:** Characterization-first — lock the existing review-source emitted shape with a
test before refactoring, so the union change provably preserves it.

**Patterns to follow:** the existing `buildCandidateDigest` dedup/cap/privacy flow; the opacity
test; `buildReviewExcerpts` ordering invariant.

**Test scenarios:**
- Happy: a review candidate still emits the same keys/values post-refactor (characterization).
- Happy: a CI-fix candidate emits `trigger:'ci-fail-then-pass'` + its evidence keys, no
  owner/repo/number (opacity).
- Edge: a PR matching both triggers → exactly one candidate (dedup by merge SHA), with a defined
  trigger precedence.
- Privacy: a CI-fix candidate whose diff/log carries a private repo name OR a secret → enriched
  content redacted/dropped before the digest (mutation-proven), counted in telemetry.
- Cap: review + CI-fix candidates compete for the shared cap; over-cap selection is deterministic.

**Verification:** gates green; review-source output unchanged; opacity holds for both triggers;
the privacy mutation-proof bites.

- [x] **Unit 3: CI fail→pass harvester (GraphQL detector + diff/log evidence)**

**Goal:** Implement `harvestCiFixCandidates` — detect fail→pass PRs via one GraphQL query each,
derive the fixing diff and best-effort log excerpt, and emit `CiFixCandidate`s.

**Requirements:** R1, R2.

**Dependencies:** Unit 2 (the union type).

**Files:**
- Modify: `scripts/capture-learnings-harvest.ts`
- Test: `scripts/capture-learnings-harvest.test.ts`

**Approach:**
- One `getBranchProtection` per run → required-checks set. For each merged PR in the window
  (reuse the existing merged-PR fetch), run the GraphQL commits/rollup query via
  `execFileSync('gh', ['api', 'graphql', ...])`; walk commits oldest→newest to find
  last-failing/first-passing SHA for a required check (require both to exist = a real transition).
  `compareCommits` for the fixing diff (truncate to budget, ranked toward changed hunks);
  best-effort `downloadJobLogsForWorkflowRun` for the failed job's log excerpt (ranked toward
  error lines, budgeted), degrading to `[failure log purged]`. Build `CiFixEvidence`. Inject the
  `gh`/octokit callers + `now` for testability; counts-only telemetry; per-trigger stage counts.

**Execution note:** Test-first for the transition-walk logic (the correctness core).

**Patterns to follow:** `execFileSync('gh', ['api','graphql',...])` in `private-repo-resolution.ts`;
the existing merged-PR fetch + `now` injection; `buildReviewExcerpts` truncate-then-scan ordering.

**Test scenarios:**
- Happy: a PR with a failing commit then a passing commit on a required check → one CiFixCandidate
  with the correct last-failing/first-passing SHAs and a diff excerpt.
- Edge: a PR that never failed → no candidate; a PR that failed and stayed failing → no candidate
  (no transition); a check not in the required set → ignored.
- Edge: a bare green re-run with no diff between failing and passing SHA → not a candidate (require
  a real fixing diff).
- Error/degrade: logs purged (404/410) → `[failure log purged]` placeholder, candidate still emitted
  on the diff; a GraphQL/compare error for one PR degrades that PR, does not abort the run.
- Edge: a PR with >100 commits → cursor pagination walks all commits.
- Privacy: a diff/log carrying a private name or secret → handled by the Unit 1/2 scan (assert the
  evidence is scanned before emission).

**Verification:** gates green; the transition walk is mutation-proven (a fixture where removing the
oldest→newest ordering picks the wrong SHA fails); degrade paths don't abort.

- [x] **Unit 4: Workflow wiring + trigger-branched agent prompt**

**Goal:** Concatenate both candidate sources into the digest, branch the agent prompt on `trigger`,
and surface per-trigger + secret-blocked counts in the step summary.

**Requirements:** R2, R6.

**Dependencies:** Unit 3.

**Files:**
- Modify: `scripts/capture-learnings-harvest.ts` (`main` concatenates both sources)
- Modify: `.github/workflows/capture-learnings.yaml` (prompt branch + step summary)

**Approach:**
- `main` calls both harvesters and concatenates before `buildCandidateDigest`. Update the agent
  prompt: a CI-fix candidate's evidence (failing check + fixing diff + optional log) is the primary
  signal; the agent distills "this failure → this fix"; the merge-SHA-only reference rule and all
  hard boundaries stay identical. Add per-trigger candidate counts and the secret-blocked count to
  the step summary (counts-only).

**Test expectation:** none — workflow wiring + prompt; validated by actionlint and a manual dispatch
showing both sources in the digest and a CI-fix proposal grounded in the diff.

**Verification:** actionlint clean; a manual `workflow_dispatch` produces a CI-fix learning-proposal
distilled from the diff (not the title), per-trigger counts visible, no secret/private identifier in
the run log.

## System-Wide Impact

- **Interaction graph:** harvest gains a second source (1 GraphQL + 1 compare + best-effort log per
  CI-fix candidate, bounded by the cap) and a new secret-scan call in the digest; the open step gains
  a secret block; the agent prompt branches. The review source is unchanged.
- **Error propagation:** per-PR GraphQL/compare/log failures degrade that candidate, never abort the
  run; the secret/private scan is fail-closed (redact-where-safe, else drop/block).
- **State lifecycle risks:** none new — no persisted state; the decision log (proposal issues) is
  untouched; dedup by merge SHA prevents double-proposals across triggers.
- **API surface parity:** both chokepoints (harvest + open) share the one privacy module, so the
  private-name and secret scans cannot drift.
- **Unchanged invariants:** the propose-only model, the merge-SHA marker, the `learning-proposal`
  label, the per-run cap, opacity (merge-SHA-only references), and the data-branch authority model.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Secret leaks into a public issue via a failing log | New block/redact secret scan upstream + open-step block; mutation-proven; logs are best-effort and diff-primary |
| Transition detection wrong (picks wrong SHA) | Oldest→newest chronological walk, mutation-proven; require both failing and passing SHA to exist |
| Required-checks approximation (current config ≠ merge-time) | Documented caveat; weekly 30-day window makes drift rare; repo currently enforces none so any failed→passed counts |
| Log retention purges the excerpt | `[purged]` degrade; the fixing diff is the primary signal and always available |
| Refactor breaks the existing review source | Characterization test locks the emitted shape before the union refactor |
| Secret-regex false positives over-redact | Defensible v1 pattern set; high-entropy generic detection deferred; finalize against real fixtures |

## Documentation / Operational Notes

- After landing, the `logDiffHasSecret` / `redactLogDiffSecrets` block-vs-redact pattern is a strong
  `docs/solutions/security-issues/` learning candidate (reusable for any pipeline ingesting
  third-party run output) — author via `ce:compound` if it proves reusable.
- Close the C2 requirements doc's follow-ups when this ships.

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-22-c2-failed-then-fixed-capture-requirements.md
- Parent: docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
- Plans: docs/plans/2026-06-22-002-feat-capture-c1-proposals-plan.md (pipeline),
  docs/plans/2026-06-22-003-feat-enrich-capture-digest-plan.md (enrichment + upstream privacy gate)
- Code: scripts/capture-learnings-harvest.ts, scripts/capture-learnings-privacy.ts,
  scripts/capture-learnings-open.ts, scripts/wiki-slug.ts, scripts/check-private-leak.ts
  (redactPathTokens), scripts/private-repo-resolution.ts (gh api graphql pattern),
  .github/workflows/capture-learnings.yaml
- Learnings: docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md,
  docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md,
  docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md
