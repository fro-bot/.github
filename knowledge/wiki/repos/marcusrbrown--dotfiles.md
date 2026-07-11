---
type: repo
title: "marcusrbrown/.dotfiles"
created: 2026-04-18
updated: 2026-07-10
sources:
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 2f2d1e6ac04999c5e61ee054fc585d9542cd3a74
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: dbab7ad7d666f96e4fd0f1b2dd20937f39281a92
    accessed: 2026-04-21
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: ae026c179cd91cb637443fe7d92bed75df3d6dba
    accessed: 2026-04-22
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 0bb24f05e29fbd4c70eb9dca9611055e7bef7c5f
    accessed: 2026-05-24
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 70c211bc269b4bb8c476a3929fd976bc51153b1c
    accessed: 2026-06-06
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 4df0c2d66dfa697c4de345afcd4075dd8f8109ac
    accessed: 2026-06-16
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: debcb8e26da6977fb80d6f531bb9e956e129e0ee
    accessed: 2026-06-27
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: e8ebc5cc3736d0c6f9d21a574687457dfd4edbb6
    accessed: 2026-07-10
tags: [dotfiles, configuration, zsh, bash, mise, sheldon, starship, devcontainer, bare-git-repo, opencode, magic-context, copilot-cli, systematic, gitleaks, kimi-k2, harness, opencode-doctor, sqlite-maintenance, deepseek, ollama-distill]
aliases: [dotfiles]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--systematic
  - marcusrbrown--opencode-copilot-delegate
---

# marcusrbrown/.dotfiles

Marcus R. Brown's [[dotfiles]] repository. Uses a **bare git repository** pattern (`GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=$HOME`) to track shell and development environment configuration directly in `$HOME` without symlinks.

## Overview

- **Purpose:** Synchronize shell configuration and dev environment across machines
- **Default branch:** `main`
- **Created:** 2011-06-09
- **Last push:** 2026-07-10
- **License:** _Still undetectable (2026-07-10, SHA `e8ebc5c`):_ the GitHub License API continues to return `null` (`licenseInfo: null`) and no `LICENSE`/`UNLICENSE` file appears in the tree. This is now the **third consecutive survey** with no machine-detectable license (first flagged SHA `4df0c2d`, 2026-06-16). Prior surveys through SHA `70c211bc` (2026-06-06) recorded **The Unlicense (public domain)**. Treat license status as **unspecified**.
- **Topics:** `dotfiles`, `configuration`, `settings`, `preferences`, `zsh`, `sheldon`, `mise`, `starship`
- **Languages:** TypeScript (primary by size), Shell, Vim Script, Ruby, JavaScript
- **Open issues:** 6 (unchanged @ 2026-06-27)
- **Stars:** 20 (unchanged @ 2026-06-27)

## Repository Architecture

### Bare Git Repo Pattern

The repo uses an allowlist `.gitignore` — everything is ignored by default (`/*`), and tracked paths are explicitly un-ignored with `!/path` entries in `.dotfiles/.gitignore`. All git operations require the dotfiles alias:

```bash
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
.dotfiles git status
```

### Shell Configuration

Supports both Bash and Zsh. XDG-compliant — all configs live under `~/.config/`.

**Bash initialization chain:**

1. `.bashrc` sources `.config/bash/main`
2. `main` sources: `exports`, `functions`, `aliases`, `init.d/*`, `local.d/*`
3. `init.d/` files use numbered prefixes for ordering (e.g., `002-prompt.bash`)
4. `local.d/` for machine-specific overrides (gitignored)

**Zsh initialization chain:**

1. `.zshenv` sources `.config/zsh/.zshenv`
2. `.zshrc` uses Sheldon for plugin management with deferred loading and compiled cache
3. Prezto modules loaded for environment, history, directory

### Key Directories

| Directory               | Purpose                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `.config/bash/`         | Bash config: main entry, aliases, exports, functions, init.d/, completion.d/, local.d/ |
| `.config/zsh/`          | Zsh config and local plugin configs                                                    |
| `.config/sheldon/`      | Zsh plugin manager: `plugins.toml` (zsh), `plugins.bash.toml` (bash)                   |
| `.config/mise/`         | Tool version management: `config.toml`, `tasks/`                                       |
| `.config/git/`          | Global git config, ignore, attributes                                                  |
| `.config/starship.toml` | Cross-shell prompt (Catppuccin Mocha palette)                                          |
| `.claude/`              | Claude Code config: agents, commands, rules                                            |
| `.config/opencode/`     | OpenCode AI config (has own AGENTS.md)                                                 |
| `.devcontainer/`        | Devcontainer with custom features                                                      |
| `.dotfiles/`            | Bare repo metadata: .gitconfig, .gitignore, .prettierrc.yaml                           |
| `Brewfile`              | macOS Homebrew dependencies                                                            |
| `Library/LaunchAgents/` | macOS launch agents (`dev.mrbro.*` prefix)                                             |

### Tool Stack (via [[mise]])

Managed tool versions in `.config/mise/config.toml` (as of SHA `e8ebc5c`, 2026-07-10):

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.18.0       | Primary JS runtime                                        |
| python                        | 3.14.6        |                                                           |
| rust                          | 1.97.0        | Bumped from 1.96.0                                        |
| go                            | 1.26.5        | Bumped from 1.26.4                                        |
| bun                           | 1.3.14        | Used for npm package installs (`settings.npm.bun = true`) |
| deno                          | 2.9.2         | Bumped from 2.9.0                                         |
| zig                           | 0.15.2        | With ZLS 0.16.0                                           |
| pnpm                          | 11.10.0       | Bumped from 11.9.0                                        |
| npm                           | 11.18.0       | Bumped from 11.17.0                                       |
| prettier                      | 3.9.4 (npm)   | With `@bfra.me/prettier-config` 0.16.9; bumped from 3.8.4 |
| opencode-ai                   | 1.17.12 (npm) | Renovate updates disabled (manual); bumped from 1.17.4    |
| @fro.bot/harness              | 1.17.14-harness.e98fbc0f (npm) | Patched-OpenCode CLI from [[fro-bot--agent]]; bumped from `1.17.9-harness.bd89c818`. Tracks the agent's current harness base `1.17.14` |
| ast-grep                      | 0.43.0        | AST-aware search/replace                                  |
| typescript                    | 6.0.3 (npm)   |                                                           |
| playwright                    | 1.61.1 (npm)  |                                                           |
| puppeteer                     | 25.3.0 (npm)  | Browser automation; bumped from 25.2.0                    |
| agent-browser                 | 0.31.1 (npm)  | Browser automation CLI for agents; bumped from 0.29.1     |
| skills                        | 1.5.15 (npm)  | Agent skills package; bumped from 1.5.13                  |
| ocx                           | 2.0.11 (npm)  | OpenCode extension runner                                 |
| @github/copilot               | 1.0.68 (npm)  | GitHub Copilot CLI; bumped from 1.0.64                    |
| @marcusrbrown/infra           | latest (npm)  | Personal infra CLI                                        |
| @biomejs/biome                | 2.5.2 (npm)   | Bumped from 2.5.1                                         |
| vibe-tools                    | 0.63.3 (npm)  | Vibe coding tools                                         |
| @anthropic-ai/claude-code     | 2.1.128 (npm) | Renovate updates disabled; bumped from 2.1.112            |
| shfmt (aqua:mvdan/sh)         | 3.13.1        | Shell formatter                                           |
| gitleaks (aqua:gitleaks)      | 8.30.1        | Secret scanner                                            |
| cargo-binstall                | 1.20.1        | Cargo binary installer                                    |
| tsx                           | 4.23.0 (npm)  | TypeScript execution; bumped from 4.22.4                  |
| rimraf                        | 6.1.3 (npm)   | Deep deletion utility                                     |
| pyright                       | 1.1.411 (npm) | Python type checker; bumped from 1.1.410                  |
| typescript-language-server    | 5.3.0 (npm)   | TypeScript language server                                |
| pipx:poetry                   | 2.4.1         | Python packaging                                          |

