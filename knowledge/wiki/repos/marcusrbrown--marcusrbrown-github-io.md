---
type: repo
title: "marcusrbrown/marcusrbrown.github.io"
created: 2026-04-25
updated: 2026-04-27
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: a3643ae
    accessed: 2026-04-27
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: ec4b7854bee556aadd301950392268f70817d800
    accessed: 2026-04-25
tags: [brand-site, react, typescript, vite, github-pages, pnpm, single-page]
aliases: [marcusrbrown-github-io, marcusrbrown.com]
related:
  - marcusrbrown--mrbro-dev
  - marcusrbrown--gpt
---

# marcusrbrown/marcusrbrown.github.io

Personal brand site for Marcus R. Brown. Single-page React 19 portfolio deployed to [[github-pages]] at [marcusrbrown.com](https://marcusrbrown.com). Simpler than [[marcusrbrown--mrbro-dev]] (the full developer portfolio at mrbro.dev) — no routing, no theme system, no blog. Four anchor-linked sections: About, Experience, Skills, Contact.

## Overview

- **Purpose:** Personal brand site / landing page
- **Default branch:** `main`
- **Created:** 2025-07-18
- **Last push:** 2026-04-27
- **Homepage:** https://marcusrbrown.com
- **License:** MIT (declared in package.json and README badge; no LICENSE file detected via API)
- **Visibility:** Public
- **Stars:** 0 | **Watchers:** 0
- **Open issues:** 2 (#260 Daily Maintenance Report, #6 Dependency Dashboard)
- **Open PRs:** 0

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
| UI Framework | React | 19.x |
| Language | TypeScript | 6.0+ (strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`) |
| Bundler | Vite | 7.x (SWC via `@vitejs/plugin-react-swc`) |
| Unit Testing | Vitest | 4.x (happy-dom) |
| E2E Testing | Playwright | 1.58.x |
| Accessibility | vitest-axe + axe-core | via `src/test-setup.ts` |
| Linting | ESLint 10 flat config (`eslint.config.ts`) | `@bfra.me/eslint-config` ^0.51.0 |
| Formatting | Prettier | `@bfra.me/prettier-config/120-proof` |
| Type Config | TypeScript | `@bfra.me/tsconfig` ^0.13.0 |
| Package Manager | pnpm | 10.33.2 (enforced via `packageManager` field) |
| Node.js | >= 22.0.0 | |
| Git Hooks | simple-git-hooks + lint-staged | |

## Repository Structure

```
src/
  App.tsx                      # Root component -> Navigation + 4 sections
  main.tsx                     # Entry point (StrictMode + brand.css)
  test-setup.ts                # Extends vitest with axe-core a11y matchers
  components/
    Navigation.tsx             # Anchor-link nav bar
    sections/                  # About, Experience, Skills, Contact
    __tests__/                 # Component smoke tests
  hooks/
    UseScrollReveal.ts         # IntersectionObserver scroll animation
    __tests__/                 # Hook unit tests
  styles/                      # brand.css, Navigation.css
tests/e2e/                     # Playwright E2E tests
scripts/                       # Build analysis + test automation
.github/
  workflows/                   # ci, deploy, renovate, fro-bot, copilot-setup-steps
  actions/setup/               # Composite action: Node 22 + pnpm + optional Playwright
.ai/plan/                      # Feature implementation plans (reference)
```

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PR to `main`, dispatch | Lint, build, test, type-check, dependency audit, quality gate |
| Deploy | `deploy.yaml` | push to `main`, dispatch | Lint, build, deploy to GitHub Pages (marcusrbrown.com) |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule, dispatch | PR review, daily maintenance, @fro-bot mentions |
| Renovate | `renovate.yaml` | issue/PR edit, push to non-main, dispatch, workflow_run | Dependency management via `bfra-me/.github` reusable workflow |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | dispatch, push/PR touching workflow | Copilot agent environment verification |

### CI Quality Gate (ci.yaml)

Six parallel jobs after shared setup: Lint (ESLint + formatting check), Build (with dist output verification), Test (Vitest), Type Check (`tsc --noEmit`), Validate Dependencies (`pnpm audit`). A `quality-gate` aggregation job posts a PR comment on pass. Uses a GitHub App token (`APPLICATION_ID`/`APPLICATION_PRIVATE_KEY`) for the PR comment step.

### Deploy Pipeline (deploy.yaml)

Sequential: checkout, setup, lint, build, upload pages artifact (`./dist`), deploy via `actions/deploy-pages`. Requires `pages: write` and `id-token: write` permissions. Concurrency group `pages` with `cancel-in-progress: false`.

### Shared Setup Action

`.github/actions/setup/` — reusable composite action. Handles pnpm install (via `pnpm/action-setup@v6.0.3`), Node.js 22 (via `actions/setup-node@v6.4.0`), optional Playwright browser install with caching. Used across all workflows.

## Fro Bot Integration

**Fro Bot workflow is present and active** (`fro-bot/agent@v0.42.2`, SHA `94d8a156570d68d2461ab496b589e63bdcd6ba84`).

- **Triggers:** PR events (opened, synchronize, ready_for_review, reopened, review_requested), issue/comment events (`@fro-bot` mention from OWNER/MEMBER/COLLABORATOR), daily schedule (15:30 UTC), manual dispatch
- **PR review prompt:** Structured review targeting React 19 patterns, TypeScript strictness, pure ESM, accessibility (WCAG 2.1 AA), performance budgets (JS <500KB warning, total <2MB max), PascalCase hooks, `.yaml` extension convention. Verdict format: PASS / CONDITIONAL / REJECT with blocking/non-blocking/missing tests/risk sections.
- **Schedule prompt:** Daily "Daily Maintenance Report" rolling issue with 14-day window, stale issue/PR detection, security alerts, recommended actions.
- **Fork PR guard:** Skips bot-authored and fork PRs. Issue_comment fork detection via API call.
- **Concurrency:** Per-issue/PR, non-cancelling.

**No Fro Bot autoheal workflow detected** — unlike [[marcusrbrown--mrbro-dev]], [[marcusrbrown--vbs]], and other repos that have `fro-bot-autoheal.yaml`. A follow-up to add autohealing may be warranted.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8` + `:preserveSemverRanges` + `group:allNonMajor`. Post-upgrade: `pnpm install`, `pnpm run build`, `pnpm run fix` (twice). Uses `bfra-me/.github` reusable workflow (v4.16.9). Trigger model: issue/PR edit (non-bot), push to non-main, dispatch, workflow_run after Deploy.
- **Git Hooks:** `simple-git-hooks` with `lint-staged` running `eslint --fix` on staged files.
- **AGENTS.md:** Comprehensive root-level file with code map, conventions, commands, CI table, testing guide, anti-patterns. Generated 2026-03-10.
- **Copilot instructions:** `.github/copilot-instructions.md` with stack summary and critical conventions (PascalCase hooks, strict TS, named exports, `.yaml` extension).
- **AI planning:** `.ai/plan/` directory for feature implementation plans.
- **pnpm workspace:** `pnpm-workspace.yaml` present with security overrides (`flatted`, `ajv`, `brace-expansion`, etc.) and `shamefullyHoist: true`.

## Notable Patterns and Conventions

- **PascalCase hook files:** `UseScrollReveal.ts` not `useScrollReveal.ts` — same convention as [[marcusrbrown--mrbro-dev]]
- **No routing:** Single-page with anchor links, no React Router
- **No default exports:** Named exports only, enforced via AGENTS.md
- **No enums:** `erasableSyntaxOnly` — use `as const` unions
- **Pure ESM:** No CommonJS `require()` or `module.exports`
- **ESLint flat config:** `eslint.config.ts` extending `@bfra.me/eslint-config` with React and Vitest support. Markdown virtual files excluded from type-aware rules (tracked in issue #265).
- **SWC over Babel:** `@vitejs/plugin-react-swc` for compilation
- **Inline Vitest config:** Test config lives inside `vite.config.ts`, no separate vitest.config
- **Accessibility-first:** `vitest-axe` matchers in test setup for `toHaveNoViolations()` assertions

## Missing Compared to Other Marcus Repos

- **No Probot `settings.yml`:** Unlike [[marcusrbrown--mrbro-dev]], [[marcusrbrown--ha-config]], and most other Marcus repos, this repo does not have a `.github/settings.yml` extending `fro-bot/.github:common-settings.yaml`. Branch protection and repo settings are not managed via Probot.
- **No autoheal workflow:** No `fro-bot-autoheal.yaml` for automated CI repair, security sweeps, or convention enforcement.
- **No CodeQL/Scorecard:** No security scanning workflows (present in [[marcusrbrown--systematic]] and [[marcusrbrown--mrbro-dev]]).
- **No performance workflow:** No Lighthouse CI or dedicated performance monitoring (present in [[marcusrbrown--mrbro-dev]]).

## Relationship to mrbro.dev

This repo and [[marcusrbrown--mrbro-dev]] both deploy React+Vite sites to GitHub Pages, but serve different purposes:

| Aspect | marcusrbrown.github.io | mrbro.dev |
| --- | --- | --- |
| Domain | marcusrbrown.com | mrbro.dev |
| Scope | Single-page brand landing | Full portfolio + blog + projects |
| Routing | None (anchor links) | React Router v7 |
| Theme system | None | 10+ presets, custom creator, JSON schema validation |
| Content source | Static | GitHub API (dynamic blog/projects) |
| Test layers | Unit + E2E + A11y | Unit + E2E + Visual regression + A11y + Lighthouse |
| Autoheal | Not present | Present (5-category daily) |
| Fro Bot agent version | v0.42.2 | v0.41.3 |

## Recent Activity

Latest commits remain exclusively Renovate dependency bumps:
- `a3643ae` 2026-04-27: update bfra-me/.github to v4.16.9 (#393)
- `94542f5` 2026-04-26: update all non-major dependencies (#392)
- `24ec5e0` 2026-04-26: update fro-bot/agent to v0.42.1 (#391)
- `fbca40b` 2026-04-25: update pnpm to v10.33.1 (#390)
- `ec4b785` 2026-04-22: update all non-major dependencies (#389)

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-04-27 | `a3643ae` | Incremental re-survey; Fro Bot v0.41.4→v0.42.2, pnpm 10.33.0→10.33.2, bfra-me/.github v4.16.8→v4.16.9 |
| 2026-04-25 | `ec4b785` | Initial survey |
