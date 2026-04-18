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

## [2025-06-18 01:00] ingest | marcusrbrown/.github

Survey of `marcusrbrown/.github` (SHA `be01029`). Created repo page `marcusrbrown--github.md` and topic page `probot-settings.md`. Updated `index.md` to catalog both pages.

Key findings:

- Personal `.github` repo providing GitHub defaults and community health files for `marcusrbrown` repositories
- Contains canonical `common-settings.yaml` — the Probot Settings template extended by other Marcus repos
- Settings divergence documented: personal template (no PR reviews, Marcus admin) vs. fro-bot org template (1 reviewer required, fro-bot admin)
- CI pipeline: Prettier-only — appropriate for a YAML/Markdown repo with no application code
- Renovate extends `marcusrbrown/renovate-config#4.5.1`, post-upgrade runs Prettier 3.8.1
- Shared workflows from `bfra-me/.github@v4.4.0` for Renovate and settings sync
- Community health files: Contributor Covenant v1.4, MIT license, GitHub Sponsors
- `fro-bot` listed as collaborator (push) confirming Fro Bot write access
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Updated `marcusrbrown--ha-config` cross-reference context: ha-config extends `fro-bot/.github` settings, not `marcusrbrown/.github`

Sources: https://github.com/marcusrbrown/.github (SHA be01029971bc8b50fbd2b660fadc7341da26e03c)

## [2026-04-18 00:00] ingest | marcusrbrown/marcusrbrown

Survey of `marcusrbrown/marcusrbrown` (SHA `af78e68`). Created repo page `marcusrbrown--marcusrbrown.md` and topic page `github-actions-ci.md`. Updated `index.md` to catalog both pages.

Key findings:

- GitHub profile README repo, public, TypeScript-powered with template-driven content generation
- Automated profile updates every 6 hours via `muesli/readme-scribe` and custom TypeScript scripts
- Sponsor tracking pipeline: GitHub GraphQL API fetch, template rendering, auto-PR via `peter-evans/create-pull-request`
- Badge automation: `@bfra.me/badge-config`, technology detection, shields.io client, caching layer
- A/B testing framework for sponsor conversion content (`templates/variants/`)
- Content analytics and mobile responsiveness testing scripts
- CI: markdownlint + tsc + eslint via `main.yaml`; profile generation via `update-profile.yaml`
- Dev tooling: pnpm 10.31.0, Node 24.14.0 (mise), Vitest 4.0.18, `@bfra.me/*` shared configs
- Renovate extends `marcusrbrown/renovate-config#4.5.1`, post-upgrade runs bootstrap + fix
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Automated commits by `mrbro-bot[bot]` (app 137683033), not Fro Bot
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Cross-cutting GitHub Actions patterns extracted to new topic page `github-actions-ci.md`

Sources: https://github.com/marcusrbrown/marcusrbrown (SHA af78e68d510b24152531f7fdafe9bff35a58f071)

## [2026-04-18 06:00] ingest | marcusrbrown/.dotfiles

Survey of `marcusrbrown/.dotfiles` (SHA `2f2d1e6`). Created repo page `marcusrbrown--dotfiles.md`, topic page `dotfiles.md`, and entity page `mise.md`. Updated `index.md` to catalog all three pages.

Key findings:

- Bare git repo pattern (`GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=$HOME`) with allowlist .gitignore
- Supports Bash and Zsh, fully XDG-compliant configuration under `~/.config/`
- Sheldon zsh plugin manager with deferred loading and znap eval caching for fast startup
- Starship prompt with Catppuccin Mocha palette
- mise manages 20+ tools: Node 24.15.0, Python 3.14.4, Rust 1.95.0, Go 1.26.2, Bun, Deno, Zig, TypeScript 6.0.2, plus CLI tools (Claude Code, OpenCode, ast-grep, Biome, Playwright)
- Published devcontainer image at `ghcr.io/marcusrbrown/dotfiles-devcontainer:latest` with 4 custom features (dotfiles-dev, mise, sheldon, keychain)
- **Fro Bot workflow present** (`fro-bot.yaml`, agent v0.40.2) — PR review, daily maintenance (6-category schedule prompt), and cross-project health monitoring
- Multi-agent AI setup: Claude Code (`.claude/`), OpenCode (`.config/opencode/`), root AGENTS.md
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Renovate extends `marcusrbrown/renovate-config#4.5.8` with custom mise version manager
- Privacy-focused: telemetry disabled for Homebrew, PlatformIO, vibe-tools
- GPG signing on commits, fast-forward only merges, auto-prune on fetch
- Comprehensive Brewfile: 40+ brew packages, 15+ casks, 13 Mac App Store apps, 90+ VS Code extensions

Cross-references established: dotfiles shares mise tooling, Renovate config patterns, and Probot settings with ha-config. Entity page for mise created to track cross-repo usage.

Sources: https://github.com/marcusrbrown/.dotfiles (SHA 2f2d1e6ac04999c5e61ee054fc585d9542cd3a74)
