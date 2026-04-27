---
type: entity
title: mise
created: 2026-04-18
updated: 2026-04-22
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

Primary tool version manager. Config at `.config/mise/config.toml` manages 30+ tools including Node, Python, Rust, Go, Bun, Deno, Zig, and npm-based CLI tools. As of 2026-04-22 (SHA `ae026c1`):

**Language runtimes:** Node 24.15.0, Python 3.14.4, Rust 1.95.0, Go 1.26.2, Bun 1.3.13, Deno 2.7.13, Zig 0.15.2 (with ZLS), pnpm 10.33.0, npm 11.12.1

**CLI tools (npm):** TypeScript 6.0.3, Prettier 3.8.3 (with `@bfra.me/prettier-config`), ast-grep 0.40.5, Playwright 1.59.1, Puppeteer 24.41.0, agent-browser 0.26.0, skills 1.5.1, ocx 2.0.7, tsx 4.21.0, rimraf 6.1.3, vibe-tools 0.63.3

**OpenCode ecosystem (npm):** opencode-ai 1.14.18 (Renovate disabled), `@cortexkit/opencode-magic-context` 0.13.0, `@cortexkit/aft-opencode` 0.14.0, `@marcusrbrown/infra` latest, `@anthropic-ai/claude-code` 2.1.112 (Renovate disabled), `@biomejs/biome` 2.4.12 (re-added after prior removal)

**Language servers (npm):** pyright 1.1.409, remark-language-server 3.0.0, typescript-language-server 5.1.3

**Other:** shfmt 3.13.1 (aqua), cargo-binstall 1.15.5, lolcrab 0.4.1 (github:mazznoer/lolcrab), `pipx:poetry` 2.3.4

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

Renovate manages mise tool version bumps via custom regex managers that parse `_VERSION` variables and tool entries from TOML config files. Some tools (notably `@anthropic-ai/claude-code` and `opencode-ai`) have Renovate updates disabled for manual version control.

### Bun-Accelerated npm Installs

The `settings.npm.bun = true` option causes mise to use Bun as the npm package installer instead of the default npm, providing faster installation for npm-based tools managed by mise.
