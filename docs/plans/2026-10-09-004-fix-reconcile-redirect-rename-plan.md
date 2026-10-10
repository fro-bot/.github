---
title: 'fix: Detect redirected repo renames and move them by operator dispatch'
type: fix
status: active
date: 2026-10-09
---

# fix: Detect redirected repo renames and move them by operator dispatch

## Overview

When a tracked repository is renamed on GitHub and its old name still redirects, three things happen today. Reconcile never records the new name. Two other writers rename the row behind its back. Nothing moves the repo's wiki page.

After this fix:

- Reconcile detects renames and reports them, but never renames a row on any path. Restoring a redacted row that went public is the one owner/name write it keeps.
- Owner changes are blocked as transfers.
- No survey is dispatched for a row with a pending rename or a blocked transfer.
- Survey and invitation write-backs can no longer change a row's identity.
- A new operator-dispatched workflow, `rename-tracked-repo.yaml`, applies a rename. It writes one App-authored Git Data commit on `data` that renames the `metadata/repos.yaml` row, moves the repo page to its new slug, and repairs `[[old]]` wikilinks and `related:` entries under `knowledge/wiki/`. The workflow proves the rename from GitHub itself before it writes anything.

## Problem Frame

Live case: `marcusrbrown/panthe.ai` was renamed to `marcusrbrown/panthea`. The node ID `R_kgDOJt6i0Q` is the same under both names. Reconcile run 38011934823 reported `renamed: 0` and `unchanged: 35`, and the `data` row still says `panthe.ai`.

Verified causes (main `0232396`):

- **Access-list path drops the name.** The collab access list matches the row by node ID. When the field probes are unchanged, the no-change short-circuit in `classifyTracked` ignores owner/name (`scripts/reconcile-repos.ts:1369-1379`). A local probe of `reconcileRepos` confirmed it: the name stays, `unchanged=1`, and dispatch still targets `panthea`.
- **The planner renames on field drift.** When any probe field drifts, the planner writes the access-list owner/name. That happens through `storageInput` (`:1346-1351`), the no-probe normalize (`:1355`), the regain return (`:1262-1268`) and the archived return (`:1225-1231`). Whether a rename lands depends on unrelated drift, and it lands with no page move and no collision check.
- **Identity probe drops the name.** `probeRepoIdentity` calls `repos.get` on the stored name. GitHub follows the redirect, the node ID matches, and the result is `matched`. `returned_name` is never compared (`:2530-2537`). `renameTarget` is set only on the GraphQL fallback path (`:1112-1123`).
- **Transfers leak on the access path.** An owner change that arrives with field drift is applied silently with `transferBlocked=0`, and the dispatch push runs before any check.
- **Survey and invitation write-backs are hidden rename paths.** Both match rows the same way:
  - `recordSurveyResult` and `addRepoEntry` call `findRepoEntryIndex`, which matches by node ID first and then falls back to owner/name (`scripts/repos-metadata.ts:66-91`).
  - `normalizeRepoEntryForStorage` then overwrites owner and name whenever `private === false` (`:128-129`). It can also replace `node_id` (`:95`) and `private`.
  - `record-survey-result.ts` and `handle-invitation.ts:244-256` both pass the current owner/name with `private: false`.
- **The survey records a false success.** The onboarded gate matches exact owner/name (`scripts/check-repo-onboarded.ts:88` → `publicRepoEntryExists`, strict `===`, `repos-metadata.ts:468-471`), so a renamed repo's survey skips wiki persistence. `survey-repo.yaml:694-697` still writes `last_survey_status: success` when `onboarded != 'true'`.

The #3965 guard (`scripts/metadata-wiki-rename-guard.ts`, with `keepProtectedName` and `planWithWikiGuard` in reconcile) is out of reach for all of these paths. Survey and invitation writes bypass it. The planner path only runs it after the rename is already planned.

## Requirements Trace

- R1. Reconcile detects a same-owner rename of a tracked public repo (same node ID, same owner, different name) on both the access-list path and the identity-probe path. It never applies one.
- R2. An owner change on any path is never applied and never dispatched. It counts in `transferBlocked` only.
- R3. No writer other than the operator rename workflow changes a tracked public row's owner or name. The planner may write an owner/name in one case only: restoring a row stored as `[REDACTED]` when the access list shows the same node as public. That write is never counted as a rename or a transfer. The private-redaction transform is unchanged.
- R4. Survey and invitation write-backs match rows by `node_id` only (explicit `identityOnly` mode, `node_id` required). They never change `owner`, `name`, `node_id`, `database_id` or `private`. `resetSurveyResult` keeps its name fallback.
- R5. A survey whose target does not match its row records `failure` keyed by node ID. It never records `success` when persistence was skipped.
- R6. Each row with a pending rename gets an operator issue that names only its node ID. A row with a pending rename or a blocked transfer is never dispatched for a survey on any path: planner, regain, floor, or invitation.
- R7. The operator rename workflow lands one non-force Git Data commit on `fro-bot/.github@data`. In that commit:
  - the row is renamed;
  - the page is moved to the new slug, or edited in place when the slug is unchanged;
  - `[[old]]` wikilinks and `related:` entries under `knowledge/wiki/` are repaired;
  - `knowledge/index.md` is rebuilt;
  - a single `manual-edit` entry is appended to `knowledge/log.md`.

  `log.md` history is never rewritten. No commit leaves metadata and wiki disagreeing.
