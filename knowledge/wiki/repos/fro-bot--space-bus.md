---
type: repo
title: "fro-bot/space-bus"
created: 2026-07-03
updated: 2026-07-18
sources:
  - url: https://github.com/fro-bot/space-bus
    sha: ad8eefe00c467ba342353d5bbd3d8cc6fbb61fc5
    accessed: 2026-07-03
  - url: https://github.com/fro-bot/space-bus
    sha: 8e20e01775918a01855eb5aba64d04bf966f4d51
    accessed: 2026-07-18
tags: [opencode, mcp, workspace-agent, agent-bus, directory-routing, opencode-server, custom-tools, claude-desktop, typescript, bun, zod, delegation, control-agent, dogfood, plugin, published-npm, managed-server, launchd, multi-roster, async-delegation, library-surface, browser-safe, changesets, oidc-publishing, fro-bot]
related:
  - fro-bot--agent
  - fro-bot--dashboard
  - marcusrbrown--infra
  - marcusrbrown--mothership
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--systematic
  - marcusrbrown--dotfiles
---

# fro-bot/space-bus

`@fro.bot/space-bus` — a **workspace agent bus** for OpenCode, now a **published, distributable OpenCode plugin** (npm `@fro.bot/space-bus`). One control agent (an ordinary OpenCode TUI running with this plugin installed) sees and tasks dedicated per-project agents across a roster, all riding a **single `opencode serve`/`harness serve` instance via per-request directory routing**. A thin stdio MCP facade exposes the same tools to Claude Desktop. It is the org-level "control board" that turns a fleet of managed repos ([[fro-bot--agent]], [[fro-bot--dashboard]], the control plane, [[marcusrbrown--infra]]) into delegation targets addressable from one seat.

> **2026-07-18 survey (HEAD `8e20e01`) — the repo matured from MVP dogfood to shipped plugin.** Since the 2026-07-03 initial survey it has: (1) **converted to a published OpenCode plugin** on npm (`0.13.1`, 20 versions via changesets + npm OIDC trusted publishing — resolving the private/`0.0.0` → published contradiction flagged at 2026-07-06); (2) grown from **four tools to six** (`bus_wait` async-delegation, `bus_registry` multi-roster) — the "exactly four tools" MVP constraint is **superseded**; (3) added a **plugin-managed server lifecycle** + `space-bus` CLI + macOS **launchd** reboot-persistence; (4) exposed a **CI-enforced browser-safe library surface** (subpath exports for renderers like [[marcusrbrown--mothership]]); and (5) **grown a full Fro Bot workflow + CI/CodeQL/Scorecard/Renovate/Probot Settings** — resolving the "no automation" thread. Sections below preserve the 2026-07-03 MVP record and mark what changed.

## Overview

