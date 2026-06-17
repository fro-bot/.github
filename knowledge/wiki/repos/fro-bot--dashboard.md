---
type: repo
title: "fro-bot/dashboard"
created: 2026-06-15
updated: 2026-06-15
sources:
  - url: https://github.com/fro-bot/dashboard
    sha: 250493945add33e30cf25ec890d7d1b37d31d00e
    accessed: 2026-06-15
tags: [typescript, hono, node24, native-typescript, strip-only, pnpm, github-app, oauth, octokit, arctic, monitoring, dashboard, read-only, ssr, fro-bot, redaction, fail-closed, security]
related:
  - fro-bot--agent
  - marcusrbrown--infra
  - bfra-me--works
---

# fro-bot/dashboard

Read-only Fro Bot monitoring dashboard. A single Hono + server-side-rendered (SSR) Node 24 process that surfaces live cross-repo status — open PRs + CI state, failing checks, open issues, security alerts — for Fro Bot's collaborator repos and Agent App installations in one glanceable, single-operator view.

The repo is the implementation of the Phase 1 plan tracked in [[fro-bot--agent]]'s parent org repo (`fro-bot/.github` `docs/plans/2026-06-15-001-feat-monitoring-dashboard-phase-1-plan.md`). It is brand new: created 2026-06-14, version `0.0.0`, no releases yet.

## Overview

| Attribute       | Value                                                            |
| --------------- | --------------------------------------------------------------- |
| Created         | 2026-06-14                                                      |
| Last push       | 2026-06-15 (survey 2026-06-15)                                  |
| Language        | TypeScript (Node 24 native TS, **strip-only**, ESM)            |
| Package manager | pnpm 11.5.0                                                     |
| Node.js         | `>=24` (engines)                                                |
| Build step      | **None** — runs `.ts` directly via Node 24 strip-only execution |
| Web framework   | Hono ^4.7.11 + `@hono/node-server` ^1.14.4                      |
| Auth library    | Arctic 3.7.0 (GitHub OAuth)                                     |
| GitHub client   | `@octokit/core` 7.0.6, `@octokit/auth-app` 8.2.0, `@octokit/graphql` 9.0.3, retry + throttling plugins |
| Test framework  | Vitest 4.1.4                                                    |
| Lint            | ESLint 10.4.0 (`@bfra.me/eslint-config` 0.51.0) + `eslint-plugin-erasable-syntax-only` 0.4.0 |
| TypeScript      | 6.0.3 (`@bfra.me/tsconfig` 0.13.0)                             |
| Visibility      | Public                                                          |
| Stars           | 0                                                               |
| License         | None declared                                                  |
| Releases        | None (version `0.0.0`, `private: true`)                         |

## Purpose

This is the read-only observability surface for Fro Bot's footprint. It authenticates a single operator (Marcus) via GitHub OAuth, enumerates the Fro Bot Agent App's installations, mints **read-only** installation tokens, and aggregates per-repo signals into a glanceable SSR page plus a JSON API. It writes nothing back to GitHub.

## Architecture

Single Hono process, no build step. Source layout (`src/`, ~16 modules + 7 test files):

