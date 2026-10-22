---
title: "fix: Stop wiki handoffs from overwriting other writers"
type: fix
status: active
date: 2026-10-21
origin: docs/brainstorms/2026-10-21-wiki-writer-lost-updates-requirements.md
---

# fix: Stop wiki handoffs from overwriting other writers

## Overview

Trusted wiki writers (survey persist and the two fro-bot ingest jobs) apply the agent's handoff over a fresh sync of `data`. Today they apply the agent's stale copies of `knowledge/log.md`, `knowledge/index.md` and every page it touched, and those copies replace whatever another survey committed in between. This plan changes the writers in five ways:

- `log.md` and `index.md` are no longer applied from the artifact. The writer derives the agent's appended log entries and rebuilds both files from its own sync.
- Every handed-off page and deletion is checked against the commit the agent job synced.
- Agent deletions are committed.
- A survey that hits a page conflict is re-dispatched.
- wiki-repair re-reads the head on each attempt and fails the job when it aborts.

## Problem Frame

Reconcile dispatches surveys about 1.5 minutes apart. Agent jobs run 6–8 minutes and overlap. Persist jobs take 30–37 s and run one after another. The second agent syncs before the first survey persists. Its handoff carries `log.md`, `index.md` and the topic pages as full files, because the survey prompt tells the agent to edit them and the allowlist in `scripts/wiki-handoff-core.ts` admits them. Persist applies those files over its own fresh sync and commits. On 2026-10-20 this dropped two log entries and two index rows from the earlier survey. On 2026-10-21 it also dropped one topic-page edit. The #4032 guard does not fire, because its base is persist's own sync (see origin: `docs/brainstorms/2026-10-21-wiki-writer-lost-updates-requirements.md`).

## Requirements Trace

- R1. A handed-off `log.md` or `index.md` is never applied as a file.
- R2. The agent's appended entries are the suffix of its `log.md` beyond `log.md` at its starting commit. A non-append edit drops them.
- R3. Ingest builds `log.md` and `index.md` from the writer's sync. It appends the agent's entries plus its own summary entry, and keeps the existing entries in order.
- R4. Prompts stop asking for `index.md` edits. Pre-change handoffs apply unchanged under R1 and R2.
- R5. Handed-off pages and deletions are checked against the agent job's sync commit, which comes from the sync step and not the artifact.
- R6. If a handed-off page changed on `data` after that commit, the writer refuses with no commit and no merging.
- R7. A missing, empty, unknown or non-ancestor agent commit refuses the write.
- R8. Agent deletions are removed from `data`.
- R9. On a page conflict, the survey re-runs straight away with a fresh agent run, up to a bound.
- R10. A survey that is still conflicting after its last attempt fails loudly and is eligible again the next day.
- R11. Observe and event ingests fail loudly on a page conflict and are not re-run.
- R12. wiki-repair fails the job when it aborts.
- R13. wiki-repair reads the current head on each attempt.

## Scope Boundaries

- No writer queue or concurrency-group change. The window of about 30 s between a writer's sync and its commit stays covered by the #4032 guard. A refusal there is an ordinary failure with the normal survey cadence; no redispatch.
- Ingest's write set is not narrowed. Pages that differ from `main` are still rewritten from the writer's own sync, as they are today.
- No commit-layer rebuild-per-attempt machinery, and no page merging.
- No scope rule on agent deletions beyond the page guard, and no validation of the agent's log text beyond the append check.
- No change to the rename writer, merge-back, or the drafted-solutions handoff.
- No recovery of the content lost on 2026-10-20 and 2026-10-21.

### Deferred to Separate Tasks

- A `docs/solutions/` write-up of the root cause and the misdiagnosis path, via `ce:compound` after merge.

## Context & Research

### Relevant Code and Patterns

- `packages/wiki-write-core/src/wiki-ingest.ts`:
  - `runWikiIngestCli`, `loadExistingWikiFiles` and `getChangedWikiPaths`/`parsePorcelainPaths` (where deletions are dropped).
  - `buildWikiIngestChanges`, which calls `appendLogEntry` and `buildIndexDocument`.
  - `commitWikiChanges` with the #4032 `baseCommitSha` guard, `assertWriteSetUnchanged` and `readCommitTreeSha`.
- `scripts/wiki-handoff-core.ts`: `isAllowedWikiHandoffPath`, `buildWikiHandoff` (manifest `{changed, deleted}`) and `validateAndApplyHandoff`/`validateAndApplyWikiHandoff`. The manifest stays on disk after apply.
- `scripts/wiki-handoff-apply.ts` is the CLI entry for apply.
- `.github/workflows/survey-repo.yaml`:
  - the agent job's unnamed `sync-wiki` step and job `outputs:`;
  - `survey-persist`: sync, apply, ingest with `WIKI_INGEST_DATA_TIP_SHA`, then `record-survey-result`;
  - the prompt lines that ask for `index.md` and `log.md` edits.
