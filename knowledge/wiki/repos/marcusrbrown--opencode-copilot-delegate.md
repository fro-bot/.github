---
type: repo
title: marcusrbrown/opencode-copilot-delegate
created: 2026-04-23
updated: 2026-06-03
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 02cac9c024744a290c9257d5c740d2a83e2c8e42
    accessed: 2026-04-27
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 2744ce7fc07660baa4f17bfff3656141888261cf
    accessed: 2026-05-21
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: f9aaeead2a756f48d7cd8da0018ddea2cfbfea98
    accessed: 2026-06-03
tags: [opencode, plugin, copilot, delegation, subprocess, async, bun, typescript, biome, changesets, tui, rpc, orphan-reaper]
related: [marcusrbrown--dotfiles, marcusrbrown--systematic]
---

# marcusrbrown/opencode-copilot-delegate

OpenCode plugin that delegates tasks to GitHub Copilot CLI as background subprocesses with async completion notifications.

## Overview

An [OpenCode](https://opencode.ai) plugin registering three tools — `copilot_delegate`, `copilot_output`, `copilot_cancel` — that allow a parent OpenCode agent to spawn `copilot -p` as a background process, continue productive work, and receive a `<system-reminder>` notification when the subprocess completes. The async pattern mirrors OMO's `background_task` / `background_output` architecture.

**Status (2026-06-03):** v0.12.0 on npm — unchanged from the prior survey. The window since 2026-05-21 (SHA `2744ce7` → `f9aaeea`) is pure dependency-update churn driven by Renovate plus Fro Bot agent bumps: no new release, no source-tree changes, no new tools. The substantive deltas are toolchain pins (Biome 2.4.15 → 2.4.16, `@github/copilot` CLI 1.0.48 → 1.0.56, `opencode-ai`/`@opencode-ai/plugin` dev pin 1.15.4 → 1.15.13, `@types/node` 24.12.4) and the Fro Bot agent advancing **v0.44.3 → v0.51.0** (through v0.46.0/v0.48.0/v0.48.1/v0.50.0). The architectural narrative below remains current as of v0.12.0.

**Status (2026-05-21):** v0.12.0 on npm. The plugin has hardened substantially since the initial v0.1.0 scaffold — added an orphan-subprocess reaper with PID-file identity gate (v0.2.0), streaming worker pool for reap probes (v0.3.0), configurable timeouts with cooperative cancellation (v0.4.0), per-parameter tool description enrichment (v0.5.0–v0.7.0), an opt-in `/copilot-status` TUI half (v0.10.0), per-process plugin-factory singleton (v0.8.0, refined in v0.11.0), and a fourth `copilot_resume` tool (v0.12.0). The tool catalog is now 3 → 4. Source tree has expanded from the original 4 module groups to include `src/tui/` (Solid + opentui TUI entry) and a localhost RPC layer (`runtime/rpc-*.ts`, `tui/rpc-client.ts`). Test count has grown from ~6 to 21 unit test files plus an integration suite.

> **Prior contradiction (resolved):** The 2026-04-23 survey recorded all `src/` files as "TODO stubs with implementation plan." As of SHA `02cac9c` (2026-04-27) the source tree was fully implemented, and the 2026-05-21 survey confirms the plugin has shipped 11 minor releases on top of that foundation.

## Technology Stack

| Aspect | Detail |
|--------|--------|
| Language | TypeScript 6.0.3 (strict, ES2022 target, ESM modules) |
| Runtime/Build | Bun 1.3.14 (both development and production build target) |
| Linting/Formatting | Biome 2.4.16 (NOT ESLint/Prettier — diverges from other Marcus repos using `@bfra.me/eslint-config`) |
| Versioning | Changesets (`@changesets/cli` v2.31.0, OIDC trusted publishing to npm) |
| Package Manager | Bun (`bun.lock`, `bun install`) |
| Test Runner | `bun test` — separate scripts for unit, TUI (with `--preload @opentui/solid/preload`), and integration |
| Peer Dependencies | `@opencode-ai/plugin >=1.14.41` (narrowed from `>=1.14.0` in v0.12.0; dev pin: 1.15.13 as of 2026-06-03, up from 1.15.4). `@opencode-ai/sdk` peer dep removed in v0.6.0 — it was never imported. |
| Runtime Dependencies | `fkill` 10.0.3 (cross-platform process tree kill); `@opentui/core` + `@opentui/solid` 0.2.6 (TUI); `solid-js` 1.9.13 (TUI reactive layer); `zod` ^4.3.0 (pinned with `overrides` to dodge TS2883 from dual-zod trees, added v0.7.0) |
| License | MIT |
| Node Engine | >=24 |
| Package exports | `.` (server plugin), `./plugin` (alias), `./tui` (opt-in TUI entry). `oc-plugin: ["server", "tui"]` declares both halves to OpenCode. |
| Build target split | `src/index.ts` builds with `target: 'node'` (plain-Node ESM loadable, gated by CI export-shape assertion); `src/tui/index.tsx` builds with `target: 'bun'` because `@opentui/solid` is Bun-specific. Both produced by `scripts/build.ts` + `tsc --emitDeclarationOnly`. |

### Mise Tooling

`mise.toml` pins (2026-06-03): Bun 1.3.14, `npm:opencode-ai` 1.15.13, `npm:@github/copilot` 1.0.56. (Prior survey: opencode-ai 1.15.4, copilot 1.0.48.)

## Architecture

### Plugin Tools

- **`copilot_delegate`** — Spawn `copilot -p` as background subprocess. Returns `task_id` (`cpl_`-prefixed UUID) immediately. Args: `prompt` (required), `agent?`, `model?`, `add_dir?`, `allow_tool?`, `deny_tool?`.
- **`copilot_output`** — Retrieve structured result envelope. Args: `task_id` (required), `block?` (default `false`), `timeout_ms?` (default 30000, max 120000). Envelope includes `status`, `final_message`, `tokens`, `tool_calls_summary`, `origin` (`'spawn' | 'resume' | 'connect'`), and `copilot_session_id` (the upstream Copilot session UUID parsed from the JSONL `result` event, omitted when never emitted).
- **`copilot_cancel`** — Cancel running delegation with SIGTERM → SIGKILL escalation. Returns `{cancelled, was_running}`.
- **`copilot_resume`** *(added v0.12.0)* — Resume a prior Copilot session by ID, name, or prefix via `copilot --resume=<target>`. UUID targets are validated against the local Copilot session store before spawn; missing sessions return a structured error without invoking the CLI. When a prior plugin task's session ID matches the target, that task's `--add-dir` workspace set is reused if the caller omits `addDirs`. CLI `No session, task, or name matched` errors are normalized to `Session not found`. All `cwd` and `addDirs` are validated against allowed roots before spawn; argv-injection-shaped values are rejected. Completion surfaces a `[COPILOT RESUME COMPLETED]` header (vs `[COPILOT DELEGATION COMPLETED]` for spawn).

### Module Layout

```
src/
├── index.ts                    # Plugin entrypoint — Node-loadable ESM, exports `default` only (CI-gated)
├── tools/
│   ├── delegate.ts             # copilot_delegate tool
│   ├── output.ts               # copilot_output tool
│   ├── cancel.ts               # copilot_cancel tool
│   └── resume.ts               # copilot_resume tool (v0.12.0)
├── runtime/
│   ├── subprocess.ts           # Spawns copilot CLI, streams JSONL stdout
│   ├── task-registry.ts        # In-memory task state (create/get/update/delete/cleanup)
│   ├── task-status.ts          # setStatus lifecycle helper — terminal-state-only transitions
│   ├── jsonl-parser.ts         # Single-line JSONL parser for Copilot CLI output
│   ├── envelope.ts             # Builds structured output envelopes from parsed events
│   ├── notify.ts               # Completion notifications + attachCompletionPipeline helper
│   ├── pid-file.ts             # Per-instance PID file (write/read/truncate/unlink), serialized per file
│   ├── orphan-reaper.ts        # Plugin-init reaper for foreign-instance subprocess orphans
│   ├── continuity-checks.ts    # Process-identity + liveness probes for reaper
│   ├── continuity-validation.ts# Validation layer over continuity-checks results
│   ├── plugin-singleton.ts     # Per-process factory singleton (globalThis Symbol)
│   ├── rpc-server.ts           # Localhost-only RPC listener for TUI
│   └── rpc-contract.ts         # Shared TS contract for RPC requests/responses
├── discovery/
│   ├── agents.ts               # Discovers .agent.md files (user + repo only; no builtin list)
│   └── description.ts          # Builds copilot_delegate description from discovered agents
├── lib/
│   ├── ansi.ts                 # Strip ANSI escapes
│   ├── errno.ts                # POSIX errno classification helpers
│   ├── kill-tree.ts            # Cross-platform process-tree kill via fkill + process-group probe
│   ├── normalize-tool-arg-schemas.ts # zod _zod.toJSONSchema override (host-zod compat shim)
│   └── rpc-cleanup.ts          # wireRpcServerCleanup (extracted from index.ts in v0.12.0)
└── tui/
    ├── index.tsx               # TUI plugin entry (Solid + opentui)
    ├── rpc-client.ts           # Client for the server half's RPC listener
    ├── components/             # SolidJS components for /copilot-status
    └── __tests__/              # TUI tests (require @opentui/solid/preload)
```

### Test Suite

```
tests/
├── jsonl-parser.test.ts         # JSONL parser
├── envelope.test.ts             # Envelope builder
├── subprocess.test.ts           # Subprocess wrapper (fake copilot binary)
├── agents.test.ts               # Agent discovery (temp fixture dirs)
├── notify.test.ts               # Notification injection
├── tools.test.ts                # End-to-end tool integration
├── resume.test.ts               # copilot_resume tool (v0.12.0)
├── task-registry.test.ts        # Registry lifecycle
├── task-status.test.ts          # setStatus terminal-state invariants
├── cancel-helper.test.ts        # Cancel helper
├── pid-file.test.ts             # PID file write/read/truncate/unlink + serialize
├── orphan-reaper.test.ts        # Reaper with abort, timeouts, identity gate
├── continuity-checks.test.ts    # comm/lstart probes
├── continuity-validation.test.ts# Validation layer
├── plugin-singleton.test.ts     # Per-process singleton + duplicate-invocation warning
├── rpc-server.test.ts           # RPC listener
├── rpc-contract.test.ts         # RPC contract shape
├── rpc-cleanup.test.ts          # wireRpcServerCleanup
├── normalize-tool-arg-schemas.test.ts # zod schema override
├── package-exports.test.ts      # Asserts dist/index.js exports only `default` (matches CI gate)
├── index.test.ts                # Plugin entry smoke
├── fixtures/jsonl/              # Real Copilot CLI JSONL captures (PII-scrubbed)
└── integration/                 # LLM-driven end-to-end via `opencode run` (gated on GH_TOKEN/COPILOT_PAT; not in CI per #38)
```

### Design Decisions

- **Single-line JSONL parser:** `parseJsonlLine` handles one line at a time, returns `{ type: 'unknown' }` for malformed input. Stream-level multiline accumulation belongs in the subprocess wrapper.
- **Task IDs:** Prefixed with `cpl_` to distinguish from OpenCode-native task IDs.
- **Process cleanup:** Uses `fkill` with `{ force: false, forceAfterTimeout: 2000, waitForExit: 5000 }` and `.catch()` guards on all `killProcessTree` calls. On macOS, `tree: true` is Windows-only, so kill targets the entire process group via `fkill(-pid, ...)` and subprocess is spawned with `detached: true`. Since v0.9.0 `killProcessTree` classifies fkill failures by probing the process *group* (`process.kill(-pid, 0)`); ESRCH is suppressed as "already gone," other states preserve the original throw.
- **Notification safety:** In-flight counter decremented synchronously (before any `await`) in close handlers; counter map entries deleted at zero to prevent memory leaks over long-lived sessions. Since v0.9.0 the fallback `client.app.log` call is wrapped in try/catch and uses the structured SDK shape so synchronous SDK throws can't escape the documented "never throws" contract.
- **Agent discovery (rewritten v0.5.0):** No more `BUILTIN_AGENTS` constant — passing one of the legacy six names (`default`, `explore`, `task`, `general-purpose`, `code-review`, `research`) made the standalone `@github/copilot` CLI fail at spawn with `No such agent`. `discoverAgents` now returns user agents (filtered by repo override) followed by repo agents; `Agent.source` is `'user' | 'repo'`. `buildDescription` emits an actionable hint pointing at `~/.copilot/agents` and `.github/agents` when discovery is empty.
- **Structured errors:** Tools return `{ error: string }` objects, never throw exceptions.
- **`setStatus` lifecycle:** Centralizes terminal-status mutations and is idempotent on terminal state. Since v0.8.0 terminal → non-terminal transitions are explicitly forbidden — once a task reaches `complete`, `failed`, or `cancelled`, every subsequent `setStatus` call is a no-op (closes a resurrection path no caller exercised but the prior contract permitted).
- **Origin discriminator (v0.12.0):** `TaskState`, `OutputEnvelope`, and `EnvelopeInput` carry `origin: 'spawn' | 'resume' | 'connect'`. `spawn`-origin tasks (from `copilot_delegate`) surface `[COPILOT DELEGATION COMPLETED]`; `resume`-origin tasks (from `copilot_resume`) surface `[COPILOT RESUME COMPLETED]`. `connect` is wired for forward compatibility but unused today.
- **Per-parameter description survival (v0.7.0):** OpenCode's tool catalog renders plugin schemas via the host's bundled zod, which lives in a different module instance from the plugin's zod and cannot see plugin-side `.describe()` metadata. Each tool arg schema is patched with a `_zod.toJSONSchema` override (`src/lib/normalize-tool-arg-schemas.ts`) that delegates serialization back to the plugin-local zod — same fix shipped by `@cortexkit/opencode-magic-context` and `@cortexkit/aft-opencode`. `zod` is pinned as a direct dependency with a matching `overrides` entry to keep this repo's tree on a single zod version (resolves TS2883 from two zod trees coexisting at build time).

### Orphan Reaper (added v0.2.0, hardened through v0.10.0)

- **PID file per instance:** `<XDG_STATE_HOME>/opencode-copilot-delegate/orphans/<plugin-pid>.pids` lists each spawned subprocess; entry removed on every terminal status transition.
- **Identity gate:** Reap requires a live process's `comm` (kernel-tracked executable name from `ps -o comm=`) AND `lstart` (start-time string) to match values recorded at spawn time. Combined with a spawner-liveness probe (`process.kill(<plugin-pid>, 0)`), this rules out both PID reuse of an unrelated process and cross-instance kill of a live foreign instance's children.
- **Streaming worker pool (v0.3.0):** Up to `MAX_CONCURRENT_PROBES = 5` workers drain a shared queue independently — a slow `ps` probe blocks only its own worker. Replaces the prior chunked `Promise.all` whose worst case stalled four siblings behind one slow probe.
- **Combined `ps` query (v0.3.0):** `getPidIdentity(pid)` runs `ps -p <pid> -o comm=,lstart=` in a single fork/exec, halving cost and providing an atomic kernel snapshot of both identity legs.
- **Configurable timeouts (v0.4.0):** Per-probe `ps` timeout (default 1000ms; warns on degradation) and overall `reapOrphans` timeout (default 15000ms) with cooperative `AbortSignal` cancellation. In-flight workers cooperate by skipping their next mutating step on abort, so dangerous side effects can't fire after the call returns. `ReapResult.timedOut: true` flags a timeout-aborted reap; count fields go to zero placeholders, not partial-progress accounting.
- **Same-user symlink hardening (v0.9.0):** PID file open and truncate paths use `O_NOFOLLOW`; PID file parent directories are rejected before orphan reaping, cleanup, and plugin init state-directory creation. Defends against attacker-controlled symlinks under same-UID write access.
- **Race-safe cleanup (v0.8.0):** `truncatePidFile(filePath)` and `unlinkPidFile(filePath)` route through the per-file `serializeWrite` lock. ENOENT silently swallowed. `cleanupAfterReap` uses these helpers so concurrent reap + task spawn is automatically race-safe.
- **Logging prefix:** Since v0.9.0 all runtime warnings share the `[copilot-delegate]` prefix across `kill-tree`, `orphan-reaper`, `pid-file`, `task-registry`, and `task-status`, making operator log filtering predictable.

### Plugin Factory Singleton (added v0.8.0, refined in v0.11.0 and v0.12.0)

When a user lists `opencode-copilot-delegate` in both a user-level (`~/.config/opencode/opencode.json`) and project-level `opencode.json`, the OpenCode host previously invoked the factory once per source — evaluating the module fresh, running orphan reaping, and registering its own copy of the three tools. The factory now resolves at most once per process via a `globalThis` Symbol singleton (`Symbol.for('opencode-copilot-delegate.singleton.v1')`):

- **First invocation:** Runs `doInit` once, returns the real hooks.
- **Duplicate invocation (same PID, v0.11.0):** Returns **empty hooks** (`{}`) instead of the cached real hooks. The host's per-source iteration finds nothing to register a second time, eliminating the double-registration that previously caused each tool to appear twice in the LLM-visible catalog under dual-source configs. Heavy init (agent discovery, orphan reaping, RPC server startup) still runs at most once per process. Emits a one-time `console.warn` + `client.app.log` warning so duplicate-config situations stay observable.
- **Why this diverges from Systematic's PR #352 fix:** Systematic switched to per-load registration. This plugin keeps `plugInOnce` because `doInit` binds a TCP port (RPC server) and writes a PID file — running `doInit` twice in the same process would race on those exclusive resources. The divergence is documented inline in `plugin-singleton.ts` and `rpc-cleanup.ts` with cross-references to the Systematic PR.

### Public-Surface Hardening (v0.12.0)

OpenCode's plugin loader treats every named export from a plugin entry as a separate plugin factory and invokes it with `undefined` input. Systematic took hours of downtime from this contract in v2.5.0 and v2.12.1; this plugin institutionalized the fix:

- `wireRpcServerCleanup` moved out of `src/index.ts` into `src/lib/rpc-cleanup.ts`; the entry re-imports it internally so only `default` is exported.
- Plugin entry now builds with `target: 'node'` (was `'bun'`) so `dist/index.js` loads under plain Node ESM. TUI entry stays on `target: 'bun'` because `@opentui/solid` is Bun-specific.
- CI gate between `Build` and `Unit tests` runs `node --input-type=module -e "import('./dist/index.js').then(m => …)"` and exits non-zero if anything other than `default` is exported or `default` is not a function. `tests/package-exports.test.ts` mirrors the assertion locally. Failure message references the Systematic regressions so future contributors find the rationale.

### TUI Half (added v0.10.0)

- **Opt-in second entry.** `package.json` declares `oc-plugin: ["server", "tui"]` and exposes `./tui` as a separate export. Existing server-only installs continue to register only the three tools; `/copilot-status` only appears when the TUI half is installed in `tui.jsonc`.
- **Slash command registration with feature detection (v0.12.0).** OpenCode 1.14.42 removed `api.command.register` in favor of the keymap engine; 1.14.44+ restored it as a deprecated shim that translates to `api.keymap.registerLayer`. The TUI entry now runtime-feature-detects: 1.14.44+ uses `api.keymap.registerLayer({ commands: [{ namespace: 'palette', name: 'copilot-status', title: 'Copilot Status', category: 'Copilot', run() }], bindings: [] })`; 1.14.41 falls back to `api.command.register`; neither present logs a warning and continues without the slash command. Mirrors the dual-path pattern Magic Context shipped in commit `5fe1c4f`.
- **Re-entrant close fix (v0.10.1):** Pressing Escape on `/copilot-status` previously froze the TUI via re-entrant dialog close handling.

### RPC Layer (server ↔ TUI)

The server half exposes a **localhost-only** RPC listener for the TUI. It writes a per-session authenticated port file under `<XDG_CACHE_HOME or ~/.cache>/opencode/copilot-delegate/` so the TUI half can find and authenticate to the right server instance. Cleanup is best-effort: OpenCode's server plugin API has no dispose hook today, so cleanup is tied to process exit signals; the orphan-reaper posture covers missed shutdowns.

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

- **Agent:** `fro-bot/agent@v0.51.0` (SHA `fff42fc13e07acf3b7170c35338b9db1a2cbbe92`) as of 2026-06-03 — up from v0.44.3 at the 2026-05-21 survey, advancing through v0.46.0 (#165), v0.48.0 (#168), v0.48.1 (#171), v0.50.0 (#174), v0.51.0 (#177)
- **PR review:** Structured verdict format (PASS/CONDITIONAL/REJECT) with plugin-specific focus areas: TypeScript type safety, OpenCode API contracts (tool schema correctness, `ToolResult` shape, peerDependency compatibility), subprocess safety (spawn correctness, stdin/stdout buffering, signal propagation, process-tree kill, no zombies), tool output safety (no secrets/PATs/PII), changeset hygiene
- **Daily autohealing (16:00 UTC):** 4-category sweep — errored PRs, security, health & maintenance, developer experience. Single perpetual issue ("Daily Autohealing Report" #26) strategy.
- **Required secrets:** `FRO_BOT_PAT`, `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`
- **Required variables:** `FRO_BOT_MODEL`
- **Concurrency:** `fro-bot-{issue|pr|discussion|run_id}`, no cancel-in-progress

### Renovate Configuration

- Extends `marcusrbrown/renovate-config#5.2.0` (major-version jump from `#4.5.8` since last survey)
- LTS-only Node.js constraints for `@types/node` (even majors via regex `/^v?([0-9]*[02468])\\./`) and GitHub Actions node versions. An in-flight autoheal PR (#134) is tightening this further to caret-range LTS pinning.
- `@opencode-ai/*` packages use `build` semantic commit type
- Post-upgrade tasks: `bun install`, `bun run fix`, `bun run build`

### Branch Protection

Required status checks on `main`: `Fro Bot`, `Lint, typecheck, build, unit tests`, `Renovate / Renovate`. Enforces admins. Linear history required. No required PR reviews.

### Probot Settings

Extends `fro-bot/.github:common-settings.yaml`. Topics: `opencode, plugin, copilot, github-copilot, typescript, bun`. Homepage: npm package page.

### Release Pipeline

Uses Changesets via `changesets/action@v1.9.0` (bumped from v1.7.0 in #178 on 2026-06-03). GitHub App token for authenticated pushes (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Bun builds then Node.js publishes with npm provenance. Git user set from app slug.

## Open Issues

| # | Title | Notes |
|---|-------|-------|
| 38 | Re-add integration tests to CI | Integration test directory exists but not wired into CI; LLM-driven, gated on `GH_TOKEN`/`COPILOT_PAT` (model overridable via `OPENCODE_TEST_MODEL`, defaults to `opencode/minimax-m2.5`) |
| 26 | Daily Autohealing Report | Perpetual issue managed by Fro Bot |
| 25 | Dependency Dashboard | Renovate tracking issue |

## Open PRs (2026-06-03)

| # | Title | Notes |
|---|-------|-------|
| 169 | fix(lint): update biome schema to match CLI version 2.4.16 | New since prior survey — schema/CLI version drift fix |
| 135 | fix(deps): update dependency @opentui/solid to v0.2.8 | Renovate (still open) |
| 134 | fix(ci): constrain @types/node to LTS (even) majors and caret ranges in autoheal prompt | Fro Bot self-correction (still open) |
| 130 | fix(deps): update dependency @opentui/core to v0.2.7 | Renovate (still open) |
| 127 | chore(dev): update @types/node 24 → 25 (major) | Will be rejected by LTS-only rule once #134 lands (still open) |

Open issues unchanged from prior survey: #38 (re-add integration tests to CI), #26 (Daily Autohealing Report), #25 (Dependency Dashboard). The four Renovate/Fro Bot PRs from 2026-05-21 (#127/#130/#134/#135) remain open three weeks later — the `@opentui/*` and `@types/node` bumps are stalled, consistent with the v0.2.6 dependency pins still in `package.json`.

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

## Known Limitations (current as of v0.12.0)

- **Orphaned subprocesses *(largely mitigated since v0.2.0)*:** A PID-file reaper now scans `<XDG_STATE_HOME>/opencode-copilot-delegate/orphans/` at every plugin init, probes the owning plugin's liveness, and reaps subprocesses whose plugin has exited. The strict identity gate (kernel-tracked `comm` + start time) prevents PID-reuse misfires. The "mitigated" qualifier remains because the reap is best-effort under abort/timeout conditions.
- **Prompt visibility in `ps`:** Copilot CLI accepts the prompt as a command-line argument, exposing full prompt text in `ps` output for any user on the host. Upstream limitation — avoid delegating prompts containing secrets or PII; pass sensitive material via files, env vars, or `--secret-env-vars` instead.
- **No subprocess lifetime cap:** Hung `copilot` subprocess stays as `running` indefinitely. Cancel manually via `copilot_cancel`. Configurable timeout still planned for v1.x.
- **Single-process scope:** Task state is in-memory only; cross-process sharing requires future sqlite registry + IPC. `copilot_output` from a different OpenCode process returns `{ status: 'unknown', error: 'task_id not found in this OpenCode process' }`.
- **RPC cleanup is best-effort:** OpenCode's server plugin API has no dispose hook today, so RPC server cleanup relies on process-exit signals and the orphan-reaper posture for missed shutdowns.
- **TUI is opt-in:** Server plugin works alone. `/copilot-status` requires explicitly installing the TUI half in `tui.jsonc` — see the README for the dual-config snippet.
- **Integration tests not in CI:** Test directory exists but tracked as issue #38. Suite skips when neither `GH_TOKEN` nor `COPILOT_PAT` is set.

## 0.x Versioning Policy

Releases under `0.x` are unstable and may include breaking changes between minor versions. README explicitly recommends pinning to an exact version in production. `1.0.0` will be cut once the public surface stabilizes — likely after the configurable subprocess timeout and cross-process registry land.

## Survey History

| Date | SHA | Key delta |
|------|-----|-----------|
| 2026-04-23 | `bea3f57` | Initial survey — v0.1.0 scaffold with TODO stubs, no CI/Fro Bot/Renovate on main |
| 2026-04-27 | `02cac9c` | Implementation complete, CI active, Fro Bot v0.42.2, Renovate live, 6 workflows, `fkill` dependency added, Biome 1.9.4→2.4.13, TypeScript 6.0.3, 3 open issues |
| 2026-06-03 | `f9aaeea` | No release (still v0.12.0) and no source-tree change since `2744ce7`. Window is dependency-update churn only: Fro Bot agent v0.44.3 → v0.51.0 (through v0.46.0/v0.48.0/v0.48.1/v0.50.0); `changesets/action` v1.7.0 → v1.9.0 (#178); `actions/checkout` → v6.0.3; `bfra-me/.github` → v4.16.22; Biome 2.4.15 → 2.4.16; `@github/copilot` CLI 1.0.48 → 1.0.56; `opencode-ai`/`@opencode-ai/plugin` dev pin 1.15.4 → 1.15.13; `@types/node` 24.12.4. New open PR #169 (Biome schema/CLI version sync). The four prior open PRs (#127/#130/#134/#135) remain unmerged; open issues unchanged (#38/#26/#25). `@opentui/*` runtime deps still pinned at 0.2.6, zod still `^4.3.0`. |
| 2026-05-21 | `2744ce7` | v0.12.0 on npm (11 minor releases since prior survey). Fourth tool `copilot_resume` added. TUI half (`src/tui/`) shipped opt-in via `oc-plugin: ["server", "tui"]` and `./tui` export. Orphan reaper (v0.2.0+) hardened through streaming worker pool (v0.3.0), configurable timeouts (v0.4.0), symlink-attack defenses (v0.9.0), race-safe cleanup (v0.8.0). Per-process plugin singleton (v0.8.0/v0.11.0) returns empty hooks on duplicate invocation to fix double-registration under dual-config. Public-surface hardening (v0.12.0): plugin entry now Node-loadable, CI gates export shape. Localhost RPC layer wires server ↔ TUI. Fro Bot agent v0.42.2 → v0.44.3. Renovate preset `marcusrbrown/renovate-config#4.5.8` → `#5.2.0`. `@opencode-ai/sdk` peer dep removed (v0.6.0, was never imported). `@opencode-ai/plugin` peer narrowed `>=1.14.0` → `>=1.14.41`. zod pinned `^4.3.0` with `overrides` (v0.7.0) to dodge dual-zod TS2883. Tests grew from ~6 to 21 unit files plus integration. 3 open issues (same as prior), 4 open PRs (Renovate + one Fro Bot self-correction). |
