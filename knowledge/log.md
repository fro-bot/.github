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

## [2026-04-18 00:00] ingest | marcusrbrown/mrbro.dev

Initial survey of `marcusrbrown/mrbro.dev` (SHA `51f5cab`). Created repo page `marcusrbrown--mrbro-dev.md` and topic page `github-pages.md`. Updated `index.md` to catalog both pages.

Key findings:

- Developer portfolio site: React 19, TypeScript (strict), Vite 7 (SWC), deployed to GitHub Pages at mrbro.dev
- Advanced theme system with 10+ presets, custom theme creator, JSON schema validation (Ajv), import/export
- GitHub API integration for dynamic blog and project showcase (no CMS)
- Comprehensive test infrastructure: Vitest (unit), Playwright (E2E, visual regression, accessibility), Lighthouse CI (performance)
- **Fro Bot workflow present and active** — `fro-bot.yaml` (PR review, daily maintenance) and `fro-bot-autoheal.yaml` (daily CI repair, security, code quality, production site review via agent-browser)
- Shares `@bfra.me/*` config ecosystem and `marcusrbrown/renovate-config` with [[marcusrbrown--ha-config]]
- Notable conventions: PascalCase hook files, no barrel exports, pure ESM, SWC over Babel, Shiki externalized in build
- Coverage below enforced 80% thresholds on statements (70.81%), functions (60.4%), lines (70.81%)
- Copilot coding agent configured with setup steps and pre-tool-use hooks

Sources: https://github.com/marcusrbrown/mrbro.dev (SHA 51f5cab5c77768b761d9f0a688ac7436cc5a06f4)
