---
type: entity
title: mise
created: 2026-04-18
updated: 2026-07-10
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

### [[marcusrbrown--dotfiles]] — current state (SHA `e8ebc5c`, 2026-07-10)

**Language runtimes:** Node 24.18.0, Python 3.14.6, Rust 1.97.0, Go 1.26.5, Bun 1.3.14, Deno 2.9.2, Zig 0.15.2 (ZLS 0.16.0), pnpm 11.10.0, npm 11.18.0.

**CLI tools (npm):** TypeScript 6.0.3, Prettier 3.9.4 (with `@bfra.me/prettier-config` 0.16.9), ast-grep 0.43.0, Playwright 1.61.1, Puppeteer 25.3.0, agent-browser 0.31.1, skills 1.5.15, ocx 2.0.11, tsx 4.23.0, rimraf 6.1.3, vibe-tools 0.63.3, `@github/copilot` 1.0.68, `@biomejs/biome` 2.5.2, `@fro.bot/harness` 1.17.14-harness.e98fbc0f.

**Manually pinned (Renovate disabled):** `opencode-ai` 1.17.12, `@anthropic-ai/claude-code` 2.1.128.

**Aqua tools:** shfmt (`aqua:mvdan/sh`) 3.13.1, gitleaks (`aqua:gitleaks/gitleaks`) 8.30.1.

**Language servers (npm):** pyright 1.1.411, typescript-language-server 5.3.0.

**Other:** cargo-binstall 1.20.1, `pipx:poetry` 2.4.1, `@marcusrbrown/infra` latest.

**Env:** `UV_SYSTEM_CERTS=true`, `NPM_TOKEN` templated from env, redacted env file at `~/.config/mise/.env.local`.

**Tasks:** Beyond `format`/`install`/`opencode:doctor`, a new `distill` task runs the local Ollama session-distillation pipeline (`bun run ~/.config/opencode/scripts/ollama-distill.ts`). Full tool history lives in [[marcusrbrown--dotfiles]].

### Historical Snapshot — [[marcusrbrown--dotfiles]] (SHA `0bb24f0`, 2026-05-24)

Superseded by the entry above.

**Language runtimes:** Node 24.16.0, Python 3.14.5, Rust 1.95.0, Go 1.26.3, Bun 1.3.14, Deno 2.8.0, Zig 0.15.2 (ZLS 0.16.0), pnpm 11.2.1, npm 11.15.0.

**CLI tools (npm):** TypeScript 6.0.3, Prettier 3.8.3, ast-grep 0.42.3, Playwright 1.60.0, Puppeteer 25.0.4, agent-browser 0.27.0, skills 1.5.7, ocx 2.0.11, tsx 4.22.3, rimraf 6.1.3, vibe-tools 0.63.3, `@github/copilot` 1.0.51, `@biomejs/biome` 2.4.15.

**Manually pinned:** `opencode-ai` 1.15.5, `@anthropic-ai/claude-code` 2.1.112. **Aqua:** shfmt 3.13.1, gitleaks 8.30.1. **Other:** cargo-binstall 1.19.1, `pipx:poetry` 2.4.1.

### Historical Snapshot — [[marcusrbrown--dotfiles]] (SHA `ae026c1`, 2026-04-22)

Superseded by the entry above. Original survey notes:

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
