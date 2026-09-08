---
title: An exact-match trust gate needs type discipline — establish shape before a coercing consumer sees the value
date: 2026-09-08
last_updated: 2026-09-08
verified: 2026-09-08
category: best-practices
module: scripts/check-wiki-private-presence.ts
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - comparing a parsed value against an expected string at a trust boundary
  - the value comes from YAML, JSON, or any source where a scalar and a one-element list are both well-formed
  - deleting a `!== undefined` or `typeof` conjunct because every current caller satisfies it
tags:
  - trust-boundary
  - type-coercion
  - attribution
  - fail-open
  - guard-invariants
---

# An exact-match trust gate needs type discipline — establish shape before a coercing consumer sees the value

## Context

`Array.prototype.toString()` joins with a comma, so a single-element array stringifies to exactly its element. `===` does not coerce and rejects the array outright — the danger is every consumer downstream that *does* stringify: `new URL(value)`, `String(value)`, `` `${value}` ``, concatenation, and the string methods. `new URL(["https://github.com/acme/widget"])` parses cleanly and yields that exact href.

At a trust boundary that is a spoofing vector: the decoy satisfies the match while remaining a different shape than the checker believes it is handling. It was found in the source-attribution check on the `data → main` promotion path.

## Guidance

### Validate the type, then compare

Check `typeof value === 'string'` before any comparison a coercion could satisfy. Do not rely on the comparison to reject the wrong shape. `==` coerces; `===` against an already-coerced intermediate is no better; and template interpolation, `String(value)`, concatenation (`'' + value`), and string methods called on an unproven value — `.includes()`, `.startsWith()` — all coerce silently. Array `.includes()` does not coerce, so the hazard is specifically the string-method path.

Test every exact-match check at a trust boundary against a one-element-array decoy. If the guard's contract is "this field is a string," a test should prove a non-string is rejected rather than accidentally accepted.

### A type check is one layer, not the defence

The type check stops the coercion. It does not establish that the value means what the gate assumes. The implemented defence in `check-wiki-private-presence.ts` is three layers, and the type check is the cheapest one:

1. **Structured field is authoritative.** Parsed frontmatter `sources` decide attribution when present.
2. **Exact comparison after parsing.** Each candidate is compared through `new URL(...)`, not by string equality against a raw field.
3. **Substring fallback only when structured sources are absent**, and deliberately — a grandfathered path, not a general equivalence.

A reader who takes only the `typeof` conjunct has closed the coercion vector and left the weaker comparison in place. State which layer you are adding.

### Deleting a defensive conjunct relocates a check, it does not remove one

Dropping `value !== undefined &&` from a guard is behavior-neutral *given* that every caller supplies a value. That "given" is the whole cost: the runtime check becomes an invariant no signature enforces and no test pins. When a later caller violates it, the failure surfaces somewhere else entirely, usually as a confusing error in unrelated code.

Two acceptable dispositions, and one that isn't:

- Keep the guard.
- Delete it and make the invariant explicit in the type, so the compiler enforces what the guard used to.
- Delete it and rely on caller discipline — this is the one that fails later.

Mutation survivors on such a guard get a test, not a suppression directive, unless the survivor is provably semantically neutral.

## Why This Matters

Both halves fail open. A coercion decoy passes a gate that believes it rejected the input; a deleted conjunct passes until a caller changes. Neither shows up as a failing test, a coverage gap, or a type error — the code reads correct at every point a reviewer would look.

For a gate on an autonomous promotion path, "reads correct" is not the standard. The check runs unattended on content the operator did not write.

## When to Apply

- Any equality or membership check on a value parsed from YAML or JSON at a trust boundary
- Attribution, provenance, allowlist, and identity comparisons specifically
- Any change that removes a `typeof`, `!== undefined`, or `!== null` conjunct from a guard

## Examples

The decoy:

```yaml
# Both parse. Both satisfy a coercing comparison against the expected URL.
sources:
  - url: https://github.com/acme/widget
  - url: ["https://github.com/acme/widget"]
```

The discipline:

```ts
// Before: sourceUrlMatchesRepo calls `new URL(sourceUrl)`, which stringifies its
// argument, so the one-element array parses and matches.
if (sourceUrlMatchesRepo(src.url, owner, name)) { /* trusted */ }

// After: shape is established at extraction, before any coercing consumer sees it.
const url = (src as Record<string, unknown> | null | undefined)?.url
if (typeof url === 'string') urls.push(url)
```

The fix belongs at extraction, not at the comparison. `parseFrontmatterSources` filters on `typeof url === 'string'` so a non-string never reaches `new URL` at all.

## Related

- [`repair-before-a-trust-gate-not-inside-it`](repair-before-a-trust-gate-not-inside-it-2026-07-06.md) — where input normalisation belongs relative to the gate
- [`enumerate-mutator-variants-before-a-stryker-directive`](enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md) — why a surviving mutant gets a test rather than a directive
- Merge commit `91388ec`
