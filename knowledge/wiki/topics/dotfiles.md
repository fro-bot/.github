---
type: topic
title: Dotfiles Management
created: 2026-04-18
updated: 2026-08-26
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

- **OpenCode** (`.config/opencode/`): Full plugin stack — current state and version history live in [[marcusrbrown--dotfiles]]. As of 2026-08-26 (SHA `3479589`): the July experiment partially reverted — the OMO-slim **active preset flipped back `openai` → `mixed`** (plugin 2.2.11), with the Anthropic seat moved onto **`anthropic/claude-opus-5`** as the mixed orchestrator; OpenAI routing stays on the `gpt-5.6-*` line (sol/luna/terra). The top-level `fast-generic` mechanical agent now uses a **model fallback array** (`gpt-5.3-codex-spark` → `github-copilot/gpt-5.4-mini`). **`opencode-copilot-delegate@0.12.1` returned to the plugin array** (reversing the 2026-07-10 drop), so plugin-driven and skill-driven Copilot delegation now coexist. `@fro.bot/systematic` climbed the v3 minor train to 3.15.0 with a retuned `systematic.jsonc` (added a `workflow` category + a `workflow_guard` block). MCP set **contracted 3 → 2** (`websearch`/Exa removed; `grep_app` renamed `gh_grep`). `@cortexkit/opencode-magic-context` (0.38.1) and `@cortexkit/aft-opencode` (0.52.1) still run on **plugin defaults**. The top-level headless default model stays removed — routing is fully delegated to the slim presets.
  - _Prior (2026-07-27):_ `oh-my-opencode-slim` crossed a **v1→v2 major** (2.2.8), active preset flipped `mixed` → `openai`, `@fro.bot/systematic` crossed **v2→v3** (3.3.0), companion `@cortexkit/opencode-openai-auth` added.
- **Claude Code** (`.claude/`): Repo-scoped agents, commands, and rules
- **Repo-scoped skills**: `.agents/skills/copilot-cli` (non-interactive GitHub Copilot CLI delegation) remains the sole `.agents/` bundle, but as of 2026-07-10 a second skills tree lives under `.config/opencode/skills/` with six bespoke skills — `clonedeps`, `codemap`, `content-research-writer`, `copilot-cloud-agent`, `file-organizer`, `simplify`. See [[marcusrbrown--dotfiles]].
- **Local-LLM distillation**: A new `ollama-distill` pipeline (`.config/opencode/scripts/ollama-distill.ts`, `mise run distill`) reads the OpenCode session SQLite DB and produces Markdown summaries via local Ollama — keeping session summarization off hosted models.
- **AGENTS.md**: Canonical knowledge base for all AI agents operating in the repo

This pattern — dotfiles as AI agent configuration — is distinctive: the home directory becomes the ground truth for agent personas, model routing, and skill availability across all projects. A recurring theme in 2026-07 is **deferring to upstream plugin defaults** (deleting bespoke magic-context/aft config) while keeping bespoke logic where no upstream exists (local distillation, copilot delegation skills). Late July 2026 saw two upstream **major-version boundaries land together** (oh-my-opencode-slim v2, systematic v3) alongside a fresh `openai/gpt-5.6-*` model migration — the config tracks provider model churn aggressively while holding the structural conventions steady.

A newer distinctive move (2026-08-26): the repo's **operational agent-tooling scripts now have CI-enforced unit tests**. The Bun/TypeScript maintenance scripts under `.config/opencode/scripts/` (`opencode-doctor`, `ollama-distill`) are exercised by a `Script Tests` matrix on **both Linux and macOS** in the repo's `Main` workflow, with a stable aggregator status context wired into branch protection. Treating home-directory agent scripts as first-class, cross-platform-tested software — rather than throwaway glue — is a step beyond typical dotfiles hygiene. It also shows the config's churn is not monotonic: the same window that added test rigor also **reverted** two July decisions (active preset `openai` → `mixed`; re-adding the `opencode-copilot-delegate` plugin), a reminder that these are live-tuned experiments, not one-way migrations.

## Related Technologies

- **[[mise]]** — Polyglot tool version manager
- **Sheldon** — Zsh plugin manager with deferred loading
- **Starship** — Cross-shell prompt
- **Homebrew** — macOS package manager (Brewfile for declarative installs)
- **OpenCode** — AI coding environment with plugin architecture and MCP support
- **oh-my-openagent** — Multi-agent routing framework for OpenCode
