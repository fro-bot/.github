---
type: entity
title: ESPHome
created: 2026-04-23
updated: 2026-09-14
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
  - url: https://github.com/marcusrbrown/esphome.life
    sha: 08ca7a9e68a3d071068407e4504bff97f8ab3e43
    accessed: 2026-08-01
  - url: https://github.com/marcusrbrown/esphome.life
    sha: 5fffe20526f0a29abfcb198a8b82330a90f7e621
    accessed: 2026-08-30
  - url: https://github.com/esphome/esphome/releases/latest
    accessed: 2026-08-30
  - url: https://github.com/marcusrbrown/ha-config
    sha: 150e0597ef657ef60ce7c38b83cab743f3e5016b
    accessed: 2026-09-06
  - url: https://github.com/marcusrbrown/esphome.life
    sha: fd398954a17ea11c94c68f4f0708cd6356e65191
    accessed: 2026-09-14
  - url: https://github.com/bfra-me/renovate-config
    sha: 8806d6b6ec8cd42b3b23c8bd926e9eb1e6a79fd3
    accessed: 2026-09-14
  - url: https://github.com/esphome/esp-web-tools/releases/latest
    accessed: 2026-09-14
tags: [esphome, iot, esp32, firmware, home-assistant, bluetooth-proxy, calendar-versioning]
aliases: [esphome, esphome-life]
related:
  - marcusrbrown--esphome-life
  - marcusrbrown--ha-config
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
- **CI build matrix** — Firmware builds triggered on push/PR via `esphome/build-action@v7.4.0` with ESPHome 2025.12.7 (still true 2026-08-30; the action bumped v7.3.0 → v7.4.0 by 2026-07-16, while the ESPHome runtime pin stayed frozen)
- **GitHub Pages distribution** — Jekyll site with ESP Web Tools install button, `manifest.json` generated from CI build artifacts
- **Devcontainer** — VS Code devcontainer using `ptr727/esphome-nonroot:2025.12.7` Docker image with ESPHome dashboard

### ESP Web Tools is the untracked half

The install page's widget is loaded from a hand-written `https://unpkg.com/esp-web-tools@8.0.3/...` module URL embedded in `static/index.md` — no manifest, no Renovate custom manager, no SRI hash (see [[marcusrbrown--esphome-life]], 2026-08-30). ESPHome's published CI/CD template gives you SHA-pinned actions and a Renovate-managed firmware version, but it hands the distribution widget over as a raw CDN string. Anyone adopting `esphome-project-template` inherits that gap. Mitigation: add a Renovate `customManagers` regex for the `esp-web-tools@<version>` token in `static/index.md`, or vendor the script.

## Version Pinning

ESPHome version is pinned across CI and devcontainer (currently 2025.12.7, unchanged across **eleven** surveys spanning 2026-04 → 2026-09-14, ~5.9 months; the `ci.yaml` blob is byte-identical across that whole span). The Renovate configuration tracks ESPHome across Docker images (`ptr727/esphome-nonroot`, `esphome/esphome`, `ghcr.io/esphome/esphome`) with loose versioning and semantic commit types — but no major/minor bumps have arrived since at least early March 2026, which is a remarkably quiet stretch for an actively-developed framework. Renovate keeps the surrounding dependency stack (`bfra-me/.github`, preset, Prettier) current weekly, yet the ESPHome pin never moves — strong evidence the loose versioning + `separateMajorMinor: false` config is suppressing the 2026.x bumps rather than Renovate simply not running. Reinforcing this read: on 2026-08-01 the *tooling* around ESPHome finally advanced — `esphome/build-action` bumped v7.3.0 → v7.4.0 — while the ESPHome runtime version it builds stayed frozen. Renovate is clearly reaching this repo; the `depName=esphome/esphome versioning=loose` datasource comment on the pinned `version:` is what holds the runtime still. The upstream ESPHome project has continued releasing (2026.x series).

### Drift quantified (2026-08-30)

