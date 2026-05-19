---
type: repo
title: "marcusrbrown/marcusrbrown"
created: 2026-04-18
updated: 2026-05-19
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: de594cdd416b60d92caba6684492659620a22439
    accessed: 2026-05-19
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: de594cdd416b60d92caba6684492659620a22439
    accessed: 2026-05-18
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
- **Last push:** 2026-05-18
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
| #284 | Dependency Dashboard | mrbro-bot[bot] | 2024-02-22 | Standard Renovate dashboard issue |

**Renovate is stalled.** Issue #895 reports an invalid regex in the Renovate preset resolution chain, preventing all dependency update PRs since 2026-03-12. The error references `marcusrbrown/renovate-config` with a malformed RE2 expression. This means dependencies have not been updated for over 6 weeks and the profile update pipeline's 6-hour schedule is the only active automation.

## Notable Patterns

- **Template-driven generation:** All public-facing markdown is generated from `.tpl.md` templates. Editing the output files directly is a footgun; they get overwritten every 6 hours.
- **A/B testing for profile content:** Unusual for a profile repo. The `templates/variants/` directory and `ab-test-cli.ts` suggest active experimentation with sponsor conversion messaging.
- **Content performance analytics:** `profile-analytics.ts` and `content-performance-tracking.ts` treat the profile README as a measurable surface.
- **Badge automation pipeline:** Technology badges are not manually curated. `badge-detector.ts` discovers technologies, `badge-cache-manager.ts` caches results, and `shield-io-client.ts` generates the shields.
- **Shared config ecosystem:** All tooling configs extend `@bfra.me/*` packages, keeping local config minimal. Same pattern observed in [[marcusrbrown--ha-config]] and [[marcusrbrown--github]] for Renovate and Probot settings.
- **`mrbro-bot[bot]` vs `fro-bot`:** This repo's automation uses `mrbro-bot[bot]` (app 137683033) for commits. Fro Bot is not yet integrated for PR review or triage.
- **Dependency drift risk:** With Renovate stalled since 2026-03-12, this repo is accumulating dependency drift. Other Marcus repos have moved to `marcusrbrown/renovate-config#4.5.8`, `pnpm 10.33.0`, `Prettier 3.8.3`, and `bfra-me/.github` v4.16.8. This repo remains pinned at older versions across the board.

## Version Comparison (vs. Ecosystem)

### 2026-05-18 snapshot (post-thaw)

| Dependency | This Repo | Ecosystem Latest | Delta vs 2026-04-24 |
| --- | --- | --- | --- |
| `marcusrbrown/renovate-config` | `#5.2.0` | `#5.2.0` | `#4.5.1` → `#5.2.0` (major bump; preset regex fixed) |
| `bfra-me/.github` | v4.16.18 | v4.16.18 | v4.4.0 → v4.16.18 |
| `pnpm` | 10.33.4 | 10.33.4 | 10.31.0 → 10.33.4 |
| `Prettier` | 3.8.3 | 3.8.3 | 3.8.1 → 3.8.3 |
| `@bfra.me/prettier-config` | 0.16.9 | 0.16.9 | (newly pinned) |
| `@bfra.me/tsconfig` | 0.13.1 | 0.13.1 | (newly pinned) |
| `@bfra.me/eslint-config` | 0.50.1 | ≥0.51.0 | unchanged — still trailing |
| `Node.js` | 24.15.0 | 24.15.0 | 24.14.0 → 24.15.0 |
| `vitest` / `@vitest/ui` | 4.1.6 | 4.1.6 | 4.0.18 → 4.1.6 |
| `tsx` | 4.22.0 | 4.22.0 | 4.20.3 → 4.22.0 |
| `jiti` | 2.7.0 (`<2.8.0`) | 2.x | 2.6.1 → 2.7.0 |
| `@types/node` | 24.12.4 | 24.12.4 | (newly pinned) |
| `lint-staged` | 16.4.0 | 16.4.0 | unchanged |
| `simple-git-hooks` | 2.13.1 | 2.13.1 | unchanged |

### 2026-04-24 snapshot (pre-thaw, retained for history)

| Dependency | This Repo | Ecosystem Latest |
| --- | --- | --- |
| `marcusrbrown/renovate-config` | `#4.5.1` | `#4.5.8` |
| `bfra-me/.github` | v4.4.0 | v4.16.8 |
| `pnpm` | 10.31.0 | 10.33.0 |
| `Prettier` | 3.8.1 | 3.8.3 |
| `@bfra.me/eslint-config` | 0.50.1 | ≥0.51.0 |
| `Node.js` | 24.14.0 | 24.15.0 |

