---
type: repo
title: bfra-me/ha-addon-repository
created: 2026-05-20
updated: 2026-08-31
sources:
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-05-30
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-06-10
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-06-20
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-07-02
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-07-16
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-08-07
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: 0a163c3fa8846704103658142fa742f40d165743
    accessed: 2026-08-31
tags:
  - home-assistant
  - addon
  - hassio
  - template
  - docker
  - multi-arch
  - bfra-me
  - renovate
  - supply-chain
related:
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - marcusrbrown--containers
  - home-assistant
  - docker-containers
  - github-actions-ci
  - probot-settings
node_id: R_kgDOIKWaJA
---

# bfra-me/ha-addon-repository

Template repository for a Home Assistant add-on repository. GitHub template (`is_template: true`) under the `bfra-me` org, used as the blueprint when starting a new HA add-on collection. The repo ships one example add-on (`example/`) that gets built and published to GHCR as `ghcr.io/bfra-me/{arch}-addon-example`.

This is the bfra-me ecosystem's add-on counterpart to Marcus's runtime [[marcusrbrown--ha-config]] — where ha-config consumes add-ons and integrations, this repo defines the scaffolding for building and publishing new ones.

## Identity

- **Owner:** bfra-me (org)
- **Visibility:** public, template
- **License:** Apache-2.0
- **Default branch:** `main`
- **Primary language:** Dockerfile
- **Topics:** `addon`, `addons`, `hassio`, `home-assistant`, `homeassistant`, `template`
- **Created:** 2022-10-08
- **Repo id:** `547723812`
- **Last push:** 2026-08-31 (non-main Renovate branch activity; `main` HEAD unchanged at `0a163c3f` since 2026-05-16 — **107 days** as of 2026-08-31)
- **Stars / forks / watchers:** 2 / 1 / 2 (steady across all surveys)

## Layout

```
.
├── .github/
│   ├── renovate.json5
│   ├── settings.yml
│   └── workflows/
│       ├── fro-bot.yaml
│       ├── main.yaml
│       ├── renovate.yaml
│       └── update-repo-settings.yaml
├── .vscode/
│   └── tasks.json
├── .cursorrules
├── .devcontainer.json
├── .gitattributes
├── .gitignore
├── .markdownlint-cli2.yaml
├── .pre-commit-config.yaml
├── .prettierrc.yaml
├── .tool-versions
├── LICENSE
├── README.md
├── example/
│   ├── CHANGELOG.md
│   ├── DOCS.md
│   ├── Dockerfile
│   ├── README.md
│   ├── apparmor.txt
│   ├── build.yaml
│   ├── config.yaml
│   ├── icon.png
│   ├── logo.png
│   ├── rootfs/
│   └── translations/
└── repository.yaml
```

The HA add-on store discovers add-ons by walking the repo root for directories containing a `config.yaml`/`config.json`. The `Main` workflow's `prepare` job replicates that discovery with `find ./ -maxdepth 2 -name config.json -o -name config.yaml -o -name config.yml`.

**31 blobs total** (recursive tree at `0a163c3f`, verified 2026-08-31 and byte-identical to every prior survey). The `.gitattributes` / `.gitignore` / `.vscode/tasks.json` entries above were present from the initial survey but omitted from the diagram until 2026-08-31 — a page-completeness fix, not a repo change. `.gitattributes` marks `*.json` as `JSON-with-comments` and `.cursorrules` as Markdown for linguist; `.vscode/tasks.json` ships a single `supervisor_run` task for the HA devcontainer.

## The Example Add-on

`example/` is the template payload. It demonstrates the canonical s6-overlay add-on structure:

- **`config.yaml`** — slug `example`, version `1.2.2`, four arches (`armhf`, `armv7`, `aarch64`, `amd64`), `init: false` (s6 takes over), `share:rw` map, single `message` option, image `ghcr.io/bfra-me/{arch}-addon-example`.
- **`build.yaml`** — base images pinned to `ghcr.io/home-assistant/{arch}-base:3.23` for 64-bit, `:3.22` for 32-bit ARM. OCI labels set title, description, source URL, and Apache-2.0 license.
- **`Dockerfile`** — `ARG BUILD_FROM` pinned by digest (`@sha256:...`) so Renovate can rotate it. Installs `tempio` (HA's template renderer) from `home-assistant/tempio` GitHub releases with a Renovate datasource comment. Copies `rootfs/` over the base image.
- **`apparmor.txt`** — AppArmor profile (security mandatory for HA add-ons).
- **`rootfs/`** — s6-overlay service tree.
- **`translations/`** — i18n strings for the HA Supervisor UI.

## Workflows

Four workflows, all SHA-pinned actions:

### `main.yaml` — CI lint + multi-arch build
- **Trigger:** `pull_request` (main), `push` (main), `workflow_dispatch`.
- **`prepare` job:** Discovers add-on directories, uses `dorny/paths-filter@v4.0.1` to compute changed add-ons against a `MONITORED_FILES` list (`apparmor.txt build.yaml config.yaml Dockerfile rootfs/**`). Emits JSON arrays for downstream matrix expansion.
- **`lint-addon` matrix:** `frenck/action-addon-linter@v2.21.0` per changed add-on. Authoritative HA lint.
- **`lint-prettier`:** `creyD/prettier_action@v4.6`, Prettier 3.8.3 pinned via `# renovate: datasource=npm depName=prettier` comment, `--check .`.
- **`build-addon` matrix:** Per-changed-add-on × (`aarch64`, `amd64`, `armhf`, `armv7`). Uses `yq` (`chrisdickinson/setup-yq` v4.45.1) to extract `build_from` keys and validate the arch list before building. `home-assistant/builder@2026.03.2` runs with `--test` for PRs and full builds with `--cosign` on push to `main`. Publishes to `ghcr.io/bfra-me/{arch}-addon-{slug}` with `id-token: write` (Sigstore/cosign).
- **`lint`/`build` aggregator jobs** funnel matrix results into single named status checks for branch protection.
- **Action pin inventory (read 2026-08-31, unchanged since inception):** `actions/checkout` **v6.0.2** (`de0fac2e`, ×4 jobs), `dorny/paths-filter` **v4.0.1** (`fbd0ab8f`), `frenck/action-addon-linter` **v2.21.0** (`f995494f`), `creyD/prettier_action` **v4.6** (`8c18391f`), `chrisdickinson/setup-yq` (`fa3192ed`, **no version comment**), `docker/login-action` **v4.1.0** (`4907a6dd`), `home-assistant/builder` **`@2026.03.2` — a mutable tag, not a SHA**. Prettier itself is pinned to **3.8.3** via the `PRETTIER_VERSION` env + `# renovate:` comment.
- **Two pin holes in the SHA-pinning regime** (see Drift Watch): `home-assistant/builder` is tag-pinned in the only job that holds `packages: write` + `id-token: write` and performs the cosign signing; `chrisdickinson/setup-yq` is SHA-pinned but carries no `# vX.Y.Z` comment and is consequently **absent from Renovate's detected-dependency list**.

### `fro-bot.yaml` — Fro Bot agent integration
- **Agent version:** `fro-bot/agent@v0.43.1` (SHA `3ec8d72f`).
- **Triggers:** `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request` (opened/synchronize/reopened/ready_for_review/review_requested), `schedule` (`30 15 * * *` — daily 15:30 UTC), `workflow_dispatch` with `prompt` input.
- **Bot-loop guards:** Skips when the user, comment author, or PR author ends with `[bot]` or equals `fro-bot`. Comment triggers require `OWNER`/`MEMBER`/`COLLABORATOR` association and `@fro-bot` mention.
- **PR_REVIEW_PROMPT** is add-on-aware: Dockerfile base-image SHA pinning, `config.yaml`/`build.yaml` validity (required fields, arch list accuracy, image reference pattern), shell script quality (`bashio`, signal handling, shellcheck SC2086/SC2060), AppArmor profile integrity, GitHub Actions SHA pinning, YAML formatting, breaking changes to add-on interface (slug/image/option-type changes that break existing installs), translation completeness. Output is a structured verdict (`PASS | CONDITIONAL | REJECT`) with mandatory headings.
- **SCHEDULE_PROMPT** runs a four-category sweep: errored PRs (checkout, diagnose, fix, push), security (Renovate alerts, SHA-pinning audit of `.github/workflows/*.yaml`), health & maintenance (compare `fro-bot/agent`, `actions/checkout`, `dorny/paths-filter`, `frenck/action-addon-linter`, `creyD/prettier_action`, `chrisdickinson/setup-yq` against current SHAs; bump `bfra-me/.github` reusable workflow when newer), developer experience (Prettier, shellcheck on `example/rootfs/**/{run,finish}`, config.yaml/build.yaml required fields, version-vs-CHANGELOG consistency, `.tool-versions` drift).
- **Single perpetual issue:** Maintains a single open issue titled exactly `Daily Autohealing Report` and prepends dated update sections — this is **not** the same pattern as ha-config or sibling repos that create new issues per cycle.
- Uses `secrets.FRO_BOT_PAT` for checkout and agent token; `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG` secrets; `vars.FRO_BOT_MODEL` for model selection.

### `renovate.yaml` — Renovate orchestration
- Uses `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.16` (SHA `71213b76`).
- Triggers: `issues.edited`, `pull_request.edited`, `push` (non-main), `workflow_dispatch` (log-level + print-config inputs), `workflow_run` (after `Main` succeeds on `main`).
- Conditional log level: debug on PRs / non-default branches, info otherwise.

### `update-repo-settings.yaml` — Probot Settings sync
- Uses `bfra-me/.github/.github/workflows/update-repo-settings.yaml@v4.16.16`.
- Triggers: `push` to `main`, daily at 14:15 UTC, `workflow_dispatch`.

## Configuration

### Renovate (`renovate.json5`)
- Extends `github>bfra-me/renovate-config#5.2.1` plus `:enablePreCommit`. This is a **different** preset family than the `marcusrbrown/renovate-config` line used across the rest of the ecosystem (`marcusrbrown/renovate-config#4.5.x`, since advanced to `#5.2.12`). Pin still `#5.2.1` as of 2026-08-31; PR **#561** (opened 2026-08-30) proposes `v5.2.7` and is the newest member of the blocked queue.
- Package rules:
  - HA base images (`ghcr.io/home-assistant/**`, `home-assistant/**`) grouped as "Home Assistant Add-ons" with `pinDigests: false`.
  - `ghcr.io/hassio-addons/**` grouped as "hassio-addons".
  - `home-assistant/actions/*` regex match grouped.
  - `home-assistant/builder` action: custom version extraction (`^\d+\.\d+\.\d+$`), single-bump strategy (no separate major/minor/patch).
  - `python` dep capped at `<=3.13`.
- Custom managers cover three patterns: `build.yaml` arch keys + `# renovate:` comments, `Dockerfile` `ARG BUILD_FROM=...@sha256:...` and `# renovate:` comments, and Alpine package versions via `repology` datasource (`alpine_3_20/{pkg}`).

### Probot Settings (`.github/settings.yml`)
- Extends `.github:common-settings.yaml` (org-level common settings — note the bare `.github:` prefix, which resolves to `bfra-me/.github`, not Marcus's personal `.github`).
- Repo: `is_template: true`, topics, description.
- Branch protection on `main`:
  - Required status checks (strict): `Prepare`, `Lint`, `Build`, `Renovate / Renovate`, `Fro Bot`
  - `enforce_admins: true`
  - 1 required approving review, dismiss stale reviews on push
  - `required_linear_history: true`
  - No code-owner-review requirement, no restrictions

### Tooling
- **`.tool-versions`:** Node **22.11.0**, Python **3.13.13**. Re-read 2026-08-31, unchanged. Node 22.11.0 is now two majors behind the fleet baseline (Node 24.19/24.20 across [[bfra-me--works]], [[marcusrbrown--dotfiles]], and friends) and Renovate proposes nothing for it — the `asdf` manager tracks only the `python` line here (dashboard shows `python 3.13.13 → 3.13.15`, rate-limited), so the Node pin has no update path at all. Also note `renovate.json5` caps Python at `<=3.13` deliberately.
- **`.pre-commit-config.yaml`:** `pre-commit/pre-commit-hooks` at `v6.0.0` — four hooks (`trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-added-large-files`). Flagged **abandoned** by Renovate as of 2026-08-31 (last upstream release 2025-08-09).
- **`.devcontainer.json`** present (contents not surveyed under read-limit policy).
- **`.pre-commit-config.yaml`** present, integrated via Renovate `:enablePreCommit`.
- **`.markdownlint-cli2.yaml`**, **`.prettierrc.yaml`** present.
- **`.cursorrules`** present (Cursor IDE context).

## The Autoheal Daemon Died (2026-08-14)

First recorded 2026-08-31. Prior surveys described the `Daily Autohealing Report` as "updating daily". It is not. It stopped.

`Fro Bot` workflow `schedule` run history (`workflow_id 262484968`, `event=schedule`, 135 scheduled runs total):

| Window | Runs | Conclusion |
|---|---|---|
| … → 2026-08-13T16:14 (run 6186) | daily | `success` |
| 2026-08-14T16:11 (run 6190) → 2026-08-30T18:40 (run 8390) | **17 consecutive** | **`failure`** |

Job breakdown on the most recent failure (run `33328740417`, 2026-08-30): `Set up job` ✅ → `Checkout repository` ✅ → **`Run Fro Bot` ❌** → post-steps ✅. Total wall time ~1m54s. The failure is inside the `fro-bot/agent@v0.43.1` action itself, early — consistent with harness/provider startup rather than a long agent run that errored mid-task. Logs require an authenticated token and were not read this cycle; root cause is **unconfirmed**, but the shape (an ~4-month-stale pinned harness that worked for months and then failed abruptly on a fixed date across every subsequent run) points at an external contract the v0.43.1 harness can no longer satisfy — model/provider resolution, an `auth-json` schema change, or an OpenCode base the pinned action can no longer fetch.

Corroborating evidence: issue #554 `Daily Autohealing Report` was last updated **2026-08-13**, exactly matching the last successful scheduled run, and has been static for 18 days. Comment count 23.

**The closed loop.** The one process escalating the review deadlock has stopped, and the fix for it — PR **#557**, `fro-bot/agent` v0.43.1 → **v0.107.0** — is itself parked in that same deadlock, unreviewed since 2026-05-17. The daemon that was assigned "Tasks for Copilot" to unblock the queue is now blocked by the queue it was supposed to unblock.

**Why nobody noticed.** `Fro Bot` is a *required status check* on `main`, so one would expect a failing Fro Bot to be loud. It isn't: the required-check evaluation happens on `pull_request` events, where the bot-author guard makes the job **skip** (skipped ⇒ passing for branch protection). Scheduled failures never touch a PR's mergeability. The repo's only health signal for the daemon is a workflow-run list nobody reads, and 17 days of red went unremarked while every PR stayed green. Generalized into [[github-actions-ci]].

## Renovate Queue: First Composition Change Since May

Through 2026-08-07 every survey reported the *same five* PRs (#556–#560). On 2026-08-31 the count is still 5, but the membership changed:

| PR | Opened | Target (2026-08-31) | Prior target (2026-08-07) | Note |
|---|---|---|---|---|
| ~~#556~~ | 2026-05-16 | — | `bfra-me/.github` v4.16.44 | **Autoclosed unmerged 2026-08-30T23:14 after 106 days** |
| #557 | 2026-05-17 | `fro-bot/agent` **v0.107.0** | v0.96.3 | ~64-minor jump from pinned v0.43.1 |
| #558 | 2026-05-20 | HA Add-ons **v3.24** | v3.24 | unchanged, 5th survey |
| #559 | 2026-05-22 | `docker/login-action` **v4.6.0** | v4.6.0 | unchanged |
| #560 | 2026-06-02 | `actions/checkout` **v6.1.0** | v6.1.0 | unchanged |
| **#561** | **2026-08-30** | `bfra-me/renovate-config` preset **v5.2.7** | — | **new**; current pin `#5.2.1` |

**#556 did not get merged. It got garbage-collected.** Its title now reads `chore(deps): update bfra-me/.github action to v4.23.0 - autoclosed` — Renovate's own autoclose marker — and the update it carried has reappeared on the Dependency Dashboard under **Rate-Limited** (`renovate/bfra-me-.github-4.x → v4.23.0`, a checkbox). Ninety-eight days of "blocked on review" collapsed into a dashboard line item; the PR that made the block legible is gone.

This is a durable lesson worth stating plainly: **PR age is not a monotonic record of a governance failure.** A dependency bot will eventually recycle its own evidence. Anyone auditing this repo on 2026-09-01 sees a tidy 5-PR queue with a fresh member and no artifact for the 106-day stall. Only the survey history preserves it. Cataloged in [[github-actions-ci]].

## Dependency Dashboard Findings (2026-08-31)

Issue #4 (`bfra-me[bot]`) is the highest-signal artifact in the repo. Three sections deserve recording.

### Abandoned Dependencies (new section)

Renovate's `abandonmentThreshold` detection now flags two:

| Datasource | Package | Last release |
|---|---|---|
| github-actions | `creyD/prettier_action` | 2025-06-09 |
| pre-commit | `pre-commit/pre-commit-hooks` | 2025-08-09 |

`creyD/prettier_action` is the repo's **entire Prettier gate** — one of the two jobs feeding the required `Lint` status check. Its upstream repo is still pushed to (2025-11-17) but hasn't cut a release in ~15 months, so the SHA pin at `v4.6` is effectively terminal. Not urgent; worth knowing that a required check depends on an action nobody ships.

### Pending Approval (major gates nobody clicks)

- `actions/checkout` → **v7**
- `home-assistant/tempio` → **v2026**

The second one matters. `example/Dockerfile` pins `TEMPIO_VERSION=2024.11.2` behind a `# renovate: datasource=github-releases depName=home-assistant/tempio versioning=loose` comment; upstream latest is **2026.07.0** (2026-07-18). That is roughly **21 months stale** — and tempio is the *only* artifact the add-on image downloads over the network at build time (`curl -sSLf -o /usr/bin/tempio https://github.com/home-assistant/tempio/releases/download/${TEMPIO_VERSION}/tempio_${BUILD_ARCH}`, no checksum, no SRI equivalent).

Same failure class as [[marcusrbrown--esphome-life]]'s ESPHome calver freeze: a calendar-versioned upstream + `versioning: loose` means `2024.11 → 2026.07` reads as a **major** bump, which lands in the dashboard's approval queue instead of an auto-created PR. A checkbox is not a notification. Under an otherwise-hot Renovate install, a pin that never moves is a suppression signal, not a stability signal. See [[home-assistant]].

### Rate-Limited (six queued, including #556's ghost)

`python` 3.13.15, `dorny/paths-filter` v4.0.3, `frenck/action-addon-linter` v2.21.1, `bfra-me/.github` **v4.23.0**, `prettier` 3.9.6, `home-assistant/builder` **2026.06.0**.

Open PR count has held at exactly 5 across every survey since 2026-06-10. Combined with #556 autoclosing on the same day #561 was created, the most parsimonious reading is a **`prConcurrentLimit` of 5**: the queue is not five PRs because five things need updating, it is five PRs because five is the ceiling. Eleven further updates are real and invisible, sitting behind checkboxes. The deadlock is therefore worse than the PR list implies — the visible queue is a fixed-size window onto a growing backlog, not the backlog itself.

### What Renovate Cannot See

`chrisdickinson/setup-yq` appears in `main.yaml`'s `build-addon` job (`fa3192ed`, `yq-version: v4.45.1`) but **does not appear anywhere in the dashboard's detected-dependency list** — the workflow's `github-actions` entry enumerates 9 deps and `setup-yq` is not among them (the bare SHA carries no `# vX.Y.Z` comment for Renovate to anchor a currentValue to). The upstream action was last pushed **2024-05-15** (~27 months), has 29 stars, and its latest release is **v1.0.0 from 2019-12-30**. It is not flagged abandoned because it is not tracked at all.

So the build path contains an unmaintained third-party personal action that sits below both the dependency bot *and* the abandonment detector. The `SCHEDULE_PROMPT` explicitly names `chrisdickinson/setup-yq` in its category-3 sweep — the human who wrote the prompt saw the gap — but that sweep has been failing since 2026-08-14 and before that ran on a v0.43.1 harness.

`yq` is used for exactly two things here: reading `.build_from | keys` and reading `.image`/`.version` out of `config.yaml`. That is replaceable with a few lines of shell, or with the `yq` already present on GitHub-hosted `ubuntu-latest` runners. Removing the action removes the untracked surface entirely.

### Latent Custom-Manager Bug: `alpine_3_20`

The third `customManagers` entry resolves bare `pkg=version` pins in any Dockerfile through the `repology` datasource with `depNameTemplate: 'alpine_3_20/{{package}}'`. The add-on base images are **Alpine 3.23** (aarch64/amd64) and **3.22** (armhf/armv7). Any `apk add pkg=x.y.z` pin a forker adds will be version-resolved against Alpine **3.20**'s package set — three releases behind the image it is being installed into.

Currently inert: `example/Dockerfile` contains no `apk` version pins, so the manager matches nothing. But this is a template repository whose whole purpose is being copied, and adding pinned apk packages is the single most likely first modification a forker makes. Renovate will validate the datasource and the regex and happily propose wrong versions. Same family as the "valid-but-wrong target" defect documented at [[marcusrbrown--esphome-life]]: the config is syntactically fine and semantically pointed at the wrong thing, so every green run is evidence of nothing. Fix is a one-token edit (`alpine_3_23`) or, better, templating the branch off `build.yaml`.

## Actions Run Storm

`Fro Bot` has **8,471 workflow runs**. The agent has produced **23 comments** across the repo's lifetime. Total Actions runs across all four workflows: **40,000** — on a 31-blob template that has not merged a commit in 107 days.

Mechanism: `fro-bot.yaml` triggers on `issues: [opened, edited]` and `pull_request: [opened, synchronize, reopened, ready_for_review, review_requested]`; `renovate.yaml` triggers on `issues.edited` and `pull_request.edited`. Renovate edits the Dependency Dashboard (#4) and retargets PR bodies constantly — every one of those edits fires **both** workflows, each of which boots a runner and then evaluates a bot-author guard in the job-level `if:` and skips. The run listing on 2026-08-30 shows clusters of `issues`/`pull_request` runs concluding `skipped` seconds apart; the `Fro Bot` run counter moved **6872 → 8378 between 2026-08-26 and 2026-08-28** — roughly 1,500 runs in two days, all no-ops.

The guard is correct. Its placement is not: a job-level `if:` runs *after* the workflow is queued and dispatched. GitHub offers no event-level "not authored by a bot" filter, so the only real mitigations are narrowing the trigger (`issues: [opened]` — dropping `edited` costs nothing here, since the agent has no reason to react to a bot rewriting a dashboard) or gating at the workflow-level `if:`. Pairing an `issues: [edited]` trigger with a bot that owns a perpetually-rewritten dashboard issue in the same repo is a self-amplifying no-op loop. Generalized into [[github-actions-ci]].

## Cross-Ecosystem Notes

| Aspect | bfra-me/ha-addon-repository | [[marcusrbrown--ha-config]] |
|---|---|---|
| Purpose | Template for building & publishing HA add-ons | Running HA config (consumes add-ons & components) |
| Renovate base | `bfra-me/renovate-config#5.2.1` | `marcusrbrown/renovate-config#4.5.x` |
| Probot extends | `.github:common-settings.yaml` (bfra-me org) | `fro-bot/.github:common-settings.yaml` |
| Fro Bot agent | v0.43.1, present but **failing every scheduled run since 2026-08-14** | **Not present** (carried-forward recommendation) |
| Fro Bot issue model | Single perpetual `Daily Autohealing Report` (static since 2026-08-13) | n/a |
| Build target | Multi-arch Docker images → GHCR with cosign | n/a (no add-on builds) |
| HA validation tool | `frenck/action-addon-linter` | `frenck/action-home-assistant` |

The two `frenck/action-*` tools are siblings serving the two sides of the HA development workflow: linter for the add-on contract, home-assistant for the running config. See [[home-assistant]] for the latter.

## Observations

- **Template hygiene:** README's HTML comment block is the de-facto onboarding checklist for forkers (rename `example/`, update `image:` to your username, adjust `repository.yaml`, update `version` and `CHANGELOG.md` per release). It is not enforced by CI — a fork that forgets to update `image:` will silently publish under `bfra-me`'s namespace. Worth promoting to a `scripts/init-fork.sh` or pre-commit hook in any downstream usage.
- **HA base-image arch split:** `aarch64`/`amd64` on Alpine 3.23, `armhf`/`armv7` on 3.22. The base-image producers (`ghcr.io/home-assistant/*-base`) lag on 32-bit ARM. The Renovate `Home Assistant Add-ons` group keeps them coordinated, but expect drift to persist as upstream prioritizes 64-bit.
- **`pinDigests: false` for HA base images** is intentional — combined with the explicit `@sha256:...` in the Dockerfile, the digest is rotated by the custom Dockerfile manager (`ARG BUILD_FROM=...@sha256:...` matchString), not by `build.yaml`. This keeps the build reproducible while letting `build.yaml` stay readable as tag-only.
- **`enforce_admins: true`** on the template means downstream forks inherit a strict policy that the original maintainer must also follow — a footgun for solo forks until they relax it.
- **No CodeQL, no Scorecard, no Trivy** — security scanning is delegated to Renovate alerts and the Fro Bot autoheal sweep. Reasonable for a template; downstream add-on collections handling real services should add at least a Hadolint/Trivy gate.
- **Open-issue count is mostly the parked PR queue:** `open_issues_count` of 7 (2026-07-16) is 5 Renovate PRs plus 2 real issues — the perpetual `Daily Autohealing Report` (#554) and the `Dependency Dashboard` (#4). There are effectively zero substantive human-filed issues; the number is a governance artifact, not a bug backlog.

## Survey History

| Date | SHA | Notes |
|---|---|---|
| 2026-05-20 | `0a163c3f` | Initial survey. Fro Bot agent v0.43.1, four workflows, example add-on at v1.2.2, HA base images Alpine 3.22/3.23, Node 22.11.0, Python 3.13.13. |
| 2026-05-30 | `0a163c3f` | HEAD unchanged on `main` for 14 days. Open issues 5 → 6 (new `Daily Autohealing Report` entry from the perpetual issue pattern). 4 open Renovate PRs queued and unmerged: #556 (`bfra-me/.github` v4.16.16 → v4.16.21), #557 (`fro-bot/agent` v0.43.1 → v0.46.1, 3-minor-version jump), #558 (HA `amd64-base:3.23` digest rotation), #559 (`docker/login-action` v4.2.0). The `SCHEDULE_PROMPT` block still references `bfra-me/.github` "currently v4.16.6" — that's a stale comment relative to the actual workflow import at v4.16.16, and worth updating when #556 lands. No content drift on workflows, settings, or the `example/` add-on. |
| 2026-06-10 | `0a163c3f` | HEAD unchanged on `main` for 25 days (last merge: prettier 3.8.3, #551, 2026-05-16). Renovate PR queue grew to 5: #556 retargeted to `bfra-me/.github` v4.16.24, #557 retargeted to `fro-bot/agent` v0.59.1 (now a 16-minor-version jump from the pinned v0.43.1), #558 (`amd64-base:3.23` digest), #559 (`docker/login-action` v4.2.0), new #560 (`actions/checkout` v6.0.3). All 5 green but BLOCKED on `REVIEW_REQUIRED` — branch protection requires 1 approving review and nobody is reviewing. #556 blocked 27 days per the autoheal report. The `Daily Autohealing Report` issue (#554) is updating daily (last 2026-06-09) and has escalated to assigning "Tasks for Copilot" to approve/merge the stuck PRs. Workflow set unchanged (4 workflows). Open issues: 2 substantive (#554 perpetual report, #4 Dependency Dashboard); gh `open_issues_count` of 7 includes the 5 PRs. |
| 2026-07-02 | `0a163c3f` | HEAD frozen on `main` for **47 days** — no merges since #551 (2026-05-16). The identical 5 Renovate PRs remain open and `REVIEW_REQUIRED` (all `MERGEABLE`); Renovate has retargeted each further upward: #556 → `bfra-me/.github` **v4.16.33**, #557 → `fro-bot/agent` **v0.81.0** (now a **~38-minor jump** from pinned v0.43.1, up from the v0.72.0 target 12 days ago), #558 → HA Add-ons **v3.24** (unchanged), #559 → `docker/login-action` **v4.3.0** (was v4.2.0), #560 (`actions/checkout` v6.0.3, unchanged). #556 has now been blocked **47 days**. Live checks confirm green-but-blocked: `Prepare`/`Prettier`/`Renovate` SUCCESS, add-on lint/build SKIPPED (no monitored-file changes), `Fro Bot` SKIPPED. The `Daily Autohealing Report` issue (#554) remains the only Fro-Bot-authored issue (updated 2026-07-01); `Dependency Dashboard` (#4, `bfra-me[bot]`) is the only other open issue. No content drift on `main`: four workflows, `fro-bot.yaml` still pinned to agent v0.43.1 (`3ec8d72f`, daily 15:30 UTC), `settings.yml`, `renovate.json5`, and `example/` (v1.2.2) all identical. The review-required deadlock is unbroken; every survey since 2026-05-30 is the same parked-car snapshot with the Renovate targets drifting further from the frozen pins. |
| 2026-07-16 | `0a163c3f` | HEAD frozen on `main` for **60 days** — no merges since #551 (2026-05-16). Same 5 Renovate PRs still open; Renovate has retargeted the moving ones further: #556 → `bfra-me/.github` **v4.16.37** (was v4.16.33), #557 → `fro-bot/agent` **v0.92.1** (now a **~49-minor jump** from pinned v0.43.1, up from v0.81.0 two weeks ago), #558 → HA Add-ons **v3.24** (unchanged), #559 → `docker/login-action` **v4.4.0** (was v4.3.0), #560 (`actions/checkout` v6.0.3, unchanged). #556 has now been blocked **60 days**. The `Daily Autohealing Report` issue (#554, `fro-bot`) is still the only Fro-Bot-authored issue (updated 2026-07-15); `Dependency Dashboard` (#4) is the only other open issue. No content drift on `main`: four workflows, `fro-bot.yaml` still pinned to agent v0.43.1 (`3ec8d72f`, daily 15:30 UTC), `renovate.json5`, `settings.yml`, and `example/` (v1.2.2) all identical. Two-month parked car; the gap between the frozen pins and Renovate's live targets is now the only thing that moves. Note: survey ran without a `gh` token — data gathered via unauthenticated `api.github.com`/`raw.githubusercontent.com`; branch-protection check states not re-verified this cycle (unchanged assumption carried forward). |
| 2026-08-07 | `0a163c3f` | HEAD frozen on `main` for **83 days** — no merges since #551 (2026-05-16). Same 5 Renovate PRs still open and `REVIEW_REQUIRED`; Renovate has retargeted the moving ones further: #556 → `bfra-me/.github` **v4.16.44** (was v4.16.37), #557 → `fro-bot/agent` **v0.96.3** (now a **~53-minor jump** from pinned v0.43.1, up from v0.92.1 three weeks ago), #558 → HA Add-ons **v3.24** (unchanged), #559 → `docker/login-action` **v4.6.0** (was v4.4.0), #560 → `actions/checkout` **v6.1.0** (was v6.0.3). #556 has now been blocked **83 days**. The `Daily Autohealing Report` issue (#554, `fro-bot`) is still the only Fro-Bot-authored issue (updated 2026-08-05); `Dependency Dashboard` (#4, `bfra-me[bot]`) is the only other open issue (touched 2026-08-07). No content drift on `main`: root tree, four workflows, `fro-bot.yaml` still pinned to agent v0.43.1 (`3ec8d72f`, daily 15:30 UTC), `renovate.json5`, `settings.yml`, and `example/` (v1.2.2) all identical. `open_issues_count` 7 = 5 parked PRs + 2 issues, steady across the entire two-and-a-half-month deadlock. Note: survey ran without a `gh` token — data gathered via unauthenticated `api.github.com`/`raw.githubusercontent.com`; branch-protection check states not re-verified this cycle (unchanged assumption carried forward). |
| 2026-08-31 | `0a163c3f` | HEAD frozen on `main` for **107 days**; recursive tree byte-identical (31 blobs), every workflow/manifest re-read and diff-clean. **Two firsts.** (1) **The daily autoheal daemon is dead** — `Fro Bot` scheduled runs have concluded `failure` **17 consecutive times** since 2026-08-14T16:11 (run 6190); last success 2026-08-13T16:14 (run 6186), matching #554's last update exactly. Failure is in the `Run Fro Bot` step (`fro-bot/agent@v0.43.1`) ~2 min in; root cause unconfirmed (logs need auth). Nobody noticed because `Fro Bot` as a *required check* is evaluated on `pull_request` events where the bot guard makes it **skip** (⇒ passing), so 17 days of red never touched mergeability. (2) **PR #556 autoclosed unmerged on 2026-08-30T23:14 after 106 days** — title now `… to v4.23.0 - autoclosed`; the update reappeared on the Dependency Dashboard under *Rate-Limited*. Open-PR count still 5 only because new **#561** (`bfra-me/renovate-config` preset `#5.2.1` → v5.2.7, opened 2026-08-30) took the slot — **first queue-composition change since 2026-05-22**. #557 retargeted v0.96.3 → **v0.107.0** (~64-minor jump); #558/#559/#560 unchanged. Dashboard reveals a **fixed 5-PR window over a 6-deep rate-limited backlog** (`prConcurrentLimit: 5` is the parsimonious read) plus 2 approval-gated majors (`actions/checkout` v7; `home-assistant/tempio` **v2026** vs pinned `2024.11.2`, ~21 months stale, the image's only network-fetched build artifact). New Renovate **Abandoned Dependencies** section flags `creyD/prettier_action` (last release 2025-06-09 — the repo's entire Prettier gate) and `pre-commit/pre-commit-hooks` (2025-08-09). New findings: `chrisdickinson/setup-yq` (`fa3192ed`, no version comment) is **invisible to Renovate entirely** — upstream last pushed 2024-05-15, latest release v1.0.0 from 2019; `home-assistant/builder@2026.03.2` is **tag-pinned, not SHA-pinned**, in the only job holding `packages: write` + `id-token: write` + cosign; the `repology` custom manager targets **`alpine_3_20/`** while base images are Alpine 3.23/3.22. **Run storm:** `Fro Bot` has 8,471 runs (agent lifetime output: 23 comments), 40,000 total Actions runs, ~1,500 Fro Bot runs 08-26 → 08-28, all `skipped` — `issues: [edited]` + a bot that rewrites a dashboard issue. Open issues 2 substantive (#554 static since 08-13, #4 dashboard); `open_issues_count` 7 = 5 PRs + 2 issues, unchanged. Stars 2 / forks 1 / watchers 2. Note: survey ran without a `gh` token — unauthenticated `api.github.com` + `raw.githubusercontent.com` only; branch-protection state and Actions logs not re-verified. |
| 2026-06-20 | `0a163c3f` | HEAD still frozen on `main` for **35 days** — no merges since #551 (2026-05-16). The same 5 Renovate PRs remain open and `REVIEW_REQUIRED`, but Renovate has retargeted each upward as upstream moved: #556 → `bfra-me/.github` **v4.16.27**, #557 → `fro-bot/agent` **v0.72.0** (now a **~29-minor jump** from pinned v0.43.1, up from the v0.59.1 target 10 days ago), #558 → HA Add-ons **v3.24** (base-image minor, was a digest-only `:3.23` rotation before), #559 (`docker/login-action` v4.2.0, unchanged), #560 (`actions/checkout` v6.0.3, unchanged). #556 has now been blocked **35 days**. The `Daily Autohealing Report` issue (#554) is still the only Fro-Bot-authored issue and updated today (2026-06-20). No content drift on `main`: workflows (4), `settings.yml`, `renovate.json5`, and the `example/` add-on (v1.2.2) all identical to prior survey. The review-required deadlock is now the dominant fact about this repo — CI is green, the bottleneck is purely human/governance. |

## Drift Watch

- **Stale comment in `fro-bot.yaml`:** The `SCHEDULE_PROMPT` env literal hardcodes "bfra-me/.github reusable workflow version (currently v4.16.6)" while the actual `uses:` pin in `renovate.yaml` and `update-repo-settings.yaml` is at v4.16.16, with v4.16.24 queued in PR #556. The agent self-corrects via the live SHA comparison it's instructed to do, but the literal will keep drifting until someone parameterises it or relies entirely on dynamic lookup.
- **Fro Bot agent lag (no longer theoretical — it broke):** As of **2026-08-31** the lag stopped being a hygiene concern and became an outage. The pinned v0.43.1 harness has failed **every scheduled run since 2026-08-14** (17 consecutive), and PR #557 — the fix — is now retargeted to **v0.107.0**, a **~64-minor jump**. The staged-bump advice below still stands on the merits, but the cost calculus inverted: "merging nothing" no longer means "running on an archaic harness", it means running nothing at all. Bumping is now the lower-risk option, because the current state has zero autoheal coverage and a blind jump at worst produces a workflow that also doesn't run. See *The Autoheal Daemon Died* above.
- **Fro Bot agent lag (historical framing, 2026-08-07):** Repo is pinned at v0.43.1; PR #557 had been retargeted by Renovate to **v0.96.3** as of 2026-08-07 — a **~53-minor-version jump**, up from the v0.92.1 target three weeks earlier (v0.81.0 a month before that). The agent harness changed substantially across that span (single-job mode dispatch, the pnpm→Bun migration, the gateway operator web surface, OpenCode base rebases, the two-phase release-notes credential boundary and `review-skip-label` opt-out per [[fro-bot--agent]]). The pinned v0.43.1 harness is now roughly four months stale and the gap widens every Renovate cycle. Merging #557 without checking `fro-bot.yaml` input compatibility against the v0.9x harness is a footgun (a 53-minor span almost certainly carries breaking input/secret changes — the operator-contract and Bun-runtime shifts alone are candidates); merging nothing means the daily autoheal keeps running on an increasingly archaic harness. A staged bump through the intervening versions, or a manual review of the v0.43→v0.96 changelog, is the safer path than a blind jump.
- **Review-required deadlock (dominant constraint):** Branch protection requires 1 approving review with `enforce_admins: true`, but no human or delegated reviewer is processing the Renovate queue. All 5 open PRs are green-but-blocked; the oldest (#556) has now waited **83 days**. The autoheal report has been delegating approval tasks to Copilot — a sign the review pipeline, not CI, is the bottleneck. This is the same shape of stall seen across surveys: every CI signal is green, every PR is mergeable on the checks, and the repo is frozen anyway because one approving review never arrives. Either enable auto-approve for grouped Renovate updates (as sibling `bfra-me` repos lean on checks-over-reviewers governance) or schedule a human review pass. Until then, treat any "fresh" survey of this repo as a snapshot of a parked car: the engine runs, nobody is driving. **Update 2026-08-31:** the engine stopped too. The oldest blocked PR (#556, 106 days) was autoclosed unmerged rather than reviewed, and the scheduled agent has failed for 17 straight days. The parked car has been towed.
- **Unpinned action in the highest-privilege job (new 2026-08-31):** `home-assistant/builder@2026.03.2` is a **mutable tag**, not a SHA — in the `build-addon` job that carries `permissions: packages: write` + `id-token: write` and runs `--cosign`. Both the `PR_REVIEW_PROMPT` and `SCHEDULE_PROMPT` instruct the agent to enforce "SHA-pinned actions (no @latest/@main/@develop)"; the check as written only rejects the three floating branch names, so a version-looking tag sails through. Every other action in the repo is SHA-pinned. The one that can push images to GHCR and hold a Sigstore identity token is not. Renovate does track it (2026.06.0 is available, rate-limited) but it tracks it as a *tag*, so a bump changes the string without ever establishing immutability. Fix: pin the SHA with a `# 2026.03.2` comment and widen the prompt's rule to "must be a 40-hex SHA", not "must not be a known-bad ref".
- **`repology` custom manager pointed at Alpine 3.20 (new 2026-08-31):** `depNameTemplate: 'alpine_3_20/{{package}}'` versus Alpine **3.23**/**3.22** base images. Inert today (no `apk` version pins exist in `example/Dockerfile`), live the moment any forker adds one — which is the expected first modification to a template. See *Latent Custom-Manager Bug* above.
- **Untracked action in the build path (new 2026-08-31):** `chrisdickinson/setup-yq` is invisible to Renovate (bare SHA, no version comment), unmaintained since 2024-05-15, latest release v1.0.0 (2019). It is also invisible to the new abandonment detector, because that only reports on packages Renovate already tracks. The cheapest remediation is deletion — `yq` is preinstalled on `ubuntu-latest`, and the two queries this job runs (`.build_from | keys`, `.image`/`.version`) need no setup step at all.
