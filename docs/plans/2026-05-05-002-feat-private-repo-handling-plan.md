---
title: Private-repo handling
type: feat
status: active
date: 2026-05-05
origin: docs/brainstorms/2026-05-05-private-repo-handling-requirements.md
deepened: 2026-05-05
---

# Private-repo handling

## Overview

Establish Fro Bot's privacy posture: no information about a private repo's existence, contents, or activity appears in any public artifact `fro-bot/.github` produces. This is a posture, not a feature. v1 establishes the gates going forward; existing leaks are enumerated and either remediated or explicitly accepted in Unit 0 before any other unit ships.

The architecture is **always-redacted-everywhere**: `metadata/repos.yaml` on both `data` and `main` carries `owner: '[REDACTED]'` + `name: <node_id>` for `private: true` entries. The canonical owner/name is recoverable only via the GitHub API (operator-side, requires authentication). This was forced by the discovery during planning that `origin/data` is publicly readable to any unauthenticated git client — verified via `git clone --depth=1 https://github.com/fro-bot/.github && git fetch origin data:data && git show data:metadata/repos.yaml`. The "operator-canonical on `data`, redacted on `main`" model considered earlier is theater and was rejected.

## Problem Frame

`marcusrbrown/poly` is the first private repo Fro Bot has been invited to. Multiple leaks already exist on `main` (two commit subjects, workflow run logs, current `metadata/repos.yaml` content). Going forward, several additional public-artifact write boundaries need gates: wiki-ingest, social broadcast, autonomous commit messages, workflow surface elements, and visibility transitions. Three failure modes also need correction: probe coercion (fail-open by construction), manual `workflow_dispatch` bypass (multiple sites), and probe-error-class collapse (404 vs 5xx vs malformed-200 carry different semantics).

See origin for the full posture statement, reconsider triggers, and rejected alternatives.

## Requirements Trace

(Mapping origin requirements to plan units; full text in origin.)

- R0 (existing-leak enumeration + per-surface decision) → Unit 0
- R1 (data model: optional `private`) → Unit 1
- R2 (data model: required `node_id`) → Unit 1
- R3 (5-state probe) → Unit 2
- R4 (probe credential pinned) → Unit 2
- R5 (always-redacted writes in mutators) → Unit 3
- R6 (Survey Repo workflow gate, `node_id` inputs) → Unit 6
- R7 (Poll-invitations gate + commit-message redaction) → Unit 4
- R8 (reconcile dispatch gate, ordering with cadence) → Unit 5
- R9 (`social-broadcast` privacy-aware, fail-safe default) → Unit 7
- R10 (autonomous commit message redaction in all mutator paths) → Unit 4 + Unit 3
- R11 (wiki path exclusion + merge ceremony block) → Unit 8
- R12 (workflow surface privacy: `node_id` inputs everywhere) → Unit 6 (survey-repo) + Unit 4 (poll-invitations)
- R13 (`summary.skippedPrivate` aggregate-only) → Unit 5
- R14 (public→private transition alert, probe-vs-stored) → Unit 9
- R15 (private→public transition: recanonicalize) → Unit 9
- R16 (CI guard against private-name introduction) → Unit 10
- R17 (`fro-bot.yaml` event handler unchanged) → no implementation; documented in Unit 12
- R18 (Renovate dispatch unchanged) → no implementation; data-shape preserved
- R19 (in-repo journal unchanged) → no implementation; covered by App-token scoping
- R20 (operator lookup script `resolve-private.ts`) → Unit 11
- R21 (persona acknowledgment is documentation-only) → Unit 12
- R22 (documentation) → Unit 12
- R23 (test scenarios) → distributed across all units

## Scope Boundaries

- No private wiki infrastructure.
- No redacted/sanitized public-wiki pages.
- No declining of private invitations.
- No auto-purge of git history on visibility transitions (Unit 9 detects and alerts; operator decides remediation).
- No org-wide visibility policies.
- No changes to survey-cadence-and-multi-channel-discovery work.
- No fix for the `[[Note]]` orphan-wikilink content-quality bug.
- No programmatic recovery of canonical owner/name from a redacted entry inside `fro-bot/.github`. Operator looks up via API.

### Deferred to Separate Tasks

