---
type: topic
title: GitHub Actions CI
created: 2026-04-18
updated: 2026-04-24
tags: [github-actions, ci-cd, automation, security, renovate]
related:
  - marcusrbrown--containers
  - marcusrbrown--ha-config
  - marcusrbrown--github
  - marcusrbrown--marcusrbrown
---

# GitHub Actions CI

Cross-cutting CI/CD patterns observed across Marcus's repositories in the Fro Bot ecosystem.

## Repos Using GitHub Actions

- [[marcusrbrown--containers]] — Multi-arch container builds, Python/Dockerfile linting, Trivy security scanning
- [[marcusrbrown--ha-config]] — YAML lint, Remark lint, Prettier, Home Assistant config validation
- [[marcusrbrown--github]] — Prettier-only CI, Renovate with event-driven triggers, Probot settings sync
- [[marcusrbrown--marcusrbrown]] — markdownlint + tsc + eslint CI, 6-hourly profile generation pipeline, template-driven content automation

## Common Patterns

### Action Pinning

All repositories SHA-pin GitHub Actions with version comments:

```yaml
uses: actions/checkout@de0fac2e... # v6.0.2
```

This prevents supply-chain attacks from tag mutation. Renovate manages SHA updates automatically.

### Probot Settings

Both repos extend `fro-bot/.github:common-settings.yaml` via `.github/settings.yml`. This synchronizes branch protection rules, required status checks, and repository settings from a central source.

### Renovate Configuration

Both repos extend `marcusrbrown/renovate-config` for dependency updates, with repo-specific overrides:

- [[marcusrbrown--containers]] — `#4.5.0`, ignores `templates/`, disables patch updates (except TypeScript/Python), post-upgrade runs `pnpm install && pnpm format`
- [[marcusrbrown--ha-config]] — `#4.5.8`, custom managers for pre-commit and mise, post-upgrade runs Prettier, automerge on minor/patch pip updates
- [[marcusrbrown--github]] — `#4.5.8`, post-upgrade runs `npx prettier@3.8.3 --no-color --write .`, PR creation set to `immediate`
- [[marcusrbrown--marcusrbrown]] — `#4.5.1`, groups markdownlint packages, post-upgrade runs `pnpm bootstrap && pnpm fix`. **Stalled since 2026-03-12** due to regex parse error in preset resolution (issue #895)

### Renovate Trigger Model

The Renovate workflow trigger pattern varies across repos:

- **Event-driven** (recommended): [[marcusrbrown--github]] uses PR events (opened/reopened/synchronize/edited), issue edits (non-bot), push to non-main, and `workflow_run` after CI success. Hourly schedule is commented out. This prevents unnecessary runs while ensuring timely updates.
- **Schedule + event hybrid**: Most other repos use a combination of hourly cron schedules and event triggers.

### Branch Protection

Both repos enforce linear history, enable admin enforcement, and require specific status checks. Neither requires PR reviews for merge.

### Change Detection

Both repos use `dorny/paths-filter` to scope CI runs to relevant file changes, reducing unnecessary builds.

### Fro Bot Agent

| Repo                         | Fro Bot Workflow         | Schedule                    |
| ---------------------------- | ------------------------ | --------------------------- |
| [[marcusrbrown--containers]] | Present (`fro-bot.yaml`) | Daily 14:30 UTC autohealing |
| [[marcusrbrown--ha-config]]  | **Not present**          | N/A                         |
| [[marcusrbrown--marcusrbrown]] | **Not present**        | N/A                         |

The containers repo's Fro Bot workflow includes domain-specific PR review prompts (Dockerfile best practices, multi-arch correctness) and a structured autohealing schedule (errored PRs, security alerts, dependency bumps, linting consistency).

### Shared Config Heritage

Both repos use `@bfra.me/*` ecosystem packages for formatting and linting configuration, suggesting a shared infrastructure baseline across Marcus's projects.
