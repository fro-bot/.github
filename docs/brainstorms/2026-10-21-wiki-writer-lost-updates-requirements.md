---
date: 2026-10-21
topic: wiki-writer-lost-updates
---

# Wiki Writers Never Silently Overwrite Each Other

## Summary

Each writer to `knowledge/` on `data` commits only the pages it changed or deleted. It refuses when another writer changed one of those pages since the commit it read them from, and on every attempt it rebuilds `knowledge/log.md` and `knowledge/index.md` from the current head. When a page conflict refuses a survey or an ingest, that writer runs again from a fresh sync straight away, so no second agent run is put off to the next day.

---

## Problem Frame

Several jobs write `knowledge/` on `data`: survey persist, the two fro-bot ingest jobs, wiki-repair and the rename writer. Survey persist and the fro-bot ingest jobs apply pages that an agent edited in an earlier job. Each of these writers computes full file contents from a snapshot of the wiki and commits them onto whatever the head is when it writes. Every ingest also rewrites `log.md` (to add its entry) and `index.md` (to regenerate it).

Ingest's write set is not the set of pages it changed. It takes every page that `git status` reports as different between the synced `data` wiki and the `main` checkout. That set grows all week, until the next promotion makes `main` match `data` again. Each ingest therefore rewrites every page that changed on `data` since the last promotion, using the copy from its own sync. Deletions are filtered out, so a page that an agent deletes in a handoff is never removed from `data`.

The result is a daily loss. Reconcile dispatches surveys about 1.5 minutes apart, so their persist jobs overlap:

- On 2026-10-20 the systematic survey (`dcc9366`) dropped two log entries and two of the three index rows that the ha-config survey had just added (`1182a0b`).
- On 2026-10-21 the marcusrbrown survey (`0ac011e`) did the same to the infra survey (`b2a3dd7`). Both surveys edited `knowledge/wiki/topics/github-actions-ci.md`, so the infra survey's edit to that page was lost as well.

The log entry count did not change in either commit. The entries were replaced, not rotated out. They are still missing from `data`.

Since #4032, ingest and wiki-repair refuse a write when a path in their write set changed after the commit they synced. That turns the loss into a loud failure, but four problems remain:

- **Over-broad write set.** Because the write set covers every page that differs from `main`, an edit to any of those pages refuses an unrelated survey.
- **Agent handoffs.** The agent edits pages against its own sync. The writer then checks them against a later sync, so an edit that lands between the two syncs is overwritten. The base is chosen inside the agent job, and the handoff can also carry whole `log.md` and `index.md` files.
- **wiki-repair.** Its guard can never succeed after a concurrent write. It reloads the same pinned commit on every retry until it runs out of retries. It then exits 0, so the job looks green.
- **The rename writer.** It reads the head on each attempt and rebuilds the shared files correctly. On a race, though, it silently folds another writer's edit into a page it moves.

---

## Actors

- A1. Survey persist: applies one surveyed repo's agent-edited pages and adds a log entry and index rows. Several run at once every day.
- A2. Fro-bot ingest (event and observe): applies agent-edited pages and adds a log entry and index rows. It is triggered by events, and nothing re-dispatches it later.
- A3. Agent job: edits pages in its own checkout and hands them to A1 or A2 as an artifact. It can write anything in its own checkout and in that artifact.
- A4. wiki-repair: rewrites repairable pages and `index.md` after a lint run.
- A5. Rename writer: run by an operator. It moves a repo page, repairs links, and rewrites `log.md` and `index.md` together with `metadata/repos.yaml`.
- A6. Merge-back: copies `main` into `data` at the start of each promotion and keeps the data-owned paths. It changes no `knowledge/` content and needs no change here.

---

## Requirements

**Write set**

- R1. A writer commits only the pages it changed or deleted relative to its base. A page that differs from `main` but was not touched by the writer stays out of the write set.
- R2. Deletions are part of the write set. A page the writer deletes is removed from `data` and is checked under R8 in the same way as an edit.

**Shared files**

