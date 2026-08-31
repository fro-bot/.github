---
title: Size subprocess buffers selectively at the call sites that can grow
date: 2026-08-31
last_updated: 2026-08-31
category: best-practices
module: scripts/check-private-leak.ts
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - "execFileSync or spawnSync returns a diff, metadata file, or other output that grows with repository state"
  - "a fail-closed gate treats an infrastructure error as a blocking security result"
  - "a workflow status needs to distinguish detection from an incomplete scan"
  - "some sibling subprocess calls return fixed-shape responses and should retain the default limit"
tags:
  - fail-closed
  - diagnostics
  - observability
  - github-actions
  - privacy-gate
  - promotion
  - test-seam
  - anti-recurrence
---

# Size subprocess buffers selectively at the call sites that can grow

## Context

The private-leak scan in #3805 shells out to `gh` and `git` while examining promotion
diffs and repository metadata. Node's default `execFileSync` output ceiling is 1 MiB.
As the data branch accumulated content, a legitimate compare response crossed that
ceiling and raised `ENOBUFS` before the scan could inspect it.

The gate correctly failed closed, but the old workflow collapsed that infrastructure
failure into the same public status description as a detected private name. The result
looked like a security incident instead of an incomplete scan, while the growing data
set made recurrence more likely.

## Guidance

1. **Classify output by growth behavior.** Diff responses, repository metadata, and
   other collection-shaped results need an explicit `maxBuffer`. Fixed-shape responses
   should not receive a giant limit merely because a neighboring call does.
2. **Apply the constant at every unbounded call site.** A shared constant is useful only
   when the calls that can overflow actually pass it. Search the `execFileSync` sites and
   classify each one rather than assuming a helper-wide setting exists.
3. **Keep the ceiling finite.** Raising the limit prevents the default outage but does
   not make output unbounded. If the explicit ceiling is exceeded, preserve the
   fail-closed result and surface the error as a scan error.
4. **Separate detection from inability to scan.** Emit a machine-readable result such as
   `success`, `detection`, or `error`, and let the workflow render different operator
   descriptions for those states.
5. **Document deliberate asymmetry.** If one entry point has a status surface and a
   sibling path does not, say so beside the code. Do not apply output or status plumbing
   mechanically to a path whose contract is different.

## Why This Matters

The default buffer creates a self-worsening failure loop: more legitimate data increases
the chance of `ENOBUFS`; `ENOBUFS` blocks the gate; and the gate's generic failure text
invites operators to investigate a leak rather than an output-capacity problem. In an
unattended promotion pipeline, that distinction affects both recovery speed and trust in
the security signal.

Fail-closed behavior remains the right safety posture. A scan that cannot consume its
complete input must not pass. The fix is to give expected growth a finite, explicit
budget and to make the blocked state legible. The nuance matters: widening every call to
32 MiB would hide bounded-call mistakes and increase unnecessary resource exposure, while
leaving the large responses at 1 MiB guarantees the outage will return.

## When to Apply

- A subprocess returns a unified diff, compare payload, repository file, or list whose
  size grows with commits, files, or metadata entries.
- A CI or privacy gate fails closed on subprocess errors.
- A workflow posts a status after a scan that can either find a violation or fail to
  complete.
- A new diagnostic or status output is being added to one of several similar entry points.
- Tests mock `execFileSync` and can assert the options passed to the real call boundary.

## Examples

### Explicit finite capacity for growing responses

The current script defines one finite budget and uses it only for calls whose output can
scale:

```ts
export const LARGE_OUTPUT_MAX_BUFFER_BYTES = 32 * 1024 * 1024

const compareJsonRaw = execFileSync(
  'gh',
  ['api', `repos/{owner}/{repo}/compare/${EXPECTED_BASE_BRANCH}...${headSha}`],
  {encoding: 'utf8', env, maxBuffer: LARGE_OUTPUT_MAX_BUFFER_BYTES},
)
```

The same option is present on the raw diff fetch, the PR-list fetch, both metadata
retrieval calls, and the promotion `git diff` runner. Fixed-shape calls such as the
status/comment API helpers keep Node's default because their output is bounded and their
large-output failure mode is not the one being repaired.

### Distinct status for detection and scan failure

The scan writes a small result to `GITHUB_OUTPUT`:

```ts
type ScanResultOutput = 'success' | 'detection' | 'error'

function writeScanResult(result: ScanResultOutput): void {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    appendFileSync(outputPath, `scan_result=${result}\n`)
  }
}
```

`.github/workflows/check-private-leak.yaml` maps `detection` to
"Private repository name found in PR diff." and every other failed scan to
"Private leak scan could not complete (scan error); see run logs." The gate still posts a
failure status for both cases; only the explanation becomes truthful.

### Verification at the shell seam

`scripts/check-private-leak.test.ts` mocks the real subprocess boundary and asserts that
both compare calls receive a numeric buffer greater than 1 MiB. A second test makes the
compare call throw an `ENOBUFS` error, verifies exit code 1, and checks that stderr
contains the diagnostic. The promotion path's intentional omission of `scan_result` is
also documented in `runPromotionCli`: that path has no commit-status surface to consume
the field.

## Related

- [Make failure boundaries and shared predicates explicit](make-failure-boundaries-and-predicates-explicit-2026-08-25.md) — name fail-hard versus fail-soft boundaries and keep shared predicates canonical.
- [Diagnostic patches must fail loudly and preserve stderr](diagnostic-patches-observability-discipline-2026-05-20.md) — preserve the error evidence needed to distinguish an infrastructure failure from a policy finding.
- [Privacy Gate Design for Data→Main Promotion Leak Prevention](privacy-gate-promotion-leak-prevention-2026-06-04.md) — the fail-closed privacy contract this capacity fix preserves.
- [Silent Failures in Autonomous Multi-Step Pipelines (Wiki Commit Drift + Misclassified Status)](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md) — aggregate workflow status must reflect whether every required step actually completed.