- R8. The workflow writes only after GitHub itself proves the rename. It blocks on any collision, unverifiable state, private-name exposure, or unsupported residue state.
- R9. Private and redacted rows never take part in a rename, a page move or a log line. Issues name node IDs only. Errors are status-only.
- R10. Operator docs cover detection, dispatching the rename, the page-body staleness window, and the manual follow-ups: the allowlist, and `reset-survey-status` taking the new name.
- R11. The live `panthe.ai` → `panthea` case is repaired by one approved dispatch after merge, whichever name the row holds at that time.

## Scope Boundaries

- Transfers are not migrated. They are blocked and counted.
- The rename is not applied automatically. Reconcile only detects it.
- No changes to the #3965 guard, `detectPrivateWikiLeaks`, the promotion gate, or `check-wiki-authority.ts`.
- No aliases on the moved page, no alias registry, and no rename history store.
- `metadata/allowlist.yaml` is operator-edited, and the docs cover re-listing renamed repos in it.

### Deferred to Separate Tasks

- Migrating `actions/create-github-app-token` from `app-id` to `client-id` (a deprecation warning only).
- An operator signal for a whole-account rename, where every repo of an owner flips to `transferBlocked`.

## Context & Research

### Relevant Code and Patterns

- **Metadata writer.** `commitMetadata` (`scripts/commit-metadata.ts:139-220`) writes through the Contents API, retries its mutator on a file-sha 409, and is limited to `metadata/<name>.yaml` paths. Reconcile calls it with `writerOctokit` (`scripts/reconcile-repos.ts:1944-1984`).
- **Git Data writer.** `commitWikiChanges` (`packages/wiki-write-core/src/wiki-ingest.ts:303-407`):
  - builds the tree with `createTree` using `base_tree`;
  - deletes with `sha: null`;
  - commits with `createCommit`, then moves the branch with `updateRef` using `force: false`.

  On a 409 it replays the files it precomputed. It never retries a 422. On a truncated tree it skips deletions silently (`:446-447`). The new writer must not call it.
- **Frontmatter helpers.** `parseFrontmatterDocument` and `renderFrontmatterDocument` are exported from `packages/wiki-write-core/src/frontmatter.ts:9,20`. `wiki-ingest.ts` keeps private copies under the same names. Exporting those copies would collide through `src/index.ts` (TS2308).
- **Wikilink helpers.**
  - `collectWikilinks` (`packages/wiki-write-core/src/wiki-utils.ts:65-85`, exported) returns target strings only, with the `|label` part stripped.
  - `extractWikilinks` (`wiki-ingest.ts:1008`) is a private wrapper that trims those strings.
  - `validateWikilinks` (`:525-541`) checks against slugs only, so it rejects `[[old#h]]`.
  - `buildWikiTargetIndex` (`wiki-utils.ts:163-182`) registers aliases.
- **Index, log and slugs.**
  - `rebuildWikiIndex` (`wiki-ingest.ts:553`) is exported.
  - `appendLogEntry` (`:718`) is private, and the log parser accepts only the ops `ingest|query|lint|manual-edit` (`:640`).
  - `computeRepoSlug` (`packages/wiki-write-core/src/wiki-slug.ts:69-94`) lowercases the name and collapses each run of `[^a-z0-9-]` to `-`.
  - `buildPrivateNameTokens` lives in the same file.
- **Branch safety.** `assertWritableBranch` is private in both `scripts/commit-metadata.ts:336` and `wiki-ingest.ts:419`.
- **Committed dist.** The package ships a committed dist. `main.yaml:81-97` runs `pnpm check:wiki-write-core-dist`, and the source hash (`scripts/build-wiki-write-core.ts:164-188`) covers every non-test `src/` file plus the `package.json` `exports` and `files` fields.
- **Survey persist.** The `survey-persist` job starts at `survey-repo.yaml:525`. Its data-write App token is `steps.app-token` (`:549-556`, contents write, this repo). The wiki commit (`:640-671`) runs before the record step (`:683-698`).
- **Dispatch queue.** `compareBySurveyFreshness` (`reconcile-repos.ts:447-457`) and `prioritizeDispatches` (`:2200-2204`) put never-surveyed repos first. A pending entry is a candidate while `last_survey_status !== 'success'` (`:1287-1290`).
- **Integrity and ruleset.** `verifyDataBranchIntegrity` (`:2961-2984`) checks the tip author login. The `data` ruleset bypasses App 218644 by actor (`.github/settings.yml:115-131`).
- **Token-scope contract.** `scripts/app-token-scope-guard.test.ts` pins every App-token mint. A new workflow mint needs a row in that table.
- **The live page.** `knowledge/wiki/repos/marcusrbrown--panthe-ai.md` has no `node_id` frontmatter, and its `sources` URL is `https://github.com/marcusrbrown/panthe.ai`. It is listed under `related:` at `topics/github-actions-ci.md:253-256`, and its body wikilink is at `:617`. `knowledge/corrections.yaml` does not exist.

