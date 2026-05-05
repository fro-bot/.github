---
title: 'feat: Survey cadence + multi-channel discovery'
type: feat
status: active
date: 2026-05-05
origin: docs/brainstorms/2026-05-04-survey-cadence-and-multi-channel-discovery-requirements.md
deepened: 2026-05-05
---

## Overview

Extend the daily reconcile pipeline with three discovery channels (`collab`, `owned`, `contrib`) feeding a single `metadata/repos.yaml` list, and replace the single 30-day staleness threshold with a per-repo `next_survey_eligible_at` field computed from a per-channel base interval plus deterministic jitter.

The cadence change reduces consecutive-zero-survey-day stretches via jitter and per-channel intervals. It does NOT eliminate the underlying structural pattern: at the current scale (~17-27 repos × 30-day cycle), the 12-dispatch cap drains eligible candidates in 2-3 days and then leaves ~22-25 days of silence per cycle. Jitter spreads those active days from 2-3 to ~5-6 — partial improvement, not a fix. The real architectural answer for "wiki diffs every week" is a per-day quota model (always dispatch the N oldest-eligible repos regardless of staleness threshold) which is deliberately deferred to a future plan; this plan ships the smaller change first.

The discovery expansion brings Fro Bot's own org repos and operator-allowlisted cross-org repos into the same lifecycle as collaborator invitations. Both changes ship together because each one in isolation makes the other's problem worse: fixing cadence without expanding reach leaves the wiki small; expanding reach without fixing cadence amplifies the cluster width on cycle days.

## Problem Frame

The reconcile cron has been reporting `success` while dispatching zero surveys for several days running. The proximate cause was a clustering event: 18 of 21 onboarded repos were last surveyed on 2026-04-27 (followed by a recovery wipe that left 17/17 entries with `last_survey_at: null` on the `data` branch as of plan-write time). The single 30-day threshold makes any cluster-of-N repos all simultaneously ineligible for ~28 days after they survey, then dispatches them again in a 2-3-day burst (12-cap drain), then idles for ~28 days. Per-channel intervals + jitter widen the burst window from 2-3 days to 5-6 and slow re-clustering, but the population-vs-cycle ratio (N=17, cycle=30d) means most days will still be zero-dispatch days even at steady state. This plan accepts that limitation and ships the partial fix; a future plan addresses the structural answer (a per-day quota that always dispatches the oldest-eligible regardless of threshold).

In parallel, Fro Bot's tracked-repo list misses two real access channels:

- **Owned org**: `fro-bot/agent`, `fro-bot/systematic`, `fro-bot/fro-bot.github.io` — the agent itself and the GH Pages presence are not in the wiki. (`fro-bot/.github` is excluded by design — see Scope Boundaries.)
- **Cross-org contribution**: repos like `bfra-me/.github` and `bfra-me/renovate-action` already invoke `fro-bot/agent` via `.github/workflows/fro-bot.yaml`. Fro Bot operates in those repos as a service but has no presence in the wiki.

The origin document treats these as one initiative. The plan does too. (See origin: `docs/brainstorms/2026-05-04-survey-cadence-and-multi-channel-discovery-requirements.md`.)

## Requirements Trace

- **R1, R2, R3** — Three discovery channels into one `metadata/repos.yaml`; every entry records its discovery channel; `fro-bot/.github` skipped unconditionally. Implemented across Units 1, 2, 3.
- **R4, R5, R6** — Per-repo `next_survey_eligible_at` with per-channel base interval and deterministic jitter; reconcile dispatches when `now >= next_survey_eligible_at`; eligibility set during survey-result write-back. Implemented in Units 1, 2, 4.
- **R7, R8** — `metadata/allowlist.yaml` gains `approved_contrib_orgs` + `approved_contrib_repos`; contrib probe failures don't error the run. Implemented in Unit 3. Honors **C3** (App token scoped via `owner: ${{ github.repository_owner }}`) and **C5** (cross-org enumeration runs at most once per allowlisted org per reconcile pass).
- **R9, R10** — Existing entries migrated forward via additive defaults on first run; reconcile JSON output preserves keys and adds per-channel breakdowns. Implemented in Units 1, 5.
- **R11, R12** — Per-channel counters in JSON output; first-survey-of-channel log line. Implemented in Unit 5.
- **SC1** — Surveys fire on most days AND wiki content actually changes most weeks. Two-part verification: (a) daily reconcile JSON output shows non-zero dispatches on a clear majority of days over a 14-day window, (b) `git log --oneline --since='7 days ago' -- knowledge/wiki/` shows non-zero diffs on at least 4 of the last 7 days during steady state. Dispatch frequency alone is a proxy — the silent-failure mode the plan addresses is "reconcile reports success while no real work happens", and surveys-without-wiki-diffs is the same shape. Verifying both prevents shipping green on a metric while the actual problem (wiki silence) persists.
- **SC2** — Wiki includes `fro-bot/agent`, `fro-bot/systematic`, `fro-bot/fro-bot.github.io`. Verified via `knowledge/wiki/repos/` listing two weeks after rollout.
- **SC3** — Wiki includes operator-allowlisted cross-org repos. Verified the same way.
- **SC4** — Per-channel attribution. Verified by inspecting any post-rollout `metadata/repos.yaml` and reconcile JSON output.

## Scope Boundaries

- **No self-survey of `fro-bot/.github`.** Discovery skips this repo via an explicit constant.
- **No per-page-type stale thresholds.** Cadence is per-repo only.
- **No auto-removal beyond the existing `lost-access` flow.** Operators remove contrib entries by deleting allowlist lines; reconcile flips status to `lost-access` on the next pass when a probe fails.
- **No changes to the `data → main` promotion model.** The wiki authority guard (`scripts/check-wiki-authority.ts`) remains untouched.
- **No real-time activity signals.** Cadence is purely time-based with deterministic jitter.
- **No discovery outside the explicit allowlist.** Contributor probes only run against orgs/repos the operator has named.

### Deferred to Separate Tasks

- **Per-day quota model for true continuous wiki growth.** SC1's "non-zero wiki diffs on at least 4 of the last 7 days" target is achievable with this plan only if the channel-cycle math cooperates. At N=17 collab repos × 30d cycle, structurally there are still ~22 zero-dispatch days per cycle. The architectural answer is a per-day quota: dispatch the N oldest-eligible repos every day regardless of staleness threshold. This plan deliberately does NOT ship that change — it's a separate plan once the cadence work proves the threshold model's limits in production. Trigger for that plan: 30 days of operation under this plan show consecutive-zero-day stretches >7 days even with jitter applied.
- **Compound learnings after rollout.** Three institutional gaps surfaced in research that are worth `ce:compound`-ing once the work ships and bites in production: (1) App installation token + `owner: github.repository_owner` cross-org scoping, (2) additive YAML mutator purity for schema migrations, (3) Anthropic seat capacity / dispatch staggering observability. These are documentation work, not implementation work.
- **Tunable per-channel intervals via env vars.** This plan ships hardcoded constants (`OWNED_INTERVAL_DAYS = 14`, `CONTRIB_INTERVAL_DAYS = 21`, `COLLAB_INTERVAL_DAYS = 30`, `JITTER_MAX_DAYS = 3`). Promotion to env-var override is a small follow-up after observing real cadence.
- **Recovery script for misclassified `next_survey_eligible_at` values.** `scripts/reset-survey-status.ts` already exists and clears `last_survey_at` + `last_survey_status` to null, which is sufficient to force re-dispatch. Adding a parallel `reset-eligibility.ts` is a follow-up if the new field develops its own corruption pattern.

