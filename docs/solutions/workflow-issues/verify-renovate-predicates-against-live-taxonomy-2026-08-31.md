---
title: Verify Renovate predicates against the live dependency taxonomy
date: 2026-08-31
last_updated: 2026-08-31
category: workflow-issues
module: default.json
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "a Renovate rule matches an enum-like field such as matchDepTypes or matchManagers"
  - "an upstream Renovate release changes how dependencies are classified"
  - "a rule is intended to cover both action invocations and reusable workflow references"
tags:
  - github-actions
  - tooling
  - drift-detection
  - validation
  - enumeration
  - supply-chain
  - pin-integrity
---

# Verify Renovate predicates against the live dependency taxonomy

## Context

The `fro-bot/agent` rule added in #3802 excludes harness release tags from action
updates. Its correctness depends on two independent resolutions: how Renovate classifies
the dependency and how it compares the candidate tag. The final `default.json` rule
matches the exact package name, excludes tags containing `harness.`, and lists both
`action` and `workflow` dependency types.

That second value was not inferred from the rule's prose. Renovate 44.46.0 had already
split reusable-workflow `uses:` references whose path is `.github/workflows/<file>.y[a]ml`
into a new `workflow` depType. A rule that retained only `action` would still look
reasonable and would silently stop covering one of the two call shapes.

## Guidance

1. **Treat enum-valued predicates as upstream-owned taxonomies.** `matchDepTypes`,
   `matchManagers`, and similar fields are allowlists. A new upstream member is an
   uncovered path until the rule names it.
2. **Check the installed version, not a remembered changelog.** Record the exact
   Renovate version running in the deployment and verify the classification behavior
   against that version's output or implementation before editing the rule.
3. **Test both dependency shapes.** For a GitHub Actions rule, include ordinary
   `uses: owner/repo/path@ref` action references and reusable workflow references under
   `.github/workflows/`.
4. **Verify candidate resolution separately from matching.** Confirm that the excluded
   tag fails the `allowedVersions` predicate and that the intended action tag passes.
   A syntactically valid rule can still resolve the wrong datasource or version shape.
5. **Prefer a predicate about the defect over a temporary ceiling when possible.** A
   tag-shape exclusion survives the action's future move to `1.0`; a version ceiling
   eventually becomes an undocumented maintenance trap.

## Why This Matters

Configuration drift here is silent. Renovate can continue to run successfully while a
rule matches fewer dependencies than its author intended. The result is not a red
configuration error; it is a protection that no longer covers a class of updates.

The failure is especially easy to miss when a field looks like a stable vocabulary. The
taxonomy belongs to the tool, not to the repository. Verifying the live version turns an
implicit assumption into an observable contract and makes the rule's coverage auditable.

## When to Apply

- Adding or changing `matchDepTypes`, `matchManagers`, `matchDatasources`, or similar
  predicates.
- Upgrading Renovate, a package manager, or a parser that feeds dependency extraction.
- A rule covers multiple GitHub Actions `uses:` forms or nested action paths.
- A cap or exclusion is intended to survive a future major-version boundary.
- A green Renovate run does not prove that every intended dependency was matched.

## Examples

### The live rule

The committed rule in `default.json` is explicit about both coverage and exclusion:

```json5
{
  "matchDepTypes": ["action", "workflow"],
  "matchPackageNames": ["fro-bot/agent"],
  "allowedVersions": "!/harness\\./"
}
```

The unanchored regular expression is deliberate: it excludes the harness marker
wherever it occurs in a tag rather than assuming a particular version-prefix shape.
The description records that Renovate 44.46.0 introduced the `workflow` classification,
so a future maintainer can re-check the rule when that tool behavior changes.

### The checkable resolution matrix

For the rule above, verify at least these cases against the Renovate version actually
running:

| Input | Expected result |
| --- | --- |
| `fro-bot/agent` as `action`, tag `v0.92.0` | matched and allowed |
| `fro-bot/agent` as `workflow`, reusable workflow path | matched and allowed |
| `fro-bot/agent`, tag `1.18.21+harness.<sha>` | matched but rejected by `allowedVersions` |
| unrelated package with the same tag shape | not matched by the package rule |

The important distinction is between "the regex rejects this candidate" and "the rule
never saw this dependency." Test both; otherwise a narrowed depType allowlist can hide
behind a passing exclusion test.

## Related

- [Lockfiles are advisory until the build gates them](lockfiles-are-advisory-until-gated-2026-07-11.md) — a dependency-control claim is real only when the actual tool path enforces it.
- [Verify in the CI topology, not just locally](../best-practices/verify-in-the-ci-topology-not-just-locally-2026-07-11.md) — the same principle applied to the runtime environment that resolves dependencies.
- [Quote required-status-check contexts that contain a colon](quoted-required-status-check-context-2026-06-09.md) — configuration strings are contracts across multiple consumers, not just local syntax.
