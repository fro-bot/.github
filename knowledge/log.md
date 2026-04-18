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
