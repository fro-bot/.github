---
type: repo
title: marcusrbrown/opencode-copilot-delegate
created: 2026-04-23
updated: 2026-04-23
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
tags: [opencode, plugin, copilot, delegation, subprocess, async, bun, typescript]
related: [marcusrbrown--dotfiles]
---

# marcusrbrown/opencode-copilot-delegate

OpenCode plugin that delegates tasks to GitHub Copilot CLI as background subprocesses with async completion notifications.

## Overview

An [OpenCode](https://opencode.ai) plugin registering three tools — `copilot_delegate`, `copilot_output`, `copilot_cancel` — that allow a parent OpenCode agent to spawn `copilot -p` as a background process, continue productive work, and receive a `<system-reminder>` notification when the subprocess completes. The async pattern mirrors OMO's `background_task` / `background_output` architecture.

**Status:** v0.1.0 scaffold — tool registrations exist in `src/index.ts` with TODO stubs; no runtime implementation yet. A comprehensive 11-task implementation plan exists in `docs/plans/2026-04-21-copilot-delegate-plugin.md`.

## Technology Stack

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict, ES2022 target, ESM modules) |
| Runtime/Build | Bun (both development and production build target) |
| Linting/Formatting | Biome 1.9.4 (NOT ESLint/Prettier — diverges from other Marcus repos using `@bfra.me/eslint-config`) |
| Versioning | Changesets (`@changesets/cli` v3.1.4 config, public access) |
| Package Manager | Bun (`bun.lock`, `bun install`) |
| Test Runner | `bun test` (matches OpenCode ecosystem) |
| Peer Dependencies | `@opencode-ai/plugin >=1.14.0`, `@opencode-ai/sdk >=1.14.0` |
| License | MIT © Marcus R. Brown |

## Architecture

### Plugin Tools (registered, stubs only)

- **`copilot_delegate`** — Spawn `copilot -p` as background subprocess. Returns `task_id` (`cpl_`-prefixed UUID) immediately. Args: `prompt` (required), `agent?`, `model?`, `add_dir?`, `allow_tool?`, `deny_tool?`.
- **`copilot_output`** — Retrieve structured result envelope. Args: `task_id` (required), `block?` (default `false`), `timeout_ms?` (default 30000, max 120000).
- **`copilot_cancel`** — Cancel running delegation with SIGTERM → SIGKILL escalation. Returns `{cancelled, was_running}`.

### Module Layout (planned, stubs exist)

```
src/
├── index.ts                 # Plugin entrypoint; registers three tools
├── tools/
│   ├── delegate.ts           # copilot_delegate (TODO)
│   ├── output.ts             # copilot_output (TODO)
│   └── cancel.ts             # copilot_cancel (TODO)
├── runtime/
│   ├── task-registry.ts      # In-memory Map<task_id, TaskState> (TODO)
│   ├── subprocess.ts         # spawn + line-buffered stdout parsing (TODO)
│   ├── jsonl-parser.ts       # JSONL event → ParsedEvent accumulator (TODO)
│   ├── notify.ts             # client.session.promptAsync wrapper (TODO)
│   └── envelope.ts           # turn state → structured envelope (TODO)
├── discovery/
│   ├── agents.ts             # Built-in + user + repo agent merge (TODO)
│   └── description.ts        # Build copilot_delegate description string (TODO)
└── lib/
    ├── ansi.ts               # Strip ANSI escapes (TODO)
    └── kill-tree.ts           # Cross-platform process tree kill (TODO)
```

All `src/` files currently contain `// TODO: implement in T{n}` stubs referencing the implementation plan.

### Async Notification Pattern

When a Copilot subprocess completes, the plugin calls `client.session.promptAsync()` to inject a `<system-reminder>` block into the parent session — mirroring OMO's pattern. The `noReply` flag is set based on in-flight task count: `true` while other tasks are running (silent injection), `false` when all complete or on failure (forces a parent turn).

### Auth Precedence

```
COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN > ~/.copilot/auth
```

The plugin logs the resolved auth source (not the token value) at delegation start.

### Scope Boundary

Task state is in-memory within a single OpenCode process. `copilot_output` from a different process returns `{ status: 'unknown', error: 'task_id not found in this OpenCode process' }`. Cross-process sharing is deferred to a future version.

## CI and Automation

**No CI workflows on main branch yet.** Two open PRs are pending:

| PR | Title | Status |
|----|-------|--------|
| #2 | `chore(ci): add Fro Bot agent workflow with single-issue autohealing` | Open |
| #3 | `chore: feat(deps): configure Renovate` | Open |

### Fro Bot Integration (PR #2, not yet merged)

- `fro-bot.yaml` — PR review (structured verdict, plugin-specific focus areas: TypeScript type safety, OpenCode API contracts, subprocess safety, tool output safety, changeset hygiene) + daily autohealing (16:00 UTC, perpetual single-issue strategy adapted from `marcusrbrown/containers`) + mention-based trigger + workflow_dispatch
- Agent: `fro-bot/agent@v0.41.0` (SHA `fc1387ec5c25afed73b11b8b26c482b90b3ad9cd`)
- Required secrets: `FRO_BOT_PAT`, `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`

### Renovate Configuration (PR #3, not yet merged)

- Extends `bfra-me/.github` Renovate reusable workflow
- Onboarding PR includes `@bfra-me` config presets: dependency dashboard, semantic commits, monorepo groupings, pin by digest

## Design Documentation

Comprehensive implementation plan at `docs/plans/2026-04-21-copilot-delegate-plugin.md` (≈3000 words):

- 11 ordered tasks from repo bootstrap through publish, including skill update and CI
- Verified research on OpenCode plugin API, OMO async notification pattern, `opencode-pty` reference implementation
- Tool I/O contracts with detailed schema for all three tools
- TaskState lifecycle and event flow diagrams
- Known limitations (orphaned subprocesses if OpenCode crashes, no PID-file reaper until v1.x)
- Privacy posture: zero telemetry, token values never logged

## Relationships

- **[[marcusrbrown--dotfiles]]** — The `copilot-cli` skill in `~/.agents/skills/copilot-cli/SKILL.md` will be updated to branch on plugin presence (plan task T10). Also shares the OpenCode agent configuration ecosystem.
- **[[opencode-plugins]]** — First Marcus repo building an OpenCode plugin; establishes patterns for plugin development (peer deps, Bun build, async notification pattern).

## Divergence from Marcus Ecosystem Norms

This repo intentionally diverges from patterns used in other Marcus repos:

| Aspect | This repo | Other Marcus repos |
|--------|-----------|-------------------|
| Linting/Formatting | Biome 1.9.4 | ESLint + Prettier (`@bfra.me/eslint-config`) |
| Package Manager | Bun | pnpm (most repos) or Bun (infra) |
| CI | None yet (PR pending) | Full quality gates |
| Fro Bot | None yet (PR pending) | Active in most repos |
| Test Framework | `bun test` | Vitest (most repos) |

These divergences are appropriate for an OpenCode plugin — Bun is the OpenCode runtime, Biome is lighter than ESLint+Prettier for a small plugin, and `bun test` matches the ecosystem convention.

## Known Limitations (v0.1.x)

- **Orphaned subprocesses:** If OpenCode crashes mid-delegation, the `copilot` subprocess becomes orphaned. PID-file reaper planned for v1.x.
- **Single-process scope:** Task state is in-memory only; cross-process sharing requires future sqlite registry + IPC.
- **No streaming returns:** Tool `execute` returns synchronously; streaming is an unverified runtime capability.
- **Auth shim:** No sanitization of `GH_TOKEN` etc. — out of scope for v1.