- `.github/workflows/fro-bot.yaml`: the event and observe agent jobs' `sync-wiki` steps, `fro-bot-wiki-ingest` and `fro-bot-observe-wiki-ingest`, and the prompts that permit `index.md` edits.
- `.github/workflows/reconcile-repos.yaml` shows the App-token mint shape for dispatching `survey-repo.yaml`.
- `scripts/record-survey-result.ts` and `scripts/repos-metadata.ts` (`computeNextEligibleAt`, `CHANNEL_INTERVAL_DAYS`) hold the survey cadence.
- `scripts/wiki-repair.ts`: `runWikiRepair` compares the live tip with `tree.tipSha` and reloads through `loadTree`, which re-reads the pinned `WIKI_REPAIR_DATA_TIP_SHA` and the disk checkout, so every retry aborts. A privacy-leak abort sets `aborted` and `privacy_blocked` together. `main` writes the JSON result and exits 0, and the `wiki-lint.yaml` summary step (`if: always()`) reads it.
- `scripts/wiki-ingest.ts` is the workflow entry. It calls `runWikiIngestCli` with no catch, so every error exits 1.
- Survey agent retries (`survey-agent-retry-1`/`-2`) reuse the first-sync workspace, so the first sync is the correct agent base for every attempt.
- `scripts/git-data-fake.ts` is the multi-branch Git Data fake (`advance`, `beforeUpdateRef`, `truncate`) used by the rename and merge-back tests. Its compare response has `ahead_by`, `behind_by` and `merge_base_commit.sha` but no `status`, and it has no `repos.getContent`.
- `scripts/rename-tracked-repo.ts` is the precedent for rebuilding the log and index from the head and for `appendLogEntry` reuse.

### Institutional Learnings

- `docs/solutions/best-practices/agent-drafts-trusted-publish-split-2026-10-10.md`: treat the agent artifact as untrusted, and compare handed-off paths against a trusted pinned base.
- `docs/solutions/integration-issues/identity-probe-follows-redirects-hides-repo-renames-2026-10-10.md`: Git Data writes use a non-force ref update, fail closed on a truncated tree, and keep Fro Bot as both author and committer.
- `docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md`: `index.md` can be derived from pages; `log.md` is append-only and cannot be.
- Repo-wide App-token scope contract (`scripts/app-token-scope-guard.test.ts`): every new mint needs an explicit `permission-*`, explicit `repositories:` and a table row.
- Stryker: put source tests next to the mutated module, never import `dist`, and avoid top-level decision constants.
- Package release: any edit under `packages/wiki-write-core/src` requires a rebuilt, committed `dist`, and a `fix:` merge publishes a patch release.

### External References

