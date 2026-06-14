---
title: 'feat: Fro Bot monitoring dashboard — Phase 1'
type: feat
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-monitoring-dashboard-phase-1-requirements.md
---

# feat: Fro Bot monitoring dashboard — Phase 1

**Target repos:** `fro-bot/dashboard` (net-new, the app) and `marcusrbrown/infra`
(deploy wiring as `apps/dashboard`). Both need creating. This plan doc lives in
`fro-bot/.github`; all code paths below are repo-relative to their target repo, noted per
unit.

## Overview

Build a read-only, single-operator web dashboard that actively monitors Fro Bot's footprint
across **collaborator repos** (from `metadata/repos.yaml` on the control plane's `data`
branch) and **Fro Bot Agent App installations** (the existing Agent App, installed on
`marcusrbrown` + `fro-bot`), surfacing live cross-repo status (open PRs + CI state, failing
default-branch checks, open issues, security alerts) in one glanceable view. Gateway bindings
are a deferred fast-follow.

The app is a single Hono + JSX SSR Node process, authenticated via a dedicated GitHub OAuth
App (single-operator allowlist + signed cookie), holding a second private key for the existing
Agent App to read data. It deploys via `marcusrbrown/infra`'s proven `apps/<name>` pattern
(Docker Compose + Caddy + SSH-materialized secrets) at `dashboard.fro.bot`.

## Problem Frame

Fro Bot's footprint is spread across many repos and installations; issues get missed because
there is no single, live, glanceable view (see origin). The daily oversight report is a
once-daily text snapshot that does not enumerate Agent App installations. This dashboard makes
the footprint live, on-demand, and scannable. (See origin for the full "why two populations
move the needle" rationale.)

## Requirements Trace

- R1. Two-population monitoring: collaborator repos ∪ Agent App installations, each repo's
  source channel labeled. (origin R1)
- R2. Live cross-repo status, bounded signal set (PRs+CI, failing checks, issues, alerts),
  refreshed not daily-snapshot. (origin R2)
- R3. Glanceable + on-demand: attention-needing repos surface first; manual refresh. (origin R3)
- R4. Authenticated, operator-only; deny-by-default. (origin R4, R8)
- R5. Isolated read credential: a second private key for the existing Agent App, verified
  read-only at the permission level. (origin R5, SC5)
- R6. Infra-hosted via the `apps/<name>` pattern. (origin R6)
- R7. Read-only by construction: no write code paths, no write-capable use of the credential.
  (origin R7)
- R8. Security properties: deny-by-default authz, encrypted key at rest, redaction
  preservation, abuse controls. (origin R8)

## Scope Boundaries

- No command/mission/approval actions (needs `fro-bot/agent#907` spine).
- No real-time push (north-star R2).
- No editing of repos, metadata, wiki.
- No multi-tenancy, RBAC, user table, database, Redis, queue, SSE/websocket, metrics stack
  (single-operator YAGNI — see origin + research).

### Deferred to Separate Tasks

- **Gateway bindings (3rd population):** separate fast-follow; needs a gateway read endpoint
  or object-store access — coordinate with `fro-bot/agent#907`.
- **Interactive actions (launch/approve):** north-star Phase 2/3, spine-dependent.
- **Consume / extract `@fro.bot/runtime` (future, NOT Phase-1):** `fro-bot/agent` already has
  a `packages/runtime/` workspace package (`@fro-bot/runtime`, currently `private:true`, with
  `exports`/`build`/`tsdown` set up) exporting reusable non-HTTP primitives: `shared` (a logger
  with `redactSensitiveFields`, env helpers, error formats), `session`, `coordination`,
  `object-store`. Several Phase-1 units deliberately build standalone primitives that **mirror
  things that already exist in `fro-bot/agent`** — the gateway's `createAppClient`
  (`packages/gateway/src/github/app-client.ts`: App auth + installation-token minting + PEM
  redaction) maps to Unit 2; the gateway's `config.ts` secret-file loader (`readSecret`/
  `readMultilineSecret` with `O_NOFOLLOW`/size limits) maps to `secrets.ts`; the Hono server
  bootstrap (`buildAnnounceApp`/`createAnnounceServer`) maps to Unit 1; the runtime logger maps
  to dashboard logging. **For Phase-1, build these standalone** (extraction now would couple a
  brand-new app to an unpublished cross-repo package and front-load packaging work). But this is
  the architectural signal that a shippable `@fro.bot/runtime` is worth doing as future work:
  the HTTP/Hono primitives + the GitHub App client are currently **gateway-local** and would
  need extracting into `packages/runtime/` (plus a publish posture: drop `private`, add a
  release pipeline) before the dashboard — or any sibling app — could consume them. Treat the
  dashboard's standalone primitives as deliberate near-term duplication that a later extraction
  pass can collapse, not as a missed reuse.

