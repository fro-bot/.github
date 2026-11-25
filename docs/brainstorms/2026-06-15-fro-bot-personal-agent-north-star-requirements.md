---
title: Fro Bot as Personal Agent — North-Star Architecture
date: 2026-06-15
scope: deep
kind: north-star
---

# Fro Bot as Personal Agent — North-Star Architecture

## Purpose

This is a north-star map, not an implementation plan. It captures the full vision of
Fro Bot as a personal autonomous agent, places each capability in its owning system,
exposes the dependency spine, and proposes a phased roadmap with a recommended first
workstream. Per-capability requirements and design belong in their own brainstorms/plans.

## The vision in one sentence

Fro Bot evolves from a GitHub control plane that surveys repos and announces events into
a self-improving personal agent that the operator can see and command from one place,
that maintains and improves itself and the projects it stewards, and that coordinates work
across repos, other agents, and eventually domains beyond software.

## The five systems

| System | Repo / location | Role today | Role in the vision |
|---|---|---|---|
| **Control plane** | `fro-bot/.github` (this repo) | Surveys 25+ repos, Karpathy wiki, reconcile/cadence, autoheal, gateway announce | The integrator and brain; orchestrates the others, grows skills, holds the wiki |
| **Agent / Gateway** | `fro-bot/agent` | OpenCode agent action + `gateway.fro.bot` (Discord client + `POST /v1/announce`) | The hands and the live presence; gains a web/HTTP control surface |
| **IaC** | `marcusrbrown/infra` | Caddy+Compose+SSH fleet (`*.fro.bot`); deploys gateway, cliproxy, umami, vpn | Hosts the dashboard + any new services; the substrate |
| **Workflows** | Systematic (`marcusrbrown/systematic`) | Durable structured workflows (brainstorm/plan/work/review/compound) | The discipline layer for cross-repo planning and durable agent learning |
| **Dashboard** | net-new | — | The operator's window and command surface (PWA) |

