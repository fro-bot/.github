---
title: Closed-vocabulary identifiers for automated inspection and drift detection
date: 2026-07-09
category: best-practices
module: status-truth
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - identifiers consumed by automated inspection or recovery must match a known finite set
  - machine-authored artifacts carry editable text that can influence downstream classification
  - drift detection over heterogeneous sources needs deterministic matching
related_components:
  - development_workflow
tags:
  - closed-vocabulary
  - status-truth
  - identifier-constraint
  - drift-detection
  - enumeration
  - design-constraint
---

# Closed-vocabulary identifiers for automated inspection and drift detection

## Context

Two independent Status Truth fixes converged on the same design constraint.

Outcome telemetry recovered claim kinds from public proposal bodies. Without a closed key space, editable issue text could mint new telemetry rows and summary-table keys. Plan-consistency detection had the same risk from another direction: frontmatter status and unit-checkbox state came from human-editable files, then flowed into finding records, proposal titles, comments, and stdout summaries.

Both fixes replaced open-ended identifier recovery with fixed vocabularies and sentinel normalization. Public-body recovery validates against known claim kinds; file-state ingestion collapses unsupported status values before building the claim. The repeated lesson is broader than either implementation: automated inspection must not let upstream text define the identifiers it later renders or decides on.

## Guidance

Use a closed, enumerated vocabulary for identifiers consumed by inspection, drift detection, telemetry, or recovery loops.

The pattern has five parts:

1. **Enumerate at the boundary.** Define the finite identifier set before reading upstream text. Anything outside the set maps to a sentinel such as `unknown` or `unsupported`.
2. **Normalize before rendering or deciding.** Raw recovered text should never become a map key, table row, claim kind, verdict, or proposal-title fragment.
3. **Share one classification pass.** Counts, summaries, and decision logic should consume the same normalized result. Parallel classifiers drift.
4. **Preserve old artifacts with precedence, not backfill.** Prefer marker → visible field → sentinel recovery when older artifacts predate structured markers. Avoid write-heavy migrations when deterministic recovery is enough.
5. **Test the round trip.** Hidden markers, sentinels, fingerprints, and public summaries need end-to-end tests. Producer-only tests miss regex and rendering failures.

```ts
const KNOWN_KEYS = ['plan-consistency', 'issue-state', 'release-state'] as const
type KnownKey = (typeof KNOWN_KEYS)[number]

function recoverKnownKey(value: string): KnownKey | 'unknown' {
  return (KNOWN_KEYS as readonly string[]).includes(value) ? (value as KnownKey) : 'unknown'
}
```

The exact names do not matter. The invariant does: upstream text may select an existing bucket, but it must not create a new one.

## Why This Matters

Identifiers used by automated inspection are often both output and input. Humans read them in workflow summaries, proposal bodies, and issue comments. Machines use them for graduation math, drift resolution, deduplication, and future gating.

An open key space collapses that boundary. A malformed or hostile artifact can create a new public row and a new downstream decision key at the same time. A closed vocabulary bounds the blast radius to a visible miscount in an existing bucket. That is reversible. A new machine-recognized key invented by upstream text is not.

Closed vocabularies also make self-improvement loops easier to reason about. Once the set is finite, per-kind outcome counts, cooldowns, suppression rules, and public-output tests can be exhaustive instead of heuristic.

## When to Apply

- Public issue, PR, comment, or artifact text feeds a telemetry key, table row, claim kind, status, or verdict.
- Human-editable files feed drift-detection claims or automated summaries.
- One recovered string affects both rendered output and machine decisions.
- Older artifacts need to stay countable without a backfill write.
- A summary surface would otherwise derive rows or columns from arbitrary text.

Do not force this pattern onto identifiers that are intentionally open by design, such as user-defined tags where each distinct value is the point. The constraint is for inspection and decision surfaces, not for every string map.

## Examples

**Public artifact recovery**

Recovering a claim kind from issue bodies should use marker → visible fallback → sentinel precedence, then validate against the known vocabulary. Body text can increment a known bucket; it cannot create a new telemetry key.

**File-backed drift detection**

Plan frontmatter status should be parsed into supported statuses or `unsupported` before claim construction. The resolver should compare normalized states, not raw strings.

**Public-output gates**

Run the normalized value through the same public-output gate used by proposal bodies, comments, report JSON, and stdout summaries. One assertion per public surface keeps the closed-vocabulary contract honest.

## Related

- [Closed-vocabulary telemetry keys recovered from public artifact bodies](closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md)
- [Synthetic self-audit claim kinds for in-file drift detection](status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md)
- [Structured-first attribution for public-allowlist privacy gates](wiki-page-structured-attribution-2026-06-04.md)
- [Pure-core privacy gates with a shared module and mutation-proof tests](pure-core-privacy-gates-shared-module-2026-06-22.md)
- [Verify the whole public perimeter](../security-issues/verify-whole-public-perimeter-2026-06-22.md)
- Pattern proposal: [#3667](https://github.com/fro-bot/.github/issues/3667)
