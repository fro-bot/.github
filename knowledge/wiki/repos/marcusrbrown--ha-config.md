---
type: repo
title: marcusrbrown/ha-config
created: 2025-06-18
updated: 2026-09-06
node_id: R_kgDOJ_bMaQ
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
  - url: https://github.com/marcusrbrown/ha-config
    sha: ba891877d05cc3afca6ac6fe46ecd2ac679fa5c7
    accessed: 2026-08-19
  - url: https://github.com/marcusrbrown/ha-config
    sha: 150e0597ef657ef60ce7c38b83cab743f3e5016b
    accessed: 2026-09-06
tags:
  - home-assistant
  - home-assistant-config
  - yaml
  - esphome
  - iot
  - renovate
  - break-glass
  - vendored-dependencies
aliases:
  - ha-config
related:
  - marcusrbrown--esphome-life
  - marcusrbrown--marcusrbrown
  - marcusrbrown--github
  - bfra-me--github
  - bfra-me--renovate-action
  - github-actions-ci
  - probot-settings
  - home-assistant
  - esphome
---

# marcusrbrown/ha-config

Marcus R. Brown's [[home-assistant]] configuration repository. Public, version-controlled Home Assistant setup with CI validation, custom components, and ESPHome device management via git submodule.

## Overview

- **Purpose:** Version-controlled Home Assistant configuration
- **Default branch:** `main`
- **Last push:** 2026-09-05 (`150e059`, `chore(deps): update esphome digest to 9b574b4` (#895))
- **Created:** 2023-07-25
- **`node_id`:** `R_kgDOJ_bMaQ` (repo id `670485609`)
- **HA version tracked:** 2025.6.3 (pinned in `.HA_VERSION`; unchanged since initial survey — now ~15 months stale). See _The `.HA_VERSION` Extraction Step Has Never Worked_ below: as of 2026-09-06 the pin **is** what CI validates against, but not for the reason the workflow implies.
- **Topics:** `home-assistant`, `home-assistant-config`
- **Stars:** 4 · **Watchers:** 4 · **Forks:** 0 · **License:** none detected
- **Open issues:** 1 (#427 Dependency Dashboard — confirmed still open 2026-09-06)
- **Open PRs:** 2 (`open_issues_count` 3). #777 esphome v2026 (open since 2026-05-14, **~114 days**) plus new **#896 `actions/checkout` v7** (opened 2026-09-04). Both carry the `major` label — the repo's Renovate config automerges only `minor`/`patch` pip updates, so majors park by construction. The parked set went 2 → 1 → 2 across the last two windows; #766 asyncio-mqtt merged 2026-08-15, #896 took its slot.
- _Correction (2026-06-10):_ Earlier surveys recorded "3 open issues, 0 open PRs" — #766 and #777 were PRs that GitHub's `open_issues_count` includes; #766 has now merged, so the count reflects #427 + #777 + #896.

## 2026-09-06 Survey — Three Findings

The tenth survey. The tree still does not move in any structural sense, but the interval contains the **first human commit observed on this repo across ten survey windows**, and two long-carried claims turn out to be wrong.

### 1. A Break-Glass Commit on a Self-Updating Updater

For ~6.5 hours on 2026-09-04, this repo's dependency bot could not update its own dependency bot. The timeline is exact:

| UTC | Actor | Commit | Effect |
| --- | --- | --- | --- |
| 16:35:03 | `mrbro-bot[bot]` | `7e96887` (#890) | Bumps `bfra-me/.github` → **v4.25.0** in *both* `renovate.yaml` and `update-repo-settings.yaml` |
| 22:59:12 | **`marcusrbrown`** (human) | `87d3f7f` (#891) | Bumps **only** `renovate.yaml` → **v4.25.1** |
| 23:07:30 | `mrbro-bot[bot]` | `3142c56` (#893) | Bumps the remaining file, `update-repo-settings.yaml`, → v4.25.1 |

The commit message states the mechanism plainly:

> Takes bfra-me/renovate-action 10.34.1, which restores tar in the Renovate runtime. Renovate on 10.34.0 exits before servicing any dependencies, so this pin cannot self-update.

This is the **bootstrap trap of a self-updating updater**: when the updater advances its own version pin, a bad version is unrecoverable *by the updater*. The bump that broke it was authored by the thing it broke. No amount of retry, rebase, or dashboard checkbox helps — the recovery path is necessarily out-of-band.

Two things this repo got right, worth copying:

- **The intervention was one line in one file** — precisely the file whose `uses:` ref runs Renovate. The human did not fix the whole repo; they restored the agent and let it finish. 8 minutes 18 seconds later the automation closed the remaining delta itself.
- **The commit message names the upstream version, the missing binary, and the failure mode.** A future reader asking "why is there a hand-authored version bump in a 100%-bot repo" gets the answer without archaeology.

The upstream carrier is [[bfra-me--renovate-action]] (`10.34.0` shipped a Renovate runtime missing `tar`), delivered here transitively through the `bfra-me/.github` reusable workflow. Every repo in the fleet consuming that reusable workflow was exposed to the same window; this is the one where the fix is recorded in the commit log. Generalized to [[github-actions-ci]].

### 2. The `.HA_VERSION` Extraction Step Has Never Worked

`ci.yaml`'s `check-home-assistant-config` job reads the pinned HA version like this:

```yaml
- name: 📦 Get Installed Version from `.HA_VERSION`
  id: ha_version
  run: |
    HA_VERSION=$(<.HA_VERSION)
    echo '{value}={$HA_VERSION}' >> $GITHUB_OUTPUT
- name: 🚀 Run Home Assistant Config Check
  uses: frenck/action-home-assistant@941d5d91... # v1.4.1
  with:
    secrets: include
    version: ${{ steps.ha_version.outputs.value }}
```

Two defects in one line. The single quotes prevent `$HA_VERSION` from ever expanding, and the key is written as `{value}`, not `value`. What lands in `$GITHUB_OUTPUT` is the literal string `{value}={$HA_VERSION}` — so `steps.ha_version.outputs.value` is **empty**, and the action receives `version: ''`.

The config check nonetheless validates against 2025.6.3, because `frenck/action-home-assistant@v1.4.1` independently implements the same lookup. Its `🏗 Determine & download requested Home Assistant version` step branches like this: if the `version` input is empty, read `$path/.HA_VERSION`; if that file is also absent, emit `::warning ::No specific version found or specified; Using 'stable' instead.` and fall back to `stable`. The `version` input is declared `required: false` with no default, precisely so this fallback is the normal path.

So the outcome is correct and the step is dead code. This is worse than a plain bug: **a downstream default silently compensating for an upstream defect produces green CI, correct behaviour, and no signal**. The step has presumably been broken since it was written. It only becomes visible the day the action drops its fallback, or the day someone needs `version` to differ from `.HA_VERSION` — at which point CI quietly starts validating against `stable`, i.e. against a Home Assistant release ~15 months newer than the one actually deployed, and the failure surfaces as a wall of unrelated config errors.

Detection rule: a `$GITHUB_OUTPUT` write is only meaningful if something reads it and *fails* when it is empty. Generalized to [[github-actions-ci]].

### 3. Renovate Writes to a Directory Two Other Tools Declare Foreign

`.pre-commit-config.yaml` opens with an explicit ownership disclaimer:

```yaml
# Always exclude files that are updated by Home Assistant
exclude: '^(custom_components/|www/|\.HA_VERSION)'
```

That is correct: `custom_components/` holds vendored third-party integrations that HACS overwrites wholesale on update. But Renovate's `homeassistant-manifest` manager is enabled by default and reads exactly that tree. The Dependency Dashboard (#427) confirms it tracks **six** vendored manifests:

| File | Tracked requirements |
| --- | --- |
| `custom_components/ble_monitor/manifest.json` | `pycryptodomex`, `janus`, `aioblescan`, `btsocket`, `pyric` |
| `custom_components/hacs/manifest.json` | `aiogithubapi` |
| `custom_components/mail_and_packages/manifest.json` | `Pillow` |
| `custom_components/sengledng/manifest.json` | `asyncio-mqtt` |
| `custom_components/solaredge_modbus_multi/manifest.json` | `pymodbus` |
| `custom_components/toyota_na/manifest.json` | `toyota-na` |

The long-parked **#766 (asyncio-mqtt v0.16.2), merged 2026-08-15, was one of these** — it edited `custom_components/sengledng/manifest.json`, a file the repo's own pre-commit config declares out of bounds. Two consequences:

1. **The edit is not durable.** The next HACS update to `sengledng` restores the upstream manifest, Renovate re-detects drift, and re-proposes. The pin has no owner.
2. **An integration's `manifest.json` `requirements` array is a claim about what upstream tested against**, not a lockfile the consumer is free to tighten. Bumping it makes Home Assistant install a version the integration author never exercised, and the resulting failure looks like an integration bug.

The clean fix is a Renovate `packageRules` entry disabling the `homeassistant-manifest` manager (or an `ignorePaths: ['custom_components/**']`) so the tool boundary matches the one pre-commit already declares. Filed as an observation, not a claim that it is broken today. Generalized to [[home-assistant]].

Related, same root: the dashboard now carries an **Abandoned Dependencies** section listing 7 entries, 6 of which are `homeassistant-manifest` transitives this repo cannot act on (`pyric` last released **2016-12-04**; `aioblescan` 2023-01-07). The one actionable entry is `pre-commit/pre-commit-hooks` (2025-08-09). Same Renovate feature first observed in [[bfra-me--ha-addon-repository]] on 2026-08-31 — it is now visibly rolling out across the fleet, and in a config repo most of what it flags is noise generated by a manager that should not be enabled.

## Corrections

- **`_extends` target (2026-09-06, corrects all prior surveys).** `.github/settings.yml` reads `_extends: .github:common-settings.yaml` — the **bare short-form**, which Probot resolves to the *owner's* `.github` repository, i.e. **`marcusrbrown/.github`** ([[marcusrbrown--github]]), **not** `fro-bot/.github`. Every survey from 2025-06 onward recorded "Extends `fro-bot/.github:common-settings.yaml`", and [[probot-settings]] carried ha-config as its worked example of a repo that extends the Fro Bot org template. Both were wrong; the literal file text has never carried an owner prefix. This is the *third* instance of the same misattribution class ([[marcusrbrown--esphome-life]] was corrected on 2026-07-12, [[marcusrbrown--dev-like]] recorded correctly on 2026-07-31), which means the error is systematic rather than incidental: an agent reading `_extends: .github:...` in a Fro-Bot-managed repo defaults to assuming the Fro Bot org. Verified 2026-09-06 by direct read of `settings.yml` at `150e059`. Practical consequence: ha-config inherits **Marcus's personal** governance posture (no required reviews), which is consistent with what its branch protection actually declares — `required_pull_request_reviews: null` — a detail that had been sitting in this page contradicting the inheritance claim above it.
- **`.HA_VERSION` staleness framing (2026-09-06, refines 2026-08-31 note in [[home-assistant]]).** The pin-drift footgun is real, but the mechanism recorded on the topic page implied `ci.yaml` feeds the pin to the action. It does not (see finding 2); the action reads the file itself. The observable behaviour is unchanged, the causal chain is not.

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
3. **Prettier** — Format check using Prettier 3.9.6 (diff-only on PRs via `creyD/prettier_action@v4.3`)
4. **Check Home Assistant Config** — Runs `frenck/action-home-assistant@v1.4.1` against the HA version in `.HA_VERSION` (depends on lint jobs)

### Branch Protection

Required status checks on `main`, verbatim from `.github/settings.yml`: `🧹 YAML Lint`, `🧹 Remark Lint`, `🧹 Prettier`, `🧪 Check Home Assistant Config`, `Renovate / Renovate`. `strict: true`, `enforce_admins: true`, `required_linear_history: true`, `required_pull_request_reviews: null`, `restrictions: null` — the checks-over-reviewers posture, consistent with the `marcusrbrown/.github` template it actually inherits (see Corrections). Note the check contexts carry emoji, so they must match the workflow job `name:` values character-for-character; renaming a job silently orphans the gate.

### Workflow Health (2026-09-06)

All three workflows report `state: active` (no `disabled_inactivity` — the daily `Update Repo Settings` cron plus constant Renovate pushes keep the 60-day shutoff clock reset, the failure mode that killed the scheduled daemon in [[marcusrbrown--cortexkit-anthropic-auth]] and [[bfra-me--ha-addon-repository]]). 4,341 total runs. In the last 40: CI 11 success / 1 cancelled, Renovate 16 success / 7 skipped (`issues: [edited]` no-ops), Update Repo Settings 5 success. Latest scheduled settings sync `2026-09-06T03:01:05Z`, `success`. Zero failures in the sampled window.

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github`. As of 2026-09-06 both are pinned to **v4.25.1** (SHA `b21f524ef9c4d3b06d2596abbdc799a975020849`), up from v4.18.0 — **seven minor boundaries in sixteen days** (#878 v4.19.0 → #881 v4.20.0 → #882 v4.21.0 → #884 v4.22.0 → #886 v4.23.0 → #888 v4.24.0 → #890 v4.25.0 → **#891 v4.25.1, hand-authored** → #893 v4.25.1). Prior window: v4.16.37 → v4.18.0 via #858 v4.16.44 → #865 v4.16.45 → #868 v4.16.46 → #870 v4.16.47 → #872 v4.17.0 → #874 v4.17.1 → #876 v4.18.0. Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

Worth stating because the fleet gets this wrong elsewhere: **both `uses:` refs here point at the correct upstream paths** — `bfra-me/.github/.github/workflows/renovate.yaml` and `bfra-me/.github/.github/workflows/update-repo-settings.yaml`. That is the counter-example to [[marcusrbrown--esphome-life]], where the settings-sync workflow has pointed at the *Renovate* reusable workflow for ≥100 Renovate-authored commits, so `settings.yml` is never applied. Same owner, same tag list, same secrets signature — the only thing distinguishing correct from broken is the path segment, and nothing in the toolchain validates it. Here it is right; there it is not; neither repo's CI can tell.

The CI workflow's own actions are all SHA-pinned with version comments: `actions/checkout` **v6.1.0** (four call sites), `frenck/action-yamllint` v1.5.0, `creyD/prettier_action` v4.3, `frenck/action-home-assistant` v1.4.1, plus a digest-pinned `docker://pipelinecomponents/remark-lint:latest@sha256:829aa31f…`. The `checkout` v7 major (#896) is parked. Note that `creyD/prettier_action` — the entire Prettier gate — is the same action flagged as **abandoned** by Renovate in [[bfra-me--ha-addon-repository]]; it is not flagged here because the `github-actions` datasource does not participate in this repo's abandonment listing, which is another way the same fact reaches two repos with different visibility.

### Renovate Trigger Model

The Renovate workflow uses a multi-trigger pattern:

- `issues: [edited]` and `pull_request: [edited]` — re-run when Renovate edits its own issues/PRs
- `push` to non-main branches — re-run on branch updates
- `workflow_dispatch` — manual trigger with configurable log level and print-config options
- `workflow_run` on CI completion — triggers Renovate after successful CI on main

This is the same event-driven Renovate pattern used in [[marcusrbrown--github]] and other Marcus repos, replacing the hourly cron schedule.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.13` as of 2026-09-06 (#897; was `#5.2.12`). Custom managers for `.pre-commit-config.yaml` (Python version + pip packages) and `mise.toml` (pre-commit via aqua). Git submodules enabled. Post-upgrade runs `npx prettier@3.9.6 --no-color --write .` — Prettier advanced 3.9.5 → 3.9.6 (#855), propagated to both the `ci.yaml` env and the post-upgrade task. Automerge on minor/patch pip updates only — which is why every parked PR in this repo's history carries the `major` label. ESPHome version updates are unseparated: a repo-local rule sets `separateMajorMinor: false` **and** `separateMinorPatch: false` for `esphome`, collapsing every pending release into one PR. Because ESPHome is calendar-versioned, `2025.12.7 → 2026.8.2` classifies as a **major**, so the entire nine-month jump must land as a single approval-gated change — #777, open ~114 days. This is the [[esphome]] calendar-versioning trap, but arriving by a different route than [[marcusrbrown--esphome-life]]: there the suppression comes from the shared preset's `versioning: loose` and the pin is invisible; here the repo opts into the suppression deliberately and the cost is at least *visible* as a parked PR. Visible-and-stuck beats invisible-and-stuck, but neither ships the upgrade. The `groupName: pre-commit` rule groups the `pre-commit` package updates together. A dedicated `'pre-commit'` block (`enabled: true`, `addLabels: [pre-commit]`) is now present in the config, elevating pre-commit hook management to an explicit first-class Renovate manager (the `.pre-commit-config.yaml` `pre-commit-hooks` rev is now tracked at v6.0.0).
- **Pre-commit:** Managed via `mise` (aqua, v4.6.2 — bumped from 4.6.0 via #857 v4.6.1 → #867 v4.6.2). Hooks: trailing whitespace, EOF fixer, double-quote string fixer, requirements-txt fixer, large file check, merge conflict check, TOML/YAML validation (`pre-commit-hooks` rev v6.0.0). Excludes `custom_components/`, `www/`, `.HA_VERSION`. Uses `--unsafe` YAML check to allow HA YAML extensions (`!include`, `!secret`, etc.).
- **Probot Settings:** `_extends: .github:common-settings.yaml` — the bare short-form, resolving to **`marcusrbrown/.github`** ([[marcusrbrown--github]]). Prior surveys recorded this as `fro-bot/.github`; see Corrections.
- **AI Rules:** `.cursorrules` defines HA-specific development conventions (YAML standards, package organization, security, testing).
- **Python deps:** `esphome==2025.12.7`, `yamllint==1.38.0` (in `requirements.txt`).
- **mise.toml:** Manages `pre-commit` tool version via aqua (`aqua:pre-commit/pre-commit = "4.6.2"`).

## Fro Bot Integration

**No Fro Bot workflow detected** (confirmed across ten consecutive surveys: 2025-06, 2026-04 ×2, 2026-05, 2026-06 ×2, 2026-07 ×2, 2026-08, 2026-09). The three workflows remain `ci.yaml`, `renovate.yaml`, and `update-repo-settings.yaml`; the GitHub Actions API confirms exactly three registered workflows, all `active`. The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration. **A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage** — per the standing survey directive, this remains the open action item on this repo.

Note that the earlier justification for the gap ("Marcus is treating ha-config as a Renovate-only autopilot repo, with no PR-review or triage agent needed since virtually all merges are bot-authored") is weaker after the 2026-09-06 survey. The v4.25.0 break-glass incident is precisely the class of event an autoheal agent exists to catch: a green-CI repo whose dependency bot had silently stopped servicing dependencies, detectable only by noticing the *absence* of expected Renovate activity. Marcus caught it in ~6.5 hours by hand. A scheduled agent watching for "no Renovate PR opened in N hours on a repo that averages more than one per day" would have caught it sooner and left a record. That is the concrete argument for onboarding here, and it is stronger than "review the PRs" — there are no human PRs to review.

The counter-argument, stated fairly: this repo has 4 stars, 0 forks, one human contributor, and no test suite beyond a config check. Adding a scheduled agent adds a daemon that itself needs watching. The gap has persisted for over a year; it is a deliberate posture, not an oversight.

Correction (2026-09-06): the claim that "the repo references `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem" is **wrong** — the `_extends` short-form resolves to `marcusrbrown/.github`. The repo's membership in the Fro-Bot-surveyed fleet is established by the survey dispatch and by `mrbro-bot[bot]`/`bfra-me` shared infrastructure, not by its settings inheritance.

### Authorship

`mrbro-bot[bot]` (GitHub ID 137683033) has authored effectively every merge since #790 (2026-05-28). The 2026-09-06 window (#876 → #895, 21 commits) breaks the streak for the first time: **20 `mrbro-bot[bot]`, 1 `marcusrbrown`** — commit `87d3f7f` (#891), the break-glass bump described above, committed via `web-flow` (GitHub web UI merge). Seven prior survey windows recorded 100% bot authorship. The exception proves the rule rather than ending it: the one thing that required a human was the one thing the bot structurally could not do to itself. No `fro-bot`-authored commits observed in any window.

## Notable Patterns

- **Package-based architecture:** Domain concerns are isolated into `packages/` YAML files rather than a monolithic config. This is the recommended HA pattern for complex setups.
- **IoT diversity:** The config spans Z-Wave, BLE (Bermuda trilateration), ESPHome, solar (SolarEdge Modbus), irrigation (B-Hyve), and connected vehicles (Toyota NA).
- **InfluxDB metrics:** Long-term data retention via InfluxDB, separate from the default HA recorder.
- **Multi-instance HA:** `remote_homeassistant` component suggests a multi-node HA deployment.
- **ESPHome as submodule:** Device configs live in a separate repo (`esphome.life`), linked via git submodule rather than copied.
- **Exclusively Renovate-driven activity:** Every commit across ten survey windows is a Renovate dependency bump, with exactly one exception — `87d3f7f` (#891, 2026-09-04), a hand-authored one-line bump to unstick Renovate itself. No structural or config change to the Home Assistant configuration has been observed since the initial 2025-06 survey. Fifteen months of commits; zero automations added, zero packages added, zero custom components added.
- **Vendored-artifact ownership conflict:** `custom_components/` is written by HACS, disclaimed by pre-commit, and edited by Renovate. Three tools, three ownership models, one directory. See finding 3.
- **Redundancy as defect-masking:** the `.HA_VERSION` extraction step in `ci.yaml` is broken and has no observable effect, because the action it feeds implements the same lookup independently. See finding 2.

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
| 2026-08-19 | `ba89187` | Mostly Renovate churn since prior survey (#849→#877, all `mrbro-bot[bot]`), but with one backlog thaw: **long-parked #766 asyncio-mqtt v0.16.2 finally MERGED** (2026-08-15) — first movement on either parked PR in ~7 windows, leaving #777 (esphome v2026) as the sole parked PR. **bfra-me/.github crossed a minor boundary v4.16.37 → v4.18.0** (dense chain #858 v4.16.44 → #870 v4.16.47 → #872 v4.17.0 → #874 v4.17.1 → #876 v4.18.0), Renovate preset `#5.2.7` → `#5.2.12` (#852/#860/#862), Prettier 3.9.5 → 3.9.6 (#855, propagated to `ci.yaml` env + post-upgrade `npx prettier@3.9.6`), `actions/checkout` → v6.1.0 (#851), mise pre-commit 4.6.0 → 4.6.2 (#857 v4.6.1, #867 v4.6.2), esphome submodule digest advanced ~ten times. **New renovate `'pre-commit'` block** (`enabled: true`, `addLabels: [pre-commit]`); `.pre-commit-config.yaml` rev v6.0.0. `.HA_VERSION` still 2025.6.3 (~14 months stale), `esphome==2025.12.7`, `yamllint==1.38.0`, 11 packages, 10 custom components, esphome submodule → `marcusrbrown/esphome.life` — all static. No structural drift. Still no Fro Bot workflow (ninth consecutive survey); `mrbro-bot[bot]` authorship durable across six windows. Open issues 1 (#427), open PRs 1 (#777), stars 4. |
| 2026-09-06 | `150e059` | **First human commit in ten survey windows.** 21 commits (#876→#895): 20 `mrbro-bot[bot]`, **1 `marcusrbrown`** — `87d3f7f` (#891), a one-line hand-authored bump of `renovate.yaml` to `bfra-me/.github` **v4.25.1**, because v4.25.0 shipped `bfra-me/renovate-action` 10.34.0 with a Renovate runtime missing `tar`; Renovate exited before servicing anything and **could not update its own pin**. 6h24m outage, human fix at 22:59:12Z, bot self-repaired the second file 8m18s later (#893). **bfra-me/.github v4.18.0 → v4.25.1** (seven minor boundaries in sixteen days: #878/#881/#882/#884/#886/#888/#890/#891/#893); Renovate preset `#5.2.12` → **`#5.2.13`** (#897); esphome submodule digest advanced ~10 times (#877→#895). **Two new findings:** (a) `ci.yaml`'s `.HA_VERSION` extraction step has *never* worked — `echo '{value}={$HA_VERSION}'` is single-quoted and mis-keyed, so `outputs.value` is empty; the correct version is used anyway only because `frenck/action-home-assistant` independently falls back to reading `.HA_VERSION`, i.e. a downstream default masking an upstream defect behind green CI; (b) Renovate's `homeassistant-manifest` manager writes to six vendored `custom_components/*/manifest.json` files that `.pre-commit-config.yaml` explicitly excludes as HA-owned — the merged #766 was one such edit, and it is not durable across a HACS update. New dashboard **Abandoned Dependencies** section (7 entries, 6 of them un-actionable `homeassistant-manifest` transitives; `pyric` last released 2016-12-04). **Correction:** `_extends: .github:common-settings.yaml` is the bare short-form resolving to **`marcusrbrown/.github`**, not `fro-bot/.github` — all prior surveys wrong, third instance of this misattribution class. Held: `.HA_VERSION` 2025.6.3 (~15 months), `esphome==2025.12.7` (upstream `2026.8.2`), `yamllint==1.38.0`, Prettier 3.9.6, mise pre-commit 4.6.2, `pre-commit-hooks` v6.0.0, `actions/checkout` v6.1.0, 11 packages, 10 custom components, 3 workflows. All workflows `active` and green (4,341 runs). Open issues 1 (#427), open PRs **2** (#777 esphome v2026 ~114d, new #896 checkout v7), stars 4, forks 0. Still no Fro Bot workflow (tenth consecutive survey). |
