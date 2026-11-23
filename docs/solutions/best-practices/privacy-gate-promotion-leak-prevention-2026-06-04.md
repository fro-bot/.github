---
title: Privacy Gate Design for Data→Main Promotion Leak Prevention
date: 2026-06-04
last_updated: 2026-11-23
verified: 2026-06-04
category: best-practices
module: github-workflows
problem_type: best_practice
component: development_workflow
severity: high
related_components:
  - tooling
  - background_job
applies_when:
  - promoting autonomous data-branch content into a public protected branch
  - a private identifier can appear in a body or another entity's page, not just its own slug
  - a resolver returns an ambiguous result that conflates "deleted" with "no access"
  - a broad-scope credential is needed to resolve private identities
  - a gate must decide between fail-open and fail-closed under uncertainty
  - a registry keeps historical identity or visibility on purpose (archived rows, old names)
tags:
  - privacy-gate
  - fail-closed
  - promotion
  - least-privilege
  - redaction
  - data-branch
  - trusted-chokepoint
  - access-lost
---

# Privacy Gate Design for Data→Main Promotion Leak Prevention

This doc covers the promotion chokepoint specifically — the `data → main` gate below. It is
no longer the earliest gate a wiki write passes through: `packages/wiki-ops/src/wiki-repair.ts` now runs
`detectPrivateWikiLeaks` as a pre-commit gate (`gateWikiRepairs`) against current-tip authority
metadata before repaired pages ever reach the `data` branch. See "Related" for that gate's doc.

## Context

This control plane promotes an autonomous agent's generated wiki and metadata from an
unprotected `data` branch to the public `main` branch on a schedule. Private repository names
must never reach `main`. An existing gate (`packages/privacy/src/check-wiki-private-presence.ts`) already
blocked a private repo's *own* wiki page by slug/filename — yet a private name still promoted
cleanly to the public branch.

The leak: a private repo name (`owner/name`) appeared in the **body** of a *different*,
public repo's wiki page. The slug gate only inspects filenames and attribution, so an in-body
mention of an unrelated private repo sailed straight through to `main`. Closing it surfaced two
further design traps — an ambiguous-resolution fail-open hole, and a mismatched enforcement
point — that are the real reusable lessons here.

## Guidance

Four rules for any gate that prevents a sensitive identifier from crossing a trust boundary.

### 1. Scan content, not just identifiers

A filename/slug gate answers "is this entity's own page private?" It does **not** answer "does
any promoted content mention a private identifier?" Resolve the actual private names and scan
the **promotion diff** (`origin/main...origin/data`) across added content lines *and* new/renamed
file paths.

Build the token set to include every form the name can take in content — not just the sanitized
one. Here the set is canonical `owner/name`, the wiki slug `owner--slug`, **and** the raw
`owner--name` form, so a name with underscores, dots, or uppercase is matched and redacted
consistently (the sanitized slug alone would miss `acme/private_repo` written as
`acme--private_repo`).

### 2. Fail closed on ambiguous resolution

GitHub GraphQL `node(id)` returns `null` for **both** a deleted repo and a repo the token cannot
see — indistinguishable. If the gate *skips* that ambiguous `access-lost` result, then a
mis-scoped or expired credential makes *every* private repo look `access-lost`, and the gate
silently passes everything: a single credential failure disables the entire control (mass
fail-open). Treat ambiguous resolution — and any missing/unresolvable identifier — as a **block**.

Document any intentional asymmetry between modes. Here both scans treat `access-lost` as a failure:
the promotion scan blocks with no override, and the per-PR scan reports an error that only the
operator override can pass.

### 3. Enforce at the trusted chokepoint, not per-PR

The instinct is to gate every PR. But a per-PR gate that needs a broad credential to resolve
private identities forces a `workflow_run` topology (to keep the credential away from PR-author
code), which drags in a whole risk class:

- **Status-check spoofing** — anyone who can push a branch with `statuses: write` can forge the
  gate's green check.
- **Fork-PR context derivation** — binding the run to the right PR/SHA across forks is fragile.
- **Override-token forgery** — a PR-title or label override is attacker-controllable.
- **Per-PR-PAT single point of failure** — the broad token's expiry blocks *every* PR.