## Context & Research

### Relevant Code and Patterns

- **Infra deploy contract** (`marcusrbrown/infra`): closest analog is `apps/umami/`
  (web app + Caddy). Minimal new-app file set: `apps/dashboard/{README.md, AGENTS.md,
  package.json, docker-compose.yaml, config/Caddyfile, src/deploy.ts, src/host.ts,
  server/provision-droplet.ts}`. Deploy via `.github/workflows/deploy-dashboard.yaml` wired
  into the umbrella `.github/workflows/deploy.yaml` (dorny/paths-filter on `apps/dashboard/**`).
  Secrets via GitHub Environment `dashboard`, materialized over SSH stdin to
  `/opt/dashboard/.env`. CLI group under `packages/cli/src/commands/dashboard/`, registered in
  `packages/cli/src/cli.ts`. Droplet via `server/provision-droplet.ts` (DO droplet + host-key
  pinning in `.github/known_hosts`). DNS A record `dashboard.fro.bot` → droplet; Caddy ACME TLS.
- **Control-plane metadata** (`fro-bot/.github`): `metadata/repos.yaml` on the `data` branch
  carries collaborator repos with intentionally-redacted private entries (`owner: [REDACTED]`,
  node-id names) — must be preserved (R8).

### External References

- GitHub App auth flow: App JWT (signed with private key) → `GET /app/installations`
  (`apps.listInstallations`) → `POST /app/installations/{id}/access_tokens` → installation
  token → `GET /installation/repositories`. Docs: docs.github.com/en/apps/.../authenticating-with-a-github-app.
- GitHub Apps support up to 25 private keys (second-key path is supported). Docs:
  managing-private-keys-for-github-apps.
- Least-privilege read scopes: `metadata:read`, `pull_requests:read`, `checks:read`,
  `issues:read`, `security_events:read` (code scanning), `vulnerability_alerts:read`
  (Dependabot).
- Status rollup: GraphQL `statusCheckRollup.state` on PR/commit = cleanest green/red/pending.
- Rate limits: 5,000 GraphQL points/hr per installation — ample for ~30-50 repos at 60s refresh.
- Stack: Hono + `hono/jsx` SSR (no build step, Node 24 native TS), Arctic v3 GitHub OAuth +
  signed cookie, `@octokit/auth-app` + throttling + retry plugins, file-mounted PEM, in-memory
  cache + 60s `setInterval` refresh.

## Key Technical Decisions

- **Home repo `fro-bot/dashboard`, deployed as infra `apps/dashboard`.** Net-new app warrants
  its own repo + conventions; infra owns hosting. (User decision.)
- **Stack: Hono + JSX SSR, single Node process, no build step.** Minimal moving parts for a
  single-operator read-only tool; matches the Node-24-native-TS ecosystem. (Research.)
- **Two credentials, two purposes.** (a) **Operator login:** a dedicated GitHub OAuth App
  (single-username allowlist + signed cookie) — independent rotation. (b) **Data:** a **second
  private key for the existing Fro Bot Agent App** — already installed on `marcusrbrown` +
  `fro-bot`, so no new App to install; independent rotation from the gateway's key. (User
  decisions, Forks 1 + 2.)
- **Read-only verified at the permission level (R5/R7).** The dashboard only calls read
  endpoints, but because the second key inherits the Agent App's permission set, the plan must
  verify the Agent App's permissions are acceptable; if the App carries write scopes, that's
  recorded as a risk to confirm, not silently relied on.
- **Aggregation: enumerate installations, GraphQL `statusCheckRollup`, in-memory 60s cache.**
  `listInstallations` returns the (currently 2) installs; per-install token; union repos; one
  GraphQL query per repo for PRs+checks+issues; cache + background refresh; serve stale + banner
  on fetch failure. (Research.)
- **Redaction preservation.** When reading `metadata/repos.yaml`, preserve `[REDACTED]` entries;
  never resolve/render/cache/export underlying private names. (origin R8.)

