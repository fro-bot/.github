---
type: repo
title: marcusrbrown/esphome.life
created: 2026-04-18
updated: 2026-09-14
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
  - url: https://github.com/marcusrbrown/esphome.life
    sha: 1c430cf5e81c615333c61e4b7be0664350ff733f
    accessed: 2026-07-12
  - url: https://github.com/marcusrbrown/esphome.life
    sha: 08ca7a9e68a3d071068407e4504bff97f8ab3e43
    accessed: 2026-08-01
  - url: https://github.com/marcusrbrown/esphome.life
    sha: 5fffe20526f0a29abfcb198a8b82330a90f7e621
    accessed: 2026-08-30
  - url: https://github.com/marcusrbrown/renovate-config
    sha: ea21e165a24d7154565e369dd916b9e33e16690b
    accessed: 2026-09-11
  - url: https://github.com/marcusrbrown/esphome.life
    sha: fd398954a17ea11c94c68f4f0708cd6356e65191
    accessed: 2026-09-14
  - url: https://github.com/bfra-me/.github
    sha: 0e881c39715f02ec987bfe61037fd38afee85e74
    accessed: 2026-09-14
  - url: https://github.com/marcusrbrown/renovate-config
    sha: baadb7bd39872f868644806793ff532503ffea41
    accessed: 2026-09-14
  - url: https://github.com/bfra-me/renovate-config
    sha: 8806d6b6ec8cd42b3b23c8bd926e9eb1e6a79fd3
    accessed: 2026-09-14
tags:
  - esphome
  - iot
  - esp32
  - bluetooth-proxy
  - home-assistant
  - firmware
  - github-pages
  - renovate
aliases:
  - esphome-life
  - esphome.life
related:
  - marcusrbrown--ha-config
  - marcusrbrown--renovate-config
  - marcusrbrown--github
  - bfra-me--github
  - bfra-me--renovate-action
  - bfra-me--ha-addon-repository
  - marcusrbrown--mothership
  - esphome
  - home-assistant
  - probot-settings
  - github-actions-ci
node_id: R_kgDOIZmGgg
---

# marcusrbrown/esphome.life

ESPHome device configuration repository for Marcus R. Brown's IoT devices. Forked from the [esphome-project-template](https://github.com/esphome/esphome-project-template), it builds firmware via CI and publishes a GitHub Pages site with [ESP Web Tools](https://esphome.github.io/esp-web-tools/) for browser-based flashing.

## Overview