- **Tightening `private?` to required in the schema** — same pattern as `discovery_channel` tightening, after one full reconcile cycle. Separate small PR.
- **Tightening `node_id` to required** — Unit 1 ships with backfill (Unit 2's first probe pass populates) and `node_id?` optional during rollout; tightening to required is the same follow-up PR.
- **Full-file leak audit on `main`** — Unit 0 ships an enumeration script that catches what's currently known; a deeper audit (e.g., scanning all historical commits, all workflow runs, all PR comments) is a separate one-shot operation.
- **Wiki-page git-history rewrite for visibility-transition cases** — operator-decided per Unit 9's alert; operational, not in plan scope.

## Context & Research

### Relevant Code and Patterns

- `scripts/schemas.ts` — `RepoEntry` interface, `assertRepoEntry` runtime guard. Loose-then-tight pattern from `discovery_channel`.
- `scripts/reconcile-repos.ts` — `classifyTracked` chokepoint, `fieldProbes` pattern, `node_id` rendering at `1292-1311` and `1335-1337`.
- `scripts/repos-metadata.ts` — pure mutator pattern. v1 modifies all three mutators (`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`) to write redacted form.
- `scripts/commit-metadata.ts` — atomic write to `data` via Git Data API. Mutators receive `unknown`, validate via `assertReposFile`, return fresh top-level object. The 409 retry re-runs the mutator against the new tip — required for the always-redacted-on-write model to remain consistent under concurrent writes.
- `scripts/handle-invitation.ts` — Unit 4 modifies this to read invitation's `private` flag and write redacted entry + redacted commit message.
- `scripts/check-wiki-authority.ts` — exact precedent for Unit 10's CI guard. `gh pr view --json files` for path enumeration; for content scanning, switch to `gh pr diff <n>` (returns unified diff text) and `gh api repos/.../contents/metadata/repos.yaml?ref=data` (returns base64 file content) per repo-research patterns.
- `.github/workflows/main.yaml` — pattern for adding the `check-private-leak` PR-only job alongside `check-wiki-authority`.
- `.github/workflows/survey-repo.yaml` — Unit 6 adds in-workflow gate; switches concurrency group and dispatch inputs to `node_id` form.
- `.github/workflows/poll-invitations.yaml` — Unit 4 modifies the workflow surface to use `node_id` in run names.
- `.github/workflows/social-broadcast.yaml` — Unit 7 adds `private: boolean` input with default `true` (fail-safe).
- `.github/workflows/merge-data.yaml` — Unit 8 adds the wiki-page-block check before `merge-data-pr.ts`.

### Institutional Learnings

- `docs/solutions/best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md` — Unit 1 follows this pattern.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failure-2026-04-18.md` — same family as the probe coercion bug Unit 2 fixes.

### Sibling Plan Coordination

The survey-cadence plan (`docs/plans/2026-05-05-001-feat-survey-cadence-and-multi-channel-discovery-plan.md`) Unit 1 landed in PR #3234. Both plans:

- Modify `RepoEntry` schema with optional fields (loose-then-tight)
- Touch `classifyTracked` dispatch logic
- Extend `summary` counters

**Coordination decision:** This plan ships AFTER cadence Unit 1 lands. Unit 1 of this plan adds `private?` and `node_id` on top of `discovery_channel?` and `next_survey_eligible_at?`. Tightening of all four optional fields is deferred to a single follow-up PR after one full reconcile cycle.

**`classifyTracked` gate ordering**: privacy gate runs FIRST (origin R8), eligibility gate (cadence Unit 2) runs second. A `private: true` entry is skipped regardless of eligibility. Implementation in Unit 5.

### External Verification (during planning)

`origin/data` of `fro-bot/.github` is publicly readable to any unauthenticated git client. Verified `2026-05-04` via `git clone --depth=1 && git fetch origin data:data && git show data:metadata/repos.yaml` (no auth, returns canonical `poly` entry). This forced the always-redacted-everywhere architecture in Unit 3.

## Key Technical Decisions

### KTD-1 — Always-redacted-everywhere

`metadata/repos.yaml` is always redacted for `private: true` entries on both `data` and `main`. Mutators write the redacted form. There is no "redact in transit" lifecycle. The canonical form does not exist anywhere in `fro-bot/.github`.

Redacted entry shape: `owner: '[REDACTED]'`, `name: <node_id>`, with `private: true`, `node_id: <actual>`, and other operational fields preserved. Passes `assertRepoEntry` with no schema changes beyond Unit 1's `private?: boolean` and `node_id` additions.

Rejected alternative: "operator-canonical on `data`, redacted on `main`" via a redaction-step at promotion time. Verified `data` is publicly readable; the model is theater. Operator-canonical lookups happen via the GitHub API in `scripts/resolve-private.ts` (Unit 11), an operator-only read tool.

### KTD-2 — Probe is 5-state with explicit semantics

`reconcile-repos.ts` probe distinguishes:

| State           | Trigger                                                   | Treatment                                          |
| --------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `public`        | API returns `private: false`                                | Write `private: false`                                 |
| `private`       | API returns `private: true`                                 | Write `private: true`                                  |
| `access-lost` | HTTP 404, 451, or 403-with-block-reason body              | **Treat as private** (fail-closed); fire transition alert if prior was `public` |
| `transient`     | HTTP 5xx, network error, rate limit                       | Preserve prior `private` value (sticky)              |
| `malformed`     | HTTP 200 with `private` field absent or non-boolean       | Preserve prior + log structured diagnostic        |

`access-lost` is critically NOT collapsed with `transient`. The asymmetry — preserve prior on transient, fail-closed on lost-access — is what prevents the F3 fail-open path where a previously-public repo flips to private and the probe never sees explicit-true.

### KTD-3 — Workflow-internal gate uses `node_id` inputs, not `owner/repo`

`survey-repo.yaml` (and any other workflow that may dispatch against private repos) takes `node_id` as input, not `owner/repo`. The workflow's first step resolves `node_id` → `owner/repo` via `gh api graphql` with a `node(id: "<node_id>") { ... on Repository { nameWithOwner isPrivate } }` query (App token), AND verifies `isPrivate: false`. If either step fails (GraphQL errors, missing node, or `isPrivate: true`), the workflow aborts.

The `node_id` field stored in `metadata/repos.yaml` is the GitHub GraphQL global node ID (e.g., `R_kgDO...`, returned by `apps.listReposAccessibleToInstallation` and `repos.get` as `node_id`). Resolution requires the GraphQL API — the REST `/repositories/{id}` endpoint takes the numeric *database ID*, not the GraphQL node ID, and returns 404 if given a node ID. All resolution calls in this plan use `gh api graphql -f query='query { node(id: "<node_id>") { ... on Repository { nameWithOwner isPrivate } } }'` and parse `.data.node.nameWithOwner` / `.data.node.isPrivate`.

This eliminates the F2 leak via dispatch input echoes in the public Actions tab. Concurrency group becomes `survey-repo-{node_id}`. Run name becomes `Survey Repo: {node_id}`. The workflow itself only ever sees `owner/repo` after the resolution succeeds (i.e., after the repo is verified public), so internal log lines after the gate may use `owner/repo` freely.

Caller (`reconcile-repos.ts`) constructs the dispatch with `node_id` from the metadata entry. Manual operator dispatch via `gh workflow run` must use `node_id` (documented in the workflow's input description).

### KTD-4 — Mutator path consistency for redacted writes

All mutator paths that write to `metadata/repos.yaml` consult the entry's `private` field and write redacted form when `true`. This includes:

- `addRepoEntry` (called from `handle-invitation.ts`)
- `recordSurveyResult` (called from `record-survey-result.ts`)
- `resetSurveyResult` (called from `reset-survey-status.ts`)

The mutator's input is the canonical entry from the caller (e.g., handle-invitation reads `private` from the invitation API response). The mutator's output is the redacted entry (when `private: true`). This collapses the redaction-vs-write decision into the mutator itself — no separate redaction step.

`assertRepoEntry` accepts both canonical entries (for `private: false`) and redacted entries (sentinel `[REDACTED]` + `node_id`). The string `[REDACTED]` is a normal `string`; the schema doesn't need a special form.

The 409-retry path in `commitMetadata` re-runs the mutator against the new tip. Because the mutator operates on entries by `node_id` lookup (KTD-5) and writes redacted form deterministically, retries are idempotent.

### KTD-5 — `node_id` is the lookup key for redacted entries

`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`, and any future mutator look up entries by `node_id` (not by `owner/name`). For non-private entries, `node_id` is also tracked but lookup may fall back to `owner/name` for backwards compatibility during the migration. After the migration, `node_id` is the primary key.

This change is invisible to public observation — `node_id` is a non-secret GitHub identifier. But it's load-bearing: without it, redacted entries cannot be disambiguated when their owner/name is `[REDACTED]`.

### KTD-6 — CI guard scans added-lines diff with `gh pr diff`

Unit 10's `check-private-leak` job uses `gh pr diff <n>` (returns unified diff text) and `gh api repos/.../contents/metadata/repos.yaml?ref=data` (returns base64 file content of the always-redacted form). Reads `node_id` values from `metadata/repos.yaml`, resolves each to `owner/name` via `gh api graphql` with a `node(id:)` query using a CI-scoped App token. The resolution step suppresses `gh api` stdout (captures into a shell variable, never echoes) and the workflow does NOT enable `ACTIONS_STEP_DEBUG` — both prevent the resolved canonical names from appearing in CI runner logs.

Scans **only added lines** (`^+` in unified diff, excluding `+++` headers). The redaction PR's removed canonical names don't trigger; only newly-introduced names trigger.

Override: PR title prefix `[allow-private-leak]` AND PR author is `marcusrbrown` (operator only). Override is logged to the daily-report broadcast (the bot itself notes operator overrides for transparency).

Failure message: file path identified, name redacted via `node_id` reference, instruction to use `scripts/resolve-private.ts` to look up locally if needed.

### KTD-7 — Existing-leak enumeration is Phase 0, before any other unit

R0's enumeration must complete and the per-surface remediation/acceptance decisions must be made before Units 1-12 ship. Unit 0 is a one-shot operational task with operator decision points; the rest of the plan inherits the post-Unit-0 state.

### KTD-8 — Social broadcast `private` input defaults to `true` (fail-safe)

`social-broadcast.yaml` adds `private: boolean` input with default `true` (NOT required). Reasons:

- Fail-safe: if a future caller forgets to pass `private`, the broadcast skips external posts (Discord, Bluesky) and only fires the in-repo journal step.
- In-flight reusable-workflow versioning: a PR that adds the input but hasn't yet updated all callers can land without breaking in-flight workflow runs that captured the old workflow file.
- Loose-then-tight: tightening to required is a follow-up PR after all callers are confirmed to pass the flag.

## Open Questions

### Resolved During Planning

- **Q1 (existing-leak handling)** → Unit 0 enumerates surfaces and presents a per-surface decision. The plan defers the actual remediation choice to Unit 0's execution; this plan describes the mechanism, not the outcome.
- **Q2 (loose-then-tight tightening timing)** → Deferred to Separate Tasks; same pattern as `discovery_channel`, all four optional fields tighten together.
- **Q3 (`node_id` backfill strategy)** → Unit 2's first probe pass writes `node_id` for all accessible entries; Unit 1 ships `node_id?` optional. Lost-access entries get `node_id` only if they had it stored from a prior probe; otherwise the field stays absent and they remain skipped from dispatch.
- **Q4 (R16 override mechanism)** → KTD-6: `[allow-private-leak]` PR title prefix + operator-only PR author check. The more ceremonious `private-leak-override.yaml` allowlist is deferred until the PR-title approach proves insufficient.
- **Q5 (R12 scope: all `workflow_dispatch` or just survey-repo)** → All survey/wiki/cross-repo workflows that may dispatch against private repos: `survey-repo.yaml`, `poll-invitations.yaml`, and `fro-bot.yaml` (when invoked manually via `workflow_dispatch`). Implementation in Unit 6 (survey-repo), Unit 4 (poll-invitations), Unit 12 (`fro-bot.yaml` doc only — its dispatch payload comes from event payloads, not raw operator inputs).
- **Q6 (`resolve-private.ts` caching)** → No caching in v1. The operator's runtime is the operator's machine; API rate limits are far below operator usage frequency.
- **Q7 (wiki-page redaction in R11: check vs delete)** → Unit 8 ships as a check (merge ceremony blocks if a wiki page exists for a private entry). Operator deletes the page via integrity-alert remediation. Auto-deletion is deferred — the check is sufficient defense-in-depth on top of the Unit 6 dispatch gate that prevents the page from being written in the first place.

### Deferred to Implementation

- **`node_id` resolution failure handling**: when the API returns 404 for a previously-stored `node_id` (repo deleted, transferred, or App lost access), how does Unit 11's `resolve-private.ts` and Unit 10's CI guard behave? Likely: emit a warning, surface `node_id` only, continue. Implementation detail.
- **Exact CI guard match algorithm**: substring case-insensitive vs whole-word vs regex with word-boundary anchors? Default: case-insensitive substring (catches `marcusrbrown/poly`, `MARCUSRBROWN/POLY`, and `MARCUSRBROWN-POLY` slug forms). Tighten if false-positive rate is unacceptable in practice.
- **Daily-report visibility for `summary.skippedPrivate`**: whether the daily-report broadcaster surfaces the count is a future decision, not in scope for this plan.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                         Always-redacted-everywhere model:

  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │ data:metadata/repos.yaml (REDACTED for private; canonical for public)             │
  │ main:metadata/repos.yaml (REDACTED for private; canonical for public)             │
  │   ↑                                                                              │
  │   └──── written by mutators that consult `private` and write redacted form        │
  │         (addRepoEntry, recordSurveyResult, resetSurveyResult)                    │
  └────────────────────────────────────┬─────────────────────────────────────────────┘
                                       │
       ┌──────────────┬───────────────┼─────────────┬──────────────┬─────────────┐
       │              │               │             │              │             │
       ▼              ▼               ▼             ▼              ▼             ▼
  ┌─────────┐    ┌──────────┐  ┌──────────┐  ┌──────────┐   ┌──────────┐  ┌──────────┐
  │reconcile│    │poll-     │  │Survey    │  │social-   │  │merge-data│  │CI: check-│
  │R8: skip │    │invitations│  │ Repo     │  │broadcast │  │R11: block│  │private-  │
  │private  │    │R7: write │  │R6: gate  │  │R9: skip  │  │promotion │  │leak      │
  │ at      │    │redacted  │  │via API on│  │external  │  │if any    │  │R16: scan │
  │classify-│    │entry +   │  │node_id   │  │posts on  │  │knowledge/│  │PR diff   │
  │Tracked  │    │redacted  │  │input;    │  │private   │  │wiki/repos│  │against   │
  │         │    │commit msg│  │5-state   │  │(default  │  │/<owner>--│  │node_id-  │
  │         │    │via R10   │  │error     │  │true,     │  │<name>.md │  │resolved  │
  │         │    │          │  │handling  │  │fail-safe)│  │exists for│  │private   │
  │         │    │          │  │          │  │          │  │a private │  │name list │
  │         │    │          │  │          │  │          │  │entry     │  │          │
  └─────────┘    └──────────┘  └──────────┘  └──────────┘   └──────────┘  └──────────┘

Probe (Unit 2) → 5 states:
  API ──► public / private / access-lost / transient / malformed
                  │            │            │             │
                  └─ write ────┘            │             └─ preserve prior + diagnostic
                                            └─ fail-closed: write private, alert on flip

Continuous detection:
  Unit 9  ──── public→private (probe-vs-stored) ──► integrity alert (node_id only)
  Unit 10 ──── PR diff vs resolved private names  ──► CI fail (allow override via title)

Operator side:
  scripts/resolve-private.ts ──► reads metadata, hits GitHub API with operator PAT
                                  ──► stdout-only mapping: node_id → owner/name
```

## Output Structure

This plan modifies existing files and adds 8 new ones.

```
scripts/
  schemas.ts                         MODIFY (Unit 1: add `private?`, `node_id` fields)
  schemas.test.ts                    MODIFY
  repos-metadata.ts                  MODIFY (Unit 3: redacted-form writes in all mutators)
  repos-metadata.test.ts             MODIFY
  reconcile-repos.ts                 MODIFY (Units 2, 5, 9: 5-state probe, dispatch gate, transition detection)
  reconcile-repos.test.ts            MODIFY
  handle-invitation.ts               MODIFY (Unit 4: read `private` from invitation, write redacted, redacted commit message)
  handle-invitation.test.ts          MODIFY
  record-survey-result.ts            MODIFY (Unit 4: redacted commit message)
  reset-survey-status.ts             MODIFY (Unit 4: redacted commit message)
  enumerate-existing-leaks.ts        CREATE (Unit 0: one-shot enumeration)
  enumerate-existing-leaks.test.ts   CREATE
  check-private-leak.ts              CREATE (Unit 10: CI guard)
  check-private-leak.test.ts         CREATE
  resolve-private.ts                 CREATE (Unit 11: operator lookup script)
  resolve-private.test.ts            CREATE
.github/workflows/
  survey-repo.yaml                   MODIFY (Unit 6: node_id input, in-workflow gate, concurrency group)
  poll-invitations.yaml              MODIFY (Unit 4: node_id in run name)
  social-broadcast.yaml              MODIFY (Unit 7: private input with default true)
  merge-data.yaml                    MODIFY (Unit 8: wiki-page-block check)
  main.yaml                          MODIFY (Unit 10: check-private-leak job)
metadata/
  README.md                          MODIFY (Unit 12: doc all gates, schema, operator script)
knowledge/
  schema.md                          MODIFY (Unit 12: public-only invariant)
persona/
  fro-bot-persona.md                 MODIFY (Unit 12: optional one-sentence reference)
```

## Implementation Units

- [ ] **Unit 0: Enumerate existing leaks and remediate per operator decision**

**Goal:** Enumerate every existing leak surface for currently-tracked private repos (today: only `marcusrbrown/poly`); present operator with per-surface remediate/accept decision; execute the chosen action.

**Requirements:** R0

**Dependencies:** None — this is Phase 0, before any other unit ships.

**Files:**
- Create: `scripts/enumerate-existing-leaks.ts`
- Create: `scripts/enumerate-existing-leaks.test.ts`
- (Operator-decision artifact, no code change): `metadata/README.md` documents the decision per surface.

**Approach:**
- Pure function `enumerateLeaks(privateNodeIds: readonly string[]): LeakSurface[]` returns surfaces grouped by type:
  - **Commit subjects on `main`**: `git log main --grep=<regex>` for each canonical owner/name
  - **Workflow runs**: `gh api /repos/.../actions/runs?status=...` filtered by run name or input parameters
  - **Current `metadata/repos.yaml`**: parse and find entries by `node_id` whose `owner`/`name` are not yet redacted
  - **Wiki pages**: enumerate `knowledge/wiki/repos/*.md` for filenames matching private slugs (currently none)
- CLI entry-point reads `node_id` values from a temporary canonical mapping (Marcus runs `gh api /repos/marcusrbrown/poly` and supplies `node_id` directly), enumerates surfaces, prints a table.
- For each surface, the operator chooses: REMEDIATE (script provides remediation commands) or ACCEPT (script appends an entry to `metadata/README.md` documenting the accepted disclosure).
- Remediation commands the script generates:
  - **Commit subject rewrite**: `git filter-repo --replace-message <expr>` instructions, or `git rebase -i HEAD~N` and amend each commit's subject. Operator runs this manually; the script does NOT auto-rewrite history.
  - **Workflow run deletion**: `gh api -X DELETE /repos/.../actions/runs/<id>` for each leaking run
  - **`metadata/repos.yaml` redaction**: a one-shot PR that sets `private: true` and rewrites `owner`/`name` to redacted form for the affected entries; the PR is explicitly authored by the operator (not the bot) so the integrity check on `data` doesn't fire on the manual rewrite

**Patterns to follow:**
- `scripts/check-wiki-authority.ts` for shape (pure function + CLI + test pattern)

**Test scenarios:**
- Happy path: empty private list → no surfaces enumerated, no decisions needed
- Happy path: one private repo (`poly`) → surfaces enumerated correctly: 2 commits, N workflow runs, 1 metadata entry, 0 wiki pages
- Edge case: a private repo with no leaks → surfaces enumerated as empty per type
- Edge case: malformed `metadata/repos.yaml` → script fails with structured error (does not silently skip)

**Verification:**
- Operator runs `node scripts/enumerate-existing-leaks.ts` for `poly`; output matches the manually-confirmed surfaces from the deepening review (2 commits, 1+ workflow runs, current metadata entry).
- Operator chooses an action per surface; if REMEDIATE, executes the generated commands; if ACCEPT, records the decision in `metadata/README.md`.
- Phase 0 closes when all surfaces have an explicit decision.

---

- [ ] **Unit 1: Schema fields for `private` and `node_id`**

**Goal:** Add optional `private?: boolean` and `node_id?: string` to `RepoEntry`. Loose-then-tight; no runtime behavior change yet.

**Requirements:** R1, R2

**Dependencies:** Unit 0 must complete first (operator-decided remediation may rewrite metadata; schema change goes in clean post-remediation).

**Files:**
- Modify: `scripts/schemas.ts`
- Modify: `scripts/schemas.test.ts`

**Approach:**
- Add `private?: boolean` and `node_id?: string` to `RepoEntry` interface
- Extend `assertRepoEntry`: `private` accepts `undefined` OR `boolean`; `node_id` accepts `undefined` OR non-empty string
- Reject `null`, numbers, empty strings on both fields
- Schema accepts redacted form (`owner: '[REDACTED]'`, `name: <node_id>`) without changes — both are normal strings; `assertRepoEntry` doesn't validate semantics

**Patterns to follow:**
- `discovery_channel?` and `next_survey_eligible_at?` field handling

**Test scenarios:**
- Happy path: entry with `private: true` and `node_id: 'MDEwOlJlcG9zaXRvcnk5MDAwMA=='` is accepted
- Happy path: entry with `private: false` and `node_id` is accepted
- Happy path: entry without either field is accepted (legacy)
- Happy path: redacted entry (`owner: '[REDACTED]'`, `name: 'MDEwOlJlcG9zaXRvcnk5MDAwMA=='`, `private: true`, `node_id: 'MDEwOlJlcG9zaXRvcnk5MDAwMA=='`) validates
- Edge case: `private: null` rejected; `private: 1` rejected; `private: 'yes'` rejected
- Edge case: `node_id: null` rejected; `node_id: ''` rejected; `node_id: 123` rejected

**Verification:**
- `pnpm test scripts/schemas.test.ts` green
- Existing fixtures continue to validate

---

- [ ] **Unit 2: 5-state probe with sticky preservation**

**Goal:** Reconcile probe distinguishes 5 states (public, private, access-lost, transient, malformed) with explicit semantics. Indeterminate responses preserve prior `private` value (sticky); access-lost fails closed.

**Requirements:** R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `scripts/reconcile-repos.ts` (around line 954; `fetchAccessList`; `classifyTracked` reading sites; transition detection plumbing for Unit 9)
- Modify: `scripts/reconcile-repos.test.ts`

**Execution note:** Test-first. Each of the 5 states gets at least one explicit test before the implementation lands.

**Approach:**
- Internal type: `type ProbeResult = {state: 'public'} | {state: 'private'} | {state: 'access-lost', httpStatus: number} | {state: 'transient', httpStatus?: number} | {state: 'malformed'}`
- Probe reads API response and dispatches to one of the 5 states based on HTTP status + body shape
- Merging probe result into entry: `public` → write `private: false`; `private` → write `private: true`; `access-lost` → write `private: true` AND emit transition signal; `transient` → preserve prior; `malformed` → preserve prior + emit diagnostic
- `node_id` is also written from the probe response (unconditional, `node_id` is non-secret)
- Probe credential pinned to fro-bot[bot] App installation token via `apps.listReposAccessibleToInstallation`; documented in `metadata/README.md`

**Patterns to follow:**
- `probeSingleRepo` and `fetchFieldProbes` error-tolerance pattern
- Existing sticky-preservation pattern for `discovery_channel`

**Test scenarios:**
- Happy path: API `{private: true, node_id: 'MDEw...'}` → entry gets `private: true`, `node_id`
- Happy path: API `{private: false, node_id: 'MDEw...'}` → entry gets `private: false`, `node_id`
- Edge case: HTTP 404 → state `access-lost`; entry's `private` becomes `true` (fail-closed); transition signal emitted if prior was `false`
- Edge case: HTTP 451 → state `access-lost`; same fail-closed behavior
- Edge case: HTTP 403 with block-reason body → state `access-lost`; same
- Edge case: HTTP 5xx → state `transient`; entry's prior `private` preserved
- Edge case: HTTP 200 with malformed body (no `private` field, or `private: null`) → state `malformed`; entry's prior preserved; diagnostic logged
- Edge case: probe throws → existing behavior preserved (treated as transient; entry retains prior)
- Edge case: entry has no prior `private` AND probe is access-lost → entry gets `private: true` (fail-closed default for access-lost)
- Edge case: entry has no prior `private` AND probe is transient/malformed → entry remains without `private` field (sticky preserves "absent")
- Integration: full reconcile run with mixed responses produces correct per-entry `private` and `node_id` values across all 5 states

**Verification:**
- New tests pass; existing tests pass
- After one production reconcile run, every accessible entry on `data` has both `private` and `node_id` populated

---

- [ ] **Unit 3: Always-redacted writes in mutators**

**Goal:** Modify all three mutators (`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`) to write redacted form for `private: true` entries. The redacted form (`owner: '[REDACTED]'`, `name: <node_id>`, `private: true`, `node_id: <actual>`) is what lands on `data` immediately. No "redact in transit" lifecycle.

**Requirements:** R5

**Dependencies:** Unit 1 (schema), Unit 2 (probe must populate `private` and `node_id`)

**Files:**
- Modify: `scripts/repos-metadata.ts`
- Modify: `scripts/repos-metadata.test.ts`

**Execution note:** Test-first. The mutators' contract change is the highest-risk part of this plan — each mutator gets RED tests for the redacted-form output before implementation.

**Approach:**
- Each mutator inspects the input's `private` field. If `private: true`, the mutator writes the entry with `owner: '[REDACTED]'`, `name: input.node_id`, and the original `private`/`node_id` fields preserved. Other operational fields (`onboarding_status`, `discovery_channel`, `last_survey_at`, etc.) are preserved as-is.
- If `private: false` (or undefined), the mutator writes the canonical form as today.
- Mutators look up entries by `node_id` (KTD-5). If a redacted entry already exists with the matching `node_id`, the mutator updates it in place (no duplicate).
- 409 retry: the re-run reads the current `data` tip (which contains redacted form), the mutator's logic still produces redacted form deterministically (same `private` flag, same `node_id`), so retries are idempotent and convergent.

**Patterns to follow:**
- Existing `addRepoEntry`/`recordSurveyResult`/`resetSurveyResult` pure-mutator structure
- `commit-metadata.ts:179-181` serialized-form short-circuit handles no-ops automatically

**Test scenarios:**
- Happy path: `addRepoEntry({private: false, node_id, owner, name})` → entry written with full canonical
- Happy path: `addRepoEntry({private: true, node_id, owner, name})` → entry written with `owner: '[REDACTED]'`, `name: node_id`, `private: true`, `node_id`
- Happy path: `recordSurveyResult` on canonical entry (private: false) → updates in place, canonical preserved
- Happy path: `recordSurveyResult` on redacted entry (private: true) → updates in place, redacted preserved
- Happy path: `resetSurveyResult` on redacted entry → fields zeroed, redacted form preserved
- Edge case: mutator called with input claiming `private: true` but missing `node_id` → throws explicit error (cannot redact without lookup key)
- Edge case: 409 retry with concurrent canonical-write race → final state is whichever write committed last; retry produces the same redacted output for the same `private`/`node_id` pair (idempotent)
- Edge case: `addRepoEntry` for an existing redacted entry (same `node_id`) → updates in place, no duplicate created
- Edge case: `addRepoEntry` for an existing canonical entry whose probe just flipped to `private: true` → entry transitioned to redacted form (this is the public→private transition path; Unit 9 fires the alert separately)
- Integration: full reconcile run that touches multiple entries (mix of public/private) produces correct per-entry shape on `data`

**Verification:**
- New tests pass
- Manual fixture: a `metadata/repos.yaml` with mixed entries round-trips through mutators correctly
- The verifiable test from origin SC1: after one reconcile run, `git show data:metadata/repos.yaml | grep -i poly` returns nothing

---

- [ ] **Unit 4: Poll-invitations gate and autonomous commit-message redaction**

**Goal:** `handle-invitation.ts` reads the invitation's `private` flag and writes a redacted entry when private. All autonomous commit messages from `addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`, and any future mutator path use `node_id` (not `owner/repo`) for private repos.

**Requirements:** R7, R10

**Dependencies:** Units 1, 3

**Files:**
- Modify: `scripts/handle-invitation.ts`
- Modify: `scripts/handle-invitation.test.ts`
- Modify: `scripts/record-survey-result.ts`
- Modify: `scripts/reset-survey-status.ts`
- Modify: `.github/workflows/poll-invitations.yaml` (run name uses `node_id` for in-flight log surface)

**Approach:**
- `handle-invitation.ts`: extract `private` and `node_id` from the invitation API response; pass to `addRepoEntry` so the redacted form is written.
- Commit messages: when an entry is `private: true`, the commit message uses `chore(metadata): accept invitation <node_id>` instead of `chore(metadata): add <owner>/<repo> from invitation polling`. Same pattern for survey-result and reset paths.
- `poll-invitations.yaml` job name: `Poll invitations: <node_id>` for the matched invitation (instead of `Poll invitations: <owner>/<repo>`). The dispatch input echo at API-call time cannot be suppressed; mitigation is that the workflow only ever sees `node_id` post-resolution.

**Patterns to follow:**
- Existing commit-message structure in `addRepoEntry`/`recordSurveyResult`/`resetSurveyResult`
- The reusable redaction helper: a small pure function `commitSubjectFor(entry: RepoEntry, kind: 'add' | 'survey' | 'reset'): string` that consults `entry.private` and emits the appropriate form

**Test scenarios:**
- Happy path: invitation for public repo → entry written with canonical, commit message uses `owner/repo`
- Happy path: invitation for private repo → entry written redacted, commit message uses `node_id`
- Happy path: `recordSurveyResult` for redacted entry → commit message uses `node_id`
- Happy path: `recordSurveyResult` for canonical entry → commit message uses `owner/repo`
- Edge case: invitation API response missing `node_id` → script fails explicitly (cannot proceed without the key)
- Edge case: invitation for private repo whose API response is malformed → script logs a structured error and skips the invitation (does not write a half-redacted entry)
- Integration: full poll-invitations run with mixed public/private invitations produces correct redacted/canonical entries and commit messages

**Verification:**
- New tests pass
- A simulated invitation for a private repo produces a commit on `data` with `node_id`-only subject
- `git log data --format='%s'` after the test contains no `owner/repo` references for private repos

---

- [ ] **Unit 5: Reconcile dispatch gate (defense in depth, ordered)**

**Goal:** Reconcile skips Survey Repo dispatch for entries where `private !== false`. Skip happens inside `classifyTracked` BEFORE the eligibility gate (cadence Unit 2). `summary.skippedPrivate` aggregate counter; no per-repo names in any public surface.

**Requirements:** R8, R13

**Dependencies:** Unit 2 (probe populates `private`)

**Files:**
- Modify: `scripts/reconcile-repos.ts` (`classifyTracked`, `ReconcileSummary`, JSON output, commit message rendering)
- Modify: `scripts/reconcile-repos.test.ts`

**Approach:**
- In `classifyTracked`: privacy gate runs FIRST. If `entry.private !== false`, skip and increment `summary.skippedPrivate`. The eligibility gate (cadence) runs only on entries that passed the privacy gate.
- Skipped entries do NOT update `last_survey_at` or `last_survey_status`
- `summary.skippedPrivate` is exposed in JSON output; commit messages may include the count (`+N skipped private`) but never names

**Patterns to follow:**
- Existing `summary.unchanged`, `summary.dispatched` counters
- `formatCommitMessage` pattern for "+N migrated" optional inclusion

**Test scenarios:**
- Happy path: `private: false` entry passes privacy gate, evaluated by eligibility gate
- Edge case: `private: true` entry skipped at privacy gate before reaching eligibility gate
- Edge case: `private: undefined` entry skipped (sticky)
- Edge case: 13 onboarded public repos + 1 private repo with cap=12 → 12 public dispatched; private skipped (proves no displacement)
- Edge case: gate ordering — private repo with `next_survey_eligible_at` in the past (eligible) is still skipped (privacy first)
- Happy path: all entries public → `summary.skippedPrivate: 0`; commit message omits the counter
- Happy path: at least one private skip → commit message includes `+N skipped private`; no names

**Verification:**
- New tests pass
- Simulated full reconcile run with mixed entries dispatches only public ones
- JSON output structure unchanged except for new `skippedPrivate` field

---

- [ ] **Unit 6: Survey Repo workflow gate with `node_id` inputs**

**Goal:** `survey-repo.yaml` accepts `node_id` (not `owner/repo`) as input. First job step resolves `node_id` → `owner/repo` via App token AND verifies `private: false`. Aborts on any error or `private: true`. Concurrency group, run name, and dispatch input echoes use `node_id`.

**Requirements:** R6, R11 (by construction), R12

**Dependencies:** Unit 1 (schema for `node_id`); Unit 5 (caller passes `node_id` from metadata)

**Files:**
- Modify: `.github/workflows/survey-repo.yaml`
- Modify: `scripts/reconcile-repos.ts` (the dispatch call site passes `node_id` instead of `owner/repo`)
- Modify: `scripts/reconcile-repos.test.ts` (assert dispatch payload shape)

**Approach:**
- Workflow input changes: `owner` and `repo` → `node_id` (single input). Documentation in input description: "GitHub repository node_id; resolves to owner/repo internally after privacy verification"
- First step `🔒 Resolve and verify` calls `gh api graphql -f query='query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner isPrivate } } }' -f id="${{ inputs.node_id }}"` (App token), parses `.data.node`, and:
  - On 200 with `private: false`: exports `owner` and `repo` to subsequent steps via `$GITHUB_OUTPUT`
  - On 200 with `private: true`: aborts with a `node_id`-only failure message
  - On non-200: aborts with structured error (HTTP status, no name)
- Subsequent steps reference `${{ steps.resolve.outputs.owner }}` and `${{ steps.resolve.outputs.repo }}` instead of input parameters
- Concurrency group: `survey-repo-${{ inputs.node_id }}`
- Run name: `Survey Repo: ${{ inputs.node_id }}` (workflow run-name expression)
- Caller (`reconcile-repos.ts`'s `dispatchSurvey`) constructs `inputs: { node_id: entry.node_id }` instead of `inputs: { owner: entry.owner, repo: entry.name }`

**Patterns to follow:**
- Existing first-step `gh api` invocation in `survey-repo.yaml`
- Step output via `$GITHUB_OUTPUT` from existing workflows

**Test scenarios:**
<!-- Workflow integration; tests describe expected behavior. -->
- Happy path: dispatched against a public repo's `node_id` → resolves, gate passes, agent runs
- Happy path: dispatched against a private repo's `node_id` → gate aborts; agent does NOT run; failure message contains only `node_id`
- Edge case: dispatched against a non-existent `node_id` → gate aborts (404); failure message identifies the `node_id`
- Edge case: dispatched against a `node_id` for a repo the App lost access to → gate aborts (403/404); failure message uses `node_id`
- Edge case: rate-limited App token → gate aborts (5xx); failure message uses `node_id`
- Verification: a manual `gh workflow run survey-repo.yaml -f node_id=...` against a private repo's `node_id` produces a failed run with no leak in run name, log lines, or step summaries
- Verification: caller's dispatch payload from `reconcile-repos.ts` only ever contains `node_id`, never `owner/repo` (test asserts the mock dispatch arguments)

**Verification:**
- `actionlint` passes
- Manual test as described
- Run-name and concurrency-group public surfaces show `node_id` only

---

- [ ] **Unit 7: `social-broadcast` privacy-aware with fail-safe default**

**Goal:** `social-broadcast.yaml` accepts a `private: boolean` input with default `true` (NOT required). Discord and Bluesky steps skip when `private: true`; journal step always runs.

**Requirements:** R9

**Dependencies:** None

**Files:**
- Modify: `.github/workflows/social-broadcast.yaml`

**Approach:**
- Input definition: `private: type: boolean, required: false, default: true`
- Discord step `if:` extends to `inputs.discord_message != '' && inputs.private != true`
- Bluesky step `if:` extends to `inputs.bluesky_text != '' && inputs.private != true`
- Journal step unchanged (in-repo, inherits visibility)
- Update existing caller (`survey-repo.yaml`) to pass `private: false` explicitly when known to be public; if the workflow gate (Unit 6) verified the repo is public before reaching the broadcast call, the caller passes `private: false` and external posts run

**Patterns to follow:**
- Existing `inputs.discord_message != ''` `if:` clause structure

**Test scenarios:**
- Happy path: caller passes `private: false` → Discord and Bluesky run; journal runs
- Edge case: caller passes `private: true` → Discord and Bluesky skipped; journal runs
- Edge case: caller omits `private` input → default `true` applies; Discord and Bluesky skipped (fail-safe)
- Verification: in-flight workflow runs that captured the old workflow file still execute correctly under the new contract (default `true` covers them safely, even if external posts that should have fired are skipped — operator can re-trigger)

**Verification:**
- `actionlint` passes
- A test broadcast with `private: true` produces no Discord/Bluesky output

---

- [ ] **Unit 8: Wiki-page block in merge ceremony**

**Goal:** `merge-data.yaml` adds a check before `merge-data-pr.ts` that scans `knowledge/wiki/repos/` on `data` for any filename matching a private entry's pre-redaction slug or `node_id`-based slug. Blocks the PR if any private wiki page is found.

**Requirements:** R11

**Dependencies:** Unit 1 (schema), Unit 3 (mutators write redacted)

**Files:**
- Modify: `.github/workflows/merge-data.yaml`
- Create: `scripts/check-wiki-private-presence.ts`
- Create: `scripts/check-wiki-private-presence.test.ts`

**Approach:**
- New script reads `metadata/repos.yaml` from `data`, extracts `node_id` values for `private: true` entries, and scans `knowledge/wiki/repos/` for filenames matching either the canonical slug pattern (`<owner>--<name>.md` resolved via `gh api graphql` `node(id:)` query, IF the repo is still accessible) OR a `node_id`-prefixed slug (in case future surveys ever produce them, though the current convention is owner-name)
- Match found → exit with structured error identifying the wiki page path; the error message uses `node_id` references
- The check is purely defensive; with Unit 6's dispatch gate, the wiki page should never be written in the first place. This is the F9 defense-in-depth that catches anything that slips past the dispatch gate.

**Patterns to follow:**
- `scripts/check-wiki-authority.ts` shape

**Test scenarios:**
- Happy path: no private wiki pages → check passes
- Edge case: wiki page exists for a private repo (contrived test fixture) → check fails with structured error
- Edge case: private entry's `node_id` resolves to a deleted/transferred repo (404) → check skips that entry with a warning (cannot resolve to verify)
- Edge case: wiki directory empty → check passes

**Verification:**
- New tests pass
- A manual `merge-data.yaml` dispatch against a `data` branch with a contrived private wiki page fails before opening the merge PR

---

- [ ] **Unit 9: Visibility-transition detection (probe-vs-stored)**

**Goal:** Reconcile fires a `reconcile:visibility-transition` integrity-alert issue when the probe observes a tracked repo's stored `private` flag flip from `false` to `true` (including via `access-lost`). Detection compares probe-vs-stored, not probe-vs-prior-probe. Private→public transitions trigger recanonicalization via the next mutator write.

**Requirements:** R14, R15

**Dependencies:** Units 1, 2, 3

**Files:**
- Modify: `scripts/reconcile-repos.ts` (transition detection inside the probe loop)
- Modify: `scripts/reconcile-repos.test.ts`

**Approach:**
- Inside the probe's per-entry merge step: read the entry's stored `private` value (from `data:metadata/repos.yaml` parsed at run start), compare to the probe result.
- `false → true` (or `false → access-lost`): emit transition event into the issue queue
- Issue title: `[INTEGRITY] Visibility transition for <node_id>`
- Issue body: identifies `node_id`, lists wiki page slugs that may need manual review (uses canonical owner/name from the probe response IF still accessible, otherwise `node_id` only), provides remediation guidance
- `true → false`: no integrity alert; the next mutator write rewrites the entry to canonical form (KTD-4 plus the redaction-or-canonical decision happens at every mutator call)
- Auto-close: NO. Manual close.

**Patterns to follow:**
- Existing integrity-alert issue creation pattern (`INTEGRITY_ALERT_LABEL`)
- `renderPerRepoIssue` and `renderRollupIssue` for `node_id`-only public surfaces

**Test scenarios:**
- Happy path: stored `private: false`, probe returns `private: true` → transition issue queued
- Happy path: stored `private: true`, probe returns `private: true` → no transition (sticky)
- Happy path: stored `private: false`, probe returns `private: false` → no transition
- Edge case: stored `private: true`, probe returns `private: false` → no transition issue; entry is recanonicalized on next mutator write
- Edge case: stored `private: undefined` (newcomer), probe returns `private: true` → no transition issue (initial categorization, not transition; fixed in Unit 3 logic alone)
- Edge case: stored `private: false`, probe returns `access-lost` → transition issue queued (access-lost treated as private)
- Edge case: probe is `transient` → no transition; sticky preservation
- Edge case: rapid flip within one cycle (tested via mocked sequential probe responses) → detection uses stored state at probe time, so the rapid-flip case produces correct behavior (whatever the probe returned at probe time becomes the new stored state)
- Verification: issue title contains `node_id`, not `owner/repo`; body uses `node_id` references

**Verification:**
- New tests pass
- Simulated reconcile run on a fixture with one transitioned entry produces exactly one integrity-alert issue with `node_id`-only title

---

- [ ] **Unit 10: CI guard against private-name introduction**

**Goal:** New CI check on `fro-bot/.github` runs on every PR to `main`. Reads `node_id` values from `data:metadata/repos.yaml`, resolves each to `owner/name` via the GitHub API, then scans the PR's added-lines diff for any string match. Override mechanism via PR title prefix.

**Requirements:** R16

**Dependencies:** Units 1, 2

**Files:**
- Create: `scripts/check-private-leak.ts`
- Create: `scripts/check-private-leak.test.ts`
- Modify: `.github/workflows/main.yaml`
- Modify: `.github/settings.yml` (add required status check)

**Execution note:** Test-first.

**Approach:**
- Pure function `checkPrivateLeak(privateNames: readonly string[], diff: string, override: OverrideContext): GuardResult` parses unified diff, scans only `^+` lines (excluding `+++` headers), case-insensitive substring match
- CLI entry-point:
  - Reads PR context from `GITHUB_EVENT_PATH`
  - Extracts PR title and author for override evaluation
  - Fetches `metadata/repos.yaml` from `data` via `gh api repos/.../contents/metadata/repos.yaml?ref=data --jq .content` (base64-decoded)
  - Extracts `node_id` values for `private: true` entries
  - Resolves each `node_id` to `owner/name` via `gh api graphql -f query='query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner } } }' -f id=<node_id>` (App token via `GH_TOKEN`); captures stdout into a variable to keep canonical names out of step logs, and the workflow does NOT set `ACTIONS_STEP_DEBUG`
  - Fetches PR diff via `gh pr diff <prNumber>`
  - Calls the pure function; on failure, formats error message (file paths only, no name echo)
  - Override: PR title starts with `[allow-private-leak]` AND PR author is `marcusrbrown` → guard passes with a logged warning + side-effect: post a comment on the PR via `gh api` noting the override (transparency)

**Patterns to follow:**
- `scripts/check-wiki-authority.ts` shape, CLI structure, `GuardResult` pattern
- `gh pr diff <n>` for content scanning (not `gh pr view --json files`, which is path-only)

**Test scenarios:**
- Happy path: PR diff contains no private names → guard passes
- Happy path: PR diff introduces a private repo's owner/name in a wiki page → guard fails with file path identified, name not echoed
- Happy path: PR is the redaction PR (only removes canonical names, no additions) → guard passes (added-lines-only scope)
- Edge case: PR diff is empty → guard passes (no-op)
- Edge case: PR diff includes a private repo's `node_id` → guard passes (`node_id` not scanned)
- Edge case: `metadata/repos.yaml` on `data` has no private entries → guard passes regardless of diff content
- Edge case: case sensitivity — diff contains `MARCUSRBROWN/POLY` → guard fails (case-insensitive match)
- Edge case: PR diff modifies `metadata/repos.yaml` to flip `private: true → false` AND introduces the canonical name elsewhere → guard fails (the name addition triggers regardless of the metadata flip)
- Edge case: override — PR title starts with `[allow-private-leak]` and author is `marcusrbrown` → guard passes with logged warning and PR comment
- Edge case: override — PR title starts with `[allow-private-leak]` but author is `fro-bot[bot]` (not operator) → guard does NOT honor override; fails normally
- Edge case: comments-then-removed scenario (PR initially had a private name in a code comment, comment was removed in a later push) → the removed comment is not in the current PR head's diff against base; guard passes for the current state. Note: the GitHub PR UI's history may still show the removed content; documented limitation.
- Edge case: PR introduces a comment containing a private name → guard fails (substring match doesn't care about comment vs code)

**Verification:**
- `pnpm test scripts/check-private-leak.test.ts` green
- A contrived PR introducing a private name fails the new CI check
- A normal PR not touching private names passes
- `actionlint` passes on `main.yaml`
- Required status check enforces the guard at branch protection level

---

- [ ] **Unit 11: Operator lookup script `resolve-private.ts`**

**Goal:** Operator-only script reads `metadata/repos.yaml` and resolves `node_id` values to `owner/name` via the GitHub API. Stdout-only output. Provides the lookup convenience that YAML-grep used to provide for non-private entries.

**Requirements:** R20

**Dependencies:** Unit 1 (schema)

**Files:**
- Create: `scripts/resolve-private.ts`
- Create: `scripts/resolve-private.test.ts`

**Approach:**
- Pure function `resolvePrivateEntries(file: ReposFile, resolver: NodeIdResolver): Promise<ResolvedEntry[]>` returns array of `{node_id, owner, name, status}` where `status` is `'resolved' | 'access-lost' | 'error'`
- CLI: reads `metadata/repos.yaml` from current directory (or path argument), invokes resolver via `gh api graphql -f query='query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner } } }' -f id=<node_id>` using `GH_TOKEN` environment variable (operator's PAT), writes table to stdout
- Output is stdout-only; never writes to a file in the repo; `metadata/repos.yaml` is read-only
- Documented in `metadata/README.md` as an operator tool; not invoked by any workflow

**Patterns to follow:**
- Existing CLI structure in scripts that expose an `import.meta.url === \`file://${process.argv[1]}\`` guard
- `gh api` invocation patterns

**Test scenarios:**
- Happy path: file with mixed public/private entries → output table includes only `private: true` entries with resolved owner/name
- Happy path: all `private: false` entries → output empty (nothing to resolve)
- Edge case: `node_id` resolves to 404 (repo deleted) → entry's status is `access-lost`; output includes `node_id` and status
- Edge case: rate-limited resolver → script retries with backoff; if exhausts retries, output includes `error` status for affected entries
- Edge case: `GH_TOKEN` not set → script fails with structured error (operator must provide credential)
- Verification: script never writes to the working tree

**Verification:**
- `pnpm test scripts/resolve-private.test.ts` green
- Manual run produces a table that the operator can use to map `node_id`s back to repo names

---

- [ ] **Unit 12: Documentation**

**Goal:** Document the privacy posture, every gate, the schema fields, the operator tool, and the existing-leak handling decision (from Unit 0) across the relevant project docs.

**Requirements:** R21, R22

**Dependencies:** Units 0-11 land first

**Files:**
- Modify: `metadata/README.md`
- Modify: `knowledge/schema.md`
- Modify: `persona/fro-bot-persona.md` (optional one-sentence reference)

**Test expectation:** none — pure documentation. Verified by manual review and lint.

**Approach:**
- `metadata/README.md`: new "Privacy posture" section covering the architecture (always-redacted-everywhere), the schema fields (`private`, `node_id`), each gate (R5-R16 mapping to Units 3-10), the operator tool (Unit 11), and the existing-leak handling decision per surface (operator-completed in Unit 0)
- `knowledge/schema.md`: one sentence in the introduction noting the public-only invariant
- `persona/fro-bot-persona.md`: optional one-sentence reference (NOT a control)

**Patterns to follow:**
- Existing `metadata/README.md` section structure
- Existing `knowledge/schema.md` voice and brevity

**Verification:**
- Markdownlint passes (or honors existing doc-exclusion globs)
- A reader of `metadata/README.md` can describe the privacy posture and where each gate lives without reading the plan

## System-Wide Impact

- **Interaction graph:** The privacy gate touches reconcile (probe + dispatch decision), Survey Repo workflow (gate + node_id input), Poll-invitations workflow (gate + node_id), social-broadcast (private input), merge-data (wiki-page block), and CI (private-leak guard + required status). Six surfaces.
- **Error propagation:** Probe failures flow through 5-state classification with explicit semantics. Survey Repo gate failure aborts with `node_id`-only message. Mutator failures propagate through `commitMetadata` 409 retry; the redacted-form contract is idempotent. CI guard failures fail the PR check.
- **State lifecycle:** Always-redacted-everywhere is a single-state model. No two-form lifecycle; no transit window. Mutators write final form directly. The 409 retry re-runs the mutator against the new tip; with `node_id` lookup and deterministic redacted output, retries converge.
- **API surface parity:** Internal type changes (`ReconcileSummary.skippedPrivate`, `ProbeResult` discriminated union) are confined to `fro-bot/.github`. No external API contract changes.
- **Integration coverage:**
  - Workflow-internal gate (Unit 6) requires manual dispatch test on a fixture private repo
  - Mutator path consistency (Unit 3) requires integration test that drives a full reconcile cycle through the I/O shell
  - CI guard (Unit 10) requires a contrived PR that introduces a private name AND a control PR that doesn't
  - Existing-leak enumeration (Unit 0) is operationally verified, not test-suite verified
- **Unchanged invariants:**
  - `fro-bot.yaml` PR review and event-handler logic is unchanged (R17). The agent's per-repo App installation token already scopes outputs to the target repo's visibility.
  - `dispatch-renovate.ts` is unchanged (R18). `metadata/renovate.yaml` is auto-discovered fro-bot org repos; collab repos are never candidates regardless of visibility.
  - In-repo journal is unchanged (R19). Cross-repo journal posts in `fro-bot/.github`'s `knowledge/log.md` are governed by R5 (mutator redaction) + R10 (commit message) + R16 (CI guard).
  - The wiki authority guard (`scripts/check-wiki-authority.ts`) is unchanged. It enforces "fro-bot identity only writes to guarded paths"; the privacy guard is orthogonal.

## Risks & Dependencies

| Risk                                                                                                                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit 0 enumeration may miss a leak surface (e.g., a forgotten archive workflow run, a comment in an unrelated PR).**                                                                                                                                          | Document the enumeration script's coverage in `metadata/README.md`. The operator can re-run the script periodically as new surfaces are identified. The full-file audit on `main` (deferred) catches deeper leaks.                                                |
| **Probe credential rotation changes visibility semantics.**                                                                                                                                                                                                     | KTD-2 documents the credential pinning. Any future rotation requires updating both the workflow and `metadata/README.md`. Unit 12 makes this explicit.                                                                                                            |
| **In-flight reusable workflow runs may break during Unit 7 deployment.**                                                                                                                                                                                        | Default `private: true` on `social-broadcast` is the fail-safe (KTD-8). In-flight runs that captured the old workflow file get the safe default; external posts that should have fired are skipped, but no leak occurs.                                          |
| **`node_id` resolution failure for a repo that's been deleted/transferred.**                                                                                                                                                                                    | Unit 9's `access-lost` state and Unit 11's `access-lost` status handle this gracefully. The CI guard (Unit 10) skips entries it can't resolve with a logged warning.                                                                                              |
| **Operator's `[allow-private-leak]` override mechanism becomes a backdoor.**                                                                                                                                                                                    | The override requires both a PR title prefix AND operator authorship. The override action is logged to a daily-report broadcast (transparency). If the override is used frequently, the false-positive rate is too high — the guard's match algorithm needs tuning. |
| **Mutator redaction-on-write contract has a sequencing bug we missed.**                                                                                                                                                                                         | Unit 3's test scenarios cover the 9-row matrix of (canonical/redacted) × (canonical/redacted) inputs. The 409 retry path has a dedicated integration test.                                                                                                          |
| **`gh api graphql` `node()` lookup rate-limit during reconcile or CI guard.**                                                                                                                                                                                   | Existing rate-limit handling in `gh api` calls (retry + backoff). Worst case: probe gets `transient` state and preserves prior; CI guard fails with "rate-limited, retry the PR" message — a transient inconvenience, not a leak.                                  |
| **Schema migration: adding `node_id` as required for new entries while existing entries lack it.**                                                                                                                                                              | Unit 1 ships `node_id?` optional. Unit 2's first probe pass populates `node_id` for all accessible entries. Tightening to required is deferred to a follow-up PR.                                                                                                  |
| **Sibling cadence plan and this plan touch `classifyTracked` simultaneously.**                                                                                                                                                                                  | Unit 1 of this plan rebases on cadence Unit 1. Gate ordering (privacy first, then eligibility) is specified in Unit 5.                                                                                                                                              |

## Documentation / Operational Notes

- **Phase 0 must complete before any code change.** Unit 0 enumerates leaks and the operator decides per-surface remediation. The plan's success criteria (especially SC1) depend on this decision. If acceptance is chosen, document each accepted surface in `metadata/README.md` with a justification; if remediation is chosen, the operator runs the generated commands manually before Unit 1 lands.
- **Unit 2 + Unit 3 ship together** in the same PR. Unit 3's redacted-form mutator needs Unit 2's probe to populate `private` and `node_id`; Unit 2's probe writes via the mutator, so the mutator must write redacted form on the first probe pass.
- **Unit 4 ships in the same PR as Units 2+3.** The commit-message redaction for autonomous paths must land before any new autonomous write surfaces another leak.
- **Unit 6 ships AFTER Units 1-5.** Survey Repo dispatch from `reconcile-repos.ts` must use `node_id` inputs (Unit 6 caller-side change), which requires `node_id` to be populated (Unit 2). Manual operator dispatches must use `node_id` after Unit 6 lands.
- **Unit 0 → 1+2+3+4 → 5 → 6 → 7+8 → 9 → 10 → 11 → 12** is the recommended sequence. Units 7, 8, 11 can ship in parallel after their dependencies; Unit 12 is last.
- **The probe credential is the fro-bot[bot] App installation token**, not `FRO_BOT_POLL_PAT`. Documented in `metadata/README.md`.
- **The CI guard (Unit 10) does NOT catch:**
  - Pre-existing leaks already on `main` (Unit 0 handles)
  - Names introduced via direct push to `data` (no PR check) — mitigated by Unit 3's mutator-level redaction
  - Names in commit messages or PR bodies (only file diffs scanned) — mitigated by Unit 4 for autonomous paths; operator-authored messages are documented as a limitation in `metadata/README.md`
  - Names visible in the GitHub PR UI's "Files Changed" tab during the PR's open lifetime, even if the PR fails CI — documented limitation
- **Daily report visibility:** `summary.skippedPrivate` will appear in JSON. Whether the daily-report broadcaster surfaces the count is a future decision, not in scope for this plan.
- **`marcusrbrown/poly`** continues to be the trigger repo. Until Unit 0 remediation completes (or acceptance is documented), the `[[Note]]` orphan-wikilink content-quality bug continues to crash survey runs harmlessly. After Unit 6 lands, those failures move from the wiki-ingest content-quality bug to the workflow-internal gate (private-repo abort).

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-05-private-repo-handling-requirements.md`
- **Sibling plan:** `docs/plans/2026-05-05-001-feat-survey-cadence-and-multi-channel-discovery-plan.md` (status: active)
- **Migration pattern:** `docs/solutions/best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md`
- **Related learning:** `docs/solutions/runtime-errors/autonomous-pipeline-silent-failure-2026-04-18.md` (probe coercion bug family)
- **Reference implementations:**
  - `scripts/reconcile-repos.ts:1292-1311` and `1335-1337` — `node_id` rendering for public-facing issue bodies
  - `scripts/check-wiki-authority.ts` — CI-guard shape for Unit 10
  - `scripts/repos-metadata.ts` — pure mutator pattern for Unit 3
- **Verified during planning:** `origin/data` of `fro-bot/.github` is publicly readable to any unauthenticated git client (forced the always-redacted-everywhere architecture)
- **Trigger:** Survey Repo run 25395917616 (`marcusrbrown/poly`) failed on `[[Note]]` orphan wikilink (content-quality bug, separate from this plan)