**Harness bump (SHA `e8ebc5c`, surveyed 2026-07-10):** `@fro.bot/harness` advanced `1.17.9-harness.bd89c818` → `1.17.14-harness.e98fbc0f`, continuing to track the [[fro-bot--agent]] harness base rebase (now `1.17.14`). The mise pin still mirrors the patched-OpenCode CLI the agent runtime runs, though stock `opencode-ai` (1.17.12) now sits one minor behind the harness base line.

**Harness bump (SHA `4b0c4d1`/`#1903`, surveyed 2026-06-27):** `@fro.bot/harness` advanced `1.17.6-harness.13169873` → `1.17.9-harness.bd89c818`, tracking the [[fro-bot--agent]] rebase of the harness base from `1.17.6` to `1.17.9` (SQLite-reliability carries). The mise pin and the agent's `DEFAULT_OPENCODE_VERSION` are now aligned on the same harness build — the local machine and CI runtime run the identical patched OpenCode binary.

**Notable addition (SHA `4df0c2d`, 2026-06-16):** `@fro.bot/harness` joined `[tools]` — Marcus pins the Fro Bot harness build (the patched-OpenCode CLI published by [[fro-bot--agent]]) directly in mise, alongside stock `opencode-ai@1.17.4`. This is the local-machine mirror of the harness-as-default-OpenCode cutover happening in the agent runtime.

**Notable removals from prior ingest (SHA `ae026c1`):** `@cortexkit/opencode-magic-context` and `@cortexkit/aft-opencode` are no longer in `[tools]` — they moved to the OpenCode `plugin` array in `opencode.json` (managed by a new Renovate custom manager for pinned npm plugin versions). `remark-language-server` and `lolcrab` entries dropped from mise config.

**Env additions:** `UV_SYSTEM_CERTS=true`, `NPM_TOKEN` templated from env, and a redacted env file pulled from `~/.config/mise/.env.local`.

#### Historical Snapshot (SHA `0bb24f0`, 2026-05-24)

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.16.0       | Primary JS runtime                                        |
| python                        | 3.14.5        |                                                           |
| rust                          | 1.95.0        |                                                           |
| go                            | 1.26.3        |                                                           |
| bun                           | 1.3.14        | Used for npm package installs (`settings.npm.bun = true`) |
| deno                          | 2.8.0         |                                                           |
| zig                           | 0.15.2        | With ZLS 0.16.0                                           |
| pnpm                          | 11.2.1        | Major bump from 10.x                                      |
| npm                           | 11.15.0       |                                                           |
| opencode-ai                   | 1.15.5 (npm)  | Renovate updates disabled                                 |
| agent-browser                 | 0.27.0 (npm)  | Browser automation CLI for agents                         |
| skills                        | 1.5.7 (npm)   | Agent skills package                                      |
| @github/copilot               | 1.0.51 (npm)  | GitHub Copilot CLI (new)                                  |
| @biomejs/biome                | 2.4.15 (npm)  |                                                           |
| tsx                           | 4.22.3 (npm)  | TypeScript execution                                      |
| pyright                       | 1.1.409 (npm) | Python type checker                                       |
| typescript-language-server    | 5.2.0 (npm)   | TypeScript language server                                |
| rust                          | 1.95.0        |                                                           |
| go                            | 1.26.3        |                                                           |
| pnpm                          | 11.2.1        |                                                           |

#### Historical Snapshot (SHA `ae026c1`, 2026-04-22)

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.15.0       | Primary JS runtime                                        |
| python                        | 3.14.4        |                                                           |
| rust                          | 1.95.0        |                                                           |
| go                            | 1.26.2        |                                                           |
| bun                           | 1.3.13        | Used for npm package installs (`settings.npm.bun = true`) |
| deno                          | 2.7.13        | Bumped from 2.7.12 via Renovate                          |
| zig                           | 0.15.2        | With ZLS 0.15.0                                           |
| pnpm                          | 10.33.0       |                                                           |
| npm                           | 11.12.1       |                                                           |
| prettier                      | 3.8.3 (npm)   | With `@bfra.me/prettier-config`                           |
| opencode-ai                   | 1.14.18 (npm) | Renovate updates disabled                                 |
| ast-grep                      | 0.40.5        | AST-aware search/replace                                  |
| typescript                    | 6.0.3 (npm)   |                                                           |
| playwright                    | 1.59.1 (npm)  |                                                           |
| puppeteer                     | 24.41.0 (npm) | Browser automation                                        |
| agent-browser                 | 0.26.0 (npm)  | Browser automation CLI for agents                         |
| skills                        | 1.5.1 (npm)   | Agent skills package                                      |
| ocx                           | 2.0.7 (npm)   | OpenCode extension runner                                 |
| @cortexkit/opencode-magic-context | 0.13.0 (npm) | Context management plugin (bumped from 0.12.0)       |
| @cortexkit/aft-opencode       | 0.14.0 (npm)  | AFT OpenCode plugin                                       |
| @marcusrbrown/infra            | latest (npm)  | Personal infra CLI                                         |
| @biomejs/biome                | 2.4.12 (npm)  | Re-added; was removed in prior ingest                     |
| vibe-tools                    | 0.63.3 (npm)  | Vibe coding tools (new)                                   |
| @anthropic-ai/claude-code     | 2.1.112 (npm) | Present but Renovate updates disabled                      |
| shfmt                         | 3.13.1 (aqua) | Shell formatter                                           |
| cargo-binstall                | 1.15.5        | Cargo binary installer                                    |
| tsx                           | 4.21.0 (npm)  | TypeScript execution (new)                                |
| rimraf                        | 6.1.3 (npm)   | Deep deletion utility (new)                               |
| pyright                       | 1.1.409 (npm) | Python type checker (new)                                  |
| remark-language-server        | 3.0.0 (npm)   | Markdown language server (new)                             |
| typescript-language-server    | 5.1.3 (npm)   | TypeScript language server (new)                          |
| lolcrab                       | 0.4.1 (github:mazznoer/lolcrab) | Rainbow coloring tool (new)                   |
| pipx:poetry                   | 2.3.4         | Python packaging (new)                                    |

