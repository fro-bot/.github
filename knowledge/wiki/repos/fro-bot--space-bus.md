---
type: repo
title: "fro-bot/space-bus"
created: 2026-07-03
updated: 2026-07-03
sources:
  - url: https://github.com/fro-bot/space-bus
    sha: ad8eefe00c467ba342353d5bbd3d8cc6fbb61fc5
    accessed: 2026-07-03
tags: [opencode, mcp, workspace-agent, agent-bus, directory-routing, opencode-server, custom-tools, claude-desktop, typescript, bun, zod, delegation, control-agent, dogfood, mvp, plugin-conversion, fro-bot]
related:
  - fro-bot--agent
  - fro-bot--dashboard
  - marcusrbrown--infra
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--systematic
  - marcusrbrown--dotfiles
---

# fro-bot/space-bus

`@fro.bot/space-bus` — a **workspace agent bus** for OpenCode. One control agent (an ordinary OpenCode TUI launched in this directory) sees and tasks dedicated per-project agents across the Fro Bot fleet, all riding a **single `opencode serve` instance via per-request directory routing**. A thin stdio MCP facade exposes the same four tools to Claude Desktop. It is the org-level "control board" that turns the fleet of managed repos ([[fro-bot--agent]], [[fro-bot--dashboard]], the control plane, [[marcusrbrown--infra]]) into delegation targets addressable from one seat.

## Overview

