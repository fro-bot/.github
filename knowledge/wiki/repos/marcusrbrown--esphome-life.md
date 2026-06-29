---
type: repo
title: "marcusrbrown/esphome.life"
created: 2026-04-18
updated: 2026-06-29
sources:
  - url: https://github.com/marcusrbrown/esphome.life
    sha: e398c2e1e3ef8c68717df26fd67a99b5c91410d7
    accessed: 2026-04-21
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
tags: [esphome, iot, esp32, bluetooth-proxy, home-assistant, firmware, github-pages]
aliases: [esphome-life, esphome.life]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--renovate-config
---

# marcusrbrown/esphome.life

ESPHome device configuration repository for Marcus R. Brown's IoT devices. Forked from the [esphome-project-template](https://github.com/esphome/esphome-project-template), it builds firmware via CI and publishes a GitHub Pages site with [ESP Web Tools](https://esphome.github.io/esp-web-tools/) for browser-based flashing.

## Overview

- **Purpose:** ESPHome device firmware definitions, CI-built and deployed to GitHub Pages
- **Default branch:** `main`
- **Created:** 2022-11-09
- **Last push:** 2026-06-29
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
2. **Build firmware** — Matrix build using `esphome/build-action@v7.2.0` with ESPHome 2025.12.7. Uploads build artifacts
3. **Build** — Gate job (depends on firmware build, reports completion)
4. **Publish** — Only on `marcusrbrown/esphome.life`. Downloads artifacts, creates a combined `manifest.json`, copies static site files, deploys to `gh-pages` branch using `JamesIves/github-pages-deploy-action@v4.8.0`

Publish uses a GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` secrets) and commits as `mrbro-bot[bot]`.

All actions are SHA-pinned with version comments. As of 2026-06-07: `actions/checkout@v5.0.1` (SHA `93cb6ef`), `esphome/build-action@v7.3.0` (SHA `4ef4722`, bumped from v7.2.0 on 2026-05-26), `actions/upload-artifact@v5.0.0` (SHA `330a01c`), `actions/create-github-app-token@v2.2.2` (SHA `fee1f7d`), `actions/download-artifact@v6.0.0` (SHA `018cc2c`).

### Reusable Workflow Pins

Both `renovate.yaml` and `update-repo-settings.yaml` delegate to `bfra-me/.github` reusable workflows at v4.16.32 (SHA `bbf77bc`, bumped from v4.16.27 on 2026-06-18 → v4.16.28 → v4.16.31 → v4.16.32 by 2026-06-29 via #367/#370/#371, with intermediate non-major bundles #368/#369). Earlier chain: v4.16.20 (2026-05-25) → v4.16.23 (2026-06-07) → v4.16.27 (2026-06-18).

**Footgun (first noted 2026-05-26; reconfirmed 2026-06-07, 2026-06-18, and 2026-06-29):** `update-repo-settings.yaml` calls `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.32` — the same path used by the Renovate workflow, rather than a settings-specific reusable workflow. Renovate has continued to bump this version alongside the Renovate workflow across every weekly release, meaning the footgun is actively maintained by automation. The daily settings-sync cron is running Renovate twice, not syncing settings. Four consecutive surveys have flagged this without a patch landing; it remains a candidate for a follow-up issue.

### Branch Protection

Required status checks on `main`: `Prepare`, `Build`, `Publish`, `Renovate / Renovate`. Strict status checks enabled. Linear history enforced. Admin enforcement enabled. No required PR reviews.

### Concurrency

CI workflow uses concurrency group `${{ github.workflow }}-${{ github.event.number || github.ref }}` with cancel-in-progress on non-main branches.

## Developer Tooling

- **Renovate:** Extends [[marcusrbrown--renovate-config]] at `#5.2.3` (bumped from `#5.2.1` on 2026-06-13, PR #364). Custom package rule tracks ESPHome across Docker images (`ptr727/esphome-nonroot`, `esphome/esphome`, `ghcr.io/esphome/esphome`) with loose versioning and semantic commit types. Post-upgrade runs `npx prettier@3.8.4` (bumped from 3.8.3 on 2026-06-12, PR #363).
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

A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage. This recommendation has been carried forward across seven surveys (2026-04-18, 2026-04-21, 2026-04-23, 2026-05-26, 2026-06-07, 2026-06-18, 2026-06-29).

## Notable Patterns

