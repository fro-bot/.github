---
type: topic
title: Dotfiles Management
created: 2026-04-18
updated: 2026-06-27
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

- **OpenCode** (`.config/opencode/`): Full plugin stack — current state and version history live in [[marcusrbrown--dotfiles]]. As of 2026-06-27: `oh-my-opencode-slim` (multi-agent routing, active `mixed` preset) replaced the older `oh-my-openagent` category router; `@cortexkit/opencode-magic-context` (adaptive context compaction, now v0.26.0 with a `opencode-go/deepseek-v4-flash` historian); `@cortexkit/aft-opencode` (fine-tuning, search index disabled); and four remote MCP servers (context7, grep_app, tavily, exa). The `mixed` preset uses an `anthropic/claude-opus-4-8` orchestrator with cheaper models per supporting role.
- **Claude Code** (`.claude/`): Repo-scoped agents, commands, and rules
- **Repo-scoped skills** (`.agents/skills/`): As of 2026-06-16 pruned to a single bespoke bundle, `copilot-cli` (non-interactive GitHub Copilot CLI invocation for agent delegation) — the `test-driven-development` and `writing-skills` bundles were dropped once provided by the upstream `@fro.bot/systematic` / `skills` packages. See [[marcusrbrown--dotfiles]].
- **AGENTS.md**: Canonical knowledge base for all AI agents operating in the repo

This pattern — dotfiles as AI agent configuration — is distinctive: the home directory becomes the ground truth for agent personas, model routing, and skill availability across all projects.

## Related Technologies

- **[[mise]]** — Polyglot tool version manager
- **Sheldon** — Zsh plugin manager with deferred loading
- **Starship** — Cross-shell prompt
- **Homebrew** — macOS package manager (Brewfile for declarative installs)
- **OpenCode** — AI coding environment with plugin architecture and MCP support
- **oh-my-openagent** — Multi-agent routing framework for OpenCode