- GitHub job outputs come from a named step's output file, and a later step cannot overwrite them through its own `$GITHUB_OUTPUT`. This is not a defense against code that tampers with the runner, so R5 guards against staleness and is not a security boundary.
- "Re-run failed jobs" reuses outputs from upstream jobs that succeeded. Re-running the agent therefore needs a fresh `workflow_dispatch`, and `GITHUB_TOKEN`-triggered dispatches do create runs.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "fro-bot/.github: .github/, scripts/, packages/wiki-write-core/src",
  "freshness": {
    "vcs_reference": "6d77d074a0052232c2b4f90291132393b0dc222e"
  },
  "budget": {
    "max_search_passes": 10,
    "max_candidate_inspections": 20,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts :: commitWikiChanges",
      "description": "Data-branch Git Data commit of files and deletedPaths. Each attempt pins the base tree (baseCommitSha, or the first head read when omitted), runs assertWriteSetUnchanged over the write-set paths, then createBlob, createTree, createCommit and a non-force updateRef. updateRef 409/422 re-reads the head and replays. Disposition reason (extend): it owns the write-set guard this concern needs, but a guard refusal is terminal with no re-derivation on the new head, and baseCommitSha is optional.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts :: runWikiIngestCli and loadExistingWikiFiles",
      "description": "Reads knowledge/index.md, knowledge/log.md and wiki pages from the working tree, then pins baseCommitSha from WIKI_INGEST_DATA_TIP_SHA before calling commitWikiChanges. Disposition reason (extend): the only place a base pin enters the commit path. It trusts the tip exported by the same job's sync-wiki step, so an artifact's edits are guarded against that tip, not the tip the agent read.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/rename-tracked-repo.ts :: renameTrackedRepo, writeCommit, assertTipIntegrity",
      "description": "Rebuild-from-head writer: each attempt re-reads the snapshot, rebuilds log/index from the head and does a non-force updateRef with bounded 409/422 retries. Reuse as precedent only; the rename writer itself is unchanged by this plan.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/wiki-repair.ts :: repair attempt loop (tree reload on CONFLICT_EXHAUSTED)",
      "description": "Rebuild-from-head loop around commitWikiChanges. Pins baseCommitSha to tree.tipSha, compares getCurrentDataTipSha before committing, and on CONFLICT_EXHAUSTED reloads the tree and re-plans up to maxRetries. Disposition reason (extend): the only existing re-derive-on-conflict loop for wiki files. Its planner is lint-repair specific (planAndVerifyWikiRepairs), so wiki ingest has no re-plan step.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts :: rebuildWikiIndex",
      "description": "Deterministic regeneration of knowledge/index.md from the wiki page set; preserves header and footer prose from existingIndex. Disposition reason (reuse): it derives the index from a head-aligned page snapshot, so it is the rebuild step for re-deriving after a guard refusal. No I/O and no ref handling.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts :: appendLogEntry",
      "description": "Appends one entry to knowledge/log.md while keeping existing text byte-for-byte. Documented as the append-only primitive and exported for the rename path. Disposition reason (reuse): it is the correct rebase primitive, applying this writer's entry onto a head log without rewriting other writers' entries.",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/wiki-ingest.ts :: mergeWikiLogs",
      "description": "Merges log sources, dedupes entries by (timestamp, target), sorts all entries chronologically and rebuilds the canonical header. Used for operator healing of log merge conflicts.",
      "disposition": "insufficient",
      "insufficiency_reason": "Global sort and key-based dedupe rewrite other writers' entries, and a second entry with the same timestamp and target overwrites the first in entryMap. That breaks the append-only log contract for a rebase onto a moved head."
    },
    {
      "path_or_symbol": "scripts/rebuild-wiki-index.ts :: runRebuildIndex and runMergeLogs",
      "description": "Operator CLI that rebuilds knowledge/index.md from working-tree wiki files, or merges log files into knowledge/log.md.",
      "disposition": "insufficient",
      "insufficiency_reason": "Operates on the local working tree with no data-branch head, no write-set guard and no ref update. It is a post-incident healer, not a write path, so it cannot serialize or detect concurrent writers."
    },
    {
      "path_or_symbol": "scripts/commit-metadata.ts :: commitMetadata",
      "description": "Single-file metadata writer. Retries 409 with a fresh read, calls createOrUpdateFileContents with the file sha, short-circuits on serialized equality, and requires a pure mutator. Also runs a data-branch bootstrap hook.",
      "disposition": "insufficient",
      "insufficiency_reason": "Path is restricted to metadata/<name>.yaml and uses the single-file contents API, so it has no multi-file write set and cannot write knowledge/ pages, index or log. Its retry convention is a precedent, not an owner."
    },
    {
      "path_or_symbol": "scripts/merge-back-data.ts :: mergeBackData",
      "description": "Second writer on heads/data. Merges main into data via createTree (base_tree main.sha), createCommit and a non-force updateRef, re-reading all state for up to 3 attempts on 409/422.",
      "disposition": "insufficient",
      "insufficiency_reason": "Its write set is the whole main-to-data merge, not wiki paths, so it cannot guard knowledge/ writes. The wiki write-set guard only sees it through head movement, and it is not in the wiki writers' concurrency domain."
    },
    {
      "path_or_symbol": "scripts/wiki-handoff-core.ts :: captureWikiBaseline and buildWikiHandoff",
      "description": "Build side. After sync-wiki, captureWikiBaseline content-hashes git-status wiki deltas. buildWikiHandoff scopes changed and deleted paths against that baseline and writes files/ plus manifest.json.",
      "disposition": "insufficient",
      "insufficiency_reason": "The manifest records changed and deleted paths only, with no data-branch commit SHA. Baseline hashes are relative to the build-time working tree, not a commit, so the trusted side cannot tell which data commit an edited page derived from."
    },
    {
      "path_or_symbol": "scripts/wiki-handoff-core.ts :: validateAndApplyHandoff and validateAndApplyWikiHandoff",
      "description": "Trusted apply. Validates manifest shape, traversal, symlinks, regular files, size cap and allowlist, then writes files/ content over the workspace and removes deleted paths.",
      "disposition": "insufficient",
      "insufficiency_reason": "The apply job runs its own sync-wiki before download-artifact and apply, so full-file page edits overwrite whatever another writer committed after the build-side sync. Nothing at this layer compares the artifact's source base with the workspace."
    },
    {
      "path_or_symbol": ".github/workflows/survey-repo.yaml :: concurrency",
      "description": "Concurrency group survey-repo-${{ inputs.node_id }} with cancel-in-progress false.",
      "disposition": "insufficient",
      "insufficiency_reason": "Serializes runs per repository only. Surveys of different repositories, the daily batch and event ingests can run in parallel against the same data branch, so this group serializes nothing across wiki writers."
    },
    {
      "path_or_symbol": ".github/workflows/fro-bot.yaml :: concurrency",
      "description": "Concurrency group keyed on issue, PR, discussion, or 'daily' for schedule and dispatch, with cancel-in-progress false.",
      "disposition": "insufficient",
      "insufficiency_reason": "Keys on the triggering event, so only same-issue runs or daily schedule and dispatch runs serialize. It does not cover survey-repo.yaml, merge-data.yaml or other data-branch writer workflows."
    },
    {
      "path_or_symbol": ".github/workflows/survey-repo.yaml :: survey-agent-retry-1 and survey-agent-retry-2",
      "description": "Re-runs the survey agent in the same job when wiki changed is false, up to three attempts, then fails on exhaustion.",
      "disposition": "insufficient",
      "insufficiency_reason": "Triggered by missing wiki changes, not by a ref race. It re-runs the agent rather than the commit and never re-derives against a moved data head."
    },
    {
      "path_or_symbol": "scripts/dispatch-renovate.ts :: dispatch flow",
      "description": "Workflow re-dispatch helper. Lists the Renovate workflow's runs and calls createWorkflowDispatch only when idle.",
      "disposition": "insufficient",
      "insufficiency_reason": "Idle probe for Renovate only. It has no data-branch awareness and no retry on a wiki ref race, so it cannot re-dispatch a wiki writer that lost a race."
    },
    {
      "path_or_symbol": "scripts/cross-repo-dispatch.ts :: CasWriteInput, CAS_MAX_RETRIES, readLatestMarkerComment",
      "description": "Optimistic concurrency on a single tracker-issue marker comment. CasWriteInput carries expectedPriorHash and nextState, with up to 3 retries, and the latest bot-authored marker is updated in place.",
      "disposition": "insufficient",
      "insufficiency_reason": "The CAS guards one issue comment's state hash, not git refs or file sets. It cannot guard multi-file data-branch writes, though its expected-prior-hash pattern is a precedent."
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/data-branch-bootstrap.ts :: bootstrapDataBranch",
      "description": "Idempotent recreation of the data branch from main, called before data-branch writes.",
      "disposition": "insufficient",
      "insufficiency_reason": "Branch-existence recovery only. It does not compare heads or guard write sets."
    },
    {
      "path_or_symbol": "packages/wiki-write-core/src/branch-safety.ts :: assertBranchWritable",
      "description": "Refuses protected or non-writable branches before a write, reporting the reason through a callback.",
      "disposition": "insufficient",
      "insufficiency_reason": "Permission and protection gate. It does not read or compare the data-branch head, so it provides no concurrency protection."
    }
  ]
}
```

## Key Technical Decisions

- **Derive the agent's log entries on the trusted side.** The ingest CLI reads `log.md` from the handoff's `files/` directory, and `log.md` at the agent's commit through `getCommit`/`getTree`/`getBlob`. Both are normalized to LF line endings with one final newline. If the handoff copy then starts with the base copy, the remainder is the agent's entries. A non-append edit drops them with a fixed warning, and only the summary entry is used. A failed read of the base log refuses the write instead of degrading. No prompt or artifact change is needed.
- **Apply skips `log.md` and `index.md`, including their deletions; it does not reject them.** `validateAndApplyWikiHandoff` neither writes nor removes either file in the workspace, so the writer's synced copies stay in place, and ingest rebuilds the index from the pages as it does today. Skipping deletions matters: a manifest that deletes `log.md` would otherwise empty the workspace log, and ingest would commit a one-entry log.
- **The page guard lives in `commitWikiChanges` as a second, per-path base.** A new optional handoff input carries the agent commit and the handed-off changed and deleted paths, with `knowledge/log.md` and `knowledge/index.md` filtered out. On every attempt the handoff check runs first, so a page conflict always surfaces as `HANDOFF_PAGE_CHANGED`. The #4032 base check then covers the rest of the write set and keeps raising `CONFLICT_EXHAUSTED`. `assertWriteSetUnchanged` takes the refusal code as a parameter.
- **The agent commit is resolved before the retry loop.** The CLI checks it is present and a SHA, and then the commit layer checks it resolves and is an ancestor of the head, all outside the try block whose 404 handler bootstraps `data`. Ancestry means compare `behind_by === 0` and `merge_base_commit.sha` equal to the agent commit, which the fake supports. Any failure raises `HANDOFF_BASE_INVALID` before any write.
- **Exit 3 comes from the entry script.** `scripts/wiki-ingest.ts` catches a `WikiIngestError` with code `HANDOFF_PAGE_CHANGED` and sets exit code 3; every other error keeps its current path. The survey ingest step writes `conflict=true` to `$GITHUB_OUTPUT` when the status is 3, then exits with that status. `survey-persist` declares `outputs.conflict` from that step.
- **The re-run is a fresh dispatch from a new job.** `survey-redispatch` has `needs: survey-persist` and `if: always() && !cancelled() && needs.survey-persist.outputs.conflict == 'true'`, plus an attempt check below 3. It mints an App token with `permission-actions: write` and `repositories: ${{ github.event.repository.name }}`, the same reach the reconcile writer holds. It then dispatches `survey-repo.yaml` on `main` with `node_id` and `attempt + 1`, passing both through `env`. The new `attempt` input is a string parsed strictly as an integer from 1 to 3. The dispatched run queues behind the current run's `survey-repo-${node_id}` group.
- **A conflict failure is eligible again the next day.** The record step passes `SURVEY_CONFLICT=true` when `conflict` is set. `record-survey-result` still records `failure`, but `next_survey_eligible_at` becomes the next day instead of the channel interval.
- **Observe and event ingests keep their current failure behavior.** The new exit code fails the job loudly, and nothing re-dispatches it.
- **wiki-repair reloads from the head.** On a tip mismatch, `loadTree` reads the wiki pages and `metadata/repos.yaml` at the current head through the Git Data API, failing closed on a truncated tree, and the repair re-derives its plan. The grandfather pages stay from the job's restore. `main` sets `process.exitCode` from an `exitCodeFor(result)` helper: 1 when `aborted > 0` and the abort is not a privacy leak.

## Open Questions

### Resolved During Planning

- Re-run bound: 3 attempts in total, so up to 2 re-runs.
- Format of the agent's log entry: unchanged. The entries are derived from the agent's `log.md` (see Key Technical Decisions).
- Telling refusals apart: `HANDOFF_PAGE_CHANGED` and exit code 3 apply only to page conflicts.

### Deferred to Implementation

- The exact shape of the new `commitWikiChanges` handoff input and its interaction with the existing `baseCommitSha` parameter, settled while writing the guard tests.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```mermaid
sequenceDiagram
  participant Agent as Agent job
  participant Persist as Trusted writer job
  participant Data as data branch
  Agent->>Data: sync (step output agent-base-sha = S1)
  Agent->>Agent: edit pages, append log entry
  Agent-->>Persist: artifact (pages, deletions, log.md, index.md) + job output S1
  Persist->>Data: sync (S2)
  Persist->>Persist: apply pages and deletions, skip log.md and index.md
  Persist->>Data: read log.md at S1, check S1 is an ancestor of head
  Persist->>Persist: agent entries = handoff log minus S1 log (if pure append)
  Persist->>Persist: build log.md (S2 log + agent entries + summary), rebuild index.md
  Persist->>Data: commit, guarding handoff paths vs S1 and the rest vs S2
  alt handoff page changed since S1
    Persist-->>Persist: exit 3, conflict=true
    Persist->>Data: record failure, eligible tomorrow
    Persist->>Persist: survey-redispatch (attempt < 3)
  end
