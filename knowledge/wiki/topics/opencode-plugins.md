---
type: topic
title: OpenCode Plugin Development
created: 2026-04-23
updated: 2026-09-05
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/systematic
    sha: ef02119abd801487dc0e53a43ac2d6b6433873ab
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 02cac9c024744a290c9257d5c740d2a83e2c8e42
    accessed: 2026-04-27
  - url: https://github.com/marcusrbrown/systematic
    sha: 420ef650215a9ca8cefa01f125e02434e351952e
    accessed: 2026-05-06
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 2744ce7fc07660baa4f17bfff3656141888261cf
    accessed: 2026-05-21
  - url: https://github.com/fro-bot/systematic
    sha: 12cae87
    accessed: 2026-05-22
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 517d38596432429a8fc5f78612edc80a1c3f3dc6
    accessed: 2026-05-28
  - url: https://github.com/marcusrbrown/systematic
    sha: 9b7570782190d540b4d57abdd94cf7ca8e1984f1
    accessed: 2026-05-28
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-06-09
  - url: https://github.com/marcusrbrown/systematic
    sha: 11b12bfae2433577db84821b5788a99f339243c9
    accessed: 2026-06-19
  - url: https://github.com/fro-bot/space-bus
    sha: ad8eefe00c467ba342353d5bbd3d8cc6fbb61fc5
    accessed: 2026-07-03
  - url: https://github.com/marcusrbrown/systematic
    sha: 4eecc77c6482895698645748beff0f336142bc64
    accessed: 2026-07-15
  - url: https://github.com/fro-bot/space-bus
    sha: 8e20e01775918a01855eb5aba64d04bf966f4d51
    accessed: 2026-07-18
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 0b31ea70ec0b6ca2ec467085abd1c9d713f89faa
    accessed: 2026-07-25
  - url: https://github.com/fro-bot/space-bus
    sha: fd8a746dd04bbf41b0d34dd0da55814686048ee9
    accessed: 2026-08-04
  - url: https://github.com/fro-bot/systematic
    sha: 1938bb1
    accessed: 2026-08-06
  - url: https://github.com/fro-bot/systematic
    sha: a40e544
    accessed: 2026-08-21
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: c6c055d906b8df3de5f371221daf930c8bd49f99
    accessed: 2026-08-25
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-09-02
  - url: https://github.com/fro-bot/systematic
    sha: 8e26a01
    accessed: 2026-09-04
  - url: https://github.com/marcusrbrown/systematic
    sha: 9bceff393c4d14c76b01625b9268d08d37fc4f01
    accessed: 2026-09-05
tags: [opencode, plugin, sdk, subprocess, async, delegation, workflow, skills, agents, tui, rpc, orphan-reaper, plugin-singleton, json-schema, oauth, anthropic, cross-process-lock, zod-config, bundled-names, deprecation-surface, upstream-sync-skill, fro-bot-workflow, custom-tools, opencode-server, directory-routing, mcp, agent-bus, browser-safe-subpaths, managed-server, subpath-loader-resolution, npm-dist-tag, release-lane-decommission, schema-fingerprint, custom-keywords, release-gated-deploy, multi-harness, optional-peers, capability-matrix, pi, claude-code, generated-skills, drift-gate, tree-sitter, trust-boundary]
---

# OpenCode Plugin Development

