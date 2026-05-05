---
title: Survey cadence + multi-channel discovery
type: feat
status: draft
date: 2026-05-04
---

## Problem

The wiki has gone dark for stretches and the access surface no longer matches where Fro Bot actually operates.

**Cadence problem.** Reconcile uses a single 30-day staleness threshold per entry. When most repos get surveyed in the same short window, they all become re-eligible in the same short window 30 days later. Between those windows, no surveys fire. Operationally this looks like "Fro Bot stopped working" even when reconcile reports `success`. The current data confirms this: 18 of 21 onboarded repos were last surveyed 2026-04-27, the latest cron at 2026-05-04 dispatched zero, and the next dispatch wave isn't expected until 2026-05-27.

**Reach problem.** Fro Bot's tracked-repo list only covers user-account collaborator invitations. Two real access channels are missing:

- **Owned org.** `fro-bot/agent`, `fro-bot/systematic`, `fro-bot/.github`, `fro-bot/fro-bot.github.io` — the control plane and the agent itself are not in the wiki.
- **Cross-org contribution.** Repos like `bfra-me/.github` and `bfra-me/renovate-action` already invoke `fro-bot/agent` via `.github/workflows/fro-bot.yaml`. Fro Bot is operating in those repos as a service but has no presence in the wiki.

These are one initiative, not two. Fixing cadence without expanding reach leaves the wiki small. Expanding reach without fixing cadence makes the herd worse. Both must move together.

## Goals

- Surveys fire on most days instead of in herds. Weekly wiki growth becomes visible week over week.
- Fro Bot's own org repos appear in the wiki under the same lifecycle as collaborator repos.
- Operator-allowlisted cross-org repos appear in the wiki under the same lifecycle.
- Every entry in the tracked list records which discovery channel surfaced it, so reports and per-channel tuning are possible.

## Non-Goals

- **Self-survey of `fro-bot/.github`.** Discovery skips this repo. Possibly revisited as a separate question after the rest stabilizes.
- **Per-page-type stale thresholds.** Cadence is per-repo only. Page-type intervals (repos vs topics vs entities) belong to the wiki-lint follow-on plan if they ever become a thing.
- **Auto-removal beyond the existing `lost-access` flow.** A contrib repo whose `fro-bot.yaml` disappears does not auto-leave the list. Operators remove entries explicitly.
- **Changes to the `data → main` promotion model.** Branch protection, merge-data cadence, and the wiki authority guard are unchanged.
- **Real-time activity signals.** Cadence is time-based with jitter. No new telemetry pipeline. Activity-driven freshening is a future plan if needed.
- **Discovery outside the explicit allowlist.** No probing of random orgs Fro Bot was once installed in. Contributor probes only run against orgs/repos the operator has named.

## Users and Stakeholders

- **Operator (Marcus).** Wants the wiki to grow continuously and to see Fro Bot present where it is being used. Explicitly opts repos in via metadata edits.
- **Fro Bot agent.** Reads the wiki for cross-repo context during PR review, issue triage, and scheduled oversight. Better coverage and freshness directly improve the agent's usefulness.
- **Future readers (humans + agents).** Treat the wiki as the canonical narrative of what Fro Bot has touched. The doc must reflect actual reach.

## Success Criteria

| # | Criterion | Verification |
| --- | --- | --- |
| SC1 | Two weeks after rollout, scheduled reconcile runs dispatch surveys on most days, with no five-day-or-longer zero-dispatch gap unrelated to upstream rate limits. | Daily reconcile JSON output shows non-zero dispatches on a clear majority of days. |
| SC2 | Wiki pages exist for all non-archived repos in the `fro-bot` org except `fro-bot/.github`. | `knowledge/wiki/repos/` listing includes `fro-bot--agent.md`, `fro-bot--systematic.md`, `fro-bot--fro-bot.github.io.md`. |
| SC3 | Wiki pages exist for every operator-allowlisted cross-org repo whose access probe succeeded. | `knowledge/wiki/repos/` listing matches the allowlisted set; mismatches surface as `lost-access` entries. |
| SC4 | Each entry in `metadata/repos.yaml` records its discovery channel. Reports and reconcile JSON output can break activity down by channel. | Every entry has a `discovery_channel` (or equivalent) field; reconcile output reports per-channel counts. |

