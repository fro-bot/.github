---
type: topic
title: Dotfiles Management
created: 2026-04-18
updated: 2026-04-27
tags: [dotfiles, shell, configuration, bare-git-repo, xdg]
related:
  - marcusrbrown--dotfiles
---

# Dotfiles Management

Patterns and conventions for managing shell and development environment configuration files across machines.

## Repos Using Dotfiles Patterns

- [[marcusrbrown--dotfiles]] — Marcus's primary dotfiles repo (bare git, XDG-compliant, multi-shell)

## Management Approaches

### Bare Git Repository (used by Marcus)

The `GIT_DIR` / `GIT_WORK_TREE` pattern treats `$HOME` as the working tree and a hidden directory (e.g., `~/.dotfiles`) as the git dir. No symlinks, no wrapper tools.

Key mechanics:

- Allowlist `.gitignore`: ignore everything by default (`/*`), un-ignore specific paths
- All operations via alias: `alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'`
- Untracked files hidden by default (bare repo config)
- New files must be explicitly allowlisted before tracking

**Tradeoffs:** Zero dependencies beyond git. Full git history and branching for configs. But requires care — accidental `git add .` from `$HOME` could stage sensitive files. The allowlist pattern mitigates this.

### Alternative Approaches (not used)

- **GNU Stow** — Symlink farm manager. Simple, but symlinks can confuse tools.
- **chezmoi** — Template-based dotfile manager with encryption. More complex, adds a dependency.
- **rcm** — Thoughtbot's dotfile manager. Convention-based, symlink approach.
- **yadm** — Yet Another Dotfiles Manager. Wraps git with dotfile-specific features.

## Conventions Observed

### XDG Base Directory Compliance

All configuration follows the XDG spec:

- `XDG_CONFIG_HOME` (`~/.config/`) — configuration files
- `XDG_DATA_HOME` (`~/.local/share/`) — application data
- `XDG_CACHE_HOME` (`~/.cache/`) — cache files
- `XDG_STATE_HOME` (`~/.local/state/`) — state files

### Shell Init Organization

The `init.d/` pattern with numbered prefixes controls load order:

```
.config/bash/init.d/
  002-prompt.bash
  010-nvm.bash
  ...
```

Machine-local overrides in `local.d/` directories are gitignored — secrets and machine-specific paths never enter the repo.

### Privacy Defaults

Telemetry and analytics disabled by default for all tools that support it. This is a deliberate, consistent choice across the environment.

### Tool Version Management

[[mise]] manages runtime versions (Node, Python, Rust, Go, etc.) declaratively via `.config/mise/config.toml`. This replaces the older pattern of per-tool version managers (nvm, pyenv, etc.).

### Devcontainer Portability

Devcontainer configurations with custom features enable the same environment in Codespaces, VS Code Remote Containers, or any devcontainer-compatible runtime. Published images on GHCR provide instant startup without rebuilding.

## AI Agent Integration in Dotfiles

Marcus's dotfiles include a rich AI agent configuration layer, treating the development environment itself as an agentic platform:

- **OpenCode** (`.config/opencode/`): Full plugin stack including `oh-my-openagent` (multi-agent routing with category-level model assignment), `@cortexkit/opencode-magic-context` (adaptive context compaction v0.15.3), `@cortexkit/aft-opencode` (adaptive fine-tuning v0.16.1 with cross-project scope and semantic search), and MCP servers (context7, grep_app, tavily, exa). Agents use a hybrid model routing strategy: `github-copilot/*` for GPT/Gemini/Grok, direct `anthropic/*` for Opus/Sonnet where max-variant control is needed. Default model set to `opencode-go/kimi-k2.6`. TUI config adds Catppuccin theme.
- **Claude Code** (`.claude/`): Repo-scoped agents, commands, and rules
- **Repo-scoped skills** (`.agents/skills/`): Packaged skill bundles (`copilot-cli`, `test-driven-development`, `writing-skills`) for reuse across agent sessions. The `copilot-cli` skill covers non-interactive invocation of GitHub Copilot CLI for agent delegation.
- **AGENTS.md**: Canonical knowledge base for all AI agents operating in the repo

This pattern — dotfiles as AI agent configuration — is distinctive: the home directory becomes the ground truth for agent personas, model routing, and skill availability across all projects.

## Related Technologies

- **[[mise]]** — Polyglot tool version manager
- **Sheldon** — Zsh plugin manager with deferred loading
- **Starship** — Cross-shell prompt
- **Homebrew** — macOS package manager (Brewfile for declarative installs)
- **OpenCode** — AI coding environment with plugin architecture and MCP support
- **oh-my-openagent** — Multi-agent routing framework for OpenCode
