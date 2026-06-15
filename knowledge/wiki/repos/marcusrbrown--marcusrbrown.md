---
type: repo
title: "marcusrbrown/marcusrbrown"
created: 2026-04-18
updated: 2026-06-12
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: b26dd18884df26ac593c8d423ed0ed8b0e9bb393
    accessed: 2026-06-12
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: e39577cba2ef663d8fd25ff9b26c66f8b3460a42
    accessed: 2026-06-02
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: de594cdd416b60d92caba6684492659620a22439
    accessed: 2026-05-18
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-18
tags: [profile-readme, typescript, github-actions, automation, badges, sponsors, readme-scribe, fro-bot]
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
- **Last push:** 2026-06-12
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
| `.agents/`   | Agent skills — incl. `sync-sponsors-bio/` (script-backed bio sync, added by 2026-06-02) |

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
| **Fro Bot** | `fro-bot.yaml` | PR events, issues (opened/edited), `@fro-bot` mentions, cron 04:30 + 16:30 UTC, dispatch | Three-mode agent: PR review / autoheal / maintenance (added 2026-06-02; `fro-bot/agent@v0.61.0` SHA-pinned `6794bf5` as of 2026-06-12) |

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

### 2026-06-12 update: Renovate version treadmill, agent at v0.61.0

