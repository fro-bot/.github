---
type: repo
title: "fro-bot/dashboard"
created: 2026-06-15
updated: 2026-07-23
sources:
  - url: https://github.com/fro-bot/dashboard
    sha: 250493945add33e30cf25ec890d7d1b37d31d00e
    accessed: 2026-06-15
  - url: https://github.com/fro-bot/dashboard
    sha: 5c631a5589b405d3e7d704c08db9e455630dbabf
    accessed: 2026-06-26
  - url: https://github.com/fro-bot/dashboard
    sha: cb5190d259e68b26b7102d86b2e2ec53a731b3fb
    accessed: 2026-07-09
  - url: https://github.com/fro-bot/dashboard
    sha: 58f9634fe7b9b7a9bf63c241944b1fc532203207
    accessed: 2026-07-23
tags: [typescript, hono, node24, native-typescript, strip-only, pnpm, github-app, oauth, octokit, arctic, monitoring, dashboard, read-only, ssr, spa, react, vite, tailwind, pwa, workbox, calver, ghcr, impeccable, fro-bot, redaction, fail-closed, security, operator-contract, sse, control-plane, fixture-harness, opencode-plugin, design-tokens]
related:
  - fro-bot--agent
  - marcusrbrown--infra
  - bfra-me--works
---

# fro-bot/dashboard

Read-only Fro Bot monitoring dashboard. A Hono Node 24 backend that surfaces live cross-repo status — open PRs + CI state, failing checks, open issues, security alerts — for Fro Bot's collaborator repos and Agent App installations in one glanceable, single-operator view. As of the 2026-06-26 survey it ships a **React 19 + Vite + Tailwind PWA single-page app** (`web/`) served alongside the original Hono SSR shell; the README tagline shifted from "monitoring dashboard" to **"Command center for Fro Bot operations."** By the 2026-07-09 survey the "command center" framing is realized: the SPA hosts an **operator control surface** — live SSE-streamed agent-run views with approval and cancellation — over a vendored operator-contract barrel (v1.6.0). The dashboard stays read-only *toward GitHub App data*, but the operator surface now proxies control actions to the [[fro-bot--agent]] gateway.

The repo is the implementation of the Phase 1 plan tracked in [[fro-bot--agent]]'s parent org repo (`fro-bot/.github` `docs/plans/2026-06-15-001-feat-monitoring-dashboard-phase-1-plan.md`). Created 2026-06-14; `package.json` version stays `0.0.0` (`private: true`), but the repo ships **CalVer-tagged GHCR releases** (latest `2026.07.31` @ 2026-07-23; was `2026.07.12` @ 2026-07-09, 58 releases; `2026.06.50` @ 2026-06-26, 30) via a dedicated `release.yaml` pipeline — see Release Pipeline below.

By the **2026-07-23 survey** (HEAD `58f9634`) the notable structural shift is the **Impeccable design gate going in-repo**: the UI anti-pattern detector, previously invoked as a bare `npx impeccable` in CI, is now vendored both as a skill (`.agents/skills/impeccable/`) and as a first-class **OpenCode plugin** (`.opencode/impeccable/` — `plugin.ts` + `hook-bridge.ts` + `plugin.test.ts`), with a dedicated `.opencode/tsconfig.json` folded into `check-types` and a versioned `@opencode-ai/plugin` devDep. A new `assets/` brand-token system (`banner.svg`, `styleguide.md`, `tokens.css`) supplies the intentional design vocabulary the gate reads. Agent pin advanced **v0.84.2 → v0.94.2** (still ecosystem leader). `@hono/node-server` took a **major bump `^1.14.4 → ^2.0.0`**. The operator control surface, vendored contract (`1.6.0`), and fixture harness are unchanged in shape from 2026-07-09.

## Overview

