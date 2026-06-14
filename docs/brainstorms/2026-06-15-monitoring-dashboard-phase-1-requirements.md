---
title: Fro Bot Monitoring Dashboard — Phase 1
date: 2026-06-15
status: ready
scope: deep
parent: docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md
---

# Fro Bot Monitoring Dashboard — Phase 1

## Context

This is the first buildable workstream from the north-star architecture
(`docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`).
It addresses the motivating pain directly: Fro Bot's footprint is spread across many
repos and installations, and issues get missed because there is no single, live,
glanceable view of where Fro Bot operates and what needs attention.

The north-star doc initially framed Phase 1 as a thin "read-only visibility slice" over the
existing daily oversight report. That framing was too small: the daily report aggregates
cross-repo intelligence but is a once-daily text snapshot buried in a GitHub issue, and it
does not cover the populations that matter most — **where the Fro Bot Agent App is installed**
and **where the `@fro-bot` user collaborates**. This Phase 1 is a real backend dashboard app
that actively monitors those populations, not a report.

## Problem

There is no operator surface that answers, on demand and at a glance: *where does Fro Bot
operate, and what across that footprint needs my attention right now?* The information is
scattered — collaborator metadata on the `data` branch, Agent App installations only
queryable per-repo by the gateway, live PR/CI/issue/alert status only via per-repo GitHub
browsing, and the daily report a stale text snapshot.

## Monitoring populations (Phase 1 scope)

Grounded against live source (2026-06-15):

| Population | Source | Readable today? | Phase 1? |
|---|---|---|---|
| **Collaborator repos** — where `@fro-bot` is a collaborator | `metadata/repos.yaml` (`data` branch), ~27 entries | ✅ Yes, directly | **In** |
| **Agent App installations** — repos/orgs where the Fro Bot Agent App is installed | GitHub App API (`apps.listInstallations`, `listReposAccessibleToInstallation`) | ⚠️ Needs an App credential to enumerate — the gateway only does per-repo discovery, no global inventory | **In** |
| **Gateway bindings** — repos bound to Discord channels | gateway S3/R2 object store (`listBindings()`), no read endpoint today | ⚠️ Internally queryable, not exposed | **Fast-follow** (needs gateway read endpoint or object-store access; coordinate with `fro-bot/agent#907`) |

## Goal

Ship a real, authenticated, read-only dashboard that actively monitors collaborator repos and
Agent App installations and surfaces live cross-repo status in one glanceable place. These two
populations are **data-unblocked** — readable without any change to the agent-side
control-surface spine (`fro-bot/agent#907`). "Unblocked" means the *data sources* are reachable
today; Phase 1 still requires standing up hosting, operator auth, and credential provisioning
as its own delivery work. Gateway bindings (the third population) remain deferred to the
fast-follow.

## Requirements

- **R1 — Two-population monitoring.** Aggregate and display Fro Bot's footprint across
  collaborator repos (from `metadata/repos.yaml`) and Agent App installations (from the
  GitHub App API). Show the union with each repo's source channel(s) labeled.
- **R2 — Live cross-repo status (fixed Phase-1 status set).** For every monitored repo,
  surface a **bounded** set of actionable signals: open PRs with CI state, failing
  default-branch checks, open issues needing attention, and security alerts. Sort by
  severity; cap each repo's summary to a small N with a link to drill into GitHub for detail.
  "Active monitoring" means refreshed live status (polled), not a daily snapshot. Phase 1
  does not add signals beyond this fixed set (prevents scope balloon into a monitoring
  platform).
- **R3 — Glanceable + on-demand.** A single view that summarizes health at a glance
  (what needs attention surfaces first) and can be refreshed on demand, not only on a cron.
- **R4 — Authenticated, operator-only.** The app holds GitHub App credentials and must not
  be open. Only the operator can access it. (Auth mechanism is a planning decision; that it
  is authenticated is a hard requirement.)
- **R5 — Isolated, least-privilege read credential, with fallback.** Preferred: the dashboard
  uses its **own** read-scoped GitHub App (or a read-only installation) with minimal
  permissions (installation list + metadata/contents read), distinct from the gateway's Agent
  App key — minimizing blast radius. **Caveat (explicit constraint):** a separate GitHub App
  can enumerate only *its own* installations, so the dedicated-App option requires installing
  that App everywhere the dashboard needs visibility, or coverage is incomplete; this must be
  validated before committing to it (D4). **Fallback:** GitHub Apps support up to 25 private
  keys, so a **second, independent private key for the existing Agent App** is a real
  mechanism — same App (sees the same installations natively), distinct key that rotates/
  revokes independently of the gateway's key.

  **Critical distinction (raised in review):** a second key provides *rotation* isolation, NOT
  *permission* isolation — it inherits the Agent App's full permission set. So "read-scoped"
  is only true at the credential layer if the underlying App is itself least-privilege. If the
  fallback path is taken and the Agent App has any write permissions, R7's read-only guarantee
  does **not** hold at the credential layer. **Requirement:** whichever path is chosen, the
  dashboard's credential MUST be verified read-only at the GitHub *permission* level (not just
  by app convention) — if the only available credential carries write permissions, that is a
  blocker to resolve in planning, not an acceptable Phase-1 state.
