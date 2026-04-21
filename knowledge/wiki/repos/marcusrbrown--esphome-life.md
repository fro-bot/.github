---
type: repo
title: "marcusrbrown/esphome.life"
created: 2026-04-18
updated: 2026-04-21
sources:
  - url: https://github.com/marcusrbrown/esphome.life
    sha: e398c2e1e3ef8c68717df26fd67a99b5c91410d7
    accessed: 2026-04-21
tags: [esphome, iot, esp32, bluetooth-proxy, home-assistant, firmware, github-pages]
aliases: [esphome-life, esphome.life]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/esphome.life

ESPHome device configuration repository for Marcus R. Brown's IoT devices. Forked from the [esphome-project-template](https://github.com/esphome/esphome-project-template), it builds firmware via CI and publishes a GitHub Pages site with [ESP Web Tools](https://esphome.github.io/esp-web-tools/) for browser-based flashing.

## Overview

- **Purpose:** ESPHome device firmware definitions, CI-built and deployed to GitHub Pages
- **Default branch:** `main`
- **Created:** 2022-11-09
- **Last push:** 2026-03-12
- **Visibility:** Public
- **License:** None specified
- **Topics:** _(none set)_
- **ESPHome version:** 2025.12.7 (pinned in CI workflow and devcontainer)
- **Linked from:** [[marcusrbrown--ha-config]] as a git submodule at `esphome/`

## Repository Structure

| Path                                   | Purpose                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `olimex-bluetooth-proxy-13451c.yaml`   | Per-device config (Bluetooth Proxy unit 13451c) — not built in CI         |
| `olimex-bluetooth-proxy-1349f4.yaml`   | Per-device config (Bluetooth Proxy unit 1349f4) — built in CI             |
| `packages/olimex-bluetooth-proxy.yaml` | Shared package defining the Olimex ESP32-PoE-ISO Bluetooth Proxy          |
| `static/`                              | GitHub Pages site (Jekyll with slate theme, ESP Web Tools install button) |
| `docs/`                                | Template README from upstream project template (not customized)           |
| `.devcontainer.json`                   | VS Code devcontainer using `ptr727/esphome-nonroot:2025.12.7`             |
| `.github/`                             | Workflows, Renovate config, Probot settings                               |

### Device Configurations

All current devices are **Olimex ESP32-PoE-ISO** boards running as Bluetooth Proxies for [[home-assistant]].

**Per-device YAML files** are thin — they set the device `name` via substitution and pull the shared package from GitHub:

```yaml
packages:
  olimex-bluetooth-proxy: github://marcusrbrown/esphome.life/packages/olimex-bluetooth-proxy.yaml@main
```

The `13451c` unit additionally configures an API encryption key (`!secret`). The `1349f4` unit does not.

**Note:** Only `olimex-bluetooth-proxy-1349f4.yaml` is listed in the CI build matrix. The `13451c` config is present in the repo but not built by CI.

### Shared Package (`packages/olimex-bluetooth-proxy.yaml`)

Defines the full device configuration:

- **Board:** `esp32-poe-iso`
- **Framework:** ESP-IDF
- **Ethernet:** LAN8720 (GPIO23/18/17/12)
- **Minimum ESPHome version:** 2024.6.0
- **Features:** BLE tracker (active scan, 1100ms interval/window), Bluetooth Proxy (active mode), safe mode button, OTA, API, logger
- **Dashboard import:** References `esphome/firmware/bluetooth-proxy/olimex-esp32-poe-iso.yaml@main`

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main`, dispatch | Build firmware + deploy to GitHub Pages |
| Renovate | `renovate.yaml` | issue/PR edit, push (non-main), dispatch, CI completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron (12:23 UTC), dispatch | Probot settings sync |

### CI Pipeline (ci.yaml)

The CI workflow has four jobs:

1. **Prepare** — Outputs the list of YAML files to build (currently only `olimex-bluetooth-proxy-1349f4.yaml`) and the repo name
2. **Build firmware** — Matrix build using `esphome/build-action@v7.1.0` with ESPHome 2025.12.7. Uploads build artifacts
3. **Build** — Gate job (depends on firmware build, reports completion)
4. **Publish** — Only on `marcusrbrown/esphome.life`. Downloads artifacts, creates a combined `manifest.json`, copies static site files, deploys to `gh-pages` branch using `JamesIves/github-pages-deploy-action@v4.8.0`

Publish uses a GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` secrets) and commits as `mrbro-bot[bot]`.

### Branch Protection

Required status checks on `main`: `Prepare`, `Build`, `Publish`, `Renovate / Renovate`. Strict status checks enabled. Linear history enforced. Admin enforcement enabled. No required PR reviews.

### Concurrency

CI workflow uses concurrency group `${{ github.workflow }}-${{ github.event.number || github.ref }}` with cancel-in-progress on non-main branches.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.1`. Custom package rule tracks ESPHome across Docker images (`ptr727/esphome-nonroot`, `esphome/esphome`, `ghcr.io/esphome/esphome`) with loose versioning and semantic commit types. Post-upgrade runs `npx prettier@3.8.1`.
- **Devcontainer:** Uses `docker.io/ptr727/esphome-nonroot:2025.12.7` with ESPHome dashboard, verbose logging, `America/Phoenix` timezone. Forwards port 6052 (ESPHome native API). VS Code extensions include ESPHome, PlatformIO, Python, YAML, EditorConfig, Markdown lint, serial monitor, and spell checker. File associations map `*.yaml`/`*.yml` to ESPHome language mode (with exceptions for workflow/settings files).
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml`. Overrides description and branch protection.
- **EditorConfig:** UTF-8, LF, 2-space indent, 120-char max line, trailing whitespace trimming.
- **Prettier:** 120 print width, single quotes.
- **Git:** LF line endings enforced via `.gitattributes`. JSON files tagged as JSON-with-comments for linguist.

## GitHub Pages Site

The repo deploys a static site to GitHub Pages using Jekyll (slate theme). The site provides a browser-based firmware installer via ESP Web Tools (`esp-web-tools@8.0.3`). The `manifest.json` is generated by CI from build artifacts.

The site content (`static/index.md`) is minimal — the upstream template placeholder text has not been customized.

## Fro Bot Integration

**No Fro Bot agent workflow detected.** The repository does not contain a `fro-bot.yaml` workflow. It does extend `fro-bot/.github:common-settings.yaml` via Probot settings, confirming it is part of the Fro Bot-managed ecosystem.

A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage.

## Notable Patterns

- **Package-based device configs:** Thin per-device YAML files pull shared configuration from a `packages/` directory via `github://` package imports. This is the standard ESPHome pattern for managing multiple devices with a shared base.
- **Partial CI coverage:** Only one of two device configs (`1349f4`) is built in CI. The `13451c` config is not in the build matrix.
- **Template heritage:** The repo was generated from `esphome/esphome-project-template`. Template artifacts remain in `docs/readme.md` and `static/index.md` without customization.
- **Ethernet-only devices:** All devices use ESP32-PoE-ISO with LAN8720 Ethernet — no Wi-Fi. This is notable for a Bluetooth Proxy setup where wired backhaul provides more reliable connectivity.
- **Git submodule consumer:** This repo is referenced as a submodule from [[marcusrbrown--ha-config]] at the `esphome/` path, linking ESPHome device firmware to the Home Assistant configuration.