### Institutional Learnings

- `docs/plans/2026-09-26-002-fix-wiki-rename-orphan-promotion-plan.md`:
  - move or delete the page and repair its links in the same commit;
  - never republish unaudited prose;
  - recompute from the current tip, never replay.
- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` and `wiki-page-structured-attribution-2026-06-04.md`: the promotion gate stays fail-closed, and structured `sources` are authoritative with no body fallback.
- `docs/solutions/best-practices/identity-guard-stable-scalar-fallback-2026-06-22.md`: a missing probe value means no information. It never means the identity changed.
- `docs/plans/2026-04-17-001-feat-repo-reconciliation-plan.md`: the node ID is the stable join key, and renames and transfers must not become `lost-access`.
- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md` and `enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md`: build decision tables per call, and never use `Stryker disable` directives.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "scripts/{reconcile-repos,metadata-wiki-rename-guard,repos-metadata,handle-invitation,check-repo-onboarded,check-wiki-private-presence,wiki-repair}.ts, packages/wiki-write-core/src, .github/workflows/{reconcile-repos,survey-repo}.yaml",
  "freshness": {
    "vcs_reference": "0232396"
  },
  "budget": {
    "max_search_passes": 4,
    "max_candidate_inspections": 14,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "scripts/reconcile-repos.ts:classifyTracked (1055-1124, 1225-1268, 1342-1386)",
      "description": "Identity-repair branch sets renameTarget and transferBlocked; storageInput, no-probe normalize, regain and archived returns write the access-list owner/name; the no-change short-circuit ignores owner/name.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/reconcile-repos.ts:keepProtectedName / planWithWikiGuard (869-892, 2156-2198)",
      "description": "Reverts public renames of protected associations and re-plans to a fixed point. Unchanged; the planner no longer renames, so it has no rename to hold.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/metadata-wiki-rename-guard.ts:findRemovedPublicAssociations / findBlockedPublicAssociations",
      "description": "Detects removed public associations and checks old-slug page presence on data by path. Unchanged.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts:prepareWikiPage / mergeRepoPageContent / rewriteInboundWikilinks",
      "description": "node_id-keyed page migration: deletes old path, adds alias, rewrites [[old]] links across all loaded files including log.md; requires node_id frontmatter on the old page.",
      "disposition": "insufficient",
      "insufficiency_reason": "Rewrites log.md history, ignores related:, misses whitespace forms, adds aliases, and cannot fold a page without node_id. The page move is a new pure module that reuses only the exported frontmatter and index helpers."
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts:commitWikiChanges (303-407)",
      "description": "Git Data writer with deletedPaths and updateRef(force:false); replays precomputed files on 409; 422 not retried; no path policy; silent no-op delete on truncated trees.",
      "disposition": "insufficient",
      "insufficiency_reason": "Replays instead of rebuilding from head, has no path or overwrite policy, and fails open on truncated trees. The rename writer reuses its Git Data call shape only."
    },
    {
      "path_or_symbol": "scripts/commit-metadata.ts:commitMetadata (139-220)",
      "description": "Contents-API metadata-only writer with pure-mutator retry and metadata/*.yaml path guard.",
      "disposition": "insufficient",
      "insufficiency_reason": "Single-file Contents-API CAS cannot express an atomic metadata+wiki commit. Reuse its serialization options and mutator contract only."
    },
    {
      "path_or_symbol": "scripts/wiki-repair.ts (tip-recheck at 503-504, getCurrentDataTipSha at 628-636)",
      "description": "Compares the data tip before committing; never rewrites links, deletes pages, or touches related.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/repos-metadata.ts:findRepoEntryIndex / recordSurveyResult / addRepoEntry / normalizeRepoEntryForStorage (66-91, 95, 128-129, 261-283, 333-384)",
      "description": "Resolves rows by node_id then owner/name; write-backs overwrite owner/name, node_id and private for public input, creating hidden rename and identity-takeover paths.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/check-repo-onboarded.ts / repos-metadata.ts:publicRepoEntryExists (468-471)",
      "description": "Survey wiki gate matching exact owner/name with private===false.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/check-wiki-private-presence.ts:detectPrivateWikiLeaks / buildPublicSlugMap",
      "description": "Promotion gate attributing data wiki pages to public owner/name slugs; in the Stryker mutate list. Unchanged; used as a test oracle for moved pages.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-slug.ts:computeRepoSlug / buildPrivateNameTokens",
      "description": "Derives owner--repo slugs and private-name tokens; defines same-slug renames and private-collision checks.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/reconcile-wiki-rename-guard.test.ts (createFakeBranch)",
      "description": "End-to-end handleReconcile test over an in-memory data branch with real commitMetadata.",
      "disposition": "reuse"
    }
  ],
  "excluded_scopes": [
    {
      "scope": "Live data branch contents",
      "reason": "Live state was read separately via gh api; the survey reasons from repo files."
    },
    {
      "scope": "packages/wiki-write-core/src/wiki-handoff-core.ts file sets",
      "reason": "Only needed to confirm no existing combined knowledge+metadata commit."
    }
  ]
}
```

## Key Technical Decisions

- **Detect automatically, apply by operator dispatch.** Renames are rare: one in 35 tracked repos. An unattended scheduled job that deletes wiki pages is the largest risk in this space. Reconcile detects and reports, and a human dispatches the move. The move uses the same tested writer that an automatic path would have used.
- **GitHub is the rename evidence.** The workflow requires a `node_id` input and accepts an optional `old_name` input.
  - It reads `GET /repositories/{database_id}`, using the row's `database_id`. The response must return the same `node_id`, the same owner, and `private === false`. Its `name` becomes the new name, which is never an operator input.
  - The old name normally comes from the row.
  - Residue case: the row already holds the current name and the page is still at an old slug. Then `old_name` is required. `GET /repos/{owner}/{old_name}` must redirect to the same node, and the old page's structured `sources` must contain that exact old URL.
  - If the old name has been reused by another repo, the run blocks. That dead end is documented.
- **Move the page, without aliases.** `validateWikilinks` fails every later ingest if a link points at a page that doesn't exist, so the page has to move, not vanish. Frontmatter is updated in four fields:
  - `node_id`;
  - the new `title`;
  - the new-name `sources` URL, added;
  - the `related` slugs.

  No alias is added. `validateWikilinks` doesn't honor aliases, while `buildWikiTargetIndex` does, and a later repo reusing the old name would make the alias ambiguous. The body is unchanged and is refreshed by the next scheduled survey. Until then, the page body can say the old name for up to one cadence interval, which the docs state.
- **Same-slug renames edit in place.** Case-only and punctuation-only renames keep the same slug. The writer updates `title` and adds the new `sources` URL so the promotion gate's attribution branch passes.
- **Legacy attribution comes from structured `sources` only.** A page without `node_id` may be moved only when its structured `sources` contain the exact old repository URL. No body fallback.
- **No-overwrite invariant.** Before `createTree`, every path the writer creates must be absent at head. The one exception is an in-place edit of a page whose existing `node_id` equals the row's, or a legacy page that passes the attribution check. Deletions are allowed only under `knowledge/wiki/repos/`. Link and `related:` edits may touch only pages that contain a rewritten reference. `knowledge/wiki/README.md` is never touched.
- **Collision blocks.** The rename is blocked if:
  - any other row, public or redacted, maps to the old slug or the new slug;
  - the new slug, title or sources would match a private repo token (`buildPrivateNameTokens` over private access-list entries).
- **Retries.** Only `updateRef` 409 and 422 are retried, with a full rebuild from the fresh head, up to 3 attempts. Exhausting them throws. `createBlob`, `createTree` and `createCommit` failures are terminal. Every error carries a phase and status code only, for example `REF_UPDATE_REJECTED` or `TREE_INVALID`.
- **Least-privilege workflow.** The evidence reads use `GITHUB_TOKEN` with `permissions: {}`, because public repository metadata needs no grant. A live unauthenticated `GET /repos/marcusrbrown/panthe.ai` returned `marcusrbrown/panthea R_kgDOJt6i0Q private=false`. No PAT is used: `FRO_BOT_POLL_PAT` holds write scopes and is confined to single node steps elsewhere. No App read is used either: the fro-bot App can't mint for `marcusrbrown`. The writer runs on a contents-write App token minted for this repo only. The workflow is script-only with no agent step, and it uses `persist-credentials: false`.
- **Write-backs match on identity, not name.** `findRepoEntryIndex` gains an explicit `identityOnly` mode, used by `recordSurveyResult` and `addRepoEntry`. `resetSurveyResult` keeps the name fallback, because it is an operator writer that resolves by name. Write-backs require `node_id`, write nothing on no match, and never change identity or visibility fields on a match.
  - A survey whose name drifts records `failure` keyed by node ID.
  - `addRepoEntry` still returns `ReposFile`. The separate pure predicate `findNodeNameConflict` lets the invitation handler detect a conflict before the mutator runs and skip its survey dispatch.
  - Reconcile's own `addRepoEntry` call at `:587` can't reach a name conflict, because Pass 2 skips tracked keys.
- **Un-redaction is the only planner name write.** A stored row with owner `[REDACTED]` (name = node ID) whose same node appears public in the access list is restored from the access list. This keeps today's private→public transition working. The owner-change and rename checks apply only to rows whose stored owner is a real owner.
- **One dispatch chokepoint.** A single predicate, "pending rename or blocked transfer", computed once from `detectRenames`, filters three places:
  - the final dispatch list in `handleReconcile`, which covers the planner, regain and pending branches;
  - the floor candidate filter;
  - the invitation handler, through `findNodeNameConflict`.

  Pending-row candidacy ignores `next_survey_eligible_at` (`reconcile-repos.ts:1287-1290`). That makes this filter, not the `failure` record, the loop prevention.
- **No survey persist race guard.** A survey that started before a rename sees its row mismatch, so its persist is skipped by the onboarded gate. A survey that started after the rename resolves the new name. Aborting on a conflict would throw away a whole survey whenever two persists overlap on `index.md` and `log.md`, so the survey's replay behavior stays as it is today.

## Open Questions

### Resolved During Planning

- Delete versus move: move.
- Automatic phase versus operator dispatch: operator dispatch.
- Aliases: none.
- `publicRepoEntryExists` case sensitivity: strict `===`, pinned by a test.
- Transfers: blocked on every path, counted only in `transferBlocked`, and excluded from dispatch.
- Evidence client: `GITHUB_TOKEN` with `permissions: {}`. Verified live against the redirect.
- Pending rows ignore the cadence, so the dispatch chokepoint carries the loop prevention.
- Issue content: node ID only, following the visibility-transition issue precedent (`reconcile-repos.ts` ~`:219-224`).

### Deferred to Implementation

- Whether `transferBlocked` should share the rename issue kind or stay counts-only. Default: counts-only.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
reconcile (scheduled)
  classifyTracked: owner/name from the stored row; only exception = un-redaction of a now-public node
  detectRenames(rows, accessList, identityProbes)   # pure
    -> pending renames (public, real owner, same node, same owner, name differs)
    -> owner change -> transferBlocked
  excluded = pendingRenames ∪ transferBlocked
  final dispatch list + floor candidates filtered by excluded
  pending rename -> deduped node-ID-only issue; closed when the node is no longer pending

handle-invitation: findNodeNameConflict -> skip survey dispatch

rename-tracked-repo.yaml (workflow_dispatch: node_id, old_name?)
  evidence (GITHUB_TOKEN, permissions {}): GET /repositories/{database_id} -> same node, owner, public -> new_name
    residue: GET /repos/{owner}/{old_name} redirects to same node + page sources match
  commitRepoRename(appToken contents:write)        # per attempt, max 3
    head -> integrity -> read repos.yaml + wiki tree (throw if truncated)
    planRepoPageMove(snapshot, row, old, new)       # pure, wiki-write-core
    no-overwrite + path checks -> createTree/createCommit -> updateRef(force:false)
    retry only updateRef 409/422 with full rebuild
```

