---
type: topic
title: ESPHome
created: 2026-04-18
updated: 2026-04-18
tags: [esphome, esp32, esp8266, iot, firmware, home-assistant]
related:
  - marcusrbrown--esphome-life
  - marcusrbrown--ha-config
  - home-assistant
---

# ESPHome

ESP32/ESP8266 firmware framework for creating custom IoT devices with YAML-based configuration. Integrates natively with [[home-assistant]].

## Repos Using ESPHome

- [[marcusrbrown--esphome-life]] — Marcus's ESPHome device configurations (Bluetooth proxies on Olimex ESP32-PoE-ISO)
- [[marcusrbrown--ha-config]] — Consumes esphome.life as a git submodule; lists `esphome==2025.12.7` in Python deps

## Key Concepts

### YAML-Based Configuration

ESPHome devices are defined entirely in YAML. Each device gets a top-level YAML file specifying the board, framework, components, and integrations. Shared configuration is extracted into reusable packages.

### Packages (Remote and Local)

ESPHome supports package imports from local files and remote GitHub URLs:

```yaml
packages:
  common: github://owner/repo/packages/shared.yaml@main
```

This pattern keeps per-device YAML minimal while centralizing shared configuration. Used extensively in [[marcusrbrown--esphome-life]].

### Supported Frameworks

- **Arduino** — Default framework for most boards
- **ESP-IDF** — Espressif's official SDK, preferred for advanced features (used in [[marcusrbrown--esphome-life]] for ESP32-PoE-ISO boards)

### Build Actions

`esphome/build-action` is the official GitHub Action for compiling ESPHome firmware in CI. It outputs versioned firmware artifacts with manifest files suitable for ESP Web Tools deployment.

### ESP Web Tools

[ESP Web Tools](https://esphome.github.io/esp-web-tools/) enables browser-based firmware flashing via Web Serial API. Combined with ESPHome's `manifest.json` output, this provides a zero-install OTA experience from a static website.

### Dashboard Import

ESPHome's `dashboard_import` feature allows devices to reference upstream firmware templates, enabling easy adoption of community-maintained configurations.

## ESPHome Project Template

The [esphome/esphome-project-template](https://github.com/esphome/esphome-project-template) provides a starting point for ESPHome projects with:

- GitHub Actions workflow for building firmware
- Static site with ESP Web Tools install button
- GitHub Pages deployment
- Jekyll-based landing page

[[marcusrbrown--esphome-life]] was generated from this template.

## Hardware Observed

| Board                | Framework | Connectivity       | Use Case        | Repo                           |
| -------------------- | --------- | ------------------ | --------------- | ------------------------------ |
| Olimex ESP32-PoE-ISO | ESP-IDF   | Ethernet (LAN8720) | Bluetooth proxy | [[marcusrbrown--esphome-life]] |

## Versioning

ESPHome uses CalVer (e.g., `2025.12.7`). The version tracked across Marcus's repos:

- `esphome.life` CI build: `2025.12.7`
- `esphome.life` dev container: `ptr727/esphome-nonroot:2025.12.7`
- `ha-config` Python deps: `esphome==2025.12.7`

All three are aligned at the same version, suggesting coordinated updates (likely via Renovate).