Mise tasks defined in `tasks/dotfiles.toml` and `tasks/_mise.toml` — includes `format`, `install`, `opencode:doctor`.

### Zsh Plugin Stack (Sheldon)

Key plugins in `.config/sheldon/plugins.toml`:

- **zsh-defer** — Deferred loading for faster startup
- **zsh-autosuggestions** — Fish-like suggestions (async, strategy: history + completion)
- **fast-syntax-highlighting** — Syntax highlighting (work dir: `$XDG_CONFIG_HOME/fsh`)
- **zsh-history-substring-search** — History search with arrow key bindings
- **zsh-snap (znap)** — Lazy eval for mise, starship, rustup, cargo completions
- **Prezto** — Modules: environment, history, directory
- **zsh-utils** — Editor and completion
- **brew-keeper** — Homebrew maintenance (deferred)
- **ssh (zpm)** — SSH agent management
- **vscode-shell-integration** — VS Code terminal integration (conditional)
- **shellfish** — Secure Shellfish iOS SSH support

Custom Sheldon templates: `defer`, `inline`, `pretzo`, `source`, `znap`.

### Starship Prompt

Catppuccin Mocha palette. Custom format with powerline segments:

```
[username][directory][git_branch+status][language modules][cmd_duration][jobs][time][status]
```

Disabled modules: battery, gcloud, package, line_break. Command timeout: 1500ms.

### Git Configuration

Global config at `.config/git/config`:

- GPG signing enabled (`commit.gpgSign = true`)
- Rebase by default (`branch.autoSetupRebase = always`)
- Fast-forward only merges (`merge.ff = only`)
- Auto-prune on fetch (`fetch.prune = true`)
- Untracked cache enabled for performance
- LFS configured
- URL aliases: `gh:` for `git@github.com:`, `gst:` for gists
- `useConfigOnly = true` — requires explicit user config
- Includes `.gitconfig.local` for machine-specific settings

### macOS Tooling (Brewfile)

Notable brew packages: `bat`, `fzf`, `ripgrep`, `lsd`, `fd`, `git-delta`, `starship`, `gh`, `jq`, `shellcheck`, `shfmt`, `tmux`, `gnupg`, `pinentry-mac`, `wireguard-tools`.

Nerd fonts: FiraCode, FiraMono, JetBrains Mono, MesloLG, SauceCodePro.

Casks: Firefox, iTerm2, Raycast, Slack, Ghidra, Arduino IDE, HiddenBar.

Mac App Store: Xcode, Home Assistant, Draw Things, Data Jar, Apple Configurator.

VS Code extensions: 90+ extensions covering themes, language support, DevOps, AI (Copilot, Cody, Fig).

### Privacy-Focused Defaults

Telemetry disabled where possible:

- `HOMEBREW_NO_ANALYTICS=1`
- `PLATFORMIO_SETTING_ENABLE_TELEMETRY=No`
- `VIBE_TOOLS_NO_TELEMETRY=1`

### AI Agent Configuration

The repo includes configuration for multiple AI coding agents:

- **Claude Code** (`.claude/`): Custom agents (dotfiles-reviewer), commands, rules, `settings.json`
- **OpenCode** (`.config/opencode/`): Has its own `AGENTS.md`, plus `agents/`, `commands/`, `scripts/`, `skills/`, `profiles/`, `ocx.jsonc`
- **AGENTS.md** at repo root: Comprehensive project knowledge base for AI agents; refreshed at `90742fb` via `/init-deep`

#### OpenCode Plugin Ecosystem (as of SHA `e8ebc5c`, 2026-07-10)

OpenCode plugins are pinned by version directly in `.config/opencode/opencode.json` (managed by a Renovate custom manager that matches `"name@x.y.z"` patterns inside `opencode.json` / `tui.json`):

| Plugin | Version | Purpose |
| --- | --- | --- |
| `@cortexkit/opencode-anthropic-auth` | 1.13.0 | Anthropic auth provider — upstream cortexkit package; bumped from 1.10.3 |
| `oh-my-opencode-slim` | 1.1.2 | Slimmed multi-agent routing layer |
| `@cortexkit/opencode-magic-context` | 0.31.5 | Adaptive context management; bumped from 0.26.0 |
| `@cortexkit/aft-opencode` | 0.46.0 | AFT (Adaptive Fine-Tuning) OpenCode plugin; bumped from 0.39.4 |
| `@fro.bot/systematic` | 2.33.2 | Systematic skills + agents; bumped from 2.32.1 (see [[marcusrbrown--systematic]]) |

**`opencode-copilot-delegate` dropped from headless `opencode.json` (SHA `e8ebc5c`, 2026-07-10):** The `plugin` array no longer lists `opencode-copilot-delegate@0.12.0`. It was present in both `opencode.json` and `tui.json` at SHA `debcb8e`; it is absent from `opencode.json` here. Copilot-CLI delegation now flows through the repo-scoped `copilot-cli` skill and the new `copilot-cloud-agent` skill rather than a loaded plugin. See [[marcusrbrown--opencode-copilot-delegate]] — the sibling repo still exists, but this repo no longer wires it as a headless plugin.

**Auth plugin steady on upstream cortexkit (SHA `e8ebc5c`, 2026-07-10):** `@cortexkit/opencode-anthropic-auth` continues climbing the upstream version line — now **1.13.0** (was 1.10.3 @ 2026-06-27). Third consecutive survey on the upstream fork; Marcus's own fork `@marcusrbrown/opencode-anthropic-auth` remains unreferenced. The [[marcusrbrown--cortexkit-anthropic-auth]] fork repo may still exist, but this repo no longer consumes it.

**Default model declaration removed (SHA `e8ebc5c`, 2026-07-10):** `opencode.json` no longer carries a top-level `"model"` key. The `"model": "opencode-go/kimi-k2.6"` default recorded through 2026-06-27 is gone — default routing is now delegated entirely to the `oh-my-opencode-slim` preset stack (active `mixed` preset → `anthropic/claude-opus-4-8` orchestrator) rather than a hard-coded headless default.

**Agents disabled in `opencode.json`:** `general` and `explore` remain explicitly disabled (`"disable": true`).

**`tavily` MCP server removed (SHA `e8ebc5c`, 2026-07-10):** The MCP set drops from four to **three** remote servers: `context7`, `grep_app`, `websearch` (Exa). `tavily` is gone from the `mcp` block. `websearch` moved its Exa API key and tool selection into the URL query string (`?exaApiKey={env:EXA_API_KEY}&tools=web_search_exa`); `context7` still authenticates via `CONTEXT7_API_KEY` header. Note: OMO-slim `librarian` presets still list `tavily` in their `mcps` array, so that reference is now stale relative to the actual MCP registration — a minor drift worth flagging on the next config pass.

