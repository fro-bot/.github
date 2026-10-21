---
date: 2026-10-21
topic: wiki-writer-lost-updates
---

# Wiki Writers Never Silently Overwrite Each Other

## Summary

Jobs that write `knowledge/` on `data` take turns through one shared queue. Each writer reads `data` during its own turn, so the log, the index and any pages it rebuilds always start from the current head. Pages an agent handed off get checked against the commit the agent started from. If another writer changed one of those pages in the meantime, the writer refuses, and a survey or scheduled ingest re-runs from a fresh sync straight away.

---

## Problem Frame

Several jobs write `knowledge/` on `data`: survey persist, the two fro-bot ingest jobs, wiki-repair and the rename writer. Survey persist and the fro-bot ingest jobs apply pages that an agent edited in an earlier job. Each writer computes full file contents from a snapshot of the wiki, then commits them onto whatever the head is when it writes. Every ingest also rewrites `log.md`, appending its entry, and regenerates `index.md`.

Ingest's write set is not the set of pages it changed. It takes every page that `git status` reports as different between the synced `data` wiki and the `main` checkout, and that set keeps growing until the weekly promotion. Each ingest therefore rewrites every page that changed on `data` since the last promotion, using its own sync's copy. Deletions are filtered out, so a page that an agent deletes in a handoff is never removed from `data`.

The result is a daily loss. Reconcile dispatches surveys about 1.5 minutes apart, and their persist jobs overlap:

- On 2026-10-20 the systematic survey (`dcc9366`) dropped two log entries and two of the three index rows that the ha-config survey had just added (`1182a0b`).
- On 2026-10-21 the marcusrbrown survey (`0ac011e`) did the same to the infra survey (`b2a3dd7`). Both surveys edited `knowledge/wiki/topics/github-actions-ci.md`, so the infra survey's edit to that page was lost too.

The log entry count did not change in either commit, so the entries were replaced, not rotated out. They are still missing from `data`.

Since #4032, ingest and wiki-repair refuse a write when a path in their write set has changed since the commit they synced. That makes the loss loud, but it leaves these problems:

- **Overlapping writers.** Two overlapping surveys now fail instead of losing data. The second one fails even when it touched none of the first one's pages, because the shared `log.md` and `index.md` moved under it.
- **Agent handoffs.** The agent edits pages against its own sync, and the writer then checks those pages against a later sync. An edit that lands between the two syncs is overwritten. The handoff can also carry whole `log.md` and `index.md` files.
- **wiki-repair.** After a concurrent write it reloads the same pinned commit on every retry until it gives up. It then exits 0, so the job looks green.
- **The rename writer.** On a race it silently folds another writer's edit into a page it moves.

---

## Actors

- A1. Survey persist: applies one surveyed repo's agent-edited pages and adds a log entry and index rows. Several run every day, dispatched minutes apart.
- A2. Fro-bot ingest: applies agent-edited pages and adds a log entry and index rows. The observe ingest runs on the daily schedule. The event ingest runs on issue, PR and discussion events.
- A3. Agent job: edits pages in its own checkout and hands them to A1 or A2 as an artifact. It can write anything in its checkout and in that artifact.
- A4. wiki-repair: rewrites repairable pages and `index.md` after a lint run.
- A5. Rename writer: run by an operator. It moves a repo page, repairs links, and rewrites `log.md` and `index.md` together with `metadata/repos.yaml`.
- A6. Merge-back: copies `main` into `data` at the start of each promotion and keeps the data-owned paths. It changes no `knowledge/` content and stays outside the queue.

---

## Requirements

**Writer queue**

- R1. Every job that writes `knowledge/` on `data` (A1, A2, A4 and A5) runs in one shared queue. Only one runs at a time, and waiting writers keep their place and are never dropped.
- R2. Each writer reads `data` inside its turn. The `log.md`, `index.md` and pages it writes start from the current head.

**Agent pages**

- R3. Handed-off pages are checked against the commit the agent job synced before the agent ran. That commit comes from a source the agent cannot write, never from the artifact. It must be the head of `data` or one of its ancestors. A missing, empty or unknown base refuses the write.
- R4. If a handed-off page was edited or deleted on `data` after that base, the writer refuses and commits nothing. Page contents from concurrent writers are never merged.
- R5. Pages the agent deletes are removed from `data`.
- R6. Handoffs do not carry `log.md` or `index.md`.

**Re-run**

- R7. If R4 refuses a survey, the survey runs again straight away with a fresh agent run. It does not wait for the next reconcile and does not take another repo's slot.
- R8. If R4 refuses the scheduled observe ingest, it runs again the same way, without re-running remediation.
- R9. Re-runs are bounded. When a writer still conflicts after its last re-run, it fails loudly, and a survey falls back to the next day's re-dispatch.
- R10. An event-triggered ingest that R4 refuses fails loudly and is not re-run.

**wiki-repair**