- **Purpose:** ESPHome device firmware definitions, CI-built and deployed to GitHub Pages
- **Default branch:** `main`
- **Created:** 2022-11-09
- **Last push:** 2026-09-14 (HEAD `fd39895`, `chore(deps): update bfra-me/.github action to v4.29.0` #418)
- **Visibility:** Public (repo id `563709570`, not a fork)
- **License:** None specified
- **Description:** "Projects and configuration for my ESPHome devices"
- **Topics:** _(none set)_ · **Homepage:** _(unset)_ — the Pages site is not declared in repo metadata
- **Pages URL:** `https://mrbro.dev/esphome.life/` (recorded 2026-09-14) — `source` is `gh-pages:/`, `build_type: legacy`, `cname: null`, `https_enforced: true`. The project site inherits the **user-level** custom domain `mrbro.dev` rather than serving from `marcusrbrown.github.io`, which is why the repo has no CNAME of its own.
- **ESPHome version:** 2025.12.7 (pinned in CI workflow and devcontainer)
- **Stars / forks / watchers:** 2 / 0 / 2 (unchanged 2026-08-30 → 2026-09-14)
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
| `.cache/`                              | Bind-mount target for the devcontainer's `/cache` (only `.gitkeep` tracked) |
| `.github/`                             | Workflows, Renovate config, Probot settings                               |

The tracked tree is 17 blobs and is **byte-identical across the 2026-08-01 and 2026-08-30 surveys** (and, by path list, unchanged since at least 2026-04-21). At **2026-09-14** the path list is still 17 blobs and **exactly three blobs differ** from `5fffe20`: `.github/renovate.json5` (`c8f721a` → `075f67b`, preset `#5.2.12` → `#5.2.13`), `.github/workflows/renovate.yaml` (`06a3a2c` → `dfbc1e9`), and `.github/workflows/update-repo-settings.yaml` (`b759741` → `c28559e`) — both workflows carrying `bfra-me/.github` v4.22.0 → **v4.29.0**. Everything else, **including `ci.yaml` (`c63d2c9`)**, is byte-identical, so the ESPHome pin, the build matrix, and every CI action SHA are unchanged by construction rather than by inspection. `.gitignore` keeps `.cache/` alive with a three-line negation (`!.cache/` → `.cache/*` → `!.cache/.gitkeep`) so the devcontainer bind mount has a directory to land on.

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

All actions are SHA-pinned with version comments. As of 2026-08-30: `actions/checkout@v5.1.0` (SHA `fbc6f39`), `esphome/build-action@v7.4.0` (SHA `82ec6bd`), `actions/upload-artifact@v5.0.0` (SHA `330a01c`), `actions/create-github-app-token@v2.2.2` (SHA `fee1f7d`), `actions/download-artifact@v6.0.0` (SHA `018cc2c`), and **`JamesIves/github-pages-deploy-action@v4.9.0` (SHA `fa24774`, bumped from v4.8.0 on 2026-08-08 via #398)** — the first movement on the Pages deploy action across the survey series. ESPHome pin still `2025.12.7`.

Note the ESPHome runtime pin carries an inline Renovate datasource comment:

```yaml
version: 2025.12.7 # renovate: datasource=github-releases depName=esphome/esphome versioning=loose
```

Combined with the `versioning: loose` / `separateMajorMinor: false` package rule in `renovate.json5`, this is the mechanism that has held the runtime still while every action around it advances. See [[esphome]] for the drift analysis.

### Reusable Workflow Pins

Both `renovate.yaml` and `update-repo-settings.yaml` delegate to `bfra-me/.github` reusable workflows at **v4.29.0** (SHA `0e881c3`, 2026-09-14 via #418). Chain: v4.16.20 (2026-05-25) → v4.16.23 (2026-06-07) → v4.16.27 (2026-06-18) → v4.16.32 (2026-06-29) → v4.16.35 (2026-07-09) → v4.16.44 (2026-07-31) → v4.16.47 (2026-08-16) → v4.17.0 (08-17) → v4.17.1 → v4.18.0 → v4.19.0 → v4.20.0 → v4.21.0 → v4.22.0 (08-27) → **v4.23.0 (08-31) → v4.24.0 (09-03) → v4.25.0 (09-04) → v4.25.1 (09-04, manual) → v4.26.0 (09-07) → v4.27.0 (09-10) → v4.28.0 (09-14) → v4.29.0 (09-14)**.

Two observations on the tail of that chain. **v4.25.0 is the poisoned link** — see [The `tar` outage](#the-tar-outage-2026-09-04--the-second-repo-in-the-same-incident) below. And **v4.28.0 and v4.29.0 landed the same day** (upstream tagged them 2026-09-13T22:01 and 2026-09-14T07:01; this repo merged #417 at 01:15 and #418 at 08:48), so the ~3-day cadence the prior surveys recorded is not a floor.

At v4.29.0 the upstream reusable workflow itself pins `actions/checkout@v7.0.1` and `bfra-me/renovate-action@10.39.0`. This repo's own `ci.yaml` still pins `actions/checkout@v5.1.0` — **two majors behind the workflow it calls**, because the caller's checkout is approval-gated (below) and the callee's is not visible to this repo's Renovate at all.

**Cadence shift (new, 2026-08-30):** after ~47 patch releases inside the `v4.16.x` line, [[bfra-me--github]] crossed **six minor boundaries in eleven days** (#402–#408, 2026-08-17 → 08-27). This repo absorbed all six as ordinary automerge churn — consistent with the ecosystem-wide observation that the SHA-pin + Renovate model swallows minor and even major reusable-workflow bumps without any structural change downstream.

### The settings-sync footgun (eighth confirmation — fix confirmed, cost corrected)

`update-repo-settings.yaml` calls `bfra-me/.github/.github/workflows/renovate.yaml@v4.22.0` — the *Renovate* reusable workflow, under a workflow and job both named "Update Repo Settings." First noted 2026-05-26; reconfirmed 2026-06-07, 2026-06-18, 2026-06-29, 2026-07-12, 2026-08-01, and 2026-08-30.

Three findings added this survey:

1. **The correct target exists and is drop-in compatible.** `bfra-me/.github` ships `.github/workflows/update-repo-settings.yaml` at v4.22.0 with `on: workflow_call` and an identical secrets signature — `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY`, both `required: true`, **zero inputs**. The fix is a single-token path swap (`renovate.yaml` → `update-repo-settings.yaml`) in the `uses:` line. Nothing else in the caller changes. Prior surveys flagged the defect without establishing that a correct target was available; it is.

2. **The cost is measurable, not theoretical.** The Actions run history shows `Update Repo Settings` firing on the `23 12 * * *` cron *and* on every push to `main` — each run executing a full Renovate pass. So (a) `.github/settings.yml` is never applied by this repo's own automation, and (b) every merge to `main` triggers Renovate at least twice: once via the mislabeled settings workflow's `push` trigger, once via the real Renovate workflow's `workflow_run`-on-CI-success trigger. Roughly one extra full Renovate run per day plus one per merge, indefinitely.

3. **Renovate has been maintaining the misconfiguration for over a year.** The commit history for `update-repo-settings.yaml` is ≥100 commits deep and every sampled entry is a `chore(deps): update bfra-me/.github` bump; the oldest page reachable reaches `v4.0.9` on **2025-07-27** without hitting the introduction. SHA pinning validates the *ref*, not the *path* — so automation has faithfully kept a wrong `uses:` target current for ~13+ months. Generalized in [[github-actions-ci]].

Still a candidate for a follow-up PR; the diff is now fully specified.

**2026-09-11 — the fix is now demonstrated, not just available (from the source-side survey of [[marcusrbrown--renovate-config]] at `ea21e16`; this repo was not re-read).** Finding 1 above established that the correct upstream target exists. A sibling repo is running it in production: `marcusrbrown/renovate-config`'s `update-repo-settings.yaml` calls `bfra-me/.github/.github/workflows/update-repo-settings.yaml@v4.27.0` (SHA `4861d88`) with the same three triggers (`push` to `main`, `23 12` cron, dispatch), the same `APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` secrets block, and no inputs — byte-comparable to this repo's caller except for the one path token. The upstream workflow has also continued to exist and be maintained across five minor releases since v4.22.0, so it is not a transient. There is no remaining uncertainty about the target, the signature, or the trigger compatibility; the eighth confirmation of this footgun would be purely ceremonial.

**2026-09-14 — eighth confirmation, and the cost claim is corrected downward (and made sharper).** The `uses:` line is still `bfra-me/.github/.github/workflows/renovate.yaml@0e881c3 # v4.29.0`. Not ceremonial after all: reading the upstream workflow's step list produced a refinement and a genuinely new finding.

**Correction to finding 2 (2026-08-30).** That survey wrote that `Update Repo Settings` "executes a full Renovate pass … on every push to `main`," so "every merge runs Renovate twice." That is **nearly but not literally true**, and the mechanism matters. The upstream `renovate.yaml` carries a `dorny/paths-filter@v4.0.3` step gated on `if: github.event_name == 'push'`, with

```yaml
default_path_filters: "['.github/workflows/renovate.yaml', '.github/renovate.json5', 'internal.json5']"
```

and the `Renovate` step runs only when `steps.filter.outputs.changes == 'true'` (or the event is not `push`/`workflow_run`). So:

- On the daily `23 12` cron the filter step is **skipped** and the Renovate pass is **unconditional** — confirmed on run 1286 (2026-09-04 12:40, step 6 `skipped`, step 7 `success`).
- On `push` the pass fires only when the merged diff touched one of those three paths. Across the 14 most recent `push` runs of `Update Repo Settings`, **13 executed the Renovate step and exactly one skipped it** — run 1289, the push of PR #413, whose diff touched only `update-repo-settings.yaml`.

The new finding is in that exception. **The mislabeled workflow is invisible to the filter that the workflow it calls uses to decide whether to run.** `update-repo-settings.yaml` is not in `default_path_filters`, and the caller does not set the `path-filters` input the upstream workflow exposes. The practical consequence is an inversion: a merge that changes *only* the mis-pathed file is the one case that costs nothing, while every Renovate PR that touches `renovate.yaml` or `renovate.json5` — which is what Renovate's PRs in this repo almost always touch — triggers the duplicate pass. **The wrong workflow is self-triggering by construction:** the bot's own output is the input that makes the misconfiguration fire.

Measured over the survey window (2026-08-27 → 2026-09-14, run numbers 1275 → 1303): **29 `Update Repo Settings` runs, 28 of which executed a full Renovate pass**, none of which applied `.github/settings.yml`.

### Branch Protection

Required status checks on `main`: `Prepare`, `Build`, `Publish`, `Renovate / Renovate`. Strict status checks enabled. Linear history enforced. Admin enforcement enabled. No required PR reviews.

**Provenance note (2026-09-14):** the branch-protection endpoint returned `403 Resource not accessible by integration` for this survey's identity, so the values above are **carried forward from 2026-08-30 and were not re-verified**. They are consistent with observed behavior (every PR in the window shows the same four contexts and merges without review), but treat them as last-confirmed-2026-08-30 rather than current.

### Concurrency

CI workflow uses concurrency group `${{ github.workflow }}-${{ github.event.number || github.ref }}` with cancel-in-progress on non-main branches.

## The `tar` outage (2026-09-04) — the second repo in the same incident

On 2026-09-04 this repository was caught in the `bfra-me/renovate-action` **10.34.0** regression already recorded at [[marcusrbrown--github]] and [[bfra-me--renovate-action]]: the bundle left `tar` a devDependency, so Renovate exited before servicing any dependency **while still concluding `success`**. This is the second repo observed from the inside, and it produced the **first human commit here in 113 days**.

Timeline, all times UTC, all from the Actions run list and PR metadata:

| Time | Event |
| --- | --- |
| 13:23:43 | `bfra-me/renovate-action` **10.34.0** published upstream (the regression) |
| 16:18:57 | `bfra-me/.github` **v4.25.0** tagged, carrying 10.34.0 |
| 16:31:33 | Renovate opens **#411** (v4.25.0, both workflow files) — its last act before disabling itself |
| 16:35:43 | #411 merged; both callers now on the poisoned tag |
| 16:39:43 | Renovate `workflow_run` pass on the poisoned ref: job `success`, step `Renovate` `success` in 46 s, **zero PRs opened** |
| 18:27:48 | **10.34.1** published upstream — the fix exists |
| 20:52:07 | `bfra-me/.github` **v4.25.1** tagged — the fix becomes deliverable |
| 22:57:04 | `marcusrbrown` opens **#412** by hand: `+1/-1` in `renovate.yaml` only |
| 23:01:26 | #412 merged — **inert window ends at 6 h 25 m 43 s** |
| 23:05:10 | Renovate pass on the repaired ref: step `Renovate` runs **90 s** (vs 46 s poisoned) |
| 23:06:37 | Renovate opens **#413** for the remaining file — **5 m 11 s** after the fix merged |
| 23:10:19 | #413 merged; the mis-pathed caller finally leaves v4.25.0, **34 m 53 s** behind the real one |

PR #412's body states the loop in three lines: _"Takes bfra-me/renovate-action 10.34.1, which restores tar in the Renovate runtime. Renovate on 10.34.0 exits before servicing any dependencies, so this pin cannot self-update."_

Four things this repo adds that the first observation could not:

1. **It was a manual fleet sweep, not a per-repo discovery.** The sibling fix at [[marcusrbrown--github]] merged at 22:56; this one at 23:01:26 — **~5 minutes apart, same operator, same night, same branch-naming convention (`chore/bfra-me-github-v4.25.1`), same one-line diff.** The recovery cost scales with the number of affected repos and is paid entirely by a human walking the fleet, because by construction no affected repo could use its own automation to notice or to fix itself.

2. **Run duration does not discriminate either.** The obvious next monitor after "conclusion measures the harness, not the deliverable" is duration, and it fails here. The poisoned `Renovate` step took **46 s**; the 40 most recent healthy `workflow_run` passes span **~55–100 s** end-to-end and the immediately adjacent healthy steps took 62 s and 63 s. The poisoned run sits inside the normal band. A threshold tight enough to catch it would fire constantly on ordinary no-op passes, which is what most passes are in a 17-blob repo. **The only signal that separates the two is output** — PRs created, or the Dependency Dashboard's `updated_at` — exactly as [[github-actions-ci]] concluded from the other side.

3. **The settings-sync footgun doubled the blast radius and delayed full remediation.** Because `update-repo-settings.yaml` wrongly calls the *Renovate* reusable workflow, this repo had **two** callers of the poisoned tag where it should have had one. The human correctly fixed only the load-bearing one, which means the merge of the fix itself (23:01:29, run 1288) triggered `Update Repo Settings` on a ref still pinned to v4.25.0 and **executed one more full pass of the known-poisoned Renovate**, at the precise moment the operator believed the repo was repaired. Full remediation took a second PR and 34 m 53 s more. A mis-pathed `uses:` is normally a wasted-compute defect; during a supply-chain incident it is an extra copy of the compromised runner and an extra step in the recovery.

4. **Every human commit in this repo since 2024-11 has been a manual pin rescue.** The last five `marcusrbrown`-authored commits on `main` are `chore(ci): bump bfra-me/.github to v4.25.1` (2026-09-04), `ci(renovate): update marcusrbrown/renovate-config preset to 5.2.0` (2026-05-14), `ci(renovate): manually update @marcusrbrown/renovate-config to 4.2.0` (2025-07-25), `ci(renovate): modernize` (2025-06-02), and `chore(deps): replace token creation action and update Renovate config` (2024-11-30). Not one touches a device config, the CI build, or the site. **The human's entire remaining role in this repository is unsticking the updater** — which is a reasonable steady state for a 17-blob config repo, and also the reason a resident agent would have more leverage here than anywhere its absence has been noted (see Fro Bot Integration).

## Developer Tooling

- **Renovate:** Config lives in `.github/renovate.json5` (JSON5 with comments; surveys before 2026-08-01 observed a `renovate.json`). Extends [[marcusrbrown--renovate-config]] at **`#5.2.13`** (2026-09-05, #414; was `#5.2.12` at the prior survey). Custom package rule tracks ESPHome across Docker images (`ptr727/esphome-nonroot`, `esphome/esphome`, `ghcr.io/esphome/esphome`) with `versioning: loose`, `separateMajorMinor: false`, `separateMinorPatch: false`, `pinDigests: false`, and semantic commit types (`feat` for major/minor, `build` for patch). Post-upgrade runs `npx prettier@3.9.6` (advanced 3.9.4 → 3.9.6 via #381/#392).
- **Devcontainer:** Uses `docker.io/ptr727/esphome-nonroot:2025.12.7` with ESPHome dashboard, verbose logging, `America/Phoenix` timezone. Forwards port 6052 (ESPHome native API). VS Code extensions include ESPHome, PlatformIO, Python, YAML, EditorConfig, Markdown lint, serial monitor, and spell checker. File associations map `*.yaml`/`*.yml` to ESPHome language mode (with exceptions for workflow/settings files).
- **Probot Settings:** `.github/settings.yml` uses `_extends: .github:common-settings.yaml`. Overrides description and branch protection.
  - **Contradiction (noted 2026-07-12):** The bare `.github` short-form resolves to the **owner's** org/user `.github` repo — i.e. `marcusrbrown/.github:common-settings.yaml` (see [[marcusrbrown--github]]), not `fro-bot/.github`. Prior surveys (2026-04-21 → 2026-06-29) recorded this as extending `fro-bot/.github:common-settings.yaml`; the file itself has always written the un-prefixed `.github`, so the earlier attribution to `fro-bot/.github` was an over-read. The [[probot-settings]] inheritance chain for this repo runs through `marcusrbrown/.github`. This repo is still part of the Fro Bot-managed ecosystem by other signals (see Fro Bot Integration), but its settings-template ancestor is Marcus's personal `.github`, not the `fro-bot` org one.
- **EditorConfig:** UTF-8, LF, 2-space indent, 120-char max line, trailing whitespace trimming.
- **Prettier:** 120 print width, single quotes.
- **Git:** LF line endings enforced via `.gitattributes`. JSON files tagged as JSON-with-comments for linguist.

## The queue is on the dashboard, not the PR list (2026-09-14) — correction

**This supersedes the root-cause half of the 2026-08-30 ESPHome-drift finding, and qualifies the "zero-backlog queue" reading that has run since 2026-04.**

The 2026-08-30 survey concluded that the ESPHome pin is frozen because `versioning: loose` + `separateMajorMinor: false` leaves "Renovate no notion of a calver year rollover," making the update **invisible** — "no PR is ever opened," recorded as such here and in [[esphome]]. Reading the Dependency Dashboard (issue #26) body falsifies the invisibility claim. Renovate detects all three ESPHome dependencies and names the exact target version:

```text
.devcontainer.json      docker.io/ptr727/esphome-nonroot 2025.12.7 → [Updates: 2026.8.2]
.github/workflows/ci.yaml   esphome/esphome 2025.12.7            → [Updates: 2026.8.2]
```

and it has **already prepared the branches**, which sit under `## Pending Approval` as unchecked checkboxes:

- `feat(deps): update esphome/esphome to 2026.8.2`
- `feat(deps): update docker.io/ptr727/esphome-nonroot to 2026.8.2`
- `chore(deps): update actions/checkout action to v7`
- `chore(deps): update actions/create-github-app-token action to v3`
- `chore(deps): update esphome/build-action action to v8`
- `chore(deps): update GitHub Artifact Actions (major)` (`download-artifact`, `upload-artifact`)

**Corrected mechanism.** The freeze is a **governance stall, not a detection failure**, and it is composed across three repositories, none of which is individually wrong:

1. `ci.yaml` pins `esphome/esphome 2025.12.7` behind a `# renovate: datasource=github-releases depName=esphome/esphome versioning=loose` comment.
2. This repo's `.github/renovate.json5` sets `separateMajorMinor: false` and `separateMinorPatch: false` for the ESPHome package set — which folds *every* ESPHome bump, calver year rollover or not, into the `major` bucket.
3. [[marcusrbrown--renovate-config]] `#5.2.13` chains to `bfra-me/renovate-config#5.2.7`, whose `default.json5` applies `matchUpdateTypes: ['major'] → extends: [':approveMajorUpdates']`, i.e. `dependencyDashboardApproval: true` for all majors.

Net effect: **no ESPHome update in this repository can ever reach a PR without a human ticking a box**, and the box has been unticked for ~5.9 months. `versioning: loose` is not blinding Renovate; `separateMajorMinor: false` is routing a routine minor into the major approval gate. The earlier reading and this one agree on the config clauses involved and disagree on what they do — keep both dated.

**Consequence for the "zero-backlog queue" pattern.** "0 open PRs across every survey" remains factually true and has now been measuring the wrong surface for ten surveys. This repo is not in the drain-clean cohort with [[marcusrbrown--dev-like]]; it is in the approval-gated cohort with [[marcusrbrown--mothership]] and [[fro-bot--dashboard]] — **drained *and* blocked simultaneously**, at different severity tiers. Same mechanism [[bfra-me--ha-addon-repository]] taught for `prConcurrentLimit`, reached by a different gate. Recorded in [[github-actions-ci]] § *Zero Open PRs Can Mean Blocked, Not Clean*.

Second-order observations from the same dashboard read:

- **`esphome/build-action` v8.1.0 is available** against the pinned v7.4.0 — so the *build tooling* is now gated too, not just the runtime. The 2026-08-01 survey read `esphome/build-action` advancing while the runtime froze as evidence that "Renovate is clearly reaching this repo." It still is, but the tooling has now joined the runtime behind the same gate.
- **`actions/checkout` v7.0.1 and `actions/create-github-app-token` v3.2.0** are both gated while the upstream reusable workflow this repo calls already runs `actions/checkout@v7.0.1`. The caller is two majors behind its own callee.
- **`esp-web-tools` is upstream at 10.4.0** (released 2026-07-15) against the hand-written `@8.0.3` CDN pin in `static/index.md` — **two majors behind**, and it is the one dependency that is genuinely invisible, because nothing in the repo declares it. The dashboard's `Detected Dependencies` section lists 5 devcontainer/actions/regex/renovate-config sources and does not mention it. Contrast that with ESPHome: the gated pin is *listed and waiting*; the CDN pin is *not listed at all*. Those are different failure modes and the prior page conflated them under "invisible to Renovate."
- Renovate reports **no CVEs** on osv.dev for this repo.

## GitHub Pages Site

The repo deploys a static site to GitHub Pages using Jekyll (slate theme, `static/_config.yml` title "ESPHome Life"). The site provides a browser-based firmware installer via ESP Web Tools. The `manifest.json` is generated by CI from build artifacts and merged with the static site by the `Publish` job. `pages build and deployment` runs green on `gh-pages` after every merge to `main`.

The site content (`static/index.md`) is minimal — the upstream template placeholder text ("Add some information about your project here.") has not been customized.

**Untracked runtime dependency (new, 2026-08-30).** `static/index.md` loads the installer widget from a hand-written CDN URL inside the markdown body:

```html
<script type="module" src="https://unpkg.com/esp-web-tools@8.0.3/dist/web/install-button.js?module"></script>
```

This is the only runtime dependency the public-facing page has, and **nothing in the repo tracks it**: there is no `package.json`, the Renovate config declares no custom manager for markdown `<script src>` tags, and there is no SRI `integrity` attribute. So while Renovate keeps `bfra-me/.github`, the preset, Prettier, and every SHA-pinned action current on a near-daily cadence, the one dependency actually shipped to a browser is frozen at a version nobody is watching, fetched from a third-party CDN without subresource integrity. Low severity in absolute terms (the widget flashes firmware over WebSerial and the manifest is same-origin), but it is the exact inverse of the repo's otherwise meticulous supply-chain posture — every `uses:` is SHA-pinned; the thing users' browsers execute is not.

## Fro Bot Integration

**No Fro Bot agent workflow detected.** The repository does not contain a `fro-bot.yaml` workflow. Ecosystem membership is signaled by the shared `common-settings.yaml` inheritance and the `mrbro-bot[bot]` GitHub App automation, not by a `fro-bot/.github` settings extend (see the Probot Settings contradiction above — the settings ancestor resolves to `marcusrbrown/.github`).

A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage. This recommendation has been carried forward across **eleven** surveys (2026-04-18, 2026-04-21, 2026-04-23, 2026-05-26, 2026-06-07, 2026-06-18, 2026-06-29, 2026-07-12, 2026-08-01, 2026-08-30, 2026-09-14). The `.github/workflows/` directory still holds exactly three files: `ci.yaml`, `renovate.yaml`, `update-repo-settings.yaml`.

The case has strengthened: this survey produced three actionable, fully-specified items (the one-token settings-workflow path swap, the ~8-month ESPHome pin drift, the untracked `esp-web-tools` CDN pin) that a resident autoheal daemon would plausibly have surfaced months ago. Renovate is excellent at moving version numbers it has been told about; it is structurally incapable of noticing the ones it hasn't. This repo is the clearest instance in the fleet of **automation coverage mistaken for automation completeness** — 400+ green dependency PRs sitting on top of three defects that no `uses:` bump can reach.

**2026-09-14 sharpens the argument in two opposite directions, and both matter.**

*For:* the 2026-09-04 `tar` outage is the cleanest possible demonstration of the gap. For 6 h 25 m the repo's only automation was a no-op that reported `success`, and the thing that ended it was a human noticing from outside. Six approval-gated updates — including a runtime ~5.9 months and nine calver series stale — have been waiting on a checkbox in an issue nobody reads. Every one of those is a report an agent writes for free, and none of them is a code change requiring judgment.

*Against, and worth stating plainly:* an agent pinned to a shared `fro-bot/agent` ref would have been subject to the *same class* of failure it was being added to detect. The fleet has repeatedly recorded Fro Bot scheduled jobs failing green, failing silent, or being switched off by GitHub's 60-day inactivity rule in exactly the low-traffic repos this one resembles — see [[bfra-me--ha-addon-repository]] (17 consecutive silent failures) and [[marcusrbrown--cortexkit-anthropic-auth]] (`disabled_inactivity` on a repo with no pushes). Adding a second daemon that reports on the first only helps if the second one's output is delivered somewhere a human actually reads.

The honest recommendation is therefore narrower than "add `fro-bot.yaml`": **the highest-value change here is the one-token `uses:` path swap in `update-repo-settings.yaml`, which is a two-minute human edit with a fully specified diff and no new moving parts.** The agent workflow is the second-best item, and it should ship with an out-of-band delivery channel or it will inherit the failure mode it was hired to find.

## Notable Patterns

- **Package-based device configs:** Thin per-device YAML files pull shared configuration from a `packages/` directory via `github://` package imports. This is the standard ESPHome pattern for managing multiple devices with a shared base.
- **Partial CI coverage:** Only one of two device configs (`1349f4`) is built in CI. The `13451c` config is not in the build matrix.
- **Template heritage:** The repo was generated from `esphome/esphome-project-template`. Template artifacts remain in `docs/readme.md` and `static/index.md` without customization.
- **Ethernet-only devices:** All devices use ESP32-PoE-ISO with LAN8720 Ethernet — no Wi-Fi. This is notable for a Bluetooth Proxy setup where wired backhaul provides more reliable connectivity.
- **Git submodule consumer:** This repo is referenced as a submodule from [[marcusrbrown--ha-config]] at the `esphome/` path, linking ESPHome device firmware to the Home Assistant configuration.
- **Renovate-only commit log — broken once, by an outage (superseded 2026-09-14):** through 2026-08-30 every commit since the prior content change (2026-03-12) was a Renovate dependency bump, with the last human commit `2d315c2` (2026-05-14, Renovate preset v4 → 5.2.0). That ended on **2026-09-04** with `fd95b5b` (#412, `marcusrbrown`) — a **113-day** gap, and not a content change either: it is a manual pin rescue during the `tar` outage. The autopilot reading holds for device configs, CI, and the site (untouched since 2026-03-12, now ~6.1 months); it no longer holds as "no human commits." The 11 commits in the 2026-08-27 → 2026-09-14 window are 10 `mrbro-bot[bot]` bumps (#408–#411, #413–#418) plus that one human PR. HEAD is `fd39895` (bfra-me/.github → v4.29.0, #418).
- **Zero-backlog queue — the metric was measuring the wrong surface (corrected 2026-09-14):** 0 open PRs across every survey, still true at this one, and it does **not** mean drained. The Dependency Dashboard carries **six updates parked behind unchecked `Pending Approval` checkboxes**, including the ESPHome runtime. The prior placement of this repo in the drain-clean cohort with [[marcusrbrown--dev-like]] was an artifact of counting PRs instead of reading the dashboard; the correct cohort is [[marcusrbrown--mothership]] and [[fro-bot--dashboard]] — automerge on everything ungated, `dependencyDashboardApproval` on everything else. The original observation still holds for the *ungated* partition: a 17-blob config repo with a four-check gate drains trivially, and nothing in the window sat open more than a few hours.
- **Automation coverage ≠ automation completeness (refined 2026-09-14):** the three defects standing on this repo are invisible to Renovate for **three different reasons**, and the distinction is the useful part. The settings-workflow path is a wrong-but-valid `uses:` target — Renovate validates the ref, never the path. The `esp-web-tools@8.0.3` CDN pin has no manifest, so it is genuinely undetected and absent from the dashboard's `Detected Dependencies`. The ESPHome pin is **not invisible at all** — it is detected, resolved to `2026.8.2`, branch-prepared, and parked behind an approval checkbox. Only the first two are blind spots; the third is a governance stall wearing a blind spot's clothes, and the 2026-08-30 page filed all three together. A dependency bot measures the health of what it was pointed at, not the health of the repo — and its *dashboard*, not its PR list, is where it says so. Recorded in [[github-actions-ci]].
- **Open issues:** 3 open, unchanged across eight surveys — the Dependency Dashboard (Renovate, issue #26, opened 2024-02-22), the `Uplift esphome-life` meta-issue (#8, opened 2023-06-18, longstanding), and a community note about BPPLUG/Feit outdoor plugs (#298, opened 2025-12-10 — a passer-by leaving notes, not a bug report). Nothing has been opened *or* closed here since 2025-12. Note the asymmetry recorded 2026-09-14: #26's `updated_at` tracks every Renovate pass (2026-09-14T08:49), while #8 and #298 have `updated_at == created_at` — so the repo's only live issue is the bot's own scratchpad, and it is also the only place the six blocked updates are visible.

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
| 2026-07-12 | `1c430cf` | Dependency-only delta. `bfra-me/.github` v4.16.32 → v4.16.35 (SHA `aac0d9b`; #376/#379/#380 + intermediate v4.16.33/.34). Renovate preset `#5.2.3` → `#5.2.4` (#375). Prettier crossed 3.8 → 3.9 minor boundary, now 3.9.4 (#372/#373/#374/#377/#378). `esphome/build-action` (v7.3.0), ESPHome version (2025.12.7), all CI action SHAs, devcontainer image (`ptr727/esphome-nonroot:2025.12.7`), and Olimex device configs unchanged. `update-repo-settings.yaml` footgun reconfirmed (now `renovate.yaml@v4.16.35`) — fifth survey flagged, no patch. **Corrected long-standing Probot-settings misattribution:** `settings.yml` uses bare `_extends: .github:...`, which resolves to `marcusrbrown/.github`, not `fro-bot/.github` as prior surveys claimed. No Fro Bot workflow (eighth survey); open issues unchanged (#8 Uplift, #26 Dependency Dashboard, #298 BPPLUG note). |
| 2026-08-01 | `08ca7a9` | Dependency-only delta (19 Renovate bumps, #381–#395). **Two CI action bumps that had been static for months finally moved:** `esphome/build-action` v7.3.0 → **v7.4.0** (SHA `82ec6bd`, #385 bundle) and `actions/checkout` v5.0.1 → **v5.1.0** (SHA `fbc6f39`, #387). `bfra-me/.github` v4.16.35 → v4.16.44 (SHA `dd02bc5`; nine weekly releases). Renovate preset `#5.2.4` → `#5.2.9`. Prettier 3.9.4 → 3.9.6 (#381/#392). **Renovate config file is now `.github/renovate.json5`** (JSON5) — prior surveys observed `renovate.json`; the ESPHome-tracking package rule and `versioning: loose`/`separateMajorMinor: false` flags carry over unchanged. ESPHome pin (`2025.12.7`), devcontainer image, and Olimex device configs unchanged — the pin has now held across nine surveys (~4.6 months) despite upstream 2026.x releases. `update-repo-settings.yaml` footgun reconfirmed (now `renovate.yaml@v4.16.44`) — sixth survey flagged, no patch. No Fro Bot workflow (ninth survey); open issues unchanged (#8 Uplift, #26 Dependency Dashboard, #298 BPPLUG note). |
| 2026-08-30 | `5fffe20` | Dependency-only delta (13 Renovate bumps, #396–#408); **tracked tree byte-identical to `08ca7a9`** (17 blobs). `bfra-me/.github` v4.16.44 → **v4.22.0** (SHA `b830359`) — after ~47 `v4.16.x` patches, **six minor boundaries in eleven days** (#402–#408, 08-17 → 08-27), absorbed as ordinary automerge churn. `JamesIves/github-pages-deploy-action` v4.8.0 → **v4.9.0** (#398, first movement in the series). Renovate preset `#5.2.9` → **`#5.2.12`** (#396/#397). Prettier held at 3.9.6; `esphome/build-action` (v7.4.0), `actions/checkout` (v5.1.0), all other action SHAs, devcontainer image, `settings.yml`, `renovate.json5` package rule, and both Olimex device configs unchanged. ESPHome pin `2025.12.7` held for a **tenth** survey (~5.6 months) while upstream shipped **2026.8.1** (2026-08-23) — the pin is now ~8 months and nine minor series behind. **Three new findings:** (1) the settings-sync footgun has a **confirmed drop-in fix** — `bfra-me/.github` ships `.github/workflows/update-repo-settings.yaml` at v4.22.0 with `workflow_call` and an identical secrets signature (`APPLICATION_ID`/`APPLICATION_PRIVATE_KEY`, zero inputs), so the repair is a one-token path swap; (2) the footgun's cost is now **measured** — Actions history shows `Update Repo Settings` executing a full Renovate pass on the daily `23 12` cron *and* on every push to `main`, so `settings.yml` is never applied by this repo's automation and each merge runs Renovate twice; (3) the file's history is **≥100 commits deep, every one a Renovate bump of the wrong path**, reaching back to v4.0.9 on 2025-07-27 without hitting the introduction — SHA pinning validates the ref, not the path. Also newly recorded: `static/index.md` hand-pins `esp-web-tools@8.0.3` via an unpkg `<script type="module">` with no manifest, no Renovate custom manager, and no SRI — the one dependency shipped to browsers is the one nothing tracks. Seventh footgun confirmation; no Fro Bot workflow (tenth survey); 0 open PRs; open issues unchanged (#8, #26, #298); stars 2. |
| 2026-09-14 | `fd39895` | **First non-dependency interval in the series, and two standing claims are corrected.** Tree still 17 blobs; exactly **three** differ from `5fffe20` — both workflow files (`bfra-me/.github` v4.22.0 → **v4.29.0**, seven tags in 18 days, v4.28.0 and v4.29.0 the same day) and `renovate.json5` (preset `#5.2.12` → **`#5.2.13`**, #414). `ci.yaml` byte-identical, so ESPHome `2025.12.7`, the build matrix, and every CI action SHA are unchanged by construction. **(1) The `tar` outage.** #411 installed `bfra-me/.github` v4.25.0 at 16:35:43, carrying `bfra-me/renovate-action` 10.34.0 whose bundle left `tar` a devDependency; Renovate then exited before servicing any dependency while concluding `success` (16:39:43 pass: job green, step green, **zero PRs**). Upstream fixed at 18:27:48, tagged v4.25.1 at 20:52:07; `marcusrbrown` hand-merged **#412** (`+1/-1`, `renovate.yaml` only) at 23:01:26 — **inert window 6 h 25 m 43 s**, ~2 h 09 m of it after the fix was deliverable — and Renovate opened the follow-up **#413** for the remaining file **5 m 11 s** later. This is the **first human commit in 113 days** and the second repo observed inside the same fleet incident as [[marcusrbrown--github]] (fixed ~5 minutes earlier, same night, same branch name, same one-line diff — a manual fleet sweep). Three additions: **run duration does not discriminate** (poisoned step 46 s vs a 55–100 s healthy band); **the settings-sync footgun doubled the blast radius** — two callers of the poisoned tag instead of one, so the merge of the fix itself ran the known-poisoned Renovate once more and full remediation took 34 m 53 s longer; and **every human commit here since 2024-11 is a manual pin rescue** (5 of 5). **(2) ESPHome drift root cause corrected.** The 2026-08-30 claim that `versioning: loose` made the bump *invisible* is falsified — Dependency Dashboard #26 detects all three ESPHome deps, resolves them to **2026.8.2**, and parks the branches under `Pending Approval`. Real mechanism composes three repos: `separateMajorMinor: false` here folds every ESPHome bump into `major`, and `bfra-me/renovate-config#5.2.7` applies `:approveMajorUpdates` to all majors. A **governance stall, not a detection failure** — ~5.9 months on an unticked checkbox. **(3) "Zero-backlog queue" corrected**: 0 open PRs is still true and was measuring the wrong surface — **six approval-gated updates** wait on the dashboard (`esphome/esphome` + `ptr727/esphome-nonroot` 2026.8.2, `actions/checkout` v7, `create-github-app-token` v3, `esphome/build-action` v8, Artifact Actions major). Correct cohort is [[marcusrbrown--mothership]]/[[fro-bot--dashboard]], not [[marcusrbrown--dev-like]]. **(4) Settings-sync footgun, eighth confirmation, cost refined**: upstream `renovate.yaml` gates its Renovate step behind `dorny/paths-filter` with `['.github/workflows/renovate.yaml', '.github/renovate.json5', 'internal.json5']`, skipped on `schedule` — so the daily `23 12` duplicate pass is unconditional but the per-push one fires only on a filter match (**13 of 14** recent pushes; the sole skip was the push that touched *only* the mis-pathed file, which the filter does not list). 29 runs in the window, **28 executed a Renovate pass, none applied `settings.yml`**. Also: `esp-web-tools` upstream at **10.4.0** vs the pinned `8.0.3` (two majors, and the only dependency genuinely absent from the dashboard); Pages serves at `https://mrbro.dev/esphome.life/` via the user-level custom domain; branch protection **not re-verified** (403 for this survey's identity). No Fro Bot workflow (eleventh survey); 0 open PRs; open issues unchanged (#8, #26, #298); stars 2. |
