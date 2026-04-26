---
type: repo
title: "marcusrbrown/marcusrbrown"
created: 2026-04-18
updated: 2026-04-26
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-26
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-18
tags: [profile-readme, typescript, github-actions, automation, badges, sponsors, readme-scribe]
aliases: [marcusrbrown-profile]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--github
  - marcusrbrown--mrbro-dev
---

# marcusrbrown/marcusrbrown

Marcus R. Brown's GitHub profile README repository. A TypeScript-powered automation system that generates and maintains his public GitHub profile, including sponsor tracking, badge automation, A/B content testing, and scheduled profile updates via [[github-actions-ci]].

## Overview

- **Purpose:** GitHub profile README with automated content generation
- **Default branch:** `main`
- **Language:** TypeScript
- **Created:** 2020-12-09
- **Last push:** 2026-03-12
- **License:** MIT
- **Topics:** `github`, `readme-profile`, `profile-readme`, `awesome-readme`, `typescript`, `markdown`
- **Collaborators:** `marcusrbrown` (admin), `fro-bot` (push)

## Repository Structure

This is not a simple static README. It is a full TypeScript project with templating, API integrations, testing, and CI automation.

### Key Directories

| Directory    | Purpose                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `templates/` | Mustache-style `.tpl.md` templates for generated content                     |
| `scripts/`   | TypeScript CLI tools for badge updates, sponsor data, analytics, A/B testing |
| `utils/`     | Shared utilities (GitHub API client, logger, badge cache, shields.io client) |
| `types/`     | TypeScript type definitions (sponsors, badges, analytics)                    |
| `__tests__/` | Vitest unit tests for utilities and scripts                                  |
| `assets/`    | Profile images and static assets                                             |
| `docs/`      | Internal documentation (badge migration, conversion optimization)            |
| `.ai/`       | AI-generated content strategy docs and sponsor persona research              |

### Generated Files (Do Not Edit Directly)

| Template                      | Output          |
| ----------------------------- | --------------- |
| `templates/README.tpl.md`     | `README.md`     |
| `templates/SPONSORME.tpl.md`  | `SPONSORME.md`  |
| `templates/BADGES.tpl.md`     | `BADGES.md`     |
| `templates/HIGHLIGHTS.tpl.md` | `HIGHLIGHTS.md` |

A/B test variants live in `templates/variants/` (e.g., `SPONSORME-benefits.tpl.md`, `SPONSORME-urgency.tpl.md`).

### Script Inventory

| Script                            | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `update-badges.ts`                | Fetches badge data from shields.io and updates BADGES.md |
| `update-sponsors.ts`              | Generates SPONSORME.md from fetched sponsor data         |
| `fetch-sponsors-data.ts`          | Retrieves sponsorship data from GitHub GraphQL API       |
| `profile-analytics.ts`            | Collects and reports profile analytics                   |
| `ab-test-cli.ts`                  | CLI for running content A/B tests                        |
| `ab-testing-framework.ts`         | Core A/B testing logic                                   |
| `content-performance-tracking.ts` | Content performance monitoring                           |
| `mobile-responsiveness-tester.ts` | Mobile layout verification                               |

### Utility Modules

| Module                   | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `github-api.ts`          | Octokit-based GitHub API client                  |
| `logger.ts`              | Structured logger with emoji prefixes            |
| `badge-cache-manager.ts` | Badge data caching                               |
| `badge-config-loader.ts` | Badge configuration from `@bfra.me/badge-config` |
| `badge-detector.ts`      | Technology detection for auto-badging            |
| `shield-io-client.ts`    | shields.io API client                            |

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Lint (markdownlint + tsc + eslint) |
| Update GitHub Profile | `update-profile.yaml` | push/PR, every 6 hours, dispatch | Generate profile content and commit/PR |
| Renovate | `renovate.yaml` | issue/PR edit, push, dispatch, Main completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync |
| Cleanup Cache | `cleanup-cache.yaml` | PR close, weekly, dispatch | Prune stale GHA cache entries |

### Profile Update Pipeline (update-profile.yaml)

The core automation workflow:

1. **Prepare** (PR only) — `dorny/paths-filter` checks if relevant files changed
2. **Finalize** — Runs on push/schedule/dispatch, or on PRs with relevant changes:
   - Fetches sponsor data via GitHub GraphQL API (`pnpm sponsors:fetch`)
   - Generates `SPONSORME.md` from template (`pnpm sponsors:update`)
   - Fetches badge data from shields.io (`pnpm badges:fetch`)
   - Generates `BADGES.md` from template (`pnpm badges:update`)
   - Copies `HIGHLIGHTS.md` from template
   - Generates `README.md` via `muesli/readme-scribe` from `templates/README.tpl.md`
   - Runs `pnpm fix` to clean up formatting
   - On PRs: commits directly to HEAD via `EndBug/add-and-commit`
   - On main: opens a PR via `peter-evans/create-pull-request` on branch `build/update-readme`

Commits are authored by `mrbro-bot[bot]` (app ID 137683033).

### Branch Protection

Required status checks on `main`: CI, Renovate, Prepare, Finalize. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Workflows

`renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github` (v4.4.0). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

## Developer Tooling

