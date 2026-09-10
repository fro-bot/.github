---
type: entity
title: mise
created: 2026-04-18
updated: 2026-09-10
sources:
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: fe0144c0e9fc0168fc4ed9aa9fa0492df4846599
    accessed: 2026-09-10
tags: [mise, tool-management, runtime-versions, asdf, dev-tools, pyenv, git-dir-leak, installer-pinning, devcontainer]
aliases: [rtx]
related:
  - marcusrbrown--dotfiles
  - marcusrbrown--ha-config
---

# mise

Polyglot runtime/tool version manager. Rust-based successor to asdf (originally named `rtx`). Manages language runtimes, CLI tools, and task definitions from a single TOML config.

Site: https://mise.jdx.dev/

## Upstream Behavior Changes Worth Tracking

### 2026.9.0 resolves Python versions through pyenv — and therefore shells out to `git` (2026-09-01)

mise `2026.9.0`, released 2026-09-01, began resolving Python's version list by **cloning pyenv and running `python-build --definitions`**. Nothing in the prior release line made mise invoke `git` on this path. That is an ordinary implementation detail until it meets an environment with `GIT_DIR` exported process-wide, at which point mise's internal `git` calls are redirected, the pyenv tree never lands, and mise executes a `python-build` binary that does not exist.

The failure signature is worth memorizing because it is uninformative by construction:

```text
mise WARN  Failed to resolve tool version list for python: python@3.14.7:
  failed to execute command: …/mise/python/pyenv/plugins/python-build/bin/python-build
  --definitions: No such file or directory (os error 2)
mise ERROR Failed to install tools: core:python@3.14.7, pipx:poetry@2.4.2
```

Python produces **no progress lines at all** while every other tool installs cleanly, because it fails during *version-list resolution* and never enters the install pipeline — so the precompiled download that normally satisfies it is never attempted. Documented in full at [[marcusrbrown--dotfiles]]; the `GIT_DIR` half generalizes in [[dotfiles]].

Two operational consequences for anyone running mise in a container:

- **`mise install` as a devcontainer `postCreateCommand` inherits `remoteEnv`.** Any git-environment override declared there reaches mise. Keep `GIT_DIR`/`GIT_WORK_TREE` out of `remoteEnv` and scope them per command instead.
- **Pin the mise install itself.** `curl https://mise.run | sh` accepts `MISE_VERSION` from the environment:

  ```bash
  # renovate: datasource=github-releases packageName=jdx/mise
  MISE_VERSION=2026.9.4
  curl https://mise.run | MISE_INSTALL_PATH="$MISE_INSTALL_PATH" MISE_VERSION="$MISE_VERSION" sh
  ```

  Unpinned, the container adopts every mise release the day it ships, so a behavior change presents as a repository regression with no repository commit. Pair with `set -eo pipefail` — see [[dotfiles]] for why `set -e` alone lets a 404'd pin install nothing and exit 0.

- **`jdx/mise-action`'s `MISE_VERSION` and a devcontainer's mise install are separate pins.** A repo that pins one and not the other gets a green CI job vouching for a version the failing job never ran. See *Two Jobs Pinning the Same Tool Are Not the Same Pin* in [[github-actions-ci]].

### `cache: true` on `jdx/mise-action` can void an install-verification job

If a job exists to prove that a mise config installs cleanly, a cache hit skips the install and the job passes without testing anything. The cache is also large — [[marcusrbrown--dotfiles]] measured **~993 MB per entry**, and keyed on mise version × config hash × ref it consumed 8.9 GB of a 10 GB Actions budget across nine entries, LRU-evicting every other cache in the repository. Detail in [[github-actions-ci]].

## Usage Across Repos

### [[marcusrbrown--dotfiles]] — current state (SHA `fe0144c`, 2026-09-10)

**Language runtimes:** Node 24.21.0, Python 3.14.7, Rust 1.98.1, Go 1.27.1, Bun 1.4.2, Deno 2.9.6, Zig 0.15.2 (ZLS 0.16.0), **pnpm 12.3.4**, **npm 12.0.2**.

**CLI tools (npm):** **TypeScript 7.0.2**, Prettier 3.9.6 (with `@bfra.me/prettier-config` 0.16.11), ast-grep 0.45.3, Playwright 1.63.0, agent-browser 0.36.0, skills 1.5.24, ocx 2.0.15, tsx 4.23.13, rimraf 6.1.3, `@github/copilot` 1.0.83, `@biomejs/biome` 2.5.12, `@fro.bot/harness` 1.18.29-harness.88b6b5fb.

