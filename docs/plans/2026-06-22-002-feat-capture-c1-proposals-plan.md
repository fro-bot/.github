---
title: 'feat: propose-only learning capture from multi-round-review PRs'
type: feat
status: active
date: 2026-06-22
origin: docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
---

# feat: propose-only learning capture from multi-round-review PRs

## Overview

A scheduled run that examines this repo's merged PRs, finds the ones that needed multiple
rounds of changes-requested before merging (the richest mistake→correction signal), and
**opens a GitHub issue proposing a candidate learning** for each — with the evidence — for a
human to author via `ce:compound` later. It does not author into `docs/solutions/` and does
not touch the data-branch authority path.

This is **Phase 2 (propose-only, C1-only)** of the grow-and-learn loop (see origin). It is the
supply-side complement to the shipped Phase 1 retrieval, scoped as a cheap experiment to test
the premise — *can reasoning over run-outcome metadata produce a learning worth keeping?* —
before any authoring or promotion machinery is built.

## Problem Frame

Phase 1 made Fro Bot consult its existing learnings; capture is still human-triggered. Fro
Bot's own runs generate reusable judgment that is never captured unless a human notices. The
cheapest way to test whether autonomous capture is worthwhile is to **propose** candidate
learnings (not author them) and see if the proposals are good. Propose-only sidesteps the
two biggest risks the brainstorm review found: no authoring means no quarantine docs to poison
Phase 1 retrieval, and no `docs/solutions/` write means no data-branch authority change.

## Requirements Trace

- R1. (origin C1) A scheduled run harvests merged PRs from this repo (`fro-bot/.github`) whose
  review history shows **≥2 changes-requested reviews**, and proposes a candidate learning for
  each.
- R2. (origin, mechanism) A deterministic script harvests + pre-filters + dedups; the agent
  decides which candidates are proposal-worthy and opens the issue. The script never lets the
  agent do open-ended API exploration.
- R3. (origin, decision log) The run never re-proposes a PR it has already proposed for —
  reset-resilient across data-branch lifecycle events.
- R4. (origin, privacy) No private-repo identifier reaches the proposal issue, the digest, the
  decision log, or any workflow log. The agent-authored proposal **body** is privacy-scanned
  before posting; a hit blocks the proposal.
- R5. (origin, dedup) A candidate is not proposed if an equivalent learning already exists in
  `docs/solutions/`.
- R6. (origin, cost) The run is bounded: weekly cadence, a max-candidates-per-run cap, and a
  bounded lookback window.

## Scope Boundaries

- Propose-only. No authoring into `docs/solutions/`, no quarantine lane, no data-branch
  authority change.
- C1 only (multi-round-review PRs). No C2 (failed-then-fixed) or C3 (issue triages) — Phase 2.5.
- This repo (`fro-bot/.github`) only — it holds the richest multi-round PR history. No other
  `fro-bot/*`, `marcusrbrown/*`, or `bfra-me/*` harvest.
- No improvement-metric / operator-web surfacing (Phase 3).

### Deferred to Separate Tasks

- Authoring machinery, quarantine lane, `docs/solutions/` data-branch authority path,
  human-reviewed promotion: Phase 2.5+, separate plan. (When authoring lands, quarantine docs
  MUST be excluded from Phase 1 `solutions-query.ts` retrieval — the deferred P0 mitigation.)
- C2/C3 triggers and any cross-repo / cross-org harvest scope: Phase 2.5+.

## Context & Research

### Relevant Code and Patterns

- `scripts/reconcile-repos.ts` — the **issue-queue template**. `runIssueQueue` (2659–2830) +
  `ensureLabelsExist` (2843–2878, race-tolerant label preflight) + the body-marker dedup
  (`renderVisibilityTransitionIssue` 2898–2920, `NODE_ID_MARKER_PATTERN` parse ~3042) + the
  same-run in-memory `Set` dedup (2687, 2712–2718). `callIssuesCreate` (3182–3184) is the
  per-call cast pattern. `createOctokitFromEnv` (3186–3207) is the env-parameterized
  constructor.
- `scripts/merge-data-pr.ts` — `loadOctokitConstructor` + `createOctokitFromEnv` (684–718);
  `octokit.paginate(...pulls.list...)` usage (386, 493).
- `scripts/commit-metadata.ts:90–102` — the `OctokitClient = Octokit` derived-type rule (never
  handwrite SDK interfaces).
