---
type: topic
title: Home Assistant
created: 2025-06-18
updated: 2026-06-20
tags: [home-assistant, iot, smart-home, yaml, automation, addon]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - bfra-me--ha-addon-repository
  - github-actions-ci
---

# Home Assistant

Open-source home automation platform. Core references across the Fro Bot ecosystem.

## Repos Using Home Assistant

- [[marcusrbrown--ha-config]] — Marcus's primary HA configuration (public, CI-validated)
- [[marcusrbrown--esphome-life]] — ESPHome device firmware; linked from ha-config as a git submodule at `esphome/`
- [[bfra-me--ha-addon-repository]] — Template repo for building & publishing HA add-ons (bfra-me org), multi-arch Docker images via `home-assistant/builder`

## Configuration Patterns Observed

### Package-based Organization

The preferred pattern splits configuration by domain into `packages/` directory files, each self-contained with entities, automations, and integrations for a single concern. Used in [[marcusrbrown--ha-config]].

### CI Validation

Home Assistant configs can be validated in CI using `frenck/action-home-assistant`, which runs the HA config check against a specific HA version pinned in `.HA_VERSION`. This catches YAML errors, missing integrations, and breaking changes before merge.

**Pin-drift footgun:** validating against a frozen `.HA_VERSION` only catches problems that exist in *that* version. Observed in [[marcusrbrown--ha-config]], where `.HA_VERSION` has remained at `2025.6.3` across five surveys (2025-06 → 2026-06, ~12 months) while pip-resolved deps like `esphome` advance. The CI passes, but the config is not validated against current upstream HA. The Renovate PR bumping `esphome` to v2026 (#777) has also been parked for weeks — the autopilot merges everything except the updates that would close this drift.

The add-on side uses a different tool: `frenck/action-addon-linter` validates the add-on contract (`config.yaml`, `build.yaml`, image references, arch lists, schema). Observed in [[bfra-me--ha-addon-repository]]. The two `frenck/*` actions are sibling validators serving the two sides of the HA development workflow.

### Multi-Arch Add-on Builds

Add-ons publish multi-arch Docker images via `home-assistant/builder` (pinned at `2026.03.2` in [[bfra-me--ha-addon-repository]]). Standard arch matrix: `aarch64`, `amd64`, `armhf`, `armv7`. Base images from `ghcr.io/home-assistant/{arch}-base` split between Alpine 3.23 (64-bit) and 3.22 (32-bit ARM) — upstream lags on 32-bit. The build action supports `--cosign` for Sigstore signing when `id-token: write` is granted. As of 2026-06-20, upstream has moved the 64-bit base to Alpine **3.24** (open but unmerged Renovate PR #558 in [[bfra-me--ha-addon-repository]]), so the live `main` still reflects 3.23/3.22 — the 64-bit/32-bit lag persists across the minor bump.

### Custom Components

Third-party integrations installed via HACS or manually into `custom_components/`. These are typically excluded from linting and pre-commit hooks since they are upstream-managed code.

### ESPHome Integration

ESPHome device configurations are commonly managed as a separate repository and linked via git submodule, keeping device firmware definitions decoupled from the HA config.

## Related Technologies

- **[ESPHome](esphome)** — ESP32/ESP8266 firmware framework, integrated with HA
- **Z-Wave** — Mesh networking protocol for IoT devices
- **HACS** — Home Assistant Community Store for third-party integrations
- **InfluxDB** — Time-series database for long-term HA metrics retention
- **Lovelace** — HA's frontend dashboard framework
