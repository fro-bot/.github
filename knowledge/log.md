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

## [2026-04-18 12:00] ingest | marcusrbrown/vbs

Initial survey of `marcusrbrown/vbs` (SHA `a552e73`). Created repo page `marcusrbrown--vbs.md` and topic page `github-actions-ci.md`. Updated `index.md` to catalog both pages.

Key findings:

- Star Trek chronological viewing guide, TypeScript + Vite + D3.js, deployed to GitHub Pages
- Functional factory architecture: no classes, closure-based state, generic EventEmitters, strict TS
- Comprehensive metadata subsystem: 6 modules + 6 UI components sourcing from TMDB, Memory Alpha, TrekCore, STAPI
- Automated data generation pipeline with quality scoring, weekly via `update-star-trek-data.yaml`
- Functional composition utilities embedded: `pipe()`, `compose()`, `curry()`, `tap()`, async variants
- Generic storage adapters with `StorageAdapter<T>` interface; IndexedDB migration planned
- **Fro Bot agent workflow present and active** (`fro-bot.yaml` + `fro-bot-autoheal.yaml`)
  - PR review with VBS-specific convention checks (no `any`, no classes, `.js` extensions, `destroy()` methods)
  - Daily maintenance report (rolling issue, 14-day window)
  - Daily autoheal (5-category sweep: errored PRs, security, code quality, DX, data quality)
- CI: ESLint, type-check, Vitest coverage (Codecov), Vite build
- Renovate extends `marcusrbrown/renovate-config#4.5.8`, post-upgrade runs `pnpm install` + `pnpm fix`
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Created `github-actions-ci.md` topic page to capture cross-repo CI patterns (pin-by-SHA, shared setup actions, GitHub App tokens, Pages deployment)

Sources: https://github.com/marcusrbrown/vbs (SHA a552e7335af70122f68380440c78a415a785749f)
