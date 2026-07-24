---
type: topic
title: OpenCode Plugin Development
created: 2026-04-23
updated: 2026-07-22
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
tags: [opencode, plugin, sdk, subprocess, async, delegation, workflow, skills, agents, tui, rpc, orphan-reaper, plugin-singleton, json-schema, oauth, anthropic, cross-process-lock, zod-config, bundled-names, deprecation-surface, upstream-sync-skill, fro-bot-workflow, custom-tools, opencode-server, directory-routing, mcp, agent-bus, browser-safe-subpaths, managed-server, subpath-loader-resolution]
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
| [[fro-bot--space-bus]] | `@fro.bot/space-bus` | Workspace agent bus — a control agent tasks per-project agents over one directory-routed `opencode serve`; MCP facade + browser-safe library subpaths | Bun, Biome, zod v4, Changesets + npm OIDC | Active, **v0.13.1** (6 tools: bus_roster/task/status/result/wait/registry) |

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

Schema is draft-07, describes top-level keys `agents`, `categories`, `disabled_skills`, `disabled_agents`, `disabled_commands`, `bootstrap`, and (since systematic v2.33.0) `skills_as_commands`. The schema's own `$schema` property is documented as informational only — the systematic loader does not fetch or validate against it; it exists purely to switch on editor support. The same docs deploy drives the OCX registry, the rendered guide pages, and this schema — three different consumer contracts living on one `gh-pages` branch.

**Breaking-path precedent confirmed (2026-07-22 [[fro-bot--systematic]] survey):** when the plugin crossed the **v2 → v3 major**, the schema host **dropped `schemas/v2/` entirely** (it now returns HTTP 404) and replaced it with `schemas/v3/`; `latest/`'s `$id` re-pointed to the v3 URL. Majors replace the versioned path wholesale — they do **not** co-serve old majors. Any consumer that pinned `"$schema"` to a `vN` URL silently loses autocomplete/validation at the next major (no error surfaced). Lesson: pin `latest/` for a floating contract, or expect to re-pin `vN` at each major. The same v2 → v3 crossing contracted the OCX registry catalog from 104 → 73 components (agents 51 → 37, skills 48 → 31) — the first component *contraction* observed, a source-side curation event rather than growth.

## Bundled Skill for Upstream Sync (cortexkit_anthropic-auth pattern)

[[marcusrbrown--cortexkit-anthropic-auth]] ships a `.agents/skills/anthropic-auth-upstream-release/SKILL.md` in the repo root. OpenCode's `.agents/` discovery path picks it up automatically for any agent working in that repo, giving the agent explicit procedural context for upstream sync operations and fork-invariant release cutting.

This is the first instance in the Marcus ecosystem of a repo-local skill scoped to a specific operational domain (upstream-sync / fork-release) rather than a general-purpose engineering skill. Pattern notes:

- Skill is named after the operation domain, not the repo — `anthropic-auth-upstream-release` is meaningful outside the repo's own slug.
- Covers only upstream sync + fork release; ordinary feature work is explicitly out of scope, preventing skill over-reach.
- Encodes all fork invariants (package names, version lane, npm publish rules) in one place so agents and human contributors see the same guardrails.

Contrast with [[marcusrbrown--systematic]] which ships general-purpose skills (`ce:plan`, `ce:work`, etc.) distributed for consumption by other OpenCode users — the cortexkit-auth pattern is internal/operational, not distributable.

## Related Pages

- [[marcusrbrown--systematic]] — Largest OpenCode plugin; structured workflows; **crossed v2 → v3 major (v3.2.5, 2026-07-22)** with catalog contraction 104 → 73 components (confirmed downstream via [[fro-bot--systematic]]); discovered-skills-as-slash-commands added v2.33.0
- [[fro-bot--systematic]] — Documentation deployment target for `@fro.bot/systematic`
- [[marcusrbrown--opencode-copilot-delegate]] — Copilot CLI delegation plugin
- [[fro-bot--space-bus]] — Workspace agent bus, now a **published plugin** (`@fro.bot/space-bus` v0.13.1): six `bus_*` tools + one directory-routed `opencode serve` + MCP facade + managed-server lifecycle + CI-enforced browser-safe library subpaths
- [[marcusrbrown--cortexkit-anthropic-auth]] — Claude Pro/Max OAuth, fallback accounts, quota routing, Cloudflare Worker relay for OpenCode and Pi; Fro Bot active at v0.45.0 (as of 2026-06-09)
- [[marcusrbrown--dotfiles]] — Agent skill configuration (`~/.agents/skills/`), consumes systematic as installed plugin
- [[github-actions-ci]] — CI patterns for plugin repositories (Biome, bun test, semantic-release)
- [[github-pages]] — GitHub Pages deployment patterns including cross-repo Starlight deploy
