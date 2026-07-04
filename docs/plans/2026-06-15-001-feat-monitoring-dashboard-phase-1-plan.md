---
title: 'feat: Fro Bot monitoring dashboard — Phase 1'
type: feat
status: complete
completed: 2026-07-04
date: 2026-06-15
deepened: 2026-06-15
reconciled: 2026-06-21
origin: docs/brainstorms/2026-06-15-monitoring-dashboard-phase-1-requirements.md
---

# feat: Fro Bot monitoring dashboard — Phase 1

> **Reconciliation (2026-06-21).** All 8 units are CODE-COMPLETE and merged — Units 1-6 in
> `fro-bot/dashboard`, Units 7-8 in `marcusrbrown/infra` — with the R8 cross-source leak
> guard genuinely implemented (denylist-before-query + fail-closed). This is **not yet
> operationally complete.** Owed before "done": (A) live-deploy verification
> (`dashboard.fro.bot` TLS/`healthz`, OAuth E2E, protected-route denial, cookie/logout);
> (B) production-shaped R8 verification (exercise the aggregator against real redacted data —
> zero private name/`node_id` in SSR/api/logs/cache; fail-closed on metadata failure);
> (C) infra security posture (App key file-mounted, container hardening, no secrets in logs,
> revocation runbook); (D) a post-merge security review if Units 1-6 shipped without one.
> Those verification steps are owned by the dedicated dashboard + infra sessions; this plan
> stays `code-complete-pending-verification` until they pass. The unit checkboxes below
> reflect code-merged status, not operational sign-off.
>
> **Closure (2026-07-04).** Marked `complete`: the dashboard has been live at its production
> domain with continuous releases since late June, and the follow-on hardening, redaction, and
> deploy-security work proceeded in the dashboard and infra repos' own sessions and reviews.
> Weeks of production operation superseded the pending-verification posture recorded above;
> remaining operator-rollout verification is tracked in the gateway rollout tracker, not this
> plan.

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
- R5. Isolated read credential: a second private key for the existing Agent App. The dashboard
  MUST mint every installation token with an explicit read-only permission subset
  (`pull_requests:read, checks:read, issues:read, contents:read, metadata:read,
  security_events:read, vulnerability_alerts:read`); the Agent App's registered permissions are
  thereby irrelevant to the dashboard's effective access. (origin R5, SC5)
- R6. Infra-hosted via the `apps/<name>` pattern. (origin R6)
- R7. Read-only by construction: no write code paths; token-scoping at mint time enforces this
  structurally, not just behaviorally. (origin R7)
- R8. Security properties: deny-by-default authz, encrypted key at rest, redaction
  preservation (including cross-source leak prevention — the installations channel must not
  re-derive what metadata redaction hid), abuse controls. (origin R8)

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
- **Future: migrate to a dedicated read-only GitHub App** — gated on the dashboard needing an
  installation source the Agent App doesn't cover, or a real permission-creep/App-deletion
  incident. Not needed for Phase-1 given token-scoping (Change 1 / R5 above).

## Context & Research

### Relevant Code and Patterns

- **Infra deploy contract** (`marcusrbrown/infra`): closest analog is `apps/umami/`
  (web app + Caddy). Minimal new-app file set: `apps/dashboard/{README.md, AGENTS.md,
  package.json, docker-compose.yaml, config/Caddyfile, src/deploy.ts, src/host.ts}`. Deploy
  via `.github/workflows/deploy-dashboard.yaml` wired into the umbrella
  `.github/workflows/deploy.yaml` (dorny/paths-filter on `apps/dashboard/**`). Secrets via
  GitHub Environment `dashboard`, materialized over SSH stdin to `/opt/dashboard/.env`. CLI
  group under `packages/cli/src/commands/dashboard/`, registered in
  `packages/cli/src/cli.ts`. DNS A record `dashboard.fro.bot` → droplet; Caddy ACME TLS.
