---
type: topic
title: OpenCode Plugin Development
created: 2026-04-23
updated: 2026-04-24
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/systematic
    sha: ef02119abd801487dc0e53a43ac2d6b6433873ab
    accessed: 2026-04-24
tags: [opencode, plugin, sdk, subprocess, async, delegation, workflow, skills, agents]
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
| OCX registry | Component-level distribution via ocx CLI with named profiles | [[marcusrbrown--systematic]] |

## Marcus's Plugin Repos

| Repo | npm Package | Purpose | Stack |
|------|-------------|---------|-------|
| [[marcusrbrown--systematic]] | `@fro.bot/systematic` | Structured engineering workflows (45 skills, 50 agents) | Bun, Biome, semantic-release |
| [[marcusrbrown--opencode-copilot-delegate]] | `opencode-copilot-delegate` | Delegate tasks to Copilot CLI as background subprocesses | Bun, Biome, Changesets |

Both plugins use Bun + Biome (not the `@bfra.me/*` ESLint/Prettier stack), establishing this as the standard for Marcus's OpenCode plugin repos.

## Related Pages

- [[marcusrbrown--systematic]] — Largest OpenCode plugin; structured workflows with 45 skills and 50 agents
- [[marcusrbrown--opencode-copilot-delegate]] — Copilot CLI delegation plugin
- [[marcusrbrown--dotfiles]] — Agent skill configuration (`~/.agents/skills/`), consumes systematic as installed plugin
- [[github-actions-ci]] — CI patterns for plugin repositories (Biome, bun test, semantic-release)