- R3. On every attempt, the writer reads `log.md` and `index.md` from the current head, not from its checkout or a handoff.
- R4. The writer appends its own log entries to the head's `log.md`. Every entry already on the head survives, in its original order.
- R5. The writer rebuilds `index.md` from the head's pages plus its own write set. Rows that other writers added survive. Rows for pages that are absent once the commit lands are dropped.
- R6. Handoffs do not carry `log.md` or `index.md`.
- R7. On each attempt, wikilinks in the writer's pages are checked against the head's pages.

**Pages**

- R8. When another writer changed or deleted a page in the write set after the writer's base, the writer refuses the write and makes no commit. Concurrent writers' page contents are never merged.
- R9. The base for agent-handed-off pages is the commit that the agent job synced before the agent ran. It comes from a source the agent cannot write, never from the artifact.
- R10. The base must be a `data` commit that is the head itself or one of its ancestors. A missing, empty or unknown base refuses the write and never falls back to an unguarded write. The first creation of `data` is the only exception.

**Retry**

- R11. When only the head moved, and none of the writer's pages changed, the writer retries with jittered backoff and rebuilds the shared files each time. The retry bound covers a normal daily survey batch.
- R12. When a page conflict refuses a survey or a fro-bot ingest, that writer runs again from a fresh sync without waiting for the next reconcile. The re-run does not take a slot from another repo's survey.
- R13. Re-runs are bounded. When a writer still conflicts after its last re-run, it fails loudly, and the survey falls back to the next day's re-dispatch.

**Other writers**

- R14. wiki-repair reads the current head on every attempt, including `metadata/repos.yaml` and the other inputs its repairs depend on, and re-derives its repairs on that head.
- R15. wiki-repair fails the job when it runs out of retries.
- R16. The rename writer refuses when a page it moves or rewrites has changed since its first attempt read it. It keeps rebuilding `log.md` and `index.md` from the head on each attempt.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R4, R5, R11.** Two surveys start 1.5 minutes apart and write different pages. Both land. `data` then holds both surveys' log entries and both surveys' index rows.
- AE2. **Covers R1.** During the week, page P changes on `data` and still differs from `main`. A survey that does not touch P lands, and P keeps its `data` content.
- AE3. **Covers R8, R12.** Two surveys both edit `topics/github-actions-ci.md`, and the second one is refused. It re-runs from a fresh sync, lands, and the page then has both surveys' contributions.
- AE4. **Covers R8, R9.** An agent job syncs at S1 and edits a topic page. Another writer changes that page at S2. The ingest refuses, because the page changed between S1 and the head.
- AE5. **Covers R1, R9.** An agent job syncs at S1 and edits page P. Another writer changes only page Q. The ingest lands P and keeps Q's change.
- AE6. **Covers R2, R8.** One writer deletes a page and another edits it. Whichever lands second is refused, in both orders.
- AE7. **Covers R9, R10.** The handoff names a later commit that already contains a concurrent change, or the base is empty. The write is refused.
- AE8. **Covers R14.** wiki-repair restores at S1. A survey that touches none of the repair's pages lands at S2. The repair reads the head, re-derives its repairs and lands.
- AE9. **Covers R5.** A page is deleted on `data` after the writer synced, and the writer then lands. `index.md` has no row for that page.
- AE10. **Covers R13.** A survey conflicts on its last allowed re-run. The run fails loudly, and the next reconcile re-dispatches it.

---

## Success Criteria

- Over a live daily survey batch where persist jobs overlap, every survey lands on its first attempt or on its re-run. Every log entry, index row and page edit it wrote is present on `data` afterwards.
- No writer can land a page that another writer changed after its base. AE1 through AE10 each have a test that fails without the change.
- Planning can tell, without inventing behavior, which writers retry, which re-run, which refuse, and what each one leaves on `data`.

---

## Scope Boundaries