## Context & Research

### Relevant Code and Patterns

- `scripts/reconcile-repos.ts` — Pure decision engine + I/O shell. Pattern: `reconcileRepos(input) → ReconcileResult` with a thin async shell. New cadence logic lives in this file. Mutator closure (`commitMetadataImpl` callback) re-runs `reconcileRepos` on each 409 retry.
- `scripts/repos-metadata.ts` — Pure mutators (`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`). New cadence helper for computing `next_survey_eligible_at` lives here. Existing `recordSurveyResult` already does pending → onboarded promotion on first success — extend that path to set the new field.
- `scripts/schemas.ts` — String-literal union pattern (`OnboardingStatus`, `SurveyStatus`). Add `DiscoveryChannel = 'collab' | 'owned' | 'contrib'` and extend `RepoEntry`. Strip-only TS forbids enums.
- `scripts/update-metadata.ts` — Existing `apps.listReposAccessibleToInstallation` pattern. The owned-channel and contrib-channel discovery paths mirror this exactly: same `paginate`, same per-repo content probe, same `as RestEndpointMethodTypes[...]` typing to keep SDK drift a compile error.
- `scripts/handle-invitation.ts` — Current `collab` channel entry point. Calls `addRepoEntry` with default `'pending'` status. Migration must preserve this path: when invitations land, the new entry must carry `discovery_channel: 'collab'`.
- `metadata/allowlist.yaml` — Currently `version: 1` + `approved_inviters[]`. Gains `approved_contrib_orgs[]` and `approved_contrib_repos[]`.
- `.github/workflows/reconcile-repos.yaml` — Mints App token via `actions/create-github-app-token` but does NOT currently set `owner: ${{ github.repository_owner }}` (unlike `update-metadata.yaml`, which does). PR #3201 added that input to `update-metadata.yaml`/`dispatch-renovate.yaml` but did not extend it to `reconcile-repos.yaml`. **Unit 3 must add `owner: ${{ github.repository_owner }}` to the App-token step before cross-org probes will work** — without it, the minted token is scoped to the workflow repo only and cross-org `apps.listReposAccessibleToInstallation` calls return an empty (or wrong-scope) list. See Unit 3 prerequisite.

### Institutional Learnings

- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — The 30-day staleness gate's silent-failure mode (misclassified `success` skipped a repo for 30 days). The cadence change _moves_ the failure surface to `next_survey_eligible_at`, not eliminates it. Mitigation: failed surveys still set the new field, but starting from "now", so a misclassified success at most defers re-survey by `base_interval + jitter` (max 33 days for collab), the same as today's worst case. No new blast radius.
- `docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md` — Use `RestEndpointMethodTypes[...]` types from `@octokit/rest` to derive types instead of handwriting. Already the pattern in `update-metadata.ts`. New code follows it.
- `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md` — No enums, no parameter properties. `DiscoveryChannel` is a string-literal union. Channel intervals live as plain object literals with `as const`.
- `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md` — Don't introduce a second mutation path for autonomous-write surfaces. Per-channel observability counters are report-only in the JSON output; they never feed back into a mutation.

### Slack Context

Not gathered. No Slack tools in this session. Ask if organizational context would help before implementation.

## Key Technical Decisions

- **Per-channel base intervals**: `owned = 14d`, `contrib = 21d`, `collab = 30d`. The hierarchy reflects what each channel narratively represents to Fro Bot:
  - **Owned (14d, fastest)** — fro-bot org repos are Fro Bot's own substrate (the agent itself, systematic, the GH Pages site). Wiki entries here are the agent's _self-knowledge_. When the substrate changes, the agent's understanding of itself should refresh quickly. Tightest cadence because Fro Bot has the highest stake in keeping its self-model accurate.
  - **Contrib (21d, middle)** — cross-org repos where Fro Bot operates as a service. Wiki narrative is "where Fro Bot is actively present in the world." External presence should refresh faster than passive context but slower than the agent's substrate, because the agent's authority over external repos is bounded.
  - **Collab (30d, slowest)** — Marcus's other repos. Wiki narrative is biographical context — "what does the operator work on." Slowest cadence because biographical context moves slowly and existing staleness on this channel was already tolerated in v0.

  The capacity math (5/14 + 5/21 + 17/30 ≈ 1.2 surveys/day average across 27 tracked repos) shows the hierarchy fits well inside the proven 12-cap + 90s-stagger envelope. The hierarchy comes first; capacity confirms it's affordable. Hardcoded as constants for v1; env-var override is a small follow-up if observation suggests tuning.

- **Jitter window**: `±0..3 days` (i.e. `+0..3d` past the base interval — never negative; we don't want surveys earlier than the channel cadence claims). Bounded random ensures repos never land on the exact same eligibility date twice in a row, which is what causes the herd in the first place.

- **Deterministic jitter seed**: `hash(owner + name + survey_date_string)` where `survey_date_string` is the YYYY-MM-DD UTC slice that just got recorded as `last_survey_at` for this survey. Concretely: `crypto.createHash('sha256').update(`${owner}/${name}@${survey_date_string}`).digest()` → first 4 bytes as big-endian uint32 → modulo 4 (0..3 days). **Critical**: the seed is the YYYY-MM-DD UTC date string, never a `Date` object and never a local time. This guarantees that 409-retry mutator re-runs across UTC midnight produce the same jitter value (the `last_survey_at` slice is timezone-stable; raw `Date.now()` is not). For Unit 4 migration, the seed is the existing `last_survey_at` (already a YYYY-MM-DD string). For Unit 2 `recordSurveyResult`, compute `last_survey_at` first (via `input.at.toISOString().slice(0, 10)`), THEN use that string as the seed — not `input.at` directly. Determinism wins over true randomness because (a) test fixtures pin against stable values, (b) migration backfill produces stable values without persisting a separate seed, (c) 409-retry idempotency is preserved. The 4-bucket jitter is naturally collision-prone (~25% per pair by construction) — that's arithmetic, not a bug. The `recordSurveyResult` reseed-on-each-survey means the value evolves naturally without a stored RNG state.

- **Migration is additive-only and runs inside the existing reconcile flow**: First post-rollout reconcile sees entries missing `discovery_channel` (defaults to `'collab'` — the existing channel) and missing `next_survey_eligible_at` (computed from `last_survey_at + 30d + jitter` for entries with a real `last_survey_at`, null for entries that have never been surveyed). The mutation happens in `reconcileRepos`'s tracked-pass, returning fresh entries with the new fields. No standalone migration script. The 12-dispatch cap absorbs any "newly eligible all at once" rush naturally.

- **Discovery channel is sticky in autonomous code paths.** Reconcile never auto-rewrites `discovery_channel` once it's set. If a repo somehow becomes eligible for two channels (e.g. a contrib repo whose owner is later allowlisted as a `collab` inviter, or a contrib repo that gets transferred to fro-bot's own org), the autonomous path leaves the channel alone and the cadence stays on the original channel's interval. **Operator escape hatch**: to re-classify, the operator edits `metadata/repos.yaml` directly on the `data` branch and lets reconcile pick it up on next pass. Documented in `metadata/README.md` so this isn't folklore. The race window between contrib enumeration and a fresh collab invitation is acceptable as-is — the cadence asymmetry it can produce (21d vs 30d on a misclassified repo) is small and operator-correctable.

