---
type: topic
title: Dotfiles Management
created: 2026-04-18
updated: 2026-04-18
tags: [dotfiles, shell, configuration, bare-git-repo, xdg]
related:
  - marcusrbrown--dotfiles
---

# Dotfiles Management

Cross-cutting topic covering dotfiles management patterns observed across the Fro Bot ecosystem.

## Repos Using Dotfiles Patterns

- [[marcusrbrown--dotfiles]] — Marcus's primary dotfiles repo (bare git worktree pattern)

## Bare Git Worktree Pattern

The preferred approach uses a bare git repository with `$HOME` as the working tree, avoiding symlinks entirely:

```bash
git init --bare $HOME/.dotfiles
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
.dotfiles git config status.showUntrackedFiles no
```

Files are tracked at their native paths. No symlink farm, no GNU Stow, no special tooling beyond git itself.

### Allowlist .gitignore

To prevent accidental tracking of home directory contents, the `.gitignore` uses an allowlist pattern:

```gitignore
# Ignore everything
/*
# Then explicitly allow tracked paths
!/.config/
!/.bashrc
```

New files must be allowlisted before they can be staged.

## Shell Configuration Patterns

### Modular init.d/ Pattern

Shell initialization is split into per-tool scripts in `init.d/` directories with numbered prefixes for ordering:

```
.config/bash/init.d/
├── 002-prompt.bash
├── 003-history.bash
├── brew.bash
├── code.bash
├── rust.bash
└── ...
```

### Machine-Local Overrides

Sensitive or machine-specific config goes in gitignored locations:

- `local.d/` directories (e.g., `.config/bash/local.d/`)
- `*.local` files (e.g., `.zshrc.local`)

### XDG Base Directory Compliance

Configs follow XDG conventions:

- `XDG_CONFIG_HOME` = `~/.config`
- `XDG_DATA_HOME` = `~/.local/share`
- `XDG_CACHE_HOME` = `~/.cache`

### `command_exists` Guard

Optional tool initialization is guarded by checking command availability, preventing errors on machines without all tools installed.

## CI Patterns

Dotfiles repos can be CI-validated using devcontainer builds. The devcontainer reproduces the dotfiles environment in a container, verifying that:

- The bare repo can be cloned and checked out
- Shell startup completes without errors
- Tool managers (mise, sheldon) install correctly

## Related Technologies

- **[[mise]]** — Polyglot runtime/tool version manager, replaces asdf/nvm/pyenv
- **sheldon** — Zsh plugin manager with deferred loading support
- **starship** — Cross-shell prompt with language-aware modules
- **Ghostty** — GPU-accelerated terminal emulator