**Discord MCP server removed (SHA `4df0c2d`):** The Docker-based `saseq/discord-mcp` server documented at SHA `70c211bc` is gone from `opencode.json`.

**Custom OpenAI provider models removed (SHA `4df0c2d`):** The inline `openai/gpt-5.5` and `openai/gpt-5.5-fast` `provider` model declarations recorded at SHA `70c211bc` are no longer present in `opencode.json` (slimmed; those model ids now resolve via provider defaults / the slim preset stack). `compaction` remains `auto: false`, `prune: false`; `experimental.openTelemetry: false`; `lsp: true`.

**Config files in `.config/opencode/` (SHA `e8ebc5c`, 2026-07-10):**
- `aft.jsonc` — **removed.** The dedicated AFT config file (documented through 2026-06-27 with `restrict_to_project_root: false`, `search_index`/`semantic_search: false`, `bridge.hang_threshold`) is gone (404). `@cortexkit/aft-opencode@0.46.0` now runs on plugin defaults.
- `magic-context.jsonc` — **removed.** The extensive per-model historian/dreamer/cache-TTL/threshold config (documented in detail below through 2026-06-27) is gone (404). `@cortexkit/opencode-magic-context@0.31.5` now runs on plugin defaults. This is a material simplification: two of the most heavily tuned config surfaces in the repo were deleted in one window, deferring behavior to upstream plugin defaults.
- `systematic.jsonc` — Systematic skills configuration file. **Expanded (SHA `e8ebc5c`):** now carries a `categories` block (design → `github-copilot/gemini-3.5-flash`, docs → `opencode-go/kimi-k2.7-code`, document-review → `github-copilot/gpt-5.4-mini`, research → `opencode-go/minimax-m3`, review → `opencode-go/deepseek-v4-flash`) and an `agents` block (repo-research-analyst → `opencode-go/minimax-m3`, spec-flow-analyzer → `github-copilot/gemini-3.5-flash`, systematic-implementer → `anthropic/claude-sonnet-5` temp 0.1). Systematic model routing is now declared here, filling the config gap left by the magic-context/aft deletions.

**`tui.json` reduced to theme-only (SHA `e8ebc5c`, 2026-07-10):** `tui.json` no longer carries a `plugin` array. It is now `{ "theme": "catppuccin" }` and nothing else. The separate TUI plugin stack documented through 2026-06-27 (slim/magic-context/aft/copilot-delegate) is gone — the TUI now inherits the single `opencode.json` plugin set instead of maintaining a divergent list.

#### Historical Plugin Snapshot (SHA `70c211bc`, 2026-06-06) — superseded