| Attribute       | Value                                                            |
| --------------- | --------------------------------------------------------------- |
| Created         | 2026-06-14                                                      |
| Last push       | 2026-07-23 (survey 2026-07-23, HEAD `58f9634`; prior `cb5190d` @ 2026-07-09, `5c631a5` @ 2026-06-26, `2504939` @ 2026-06-15) |
| Language        | TypeScript (Node 24 native TS, **strip-only** for `src/`/`test/`/scripts, ESM) |
| Package manager | pnpm 11.15.1 (was 11.10.0 → 11.8.0 → 11.5.0)                    |
| Node.js         | `>=24` (engines)                                                |
| Backend build   | **None** — `src/` runs `.ts` directly via Node 24 strip-only execution |
| Frontend build  | **Vite 8** — `web/` React SPA built with `pnpm build:web` (output `web/dist/` baked into image); `build:web:fixture` variant for the fixture harness |
| Backend framework | Hono ^4.7.11 + `@hono/node-server` **^2.0.0** (major bump from ^1.14.4) (SSR shell + API + operator proxy) |
| Frontend stack  | React 19.2.7 + react-dom, Tailwind CSS 4.3.3 (`@tailwindcss/vite`), Vite 8.1.5, `@vitejs/plugin-react-swc` 4.3.1, PWA via `vite-plugin-pwa` 1.3.0 + Workbox 7.4.1 |
| Auth library    | Arctic 3.7.0 (GitHub OAuth) — flagged abandoned by Renovate (last release 2025-05-21) |
| GitHub client   | `@octokit/core` 7.0.6, `@octokit/auth-app` 8.2.0, `@octokit/graphql` 9.0.3, retry + throttling plugins |
| Test framework  | Vitest 4.1.10; `@testing-library/react` 16.3.2 + `jest-dom` 6.9.1 + jsdom 29.1.1 for the SPA |
| Lint            | ESLint 10.7.0 (`@bfra.me/eslint-config` 0.51.1) + `eslint-plugin-erasable-syntax-only` 0.4.0; `impeccable` UI anti-pattern detector (Design Check, CI-pinned `impeccable@3.2.1`) |
| TypeScript      | 6.0.3 (`@bfra.me/tsconfig` 0.13.1) — Renovate flags v7 available (held) |
| OpenCode plugin | `@opencode-ai/plugin` 1.18.3 (drives the in-repo Impeccable design-lint plugin at `.opencode/impeccable/`) |
| Visibility      | Public                                                          |
| Stars           | 1                                                              |
| License         | None declared                                                  |
| Releases        | **CalVer (`YYYY.MM.N`)** — latest `2026.07.31` (2026-07-23, digest `sha256:dfac1684…`); GHCR image only, `package.json` version stays `0.0.0` |

## Purpose

This is the read-only observability surface for Fro Bot's footprint. It authenticates a single operator (Marcus) via GitHub OAuth, enumerates the Fro Bot Agent App's installations, mints **read-only** installation tokens, and aggregates per-repo signals into a glanceable SSR page plus a JSON API. It writes nothing back to GitHub.

## Architecture

**Two-tier as of 2026-06-26:** a Hono Node 24 backend (`src/`, no build step) that serves a JSON API + SSR shell, plus a **Vite-built React SPA** (`web/`) baked into the deployed image. The 2026-06-15 page described a single SSR-only Hono process; that remains the backend, but the operator UI is now a client-side React PWA mounted by the shell. The backend `src/` layout:

