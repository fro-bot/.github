---
type: repo
title: "fro-bot/agent"
created: 2026-05-07
updated: 2026-06-03
sources:
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
tags: [github-actions, agent, opencode, omo, omo-slim, typescript, persistent-memory, ci-cd, fro-bot, semantic-release, pnpm-workspace, monorepo, discord, effect, hono, docker-compose, mitmproxy]
related:
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
| Last push              | 2026-06-03 (survey 2026-06-03)                                     |
| Latest release         | v0.51.0 (2026-06-03; was v0.44.3 @ 2026-05-22)                     |
| Language               | TypeScript (strict, ESM-only)                                      |
| Node.js                | 24.16.0-alpine in Docker images (was 24.15.0); `.node-version` pin |
| Package manager        | pnpm 10.33.4 (PR #702 queues 10.34.1)                              |
| Runtime                | `node24` (GitHub Action `runs.using`)                              |
| Bundler                | tsdown 0.22.1 (Rolldown-based, dual entry points)                  |
| Test framework         | Vitest 4.1.7 (was 4.1.6 @ v0.44.3)                                 |
| Lint                   | ESLint 10.4.0 (`@bfra.me/eslint-config` 0.51.1), Prettier 3.8.3   |
| TypeScript             | 6.0.3                                                              |
| Release                | semantic-release on `release` branch, `next` → `release` PR model  |
| Visibility             | Public                                                             |
| Stars                  | 2 (was 1 @ 2026-05-22)                                             |
| Open issues            | 2 (steady; #741 mitmproxy egress regression, #727 workspace timeline) |
| Open PRs               | 5 (all Renovate + OpenCode pin fix #742)                           |
| Topics                 | actions, agent, automation, bot, fro-bot, github-actions, github-app |

## Architecture

### Workspace Layout

pnpm workspace monorepo (`workspaces: [apps/*, packages/*]`). As of 2026-06-03 the workspace has **four members** (`apps/workspace-agent` added at v0.45.0):

- **`apps/action`** (`@fro-bot/action`) — The GitHub Action entry points. Private, no publish. Depends on `@fro-bot/runtime`.
- **`apps/workspace-agent`** (`@fro-bot/workspace-agent`) — **New 2026-06-03 (shipped v0.45.0, #674).** Small Hono HTTP service that runs *inside* the workspace container; the gateway calls it over the internal `sandbox-net` so the gateway never mounts `/var/run/docker.sock`. Depends on `hono` 4.12.23 + `@hono/node-server` 1.19.14. Builds to `dist/main.mjs`. See "Workspace Agent" below.
- **`packages/runtime`** (`@fro-bot/runtime`) — Shared runtime library. Private, exports source-level TS (no pre-built dist; consumed via workspace protocol). Hand-rolled `Result<T, E>` from `@bfra.me/es` is the error convention here. **As of v0.45+ the shared layer (`src/shared/constants.ts`, the pinned-version constants) lives here at `packages/runtime/src/shared/constants.ts`** — the `apps/action` Layer 0 now re-exports from the runtime rather than owning the canonical constants.
- **`packages/gateway`** (`@fro-bot/gateway`) — **New 2026-05-22.** Long-running Discord-first daemon. Wraps `@fro-bot/runtime` with `effect` 3.21.2 as the composition layer. Depends on `discord.js` 14.26.4, plus `hono` 4.12.23 + `@hono/node-server` for its HTTP surfaces. Builds to `packages/gateway/dist/` via `tsdown`.

**Note (2026-06-03):** Both a root `src/` tree (`features/`, `harness/`, `services/`, `shared/`, `index.ts`, `main.ts`, `post.ts`) and `apps/action/src/` exist. The action.yaml still points at root `dist/main.js` / `dist/post.js`, so root `src/` remains the action's compiled source of truth while `apps/action` carries the workspace-published package manifest. The migration of the action into `apps/action` is in progress, not complete.

Root `tsdown.config.ts` bundles `apps/action/src/main.ts` and `apps/action/src/post.ts` into `dist/main.js` and `dist/post.js`. The `dist/` directory is **committed** (GitHub Action requirement — no build step at consumption time).

The gateway has its own `dist/` not committed at root — it's a runtime daemon shipped via the Docker stack in `deploy/`, not consumed as an action.

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

The gateway moved from "wired but inert" to a working Discord control plane over this window. `src/` layout is now `approvals/`, `bindings/`, `discord/`, `execute/`, `github/`, `http/`, `workspace-api/`, plus `program.ts`, `readiness.ts`, `runtime-effect.ts`, `shutdown.ts`:

| Version | Capability                                                                                   |
| ------- | -------------------------------------------------------------------------------------------- |
| v0.45.0 | Channel↔repo **bindings store** (#672); GitHub App authentication (#673)                      |
| v0.46.0 | `/fro-bot add-project` slash command (#676) — binds a channel to a repo                       |
| v0.48.0 | `@fro-bot` **mention-triggered OpenCode execution** (#705) — the gateway can now run the agent |
| v0.51.0 | **Approval prompts for sensitive tool calls** (#737); fail-fast provider-semantics self-test at boot (#739); opt-in announce/presence endpoint (#740) |

The Discord-side approval flow (#737) is the human-in-the-loop gate for the daemon path that CI runs don't need — sensitive tool calls now surface a prompt before executing. The boot-time provider-semantics self-test (#739) fails fast rather than letting a misconfigured provider produce silent garbage at request time — the same `validateProviderSemantics` primitive the runtime already exposed, now run eagerly.

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

## Deployment Stack (`deploy/`, new 2026-05-22)

Docker Compose v2 stack for running the gateway + workspace executor outside CI:

| Service     | Role                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| `gateway`   | Discord gateway daemon — slash commands and mentions (`gateway.Dockerfile`)       |
| `workspace` | Workspace executor running `apps/workspace-agent` on port 9100 (`workspace.Dockerfile`, `workspace-entrypoint.sh`). **No longer a placeholder** as of v0.45.0–v0.50.0; OpenCode model/provider/auth now provisioned (#728). |
| `mitmproxy` | Egress proxy enforcing an allowlist of permitted outbound hosts                   |

**Open regression (2026-06-03, issue #741):** at v0.51.0 the workspace egress is broken — mitmproxy on the internal-only `sandbox-net` returns 502 on all outbound, so `/fro-bot add-project` clone fails. Tracks the cost of the fail-closed proxy posture meeting a network that has no permitted egress route.

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

9 workflows total:

| Workflow                  | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `ci.yaml`                 | Setup → Lint, Build (dist/ drift detection), Test, Test Action (live PR review in CI), Dependency Review, Release (preview + next branch push + release PR) |
| `auto-release.yaml`       | Merge `next` into `release`, semantic-release, update `v0` branch |
| `prepare-release-pr.yaml` | (not examined)                                              |
| `fro-bot.yaml`            | Self-hosted Fro Bot: PR review, issue triage, mentions, daily DMR (15:30 UTC), weekly wiki update (Sun 20:00 UTC) |
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

`semantic-release` with `@semantic-release/git` (commits dist/ + package.json), `@semantic-release/exec` (version output), `@semantic-release/github` (GitHub releases). Conventional commits with custom release rules (`build` → patch, `docs(readme|rfcs)` → patch, `skip` → no release).

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

| Package               | Version (2026-06-03) | Was @ v0.44.3 | Purpose                              |
| --------------------- | -------------------- | ------------- | ------------------------------------ |
| `@actions/artifact`   | 6.2.1                | 6.2.1         | Artifact upload (root dep now)       |
| `@actions/cache`      | 6.0.1                | 6.0.0         | GitHub Actions cache operations      |
| `@actions/core`       | 3.0.1                | 3.0.1         | Action I/O, logging, state           |
| `@actions/exec`       | 3.0.0                | 3.0.0         | Subprocess execution                 |
| `@actions/github`     | 9.1.1                | 9.1.1         | Octokit + GitHub context             |
| `@actions/tool-cache` | 4.0.0                | 4.0.0         | Tool caching for setup phase         |
| `@aws-sdk/client-s3`  | 3.1057.0             | 3.1045.0      | S3-compatible object storage         |
| `@opencode-ai/sdk`    | 1.14.41              | 1.14.41       | OpenCode execution (PR #742 pins CLI to 1.15.13) |
| `@octokit/auth-app`   | 8.2.0                | 8.2.0         | GitHub App authentication            |
| `@octokit/webhooks-types` | 7.6.1            | —             | Webhook payload typing (dev)         |
| `@bfra.me/es`         | 0.1.0                | 0.1.0         | Shared ES utilities                  |
| `discord.js`          | 14.26.4              | —             | Gateway Discord client (gateway pkg) |
| `effect`              | 3.21.2               | —             | Gateway composition layer            |
| `hono`                | 4.12.23              | —             | HTTP layer (gateway + workspace-agent) |
| `@hono/node-server`   | 1.19.14              | —             | Node adapter for Hono                 |
| `tsdown`              | 0.22.1               | 0.22.0        | Rolldown-based bundler               |
| `semantic-release`    | 25.0.3               | 25.0.3        | Automated versioning/publishing      |
| `simple-git-hooks`    | 2.13.1               | 2.13.1        | Pre-commit (lint-staged), pre-push   |

## Renovate Configuration

Extends `github>fro-bot/.github` (the `.github` repo's Renovate config). `dist/**` ignored from all scans.

Five custom regex managers tracking pinned versions in `packages/runtime/src/shared/constants.ts` (the constants moved out of the action's `src/shared/` into the runtime package at v0.45+):

| Constant (2026-06-03)              | Datasource                                   |
| ---------------------------------- | -------------------------------------------- |
| `DEFAULT_OPENCODE_VERSION = '1.14.41'` | GitHub releases `anomalyco/opencode`     |
| `DEFAULT_BUN_VERSION = '1.3.14'`   | GitHub releases `oven-sh/bun`                |
| `DEFAULT_OMO_VERSION = '3.17.15'`  | npm `oh-my-openagent`                        |
| `DEFAULT_OMO_SLIM_VERSION = '1.1.1'` | npm `oh-my-opencode-slim` (**new v0.49.0**)|
| `DEFAULT_SYSTEMATIC_VERSION = '2.24.0'` | npm `@fro.bot/systematic`               |

`STORAGE_VERSION = 1` governs the on-disk session/cache layout.

Post-upgrade tasks: `pnpm run bootstrap && pnpm run build && pnpm run fix`.

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

A `PRD.md` contains the full product requirements document. `RFCS.md` indexes the 19 RFC architecture decision records.

## Ecosystem Role

This is the **central runtime** consumed by all Fro Bot-managed repositories. Every repo with a `fro-bot.yaml` workflow depends on `fro-bot/agent` as a GitHub Action reference (e.g., `fro-bot/agent@v0.42.8`). The action auto-installs and configures [[marcusrbrown--systematic]] as an OpenCode plugin, connecting the agent to 45+ skills and 50 agents.

Downstream consumers span the `marcusrbrown/*`, `bfra-me/*`, and `fro-bot/*` ecosystems via `fro-bot/agent@vX` references. Version lag varies widely by Renovate cadence — as of the 2026-06-03 survey the spread runs from trailing pins (e.g. [[marcusrbrown--mrbro-dev]] at v0.43.0, [[bfra-me--ha-addon-repository]] at v0.43.1) up through the bleeding edge ([[marcusrbrown--marcusrbrown-github-io]] at v0.48.1, [[bfra-me--works]] at v0.47.0). Per-repo pins are tracked on each consumer's own wiki page rather than mirrored here, since they drift faster than this page is surveyed. The agent auto-installs and configures [[marcusrbrown--systematic]] / `@fro.bot/systematic` (v2.24.0) as an OpenCode plugin on every run.

## Build System

`tsdown.config.ts` at root bundles both action entry points with:

- **License collector plugin** — Generates `dist/licenses.txt` with deduplicated, version-sorted third-party license content from `pnpm licenses list --json --prod` cross-referenced with `generate-license-file`.
- **Hidden Unicode escape plugin** — Replaces non-ASCII characters flagged by Renovate's Unicode detector (from vendor code like `@actions/artifact` HTML entity tables and AWS SDK) with `\uXXXX` JS escapes, keeping dist/ bytes ASCII-only.
- **noExternal** — Inlines `@bfra.me/es`, `@actions/*`, `@octokit/auth-app`, `@opencode-ai/sdk`, `@aws-sdk/*`, `@smithy/*`, `@fro-bot/runtime` into the bundle.

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

Root `package.json` (`@fro-bot/agent-workspace`) holds external action/dev deps; gateway- and workspace-agent-specific deps live in their own package manifests. Workspace protocol links `@fro-bot/action` and `@fro-bot/gateway` → `@fro-bot/runtime`. The runtime exports source-level TypeScript (no pre-built dist; consumed via workspace protocol). Note the root `build` script only builds runtime + action (`pnpm --filter @fro-bot/runtime build && pnpm --filter @fro-bot/action build`) — the gateway and workspace-agent build via the Docker stack, not the action's `dist/` pipeline.

pnpm workspace config (`pnpm-workspace.yaml`) enables `autoInstallPeers`, `shamefullyHoist`, `shellEmulator`, `ignoreWorkspaceRootCheck`, `savePrefix: ''`, `strictPeerDependencies: false`. `onlyBuiltDependencies` is `[esbuild, simple-git-hooks, unrs-resolver]`. `overrides` (now all in `pnpm-workspace.yaml` after the package.json migration at v0.45.0, #665) cover `brace-expansion >=5.0.6` (bumped at v0.51.0, #734), `fast-uri`, `fast-xml-builder`, `fast-xml-parser`, `flatted`, `handlebars`, `ip-address >=10.1.1`, `lodash`/`lodash-es`, `picomatch`, `tar@^7`, `undici@^7`, `yaml`. `vite` pin now 8.0.14.

## Survey History

| Date       | SHA        | Key changes                                          |
| ---------- | ---------- | ---------------------------------------------------- |
| 2026-06-03 | `d0f39a2`  | Re-survey at v0.51.0 (jumped 7 minors from v0.44.3): **`apps/workspace-agent`** shipped (v0.45.0, Hono service for sandboxed git ops + OpenCode provisioning, port 9100, hardened `/clone`) — workspace executor no longer a placeholder; gateway grew a working Discord control plane (bindings store, GitHub App auth, `/fro-bot add-project`, `@fro-bot` mention → OpenCode execution, sensitive-tool approval prompts, boot provider self-test); **OMO Slim** added as opt-in orchestration (`enable-omo-slim`, mutually exclusive with `enable-omo`, pinned 1.1.1); expanded S3 inputs (key-prefix, expected-bucket-owner, KMS/SSE, insecure-endpoint), `skip-cache`, `omo-providers`; shared-layer constants relocated to `packages/runtime/src/shared/`; Node 24.16.0-alpine in Docker; deps (`@aws-sdk/client-s3` →3.1057.0, `tsdown` →0.22.1, Vitest →4.1.7, `@actions/cache` →6.0.1); stars 1→2. Open regression #741: mitmproxy egress 502 on `sandbox-net` breaks `add-project` clones. |
| 2026-05-22 | `8632cf4`  | Re-survey at v0.44.3: new `packages/gateway` (Discord daemon, Effect 3.x), new `deploy/` Docker stack (gateway + workspace + mitmproxy), `enable-omo` action input (oMo now opt-in), `agent` input default changed from `sisyphus` to unset/OpenCode-build, open issues 7→2, stars 0→1, dep bumps (`@opencode-ai/sdk` 1.14.30→1.14.41, `tsdown` 0.21→0.22, `vite` pin 8.0.10→8.0.13). `services/object-store/` confirmed migrated (likely into `@fro-bot/runtime`). Action `AGENTS.md` is stale (dated 2026-03-29). |
| 2026-05-08 | `ef6b952`  | Re-survey: additive detail (workspace packages, docs structure, artifact/object-store discrepancy) |
| 2026-05-07 | `ef6b952`  | Initial survey                                       |
