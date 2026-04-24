---
type: repo
title: "marcusrbrown/.dotfiles"
created: 2026-04-18
updated: 2026-04-24
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
    sha: ba002fbc2b8d9813effca1479ab2978322608267
    accessed: 2026-04-24
tags: [dotfiles, configuration, zsh, bash, mise, sheldon, starship, devcontainer, bare-git-repo, opencode, magic-context, copilot-cli]
aliases: [dotfiles]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/.dotfiles

Marcus R. Brown's [[dotfiles]] repository. Uses a **bare git repository** pattern (`GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=$HOME`) to track shell and development environment configuration directly in `$HOME` without symlinks.

## Overview

- **Purpose:** Synchronize shell configuration and dev environment across machines
- **Default branch:** `main`
- **Created:** 2011-06-09
- **Last push:** 2026-04-24
- **License:** The Unlicense (public domain)
- **Topics:** `dotfiles`, `configuration`, `settings`, `preferences`, `zsh`, `sheldon`, `mise`, `starship`
- **Languages:** Shell (primary), Vim Script, TypeScript, Ruby, JavaScript
- **Open issues:** 19

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

Managed tool versions in `.config/mise/config.toml` (as of SHA `ba002fb`):

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
| opencode-ai                   | 1.14.22 (npm) | Renovate updates disabled                                 |
| ast-grep                      | 0.40.5        | AST-aware search/replace                                  |
| typescript                    | 6.0.3 (npm)   |                                                           |
| playwright                    | 1.59.1 (npm)  |                                                           |
| puppeteer                     | 24.42.0 (npm) | Browser automation                                        |
| agent-browser                 | 0.26.0 (npm)  | Browser automation CLI for agents                         |
| skills                        | 1.5.1 (npm)   | Agent skills package                                      |
| ocx                           | 2.0.7 (npm)   | OpenCode extension runner                                 |
| @cortexkit/opencode-magic-context | 0.15.0 (npm) | Context management plugin (bumped from 0.13.0)       |
| @cortexkit/aft-opencode       | 0.15.1 (npm)  | AFT OpenCode plugin (bumped from 0.14.0)                  |
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

Mise version: 2026.4.19 (pinned in CI via `MISE_VERSION`). Environment: `UV_SYSTEM_CERTS = "true"` set in `[env]` section for Python UV package manager certificate handling.

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

#### OpenCode Plugin Ecosystem (as of SHA `ba002fb`)

OpenCode is configured with a rich plugin stack in `.config/opencode/opencode.json`:

| Plugin | Version | Purpose |
| --- | --- | --- |
| `@ex-machina/opencode-anthropic-auth` | 1.7.5 | Anthropic auth provider (bumped from 1.7.4) |
| `oh-my-openagent` | 3.17.5 | Multi-agent routing and model assignment (bumped from 3.17.4) |
| `@fro.bot/systematic` | latest | Fro Bot systematic skill framework |
| `@franlol/opencode-md-table-formatter` | latest | Markdown table formatting |
| `@cortexkit/opencode-magic-context` | 0.15.0 | Adaptive context management (bumped from 0.13.0) |
| `@cortexkit/aft-opencode` | 0.15.1 | AFT (Adaptive Fine-Tuning) OpenCode plugin (bumped from 0.14.0) |

**Default model:** `opencode-go/kimi-k2.6` — sets the base model for OpenCode sessions outside of agent-specific routing.

**MCP servers configured:**

| Server | URL | Purpose |
| --- | --- | --- |
| `context7` | `https://mcp.context7.com/mcp` | Documentation and context retrieval |
| `grep_app` | `https://mcp.grep.app` | Code search across GitHub repos |
| `tavily` | `https://mcp.tavily.com/mcp/` | Web search |
| `websearch` | `https://mcp.exa.ai/mcp` | Exa web search |

**OpenCode compaction:** `auto: false`, `prune: false` — compaction handled by magic-context plugin instead.

#### Magic Context Configuration (`.config/opencode/magic-context.jsonc`)

The `opencode-magic-context` plugin (v0.15.0) provides adaptive context compaction with model-specific thresholds:

- **Historian**: `anthropic/claude-sonnet-4-6` (fallback: `github-copilot/gpt-5.4`) — tracks conversation history
- **Dreamer**: `anthropic/claude-sonnet-4-6` (enabled; fallback: `github-copilot/claude-sonnet-4.6`) — plans ahead, with `user_memories` (promotion threshold 3) and `pin_key_files` (budget 20k tokens, min 4 reads)
- **Sidekick**: `github-copilot/gpt-5-mini` (enabled) — lightweight assistant
- **Cache TTL**: 5m default; 59m for `anthropic/claude-sonnet-4-6`, `anthropic/claude-opus-4-6`, `anthropic/claude-opus-4-7`
- **Execute thresholds**: 65% default; 40% for Anthropic Sonnet/Opus models (triggers compaction sooner)
- **Token thresholds by model**: Opus 4.7 at 80K (was 88K), Sonnet 4.6 at 95K, GPT-5.4 at 140K, Codex at 210K
- **History budget**: 15% (`history_budget_percentage: 0.15`, increased from 0.10)
- **Memory injection budget**: 6000 tokens (`memory.injection_budget_tokens: 6000`, new)
- **Historian timeout**: 420s (`historian_timeout_ms: 420000`)
- **Experimental**: `auto_search` (enabled, min 20 chars, score threshold 0.55, new), `git_commit_indexing` (enabled, 365 days, 2000 max commits, new), `temporal_awareness`
- **Compaction markers**: enabled (`compaction_markers: true`)
- **Auto-drop**: tool results aged >30 turns (`auto_drop_tool_age: 30`, relaxed from 15)

**Delta from prior ingest (SHA `ae026c1`):** **Historian and Dreamer reverted from Copilot-hosted to direct Anthropic models** (`anthropic/claude-sonnet-4-6`), with Copilot models retained as fallbacks — this contradicts the prior survey's narrative of full Copilot migration. Opus 4.7 token threshold tightened 88K → 80K. History budget increased 10% → 15%. Memory injection budget (6000 tokens) added. Auto-drop age relaxed 15 → 30. Two new experimental features: `auto_search` for automatic context retrieval and `git_commit_indexing` for codebase-aware history. Plugin version bumped 0.13.0 → 0.15.0.

#### oh-my-openagent Agent Model Routing (`.config/opencode/oh-my-openagent.json`)

Per-agent model assignments (as of SHA `ba002fb`):

| Agent | Model | Variant |
| --- | --- | --- |
| sisyphus | anthropic/claude-opus-4-6 | high |
| metis | anthropic/claude-opus-4-6 | high |
| momus | github-copilot/gpt-5.4 | xhigh |
| oracle | github-copilot/gpt-5.4 | high |
| multimodal-looker | github-copilot/gpt-5.4 | medium |
| hephaestus | github-copilot/gpt-5.4 | medium |
| librarian | anthropic/claude-haiku-4-5 | — |
| explore | github-copilot/grok-code-fast-1 | — |

**Disabled agents:** `atlas`, `hephaestus`

**Category model assignments:**

| Category | Model | Variant |
| --- | --- | --- |
| visual-engineering | github-copilot/gemini-3.1-pro-preview | high |
| ultrabrain | github-copilot/gpt-5.4 | xhigh |
| deep | github-copilot/gpt-5.4 | medium |
| artistry | github-copilot/gemini-3.1-pro-preview | high |
| quick | github-copilot/gpt-5.4-mini | — |
| unspecified-low | anthropic/claude-sonnet-4-6 | — |
| unspecified-high | anthropic/claude-opus-4-6 | high |
| writing | github-copilot/gemini-3-flash-preview | — |

**Other oh-my-openagent configuration:**
- `auto_update`: `false`
- `browser_automation_engine`: `agent-browser`
- `claude_code`: skills only (`skills: true`, all others `false`)
- `disabled_hooks`: context-window-monitor, preemptive-compaction, anthropic-context-window-limit-recovery, agent-usage-reminder, category-skill-reminder, comment-checker, directory-readme-injector, keyword-detector, todo-continuation-enforcer, write-existing-file-guard
- `disabled_skills`: git-master
- `git_master`: `commit_footer: false`, `include_co_authored_by: false`, `git_env_prefix: "GIT_MASTER=1"` (new)
- `hashline_edit: true`
- `sisyphus_agent`: `default_builder_enabled: true`, `planner_enabled: false`, `replace_plan: false`