**Manually pinned (Renovate disabled):** `@anthropic-ai/claude-code` 2.1.163. Stock `opencode-ai` remains **absent** since 2026-08-26 — the harness build is the only OpenCode CLI.

**Aqua tools:** shfmt (`aqua:mvdan/sh`) 3.14.1, gitleaks (`aqua:gitleaks/gitleaks`) 8.30.1.

**Language servers (npm):** pyright 1.1.413, **typescript-language-server 6.0.0**.

**Other:** cargo-binstall 1.23.0, pipx 1.17.2, `pipx:poetry` 2.4.3, `@marcusrbrown/infra` latest.

**Four major boundaries in one window:** npm v11 → v12, pnpm v11 → v12, `npm:typescript` v6 → v7 (after holding at 6.0.3 since 2026-04-22), `typescript-language-server` v5 → v6. No tools added or removed — pure version movement.

**Tasks:** `distill`, `format`, `install`, `mise`, `opencode`, `print` — file-based shebang tasks under `.config/mise/tasks/`. A portability note recorded in the repo's own `AGENTS.md` is worth carrying: **`task_config.includes` does not expand `~`/`$HOME`/`{{config_root}}`/`{{xdg_config_home}}` and silently ignores relative paths in global config** (`project_root` is `None`), so the field is unusable for a global config — use auto-discovered file-based tasks instead.

### Historical Snapshot — [[marcusrbrown--dotfiles]] (SHA `cd03ad8`, 2026-07-27)

Superseded by the entry above. The intervening 2026-08-26 snapshot (SHA `3479589`) is recorded only on [[marcusrbrown--dotfiles]]; its notable deltas were the removal of `opencode-ai`, `puppeteer`, and `vibe-tools` and the addition of an explicit `pipx` pin.

**Language runtimes:** Node 24.18.0, Python 3.14.6, Rust 1.97.1, Go 1.26.5, Bun 1.3.14, Deno 2.9.4, Zig 0.15.2 (ZLS 0.16.0), pnpm 11.17.0, npm 11.18.0.

**CLI tools (npm):** TypeScript 6.0.3, Prettier 3.9.6 (with `@bfra.me/prettier-config` 0.16.9), ast-grep 0.44.1, Playwright 1.61.1, Puppeteer 25.3.0, agent-browser 0.33.0, skills 1.5.20, ocx 2.0.11, tsx 4.23.1, rimraf 6.1.3, vibe-tools 0.63.3, `@github/copilot` 1.0.74, `@biomejs/biome` 2.5.5, `@fro.bot/harness` 1.18.5-harness.3a55d7d2 (realigned in lockstep with stock `opencode-ai@1.18.5`).

**Manually pinned (Renovate disabled):** `opencode-ai` 1.18.5, `@anthropic-ai/claude-code` 2.1.163.

**Aqua tools:** shfmt (`aqua:mvdan/sh`) 3.13.1, gitleaks (`aqua:gitleaks/gitleaks`) 8.30.1.

**Language servers (npm):** pyright 1.1.411, typescript-language-server 5.3.0.

**Other:** cargo-binstall 1.21.1, `pipx:poetry` 2.4.1, `@marcusrbrown/infra` latest.

### Historical Snapshot — [[marcusrbrown--dotfiles]] (SHA `e8ebc5c`, 2026-07-10)

Superseded by the entry above. Node 24.18.0, Python 3.14.6, Rust 1.97.0, Go 1.26.5, Deno 2.9.2, pnpm 11.10.0, ast-grep 0.43.0, biome 2.5.2, prettier 3.9.4, agent-browser 0.31.1, skills 1.5.15, copilot 1.0.68, `@fro.bot/harness` 1.17.14-harness.e98fbc0f, opencode-ai 1.17.12, claude-code 2.1.128, cargo-binstall 1.20.1, tsx 4.23.0.

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

**Extend the manager past the TOML (2026-09-10).** A `_VERSION` regex manager scoped to `mise.toml` / `.mise/config.toml` misses every mise version pinned *outside* mise's own config — most importantly the `MISE_VERSION` in a devcontainer feature's install script and the one in a workflow `env:` block. [[marcusrbrown--dotfiles]] widened its `managerFilePatterns` to cover `.devcontainer/features/*/install.sh` after discovering that a freshly-added `# renovate:` marker there was matched by nothing. **A `# renovate:` comment does not make a version managed** — verify from Renovate's debug log, which reports the files each manager matched:

```text
DEBUG: Matched 2 file(s) for manager regex: .config/mise/config.toml, .devcontainer/features/mise/install.sh
```

### Bun-Accelerated npm Installs

The `settings.npm.bun = true` option causes mise to use Bun as the npm package installer instead of the default npm, providing faster installation for npm-based tools managed by mise.