## Implementation Units

- [x] **Unit 1: Write-backs never change identity**

**Goal:** Close the survey and invitation rename paths, make the survey outcome honest, and stop invitations from dispatching surveys that would conflict.

**Requirements:** R3, R4, R5, R6, R9

**Dependencies:** None

**Files:**
- Modify: `scripts/repos-metadata.ts` (`findRepoEntryIndex` `identityOnly` parameter; `recordSurveyResult`; `addRepoEntry`; new `findNodeNameConflict`), `scripts/record-survey-result.ts`, `scripts/handle-invitation.ts`, `.github/workflows/survey-repo.yaml`
- Test: `scripts/repos-metadata.test.ts`, `scripts/record-survey-result.test.ts`, `scripts/handle-invitation.test.ts`, the survey workflow contract test

**Approach:**
- `findRepoEntryIndex(repos, input, {identityOnly})`. `recordSurveyResult` and `addRepoEntry` pass `identityOnly: true`. `resetSurveyResult` keeps the default name fallback.
- `recordSurveyResult`:
  - It requires `node_id`; when it is absent, it throws a status-only error.
  - With no node match, it writes nothing.
  - With a match, it keeps `owner`, `name`, `node_id`, `database_id` and `private` from the stored row.
  - If the stored owner/name differs from the survey target, it records `failure` and reports a `name-mismatch` outcome to the caller, which logs a counts-only warning. A pure function can't log, so the outcome is returned through a sentinel or a result object.
