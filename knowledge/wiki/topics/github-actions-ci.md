---
type: topic
title: GitHub Actions CI/CD
created: 2026-04-18
updated: 2026-04-18
tags: [github-actions, ci-cd, automation, workflows]
related:
  - marcusrbrown--marcusrbrown
  - marcusrbrown--ha-config
---

# GitHub Actions CI/CD

Cross-cutting patterns for GitHub Actions usage across Marcus's repositories.

## Repos Using GitHub Actions

- [[marcusrbrown--marcusrbrown]] — Profile README automation (lint, scheduled content generation, cache cleanup)
- [[marcusrbrown--ha-config]] — Home Assistant config validation (YAML lint, Remark lint, Prettier, HA config check)

## Common Patterns

### Shared Reusable Workflows

Both repos reference reusable workflows from `bfra-me/.github` for Renovate and repository settings sync. Authentication uses GitHub App tokens via `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets with `actions/create-github-app-token`.

### Setup Action

Repos use a local `.github/actions/setup` composite action for consistent environment bootstrapping (Node.js + pnpm install). This avoids drift from ad-hoc setup steps.

### Concurrency Groups

Standard concurrency pattern observed across repos:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.number || github.ref }}
  cancel-in-progress: true
```

### Branch Protection via CI

Required status checks enforce CI passage before merge. Both repos use `strict: false` for status checks (no rebase requirement) with `required_linear_history: true`.

### Probot Settings Sync

Repository settings are managed via Probot, extending `fro-bot/.github:common-settings.yaml`. A dedicated `update-repo-settings.yaml` workflow applies settings on push to main, daily cron, and manual dispatch.

### Renovate Integration

Renovate workflows trigger on issue/PR edits, non-main pushes, dispatch, and after Main workflow completion. All extend `marcusrbrown/renovate-config` with repo-specific overrides. Post-upgrade tasks typically run `pnpm bootstrap` and `pnpm fix`.

### Cache Cleanup

`cleanup-cache.yaml` prunes stale GHA cache entries on PR close and weekly schedule to control storage usage.

### Commit Authorship

Automated commits use GitHub App bot identities (`mrbro-bot[bot]` in profile repo). Signed commits are enabled where supported (`peter-evans/create-pull-request` with `sign-commits: true`).
