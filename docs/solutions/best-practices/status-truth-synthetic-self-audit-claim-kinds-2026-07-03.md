---
title: Synthetic self-audit claim kinds for in-file drift detection
date: 2026-07-03
category: best-practices
module: status-truth-detect
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - drift lives inside the same file as its source of truth
  - no prose claim can reasonably be expected to exist
  - a bounded second pass over a small file corpus is acceptable
  - the finding can conform to the existing public report contract
related_components:
  - development_workflow
tags:
  - status-truth
  - synthetic-claims
  - drift-detection
  - frontmatter
  - fingerprint
  - sentinel-normalization
  - claim-resolution
---

# Synthetic self-audit claim kinds for in-file drift detection

## Context

The Status Truth loop originally detected drift only through prose extraction: every claim kind in
`CLAIM_KIND_DEFINITIONS` carries a regex, and `extractStatusTruthClaimsFromText` scans documents
for claim sentences ("PR #907 is open", "docs/plans/foo.md is complete"). That model is
structurally blind to drift living inside a file rather than in prose about it. Three shipped
plans sat with stale `status: active` frontmatter for a week while every implementation-unit
checkbox was checked — no prose claim existed, so no resolver could fire. Signal starvation is the
failure mode: if nobody writes the sentence, the drift is invisible.

The `plan-consistency` claim kind solved this with a synthetic self-audit: every plan file emits
one claim derived from its own contents, comparing frontmatter status against unit-checkbox state.

## Guidance

Seven design elements make a synthetic claim kind safe inside a prose-extraction host:

1. **Union membership without registry membership.** The kind joins `ClaimKind` but gets no
   `CLAIM_KIND_DEFINITIONS` entry — forcing a regex onto a non-textual claim would be fiction. A
   test pins `CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'plan-consistency')` to `undefined` so
   the boundary is explicit.
2. **Bounded second pass over injected I/O seams.** The scan shell consumes file contents
   internally, so the builder re-reads its corpus through the same injected `fileLister`/
   `fileReader` seams instead of widening the scan API. Read failures fold into scan-error
   accounting; a failed read never fabricates a clean report.
3. **Single resolver returns the final verdict.** The drift matrix is one function
   (`resolvePlanConsistencyVerdict`) returning `current | drifted | unresolved` directly. The
   shared equality classifier is bypassed: one-directional rules (stale `active` drifts; overclaimed
   `complete` is only unresolved) cannot be expressed as `liveState === claimedState`.
4. **Sentinel normalization at ingestion.** `claimedState` collapses any frontmatter status
   outside `SUPPORTED_PLAN_STATUSES` to the constant `unsupported` before the claim exists, so
   arbitrary or malformed file text can never reach a public surface. One privacy test per surface
   (report JSON, proposal title, body, comments, stdout summary).
5. **Constant normalized text for fingerprint stability.** The fingerprint is computed from kind,
   path, sourceRef, and a constant — never from mutable unit state — so a plan keeps one
   fingerprint across drift episodes. Consequences become intentional semantics: terminal outcome
   labels (`rejected`/`false-positive`) are permanent per-file opt-outs, and file deletion/rename
   auto-closes the proposal via close-on-clear.
6. **Round-trip every marker contract.** Synthetic state strings pass through pre-existing hidden
   marker regexes. The first `checked=2 unchecked=0` encoding broke the `[\w-]+` live-state marker
   round-trip in proposal comments; `checked-2-unchecked-0` survives. Test the round-trip, not
   just the producer.
7. **Conform to the finding contract and inherit the pipeline.** Findings shaped as
   `PublicStatusTruthFinding` get mutation caps, same-run dedupe, cooldowns, outcome labels, and
   the public-output gate with zero planner or workflow changes.

## Why This Matters

Prose-extraction loops only see drift someone narrated. Self-consistency drift — a file
contradicting itself — is both the most common staleness class and the one no seeding convention
can cover, because nobody writes claims about every file. The synthetic pattern closes the blind
spot without a second reporting pipeline, and the passthrough dividend means the new kind costs
nothing in planner, workflow, or privacy-gate maintenance. Skipping the discipline has concrete
failure modes: equality classifiers silently invert one-directional rules; fingerprints derived
from mutable state resurrect suppressed proposals; unnormalized file text leaks into public
artifacts.

## When to Apply

- The source of truth and the claim live in the same file (self-consistency audit).
- No prose claim can reasonably be expected to exist for each instance.
- The corpus is small enough for a bounded re-read pass.
- The finding can conform to the existing report/proposal contract.
- You need self-consistency checking, not cross-file narration.

## Examples

Shapes from the shipped implementation (`scripts/status-truth-detect.ts`):

```typescript
parsePlanUnitCheckboxes(content)            // → {recognized, checked, unchecked}
buildPlanConsistencyClaim({path, content})  // → StatusTruthClaim (claimedState normalized)
resolvePlanConsistencyVerdict({claim, units}) // → final verdict, no equality fallback
scanPlanConsistencyFindings({fileLister, fileReader}) // → findings + scanErrors
```

Validation evidence: the first live corpus run detected exactly the three known-stale plans with
zero false positives. The full lifecycle closed the same day — the live run opened three proposal
issues, the frontmatter fix merged, and the next run auto-closed all three as resolved — producing
the loop's first per-kind outcome signal.

## Related

- [structured-first-attribution-for-public-allowlist-privacy-gates](structured-first-attribution-for-public-allowlist-privacy-gates.md) — structured provenance over body text
- [pure-core-privacy-gates-shared-module-2026-06-22](pure-core-privacy-gates-shared-module-2026-06-22.md) — pure-core/shell split with mutation-proof gate tests
- [privacy-gate-promotion-leak-prevention-2026-06-04](privacy-gate-promotion-leak-prevention-2026-06-04.md) — fail closed on resolver ambiguity
- [identity-guard-stable-scalar-fallback-2026-06-22](identity-guard-stable-scalar-fallback-2026-06-22.md) — stable scalar fallback normalization
- [verify-whole-public-perimeter-2026-06-22](../security-issues/verify-whole-public-perimeter-2026-06-22.md) — one privacy assertion per public surface
- [github-issues-api-same-run-eventual-consistency-2026-05-20](github-issues-api-same-run-eventual-consistency-2026-05-20.md) — same-run staleness discipline
- Source events: PR #3613 (implementation), PR #3611 (fix), issues #3614–#3616 (first proposal lifecycle)
