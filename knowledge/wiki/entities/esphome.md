---
type: entity
title: ESPHome
created: 2026-04-23
updated: 2026-04-23
sources:
  - url: https://github.com/marcusrbrown/esphome.life
    sha: e398c2e1e3ef8c68717df26fd67a99b5c91410d7
    accessed: 2026-04-23
tags: [esphome, iot, esp32, firmware, home-assistant, bluetooth-proxy]
aliases: [esphome, esphome-life]
related:
  - marcusrbrown--esphome-life
  - home-assistant
---

# ESPHome

ESPHome is an open-source framework for configuring and building custom firmware for ESP32 and ESP8266 microcontrollers. It integrates directly with [[home-assistant]] via the native API protocol, providing real-time device control and telemetry.

## Key Characteristics

- **Declarative YAML configuration** — Devices are defined in YAML files that specify hardware, sensors, actuators, and network settings
- **CI/CD-friendly** — Firmware can be built in GitHub Actions using `esphome/build-action`, enabling automated testing and deployment
- **GitHub Pages deployment** — Built firmware can be published to a static site with ESP Web Tools for browser-based installation via USB
- **Package system** — Shared device definitions can be imported via `github://` URLs, enabling DRY configuration across multiple devices
- **ESP-IDF and Arduino frameworks** — Supports both ESP-IDF (preferred for Ethernet) and Arduino frameworks

## ESPHome in the Fro Bot Ecosystem

[[marcusrbrown--esphome-life]] uses ESPHome to configure Olimex ESP32-PoE-ISO boards as Bluetooth Proxies for [[home-assistant]]. Key patterns:

- **Package-based device configs** — Thin per-device YAML files pull shared configuration from `packages/` via `github://` imports
- **Ethernet-only devices** — All devices use wired Ethernet (LAN8720, ESP-IDF framework), no Wi-Fi — notable for Bluetooth Proxy reliability
- **CI build matrix** — Firmware builds triggered on push/PR via `esphome/build-action@v7.1.0` with ESPHome 2025.12.7
- **GitHub Pages distribution** — Jekyll site with ESP Web Tools install button, `manifest.json` generated from CI build artifacts
- **Devcontainer** — VS Code devcontainer using `ptr727/esphome-nonroot:2025.12.7` Docker image with ESPHome dashboard

## Version Pinning

ESPHome version is pinned across CI and devcontainer (currently 2025.12.7). The Renovate configuration tracks ESPHome across Docker images (`ptr727/esphome-nonroot`, `esphome/esphome`, `ghcr.io/esphome/esphome`) with loose versioning and semantic commit types.

## External Links

- [ESPHome Documentation](https://esphome.io/)
- [ESP Web Tools](https://esphome.github.io/esp-web-tools/)
- [esphome-project-template](https://github.com/esphome/esphome-project-template) — Template repository for ESPHome CI/CD