| Attribute        | Value (2026-07-18 survey, HEAD `8e20e01`)                                      |
| ---------------- | ------------------------------------------------------------------------------ |
| Created          | 2026-07-03                                                                     |
| Last push        | 2026-07-17 (`pushed_at`; HEAD commit `8e20e01` dated 2026-07-13, "chore(deps): update fro-bot/agent to v0.88.0" #98) |
| Description      | Space Bus — workspace agent bus for OpenCode; control agent tasking per-project agents over the OpenCode server API, with an MCP facade for Claude Desktop |
| Homepage         | https://www.npmjs.com/package/@fro.bot/space-bus                              |
| Language         | TypeScript (strict, ESM)                                                       |
| Runtime          | Bun (dev/build/test); published dist targets Node ESM (`main: ./dist/index.js`) |
| Package manager  | Bun (`bun.lock`, `bun install`)                                               |
| Package          | `@fro.bot/space-bus` — **published to npm, `0.13.1`** (20 versions `0.0.0`→`0.13.1`; changesets + npm OIDC trusted publishing) |
| License          | MIT                                                                            |
| Visibility       | Public                                                                         |
| Stars            | 1                                                                              |
| Open issues      | 8                                                                              |
| Topics           | `opencode`, `plugin`, `mcp`, `agent-orchestration`, `bun`, `typescript`       |
| Status           | **Shipped OpenCode plugin.** Six-tool bus + managed-server lifecycle + CLI + macOS launchd service + browser-safe library surface. Full CI/CodeQL/Scorecard/Renovate/Fro Bot automation |

### Prior status (2026-07-03 survey, HEAD `ad8eefe` — historical)

At the initial survey this was an **MVP dogfood**: `@fro.bot/space-bus` was **private/unpublished** (`"private": true`, `version: 0.0.0`), 0 stars, no topics, no `.github/`, no CI, no Fro Bot workflow. Four tools, workspace-local `.opencode/tools/` adapters, plugin conversion only drafted in `docs/`. That state is retained in the sections below for provenance; the 2026-07-18 record supersedes it.

## What it is

The core insight: **one `opencode serve` instance multiplexes all Fro Bot projects** via per-request directory routing rather than running N servers. The OpenCode server's working directory resolves in order: the session's stored directory → `?directory=` query param → `x-opencode-directory` header → server cwd. An `InstanceStore` lazily loads an isolated instance (config, plugins, `AGENTS.md`) per directory, so a session created against `~/src/github.com/fro-bot/agent` picks up *that* repo's own agent config and instructions.

A **control agent** launched in this repo delegates to those per-project agents through four custom tools; a stdio MCP server exposes the same four tools to Claude Desktop. There is no broker, queue, custom RPC, or SSE consumer — **the OpenCode server API is the state store.**

```
Claude Desktop ──stdio MCP──▶ src/mcp.ts ──┐
                                           ├──▶ src/core.ts ──HTTP──▶ opencode serve :4096
OpenCode TUI (here) ──.opencode/tools/ ────┘                          │ x-opencode-directory
                                                                      ▼
                                              agent · dashboard · control-plane · infra
```

## The Tools (now six — 2026-07-18)

The 2026-07-03 MVP shipped **exactly four** tools as a hard constraint. That constraint has been **superseded**: two more tools landed as the async-delegation and multi-roster substrates matured. The current surface (both the plugin tool map and the MCP registrations, kept byte-identical via shared `makeBus*` factories):

| Tool           | Since   | Purpose                                                                                   |
| -------------- | ------- | ----------------------------------------------------------------------------------------- |
| `bus_roster`   | MVP     | List roster projects with live per-project session status (check before tasking)          |
| `bus_task`     | MVP     | Dispatch a prompt to one project's agent (returns immediately, does not wait). Optional `sessionId` **steers an existing session** — answers a pending question else sends a follow-up. Results carry structured `{sessionId, project, mode}` metadata (plugin `ToolResult.metadata` / MCP `structuredContent`) |
| `bus_status`   | MVP     | Report a session's status + latest todo/diff summary; surfaces pending interactive questions (`pendingQuestion` / a `blocked:` line) |
| `bus_result`   | MVP     | Return a completed session's final assistant message + diff (errors if still running)      |
| `bus_wait`     | `0.9.0` | **Block until any watched session needs attention** (completes / blocks on a question / fails / not-found) or a bounded timeout — level-triggered, stateless bounded long-poll, cross-directory. Replaces the poll-`bus_status`-in-a-loop pattern |
| `bus_registry` | `0.13.0`| **Manage the machine-level roster registry** — one action-discriminated tool: list / create / register / unregister / set-default / add-project / remove-project / update-project, plus `use` (MCP-only, selects a connector-session active roster) |

All five `bus_*` task tools now accept an optional **`roster`** param (a registry name) to target a roster other than the ambient one, and every result opens with a `roster: <name-or-path>` line on both surfaces. Resolution precedence — **plugin:** explicit `roster` > workspace `ctx.directory`; **MCP:** explicit `roster` > connector-session active roster (`bus_registry use`) > `SPACE_BUS_CONFIG` > registry default (`set-default`, consulted only when `SPACE_BUS_CONFIG` is unset) > actionable error.

The optional `sessionId` on `bus_task` remains a dogfooding outcome (delegates block on interactive questions; steering landed as a param, not a tool). `bus_wait` is the successor pattern for the async-delegation foundation — fire-and-forget push notification is a deferred follow-on.

## Layout (2026-07-18)

The "plugin conversion is a packaging move, not a rewrite" bet held: all real logic still lives in `src/core.ts` with thin adapter factories. The **`.opencode/tools/` + `workspace.json`** layout of the MVP is gone — the repo is now a published plugin with a `src/` module graph organized into a **browser-safe lane** (`core`/`contract`/`format`/`attach`) and a **Node-only lane** (`config`/`discovery`/`server`/`cli`/`launchd`/`service`), CI-enforced.

| Path                      | Lane        | Role                                                                          |
| ------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `src/index.ts`            | plugin      | Plugin entry — default-exported factory returning the six-tool `bus_*` map     |
| `src/tools/*.ts`          | plugin      | One `makeBus*` factory per tool + shared description constants (also consumed by `mcp.ts`) |
| `src/core.ts`             | browser-safe| All bus logic (roster lookup, dispatch, status, result, `snapshot()` composite); discriminated-union returns, never throws; takes injected `BusContext` per call |
| `src/contract.ts`         | browser-safe| zod v4 schemas + inferred types for the OpenCode API, `BusContext`, and discovery files |
| `src/format.ts`           | browser-safe| Pure formatters the tools render output through                               |
| `src/attach.ts`           | browser-safe| `resolveManagedServer(dir, seams)` — reads the discovery file through injected fs/env/crypto seams so external attachers (e.g. a Mothership webview) attach without `node:*` |
| `src/config.ts`           | Node-only   | `spacebus.json` resolution + `SPACE_BUS_CONFIG` + localhost guard; `loadContext()` builds a `BusContext` |
| `src/registry.ts`         | Node-only   | Machine-level roster registry (`rosters.json`) + roster mutation (create/add/remove/update) |
| `src/discovery.ts`        | Node-only   | Discovery-file read/write/validate, per-roster state dir, spawn lock, pid identity verify |
| `src/server.ts`           | Node-only   | Managed-server lifecycle: `ensureServer`/`serverStatus`/`stopServer`, spawn + readiness poll + supervision |
| `src/cli.ts`              | Node-only   | `space-bus` CLI (`serve\|status\|stop\|service`, `--json`) — thin wrapper over server/service |
| `src/launchd.ts`/`service.ts` | Node-only | launchd plist generation + the five `space-bus service` verbs (macOS) |
| `src/mcp.ts`              | facade      | stdio MCP facade (`@modelcontextprotocol/sdk`); also the `space-bus-mcp` bin. Attach-only by default (spawns only if `SPACE_BUS_MCP_SPAWN` set) |
| `scripts/smoke.ts`        | dev         | Live-server canary (`bun run smoke`) — directory-routing isolation, distinct from `bun test` |
| `scripts/make-fixture.ts` | dev         | Generates gitignored `fixtures/dev-workspace/` for the dev loop                |
| `docs/brainstorms/` `docs/plans/` `docs/ideation/` | docs | 8 brainstorms + 10 plans + mothership-support ideation (systematic `ce-*` format) |
| `docs/solutions/`         | docs        | 20 documented solutions across `best-practices/`, `integration-issues/`, `security-issues/`, `workflow-issues/` (YAML frontmatter) |

Roster config is now **`spacebus.json`** (renamed from `workspace.json`): `server` (`baseUrl` *or* `managed`, mutually exclusive) + `projects[]` (name/path/description, `~` expansion). Read fresh on every tool call — no caching. `SPACE_BUS_CONFIG` overrides discovery (must be absolute or `~`-rooted; URLs and bare-relative rejected). Test coverage is now substantial (~30 `*.test.ts` files including real-subprocess process-lifecycle tests and dist-level browser-safety assertions).

## OpenCode Server API Notes (directory-routing quirks)

The README documents several hard-won facts about the server API surface the bus rides — useful reference for anyone building on directory-routed OpenCode servers (see [[opencode-plugins]]):

- **Session store is global across directory headers.** `GET /session/{id}` resolves regardless of which project directory header is sent. The bus attributes a session to its owning project via the session's own `directory` field, **not** the probe header. `GET /session` (list) and `/session/status` are directory-scoped.
- **Diff aggregation workaround.** Upstream opencode #30127 (v1.16.0) zeroes session-level diff summaries, so `GET /session/{id}/diff` always returns `[]`. Per-turn diffs on user messages (`GET /session/{id}/message`) stay intact and include untracked files, so `bus_status`/`bus_result` aggregate those instead (last turn wins per file, mirroring upstream PR #33444). **Harness builds ≥ `1.17.13+harness.ee55e157` carry #33444 directly** — `GET /session/{id}`'s `summary.diffs` is populated and serves diffs without per-turn aggregation (labeled `diffSource: "session"`); stock binaries leave it empty and fall through to per-turn aggregation. `GET /vcs/status` is a last-ditch repo-wide fallback (labeled *working tree*). This ties the bus's diff behavior to the [[fro-bot--agent]] `@fro.bot/harness` patched-OpenCode line.
- **Idle race.** `/session/status` can report a session idle a beat before its final message is queryable; `scripts/smoke.ts` absorbs this with a bounded retry on the message fetch.
- **Tool resolution.** `.opencode/tools/` resolves `@opencode-ai/plugin` from repo-root `node_modules` — no `.opencode/package.json` needed.

## Managed Server + CLI + launchd Service (2026-07-18 — new)

The MVP required you to run `opencode serve` yourself (attach-only). Roster `server` now has **two mutually-exclusive modes**:

- **`server.baseUrl`** — externally-managed, attach-only (the original behavior, still the default).
- **`server.managed`** (`command`/`cwd`/`port`, all optional; default `harness serve`, roster dir, ephemeral port) — plugin-managed lifecycle. **First-caller-spawns:** whichever consumer touches the roster first spawns the server on demand; a generated password + `0600` discovery file land under `$XDG_STATE_HOME|~/.local/state/space-bus/<hash>/discovery.json`; every subsequent caller attaches. It's a persistent daemon (outlives the caller, no in-process auto-restart) — the next `ensure` heals a stale discovery file by respawning.

A **`space-bus` CLI** (`serve [--foreground]` / `status` / `stop`, `--json`) wraps the same lifecycle. `serve --foreground` actively supervises the daemon (process-identity + authenticated endpoint probe with a consecutive-failure grace threshold) and exits non-zero on confirmed death so an external process manager restarts it — recovery-by-restart is delegated to the OS, never done in-process. A run of died-path/orphan-reap fixes (`0.8.0`–`0.8.1`) group-signal a surviving `opencode` child when the `harness` wrapper dies, guarded against pid recycling.

**`space-bus service` (macOS launchd v1)** layers reboot-persistence: `install`/`uninstall`/`status`/`stop`/`start` register a per-user `gui/$UID` launchd agent wrapping `serve --foreground`. Starts at **login** (not boot), restarts only on abnormal exit (`KeepAlive.SuccessfulExit=false`, throttled 10s), logs `0600` to the state dir, and pins absolute runtime/CLI paths at install (re-run `install` after a version bump). Fails fast on non-macOS.

## Library Surface (subpath exports — 2026-07-18 — new)

Experimental subpath exports expose the bus's internals directly for renderers ([[marcusrbrown--mothership]]) and other consumers that want structured state instead of formatted strings. Shapes may change in minor releases:

| Subpath                          | Lane        | Surface                                                                       |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `@fro.bot/space-bus/core`        | browser-safe| The functions the tools run on; takes a caller-built `BusContext` (never resolves it). Includes `snapshot()` — one-call roster + per-project status + pending questions with bounded fan-out |
| `@fro.bot/space-bus/config`      | Node-only   | `loadContext()`/`loadContextForRoster()`/`loadContextForRosterPath()` — read `spacebus.json`, attach env credentials, per-project `exists` flags |
| `@fro.bot/space-bus/contract`    | browser-safe| The zod v4 schemas + inferred types behind the API and `BusContext`           |
| `@fro.bot/space-bus/format`      | browser-safe| The pure formatters the tools use, for tool-identical text                    |
| `@fro.bot/space-bus/managed-server` | Node-only| `ensureServer`/`serverStatus`/`stopServer` for consumers driving spawn/attach/stop directly |
| `@fro.bot/space-bus/attach`      | browser-safe| `resolveManagedServer(workspaceDir, seams)` — attach to a managed daemon via injected seams, no `node:*` |
| `@fro.bot/space-bus/registry`    | Node-only   | Roster registry + mutation library (`readRegistry`, `registerRoster`, `createRoster`, `addProject`, …) |

**Browser-safety is CI-enforced**: `browser-safety.test.ts` bundles the browser-safe lane for a browser target and asserts no `node:*` imports and no path into `config.ts`; a **dist-level** variant (added `0.10.1`) asserts the *published* artifacts contain no `node:` prelude — closing a gap where the src-level test passed while the shipped bundle was broken for Vite/Mothership. The **localhost guard travels with the `BusContext`**: re-checked at core's single validation gate on every call, so a context built from a non-local `baseUrl` is rejected there, not just at config load.

`./server` was **remapped to the plugin entry** in `0.10.0` — OpenCode's loader resolves `exports["./server"]` before `main`, so publishing the lifecycle API there broke plugin loading with `Plugin export is not a function` (affected `0.6.0`–`0.9.0` from npm). The lifecycle API moved to `/managed-server`; a documented integration-issue solution captures the reserved-subpath loader-resolution trap.

## Security Posture

- **Localhost only.** Roster `server.baseUrl` must resolve to `127.0.0.1`/`::1`/`localhost`; non-local hosts are refused so bus credentials never leave the machine. The guard travels with the discovery handshake (an attached endpoint is re-validated as loopback regardless of source) and with the `BusContext` (re-checked at core's single validation gate per call).
- **HTTP Basic auth** injected per-request from `OPENCODE_SERVER_PASSWORD` (username `opencode`, or `OPENCODE_SERVER_USERNAME` override) when set.
- **Managed-server secrets:** each spawn gets a **freshly generated password** — never reused, never in argv, never logged; the discovery file is written `0600`. A launchd log-symlink TOCTOU was found and fixed (documented under `docs/solutions/security-issues/`). Same-user process compromise is explicitly out of scope.
- **MCP attach-only by default** — `mcp.ts` never calls `ensureServer` unless `SPACE_BUS_MCP_SPAWN` is set. Stdio discipline: stdout carries protocol frames only, all diagnostics to stderr.
- **Zero telemetry / no off-machine calls** from the plugin or MCP facade at runtime — aligned with Marcus's no-unconsented-telemetry baseline.
- **Delegation boundary (per `AGENTS.md`):** the control agent's only write path into sibling projects is `bus_task`. It never edits, runs shell against, or commits to sibling directories directly. On task failure or missing target, it reports the error verbatim and stops — no silent retry.
- **Core never throws across the boundary:** `core.ts` returns discriminated unions (`{ok:true}|{ok:false,error}`); errors never carry the `BusContext` object (credentials stay unprintable). Adapters convert `ok:false` to a thrown error (plugin) or an `isError` content block (MCP).

## Dependencies (2026-07-18, `package.json` at `8e20e01`)

| Package                        | Version    | Kind  | Purpose                                          |
| ------------------------------ | ---------- | ----- | ------------------------------------------------ |
| `@modelcontextprotocol/sdk`    | 1.29.0     | dep   | stdio MCP server for the Claude Desktop facade   |
| `zod`                          | **^4.4.3** | dep   | Manifest + API-response + discovery-file boundary parsing (**bumped v3 → v4** since MVP) |
| `@opencode-ai/plugin`          | **>=1.17.13 <2** | peer | Plugin `tool()` API — now a **peerDependency** (published-plugin shape), dev-pinned `1.17.18` |
| `@biomejs/biome`               | 2.5.2      | dev   | Lint + format (`biome check`) — **replaced the MVP's undocumented lint**        |
| `@changesets/cli`              | 2.31.0     | dev   | Versioning + npm publish pipeline                |
| `@types/bun`                   | 1.3.14     | dev   | Bun runtime types                                |
| `typescript`                   | 5.9.3      | dev   | Typecheck + `.d.ts` emit                         |

Notable shifts since MVP: **`@opencode-ai/sdk` is no longer a direct dependency** (the bus hits the server API via typed fetch against its own `contract.ts` zod schemas); `@opencode-ai/plugin` moved from a pinned dep to a `>=1.17.13 <2` **peer** (dev-pinned `1.17.18`, still lockstep with the CLI — upgrade both together); **zod crossed v3 → v4**. The "no other dependencies without approval" MVP constraint has relaxed as the plugin took on packaging (changesets) and lint (Biome) tooling.

## Build Phases (from `HANDOFF.md` — historical MVP record, 2026-07-03)

The original MVP was built in three verified phases (`HANDOFF.md` no longer present at the 2026-07-18 HEAD; retained here for provenance). The `.opencode/tools/` adapters below have since been replaced by the published-plugin `src/index.ts` + `src/tools/` layout, and the tool count grew from four to six (see above):

- **Phase 0 — Spike (`scripts/smoke.ts`):** prove cross-directory session creation, per-directory instance isolation (each session picks up its repo's own config/`AGENTS.md`), async prompt, and result retrieval against a live server. If isolation had failed, the fallback (N servers, `{baseUrl, directory}` per project) would have changed Phase 1's shape.
- **Phase 1 — Bus core + tools:** `src/core.ts` (`roster()`, `dispatch()`, `status()`, `result()` with discriminated-union results, parse-don't-validate at the API boundary via zod schemas derived from `GET /doc`) + the four `.opencode/tools/` adapters. R5 contract: the session ID is returned **before** the delegated session finishes.
- **Phase 2 — MCP facade:** `src/mcp.ts` registers the same four tools over stdio; verified via `@modelcontextprotocol/inspector`.

## Claude Desktop Integration (2026-07-18)

`src/mcp.ts` registers as a stdio MCP server, now published as the `space-bus-mcp` bin, so the config runs the published package via `bunx` instead of a source path. `opencode serve`/`harness serve` must already be running on the roster's `baseUrl`:

```json
{
  "mcpServers": {
    "space-bus": {
      "command": "bunx",
      "args": ["--package=@fro.bot/space-bus", "space-bus-mcp"],
      "env": { "SPACE_BUS_CONFIG": "/absolute/path/to/spacebus.json" }
    }
  }
}
```

## Fro Bot Workflow + CI (2026-07-18 — RESOLVED; was Absent at 2026-07-03)

The 2026-07-03 "no automation" gap is **closed** — the meta-irony (an agent-coordination surface not wired into the fleet's own automation) is retired. The repo now carries a full `.github/` automation suite:

- **`fro-bot.yaml`** — self-hosted Fro Bot workflow consuming `fro-bot/agent@v0.88.0` (SHA-pinned), the **consolidated three-mode** shape (PR review / daily schedule oversight+autoheal at `0 0 * * *` / `workflow_dispatch`). PR-head-SHA concurrency keying, bot/fork guards, `FRO_BOT_PAT`. The PR-review prompt is space-bus-specific (six-tool contract fidelity, two-surface parity, localhost guard, never-`process.cwd()`, MCP stdio discipline, discriminated-union boundary, changeset hygiene). The daily prompt maintains one perpetual "Daily Fro Bot Report" issue.
- **`ci.yaml`** — `Check` job: Bun install (frozen) → typecheck → lint → build → **Node ESM export-shape smoke** (asserts `default` export is a function) → `bun test`.
- **`codeql-analysis.yaml`** + **`scorecard.yaml`** — CodeQL + OSSF Scorecard coverage.
- **`release.yaml`** — changesets/action via a GitHub App token; **npm OIDC trusted publishing** (no `NPM_TOKEN`), npm upgraded to `11.18.0` for OIDC, `id-token: write`.
- **`renovate.yaml`** + **`update-repo-settings.yaml`** — self-hosted Renovate + Probot Settings sync.
- **`.github/settings.yml`** — Probot Settings inheriting `.github:common-settings.yaml` ([[probot-settings]]); branch protection on `main` requires `Analyze`/`CodeQL`/`Check`/`Fro Bot`/`Renovate` checks + 1 code-owner review, linear history, enforce-admins.

This makes space-bus a **fully self-hosting fleet member** — it is now one of its own delegation targets *and* runs the fleet's automation over itself.

## First Consumer: mothership (observed 2026-07-06)

A **downstream consumer** surfaced during the 2026-07-06 survey of [[marcusrbrown--mothership]]: that repo pins `@fro.bot/space-bus` **0.7.0** as a production dependency and consumes its `/contract` + `/core` library surface for schemas and reads. Mothership is a Tauri v2 desktop "multimodal agentic IDE" — a **renderer for the bus** that turns a directory-routed `opencode serve` workspace into a dockview panel layout and exposes that layout as `ide_*` MCP tools. Where space-bus is the _tasking_ plane (a control agent delegating via `bus_*` tools) and [[fro-bot--dashboard]] is the read-only _web observation_ plane, Mothership is the interactive _desktop mission-control cockpit_ over the same server line.

**Contradiction RESOLVED (2026-07-18, package status):** the 2026-07-06 mothership survey flagged that this repo's package was private/`0.0.0` at 2026-07-03 while mothership pinned `0.7.0`, and asked whether space-bus had been published. Confirmed against space-bus's own manifest at HEAD `8e20e01`: **the package IS published** — `@fro.bot/space-bus` is on npm with **20 versions** (`0.0.0` → `0.13.1`), so mothership's `0.7.0` pin was a mid-journey snapshot (space-bus has since advanced six more minors past it). Publishing is via changesets + npm OIDC trusted publishing. Both prior states remain recorded; the private/unpublished record is the 2026-07-03 state, the published record is 2026-07-18.

## Relationship to the Fro Bot Ecosystem

- **[[marcusrbrown--mothership]]** — the first observed downstream consumer of `@fro.bot/space-bus` (mothership pinned 0.7.0 at its 2026-07-06 survey; space-bus is now at 0.13.1). A Tauri v2 desktop IDE that _renders_ the bus: it consumes the browser-safe `/contract`/`/core` (and now `/attach`) surface and layers an `ide_*` MCP tool surface for driving its own UI. The `0.10.1` dist-level browser-safety fix was driven specifically by Mothership's Vite bundling breaking on the old Node prelude. Complements the space-bus tasking plane and the dashboard observation plane as a third operator surface.
- **[[fro-bot--agent]]** — space-bus rides the same OpenCode server line, and its diff-aggregation behavior is gated on `@fro.bot/harness` patched builds carrying upstream PR #33444. The `agent` repo is a first-class bus target, and space-bus now *consumes* `fro-bot/agent@v0.88.0` as its own review/autoheal workflow.
- **[[fro-bot--dashboard]]** / **[[marcusrbrown--infra]]** — the other manifest targets. space-bus is the *tasking* plane; dashboard is the read-only *observation* plane — complementary operator surfaces.
- **[[marcusrbrown--opencode-copilot-delegate]]** — a sibling delegation pattern: that plugin delegates to Copilot CLI subprocesses; space-bus delegates to sibling-repo OpenCode agents over the server API. Both are "one agent tasks another," different transports.
- **[[opencode-plugins]]** — space-bus is now a **shipped, distributable OpenCode plugin** (default-exported factory via the `tool()` API): the conversion drafted at MVP has landed. It's the fleet's reference example of a plugin with a managed-server lifecycle + CI-enforced browser-safe subpath exports.

## Open Threads / To Re-confirm Next Survey

- **Resolved this survey:** plugin conversion landed (packaging-move bet held); package published (0.13.1); Fro Bot workflow + CI/CodeQL/Scorecard/Probot Settings present; four→six tools.
- **Library-surface stability** — subpath exports are marked *experimental* (shapes may change in minors). Track whether they stabilize (drop the "experimental" caveat) and whether any break lands on the browser-safe lane that Mothership depends on.
- **Managed-daemon / launchd persistence** — v1 is macOS-only. Watch for a systemd/Linux equivalent and for the deferred fire-and-forget push-notification follow-on to `bus_wait`.
- **`@opencode-ai/plugin` peer range** (`>=1.17.13 <2`, dev-pinned `1.17.18`) + `@fro.bot/harness` alignment — verify the peer range and dev pin stay lockstep as the harness base advances in [[fro-bot--agent]].
- **zod v4** — confirm no downstream consumer (Mothership) is stranded on zod v3 schemas from `/contract`.

## Survey History

| Date       | HEAD      | Notes                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| 2026-07-03 | `ad8eefe` | Initial survey. New repo (created 2026-07-03), public, MIT, private-unpublished Bun/TS package. Four-tool workspace agent bus over one directory-routed `opencode serve`; MCP facade for Claude Desktop; MVP verified (Phases 0–2); plugin conversion drafted. **No Fro Bot workflow / no CI / no Probot Settings.** |
| 2026-07-06 | (not re-surveyed) | Cross-reference update only, from the [[marcusrbrown--mothership]] survey. First downstream consumer observed: mothership pins `@fro.bot/space-bus` **0.7.0**, implying the package went private/unpublished (`0.0.0`) → published (`0.7.0`). Package-status shift and current published version to be re-verified against this repo's own manifest next space-bus survey (see "First Consumer" section). |
| 2026-07-18 | `8e20e01` | Full re-survey. **MVP → shipped plugin.** Package **published to npm** (`0.13.1`, 20 versions via changesets + npm OIDC trusted publishing) — resolves the 2026-07-06 private→published contradiction. **Four → six tools** (`bus_wait` async-delegation `0.9.0`, `bus_registry` multi-roster `0.13.0`); "exactly four" MVP constraint superseded. New: **plugin-managed server lifecycle** + `space-bus` CLI + macOS **launchd** service; **CI-enforced browser-safe library surface** (7 subpath exports); **full Fro Bot workflow** (agent v0.88.0) + CI/CodeQL/Scorecard/Renovate/**Probot Settings** — resolves the "no automation" thread. `workspace.json` → `spacebus.json`; `.opencode/tools/` → `src/index.ts`+`src/tools/`; **zod v3 → v4**; Biome lint; `@opencode-ai/sdk` dropped, `@opencode-ai/plugin` now a peer dep. Stars 0→1, topics set, 8 open issues. |
