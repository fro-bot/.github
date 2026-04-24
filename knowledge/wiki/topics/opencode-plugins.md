---
type: topic
title: OpenCode Plugin Development
created: 2026-04-23
updated: 2026-04-23
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
tags: [opencode, plugin, sdk, subprocess, async, delegation]
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

## Known Patterns

| Pattern | Description | Reference |
|---------|-------------|-----------|
| Delegation | Spawn CLI subprocess, return task_id, inject notification on completion | [[marcusrbrown--opencode-copilot-delegate]] |
| PTY notification | Inject messages via `client.session.prompt()` for process I/O | `shekohex/opencode-pty` |
| Agent discovery | Scan `~/.copilot/agents/*.md` and `<cwd>/.github/agents/*.md` for available agents | [[marcusrbrown--opencode-copilot-delegate]] |

## Related Pages

- [[marcusrbrown--opencode-copilot-delegate]] — First OpenCode plugin in Marcus's portfolio
- [[marcusrbrown--dotfiles]] — Agent skill configuration (`~/.agents/skills/`)
- [[github-actions-ci]] — CI patterns for plugin repositories (Biome, bun test, changesets)
