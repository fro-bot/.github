---
title: "feat: repository lifecycle actions: archive, unarchive and declared rename"
type: feat
status: active
date: 2026-11-15
origin: docs/brainstorms/2026-11-15-repo-lifecycle-archive-and-declared-rename-requirements.md
---

# feat: repository lifecycle actions: archive, unarchive and declared rename

## Overview

The operator rename workflow becomes a repository lifecycle workflow. Phase 1 adds `archive` and `unarchive`: a tracked public repository gets a named `archived` state, its page is marked in place, active jobs skip it, and the privacy gates keep protecting it. Phase 2 adds `declare-rename`: the operator records a new name, and when GitHub shows exactly that name on the same node, reconcile starts the workflow, which applies the rename and leaves a redirect from the old page address.

## Problem Frame

Archiving and renaming are noticed after the fact and handled defensively (see origin: `docs/brainstorms/2026-11-15-repo-lifecycle-archive-and-declared-rename-requirements.md`). An archived repository becomes a redacted `lost-access` row, which blocked every promotion on 2026-11-15. A rename pauses surveys until the operator dispatches a workflow, and the old page address then returns 404.

Research for this plan corrected three assumptions in the origin:

- There are three leak scans, not two: the per-PR scan, the promotion scan, and `scanPrivateLeak` in the published package (`packages/wiki-write-core/src/private-leak-adapter.ts`).
- The dashboard is not a constraint. At its deployed tag it never validates a row's state, never writes the registry, and keeps unknown frontmatter keys on save. No dashboard release and no gate-contract bump are needed.
- The site writes a redirect at exactly the alias text. The 20 pages that carry bare aliases today redirect from the site root; their old page addresses return 404.

## Requirements Trace

Archive (phase 1):

- R1, R7. One dispatch archives a tracked public repository, before or after the GitHub archive. Unit 6.
- R2. Named `archived` state that persists. Units 1, 4.
- R3, R4. Page marked in place; the index page groups archived pages. Units 5, 6.
- R5, R6, R11. Active jobs skip; passive readers keep; surveys refused, including one in flight. Unit 2.
- R8, R9. Reconcile leaves the row alone, redacts only when GitHub shows it private, never un-redacts. Unit 4.
- R10. Every leak scan checks archived repositories live. Unit 3.
- R12. Edits and repair keep the marker; a redacted row's page cannot be edited. Units 3, 5.
- R21, R22, R27. Refusals and the row with no node ID. Unit 6.
- R23. Schema on `main` before any row carries the state. Units 1-5 precede Unit 6.
- R24. `copiloting` is the first live use. Unit 7.
- R25. `unarchive`. Unit 6.

Declared rename (phase 2):

- R13, R14, R19, R27. Declare, replace, cancel, collisions. Unit 8.
- R16, R17, R20. Apply in one commit; redirect from the old page address; the operator path gets the redirect too. Unit 9.
- R15, R18, R19. Reconcile detects the exact match, starts the workflow, reports. Unit 10.
- R26. Existing old-slug aliases gain a working redirect. Unit 11.

## Scope Boundaries

- Owner transfers stay detected and blocked.
- Renaming an archived repository.
- A dashboard control, or asking Fro Bot to run an action.
- Rewriting old names in prose and in old log entries.
- Archiving or renaming a private row.
- Reconcile archiving a repository by itself.
- A physical `archived` wiki directory, and an archived grouping on the site beyond the index page.

### Deferred to Separate Tasks

- The wiki lint accepts an alias as a wikilink target, and the site resolves wikilinks by slug only. This plan writes no link that depends on an alias and does not change the lint.
- The rename CLI does not pass private-name tokens to the page-move planner (`private-name-collision`). Unchanged here.
- A dashboard read-model field that shows the archived mark in its page list.

## Context & Research

### Relevant Code and Patterns

