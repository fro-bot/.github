---
type: repo
title: fro-bot/agent
created: 2026-05-07
updated: 2026-09-25
node_id: R_kgDOQyTMEw
sources:
  - url: https://github.com/fro-bot/agent
    sha: 9918ee0036100a11e61bf80bd85efa00b90b8852
    accessed: 2026-09-25
  - url: https://github.com/fro-bot/agent
    sha: 72f11faaf0bae1fc4b96979b279abd49e394eccc
    accessed: 2026-09-25
  - url: https://github.com/fro-bot/agent/releases/tag/v0.115.1
    accessed: 2026-09-25
  - url: https://github.com/fro-bot/agent/releases/tag/v0.114.0
    accessed: 2026-09-22
  - url: https://github.com/fro-bot/agent
    sha: c7622aae2acd681b5170cf0f14071bdb5cc93c14
    accessed: 2026-09-20
  - url: https://github.com/fro-bot/agent
    sha: 096faf1ea023264ecfe5bfadbbb6c95dc6508c96
    accessed: 2026-09-05
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
tags:
  - github-actions
  - agent
  - opencode
  - omo
  - omo-slim
  - typescript
  - persistent-memory
  - ci-cd
  - fro-bot
  - semantic-release
  - bun-workspace
  - monorepo
  - discord
  - effect
  - hono
  - docker-compose
  - mitmproxy
  - harness
  - orw
  - trusted-publishing
  - oidc
  - operator-web-surface
  - oauth
  - sse
  - sbom
  - credential-broker
  - shared-runtime
  - run-cancellation
  - release-notes-narration
  - prompt-injection-hardening
  - review-skip-label
  - agent-evals
  - eval-corpus
  - semver-prerelease
  - npm-publishing
  - merge-queue
  - osv-scanner
  - image-smoke-test
  - web-push
  - actions-cache-scope
  - background-subagents
  - invocation-outcome
  - three-valued-outcomes
  - execution-budget
  - renovate-custom-managers
  - version-pin-drift
  - fleet-runtime-verification
  - brokered-push
related:
  - fro-bot--dashboard
  - fro-bot--space-bus
  - fro-bot--systematic
  - github-actions-ci
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
  - marcusrbrown--marcusrbrown
  - marcusrbrown--marcusrbrown-com
---

# fro-bot/agent