- `scripts/solutions-query.ts` — reuse `splitFrontmatter` (169–185), the `collectDocs` /
  `SolutionDoc` loader (120–167), `loadSolutionsFilesFromDisk` (350–378), the private-names
  loader `loadPrivateNamesFromDisk` (390–429), the token-set builder (236–252), and
  `containsPrivateToken` (254–259). These already exist and are tested.
- `scripts/wiki-slug.ts:12–28` — `buildPrivateNameTokens` (exported, tested in
  `wiki-slug.test.ts`).
- `.github/workflows/reconcile-repos.yaml:26–62` — the App-token (`owner:
  ${{ github.repository_owner }}`) + `./.github/actions/setup` + data-overlay + step-summary
  workflow shape to mirror.
- `common-settings.yaml` / `.github/settings.yml` — the Probot-synced label catalog; a new
  `learning-proposal` label is added here.

### Institutional Learnings

- `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`
  — the Issues API list-after-create is eventually consistent; an in-memory `Set` of created
  keys is mandatory to avoid same-run duplicates. The capture run MUST carry a `Set` of
  proposed merge-SHAs through the create loop.
- `docs/solutions/best-practices/wiki-page-structured-attribution-2026-06-04.md` and the
  privacy-gate docs — fail-closed on private content; reference by opaque key, never name.
- `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md` — strip-only safe
  (no parameter properties/enums/namespaces).

## Key Technical Decisions

- **The proposal issues ARE the reset-resilient decision log.** Each proposal is a GitHub
  issue labeled `learning-proposal` carrying an immutable body marker
  `<!-- capture-c1:merge_sha=<sha> -->`. The seen-set is rebuilt each run by
  `issues.listForRepo({ state: 'all', labels: 'learning-proposal' })` and parsing the marker.
  Issues live independent of branches, so a `data`-branch reset cannot wipe the log (R3). One
  accepted tradeoff: if an operator manually *deletes* a proposal issue, that PR becomes
  eligible again — acceptable for v1, documented. (State `all`, not `open`: a *closed* proposal
  still means "examined, do not re-propose.")
- **C1 definition = count of `CHANGES_REQUESTED` reviews per merged PR, threshold ≥2.**
  `pulls.list({ state: 'closed' })` paginated, filtered to `merged_at !== null`, then
  `pulls.listReviews` counting `state === 'CHANGES_REQUESTED'`. The threshold is a named
  constant. `COMMENTED` reviews do not count as a round.
- **Immutable dedup key = `merge_commit_sha`.** Durable on `main` regardless of later PR edits.
- **Script harvests + builds an opaque digest; agent only judges + opens issues.** The digest
  identifies candidates **by merge SHA only** — the script does not pass `owner/repo/number`
  prose to the agent, so private identifiers cannot reach the agent context structurally, not
  just by prompt instruction. The agent decides which candidates merit a proposal and authors
  the proposal body.
- **Privacy gate on the proposal body (R4).** Before `issues.create`, the agent-authored body
  is lowercased and scanned with `containsPrivateToken` against the private token set
  (`buildPrivateNameTokens` over `metadata/repos.yaml` `private: true` non-redacted entries).
  Any hit → block that proposal (rejection, not redaction, for v1). The data overlay supplies
  the authoritative private set.
- **Dedup against `docs/solutions/` (R5).** Load the existing docs via `collectDocs`; score a
  candidate's signals (`module` / `tags` / `problem_type`, derived from the PR's changed paths
  and labels) against each doc; drop the candidate on strong overlap (exact `problem_type`
  match or tag/module overlap above a constant). `docs/solutions/` is on `main` — no overlay
  needed for this half.
- **Harvest scope = this repo only (`fro-bot/.github`).** No repo enumeration — the harvest
  queries `pulls.list` for the single repo. The App token does not need cross-repo `owner`
  scope for the harvest (it stays same-repo); issue-create + reads are same-repo.
- **Cost budget (R6):** weekly cron (Sunday after `merge-data`), a `MAX_PROPOSALS_PER_RUN`
  cap, and a bounded lookback window (e.g. PRs merged in the last N days). All named constants.
- **New `learning-proposal` label** added to the settings file in the same PR so it exists
  before the first run; `ensureLabelsExist` preflight tolerates the race.

## Open Questions

### Resolved During Planning

- Decision-log persistence: proposal-issues-as-log (reset-resilient). Resolved above.
- Review-round definition + threshold: ≥2 `CHANGES_REQUESTED`. Resolved above.
- Harvest scope: this repo (`fro-bot/.github`) only. Resolved above.
- Privacy gate target: the agent-authored proposal body, fail-closed. Resolved above.

