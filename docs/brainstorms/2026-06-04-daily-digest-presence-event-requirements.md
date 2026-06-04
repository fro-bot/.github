---
title: Daily digest presence event — migrate the scheduled report off the webhook
date: 2026-06-04
status: requirements
scope: standard
---

# Daily digest presence event

## Problem

The daily scheduled oversight run is the last Discord poster still on the legacy
webhook path (`scripts/discord-notify.ts` in `fro-bot.yaml`, the
`📣 Notify Discord — daily oversight` step). It posts as a webhook bot, not as
the Fro Bot user, and its message is a near-static heartbeat
("Daily oversight complete … signal maintained 🛰️") that fires every scheduled
run regardless of whether anything happened.

Survey and invitation events already moved to the gateway and post as the Fro Bot
user. The daily report should join them — but reframed as a **character moment**,
not a cron heartbeat.

## Goals

- Migrate the daily report off the webhook so it posts **as the Fro Bot user**
  via the gateway, like the other two presence events.
- Make it a **character moment**: something Fro Bot reflects on about its day,
  not a status ping.
- Only speak up when the day had **noteworthy activity** — stay silent on quiet
  days so the presence channel isn't a daily buzzer.
- Carry **cheap, already-available counts** plus a **link** to the full oversight
  report issue for the rich detail.
- Remove the last `discord-notify.ts` webhook caller once the gateway path is live.

## Non-goals

- No new structured-metrics contract from the agent (no marker-parsing of the
  oversight issue prose). Rich detail lives in the linked issue.