Ten days after onboarding, the Fro Bot workflow is fully routine. Renovate has merged **17 `fro-bot/agent` bumps since 2026-06-02** (v0.51.0 → v0.61.0 via #952–#980, often several per day), confirming the dependency-ownership boundary works as designed — every bump is Renovate-authored, none came from autoheal. The action is now **SHA-pinned** (`6794bf5` # v0.61.0) rather than tag-pinned, consistent with the PR review prompt's own "pinned SHAs for third-party actions" rule.

Workflow trigger surface has grown since the 2026-06-02 survey: `issues: [opened, edited]` is now a trigger (gated to non-bot OWNER/MEMBER/COLLABORATOR authors), alongside the original PR/comment/schedule/dispatch set. A `workflow_dispatch` `mode` choice input (review/maintenance/autoheal, default autoheal) with a required-prompt validation step for review mode is also present.

Operational observations from issue event history:

- **Daily close/reopen oscillation on #936 (Daily Maintenance Report):** fro-bot reopens it each afternoon (~17:30 UTC) and closes it each morning (~06:00 UTC) — e.g., reopened 2026-06-11T17:48, closed 2026-06-12T06:02. The perpetual-issue contract says exactly one *open* maintenance issue should exist at all times; the autoheal run appears to be closing it and the maintenance run reopening it, a daily churn loop. #926 (Daily Autohealing Report) stays open (20 comments). This is the schedule-concurrency/perpetual-issue friction anticipated in tracker #925, now empirically visible.
- **PR #960** (`build/update-readme`, generated content) has been open since 2026-06-04 and is updated every 6 hours by the profile pipeline — normal steady-state for this repo's design.
- Open items are down to 4: #960 (build PR), #926 (autoheal report), #925 (evolution tracker), #284 (dependency dashboard).

The composite `.github/actions/setup` action (pnpm store cache keyed by year-month + lockfile hash, `pnpm/action-setup` SHA-pinned) handles install; checkout remains `persist-credentials: false` with the comment-trigger fork-head refusal preflight intact.

### 2026-06-02 update: Fro Bot workflow is now live (contradiction resolved)

**Fro Bot workflow present and active** (`fro-bot.yaml`, `fro-bot/agent@v0.50.0`, SHA `de04256`). This **contradicts the prior survey claim** below — the onboarding gap that stood across the 2026-04-18 → 2026-05-18 surveys has been closed. The workflow landed via PR #924 during a dedicated "Fro Bot initial setup session" (referenced in evolution tracker issue #925), and the agent pin has since rolled forward v0.44.3 → v0.48.0 → v0.49.0 → v0.50.0 via Renovate (#946, #949, #950).

The workflow is a **single-file three-mode design** — the same architecture seen in [[marcusrbrown--marcusrbrown-github-io]] and [[marcusrbrown--systematic]] (consolidated `fro-bot.yaml`, no separate `fro-bot-autoheal.yaml`):

| Mode | Trigger | Prompt | Purpose |
| --- | --- | --- | --- |
| **review** | `pull_request` (opened/sync/reopened/ready/review_requested), `@fro-bot` mentions on issue/PR/discussion comments (OWNER/MEMBER/COLLABORATOR only) | `PR_REVIEW_PROMPT` | Structured verdict review (PASS/CONDITIONAL/REJECT) with profile-repo-specific focus: automation integrity, template-to-generated drift, content-freshness (stale date-bound claims), TypeScript strict, skipped-needs `!cancelled()` trap |
| **maintenance** | `schedule` cron `30 16 * * *` (16:30 UTC), dispatch | `MAINTENANCE_PROMPT` | Single perpetual "Daily Maintenance Report" issue (#936); 14-day rolling window, content-freshness scan, cross-project intelligence |
| **autoheal** | `schedule` cron `30 4 * * *` (04:30 UTC), dispatch (default) | `AUTOHEAL_PROMPT` | Single perpetual "Daily Autohealing Report" issue (#926); 7 categories incl. Sunday-only Upstream Modernization Watch (category 7), gated on `IS_SUNDAY_UTC` |

Notable hardening in this workflow relative to earlier sibling workflows:

- **Fork-head refusal for comment triggers:** A dedicated preflight step resolves the PR via API and refuses fork heads before any checked-out code runs — `issue_comment` events carry no `pull_request` payload, so the job-level fork guard alone is insufficient. This is a real security gap closed, not boilerplate.
- **`persist-credentials: false`** on checkout; `FRO_BOT_PAT` scoped to this repo only (contents/issues/PRs/discussions write, no org/admin/secrets).
- **Sunday-only category cadence** via `IS_SUNDAY_UTC` env detected in a preflight `date -u +%u` step.
- **Schedule staggering** documented inline: autoheal 04:30 UTC (off mrbro.dev/tokentoilet 03:30, update-repo-settings 02:55), maintenance 16:30 UTC (1h after mrbro.dev's 15:30).

**Dependency ownership boundary** is explicit in the autoheal prompt: Renovate owns routine version bumps; Fro Bot may only change versions to remediate a confirmed critical/high security advisory. Generated content stays on the `build/update-readme` branch under the `mrbro-bot[bot]` committer identity — the two bot identities remain cleanly separated (Fro Bot reviews/heals, mrbro-bot commits generated content).

Open follow-ups tracked in **issue #925 (Fro Bot evolution tracker)**: bound the `timeout: 0` once run-duration baselines exist; migrate `FRO_BOT_PAT` → GitHub App token (reuse existing `APPLICATION_ID`/`APPLICATION_PRIVATE_KEY`); schedule-concurrency TOCTOU on the perpetual issue; prompt-tuning after 2–3 schedule runs.

### Prior survey claim (retained for history — superseded 2026-06-02)

> **No Fro Bot workflow detected.** The repository does not contain a `fro-bot.yaml` workflow. Automated commits are handled by `mrbro-bot[bot]`, a separate GitHub App. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review.

The repo references `fro-bot/.github:common-settings.yaml` in its Probot settings, and `fro-bot` is a collaborator with push access — the onboarding readiness noted across prior surveys has now been realized.

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
- **`mrbro-bot[bot]` vs `fro-bot` (updated 2026-06-02):** The two bot identities now coexist with clean separation of duties. `mrbro-bot[bot]` (app 137683033) owns generated-content commits on `build/update-readme`; `fro-bot` (via `fro-bot.yaml`) owns PR review, autoheal, and maintenance. Earlier surveys (through 2026-05-18) noted Fro Bot was not yet integrated — that gap is now closed.
- **Dependency drift risk:** With Renovate stalled since 2026-03-12, this repo is accumulating dependency drift. Other Marcus repos have moved to `marcusrbrown/renovate-config#4.5.8`, `pnpm 10.33.0`, `Prettier 3.8.3`, and `bfra-me/.github` v4.16.8. This repo remains pinned at older versions across the board.

## Version Comparison (vs. Ecosystem)

### 2026-06-12 snapshot

| Dependency | This Repo | Delta vs 2026-06-02 |
| --- | --- | --- |
| `fro-bot/agent` | v0.61.0 (`6794bf5`, SHA-pinned) | v0.50.0 → v0.61.0 — 17 Renovate bumps in 10 days; this repo now leads the ecosystem with [[bfra-me--renovate-action]] (v0.60.0 as of 2026-06-11) |
| `marcusrbrown/renovate-config` | `#5.2.1` | 5.2.0 → 5.2.1 |
| `bfra-me/.github` | v4.16.25 | → v4.16.25 (#979) |
| `pnpm` | 10.34.1 | unchanged |
| `Node.js` | 24.16.0 | unchanged (`.mise.toml`) |
| `vitest` / `@vitest/ui` | 4.1.8 | 4.1.7 → 4.1.8 (#958) |
| `tsx` | 4.22.4 | 4.22.3 → 4.22.4 (#953) |
| `actions/checkout` | v6.0.3 (SHA-pinned) | → v6.0.3 (#951) |
| `@bfra.me/eslint-config` | 0.51.1 | unchanged |
| `Prettier` | 3.8.3 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `@types/node` | 24.12.4 | unchanged |
| `jiti` | 2.7.0 | unchanged |

Renovate is fully healthy; the merge stream is dominated by `fro-bot/agent` releases tracking the upstream [[fro-bot--agent]] release cadence.

### 2026-06-02 snapshot

| Dependency | This Repo | Delta vs 2026-05-18 |
| --- | --- | --- |
| `fro-bot/agent` | v0.50.0 (`de04256`) | **newly present** — workflow added via #924, then bumped v0.44.3 → v0.50.0 |
| `marcusrbrown/renovate-config` | `#5.2.0` | unchanged |
| `pnpm` | 10.34.1 | 10.33.4 → 10.34.1 |
| `Node.js` | 24.16.0 | 24.15.0 → 24.16.0 |
| `@bfra.me/eslint-config` | 0.51.1 | **0.50.1 → 0.51.1** — the trailing item flagged on 2026-05-18 is resolved |
| `vitest` / `@vitest/ui` | 4.1.7 | 4.1.6 → 4.1.7 |
| `tsx` | 4.22.3 | 4.22.0 → 4.22.3 |
| `Prettier` | 3.8.3 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `@types/node` | 24.12.4 | unchanged |
| `eslint-config-prettier` | 10.1.8 | newly listed |
| `eslint-plugin-prettier` | 5.5.6 | newly listed |
| `markdownlint` | 0.40.0 | newly listed |
| `jiti` | 2.7.0 | unchanged |

The 2026-05-18 outstanding item — `@bfra.me/eslint-config` pinned at 0.50.1 while the ecosystem advanced past 0.51.0 — has cleared. Renovate is healthy and the only open PR is the routine generated-content build (#945, `mrbro-bot[bot]`).

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
| #895 | Action Required: Fix Renovate Configuration | mrbro-bot[bot] | **closed** 2026-05-14 | Resolved by #897 (preset → 5.2.0) |

Backlog is back to baseline. The profile update pipeline (every 6 hours) and Renovate are both healthy.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `af78e68` | Initial survey |
| 2026-04-24 | `af78e68` | SHA unchanged; documented Renovate stall (issue #895), dependency drift vs ecosystem, fro-bot collaborator confirmed, open work items added |
| 2026-05-18 | `de594cd` | Renovate thaw confirmed (#895 closed, preset → 5.2.0 via #897); 18 dependency PRs landed 2026-05-14 → 2026-05-18; bumped `bfra-me/.github` v4.4.0 → v4.16.18, `pnpm` 10.31.0 → 10.33.4, `vitest` 4.0.18 → 4.1.6, `tsx` 4.20.3 → 4.22.0, `Node.js` 24.14.0 → 24.15.0, `Prettier` 3.8.1 → 3.8.3; new pinned deps added (`@bfra.me/prettier-config` 0.16.9, `@bfra.me/tsconfig` 0.13.1, `@types/node` 24.12.4); `@bfra.me/eslint-config` 0.50.1 still trailing; no Fro Bot workflow yet — follow-up PR still warranted |
| 2026-06-02 | `e39577c` | **Fro Bot onboarded** — `fro-bot.yaml` single-file three-mode workflow landed via #924 (evolution tracker #925), `fro-bot/agent` v0.44.3 → v0.50.0; contradicts prior "no Fro Bot workflow" claim, now resolved. New `.agents/skills/sync-sponsors-bio/` skill + `sponsors:bio:sync` script. Dep deltas: `pnpm` 10.33.4 → 10.34.1, `Node.js` 24.15.0 → 24.16.0, `@bfra.me/eslint-config` 0.50.1 → 0.51.1 (trailing item resolved), `vitest` 4.1.6 → 4.1.7, `tsx` 4.22.0 → 4.22.3. Perpetual issues live: Daily Maintenance Report #936, Daily Autohealing Report #926 |
| 2026-06-12 | `b26dd18` | **Steady state, version treadmill** — `fro-bot/agent` v0.50.0 → v0.61.0 (17 Renovate bumps, now SHA-pinned `6794bf5`); renovate-config preset 5.2.0 → 5.2.1; `bfra-me/.github` → v4.16.25; vitest → 4.1.8, tsx → 4.22.4; `issues: [opened, edited]` trigger + dispatch `mode` input added to `fro-bot.yaml`. Operational finding: daily close/reopen oscillation on maintenance issue #936 between autoheal (closes ~06:00 UTC) and maintenance (reopens ~17:30 UTC) runs — perpetual-issue churn anticipated in #925 now observable. Open items down to 4 |