**Delta from prior ingest (SHA `ae026c1`):** **Partial reversal of Copilot-hosted model routing.** Primary agents (sisyphus, metis) returned from `github-copilot/claude-opus-4.7` (medium) to `anthropic/claude-opus-4-6` (high) — direct Anthropic endpoints. Librarian returned from `github-copilot/claude-haiku-4.5` to `anthropic/claude-haiku-4-5`. Category assignments `unspecified-low` and `unspecified-high` also reverted to direct Anthropic. Search/lookup agents (explore, oracle, momus, multimodal-looker) remain on Copilot-hosted models. This establishes a **hybrid routing strategy**: latency-sensitive primary agents use direct Anthropic for reliability, while auxiliary agents use Copilot-hosted for cost efficiency. `hephaestus` now has a model assignment (`github-copilot/gpt-5.4`) but remains in `disabled_agents`. `git_master` config block and `auto_update: false` are new additions. Model naming shifted to hyphenated format (`claude-opus-4-6` vs prior `claude-opus-4.7`).

#### Repo-Scoped Agent Skills (`.agents/skills/`)

| Skill | Path | Purpose |
| --- | --- | --- |
| `copilot-cli` | `.agents/skills/copilot-cli/` | Programmatic Copilot CLI delegation: auth, permissions, model selection, multi-repo `--add-dir`, JSONL output, bash-subprocess delegation pattern (new) |
| `test-driven-development` | `.agents/skills/test-driven-development/` | TDD patterns (`SKILL.md`, `testing-anti-patterns.md`) |
| `writing-skills` | `.agents/skills/writing-skills/` | Writing guidance (`SKILL.md`, Anthropic best practices, Graphviz conventions, persuasion principles, subagent testing) |

### Devcontainer

Published pre-built image: `ghcr.io/marcusrbrown/dotfiles-devcontainer:latest`

Base image: `mcr.microsoft.com/devcontainers/base:2.1.7`

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
2. **Install mise** — Checks out repo, installs mise via `jdx/mise-action` (version `2026.4.16`).

### Branch Protection

Required status checks on `main`: Devcontainer CI, Fro Bot, Install mise, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Fro Bot Integration

**Fro Bot workflow present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.41.4` (SHA `28bcadbf44a59f8d6d2544b5db0d9735d7ad2aca`). Workflow now includes `OPENCODE_PROMPT_ARTIFACT: 'true'` env var and auto-closes daily report issues older than 3 days (PR #1475).

Triggers: PR events (opened, synchronize, reopened, ready_for_review, review_requested), issue/comment events, daily schedule (15:30 UTC), manual dispatch.

Concurrency: grouped by issue/PR number, cancellation disabled.

**PR review prompt** includes dotfiles-specific checks: allowlist .gitignore verification, shell startup correctness, macOS/Linux portability, security (no secrets), convention compliance (numbered init.d, local.d, XDG, GPG signing, `dev.mrbro.*` LaunchAgents), devcontainer impact.

**Scheduled maintenance prompt** covers 6 categories: errored PRs, security, config quality/repo hygiene, developer experience (formatting), devcontainer/CI health, cross-project progressive improvement (observation-only survey of all `marcusrbrown` repos).

### Renovate

Extends `marcusrbrown/renovate-config#4.5.8` + `sanity-io/renovate-config:semantic-commit-type`. Custom regex manager for `_VERSION` variables in mise config. Disabled for `@anthropic-ai/claude-code` and `opencode-ai` (new: opencode-ai updates disabled). Automerge for unstable minor/patch of `@cortexkit/aft-opencode`, `@cortexkit/opencode-magic-context`, `agent-browser`, and `opencode-anthropic-oauth`. Ignores `mergeConfidence` presets. `prCreation: immediate`, `rebaseWhen: behind-base-branch`.

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
- **Hybrid model routing strategy:** Primary agents (sisyphus, metis) and librarian route through direct `anthropic/*` endpoints for reliability, while auxiliary agents (explore, oracle, momus) and most category tasks use `github-copilot/*` hosted models for cost efficiency. This reverses the prior full Copilot migration — the system now balances direct API access against hosted infrastructure based on agent criticality.
- **OpenCode default model:** `opencode-go/kimi-k2.6` serves as the base model, distinct from agent-specific routing. TUI config (`tui.json`) uses Catppuccin theme with magic-context and aft-opencode plugins.
- **Intelligent context retrieval:** Magic Context v0.15.0 adds `auto_search` (semantic query matching against indexed context) and `git_commit_indexing` (365-day, 2000-commit history indexing) for proactive context injection without manual configuration.

## Cross-References

- Shares [[mise]] tooling and Renovate config patterns with [[marcusrbrown--ha-config]]
- Both repos extend `fro-bot/.github:common-settings.yaml` for Probot settings
- Both repos use reusable workflows from `bfra-me/.github`
- Dotfiles devcontainer features could be consumed by other repos via the published GHCR image
