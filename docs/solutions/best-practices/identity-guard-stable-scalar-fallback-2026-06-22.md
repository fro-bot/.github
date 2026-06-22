---
title: Anchor Identity Guards on a Stable Scalar Fallback, Captured Defensively
date: 2026-06-22
last_updated: 2026-06-22
problem_type: best_practice
component: development_workflow
module: github-workflows
severity: medium
verified: 2026-06-22
tags:
  - identity-guard
  - denylist
  - format-migration
  - defensive-capture
  - optional-field
applies_when:
  - a denylist or redaction guard keys on a migratable identifier (e.g. node_id whose format has changed)
  - a secondary probe field is added to survive format migrations
  - a probe can transiently fail and the result feeds an equality or refresh check
  - a sub-probe failure must not crash the parent probe or weaken the primary guard
---

# Anchor Identity Guards on a Stable Scalar Fallback, Captured Defensively

## Context

A redaction denylist keyed on `node_id` to identify private repositories. GitHub's `node_id`
format has migrated before and will again — a legacy base64 entry stops matching after a format
change, silently dropping the guard for that entry. The fix: add a stable scalar fallback (the
numeric `repository.id` / `database_id`) so the guard still matches after a `node_id` migration.
When `node_id` migrates again, the old-format entry stops matching but the integer holds the
line.

The fallback field is optional everywhere — not all entries will have it, and that is fine. The
primary guard is still `node_id`; the scalar is a belt-and-suspenders anchor for format
migrations. It must never be rendered publicly (a `database_id` resolves back to owner/name via
public API — see the companion doc on canonical-id leaks).

A secondary issue surfaced during review: an equality check comparing a stored `database_id`
against a freshly probed value can falsely register a change when the probe transiently returns
`undefined`. If the stored value is `12345` and the probe returns `undefined`, the check
`entry.database_id !== probe.database_id` evaluates to `true` — inflating a "refreshed" counter
with phantom updates.

Merged at `8d7735dbed00db9f835b7029fa8f93d03d0ffbe5`.

## Guidance

### 1. Add a stable scalar fallback for migratable identifiers

When a guard keys on an identifier whose format can change (e.g. `node_id`), add a second
anchor that is format-independent. A numeric integer id is a good choice: it is stable across
format migrations, unambiguous, and not subject to encoding changes.

```ts
interface DenylistEntry {
  node_id: string          // primary key; may become stale after format migration
  database_id?: number     // stable fallback; optional, never rendered publicly
}

function isBlocked(repo: Repo, denylist: DenylistEntry[]): boolean {
  return denylist.some(
    e => e.node_id === repo.node_id || (e.database_id !== undefined && e.database_id === repo.database_id)
  )
}
```

### 2. Make the fallback sticky on transient probe failure

When probing for the scalar value, a transient API failure must not clear a previously stored
value. Use `?? stored` to preserve the existing value on a failed probe:

```ts
const probed = await fetchDatabaseId(nodeId).catch(() => undefined)
entry.database_id = probed ?? entry.database_id  // sticky: keep stored value on probe failure
```

### 3. Capture defensively — probe errors → undefined, never crash

A sub-probe failure must not fail the parent probe or produce a malformed entry. Catch all
errors from the sub-probe and return `undefined`. The parent continues with the primary
identifier intact.

```ts
async function probeDatabaseId(nodeId: string): Promise<number | undefined> {
  try {
    const result = await api.getRepo(nodeId)
    return result?.databaseId ?? undefined
  } catch {
    return undefined  // transient failure; primary guard is unaffected
  }
}
```

### 4. Treat undefined probe results as "no information" in equality checks

An optional probe field that returns `undefined` means the probe didn't run or failed — not
that the value changed. Equality and refresh checks must skip the comparison when either side
is `undefined`:

```ts
// Wrong: undefined !== 12345 → falsely registers a change
if (entry.database_id !== probe.database_id) markRefreshed()

// Right: skip comparison when probe result is absent
if (probe.database_id !== undefined && entry.database_id !== probe.database_id) markRefreshed()
```

### 5. Never render the scalar publicly

The numeric `database_id` resolves back to owner/name via `GET /repositories/{id}`. It must
not appear in committed files, PR bodies, review comments, or logs. Store it only in internal
state (e.g. the `data` branch metadata) and exclude it from any public-facing output.

## Related

- [Loose-then-tight schema migration pattern](../best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md) — the same incremental approach to identifier migrations: accept both formats during transition, tighten after.
- [Wiki page structured attribution](../best-practices/wiki-page-structured-attribution-2026-06-04.md) — the present-but-empty vs absent distinction recurs here; encode it as a habit across all optional fields.
- [Private repo dispatch visibility gate](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md) — the fail-closed predicate and opaque-identifier redaction that the denylist this fallback anchors is part of.
