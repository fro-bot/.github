---
type: repo
title: "marcusrbrown/sparkle"
created: 2026-04-28
updated: 2026-06-16
sources:
  - url: https://github.com/marcusrbrown/sparkle
    sha: 770356b3c83cec08a666960eab9c5fb4e1ab2a85
    accessed: 2026-04-28
  - url: https://github.com/marcusrbrown/sparkle
    sha: 712ab1bc2fdcd59ec9b8a2d71ad6d9ca88a023c5
    accessed: 2026-04-30
  - url: https://github.com/marcusrbrown/sparkle
    sha: 712ab1bc2fdcd59ec9b8a2d71ad6d9ca88a023c5
    accessed: 2026-05-01
  - url: https://github.com/marcusrbrown/sparkle
    sha: e757fa66aa223f4ccb8af16838d937562b97f713
    accessed: 2026-05-23
  - url: https://github.com/marcusrbrown/sparkle
    sha: e03e3173c70087d08e0def5196db624de964bf50
    accessed: 2026-06-05
  - url: https://github.com/marcusrbrown/sparkle
    sha: 5ccf10681cf1095bd0ffb113c0e1a3745b40109c
    accessed: 2026-06-16
tags: [typescript, react, react-native, monorepo, design-system, storybook, tailwindcss, radix-ui, turborepo, expo, vite, astro, github-pages, zig, wasm]
aliases: [sparkle]
related:
  - github-actions-ci
  - marcusrbrown--mrbro-dev
  - marcusrbrown--gpt
  - marcusrbrown--tokentoilet
  - marcusrbrown--vbs
---

# marcusrbrown/sparkle

**Sparkle** — a TypeScript playground and monorepo showcasing cross-platform web and mobile development. React component library, design token system, Expo/React Native mobile app, Astro Starlight documentation site, and comprehensive build tooling via Turborepo and pnpm workspaces.

## Overview

- **Purpose:** Experimental playground for modern TypeScript monorepo patterns, cross-platform UI, and design system tooling
- **Default branch:** `main`
- **Created:** 2020-11-26
- **Last push:** 2026-06-05
- **Homepage:** https://sparkle.mrbro.dev (Astro Starlight docs site on GitHub Pages)
- **License:** MIT
- **Topics:** `typescript`, `playground`, `next-js`, `react`, `vite`
- **Package manager:** pnpm 10.34.1
- **Node.js:** 24.16.0 (pinned via `.node-version`)
- **Stars:** 1, **Forks:** 1, **Watchers:** 1
- **Open issues:** 7, **Open PRs:** 3, **Has GitHub Pages:** yes

## Tech Stack

| Layer             | Technology                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| Language          | TypeScript 5.9.3 (strict mode, ESM-only `"type": "module"`)                      |
| Build             | Turborepo 2.9.x, tsdown 0.16.x, Vite                                             |
| Framework (web)   | React 19.x, Radix UI primitives, Tailwind CSS                                    |
| Framework (mobile)| Expo / React Native                                                               |
| Component docs    | Storybook                                                                         |
| Documentation     | Astro Starlight (`@sparkle/docs`), TypeDoc, automated JSDoc extraction            |
| Testing           | Vitest, Testing Library, axe-core accessibility, Playwright visual regression     |
| Linting           | ESLint 9.39.4 via `@bfra.me/eslint-config` 0.51.0 + Prettier via `@bfra.me/prettier-config` 0.16.8 (`120-proof` — 120 char) |
| TypeScript config | Extends `@bfra.me/tsconfig` 0.13.0                                               |
| Git hooks         | `simple-git-hooks` + `nano-staged` (runs `eslint --fix`, `sort-package-json`)     |
| Monorepo tools    | `@manypkg/cli` (workspace consistency checks), Changesets (versioning)            |
| Bundler           | tsdown (library packages), Vite (apps), Astro (docs)                              |