- **Owned channel discovery uses `apps.listReposAccessibleToInstallation` filtered to the configured owner. NO `fro-bot.yaml` probe.** Same call already used by `update-metadata.ts`. Skips `fro-bot/.github` via an explicit constant. Skips archived repos (no point surveying frozen state). Forks are also skipped — the wiki narrative is about original repos. Trust signal for owned is "the App is installed in fro-bot's own org" — we don't need a workflow file to confirm what we already control. This is intentional asymmetry with contrib (which DOES require `fro-bot.yaml` content verification): owned trusts org membership, contrib requires explicit invocation. `fro-bot/fro-bot.github.io` (a GH Pages site without `fro-bot.yaml`) gets surveyed as a result; that's the intended behavior.

- **Contrib channel discovery is two-mode**:
  - `approved_contrib_orgs: [bfra-me]` — list installation repos under each org, then probe each for `.github/workflows/fro-bot.yaml`. Repos that lack the signal file are omitted with a structured log line.
  - `approved_contrib_repos: [bfra-me/.github, foo/bar]` — probe each named repo directly. Same probe, no enumeration. Useful for repos in orgs that aren't fully opted-in.

- **Probe is restricted to `.github/workflows/fro-bot.yaml`.** Keeps the trust signal tight: a repo using fro-bot via a different workflow filename doesn't count. Operators can always add the repo to `approved_contrib_repos` if they want it surveyed regardless.

- **Probe verifies file content, not just presence.** Mere existence of `fro-bot/workflows/fro-bot.yaml` is forge-able by anyone with push access in an `approved_contrib_orgs` org. Unit 3's probe MUST `repos.getContent` the file and confirm at least one of: `uses: fro-bot/agent@`, `uses: fro-bot/.github/.github/workflows/`, or a `secrets:` block referencing `FRO_BOT_PAT`/`OPENCODE_AUTH_JSON`. An empty or no-fro-bot-reference file is treated as "no signal" (same as missing). The check is a substring scan over the decoded content; not parsing YAML, just verifying the workflow actually wires up to fro-bot. This shifts the trust signal from "someone created a file" to "someone wired up the agent" — non-trivially harder to forge by accident or for bait.

- **Channel interval lookup is a `satisfies`-typed object literal.** Plain `Record<DiscoveryChannel, number>` constant — no enum, no class. Strip-only-safe, easy to extend, easy to test.

- **Logger gets a new `info` level for the first-survey-of-channel telemetry**. Existing `ReconcileLogger` only has `warn`. R12 wants an explicit "first survey for new channel entry" log line; that's an info-level signal, not a warning.

## Open Questions

### Resolved During Planning

- **Q1: Base intervals + jitter window.** Resolved: `owned = 14d`, `contrib = 21d`, `collab = 30d`, jitter `+0..3d`. Steady-state arithmetic shows ~1.2 surveys/day average at current scale.
- **Q2: `discovery_channel` field type.** Resolved: string-literal union (matches `OnboardingStatus`, `SurveyStatus`; strip-only TS forbids enums).
- **Q3: Contrib probe path.** Resolved: require `.github/workflows/fro-bot.yaml` specifically.
- **Q4: Jitter seed source.** Resolved: deterministic SHA-256 of `${owner}/${name}@${last_survey_at}`.
- **Q5: Migration ordering.** Resolved: self-stagger via the existing 12-cap; additive mutation inside `reconcileRepos`'s tracked-pass; no standalone migration script.

### Deferred to Implementation

- **Exact log message wording for first-survey-of-channel.** Not architecturally significant. The implementer picks something clear.
- **Whether owned-channel discovery should also update `has_fro_bot_workflow` / `has_renovate` field probes for newly-discovered repos.** Today's code does this for tracked entries; it's not obviously different for newcomers. Defer to implementation; the answer will be obvious once the code is in front of someone.
- **Whether contrib repo enumeration counts archived/fork repos as "lost-access" or just omits them.** Probably omit (no entry was ever created), but the exact branch in `classifyTracked` is easier to settle while writing the test.
- **Whether to surface `dispatchesDeferred` per channel** or keep it as a global counter. The brainstorm asks for per-channel breakdowns; this specific deferred-vs-actual split adds noise. Decide while wiring the JSON output.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

The data-flow change is small and surgical:

```text
                          ┌───────────────────────────────┐
                          │  metadata/repos.yaml (data)   │
                          │                               │
                          │  RepoEntry (extended):        │
                          │   + discovery_channel         │
                          │   + next_survey_eligible_at   │
                          └───────────────┬───────────────┘
                                          │
                                          │ assertReposFile + migrateOnRead
                                          ▼
  Shell-side discovery (Unit 3 I/O):

    ┌─ collab fetch ──┐  ┌─ owned fetch ──────┐  ┌─ contrib fetch ──────┐
    │ user PAT        │  │ App token          │  │ App token            │
    │ /user/repos     │  │ apps.listReposAcc.ToInst.│ apps.listReposAcc.ToInst.│
    │ (existing)      │  │ filter fro-bot,    │  │ filter approved orgs │
    │                 │  │ skip .github+arch+fork │  │ + repos              │
    │                 │  │                    │  │ + verify fro-bot.yaml│
    │                 │  │                    │  │   content            │
    └────────┬────────┘  └─────────┬──────────┘  └──────────┬───────────┘
             │                     │                        │
             ▼                     ▼                        ▼
        merge with dedup precedence: collab > owned > contrib
        produces: accessList + accessChannelByKey: Map<key, channel>
                            │
                            ▼
            ┌──────────── reconcileRepos (pure engine) ────────────┐
            │                                                      │
            │  Tracked-pass:                                       │
            │   ┌─ classifyTracked ─────────────────────────────┐  │
            │   │  migrateRepoEntry first (Unit 4)              │  │
            │   │  then isEligible(entry, now)                  │  │
            │   │  uses entry.next_survey_eligible_at           │  │
            │   └────────────────────────────────────────────────┘  │
            │                                                      │
            │  Newcomer-pass (single pass over accessList):        │
            │   look up channel from accessChannelByKey            │
            │   addRepoEntry({..., discovery_channel: channel})    │
            │   collab newcomers: allowlist gate (existing)        │
            │   owned/contrib newcomers: skip allowlist gate       │
            │                                                      │
            │  Per-channel summary counters                        │
            └──────────────────────────────────────────────────────┘
                                          │
                                          ▼
            ┌─ recordSurveyResult (mutator) ─────────────────────────┐
            │  on success: last_survey_at = now                      │
            │              last_survey_status = 'success'            │
            │              next_survey_eligible_at = ──────────────┐ │
            │                computeNextEligible(                  │ │
            │                  channel, now, owner, repo)          │ │
            │  on failure: same formula but seed from "now" not    │ │
            │              previous last_survey_at                  │ │
            └──────────────────────────────────────────────────────┘
```

