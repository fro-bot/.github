---
type: repo
title: "marcusrbrown/ha-config"
created: 2025-06-18
updated: 2026-04-25
sources:
  - url: https://github.com/marcusrbrown/ha-config
    sha: 83784bc3a212c10cd358be4da9425e46aa6e90f0
    accessed: 2025-06-18
  - url: https://github.com/marcusrbrown/ha-config
    sha: 54a67275e00ed01a52f30399065d4fe6eaa4ee54
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/ha-config
    sha: f7ec8038cca071e36848057d00d1c165cef5f357
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/ha-config
    sha: f7ec8038cca071e36848057d00d1c165cef5f357
    accessed: 2026-04-25
tags: [home-assistant, home-assistant-config, yaml, esphome, iot]
aliases: [ha-config]
related:
  - marcusrbrown--esphome-life
  - marcusrbrown--marcusrbrown
  - github-actions-ci
  - home-assistant
  - esphome
---

# marcusrbrown/ha-config

Marcus R. Brown's [[home-assistant]] configuration repository. Public, version-controlled Home Assistant setup with CI validation, custom components, and ESPHome device management via git submodule.

## Overview

- **Purpose:** Version-controlled Home Assistant configuration
- **Default branch:** `main`
- **Created:** 2023-07-25
- **Last push:** 2026-04-23 (branch push; last main commit 2026-04-22)
- **HA version tracked:** 2025.6.3 (pinned in `.HA_VERSION`)
- **Topics:** `home-assistant`, `home-assistant-config`
- **Open issues:** 1 (#427 — Dependency Dashboard)
- **Open PRs:** 0

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

- `esphome` → [marcusrbrown/esphome.life](https://github.com/marcusrbrown/esphome.life) — [[esphome]] device configurations

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main`, dispatch | Lint + config validation |
| Renovate | `renovate.yaml` | issue/PR edit, push to non-main, dispatch, CI completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily 03:00 UTC, dispatch | Probot settings sync |

### CI Jobs (ci.yaml)

The CI pipeline runs four sequential/parallel jobs:

1. **YAML Lint** — `frenck/action-yamllint@v1.5.0` validates YAML syntax
2. **Remark Lint** — Markdown linting via `pipelinecomponents/remark-lint` (continue-on-error)
3. **Prettier** — Format check using Prettier 3.8.3 (diff-only on PRs via `creyD/prettier_action@v4.3`)
4. **Check Home Assistant Config** — Runs `frenck/action-home-assistant@v1.4.1` against the HA version in `.HA_VERSION` (depends on lint jobs)

### Branch Protection

Required status checks on `main`: YAML Lint, Remark Lint, Prettier, Check Home Assistant Config, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github` (v4.16.8, SHA `bedac8bd7b81a7832ae494873da2971e5ea7a8d4`). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

### Renovate Trigger Model

The Renovate workflow uses a multi-trigger pattern:

- `issues: [edited]` and `pull_request: [edited]` — re-run when Renovate edits its own issues/PRs
- `push` to non-main branches — re-run on branch updates
- `workflow_dispatch` — manual trigger with configurable log level and print-config options
- `workflow_run` on CI completion — triggers Renovate after successful CI on main

This is the same event-driven Renovate pattern used in [[marcusrbrown--github]] and other Marcus repos, replacing the hourly cron schedule.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8`. Custom managers for `.pre-commit-config.yaml` (Python version + pip packages) and `mise.toml` (pre-commit via aqua). Git submodules enabled. Post-upgrade runs `npx prettier@3.8.3 --no-color --write .`. Automerge on minor/patch pip updates. ESPHome version updates are unseparated (major+minor+patch treated as a single update).
- **Pre-commit:** Managed via `mise` (aqua, v4.6.0). Hooks: trailing whitespace, EOF fixer, double-quote string fixer, requirements-txt fixer, large file check, merge conflict check, TOML/YAML validation. Excludes `custom_components/`, `www/`, `.HA_VERSION`. Uses `--unsafe` YAML check to allow HA YAML extensions (`!include`, `!secret`, etc.).
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` for repository configuration sync.
- **AI Rules:** `.cursorrules` defines HA-specific development conventions (YAML standards, package organization, security, testing).
- **Python deps:** `esphome==2025.12.7`, `yamllint==1.38.0` (in `requirements.txt`).
- **mise.toml:** Manages `pre-commit` tool version via aqua (`aqua:pre-commit/pre-commit = "4.6.0"`).

## Fro Bot Integration

**No Fro Bot workflow detected.** The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage.

The repo does reference `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem.

## Notable Patterns

- **Package-based architecture:** Domain concerns are isolated into `packages/` YAML files rather than a monolithic config. This is the recommended HA pattern for complex setups.
- **IoT diversity:** The config spans Z-Wave, BLE (Bermuda trilateration), ESPHome, solar (SolarEdge Modbus), irrigation (B-Hyve), and connected vehicles (Toyota NA).
- **InfluxDB metrics:** Long-term data retention via InfluxDB, separate from the default HA recorder.
- **Multi-instance HA:** `remote_homeassistant` component suggests a multi-node HA deployment.
- **ESPHome as submodule:** Device configs live in a separate repo (`esphome.life`), linked via git submodule rather than copied.
- **Exclusively Renovate-driven activity:** All recent commits (20+ consecutive) are Renovate dependency bumps — no structural or config changes since the initial survey.

## Survey History

| Date | SHA | Key Changes |
| --- | --- | --- |
| 2025-06-18 | `83784bc` | Initial survey — 11 packages, 10 custom components, Prettier 3.8.2, Renovate `#4.5.7`, pre-commit 4.5.1 |
| 2026-04-18 | `54a6727` | Prettier 3.8.3, Renovate `#4.5.8`, bfra-me/.github v4.16.6, pre-commit-hooks v6.0.0 |
| 2026-04-24 | `f7ec803` | pre-commit 4.6.0, bfra-me/.github v4.16.8, Renovate trigger model expanded (workflow_run, push to non-main) |
| 2026-04-25 | `f7ec803` | No change — SHA identical to prior survey. 0 open PRs, 1 open issue (#427). All configs confirmed stable. |