### Deferred to Implementation

- Exact dedup-overlap threshold against `docs/solutions/`, the lookback-window length, and
  `MAX_PROPOSALS_PER_RUN` — calibrate against real PR history during implementation; they are
  named constants, not architecture.
- How a candidate's `module`/`tags`/`problem_type` signals are derived from a PR (changed-file
  top-level dirs, PR labels, title heuristics) — start simple, refine if dedup precision is
  poor.
- Whether to fetch each candidate issue's body to read the marker, or encode the merge-SHA in
  a way visible in `listForRepo` without a body fetch — a cheap per-issue `get` is acceptable;
  decide at implementation.

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
weekly cron (Sunday, post-merge-data)
   │  App token · ./.github/actions/setup · overlay metadata/ from data
   ▼
 scripts/capture-c1-harvest.ts
   1. paginate this repo's merged PRs in the lookback window
   2. per PR: pulls.listReviews → count CHANGES_REQUESTED; keep if >= 2
   3. seen-set: issues.listForRepo(state:all, labels:learning-proposal) → parse
      <!-- capture-c1:merge_sha=… --> markers; drop candidates already seen
   4. dedup vs docs/solutions/ (collectDocs overlap on module/tags/problem_type)
   5. cap to MAX_PROPOSALS_PER_RUN
   6. emit OPAQUE digest (candidates by merge_sha + review-round counts + signals;
      NO owner/repo/number prose) → $GITHUB_OUTPUT
   │
   ▼
 fro-bot/agent step (tight propose-only prompt + digest as context)
   - decide which candidates merit a proposal
   - author a proposal body (the pattern, the evidence, by merge_sha)
   - BEFORE issues.create: privacy body-scan (containsPrivateToken) → block on hit
   - ensureLabelsExist([learning-proposal]) preflight
   - issues.create with the learning-proposal label + body marker
   - in-memory Set of created merge_shas guards same-run duplicates
