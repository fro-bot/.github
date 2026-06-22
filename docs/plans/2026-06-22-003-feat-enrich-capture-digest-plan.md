---
title: 'feat: enrich the learning-capture digest with review-thread content'
type: feat
status: active
date: 2026-06-22
origin: docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
---

# feat: enrich the learning-capture digest with review-thread content

# Overview

The learning-capture run gives the agent only a merge SHA, a review-round count, and tokens
derived from the PR title. The first production run confirmed the consequence: descriptive
titles produced plausible learnings, terse ones produced generic platitudes. The agent has no
other signal to distill from.

This adds the corrective signal the harvest already has cheap access to — the **review prose**
(review bodies + line-level review-thread comments) — to the candidate digest, so the agent
distills the learning from what the reviewer actually said. Because review prose carries
private-repo cross-references (`owner/repo#123`, `@mentions`, private names), the fail-closed
privacy gate moves **upstream to harvest time**: enriched content is scanned before it enters
the digest and reaches the agent's reasoning context, not only on the authored body afterward.

This is the **Phase 2.5 digest-enrichment** step (see origin) — the quality lever identified
by shipping Phase 2, sequenced ahead of broadening triggers or adding authoring.

# Problem Frame

The agent's proposal quality is structurally capped by a title-only digest. `harvestCandidates`
emits each candidate as `{mergeSha, reviewRounds, signals}` where `signals` is `{titleTokens,
labels}` from `deriveSignals` — the review *rounds* are counted but their *bodies are discarded*
(`listReviews` is paginated only for the count). The agent prompt then hands the model only
title tokens and labels as substance. The fix is to retain and privacy-gate the review prose
the harvest already fetches, plus the line-level thread comments where the sharpest corrections
live. (Tracked as issue #3552.)

# Requirements Trace

- R1. (origin Phase 2.5) The candidate digest carries review-prose excerpts (review bodies +
  line-level review-thread comments) so the agent distills from what the rounds said, not the
  title.
- R2. (origin SC5 / #3552) A fail-closed privacy scan runs on the enriched content **at harvest
  time, before it enters the digest** — review prose containing a private-repo identifier is
  dropped, never passed to the agent. The existing authored-body scan in the open step stays as
  defense-in-depth.
- R3. (#3552 budget) Enriched content is bounded per candidate, ranked by correction signal
  (changes-requested / thread-reply prose preferred over approval boilerplate) so truncation
  does not clip the correction sentence.
- R4. (opacity) Enrichment introduces no owner/repo/PR-number into the digest beyond what the
  privacy scan permits; candidates remain keyed by merge SHA.

# Scope Boundaries

- Enrichment with review bodies + line-level review-thread comments only. No diff/file summary
  (`pulls.listFiles` gives filenames, not reasoning — the weaker lever).
- No change to the detection predicate, the dedup logic, the cost cap, or the open step's
  issue-creation flow.
- No authoring, no quarantine lane, no new triggers (those remain later Phase 2.5+ items).

## Deferred to Separate Tasks

- Diff/file-summary enrichment, if review prose proves insufficient: future.
- C2/C3 triggers and autonomous authoring: later Phase 2.5+, separate plans.

# Context & Research

## Relevant Code and Patterns

- `scripts/capture-learnings-harvest.ts`
  - `harvestCandidates` — paginates `pulls.listReviews` per surviving candidate **for the
    count only**; the `reviews` array already carries `r.body`, currently discarded. This is
    where review bodies are retained and `pulls.listReviewComments` is added.
  - `deriveSignals` — title/label tokenizer; enrichment is a *new* field alongside `signals`,
    not a replacement (titleTokens/labels stay for scoring).
  - `Candidate` interface — gains an enrichment field (e.g. `reviewExcerpts`).
  - `buildCandidateDigest` (pure core) — receives the private token set so the upstream scan is
    unit-testable; threads enrichment + the drop count into telemetry.
  - `main()` — must `loadPrivateTokens...` before building the digest (harvest does **not** load
    `metadata/repos.yaml` today; the workflow overlays it once per job at
    `capture-learnings.yaml:47-55`, so the file is present, but harvest must read it).
- `scripts/capture-learnings-open.ts`
  - `learningBodyHasPrivateLeak` + `loadPrivateTokensFromDisk` — the pure, fail-closed gate
    functions to **extract to a shared module** (Fork 2). The open step keeps using them via the
    shared module (authored-body scan, unchanged).
- `scripts/wiki-slug.ts` — `buildPrivateNameTokens`, already the shared token-set source the gate
  builds on (precedent: extracted there specifically to stop gate drift).
- `.github/workflows/capture-learnings.yaml`
  - `Harvest candidates` step — needs the App token (already has `GITHUB_TOKEN`) and the metadata
    overlay already present; the agent prompt (lines ~100-103) must be updated to distill from
    the new excerpts field, not titleTokens.

## Institutional Learnings

- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` and the
  survey-privacy-gate docs — a gate must live *inside* the trust boundary it protects, and scan
  content not just identifiers. The upstream-at-harvest placement (R2) is exactly this lesson:
  the boundary is "before the agent sees it," so the gate belongs at harvest, not only at
  authoring.
- `docs/solutions/workflow-issues/required-github-token-for-agent-steps-2026-06-22.md` — the
  harvest step's token wiring; no scope change needed (read-only review access).
- Node 24 strip-only safety; the pure-core / I/O-shell split already in both scripts makes the
  new scan and enrichment straightforward to test.

# Key Technical Decisions

- **Enrich with review bodies + line-level thread comments (Fork 1).** Reuse `r.body` from the
  already-fetched `listReviews` (zero new calls for bodies) + one paginated
  `pulls.listReviewComments` per surviving candidate (bounded: candidates capped at
  `MAX_LEARNINGS_PER_RUN = 5`). Skip diff summary.
- **Extract the privacy gate to a shared module (Fork 2).** Move `learningBodyHasPrivateLeak` +
  `loadPrivateTokensFromDisk` into `scripts/capture-learnings-privacy.ts`, imported by both
  harvest (new upstream scan) and open (existing authored-body scan). Single source of truth;
  the two gates cannot drift. Mirrors the `buildPrivateNameTokens` extraction precedent.
- **Privacy gate runs upstream, fail-closed, drop-not-redact (R2).** In harvest `main()`, load
  the private token set (fail-closed: if `metadata/repos.yaml` is unreadable, emit no enriched
  content — never unscanned prose). Scan each candidate's enriched content; on a hit, **drop the
  enriched content for that candidate** (the candidate may still proceed with title-only signal,
  OR be dropped entirely — see Open Questions). Consistent with the open step's block-don't-redact
  contract.
- **Rank by correction signal when truncating (R3).** Bound enriched content per candidate
  (e.g. a per-candidate char cap). When trimming, prefer `CHANGES_REQUESTED` review bodies and
  thread-reply prose over `APPROVED` boilerplate — rank by correction signal, not chronology, so
  the correction sentence is not clipped.
- **Enrichment is a new `Candidate` field, not a replacement.** `signals` (titleTokens/labels)
  stays for scoring/dedup; `reviewExcerpts` is additive. The agent prompt is updated to distill
  from `reviewExcerpts` primarily.
- **Amend plan/req R4 framing.** The privacy requirement now covers enriched digest content, not
  only the authored body (the origin doc's Phase 2.5 reshaping already states this; the plan
  records it as R2).

# Open Questions

## Resolved During Planning

- Enrichment scope: review bodies + line-level thread comments (no diff summary). Resolved.
- Gate sharing: extract to `scripts/capture-learnings-privacy.ts`. Resolved.
- Gate placement: upstream at harvest, fail-closed, before the digest. Resolved (the #3552
  load-bearing finding).

## Deferred to Implementation

- **On a private-token hit, drop the enriched content only, or drop the whole candidate?**
  Dropping enriched-content-only lets the candidate proceed title-only (degraded but not lost);
  dropping the candidate is stricter. Lean: drop enriched content, keep the candidate with a
  counts-only "enrichment-blocked" signal — but decide against the privacy contract during
  implementation. (A candidate whose *only* signal was private prose is low-value anyway.)
- Exact per-candidate char budget and the correction-signal ranking weights — calibrate against
  real review threads during implementation.
- Whether `reviewExcerpts` is a single truncated string or a small array — implementation choice;
  array gives the agent clearer structure.

# Implementation Units

- [ ] **Unit 1: Extract the privacy gate to a shared module**

**Goal:** Move the fail-closed gate functions into a shared module both harvest and open import,
so there is one source of truth for the contract.

**Requirements:** R2 (enables the shared upstream scan).

**Dependencies:** None.

**Files:**
- Create: `scripts/capture-learnings-privacy.ts`
- Modify: `scripts/capture-learnings-open.ts` (import from the shared module instead of defining)
- Test: `scripts/capture-learnings-privacy.test.ts` (move/extend the existing gate tests)

**Approach:**
- Move `learningBodyHasPrivateLeak` + `loadPrivateTokensFromDisk` (and the token-set builder they
  use) into `capture-learnings-privacy.ts`, preserving the fail-closed throw contract and the
  counts-only logging exactly.
- `capture-learnings-open.ts` imports them; its behavior is unchanged (verify the open tests
  still pass against the moved functions).

**Patterns to follow:** the `buildPrivateNameTokens` extraction in `scripts/wiki-slug.ts`; the
existing `loadPrivateTokensFromDisk` injectable-`readFile` test seam.

**Test scenarios:**
- Happy: `learningBodyHasPrivateLeak` flags a body containing each private token variant
  (owner/name, owner--name, slug); clean body → false.
- Fail-closed: `loadPrivateTokensFromDisk` throws on unreadable / unparseable / wrong-shape /
  missing-`repos` metadata (the four existing branches), with no private name in the message.
- Redacted entries (`[REDACTED]`) contribute no token; `private !== true` entries excluded.
- Integration: `capture-learnings-open.ts` still blocks a private-laden authored body after the
  move (no behavior change).

**Verification:** gates green; open-step tests pass unchanged against the shared module; strip-only
load clean.

- [ ] **Unit 2: Harvest enrichment + upstream fail-closed privacy scan (test-first)**

**Goal:** Retain review-body prose, fetch line-level thread comments per candidate, privacy-scan
the enriched content fail-closed before it enters the digest, and bound it ranked by correction
signal.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** Unit 1.

**Files:**
- Modify: `scripts/capture-learnings-harvest.ts`
- Test: `scripts/capture-learnings-harvest.test.ts`

**Approach:**
- In `harvestCandidates`, retain `r.body` from the already-fetched reviews; add a paginated
  `pulls.listReviewComments` call per surviving candidate (after the predicate filter, so it runs
  only for the ≤ cap candidates).
- Add `reviewExcerpts` to `Candidate`. Build the excerpt by ranking review/thread prose by
  correction signal (changes-requested / reply prose first), then truncating to a per-candidate
  char budget (named constant). Exclude approval boilerplate first when over budget.
- Pure core: `buildCandidateDigest` receives the private token set and the per-candidate enriched
  prose; it scans each fail-closed and drops enriched content (or the candidate — see deferred Q)
  on a hit, threading an `enrichmentBlocked` count into telemetry. Keep the core pure (inject the
  token set + prose; no I/O).
- `main()`: load the private token set via the shared module **before** building the digest
  (fail-closed: throw → emit empty/title-only digest, never unscanned prose). The metadata overlay
  is already present in the job.

**Execution note:** Test-first — the upstream scan is security-critical; write the
private-hit-drops-enrichment test (and its mutation proof) before the implementation.

**Patterns to follow:** the existing `harvestCandidates` pagination + retry-continue; the
pure-core/I/O-shell split; the `loadPrivateTokensFromDisk` fail-closed contract from Unit 1.

**Test scenarios:**
- Happy: a candidate with review bodies + thread comments → `reviewExcerpts` populated, ranked
  with correction prose first.
- Privacy (R2), load-bearing: a candidate whose review prose contains a private token → enriched
  content dropped fail-closed; assert the private token does NOT appear in the digest or any
  output. **Mutation-prove**: removing the scan lets the private prose into the digest → test fails.
- Fail-closed: unreadable `metadata/repos.yaml` → no enriched content emitted (title-only or empty),
  never unscanned prose; no crash.
- Budget (R3): over-budget enriched content is truncated; correction-signal prose is retained over
  approval boilerplate; assert the correction sentence survives a representative trim.
- Thread comments: `pulls.listReviewComments` paginated; a candidate with multi-page comments
  includes later pages.
- Opacity (R4): `reviewExcerpts` after the scan contains no tracked private identifier; candidate
  still keyed by merge SHA.
- Telemetry: `enrichmentBlocked` (or equivalent) count is correct in a mixed scenario.
- Error path: a transient `listReviewComments` failure for one candidate degrades that candidate to
  title-only, does not abort the run.

**Verification:** gates green (~1212+ baseline plus new tests); strip-only load clean; the privacy
mutation-proof bites; no private identifier in any digest/output for the private-prose fixture.

- [ ] **Unit 3: Update the agent prompt to distill from review excerpts**

**Goal:** Point the agent at `reviewExcerpts` as the primary substance, so it distills from review
prose rather than title tokens.

**Requirements:** R1.

**Dependencies:** Unit 2.

**Files:**
- Modify: `.github/workflows/capture-learnings.yaml`

**Approach:**
- Update the `Author proposal bodies` step prompt: the digest candidates now carry
  `reviewExcerpts` (privacy-scanned review/thread prose); instruct the agent to base the learning
  on what the review rounds actually said, using `reviewExcerpts` as the primary signal and
  title/labels only as secondary context. Keep all existing hard boundaries (merge-SHA-only
  references, write only the bodies file, no other actions). Keep the `reviewRounds` description
  accurate (substantive rounds).

**Test expectation:** none — workflow prompt wiring; validated by actionlint and a manual dispatch
that shows `reviewExcerpts` populated in the digest and the agent citing review-derived substance.

**Verification:** actionlint clean; a manual `workflow_dispatch` shows the digest carries
privacy-scanned `reviewExcerpts`, the agent authors bodies grounded in review prose, and no private
identifier appears in the run log.

# System-Wide Impact

- **Interaction graph:** harvest gains one paginated API call per candidate (≤ 5) and an upstream
  privacy scan; the digest gains an enrichment field; the agent prompt changes its primary signal.
  The open step is unchanged except importing the gate from the shared module.
- **Error propagation:** the upstream scan is fail-closed (no token set ⇒ no enriched content); a
  per-candidate enrichment-fetch error degrades to title-only, never aborts. The open step's
  authored-body scan remains as defense-in-depth.
- **State lifecycle risks:** none new — no persisted state; the decision log (proposal issues)
  is untouched.
- **API surface parity:** the harvest-time gate and the open-step gate now share one module, so
  they cannot drift — the explicit goal of the extraction.
- **Unchanged invariants:** opacity (merge-SHA keying), the detection predicate, the dedup marker,
  the cost cap, and the data-branch authority model.

# Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Review prose leaks a private identifier into the agent's context | Fail-closed upstream scan at harvest (R2) before the digest; mutation-proven; drop-not-redact |
| Truncation clips the correction sentence (generic-platitude failure in a new costume) | Rank by correction signal not chronology (R3); test that the correction sentence survives a trim |
| Gate drift between harvest and open | Single shared module (Unit 1) imported by both |
| Per-candidate `listReviewComments` cost | Bounded by `MAX_LEARNINGS_PER_RUN = 5`; runs only after the predicate filter |
| Harvest can't read `metadata/repos.yaml` | Fail-closed: emit title-only/empty, never unscanned prose |

# Documentation / Operational Notes

- After landing, the upstream-privacy-gate-at-harvest pattern is a candidate `docs/solutions/`
  learning (a gate moved to sit inside the trust boundary it protects) — author via `ce:compound`
  if it proves reusable.
- Close #3552 when this ships.

# Sources & References

- **Origin document:** docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
- **Seed:** issue #3552 (Fro Bot triage — the grounded technical analysis this plan implements)
- Code: `scripts/capture-learnings-harvest.ts` (`harvestCandidates`, `deriveSignals`, `Candidate`,
  `buildCandidateDigest`), `scripts/capture-learnings-open.ts` (`learningBodyHasPrivateLeak`,
  `loadPrivateTokensFromDisk`), `scripts/wiki-slug.ts` (`buildPrivateNameTokens`),
  `.github/workflows/capture-learnings.yaml`
- Prior plan: docs/plans/2026-06-22-002-feat-capture-c1-proposals-plan.md