```

## Implementation Units

- [x] **Unit 1: Carry the agent's sync commit to the trusted writers**

**Goal:** Each trusted writer receives the commit its agent job synced, from the sync step rather than the artifact.

**Requirements:** R5, R7

**Dependencies:** None

**Files:**

- Modify: `.github/workflows/survey-repo.yaml`
- Modify: `.github/workflows/fro-bot.yaml`
- Test: `scripts/survey-repo-workflow.test.ts`
- Test: `scripts/fro-bot-workflow.test.ts`
- Test: `scripts/trusted-wiki-env-source-guard.test.ts`

**Approach:**

- Give each agent job's `sync-wiki` step an id. These are the survey agent job and the fro-bot event and observe agent jobs.
- Expose `agent-base-sha` from that step's `data-sha` as a job output.
- In each of the three ingest steps, set `WIKI_HANDOFF_BASE_SHA` from `needs.<agent-job>.outputs.agent-base-sha`, and `WIKI_HANDOFF_DIR` to the same directory the apply step uses. Keep `WIKI_INGEST_DATA_TIP_SHA` as the writer's own sync.
- Add both variables to the trusted-env allowlist.

**Patterns to follow:**

- The #4032 `data-sha` wiring for `WIKI_INGEST_DATA_TIP_SHA`, and its contract tests.

**Test scenarios:**

- Happy path: each ingest step's `WIKI_HANDOFF_BASE_SHA` reads exactly `needs.<agent-job>.outputs.agent-base-sha`, that job output reads the sync step's `data-sha`, and `WIKI_HANDOFF_DIR` matches the apply step's value.
- Edge case: the agent job's sync step has the id the output references, and no agent step runs before it.
- Error path: the trusted-env guard rejects a `WIKI_HANDOFF_BASE_SHA` sourced from anywhere other than a job output.

**Verification:**

- The contract tests pin the three wirings, and actionlint is clean on both workflows.

- [x] **Unit 2: Skip shared files on apply and derive the agent's log entries**

**Goal:** A handoff's `log.md` and `index.md` never land as files. The agent's appended entries are re-appended onto the writer's own `log.md`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**

- Modify: `scripts/wiki-handoff-core.ts`
- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`
- Modify: `packages/wiki-write-core/dist/**`
- Test: `scripts/wiki-handoff-core.test.ts`
- Test: `scripts/wiki-ingest.test.ts`

