---
type: topic
title: Home Assistant
created: 2025-06-18
updated: 2026-04-23
tags: [home-assistant, iot, smart-home, yaml, automation]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - github-actions-ci
---

# Home Assistant

Open-source home automation platform. Core references across the Fro Bot ecosystem.

## Repos Using Home Assistant

- [[marcusrbrown--ha-config]] — Marcus's primary HA configuration (public, CI-validated)
- [[marcusrbrown--esphome-life]] — ESPHome device firmware; linked from ha-config as a git submodule at `esphome/`

## Configuration Patterns Observed

### Package-based Organization

The preferred pattern splits configuration by domain into `packages/` directory files, each self-contained with entities, automations, and integrations for a single concern. Used in [[marcusrbrown--ha-config]].

### CI Validation

Home Assistant configs can be validated in CI using `frenck/action-home-assistant`, which runs the HA config check against a specific HA version pinned in `.HA_VERSION`. This catches YAML errors, missing integrations, and breaking changes before merge.

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
