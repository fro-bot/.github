---
title: Suppress agent-authored wiki-ingest notice issues
date: 2026-06-14
status: ready
scope: lightweight
---

# Suppress agent-authored wiki-ingest notice issues

## Problem

Every survey cycle, the Survey Repo agent opens a GitHub issue summarizing the wiki
ingest it just performed (titles like `Wiki ingest: <repo>`, `[wiki-ingest] <repo>`,
`Wiki Ingest: <repo>`). These accumulate as board noise and require periodic manual
sweeping — 13 had piled up between 2026-06-05 and 2026-06-12.

The inconsistent title formats confirm these are **emergent agent behavior**, not a
control-plane feature: the survey workflow never asks for an issue.

## Root cause

`survey-repo.yaml`'s `INGEST_PROMPT` lists required outcomes as wiki-file updates only
(repo page, topic/entity pages, `knowledge/index.md`, `knowledge/log.md`). It does **not**
instruct the agent to open an issue. The agent self-elects to post a run-summary issue as
part of its default "report what I did" disposition.

Two facts make this a clean, single-site fix:

- The `fro-bot.yaml` ingest path runs `scripts/wiki-ingest.ts` directly (scripted commit,
  no agent prompt) — it does not post issues.
- The persona and `knowledge/schema.md` contain no instruction to post ingest issues.

So the only source is the survey agent driven by `INGEST_PROMPT`.

## Goal

Stop the per-survey notice issues at the source, with zero new machinery. The durable
ingest summary already lives in `knowledge/log.md`; the GitHub issue is pure duplication.

## Requirements

- **R1**: `survey-repo.yaml`'s `INGEST_PROMPT` gains an explicit constraint: record the
  ingest summary only in `knowledge/log.md`; do **not** open, comment on, or update a
  GitHub issue as a run notice.
- **R2**: The existing wiki-file required outcomes are unchanged — the log entry remains
  the canonical per-survey summary.
- **R3**: No scheduled sweep, no perpetual-issue machinery, no script changes. The change
  is confined to the prompt text.

## Non-goals

- No change to `fro-bot.yaml`'s scripted ingest path (it does not post issues).
- No retroactive cleanup automation — already-open notices were swept manually; future
  ones simply won't be created.
- No change to the daily report's perpetual-single-issue behavior (that is a deliberate,
  separate heartbeat).
- No agent-side (`fro-bot/agent`) changes — the constraint belongs in this repo's prompt,
  which is the authoritative instruction for the survey run.

## Success criteria

- **SC1**: After the change, a survey dispatch completes its wiki ingest (log entry
  written, wiki pages committed) and opens **no** GitHub issue.
- **SC2**: The `knowledge/log.md` entry still captures the survey summary.

## Open questions

None — mechanism, site, and scope are settled.
