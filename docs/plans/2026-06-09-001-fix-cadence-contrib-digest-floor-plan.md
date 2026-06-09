---
title: "fix: Contrib channel tracking, daily digest truthfulness, and floor retry loops"
type: fix
status: active
date: 2026-06-09
---

# fix: Contrib channel tracking, daily digest truthfulness, and floor retry loops

## Overview

Three interacting cadence/observability defects, diagnosed from live production evidence:

1. **Contrib repos mis-classified as collab.** The four `bfra-me` repos in `approved_contrib_repos` are tracked but counted under `collab`, so `byChannel.contrib.tracked` is `0` and they never get the faster 21-day contrib cadence.
2. **Daily digest is silent and mistimed.** It suppresses on zero-survey days and counts surveys for "today (UTC)" — but it runs at `00:00 UTC`, hours before the `~08:00 UTC` reconcile produces that day's surveys, so the count is structurally near-zero. The digest should post every day with a truthful count.
3. **Floor retry loops on hung surveys.** A dispatched survey that is cancelled or hard-timed-out never records a result, so its cadence never advances and the minimum-floor keeps retargeting the same broken repo daily.

## Problem Frame

The survey cadence floor is working (reconcile dispatches 2/day), but three layers above it are wrong: channel classification mis-buckets explicitly-approved contrib repos, the digest reports a misleading near-zero count and goes silent, and the floor has no guard against repeatedly retargeting a repo whose survey never completes. The fixes are independent and each is grounded in a confirmed root cause.

## Requirements Trace

- R1. `bfra-me` `approved_contrib_repos` are classified `contrib`, counted under `byChannel.contrib.tracked`, and surveyed on the contrib cadence (21d).
- R2. Already-tracked entries with a stale or missing `discovery_channel` are refreshed to their live channel during reconcile, and `next_survey_eligible_at` is recomputed for the new channel's interval.
- R3. The daily digest posts every scheduled day regardless of survey count.
- R4. The digest's `surveys_today` reflects a settled, truthful count (the prior UTC day's completed surveys), not a structurally-empty same-day count.
- R5. A cancelled or timed-out survey records a `failure` result so its cadence advances and the floor does not retarget it indefinitely.

## Scope Boundaries

- No change to the survey dispatch mechanism, the floor algorithm (`FLOOR_MIN`/`FLOOR_MIN_GAP_DAYS`), or channel interval constants.
- No change to the gateway payload schema (`surveys_today` field name stays for gateway compatibility; only its semantics — prior-day — change, documented in code).
- No change to the digest cron schedule (stays `0 0 * * * UTC`; the yesterday-count fix makes that timing truthful without a reschedule).

### Deferred to Separate Tasks

- **Stateful dispatch tracking (`last_dispatched_at` schema field + cooldown exclusion)**: deferred unless the Unit 3 workflow-hardening (Option B) proves insufficient. Adds schema surface and `data`-branch write contention; revisit only if hung surveys still cause retargeting after the failure-recording fix.

## Context & Research

### Relevant Code and Patterns

- `scripts/reconcile-repos.ts` — `mergeAccessChannels` (precedence collab>owned>contrib, the bug), `classifyTracked` (no channel-refresh for tracked entries), `byChannel` summary counting (`entry.discovery_channel ?? 'collab'`), `computeNextEligibleAt` import from `repos-metadata.ts`.
- `scripts/repos-metadata.ts` — `CHANNEL_INTERVAL_DAYS` (owned 14 / contrib 21 / collab 30), `computeNextEligibleAt` (deterministic jitter); the channel-refresh recompute must reuse this.
- `scripts/daily-digest-counts.ts` — `deriveCounts(yamlContent, todayUtc)`: `surveysToday` matches `last_survey_at === todayUtc` (L85-86); `should_post: surveysToday > 0` (the suppression).
- `.github/workflows/survey-repo.yaml` — `Record survey result` (L312-313) gates on `!cancelled() && ... recheck.conclusion == 'success'`; a cancelled/timed-out run skips it, never recording failure.
- `metadata/allowlist.yaml` — `approved_contrib_repos` lists the 4 bfra-me repos (confirmed).

### Institutional Learnings

- `docs/solutions/best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md` — channel-refresh writes existing entries; no schema change here, but the refresh is a one-time in-place migration of `discovery_channel` values.
- `docs/solutions/best-practices/autonomous-pipeline-minimum-progress-floor-2026-05-17.md` — the floor's retry-loop edge is the gap Unit 3 closes.

## Key Technical Decisions

