---
title: Dependency holds need explicit lift conditions
date: 2026-08-31
last_updated: 2026-08-31
category: best-practices
module: .github/renovate.json5
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "a Renovate rule uses allowedVersions to hold a dependency below an incompatible release"
  - "a peer dependency or upstream issue explains why a version range is unsafe"
  - "the held package may become safe after an upstream parser, compiler, or plugin release"
tags:
  - tooling
  - supply-chain
  - pin-integrity
  - drift-detection
  - validation
---

# Dependency holds need explicit lift conditions

## Context

The TypeScript hold from #3804 is encoded in `.github/renovate.json5`, where the
repository currently uses `allowedVersions: '<6.1.0'`. The inline explanation names the
failure mechanism: `typescript-eslint` reads `ts.Extension.Cjs`, which the TypeScript 7
rewrite no longer exposes, causing type-aware linting to crash. It also points to
`typescript-eslint#12518`, records the observed peer range through version 8.68.0
(`typescript >=4.8.4 <6.1.0`), and states the condition for removal: a parser release
whose peer range permits TypeScript 7.x.

That comment is part of the control. Without it, a future maintainer sees only a stale
ceiling and either deletes a still-needed guard or leaves the project frozen after the
upstream incompatibility is fixed.

## Guidance

Every dependency hold, resolution override, or transitive pin should explain four
things inline:

1. **What breaks.** Name the consumer and the observable failure, not just "incompatible"
   or "wait for upstream."
2. **Where the fix is tracked.** Link the upstream issue, release, or changelog entry
   that owns the compatibility problem.
3. **What constraint gates the hold.** State the exact peer ceiling or other version
   boundary that the rule mirrors.
4. **What lifts it.** Give a checkable release or condition, such as a parser peer range
   that admits the next compiler major.

Choose the ceiling deliberately. An exact ceiling such as `<6.1.0` mirrors the actual
peer contract and prevents unsupported minor releases from flowing in. A looser ceiling
such as `<7` can be reasonable when another independent rule enforces the real peer
boundary, but the comment must say that the neighboring rule is load-bearing. Otherwise
the apparent hold is weaker than it looks.

## Why This Matters

Dependency holds are intentionally sticky: Renovate will keep respecting them without
asking whether their reason still exists. The absence of a lift condition turns a
temporary compatibility guard into permanent drift, while an inaccurate ceiling admits
the very versions the hold was meant to block.

The explanation also prevents a misleading repair. In this case, changing the ceiling
from `<7` to `<6.1.0` matters because TypeScript 6.1.x is already outside the
`typescript-eslint` peer range. The precise constraint is not pedantry; it is the
difference between matching the real toolchain contract and merely avoiding the next
major number.

## When to Apply

- Adding `allowedVersions`, `rangeStrategy`, a package override, or a transitive pin.
- Holding a compiler, parser, linter, runtime, or framework because of peer incompatibility.
- A future release is expected to remove the incompatibility.
- A dependency rule has a ceiling whose exactness is not obvious from neighboring rules.
- Someone needs to decide whether an old hold is safe to remove without the original
  author present.

## Examples

### A hold that carries its own exit map

The current rule documents the cause, upstream issue, exact ceiling, and lift condition
next to the configuration it governs:

```json5
// typescript-eslint reads `ts.Extension.Cjs`, which TypeScript 7's native
// rewrite no longer exposes, so type-aware linting crashes outright rather
// than warning. Upstream: typescript-eslint#12518. Every release through
// 8.68.0 still peers `typescript >=4.8.4 <6.1.0`, so this mirrors that peer
// ceiling exactly rather than capping at `<7`: 6.1.x is equally unsupported.
// Lift this once @typescript-eslint/parser publishes a peer range that permits 7.x.
{
  description: 'Hold TypeScript below 6.1 to match the typescript-eslint peer ceiling',
  matchPackageNames: ['typescript'],
  allowedVersions: '<6.1.0',
}
```

### Exact versus loose ceilings

| Choice | Benefit | Cost that must be documented |
| --- | --- | --- |
| `<6.1.0` | Mirrors the known peer ceiling directly | Must be revisited when the peer range changes |
| `<7` | Expresses the major-version intent and may compose with another rule | Unsafe 6.1.x candidates are admitted unless another rule blocks them |

The safer default is the narrowest ceiling justified by the current peer contract. If a
broader rule is intentional, name the separate rule and its responsibility rather than
letting the safety argument live in configuration archaeology.

## Related

- [Verify Renovate predicates against the live dependency taxonomy](../workflow-issues/verify-renovate-predicates-against-live-taxonomy-2026-08-31.md) — verify that the tool actually matches the dependency shape the hold is meant to govern.
- [Lockfiles are advisory until the build gates them](../workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md) — a dependency-control claim needs enforcement, not just recorded intent.
- [Verify in the CI topology, not just locally](verify-in-the-ci-topology-not-just-locally-2026-07-11.md) — validate compatibility in the environment that runs the toolchain.
