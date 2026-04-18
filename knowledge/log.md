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

## [2026-04-18 06:25] ingest | marcusrbrown/esphome.life

Survey of `marcusrbrown/esphome.life` (SHA `e398c2e`). Updated repo page `marcusrbrown--esphome-life.md` with enriched device details, concurrency config, and cross-references. Created topic page `esphome.md`. Updated `home-assistant.md` and `marcusrbrown--ha-config.md` with wikilinks. Fixed ha-config related field slug.

Key findings:

- ESPHome device config repo, generated from `esphome/esphome-project-template`
- Two Olimex ESP32-PoE-ISO Bluetooth proxy devices (Ethernet-connected, not Wi-Fi)
- Shared package pattern via `github://` remote imports
- CI builds firmware with `esphome/build-action@v7.1.0`, ESPHome `2025.12.7`
- GitHub Pages site at `marcusrbrown.com/esphome.life` with ESP Web Tools for browser-based flashing
- Only one of two devices built in CI (second uses API encryption secret)
- Renovate extends `marcusrbrown/renovate-config#4.5.1`, post-upgrade runs Prettier
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Dev container uses `ptr727/esphome-nonroot:2025.12.7` with VS Code ESPHome extensions
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Fixed `marcusrbrown--ha-config.md` related field (was `marcusrbrown-esphome-life`, corrected to `marcusrbrown--esphome-life`)

Sources: https://github.com/marcusrbrown/esphome.life (SHA e398c2e1e3ef8c68717df26fd67a99b5c91410d7)
