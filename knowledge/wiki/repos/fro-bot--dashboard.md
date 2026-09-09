---
type: repo
title: fro-bot/dashboard
created: 2026-06-15
updated: 2026-09-09
node_id: R_kgDOS6ys-g
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
  - url: https://github.com/fro-bot/dashboard
    sha: a7bbb791da3b1b5d48dbff6a9a78f8ef0d7e50f5
    accessed: 2026-08-08
  - url: https://github.com/fro-bot/dashboard
    sha: a11f1b7dc5c3cf2ae021eb6c147b0d8fca0684f0
    accessed: 2026-09-09
tags:
  - typescript
  - hono
  - node24
  - native-typescript
  - strip-only
  - pnpm
  - pnpm-workspace
  - github-app
  - oauth
  - octokit
  - monitoring
  - dashboard
  - read-only
  - write-boundary
  - wiki-writer
  - spa
  - react
  - vite
  - tailwind
  - pwa
  - workbox
  - web-push
  - calver
  - ghcr
  - trivy
  - impeccable
  - fro-bot
  - redaction
  - fail-closed
  - security
  - operator-contract
  - sse
  - control-plane
  - fixture-harness
  - opencode-plugin
  - design-tokens
  - codeql
  - scorecard
  - dependency-review
  - supply-chain
  - output-mode
related:
  - fro-bot--agent
  - marcusrbrown--infra
  - bfra-me--works
---

# fro-bot/dashboard

Read-only Fro Bot monitoring dashboard. A Hono Node 24 backend that surfaces live cross-repo status — open PRs + CI state, failing checks, open issues, security alerts — for Fro Bot's collaborator repos and Agent App installations in one glanceable, single-operator view. As of the 2026-06-26 survey it ships a **React 19 + Vite + Tailwind PWA single-page app** (`web/`) served alongside the original Hono SSR shell; the README tagline shifted from "monitoring dashboard" to **"Command center for Fro Bot operations."** By the 2026-07-09 survey the "command center" framing is realized: the SPA hosts an **operator control surface** — live SSE-streamed agent-run views with approval and cancellation — over a vendored operator-contract barrel (v1.6.0). The dashboard stays read-only *toward GitHub App data*, but the operator surface now proxies control actions to the [[fro-bot--agent]] gateway.

The repo is the implementation of the Phase 1 plan tracked in [[fro-bot--agent]]'s parent org repo (`fro-bot/.github` `docs/plans/2026-06-15-001-feat-monitoring-dashboard-phase-1-plan.md`). Created 2026-06-14; `package.json` version stays `0.0.0` (`private: true`), but the repo ships **CalVer-tagged GHCR releases** (latest `2026.07.31` @ 2026-07-23; was `2026.07.12` @ 2026-07-09, 58 releases; `2026.06.50` @ 2026-06-26, 30) via a dedicated `release.yaml` pipeline — see Release Pipeline below.

By the **2026-07-23 survey** (HEAD `58f9634`) the notable structural shift is the **Impeccable design gate going in-repo**: the UI anti-pattern detector, previously invoked as a bare `npx impeccable` in CI, is now vendored both as a skill (`.agents/skills/impeccable/`) and as a first-class **OpenCode plugin** (`.opencode/impeccable/` — `plugin.ts` + `hook-bridge.ts` + `plugin.test.ts`), with a dedicated `.opencode/tsconfig.json` folded into `check-types` and a versioned `@opencode-ai/plugin` devDep. A new `assets/` brand-token system (`banner.svg`, `styleguide.md`, `tokens.css`) supplies the intentional design vocabulary the gate reads. Agent pin advanced **v0.84.2 → v0.94.2** (still ecosystem leader). `@hono/node-server` took a **major bump `^1.14.4 → ^2.0.0`**. The operator control surface, vendored contract (`1.6.0`), and fixture harness are unchanged in shape from 2026-07-09.

By the **2026-08-08 survey** (HEAD `a7bbb79`) the notable structural shift is the **security/supply-chain automation suite landing in-repo**: workflow count jumped **3 → 7** with new `codeql.yaml` (weekly CodeQL `javascript-typescript` analysis), `scorecard.yaml` (OpenSSF Scorecard weekly + SARIF upload to code-scanning), `dependency-review.yaml` (PR-gated advisory review), and a **self-hosted `renovate.yaml`** delegating to `bfra-me/.github` reusable Renovate (v4.16.44) — Renovate previously ran org-side with no repo workflow. The README grew an **OpenSSF Scorecard badge**, closing the CodeQL/Scorecard parity gap that other Fro Bot repos had already crossed. Secondary shifts: the **`Dockerfile` went multi-stage** (`builder` → `prod-deps` → final `node:24-slim`, new digest `sha256:3638d9a6…`, replacing the single-stage `sha256:6f7b03f7…`); `.github/renovate.json5` gained a second preset (`microsoft/m365-renovate-config:groupReact#v2.8.4`) + `postUpgradeTasks` (`pnpm install`/`pnpm fix`, branch mode); and the prior daily-pass `pnpm-workspace.yaml` security `overrides` (`brace-expansion`/`fast-uri`) are **gone** — the working-dir-delivery gap that stranded them appears superseded now that Renovate + Dependency Review own the transitive-advisory path in-repo. Agent pin advanced **v0.94.2 → v0.97.0** (still ecosystem leader). The operator control surface, vendored contract (`1.6.0`, clonedeps still agent@v0.78.0), and fixture harness are unchanged in shape.

By the **2026-09-09 survey** (HEAD `a11f1b7`) the repo crossed its founding invariant on purpose. The one-line self-description moved from "read-only" to **"Read-only by default, with one isolated wiki-write capability"** (`package.json` `description`, README Overview, and both agent prompts all rewritten in the same wording), and a **`wiki-writer/` workspace member** landed — the first GitHub *write* authority ever designed into this codebase. It is deliberately built as a separate service with a separate credential, and the README states the residual risk in its own text rather than claiming the isolation is total. In the same interval the repo **diagnosed and repaired the harness output-mode delivery break** that has been silently discarding autoheal fixes across the fleet — the first observed repo-side fix of that class, with a merged agent-authored PR as proof it works. Four things the wiki previously recorded are corrected below: an SSR route that has not existed since June, two whole subsystems (Web Push and the listener channel) that landed by 2026-07-23 and went unrecorded for two surveys, and a Trivy image-scanning stage that was already in `release.yaml` at the 2026-08-08 survey. See **2026-09-09 corrections** below.

## Overview

