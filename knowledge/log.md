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

## [2026-04-18 02:32] ingest | marcusrbrown/vbs

Survey of `marcusrbrown/vbs` (SHA `a552e73`). Created repo page `marcusrbrown--vbs.md`. Updated `index.md` to catalog the new page.

Key findings:

- Star Trek chronological viewing guide — local-first TypeScript + Vite + D3.js web app deployed to GitHub Pages
- Functional factory architecture: no classes, no `this`, closure-based state, generic EventEmitters
- Comprehensive module set: progress tracking, search/filter, timeline visualization, metadata from 4 external sources (TMDB, Memory Alpha, TrekCore, STAPI), streaming service integration, theme management
- ~43 test files via Vitest 4.x with coverage (Codecov), type-level tests
- Automated Star Trek data pipeline: weekly generation from multi-source aggregation with quality scoring, validation, and PR creation
- **Fro Bot integration: fully active** — three workflows: PR review (`fro-bot.yaml`), daily maintenance reporting, nightly autoheal (`fro-bot-autoheal.yaml`) with 5-category healing (errored PRs, security, code quality, DX, data quality)
- Shared config ecosystem: `@bfra.me/eslint-config`, `@bfra.me/prettier-config`, `@bfra.me/tsconfig`, `marcusrbrown/renovate-config#4.5.8`
- Probot settings extend `fro-bot/.github:common-settings.yaml` (same pattern as `ha-config`)
- CI: lint + type-check + test with coverage + build; branch protection requires Build, Test, Fro Bot, Renovate
- Copilot coding agent setup workflow present
- pnpm 10.33.0, Node.js 22.x, TypeScript 5.9.x strict mode

Sources: https://github.com/marcusrbrown/vbs (SHA a552e7335af70122f68380440c78a415a785749f)