- Merging page content between concurrent writers.
- Serializing writers through a shared concurrency group.
- Changing the drafted-solutions handoff, which writes `docs/solutions/` drafts and not `knowledge/`.
- Survey's overlay of `metadata/` from a later fetch, which changes no wiki content.
- The first creation of `data`. The branch can no longer be deleted, so this only happens during disaster recovery.
- Recovering the log entries, index rows and the topic-page edit lost on 2026-10-20 and 2026-10-21. The next survey of those repos rewrites their pages.
- Changing how refusals are reported. Existing messages stay as they are.

---

## Key Decisions

- **Write set = the writer's own changes.** Most conflicts and most of the historical loss came from rewriting pages the writer never touched. Narrowing the write set removes them without any merging.
- **Shared files are always built from the head.** The rename writer already works this way and a test pins it. `index.md` can be derived from pages, while `log.md` is append-only and cannot be. So the writer re-appends its own entries and rebuilds the index, and never replays either file.
- **Fail closed on page conflicts, then re-run straight away.** Merging two edits to the same page takes judgment, so a re-run from a fresh sync lets the agent incorporate the other writer's change. Waiting a day would cost the same agent run and could push another repo out of the daily queue.
- **The base comes from a trusted source.** The agent can rewrite its checkout and its artifact, so a base recorded there could hide a concurrent change. The base therefore comes from the agent job's sync step, which completes before the agent starts.
- **No serialization.** GitHub keeps one pending run per concurrency group and cancels the older one, so serializing writers would drop surveys silently.

---

## Dependencies / Assumptions

- Survey persist, both fro-bot ingest jobs and wiki-repair commit through `commitWikiChanges` in `@fro.bot/wiki-write-core`. Changing it ships a patch release.
- The rename writer has its own Git Data commit path in `scripts/rename-tracked-repo.ts`. That path already reads the head and rebuilds the shared files on each attempt.
- `sync-wiki` outputs the synced `data` commit (`data-sha`). The agent jobs' sync steps have no step id today, so their output is not yet reachable.
- Reconcile re-dispatches any repo whose last survey status is not `success`.
- The `data` wiki holds about 52 pages, so reading the head's pages on a retry is cheap.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3, R4, R5][Technical] Should the commit layer take a rebuild callback, or structured log and page inputs, or should callers re-run the builder on each attempt?
- [Affects R9][Technical] How does the agent job's sync SHA reach the writer: a job output passed through `needs`, or another channel the agent cannot write?
- [Affects R12, R13][Technical] What mechanism re-runs a refused survey or ingest from a fresh sync, and how many re-runs are allowed?
- [Affects R11][Technical] What retry bound and backoff cover a normal survey batch?
- [Affects R14][Technical] Should wiki-repair re-fetch and restore `data`, or read the head through the API?
- [Affects R9, R10][Technical] Handoffs already in flight during the deploy have no trusted base and will refuse once. Accept that, or drain the batch first?

---

## Sources / Research

- Loss evidence: `origin/data` commits `1182a0b` → `dcc9366` (2026-10-20) and `b2a3dd7` → `0ac011e` (2026-10-21). Survey runs 39405714364, 39405901498, 39583085685 and 39583278657.
- Write set and deletions: `getChangedWikiPaths` and `parsePorcelainPaths` in `packages/wiki-write-core/src/wiki-ingest.ts`.
- Guard from #4032: `baseCommitSha` in `commitWikiChanges`, `WIKI_INGEST_DATA_TIP_SHA`, and `WIKI_REPAIR_DATA_TIP_SHA` in `.github/workflows/wiki-lint.yaml`.
- Handoff allowlist and manifest: `scripts/wiki-handoff-core.ts`.
- wiki-repair loader and abort result: `scripts/wiki-repair.ts`.
- Rename rebuild-per-attempt precedent: `scripts/rename-tracked-repo.ts` and its test that preserves a concurrent log entry.
- Survey re-dispatch rule: `scripts/reconcile-repos.ts`.
- Prior decisions: `docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md` (index is derivable, log is append-only), `docs/brainstorms/2026-10-20-keep-data-branch-present-requirements.md`, and `docs/solutions/best-practices/agent-drafts-trusted-publish-split-2026-10-10.md` (pinned draft base with a same-path drift refusal).
- Tracking issue: #4031.