- `addRepoEntry` still returns `ReposFile`, and it never changes identity or visibility fields on a node match. The new pure predicate `findNodeNameConflict(repos, input)` reports a node match with a different owner/name.
- `handle-invitation.ts` calls `findNodeNameConflict` before the mutator. On a conflict, it leaves the row unchanged, skips the survey dispatch and emits a counts-only warning.
- `survey-repo.yaml`: when `onboarded != 'true'`, the record step no longer writes `success`. It passes the mismatch through so `recordSurveyResult` records `failure`. The cadence-advance fallback inside the record step follows the same identity-only rule.

**Test scenarios:**
- A survey for a renamed node records `failure` and keeps the stored name. Assert against the decoded YAML.
- A survey whose name and node ID both match still records `success`, as a regression check.
- A survey whose name matches but whose node ID differs writes nothing, and the stored `node_id` is unchanged.
- A survey reporting `private: false` for a stored private row writes nothing.
- A survey with no `node_id` throws a status-only error.
- An invitation for an existing node under a new name leaves the row unchanged and makes no survey dispatch.
- An invitation for a new node adds a row and dispatches, as a regression check.
- A case-only mismatch makes `publicRepoEntryExists` false, and `recordSurveyResult` records `failure`. This pins the strict `===`.
- `resetSurveyResult` still resolves by name, as a regression check.