GitHub Action harness for [OpenCode](https://opencode.ai/) + [Oh My OpenAgent (oMo)](https://github.com/code-yeongyu/oh-my-openagent) with **persistent session state** across CI runs. This is the core runtime that powers Fro Bot's PR review, issue triage, scheduled maintenance, and wiki-update capabilities across all managed repositories.

**Re-survey (2026-09-25, 13:10 UTC; `main` at `72f11fa`).** Since the earlier
`9918ee0` snapshot, the repository HEAD advanced, but the permitted source
surfaces did not: root and workspace `package.json` manifests, root and workspace
READMEs, and all 12 `.github/workflows/` files have identical blob IDs in the
two trees. The root still declares five Bun workspace members, and
`.github/actions/setup/action.yaml` still installs Bun 1.3.14 by default while
`package.json` declares Bun 1.4.2. The self-hosted `fro-bot.yaml` remains present
with its daily report, weekly wiki update, and manual/reusable dispatch paths;
`ci.yaml` still hosts the live PR-review action test. This is a confirmation of
the prior workflow and package-manager findings, **not** evidence that the
unread source or deployed gateway has not changed. The earlier release and open
issue/PR counts are dated snapshots, not reconfirmed by this limited survey.
The workspace-agent README's `/clone` example still omits the bearer now
required by `deploy/README.md` for the :9100 control API; following that example
against the documented current deployment would receive 401. Treat the deploy
README as the current operator contract and the example as documentation drift.

## Overview

| Attribute              | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| Created                | 2026-01-02                                                         |
| Repo `node_id`         | `R_kgDOQyTMEw`                                                     |
| Last push              | 2026-09-25T03:00Z (survey 2026-09-25, HEAD `9918ee0`, `feat(workspace): require the gateway's bearer on the control API (#1665)`). Prior: 2026-09-20T02:48Z, HEAD `c7622aa` |
| Latest release         | **v0.114.0** (published 2026-09-21T16:26:18Z). **Correction 2026-09-22, from the [[marcusrbrown--marcusrbrown]] survey:** the 2026-09-20 reading — "v0.114.0 pending as PR #1626, and the entire background-subagent arc (#1624/#1627/#1629) sits on `main` **unreleased** — no consumer pin carries it yet" — is **superseded**. #1626 shipped the day after that survey, and [[marcusrbrown--marcusrbrown]] merged the pin at 2026-09-21T16:32:05Z (#1228), **5 m 47 s after publish** — the fastest consumer adoption measured in the fleet, ahead of [[marcusrbrown--marcusrbrown-com]]'s previously-recorded 20 minutes. The background-subagent arc plus the `invocation-outcome` / `cache-save-result` three-valued contract are therefore live on at least one consumer as of 2026-09-21. Prior: v0.113.2 (2026-09-16T09:15Z), v0.108.1 (2026-09-05) — 5 minors + patches in 11 days. **Update 2026-09-25:** latest is **v0.115.1** (2026-09-24T22:51:10Z), after v0.114.1 (2026-09-22T21:47Z, deps + #1651 per-client operator rate limits) and v0.115.0 (2026-09-23T22:39Z, #1656 checkout provenance). v0.115.1 carries #1658 (workspace clone fix). The workspace uid isolation (#1661) and control-API bearer (#1665) are on `main` but **unreleased**, pending v0.116.0 (#1664) |
| Language               | TypeScript (strict, ESM-only)                                      |
| Node.js                | **24.21.0** (`.node-version`, both deploy Dockerfiles digest-pinned to `node:24.21.0-alpine`); `node24` action runtime |
| Package manager        | **Bun `1.4.2` in `packageManager` — and `1.3.14` on every surface that actually installs** (runner default, `.github/actions/setup` default, `HARNESS_BUN_VERSION`, both Dockerfile `ARG BUN_VERSION`). See "The Bun Pin Two Managers Own". Bun cutover otherwise holds; `pnpm-lock.yaml`/`pnpm-workspace.yaml` remain removed |
| Runtime                | `node24` (GitHub Action `runs.using`)                              |
| Bundler                | tsdown **0.23.0** (Rolldown-based, dual entry points)             |
| Test framework         | Vitest 4.1.11 (drives `evals/` and `scripts/` suites; open **#1631** — a worker that dies of heap exhaustion still exits 0) |
| Lint                   | ESLint 10.9.1 (`@bfra.me/eslint-config` **0.52.2**), Prettier **3.9.8** (was 3.9.6 at `c7622aa`; #1646). ESLint v10.11.0 still waits in #1617 |
| TypeScript             | 6.0.3                                                              |
| OpenCode default       | **Harness build `1.18.30+harness.7c479429`** — the *binary self-report* identity; the matching GitHub Release / npm version is `1.18.30-harness.7c479429` (see "Harness Version Namespaces"). SDK at 1.18.30; harness `base_version: 1.18.30`; **15 integration refs**, was 13 — `anomalyco/opencode#48267` + `#48268`, the two provider-transform carries whose motivating issues (#1578 OpenAI cache anchor, #1579 OpenAI model versions without a dotted minor) are still open here |
| Release                | semantic-release on `release` branch, `next` → `release` PR model  |
| License                | MIT                                                                |
| Visibility             | Public                                                             |
| Stars                  | 4 (flat)                                                           |
| Open issues            | **12** (was 7): #252 DMR, #579 dep dashboard, #1180 dedicated minting App, #1520 first-party App PRs can't be reviewed, #1532 trivially-true eval assertion, **#1578**/**#1579** two OpenAI carries now shipped as harness refs but tracked open, **#1580** lock-contended runs are discarded with no requeue so batch-filed issues silently lose triage, **#1581** Copilot-hosted GPT/Gemini models have no cache anchor either, **#1598** track downstream migration onto the #1597 credential preflight (the DMR now feeds it — see below), **#1631** a Vitest worker that dies from heap exhaustion still exits 0, **#1633** the egress containment smoke fails on a shared unauthenticated API quota, not on containment. **Ten of twelve are `marcusrbrown`-authored**; the bot-filed share keeps shrinking. Closed this window: #1514 (2026-09-05) and #1517 (2026-09-11, by the `fix(setup)!` in #1597). **Update 2026-09-25: 21 open issues (was 12), all nine new ones `marcusrbrown`-authored**, and most of them are about the gateway/workspace deployment rather than the action: #1634 (the workspace never updates an existing checkout, so persistent-volume deployments run against a stale tree; plan `docs/plans/2026-09-24-001-feat-workspace-checkout-update-recovery-plan.md` landed in this window), #1636 and #1637 (operator push trigger kind and health), #1639 (a completed run stream never terminates when the terminal replay cache has no entry), #1642 (unpinned `apk` installs make the gateway image non-reproducible), #1645 (announce rate limiting runs before authentication on a key every caller shares), #1652 (per-client rate-limit keys make two previously unreachable ceilings reachable, a follow-on from #1651), #1655 (lock takeover on lease expiry does not establish that the previous holder stopped writing), #1663 (the workspace container has no init, so orphaned tool processes become zombies, a follow-on from the #1661 uid split). 19 of 21 are `marcusrbrown`-authored |
| Open PRs               | 6, all `fro-bot[bot]` — #1626 pending release v0.114.0, #1622 `@fro.bot/systematic` v3.20.0, #1625 osv-scanner-action v2.6.0, #1621 codeql-action v4.38.1, #1623 js-yaml v5.4.2, #1617 eslint v10.10.0. **Update 2026-09-25: 3 open.** #1664 pending release v0.116.0 (`fro-bot[bot]`), #1617 eslint (now v10.11.0, open since 2026-09-15), and #1666 `test(workspace): make the unconfirmed-termination test deterministic` (`marcusrbrown`). All five 09-20 Renovate PRs besides #1617 merged |
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

**12 workflows** as of the 2026-09-05 survey (`osv-scanner.yaml` added; `harness-integrate.yaml` added in the v0.80 broker wave):

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
| `osv-scanner.yaml`        | **New (2026-09-05 survey).** `google/osv-scanner-action` v2.5.1 reusable workflows, SHA-pinned, `permissions: {}` at file level. Two mutually exclusive jobs with **deliberately different failure policies** — see below |

### OSV-Scanner: Two Scan Modes, Two Failure Policies (new)

`osv-scanner.yaml` is the clearest example in the repo of a policy the rest of the fleet gets wrong by default:

- **`scan-pr`** (`pull_request` only) uses the upstream *PR* reusable workflow, which checks out `GITHUB_BASE_REF` and diffs against it. `fail-on-vuln: true` — it fails only on vulnerabilities *this pull request introduces*, so a previously known finding cannot fail an unrelated change.
- **`scan-scheduled`** (`push` / `schedule` / `merge_group`) runs the full-tree reusable workflow with **`fail-on-vuln: false`, report-only, deliberately**. The in-file comment gives the reason: a whole-tree scan has no baseline to compare against, so failing here would break pushes to `main` and merge-queue entries whenever a new advisory is published against a dependency nobody touched. Findings go to code scanning instead.

The `merge_group` case is called out explicitly: neither `GITHUB_BASE_REF` nor the `pull_request` payload exists in a merge queue, so the merge-queue path runs the full scan rather than the diff scan. Both `ci.yaml` and `osv-scanner.yaml` now declare `merge_group: [checks_requested]` triggers — the repo is merge-queue-ready, though the queue itself is not expressible in `.github/settings.yml`.

### CI Details

- **Path filtering** via `dorny/paths-filter` — lint and build only run when relevant files change.
- **Image smoke tests (new, 2026-09-05 survey)** — `ci.yaml` grew two jobs, **`gateway-smoke` (Gateway Image Smoke Test)** and **`workspace-smoke` (Workspace Image Smoke Test)**, and both are now **required status checks on `main`** (contexts 10 → **12**). The `deploy/` Compose stack was previously built and verified only out of band; it is now gated by the same merge that gates the action. This is the largest contributor to `ci.yaml`'s growth to ~42 KB.
- **Live egress containment smoke (2026-09-20 survey)** — `Workspace Image Smoke Test` grew a `Live egress
  containment smoke` step backed by new `deploy/egress-smoke.sh` + `deploy/scripts/`, proving outbound
  traffic from the workspace container is actually routed through mitmproxy. Open **#1633** reports it
  **fails on a response body it does not control**: the proof makes an unauthenticated API call, so a
  shared quota — not a containment regression — is what turns the step red, and the failure is unrelated
  to whatever change is being tested. A containment test whose oracle is a third party's rate limiter
  measures the rate limiter. Same family as #1631 and as the fleet's conclusion-vs-deliverable findings;
  generalized in [[github-actions-ci]].
- **Repo-invariant guards as unit tests** — `scripts/` now carries a suite of tests that assert properties of the repository's own configuration rather than of product code: `fro-bot-workflow.test.ts`, `osv-scanner-workflow.test.ts`, `harness-tag-derivation.test.ts`, `action-input-defaults-guard.test.ts`, `dmr-runtime-verification.test.ts` (new), `release/release-policy.test.ts` (new), `packages/harness/src/pin-invariants.test.ts` (new — binds `ARCHITECTURE.md`'s documented Systematic pin to `constants.ts`), `workspace-test-chain.test.ts` (guards that every workspace member is actually in the root `test` fan-out — a test for the test runner's own coverage), `module-taxonomy.test.ts`, `eslint-phantom-guard.test.ts`, `bfra-me-exemption-guard.test.ts`, `plan-frontmatter-guard.test.ts`, plus `md-links` and `third-party-notices`. Same family as [[marcusrbrown--infra]]'s `conventions.test.ts`, applied to workflows and manifests. A new `check:md-links` step joins `lint`.
- **The gateway joined the root pipeline.** Root `build` / `lint` / `test` / `check-types` / `fix` now all fan out to `@fro-bot/gateway` in addition to runtime + action + harness. Previously the gateway built only via the Docker stack.
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

## Agent-Outcome Eval Corpus (`evals/`, new 2026-09-05 survey)

The single largest structural addition since the harness. A new top-level `evals/` tree (23 files: `runner`, `corpus-runner`, `corpus-verdict`, `gates`, `scenarios/`, `baselines/`, `compare`, `diagnostics`, `fixture-repo`, `presearch-differential`, `update-baseline`, `types`, each with a colocated `*.test.ts`) is a **gated regression corpus for the quality of the agent's actual outcome** — it runs the real `executeOpenCode` path against disposable fixture repositories and writes a JSON report with provenance and hard gate results. It is wired into the root `test` script via `test:evals` (`vitest run evals/`), with `evals:baseline:update` and `evals:presearch` as operator entry points.

This is the first observed *behavioral* test surface in the ecosystem. Everything else in the fleet tests code; this tests the agent.

Its design discipline is the durable part, and it is unusually sharp:

- **"Assert outcomes, never method."** The corpus may not assert that the agent called a particular tool, made a particular number of calls, followed a step or turn order, or used a particular reasoning shape. It may assert only observable outcomes: response-file parsing, the verdict, exactly one delivery artifact, forbidden mutations, secret leakage, and whether a planted defect was identified **by file path**. Tool calls, call counts, reasoning order, and step counts are explicitly declared "never quality fields."
- **Three-valued result state, and the incident that produced it.** Scenarios report `passed` / `failed` / **`inconclusive`** rather than a boolean. The README records the origin: an early misconfiguration left the agent running *outside* the fixture repository, so scenarios burned their whole budget searching the filesystem and timed out. Under a boolean, every one of those runs reads as a catastrophic model regression; as `inconclusive` they correctly reported that no outcome was obtainable and **sent the investigation at the harness instead of the model**. The README names collapsing these states back into a boolean as "the main way this corpus degrades into a noisy artifact nobody trusts." This is the eval-layer rediscovery of the [[github-actions-ci]] finding *A Run's Conclusion Measures the Harness, Not the Deliverable* — arrived at independently and encoded as a type rather than a lint.
- **Asymmetric assertion rule.** Quality gates may assert that a required signal is **present** in free-form response prose, but never that a signal is **absent**. Absence is only meaningful for single-valued structured fields such as the expected verdict. (Absence in generated prose is unfalsifiable at any sample size a CI budget allows.)
- **Safety gates survive inconclusiveness.** `no-forbidden-mutation` and `no-secret-leak` still run on an incomplete execution, because repository mutation and canary leakage remain observable safety findings even without a completed review outcome. A suite with any inconclusive scenario and no failures is itself `inconclusive`; the command is green only for `passed`. An empty report set is `failed`, not vacuously green.
- **Differential scenario pairs.** `clean-pr` / `planted-defect` share one neutral prompt, the same PR event, the same file set, and the same `diffFiles` summary; only the implementation of `src/access.ts` differs. The planted-defect expectation lives in **scorer-owned metadata, never in the agent-facing prompt** — "adding answer-revealing text destroys the corpus by measuring obedience rather than judgment."
- **Bounded stochastic handling.** Safety and response-contract failures block immediately with no retries. A stochastic quality failure requests lazy repeats for that scenario only, capped at four candidate and four reviewed-baseline samples. Mixed samples — or two modes that both pass without discrimination — remain inconclusive and **never auto-promote a candidate baseline**.
- **Honest negative-result framing.** A clean comparison reports only "no large observed regression across the six covered scenarios"; it explicitly does not claim improvement or production-surface quality.
- **Costs nothing by default.** The live corpus is skipped unless `FRO_BOT_EVAL=1` is set; the gates themselves are pure functions in `gates.ts` and run in normal CI. `FRO_BOT_EVAL_MODEL` defaults to the free, credentialless `opencode/big-pickle`.

Known debt, recorded by the project itself: the committed `evals/baselines/u1.json` **predates the stable outcome projection**, so comparison returns explicit missing-evidence rather than copying candidate values into the baseline or inferring a verdict from expected metadata. And open issue **#1532** reports that the redaction test in `evals/diagnostics.test.ts` never truncates, making its assertion trivially true — the corpus built to catch unfalsifiable claims shipped one.

A `U4` "bounded session-presearch experiment" rides on the same seam: an eval-only differential strategy injected by DI through the runner (no action input, no feature flag, no env switch, no global state) that removes eager recent/prior-work context for the two continuation scenarios while preserving logical key, continuation identity, and native `session_*` capability. Its `sessionPresearch` accounting is advisory provenance, never a gate.

## Background Subagents (2026-09-20 survey — on `main`, unreleased)

The dominant arc of the v0.109–v0.114 window, and the first capability change to the agent's *execution
model* since SDK mode. It shipped as a requirements-first chain, each link a separate PR:

| PR     | Landed     | Change                                                                 |
| ------ | ---------- | ---------------------------------------------------------------------- |
| #1606  | 2026-09-14 | `docs/brainstorms/2026-09-13-opencode-background-subagents-requirements.md` — requirements before code |
| #1608  | 2026-09-14 | **Disable the OpenCode file watcher on both surfaces** — prerequisite, not a tidy-up |
| —      | 2026-09-14 | `docs/plans/2026-09-14-001-feat-background-subagent-ownership-plan.md`  |
| #1624  | 2026-09-18 | **Ownership and drain** for background subagents                        |
| #1627  | 2026-09-18 | **Tie completion evidence to the turn that produced it**                |
| #1628  | 2026-09-19 | Record the ownership units as shipped; describe the freshness rule      |
| #1629  | 2026-09-20 | **Turn on background subagents**                                        |
| #1632  | 2026-09-20 | Capture three learnings                                                 |

Two things are worth holding onto beyond the feature itself.

**The switch landed last.** Ownership, drain, and completion-evidence semantics all merged *before* the
flag that turns the capability on — three PRs of containment ahead of one PR of enablement. The reverse
order is the common one and it is how a concurrency feature acquires an unowned-work leak that only
appears under load.

**The teardown became load-bearing, and the workflow says so.** `fro-bot.yaml`'s job cap carries an
explicit comment that the action's own `timeout:` "is the deadline that matters, because it is the one
that can still drain owned background work, cancel what will not settle, write a job summary, and
publish a response." Background work turns a job-level kill from a blunt instrument into a correctness
problem: whatever the runner kills mid-drain is work nobody reports.

The three learnings are recorded as `docs/solutions/` entries and read as a coherent set — an
`integration-issues/permission-ask-dropped-by-ownership-filter` (an ownership filter swallowing a
permission prompt), a `logic-errors/fail-closed-against-an-unchecked-default` (a fail-closed branch
measured against a default nobody verified), and a `workflow-issues/read-the-test-count-before-blaming-the-file`.
That last one is the same defect family as open issue **#1631** below, found from the other direction.

**Consumer-facing status: none of this is released.** The latest release is v0.113.2 (2026-09-16); the
whole arc sits on `main` behind pending-release PR #1626 (v0.114.0). Any downstream page recording a
`fro-bot/agent@v0.113.x` pin is recording a build *without* background subagents.

## The Action Reports a Third State (`invocation-outcome`, `cache-save-result`)

Two new `action.yaml` outputs, and they are the most quietly important change in the window. Both encode
honesty about incompleteness into the action's **public contract**, where a consumer workflow can branch
on it — not into a log line.

**`invocation-outcome`** — four values, not two:

- `succeeded` — delivery succeeded **and** every verification fact checked out: *observation completeness,
  ownership resolution, server quiescence, lease continuity*.
- `incomplete` — "a useful result may exist, but this invocation could not certify completion." No dedup
  marker is written and no success reaction is posted, so the work is re-attemptable rather than silently
  banked.
- `failed` — verification was complete and delivery did not succeed.
- `skipped` — no matching trigger, a deduplicated repeat, or coordination-lock contention.

This is the eval corpus's `passed`/`failed`/**`inconclusive`** trichotomy (2026-09-05 survey) promoted
out of the test harness and into the runtime's output contract. The corpus adopted a third state because
a boolean blamed the model for a harness misconfiguration; the action now adopts one because a boolean
would let an uncertifiable run claim success. Same lesson, one layer down, and both are instances of the
fleet-wide [[github-actions-ci]] finding *a run's conclusion measures the harness, not the deliverable* —
this time encoded as a type rather than diagnosed after the fact.

The `skipped` value also names **coordination-lock contention** as an intentional non-delivery, which is
exactly what open **#1580** says is a defect at the fleet level: lock-contended runs are discarded with no
requeue, so batch-filed issues silently lose triage. The output honestly reports the outcome; nothing
consumes the report and retries. An accurate signal with no subscriber is the recurring shape here.

**`cache-save-result`** — five values (`durable`, `store-only`, `skipped`, `declined-for-safety`,
`not-persisted`), with two lines of unusual discipline in the description itself:

- **"Reports a result, not proof of durability."** The action refuses to claim more than it observed.
- `declined-for-safety` is split from `not-persisted` **because only one of them is retried**: a save
  deliberately refused because persistence safety could not be confirmed ("a live writer may still
  exist") is *not* retried from the post-action hook; a rejected write or a declined checkpoint is.
  Collapsing those two into one "didn't save" state would either strand recoverable runs or have the
  post-hook race a live writer.
- Both outputs are **"only set from the main step"**, with the reason stated: a value set from the
  post-action hook arrives after every other step has already run, so it cannot be consumed. The
  post-hook retry reports to the job summary instead. This is a clean articulation of a GitHub Actions
  ordering constraint that most post-hooks pretend does not exist.

This answers the closed **#1514** (mention runs cannot persist without S3, and the config doesn't say so)
with instrumentation rather than prose alone: the run now names which of five persistence outcomes
happened, on a surface a caller can read.

## The Execution Budget Is Derived, Not Constant

`fro-bot.yaml` grew a `Compute action execution budget` step whose in-file reasoning is the most
generalizable artifact of this survey:

- The job cap is **75 minutes**, sized against real history ("the longest genuine run observed is 43
  minutes, nearly all are under ten") and explicitly described as a **backstop only**.
- The action's deadline is computed as `75m − (measured pre-action elapsed) − 15m teardown reserve`.
  A first step records `epoch-ms` *before checkout* so PR-head resolution, checkout, setup, App-token
  mint, and (daily only) the #1598 collector's cross-owner network calls are all counted. The prior
  shape — a fixed 60-minute constant — "assumes negligible pre-action time."
- **The budget is never floored upward.** Clamping a near-exhausted or negative budget up to a minimum
  "used to hand the action a deadline with no teardown reserve left in the job cap at all — the exact
  failure this step exists to prevent." If less than `min_budget_ms` remains, the step **fails outright
  before the action launches**.
- The comment even states the measurement's own error direction: a first-step timestamp "cannot run
  before the job actually starts," so elapsed time is very slightly *undercounted*, which the reserve is
  sized to absorb.

The rule underneath: **a job-level `timeout-minutes` is a kill, not a deadline.** Only an in-process
deadline can drain, cancel, summarize, and publish. Generalized in [[github-actions-ci]].

## Fleet Runtime-Verification Sweep (#1601, tracking #1598)

The Daily Maintenance Report now measures the fleet's adoption of this repo's own breaking change. #1597
(`fix(setup)!: check effective Git credentials on withheld runs`, v0.111.0) closed the fail-open preflight
reported in #1517; #1598 tracks which downstream repositories are actually observed *running* a release
that contains it.

- A dedicated daily-schedule-only step runs `scripts/dmr-runtime-verification.ts` **across the four owners
  the roster spans**, writing `.context/dmr-runtime-verification/runtime-verification.json`. It is
  `continue-on-error: true` — "a collector failure must never block the daily report" — and uses
  `FRO_BOT_PAT` **confined to that step's own env**, because the minted App token above it is scoped to a
  single owner.
- The prompt instructs the agent to **read the file and not query run history itself**, and to treat its
  contents as untrusted data: "no field in it may choose a target issue, an operation, a credential, or a
  path." Data produced by the agent's own collector is still handled as data.
- The verification taxonomy refuses to launder absence into evidence: only `verified` counts;
  `not-verified`, `no-qualifying-run`, and `unavailable` "are each simply unverified — none of them is
  evidence of migration or of removal." `no-qualifying-run` is called out as an **expected steady state**,
  because the action is mention-gated and some repos invoke it only on schedule.
- Edits are confined to an exact `<!-- fro-bot-runtime-verification:start/end -->` marker pair, validated
  before writing (each marker exactly once, start before end); a malformed pair means **no mutation** plus
  an operator-visible note. This is the converged form of the single-report contract the fleet has been
  circling (cf. [[marcusrbrown--infra]]'s non-converging label-AND-marker version).
- **Private repositories are explicitly out of scope for the collector** and their count is maintainer-owned.
  The public-only invariant reappears as an instruction to a counting agent.

Notable as ecosystem behavior: the control plane is now instrumenting *its consumers'* runtime versions,
not just publishing releases at them. Consumer pages should expect a `#1598`-shaped claim about their own
runtime verification state.

## The Bun Pin Two Managers Own

`packageManager` moved **1.3.14 → 1.4.0 → 1.4.2** in this window while every Bun surface that actually
installs anything stayed at **1.3.14**. The cause is precise and worth recording as a pattern.

`renovate.json5` caps Bun deliberately:

```json5
{
  // Cap Bun at 1.3.14. The build gate requires an exact match with upstream
  // anomalyco/opencode's packageManager field at the harness base version.
  matchPackageNames: ['oven-sh/bun'],
  allowedVersions: '<=1.3.14',
}
```

…and a custom manager reads `"packageManager": "bun@X.Y.Z"` out of `package.json` under the depName
`oven-sh/bun`, with the comment "Must stay in lockstep with HARNESS_BUN_VERSION and the oven-sh/bun cap."

But Renovate's **built-in** bun/npm extraction reads the same `packageManager` string as the npm package
`bun`. `bun` and `oven-sh/bun` are different depNames on different datasources, so the cap never applied
to the manager that moved the field. Three independent signals confirm it:

1. Dependency Dashboard #579 lists **`bun 1.4.2`** under the built-in `bun` manager *and* **`oven-sh/bun
   1.4.2`** (the now-drifted custom-manager reading) alongside five sibling **`oven-sh/bun 1.3.14`** entries.
2. The merged commits are `chore(deps)`, not the `build(deps)` the `oven-sh/bun` packageRule assigns.
3. `package.json` at `096faf1` = `bun@1.3.14`; at `c7622aa` = `bun@1.4.2`.

Current state — one declared version, five enforced surfaces (six occurrences):

| Surface                                       | Value    | Tracked as    |
| --------------------------------------------- | -------- | ------------- |
| `package.json` `packageManager`               | `1.4.2`  | `bun` (npm) + `oven-sh/bun` (custom) |
| `.github/actions/setup` `bun-version` default | `1.3.14` | `oven-sh/bun` |
| `packages/harness/src/bun-version.ts`         | `1.3.14` | `oven-sh/bun` |
| `harness-release.yaml` `bun-version` (×2)     | `1.3.14` | `oven-sh/bun` |
| `deploy/{gateway,workspace}.Dockerfile` ARG   | `1.3.14` | `oven-sh/bun` |
| `DEFAULT_BUN_VERSION` (installed on consumer runners) | `1.3.14` | `oven-sh/bun` |

CI is green because `oven-sh/setup-bun` is given an explicit `bun-version` and does not read
`packageManager` — so the declared field is currently inert on every runner, which is also why nothing
surfaced the drift. The live consequence is narrower than it looks and still real: the repo's stated
lockstep invariant is violated on the exact file whose rule asserts it, and `bun install --frozen-lockfile`
runs under 1.3.14 against a `bun.lock` regenerated by whatever Bun the Renovate runner carries.

Three rules, generalized in [[github-actions-ci]]:

1. **A version cap binds a depName + datasource, not a file location.** If two managers can see the same
   string, cap both or disable one.
2. **A cap holds a pin; it cannot pull one back.** `oven-sh/bun` now reads `1.4.2` as *current* while its
   own `allowedVersions` ceiling is `<=1.3.14`, so Renovate will propose nothing — the drift is
   self-sealing.
3. **Check the commit type against the packageRule that should have set it.** A `chore(deps)` where the
   rule says `build` is the cheapest available tell that a different manager owns the update.

## Correction: the Action Interface tables on this page were stale before this survey

The "Key Inputs" and "Outputs" tables above predate several inputs and outputs that already existed at
`096faf1` and were never recorded: `trusted-head-sha`, `response-mode`, `server-bootstrap-timeout`,
`brokered-push-extra-paths` (inputs) and `delivery-kind`, `output-mode-migration`,
`brokered-push-allowlist` (outputs). Only `cache-save-result` and `invocation-outcome` are genuinely new
in the 2026-09-05 → 2026-09-20 window.

The omission matters most for **brokered push**, an entire capability this page has never described.
Per the README: a trusted same-repository, non-fork PR mention on `issue_comment` from `OWNER` / `MEMBER`
/ `COLLABORATOR` can **broker a fix commit directly to the PR head branch**. Pushes are limited to
allowlisted product, docs, and test paths; config, scripts, CI, manifests, lockfiles, Dockerfiles, and
`.git/` are hard-denied "at parse and enforcement time." `brokered-push-extra-paths` opts into extra
comma-separated prefixes for consumers keeping product code elsewhere, and the README instructs consumers
to keep checkout `persist-credentials: false`. The `brokered-push-allowlist` output emits the effective
allowlist as JSON (`defaultPaths`, `rootFiles`, `extraPrefixes`), so the enforcement decision is auditable
from the run rather than inferred from the prompt.

This is a third delivery mode alongside `working-dir` and `branch-pr`, and it is the one with write
authority into someone else's branch. Downstream pages describing Fro Bot's delivery options as
two-valued are incomplete.

## Correction: a merged commit names a Bun version it did not ship

`8e303ca` is titled `chore(deps): update Bun to v1.4.1 (#1576)`. PR #1576's title and body at merge say
**`1.4.0` → `1.4.2`**, and `package.json` at that commit is `bun@1.4.2`. The rolling `renovate/bun-1.x`
branch (opened 2026-09-07, merged 2026-09-15) advanced past its own commit message; a single-commit
squash took the stale branch message rather than the refreshed PR title.

Consequence for surveys: **`git log` is not a version ledger for bot-refreshed branches.** The repo's own
audit trail names a version it never shipped, and only the diff or the PR body is authoritative. Same
family as [[marcusrbrown--sparkle]]'s autoheal PR that widened its override mid-flight and left the title
stale — there the title drifted against its diff, here the commit subject did.

**Update (2026-09-25 survey): two more cases, and now in the published release notes.** The pattern
repeated twice in the `c7622aa..9918ee0` window:

| Commit    | Subject says                            | Diff ships                                                                                              | Release notes |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------- |
| `9dd6d7f` | `@fro.bot/systematic` to **v3.18.5** (#1622) | `SYSTEMATIC_VERSION` / `DEFAULT_SYSTEMATIC_VERSION` **3.18.4 → 3.20.0** (Dockerfile ARG + `ARCHITECTURE.md` row) | v0.114.1 says v3.18.5 |
| `21bdcd6` | `bfra-me/.github` to **v4.32.0** (#1657) | reusable-workflow pins `e181838` (v4.31.0) **→ `6f33c67` (v4.33.0)**                                          | v0.115.1 says v4.32.0 |

The 09-20 survey already listed #1622 as "`@fro.bot/systematic` v3.20.0" in the open-PR row, so the PR
title had been refreshed. Only the squash subject stayed stale. The new consequence is that
semantic-release builds the GitHub Release body from commit subjects, so the stale version is now in the
**published changelog**. #1622 matters most because `DEFAULT_SYSTEMATIC_VERSION` is the plugin version the
action installs on every consumer runner: a consumer reading the v0.114.1 notes would believe it ships
Systematic 3.18.5 when it actually ships **3.20.0**. The rule changes from "`git log` is not a version
ledger" to "**neither `git log` nor the generated release notes are**". Only the diff is authoritative.

## Workspace UID Isolation and a Bearer on the Control API (2026-09-25 survey, unreleased)

The `c7622aa..9918ee0` window (22 commits, 17 `fro-bot[bot]` Renovate, 5 `marcusrbrown`) was almost
entirely about the deployment stack, not the action. The action's `dist/` changed only through dependency
bumps, and `fro-bot.yaml` did not change. Of the five human commits, four (#1656, #1658, #1661, #1665)
work on how the workspace container trusts its own processes and callers, and the fifth (#1651) fixes
operator rate limiting. Read scope was manifests, READMEs, `deploy/` compose/Dockerfiles, and workflow
diffs. The TypeScript sources were not read.

**#1661: OpenCode now runs as its own unprivileged user.** This is the biggest change to the container's
security posture since the stack was built.

- **Two identities in one container.** The workspace-agent *service* stays uid 0, but compose drops all
  capabilities and adds back only `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, KILL`. It also sets
  `no-new-privileges:true` and turns off core dumps (`ulimits.core 0/0`). OpenCode and every tool it
  spawns run as a fixed, no-login **uid/gid 10001 (`opencode`)**. `setpriv --reuid/--regid/--clear-groups`
  (added to the `apk` line) does the drop, so no root supplementary group can survive it.
- **Separate homes.** The agent home is `/home/opencode` (0700). The service's `HOME` moved to a distinct
  root-only `/var/lib/workspace-agent/home`, so the global git config the service writes cannot be read
  or tampered with by the agent uid. The Systematic-bearing base `opencode.json` moved out of `/root/.config`
  to a root-owned, world-readable `/usr/local/share/fro-bot/opencode.base.json`. An agent-uid subprocess
  merges it into the agent's own XDG config, and auth reaches that subprocess over **stdin, never argv**.
- **Secrets under a protected tmpfs.** The token, auth, and mitmproxy CA mounts moved from world-readable
  `/run/secrets/…` and `/run/mitmproxy-certs` to `/run/workspace-agent/{secrets,mitmproxy}`, a root-only
  0700 tmpfs that is reset on every start. The agent uid only sees the merged system CA bundle. The compose
  comment admits one unverified assumption: nested file binds under a tmpfs "still [need] confirming
  against a real container."
- **A one-time, deadline-bounded migration.** Pre-existing root-owned checkouts are `lchown`'d to 10001
  on first boot (`deploy/scripts/migrate-repo-ownership.mjs`). The migration never calls `git` and is
  symlink-safe, hardlink-safe, resumable, and marked complete per checkout. It is bounded by
  `WORKSPACE_MIGRATION_DEADLINE_MS` (default 5 min). If the deadline is hit, the container **refuses to
  start** rather than run on a mixed-ownership tree. The healthcheck `start_period` went from 45 s to
  **360 s** to fit the deadline plus boot. The README documents rollback as a manual `chown -hR 0:0` per
  checkout, because an older image's root git hits "dubious ownership". It verified that claim with
  `GIT_TEST_ASSUME_DIFFERENT_OWNER=1`.
- **Fresh clones stage, then hand off.** Clones land in a root-owned `.workspace-agent/staging/` directory
  and are handed off with `lstat`/`lchown` only. Git against an agent-owned checkout runs *as* the agent,
  with a neutralized environment.
- **Security claims are proven in CI.** `ci.yaml`'s workspace smoke job gained `WORKSPACE_DOCKER_SECURITY_FLAGS`,
  which mirrors the compose `user`/`cap_*`/`security_opt`/tmpfs settings on **every** `docker run`. The
  in-file reason: "a smoke test that runs with more privilege than production doesn't prove production
  works." A new step runs `deploy/tests/isolation-harness.sh` (1,371 lines), which attempts each violation
  and asserts that it fails. The comment notes that Docker is not available on dev machines, "so this job
  is the only place these claims get proven." The smoke assertions also changed from `/root/...` to
  `/home/opencode/...` and now check `auth.json` ownership (`10001:600`), not just mode. Generalized in
  [[docker-containers]].
- **Follow-on already filed:** #1663. The container has no init process, so orphaned tool processes that
  run under the new uid split become zombies.

**#1665: the control API requires the gateway's bearer.** `/clone` and the new read-only `/inspect` on
:9100 now require `Authorization: Bearer <WORKSPACE_OPENCODE_TOKEN>`, the same root-only secret that
already guarded the :9200 OpenCode proxy. Only `/healthz` and `/readyz` stay open. The README states the
operational cost: **gateway and workspace images must be upgraded and rolled back together.** A version skew
means every clone gets 401, which users see as `workspace-unavailable`. Before this change, anything on
`sandbox-net` could ask the workspace to clone.

**#1658: clone hardening, recorded in the README.** The askpass helper is explicitly `chmod 0700` after
it is written, because the `open()` mode can be masked by umask. It answers **only** git's literal
`https://github.com` prompt (no glob) and exits 1 for anything else, so a same-request redirect to another
host cannot get the token. The clone subprocess seals global and system git config
(`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ALLOW_PROTOCOL=https`) against a planted
`url.<x>.insteadOf` redirect. These extend the "Clone Hardening" list above.

**#1656: run provenance.** The gateway now records what every run's checkout started from
(`execute/provenance.ts` and `operator-contract/provenance.ts`, with an operator-contract version bump),
backed by the workspace's new `/inspect` observation (head, worktree, `operationInProgress`). This is the
observation half of #1634. The recovery half (updating a stale checkout) exists only as a plan document.

**#1651: operator rate limits keyed on the client, not the proxy.** Behind a reverse proxy, every operator
shared the proxy's socket address. The README says "a handful of page loads can exhaust the attempt cap and
lock every operator out, with no window that drains." The fix adds a **required**
`GATEWAY_OPERATOR_TRUSTED_PROXIES` setting: exact IPv4/IPv6 addresses only, with no CIDR, hostnames, or hop
count. The unspecified address and multicast addresses are rejected at startup. The gateway refuses to
start without it once the operator surface is enabled, so compose's "all three or none" operator env
became "all four." Two parts of the documentation stand out:

- **Failure modes are listed by blast radius.** Omitting an intermediate proxy silently brings back the
  original shared-key bug, with no startup or runtime error. Naming a non-proxy address lets that caller
  assert any client identity. X-Forwarded-For entries with a port suffix (Azure App Service, some CDNs) or
  the value `unknown` reject the **whole chain** with a uniform 400, "deliberate — an address-with-port is
  ambiguous against bare IPv6, and skipping a bad entry would let a caller shape which address gets
  selected."
- **The README states the limit of its own validation.** Startup checks "cannot prove that a configured
  address is genuinely a reverse proxy … do not treat a clean startup as proof the trust boundary is
  correctly deployed." This is the fleet's "a green conclusion measures the harness" lesson applied to
  config validation.

The OAuth callback also got a single retry. If the resolved client address changes between `/start` and
`/callback` (mobile handover, VPN, CGNAT), the browser is sent back to `/start` once, and a second mismatch
fails closed. The fix itself opened #1652: per-client keys make two previously unreachable ceilings
reachable.

**Consumer-facing status.** Only #1651, #1656, and #1658 are released (v0.114.1–v0.115.1). None of them
changes the action's inputs or outputs. The Docker/uid work affects self-hosters of `deploy/`, not
`fro-bot/agent@v0` consumers.

## Setup-Path Defect Cluster (v0.109.x, 2026-09-06)

Six fixes in one day against the zero-config install path, all the same shape — a value that *looks* like
a path to an executable and is not:

- **#1563** spawn the OpenCode **binary**, not the directory it lives in; **#1565** export `OPENCODE_PATH`
  as an executable, not the install directory; **#1567** records the defect as
  `docs/solutions/integration-issues/tool-cache-directory-spawned-as-executable-2026-09-06.md`.
- **#1561** install the Systematic plugin whenever OpenCode itself was freshly installed (the two
  installs had drifted apart); **#1571** say *why* the Systematic install could not spawn its executable.
- **#1569** reject unsupported platforms **by name** instead of downloading a missing asset — the failure
  moved from a confusing 404 mid-download to a named precondition.
- **#1587** isolate the plugin-install database from restored session state; **#1593** closed five test
  gaps in `installSystematicPlugin`.

A tool-cache directory and the binary inside it differ by one path segment, and the wrong one fails at
spawn time with an error that reads like a corrupt download. Worth noting that a **cache restore** is what
made this reachable: restored state and a fresh install disagreed about what was already present.

## Harness Version Namespaces (`+harness.` vs `-harness.`, migrated 2026-08-29)

One artifact, **three deliberately different version strings** — a resolution of a real semver/packaging constraint that the prior page conflated into one field:

| Surface                          | Form                          | Why                                                                                                 |
| -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| GitHub Release tag               | `1.18.29-harness.88b6b5fb`    | Git refs cannot contain `+`; the release is created `--prerelease --latest=false` so a harness build never steals the "latest" pointer from the product agent releases, and the non-`v` prefix keeps it outside semantic-release's `^v(.+)` scan |
| npm version (`@fro.bot/harness`) | `1.18.29-harness.88b6b5fb`    | Build metadata is **not** version identity in npm — `1.18.29+a` and `1.18.29+b` are the same version. A prerelease identifier is the only way multiple harness builds off one OpenCode base can coexist. Published `--tag latest` because npm refuses to publish a prerelease without an explicit tag, and harness *is* the latest line |
| Binary self-report               | `1.18.29+harness.88b6b5fb`    | `buildHarnessVersion()` intentionally keeps build metadata; `harness-release.yaml` asserts the built binary self-reports exactly this string as an operational-integrity check. This is also the value of `DEFAULT_OPENCODE_VERSION` and the workspace Dockerfile `ARG` |

**The 2026-08-29 backfill.** On 2026-08-29 between 22:34 and 23:54 UTC, **16 historical harness builds were re-published as hyphen-form GitHub Releases** (`1.17.6` through `1.18.21`), leaving 15 legacy `+harness.` releases and 17 `-harness.` releases side by side in the same tag namespace. npm was hyphen-form from the start (`1.17.20-harness.b78cc9e1`, published 2026-07-15) — it is the *GitHub Release* namespace that was migrated to match npm, not the reverse. `1.18.29` exists **only** in hyphen form (the `+` tag 404s), which is expected: the `+` string is a binary identity, not a fetchable ref.

**Renovate cannot track this, and the repo stopped pretending it could.** `harness-release.yaml` gained a `sync-default-version` job — `needs: [prepare-integrate, build, publish]`, `continue-on-error: true`, gated on `needs.publish.result == 'success' && inputs.dry_run != true` — that opens a PR bumping `DEFAULT_OPENCODE_VERSION` in `packages/runtime/src/shared/constants.ts` **and** `ARG OPENCODE_VERSION` in `deploy/workspace.Dockerfile` to the same build, with rebuilt action `dist/`. The workflow comment states the rationale plainly: *"Replaces Renovate tracking for the harness version. Legacy `+harness.<sha>` build-metadata tags cannot be ordered; new `-harness.<sha>` tags are prereleases."* Merging that PR is the gate; not merging holds both surfaces at the prior build. Its idempotency guard checks **both** files, so a partial update (constants bumped, Dockerfile step failed under `continue-on-error`) cannot freeze the Dockerfile forever.

The release step is likewise idempotent: if the release already exists it re-uploads all seven assets with `--clobber` so a partial prior run that created the release but missed assets is repaired rather than duplicated.

**Actions-expression footgun documented in-workflow.** The `sync-default-version` job carries an explicit comment that `inputs.dry_run` is a **boolean** input and must be compared against the boolean `true`, not the string `'true'` — a boolean-vs-string `!=` coerces numerically (`'true'` → `NaN`), so `inputs.dry_run != 'true'` is *always truthy* and the job would run on dry-runs. For tag-triggered releases `inputs.dry_run` is `null`, which is also `!= true`. Generalized in [[github-actions-ci]].

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

| Package               | Version (2026-09-05) | Was @ v0.94.0 | Purpose                              |
| --------------------- | -------------------- | ------------- | ------------------------------------ |
| `@actions/artifact`   | 6.2.1                | 6.2.1         | Artifact upload (root dep now)       |
| `@actions/cache`      | 6.2.0                | 6.1.0         | GitHub Actions cache operations      |
| `@actions/core`       | 3.0.1                | 3.0.1         | Action I/O, logging, state           |
| `@actions/exec`       | 3.0.0                | 3.0.0         | Subprocess execution                 |
| `@actions/github`     | 9.1.1                | 9.1.1         | Octokit + GitHub context             |
| `@actions/tool-cache` | 4.0.0                | 4.0.0         | Tool caching for setup phase         |
| `@aws-sdk/client-s3`  | 3.1124.0             | 3.1085.0      | S3-compatible object storage         |
| `@opencode-ai/sdk`    | **1.18.26**          | 1.17.20       | OpenCode execution (harness base separately at 1.18.29) |
| `@octokit/auth-app`   | 8.3.0                | 8.2.0         | GitHub App authentication            |
| `@octokit/core`       | 7.0.7                | (new)         | Gateway Octokit core                 |
| `@octokit/webhooks-types` | 7.6.1            | 7.6.1         | Webhook payload typing (dev)         |
| `@fro.bot/systematic` | **3.16.0**           | 3.2.2         | OpenCode plugin pin (constant, not a manifest dep); v3.16.1 pending as PR #1554 |
| `@bfra.me/es`         | 0.1.0                | 0.1.0         | Shared ES utilities                  |
| `zod`                 | **4.5.4**            | (new)         | **New runtime dep** — schema validation landed in `@fro-bot/runtime`, not via Effect `Schema.*` as the v1 gateway plan anticipated |
| `discord.js`          | 14.27.0              | 14.26.4       | Gateway Discord client (gateway pkg) |
| `effect`              | 3.22.1               | 3.21.3        | Gateway composition layer            |
| `hono`                | 4.13.5               | 4.12.27       | HTTP layer (gateway + workspace-agent) |
| `@hono/node-server`   | 2.1.1                | 2.0.9         | Node adapter for Hono                |
| `web-push`            | **3.6.7**            | (new)         | **New gateway dep** (+ `@types/web-push`) — browser push notifications on the operator web surface |
| `yaml`                | 2.9.0                | (new, gateway)| Gateway `metadata/repos.yaml` redaction reader |
| `eslint`              | 10.9.1               | 10.7.0        | Lint (dev)                           |
| `prettier`            | 3.9.6                | 3.9.5         | Format (dev)                         |
| `tsdown`              | 0.22.14              | 0.22.7        | Rolldown-based bundler               |
| `vitest`              | 4.1.11               | 4.1.10        | Test runner (dev)                    |
| `semantic-release`    | 25.0.9               | 25.0.7        | Automated versioning/publishing       |
| `vite` (override)     | 8.2.2                | 8.1.4         | Pinned override                      |
| `undici` (override)   | **>=8.9.0**          | >=7.24.0      | Override crossed a **major floor** (v7 → v8) |
| `bun` (pkg manager)   | 1.3.14               | 1.3.14        | Workspace package manager (Bun cutover holds); 1.4.0 pending as PR #1550 |
| `simple-git-hooks`    | 2.14.0               | 2.13.1        | Pre-commit (lint-staged), pre-push   |

**Override ledger expanded** — root `package.json` `overrides` grew from 13 to **18** entries: new `conventional-changelog-writer >=9`, `js-yaml >=4.3.1`, `nanoid >=3.3.17 <7.0.0`, `postcss >=8.5.23`; floors raised on `brace-expansion` (5.0.6 → 5.0.9), `fast-uri` (**3.x → >=4.1.2**, major), `fast-xml-parser` (5.7.0 → 5.10.1), `flatted` (3.4.2 → 3.4.4), `ip-address` (10.1.1 → 10.3.1), `tar` (7.5.11 → 7.5.21), `undici` (**7.24.0 → 8.9.0**, major). New devDeps: `js-yaml` 5.4.1, `read-package-up` 12.0.0, `jiti` 2.7.0, `conventional-changelog-conventionalcommits` 10.4.0, `@vitest/eslint-plugin` 1.6.27.

**Dependency deltas (2026-09-05 → 2026-09-20).** A dependency-churn-heavy interval — 28 of 56 commits are
`fro-bot[bot]` Renovate merges, the other 28 `marcusrbrown`, an even split the fleet rarely shows.
`@opencode-ai/sdk` 1.18.26 → **1.18.30** (at its `<=1.18.30` ceiling, so the next SDK release needs a
deliberate cap raise); `@aws-sdk/client-s3` 3.1124.0 → **3.1131.0**; `@fro.bot/systematic` 3.16.0 →
**3.18.4** through six bumps (3.16.1 → 3.16.3 → 3.16.5 → 3.18.4), with **3.20.0** open as PR #1622;
`tsdown` 0.22.14 → **0.23.0** (needed #1603 to unblock Renovate CI first); `hono` 4.13.5 → **4.13.7**;
`effect` 3.22.1 → **3.22.2**; `yaml` 2.9.0 → **2.9.1**; `@octokit/core` 7.0.7 → 7.0.8; `@octokit/auth-app`
8.3.0 → 8.3.1; `lint-staged` 17.4.1 → **17.5.1**; `@bfra.me/eslint-config` 0.52.1 → 0.52.2; `@types/node`
24.13.3 → 24.13.4; Node **24.19.0 → 24.21.0**; `vite` override 8.2.2 → **8.3.0**. The 18-entry override
ledger is otherwise byte-stable — no new entries, no raised floors. Workspace membership, member
dependency sets, and `@fro.bot/harness`'s zero-runtime-dependency posture are all unchanged.

**Correction (2026-09-05):** the prior page recorded `@semantic-release/npm` as "added to `.releaserc.yaml`" at v0.94.0. It is in the plugin list — confirmed — but it is **not** a declared devDependency (it ships inside `semantic-release`). The declared `@semantic-release/*` devDeps are `exec` 7.1.0 and `git` 11.0.1 only.

## Renovate Configuration

Extends `github>fro-bot/.github` (the `.github` repo's Renovate config). `dist/**` ignored from all scans.

Five custom regex managers tracking pinned versions in `packages/runtime/src/shared/constants.ts` (the constants moved out of the action's `src/shared/` into the runtime package at v0.45+):

**Update (2026-09-20).** The manager set grew to **14 custom regex managers** and the config now carries
its rationale inline — the most self-documenting Renovate config in the fleet. Highlights beyond the
version table below:

- `platformCommit: 'enabled'` with the reason stated: the git-CLI path runs `postinstall: simple-git-hooks`,
  whose pre-push hook re-runs `lint && build` — "roughly two minutes per branch" of repeated work. The API
  path cannot run hooks at all and attributes commits to the App.
- **Two ceilings, both verification-gated**: `@opencode-ai/sdk` + `anomalyco/opencode` at `<=1.18.30`
  ("OpenCode ships breaking changes in patch releases"), and `oven-sh/bun` at `<=1.3.14` — see "The Bun
  Pin Two Managers Own" for how the second one was routed around.
- `@types/node` capped `<25` with a falsifiability argument: every runtime surface is Node 24, "newer types
  describe a stdlib none of them have, and type-checking against them succeeds by construction, so CI
  cannot catch the mismatch."
- `vulnerabilityAlerts.minimumReleaseAge: '3 days'` **deliberately re-imposed** on the security path,
  because `bunfig.toml` sets a hard 3-day install gate: a same-day `[SECURITY]` PR "is guaranteed CI-red
  until the gate clears," so opening it early produces red noise rather than a fix. The documented escape
  hatch is a per-incident `bunfig minimumReleaseAgeExcludes` bypass. This is the inverse of the
  [[marcusrbrown--marcusrbrown-com]] failure mode, where a hard audit gate froze the merge train — here
  the policy is tuned *to* the gate instead of fighting it.
- `postUpgradeTasks` run `bun install --ignore-scripts && bun run build`, with `--ignore-scripts` explained
  (keeps the pre-push hook out of the runner) and the `build` step justified (its final stage escapes dist
  hidden Unicode, so update branches stay clean of characters Renovate would otherwise flag).
- A new manager tracks the **Systematic version documented in `ARCHITECTURE.md`**, anchored `^…$` to the
  repo-root file, paired with `packages/harness/src/pin-invariants.test.ts` (new, #1591) asserting the
  prose matches `DEFAULT_SYSTEMATIC_VERSION`. Documentation is now a tracked pin surface with a failing
  test behind it — the answer to the "docs drift silently past constants" class seen across the fleet.

| Constant (2026-09-20)              | Datasource                                   |
| ---------------------------------- | -------------------------------------------- |
| `DEFAULT_OPENCODE_VERSION = '1.18.30+harness.7c479429'` (was `1.18.29+harness.88b6b5fb`) | **No longer Renovate-tracked.** Bumped by the repo-owned `sync-default-version` job in `harness-release.yaml` (see "Harness Version Namespaces"); `+harness.` build metadata is unorderable, which is exactly why Renovate was retired from this pin. `FALLBACK_VERSION` in `opencode.ts` (Renovate `github-releases`) remains the plain stock base when latest-fetch fails |
| `DEFAULT_BUN_VERSION = '1.3.14'`   | GitHub releases `oven-sh/bun`, **capped `<=1.3.14`** (`extractVersionTemplate: ^bun-v(?<version>.*)$`) |
| `DEFAULT_OMO_VERSION = '4.19.4'`   | npm `oh-my-openagent` — flat since 2026-09-05 |
| `DEFAULT_OMO_SLIM_VERSION = '2.2.19'` | npm `oh-my-opencode-slim` (was 2.2.17); 2.2.21 sits **Rate-Limited** on the dashboard |
| `DEFAULT_SYSTEMATIC_VERSION = '3.18.4'` | npm `@fro.bot/systematic` (was 3.16.0) — see [[marcusrbrown--systematic]]. Mirrored into `deploy/workspace.Dockerfile`'s `ARG SYSTEMATIC_VERSION` and into `ARCHITECTURE.md`, all three tracked and test-bound |

Renovate now also tracks the harness native-build Bun pin via two additional custom managers: `HARNESS_BUN_VERSION` in `packages/harness/src/bun-version.ts` and the `bun-version:` inputs (build + publish jobs) in `harness-release.yaml`, both against `oven-sh/bun` and kept in lockstep with the `BUN_VERSION` ARG in `deploy/gateway.Dockerfile`. `base_version` in `harness.config.json` is tracked via a `github-releases` manager (`1.17.14` as of 2026-07-07).

`STORAGE_VERSION = 1` governs the on-disk session/cache layout. `DEFAULT_MODEL.modelID` is `big-pickle` (the default inference model ensuring OpenCode Zen starts).

**Note (2026-06-14):** with the harness-as-default cutover, the OpenCode version no longer tracks a plain `anomalyco/opencode` release via custom regex manager — the default is a harness build whose base version is set in `harness.config.json` (`base_version: 1.17.6`). The harness release itself is produced by the fenced `harness-release.yaml` pipeline rather than a Renovate version bump.

**OpenCode event-contract / pin history:** the 1.14.42+ `/event` SSE `SyncEvent` regression (`message.part.updated`, `message.updated`, `session.next.*` not reaching `bus.subscribeAll()` subscribers) was fixed upstream (#27959) and verified in 1.15.13. That event contract changed the streaming surface: tool lifecycle and text now arrive via `message.part.updated` / `message.part.delta`, so `session.next.tool.*` / `session.next.text.delta` no longer fire — legacy handlers in `streaming.ts` are retained as fallback. This drove the gateway tool-progress migration (#744, v0.52.0).

**As of v0.63.0 the OpenCode version is no longer a simple Renovate-capped pin** — the default is the harness build. As of the 2026-07-21 survey `base_version: 1.18.4` in `harness.config.json` (after rebasing through 1.16.0 #786 … 1.17.14, then 1.17.20 #1222/v0.91.0, then **1.18.4** #1254/v0.94.0). The 1.18.4 upstream base brings a 300s OpenAI header timeout, an Azure deployment-endpoint fix, Kimi/Moonshot adaptive thinking, Meta `xhigh` reasoning, and a native `subagent_depth` default; all 12 carries preserved in order, headless CI behavior unchanged. Both action surfaces — the `DEFAULT_OPENCODE_VERSION` constant and the workspace Dockerfile `ARG` — are updated together in the post-publish sync (#1256) so they always track the same patched build. The action consumes the harness GitHub Release; `FALLBACK_VERSION` is the plain stock base when the latest-fetch fails. See "Harness-as-Default-OpenCode Cutover" above.

Post-upgrade tasks: `bun run bootstrap && bun run build && bun run fix` (Bun cutover — the AGENTS/README post-upgrade recipe migrated off `pnpm run …`).

## Probot Settings

Extends `fro-bot/.github:common-settings.yaml` via `.github/settings.yml`.

Branch protection on `main`: enforce admins, linear history, `strict: true`, 1 required reviewer, dismiss stale reviews, code owner reviews, last push approval. Required checks (2026-09-05, **12 contexts**, up from 10): Analyze, Build, CodeQL, Dependency Review, **Gateway Image Smoke Test**, Lint, Release, Test, Test GitHub Action, Setup, `Renovate / Renovate`, **Workspace Image Smoke Test**. Merge settings: merge + squash allowed, **rebase disallowed**, delete branch on merge.

Note that neither `OSV-Scanner PR scan` nor `Scorecard` is a required context — consistent with the OSV file's own report-only stance on the full scan, but it means the PR-diff scan (which *is* `fail-on-vuln: true`) gates nothing at the merge boundary.

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

**New 2026-09-05:** two new top-level directories — **`evals/`** (the agent-outcome eval corpus, its own section above) and **`assets/`** (`banner.svg`, `styleguide.md`, `fro-bot.png`, `github-app-logo{,-alt,-512}`), the same brand-token surface that landed in [[fro-bot--space-bus]] and [[fro-bot--dashboard]]; the README now renders `./assets/banner.svg`. `.opencode/` grew a `themes/` dir + `tui.json`. New `docs/reference/` holds **`carry-ledger.md`** — the harness carry list finally has a documented ledger rather than living only in `harness.config.json` and the Carry Policy prose. New `docs/github-app.md` + `docs/github-app-setup.md` at the docs root. Root `.markdownlint-cli2.yaml` and `LICENSE` (MIT) are present; `.agents/skills/` is still the two skills (`generating-project-docs`, `versioned-tool`).

**README correction to the headline claim (2026-09-05).** The README no longer asserts unqualified persistent memory. It now records the precise platform constraint behind open issue #1514: cache **writes** are unavailable for `issue_comment` and `issues` runs because those triggers are initiable by an actor without repository write access, so GitHub supplies a read-only runner-injected `ACTIONS_RUNTIME_TOKEN` **for the whole trigger class** — a run started by a maintainer is affected too, and changing `permissions:` cannot change that token. `workflow_dispatch` and `schedule` are unaffected; `pull_request` triggers "were not observed either way"; fork PRs carry separate cache-scope restrictions. The stated remedy is `s3-backup` for mention-driven continuity, itself best-effort. Generalized in [[github-actions-ci]].

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

**Update (2026-09-05 survey, HEAD `096faf1`):** the v0.95–v0.108.1 wave (14 minors + patches in ~6.5 weeks). This one **is** structural — the first new top-level subsystem since `packages/harness`:

- **`evals/` — an agent-outcome regression corpus** (own section above). Assert-outcomes-never-method; three-valued `passed`/`failed`/`inconclusive` states born from a harness misconfiguration that a boolean would have misattributed to the model; asymmetric present-but-never-absent prose assertions; scorer-owned planted-defect metadata; bounded 4×4 stochastic repeats that never auto-promote a baseline. Skipped without `FRO_BOT_EVAL=1`, so it costs nothing in normal CI. Known debt: `baselines/u1.json` predates the stable outcome projection, and #1532 reports a trivially-true assertion inside the corpus itself.
- **Harness version namespaces split three ways** (own section above). 16 historical harness builds were backfilled as hyphen-form GitHub Releases on 2026-08-29 to match the npm namespace, which was hyphen-form from the start. Renovate was retired from `DEFAULT_OPENCODE_VERSION` in favor of a repo-owned `sync-default-version` PR job, because build-metadata versions cannot be ordered. Base rebased 1.18.4 → **1.18.29**; carries 12 → **13** (`anomalyco/opencode#47430`).
- **CI grew a merge gate around the Docker stack.** New `gateway-smoke` + `workspace-smoke` jobs in `ci.yaml`, both promoted to required contexts (10 → 12). The gateway also joined the root `build`/`lint`/`test`/`check-types` fan-out. New `osv-scanner.yaml` (12 workflows) with a diff-scan-fails / full-scan-reports split. `merge_group` triggers added.
- **`pull_request` dropped from `fro-bot.yaml`'s trigger set**; live PR review for this repo runs via `ci.yaml`'s `test-action` job.
- **The open-issue set inverted from bot-filed to human-filed.** Six issues closed, five opened, four of them `marcusrbrown`-authored defect reports against agent behavior: #1514 (mention runs can't persist state without S3), #1517 (credential preflight **fails open** on `actions/checkout` v6 `includeIf`), #1520 (first-party App PRs can't be reviewed — `author_association: CONTRIBUTOR`), #1532 (trivially-true eval assertion). #1180 supersedes the closed broker-token pair #1124/#1126 with "migrate minting to a dedicated minimal GitHub App."
- **Deps**: `@opencode-ai/sdk` 1.17.20 → **1.18.26**, `oh-my-openagent` **v3 → v4** (4.19.4), `oh-my-opencode-slim` **v1 → v2** (2.2.17), `@fro.bot/systematic` 3.2.2 → **3.16.0**, `zod` **4.5.4 new in the runtime**, `web-push` **new in the gateway**, `effect` 3.22.1, `discord.js` 14.27.0, `hono` 4.13.5, eslint 10.9.1, tsdown 0.22.14, aws-sdk 3.1124.0; override ledger 13 → 18 entries with `undici` and `fast-uri` crossing major floors.
- **New surface**: `assets/` brand tokens, `docs/reference/carry-ledger.md`, `docs/github-app{,-setup}.md`, `scripts/` repo-invariant guard tests.

Latest release **v0.108.1** (2026-09-05); stars 3 → **4**; open issues 6 → 7; open PRs 5, all `fro-bot[bot]`.

**Update (2026-09-20 survey, HEAD `c7622aa`):** the v0.109–v0.113.2 wave plus an unreleased v0.114.0
arc. **No structural change** — 5 workspace members, 12 workflows, 9 CI jobs, 12 required contexts, 19
RFCs, the `evals/` corpus, and the four-layer hierarchy are all durable. The tree gained only
`deploy/egress-smoke.sh` + `deploy/scripts/`, `scripts/dmr-runtime-verification.ts`,
`packages/harness/src/pin-invariants.test.ts`, `src/harness/outcome.ts`,
`src/services/github/review-delivery-receipt.ts`, and `src/shared/cache-save-result.ts`. What moved is
behavior, not shape:

- **Background subagents** landed as requirements → file-watcher prerequisite → ownership/drain →
  completion-evidence → enable, in that order, and are **unreleased** (pending v0.114.0, PR #1626).
- **`invocation-outcome` and `cache-save-result`** put three-valued honesty into the action's public
  output contract — `incomplete` where a boolean would have to lie, `declined-for-safety` split from
  `not-persisted` because only one is retried.
- **A derived execution budget** replaces a fixed 60-minute constant and fails early rather than clamping
  upward, because a job-level cap kills without draining, summarizing, or publishing.
- **The DMR became a fleet instrument** (#1601/#1598), collecting downstream runtime-verification evidence
  across four owners under a treat-your-own-output-as-untrusted rule and a validated marker pair.
- **`packageManager` drifted to Bun 1.4.2 past an explicit `<=1.3.14` cap** because two managers name the
  same string differently; every installing surface is still 1.3.14.
- **Two open issues describe green signals that measure nothing** — #1631 (a Vitest worker dying of heap
  exhaustion exits 0, so tests that never ran present as a pass) and #1633 (the egress containment smoke
  fails on a shared unauthenticated API quota rather than on containment). Together with #1580 (discarded
  lock-contended runs) the repo is now the fleet's densest source of *false-signal* findings — and the
  only one that has started encoding the remedy as a type.
- Closed: **#1514** and **#1517** (the latter by the `fix(setup)!` breaking change in #1597, with #1598
  opened to track downstream migration). Open issues 7 → 12, open PRs 5 → 6, stars flat at 4.

Latest release **v0.113.2** (2026-09-16).

**Cross-repo note (2026-09-20).** npm `@fro.bot/systematic` `dist-tags.latest` is **3.20.0** (published
2026-09-20T01:10Z); this repo pins **3.18.4** with 3.20.0 open as PR #1622. That is consistent with — not
contradictory to — [[fro-bot--systematic]]'s 2026-09-19 reading of registry **3.18.10**: 3.19.0 published
at 18:15Z that day and 3.20.0 the next, so the deploy-target survey was simply upstream of two releases.
Recorded as a consumer-pin observation; see [[marcusrbrown--systematic]] for the source side.

**Cross-repo correction (2026-09-05):** [[marcusrbrown--systematic]]'s page records npm `latest` at **3.15.0** (2026-08-25) inside a "current 10-day drought" as of the 2026-09-04 [[fro-bot--systematic]] downstream observation. This repo pins **3.16.0** and has an open PR (#1554) for **3.16.1**, so the drought broke on or before 2026-09-05. Recorded here as an observation from a consumer pin, not a source survey of `marcusrbrown/systematic`.

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

**Present and self-hosted.** `fro-bot.yaml` uses `./` (self-reference during CI test) and `fro-bot/agent@v0` (major version pin) in production triggers. Trigger set as of 2026-09-05: `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), two crons (`30 15` daily DMR, `0 20 * * 0` weekly wiki), `workflow_dispatch`, `workflow_call`.

**Change (2026-09-05 survey): `pull_request` is no longer a trigger on this workflow.** The prior page recorded PR review firing on `pull_request` events here; the `on:` block now omits it entirely. The job-level `if:` still carries a defensive `github.event.pull_request == null || (same-repo head && !bot author)` clause, which is now vestigial on this file. The live PR-review path for this repo runs through `ci.yaml`'s `test-action` job (which invokes the action on PRs against `./` with `FRO_BOT_PAT`) rather than through the self-hosted workflow. Workflow-level `permissions` are `contents: read` / `pull-requests: read`, with the write authority for the release-notes apply phase carried by `FRO_BOT_PAT` in a separate job.

Access gating on the mention path is unchanged and explicit in the job `if:`: comment body must contain `@fro-bot`, commenter must not be `fro-bot`, and `author_association` must be one of `OWNER` / `MEMBER` / `COLLABORATOR`. Open issue **#1520** is the sharp edge of that rule — a PR authored by a **first-party GitHub App** carries `author_association: CONTRIBUTOR`, so the agent's own App-authored PRs fall outside its own review gate. The identity that opens the work is not the identity that is trusted to receive review on it.

**Update (2026-09-20).** The workflow's `on:` block, two-job shape, and access gating are all unchanged —
but the job around the action grew three things worth recording: a **75-minute backstop cap** with the
action's own deadline derived beneath it (see "The Execution Budget Is Derived, Not Constant"), a
**daily-schedule-only `#1598` runtime-verification collector step** carrying `FRO_BOT_PAT` in step-local
env (see "Fleet Runtime-Verification Sweep"), and a DMR prompt that now permits exactly **one** additional
issue mutation — #1598's marker-delimited region — on top of its single-report contract. The
release-notes narration path keeps its own tighter 600 000 ms ceiling, deliberately unrelated to the
60-minute execution budget.

**Update (2026-09-25).** `fro-bot.yaml` is **unchanged** across `c7622aa..9918ee0`; it is not in the
compare file list. The workflow is present and self-hosted, so no follow-up draft PR is needed. Workflow
changes in the window were limited to `ci.yaml` (workspace smoke security flags plus the isolation harness,
described above) and pin bumps: `codeql-action` v4.37.9 → **v4.38.2**, `osv-scanner-action` v2.5.1 →
**v2.6.0** (both the PR and full reusable workflows), and `bfra-me/.github` → **v4.33.0** on `renovate.yaml`
and `update-repo-settings.yaml`.

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

**Member manifests (2026-09-05).** Workspace membership is unchanged at five, but three manifests moved: `@fro-bot/runtime` gained **`zod` 4.5.4** (its first schema dependency — the v1 gateway plan had earmarked Effect `Schema.*` for payload validation; zod landed in the runtime instead, below the Effect boundary); `@fro-bot/gateway` gained **`web-push` 3.6.7** + `@types/web-push` (browser push on the operator surface), **`@octokit/core` 7.0.7**, and **`yaml` 2.9.0** (the `metadata/repos.yaml` redaction reader now has an explicit parser dep). `@fro.bot/harness` still declares **zero runtime dependencies** — its per-platform binaries are injected as `optionalDependencies` at publish time. Both `hono` (4.13.5) and `@hono/node-server` (2.1.1) stay in lockstep across gateway and workspace-agent.

**Bun workspace config (2026-06-24).** With the pnpm → Bun migration, workspace config moved out of `pnpm-workspace.yaml` (deleted) back into `package.json`: `workspaces: [apps/*, packages/*]`, `packageManager: bun@1.3.14`, `trustedDependencies: [esbuild, simple-git-hooks, unrs-resolver]` (the Bun analogue of pnpm's `onlyBuiltDependencies`), and the `overrides` block back in root `package.json` covering `brace-expansion >=5.0.6`, `fast-uri >=3.1.2`, `fast-xml-builder >=1.1.7`, `fast-xml-parser >=5.7.0`, `flatted 3.4.2`, `handlebars >=4.7.9`, `ip-address >=10.1.1`, `lodash`/`lodash-es >=4.18.0`, `picomatch >=4.0.4`, `tar >=7.5.11`, `undici >=7.24.0`, `vite 8.0.16`, `yaml >=2.8.3`. Lockfile is `bun.lock`; `bunfig.toml` carries Bun config.

## Survey History

| Date       | SHA        | Key changes                                          |
| ---------- | ---------- | ---------------------------------------------------- |
| 2026-09-25 | `9918ee0`  | Re-survey at v0.115.1 plus an unreleased v0.116.0 arc (22 commits, **17 bot / 5 `marcusrbrown`**; releases v0.114.1, v0.115.0, v0.115.1 in 3 days). No action-interface change, and `fro-bot.yaml` unchanged. **(1) Workspace uid isolation** (#1661, unreleased): the service stays root with capabilities trimmed to 6 plus `no-new-privileges`; OpenCode and its tools run as uid 10001 via `setpriv`; secrets and the CA moved under a root-only tmpfs; a one-time, deadline-bounded, fail-closed ownership migration (`start_period` 45 → 360 s); CI smoke now runs with production security flags plus a 1,371-line isolation harness. **(2) Bearer on the :9100 control API** (#1665, unreleased): gateway and workspace images must now upgrade and roll back in lockstep. **(3) Required `GATEWAY_OPERATOR_TRUSTED_PROXIES`** (#1651): rate limits keyed per client, strict forwarded-header parsing, and a README that says what startup validation cannot prove. **(4) Run provenance and `/inspect`** (#1656) as the observation half of #1634. **(5) Clone askpass hardening** (#1658). **(6) Two more stale squash subjects** (#1622 "systematic v3.18.5" ships **3.20.0**; #1657 "bfra-me v4.32.0" ships **v4.33.0**), both now copied into the published release notes. Issues 12 → 21 (9 new, all owner-filed, mostly deploy-stack); PRs 6 → 3. Deps: hono 4.13.8, `@aws-sdk/client-s3` 3.1137.0, prettier 3.9.8, js-yaml 5.4.2 (all diff-verified), plus zod 4.6.5 and OMO Slim 2.2.22 (from commit subjects only, not diff-verified, which the finding above says matters), and Node digest `ebfe2f9` (diff-verified in both Dockerfiles). `packageManager` untouched, so the Bun 1.4.2-vs-1.3.14 drift stands. |
| 2026-09-20 | `c7622aa`  | Re-survey at v0.113.2 + unreleased v0.114.0 arc (56 commits, **28 bot / 28 `marcusrbrown`**): **no structural change** — 5 members, 12 workflows, 9 CI jobs, 12 required contexts, `evals/` all durable. **(1) Background subagents** (#1606 requirements → #1608 file-watcher disable → #1624 ownership+drain → #1627 completion-evidence-per-turn → #1629 enable → #1632 three learnings), containment merged **before** the switch, and **still unreleased** (pending v0.114.0 #1626) — no consumer pin carries it. **(2) `invocation-outcome`** (`succeeded`/`incomplete`/`failed`/`skipped`, verified against observation completeness, ownership resolution, server quiescence, lease continuity) and **`cache-save-result`** (`durable`/`store-only`/`skipped`/`declined-for-safety`/`not-persisted`, "reports a result, not proof of durability", the two non-persisted states split because only one is retried) promote the eval corpus's three-valued discipline into the **action's public output contract**; both main-step-only because a post-hook value arrives after every consumer. **(3) Execution budget derived**, not constant: 75 m job cap is a backstop, the action's deadline is `cap − measured pre-action elapsed − 15 m teardown reserve`, and it **fails outright rather than flooring upward** — a job-level kill cannot drain background work, summarize, or publish. **(4) The DMR became a fleet instrument** (#1601/#1598): a daily-only collector sweeps downstream runtime verification across four owners with `FRO_BOT_PAT` in step-local env, the agent must read the JSON as untrusted data, `not-verified`/`no-qualifying-run`/`unavailable` are all simply unverified, edits confined to a validated marker pair, private repos out of scope. **(5) `packageManager` drifted Bun 1.3.14 → 1.4.0 → 1.4.2 past an explicit `allowedVersions: '<=1.3.14'`** because the built-in manager sees `bun` (npm) where the custom manager sees `oven-sh/bun`; every installing surface remains 1.3.14, and `8e303ca`'s subject says "v1.4.1" while the diff shipped 1.4.2. **(6) Harness base 1.18.29 → 1.18.30**, carries 13 → **15** (#48267/#48268), **two builds in one day** (`770cf62d` 06:30 → `7c479429` 12:50) with #1586 fixing the `sync-default-version` job to cut its branch from current `main` rather than the dispatch SHA. **(7) Setup-path defect cluster** — six same-day fixes for spawning an install *directory* as an executable (#1563/#1565/#1569/#1571/#1587/#1561). **(8) Corrections:** this page's Action Interface tables never recorded `trusted-head-sha`, `response-mode`, `server-bootstrap-timeout`, `brokered-push-extra-paths`, `delivery-kind`, `output-mode-migration`, `brokered-push-allowlist` — including **brokered push**, a third delivery mode that commits directly to a trusted PR's head branch under a hard-denied path allowlist. #1514/#1517 closed; open issues 7 → 12 (ten human-authored), PRs 5 → 6, stars flat at 4. |
| 2026-09-05 | `096faf1`  | Re-survey at v0.108.1 (v0.94.0 → v0.108.1, 14 minors + patches in ~6.5 weeks): **structural — first new top-level subsystem since `packages/harness`.** **(1) `evals/`, an agent-outcome regression corpus** (23 files, `test:evals` in the root chain, skipped without `FRO_BOT_EVAL=1`): "assert outcomes, never method"; three-valued `passed`/`failed`/`inconclusive` states adopted after a harness misconfiguration produced timeouts a boolean would have blamed on the model; quality gates may assert presence in free-form prose but never absence; `clean-pr`/`planted-defect` differential pair with scorer-owned expectations; bounded 4×4 lazy repeats that never auto-promote a baseline; safety gates (`no-forbidden-mutation`, `no-secret-leak`) run even on inconclusive runs. Debt: `baselines/u1.json` predates the stable outcome projection; #1532 reports a trivially-true assertion inside the corpus. **(2) Harness version namespaces split three ways** — GitHub Release tag and npm version both `-harness.<sha>` (prerelease; git refs forbid `+`, and npm treats build metadata as version-identical), binary self-report keeps `+harness.<sha>`; **16 historical builds backfilled as hyphen-form releases on 2026-08-29** (npm was hyphen-form since 2026-07-15, so it was GitHub that migrated); **Renovate retired from `DEFAULT_OPENCODE_VERSION`** in favor of a repo-owned `sync-default-version` PR job that bumps constants + workspace Dockerfile together with a both-files idempotency guard. Base 1.18.4 → **1.18.29**; carries 12 → **13** (+`anomalyco/opencode#47430`). **(3) CI**: new `gateway-smoke` + `workspace-smoke` image jobs, both promoted to **required contexts (10 → 12)**; gateway joined the root build/lint/test fan-out; new **`osv-scanner.yaml`** (workflows 11 → **12**) with `fail-on-vuln: true` on the PR diff scan and deliberate report-only on the full scan; `merge_group` triggers added; `scripts/` grew repo-invariant guard tests (`fro-bot-workflow`, `osv-scanner-workflow`, `harness-tag-derivation`, `workspace-test-chain`, …). **(4) `pull_request` dropped from `fro-bot.yaml`'s trigger set**; PR review runs via `ci.yaml`'s `test-action`. **(5) Open-issue set inverted bot-filed → human-filed** — 6 closed, 5 opened, four `marcusrbrown` defect reports (#1514 no session persistence on mention runs without S3, #1517 credential preflight **fails open** on checkout v6 `includeIf`, #1520 first-party App PRs unreviewable via `author_association`, #1532 trivial eval assertion); #1180 supersedes #1124/#1126. **(6) README now qualifies the persistent-memory headline** with the `ACTIONS_RUNTIME_TOKEN`-is-scoped-by-trigger-class constraint. Deps: SDK 1.18.26, oMo **v3→v4**, OMO Slim **v1→v2**, systematic 3.2.2 → 3.16.0, `zod` new in runtime, `web-push` new in gateway, overrides 13 → 18 (undici v7→v8, fast-uri v3→v4). New `assets/` brand tokens, `docs/reference/carry-ledger.md`. Stars 3 → 4; open issues 6 → 7. |
| 2026-07-21 | `9a4631f`  | Re-survey at v0.94.0 (v0.83.1 → v0.94.0, 11 minors + patches in ~2 weeks): **no structural change** — 3 pkgs / 2 apps / 11 workflows / 19 RFCs / Bun cutover all durable. Feature+hardening wave on the release/review pipelines plus a harness rebase. **(1) Release-notes narration → two-phase credential boundary** (v0.93.0, #1239): read-only generation job (bounded evidence ≤25 PRs/≤5 diffs → artifact candidate) + apply job carrying write authority via `FRO_BOT_PAT`; fail-closed validator hardened (code-span exemption #1241, short-paragraph compose #1243). **(2) `review-skip-label` opt-out input** (#1234, default `skip-agent-review`, routing-time, mention/`review_requested` overrides via sender-substituted association #1238). **(3) Harness rebased 1.17.14 → 1.17.20 → 1.18.4** (#1222/#1254); merge model → `claude-sonnet-5`; 12 carries (churned, #1220 retired superseded, +#36045/#36361); runtime constant + Dockerfile ARG synced post-publish (#1256). Reliability: quota fail-fast (#1227), centralized error format (#1226), run-state retention tag (#1225), PR-release concurrency isolation (#1223), legacy schedule-session scaffolding removed (#1237). Deps: **systematic v2→v3** (#1250, 3.2.2), **@hono/node-server v1→v2** (#1249), @opencode-ai/sdk 1.17.20, aws-sdk 3.1085.0, eslint 10.7.0, prettier 3.9.5, tsdown 0.22.7, semantic-release 25.0.7 (+`@semantic-release/npm`), vite override 8.1.4. Doc surface: `RFCs/` dir extracted, root `CHANGELOG.md`, `docs/privacy/`, `.agents/skills/versioned-tool`. Stars 2→3; open issues flat at 6. |
| 2026-07-07 | `8ee84bb`  | Re-survey at v0.83.1 (v0.76.1 → v0.83.1, 7 minors + patches in ~12 days): three arcs. **(1) Credential-broker consumer landed** — new `harness-integrate.yaml` `workflow_call` (v0.80.0, #1081, closes #1060) mints an OIDC credential against `broker.fro.bot` in a single `id-token: write` job and injects it as `auth-json`; durable secret scrubbed from env (#1080), integrate egress hardened (#1108), `github-token` masked/scrubbed from agent child env (#1119, closes #1107). **(2) Operator web surface reached wiring parity** — #1001/#1000 closed: launch route mounted (`POST /operator/runs`, #1030), approval routes + image-level registration smoke (#1031), run-index (`GET /operator/runs`, #1038), `contractVersion` on health (#1096), operator-initiated run cancellation (#1111), sanitized failure reasons (#1113), lost-event vs hang timeout detection (#1116). **(3) Docs + runtime restructure** — `RULES.md` retired for `ARCHITECTURE.md`/`STRUCTURE.md`/`CONTRIBUTING.md` (#1075/#1076), PRD/FEATURES archived to `docs/product/` (#1071), `generating-project-docs` skill (#1073); `packages/runtime/src/` consolidated into `agent/`+`coordination/`+`object-store/`+`session/`+`shared/` (object-store code now concretely in runtime). OpenCode rebased harness 1.17.9 → 1.17.11 (#1045) → 1.17.13 (#1086) → 1.17.14; **10 integration refs** (was 5). Deps: systematic 2.32.0 → 2.33.1, `@opencode-ai/sdk` 1.17.13, `@aws-sdk/client-s3` 3.1078.0, hono 4.12.27, `@actions/cache` 6.1.0, eslint 10.6.0, prettier 3.9.4, vite override 8.1.2. Open issues 9 → **6** (wiring gaps + #907 closed); 3 open PRs (pending release #1138 + two Renovate). |
| 2026-06-24 | `20e9f34`  | Re-survey at v0.76.1 (v0.63.0 → v0.76.1, 13 minors + patches in 9 days): two structural shifts. **(1) pnpm → Bun migration** — `packageManager: bun@1.3.14`, `bun.lock` + `bunfig.toml`, `bun run --filter` scripts, `bunx` git hooks, `trustedDependencies`; `pnpm-lock.yaml`/`pnpm-workspace.yaml` removed; `overrides` moved back to root `package.json`; harness native build now Bun-based (`HARNESS_BUN_VERSION`). **(2) Gateway operator web surface** ("web-command spine", #907) — new `web/`, `operator-contract/`, `redaction/` dirs; operator GitHub OAuth + sessions (#936/#944/#939), authenticated SSE run status+output streaming (#961/#962/#974), web launch surface (#968), web tool-approval flow (#986), frozen+pinned operator API contract (#952/#996), `metadata/repos.yaml` redaction gate on operator surfaces (#955). OpenCode rebased harness `1.17.6` → `1.17.9` (#984, 5 carried refs, SQLite reliability); carries squashed into one fingerprint commit (#982); SBOM + deterministic-notice build hardening (#978), dist license/unicode pipeline decoupled from bundler (#991/#988, v0.76.1). Deps: systematic 2.31.0 → 2.32.0, hono 4.12.26, tsdown 0.22.3, `@aws-sdk/client-s3` 3.1071.0, `@opencode-ai/sdk` 1.17.9, eslint 10.5.0. Open issues 6 → 9 (new web-surface wiring gaps #1001/#1000, Bun deploy hardening #1003); 1 open PR (pending release #1007). |
| 2026-06-14 | `a23ae97`  | Re-survey at v0.63.0 (v0.53.1 → v0.63.0, 10 minors): **Harness-as-default-OpenCode cutover** (v0.63.0, #888/#884/#874/#889) — `@fro.bot/harness` now publishes its own **GitHub Releases** under non-`v` tags (`1.17.3+harness.94c10df9`), and both the action and the workspace executor run the harness build by default; `DEFAULT_OPENCODE_VERSION` is now a harness build id (stock OpenCode = `FALLBACK_VERSION`); musl Linux assets added (#887). OpenCode base rebased 1.15.13 → **1.16.0** (#786) → **1.17.3** (#867) → SDK **1.17.6**; integration refs grew to 3 (#19961/#31859/#31638). Harness integrate merge now runs through the Fro Bot workflow (#779), skipped when no patches carried (#788); post-bridge hardening (#873, closes #775). **Release-notes narration** (v0.56.0, #818) — published releases narrated by the agent via `fro-bot.yaml` `workflow_call`. Gateway: serial per-channel mention queue (#850), `/fro-bot force-release-lock` (#854), live status/typing (#843), `daily_digest` presence (#826), fail-soft io helpers (#858). Cold-boot hardened further (v0.54.0, #767/#761). Deps: pnpm 10.33.4 → **11.5.3**, systematic 2.24.0 → 2.31.0, OMO Slim 1.1.1 → 1.1.2, effect 3.21.3, tsdown 0.22.2, semantic-release 25.0.5, `@aws-sdk/client-s3` 3.1066.0, vite 8.0.16. 0 open PRs; 6 open issues. |
| 2026-06-04 | `34abe2a`  | Re-survey at v0.53.1 (v0.51.0 → v0.53.1, 3 releases): **`packages/harness` (`@fro.bot/harness`)** shipped (v0.53.0, #752) — a published, OIDC-trust-published, patched-OpenCode CLI built via cortexkit/orw LLM-merge integration; now "the default OpenCode for Fro Bot" and the workspace's only public package; new fenced `harness-release.yaml` workflow (read-only build job, no `id-token`; OIDC publish job; per-platform `optionalDependencies` injected at publish time). **OpenCode pinned to 1.15.13** (#742, SDK+CLI) for the 1.14.42+ SSE `SyncEvent` regression fix; new event contract (`message.part.updated`/`delta`) drove the gateway tool-progress migration (#744, v0.52.0). **Egress regression #741 resolved** (#747 → v0.52.1, configurable proxy allowlist); follow-on hardening open as #746/#745. **Cold-boot supervisor regression #749 fixed** (#755 → v0.53.1). `DEFAULT_MODEL` noted as `opencode/big-pickle`. Workspace now 5 members. |
| 2026-06-03 | `d0f39a2`  | Re-survey at v0.51.0 (jumped 7 minors from v0.44.3): **`apps/workspace-agent`** shipped (v0.45.0, Hono service for sandboxed git ops + OpenCode provisioning, port 9100, hardened `/clone`) — workspace executor no longer a placeholder; gateway grew a working Discord control plane (bindings store, GitHub App auth, `/fro-bot add-project`, `@fro-bot` mention → OpenCode execution, sensitive-tool approval prompts, boot provider self-test); **OMO Slim** added as opt-in orchestration (`enable-omo-slim`, mutually exclusive with `enable-omo`, pinned 1.1.1); expanded S3 inputs (key-prefix, expected-bucket-owner, KMS/SSE, insecure-endpoint), `skip-cache`, `omo-providers`; shared-layer constants relocated to `packages/runtime/src/shared/`; Node 24.16.0-alpine in Docker; deps (`@aws-sdk/client-s3` →3.1057.0, `tsdown` →0.22.1, Vitest →4.1.7, `@actions/cache` →6.0.1); stars 1→2. Open regression #741: mitmproxy egress 502 on `sandbox-net` breaks `add-project` clones. |
| 2026-05-22 | `8632cf4`  | Re-survey at v0.44.3: new `packages/gateway` (Discord daemon, Effect 3.x), new `deploy/` Docker stack (gateway + workspace + mitmproxy), `enable-omo` action input (oMo now opt-in), `agent` input default changed from `sisyphus` to unset/OpenCode-build, open issues 7→2, stars 0→1, dep bumps (`@opencode-ai/sdk` 1.14.30→1.14.41, `tsdown` 0.21→0.22, `vite` pin 8.0.10→8.0.13). `services/object-store/` confirmed migrated (likely into `@fro-bot/runtime`). Action `AGENTS.md` is stale (dated 2026-03-29). |
| 2026-05-08 | `ef6b952`  | Re-survey: additive detail (workspace packages, docs structure, artifact/object-store discrepancy) |
| 2026-05-07 | `ef6b952`  | Initial survey                                       |