Putting the gate in the already-trusted scheduled promotion job (no PR-author code, already holds
the broad token) **dissolves all four**. The credential expiry now blocks only the weekly
promotion, not every PR. This pivot also shrank the build from a four-unit `workflow_run` security
topology to a two-unit blocking-step wire-in.

Pair it with least privilege: confine the broad credential to the resolution step only, and strip
it from every other subprocess — including the `git` call that computes the diff (git reaches the
branch with the ambient checkout token; it never needs the broad PAT). Redact output to file paths
only, with any private token in a path replaced by `[REDACTED]`.

### 4. Treat stored identity as history, not as a current fact

A registry that keeps old data on purpose describes the past. Archived rows in `metadata/repos.yaml` keep their owner, name and `private: false` after a rename or transfer on GitHub, and when reconcile cannot see the repository. The review of the lifecycle plan in PR #4264 found two fail-open paths in a plan that read those rows as current, and confirmed both with a probe against `buildPublicSlugMap`, `detectPrivateWikiLeaks` and `checkPrivateLeak`:

- **Stored-only tokens.** Scanning an archived row by its stored name alone lets an addition through that names the repository's current, non-public identity. The leak scan then used the resolved live name. Scan both: an archived row that GitHub does not confirm `PUBLIC` contributes its stored and its live owner/name (`resolveScanRow` in `packages/privacy/src/check-private-leak.ts`). Only when there is no usable live name (a failed lookup, no node ID, a malformed answer) does it fall back to the stored name.
- **A stale public row grants attribution.** `buildPublicSlugMap` admitted every stored `private: false` row, and a page whose `sources` matched skipped the unchanged-page check. If the repository turned private or unreachable, an edit with body-only text and no identity token passed both gates. Now an archived row enters the public slug map only when GitHub reports its node `PUBLIC` at check time (`packages/privacy/src/check-wiki-private-presence.ts`). Without that, its page passes only when it is unchanged from `main`: published history stays, and new content gets no permission from the stored row.

The findings were caught against a docs-only diff, before the plan became the implementation contract.

## Why This Matters

A privacy gate's failure mode must be "block promotion," never "leak." The four rules each close
a different way the naive design leaks:

- **Content scanning** catches the actual leak class (in-body mention of an unrelated private repo)
  that a slug gate structurally cannot see.
- **Fail-closed resolution** ensures a broken/mis-scoped credential disables *promotion*, not the
  *gate* — the difference between a stalled pipeline (recoverable) and a silent public leak
  (not recoverable; the public branch is the canonical record).
- **Trusted-chokepoint enforcement** removes an entire spoofing/forgery/SPOF surface that a per-PR
  gate would have to defend, at a fraction of the implementation cost.
- **Stored identity as history** keeps a rename, a transfer or a visibility change from opening a
  gap that the registry's kept data cannot show.

## When to Apply

- Promoting autonomous or machine-generated content from a writable branch into a protected,
  publicly-readable branch.
- The sensitive identifier can appear as body text or inside another entity's page — not only as
  its own filename.
- The resolver has an ambiguous result that conflates "gone" with "not visible to me."
- A broad-scope credential is required, and you want it touching the smallest possible surface.
- You are tempted to gate per-PR — first check whether a trusted scheduled chokepoint already
  exists downstream.

## Examples

### Resolution matrix: before (fail-open) vs after (fail-closed)

The resolver cannot distinguish deleted from invisible:

```ts
// packages/privacy/src/private-repo-resolution.ts — node() returns null for BOTH cases
if (node === null || node === undefined) return {error: 'access-lost'}
```

Before — promotion mode skipped `access-lost`, so a mis-scoped PAT passed everything. After —
any non-success resolution (including `access-lost`) and any missing `node_id` block:

```ts
// packages/privacy/src/check-private-leak.ts — runPromotionScan
for (const nodeId of privateNodeIds) {
  const result = await resolver(nodeId)
  if ('nameWithOwner' in result) {
    // Only the exact string PUBLIC skips a row; any other visibility keeps its tokens.
    if (result.visibility === 'PUBLIC') publicSkipped += 1
    else resolvedNames.push(result.nameWithOwner)
  } else {
    // access-lost is indistinguishable from "no access" — block, never skip.
    failedNodeIds.push(nodeId)
  }
}
// A row whose node GitHub reports as public (for example an archived public repository, which
// reconcile stores as private) contributes no private name, in the per-PR scan and the promotion
// scan alike (one shared resolver); a skip never hides a failure.
// A private:true entry with no usable node_id is seeded as a <missing-node-id> sentinel.
if (failedNodeIds.length > 0) {
  return {ok: false, resolutionFailed: true, failedNodeIds}
}
```