_Note (2026-11-25): the "Role today" column is the 2026-06-15 snapshot, kept as written. The
dashboard is no longer net-new: it is deployed at `dashboard.fro.bot` (release 2026.11.29, infra
run [45110702686](https://github.com/marcusrbrown/infra/actions/runs/45110702686), per the
[#3512](https://github.com/fro-bot/.github/issues/3512) state of 2026-11-24). The gateway is no
longer outbound-only (see S1). The "25+ repos" figure was not recounted._

## Rebaseline (2026-06-21) — program is running concurrent, not serial

This doc's original roadmap recommended a serial Phase 1 → 2 → 3. Reality has diverged, and
this note rebaselines it:

- **Phase 1 (read-only dashboard):** code-complete in `fro-bot/dashboard` (Units 1-6) and
  `marcusrbrown/infra` (deploy stack, Units 7-8) — **but not yet operationally verified**
  (live deploy, production-shaped redaction exercise, and infra security posture are owed
  before it can be called done). The R8 cross-source leak guard is genuinely implemented.
- **Phase 2 (S1/S2 spine):** already in **active parallel implementation** in `fro-bot/agent`
  (operator auth/OAuth/session/CSRF/allowlist + repo-authz helper merged through "Unit 3f",
  `v0.69.0` released; umbrella `fro-bot/agent#907`). It is no longer "design now, build later."
- **Phase 3 (interactive dashboard):** exploratory/mock work has started (dashboard `#37`
  typed mock operator-client merged; `#26` mock operator UI skeleton open) — but this is
  **gated on `fro-bot/agent` owning and freezing the canonical operator API contract**. The
  mock must remain a non-canonical fixture, never the de facto API design.
- **A1 (Tier 2, grow-and-learn): SHIPPED + validated 2026-06-22.** The control-plane-native
  autonomy capability landed independently of the spine, as the dependency model predicted.
  Retrieve + propose-only capture + review-prose enrichment are all live.
- **A2 (Tier 2, self-maintenance): first two surfaces SHIPPED as of 2026-07-03.** The
  status-truth maintenance loop (detect, proposals, per-kind outcome telemetry) and the wiki
  authority repair loop are both live, control-plane-native. Bounded correction PR machinery
  shipped fully disarmed; graduation to real corrections is pending an accepted-outcome signal.

So the operating truth is **concurrent workstreams**, not strict serial phases. The serial
roadmap below is retained as the original strategic recommendation, not the current schedule.

Correction to the original framing: this doc said the Phase-1 visibility slice needs "no
spine and no auth." The shipped Phase-1 dashboard *does* use operator auth (a dedicated GitHub
OAuth App + signed cookie) because it holds a GitHub App read key and must be operator-only.
"No spine" still holds; "no auth" does not.

## Reconciliation (2026-07-10) — spine shipped, autonomy tier essentially complete

A full grounding pass on 2026-07-10 found the map stale in one consistent direction: every
capability is further along than the 2026-06-21 rebaseline claimed. Verified deltas:

- **S1 (web/HTTP control surface):** shipped in source in `fro-bot/agent` — the authenticated
  inbound operator surface exists (launch work / query state / SSE stream) distinct from
  outbound `POST /v1/announce`; the umbrella issue `fro-bot/agent#907` is CLOSED; operator
  contract advanced to v1.6.0. Live end-to-end deploy-verification remains the one open item
  (tracked in `fro-bot/.github#3512`).
- **S2 (operator web auth):** LIVE in production at `dashboard.fro.bot` — browser GitHub
  OAuth (PKCE) + signed session + CSRF + origin binding, not shared-secret HMAC. The earlier
  logout-session-invalidation bug (`fro-bot/dashboard#156`) is fixed.
- **R1 (dashboard PWA):** Phase 1 read-only deployed and live; the interactive surface
  (launch, approval decision, SSE run stream) is substantially built and flag-gated; the
  earlier mock operator-client was retired in favor of the frozen canonical contract.
  Remaining: a Cancel UI and pinning to contract v1.6.0.
- **R2 (push notifications):** was "not started"; now in-progress — the push transport
  (VAPID, subscription store, dispatcher, service worker) is shipped end-to-end; only the
  in-notification action-response capability (approve/reject from the notification itself)
  remains unbuilt.
- **R3 (web-viewable/editable wiki):** the read-only half SHIPPED after this note's
  grounding pass — the wiki is live as a Quartz digital garden at `fro.bot/.github`
  (wikilinks, backlinks, search, graph, brand theme; hardened split build/deploy
  pipeline with emergency takedown), later re-architected onto Quartz v5 with a
  fail-closed plugin-lockfile gate. The editable path (operator edits flowing back
  through the `data`-branch authority model) remains the open half.
- **A2 (self-maintenance):** the bounded-PR correction machinery has GRADUATED —
  `plan-consistency` is now an active graduated claim kind (no longer "shipped disarmed,
  pending signal").
- **A3 (cross-repo planning & dispatch):** shipped and proven in production across
  multi-repo goals (owner-aware two-App dispatch, prompt-only, hash-bound worker receipts,
  watchdog tracking).
- **New autonomy loops not in the original map:** two control-plane self-maintenance loops
  shipped since — a recurring-pattern synthesis loop (Capture Patterns) and a
  self-improvement metric loop (Improvement Metrics: discovery + human-confirmed
  recidivism, rendered to a perpetual report issue). Both manual-dispatch, dry-run-default,
  report-only.

Strategic read: the Tier-2 control-plane autonomy arc (A1/A2/A3 + the two new loops) is
essentially complete, and the genuinely-open north-star threads are R2 inline actions
(other repos), R3's editable path, and the Tier-3 frontier, plus the one open spine
deploy-verification.

## Reconciliation (2026-11-08)

A grounding pass against live state on 2026-11-08 found four statuses stale:

- **S1:** deployed. Gateway v0.136.4 went live through marcusrbrown/infra#1847, and the
  operator contract is 1.15.0. Authenticated end-to-end acceptance is still tracked in
  `fro-bot/.github#3512`.
- **R1:** the operator accepted the interactive approve, deny and question flows on
  v0.136.4 (#3512 Gate 4). Cold boot, policy grace, SSE reconnect and cookie replay are
  still open in #3512.
- **R2:** decided against. `fro-bot/agent#1917` was closed as not planned on 2026-11-05.
  Push notifications stay deep-link only, because the payload carries no tool or command
  and iOS ignores notification action buttons.
- **R3 editable:** built. `docs/plans/2026-08-29-001-feat-editable-wiki-path-plan.md` is
  complete, and the editor and save path shipped in fro-bot/dashboard. Whether the Edit
  affordance is enabled in production is unverified.

A3, C4 and O8 run, but only A3 is scheduled, and its green runs do not show that a
dispatch succeeded end to end. F1 and F2 have not started.

The open threads are now:

- the S1/S2 and R1 live acceptance in #3512, which fro-bot/agent, fro-bot/dashboard and
  marcusrbrown/infra own;
- live enablement of R3's editable path;
- the Tier-3 frontier.

Two control-plane pushes follow from this pass. The A2 status-truth loop should reconcile
this doc's status claims against live state, since the doc drifted in four places in four
months. F1 needs a work-offer substrate, and `packages/dispatch`'s hash-bound receipts are
the natural base. F1 needs its own brainstorm first.

## Reconciliation (2026-11-25) — status-truth pass

This is the status-truth reconciliation the 2026-11-08 pass asked for. Every requirement, tier
item and status claim in this doc was checked on 2026-11-25 against `origin/main` at `7edd2808`,
the `status` fields in `docs/plans/`, merged pull requests, issue state and workflow runs. It was
done by hand: `docs/brainstorms/` is excluded from the status-truth scan
(`SCAN_EXCLUDE_PATTERNS` in `packages/status-truth/src/detect-extract.ts`), so no loop checks this
doc and it drifts unless someone reads it against live state.

Superseded text stays in place and carries a dated note. The words mean this:

- **Shipped:** merged and seen working in a run, with the run or commit cited.
- **Built:** merged and covered by tests, not yet seen in a live run.
- **Partly built:** the part that exists is named.
- **Not built**, or **dropped** with the decision that dropped it.

### Corrections to earlier reconciliations

- **2026-11-08, "only A3 is scheduled":** wrong. Improvement Metrics (O8) has run weekly on
  `0 23 * * 0` since [#3779](https://github.com/fro-bot/.github/pull/3779) (2026-08-27). Scheduled
  runs [43793481768](https://github.com/fro-bot/.github/actions/runs/43793481768) (2026-11-16) and
  [45107165592](https://github.com/fro-bot/.github/actions/runs/45107165592) (2026-11-23) succeeded.
  Capture Patterns (C4) is `workflow_dispatch` only; its last run was
  [41724214832](https://github.com/fro-bot/.github/actions/runs/41724214832) on 2026-11-03.
- **2026-11-08, A3 "green runs do not show a dispatch succeeded end to end":** the end-to-end
  proof exists. Goal issue [#3633](https://github.com/fro-bot/.github/issues/3633) (closed
  2026-07-04) ends with `Goal complete. completed=2 failed=0 blocked=0` and hash-bound item state.
  The scheduled tracking runs are green (latest
  [45529024636](https://github.com/fro-bot/.github/actions/runs/45529024636), 2026-11-25). This
  pass did not count other goals.
- **2026-11-08, Gateway v0.136.4:** the Gateway is now v0.146.0 (workspace-only rebuild, infra run
  [45323526850](https://github.com/marcusrbrown/infra/actions/runs/45323526850), infra#2058), contract
  1.15.0, per the #3512 body of 2026-11-24. The v0.136.4 figure was right on 2026-11-08.
- **2026-10-22, D2 "`/fro-bot cancel` is a follow-up":** closed. `/fro-bot cancel` merged in
  [fro-bot/agent#2066](https://github.com/fro-bot/agent/pull/2066) on 2026-11-04 and is in
  v0.146.0's source. Not observed in a live Discord run by this pass.
- **2026-11-08, R3 editable "production enablement unverified":** a save through the dashboard
  wrote commit `5ba9bd0` on `data` on 2026-11-18 (recorded in
  `docs/plans/2026-11-15-003-feat-repo-lifecycle-archive-declared-rename-plan.md`; the commit
  subject is `docs(knowledge): manual edit …`).

### Control-plane work since 2026-11-08

| Item | Status 2026-11-25 | Evidence |
| --- | --- | --- |
| Promotion self-merge | Shipped | Built in [#4168](https://github.com/fro-bot/.github/pull/4168); `PROMOTION_SELF_MERGE` is `on`. First live merge was [#4175](https://github.com/fro-bot/.github/pull/4175) (run [42942262202](https://github.com/fro-bot/.github/actions/runs/42942262202)), then #4204 and #4225. `docs/plans/2026-11-09-001-feat-promotion-self-merge-plan.md` is complete. Test-covered only, per that plan: a `hold-merge` label stopping a promotion, checks that never settle. |
| Stale-base replacement of a promotion PR | Built | [#4290](https://github.com/fro-bot/.github/pull/4290), merged 2026-11-18. It fixes the dismissed approval seen on run [44124965721](https://github.com/fro-bot/.github/actions/runs/44124965721) (plan `2026-11-15-003`). A live replacement by the shipped code was not looked for. |
| Renovate approval sweep | Shipped | [#4186](https://github.com/fro-bot/.github/pull/4186); `RENOVATE_APPROVE` is `on`. It approved #4179 and #4192 merged with no operator action (`docs/plans/2026-11-11-001-feat-renovate-automerge-approval-plan.md`, complete). Still owed in that plan: the grouped-PR label check. |
| Sweep yields to people | Built | [#4207](https://github.com/fro-bot/.github/pull/4207) (2026-11-12) pauses the sweep while a person's pull request is in review; [#4317](https://github.com/fro-bot/.github/pull/4317) (2026-11-23) runs it only for `renovate/` branches and stops `fro-bot`'s own PRs from causing a yield. No live yield was looked for. |
| Knowledge tools and prompt duties | Shipped | The `knowledge` server (`wiki_search`, `solutions_search`) is `docs/plans/2026-11-06-001-feat-agent-knowledge-mcp-tools-plan.md` (complete); call logging is [#4136](https://github.com/fro-bot/.github/pull/4136); the prompt duties arrived with [#4232](https://github.com/fro-bot/.github/pull/4232). Run [45530059817](https://github.com/fro-bot/.github/actions/runs/45530059817) logged `mcp connected server=knowledge tools=2`. |
| Wiki index for the daily passes | Shipped | [#4232](https://github.com/fro-bot/.github/pull/4232). Scheduled runs [43682281142](https://github.com/fro-bot/.github/actions/runs/43682281142) and [43812012295](https://github.com/fro-bot/.github/actions/runs/43812012295) printed `wiki-index: listed=48 held=48 skipped=0` in both Remediate and Observe. The plan (`2026-11-14-001`) is still `active`: the 14-day knowledge-tool count is due 2026-11-28. In its 2026-11-16 sample, only pull request reviews called a knowledge tool; Remediate and Observe made no call. |
| Agent models by kind of work | Shipped, two paths not seen live | [#4243](https://github.com/fro-bot/.github/pull/4243); plan `2026-11-15-001` is complete. Review run [43814296026](https://github.com/fro-bot/.github/actions/runs/43814296026) printed `Agent model: … (from FRO_BOT_MODEL_REVIEW)`. The issue and issue-comment light tier and Capture Patterns were not seen live (the plan closes them as deferred); a discussion-comment run cannot occur, since discussions are off. |
| Repeat surveys update in place | Built, live check partly done | Writer [#4244](https://github.com/fro-bot/.github/pull/4244), prompt and schema [#4247](https://github.com/fro-bot/.github/pull/4247). Plan `2026-11-15-002` is still `active`. Seen: a repeat survey of an unchanged repository left the page untouched and added one log entry (run [43681628468](https://github.com/fro-bot/.github/actions/runs/43681628468)). Not recorded: the first three scheduled repeat surveys and the 30-day measure. |
| Skip a repeat survey when nothing changed | Dropped | [#4242](https://github.com/fro-bot/.github/issues/4242) was closed as not planned on 2026-11-24; `docs/ideation/2026-11-07-open-ideation.md` item 5 records that the agent still runs for every survey. |
| Repo lifecycle: archive and unarchive | Archive shipped; unarchive built | Registry state [#4265](https://github.com/fro-bot/.github/pull/4265), active jobs skip [#4270](https://github.com/fro-bot/.github/pull/4270), leak gates [#4273](https://github.com/fro-bot/.github/pull/4273), reconcile [#4278](https://github.com/fro-bot/.github/pull/4278), actions and index [#4281](https://github.com/fro-bot/.github/pull/4281). Plan `2026-11-15-003` is complete. Archive run [44019346503](https://github.com/fro-bot/.github/actions/runs/44019346503), promotion [#4287](https://github.com/fro-bot/.github/pull/4287), and a seven-day check with no survey or dispatch for the archived row. `unarchive` is test-only; the plan says no real need arose. |
| Declared rename (lifecycle phase 2) | Not built, descoped | The plan's Phase 2 section: "Not built. Decided 2026-11-16"; the existing rename workflow is unchanged. |
| Remediate learnings handoff | Shipped for the Remediate side | [#4214](https://github.com/fro-bot/.github/pull/4214). The Remediation handoff comment is on the daily report [#4314](https://github.com/fro-bot/.github/issues/4314) (run [45363171280](https://github.com/fro-bot/.github/actions/runs/45363171280)). Observe's staging of a non-empty list was not seen: the reports checked say `Remediation learnings: none reported.` A wiki handoff for Remediate itself was not built (`docs/ideation/2026-11-07-open-ideation.md` item 6). |
| Remediate PR self-review | Shipped | [#4291](https://github.com/fro-bot/.github/pull/4291) (2026-11-18). [#4299](https://github.com/fro-bot/.github/pull/4299), opened by `fro-bot` on 2026-11-19, got a [`fro-bot` comment review](https://github.com/fro-bot/.github/pull/4299#pullrequestreview-5970661631) from run [44475929758](https://github.com/fro-bot/.github/actions/runs/44475929758), which succeeded. |
| Wiki writer retries a GitHub 5xx | Built | [#4325](https://github.com/fro-bot/.github/pull/4325), merged 2026-11-25. No run that hit a server error was looked for. |
| Review the settled PR head | Dropped | `docs/ideation/2026-11-07-open-ideation.md` item 1: 172 reviews in 30 days, 2 superseded. The defect found instead, a second review on an unchanged head, is open as [fro-bot/agent#2341](https://github.com/fro-bot/agent/issues/2341). |
| Actionable attention list | Shipped as prompt duties | [#4160](https://github.com/fro-bot/.github/pull/4160); plan `2026-11-08-003` is complete with a ten-report readback. The hypotheses section and the approval table were not built. |

### Not verified in this pass

- S2 (browser sign-in, CSRF, origin binding) was not exercised, since it needs an authenticated
  browser. #3512 still lists CSRF and saved-cookie replay, and session continuity on the current
  pair, as open gates.
- Whether agent v0.148.0 (released 2026-11-25) has been promoted to the Gateway.
- The "25+ repos" figure in the system table and the Current state section.
- Cross-repo items the plans track in other repositories, for example
  [fro-bot/agent#2187](https://github.com/fro-bot/agent/issues/2187) and fro-bot/dashboard#825
  (dashboard-started programs).

## Current state (verified 2026-06-15)

> **Historical snapshot (note 2026-11-25).** Kept as written. Superseded since: the gateway has an
> authenticated inbound operator surface (S1, deployed, contract 1.15.0), operator web auth is live
> (S2), the dashboard exists, and `/fro-bot cancel` joined the Discord commands
> ([fro-bot/agent#2066](https://github.com/fro-bot/agent/pull/2066), merged 2026-11-04). "No HTTP
> command/mission/state API; no web/user auth concept" is no longer true. See the 2026-11-25
> reconciliation above for the current statuses.

Grounded against live source, not aspiration:

**Control plane** (`fro-bot/.github`):
- Surveys 25+ repos into a Karpathy-style wiki on the `data` branch; reconcile with
  per-channel cadence, minimum-floor, stuck-repo canary; privacy gates; daily digest.
- Unified daily oversight + autoheal: opens minimal fix PRs, files cross-repo signal,
  maintains a single perpetual report issue.
- Announces `survey_completed` / `invitation_accepted` / `daily_digest` to the gateway.

**Agent / Gateway** (`fro-bot/agent`, head `3adf5ae`):
- HTTP surface is **outbound-only**: `POST /v1/announce` (closed 3-event union, HMAC
  shared-secret over raw body + timestamp + replay cache, no user auth).
- Discord-side is already **richly inbound**: `/fro-bot` slash commands (`ping`,
  `add-project`, `clear-queue`, `force-release-lock`), `@fro-bot` mention-triggered runs,
  and OpenCode `permission.asked` → Discord **approval buttons** (fail-closed).
- No HTTP command/mission/state API; no web/user auth concept.

**IaC** (`marcusrbrown/infra`):
- Single-purpose-droplet fleet: Caddy + Docker Compose + Bun/TS deploy scripts + SSH,
  GitHub Environments for secrets, `*.fro.bot` DNS/TLS proven (cliproxy, umami, gateway).
- No Terraform/Pulumi/Ansible; no Prometheus/Grafana; Umami is the only analytics.
- A new authenticated web app fits the existing pattern (its own `apps/dashboard` droplet
  + Compose + Caddy + GitHub Environment secrets).

**Key reframe from grounding:** "command Fro Bot remotely and approve its actions"
**already exists — through Discord.** The slash-command, mention-run, and permission-button
paths are the live remote-control surface. What's missing is an **HTTP/web equivalent**
fronting the same gateway/agent.

Important boundary on this reframe: Discord de-risks the **interaction model** (command
semantics, fail-closed approval flow, the vocabulary of "launch work / approve / query
state"), not the **web implementation**. Browser authentication, session management,
CSRF/origin binding, and dashboard state synchronization are a distinct, genuinely-hard
trust boundary that Discord's shared-secret + button model does not prove out. The reframe
reduces *product* uncertainty about what the surface should do; it does not reduce the
*technical* risk of S1/S2. Treat web auth (S2) as a first-class hard problem, not a
low-risk appendage to Discord parity.

## Target capabilities

Grouped by tier. Each tagged with owning system(s), the dependency it needs, and a rough
effort/risk signal (L/M/H). Effort/risk are directional, for sequencing — not estimates.

### Tier 0 — The spine (unlocks the rest)

- **S1 — Web/HTTP control surface on the gateway.** The gateway accepts authenticated
  inbound commands (launch a unit of work, query state) and streams state back, mirroring
  what Discord slash/mention/approval already do. This is **net-new inbound plumbing** — the
  gateway today is outbound-only (`POST /v1/announce`); S1 adds authenticated inbound
  command endpoint(s), a state retrieval/stream path, and an internal command/work-unit
  model. _Owner: agent. Depends on: new gateway surface (not just the existing announce
  path) + the S2 auth model. Effort/risk: H._ Status: deployed (Gateway v0.136.4,
  contract 1.15.0); authenticated end-to-end acceptance open in #3512.
  _As of 2026-11-25:_ shipped and deployed; the Gateway is v0.146.0 on contract 1.15.0 (infra run
  45323526850, per the #3512 body). Acceptance is not done: #3512 is open, 119 gates ticked and 47
  open (tracker comment of 2026-11-24). The 2026-11-08 version figure is kept as history.
- **S2 — Operator identity & web auth.** A real user-auth model (vs the current
  shared-secret HMAC) so a human can authenticate to the control surface from a browser.
  _Owner: agent + infra. Depends on: S1. Effort/risk: M._ Status: live in production
  (OAuth/PKCE/session/CSRF/origin binding), logout bug fixed.
  _As of 2026-11-25:_ shipped; `fro-bot/dashboard#156` is still closed (2026-07-08). Not
  re-exercised in a browser by this pass; the CSRF and saved-cookie replay check and the session
  continuity check on the current pair are still open gates in #3512.

### Tier 1 — Operator reach (depends on the spine)

- **R1 — Authenticated dashboard PWA.** Manage installations, track issues across repos,
  launch "missions," see agent state — Hermes/OpenClaw-style. _Owner: dashboard (new) +
  infra (hosting). Depends on: S1, S2. Effort/risk: H._ Status: live; interactive approve,
  deny and question accepted on v0.136.4; remaining live gates in #3512.
  _As of 2026-11-25:_ shipped, dashboard 2026.11.29 deployed. The approve, deny and question
  acceptance is scoped to v0.136.4; for the current pair (Gateway v0.146.0, dashboard 2026.11.29)
  #3512 lists ready parity, SSE loss and reconnect, cold-start notification taps and the stronger
  cancel-quiescence gate as open. Ordinary cancel is accepted there.
- **R2 — Push notifications with action handling.** Surface critical events and let the
  operator respond/approve from the notification. _Owner: dashboard + agent. Depends on:
  S1, S2, R1. Effort/risk: M._ Status: push transport shipped; inline actions decided
  against (`fro-bot/agent#1917`, not planned). Notifications deep-link to the dashboard.
  _As of 2026-11-25:_ unchanged. `fro-bot/agent#1917` is still closed as not planned
  (2026-11-05). Dashboard 2026.11.29 added push-settings retry and aborted-subscription cleanup
  (dashboard#881, #884, per the #3512 comment of 2026-11-23): delivery, not push acceptance, and
  the real notification-tap gates are still open in #3512.
- **R3 — Web-viewable/editable wiki.** The Obsidian-based Karpathy wiki rendered on the
  web, with operator edits that flow back through the `data`-branch authority model.
  _Owner: control plane + dashboard. Depends on: R1 (for the editable path; read-only
  view is independent). Effort/risk: M._ Status: read-only view SHIPPED — live at
  `fro.bot/.github` (Quartz v5, pinned-SHA fetch-at-build, fail-closed plugin-lockfile
  gate, emergency unpublish). Editable path built (plan 2026-08-29-001 complete); production
  enablement unverified.
  _As of 2026-11-25:_ both halves shipped. Read-only: `fro.bot/.github` returns HTTP 200 and the
  latest Publish Wiki run on `main`,
  [45549235701](https://github.com/fro-bot/.github/actions/runs/45549235701), succeeded.
  Editable: a dashboard save wrote commit `5ba9bd0` on `data` on 2026-11-18, and dashboard#870
  (rejected saves now say why, closing dashboard#861) is merged. One save was observed; whether the
  Edit affordance is on for every page type was not checked.

### Tier 2 — Autonomy depth (mostly control-plane-native)

- **A1 — Skill saving / "grow and learn." SHIPPED + validated 2026-06-22.** Fro Bot
  retrieves prior learnings (`docs/solutions/`) into its run context and captures new ones
  from its own multi-round-review history as proposals a human authors. Delivered as three
  validated phases: retrieve-and-apply (injects relevant solution docs into agent prompts),
  propose-only capture (opens labeled learning-proposal issues from PRs that needed real
  review iteration, with an upstream fail-closed privacy gate), and review-prose enrichment
  (the agent distills from what the rounds actually said, not the PR title). All three were
  proven live; the first enriched batch yielded five authored learnings. _Owner: control
  plane. Most control-plane-native of all capabilities — shipped without the spine, as
  predicted._
  _As of 2026-11-25:_ still running, and retrieval has grown. Agents get a `knowledge` MCP server
  with `wiki_search` and `solutions_search` (plan 2026-11-06-001, complete), the daily passes get
  a wiki index and prompt duties for when to use the tools (#4232), and Remediate hands its
  learnings to Observe in a comment (#4214). Capture Learnings run 43791294020 (scheduled,
  2026-11-16) and Draft Solutions run 43889580298 (2026-11-16) succeeded. Open: whether agents use
  the tools outside pull request reviews; the 14-day count is due 2026-11-28.
- **A2 — Self-maintenance & good-GitHub-citizen depth.** Extend autoheal into broader
  self-improvement of repo + control-plane operation. **First two surfaces shipped
  2026-07-03:** status-truth maintenance loop and wiki authority repair. The bounded-PR
  correction machinery has graduated, with `plan-consistency` as the first active graduated
  claim kind. _Owner: control plane. Depends on: nothing new (autoheal is the seed).
  Effort/risk: M._
  _As of 2026-11-25:_ shipped; `GRADUATED_CLAIM_KINDS` in
  `packages/status-truth/src/status-truth-prs.ts` still holds only `plan-consistency`. The
  "good-GitHub-citizen" half has grown: promotion self-merge, the Renovate approval sweep and its
  yield rule, the actionable attention list and the repo lifecycle actions (table in the
  2026-11-25 reconciliation). The status-truth scan excludes `docs/brainstorms/`, so it does not
  cover this doc.
- **A3 — Cross-repo planning & agent dispatch. SHIPPED, proven in production.** Plan work
  spanning related repos and dispatch agents in those repos to coordinate — owner-aware
  two-App dispatch, prompt-only with correlation embedded in the prompt, hash-bound worker
  completion receipts, watchdog tracking. _Owner: control plane + Systematic + agent.
  Depends on: A1/A2 maturity; partial on S1 for cross-agent coordination. Effort/risk: H._
  _As of 2026-11-25:_ shipped. End-to-end proof: goal #3633 closed 2026-07-04 with `completed=2
  failed=0 blocked=0`. `cross-repo-dispatch.yaml` runs every six hours and its recent runs are
  green (latest 45529024636). Other goals were not counted. The cross-repo program tracker (plan
  `2026-11-08-002`, complete) builds on it; dashboard-started programs are not built.
- **C4 — Recurring-pattern synthesis. SHIPPED.** A control-plane loop that clusters
  repeated signals across proposal/solution history and opens `pattern-proposal` issues for
  human triage. Manual-dispatch, dry-run-default, report-only. _Owner: control plane._
  _As of 2026-11-25:_ unchanged and verified: `capture-patterns.yaml` has only a
  `workflow_dispatch` trigger; last run 41724214832 (2026-11-03, success).
- **O8 — Self-improvement metric loop. SHIPPED, proven live.** Measures whether the
  self-improvement loops actually reduce repeated work: pairs discovery (newly codified
  classes, keyed on immutable git add-date) with human-confirmed recidivism, plus a
  pending-confirmation backlog, rendered to one perpetual report issue. Manual-dispatch,
  dry-run-default, report-only. _Owner: control plane._
  _As of 2026-11-25:_ no longer manual-dispatch only. It runs weekly (`0 23 * * 0`, #3779, since
  2026-08-27); scheduled runs 43793481768 and 45107165592 succeeded and the perpetual report issue
  #3674 was updated 2026-11-23. Manual dispatches still default to dry run.

### Tier 3 — The frontier (needs Tiers 1+2)

- **F1 — Agent-to-agent & human work negotiation.** Offer and consume work from other
  agents or humans. _Owner: agent + control plane. Depends on: S1, A3. Effort/risk: H._
  _As of 2026-11-25:_ not started. No requirements doc or plan exists for it; the nearest
  artifact is the "Negotiable work objects" idea in `docs/ideation/2026-09-04-open-ideation.md`,
  status Unexplored. A work-offer brainstorm is the next step, on `packages/dispatch`'s hash-bound
  receipts (see Next step).
- **F2 — Personal-assistant expansion beyond software.** Fro Bot serves daily tasks
  outside software development. _Owner: all. Depends on: most of the above. Effort/risk: H._
  _As of 2026-11-25:_ not started. No requirements doc or plan exists; this map and
  `docs/ideation/2026-09-04-open-ideation.md` only name it.

## The dependency spine (text diagram)

```
                    ┌─────────────────────────────┐
                    │ S1 web/HTTP control surface  │  (keystone — agent)
                    │ S2 operator web auth         │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                         │
   ┌──────▼──────┐          ┌──────▼──────┐           ┌──────▼──────┐
   │ R1 dashboard │          │ R2 push +   │           │ R3 web wiki │
   │ PWA          │◄─────────│ action      │           │ (edit path) │
   └──────────────┘          └─────────────┘           └─────────────┘

   (Tier 2 runs largely in parallel, NOT gated on the spine:)
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │ A1 skill     │   │ A2 self-     │   │ A3 cross-repo│──needs S1 for
   │ learning     │   │ maintenance  │   │ planning     │  cross-agent
   └──────────────┘   └──────────────┘   └──────┬───────┘
                                                 │
                                          ┌──────▼───────┐
                                          │ F1 work      │  (frontier)
                                          │ negotiation  │
                                          └──────┬───────┘
                                                 │
                                          ┌──────▼───────┐
                                          │ F2 personal  │
                                          │ assistant    │
                                          └──────────────┘
```

Every "Depends on" edge here is a *design assertion*, not a constraint this repo enforces.
The map's authority ends at the boundary of each owning system; each per-capability
brainstorm must re-validate its dependency edges against the real interfaces. Treat this
diagram as a directional guide, not a contract.

The critical insight: **Tier 0 (the spine) gates the outward program — Tier 1, A3, and the
Tier 3 frontier — but NOT A1/A2.** Skill-learning and self-maintenance compound the agent's
value *today* in this repo, with one caveat surfaced in review: their *storage and learning*
mechanics need nothing new, but their *full operator value* (inspect, invoke, steer a saved
skill) eventually wants at least a minimal control surface. A1/A2 can start independently;
they reach their ceiling once some operator surface exists. Everything else — the dashboard,
push, cross-agent coordination, negotiation — truly requires the spine.

## Phased roadmap

> **Historical recommendation (2026-06-15).** This serial phasing was the original strategic
> recommendation. As of the 2026-06-21 rebaseline above, Phases 1 and 2 are being built
> concurrently and Phase 3 mock work has begun — read this section as the strategic intent,
> not the current schedule.

The phasing leads with the operator's stated pain — *visibility into work scattered across
repos* — rather than the agent's internal autonomy. Relief comes first; the heavier
foundation and the autonomy engine follow.

- **Phase 1 (now):** A **read-only visibility surface** — cross-repo issues, PR/CI status,
  and agent state aggregated into one place. This is the part of the dashboard that needs
  **no spine and no auth**: it only reads GitHub (and the control plane's own state) and
  can be a minimal web view or even a generated single-pane report. It directly answers
  "issues missed, spread across repos." In parallel, begin **designing** the S1/S2 spine
  (web control surface + operator auth) so Phase 2 build is unblocked.
- **Phase 2:** **Build** the Tier-0 spine (S1 inbound web control surface + S2 operator
  auth). S2 is the security keystone — a real browser-auth/session model replacing
  shared-secret HMAC — and is treated as a first-class hard problem, not Discord parity.
- **Phase 3:** Upgrade the Phase-1 visibility surface into the full interactive dashboard
  (launch missions, approve actions, push notifications, editable wiki) on top of the spine.
  **A1 skill-learning and A2 self-maintenance's first two surfaces have already shipped**
  ahead of Phase 3, as the dependency model predicted (control-plane-native, no spine
  needed); A2 bounded-PR graduation remains open.
  _Note (2026-11-25): the graduation closed in 2026-07; see the 2026-07-10 reconciliation. Phases
  1 to 3 are built and Phase 4's A3 shipped; only the live acceptance tail in #3512 and the Tier-3
  frontier remain._
- **Phase 4:** A3 cross-repo coordination + Tier-3 frontier (negotiation, then
  beyond-software).

The Phase-1 visibility slice and the Phase-1 spine *design* parallelize cleanly — one is
read-only control-plane/GitHub work, the other is agent/infra design. A1/A2 are
control-plane-native and can start whenever capacity allows; they're placed in Phase 3
because visibility and the spine are the higher-priority near-term moves, not because A1/A2
depend on them.

## Candidate first workstreams

| Candidate | Unlocks | Effort/risk | Why now / why not |
|---|---|---|---|
| **Read-only visibility slice** | Immediate relief of the stated pain | L–M | Reads GitHub + control-plane state only; needs no spine, no auth. Directly answers "issues missed, spread across repos." Doesn't yet let you *command* Fro Bot from the web — that's Phase 2/3. |
| **S1+S2 spine (design now, build Phase 2)** | All of Tier 1/3 outward | H | The foundation for everything interactive. Begin *design* in parallel with the visibility slice; build in Phase 2. S2 web auth is a first-class, security-critical hard problem, not a Discord-parity appendage. |
| **R1 full dashboard** | Operator command + approve | H | The complete answer to the stated pain, but its interactive half can't start before the spine. Its read-only half *is* the visibility slice above. |
| **A1 skill-learning** | Tier 2 autonomy; compounds later phases | M | Control-plane-native, no new infra, builds on existing wiki + compound docs. Strong compounding value — but it sharpens the agent's internals while leaving the operator's *visibility* pain unaddressed, so it follows visibility rather than leading. |

## Recommendation

**Start with the read-only visibility slice as Phase 1, begin designing the S1/S2 spine in
parallel, and follow with A1 skill-learning in Phase 3.**

Rationale:

1. **Lead with the stated pain.** The motivating problem is *visibility* — "manual tweaking
   is cumbersome and issues can be missed, spread across so many repos." The shortest path
   to relief is aggregating cross-repo issues, PR/CI status, and agent state into one place.
   This needs no spine and no auth (it only reads GitHub + control-plane state), so it ships
   fast and answers the actual job-to-be-done first. Optimizing the agent's internals (A1)
   before the operator can *see* the system would make Fro Bot smarter while leaving the
   stated pain intact.
2. **Design the spine now, build it in Phase 2.** S1 (inbound web control surface) + S2
   (operator web auth) is the foundation for everything interactive — launching missions,
   approving actions, push notifications. Design begins in parallel with the visibility
   slice; build follows. **S2 is the security keystone**: a real browser-auth/session model
   replacing shared-secret HMAC, treated as a first-class hard problem. The Discord reframe
   de-risks the *interaction model* (what commands mean, the fail-closed approval flow), not
   the *web-auth implementation* — that remains genuinely hard.
3. **A1/A2 autonomy was slated for Phase 3, but shipped ahead of it.** Skill-learning and
   self-maintenance are control-plane-native and needed nothing new, so both started early;
   A1 shipped 2026-06-22 and A2's first two surfaces (status-truth loop, wiki authority
   repair) shipped 2026-07-03, all independent of the spine. A2's bounded-PR graduation is
   still open, pending accepted-outcome signal.
   _(Superseded 2026-11-25: the bounded-PR graduation is done. `plan-consistency` is graduated in
   `packages/status-truth/src/status-truth-prs.ts`; see the 2026-07-10 reconciliation.)_
4. **The surfaces share one ownership model.** The gateway is the authority; Discord and the
   web operator API are peer write transports over shared primitives, not separate control
   planes (see D2).

Override signal: if reducing manual operator toil through agent autonomy is more urgent than
seeing the system, pull A1 forward to overlap Phase 1 (it's control-plane-native and
parallelizes with the visibility slice). The recommendation assumes visibility is the more
acute near-term pain, per the stated motivation.

## Scope boundaries (non-goals for this doc)

- No schemas, endpoints, tech-stack choices, or file layouts — those are per-workstream
  planning.
- No commitment to a build order beyond the dependency-implied phasing and the recommended
  first move.
- No modification to any of the five systems — this is pure architecture mapping.

## Open decisions (resolve at the relevant phase kickoff)

- **D1 — Visibility-slice scope (Phase 1): RESOLVED BY EVENTS (2026-08-29):** The visibility
  slice shipped as the read-only dashboard PWA, live at dashboard.fro.bot, per the 2026-07-10
  reconciliation. The scope question is closed.
- **D2 — Surface ownership model: RESOLVED (2026-10-22):** The gateway is the authority.
  Discord and the web operator API are peer write transports over shared primitives: the
  `launchWork`/`runMention` run engine, `registry.handleDecision` (the sole approval gate),
  and `QuestionRegistry`. Neither surface adds its own policy. Binding and repo housekeeping
  (add-project, clear-queue, locks, checkout recovery) are Discord-only by design. Open
  parity gaps: cancel is web-only, so `/fro-bot cancel` is a follow-up. Push notifications
  carry no actions by decision (R2). (Raised by design review.)
  _Update 2026-11-25:_ the cancel gap is closed. `/fro-bot cancel` merged in
  [fro-bot/agent#2066](https://github.com/fro-bot/agent/pull/2066) on 2026-11-04 and reuses the
  cancellation engine the web route uses. The rest of the decision stands; no live Discord run of
  the command was checked.
- **D3 — Spine trust boundary (Phase 2):** S1's inbound control surface widens the trust
  boundary the current outbound-only announce model avoids. Web-launched missions MUST route
  through the same fail-closed approval gate as Discord-triggered work, and operator wiki
  edits (R3) MUST preserve the `data`-branch sole-writer + privacy-gate invariants. S2 web
  auth is the security keystone — strong operator identity, sessions, revocation,
  origin-bound auth. (Raised by security review.)
- **D4 — A1 skill definition (Phase 3):** Does "skill" mean reusable agent procedures
  (Hermes-style) captured into the wiki, control-plane workflow refinements, or both?
  (Shapes the A1 brainstorm.)
  _Update 2026-11-25: resolved by the A1 requirements, `docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md`
  (Non-goals): a skill is durable knowledge, a compound doc or wiki page that Fro Bot reads and
  applies, not a generated runnable tool._
- **D5 — Cross-repo tracking:** Capabilities owned by `fro-bot/agent` and
  `marcusrbrown/infra` will need their own tracking issues there once their phase starts
  (notably the S1/S2 spine, which lives in `fro-bot/agent`).
  _Update 2026-11-25: resolved for the spine. It was tracked in `fro-bot/agent#907` (closed
  2026-06-26), and the cross-repo rollout is tracked in `fro-bot/.github#3512` (open; 148
  Project-derived dependencies, 147 Done per its body of 2026-11-24). Tracking for the items the
  other repositories own beyond those was not checked._

## Next step

As of 2026-11-08, the open north-star threads are the #3512 live acceptance tail (S1/S2/R1),
R3 editable-path enablement, and the Tier-3 frontier. The next control-plane moves are
status-truth reconciliation of this doc and an F1 work-offer brainstorm.

As of 2026-11-25, the reconciliation is done (the 2026-11-25 section above). R3's editable path
is no longer an open thread. The open north-star threads are the #3512 live acceptance tail
(S1/S2/R1; 47 gates open on 2026-11-24) and the Tier-3 frontier, where F1 and F2 have not
started. The next control-plane move is the F1 work-offer brainstorm. It has no document yet and
starts from `packages/dispatch`'s hash-bound receipts.

Dated checks that are still owed elsewhere: the 14-day knowledge-tool count, due 2026-11-28
(`docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md`, Unit 5), and the 30-day
repeat-survey measure (`docs/plans/2026-11-15-002-feat-repeat-surveys-update-in-place-plan.md`,
Unit 5). Both plans are still `active`. This doc is outside the status-truth scan, so the next
reconciliation is a hand pass again.