- R11. wiki-repair fails the job when it aborts.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Two surveys start 1.5 minutes apart and write different pages. Both land, and `data` holds both log entries and both sets of index rows.
- AE2. **Covers R1.** One writer runs while three more wait. All four land, one after another, and none is cancelled.
- AE3. **Covers R4, R7.** Two surveys edit `topics/github-actions-ci.md` and the second one is refused. It re-runs from a fresh sync and lands, and the page then holds both surveys' contributions.
- AE4. **Covers R3, R4.** An agent job syncs at S1 and edits a topic page. Another writer changes that page at S2. The ingest refuses.
- AE5. **Covers R3.** An agent job syncs at S1 and edits page P. Another writer changes only page Q. The ingest lands P and keeps the change to Q.
- AE6. **Covers R4, R5.** One writer deletes a page while another edits it. Whichever lands second is refused, in both orders.
- AE7. **Covers R3.** The base is empty, unknown, or not an ancestor of the `data` head. The write is refused.
- AE8. **Covers R9.** A survey conflicts again on its last allowed re-run. The run fails loudly, and the next reconcile re-dispatches it.
- AE9. **Covers R10.** An event ingest is refused. The run fails loudly and is not re-run.
- AE10. **Covers R11.** wiki-repair aborts, and the job fails.

---

## Success Criteria

- On a live daily survey batch, every survey lands either first time or after a re-run. Every log entry, index row and page edit it wrote is present on `data` afterwards.
- No writer can land a handed-off page that another writer changed after the agent's base. AE1 and AE3–AE10 each have a test that fails without the change, and AE2 is shown by a live queued batch.
- Planning can tell, without inventing behavior, which writers queue, which re-run, which refuse, and what each one leaves on `data`.

---

## Scope Boundaries

- Merging page content between concurrent writers.
- Re-running event-triggered ingests.
- Rebuilding shared files inside the commit layer on every attempt. The queue makes this unnecessary.
- The drafted-solutions handoff, which writes `docs/solutions/` drafts, not `knowledge/`.
- Survey's overlay of `metadata/` from a later fetch. It changes no wiki content.
- The first creation of `data`. The branch can no longer be deleted, so this only happens during disaster recovery.
- Recovering the log entries, index rows and topic-page edit lost on 2026-10-20 and 2026-10-21. The next survey of those repos rewrites their pages.

---

## Key Decisions

- **Serialize the writers with a queue.** GitHub concurrency groups now support `queue: max`, which holds up to 100 waiting jobs and runs them in order instead of cancelling the older pending one. Writer jobs are short, so queueing them makes each writer's read and commit atomic with respect to the other writers. That removes the shared-file and stale-tip races without new commit-layer machinery. An earlier draft rejected serialization because pending runs were dropped, but that is no longer how GitHub behaves.
- **The agent jobs stay out of the queue.** They run for minutes, and their pages are covered by the base check in R3 and R4.
- **Fail closed on page conflicts, then re-run straight away.** Reconciling two edits to one page takes judgment, so the re-run lets the agent work from the other writer's change. Waiting a day costs the same agent run and can push another repo out of that day's queue.
- **Event ingests are not re-run.** A dispatch cannot reproduce the event payload, and re-running the whole run repeats whatever the agent posted. Conflicts there need a concurrent write to the same page within a few minutes.
- **The base comes from a trusted source.** The agent can rewrite its checkout and artifact, so the base comes from the agent job's sync step, which finishes before the agent starts.
- **Merge-back stays outside the queue.** It changes no `knowledge/` content. Its ref update is a compare-and-swap, and the #4032 guard covers any race with a writer.

---

## Dependencies / Assumptions

- `queue: max` is documented in GitHub's workflow syntax and the 2026-05-07 changelog, which says it covers queued jobs as well as runs. Job-level use is confirmed by a live run after merge.
- The pinned actionlint (1.7.12, the latest release) rejects the `queue` key. Its upstream fix is unmerged, so actionlint needs a scoped ignore for that one error.
- Survey persist, both fro-bot ingest jobs and wiki-repair commit through `commitWikiChanges` in `@fro.bot/wiki-write-core`. Changing it ships a patch release.
- `sync-wiki` outputs the synced `data` commit (`data-sha`). The sync steps in the agent jobs have no step id, so that output is not yet reachable.
- Reconcile re-dispatches any repo whose last survey status is not `success`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Which commit should the guard use for pages the writer derives itself, as opposed to pages that were handed off?
- [Affects R7, R8, R9][Technical] Choose the dispatch mechanism, the attempt input and the re-run bound for surveys and the observe ingest.
- [Affects R3][Technical] Handoffs already in flight during the deploy have no trusted base and will refuse once. Accept that, or drain the batch first?

---

## Sources / Research

- Loss evidence: `origin/data` commits `1182a0b` → `dcc9366` (2026-10-20) and `b2a3dd7` → `0ac011e` (2026-10-21); survey runs 39405714364, 39405901498, 39583085685 and 39583278657.
- Write set and deletions: `getChangedWikiPaths` and `parsePorcelainPaths` in `packages/wiki-write-core/src/wiki-ingest.ts`.
- The #4032 guard: `baseCommitSha` in `commitWikiChanges` and `WIKI_INGEST_DATA_TIP_SHA`.
- Handoff allowlist and manifest: `scripts/wiki-handoff-core.ts`.
- wiki-repair loader and abort result: `scripts/wiki-repair.ts`.
- Survey re-dispatch rule: `scripts/reconcile-repos.ts`.
- GitHub concurrency queue: <https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/>; actionlint issues rhysd/actionlint#657 and #746.
- Prior decisions: `docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md` (index is derivable, log is append-only), `docs/brainstorms/2026-10-20-keep-data-branch-present-requirements.md`, and `docs/solutions/best-practices/agent-drafts-trusted-publish-split-2026-10-10.md` (trusted pinned base).
- Tracking issue: #4031.