## Open Questions

### Resolved During Planning

- Home repo? → `fro-bot/dashboard` + infra `apps/dashboard`. (User)
- Operator auth App? → separate OAuth App. (Fork 1)
- Credential + installation model? → second Agent App key, enumerate its existing installs.
  (Fork 2; collapses origin D4.)
- Stack/auth/secret/freshness? → Hono+JSX / Arctic OAuth+cookie / file-mounted PEM / 60s
  in-memory cache. (Research.)
- Status signal? → GraphQL `statusCheckRollup.state`. (Research.)

### Deferred to Implementation

- Exact `dashboard` GitHub Environment secret names beyond the inferred set
  (`DASHBOARD_SSH_KEY`, `DASHBOARD_DOMAIN`, `DASHBOARD_GITHUB_APP_ID`,
  `DASHBOARD_GITHUB_APP_KEY`, `DASHBOARD_OAUTH_CLIENT_ID`, `DASHBOARD_OAUTH_CLIENT_SECRET`,
  `DASHBOARD_OPERATOR_LOGIN`, `DASHBOARD_COOKIE_KEY`).
- `metadata/repos.yaml` read path: direct GitHub API/`raw` fetch of the `data` ref vs a synced
  copy (origin D3) — resolve when wiring the data layer; preferred is direct read of `data`.
- Whether the Agent App's current permission set is already read-only-acceptable or needs a
  scope review before issuing the second key (R5 verification step in Unit 2).
- Exact droplet size/region (mirror `apps/umami` defaults unless load suggests otherwise).

## Output Structure

    fro-bot/dashboard/                 (net-new repo)
      package.json                     pnpm, type:module, Node 24
      tsconfig.json
      Dockerfile
      src/
        server.ts                      Hono app + routes mount + boot
        session.ts                     signed-cookie session (HMAC)
        secrets.ts                     file-mounted PEM loader + env
        routes/
          auth.ts                      /auth/login, /auth/callback, /auth/logout
          dashboard.tsx                SSR'd glanceable view
          api.ts                       /api/status (JSON), /healthz
        github/
          app-client.ts               Agent App (2nd key) Octokit + throttling/retry
          installations.ts            enumerate installs → tokens → repos
          metadata.ts                 read collaborator repos from data branch (redaction-safe)
          aggregator.ts               union populations + status, in-memory 60s cache
        auth/
          oauth.ts                    Arctic GitHub OAuth (operator allowlist)
      test/                            colocated or test/ — vitest

    marcusrbrown/infra/                (existing repo, new app dir)
      apps/dashboard/
        README.md, AGENTS.md, package.json
        docker-compose.yaml            read_only, cap_drop, file-mounted secret
        config/Caddyfile               dashboard.fro.bot, ACME TLS, 127.0.0.1:3000 upstream
        src/deploy.ts, src/host.ts
        server/provision-droplet.ts
      .github/workflows/deploy-dashboard.yaml
      packages/cli/src/commands/dashboard/{index,deploy,status,logs}.ts

## Implementation Units

Sequenced; Units 1-6 are `fro-bot/dashboard`, Units 7-8 are `marcusrbrown/infra`. The app
(1-6) can be built and tested locally before the infra wiring (7-8) deploys it.

- [ ] **Unit 1: Bootstrap `fro-bot/dashboard` repo + Hono skeleton**

**Goal:** Stand up the new repo with a minimal Hono server, TS/Node-24 config, pnpm, vitest,
and a `/healthz` route.

**Requirements:** R6 (deployable shape), foundation for all.

**Dependencies:** repo `fro-bot/dashboard` created.

**Files (fro-bot/dashboard):**
- Create: `package.json`, `tsconfig.json`, `src/server.ts`, `src/routes/api.ts` (`/healthz`),
  `Dockerfile`, `.gitignore`, `eslint.config.ts`
- Test: `test/server.test.ts`

**Approach:** Hono app, `@hono/node-server`, bind `127.0.0.1:3000`. `/healthz` returns
`{ok, lastFetch:null, rateLimit:null}`. Mirror the control plane's pnpm + Node-24 native-TS
+ eslint conventions. No build step.

**Patterns to follow:** control-plane `package.json`/`tsconfig.json`/`eslint.config.ts`
shape; Hono node-server quickstart.

