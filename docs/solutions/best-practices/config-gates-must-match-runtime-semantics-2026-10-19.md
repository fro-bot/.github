---
title: Configuration gates must match the consuming runtime's semantics
date: 2026-10-19
category: best-practices
module: Renovate configuration gate
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "a configuration gate wraps a tool's parser, versioning API, or preset resolver"
  - "an optional native dependency changes the tool's validation behavior"
  - "a tool upgrade changes fallback or file-resolution rules"
tags:
  - renovate
  - validation
  - runtime-parity
  - regression-testing
---

# Configuration gates must match the consuming runtime's semantics

## Context

Review of PR #4003 reproduced three false greens in a Renovate configuration gate:
JavaScript regex fallback accepted RE2-incompatible lookahead, npm normalization
accepted a range rejected by the raw semver fallback, and preset lookup could
validate a file Renovate would not resolve. These were review-time defects, fixed
before merge. The final review approved the corrections; the source PR's Check
Workflows job passed the gate and all 102 focused tests against Renovate 44.165.2.

## Guidance

1. **Assert the active engine, not just the installed version.** In
   `scripts/renovate-runtime.ts`, fresh and reused scratch installations provision
   RE2 when needed. Runtime loading also requires Renovate to report RE2 as
   available. Installing with lifecycle scripts disabled alone leaves the native
   binding unavailable and permits a different regex language.
2. **Preserve fallback order and normalization boundaries.**
   `scripts/check-renovate-ranges.ts` tries the regex predicate, the selected
   versioning's `isValid`, then raw `semver.validRange` from the same installation.
   Npm's legacy-range normalization belongs to npm versioning, not the fallback.
3. **Resolve exactly the file the consumer reads.** For the pinned Renovate
   resolver, a default preset tries `default.json`, then `renovate.json`;
   an extensionless named preset tries only `<name>.json`. Explicit `.json5`
   filenames remain supported. Do not invent extra fallback candidates.
4. **Use distinguishing regressions against the pinned runtime.** Compare requested
   filenames with Renovate's own resolver and exercise the whole gate with fixture
   repositories. Reject unsupported selectors rather than validating only their
   containing file: the merged gate fails closed on slash-qualified sub-presets.

## Why This Matters

A schema-valid value can still fail at lookup time. Even reusing a tool's APIs is
insufficient if the gate silently selects another engine, changes normalization,
or reads different bytes. Mock-only tests can preserve that mismatch indefinitely.

Parity also needs an explicit scope. This gate uses npm when no versioning is
declared, skips templated ranges, and reports floating GitHub presets as unvalidated.
A green result does not establish complete downstream execution equivalence.

## When to Apply

Use this pattern when adding or upgrading a configuration gate, reusing a cached
tool installation, or substituting a parser or resolver for production behavior.
Recheck these boundaries when the pinned consumer changes.

## Examples

| Distinguishing input | Required result for the pinned gate |
| --- | --- |
| `allowedVersions: '/^(?!2)/'` with npm versioning | Reject: JavaScript accepts lookahead, RE2 does not |
| `allowedVersions: '1.x.5'` with Docker versioning | Reject: raw semver fallback does not normalize it |
| The same range with npm versioning | Accept through npm's own normalization |
| Default preset with only `default.json5` present | Fail resolution, rather than guessing that file |
| Default preset with both `default.json` and `renovate.json` | Validate `default.json` |
| Named preset `rules/missing` with a valid `rules.json` | Reject the unsupported selector |

The committed regression cases live in `scripts/check-renovate-ranges.test.ts`,
`scripts/check-renovate-config.test.ts`, and `scripts/renovate-runtime.test.ts`.
Their real-runtime suites require `RENOVATE_PREFIX`; ordinary mock-only runs do
not substitute for those checks.

## Related

- Source PR #4003, merge commit `e826ccb2b7cab00df5e8ecc4ffd358f32d1d0483`.
- [Source CI job](https://github.com/fro-bot/.github/actions/runs/39146607734/job/117731613898).
- [Verify Renovate predicates against the live dependency taxonomy](../workflow-issues/verify-renovate-predicates-against-live-taxonomy-2026-08-31.md) (`docs/solutions/workflow-issues/verify-renovate-predicates-against-live-taxonomy-2026-08-31.md`) covers dependency matching rather than gate parser and resolver parity.
