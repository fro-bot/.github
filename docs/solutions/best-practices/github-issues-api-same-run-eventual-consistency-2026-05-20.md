---
title: GitHub Issues API same-run eventual consistency requires an in-memory created-ID set
date: 2026-05-20
last_updated: 2026-05-20
verified: 2026-05-20
category: best-practices
module: scripts/reconcile-repos.ts
problem_type: best_practice
component: background_job
severity: medium
related_components:
  - tooling
tags:
  - github-api
  - issues
  - eventual-consistency
  - race-condition
  - duplicate-creation
  - reconcile
applies_when:
  - one process creates a GitHub issue via issues.create
  - the same process later calls issues.listForRepo to decide whether to create
  - dedup or self-heal logic must survive same-run API staleness
  - stage orchestrators touch the same GitHub resource at multiple points
---

# GitHub Issues API same-run eventual consistency requires an in-memory created-ID set

## Context

The GitHub Issues API has an asymmetric consistency window. A `POST /repos/{owner}/{repo}/issues` call returns quickly with the created issue's number, but a subsequent `GET /repos/{owner}/{repo}/issues` call from the same process — seconds later — can return a stale list that does NOT include the freshly-created issue.

Within a single workflow run, code that creates an issue and then lists issues to check for duplicates will see the OLD list and create a second duplicate. The same shape applies to PRs, labels, and comments; the Issues API is just where `fro-bot/.github` hit it first.

Concrete instance: `scripts/reconcile-repos.ts` had three sequential stages:

1. `runIssueQueue()` — creates `reconcile:rollup` issues for new pending-review repos.
2. `autoCloseStaleIssues()` — closes stale rollups (orthogonal concern).
3. `selfHealRollups()` — lists open rollup issues via `issues.listForRepo`; creates one if none exist for that owner.

A rollup created in step 1 was invisible to step 3's list call. `selfHealRollups` created a duplicate. Operators saw two rollups per affected owner per run.

A closely related pattern lives in [merge-data-pr-github-422-race-recovery-2026-05-02.md](../integration-issues/merge-data-pr-github-422-race-recovery-2026-05-02.md) — same eventual-consistency family on the Pulls API. There the fix is rediscovery after a transient 422; here the fix is an in-memory set carried through stages.

## Guidance

**Rule.** If a code path BOTH creates a GitHub issue AND later lists issues to decide on creation within the same process, carry an in-memory `Set<string>` of created identifiers through subsequent stages. For the lifetime of that run, the `Set` is the source of truth — NOT `issues.listForRepo`.

The set holds whatever identifier the dedup logic keys on. For per-owner rollups, that's the owner login string. For per-PR rollups, that might be the PR node_id or label. Use the most narrow identifier that the dedup decision actually depends on.

### Pattern

```ts
// 1. After the create stage emits its plan, materialize the dedup keys.
const currentRunRollupOwners = new Set(
  plan.issues
    .filter(issue => issue.kind === 'per-owner-rollup')
    .map(issue => issue.owner),
)

// 2. Pass the set through to any downstream stage that lists + creates.
const healedRollups = await selfHealRollups({
  appOctokit,
  owner,
  repo,
  accessList,
  allowlist,
  logger,
  currentRunRollupOwners,
})

// 3. Inside selfHealRollups, union the in-memory set with the API-derived set
//    BEFORE deciding whether to create. The set is authoritative.
const existingRollupOwners = new Set<string>(/* from issues.listForRepo */)
for (const owner of params.currentRunRollupOwners) {
  existingRollupOwners.add(owner)
}

if (existingRollupOwners.has(targetOwner)) {
  // skip create — either the API already knows, or we created it ourselves this run
  return
}
```

### Test the race directly

A regression test must reproduce the race shape: mock `issues.listForRepo` to return an empty list, pass the just-created identifier through the in-memory set, and assert that the second `issues.create` does NOT happen. Mocking the list call to return empty is the closest local approximation of GitHub's stale-read behavior.

## Why This Matters

- **Duplicate issues are noise that drowns signal.** Two rollups per owner per run produces alert fatigue. Operators learn to ignore them. Real problems then go unnoticed.
- **GitHub's write→read consistency window is asymmetric and load-dependent.** Writes are reflected in the SAME call's response within ~1s, but visible to a subsequent list call only after several seconds — sometimes longer under platform load.
- **"Just sleep a few seconds" is not a fix.** It inflates run wall-clock, is unreliable (the consistency window varies), and does not compose if stages stack.
- **The pattern recurs across the GitHub API.** Same shape applies to PRs, labels, comments, deployments, and check runs. The dedup-via-Set pattern is the universal answer when the stages live in the same process.

