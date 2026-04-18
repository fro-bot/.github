---
type: topic
title: GitHub Actions CI Patterns
created: 2026-04-18
updated: 2026-04-18
tags: [github-actions, ci, cd, workflows, automation]
related:
  - marcusrbrown--infra
  - marcusrbrown--ha-config
---

# GitHub Actions CI Patterns

Cross-cutting CI/CD patterns observed across Marcus's repositories.

## Repos Using GitHub Actions

- [[marcusrbrown--infra]] -- Bun monorepo with 9 workflows (CI, deploy, release, Fro Bot, Renovate, Scorecard, etc.)
- [[marcusrbrown--ha-config]] -- Home Assistant config with 3 workflows (CI, Renovate, settings sync)

## Shared Infrastructure

### Probot Settings Sync

Both repos extend `fro-bot/.github:common-settings.yaml` via `.github/settings.yml` and use a reusable workflow from `bfra-me/.github` for repo settings synchronization. Trigger: daily cron + push to main + dispatch.

### Renovate

Both repos use Renovate extending `marcusrbrown/renovate-config`:

- `marcusrbrown/infra` extends `#4.5.8`, groups all non-major, runs post-upgrade `bun install --ignore-scripts && bun run fix`
- `marcusrbrown/ha-config` extends `#4.5.7`, custom managers for `.pre-commit-config.yaml` and `mise.toml`

Both use reusable Renovate workflows from `bfra-me/.github` with explicit secret passing (never `secrets: inherit` cross-org).

### GitHub App Authentication

Both repos use `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets for GitHub App token generation via `actions/create-github-app-token`. Used for Renovate, repo settings sync, and release workflows.

## Convention: Action Pinning

All actions are SHA-pinned with `# vX.Y.Z` version comments. Common pins observed:

| Action                            | SHA (infra)   | Version |
| --------------------------------- | ------------- | ------- |
| `actions/checkout`                | `de0fac2e...` | v6.0.2  |
| `actions/setup-node`              | `53b83947...` | v6.3.0  |
| `oven-sh/setup-bun`               | `0c5077e5...` | v2.2.0  |
| `actions/create-github-app-token` | `1b10c78c...` | v3.1.1  |

## Convention: Concurrency

- **CI workflows:** `cancel-in-progress: true` (safe to cancel duplicate runs)
- **Release/deploy workflows:** `cancel-in-progress: false` (never cancel in-progress deploys)
- **Fro Bot:** Per-PR/issue concurrency group, `cancel-in-progress: false` (autohealing runs must complete)

## Convention: Node Pin for ESLint

Workflows in `marcusrbrown/infra` that run ESLint or TypeScript must pin Node 24 via `actions/setup-node`. The ESLint binary uses `#!/usr/bin/env node` shebang, resolving to ubuntu-latest's Node 20 which lacks ES2024 APIs (`Object.groupBy`) required by `eslint-flat-config-utils`. This affects lint, type-check, and Fro Bot jobs.

## Convention: CI Install

Both repos avoid running post-install scripts in CI:

- infra: `bun install --frozen-lockfile --ignore-scripts` (skips `simple-git-hooks` postinstall)
- ha-config: N/A (YAML-based, no package install)

## Fro Bot Agent Workflow

Present in [[marcusrbrown--infra]] (`fro-bot.yaml`, uses `fro-bot/agent@v0.40.2`). **Not present** in [[marcusrbrown--ha-config]] (noted as follow-up for draft PR).

The infra Fro Bot workflow features:

- Structured PR review with Verdict/Blocking/Risk format
- 7-category daily autohealing schedule
- @fro-bot mention triggers (owner/member/collaborator only)
- Per-PR concurrency without cancellation

## Deploy Patterns

### Path-filtered deploys (infra)

`dorny/paths-filter` used because native `paths:` filter on `push` events breaks `workflow_dispatch`. Each app has a dedicated deploy job gated by:

1. Path filter match (docs, tests, fixtures excluded)
2. GitHub Environment approval
3. Post-deploy health check (HTTP 200)

### CI validation before deploy (ha-config)

HA config validation runs `frenck/action-home-assistant` against the HA version pinned in `.HA_VERSION`. This is a domain-specific equivalent of type-checking -- catches YAML errors, missing integrations, and breaking changes.

## OpenSSF Scorecard

Both repos run the `ossf/scorecard-action` for security posture assessment. Triggered on push to main and weekly schedule.

## Reusable Workflow Pattern

Cross-org reusable workflows from `bfra-me/.github` require explicit secret passing. The convention is never to use `secrets: inherit` with cross-org callers. Both repos follow this.