> **Partially superseded 2026-09-14** — the drift arithmetic below holds, but the "invisible / no PR is ever opened" root cause does not. See [Correction (2026-09-14)](#correction-2026-09-14-it-was-never-invisible--it-was-approval-gated-all-along).

The upstream `esphome/esphome` latest release is **2026.8.1** (published 2026-08-23). The pin at 2025.12.7 is therefore roughly **eight months and nine calendar-versioned minor series behind**. In the same window Renovate landed 13 PRs against this repo — six `bfra-me/.github` minor boundaries, a Pages-deploy-action bump, three preset bumps — without proposing a single ESPHome bump.

That asymmetry is the diagnostic. ESPHome uses calendar versioning (`YYYY.M.PATCH`), and the package rule sets `versioning: 'loose'` with `separateMajorMinor: false` and `separateMinorPatch: false`. Loose versioning has no notion of a calver *year* rollover; collapsing the major/minor/patch split then removes the separate update branches that would normally surface a `2025.12 → 2026.8` jump as its own PR. The net effect is a rule that was written to make ESPHome bumps *tidier* and instead made them *invisible*.

**Generalizable:** calendar-versioned upstreams and `versioning: loose` are a bad pairing. If a dependency versions by date, tell Renovate so (an explicit `regex:` scheme capturing `YYYY`/`M`/`PATCH`) and leave `separateMajorMinor` alone. A pin that never moves is not evidence of stability; it is usually evidence that nothing is asking.

### The same trap, reached from the other direction (2026-09-06)

[[marcusrbrown--ha-config]] pins `esphome==2025.12.7` in `requirements.txt` — the identical version, in a different repo, held by a different mechanism. Its Renovate config carries a **repo-local** rule rather than inheriting the shared preset's:

```json5
{ matchPackageNames: ['esphome'], separateMajorMinor: false, separateMinorPatch: false }
```

Because ESPHome is calver, `2025.12.7 → 2026.8.2` classifies as a **major**, and this repo automerges only `minor`/`patch`. The result is PR **#777**, open since 2026-05-14 — **~114 days** — carrying the entire nine-month jump as one approval-gated change nobody wants to review.

The instructive part is the contrast in *visibility*, not outcome:

| | [[marcusrbrown--esphome-life]] | [[marcusrbrown--ha-config]] |
| --- | --- | --- |
| Suppression source | shared preset (`versioning: loose`) | repo-local `packageRules` |
| Symptom | **no PR is ever opened** | one PR, permanently parked |
| Detectability | invisible — looks like upstream is quiet | visible — a stale PR with a `major` label |
| Elapsed | ~5.6 months at 2026-08-30 | ~114 days at 2026-09-06 |

Same root cause, same frozen version, opposite failure signatures. Visible-and-stuck is strictly better than invisible-and-stuck — you can at least count the days — but neither ships the upgrade, and the collapse of `separateMinorPatch` is what makes the parked PR unreviewable in both cases: there is no way to take the safe patch increments while deferring the year rollover, because the config deleted that distinction.

**Corollary to the rule above:** `separateMinorPatch: false` on a calver dependency does not just hide the jump, it removes the *incremental escape route*. Keep the split, and a stalled major at least leaves a merged trail of patches behind it.

Upstream at 2026-09-06 is **2026.8.2** per ha-config's dependency dashboard (was 2026.8.1 on 2026-08-30) — the series continues to move while both consumers hold.

### Correction (2026-09-14): it was never invisible — it was approval-gated all along

Direct read of [[marcusrbrown--esphome-life]]'s Dependency Dashboard (issue #26) at HEAD `fd39895` **falsifies the "invisible" half** of the 2026-08-30 finding above, and collapses the comparison table into a single mechanism.

Renovate detects every ESPHome dependency in that repo, resolves the target, and has prepared the branches:

```text
docker.io/ptr727/esphome-nonroot 2025.12.7 → [Updates: 2026.8.2]   (.devcontainer.json)
esphome/esphome 2025.12.7                  → [Updates: 2026.8.2]   (.github/workflows/ci.yaml, regex manager)
```

Both sit under `## Pending Approval` as unchecked checkboxes. **No PR is opened not because nothing is asking, but because `dependencyDashboardApproval` stops the branch from ever being created.** The gate is inherited: `bfra-me/renovate-config#5.2.7`'s `default.json5` carries `matchUpdateTypes: ['major'] → extends: [':approveMajorUpdates']`, and `separateMajorMinor: false` in the repo's own package rule guarantees that *every* ESPHome bump — year rollover or not — lands in the `major` bucket that rule gates.

The corrected table:

| | [[marcusrbrown--esphome-life]] | [[marcusrbrown--ha-config]] |
| --- | --- | --- |
| Classification | `major` (via `separateMajorMinor: false`) | `major` (calver year rollover) |
| Gate | `dependencyDashboardApproval` — branch never created | automerge covers only `minor`/`patch` — PR created, never merged |
| Symptom | unchecked checkbox on the Dependency Dashboard | PR **#777**, open since 2026-05-14 |
| Visible where | issue #26 body | the PR list |
| Elapsed at 2026-09-14 | ~5.9 months | ~123 days |

So the two repos differ in **which surface the stall is parked on**, not in whether it is observable. Both are visible; only one is visible to an audit that counts open PRs. The 2026-08-30 row that read "Detectability: invisible — looks like upstream is quiet" was an artifact of the instrument, not a property of the configuration.

**Revised rules.** The 2026-08-30 generalization ("calendar-versioned upstreams and `versioning: loose` are a bad pairing") survives but for a different reason, and one clause is withdrawn:

1. **Withdrawn:** "loose versioning has no notion of a calver year rollover … the net effect is a rule that made bumps *invisible*." Loose versioning classifies the bump fine. It is `separateMajorMinor: false` that makes the classification `major`, and an inherited org preset that makes `major` mean "wait for a human."
2. **Stands, strengthened:** collapsing `separateMajorMinor`/`separateMinorPatch` on a calver dependency removes the incremental escape route *and* promotes the whole series into whatever policy the org applies to majors. On a fleet where majors are approval-gated by default, that single flag converts an automerging dependency into a permanently parked one. It is a two-token change with org-policy-level consequences, written locally by someone optimizing PR tidiness.
3. **New:** when a pin looks frozen under a live bot, **read the Dependency Dashboard body before concluding anything about detection**. Absence from the PR list and absence from the dashboard are different findings with different fixes — the first needs a policy decision, the second needs a custom manager.

### ESP Web Tools drift quantified (2026-09-14)

The untracked CDN pin has a number now. `static/index.md` still hand-writes `esp-web-tools@8.0.3`; upstream `esphome/esp-web-tools` latest is **10.4.0** (published 2026-07-15) — **two majors behind**, on the only artifact users' browsers execute.

This is the genuinely invisible case, and worth contrasting with the ESPHome pin directly: ESPHome appears in the dashboard's `Detected Dependencies` with a resolved target and a waiting checkbox; `esp-web-tools` appears **nowhere**, because no manager claims a markdown `<script src>`. One is a decision nobody made; the other is a dependency nobody declared. Filing them together — as the 2026-08-30 survey did under "invisible to Renovate" — hides the fact that they need different repairs.

## External Links

- [ESPHome Documentation](https://esphome.io/)
- [ESP Web Tools](https://esphome.github.io/esp-web-tools/)
- [esphome-project-template](https://github.com/esphome/esphome-project-template) — Template repository for ESPHome CI/CD
