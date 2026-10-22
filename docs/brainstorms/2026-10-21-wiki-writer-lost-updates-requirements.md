---
date: 2026-10-21
topic: wiki-writer-lost-updates
---

# Wiki Writers Never Silently Overwrite Each Other

## Summary

The trusted writer takes only the agent's edited pages, its deletions and the log entries it appended. It builds `knowledge/log.md` and `knowledge/index.md` from its own fresh sync of `data`. Before committing, it checks every handed-off page against the commit the agent started from. If another writer changed one of those pages, the writer refuses. A survey that conflicts re-runs straight away from a fresh sync.

---

## Problem Frame

Survey persist and the two fro-bot ingest jobs apply wiki pages that an agent edited in an earlier job. The survey prompt tells the agent to update `knowledge/index.md` and append to `knowledge/log.md`, and the fro-bot prompts allow it to. The handoff allowlist admits both files. The agent's handoff therefore carries whole copies of `log.md`, `index.md` and every page it touched, taken from the agent's own sync. The trusted writer syncs `data` again, applies those copies on top, and commits.

Reconcile dispatches surveys about 1.5 minutes apart. Each agent runs for 6–8 minutes, so the second agent syncs before the first survey persists. The persist jobs themselves run one after another and do not overlap. When the second survey persists, it applies its stale copies over the first survey's fresh commit:

- On 2026-10-20 the systematic survey (`dcc9366`) dropped the ha-config survey's two log entries and two of its three index rows (`1182a0b`).
- On 2026-10-21 the marcusrbrown survey (`0ac011e`) did the same to the infra survey (`b2a3dd7`). Both surveys had edited `knowledge/wiki/topics/github-actions-ci.md`, so the infra survey's edit to that page was lost too.

The log entry count did not change in either commit. The entries were replaced, not rotated out, and they are still missing from `data`.

The guard added in #4032 does not catch this. It compares against the writer's own sync, and the stale bytes come from the artifact, so the loss continues every day.

Two smaller problems sit in the same writers:

- **Deletions are lost.** Ingest takes its write set from `git status` and filters out deletions, so a page an agent deletes in a handoff is never removed from `data`.
- **wiki-repair cannot survive a concurrent write.** It pins the tip it restored, aborts when `data` moves, and exits 0, so the job still looks green.

---

## Actors

- A1. Survey persist: applies one surveyed repo's agent-edited pages and adds a log entry and index rows. Reconcile dispatches several every day, minutes apart.
- A2. Fro-bot ingest: applies agent-edited pages and adds a log entry and index rows. The observe ingest runs on the daily schedule, and the event ingest runs on issue, PR and discussion events.
- A3. Agent job: edits pages in its own checkout and hands them to A1 or A2 as an artifact. It can write anything in that checkout and artifact.
- A4. wiki-repair: rewrites repairable pages and `index.md` after a lint run.

---

## Requirements

**Handoff contents**

- R1. A handed-off `log.md` or `index.md` is never applied as a file. The writer uses only the agent's pages, its page deletions, and the log entries the agent appended.
- R2. The agent's appended entries are the text its `log.md` adds after the `log.md` at the agent's starting commit. If the agent changed anything before that point, its entries are dropped.
- R3. Ingest builds `log.md` and `index.md` from the writer's own sync of `data`. It appends the agent's entries and its own summary entry. Every entry already on `data` survives, in its original order.
- R4. The agent prompts stop asking for edits to `index.md`. Handoffs built before this change apply unchanged under R1 and R2.

**Page check**

- R5. Each handed-off page and deletion is checked against the commit the agent job synced before the agent ran. That commit comes from the agent job's sync step, not from the artifact.
- R6. If a handed-off page was edited or deleted on `data` after that commit, the writer refuses and commits nothing. Page contents are never merged between writers.
- R7. A missing, empty or unknown agent commit refuses the write, as does one that is not the head of `data` or one of its ancestors.
- R8. Pages the agent deletes are removed from `data`.

**After a conflict**

- R9. When R6 refuses a survey, the survey re-runs straight away with a fresh agent run, up to a fixed number of attempts. It does not wait for the next reconcile.
- R10. A survey that still conflicts after its last attempt fails loudly and becomes eligible again the next day, not after the 14–30 day interval that applies to other survey outcomes.
- R11. When R6 refuses an observe or event ingest, the run fails loudly and does not re-run.

**wiki-repair**