- `packages/wiki-write-core/src/schemas.ts`: `OnboardingStatus`, `RepoEntry`, `assertRepoEntry`, `isOnboardingStatus`. Closed lists; an unknown status throws in every `assertReposFile` caller.
- `packages/registry/src/rename-tracked-repo.ts`: `readSnapshot`, `proveIdentity` (by `database_id`), `writeCommit` (one non-force Git Data commit), the ref-race retry, `assertChangePolicy`, `RenameBlockReason`. `readRows` locates a row by `node_id` only.
- `packages/wiki-write-core/src/repo-page-move.ts`: `planRepoPageMove`, `updateRepoPageValues`, `collidesWithAnotherRow`, `attributesPageTo`.
- `packages/registry/src/reconcile-plan.ts`: `classifyTracked` (its first statement, `migrateRepoEntry`, already rewrites rows), the `access.archived` flip, `detectRenames`, `mergeDuplicateEntries`, `restrictGroupVisibility`, `keepProtectedName`, `isNoOp`.
- `packages/registry/src/reconcile-effects.ts`: `runDispatches` and `dispatchWithTimeout`; the reconcile writer token already holds `actions: write` on this repository.
- `packages/privacy/src/check-private-leak.ts`: `resolvePrivateRows`, the three selection sites. `packages/privacy/src/check-wiki-private-presence.ts`: `buildPublicSlugMap` admits any `private: false` row.
- `packages/registry/src/repos-metadata.ts`: `publicRepoEntryExists` (survey admission and persist recheck), `applySurveyResult`.
- `packages/dispatch/src/dispatch-plan.ts`: `gateTarget`. `packages/reports/src/daily-digest-counts.ts`.
- `packages/wiki-write-core/src/wiki-ingest.ts`: `buildIndexDocument` (the only index builder, four fixed sections), `updateRepoPageFrontmatter` (keeps only incoming keys), `mergeRepoPageContent` (writes a bare alias on a node-ID migration), `buildWikiIngestChanges`.
- `packages/wiki-ops/src/wiki-index.ts`: the daily index for agents; a blockquote first paragraph yields no opening sentence.
- Tests to extend: `scripts/rename-tracked-repo-workflow.test.ts`, `packages/registry/src/reconcile-repos.test.ts`, `packages/registry/src/check-repo-onboarded.test.ts`, `packages/registry/src/repos-metadata.test.ts`, `packages/privacy/src/check-private-leak.test.ts`, `scripts/fro-bot-workflow.test.ts`.

### Institutional Learnings

- `docs/solutions/best-practices/fix-a-fail-safe-flags-false-positive-in-the-consumer-2026-11-15.md`: a new stored state must be kept correct by every path that writes or preserves the row; put the precision in the consumer. This plan gives reconcile one early exit for an archived row and puts the live check in the scans.
- `docs/solutions/integration-issues/identity-probe-follows-redirects-hides-repo-renames-2026-10-10.md`: compare observed names even on a node-ID match; never apply silently. A declaration is the approval.
- `docs/solutions/best-practices/an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md`: the mutation gate's trigger set; `packages/privacy/` changes run it.
- `docs/solutions/best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md`: each unit that changes a workflow ends with a named live read.

## Prior-Art Survey

```json
{"schema_version":2,"verdict":"extend","scope":"fro-bot/.github: packages/{registry,wiki-write-core,privacy,dispatch,reports,wiki-ops}, .github/workflows","freshness":{"vcs_reference":"1d6c1ef1632a388f2265a6f71b3de3d2b4328e3f"},"budget":{"max_search_passes":12,"max_candidate_inspections":30,"exhausted":false},"candidates":[{"path_or_symbol":"packages/registry/src/rename-tracked-repo.ts#renameTrackedRepo","description":"Operator-dispatched atomic Git Data commit of row, page move, index and log; identity proof by database_id; fixed block reasons.","disposition":"extend"},{"path_or_symbol":".github/workflows/rename-tracked-repo.yaml","description":"Dispatch-only workflow, contents:write App token for this repo, node_id and old_name inputs.","disposition":"extend"},{"path_or_symbol":"packages/wiki-write-core/src/repo-page-move.ts#planRepoPageMove","description":"Pure page-move planner: slug collisions, attribution by node_id or sources, link repair; writes no alias.","disposition":"extend"},{"path_or_symbol":"packages/registry/src/reconcile-plan.ts#detectRenames","description":"Detects same-node same-owner name change and transfers; excludedNodeIds blocks every dispatch path.","disposition":"extend"},{"path_or_symbol":"packages/registry/src/reconcile-effects.ts#runDispatches","description":"Dispatches survey-repo.yaml with the writer token under dispatchWithTimeout.","disposition":"extend"},{"path_or_symbol":"packages/registry/src/reconcile-issues.ts#renderRenamePendingIssue","description":"Public rename-pending issue by node ID, auto-closed when no longer pending.","disposition":"extend"},{"path_or_symbol":"packages/wiki-write-core/src/wiki-ingest.ts#buildIndexDocument","description":"The single index builder, fixed four sections by page type.","disposition":"extend"},{"path_or_symbol":"packages/wiki-write-core/src/wiki-ingest.ts#mergeRepoPageContent","description":"Writes aliases:[oldSlug] when ingest migrates a page by trusted node ID; the alias semantics to mirror.","disposition":"reuse"},{"path_or_symbol":"packages/registry/src/repos-metadata.ts#publicRepoEntryExists","description":"Survey admission and persist recheck predicate (private===false by owner/name).","disposition":"extend"},{"path_or_symbol":"packages/privacy/src/check-private-leak.ts#resolvePrivateRows","description":"Live node visibility resolution for private rows in PR and promotion scans.","disposition":"extend"},{"path_or_symbol":"packages/dispatch/src/dispatch-plan.ts#gateTarget","description":"Cross-repo dispatch gate on owner, private and workflow flags.","disposition":"extend"},{"path_or_symbol":"packages/registry/src/reconcile-plan.ts#normalizeLostAccessEntry","description":"lost-access state: persistent non-active status, but redacts as private and is regained to pending when the repo reappears in the access list.","disposition":"insufficient","insufficiency_reason":"Stores private:true, hides the name, and reconcile reverses it; archive needs a named, stable state."},{"path_or_symbol":"packages/registry/src/commit-metadata.ts","description":"Sole programmatic metadata writer; edits the row file only.","disposition":"insufficient","insufficiency_reason":"Cannot commit a row and a wiki page atomically; rename is already the documented exception."},{"path_or_symbol":"packages/registry/src/reconcile-plan.ts#keepProtectedName","description":"Keeps a stored public name while its wiki page exists.","disposition":"insufficient","insufficiency_reason":"A transient guard against stranding pages, not an operator-declared persistent state."}]}
```

