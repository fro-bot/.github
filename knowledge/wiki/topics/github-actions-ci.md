---
type: topic
title: GitHub Actions CI/CD
created: 2026-04-18
updated: 2026-04-18
tags: [github-actions, ci-cd, workflows, automation]
related:
  - marcusrbrown--infra
  - marcusrbrown--ha-config
---

# GitHub Actions CI/CD

CI/CD patterns observed across Marcus's repositories. All repos use GitHub Actions with SHA-pinned actions, reusable workflows from `bfra-me/.github`, and Probot settings synced from `fro-bot/.github:common-settings.yaml`.

## Repos Using GitHub Actions

- [[marcusrbrown--infra]] — Bun monorepo with CI (lint/type-check/test), deploy (path-filtered, environment-gated), release (Changesets), and Fro Bot agent
- [[marcusrbrown--ha-config]] — Home Assistant config with CI (YAML lint, Remark lint, Prettier, HA config validation)

## Common Patterns

### SHA-Pinned Actions

All repos SHA-pin GitHub Actions with a `# vX.Y.Z` version comment. This prevents supply-chain attacks from tag mutation while keeping version context visible.

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
```

### Reusable Workflows from `bfra-me/.github`

Both repos reference reusable workflows from `bfra-me/.github` for Renovate and repo settings sync. Critical convention: **never use `secrets: inherit` with cross-org reusable workflows** — pass secrets explicitly.

### Probot Settings Sync

Both repos extend `fro-bot/.github:common-settings.yaml` for repository configuration. Settings are synced via the `update-repo-settings.yaml` workflow (daily cron + push to `main`).

### Renovate

Both repos use Renovate extending `marcusrbrown/renovate-config`:

| Repo                        | Renovate Preset Version | Post-Upgrade Tasks            |
| --------------------------- | ----------------------- | ----------------------------- |
| [[marcusrbrown--infra]]     | #4.5.8                  | `bun install` + `bun run fix` |
| [[marcusrbrown--ha-config]] | #4.5.7                  | Prettier formatting           |

### Branch Protection

Both repos enforce linear history and admin enforcement on `main`, with required status checks but no required PR reviews.

## Divergent Patterns

### CI Strategy

| Aspect     | [[marcusrbrown--infra]]                  | [[marcusrbrown--ha-config]]                      |
| ---------- | ---------------------------------------- | ------------------------------------------------ |
| Runtime    | Bun + Node 24 (pinned for ES2024 compat) | Python + YAML tooling                            |
| Lint       | ESLint via `@bfra.me/eslint-config`      | `frenck/action-yamllint` + Remark + Prettier     |
| Type check | `bunx tsc --noEmit`                      | N/A (YAML config)                                |
| Tests      | `bun test --recursive`                   | `frenck/action-home-assistant` config validation |
| CI gate    | Summary job checking lint + type-check   | All jobs must pass                               |

### Deploy

| Aspect       | [[marcusrbrown--infra]]                            | [[marcusrbrown--ha-config]]  |
| ------------ | -------------------------------------------------- | ---------------------------- |
| Mechanism    | SSH/rsync (KeeWeb), Docker Compose (CLIProxyAPI)   | N/A (config repo, no deploy) |
| Gating       | `dorny/paths-filter` + GitHub Environment approval | N/A                          |
| Health check | Post-deploy `curl` verification                    | N/A                          |

### Fro Bot Integration

| Aspect            | [[marcusrbrown--infra]]                      | [[marcusrbrown--ha-config]]       |
| ----------------- | -------------------------------------------- | --------------------------------- |
| Workflow present  | Yes (`fro-bot.yaml`)                         | **No** — follow-up PR recommended |
| PR review         | Structured verdict (PASS/CONDITIONAL/REJECT) | N/A                               |
| Daily autohealing | 7-category schedule + live site review       | N/A                               |

## Node Version Pinning

The `marcusrbrown/infra` repo documents an important CI pitfall: ESLint's binary shebang uses `#!/usr/bin/env node`, which resolves to system Node on ubuntu-latest (Node 20). Transitive dependencies like `eslint-flat-config-utils` require ES2024 APIs (e.g., `Object.groupBy`) unavailable in Node 20. The fix is explicit `actions/setup-node` with Node 24 in all workflows that run linting or type-checking.

## Authentication Pattern

Both repos use GitHub App tokens (`APPLICATION_ID` + `APPLICATION_PRIVATE_KEY`) via `actions/create-github-app-token` for operations that need elevated permissions (Renovate, release, settings sync). This avoids using personal access tokens for automation.
