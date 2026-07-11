---
title: Fro Bot as Personal Agent — North-Star Architecture
date: 2026-06-15
status: ready
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

## Current state (verified 2026-06-15)

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
  path) + the S2 auth model. Effort/risk: H._ Status: shipped in source, `fro-bot/agent#907`
  closed, contract v1.6.0, deploy-verification open.
- **S2 — Operator identity & web auth.** A real user-auth model (vs the current
  shared-secret HMAC) so a human can authenticate to the control surface from a browser.
  _Owner: agent + infra. Depends on: S1. Effort/risk: M._ Status: live in production
  (OAuth/PKCE/session/CSRF/origin binding), logout bug fixed.

### Tier 1 — Operator reach (depends on the spine)

- **R1 — Authenticated dashboard PWA.** Manage installations, track issues across repos,
  launch "missions," see agent state — Hermes/OpenClaw-style. _Owner: dashboard (new) +
  infra (hosting). Depends on: S1, S2. Effort/risk: H._ Status: Phase 1 deployed live;
  interactive surface substantially built, flag-gated.
- **R2 — Push notifications with action handling.** Surface critical events and let the
  operator respond/approve from the notification. _Owner: dashboard + agent. Depends on:
  S1, S2, R1. Effort/risk: M._ Status: in-progress — transport shipped, inline actions
  remain.
- **R3 — Web-viewable/editable wiki.** The Obsidian-based Karpathy wiki rendered on the
  web, with operator edits that flow back through the `data`-branch authority model.
  _Owner: control plane + dashboard. Depends on: R1 (for the editable path; read-only
  view is independent). Effort/risk: M._ Status: read-only view SHIPPED — live at
  `fro.bot/.github` (Quartz v5, pinned-SHA fetch-at-build, fail-closed plugin-lockfile
  gate, emergency unpublish). Editable path not started.

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
- **A2 — Self-maintenance & good-GitHub-citizen depth.** Extend autoheal into broader
  self-improvement of repo + control-plane operation. **First two surfaces shipped
  2026-07-03:** status-truth maintenance loop and wiki authority repair. The bounded-PR
  correction machinery has graduated, with `plan-consistency` as the first active graduated
  claim kind. _Owner: control plane. Depends on: nothing new (autoheal is the seed).
  Effort/risk: M._
- **A3 — Cross-repo planning & agent dispatch. SHIPPED, proven in production.** Plan work
  spanning related repos and dispatch agents in those repos to coordinate — owner-aware
  two-App dispatch, prompt-only with correlation embedded in the prompt, hash-bound worker
  completion receipts, watchdog tracking. _Owner: control plane + Systematic + agent.
  Depends on: A1/A2 maturity; partial on S1 for cross-agent coordination. Effort/risk: H._
- **C4 — Recurring-pattern synthesis. SHIPPED.** A control-plane loop that clusters
  repeated signals across proposal/solution history and opens `pattern-proposal` issues for
  human triage. Manual-dispatch, dry-run-default, report-only. _Owner: control plane._
- **O8 — Self-improvement metric loop. SHIPPED, proven live.** Measures whether the
  self-improvement loops actually reduce repeated work: pairs discovery (newly codified
  classes, keyed on immutable git add-date) with human-confirmed recidivism, plus a
  pending-confirmation backlog, rendered to one perpetual report issue. Manual-dispatch,
  dry-run-default, report-only. _Owner: control plane._

### Tier 3 — The frontier (needs Tiers 1+2)

- **F1 — Agent-to-agent & human work negotiation.** Offer and consume work from other
  agents or humans. _Owner: agent + control plane. Depends on: S1, A3. Effort/risk: H._
- **F2 — Personal-assistant expansion beyond software.** Fro Bot serves daily tasks
  outside software development. _Owner: all. Depends on: most of the above. Effort/risk: H._

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
4. **The surfaces need one ownership model.** Discord is the proven command surface today.
   The web dashboard must be defined as either canonical or an augment to Discord — not a
   second, divergent control plane. Resolve this before Phase 3 (see Open decisions).

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

- **D1 — Visibility-slice scope (Phase 1):** What's the minimum viable view? Candidates:
  a generated single-pane report issue (zero new infra), a static read-only web page on an
  `infra` droplet, or a thin always-on dashboard. Shapes the Phase-1 brainstorm.
- **D2 — Surface ownership model (before Phase 3):** Is Discord the canonical command
  surface with the dashboard as an augment/read layer, or are both first-class command
  surfaces? Undefined risks a second control plane diverging from Discord's proven model.
  (Raised by design review.)
- **D3 — Spine trust boundary (Phase 2):** S1's inbound control surface widens the trust
  boundary the current outbound-only announce model avoids. Web-launched missions MUST route
  through the same fail-closed approval gate as Discord-triggered work, and operator wiki
  edits (R3) MUST preserve the `data`-branch sole-writer + privacy-gate invariants. S2 web
  auth is the security keystone — strong operator identity, sessions, revocation,
  origin-bound auth. (Raised by security review.)
- **D4 — A1 skill definition (Phase 3):** Does "skill" mean reusable agent procedures
  (Hermes-style) captured into the wiki, control-plane workflow refinements, or both?
  (Shapes the A1 brainstorm.)
- **D5 — Cross-repo tracking:** Capabilities owned by `fro-bot/agent` and
  `marcusrbrown/infra` will need their own tracking issues there once their phase starts
  (notably the S1/S2 spine, which lives in `fro-bot/agent`).

## Next step

Run a focused `ce:brainstorm` on the **Phase-1 visibility slice** (resolving D1), which this
north-star doc feeds directly. Begin S1/S2 spine *design* in parallel as a `fro-bot/agent`
workstream (D3/D5).
