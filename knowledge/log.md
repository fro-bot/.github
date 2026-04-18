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

Survey of `marcusrbrown/containers` (SHA `e582f85`). Created repo page `marcusrbrown--containers.md`. Created topic pages `docker-containers.md` and `github-actions-ci.md`. Updated `index.md` to catalog all three new pages.

Key findings:

- Container collection repo, public, oldest in Marcus's portfolio (created 2016-12-19), actively maintained
- Two active Node.js container variants: Alpine (~70 MB) and Bookworm-slim (~160 MB), both Node 24, multi-arch (amd64+arm64)
- Archived Ethereum Parity containers excluded from all CI pipelines
- Python automation layer (Poetry, Python 3.13): Dockerfile generation, metrics collection, image tagging, AI-powered template intelligence (OpenAI + Anthropic)
- Template system covering Alpine base, Express.js, FastAPI, PostgreSQL, Nginx, Go microservices
- Comprehensive CI: multi-arch builds via Buildx+QEMU, Trivy security scanning, Hadolint, Black/isort/pylint, pre-commit, Prettier
- Publishes to GHCR and Docker Hub (legacy `igetgames` alias in settings homepage)
- All GitHub Actions and base images SHA/digest-pinned; OCI label convention with clear CI-injected vs static split
- **Fro Bot workflow present** (`fro-bot.yaml`, `fro-bot/agent@v0.40.0`) — PR review with container-specific prompts, daily autohealing schedule at 14:30 UTC
- Renovate extends `marcusrbrown/renovate-config#4.5.0`, Probot settings extend `fro-bot/.github:common-settings.yaml`
- Shared `@bfra.me/*` config heritage with `ha-config` repo — new `github-actions-ci` topic page cross-references both

Sources: https://github.com/marcusrbrown/containers (SHA e582f856844ac1dd52fc8739f1a9aa8398248e6e)
