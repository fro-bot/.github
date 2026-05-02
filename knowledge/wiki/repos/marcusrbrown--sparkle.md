---
type: repo
title: "marcusrbrown/sparkle"
created: 2026-04-28
updated: 2026-05-01
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
- **Last push:** 2026-04-30
- **Homepage:** https://sparkle.mrbro.dev (Astro Starlight docs site on GitHub Pages)
- **License:** MIT
- **Topics:** `typescript`, `playground`, `next-js`, `react`, `vite`
- **Package manager:** pnpm 10.33.2
- **Node.js:** 24.15.0 (pinned via `.node-version`)
- **Stars:** 1, **Forks:** 1, **Watchers:** 2
- **Open issues:** 5, **Open PRs:** 2, **Has GitHub Pages:** yes

## Tech Stack

| Layer             | Technology                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| Language          | TypeScript 5.9.3 (strict mode, ESM-only `"type": "module"`)                      |
| Build             | Turborepo 2.9.6, tsdown 0.16.8, Vite                                             |
| Framework (web)   | React 19.2.5, Radix UI primitives, Tailwind CSS                                  |
| Framework (mobile)| Expo / React Native                                                               |
| Component docs    | Storybook                                                                         |
| Documentation     | Astro Starlight (`@sparkle/docs`), TypeDoc, automated JSDoc extraction            |
| Testing           | Vitest, Testing Library, axe-core accessibility, Playwright visual regression     |
| Linting           | ESLint 9.39.4 via `@bfra.me/eslint-config` 0.51.0 + Prettier via `@bfra.me/prettier-config` 0.16.8 (`120-proof` — 120 char) |
| TypeScript config | Extends `@bfra.me/tsconfig` 0.13.0                                               |
| Git hooks         | `simple-git-hooks` + `nano-staged` (runs `eslint --fix`, `sort-package-json`)     |
| Monorepo tools    | `@manypkg/cli` (workspace consistency checks), Changesets (versioning)            |
| Bundler           | tsdown (library packages), Vite (apps), Astro (docs)                              |

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
| `.node-version` | Node.js 24.15.0 |
| `eslint.config.ts` | Root ESLint config |
| `tsconfig.json` / `tsconfig.node.json` | TypeScript project references |
| `.github/actions/setup-ci/` | Composite CI setup action |
| `.github/copilot-instructions.md` | AI agent development guide |
| `.ai/` | AI context files (analysis, audit, notes, plan, review, security) |
| `.changeset/config.json` | Changesets versioning config |

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

### CI Jobs (main.yaml)

1. **Setup** — checkout + setup-ci composite action (pnpm install, optional Zig install)
2. **Check** — `pnpm check` (monorepo consistency, type-check, Turbo validation, dependency validation, ESLint)
3. **Build** — `pnpm build` (full Turborepo build graph, includes Zig support)

### Branch Protection

Required status checks on `main`: `Build`, `Check`, `Renovate / Renovate`, `Setup`. Enforces admins, linear history, no required PR reviews.

### Automated Documentation Pipeline

The `regenerate-docs.yaml` workflow detects package source changes, runs TypeDoc/JSDoc extraction, and creates a PR via `peter-evans/create-pull-request`. Commits are authored by `mrbro-bot[bot]` (app 137683033). Force rebuild option available via dispatch.

## Fro Bot Integration

**No Fro Bot agent workflow detected.** The repository lacks `fro-bot.yaml` and `fro-bot-autoheal.yaml` — a follow-up draft PR should be proposed to add Fro Bot PR review and autohealing capabilities.

The repo does have:

- Probot settings extending `fro-bot/.github:common-settings.yaml` (confirmed via `.github/settings.yml`)
- Renovate via `bfra-me/.github` reusable workflow extending `marcusrbrown/renovate-config#4.5.8`
- GitHub App tokens via `actions/create-github-app-token` (for regenerate-docs workflow)

Missing Fro Bot capabilities:

- Automated PR review with structured verdicts
- Daily maintenance reporting
- Nightly autohealing (errored PRs, security, code quality, DX)
- `@fro-bot` mention-triggered responses

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.9` + `sanity-io/renovate-config:semantic-commit-type` + `:preserveSemverRanges`. Post-upgrade runs `pnpm bootstrap && pnpm fix`. React Native package grouping rules. Automerge on unstable minor/patch for `@astrojs/check` and `typedoc`. PR creation: `immediate`.
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
- **Oldest repo by creation date:** Created 2020-11-26, predating most other Marcus repos. Actively maintained despite age.

## Shared Ecosystem Patterns

| Feature | Sparkle | Portfolio Standard |
| --- | --- | --- |
| Probot settings | `fro-bot/.github:common-settings.yaml` | Same |
| Renovate preset | `marcusrbrown/renovate-config#4.5.9` | Same |
| ESLint config | `@bfra.me/eslint-config` 0.51.0 | Same (version varies) |
| Prettier config | `@bfra.me/prettier-config` 0.16.8 (`120-proof`) | Same |
| TS config | `@bfra.me/tsconfig` 0.13.0 | Same |
| pnpm | 10.33.2 | ~10.33.x |
| Node.js | 24.15.0 | 22–24 |
| TypeScript | 5.9.3 | 5.9–6.0 |
| Fro Bot workflow | **Missing** | Present in most active repos |
| Fro Bot autoheal | **Missing** | Present in most active repos |
| Copilot setup steps | **Missing** | Present in most active repos |
| AGENTS.md | **Missing (root)** | Present in most active repos |

## Open PRs and Issues

### Open PRs (2)

- **#1604** — `fix(deps): update dependency astro to v6 [SECURITY]` (Renovate, security)
- **#1507** — `chore(dev): update dependency @storybook/test-runner to v0.24.3` (Renovate)

### Open Issues (5)

- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD
- **#212** — Dependency Dashboard
- **#57** — Uplift `sparkle`

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-28 | `770356b` | Initial survey — full page created |
| 2026-04-30 | `712ab1b` | Re-survey — Renovate preset bumped `#4.5.8` → `#4.5.9`, `bfra-me/.github` reusable workflows bumped to v4.16.11, lockfile maintenance. No structural changes. |
| 2026-05-01 | `712ab1b` | Re-survey — SHA unchanged. Open PRs: 2 (including Astro v6 security update #1604). Open issues: 5. No structural changes. Still no Fro Bot agent workflow. |
