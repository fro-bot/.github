---
type: repo
title: "marcusrbrown/.dotfiles"
created: 2026-04-18
updated: 2026-05-24
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
tags: [dotfiles, configuration, zsh, bash, mise, sheldon, starship, devcontainer, bare-git-repo, opencode, magic-context, copilot-cli, systematic, gitleaks]
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
- **Last push:** 2026-05-24
- **License:** The Unlicense (public domain)
- **Topics:** `dotfiles`, `configuration`, `settings`, `preferences`, `zsh`, `sheldon`, `mise`, `starship`
- **Languages:** TypeScript (primary by size), Shell, Vim Script, Ruby, JavaScript
- **Open issues:** 4
- **Stars:** 18

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

Managed tool versions in `.config/mise/config.toml` (as of SHA `0bb24f0`, 2026-05-24):

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
| prettier                      | 3.8.3 (npm)   | With `@bfra.me/prettier-config` 0.16.9                    |
| opencode-ai                   | 1.15.5 (npm)  | Renovate updates disabled                                 |
| ast-grep                      | 0.42.3        | AST-aware search/replace                                  |
| typescript                    | 6.0.3 (npm)   |                                                           |
| playwright                    | 1.60.0 (npm)  |                                                           |
| puppeteer                     | 25.0.4 (npm)  | Browser automation                                        |
| agent-browser                 | 0.27.0 (npm)  | Browser automation CLI for agents                         |
| skills                        | 1.5.7 (npm)   | Agent skills package                                      |
| ocx                           | 2.0.11 (npm)  | OpenCode extension runner                                 |
| @github/copilot               | 1.0.51 (npm)  | GitHub Copilot CLI (new)                                  |
| @marcusrbrown/infra           | latest (npm)  | Personal infra CLI                                        |
| @biomejs/biome                | 2.4.15 (npm)  |                                                           |
| vibe-tools                    | 0.63.3 (npm)  | Vibe coding tools                                         |
| @anthropic-ai/claude-code     | 2.1.112 (npm) | Renovate updates disabled                                 |
| shfmt (aqua:mvdan/sh)         | 3.13.1        | Shell formatter                                           |
| gitleaks (aqua:gitleaks)      | 8.30.1        | Secret scanner (new)                                      |
| cargo-binstall                | 1.19.1        | Cargo binary installer                                    |
| tsx                           | 4.22.3 (npm)  | TypeScript execution                                      |
| rimraf                        | 6.1.3 (npm)   | Deep deletion utility                                     |
| pyright                       | 1.1.409 (npm) | Python type checker                                       |
| typescript-language-server    | 5.2.0 (npm)   | TypeScript language server                                |
| pipx:poetry                   | 2.4.1         | Python packaging                                          |

**Notable removals from prior ingest (SHA `ae026c1`):** `@cortexkit/opencode-magic-context` and `@cortexkit/aft-opencode` are no longer in `[tools]` — they moved to the OpenCode `plugin` array in `opencode.json` (managed by a new Renovate custom manager for pinned npm plugin versions). `remark-language-server` and `lolcrab` entries dropped from mise config.

**Env additions:** `UV_SYSTEM_CERTS=true`, `NPM_TOKEN` templated from env, and a redacted env file pulled from `~/.config/mise/.env.local`.

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

#### OpenCode Plugin Ecosystem (as of SHA `0bb24f0`, 2026-05-24)

OpenCode plugins are now pinned by version directly in `.config/opencode/opencode.json` (managed by a new Renovate custom manager that matches `"name@x.y.z"` patterns inside `opencode.json` / `tui.json`):

| Plugin | Version | Purpose |
| --- | --- | --- |
| `@cortexkit/opencode-anthropic-auth` | 1.2.2 | Anthropic auth provider (vendor switched from `@ex-machina/opencode-anthropic-auth`) |
| `oh-my-opencode-slim` | 1.1.1 | Slimmed multi-agent routing layer (replaces `oh-my-openagent` 3.x) |
| `@cortexkit/opencode-magic-context` | 0.21.8 | Adaptive context management (bumped from 0.13.0) |
| `@cortexkit/aft-opencode` | 0.29.1 | AFT (Adaptive Fine-Tuning) OpenCode plugin |
| `opencode-copilot-delegate` | 0.12.0 | Delegate tasks to GitHub Copilot CLI as subprocess (see [[marcusrbrown--opencode-copilot-delegate]]) |
| `@fro.bot/systematic` | 2.23.4 | Systematic skills + agents (see [[marcusrbrown--systematic]]) |

