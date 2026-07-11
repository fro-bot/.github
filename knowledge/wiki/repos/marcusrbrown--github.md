---
type: repo
title: "marcusrbrown/.github"
created: 2025-06-18
updated: 2026-06-28
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
tags: [github, repository-settings, probot, community-health, prettier, renovate]
aliases: [marcusrbrown-dotgithub]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--containers
  - marcusrbrown--mrbro-dev
  - marcusrbrown--vbs
  - marcusrbrown--infra
  - marcusrbrown--dotfiles
  - probot-settings
---

# marcusrbrown/.github

Marcus R. Brown's personal `.github` repository. Provides GitHub defaults, community health files, and the canonical [[probot-settings]] template (`common-settings.yaml`) consumed by his other repositories.

## Overview

- **Purpose:** GitHub defaults and community health files for `marcusrbrown` repositories
- **Default branch:** `main`
- **Created:** 2020-10-30
  - **Last push:** 2026-06-15
- **Topics:** `github`, `repository`, `settings`
- **License:** MIT
- **Language:** None (YAML/Markdown only, no application code)
- **Visibility:** Public

## Repository Structure

Lean repo, 15 files total. No application code, no `package.json`, no TypeScript.

| Path | Purpose |
| --- | --- |
| `common-settings.yaml` | **Canonical Probot Settings template** — extended by other Marcus repos via `_extends: .github:common-settings.yaml` |
| `.github/settings.yml` | This repo's own Probot settings, self-extending `common-settings.yaml` |
| `.github/renovate.json5` | Renovate config (extends `marcusrbrown/renovate-config#4.5.9`) |
| `.github/workflows/main.yaml` | CI: Prettier check only |
| `.github/workflows/renovate.yaml` | Renovate runner (reusable from `bfra-me/.github@v4.16.26`) |
| `.github/workflows/update-repo-settings.yaml` | Probot settings sync (reusable from `bfra-me/.github@v4.16.26`) |
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

1. Checkout branch via `actions/checkout@93cb6efe...` (SHA-pinned, v5.0.1) — uses `github.head_ref` ref
2. Run Prettier 3.8.4 via `creyD/prettier_action@31355f8e...` (SHA-pinned, v4.3) with `--check .`

No TypeScript checking, no tests, no additional linting. Appropriate for a YAML/Markdown-only repo.

**Concurrency:** `${{ github.workflow }}-${{ github.event.number || github.ref }}` — distinct slots for PRs (event number) vs push/dispatch (ref).

### Renovate Workflow (renovate.yaml)

Triggers on: PR events (opened, reopened, synchronize, edited), issue edits (non-bot actors only), push to non-main branches, `workflow_call`, `workflow_dispatch`, and `workflow_run` on completion of the `main` workflow. The `workflow_run` trigger gates Renovate runs to fire after successful CI — prevents Renovate from running against a broken main. Schedule trigger re-enabled at `15 */4 * * *` (every 4 hours at :15 past the hour).

Includes a conditional `if` gate: skips the job if the event is an issue edit by a bot actor, or if a `workflow_run` event didn't succeed.

Delegates fully to `bfra-me/.github` reusable workflow. Inputs: `log-level` (default `debug` or `vars.WORKFLOW_LOG_LEVEL`) and `print-config` (enabled on push events).

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` use reusable workflows from `bfra-me/.github` at SHA `7c7e50a51f430b42aae2165e5d555847aa738ba9` (v4.16.31, as of 2026-06-28). Authentication via `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App credentials).

## Developer Tooling

- **Prettier:** Config in `.prettierrc.yaml` — arrow parens `avoid`, no bracket spacing, `auto` EOL, 120 char width, no semicolons, single quotes, tab width 2. Overrides for `.vscode/*.json` and `.devcontainer/**/devcontainer*.json` (tab width 4) and `*.md` (double quotes).
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.9` (still v4.x — has _not_ joined the v4→v5 migration wave noted in [[marcusrbrown--renovate-config]]; listed among the holdouts there as of 2026-06-17). Post-upgrade runs `npx prettier@3.8.4 --no-color --write .`. PR creation set to `immediate`. Rebase when behind base branch.

## Community Health Files

As a `.github` repo, these files serve as **defaults** for all `marcusrbrown` repositories that lack their own versions:

- **CODE_OF_CONDUCT.md** — Contributor Covenant v1.4. Contact: `git@mrbro.dev`.
- **FUNDING.yml** — GitHub Sponsors configuration: `marcusrbrown`.
- **license.md** — MIT License.
- **readme.md** — Not inherited (each repo has its own).

## Fro Bot Integration

**No Fro Bot agent workflow detected** (still absent as of 2026-06-28). The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration for automated PR review and triage.

`fro-bot` is listed as a collaborator with `push` permission in both `common-settings.yaml` (template) and `.github/settings.yml` (this repo). This confirms Fro Bot has write access but no active workflow to trigger its review capabilities. All recent PRs (#376–#387) have been Renovate dependency bumps authored by `mrbro-bot[bot]` and auto-merged — Fro Bot is not in the merge loop.

**Recommendation (still open):** A follow-up draft PR should add the Fro Bot agent workflow for automated PR review and triage on this repository. The single-file three-mode template established in [[marcusrbrown--marcusrbrown-github-io]] and [[marcusrbrown--renovate-config]] is the current canonical shape.

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

## Notable Patterns

- **Self-extending settings:** The `.github/settings.yml` extends from the same repo's `common-settings.yaml` — a clean pattern for testing the template against itself.
- **bfra-me dependency:** Core workflow infrastructure (Renovate runner, settings sync) is delegated to `bfra-me/.github` reusable workflows, reducing maintenance burden.
- **Minimal CI for minimal code:** Prettier-only CI is appropriate for a repo with no application code. No over-engineering.
- **Template repo for personal settings:** This repo's `common-settings.yaml` is the source of truth for repository governance across Marcus's personal GitHub account.
- **SHA-pinned actions:** Both `actions/checkout` and `creyD/prettier_action` are pinned by full commit SHA with version comments — consistent with the broader `@bfra.me` ecosystem standard.
- **Renovate/CI ordering:** `renovate.yaml` triggers on `workflow_run` completion of `main` — Renovate never runs against a broken CI baseline.
- **Renovate hybrid trigger model:** The `renovate.yaml` combines event-driven triggers (PR events, issue edits, push, workflow_run) with a 4-hour cron schedule (`15 */4 * * *`). The schedule was initially commented out (2026-04-23) then re-enabled (2026-04-25), landing on a 4-hour cadence rather than the original hourly frequency — a pragmatic balance between responsiveness and CI cost.