- **R6 — Infra-hosted via existing patterns.** Deploy on `marcusrbrown/infra` following the
  proven single-purpose-droplet pattern (its own `apps/<name>`, Caddy + Compose, `*.fro.bot`
  DNS/TLS, GitHub-Environment secrets).
- **R7 — Read-only by construction.** Phase 1 monitors and surfaces; it performs no write
  actions to repos, metadata, the gateway, or the wiki. This must hold *by construction*, not
  by convention: the dashboard's GitHub credential must be read-only at the permission level
  (see R5), and the service must contain no code paths, scheduled jobs, or credentials capable
  of mutating repos, metadata, wiki, gateway state, or approvals. No mission launch, no
  approvals, no edits.

- **R8 — Security properties (mechanisms deferred to planning, properties required now).**
  Because the app is web-facing and holds a GitHub App key, the following are hard
  requirements regardless of mechanism:
  - **Deny-by-default authz** on every route — no anonymous fallback path; a single auth gate
    protects all non-public routes.
  - **Credential at rest** — the private key is stored encrypted, injected at runtime via the
    infra GitHub-Environment-secret pattern, never logged, and never emitted in any response.
  - **Redaction preservation** — `metadata/repos.yaml` carries intentionally-redacted
    private-repo entries (`owner: [REDACTED]`, node-id names); the dashboard MUST preserve
    those redactions and never resolve, render, cache, or export the underlying private names.
  - **Abuse controls** — per-operator refresh/rate caps and audit logging of auth events and
    data access, so the App key cannot be turned into a GitHub-quota-exhaustion or
    installation-data-exfiltration surface.

## Non-goals

- **No command/mission/approval actions** — those need the `fro-bot/agent#907` spine
  (S1 inbound control surface + S2 operator auth) and are Phase 2/3 in the north-star.
- **No gateway bindings in Phase 1** — deferred to a fast-follow that coordinates a gateway
  read surface or object-store access.
- **No real-time push notifications** — that is north-star R2, spine-dependent.
- **No editing** of repos, metadata, or wiki from the dashboard.
- **No reuse of the gateway's *exact* Agent App key** — Phase 1 uses an isolated credential
  (a dedicated read-scoped App, or failing that a second independent key for the Agent App)
  so the dashboard's credential can be rotated/revoked without touching the gateway (R5).
- **No schemas, endpoints, framework choices, or deployment topology** — those are planning.

## Success criteria

- **SC1:** The operator opens one authenticated view and sees Fro Bot's full monitored
  footprint (collaborator repos ∪ Agent App installations) with each repo's status.
- **SC2:** Repos needing attention (failing checks, stale PRs, open alerts) surface first /
  are visually distinct from healthy ones.
- **SC3:** The view can be refreshed on demand and reflects current GitHub state, not a
  daily snapshot.
- **SC4:** The dashboard is reachable only by the authenticated operator; an unauthenticated
  request is rejected.
- **SC5:** The dashboard's GitHub App credential is (a) read-only at the GitHub permission
  level — verified, not assumed — and (b) independently rotatable/revocable without touching
  the gateway's key. A second key for the Agent App satisfies (b) but only satisfies (a) if
  the Agent App is itself least-privilege; otherwise the dedicated-App path is required.

## Open decisions (resolve in planning)

- **D1 — Auth mechanism:** GitHub OAuth (operator logs in with GitHub), passkey/session, or
  another model. Must satisfy R4 + SC4.
- **D2 — Live vs polled freshness:** polling interval and caching strategy for "active
  monitoring" — balance GitHub API rate limits against freshness.
- **D3 — Hosting shape + metadata read path:** static frontend + small backend API in one
  Compose stack on a new `infra` droplet vs an existing host. Pick a concrete
  `metadata/repos.yaml` read strategy — direct read from the `data` branch via the GitHub
  API/git ref (preferred, no sync to drift) vs a synced copy — and define failure behavior
  when `data` is missing or behind. The chosen path must preserve the file's redactions (R8).
- **D4 — Credential provisioning:** first validate whether a dedicated read-scoped App can
  actually enumerate the needed installations (it can only see its own — confirm it can be
  installed everywhere the Agent App is, or this path fails). If viable, create it with
  minimal permissions. If not, fall back to a second independent private key for the existing
  Agent App. Decide which permissions/events either path needs.
- **D5 — Bindings fast-follow interface:** whether Pop 3 arrives via a new gateway read
  endpoint (`fro-bot/agent#907`-adjacent) or direct object-store read — decide when the
  fast-follow starts, not now.

## Next step

Run `ce:plan` on this document. Coordinate the bindings fast-follow and any gateway read
surface with `fro-bot/agent#907`. The dedicated read-scoped App (R5/D4) and infra hosting
(R6/D3) will need their own setup steps in `marcusrbrown/infra`.
