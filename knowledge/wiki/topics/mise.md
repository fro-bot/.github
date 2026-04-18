---
type: topic
title: mise (Tool Version Manager)
created: 2026-04-18
updated: 2026-04-18
tags: [mise, tool-management, dev-tools, asdf, runtime-manager]
related:
  - marcusrbrown--dotfiles
  - marcusrbrown--ha-config
---

# mise

Polyglot runtime and tool version manager. Rust-based successor to asdf with native support for Node, Python, Ruby, Go, Rust, and more. Used across Marcus's repos for consistent toolchain management.

## Repos Using mise

- [[marcusrbrown--dotfiles]] — Primary toolchain definition (`~/.config/mise/config.toml`), manages 30+ tools including Node, Python, Rust, Go, Zig, Deno, and AI CLI tools
- [[marcusrbrown--ha-config]] — Manages pre-commit tool version via aqua backend

## Configuration Patterns

### Tool Definition

Tools are pinned in `mise.toml` or `.config/mise/config.toml`:

```toml
[tools]
node = "24.15.0"
python = "3.14.4"
rust = "1.95.0"
"npm:typescript" = "6.0.2"
```

### npm Package Backend

mise can use bun as the backend for npm packages:

```toml
[settings.npm]
bun = true
```

This is used in [[marcusrbrown--dotfiles]] for faster npm tool installation.

### Task System

mise tasks are defined in TOML files under `.config/mise/tasks/`:

```toml
[task_config]
includes = ["tasks/dotfiles.toml", "tasks/_mise.toml"]
```

Common tasks: `format` (prettier), `install` (tool setup), `opencode:doctor` (AI config health check).

### Renovate Integration

Tool versions in mise config files can be auto-updated by Renovate using a custom regex manager that matches `_VERSION` variables with `# renovate:` annotations:

```toml
MISE_VERSION: 2026.4.16 # renovate: datasource=github-releases packageName=jdx/mise
```

## CI Usage

In GitHub Actions, mise is installed via `jdx/mise-action`:

```yaml
- uses: jdx/mise-action@v4.0.1
  with:
    version: ${{ env.MISE_VERSION }}
```

## Relationship to asdf

mise (formerly `rtx`) is a drop-in replacement for asdf, reading `.tool-versions` files natively. It adds task running, environment variable management, and significantly faster performance. The Brewfile in [[marcusrbrown--dotfiles]] still references `rtx` as the brew formula name, reflecting the rename history.