## Key Technical Decisions

- `archived` is a new `onboarding_status` value, not a separate flag: every reader that allowlists `onboarded` and `pending` skips it without a change, and a row cannot be active and archived at once. The archive date lives on the page.
- Reconcile exits early for an archived row, before `migrateRepoEntry`. The exit has one write: redaction when the access list positively shows the node private. A failed or missing lookup writes nothing. The row is also excluded from rename detection, duplicate merging and group-visibility restriction, so no other path can alter it.
- The leak scans select `private: true` rows and archived rows. For an archived row, a live `PUBLIC` contributes no private name; any other result, a failed lookup or a missing node ID builds the private name from the stored owner and name and does not block the scan. A private row's failed lookup still blocks, as today.
- The lifecycle module stays `packages/registry/src/rename-tracked-repo.ts` and the workflow file stays `rename-tracked-repo.yaml`, with a new `action` input: no new CLI, shim or token mint. The default action is today's apply, so existing dispatches keep working.
- The workflow's concurrency group is keyed by node ID, so dispatches for different repositories do not replace each other while pending.
- A survey is refused at one predicate: `publicRepoEntryExists` requires a non-archived row. That gates the survey's start and its persist recheck. The survey-result writer gains an outcome that writes nothing for an archived row.
- Jobs that read the registry read `data`'s copy at the moment they act. Renovate dispatch and `update-metadata` read no registry row and skip repositories GitHub reports archived; they are unchanged. Until the operator archives on GitHub they still see the repository, which is accepted: the declaration precedes the GitHub archive by minutes.
- The archive notice is a plain first paragraph under the page's H1, under 200 characters. It then also becomes the page's sentence in the agents' daily index.
- The marker is enforced in the trusted writer: when the stored page carries `archived` and an incoming page omits it, a survey or repair write restores it, and a dashboard save keeps it through the dashboard's own frontmatter round-trip. No new lint kind is added, because the dashboard matches lint kinds exhaustively.
- A redirect alias is the page's full site path, `wiki/repos/<old-slug>`. Both writers of a rename use it: the page-move planner and the ingest's node-ID migration. When old and new slugs are equal, no alias is written.
- Existing bare aliases are kept. The one-time fix adds the full-path alias beside a bare alias that is an old page slug, so nothing that passes lint today starts failing.
- A declared rename is detected in `detectRenames`: every observed name equals the declared name and the owner is unchanged. Reconcile starts the workflow after its own metadata commit and writes nothing for that row. The node stays excluded from survey dispatch until the rename lands.
- A declaration requires a row with a `database_id`, because the apply proof uses it.
- Results are reported where they are known: the lifecycle run's summary carries the outcome of an action; reconcile's summary lists declarations that are pending, started or mismatched. The existing rename-pending issue covers a mismatch. No new issue type.

## Open Questions

### Resolved During Planning

- Does the dashboard break on the new state or keys: no, per its source at the deployed tag.
- Does the gate contract version change: no. The marker's source hash changes with any `src/` edit and is regenerated.
- Can reconcile dispatch the workflow with its existing token: yes.
- What address does an alias produce: exactly the alias text from the site root.
- Can a mistaken archive be undone by hand: no, hence `unarchive`.

### Deferred to Implementation

- The exact input the early exit reads for "positively private" when the row is absent from the access list: the probe drops `private` on a 200 today. Either the probe carries it or the exit acts only on access-list evidence. Decide while writing Unit 4's tests.
- Whether `GITHUB_TOKEN`'s GraphQL `node()` distinguishes a public repository from one it cannot see, for the legacy-row lookup in Unit 6. The refusal must name nothing either way.
- Whether a pending `workflow_dispatch` run is dropped when a second arrives in the same concurrency group; Unit 6 keys the group by node regardless.
- Whether the wiki lint flags an unknown `archived` key on a repo page.
- Where the one-time alias fix runs (an action of the lifecycle workflow, or a wiki-repair operation). Unit 11 states the constraint: a trusted writer, one commit, dry-run first.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Row states and who moves them:

```mermaid
stateDiagram-v2
  [*] --> onboarded
  onboarded --> archived: archive (operator)
  lost_access --> archived: archive (operator, GitHub shows public)
  archived --> onboarded: unarchive (operator, GitHub shows public and not archived)
  archived --> archived_redacted: reconcile (GitHub shows private)
  archived_redacted --> archived: archive again (operator, same name, public)
  onboarded --> onboarded_declared: declare-rename (operator)
  onboarded_declared --> onboarded: cancel, or apply after GitHub shows the declared name
```