**Verification:** No path outside the rename workflow and the un-redaction transform changes a row's identity or visibility fields.

- [x] **Unit 2: Reconcile detects renames and never applies them**

**Goal:** Pure rename detection, transfers blocked, one dispatch chokepoint, and a node-ID-only operator issue.

**Requirements:** R1, R2, R3, R6, R9

**Dependencies:** None

**Files:**
- Modify: `scripts/reconcile-repos.ts`:
  - `classifyTracked` and `probeRepoIdentity`;
  - the final dispatch list and the floor filter;
  - the `HandleReconcileResult` counters: `renamesPending` and `transferBlocked`;
  - a new `rename-pending` `IssueQueueEntry` kind with its renderer and exhaustive-switch branch;
  - `RENAME_PENDING_LABEL` via `ensureLabelsExist`;
  - a new close pass modeled on `autoCloseStaleIssues`.

  Also modify `.github/workflows/reconcile-repos.yaml` (step summary rows).
- Test: `scripts/reconcile-repos.test.ts`, `scripts/reconcile-wiki-rename-guard.test.ts` (regression)

**Approach:**
- `classifyTracked` takes owner/name from the stored row on every return path: `storageInput`, the no-probe normalize, regain, archived and identity repair. It removes the `renameTarget` application. The one exception is un-redaction: a stored `[REDACTED]` owner whose node ID appears public in the access list is restored from the access entry.
- Owner-change and rename checks run only for rows with a real stored owner. An owner change returns the row unchanged and increments only `transferBlocked`.
- `probeRepoIdentity`: when the node ID matches, compare `returned_owner`/`returned_name` against the stored row and surface the difference to the detector.
- `detectRenames(rows, accessEntries, identityProbes)` is pure and builds its tables per call. It returns pending renames: rows public on both sides with a real owner, the same node ID and owner, and a different name. Private and redacted rows are skipped first.
- `excluded = pendingRenames ∪ transferBlocked` is computed once. It filters the final dispatch list in `handleReconcile`, after every path has pushed (planner, regain, pending branch), and the floor candidate filter.
- One issue per pending node ID, found by searching for the existing node marker (`NODE_ID_MARKER_PATTERN`) before creating. The title and body carry the node ID and the dispatch command (`gh workflow run rename-tracked-repo.yaml -f node_id=<id>`) only, with no owner/name. The close pass closes marker issues whose node ID is no longer pending. The step summary shows counts only.

**Test scenarios:**
- Access-list path with unchanged fields and a different name: the rename is pending, the row is unchanged, there is no dispatch, and the issue is created with no owner/name in its title or body.
- The same with `has_renovate` drifting too: the drift is applied and owner/name stay unchanged.
- Identity path: a redirect to the same node with a different name makes the rename pending.
- Owner change with field drift: `transferBlocked=1`, no owner write and no dispatch, on the access, regain and archived paths.
- A pending renamed row reached through the regain path, the floor pass, or the pending branch with stale `last_survey_at` gets zero dispatches.
- Un-redaction: a redacted row whose node is now public in the access list is restored to the real name on the access, regain and still-accessible paths, with `renamesPending=0` and `transferBlocked=0`.
- A redacted row whose node is still private gets no write and no count.
- A missing probe value means no rename.
- The issue is not duplicated on a second run, and it closes once the row matches.
- Exhaustive switch: an unhandled `IssueQueueEntry` kind fails the type check.
- The #3965 guard cases (ID-less downgrade, slug collision, blocked merge, same-slug rename) still pass unchanged.

**Verification:** Reconcile changes no tracked public row's owner or name in any test except un-redaction. Every pending rename is visible and never dispatched.

- [x] **Unit 3: Pure repo page move**

**Goal:** A pure function that turns a wiki snapshot plus a proven rename into the next file map, or into a typed block reason.

**Requirements:** R7, R8, R9

**Dependencies:** None

**Files:**
- Create: `packages/wiki-write-core/src/repo-page-move.ts`, and `findWikilinkSpans` in `packages/wiki-write-core/src/wiki-utils.ts`
- Modify: `packages/wiki-write-core/src/wiki-ingest.ts` (export `appendLogEntry` only if it is needed; it has no same-named sibling), `packages/wiki-write-core/src/index.ts`, `mutation-guards.json` (classify the new module and update the `frontmatter.ts` consumer note), `packages/wiki-write-core/dist/**` including `gate-contract.json` (regenerated with `pnpm build`)
- Test: `scripts/repo-page-move.test.ts`, `scripts/wiki-utils.test.ts`

