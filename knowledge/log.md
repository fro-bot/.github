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

## [2026-04-18 00:00] ingest | marcusrbrown/extend-vscode

Initial survey of `marcusrbrown/extend-vscode` (SHA `a4dcbbb`). Created repo page `marcusrbrown--extend-vscode.md` and topic page `vscode-extensions.md`. Updated `index.md` to catalog both pages.

Key findings:

- VS Code extension toolkit, modular architecture with central `ExtensionController`
- TypeScript, MIT, pnpm 10.33.0, tsup build, dual Node/Web extension targets
- Feature modules: commands, webviews, tree views, status bar, tasks, telemetry, logging, configuration
- Generated types from package.json via `vscode-ext-gen`
- Vitest unit + web tests, `@vscode/test-electron` integration, Playwright visual regression
- Semantic-release publishing to VS Code Marketplace, OpenVSIX, and npm
- Emergency rollback workflow with per-platform support
- Extends `@bfra.me/eslint-config` and `@bfra.me/tsconfig`
- Renovate extends `marcusrbrown/renovate-config#4.5.0` + `sanity-io/renovate-config`
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- AI context: `llms.txt`, `.github/copilot-instructions.md`, `.ai/`, `.cursor/` directories
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Version 0.1.0 (pre-release), created 2020-11-16, last push 2026-04-17

Sources: https://github.com/marcusrbrown/extend-vscode (SHA a4dcbbb175828a60855053d778fd21903a3d73d6)