**Test scenarios:**
- Happy path: `GET /healthz` returns 200 with the status shape.
- Edge: unknown route returns Hono 404.

**Verification:** server starts on Node 24, `/healthz` responds, vitest + lint green.

- [ ] **Unit 2: Agent App client (second key) + installation enumeration**

**Goal:** Octokit App client authenticating with the second Agent App private key; enumerate
installations → tokens → accessible repos.

**Requirements:** R1, R5, R7.

**Dependencies:** Unit 1; second Agent App private key issued; **R5 permission verification**
(confirm the Agent App's scopes are read-only-acceptable, record as risk if not).

**Files (fro-bot/dashboard):**
- Create: `src/secrets.ts` (file-mounted PEM loader + env fallback), `src/github/app-client.ts`
  (`@octokit/auth-app` + throttling + retry), `src/github/installations.ts`
- Test: `test/installations.test.ts`

**Approach:** Load PEM from `/run/secrets/...` (env-overridable for dev). App JWT →
`apps.listInstallations` → per-install token → `listReposAccessibleToInstallation`. Cache
installation tokens in memory. Never log the key.

**Execution note:** test-first for the enumeration/union logic (pure transform over mocked
Octokit responses).

**Patterns to follow:** research Octokit App+throttling setup; control-plane Octokit-derived
typing convention (`as unknown as` boundary casts, no `any`).

**Test scenarios:**
- Happy path: 2 installations → union of their repos, deduped.
- Edge: 0 installations → empty set, no crash.
- Edge: an installation with 0 accessible repos → contributes nothing.
- Error path: `listInstallations` rejects → surfaced as a fetch error (cache serves stale).
- Security: PEM loader never emits key bytes in logs/errors (assert redaction).

**Verification:** with mocked Octokit, enumeration returns the unioned repo set; key never
appears in any log line.

- [ ] **Unit 3: Collaborator-repo metadata reader (redaction-safe)**

**Goal:** Read collaborator repos from `metadata/repos.yaml` on the control plane `data`
branch, preserving redactions.

**Requirements:** R1, R8 (redaction preservation).

**Dependencies:** Unit 2 (shares the app client for the data-branch read, or a public read).

**Files (fro-bot/dashboard):**
- Create: `src/github/metadata.ts`
- Test: `test/metadata.test.ts`

**Approach:** Fetch `metadata/repos.yaml` at `ref=data` (direct GitHub contents API; preferred
over a synced copy). Parse YAML. Filter/label entries; **preserve `owner:[REDACTED]` / node-id
name entries as-is — never resolve, render, cache, or export the underlying private name.**
Handle `data` missing/behind (warn + degrade, don't crash).

**Patterns to follow:** control-plane `metadata/repos.yaml` schema; `data`-branch read by ref.

**Test scenarios:**
- Happy path: parses public entries with owner/name/channel.
- Security: a `[REDACTED]` entry is preserved redacted — the underlying name never appears in
  output/cache (assert no leak).
- Error path: `data` ref 404 / missing → returns empty + warning, no throw.
- Edge: malformed YAML → handled, surfaced as a fetch error.

**Verification:** redacted entries stay redacted end-to-end; missing `data` degrades gracefully.

- [ ] **Unit 4: Status aggregator + in-memory cache**

**Goal:** For the unioned repo set, fetch the bounded Phase-1 signal set via GraphQL and cache
it with a 60s background refresh.

**Requirements:** R2, R3.

**Dependencies:** Units 2, 3.

**Files (fro-bot/dashboard):**
- Create: `src/github/aggregator.ts`
- Test: `test/aggregator.test.ts`

**Approach:** Union(installations repos, collaborator repos), source-channel labeled. Per repo,
one GraphQL query: open PRs + `statusCheckRollup.state`, failing default-branch checks, open
issues (attention heuristic), security alerts. `Map<repoId,{fetchedAt,payload}>` +
`setInterval(refresh, 60_000)`; initial fetch on boot; on failure serve stale + set a banner
flag. Sort attention-first. Cap per-repo summary to a small N (R2 fixed set).

**Patterns to follow:** research GraphQL `statusCheckRollup`; throttling-plugin backoff.

**Test scenarios:**
- Happy path: repos with mixed CI states map to green/red/pending correctly.
- Happy path: attention-needing repos (failing checks / stale PRs / alerts) sort first.
- Edge: empty union → empty dashboard, no crash.
- Edge: a repo with no PRs/issues/alerts → shown healthy.
- Error path: per-repo GraphQL failure → that repo marked stale, others unaffected.
- Error path: full refresh failure → cache serves last-good + banner flag set.
- Integration: cache refresh replaces stale payload after interval (fake timers).

**Verification:** aggregator returns labeled, attention-sorted status; cache refreshes; partial
failures isolated.

- [ ] **Unit 5: Operator auth (GitHub OAuth + signed cookie, allowlist)**

**Goal:** Lock the app to one operator via a dedicated GitHub OAuth App; deny-by-default.

**Requirements:** R4, R8.

**Dependencies:** Unit 1.

**Files (fro-bot/dashboard):**
- Create: `src/auth/oauth.ts` (Arctic), `src/session.ts` (signed cookie), `src/routes/auth.ts`
- Modify: `src/server.ts` (auth middleware on all non-public routes)
- Test: `test/auth.test.ts`, `test/session.test.ts`

**Approach:** Arctic GitHub OAuth web flow with `state`. Callback reads `/user`; reject unless
`login === OPERATOR_LOGIN`. Signed `HttpOnly; Secure; SameSite=Lax` cookie; signing key from
`/data/cookie.key` (generated at first boot if absent). Auth middleware protects every route
except `/healthz` + `/auth/*`; **fail closed** if `OPERATOR_LOGIN` unset.

**Execution note:** test-first for the allowlist gate + session validation (the security core).

**Patterns to follow:** Arctic GitHub provider docs; deny-by-default middleware.

**Test scenarios:**
- Happy path: allowlisted login → session issued, protected route accessible.
- Security: non-allowlisted login → rejected, no session.
- Security: missing/invalid/tampered cookie → protected route denied (no anonymous fallback).
- Security: `OPERATOR_LOGIN` unset → app fails closed (all auth denied).
- Edge: OAuth `state` mismatch → callback rejected (CSRF).
- Happy path: `/healthz` reachable without auth.

**Verification:** only the allowlisted operator gains a session; every protected route denies
unauthenticated/invalid requests; unset allowlist fails closed.

- [ ] **Unit 6: Dashboard view (SSR) + status API**

**Goal:** Glanceable SSR view + `/api/status` JSON, behind auth, with manual refresh.

**Requirements:** R2, R3, R4.

**Dependencies:** Units 4, 5.

**Files (fro-bot/dashboard):**
- Create: `src/routes/dashboard.tsx`
- Modify: `src/routes/api.ts` (`/api/status`), `src/server.ts` (mount)
- Test: `test/dashboard.test.ts`

**Approach:** `hono/jsx` SSR rendering the aggregator's cached status — attention-first,
source-channel labels, per-repo capped summary, drill-in links to GitHub. `/api/status` returns
the cached JSON (for client-side manual refresh; a thin Alpine sprinkle or a refresh link).
Stale-cache banner when set.

**Patterns to follow:** Hono JSX SSR; research glanceable-triage layout.

**Test scenarios:**
- Happy path: authed `GET /` renders repos with status, attention-first.
- Happy path: `GET /api/status` returns cached JSON shape.
- Security: unauthed `GET /` and `GET /api/status` → denied.
- Edge: empty cache (pre-first-fetch) → "loading"/empty state, not an error.
- Edge: stale-cache banner renders when the refresh flag is set.

**Verification:** authed operator sees a glanceable attention-sorted view; unauth denied;
empty/stale states render cleanly.

- [ ] **Unit 7: Infra `apps/dashboard` deploy stack**

**Goal:** Deployable Compose + Caddy + deploy scripts + provisioning, mirroring `apps/umami`.

**Requirements:** R6, R8 (secret-at-rest).

**Dependencies:** Units 1-6 (a runnable image); `marcusrbrown/infra` access.

**Files (marcusrbrown/infra):**
- Create: `apps/dashboard/{README.md, AGENTS.md, package.json, docker-compose.yaml,
  config/Caddyfile, src/deploy.ts, src/host.ts, server/provision-droplet.ts}`,
  `apps/dashboard/docker-compose.test.ts`

**Approach:** Mirror `apps/umami`. Compose: `read_only`, `cap_drop:[ALL]`,
`no-new-privileges`, non-root user, **file-mounted PEM secret**, app on `127.0.0.1:3000`,
Caddy fronting `dashboard.fro.bot` with ACME TLS. `deploy.ts` writes `/opt/dashboard/.env`
+ secret file over SSH stdin. `provision-droplet.ts` creates the DO droplet + pins host keys.

**Patterns to follow:** `apps/umami/{docker-compose.yaml, config/Caddyfile, src/deploy.ts,
server/provision-droplet.ts}` exactly.

**Test scenarios:**
- `apps/dashboard/docker-compose.test.ts` validates the compose shape (mirror umami's test):
  read-only, secret mount present, no secrets in argv/env where file-mount is required.

**Verification:** `docker compose config` valid; secret is file-mounted not argv; Caddyfile
targets `dashboard.fro.bot`.

- [ ] **Unit 8: Infra deploy workflow + CLI registration**

**Goal:** Wire `apps/dashboard` into the deploy router + CLI.

**Requirements:** R6.

**Dependencies:** Unit 7.

**Files (marcusrbrown/infra):**
- Create: `.github/workflows/deploy-dashboard.yaml`,
  `packages/cli/src/commands/dashboard/{index,deploy,status,logs}.ts`
- Modify: `.github/workflows/deploy.yaml` (path-filter `apps/dashboard/**` → dashboard job),
  `packages/cli/src/cli.ts` (`registerDashboardCommands`)

**Approach:** Mirror `deploy-umami.yaml` (checkout, bun install, validate `dashboard`
environment secrets, install pinned host keys, `bun run --cwd apps/dashboard deploy`). Add the
path-filter mapping + per-app job to the umbrella workflow. CLI: `dashboard deploy`
(default GH Actions, `--local` SSH), `status` (ssh + `docker compose ps`), `logs`.

**Patterns to follow:** `.github/workflows/deploy-umami.yaml`, the umbrella `deploy.yaml`
filter block, `packages/cli/src/commands/umami/*`, `registerUmamiCommands` in `cli.ts`.

**Test scenarios:**
- Test expectation: none for workflow YAML beyond actionlint; CLI command wiring covered by
  infra's existing CLI test conventions if present.

**Verification:** `deploy.yaml` dispatches on `apps/dashboard/**` change; `dashboard deploy`
triggers the workflow; actionlint clean.

## System-Wide Impact

- **Interaction graph:** read-only consumer of GitHub APIs + the control plane's `data` branch.
  Does not write to any repo, metadata, the gateway, or wiki.
- **Credential surface:** introduces a second Agent App private key on a new web-facing host —
  the primary new risk (mitigated by file-mount, read-only-verified scopes, deny-by-default
  auth, no-log discipline).
- **Redaction invariant:** the dashboard reads `metadata/repos.yaml`; it MUST preserve the
  control plane's private-repo redactions (R8) — a leak here would undo the privacy work.
- **Unchanged invariants:** the gateway, the control plane's `data`-branch authority, and the
  Agent App's existing gateway use are untouched; the dashboard only adds a second read key.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Second Agent App key inherits write scopes (read-only is then only behavioral) | Verify the Agent App's permission set before issuing the key (Unit 2 dependency); record + confirm if write scopes exist; the app calls only read endpoints regardless |
| Web-facing host holds an App private key | File-mounted PEM, `read_only` container, deny-by-default auth, never logged, independently revocable |
| `metadata/repos.yaml` private redactions leak through the dashboard | Redaction-preserving reader (Unit 3) with explicit no-leak tests |
| GitHub rate limits across many repos | GraphQL batched per-repo, per-install token, 60s cache (5000 pts/hr is ample); throttling+retry plugins |
| `data` branch absent in the post-squash window | Reader degrades gracefully (warn + empty), mirrors control-plane handling |
| New repo + new droplet provisioning overhead | Mirror `apps/umami` exactly; provisioning is a one-time setup unit |

## Sources & References

- **Origin:** docs/brainstorms/2026-06-15-monitoring-dashboard-phase-1-requirements.md
- **North-star:** docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md
- **Spine (deferred bindings):** fro-bot/agent#907
- Infra deploy contract: `marcusrbrown/infra` `apps/umami/*`, `.github/workflows/deploy*.yaml`,
  `packages/cli/src/commands/umami/*`
- GitHub App auth + permissions + GraphQL rollup + 25-key support: docs.github.com (see
  Context & Research)
- Stack: Hono, Arctic v3, `@octokit/auth-app`/throttling/retry
