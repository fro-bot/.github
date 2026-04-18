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

## [2026-04-18 00:00] ingest | marcusrbrown/containers

Survey of `marcusrbrown/containers` (SHA `e582f85`). Created repo page `marcusrbrown--containers.md` and topic page `docker-containers.md`. Updated `index.md` to catalog both pages.

Key findings:

- Container ecosystem repo, public, MIT-licensed, Python primary language
- Active containers: Node.js Alpine (~70MB) and Debian Bookworm release (~160MB) variants; archived Ethereum Parity client
- Python automation framework (15 modules): Dockerfile generation, metrics collection, image tagging, template engine, AI-powered tooling (OpenAI + Anthropic)
- Template system with 5 categories (apps, base, databases, infrastructure, microservices) and Jinja2 rendering
- Multi-arch builds (amd64 + arm64) via Buildx + QEMU, publishing to both GHCR and Docker Hub
- 10 GitHub Actions workflows including build-publish, container-scan (Trivy), test (pre-commit + pytest + Hadolint + Black/isort), Fro Bot agent
- **Fro Bot workflow present** (`fro-bot.yaml`, agent v0.40.0) — PR review with structured verdict, daily autohealing (14:30 UTC) with perpetual issue pattern, mention-triggered responses
- Probot settings extend `fro-bot/.github:common-settings.yaml`; Renovate extends `marcusrbrown/renovate-config#4.5.0`
- Tooling: mise (Node 24.15.0, pnpm 10.33.0, Python 3.13, Poetry), dual ecosystem (Poetry for Python, pnpm for Prettier)
- OCI Image Spec annotation compliance; deprecated `org.label-schema.*` labels removed

Sources: https://github.com/marcusrbrown/containers (SHA e582f856844ac1dd52fc8739f1a9aa8398248e6e)