Patterns and conventions for building plugins for the [OpenCode](https://opencode.ai) agent framework.

## Plugin API Surface

OpenCode plugins implement the `Plugin` interface from `@opencode-ai/plugin`, receiving a `PluginInput` object:

- **`client`** — Full SDK client (`@opencode-ai/sdk`), including `client.session.promptAsync()` for injecting messages into the parent session.
- **`directory`** — Working directory for the current session.
- **`worktree`** — Git worktree path.
- **`project`** — Project metadata.
- **`serverUrl`** — Plugin server URL.
- **`$`** — `BunShell` for shell execution.

### Tool Registration

```typescript
import { tool } from '@opencode-ai/plugin/tool'

export const MyPlugin: Plugin = async ({ client, directory }) => ({
  tool: {
    my_tool: tool({
      description: '...',
      args: { input: tool.schema.string().describe('...') },
      async execute(args, ctx) {
        // ctx.sessionID, ctx.ask({...}), ctx.metadata({...})
        return { result: '...' }
      },
    }),
  },
})
```

### Async Notification Pattern

The key mechanism for background task completion is `client.session.promptAsync()`, which injects a `<system-reminder>` message into the parent session. The `noReply` flag controls turn-taking:

- **`noReply: true`** — Message injected silently; parent does not get a turn. Useful when other background tasks are still in flight.
- **`noReply: false`** — Forces the parent agent to take a turn immediately. Use when all tasks complete or on failure.

This mirrors OMO's `background_task`/`background_output` pattern. Reference implementations:
- `oh-my-openagent` (OMO) — uses `promptAsync` with `noReply: !allComplete`
- `shekohex/opencode-pty` — uses `client.session.prompt()` for PTY notifications

### Build and Distribution

- **Runtime:** Bun (OpenCode's native runtime)
- **Build:** `bun build src/index.ts --outdir dist --target bun --external @opencode-ai/plugin --external @opencode-ai/sdk`
- **Type declarations:** `tsc --emitDeclarationOnly --noEmit false`
- **Peer dependencies:** `@opencode-ai/plugin >=1.14.0`, `@opencode-ai/sdk >=1.14.0`
- **Package type:** ESM (`"type": "module"`)

### Installation

```json
// opencode.json
{
  "plugin": ["opencode-copilot-delegate"]
}
```

## Plugin-Aware Skills

Skills (e.g., `.agents/skills/*.md`) should branch on plugin presence:

```
If your tool catalog includes `copilot_delegate`, `copilot_output`, and `copilot_cancel`
(provided by the opencode-copilot-delegate plugin), prefer those tools for delegation.
Otherwise, use the direct subprocess pattern below.
```

This ensures skills degrade gracefully when the plugin is not installed.

## Plugin Architecture Patterns

### Config Hook — Asset Merging

[[marcusrbrown--systematic]] demonstrates a comprehensive config hook pattern: discover bundled skills and agents from the plugin's npm package, merge them into OpenCode's runtime config, and allow user/project-level overrides to take precedence. The config hook handles three asset types (agents, commands/skills) and respects existing configuration to avoid overwriting user choices.

### System Prompt Injection

The `system.transform` hook allows plugins to inject content into every conversation's system prompt. Systematic uses this to bootstrap the "Using Systematic" guide, teaching the AI how to discover and invoke skills. This is a powerful pattern but carries security implications — injected content has system-level authority.

### Skill Tool Pattern

Rather than registering one tool per skill, systematic registers a single `systematic_skill` tool whose description lists all available skills. The AI invokes this tool with a skill name to load content on demand. This avoids polluting the tool namespace while maintaining discoverability.

## Known Patterns

| Pattern | Description | Reference |
|---------|-------------|-----------|
| Delegation | Spawn CLI subprocess, return task_id, inject notification on completion | [[marcusrbrown--opencode-copilot-delegate]] |
| PTY notification | Inject messages via `client.session.prompt()` for process I/O | `shekohex/opencode-pty` |
| Agent discovery | Scan `~/.copilot/agents/*.md` and `<cwd>/.github/agents/*.md` for available agents | [[marcusrbrown--opencode-copilot-delegate]] |
| Config merging | Discover bundled assets (skills/agents) and merge into OpenCode config via config hook | [[marcusrbrown--systematic]] |
| System prompt injection | Inject bootstrap content into system prompts via `system.transform` hook | [[marcusrbrown--systematic]] |
| Skill tool | Single tool with dynamic skill loading (avoids tool namespace pollution) | [[marcusrbrown--systematic]] |
| OCX registry | Component-level distribution via ocx CLI with named profiles (V2 schema since v2.6.0) | [[marcusrbrown--systematic]] |
| Factory deduplication | Singleton guard preventing duplicate plugin registration across multiple opencode.json sources | [[marcusrbrown--systematic]] |
| Content integrity gate | CI-enforced validation that all skill/agent sub-files are properly imported and shipped | [[marcusrbrown--systematic]] |
| Removed-name disable-list tolerance | Disable lists (`disabled_skills`/`disabled_agents`) accept names that were once bundled but later removed; load-time silently drops them with a warning instead of failing validation. A content-integrity gate enforces removed ∩ bundled = ∅. Prevents a later upstream cleanup from bricking configs that had disabled the removed item (systematic v2.32.0, #534) | [[marcusrbrown--systematic]] |
| Discovered skills as slash commands | Beyond bundled assets, discover the user's/project's own skills from the six roots OpenCode itself scans (global `~/.claude`/`~/.agents`, project `.claude`/`.agents` walked to worktree root, `.opencode` dirs) and register each as a `/slash` command, applying upstream last-write-wins precedence so the command that wins matches what OpenCode's skill tool would resolve. Model-invocable skills get a shim loading via the native skill tool with `$ARGUMENTS` passthrough; command-only skills inline the `SKILL.md` body. Gated by `skills_as_commands` toggle (default true), suppressible per-command via `disabled_commands`. Idempotency comes from rebuilding command config from disk each launch (OpenCode config-hook mutations are in-memory per load, never persisted) rather than from ownership markers (systematic v2.33.0–v2.33.2, #592–#594) | [[marcusrbrown--systematic]] |

## Process Tree Management

[[marcusrbrown--opencode-copilot-delegate]] uses `fkill` 10.0.3 for cross-platform process tree cleanup. Key pattern: `fkill(pid, { force: false, forceAfterTimeout: 2000, waitForExit: 5000 })` with `.catch()` guards on all kill calls in abort handlers. On macOS, `tree: true` is Windows-only, so the plugin targets the entire process group via `fkill(-pid)` with subprocesses spawned `detached: true`.

## Standalone `.opencode/tools/` Custom Tools (no Plugin factory)

Not every OpenCode tool surface starts as a published `Plugin`. [[fro-bot--space-bus]] at its 2026-07-03 MVP demonstrated the lighter **project-local custom-tool** path: files in `.opencode/tools/` where the **filename is the tool name**, each exporting `tool({ description, args, async execute(args, ctx) })` from `@opencode-ai/plugin`. `tool.schema` is Zod; `ctx` provides `{ agent, sessionID, messageID, directory, worktree }`; tools run in OpenCode's Bun runtime with unrestricted `fetch` to localhost.

- **No `.opencode/package.json` needed** — `.opencode/tools/` resolves `@opencode-ai/plugin` from repo-root `node_modules` directly.
- **Adapters stay dumb.** space-bus keeps all logic in `src/core.ts` and makes each tool file a thin adapter (parse args → call core → format). This made the later conversion to a distributable `Plugin` a packaging move, not a rewrite.

> **Update (2026-07-18):** the packaging-move bet paid off — space-bus has **shipped as a published `Plugin`** (`@fro.bot/space-bus` on npm, default-exported factory via `src/index.ts` returning the six-tool map). The `.opencode/tools/` layout was the dogfood scaffold; the published shape is `src/index.ts` + `src/tools/*.ts` (`makeBus*` factories). The "logic in core, thin edge adapters" discipline survived the conversion intact.

### Browser-safe subpath exports + reserved-subpath loader trap (space-bus, 2026-07-18)

Two durable published-plugin patterns from space-bus's library-surface work:

- **CI-enforced browser-safe subpaths.** A plugin can publish subpath exports for renderers that want structured state, split into a **browser-safe lane** (`/core`, `/contract`, `/format`, `/attach` — no `node:*`, injected seams for fs/env/crypto) and a **Node-only lane** (`/config`, `/managed-server`, `/registry`). A `browser-safety.test.ts` bundles the browser lane for a browser target and asserts no `node:` imports and no path into the Node lane. **Test the *published dist*, not just `src`** — space-bus `0.10.1` fixed a `createRequire`/`node:module` prelude that broke Vite bundling (Mothership) even though the src-level test passed; the fix added a dist-level browser-safety assertion.
- **Reserved-subpath loader resolution.** OpenCode's plugin loader resolves `exports["./server"]` **before** `main`. space-bus published its managed-server lifecycle at `/server` and broke plugin loading with `Plugin export is not a function` for `0.6.0`–`0.9.0` on npm — `/server` was resolving to the lifecycle module instead of the plugin factory. Fix (`0.10.0`): remap `./server` to the plugin entry and move the lifecycle API to `/managed-server`. Lesson: don't publish a non-factory export at a subpath the loader may probe.
- **Consolidate the session API into the browser-safe lane (2026-08-04, space-bus `0.14.0`/`0.15.0`).** When multiple consumers (a plugin's own tools, an MCP facade, a renderer like [[marcusrbrown--mothership]]) all need to read/answer OpenCode sessions, put the primitives in the browser-safe `/core` lane so nobody maintains a parallel OpenCode HTTP client. space-bus added `messages()` (bounded full-message read, hard-capped, ownership resolved from the roster not a caller directory), `questions()`/`answerQuestion()` (complete nested pending-question read + ownership-and-cardinality-checked answer, refusing cross-session `requestId` and mismatched answer counts with **no mutation**), an opt-in **fail-closed** `dispatch({ onPendingQuestion: "blocked" })` (returns typed `{mode:"blocked",requestId}` or a stable error instead of guessing under ambiguous `/question` state), and **message correlation**: `createDispatchMessageId()` mints an OpenCode-compatible ascending id with **no Node builtins** (Web Crypto only), and a typed `DispatchFailure` distinguishes `phase:"not_sent"` (verified pre-mutation) from `phase:"indeterminate"` (a mutation may already have landed) so callers can reconcile safely after an error. Two durable design rules here: validation errors return **one stable generic message that never echoes the rejected input** (no reflected-injection surface), and unknown fields are **omitted, never sent as `undefined`/`null`** — both keeping the discriminated-union `Result<T>` contract clean across the boundary.

### OpenCode Server API as a multi-project control plane

space-bus also documents using **one `opencode serve` instance to multiplex many project directories** via per-request routing rather than a plugin at all — a distinct pattern worth recording for anyone building agent-coordination surfaces:

- **Directory resolution order:** session's stored directory → `?directory=` query param → `x-opencode-directory` header → server cwd. An `InstanceStore` lazily loads an isolated instance (config, plugins, `AGENTS.md`) per directory, so each project's own agent config applies.
- **Session store is global across directory headers:** `GET /session/{id}` resolves regardless of the directory header sent — attribute a session to its project via the session's own `directory` field, not the probe header. `GET /session` (list) and `/session/status` are directory-scoped.
- **Diff retrieval is version-sensitive:** upstream opencode #30127 (v1.16.0) zeroes session-level diff summaries (`GET /session/{id}/diff` → `[]`); aggregate per-turn diffs from `GET /session/{id}/message` (last turn wins per file, à la upstream PR #33444) as a fallback. `@fro.bot/harness` builds ≥ `1.17.13+harness.ee55e157` carry #33444 so `GET /session/{id}`'s `summary.diffs` is populated directly.
- **A stdio MCP facade** (`@modelcontextprotocol/sdk`) can re-expose the same tools to Claude Desktop from the same core — the config path must be absolute (Claude Desktop launches with no cwd).

## Marcus's Plugin Repos

| Repo | npm Package | Purpose | Stack | Status |
|------|-------------|---------|-------|--------|
| [[marcusrbrown--systematic]] | `@fro.bot/systematic` | Structured engineering workflows (~48 bundled skill dirs, 51 agents) | Bun, Biome, Zod-typed config, semantic-release | Active, v2.33.3 |
| [[marcusrbrown--opencode-copilot-delegate]] | `opencode-copilot-delegate` | Delegate tasks to Copilot CLI as background subprocesses; opt-in `/copilot-status` TUI half | Bun, Biome, Changesets | Active, v0.12.0 (4 tools: delegate/output/cancel/resume) |
| [[marcusrbrown--cortexkit-anthropic-auth]] | `@marcusrbrown/opencode-anthropic-auth` + `@marcusrbrown/anthropic-auth-core` | Claude Pro/Max OAuth, fallback accounts, quota routing, prompt-cache controls, optional Cloudflare Worker relay; OpenCode + Pi share the same core | Bun, Biome, Lefthook, monorepo workspaces | Active fork, `1.2.2-mb.2` (fork of `cortexkit/anthropic-auth`); Pi package private in fork |
| [[fro-bot--space-bus]] | `@fro.bot/space-bus` | Workspace agent bus — a control agent tasks per-project agents over one directory-routed `opencode serve`; MCP facade + browser-safe library subpaths (now with session-interaction + message-correlation `/core` primitives) | Bun, Biome, zod v4, Changesets + npm OIDC | Active, **v0.15.0** (6 tools: bus_roster/task/status/result/wait/registry) |

These plugins use Bun + Biome (not the `@bfra.me/*` ESLint/Prettier stack), establishing this as the standard for Marcus's/Fro Bot's OpenCode plugin repos. space-bus and copilot-delegate both publish via **Changesets** (space-bus via **npm OIDC trusted publishing**, no `NPM_TOKEN`); systematic uses semantic-release.

## Cross-Process OAuth Refresh Locking

[[marcusrbrown--cortexkit-anthropic-auth]] documents a well-tuned pattern for OAuth refresh across multiple OpenCode processes sharing a single auth sidecar:

1. **Jittered background refresh timers** so concurrent processes do not all hit the OAuth endpoint at the same due timestamp (`1.2.2`).
2. **Cross-process atomic filesystem lock** so a process cannot steal a lock while another is still initializing it (`1.1.3`, hardened in `1.2.2`). Without this, two processes can each successfully refresh, but the second consumes a rotated refresh token and the first loser ends up with `invalid_grant`.
3. **Wait-and-rejoin** on contention: when a main OAuth refresh is already in progress, followers wait briefly and re-read OpenCode auth so they join the successful token rotation instead of failing immediately.
4. **Refresh endpoint failover**: as of `1.2.1`, refresh moved from `platform.claude.com` to `https://api.anthropic.com/v1/oauth/token` after the former returned OAuth `429` repeatedly during proactive refresh.

This is a useful reference pattern for any OpenCode plugin that shares per-user credentials across multiple agent processes.

## Two-Half Plugin Pattern (server + TUI)

[[marcusrbrown--opencode-copilot-delegate]] v0.10.0+ ships **two plugin entries** in one npm package:

```jsonc
// package.json
{
  "exports": {
    ".":     { "import": "./dist/index.js" },         // server half
    "./tui": { "import": "./dist/tui/index.js" }      // TUI half
  },
  "oc-plugin": ["server", "tui"]
}
```

Users opt into each half independently:

```jsonc
// opencode.json  — server half registers the tools
{ "plugin": ["opencode-copilot-delegate"] }

// tui.jsonc     — TUI half adds /copilot-status
{ "plugin": ["opencode-copilot-delegate/tui"] }
```

**Build target split.** The server entry builds with `target: 'node'` (plain Node ESM loadable, gated by a CI export-shape assertion). The TUI entry stays on `target: 'bun'` because `@opentui/solid` is Bun-specific.

**Server ↔ TUI RPC.** The server half exposes a localhost-only RPC listener and writes a per-session authenticated port file under `<XDG_CACHE_HOME or ~/.cache>/opencode/copilot-delegate/`. The TUI half reads the port file to find the right server instance. Cleanup is best-effort — OpenCode's server plugin API has no dispose hook today, so cleanup is tied to process exit signals and the orphan-reaper covers missed shutdowns.

## OpenCode Plugin Loader Gotchas

These bit upstream plugins before; institutionalizing the fixes saves hours of incident response.

### Loader treats every named export as a plugin factory

The loader iterates every named export from a plugin entry point and invokes each with `undefined` input. Stray named exports (helpers, types, internal utilities) get called as plugin factories and crash on the missing input.

- **Systematic regressed here in v2.5.0 and v2.12.1** (hours of downtime each time).
- **opencode-copilot-delegate v0.12.0** moved `wireRpcServerCleanup` out of `src/index.ts` into `src/lib/rpc-cleanup.ts` and added a CI gate that runs `node --input-type=module -e "import('./dist/index.js').then(m => …)"` between Build and Unit tests, exiting non-zero if anything other than `default` is exported or `default` is not a function. `tests/package-exports.test.ts` mirrors the assertion locally.

**Rule:** Plugin entry points export only `default`. Period.

### `api.command.register` is unstable across OpenCode versions

- **OpenCode 1.14.42** removed `api.command.register` in favor of the keymap engine.
- **1.14.44+** restored it as a deprecated shim translating to `api.keymap.registerLayer`.

TUI plugins that unconditionally call `api.command.register` silently lose their slash commands on the version where it's gone. Runtime-feature-detect both paths:

```typescript
if (typeof api.keymap?.registerLayer === 'function') {
  api.keymap.registerLayer({
    commands: [{ namespace: 'palette', name: 'copilot-status', title: 'Copilot Status', category: 'Copilot', run }],
    bindings: [],
  })
} else if (typeof api.command?.register === 'function') {
  api.command.register({ /* ... */ })
} else {
  // Defensive: log warning, plugin still loads without the slash command
}
```

opencode-copilot-delegate's TUI half follows the dual-path pattern Magic Context shipped in commit `5fe1c4f`.

### Host zod ≠ plugin zod (per-parameter description loss)

OpenCode's tool catalog serializes plugin schemas via the **host's** bundled zod, not the plugin's. Plugin-side `.describe()` metadata lives in a separate module-local metadata registry and is invisible across the boundary, so per-parameter descriptions get dropped before reaching the LLM.

Two known workarounds:

1. **`_zod.toJSONSchema` override** (v0.7.0 fix in [[marcusrbrown--opencode-copilot-delegate]], same fix shipped by `@cortexkit/opencode-magic-context` and `@cortexkit/aft-opencode`): patch each tool arg schema with a serialization override that delegates back to the plugin-local zod. Use `src/lib/normalize-tool-arg-schemas.ts`-style helpers.
2. **`.describe().optional()`** (v0.6.0 partial fix): zod's `toJSONSchema(…, { io: 'input' })` unwraps `.optional()` and drops descriptions attached to the wrapper. Reordering to `.describe(…).optional()` places the description on the leaf type so it survives the unwrap. Insufficient on its own when host/plugin zod are different module instances — pair with the override above.

Pin zod as a direct dependency with a matching `overrides` entry so the plugin's own install tree stays on one version (resolves TS2883 from dual-zod trees at build time). `overrides` is local-install-only; downstream consumers may still see a different transitive zod from their OpenCode host.

**Generalized "single-root type identity" override (2026-08-25):** the same footgun recurs whenever a TUI/runtime dep bundles its own copy of a peer. [[marcusrbrown--opencode-copilot-delegate]]'s stalled `@opentui/*` 0.4.x upgrade (fro-bot autoheal PR #335, `0.2.7 → 0.4.5`) is blocked because `@opentui/solid@0.4.x` bundles its own `@opentui/core`, producing duplicate branded type identities (`TextRenderable`, `BoxRenderable`, `KeyEvent`, …) that break `bun run typecheck`. The fix mirrors the zod pattern exactly: add an `overrides.@opentui/core` entry pinning both packages to the same version so TypeScript resolves the branded renderables from a single root install. Rule of thumb: any dep that re-bundles a shared core needs a root `overrides` pin to collapse type identities before a major will typecheck.

### `api.command.register` removal isn't the only churn — narrow peer ranges accordingly

opencode-copilot-delegate v0.12.0 narrowed `peerDependencies['@opencode-ai/plugin']` from `>=1.14.0` to `>=1.14.41` to align advertised compatibility with what's actually tested. Plugin authors should narrow peer ranges in lockstep with the OpenCode versions their feature-detection branches actually cover.

## Orphan Subprocess Reaping

When a plugin spawns long-running subprocesses, OpenCode crashes or reloads can leave orphans. [[marcusrbrown--opencode-copilot-delegate]] (v0.2.0+) ships a generalizable pattern:

1. **Per-instance PID file** at `<XDG_STATE_HOME>/<plugin-name>/orphans/<plugin-pid>.pids`, one line per spawned subprocess. Entry removed on every terminal status transition.
2. **Strict identity gate** before any kill: live process's `comm` (kernel-tracked executable name from `ps -o comm=`) AND `lstart` (start-time string) must match values recorded at spawn time. Rules out both PID reuse and cross-instance kills of a live foreign instance's children.
3. **Spawner liveness probe** (`process.kill(<plugin-pid>, 0)`) before reaping any foreign file. Live spawner → skip. Dead spawner → reap entries, delete file.
4. **Streaming worker pool** (cap 5) drains a shared queue; a slow `ps` probe blocks only its own worker.
5. **Combined `ps -p <pid> -o comm=,lstart=` query**: one fork/exec gets an atomic kernel snapshot of both identity legs.
6. **Configurable timeouts** with cooperative `AbortSignal` cancellation. In-flight workers cooperate by skipping their next mutating step on abort, so dangerous side effects can't fire after the call returns.
7. **Same-user symlink hardening**: `O_NOFOLLOW` on PID file open/truncate; reject symlinked PID file parent directories before scanning.
8. **Race-safe cleanup**: every truncate/unlink goes through a per-file `serializeWrite` lock.

This pattern generalizes to any plugin that spawns subprocesses it must clean up across crashes.

## Per-Process Plugin Factory Singleton

When a user lists the same plugin in both `~/.config/opencode/opencode.json` and a project-level `opencode.json`, OpenCode's host previously invoked the factory once per source. Two divergent fixes:

| Plugin | Pattern | Rationale |
|--------|---------|-----------|
| [[marcusrbrown--systematic]] (PR #352) | Per-load registration | No exclusive resources; cleaner to register cleanly each time |
| [[marcusrbrown--opencode-copilot-delegate]] (v0.8.0+) | `globalThis` Symbol singleton; **duplicate invocations return empty hooks `{}`** (v0.11.0) | `doInit` binds a TCP port (RPC server) and writes a PID file — running it twice in the same process would race on exclusive resources |

The empty-hooks-on-duplicate-invocation fix specifically targets the LLM-visible tool catalog: the host iterates each source's returned hook surface and registers every tool entry it finds, even when two sources return the same JS reference. Returning `{}` on duplicates gives the host nothing to register a second time. The first invocation still runs `doInit` once and receives the real hooks; subsequent invocations in the same PID receive `{}` and emit a one-time warning so duplicate-config situations stay observable.

Both plugins document the divergence inline with cross-references to each other's source files.

## Documentation Deployment

[[marcusrbrown--systematic]] deploys its Starlight/Astro docs site to a separate repo ([[fro-bot--systematic]]) rather than using the source repo's GitHub Pages. The docs site at **fro.bot/systematic/** also serves the OCX component registry (`.well-known/ocx.json` → `/systematic/index.json`), enabling `ocx` CLI to install individual skills and agents by URL. See [[github-pages]] for the cross-repo deploy pattern.

As of the 2026-05-22 [[fro-bot--systematic]] survey, the same docs site is now the canonical host for the user config JSON Schema:

- `https://fro.bot/systematic/schemas/v<major>/systematic-config.schema.json` — pinned `$id`, intended for `"$schema"` references in `systematic.json` / `systematic.jsonc` for IDE autocomplete (VSCode, Zed, IntelliJ). **This path is major-versioned and NOT stable across majors.**
- `https://fro.bot/systematic/schemas/latest/systematic-config.schema.json` — moving pointer for "current".

Schema is draft-07, describes top-level keys `agents`, `categories`, `disabled_skills`, `disabled_agents`, `disabled_commands`, `bootstrap`, `skills_as_commands` (since systematic v2.33.0), and — since the v3 minor train (observed 2026-08-06) — `pi_subagents` and `workflow_guard` (ten properties total). The schema's own `$schema` property is documented as informational only — the systematic loader does not fetch or validate against it; it exists purely to switch on editor support. The same docs deploy drives the OCX registry, the rendered guide pages, and this schema — three different consumer contracts living on one `gh-pages` branch.

**Breaking-path precedent confirmed (2026-07-22 [[fro-bot--systematic]] survey):** when the plugin crossed the **v2 → v3 major**, the schema host **dropped `schemas/v2/` entirely** (it now returns HTTP 404) and replaced it with `schemas/v3/`; `latest/`'s `$id` re-pointed to the v3 URL. Majors replace the versioned path wholesale — they do **not** co-serve old majors. Any consumer that pinned `"$schema"` to a `vN` URL silently loses autocomplete/validation at the next major (no error surfaced). Lesson: pin `latest/` for a floating contract, or expect to re-pin `vN` at each major. The same v2 → v3 crossing contracted the OCX registry catalog from 104 → 73 components (agents 51 → 37, skills 48 → 31) — the first component *contraction* observed, a source-side curation event rather than growth.

**Two-axis versioning confirmed (2026-08-06 [[fro-bot--systematic]] survey):** the config-schema URL and the OCX catalog move on *independent* clocks. Across the v3 minor train (v3.2.5 → v3.6.0), the **OCX catalog stayed frozen at 73 components** while the **config schema mutated additively in place under `schemas/v3/`** — the property set grew 8 → 10 (`pi_subagents`, `workflow_guard` added, both optional/backward-compatible). This is the third consecutive interval the schema grew within a major (`skills_as_commands` at v2.33.0, then v3 rebasing, now these two). The durable rule: **`vN/` paths mutate additively within a major and are replaced wholesale at the next major; the OCX catalog only changes at majors (or explicit source-side curation), not on every minor.** A consumer that only cares about the catalog can ignore minor releases; a consumer that resolves `$schema` for editor support benefits from every minor but must accept in-place field growth.

**Axis independence re-confirmed with the pairing inverted (2026-08-21 [[fro-bot--systematic]] survey):** across the v3 minor train v3.6.0 → v3.12.4, the **config schema held flat at 10 properties** (no additions since 2026-08-06) while the **OCX catalog version advanced six minors** (still 73 components — the catalog *count* is frozen at the major boundary, but the advertised `version` string tracks each release). This is the first non-mutating schema interval since 2026-06-25, breaking the three-in-a-row additive streak — and it demonstrates the two axes are genuinely decoupled in *both* directions: prior three intervals were "catalog-count frozen, schema grows"; this one is "schema frozen, catalog version climbs." The rule stands; neither axis is a leading indicator of the other. Also observed: an npm `2.33.4` v2 backport published to the retired major line did **not** re-serve the dropped `schemas/v2/` path (still 404) because the deploy target only mirrors `dist-tags.latest` (3.12.4) — the wholesale-replace-at-major precedent is not reversible by a late v2 patch.

**Refinement — "the schema is unchanged" was measuring a header (2026-09-04 [[fro-bot--systematic]] survey):** the two-axis rule above stands as stated, but the axes are not orthogonal beneath the surface. Four surveys tracked the config schema by counting its **top-level properties** (7 → 8 → 10 → flat). The served file is 38,180 bytes with 74 `definitions`, and its `agents` property is a **closed enumeration of the entire bundled agent roster** — 74 explicit keys (37 bare names + 37 `category/name` aliases) under `additionalProperties: false`. Adding or removing one agent upstream rewrites the schema body while the top-level count stays at ten. So "schema frozen" readings were claims about a header, not content.

Two transferable rules for any generated, published JSON Schema:

1. **Track a content fingerprint, not a property count.** Byte length, `definitions` count, and a hash prefix turn a nested mutation into a detectable event. (Baseline recorded on the repo page.)
2. **A generated schema that enumerates a runtime roster is a second copy of that roster.** It is therefore a cross-checkable artifact: the schema's 37 bare agent names and the OCX registry's 37 `agent` components must agree, and a mismatch means the catalog and the IDE contract disagree about what exists. Two published artifacts from one build are worth diffing against each other, not just against their own history.

**Asymmetric strictness inside one schema — closed `agents`, open `categories`:** `agents` names every valid key and rejects the rest; `categories` is `{propertyNames: {type: string}, additionalProperties: <overlay>}`, so any string is a valid category name even though the bundled categories are real and finite. Net effect for a user editing `systematic.json`: **misspell an agent and the editor underlines it; misspell a category and the editor is silent and the overlay does nothing.** Generated schemas inherit strictness from whatever the generator happened to model as an enum versus a record — the looser half is invisible precisely where a typo costs the most to debug. When emitting a schema from types, audit which keyed objects ended up open.

**A non-standard keyword is documentation, not enforcement:** the same schema carries 16 occurrences of a `"trust"` keyword with values `any` and `project-or-higher`, attached to fields like `model`, `temperature`, `top_p`, and per-agent `skills`. Draft-07 validators ignore unknown keywords, so this vocabulary is inert for every consumer except the plugin's own loader — not enforced, not surfaced in IDEs, invisible through any standard validator. The naming implies a config-source trust tier (which fields a project-level file may set versus which require user-level config); that reading is inference. Either way: **if a distinction matters for safety, expressing it as a custom keyword in a published schema communicates it to nobody who is not already reading your loader.** Encode it in the shape (separate schemas per trust tier, or `$comment` plus real constraints) or document it in prose the consumer actually sees.

**Deploy fan-out is release-gated, not push-gated (2026-09-04):** the docs/registry/schema deploy fires on npm publish, not on merge. Sixteen source commits (one `docs:`, fifteen `chore(deps)`/`chore(dev)`) landed on `main` after the last deploy and produced zero deploys, because semantic-release cut no release from non-releasable commit types. Consequence for anyone auditing a plugin's published artifacts: **a stale docs/registry host under a conventional-commits release gate is the correct output of a healthy pipeline**, and the cheap way to tell it apart from a dead pipeline is to read the producer's *release* feed rather than its `pushed_at` — which in this case showed same-day activity from open PR branches while the last release was ten days old.

## Bundled Skill for Upstream Sync (cortexkit_anthropic-auth pattern)

[[marcusrbrown--cortexkit-anthropic-auth]] ships a `.agents/skills/anthropic-auth-upstream-release/SKILL.md` in the repo root. OpenCode's `.agents/` discovery path picks it up automatically for any agent working in that repo, giving the agent explicit procedural context for upstream sync operations and fork-invariant release cutting.

This is the first instance in the Marcus ecosystem of a repo-local skill scoped to a specific operational domain (upstream-sync / fork-release) rather than a general-purpose engineering skill. Pattern notes:

- Skill is named after the operation domain, not the repo — `anthropic-auth-upstream-release` is meaningful outside the repo's own slug.
- Covers only upstream sync + fork release; ordinary feature work is explicitly out of scope, preventing skill over-reach.
- Encodes all fork invariants (package names, version lane, npm publish rules) in one place so agents and human contributors see the same guardrails.

Contrast with [[marcusrbrown--systematic]] which ships general-purpose skills (`ce:plan`, `ce:work`, etc.) distributed for consumption by other OpenCode users — the cortexkit-auth pattern is internal/operational, not distributable.

**Follow-up (2026-09-02): the skill outlived the practice it encodes.** The skill still ships and still describes upstream sync, fork-conflict resolution, `vX.Y.Z-mb.N` release cutting, and npm metadata validation. It has been exercised exactly once. The fork is now 334 commits behind upstream with 32 missed releases, and the two-branch mechanism the skill assumes — an upstream-tracking `main` alongside a fork-specific default branch — was abandoned at that single use: the mirror sits at `release: v1.2.2` (2026-05-21), older than the fork's own sync point, because the v1.2.5 merge landed directly on `marcusrbrown/main`.

The transferable caution for repo-local operational skills: **a skill is documentation with an execution surface, and it decays exactly like documentation.** Nothing verifies that the branches, tags, or lanes a skill names still exist in the shape it describes, and an agent handed a stale procedural skill will follow it confidently. If the procedure has preconditions (here: "the mirror is current"), the skill should assert them before acting rather than assume them.

## Decommissioning a Release Lane Takes Three Deletions (2026-09-02)

From [[marcusrbrown--cortexkit-anthropic-auth]]. The repo's release contract forbids the `mb` dist-tag lane in three separate places — `.github/instructions/release.instructions.md` (_"Do **not** reintroduce the `mb` dist-tag lane"_), `.github/copilot-instructions.md`, and the `fro-bot.yaml` prompt env vars that every mode references. PR #6 removed the lane from the publish workflow on 2026-05-26.

The tag is still live on npm. Both fork packages carry `dist-tags: { latest: 1.2.5-mb.3, mb: 1.2.2-mb.2 }` as of 2026-09-02. `npm install @marcusrbrown/opencode-anthropic-auth@mb` resolves, succeeds, and installs a build three fork-releases stale — permanently, because the pipeline that would advance it no longer exists.

**A dangling dist-tag is strictly worse than a deleted one: it is a live install surface with no producer, and it fails by succeeding.** No CI assertion catches it, and the reason is structural — `verify-artifacts.mjs` and the release-lane-watch prompt section both validate *what the release publishes*, and the release does not publish to `mb`. Removing a code path removes it from the set of things your tests can observe.

The rule: retiring a distribution channel requires deleting the **CI job**, the **registry pointer** (`npm dist-tag rm`), and the **documentation that references it**. Only the first is verifiable by the pipeline; the other two need a deliberate step. Applies equally to GHCR tags, GitHub release channels, and `latest`-style aliases on any registry.

The same repo supplies the third-deletion instance in isolation: `README.md` still instructs `Pin @marcusrbrown/opencode-anthropic-auth@1.2.2-mb.2` and describes both packages as published "at `1.2.2-mb.2`", never updated across three subsequent tagged releases. So the registry metadata and the install docs are **two independent stale pointers that converge on the same abandoned version** while the pipeline moved on without either. For plugin repos specifically this matters more than usual: OpenCode resolves plugins by package specifier from user config, so a stale documented pin propagates into consumers' `opencode.json` and stays there — the namespace-pinning rationale that motivated the fork in the first place cuts both ways.

## App-Embedded Design-Gate Plugin (in-repo `.opencode/impeccable/`)

Not every OpenCode plugin is published or general-purpose. A recurring **app-embedded** pattern: an application repo vendors an OpenCode plugin *in-tree* to run a design/quality gate against the agents that work on that same repo, rather than consuming the gate as a pinned CI action.

- **[[fro-bot--dashboard]]** (2026-07-23) first vendored the Impeccable design gate as `.opencode/impeccable/plugin.ts` alongside `.agents/skills/impeccable/`, wiring `.opencode/tsconfig.json` into `check-types` and adding `@opencode-ai/plugin` as a devDep.
- **[[marcusrbrown--mrbro-dev]]** (2026-07-25, surveyed via the `marcusrbrown.github.io` name binding) took the same move: root `opencode.json` registers `"plugin": ["./.opencode/impeccable/plugin.ts"]`, backed by `.opencode/impeccable/{plugin.ts, hook-bridge.ts}` (+ `plugin.test.ts`, `hook-bridge.integration.test.ts`) and `.opencode/tsconfig.json` in the `check-types` script; `@opencode-ai/plugin@1.18.2` devDep. The `hook-bridge.ts` naming suggests the plugin bridges OpenCode hook events into the Impeccable gate's evaluation surface.

Distinguishing traits vs the distributable plugins above: **no npm publish**, **relative-path plugin registration** (`./.opencode/...` not a package name), and **the plugin is a repo-local build artifact type-checked by the app's own `tsc` pass**. This is the Impeccable gate propagating from a pinned CI action into a repo-local plugin across the fleet — worth tracking whether it lands a shared/published shape or stays vendored per-repo.

## One Content Source, Three Harnesses: Optional Peers as the Portability Primitive (2026-09-05)

From the first direct source-side survey of [[marcusrbrown--systematic]] v3 (`9bceff39`, v3.16.1). The largest plugin on this page **stopped being an OpenCode plugin** and became a workflow system with three shipped harness adapters. The mechanism is small enough to copy:

```jsonc
"peerDependencies": {
  "@opencode-ai/plugin": "^1.1.30",
  "@earendil-works/pi-coding-agent": "^0.83.0",
  "typebox": "^1.1.38"
},
"peerDependenciesMeta": { /* all three optional: true */ }
```

**Every harness peer is optional.** The package installs and functions with none present; the harness is a capability discovered at load, not a dependency declared at install. One published tarball serves three hosts through three different discovery channels:

| Host | Discovery channel | Build target |
| --- | --- | --- |
| OpenCode | `exports["."]` → `dist/index.js`, registered via `"plugin": [...]` in `opencode.json` | `bun build --target bun` |
| [[pi-coding-agent]] | a top-level **`"pi"` manifest key** in `package.json` declaring `extensions` + `skills` | `bun build --target node` |
| Claude Code | a **generated branch** consumed via `.claude-plugin/marketplace.json` | separate CI build script |

Three lessons for anyone shipping to more than one agent host:

1. **Optional peers are the portability primitive.** They let you type against a host API without requiring it, and they let the consumer's package manager stay quiet about the two hosts they don't use. The alternative — separate `-opencode` / `-pi` packages — triples the release surface for content that is identical.
2. **Hosts differ in runtime, not just API.** OpenCode is a Bun host; Pi is a Node host. A single `--target bun` build would not have worked. If you keep an `engines.node` floor, the Node-targeted entry point is what makes it true.
3. **The type-system dependency travels with the host.** Pi's extension API is TypeBox-typed (`typebox` rides along as an optional peer) where OpenCode's is Zod-typed. Multi-harness support means carrying two schema libraries, and the tarball pays for both.

### The capability matrix that marks its own unknowns

The transferable artifact is `HARNESSES.md` — a 6-harness × 5-capability matrix shipped **inside the npm tarball** (`"files"` lists it next to `dist`), on a two-tier model: **Tier 1 shipped adapter** (OpenCode, Pi, Claude Code) vs **Tier 2 documented portability target** (Codex CLI, Gemini CLI, GitHub Copilot).

Two properties make it worth imitating:

- **Every cell carries a citation key** (`[OC-1]`, `[PI-7]`, `[CC-9]`) resolved by an Evidence registry section. Capability claims about somebody else's tool decay fast; a citation makes decay checkable.
- **Unverified cells say `UNVERIFIED`.** Codex CLI and Gemini CLI carry the literal token for subagent delegation and task tracking. A blank cell is indistinguishable from a false claim; an explicit `UNVERIFIED` is honest and actionable. This is the same discipline as marking a survey finding "data unavailable" rather than omitting it.

**The matrix is also where the marketing claim gets corrected.** The README says skill and agent content is "identical across all three." True — and capability parity is not. Pi has *no* native blocking-question tool and *no* native task-tracking mechanism (prose fallbacks documented for both); Claude Code ships **no `systematic_skill` tool at all**, using its native Skill tool instead, and has deprecated `TodoWrite` in favour of `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`. The generalization: **content portability and capability portability are different claims, and a multi-harness package should state which one it is making.** Skills written to assume a tool exists are not portable; skills written to describe a fallback are.

The honest limit case is recorded in the same repo as open issue **#854**: the workflow guard — the single largest subsystem — is OpenCode-only *because of its state model*, not because other harnesses can't host it. Parity claims should be scoped to what actually crossed.

## A Workflow Plugin That Ships a WASM Shell Parser (2026-09-05)

[[marcusrbrown--systematic]] v3 added `tree-sitter-bash` 0.25.1 and `web-tree-sitter` 0.27.0 as **runtime `dependencies`**, in a package whose entire prior runtime footprint was `js-yaml` + `jsonc-parser` + `zod`.

The consumer is the receipt/guard subsystem — `receipt-classifier.ts` (36 KB) has to decide what a shell command the agent *actually ran* did, and you cannot classify bash by regex without being wrong in the cases that matter (quoting, substitution, redirection, chained operators). Choosing a real grammar is the correct call.

Record it anyway as a **cost that plugin authors under-price**: a plugin loaded into every agent session now carries a WASM grammar and a parser runtime. That is install size, cold-start time, and two more supply-chain edges in the highest-trust position in the system. The trade is defensible for command classification specifically; it would not be for anything smaller. When a plugin's runtime dependency list grows a native/WASM component, it has changed category — from configuration to infrastructure — and deserves the scrutiny that implies.

## A Bundled Skill That Is a Build Artifact of an npm Package (2026-09-05)

In [[marcusrbrown--systematic]], `skills/agent-browser/` is not authored — it is **generated** from the `agent-browser` npm package (devDependency, pinned 0.34.0) by `scripts/generate-agent-browser-skill.ts`, with an `agent-browser:drift` check running as its own step in the `Build` job.

This is distinct from vendoring, and better:

- **Vendoring** copies content once and lets it rot silently.
- **Generation + drift gate** makes the copy reproducible and makes staleness a build failure. A Renovate bump of `agent-browser` cannot merge without regenerating the skill.

The repo runs six such gates in one job — content integrity, Claude Code plugin build + integrity, agent-browser skill drift, registry drift, config-schema drift, and review-artifact-schema drift — plus a `postupgrade` script that regenerates all of them in one command so Renovate's `postUpgradeTasks` can close the loop automatically.

**The rule: any committed artifact derived from a pinned dependency needs a drift check, or the pin and the artifact will disagree and nothing will say so.** Systematic supplies its own counter-example in the same manifest — `biome.json` declares `$schema` for **2.5.1** while `@biomejs/biome` is pinned at **2.5.11**. That pair has drifted three times now (fixed at #533 → 2.4.16, #571 → 2.5.1, drifted again) because it is the one derived-from-a-pin relationship in the repo with *no* generator and *no* gate. The same class recurs in [[marcusrbrown--opencode-copilot-delegate]]. Hand-maintained version echoes do not stay in sync; generated ones do.

## Schema Fingerprints Survive Refactors; Structural Probes Do Not (2026-09-05)

A direct follow-up to the fingerprinting rule adopted on 2026-09-04 (below), and an unusually fast confirmation of it. [[fro-bot--systematic]] measured Systematic's deployed config schema on 2026-09-04 and, on finding that four surveys of "top-level property count" had been measuring a header, adopted a byte/`definitions`/hash fingerprint. Re-measured **24 hours later** from the source-side survey:

| Metric | 2026-09-04 | 2026-09-05 |
| --- | --- | --- |
| Bytes | 38,180 | **58,954** (+54%) |
| `definitions` | 74 | **100** |
| Top-level properties | 10 | **12** (`+profile`, `+profiles`) |
| `sha256[:16]` | `0e82797b9f8f43ed` | **`1f9b7c48a4b6455c`** |

Two things happened at once, and separating them is the finding:

1. **A feature landed** (`v3.16.0`, named model profiles with per-harness routing) — visible in every metric.
2. **The generator's emission shape changed.** The schema now wraps top-level objects in `allOf` + `$ref` composition. `properties.agents` and `properties.categories` are now `$ref`s into `definitions`, so a shallow read of `additionalProperties`, `propertyNames`, or key-count on either **returns nothing at all**.

The 09-04 structural observations (`agents` as a closed 74-key enumeration with `additionalProperties: false`; `categories` open-keyed via `propertyNames`) **cannot be reproduced by the same probe today**. The underlying asymmetry may well be intact — it moved behind an indirection, and this survey does not claim it was removed.

**The rule: a structural probe measures the generator's current emission style, not the schema's semantics.** Generators refactor — `$ref` extraction, `allOf` composition, `$defs` migration — without any intent to change meaning, and every such refactor silently zeroes a probe that walked the old shape. A probe that returns `0` and a probe that returns "correctly zero" are indistinguishable at the call site.

Practical guidance for tracking a generated schema across surveys:

- **Fingerprint for change detection** (bytes, `definitions` count, content hash). Cheap, total, refactor-proof, and it tells you *that* something moved.
- **Resolve `$ref`s before asserting structure.** Any claim about `additionalProperties` or key sets must deref through `definitions`/`$defs` and `allOf` first, and should record the resolution depth it used.
- **Treat an empty structural read as "instrument broken" until proven otherwise**, never as "constraint removed."

### A schema that encodes a trust boundary

The new `profiles` property carries this description, and it is the most security-relevant line in the artifact:

> Named routing-only overlay bundles, selectable by name via the profile field. Only valid in user config or `OPENCODE_CONFIG_DIR` config — **a project config may select a profile but may not define this field.**

A checked-out repository can *choose* a routing overlay but cannot *author* one. This is the correct direction for a plugin that merges configuration from multiple precedence sources: a cloned project cannot silently redirect the user's agents to a model of its choosing. It is the config-layer expression of the same untrusted-input posture the ecosystem's agent prompts take toward issue bodies — and notably it is enforced in the *schema*, where an IDE surfaces it, not only in the loader. Plugin authors merging user + project config should ask, for every property: **is this safe for a repository I just cloned to set?** Systematic answers it per-field.

## Related Pages

- [[marcusrbrown--systematic]] — Was the largest OpenCode plugin; **as of v3 a three-harness workflow system** (OpenCode + [[pi-coding-agent]] + Claude Code, all peers optional). v3 boundary is **`3.0.0`, 2026-07-17** (the earlier `v3.2.5`/07-22 reading was a downstream artifact); catalog contracted 104 → 73 components (37 agents / 31 skills); discovered-skills-as-slash-commands added v2.33.0
- [[pi-coding-agent]] — Second Tier 1 harness; bounded delegate (20 turns, depth-1, `noExtensions`), no native blocking-question or task-tracking primitive
- [[fro-bot--systematic]] — Documentation deployment target for `@fro.bot/systematic`
- [[marcusrbrown--opencode-copilot-delegate]] — Copilot CLI delegation plugin
- [[fro-bot--space-bus]] — Workspace agent bus, now a **published plugin** (`@fro.bot/space-bus` v0.15.0): six `bus_*` tools + one directory-routed `opencode serve` + MCP facade + managed-server lifecycle + CI-enforced browser-safe library subpaths (now exposing `messages`/`questions`/`answerQuestion` + dispatch message correlation)
- [[marcusrbrown--cortexkit-anthropic-auth]] — Claude Pro/Max OAuth, fallback accounts, quota routing, Cloudflare Worker relay for OpenCode and Pi. Fro Bot was active at v0.45.0 (2026-06-09) and is **`disabled_inactivity` as of 2026-09-02**; the fork is frozen at `1.2.5-mb.3` and 334 commits / 32 releases behind upstream `cortexkit/anthropic-auth` (`v1.21.0`, actively maintained). Contributes the cross-process OAuth refresh-lock and plugin-singleton prior art above, plus the dangling-dist-tag decommissioning rule
- [[marcusrbrown--dotfiles]] — Agent skill configuration (`~/.agents/skills/`), consumes systematic as installed plugin
- [[github-actions-ci]] — CI patterns for plugin repositories (Biome, bun test, semantic-release)
- [[github-pages]] — GitHub Pages deployment patterns including cross-repo Starlight deploy
