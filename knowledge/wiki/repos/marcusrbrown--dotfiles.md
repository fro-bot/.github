---
type: repo
title: "marcusrbrown/.dotfiles"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: b5f5dee391bccd83e735b63c58ca9e416b72e702
    accessed: 2026-04-18
tags: [dotfiles, shell, zsh, bash, mise, sheldon, starship, devcontainer, bare-git-repo]
aliases: [dotfiles]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/.dotfiles

Marcus R. Brown's [[dotfiles]] repository. A bare git repo (`GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=~/`) that synchronizes shell and developer tool configurations across machines. One of Marcus's oldest public repos (created 2011-06-09).

## Overview

- **Purpose:** Cross-machine config synchronization for shell, editors, dev tools, and AI agents
- **Default branch:** `main`
- **Created:** 2011-06-09
- **Last push:** 2026-04-18
- **License:** UNLICENSE (public domain)
- **Topics:** `configuration`, `dotfiles`, `mise`, `preferences`, `settings`, `sheldon`, `starship`, `zsh`
- **Languages:** Shell (53KB), Vim Script (27KB), TypeScript (27KB), Ruby (10KB), JavaScript (5KB)

## Repository Architecture

### Bare Git Worktree Pattern

The repo uses a bare git repository at `~/.dotfiles` with `$HOME` as the working tree. This avoids symlinks and allows direct tracking of files in their native locations. An allowlist `.gitignore` pattern (ignore everything, then `!`-allowlist specific paths) prevents accidental tracking of home directory contents.

```bash
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
```

### Key Directories

| Directory | Purpose |
| --- | --- |
| `.config/bash/` | Bash config: `main` entrypoint, `aliases`, `functions`, `exports`, `init.d/`, `completion.d/`, `local.d/` |
| `.config/zsh/` | Zsh config: `.zshrc`, `.zshenv`, plugins |
| `.config/git/` | Global git config, attributes, ignore |
| `.config/mise/` | [[mise]] tool version management + tasks |
| `.config/sheldon/` | Zsh plugin manager config |
| `.config/starship.toml` | Starship prompt (Catppuccin Mocha palette) |
| `.config/ghostty/` | Ghostty terminal config (Catppuccin Mocha palette) |
| `.config/bat/` | bat pager with Catppuccin themes |
| `.config/opencode/` | OpenCode AI agent config (agents, commands, skills, profiles) |
| `.config/goose/` | Goose AI agent config |
| `.claude/` | Claude Code config (agents, rules, commands) |
| `.agents/` | Shared AI agent skills (test-driven-development, writing-skills) |
| `.devcontainer/` | [[devcontainers]] setup with 4 custom features |
| `.dotfiles/` | Bare repo metadata, `.gitconfig` extension, `.gitignore` allowlist, docs |
| `.github/` | CI workflows |
| `.vim/` | Vim config (indent, plugin) |
| `Library/LaunchAgents/` | macOS launch agents (`dev.mrbro.*` prefix) |

## Shell Configuration

### Bash

Entry: `.bashrc` sources `.config/bash/main`. The bash config follows a modular `init.d/` pattern with numbered prefixes for ordering:

- `init.d/002-prompt.bash`, `003-history.bash` — core shell setup
- `init.d/brew.bash`, `code.bash`, `nix.bash`, `rust.bash`, `go.bash`, etc. — per-tool initialization
- `local.d/` — machine-specific overrides (gitignored, never committed)
- `exports` — shared environment variables (sourced by both bash and zsh)
- `aliases` — shell aliases including `.dotfiles` bare repo alias
- `functions` — shell functions including `command_exists` guard

### Zsh

Entry: `.zshenv` sources `.config/zsh/.zshenv`. Zsh plugin management via **sheldon** with deferred loading (`zsh-defer`):

- `zsh-history-substring-search` — history navigation
- `zsh-autosuggestions` — fish-like autosuggestions (async, strategy: history+completion)
- `fast-syntax-highlighting` — syntax highlighting (zdharma-continuum)
- `zsh-snap` (znap) — lazy eval/completion loader
- `prezto` modules — environment, history, directory
- `zsh-completions`, `zsh-better-npm-completion` — extended completions
- `brew-keeper` — Homebrew package tracking
- `history-search-multi-word` — multi-word history search
- **mise** activation via znap eval
- **starship** prompt via znap eval
- **rustup/cargo** completions via znap
- VS Code shell integration (conditional on `$TERM_PROGRAM`)
- Shellfish (Secure ShellFish iOS) integration

### Prompt

**Starship** with Catppuccin Mocha palette. Custom format with powerline-style segments: username, directory, git branch/status, language versions, cmd duration, jobs, battery, time, status.

## Tool Management (mise)

[[mise]] serves as the polyglot runtime manager with an extensive toolchain:

| Category              | Tools                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| JavaScript/TypeScript | Node 24.15.0, npm 11.12.1, pnpm 10.33.0, Bun 1.3.12, Deno 2.7.12, TypeScript 6.0.2  |
| Python                | Python 3.14.4, Poetry 2.3.4 (via pipx), Pyright 1.1.408                             |
| Systems               | Rust 1.95.0, cargo-binstall 1.15.5, Go 1.26.2, Zig 0.15.2, ZLS 0.15.0               |
| Formatting/Linting    | Prettier 3.8.3, Biome 2.4.12, shfmt 3.13.1, ast-grep 0.40.5                         |
| AI Tools              | Claude Code 2.1.112, OpenCode 1.4.11, agent-browser 0.25.4, skills 1.5.0, ocx 2.0.6 |
| Utilities             | tsx 4.21.0, rimraf 6.1.3, Playwright 1.59.1, Puppeteer 24.40.0, lolcrab 0.4.1       |
| Language Servers      | Pyright, remark-language-server, typescript-language-server                         |
| Infrastructure        | @marcusrbrown/infra (latest)                                                        |

npm packages use bun as the backend (`settings.npm.bun = true`).

Mise tasks are organized in `.config/mise/tasks/`:

- `dotfiles.toml` — install, format tasks
- `_mise.toml` — mise-specific tasks

## AI Agent Configuration

The repo contains extensive AI agent configurations:

### Claude Code (`.claude/`)

- **Agents:** `dotfiles-reviewer.md`, `frontend-infrastructure-expert.md`
- **Rules:** Astro/Starlight, modular code, Playwright, React, self-explanatory commenting, Storybook, TypeScript, Context7 usage
- **Commands:** `create-hook.md`
- **Settings:** `.claude/settings.json`

### OpenCode (`.config/opencode/`)

- **Own AGENTS.md** with nested knowledge base
- **Agents:** `research.md`
- **Commands:** `generate-readme.md`, `research.md`, `review-and-refactor.md`, `review-uncommitted.md`, `review_command.md`, full PRD workflow (`prd/create`, `implement`, `review`, `to-features`, `to-rfcs`, `to-rules`, `update`)
- **Skills:** `content-research-writer`, `copilot-cloud-agent`, `file-organizer`, `research-tools`
- **Profiles:** default profile with own AGENTS.md and config
- **Scripts:** `opencode-doctor.ts` (health check with tests)
- **MCP configs:** `magic-context.jsonc`, `ocx.jsonc`, `oh-my-openagent.json`, `aft.jsonc`, `tui.json`

### Shared Agent Skills (`.agents/`)

- `test-driven-development/` — TDD skill + testing anti-patterns reference
- `writing-skills/` — Anthropic best practices, persuasion principles, Graphviz conventions, testing skills with subagents

## Terminal

**Ghostty** (migrated from iTerm2) with Catppuccin Mocha color scheme. MesloLGS Nerd Font Mono at 12pt, 90% background opacity with blur, macOS native titlebar, iTerm2-compatible keybindings.

## macOS Setup (Brewfile)

Extensive Homebrew manifest covering:

- **CLI tools:** bat, fd, fzf, ripgrep, jq, yq, lsd, exa, htop, delta, shellcheck, shfmt, tmux, nmap, gh, git-lfs
- **Languages:** Go, Ruby, Deno, Python (3.10, 3.11)
- **Build tools:** autoconf, automake, cmake, libtool, swig
- **Crypto/Security:** gnupg, pinentry-mac, wireguard-tools
- **Casks:** Firefox, iTerm2, Raycast, Slack, Ghostty (migrated from iTerm2), Arduino IDE, Ghidra, DB Browser for SQLite
- **Fonts:** Fira Code, Fira Mono, JetBrains Mono, Meslo LG, Sauce Code Pro (all Nerd Font variants)
- **Mac App Store:** Xcode, Home Assistant, Data Jar, Bluetooth Inspector, Draw Things, MQTTAnalyzer, Pi-hole Remote
- **VS Code extensions:** 100+ extensions including GitHub Copilot, ESLint, Prettier, Docker, YAML, ESPHome, PlatformIO, Solidity
- **Notable taps:** blacktop/tap (ipsw — iOS research), sourcegraph (src-cli, Cody AI)

## Devcontainer

Based on `mcr.microsoft.com/devcontainers/base:2.1.7` (Debian). Requires 4 CPUs. Uses volume mount for workspace persistence.

### Custom Features

| Feature        | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `dotfiles-dev` | Clones bare repo, checks out main, configures git environment |
| `mise`         | Installs mise tool version manager                            |
| `sheldon`      | Installs sheldon zsh plugin manager                           |
| `keychain`     | SSH/GPG key agent management                                  |

### Remote Features

- `common-utils` (zsh as default shell, no oh-my-zsh)
- `github-cli`
- `node` (no yarn, no node-gyp deps)
- `shellcheck`
- `starship`