- **Control-plane metadata** (`fro-bot/.github`): `metadata/repos.yaml` on the `data` branch
  carries collaborator repos with intentionally-redacted private entries (`owner: [REDACTED]`,
  node-id names) — must be preserved (R8). The installations channel can re-derive what
  metadata redaction hid; the aggregator must prevent this (see Unit 4).

### External References

- GitHub App auth flow: App JWT (signed with private key) → `GET /app/installations`
  (`apps.listInstallations`) → `POST /app/installations/{id}/access_tokens` with explicit
  `permissions` object → installation token → `GET /installation/repositories`. Docs:
  docs.github.com/en/apps/.../authenticating-with-a-github-app.
- Token-scoping: `POST /app/installations/{id}/access_tokens` accepts a `permissions` object
  that mints a token with a strict subset of the App's registered permissions. The gateway
  already uses this pattern (`installAuth({type:'installation', permissions:{...}})`). The
  dashboard MUST do the same — this makes the App's registered permission set irrelevant to
  the dashboard's effective access.
- GitHub Apps support up to 25 private keys (second-key path is supported). Docs:
  managing-private-keys-for-github-apps.
- Least-privilege read scopes: `metadata:read`, `pull_requests:read`, `checks:read`,
  `issues:read`, `contents:read`, `security_events:read` (code scanning),
  `vulnerability_alerts:read` (Dependabot). Note: `security_events` and `vulnerability_alerts`
  may not be registered on the Agent App — handle token-mint/query failure for these
  gracefully (conditional, don't crash).
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
- **Read-only enforced at token-mint time (R5/R7).** Every installation token is minted with
  an explicit read-only `permissions` object (`pull_requests:read, checks:read, issues:read,
  contents:read, metadata:read, security_events:read, vulnerability_alerts:read`), mirroring
  the gateway's `installAuth({type:'installation', permissions:{...}})` pattern. This makes the
  Agent App's registered permission set irrelevant to the dashboard's effective access — the
  token is scoped down structurally, not just behaviorally. A boot-time self-check logs
  (fail-loud, no crash) if the App lacks a needed read permission.
- **Aggregation: enumerate installations, GraphQL `statusCheckRollup`, in-memory 60s cache.**
  `listInstallations` returns the (currently 2) installs; per-install token (read-only scoped);
  union repos; one GraphQL query per repo for PRs+checks+issues; cache + background refresh;
  serve stale + banner on fetch failure. (Research.)
- **Redaction preservation + cross-source leak prevention.** When reading `metadata/repos.yaml`,
  preserve `[REDACTED]` entries; never resolve/render/cache/export underlying private names.
  The aggregator additionally maintains a `redactedNodeIds` denylist (from Unit 3) and excludes
  any installation-enumerated repo whose node_id is in that set — preventing the installations
  channel from re-deriving what metadata redaction hid. Source-channel labels are populated
  ONLY for repos known-public from repos.yaml; installation-discovered repos carry a generic
  `discovered` label. (origin R8.)

### Interface Contracts (seam map for future `@fro.bot/runtime` collapse)

These are NOT done in Phase-1. They document the extraction seam so a future collapse is a
file-move, not a signature migration:

- `src/secrets.ts` → match gateway `config.ts` signatures (`readSecret`, `readMultilineSecret`,
  `SecretFileNotFoundError`, `O_NOFOLLOW` + size-limit semantics).
- `src/server.ts` → split `buildDashboardApp(): Hono` + `createDashboardServer(): ServerType`
  (mirror gateway's build/serve split).
- Logger → implement the `@fro-bot/runtime` `shared/logger.ts` `Logger` interface.
- App client → use a `Result<T,E>` error-return shape.

## Open Questions

### Resolved During Planning

- Home repo? → `fro-bot/dashboard` + infra `apps/dashboard`. (User)
- Operator auth App? → separate OAuth App. (Fork 1)
- Credential + installation model? → second Agent App key, enumerate its existing installs.
  (Fork 2; collapses origin D4.)
- Stack/auth/secret/freshness? → Hono+JSX / Arctic OAuth+cookie / file-mounted PEM / 60s
  in-memory cache. (Research.)
- Status signal? → GraphQL `statusCheckRollup.state`. (Research.)
- Dedicated read-scoped App vs second key? → second key is sufficient; token-scoping at mint
  time makes the App's registered permissions irrelevant. Dedicated App deferred (see Scope
  Boundaries → Deferred).

### Deferred to Implementation

- Exact `dashboard` GitHub Environment secret names beyond the inferred set
  (`DASHBOARD_SSH_KEY`, `DASHBOARD_DOMAIN`, `DASHBOARD_GITHUB_APP_ID`,
  `DASHBOARD_GITHUB_APP_KEY`, `DASHBOARD_OAUTH_CLIENT_ID`, `DASHBOARD_OAUTH_CLIENT_SECRET`,
  `DASHBOARD_OPERATOR_LOGIN`, `DASHBOARD_COOKIE_KEY`).
- `metadata/repos.yaml` read path: direct GitHub API/`raw` fetch of the `data` ref vs a synced
  copy (origin D3) — resolve when wiring the data layer; preferred is direct read of `data`.
- Exact droplet size/region (mirror `apps/umami` defaults unless load suggests otherwise).
- Key-revocation runbook: where to revoke the second Agent App key, confirmation it doesn't
  affect the gateway, re-provision path. Document in `apps/dashboard/README.md` at Unit 7.
- Cardinality disclosure: the "N repos the Agent App can see are not in public metadata"
  count-only drift surface is a deliberate cardinality disclosure (operator learns private repos
  exist and how many). Acceptable for single-operator Phase-1; revisit if the dashboard ever
  becomes multi-viewer.

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
          installations.ts            enumerate installs → tokens (read-only scoped) → repos
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
      .github/workflows/deploy-dashboard.yaml
      packages/cli/src/commands/dashboard/{index,deploy,status,logs}.ts

## Implementation Units

Sequenced; Units 1-6 are `fro-bot/dashboard`, Units 7-8 are `marcusrbrown/infra`. The app
(1-6) can be built and tested locally before the infra wiring (7-8) deploys it.

**Unit 0 + Unit 1 (repo bootstrap) are the handoff seam** — after the repo is bootstrapped,
the `fro-bot/dashboard` build (Units 1-6) is handed to a separate parallel development session
working against this plan; orchestration/planning stays in the originating session. Units 7-8
(infra deploy) coordinate back.

- [x] **Unit 0: Provision prerequisites (one-time, manual)**

**Goal:** All external resources that Units 1-6 depend on are created and secrets are
provisioned before any code is written.

**Requirements:** Foundation for all units.

**Checklist:**
- Create the `fro-bot/dashboard` repo (empty, with branch protection).
- Create a dedicated GitHub OAuth App; save `CLIENT_ID` / `CLIENT_SECRET`; set callback URL
  to `https://dashboard.fro.bot/auth/callback`.
- Generate a second private key for the existing Fro Bot Agent App; save as the dashboard's
  app key (independent rotation from the gateway's key).
- Provision the DO droplet via the `apps/umami` `server/provision-droplet.ts` pattern; pin
  host key to `.github/known_hosts` in `marcusrbrown/infra`.
- Create the `dashboard` GitHub Environment in `marcusrbrown/infra` with secrets:
  `DASHBOARD_SSH_KEY`, `DASHBOARD_DOMAIN`, `DASHBOARD_GITHUB_APP_ID`,
  `DASHBOARD_GITHUB_APP_KEY`, `DASHBOARD_OAUTH_CLIENT_ID`, `DASHBOARD_OAUTH_CLIENT_SECRET`,
  `DASHBOARD_OPERATOR_LOGIN`, `DASHBOARD_COOKIE_KEY`.

**Note:** Units 1-6 can proceed locally with env-overridable dev values; smoke/integration
tests against real GitHub require the real key. Droplet provisioning is a one-time step here;
Unit 7 owns the Compose/Caddy/deploy files.

- [x] **Unit 1: Bootstrap `fro-bot/dashboard` repo + Hono skeleton**

**Goal:** Stand up the new repo with a minimal Hono server, TS/Node-24 config, pnpm, vitest,
and a `/healthz` route.

**Requirements:** R6 (deployable shape), foundation for all.

**Dependencies:** Unit 0 (repo created).

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

- [x] **Unit 2: Agent App client (second key) + installation enumeration**

**Goal:** Octokit App client authenticating with the second Agent App private key; enumerate
installations → read-only-scoped tokens → accessible repos.

**Requirements:** R1, R5, R7.

**Dependencies:** Unit 0 (second Agent App private key issued); Unit 1.

**Files (fro-bot/dashboard):**
- Create: `src/secrets.ts` (file-mounted PEM loader + env fallback), `src/github/app-client.ts`
  (`@octokit/auth-app` + throttling + retry), `src/github/installations.ts`
- Test: `test/installations.test.ts`

**Approach:** Load PEM from `/run/secrets/...` (env-overridable for dev). App JWT →
`apps.listInstallations` → per-install token minted via `POST /app/installations/{id}/access_tokens`
with an explicit read-only `permissions` object (`{pull_requests:'read', checks:'read',
issues:'read', contents:'read', metadata:'read', security_events:'read',
vulnerability_alerts:'read'}`) and `repositoryNames` (or installation scope), mirroring the
gateway's `installAuth({type:'installation', permissions:{...}})` pattern in
`packages/gateway/src/github/app-client.ts`. Cache installation tokens in memory. Never log
the key. `security_events` and `vulnerability_alerts` may not be registered on the App —
handle token-mint failure for these gracefully (conditional, don't crash). A boot-time
self-check logs (fail-loud, no crash) if the App lacks a needed read permission.

**Structural contrast:** the gateway's app-client does per-(owner,repo) discovery → repo-scoped
token; the dashboard does `listInstallations` → per-install token → install-scoped repos.
Structurally different flows — do NOT share or abstract them into one component. Both use
`@octokit/auth-app` as the common primitive; similarity ends there.

**Execution note:** test-first for the enumeration/union logic (pure transform over mocked
Octokit responses).

**Patterns to follow:** gateway `packages/gateway/src/github/app-client.ts`
`installAuth({type:'installation', permissions:{...}})` for token-mint shape; control-plane
Octokit-derived typing convention (`as unknown as` boundary casts, no `any`).

**Test scenarios:**
- Happy path: 2 installations → union of their repos, deduped.
- Edge: 0 installations → empty set, no crash.
- Edge: an installation with 0 accessible repos → contributes nothing.
- Error path: `listInstallations` rejects → surfaced as a fetch error (cache serves stale).
- Security: PEM loader never emits key bytes in logs/errors (assert redaction).
- Security: every installation-token mint call carries a read-only `permissions` subset (assert
  the permissions object is present and contains no write scopes).

**Verification:** with mocked Octokit, enumeration returns the unioned repo set; key never
appears in any log line; every minted token carries a read-only permissions object.

- [x] **Unit 3: Collaborator-repo metadata reader (redaction-safe)**

**Goal:** Read collaborator repos from `metadata/repos.yaml` on the control plane `data`
branch, preserving redactions and exporting a denylist of redacted node_ids for the aggregator.

**Requirements:** R1, R8 (redaction preservation).

**Dependencies:** Unit 2 (shares the app client for the data-branch read, or a public read).

**Files (fro-bot/dashboard):**
- Create: `src/github/metadata.ts`
- Test: `test/metadata.test.ts`

**Approach:** Fetch `metadata/repos.yaml` at `ref=data` (direct GitHub contents API; preferred
over a synced copy). Parse YAML. Check top-level `version` field — if `version !== 1`, fail
closed (throw/return error; do not silently return empty). Filter/label entries; **preserve
`owner:[REDACTED]` / node-id name entries as-is — never resolve, render, cache, or export the
underlying private name.** Export both the public repo list AND `redactedNodeIds: Set<string>`
— the `node_id` values of every `[REDACTED]`/`private:true` entry — for the aggregator's
cross-source denylist. Handle `data` missing/behind (warn + degrade, don't crash).

**Patterns to follow:** control-plane `metadata/repos.yaml` schema; `data`-branch read by ref.

**Test scenarios:**
- Happy path: parses public entries with owner/name/channel.
- Security: a `[REDACTED]` entry is preserved redacted — the underlying name never appears in
  output/cache (assert no leak).
- Security: redacted entries' `node_id` values populate `redactedNodeIds` (assert denylist
  is non-empty and contains the expected ids).
- Schema: `version !== 1` → reader fails closed (returns error, does not silently return empty).
- Error path: `data` ref 404 / missing → returns empty + warning, no throw.
- Edge: malformed YAML → handled, surfaced as a fetch error.

**Verification:** redacted entries stay redacted end-to-end; `redactedNodeIds` populated;
unexpected schema version fails closed; missing `data` degrades gracefully.

- [x] **Unit 4: Status aggregator + in-memory cache**

**Goal:** For the unioned repo set, fetch the bounded Phase-1 signal set via GraphQL and cache
it with a 60s background refresh — without leaking redacted private repos through the
installations channel.

**Requirements:** R2, R3, R8 (cross-source leak prevention).

**Dependencies:** Units 2, 3.

**Files (fro-bot/dashboard):**
- Create: `src/github/aggregator.ts`
- Test: `test/aggregator.test.ts`

**Approach:** Union(installations repos, collaborator repos). Before issuing any per-repo
`statusCheckRollup` GraphQL query, exclude any installation-enumerated repo whose `node_id` is
in `redactedNodeIds` (from Unit 3) — the exclusion happens upstream of the query layer, not at
render time. Rationale: issuing a status query against a redacted private repo is itself an
observable signal and a leak of intent, even if the result is later dropped. Denylisted
`node_id`s never reach the GraphQL fetch loop — they are removed from the working repo set
before iteration begins. This prevents the installations channel from re-deriving what metadata
redaction hid.

**Fail-closed on denylist unavailability:** if the `metadata/repos.yaml` read from the `data`
branch fails (Unit 3 returns an error or an empty/incomplete denylist), the aggregator MUST
NOT serve an unfiltered union of installation-discovered repos. Doing so would expose private
repos the denylist would have caught. Instead: serve the last-good cached state + banner, or
an empty/error state. Never build a fresh union without a valid `redactedNodeIds` set.

Source-channel labels: populated ONLY for repos known-public from `repos.yaml`; repos
discovered solely via the installations channel carry a generic `discovered` label (never
expose the metadata-vs-installation cardinality gap that would let an operator infer hidden
private repos exist). The output may surface a count-only drift note — "N repos the Agent App
can see are not in public metadata" — with NO names.

Per repo, one GraphQL query: open PRs + `statusCheckRollup.state`, failing default-branch
checks, open issues (attention heuristic), security alerts. `Map<repoId,{fetchedAt,payload}>`
+ `setInterval(refresh, 60_000)`; initial fetch on boot; on failure serve stale + set a banner
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
- Security: given `repos.yaml` redacted entries + installations API returning those same repos
  with real names, aggregator output contains ZERO references to them (by `full_name`, `name`,
  or `node_id`).
- Security: no GraphQL/status call is ISSUED for a denylisted `node_id` — assert the GitHub
  client is never invoked for those repos, not just that they are absent from output.
- Security: when the `data`-branch metadata read fails (so `redactedNodeIds` is unavailable),
  the aggregator does NOT emit installation-discovered repos unfiltered — fail closed: serve
  last-good stale cache or an empty/error state, never an un-denylisted union built without the
  denylist.

**Verification:** aggregator returns labeled, attention-sorted status; cache refreshes; partial
failures isolated; redacted repos absent from all output.

- [x] **Unit 5: Operator auth (GitHub OAuth + signed cookie, allowlist)**

**Goal:** Lock the app to one operator via a dedicated GitHub OAuth App; deny-by-default.

**Requirements:** R4, R8.

**Dependencies:** Unit 0 (OAuth App created, `OPERATOR_LOGIN` + `COOKIE_KEY` provisioned);
Unit 1.

**Files (fro-bot/dashboard):**
- Create: `src/auth/oauth.ts` (Arctic), `src/session.ts` (signed cookie), `src/routes/auth.ts`
- Modify: `src/server.ts` (auth middleware on all non-public routes)
- Test: `test/auth.test.ts`, `test/session.test.ts`

**Approach:** Arctic GitHub OAuth web flow. OAuth `state` stored in a short-TTL signed cookie
before redirect, compared on callback (CSRF). Callback reads `/user`; reject unless
`login === OPERATOR_LOGIN`. Signed `HttpOnly; Secure; SameSite=Lax` cookie; signing key from
`/data/cookie.key` (env-overridable for dev). Cookie signing key MUST be `crypto.randomBytes(32)`
(256-bit minimum); reject keys shorter than 32 bytes at boot (fail closed). Signed cookie
payload includes a 24h `exp` claim covered by the HMAC; auth middleware rejects expired
cookies. Auth middleware protects every route except `/healthz` + `/auth/*`; **fail closed**
if `OPERATOR_LOGIN` is unset or whitespace-only. Per-IP rate limiting (Hono middleware) on
`/api/status`, the SSR route, and `/auth/callback`.

**Execution note:** test-first for the allowlist gate + session validation (the security core).

**Patterns to follow:** Arctic GitHub provider docs; deny-by-default middleware.

**Test scenarios:**
- Happy path: allowlisted login → session issued, protected route accessible.
- Security: non-allowlisted login → rejected, no session.
- Security: missing/invalid/tampered cookie → protected route denied (no anonymous fallback).
- Security: `OPERATOR_LOGIN` unset → app fails closed (all auth denied).
- Security: `OPERATOR_LOGIN=" "` (whitespace-only) → boot fails.
- Security: expired cookie → rejected (24h `exp` claim enforced).
- Security: OAuth `state` mismatch → callback rejected (CSRF).
- Security: cookie key shorter than 32 bytes → boot fails (weak key rejected).
- Edge: `/healthz` reachable without auth.

**Verification:** only the allowlisted operator gains a session; every protected route denies
unauthenticated/invalid/expired requests; unset or whitespace allowlist fails closed; weak
cookie key rejected at boot.

- [x] **Unit 6: Dashboard view (SSR) + status API**

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

- [x] **Unit 7: Infra `apps/dashboard` deploy stack**

**Goal:** Deployable Compose + Caddy + deploy scripts, mirroring `apps/umami`.

**Requirements:** R6, R8 (secret-at-rest).

**Dependencies:** Units 1-6 (a runnable image); `marcusrbrown/infra` access; Unit 0 (droplet
already provisioned, host key already pinned).

**Files (marcusrbrown/infra):**
- Create: `apps/dashboard/{README.md, AGENTS.md, package.json, docker-compose.yaml,
  config/Caddyfile, src/deploy.ts, src/host.ts}`,
  `apps/dashboard/docker-compose.test.ts`

**Approach:** Mirror `apps/umami`. Compose: `read_only`, `cap_drop:[ALL]`,
`no-new-privileges`, non-root user, **file-mounted PEM secret**, app on `127.0.0.1:3000`,
Caddy fronting `dashboard.fro.bot` with ACME TLS. `deploy.ts` writes `/opt/dashboard/.env`
+ secret file over SSH stdin. Droplet egress restricted to `api.github.com:443` + DNS only.
Installation tokens are re-minted every refresh cycle — never serve a cached token past TTL.
`apps/dashboard/README.md` includes the key-revocation runbook (where to revoke the second
Agent App key, confirmation it doesn't affect the gateway, re-provision path).

**Patterns to follow:** `apps/umami/{docker-compose.yaml, config/Caddyfile, src/deploy.ts}`
exactly.

**Test scenarios:**
- `apps/dashboard/docker-compose.test.ts` validates the compose shape (mirror umami's test):
  read-only, secret mount present, no secrets in argv/env where file-mount is required.

**Verification:** `docker compose config` valid; secret is file-mounted not argv; Caddyfile
targets `dashboard.fro.bot`.

- [x] **Unit 8: Infra deploy workflow + CLI registration**

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
- **Data-branch read architecture:** every refresh cycle issues one Contents API call at
  `ref=data` before status queries; no local cache of the YAML. Degrades gracefully in the
  `data` force-push/squash window (warn + empty). The dashboard is a second consumer of the
  `data` ref's availability alongside the control plane.
- **Credential surface:** introduces a second Agent App private key on a new web-facing host —
  the primary new risk (mitigated by file-mount, token-scoped read-only at mint time,
  deny-by-default auth, no-log discipline).
- **Redaction invariant:** the dashboard reads `metadata/repos.yaml`; it MUST preserve the
  control plane's private-repo redactions (R8). The cross-source leak risk is specific: the
  installations channel can re-derive what metadata redaction hid — the aggregator's
  `redactedNodeIds` denylist (Unit 3 → Unit 4) is the structural guard.
- **Unchanged invariants:** the gateway, the control plane's `data`-branch authority, and the
  Agent App's existing gateway use are untouched; the dashboard only adds a second read key.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Second Agent App key's effective scopes too broad | Installation tokens are minted with a read-only `permissions` subset at mint time — the App's registered permissions don't determine the dashboard's access. A boot-time self-check logs (fail-loud, no crash) if the App lacks a needed read permission. |
| Web-facing host holds an App private key | File-mounted PEM, `read_only` container, deny-by-default auth, never logged, independently revocable |
| `metadata/repos.yaml` private redactions leak through the installations channel | Unit 3 exports `redactedNodeIds`; Unit 4 aggregator excludes any installation-enumerated repo in that set — zero references by name, full_name, or node_id in output |
| GitHub rate limits across many repos | GraphQL batched per-repo, per-install token, 60s cache (5000 pts/hr is ample); throttling+retry plugins |
| `data` branch absent in the post-squash window | Reader degrades gracefully (warn + empty), mirrors control-plane handling |
| New repo + new droplet provisioning overhead | Unit 0 is the explicit one-time provisioning step; Unit 7 mirrors `apps/umami` exactly |
| Installation-topology coupling | Dashboard's install inventory is a live query of the shared Agent App; no independent snapshot — shows current state only. Acceptable for Phase-1 single-operator use. |
| Permission-creep inheritance | Mitigated by token-scoping at mint time (boot-time self-check); a periodic check is a deferred improvement. |
| App-level rate-limit contention | `listInstallations` shares the App's rate limit with the gateway; negligible at 2 installs/60s. Log App rate-limit headers to alert before contention. |
| `security_events`/`vulnerability_alerts` not registered on App | Token-mint and query failures for these scopes handled gracefully (conditional, no crash). |

## Sources & References

- **Origin:** docs/brainstorms/2026-06-15-monitoring-dashboard-phase-1-requirements.md
- **North-star:** docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md
- **Spine (deferred bindings):** fro-bot/agent#907
- Infra deploy contract: `marcusrbrown/infra` `apps/umami/*`, `.github/workflows/deploy*.yaml`,
  `packages/cli/src/commands/umami/*`
- GitHub App auth + permissions + GraphQL rollup + 25-key support: docs.github.com (see
  Context & Research)
- Stack: Hono, Arctic v3, `@octokit/auth-app`/throttling/retry