- **Precedence flip to owned > contrib > collab**: an explicitly-approved channel (owned/contrib) must win over generic collaborator access. The bfra-me repos are collab-accessible AND contrib-approved; contrib is the intended identity.
- **Channel-refresh in `classifyTracked`**: flipping precedence fixes the access-list channel, but already-tracked entries carry a stored `discovery_channel` (or none → defaults collab). Refresh: if stored channel differs from live channel, update it, count `summary.refreshed`, and recompute `next_survey_eligible_at` for the new interval so the cadence shift takes effect immediately.
- **Digest counts prior UTC day**: at `00:00 UTC` the just-ended day is fully settled (its reconcile + surveys completed ~16h earlier). Counting `last_survey_at === yesterdayUtc` is truthful and race-free; same-day would always be ~0. The gateway field stays `surveys_today` (documented as "prior UTC day").
- **Remove `should_post` suppression**: the digest is a daily character moment; 0 surveys is valid signal. `should_post` becomes `count_status === 'ok'` (still suppress on a genuine read error).
- **Option B failure recording (not Option A schema)**: a final `if: cancelled() || failure()` cleanup step records a `failure` survey result when the normal record step didn't run, advancing cadence. Cheaper than a stateful `last_dispatched_at` field; no extra data-branch writes on the happy path.

## Open Questions

### Resolved During Planning

- Why is `contrib.tracked` 0? — `mergeAccessChannels` collab-first precedence + no refresh; verified the 4 entries have no `discovery_channel` on `data`.
- Is `committed:false` a bug? — No; stateless dispatch correctly produces a no-op commit. The real edge is the hung-survey retry loop (Unit 3).

### Deferred to Implementation

- Exact yesterday-derivation helper (UTC date subtraction) shape — implement against the injected `todayUtc` string; pin midnight-boundary tests.
- Whether the cleanup step in survey-repo can reuse `record-survey-result.ts` as-is with a forced `failure` status, or needs a thin guard for the "already recorded" case.

## Implementation Units

- [x] **Unit 1: Fix contrib channel precedence and refresh tracked entries**

**Goal:** bfra-me contrib repos classify as `contrib`, count under `byChannel.contrib.tracked`, and get the 21-day cadence; existing mis-classified entries self-heal on the next reconcile.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `scripts/reconcile-repos.ts`
- Test: `scripts/reconcile-repos.test.ts`

**Approach:**
- In `mergeAccessChannels`, reorder the merge loops to `owned` → `contrib` → `collab` (each later loop skips keys already claimed), and update the precedence doc-comment to `owned > contrib > collab`.
- In `classifyTracked`, for a still-accessible tracked entry whose stored `discovery_channel` differs from the live `accessChannelByKey` channel: set the new channel, increment `summary.refreshed`, and recompute `next_survey_eligible_at` via `computeNextEligibleAt` for the new channel/interval. Preserve reference identity when nothing changes (no-op probe).

**Patterns to follow:**
- Existing `classifyTracked` field-refresh blocks; `computeNextEligibleAt` call sites in `repos-metadata.ts`.

**Test scenarios:**
- Happy path: a repo in both `collab` access and `approved_contrib_repos` → merged channel is `contrib`.
- Happy path: `owned` wins over `contrib` wins over `collab` on triple overlap.
- Edge case: a tracked entry stored `collab` but now live `contrib` → refreshed to `contrib`, `summary.refreshed` incremented, `next_survey_eligible_at` recomputed for 21d.
- Edge case: a tracked entry with no stored `discovery_channel` (legacy) and live `contrib` → backfilled to `contrib` (not left defaulting to collab).
- Edge case: stored channel == live channel → no change, no spurious `refreshed`, reference identity preserved.
- Integration: full `handleReconcile` with the 4 bfra-me entries → `byChannel.contrib.tracked == 4`, `collab.tracked` reduced accordingly, metadata committed.

**Verification:**
- A reconcile against access including the bfra-me repos reports `byChannel.contrib.tracked >= 4` and recomputed eligibility on the refreshed entries.

- [x] **Unit 2: Daily digest counts prior UTC day and posts every day**

**Goal:** the digest fires daily with a truthful settled survey count.

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Modify: `scripts/daily-digest-counts.ts`
- Modify: `.github/workflows/fro-bot.yaml` (announce gate — drop `should_post` condition)
- Test: `scripts/daily-digest-counts.test.ts`

**Approach:**
- In `deriveCounts`, derive `yesterdayUtc` by subtracting one day from the injected `todayUtc` (string date math, UTC-safe), and match `last_survey_at === yesterdayUtc` for `surveys_today`. Document in JSDoc that `surveys_today` is the prior UTC day's settled count (field name retained for gateway compatibility).
- Change `should_post` to `count_status === 'ok'` (post on any successful read; suppress only on a genuine read error).
- In `fro-bot.yaml`, remove the `steps.digest-counts.outputs.should_post == 'true'` condition from the announce `if:` — keep `report_url != ''` and `DAILY_DIGEST_ENABLED == 'true'`. (Decision: keep gating on a resolved `report_url` so we never post a digest with an empty link; revisit only if that proves too strict.)

