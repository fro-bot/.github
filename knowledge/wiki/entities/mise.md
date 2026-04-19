---
type: entity
title: mise
created: 2026-04-18
updated: 2026-04-18
tags: [mise, tool-management, runtime-versions, asdf, dev-tools]
aliases: [rtx]
related:
  - marcusrbrown--dotfiles
  - marcusrbrown--ha-config
---

# mise

Polyglot runtime/tool version manager. Rust-based successor to asdf (originally named `rtx`). Manages language runtimes, CLI tools, and task definitions from a single TOML config.

Site: https://mise.jdx.dev/

## Usage Across Repos

### [[marcusrbrown--dotfiles]]

Primary tool version manager. Config at `.config/mise/config.toml` manages 20+ tools including Node, Python, Rust, Go, Bun, Deno, Zig, and npm-based CLI tools (TypeScript, Prettier, Claude Code, OpenCode, ast-grep, Biome, Playwright).

Notable settings:

- `settings.npm.bun = true` — uses Bun to install npm packages (faster)
- `idiomatic_version_file_enable_tools = ["node"]` — respects `.node-version` files
- Task definitions in `tasks/dotfiles.toml` and `tasks/_mise.toml`
- Installed in devcontainer via custom feature
- Version managed by Renovate custom regex manager for `_VERSION` variables

### [[marcusrbrown--ha-config]]

Manages `pre-commit` tool version via aqua backend. Configured in `mise.toml` at repo root. Lighter usage compared to dotfiles — primarily for the pre-commit hook toolchain.

## Patterns Observed

### Declarative Config

Tools and versions declared in `config.toml` rather than shell-specific version files. Single source of truth for the development environment.

### Task Runner

Mise doubles as a task runner (`mise run <task>`). Used for `format`, `install`, and `opencode:doctor` tasks in dotfiles. Task definitions live in TOML files under a `tasks/` directory.

### Devcontainer Integration

Custom devcontainer feature installs mise and runs `mise install` post-create, ensuring all tool versions are available in the container environment.

### Renovate Integration

Renovate manages mise tool version bumps via custom regex managers that parse `_VERSION` variables and tool entries from TOML config files.