- **Package manager:** pnpm 10.31.0 (enforced via `preinstall` script, `only-allow pnpm`)
- **Node.js:** 24.14.0 (pinned in `.mise.toml`)
- **TypeScript:** Extends `@bfra.me/tsconfig`. Path alias `@/` maps to project root.
- **ESLint:** Extends `@bfra.me/eslint-config` (0.50.1). Ignores `.ai/`, `.cache/`, copilot instructions.
- **Prettier:** `@bfra.me/prettier-config/120-proof` (120-char line width), v3.8.1.
- **Vitest:** 4.0.18, test runner with `@/` path alias. Tests in `__tests__/`.
- **markdownlint-cli2:** 0.20.0, markdown linting for generated and template files.
- **simple-git-hooks + lint-staged:** Pre-commit hooks run ESLint fix on staged files.
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.1` and `sanity-io/renovate-config:semantic-commit-type`. Groups markdownlint packages. Post-upgrade runs `pnpm bootstrap && pnpm fix`.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (identical to [[marcusrbrown--ha-config]] pattern).
- **mise:** Manages Node.js version; adds `node_modules/.bin` to PATH.
- **llms.txt:** Provides LLM-readable project map at repo root.

### Key Dependencies

| Package                 | Version  | Purpose                             |
| ----------------------- | -------- | ----------------------------------- |
| `@octokit/graphql`      | ^9.0.1   | GitHub GraphQL API for sponsor data |
| `@octokit/rest`         | ^22.0.0  | GitHub REST API client              |
| `@octokit/types`        | ^16.0.0  | GitHub API type definitions         |
| `@bfra.me/badge-config` | 0.2.0    | Badge configuration package         |
| `vitest`                | 4.0.18   | Test runner                         |
| `tsx`                   | ^4.20.3  | TypeScript script execution         |
| `jiti`                  | 2.6.1    | TypeScript config loader            |

## Fro Bot Integration

**No Fro Bot workflow detected.** The repository does not contain a `fro-bot.yaml` workflow. Automated commits are handled by `mrbro-bot[bot]`, a separate GitHub App. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review.

The repo does reference `fro-bot/.github:common-settings.yaml` in its Probot settings, and `fro-bot` is confirmed as a collaborator with push access — confirming the repo is part of the Fro Bot-managed ecosystem and ready for agent workflow onboarding.

## Open Work Items

| # | Title | Author | Created | Notes |
| --- | --- | --- | --- | --- |
| #895 | Action Required: Fix Renovate Configuration | mrbro-bot[bot] | 2026-03-12 | **Blocks all Renovate PRs** — regex parse error in `marcusrbrown/renovate-config` preset resolution |

**Renovate is stalled.** Issue #895 reports an invalid regex in the Renovate preset resolution chain, preventing all dependency update PRs since 2026-03-12. The error references `marcusrbrown/renovate-config` with a malformed RE2 expression. As of 2026-04-26, dependencies have not been updated for 45+ days. The Dependency Dashboard issue (#284) is no longer visible in the open issues list — it may have been auto-closed or superseded by #895. The profile update pipeline's 6-hour schedule remains the only active automation. Zero open PRs confirms complete Renovate inactivity.

## Notable Patterns

- **Template-driven generation:** All public-facing markdown is generated from `.tpl.md` templates. Editing the output files directly is a footgun; they get overwritten every 6 hours.
- **A/B testing for profile content:** Unusual for a profile repo. The `templates/variants/` directory and `ab-test-cli.ts` suggest active experimentation with sponsor conversion messaging.
- **Content performance analytics:** `profile-analytics.ts` and `content-performance-tracking.ts` treat the profile README as a measurable surface.
- **Badge automation pipeline:** Technology badges are not manually curated. `badge-detector.ts` discovers technologies, `badge-cache-manager.ts` caches results, and `shield-io-client.ts` generates the shields.
- **Shared config ecosystem:** All tooling configs extend `@bfra.me/*` packages, keeping local config minimal. Same pattern observed in [[marcusrbrown--ha-config]] and [[marcusrbrown--github]] for Renovate and Probot settings.
- **`mrbro-bot[bot]` vs `fro-bot`:** This repo's automation uses `mrbro-bot[bot]` (app 137683033) for commits. Fro Bot is not yet integrated for PR review or triage.
- **Dependency drift risk:** With Renovate stalled since 2026-03-12, this repo is accumulating dependency drift. Other Marcus repos have moved to `marcusrbrown/renovate-config#4.5.8`, `pnpm 10.33.0`, `Prettier 3.8.3`, and `bfra-me/.github` v4.16.8. This repo remains pinned at older versions across the board.

## Version Comparison (vs. Ecosystem)

| Dependency | This Repo | Ecosystem Latest | Drift |
| --- | --- | --- | --- |
| `marcusrbrown/renovate-config` | `#4.5.1` | `#4.5.8` | 7 patch versions behind |
| `bfra-me/.github` | v4.4.0 | v4.16.8 | 12+ minor versions behind |
| `pnpm` | 10.31.0 | 10.33.1 | 2 minor + 1 patch behind |
| `Prettier` | 3.8.1 | 3.8.3 | 2 patch versions behind |
| `@bfra.me/eslint-config` | 0.50.1 | ≥0.51.0 | At least 1 minor behind |
| `Node.js` | 24.14.0 | 24.15.0 | 1 minor behind |
| `fro-bot/agent` | **absent** | v0.42.1 | No workflow at all |

Drift is accelerating — repo has been frozen at SHA `af78e68` since 2026-03-12 (45+ days). Every other Marcus repo has received regular Renovate bumps during this period.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `af78e68` | Initial survey |
| 2026-04-24 | `af78e68` | SHA unchanged; documented Renovate stall (issue #895), dependency drift vs ecosystem, fro-bot collaborator confirmed, open work items added |
| 2026-04-26 | `af78e68` | SHA unchanged (45+ days frozen); Renovate still stalled (#895 open); dependency drift worsened vs ecosystem (fro-bot/agent now v0.42.1, pnpm 10.33.1); 0 open PRs, 1 open issue (#895); confirmed fro-bot collaborator (write); still no Fro Bot agent workflow |