**Custom OpenAI provider models** declared in `opencode.json` for the first time:

| Model | Context | Input | Output |
| --- | --- | --- | --- |
| `openai/gpt-5.5` | 272,000 | 272,000 | 32,000 |
| `openai/gpt-5.5-fast` | 272,000 | 272,000 | 32,000 |

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

#### Magic Context Configuration (`.config/opencode/magic-context.jsonc`, SHA `0bb24f0`)

The `opencode-magic-context` plugin (0.21.8) provides adaptive context compaction with model-specific thresholds:

- **Historian**: `openai/gpt-5.5-fast` (fallbacks: `anthropic/claude-sonnet-4-6`, `github-copilot/claude-sonnet-4.6`) — temperature 0.1, variant medium, tool permissions hard-denied (`bash`, `webfetch`, `edit`)
- **Dreamer**: `anthropic/claude-sonnet-4-6` (fallbacks: `openai/gpt-5.4-mini`, `github-copilot/claude-sonnet-4.6`) — schedule `00:00-08:00`, `inject_docs: true`, `pin_key_files` (20k tokens, min 4 reads), `user_memories` (promotion threshold 3)
- **Sidekick**: disabled
- **Cache TTL**: 5m default; 59m for `anthropic/claude-sonnet-4-6`, `anthropic/claude-opus-4-6`, `anthropic/claude-opus-4-7`
- **Execute thresholds (%)**: 65 default; 55 for the Anthropic Sonnet/Opus trio; 80 for `openai/gpt-5.5`
- **Execute thresholds (tokens)**: `github-copilot/claude-opus-4.7` 80K, `github-copilot/claude-sonnet-4.6` 95K
- **Experimental**: `auto_search` (min 20 chars, score ≥ 0.55), `git_commit_indexing` (additional fields visible in raw config)

**Delta from prior ingest (SHA `ae026c1`):** Historian migrated from `github-copilot/gpt-5.4` to a custom `openai/gpt-5.5-fast` (with the old Copilot/Anthropic models now as fallbacks only). Dreamer reverted to a direct Anthropic model (`anthropic/claude-sonnet-4-6`) with the Copilot variant demoted to fallback. Sidekick disabled outright. Token thresholds dropped from 4 entries to 2 (only Copilot Opus and Sonnet remain). Percentage thresholds tightened for Anthropic models (55% vs prior 40%) and a new `openai/gpt-5.5` entry (80%) appears. Experimental block now centers on `auto_search` and `git_commit_indexing` instead of the prior compaction/temporal stack. Plugin version 0.13.0 → 0.21.8.

#### oh-my-opencode-slim Routing (SHA `0bb24f0`)

The `oh-my-openagent` 3.17.4 plugin and its `oh-my-openagent.json` config file have been replaced by `oh-my-opencode-slim` 1.1.1, with configuration moving to `.config/opencode/oh-my-opencode-slim.jsonc`. Routing details are intentionally not duplicated here at this snapshot — the slimmed plugin owns its own schema and the surface area has materially changed. See repo for current per-agent and per-category model assignments.

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

#### Repo-Scoped Agent Skills (`.agents/skills/`, SHA `0bb24f0`)

| Skill | Path | Purpose |
| --- | --- | --- |
| `agent-browser` | `.agents/skills/agent-browser/` | Browser automation patterns aligned with the `agent-browser` CLI tool (new) |
| `copilot-cli` | `.agents/skills/copilot-cli/` | Programmatic Copilot CLI delegation: auth, permissions, model selection, multi-repo `--add-dir`, JSONL output, bash-subprocess delegation pattern |
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

**Fro Bot workflow present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.44.3` (SHA `b928e79729f01b563feabee26a0525a3b48501a6`) — single-file three-mode pattern shared with [[marcusrbrown--marcusrbrown-github-io]] et al.

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
2. **New**: pinned npm plugin version manager for `(^|/)\.config/opencode/opencode\.json$` and `tui\.json` — matches `"name@x.y.z"` patterns to surface OpenCode plugin updates.

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
- Consumes [[marcusrbrown--systematic]] as `@fro.bot/systematic@2.23.4` via OpenCode plugin slot
- Consumes [[marcusrbrown--opencode-copilot-delegate]] as `opencode-copilot-delegate@0.12.0` — first dotfiles release pulling the sibling repo out of v0.1.0 scaffold
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
