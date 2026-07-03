---
title: Closed-vocabulary telemetry keys recovered from public artifact bodies
date: 2026-07-03
category: best-practices
module: status-truth-proposals
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - telemetry or counts must be keyed by metadata recovered from public issue/PR bodies
  - artifact bodies are editable by parties other than the bot
  - historical artifacts predate the machine-readable marker being introduced
tags:
  - telemetry
  - hidden-markers
  - closed-vocabulary
  - status-truth
  - kind-recovery
  - counts-only
---

# Closed-vocabulary telemetry keys recovered from public artifact bodies

## Context

Per-claim-kind outcome telemetry for Status Truth proposals required recovering each proposal
issue's claim kind at classification time. The kind lives in the issue body — a public,
human-editable surface — and proposals created before the feature had no machine-readable kind
marker at all. Naively keying counts by whatever text is extracted from a body would let anyone
who can edit an issue mint arbitrary telemetry keys, and would orphan the historical signal.

## Guidance

Three rules make body-recovered metadata safe to use as counts keys:

1. **Hidden marker first, human-visible fallback second, `unknown` last.** New artifacts carry a
   strict hidden marker (`<!-- status-truth:kind=<kind> -->`, same family as the fingerprint and
   live-state markers). Recovery precedence: marker → visible `**Kind:** \`...\`` body line (for
   pre-marker artifacts) → `unknown`. The fallback keeps historical outcomes countable without a
   backfill pass.
2. **Validate against a closed vocabulary before use.** Whatever text recovery yields is checked
   against the known claim-kind set; anything unrecognized buckets as `unknown`. Body text can
   influence *which known bucket* increments, but can never create a new key — hostile or
   malformed bodies cannot inject columns into a rendered summary table.
3. **Share the classification pass.** Per-kind aggregation reuses the same
   `classifyProposalOutcome` call as the global counts (one pass, two accumulators), so the two
   tables can never disagree about an issue's outcome.

```typescript
recoverProposalKind(body)   // marker → visible line → 'unknown'; validated vs KNOWN_CLAIM_KINDS
buildOutcomeCountsByKind(issues, activeFingerprints) // shares classifyProposalOutcome
```

## Why This Matters

Telemetry keys become rendered output (workflow summary tables) and future decision inputs
(graduation math reads accepted-vs-rejected per kind). An open key-space turns an editable public
body into an injection vector for both. The closed vocabulary bounds the blast radius of any body
edit to a miscount in an existing bucket — visible and correctable — rather than arbitrary
content in a rendered surface.

## When to Apply

- Any counts/telemetry keyed by data parsed from issue, PR, or comment bodies.
- Migration situations where older artifacts lack the marker a new feature relies on — prefer
  recovery-precedence over backfill writes when the fallback is reliable.
- Anywhere a summary table's row/column space is derived from external text.

## Examples

The first live run after shipping recovered all three pre-marker proposal issues via the visible
body-line fallback and rendered `plan-consistency: resolvedPositive=3` — historical lifecycle
signal preserved with zero backfill writes, no `unknown` rows, and no new keys mintable from body
edits.

## Related

- [status-truth-synthetic-self-audit-claim-kinds-2026-07-03](status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md) — sentinel normalization at ingestion (same never-trust-file-text principle)
- [structured-first-attribution-for-public-allowlist-privacy-gates](structured-first-attribution-for-public-allowlist-privacy-gates.md) — structured metadata over body text
- Source event: PR #3620
