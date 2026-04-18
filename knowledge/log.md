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

## [2026-04-18 00:00] ingest | marcusrbrown/esphome.life

Survey of `marcusrbrown/esphome.life` (SHA `e398c2e`). Created repo page `marcusrbrown--esphome-life.md`. Updated topic page `home-assistant.md` with esphome.life cross-references. Fixed wikilink slug in `marcusrbrown--ha-config.md` related field (`marcusrbrown-esphome-life` → `marcusrbrown--esphome-life`). Updated `index.md`.

Key findings:

- ESPHome project derived from `esphome/esphome-project-template`, builds firmware for Olimex ESP32-PoE-ISO Bluetooth Proxy devices
- Two per-device configs (`13451c`, `1349f4`), one shared package (`packages/olimex-bluetooth-proxy.yaml`)
- Only `1349f4` is in the CI build matrix; `13451c` is not built by CI
- CI deploys to GitHub Pages with ESP Web Tools for browser-based firmware installation
- ESPHome version pinned at 2025.12.7 in both CI and devcontainer
- Devcontainer uses `ptr727/esphome-nonroot` image with ESPHome dashboard, PlatformIO, and serial monitor extensions
- Renovate extends `marcusrbrown/renovate-config#4.5.1` with ESPHome-specific package rules (loose versioning, semantic commits)
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- All devices use Ethernet (LAN8720) — no Wi-Fi — for wired Bluetooth Proxy backhaul
- Template artifacts (`docs/readme.md`, `static/index.md`) remain uncustomized

Sources: https://github.com/marcusrbrown/esphome.life (SHA e398c2e1e3ef8c68717df26fd67a99b5c91410d7)
