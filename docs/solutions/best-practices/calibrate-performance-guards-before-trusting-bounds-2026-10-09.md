---
title: Calibrate performance guards before trusting their bounds
date: 2026-10-09
category: best-practices
module: packages/wiki-write-core
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - a scaling or performance guard fails intermittently under CI contention
  - a timeout increase is proposed for a timing-sensitive test
  - a performance guard is being deleted as noisy or nondiscriminating
  - two timing assertions look redundant and one is about to be removed
tags:
  - performance-tests
  - scaling-guards
  - timeout-calibration
  - cpu-time
  - wall-clock
  - counterexample
  - false-confidence
---

# Calibrate performance guards before trusting their bounds

## Context

`packages/wiki-write-core/src/regex-redos-regressions.test.ts` holds scaling guards for parsers that
once used backtracking-prone regexes. Two PRs taught complementary lessons about it.

PR #3810 removed two guards, for diff-header parsing and slug trimming. They could fail a healthy
build but could not fail against the pre-fix implementation they claimed to catch. PR #3818 kept a
different, expensive guard and raised its timeout, because the failure was a timeout under CI
contention rather than an assertion failure.

The shared lesson: a performance guard is evidence only after you know what it measures, what can
make it fail, and whether the reconstructed pre-fix defect trips it.

## Guidance

### Reconstruct the pre-fix defect before trusting a scaling guard

A guard that claims to catch superlinear scaling must fail against the old implementation. Restore
the pre-fix code, run the guard, and record the ratio against the bound.

PR #3810 did this for each guard:

| Guard | Pre-fix result | Bound | Outcome |
| --- | --- | --- | --- |
| Wikilink parsing | ~4.0x | `< 3` | Fails on the defect; kept |
| Malformed log-header parsing | ~4.0x | `< 3` | Fails on the defect; kept |
| Slug trimming | ~1.2x | `< 3` | Cannot fail; removed |
| Diff-header parsing | linear and linear | `< 3` | Cannot distinguish old from new; removed |

For slug trimming, the review measured the pre-fix regex at 1.20 and the replacement loop at 1.66,
both far from the bound. The metric was not observing the backtracking it was named for. The
diff-header operation was linear in the old code too (`checkPrivateLeak` finds the separator with
`lastIndexOf`; the old regex was start-anchored with one greedy backtrack), and the inputs were fast
enough that fixed overhead dominated the ratio.

Delete the timing guard, not the behavior coverage. PR #3810 kept the diff-path extraction table and
the slug sanitization cases, which pin parser behavior. Each parser's call site now carries a comment
against reintroducing a regex.

### Keep the timeout and the assertion separate

A timeout and an assertion answer different questions. In this suite, `measure()` samples
`process.cpuUsage()`, so the scaling assertions compare CPU-time ratios. Vitest enforces its timeout
against wall-clock time. Under CPU contention the CPU-time ratios can stay valid while wall time
inflates enough to trip the runner.

PR #3818 raised only the timing suite's ceiling. Its review made the point directly: the assertions
are on CPU-time ratios that stay stable under contention, while the wall clock Vitest enforces the
timeout against inflates roughly threefold. The ratio assertions were not what flaked.

Before raising a timeout, answer three questions:

1. What does the assertion measure?
2. What does the timeout measure?
3. Can a real regression escape through the timeout path instead of failing an assertion?

If the assertion still trips on the reconstructed defect, the larger timeout is headroom. If it does
not, the timeout is masking the guard.

Record cost ordering and relative headroom in the comment, not absolute milliseconds. The current
comment in the test file says neither measured figure is portable across machines, but the ordering
held: the malformed log-header guard is the costliest production guard and the first to check if a
timing test times out.

### Name what each paired assertion catches before deleting one

Two timing assertions can look redundant while covering different blind spots. The meta-test that
proves the estimator discriminates (quadratic work produces a high ratio, linear work a low one) needs
independent checks on both controls. PR #3818 kept both a separation check and an absolute bound on
the linear control, each tied to a distinct failure mode.

The exact assertion shape has since changed. Current main bounds each control against its own
theoretical value with named constants, and the file's comments give the rationale. The durable rule
is the review pattern:

