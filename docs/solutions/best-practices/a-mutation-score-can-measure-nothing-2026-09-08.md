---
title: A mutation score can measure nothing — check reachability before writing tests
date: 2026-09-08
last_updated: 2026-09-08
verified: 2026-09-08
category: best-practices
module: scripts/check-mutation-guards.ts
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - a module reports 0 killed mutants and the instinct is to write more tests
  - a module's decision table, regex array, or allowlist is a top-level `const`
  - removing an entry from Stryker's `testFiles` while other modules remain in `mutate`
  - a module's only tests import it through a package's `dist` output or published specifier
tags:
  - mutation-testing
  - stryker
  - instrumentation
  - static-mutants
  - test-topology
  - false-confidence
---

# A mutation score can measure nothing — check reachability before writing tests

## Context

A mutation score is a claim about which mutants your tests killed. It is silent about mutants the harness never gave any test a chance to kill. Two mechanisms produce that silence, and both look like ordinary coverage from the outside — the module is listed in `mutate`, tests exist and pass, and the report prints a number.


## Guidance

### A top-level `const` is evaluated once per worker, so its mutants are static

Stryker imports a module once per worker process, so a module-level `const` initializer runs once and never again. Data computed there is shared across every test in that worker, and a mutant inside it is fixed for the worker's lifetime — no test can observe a difference, so none can kill it.

`scripts/check-wiki-authority.ts` held its identity set and guarded-path regex array as top-level `const`s: the whole decision table was frozen before any test ran, and the baseline was 0 killed. Converting both to functions took it to 146 killed **with no new tests written**. The assertions had always been adequate; the mutants had never been reachable.

Read a 0-killed baseline as an instrumentation problem first. Writing tests against a frozen constant produces more passing tests and the same zero.

Before converting, confirm the move is semantics-preserving. It was here, but each of these is a real way it could fail:

- **Allocation state** — a fresh `Set` or array per call is neutral only if no caller mutates it after construction.
- **Regex `lastIndex`** — these patterns carry no `g` or `y` flag, so there is no cross-call state. Add either flag and per-call reallocation becomes observable.
- **Encoding defaults** — for text, `readFile(path)` then `.toString()` equals `readFile(path, 'utf8')`: `Buffer.prototype.toString()` defaults to utf8 and neither form strips a BOM. Not a general identity — for binary or non-utf8 data, or where the buffer feeds a non-string consumer, the two differ.
- **String joins** — if the constant feeds a formatted message, the join is part of an output contract.

### `mutate` and `testFiles` are independent levers

A test that imports a module through its compiled `dist` output or its published package specifier exercises the built artifact. Stryker instruments the source tree, so that test contributes zero kills to the source module no matter how thoroughly it exercises the behavior.

The consequence is that a module can sit in `mutate` with tests that read like coverage and produce no signal at all. It also makes `testFiles` edits quietly dangerous: removing one entry can orphan a module elsewhere in `mutate` whose only source-path exerciser lived in that file.

Before removing anything from `testFiles`, enumerate every module still in `mutate` and confirm each retains at least one test reaching it through a **source-tree** import. Record which test file is each module's live exerciser, so a later demotion cannot orphan one silently.

Scope `mutate` by materiality — does a mutant here threaten the guarantee the module exists to provide — rather than by module shape.

## Why This Matters

Both mechanisms fail in the reassuring direction. A clean or improving score is read as evidence the guard is tested, when it can equally mean the guard was never instrumented. For modules that exist to enforce a privacy or authority boundary, that is the worst possible failure mode for a metric: it is loudest exactly when it is least informative.

The second mechanism is worse than the first, because a static mutant reports 0 and draws attention, while a `dist`-imported test can leave a module reporting a plausible partial score assembled entirely from other tests.

## When to Apply

- A mutation baseline is 0, or implausibly low for a module with real tests
- Any module-level `const` holding data the guard's decisions depend on
- Editing `mutate` or `testFiles` in `stryker.config.json`
- A package with a committed `dist/` whose tests could import either side

## Examples

The conversion that unfroze the decision table:

<!-- verify: guardedPatterns from scripts/check-wiki-authority.ts -->
```ts
// Before: evaluated once per Stryker worker; every mutant inside is static.
const GUARDED_PATTERNS = [/^knowledge\/wiki\/[^/]+\/.+\.md$/, /* … */]

// After: evaluated per call, so each mutant is observable by a test.
function guardedPatterns(): readonly RegExp[] {
  return [/^knowledge\/wiki\/[^/]+\/.+\.md$/, /* … */]
}
```

The import that looks like coverage and isn't:

```ts
// Contributes zero mutant kills to the source module — exercises the built artifact.
import {checkPrivateLeak} from '@fro-bot/wiki-write-core'

// Instrumented, and therefore counted.
import {checkPrivateLeak} from './private-leak.ts'
```

## Related

- [`enumerate-mutator-variants-before-a-stryker-directive`](enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md) — the adjacent trap: a mutant that *is* reachable, silenced by an over-broad directive
- [`mutation-coverage-is-silent-about-unwritten-branches`](../security-issues/mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md) — the third silence: a branch the code never wrote cannot be mutated at all
- [`size-subprocess-buffers-selectively-at-call-sites`](size-subprocess-buffers-selectively-at-call-sites-2026-08-31.md) — states the static-`const` mechanism in a code comment; the rule lives here
- Merge commits `3bd59db` and `498f33d`
