---
title: "feat: Daily digest presence event (control-plane side)"
type: feat
status: active
date: 2026-06-07
origin: docs/brainstorms/2026-06-04-daily-digest-presence-event-requirements.md
deepened: 2026-06-07
---

# Daily digest presence event (control-plane side)

**Target repo:** `fro-bot/.github` (control plane). All paths below are relative to that repo.

## Overview

Migrate the daily oversight Discord post off the legacy webhook (`scripts/discord-notify.ts`)
and onto the gateway presence pipeline as a new `daily_digest` event, so it posts **as the Fro
Bot user** like `survey_completed` and `invitation_accepted` already do — reframed as a character
moment that only speaks up on days with real activity.

This plan is the **control-plane side** only: it teaches the signer (`scripts/gateway-announce.ts`)
the new event type, derives cheap counts and the report link in the scheduled run, and adds the
announce step **gated off by a dedicated `DAILY_DIGEST_ENABLED` variable** (default unset) so it
stays dormant until the gateway variant is deployed. The plan is purely additive — the legacy
webhook keeps running untouched until a separate follow-up removes it after go-live.

> **Why not the existing kill switch:** `GATEWAY_ANNOUNCE_DISABLED` is a *global* mute checked in
> `runCli` before `EVENT_TYPE` and wired into both live announce steps (`survey-repo.yaml`,
> `poll-invitations.yaml`). Setting it to keep `daily_digest` dormant would also silence the two
> live events. So dormancy here is a **per-event step-level `if:` gate**, not the global switch.

## Problem Frame

The daily scheduled oversight run (`.github/workflows/fro-bot.yaml`, the
`📣 Notify Discord — daily oversight` step) is the last Discord poster on the legacy webhook path.
It posts as a webhook bot, not as the Fro Bot user, and its message is a near-static heartbeat that
fires every scheduled run regardless of whether anything happened. The other two presence events
already moved to the gateway. The daily report should join them — but as a character moment, not a
cron heartbeat (see origin: `docs/brainstorms/2026-06-04-daily-digest-presence-event-requirements.md`).

## Requirements Trace

- **R1** — On a day with activity, the scheduled run posts exactly one `daily_digest` message to
  Discord **as the Fro Bot user**, carrying real cheap counts and a working link to that day's
  oversight report issue. (origin SC1)
- **R2** — On a quiet day (no surveys), no `daily_digest` post is made; the oversight issue is
  still created. (origin SC2)
- **R3** — A gateway failure (or the skipped dormant step) never fails the scheduled oversight run —
  same fail-soft contract as the other announce steps. (origin SC4)
- **R4** — The new event flows through the existing signer contract: `v: 1`, `fired_at`/timestamp
  rules, HMAC over `${ts}.${body}`, `rendered_text: null`, and the `GATEWAY_*` config — no changes
  to the auth/replay pipeline. (origin "Contract notes")
- **R5** — The control-plane announce step ships **dormant** (skipped via a dedicated
  `DAILY_DIGEST_ENABLED` step gate, default off) and only goes live after the gateway `daily_digest`
  variant is deployed in `marcusrbrown/infra` and verified. The dormancy MUST NOT touch the global
  `GATEWAY_ANNOUNCE_DISABLED` switch (which mutes the two live events). (origin Open Question 5 —
  gateway-first constraint)

## Scope Boundaries

- No new structured-metrics contract from the agent; no marker-parsing of the oversight issue prose.
  Rich detail stays in the linked issue.
