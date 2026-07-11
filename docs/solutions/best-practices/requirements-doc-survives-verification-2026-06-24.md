---
title: Writing a requirements doc that survives verification
date: 2026-06-24
last_updated: 2026-06-24
problem_type: best_practice
category: best-practices
component: development_workflow
module: github-workflows
severity: high
verified: 2026-06-24
tags:
  - requirements
  - verification
  - closed-schema
  - dual-source
  - sequencing
  - planning
applies_when:
  - writing or reviewing a requirements or brainstorm document
  - the document touches a closed schema or a dual-source constraint
  - a success criterion removes infrastructure while a replacement decision is still open
  - a reviewer dissents and the dissent is at risk of being erased rather than recorded
---

# Writing a requirements doc that survives verification

## Context

Requirements docs that hand-wave get falsified in review. The strong ones make checkable claims:
every cited file, step, and contract can be verified against the live tree. The weak ones
describe intent in prose that sounds correct until someone opens the actual source.

Two failure modes are especially costly because they are unrecoverable if violated:

1. **Closed-schema dual-source misses.** A schema that is closed by construction — for example,
   an event-gateway `EventType` union plus a `VALID_EVENT_TYPES` runtime set — requires updating
   both sources in lockstep. A control-plane POST that sends an event type not present in both
   sources becomes a hard `400`. The validator enforces completeness; it does not forgive a
   partial update.

2. **Removal-before-replacement gaps.** A success criterion that removes infrastructure (e.g.,
   a webhook poster) while an open question leaves the replacement's dormant-vs-live decision
   unsettled can strand a daily run with no coverage in the window between removal and
   replacement going live.

Neither failure announces itself during planning. Both surface in production.

## Guidance

### 1. Make checkable claims

Every cited file, step, and contract in the requirements doc must exist in the live tree. Verify
each one before the doc is considered complete:

- "The gateway validates `EventType` against `VALID_EVENT_TYPES`" → open the gateway source and
  confirm the union and the runtime set are both present and in sync.
- "The webhook poster runs daily at 06:00 UTC" → open the workflow file and confirm the cron.
- "Redacted entries use `node_id` as the stable join key" → read the live metadata and confirm
  the shape.

Prose describes intent. Live source describes reality. Ground the doc in reality.

**Before (hand-wavy):**
> The gateway will validate the event type before posting.

**After (checkable):**
> The gateway validates `event_type` against the `EventType` union in `src/types.ts` and the
> `VALID_EVENT_TYPES` set in `src/validate.ts`. Both must be updated when a new event type is
> added; a partial update produces a hard `400`.

### 2. Name closed-schema dual-source constraints explicitly

When a schema is closed by construction, the doc must name both sources and state the lockstep
requirement. "Update the schema" is not enough — it must say "update both `EventType` in
`src/types.ts` and `VALID_EVENT_TYPES` in `src/validate.ts`."

The dual-source update pair is the unit of correctness. A reviewer who sees only one source
updated should block the change.

```ts
// Both must be updated together — the validator enforces completeness
export type EventType = 'survey.completed' | 'invitation.accepted' | 'repo.archived'

export const VALID_EVENT_TYPES = new Set<EventType>([
  'survey.completed',
  'invitation.accepted',
  'repo.archived',
])
```

### 3. Record dissent rather than erasing it

When a reviewer raises an objection that is heard but not adopted, record it as
advisory-but-not-adopted in the doc. The road-not-taken is part of the design record. A future
reader who encounters the same objection will know it was considered, not overlooked.

> **Reviewer note (advisory, not adopted):** Suggested deferring removal of the webhook poster
> until the gateway replacement is confirmed live. Accepted the risk given the short window;
> tracked as a sequencing dependency in the open questions.

Erasing the dissent makes the doc look more confident than it is and loses the context that
would help a future reader understand why the sequencing was chosen.

### 4. Surface sequencing gaps between removal and replacement

A success criterion that removes infrastructure while a replacement decision is still open is a
sequencing gap. Name it explicitly in the open questions section:

> **Open question:** Is the gateway replacement live before the webhook poster is removed, or
> does a window exist where neither fires? If a window exists, what is the fallback for daily
> runs in that window?

A gap that is named is a gap that can be closed. A gap that is implicit becomes a production
incident.

## Why This Matters

- **Closed-schema dual-source misses** produce hard `400`s that are unrecoverable without a
  code change and redeploy. The validator enforces completeness; it does not forgive a partial
  update.
- **Removal-before-replacement gaps** strand daily runs with no coverage. The window may be
  short, but it is real, and it is invisible in the requirements doc unless named.
- **Erased dissent** removes the design record that would help a future reader understand why
  a risky sequencing was chosen. The road-not-taken is part of the architecture.

## When to Apply

Apply this discipline when writing or reviewing any requirements or brainstorm document,
especially ones that:

- Touch a closed schema or a dual-source constraint.
- Include a success criterion that removes infrastructure.
- Have a reviewer dissent that is at risk of being resolved by deletion.

## Examples

### Dual-source update pair

A new event type `repo.archived` must appear in both sources:

```ts
// src/types.ts — add to the union
export type EventType = 'survey.completed' | 'invitation.accepted' | 'repo.archived'

// src/validate.ts — add to the runtime set
export const VALID_EVENT_TYPES = new Set<EventType>([
  'survey.completed',
  'invitation.accepted',
  'repo.archived',  // ← must be added here too; omitting produces a hard 400
])
```

### Sequencing gap made explicit

> **Success criterion:** Remove the legacy webhook poster from `owner/example-repo`.
>
> **Open question (sequencing):** The gateway replacement must be confirmed live and posting
> correctly before the webhook poster is removed. If the poster is removed first, the daily
> `survey.completed` event has no sender for the duration of the gap. Resolution: gate the
> removal PR on a confirmed gateway post in the prior 24 hours.

## See also

- [Byte-exact HMAC signing and fail-soft telemetry](byte-exact-gateway-signing-and-fail-soft-telemetry-2026-06-04.md) —
  reconcile against the deployed verifier's code, not the design doc; the same "live source
  over prose" discipline applied to a signing contract.
- [A second credential gives rotation isolation, not permission isolation](credential-mint-time-permission-scoping-2026-06-22.md) —
  validate a plan's security invariants against live data, not its prose.
- [Verify the whole public perimeter](../security-issues/verify-whole-public-perimeter-2026-06-22.md) —
  enumerate every public surface before claiming a privacy or security invariant holds.
- [Observability before structural change](observability-before-structural-change-2026-06-09.md) —
  confirm the current behavior is observable before removing or replacing the path that produces it.