**Approach:**

- `validateAndApplyWikiHandoff` still validates `knowledge/log.md` and `knowledge/index.md` but neither writes nor deletes them. The allowlist stays as it is.
- The ingest CLI reads the handoff `log.md` and `log.md` at `WIKI_HANDOFF_BASE_SHA`, normalizes both, and passes the suffix to the builder, which appends it to the workspace (synced) `log.md` before its own summary entry.
- When the handoff has no `log.md`, the CLI appends only the summary entry. A non-append edit does the same with a fixed warning. A failed base read refuses the write.

**Patterns to follow:**

- `appendLogEntry`, which appends and preserves bytes. Do not use `mergeWikiLogs`, which re-sorts.
- The rename writer's head-derived log and index.

**Test scenarios:**

- Happy path: the handoff `log.md` equals the base log plus one entry. The result is the synced log, plus that entry, plus the summary entry, with every synced entry unchanged and in order.
- Happy path: the handoff carries `index.md` with extra rows. The applied workspace `index.md` is the synced copy, and the built index covers the synced pages plus the handed-off pages.
- Edge case: the handoff `log.md` is identical to the base, so only the summary entry is appended.
- Edge case: the handoff has no `log.md`, so only the summary entry is appended.
- Edge case: the handoff `log.md` uses CRLF line endings, or lacks a final newline, and otherwise appends one entry. The entry is kept.
- Edge case: the agent appended two entries. Both are kept, in order.
- Error path: the handoff `log.md` rewrites an earlier entry and appends one. The agent entries are dropped, a warning is emitted, only the summary is appended, and all synced entries survive (AE6).
- Error path: the manifest deletes `knowledge/log.md` or `knowledge/index.md`. Apply leaves both workspace files in place, and the committed log keeps every synced entry.
- Error path: reading `log.md` at the agent commit fails. The write is refused and nothing is committed.