The pure engine boundary stays clean. New I/O (owned + contrib enumeration) lives in the shell; new pure logic (channel classification, eligibility check, migration mapping) lives in the engine and `repos-metadata.ts`.

## Implementation Units

- [x] **Unit 1: Schema migration — `discovery_channel` + `next_survey_eligible_at`**

**Goal:** Extend `RepoEntry` with the two new fields (optional during the rollout window) and the `DiscoveryChannel` union. Add runtime guards that accept legacy entries missing the new fields. Migrate `metadata/repos.yaml` on `main` with deterministic jitter so eligibility-day distribution stays inside the 12-dispatch cap. No reconcile behavior change yet — migration consumers and writers come in Unit 4. This unit lands cleanly and unblocks everything else without breaking the `data` branch.

**Requirements:** R1, R2, R4, R9.

**Dependencies:** None.

**Files:**

- Modify: `scripts/schemas.ts` — add `DiscoveryChannel`, extend `RepoEntry` with the two new fields as **optional** (`discovery_channel?: DiscoveryChannel`, `next_survey_eligible_at?: string | null`), update `isRepoEntry`/`assertRepoEntry` to accept missing values. Unit 4 tightens to required after data-branch migration.
- Modify: `scripts/repos-metadata.ts` — extend `addRepoEntry`'s literal to write `discovery_channel` (defaulting from a new optional `discovery_channel?: DiscoveryChannel` field on `AddRepoEntryInput`, falling back to `'collab'`) and `next_survey_eligible_at: null`. New entries always carry both fields.
- Modify: `scripts/handle-invitation.ts` — pass `discovery_channel: 'collab'` to the existing `addRepoEntry` call so the collab path explicitly tags its newcomers.
- Modify: `metadata/repos.yaml` — one-time content migration. Each entry with a non-null `last_survey_at` gets `next_survey_eligible_at = last_survey_at + 30d + jitter(owner, name, last_survey_at)` where `jitter` is `sha256(${owner}/${name}@${last_survey_at}).readUInt32BE(0) % 4` (0–3 days). All entries get `discovery_channel: collab`. Avoids cap-12 starvation that a flat +30d migration would create.
- Modify: `scripts/schemas.test.ts` — extend tests for new fields + channel guard. Includes a "legacy entry missing both fields is accepted" test that pins the loose-then-tight contract.
- Modify: `scripts/repos-metadata.test.ts` — extend `addRepoEntry` tests for the new field default and the optional channel input.
- Modify: `scripts/handle-invitation.test.ts` — round-trip via `assertReposFile` to verify the mutator output carries `discovery_channel: 'collab'`.
- Modify: `metadata/README.md` — schema documentation update; documents the loose-then-tight rollout.

**Approach:**

- Add `export type DiscoveryChannel = 'collab' | 'owned' | 'contrib'`.
- Extend `RepoEntry` with `discovery_channel?: DiscoveryChannel` and `next_survey_eligible_at?: string | null` — both **optional during rollout**. JSDoc on each field calls out the loose-then-tight pattern: legacy entries without channel default to `'collab'`; missing eligible-at is treated as immediately eligible.
- Add `isDiscoveryChannel(value: unknown): value is DiscoveryChannel` helper following the existing `isOnboardingStatus` pattern.
- Update `isRepoEntry` and `assertRepoEntry` to accept `undefined` for both new fields. `null` for `discovery_channel` still rejects (only `undefined` or one of the three literals).
- Migrate `metadata/repos.yaml` on `main` with jitter so the 18 entries spread across multiple eligibility days (max same-day eligibility ≤ cap of 12).
- `addRepoEntry` always emits both fields with defaults so new entries are never legacy-shaped. Migration applies only to entries that pre-date Unit 1.
- Schema doc in `metadata/README.md` adds the two new fields, explains channel semantics + when each fires, documents the loose-then-tight rollout.

**Why optional, not required:** Tight required schema would break the `data` branch on first autonomous write. `data` retains 17 legacy entries with no new fields; `handle-invitation` / `reconcile` / survey scripts call `assertReposFile` inside their commit mutators, so a tight schema fails the mutator and crashes the run. Optional fields let Unit 1 land cleanly while Unit 4 lands the data-branch migration via `migrateRepoEntry`. Unit 4 then tightens to required as part of its same-PR scope.

**Why jitter on the migration:** A flat `+30d` migration produces 13 entries with `next_survey_eligible_at: 2026-05-27` against a per-run cap of 12. The `oldestFirst` tiebreak is alphabetical, deterministically excluding the 13th repo every cycle — permanent starvation. Deterministic 0–3 day jitter spreads the eligibility set across 7 days, max same-day is 6, well under the cap.

**Patterns to follow:**

- `OnboardingStatus` + `isOnboardingStatus` + `assertRepoEntry` shape in `scripts/schemas.ts`.

**Test scenarios:**

- Happy path: a `RepoEntry` fixture with `discovery_channel: 'owned'` + `next_survey_eligible_at: '2026-05-15'` passes both guards.
- Happy path: every literal value in `DiscoveryChannel` is accepted by `isDiscoveryChannel`.
- Happy path: legacy entry with neither `discovery_channel` nor `next_survey_eligible_at` passes both guards (loose-then-tight contract).
- Edge case: `next_survey_eligible_at: null` is accepted (never-surveyed entries).
- Error path: `discovery_channel: 'unknown'` fails `assertRepoEntry` with path `repos.repos[N].discovery_channel`.
- Error path: `next_survey_eligible_at` as a number fails `assertRepoEntry`.
- Error path: `discovery_channel` as `null` fails `assertRepoEntry` (only `undefined` or one of the three literals).
- Mutator output: `addRepoEntry` always produces an entry with both fields populated; `handle-invitation.test.ts` round-trips via `assertReposFile` to pin the contract.

**Verification:**

