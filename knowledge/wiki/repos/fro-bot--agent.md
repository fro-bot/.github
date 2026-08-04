---
type: repo
title: "fro-bot/agent"
created: 2026-05-07
updated: 2026-07-21
sources:
  - url: https://github.com/fro-bot/agent
    sha: 9a4631f81a3d73d06bb18098e468b0cae52906b3
    accessed: 2026-07-21
  - url: https://github.com/fro-bot/agent
    sha: 8ee84bb01967ad1f58fafde9a47c7ca27a9aa73d
    accessed: 2026-07-07
  - url: https://github.com/fro-bot/agent
    sha: 20e9f346f2129f28800029b47489cd14bc6ce847
    accessed: 2026-06-24
  - url: https://github.com/fro-bot/agent
    sha: a23ae97c433d815974cfd009bec64748c0a63ad6
    accessed: 2026-06-14
  - url: https://github.com/fro-bot/agent
    sha: 34abe2abc779e942444df86342956542dbfc6b3c
    accessed: 2026-06-04
  - url: https://github.com/fro-bot/agent
    sha: d0f39a25b443b60e51da709b9d13065d6a62d157
    accessed: 2026-06-03
  - url: https://github.com/fro-bot/agent
    sha: 8632cf4706b10f7350284c3f0480dd620f2a30b7
    accessed: 2026-05-22
  - url: https://github.com/fro-bot/agent
    sha: ef6b9525583d13f9443b80e6ceffff8af978410a
    accessed: 2026-05-08
  - url: https://github.com/fro-bot/agent
    sha: ef6b9525583d13f9443b80e6ceffff8af978410a
    accessed: 2026-05-07
tags: [github-actions, agent, opencode, omo, omo-slim, typescript, persistent-memory, ci-cd, fro-bot, semantic-release, bun-workspace, monorepo, discord, effect, hono, docker-compose, mitmproxy, harness, orw, trusted-publishing, oidc, operator-web-surface, oauth, sse, sbom, credential-broker, shared-runtime, run-cancellation, release-notes-narration, prompt-injection-hardening, review-skip-label]
related:
  - fro-bot--dashboard
  - marcusrbrown--systematic
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--infra
  - marcusrbrown--containers
  - marcusrbrown--vbs
  - marcusrbrown--gpt
  - marcusrbrown--copiloting
  - marcusrbrown--dotfiles
  - marcusrbrown--mrbro-dev
  - marcusrbrown--tokentoilet
  - marcusrbrown--renovate-config
---

# fro-bot/agent