| Path                      | Responsibility                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/server.ts`           | App factory (`buildDashboardApp`) + server binding (`createDashboardServer`, binds `127.0.0.1:3000`). Wires middleware, OAuth, aggregator, routers. |
| `src/routes/dashboard.ts` | SSR route using `hono/html` tagged templates (no JSX, no build step). Auto-escaped output; logout is a POST form with CSRF token. |
| `src/routes/api.ts`       | JSON API — `GET /api/healthz`, `GET /api/status` (aggregator snapshot). Injectable `SnapshotProvider`. |
| `src/routes/auth.ts`      | OAuth routes `/auth/login`, `/auth/callback`, `/auth/logout`. CSRF state cookie, operator allowlist, HMAC double-submit logout token. |
| `src/auth/oauth.ts`       | Arctic v3 GitHub OAuth client wrapped behind a testable `GitHubOAuthClient` seam. |
| `src/github/installations.ts` | Enumerate Agent App installations, mint read-only tokens, enumerate repos. |
| `src/github/app-client.ts`| GitHub App client (`installAuth` read-only permissions pattern). |
| `src/github/aggregator.ts`| Per-repo signal aggregation with the cross-source leak guard (see Security). |
| `src/github/metadata.ts`  | Reads `metadata/repos.yaml` from `fro-bot/.github` `data` branch; exports `redactedNodeIds` denylist. |
| `src/session.ts`          | Signed-cookie session manager (HMAC-SHA256, ≥32-byte key, `timingSafeEqual`). |
| `src/secrets.ts`          | Secret readers (mirrors the gateway's `readSecret`/`readMultilineSecret`). |
| `src/logger.ts`           | `Logger` + `redactSensitiveFields` + `sanitizeErrorMessage` (mirrors runtime). |
| `src/result.ts`           | Hand-rolled `Result<T,E>` (`ok`/`err`/`isOk`/`isErr`). |

The `buildDashboardApp(opts?)` / `createDashboardServer()` split, the `Result<T,E>` shape, the `Logger` + `redactSensitiveFields` helpers, and the `readSecret` pattern are all deliberately mirrored from [[fro-bot--agent]]'s `packages/gateway` and `packages/runtime` for a **deferred `@fro.bot/runtime` extraction seam**. The clone-dep manifest (`.slim/clonedeps.json`) pins both packages at `fro-bot/agent@main` as read-only inspection sources under `.slim/clonedeps/repos/`.

## Security Model

Security is the dominant design constraint; `AGENTS.md` and per-module docstrings encode hard invariants.

### Read-only by construction

Every GitHub App installation token is minted with an explicit read-only `permissions` subset **at mint time** (`pull_requests`/`checks`/`issues`/`contents`/`metadata: read`, with `security_events`/`vulnerability_alerts: read` optional + graceful). This makes the Agent App's *registered* permissions irrelevant to effective access — the dashboard cannot write even if the App could. "Never add a write code path."

### Redaction preservation (denylist-before-query + fail-closed)

`src/github/metadata.ts` reads `metadata/repos.yaml` from the `fro-bot/.github` `data` branch and exports `redactedNodeIds` — the node_ids of `[REDACTED]` / `private:true` entries. Only the node_id is retained; a redacted entry's owner/name is never stored, logged, or returned. The aggregator enforces two rules:

1. **DENYLIST-BEFORE-QUERY** — the working set is filtered against `redactedNodeIds` *before* any per-repo GraphQL query is issued. A query against a redacted private repo is itself an observable leak signal, so it must never happen.
2. **FAIL-CLOSED** — if the data-branch read fails (`err(...)`), the aggregator MUST NOT build a fresh union of installation-discovered repos against an incomplete denylist. Instead it serves last-good cache + a stale banner, or empty state on cold start. The GraphQL client is never called for installation-only repos when the denylist is unavailable.

The metadata reader's error taxonomy is exhaustive and all-`err` (nothing throws): `MetadataUnavailableError` (404/data-branch missing, warning), `MetadataParseError` (malformed YAML, error), `MetadataSchemaError` (wrong schema version — fail closed), `MetadataTransportError` (reader rejects). The metadata-vs-installation cardinality gap is reported only as a `driftCount` number — never by repo identity.

This is the dashboard's direct enforcement of the wiki's **public-only invariant** ([[fro-bot--agent]], `knowledge/schema.md`): the same `metadata/repos.yaml` redaction list that gates wiki promotion gates this live UI.

### Auth & session hardening

- **Single-operator allowlist** — OAuth callback issues a session only for an exact (case-sensitive) operator login; non-allowlisted logins get 403.
- **CSRF** — OAuth state cookie is HttpOnly/Secure/SameSite=Lax, ~10 min TTL, path=`/auth`; state mismatch → 403. Logout is a POST with an HMAC-derived double-submit token (`HMAC-SHA256(cookieKey, login + ':logout')`, truncated, verified with `timingSafeEqual`).
- **Signed sessions** — cookie format `<base64url(json)>.<base64url(hmac-sha256)>`; HMAC covers the encoded payload so `exp` is always signed; key must be ≥32 bytes (constructor throws otherwise); `exp` checked *after* signature verification (fail-closed order); `timingSafeEqual` comparison.
- **Auth middleware** protects every route except `/api/healthz` (public health) and `/auth/*` (login/callback/logout).
- **No secrets in source** — `*.pem`/`*.key` gitignored in-repo (not just machine-global); never commit the App private key or cookie key. Tokens never logged (`redactSensitiveFields` covers `token`/`access_token`).
- **SSR escaping** — all dynamic values auto-escaped via `hono/html`; `node_id` is never rendered as user-facing identity; drift is a number only.

## Node 24 Strip-Only Discipline

The repo runs `.ts` directly under Node 24's strip-only TypeScript execution, which only erases type annotations — it does **not** transform TS-specific constructs. Conventions (enforced by `eslint-plugin-erasable-syntax-only`):

- No `enum`, `namespace`, parameter properties, or TS import aliases.
- `import` paths carry the `.ts` extension.
- Boundary casts use `as unknown as X`; never `any` (Octokit casts).
- `Result<T,E>` error-return shape for the app client.

Because neither `tsc --noEmit` nor Vitest exercises the strip-only parser, CI adds a dedicated **Test Scripts Load** job that `import()`s every `src/**/*.ts` (excluding `*.test.ts`) under Node to catch strip-only failures at merge time. The daily Fro Bot pass runs the same load check.

## CI Pipeline

Two workflows. All third-party actions are SHA-pinned with version comments.

### `main.yaml` (CI)

Triggered on PR to `main` + push to `main` + dispatch. `contents: read` only, `bash -Eeuo pipefail` default shell. Four jobs, each using `./.github/actions/setup`:

| Job                 | Command                                     |
| ------------------- | ------------------------------------------- |
| Lint                | `pnpm lint`                                 |
| Check Types         | `pnpm check-types` (`tsc --noEmit`)         |
| Test                | `pnpm test` (`vitest run`)                  |
| Test Scripts Load   | `import()` each `src/**/*.ts` under Node strip-only |

The composite `./.github/actions/setup` installs pnpm (`pnpm/action-setup@v4`), Node 24 with pnpm cache (`actions/setup-node@v4`), restores a month-scoped pnpm store cache, and runs `pnpm install --frozen-lockfile`.

### `fro-bot.yaml` (self-hosted agent)

Present and self-hosted, pinned to **`fro-bot/agent@854072f` (v0.64.0)** — the newest agent pin seen in the surveyed ecosystem as of this date (ahead of [[fro-bot--agent]]'s own last-surveyed v0.63.0). Single three-mode job: PR review (`pull_request`), mention/issue triage (`issue_comment`, `pull_request_review_comment`, `issues`), and a daily schedule (`0 0 * * *`, midnight UTC) + manual dispatch.

- **Checkout pins to the default/workflow ref, never PR-head code**, with an explicit comment: on `issue_comment` the fork guard can't see PR fork status, so checking out `refs/pull/<n>/head` would run fork-controlled code with `FRO_BOT_PAT` present — default checkout closes that secret-exfiltration vector. Fork/bot/`fro-bot`-author guards gate the job; comment triggers require `@fro-bot` + `OWNER`/`MEMBER`/`COLLABORATOR` association.
- **`PR_REVIEW_PROMPT`** — skeptical single-pass reviewer; security-first (prefer false positives); explicitly forbids invoking `ce:review`/`ce:*` heavy multi-agent skills; fixed verdict template (PASS/CONDITIONAL/REJECT + blocking/non-blocking/missing-tests/risk).
- **`SCHEDULE_PROMPT`** — combined daily oversight + autohealing pass with six ordered categories (Errored PRs, Security, Code Quality, Workflow Integrity, Progressive Improvement, Cross-Project Intelligence), one perpetual "Daily Fro Bot Report — YYYY-MM-DD (UTC)" summary issue, hard no-write-to-main / no-merge / no-force-push boundaries, and Renovate-owns-version-bumps dependency policy. The Code Quality category re-runs the strip-only load check inline.

## Dependencies

| Package                       | Version  | Purpose                                  |
| ----------------------------- | -------- | ---------------------------------------- |
| `hono`                        | ^4.7.11  | Web framework / SSR (`hono/html`)        |
| `@hono/node-server`           | ^1.14.4  | Node adapter                             |
| `@octokit/core`               | 7.0.6    | GitHub REST/GraphQL client core          |
| `@octokit/auth-app`           | 8.2.0    | GitHub App / installation auth           |
| `@octokit/graphql`            | 9.0.3    | Per-installation GraphQL queries         |
| `@octokit/plugin-retry`       | 8.1.0    | Retry on transient failures              |
| `@octokit/plugin-throttling`  | 11.0.3   | Rate-limit handling                      |
| `arctic`                      | 3.7.0    | GitHub OAuth (operator login)            |
| `yaml`                        | 2.9.0    | Parse `metadata/repos.yaml`              |
| `@bfra.me/es`                 | 0.1.0    | Shared ES utilities                      |

Dev: `@bfra.me/eslint-config` 0.51.0, `@bfra.me/tsconfig` 0.13.0, `eslint` 10.4.0, `eslint-plugin-erasable-syntax-only` 0.4.0, `typescript` 6.0.3, `vitest` 4.1.4, `jiti` 2.7.0, `@types/node` 24.12.0. The `@bfra.me/*` toolchain comes from [[bfra-me--works]].

`pnpm-workspace.yaml`: `shamefullyHoist: true`, `onlyBuiltDependencies`/`allowBuilds` limited to `unrs-resolver`.

## Deployment

`Dockerfile` — `node:24-slim` (digest-pinned), corepack-activated pnpm 11.5.0, `pnpm install --frozen-lockfile --prod`, non-root `dashboard` user (uid/gid 1001) for `read_only`-friendly operation, `EXPOSE 3000`, `CMD ["node", "src/server.ts"]` (no build artifact — runs source directly). The server binds `127.0.0.1:3000`, expecting an external TLS-terminating reverse proxy.

## Renovate Configuration

`.github/renovate.json5` extends `github>fro-bot/.github` — the org-wide Renovate baseline (ultimately the [[marcusrbrown--renovate-config]] preset chain). Dependency/version bumps are Renovate-owned; the daily Fro Bot pass only touches deps for confirmed critical/high security advisories.

## Ecosystem Role

The dashboard is the **read-only observability layer** over the Fro Bot fleet. It is downstream of [[fro-bot--agent]] in two ways: (1) it consumes the Agent App's installations to discover repos, and (2) it mirrors the gateway/runtime primitives (`Result<T,E>`, `Logger`, secret readers, app-factory/serve split, read-only `installAuth` pattern) as the staging ground for a future shared `@fro.bot/runtime` package. It is a sibling to the Discord gateway in [[marcusrbrown--infra]]: both are long-running Hono services in the Fro Bot operational stack, one a control plane (gateway), this one a read-only view plane.

It also enforces the same redaction contract that governs this knowledge wiki: `metadata/repos.yaml`'s denylist is the single source of truth for which repos stay private, used here to gate live queries and elsewhere to gate wiki promotion.

## Fro Bot Workflow Status

**Present and self-hosted.** `fro-bot.yaml` pins `fro-bot/agent@854072f` (v0.64.0) with full three-mode coverage (PR review, mention/issue triage, daily midnight-UTC oversight+autohealing, manual dispatch). No follow-up workflow draft is needed.

## Survey History

| Date       | SHA       | Key changes                                                                 |
| ---------- | --------- | -------------------------------------------------------------------------- |
| 2026-06-15 | `2504939` | Initial survey. New repo (created 2026-06-14): read-only Fro Bot monitoring dashboard. Hono + Node 24 strip-only TS, no build step. Read-only-by-construction GitHub App tokens; denylist-before-query + fail-closed redaction reading `fro-bot/.github` `data` branch `metadata/repos.yaml`; single-operator OAuth (Arctic) + signed-cookie sessions + CSRF logout. CI: lint/check-types/test/strip-only-load. Self-hosted `fro-bot.yaml` at agent **v0.64.0** (ecosystem version leader). Mirrors gateway/runtime primitives for a deferred `@fro.bot/runtime` extraction. |