**Verification:**

- The tests pass, and the `dist` check is clean.

- [x] **Unit 3: Guard handed-off pages against the agent's commit and commit deletions**

**Goal:** The writer refuses when a handed-off page or deletion has changed since the agent's commit, validates that commit, and commits agent deletions.

**Requirements:** R5, R6, R7, R8

**Dependencies:** Units 1 and 2 (shared file `wiki-ingest.ts`, so run serially)

**Files:**

- Modify: `packages/wiki-write-core/src/wiki-ingest.ts`
- Modify: `packages/wiki-write-core/dist/**`
- Modify: `scripts/wiki-ingest.ts`
- Test: `scripts/wiki-ingest.test.ts`
- Test: `scripts/wiki-handoff-sequence.test.ts` (new integration test)

**Approach:**

- The CLI reads `manifest.json` (`changed`, `deleted`) from the handoff directory after apply.
- It passes the handoff paths (without `log.md` and `index.md`) and the agent commit to `commitWikiChanges`. The commit layer resolves the agent commit and checks ancestry before its retry loop, raising `HANDOFF_BASE_INVALID`, then checks the handoff paths first on every attempt and raises `HANDOFF_PAGE_CHANGED`.
- Manifest page deletions are added to `deletedPaths`, because the porcelain filter still drops them.
- `scripts/wiki-ingest.ts` maps `HANDOFF_PAGE_CHANGED` to exit 3. The new error messages name no pages.

**Execution note:** Start with the integration tests that replay the 2026-10-20 and 2026-10-21 sequences and fail on the current code.

**Patterns to follow:**

- `assertWriteSetUnchanged`, which treats absence as a value, and `readCommitTreeSha`.
- The `merge-back-data.ts` tests on `scripts/git-data-fake.ts`.

**Test scenarios:**