| Attribute        | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Created          | 2026-07-03 (survey 2026-07-03, HEAD `ad8eefe`)                                 |
| Last push        | 2026-07-03                                                                     |
| Description      | Workspace agent bus for OpenCode; control agent tasking per-project agents over the OpenCode server API, with an MCP facade for Claude Desktop |
| Language         | TypeScript (strict, ESM, `moduleResolution: bundler`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) |
| Runtime          | Bun (`@types/bun`; tools run in OpenCode's Bun runtime; `bun run` entry points) |
| Package manager  | Bun (`bun.lock`, `bun install`)                                               |
| Package          | `@fro.bot/space-bus` — **private, unpublished** (`"private": true`, `version: 0.0.0`) |
| License          | MIT                                                                            |
| Visibility       | Public                                                                         |
| Stars            | 0                                                                              |
| Topics           | (none set)                                                                     |
| Status           | MVP implemented and verified (Phases 0–2); dogfooded as a workspace-local tool before plugin conversion |

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

## The Four Tools

The tool surface is deliberately **exactly four** (a hard MVP constraint — no fifth tool):

| Tool          | Purpose                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `bus_roster`  | List projects on the bus and what's already running (check before tasking)                |
| `bus_task`    | Dispatch a task to one project (one project per task). Optional `sessionId` **steers an existing session** — answers a pending interactive question, else sends a follow-up prompt. Omitting `sessionId` starts a new session (the only way to start work in a sibling project) |
| `bus_status`  | Poll a session's progress; surfaces pending interactive questions (`pendingQuestion` / a `blocked:` line) so a blocked delegate isn't mistaken for one actively working |
| `bus_result`  | Summarize a session's outcome, including the aggregated diff and the delegated agent's conclusion |

The optional `sessionId` on `bus_task` is a design outcome of dogfooding: delegates block on interactive questions, so a steering path that isn't raw API was needed — it landed as a parameter on the existing tool rather than a fifth tool.

## Layout

All real logic lives in `src/core.ts`; the tool files and MCP server are **thin adapters** (~10–20 lines each: parse args, call core, format result). This keeps a later conversion to a distributable OpenCode plugin a packaging move, not a rewrite.

| Path                      | Role                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `workspace.json`          | Project manifest (server `baseUrl` + `projects[]` with name/path/description; paths assume repos under `~/src/github.com/`) |
| `AGENTS.md`               | Control-agent delegation policy (the `bus_*` tools are the only write path into siblings) |
| `src/core.ts`             | Manifest zod-parse (`~` expansion), typed OpenCode API calls, auth-header injection — all real logic |
| `src/format.ts`           | Formatting helpers for tool/MCP output                                        |
| `src/mcp.ts`              | stdio MCP adapter for Claude Desktop (`@modelcontextprotocol/sdk`), same four tools |
| `.opencode/tools/`        | OpenCode custom-tool adapters: `bus_roster.ts`, `bus_task.ts`, `bus_status.ts`, `bus_result.ts` |
| `scripts/smoke.ts`        | Phase 0 spike, kept permanently as a canary (`bun run smoke`) — directory-routing isolation against the live server |
| `docs/brainstorms/`       | Requirements (systematic `ce-brainstorm` format): MVP requirements + plugin-conversion requirements |
| `docs/plans/`             | `2026-07-02-001-feat-space-bus-plugin-conversion-plan.md`                      |
| `docs/solutions/`         | Documented solutions (`integration-issues/`), YAML frontmatter (`module`, `tags`, `problem_type`) |
| `HANDOFF.md`              | The build brief for the MVP (three phases, each with explicit verification)    |

The manifest currently binds four projects: `agent` ([[fro-bot--agent]]), `dashboard` ([[fro-bot--dashboard]]), `control-plane` (`fro-bot/.github`, this repo), and `infra` ([[marcusrbrown--infra]]).

## OpenCode Server API Notes (directory-routing quirks)

The README documents several hard-won facts about the server API surface the bus rides — useful reference for anyone building on directory-routed OpenCode servers (see [[opencode-plugins]]):

- **Session store is global across directory headers.** `GET /session/{id}` resolves regardless of which project directory header is sent. The bus attributes a session to its owning project via the session's own `directory` field, **not** the probe header. `GET /session` (list) and `/session/status` are directory-scoped.
- **Diff aggregation workaround.** Upstream opencode #30127 (v1.16.0) zeroes session-level diff summaries, so `GET /session/{id}/diff` always returns `[]`. Per-turn diffs on user messages (`GET /session/{id}/message`) stay intact and include untracked files, so `bus_status`/`bus_result` aggregate those instead (last turn wins per file, mirroring upstream PR #33444). **Harness builds ≥ `1.17.13+harness.ee55e157` carry #33444 directly** — `GET /session/{id}`'s `summary.diffs` is populated and serves diffs without per-turn aggregation (labeled `diffSource: "session"`); stock binaries leave it empty and fall through to per-turn aggregation. `GET /vcs/status` is a last-ditch repo-wide fallback (labeled *working tree*). This ties the bus's diff behavior to the [[fro-bot--agent]] `@fro.bot/harness` patched-OpenCode line.
- **Idle race.** `/session/status` can report a session idle a beat before its final message is queryable; `scripts/smoke.ts` absorbs this with a bounded retry on the message fetch.
- **Tool resolution.** `.opencode/tools/` resolves `@opencode-ai/plugin` from repo-root `node_modules` — no `.opencode/package.json` needed.

## Security Posture

- **Localhost only.** The bus talks only to `127.0.0.1:4096`.
- **HTTP Basic auth** injected per-request from `OPENCODE_SERVER_PASSWORD` (username `opencode`, or `OPENCODE_SERVER_USERNAME` override) when set.
- **Zero telemetry**; never logs credentials or prompt contents beyond strict debugging need — aligned with Marcus's no-unconsented-telemetry baseline.
- **Delegation boundary (per `AGENTS.md`):** the control agent's only write path into sibling projects is `bus_task`. It never edits, runs shell against, or commits to sibling directories directly. Files in the workspace directory itself it may edit normally. On task failure or missing target, it reports the error verbatim and stops — no silent retry.

## Dependencies

| Package                        | Version   | Purpose                                          |
| ------------------------------ | --------- | ------------------------------------------------ |
| `@opencode-ai/sdk`             | 1.17.13   | OpenCode server API client (lockstep with CLI)   |
| `@opencode-ai/plugin`          | 1.17.13   | Custom-tool `tool()` API (lockstep with CLI)     |
| `@modelcontextprotocol/sdk`    | 1.29.0    | stdio MCP server for the Claude Desktop facade   |
| `zod`                          | ^3.25.76  | Manifest + API-response boundary parsing         |
| `typescript`                   | ^5.8.0    | Typecheck (`tsc --noEmit`) — dev                 |
| `@types/bun`                   | ^1.0.0    | Bun runtime types — dev                          |

`@opencode-ai/*` are **pinned lockstep with the OpenCode CLI (1.17.13)** — upgrade both together. No other dependencies without explicit approval (an MVP constraint).

## Build Phases (from `HANDOFF.md`)

The MVP was built in three verified phases:

- **Phase 0 — Spike (`scripts/smoke.ts`):** prove cross-directory session creation, per-directory instance isolation (each session picks up its repo's own config/`AGENTS.md`), async prompt, and result retrieval against a live server. If isolation had failed, the fallback (N servers, `{baseUrl, directory}` per project) would have changed Phase 1's shape.
- **Phase 1 — Bus core + tools:** `src/core.ts` (`roster()`, `dispatch()`, `status()`, `result()` with discriminated-union results, parse-don't-validate at the API boundary via zod schemas derived from `GET /doc`) + the four `.opencode/tools/` adapters. R5 contract: the session ID is returned **before** the delegated session finishes.
- **Phase 2 — MCP facade:** `src/mcp.ts` registers the same four tools over stdio; verified via `@modelcontextprotocol/inspector`.

## Claude Desktop Integration

`src/mcp.ts` registers as a stdio MCP server. The config path **must be absolute** — Claude Desktop launches the server with no cwd context — and `opencode serve` / `harness serve` must already be running on `127.0.0.1:4096`:

```json
{
  "mcpServers": {
    "space-bus": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/space-bus/src/mcp.ts"]
    }
  }
}
```

## Fro Bot Workflow: Absent

**As of the 2026-07-03 survey there is no `.github/` directory, no workflows, and no Fro Bot agent workflow** in this repo. There is also no Probot Settings (`.github/settings.yml`) and no CI (typecheck/smoke run manually via `bun run`).

This is expected for a brand-new (created 2026-07-03), dogfooded, workspace-local tool — but it means the repo currently has no automated review, triage, or CodeQL/Scorecard coverage. A follow-up **draft PR proposing a Fro Bot workflow** (self-hosted `fro-bot.yaml` consuming [[fro-bot--agent]], plus `common-settings.yaml` inheritance) should be proposed separately. Note the meta-irony worth flagging on that PR: space-bus is itself an *agent-coordination surface* for the fleet, yet is not currently wired into the fleet's own agent automation.

## Relationship to the Fro Bot Ecosystem

- **[[fro-bot--agent]]** — space-bus rides the same OpenCode server line, and its diff-aggregation behavior is gated on `@fro.bot/harness` patched builds carrying upstream PR #33444. The `agent` repo is a first-class bus target.
- **[[fro-bot--dashboard]]** / **[[marcusrbrown--infra]]** — the other three manifest targets (dashboard, control-plane, infra). space-bus is the *tasking* plane; dashboard is the read-only *observation* plane — complementary operator surfaces.
- **[[marcusrbrown--opencode-copilot-delegate]]** — a sibling delegation pattern: that plugin delegates to Copilot CLI subprocesses; space-bus delegates to sibling-repo OpenCode agents over the server API. Both are "one agent tasks another," different transports.
- **[[opencode-plugins]]** — space-bus uses the `.opencode/tools/` custom-tool `tool()` API and is explicitly designed for a later conversion to a distributable OpenCode plugin (requirements + plan already drafted in `docs/`).

## Open Threads / To Re-confirm Next Survey

- Plugin conversion: `docs/brainstorms/2026-07-02-space-bus-plugin-conversion-requirements.md` + `docs/plans/2026-07-02-001-feat-space-bus-plugin-conversion-plan.md` exist — track whether the "packaging move, not rewrite" promise holds when it lands.
- No Fro Bot workflow / no CI / no Probot Settings — candidate for a follow-up draft PR.
- `@opencode-ai/*` and harness alignment (1.17.13) — verify pins stay lockstep as the harness base advances in [[fro-bot--agent]].

## Survey History

| Date       | HEAD      | Notes                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| 2026-07-03 | `ad8eefe` | Initial survey. New repo (created 2026-07-03), public, MIT, private-unpublished Bun/TS package. Four-tool workspace agent bus over one directory-routed `opencode serve`; MCP facade for Claude Desktop; MVP verified (Phases 0–2); plugin conversion drafted. **No Fro Bot workflow / no CI / no Probot Settings.** |