Leak-scan decision for one selected row:

| Row | Live result | Private name used | Scan blocks |
|---|---|---|---|
| `private: true` | `PUBLIC` | none | no |
| `private: true` | other value | live name | no |
| `private: true` | lookup failed or no node ID | none available | yes |
| archived, named | `PUBLIC` | none | no |
| archived, named | other value, failure or no node ID | stored owner and name | no |
| archived, redacted | as `private: true` | as `private: true` | as `private: true` |

## Implementation Units

### Phase 1: archive and unarchive

- [ ] **Unit 1: the `archived` row state**

**Goal:** The registry schema accepts `archived`, so every reader on `main` parses a row that carries it.

**Requirements:** R2, R23

**Dependencies:** None

**Files:**
- Modify: `packages/wiki-write-core/src/schemas.ts`, `packages/wiki-write-core/dist/gate-contract.json`, `packages/wiki-write-core/README.md`, `metadata/README.md`
- Test: `scripts/schemas.test.ts`

**Approach:**
- Add the value to the status type and both validators. Document it beside `lost-access`.
- Regenerate the gate-contract marker; the version stays 1.
- The PR title is `feat(wiki-write-core): …`, which publishes a minor release.

**Patterns to follow:** the existing status list and its error text in `assertRepoEntry`.

**Test scenarios:**
- Happy path: a row with `onboarding_status: archived` passes `assertRepoEntry` and `assertReposFile`.
- Error path: an unknown status still throws with the list of accepted values, which now includes `archived`.
- Happy path: an archived row with `private: false`, owner, name, `node_id` and `database_id` round-trips through the registry serializer unchanged.

**Verification:** the package check passes with the regenerated marker; nothing in the repository writes the state yet.

- [ ] **Unit 2: active jobs skip an archived repository**

**Goal:** No survey, dispatch, survey-result write or attention item is produced for an archived row, and the digest counts it separately.

**Requirements:** R5, R6, R11

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/registry/src/repos-metadata.ts`, `packages/registry/src/check-repo-onboarded.ts`, `packages/dispatch/src/dispatch-plan.ts`, `packages/dispatch/src/dispatch-cli.ts`, `packages/reports/src/daily-digest-counts.ts`, `packages/reports/src/gateway-announce.ts`, `.github/workflows/survey-repo.yaml`, `.github/workflows/fro-bot.yaml`
- Test: `packages/registry/src/repos-metadata.test.ts`, `packages/registry/src/check-repo-onboarded.test.ts`, `packages/dispatch/src/cross-repo-dispatch.test.ts`, `packages/reports/src/daily-digest-counts.test.ts`, `scripts/survey-repo-workflow.test.ts`, `scripts/fro-bot-workflow.test.ts`

**Approach:**
- `publicRepoEntryExists` is false for an archived row. That refuses a survey at its start and at the persist recheck that gates the wiki commit.
- A manual survey must stop before the agent runs, not only before the hand-off: gate the agent steps on the start check.
- `applySurveyResult` writes nothing for an archived row, for success and failure results, so a survey in flight leaves no trace and triggers no re-dispatch.
- `gateTarget` blocks an archived target with a reason; the CLI passes the status through.
- The digest gains an archived count and stops counting archived rows as tracked. The Observe prompt's sentence that lists tracked repositories excludes archived rows; the daily report shows the archived count.
- Passive readers are untouched: search, lint, the agents' index, trackers and capture.

**Execution note:** test-first; add the in-flight survey case as a failing test before changing `applySurveyResult`.

**Patterns to follow:** the `lost-access` handling in `applySurveyResult`; the existing blocked-target reasons in `gateTarget`.

**Test scenarios:**
- Happy path: `publicRepoEntryExists` is true for an onboarded public row and false for the same row archived.
- Edge case: a survey result (success, then failure) for an archived row returns the registry unchanged and reports the archived outcome.
- Integration: the survey workflow's agent steps are conditioned on the start check, and the persist job's wiki commit is conditioned on the recheck.
- Happy path: `gateTarget` blocks an archived row and allows the same row onboarded.
- Happy path: the digest reports an archived row in the archived count and not in the tracked count.
- Integration: the Observe prompt text excludes archived rows from tracked repositories and names the archived count.

**Verification:** with a fixture registry holding one archived row, no planner selects it and the digest shows it as archived.

- [ ] **Unit 3: privacy gates cover an archived repository**

**Goal:** Every leak scan treats an archived repository as private unless GitHub confirms it public at scan time.

**Requirements:** R10, R12

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/privacy/src/check-private-leak.ts`, `packages/wiki-write-core/src/private-leak-adapter.ts`, `packages/wiki-write-core/dist/gate-contract.json`, `packages/privacy/README.md`, `metadata/README.md`, `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`
- Test: `packages/privacy/src/check-private-leak.test.ts`, `packages/wiki-write-core/src/private-leak-adapter.test.ts`, `packages/privacy/src/check-wiki-private-presence.test.ts`

