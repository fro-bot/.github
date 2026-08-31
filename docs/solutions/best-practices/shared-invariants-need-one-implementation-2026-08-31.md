---
title: Shared invariants need one implementation and an explicit removal path
date: 2026-08-31
last_updated: 2026-08-31
category: best-practices
module: packages/wiki-write-core
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - "a helper is extracted because two consumers must enforce the same normalization or predicate"
  - "a schema rollout accepts legacy data temporarily but intends to require a tighter shape later"
  - "a discriminated union contains a compatibility member that should eventually be deleted"
tags:
  - shared-module
  - schema-migration
  - rollout
  - validation
  - backwards-compatibility
  - type-safety
  - anti-recurrence
---

# Shared invariants need one implementation and an explicit removal path

## Context

The correction lifecycle change in #3801 extracted `normalizeCorrectionText` into
`packages/wiki-write-core/src/correction-text.ts`. The invariant is not "there is a
module with a shared-sounding name"; it is that every producer and consumer of the
correction text uses the same implementation. The current `corrections.ts` storage
validation and `corrections-survival.ts` ingest check both import that function, so a
whitespace rule cannot silently diverge between writing and survival verification.

The same change introduced a rollout boundary for older correction records. The parser
accepts `LooseCorrectionRecord`, then `normalizeLooseCorrectionRecord` converts it to a
lifecycle-specific union member. `LegacyActiveCorrectionRecord` is intentionally named
and deletable rather than hidden inside optional fields. That gives the eventual
tightening a precise type-level tripwire.

## Guidance

1. **Define the invariant once inside the feature boundary.** Extracting a helper is
   incomplete until every consumer that expresses the invariant imports it. Search for
   both old inline definitions and the new helper's import before calling the extraction
   complete.
2. **Test adoption, not just helper behavior.** A unit test for normalization proves the
   function works. A source-level or integration assertion that the consumers import it
   proves the duplicate implementation is gone.
3. **Give compatibility shapes a named union member.** Keep legacy input acceptance at
   the parsing boundary, normalize it immediately, and make the compatibility member
   easy to remove later.
4. **Pin the removal obligation at the boundary.** An intentional `@ts-expect-error`
   against `Exclude<Union, LegacyMember>` should fail when the legacy member is removed.
   That turns a deferred cleanup into a typecheck-visible task instead of tribal memory.
5. **Preserve rollout data deliberately.** If the migration window allows unknown
   on-disk fields, lifecycle transitions must copy them forward. Tightening the visible
   type must not accidentally discard data the rollout explicitly promised to preserve.

## Why This Matters

A duplicated normalizer creates asymmetric acceptance: storage can accept text that the
matching check cannot find, or the check can accept text storage would reject. The record
then becomes unmatchable precisely where the shared extraction was supposed to prevent
that class of drift. One canonical import makes the invariant structural rather than
memory-dependent.

The union technique solves a different half of the problem. Optional lifecycle fields
make every record look potentially legacy forever. A named compatibility member lets the
runtime parser remain backward-compatible while the type system records exactly what must
change before the rollout can become strict. The tradeoff is intentional friction: the
deletion leaves a failing type assertion until the test is updated, which is safer than
silently carrying a compatibility path after its data migration is complete.

## When to Apply

- A refactor claims that two modules now share a predicate, normalizer, parser, or gate.
- One side of a producer/consumer pair is being moved to a new helper.
- A live data store contains records from before a schema field or lifecycle state existed.
- A compatibility type is expected to disappear after backfill or a bounded rollout.
- Unknown fields must survive transitions while known fields become stricter.

## Examples

### Shared normalizer adoption

The durable implementation is small and exported from its own module:

```ts
// packages/wiki-write-core/src/correction-text.ts
export function normalizeCorrectionText(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ')
}
```

Both storage validation and ingest survival verification import it:

```ts
// corrections.ts
import {normalizeCorrectionText} from './correction-text.ts'

// corrections-survival.ts
import {normalizeCorrectionText} from './correction-text.ts'
```

The regression test in `packages/wiki-write-core/src/corrections-survival.test.ts`
checks the import, asserts that the file no longer declares a private function with the
same name, and verifies that multiline input normalizes identically.

### Deletable legacy union member

The current rollout keeps the old no-state record explicit:

```ts
export interface LegacyActiveCorrectionRecord extends CorrectionRecordBase {
  readonly state?: undefined
  readonly superseded_by?: never
}

export type CorrectionRecord =
  | ActiveCorrectionRecord
  | LegacyActiveCorrectionRecord
  | SupersededCorrectionRecord
  | RetiredCorrectionRecord
  | NeedsReconfirmationCorrectionRecord
```

The test records the future obligation without weakening the current parser:

```ts
// @ts-expect-error: removing the legacy union member must force this boundary to be revisited.
const strictOnly: Exclude<CorrectionRecord, LegacyActiveCorrectionRecord> = normalized
```

`normalizeLooseCorrectionRecord` is the only place that turns the loose I/O shape into a
union member. `withoutLifecycleFields` copies unknown properties before transitions, so
the rollout's compatibility promise is not lost when a record is retired, reconfirmed,
or superseded.

## Related

- [Make failure boundaries and shared predicates explicit](make-failure-boundaries-and-predicates-explicit-2026-08-25.md) — the broader rule for canonical feature-local predicates and checking every consumer.
- [Loose-then-tight schema migration pattern](loose-then-tight-schema-migration-pattern-2026-05-05.md) — the producer, parser, and backfill sequencing behind a safe compatibility window.
- [Pure-Core Privacy Gates with a Shared Module and Mutation-Proof Tests](pure-core-privacy-gates-shared-module-2026-06-22.md) — a parallel example where shared enforcement is proved at the consuming seams.
- [Extend status vocabularies across every reporting surface](status-vocabulary-must-cover-every-report-surface-2026-08-31.md) — the same partial-application failure mode, but across reporting surfaces rather than code and type boundaries.