XDG directories explicitly set via `containerEnv`. GIT_DIR/GIT_WORK_TREE set via `remoteEnv`.

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, release, dispatch | Devcontainer build + mise install validation |
| Fro Bot | `fro-bot.yaml` | PR, issues, comments, daily schedule (15:30 UTC), dispatch | AI-powered PR review + daily maintenance |
| Renovate | `renovate.yaml` | (reusable from bfra-me/.github) | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | (reusable from bfra-me/.github) | Probot settings sync |

### Main Workflow Jobs

1. **Devcontainer CI** — Builds devcontainer image, pushes to `ghcr.io/marcusrbrown/dotfiles-devcontainer`, runs `devcontainer-info` command
2. **Install mise** — Validates mise installation via `jdx/mise-action` (version 2026.4.16)

### Branch Protection

Required status checks on `main`: Devcontainer CI, Fro Bot, Install mise, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`) using `fro-bot/agent@v0.40.2`. Comprehensive integration with:

- **PR review prompt:** Focuses on correctness (shell startup), portability (macOS/Linux), security (no secrets), convention compliance (init.d numbering, XDG, GPG signing, LaunchAgent prefixes), devcontainer impact
- **Structured review format:** Verdict (PASS/CONDITIONAL/REJECT), blocking issues, non-blocking concerns, security check, risk assessment
- **Daily schedule prompt (15:30 UTC):** Six maintenance categories:
  1. Errored PRs — diagnose and fix failing CI on open PRs
  2. Security — Dependabot/Renovate alerts, secret scanning
  3. Config quality & repo hygiene — devcontainer build, .gitignore consistency, stale TODOs, convention compliance, AGENTS.md accuracy
  4. Developer experience — formatting via Prettier
  5. Devcontainer & CI health — workflow runs, feature scripts, mise config
  6. Cross-project progressive improvement — portfolio-wide health dashboard (observation only, never modifies other repos)
- **Authentication:** `FRO_BOT_PAT` + `OPENCODE_AUTH_JSON` + `OMO_PROVIDERS`
- **Concurrency:** per-issue/PR, non-canceling
- **Filters:** Skips bot-authored PRs, forks, and bot issues. Comment triggers require `@fro-bot` mention from OWNER/MEMBER/COLLABORATOR.

## Dependency Management (Renovate)

Extends `marcusrbrown/renovate-config#4.5.8` + `sanity-io/renovate-config:semantic-commit-type`.

- Custom regex manager for `_VERSION` variables in mise config files
- Patch updates enabled for devcontainer, Dockerfile, docker-compose, mise managers
- Claude Code npm package updates disabled
- Automerge for unstable (0.x) minor/patch: `@cortexkit/aft-opencode`, `@cortexkit/opencode-magic-context`, `agent-browser`, `opencode-anthropic-oauth`
- Dashboard approval required for devcontainer base image updates
- Immediate PR creation, rebase when behind base branch

## Probot Settings

Extends `fro-bot/.github:common-settings.yaml` — confirms membership in the Fro Bot-managed ecosystem, same pattern as [[marcusrbrown--ha-config]].

## Conventions

- **Allowlist .gitignore:** Everything ignored by default, specific paths un-ignored in `.dotfiles/.gitignore`
- **Shell init ordering:** `init.d/` files use numbered prefixes (e.g., `002-prompt.bash`, `003-history.bash`)
- **Machine-local overrides:** `local.d/` directories and `*.local` files (gitignored)
- **Shared exports:** `.config/bash/exports` sourced by both bash and zsh
- **XDG compliance:** Configs use `~/.config`, `~/.local/share`, `~/.cache`
- **GPG signing:** Enabled on commits
- **LaunchAgent prefix:** `dev.mrbro.*`
- **`command_exists` guard:** Used for conditional tool initialization in aliases/init scripts
- **Catppuccin Mocha:** Consistent color theme across terminal (Ghostty), prompt (Starship), pager (bat)

## Notable Patterns

- **Bare git repo over symlinks:** No symlink farm or GNU Stow. Files live at their native paths; git just tracks them with env var overrides.
- **Heavy AI tooling investment:** Three parallel AI agent setups (Claude Code, OpenCode, shared `.agents/`), each with their own agents, rules, commands, and skills. OpenCode has its own AGENTS.md, profiles, and a health-check script (`opencode-doctor.ts`).
- **Sheldon deferred loading:** Zsh plugins loaded via `zsh-defer` to minimize shell startup latency. Sheldon templates use custom regions with deferred source patterns.
- **Cross-project Fro Bot schedule:** The daily maintenance prompt surveys all `marcusrbrown/*` repos for CI health, Fro Bot presence, AGENTS.md presence, security alerts, and stale PRs — creating a portfolio health dashboard.
- **Catppuccin consistency:** Mocha variant used across Ghostty, Starship, bat, and fast-syntax-highlighting.