At `70c211bc` the auth plugin was `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (own fork), magic-context 0.22.4, aft 0.35.4, systematic 2.28.0, slim 1.1.1. A Discord MCP (`saseq/discord-mcp:1.0.0`, disabled) and inline custom `openai/gpt-5.5[-fast]` provider models were declared. All superseded by the table above.

#### Historical Plugin Snapshot (SHA `ae026c1`, 2026-04-22)

Previous stack — superseded by the table above. `oh-my-openagent` (3.17.4) and `@franlol/opencode-md-table-formatter` were removed; `oh-my-opencode-slim` replaces the multi-agent router. The Anthropic auth plugin migrated from `@ex-machina/*` to `@cortexkit/*` and downshifted from 1.7.4 to 1.2.2 (different package line). `opencode-copilot-delegate` joined the stack, consuming the sibling repo published as v0.12.0.

**MCP servers configured:**

| Server | URL | Purpose |
| --- | --- | --- |
| `context7` | `https://mcp.context7.com/mcp` | Documentation and context retrieval |
| `grep_app` | `https://mcp.grep.app` | Code search across GitHub repos |
| `tavily` | `https://mcp.tavily.com/mcp/` | Web search |
| `websearch` | `https://mcp.exa.ai/mcp` | Exa web search |

**OpenCode compaction:** `auto: false`, `prune: false` — compaction handled by magic-context plugin instead.

#### Magic Context Configuration (`.config/opencode/magic-context.jsonc`, SHA `70c211bc`, 2026-06-06)

The `opencode-magic-context` plugin (0.22.4) provides adaptive context compaction with model-specific thresholds:

- **Historian**: `openai/gpt-5.5` (fallbacks: `anthropic/claude-sonnet-4-6`, `github-copilot/claude-sonnet-4.6`) — temperature 0.1, variant medium, tool permissions hard-denied (`bash`, `webfetch`, `edit`). **Note:** Historian now uses `openai/gpt-5.5` (full, not fast) vs prior `openai/gpt-5.5-fast`.
- **Dreamer**: `anthropic/claude-sonnet-4-6` (fallbacks: `openai/gpt-5.4-mini`, `github-copilot/claude-sonnet-4.6`) — schedule `00:00-08:00`, `inject_docs: true`, `pin_key_files` (20k tokens, min 4 reads), `user_memories` (promotion threshold 3)
- **Sidekick**: disabled
- **Cache TTL**: 5m default; 59m for `anthropic/claude-sonnet-4-6`, `anthropic/claude-opus-4-6`, `anthropic/claude-opus-4-7`, **`anthropic/claude-opus-4-8`** (new)
- **Execute thresholds (%)**: 65 default; 55 for Anthropic Sonnet/Opus (4-6, 4-7); 80 for `openai/gpt-5.5`
- **Execute thresholds (tokens)**: `github-copilot/claude-opus-4.7` 80K, `github-copilot/claude-sonnet-4.6` 95K
- **Memory**: `auto_search` (min 20 chars, score ≥ 0.55), `git_commit_indexing` (365 days, max 2000 commits), injection budget 6000 tokens
- **New settings**: `temporal_awareness: true`, `caveman_text_compression: false`, `auto_drop_tool_age: 30`, `history_budget_percentage: 0.15`, `historian_timeout_ms: 420000`
- **`system_prompt_injection`**: enabled; skips injection when system prompt contains "You are the Council agent — a multi-LLM"

**Delta (SHA `a159c44`/`#1932`, 2026-06-27):** Plugin version 0.24.1 → 0.26.0. **Historian primary model switched** `openai/gpt-5.5` → **`opencode-go/deepseek-v4-flash`** — the cheap/fast `opencode-go` DeepSeek model now drives summarization, with `openai/gpt-5.5` demoted to first fallback (full chain: `gpt-5.5` → `anthropic/claude-sonnet-4-6` → `github-copilot/claude-sonnet-4.6`). New short-window cache TTLs added: `openai/gpt-5.5` and `openai/gpt-5.5-fast` both `10m`; both also gained `execute_threshold_percentage: 80`. `embedding.provider: "off"` recorded (no semantic embeddings) — consistent with the AFT `search_index`/`semantic_search` shutoff. Dreamer/Sidekick unchanged.

**Delta (SHA `4df0c2d`, 2026-06-16):** Plugin version 0.22.4 → 0.24.1. Historian/Dreamer/Sidekick model assignments unchanged. `anthropic/claude-fable-5` added to the 59m cache-TTL list (alongside Sonnet 4-6, Opus 4-6/4-7/4-8). Execute thresholds, memory, and `temporal_awareness`/`system_prompt_injection` blocks unchanged.

**Delta from prior ingest (SHA `0bb24f0`):** Historian model changed from `openai/gpt-5.5-fast` to `openai/gpt-5.5` (full model). `anthropic/claude-opus-4-8` added to 59m cache TTL. `temporal_awareness` flag added. `system_prompt_injection` block added (Council agent exclusion). Plugin version 0.21.8 → 0.22.4.

**Earlier delta (SHA `ae026c1`):** Historian migrated from `github-copilot/gpt-5.4` to `openai/gpt-5.5-fast`. Dreamer reverted to direct Anthropic model. Sidekick disabled outright. Plugin version 0.13.0 → 0.21.8.

#### oh-my-opencode-slim Routing (SHA `e8ebc5c`, 2026-07-10)

Config at `.config/opencode/oh-my-opencode-slim.jsonc` (plugin 1.1.2). Active preset: **`mixed`**. Still 4 named presets (`openai`, `opencode-go`, `copilot`, `mixed`). The `designer`/`fixer` skill triple `["agent-browser", "impeccable", "systematic:*"]` is unchanged across all presets.

**Model migration to the `claude-*-5` / `gemini-3.5-flash` line (SHA `e8ebc5c`, 2026-07-10):** Anthropic Sonnet references moved off `claude-sonnet-4-6` onto **`claude-sonnet-5`** (fixer + council alpha), and `designer` moved off `github-copilot/gemini-3.1-pro-preview` onto **`github-copilot/gemini-3.5-flash`** across presets. The `mixed` orchestrator gained an explicit **`variant: xhigh`** (was unmarked). Fixer also gained `variant: low`.

**Active `mixed` preset agent assignments:**

| Agent | Model | Notes |
| --- | --- | --- |
| orchestrator | `anthropic/claude-opus-4-8` | `variant: xhigh` (new); all skills + MCPs except context7 |
| oracle | `openai/gpt-5.5-fast` | `variant: high`; systematic skills only |
| council | `openai/gpt-5.5-fast` | Council routing |
| librarian | `github-copilot/gpt-5.4-mini` | `variant: low`; web search MCPs (websearch, context7, grep_app, tavily — tavily now stale, see MCP note) |
| explorer | `openai/gpt-5.4-mini` | `variant: low`; no skills/MCPs |
| designer | `github-copilot/gemini-3.5-flash` | `agent-browser` + `impeccable` + systematic skills; migrated off gemini-3.1-pro-preview |
| fixer | `anthropic/claude-sonnet-5` | `variant: low` (new); migrated off claude-sonnet-4-6 |

**Council default preset members:**
- alpha: `anthropic/claude-sonnet-5` (was `claude-sonnet-4-6`)
- beta: `github-copilot/gemini-3.1-pro-preview`
- gamma: `openai/gpt-5.4-mini`

**Other preset model migrations (SHA `e8ebc5c`):** `openai` and `copilot` preset fixers moved to `anthropic/claude-sonnet-5` / `github-copilot/claude-sonnet-4.6` respectively; `opencode-go` preset oracle/council now on `opencode-go/deepseek-v4-pro`, librarian/explorer on `opencode-go/minimax-m3`. Designers across presets are on `gemini-3.5-flash` (copilot/mixed/openai) or `opencode-go/kimi-k2.6` (opencode-go).

**`ce` skill removed from slim presets** (2026-06-04, commit `d9716ffc`) — CE workflow skills no longer injected by default from the OMO slim layer.

**Other preset highlights (SHA `4df0c2d`):**
- `opencode-go` preset: `opencode-go/kimi-k2.6` orchestrator, `opencode-go/deepseek-v4-pro` (oracle `variant: max`, council `variant: high`), `opencode-go/minimax-m3` for librarian/explorer (was prior minimax line), `opencode-go/deepseek-v4-flash` fixer
- `openai` preset: librarian/explorer on `openai/gpt-5.4-mini`, fixer `anthropic/claude-sonnet-4-6`
- `copilot` preset mirrors `openai` but routes librarian/explorer through `github-copilot/gpt-5.4-mini` and fixer through `github-copilot/claude-sonnet-4.6`
- `autoUpdate: false` — plugin auto-update disabled

#### Historical oh-my-opencode-slim Routing (SHA `0bb24f0`, 2026-05-24) — superseded

At the 0bb24f0 snapshot, routing details were not captured (schema transition period). The active preset was not yet confirmed in that survey. The current `mixed` preset represents the materially changed surface area.

#### opencode-doctor: SQLite DB Maintenance (new SHA `c719625`/`24a0ecb`, 2026-06-27)

The `.config/opencode/scripts/opencode-doctor.ts` diagnostic (run via `mise run opencode:doctor`) gained **SQLite session-DB health and self-reclaiming maintenance** — a durable operational fix worth recording. Root cause documented in-repo at `.dotfiles/docs/solutions/2026-06-25-opencode-sqlite-db-bloat-prune-vacuum.md`: OpenCode never prunes its session DB (`~/.local/share/opencode/opencode.db`), which had grown to **~13 GB**. `VACUUM` alone reclaims nothing because there are no free pages; the fix is to **prune old sessions first, then VACUUM**.

Two-stage capability:
- **Prune + VACUUM** (#1923) — health check plus prune-old-sessions-then-vacuum, guarded by an other-process check and a free-disk gate (free disk ≥ DB size × 1.1).
- **`--set-incremental-vacuum`** (#1926) — one-time conversion of the DB from `auto_vacuum=NONE` to `INCREMENTAL` (set the pragma, then a full rewriting VACUUM). After conversion, future prunes reclaim free pages incrementally without a full exclusive VACUUM. Reuses the prune path's safety gates via shared helpers. Reference guide at `.dotfiles/docs/opencode-doctor.md`.

This is the local-machine counterpart to the SQLite-reliability work carried in the [[fro-bot--agent]] harness build (the harness `base_version` rebase that the mise `@fro.bot/harness` pin tracks).

#### Ollama Distillation Pipeline (new SHA `e8ebc5c`, 2026-07-10)

A new local-LLM session-distillation tool joined the repo:

- **`.config/opencode/scripts/ollama-distill.ts`** (Bun script, with `ollama-distill.test.ts`) — reads recent OpenCode session transcripts directly from the `bun:sqlite` session DB, extracts text/reasoning message segments (discriminated on `kind`), chunks them, and runs local **Ollama** distillation to emit a Markdown report.
- **`.config/mise/tasks/distill`** — mise task wrapper: `mise run distill` → `bun run ~/.config/opencode/scripts/ollama-distill.ts`. Writes reports to `~/.local/state/ollama-distill/reports/`.

This pairs with the existing `opencode-doctor` SQLite maintenance work — both read the OpenCode session DB (`~/.local/share/opencode/opencode.db`) directly. The distill pipeline keeps summarization **local** (Ollama) rather than paying a hosted-model tax, consistent with the repo's cost-and-privacy posture. A `.config/opencode/agents/research.md` subagent was also added (external research via Context7/Grep.app/Exa, `edit`/`bash` denied).

#### New Repo-Scoped OpenCode Skills (`.config/opencode/skills/`, SHA `e8ebc5c`, 2026-07-10)

Six bespoke skills now live under `.config/opencode/skills/` (distinct from the single `.agents/skills/copilot-cli` bundle):

| Skill | Purpose |
| --- | --- |
| `clonedeps` | Clone dependency source into an ignored local workspace so OpenCode can inspect library internals |
| `codemap` | Generate hierarchical codemaps for unfamiliar repos (flagged expensive; explicit-invoke only) |
| `content-research-writer` | Research-backed content writing with citations, hooks, outline iteration (MIT-licensed) |
| `copilot-cloud-agent` | GitHub Copilot cloud-agent setup, CI env drift, MCP/hooks/auth troubleshooting |
| `file-organizer` | Cleanup of scattered/cluttered directories, dedup, folder restructuring |
| `simplify` | Behavior-preserving code simplification for clarity/maintainability |

The `copilot-cloud-agent` skill is the likely replacement for the dropped `opencode-copilot-delegate` plugin — Copilot delegation is now skill-driven rather than plugin-driven.

#### OpenCode Runtime Env Toggles (bash exports, SHA `a159c44`, 2026-06-27)

`.config/bash/exports` adds two OpenCode runtime flags (joining the existing `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` / `OPENCODE_EXPERIMENTAL_WEBSOCKETS=true`):

- `OPENCODE_DISABLE_FFF=1`
- `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true` — disables the filesystem watcher (large home-dir working trees make the watcher expensive; consistent with the AFT search-index shutoff and `embedding.provider: "off"` — a coherent "turn off background indexing/watching" theme this survey).

#### Historical Agent Routing (SHA `ae026c1`, 2026-04-22) — superseded

Per-agent model assignments in the now-replaced `oh-my-openagent.json`:

| Agent | Model | Variant |
| --- | --- | --- |
| sisyphus | github-copilot/claude-opus-4.7 | medium |
| metis | github-copilot/claude-opus-4.7 | medium |
| momus | github-copilot/gpt-5.4 | xhigh |
| oracle | github-copilot/gpt-5.4 | high |
| multimodal-looker | github-copilot/gpt-5.4 | medium |
| librarian | github-copilot/claude-haiku-4.5 | — |
| explore | github-copilot/grok-code-fast-1 | — |

**Disabled agents:** `atlas`, `hephaestus`

**Category model assignments (new):**

| Category | Model | Variant |
| --- | --- | --- |
| visual-engineering | github-copilot/gemini-3.1-pro-preview | high |
| ultrabrain | github-copilot/gpt-5.4 | xhigh |
| deep | github-copilot/gpt-5.4 | medium |
| artistry | github-copilot/gemini-3.1-pro-preview | high |
| quick | github-copilot/gpt-5.4-mini | — |
| unspecified-low | github-copilot/claude-sonnet-4.6 | — |
| unspecified-high | github-copilot/claude-opus-4.7 | medium |
| writing | github-copilot/gemini-3-flash-preview | — |

**Other oh-my-openagent configuration:**
- `browser_automation_engine`: `agent-browser`
- `claude_code`: skills only (`skills: true`, all others `false`)
- `disabled_hooks`: context-window-monitor, preemptive-compaction, anthropic-context-window-limit-recovery, agent-usage-reminder, category-skill-reminder, comment-checker, directory-readme-injector, keyword-detector, todo-continuation-enforcer, write-existing-file-guard
- `disabled_skills`: git-master
- `hashline_edit: true`
- `sisyphus_agent`: `default_builder_enabled: true`, `planner_enabled: false`, `replace_plan: false`

**Delta from prior ingest (SHA `dbab7ad`):** All Anthropic direct models migrated to GitHub Copilot hosted equivalents. Opus upgraded from 4.6 to 4.7. `prometheus` agent removed. `atlas` and `hephaestus` disabled. `librarian` migrated from `opencode-go/minimax-m2.7` to `github-copilot/claude-haiku-4.5`. Category model assignments added for the first time. Browser automation engine, disabled hooks/skills arrays, hashline edit, and Sisyphus agent config all new additions.

#### Repo-Scoped Agent Skills (`.agents/skills/`, SHA `4df0c2d`, 2026-06-16)

| Skill | Path | Purpose |
| --- | --- | --- |
| `copilot-cli` | `.agents/skills/copilot-cli/` | Programmatic Copilot CLI delegation: auth, permissions, model selection, multi-repo `--add-dir`, JSONL output, bash-subprocess delegation pattern |

**Skills pruned (SHA `4df0c2d`):** `.agents/skills/` now holds only `copilot-cli`. The `agent-browser`, `test-driven-development`, and `writing-skills` repo-scoped skills present at SHA `0bb24f0` are gone — almost certainly because those skills are now provided by the upstream `@fro.bot/systematic@2.32.0` and `skills@1.5.11` packages (no need to vendor local copies). Only the bespoke `copilot-cli` skill, which has no upstream equivalent, remains repo-scoped.

### Devcontainer

Published pre-built image: `ghcr.io/marcusrbrown/dotfiles-devcontainer:latest`

Base image: `mcr.microsoft.com/devcontainers/base:2.1.9` (bumped from 2.1.7 @ 2026-07-10)

Custom features in `.devcontainer/features/`:

| Feature        | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `dotfiles-dev` | Clones bare repo, checks out main, generates `post-create.sh` |
| `mise`         | Installs mise, runs `mise install` post-create                |
| `sheldon`      | Installs Sheldon zsh plugin manager                           |
| `keychain`     | SSH/GPG key agent management from GitHub releases             |

Feature dependency chain: `common-utils` -> `sheldon`, `keychain` -> `dotfiles-dev` -> `mise`

Remote features: `common-utils`, `github-cli`, `node`, `shellcheck`, `starship`.

Container env sets all XDG directories, `GIT_DIR`, `GIT_WORK_TREE`, `GNUPGHOME`, `ZDOTDIR`.

Host requirements: 4 CPUs. Workspace mounted as Docker volume for performance.

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR/release/dispatch | Devcontainer CI + mise install validation |
| Fro Bot | `fro-bot.yaml` | PR/issue/comment/schedule/dispatch | AI-powered review, triage, daily maintenance |
| Renovate | `renovate.yaml` | (reusable from `bfra-me/.github`) | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | (reusable from `bfra-me/.github`) | Probot settings sync |

### Main Workflow Jobs

1. **Devcontainer CI** — Builds devcontainer image, pushes to GHCR on push/release, uses `cacheFrom` for PR builds. Runs `devcontainer-info` as smoke test.
2. **Install mise** — Checks out repo, installs mise via `jdx/mise-action@v4.2.0`; `MISE_VERSION` pinned to `2026.7.5` as of SHA `e8ebc5c` (was `2026.6.14`). Renovate tracks both the action and the `MISE_VERSION` env var. Devcontainer base image bumped to `mcr.microsoft.com/devcontainers/base:2.1.9` (was 2.1.7).

### Branch Protection

Required status checks on `main`: Devcontainer CI, Fro Bot, Install mise, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Fro Bot Integration

**Fro Bot workflow present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.84.3` (SHA `0779a294996c60abb08f017e6df608e87ef2f272`) — single-file three-mode pattern shared with [[marcusrbrown--marcusrbrown-github-io]] et al. Bumped v0.79.1 → v0.84.3 across this survey window (see [[fro-bot--agent]]); the workflow reads its model from the `FRO_BOT_MODEL` repo variable. `actions/checkout` pinned at v6.0.3 (`df4cb1c`). The repo continues to ride interim agent releases and leads the ecosystem on agent version.

Triggers: PR events (opened, synchronize, reopened, ready_for_review, review_requested), `issues` (opened, edited), `issue_comment`, `pull_request_review_comment`, daily schedule (15:30 UTC), `workflow_dispatch` with a required `prompt` input.

Concurrency: grouped by issue/PR number (with `github.run_id` fallback for schedule/dispatch), cancellation disabled.

**Stale-report cleanup:** A dedicated `Close stale daily reports` step runs on `schedule` only — queries open `fro-bot`-authored issues matching `Daily Maintenance Report in:title`, finds entries older than 3 days, and auto-closes them with reason `not planned`. Cross-platform `date -u -d` / `date -u -v-3d` fallback keeps the step portable.

**PR review prompt** (PR_REVIEW_PROMPT env) includes dotfiles-specific checks: allowlist `.gitignore` verification, shell startup correctness, macOS/Linux portability, security (no secrets), convention compliance (numbered `init.d`, `local.d`, XDG, GPG signing, `dev.mrbro.*` LaunchAgents), devcontainer impact. Output structure is locked: required headings are `## Verdict` (`PASS | CONDITIONAL | REJECT`), `### Blocking issues`, `### Non-blocking concerns`, `### Security check`, `### Risk assessment`. Sections with no findings must render as `None`.

**Scheduled maintenance prompt** (SCHEDULE_PROMPT env) covers 6 categories — Errored PRs, Security, Config Quality & Repo Hygiene, Developer Experience (now report-only — "Formatting is handled manually by the repo owner"), Devcontainer & CI Health, Cross-Project Progressive Improvement (observation-only survey of all `marcusrbrown` repos). Single-issue daily report titled `Daily Maintenance Report — YYYY-MM-DD (UTC)`, with explicit table schemas for each category and explicit "do not query Dependabot/vulnerability-alert APIs" guard (Marcus's PAT is a collaborator token on user-owned repos and those endpoints 404 by design).

**Hard boundaries:** never force-push, never push directly to default branch, never merge PRs, never weaken tests/lints to make checks pass, do not modify `.github/workflows/`, shell init files, devcontainer config, or automation prompts unless it's a genuine bug fix with narrow scope. Cross-project monitoring (category 6) is strictly observation-only — no PRs, issues, comments, or clones in other repos.

**Author/trust gating** in the job-level `if`: forks blocked, bot-authored PRs/issues blocked, comment mentions only honored from `OWNER`/`MEMBER`/`COLLABORATOR` associations.

### Renovate

Extends `marcusrbrown/renovate-config#5.2.0` + `sanity-io/renovate-config:semantic-commit-type`. Major version crossed the v4→v5 boundary documented in [[marcusrbrown--renovate-config]] (2026-05-13). Two custom managers:

1. `_VERSION` regex manager for variables in mise config files (`(^|/)\.?mise\.toml$`, `(^|/)\.?mise/config\.toml$`).
2. Pinned npm plugin version manager for `(^|/)\.config/opencode/opencode\.json$` and `tui\.json` — matches `"name@x.y.z"` patterns to surface OpenCode plugin updates. **Enhanced (2026-05-29):** Now uses semver versioning strategy and supports cross-series prerelease upgrades (e.g., `@marcusrbrown/opencode-anthropic-auth` mb.1 → mb.2 → mb.3 prerelease series).

Package rules:

- Patch updates enabled for `devcontainer`, `dockerfile`, `docker-compose`, `mise`.
- Devcontainer feature PRs get a custom commit topic and PR body columns (Package/Type/Update/Change/References) with rewritten links.
- Base image digest pinning disabled for `mcr.microsoft.com/devcontainers/base` (branch automerge, dashboard-approved).
- Renovate updates disabled for `@anthropic-ai/claude-code` and `opencode-ai` (manually managed).
- Automerge of unstable minor/patch (`v0.x`) updates for `@cortexkit/aft*`, `@cortexkit/*magic-context`, `fro-bot/agent`, `@franlol/opencode-md-table-formatter`, `agent-browser`, `ast-grep`, `opencode-copilot-delegate` — extends `bfra-me/renovate-config:automerge.json5#5.2.1`.

Settings: `prCreation: immediate`, `rebaseWhen: behind-base-branch`, ignores `mergeConfidence:age-confidence-badges` and `mergeConfidence:all-badges` presets.

### Probot Settings

Extends `fro-bot/.github:common-settings.yaml`. Confirms membership in the Fro Bot-managed ecosystem.

## Notable Patterns

- **Bare git repo without symlinks:** The entire `$HOME` is the working tree. No stow, chezmoi, or rcm — just native git with an allowlist ignore pattern. Requires discipline but avoids all symlink tooling.
- **XDG compliance:** All configs under `~/.config/`, data under `~/.local/share/`, cache under `~/.cache/`. Even in devcontainer, XDG vars are explicitly set.
- **Deferred Zsh loading:** Sheldon + zsh-defer pattern for fast shell startup. Plugins loaded lazily after the prompt renders.
- **Znap eval pattern:** Mise, starship, and rustup activated via `znap eval` for cached initialization — avoids re-evaluating `eval "$(tool init zsh)"` on every shell start.
- **Multi-agent AI setup:** Both Claude Code and OpenCode configured with project-specific rules and agents. AGENTS.md serves as the canonical knowledge base.
- **Published devcontainer image:** Pre-built image on GHCR enables fast Codespaces and cross-machine parity.
- **Cross-project health monitoring:** Fro Bot's scheduled prompt includes observation-only scanning of all `marcusrbrown` repos for CI health, missing workflows, and stale PRs.
- **Copilot-hosted model routing:** All OpenCode agents now route through `github-copilot/*` hosted models (migrated from direct `anthropic/*` provider endpoints), reducing API key management overhead and leveraging GitHub's Copilot infrastructure.

## Cross-References

- Shares [[mise]] tooling and Renovate config patterns with [[marcusrbrown--ha-config]]
- Consumes [[marcusrbrown--systematic]] as `@fro.bot/systematic@2.33.2` via OpenCode plugin slot (was 2.32.1)
- Consumes [[fro-bot--agent]] both as the `fro-bot/agent@v0.84.3` workflow action and as the `@fro.bot/harness@1.17.14-harness.e98fbc0f` CLI build pinned in mise (harness base rebased to `1.17.14`)
- [[marcusrbrown--opencode-copilot-delegate]] **no longer consumed as a headless OpenCode plugin** (dropped from `opencode.json`/`tui.json` @ 2026-07-10); Copilot delegation now flows through the `copilot-cli` / `copilot-cloud-agent` skills
- Anthropic auth: steady on upstream `@cortexkit/opencode-anthropic-auth@1.13.0` (was 1.10.3 @ 2026-06-27); Marcus's fork [[marcusrbrown--cortexkit-anthropic-auth]] remains unconsumed here across three surveys
- Shares the `impeccable` design-lint skill with [[fro-bot--dashboard]] (dotfiles wires it into OMO-slim `designer`/`fixer` agents; dashboard runs it as a CI Design Check)
- Tracks [[marcusrbrown--renovate-config]] at v5.2.0 (v4→v5 boundary crossed)
- Both repos extend `fro-bot/.github:common-settings.yaml` for Probot settings
- Both repos use reusable workflows from `bfra-me/.github`
- Dotfiles devcontainer features could be consumed by other repos via the published GHCR image

## Survey History

| Accessed   | SHA       | Highlights                                                                                                                                                     |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-18 | `2f2d1e6` | Initial survey: bare repo, devcontainer, agent v0.40.2, Renovate 4.5.8                                                                                         |
| 2026-04-21 | `dbab7ad` | Incremental: tool version bumps                                                                                                                                |
| 2026-04-22 | `ae026c1` | OpenCode model routing overhaul (Anthropic → Copilot), magic-context 0.13.0, copilot-cli skill added                                                           |
| 2026-05-24 | `0bb24f0` | Agent v0.41.3 → v0.44.3, Renovate preset 4.5.8 → 5.2.0 (major boundary), `oh-my-opencode-slim` replaces `oh-my-openagent`, `opencode-copilot-delegate` consumed, custom OpenAI gpt-5.5 models declared, `gitleaks` added, `agent-browser` skill added, stale-report auto-close step |
| 2026-06-06 | `70c211bc` | Agent v0.44.3 → v0.55.1 (18 version jumps in 71 commits), auth plugin switched to `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (own fork), default model `opencode-go/kimi-k2.6` declared, `oh-my-opencode-slim` 4-preset config with active `mixed` preset (Opus 4-8 orchestrator), Discord MCP added (disabled), `aft.jsonc` + `systematic.jsonc` config files added, general/explore agents disabled, `ce` skill removed from slim presets, Renovate semver + cross-series prerelease support, magic-context 0.21.8 → 0.22.4 (temporal_awareness, system_prompt_injection) |
| 2026-06-16 | `4df0c2d` | Agent v0.55.1 → v0.65.0; `@fro.bot/harness@1.17.6-harness.13169873` added to mise (harness-as-default cutover mirror); **auth plugin reverted** to upstream `@cortexkit/opencode-anthropic-auth@1.9.2` (fork dropped — contradiction noted); **license now undetectable** (API 404, no LICENSE file — was The Unlicense); Discord MCP + inline custom `openai/gpt-5.5[-fast]` provider models removed from `opencode.json`; magic-context 0.22.4 → 0.24.1 (claude-fable-5 cache TTL), aft 0.35.4 → 0.39.2 (`bridge.hang_threshold`), systematic 2.28.0 → 2.32.0, slim 1.1.1 → 1.1.2 (mixed preset librarian → `github-copilot/gpt-5.4-mini`); `.agents/skills/` pruned to `copilot-cli` only; tool bumps (pnpm 11.6.0, npm 11.17.0, python 3.14.6, biome 2.5.0, opencode-ai 1.17.4) |
| 2026-06-27 | `debcb8e` | Agent v0.65.0 → v0.79.1 (14 minors, web-operator wave); `@fro.bot/harness` 1.17.6 → 1.17.9-harness.bd89c818 (aligns with agent base rebase); **license still undetectable** (2nd consecutive survey, `licenseInfo: null`); **opencode-doctor gains SQLite DB prune+VACUUM + `--set-incremental-vacuum`** (fixes ~13 GB session-DB bloat); magic-context 0.24.1 → 0.26.0 with **historian → `opencode-go/deepseek-v4-flash`** (gpt-5.5 demoted to fallback); AFT `search_index`/`semantic_search` disabled + `embedding.provider: off`; OMO-slim `designer`/`fixer` standardized on `agent-browser`+`impeccable`+systematic skills; auth 1.9.2 → 1.10.3, aft 0.39.2 → 0.39.4, systematic 2.32.0 → 2.32.1; new bash OpenCode env toggles (`OPENCODE_DISABLE_FFF=1`, `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true`); `mise-action@v4.2.0`/`MISE_VERSION 2026.6.14`; tool bumps (node 24.18, pnpm 11.9, deno 2.9, biome 2.5.1, agent-browser 0.29.1, copilot 1.0.64); stars 18 → 20, open issues 4 → 6 |
| 2026-07-10 | `e8ebc5c` | Agent v0.79.1 → v0.84.3; `@fro.bot/harness` 1.17.9 → 1.17.14-harness.e98fbc0f; **license still undetectable** (3rd consecutive survey); **`magic-context.jsonc` and `aft.jsonc` config files deleted** — both plugins now run on defaults; `tui.json` reduced to theme-only (plugin array dropped); `opencode.json` **default `"model": opencode-go/kimi-k2.6` removed** (routing deferred to OMO-slim presets); **`tavily` MCP removed** (4→3 servers; websearch Exa moved key/tools to URL query — OMO librarian tavily ref now stale); **`opencode-copilot-delegate` plugin dropped** from opencode.json/tui.json; auth 1.10.3 → 1.13.0, magic-context 0.26.0 → 0.31.5, aft 0.39.4 → 0.46.0, systematic 2.32.1 → 2.33.2; OMO-slim models migrated to `claude-sonnet-5` / `gemini-3.5-flash`, mixed orchestrator `variant: xhigh`; `systematic.jsonc` gained categories + agents model routing; **new `ollama-distill` local-LLM session-distillation pipeline** (`distill` mise task); 6 new repo-scoped OpenCode skills (clonedeps, codemap, content-research-writer, copilot-cloud-agent, file-organizer, simplify) + `research` subagent; devcontainer base 2.1.7 → 2.1.9; `MISE_VERSION 2026.7.5`; tool bumps (rust 1.97, go 1.26.5, pnpm 11.10, npm 11.18, deno 2.9.2, prettier 3.9.4, biome 2.5.2, opencode-ai 1.17.12, claude-code 2.1.128, agent-browser 0.31.1, copilot 1.0.68, puppeteer 25.3.0, tsx 4.23.0); stars 20, issues 6 (unchanged) |
