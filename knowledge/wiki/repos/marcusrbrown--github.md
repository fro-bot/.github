---
type: repo
title: marcusrbrown/.github
created: 2025-06-18
updated: 2026-09-11
sources:
  - url: https://github.com/marcusrbrown/.github
    sha: be01029971bc8b50fbd2b660fadc7341da26e03c
    accessed: 2025-06-18
  - url: https://github.com/marcusrbrown/.github
    sha: be01029971bc8b50fbd2b660fadc7341da26e03c
    accessed: 2026-04-21
  - url: https://github.com/marcusrbrown/.github
    sha: be01029971bc8b50fbd2b660fadc7341da26e03c
    accessed: 2026-04-22
  - url: https://github.com/marcusrbrown/.github
    sha: 4e4fd28e9cc19f22324cd3037bbd53a9e2c0cf14
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/.github
    sha: 4e4fd28e9cc19f22324cd3037bbd53a9e2c0cf14
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/.github
    sha: 4e4fd28e9cc19f22324cd3037bbd53a9e2c0cf14
    accessed: 2026-04-25
  - url: https://github.com/marcusrbrown/.github
    sha: 99906ef
    accessed: 2026-04-26
  - url: https://github.com/marcusrbrown/.github
    sha: 3fb30a4
    accessed: 2026-04-27
  - url: https://github.com/marcusrbrown/.github
    sha: 0b780fdba1b5b0ae6280aaaf28f625e3db142278
    accessed: 2026-05-25
  - url: https://github.com/marcusrbrown/.github
    sha: a00e88890a2d49b08cd6489d2ab0350a005a306c
    accessed: 2026-06-06
  - url: https://github.com/marcusrbrown/.github
    sha: 1c97ca8dcd9bf7df5f377d348953dd4d9d485aee
    accessed: 2026-06-17
  - url: https://github.com/marcusrbrown/.github
    sha: d516b2f6ea9f8efe2fe5222d32d24d3a876032a0
    accessed: 2026-06-28
  - url: https://github.com/marcusrbrown/.github
    sha: 7ce5ae7a2ed353e3bc1691ba754e5657c9ddcc79
    accessed: 2026-07-28
  - url: https://github.com/marcusrbrown/.github
    sha: 66270bac1d3c7b814972b59268e95f6646d7a6c5
    accessed: 2026-08-29
  - url: https://github.com/marcusrbrown/.github
    sha: 002d2f56fe28996005261726d1b1fb04677d9ce9
    accessed: 2026-09-11
tags:
  - github
  - repository-settings
  - probot
  - community-health
  - prettier
  - renovate
  - self-update-deadlock
  - run-conclusion
  - bootstrap-dependency
aliases:
  - marcusrbrown-dotgithub
related:
  - marcusrbrown--ha-config
  - marcusrbrown--containers
  - marcusrbrown--mrbro-dev
  - marcusrbrown--vbs
  - marcusrbrown--infra
  - marcusrbrown--dotfiles
  - marcusrbrown--renovate-config
  - bfra-me--renovate-action
  - bfra-me--github
  - github-actions-ci
  - probot-settings
node_id: MDEwOlJlcG9zaXRvcnkzMDg1MzMxOTg=
---

# marcusrbrown/.github

Marcus R. Brown's personal `.github` repository. Provides GitHub defaults, community health files, and the canonical [[probot-settings]] template (`common-settings.yaml`) consumed by his other repositories.

## Overview

- **Purpose:** GitHub defaults and community health files for `marcusrbrown` repositories
- **Default branch:** `main`
- **Created:** 2020-10-30
  - **Last push:** 2026-09-10T01:00:33Z
- **Topics:** `github`, `repository`, `settings`
- **License:** MIT
- **Language:** None (YAML/Markdown only, no application code)
- **Visibility:** Public
- **Node ID:** `MDEwOlJlcG9zaXRvcnkzMDg1MzMxOTg=` (repo id `308533198`)
- **Signals (2026-09-11):** 4 stars, 2 watchers, 0 forks, 2 open issues, 0 open PRs