**Approach:**
- Import the frontmatter helpers from `./frontmatter.ts`. Import through the root barrel so `package.json` `exports` doesn't change.
- `findWikilinkSpans(content)` uses the same grammar as `collectWikilinks` and returns spans. It recognizes `[[t]]`, `[[t|label]]` and whitespace variants, keeping the original whitespace and label. `[[t#h]]` is out of scope because the validator rejects it.
- Preconditions. Each failure is a typed block:
  - Every page parses.
  - The old page is either absent, has a `node_id` equal to the row's, or has no `node_id` and structured `sources` containing the exact old URL.
  - The new slug is free, or it equals the old slug.
  - No other row maps to the old or new slug.
  - The new slug, title and sources don't match the private tokens passed in.
- Different slug: move the page, then set `node_id`, the new `title`, and the added new-name `sources` URL. Same slug: edit the page in place.
- Rewrite every span targeting the old slug in pages under `knowledge/wiki/`. Rewrite `related:` entries structurally. Leave `log.md` history and `README.md` alone.
- Rebuild `knowledge/index.md` with `rebuildWikiIndex`, append one `manual-edit` log entry naming only the public old and new names, then run `validateWikilinks`. Any failure is a block.

**Test scenarios:**
- A redacted-shape copy of the live page moves to `marcusrbrown--panthea.md` with `node_id` and `sources` set. `related:` in `topics/github-actions-ci.md` and its body wikilink are repaired.
- Link forms `[[old]]`, `[[old|x]]` and `[[ old ]]` are repaired with their labels kept.
- `log.md` is byte-identical apart from the appended entry. `README.md` is untouched.
- Same-slug rename (`panthe.ai` → `panthe-ai`): the page is edited in place, and `detectPrivateWikiLeaks` on the result passes.
- A legacy page whose body names the old repo but whose sources name another repo: blocked.
- The target page exists with any `node_id`, or with none: blocked.
- Another row shares the old slug, or the new slug: blocked.
- The new name matches a private token, including a case variant: blocked.
- The old page is absent: the result is metadata-only.

**Verification:** The function is deterministic. Its output passes `validateWikilinks` and the promotion attribution check. `pnpm check:wiki-write-core-dist` is clean.

- [x] **Unit 4: Operator rename workflow and atomic writer**

**Goal:** Prove the rename from GitHub, then commit the row, page and links as one non-force commit, rebuilt from head on every attempt.

**Requirements:** R7, R8, R9, R11

**Dependencies:** Unit 3

**Files:**
- Create: `scripts/rename-tracked-repo.ts` (CLI with a pure core and injected clients), `.github/workflows/rename-tracked-repo.yaml`
- Modify: `scripts/app-token-scope-guard.test.ts` (one new row, with the file and mint floors raised by one)
- Test: `scripts/rename-tracked-repo.test.ts`, `scripts/rename-tracked-repo-workflow.test.ts`, and a shared in-memory Git Data fake (blob/tree/commit store, a real fast-forward check returning 422 on `updateRef`, a `truncated` toggle, and race injection between read and write)

**Approach:**
- Workflow:
  - `workflow_dispatch` with a required `node_id` and an optional `old_name` (`owner/name`), both regex-validated before use.
  - Workflow-level `permissions: {}`. The evidence step gets `GITHUB_TOKEN`.
  - One job: checkout with `persist-credentials: false`, the shared setup action, and a `writer-token` mint (contents write, this repo only) that is passed only to the write step.
  - `concurrency: rename-tracked-repo`.
- Evidence:
  - Find the row by node ID on `data`.
  - `GET /repositories/{database_id}` must return the same `node_id`, the same owner, and `private === false`. Its `name` is the new name.
  - If the row holds a different name, that stored name is the old name. Otherwise this is the residue case, and `old_name` is required: `GET /repos/{owner}/{old_name}` must redirect to the same node, and the page at the old slug must carry that exact URL in its structured `sources`.
- The target is the literal `fro-bot/.github@data`. Branch safety is copied from `assertWritableBranch`, and there is no override flag.
- Each attempt, up to 3:
  1. `getRef`, then the tip-author integrity check.
  2. Read `repos.yaml` and the full wiki tree at the head sha. A truncated tree throws.
  3. Re-find the row by node ID and re-check that it holds the old name or the new name. Anything else blocks.
  4. Rename the row. Only the name changes; every other field is kept.
  5. Run `planRepoPageMove`.
  6. Check the no-overwrite invariant and the per-operation path rules.
  7. `createTree`, `createCommit`, then `updateRef` with `force: false`.
- Only an `updateRef` 409 or 422 triggers a rebuild. Everything else is terminal. Errors are wrapped to a phase and status code before they reach `main()`.
- Outcomes:
  - The row already holds the new name and the page is already at the new slug: exit 0 with `{"result":"noop"}`.
  - Pages exist at both the old and new slugs, or the row holds the old name while a page already sits at the new slug: exit non-zero with a named reason (`both-pages-present`, `page-ahead-of-row`). The message points at the documented manual step. There is no merge logic.
- The commit message names only the public old and new names, for example `chore(rename): marcusrbrown/panthe.ai -> marcusrbrown/panthea`.

