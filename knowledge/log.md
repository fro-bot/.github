# Wiki Log

Chronological record of all wiki operations.

---

_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._

## [2025-06-18 00:00] ingest | marcusrbrown/ha-config

Initial survey of `marcusrbrown/ha-config` (SHA `83784bc`). Created repo page `marcusrbrown--ha-config.md` and topic page `home-assistant.md`. Updated `index.md` to catalog both pages.

Key findings:

- Home Assistant config repo, public, package-based architecture with 11 domain packages
- 10 custom components (bermuda, bhyve, ble_monitor, browser_mod, hacs, mail_and_packages, remote_homeassistant, sengledng, solaredge_modbus_multi, toyota_na)
- ESPHome configs linked via git submodule to `marcusrbrown/esphome.life`
- CI pipeline: YAML lint, Remark lint, Prettier, HA config validation (frenck/action-home-assistant)
- Renovate extends `marcusrbrown/renovate-config`, pre-commit managed via mise/aqua
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- HA version pinned at 2025.6.3, Python deps: esphome 2025.12.7, yamllint 1.38.0

Sources: https://github.com/marcusrbrown/ha-config (SHA 83784bc3a212c10cd358be4da9425e46aa6e90f0)

## [2026-04-18 06:00] ingest | marcusrbrown/.dotfiles

Survey of `marcusrbrown/.dotfiles` (SHA `b5f5dee`). Created repo page `marcusrbrown--dotfiles.md`, topic pages `dotfiles.md` and `mise.md`. Updated `index.md` to catalog all three new pages.

Key findings:

- Bare git worktree dotfiles repo (GIT_DIR=~/.dotfiles, GIT_WORK_TREE=~/), created 2011, actively maintained
- Allowlist .gitignore pattern, modular shell init (bash init.d/ with numbered prefixes + zsh via sheldon)
- mise manages 30+ tools: Node 24, Python 3.14, Rust 1.95, Go 1.26, Zig 0.15, Deno 2.7, plus AI CLIs (Claude Code, OpenCode)
- Three parallel AI agent setups: Claude Code (.claude/), OpenCode (.config/opencode/ with own AGENTS.md), shared skills (.agents/)
- Zsh plugin management via sheldon with deferred loading (zsh-defer), starship prompt with Catppuccin Mocha
- Ghostty terminal (migrated from iTerm2) with Catppuccin Mocha, Nerd Font
- Devcontainer with 4 custom features (dotfiles-dev, mise, sheldon, keychain), image pushed to ghcr.io
- **Fro Bot workflow present** (fro-bot/agent@v0.40.2) — comprehensive PR review prompt + 6-category daily maintenance schedule including cross-project portfolio health monitoring
- Renovate extends marcusrbrown/renovate-config#4.5.8, Probot settings extend fro-bot/.github:common-settings.yaml
- macOS Brewfile: 100+ VS Code extensions, Nerd Fonts, Homebrew CLI tools, Mac App Store apps
- Created mise topic page — mise used in both .dotfiles (primary toolchain) and ha-config (pre-commit via aqua)

Sources: https://github.com/marcusrbrown/.dotfiles (SHA b5f5dee391bccd83e735b63c58ca9e416b72e702)