> **Measurement note.** This repo's `updated_at` is worthless as a content signal. `Update Repo Settings` runs on a `55 2 * * *` cron and writes repository settings through the API on every pass, so `updated_at` tracks the settings-sync cron (2026-09-11T02:58:39Z at survey time — the exact timestamp of run #1637) and never goes stale regardless of whether a single byte of the tree has moved. Use the HEAD commit date or `pushed_at`; for this repo they differ from `updated_at` by days at a time.

## Repository Structure

Lean repo, 15 files total. No application code, no `package.json`, no TypeScript.

| Path | Purpose |
| --- | --- |
| `common-settings.yaml` | **Canonical Probot Settings template** — extended by other Marcus repos via `_extends: .github:common-settings.yaml` |
| `.github/settings.yml` | This repo's own Probot settings, self-extending `common-settings.yaml` |
| `.github/renovate.json5` | Renovate config (extends `marcusrbrown/renovate-config#4.5.9`) |
| `.github/workflows/main.yaml` | CI: Prettier check only |
| `.github/workflows/renovate.yaml` | Renovate runner (reusable from `bfra-me/.github@v4.27.0`) |
| `.github/workflows/update-repo-settings.yaml` | Probot settings sync (reusable from `bfra-me/.github@v4.27.0`) |
| `.prettierrc.yaml` | Prettier config |
| `CODE_OF_CONDUCT.md` | Contributor Covenant v1.4 (contact: `git@mrbro.dev`) |
| `FUNDING.yml` | GitHub Sponsors: `marcusrbrown` |
| `readme.md` | Brief README with CI badge |
| `license.md` | MIT License |
| `.editorconfig` | Editor standards |
| `.gitattributes` | Git line-ending rules |
| `.vscode/settings.json` | VSCode workspace settings |
| `.vscode/spellright.dict` | Spell check dictionary |

## Common Settings Template

The `common-settings.yaml` file is the **primary artifact** in this repo. It defines Probot Settings defaults that other `marcusrbrown` repos inherit.

### Key Settings

- **Merge strategy:** Squash-only (merge commits and rebase disabled)
- **Squash commit title:** `COMMIT_OR_PR_TITLE`
- **Squash commit message:** `COMMIT_MESSAGES`
- **Auto-merge:** Enabled
- **Delete branch on merge:** Enabled
- **Allow update branch:** Enabled
- **Wiki/Projects:** Disabled
- **Vulnerability alerts:** Enabled
- **Automated security fixes:** Disabled

### Collaborators (Default)

| User           | Permission |
| -------------- | ---------- |
| `marcusrbrown` | admin      |
| `fro-bot`      | push       |

### Branch Protection (Default)

- Required status checks: strict (must be up-to-date), no specific contexts set in template
- Enforce admins: true
- **Required PR reviews: null** (no reviews required)
- Restrictions: null
- Linear history: required

### Labels

Extensive label set of **48 labels** (verified 2026-04-23) covering standard GitHub labels plus domain-specific labels: `github-actions`, `ci/cd`, `infrastructure`, `architecture`, `performance`, `a11y`, `renovate`, `automerge`, `technical-debt`, `code-quality`, and version-type labels (`major`, `minor`, `patch`). Also includes domain labels like `cli-tools`, `lighthouse`, `packageManager`, `e2e`, `cta`, `engagement`, `content-transformation`, `data-generation`.

## Settings Divergence from fro-bot/.github

The `common-settings.yaml` in this repo differs from the `fro-bot/.github` `common-settings.yaml` in notable ways:

| Setting | `marcusrbrown/.github` | `fro-bot/.github` |
| --- | --- | --- |
| `squash_merge_commit_title` | `COMMIT_OR_PR_TITLE` | `PR_TITLE` |
| `required_pull_request_reviews` | `null` (disabled) | 1 required reviewer, dismiss stale, code owner reviews, last push approval |
| Collaborator permissions | `marcusrbrown`: admin, `fro-bot`: push | `fro-bot`: admin, `marcusrbrown`: push |
| Label count | ~48 labels | ~18 labels |