**Test scenarios:**
- Happy path: one commit with the renamed row, the moved page, the repaired links and `related:`, the rebuilt index, and the appended log.
- Residue with `old_name` given: the redirect and sources match, so one commit moves the page and leaves the row unchanged.
- Residue without `old_name`, or with an `old_name` that has been reused by another node: a typed block and no write.
- Already applied: noop, no commit.
- `both-pages-present` and `page-ahead-of-row`: a named block and no write.
- Evidence fails (different node, different owner, private): a typed error and no write.
- The head moves between read and write: 422, a rebuild, and the concurrent change is preserved.
- Truncated tree: throws, nothing written.
- A computed change touches `README.md`, or deletes a path outside `knowledge/wiki/repos/`: throws before `createTree`.
- `createTree` returns 422: terminal on the first attempt.
- Workflow contract: the inputs, `permissions: {}`, `persist-credentials: false`, no agent step, the concurrency group, `writer-token` reaching only the write step, and the token-scope row.
- No error or log line contains a private token (`FORBIDDEN_IN_PUBLIC_OUTPUT`).

**Verification:** No code path can leave metadata renamed without its page move. The workflow is inert until it is dispatched.

- [x] **Unit 5: Docs**

**Goal:** The operator knows how renames are detected and how to apply them.

**Requirements:** R10

**Dependencies:** Units 1, 2, 4

**Files:**
- Modify:
  - `metadata/README.md`: detection, the node-ID issue, the dispatch command, the `old_name` residue input and its reuse dead end, the two named block states and their manual steps, transfers, the page-body staleness window, allowlist re-listing, and `reset-survey-status` taking the new name.
  - `knowledge/schema.md`: page-move semantics and the `manual-edit` log entry.
  - `README.md`: workflow count.

**Test expectation:** none. Documentation only. `check:md-links` and markdown lint apply.

## System-Wide Impact

- **Interaction graph.** Reconcile loses every rename write except un-redaction. It gains detection, a node-ID issue and one dispatch chokepoint. Invitations skip the survey dispatch when a conflict is found. The new workflow writes `data` only when someone dispatches it.
- **Error propagation.** Write-back mismatches return typed outcomes; a missing `node_id` throws. Rename workflow failures are terminal, status-only, and leave `data` unchanged.
- **State lifecycle.**
  - Rename workflow versus a concurrent reconcile: reconcile's `commitMetadata` 409 re-runs its mutator on the renamed rows, and the planner no longer reverts names.
  - Rename workflow versus a survey persist: a survey that started before the rename has its persist skipped by the onboarded gate, and one that starts after resolves the new name. The existing index/log replay behavior is unchanged.
- **API surface parity.** `reset-survey-status` matches by exact name. After a rename the operator uses the new name, as documented.
- **Unchanged invariants.**
  - The #3965 guard.
  - `detectPrivateWikiLeaks`.
  - `check-wiki-authority`.
  - The App-only `data` ruleset.
  - `commitMetadata`'s path guard.
  - `commitWikiChanges`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The writer deletes or overwrites the wrong page | Operator-gated, GitHub-proven evidence, the no-overwrite invariant, deletions only under `repos/`, a truncated tree throws, collision blocks |
| A collaborator renames a repo onto another repo's slug or a private name | Slug and private-token collision blocks. The promotion gate is still the backstop. |
| A renamed repo is never surveyed until the operator acts | The node-ID issue carries the dispatch command and closes on its own once applied |
| The planner change breaks un-redaction | An explicit carve-out with tests on the access, regain and still-accessible paths |
| A pending row loops on daily re-dispatch | One exclusion predicate filters the final dispatch list and the floor, and invitations skip on conflict |

## Documentation / Operational Notes

- **Live repair (R11).** After merge, dispatch `rename-tracked-repo.yaml` with approval, using `node_id=R_kgDOJt6i0Q`. Add `old_name=marcusrbrown/panthe.ai` only if the row already holds `panthea`, because a write-back renamed it before this shipped. Expect:
  - one commit;
  - the page at `marcusrbrown--panthea.md`;
  - `related:` and the body wikilink in `topics/github-actions-ci.md` repaired;
  - the reconcile issue closed on the next run.

  Then let the normal promotion run, and read its privacy-gate result.
- **Rollback.**
  - A rename is one commit: add a non-force revert through the App writer, or dispatch the workflow in reverse once GitHub redirects back.
  - Units 1 and 2 revert as ordinary commits.
- **Mutation guards.** Classify `repo-page-move.ts` in `mutation-guards.json`. Run `pnpm check:mutation-guards` if any module on the mutate list is touched.

## Sources & References

- Related plans: `docs/plans/2026-09-26-002-fix-wiki-rename-orphan-promotion-plan.md`, `docs/plans/2026-04-17-001-feat-repo-reconciliation-plan.md`
- Related PRs: #3965 (reconcile wiki rename guard), #3974 (App-token split)
- Live evidence: reconcile run 38011934823, reset-survey-status run 38012906769, `data` commit 59d06188
