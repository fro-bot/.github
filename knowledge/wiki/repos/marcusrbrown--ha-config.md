---
type: repo
title: "marcusrbrown/ha-config"
created: 2025-06-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/ha-config
    sha: 54a67275e00ed01a52f30399065d4fe6eaa4ee54
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/ha-config
    sha: 83784bc3a212c10cd358be4da9425e46aa6e90f0
    accessed: 2025-06-18
tags: [home-assistant, home-assistant-config, yaml, esphome, iot]
aliases: [ha-config]
related:
  - marcusrbrown-esphome-life
---

# marcusrbrown/ha-config

Marcus R. Brown's [[home-assistant]] configuration repository. Public, version-controlled Home Assistant setup with CI validation, custom components, and ESPHome device management via git submodule.

## Overview

- **Purpose:** Version-controlled Home Assistant configuration
- **Default branch:** `main`
- **Created:** 2023-07-25
- **Last push:** 2026-04-18
- **HA version tracked:** 2025.6.3 (pinned in `.HA_VERSION`)
- **Topics:** `home-assistant`, `home-assistant-config`

## Repository Structure

The config follows a **package-based** organization pattern. `configuration.yaml` is the entrypoint, pulling in domain-specific YAML files via Home Assistant's `!include` and `!include_dir_*` directives.

### Key Directories

| Directory | Purpose |
| --- | --- |
| `packages/` | Domain-scoped config bundles (alerts, bluetooth, doors, locks, network, presence, zones, zwave, etc.) |
| `automations/` | Feature-based automation groupings (alarm, homeassistant, LG WebOS TV, update notifications) |
| `scripts/` | HA script definitions |
| `scenes/` | Scene definitions |
| `templates/` | Jinja2 template sensors/entities |
| `custom_components/` | Third-party HACS and manual integrations |
| `frontend/` | Lovelace themes |
| `www/` | Static web assets for the frontend |
| `blueprints/` | HA automation blueprints |
| `include/` | Additional included config fragments |
| `docs/` | Documentation |

### Packages

The `packages/` directory contains domain-scoped configuration bundles:

- `alerts.yaml` — Alert definitions
- `bluetooth.yaml` — BLE configuration
- `doors.yaml` — Door sensor/automation packages
- `homeassistant.yaml` — Core HA settings
- `influxdb.yaml` — InfluxDB integration for metrics
- `locks.yaml` — Smart lock configuration
- `network.yaml` — Network monitoring
- `pi_hole.yaml` — Pi-hole integration
- `presence.yaml` — Presence detection
- `zones.yaml` — Geographic zone definitions
- `zwave.yaml` — Z-Wave device network

### Custom Components

Third-party integrations installed in `custom_components/`:

- `bermuda` — BLE trilateration for room-level presence
- `bhyve` — Orbit B-Hyve irrigation controller
- `ble_monitor` — Passive BLE device monitoring
- `browser_mod` — Browser-based frontend extensions
- `hacs` — Home Assistant Community Store
- `mail_and_packages` — USPS/UPS/FedEx package tracking
- `remote_homeassistant` — Multi-instance HA linking
- `sengledng` — Sengled smart lighting (next-gen integration)
- `solaredge_modbus_multi` — SolarEdge inverter via Modbus
- `toyota_na` — Toyota North America connected services

### Git Submodule

- `esphome` → [marcusrbrown/esphome.life](https://github.com/marcusrbrown/esphome.life) — ESPHome device configurations

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main`, dispatch | Lint + config validation |
| Renovate | `renovate.yaml` | issue/PR edit, push, dispatch, CI completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync |

### CI Jobs (ci.yaml)

The CI pipeline runs four sequential/parallel jobs:

1. **YAML Lint** — `frenck/action-yamllint` validates YAML syntax
2. **Remark Lint** — Markdown linting via `pipelinecomponents/remark-lint` (continue-on-error)
3. **Prettier** — Format check using Prettier 3.8.2 (diff-only on PRs)
4. **Check Home Assistant Config** — Runs `frenck/action-home-assistant@v1.4.1` against the HA version in `.HA_VERSION` (depends on lint jobs)

### Pinned Action Versions (as of 2026-04-18)

| Action                         | Version | SHA        |
| ------------------------------ | ------- | ---------- |
| `actions/checkout`             | v6.0.2  | `de0fac2e` |
| `frenck/action-yamllint`       | v1.5.0  | `34b4bbca` |
| `frenck/action-home-assistant` | v1.4.1  | `941d5d91` |
| `creyD/prettier_action`        | v4.3    | `31355f8e` |
| `bfra-me/.github` (reusable)   | v4.16.6 | `9465f883` |

Prettier version in CI: **3.8.3** (previously 3.8.2)

### Branch Protection

Required status checks on `main`: YAML Lint, Remark Lint, Prettier, Check Home Assistant Config, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github` (v4.16.6). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8` (previously 4.5.7). Custom managers for `.pre-commit-config.yaml` (Python version + pip packages) and `mise.toml` (pre-commit via aqua). Git submodules enabled. Post-upgrade runs Prettier 3.8.3. Automerge on minor/patch pip updates. ESPHome updates grouped (no separate major/minor/patch splits).
- **Pre-commit:** Managed via `mise` (aqua, v4.5.1). Hooks via `pre-commit/pre-commit-hooks@v6.0.0`: trailing whitespace, EOF fixer, double-quote string fixer, requirements-txt fixer, large file check, merge conflict check, TOML/YAML validation. Excludes `custom_components/`, `www/`, `.HA_VERSION`.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` for repository configuration sync.
- **AI Rules:** `.cursorrules` defines HA-specific development conventions (YAML standards, package organization, security, testing).
- **Python deps:** `esphome==2025.12.7`, `yamllint==1.38.0` (in `requirements.txt`).
- **mise.toml:** Manages `pre-commit` tool version via aqua.

## Fro Bot Integration

**No Fro Bot workflow detected.** The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage.

The repo does reference `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem.

## Notable Patterns

- **Package-based architecture:** Domain concerns are isolated into `packages/` YAML files rather than a monolithic config. This is the recommended HA pattern for complex setups.
- **IoT diversity:** The config spans Z-Wave, BLE (Bermuda trilateration), ESPHome, solar (SolarEdge Modbus), irrigation (B-Hyve), and connected vehicles (Toyota NA).
- **InfluxDB metrics:** Long-term data retention via InfluxDB, separate from the default HA recorder.
- **Multi-instance HA:** `remote_homeassistant` component suggests a multi-node HA deployment.
- **ESPHome as submodule:** Device configs live in a separate repo (`esphome.life`), linked via git submodule rather than copied.