- **Package-based device configs:** Thin per-device YAML files pull shared configuration from a `packages/` directory via `github://` package imports. This is the standard ESPHome pattern for managing multiple devices with a shared base.
- **Partial CI coverage:** Only one of two device configs (`1349f4`) is built in CI. The `13451c` config is not in the build matrix.
- **Template heritage:** The repo was generated from `esphome/esphome-project-template`. Template artifacts remain in `docs/readme.md` and `static/index.md` without customization.
- **Ethernet-only devices:** All devices use ESP32-PoE-ISO with LAN8720 Ethernet — no Wi-Fi. This is notable for a Bluetooth Proxy setup where wired backhaul provides more reliable connectivity.
- **Git submodule consumer:** This repo is referenced as a submodule from [[marcusrbrown--ha-config]] at the `esphome/` path, linking ESPHome device firmware to the Home Assistant configuration.
- **Renovate-only commit log:** Every commit since the prior content change (2026-03-12) has been a Renovate dependency bump. No human-authored changes to device configs, workflows, or static site in over three and a half months. The repo is on autopilot: `mrbro-bot[bot]` authors all commits. The last human-authored commit was `2d315c2` (2026-05-14, Renovate preset v4 → 5.2.0).
- **Open issues:** 3 open — the Dependency Dashboard (Renovate, issue #26), the `Uplift esphome-life` meta-issue (#8, longstanding), and a community note about BPPLUG devices (#298, spam-adjacent — not a real bug report).

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `83784bc` (ha-config survey, cross-reference) | Initial cross-reference from [[marcusrbrown--ha-config]] survey |
| 2026-04-21 | `e398c2e` | Full survey; documented device configs, CI pipeline, devcontainer, Probot/Renovate settings |
| 2026-04-23 | `e398c2e` | Re-survey; no content changes detected — repo unchanged since 2026-03-12 |
| 2026-05-26 | `fc5adc2` | Renovate preset crossed v4 → v5 boundary (`#5.2.0`); `bfra-me/.github` v4.4.0 → v4.16.20; `esphome/build-action` v7.1.0 → v7.2.0 plus action SHA refreshes; Prettier 3.8.1 → 3.8.3. Surfaced `update-repo-settings.yaml` reusable-workflow-path footgun (calls `renovate.yaml` instead of a settings workflow). Still no Fro Bot agent workflow. |
| 2026-06-07 | `bd5aa88` | Renovate preset bumped `#5.2.0` → `#5.2.1` (PR #360, 2026-06-06); `bfra-me/.github` v4.16.20 → v4.16.23 (three weekly bumps); `esphome/build-action` v7.2.0 → v7.3.0 (2026-05-26). Footgun in `update-repo-settings.yaml` confirmed persisting — Renovate is actively bumping the wrong workflow path alongside the real Renovate workflow. ESPHome device config unchanged (2025.12.7, Olimex Bluetooth Proxy); no Fro Bot workflow; Uplift issue #8 still open. |
| 2026-06-18 | `ce8df72` | Dependency-only delta. `bfra-me/.github` v4.16.23 → v4.16.27 (four weekly bumps: #361/#362/#365/#366, SHA `3f97c92`); Renovate preset `#5.2.1` → `#5.2.3` (#364); Prettier 3.8.3 → 3.8.4 (#363). `esphome/build-action` (v7.3.0), ESPHome version (2025.12.7), CI action pins, and Olimex device configs all unchanged. `update-repo-settings.yaml` footgun reconfirmed (now `renovate.yaml@v4.16.27`) — three surveys flagged, no patch. No Fro Bot workflow; open issues unchanged (#8 Uplift, #26 Dependency Dashboard, #298 BPPLUG note). |
| 2026-06-29 | `9e1618f` | Dependency-only delta. `bfra-me/.github` v4.16.27 → v4.16.32 (SHA `bbf77bc`; #367/#370/#371 plus non-major bundles #368/#369). Renovate preset (`#5.2.3`), Prettier (3.8.4), `esphome/build-action` (v7.3.0), ESPHome version (2025.12.7), all CI action SHAs, and Olimex device configs unchanged. `update-repo-settings.yaml` footgun reconfirmed (now `renovate.yaml@v4.16.32`) — fourth survey flagged, no patch. No Fro Bot workflow; open issues unchanged (#8 Uplift, #26 Dependency Dashboard, #298 BPPLUG note). |
