---
type: repo
title: "marcusrbrown/esphome.life"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/esphome.life
    sha: e398c2e1e3ef8c68717df26fd67a99b5c91410d7
    accessed: 2026-04-18
tags: [esphome, iot, esp32, bluetooth-proxy, home-assistant, firmware, github-pages]
aliases: [esphome-life, esphome.life]
related:
  - marcusrbrown--ha-config
  - esphome
  - home-assistant
---

# marcusrbrown/esphome.life

Marcus R. Brown's [[esphome]] device configuration repository. Manages ESP32-based Bluetooth proxy firmware with CI builds and a GitHub Pages site for OTA installation via ESP Web Tools.

## Overview

- **Purpose:** ESPHome device firmware definitions, CI-built and deployed to GitHub Pages
- **Default branch:** `main`
- **Created:** 2022-11-09
- **Last push:** 2026-03-12
- **Visibility:** Public
- **License:** None specified
- **Topics:** _(none set)_
- **ESPHome version:** 2025.12.7 (pinned in CI workflow and devcontainer)
- **Template origin:** Generated from [esphome/esphome-project-template](https://github.com/esphome/esphome-project-template)
- **GitHub Pages:** Active at [marcusrbrown.com/esphome.life](https://marcusrbrown.com/esphome.life/) (custom domain, HTTPS enforced, cert expires 2026-06-04)
- **Linked from:** [[marcusrbrown--ha-config]] as a git submodule at `esphome/`

## Repository Structure

| Path                                   | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `olimex-bluetooth-proxy-1349f4.yaml`   | Device config for Olimex ESP32-PoE-ISO unit (1349f4), CI-built     |
| `olimex-bluetooth-proxy-13451c.yaml`   | Device config for Olimex ESP32-PoE-ISO unit (13451c), not CI-built |
| `packages/olimex-bluetooth-proxy.yaml` | Shared ESPHome package with common BLE proxy config                |
| `static/`                              | GitHub Pages site content (Jekyll theme: slate)                    |
| `static/index.md`                      | Landing page with ESP Web Tools install button                     |
| `static/_config.yml`                   | Jekyll config (title: "ESPHome Life")                              |
| `docs/readme.md`                       | Template README from esphome-project-template                      |
| `.cache/`                              | Local cache directory (git-tracked placeholder, contents ignored)  |
| `.devcontainer.json`                   | Dev container using `ptr727/esphome-nonroot:2025.12.7`             |

## Devices

### Olimex ESP32-PoE-ISO Bluetooth Proxies

Two physical Olimex ESP32-PoE-ISO boards configured as ESPHome Bluetooth proxies:

| Device                          | Config file                          | CI-built | API encryption |
| ------------------------------- | ------------------------------------ | -------- | -------------- |
| `olimex-bluetooth-proxy-1349f4` | `olimex-bluetooth-proxy-1349f4.yaml` | Yes      | No             |
| `olimex-bluetooth-proxy-13451c` | `olimex-bluetooth-proxy-13451c.yaml` | No       | Yes (secret)   |

Both devices import the shared package via `github://marcusrbrown/esphome.life/packages/olimex-bluetooth-proxy.yaml@main`. The `13451c` unit additionally configures a friendly name ("Bluetooth Proxy 13451c").

### Shared Package (`packages/olimex-bluetooth-proxy.yaml`)

- **Board:** `esp32-poe-iso`
- **Framework:** ESP-IDF
- **Connectivity:** Ethernet (LAN8720: MDC GPIO23, MDIO GPIO18, CLK GPIO17_OUT, PHY addr 0, power GPIO12) — not Wi-Fi
- **BLE:** Active scanning (1100ms interval/window), active Bluetooth proxy
- **Min ESPHome version:** 2024.6.0
- **Project name:** `esphome.bluetooth-proxy` v1.0
- **Features:** API, logger, OTA (esphome platform), safe mode button
- **Dashboard import:** References upstream `esphome/firmware` Olimex PoE ISO template

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main`, dispatch | Build firmware + deploy to GitHub Pages |
| Renovate | `renovate.yaml` | issue/PR edit, push (non-main), dispatch, CI completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync |

### CI Pipeline (`ci.yaml`)

The CI workflow has four jobs:

1. **Prepare** — Extracts the list of config files to build (currently only `olimex-bluetooth-proxy-1349f4.yaml`)
2. **Build firmware** — Uses `esphome/build-action@v7.1.0` with ESPHome `2025.12.7` to compile firmware
3. **Build** — Gate job (depends on firmware build)
4. **Publish** — Downloads artifacts, generates `manifest.json`, copies static site content, deploys to `gh-pages` branch via `JamesIves/github-pages-deploy-action@v4.8.0`

Deployment uses a GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Git commits to `gh-pages` are authored as `mrbro-bot[bot]`.

Note: Only `olimex-bluetooth-proxy-1349f4.yaml` is built in CI. The `13451c` device is excluded (likely because it uses API encryption with a secret not available in CI, or it is a secondary/offline device).

### Concurrency

CI workflow uses concurrency group `${{ github.workflow }}-${{ github.event.number || github.ref }}` with cancel-in-progress on non-main branches.

### Branch Protection

Required status checks on `main`: `Prepare`, `Build`, `Publish`, `Renovate / Renovate`. Strict status checks enabled. Linear history enforced. Admin enforcement enabled. No required PR reviews.

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` reference the same reusable workflow (`bfra-me/.github/.github/workflows/renovate.yaml@v4.4.0`). Authentication via GitHub App secrets. Note: `update-repo-settings.yaml` reuses the Renovate workflow rather than a dedicated settings workflow — this appears intentional as the settings sync is likely handled as part of the Renovate pipeline.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.1`. Custom package rules for ESPHome Docker images and GitHub releases (loose versioning, combined major/minor/patch). Post-upgrade runs Prettier 3.8.1.
- **Dev Container:** Uses `ptr727/esphome-nonroot:2025.12.7` image. Timezone: `America/Phoenix`. Forwards port 6052 (ESPHome native API). Includes VS Code extensions for ESPHome, YAML, Python, PlatformIO, serial monitor, markdownlint, editorconfig, spell checker.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (same pattern as [[marcusrbrown--ha-config]]).
- **Prettier:** 120-char line width, single quotes.
- **EditorConfig:** UTF-8, LF line endings, 2-space indentation, 120-char max line length.

## ESP Web Tools Site

The repository deploys a static site to GitHub Pages (`gh-pages` branch) using the Jekyll `slate` theme. The site provides an ESP Web Tools install button that reads `manifest.json` (generated by CI from ESPHome build artifacts) to flash firmware directly from the browser via USB.

- **URL:** [marcusrbrown.com/esphome.life](https://marcusrbrown.com/esphome.life/)
- **Custom domain:** `marcusrbrown.com` (HTTPS enforced, certificate approved)
- **ESP Web Tools version:** 8.0.3

## Fro Bot Integration

**No Fro Bot agent workflow detected.** The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage.

The repo does use `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem.

## Notable Patterns

- **Package imports via GitHub URL:** Device configs import shared packages using `github://marcusrbrown/esphome.life/packages/...@main`, which is ESPHome's native remote package mechanism. This keeps per-device YAML minimal.
- **Ethernet-based BLE proxies:** The Olimex ESP32-PoE-ISO boards use wired Ethernet (LAN8720) instead of Wi-Fi, providing more reliable connectivity for Bluetooth proxy duty.
- **Single-device CI build:** Only one of two devices is built in CI, likely due to API encryption secrets. The second device may be built locally or via the dev container.
- **Template origin:** The repo structure (static site, ESP Web Tools, manifest generation) follows the `esphome/esphome-project-template` pattern, adapted for Marcus's specific hardware.
- **Git submodule linkage:** This repo is consumed as a submodule by [[marcusrbrown--ha-config]], coupling ESPHome device firmware to the Home Assistant configuration lifecycle.