GitHub Action harness for [OpenCode](https://opencode.ai/) + [Oh My OpenAgent (oMo)](https://github.com/code-yeongyu/oh-my-openagent) with **persistent session state** across CI runs. This is the core runtime that powers Fro Bot's PR review, issue triage, scheduled maintenance, and wiki-update capabilities across all managed repositories.

## Overview

| Attribute              | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| Created                | 2026-01-02                                                         |
| Last push              | 2026-07-20 (survey 2026-07-21, HEAD `9a4631f`)                     |
| Latest release         | v0.94.0 (2026-07-21; was v0.83.1 @ 2026-07-07) — 11 minors + patches in ~2 weeks |
| Language               | TypeScript (strict, ESM-only)                                      |
| Node.js                | `node24` action runtime; Docker images pin via `.node-version`    |
| Package manager        | **Bun 1.3.14** (`packageManager: bun@1.3.14`, `bun.lock`, `bunfig.toml`) — Bun cutover holds; `pnpm-lock.yaml`/`pnpm-workspace.yaml` remain removed |
| Runtime                | `node24` (GitHub Action `runs.using`); `.node-version` 24.18.0     |
| Bundler                | tsdown 0.22.7 (Rolldown-based, dual entry points)                 |
| Test framework         | Vitest 4.1.10                                                      |
| Lint                   | ESLint 10.7.0 (`@bfra.me/eslint-config` 0.51.1), Prettier 3.9.5   |
| TypeScript             | 6.0.3                                                              |
| OpenCode default       | **Harness build `1.18.4+harness.1ff4b323`** — `DEFAULT_OPENCODE_VERSION` is a harness GitHub-Release tag; SDK at 1.17.20; harness `base_version: 1.18.4` (rebased 1.17.14 → 1.17.20 → 1.18.4; **12 integration refs** now, was 10) |
| Release                | semantic-release on `release` branch, `next` → `release` PR model  |
| Visibility             | Public                                                             |
| Stars                  | 3                                                                  |
| Open issues            | 6 (carried set: #1134 gateway test SIGTERM/SIGINT listener leak, #1126 harness-integrate mint scoped `contents:write` token inline, #1124 wire broker-minted App token into harness-integrate, #1069 action/gateway run-execution timeout tracking, #579 dep dashboard, #252 DMR — count flat at 6 across the window; per-issue set carried forward, GitHub API not queried this run) |
| Open PRs               | 6 (mostly Renovate dep bumps + the standing pending-release PR on `next`; individual PR numbers drift faster than this survey — not enumerated) |
| Topics                 | actions, agent, automation, bot, fro-bot, github-actions, github-app |

## Architecture

### Workspace Layout

Bun workspace monorepo (`workspaces: [apps/*, packages/*]`). The workspace has **five members** (`packages/harness` added at v0.53.0, #752; `apps/workspace-agent` at v0.45.0):

- **`apps/action`** (`@fro-bot/action`) — The GitHub Action entry points. Private, no publish. Depends on `@fro-bot/runtime`.
- **`apps/workspace-agent`** (`@fro-bot/workspace-agent`) — Shipped v0.45.0 (#674). Small Hono HTTP service that runs *inside* the workspace container; the gateway calls it over the internal `sandbox-net` so the gateway never mounts `/var/run/docker.sock`. Depends on `hono` 4.12.23 + `@hono/node-server` 1.19.14. Builds to `dist/main.mjs`. See "Workspace Agent" below.
- **`packages/runtime`** (`@fro-bot/runtime`) — Shared runtime library. Private, exports source-level TS (no pre-built dist; consumed via workspace protocol). Hand-rolled `Result<T, E>` from `@bfra.me/es` is the error convention here. **As of v0.45+ the shared layer (`src/shared/constants.ts`, the pinned-version constants) lives here at `packages/runtime/src/shared/constants.ts`** — the `apps/action` Layer 0 now re-exports from the runtime rather than owning the canonical constants. **Consolidation confirmed (survey 2026-07-07):** `packages/runtime/src/` now carries five top-level dirs — `agent/` (execution, prompt, prompt-thread, output-mode, reference-files, remote-client, server, setup-adapter, retry, `error-format/`), `coordination/` (`lock`, `heartbeat`, `run-state`, `self-test`, `adapter-guards`), `object-store/` (`s3-adapter`, `content-sync`, `key-builder`, `validation`, `types`), `session/`, `shared/`. The S3 object-store code long noted as "migrated somewhere" is now concretely `packages/runtime/src/object-store/`, and durable locks / run-state / heartbeat leases live in `coordination/` — the primitives the gateway wraps in `runtime-effect.ts`.
- **`packages/gateway`** (`@fro-bot/gateway`) — New 2026-05-22. Long-running Discord-first daemon. Wraps `@fro-bot/runtime` with `effect` 3.21.2 as the composition layer. Depends on `discord.js` 14.26.4, plus `hono` 4.12.23 + `@hono/node-server` for its HTTP surfaces. Builds to `packages/gateway/dist/` via `tsdown`.
- **`packages/harness`** (`@fro.bot/harness`) — **New 2026-06-04 (shipped v0.53.0, #752).** Published, public, OIDC-trust-published CLI package: a *patched OpenCode binary* built via [cortexkit/orw](https://github.com/cortexkit/orw)'s LLM-merge integration method — now "the default OpenCode for Fro Bot," replacing the stock OpenCode download in action setup. The only published-to-npm member (the others are private). Builds to `dist/cli.mjs`; root `build`/`test`/`lint` scripts now include it (`pnpm --filter @fro.bot/harness ...`). See "Harness (`@fro.bot/harness`)" below.

**Note (2026-06-03):** Both a root `src/` tree (`features/`, `harness/`, `services/`, `shared/`, `index.ts`, `main.ts`, `post.ts`) and `apps/action/src/` exist. The action.yaml still points at root `dist/main.js` / `dist/post.js`, so root `src/` remains the action's compiled source of truth while `apps/action` carries the workspace-published package manifest. The migration of the action into `apps/action` is in progress, not complete.

Root `tsdown.config.ts` bundles `apps/action/src/main.ts` and `apps/action/src/post.ts` into `dist/main.js` and `dist/post.js`. The `dist/` directory is **committed** (GitHub Action requirement — no build step at consumption time).

The gateway has its own `dist/` not committed at root — it's a runtime daemon shipped via the Docker stack in `deploy/`, not consumed as an action.

**Bun migration (between v0.63.0 and the 2026-06-24 survey).** The repo moved its package manager from **pnpm 11.x to Bun 1.3.14**. Evidence on `main` HEAD `20e9f34`: `package.json` declares `"packageManager": "bun@1.3.14"`, root `bun.lock` + `bunfig.toml` exist, `pnpm-lock.yaml`/`pnpm-workspace.yaml` are gone, all root scripts run `bun run --filter <pkg> ...` (was `pnpm --filter`), `simple-git-hooks` runs `bunx lint-staged` / `bun run lint && bun run build`, and `trustedDependencies: [esbuild, simple-git-hooks, unrs-resolver]` replaces the old `onlyBuiltDependencies`. The `overrides` block (brace-expansion, fast-uri, fast-xml-*, flatted, handlebars, ip-address, lodash, picomatch, tar, undici `>=7.24.0`, vite `8.0.16`, yaml) now lives back in root `package.json` `overrides` (it had migrated to `pnpm-workspace.yaml` at v0.45.0 — this reverses that). The harness native build is also Bun-based now (see `HARNESS_BUN_VERSION` / `bun-version` workflow inputs below).

### Layered Source Structure

The codebase follows a strict four-layer dependency hierarchy (~145 source files, ~15k lines):

| Layer | Directory        | Responsibility                                                                 |
| ----- | ---------------- | ------------------------------------------------------------------------------ |
| 0     | `src/shared/`    | Pure types, utils, constants — no external deps                                |
| 1     | `src/services/`  | External adapters: GitHub client, cache, session persistence, setup, artifact upload |
| 2     | `src/features/`  | Business logic: agent execution, triggers/routing, comments, reviews, attachments, delegated branch/PR ops, observability |
| 3     | `src/harness/`   | Workflow composition: entry points, phase orchestration, config parsing         |

**Note (2026-05-08):** The AGENTS.md listed `object-store/` in Layer 1 services, but the actual directory listing showed `artifact/` instead (containing `upload.ts`, `upload.test.ts`, `index.ts`). The S3-compatible object-store functionality may have been refactored or the AGENTS.md was stale relative to the current directory structure. S3 backup configuration remains in the action inputs, so the capability likely moved elsewhere (possibly into `services/session/` or `services/cache/`).

**Update (2026-05-22):** `src/services/` confirms the new layout: `artifact/`, `cache/`, `github/`, `session/`, `setup/` — `object-store/` is gone from the action's src tree. The S3 object-store functionality appears to have migrated either into the gateway/runtime split (`@fro-bot/runtime` is the dependency the gateway uses for `S3 sync helpers`, per `packages/gateway/AGENTS.md`) or been folded into session/cache write-through. The action's AGENTS.md (dated 2026-03-29, commit `045cac8`) is now stale relative to this layout.

Entry points (`src/main.ts`, `src/post.ts`) are thin delegates to `src/harness/run.ts` and `src/harness/post.ts`.

### Key Subsystems

**Persistent memory** — Sessions survive workflow runs via GitHub Actions cache (branch-scoped key: `opencode-storage-{repo}-{branch}-{os}`). Optional S3-compatible write-through backup (AWS S3, Cloudflare R2, Backblaze B2, MinIO) provides durable canonical storage surviving cache eviction.

**Event routing** — `src/features/triggers/router.ts` normalizes 7 GitHub event types into a `NormalizedEvent` discriminated union (8 variants). Access gating enforces `OWNER`/`MEMBER`/`COLLABORATOR` association; bots and fork PRs are filtered.

**Agent execution** — `src/features/agent/execution.ts` runs OpenCode via `@opencode-ai/sdk`. Prompts are built via XML-tagged architecture in `src/features/agent/prompt.ts`. Context is hydrated via GraphQL (`src/features/context/`) per RFC-015.

**Setup / auto-install** — `src/services/setup/` handles zero-config installation of Bun, OpenCode, and (opt-in) oMo / OMO Slim on first run. `ci-config.ts` assembles `OPENCODE_CONFIG_CONTENT` with injected `@fro.bot/systematic` plugin configuration via `systematic-config.ts`.

**OMO Slim (new v0.49.0, #722)** — `oh-my-opencode-slim` is an *optional* lighter-weight orchestration plugin, opt-in via `enable-omo-slim` and **mutually exclusive with `enable-omo`**. Pinned at `DEFAULT_OMO_SLIM_VERSION = '1.1.1'` (stable line only — the `2.0.0-beta` channel is deliberately not the default). A fifth Renovate custom regex manager tracks it on the npm datasource. `omo-slim-preset` (default `openai`) selects the provider preset. The constant comment notes the version pin tracks the stable line, not the beta — a guardrail against an automated bump dragging the daemon onto a pre-release.

**Delegated work** — `src/features/delegated/` supports branch creation, commits, and PR operations for `branch-pr` output mode. Gated by `output-mode` action input.

**Post-action hook** — `dist/post.js` (RFC-017) runs after the main action to durably save session state back to cache and S3.

## Action Interface

### Key Inputs

| Input                | Default      | Purpose                                             |
| -------------------- | ------------ | --------------------------------------------------- |
| `github-token`       | (required)   | GitHub token with write permissions                 |
| `auth-json`          | (required)   | JSON map of LLM provider credentials                |
| `prompt`             | —            | Custom prompt for the agent                         |
| `output-mode`        | `auto`       | Delivery mode: `auto`, `working-dir`, `branch-pr`   |
| `agent`              | (unset)      | Primary agent name (defaults to OpenCode build agent if unset; was `sisyphus` @ v0.42.x) |
| `enable-omo`         | `false`      | Opt-in to Oh My OpenAgent for extended providers/agents (oMo is not auto-installed) |
| `enable-omo-slim`    | `false`      | **New v0.49.0 (#722).** Opt-in to OMO Slim (`oh-my-opencode-slim`) orchestration. **Mutually exclusive with `enable-omo`.** |
| `omo-slim-preset`    | `openai`     | **New v0.49.0.** OMO Slim provider preset (only when `enable-omo-slim`)            |
| `omo-providers`      | (empty)      | Default oMo providers (empty = free OpenCode models) |
| `model`              | —            | Model override (`provider/model` format)            |
| `timeout`            | `1800000`    | Execution timeout in ms (0 = no limit)              |
| `session-retention`  | `50`         | Sessions to retain before pruning                   |
| `skip-cache`         | `false`      | Skip session cache restore                           |
| `s3-backup`          | `false`      | Enable S3 write-through canonical backend           |
| `s3-key-prefix`      | `fro-bot-state` | Prefix for all S3 keys                            |
| `s3-expected-bucket-owner` | —      | AWS account ID guard against bucket-name squatting  |
| `s3-allow-insecure-endpoint` | `false` | Allow HTTP S3 endpoints (local MinIO dev only)   |
| `s3-kms-key-id`      | —            | KMS key for SSE-KMS encryption                      |
| `s3-sse`             | (computed)   | SSE mode `aws:kms` (AWS) or `AES256` (custom endpoint) |
| `aws-region`         | —            | AWS region for S3 bucket                             |
| `dedup-window`       | `600000`     | Skip if agent ran for same entity within window (ms; best-effort suppression) |
| `opencode-version`   | (pinned)     | Override OpenCode CLI install version               |
| `omo-version`        | (pinned)     | Override oMo install version                         |
| `systematic-version` | (pinned)     | Override Systematic plugin version                  |
| `opencode-config`    | —            | Custom OpenCode config JSON (deep-merged)           |
| `omo-config`         | —            | Custom oMo config JSON (deep-merged)                |
| `systematic-config`  | —            | Custom Systematic plugin config JSON (deep-merged)  |

### Outputs

| Output                | Description                                       |
| --------------------- | ------------------------------------------------- |
| `session-id`          | OpenCode session ID used for this run             |
| `resolved-output-mode`| Resolved delivery mode for this run               |
| `cache-status`        | Cache restore status (`hit`/`miss`/`corrupted`)   |
| `duration`            | Run duration in seconds                           |

## Discord Gateway (new 2026-05-22)

`packages/gateway` is a Discord-first daemon — the "Category B" feature long planned in `FEATURES.md` has shipped as runnable code.

| Aspect              | Detail                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Entry point         | `packages/gateway/src/main.ts` — wires Discord client, registers slash commands, SIGTERM    |
| Composition layer   | `effect` 3.21.2 — `Effect.Effect<A, E, R>` everywhere outside the runtime adapter            |
| Runtime adapter     | `packages/gateway/src/runtime-effect.ts` — sole `Result<>` → `Effect` boundary               |
| Discord library     | `discord.js` 14.26.4 with non-privileged intents (`Guilds`, `GuildMessages`) by default      |
| Privileged intents  | Opt-in via `DISCORD_PRIVILEGED_INTENTS` env var                                              |
| Secret loading      | `readSecret(name)` checks `${NAME}_FILE` first (Docker secrets), falls back to env var       |
| Lifecycle           | Long-running; SIGTERM handler with 25s drain                                                 |

### Effect / Result Boundary

The gateway is the **only** package using `effect`. The action runner (cold-start sensitive) and the runtime stay on hand-rolled `Result<T, E>`. Subagents adding a runtime call must add the wrapper to `runtime-effect.ts` first, never import `@fro-bot/runtime` directly outside the adapter.

Wrapped runtime functions: `acquireLock`, `releaseLock`, `renewLease`, `forceReleaseLock`, `createRun`, `transitionRun`, `findStaleRuns`, `validateProviderSemantics`, plus S3 sync helpers. This implies the runtime now owns durable lock, run-state, and S3 primitives that were previously scattered (or planned) — these were likely the migration target for `services/object-store/`.

Effect surface used at Unit 4: core (`Effect`, `pipe`, `tryPromise`, `flatMap`, `gen`, `runPromise`, `try`, `succeed`, `fail`, `either`, `void`, `catchAll`). Planned for later units: `Schedule.*` (retry), `Schema.*` (payload validation). DI / Layer / Context / STM / Streams deliberately not used at v1.

### Gateway Capability Evolution (v0.45.0 → v0.51.0)

The gateway moved from "wired but inert" to a working Discord control plane over this window. As of the 2026-06-24 survey the `src/` layout has grown three new top-level dirs — `operator-contract/`, `redaction/`, `web/` — alongside `approvals/`, `bindings/`, `discord/`, `execute/`, `github/`, `http/`, `workspace-api/`, plus `program.ts`, `readiness.ts`, `runtime-effect.ts`, `shutdown.ts`:

| Version | Capability                                                                                   |
| ------- | -------------------------------------------------------------------------------------------- |
| v0.45.0 | Channel↔repo **bindings store** (#672); GitHub App authentication (#673)                      |
| v0.46.0 | `/fro-bot add-project` slash command (#676) — binds a channel to a repo                       |
| v0.48.0 | `@fro-bot` **mention-triggered OpenCode execution** (#705) — the gateway can now run the agent |
| v0.51.0 | **Approval prompts for sensitive tool calls** (#737); fail-fast provider-semantics self-test at boot (#739); opt-in announce/presence endpoint (#740) |
| v0.52.0 | Tool-progress rendering migrated to the **OpenCode 1.15.13 event contract** (#744) — tool lifecycle + text now arrive via `message.part.updated` / `message.part.delta`; legacy `session.next.tool.*` / `session.next.text.delta` handlers retained as fallback |
| v0.57.0 | `daily_digest` **presence event** (#826) on the announce/presence endpoint                |
| v0.59.0 | **Live status message + typing indicator** for mention runs (#843) — real-time feedback during agent execution |
| v0.60.0 | **Serial per-channel queue** for mentions (#850) — prevents races when concurrent mentions arrive in one channel; **`/fro-bot force-release-lock`** operator command + run reactions (#854) to manually clear stuck release locks |
| v0.61.0 | Discord sends centralized behind **fail-soft io helpers** (#858); shared guild-command pipeline (#859); Effect failure-channel discipline pass (#863) |
| v0.65.0 | **Transport-agnostic execution + approval seam** (#920) — the execute/approval path decoupled from the Discord transport so a web transport can reuse it |
| v0.66.0 | Operator **listener topology** (#931); web operator surface **spine** prepared (#929) |
| v0.67.0 | Operator **audit seam** (#934); operator **route guardrail seam** (#932) |

See "Operator Web Surface" below for the v0.66.0–v0.76.1 web-command-spine arc (#907).

The Discord-side approval flow (#737) is the human-in-the-loop gate for the daemon path that CI runs don't need — sensitive tool calls now surface a prompt before executing. The boot-time provider-semantics self-test (#739) fails fast rather than letting a misconfigured provider produce silent garbage at request time — the same `validateProviderSemantics` primitive the runtime already exposed, now run eagerly.

### Operator Web Surface (new v0.66.0–v0.76.1, "web-command spine", #907)

The dominant theme of the v0.64→v0.76 release wave is a second control plane for the gateway: a **web operator surface** that gives a browser-authenticated operator the same launch/observe/approve capabilities the Discord transport already had. It builds on the v0.65.0 transport-agnostic execution seam (#920), which decoupled execute/approval logic from the Discord transport. Tracking issue #907 ("Gateway inbound control surface + operator web auth") frames the arc; the operator-auth authority decision is recorded in `docs/solutions/` (S2, #951/#956).

Three new gateway `src/` dirs carry it:

- **`operator-contract/`** — the owned, frozen operator API contract (v0.71.0, #952; pinned/documented v0.76.1, #996). Files: `approval`/`approval-frame`, `identity`, `output`, `parse`, `redaction`, `repo-summary`, `responses`, `run-status`, `version` (each with tests) + `index.ts`. This is the stable interface boundary between gateway internals and any operator transport.
- **`redaction/`** — the metadata-redaction gate that honors `metadata/repos.yaml` redaction policy on operator surfaces (v0.72.0, #955). Files: `denylist`, `metadata-reader`, `reader-app-client`, `surface-gate`, plus a `redaction-gate.integration.test.ts`. This is where the public-only / private-repo redaction discipline is enforced on the web surface.
- **`web/`** — the HTTP operator server itself: `server.ts`, `operator-route.ts`, `audit.ts`, `safe-response.ts`, and subdirs `auth/`, `operator/`, `sse/`.
  - `web/auth/` — operator GitHub OAuth (foundation v0.68.0 #936; browser auth gate v0.69.0 #944; session foundation v0.69.0 #939; session-info route v0.70.0 #948; repo authorization helper v0.70.0 #947). Files: `github`, `session`, `csrf`/`csrf-route`, `allowlist`, `repo-authz`, `session-info-route`. OAuth callback hardened to redirect only to a validated `return_to` (v0.74.0 #977).
  - `web/sse/` — authenticated Server-Sent-Events run observation: `manager`, `projection`, `run-stream-route`. v0.72.0 streamed run status over an inert SSE core (#961) then added the authenticated run-stream route (#962); v0.73.0 shipped the **web operator launch surface** (#968); v0.74.0 streamed web-launched run **output** to the operator (#974) and observed queued/failed runs via `launchWork` admission (#970).
  - `web/operator/` — the operator route handlers: `launch-route`, `decision-route`, `repos-route`, `pending-approvals-route`, `session-info-route`, `idempotency`, `web-approval`, `web-sinks`. v0.76.0 added the **web tool-approval flow** (#986) — the browser equivalent of the Discord approval prompt.

**Open gaps (2026-06-24):** #1001 — `GET /operator/repos` is never mounted (`listBindings` dep not wired into `startOperatorServer`, so it 404s instead of 401); #1000 — the operator redaction gate strips all legacy (keyless) bindings but `backfill-deny-keys` has no runnable entrypoint in the shipped image. Both are correctness gaps in the freshly-landed surface, consistent with a control plane that shipped its routes faster than its wiring.

**Gaps resolved (survey 2026-07-07).** The route-wiring debt closed in the v0.77–v0.78 wave: v0.77.0 **mounted the operator launch route** (`POST /operator/runs`, #1030) and added an **image-level route-registration smoke test** plus mounted approval routes (#1031); v0.78.0 added the **`GET /operator/runs` run-index route** (#1038 deduped its listing fanout). The dependency-gated route-registration guard is compounded in `docs/solutions/` (#1032). Later operator-surface features: v0.82.0 **emits `contractVersion` on the operator health body** (#1096); v0.83.0 added **operator-initiated run cancellation** (#1111, closes #1055), **exposes a sanitized operator failure reason on run status** (#1113), and **counts events in run-core to distinguish a hang from a lost-event timeout** (#1116). Both #1001 and #1000 are no longer in the open-issue set.

This surface is daemon-side only — it does not change the GitHub Action's CI behavior. CI runs still go through the action entry points; the operator web surface is part of the `deploy/` gateway daemon.

## Workspace Agent (`apps/workspace-agent`, new 2026-06-03 / v0.45.0)

A small Hono HTTP service that runs **inside** the workspace container. The gateway calls it from outside over the internal compose network (`sandbox-net`), so the gateway never needs to mount `/var/run/docker.sock` or shell out to `docker`. This is the load-bearing half of what was the `workspace` placeholder.

| Aspect              | Detail                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Entry point         | `apps/workspace-agent/src/main.ts` → `dist/main.mjs`; container entrypoint runs it on **port 9100** (internal only, no `ports:` mapping) |
| Stack               | `hono` 4.12.23 + `@hono/node-server` 1.19.14                                                  |
| Endpoints           | `GET /healthz` (liveness), `POST /clone` (clone repo into `/workspace/repos/{owner}/{repo}`)  |
| OpenCode provisioning | `opencode-server.ts` / `opencode-proxy.ts` — v0.50.0 (#728) provisions OpenCode model, provider config, and auth into the workspace executor; v0.50.0 (#725) builds the executor image |
| Source files        | `clone.ts`, `sanitize.ts`, `config.ts`, `server.ts`, `opencode-server.ts`, `opencode-proxy.ts`, `types.ts` (each with `*.test.ts`) |

### Clone Hardening (untrusted-input discipline)

The `/clone` endpoint treats caller input as hostile — a clean reference for how the project models sandbox boundaries:

- Caller provides `{owner, repo, token}` only; the **destination path is derived internally** — callers never control where the repo lands.
- Owner/repo validated against `[A-Za-z0-9._-]+`; bare `.` and `..` explicitly rejected before path construction.
- Token injected via `GIT_ASKPASS`, passed through `GITHUB_TOKEN` env (never in argv, never in the askpass script body). Git trace env vars suppressed; stderr scrubbed of credential patterns.
- Post-clone `realpath` check confirms the path is within `/workspace/repos/` (symlink-escape detection → `path-escaped-workspace`).
- Atomic clone: written to a temp dir, renamed to dest on success; partial clones never reach the destination.
- Body capped at 4 KB; requests without `Content-Length` rejected; concurrency-limited (`overloaded` → 503).

19 distinct error codes (`invalid-owner`, `invalid-token-shape`, `enospc`, `clone-timeout`, etc.) give the gateway a precise failure taxonomy rather than opaque 500s.

## Harness (`@fro.bot/harness`, new 2026-06-04 / v0.53.0)

`packages/harness` ships a **patched OpenCode binary** as the default OpenCode for Fro Bot. It embeds [cortexkit/orw](https://github.com/cortexkit/orw)'s integration method: on each deliberately-pinned upstream OpenCode release, it bases an integration branch on the release tag, fetches a configured set of integration refs (stalled/closed upstream PRs, branch URLs), and runs an LLM merge (`opencode run`) to carry those refs onto the release tag — resolving base drift that `git am`/cherry-pick cannot handle. This is the project's answer to depending on stalled-but-needed upstream fixes without forking.

| Aspect              | Detail                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Package             | `@fro.bot/harness` — the **only published** workspace member (`publishConfig.access: public`) |
| CLI                 | `bin: harness` → `dist/cli.mjs`. Subcommands `info` / `patches` / `doctor` are harness-own; `--version` / `--help` harness-own; **everything else passes through** to the patched binary with inherited stdio/env/exit code |
| Provenance          | upstream release tag + ordered integration refs (each pinned by upstream commit SHA) + frozen integration commit SHA + build sha; reported by `harness info`/`patches`/`doctor` |
| Config              | `harness.config.json` (2026-07-21): `release_repo: anomalyco/opencode`, `base_version: 1.18.4`, `integrationRefs: [anomalyco/opencode PRs #19961, #31859, #31638, #33134, #33159, #33444, #31922, #34975, #34977, #33713, #36045, #36361]` — **12 refs now** (was 10 @ v0.83.1; +#36045, #36361; carry set churned mid-window — v0.91.0 #1220 retired superseded refs, intermediate 1.17.20 builds briefly ran 15–16 refs before settling to 12), merge `agent: build`, merge **`model: anthropic/claude-sonnet-5`** (was `claude-sonnet-4-6`), `opencode_bin: opencode` |
| Per-platform dist   | main package + four native packages (`@fro.bot/harness-{linux-x64,linux-arm64,darwin-x64,darwin-arm64}`) + musl Linux assets; Windows out of scope. `postinstall` resolver (`resolve-binary.ts` → `platform.ts`) selects host binary; `OPENCODE_PATH` / bare `opencode` on PATH are fallbacks |
| Native build        | Bun-based: pinned by `HARNESS_BUN_VERSION` in `packages/harness/src/bun-version.ts` (Renovate-tracked against `oven-sh/bun` releases), kept in lockstep with the `bun-version` input in `harness-release.yaml` (build + publish jobs) and the `BUN_VERSION` ARG in `deploy/gateway.Dockerfile` |
| Source files        | `cli.ts`, `integrate.ts`, `sources.ts`, `provenance.ts`, `resolve-binary.ts`, `platform.ts`, `verify.ts`, `version.ts`, `base-version.ts`, `postinstall.ts` (each with `*.test.ts`) |

### Build / Publish Pipeline (`harness-release.yaml`)

The LLM merge runs **once per release bump** in CI, is maintainer-reviewed as the bump PR, and is **frozen** — its SHA is pinned. Per-platform builds pin to the frozen integration commit. The action consumes the published, frozen, pre-built binary; **the merge never runs during an action invocation.**

The release workflow is fenced (manual `workflow_dispatch` with `integration_commit` + `base_version` inputs, or a protected `harness-v*` tag push — never on PR or non-release push). Security posture:

- **Build job is read-only, no `id-token`** — the untrusted LLM-merge + upstream build runs here and must not be able to publish or obtain OIDC tokens. Build matrix mirrors upstream native runners (linux x64/arm64, darwin x64/arm64), `fail-fast: true` (all-or-nothing).
- **Publish via npm trusted publishing (OIDC)** — no long-lived token; `id-token: write` scoped to the publish job only. Provenance is automatic; bare `npm publish` after upgrading npm to ≥ 11.5.0.
- **`optionalDependencies` injected at publish time** — the per-platform packages are deliberately *not* in the source `package.json` (keeps `pnpm-lock.yaml` clean since they only exist on npm after a release); the workflow injects version-pinned `optionalDependencies` into the published main package.
- **Bootstrap caveat:** npm trusted publishing requires a package to already exist; the first release of the five packages needs a one-time token-authenticated bootstrap (or pending-publisher flow), after which OIDC governs all subsequent publishes.

**Credential-broker consumer side (observed from [[marcusrbrown--infra]] survey 2026-07-01):** infra shipped an OIDC-authenticated credential broker (`apps/broker`, `broker.fro.bot`) that exchanges a GitHub Actions OIDC token for a short-lived, revocable cliproxy key so the durable provider key never lands on a CI runner. The consuming integration — an integrate job requesting an OIDC token for the broker audience, POSTing to `/v1/mint`, and injecting the returned OpenCode `auth.json` — is expected to land here and is tracked in `fro-bot/agent#1060`. infra's `BROKER_TRUST_POLICY` carries placeholder `repository_id`/`repository_owner_id`/`workflow_ref` values that must be replaced with this repo's real IDs before the broker deploys. (Survey-side detail; re-confirm against agent source on the next agent survey.)

**Consumer side landed (v0.80.0, #1081, closes #1060) — confirmed at source (survey 2026-07-07).** The broker consumer is now live in a dedicated **`harness-integrate.yaml`** reusable workflow (`workflow_call`). Its single `integrate` job holds `id-token: write` (`contents: read`); it hardens runner egress to `broker.fro.bot:443`, runs `scripts/harness/mint-broker-credential.ts` to request an OIDC token and mint a short-lived key, and injects the result as the action's `auth-json` — so the durable provider key never reaches the merge runner. Follow-on hardening: `id-token` granted to the integrate *caller* job (#1082), the durable `auth-json` secret scrubbed from the process env (#1080, v0.80.0), integrate egress hardened further (#1108, v0.83.0), and `github-token` masked/scrubbed from the agent child env (#1119, v0.83.1, closes #1107). The workflow header warns that its broker allowlist pins `job_workflow_ref` to this file, authorizing *any* job in it to mint — so `id-token: write` stays scoped to the single `integrate` job by policy. Remaining broker work is open: #1124 (wire a broker-minted **App token** into harness-integrate — in-repo half of #1107) and #1126 (mint a scoped `contents:write` token inline, drop `FRO_BOT_PAT` from the injectable step). Credential-broker + reusable-workflow patterns captured in `docs/solutions/` (#1083, #1089, #1125).

### Harness-as-Default-OpenCode Cutover (v0.63.0, 2026-06-14)

The harness moved from "a published npm CLI" to **the binary the action and workspace executor run by default.** Three converging changes landed across v0.54.0–v0.63.0:

- **Harness now publishes its own GitHub Releases** (#874) under **non-`v` tags** (#890) — e.g. `1.17.3+harness.94c10df9`, `1.17.3+harness.2c9cdbd2`. The non-`v` tag namespace deliberately avoids colliding with the action's `vX.Y.Z` semantic-release tags in the same repo. The action downloads the harness build from this release (no longer the stock OpenCode download).
- **`DEFAULT_OPENCODE_VERSION` is now a harness build identifier** (`'1.17.3+harness.94c10df9'`), not a plain upstream version. The constant comment distinguishes it from `FALLBACK_VERSION` (in `opencode.ts`), the plain stock base used when the latest-fetch fails. So the install path is: harness build by default → stock OpenCode as fallback.
- **Workspace executor runs the harness build too** (#889) — the `deploy/` workspace container provisions the same harness OpenCode the action uses, closing the action/daemon parity gap.
- **musl Linux release assets** (#887) added alongside the glibc per-platform builds; release version-check narrowed to only the runner-native binary (#879).

The integrate→build CI handoff was wired via artifact (#774, v0.55.0), the integrate merge now runs **through the Fro Bot workflow itself** (#779) — i.e. the LLM merge is a Fro Bot agent run via `workflow_call` — and the integration job is **skipped when no patches are carried** (#788). Post-bridge hardening (#873, v0.62.0, closes #775) added redaction, a `doctor` version check, and per-ref provenance. Base rebased 1.15.13 → **1.16.0** (#786) → **1.17.3** (#867, three carried patches) → SDK/base **1.17.6**.

**Integration refs (2026-06-24):** `harness.config.json` now carries **five** refs against `anomalyco/opencode`: PRs #19961, #31859, #31638, #33134, #33159 (was three @ v0.63.0; the last two are the SQLite-reliability carries landed with the 1.17.9 rebase, #984). Merge `agent: build`, merge `model: anthropic/claude-sonnet-4-6`.

**Carry squash (v0.75.0, #982):** the harness build now **squashes all carried refs into a single fingerprint commit** and lists them in the release notes, rather than carrying each ref as a separate commit — a provenance/auditability simplification that keeps the "the pipeline is the asset; the patch list stays boring" policy legible at a glance. Committed-bundle attribution + SBOM hygiene captured in `docs/solutions/` (#979).

### Carry Policy

"The pipeline is the asset; the patch list stays boring." Target 1–3 carried refs max. A ref qualifies only if it is: (1) a merged-to-dev correctness fix not yet in stable, (2) an open/stalled upstream fix for Fro-Bot-critical behavior with a failing fixture/incident, (3) a perf/DX/agent-quality patch with before/after numbers, or (4) a stable-lane guardrail. Drop a ref once upstream stable includes it, it stops applying cleanly, or no recent incident/metric justifies the maintenance burden.

## Deployment Stack (`deploy/`, new 2026-05-22)

Docker Compose v2 stack for running the gateway + workspace executor outside CI:

| Service     | Role                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| `gateway`   | Discord gateway daemon — slash commands and mentions (`gateway.Dockerfile`)       |
| `workspace` | Workspace executor running `apps/workspace-agent` on port 9100 (`workspace.Dockerfile`, `workspace-entrypoint.sh`). **No longer a placeholder** as of v0.45.0–v0.50.0; OpenCode model/provider/auth provisioned (#728); **runs the harness OpenCode build by default** as of v0.63.0 (#889). |
| `mitmproxy` | Egress proxy enforcing an allowlist of permitted outbound hosts                   |

**Egress regression #741 resolved (2026-06-04, #747 → v0.52.1).** The v0.51.0 502-on-all-outbound failure (fail-closed mitmproxy meeting a `sandbox-net` with no permitted egress route) was fixed by restoring workspace egress and adding a **configurable proxy allowlist**. Follow-on hardening is open as #746 (close DNS-rebinding TOCTOU + topology-guard bypass gaps) and #745 (add a live mitmproxy egress smoke test to complement the static topology guard).

**Cold-boot supervisor regression #749 fixed (#755 → v0.53.1), then hardened further (v0.54.0).** The `apps/workspace-agent` OpenCode supervisor was brittle on cold-boot mention runs (15s one-shot timeout, no per-probe timeout, no retry, `/healthz` masking a dead OpenCode). #755 prevented the cold-boot readiness hang; v0.54.0 then **supervised OpenCode with respawn + process-group reaping** (#767) and **gated mention dispatch on workspace OpenCode readiness** (#761) so the gateway never dispatches into a not-yet-live executor. Remaining reliability work tracked in open #763 (attach-path timeouts + readiness depth) and #814 (topology guard misses sidecar egress relays).

Stack files: `deploy/compose.yaml`, `deploy/compose.override.example.yaml`, `deploy/gateway.Dockerfile`, `deploy/workspace.Dockerfile`, `deploy/init-certs.sh`, `deploy/validate-stack.sh`, `deploy/mitmproxy/`.

Secrets are file-based (`deploy/secrets/*`, 0600 permissions). Required: `discord-token`, `discord-application-id`, `s3-bucket`, `s3-region`. Optional: `s3-endpoint`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (pair contract — both or neither; falls back to SDK default credential chain), `AWS_SESSION_TOKEN`.

mitmproxy is configured to fail closed by default; `OBJECT_STORE_HOSTS` is the allowlist knob for S3 egress.

## Supported Event Triggers

| Event                        | `@mention` | Prompt source     | Concurrency key       |
| ---------------------------- | ---------- | ----------------- | --------------------- |
| `issue_comment`              | Yes        | Comment body      | `issue.number`        |
| `pull_request_review_comment`| Yes        | Comment body      | `pull_request.number` |
| `discussion_comment`         | Yes        | Comment body      | `discussion.number`   |
| `issues` (opened/edited)     | No/Yes     | Built-in          | `issue.number`        |
| `pull_request`               | No         | `prompt` input    | `pull_request.number` |
| `schedule`                   | No         | `prompt` input    | `run_id`              |
| `workflow_dispatch`          | No         | `prompt` input    | `run_id`              |

## CI Pipeline

11 workflows total (`harness-integrate.yaml` added in the v0.80 broker wave):

| Workflow                  | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `ci.yaml`                 | Setup → Lint, Build (dist/ drift detection), Test, Test Action (live PR review in CI), Dependency Review, Release (preview + next branch push + release PR) |
| `auto-release.yaml`       | Merge `next` into `release`, semantic-release, update `v0` branch |
| `harness-release.yaml`    | **New v0.53.0.** Fenced (manual dispatch / `harness-v*` tag) build+publish of `@fro.bot/harness` + per-platform packages. Read-only build job (no `id-token`); OIDC trusted-publish job only. |
| `harness-integrate.yaml`  | **New (v0.80.0 broker wave, #1081).** `workflow_call` reusable workflow that runs the LLM merge with a **broker-minted** credential. Single `integrate` job holds `id-token: write` + `contents: read`, hardens egress to `broker.fro.bot:443`, mints via `scripts/harness/mint-broker-credential.ts`, injects the result as `auth-json`. Broker allowlist pins `job_workflow_ref` to this file — minting authority is per-file, so `id-token: write` stays scoped to the one job by policy. |
| `prepare-release-pr.yaml` | (not examined)                                              |
| `fro-bot.yaml`            | Self-hosted Fro Bot: PR review, issue triage, mentions, daily DMR (15:30 UTC), weekly wiki update (Sun 20:00 UTC). Exposes a `workflow_call` interface (model + `response-mode` + optional `correlation-id`) so other workflows invoke the agent — used by the harness **integrate merge** (#779) and by the **release-notes generation phase**. **As of v0.93.0 (#1239) the workflow carries two jobs for the release-notes path:** a `fro-bot` **generation** job (read-only `contents: read` / `pull-requests: read`, uploads a `release-notes-candidate-*` artifact) and an `apply-release-notes` job (`contents: read` on `GITHUB_TOKEN`; the write authority for `gh release edit` is carried by `FRO_BOT_PAT`). See "Release-Notes Narration" below. |
| `auto-release.yaml`/release pipeline | **Release-notes narration (v0.56.0, #818):** on a published release, calls `fro-bot.yaml` to narrate the release notes (the `<!-- fro-bot-narration-v1 -->` "What's new" block now atop every release); routing + fail-soft guards documented in `docs/solutions/` (#825) |
| `renovate.yaml`           | Reusable from `bfra-me/.github`, triggered on issue/PR edit, push, CI success, dispatch |
| `codeql-analysis.yaml`    | Security vulnerability analysis                             |
| `scorecard.yaml`          | OpenSSF supply-chain security                               |
| `copilot-setup-steps.yaml`| GitHub Copilot agent bootstrap                              |
| `update-repo-settings.yaml`| Probot settings sync                                       |

### CI Details

- **Path filtering** via `dorny/paths-filter` — lint and build only run when relevant files change.
- **dist/ drift detection** — `build` job compares rebuilt dist/ against committed dist/. Failures upload the expected dist/ as an artifact.
- **Test Action job** — Live integration test: runs the action itself on PRs (non-fork, non-bot) using `./` self-reference with `FRO_BOT_PAT`. Introspects installed versions post-run.
- **Release pipeline** — CI job merges `main` into `release` branch, runs semantic-release preview, pushes `next` branch, and creates/updates a "pending release" PR targeting `release`. `auto-release.yaml` triggers on PR merge to `release`, runs `semantic-release`, and updates the `v0` major version branch.
- **All actions SHA-pinned** with version comments (standard ecosystem pattern).

### Release Model

Three-branch release flow:

1. `main` — development branch, protected (1 required review, 10 required status checks, linear history, enforce admins)
2. `release` — semantic-release target, force-pushable, no PR reviews required
3. `v0` — major version tracking branch, force-updated on each release

`semantic-release` with `@semantic-release/git` (commits dist/ + package.json), `@semantic-release/exec` (version output), `@semantic-release/npm`, `@semantic-release/github` (GitHub releases). Conventional commits with custom release rules (`build` → patch, `docs(readme|rfcs)` → patch, `build(dev)`/`skip` → no release). The `@semantic-release/exec` `successCmd` now dispatches release-notes narration via `scripts/release/dispatch-release-notes.ts` (was inline in the release pipeline).

## Release-Notes Narration (two-phase, credential-boundary — v0.93.0, #1239)

The "What's new" narration atop every release (originally v0.56.0, #818, single `workflow_call`) was **re-architected into two phases with a hard credential boundary** — a direct prompt-injection-hardening move, since the narrator reads untrusted PR bodies/diffs.

- **Generation phase** (`fro-bot` job, read-only) runs under the workflow `GITHUB_TOKEN` scoped to `contents: read` + `pull-requests: read`. It gathers **bounded evidence** — at most 25 PRs, per-PR body truncation, at most 5 diffs — and writes a narrative candidate to the job's **artifact store** (`release-notes-candidate-{correlation-id}`). Because the token is read-only, this phase *structurally cannot* edit the release, comment, or mutate anything regardless of what hostile PR content instructs. This is the same read-only-token containment pattern the `harness-integrate` broker path uses, applied to the narration path.
- **Apply phase** (`apply-release-notes` job) downloads the candidate and applies it via `gh release edit`; the write authority is carried by `FRO_BOT_PAT`, not `GITHUB_TOKEN` (whose `contents` stays `read`). Gated on `release-tag != '' && correlation-id != ''`.

**Candidate validator** (`scripts/release/assemble-release-notes.ts` + `release-notes.ts`) is fail-closed: rejects empty/oversized bodies, control characters, missing PR link, and forged idempotency-marker / `<details>` tags. v0.93.1 (#1241) added a `stripCodeSpans()` pre-pass that blanks well-formed fenced/inline code before the marker/`<details>` structural checks, so a narrative *describing* the validator (using a code-quoted `` `<details>` ``) is no longer falsely rejected — while an unbalanced backtick or unterminated fence leaves raw text intact, preserving fail-closed catch of a tag hidden behind broken markup. v0.93.1 (#1243) also loosened the compose prompt from "one paragraph of 3–6 sentences" to 1–3 short paragraphs of 2–4 sentences (blank-line separated, PR link last) to stop dense walls of text. Lessons captured in `docs/solutions/` (#1240, #1244).

## PR Review Opt-Out Label (`review-skip-label`, v0.93.0, #1234)

A new action input `review-skip-label` (default `skip-agent-review`, case-insensitive, empty string disables) lets operators suppress automatic PR-event reviews by labeling a PR. The skip is evaluated **at trigger routing** — before acknowledgement, model execution, or any token spend — and posts nothing. Label matching reads the **trusted webhook payload** with no routing-time API fetch.

Authorized overrides still win: an `@fro-bot` mention on `opened`/`synchronize`/`reopened` (where the validated association is the PR body author's own) or a `review_requested` event naming the bot runs the review regardless of the label. The override authority is deliberately narrowed: on `ready_for_review`/`review_requested` the router substitutes the *webhook sender's* association rather than the PR author's, so a body-planted mention there would carry borrowed authorization — that path relies on the trusted reviewer-request override only (association-authority lesson in `docs/solutions/`, #1238).

## RFCs

19 Architecture Decision Records:

- RFC-001 through RFC-019 covering: core types, cache, GitHub client, session management, triggers/events, security/permissions, observability, comments, PR reviews, delegated work, setup/bootstrap, agent execution, SDK mode, attachments, GraphQL hydration, additional triggers, post-action hook, agent-invokable delegated work, S3 storage backend.

## Self-Hosted Fro Bot Workflow

The repo runs its own Fro Bot agent. As of 2026-06-03 `fro-bot.yaml` self-references `uses: ./` directly (it dogfoods the in-tree action rather than a published pin) after a local `./.github/actions/setup`. The self-hosted workflow includes:

- **PR review**: On `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues`, `pull_request` events.
- **Daily Maintenance Report**: Schedule at `30 15 * * *` (15:30 UTC). Rolling single-issue strategy with 14-day section window and historical summary compaction.
- **Weekly Wiki Update**: Schedule at `0 20 * * 0` (Sunday 20:00 UTC). Obsidian-style vault in `docs/wiki/` with frontmatter schema, wikilink lint pass, and automatic PR creation via `branch-pr` output mode.
- **Manual dispatch**: Custom prompt, or built-in DMR/wiki prompts via boolean inputs.

## Dependency Highlights

| Package               | Version (2026-07-21) | Was @ v0.83.1 | Purpose                              |
| --------------------- | -------------------- | ------------- | ------------------------------------ |
| `@actions/artifact`   | 6.2.1                | 6.2.1         | Artifact upload (root dep now)       |
| `@actions/cache`      | 6.1.0                | 6.0.1         | GitHub Actions cache operations (#1028) |
| `@actions/core`       | 3.0.1                | 3.0.1         | Action I/O, logging, state           |
| `@actions/exec`       | 3.0.0                | 3.0.0         | Subprocess execution                 |
| `@actions/github`     | 9.1.1                | 9.1.1         | Octokit + GitHub context             |
| `@actions/tool-cache` | 4.0.0                | 4.0.0         | Tool caching for setup phase         |
| `@aws-sdk/client-s3`  | 3.1085.0             | 3.1078.0      | S3-compatible object storage         |
| `@opencode-ai/sdk`    | 1.17.20              | 1.17.13       | OpenCode execution (base bumped 1.17.13 → 1.17.20; harness base separately at 1.18.4) |
| `@octokit/auth-app`   | 8.2.0                | 8.2.0         | GitHub App authentication            |
| `@octokit/webhooks-types` | 7.6.1            | 7.6.1         | Webhook payload typing (dev)         |
| `@fro.bot/systematic` | 3.2.2                | 2.33.1        | OpenCode plugin — **v2 → v3 major** (#1250) |
| `@bfra.me/es`         | 0.1.0                | 0.1.0         | Shared ES utilities                  |
| `discord.js`          | 14.26.4              | 14.26.4       | Gateway Discord client (gateway pkg) |
| `effect`              | 3.21.3               | 3.21.3        | Gateway composition layer            |
| `hono`                | 4.12.27              | 4.12.27       | HTTP layer (gateway + workspace-agent) |
| `@hono/node-server`   | 2.0.9                | 1.19.14       | Node adapter for Hono — **v1 → v2 major** (#1249) |
| `eslint`              | 10.7.0               | 10.6.0        | Lint (dev)                           |
| `prettier`            | 3.9.5                | 3.9.4         | Format (dev)                         |
| `tsdown`              | 0.22.7               | 0.22.3        | Rolldown-based bundler               |
| `semantic-release`    | 25.0.7               | 25.0.5        | Automated versioning/publishing       |
| `vite` (override)     | 8.1.4                | 8.1.2         | Pinned override                      |
| `bun` (pkg manager)   | 1.3.14               | 1.3.14        | Workspace package manager (Bun cutover holds) |
| `simple-git-hooks`    | 2.13.1               | 2.13.1        | Pre-commit (lint-staged), pre-push   |

## Renovate Configuration

Extends `github>fro-bot/.github` (the `.github` repo's Renovate config). `dist/**` ignored from all scans.

Five custom regex managers tracking pinned versions in `packages/runtime/src/shared/constants.ts` (the constants moved out of the action's `src/shared/` into the runtime package at v0.45+):

| Constant (2026-07-21)              | Datasource                                   |
| ---------------------------------- | -------------------------------------------- |
| `DEFAULT_OPENCODE_VERSION = '1.18.4+harness.1ff4b323'` | **Harness build** — a fro-bot/agent GitHub Release (non-`v` tag) bundling the patched OpenCode (was `1.17.14+harness.e98fbc0f` @ v0.83.1); `FALLBACK_VERSION` in `opencode.ts` (Renovate `github-releases` datasource) is the plain stock base when latest-fetch fails |
| `DEFAULT_BUN_VERSION = '1.3.14'`   | GitHub releases `oven-sh/bun` (`extractVersionTemplate: ^bun-v(?<version>.*)$`) |
| `DEFAULT_OMO_VERSION = '3.17.15'`  | npm `oh-my-openagent`                        |
| `DEFAULT_OMO_SLIM_VERSION = '1.1.2'` | npm `oh-my-opencode-slim` (stable line only) |
| `DEFAULT_SYSTEMATIC_VERSION = '3.2.2'` | npm `@fro.bot/systematic` — **crossed the v2 → v3 major** (was 2.33.1 @ v0.83.1; bumped 2.33.3 #1217/v0.91.0 then v3 #1250/v0.94.0) — see [[marcusrbrown--systematic]] |

Renovate now also tracks the harness native-build Bun pin via two additional custom managers: `HARNESS_BUN_VERSION` in `packages/harness/src/bun-version.ts` and the `bun-version:` inputs (build + publish jobs) in `harness-release.yaml`, both against `oven-sh/bun` and kept in lockstep with the `BUN_VERSION` ARG in `deploy/gateway.Dockerfile`. `base_version` in `harness.config.json` is tracked via a `github-releases` manager (`1.17.14` as of 2026-07-07).

`STORAGE_VERSION = 1` governs the on-disk session/cache layout. `DEFAULT_MODEL.modelID` is `big-pickle` (the default inference model ensuring OpenCode Zen starts).

**Note (2026-06-14):** with the harness-as-default cutover, the OpenCode version no longer tracks a plain `anomalyco/opencode` release via custom regex manager — the default is a harness build whose base version is set in `harness.config.json` (`base_version: 1.17.6`). The harness release itself is produced by the fenced `harness-release.yaml` pipeline rather than a Renovate version bump.

**OpenCode event-contract / pin history:** the 1.14.42+ `/event` SSE `SyncEvent` regression (`message.part.updated`, `message.updated`, `session.next.*` not reaching `bus.subscribeAll()` subscribers) was fixed upstream (#27959) and verified in 1.15.13. That event contract changed the streaming surface: tool lifecycle and text now arrive via `message.part.updated` / `message.part.delta`, so `session.next.tool.*` / `session.next.text.delta` no longer fire — legacy handlers in `streaming.ts` are retained as fallback. This drove the gateway tool-progress migration (#744, v0.52.0).

**As of v0.63.0 the OpenCode version is no longer a simple Renovate-capped pin** — the default is the harness build. As of the 2026-07-21 survey `base_version: 1.18.4` in `harness.config.json` (after rebasing through 1.16.0 #786 … 1.17.14, then 1.17.20 #1222/v0.91.0, then **1.18.4** #1254/v0.94.0). The 1.18.4 upstream base brings a 300s OpenAI header timeout, an Azure deployment-endpoint fix, Kimi/Moonshot adaptive thinking, Meta `xhigh` reasoning, and a native `subagent_depth` default; all 12 carries preserved in order, headless CI behavior unchanged. Both action surfaces — the `DEFAULT_OPENCODE_VERSION` constant and the workspace Dockerfile `ARG` — are updated together in the post-publish sync (#1256) so they always track the same patched build. The action consumes the harness GitHub Release; `FALLBACK_VERSION` is the plain stock base when the latest-fetch fails. See "Harness-as-Default-OpenCode Cutover" above.

Post-upgrade tasks: `bun run bootstrap && bun run build && bun run fix` (Bun cutover — the AGENTS/README post-upgrade recipe migrated off `pnpm run …`).

## Probot Settings

Extends `fro-bot/.github:common-settings.yaml` via `.github/settings.yml`.

Branch protection on `main`: enforce admins, linear history, 1 required reviewer, dismiss stale reviews, code owner reviews, last push approval. Required checks: Analyze, Build, CodeQL, Dependency Review, Lint, Release, Test, Test GitHub Action, Setup, Renovate.

`v0` and `release` branches: force-push allowed, no PR reviews, no required checks.

## Documentation Artifacts

The `docs/` directory contains extensive planning and operational artifacts:

| Subdirectory       | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `docs/audits/`     | Audit records                                                  |
| `docs/brainstorms/`| Brainstorm notes and explorations                              |
| `docs/examples/`   | Reference workflow examples (e.g., `fro-bot.yaml` template)    |
| `docs/ideation/`   | Ideation documents for future features                         |
| `docs/plans/`      | Architecture plans and design docs                             |
| `docs/solutions/`  | Documented solutions with YAML frontmatter (bugs, patterns)    |
| `docs/wiki/`       | Self-hosted Obsidian-style project wiki (maintained by agent)  |

A `FEATURES.md` at repo root documents v1.4 MVP with 73 features across 12 categories (GitHub interactions, Discord agent, memory/persistence, setup, SDK execution, context/prompt, security, observability, error handling, configuration, additional triggers, delegated work tools).

**New 2026-05-22:** A top-level `.agents/skills/` directory has appeared (project-local skills accessible to the agent during self-hosted runs). A `.slim/` directory and `RULES.md` (development rules v1.4 covering technology stack, code style, architecture patterns, security, testing, build/release, anti-patterns) round out the agent-oriented top-level surface. `RULES.md` declares the documentation hierarchy: PRD > RFCs > FEATURES.md > RULES.md.

**Docs restructure (v0.80.0, survey 2026-07-07).** The top-level doc surface was reorganized: `RULES.md` **retired** (#1076), replaced by new `ARCHITECTURE.md` + `STRUCTURE.md` (#1075, AGENTS.md slimmed) and `CONTRIBUTING.md` + `SECURITY.md` (#1076). `PRD.md` and `FEATURES.md` were **archived to `docs/product/`** (#1071); the README was refreshed with troubleshooting moved to the wiki (#1077) and the example prompt fenced for a Copy button (#1078). A new `docs/decisions/` directory joins the prior `docs/` tree. Root now carries `AGENTS.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `RFCS.md`, `README.md` — `RULES.md`/`PRD.md`/`FEATURES.md` are gone from root. A new `generating-project-docs` skill was added under `.agents/skills/` (#1073) to drive this doc generation.

`RFCS.md` indexes the 19 RFC architecture decision records; **as of the 2026-07-21 survey the RFC bodies live in a top-level `RFCs/` directory** (`RFC-001-Foundation-Core-Types.md` … `RFC-019-S3-Storage-Backend.md`, 19 files) rather than only in the index. (PRD.md was archived to `docs/product/` in the v0.80.0 restructure.)

**New 2026-07-21:** a root `CHANGELOG.md` tracks the PRD/requirements changelog (not the release changelog — that lives in GitHub releases). `docs/privacy/operator-push-retention.md` and `docs/decisions/` (`2026-06-19-s2-operator-auth-authority.md`) join the docs tree. A second project-local skill `versioned-tool` was added under `.agents/skills/` alongside `generating-project-docs`.

**New top-level surface (2026-06-24):** the root now carries `.opencode/` (project OpenCode config), `bun.lock` + `bunfig.toml` (Bun), `.ignore`, `tsconfig.base.json`, and `tsdown.config.test.ts` alongside the prior `.agents/`, `.slim/`, `RULES.md`, `AGENTS.md`, `FEATURES.md`, `PRD.md`, `RFCS.md`. `pnpm-lock.yaml` / `pnpm-workspace.yaml` are gone.

## Ecosystem Role

This is the **central runtime** consumed by all Fro Bot-managed repositories. Every repo with a `fro-bot.yaml` workflow depends on `fro-bot/agent` as a GitHub Action reference (e.g., `fro-bot/agent@v0.42.8`). The action auto-installs and configures [[marcusrbrown--systematic]] as an OpenCode plugin, connecting the agent to 45+ skills and 50 agents.

**Resolved (2026-06-24 survey):** the v0.64–v0.76 release wave the consumer pins implied has now been surveyed at source. The dominant content is the **gateway operator web surface** (§ "Operator Web Surface" above, #907) and a **pnpm → Bun migration** (§ Workspace Layout / Workspace Packages); OpenCode rebased to harness `1.17.9`; build-pipeline + SBOM hardening. Consumers [[marcusrbrown--marcusrbrown]] and [[bfra-me--works]] sat at v0.75.0 on 2026-06-22; latest release is now **v0.76.1** (2026-06-23) with v0.76.2 pending (#1007).

**Update (2026-07-07 survey):** the v0.77–v0.83 wave is now surveyed at source. Three arcs dominate: **(1)** the **credential-broker consumer landed** (v0.80.0, #1081) as `harness-integrate.yaml`, closing the #1060 loop the [[marcusrbrown--infra]] survey anticipated; **(2)** the **operator web surface reached wiring parity** — the #1001/#1000 gaps closed (launch/approval routes mounted #1030/#1031, run-index #1038, `contractVersion` health #1096, run cancellation #1111, sanitized failure reasons #1113); **(3)** a **docs/runtime restructure** — `RULES.md` retired for `ARCHITECTURE.md`/`STRUCTURE.md`/`CONTRIBUTING.md`, PRD/FEATURES archived to `docs/product/`, and `packages/runtime/src/` consolidated into `agent/`+`coordination/`+`object-store/`+`session/`+`shared/`. Latest release **v0.83.1** (2026-07-05).

**Update (2026-07-21 survey, HEAD `9a4631f`):** the v0.84–v0.94 wave (11 minors + patches in ~2 weeks). **No structural change** — 3 packages / 2 apps / 11 workflows / 19 RFCs / four-layer source hierarchy / Bun cutover all durable. The wave is **feature-and-hardening on the release + review pipelines plus a harness rebase**, not a new subsystem:

- **Release-notes narration re-architected into two phases with a hard credential boundary** (v0.93.0, #1239): a read-only **generation** job (`contents: read`/`pull-requests: read`, bounded evidence ≤25 PRs / ≤5 diffs → artifact candidate) and an **apply** job (`FRO_BOT_PAT` carries `gh release edit` authority). The read-only generation phase structurally cannot mutate anything regardless of hostile PR content — the same containment posture as the broker path. v0.93.1 hardened the fail-closed candidate validator (code-span exemption #1241, short-paragraph compose #1243). See "Release-Notes Narration".
- **`review-skip-label` opt-out input** (v0.93.0, #1234, default `skip-agent-review`) — routing-time PR-review suppression from the trusted webhook payload, with mention / `review_requested` overrides scoped by sender-substituted association authority (#1238). See "PR Review Opt-Out Label".
- **Harness rebased 1.17.14 → 1.17.20 → 1.18.4** (#1222/v0.91.0, #1254/v0.94.0); merge model `claude-sonnet-4-6` → **`claude-sonnet-5`**; carries churned and settled at **12** (#1220 retired superseded refs; +#36045/#36361). Post-publish sync updates the runtime constant and the Dockerfile `ARG` together (#1256).
- **Reliability/runtime**: fail-fast on provider quota exhaustion (#1227), centralized agent error formatting (#1226), run-state retention tagging (#1225), PR-release validation concurrency isolation (#1223), removed legacy schedule-session force-expiry scaffolding (#1237).
- **Deps**: `@fro.bot/systematic` **v2 → v3 major** (#1250, now 3.2.2 — see [[marcusrbrown--systematic]]), `@hono/node-server` **v1 → v2 major** (#1249), `@opencode-ai/sdk` 1.17.20, `@aws-sdk/client-s3` 3.1085.0, eslint 10.7.0, prettier 3.9.5, tsdown 0.22.7, semantic-release 25.0.7, vite override 8.1.4. `@semantic-release/npm` added to `.releaserc.yaml`.
- **Doc surface**: RFC bodies extracted into a `RFCs/` directory (19 files) alongside the `RFCS.md` index; new root `CHANGELOG.md` (PRD/requirements changelog); new `docs/privacy/operator-push-retention.md`; new `.agents/skills/versioned-tool` skill.

Latest release **v0.94.0** (2026-07-21); stars 2 → **3**; open issues flat at 6.

**Note (2026-06-15):** [[fro-bot--dashboard]] (new) is a downstream consumer of a *different* surface than the action — it reads the Fro Bot **Agent App's installations** (not the action) to build a read-only cross-repo monitoring view, and it deliberately mirrors `packages/gateway` + `packages/runtime` primitives (`Result<T,E>`, `Logger` + `redactSensitiveFields`, `readSecret`/`readMultilineSecret`, the read-only `installAuth` permissions pattern, and the app-factory/serve split) as the staging ground for a future shared `@fro.bot/runtime` package. Its `fro-bot.yaml` pins agent **v0.64.0** — a minor ahead of this page's last-surveyed v0.63.0.

**Update (2026-07-09, from dashboard survey):** [[fro-bot--dashboard]] now consumes this repo's **operator API contract** as a vendored barrel pinned at gateway/runtime **v0.78.0** (`OPERATOR_CONTRACT_VERSION = 1.6.0`) — SSE run-stream frames, approvals, and operator-initiated run cancellation. This is the concrete downstream landing of the operator web surface tracked here (see "Operator Web Surface"); the dashboard is the read-only view-plane that proxies control (launch/approve/cancel) to this gateway. Its `fro-bot.yaml` action pin has advanced to **v0.84.2** (ecosystem leader), while its vendored-contract inspection source stays frozen at v0.78.0 by design.

**Update (2026-07-23, from dashboard survey):** [[fro-bot--dashboard]]'s `fro-bot.yaml` action pin has advanced further to **v0.94.2** (SHA `64029d5`, still ecosystem leader), while the vendored operator contract and `.slim/clonedeps.json` inspection source remain frozen at gateway/runtime **v0.78.0** (contract `1.6.0`, unchanged). The pin-vs-inspection skew is now v0.94.2 vs v0.78.0 — intentional, as the inspection source only refreshes on a contract change, not on every action bump.

Downstream consumers span the `marcusrbrown/*`, `bfra-me/*`, and `fro-bot/*` ecosystems via `fro-bot/agent@vX` references. Version lag varies widely by Renovate cadence — as of the 2026-06-03 survey the spread runs from trailing pins (e.g. [[marcusrbrown--mrbro-dev]] at v0.43.0, [[bfra-me--ha-addon-repository]] at v0.43.1) up through the bleeding edge ([[marcusrbrown--marcusrbrown-github-io]] at v0.48.1, [[bfra-me--works]] at v0.47.0). Per-repo pins are tracked on each consumer's own wiki page rather than mirrored here, since they drift faster than this page is surveyed. The agent auto-installs and configures [[marcusrbrown--systematic]] / `@fro.bot/systematic` (v2.32.0 as of the 2026-06-24 survey) as an OpenCode plugin on every run.

## Build System

`tsdown.config.ts` at root bundles both action entry points with:

- **License collector plugin** — Generates `dist/licenses.txt` with deduplicated, version-sorted third-party license content from `pnpm licenses list --json --prod` cross-referenced with `generate-license-file`.
- **Hidden Unicode escape plugin** — Replaces non-ASCII characters flagged by Renovate's Unicode detector (from vendor code like `@actions/artifact` HTML entity tables and AWS SDK) with `\uXXXX` JS escapes, keeping dist/ bytes ASCII-only.
- **noExternal** — Inlines `@bfra.me/es`, `@actions/*`, `@octokit/auth-app`, `@opencode-ai/sdk`, `@aws-sdk/*`, `@smithy/*`, `@fro-bot/runtime` into the bundle.

**Build-pipeline hardening (v0.75.0–v0.76.1).** v0.75.0 (#978) made third-party notice tracking **deterministic** and added a **CI SBOM** step. v0.76.1 then hardened the dist pipeline against bundler-coupling: license-notice collection now runs **before** bundling and escapes independently (#991), hidden-unicode scrub/verify is **decoupled from the bundler** (#988 — surfaced as the standalone `scripts/check-dist-hidden-unicode.ts` / `escape-dist-hidden-unicode.ts` root scripts wired into `lint`/`build`), and license-collection failures now surface real stderr (#997). The preflight/finally lifecycle lesson is captured in `docs/solutions/` (#993, #990). A harness install-time bin/postinstall shim (#992) was tried and **reverted** (#995); a Renovate `pnpm install --force` store-repair attempt (#998) was likewise reverted as ineffective (#999) — vestigial pnpm-era reflexes surfacing during the Bun cutover.

## Fro Bot Workflow Status

**Present and self-hosted.** `fro-bot.yaml` uses `./` (self-reference during CI test) and `fro-bot/agent@v0` (major version pin) in production triggers. Full trigger coverage: comment mentions, issue events, PR reviews, daily DMR (15:30 UTC), weekly wiki (Sun 20:00 UTC), manual dispatch with `use-schedule-prompt` / `use-wiki-prompt` boolean inputs.

The `WIKI_PROMPT` env var in the workflow contains the full wiki maintenance instructions for the project's own `docs/wiki/` Obsidian vault — a parallel artifact to the wiki Fro Bot maintains for the `.github` repo. Branch contract: `fro-bot/wiki-update`, one open PR at a time, branch is deleted if it exists with no open PR.

## Workspace Packages

| Package                   | Path                     | Dependencies                                                | Purpose                                                                 |
| ------------------------- | ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@fro-bot/action`         | `apps/action/`           | `@fro-bot/runtime` (workspace)                              | GitHub Action entry points (private)                                    |
| `@fro-bot/workspace-agent`| `apps/workspace-agent/`  | `hono`, `@hono/node-server`                                 | **New v0.45.0.** In-container Hono service for sandboxed git ops (private) |
| `@fro-bot/runtime`        | `packages/runtime/`      | `@bfra.me/es`, `@opencode-ai/sdk`                          | Shared runtime library + shared constants; locks, run-state, S3 sync helpers (private) |
| `@fro-bot/gateway`        | `packages/gateway/`      | `@fro-bot/runtime` (workspace), `discord.js`, `effect`, `hono`, `@hono/node-server` | **New 2026-05-22.** Long-running Discord daemon (private)     |
| `@fro.bot/harness`        | `packages/harness/`      | (build-time orw integration; no runtime workspace deps)    | **New v0.53.0.** Published patched-OpenCode CLI — the default OpenCode for Fro Bot (public) |

Root `package.json` (`@fro-bot/agent-workspace`) holds external action/dev deps; gateway- and workspace-agent-specific deps live in their own package manifests. Workspace protocol links `@fro-bot/action` and `@fro-bot/gateway` → `@fro-bot/runtime`. The runtime exports source-level TypeScript (no pre-built dist; consumed via workspace protocol). The root `build`/`test`/`lint`/`fix`/`check-types` scripts now run runtime + action + harness via `bun run --filter <pkg> ...` (was `pnpm --filter`) — the gateway and workspace-agent build via the Docker stack, not the action's `dist/` pipeline; the harness builds + publishes via the fenced `harness-release.yaml` workflow.

**Bun workspace config (2026-06-24).** With the pnpm → Bun migration, workspace config moved out of `pnpm-workspace.yaml` (deleted) back into `package.json`: `workspaces: [apps/*, packages/*]`, `packageManager: bun@1.3.14`, `trustedDependencies: [esbuild, simple-git-hooks, unrs-resolver]` (the Bun analogue of pnpm's `onlyBuiltDependencies`), and the `overrides` block back in root `package.json` covering `brace-expansion >=5.0.6`, `fast-uri >=3.1.2`, `fast-xml-builder >=1.1.7`, `fast-xml-parser >=5.7.0`, `flatted 3.4.2`, `handlebars >=4.7.9`, `ip-address >=10.1.1`, `lodash`/`lodash-es >=4.18.0`, `picomatch >=4.0.4`, `tar >=7.5.11`, `undici >=7.24.0`, `vite 8.0.16`, `yaml >=2.8.3`. Lockfile is `bun.lock`; `bunfig.toml` carries Bun config.

## Survey History

| Date       | SHA        | Key changes                                          |
| ---------- | ---------- | ---------------------------------------------------- |
| 2026-07-21 | `9a4631f`  | Re-survey at v0.94.0 (v0.83.1 → v0.94.0, 11 minors + patches in ~2 weeks): **no structural change** — 3 pkgs / 2 apps / 11 workflows / 19 RFCs / Bun cutover all durable. Feature+hardening wave on the release/review pipelines plus a harness rebase. **(1) Release-notes narration → two-phase credential boundary** (v0.93.0, #1239): read-only generation job (bounded evidence ≤25 PRs/≤5 diffs → artifact candidate) + apply job carrying write authority via `FRO_BOT_PAT`; fail-closed validator hardened (code-span exemption #1241, short-paragraph compose #1243). **(2) `review-skip-label` opt-out input** (#1234, default `skip-agent-review`, routing-time, mention/`review_requested` overrides via sender-substituted association #1238). **(3) Harness rebased 1.17.14 → 1.17.20 → 1.18.4** (#1222/#1254); merge model → `claude-sonnet-5`; 12 carries (churned, #1220 retired superseded, +#36045/#36361); runtime constant + Dockerfile ARG synced post-publish (#1256). Reliability: quota fail-fast (#1227), centralized error format (#1226), run-state retention tag (#1225), PR-release concurrency isolation (#1223), legacy schedule-session scaffolding removed (#1237). Deps: **systematic v2→v3** (#1250, 3.2.2), **@hono/node-server v1→v2** (#1249), @opencode-ai/sdk 1.17.20, aws-sdk 3.1085.0, eslint 10.7.0, prettier 3.9.5, tsdown 0.22.7, semantic-release 25.0.7 (+`@semantic-release/npm`), vite override 8.1.4. Doc surface: `RFCs/` dir extracted, root `CHANGELOG.md`, `docs/privacy/`, `.agents/skills/versioned-tool`. Stars 2→3; open issues flat at 6. |
| 2026-07-07 | `8ee84bb`  | Re-survey at v0.83.1 (v0.76.1 → v0.83.1, 7 minors + patches in ~12 days): three arcs. **(1) Credential-broker consumer landed** — new `harness-integrate.yaml` `workflow_call` (v0.80.0, #1081, closes #1060) mints an OIDC credential against `broker.fro.bot` in a single `id-token: write` job and injects it as `auth-json`; durable secret scrubbed from env (#1080), integrate egress hardened (#1108), `github-token` masked/scrubbed from agent child env (#1119, closes #1107). **(2) Operator web surface reached wiring parity** — #1001/#1000 closed: launch route mounted (`POST /operator/runs`, #1030), approval routes + image-level registration smoke (#1031), run-index (`GET /operator/runs`, #1038), `contractVersion` on health (#1096), operator-initiated run cancellation (#1111), sanitized failure reasons (#1113), lost-event vs hang timeout detection (#1116). **(3) Docs + runtime restructure** — `RULES.md` retired for `ARCHITECTURE.md`/`STRUCTURE.md`/`CONTRIBUTING.md` (#1075/#1076), PRD/FEATURES archived to `docs/product/` (#1071), `generating-project-docs` skill (#1073); `packages/runtime/src/` consolidated into `agent/`+`coordination/`+`object-store/`+`session/`+`shared/` (object-store code now concretely in runtime). OpenCode rebased harness 1.17.9 → 1.17.11 (#1045) → 1.17.13 (#1086) → 1.17.14; **10 integration refs** (was 5). Deps: systematic 2.32.0 → 2.33.1, `@opencode-ai/sdk` 1.17.13, `@aws-sdk/client-s3` 3.1078.0, hono 4.12.27, `@actions/cache` 6.1.0, eslint 10.6.0, prettier 3.9.4, vite override 8.1.2. Open issues 9 → **6** (wiring gaps + #907 closed); 3 open PRs (pending release #1138 + two Renovate). |
| 2026-06-24 | `20e9f34`  | Re-survey at v0.76.1 (v0.63.0 → v0.76.1, 13 minors + patches in 9 days): two structural shifts. **(1) pnpm → Bun migration** — `packageManager: bun@1.3.14`, `bun.lock` + `bunfig.toml`, `bun run --filter` scripts, `bunx` git hooks, `trustedDependencies`; `pnpm-lock.yaml`/`pnpm-workspace.yaml` removed; `overrides` moved back to root `package.json`; harness native build now Bun-based (`HARNESS_BUN_VERSION`). **(2) Gateway operator web surface** ("web-command spine", #907) — new `web/`, `operator-contract/`, `redaction/` dirs; operator GitHub OAuth + sessions (#936/#944/#939), authenticated SSE run status+output streaming (#961/#962/#974), web launch surface (#968), web tool-approval flow (#986), frozen+pinned operator API contract (#952/#996), `metadata/repos.yaml` redaction gate on operator surfaces (#955). OpenCode rebased harness `1.17.6` → `1.17.9` (#984, 5 carried refs, SQLite reliability); carries squashed into one fingerprint commit (#982); SBOM + deterministic-notice build hardening (#978), dist license/unicode pipeline decoupled from bundler (#991/#988, v0.76.1). Deps: systematic 2.31.0 → 2.32.0, hono 4.12.26, tsdown 0.22.3, `@aws-sdk/client-s3` 3.1071.0, `@opencode-ai/sdk` 1.17.9, eslint 10.5.0. Open issues 6 → 9 (new web-surface wiring gaps #1001/#1000, Bun deploy hardening #1003); 1 open PR (pending release #1007). |
| 2026-06-14 | `a23ae97`  | Re-survey at v0.63.0 (v0.53.1 → v0.63.0, 10 minors): **Harness-as-default-OpenCode cutover** (v0.63.0, #888/#884/#874/#889) — `@fro.bot/harness` now publishes its own **GitHub Releases** under non-`v` tags (`1.17.3+harness.94c10df9`), and both the action and the workspace executor run the harness build by default; `DEFAULT_OPENCODE_VERSION` is now a harness build id (stock OpenCode = `FALLBACK_VERSION`); musl Linux assets added (#887). OpenCode base rebased 1.15.13 → **1.16.0** (#786) → **1.17.3** (#867) → SDK **1.17.6**; integration refs grew to 3 (#19961/#31859/#31638). Harness integrate merge now runs through the Fro Bot workflow (#779), skipped when no patches carried (#788); post-bridge hardening (#873, closes #775). **Release-notes narration** (v0.56.0, #818) — published releases narrated by the agent via `fro-bot.yaml` `workflow_call`. Gateway: serial per-channel mention queue (#850), `/fro-bot force-release-lock` (#854), live status/typing (#843), `daily_digest` presence (#826), fail-soft io helpers (#858). Cold-boot hardened further (v0.54.0, #767/#761). Deps: pnpm 10.33.4 → **11.5.3**, systematic 2.24.0 → 2.31.0, OMO Slim 1.1.1 → 1.1.2, effect 3.21.3, tsdown 0.22.2, semantic-release 25.0.5, `@aws-sdk/client-s3` 3.1066.0, vite 8.0.16. 0 open PRs; 6 open issues. |
| 2026-06-04 | `34abe2a`  | Re-survey at v0.53.1 (v0.51.0 → v0.53.1, 3 releases): **`packages/harness` (`@fro.bot/harness`)** shipped (v0.53.0, #752) — a published, OIDC-trust-published, patched-OpenCode CLI built via cortexkit/orw LLM-merge integration; now "the default OpenCode for Fro Bot" and the workspace's only public package; new fenced `harness-release.yaml` workflow (read-only build job, no `id-token`; OIDC publish job; per-platform `optionalDependencies` injected at publish time). **OpenCode pinned to 1.15.13** (#742, SDK+CLI) for the 1.14.42+ SSE `SyncEvent` regression fix; new event contract (`message.part.updated`/`delta`) drove the gateway tool-progress migration (#744, v0.52.0). **Egress regression #741 resolved** (#747 → v0.52.1, configurable proxy allowlist); follow-on hardening open as #746/#745. **Cold-boot supervisor regression #749 fixed** (#755 → v0.53.1). `DEFAULT_MODEL` noted as `opencode/big-pickle`. Workspace now 5 members. |
| 2026-06-03 | `d0f39a2`  | Re-survey at v0.51.0 (jumped 7 minors from v0.44.3): **`apps/workspace-agent`** shipped (v0.45.0, Hono service for sandboxed git ops + OpenCode provisioning, port 9100, hardened `/clone`) — workspace executor no longer a placeholder; gateway grew a working Discord control plane (bindings store, GitHub App auth, `/fro-bot add-project`, `@fro-bot` mention → OpenCode execution, sensitive-tool approval prompts, boot provider self-test); **OMO Slim** added as opt-in orchestration (`enable-omo-slim`, mutually exclusive with `enable-omo`, pinned 1.1.1); expanded S3 inputs (key-prefix, expected-bucket-owner, KMS/SSE, insecure-endpoint), `skip-cache`, `omo-providers`; shared-layer constants relocated to `packages/runtime/src/shared/`; Node 24.16.0-alpine in Docker; deps (`@aws-sdk/client-s3` →3.1057.0, `tsdown` →0.22.1, Vitest →4.1.7, `@actions/cache` →6.0.1); stars 1→2. Open regression #741: mitmproxy egress 502 on `sandbox-net` breaks `add-project` clones. |
| 2026-05-22 | `8632cf4`  | Re-survey at v0.44.3: new `packages/gateway` (Discord daemon, Effect 3.x), new `deploy/` Docker stack (gateway + workspace + mitmproxy), `enable-omo` action input (oMo now opt-in), `agent` input default changed from `sisyphus` to unset/OpenCode-build, open issues 7→2, stars 0→1, dep bumps (`@opencode-ai/sdk` 1.14.30→1.14.41, `tsdown` 0.21→0.22, `vite` pin 8.0.10→8.0.13). `services/object-store/` confirmed migrated (likely into `@fro-bot/runtime`). Action `AGENTS.md` is stale (dated 2026-03-29). |
| 2026-05-08 | `ef6b952`  | Re-survey: additive detail (workspace packages, docs structure, artifact/object-store discrepancy) |
| 2026-05-07 | `ef6b952`  | Initial survey                                       |
