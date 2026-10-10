---
title: Dependency holds need explicit lift conditions
date: 2026-08-31
last_updated: 2026-10-09
category: best-practices
module: .github/renovate.json5
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "a Renovate rule uses allowedVersions to hold a dependency below an incompatible release"
  - "a peer dependency or upstream issue explains why a version range is unsafe"
  - "the held package may become safe after an upstream parser, compiler, or plugin release"
  - "a pnpm override floor is meant to exclude vulnerable transitive releases"
  - "a repository-wide advisory gate evaluates multiple dependency floors together"
tags:
  - tooling
  - supply-chain
  - pin-integrity
  - drift-detection
  - validation
  - override-floors
  - audit-gate
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

The same rule applies to `pnpm-workspace.yaml` override floors, with a second failure mode: a floor
can be satisfied and still unsafe. In PR #3871, `fast-uri` had an override floor of `>=4.1.2`. The
lockfile satisfied it, but four HIGH advisories were patched only in `>=4.1.3`. The install was green
because the floor was met, while the lowest version the floor admitted was still vulnerable.

That review found the same defect one line away and a related gap: `brace-expansion` was floored at
`>=5.0.8` while its HIGH advisory was patched in `>=5.0.9`, and `nanoid` had a HIGH advisory and no
override at all. Once one satisfied-but-unsafe floor turns up, audit every other override in the file
and every high-severity advisory that has no floor.

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

For advisory-driven override floors, add a check: **prove the floor is safe, not merely satisfied.**
Compare every version the override admits against the advisory's patched range. A floor of `>=4.1.2`
is satisfied indefinitely by a vulnerable resolution when the advisory is patched at `>=4.1.3`.
PR #3871 used this checklist:

1. Raise the floor above the patched range for every live high-severity advisory on the package.
2. Look for affected packages that have no override entry; auditing only existing overrides misses
   the `nanoid` case.
3. Run a lockfile-only frozen install, so the override and lockfile agree without unrelated drift.
4. Verify the new lockfile integrity against the registry, and check that license and engine
   constraints stay within the intended boundary.
5. Confirm a single resolved instance of the package and that `pnpm audit` no longer reports the
   advisory.

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

Satisfied-but-unsafe floors also interact badly with a repository-wide gate.
`scripts/check-override-floors.ts` runs inside `pnpm lint` and audits every live high-severity
advisory against every override in `pnpm-workspace.yaml` in one pass. That is the right shape for a
recurrence gate, and it means a PR that fixes one unsafe floor stays red while any other flagged
package remains. Remediation has to match the gate's scope.

That happened with the per-package autoheal PRs #3941 (`undici`), #3942 (`brace-expansion`), and
#3954 (`source-map-js`). Each fixed its own package and failed `Lint` on the others' advisories, and
none merged. `main`'s required Lint failed on 2026-09-30 and did not return green until PR #3959
combined all the flagged floors on 2026-10-09. The gate was correct; the one-PR-per-package strategy
was too narrow. PR #3968 then changed the Fro Bot remediation prompt to require one combined PR on
`fix/security-override-floors`, and `scripts/fro-bot-workflow.test.ts` pins that rule.

## When to Apply

- Adding `allowedVersions`, `rangeStrategy`, a package override, or a transitive pin.
- Holding a compiler, parser, linter, runtime, or framework because of peer incompatibility.
- A future release is expected to remove the incompatibility.
- A dependency rule has a ceiling whose exactness is not obvious from neighboring rules.
- Someone needs to decide whether an old hold is safe to remove without the original
  author present.
- Raising or adding a `pnpm-workspace.yaml` override because `pnpm audit` reports a high-severity
  transitive advisory.
- A recurrence gate checks the whole dependency graph, not only the package a remediation PR chose
  to touch.
- An automated remediation agent opens one PR per advisory, but the required check evaluates all
  advisories together.

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

### A satisfied floor that was still vulnerable

Before PR #3871 the `fast-uri` override looked valid because the lockfile met it:

```yaml
overrides:
  fast-uri: '>=4.1.2'
```

The advisory's patched range started at `4.1.3`, so the floor admitted vulnerable versions
indefinitely. The fix changed the question from "does the resolver satisfy this constraint?" to
"does every version this constraint admits sit in a patched range?":

```yaml
overrides:
  fast-uri: '>=4.1.3'
```

### Match the remediation unit to the gate

`check-override-floors` is global: it parses `pnpm audit --json`, reads every `overrides` entry in
`pnpm-workspace.yaml`, and fails if any high-severity advisory lacks a safe floor. Separate PRs cannot
merge independently while several advisories are live:

- #3941 (`undici`) stayed red on `brace-expansion`.
- #3942 (`brace-expansion`) stayed red on `undici`.
- #3954 (`source-map-js`) stayed red on `undici` and `brace-expansion`.

PR #3959 fixed them together by raising `undici` to `>=8.10.2` and `brace-expansion` to `>=5.0.12`
and adding `source-map-js` at `>=1.2.2`, with an advisory comment and a removal condition on each:

```yaml
# GHSA-w293-vg96-wgc3, GHSA-vp8m-p9jh-q5pm, and GHSA-rfgv-xxqx-mfg5 affect <8.10.2.
# Remove this floor only when all parent ranges exclude the affected versions.
undici: '>=8.10.2'
```

Override-floor repairs are therefore the exception to one-PR-per-package in the remediation prompt:
the prompt requires running `node scripts/check-override-floors.ts` on a clean checkout of `main`,
fixing every flagged package in one PR, and opening or updating it only when that command exits 0.

## Related

- [Verify Renovate predicates against the live dependency taxonomy](../workflow-issues/verify-renovate-predicates-against-live-taxonomy-2026-08-31.md) — verify that the tool actually matches the dependency shape the hold is meant to govern.
- [Lockfiles are advisory until the build gates them](../workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md) — a dependency-control claim needs enforcement, not just recorded intent; a lockfile proves intent only after a gate checks the postcondition the security claim depends on.
- [Verify in the CI topology, not just locally](verify-in-the-ci-topology-not-just-locally-2026-07-11.md) — validate compatibility in the environment that runs the toolchain.