```

## Implementation Units

- [x] **Unit 1: `scripts/capture-c1-harvest.ts` — harvest + dedup + digest (test-first)**

**Goal:** A script that paginates this repo's (`fro-bot/.github`) merged PRs in the lookback
window, keeps those with ≥2 `CHANGES_REQUESTED` reviews, drops any already represented by a
`learning-proposal`
issue (by merge-SHA marker) or already covered by a `docs/solutions/` doc, caps the result,
and emits an opaque candidate digest to `$GITHUB_OUTPUT`.

**Requirements:** R1, R2, R3, R5, R6.

**Dependencies:** None (reuses existing helpers; the workflow in Unit 3 invokes it).

**Files:**
- Create: `scripts/capture-c1-harvest.ts`
- Test: `scripts/capture-c1-harvest.test.ts`
- Possibly: extract `splitFrontmatter` into a shared module if reuse is cleaner than copy
  (decide at implementation; copy is acceptable per repo convention).

**Approach:**
- `OctokitClient = Octokit` derived type; `createOctokitFromEnv` mirroring
  `reconcile-repos.ts` (env-parameterized token). Pure core takes injected inputs (PR list,
  reviews, existing proposal markers, existing solutions docs) so it is fully unit-testable;
  the I/O shell does the Octokit/disk calls.
- Harvest: `octokit.paginate(pulls.list, { owner: 'fro-bot', repo: '.github', state: 'closed',
  ... })` (single repo, no enumeration), filter `merged_at !== null` and within the lookback
  window; `pulls.listReviews` per PR; `reviewRounds =
  count(state === 'CHANGES_REQUESTED')`; keep `reviewRounds >= MULTI_ROUND_THRESHOLD` (=2).
- Seen-set: `issues.listForRepo({ state: 'all', labels: LEARNING_PROPOSAL_LABEL })`, parse the
  `<!-- capture-c1:merge_sha=… -->` marker, build `Set<merge_sha>`; drop seen candidates.
- Solutions dedup: `loadSolutionsFilesFromDisk` + `collectDocs`; drop candidates whose derived
  signals strongly overlap an existing doc.
- Cap to `MAX_PROPOSALS_PER_RUN`; emit the digest (merge_sha, reviewRounds, derived signals —
  **no owner/repo/number prose**) + counts-only telemetry to `$GITHUB_OUTPUT`.
- Best-effort on transient API errors (retry/continue like `reconcile-repos.ts`); a hard
  failure to read `metadata/repos.yaml` for the privacy set is fatal only in Unit 2's gate, not
  here.

**Execution note:** Test-first, mirroring the `reconcile-repos.test.ts` mock shape.

**Patterns to follow:** `reconcile-repos.ts` (pagination, retry, derived Octokit type),
`solutions-query.ts` (frontmatter/doc loaders), the same-run-eventual-consistency learning.

**Test scenarios:**
- Happy: a merged PR with 2 `CHANGES_REQUESTED` reviews and no prior proposal/solution → in the
  digest with its merge_sha and reviewRounds.
- Edge: a PR with 1 `CHANGES_REQUESTED` (below threshold) → excluded.
- Edge: a closed-but-not-merged PR (`merged_at === null`) → excluded.
- Edge: `COMMENTED`/`APPROVED`-only reviews → reviewRounds 0 → excluded.
- Dedup (R3): a candidate whose merge_sha appears in an existing `learning-proposal` issue
  marker (state `all`, including a *closed* one) → excluded. Mutation-prove: removing the
  seen-set filter makes it reappear.
- Dedup (R5): a candidate whose signals overlap an existing `docs/solutions/` doc → excluded.
- Cap (R6): more candidates than `MAX_PROPOSALS_PER_RUN` → only the cap count emitted.
- Privacy/opacity (R4): assert the emitted digest contains **no** `owner/repo/number` prose —
  candidates are identified by merge_sha only.
- Error path: a transient `pulls.listReviews` failure for one PR doesn't abort the whole run.

**Verification:** `pnpm check-types`, `pnpm lint`, `pnpm test` green; strip-only load clean;
the digest carries no `owner/repo/number` prose; the seen-set dedup is mutation-proven.

- [x] **Unit 2: proposal-issue opening with body privacy-scan + dedup (test-first)**

**Goal:** Given the digest and an agent-authored proposal body per candidate, open a
`learning-proposal` issue with the merge-SHA marker — but only after the body passes the
private-identifier scan, with same-run and cross-run dedup.

**Requirements:** R2, R3, R4.

**Dependencies:** Unit 1 (the digest + seen-set), shared privacy helpers.

**Files:**
- Modify: `scripts/capture-c1-harvest.ts` (add the issue-opening shell), OR a sibling
  `scripts/capture-c1-propose.ts` if cleaner — decide at implementation.
- Test: the colocated test.

**Approach:**
- Reuse `ensureLabelsExist([LEARNING_PROPOSAL_LABEL])` preflight (race-tolerant), filtering the
  payload labels to the confirmed set.
- Privacy gate (R4): lowercased proposal body → `containsPrivateToken` against the token set
  built from `loadPrivateNamesFromDisk` (overlay-checked-out `metadata/repos.yaml`,
  `private: true`, non-redacted) via `buildPrivateNameTokens`. On hit → **skip** that proposal
  (counts-only telemetry: "blocked N on privacy scan", path/sha-free).
- Open the issue: `issues.create({ labels: [LEARNING_PROPOSAL_LABEL], body: <body> + marker
  })`; carry an in-memory `Set<merge_sha>` of created proposals to guard the eventual-consistency
  same-run race.
- The proposal body references the source PR by merge_sha only (the agent never received
  owner/repo prose).

**Test scenarios:**
- Happy: a clean proposal body → issue created with the `learning-proposal` label and the
  `<!-- capture-c1:merge_sha=… -->` marker.
- Privacy (R4): a proposal body containing a private token → blocked, no issue created, no
  private name in any telemetry. Mutation-prove: removing the gate lets it through.
- Same-run dedup (R3): two candidates with the same merge_sha in one run → only one issue
  created (in-memory Set).
- Label preflight: `ensureLabelsExist` 404→create, 422→accept; a label that can't be created →
  issue still ships with the confirmed subset (never silently unlabeled-and-undeduped).
- Error path: an `issues.create` failure for one candidate doesn't abort the rest.

**Verification:** gates green; the privacy block is mutation-proven; the same-run Set prevents
duplicates; created issues carry the label + marker.

- [x] **Unit 3: scheduled workflow + `learning-proposal` label + agent wiring**

**Goal:** A weekly workflow that mints the App token, overlays metadata, runs the harvest over
this repo, feeds the opaque digest to a tight propose-only agent step, and surfaces counts-only
telemetry.

**Requirements:** R1, R2, R4, R6.

**Dependencies:** Units 1–2.

**Files:**
- Create: `.github/workflows/capture-c1-proposals.yaml`
- Modify: `common-settings.yaml` (or `.github/settings.yml`) — add the `learning-proposal`
  label.
- Possibly modify: `metadata/README.md` — document the capture run.

**Approach:**
- Mirror `reconcile-repos.yaml`: `actions/create-github-app-token` (same-repo scope is
  sufficient — the harvest and issue-create are all on this repo, so the cross-repo `owner:`
  input is not required), `./.github/actions/setup`, the data-overlay step (hard-fail
  if `metadata/repos.yaml` can't be read — the privacy gate needs it), `node
  scripts/capture-c1-harvest.ts` emitting the digest to `$GITHUB_OUTPUT`, then the
  `fro-bot/agent` step with a **tight propose-only prompt**: open `learning-proposal` issues
  for the digest candidates and do nothing else — no code, no doc edits, no other issues. A
  counts-only step-summary (cohort size, candidates after dedup, proposals opened, blocked-on-
  privacy count). Weekly cron (Sunday post-merge-data), `concurrency: capture-c1-proposals`,
  `permissions: contents: read` (+ issues write via the App token).

**Execution note:** none (workflow wiring; validated by actionlint + a manual dispatch).

**Patterns to follow:** `reconcile-repos.yaml`, `update-metadata.yaml`.

**Test scenarios:** `Test expectation: none — workflow wiring; validated by actionlint and a
manual workflow_dispatch run that shows the harvest ran, the digest populated, and at most
MAX_PROPOSALS_PER_RUN learning-proposal issues opened (or zero with a clean reason), with no
private identifier in the run log.`

**Verification:** actionlint clean; a manual dispatch opens `learning-proposal` issues for real
multi-round PRs (or none, cleanly), the label exists, the step summary is counts-only, and no
`owner/repo/number` for any private repo appears in the run log.

## System-Wide Impact

- **Interaction graph:** a new scheduled workflow + 1–2 new scripts. Reuses existing Octokit,
  frontmatter, and privacy helpers. Opens issues labeled `learning-proposal`. Touches nothing
  in the data-branch authority path, the agent prompt-injection path, or Phase 1 retrieval.
- **Error propagation:** harvest is best-effort on transient API errors; the privacy gate is
  fail-closed (block the proposal). A failed run opens no issues and does not corrupt state
  (the decision log is the issues themselves).
- **State lifecycle risks:** the decision log is reset-resilient by construction (issues, not
  `data`). The one documented tradeoff is manual issue deletion re-opening candidacy.
- **API surface parity:** the issue-queue + label-preflight + same-run-Set pattern mirrors
  `reconcile-repos.ts` exactly.
- **Unchanged invariants:** `docs/solutions/` stays human-authored on `main` (no write); the
  data-branch authority model and Phase 1 retrieval are untouched.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Private repo name leaks via the agent-authored proposal body | Fail-closed `containsPrivateToken` scan of the body before create; opaque digest (merge_sha only) so the agent never receives owner/repo prose |
| Decision log lost on data-branch reset | Log IS the `learning-proposal` issues — independent of branches; deduped by merge_sha marker, queried `state: all` |
| Same-run duplicate proposals (Issues API eventual consistency) | In-memory `Set<merge_sha>` through the create loop (the documented reconcile pattern) |
| Shallow/low-value proposals dilute attention | Propose-only + human decides; ≥2-round threshold keeps the cohort high-signal; `MAX_PROPOSALS_PER_RUN` caps volume |
| Cost drift from the agent step | Weekly cadence, capped candidates, bounded lookback |
| Agent does more than open issues | Tight propose-only prompt; the digest withholds anything but merge_sha + signals |

## Documentation / Operational Notes

- Add the `learning-proposal` label to the settings file in the Unit 3 PR so it exists before
  the first run.
- After landing, the capture run's own behavior is a candidate for a `docs/solutions/` learning
  (a small dogfood) — but that authoring stays human-triggered in this phase.

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
- Issue-queue / label / dedup template: `scripts/reconcile-repos.ts` (`runIssueQueue`,
  `ensureLabelsExist`, marker dedup, same-run Set)
- Octokit constructor + pagination: `scripts/merge-data-pr.ts`, `scripts/reconcile-repos.ts`
- Privacy + frontmatter helpers: `scripts/solutions-query.ts`, `scripts/wiki-slug.ts`
- Workflow shape: `.github/workflows/reconcile-repos.yaml`
- Same-run eventual-consistency learning:
  `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`
