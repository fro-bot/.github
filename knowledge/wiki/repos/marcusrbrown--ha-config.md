---
type: repo
title: marcusrbrown/ha-config
created: 2025-06-18
updated: 2026-09-21
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
  - url: https://github.com/marcusrbrown/ha-config
    sha: 35ed8b7920f1f0c14faafeff3c89e4eb74db649e
    accessed: 2026-09-21
tags:
  - home-assistant
  - home-assistant-config
  - yaml
  - esphome
  - iot
  - renovate
  - break-glass
  - vendored-dependencies
  - dependency-name-collision
  - git-submodules
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
- **Last push:** 2026-09-21T01:25:35Z (`35ed8b7`, `chore(deps): update esphome digest to 7f39a6f` (#912) — a subject that names the digest the commit **removes**; see finding 1)
- **Created:** 2023-07-25
- **`node_id`:** `R_kgDOJ_bMaQ` (repo id `670485609`)
- **Tree (2026-09-21):** 2,200 blobs / 74 trees / 1 submodule. 11 packages, 10 custom components, 3 workflows — the same shape as the 2025-06 survey. `custom_components/` alone is 2,125 of the 2,200 blobs (**96.6%**): by file count this is a vendored-integrations repo with a Home Assistant config attached. No root `README.md`, no `LICENSE` (first time recorded).
- **HA version tracked:** 2025.6.3 (pinned in `.HA_VERSION`; unchanged since initial survey — now ~15.5 months stale). See _The `.HA_VERSION` Extraction Step Has Never Worked_ below; re-read at `35ed8b7` on 2026-09-21 and **byte-identical** — the defect is unremediated and still invisible.
- **Topics:** `home-assistant`, `home-assistant-config`
- **Stars:** 4 · **Subscribers:** 2 · **Forks:** 0 · **License:** none detected
- **Open issues:** 1 (#427 Dependency Dashboard — confirmed still open 2026-09-21)
- **Open PRs:** 2 (`open_issues_count` 3), unchanged membership since 2026-09-06: **#777** esphome v2026 (opened 2026-05-14, **129 days**) and **#896** `actions/checkout` v7 (opened 2026-09-04, 16 days). Both carry the `major` label — the repo's Renovate config automerges only `minor`/`patch` pip updates, so majors park by construction. Both are `mergeable: true`, `mergeable_state: clean`, and were rebased onto the current `main` (`49ebb75`) on 2026-09-21 — **nothing blocks them but the absence of an approver.**
- _Correction (2026-06-10):_ Earlier surveys recorded "3 open issues, 0 open PRs" — #766 and #777 were PRs that GitHub's `open_issues_count` includes; #766 has now merged, so the count reflects #427 + #777 + #896.
- _Note (2026-09-21):_ prior pages recorded "Watchers: 4". That was `watchers_count`, which GitHub mirrors from stars. The real watcher count (`subscribers_count`) is **2**.

## 2026-09-21 Survey — One Dependency, Two Names, Three Wrong Commit Messages

The eleventh survey. 15 commits (`150e059` → `35ed8b7`), **all `mrbro-bot[bot]`** — the single-human-commit streak of the last window closed and did not repeat. Zero structural change: same 11 packages, same 10 custom components, same 3 workflows, `.HA_VERSION` untouched, `requirements.txt` untouched, `.pre-commit-config.yaml` untouched, `settings.yml` untouched. Workflow health is clean — 3 workflows all `active`, 4,446 lifetime runs (up from 4,341), **zero failures in the last 60 runs**.

And yet the dependency ledger on `main` is wrong in three places, for one reason.

### 1. `matchPackageNames` Is Not Scoped by Manager, and This Repo Has Two Different Things Named `esphome`

`.github/renovate.json5` carries this rule, present since before the first survey and described on this page for six windows as the [[esphome]] calendar-versioning accommodation:

```json5
{
  matchPackageNames: ['esphome'],
  separateMajorMinor: false,
  separateMinorPatch: false,
}
```

It was written for `esphome` the **PyPI package** in `requirements.txt` — the firmware toolchain — to collapse a nine-month calver jump into one approval. But this repo also has a **git submodule at path `esphome`** pointing at [[marcusrbrown--esphome-life]], and Renovate's `git-submodules` manager derives `depName` from the submodule **path**. Two managers, two entirely unrelated dependencies, one name. The rule matches both.

Three sibling rules in the same file *do* scope themselves with `matchManagers: ['pip_requirements']`. The one rule whose `depName` is ambiguous is the one that omits it. The correct idiom is already in the file, three times.

What this produces, measured on 2026-09-21:

| UTC | PR | Branch | Title / body claims | Diff actually does |
| --- | --- | --- | --- | --- |
| 01:13:16 → 01:19:52 | #911 | `renovate/all-minor-patch` | `bfra-me/.github` v4.30.0 → v4.31.0 — **one** row in the update table | 3 files: both workflow refs **plus** `esphome` submodule `78d2a19` → `7f39a6f` |
| 01:18:14 → 01:25:34 | #912 | `renovate/esphome-digest` | PR title at merge: `…to 76ae044` | `esphome` `7f39a6f` → `76ae044`; **merge-commit subject on `main` reads `…to 7f39a6f`** |

The submodule pin advanced **twice in 6 m 42 s across two PRs**, and neither commit on `main` describes what it did. Renovate wrote the bump into the grouped branch without declaring it, then opened a *second, dedicated* PR for the same dependency four minutes later; by the time that one merged, its stated target was already on `main`, so it re-resolved to the then-current upstream digest while keeping the subject written at branch creation.

Two corroborations that this is a real collision and not ordinary submodule drift:

- The five prior `renovate/all-minor-patch` merges in this window (#898, #900, #902, #904, #906) are **clean two-file diffs**. Submodule pointers do not drift on every rebase.
- Two CI runs were `cancelled` at 01:13:10 and 01:13:19 on `renovate/prettier-packages` and `renovate/all-minor-patch` — the `cancel-in-progress` concurrency group firing as both branches were rebuilt. The grouped branch was reconstructed at exactly the moment it acquired the submodule hunk.

**The general rule, and it is the mirror image of the [[fro-bot--agent]] 2026-09-20 Bun finding.** There, one value was extracted under two identities and a cap bound only one of them. Here, two values share one identity and a rule written for one governs both. Both are the same defect with the polarity flipped: **`matchPackageNames` matches a string, not a dependency.** Scope every package rule by `matchManagers` unless you have confirmed no other manager can produce that name — and a submodule path is the easiest way to produce a name you did not choose. Generalized to [[github-actions-ci]].

### 2. A Renovate Update Table Is Not a Diff Manifest — Which Refutes a Rule This Wiki Wrote Last Week

The 2026-09-20 entry in [[github-actions-ci]] concluded, from [[fro-bot--agent]]'s Bun branch, that "**`git log` is not a version ledger for bot branches** — only the diff or the PR body is authoritative."

The second half of that is now falsified. #911's body is machine-generated by Renovate, contains a structured `| Package | Type | Update | Change |` table, and that table has **exactly one row**: `bfra-me/.github`. The release notes section covers only `bfra-me/.github`. The diff changes three files. A reviewer reading the body approves a two-line workflow bump and merges a submodule pointer move into a different repository.

The table lists **what Renovate decided to update**, not **what the branch changes**. When a branch is rebuilt, anything the rebuild picks up rides along undeclared. Corrected rule: **only the diff is authoritative.** The PR body is a statement of intent generated before the branch was last reconstructed.

Third instance of the title-vs-diff class — after [[marcusrbrown--sparkle]] (autoheal widened its own override mid-flight, title stale) and [[fro-bot--agent]] (squash took the stale branch subject) — and the first where the **PR was right and the commit was wrong**. #912's live PR title reads `…to 76ae044` and is correct; the subject that landed in `git log` reads `…to 7f39a6f`. The ephemeral record is accurate and the durable one is not.

**Practical consequence for this repo:** `git log --oneline -- esphome` is not a ledger of the esphome pin. Two of the last three pin movements are misdescribed — one is invisible (buried in a commit about `bfra-me/.github`), one is inverted (names the value it removed). Asking "when did we pin `7f39a6f`?" returns the commit that deleted it. Use `git log -S<sha> -- esphome`, or read the tree.

**Method correction for this page.** Nine prior surveys reconstructed this repo's dependency history by reading Renovate commit subjects — the survey-history table below is largely built that way. That method is now known to be lossy here. The claims it produced are not retracted (they were individually plausible and the values in the tree agree), but the technique is downgraded: **subjects are a hint, the tree is the record.**

### 3. The Parked-PR Queue Is a Moving Target, and Its Age Measures the Decision, Not the Change

#777 — "update dependency esphome to v2026," open since 2026-05-14, 129 days — is not the PR that was opened in May.

- Its current payload is **`esphome==2026.9.0`**, a version released on **2026-09-16**. Renovate has retargeted it continuously; the change is five days old inside a 129-day-old request.
- Its diff is **two files, not one**: `requirements.txt` *and* the `esphome` submodule (`7f39a6f` → `76ae044`) — finding 1 reaching into the parked queue. Its `updated_at` is `2026-09-21T01:23:34Z`, landing it between #911's merge and #912's, which is why it currently carries a submodule hunk that #912 made redundant two minutes later. That hunk will vanish on the next rebase and reappear on the one after.

So the approval gate is inverted against its own purpose. Parking a `major` PR exists so a human can review a risky change before it lands. But a parked Renovate PR is rebased daily and its contents are replaced, so **whatever was reviewed on day 1 is not what merges on day 130** — and in this case the diff has grown a moving part that no title, body, or label mentions. The age of a parked Renovate PR is the age of the *unmade decision*; the code inside is always fresh. That is the opposite of the usual reading of a stale PR, and it is worse, because nothing rots visibly.

The standing cost is also asymmetric and quantifiable: #777 is `+2/-2`, `mergeable_state: clean`, green on all five required contexts. Holding it open costs a rebase and a CI cycle every day, indefinitely. Landing it costs two lines. 4,446 lifetime runs on a repo with no test suite is partly this.

### 4. The Vendored-Manifest Boundary Is Unremediated, and Its Cost Is Now Legible

Last survey proposed disabling Renovate's `homeassistant-manifest` manager (or `ignorePaths: ['custom_components/**']`) so the tool boundary would match the one `.pre-commit-config.yaml` already declares. Re-read at `35ed8b7`: **`renovate.json5` is unchanged.** No `ignorePaths`, no manager rule. The dashboard still tracks the same six vendored manifests.

What is new is the receipt. The Dependency Dashboard's **Abandoned Dependencies** section lists 7 entries, and one of them is **`asyncio-mqtt`, last released 2023-06-26** — the exact package that PR #766 spent roughly three months in the queue to pin to `0.16.2`, landing 2026-08-15 into `custom_components/sengledng/manifest.json`, a file HACS overwrites wholesale. The repo spent a quarter of queue time landing a pin to a package that had been dead for two years, into a file its own pre-commit config declares out of bounds, in an edit with no owner.

Six of the seven abandoned entries are `homeassistant-manifest` transitives this repo cannot act on (`pyric` last released **2016-12-04**). The only actionable one is `pre-commit/pre-commit-hooks` (2025-08-09). **A manager that should not be enabled generates most of the noise in the one dashboard section designed to surface real risk.** Generalized to [[home-assistant]].

### 5. Minor: a Lockfile-Maintenance Branch in a Repo With No Lockfile

New on the dashboard since the last survey, under **Other Branches**: `renovate/lock-file-maintenance` — "chore(deps): maintain lockfiles." This repo has no lockfile. No `package.json`, no `pnpm-lock.yaml`, no `poetry.lock`, no `requirements.lock`; `requirements.txt` is two hand-pinned lines. The entry is inherited from the shared preset chain ([[marcusrbrown--renovate-config]] → `bfra-me/renovate-config`) and has no surface to act on here.

Harmless, and worth recording for one reason: the same `lock-file-maintenance` cron is what accidentally unstuck [[marcusrbrown--marcusrbrown-com]]'s twelve-day merge freeze on 2026-09-16. The same inherited job is load-bearing in one repo and vestigial in another, and neither repo declares which.

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

### Workflow Health (2026-09-21)

All three workflows report `state: active` (no `disabled_inactivity` — the daily `Update Repo Settings` cron plus constant Renovate pushes keep the 60-day shutoff clock reset, the failure mode that killed the scheduled daemon in [[marcusrbrown--cortexkit-anthropic-auth]] and [[bfra-me--ha-addon-repository]]). **4,446 total runs** (4,341 on 2026-09-06 — 105 runs in 15 days, ~7/day on a repo with no test suite). In the last 60: CI 13 success / 5 push-success / **2 cancelled**, Renovate 15 push-success / 5 `workflow_run`-success / 2 PR-success / 9 `issues` **skipped** (the `issues: [edited]` no-op storm, at this repo's modest scale), Update Repo Settings 5 push-success / 4 schedule-success. Latest scheduled settings sync `2026-09-21T03:01:09Z`, `success`. **Zero failures.**

The two cancellations are not noise — they are timestamped `2026-09-21T01:13:10Z` (`renovate/prettier-packages`) and `2026-09-21T01:13:19Z` (`renovate/all-minor-patch`), the `cancel-in-progress` concurrency group firing as Renovate rebuilt both branches. That nine-second window is the fingerprint of the branch reconstruction described in finding 1. A cancelled run is usually dismissed as scheduling churn; here it is the only timestamp in the Actions log that marks when an undeclared change entered a PR.

_Prior (2026-09-06):_ 4,341 total runs; in the last 40, CI 11 success / 1 cancelled, Renovate 16 success / 7 skipped, Update Repo Settings 5 success; zero failures.

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github`. As of 2026-09-21 both are pinned to **v4.31.0** (SHA `e18183848810ab5ba10114c4fa29041f9d5ba35d`), up from v4.25.1 — **six more minor boundaries in sixteen days** (#898 v4.26.0 → #900 v4.27.0 → #902 v4.28.0 → #904 v4.29.0 → #906 v4.30.0 → #911 v4.31.0), every one of them an automerged `renovate/all-minor-patch` commit. The v4.31.0 release notes enumerate seven `bfra-me/renovate-action` bumps (10.42.1 → 10.47.0) folded into a single downstream minor — the [[bfra-me--renovate-action]] engine churn arriving here as one line. The five before #911 are clean two-file diffs; **#911 is the one that also moved the submodule** (finding 1).

_Prior (2026-09-06):_ pinned to v4.25.1 (SHA `b21f524ef9c4d3b06d2596abbdc799a975020849`), up from v4.18.0 — **seven minor boundaries in sixteen days** (#878 v4.19.0 → #881 v4.20.0 → #882 v4.21.0 → #884 v4.22.0 → #886 v4.23.0 → #888 v4.24.0 → #890 v4.25.0 → **#891 v4.25.1, hand-authored** → #893 v4.25.1). Prior window: v4.16.37 → v4.18.0 via #858 v4.16.44 → #865 v4.16.45 → #868 v4.16.46 → #870 v4.16.47 → #872 v4.17.0 → #874 v4.17.1 → #876 v4.18.0. Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

Worth stating because the fleet gets this wrong elsewhere: **both `uses:` refs here point at the correct upstream paths** — `bfra-me/.github/.github/workflows/renovate.yaml` and `bfra-me/.github/.github/workflows/update-repo-settings.yaml`. That is the counter-example to [[marcusrbrown--esphome-life]], where the settings-sync workflow has pointed at the *Renovate* reusable workflow for ≥100 Renovate-authored commits, so `settings.yml` is never applied. Same owner, same tag list, same secrets signature — the only thing distinguishing correct from broken is the path segment, and nothing in the toolchain validates it. Here it is right; there it is not; neither repo's CI can tell.

The CI workflow's own actions are all SHA-pinned with version comments: `actions/checkout` **v6.1.0** (four call sites), `frenck/action-yamllint` v1.5.0, `creyD/prettier_action` v4.3, `frenck/action-home-assistant` v1.4.1, plus a digest-pinned `docker://pipelinecomponents/remark-lint:latest@sha256:829aa31f…`. All unchanged at `35ed8b7`; the `checkout` v7 major (#896, upstream now `v7.0.1`) is still parked. Note that `creyD/prettier_action` — the entire Prettier gate — is the same action flagged as **abandoned** by Renovate in [[bfra-me--ha-addon-repository]]; it is not flagged here because the `github-actions` datasource does not participate in this repo's abandonment listing, which is another way the same fact reaches two repos with different visibility.

### Renovate Trigger Model

The Renovate workflow uses a multi-trigger pattern:

- `issues: [edited]` and `pull_request: [edited]` — re-run when Renovate edits its own issues/PRs
- `push` to non-main branches — re-run on branch updates
- `workflow_dispatch` — manual trigger with configurable log level and print-config options
- `workflow_run` on CI completion — triggers Renovate after successful CI on main

This is the same event-driven Renovate pattern used in [[marcusrbrown--github]] and other Marcus repos, replacing the hourly cron schedule.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.13` — **held** across this window (last moved 2026-09-05, #897). Custom managers for `.pre-commit-config.yaml` (Python version + pip packages) and `mise.toml` (pre-commit via aqua). `'git-submodules': { enabled: true }` with no schedule, so every upstream commit in [[marcusrbrown--esphome-life]] produces a PR here — and since that repo is itself Renovate-driven, this repo's churn is a **bot chain**: one dependency bot's merges are another's inbox. Post-upgrade runs `npx prettier@3.9.8 --no-color --write .` — Prettier advanced 3.9.6 → 3.9.7 (#908) → **3.9.8** (#910), propagated in the same commit to both the `ci.yaml` `PRETTIER_VERSION` env and the `postUpgradeTasks` command, which is the coupled-constant pattern done right: one Renovate change, both call sites. Automerge on minor/patch pip updates only — which is why every parked PR in this repo's history carries the `major` label. ESPHome version updates are unseparated: a repo-local rule sets `separateMajorMinor: false` **and** `separateMinorPatch: false` for `esphome`, collapsing every pending release into one PR. Because ESPHome is calendar-versioned, `2025.12.7 → 2026.8.2` classifies as a **major**, so the entire nine-month jump must land as a single approval-gated change — #777, open ~114 days. This is the [[esphome]] calendar-versioning trap, but arriving by a different route than [[marcusrbrown--esphome-life]]: there the suppression comes from the shared preset's `versioning: loose` and the pin is invisible; here the repo opts into the suppression deliberately and the cost is at least *visible* as a parked PR. Visible-and-stuck beats invisible-and-stuck, but neither ships the upgrade. **2026-09-21 addendum:** that same rule is unscoped by manager, so it also matches the `esphome` git submodule — see finding 1. The accommodation written to make one dependency legible is the mechanism that made a second one illegible. The `groupName: pre-commit` rule groups the `pre-commit` package updates together. A dedicated `'pre-commit'` block (`enabled: true`, `addLabels: [pre-commit]`) is now present in the config, elevating pre-commit hook management to an explicit first-class Renovate manager (the `.pre-commit-config.yaml` `pre-commit-hooks` rev is now tracked at v6.0.0).
- **Pre-commit:** Managed via `mise` (aqua, v4.6.2 — bumped from 4.6.0 via #857 v4.6.1 → #867 v4.6.2). Hooks: trailing whitespace, EOF fixer, double-quote string fixer, requirements-txt fixer, large file check, merge conflict check, TOML/YAML validation (`pre-commit-hooks` rev v6.0.0). Excludes `custom_components/`, `www/`, `.HA_VERSION`. Uses `--unsafe` YAML check to allow HA YAML extensions (`!include`, `!secret`, etc.).
- **Probot Settings:** `_extends: .github:common-settings.yaml` — the bare short-form, resolving to **`marcusrbrown/.github`** ([[marcusrbrown--github]]). Prior surveys recorded this as `fro-bot/.github`; see Corrections.
- **AI Rules:** `.cursorrules` defines HA-specific development conventions (YAML standards, package organization, security, testing).
- **Python deps:** `esphome==2025.12.7`, `yamllint==1.38.0` (in `requirements.txt`, byte-identical at `35ed8b7`). `yamllint` is **current** (PyPI latest 1.38.0, verified 2026-09-21) — so the file is not neglected; exactly one of its two lines is version-gated. `esphome` upstream is **2026.9.0** (released 2026-09-16), which is what parked PR #777 now proposes.
- **Naming hazard worth stating plainly:** the token `esphome` denotes three different things in this repo — a PyPI package in `requirements.txt`, a git submodule path resolving to `marcusrbrown/esphome.life`, and a Renovate `matchPackageNames` entry that (unintentionally) governs both. A survey, a reviewer, or a package rule that does not disambiguate will get it wrong; finding 1 is what happens when a package rule doesn't.
- **mise.toml:** Manages `pre-commit` tool version via aqua (`aqua:pre-commit/pre-commit = "4.6.2"`).

## Fro Bot Integration

**No Fro Bot workflow detected** (confirmed across **eleven** consecutive surveys: 2025-06, 2026-04 ×2, 2026-05, 2026-06 ×2, 2026-07 ×2, 2026-08, 2026-09 ×2). The three workflows remain `ci.yaml`, `renovate.yaml`, and `update-repo-settings.yaml`; the GitHub Actions API confirms exactly three registered workflows, all `active`. The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration. **A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review and triage** — per the standing survey directive, this remains the open action item on this repo.

2026-09-21 sharpens the case again, and this time it is not about catching an outage. Every finding in this survey is a **silent-correctness** problem: a commit subject that names the wrong digest, a PR body that omits a file, a package rule matching a dependency nobody meant it to match, a 129-day-old approval request whose contents were replaced without notice. None of them turn CI red — the repo ran 105 runs with zero failures through all of it. None of them are detectable by watching for absence, which was the 2026-09-06 argument. They are detectable only by **something that reads a diff and compares it to what the diff claims to be** — which is the one thing a PR-review agent does and no status check does. This repo has no human PRs to review, but it has ~7 bot PRs a day, none reviewed by anything, on a config that controls physical locks, doors, and a Z-Wave network.

The counter-argument, unchanged and still fair: 4 stars, 0 forks, one human contributor, no test suite beyond a config check. A scheduled agent is a daemon that itself needs watching — and this wiki has documented plenty of those going dark unnoticed ([[marcusrbrown--cortexkit-anthropic-auth]], [[marcusrbrown--marcusrbrown-com]]). The gap has persisted for over a year; it is a deliberate posture, not an oversight.

Note (2026-09-06) that the earlier justification for the gap ("Marcus is treating ha-config as a Renovate-only autopilot repo, with no PR-review or triage agent needed since virtually all merges are bot-authored") is weaker after that survey. The v4.25.0 break-glass incident is precisely the class of event an autoheal agent exists to catch: a green-CI repo whose dependency bot had silently stopped servicing dependencies, detectable only by noticing the *absence* of expected Renovate activity. Marcus caught it in ~6.5 hours by hand. A scheduled agent watching for "no Renovate PR opened in N hours on a repo that averages more than one per day" would have caught it sooner and left a record. That is the concrete argument for onboarding here, and it is stronger than "review the PRs" — there are no human PRs to review.

Correction (2026-09-06): the claim that "the repo references `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem" is **wrong** — the `_extends` short-form resolves to `marcusrbrown/.github`. The repo's membership in the Fro-Bot-surveyed fleet is established by the survey dispatch and by `mrbro-bot[bot]`/`bfra-me` shared infrastructure, not by its settings inheritance.

### Authorship

`mrbro-bot[bot]` (GitHub ID 137683033) has authored effectively every merge since #790 (2026-05-28). The 2026-09-06 window (#876 → #895, 21 commits) broke the streak for the first time: **20 `mrbro-bot[bot]`, 1 `marcusrbrown`** — commit `87d3f7f` (#891), the break-glass bump described above, committed via `web-flow` (GitHub web UI merge). Seven prior survey windows recorded 100% bot authorship. The exception proved the rule rather than ending it: the one thing that required a human was the one thing the bot structurally could not do to itself.

The 2026-09-21 window (#897 → #912, 15 commits) is back to **100% `mrbro-bot[bot]`** — the break-glass commit was a one-off response to an upstream incident, not the start of human involvement. No `fro-bot`-authored commits observed in any window, across eleven surveys.

Commit cadence is worth recording because it explains the collision in finding 1: merges arrive in **tight same-minute clusters**, almost always a `bfra-me/.github` bump followed 2–6 minutes later by an `esphome` digest bump, in a 01:09–01:26 UTC band. Fifteen commits over sixteen days, eight of them paired. Renovate services multiple branches inside one pass, and when two of those branches claim the same dependency (finding 1), the ordering inside that window decides which one gets it.

## Notable Patterns

- **Package-based architecture:** Domain concerns are isolated into `packages/` YAML files rather than a monolithic config. This is the recommended HA pattern for complex setups.
- **IoT diversity:** The config spans Z-Wave, BLE (Bermuda trilateration), ESPHome, solar (SolarEdge Modbus), irrigation (B-Hyve), and connected vehicles (Toyota NA).
- **InfluxDB metrics:** Long-term data retention via InfluxDB, separate from the default HA recorder.
- **Multi-instance HA:** `remote_homeassistant` component suggests a multi-node HA deployment.
- **ESPHome as submodule:** Device configs live in a separate repo (`esphome.life`), linked via git submodule rather than copied.
- **Exclusively Renovate-driven activity:** Every commit across eleven survey windows is a Renovate dependency bump, with exactly one exception — `87d3f7f` (#891, 2026-09-04), a hand-authored one-line bump to unstick Renovate itself. No structural or config change to the Home Assistant configuration has been observed since the initial 2025-06 survey. Fifteen-plus months of commits; zero automations added, zero packages added, zero custom components added.
- **Vendored-artifact ownership conflict:** `custom_components/` is written by HACS, disclaimed by pre-commit, and edited by Renovate. Three tools, three ownership models, one directory — and it is **96.6% of the repo by file count**. See 2026-09-06 finding 3; unremediated as of 2026-09-21.
- **Redundancy as defect-masking:** the `.HA_VERSION` extraction step in `ci.yaml` is broken and has no observable effect, because the action it feeds implements the same lookup independently. See 2026-09-06 finding 2; byte-identical and still broken as of 2026-09-21.
- **A dependency name is not a dependency:** `esphome` names a PyPI package, a submodule path, and a Renovate package rule that governs both. The repo's own config file demonstrates the fix three times (`matchManagers`) and omits it on the fourth rule. See 2026-09-21 finding 1.
- **Only the diff is authoritative:** across three commits on 2026-09-21, the commit subject, the PR title, and the machine-generated PR update table each described a change incorrectly — in different directions. See 2026-09-21 finding 2.
- **Parked PRs are moving targets:** a `major`-labelled PR held for review is rebased and retargeted daily, so its age measures an unmade decision while its contents stay fresh — and can silently acquire files nobody reviewed. See 2026-09-21 finding 3.

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
| 2026-09-21 | `35ed8b7` | **Back to 100% bot authorship; the dependency ledger on `main` is wrong in three places for one reason.** 15 commits (#897→#912), all `mrbro-bot[bot]`, arriving in tight 01:09–01:26 UTC pairs. Zero structural change: 11 packages, 10 custom components, 3 workflows, 2,200 blobs (**96.6% of them under `custom_components/`**), no root README or LICENSE. **Finding 1 — `matchPackageNames: ['esphome']` is unscoped by manager**, and this repo has a PyPI package *and* a git submodule path both named `esphome`; the rule written to collapse ESPHome's calver releases governs both (three sibling rules in the same file correctly use `matchManagers`; the one ambiguous rule omits it). Result on 2026-09-21: the submodule pin advanced **twice in 6m42s across two PRs** — #911 (`renovate/all-minor-patch`, title and machine-generated body table declare only `bfra-me/.github` v4.30.0→v4.31.0) silently carried `esphome` `78d2a19`→`7f39a6f` as a third file; #912 then moved `7f39a6f`→`76ae044` under the merge-commit subject `update esphome digest to 7f39a6f` — naming the digest it **removed**. Corroborated by two CI runs `cancelled` at 01:13:10/01:13:19 (the concurrency group firing as both branches were rebuilt) and by the five prior `all-minor-patch` merges (#898/#900/#902/#904/#906) all being clean two-file diffs. Mirror image of the [[fro-bot--agent]] 2026-09-20 Bun cap (one value, two identities → two values, one identity). **Finding 2 — only the diff is authoritative**, refuting the 2026-09-20 [[github-actions-ci]] rule that "the diff *or the PR body*" is: Renovate's update table states what it decided to update, not what the branch changes. Third title-vs-diff instance, and the first where the **PR was right and the commit was wrong**. `git log --oneline -- esphome` is not a ledger of the esphome pin (one movement invisible, one inverted); **method correction** — nine prior surveys reconstructed history from commit subjects, a technique now downgraded to a hint. **Finding 3 — parked PRs are moving targets**: #777 (129 days) is `mergeable/clean`, `+2/-2`, rebased daily, currently proposing `esphome==2026.9.0` (released 5 days ago) *and* carrying a submodule hunk; its age measures an unmade decision, not a stale change, so nothing reviewed on day 1 is what would merge on day 130. **Finding 4 —** the `homeassistant-manifest` remediation proposed 2026-09-06 was **not applied** (`renovate.json5` unchanged), and the dashboard now flags `asyncio-mqtt` (last release 2023-06-26) as abandoned — the exact package #766 spent ~3 months landing into a HACS-owned file. **Finding 5 —** new `renovate/lock-file-maintenance` pending branch in a repo with no lockfile (inherited preset; the same job that unstuck [[marcusrbrown--marcusrbrown-com]]'s merge freeze). **Held:** `.HA_VERSION` 2025.6.3 (~15.5 months) with the broken extraction step byte-identical, `esphome==2025.12.7`, `yamllint==1.38.0` (current), mise pre-commit 4.6.2, `pre-commit-hooks` v6.0.0, `actions/checkout` v6.1.0, preset `#5.2.13`, `settings.yml` unchanged. **Moved:** `bfra-me/.github` v4.25.1 → **v4.31.0** (six minors: #898/#900/#902/#904/#906/#911), Prettier 3.9.6 → 3.9.7 (#908) → **3.9.8** (#910, propagating to both call sites in one commit), esphome submodule digest ~8 times. All workflows `active`, **4,446 runs, zero failures in the last 60**. Open issues 1 (#427), open PRs 2 (#777 129d, #896 16d — both `clean`), stars 4, subscribers **2** (prior "Watchers: 4" was `watchers_count`, which mirrors stars), forks 0. Still no Fro Bot workflow (**eleventh** consecutive survey). |
