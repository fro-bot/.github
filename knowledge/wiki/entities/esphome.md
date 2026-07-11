---
type: entity
title: ESPHome
created: 2026-04-23
updated: 2026-06-29
sources:
  - url: https://github.com/marcusrbrown/esphome.life
    sha: e398c2e1e3ef8c68717df26fd67a99b5c91410d7
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/esphome.life
    sha: fc5adc212a7a1556bdaa9a1b30d3cf8a9e8cc584
    accessed: 2026-05-26
  - url: https://github.com/marcusrbrown/esphome.life
    sha: bd5aa8885780aebdacefc9714a5f4d6b344158c9
    accessed: 2026-06-07
  - url: https://github.com/marcusrbrown/esphome.life
    sha: ce8df7225573e4a38b1992b05bb81cb869406e89
    accessed: 2026-06-18
  - url: https://github.com/marcusrbrown/esphome.life
    sha: 9e1618fb6fd30e0fb00e1548188bbd7a5a5aeda4
    accessed: 2026-06-29
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
- **CI build matrix** — Firmware builds triggered on push/PR via `esphome/build-action@v7.3.0` with ESPHome 2025.12.7 (as of 2026-06-07; bumped from v7.2.0 on 2026-05-26)
- **GitHub Pages distribution** — Jekyll site with ESP Web Tools install button, `manifest.json` generated from CI build artifacts
- **Devcontainer** — VS Code devcontainer using `ptr727/esphome-nonroot:2025.12.7` Docker image with ESPHome dashboard

## Version Pinning

ESPHome version is pinned across CI and devcontainer (currently 2025.12.7, unchanged across seven surveys spanning 2026-04 → 2026-06-29). The Renovate configuration tracks ESPHome across Docker images (`ptr727/esphome-nonroot`, `esphome/esphome`, `ghcr.io/esphome/esphome`) with loose versioning and semantic commit types — but no major/minor bumps have arrived since at least early March 2026, which is a remarkably quiet stretch for an actively-developed framework. Renovate keeps the surrounding dependency stack (`bfra-me/.github`, preset, Prettier) current weekly, yet the ESPHome pin never moves — strong evidence the loose versioning + `separateMajorMinor: false` config is suppressing the 2026.x bumps rather than Renovate simply not running. The upstream ESPHome project has continued releasing (2026.x series).

## External Links

- [ESPHome Documentation](https://esphome.io/)
- [ESP Web Tools](https://esphome.github.io/esp-web-tools/)
- [esphome-project-template](https://github.com/esphome/esphome-project-template) — Template repository for ESPHome CI/CD