_Toolchain drift (2026-05-23 survey at SHA `e757fa6`):_ pnpm 10.33.4, Node.js 24.16.0, Turborepo 2.9.14, `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (still `120-proof`), `@bfra.me/tsconfig` 0.13.1. TypeScript 5.9.3 unchanged. No engine-level shifts — strict-mode TypeScript + ESM-only `"type": "module"` are stable invariants across surveys.

_Toolchain drift (2026-06-05 survey at SHA `e03e317`):_ pnpm bumped to `10.34.1` (root `packageManager` field updated). Node.js 24.16.0 unchanged. `llms.txt` still references pnpm `10.33.4` — minor doc drift. No other engine-level changes confirmed from manifest inspection.

_Toolchain drift (2026-06-16 survey at SHA `5ccf106`):_ pnpm `10.34.1` → `10.34.3` (root `packageManager`). Turborepo `2.9.14` → `2.9.18`. `@types/node` now pinned at `24.13.2`; `prettier` `3.8.4`; `tsdown` `0.16.8`; `tsx` `4.22.4`. `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (`120-proof`), `@bfra.me/tsconfig` 0.13.1, TypeScript 5.9.3 — all unchanged. `engines` floor remains `node >=22.13.1` / `pnpm >=9.15.4`; `.node-version` pins 24.16.0. `llms.txt` still references pnpm `10.33.4` — the doc drift has now widened by two patch releases (actual `10.34.3`). Strict-mode TypeScript + ESM-only `"type": "module"` remain stable invariants.

## Architecture

### Workspace Layout

```
sparkle/
├── apps/
│   ├── fro-jive/           # Expo/React Native mobile app
│   └── moo-dang/           # WASM web shell app (Vite)
├── packages/
│   ├── ui/                 # @sparkle/ui — React component library (Radix + Tailwind)
│   ├── theme/              # @sparkle/theme — Cross-platform design tokens
│   ├── types/              # @sparkle/types — Shared TypeScript definitions
│   ├── utils/              # @sparkle/utils — Utility functions and React hooks
│   ├── config/             # @sparkle/config — Shared build and lint configs
│   ├── storybook/          # Component development environment
│   ├── error-testing/      # @sparkle/error-testing — Error handling utilities
│   └── test-utils/         # Testing utilities
├── docs/                   # @sparkle/docs — Astro Starlight documentation site
├── scripts/                # Build validation and health-check utilities
├── docs-legacy/            # Legacy documentation (retained)
├── .ai/                    # AI context (analysis, audit, notes, plan, review, security)
└── .changeset/             # Changesets configuration
```

### Build Graph (Turborepo)

Turborepo orchestrates builds via fine-grained task dependencies. Package-specific tasks use `build:packagename` convention:

- `build:types` → no deps (leaf)
- `build:utils` → depends on `@sparkle/types#build:types`
- `build:theme` → depends on `types` + `utils`
- `build:config` → depends on `theme`
- `build:ui` → depends on `config`
- `build:storybook` → depends on `ui` + `theme`
- `build:docs` → depends on `docs:automation` + `ui` + `theme` + `types` + `utils`
- `build:moo-dang` → depends on `ui` + `theme` + `types` + `utils`

### Design System

Cross-platform theme management via `@sparkle/theme`:

- Design tokens (light/dark modes)
- Web: CSS custom properties
- Native: StyleSheet integration
- Tailwind CSS integration via generated config

### Component Library

`@sparkle/ui` built on:

- Radix UI primitives for accessibility
- Tailwind CSS for styling
- React `forwardRef` pattern
- Storybook for development and documentation

### Documentation Site

Astro Starlight at `docs/` with automated documentation generation:

- TypeDoc for API reference extraction
- Custom JSDoc extraction scripts (`docs/scripts/`)
- Component playground via Storybook integration
- Deployed to GitHub Pages at https://sparkle.mrbro.dev
- Auto-regeneration workflow creates PRs when package source changes

## Repository Structure — Key Files

