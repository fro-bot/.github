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
  path) + the S2 auth model. Effort/risk: H._
- **S2 — Operator identity & web auth.** A real user-auth model (vs the current
  shared-secret HMAC) so a human can authenticate to the control surface from a browser.
  _Owner: agent + infra. Depends on: S1. Effort/risk: M._

### Tier 1 — Operator reach (depends on the spine)

- **R1 — Authenticated dashboard PWA.** Manage installations, track issues across repos,
  launch "missions," see agent state — Hermes/OpenClaw-style. _Owner: dashboard (new) +
  infra (hosting). Depends on: S1, S2. Effort/risk: H._
- **R2 — Push notifications with action handling.** Surface critical events and let the
  operator respond/approve from the notification. _Owner: dashboard + agent. Depends on:
  S1, S2, R1. Effort/risk: M._
- **R3 — Web-viewable/editable wiki.** The Obsidian-based Karpathy wiki rendered on the
  web, with operator edits that flow back through the `data`-branch authority model.
  _Owner: control plane + dashboard. Depends on: R1 (for the editable path; read-only
  view is independent). Effort/risk: M._

### Tier 2 — Autonomy depth (mostly control-plane-native)

- **A1 — Skill saving / "grow and learn."** Fro Bot captures reusable skills (Hermes-style)
  into the built-in wiki and applies them in later runs. **Most control-plane-native of all
  capabilities — can start without the spine.** _Owner: control plane. Depends on: nothing
  new (builds on wiki + compound docs). Effort/risk: M._
- **A2 — Self-maintenance & good-GitHub-citizen depth.** Extend autoheal into broader
  self-improvement of repo + control-plane operation. _Owner: control plane. Depends on:
  nothing new (autoheal is the seed). Effort/risk: M._
- **A3 — Cross-repo planning & agent dispatch.** Plan work spanning related repos and
  dispatch agents in those repos to coordinate. _Owner: control plane + Systematic +
  agent. Depends on: A1/A2 maturity; partial on S1 for cross-agent coordination.
  Effort/risk: H._

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

The critical insight: **Tier 0 (the spine) gates the outward program — Tier 1, A3, and the
Tier 3 frontier — but NOT A1/A2.** Skill-learning and self-maintenance compound the agent's
value *today* in this repo, with one caveat surfaced in review: their *storage and learning*
mechanics need nothing new, but their *full operator value* (inspect, invoke, steer a saved
skill) eventually wants at least a minimal control surface. A1/A2 can start independently;
they reach their ceiling once some operator surface exists. Everything else — the dashboard,
push, cross-agent coordination, negotiation — truly requires the spine.

## Phased roadmap

- **Phase 1 (now):** One Tier-2 autonomy capability that compounds immediately and needs
  no new infrastructure — start the inward engine while the outward foundation is designed.
- **Phase 2:** The Tier-0 spine (S1 web control surface + S2 auth) — the foundation every
  outward capability needs. Design-heavy; the highest-leverage infrastructure investment.
- **Phase 3:** Tier-1 operator reach (dashboard, push, web wiki) on top of the spine.
- **Phase 4:** Tier-2 A3 cross-repo coordination + Tier-3 frontier (negotiation, then
  beyond-software).

Phases 1 and 2 can overlap: Phase 1 is control-plane-native work, Phase 2 is agent/infra
foundation work — different systems, runnable in parallel.

## Candidate first workstreams

| Candidate | Unlocks | Effort/risk | Why now / why not |
|---|---|---|---|
| **A1 skill-learning** | Tier 2 autonomy; compounds every later phase | M | Control-plane-native, no new infra, builds on existing wiki + compound docs. Directly reduces "manual tweaking." Lower visibility to operator. |
| **A2 self-maintenance** | Tier 2; reduces operator load | M | Extends the autoheal you already shipped. Incremental, low risk. Narrower upside than A1. |
| **S1+S2 spine (design now, build Phase 2)** | All of Tier 1/3 outward | H | The foundation, but heaviest lift and lives in agent/infra, not here. Begin *design* in parallel with Phase 1; defer *build* until A1 has surfaced the work-unit vocabulary it needs. S2 web auth is a first-class hard problem, not a Discord-parity appendage. |
| **R1 dashboard** | Operator reach | H | Most directly solves "cumbersome, issues missed," but cannot start before the spine (S1/S2). |

## Recommendation

**Start with A1 (skill-learning / "grow and learn") as Phase 1, and begin designing the
S1/S2 spine in parallel as Phase 2.**

Rationale:

1. **A1 is the highest-leverage move that needs nothing new.** It lives entirely in this
   repo, builds on the wiki + compound-docs machinery already in place, and compounds the
   value of *every* later phase — a smarter agent makes the dashboard, cross-repo planning,
   and negotiation all more useful. It directly attacks the "manual tweaking is cumbersome"
   pain by making Fro Bot capture and reuse what it learns instead of relearning each run.
2. **The spine is the right Phase 2, but not the right Phase 1.** S1/S2 is the foundation
   for everything outward, but it's the heaviest lift, lives in agent/infra, and is better
   designed once A1 has clarified what "a unit of agent work" (a mission) actually is —
   skill-learning naturally surfaces the vocabulary the control surface will need.
3. **They parallelize cleanly.** A1 is control-plane work in this repo; S1/S2 design is
   agent/infra work. Different systems, no file contention, runnable at once — so we don't
   trade the foundation for the quick win; we start both.
4. **The Discord reframe de-risks the spine.** Because remote command + approval already
   work through Discord, the Phase 2 spine is "add a web surface to a proven model," not
   "invent bidirectional control." That lowers S1's real risk below its H tag and makes
   parallel Phase-1/Phase-2 realistic.

Override signal: if the operator-visibility pain ("issues missed, spread across repos") is
more acute than the autonomy gap right now, flip the order — design the spine first and
treat A1 as Phase 2. The recommendation assumes the autonomy compounding is the bigger
near-term win.

## Scope boundaries (non-goals for this doc)

- No schemas, endpoints, tech-stack choices, or file layouts — those are per-workstream
  planning.
- No commitment to a build order beyond the dependency-implied phasing and the recommended
  first move.
- No modification to any of the five systems — this is pure architecture mapping.

## Open decisions (resolve before Phase 1 kickoff)

- **D1:** Confirm the first workstream (recommended: A1 skill-learning) and whether to
  start S1/S2 spine design in parallel now.
- **D2:** For A1 — does "skill" mean reusable agent procedures (Hermes-style) captured into
  the wiki, control-plane workflow refinements, or both? (Shapes the A1 brainstorm.)
- **D3:** Cross-repo issue strategy — capabilities owned by `fro-bot/agent` and
  `marcusrbrown/infra` will need their own tracking issues there once their phase starts.

## Next step

Resolve D1 in a follow-up, then run a focused `ce:brainstorm` on the chosen first
workstream (the recommended path: an A1 skill-learning brainstorm), which this north-star
doc feeds directly.