## 2026-05-18 Update: Renovate Thaw

The Renovate stall documented on 2026-04-24 has cleared. Issue #895 closed 2026-05-14T06:25:44Z. Marcus shipped #897 (`ci(renovate): update marcusrbrown/renovate-config preset to 5.2.0`) at 2026-05-14T06:20:01Z, which fixed the malformed RE2 regex in the preset chain. Within the same hour, Renovate flushed the backlog:

- #900: chore(deps) update all non-major dependencies
- #901: prettier → 3.8.3
- #902: jiti → `<2.8.0`
- #904 / #908: vitest monorepo → 4.1.5 → 4.1.6
- #898/#905: pin + bump `@bfra.me/prettier-config` to 0.16.7 → 0.16.8 → 0.16.9 (#910)
- #899/#906/#911: pin + bump `@bfra.me/tsconfig` to 0.12.2 → 0.13.0 → 0.13.1
- #907: chore(dev) pin dependencies (added `@types/node` 24.12.4)
- #909: `@types/node` → 24.12.4
- #912 → #915: rolling `bfra-me/.github` v4.16.17 → v4.16.18
- #913 / #914: tsx 4.21.1 → 4.22.0

The 6-week dependency drift documented previously is largely gone. Outstanding trailing item: `@bfra.me/eslint-config` is still pinned at 0.50.1 while the ecosystem advanced past 0.51.0 — Renovate has not opened a PR for this, suggesting either a deliberate pin or a missing range allowance. Worth verifying before next survey.

The "newly pinned" rows above reflect #907's pin sweep: previously caret-ranged dev deps were locked to exact versions, aligning with the rest of the ecosystem.

### Updated Open Work Items

| # | Title | Author | State | Notes |
| --- | --- | --- | --- | --- |
| #284 | Dependency Dashboard | mrbro-bot[bot] | open | Standard Renovate dashboard issue |
| #903 | chore(dev): update dependency @bfra.me/eslint-config to v0.51.1 | mrbro-bot[bot] | open (PR) | Opened 2026-05-14; resolves the `@bfra.me/eslint-config` trailing-pin gap flagged in prior survey |
| #895 | Action Required: Fix Renovate Configuration | mrbro-bot[bot] | **closed** 2026-05-14 | Resolved by #897 (preset → 5.2.0) |

Backlog is back to baseline. The profile update pipeline (every 6 hours) and Renovate are both healthy.

## 2026-05-19 Update: ESLint-Config Pin Question Answered

The `@bfra.me/eslint-config` trailing-pin question from the 2026-05-18 survey has resolved: Renovate **did** open a PR — #903 (`chore(dev): update dependency @bfra.me/eslint-config to v0.51.1`) was filed by `mrbro-bot[bot]` at 2026-05-14T06:30:08Z, contemporaneous with the rest of the post-thaw flush. As of 2026-05-19 it remains open and unmerged. So the gap isn't a missing range allowance — it's an unmerged PR. Likely waiting on a manual review pass (the bump crosses a 0.50 → 0.51 minor that probably surfaces new lint rules).

No SHA change on `main` since 2026-05-18 (`de594cd` holds). No new merged commits, no new workflows, no Fro Bot workflow yet.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `af78e68` | Initial survey |
| 2026-04-24 | `af78e68` | SHA unchanged; documented Renovate stall (issue #895), dependency drift vs ecosystem, fro-bot collaborator confirmed, open work items added |
| 2026-05-18 | `de594cd` | Renovate thaw confirmed (#895 closed, preset → 5.2.0 via #897); 18 dependency PRs landed 2026-05-14 → 2026-05-18; bumped `bfra-me/.github` v4.4.0 → v4.16.18, `pnpm` 10.31.0 → 10.33.4, `vitest` 4.0.18 → 4.1.6, `tsx` 4.20.3 → 4.22.0, `Node.js` 24.14.0 → 24.15.0, `Prettier` 3.8.1 → 3.8.3; new pinned deps added (`@bfra.me/prettier-config` 0.16.9, `@bfra.me/tsconfig` 0.13.1, `@types/node` 24.12.4); `@bfra.me/eslint-config` 0.50.1 still trailing; no Fro Bot workflow yet — follow-up PR still warranted |
| 2026-05-19 | `de594cd` | SHA unchanged; PR #903 (`@bfra.me/eslint-config` → 0.51.1) confirmed open since 2026-05-14 — resolves the "is Renovate even allowed to bump this?" question from prior survey (it is; the PR just hasn't merged yet, plausibly awaiting manual lint-rule review); no new merged commits, no Fro Bot workflow added, profile-update pipeline and Renovate both still healthy |