## When to Apply

Any code path in this repo (or similar) where:

- A stage orchestrator runs multiple stages within one process
- Two or more of those stages touch the same GitHub API resource type (issues, PRs, labels, comments)
- A later stage uses a `list*` call to decide whether to create
- A duplicate would be operator-visible noise rather than silent

Specifically in `fro-bot/.github`:

- `scripts/reconcile-repos.ts` — applies, fixed in PR #3321
- Future per-PR dedup that adds an after-create list check would apply
- Future autoheal create-then-verify patterns would apply

## Examples

### Before (race window open)

`selfHealRollups` only trusted the API list call. A rollup created seconds earlier in `runIssueQueue` could be invisible.

```ts
const healedRollups = await selfHealRollups({
  appOctokit,
  owner,
  repo,
  accessList,
  allowlist,
  logger,
})
```

Inside `selfHealRollups`:

```ts
const { data: openRollups } = await octokit.rest.issues.listForRepo({
  owner,
  repo,
  state: 'open',
  labels: ROLLUP_LABEL,
})

const existingRollupOwners = new Set(
  openRollups.map(issue => issue.title /* parse owner from title */),
)

for (const candidate of healableOwners) {
  if (existingRollupOwners.has(candidate)) continue
  await octokit.rest.issues.create({ /* duplicate created here */ })
}
```

### After (race closed by carrying intent through stages)

```ts
const currentRunRollupOwners = new Set(
  plan.issues
    .filter(issue => issue.kind === 'per-owner-rollup')
    .map(issue => issue.owner),
)

const healedRollups = await selfHealRollups({
  appOctokit,
  owner,
  repo,
  accessList,
  allowlist,
  logger,
  currentRunRollupOwners,
})
```

Inside `selfHealRollups`:

```ts
const { data: openRollups } = await octokit.rest.issues.listForRepo({
  owner,
  repo,
  state: 'open',
  labels: ROLLUP_LABEL,
})

const existingRollupOwners = new Set(
  openRollups.map(issue => issue.title /* parse owner from title */),
)

// Union API state with in-memory created state. In-memory is authoritative
// for anything created in this run — the API list may be lagging.
for (const owner of params.currentRunRollupOwners) {
  existingRollupOwners.add(owner)
}

for (const candidate of healableOwners) {
  if (existingRollupOwners.has(candidate)) continue
  await octokit.rest.issues.create({ /* now only fires if neither source knows */ })
}
```

### Regression test (the shape that matters)

```ts
test('does not double-create a rollup that was just created in the same run', async () => {
  const ownerJustCreated = 'bfra-me'
  mockOctokit.rest.issues.listForRepo.mockResolvedValue({
    data: [], // API list lags — empty even though we just created
  })

  await selfHealRollups({
    appOctokit: mockOctokit,
    owner: 'fro-bot',
    repo: '.github',
    accessList,
    allowlist,
    logger,
    currentRunRollupOwners: new Set([ownerJustCreated]),
  })

  expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled()
})
```

## Related

- [merge-data PR recovery from GitHub 422 race](../integration-issues/merge-data-pr-github-422-race-recovery-2026-05-02.md) — the closest analogue. Same GitHub eventual-consistency family, different resource (Pulls API). Fix shape differs: there the system rediscovers a PR after a transient 422 / stale `expected_head_sha`; here the system carries an in-memory created-ID set so same-run stages don't double-count or miss freshly created issues. Pair them when reasoning about same-run GitHub API consistency.
- [Bootstrap the `data` branch before autonomous writes](../integration-issues/bootstrap-data-branch-before-autonomous-writes-2026-05-09.md) — same family of "reconcile state before acting" patterns at startup; different resource (refs vs issues).
- PR #3321 — `fix(reconcile): suppress self-heal rollup duplicates from same-run race`
- Issues #3307, #3308 — the duplicate rollups that prompted the investigation
- Issue #3319 — operator-readable observability for the in-memory dedup (deferred follow-up)
- Issue #3332 — visibility-transition same-run dedup race (same family on a different `selfHeal*` site)