**Approach:**
- One selector serves the three selection sites: rows stored private, plus archived rows.
- `resolvePrivateRows` takes the row, not only its node ID, and follows the decision table above. An archived row's failed lookup is not a scan failure.
- The published adapter applies the same table.
- The wiki-presence gate needs no change: a named archived row is in the public slug map, and a redacted one is not. Add tests that pin both, including that an edited page of a redacted archived row is `unattributable-page`.
- Both mutated modules stay at their current mutation score with no new directive.

**Execution note:** test-first, relative imports, constants inside functions.

**Patterns to follow:** the public-skip table tests added for #4256; the both-modes agreement test.

**Test scenarios:**
- Happy path: an archived named row resolving `PUBLIC`, named on an added line, passes in both scan modes and in the adapter.
- Error path: the same row resolving `PRIVATE`, a missing visibility, a lookup failure, and with no node ID each fail the scan on that line, with the path redacted, and none is reported as a resolution failure.
- Edge case: an archived row beside an unresolvable private row still blocks as a resolution failure.
- Edge case: a redacted archived row behaves exactly as a private row.
- Integration: both scan modes and the adapter agree on every row of the decision table.
- Happy path: the wiki-presence gate attributes an edited page to a named archived row; error path: it blocks an edited page whose archived row is redacted, and passes that page unchanged from `main`.

**Verification:** the mutation gate passes; the promotion scan run against a fixture with one archived row prints counts and no name.

- [ ] **Unit 4: reconcile leaves an archived row alone**

**Goal:** No reconcile path changes an archived row, except a redaction when GitHub shows the repository private.

**Requirements:** R2, R8, R9

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/registry/src/reconcile-plan.ts`, `packages/registry/src/reconcile-handler.ts`, `.github/workflows/reconcile-repos.yaml`, `packages/registry/README.md`
- Test: `packages/registry/src/reconcile-repos.test.ts`

**Approach:**
- An early exit at the top of `classifyTracked`, before the entry migration, returns the row by reference.
- Its one write: when the access list holds the row's node and the fail-closed privacy helper says private, store the row redacted with the archived state kept, queue the went-private notice, and bump a counter so the commit happens.
- A redacted archived row is returned unchanged whatever the evidence.
- Exclude archived rows from rename detection, from duplicate merging and from group-visibility restriction. A duplicate group that contains an archived row keeps the archived row.
- The job summary gains an archived count and an archived-redacted count.

**Execution note:** characterization first: pin today's outcome for an archived-on-GitHub row, then add the archived-state cases.

**Patterns to follow:** the multi-run sequence tests written for #4251, kept in `.context` history, and the existing `lost-access` cases in the same file.

**Test scenarios:**
- Happy path: an archived named row whose node is in the access list as archived and public is returned by reference; no counter moves.
- Happy path: the same row with the node not archived on GitHub (un-archived there) is unchanged and no survey is planned.
- Error path: the node is in the access list and private: the row is redacted, still archived, one went-private notice is queued.
- Edge case: the node is absent from the access list, with each probe result (revoked, deleted, transient, malformed, none): unchanged.
- Edge case: the node appears twice with disagreeing visibility: redacted (the helper fails closed).
- Edge case: a redacted archived row whose node is public again: unchanged.
- Edge case: the node is observed under another name, and under another owner: no rename or transfer is reported for an archived row.
- Edge case: a duplicate group by node ID that contains an archived row keeps the archived state.
- Integration: a three-run sequence, archived then private then public again, ends redacted and archived.

**Verification:** the whole-registry reconcile over a fixture with one archived row produces a plan with no change for that row.

- [ ] **Unit 5: the page marker, the index section and marker survival**

**Goal:** A page can carry an archive date, the index groups such pages, and no permitted writer drops the marker.

**Requirements:** R3, R4, R6, R12

**Dependencies:** None (ships with Unit 3 or separately)

**Files:**
- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`, `packages/wiki-write-core/src/wiki-utils.ts`, `packages/wiki-write-core/dist/gate-contract.json`, `packages/wiki-ops/src/wiki-index.ts`, `knowledge/schema.md`, `packages/wiki-write-core/README.md`
- Test: `scripts/wiki-ingest.test.ts`, `packages/wiki-ops/src/wiki-index.test.ts`, `packages/wiki-ops/src/wiki-repair.test.ts`

**Approach:**
- The parsed page model reads `archived`. The index builder adds an `## Archived` section after the last existing section and lists a repo page there, not under Repos, when it carries the key. Curated index lines follow their page.
- When the stored page carries `archived` and an incoming survey or repair page omits it, the writer restores the key. A rewrite cannot remove the notice: with Unit 2 a survey of an archived repository never reaches the writer, and this is the second line of defence.
- The agents' daily index needs no change: the notice is the page's opening sentence.
- `knowledge/schema.md` documents the key, the notice and the Archived section.

