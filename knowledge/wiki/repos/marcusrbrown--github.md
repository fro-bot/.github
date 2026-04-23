---
type: repo
title: "marcusrbrown/.github"
created: 2025-06-18
updated: 2026-04-23
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
- **Last push:** 2026-04-23
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
| `.github/renovate.json5` | Renovate config (extends `marcusrbrown/renovate-config#4.5.8`) |
| `.github/workflows/main.yaml` | CI: Prettier check only |
| `.github/workflows/renovate.yaml` | Renovate runner (reusable from `bfra-me/.github@v4.16.8`) |
| `.github/workflows/update-repo-settings.yaml` | Probot settings sync (reusable from `bfra-me/.github@v4.16.8`) |
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
| Renovate | `renovate.yaml` | PR (opened/reopened/synchronize/edited), issue edit, push (non-main), workflow_call, workflow_dispatch, workflow_run (after main) | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to main, daily cron (02:55 UTC), dispatch | Probot settings sync |

### CI Details (main.yaml)

Minimal pipeline. Single `Lint` job:

1. Checkout branch via `actions/checkout@93cb6efe...` (SHA-pinned, v5.0.1) — uses `github.head_ref` ref
2. Run Prettier 3.8.3 via `creyD/prettier_action@31355f8e...` (SHA-pinned, v4.3) with `--check .`

No TypeScript checking, no tests, no additional linting. Appropriate for a YAML/Markdown-only repo.

**Concurrency:** `${{ github.workflow }}-${{ github.event.number || github.ref }}` — distinct slots for PRs (event number) vs push/dispatch (ref).

### Renovate Workflow (renovate.yaml)

Triggers on: PR events (opened, reopened, synchronize, edited), issue edits (non-bot actors only), push to non-main branches, `workflow_call`, `workflow_dispatch`, and `workflow_run` on completion of the `main` workflow. The `workflow_run` trigger gates Renovate runs to fire after successful CI — prevents Renovate from running against a broken main. The hourly schedule trigger is commented out.

Includes a conditional `if` gate: skips the job if the event is an issue edit by a bot actor, or if a `workflow_run` event didn't succeed.

Delegates fully to `bfra-me/.github` reusable workflow. Inputs: `log-level` (default `debug` or `vars.WORKFLOW_LOG_LEVEL`) and `print-config` (enabled on push events).

### Shared Workflows

Both `renovate.yaml` and `update-repo-settings.yaml` use reusable workflows from `bfra-me/.github` at SHA `bedac8bd7b81a7832ae494873da2971e5ea7a8d4` (v4.16.8). Authentication via `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App credentials).

## Developer Tooling

- **Prettier:** Config in `.prettierrc.yaml` — arrow parens `avoid`, no bracket spacing, `auto` EOL, 120 char width, no semicolons, single quotes, tab width 2. Overrides for `.vscode/*.json` and `.devcontainer/**/devcontainer*.json` (tab width 4) and `*.md` (double quotes).
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8`. Post-upgrade runs `npx prettier@3.8.3 --no-color --write .`. PR creation set to `immediate`. Rebase when behind base branch.

## Community Health Files

As a `.github` repo, these files serve as **defaults** for all `marcusrbrown` repositories that lack their own versions:

- **CODE_OF_CONDUCT.md** — Contributor Covenant v1.4. Contact: `git@mrbro.dev`.
- **FUNDING.yml** — GitHub Sponsors configuration: `marcusrbrown`.
- **license.md** — MIT License.
- **readme.md** — Not inherited (each repo has its own).

## Fro Bot Integration

**No Fro Bot agent workflow detected.** The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration for automated PR review and triage.

`fro-bot` is listed as a collaborator with `push` permission in both `common-settings.yaml` (template) and `.github/settings.yml` (this repo). This confirms Fro Bot has write access but no active workflow to trigger its review capabilities.

**Recommendation:** A follow-up draft PR should add the Fro Bot agent workflow for automated PR review and triage on this repository.

## Survey History

| Date | SHA | Changes |
| --- | --- | --- |
| 2025-06-18 | `be01029` | Initial ingest |
| 2026-04-21 | `be01029` | Re-survey — no change in repo content; additive wiki updates only (label count verified, workflow details expanded, related links extended) |
| 2026-04-22 | `be01029` | Re-survey — no change since 2026-04-21; repo content identical at same SHA |
| 2026-04-23 | `4e4fd28` | Prettier 3.8.1→3.8.3, Renovate preset #4.5.1→#4.5.8, bfra-me/.github v4.4.0→v4.16.8, renovate.yaml restructured (PR+issue triggers, schedule commented out, reusable+conditional logic), prCreation set to immediate, .prettierrc.yaml expanded with .devcontainer override, label count 48 |

## Notable Patterns

- **Self-extending settings:** The `.github/settings.yml` extends from the same repo's `common-settings.yaml` — a clean pattern for testing the template against itself.
- **bfra-me dependency:** Core workflow infrastructure (Renovate runner, settings sync) is delegated to `bfra-me/.github` reusable workflows, reducing maintenance burden.
- **Minimal CI for minimal code:** Prettier-only CI is appropriate for a repo with no application code. No over-engineering.
- **Template repo for personal settings:** This repo's `common-settings.yaml` is the source of truth for repository governance across Marcus's personal GitHub account.
- **SHA-pinned actions:** Both `actions/checkout` and `creyD/prettier_action` are pinned by full commit SHA with version comments — consistent with the broader `@bfra.me` ecosystem standard.
- **Renovate/CI ordering:** `renovate.yaml` triggers on `workflow_run` completion of `main` — Renovate never runs against a broken CI baseline.
- **Renovate event-driven trigger model:** The renovated `renovate.yaml` uses a rich trigger model (PR events, issue edits, push, workflow_run) rather than a fixed schedule. The previous hourly cron schedule is now commented out, shifting entirely to event-driven execution. This avoids unnecessary runs while ensuring timely updates.