- No critical-alert-driven posting in v1 (that needs structured agent output the
  report doesn't emit today). See Open Questions.
- No change to the oversight **issue** itself — the agent still creates the daily
  "Daily Org Oversight Report" issue every run. This is only about the Discord
  presence post.
- No LLM-composed message in the control plane (v1 keeps `rendered_text: null`;
  the gateway renders from a template, consistent with the other two events).

## Key decisions

| Decision | Choice |
| --- | --- |
| Framing | Character moment, not a heartbeat |
| Content | Hybrid — cheap counts + link to the report issue |
| Cadence | Suppress on quiet days (post only when the day had activity) |
| Ownership | Two-sided, **gateway-first** (see Constraint) |
| Composer | Gateway-side template; control plane sends `rendered_text: null` |

## Critical constraint — this is a two-sided, gateway-first change

The shipped gateway's `event_type` is a **closed `Schema.Union`** of exactly two
literals (`survey_completed`, `invitation_accepted`) in
`packages/gateway/src/http/announce-schema.ts`, and the render side
(`templates.ts`) is an equally closed `Record<event_type, …>` + per-type switch.

A new daily-digest event **cannot be posted control-plane-only** — the gateway
would reject it with `unknown_event_type` (400). The gateway must ship the new
schema variant **and** its render template **first** (fro-bot/agent side, the
`#671` split: agent owns schema + templates + discord.js posting; this repo owns
detection + signing + POST). Only then can the control-plane step go live.

This mirrors the existing ownership split (project memory): the brainstorm and the
control-plane POST live here; the gateway contract + rendering live in
fro-bot/agent.

## Proposed shape (WHAT, not HOW)

A new gateway event — working name `daily_digest` — carrying:

- **Cheap counts** — cheap in that they need no new *agent* plumbing (no
  marker-parsing of issue prose), but they DO require reading `metadata/repos.yaml`
  from the `data` branch. The scheduled `fro-bot.yaml` run does not currently
  overlay `data`, so a `git fetch origin data` + `git checkout origin/data -- metadata/`
  overlay step must be added (the same pattern `survey-repo.yaml` and
  `reconcile-repos.yaml` already use — cheap and precedented, but not free):
  - `repos_tracked` — count of public entries in `metadata/repos.yaml`
  - `surveys_today` — entries whose `last_survey_at` is today
  - `invitations_accepted_today` — only if cheaply derivable in the scheduled run;
    otherwise omit in v1 (see Open Questions)
- **`report_url`** — the URL of the oversight issue the run just created (found by
  deterministic title + UTC date via `gh issue list`, cheaply available in the
  workflow).
- The gateway template renders these into an in-character daily reflection that
  links the report.

### Suppress-on-quiet-day gate

Post only when the day had noteworthy activity. v1 signal (cheap):
`surveys_today > 0` OR `invitations_accepted_today > 0`. If `invitations_accepted_today`
is not cheaply derivable in the scheduled run, v1 gates on `surveys_today > 0`
alone. On a genuinely quiet day, skip the Discord post entirely. The oversight
**issue** is still created either way — suppression only affects the presence post.

## Success criteria

- **SC1** — On a day with activity, the scheduled run posts exactly one
  daily-digest message to Discord **as the Fro Bot user**, carrying real cheap
  counts and a working link to that day's oversight report issue.
- **SC2** — On a quiet day (no surveys, no invitations), no daily-digest Discord
  post is made; the oversight issue is still created.
- **SC3** — The legacy `📣 Notify Discord — daily oversight` webhook step and its
  `discord-notify.ts` invocation are removed from `fro-bot.yaml`; no
  `discord-notify.ts` callers remain anywhere. **Sequencing:** this removal must
  land only *after* the gateway `daily_digest` variant is deployed and the
  control-plane announce step is live — removing the webhook earlier would leave
  the daily run with no Discord poster in the gap. The safe order is: gateway
  ships → control-plane announce step enabled and verified → webhook step removed
  in the same or a following change.
- **SC4** — Best-effort: a gateway failure never fails the scheduled oversight
  run (same fail-soft contract as the other announce steps).

## Open questions (for planning)

1. **Exact count sources.** Confirm the cheapest reliable derivation of
   `surveys_today` and `repos_tracked` from the `data` branch within the
   scheduled `fro-bot.yaml` run (which doesn't currently overlay `data`).
   Is `invitations_today` cheaply available, or omit for v1?
2. **Suppress signal precision.** Is `surveys_today > 0 OR invitations_today > 0`
   the right gate, or should "critical alert in the report" eventually count?
   (Critical-alert detection needs structured agent output — deferred.)
3. **Gateway event name + schema.** Final `event_type` literal and `context`
   shape, agreed with the fro-bot/agent side. Drives the fro-bot/agent issue.
4. **Report-URL discovery.** Most robust way to get the just-created issue's URL
   (the agent creates it mid-run; the workflow needs its number/URL afterward).
5. **Dormant-until-gateway fallback.** Gateway-first ordering is a settled
   constraint (see above), not an open question. What remains open: should the
   control-plane step ship dormant (behind the missing event type, which the
   gateway would 400) and self-enable once the gateway deploys, or be held back
   entirely until the gateway variant lands? The kill-switch variable already
   exists as a manual mute either way.

## Dependencies

- **fro-bot/agent** (gateway): new `daily_digest` schema variant + render
  template + discord.js posting. Gateway-first. Likely a new issue in the `#671`
  presence epic.
- Existing control-plane primitives reused: `scripts/gateway-announce.ts`
  (signer — adding the new event needs BOTH the `EventType` type union AND the
  runtime `VALID_EVENT_TYPES` set updated, or `runCli` rejects it as
  `invalid-event-type`), the fail-soft + redaction contract, and the `GATEWAY_*`
  secrets/variables already seeded.

## Review dissent (recorded, not adopted)

The scope-guardian review challenged two decisions made above, as advisory:

- **Drop the suppress-on-quiet-day gate for v1** (always post once daily) — argued
  it better matches the bare "migrate the webhook" goal and removes a decision
  path. **Not adopted**: the character-moment framing is the point; a daily buzzer
  is what we're moving away from. Kept as a decision.
- **Trim to link-only (drop cheap counts) for v1** — argued counts add derivation
  work without clearly improving the migration. **Not adopted**: the counts are
  what make it a digest rather than a bare link, and the overlay step is cheap and
  precedented. Kept as a decision.

Both are revisitable in planning if the overlay/derivation cost proves higher than
expected.
