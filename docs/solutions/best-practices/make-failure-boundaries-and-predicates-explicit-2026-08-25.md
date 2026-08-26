---
title: Make failure boundaries and shared predicates explicit
date: 2026-08-25
category: best-practices
module: github-workflows
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - "related workflow entry points intentionally use different failure semantics"
  - "a script can fail before or after a public side effect such as an issue mutation"
  - "the same small type guard or predicate appears in more than one module of a feature"
related_components:
  - tooling
  - testing_framework
tags:
  - fail-closed
  - fail-soft
  - shared-module
  - drift-detection
  - pure-core
---

# Make failure boundaries and shared predicates explicit

## Context

Issue #3695 produced a maintainability lesson from capture-patterns' detect and open entry
points. The source PR, merge commit `2d16c94ac0bc8064e1fc5b92b8afa75bfc2d2f13`, passed review over
two rounds with no blocking issues, but two concerns were worth preserving:

> Make fail-hard vs. fail-soft entry-point behavior intentional and consolidate duplicate
> predicates within a feature.

The first concern was an entry-point asymmetry. The detect step was deliberately best-effort and
returned an empty digest on failure. The open step could throw while reading the digest or
constructing the API client; under `bash -Eeuo pipefail`, that failure propagated and failed the
step. That behavior was safe because it failed closed before partial writes, but the intent was
implicit. An undocumented asymmetry reads like a bug.

The current code makes the boundary explicit. `scripts/capture-patterns-cluster.ts` documents and
implements a fail-soft `main()`, while `scripts/capture-patterns-open.ts` comments that its
`main()` is intentionally fail-hard before loading the digest and creating the client.

The second concern was predicate drift: `isRecord` was defined privately in one module while
another module imported it from a shared privacy module. Two implementations of the same
predicate inside one feature can diverge over time. On main today, the capture-patterns feature
uses the shared definition in `scripts/capture-learnings-privacy.ts`; the duplication described in
issue #3695 has been resolved for that feature. Other, unrelated scripts still have local guards,
so this is not a claim that every `isRecord` in `scripts/` is globally deduplicated.

## Guidance

1. **Name the failure contract at each entry point.** Say whether the script is fail-hard or
   fail-soft, and why. A fail-soft step should define its safe fallback; a fail-hard step should
   identify the ambiguity or side effect that makes continuing unsafe.
2. **Put the boundary before the first irreversible effect.** If missing, malformed, or
   untrusted input could make a write unsafe, fail hard before the API mutation. If the step only
   produces an optional intermediate artifact, a documented empty result may be the correct
   fail-soft behavior.
3. **Make sibling asymmetries visible in code.** A comment at `main()` is enough when it names the
   sibling behavior and the invariant preserved by the difference. Do not make reviewers infer
   policy from the absence of a `try/catch`.
4. **Choose one canonical implementation for a feature-local predicate.** Import a shared
   `isRecord` or equivalent guard rather than copying its three-line body. If the predicate truly
   belongs to separate bounded contexts, keep the copies separate and document that boundary.
5. **Check the whole feature when consolidating.** Search definitions and imports, then verify
   that every call site uses the canonical module. A partial consolidation creates the illusion of
   one source of truth while leaving a drift path behind.
6. **Test both contracts.** Exercise the fail-soft fallback and the fail-hard propagation path,
   and test the shared predicate through the real consumers rather than asserting only that an
   export exists.

## Why This Matters

Failure behavior is part of a script's API. In a workflow, `exit 0` can mean "nothing was found"
or "the scan failed and emitted a safe empty artifact." A thrown error can mean "the input was
ambiguous before any write" or "the process crashed after a partial mutation." Naming the
distinction prevents an operator from treating a safety boundary as accidental instability.

Small duplicated predicates create a quieter failure mode. Each copy looks harmless, but future
changes to one copy alter the accepted input shape for only part of the feature. The resulting
drift is especially difficult to diagnose when one path handles parsed API data and another path
handles authored or persisted data. One canonical implementation keeps the type boundary stable.

## When to Apply

- A workflow has detect, plan, publish, or open steps that intentionally tolerate different classes
  of failure.
- A script reads an artifact or credential before an API call and must not continue with ambiguous
  state.