- `pnpm check-types` clean.
- `pnpm test` clean (new tests + all existing schema tests still pass).
- `pnpm lint` clean.
- `metadata/README.md` reflects the new fields + describes the loose-then-tight rollout.
- `metadata/repos.yaml` jittered eligibility distribution: max same-day ≤ 6 (verified at migration time), well under the 12-dispatch cap.

**Note on `ReconcileSummary.migrated`:** The original plan added a `migrated: number` counter to `ReconcileSummary` in this unit. It was removed during ce:review (5-reviewer agreement: the field is dead state without Unit 4's `migrateRepoEntry` producer, and the unguarded counter would cause silent no-op classification when the producer arrives). The counter ships with Unit 4, atomically with its writer.

---

- [ ] **Unit 2: Cadence engine — eligibility check + jitter helper**

**Goal:** Replace `isSurveyStale` with `isEligibleForSurvey` that consults `next_survey_eligible_at`. Add `computeNextEligibleAt` helper to `repos-metadata.ts`. Wire `recordSurveyResult` to set the new field on every survey outcome. This unit makes the cadence model real for entries that already have the new field; Unit 4's migration handles the legacy path.

**Requirements:** R4, R5, R6.

**Dependencies:** Unit 1 (schema).

**Files:**

- Modify: `scripts/reconcile-repos.ts` — replace `isSurveyStale` callers with `isEligibleForSurvey`. Keep the old export name aliased for backwards compatibility within this unit so tests don't break before Unit 4. Add `CHANNEL_INTERVAL_DAYS` constant.
- Modify: `scripts/repos-metadata.ts` — add `computeNextEligibleAt(input)` and wire `recordSurveyResult` to set `next_survey_eligible_at` on both success and failure paths.
- Modify: `scripts/repos-metadata.test.ts` — extend `recordSurveyResult` tests; add `computeNextEligibleAt` tests.
- Modify: `scripts/reconcile-repos.test.ts` — extend tests for eligibility behavior using the new field.

**Approach:**

- New constant: `CHANNEL_INTERVAL_DAYS = {collab: 30, owned: 14, contrib: 21} as const satisfies Record<DiscoveryChannel, number>`. Plus `JITTER_MAX_DAYS = 3`.
- New helper in `repos-metadata.ts`: `computeNextEligibleAt({owner, repo, channel, baseDate})` returns ISO date string `baseDate + interval[channel] + jitter(owner, repo, baseDate)` days.
- Jitter implementation: derive `survey_date_string = baseDate.toISOString().slice(0, 10)` first, then `crypto.createHash('sha256').update(`${owner}/${name}@${survey_date_string}`).digest()` → read first 4 bytes as big-endian uint32 → `% (JITTER_MAX_DAYS + 1)` → days. The intermediate `survey_date_string` variable is required — do NOT pass `baseDate` (a Date object) into the hash. Two `recordSurveyResult` calls with `baseDate` values 1ms apart but on opposite sides of UTC midnight must produce the same jitter value when the resulting `last_survey_at` is the same; only different YYYY-MM-DD slices may produce different values.
- `recordSurveyResult` wires `next_survey_eligible_at = computeNextEligibleAt({owner, repo, channel: entry.discovery_channel, baseDate: input.at})` on both success and failure.
- Reconcile's eligibility check becomes `isEligibleForSurvey(entry, now)` returning `true` when `next_survey_eligible_at` is null OR `now >= parse(next_survey_eligible_at)`. Malformed dates treated as eligible (don't lose coverage on corruption).
- Keep `SURVEY_STALENESS_MS` exported until Unit 4 migrates the legacy path; no callers should remain after that unit.

**Patterns to follow:**