## Functional Requirements

### Discovery

- **R1.** Reconcile gains three discovery channels into a single `metadata/repos.yaml` list:
  - **Channel `collab`** — current behavior. Collaborator invitations on user accounts (handled by `poll-invitations.yaml` + `handle-invitation.ts`) seed entries with channel `collab`.
  - **Channel `owned`** — fro-bot's own org. Reconcile enumerates non-archived non-fork repos under the `fro-bot` org via `apps.listReposAccessibleToInstallation` (or equivalent installation-scoped enumeration), skipping `fro-bot/.github`. New repos appear as `pending` entries with channel `owned`.
  - **Channel `contrib`** — cross-org. `metadata/allowlist.yaml` gains an opt-in section for contrib access. Reconcile probes each named org / repo and accepts entries whose access check succeeds and whose `fro-bot.yaml` (or operator-named signal file) is present. New entries appear as `pending` with channel `contrib`.

- **R2.** Every entry in `metadata/repos.yaml` records its discovery channel as a typed field. Reconcile preserves the channel across status transitions; the channel never changes after first write.

- **R3.** Discovery skips `fro-bot/.github` unconditionally. The skip is an explicit constant, not a probe outcome.

### Cadence

- **R4.** Each entry stores a `next_survey_eligible_at` timestamp computed at survey time as `last_survey_at + base_interval + jitter`, where:
  - `base_interval` is per-channel and operator-tunable (initial values: `owned = 14d`, `contrib = 21d`, `collab = 30d`; tuneable via constants).
  - `jitter` is a small bounded random value (e.g. `±0..3 days`) drawn at survey-completion time, deterministic per `(repo, last_survey_at)` so re-running reconcile against the same snapshot yields identical decisions.

- **R5.** Reconcile dispatches a repo when `now >= next_survey_eligible_at` (with appropriate handling for null = never surveyed and malformed-date = treat as eligible). Existing dispatch caps, stagger, and prioritization (`null first → oldest next_survey_eligible_at next`) continue to apply.

- **R6.** A repo's `next_survey_eligible_at` is set during the survey-result write-back path (`recordSurveyResult` / `survey-repo.yaml`), not at dispatch time. A failed survey resets it to the same `last_survey_at + base_interval + jitter` formula but starting from "now" so retries don't pile up immediately.

### Allowlist surface for contrib

- **R7.** `metadata/allowlist.yaml` gains a new section that supports both:
  - **Org-level opt-in:** `approved_contrib_orgs` — list of org logins. Reconcile enumerates repos in each org and probes for the `fro-bot.yaml` signal file.
  - **Repo-level opt-in:** `approved_contrib_repos` — list of fully qualified `org/repo` strings. Reconcile probes the named repo directly without enumeration.

- **R8.** A contrib probe failure (App not installed, signal file missing, repo archived/private without access) does not error the reconcile run. The repo is omitted from the tracked list with a structured log line.

### Backwards compatibility

- **R9.** Existing `metadata/repos.yaml` entries are migrated forward on first reconcile run after rollout: missing `discovery_channel` defaults to `collab`, missing `next_survey_eligible_at` defaults to `last_survey_at + 30d + jitter` (for `onboarded`) or `null` (for `pending`). Migration is a single pure mapping, not a data backfill workflow.

- **R10.** The single 30-day `SURVEY_STALENESS_MS` constant is replaced by per-channel intervals plus the per-entry `next_survey_eligible_at`. The shape of the JSON reconcile output preserves existing keys (`dispatches`, `dispatchesDeferred`, `unchanged`, etc.) and adds per-channel breakdowns.