- Integration (AE1, the 2026-10-20 sequence): two agents sync at S0. A persists, which moves the head. B's handoff carries a stale `log.md`, `index.md` and a page that only B edited. B lands, and `data` keeps A's log entries, A's index rows and A's pages, plus B's page and entry.
- Integration (AE2 first half, the 2026-10-21 sequence): A and B both edit `topics/github-actions-ci.md`. B is refused with `HANDOFF_PAGE_CHANGED`, nothing is committed, and the CLI exits 3.
- Integration (AE2 second half): B re-runs from a fresh sync at the new head, edits the same page, and lands. The page holds both contributions.
- Edge case: B's handed-off page changed after S0 and its log moved after its own sync. The refusal is `HANDOFF_PAGE_CHANGED` and exit 3, not `CONFLICT_EXHAUSTED`.
- Happy path (AE3): another writer changed only page Q after S1. Page P lands and Q's change stays.
- Edge case (AE4): B deletes page X after A edited it, so B is refused. In the reverse order, A deleted X and B edited it, and B is refused.
- Happy path: an agent deletion of an unchanged page is removed from `data`.
- Error path (AE5): an empty, malformed or unknown (404) SHA, or one that is not an ancestor, refuses with `HANDOFF_BASE_INVALID`. `bootstrapDataBranch` is not called and nothing is written.
- Error path: a ref race that exhausts retries still raises `CONFLICT_EXHAUSTED` and does not exit 3.

**Verification:**

- The integration test fails on the pre-change code and passes after the change. The `dist` check is clean.

- [x] **Unit 4: Re-dispatch a conflicting survey and retry it the next day**

**Goal:** A page conflict in survey persist triggers a bounded fresh survey run. A final conflict failure is eligible again the next day.

**Requirements:** R9, R10, R11

**Dependencies:** Unit 3

**Files:**

- Modify: `.github/workflows/survey-repo.yaml`
- Modify: `scripts/record-survey-result.ts`
- Modify: `scripts/repos-metadata.ts`
- Test: `scripts/survey-repo-workflow.test.ts`
- Test: `scripts/record-survey-result.test.ts`
- Test: `scripts/repos-metadata.test.ts`
- Test: `scripts/app-token-scope-guard.test.ts`

**Approach:**

- Add an `attempt` string input to `survey-repo.yaml` (default `'1'`), parsed strictly.
- The ingest step writes `conflict=true` on exit 3 and still fails. `survey-persist` declares `outputs.conflict`. The record step passes `SURVEY_CONFLICT`.
- Add `survey-redispatch` as described in Key Technical Decisions: `always() && !cancelled()` gating, the repo-expression mint and an `env`-passed dispatch on `main`.
- Leave the fro-bot ingest jobs unchanged. Their exit code already fails the run (R11).

**Patterns to follow:**

- The reconcile dispatch mint in `reconcile-repos.yaml`.
- The scope-guard table rows for dispatch mints.

**Test scenarios:**

- Happy path: with `survey-persist` failed, `conflict=true` and attempt `1`, the redispatch job runs and dispatches attempt `2` for the same `node_id`.
- Edge case: `survey-persist` failed without a conflict, so the redispatch job is skipped.
- Edge case (AE7): with attempt `3`, the redispatch job is skipped and the run fails.
- Error path: `attempt` values such as `0`, `4`, `abc` or `''` are rejected before any work runs.
- Happy path: a conflict result records `failure` with `next_survey_eligible_at` set to the next day. A non-conflict failure keeps the channel interval.
- Integration: the scope guard has a row for the new mint, with an exact permission and reach.

**Verification:**

- The workflow contract tests, the `record-survey-result` and `repos-metadata` tests, and the scope guard pass, and actionlint is clean.

- [x] **Unit 5: Stop asking agents to edit the index**

**Goal:** Agent prompts no longer ask for `index.md` edits. The log entry instruction stays.

**Requirements:** R4

**Dependencies:** Unit 2

**Files:**

- Modify: `.github/workflows/survey-repo.yaml`
- Modify: `.github/workflows/fro-bot.yaml`
- Test: `scripts/survey-repo-workflow.test.ts`
- Test: `scripts/fro-bot-workflow.test.ts`

**Approach:**

- Drop the index update step and `knowledge/index.md` from the "Modify only" line in the survey prompt, and drop `index.md` from the fro-bot prompts' permission lists. The prompts state that the writer maintains the index.

**Test scenarios:**

- Happy path: no agent prompt permits or instructs edits to `knowledge/index.md`, and the survey prompt still instructs appending a log entry.

**Verification:**

- The contract tests pin the prompt text.

- [x] **Unit 6: wiki-repair reloads the head and fails when it aborts**