This reflects the personal vs. org permission model: Marcus is admin on his personal repos, Fro Bot is admin on org repos.

## This Repo's Own Settings (.github/settings.yml)

Self-extends `common-settings.yaml` with repo-specific overrides:

- **Required status checks:** `Lint`, `Renovate / Renovate`
- **Required PR reviews:** null (inherits from template)
- **Description:** "GitHub defaults"
- **Topics:** `github`, `repository`, `settings`

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| main | `main.yaml` | push, PR, dispatch | Prettier format check |
| Renovate | `renovate.yaml` | PR (opened/reopened/synchronize/edited), issue edit, push (non-main), schedule (every 4h), workflow_call, workflow_dispatch, workflow_run (after main) | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to main, daily cron (02:55 UTC), dispatch | Probot settings sync |

### CI Details (main.yaml)

Minimal pipeline. Single `Lint` job:

1. Checkout branch via `actions/checkout@fbc6f399...` (SHA-pinned, v5.1.0) — uses `github.head_ref` ref
2. Run Prettier 3.9.6 via `creyD/prettier_action@31355f8e...` (SHA-pinned, v4.3) with `--check .`

No TypeScript checking, no tests, no additional linting. Appropriate for a YAML/Markdown-only repo.

**Concurrency:** `${{ github.workflow }}-${{ github.event.number || github.ref }}` — distinct slots for PRs (event number) vs push/dispatch (ref).

### Renovate Workflow (renovate.yaml)

Triggers on: PR events (opened, reopened, synchronize, edited), issue edits (non-bot actors only), push to non-main branches, `workflow_call`, `workflow_dispatch`, and `workflow_run` on completion of the `main` workflow. The `workflow_run` trigger gates Renovate runs to fire after successful CI — prevents Renovate from running against a broken main. Schedule trigger re-enabled at `15 */4 * * *` (every 4 hours at :15 past the hour).

Includes a conditional `if` gate: skips the job if the event is an issue edit by a bot actor, or if a `workflow_run` event didn't succeed.

Delegates fully to `bfra-me/.github` reusable workflow. Inputs: `log-level` (default `debug` or `vars.WORKFLOW_LOG_LEVEL`) and `print-config` (enabled on push events).

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` use reusable workflows from `bfra-me/.github` at SHA `4861d88a45367ff1cd81b7078a86ac1d691e9cb5` (v4.27.0, as of 2026-09-11). Authentication via `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App credentials).