| Path                      | Responsibility                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/server.ts`           | App factory (`buildDashboardApp`) + server binding (`createDashboardServer`, binds `127.0.0.1:3000`). Wires middleware, OAuth, aggregator, routers. |
| `src/routes/dashboard.ts` | SSR route using `hono/html` tagged templates (no JSX, no build step). Auto-escaped output; logout is a POST form with CSRF token. |
| `src/routes/api.ts`       | JSON API — `GET /api/healthz` (`{ok, lastFetch, rateLimit}`, now includes `contractVersion`), `GET /api/status` (full internal snapshot), and `GET /api/monitoring` (minimized client snapshot, new 2026-07-09). Injectable `SnapshotProvider`. |
| `src/routes/auth.ts`      | OAuth routes `/auth/login`, `/auth/callback`, `/auth/logout`. CSRF state cookie, operator allowlist, HMAC double-submit logout token. |
| `src/routes/operator.ts`  | Operator-surface routes backing the SPA (new 2026-06-26): run launch/index/status, approval, and SSE run-stream proxy to the gateway. |
| `src/routes/operator-fixture-harness.ts` | Fixture-mode operator routes (new 2026-07-09) — deterministic in-process operator backend for `dev:fixture` + Vitest, gated behind `DASHBOARD_FIXTURE_HARNESS_ENABLED`. Never enabled in production. |
| `src/gateway/`            | Operator client layer (new 2026-06-26, expanded 2026-07-09): `operator-client`, `operator-config`, `operator-copy`, `operator-server-fetch`, `operator-sse-reader`, `operator-fixtures` + `operator-fixture-config`/`operator-fixture-routes`/`operator-fixture-sse`, and the vendored `operator-contract/` barrel. Mirrors/consumes [[fro-bot--agent]]'s gateway operator API contract (see [[fro-bot--agent]] "Operator Web Surface"). |
| `src/auth/oauth.ts`       | Arctic v3 GitHub OAuth client wrapped behind a testable `GitHubOAuthClient` seam. |
| `src/github/installations.ts` | Enumerate Agent App installations, mint read-only tokens, enumerate repos. |
| `src/github/app-client.ts`| GitHub App client (`installAuth` read-only permissions pattern). |
| `src/github/aggregator.ts`| Per-repo signal aggregation with the cross-source leak guard (see Security). |
| `src/github/metadata.ts`  | Reads `metadata/repos.yaml` from `fro-bot/.github` `data` branch; exports `redactedNodeIds` denylist. |
| `src/session.ts`          | Signed-cookie session manager (HMAC-SHA256, ≥32-byte key, `timingSafeEqual`). |
| `src/secrets.ts`          | Secret readers (mirrors the gateway's `readSecret`/`readMultilineSecret`). |
| `src/logger.ts`           | `Logger` + `redactSensitiveFields` + `sanitizeErrorMessage` (mirrors runtime). |
| `src/result.ts`           | Hand-rolled `Result<T,E>` (`ok`/`err`/`isOk`/`isErr`). |

The `buildDashboardApp(opts?)` / `createDashboardServer()` split, the `Result<T,E>` shape, the `Logger` + `redactSensitiveFields` helpers, and the `readSecret` pattern are all deliberately mirrored from [[fro-bot--agent]]'s `packages/gateway` and `packages/runtime` for a **deferred `@fro.bot/runtime` extraction seam**. The clone-dep manifest (`.slim/clonedeps.json`) pins both `@fro-bot/gateway` and `@fro-bot/runtime` at **`fro-bot/agent@v0.78.0`** (was `@main`) as read-only inspection sources under `.slim/clonedeps/repos/fro-bot__agent/`. Note the widening pin-vs-runtime skew as of 2026-07-23: the clonedeps + vendored contract stay frozen at agent **v0.78.0** (contract `1.6.0`, unchanged since 2026-07-09), while `fro-bot.yaml` now runs the agent action at **v0.94.2** (up from v0.84.2). The inspection source is intentionally frozen at the last contract-refresh point, not chased to every action bump — the skew is by design, not drift.

### React SPA frontend (`web/`, new 2026-06-26)

A Vite-built single-page PWA layered over the Hono backend. Top-level: `web/index.html`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/tsconfig.json`, `web/public/`. `web/src/` contains `main.tsx` + `App.tsx` (with `App.test.tsx`), `index.css` + a `styles/` dir (Tailwind 4), `shell/AppShell.tsx`, `views/Operator.tsx`, an **operator client-state layer** `operator/` (`runtime.ts`, `state.ts`, `copy.ts`, `validate-dynamic-id.ts`, `fixture-prefix.ts`, `fixture-runtime-loader.ts` — each with a colocated `.test.ts`, plus a `no-server-imports.test.ts` guard that keeps server modules out of the client bundle), `manifest.test.ts`, `test-setup.ts`, and a **service-worker layer** (`sw.ts`, `pwa/`, `pwa.d.ts`, with `sw.test.ts`). `check-types` type-checks both the root `tsconfig.json` and `web/tsconfig.json`. `pretest` runs `build:web` first, so the test job builds the SPA before Vitest runs. The built `web/dist/` is baked into the release image (the release smoke test asserts `/manifest.webmanifest` is served pre-auth).

New top-level docs/config accompany the SPA: `DESIGN.md` and `PRODUCT.md` (product/design intent), and `.impeccable/config.json` driving the `impeccable` UI anti-pattern detector wired into CI.

### Impeccable design gate — in-repo skill + OpenCode plugin (matured 2026-07-23)

Through 2026-07-09 the Impeccable UI anti-pattern detector was invoked as a bare `npx impeccable detect` in the CI **Design Check** job. By 2026-07-23 it is **vendored in-repo in two forms**, converging the dashboard's design-gate posture with [[marcusrbrown--mothership]] and the OMO-slim `designer`/`fixer` agents in [[marcusrbrown--dotfiles]]:

- **Skill:** `.agents/skills/impeccable/` — the full Impeccable skill bundle (`SKILL.md`, `agents/`, `reference/` playbooks, and a large `scripts/` detector/live-editing toolchain). This is the same skill family that [[marcusrbrown--mothership]] installs at `.agents/skills/impeccable/`.
- **OpenCode plugin:** `.opencode/impeccable/` — `plugin.ts` (registers the design-lint hook), `hook-bridge.ts` (bridges OpenCode's edit hook to the detector subprocess with a fail-soft `withTimeout` race — see issue #193), and `plugin.test.ts`. A dedicated `.opencode/tsconfig.json` is now folded into `pnpm check-types` (so `check-types` type-checks root + `web/` + `.opencode/`), and `@opencode-ai/plugin` 1.18.3 is a devDep. Additional wiring: `.codex/hooks.json`, `.github/hooks/impeccable.json`, and a captured critique under `.impeccable/critique/`.
- **Brand tokens:** a new top-level `assets/` supplies the intentional design vocabulary the detector reads: `tokens.css` (design tokens seed), `styleguide.md`, and `banner.svg` (README banner). Intentional brand tokens are allowlisted via `.impeccable/config.json` `ignoreValues` rather than rule-wide disables — the same discipline as [[marcusrbrown--mothership]].

The CI Design Check now pins the detector to **`impeccable@3.2.1`** with an explicit comment: an older major ignores `.impeccable/config.json` `ignoreValues` and would fail the gate on intentional brand tokens. (The Renovate dashboard reports a spurious lookup failure for the `--yes impeccable` regex-managed pin — cosmetic, not a real advisory.)

### Operator control surface & vendored contract (`src/gateway/operator-contract/`, matured 2026-07-09)

The 2026-06-26 survey noted a nascent `operator-contract/` dir; by 2026-07-09 it is a **fully vendored, versioned type barrel** — the dashboard's half of the [[fro-bot--agent]] gateway operator API. Files: `version.ts` (pins `OPERATOR_CONTRACT_VERSION = '1.6.0'`, build-time pinned, never wire-negotiated, fail-closed on unrecognized versions), `run-status.ts`, `run-summary.ts`, `approval.ts`, `approval-frame.ts`, `identity.ts`, `output.ts`, `parse.ts`, `redaction.ts`, `repo-summary.ts`, `responses.ts`, `sse-frames.ts`, `index.ts`, plus a `README.md` documenting provenance.

**Provenance discipline** (from the contract `README.md`): the barrel is *vendored* from `fro-bot/agent` `packages/gateway/src/operator-contract/` + `packages/gateway/src/web/sse/` at **tag v0.78.0** — do not hand-edit behavior; refresh by re-copying and re-applying documented import rewrites (`@fro-bot/runtime` → `../../result.ts`; inline boundary types for `RunPhase`/`Surface`/`RunState`). `sse-frames.ts` is a parallel surface (`ReadyFrame`/`StatusFrameData`/`ResetFrameData`/`RunStreamFrame`/`ResetReason`), not part of the upstream barrel, re-exported for convenience. `repo-summary.ts` is locally authored (upstream added `RepoSummary` at v0.73.0 with no parse helper). Upstream helpers depending on upstream-only types (`toOperatorDecisionState`, `toOperatorRunStatus`, `DecisionInput`) are deliberately omitted; all PUBLIC frozen types are present. NOTE: the contract `README.md` still says `Contract: 1.5.0` while `version.ts` pins `1.6.0` — a **stale-header drift** worth a follow-up.

The operator surface streams live agent runs over **SSE** (`operator-sse-reader` client + `sse-frames` types), supports **approvals** (`approval`/`approval-frame`) and **run cancellation** (open issue #179 tracks cancellation + sanitized failure-reason at contract 1.6.0). This makes the dashboard a *view-plane over GitHub data* but a *control-plane proxy toward the gateway's run lifecycle* — it never writes to GitHub, but it can launch/approve/cancel agent runs via the gateway.

### Fixture harness (new 2026-07-09)

A deterministic operator backend for offline dev + tests, gated behind env flags so it can never surface in production. `pnpm dev:fixture` builds `web/dist-fixture` (via `build:web:fixture`, `VITE_FIXTURE_MODE=true`) and runs the server with `DASHBOARD_FIXTURE_HARNESS_ENABLED=true` + `DASHBOARD_DEV_AUTOLOGIN=true` on `127.0.0.1`. Backend: `src/routes/operator-fixture-harness.ts` + `src/gateway/operator-fixture-*`; client: `web/src/operator/fixture-*`. Tests assert both the harness behavior (`test/operator-fixture-harness.test.ts`) and its **sanitization** (`test/operator-fixture-sanitization.test.ts`) — the fixture data path is held to the same redaction bar as live. This is the offline analog of the gateway's own fixture flows and lets the operator UI be exercised without live App credentials.

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

The repo runs `.ts` directly under Node 24's strip-only TypeScript execution, which only erases type annotations — it does **not** transform TS-specific constructs. Server tests now live in a dedicated top-level `test/` dir (extracted from `src/` colocation by 2026-07-09), covering the aggregator, auth, sessions, installations, metadata, server, static assets, the release scripts, and the full operator surface (client, config, contract conformance, copy, fixture harness/sanitization, launch, run-index, runtime, route redirect, SSE reader, stream, UI). The `web/` client keeps its own colocated `.test.ts(x)` under Vitest+jsdom. Conventions (enforced by `eslint-plugin-erasable-syntax-only`):

- No `enum`, `namespace`, parameter properties, or TS import aliases.
- `import` paths carry the `.ts` extension.
- Boundary casts use `as unknown as X`; never `any` (Octokit casts).
- `Result<T,E>` error-return shape for the app client.

Because neither `tsc --noEmit` nor Vitest exercises the strip-only parser, CI adds a dedicated **Test Scripts Load** job that `import()`s every `src/**/*.ts` (excluding `*.test.ts`) under Node to catch strip-only failures at merge time. The daily Fro Bot pass runs the same load check.

## CI Pipeline

**Three workflows** (`main.yaml`, `fro-bot.yaml`, `release.yaml`) — unchanged in count as of 2026-07-23. All third-party actions are SHA-pinned with version comments. `main.yaml` still runs six jobs and `release.yaml`'s four-job CalVer chain is intact. The 2026-07-23 churn is the agent pin bump (v0.84.2 → v0.94.2), the Design Check job now pinning `impeccable@3.2.1` (was a floating `npx impeccable`), and dependency bumps; workflow structure is otherwise stable.

### `main.yaml` (CI)

Triggered on PR to `main` + push to `main` + dispatch. `contents: read` only, `bash -Eeuo pipefail` default shell. **Six jobs** (was four), each using `./.github/actions/setup` except Check Workflows:

| Job                 | Command                                     |
| ------------------- | ------------------------------------------- |
| Lint                | `pnpm lint`                                 |
| Design Check        | `npx --yes impeccable@3.2.1 detect --json web/src` — fails on any UI anti-pattern unless a scoped ignore is added via `impeccable ignores add-value`; CI-pinned to `3.2.1` (an older major ignores `.impeccable/config.json` `ignoreValues`) (new 2026-06-26, pinned 2026-07-23) |
| Check Types         | `pnpm check-types` (`tsc --noEmit` for both root + `web/tsconfig.json`) |
| Test                | `pnpm build:web` then `pnpm test` (`vitest run`) — SPA built before tests |
| Check Workflows     | `raven-actions/actionlint` (new 2026-06-26) |
| Test Scripts Load   | `import()` each `src/**/*.ts` under Node strip-only |

The composite `./.github/actions/setup` installs pnpm (`pnpm/action-setup`), Node 24 with pnpm cache (`actions/setup-node`), restores a month-scoped pnpm store cache, and runs `pnpm install --frozen-lockfile`.

### `release.yaml` (CalVer GHCR release + infra deploy dispatch, new 2026-06-26)

Push-to-`main` (path-filtered to source/Dockerfile/manifests/release scripts) + dispatch. `contents: read` default; `bash -Eeuo pipefail`. Four-job chain:

1. **Release guard** — `scripts/should-release.ts` evaluates the changed-file range + a `package.json` diff (base vs head) to decide whether a release is warranted; dispatch only releases from `main`.
2. **Release** — mints a `fro-bot[bot]` App token (`actions/create-github-app-token`) so the tag + GitHub Release are authored by the App identity. Builds + pushes a **candidate** image to GHCR (`ci-<run>-<attempt>`), then **smoke-tests by digest**: host-port `/api/healthz` poll (catches `127.0.0.1`-bind regressions), sibling-container reachability by service name (catches a 127.0.0.1-only bind that would 502 behind Caddy), SPA `/manifest.webmanifest` served (confirms `web/dist/` baked in), and a **CSP header check** (`script-src 'self'` present). Computes a CalVer tag via `scripts/compute-release-tag.ts` (race-retried tag push), promotes the candidate digest to `<calver>` / `latest` / `sha-<short>` via `buildx imagetools` with digest-equality verification, and creates the GitHub Release with an appended Image block (tag + digest + source SHA). Failure cleanup deletes the tag + partial release.
3. **Dispatch infra deploy** (`environment: release`, whole-job `continue-on-error`) — best-effort: validates the CalVer + sha256 digest, mints a **separate** short-lived token from an infra-dispatch App scoped to `marcusrbrown/infra` + `actions:write`, and `gh workflow run deploy-dashboard.yaml` in [[marcusrbrown--infra]] with `version` + `digest`. This only reaches infra's operator-approval gate — it cannot bypass it. Issue #112 tracks migrating this dispatch to a dedicated infra-only App; the dispatch key is `environment: release`-scoped as the primary mitigation.

GHCR push uses `GITHUB_TOKEN` (App installation tokens can't push to GHCR); the App token is reserved for the identity-sensitive tag push + Release.

### `fro-bot.yaml` (self-hosted agent)

Present and self-hosted, pinned to **`fro-bot/agent@64029d5` (v0.94.2)** as of 2026-07-23 (was `99e7d85` / v0.84.2 @ 2026-07-09, `f51adbd` / v0.77.0 @ 2026-06-26, `854072f` / v0.64.0 @ 2026-06-15) — still the newest agent pin seen in the surveyed ecosystem. Single three-mode job: PR review (`pull_request`), mention/issue triage (`issue_comment`, `pull_request_review_comment`, `issues`), and a daily schedule (`0 0 * * *`, midnight UTC) + manual dispatch (with an optional custom-`prompt` dispatch input).

- **Concurrency reworked (2026-07-09):** the group key now uses the **PR head SHA** for `pull_request` events (`fro-bot-<head.sha>`) so each push gets its own slot; the prior PR-number key shared one group across every PR event, dropping a push that landed while an earlier run for the same PR was in-flight (one pending run per group, `cancel-in-progress: false`). Non-PR events (review comments, issues) keep their own keys; schedule/dispatch collapse onto a `daily` key.
- **Checkout pins to the default/workflow ref, never PR-head code**, with an explicit comment: on `issue_comment` the fork guard can't see PR fork status, so checking out `refs/pull/<n>/head` would run fork-controlled code with `FRO_BOT_PAT` present — default checkout closes that secret-exfiltration vector. Fork/bot/`fro-bot`-author guards gate the job; comment triggers require `@fro-bot` + `OWNER`/`MEMBER`/`COLLABORATOR` association.
- **`PR_REVIEW_PROMPT`** — skeptical single-pass reviewer; security-first (prefer false positives); explicitly forbids invoking `ce:review`/`ce:*` heavy multi-agent skills; fixed verdict template (PASS/CONDITIONAL/REJECT + blocking/non-blocking/missing-tests/risk).
- **`SCHEDULE_PROMPT`** — combined daily oversight + autohealing pass with six ordered categories (Errored PRs, Security, Code Quality, Workflow Integrity, Progressive Improvement, Cross-Project Intelligence), one perpetual "Daily Fro Bot Report — YYYY-MM-DD (UTC)" summary issue, hard no-write-to-main / no-merge / no-force-push boundaries, and Renovate-owns-version-bumps dependency policy. The Code Quality category re-runs the strip-only load check inline.

## Dependencies

| Package                       | Version  | Purpose                                  |
| ----------------------------- | -------- | ---------------------------------------- |
| `hono`                        | ^4.7.11  | Web framework / SSR (`hono/html`)        |
| `@hono/node-server`           | **^2.0.0** | Node adapter (major bump from ^1.14.4) |
| `@octokit/core`               | 7.0.6    | GitHub REST/GraphQL client core          |
| `@octokit/auth-app`           | 8.2.0    | GitHub App / installation auth           |
| `@octokit/graphql`            | 9.0.3    | Per-installation GraphQL queries         |
| `@octokit/plugin-retry`       | 8.1.0    | Retry on transient failures              |
| `@octokit/plugin-throttling`  | 11.0.3   | Rate-limit handling                      |
| `arctic`                      | 3.7.0    | GitHub OAuth (operator login)            |
| `yaml`                        | 2.9.0    | Parse `metadata/repos.yaml`              |
| `@bfra.me/es`                 | 0.1.0    | Shared ES utilities                      |

Runtime deps are unchanged from 2026-06-15 through 2026-07-23 **except** `@hono/node-server`, which took a major bump `^1.14.4 → ^2.0.0` (resolving to 2.0.10). The frontend/dev toolchain is bumped as of 2026-07-23: `react`/`react-dom` 19.2.7, `tailwindcss` + `@tailwindcss/vite` **4.3.3** (was 4.3.2), `vite` **8.1.5** (was 8.1.3), `@vitejs/plugin-react-swc` 4.3.1, `vite-plugin-pwa` 1.3.0 + `workbox-*` 7.4.1 (exact-pinned across build/core/precaching/routing/strategies/expiration/cacheable-response/window), `@testing-library/react` 16.3.2 / `jest-dom` 6.9.1 / `jsdom` 29.1.1, `@types/react` 19.2.17 / `@types/react-dom` 19.2.3. Other dev: `@bfra.me/eslint-config` 0.51.1, `@bfra.me/tsconfig` 0.13.1, `eslint` **10.7.0** (was 10.6.0), `eslint-plugin-erasable-syntax-only` 0.4.0, `typescript` 6.0.3 (Renovate flags v7; held), `vitest` **4.1.10** (was 4.1.9), `jiti` 2.7.0, `@types/node` **24.13.3**, and new **`@opencode-ai/plugin` 1.18.3** for the in-repo Impeccable OpenCode plugin. The `@bfra.me/*` toolchain comes from [[bfra-me--works]].

`pnpm-workspace.yaml`: `shamefullyHoist: true`, `allowBuilds` lists `@swc/core: true` + `unrs-resolver: true`. As of 2026-07-23 the daily Fro Bot pass has been repeatedly adding security `overrides` here (`brace-expansion@^2.1.2`/`@^5.0.7`, `fast-uri@^3.1.4`) to remediate four open high-severity **transitive devDependency** Dependabot alerts — but the working-dir-mode fix has not persisted to `main`/a PR across runs (a harness delivery gap, not a repo bug; see Fro Bot Workflow Status).

## Deployment

`Dockerfile` — `node:24-slim` (digest-pinned `sha256:6f7b03f7…`), corepack-activated pnpm, `pnpm install --frozen-lockfile --prod`, non-root `dashboard` user (uid/gid 1001) for `read_only`-friendly operation, `EXPOSE 3000`, `CMD ["node", "src/server.ts"]`. The Vite-built `web/dist/` SPA is baked into the image (release smoke test asserts it is served). The server binds `127.0.0.1:3000`, expecting an external TLS-terminating reverse proxy.

The image is now produced by the in-repo **`release.yaml` CalVer pipeline** (GHCR `ghcr.io/fro-bot/dashboard`, tags `<calver>`/`latest`/`sha-<short>`) rather than an external build, and that pipeline dispatches the gated [[marcusrbrown--infra]] deploy. See CI Pipeline → `release.yaml`.

## Renovate Configuration

`.github/renovate.json5` extends `github>fro-bot/.github` — the org-wide Renovate baseline (ultimately the [[marcusrbrown--renovate-config]] preset chain). Dependency/version bumps are Renovate-owned; the daily Fro Bot pass only touches deps for confirmed critical/high security advisories. The Renovate Dependency Dashboard (#8) as of 2026-07-23 flags a package-lookup warning (the `--yes impeccable` regex-managed CI pin), an abandoned `arctic` (last release 2025-05-21), and held majors (TypeScript v7, `@testing-library/jest-dom` v7, GitHub Actions majors).

## Ecosystem Role

The dashboard is the **read-only observability layer** over the Fro Bot fleet. It is downstream of [[fro-bot--agent]] in two ways: (1) it consumes the Agent App's installations to discover repos, and (2) it mirrors the gateway/runtime primitives (`Result<T,E>`, `Logger`, secret readers, app-factory/serve split, read-only `installAuth` pattern) as the staging ground for a future shared `@fro.bot/runtime` package. It is a sibling to the Discord gateway in [[marcusrbrown--infra]]: both are long-running Hono services in the Fro Bot operational stack, one a control plane (gateway), this one a read-only view plane.

It also enforces the same redaction contract that governs this knowledge wiki: `metadata/repos.yaml`'s denylist is the single source of truth for which repos stay private, used here to gate live queries and elsewhere to gate wiki promotion.

**Deploy surface (confirmed 2026-06-19, pipeline closed 2026-06-26):** the released image is built here and shipped from [[marcusrbrown--infra]]'s `apps/dashboard/` deploy package — a two-service Caddy + dashboard compose stack at `dashboard.fro.bot`, consuming `ghcr.io/fro-bot/dashboard` by tag + digest (no on-droplet build). As of 2026-06-26 the loop is automated: this repo's `release.yaml` builds + smoke-tests the image and **dispatches** infra's `deploy-dashboard.yaml` (gated on operator approval). infra is the operator-facing deploy/runbook home; this repo remains the build/source home.

## Fro Bot Workflow Status

**Present and self-hosted.** `fro-bot.yaml` pins `fro-bot/agent@64029d5` (v0.94.2, ecosystem version leader as of 2026-07-23) with full three-mode coverage (PR review, mention/issue triage, daily midnight-UTC oversight+autohealing, manual dispatch). The daily report issue is live (#243, "Daily Fro Bot Report — 2026-07-23 (UTC)"). No follow-up workflow draft is needed.

**Observed harness-delivery gap (2026-07-23):** the daily report (#243) records that the schedule pass runs in `working-dir` delivery mode (file edits only; the caller workflow owns commit/PR) and that a security remediation — `pnpm-workspace.yaml` `overrides` for four open high-severity transitive-devDep advisories (`brace-expansion`, `fast-uri`) — has been re-applied and verified for **three consecutive days** but never landed on `main` or as a PR. The agent correctly diagnoses this as an orchestration issue in the calling harness (working-dir output not being turned into a commit/PR for this repo's `schedule` trigger), not a bug in the dashboard. Worth flagging to the operator: the same fail-closed working-dir-delivery contract this survey runs under also governs the dashboard's own daily pass, and here it is silently dropping a security fix.

Open issues as of 2026-07-23: **#243 (daily report)**, **#238 (publish public operator push privacy policy — precondition to enabling Web Push; owner-filed)**, **#193 (OpenCode Impeccable plugin: cancel the `hook.mjs` subprocess on timeout instead of leaving it detached; dev-tooling only)**, #112 (dedicated infra-only dispatch App — carried), #8 (Renovate dependency dashboard). Issue #179 (operator run cancellation) is now closed; #108 (deferred PWA push) appears superseded by #238's privacy-policy precondition.

## Survey History

| Date       | SHA       | Key changes                                                                 |
| ---------- | --------- | -------------------------------------------------------------------------- |
| 2026-06-15 | `2504939` | Initial survey. New repo (created 2026-06-14): read-only Fro Bot monitoring dashboard. Hono + Node 24 strip-only TS, no build step. Read-only-by-construction GitHub App tokens; denylist-before-query + fail-closed redaction reading `fro-bot/.github` `data` branch `metadata/repos.yaml`; single-operator OAuth (Arctic) + signed-cookie sessions + CSRF logout. CI: lint/check-types/test/strip-only-load. Self-hosted `fro-bot.yaml` at agent **v0.64.0** (ecosystem version leader). Mirrors gateway/runtime primitives for a deferred `@fro.bot/runtime` extraction. |
| 2026-06-26 | `5c631a5` | Second survey. **Frontend added:** Vite 8 + React 19 + Tailwind 4 **PWA SPA** (`web/`, Workbox service worker) layered over the Hono backend; tagline now "Command center for Fro Bot operations." New `src/gateway/` operator-client layer (`operator-contract/`, SSE reader, server-fetch) consuming agent's operator API; new `src/routes/operator.ts`. **Release pipeline (`release.yaml`):** CalVer (`YYYY.MM.N`) GHCR build → candidate smoke-test (host-port + sibling-container reachability + SPA manifest + CSP header) → digest-verified promote → GitHub Release → best-effort gated dispatch of infra `deploy-dashboard.yaml`; 30 releases, latest `2026.06.50`. CI grew 4 → 6 jobs (added **Design Check** `impeccable` + **Check Workflows** actionlint; Test now builds SPA first). New docs `DESIGN.md`/`PRODUCT.md`, `.impeccable/config.json`. Agent pin **v0.64.0 → v0.77.0** (ecosystem leader). pnpm 11.5.0 → 11.8.0; eslint 10.5.0; vitest 4.1.9; `@bfra.me/*` 0.51.1/0.13.1. First star (0 → 1). Open issues: #113 daily report, #112 (infra-dispatch dedicated App), #108 (deferred PWA push), #8 dependency dashboard. |
| 2026-07-09 | `cb5190d` | Third survey. **Operator control surface matured** — the nascent `operator-contract/` dir is now a fully vendored, versioned barrel (`OPERATOR_CONTRACT_VERSION = 1.6.0`, vendored from `fro-bot/agent@v0.78.0` gateway + web/sse; documented omissions/import-rewrites). SSE-streamed agent-run views with **approval + run cancellation** (issue #179, contract 1.6.0); expanded `web/src/operator/` client-state layer (`runtime`/`state`/`copy`/`validate-dynamic-id`), `views/Operator.tsx`, `shell/AppShell.tsx`. New **fixture harness** (`dev:fixture`, `build:web:fixture`, `DASHBOARD_FIXTURE_HARNESS_ENABLED`) with sanitization tests. New `GET /api/monitoring` (minimized client snapshot); healthz now carries `contractVersion`. `test/` extracted from `src/` colocation (26 server test files). New `.codex/hooks.json`, `.github/hooks/impeccable.json`, `docs/{brainstorms,ideation,plans,solutions}`. Agent pin **v0.77.0 → v0.84.2** (ecosystem leader); clonedeps pinned agent@v0.78.0. pnpm 11.8.0 → 11.10.0; vite 8.0.16 → 8.1.3; tailwind 4.3.1 → 4.3.2; eslint 10.5.0 → 10.6.0; `@types/node` 24.13.2. `fro-bot.yaml` concurrency reworked to PR-head-SHA keying. Releases 30 → 58 (latest `2026.07.12`). Open: #180 daily report, #179 cancellation, #112, #108, #8. Drift noted: contract `README.md` header still says 1.5.0 vs `version.ts` 1.6.0. |
| 2026-07-23 | `58f9634` | Fourth survey. **Impeccable design gate went in-repo, two forms:** vendored skill `.agents/skills/impeccable/` (full SKILL.md + agents + reference playbooks + scripts detector toolchain) **and** OpenCode plugin `.opencode/impeccable/` (`plugin.ts`/`hook-bridge.ts`/`plugin.test.ts`), with `.opencode/tsconfig.json` folded into `check-types` and new `@opencode-ai/plugin` 1.18.3 devDep. New `assets/` brand-token system (`tokens.css`/`styleguide.md`/`banner.svg`); `.impeccable/critique/` capture. CI Design Check now pins **`impeccable@3.2.1`** (older major ignores `ignoreValues`), was a floating `npx impeccable`. **`@hono/node-server` major bump `^1.14.4 → ^2.0.0`.** Agent pin **v0.84.2 → v0.94.2** (ecosystem leader). Operator contract unchanged (`1.6.0`); clonedeps still agent@v0.78.0 — skew now v0.78.0-inspection vs v0.94.2-action (by design). pnpm 11.10.0 → 11.15.1; vite 8.1.3 → 8.1.5; tailwind 4.3.2 → 4.3.3; eslint 10.6.0 → 10.7.0; vitest 4.1.9 → 4.1.10; `@types/node` 24.13.3. Releases 58 → latest `2026.07.31`. Open issues: #243 daily report, **#238 (public push privacy policy — precondition to Web Push)**, **#193 (opencode plugin timeout subprocess cancel)**, #112, #8; #179 closed. Security: 4 open high transitive-devDep alerts (`brace-expansion`, `fast-uri`) — daily pass's `pnpm-workspace.yaml` overrides fix **not landing on `main`** across 3 runs (harness working-dir-delivery gap, not a repo bug). Renovate: abandoned `arctic` flagged; TS v7 / jest-dom v7 held. |
