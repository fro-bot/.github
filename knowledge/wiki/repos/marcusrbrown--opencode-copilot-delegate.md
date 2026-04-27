---
type: repo
title: marcusrbrown/opencode-copilot-delegate
created: 2026-04-23
updated: 2026-04-27
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 02cac9c024744a290c9257d5c740d2a83e2c8e42
    accessed: 2026-04-27
tags: [opencode, plugin, copilot, delegation, subprocess, async, bun, typescript, biome, changesets]
related: [marcusrbrown--dotfiles, marcusrbrown--systematic]
---

# marcusrbrown/opencode-copilot-delegate

OpenCode plugin that delegates tasks to GitHub Copilot CLI as background subprocesses with async completion notifications.

## Overview

An [OpenCode](https://opencode.ai) plugin registering three tools — `copilot_delegate`, `copilot_output`, `copilot_cancel` — that allow a parent OpenCode agent to spawn `copilot -p` as a background process, continue productive work, and receive a `<system-reminder>` notification when the subprocess completes. The async pattern mirrors OMO's `background_task` / `background_output` architecture.

**Status (2026-04-27):** v0.1.0 with full implementation. Source files contain working runtime code across all modules (tools, runtime, discovery, lib). The implementation plan from `docs/plans/` has been executed. Published to npm as `opencode-copilot-delegate`. CI, Fro Bot, and Renovate are all active on `main`.

> **Contradiction with prior survey (2026-04-23):** The initial survey recorded all `src/` files as "TODO stubs with implementation plan." As of SHA `02cac9c`, the source tree is fully implemented with working code across all modules. The implementation plan tasks have been completed.

## Technology Stack

| Aspect | Detail |
|--------|--------|
| Language | TypeScript 6.0.3 (strict, ES2022 target, ESM modules) |
| Runtime/Build | Bun 1.3.13 (both development and production build target) |
| Linting/Formatting | Biome 2.4.13 (NOT ESLint/Prettier — diverges from other Marcus repos using `@bfra.me/eslint-config`) |
| Versioning | Changesets (`@changesets/cli` v2.31.0, public access) |
| Package Manager | Bun (`bun.lock`, `bun install`) |
| Test Runner | `bun test` (matches OpenCode ecosystem) |
| Peer Dependencies | `@opencode-ai/plugin >=1.14.0`, `@opencode-ai/sdk >=1.14.0` (dev pins: ^1.14.19) |
| Runtime Dependency | `fkill` 10.0.3 (cross-platform process tree kill) |
| License | MIT |
| Node Engine | >=24 |

### Mise Tooling

`mise.toml` pins: Bun 1.3.13, `npm:opencode-ai` 1.14.27, `npm:@github/copilot` 1.0.36.

## Architecture

### Plugin Tools

- **`copilot_delegate`** — Spawn `copilot -p` as background subprocess. Returns `task_id` (`cpl_`-prefixed UUID) immediately. Args: `prompt` (required), `agent?`, `model?`, `add_dir?`, `allow_tool?`, `deny_tool?`.
- **`copilot_output`** — Retrieve structured result envelope. Args: `task_id` (required), `block?` (default `false`), `timeout_ms?` (default 30000, max 120000). Returns envelope with `status`, `final_message`, `tokens`, `tool_calls_summary`.
- **`copilot_cancel`** — Cancel running delegation with SIGTERM → SIGKILL escalation. Returns `{cancelled, was_running}`.

### Module Layout

```
src/
├── index.ts              # Plugin entrypoint — wires tools to runtime
├── tools/
│   ├── delegate.ts        # copilot_delegate tool
│   ├── output.ts          # copilot_output tool
│   └── cancel.ts          # copilot_cancel tool
├── runtime/
│   ├── subprocess.ts      # Spawns copilot CLI, streams JSONL stdout
│   ├── task-registry.ts   # In-memory task state (create/get/update/delete/cleanup)
│   ├── jsonl-parser.ts    # Single-line JSONL parser for Copilot CLI output
│   ├── envelope.ts        # Builds structured output envelopes from parsed events
│   └── notify.ts          # Injects completion notifications into OpenCode sessions
├── discovery/
│   ├── agents.ts          # Discovers .agent.md files from Copilot agent directories
│   └── description.ts    # Builds copilot_delegate tool description from discovered agents
└── lib/
    ├── ansi.ts            # Strip ANSI escapes
    └── kill-tree.ts       # Cross-platform process tree kill via fkill
```

### Test Suite

```
tests/
├── jsonl-parser.test.ts   # Parser unit tests
├── envelope.test.ts       # Envelope builder tests
├── subprocess.test.ts     # Subprocess wrapper tests (fake copilot binary)
├── agents.test.ts         # Agent discovery tests (temp fixture dirs)
├── notify.test.ts         # Notification injection tests
├── tools.test.ts          # Tool integration tests (full plugin lifecycle)
├── fixtures/
│   └── jsonl/             # Real Copilot CLI JSONL captures (PII-scrubbed)
└── integration/           # Integration tests (not yet in CI, tracked in #38)
```

### Design Decisions

- **Single-line JSONL parser:** `parseJsonlLine` handles one line at a time, returns `{ type: 'unknown' }` for malformed input. Stream-level multiline accumulation belongs in the subprocess wrapper.
- **Task IDs:** Prefixed with `cpl_` to distinguish from OpenCode-native task IDs.
- **Process cleanup:** Uses `fkill` with `{ force: false, forceAfterTimeout: 2000, waitForExit: 5000 }` and `.catch()` guards on all `killProcessTree` calls. On macOS, `tree: true` is Windows-only, so kill targets the entire process group via `fkill(-pid, ...)` and subprocess is spawned with `detached: true`.
- **Notification safety:** In-flight counter decremented synchronously (before any `await`) in close handlers; counter map entries deleted at zero to prevent memory leaks over long-lived sessions.
- **Agent discovery:** Builtin agents (bundled with Copilot CLI) cannot be overridden by user or repo agents.
- **Structured errors:** Tools return `{ error: string }` objects, never throw exceptions.

### Async Notification Pattern

When a Copilot subprocess completes, the plugin calls `client.session.promptAsync()` to inject a `<system-reminder>` block into the parent session. The `noReply` flag is set based on in-flight task count: `true` while other tasks are running (silent injection), `false` when all complete or on failure (forces a parent turn).

### Auth Precedence

```
COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN > ~/.copilot/auth
```

The plugin logs the resolved auth source (not the token value) at delegation start.

### Scope Boundary

Task state is in-memory within a single OpenCode process. `copilot_output` from a different process returns `{ status: 'unknown', error: 'task_id not found in this OpenCode process' }`. Cross-process sharing is deferred to a future version.

## CI and Automation

Six workflows on `main`:

| Workflow | File | Purpose |
|----------|------|---------|
| CI | `ci.yaml` | Lint (Biome), typecheck (tsc --noEmit), build (bun build + tsc declarations), unit tests (bun test) |
| Fro Bot | `fro-bot.yaml` | PR review + daily autohealing (16:00 UTC) + @fro-bot mentions + dispatch |
| Release | `release.yaml` | Changesets version + publish to npm (triggered on CI success on main, or dispatch) |
| Renovate | `renovate.yaml` | Automated dependency updates via `bfra-me/.github` reusable workflow |
| Update Repo Settings | `update-repo-settings.yaml` | Probot settings sync |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | GitHub Copilot coding agent bootstrap |

### Fro Bot Integration

- **Agent:** `fro-bot/agent@v0.42.2` (SHA `94d8a156570d68d2461ab496b589e63bdcd6ba84`)
- **PR review:** Structured verdict format (PASS/CONDITIONAL/REJECT) with plugin-specific focus areas: TypeScript type safety, OpenCode API contracts, subprocess safety, tool output safety, changeset hygiene
- **Daily autohealing (16:00 UTC):** 4-category sweep: errored PRs, security, health & maintenance, developer experience. Single perpetual issue ("Daily Autohealing Report") strategy.
- **Required secrets:** `FRO_BOT_PAT`, `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`
- **Required variables:** `FRO_BOT_MODEL`
- **Concurrency:** `fro-bot-{issue|pr|discussion|run_id}`, no cancel-in-progress

### Renovate Configuration

- Extends `marcusrbrown/renovate-config#4.5.8`
- LTS-only Node.js constraints for `@types/node` and GitHub Actions node versions
- `@opencode-ai/*` packages use `build` semantic commit type
- Post-upgrade tasks: `bun install`, `bun run fix`, `bun run build`

### Branch Protection

Required status checks on `main`: `Fro Bot`, `Lint, typecheck, build, unit tests`, `Renovate / Renovate`. Enforces admins. Linear history required. No required PR reviews.

### Probot Settings

Extends `fro-bot/.github:common-settings.yaml`. Topics: `opencode, plugin, copilot, github-copilot, typescript, bun`. Homepage: npm package page.

### Release Pipeline

Uses Changesets via `changesets/action@v1.7.0`. GitHub App token for authenticated pushes (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Bun builds then Node.js publishes with npm provenance. Git user set from app slug.

## Open Issues

| # | Title | Notes |
|---|-------|-------|
| 38 | Re-add integration tests to CI | Integration test directory exists but not wired into CI |
| 26 | Daily Autohealing Report | Perpetual issue managed by Fro Bot |
| 25 | Dependency Dashboard | Renovate tracking issue |

## Design Documentation

- Implementation plan at `docs/plans/2026-04-21-copilot-delegate-plugin.md` — 11 ordered tasks from repo bootstrap through publish
- Solutions directory at `docs/solutions/` — documented solutions to past problems with YAML frontmatter (module, tags, problem_type)
- AGENTS.md — comprehensive agent guide covering architecture, coding standards, testing, commits, security constraints

## Coding Standards (from AGENTS.md)

- TypeScript strict mode, no `as any` / `@ts-ignore` / `@ts-expect-error`
- Prefer `satisfies` over type annotations for inference
- Discriminated unions over optional properties
- ESM imports only
- Biome: 2-space indent, single quotes, no semicolons (ASI)
- Tests: arrange-act-assert, real filesystem fixtures, no mocking libraries, deterministic (no wall-clock timing)
- Commits: conventional format with scopes (`runtime`, `tools`, `discovery`, `ci`, `docs`)

## Relationships

- **[[marcusrbrown--dotfiles]]** — The `copilot-cli` skill in `~/.agents/skills/copilot-cli/SKILL.md` branches on plugin presence. Also shares the OpenCode agent configuration ecosystem.
- **[[marcusrbrown--systematic]]** — Sibling OpenCode plugin. Both use Bun + Biome stack. Systematic is consumed by dotfiles; copilot-delegate is a complementary delegation tool.
- **[[opencode-plugins]]** — First Marcus repo building an OpenCode plugin; establishes patterns for plugin development (peer deps, Bun build, async notification pattern).

## Divergence from Marcus Ecosystem Norms

| Aspect | This repo | Other Marcus repos |
|--------|-----------|-------------------|
| Linting/Formatting | Biome 2.4.13 | ESLint + Prettier (`@bfra.me/eslint-config`) |
| Package Manager | Bun | pnpm (most repos) or Bun (infra) |
| Test Framework | `bun test` | Vitest (most repos) |
| CI Build | `bun build` + `tsc --emitDeclarationOnly` | Varies (Vite, tsup, etc.) |
| Shared Config | None (standalone Biome) | `@bfra.me/eslint-config`, `@bfra.me/tsconfig` |

These divergences are appropriate for an OpenCode plugin — Bun is the OpenCode runtime, Biome is lighter than ESLint+Prettier for a small plugin, and `bun test` matches the ecosystem convention. Same pattern as [[marcusrbrown--systematic]].

## Known Limitations (v0.1.x)

- **Orphaned subprocesses:** If OpenCode crashes mid-delegation, the `copilot` subprocess becomes orphaned. PID-file reaper planned for v1.x.
- **Prompt visibility in `ps`:** Copilot CLI accepts prompt as command-line argument, exposing full prompt text in `ps` output. Upstream limitation — avoid delegating prompts containing secrets or PII.
- **No subprocess lifetime cap:** Hung `copilot` subprocess stays as `running` indefinitely. Cancel manually via `copilot_cancel`. Configurable timeout planned for v1.x.
- **Single-process scope:** Task state is in-memory only; cross-process sharing requires future sqlite registry + IPC.
- **Integration tests not in CI:** Test directory exists but tracked as issue #38.

## Survey History

| Date | SHA | Key delta |
|------|-----|-----------|
| 2026-04-23 | `bea3f57` | Initial survey — v0.1.0 scaffold with TODO stubs, no CI/Fro Bot/Renovate on main |
| 2026-04-27 | `02cac9c` | Implementation complete, CI active, Fro Bot v0.42.2, Renovate live, 6 workflows, `fkill` dependency added, Biome 1.9.4→2.4.13, TypeScript 6.0.3, 3 open issues |