- R12. wiki-repair fails the job when it aborts.
- R13. wiki-repair reads the current head of `data` on each attempt, so a concurrent write is retried rather than aborting.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R6.** Survey A's agent syncs. Survey B's agent syncs, and B's agent edits page Q. Survey A persists. Survey B persists. `data` keeps both surveys' log entries and index rows, along with A's pages and B's page Q.
- AE2. **Covers R6, R9.** Surveys A and B both edit `topics/github-actions-ci.md`, and A persists first. B is refused, re-runs from a fresh sync, and lands. The page then holds both contributions.
- AE3. **Covers R5, R6.** An agent job syncs at S1 and edits page P. Another writer changes only page Q. The writer lands P and keeps the change to Q.
- AE4. **Covers R6, R8.** One writer deletes a page and another edits it. Whichever lands second is refused, in both orders.
- AE5. **Covers R7.** The agent commit is empty, unknown, or not an ancestor of the `data` head. The write is refused.
- AE6. **Covers R2, R4.** An agent rewrites an older log entry as well as appending its own. Its entries are dropped, the writer's summary entry lands, and every existing entry on `data` is intact.
- AE7. **Covers R10.** A survey conflicts on its last attempt. The run fails loudly, and the next reconcile re-dispatches it.
- AE8. **Covers R11.** An event ingest is refused. The run fails loudly and is not re-run.
- AE9. **Covers R12.** wiki-repair aborts, and the job fails.
- AE10. **Covers R13.** A survey commits to `data` while wiki-repair runs. The repair re-reads the head and lands on its retry.

---

## Success Criteria

- After a live daily survey batch, every survey's log entry, index rows and page edits are on `data`. Each survey lands either first time or after a re-run.
- AE1 through AE10 each have a test that fails without the change. AE1 reproduces the 2026-10-20 sequence, and AE2 reproduces 2026-10-21.
- Planning can tell, without inventing behavior, what a handoff carries, which writers refuse, which survey re-runs, and what each leaves on `data`.

---

## Scope Boundaries

- Serializing writers through a shared concurrency queue. Neither incident involved overlapping writers. The roughly 30-second window between a writer's sync and its commit stays covered by the #4032 guard, which refuses loudly.
- Rebuilding shared files inside the commit layer on every attempt.
- Merging page content between writers.
- Re-running observe or event ingests. A re-run would repeat the daily report issue and the digest announce, and a dispatch cannot reproduce an event payload.
- The rename writer. It already rebuilds the log and index from the head on each attempt and takes no handoff.
- The drafted-solutions handoff, which writes `docs/solutions/` drafts, not `knowledge/`.
- Recovering the entries, rows and page edit lost on 2026-10-20 and 2026-10-21. The next survey of those repos rewrites their pages.

---

## Key Decisions

- **Fix the handoff, not the timing.** The writers that lost data did not overlap. The stale bytes came from the artifact, so the artifact stops carrying the shared files, and its pages are checked against the agent's starting commit.
- **The agent's log entries are derived, not shipped.** The agent's entry is the detailed record of each survey, while the workflow summary is a fixed one-liner. Taking only what the agent appended, measured against its starting commit, keeps that detail, needs no prompt or artifact change, and works for artifacts built before the deploy.
- **Fail closed on page conflicts, then re-run the survey.** Reconciling two edits to one page needs judgment. The re-run lets the agent start from the other survey's change, and waiting would cost the same agent run and a slot in a later batch.
- **Conflict failures retry the next day.** A conflict is transient, so the 14–30 day interval used for other failures would be the wrong penalty.
- **The agent's commit comes from the sync step.** The agent can rewrite its checkout and artifact, but the sync step finishes before the agent starts, and its job output carries the commit.

---

## Dependencies / Assumptions

- Survey persist and both fro-bot ingest jobs commit through `commitWikiChanges` in `@fro.bot/wiki-write-core`. Changing it ships a patch release.
- `sync-wiki` outputs the synced `data` commit (`data-sha`). The agent jobs' sync steps have no step id today, so that output isn't yet reachable.
- A recorded survey failure currently sets the next eligible date 14, 21 or 30 days out depending on channel. R10 needs a separate path for conflict failures.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9][Technical] How is the re-run dispatched, how is the attempt counted, and what is the bound?
- [Affects R6][Technical] How does the writer tell a page conflict apart from the #4032 guard's own refusal and from a ref-race exhaustion, so that only page conflicts re-run?

---

## Sources / Research

- Loss evidence: `origin/data` commits `1182a0b` → `dcc9366` (2026-10-20) and `b2a3dd7` → `0ac011e` (2026-10-21).
- Job timings from survey runs 39405714364, 39405901498, 39583085685 and 39583278657: the agent jobs overlap, the persist jobs do not.
- The survey prompt's instructions to edit `index.md` and `log.md` are in `.github/workflows/survey-repo.yaml`. The handoff allowlist is in `scripts/wiki-handoff-core.ts`.
- Write set and deletion filter: `getChangedWikiPaths` and `parsePorcelainPaths` in `packages/wiki-write-core/src/wiki-ingest.ts`.
- Survey cadence: `computeNextEligibleAt` and `CHANNEL_INTERVAL_DAYS` in `scripts/repos-metadata.ts`.
- wiki-repair abort result: `scripts/wiki-repair.ts`.
- Prior decisions: `docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md` (the index can be derived, the log is append-only) and `docs/solutions/best-practices/agent-drafts-trusted-publish-split-2026-10-10.md` (trusted pinned base).
- Tracking issue: #4031.