| File/Dir | Purpose |
| --- | --- |
| `turbo.json` | Task graph and caching configuration |
| `pnpm-workspace.yaml` | Workspace packages: `packages/*`, `apps/*`, `docs`, `scripts` |
| `.node-version` | Node.js 24.16.0 |
| `eslint.config.ts` | Root ESLint config |
| `tsconfig.json` / `tsconfig.node.json` | TypeScript project references |
| `.github/actions/setup-ci/` | Composite CI setup action |
| `.github/copilot-instructions.md` | AI agent development guide |
| `.ai/` | AI context files (analysis, audit, notes, plan, review, security) |
| `.changeset/config.json` | Changesets versioning config |
| `opencode.jsonc` | OpenCode config — `instructions` points to `.github/copilot-instructions.md` |

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Setup → Check (monorepo, types, deps, lint) → Build |
| Deploy Docs | `deploy-docs.yaml` | push to `main` (docs/packages paths), dispatch | Build Astro Starlight site, deploy to GitHub Pages |
| Regenerate Docs | `regenerate-docs.yaml` | push to `main` (package source), dispatch | Auto-generate docs from JSDoc, create PR with changes |
| Renovate | `renovate.yaml` | issues, PR, push to non-main, dispatch, workflow_run | Dependency updates via `bfra-me/.github` reusable workflow |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily 11:43 UTC, dispatch | Probot settings sync via `bfra-me/.github` reusable workflow |
| Cache Cleanup | `cleanup-cache.yaml` | PR close, weekly Sunday 00:00 UTC, dispatch | Clean up Actions caches |
| **Fro Bot** | **`fro-bot.yaml`** | **PR open/sync, issues, comments (@fro-bot), schedule (05:00 + 17:00 UTC), dispatch** | **PR review + daily maintenance (17:00) + autoheal (05:00)** |

### CI Jobs (main.yaml)

1. **Setup** — checkout + setup-ci composite action (pnpm install, optional Zig install)
2. **Check** — `pnpm check` (monorepo consistency, type-check, Turbo validation, dependency validation, ESLint)
3. **Build** — `pnpm build` (full Turborepo build graph, includes Zig support)

### Branch Protection

Required status checks on `main`: `Build`, `Check`, `Renovate / Renovate`, `Setup`. Enforces admins, linear history, no required PR reviews.

### Automated Documentation Pipeline

The `regenerate-docs.yaml` workflow detects package source changes, runs TypeDoc/JSDoc extraction, and creates a PR via `peter-evans/create-pull-request`. Commits are authored by `mrbro-bot[bot]` (app 137683033). Force rebuild option available via dispatch.

## Fro Bot Integration

**Fro Bot agent workflow detected as of 2026-06-05 survey (SHA `e03e317`).** The `fro-bot.yaml` workflow was added since the 2026-05-23 survey (it was absent at SHA `e757fa6`). This resolves the previously flagged gap.

### Workflow: `fro-bot.yaml`

- **Agent version:** `fro-bot/agent@b7efdd6d8e9d41766e287327d1d99876959620d3` (v0.65.0 as of 2026-06-16 survey; was `07820934...` v0.54.2 at 2026-06-05). Eleven-minor bump in eleven days — the repo is tracking the agent release cadence closely.
- **Triggers:**
  - `pull_request` (opened, synchronize, reopened, ready_for_review, review_requested)
  - `issues` (opened, edited) — from OWNER/MEMBER/COLLABORATOR only
  - `issue_comment` / `pull_request_review_comment` / `discussion_comment` — `@fro-bot` mentions from trusted author associations
  - `schedule`: autoheal at `0 5 * * *` (05:00 UTC), maintenance at `0 17 * * *` (17:00 UTC)
  - `workflow_dispatch` with `mode` input: `review` / `maintenance` / `autoheal` (default: `autoheal`)
- **Permissions:** `contents: write`, `issues: write`, `pull-requests: write`, `discussions: write`
- **Token:** `FRO_BOT_PAT` for checkout and GitHub operations
- **Setup:** Uses `./.github/actions/setup-ci` with Zig install enabled — full project setup before each run

### Embedded Prompts

The workflow carries three inline prompts (~9000 tokens combined):