**Patterns to follow:** how `mergeRepoPageContent` carries `sources` and `aliases` across a write.

**Test scenarios:**
- Happy path: a wiki with one archived repo page builds an index with that page under Archived and absent from Repos; a second build of the same input is byte-identical.
- Edge case: no archived page: the index has no Archived section and is byte-identical to today's output.
- Edge case: the header and footer scans still find their anchors with the new section present.
- Error path: an incoming page without `archived`, for a stored page that has it, is written with the key restored.
- Happy path: wiki repair of an archived page keeps the key and the notice.
- Happy path: the agents' index lists an archived page with its notice as the sentence.

**Verification:** rebuilding the index from current `data` produces no diff.

- [ ] **Unit 6: `archive` and `unarchive` actions**

**Goal:** One dispatch archives or un-archives a tracked public repository in one commit.

**Requirements:** R1, R3, R7, R9, R21, R22, R25, R27

**Dependencies:** Units 1-5 merged

**Files:**
- Modify: `packages/registry/src/rename-tracked-repo.ts`, `packages/registry/src/rename-tracked-repo-cli.ts`, `.github/workflows/rename-tracked-repo.yaml`, `metadata/README.md`, `packages/registry/README.md`, `README.md`, `.github/copilot-instructions.md`
- Test: `packages/registry/src/rename-tracked-repo.test.ts`, `scripts/rename-tracked-repo-workflow.test.ts`, `scripts/registry-entrypoints.test.ts`

**Approach:**
- The workflow gains an `action` input (`apply`, `archive`, `unarchive`; default `apply`) and a concurrency group keyed by node ID. Inputs still reach the script through step env only.
- `archive`: prove the node public and the same repository; set the state; write the archive date and the notice; rebuild the index; append a log entry; one commit through the existing writer and its ref-race retry.
- A row is located by node ID. For a row with no node ID, accept the supplied node only when GitHub's owner and name equal exactly one such row and exactly one page at that slug lists the repository's URL in `sources`; store `node_id`, `database_id` and `private: false` in the same commit.
- A redacted archived row is re-archived only when GitHub shows the same node public under the name its page is attributed to; otherwise refuse.
- `unarchive`: prove the node public and not archived on GitHub; restore the active state; remove the date and notice; rebuild the index; log.
- Refusals carry fixed reasons and name no repository: not tracked, private row, identity not confirmed, declaration pending, already in the requested state, ambiguous legacy match.
- The change-policy check accepts exactly: one row's state and identity fields, one page's frontmatter key and notice, the index and the log.
- The run summary states the action, the outcome and the node ID.

**Execution note:** test-first, with the fake Git Data client from the test kit.

**Patterns to follow:** `renameTrackedRepo`'s snapshot, proof, plan and commit sequence; `RenameBlockReason`.

**Test scenarios:**
- Happy path: archive of an onboarded public row writes one commit with the row archived and named, the page marked, the index regrouped and one log entry.
- Happy path: archive of a `lost-access` redacted row whose node GitHub shows public restores the name and archives it.
- Happy path: archive of the legacy row shape (no node ID, no `private`) with a matching node stores the IDs and archives it.
- Error path: the legacy match is refused when two rows lack a node ID and share the name, when no page lists the URL, and when GitHub's owner or name differs.
- Error path: a private row, an untracked node, a node GitHub cannot confirm, and a row with a pending declaration are each refused with their reason and no write.
- Edge case: archiving an archived named row is a no-op that reports the state and writes nothing.
- Error path: re-archiving a redacted archived row whose repository now has another name is refused.
- Happy path: unarchive restores the state, removes the date and notice, and regroups the index.
- Error path: unarchive is refused when GitHub shows the repository archived or private.
- Edge case: a ref race rebuilds from the new head and retries once; a second race fails with the existing error.
- Integration: the workflow passes `action` through env, keys concurrency by node, and keeps a single token consumer.

**Verification:** a dry dispatch against a fixture produces the expected one-commit change set; the workflow test pins the new input and group.

- [ ] **Unit 7: first live use and read-backs**

**Goal:** `copiloting` is archived through the action, and each protection is seen working.

**Requirements:** R24, success criteria

**Dependencies:** Unit 6 merged; the package release from Units 1, 3 and 5 published

**Files:**
- Modify: this plan (results)

**Approach:**
- Dispatch `archive` for `copiloting`. Read the commit on `data`: the row, the page, the index, the log.
- Read the next reconcile run: the row is unchanged and counted as archived.
- Read the next promotion: both leak scans and the wiki-presence gate pass, and the scan's count line no longer reports a row resolving to public.
- Over seven days, confirm no survey or dispatch selected it.
- A dashboard save of the archived page keeps the date and notice.
- `unarchive` is proven by tests only unless a real need arises; record that.

**Test expectation:** none -- operational read-backs recorded in this plan.

**Verification:** each read-back above is recorded with its run ID.

### Phase 2: declared rename