**Patterns to follow:**
- Existing `deriveCounts` UTC-date handling and the midnight-stability tests in `daily-digest-counts.test.ts`.

**Test scenarios:**
- Happy path: surveys with `last_survey_at == yesterdayUtc` are counted; today's are NOT.
- Happy path: zero prior-day surveys → `surveys_today: 0`, `should_post: true` (posts anyway).
- Edge case: `todayUtc` at month/year boundary (e.g. 2026-03-01 → counts 2026-02-28) → correct yesterday derivation.
- Edge case: malformed/missing metadata → `count_status: 'error'`, `should_post: false` (still suppress on real error).
- Error path: non-object `repos[]` element → fail-soft `count_status: 'error'`, no throw (existing guard preserved).

**Verification:**
- `daily-digest-counts.ts` against real data with `todayUtc=2026-06-09` reports the 2026-06-08 survey count and `should_post: true`. The announce step fires on a zero-count day in a dispatch/scheduled run (given `DAILY_DIGEST_ENABLED` + resolved `report_url`).

- [x] **Unit 3: Record failure on cancelled/timed-out surveys (close floor retry loop)**

**Goal:** a survey that is cancelled or hard-timed-out records a `failure` result so its cadence advances and the floor stops retargeting it.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `.github/workflows/survey-repo.yaml`
- Test: none (workflow-only; behavior verified operationally — see Verification)

**Approach:**
- Add a final cleanup step gated to run when the normal `Record survey result` step did NOT run because the job was cancelled or an earlier step failed (e.g. `if: cancelled() || (failure() && steps.record-result.outcome != 'success')`). It records a `failure` survey result for the repo (reusing `record-survey-result.ts` with `status=failure`), so `last_survey_at`/`next_survey_eligible_at` advance.
- Guard against double-recording when the normal record step already ran (key on its `outcome`/`conclusion`).
- The recorded node_id comes from the resolved survey inputs already present in the job (no new resolution).

**Patterns to follow:**
- The existing `Record survey result` step (L312) and its `record-survey-result.ts` invocation; the `if: always()`/`cancelled()` fail-soft patterns used elsewhere in the workflow.

**Test scenarios:**
- Test expectation: none — workflow-only orchestration change. The recording logic in `record-survey-result.ts` is already covered; this unit only adds a new trigger condition.

**Verification:**
- A manually-cancelled survey-repo run leaves the target repo with an advanced `last_survey_at`/`next_survey_eligible_at` and `last_survey_status: failure` on `data`, and the next reconcile does not immediately retarget it via the floor.

## System-Wide Impact

- **Interaction graph:** Unit 1 changes channel classification consumed by the floor/threshold dispatch selection and the `byChannel` summary; Unit 2 changes only the digest count + announce gate; Unit 3 adds a write-back path on abnormal survey termination.
- **State lifecycle risks:** Unit 1's refresh recomputes `next_survey_eligible_at` — must not reset a repo that's mid-cadence into perpetual eligibility; recompute is deterministic from the new channel. Unit 3 must not double-record (idempotency on the record step outcome).
- **API surface parity:** Unit 2 keeps the gateway `surveys_today` field name; only semantics change (documented).
- **Unchanged invariants:** floor algorithm, channel intervals, dispatch mechanism, gateway schema, digest cron — all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Channel-refresh resets cadence for many entries at once, bunching surveys | Recompute is deterministic per-channel with jitter; only mis-classified entries (the 4 bfra-me) refresh, bounded blast radius |
| Removing `should_post` floods the gateway on quiet days | Digest is once-daily; one post/day is the intended character cadence |
| Unit 3 cleanup step double-records or records on a healthy run | Gate strictly on the normal record step having NOT succeeded; key on its outcome |
| `report_url != ''` gate still suppresses the digest if discovery fails | Accepted — better to skip than post a linkless digest; report-url discovery is fail-soft and already hardened |

## Sources & References

- Origin: Oracle cadence/contrib/timing diagnostic (this session), root causes verified directly against `scripts/reconcile-repos.ts`, `metadata/allowlist.yaml`, and `origin/data` metadata.
- Related code: `scripts/reconcile-repos.ts`, `scripts/repos-metadata.ts`, `scripts/daily-digest-counts.ts`, `.github/workflows/survey-repo.yaml`, `.github/workflows/fro-bot.yaml`
