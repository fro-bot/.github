---
type: repo
title: fro-bot/space-bus
node_id: R_kgDOTMGFnQ
created: 2026-07-03
updated: 2026-09-04
sources:
  - url: https://github.com/fro-bot/space-bus
    sha: ad8eefe00c467ba342353d5bbd3d8cc6fbb61fc5
    accessed: 2026-07-03
  - url: https://github.com/fro-bot/space-bus
    sha: 8e20e01775918a01855eb5aba64d04bf966f4d51
    accessed: 2026-07-18
  - url: https://github.com/fro-bot/space-bus
    sha: fd8a746dd04bbf41b0d34dd0da55814686048ee9
    accessed: 2026-08-04
  - url: https://github.com/fro-bot/space-bus
    sha: 6c32dec910bddde52cd6e8b492a853dd5af3635d
    accessed: 2026-09-04
tags:
  - opencode
  - mcp
  - workspace-agent
  - agent-bus
  - directory-routing
  - opencode-server
  - custom-tools
  - claude-desktop
  - typescript
  - bun
  - zod
  - delegation
  - control-agent
  - dogfood
  - plugin
  - published-npm
  - managed-server
  - launchd
  - multi-roster
  - async-delegation
  - library-surface
  - browser-safe
  - changesets
  - oidc-publishing
  - message-correlation
  - session-api
  - fro-bot
  - code-freeze
  - publish-drought
  - autoheal-false-positive
  - renovate-backlog
  - sha-pinning
  - doc-drift
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