- [ ] **Unit 8: declare, replace and cancel**

**Goal:** A row can carry a declared new name, validated when it is written.

**Requirements:** R13, R14, R19, R27

**Dependencies:** Phase 1

**Files:**
- Modify: `packages/wiki-write-core/src/schemas.ts`, `packages/wiki-write-core/dist/gate-contract.json`, `packages/registry/src/rename-tracked-repo.ts`, `.github/workflows/rename-tracked-repo.yaml`, `metadata/README.md`
- Test: `scripts/schemas.test.ts`, `packages/registry/src/rename-tracked-repo.test.ts`, `scripts/rename-tracked-repo-workflow.test.ts`

**Approach:**
- An optional declared-name field on the row, validated as a repository name.
- `declare-rename` takes the node ID and the name; an empty name cancels. It writes the row only.
- Refuse: an archived row, a private row, a row with no `database_id`, the row's current name, a name or slug that belongs to another tracked row, a slug with an existing page, and a slug reserved by another page's full-path alias.
- A declaration for a repository GitHub has already renamed to that name is accepted; reconcile then applies it.

**Test scenarios:**
- Happy path: a declaration is stored; a second replaces it; an empty name clears it.
- Error path: each refusal above, with its reason and no write.
- Edge case: two names that fold to one slug collide.
- Edge case: the declared name differs from the current name only by letter case: accepted, and compared exactly later.

**Verification:** a declared row parses everywhere; surveys still run under the current name.

- [ ] **Unit 9: apply writes a redirect and clears the declaration**

**Goal:** Every rename leaves a redirect from the old page address, and a declared rename clears its declaration in the same commit.

**Requirements:** R16, R17, R20

**Dependencies:** Unit 8

**Files:**
- Modify: `packages/wiki-write-core/src/repo-page-move.ts`, `packages/wiki-write-core/src/wiki-ingest.ts`, `packages/wiki-write-core/dist/gate-contract.json`, `packages/registry/src/rename-tracked-repo.ts`, `knowledge/schema.md`
- Test: `packages/privacy/src/repo-page-move.test.ts`, `scripts/wiki-ingest.test.ts`, `packages/registry/src/rename-tracked-repo.test.ts`

**Approach:**
- When a page moves, add `wiki/repos/<old-slug>` to its `aliases`, deduplicated. The ingest's node-ID migration writes the same form.
- No alias when old and new slugs are equal.
- The apply action, when the row has a declaration, requires GitHub's name to equal it (`declared-name-differs` otherwise) and clears the field in the rename commit. With no declaration it behaves as today.
- Collisions are rechecked at apply time.
- `knowledge/schema.md` states that a rename adds a redirect alias and what form it takes.

**Test scenarios:**
- Happy path: a rename adds the full-path alias and repairs inbound links; a second rename keeps the first alias and adds another.
- Edge case: same-slug rename writes no alias.
- Happy path: the ingest migration writes the full-path form.
- Happy path: applying a declared rename clears the declaration in the same commit.
- Error path: GitHub's name differs from the declaration: refused, no write, declaration kept.
- Error path: a page now exists at the target slug: refused.

**Verification:** a local site build of a fixture page with the alias serves a redirect at the old page address.

- [ ] **Unit 10: reconcile starts a declared rename and reports**

**Goal:** A declared rename is started by reconcile with no operator dispatch, and every pending or mismatched declaration is visible.

**Requirements:** R15, R18, R19

**Dependencies:** Unit 9

**Files:**
- Modify: `packages/registry/src/reconcile-plan.ts`, `packages/registry/src/reconcile-effects.ts`, `packages/registry/src/reconcile-handler.ts`, `packages/registry/src/reconcile-issues.ts`, `.github/workflows/reconcile-repos.yaml`, `packages/registry/README.md`
- Test: `packages/registry/src/reconcile-repos.test.ts`, `scripts/reconcile-repos-workflow.test.ts` (new)

**Approach:**
- `detectRenames` classifies a same-owner name change as declared when every observed name equals the declaration, and as pending otherwise, with a flag when a declaration exists and differs. Transfers are checked first and stay blocked.
- A new effect dispatches the lifecycle workflow with the apply action for each declared match, after the metadata commit, with the existing dispatch timeout. A failed or unknown dispatch is counted and retried on the next run, because the declaration is still present.
- The apply action is idempotent: a run that finds the rename already applied reports it and writes nothing.
- The summary lists pending declarations, started applies and mismatches. The rename-pending issue body says when a declaration differs.

**Test scenarios:**
- Happy path: a declared match yields one dispatch with the apply action and the node ID, and no row write.
- Edge case: no GitHub rename yet: nothing is dispatched and the declaration is listed as pending.
- Error path: a different new name: no dispatch, a pending rename with the differs flag, the issue text says so.
- Error path: a transfer with a declaration: blocked as a transfer, declaration kept.
- Error path: the dispatch times out: counted as outcome unknown, exit as today, retried next run.
- Edge case: a declared match keeps the node out of survey dispatch.
- Integration: the dispatch happens after the metadata commit in the handler's step order.