- **`PR_REVIEW_PROMPT`:** 7-focus-area review targeting cross-package side effects, ESM invariants, TypeScript strict, cross-platform theme, Vitest coverage, security, and changeset coverage. Verdict format: `PASS | CONDITIONAL | REJECT`.
- **`MAINTENANCE_PROMPT`:** Perpetual issue "Daily Maintenance Report" updated daily at 17:00 UTC. 14-day rolling window, historical summary, 9 sections including cross-project intelligence, docs site health, and Renovate dashboard state.
- **`AUTOHEAL_PROMPT`:** Perpetual issue "Daily Autohealing Report" updated daily at 05:00 UTC. 8 categories: errored PRs, security, code quality, DX fixes, quality gates, docs site health (live via agent-browser), cross-project intelligence, and upstream modernization watch (Sundays only). Scope cap and dependency ownership rules match the ecosystem standard.

### Fork Guard

The workflow has an explicit fork PR head refusal step on `issue_comment` triggers — resolves the event-context gap in job-level fork guards.

### Schedule Stagger

- **Autoheal 05:00 UTC** — staggered from mrbro.dev (03:30), marcusrbrown (04:30), tokentoilet (03:30)
- **Maintenance 17:00 UTC** — staggered from marcusrbrown (16:30) and mrbro.dev (15:30)

### Active Perpetual Issues

- **#1665** — "Daily Autohealing Report" (open, `fro-bot`-authored, first run 2026-06-05)
- **#1666** — "Daily Maintenance Report" (`fro-bot`-authored; observed **CLOSED** at the 2026-06-16 survey). The 17:00 UTC maintenance prompt is designed to update a perpetual issue; a closed report issue suggests either a manual close or that the maintenance run reopens/recreates rather than reusing #1666. Watch on next survey to confirm whether the maintenance perpetual issue is being maintained as intended.

The repo also has:

- Probot settings extending `fro-bot/.github:common-settings.yaml` (confirmed via `.github/settings.yml`)
- Renovate via `bfra-me/.github` reusable workflow extending `marcusrbrown/renovate-config#5.2.0`
- GitHub App tokens via `actions/create-github-app-token` (for regenerate-docs workflow)
- `opencode.jsonc` — OpenCode config pointing to `.github/copilot-instructions.md` for instructions

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.0` (major-bumped from `#4.5.9` between 2026-05-01 and 2026-05-23 — same ecosystem-wide cutover seen across the Marcus and Fro Bot portfolios) + `sanity-io/renovate-config:semantic-commit-type` + `:preserveSemverRanges`. Post-upgrade runs `pnpm bootstrap && pnpm fix`. React Native package grouping rules. Automerge on unstable minor/patch for `@astrojs/check` and `typedoc`. PR creation: `immediate`.
- **OpenCode config:** `opencode.jsonc` added at root — points `instructions` to `.github/copilot-instructions.md`. First survey confirmation of OpenCode config presence in this repo.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` — confirmed Fro Bot ecosystem membership.
- **Git hooks:** `simple-git-hooks` runs `nano-staged` on pre-commit. nano-staged runs `eslint --fix` on TS/JS/CSS/MD/JSON/YAML and `sort-package-json` on package.json files.
- **Monorepo validation:** `@manypkg/cli` checks workspace consistency. `scripts/validate-dependencies.ts` validates deps. `scripts/validate-turbo.ts` validates Turbo config. `scripts/validate-build.ts` validates build output.
- **Health check:** `scripts/health-check.ts` validates workspace, dependencies, TypeScript setup, and environment.
- **Error reporting:** `scripts/enhanced-error-reporter.ts` wraps `tsc` with better error output.
- **AI context:** `.github/copilot-instructions.md` (comprehensive), `.ai/` directory (analysis, audit, notes, plan, review, security subdirs). No root `AGENTS.md` observed.
- **Versioning:** Changesets (`@changesets/cli` 2.31.0) — pre-release changeset `initial-theme-release.md` present.
- **`consola`:** Required logger (no `console.log` per conventions).

## Notable Patterns

- **Cross-platform design system:** The `@sparkle/theme` + `@sparkle/ui` combo provides a design token pipeline from shared tokens to CSS custom properties (web) and StyleSheet objects (native). This is the only Marcus repo attempting cross-platform UI.
- **Expo/React Native app:** `apps/fro-jive` is an Expo mobile application — unique in the portfolio. `apps/moo-dang` is a WASM web shell — also unique.
- **Astro Starlight documentation:** Full documentation site with automated TypeDoc generation, accessibility auditing, and GitHub Pages deployment. The docs pipeline is more sophisticated than any other Marcus repo.
- **Zig support:** The CI setup action optionally installs Zig, and the repo has Zig source code (21KB per language stats). Purpose unclear from top-level manifest.
- **No-class convention:** Per copilot-instructions, avoids ES6 classes except for Error extensions — consistent with [[marcusrbrown--vbs]] functional pattern.
- **Enhanced error reporting:** Custom TypeScript error reporter wrapping `tsc --noEmit` with better DX — novel tooling not seen in other repos.
- **`nano-staged` vs `lint-staged`:** Sparkle uses `nano-staged` (smaller, faster), while most other Marcus repos use `lint-staged`. Both serve the same purpose.
- **`mrbro-bot[bot]` for commits:** Doc regeneration PRs authored by `mrbro-bot[bot]` (app 137683033), same as [[marcusrbrown--marcusrbrown]].
- **`fro-bot` as active PR author:** As of 2026-06-05, Fro Bot is opening PRs (#1681 Turbo fix, #1663 docs regen) in addition to the mrbro-bot[bot] automation — confirming the Fro Bot autoheal workflow is running and making commits.
- **Turbo task graph gap:** PR #1681 reveals a cold-cache Turborepo invariant: `@sparkle/test-utils` sub-path exports (`/dom`, `/console`) were not reachable in `moo-dang` tests because the `build:test-utils` task was missing from test task dependencies. This is a structural Turborepo pitfall when packages use sub-path exports that require a build step.
- **Oldest repo by creation date:** Created 2020-11-26, predating most other Marcus repos. Actively maintained despite age.

## Shared Ecosystem Patterns

| Feature | Sparkle | Portfolio Standard |
| --- | --- | --- |
| Probot settings | `fro-bot/.github:common-settings.yaml` | Same |
| Renovate preset | `marcusrbrown/renovate-config#5.2.0` | Same (major-bumped portfolio-wide) |
| ESLint config | `@bfra.me/eslint-config` 0.51.1 | Same (version varies) |
| Prettier config | `@bfra.me/prettier-config` 0.16.9 (`120-proof`) | Same |
| TS config | `@bfra.me/tsconfig` 0.13.1 | Same |
| pnpm | 10.33.4 | ~10.33.x |
| Node.js | 24.16.0 | 22–24 |
| TypeScript | 5.9.3 | 5.9–6.0 |
| Fro Bot workflow | **Present** (`fro-bot.yaml`, agent v0.65.0) | Present in most active repos |
| Fro Bot autoheal | **Present** (05:00 UTC, categories 1–8) | Present in most active repos |
| Maintenance report | **Present** (17:00 UTC perpetual issue) | Present in most active repos |
| Copilot setup steps | **Missing** | Present in most active repos |
| AGENTS.md | **Missing (root)** | Present in most active repos |
| `opencode.jsonc` | **Present** (points to copilot-instructions.md) | Emerging pattern |

## Open PRs and Issues

_As of 2026-06-16 survey (SHA `5ccf106`):_

### Open PRs (0)