An archived row is selected as well as every `private: true` row, because a stored `private: false` for it cannot be trusted. The same lookup applies: exactly `PUBLIC` contributes no name, and anything else (or a failed lookup, or no node ID) scans by the stored owner and name and by the live ones, without blocking the scan. The wiki-presence gate attributes a changed archived page only when the same lookup reports `PUBLIC`; otherwise only an unchanged page passes (rule 4).

### Least privilege: confine the broad credential, split the workflow

```yaml
# .github/workflows/merge-data.yaml — two steps so the PAT never enters the git subprocess
- name: 🔒 Fetch data ref for promotion diff
  run: git fetch --no-tags --prune origin data   # default checkout token; no broad PAT

- name: 🔒 Block private repo names in promotion diff
  env:
    FRO_BOT_POLL_PAT: ${{ secrets.FRO_BOT_POLL_PAT }}   # broad PAT scoped to this step only
    PROMOTION_REPOS_YAML_PATH: data-branch-check/metadata/repos.yaml
  run: node scripts/check-private-leak.ts --promotion
```

```ts
// packages/privacy/src/check-private-leak.ts — strip the broad PAT from the git diff subprocess
const gitEnv: NodeJS.ProcessEnv = {...process.env}
delete gitEnv.FRO_BOT_POLL_PAT
diff = gitDiffRunner(['diff', 'origin/main...origin/data'], gitEnv)
```

### Redaction: paths only, tokens scrubbed

```ts
// matched output never contains the resolved private name
const redactedFiles = scanResult.matchedFiles.map(f => redactPathTokens(f, privateTokens))
return {ok: false, matchedFiles: redactedFiles}
// redactPathTokens replaces each token (regex-escaped, case-insensitive) with [REDACTED]
```

## Related

- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — the
  fail-closed-on-private/unknown predicate and opaque-identifier redaction this gate builds on.
- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — verify
  privacy inside the trusted workflow before any public side effect (the per-PR-vs-chokepoint
  framing here extends that lesson to promotion).
- `docs/solutions/integration-issues/merge-data-pr-github-422-race-recovery-2026-05-02.md` — the
  `data→main` promotion chokepoint this gate runs inside.
- `docs/solutions/integration-issues/normalize-redacted-yaml-quotes-2026-05-09.md` — another
  promotion-boundary validation lesson.
- `docs/solutions/best-practices/autonomous-pipeline-minimum-progress-floor-2026-05-17.md` — a
  fallback path must reuse the exact fail-closed predicates of the main gate.
- Issues: #3407 (wire the gate), #3408 (operator-actionable blocked output), #3429 (resolver PAT
  hygiene), #3430 (redact node_ids in failure output), #3424 (accepted commit-history exposure).
- Source for rule 4: `a954038e2986090be051de740fab4b85b0d48209` (PR #4264, the lifecycle plan and its
  privacy review).
- `docs/solutions/best-practices/fix-a-fail-safe-flags-false-positive-in-the-consumer-2026-11-15.md` —
  the consumer-side live `PUBLIC` lookup that rule 4 reuses for archived rows.

## See also — privacy-gate correctness patterns

- [Structured-first attribution for public-allowlist privacy gates](wiki-page-structured-attribution-2026-06-04.md) —
  a public repo page passes only with a valid frontmatter block and a matching `sources` URL (no
  fallback), and the substring/prefix/unreadable-provenance leak vectors that closes.
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) —
  defense-in-depth at the dispatch boundary: the workflow is its own privacy boundary, not a
  downstream consumer of someone else's gate.
- [Pure-core privacy gates with a shared module and mutation-proof tests](pure-core-privacy-gates-shared-module-2026-06-22.md) —
  gate in the pure core before sensitive data enters shared state; one shared module so
  chokepoints cannot diverge; mutation-proof tests that fail when the gate is removed.
- [Verify the whole public perimeter](../security-issues/verify-whole-public-perimeter-2026-06-22.md) —
  enumerate every public surface before claiming a privacy invariant holds; a gate that covers
  only the surfaces you thought of is not a gate.