**Verification:** the reconcile summary for a fixture run shows the three counts.

- [ ] **Unit 11: redirects for pages renamed earlier**

**Goal:** Old page addresses of already-renamed pages redirect.

**Requirements:** R26

**Dependencies:** Unit 9

**Files:**
- Modify: the trusted writer chosen during implementation, `packages/wiki-write-core/src/wiki-ingest.ts` or `packages/wiki-ops/src/wiki-repair.ts`
- Test: the matching test file

**Approach:**
- For each repo page, an alias that is slug-shaped and is not a live page's slug gains the full-path alias beside it. Bare aliases stay.
- An alias that equals a live page's slug is reported and left alone.
- One commit by a trusted writer, with a dry run that lists the changes first.

**Test scenarios:**
- Happy path: a page with a bare old-slug alias gains the full-path alias; a second run changes nothing.
- Edge case: a free-text alias that is not slug-shaped is untouched.
- Edge case: an alias equal to a live page's slug is reported and untouched.

**Verification:** the dry run on current `data` lists the pages; after the write and a site publish, one old page address returns a redirect.

- [ ] **Unit 12: phase 2 read-backs**

**Goal:** One declared rename is seen end to end.

**Requirements:** success criteria

**Dependencies:** Units 8-11

**Files:**
- Modify: this plan (results)

**Approach:** Record the first real declared rename: the declaration commit, the reconcile run that started the apply, the apply run, the published redirect. If no rename is due, record that the path is proven by tests only.

**Test expectation:** none -- operational read-backs.

**Verification:** run IDs recorded, or the test-only note.

## System-Wide Impact

- **Interaction graph:** the registry schema is read by reconcile, the survey gates, the dispatch gate, the digest, the three leak scans, the wiki-presence gate, wiki repair and the published adapter. The index builder is reached by ingest, repair, rename and dashboard saves.
- **Error propagation:** an action that cannot prove identity writes nothing and exits with a fixed reason. A reconcile dispatch failure is counted, not fatal.
- **State lifecycle risks:** a survey in flight when an archive lands; a duplicate row group; a rename observed on an archived row. Each has a test in Units 2 and 4.
- **API surface parity:** the per-PR scan, the promotion scan and the adapter share one decision table. Both rename writers share one alias form.
- **Integration coverage:** the survey workflow's step conditions, the lifecycle workflow's inputs and group, and reconcile's dispatch order are pinned by workflow tests.
- **Unchanged invariants:** `data` takes writes only from trusted workflows; the lifecycle workflow remains the only writer of a row together with a page; `lost-access` handling for an undeclared GitHub archive; the gate contract version; the operator's existing rename dispatch.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A reader on `main` throws on `archived` before it understands it | Unit 1 lands first; no writer exists until Unit 6 |
| An archived row can be written before it is protected | Units 2-5 merge before Unit 6; the sequencing is a requirement |
| A reconcile path other than the early exit alters an archived row | Exclusions in rename detection, duplicate merging and visibility restriction, each with a test |
| A repository turns private while reconcile cannot see it, and its name stays in the registry | Accepted. The scans treat it as private at every scan |
| A redacted archived row makes its page uneditable | Stated in the docs; re-running `archive` restores the name |
| The first release with `archived` reaches the dashboard late | No dependency: the dashboard does not validate the state |
| An alias equals a live page's slug and the site silently picks one | Declarations and the one-time fix refuse or skip that case |
| Stryker survivors in the privacy modules | Table-driven tests in both modes; the mutation gate runs on Unit 3 |

## Phased Delivery

### Phase 1

Units 1 to 5 are separate pull requests, each inert without the action. Units 1, 3 and 5 change the published package and each publishes a minor release. Unit 6 is the last pull request. Unit 7 is the live use.

### Phase 2

Unit 8 (field, release), Unit 9 (apply and aliases, release), Unit 10 (reconcile), Unit 11 (one-time fix), then Unit 12.

## Documentation / Operational Notes

- `metadata/README.md`: the archived state, what redacts it, the three actions and how to find a node ID.
- `README.md` and `.github/copilot-instructions.md`: the workflow's new actions; the rename exception to the metadata writer now covers archive and unarchive.
- `knowledge/schema.md` changes through a normal pull request to `main` and reaches `data` at the next merge-back.
- `docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md` and the fail-safe solution doc gain a line that a declared archive is a separate state.
- Rollback: reverting Unit 6 removes the writer. An archived row already on `data` stays readable, because the schema and protections remain.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-11-15-repo-lifecycle-archive-and-declared-rename-requirements.md](../brainstorms/2026-11-15-repo-lifecycle-archive-and-declared-rename-requirements.md)
- Related past work: `docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md`, recorded complete. This plan keeps operator approval for renames and moves it ahead of the GitHub rename.
- Related past work: `docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md`, status unspecified. This plan separates a declared archive from `lost-access`.
- Related PRs: #4251 (closed), #4256, #4261.
