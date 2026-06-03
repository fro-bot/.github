---
type: repo
title: "marcusrbrown/mrbro.dev"
created: 2026-04-18
updated: 2026-06-02
sources:
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: 51f5cab5c77768b761d9f0a688ac7436cc5a06f4
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: d8c0e43a471aa41b030890122d75450b5626b981
    accessed: 2026-04-26
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: 88f7a4adf497fe9bb772f27b05216d4e0235af3e
    accessed: 2026-05-21
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: 7a49abc3d2d945880cc1db1f4edbddcd71ad0142
    accessed: 2026-06-02
tags: [portfolio, react, typescript, vite, github-pages, blog, pnpm]
aliases: [mrbro-dev, mrbro.dev]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--marcusrbrown-github-io
---

# marcusrbrown/mrbro.dev

Marcus R. Brown's developer portfolio website. React 19, TypeScript (strict), Vite 7, deployed to [[github-pages]] at [mrbro.dev](https://mrbro.dev). Features an advanced theme system, GitHub API-driven blog/project showcase, and a comprehensive multi-layer test suite.

## Overview

- **Purpose:** Personal portfolio and blog
- **Default branch:** `main`
- **Created:** 2026-03-06
- **Last push:** 2026-04-20
- **Homepage:** https://mrbro.dev
- **Topics:** `blog`, `developer`, `github-pages`, `portfolio`, `react`, `typescript`, `vite`
- **License:** MIT (badge present, no LICENSE file detected via API)
- **Open issues:** 4 as of 2026-06-02 — the canonical rolling pair holds: "Daily Autohealing Report" #162 and "Daily Maintenance Report" #13, plus #1 Dependency Dashboard and #48 triage. (Was 8 on 2026-05-21; the four pin-version PRs that were inflating the count have mostly merged.)
- **Open PRs:** 5 as of 2026-06-02 (all Renovate: #180 `prettier` 3.8.3, #178 pnpm override for `tmp` path-traversal advisory, #175 `eslint-plugin-react-refresh` 0.5.2, #172 `@bfra.me/prettier-config` 0.16.8, #168 `@bfra.me/eslint-config` v0.51.0)

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
| UI Framework | React | 19.x |
| Language | TypeScript | 5.6+ (strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`) |
| Bundler | Vite | 7.x (SWC via `@vitejs/plugin-react-swc`) |
| Routing | React Router | v7 (`react-router-dom` ^7.7.1) |
| Syntax Highlighting | Shiki | 4.x (externalized in build) |
| Schema Validation | Ajv + ajv-formats | 8.x |
| Unit Testing | Vitest | 4.x (happy-dom) |
| E2E / Visual / A11y Testing | Playwright | 1.54.x |
| Performance Testing | Lighthouse CI | 0.15.x |
| Linting | ESLint 10 flat config (`eslint.config.ts`) | `@bfra.me/eslint-config` ^0.51.0 |
| Formatting | Prettier | `@bfra.me/prettier-config/120-proof` |
| Type Config | TypeScript | `@bfra.me/tsconfig` ^0.13.0 |
| Package Manager | pnpm | 10.33.0 (enforced via `packageManager` field) |
| Node.js | >= 22.6.0 |  |
| Git Hooks | simple-git-hooks + lint-staged |  |

**Note:** TypeScript remains at `^5.6.3`. Several sibling repos (tokentoilet, marcusrbrown.github.io) have moved to TypeScript v6. No v6 upgrade PR currently open.

## Repository Structure

```
src/
  components/    # 22 React components (PascalCase .tsx)
  hooks/         # 9 custom hooks (PascalCase filenames: UseTheme.ts)
  contexts/      # ThemeContext provider
  pages/         # 4 route pages: Home, Blog, Projects, About
  utils/         # 12 utilities (theme system, GitHub API, syntax highlighting)
  types/         # TypeScript types (barrel export via index.ts)
  schemas/       # theme.schema.json for runtime validation
  styles/        # Global CSS
scripts/         # 14 build/test automation scripts
tests/           # Multi-type test infrastructure
.agents/skills/  # Agent skill definitions (agent-browser, playwright-mcp)
.ai/plan/        # Feature implementation plans (reference only)
examples/        # Usage examples (button-form-styles, use-theme)
```

### Key Components

- `HeroSection`, `AboutSection`, `SkillsShowcase`, `CareerTimeline`, `TestimonialsCarousel` — landing page sections
- `ProjectCard`, `ProjectFilter`, `ProjectGallery`, `ProjectPreviewModal` — project showcase
- `BlogPost`, `CodeBlock` — blog with Shiki syntax highlighting
- `ThemeCustomizer`, `ThemePreview`, `ThemeToggle`, `PresetThemeGallery` — advanced theme UI
- `Header`, `Footer`, `SmoothScrollNav`, `BackgroundPattern` — layout/navigation
- `AnimatedCounters`, `ContactCta`, `LoadingStates` — utility components

### Custom Hooks (PascalCase Convention)

| Hook                    | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `UseTheme`              | Compound return (17 properties) for theme control |
| `UseGitHub`             | GitHub API data fetching (repos, blog)            |
| `UseSyntaxHighlighting` | Shiki-based code highlighting                     |
| `UseAnalytics`          | Analytics tracking                                |
| `UsePageTitle`          | Document title management                         |
| `UseParallax`           | Scroll parallax effects                           |
| `UseProgressiveImage`   | Lazy/progressive image loading                    |
| `UseProjectFilter`      | Project filtering logic                           |
| `UseScrollAnimation`    | Scroll-triggered animations                       |

### Theme System

The most architecturally significant feature. Centered on `ThemeContext` (300+ line provider) with:

- 10+ preset themes (Material, Dracula, Nord, Solarized, etc.)
- Custom theme creator with JSON schema validation (`theme.schema.json`, Ajv)
- Import/export functionality
- CSS custom property injection
- System preference detection (dark/light)
- Theme preloading and performance optimization
- Dedicated utils: `preset-themes.ts`, `theme-export.ts`, `theme-performance.ts`, `theme-preloader.ts`, `theme-storage.ts`, `theme-validation.ts`

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Deploy | `deploy.yaml` | push to `main`, dispatch | Lint, test, build, deploy to GitHub Pages |
| CI | `ci.yaml` | PR to `main`, dispatch | Lint, test (with coverage), build, type-check, dependency audit, quality gate |
| E2E Tests | `e2e-tests.yaml` | PR to `main`, dispatch | Playwright E2E (Chromium), visual regression, accessibility (axe-core), badge generation |
| Performance | `performance.yaml` | push to `main`, PR, weekly cron, dispatch | Lighthouse CI (desktop + mobile), bundle analysis, performance budgets, regression detection |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (03:30 + 15:30 UTC), dispatch | Three-mode: PR review / daily maintenance / autoheal (single file as of 2026-05-21) |
| Renovate | `renovate.yaml` | issue/PR edit, push (non-main), workflow_run, dispatch | Dependency management via `bfra-me/.github` reusable workflow |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | — | GitHub Copilot coding agent environment |

### CI Quality Gate (ci.yaml)

Six parallel jobs after setup: Lint, Test (with coverage), Build (with `analyze-build`), Type Check (`tsc --noEmit`), Validate Dependencies (`pnpm audit`). A `quality-gate` job aggregates all results and posts a PR comment on pass.

### Deploy Pipeline (deploy.yaml)

Sequential: checkout, setup, lint, test, build (with `GITHUB_PAGES=true`), upload pages artifact, deploy via `actions/deploy-pages`.

### Shared Setup Action

`.github/actions/setup/` — reusable composite action for CI. Handles Node.js 22, pnpm installation, optional Playwright browser install. Used across all workflows.

## Fro Bot Integration

**As of 2026-05-21 (SHA `88f7a4a`), the Fro Bot integration is a single-file three-mode workflow.** The standalone `fro-bot-autoheal.yaml` has been consolidated into `fro-bot.yaml`, matching the pattern in [[marcusrbrown--marcusrbrown-github-io]] and the broader Fro Bot fleet.

### fro-bot.yaml (single-file, three modes — current)

- **Agent pin:** `fro-bot/agent@v0.43.0` (SHA `1563f2987343b5e8d30ba818920d0ac563c617fa`)
- **Modes** (selectable via `workflow_dispatch.inputs.mode`, default `autoheal`):
  - `review` — PR review with structured verdict (`PASS | CONDITIONAL | REJECT`), blocking/non-blocking/missing-tests/risk-assessment sections; reserved for `pull_request`, `*_comment`, and `issues` events
  - `maintenance` — Single perpetual "Daily Maintenance Report" issue at 15:30 UTC; the prompt mandates exactly one open maintenance issue at all times (drift-correction language)
  - `autoheal` — Daily autoheal at 03:30 UTC (staggered off sibling repos)
- **Triggers:** `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request` (opened/synchronize/reopened/ready_for_review/review_requested), two `schedule` crons, `workflow_dispatch`
- **Concurrency:** Per issue/PR/discussion/schedule, non-cancelling
- **PR review prompt** is mrbro.dev-specific: React 19 / TypeScript / Vite 7, WCAG 2.1 AA, performance budget (JS <500KB, total <2MB), pure ESM, PascalCase hooks, `.yaml` extension enforcement, named exports preferred. Style nits explicitly deferred to ESLint/Prettier.
- **Hard boundary**: "Do NOT push commits, modify code, or create branches. Review only."

#### Prompt hardening ported from `marcusrbrown/marcusrbrown` (#176, 2026-05-24)

Five surgical prompt inserts were ported in from a 2026-05-23 session that diagnosed a 1.5-year silent automation outage in [[marcusrbrown--marcusrbrown]] (root cause: a finalize job gated on `needs: prepare`, where `prepare` had an `if:` condition, so GitHub's implicit `success()` guard silently skipped the downstream job on every scheduled run). The inserts spread review/maintenance coverage to the same failure class:

- **Skipped-needs trap** (PR review): flag finalize jobs depending on conditional prepare jobs that lack `!cancelled()` to bypass the implicit `success()` guard.
- **`continue-on-error` red-flag** (PR review): `continue-on-error: true` on local deterministic steps is a smell; reserve it for external-API fetches with explicit fallback.
- **Workflow-health monitor** (maintenance): adds a 7-day workflow-run health section to the Daily Maintenance Report.
- Two further inserts preserve existing prompt voice/indentation (no sections replaced).

This is the cross-repo intelligence pattern in action: a bug fixed in one managed repo propagates as a review heuristic into siblings. The fix itself lives in `marcusrbrown/marcusrbrown` PRs #923 (bug) and #924 (source workflow).

### fro-bot.yaml (prior two-file form — historical, 2026-04-18 → 2026-04-26)

- Triggers: PR events (opened, synchronize, reopened, ready_for_review, review_requested), issue events (opened, edited), comment events (`@fro-bot` mention including discussion comments), daily schedule (15:30 UTC), manual dispatch
- Used `fro-bot/agent@v0.41.3` (SHA `36c9850c2ac6e6d4d532662fca2ca89bd2bc559d`) with `FRO_BOT_PAT` token
- `opencode-config` secret passed via environment (added 2026-04-19, #135)
- PR review prompt: structured review (Verdict/Blocking/Non-blocking/Missing tests/Risk assessment)
- Schedule prompt: daily maintenance issue ("Daily Maintenance Report") with 14-day rolling window
- Concurrency: per-issue/PR, non-cancelling
- Fork PR guard: skips bot-authored and fork PRs; additional fork-check step for issue_comment on PR events

### fro-bot-autoheal.yaml (removed 2026-05-21)

- Triggers: daily 03:30 UTC, manual dispatch
- Used `fro-bot/agent@v0.41.3` (SHA `36c9850c2ac6e6d4d532662fca2ca89bd2bc559d`)
- `opencode-config` secret passed via environment
- Five-category autoheal: errored PRs, security, code quality/hygiene, developer experience, production site review
- Production site review uses `npx agent-browser` to check mrbro.dev pages (/, /about, /projects, /blog)
- Enforces project conventions (PascalCase hooks, no `any`, pure ESM, pnpm only)
- Hard boundaries: no force-push, no direct-to-main, no disabling tests
- Outputs single "Daily Autohealing Report — YYYY-MM-DD (UTC)" issue per run
- **Observation (2026-04-26):** Multiple separate daily report issues are open (#138, #140–#146) rather than the intended single rolling issue — possible behavioral drift in autoheal prompt compliance

## Testing Infrastructure

Comprehensive multi-layer test suite:

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest 4 + happy-dom | Component/utility coverage (80% threshold enforced for statements/branches/functions/lines) |
| E2E | Playwright (Chromium, Firefox, WebKit defined; Chromium active in CI) | Cross-browser functional tests |
| Visual Regression | Playwright screenshots | 32 baseline images, automated diff |
| Accessibility | Playwright + axe-core | WCAG 2.1 AA compliance |
| Performance | Lighthouse CI | Core Web Vitals, device-specific budgets (mobile + desktop) |
| Bundle Size | Custom `analyze-build` script | JS <500KB warning, total <2MB max |

Coverage as of README badges: 70.81% statements, 80.19% branches, 60.4% functions, 70.81% lines. Below enforced 80% thresholds for statements, functions, and lines.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.0` (as of 2026-05-21, bumped from `#4.5.8`). Post-upgrade runs: `pnpm install`, `pnpm run build`, `pnpm run fix` (twice), `executionMode: 'branch'`. Groups all non-major updates. Config lives at `.github/renovate.json5`.
- **Probot Settings:** **Not configured.** No `.github/settings.yml` present — unusual for Marcus repos where Probot settings extending `fro-bot/.github:common-settings.yaml` is the standard pattern. Branch protection managed via `.github/BRANCH_PROTECTION.md` documentation and `scripts/configure-branch-protection.ts` script instead.
- **Git Hooks:** `simple-git-hooks` with `lint-staged` (ESLint --fix on staged files). Pre-push hook at `.github/git-hooks/pre-push.ts`.
- **Copilot Hooks:** `.github/hooks/` directory for Copilot pre-tool-use guardrails.
- **AGENTS.md:** Root-level and per-directory agent instruction files. Comprehensive conventions, code map, and anti-patterns documented.
- **Shared Configs:** `@bfra.me/eslint-config` ^0.51.0, `@bfra.me/tsconfig` ^0.13.0, `@bfra.me/prettier-config/120-proof` — same shared config ecosystem as the Fro Bot org.

## Security Posture

**As of 2026-06-02 (SHA `7a49abc`), the pnpm `overrides` block migrated out of `package.json` into `pnpm-workspace.yaml`** (alongside `onlyBuiltDependencies` and `shamefullyHoist: true`). The override list expanded substantially as the CI dependency-audit gate (#177) surfaced more transitive advisories. Each entry carries an inline GHSA comment naming the advisory and the dependency path that pulls the vulnerable package — almost all via `@lhci/cli` (Lighthouse) and `@bfra.me/eslint-config` transitive trees.

Current overrides (`pnpm-workspace.yaml`):

| Override | Reason / advisory |
| --- | --- |
| `@isaacs/brace-expansion@<=5.0.0: >=5.0.1` | brace-expansion family ReDoS |
| `ajv@>=7.0.0-alpha.0 <8.18.0: >=8.18.0` | ajv advisory |
| `basic-ftp: 5.3.1` | Transitive advisory remediation |
| `brace-expansion: ^5.0.6` | GHSA-jxxr-4gwj-5jf2 (moderate; via `@bfra.me/eslint-config` → eslint-plugin-command → typescript-estree → minimatch) |
| `fast-uri: >=3.1.2` | Added #165 |
| `flatted@<3.4.2: >=3.4.2` | flatted advisory |
| `ip-address: >=10.1.1` | Added 2026-05-21 |
| `js-yaml@>=4.0.0 <4.1.1: >=4.1.1` | js-yaml advisory |
| `lodash / lodash-es: >=4.18.0` | Prototype pollution (#109) |
| `mdast-util-to-hast@>=13.0.0 <13.2.1: >=13.2.1` | mdast advisory |
| `minimatch@>=10.0.0 <10.2.3: >=10.2.3` | minimatch advisory |
| `path-to-regexp: >=0.1.13` | ReDoS |
| `picomatch@>=4.0.0 <4.0.4: >=4.0.4` | Glob DoS |
| `qs: ^6.15.2` | GHSA-q8mj-m7cp-5q26 (moderate; via `@lhci/cli` → express → qs) |
| `rollup@>=4.0.0 <4.59.0: >=4.59.0` | rollup advisory |
| `tmp@<=0.2.3: >=0.2.6` | GHSA-52f5-9888-hmc6 (low; via `@lhci/cli` → tmp and inquirer → external-editor → tmp). Note: best-effort only — `@lhci/cli` and `external-editor` pin tmp below the safe range, so pnpm cannot fully resolve it (#179) |
| `uuid: >=14.0.0` | GHSA-w5hq-g745-h8pq (#148) |
| `ws: ^8.20.1` | GHSA-58qx-3vcg-4xpx (moderate; via `@lhci/cli` → lighthouse → puppeteer-core → ws) |
| `yauzl@<3.2.1: >=3.2.1` | yauzl advisory |

Vite upgraded to v7.3.2 for security fix (#121). The migration to a CI dependency-audit gate (`pnpm audit`, #177) is now the forcing function that keeps this list current — overrides are added in response to a failing audit rather than ad-hoc.

## Notable Patterns

- **PascalCase hook files:** `UseTheme.ts` not `useTheme.ts` — deliberate deviation from React community convention, enforced via AGENTS.md and autoheal.
- **No barrel exports:** All imports use direct file paths except `src/types/index.ts`.
- **Pure ESM enforcement:** No `require()` or `module.exports`. `verbatimModuleSyntax` and `erasableSyntaxOnly` enforced in tsconfig.
- **SWC over Babel:** `@vitejs/plugin-react-swc` for faster compilation.
- **Shiki externalized:** Syntax highlighting packages excluded from main bundle via Rollup `external` config, with custom manual chunks for vendor/shiki splitting.
- **Theme as first-class architecture:** The theme system dominates the utility layer (7 of 12 utils are theme-related) and drives testing strategy (visual regression across theme presets).
- **GitHub API as content source:** Blog and projects are dynamically fetched from GitHub, not static content. No CMS or headless backend.
- **Codespaces-ready:** Configured for GitHub Codespaces with quickstart badge.
- **package.json `repository.url` mismatch:** Points to `marcusrbrown.github.io.git` instead of `mrbro.dev.git` — likely a copy artifact from [[marcusrbrown--marcusrbrown-github-io]].

## Connections to Fro Bot Ecosystem

- Uses `fro-bot/agent@v0.43.0` in the single consolidated workflow (v0.38.0 → v0.41.3 → v0.43.0 across surveys)
- Shares `@bfra.me/*` config ecosystem with the Fro Bot org
- Renovate extends `marcusrbrown/renovate-config#5.2.0` — first repo in this wiki observed on the v5 preset line
- Authentication via `APPLICATION_ID`/`APPLICATION_PRIVATE_KEY` secrets (GitHub App) in CI, `FRO_BOT_PAT` + `opencode-config` for agent workflow
- **No Probot settings.yml** — diverges from sibling repos that extend `fro-bot/.github:common-settings.yaml`
- Sibling portfolio site: [[marcusrbrown--marcusrbrown-github-io]] (both React+Vite GitHub Pages, different scope and domain) — both now run the single-file three-mode Fro Bot workflow

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `51f5cab` | Initial survey |
| 2026-04-26 | `d8c0e43` | Agent v0.38.0→v0.41.3, Renovate #4.5.7→#4.5.8, opencode-config added, security overrides, no settings.yml noted, 39 open issues |
| 2026-05-21 | `88f7a4a` | Workflows consolidated: `fro-bot-autoheal.yaml` removed, single `fro-bot.yaml` with three modes (review/maintenance/autoheal). Agent v0.41.3 → v0.43.0. Renovate preset #4.5.8 → #5.2.0. Open issues 39 → 8 (autoheal backlog drained). Open PRs 4 (all pin-version Renovate). New pnpm overrides: `fast-uri ≥3.1.2`, `ip-address ≥10.1.1`, `uuid ≥14.0.0`. TypeScript bumped 5.6.x → 5.9.3 (still pre-v6). Vitest 4.1.4, pnpm 10.33.4. |
| 2026-06-02 | `7a49abc` | **pnpm `overrides` migrated `package.json` → `pnpm-workspace.yaml`** and expanded to ~20 entries with inline GHSA annotations, driven by a new `pnpm audit` CI gate (#177). New advisories pinned: `qs`, `ws`, `tmp`, `rollup`, `js-yaml`, `flatted`, `ajv`, `mdast-util-to-hast`, `minimatch`, `yauzl` — mostly transitive via `@lhci/cli`. **Fro Bot prompt hardening (#176):** ported 5 inserts from [[marcusrbrown--marcusrbrown]] (skipped-needs trap, `continue-on-error` red-flag, 7-day workflow-health monitor). Agent unchanged at v0.43.0. Open issues 8 → 4 (pin PRs merged). Open PRs 5 (Renovate). TypeScript still 5.9.3, pnpm 10.33.4, Vitest 4.1.4. No structural code/layout change. |
