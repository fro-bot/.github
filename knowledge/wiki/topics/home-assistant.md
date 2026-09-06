---
type: topic
title: Home Assistant
created: 2025-06-18
updated: 2026-09-06
tags: [home-assistant, iot, smart-home, yaml, automation, addon, supply-chain, hacs, vendored-dependencies]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - bfra-me--ha-addon-repository
  - github-actions-ci
  - docker-containers
  - esphome
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

**Mechanism correction (2026-09-06):** the action reads `.HA_VERSION` **itself**. Its `version` input is optional; when empty it falls back to `$path/.HA_VERSION`, and only if that file is absent does it warn and use `stable`. So the minimal correct usage is to pass no `version:` at all. [[marcusrbrown--ha-config]] instead runs a shell step that reads the file and writes `$GITHUB_OUTPUT`— and that step is broken (`echo '{value}={$HA_VERSION}'`: single-quoted, mis-keyed, so the output is empty). The pipeline validates against 2025.6.3 regardless, purely because of the action's own fallback. If you copy that workflow, delete the step; it does nothing and hides the fact that nothing is checking it. See [[github-actions-ci]] for the general "downstream default masks upstream defect" pattern.

**Pin-drift footgun:** validating against a frozen `.HA_VERSION` only catches problems that exist in *that* version. Observed in [[marcusrbrown--ha-config]], where `.HA_VERSION` has remained at `2025.6.3` across nine surveys (2025-06 → 2026-08, ~14 months) while pip-resolved deps like `esphome` advance. The CI passes, but the config is not validated against current upstream HA. The Renovate PR bumping `esphome` to v2026 (#777) remains parked — the autopilot merges everything except the updates that would close this drift. Note (2026-08-19): the *other* long-parked dep PR (#766 asyncio-mqtt v0.16.2) finally merged, so the freeze is specifically around the version-gating upgrades (`.HA_VERSION` + esphome v2026), not a blanket refusal to merge — the pattern is a deliberate version-gate freeze, with Marcus running ha-config as a Renovate-only autopilot.

Status at 2026-09-06 (tenth ha-config survey): `.HA_VERSION` still `2025.6.3` (~15 months), `esphome==2025.12.7` against an upstream `2026.8.2`, #777 open ~114 days. The freeze holds.

### Renovate's `homeassistant-manifest` Manager Writes Into Vendored Integrations (2026-09-06)

A footgun specific to Home Assistant *configuration* repos that vendor `custom_components/` into git — which is the normal thing to do, since HACS installs into the config directory and most people commit the whole tree.

Renovate ships a `homeassistant-manifest` manager, enabled by default, which parses the `requirements` array of every `custom_components/*/manifest.json` and opens PRs to bump those Python packages. In [[marcusrbrown--ha-config]] it tracks six vendored manifests (`ble_monitor`, `hacs`, `mail_and_packages`, `sengledng`, `solaredge_modbus_multi`, `toyota_na`) covering ten requirements.

Three reasons this is the wrong target in a config repo:

1. **The files are not yours.** They are upstream integration artifacts that HACS overwrites wholesale on the next integration update. The repo in question already knows this — its `.pre-commit-config.yaml` opens with `exclude: '^(custom_components/|www/|\.HA_VERSION)'` under the comment *"Always exclude files that are updated by Home Assistant."* Two tools, opposite ownership models, same directory.
2. **The edits do not survive.** A merged bump is reverted by the next HACS update, re-detected, and re-proposed. The long-parked #766 (`asyncio-mqtt` → 0.16.2, merged 2026-08-15 after months) edited `custom_components/sengledng/manifest.json` and has no mechanism keeping it applied.
3. **`requirements` is a compatibility claim, not a lockfile.** It records what the integration author tested against. Home Assistant installs from it at runtime, so tightening or advancing it makes HA install a version upstream never exercised — and the resulting breakage presents as an integration bug with no trace back to the config repo that caused it.

The fix is one `packageRules` entry disabling the manager, or `ignorePaths: ['custom_components/**']`, aligning Renovate's write boundary with the one pre-commit already declares.

**Second-order effect:** Renovate's newer **Abandoned Dependencies** dashboard section inherits the same wrong scope. In ha-config it lists 7 entries, 6 of them `homeassistant-manifest` transitives the repo cannot act on — `pyric` last released **2016-12-04**, `aioblescan` 2023-01-07, `btsocket`, `janus`, `pycryptodomex`, `asyncio-mqtt`. These are real abandonment signals about the *integrations*' dependency choices, but they are addressed to the wrong maintainer. Only `pre-commit/pre-commit-hooks` is actionable. A dashboard section whose contents are 86% un-actionable trains the reader to skip it, which is a cost paid by whatever genuine finding lands there next.

The add-on side uses a different tool: `frenck/action-addon-linter` validates the add-on contract (`config.yaml`, `build.yaml`, image references, arch lists, schema). Observed in [[bfra-me--ha-addon-repository]]. The two `frenck/*` actions are sibling validators serving the two sides of the HA development workflow.

### Multi-Arch Add-on Builds

Add-ons publish multi-arch Docker images via `home-assistant/builder` (pinned at `2026.03.2` in [[bfra-me--ha-addon-repository]]). Standard arch matrix: `aarch64`, `amd64`, `armhf`, `armv7`. Base images from `ghcr.io/home-assistant/{arch}-base` split between Alpine 3.23 (64-bit) and 3.22 (32-bit ARM) — upstream lags on 32-bit. The build action supports `--cosign` for Sigstore signing when `id-token: write` is granted. As of 2026-07-16, upstream has moved the 64-bit base to Alpine **3.24** but the bump (Renovate PR #558 in [[bfra-me--ha-addon-repository]]) has sat open and unmerged for ~2 months under that repo's review-required deadlock, so live `main` still reflects 3.23/3.22 — the 64-bit/32-bit lag persists across the minor bump. **2026-08-31:** #558 is still open (5th survey), and `home-assistant/builder` upstream has since released **2026.06.0** while the caller stays on `2026.03.2` — pinned as a **mutable tag, not a SHA**, in the one job that carries `packages: write` + `id-token: write` and runs `--cosign`. Worth stating for anyone adopting this build shape: the `home-assistant/builder` step is the highest-privilege action in an add-on repo, and `@YYYY.MM.P` reads like a version but is a movable ref. SHA-pin it.

### `tempio` Is the Add-on Build's Quiet Runtime Dependency

The HA add-on template installs `tempio` (HA's Go template renderer) at image-build time by curling a release binary:

```dockerfile
# renovate: datasource=github-releases depName=home-assistant/tempio versioning=loose
ARG TEMPIO_VERSION=2024.11.2
RUN curl -sSLf -o /usr/bin/tempio \
  "https://github.com/home-assistant/tempio/releases/download/${TEMPIO_VERSION}/tempio_${BUILD_ARCH}"
```

Three properties worth knowing (observed 2026-08-31 in [[bfra-me--ha-addon-repository]], inherited by every fork of the template):

1. **It is the only artifact the image pulls over the network**, and there is no checksum or signature verification on the download.
2. **It is calendar-versioned**, and the Renovate comment specifies `versioning: loose`. `2024.11.2 → 2026.07.0` therefore classifies as a **major** bump, which in a `dependencyDashboardApproval` setup lands as an unchecked checkbox rather than a PR. The pin has consequently sat ~21 months stale under an otherwise-active Renovate install.
3. It is the same calendar-versioning trap documented for ESPHome in [[esphome]] — see [[github-actions-ci]] for the general rule. A pin that never moves under a hot dependency bot is a suppression signal, not a stability signal.

If you fork the HA add-on template and do not use templating, deleting the `tempio` install removes an unverified network fetch from every image you publish.

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
