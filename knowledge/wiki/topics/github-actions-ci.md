---
type: topic
title: GitHub Actions CI
created: 2026-04-18
updated: 2026-04-30
tags: [github-actions, ci-cd, automation, security, renovate]
related:
  - marcusrbrown--containers
  - marcusrbrown--ha-config
  - marcusrbrown--github
  - marcusrbrown--systematic
  - marcusrbrown--infra
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--renovate-config
  - marcusrbrown--sparkle
---

# GitHub Actions CI

Cross-cutting CI/CD patterns observed across Marcus's repositories in the Fro Bot ecosystem.

## Repos Using GitHub Actions

- [[marcusrbrown--containers]] — Multi-arch container builds, Python/Dockerfile linting, Trivy security scanning
- [[marcusrbrown--ha-config]] — YAML lint, Remark lint, Prettier, Home Assistant config validation
- [[marcusrbrown--github]] — Prettier-only CI, Renovate with event-driven triggers, Probot settings sync
- [[marcusrbrown--systematic]] — Bun build + Node.js verification, Biome lint, bun:test, semantic-release to npm, OCX registry validation, Starlight docs build
- [[marcusrbrown--infra]] — Split deploy pipeline (per-app dedicated workflows), convention enforcement tests, Bun workspace CI, Changesets publishing
- [[marcusrbrown--renovate-config]] — Lint + semantic-release pipeline for Renovate presets, self-referential Renovate config, CodeQL, OpenSSF Scorecard
- [[marcusrbrown--sparkle]] — Turborepo-orchestrated Setup → Check → Build pipeline, Astro Starlight docs deployment to GitHub Pages, auto-regenerate-docs PR workflow

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
- [[marcusrbrown--infra]] — `#4.5.8`, post-upgrade runs `bun install --ignore-scripts && bun run fix`, Docker source URLs for CLIProxyAPI/Caddy, `bfra-me/.github` digest updates disabled
- [[marcusrbrown--renovate-config]] — Self-referential (`local>marcusrbrown/renovate-config`), custom regex manager for `bfra-me/renovate-config` preset pin in `default.json`, post-upgrade runs `pnpm run bootstrap && pnpm run fix`
- [[marcusrbrown--sparkle]] — `#4.5.9` + `sanity-io/renovate-config:semantic-commit-type` + `:preserveSemverRanges`, post-upgrade runs `pnpm bootstrap && pnpm fix`, React Native package grouping, automerge on unstable `@astrojs/check`/`typedoc`

### Renovate Trigger Model

The Renovate workflow trigger pattern varies across repos:

- **Event-driven** (recommended): [[marcusrbrown--github]] uses PR events (opened/reopened/synchronize/edited), issue edits (non-bot), push to non-main, and `workflow_run` after CI success. Hourly schedule is commented out. This prevents unnecessary runs while ensuring timely updates.
- **Schedule + event hybrid**: Most other repos use a combination of hourly cron schedules and event triggers.

### Branch Protection

Both repos enforce linear history, enable admin enforcement, and require specific status checks. Neither requires PR reviews for merge.

### Change Detection

Repos use `dorny/paths-filter` to scope CI runs to relevant file changes, reducing unnecessary builds. Native `paths:` triggers are avoided where `workflow_dispatch` support is needed (the native filter silently skips dispatch events).

### Split Deploy Pipelines

[[marcusrbrown--infra]] pioneered a pattern of splitting monolithic deploy workflows into per-app dedicated workflows connected by `workflow_call`:

- Each app gets its own workflow file with independent path filtering, environment gating, and secret validation
- A thin orchestrator workflow dispatches both via `workflow_call` for manual "deploy everything" scenarios
- Benefit: one app's deploy failure doesn't block the other; each workflow is independently triggerable

### Fro Bot Agent

| Repo                          | Fro Bot Workflow         | Schedule                          |
| ----------------------------- | ------------------------ | --------------------------------- |
| [[marcusrbrown--containers]]  | Present (`fro-bot.yaml`) | Daily 14:30 UTC autohealing       |
| [[marcusrbrown--systematic]]  | Present (`fro-bot.yaml`) | Weekly Mon 09:00 UTC maintenance, Daily 03:30 UTC autohealing |
| [[marcusrbrown--infra]]       | Present (`fro-bot.yaml`) | Daily 03:30 UTC autohealing (8 categories incl. CLIProxy + cross-project + upstream modernization watch on Sundays) |
| [[marcusrbrown--marcusrbrown-github-io]] | Present (`fro-bot.yaml`) | Daily 15:30 UTC maintenance (no autoheal) |
| [[marcusrbrown--renovate-config]] | Present (`fro-bot.yaml` + `fro-bot-autoheal.yaml`) | Daily 15:30 UTC maintenance, Daily 03:30 UTC autohealing (5 categories incl. config validation & bfra-me ecosystem health) |
| [[marcusrbrown--sparkle]]     | **Not present**          | N/A                               |
| [[marcusrbrown--ha-config]]   | **Not present**          | N/A                               |

The containers repo's Fro Bot workflow includes domain-specific PR review prompts (Dockerfile best practices, multi-arch correctness) and a structured autohealing schedule (errored PRs, security alerts, dependency bumps, linting consistency).

The systematic repo's Fro Bot workflow includes TypeScript/Bun/Biome-specific PR review prompts (type safety, ESM conventions, zero-class convention, plugin API breaking changes, system prompt injection security). Its autoheal covers 4 categories: errored PRs, security, health & maintenance, developer experience.

### Convention Enforcement via Tests

[[marcusrbrown--infra]] introduced a pattern of mechanically enforcing AGENTS.md conventions at CI time via colocated test files (`conventions.test.ts`). Rules marked `(enforced)` in AGENTS.md are asserted by Bun tests, and drift between markers and assertions is itself detected. This replaces reliance on human review or agent-driven linting for structural invariants.

### Shared Config Heritage

Repos across the ecosystem use `@bfra.me/*` packages for formatting and linting configuration, suggesting a shared infrastructure baseline across Marcus's projects.