- A sibling entry point uses a different `try/catch` policy or exit behavior.
- A feature contains repeated type guards, status predicates, privacy checks, or normalization
  helpers with the same contract.
- A review comment says two implementations are "equivalent" or asks whether an asymmetry is
  intentional.

## Examples

### Explicit fail-soft detect entry point

Current `scripts/capture-patterns-cluster.ts` documents the detect contract next to `main()`:

```ts
/**
 * CLI entry point for the detect/digest step: collects the allowed source corpus
 * (solution docs + learning-proposal issues), plans deterministic cluster candidates,
 * and writes a versioned candidate digest to CAPTURE_PATTERNS_DIGEST_PATH.
 *
 * Best-effort: any error falls back to an empty digest and exit 0 — this step must
 * never fail the workflow. Errors are logged as counts-only, never with message text
 * that could leak content.
 */
async function main(): Promise<void> {
```

The implementation then catches unexpected errors, records `scanFailure`, writes an empty digest
when possible, and emits counts-only output:

```ts
} catch (error: unknown) {
  const errorName = error instanceof Error ? error.name : 'unknown'
  process.stderr.write(`capture-patterns-cluster: unexpected error (${errorName}), falling back to empty digest\n`)
  result.scanFailure = true
  digestCandidates = []
  try {
    await writePatternDigestFile(digestCandidates)
  } catch {
    // ignore
  }
}
```

### Explicit fail-hard open entry point

Current `scripts/capture-patterns-open.ts` states the contrasting contract before its imports and
before it reads the digest or constructs the client:

```ts
async function main(): Promise<void> {
  // Detect is fail-soft because absence of candidates is safe signal. Open is
  // intentionally fail-hard on malformed inputs or missing credentials: after the
  // live gate, ambiguity must stop before any issue mutation.
  const {loadPrivateTokensFromDisk} = await import('./capture-learnings-privacy.ts')
```

The digest read and client construction remain outside a top-level catch:

```ts
const digestCandidates = await readJsonFile<PatternCandidateDigest[]>(digestPath, 'candidate digest')
// ...
const octokit = await createOctokitFromEnv()
```

That is intentional fail-closed behavior: malformed input or an unavailable client stops the open
step before `openPatternProposalIssues` can mutate issues. The difference from detect is policy,
not an accidental missing wrapper.

### One canonical `isRecord` for capture-patterns

The current shared definition is in `scripts/capture-learnings-privacy.ts`:

```ts
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

Both capture-patterns consumers import it:

```ts
// scripts/capture-patterns-open.ts
import {isRecord} from './capture-learnings-privacy.ts'

// scripts/capture-patterns-synthesis.ts
import {isRecord} from './capture-learnings-privacy.ts'
```

The issue's feature-local duplication no longer exists on main. A current search across `scripts/`
still finds separate local definitions in `commit-metadata.ts`, `data-branch-bootstrap.ts`,
`handle-invitation.ts`, `improvement-metrics-detect.ts`, `merge-data-pr.ts`, `reconcile-repos.ts`,
`schemas.ts`, `solutions-query.ts`, `wiki-ingest.ts`, `wiki-lint-issues.ts`, `wiki-lint.ts`, and
`wiki-utils.ts`, plus the shared definitions in `capture-learnings-privacy.ts` and
`private-repo-resolution.ts`. The current imports are:

- `capture-patterns-open.ts` and `capture-patterns-synthesis.ts` from
  `capture-learnings-privacy.ts`;
- `improvement-metrics-report.ts` and `status-truth-proposals.ts` from
  `capture-learnings-privacy.ts`; and
- `check-private-leak.ts` from `private-repo-resolution.ts`.

Those remaining local definitions belong to separate script boundaries. Consolidate them only when
they are genuinely the same feature contract; do not create a grab-bag utility merely to eliminate
every same-named helper in the repository.

## Related

- [Pure-core privacy gates with a shared module and mutation-proof tests](pure-core-privacy-gates-shared-module-2026-06-22.md) — the shared-module and fail-closed pattern used by the capture pipeline.
- [Byte-exact gateway signing and fail-soft telemetry](byte-exact-gateway-signing-and-fail-soft-telemetry-2026-06-04.md) — a separate fail-soft boundary whose safe output contract is explicit.
- [Test the integration seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — verify the behavior at the boundary where the policy matters.