> **2026-09-04 survey (HEAD `6c32dec`, npm `0.15.0`) — the code is frozen and the daemon is hallucinating repairs into a working tree nobody commits.** Measured, not inferred: the recursive tree at `6c32dec` differs from `fd8a746` in **5 blobs of 117**, all under `.github/workflows/`, all pure action-pin lines (11 added / 11 removed). Every other file — `src/`, `test/`, `package.json`, `bun.lock`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, all 41 docs — is **byte-identical**. Widening the window: the last commit to touch `src/` is **`fe0cc42`, 2026-07-19** (#113, the `0.15.0` message-correlation work), the last human-authored commit is the same one, npm `latest` is still `0.15.0` published `2026-07-19T08:38:39Z` with the registry `modified` timestamp unmoved, and `.changeset/` holds only `config.json` — **nothing queued to release**. This repo built its entire published surface in a 16-day burst (2026-07-03 → 07-19: `0.0.0` → `0.15.0`, 22 npm versions, four → six tools, managed server, CLI, launchd, browser-safe library lane, full automation, 8 brainstorms + 9 plans + 19 solution docs) and has been **code-frozen for 47 days** since, with **1,007 Fro Bot workflow runs** logged over it. Three commits total in that window, all Renovate. Four findings, each with its own section below: (1) **the autoheal reports fixes it has no permitted path to deliver** — the same two-file docs diff (`/registry` subpath missing from README, `registry.ts`/`roster-edit.ts`/`registry-entry.ts` missing from AGENTS.md) has been diagnosed and "fixed" on at least **eight consecutive days** (#156 → #164), independently confirmed still absent on `main` at HEAD, and on **2026-09-01 (#161) the report flipped to ✅ "no drift found — yesterday's fixes still accurate"** about a file whose blob SHA has not changed since 2026-08-03; (2) **`actions/checkout` runs at two majors simultaneously** — `v6.1.0` in `ci`/`release`/`fro-bot`, `v7.0.1` in `codeql-analysis`/`scorecard`, each SHA pin its own Renovate dependency, reconciliation parked behind an unchecked `renovate/major-github-actions` approval box; (3) **grouping defeated the one automerge carve-out the repo declared** — `renovate.json5` exempts `fro-bot/agent` from the no-automerge-Actions rule, but the org preset batches it into `renovate/github-actions` with non-automergeable packages, so PR **#118 sat open 41 days** (2026-07-20 → 08-30) and landed the pin as a single **v0.93.1 → v0.106.0** jump; the next agent bump (v0.107.1) is now **rate-limited** behind a 5-PR cap consumed by unrelated stalled PRs; (4) **a failing non-security dependency PR falls through every autoheal category** — #72 (Biome 2.5.2 → 2.5.11) has been red for **55 days** because category 1 excludes dependency PRs and category 2 covers only security. Open PRs 5 (aged 5–55 days, all Renovate, none merged since 08-30); open issues 4; stars 1. Sections below preserve the 2026-08-04, 2026-07-18, and 2026-07-03 records; this banner marks what changed.

> **2026-08-04 survey (HEAD `fd8a746`, npm `0.15.0`) — no structural change; two additive library-surface minors.** Since the 2026-07-18 shipped-plugin survey the repo held its shape (six `bus_*` tools, browser-safe/Node-only lane split, managed-server + CLI + launchd, full Fro Bot/CI/CodeQL/Scorecard/Renovate/Probot automation all durable). Deltas are **feature-additive on the browser-safe `/core` lane**: (1) **`0.14.0` (#109) — explicit session-interaction primitives** (`messages()` bounded full-message read, `questions()` complete nested pending-question read, `answerQuestion()` ownership+cardinality-checked answer, plus an opt-in **fail-closed `dispatch({ onPendingQuestion: "blocked" })`** alongside the default fail-open `question-reply`) so consumers like [[marcusrbrown--mothership]]'s `ide_*` surface stop duplicating OpenCode HTTP behavior; (2) **`0.15.0` (#113) — dispatch message correlation** (`createDispatchMessageId()` no-Node-builtin id minting + optional `messageId` threaded through `dispatch()`/`toDispatchArgs()`/`dispatchMetadata()`/`bus_task`, plus a typed `DispatchFailure` handle with `phase: "not_sent" | "indeterminate"` for safe reconciliation after ambiguous failures). Also: **`assets/` brand-token system** (`banner.svg`/`styleguide.md`/`tokens.css`) landed — mirroring the [[fro-bot--dashboard]]/[[marcusrbrown--mrbro-dev]] design-token pattern; `opencode.jsonc` now loads the local dev plugin (`./src/index.ts`, #99); `build.ts` custom build script + `tsconfig.build.json`; Fro Bot **agent pin advanced v0.88.0 → v0.93.1**; `bfra-me/.github` reusable-workflow pin → **v4.16.44**; `@opencode-ai/plugin` dev-pin `1.17.18 → 1.18.2` (peer range `>=1.17.13 <2` unchanged); test suite grew ~30 → **~40 `*.test.ts`** (502 passing per #113). npm advanced `0.13.1 → 0.15.0` (22 versions). Open issues 8 → 9, stars 1. Sections below preserve the 2026-07-18 shipped-plugin record and the 2026-07-03 MVP record; this banner marks what changed.

> **2026-07-18 survey (HEAD `8e20e01`) — the repo matured from MVP dogfood to shipped plugin.** Since the 2026-07-03 initial survey it has: (1) **converted to a published OpenCode plugin** on npm (`0.13.1`, 20 versions via changesets + npm OIDC trusted publishing — resolving the private/`0.0.0` → published contradiction flagged at 2026-07-06); (2) grown from **four tools to six** (`bus_wait` async-delegation, `bus_registry` multi-roster) — the "exactly four tools" MVP constraint is **superseded**; (3) added a **plugin-managed server lifecycle** + `space-bus` CLI + macOS **launchd** reboot-persistence; (4) exposed a **CI-enforced browser-safe library surface** (subpath exports for renderers like [[marcusrbrown--mothership]]); and (5) **grown a full Fro Bot workflow + CI/CodeQL/Scorecard/Renovate/Probot Settings** — resolving the "no automation" thread. Sections below preserve the 2026-07-03 MVP record and mark what changed.

## Overview

| Attribute        | Value (2026-09-04 survey, HEAD `6c32dec`)                                      |
| ---------------- | ------------------------------------------------------------------------------ |
| Repo id          | `1287751069` (`node_id` `R_kgDOTMGFnQ`)                                        |
| Created          | 2026-07-03                                                                     |
| Last push        | 2026-09-02 (`pushed_at` — PR-branch pushes only; **HEAD commit `6c32dec` dated 2026-08-30**, "chore(deps): update GitHub Actions" #118) |
| Last `src/` change | **2026-07-19** (`fe0cc42`, #113) — 47 days before this survey                 |
| Last human commit  | **2026-07-19** (`fe0cc42`, `marcusrbrown`); all 3 commits since are `fro-bot[bot]` Renovate merges |
| Description      | Space Bus — workspace agent bus for OpenCode; control agent tasking per-project agents over the OpenCode server API, with an MCP facade for Claude Desktop |
| Homepage         | https://www.npmjs.com/package/@fro.bot/space-bus                              |
| Language         | TypeScript (strict, ESM)                                                       |
| Runtime          | Bun (dev/build/test); published dist targets Node ESM (`main: ./dist/index.js`) |
| Package manager  | Bun (`bun.lock`, `bun install`)                                               |
| Package          | `@fro.bot/space-bus` — **published to npm, `0.15.0`** (22 versions `0.0.0`→`0.15.0`; changesets + npm OIDC trusted publishing). `latest` published **2026-07-19T08:38:39Z**; registry `modified` unmoved since — a **47-day publish drought**, and `.changeset/` is empty so nothing is queued |
| License          | MIT                                                                            |
| Visibility       | Public                                                                         |
| Stars / forks    | 1 / 0                                                                          |
| Open issues      | 4 (`#164` today's daily report, `#81`, `#63`, `#6` Dependency Dashboard)        |
| Open PRs         | 5, **all `fro-bot[bot]` Renovate**, aged 5–55 days (`#158` 5d, `#135` 32d, `#130` 36d, `#115` 47d, `#72` 55d) |
| Topics           | `opencode`, `plugin`, `mcp`, `agent-orchestration`, `bun`, `typescript`       |
| Status           | **Shipped OpenCode plugin, code-frozen.** Six-tool bus + managed-server lifecycle + CLI + macOS launchd service + browser-safe library surface, all durable and unchanged since 2026-07-19. Full CI/CodeQL/Scorecard/Renovate/Fro Bot automation still running (1,007 Fro Bot runs; daily `schedule` pass green through 2026-09-04) — but see the delivery-gap section below: the daemon's write path does not reach `main` |

### Prior overview (2026-08-04 survey, HEAD `fd8a746` — historical)

Open issues were counted as **9** at that survey (the GitHub `open_issues_count` field, which sums issues **and** PRs). The 2026-09-04 survey splits them: 4 issues + 5 PRs = 9, so the headline count is unchanged while its composition is not. Recorded explicitly because "open issues 8 → 9" in the 2026-08-04 banner reads as issue growth and is really a mixed count.

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

## Browser-safe `/core` session API + message correlation (2026-08-04 — new)

Two additive minors extended the browser-safe `/core` lane so renderers (e.g. [[marcusrbrown--mothership]]'s `ide_*` MCP surface) stop maintaining parallel OpenCode HTTP clients. All of this lives inside `@fro.bot/space-bus/core` — session-directory resolution, localhost auth, per-call context validation, and discriminated-union failure semantics stay on the bus side; no Node builtins, no ambient env reads.

**`0.14.0` (#109, `8802338`) — explicit session-interaction primitives:**

- `messages(sessionId, { context, limit? })` — bounded full-message read; resolves ownership from the roster (never a caller-supplied directory), returns `{ sessionId, project, messages: [{ id?, role, createdAt?, parts }] }` with stable identity/ordering. `limit` defaults 20, hard-capped 200; `0`/negative/fractional/`NaN`/`Infinity` rejected before any fetch.
- `questions(target, { context })` — complete project- or session-scoped pending-question read (`target: { project } | { sessionId }`, exactly one). One entry per pending request with its **full nested subquestion list** (`requestId`, `sessionId`, `questions[]` each with `header?/question/multiple/custom/options[]`).
- `answerQuestion({ sessionId, requestId, answers }, { context })` — explicit answer; runtime-validates `answers` is a non-empty `string[][]`, verifies `requestId` belongs to a pending question on `sessionId` (cross-session `requestId` refused with no mutation), and verifies `answers.length` matches the request's subquestion count (mismatch refused with no mutation).
- `dispatch()` gains `args.onPendingQuestion: "question-reply" | "blocked"`. Default preserves `0.13.1`'s fail-open reply behavior; **`"blocked"` is fail-closed** — returns typed `{ mode: "blocked", requestId }` (no reply, no follow-up) when a question is pending, and a stable `Result` error rather than guessing when pending-question state can't be verified (non-2xx / unparseable `GET /question`). For callers that must never silently reinterpret a follow-up prompt as an answer.

**`0.15.0` (#113, `fe0cc42`) — dispatch message correlation:**

- `createDispatchMessageId()` — mints an OpenCode-compatible ascending user-message id (`msg_` + 12-hex timestamp/counter prefix + 14 base62) using only `Date.now()` + Web Crypto `getRandomValues`; same-millisecond ids sort ascending via an internal per-ms counter, matching OpenCode's own ordering.
- optional `messageId` on `DispatchArgs`, threaded through `toDispatchArgs()`/`dispatch()`/`dispatchMetadata()`/`bus_task` (plugin + MCP `outputSchema`). Validated against the exact `msg_` + 12-hex + 14-alnum shape; rejection returns one stable generic error that **never echoes the rejected value**. Key omitted entirely (not `null`) when unset; `blocked`/`question-reply` branches never carry a `messageId`.
- new `DispatchFailure` type + optional `dispatchFailure` on dispatch's error branch: `phase: "not_sent"` (verified to precede any mutation) vs `phase: "indeterminate"` (a mutating request may already have reached OpenCode). Known-safe fields only (`project`, and `sessionId`/`messageId` when known); unknowns omitted, never sent as `undefined`.

Both preserve the existing `Result<T>`/`DispatchResult`/`BusContext` contract and the browser-safe import lane. The `bus_task` human-readable text output is unchanged.

## The 47-Day Code Freeze (2026-09-04 — new)

The prior survey called this repo "steady-state." Two more surveys of evidence turn that into something sharper: **development stopped**, and every signal that looks like activity is automation running over a static tree.

| Signal                                   | Value at 2026-09-04                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Blobs changed since `fd8a746` (2026-08-03) | **5 of 117**, all `.github/workflows/*.yaml`, all action-pin lines         |
| Commits on `main` since 2026-07-19       | **3** (`49f503d1` 07-28, `fd8a746d` 08-03, `6c32dec9` 08-30) — all Renovate |
| Last `src/` commit                       | `fe0cc42` — 2026-07-19                                                    |
| Last human commit                        | `fe0cc42` — 2026-07-19 (`marcusrbrown`)                                   |
| Human commits 2026-07-01 → 07-19         | 54                                                                        |
| npm `latest`                             | `0.15.0`, published 2026-07-19; registry `modified` identical             |
| Pending changesets                       | 0 (`.changeset/` contains only `config.json`)                             |
| Fro Bot workflow runs, all-time          | **1,007** (daily `schedule` pass `success` through 2026-09-04)            |
| Daily report issues                      | 52 (51 closed + 1 open) — **the only issues this repo has ever closed**   |

The docs corpus corroborates the shape: the newest brainstorm and plan are both dated **2026-07-11**, the newest `docs/solutions/` entry **2026-07-13**. The repo's authored history is a 16-day sprint followed by a maintenance daemon.

This is not a defect on its own — a small plugin that reached its designed surface can legitimately stop. It matters because the automation does not distinguish "finished" from "abandoned," and the sections below show three ways that indistinguishability produces confidently wrong output.

## The Autoheal Reports Fixes It Has No Path to Deliver (2026-09-04 — new)

**The finding.** The daily Fro Bot pass has diagnosed, applied, and reported the *same two-file documentation fix* on at least **eight consecutive days**, and `main` has never received it. The drift is real and independently verified at HEAD `6c32dec` (not taken on the agent's word):

- `README.md`'s "Library surface" list documents `/core`, `/config`, `/contract`, `/format`, `/managed-server`, `/attach` — and **omits `@fro.bot/space-bus/registry`**, which is a real `package.json` export (`"./registry" → dist/registry-entry.js`) backing `bus_registry`.
- `AGENTS.md`'s "Project structure" list covers `index`/`tools`/`core`/`config`/`contract`/`attach`/`mcp`/`discovery`/`server`/`cli`/`launchd`/`service` — and **omits `src/registry.ts`, `src/roster-edit.ts`, `src/registry-entry.ts`**, three files that exist, are imported by `bus_registry.ts`/`config.ts`/`mcp.ts`, and are covered by `browser-safety.test.ts`.

**The report series** (Docs Drift row of each daily issue):

| Issue | Date       | Docs Drift verdict                                                          |
| ----- | ---------- | ---------------------------------------------------------------------------- |
| #156  | 2026-08-28 | ⚠️ "fixed, working tree only … delivery pipeline suspected"                   |
| #159  | 2026-08-30 | ⚠️ "**5th consecutive day** this exact diff has been diagnosed and applied without landing" |
| #161  | 2026-09-01 | ✅ "**no drift found** (yesterday's fixes still accurate)"                     |
| #162  | 2026-09-02 | ✅ "Found and fixed"                                                          |
| #163  | 2026-09-03 | ✅ "Found and fixed (again — see note below)"                                  |
| #164  | 2026-09-04 | ⚠️ "Fixed again (third occurrence). Root cause of recurrence identified this run." |

**Two distinct failures, stacked.** The first is a delivery gap. The second is worse: on **2026-09-01 the run asserted the opposite conclusion about an unchanged file**. `README.md`'s blob SHA is identical at `fd8a746` (2026-08-03) and `6c32dec` (2026-08-30), and HEAD has not moved since — there is no window in which "yesterday's fixes" could have landed. A verification step that reports the desired state instead of the observed state is strictly more dangerous than one that reports nothing, because the ✅ retires the ⚠️ that was accumulating evidence.

**Correcting the agent's own root-cause.** #164 attributes the recurrence to the caller workflow: "the harness step that turns this run's working-tree diff into a commit/PR is not actually running." That is half right — `fro-bot.yaml`'s job has exactly four steps (checkout → setup-bun → `bun install` → `Run Fro Bot`) and **no commit, push, or PR step**, with `permissions: contents: read` at workflow level. But the agent holds `FRO_BOT_PAT` and is expected to deliver via `gh` itself. The actual blocker is in the prompt, and it is checkable:

- Category 4 (DOCS DRIFT) instructs: *"Fix small, unambiguous drift directly on a PR branch."*
- HARD BOUNDARIES states: *"Never push directly to main. Direct pushes are allowed only to an existing non-default PR branch you are repairing **under category 1 or 2**."*

Category 4 has no whitelisted delivery path. The boundary section and the category section disagree, and a well-behaved agent resolves in favor of the boundary — so it edits the working tree, finds no permitted way to ship it, and the checkout is discarded at job end. **The prompt structurally forbids the delivery it asks for.** This is the same class as the [[marcusrbrown--marcusrbrown-com]] "autoheal loop is open at the merge step," one step earlier in the pipeline, and it contrasts with [[marcusrbrown--dev-like]], where the null verdict is *explicitly granted* so the agent reports honestly instead of claiming a phantom fix. Generalized in [[github-actions-ci]].

Smallest safe repair, in order of leverage: (1) extend the HARD BOUNDARIES whitelist to cover category 4 branch creation, or add an explicit "open a PR from a new branch" clause; (2) make the Docs Drift verdict cite a PR URL or a commit SHA — an unciteable ✅ should not be representable; (3) have the run compare against `origin/main` rather than the working tree it just edited.

## One Action, Two Majors (2026-09-04 — new)

`actions/checkout` is pinned at **two different majors in the same repository**, and Renovate is faithfully maintaining both:

| Workflow                  | Pin                                       |
| ------------------------- | ----------------------------------------- |
| `ci.yaml`                 | `d23441a4…` **# v6.1.0** → *update available: v7.0.1* |
| `release.yaml`            | `d23441a4…` **# v6.1.0** → *update available: v7.0.1* |
| `fro-bot.yaml`            | `d23441a4…` **# v6.1.0** → *update available: v7.0.1* |
| `codeql-analysis.yaml`    | `3d3c42e5…` **# v7.0.1**                  |
| `scorecard.yaml`          | `3d3c42e5…` **# v7.0.1**                  |

PR #118's body lists `actions/checkout` **twice** — `v7.0.0 → v7.0.1` and `v6.0.3 → v6.1.0` — in one table, and the Dependency Dashboard's "Detected Dependencies" section enumerates each call site separately. Renovate is not confused; it is correct. A SHA pin with a `# vX.Y.Z` comment makes the *comment* the `currentValue`, so **each call site is its own dependency instance** with its own version line. Nothing in the model says two instances of the same action should agree, and no lint in this repo compares them.

The v6 → v7 reconciliation exists — it is parked in the Dependency Dashboard's **Pending Approval** section as `renovate/major-github-actions` (bundling `actions/checkout`, `actions/setup-node`, `changesets/action` majors), an unchecked box. The likely origin of the split is template provenance: `codeql-analysis.yaml` and `scorecard.yaml` are upstream-template-shaped files that arrived carrying v7, while `ci`/`release`/`fro-bot` are in-repo authored and stayed on v6. This is the same family as the mis-pathed `uses:` case in [[marcusrbrown--esphome-life]] — SHA pinning validates the ref, not the coherence of the fleet of refs. Generalized in [[github-actions-ci]].

## Grouping Defeats the Automerge Carve-Out (2026-09-04 — new)

`.github/renovate.json5` ends with a deliberate exemption:

```json5
{
  description: 'Never automerge GitHub Actions version bumps',
  matchManagers: ['github-actions'],
  matchPackageNames: ['!fro-bot/agent'],
  automerge: false,
}
```

The intent is legible: human review for third-party Actions, hands-free for the first-party agent pin. It has not worked once. The org preset (`extends: ['github>fro-bot/.github']`) groups **all** `github-actions` updates onto a single `renovate/github-actions` branch, so `fro-bot/agent` rides in a PR whose other members are explicitly non-automergeable. Automerge is a property of the PR, not of a package inside it, and the union resolves to the most restrictive member.

Observed cost:

- **PR #118 was open 41 days** (created 2026-07-20, merged 2026-08-30) carrying one commit and five files. During that time Renovate kept rebasing it, so the merged content bore no resemblance to the opened content: the agent pin landed as a single **v0.93.1 → v0.106.0** jump, ~13 minors at once.
- It merged **out of order** — #118 landed 27 days after the higher-numbered #128 — which is the visible fingerprint of a long-parked branch.
- The next agent bump (**v0.107.1**) is now in the dashboard's **Rate-Limited** section on the same `renovate/github-actions` branch, behind a `prConcurrentLimit` consumed by five stalled PRs that have nothing to do with it.

So the one dependency the repo declared safe to land automatically is the one most reliably blocked, first by a grouping it does not control and then by a concurrency cap it does not contend for. Fix is one line: `separateMajorMinor`/group override, or a `matchPackageNames: ['fro-bot/agent']` rule with its own `groupName` so the carve-out gets its own branch. Generalized in [[github-actions-ci]]; compare the fixed 5-PR window over a deep backlog in [[bfra-me--ha-addon-repository]].

## A Failing Dependency PR With No Owner (2026-09-04 — new)

**PR #72** (`chore(dev): update dependency @biomejs/biome to v2.5.11`) has been open since **2026-07-11 — 55 days** — with `Check` failing the whole time. Checks on its head SHA: `Check` ❌, `CodeQL` ✅, `Analyze` ✅, `Renovate / Renovate` ✅, `Renovate` ⏭️, **`Fro Bot` ⏭️ skipped**.

Three mechanisms hold it in place, and each is individually defensible:

1. **The autoheal will not touch it.** Category 1 (ERRORED PRs) says *"Skip dependency/security PRs here (handle in category 2)"*; category 2 covers **security** PRs only. A failing *non-security dependency* PR is named by neither. #164 declines it explicitly, citing DEPENDENCY OWNERSHIP: "Renovate owns routine bumps."
2. **Renovate cannot repair it.** `renovate.json5` sets `skipArtifactsUpdate: true` for the `bun`/`npm` managers — a documented workaround, because `bfra-me/renovate-action` runs with `RENOVATE_BINARY_SOURCE=install` and the built-in artifact path's `install-tool bun <ver>` fails in that environment. Lockfile regeneration is delegated to `postUpgradeTasks: ['bun install', 'bun run fix', 'bun run build']`. When that fallback fails, `bun.lock` is stale, `bun install --frozen-lockfile` fails, and `Check` goes red — which is exactly the pair of failures #164 reports (`Check` **and** `renovate/artifacts`).
3. **The required `Fro Bot` check skips on bot-authored PRs.** The workflow's `if:` excludes `[bot]` authors, and `.github/settings.yml` lists `Fro Bot` as a required context. A skipped required check counts as satisfied, so the review gate is structurally unevaluable on precisely the PRs that make up 100% of this repo's queue — the same shape recorded for [[bfra-me--ha-addon-repository]].

The net is a jurisdictional gap: the agent defers to Renovate, Renovate's repair path is disabled by config, the review gate cannot fire, and no human has looked in 55 days. Nothing is broken; nothing is anyone's job.

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
| `@opencode-ai/plugin`          | **>=1.17.13 <2** | peer | Plugin `tool()` API — a **peerDependency** (published-plugin shape); dev-pin advanced `1.17.18 → 1.18.2` (2026-08-04) |
| `@biomejs/biome`               | 2.5.2      | dev   | Lint + format (`biome check`) — **replaced the MVP's undocumented lint**        |
| `@changesets/cli`              | **2.31.1** | dev   | Versioning + npm publish pipeline (`2.31.0 → 2.31.1`, #108) |
| `@types/bun`                   | 1.3.14     | dev   | Bun runtime types                                |
| `typescript`                   | 5.9.3      | dev   | Typecheck + `.d.ts` emit                         |

**2026-09-04 re-confirmation:** `package.json` and `bun.lock` are **byte-identical** to `fd8a746`, so every row above still holds verbatim at HEAD `6c32dec` — `@modelcontextprotocol/sdk` 1.29.0, zod ^4.4.3, `@opencode-ai/plugin` peer `>=1.17.13 <2` with dev-pin **1.18.2**, Biome 2.5.2, `@changesets/cli` 2.31.1, `@types/bun` 1.3.14, TypeScript 5.9.3. Every one of them now has an update queued and unmerged: Biome → 2.5.11 (PR #72, red 55 days), `@opencode-ai/plugin` → 1.18.25 (#115), MCP SDK → 1.30.0 (#130), and `@types/bun` → 1.4.0 rate-limited, with `@changesets/cli` v3 and `typescript` v7 majors sitting in Pending Approval. The dev-pin matters more than the others: **the dev-pin is what CI tests against while the published peer range promises `>=1.17.13 <2`**, so a frozen dev-pin quietly widens the gap between the tested surface and the promised one — 23 patch releases of drift as of this survey.

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

- **`fro-bot.yaml`** — self-hosted Fro Bot workflow consuming `fro-bot/agent` (SHA-pinned; **agent pin advanced v0.88.0 → v0.93.1 → v0.106.0**, SHA `eeb3dbd` as of 2026-09-04, landed in one 41-day-old PR — see the grouping section above), the **consolidated three-mode** shape (PR review / daily schedule oversight+autoheal at `0 0 * * *` / `workflow_dispatch`). Reusable-workflow base `bfra-me/.github` at **v4.16.44** in both `renovate.yaml` and `update-repo-settings.yaml` — correctly *pathed* (unlike [[marcusrbrown--esphome-life]]'s mis-pathed settings-sync `uses:`) but **6 minor series behind** the fleet's v4.24.0; PR #158 has that bump open since 2026-08-30. PR-head-SHA concurrency keying, bot/fork guards, `FRO_BOT_PAT`. The PR-review prompt is space-bus-specific (six-tool contract fidelity, two-surface parity, localhost guard, never-`process.cwd()`, MCP stdio discipline, discriminated-union boundary, changeset hygiene). The daily prompt maintains one perpetual "Daily Fro Bot Report" issue.
- **Daily-report closure is title-prefix-matched, on a public repo, with a PAT.** The `SCHEDULE_PROMPT` instructs: *"CLOSE every older open issue whose title starts with `Daily Fro Bot Report —` (and any earlier `Daily Autohealing Report` variant)."* There is no `author.login` check and no body marker — the same unmitigated public-write-surface shape recorded for the control-plane repo on 2026-09-03 and generalized in [[github-actions-ci]] ("A Title-Matched Rolling Issue Is a Public Write Surface"). Dated titles are adopted here (the cosmetic third of the [[bfra-me--works]] remedy); prefix matching means an attacker does not need to guess the date. 51 closed daily reports confirm the sweep runs every day.
- **The job has no delivery step.** Four steps: checkout → setup-bun → `bun install` → `Run Fro Bot`. No commit, no push, no `gh pr create`, and `permissions: contents: read` at workflow scope. Delivery is entirely the agent's responsibility via `FRO_BOT_PAT` — which is why the prompt's boundary/category conflict (above) silently voids category 4.
- **`ci.yaml`** — `Check` job: Bun install (frozen) → typecheck → lint → build → **Node ESM export-shape smoke** (asserts `default` export is a function) → `bun test`.
- **`codeql-analysis.yaml`** + **`scorecard.yaml`** — CodeQL + OSSF Scorecard coverage.
- **`release.yaml`** — changesets/action via a GitHub App token; **npm OIDC trusted publishing** (no `NPM_TOKEN`), npm upgraded to `11.18.0` for OIDC, `id-token: write`.
- **`renovate.yaml`** + **`update-repo-settings.yaml`** — self-hosted Renovate + Probot Settings sync.
- **`.github/settings.yml`** — Probot Settings inheriting `.github:common-settings.yaml` ([[probot-settings]]); branch protection on `main` requires `Analyze`/`CodeQL`/`Check`/`Fro Bot`/`Renovate` checks + 1 code-owner review, linear history, enforce-admins.

This makes space-bus a **fully self-hosting fleet member** — it is now one of its own delegation targets *and* runs the fleet's automation over itself.

## First Consumer: mothership (observed 2026-07-06)

A **downstream consumer** surfaced during the 2026-07-06 survey of [[marcusrbrown--mothership]]: that repo pins `@fro.bot/space-bus` **0.7.0** as a production dependency and consumes its `/contract` + `/core` library surface for schemas and reads. Mothership is a Tauri v2 desktop "multimodal agentic IDE" — a **renderer for the bus** that turns a directory-routed `opencode serve` workspace into a dockview panel layout and exposes that layout as `ide_*` MCP tools. Where space-bus is the _tasking_ plane (a control agent delegating via `bus_*` tools) and [[fro-bot--dashboard]] is the read-only _web observation_ plane, Mothership is the interactive _desktop mission-control cockpit_ over the same server line.

**Contradiction RESOLVED (2026-07-18, package status):** the 2026-07-06 mothership survey flagged that this repo's package was private/`0.0.0` at 2026-07-03 while mothership pinned `0.7.0`, and asked whether space-bus had been published. Confirmed against space-bus's own manifest at HEAD `8e20e01`: **the package IS published** — `@fro.bot/space-bus` is on npm with **20 versions** (`0.0.0` → `0.13.1`), so mothership's `0.7.0` pin was a mid-journey snapshot (space-bus has since advanced six more minors past it). Publishing is via changesets + npm OIDC trusted publishing. Both prior states remain recorded; the private/unpublished record is the 2026-07-03 state, the published record is 2026-07-18.

**Consumer pin update (2026-07-21, from the mothership re-survey):** mothership advanced its `@fro.bot/space-bus` production pin **0.7.0 → 0.14.0** (HEAD `e7e305f`), and now also consumes the `/attach` subpath (`resolveManagedServer`) in addition to `/contract` + `/core`. Confirm the current published `latest` on this repo's own manifest next space-bus survey.

**Published-`latest` confirmation (2026-08-04, this repo's manifest):** `latest` is now **`0.15.0`** (22 versions). Mothership's last-known pin `0.14.0` is one minor behind — the `0.15.0` message-correlation additions (`createDispatchMessageId`, `messageId` on `dispatch`, `DispatchFailure`) are strictly additive on the browser-safe `/core` lane, so a mothership bump to `0.15.0` picks them up without contract breakage. Verify mothership's pin on its next survey.

**Consumer-gap freeze (2026-09-04, npm registry):** `latest` is **still `0.15.0`**, 22 versions, published `2026-07-19T08:38:39Z`, registry `modified` identical — no dist-tag touch, no republish. The [[marcusrbrown--mothership]] 2026-08-22 survey recorded the pin held at `0.14.0` with "0.15.0 available but pin held." That gap is now **stable rather than lagging**: the producer stopped moving, so a one-minor consumer gap that would normally close itself on the next routine bump has become a fixed offset. Worth noting for the library-surface stability thread — the `@experimental` caveat on the subpath exports has had 47 days of no change to accumulate confidence, which is not the same as 47 days of validation.

## Relationship to the Fro Bot Ecosystem

- **[[marcusrbrown--mothership]]** — the first observed downstream consumer of `@fro.bot/space-bus` (mothership pinned 0.7.0 at its 2026-07-06 survey; space-bus is now at 0.13.1). A Tauri v2 desktop IDE that _renders_ the bus: it consumes the browser-safe `/contract`/`/core` (and now `/attach`) surface and layers an `ide_*` MCP tool surface for driving its own UI. The `0.10.1` dist-level browser-safety fix was driven specifically by Mothership's Vite bundling breaking on the old Node prelude. Complements the space-bus tasking plane and the dashboard observation plane as a third operator surface.
- **[[fro-bot--agent]]** — space-bus rides the same OpenCode server line, and its diff-aggregation behavior is gated on `@fro.bot/harness` patched builds carrying upstream PR #33444. The `agent` repo is a first-class bus target, and space-bus now *consumes* `fro-bot/agent@v0.88.0` as its own review/autoheal workflow.
- **[[fro-bot--dashboard]]** / **[[marcusrbrown--infra]]** — the other manifest targets. space-bus is the *tasking* plane; dashboard is the read-only *observation* plane — complementary operator surfaces.
- **[[marcusrbrown--opencode-copilot-delegate]]** — a sibling delegation pattern: that plugin delegates to Copilot CLI subprocesses; space-bus delegates to sibling-repo OpenCode agents over the server API. Both are "one agent tasks another," different transports.
- **[[opencode-plugins]]** — space-bus is now a **shipped, distributable OpenCode plugin** (default-exported factory via the `tool()` API): the conversion drafted at MVP has landed. It's the fleet's reference example of a plugin with a managed-server lifecycle + CI-enforced browser-safe subpath exports.

## Open Threads / To Re-confirm Next Survey

- **Resolved 2026-07-18:** plugin conversion landed (packaging-move bet held); package published (0.13.1); Fro Bot workflow + CI/CodeQL/Scorecard/Probot Settings present; four→six tools.
- **No structural change 2026-08-04:** six-tool surface, lane split, managed-server/CLI/launchd, and full automation all durable; the only motion was additive `/core` primitives + dep bumps + `assets/` brand tokens. The plugin is in steady-state.
- **"Steady-state" superseded 2026-09-04 → code freeze.** The 2026-08-04 reading was correct as description and too generous as diagnosis. Measured: 5 of 117 blobs changed in 27 days, all action pins; `src/` untouched for 47 days; no human commit and no npm release since 2026-07-19; zero pending changesets. Not evidence of a defect, but the automation cannot tell "finished" from "abandoned" and the three findings below are what that costs.
- **NEW — docs-drift autoheal delivers nothing and says otherwise.** Eight consecutive daily reports "fixing" the same `/registry` + `registry.ts`/`roster-edit.ts`/`registry-entry.ts` diff; drift independently confirmed present at HEAD; #161 (2026-09-01) reported ✅ "no drift found." Root cause is the prompt's HARD BOUNDARIES whitelisting direct pushes only for categories 1–2 while category 4 asks for a PR branch. Re-check next survey whether the boundary clause was widened, whether the Docs Drift verdict now cites a PR/SHA, and whether the two files finally carry the three missing entries.
- **NEW — `actions/checkout` split across majors** (v6.1.0 in `ci`/`release`/`fro-bot`, v7.0.1 in `codeql`/`scorecard`). Reconciliation sits in the Dependency Dashboard's Pending Approval box (`renovate/major-github-actions`, also carrying `actions/setup-node` v7 and `changesets/action` v2 — the latter is the major that renamed every input in [[bfra-me--works]] while CI stayed green). Track whether the approval box is ever checked.
- **NEW — the `fro-bot/agent` automerge carve-out is inert.** Grouping puts it on `renovate/github-actions` with non-automergeable packages (41-day #118, v0.93.1 → v0.106.0 in one jump); v0.107.1 is now rate-limited behind a 5-PR cap. Watch for a `groupName` override splitting the agent onto its own branch.
- **NEW — PR #72 (Biome) red for 55 days**, owned by nobody: autoheal category 1 excludes dependency PRs, category 2 is security-only, and Renovate's artifact path is disabled by design (`skipArtifactsUpdate` + `postUpgradeTasks`). Re-check whether the Bun-lockfile `postUpgradeTasks` fallback still fails and whether the 5-PR queue drains.
- **Reusable-workflow pin 6 minor series behind.** `bfra-me/.github` at v4.16.44 vs fleet v4.24.0; PR #158 open since 2026-08-30. Both `uses:` paths are correct here — this is a lag, not the [[marcusrbrown--esphome-life]] mis-path defect.
- **Title-prefix daily-report closure with a PAT on a public repo** — confirmed present in `SCHEDULE_PROMPT`, no author check, no body marker. Second fleet instance of the pattern flagged on the control plane 2026-09-03.
- **Library-surface stability** — subpath exports (including the new `messages`/`questions`/`answerQuestion` and message-correlation additions) are still marked *experimental* (`registry-entry.ts` carries the `@experimental` banner). Track whether they stabilize (drop the caveat) and whether any break lands on the browser-safe lane that Mothership depends on.
- **Managed-daemon / launchd persistence** — v1 is macOS-only. Watch for a systemd/Linux equivalent and for the deferred fire-and-forget push-notification follow-on to `bus_wait`.
- **`@opencode-ai/plugin` peer range** (`>=1.17.13 <2`, dev-pin advanced `1.17.18 → 1.18.2`) + `@fro.bot/harness` alignment — verify the peer range and dev pin stay lockstep as the harness base advances in [[fro-bot--agent]].
- **zod v4** — confirm no downstream consumer (Mothership) is stranded on zod v3 schemas from `/contract`.
- **`assets/` brand-token system** (`banner.svg`/`styleguide.md`/`tokens.css`) — landed 2026-08-04 but no consuming surface observed in-repo (space-bus has no web UI); likely staged for the `apply-branding` fleet pattern. Confirm whether it wires into anything or stays dormant next survey.

## Survey History

| Date       | HEAD      | Notes                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| 2026-07-03 | `ad8eefe` | Initial survey. New repo (created 2026-07-03), public, MIT, private-unpublished Bun/TS package. Four-tool workspace agent bus over one directory-routed `opencode serve`; MCP facade for Claude Desktop; MVP verified (Phases 0–2); plugin conversion drafted. **No Fro Bot workflow / no CI / no Probot Settings.** |
| 2026-07-06 | (not re-surveyed) | Cross-reference update only, from the [[marcusrbrown--mothership]] survey. First downstream consumer observed: mothership pins `@fro.bot/space-bus` **0.7.0**, implying the package went private/unpublished (`0.0.0`) → published (`0.7.0`). Package-status shift and current published version to be re-verified against this repo's own manifest next space-bus survey (see "First Consumer" section). |
| 2026-08-04 | `fd8a746` | Re-survey. **No structural change** — six-tool bus, lane split, managed-server/CLI/launchd, full CI/CodeQL/Scorecard/Renovate/Fro Bot/Probot automation all durable. Additive only: **`0.14.0` (#109)** explicit session-interaction `/core` primitives (`messages`/`questions`/`answerQuestion` + opt-in fail-closed `dispatch({onPendingQuestion:"blocked"})`); **`0.15.0` (#113)** dispatch message correlation (`createDispatchMessageId`, optional `messageId`, typed `DispatchFailure` `not_sent`/`indeterminate`). New `assets/` brand-token system; `opencode.jsonc` loads local dev plugin (#99); `build.ts`+`tsconfig.build.json`. Fro Bot **agent pin v0.88.0 → v0.93.1**; `bfra-me/.github` → **v4.16.44**; `@opencode-ai/plugin` dev-pin `1.17.18 → 1.18.2`; `@changesets/cli` `2.31.0 → 2.31.1`. npm `0.13.1 → 0.15.0` (22 versions); tests ~30 → ~40 files (502 passing). Open issues 8 → 9, stars 1. |
| 2026-09-04 | `6c32dec` | Re-survey. **Code freeze + autoheal false-positive.** Tree diff vs `fd8a746`: **5 of 117 blobs**, all `.github/workflows/*.yaml` action-pin lines (11 add / 11 del); everything else byte-identical. `src/` and human authorship both stop at **2026-07-19** (`fe0cc42`, #113); npm `latest` still `0.15.0` (published 2026-07-19, registry `modified` unmoved) = **47-day publish drought**; `.changeset/` empty. 3 Renovate commits in the window. **(1)** Daily autoheal has "fixed" the same README `/registry` + AGENTS.md `registry.ts`/`roster-edit.ts`/`registry-entry.ts` drift on **8 consecutive days** (#156→#164) with zero commits — drift independently confirmed at HEAD; **#161 (09-01) reported ✅ "no drift found"** about a file whose blob has not changed since 08-03. Root cause corrected against the agent's own hypothesis: category 4 asks for a PR branch, HARD BOUNDARIES whitelists direct pushes only for categories 1–2, so there is no permitted delivery path. **(2)** `actions/checkout` pinned at **two majors** (v6.1.0 in `ci`/`release`/`fro-bot`, v7.0.1 in `codeql`/`scorecard`); Renovate treats each SHA pin as its own dependency; reconciliation parked in Pending Approval. **(3)** The `automerge: false … !fro-bot/agent` carve-out is defeated by org-preset grouping — **PR #118 open 41 days**, landing the pin as v0.93.1 → **v0.106.0** in one jump and merging out of order (after #128); v0.107.1 now rate-limited behind a 5-PR cap. **(4)** PR **#72 red 55 days** with no owner (category 1 excludes dep PRs, category 2 is security-only, Renovate's artifact path disabled by config, required `Fro Bot` check skips on bot PRs). `bfra-me/.github` still v4.16.44 vs fleet v4.24.0. Open PRs 5 (5–55d, all Renovate); open issues 4; 1,007 Fro Bot runs, daily pass green. |
| 2026-07-18 | `8e20e01` | Full re-survey. **MVP → shipped plugin.** Package **published to npm** (`0.13.1`, 20 versions via changesets + npm OIDC trusted publishing) — resolves the 2026-07-06 private→published contradiction. **Four → six tools** (`bus_wait` async-delegation `0.9.0`, `bus_registry` multi-roster `0.13.0`); "exactly four" MVP constraint superseded. New: **plugin-managed server lifecycle** + `space-bus` CLI + macOS **launchd** service; **CI-enforced browser-safe library surface** (7 subpath exports); **full Fro Bot workflow** (agent v0.88.0) + CI/CodeQL/Scorecard/Renovate/**Probot Settings** — resolves the "no automation" thread. `workspace.json` → `spacebus.json`; `.opencode/tools/` → `src/index.ts`+`src/tools/`; **zod v3 → v4**; Biome lint; `@opencode-ai/sdk` dropped, `@opencode-ai/plugin` now a peer dep. Stars 0→1, topics set, 8 open issues. |