| Question | If the answer is no |
| --- | --- |
| Does this assertion fail against the reconstructed defect? | Delete or replace it. |
| Does another assertion fail for the same reason? | It may be redundant. |
| Does it catch metric inflation, calibration drift, or estimator breakage that the other cannot? | Keep it, or replace it with a clearer independent bound. |

## Why This Matters

Performance guards look empirical and fail loudly, which makes them unusually convincing. An
uncalibrated guard is worse than none: it can fail healthy builds while missing the defect it was
written to catch.

The inverse also holds. A calibrated guard may be expensive when the expense buys signal. When the
CPU-time assertions still discriminate the defect and the wall-clock timeout is the only unstable
surface, the correct fix is timeout headroom rather than weaker assertions.

## When to Apply

- A performance or scaling test flakes under CI load.
- A guard fails on a ratio and nobody has measured the pre-fix implementation against that ratio.
- A timeout increase is proposed for a timing-sensitive test.
- A guard is being removed because it is noisy.
- A reviewer wants to delete one of two assertions because they look redundant.

## Examples

### A guard that could fail CI but not catch its own defect

This test was deleted in PR #3810:

```ts
it('scales slug trimming linearly for a long hyphen run', () => {
  const smallOwner = `${'-'.repeat(120_000)}owner`
  const largeOwner = `${'-'.repeat(240_000)}owner`
  const measurement = expectLinearScaling(
    size => {
      computeRepoSlug(size === 120_000 ? smallOwner : largeOwner, 'repo')
    },
    120_000,
    3,
  )

  // The old trim regex is also linear for this input, so this guard records the desired property
  // but cannot distinguish it from the former loop implementation.
  expect(measurement.ratio).toBeLessThan(3)
})
```

Its own comment names the problem. The behavior stays covered by the slug sanitization cases, and
`packages/wiki-write-core/src/wiki-slug.ts` records the structural rule at the call site:

```ts
// Boundary loops, not `/^-+|-+$/g`: the anchored alternation backtracked on long hyphen runs.
// Keep the trim loop-based -- no timing guard covers this path (#3810).
```

### CPU-time measurement under a wall-clock timeout

The measurement helper reads CPU time:

```ts
function measure(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) {
    operation()
  }
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1_000
}
```

The suite scopes one timeout over every timing test, while the assertions stay on ratios:

```ts
const TIMING_SUITE_TIMEOUT_MILLISECONDS = 30_000

describe('linear-time input parsing', {timeout: TIMING_SUITE_TIMEOUT_MILLISECONDS}, () => {
  it('proves the scaling helper discriminates quadratic work', () => {
    // ...
    const quadraticMeasurement = measureScalingRatio(quadratic, 4_000, 3)
    const linearMeasurement = measureScalingRatio(linear, 20_000, 3)
    expect(quadraticMeasurement.ratio).toBeGreaterThanOrEqual(QUADRATIC_RATIO_FLOOR)
    expect(linearMeasurement.ratio).toBeLessThan(LINEAR_RATIO_CEILING)
  })
})
```

The timeout is not the contract. The assertions are, and the timeout gives deterministic work enough
wall-clock room under contention.

## Related

- [A mutation score can measure nothing](a-mutation-score-can-measure-nothing-2026-09-08.md) — the same false-confidence shape: a metric can report success while observing nothing load-bearing. Different mechanism (Stryker instrumentation reachability), so not merged.
- [A policy scanner must parse tokens, not prose — and the tool may normalise away what you are checking for](a-policy-scanner-must-parse-tokens-not-prose-2026-09-08.md) — prove each rule can fail on the input it claims to reject.
- [A docstring that enumerates accepted forms is a test table, not prose](a-docstring-that-enumerates-forms-is-a-test-table-2026-09-08.md) — counterexamples caught in review should become executable artifacts.
- [A code path exercised only by pre-built fixtures is an untested seam — test the seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — test the boundary the bug actually crosses.
- Source PRs: #3810 (merge `374ddfe`), #3818 (merge `d9aff3c`).