- No critical-alert-driven posting in v1 (needs structured agent output the report doesn't emit).
- No change to the oversight **issue** itself — the agent still creates the daily report issue every
  run. This is only about the Discord presence post.
- No LLM-composed message in the control plane — v1 sends `rendered_text: null`; the gateway renders
  from its template.
- `invitations_accepted_today` is **omitted in v1** — it is not cheaply derivable in the scheduled
  run (it lives in the `poll-invitations.yaml` flow, not the daily oversight run).

### Deferred to Separate Tasks

- **Gateway-side `daily_digest` schema variant + render template + discord.js posting** — separate
  work in `fro-bot/agent` (issue #765, already triaged), deployed via `marcusrbrown/infra`. Hard
  dependency for go-live; not built here.
- **Removal of the legacy webhook** (`scripts/discord-notify.ts` + the
  `📣 Notify Discord — daily oversight` step in `fro-bot.yaml`) — a follow-up PR in this repo, landed
  only **after** the gateway variant is deployed and the `daily_digest` announce step is verified
  live. Removing it earlier would leave the daily run with no Discord poster in the gap.

## Context & Research

### Relevant Code and Patterns

- `scripts/gateway-announce.ts` — the signer/POST CLI. `EventType` union (`:4`) and runtime
  `VALID_EVENT_TYPES` set (`:6`) are both hard-closed to `survey_completed | invitation_accepted`;
  **both** must learn `daily_digest` or `runCli` rejects it as `invalid-event-type`. `announce()`
  builds `{ v: 1, event_type, fired_at, context, rendered_text: null }`, signs `${ts}.${body}` with
  HMAC-SHA256, sends `X-Gateway-Signature` + `X-Gateway-Timestamp`, retries once on network/5xx, and
  is fail-soft (`main()` always prints JSON and `process.exit(0)`). Kill switch:
  `GATEWAY_ANNOUNCE_DISABLED` short-circuits in `runCli` before any parse.
- `scripts/gateway-announce.test.ts` — Vitest suite (byte-exact HMAC vector, header equality,
  payload shape, retry classification, kill switch, redaction, `isEventType`, `runCli`). Mirror
  this for the new event type.
- Existing announce call sites to mirror the YAML shape (build `EVENT_CONTEXT_JSON` via `jq -nc`,
  set `GATEWAY_*` env, run `node scripts/gateway-announce.ts`):
  - `.github/workflows/survey-repo.yaml` (`📣 Announce survey to gateway`, ~`:330`)
  - `.github/workflows/poll-invitations.yaml` (`📣 Announce invitations to gateway`, ~`:38`)
- `.github/workflows/fro-bot.yaml` — the scheduled run: cron `0 0 * * *` (`:15`), agent step
  `Run Fro Bot` (~`:338`), legacy webhook step `📣 Notify Discord — daily oversight`
  (~`:412`, guard `if: success() && github.event_name == 'schedule'`). It overlays `knowledge/` from
  the `data` branch (~`:293`) but **does not** overlay `metadata/`.
- `.github/workflows/reconcile-repos.yaml` (~`:43`) — the `metadata/` overlay precedent to copy:
  `git fetch --no-tags origin data` then `git checkout origin/data -- metadata/`.
- `metadata/repos.yaml` (on the `data` branch) — `repos: [{ owner, name, last_survey_at, private, … }]`.
  `repos_tracked` = count of `private: false` entries; `surveys_today` = entries whose
  `last_survey_at` equals today (UTC).

### Institutional Learnings

- Ownership split (project memory): control-plane brainstorm + POST live in `fro-bot/.github`; the
  gateway contract + rendering live in `fro-bot/agent`; deployment is pinned in `marcusrbrown/infra`.
- The gateway `event_type` is a closed `Schema.Union` — a control-plane-only new event would be
  rejected with `unknown_event_type` (400). Hence the dormant-ship gate (R5).

## Key Technical Decisions

- **Counts derived from the `data` branch overlay, not new agent plumbing.** Add the
  `reconcile-repos.yaml` metadata-overlay step to the scheduled run, then derive
  `repos_tracked`/`surveys_today` from `metadata/repos.yaml`. Cheap and precedented.
- **Suppress-on-quiet gate is `surveys_today > 0`** for v1 (invitations omitted). On a quiet day the
  announce step is skipped entirely; the oversight issue is still created.
- **Report URL via deterministic `gh issue list`** after the agent step — match the agent's
  deterministic title (`Daily Fro Bot Report — YYYY-MM-DD (UTC)`) for today's UTC date. The agent
  creates the issue mid-run; the workflow rediscovers it rather than parsing agent output.
- **Ship dormant via a dedicated `DAILY_DIGEST_ENABLED` step gate**, NOT the global
  `GATEWAY_ANNOUNCE_DISABLED` kill switch. The announce step's `if:` requires `vars.DAILY_DIGEST_ENABLED`
  to be truthy; it is unset at merge, so the step is skipped entirely (never even calls the signer)
  and cannot 400 the not-yet-deployed gateway. The global kill switch remains the separate emergency
  mute for *all* events and is left untouched. Go-live = set `DAILY_DIGEST_ENABLED` after the gateway
  variant is deployed and verified.
- **Count derivation lives in a small testable script**, not inline `jq` in YAML, so the
  suppress-gate and count logic get real unit coverage (matches the repo's "logic in `scripts/*.ts`,
  tested with Vitest" convention).

## Open Questions

### Resolved During Planning

- **Exact count sources** → `repos_tracked` = `private: false` count; `surveys_today` =
  `last_survey_at == today(UTC)` count; both from `data`-branch `metadata/repos.yaml`.
- **Suppress signal** → `surveys_today > 0` for v1 (invitations omitted).
- **Event name + context shape** → `daily_digest` with `{ repos_tracked, surveys_today, report_url }`;
  must match the gateway-side issue (#765) in `fro-bot/agent`.
- **Report-URL discovery** → `gh issue list` by deterministic title + UTC date, after the agent step,
  with an explicit `GH_TOKEN` on the step and shape-validation of the resulting URL before signing.
- **Dormant mechanism** → dedicated `DAILY_DIGEST_ENABLED` step gate (default off), NOT the global
  `GATEWAY_ANNOUNCE_DISABLED` switch (which would mute the live events). Set it post-deploy.
- **Silent-failure differentiation** → the count script distinguishes "quiet day" (`should_post:false`,
  counts read OK) from "could not read metadata" (`count_status:'error'`) so a broken `data` overlay
  does not masquerade as a quiet day.

### Deferred to Implementation

- Exact `gh issue list` query/jq for robust title matching (resolve against the real agent title
  format when wiring the step).
- Whether the count script reads `metadata/repos.yaml` directly or takes pre-extracted values as args
  (decide for cleanest testability when writing it).

## Implementation Units

- [ ] **Unit 1: Teach the signer the `daily_digest` event type**

**Goal:** Extend `gateway-announce.ts` so it accepts and signs `daily_digest` without changing the
auth/replay contract.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `scripts/gateway-announce.ts` (add `daily_digest` to the `EventType` union and the
  `VALID_EVENT_TYPES` set)
- Test: `scripts/gateway-announce.test.ts`

**Approach:**
- Additive only: add the literal to both the type union and the runtime set. No payload, signing,
  retry, or redaction changes — `daily_digest` flows through the identical path as the other two.

**Execution note:** Test-first — add the accepting test for `daily_digest` before widening the set.

**Patterns to follow:** The existing two-literal handling and its tests in `gateway-announce.test.ts`.

**Test scenarios:**
- Happy path: a `daily_digest` payload with a valid context decodes, signs (byte-exact HMAC over
  `${ts}.${body}`), and produces the expected `{ v:1, event_type:'daily_digest', fired_at,
  rendered_text:null, context }` shape.
- Edge case: `isEventType('daily_digest')` is `true`; a bogus type is still `false`.
- Error path: kill switch (`GATEWAY_ANNOUNCE_DISABLED` set) short-circuits a `daily_digest` call to
  `{ posted:false, skipped:'kill-switch' }` before any parse.

**Verification:** New tests pass; existing signer tests unchanged; `tsc --noEmit` clean; the script
still loads under Node strip-only.

- [ ] **Unit 2: Count-derivation + suppress-gate script**

**Goal:** A small tested script that reads `metadata/repos.yaml` and emits the digest counts plus a
post/skip decision.

**Requirements:** R1, R2

**Dependencies:** Unit 1 (event type exists for the eventual context shape)

**Files:**
- Create: `scripts/daily-digest-counts.ts` (name TBD; derive `repos_tracked`, `surveys_today`, and a
  `should_post` boolean)
- Create: `scripts/daily-digest-counts.test.ts`

**Approach:**
- Read `metadata/repos.yaml` (assume the overlay has placed it on disk; the repo already depends on
  the `yaml` package, usable under strip-only). `repos_tracked` = count of `private: false`;
  `surveys_today` = count of `last_survey_at == today(UTC)`. `should_post` = `surveys_today > 0`.
- Emit JSON with a **`count_status`** field (`'ok' | 'error'`): on missing/malformed metadata, emit
  `{count_status:'error', should_post:false}` plus a stderr diagnostic — so a data-plumbing failure is
  distinguishable from a genuine quiet day, not silently collapsed into `should_post:false`.
- Keep date handling UTC-explicit to match `last_survey_at` (a `YYYY-MM-DD` date) against today.

**Execution note:** Test-first — the suppress-gate boundary is the load-bearing behavior.

**Patterns to follow:** Existing `scripts/*.ts` CLIs (env/arg parse, JSON-to-stdout, Node strip-only,
Vitest).

**Test scenarios:**
- Happy path: a fixture with 3 public + 1 private repo, 2 surveyed today → `repos_tracked:3`,
  `surveys_today:2`, `should_post:true`.
- Edge case (quiet day): no entries with `last_survey_at == today` → `surveys_today:0`,
  `should_post:false`.
- Edge case: private entries are excluded from `repos_tracked`; an entry missing `private` is treated
  per the file's actual convention (decide and pin in a test).
- Edge case: empty/zero-repo `metadata/repos.yaml` → zero counts, `should_post:false`, no throw.
- Error path: missing or malformed `metadata/repos.yaml` → fail-soft (emit
  `{count_status:'error', should_post:false}` and a stderr diagnostic, do not throw — a count failure
  must never break the run per R3, and must be distinguishable from a quiet day).
- Edge case: UTC date boundary — an entry surveyed "today" in UTC counts; one surveyed yesterday does
  not (pin with a fixed clock).

**Verification:** Tests pass; script loads under strip-only; `tsc --noEmit` clean.

- [ ] **Unit 3: Wire the scheduled run — metadata overlay, report-URL, dormant announce**

**Goal:** In `fro-bot.yaml`, overlay `metadata/`, derive counts, discover the report URL, and post
the `daily_digest` (shipped dormant), without touching the legacy webhook step.

**Requirements:** R1, R2, R3, R5

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `.github/workflows/fro-bot.yaml`

**Approach:**
- Add a `metadata/` overlay step (copy `reconcile-repos.yaml`'s `git fetch --no-tags origin data` +
  `git checkout origin/data -- metadata/`), gated to the scheduled run, tolerating a missing `data`
  branch (mirror `reconcile-repos.yaml`'s guard).
- After the agent step, add a report-URL discovery step. It MUST set `GH_TOKEN: ${{ secrets.FRO_BOT_PAT }}`
  on the step (the agent action receives `github-token` via `with:`, but a sibling shell step has no
  inherited token). Query `gh issue list` by the agent's deterministic title + today's UTC date, and
  **validate** the result is an `https://github.com/<owner>/<repo>/issues/<number>` URL for the
  expected repo before it is used; on no-match or shape-mismatch, skip the post (fail-soft).
- Add a step that runs `scripts/daily-digest-counts.ts`, then a `📣 Announce daily digest to gateway`
  step that builds `EVENT_CONTEXT_JSON` (`repos_tracked`, `surveys_today`, validated `report_url`) via
  `jq -nc` and runs `node scripts/gateway-announce.ts` with `EVENT_TYPE=daily_digest` and the
  `GATEWAY_*` env (mirror the env block in the two existing announce steps).
- **Dormancy is a dedicated step gate, not the global kill switch.** Gate the announce step's `if:` on
  `github.event_name == 'schedule'` **and** `should_post == true` **and** `vars.DAILY_DIGEST_ENABLED`
  truthy. `DAILY_DIGEST_ENABLED` is unset at merge, so the step is skipped entirely and never calls
  the signer — it cannot 400 the not-yet-deployed gateway. Do NOT set `GATEWAY_ANNOUNCE_DISABLED`
  (that would mute the live events).
- Surface a `count_status == 'error'` result as a step warning (so a broken `data` overlay is visible
  in the run, not silently swallowed as a quiet day).
- Leave the legacy `📣 Notify Discord — daily oversight` step and `discord-notify.ts` untouched.

**Execution note:** none (workflow wiring; behavior is covered by Unit 1/2 tests + actionlint).

**Patterns to follow:** The two existing announce steps in `survey-repo.yaml` / `poll-invitations.yaml`;
the metadata overlay in `reconcile-repos.yaml`; the knowledge-overlay shape already in `fro-bot.yaml`.

**Test scenarios:** Test expectation: none — pure workflow wiring; the count/suppress and signer
behavior are unit-tested in Units 1-2. Validate with `actionlint` and the strip-only script-load CI
job.

**Verification:** `actionlint` clean; the scheduled run YAML parses; the announce step is present and
gated on `schedule` + `should_post` + `vars.DAILY_DIGEST_ENABLED`; with `DAILY_DIGEST_ENABLED` unset
the step is skipped (never calls the signer); the discovery step carries `GH_TOKEN`; the global
`GATEWAY_ANNOUNCE_DISABLED` is untouched and the two live events are unaffected; the legacy webhook
step is unchanged.

- [ ] **Unit 4: Docs — event type, secrets/vars, and go-live runbook**

**Goal:** Document the new event type and the exact dormant→live sequence.

**Requirements:** R5

**Dependencies:** Unit 1-3

**Files:**
- Modify: `metadata/README.md` (add `DAILY_DIGEST_ENABLED` to the `GATEWAY_*`/vars table + a
  `daily_digest` event note with its context shape)

**Approach:**
- Document `daily_digest` alongside the other two events and the `{repos_tracked, surveys_today,
  report_url}` context shape, and document `DAILY_DIGEST_ENABLED` as the control-plane go-live gate.
- Keep this control-plane-scoped: the enable step is "set `DAILY_DIGEST_ENABLED` once the gateway
  variant is confirmed live, then verify one post." Reference (do not duplicate) the gateway/infra
  deployment steps, which are owned by `fro-bot/agent` #765 and `marcusrbrown/infra`.

**Test scenarios:** Test expectation: none — documentation only.

**Verification:** Docs render; the go-live sequence is unambiguous and names all three repos.

## System-Wide Impact

- **Interaction graph:** Adds a new consumer of the `data`-branch `metadata/` overlay inside the
  scheduled run, and a new caller of `gateway-announce.ts`. No change to the signer's auth/replay
  pipeline or to the other two event call sites.
- **Error propagation:** Count derivation and the announce POST are both fail-soft — neither can fail
  the scheduled oversight run (R3). The metadata overlay step should also tolerate a missing `data`
  branch without failing the run (mirror `reconcile-repos.yaml`'s guard).
- **State lifecycle risks:** The report-URL discovery races the agent's issue creation — it must run
  **after** the agent step and tolerate "not found" (skip the post rather than fail).
- **API surface parity:** The signer change is the cross-repo contract point — the `daily_digest`
  context shape (`repos_tracked`, `surveys_today`, `report_url`) must match the gateway-side schema in
  `fro-bot/agent` #765 exactly, or the gateway 400s it post-deploy.
- **Unchanged invariants:** The legacy webhook path, the oversight issue creation, and the existing
  `survey_completed` / `invitation_accepted` flows are all untouched by this plan.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| Control-plane event ships before the gateway knows `daily_digest` → 400 `unknown_event_type` | Gate the step on `vars.DAILY_DIGEST_ENABLED` (default unset) so it is skipped entirely — never calls the signer — until go-live. Do NOT use the global `GATEWAY_ANNOUNCE_DISABLED` (it would mute the live events). (R5) |
| Report-URL discovery step has no token | Set `GH_TOKEN: ${{ secrets.FRO_BOT_PAT }}` on the step (the action's `with: github-token` does not reach sibling shell steps). |
| Untrusted `report_url` flows into the signed, gateway-rendered message | Validate the discovered URL is an `https://github.com/<owner>/<repo>/issues/<n>` shape for the expected repo before signing; skip on mismatch. |
| Broken `data` overlay silently looks like a quiet day | Count script emits `count_status:'error'` distinct from `should_post:false`; the workflow surfaces an error as a step warning. |
| Context shape drifts from the gateway-side schema | Pin the exact `{repos_tracked, surveys_today, report_url}` shape against `fro-bot/agent` #765 before enabling. |
| Report URL not found (agent issue-title format changes) | Discovery step tolerates "not found" and skips the post (fail-soft), never fails the run. |
| Metadata overlay adds run cost / `data` branch absent | Reuse the precedented, guarded overlay from `reconcile-repos.yaml`; tolerate missing `data`. |
| Counts wrong at UTC date boundary | UTC-explicit date logic, pinned with a fixed-clock test (Unit 2). |
| `marcusrbrown/infra` redeploy is assumed but not observable | Before setting `DAILY_DIGEST_ENABLED`, confirm the gateway variant is actually serving (a deployed-version/health probe or infra release marker), not just that a redeploy was triggered. |

## Documentation / Operational Notes

- **Go-live sequence (three repos):** (1) gateway `daily_digest` schema + template + posting merges
  in `fro-bot/agent` (#765) and releases; (2) `marcusrbrown/infra` redeploys the gateway image to that
  version; (3) **confirm the gateway variant is actually serving** (deployed-version/health probe or
  infra release marker — not just that a redeploy ran); (4) set `vars.DAILY_DIGEST_ENABLED` so the
  control-plane step posts (the global `GATEWAY_ANNOUNCE_DISABLED` is never touched); (5) verify
  exactly one live `daily_digest` post as the Fro Bot user with a working report link; (6) **then** the
  separate follow-up PR removes `discord-notify.ts` + the legacy step.
- Until step (4), the daily oversight Discord post continues via the untouched legacy webhook — no
  coverage gap, and no double-post (the new step is skipped while `DAILY_DIGEST_ENABLED` is unset).

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-04-daily-digest-presence-event-requirements.md`
- Related code: `scripts/gateway-announce.ts`, `scripts/gateway-announce.test.ts`,
  `.github/workflows/fro-bot.yaml`, `.github/workflows/reconcile-repos.yaml`,
  `.github/workflows/survey-repo.yaml`, `.github/workflows/poll-invitations.yaml`
- Related prior plan: `docs/plans/2026-06-04-001-feat-gateway-announce-presence-plan.md`
- Gateway-side dependency: `fro-bot/agent` issue #765; deployment in `marcusrbrown/infra`
- Legacy path being retired (follow-up): `scripts/discord-notify.ts`