| Attribute       | Value                                                            |
| --------------- | --------------------------------------------------------------- |
| Created         | 2026-06-14                                                      |
| Last push       | 2026-09-08 (survey 2026-09-09, HEAD `a11f1b7`; prior `a7bbb79` @ 2026-08-08, `58f9634` @ 2026-07-23, `cb5190d` @ 2026-07-09, `5c631a5` @ 2026-06-26, `2504939` @ 2026-06-15) |
| `node_id`       | `R_kgDOS6ys-g` (repo id `1269607674`)                            |
| Language        | TypeScript (Node 24 native TS, **strip-only** for `src/`/`test/`/scripts/`wiki-writer/`, ESM) |
| Repo shape      | **pnpm workspace as of 2026-09-09** — root app + one member, `packages: [wiki-writer]` |
| Package manager | pnpm 11.25.0 (was 11.20.0 → 11.15.1 → 11.10.0 → 11.8.0 → 11.5.0) |
| Node.js         | `>=24` (engines)                                                |
| Backend build   | **None** — `src/` runs `.ts` directly via Node 24 strip-only execution |
| Frontend build  | **Vite 8** — `web/` React SPA built with `pnpm build:web` (output `web/dist/` baked into image); `build:web:fixture` variant for the fixture harness |
| Backend framework | Hono ^4.7.11 + `@hono/node-server` **^2.0.0** (SSR shell + API + operator proxy) |
| Frontend stack  | React 19.2.8 + react-dom, Tailwind CSS 4.3.3 (`@tailwindcss/vite`), Vite 8.2.0, `@vitejs/plugin-react-swc` 4.3.3, PWA via `vite-plugin-pwa` 1.3.0 + Workbox 7.4.1 |
| Auth library    | **None as of 2026-09-09** — `arctic` dropped in PR #401 (`refactor(auth): replace arctic with direct GitHub OAuth calls`); `src/auth/oauth.ts` now issues the OAuth calls directly. Resolves the abandoned-dependency flag carried since 2026-07-23. |
| GitHub client   | `@octokit/core` 7.0.8, `@octokit/auth-app` 8.3.1, `@octokit/graphql` 9.0.5, retry (8.1.1) + throttling (11.0.5) plugins (the `wiki-writer` member pins `core`/`auth-app` at the same versions) |
| Test framework  | Vitest 4.1.11 — root config includes `test/**`, **`wiki-writer/test/**`**, and `.opencode/impeccable/**`; `web/vitest.config.ts` is a second run; `@testing-library/react` 16.3.3 + `jest-dom` 6.9.1 + jsdom 29.1.1 for the SPA |
| Lint            | ESLint 10.10.0 (`@bfra.me/eslint-config` 0.52.1) + `eslint-plugin-erasable-syntax-only` 0.4.2; `impeccable` UI anti-pattern detector (Design Check, CI-pinned `impeccable@3.2.1`) |
| TypeScript      | 6.0.3 (`@bfra.me/tsconfig` 0.13.2) — Renovate flags v7.0.2 available (held, ~4 surveys) |
| OpenCode plugin | `@opencode-ai/plugin` 1.18.29 (drives the in-repo Impeccable design-lint plugin at `.opencode/impeccable/`) |
| Visibility      | Public                                                          |
| Stars           | 1 (forks 2)                                                    |
| License         | None declared                                                  |
| Security        | **CodeQL + OpenSSF Scorecard + Dependency Review + self-hosted Renovate** (2026-08-08) **+ two-phase Trivy image scan in `release.yaml`** (present since ≤2026-08-08, first recorded 2026-09-09) |
| Releases        | **CalVer (`YYYY.MM.N`)** — latest `2026.09.6` (2026-09-07, authored `fro-bot[bot]`); was `2026.08.14`; GHCR image only, `package.json` version stays `0.0.0` |

## Purpose

This is the read-only observability surface for Fro Bot's footprint. It authenticates a single operator (Marcus) via GitHub OAuth, enumerates the Fro Bot Agent App's installations, mints **read-only** installation tokens, and aggregates per-repo signals into a glanceable SSR page plus a JSON API. It writes nothing back to GitHub.

## Architecture

**Two-tier as of 2026-06-26:** a Hono Node 24 backend (`src/`, no build step) that serves a JSON API + SSR shell, plus a **Vite-built React SPA** (`web/`) baked into the deployed image. The 2026-06-15 page described a single SSR-only Hono process; that remains the backend, but the operator UI is now a client-side React PWA mounted by the shell. The backend `src/` layout:

| Path                      | Responsibility                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/server.ts`           | App factory (`buildDashboardApp`) + server binding (`createDashboardServer`, binds `127.0.0.1:3000`). Wires middleware, OAuth, aggregator, routers. |
| ~~`src/routes/dashboard.ts`~~ | **Removed ≤2026-06-26** (see 2026-09-09 Corrections) — was the SSR route using `hono/html` tagged templates (no JSX, no build step), auto-escaped, POST-form logout with CSRF token. `GET /` now serves the SPA shell directly from `src/server.ts`. |
| `src/listener/` + `src/routes/listener.ts` | **Landed ≤2026-07-23, recorded 2026-09-09.** Listener channel — `config.ts`, `contract.ts`, `ingest-auth.ts`, `store.ts` behind an authenticated ingest route. Wire contract at `docs/contracts/operator-listener-channel.md`; three dedicated server suites. Not listed in the README endpoint inventory. |
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

**Provenance discipline** (from the contract `README.md`): the barrel is *vendored* from `fro-bot/agent` `packages/gateway/src/operator-contract/` + `packages/gateway/src/web/sse/` at **tag v0.78.0** — do not hand-edit behavior; refresh by re-copying and re-applying documented import rewrites (`@fro-bot/runtime` → `../../result.ts`; inline boundary types for `RunPhase`/`Surface`/`RunState`). `sse-frames.ts` is a parallel surface (`ReadyFrame`/`StatusFrameData`/`ResetFrameData`/`RunStreamFrame`/`ResetReason`), not part of the upstream barrel, re-exported for convenience. `repo-summary.ts` is locally authored (upstream added `RepoSummary` at v0.73.0 with no parse helper). Upstream helpers depending on upstream-only types (`toOperatorDecisionState`, `toOperatorRunStatus`, `DecisionInput`) are deliberately omitted; all PUBLIC frozen types are present. NOTE: the contract `README.md` still says `Contract: 1.5.0` while `version.ts` pins `1.6.0` — a **stale-header drift** worth a follow-up. **Re-confirmed 2026-09-09 (4th consecutive survey, ~2 months).** `OPERATOR_CONTRACT_VERSION` itself has held at `1.6.0` since 2026-07-09 across five surveys, so the barrel is stable and only its header lies; a `push.ts` member has since joined the barrel (Web Push) without the provenance list being revised. This is small, but it is the exact failure mode the vendoring discipline exists to prevent — a hand-maintained provenance note is only as good as the last hand that maintained it. Two documented refresh procedures (this copy-vendored barrel, and the SHA-pinned `@fro-bot/wiki-write-core` gate) now both depend on someone remembering.

The operator surface streams live agent runs over **SSE** (`operator-sse-reader` client + `sse-frames` types), supports **approvals** (`approval`/`approval-frame`) and **run cancellation** (open issue #179 tracks cancellation + sanitized failure-reason at contract 1.6.0). This makes the dashboard a *view-plane over GitHub data* but a *control-plane proxy toward the gateway's run lifecycle* — it never writes to GitHub, but it can launch/approve/cancel agent runs via the gateway.

### Fixture harness (new 2026-07-09)

A deterministic operator backend for offline dev + tests, gated behind env flags so it can never surface in production. `pnpm dev:fixture` builds `web/dist-fixture` (via `build:web:fixture`, `VITE_FIXTURE_MODE=true`) and runs the server with `DASHBOARD_FIXTURE_HARNESS_ENABLED=true` + `DASHBOARD_DEV_AUTOLOGIN=true` on `127.0.0.1`. Backend: `src/routes/operator-fixture-harness.ts` + `src/gateway/operator-fixture-*`; client: `web/src/operator/fixture-*`. Tests assert both the harness behavior (`test/operator-fixture-harness.test.ts`) and its **sanitization** (`test/operator-fixture-sanitization.test.ts`) — the fixture data path is held to the same redaction bar as live. This is the offline analog of the gateway's own fixture flows and lets the operator UI be exercised without live App credentials.

### Web Push subsystem (landed ≤2026-07-23, first recorded 2026-09-09)

Tree comparison across four surveyed SHAs shows the push stack was present at `58f9634` (2026-07-23) and absent at `cb5190d` (2026-07-09) — so it landed in that window and went unrecorded through two surveys. Client: `web/src/push/` (11 files, each with a colocated test) — `capability.ts` (feature detection), `vapid-key.ts`, `subscribe.ts`, `reconcile.ts`, `endpoint-hash.ts` (subscription endpoints are hashed, never stored raw), `push-types.ts`, `sw-notification.ts`, `logout-abort.ts` — plus `web/src/views/Notifications.tsx` + `notifications-copy.ts` and `web/src/pwa/logout-purge.ts`. Contract: a new `src/gateway/operator-contract/push.ts` member of the vendored barrel. Design intent is captured in `docs/brainstorms/2026-07-08-operator-push-notifications-requirements.md` + `docs/plans/2026-07-08-001-feat-operator-push-notifications-dashboard-plan.md`.

The subsystem is built but **gated on a policy precondition, not a technical one**: open issue **#238** (`feat(push): publish public operator push privacy policy`, filed 2026-07-21 by the owner, untouched since) is the stated blocker to enabling Web Push. That is the same shape as [[marcusrbrown--mrbro-dev]]'s analytics activation gate — the code ships disabled and the gate is a published-document requirement, not a feature flag someone forgot. Recording it late does not change the reading: **an operator-notification channel and its logout-purge/endpoint-hash privacy machinery existed for seven weeks before the wiki noticed.**

### Listener channel (landed ≤2026-07-23, first recorded 2026-09-09)

Same window, same omission. `src/listener/` (`config.ts`, `contract.ts`, `ingest-auth.ts`, `store.ts`) + `src/routes/listener.ts` on the server, `web/src/api/listener.ts` + `web/src/views/Listener.tsx` on the client, with three dedicated server suites (`listener-ingest-auth`, `listener-routes`, `listener-store`) and a written wire contract at `docs/contracts/operator-listener-channel.md`. Note that the README's Endpoints list does **not** enumerate the listener routes — the endpoint inventory a reader would trust is incomplete with respect to the tree. Treat the README endpoint list as illustrative, not exhaustive.

## The `wiki-writer` Write Boundary (new 2026-09-09)

The founding invariant of this repo was "it writes nothing back to GitHub." As of 2026-09-09 that is restated rather than abandoned: **read-only by default, with exactly one isolated write capability**, delivered as a separate workspace member and a separate service.

The landing sequence is legible in the merged PR history and is worth recording as a method: **#420** `docs(security): define isolated wiki write authority` (2026-09-01) → **#423** `docs: plan the operator wiki editor and private writer` → **#424** `feat(wiki-writer): add the authenticated private writer skeleton` → **#425** `feat(wiki-writer): pin the shared gate package and check contract drift` → **#430** `feat(wiki-writer): add the gated GitHub write path and operation ledger` (merged 2026-09-04). Security definition first, plan second, skeleton third, gate-pinning fourth, write path last. Every one merged same-day or next-day.

**Shape.** `wiki-writer/` is the repo's first workspace member (`pnpm-workspace.yaml` `packages: [wiki-writer]`). Ten source modules — `server.ts`, `contract.ts`, `gate-contract.ts`, `github-data-client.ts`, `internal-auth.ts`, `operation-ledger.ts`, `write-operation.ts`, `retention.ts`, `fixture.ts` — against ten test files including a dedicated `security-boundary.test.ts` and a `runtime-dependencies.test.ts`. `package.json` is `@fro-bot/wiki-writer`, `private: true`, `0.0.0`, one script (`start: node src/server.ts`), three dependencies.

**Declared credential separation** (README Configuration, verbatim in substance): the wiki-writer authenticates as the **Fro Bot App** — the same App `release.yaml` uses via `APPLICATION_ID`, deliberately *distinct* from the read-only Agent App behind `DASHBOARD_GITHUB_APP_*`; it may target only the `fro-bot/.github` `data` branch under an explicit wiki/corrections path allowlist; it executes gates from the shared `@fro-bot/wiki-write-core` package; and **the dashboard never receives the App private key or a derived installation token**. `DASHBOARD_GITHUB_APP_*` "may never mint write-scoped tokens" is restated as an invariant.

**The residual is stated by the repo, not inferred by this survey.** The README says plainly that the separation "prevents credential exfiltration and arbitrary GitHub operations, but a compromised authenticated dashboard can still submit in-scope wiki edits," and that it "adds another secret, service, health boundary, and incident surface." That is the honest-scope discipline this wiki already catalogued from [[marcusrbrown--mothership]] — documentation that opens by enumerating what the design does *not* guarantee. The same paragraph asserts the service **"is not built yet"** while the package, its server, and ten test suites are on `main`; read that as *not deployed / not wired to a credential*, and treat the prose and the tree as answering different questions. It is a scope claim, not a tree claim.

**Cross-repo coupling — and the pin nobody can see.** `wiki-writer/package.json` depends on `@fro-bot/wiki-write-core` via pnpm's git protocol:

```
"@fro-bot/wiki-write-core": "github:fro-bot/.github#37abb495df047e6b8beb690017ac6d217978fb9c&path:packages/wiki-write-core"
```

That package lives in this org's `.github` control-plane repo, is `private: true` at version `0.0.0`, is never published to a registry, and ships **33 committed `dist/` build artifacts** so the consumer resolves it without a build step. Three consequences, all verifiable:

1. **Renovate does not track it.** The Dependency Dashboard (#8) lists `wiki-writer/package.json` with exactly three detected dependencies — `@octokit/auth-app`, `@octokit/core`, `node >=24`. The `github:…&path:` reference is absent. The only cross-repo code dependency inside the repo's sole write-authority package is invisible to the updater that watches everything else. Same class as the untracked bare-SHA action pin in [[bfra-me--ha-addon-repository]] and the untracked CDN URL in [[marcusrbrown--esphome-life]] — cataloged in [[github-actions-ci]].
2. **The pin carries no version signal.** `37abb495` is an ordinary `main` commit of `fro-bot/.github` (a Renovate mise bump, `#3814`) — not a tag, not a release, not a package-scoped boundary. "Refresh the gate package" is a manual SHA swap with nothing to diff against but the whole control-plane repo's history.
3. **Committed `dist/` can drift from `src/`.** The repo knows: PR #425 is titled *pin the shared gate package **and check contract drift***, and the artifacts back it — `wiki-writer/src/gate-contract.ts` + `test/gate-contract.test.ts` on this side, a generated `dist/gate-contract.json` on the other. The risk is instrumented rather than ignored.

Note this repo now carries **two different cross-repo coupling styles at once**: the operator contract is *copy-vendored* with a documented re-copy procedure (frozen at agent `v0.78.0`), while the wiki gate package is *git-pinned by SHA* with a drift test. Neither is wrong; the pair is a useful side-by-side, because the copy-vendored one is visible to a reader and invisible to Renovate, and the git-pinned one is invisible to both.

**Two coverage gaps introduced by the new member.** The root `vitest.config.ts` was updated to include `wiki-writer/test/**/*.test.ts`, and the root `tsconfig.json` type-checks it (only `web`, `.opencode`, and one file are excluded), so tests and types are covered. But:

- CI's **Test Scripts Load** job — the repo's dedicated defense against Node 24 strip-only parse failures — still walks `find src -name '*.ts'`. `wiki-writer/src/**` runs under the exact same strip-only execution model (`start: node src/server.ts`) and is **not** import-checked at merge time.
- The daily `SCHEDULE_PROMPT` category 4b still scopes its strip-only drift rule to "`src/**/*.ts`". The agent is instructed to audit a directory that no longer covers the whole runtime.

The `Dockerfile` was updated for the workspace (`COPY wiki-writer/package.json ./wiki-writer/package.json` in both `builder` and `prod-deps`), so `pnpm install --frozen-lockfile --prod` now resolves the git dependency **inside the production image build** — a GitHub tarball fetch on the release path that did not exist before.

## Security Model

Security is the dominant design constraint; `AGENTS.md` and per-module docstrings encode hard invariants.

### Read-only by construction

Every GitHub App installation token is minted with an explicit read-only `permissions` subset **at mint time** (`pull_requests`/`checks`/`issues`/`contents`/`metadata: read`, with `security_events`/`vulnerability_alerts: read` optional + graceful). This makes the Agent App's *registered* permissions irrelevant to effective access — the dashboard cannot write even if the App could. "Never add a write code path."