- `isSurveyStale` in `scripts/reconcile-repos.ts` for the boundary-test pinning style.
- `recordSurveyResult` in `scripts/repos-metadata.ts` for the pending → onboarded promotion pattern (extend it; don't replace).

**Test scenarios:**

- Happy path: `computeNextEligibleAt` for `collab` channel + `2026-05-01` base + repo `marcusrbrown/foo` → ISO date 30..33 days later.
- Happy path: `computeNextEligibleAt` is deterministic — same `(owner, repo, baseDate)` yields the same output across calls.
- Edge case (midnight stability): `computeNextEligibleAt` for `(owner, repo, baseDate=2026-05-04T23:59:59.999Z)` and `(owner, repo, baseDate=2026-05-05T00:00:00.001Z)` produce DIFFERENT outputs (different YYYY-MM-DD slice → different seed); but `computeNextEligibleAt` for `(owner, repo, baseDate=2026-05-05T00:00:00.001Z)` called twice 50ms apart produces the SAME output (same slice → same seed). Pins the seed-from-string contract.
- Happy path: different `(owner, repo)` pairs at the same `baseDate` produce different jitter values (sample size: 5 distinct repo pairs, expect at least 2 distinct jitter outputs).
- Edge case: `computeNextEligibleAt` for `owned` channel uses 14d base + jitter range.
- Edge case: `isEligibleForSurvey` returns `true` when `next_survey_eligible_at` is null.
- Edge case: `isEligibleForSurvey` returns `true` when `now` equals `next_survey_eligible_at` (inclusive boundary).
- Edge case: `isEligibleForSurvey` returns `false` when `now` is one day before `next_survey_eligible_at`.
- Edge case: `isEligibleForSurvey` returns `true` for a malformed `next_survey_eligible_at` string.
- Happy path: `recordSurveyResult` on a `'success'` outcome sets `next_survey_eligible_at` to a date `interval[channel] + jitter` days after `input.at`.
- Happy path: `recordSurveyResult` on a `'failure'` outcome sets `next_survey_eligible_at` using the same formula but with the failure date as the seed.
- Happy path: `recordSurveyResult` preserves the existing `pending → onboarded` promotion on first success.
- Error path: `recordSurveyResult` still throws `RepoEntryNotFoundError` when the entry is missing.

**Verification:**

- `pnpm check-types` clean.
- `pnpm test` clean.
- Existing reconcile tests still pass (the boundary test pinning may shift to use the new field once a fixture is updated).

---

- [ ] **Unit 3: Allowlist surface for contrib + I/O shell discovery passes**

**Goal:** Extend `metadata/allowlist.yaml` schema with `approved_contrib_orgs` + `approved_contrib_repos`. Add owned-channel and contrib-channel discovery passes to the reconcile I/O shell. Both passes feed into the existing `accessList` and flow through `reconcileRepos` unchanged.

**Requirements:** R1, R3, R7, R8, C3, C5.

**Dependencies:** Unit 1.

**Files:**

- Modify: `scripts/schemas.ts` — extend `AllowlistFile` with the two new arrays. Update guards.
- Modify: `scripts/schemas.test.ts` — schema tests for the new fields.
- Modify: `metadata/allowlist.yaml` — seed with `approved_contrib_orgs: []` + `approved_contrib_repos: []` (empty arrays for v1; operators populate as they want).
- Modify: `.github/workflows/reconcile-repos.yaml` — **prerequisite**: add `owner: ${{ github.repository_owner }}` to the `actions/create-github-app-token` step. Without this, cross-org probes return empty/wrong-scope results. Mirrors the PR #3201 fix already applied to `update-metadata.yaml` and `dispatch-renovate.yaml`.
- Modify: `scripts/reconcile-repos.ts` — add `fetchOwnedRepos(appOctokit, owner)` and `fetchContribRepos(appOctokit, allowlist)` functions in the shell; merge their outputs into `accessList` before calling `reconcileRepos`; tag each entry with its channel via a new `accessChannelByKey: Map<string, DiscoveryChannel>` input. **Dedup precedence in the merge:** when the same `owner/name` appears in both the user-PAT collab list and an owned/contrib probe result, the collab entry wins (`collab > owned > contrib`, first-write-wins) so `validateAccessList` doesn't throw on overlap.
- Modify: `scripts/reconcile-repos.test.ts` — extend tests for owned + contrib classification using the new channel map.
- Modify: `metadata/README.md` — document the new allowlist sections.

**Approach:**

- `AllowlistFile` gets two new optional-ish (i.e. `string[]`, default `[]` in YAML) fields. Guards accept missing fields as empty arrays for backward compatibility on existing allowlist files.
- New shell helpers mirror `update-metadata.ts`: paginate via `apps.listReposAccessibleToInstallation`, filter to target owner(s), probe `.github/workflows/fro-bot.yaml` via `repos.getContent`. **Error classification matters here**: 404 means "no signal file" (omit silently); 403 means "App not installed in that org / no access" (omit + structured warn log distinguishing it from no-signal); 5xx means "transient" (omit + warn). Treating 403 as 404 silently masks misinstallation, which is the silent-failure mode `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` warns about. Skip `fro-bot/.github` constant for the owned pass.
- Each discovered repo becomes an `AccessListEntry`. The shell builds a parallel `accessChannelByKey: Map<string, DiscoveryChannel>` recording which channel each entry came from. The map gets passed into `reconcileRepos` as a new input field.
- `reconcileRepos` uses the channel map only for newcomer entries (Pass 2): when adding a new entry via `addRepoEntry`, it includes `discovery_channel` from the map (defaulting to `'collab'` when missing — preserves existing behavior). Tracked entries already carry their channel from previous runs.
- For owned + contrib newcomers, skip the `pending-review` allowlist check that exists for `collab`. Owned repos are always trusted (we own them); contrib repos are explicitly named in the allowlist so they're already approved.
- Cap on cross-org enumeration: at most one `paginate` call per org per reconcile run (C5). The contrib-orgs path enumerates once per allowlisted org; contrib-repos path is direct probes.

**Patterns to follow:**

- `discoverRenovateRepos` in `scripts/update-metadata.ts` for the App-token paginate + filter pattern.
- `probeFroBotWorkflow` in `scripts/reconcile-repos.ts` for the existing fro-bot.yaml content probe.

**Test scenarios:**

- Happy path: allowlist with `approved_contrib_orgs: ['bfra-me']` + 2 repos under bfra-me with fro-bot.yaml + 1 without → 2 entries added with `discovery_channel: 'contrib'`, the third silently omitted.
- Happy path: allowlist with `approved_contrib_repos: ['some-org/foo']` + foo has fro-bot.yaml → 1 entry added with `discovery_channel: 'contrib'`.
- Happy path: owned-channel discovery returns 4 fro-bot org repos (`agent`, `systematic`, `fro-bot.github.io`, `.github`) → 3 entries added with `discovery_channel: 'owned'` (`fro-bot/.github` skipped by the explicit constant; `fro-bot.yaml` probe is NOT performed for owned).
- Edge case: `fro-bot/.github` is in the App's accessible-repos list → skipped, no entry added.
- Edge case: owned org has 1 archived repo → skipped silently.
- Edge case: owned org has 1 forked repo → skipped silently.
- Edge case: existing `metadata/allowlist.yaml` without `approved_contrib_orgs` field still parses (backward-compat default to empty).
- Error path: contrib probe returns 500 → entry omitted, structured warn log with status code fires, reconcile run continues.
- Error path: contrib probe returns 403 → entry omitted, structured warn log distinguishing "App not installed in org" from "no signal file", reconcile run continues. (404 = no signal; 403 = access denied; do NOT collapse them.)
- Error path: contrib org enumeration fails (e.g. installation revoked) → run continues, the org's repos are absent, structured warn log fires.
- Edge case (forge resistance): allowlist with `approved_contrib_orgs: ['some-org']` + a some-org repo containing an empty `.github/workflows/fro-bot.yaml` → entry is NOT added (content verification rejects empty/no-fro-bot-reference files).
- Edge case (forge resistance): same setup with a `fro-bot.yaml` that contains only an unrelated workflow (e.g. just `name: foo` + a generic step) → entry is NOT added.
- Edge case (dedup precedence): a repo discovered via both contrib probe AND collab access list → produces exactly one accessList entry tagged `collab` (collab > owned > contrib precedence). `validateAccessList` does not throw.
- Integration: a tracked entry with `discovery_channel: 'contrib'` whose `fro-bot.yaml` was deleted → next reconcile flips it to `lost-access` via the existing pass-1 path (no new code needed, just verify the existing flow works for the new channel).

**Verification:**

- `pnpm check-types` clean.
- `pnpm test` clean.
- A dry-run-style integration test asserts the new field appears in `metadata/repos.yaml` for owned + contrib newcomers.

---

- [ ] **Unit 4: Migration + cleanup of `SURVEY_STALENESS_MS`**

**Goal:** Make the migration of legacy entries automatic on first post-rollout reconcile run. Remove the `SURVEY_STALENESS_MS` constant and `isSurveyStale` legacy export now that all callers are migrated. This is the unit that "flips the switch" for cadence — after this lands, `next_survey_eligible_at` is the only source of truth.

**Requirements:** R9, R10.

**Dependencies:** Units 1, 2.

**Files:**

- Modify: `scripts/reconcile-repos.ts` — add `migrateRepoEntry(entry, now)` helper called inside the tracked-pass `classifyTracked` for entries missing the new fields. Remove `SURVEY_STALENESS_MS`, `isSurveyStale`. Update all eligibility checks to use the Unit 2 helpers.
- Modify: `scripts/reconcile-repos.test.ts` — add migration tests; remove tests for `isSurveyStale`.

**Approach:**

- `migrateRepoEntry`: when `entry.discovery_channel` is missing, default to `'collab'`. When `entry.next_survey_eligible_at` is missing, compute it from `last_survey_at` if non-null (treating the missing field's interval as `collab`'s 30 days, seeded by the existing `last_survey_at` string for jitter determinism), else `null`. Returns a fresh entry with both fields populated. Idempotent on already-migrated entries (returns by reference, no allocation).
- `classifyTracked` calls `migrateRepoEntry` first thing. When the migration produces a fresh entry, increment `summary.migrated` (NOT `summary.refreshed`) so operators can distinguish one-time migration commits from steady-state field-probe drift. `refreshed` continues to mean "field probe vs entry mismatch" only.
- After this unit, the only callers of `isEligibleForSurvey` are inside `classifyTracked`. The legacy `isSurveyStale` test cases delete; the new ones cover the migrated boundary.
- The first post-rollout reconcile run produces a single commit migrating every tracked entry. Extend `formatCommitMessage` to include `+{migrated} migrated` only when the count is non-zero, preserving the existing format for steady-state runs.

**Patterns to follow:**

- The `isNoOp` zero-change optimization pattern for keeping `currentRepos` reference identity when no migration is needed.
- The mutator-closure 409 retry safety in `commitMetadataImpl` — `migrateRepoEntry` must be pure (and is, since it's just default-filling).

**Test scenarios:**

- Happy path: a legacy entry without `discovery_channel` and without `next_survey_eligible_at` but with `last_survey_at: '2026-04-27'` and `onboarding_status: 'onboarded'` → migrated to `discovery_channel: 'collab'` + `next_survey_eligible_at: '2026-05-27' + jitter (0..3 days)`.
- Happy path: a legacy entry with `last_survey_at: null` → migrated to `discovery_channel: 'collab'` + `next_survey_eligible_at: null`.
- Happy path: an already-migrated entry passes through unchanged (referential equality preserved).
- Edge case: a legacy entry with `last_survey_at: 'not-a-date'` → migrated to `next_survey_eligible_at: null` (treat malformed as never-surveyed).
- Integration: full reconcile run on a fixture where all 18 entries are legacy → produces a single commit with `summary.migrated === 18` and a commit message containing `+18 migrated` (NOT in the `refreshed` slot); subsequent run on the migrated state is a no-op for migration (`summary.migrated === 0`) and the commit message omits the `+0 migrated` suffix.
- Edge case: post-migration, an entry that was last surveyed >30d ago becomes immediately eligible — verify the dispatch loop picks it up but the 12-cap absorbs the rest.

**Execution note:** Confirm Unit 2's existing tests for `recordSurveyResult` still pass, then delete the `SURVEY_STALENESS_MS` boundary tests in `reconcile-repos.test.ts` after replacing them with the equivalent `next_survey_eligible_at` boundary tests.

**Verification:**

- `pnpm check-types` clean.
- `pnpm test` clean.
- `grep` for `SURVEY_STALENESS_MS` and `isSurveyStale` in `scripts/` returns zero matches outside of the deleted-tests history.
- A manual run of `node scripts/reconcile-repos.ts` against a checkout with the live legacy `metadata/repos.yaml` produces the expected migration commit.

---

- [ ] **Unit 5: Per-channel observability**

**Goal:** Extend the reconcile JSON output with per-channel counters and add an info-level log line on first survey for new-channel entries. Operator can now answer "how much did each channel contribute today?" by reading the JSON output alone.

**Requirements:** R11, R12.

**Dependencies:** Units 1, 3.

**Files:**

- Modify: `scripts/reconcile-repos.ts` — extend `ReconcileSummary` with per-channel breakdowns; extend `HandleReconcileResult` accordingly; add `info` to `ReconcileLogger`; add the "first survey for new channel entry" log line at dispatch time.
- Modify: `scripts/reconcile-repos.test.ts` — assertions on the new counters and log line.
- Modify: `scripts/repos-metadata.test.ts` and any other test files that mock `ReconcileLogger` — add `info: vi.fn()` to mock objects so the new field is satisfied.

**Approach:**

- New shape: `summary.byChannel: Record<DiscoveryChannel, {tracked, dispatched, deferred, lostAccess}>` exactly per R11. Keeps existing top-level counters (`added`, `pendingReview`, `refreshed`, `migrated`, etc.) unchanged for backward compat — those stay global because their semantics don't break down cleanly per channel and R11 doesn't request it.
- `ReconcileLogger` gets `info: (message: string) => void`. Default impl writes to stdout (existing `process.stderr.write` style for warn).
- The dispatch loop iterates `selectedDispatches`; before calling `dispatchWithTimeout`, it checks the entry's `discovery_channel` and `last_survey_at`. If `last_survey_at === null` (never surveyed) AND channel is `'owned'` or `'contrib'`, log an info line: `reconcile: first survey for new <channel> entry: <owner>/<repo>`.
- JSON output extended with `byChannel`. The `formatCommitMessage` is unchanged (still the high-level summary).

**Patterns to follow:**

- Existing `ReconcileSummary` shape and `summary.<field> += 1` accumulation.
- Existing `logger.warn(...)` call sites for the structured log style.

**Test scenarios:**

- Happy path: a reconcile run with 2 collab dispatches + 1 owned dispatch + 1 contrib dispatch → `byChannel.collab.dispatched === 2`, `byChannel.owned.dispatched === 1`, `byChannel.contrib.dispatched === 1`.
- Happy path: tracked counts are populated even on no-op runs (e.g. `byChannel.collab.tracked === 18` for the current snapshot).
- Happy path: a first-time owned-channel survey logs `reconcile: first survey for new owned entry: fro-bot/agent` exactly once.
- Happy path: a first-time contrib-channel survey logs the analogous line for `'contrib'`.
- Edge case: a re-survey of an already-surveyed owned entry does NOT log the first-survey line.
- Edge case: a collab-channel first-survey does NOT log the first-survey line (only owned + contrib are flagged because the milestone matters less for the historical channel).
- Integration: the JSON written to stdout in `main()` includes `byChannel` for all three channels even when one channel has zero entries.

**Verification:**

- `pnpm check-types` clean.
- `pnpm test` clean.
- A manual `node scripts/reconcile-repos.ts | jq .summary.byChannel` shows the three-channel breakdown.

## System-Wide Impact

- **Interaction graph:** Reconcile and `recordSurveyResult` (in `survey-repo.yaml`) are the two writers of `next_survey_eligible_at`. Both go through `commitMetadata` against `data`. The wiki authority guard (`scripts/check-wiki-authority.ts`) keeps blocking unauthorized writers — no change. Downstream readers (just reconcile itself, today) all use the new helpers.
- **Error propagation:** Owned + contrib probe failures are non-blocking (R8): logged via `logger.warn`, the run continues, the affected repo is omitted from the access list. This matches the existing field-probe failure handling. Allowlist parse failures still throw `ReconcileError` since they indicate a malformed config.
- **State lifecycle risks:** The migration commit is a single additive write. It runs inside the existing mutator-closure flow, so 409 retries re-migrate cleanly. A misbehaving migration (e.g. losing `last_survey_at` for some entries) would surface as an immediate re-dispatch storm because they'd look never-surveyed; the 12-cap absorbs it but Unit 4's tests should pin this boundary explicitly.
- **API surface parity:** No change. Reconcile JSON output is a strict superset (R10).
- **Integration coverage:** The owned + contrib paths cross the App-token boundary that PR #3201 established. Tests should mock `apps.listReposAccessibleToInstallation` against representative responses (3 repos, mixed archived/fork, mixed signal-file presence) — not just synthetic happy-path fixtures.
- **Unchanged invariants:** `enforce_admins: true` on `main` still blocks autonomous commits — all metadata writes still land on `data` and promote via merge-data. `EXPECTED_AUTHORS = {fro-bot, fro-bot[bot]}` still gates the integrity check. The 12-dispatch cap and 90-second stagger still apply uniformly across channels (no per-channel cap split). The conditional auto-merge semantics (`knowledge/` + `metadata/`-only PRs auto-merge; code paths require approval) still apply since the schema migration touches metadata only.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| Migration commit lands during a reconcile race and gets the wrong shape on legacy entries. | Mutator closure re-runs `reconcileRepos` on each 409 retry (existing pattern); `migrateRepoEntry` is pure and idempotent. Test scenario "already-migrated entry passes through unchanged" pins this. |
| First post-rollout reconcile dispatches a herd because every legacy entry's migrated `next_survey_eligible_at` lands in the past or null. | The 12-dispatch cap absorbs the immediate rush. After drain, surveyed entries cluster within a (~2-day drain + 0..3d jitter) ≈ 5-day band per channel. Steady-state daily dispatch is bounded by channel-cycle pigeonholing (e.g. 17 collab repos / 30..33d → up to 5 surveys on collision days, well inside the cap). The 4-bucket jitter window (0..3d) doesn't fully decorrelate at this population size — the cap is doing real work, not jitter alone. **Open decision**: widen `JITTER_MAX_DAYS` to 7 (8 buckets) for better steady-state spread, or accept that the cap is the primary de-herding mechanism. Defer to implementation; pick once we observe the actual post-migration distribution. |
| Owned-channel discovery picks up a fro-bot repo that shouldn't be surveyed (e.g. a private experimentation repo). | The `fro-bot/.github` skip is the only hardcoded exclusion. Other repos in fro-bot are presumed legitimate; if a future repo needs to be excluded, it's a one-line constant addition. Documented as a deferred consideration. |
| Contrib probe runs on every reconcile run and adds latency proportional to org size. | C5 caps at one `paginate` call per allowlisted org per run. At today's scale (1 org, ~10 repos) the cost is negligible; the cap exists as a future guardrail. |
| `apps.listReposAccessibleToInstallation` returns an empty list when the App installation token is mis-scoped (PR #3201's trap). | The existing `reconcile-repos.yaml` mints the token with `owner: ${{ github.repository_owner }}` already. C3 documents this as a constraint. Unit 3's test mocks an empty response and verifies the run continues without crashing — it just produces no owned/contrib newcomers. |
| Jitter seed collision: two repos accidentally producing the same eligibility date. | Acceptable. The jitter window is 4 distinct values (0..3 days) so collisions are expected by design. The point of jitter is to reduce simultaneity, not eliminate it. The 12-cap and stagger handle the residual concurrency. |
| Removing `isSurveyStale` breaks downstream code we forgot about. | `grep` audit in Unit 4's verification step. Repo is small enough that this is high-confidence. |

## Documentation / Operational Notes

- **`metadata/README.md`** documents both the schema additions (Unit 1) and the new allowlist sections (Unit 3). Single PR, single doc update. Spell out the trust path explicitly: "modifications to `approved_contrib_orgs` and `approved_contrib_repos` follow the same trust path as `approved_inviters` — PR from operator owner, main CI required. The conditional auto-merge rule for metadata-only PRs has an exception for `metadata/allowlist.yaml`: allowlist changes are operator-owned policy, not bot-owned state, and require human approval before promoting to `main`."

- **Auto-merge exception for `metadata/allowlist.yaml`.** The conditional auto-merge rule (per `.github/copilot-instructions.md`) auto-merges PRs touching only `knowledge/` or `metadata/` paths. That rule was written assuming `metadata/` = bot-owned state (e.g. `repos.yaml`). The allowlist is operator-owned policy: adding an org grants survey reach. Auto-merging an allowlist edit without operator review is a privilege-escalation path. The plan's rollout includes either (a) updating `merge-data-pr.ts` and any auto-merge labelers to exclude allowlist changes from auto-merge, or (b) splitting allowlist into a different protected path entirely. Decide which during Unit 3.

- **Cross-org App installation prerequisite.** Adding an org to `approved_contrib_orgs` requires the Fro Bot App to be installed on that org first; adding a repo to `approved_contrib_repos` requires installation in that owner's account. Without installation, probes return 404/403 and the entry is silently omitted (per Unit 3 error classification). Document this as the operator's preflight when adding entries.

- **Contrib drop alarm.** When a contrib repo previously present transitions to omitted (workflow file removed, App uninstalled, signal verification failed), reconcile should surface this as more than a warn-level log line — the entry is leaving the wiki's lifecycle and the operator should know. Track as a Unit 5 stretch goal: a `contribDrops` counter in JSON output that operators can monitor against zero. If non-zero, file a single integrity-style issue per run with the dropped set so it isn't lost in noise.
- **`docs/solutions/`** — three candidate compound docs identified in research (App-token cross-org scoping, additive YAML migration, Anthropic seat capacity). Not in scope for this plan; if implementation surfaces a sharp learning, fold it in via a follow-up `ce:compound` PR.
- **No workflow changes needed.** `reconcile-repos.yaml` already mints the App token correctly (PR #3201) and runs daily. The new code paths run inside the existing job.
- **Rollout watch**: after Unit 4 lands, the first daily reconcile run produces a one-time migration commit. Operator should verify the resulting `metadata/repos.yaml` on `data` shows `discovery_channel: 'collab'` + `next_survey_eligible_at` populated for all 18 onboarded entries before letting the next merge-data cron promote it.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-04-survey-cadence-and-multi-channel-discovery-requirements.md`
- Related plans: `docs/plans/2026-04-17-001-feat-repo-reconciliation-plan.md` (existing reconcile architecture), `docs/plans/2025-04-15-001-feat-frobot-control-plane-plan.md` (Phase 4 closeout — this plan extends Unit 16's territory).
- Related learnings: `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`, `docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md`, `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md`, `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`.
- Related code: `scripts/reconcile-repos.ts`, `scripts/repos-metadata.ts`, `scripts/schemas.ts`, `scripts/update-metadata.ts`, `scripts/handle-invitation.ts`, `metadata/allowlist.yaml`, `.github/workflows/reconcile-repos.yaml`, `.github/workflows/survey-repo.yaml`.
- Related PRs: PR #3201 (`owner: ${{ github.repository_owner }}` App-token scoping), PR #3196/#3198 (`update-metadata` pattern for App-token cross-account discovery).
