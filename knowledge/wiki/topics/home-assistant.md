---
type: topic
title: Home Assistant
created: 2025-06-18
updated: 2026-09-15
sources:
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: b7bcd528f511809e0f5906af42ca6ff131c1ff1e
    accessed: 2026-09-15
tags: [home-assistant, iot, smart-home, yaml, automation, addon, supply-chain, tempio, builder, release-integrity]
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

**Pin-drift footgun:** validating against a frozen `.HA_VERSION` only catches problems that exist in *that* version. Observed in [[marcusrbrown--ha-config]], where `.HA_VERSION` has remained at `2025.6.3` across nine surveys (2025-06 → 2026-08, ~14 months) while pip-resolved deps like `esphome` advance. The CI passes, but the config is not validated against current upstream HA. The Renovate PR bumping `esphome` to v2026 (#777) remains parked — the autopilot merges everything except the updates that would close this drift. Note (2026-08-19): the *other* long-parked dep PR (#766 asyncio-mqtt v0.16.2) finally merged, so the freeze is specifically around the version-gating upgrades (`.HA_VERSION` + esphome v2026), not a blanket refusal to merge — the pattern is a deliberate version-gate freeze, with Marcus running ha-config as a Renovate-only autopilot.

The add-on side uses a different tool: `frenck/action-addon-linter` validates the add-on contract (`config.yaml`, `build.yaml`, image references, arch lists, schema). Observed in [[bfra-me--ha-addon-repository]]. The two `frenck/*` actions are sibling validators serving the two sides of the HA development workflow.

### Multi-Arch Add-on Builds

Add-ons publish multi-arch Docker images via `home-assistant/builder` (pinned at `2026.03.2` in [[bfra-me--ha-addon-repository]]). Standard arch matrix: `aarch64`, `amd64`, `armhf`, `armv7`. Base images from `ghcr.io/home-assistant/{arch}-base` split between Alpine 3.23 (64-bit) and 3.22 (32-bit ARM) — upstream lags on 32-bit. The build action supports `--cosign` for Sigstore signing when `id-token: write` is granted. As of 2026-07-16, upstream has moved the 64-bit base to Alpine **3.24** but the bump (Renovate PR #558 in [[bfra-me--ha-addon-repository]]) has sat open and unmerged for ~2 months under that repo's review-required deadlock, so live `main` still reflects 3.23/3.22 — the 64-bit/32-bit lag persists across the minor bump. **2026-08-31:** #558 is still open (5th survey), and `home-assistant/builder` upstream has since released **2026.06.0** while the caller stays on `2026.03.2` — pinned as a **mutable tag, not a SHA**, in the one job that carries `packages: write` + `id-token: write` and runs `--cosign`. Worth stating for anyone adopting this build shape: the `home-assistant/builder` step is the highest-privilege action in an add-on repo, and `@YYYY.MM.P` reads like a version but is a movable ref. SHA-pin it.

> **Superseded 2026-09-15** for [[bfra-me--ha-addon-repository]] specifically: #558 merged 2026-09-01, the top-level `home-assistant/builder` action was replaced by SHA-pinned composable sub-actions at `2026.06.0`, `build.yaml` and the `{arch}-base` scheme were deleted in favour of one generic digest-pinned `ghcr.io/home-assistant/base:3.24@sha256:…`, and the arch matrix narrowed from four to `aarch64` + `amd64` on native runners. The 64-bit/32-bit Alpine split no longer applies there because 32-bit is no longer built. The paragraph above remains accurate as a description of the *legacy* build shape, which is still what most existing add-on repos run. See *The builder action retired its monolith* below.

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

#### The freshness half was fixed; the integrity half was not (2026-09-15)

`TEMPIO_VERSION` in [[bfra-me--ha-addon-repository]] is now **`2026.07.0`** (PR #577, 2026-09-02). Property 2 above is resolved and the Dependency Dashboard's `Pending Approval` section is empty — the ~21-month freeze was an artifact of the dashboard-approval gate, and it cleared as soon as someone processed the queue.

Property 1 is unchanged, and it is now the more interesting one. The `curl -sSLf` still writes a binary into `/usr/bin` with no checksum, no signature, and no SRI equivalent — in an image whose base is digest-pinned and whose output is cosign-signed with a Sigstore identity token. **The result is a supply chain that is cryptographically attested end to end except at the single point where bytes enter from outside.** Signing an image is a statement about who built it, not about what went into it; an attestation wrapped around an unverified fetch attests the fetch too.

Worth stating plainly because the freshness fix removes the excuse: the line was edited on 2026-09-02 and the verification gap was not addressed while someone had the file open. Stale-and-unverified reads as one problem to triage; current-and-unverified isolates the remaining defect.

Remediations, cheapest first: publish a SHA-256 next to `TEMPIO_VERSION` and `sha256sum -c` after the download; vendor the binary into the repo; or delete the install entirely if the add-on does not template configuration (still the best option for most forks, and the template's own example add-on does not use tempio at all).

### The builder action retired its monolith for composable sub-actions (2026-09-15)

`home-assistant/builder@<tag>` as a single top-level action is superseded upstream. [[bfra-me--ha-addon-repository]] migrated (PR #573) to two sub-actions at one SHA:

| Action | Role |
|---|---|
| `home-assistant/builder/actions/build-image@4de35182… # 2026.06.0` | Build (and optionally push) one architecture |
| `home-assistant/builder/actions/publish-multi-arch-manifest@4de35182… # 2026.06.0` | Assemble and sign the multi-arch manifest |

Four consequences for anyone maintaining an add-on repo:

1. **The tag-vs-SHA problem is fixed as a side effect.** The 2026-08-31 note above ("the `home-assistant/builder` step is the highest-privilege action in an add-on repo … SHA-pin it") is satisfied: both sub-actions are SHA-pinned with version comments. Renovate still tracks the dep under a custom `extractVersion` rule, so bumps remain legible.
2. **The injected-variable contract narrowed.** `build-image` injects **only `BUILD_ARCH` and `BUILD_VERSION`** — notably *not* `BUILD_FROM`. Any Dockerfile relying on `ARG BUILD_FROM` breaks on migration; the replacement is a generic multi-platform `FROM` with an explicit digest. See [[docker-containers]].
3. **The label split is now explicit.** `build-image` supplies and *overrides* `io.hass.arch`, `io.hass.version`, and `org.opencontainers.image.{created,source,version}`. The Dockerfile owns `io.hass.{type,name,description,url}` and `org.opencontainers.image.{title,description,licenses}`. Setting an action-owned label in the Dockerfile is silently discarded — an easy way to believe you have set metadata you have not.
4. **`build.yaml` stops being necessary.** Its only remaining job was per-architecture base-image selection, which the generic-base model eliminates. That repo deleted the file outright, which also removes it from the changed-files filter that decides whether an add-on needs rebuilding.

A related constraint shows up in the arch matrix: `aarch64` and `amd64` have GitHub-hosted native runners (`ubuntu-24.04-arm`, `ubuntu-24.04`) and `armhf`/`armv7` do not. **Supporting 32-bit ARM means keeping QEMU emulation in the build path**, which is why that repo dropped both when it moved to native runners. Dropping a published architecture is a breaking change for anyone running the add-on on 32-bit hardware; it is the kind of decision that deserves more than the 25 minutes of review it received.

### `config.yaml` version is a release contract the Supervisor enforces

From [[bfra-me--ha-addon-repository]]'s `CONTRIBUTING.md`, stating a failure mode worth knowing before it bites:

> The Supervisor resolves the image tag from `config.yaml`. Publishing a changed image under the existing version leaves installed add-ons pointing at the old image.

So shipping a fix without bumping `version` produces a **silent no-op upgrade**: the registry has new bytes, every installed instance keeps running the old ones, and nothing anywhere reports an error. The repo now gates on this with a `release-integrity.sh` required check that asserts `config.yaml`'s `version` equals the top `## <version>` heading in the add-on's `CHANGELOG.md` and increases monotonically — implemented with a hand-written semver comparator in bash, and backed by its own regression suite that runs when the script changes.

The generalizable shape for any add-on repo: **treat the add-on version as the release identifier it actually is**, require a matching changelog heading, and require any change under the add-on directory to bump it — with a documented exemption list for paths that cannot affect the image (`README.md`, `DOCS.md`, `CHANGELOG.md`, `icon.png`, `logo.png`). Without the exemption list the gate blocks documentation fixes; without the gate a version-less publish is invisible until a user reports that the fix did not take.

### Custom Components

Third-party integrations installed via HACS or manually into `custom_components/`. These are typically excluded from linting and pre-commit hooks since they are upstream-managed code.

### ESPHome Integration

ESPHome device configurations are commonly managed as a separate repository and linked via git submodule, keeping device firmware definitions decoupled from the HA config.

## Related Technologies

- **[[esphome]]** — ESP32/ESP8266 firmware framework, integrated with HA
- **Z-Wave** — Mesh networking protocol for IoT devices
- **HACS** — Home Assistant Community Store for third-party integrations
- **InfluxDB** — Time-series database for long-term HA metrics retention
- **Lovelace** — HA's frontend dashboard framework