**Goal:** A concurrent `data` write is retried from the current head, and an aborted repair fails the job after writing its JSON result.

**Requirements:** R12, R13

**Dependencies:** None

**Files:**

- Modify: `scripts/wiki-repair.ts`
- Test: `scripts/wiki-repair.test.ts`

**Approach:**

- On a tip mismatch, `loadTree` reads the wiki pages and `metadata/repos.yaml` at the current head through the Git Data API, failing closed on a truncated tree, and returns that head as `tipSha`. The first attempt keeps reading the restored checkout.
- Add `exitCodeFor(result)`, returning 1 when `aborted > 0` and `privacy_blocked` is 0. `main` sets `process.exitCode` from it after writing the JSON, and never calls `process.exit` on the success path.

**Patterns to follow:**

- `scripts/rename-tracked-repo.ts` `readSnapshot` for reading a head tree and blobs, with the truncation check.

**Test scenarios:**

- Integration (AE10): with the Git Data fake, a survey commit advances `data` after the restore. The repair reloads from the new head, keeps the survey's change, and lands on its second attempt.
- Error path: a truncated head tree aborts without a write.
- Error path (AE9): an aborted, non-privacy result gives `exitCodeFor` 1, and the JSON is still written.
- Happy path: a clean run, a privacy-leak abort, or a run with only `path_refused` gives 0.

**Verification:**

- The tests pass, and the `wiki-lint.yaml` summary step still runs, through `if: always()`.

## System-Wide Impact

- **Interaction graph:** survey persist, the fro-bot event and observe ingests, the handoff apply CLI, and `record-survey-result`. The new redispatch job adds a `workflow_dispatch` source for `survey-repo.yaml`.
- **Error propagation:** a page conflict exits 3. Survey maps it to a conflict output and a redispatch, and the fro-bot ingests fail the run. An invalid base fails without a redispatch.
- **State lifecycle risks:** a refused write commits nothing. `record-survey-result` still writes `failure` to `metadata/repos.yaml`, and the re-run overwrites it.
- **API surface parity:** `commitWikiChanges` gains an optional input, which is additive for external consumers of `@fro.bot/wiki-write-core`.
- **Integration coverage:** the replay test exercises apply, ingest and commit together on the Git Data fake.
- **Unchanged invariants:**
  - The #4032 base guard and `WIKI_INGEST_DATA_TIP_SHA` are unchanged.
  - The rename writer, merge-back and the drafted-solutions handoff are unchanged.
  - The handoff allowlist and manifest shape are unchanged.
  - Persist and ingest token scopes are unchanged.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| A deploy during a run in flight: the persist job uses new scripts but the old workflow, so there is no `WIKI_HANDOFF_BASE_SHA`, the write is refused, and the survey takes the normal failure cadence | Merge only when `gh run list` shows no in-progress survey or fro-bot runs. The schedules drift: reconcile's 05:17 cron has fired at about 10:07–10:48Z, and fro-bot's 00:00 cron at about 04:00Z |
| A hot shared page that more than 3 surveys in one batch edit exhausts its re-runs | Accept this. Reconcile dispatches at most 12 surveys per run, and the last attempt becomes eligible again the next day |
| A commit by another writer lands in the roughly 30 s between a writer's sync and its commit | Accept this. The #4032 guard refuses it as an ordinary failure with the normal cadence |
| The agent rewrites history in `log.md` | Its entries are dropped and the summary entry still lands, so no existing entry is lost |
| A runner-level tamper with the agent job's outputs | Out of scope. R5 is a guard against stale data, not a security boundary |
| The new dispatch mint holds `actions: write` | The reconcile writer already holds the same reach. The mint has a scope-guard row and is gated on `conflict` and `attempt < 3` |

## Documentation / Operational Notes

- Update the handoff description in the `scripts/wiki-handoff-core.ts` header so it says `log.md` and `index.md` are validated but never applied.
- After merge:
  - The `fix:` title publishes a patch release of `@fro.bot/wiki-write-core`.
  - Read back the first daily survey batch. Every survey's log entry and index rows should be on `data`.
  - Watch for any `HANDOFF_PAGE_CHANGED` run followed by a redispatch.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-10-21-wiki-writer-lost-updates-requirements.md](../brainstorms/2026-10-21-wiki-writer-lost-updates-requirements.md)
- Related code: `packages/wiki-write-core/src/wiki-ingest.ts`, `scripts/wiki-handoff-core.ts`, `.github/workflows/survey-repo.yaml`, `.github/workflows/fro-bot.yaml`, `scripts/record-survey-result.ts`, `scripts/wiki-repair.ts`
- Related issues and PRs: #4031, #4032
- External docs: <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs>, <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idoutputs>
