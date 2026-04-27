---
type: topic
title: Probot Settings
created: 2025-06-18
updated: 2026-04-23
tags: [probot, github, repository-settings, automation, governance]
related:
  - marcusrbrown--github
  - marcusrbrown--ha-config
---

# Probot Settings

Repository configuration management via [Probot Settings](https://probot.github.io/apps/settings/) (repository-settings/app). Syncs `.github/settings.yml` declarations to GitHub repository settings, branch protection, labels, and collaborator access.

## How It Works

A `settings.yml` file in `.github/` declares the desired state of a repository. The Probot Settings App reads this file and applies the configuration to the GitHub repository via the API. Changes to `settings.yml` are synced automatically.

### Inheritance with `_extends`

Settings files can extend a base template using `_extends`:

```yaml
_extends: .github:common-settings.yaml
```

This pulls defaults from the named file. The extending file only needs to declare overrides. The `.github` shorthand resolves to the `{owner}/.github` repository — the conventional location for org/user-wide defaults.

## Usage Across Repos

### marcusrbrown/.github (Template Source)

[[marcusrbrown--github]] contains the canonical `common-settings.yaml` for Marcus's personal repositories. Its own `.github/settings.yml` self-extends this template, adding repo-specific overrides (description, topics, required status checks).

### marcusrbrown/ha-config

[[marcusrbrown--ha-config]] extends `fro-bot/.github:common-settings.yaml` (the Fro Bot org template) rather than Marcus's personal template. This means ha-config inherits Fro Bot org governance (1 required reviewer, code owner reviews, etc.) rather than Marcus's personal settings (no required reviews).

### fro-bot/.github (Org Template)

The `fro-bot/.github` repository (this repo) has its own `common-settings.yaml` with stricter governance:

- Required PR reviews (1 approver, dismiss stale, code owner reviews, last push approval)
- `fro-bot` as admin, `marcusrbrown` as push
- Fewer, more focused labels

## Settings Sync Workflow

Repos using Probot Settings typically include an `update-repo-settings.yaml` workflow:

- **Trigger:** Push to main, daily cron, manual dispatch
- **Implementation:** Reusable workflow from `bfra-me/.github`
- **Auth:** GitHub App via `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets
- **Reusable workflow version:** `bfra-me/.github` v4.16.8 (as of 2026-04-23 in [[marcusrbrown--github]])

## Common Configuration Patterns

### Merge Strategy

Both templates enforce squash-only merging (merge commits and rebase disabled) with auto-merge enabled and branch deletion on merge. This produces clean, linear git histories.

### Branch Protection

Both templates require linear history and enforce admin restrictions. The key divergence is PR review requirements — personal repos (marcusrbrown) skip reviews, org repos (fro-bot) require them.

### Collaborator Access Model

| Context        | `marcusrbrown` | `fro-bot` |
| -------------- | -------------- | --------- |
| Personal repos | admin          | push      |
| Org repos      | push           | admin     |

This dual-permission model ensures the appropriate entity has administrative control based on repo ownership.
