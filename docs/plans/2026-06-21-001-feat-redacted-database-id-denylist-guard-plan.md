---
title: 'feat: format-independent database_id denylist guard for redacted repos'
type: feat
status: active
date: 2026-06-21
origin: https://github.com/fro-bot/.github/issues/3525
---

# feat: format-independent database_id denylist guard for redacted repos

## Overview

The dashboard's redaction denylist protects a redacted/private repo from being queried via two
guards: a primary string match on `node_id` and a secondary, format-independent match on the
numeric `database_id`. The secondary guard is inert today because the redacted entries in
`metadata/repos.yaml` carry a new-format (`R_…`) `node_id` and no `database_id`, and
`deriveDatabaseId()` correctly returns `null` for new-format node_ids. Only the primary
`node_id` string match stands between those repos and the dashboard's working set.

This plan makes the secondary guard effective by adding an explicit numeric `database_id` to
redacted entries — fixed at the **write site** so new private repos are format-independent by
construction, not just by a one-time backfill. The dashboard needs no code change; its
dual-guard logic already consumes `database_id` once the data provides it.

## Problem Frame

(Origin: issue #3525 + Fro Bot triage.) GitHub has migrated its node_id format once already
(legacy base64 `MDEw…==` → next-gen `R_kgDO…`; both forms are documented in
`scripts/schemas.ts` around the `NODE_ID_PATTERN`). If GitHub migrates again, a redacted entry
written under the old format would no longer match the `node_id` the API returns. With no
`database_id` fallback, the redacted repo would enter the working set, get queried, and surface
on the dashboard. The numeric `repository.id` (`database_id`) is stable across both node_id
formats, so it is the durable anchor. This is defense-in-depth: today's single-API-version
path is safe; the fix protects against a future format drift.

## Requirements Trace

- R1. `RepoEntry` accepts an optional, validated `database_id` (positive integer), omittable
  during the rollout window (mirroring how `node_id`/`private` were tightened). (origin: "Schema")
- R2. The metadata writer persists `database_id` on redacted/private entries at redaction time,
  so new private repos carry the numeric anchor by construction. (origin: "Writer")
- R3. The reconcile field probe captures the numeric `repository.id` for tracked repos via the
  existing GraphQL probe (extended with `databaseId`), so the writer has the value to persist.
  (origin: "Writer"/probe)
- R4. The two existing redacted entries on the `data` branch are backfilled with their numeric
  `database_id`, resolved from the probe — never guessed by decoding the node_id binary.
  (origin: "Backfill")
- R5. `database_id` is treated with the same redaction discipline as `node_id`: written only to
  `data`, never echoed to a public render/log site. (origin: "Notes" caveat)
- R6. `deriveDatabaseId()` stays conservative (returns `null` for unrecognized formats) — the
  explicit field is the fix, not a binary-decode guess. (origin: "Fix")

## Scope Boundaries

- No dashboard code change. The dashboard's `deriveDatabaseId()` and dual-guard logic are
  already correct; they only need the data to feed the secondary guard.
- No change to `deriveDatabaseId()`'s conservative null-on-unrecognized behavior.
- No change to `main`. `database_id` lives only on `data`, behind the same redaction that
  already covers `node_id`; it never promotes to `main` for private repos.
- Not a fix for an active leak — verified safe today; this is future-drift hardening.

### Deferred to Separate Tasks

- None. The schema + writer + backfill land together so the field does not round-trip silently
  or reset the clock.

## Context & Research

### Relevant Code and Patterns

- **Schema** — `scripts/schemas.ts`: `RepoEntry` interface (the `node_id?: string` field is the
  pattern to mirror for `database_id?: number`); `isRepoEntry` / `assertRepoEntry` guards (the
  `node_id` optional+validated branches show exactly where the `database_id` validation slots
  in); `NODE_ID_PATTERN` block documents the two node_id formats that motivate this change.
- **Writer** — `scripts/repos-metadata.ts`: `RepoIdentityInput` (carries `private?` / `node_id?`
  today), `assertPrivateNodeId` (enforces node_id presence for private repos), and
  `definedPrivacyFields` (the function that copies privacy fields onto the entry) — the natural
  seam to thread `database_id` alongside `node_id`. These are pure, idempotent writers.
- **Probe** — `scripts/reconcile-repos.ts`: `RepoStatusProbe` union and the field-probe pass
  that resolves `private` / `node_id` per tracked repo. Extending the existing GraphQL query
  with `databaseId` is the chosen capture path (one round-trip, no new failure mode).
- **Consumer (no change, for reference)** — the dashboard's `deriveDatabaseId()` and
  `redactedDatabaseIds` denylist in `fro-bot/dashboard`.

### Institutional Learnings

- Loose-then-tight schema migration (the established repo pattern): new field is optional during
  rollout; the writer populates it; tightening (if ever) ships atomically with a migrator. For
  `database_id`, optional is likely the permanent shape — older entries may legitimately lack it.
- Private-repo identifiers (`node_id`, and now `database_id`) must never reach a public render or
  log site; render sites embed identifiers in shell/issue text (see the visibility-transition
  issue renderer in `scripts/reconcile-repos.ts`).

## Key Technical Decisions

- **Optional `database_id?: number`, validated as a positive integer.** Mirrors the
  `node_id?`/`private?` optional-and-validated treatment. Permanently optional — legacy/public
  entries need not carry it, and a redacted entry written before this change is still protected
  by the primary `node_id` guard until reconcile refreshes it.
- **Capture via the existing GraphQL probe's `databaseId` field.** The field probe already
  resolves `isPrivate`/`node_id` per repo in one GraphQL query; adding `databaseId` to that
  selection set yields the numeric id with no extra API call or failure path. (User decision.)
- **Write-site fix, not just backfill.** The durable fix populates `database_id` where redacted
  entries are constructed (`repos-metadata.ts` via the probe value), so the next private repo
  is format-independent by construction. Backfilling the two current entries without teaching
  the writer would only reset the clock.
- **Same redaction discipline as `node_id`.** `database_id` is data-branch-only and must never
  be rendered/logged publicly. Schema validation rejects non-positive-integer values; the writer
  treats it like `node_id`.
- **`deriveDatabaseId()` stays conservative.** The explicit persisted field is the fix; no
  attempt to decode the node_id binary to guess the numeric id.

## Open Questions

### Resolved During Planning

- How to capture the numeric id? → Extend the existing reconcile GraphQL probe with `databaseId`
  (user decision), avoiding a separate REST read.
- Optional vs required field? → Optional (positive integer when present); permanently omittable
  so legacy/public entries and pre-refresh redacted entries remain valid.
- Dashboard change needed? → No; the consumer already handles `database_id` when present.

### Deferred to Implementation

- Exact GraphQL selection-set edit and the probe's result-type field name for `databaseId`
  (`RepoStatusProbe` shape) — settle against the real query when implementing Unit 2.
- Whether `assertPrivateNodeId` should also assert `database_id` presence for private repos, or
  leave it optional (a private repo whose probe failed to return `databaseId` should still be
  redactable on `node_id` alone — lean optional, confirm during Unit 2).
- The exact numeric `database_id` values for the two existing redacted entries — resolved from
  the probe at backfill time (Unit 4), never guessed.

## Implementation Units

Sequenced: schema first (the field must exist before the writer/probe populate it or the data
backfill validates), then probe capture, then writer persistence, then the data backfill.

- [ ] **Unit 1: Add `database_id` to the `RepoEntry` schema**

**Goal:** `RepoEntry` accepts an optional, validated `database_id` (positive integer).

**Requirements:** R1, R5.

**Dependencies:** None.

**Files:**
- Modify: `scripts/schemas.ts` (`RepoEntry` interface, `isRepoEntry`, `assertRepoEntry`)
- Test: `scripts/schemas.test.ts`

**Approach:** Add `database_id?: number` to `RepoEntry`, documented as the stable numeric REST
`repository.id` and the format-independent denylist anchor for redacted entries. Extend
`isRepoEntry` and `assertRepoEntry` with an optional branch mirroring `node_id`: when present,
require a positive integer (reject `0`, negatives, non-integers, non-numbers); when omitted,
valid. Note in the field doc that it is data-branch-only and must not be rendered/logged publicly.

**Execution note:** test-first (the schema guard is the contract every downstream unit relies on).

**Patterns to follow:** the `node_id?` optional+validated branches in `isRepoEntry` /
`assertRepoEntry`; the field-doc style of the existing privacy fields.

**Test scenarios:**
- Happy path: entry with `database_id: 1234567` (positive int) → accepted.
- Happy path: entry omitting `database_id` → accepted (optional).
- Edge: `database_id: 0` → rejected (not positive).
- Error: `database_id: -5` → rejected.
- Error: `database_id: 12.5` → rejected (not integer).
- Error: `database_id: "1234"` (string) → rejected (not number).

**Verification:** schema guards accept positive-integer or omitted `database_id`, reject all
invalid shapes; `pnpm check-types` + `pnpm test` green.

- [ ] **Unit 2: Capture `databaseId` in the reconcile field probe**

**Goal:** The field probe resolves the numeric `repository.id` per tracked repo alongside
`private`/`node_id`, via the existing GraphQL query.

**Requirements:** R3.

**Dependencies:** Unit 1.

**Files:**
- Modify: `scripts/reconcile-repos.ts` (the GraphQL probe query + `RepoStatusProbe` result shape)
- Test: `scripts/reconcile-repos.test.ts`

**Approach:** Add `databaseId` to the existing per-repo GraphQL selection set (the query that
already returns `isPrivate` and the GraphQL id). Surface it on the probe result type
(`still-accessible` and any tracked-state variant that carries `private`/`node_id`). Handle the
`databaseId` being absent/null defensively (treat as "not captured" — do not crash; the entry
remains protected by `node_id`). Keep the `malformed` classification logic intact (a missing
`databaseId` alone is not malformed, since it's optional downstream).

**Execution note:** test-first for the probe-shape change (mocked GraphQL responses).

**Patterns to follow:** the existing `private`/`node_id` resolution in the field probe;
`RepoStatusProbe` union shape and its sticky-preserve semantics.

**Test scenarios:**
- Happy path: GraphQL returns `isPrivate`, node_id, and `databaseId` → probe result carries the
  numeric id.
- Edge: GraphQL returns no/`null` `databaseId` (but valid private/node_id) → probe result has no
  database_id; not classified malformed; no crash.
- Integration: the probe value flows to where redacted entries are written (asserted in Unit 3).

**Verification:** the probe surfaces `databaseId` when present, degrades gracefully when absent;
existing probe tests still pass.

- [ ] **Unit 3: Persist `database_id` on redacted entries at the write site**

**Goal:** New/updated redacted entries carry `database_id` from the probe, so private repos are
format-independent by construction.

**Requirements:** R2, R5.

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `scripts/repos-metadata.ts` (`RepoIdentityInput`, `definedPrivacyFields`, and the
  redaction-entry construction; the reconcile call site that builds the identity input from the
  probe)
- Test: `scripts/repos-metadata.test.ts`

**Approach:** Add `database_id?: number` to `RepoIdentityInput`. In `definedPrivacyFields` (or
the equivalent privacy-field copier), copy `database_id` onto the entry when present, alongside
`node_id`/`private`. At the reconcile call site, pass the probe's captured `databaseId` into the
identity input. Keep `database_id` optional for private repos (lean: do NOT make
`assertPrivateNodeId` require it — a private repo whose probe didn't return `databaseId` is still
redactable on `node_id`; confirm during implementation). Treat `database_id` with the same
redaction discipline as `node_id` (data-branch-only; never logged).

**Execution note:** test-first for the writer field-copy behavior (pure function over inputs).

**Patterns to follow:** how `node_id`/`private` flow through `RepoIdentityInput` →
`definedPrivacyFields` → entry; the idempotent, non-mutating writer contract.

**Test scenarios:**
- Happy path: redacting a private repo with a probe `database_id` → entry carries `database_id`
  (positive int), `node_id`, `private:true`, `owner:[REDACTED]`, `name:<node_id>`.
- Edge: redacting a private repo with no probe `database_id` → entry has `node_id`/`private` but
  no `database_id`; still valid, still redacted (no leak).
- Edge: re-running the writer on an entry that already has `database_id` → idempotent (no change).
- Security: the constructed entry never contains the canonical `owner/name`; `database_id`
  appears only as the numeric field, never in a render/log-shaped string.

**Verification:** redacted entries gain `database_id` when the probe provides it; the writer
stays idempotent and pure; no canonical identifier leaks.

- [ ] **Unit 4: Backfill `database_id` into the two existing redacted entries on `data`**

**Goal:** The two current redacted entries (`R_kgDOSVJgdw`, `R_kgDOSZ9x-w`) carry their numeric
`database_id`, resolved from the probe.

**Requirements:** R4, R6.

**Dependencies:** Units 1-3 (the field must validate and the writer/probe must resolve the ids).

**Files:**
- Data: `metadata/repos.yaml` on the `data` branch (the two `private:true` entries) — written via
  the Fro Bot / data-branch authority path, NOT a human-authored `main` PR.

**Approach:** Resolve the two numeric ids from the reconcile probe (or an equivalent
authenticated lookup of `repository.id` for each node_id) — never by decoding the node_id binary.
Add `database_id: <int>` to each redacted entry on `data`. Because `metadata/*.yaml` is
data-branch sole-writer and wiki-authority-guarded, this write is performed under Fro Bot
identity (e.g. a reconcile run that now captures `databaseId`, or a `fro-bot.yaml` dispatch),
not a human PR to `main`. A normal reconcile run after Units 1-3 ship will populate the field
naturally on the next field-probe refresh of those entries — prefer that over a manual backfill
if the refresh cadence is acceptable.

**Test scenarios:**
- Test expectation: none (data change). Verify post-write that both redacted entries on `data`
  validate against the updated schema and carry a positive-integer `database_id`, with no
  canonical owner/name present.

**Verification:** both redacted `data` entries have `database_id`; schema validation passes; the
dashboard's `redactedDatabaseIds` is now non-empty (secondary guard effective); no private name
on `main` or in any log.

## System-Wide Impact

- **Interaction graph:** the reconcile field probe gains one GraphQL field; the metadata writer
  gains one optional field. Consumers: the dashboard denylist (already handles `database_id`),
  and the schema guards (validate it). No new workflow or API surface.
- **State lifecycle:** `database_id` is populated on the next reconcile field-probe refresh of an
  entry; entries refreshed before this ships simply lack it and stay protected by `node_id`.
  Loose/optional field = no migration break.
- **API surface parity:** the field probe is the single resolver of `private`/`node_id`/now
  `database_id` — no other code path constructs redacted entries, so there is one place to keep
  consistent.
- **Unchanged invariants:** `main` never receives private-repo `database_id` (data-branch-only,
  behind existing redaction); `deriveDatabaseId()` behavior unchanged; the primary `node_id`
  guard is untouched and remains the first line of defense.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `database_id` (numeric repo id) leaks to a public surface | Treated with the same data-branch-only redaction discipline as `node_id`; schema doc + writer keep it off render/log sites; it never promotes to `main`. The numeric id is a weak identifier (small int, not a secret), but discipline is kept regardless. |
| Probe doesn't return `databaseId` for some repo | Field is optional; entry stays protected by the primary `node_id` guard; no crash, not classified malformed. |
| Backfill guesses wrong ids by decoding node_id | Explicitly forbidden — ids come from the probe/authenticated lookup only; `deriveDatabaseId()` stays conservative. |
| Field round-trips silently and breaks on a future strict-parse change | Schema (Unit 1) validates the field from the start, so it is a known field, not silent passthrough. |
| Data write to `metadata/repos.yaml` via a human `main` PR trips the wiki-authority guard | Backfill is performed under Fro Bot / data-branch authority (reconcile run or `fro-bot.yaml`), never a human `main` PR. |

## Documentation / Operational Notes

- `metadata/README.md` documents the `metadata/repos.yaml` entry shape — add `database_id` to the
  field list with its data-branch-only/redaction note, so the auto-managed-metadata contract
  stays accurate.
- After this ships, the cleanest backfill is a normal reconcile run (now capturing `databaseId`)
  re-probing the two redacted entries; a manual Fro Bot dispatch is the fallback if the cadence
  is too slow.

## Sources & References

- **Origin:** issue #3525 (https://github.com/fro-bot/.github/issues/3525) + Fro Bot triage.
- Schema: `scripts/schemas.ts` (`RepoEntry`, `isRepoEntry`/`assertRepoEntry`, `NODE_ID_PATTERN`).
- Writer: `scripts/repos-metadata.ts` (`RepoIdentityInput`, `assertPrivateNodeId`,
  `definedPrivacyFields`).
- Probe: `scripts/reconcile-repos.ts` (`RepoStatusProbe`, field-probe pass).
- Consumer (no change): `fro-bot/dashboard` `deriveDatabaseId()` / `redactedDatabaseIds`.
