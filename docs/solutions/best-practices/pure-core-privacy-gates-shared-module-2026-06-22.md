---
title: Pure-Core Privacy Gates with a Shared Module and Mutation-Proof Tests
date: 2026-06-22
last_updated: 2026-06-22
problem_type: best_practice
category: best-practices
component: development_workflow
module: github-workflows
severity: high
verified: 2026-06-22
tags:
  - privacy-gate
  - fail-closed
  - pure-core
  - shared-module
  - mutation-test
  - defense-in-depth
applies_when:
  - a pipeline enriches shared state (e.g. a digest or prompt) with content that may contain sensitive identifiers
  - two independent chokepoints must enforce the same privacy invariant without diverging
  - the gate must distinguish "no private repos configured" from "token load failed"
  - coverage exists but does not prove the gate is load-bearing
---

# Pure-Core Privacy Gates with a Shared Module and Mutation-Proof Tests

## Context

A capture pipeline enriches an agent prompt with review prose: raw review comments are
collected, then assembled into a digest that feeds downstream processing. Private repository
names must never enter the digest or the authored body that follows.

The naive placement puts the gate at the output boundary — scan the final body before it is
committed. That is too late: by the time the body is authored, the private prose has already
entered shared state and influenced the agent's output. The gate needs to sit **upstream in the
pure core**, before enriched content enters the digest, with a second independent scan on the
authored body as a backstop.

Two separate gate call sites create a divergence risk: if each builds its own token set from
scratch, a future change to one path can silently leave the other stale. The fix is to extract
the scan into a single shared module (e.g. `capture-learnings-privacy.ts`) that both call sites
import. One module, two chokepoints — they cannot diverge.

A subtler correctness trap: the gate received a `Set<string>` of private tokens. An empty set
(no private repos configured) is not the same as a failed load (the token set could not be
built). If the gate treats both as "nothing to scan," a load failure silently disables it. The
distinction must be handled in the I/O shell so the pure core always receives a valid, populated
`Set` or a hard error — never an empty set that masks a failure.

Merged at `19b566ef82bfbc7d5e32f1060df7bd37cd719676`.

## Guidance

### 1. Gate in the pure core before sensitive data enters shared state

Place the privacy scan at the earliest point where sensitive content could enter a shared
structure — not at the final output boundary. If a digest or prompt is assembled from enriched
content, scan before assembly. A downstream gate on the authored body is a backstop, not the
primary control.

```ts
// pure core: scan before prose enters the digest
const scanResult = scanForPrivateTokens(reviewProse, privateTokenSet)
if (!scanResult.clean) throw new PrivacyGateError(scanResult)
digest.push(reviewProse)
```

### 2. Extract one shared module so chokepoints can't diverge

Two independent call sites that each build their own token set will eventually drift. Extract
the scan logic and token-set construction into a single module. Both chokepoints import it.
A change to the scan logic propagates to both automatically.

```ts
// capture-learnings-privacy.ts — one module, imported by both gate call sites
export function buildPrivateTokenSet(repos: PrivateRepo[]): Set<string> { ... }
export function scanForPrivateTokens(text: string, tokens: Set<string>): ScanResult { ... }
```

### 3. Handle empty-vs-absent in the I/O shell, not the pure core

The pure core should never decide what an empty token set means. That decision belongs in the
shell that loads the token set:

- **Empty set (no private repos configured):** pass an empty `Set` — the scan is a no-op, which
  is correct.
- **Load failed (probe error, missing credential, malformed data):** throw before calling the
  pure core. Never pass an empty `Set` as a proxy for a failed load.

```ts
// I/O shell
const privateRepos = await loadPrivateRepos()  // throws on failure
const tokenSet = buildPrivateTokenSet(privateRepos)  // empty Set is valid if no repos
```

### 4. Add a mutation-proof test that fails when the gate is removed

A test that only checks the happy path ("gate present, clean input → passes") does not prove
the gate is load-bearing. Add a test that asserts private prose reaches the output **when the
gate is bypassed** — and that the gate prevents it. This test fails if the gate is deleted or
short-circuited, proving it is structural rather than decorative.

```ts
it('blocks private prose from entering the digest', () => {
  const prose = 'see acme/private-repo for context'
  const tokens = buildPrivateTokenSet([{nameWithOwner: 'acme/private-repo', ...}])
  expect(() => scanForPrivateTokens(prose, tokens)).toThrow(PrivacyGateError)
})

it('mutation proof: digest assembly drops private prose', () => {
  // Exercise the REAL assembly path. This goes green only while the gate is wired
  // into assembleDigest; delete or short-circuit the gate and this turns red.
  const tokens = buildPrivateTokenSet([{nameWithOwner: 'acme/private-repo'}])
  const digest = assembleDigest(['see acme/private-repo for context'], tokens)
  expect(digest.join('\n')).not.toContain('acme/private-repo')
})
```

## Related

- [Privacy-gate promotion leak prevention](../best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md) — the trusted-chokepoint and fail-closed-resolution patterns this gate extends into the pure core.
- [Wiki page structured attribution](../best-practices/wiki-page-structured-attribution-2026-06-04.md) — the present-but-empty vs absent distinction recurs here; encode it as a habit.
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — verify privacy inside the trusted workflow before any public side effect.
- [Private repo dispatch visibility gate](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md) — the fail-closed predicate and opaque-identifier redaction this gate builds on.
