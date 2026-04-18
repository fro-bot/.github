---
type: topic
title: GitHub Actions CI
created: 2026-04-18
updated: 2026-04-18
tags: [github-actions, ci-cd, automation, workflows]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--vbs
---

# GitHub Actions CI

Cross-cutting patterns for GitHub Actions CI/CD observed across the Fro Bot-managed ecosystem.

## Repos Using GitHub Actions

- [[marcusrbrown--ha-config]] — YAML lint, Remark lint, Prettier, HA config validation
- [[marcusrbrown--vbs]] — ESLint, TypeScript type-check, Vitest coverage, Vite build, GitHub Pages deploy

## Common Patterns

### Shared Setup Actions

Repos use local composite actions (`.github/actions/setup-pnpm` or `.github/actions/setup`) to bootstrap the environment. This avoids duplicating setup steps across workflows and prevents drift.

### Probot Settings Sync

Repos extend `fro-bot/.github:common-settings.yaml` via `.github/settings.yml` for consistent repository configuration (branch protection, topics, description). Sync runs via a shared reusable workflow from `bfra-me/.github`.

### Renovate Configuration

Both repos extend `marcusrbrown/renovate-config` for dependency management. Post-upgrade tasks run formatting/linting fixes. Configured via `.github/renovate.json5`.

### Branch Protection

Common pattern: required status checks on `main`, linear history enforced, admin enforcement enabled. No required PR reviews — automation handles review via Fro Bot.

### Fro Bot Agent Workflow

The `fro-bot.yaml` workflow pattern uses `fro-bot/agent` for:

- PR review (triggered on PR events, excludes forks and bot authors)
- Scheduled maintenance (daily rolling report issues)
- Ad-hoc dispatch (custom prompts via `workflow_dispatch`)
- Mention-triggered responses (`@fro-bot` in comments, restricted to OWNER/MEMBER/COLLABORATOR)

Concurrency groups prevent parallel runs on the same issue/PR.

**Observed in:** [[marcusrbrown--vbs]] **Not yet present in:** [[marcusrbrown--ha-config]] (noted for follow-up)

### Fro Bot Autoheal Workflow

A separate `fro-bot-autoheal.yaml` workflow runs daily automated repository healing: fixing errored PRs, remediating security alerts, checking code quality, and validating data integrity. Hard-bounded to prevent destructive actions.

**Observed in:** [[marcusrbrown--vbs]]

### Pin-by-SHA

All action references use full commit SHA pins with version comments (e.g., `actions/checkout@<sha> # v6.0.2`). This is a security best practice preventing supply-chain attacks via tag mutation.

### GitHub App Tokens

Workflows that need elevated permissions (e.g., creating PRs, pushing to branches) use `actions/create-github-app-token` with `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets rather than personal access tokens, limiting blast radius.

## Deployment Patterns

### GitHub Pages

[[marcusrbrown--vbs]] deploys via `actions/deploy-pages` with:

- `actions/configure-pages` for setup
- `actions/upload-pages-artifact` for the build output
- Dedicated `github-pages` environment with URL output
- Concurrency group `pages` with `cancel-in-progress: false`
- Permissions: `contents: read`, `pages: write`, `id-token: write`

## Coverage Reporting

[[marcusrbrown--vbs]] uploads coverage to Codecov via `codecov/codecov-action` from lcov output.
