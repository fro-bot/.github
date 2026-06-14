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
  (launch missions, approve actions, push notifications, editable wiki) on top of the spine,
  and land **A1 skill-learning / A2 self-maintenance** (control-plane-native, can begin
  earlier if capacity allows since they don't need the spine).
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
3. **A1/A2 autonomy is Phase 3, but unblocked.** Skill-learning and self-maintenance are
   control-plane-native and need nothing new, so they can start whenever capacity allows.
   They follow visibility + spine because those address the acute near-term pain and unlock
   the whole outward program; A1/A2 compound value but don't relieve the stated problem.
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
