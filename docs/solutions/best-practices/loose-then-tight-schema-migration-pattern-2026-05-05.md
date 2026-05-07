---
title: Loose-then-tight schema migration pattern
category: best-practices
problem_type: best_practice
module: scripts/schemas.ts
component: development_workflow
severity: medium
tags:
  - schema-migration
  - rollout
  - autonomous-workflows
  - validation
  - data-branch
  - backwards-compatibility
applies_when:
  - producer and consumer of a schema ship in different prs
  - schema validation runs at runtime on live data
  - autonomous or scheduled writers read production state during rollout
  - data migration must lag schema landing safely
created: 2026-05-05
last_updated: 2026-05-05
verified: true
---

## Context

This came up during ce:review of fro-bot/.github Unit 1 of the survey cadence + multi-channel discovery feature.

Unit 1 was supposed to be "pure types + guards + docs; no behavior change," with the actual data migration deferred to Unit 4. The trap: tightening the schema in Unit 1 would have passed CI, but it would have broken every live autonomous workflow as soon as they read legacy data from the unprotected `data` branch. Those workflows call `assertReposFile` inside commit-mutator closures, so they validate live data on every run.

Three reviewers converged on the same risk:

- the api-contract reviewer flagged it as a P0,
- the adversarial reviewer corroborated it as a P1,
- and the failure chain was concrete: failed reconcile → failed merge-data → regressed main → cascade.

## Guidance

Make new schema fields optional during the rollout window when the producer ships in a separate PR from the consumer; tighten them back to required once both producer and data are caught up.

When to go loose:

- schema validation happens at runtime, not just build/deploy time
- the producer lands in a different PR than the schema
- live data exists in branches/databases that won't be migrated atomically
- autonomous or scheduled workflows would crash on first run after the schema lands

Loose-phase shape:

```ts
export interface RepoEntry {
  // ... existing required fields
  /**
   * Optional during the rollout window: legacy entries without a channel are treated
   * as `'collab'` by default. The cadence migration path will tighten this to required
   * after `data` is migrated.
   */
  discovery_channel?: DiscoveryChannel
  next_survey_eligible_at?: string | null
}
```

Runtime guards must accept both new and legacy shapes — see the full Before/After examples below.

Producers must always emit defaults. New entries created during the loose phase should never be legacy-shaped. `addRepoEntry` and similar writers should write the default values (`'collab'`, `null`) so only pre-existing rows remain legacy.

A note on the tri-state for `next_survey_eligible_at`: during the loose phase the field can be `string` (set), `null` (explicitly cleared by the producer for not-yet-surveyed entries), or `undefined` (legacy rows that predate the field). `null` and `undefined` are treated the same by consumers, but the producer always writes explicit `null` so new rows never look legacy-shaped. After tightening, only `string | null` remains; the `undefined` branch goes away.

Tight phase:

- ship the migration function atomically with the schema-tightening edit
- run the producer once to back-fill any remaining legacy entries on the writer-owned branch
- remove the `?` and the `=== undefined` branches from both the type and the guard

Do not leave fields optional forever. The looseness is a temporary rollout tactic, not the final contract.

## Why This Matters

In autonomous-workflow systems, schema validation runs continuously on production data. A schema/data mismatch is not a CI issue — it is a live production outage.

Without this pattern:

- the tight schema lands on `main`
- CI passes
- the first scheduled cron run reads live legacy data
- `assertX` throws inside the mutator
- the run fails before it can commit
- the next cron tick fails the same way
- dependent workflows stall too

Recovery is bad either way:

- roll back, which is slow and blocks unrelated work
- or hotfix the schema to make fields optional after the fact, which is just the loose phase under duress

The cost of doing it right is two `?` characters and a JSDoc note. The cost of getting it wrong is a production outage in the control plane.

## When to Apply

Use this pattern when all of these are true:

1. You are adding required fields to a schema validated at runtime
2. The schema and producer ship in separate PRs
3. Live data exists on a branch/store that will not be migrated in the schema PR window
4. Autonomous workflows read that live data and validate it against the schema

If the producer and schema land in the same PR and the data is migrated atomically, tight from day one is fine.

## Examples

**Before: tight from day one — broken**

```ts
// scripts/schemas.ts
export interface RepoEntry {
  owner: string
  // ... existing fields
  discovery_channel: DiscoveryChannel
  next_survey_eligible_at: string | null
}

function isRepoEntry(value: unknown): value is RepoEntry {
  return (
    isRecord(value) &&
    // ... existing checks
    isDiscoveryChannel(value.discovery_channel) &&
    (value.next_survey_eligible_at === null || typeof value.next_survey_eligible_at === 'string')
  )
}
```

**After: loose during rollout — survives mixed-shape data**

```ts
// scripts/schemas.ts
export interface RepoEntry {
  owner: string
  // ... existing fields
  /**
   * Optional during the rollout window: legacy entries without a channel are treated as
   * `'collab'` by default. The cadence migration path will tighten this to required.
   */
  discovery_channel?: DiscoveryChannel
  next_survey_eligible_at?: string | null
}

function isRepoEntry(value: unknown): value is RepoEntry {
  return (
    isRecord(value) &&
    // ... existing checks
    (value.discovery_channel === undefined || isDiscoveryChannel(value.discovery_channel)) &&
    (value.next_survey_eligible_at === undefined ||
      value.next_survey_eligible_at === null ||
      typeof value.next_survey_eligible_at === 'string')
  )
}
```

**Producer always emits the new fields**

```ts
// scripts/repos-metadata.ts
export function addRepoEntry(input: AddRepoEntryInput): ReposFile {
  return {
    ...input.reposFile,
    repos: [
      ...input.reposFile.repos,
      {
        // ... existing required fields
        discovery_channel: input.discovery_channel ?? 'collab',
        next_survey_eligible_at: null,
      },
    ],
  }
}
```

**Tight phase: drop the `?` and `=== undefined` branches**

```ts
// After migrator has run, in the same PR that ships migrateRepoEntry:
export interface RepoEntry {
  // ... existing fields
  discovery_channel: DiscoveryChannel
  next_survey_eligible_at: string | null
}
```

## Related Documentation

- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — moderate overlap. Same family: contract enforcement on autonomous-workflow data. The silent-failure doc covers what happens when validation rejects live data; this doc covers how to avoid that rejection during a rollout window.
- `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md` — moderate overlap. Both touch the `data` vs `main` branch authority concept. Wiki-lint reads from `data` as the authoritative snapshot; this pattern keeps `data`-resident legacy entries readable while `main` evolves.
- `docs/solutions/integration-issues/merge-data-pr-github-422-race-recovery-2026-05-02.md` — low overlap. Both involve staged rollout with delayed consistency, but different failure modes.