Both refs track the same upstream tag and normally advance in the same Renovate PR (two changed files per bump, verified across #419/#420/#421/#424/#425). **They are not equally load-bearing.** `renovate.yaml` carries the updater itself; `update-repo-settings.yaml` is an ordinary consumer. The 2026-09-04 incident below turns on that asymmetry — the recovery edit had to touch exactly one of the two.

Note also the contrast with two `uses:`-path failure modes already on this wiki: [[marcusrbrown--esphome-life]] points its settings-sync job at the _Renovate_ workflow path (a settings sync that never syncs settings), and [[bfra-me--works]] holds a settings-sync ref frozen at v4.16.0 while its siblings advance. Here the path is correct and the ref moves in lockstep — `Update Repo Settings` has **571 lifetime runs, 30/30 `success` in the most recent window**, firing on both the daily cron and every push to `main`. This is the working reference implementation of the pattern those two repos get wrong.

## Developer Tooling

- **Prettier:** Config in `.prettierrc.yaml` — arrow parens `avoid`, no bracket spacing, `auto` EOL, 120 char width, no semicolons, single quotes, tab width 2. Overrides for `.vscode/*.json` and `.devcontainer/**/devcontainer*.json` (tab width 4) and `*.md` (double quotes).
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.9` (still v4.x — has _not_ joined the v4→v5 migration wave noted in [[marcusrbrown--renovate-config]]; listed among the holdouts there as of 2026-06-17, and unchanged since 2026-04-30, ~19 weeks). Post-upgrade runs `npx prettier@3.9.6 --no-color --write .`. PR creation set to `immediate`. Rebase when behind base branch.

## The 2026-09-04 Renovate Self-Update Deadlock

**Headline finding of the 2026-09-11 survey, and the reason a 132-day human-commit drought ended.** The dependency bot that maintains this repository delivered — through its own pull request — the upstream regression that disabled it, and then could not deliver the fix, because the pin that would carry the fix is the pin the bot is no longer running well enough to advance.

### Timeline (all times UTC)

| Time | Event |
| --- | --- |
| 09-04 13:23:43 | `bfra-me/renovate-action` **10.34.0** published, bundling Renovate **44.64.0**. `tar` is a devDependency in that bundle; the runtime needs it. |
| 09-04 16:27:10 | Renovate opens **#421** — `bfra-me/.github` v4.24.0 → **v4.25.0**, two files. |
| 09-04 16:28:17 | #421 merged. **This is the last thing Renovate accomplishes for 6h28m.** The workflow it just updated now resolves to the broken runner. |
| 09-04 18:27:48 | Upstream ships the fix: `renovate-action` **10.34.1** (Renovate 44.64.1, `tar` promoted to a production dependency). |
| 09-04 20:22:29 | Scheduled Renovate run #27299. Conclusion: **`success`**. PRs opened: **zero**. |
| 09-04 20:52:07 | `bfra-me/.github` **v4.25.1** published, release note verbatim: _"Update `bfra-me/renovate-action` to 10.34.1, which bundles Renovate 44.64.1 and promotes `tar` to a production dependency."_ The fix has now been sitting one tag away for four hours. |
| 09-04 22:56:41 | **Human PR #422** opened by `marcusrbrown` on branch `chore/bfra-me-github-v4.25.1`. **One file, one line**: `renovate.yaml` → v4.25.1 (`b21f524e`). |
| 09-04 22:58:04 | #422 merged. Commit body states the mechanism outright: _"Renovate on 10.34.0 exits before servicing any dependencies, so this pin cannot self-update."_ |
| 09-04 23:01:38 | Renovate — now running 10.34.1 — opens **#423**, one file, `update-repo-settings.yaml` → v4.25.1. |
| 09-04 23:02:04 | #423 merged. **Autonomy restored 3m34s after the manual intervention.** |
| 09-07 / 09-10 | v4.26.0 (#424) and v4.27.0 (#425) land normally, two files each. |

### Why this is a structural class and not an incident report

Three properties compound:

1. **The updater manages its own runner pin.** `renovate.yaml` is both a consumer of `bfra-me/.github` and the execution surface of the thing that bumps `bfra-me/.github`. That makes the runner a **bootstrap dependency**: a defect in it removes the only mechanism that can repair it. Every other pin in this repo has a self-healing path; this one has exactly one, and the defect is on it.
2. **The blast radius is a fleet, not a repo.** The broken version arrived via a _shared reusable workflow tag_. Any repo that took `bfra-me/.github` v4.25.0 in the 16:28 → 20:52 window inherited the same deadlock and needed the same out-of-band nudge. The deadlock is therefore not detectable from inside any single affected repo's automation; it is detectable only from a surface that is not itself Renovate.
3. **Recovery required knowing which of two identical-looking refs mattered.** Renovate's own bumps touch both workflow files. The human touched one. Bumping `update-repo-settings.yaml` would have been a correct-looking, fully-green, completely useless change.

### The health signal was not just absent — it was inverted

This is the part worth carrying forward. Across the Renovate workflow's most recent 60 runs there were 7 failures, and **not one of them is in the outage window**:

- During the deadlock (16:28 → 22:56), every Renovate execution concluded **`success`** — including the 20:22 scheduled run — while servicing zero dependencies. `Renovate` is a required status check on `main`; it was green the entire time.
- The failures cluster **after** the fix: runs at 22:58 and 23:02 (both `workflow_run`, both failing at step 7 `Renovate` after ~20 minutes), then 09-05 07:14 and 08:26, 09-06 04:25, 09-10 01:00 and 20:21 — all on the _repaired_ pin.

A conclusion-based liveness check would have reported the broken interval as healthy and the healthy intervals as broken. That is worse than no monitor: it is a monitor with the sign flipped.

The correct detector measures **delivery**, not conclusion. Available cheap signals here: PRs opened per scheduled cycle (this repo's steady state is ~1 bump every 2–3 days and a `15 */4` cron, so "N consecutive scheduled runs with no Renovate-authored activity and a non-empty Dependency Dashboard" is a real alarm), or the `updated_at` of Dependency Dashboard issue **#214**.

This is a second, independent confirmation of the rule first recorded at [[marcusrbrown--cortexkit-anthropic-auth]] — _a run's conclusion measures the harness, not the deliverable_ — reached by a different mechanism (a missing runtime binary rather than a prose size budget), and it adds the inversion case that observation did not have. Generalized in [[github-actions-ci]].

### Chronic Renovate failure rate (separate condition)

The 09-04/09-05/09-06/09-10 failures are background noise, not fallout. The Renovate workflow has **253 failed runs in its lifetime**, distributed 2026-05: 5, 06: 63, 07: 18, 08: 7, 09: 7-in-11-days. All inspected failures die at step 7 (`Renovate`) after 18–23 minutes of execution, which reads as a long-run terminal condition rather than a setup fault. Job logs require authentication and were not readable this pass; the cause is **unresolved** and recorded as an open question. September's rate is ~2.2× August's and warrants a look next survey.

## Community Health Files

As a `.github` repo, these files serve as **defaults** for all `marcusrbrown` repositories that lack their own versions:

- **CODE_OF_CONDUCT.md** — Contributor Covenant v1.4. Contact: `git@mrbro.dev`.
- **FUNDING.yml** — GitHub Sponsors configuration: `marcusrbrown`.
- **license.md** — MIT License.
- **readme.md** — Not inherited (each repo has its own).

## Fro Bot Integration

**No Fro Bot agent workflow detected** (still absent as of 2026-09-11 — **fourteen consecutive surveys**). The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration for automated PR review and triage.

`fro-bot` is listed as a collaborator with `push` permission in both `common-settings.yaml` (template) and `.github/settings.yml` (this repo). This confirms Fro Bot has write access but no active workflow to trigger its review capabilities. All recent PRs (#388–#425) except #422 have been Renovate dependency bumps authored by `mrbro-bot[bot]` and auto-merged — Fro Bot is not in the merge loop.

**Recommendation (still open, and now with a concrete motivating incident):** A follow-up draft PR should add the Fro Bot agent workflow. The single-file three-mode template established in [[marcusrbrown--marcusrbrown-github-io]] and [[marcusrbrown--renovate-config]] is the current canonical shape.

The 2026-09-04 deadlock sharpens the case and also bounds it honestly:

- **What an agent would buy here.** A scheduled pass is the out-of-band surface this repo does not have. The deadlock is invisible to Renovate by construction, so the detector has to run on a different daemon — and the detection query is trivial (Dependency Dashboard `updated_at`, or PR-creation count over the last N scheduled cycles). The repair is a one-line `uses:` bump, i.e. squarely inside what autoheal already proposes elsewhere in the fleet.
- **What it would not buy.** A Fro Bot autoheal PR still has to _merge_. Six repos on this wiki show fully-green agent PRs parked for weeks ([[marcusrbrown--tokentoilet]], [[marcusrbrown--marcusrbrown-com]], [[marcusrbrown--sparkle]]). This repo is the unusual case where that objection is weak: `required_pull_request_reviews: null`, auto-merge on, and every bot PR in the sampled history merged within ~90 seconds of opening. The merge gate is not the bottleneck here — the missing daemon is.
- **Standing caveat.** An agent that proposes bumps would be a second writer against the same `uses:` lines Renovate owns, which is the re-derivation/duplicate-authoring class already cataloged in [[github-actions-ci]]. Scope any such workflow to _detect and report_ on this repo, or to act only when Renovate's delivery signal has been flat for multiple cycles.

## Survey History

| Date | SHA | Changes |
| --- | --- | --- |
| 2025-06-18 | `be01029` | Initial ingest |
| 2026-04-21 | `be01029` | Re-survey — no change in repo content; additive wiki updates only (label count verified, workflow details expanded, related links extended) |
| 2026-04-22 | `be01029` | Re-survey — no change since 2026-04-21; repo content identical at same SHA |
| 2026-04-23 | `4e4fd28` | Prettier 3.8.1→3.8.3, Renovate preset #4.5.1→#4.5.8, bfra-me/.github v4.4.0→v4.16.8, renovate.yaml restructured (PR+issue triggers, schedule commented out, reusable+conditional logic), prCreation set to immediate, .prettierrc.yaml expanded with .devcontainer override, label count 48 |
| 2026-04-24 | `4e4fd28` | Re-survey — no change since 2026-04-23; repo content identical at same SHA |
| 2026-04-25 | `4e4fd28` | Re-survey — no change since 2026-04-24; repo content identical at same SHA |
| 2026-04-26 | `99906ef` | Renovate schedule trigger re-enabled at `15 */4 * * *` (every 4 hours at :15), replacing the commented-out hourly cron |
| 2026-04-27 | `3fb30a4` | `bfra-me/.github` reusable workflows bumped v4.16.8 → v4.16.9 (SHA `4b85695b`) in both `renovate.yaml` and `update-repo-settings.yaml` |
| 2026-05-25 | `0b780fd` | Dependency-only churn since 2026-04-27. `bfra-me/.github` reusable workflows: v4.16.9 → v4.16.20 (11 patch bumps via PRs #363–#375, now pinned at SHA `dc366698`). `marcusrbrown/renovate-config` preset: v4.5.8 → v4.5.9 (PR #366, 2026-04-30). All other files identical: `common-settings.yaml` unchanged, workflows structurally identical, no new files. Still no Fro Bot workflow; Renovate cadence still `15 */4 * * *`. Renovate preset remains on v4.x (holdout from v5 wave). |
| 2026-06-06 | `a00e888` | Dependency-only churn since 2026-05-25. `bfra-me/.github` reusable workflows advanced v4.16.20 → v4.16.23 via PRs #376 (2026-05-28), #377 (2026-06-01), #378 (2026-06-04), now pinned at SHA `e972072a`. All other files identical: `common-settings.yaml` unchanged, workflows structurally unchanged, `renovate.json5` preset still `marcusrbrown/renovate-config#4.5.9`. Still no Fro Bot workflow. 2 open issues (#37, #214), 0 open PRs. Renovate preset remains on v4.x. |
| 2026-06-17 | `1c97ca8` | Dependency-only churn since 2026-06-06. `bfra-me/.github` reusable workflows advanced v4.16.23 → v4.16.26 via PRs #379 (2026-06-08), #380 (2026-06-11), #382 (2026-06-15), now pinned at SHA `dd6ab968`. Prettier bumped 3.8.3 → 3.8.4 (PR #381, 2026-06-12) — propagated to `main.yaml` `PRETTIER_VERSION` env and `renovate.json5` post-upgrade task. `common-settings.yaml`, `settings.yml`, and `.prettierrc.yaml` all unchanged; same 16-entry file tree, no new paths. `renovate.json5` preset still `marcusrbrown/renovate-config#4.5.9` (v4.x holdout). Still no Fro Bot workflow. 2 open issues (#37, #214), 0 open PRs, 3 stars, 2 watchers. |
| 2026-06-28 | `d516b2f` | Dependency-only churn since 2026-06-17. `bfra-me/.github` reusable workflows advanced v4.16.26 → v4.16.31 via PRs #383 (2026-06-18), #384 (2026-06-22), #385 (2026-06-25), #386 (2026-06-25), #387 (2026-06-25), now pinned at SHA `7c7e50a5` in both `renovate.yaml` and `update-repo-settings.yaml`. Three of the five v4.16.x bumps landed on a single day (2026-06-25), accounting for the `pushed_at` jump to 2026-06-25T20:55Z. `common-settings.yaml` (still `b120b52`, last edited 2025-10-12), `settings.yml`, `.prettierrc.yaml`, `main.yaml` (Prettier still 3.8.4) all unchanged; same 16-blob file tree, no new paths. `renovate.json5` preset still `marcusrbrown/renovate-config#4.5.9` (v4.x holdout, ~10 weeks behind [[marcusrbrown--renovate-config]] at v5.2.3). Still no Fro Bot workflow. 2 open issues (#37, #214 Dependency Dashboard), 0 open PRs, **4 stars** (3→4), 2 watchers. |
| 2026-07-28 | `7ce5ae7` | Dependency-only churn since 2026-06-28. `bfra-me/.github` reusable workflows advanced v4.16.31 → v4.16.41 (PRs #392, #395, #396, #398, #399, #401, #403, #404, #406), now pinned at SHA `95a066eb` in both `renovate.yaml` and `update-repo-settings.yaml`. Prettier bumped 3.8.4 → 3.9.6 across a run of releases (PRs #391 v3.9.1, #393 v3.9.3, #394 v3.9.4, #397 v3.9.5, #405 v3.9.6) — propagated to `main.yaml` `PRETTIER_VERSION` env and `renovate.json5` post-upgrade task. `actions/checkout` bumped v5.0.1 → v5.1.0 (PR #402, SHA `fbc6f399`). `common-settings.yaml`, `settings.yml`, `.prettierrc.yaml` all unchanged; same 15-blob file tree, no new paths. `renovate.json5` preset still `marcusrbrown/renovate-config#4.5.9` (v4.x holdout). Still no Fro Bot workflow. 2 open issues (#37, #214 Dependency Dashboard), 0 open PRs, 4 stars, 2 watchers. `pushed_at` 2026-07-26T21:12Z. |
| 2026-08-29 | `66270ba` | Dependency-only churn since 2026-07-28. `bfra-me/.github` reusable workflows advanced v4.16.41 → v4.22.0 (latest merge #418, `chore(deps): update bfra-me/.github action to v4.22.0`, 2026-08-27), now pinned at SHA `b830359a` in both `renovate.yaml` and `update-repo-settings.yaml` — crosses the v4.16 → v4.22 minor band in one wiki interval. Prettier steady at 3.9.6 (`main.yaml` `PRETTIER_VERSION` + `renovate.json5` post-upgrade unchanged); `actions/checkout` steady at v5.1.0 (`fbc6f399`). `common-settings.yaml`, `settings.yml`, `.prettierrc.yaml`, `main.yaml` lint job all unchanged; same 15-blob file tree, no new paths, no `fro-bot.yaml`. `renovate.json5` preset still `marcusrbrown/renovate-config#4.5.9` (v4.x holdout, now ~14 weeks behind [[marcusrbrown--renovate-config]] at v5.2.x). Still no Fro Bot workflow (13th consecutive survey). 2 open issues (#37 move-settings-action, #214 Dependency Dashboard), 0 open PRs, 4 stars, 2 watchers. `pushed_at` 2026-08-27T02:02Z. |
| 2026-09-11 | `002d2f5` | **First non-dependency finding in fourteen surveys, and the first human commit in 132 days.** Tree still 15 blobs, byte-identical paths, `common-settings.yaml` still blob `b120b52` (48 labels, 2 collaborators re-verified), Prettier steady at 3.9.6, `actions/checkout` steady at v5.1.0, preset still `#4.5.9`, still no `fro-bot.yaml`. 7 commits: `bfra-me/.github` v4.22.0 → **v4.27.0** (#419 v4.23.0, #420 v4.24.0, #421 v4.25.0, **#422 human**, #423 v4.25.1, #424 v4.26.0, #425 v4.27.0), now SHA `4861d88a` in both workflows. **The interval's content is #422:** `bfra-me/renovate-action` 10.34.0 (Renovate 44.64.0, `tar` missing from the runtime bundle) arrived via Renovate's own PR #421 at 16:28 and left Renovate exiting before servicing any dependency; upstream fixed it at 18:27 (10.34.1) and tagged it at 20:52 (v4.25.1), but the pin that carries the fix _is_ the pin Renovate can no longer advance. `marcusrbrown` hand-bumped **one line in one file** — `renovate.yaml`, not the sibling `update-repo-settings.yaml` — at 22:56; Renovate opened #423 for the remaining file **3m34s** after that merged. Total inert window 6h28m, of which ~4h was avoidable stall with the fix already published. **The run-conclusion signal was inverted**: every execution inside the outage concluded `success` (including the 20:22 scheduled run, zero PRs opened) while all 7 recent failures sit outside it, on the repaired pin. Chronic Renovate failure rate recorded separately (253 lifetime; Sept at 7-in-11-days vs Aug's 7) and left unresolved — step 7 dies after 18–23 min, logs need auth. `Update Repo Settings` healthy (571 lifetime runs, 30/30 success) and correctly pathed, the counter-example to [[marcusrbrown--esphome-life]] and [[bfra-me--works]]. Noted that `updated_at` here tracks the settings-sync cron, not content. 2 open issues (#37, #214), 0 open PRs, 4 stars, 2 watchers, `pushed_at` 2026-09-10T01:00:33Z. Branch protection not re-read (unauthenticated survey token; `settings.yml` declaration carried forward). |

## Notable Patterns

- **Self-extending settings:** The `.github/settings.yml` extends from the same repo's `common-settings.yaml` — a clean pattern for testing the template against itself.
- **bfra-me dependency:** Core workflow infrastructure (Renovate runner, settings sync) is delegated to `bfra-me/.github` reusable workflows, reducing maintenance burden.
- **Minimal CI for minimal code:** Prettier-only CI is appropriate for a repo with no application code. No over-engineering.
- **Template repo for personal settings:** This repo's `common-settings.yaml` is the source of truth for repository governance across Marcus's personal GitHub account.
- **SHA-pinned actions:** Both `actions/checkout` and `creyD/prettier_action` are pinned by full commit SHA with version comments — consistent with the broader `@bfra.me` ecosystem standard.
- **Renovate/CI ordering:** `renovate.yaml` triggers on `workflow_run` completion of `main` — Renovate never runs against a broken CI baseline.
- **The updater cannot update itself (2026-09-11):** `renovate.yaml` pins the reusable workflow that _is_ Renovate. That makes it a bootstrap dependency with no self-repair path — the single pin in this repo whose failure mode is unrecoverable by automation. Everything else here is elegantly self-maintaining, which is exactly why the one exception went unnoticed until it bit. The shape of the fix is instructive: one line, one file, chosen because the human knew which of two identical-looking refs was load-bearing.
- **Delivery, not conclusion (2026-09-11):** Because `Renovate` is a required check that passes when Renovate does nothing, this repo has no true liveness signal on its only active automation. The cheapest real one already exists — Dependency Dashboard #214's `updated_at`, or PR-creation count per scheduled cycle.
- **Renovate hybrid trigger model:** The `renovate.yaml` combines event-driven triggers (PR events, issue edits, push, workflow_run) with a 4-hour cron schedule (`15 */4 * * *`). The schedule was initially commented out (2026-04-23) then re-enabled (2026-04-25), landing on a 4-hour cadence rather than the original hourly frequency — a pragmatic balance between responsiveness and CI cost.