### Observability

- **R11.** Reconcile JSON output includes per-channel counters (`{collab: {tracked, dispatched, deferred, lostAccess}, owned: {...}, contrib: {...}}`) so daily reports and operator review can attribute activity to channels.

- **R12.** A repo's first survey under the `owned` or `contrib` channel logs an explicit "first survey for new channel entry" line so the operator can verify rollout is working without diffing files.

## Constraints

- **C1.** `metadata/*.yaml` writes must continue to land on `data` and promote via `merge-data`. The wiki authority guard (`scripts/check-wiki-authority.ts`) must continue to enforce Fro Bot identity for all guarded paths.
- **C2.** All scripts remain TypeScript under `scripts/`, executable with Node v24 native TS.
- **C3.** Cross-org probes must use the App installation token scoped via `owner: ${{ github.repository_owner }}` (or equivalent multi-org input) — the existing trap from PR #3201 must not regress.
- **C4.** Anthropic seat budget is the binding capacity constraint, not GitHub API quota. Per-channel intervals must be chosen so the steady-state daily dispatch volume stays inside the cliproxy.fro.bot tolerance proven by the existing 90-second stagger + 12-cap workflow.
- **C5.** Discovery probes must not make API calls during every reconcile run that scale with org size beyond what the existing daily reconcile already does. Cross-org enumeration runs at most once per reconcile pass per org.
- **C6.** Tests must cover the new staleness-gate, channel routing, jitter determinism, and migration mapping before any production pipeline change lands.

## Open Questions

Resolved during this brainstorm:

- **Discovery model.** Three channels into one tracked list. Resolved.
- **Cadence shape.** Per-repo `next_survey_eligible_at` with per-channel base interval and small jitter. Resolved.
- **Contrib trust boundary.** Operator-curated allowlist (`approved_contrib_orgs` + `approved_contrib_repos`) with auto-discovery probe. Resolved.
- **Self-survey of `fro-bot/.github`.** Out of scope. Skip in discovery. Resolved.
- **Per-page-type thresholds.** Out of scope. Resolved.

Deferred to planning:

- Exact starting values for `base_interval` per channel and jitter window. Initial recommendation: `owned = 14d`, `contrib = 21d`, `collab = 30d`, jitter = `±0..3d`. Planning may revise based on capacity math.
- Whether `discovery_channel` is stored as a string field or an enum. (Schema-level concern.)
- Whether the contrib probe requires `.github/workflows/fro-bot.yaml` specifically or accepts any signal file pattern. Initial recommendation: require `fro-bot.yaml` to keep the trust signal explicit.
- Whether the survey-result write-back path computes jitter from a deterministic seed (`hash(repo, last_survey_at)`) or pulls from a non-deterministic RNG. Determinism wins for test stability; planning resolves the seed source.
- Migration ordering: does the first reconcile after rollout dispatch every newly-eligible repo at once (producing a new herd), or is rollout staggered? Initial recommendation: cap the first run via the existing per-run dispatch cap so the new model self-staggers.

## References

- `docs/plans/2026-04-17-001-feat-repo-reconciliation-plan.md` — current reconcile architecture (decision engine + thin I/O shell).
- `docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md` — origin requirements for the daily reconcile pass.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — the prior silent-failure pattern (relevant: success status while no work is dispatched is the same shape as the current cadence outage).
- `scripts/reconcile-repos.ts` — `SURVEY_STALENESS_MS`, `isSurveyStale`, dispatch cap, stagger, and per-channel JSON output keys live here.
- `scripts/handle-invitation.ts` — current `collab` channel entry point.
- `scripts/repos-metadata.ts` — `recordSurveyResult` is where `next_survey_eligible_at` will be written.
- `scripts/update-metadata.ts` — existing `apps.listReposAccessibleToInstallation` pattern for the `owned` channel.
- `metadata/allowlist.yaml` — operator surface for `approved_contrib_orgs` / `approved_contrib_repos`.
