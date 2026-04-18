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

## [2026-04-18 06:22] ingest | marcusrbrown/infra

Survey of `marcusrbrown/infra` (SHA `3fae5db`). Created repo page `marcusrbrown--infra.md` and topic page `github-actions-ci.md`. Updated `index.md` to catalog both pages.

Key findings:

- Bun workspace monorepo (apps/keeweb, apps/cliproxy, packages/cli)
- KeeWeb v1.18.7 self-hosted password manager deployed to `kw.igg.ms` via SSH/rsync
- CLIProxyAPI at `cliproxy.fro.bot` — Claude proxy that powers Fro Bot agent runs across repos
- Published CLI `@marcusrbrown/infra` (v0.4.3) on npm with goke framework and MCP bridge
- 9 GitHub Actions workflows: CI (lint/type-check/test), Deploy (path-filtered), Release (Changesets), Fro Bot (v0.40.2), Renovate, Renovate Changesets, Copilot Setup, Scorecard, Settings Sync
- **Fro Bot agent workflow present** with structured PR review format and 7-category daily autohealing
- Shares `@bfra.me/*` config ecosystem, Renovate preset, and Probot settings pattern with `marcusrbrown/ha-config`
- Node 24 pin required in CI due to ESLint shebang + ES2024 API gap on ubuntu-latest
- Compound learning docs in `docs/solutions/` with YAML frontmatter
- Changesets for versioning, `@svitejs/changesets-changelog-github-compact` for changelogs
- Docker-based CLIProxyAPI uses `eceasy/cli-proxy-api` image with Caddy reverse proxy on DigitalOcean

Sources: https://github.com/marcusrbrown/infra (SHA 3fae5db4f57cce6a662da29c50ca9bbe37fdda2a)

> > > > > > > e4cf67a (knowledge: ingest marcusrbrown/infra survey)
