---
type: repo
title: "marcusrbrown/ha-config"
created: 2025-06-18
updated: 2026-07-18
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
    sha: f80fbc124c0765b8685c3cd98fe3d8eff832e872
    accessed: 2026-05-17
  - url: https://github.com/marcusrbrown/ha-config
    sha: 33cca0534ca2b0dbbb7db4235912c1f225458beb
    accessed: 2026-05-29
  - url: https://github.com/marcusrbrown/ha-config
    sha: 906126b1e09e1d6102612287cc155000b51068c0
    accessed: 2026-06-10
  - url: https://github.com/marcusrbrown/ha-config
    sha: 6b04de1e1b4dc15936ccce169953914b1b5bcbce
    accessed: 2026-06-20
  - url: https://github.com/marcusrbrown/ha-config
    sha: 019cbe93087ac5ca22e5b27ee370ec11fd146586
    accessed: 2026-07-03
  - url: https://github.com/marcusrbrown/ha-config
    sha: c51e25b17ca99a3f5d39c8fd77c0b9e32430664b
    accessed: 2026-07-18
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
- **Last push:** 2026-07-16 (`c51e25b`)
- **HA version tracked:** 2025.6.3 (pinned in `.HA_VERSION`; unchanged since initial survey — a notable drift between code and the broader HA release cadence, now ~13 months stale)
- **Topics:** `home-assistant`, `home-assistant-config`
- **Open issues:** 1 (#427 Dependency Dashboard — confirmed still open 2026-06-20)
- **Open PRs:** 2 (#766 asyncio-mqtt v0.16.2, #777 esphome v2026 — both long-parked Renovate PRs, still unchanged as of 2026-07-03)
- _Correction (2026-06-10):_ Earlier surveys recorded "3 open issues, 0 open PRs" — #766 and #777 are PRs that GitHub's `open_issues_count` includes; the underlying state has not changed, only its classification here.

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
3. **Prettier** — Format check using Prettier 3.9.4 (diff-only on PRs via `creyD/prettier_action@v4.3`)
4. **Check Home Assistant Config** — Runs `frenck/action-home-assistant@v1.4.1` against the HA version in `.HA_VERSION` (depends on lint jobs)

### Branch Protection

Required status checks on `main`: YAML Lint, Remark Lint, Prettier, Check Home Assistant Config, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github`. As of 2026-07-16 both are pinned to **v4.16.37** (SHA `058b81211bf35133c2988de1619be09a2158fbd6`), up from v4.16.33 in the prior survey — four more patch bumps in two weeks (#834 v4.16.34 → #836 v4.16.35 → #840 v4.16.36 → #844 v4.16.37). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

### Renovate Trigger Model

The Renovate workflow uses a multi-trigger pattern:

- `issues: [edited]` and `pull_request: [edited]` — re-run when Renovate edits its own issues/PRs
- `push` to non-main branches — re-run on branch updates
- `workflow_dispatch` — manual trigger with configurable log level and print-config options
- `workflow_run` on CI completion — triggers Renovate after successful CI on main

This is the same event-driven Renovate pattern used in [[marcusrbrown--github]] and other Marcus repos, replacing the hourly cron schedule.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.7` (two patch bumps from `#5.2.4` via #842 v5.2.6 → #846 v5.2.7). Custom managers for `.pre-commit-config.yaml` (Python version + pip packages) and `mise.toml` (pre-commit via aqua). Git submodules enabled. Post-upgrade runs `npx prettier@3.9.5 --no-color --write .` — Prettier advanced 3.9.4 → 3.9.5 (#839), propagated to both the `ci.yaml` env and the post-upgrade task. Automerge on minor/patch pip updates. ESPHome version updates are unseparated (major+minor+patch treated as a single update). The `groupName: pre-commit` rule groups the `pre-commit` package updates together.
- **Pre-commit:** Managed via `mise` (aqua, v4.6.0). Hooks: trailing whitespace, EOF fixer, double-quote string fixer, requirements-txt fixer, large file check, merge conflict check, TOML/YAML validation. Excludes `custom_components/`, `www/`, `.HA_VERSION`. Uses `--unsafe` YAML check to allow HA YAML extensions (`!include`, `!secret`, etc.).
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` for repository configuration sync.
- **AI Rules:** `.cursorrules` defines HA-specific development conventions (YAML standards, package organization, security, testing).
- **Python deps:** `esphome==2025.12.7`, `yamllint==1.38.0` (in `requirements.txt`).
- **mise.toml:** Manages `pre-commit` tool version via aqua (`aqua:pre-commit/pre-commit = "4.6.0"`).

## Fro Bot Integration

**No Fro Bot workflow detected** (confirmed across eight consecutive surveys: 2025-06, 2026-04 ×2, 2026-05, 2026-06 ×2, 2026-07 ×2). The three workflows remain `ci.yaml`, `renovate.yaml`, and `update-repo-settings.yaml`. The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage. The persistence of this gap across nearly a year suggests it is not on the maintenance critical path — Marcus is treating ha-config as a Renovate-only autopilot repo, with no PR-review or triage agent needed since virtually all merges are bot-authored.

The repo does reference `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem.

A separate write-author (`mrbro-bot[bot]`, GitHub ID 137683033) is co-authoring recent Renovate commits (first seen on #790, 2026-05-28). As of 2026-07-16, `mrbro-bot[bot]` remains the commit author on *every* merge across the last window (#834→#847) — five survey windows of unbroken authorship, a durable, not transitional, pattern. This is the active Renovate merge identity for this repo. Whether it is a parallel automation identity or replaces fro-bot's role here remains open; no fro-bot-authored commits observed across the last four survey windows.

## Notable Patterns

- **Package-based architecture:** Domain concerns are isolated into `packages/` YAML files rather than a monolithic config. This is the recommended HA pattern for complex setups.
- **IoT diversity:** The config spans Z-Wave, BLE (Bermuda trilateration), ESPHome, solar (SolarEdge Modbus), irrigation (B-Hyve), and connected vehicles (Toyota NA).
- **InfluxDB metrics:** Long-term data retention via InfluxDB, separate from the default HA recorder.
- **Multi-instance HA:** `remote_homeassistant` component suggests a multi-node HA deployment.
- **ESPHome as submodule:** Device configs live in a separate repo (`esphome.life`), linked via git submodule rather than copied.
- **Exclusively Renovate-driven activity:** All recent commits (30+ consecutive) are Renovate dependency bumps — no structural or config changes since the initial survey.

## Survey History

| Date | SHA | Key Changes |
| --- | --- | --- |
| 2025-06-18 | `83784bc` | Initial survey — 11 packages, 10 custom components, Prettier 3.8.2, Renovate `#4.5.7`, pre-commit 4.5.1 |
| 2026-04-18 | `54a6727` | Prettier 3.8.3, Renovate `#4.5.8`, bfra-me/.github v4.16.6, pre-commit-hooks v6.0.0 |
| 2026-04-24 | `f7ec803` | pre-commit 4.6.0, bfra-me/.github v4.16.8, Renovate trigger model expanded (workflow_run, push to non-main) |
| 2026-05-17 | `f80fbc1` | Renovate preset major bump `marcusrbrown/renovate-config#4.5.8 → #5.2.0` (PR #776), bfra-me/.github reusable workflows v4.16.8 → v4.16.17, open Renovate PRs queued for esphome v2026 (#777) and asyncio-mqtt v0.16.2 (#766). No package/custom-component additions; `.HA_VERSION` still 2025.6.3. |
| 2026-05-29 | `33cca05` | Pure Renovate churn since prior survey: bfra-me/.github v4.16.17 → v4.16.21 (four patch bumps in 11 days), `pipelinecomponents/remark-lint` digest pinned to `829aa31` (#790), esphome submodule digest advanced four times (#782, #784, #786, #787, #789). Co-author `mrbro-bot[bot]` appears on recent Renovate merges — first sighting of a non-fro-bot automation identity on this repo. Same 3 open issues, same 0 open PRs, same `.HA_VERSION` 2025.6.3, same 11 packages, same 10 custom components. No structural drift. Still no Fro Bot workflow. |
| 2026-06-10 | `906126b` | Renovate-only churn continues: bfra-me/.github v4.16.21 → v4.16.24 (#791, #794, #798), Renovate preset `#5.2.0` → `#5.2.1` (#796), `actions/checkout` v6.0.3 (#793), esphome submodule digest advanced four times (#792, #795, #797, #799). `mrbro-bot[bot]` now authors every merge in the last 15 commits — fully displaced prior authorship. Open items unchanged: #427 Dependency Dashboard, blocked PRs #766 (asyncio-mqtt) and #777 (esphome v2026) — note GitHub counts these PRs in `open_issues_count`. `.HA_VERSION` still 2025.6.3 (~12 months stale), `esphome==2025.12.7` in requirements while the v2026 bump PR (#777) stays parked. No structural drift. Still no Fro Bot workflow (fifth consecutive survey). |
| 2026-06-20 | `6b04de1` | Pure Renovate churn since prior survey: bfra-me/.github v4.16.24 → v4.16.27 (#800, #806, #808), Renovate preset `#5.2.1` → `#5.2.3` (#804), Prettier 3.8.3 → 3.8.4 (#802, propagated to both `ci.yaml` env and the post-upgrade task), esphome submodule digest advanced ~six times (#799→#809). New `groupName: pre-commit` rule added to renovate config. `mrbro-bot[bot]` still authors every merge (through #809). Open items unchanged: #427 Dependency Dashboard (confirmed open), parked PRs #766 and #777. `.HA_VERSION` still 2025.6.3, `esphome==2025.12.7`, mise pre-commit 4.6.0 — all static. No structural drift, no package/custom-component changes. Still no Fro Bot workflow (sixth consecutive survey). |
| 2026-07-03 | `019cbe9` | Pure Renovate churn since prior survey (#810→#833, all `mrbro-bot[bot]`): bfra-me/.github v4.16.27 → v4.16.33 (#816, #818, #828), Renovate preset `#5.2.3` → `#5.2.4` (#826), **Prettier crossed a minor boundary 3.8.4 → 3.9.4** (#820/#822/#824/#830/#832, propagated to `ci.yaml` env + post-upgrade task), esphome submodule digest advanced ~ten times. Open items unchanged: #427 Dependency Dashboard (confirmed open), parked PRs #766 and #777. `.HA_VERSION` still 2025.6.3 (~13 months stale), `esphome==2025.12.7`, `yamllint==1.38.0`, mise pre-commit 4.6.0, 11 packages, 10 custom components — all static. No structural drift. Still no Fro Bot workflow (seventh consecutive survey); `mrbro-bot[bot]` authorship now durable across four windows. |
| 2026-07-18 | `c51e25b` | Pure Renovate churn since prior survey (#834→#847, all `mrbro-bot[bot]`): bfra-me/.github v4.16.33 → v4.16.37 (#834/#836/#840/#844), Renovate preset `#5.2.4` → `#5.2.7` (#842 v5.2.6, #846 v5.2.7), Prettier 3.9.4 → 3.9.5 (#839, propagated to `ci.yaml` env + post-upgrade `npx prettier@3.9.5`), esphome submodule digest advanced ~eight times. Open items unchanged: #427 Dependency Dashboard (confirmed open), parked PRs #766 (asyncio-mqtt v0.16.2) and #777 (esphome v2026). `.HA_VERSION` still 2025.6.3 (~13 months stale), `esphome==2025.12.7`, `yamllint==1.38.0`, mise pre-commit 4.6.0, 11 packages, 10 custom components, esphome submodule → `marcusrbrown/esphome.life` — all static. No structural drift. Still no Fro Bot workflow (eighth consecutive survey); `mrbro-bot[bot]` authorship durable across five windows. |