No open PRs. All three PRs open at the 2026-06-05 survey (#1681 Turbo fix, #1663 docs regen, #1646 Renovate `@storybook/test-runner`) have since merged or closed. A clean PR queue while the autoheal/maintenance issues stay active reads as a healthy steady state — the daemon is keeping the deck clear.

### Open Issues (4 non-PR)

- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Issue count steady at 4. Note: the "Daily Maintenance Report" issue **#1666** exists but is **CLOSED** — see Active Perpetual Issues above for the open question on maintenance-report lifecycle._

---

_As of 2026-06-05 survey (SHA `e03e317`):_

### Open PRs (3)

- **#1681** — `fix(turbo): add @sparkle/test-utils#build dependency to test tasks` (fro-bot; fixes cold-cache Turborepo build failure where `moo-dang` tests couldn't resolve `@sparkle/test-utils` sub-path exports)
- **#1663** — `docs: regenerate API docs from current JSDoc sources` (fro-bot; automated docs regeneration PR)
- **#1646** — `chore(dev): update dependency @storybook/test-runner to v0.24.4` (mrbro-bot[bot] / Renovate)

_Note: Astro v6 security PR #1604 from prior surveys is no longer in the open PR list — either merged or closed between 2026-05-23 and 2026-06-05._

### Open Issues (4 non-PR)

- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, first run 2026-06-05)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD
- **#212** — Dependency Dashboard

_Issue #57 ("Uplift `sparkle`") and the Astro v6 security PR #1604 are no longer in the open state. Two new fro-bot-authored issues appeared (#1665, #1664) — first evidence of active Fro Bot autoheal operation in this repo._

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-28 | `770356b` | Initial survey — full page created |
| 2026-04-30 | `712ab1b` | Re-survey — Renovate preset bumped `#4.5.8` → `#4.5.9`, `bfra-me/.github` reusable workflows bumped to v4.16.11, lockfile maintenance. No structural changes. |
| 2026-05-01 | `712ab1b` | Re-survey — SHA unchanged. Open PRs: 2 (including Astro v6 security update #1604). Open issues: 5. No structural changes. Still no Fro Bot agent workflow. |
| 2026-05-23 | `e757fa6` | Re-survey — Renovate preset major-bumped `#4.5.9` → `#5.2.0` (matches the ecosystem-wide cutover seen in [[marcusrbrown--opencode-copilot-delegate]] and others). Node `24.15.0` → `24.16.0`. pnpm `10.33.2` → `10.33.4`. turbo `2.9.6` → `2.9.14`. `@bfra.me/eslint-config` `0.51.0` → `0.51.1`, `@bfra.me/prettier-config` `0.16.8` → `0.16.9`, `@bfra.me/tsconfig` `0.13.0` → `0.13.1`. Open PRs: 2 (Renovate `@storybook/test-runner` #1646 replaces prior #1507; Astro v6 security #1604 still open and unmerged). Open issues: 3 (#876, #212, #57) — drop from 5; #876 Phase-6 docs deployment still open. Workflows unchanged (6 files). Still no Fro Bot agent workflow. |
| 2026-06-05 | `e03e317` | **Major delta: Fro Bot agent workflow landed.** `fro-bot.yaml` added (agent v0.54.2) — first Fro Bot presence in this repo. pnpm `10.33.4` → `10.34.1`. Node.js 24.16.0 unchanged. Workflow count: 6 → 7. `opencode.jsonc` added at root. PR #1604 (Astro v6 security) no longer open. Issue #57 ("Uplift sparkle") closed. Two new fro-bot issues: #1665 (perpetual autohealing report), #1664 (stale TODO review). Two new fro-bot PRs: #1681 (Turbo task graph fix), #1663 (API docs regen). Open issues: 4 (up from 3). Open PRs: 3 (up from 2). `llms.txt` lists `pnpm@10.33.4` — minor drift from actual `10.34.1`. |
| 2026-06-16 | `5ccf106` | Re-survey — Fro Bot agent bumped v0.54.2 → **v0.65.0** (SHA `b7efdd6`). pnpm `10.34.1` → `10.34.3`. turbo `2.9.14` → `2.9.18`. Node.js 24.16.0 and `@bfra.me/*` toolchain unchanged. Workflow count steady at 7. All 3 prior open PRs (#1681, #1663, #1646) now merged/closed — **open PRs: 0**. Open issues steady at 4 (#1665, #1664, #876, #212). New observation: "Daily Maintenance Report" issue **#1666** exists but is **CLOSED** — maintenance-report lifecycle flagged for follow-up. `docs-legacy/` no longer present in root tree. `llms.txt` still pins `pnpm@10.33.4` — doc drift widened to actual `10.34.3`. No structural/architecture changes. |