**Amended 2026-09-09.** The invariant now reads *read-only by default, with one isolated write capability*. It is narrowed, not weakened: `DASHBOARD_GITHUB_APP_*` still may never mint write-scoped tokens, and the dashboard web/runtime still holds no GitHub write authority — the write path lives in a separately deployed service under a different App identity (see [The `wiki-writer` Write Boundary](#the-wiki-writer-write-boundary-new-2026-09-09)). The README explicitly notes that existing application `POST` endpoints are not GitHub write authority, and that repository CI/release automation is separately credentialed and outside this boundary.

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

**Seven workflows** as of 2026-08-08 (`main.yaml`, `fro-bot.yaml`, `release.yaml`, plus new `codeql.yaml`, `scorecard.yaml`, `dependency-review.yaml`, `renovate.yaml`) — up from **three** at 2026-07-23. All third-party actions are SHA-pinned with version comments. `main.yaml` still runs six jobs and `release.yaml`'s four-job CalVer chain is intact. The 2026-08-08 churn is the **security/supply-chain suite** (see below), the agent pin bump (v0.94.2 → v0.97.0), the multi-stage Dockerfile refactor, and dependency bumps.

**2026-09-09: still seven workflows, all `active`; `main.yaml` byte-identical to 2026-08-08.** The interval's workflow change is entirely in `fro-bot.yaml` (320 → 335 lines — the output-mode/credential fix below) and small pins in `release.yaml` (`docker/setup-buildx-action` v4.2.0 → v4.3.0, `codeql-action/upload-sarif` digest, and the runtime-UID smoke assertion 1001 → 1000 tracking the Dockerfile user change). `renovate.yaml` now calls `bfra-me/.github` reusable at **v4.26.0** (was v4.16.44 — ten minor boundaries in a month). One cosmetic inconsistency: `scorecard.yaml` checks out with `actions/checkout` **v7.0.1** while every other workflow is still on **v6.1.0**, and the v7 bump for the rest sits parked in the Dependency Dashboard's pending-approval block.

### Two-phase Trivy image scan in `release.yaml` (present since ≤2026-08-08, first recorded 2026-09-09)

The 2026-08-08 survey described the security suite as four new workflows and missed that `release.yaml` already carried container scanning; the file was 565 lines at `a7bbb79` and differs from the current one only in three pins. Recording it now because the shape is a reusable pattern rather than a config detail — the release job scans the built image **twice, by digest**, with opposite policies:

1. **Report everything** — `aquasecurity/trivy-action` v0.36.0 (Trivy `v0.72.0`), `scan-type: image`, `image-ref: ghcr.io/<repo>@<digest>`, `severity: HIGH,CRITICAL`, `limit-severities-for-sarif: true`, **`exit-code: '0'`** → SARIF uploaded as an artifact (5-day retention) **and** to code scanning under the dedicated category `trivy/release-image`, plus a `$GITHUB_STEP_SUMMARY` block naming the digest, artifact, category, and severity floor.
2. **Enforce only what is actionable** — a second invocation of the same pinned action with **`ignore-unfixed: true`** and **`exit-code: '1'`**, so the release fails on HIGH/CRITICAL findings that have a fix available and does not fail on base-image CVEs with no upstream patch.

The reasoning is written down in-repo at `docs/solutions/best-practices/trivy-base-image-alerts-unfixable-by-design-2026-08-30.md`. This is the correct answer to a common footgun: a single blocking scan on an unpinnable base image either blocks every release or gets its severity floor quietly raised until it means nothing. Splitting *visibility* from *enforcement* keeps the full HIGH/CRITICAL picture in code scanning while gating only on findings a maintainer can actually act on. Cataloged in [[docker-containers]].

Credential ordering is also disciplined here: an explicit comment marks that the publication App token is minted **only after all third-party actions have completed**, so no third-party step in the job ever runs with the release identity in the environment.

### Security & supply-chain workflows (new 2026-08-08)

The dashboard closed its CodeQL/Scorecard parity gap in one wave — the same gap [[fro-bot--fro-bot-github-io]] issue #1 still tracks and that most Marcus-side repos crossed earlier:

| Workflow                 | Trigger / cadence                        | Action (SHA-pinned)                                   |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------- |
| `codeql.yaml`            | push/PR to `main` + weekly `31 7 * * 3`  | `github/codeql-action` v4 (`javascript-typescript`)   |
| `scorecard.yaml`        | weekly `27 6 * * 1`                       | `ossf/scorecard-action` v2.4.4 → SARIF `upload-sarif` |
| `dependency-review.yaml` | PR to `main`                             | `actions/dependency-review-action` v5.0.0             |
| `renovate.yaml`          | self-hosted Renovate entry               | `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.44` |

Previously Renovate ran org-side against the repo with **no repo-local workflow**; the self-hosted `renovate.yaml` brings it in-repo, consistent with the pattern in [[marcusrbrown--infra]] and [[bfra-me--works]]. The README gained an **OpenSSF Scorecard badge**. This is the dashboard aligning its *own* supply-chain posture with the read-only-by-construction / fail-closed discipline it already enforces on GitHub data.

The **prior harness-delivery gap** (2026-07-23: the daily pass's `pnpm-workspace.yaml` `overrides` for `brace-expansion`/`fast-uri` never landing on `main` across three runs) is now **superseded** — those overrides are absent from `pnpm-workspace.yaml`, and the transitive-advisory path is now owned in-repo by Renovate + Dependency Review rather than by an autoheal edit that couldn't be delivered under working-dir mode.

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

Pinned to **`fro-bot/agent@b799b64` (v0.109.4)** as of 2026-09-09 (12 minors and 8 separate Renovate merges since v0.97.0, all same-day). Was, as of 2026-08-08, `3f19f02` (v0.97.0) (was `64029d5` / v0.94.2 @ 2026-07-23, `99e7d85` / v0.84.2 @ 2026-07-09, `f51adbd` / v0.77.0 @ 2026-06-26, `854072f` / v0.64.0 @ 2026-06-15) — tied for the newest agent pin seen in the surveyed ecosystem ([[marcusrbrown--gpt]] runs the same `3f19f02` / v0.97.0). Single three-mode job: PR review (`pull_request`), mention/issue triage (`issue_comment`, `pull_request_review_comment`, `issues`), and a daily schedule (`0 0 * * *`, midnight UTC) + manual dispatch (with an optional custom-`prompt` dispatch input).

- **Concurrency reworked (2026-07-09):** the group key now uses the **PR head SHA** for `pull_request` events (`fro-bot-<head.sha>`) so each push gets its own slot; the prior PR-number key shared one group across every PR event, dropping a push that landed while an earlier run for the same PR was in-flight (one pending run per group, `cancel-in-progress: false`). Non-PR events (review comments, issues) keep their own keys; schedule/dispatch collapse onto a `daily` key.
- **Checkout pins to the default/workflow ref, never PR-head code**, with an explicit comment: on `issue_comment` the fork guard can't see PR fork status, so checking out `refs/pull/<n>/head` would run fork-controlled code with `FRO_BOT_PAT` present — default checkout closes that secret-exfiltration vector. Fork/bot/`fro-bot`-author guards gate the job; comment triggers require `@fro-bot` + `OWNER`/`MEMBER`/`COLLABORATOR` association.
- **`PR_REVIEW_PROMPT`** — skeptical single-pass reviewer; security-first (prefer false positives); explicitly forbids invoking `ce:review`/`ce:*` heavy multi-agent skills; fixed verdict template (PASS/CONDITIONAL/REJECT + blocking/non-blocking/missing-tests/risk).
- **`SCHEDULE_PROMPT`** — combined daily oversight + autohealing pass with six ordered categories (Errored PRs, Security, Code Quality, Workflow Integrity, Progressive Improvement, Cross-Project Intelligence), one perpetual "Daily Fro Bot Report — YYYY-MM-DD (UTC)" summary issue, hard no-write-to-main / no-merge / no-force-push boundaries, and Renovate-owns-version-bumps dependency policy. The Code Quality category re-runs the strip-only load check inline. Its self-cleanup clause keys on a **title prefix** (`"Daily Fro Bot Report —"`, plus the two legacy variants) — the re-derivable predicate that [[github-actions-ci]] identifies as the one that actually converges, and it does: exactly one open daily report (#455) against 100+ ever written.

### Output-mode delivery break: diagnosed and fixed here (2026-08-31)

This is the interval's most transferable finding. Across the fleet the harness's default `output-mode: auto` resolves to working-dir delivery, in which the *caller workflow* owns commit/push/PR — and a workflow with no caller-side delivery step silently discards every fix the agent produces. It has been recorded as a silent failure in [[marcusrbrown--tokentoilet]] (nothing written since 2026-08-09 under full write permissions), as a self-detected-but-unfixed loop in [[marcusrbrown--mothership]], and against [[marcusrbrown--infra]]. **The dashboard is the first surveyed repo to close it.**

The repair is four merged same-day PRs on 2026-08-31, in the order a good post-mortem goes:

| PR   | Title                                                              | Role                    |
| ---- | ------------------------------------------------------------------ | ----------------------- |
| #413 | `fix(ci): deliver Fro Bot auto-heal fixes via branch and PR`        | the fix                 |
| #415 | `docs(workflow): record the output-mode delivery trap`              | the learning            |
| #416 | `fix(ci): scope persisted git credentials to triggers that need them` | the consequence         |
| #418 | `docs(workflow): correct the review-path claim and record credential coupling` | the correction of the learning |

In the workflow the fix is four lines with a comment that states the causal chain rather than the setting:

```yaml
# Scheduled runs need branch-pr; this workflow has no caller-side PR step.
# Scope it to those triggers so other events stay on auto.
output-mode: >-
  ${{ (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')
      && 'branch-pr' || 'auto' }}
```

#416 is the part most repos would miss. Switching the scheduled pass to `branch-pr` means the agent must *push*, which means the checkout must keep its credential — so `persist-credentials` became conditional, withheld exactly on the attacker-reachable review paths and kept only where delivery needs it:

```yaml
# Review-path triggers withhold credentials from the agent; don't leave one in the workspace.
# Schedule/dispatch keep it because branch-pr delivery pushes with it.
persist-credentials: >-
  ${{ !contains(fromJSON('["pull_request", "issue_comment", "issues"]'), github.event_name) }}
```

That is the same disjoint-capability split [[marcusrbrown--infra]] reached by cutting `fro-bot.yaml` into two jobs — here achieved with two expressions instead, keeping one job. The general rule: **giving an agent a delivery channel is a permissions change, and the credential must be scoped to the trigger that needs it, not to the workflow.**

**It works, and there is an artifact.** PR **#414** — `fix(web): remove no-op replace() in tokens.test.ts (CodeQL #31)`, authored by `fro-bot` (the agent identity, not the Renovate `fro-bot[bot]` identity) — was opened and **merged on 2026-08-31**, closing a real code-scanning alert. In the 100 most recent closed PRs it is the only agent-authored one, which is the honest framing: the channel is repaired and lightly used, not a flood. The learning is written up in-repo at `docs/solutions/workflow-issues/workflow-output-mode-auto-discarded-agent-fixes-2026-08-31.md`, alongside `opencode-bootstrap-timeout-cache-purge-2026-08-31.md` from the same debugging session.

**Daemon health (2026-09-09):** the last three scheduled runs (09-07, 09-08, 09-09) all `success`; today's report issue #455 exists. Of the last 30 `Fro Bot` runs, **27 concluded `skipped`** (15 `issues`, 6 `issue_comment`, 6 `pull_request`) because the trigger surface is almost entirely bot-authored and the guards reject it — the same ~90% skip ratio measured in [[marcusrbrown--tokentoilet]]. The difference is that here the 3 runs that *do* execute can deliver.

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

Runtime deps are stable in shape from 2026-06-15 through 2026-08-08; `@hono/node-server` holds at the **^2.0.0** major (bumped 2026-07-23 from ^1.14.4), and the Octokit stack took patch bumps as of 2026-08-08: `@octokit/core` 7.0.7, `@octokit/auth-app` 8.3.0, `@octokit/graphql` 9.0.4, `plugin-retry` 8.1.1, `plugin-throttling` 11.0.5. The frontend/dev toolchain as of 2026-08-08: `react`/`react-dom` **19.2.8** (was 19.2.7), `tailwindcss` + `@tailwindcss/vite` 4.3.3, `vite` **8.2.0** (was 8.1.5), `@vitejs/plugin-react-swc` **4.3.3** (was 4.3.1), `vite-plugin-pwa` 1.3.0 + `workbox-*` 7.4.1 (exact-pinned across build/core/precaching/routing/strategies/expiration/cacheable-response/window), `@testing-library/react` 16.3.2 / `jest-dom` 6.9.1 / `jsdom` 29.1.1, `@types/react` 19.2.18 / `@types/react-dom` 19.2.4. Other dev: `@bfra.me/eslint-config` 0.51.1, `@bfra.me/tsconfig` 0.13.1, `eslint` **10.8.0** (was 10.7.0), `eslint-plugin-erasable-syntax-only` **0.4.2** (was 0.4.0), `typescript` 6.0.3 (Renovate flags v7; held), `vitest` 4.1.10, `jiti` 2.7.0, `@types/node` 24.13.3, and **`@opencode-ai/plugin` 1.18.14** (was 1.18.3) for the in-repo Impeccable OpenCode plugin. The `@bfra.me/*` toolchain comes from [[bfra-me--works]].

`pnpm-workspace.yaml` as of 2026-08-08: `shamefullyHoist: true`, `allowBuilds` lists `@swc/core: true` + `unrs-resolver: true`, and now **`msgpackr-extract: false`** with a comment noting `@opencode-ai/plugin` is a type-only devDep whose transitive native accelerator never needs to build. The prior daily-pass security `overrides` (`brace-expansion`, `fast-uri`) are **gone** — the 2026-07-23 working-dir-delivery gap that stranded them is superseded now that Renovate + Dependency Review own the transitive-advisory path in-repo (see CI Pipeline → Security & supply-chain workflows).

**2026-09-09 — the runtime toolchain moved and the override ledger came back.** Root `package.json`: `pnpm` 11.20.0 → **11.25.0**, `eslint` 10.8.0 → **10.10.0**, `vite` 8.2.0 → **8.2.2**, `vitest` 4.1.10 → **4.1.11**, `@bfra.me/eslint-config` 0.51.1 → **0.52.1**, `@bfra.me/tsconfig` 0.13.1 → **0.13.2**, `@opencode-ai/plugin` 1.18.14 → **1.18.29**, `@testing-library/react` 16.3.2 → **16.3.3**, `@types/react-dom` 19.2.4 → **19.2.7**, Octokit `core` 7.0.8 / `auth-app` 8.3.1 / `graphql` 9.0.5, `hono` resolving to 4.13.7 and `@hono/node-server` to 2.1.1. `typescript` holds at **6.0.3** with v7.0.2 available — a fourth-survey hold. **`arctic` is gone entirely** (PR #401, 2026-08-30), which retires the abandoned-dependency flag Renovate had been raising since 2026-07-23; the OAuth calls are now issued directly from `src/auth/oauth.ts`, trading a maintained-by-nobody dependency for ~one file of owned code — the "keep the chrome light" call, made correctly.

**Contradiction with the 2026-08-08 reading, recorded rather than overwritten.** That survey concluded the `pnpm.overrides` security ledger was "gone / superseded" because Renovate + Dependency Review had taken over the transitive-advisory path. It is back, deliberately, in PR **#400** `fix(deps): pin patched transitive dev dependencies` (2026-08-30):

```yaml
overrides:
  brace-expansion@2: '>=2.1.2 <3.0.0'
  brace-expansion@5: '>=5.0.7 <6.0.0'
  fast-uri@3:        '>=3.1.5 <4.0.0'
  undici@7:          '>=7.29.0 <8.0.0'
```

Two of the three original entries returned and `undici@7` is new. The 2026-08-08 conclusion was right about *why* the overrides had disappeared and wrong about what it implied: **PR-scoped Dependency Review gates changes, it does not remediate a transitive version already resolved in the lockfile** — the same distinction [[marcusrbrown--tokentoilet]] hit from the other direction. An override ledger and an advisory gate are complementary, not substitutes. Also new: a `minimumReleaseAgeExclude` list carving `@bfra.me/eslint-config` 0.51.2–0.52.1 and `@bfra.me/tsconfig@0.13.2` out of the org-wide release-age quarantine, i.e. a per-package opt-out from a supply-chain cooling-off policy inherited from the preset chain.

Renovate *does* see the override ledger (it is listed under `pnpm-workspace.yaml` in the Dependency Dashboard) and is proposing to widen all three range caps to the next major — those sit unchecked in pending approval, so the ledger is stable by gate, not by neglect.

## Deployment

`Dockerfile` — **multi-stage as of 2026-08-08** (`builder` → `prod-deps` → final), all three stages on `node:24-slim` (digest-pinned `sha256:3638d9a6…`, replacing the prior single-stage `sha256:6f7b03f7…`). The `builder` stage compiles the Vite SPA, `prod-deps` isolates `pnpm install --frozen-lockfile --prod`, and the final stage runs as non-root `dashboard` user (uid/gid 1001) for `read_only`-friendly operation, `EXPOSE 3000`, `CMD ["node", "src/server.ts"]`.

**2026-09-09 changes.** Base digest bumped to `sha256:ba849c60…` across all three stages. The bespoke `addgroup`/`adduser` block creating a `dashboard` user at uid/gid **1001 was deleted** in favour of `USER node` — the stock uid **1000** the `node:*` images already ship (PR #406, `fix(docker): run as the node user to match deployment`); `release.yaml`'s runtime-UID smoke assertion was updated in lockstep (`!= 1001` → `!= 1000`), which is the detail that makes this a clean change rather than a latent release-blocker. Both the `builder` and `prod-deps` stages now `COPY wiki-writer/package.json ./wiki-writer/package.json` so the workspace resolves — meaning the production dependency install now reaches out to GitHub for the `@fro-bot/wiki-write-core` git tarball. Note the corollary: `pnpm install --prod` covers the workspace member, so the wiki-writer's Octokit dependencies land in the runtime image even though the dashboard process itself holds no write authority. The Vite-built `web/dist/` SPA is baked into the image (release smoke test asserts it is served). The server binds `127.0.0.1:3000`, expecting an external TLS-terminating reverse proxy.

The image is now produced by the in-repo **`release.yaml` CalVer pipeline** (GHCR `ghcr.io/fro-bot/dashboard`, tags `<calver>`/`latest`/`sha-<short>`) rather than an external build, and that pipeline dispatches the gated [[marcusrbrown--infra]] deploy. See CI Pipeline → `release.yaml`.

## Renovate Configuration

`.github/renovate.json5` extends `github>fro-bot/.github` (the org-wide Renovate baseline, ultimately the [[marcusrbrown--renovate-config]] preset chain) **plus a new second preset as of 2026-08-08**: `github>microsoft/m365-renovate-config:groupReact#v2.8.4` for React-family grouping. It also added `postUpgradeTasks` (`pnpm install` → `pnpm fix`, `executionMode: branch`) so lockfile + auto-fix run inside the update branch. As of 2026-08-08 Renovate also runs via a **self-hosted `renovate.yaml`** workflow (see CI Pipeline → Security & supply-chain workflows). Dependency/version bumps are Renovate-owned; the daily Fro Bot pass only touches deps for confirmed critical/high security advisories. The Renovate Dependency Dashboard (#8) as of 2026-07-23 flags a package-lookup warning (the `--yes impeccable` regex-managed CI pin), an abandoned `arctic` (last release 2025-05-21), and held majors (TypeScript v7, `@testing-library/jest-dom` v7, GitHub Actions majors).

**2026-09-09 dashboard state — 0 open PRs, 11 parked majors.** The queue looks empty and is not. `open_issues_count` is 5 and every one is an issue; the PR list is genuinely drained (84 of the last 100 closed PRs are `fro-bot[bot]` Renovate merges, all same-day). But #8's **Pending Approval** block holds eleven updates that never became branches: `aquasecurity/trivy` v0.74.0, `eslint-plugin-erasable-syntax-only` v0.7.1, `brace-expansion@2` → v5, `fast-uri@3` → v4, `undici@7` → v8, GitHub Actions majors (`actions/cache`, `actions/checkout`, `actions/setup-node`), **pnpm v12**, `@testing-library/jest-dom` v7, `jsdom` v30, **TypeScript v7**, **Vitest v5**. Two more sit under *Pending Status Checks* (`@opencode-ai/plugin` 1.18.30, pnpm 11.26.0) and lockfile maintenance is *Awaiting Schedule*.

This is the third distinct mechanism the fleet has produced behind an identical-looking empty queue, after [[marcusrbrown--dev-like]] (genuinely drained by automerge) and [[bfra-me--ha-addon-repository]] (`prConcurrentLimit` throttling) — here, `dependencyDashboardApproval` on majors, exactly as in [[marcusrbrown--mothership]]. It re-confirms the rule already recorded in [[github-actions-ci]]: **the dashboard is the queue; the PR list is a filtered view of it**, and any fleet audit counting open PRs will score this repo as current while `typescript`, `vitest`, and `pnpm` are each a major behind.

The `--yes impeccable` lookup failure persists for a **fourth** survey (`Failed to look up npm package --yes impeccable: no-result`) — cosmetic, caused by the regex manager reading the `npx` flag as the package name, and by now clearly permanent rather than transient. `arctic` has left the dependency set entirely, so that flag is resolved.

## Ecosystem Role

The dashboard is the **read-only observability layer** over the Fro Bot fleet. It is downstream of [[fro-bot--agent]] in two ways: (1) it consumes the Agent App's installations to discover repos, and (2) it mirrors the gateway/runtime primitives (`Result<T,E>`, `Logger`, secret readers, app-factory/serve split, read-only `installAuth` pattern) as the staging ground for a future shared `@fro.bot/runtime` package. It is a sibling to the Discord gateway in [[marcusrbrown--infra]]: both are long-running Hono services in the Fro Bot operational stack, one a control plane (gateway), this one a read-only view plane.

It also enforces the same redaction contract that governs this knowledge wiki: `metadata/repos.yaml`'s denylist is the single source of truth for which repos stay private, used here to gate live queries and elsewhere to gate wiki promotion.

**As of 2026-09-09 that relationship is bidirectional.** The dashboard no longer only *reads* the control-plane repo's `data` branch for redaction state — through `wiki-writer/` it is being built to *write* to it, under an operator-driven wiki-editing surface, executing the same gate primitives (`@fro-bot/wiki-write-core`: frontmatter, wikilink, slug, corrections-survival, private-leak, and ingest/lint checks) that the control-plane repo's own automation runs. So the dashboard is becoming the operator's hands on this wiki, with the enforcement logic shared rather than reimplemented — which is the right call, and also the reason the untracked SHA pin above matters more than a normal dependency pin would: a stale `dist/` in the consumer means the write path is enforcing an *older* version of the gates than the repo it writes into.

**Deploy surface (confirmed 2026-06-19, pipeline closed 2026-06-26):** the released image is built here and shipped from [[marcusrbrown--infra]]'s `apps/dashboard/` deploy package — a two-service Caddy + dashboard compose stack at `dashboard.fro.bot`, consuming `ghcr.io/fro-bot/dashboard` by tag + digest (no on-droplet build). As of 2026-06-26 the loop is automated: this repo's `release.yaml` builds + smoke-tests the image and **dispatches** infra's `deploy-dashboard.yaml` (gated on operator approval). infra is the operator-facing deploy/runbook home; this repo remains the build/source home.

## Fro Bot Workflow Status

**Present and self-hosted.** `fro-bot.yaml` pins `fro-bot/agent@b799b64` (**v0.109.4**) as of 2026-09-09 — was `3f19f02` (v0.97.0, ecosystem version co-leader) at 2026-08-08 — with full three-mode coverage (PR review, mention/issue triage, daily midnight-UTC oversight+autohealing, manual dispatch). The daily report issue is live (#455, "Daily Fro Bot Report — 2026-09-09 (UTC)"). No follow-up workflow draft is needed.

**Harness-delivery gap resolved / superseded (2026-08-08):** the 2026-07-23 finding — the daily pass repeatedly re-applying `pnpm-workspace.yaml` security `overrides` (`brace-expansion`, `fast-uri`) that never landed on `main` under working-dir delivery — no longer applies. Those overrides are absent from the current `pnpm-workspace.yaml`, and the repo now owns its transitive-advisory path through the new in-repo **Renovate + Dependency Review** workflows rather than an autoheal edit the harness couldn't deliver. The autoheal daily pass no longer needs to carry that fix.

Open issues as of 2026-08-08: **#320 (daily report)**, **#238 (publish public operator push privacy policy — precondition to enabling Web Push; owner-filed, carried)**, **#193 (OpenCode Impeccable plugin: cancel the `hook.mjs` subprocess on timeout instead of leaving it detached; dev-tooling only, carried)**, **#112 (dedicated infra-only dispatch App — carried)**, #8 (Renovate dependency dashboard). No new issues opened since 2026-07-23; the queue drained the daily-report churn (#243 → #320) and is otherwise stable.

**Delivery gap fully closed (2026-09-09).** Beyond the 2026-08-08 note that the stranded `pnpm-workspace.yaml` overrides were superseded, the underlying *channel* defect is now fixed at the workflow level — `output-mode: branch-pr` on schedule/dispatch plus trigger-scoped `persist-credentials` (see [Output-mode delivery break](#output-mode-delivery-break-diagnosed-and-fixed-here-2026-08-31)). Both halves of the daemon are live: the review path runs credential-less, the scheduled path can open a PR, and #414 proves it did.

Open issues as of 2026-09-09 — **5, all carried plus today's report; 0 open PRs**: **#455** (`Daily Fro Bot Report — 2026-09-09 (UTC)`, created today), **#238** (push privacy policy, untouched since 2026-07-21 — now the sole blocker on a subsystem that is fully built, see Web Push above), **#193** (Impeccable plugin timeout subprocess cancel, untouched since 2026-07-10), **#112** (dedicated infra-only dispatch App, untouched since 2026-06-26), **#8** (Renovate dashboard). Issue/PR numbering ran #320 → #455 in the month, all of it merged-and-closed dependency traffic. **The three owner-filed issues have not been edited in 45–75 days each** while the same owner shipped 15 merged PRs in the same window — this is a repo where new architecture moves fast and the standing to-do list does not, which is worth knowing before reading any "healthy queue" signal off the issue count.

## 2026-09-09 Corrections

Four claims on this page were verified wrong or incomplete by comparing recursive trees at `2504939` / `5c631a5` / `cb5190d` / `58f9634` / `a7bbb79` / `a11f1b7`. Recorded here rather than silently rewritten, per the wiki's additive rule.

| Claim (as recorded)                                                                 | Correction (2026-09-09)                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture table lists `src/routes/dashboard.ts` — "SSR route using `hono/html` tagged templates" | **The file has not existed since ≤2026-06-26.** It is absent at `5c631a5` and every SHA after. `GET /` serves the SPA shell; the SSR-shell route was carried on this page for **four consecutive surveys**. The `hono/html` auto-escaping claim under Security Model should be read as historical. `test/dashboard.test.ts` survives and is what kept the stale entry plausible. |
| Web Push described only as deferred work (issue #108/#238)                          | **The subsystem shipped by 2026-07-23** — 11 `web/src/push/` modules + tests, `views/Notifications.tsx`, and an `operator-contract/push.ts` barrel member. Absent at `cb5190d`, present at `58f9634`. Unrecorded for two surveys. #238 gates *enabling* it, not building it. |
| No mention of a listener channel                                                    | **`src/listener/` + `src/routes/listener.ts` + `web/src/views/Listener.tsx` + `docs/contracts/operator-listener-channel.md` also landed by 2026-07-23**, with three dedicated server suites. Unrecorded for two surveys.                        |
| 2026-08-08: "security/supply-chain suite landed in-repo — workflows 3 → 7" (implying that wave was the whole story) | **`release.yaml` already carried the two-phase Trivy image scan at `a7bbb79`** (565 lines then, three pin-level diffs since). The container-scanning half of the supply-chain posture was in place and went unrecorded.                          |

Common cause worth naming: the previous four surveys read **workflow files and manifests** carefully and inferred application structure from the *previous page* rather than from a tree listing. Two of these subsystems (push, listener) touch no workflow and no manifest, so they were invisible to that method; the Trivy stage was inside a file the survey said it had covered. The fix is cheap — one recursive tree call per survey, diffed against the prior recorded SHA, which is how all four were caught in a single pass here. Generalized into [[github-actions-ci]].

## Survey History

| Date       | SHA       | Key changes                                                                 |
| ---------- | --------- | -------------------------------------------------------------------------- |
| 2026-06-15 | `2504939` | Initial survey. New repo (created 2026-06-14): read-only Fro Bot monitoring dashboard. Hono + Node 24 strip-only TS, no build step. Read-only-by-construction GitHub App tokens; denylist-before-query + fail-closed redaction reading `fro-bot/.github` `data` branch `metadata/repos.yaml`; single-operator OAuth (Arctic) + signed-cookie sessions + CSRF logout. CI: lint/check-types/test/strip-only-load. Self-hosted `fro-bot.yaml` at agent **v0.64.0** (ecosystem version leader). Mirrors gateway/runtime primitives for a deferred `@fro.bot/runtime` extraction. |
| 2026-06-26 | `5c631a5` | Second survey. **Frontend added:** Vite 8 + React 19 + Tailwind 4 **PWA SPA** (`web/`, Workbox service worker) layered over the Hono backend; tagline now "Command center for Fro Bot operations." New `src/gateway/` operator-client layer (`operator-contract/`, SSE reader, server-fetch) consuming agent's operator API; new `src/routes/operator.ts`. **Release pipeline (`release.yaml`):** CalVer (`YYYY.MM.N`) GHCR build → candidate smoke-test (host-port + sibling-container reachability + SPA manifest + CSP header) → digest-verified promote → GitHub Release → best-effort gated dispatch of infra `deploy-dashboard.yaml`; 30 releases, latest `2026.06.50`. CI grew 4 → 6 jobs (added **Design Check** `impeccable` + **Check Workflows** actionlint; Test now builds SPA first). New docs `DESIGN.md`/`PRODUCT.md`, `.impeccable/config.json`. Agent pin **v0.64.0 → v0.77.0** (ecosystem leader). pnpm 11.5.0 → 11.8.0; eslint 10.5.0; vitest 4.1.9; `@bfra.me/*` 0.51.1/0.13.1. First star (0 → 1). Open issues: #113 daily report, #112 (infra-dispatch dedicated App), #108 (deferred PWA push), #8 dependency dashboard. |
| 2026-07-09 | `cb5190d` | Third survey. **Operator control surface matured** — the nascent `operator-contract/` dir is now a fully vendored, versioned barrel (`OPERATOR_CONTRACT_VERSION = 1.6.0`, vendored from `fro-bot/agent@v0.78.0` gateway + web/sse; documented omissions/import-rewrites). SSE-streamed agent-run views with **approval + run cancellation** (issue #179, contract 1.6.0); expanded `web/src/operator/` client-state layer (`runtime`/`state`/`copy`/`validate-dynamic-id`), `views/Operator.tsx`, `shell/AppShell.tsx`. New **fixture harness** (`dev:fixture`, `build:web:fixture`, `DASHBOARD_FIXTURE_HARNESS_ENABLED`) with sanitization tests. New `GET /api/monitoring` (minimized client snapshot); healthz now carries `contractVersion`. `test/` extracted from `src/` colocation (26 server test files). New `.codex/hooks.json`, `.github/hooks/impeccable.json`, `docs/{brainstorms,ideation,plans,solutions}`. Agent pin **v0.77.0 → v0.84.2** (ecosystem leader); clonedeps pinned agent@v0.78.0. pnpm 11.8.0 → 11.10.0; vite 8.0.16 → 8.1.3; tailwind 4.3.1 → 4.3.2; eslint 10.5.0 → 10.6.0; `@types/node` 24.13.2. `fro-bot.yaml` concurrency reworked to PR-head-SHA keying. Releases 30 → 58 (latest `2026.07.12`). Open: #180 daily report, #179 cancellation, #112, #108, #8. Drift noted: contract `README.md` header still says 1.5.0 vs `version.ts` 1.6.0. |
| 2026-07-23 | `58f9634` | Fourth survey. **Impeccable design gate went in-repo, two forms:** vendored skill `.agents/skills/impeccable/` (full SKILL.md + agents + reference playbooks + scripts detector toolchain) **and** OpenCode plugin `.opencode/impeccable/` (`plugin.ts`/`hook-bridge.ts`/`plugin.test.ts`), with `.opencode/tsconfig.json` folded into `check-types` and new `@opencode-ai/plugin` 1.18.3 devDep. New `assets/` brand-token system (`tokens.css`/`styleguide.md`/`banner.svg`); `.impeccable/critique/` capture. CI Design Check now pins **`impeccable@3.2.1`** (older major ignores `ignoreValues`), was a floating `npx impeccable`. **`@hono/node-server` major bump `^1.14.4 → ^2.0.0`.** Agent pin **v0.84.2 → v0.94.2** (ecosystem leader). Operator contract unchanged (`1.6.0`); clonedeps still agent@v0.78.0 — skew now v0.78.0-inspection vs v0.94.2-action (by design). pnpm 11.10.0 → 11.15.1; vite 8.1.3 → 8.1.5; tailwind 4.3.2 → 4.3.3; eslint 10.6.0 → 10.7.0; vitest 4.1.9 → 4.1.10; `@types/node` 24.13.3. Releases 58 → latest `2026.07.31`. Open issues: #243 daily report, **#238 (public push privacy policy — precondition to Web Push)**, **#193 (opencode plugin timeout subprocess cancel)**, #112, #8; #179 closed. Security: 4 open high transitive-devDep alerts (`brace-expansion`, `fast-uri`) — daily pass's `pnpm-workspace.yaml` overrides fix **not landing on `main`** across 3 runs (harness working-dir-delivery gap, not a repo bug). Renovate: abandoned `arctic` flagged; TS v7 / jest-dom v7 held. |
| 2026-08-08 | `a7bbb79` | Fifth survey. **Security/supply-chain suite landed in-repo — workflows 3 → 7:** new `codeql.yaml` (weekly `javascript-typescript` CodeQL v4), `scorecard.yaml` (weekly OpenSSF Scorecard v2.4.4 + SARIF upload), `dependency-review.yaml` (PR-gated, v5.0.0), and a **self-hosted `renovate.yaml`** (`bfra-me/.github` reusable @v4.16.44) — Renovate was previously org-side only. README gained an **OpenSSF Scorecard badge**; CodeQL/Scorecard parity gap closed. **`Dockerfile` went multi-stage** (`builder`→`prod-deps`→final, new digest `sha256:3638d9a6…`). `.github/renovate.json5` added second preset `microsoft/m365-renovate-config:groupReact#v2.8.4` + `postUpgradeTasks` (`pnpm install`/`pnpm fix`, branch mode). **Prior 2026-07-23 harness-delivery gap superseded** — `pnpm-workspace.yaml` security `overrides` (`brace-expansion`/`fast-uri`) gone; `allowBuilds` added `msgpackr-extract: false`; transitive-advisory path now owned by Renovate + Dependency Review. Agent pin **v0.94.2 → v0.97.0** (`3f19f02`, co-leader with [[marcusrbrown--gpt]]). Operator contract unchanged (`1.6.0`); clonedeps still agent@v0.78.0. Octokit patch bumps (core 7.0.7 / auth-app 8.3.0 / graphql 9.0.4); pnpm 11.15.1 → 11.20.0; vite 8.1.5 → 8.2.0; react 19.2.7 → 19.2.8; eslint 10.7.0 → 10.8.0; `@opencode-ai/plugin` 1.18.3 → 1.18.14. Releases 58 → 104, latest `2026.08.14`. Open issues: #320 daily report, #238, #193, #112, #8 (no new issues; #243 → #320 daily-report churn only). Carried drift: contract `README.md` header still says `1.5.0` vs `version.ts` `1.6.0`. |
| 2026-09-09 | `a11f1b7` | Sixth survey. **The read-only invariant was narrowed on purpose, and the fleet's delivery break was fixed here first.** (1) **`wiki-writer/` workspace member** — repo becomes a pnpm workspace (`packages: [wiki-writer]`); description/README/both agent prompts all restate the identity as "read-only **by default**, with one isolated wiki-write capability." 10 src modules + 10 tests incl. `security-boundary.test.ts`; separate Fro Bot App identity (`APPLICATION_ID`, distinct from the read-only `DASHBOARD_GITHUB_APP_*`), `data`-branch + path-allowlist scope, gates from `@fro-bot/wiki-write-core`; README states its own residual risk and says the service "is not built yet" while the package is on `main` (scope claim, not tree claim). Landed #420 security-def → #423 plan → #424 skeleton → #425 gate pin + drift check → #430 write path + operation ledger, all merged same/next day. **Three findings on the gate dependency:** pinned as `github:fro-bot/.github#37abb495&path:packages/wiki-write-core` — **Renovate lists only 3 deps for `wiki-writer/package.json` and the git ref is not among them**; the SHA is an ordinary control-plane `main` commit (a mise bump), so there is no version signal; the package is `private`/`0.0.0` with **33 committed `dist/` artifacts**, drift instrumented by #425. **Two coverage gaps:** the strip-only *Test Scripts Load* job and `SCHEDULE_PROMPT` 4b both still scope to `find src`, missing `wiki-writer/src` (root vitest + root tsc *do* cover it). (2) **Output-mode delivery break diagnosed and repaired** (#413 fix / #415 learning / #416 credential scoping / #418 correction, all 2026-08-31): `output-mode: branch-pr` scoped to schedule+dispatch, `persist-credentials` made conditional so review paths run credential-less — first repo-side fix of the class recorded in [[marcusrbrown--tokentoilet]] / [[marcusrbrown--mothership]] / [[marcusrbrown--infra]]; proof of life is agent-authored **#414** (`fix(web)` closing CodeQL #31) **merged**. Daemon green 3/3 scheduled; 27/30 recent runs `skipped` (bot-authored trigger surface). (3) **`arctic` dropped** (#401) → direct GitHub OAuth calls; abandoned-dep flag retired. (4) **Override ledger returned** (#400, 2026-08-30) — `brace-expansion@2`/`@5`, `fast-uri@3`, **new `undici@7`** — contradicting the 2026-08-08 "superseded" reading: a PR-scoped advisory gate does not remediate an already-resolved transitive; new `minimumReleaseAgeExclude`. (5) **Docker** → stock `USER node` (uid 1000, was bespoke `dashboard` 1001, #406) with the release smoke assertion updated in lockstep; base digest `ba849c60…`; workspace manifest copied into `builder`+`prod-deps` so the git dep resolves during the production install. (6) **Four corrections** (see 2026-09-09 Corrections): `src/routes/dashboard.ts` gone since ≤2026-06-26 (carried 4 surveys); **Web Push** and the **listener channel** both landed ≤2026-07-23 and went unrecorded twice; **two-phase Trivy image scan** (report-all SARIF `exit-code 0` + enforce `ignore-unfixed` `exit-code 1`) already present at `a7bbb79`. (7) Agent pin **v0.97.0 → v0.109.4** (`b799b64`, 8 same-day merges); `bfra-me/.github` renovate reusable v4.16.44 → **v4.26.0**; pnpm 11.20.0 → 11.25.0, eslint 10.8.0 → 10.10.0, vite 8.2.2, vitest 4.1.11, `@bfra.me/eslint-config` 0.52.1, tsconfig 0.13.2, `@opencode-ai/plugin` 1.18.29, Octokit core 7.0.8 / auth-app 8.3.1 / graphql 9.0.5; TS held at 6.0.3. Latest release `2026.09.6` (2026-09-07). **Queue: 0 open PRs, 5 open issues (#455 today's report, #238/#193/#112 carried 45–75 days untouched, #8) — and 11 majors parked in the Dependency Dashboard's pending-approval block** (TS v7, Vitest v5, pnpm v12, jsdom v30, jest-dom v7, Actions majors, all three override caps), the third fleet mechanism behind an empty-looking queue. Carried drift, **4th survey**: contract `README.md` header still `1.5.0` vs `version.ts` `1.6.0`; `--yes impeccable` Renovate lookup warning still present. |
