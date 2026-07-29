---
type: repo
title: "marcusrbrown/mrbro.dev"
created: 2026-04-18
updated: 2026-07-29
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
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: 7a49abc3d2d945880cc1db1f4edbddcd71ad0142
    accessed: 2026-06-13
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: 7a49abc3d2d945880cc1db1f4edbddcd71ad0142
    accessed: 2026-06-23
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: a5a6d8c73ef5995fce3749b6eece04eeaede6361
    accessed: 2026-07-22
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: a5a6d8c73ef5995fce3749b6eece04eeaede6361
    accessed: 2026-07-24
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 0b31ea70ec0b6ca2ec467085abd1c9d713f89faa
    accessed: 2026-07-25
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 26437038c08818b5be0a02c123c7712e10139dc7
    accessed: 2026-07-26
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 345bc21fda340ee7efa54aff9883d62f1dd0973b
    accessed: 2026-07-28
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 1b6f5eb4dd810e30132da738b15a219c9b4c8146
    accessed: 2026-07-29
tags: [portfolio, react, typescript, vite, github-pages, blog, pnpm, name-collision]
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
- **Open issues:** 4 as of 2026-06-23 (unchanged through 2026-06-02/06-13) — the canonical rolling pair holds: "Daily Autohealing Report" #162 and "Daily Maintenance Report" #13, plus #1 Dependency Dashboard and #48 triage. (Was 8 on 2026-05-21; the four pin-version PRs that were inflating the count have mostly merged.)
- **Open PRs:** 6 as of 2026-06-23 — set grew by one since 2026-06-02. New: #181 `vite` 7.3.2 → 7.3.5 `[SECURITY]` (`mrbro-bot`, labels `automerge`+`security`, opened 2026-06-15). Remaining unchanged: #180 `prettier` 3.8.3, #178 pnpm override for `tmp` path-traversal advisory (`fro-bot`), #175 `eslint-plugin-react-refresh` 0.5.2, #172 `@bfra.me/prettier-config` 0.16.8, #168 `@bfra.me/eslint-config` v0.51.0. All Renovate-class.

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
| E2E / Visual / A11y Testing | Playwright | 1.59.1 (was recorded as 1.54.x; corrected 2026-06-13 against same `7a49abc` tree) |
| Performance Testing | Lighthouse CI | 0.15.x |
| Linting | ESLint 10 flat config (`eslint.config.ts`) | `@bfra.me/eslint-config` ^0.51.0 |
| Formatting | Prettier | `@bfra.me/prettier-config/120-proof` |
| Type Config | TypeScript | `@bfra.me/tsconfig` ^0.13.0 |
| Package Manager | pnpm | 10.33.4 (enforced via `packageManager` field; `engines.pnpm ^10.28.2`) |
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

**Cross-repo update (2026-07-06):** this `pnpm-workspace.yaml`-as-override-ledger pattern is no longer unique to this repo. [[marcusrbrown--marcusrbrown]] adopted the same structure in its 2026-07-06 survey — a fresh `pnpm-workspace.yaml` with `allowBuilds`/`onlyBuiltDependencies`, `shamefullyHoist: true`, and a GHSA-annotated override block (`vite 7.3.6`, `postcss`, `picomatch`, `fast-uri`, plus the relocated `jiti <2.8.0` pin). The profile repo does not (yet) carry the `pnpm audit` CI gate that drives this repo's list, but the ledger convention has now spread across the profile-repo cluster.

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
- **`mrbro-bot[bot]` opening Renovate pin PRs (2026-06-13):** the dependency-pin PRs (#180, #175, #172, #168) are authored by `app/mrbro-bot`, while the security-override PR (#178) is authored by `fro-bot`. This is the same `mrbro-bot[bot]` actor first noted on merges in [[marcusrbrown--ha-config]] — a distinct GitHub App from `fro-bot[bot]` now visibly driving Renovate-class automation in this repo. The two bots split labor here: `mrbro-bot` for routine version pins, `fro-bot` for security-advisory remediation. **Update (2026-06-23):** the split now extends to security-labeled dependency bumps — PR #181 (`vite` 7.3.2 → 7.3.5 `[SECURITY]`, `automerge`+`security` labels) is authored by `mrbro-bot`, while `fro-bot` still owns the bespoke pnpm-override remediation (#178 `tmp`). So `mrbro-bot` handles upstream-published security *upgrades* via Renovate, and `fro-bot` handles override *workarounds* for advisories without a clean upstream fix.

## Delta Log (2026-07-22, SHA `a5a6d8c` — surveyed via the `marcusrbrown.github.io` name binding)

**Provenance note:** this survey was dispatched against the *name* `marcusrbrown/marcusrbrown.github.io`, which — since the 2026-07-13 rename/collision documented on [[marcusrbrown--marcusrbrown-github-io]] — resolves to repo **id `1174807412`**, i.e. *this* repo (mrbro.dev). Identity re-confirmed: `package.json` `name: mrbro.dev`, homepage `https://mrbro.dev/`, description "My portfolio.", topics `blog/developer/github-pages/portfolio/react/typescript/vite`. So this delta lands on the mrbro.dev page (canonical), and the github-io page carries only a collision-confirm pointer. Read access was limited to directory listings, `package.json`, and workflow files (untrusted-input posture).

First substantive delta on this page since the `88f7a4a`/`7a49abc` window (2026-05-21 → 2026-06-23 were re-surveys of a frozen `main`). `main` HEAD has advanced to `a5a6d8c` (`feat(theme): add accessible preset picker (#209)`, 2026-07-20) with a large batch of feature work merged 2026-07-17 → 2026-07-20.

- **Fro Bot agent leapt v0.43.0 → v0.93.1** (`fro-bot/agent@a4976f45a51458c349eb232aa1795f6fa25d5500`). This page had recorded v0.43.0 across every prior survey; the pin is now far ahead, consistent with the aggressive release-tracking posture and matching the v0.93.1 snapshot observed from the github-io side on 2026-07-20.
- **First-party blog shipped (#188, #190):** build-time gist publishing replaces (or augments) the earlier GitHub-API-driven blog. `feed 6.0.0`, `shiki 4.3.1`, and the `unified 11.0.5`/remark/rehype chain are now direct deps; `blog-refresh` npm script and `blog-refresh.yaml` workflow present. A `docs(solutions)` commit (#190) records a "blog snapshot gist-API bug" — the gist-publishing path had a real defect worth remembering.
- **Self-hosted project preview images (#202, #204):** GitHub social-card previews are now self-hosted rather than hotlinked (`project-preview-refresh` npm script). Issue **#204** ("restore missing project preview image on homepage") is the open bug tracking a regression from this migration.
- **Theme system gained an accessible preset picker (#209)** and the portfolio feed is now curated by GitHub topic (#195) with hardened GitHub-feed reliability (validation, caching, independent error states — #187).
- **Landing page trimmed (#206):** six sections removed from the home page; hero CTA mobile-overflow fix (#198).
- **Fro Bot CI hardening:** `ci(fro-bot): forbid ce:* skills in PR reviews (#210)` — the review prompt now explicitly bars `ce:*` skills; fork detection for comment triggers corrected (#197); an inaccessible security-alert scan dropped from autoheal (#196). Build no longer ships source maps to production (#199).
- **Stack (current):** React `^19.0.0`, React Router `^7.15.0`, TypeScript **5.9.3** (still pre-v6), Vite **7.3.6**, Vitest **4.1.10**, Playwright **1.61.1**, `@vitejs/plugin-react-swc 4.3.1`, pnpm `10.33.4` (`engines.pnpm ^10.28.2`), Node `>=22.6.0`. License MIT (declared in `package.json`; API `license` null — no LICENSE file).
- **Workflows (8):** `blog-refresh.yaml`, `ci.yaml`, `copilot-setup-steps.yaml`, `deploy.yaml`, `e2e-tests.yaml`, `fro-bot.yaml`, `performance.yaml`, `renovate.yaml`. Crons unchanged (`30 3` autoheal / `30 15` maintenance UTC). Fro Bot workflow present and active — **no onboarding follow-up draft PR warranted.**
- **Split-brain override ledger persists:** `package.json` `pnpm.overrides` retains `js-yaml`/`qs`/`tmp`/`uuid`; the bulk GHSA-annotated block lives in `pnpm-workspace.yaml` (per the 2026-06-02 migration).
- **Open issues steady at 4:** #204 (missing preview-image bug), #162 (Daily Autohealing Report), #13 (Daily Maintenance Report), #1 (Dependency Dashboard). Stars 1. **No Probot `settings.yml`** and **no CodeQL/Scorecard** gaps still hold. No contradictions with prior ingests.

## Delta Log (2026-07-24, SHA `a5a6d8c` — frozen `main`, live autoheal motion in the issue/PR queue)

Re-surveyed via the `marcusrbrown.github.io` name binding (still resolves to id `1174807412`). `main` HEAD is unchanged from the 2026-07-22 survey (`a5a6d8c`, `feat(theme): add accessible preset picker (#209)`), but `pushed_at` advanced to 2026-07-24 and the issue/PR queue moved. Read access limited to public API listings and workflow files (untrusted-input posture; no `gh` auth available in this run, unauthenticated GitHub API used instead).

- **Fro Bot self-healing loop is visibly active and self-diagnosing.** Three new Fro-Bot-authored artifacts appeared since 2026-07-22:
  - **PR #211** (`test(opencode): stabilize timeout integration fixture`, open, opened 2026-07-23) — an autoheal PR stabilizing a SIGTERM timeout fixture and correcting the tracked visual-baseline count in AGENTS.md.
  - **Issue #212** (`fix(fro-bot): provide authenticated git push for mention runs`, open, 2026-07-24) — a concrete infrastructure bug the bot filed *against itself*: the mention-triggered run for PR #211 created commit `e40c726` but the **push failed because Git could not read credentials for `https://github.com`**. The workflow passes `secrets.FRO_BOT_*` but the mention path isn't wiring an authenticated remote. This is a durable failure mode worth remembering — mention-mode autoheal can author commits it cannot push. (Note the harness-level analog: this very survey run also had no usable `gh` credential.)
  - **Issue #213** (`Homepage missing footer landmark`, `bug` label, 2026-07-24) — autoheal's "Production Site Review" caught that the live homepage renders `nav` and `main` but no `footer` accessibility landmark, verified twice via a fresh browser session. Note the body cites `https://marcusrbrown.com` as the page URL even though this repo deploys to `mrbro.dev` — a stale-URL artifact in the autoheal prompt/site-review target, echoing the long-standing cross-repo doc-porting sloppiness.
- **Open issues 4 → 6** (API `open_issues_count` reads 7 = 6 issues + 1 PR): #213, #212, #204 (missing preview-image bug), #162 (Daily Autohealing Report), #13 (Daily Maintenance Report), #1 (Dependency Dashboard). Stars 1.
- **Everything structural holds:** agent pin `fro-bot/agent@a4976f45a51458c349eb232aa1795f6fa25d5500 # v0.93.1`; 8 workflows (`blog-refresh`, `ci`, `copilot-setup-steps`, `deploy`, `e2e-tests`, `fro-bot`, `performance`, `renovate`); homepage `https://mrbro.dev/`; topics `blog/developer/github-pages/portfolio/react/typescript/vite`; license API-null (MIT declared in `package.json`). Fro Bot active — **no onboarding follow-up draft PR warranted.** Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) still hold. No contradictions with prior ingests.

## Delta Log (2026-07-25, SHA `0b31ea7` — `main` moved; Impeccable design gate goes in-repo)

Re-surveyed via the `marcusrbrown.github.io` name binding (still resolves to id `1174807412` — collision holds). First tree-level motion on `main` since 2026-07-20: HEAD advanced `a5a6d8c` → **`0b31ea7`** (`fix(audit): invoke the discovery finalizer entrypoint (#221)`, committed 2026-07-24T21:26Z). This run had **no `gh` credential** available (same harness-level gap the repo's own issue #212 documents), so reads were limited to the untrusted-input surface via unauthenticated raw-file fetch + a shallow clone: root/`.github/workflows` directory listings, `README.md`, `package.json`, `renovate.json5`, `pnpm-workspace.yaml`. Issue/PR *counts* are not independently verifiable this cycle — carried forward from 2026-07-24 unless a tree fact contradicts them.

- **Impeccable design gate is now vendored in-repo as an OpenCode plugin.** New `opencode.json` at root registers `"plugin": ["./.opencode/impeccable/plugin.ts"]`, backed by a new `.opencode/impeccable/` tree: `plugin.ts`, `hook-bridge.ts`, `plugin.test.ts`, `hook-bridge.integration.test.ts`, and `.opencode/tsconfig.json`. The `check-types` script now type-checks the plugin explicitly (`tsc --noEmit && tsc --noEmit -p .opencode/tsconfig.json`), and `@opencode-ai/plugin@1.18.2` is a new devDep. This mirrors the exact in-repo-plugin move [[fro-bot--dashboard]] made (vendored `.agents/skills/impeccable/` + `.opencode/impeccable/` plugin) — the Impeccable gate is propagating from a pinned CI action into a repo-local plugin across the fleet.
- **New root scaffolding:** `.codex/hooks.json` (Codex agent hooks, alongside the existing `.agents/`/`.opencode`), `examples/` (`button-form-styles-example.tsx`, `use-theme-example.tsx`), and the `DESIGN.md`/`PRODUCT.md` design-gate docs (already present) now sit next to the plugin that enforces them.
- **`pnpm-workspace.yaml` override ledger is the current source of truth** (~18 GHSA-annotated entries: `@isaacs/brace-expansion`, `ajv`, `basic-ftp`, `brace-expansion ^5.0.6`, `fast-uri`, `flatted`, `ip-address`, `js-yaml`, `lodash`/`lodash-es`, `mdast-util-to-hast`, `minimatch`, `path-to-regexp`, `picomatch`, `qs ^6.15.2`, `rollup`, `tmp`, `uuid >=14.0.0`, `ws ^8.20.1`, `yauzl`) plus `onlyBuiltDependencies` (`@swc/core`, `esbuild`, `simple-git-hooks`, `unrs-resolver`), a new `auditConfig.ignoreGhsas` block (`GHSA-qwww-vcr4-c8h2`, `GHSA-mh99-v99m-4gvg`), and `shamefullyHoist: true`. `package.json` `pnpm.overrides` still carries the split-brain remnant `js-yaml`/`qs`/`tmp`/`uuid` — the two-location pattern persists.
- **New security tooling surfaced in scripts:** `security:react-router-rsc` (`scripts/check-react-router-rsc-boundary.ts`) — a React Router RSC boundary check, consistent with the `react-router-dom ^7.15.0` dependency. Also new visible npm scripts: `project-preview-refresh`, `configure:branch-protection`/`configure:repo-settings` (`scripts/*`), and a `pre-push` git hook (`node .github/git-hooks/pre-push.ts`) added alongside the existing `pre-commit` lint-staged hook.
- **Stack (re-confirmed at `0b31ea7`):** React `^19.0.0`, React Router `^7.15.0`, TypeScript **5.9.3** (still pre-v6), Vite **7.3.6**, Vitest **4.1.10**, Playwright **1.61.1**, `@vitejs/plugin-react-swc 4.3.1`, ESLint 10.7.0, Prettier 3.9.5, `@opencode-ai/plugin 1.18.2`, pnpm `10.33.4` (`engines.pnpm ^10.28.2`), Node `>=22.6.0`. License MIT (`package.json`). `feed 6.0.0` / `shiki 4.3.1` / `unified 11.0.5` blog chain intact.
- **Renovate:** `github>marcusrbrown/renovate-config#5.2.7` + `group:allNonMajor`; post-upgrade `pnpm install` → `build` → `fix` ×2 (unchanged).
- **8 workflows, agent pin steady:** `blog-refresh`, `ci`, `copilot-setup-steps`, `deploy`, `e2e-tests`, `fro-bot`, `performance`, `renovate`; `fro-bot/agent@a4976f45a51458c349eb232aa1795f6fa25d5500 # v0.93.1`, single-file three-mode with `discussion_comment` trigger and crons `30 3` autoheal / `30 15` maintenance UTC. Fro Bot workflow present and active — **no onboarding follow-up draft PR warranted.** Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) still hold. No contradictions with prior ingests.

## Delta Log (2026-07-26, SHA `2643703` — pnpm 10 → 11 major crossing; GitHub Pages LFS-blob fix)

Re-surveyed via the `marcusrbrown.github.io` name binding (still resolves to id `1174807412` — collision holds). `main` advanced `0b31ea7` → **`2643703`** (`fix(projects): store preview images as real blobs, not LFS pointers (#228)`, committed 2026-07-26T05:31Z). This run had **no `gh` credential** (the same harness-level gap the repo's own issue #212 documents), so reads were limited to the untrusted-input surface via unauthenticated GitHub API + raw-file fetch: root/`.github/workflows` directory listings, `README.md`, `package.json`, `renovate.json5`, `pnpm-workspace.yaml`, `.gitattributes`. Issue/PR *counts* are not independently verifiable this cycle — carried forward from 2026-07-24 unless a tree fact contradicts them.

- **pnpm major boundary crossed 10.33.4 → 11.1.3.** `packageManager: pnpm@11.1.3`, `engines.pnpm >=11.1.3`, and **`engines.node` bumped `>=22.6.0` → `>=24.0.0`**. This is the same pnpm 10 → 11 crossing the rest of the fleet ([[marcusrbrown--gpt]], [[marcusrbrown--marcusrbrown]], [[marcusrbrown--sparkle]], [[marcusrbrown--containers]], [[bfra-me--works]]) crossed weeks earlier — mrbro.dev was a laggard here and has now caught up.
- **Split-brain override ledger resolved.** The `package.json` `pnpm.overrides` remnant (`js-yaml`/`qs`/`tmp`/`uuid`) tracked since 2026-06-02 is now **empty** — the entire override ledger is consolidated into `pnpm-workspace.yaml` (~24 GHSA-annotated entries: `@isaacs/brace-expansion`, `ajv`, `basic-ftp`, `brace-expansion ^5.0.6`, `fast-uri`, `flatted`, `ip-address`, `js-yaml`, `lodash`/`lodash-es`, `mdast-util-to-hast`, `minimatch`, `path-to-regexp`, `picomatch`, `qs ^6.15.2`, `rollup`, `tmp`, `uuid >=14.0.0`, `ws`, `yauzl`, etc.) plus `auditConfig.ignoreGhsas` (`GHSA-qwww-vcr4-c8h2`, `GHSA-mh99-v99m-4gvg`), `onlyBuiltDependencies`, and `shamefullyHoist: true`. The two-location pattern this page has flagged for ~8 weeks is finally single-source.
- **GitHub Pages / Git LFS interaction fixed (#228).** `.gitattributes` keeps the repo-wide `*.png filter=lfs diff=lfs merge=lfs -text` rule but adds an explicit **exemption** — `public/project-previews/*.png filter= diff= merge= -text` — with the inline rationale "Web-served preview images must be real blobs — GitHub Pages does not resolve LFS pointers." Two preview PNGs (`1297795539.png` ~105 KB, `313368595.png` ~96 KB) are now committed as real blobs under `public/project-previews/`, and a `project-preview-refresh` npm script manages them. This is the remediation of the self-hosted-preview-image feature (#202, bug #204) first noted at 2026-07-22: the images had been stored as LFS *pointers*, which Pages serves verbatim, so they rendered broken in production. A durable footgun worth remembering — LFS and GitHub Pages don't mix for web-served assets.
- **Vendored agent skills at root.** New `.agents/skills/` carries `agent-browser`, `impeccable`, and `playwright-mcp` skill dirs, sitting alongside the already-in-repo `.opencode/impeccable/` plugin (added 2026-07-25). `.impeccable/` now also carries `design.json` and a `live/` capture dir. The Impeccable design gate footprint continues to thicken — pinned CI action → repo-local OpenCode plugin → vendored skill tree, the same convergence [[fro-bot--dashboard]] reached.
- **Stack otherwise steady at `2643703`:** React `^19.0.0`, React Router `^7.15.0`, TypeScript **5.9.3** (still pre-v6), Vite **7.3.6**, Vitest **4.1.10**, Playwright **1.61.1**, `@vitejs/plugin-react-swc 4.3.1`, ESLint 10.7.0, Prettier 3.9.5, `@opencode-ai/plugin 1.18.2`, `feed 6.0.0` / `shiki 4.3.1` blog chain intact. License MIT (`package.json`; API `license` reads null).
- **Renovate:** `github>marcusrbrown/renovate-config#5.2.7` + `group:allNonMajor` (unchanged).
- **8 workflows, agent pin steady:** `blog-refresh`, `ci`, `copilot-setup-steps`, `deploy`, `e2e-tests`, `fro-bot`, `performance`, `renovate`; `fro-bot/agent@a4976f45a51458c349eb232aa1795f6fa25d5500 # v0.93.1`, single-file three-mode with `discussion_comment` trigger and crons `30 3` autoheal / `30 15` maintenance UTC. Fro Bot workflow present and active — **no onboarding follow-up draft PR warranted.** Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) still hold. No contradictions with prior ingests.

## Delta Log (2026-07-28, SHA `345bc21` — Fro Bot collapses to a single daily oversight+autoheal pass; live-audit hardening)

Re-surveyed via the `marcusrbrown.github.io` name binding (still resolves to id `1174807412` — collision holds; `package.json` `name: mrbro.dev`, homepage `https://mrbro.dev/`, description "My portfolio."). `main` advanced `2643703` → **`345bc21`** (`fix(blog): authenticate gist reads with a dedicated PAT (#238)`, committed 2026-07-28T07:08Z) across a five-commit burst (#234, #236, #237, #238 plus #233 Impeccable skill bump). This run had **no `gh` credential** — the same harness-level gap the repo's own issue #212 tracks — so reads were the untrusted-input surface via unauthenticated GitHub API + raw fetch: directory listings, `README.md`, `package.json`, `renovate.json5`, workflow files, plus the public issues/PR listing (which *is* readable unauthenticated).

The material delta is the **Fro Bot workflow architecture**, not the app tree:

- **Fro Bot consolidated into one daily oversight + autoheal pass (#234).** The long-standing two-cron model (`30 3` autoheal / `30 15` maintenance UTC, present since the 2026-05 single-file three-mode redesign) is gone. `fro-bot.yaml` now runs a **single `30 3 * * *` cron** described in-file as a "Daily oversight + autohealing pass … staggered off the other repos in the portfolio (space-bus 00:00, mothership 06:15)." The `workflow_dispatch` `mode` choices are now **`review` / `autoheal` / `live-audit`** — the `maintenance` mode is dropped and a new **`live-audit`** mode added, backed by dedicated `live-audit-preflight`, `live-audit-discovery`, and `live-audit-reporter` jobs plus a `live-audit-slot` dispatch input (approved replay slot `30 3 * * *`). Repository oversight is now report-only category 6 inside the single autoheal pass rather than a separate maintenance-cron issue. This is a genuine architectural simplification: one scheduled entrypoint, review/autoheal/live-audit selectable by dispatch. It aligns with the consolidated **single "Daily Fro Bot Report — 2026-07-28 (UTC)"** issue (#235) now open in place of the old split Autohealing/Maintenance report pair.
- **Scheduled-autoheal git push finally authenticated (#236).** `feat(ci): consolidate Fro Bot into one daily oversight + autoheal pass (#234)` and `fix(ci): enable authenticated git push for scheduled autoheal (#236)` add an "Enable authenticated git push for autoheal fixes" step wiring an authenticated remote for schedule/dispatch autoheal runs. This directly targets the failure mode issue **#212** documented (autoheal authors commits it cannot push) — though #212 itself is still open, scoped to the *mention*-run path.
- **Live-audit delivery tolerance (#237).** `fix(live-audit): tolerate delayed scheduled delivery (#237)` hardens the live-audit pipeline against late scheduled dispatch — continuation of the live-audit evidence work (#221/#222/#225/#226/#227) that landed across 2026-07-24 → 2026-07-26.
- **Blog gist reads use a dedicated PAT (#238, HEAD).** `blog-refresh.yaml` + `scripts/blog-refresh.ts` now authenticate gist reads with a dedicated PAT rather than the default token; `.github/ACTIONS.md` documents the new secret. Related open PR **#239** (`fix(blog): skip local git hooks on the blog-refresh automation push`) is the follow-on making the automation push bypass `pre-commit`/`pre-push` hooks.
- **Impeccable design skill bumped to v4.0.2 (#233)** and a hero-CTA WCAG-contrast a11y fix landed (#231, pin hero CTA background to AA-passing blue) with a `docs(solutions)` learning capture (#232) — the `.impeccable/`/`.opencode/impeccable/` design gate is actively catching and remediating contrast regressions.
- **Stack steady at `345bc21`:** React `^19.0.0`, React Router `^7.15.0`, TypeScript **5.9.3** (still pre-v6), Vite **7.3.6**, Vitest **4.1.10**, Playwright **1.61.1**, `@opencode-ai/plugin 1.18.2`, `feed 6.0.0`, pnpm **11.1.3** (`engines.pnpm >=11.1.3`, `engines.node >=24.0.0`), `pnpm.overrides` still **empty** (ledger consolidated in `pnpm-workspace.yaml`). License MIT (`package.json`; API `license` null).
- **Renovate:** `github>marcusrbrown/renovate-config#5.2.7` + `group:allNonMajor` (unchanged).
- **8 workflows, agent pin steady:** `blog-refresh`, `ci`, `copilot-setup-steps`, `deploy`, `e2e-tests`, `fro-bot`, `performance`, `renovate`; `fro-bot/agent@a4976f45a51458c349eb232aa1795f6fa25d5500 # v0.93.1`. Fro Bot workflow present and active — **no onboarding follow-up draft PR warranted.**
- **Open issues (readable this run):** #235 (Daily Fro Bot Report — 2026-07-28, the new *consolidated* report replacing the old split #162 autoheal / #13 maintenance pair), #213 (Homepage missing footer landmark — still open), #212 (authenticated git push for mention runs — still open, distinct from the scheduled-run #236 fix), #1 (Dependency Dashboard); plus open PR #239. The rolling report-issue set has visibly collapsed from a pair to a single daily report, mirroring the #234 workflow consolidation. Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) still hold. No contradictions with prior ingests.

## Delta Log (2026-07-29, SHA `1b6f5eb` — blog delivery moves to PR-not-push; footer redesign; projects served from snapshot)

Re-surveyed via the `marcusrbrown.github.io` name binding (still resolves to id `1174807412` — collision holds; `package.json` `name: mrbro.dev`, homepage `https://mrbro.dev/`, description "My portfolio."). `main` advanced `345bc21` → **`1b6f5eb`** (`chore(blog): refresh snapshot and preview images (#246)`, committed 2026-07-29T04:06Z) across a ~six-commit day. This run again had **no `gh` credential** (the harness-level gap issue #212 tracks for the *mention* path) — reads were the untrusted-input surface via unauthenticated GitHub API + raw fetch: directory listings, `README.md`, `package.json`, `renovate.json5`, workflow files, plus the public issues listing.

The material delta is in the blog/projects content-delivery plumbing and the footer, not the stack:

- **Blog refresh now delivers via PR, not direct push to `main` (#240).** The `blog-refresh.yaml` automation that had been pushing refreshed snapshots straight to trunk (with a hook-skip workaround, #239) now opens a PR instead. This is the safer resolution of the same automation-push friction the #238/#239 PAT-and-hook work was patching — the automation stops writing to `main` directly. The two `chore(blog): refresh snapshot and preview images` commits (#245, #246) landing back-to-back on `main` are the merged output of that PR flow.
- **Projects served from a build-time snapshot (#243).** `/projects` no longer resolves live at request time; a build-time snapshot backs the route — the same prerender-at-build posture already used for the blog, now extended to the projects surface. Reduces runtime GitHub-API dependence for the projects list.
- **Custom social-preview images honored (#242).** Preview generation now uses each repo's own custom social-preview image when one is set, rather than always synthesizing one — continuation of the self-hosted-preview-image line (#202 → #228 LFS-blob fix → #242).
- **Footer redesigned as a structured site-close (#244).** `src/components/Footer.tsx`, `src/App.tsx`, and `src/styles/globals.css` reworked into a structured footer. Plausibly the remediation of the long-open **issue #213** (Homepage missing footer landmark) flagged by autoheal's Production Site Review — a real `footer` landmark would close that a11y gap. #213 is no longer in the open-issue listing this run (see below), consistent with a fix landing.
- **Live-audit tolerates delayed scheduled delivery (#237)** was already recorded at 2026-07-28; the burst here is downstream content/UX work, not further Fro Bot architecture churn.
- **Stack steady at `1b6f5eb`:** `package.json` `name: mrbro.dev`, `packageManager: pnpm@11.1.3`, `engines.node >=24.0.0`, `engines.pnpm >=11.1.3`, `pnpm.overrides` still **empty** (ledger consolidated in `pnpm-workspace.yaml`). Renovate `github>marcusrbrown/renovate-config#5.2.7` + `group:allNonMajor`. License MIT (`package.json`; API `license` null).
- **8 workflows, agent pin steady:** `blog-refresh`, `ci`, `copilot-setup-steps`, `deploy`, `e2e-tests`, `fro-bot`, `performance`, `renovate`; `fro-bot/agent@a4976f45a51458c349eb232aa1795f6fa25d5500 # v0.93.1`. Fro Bot workflow present and active — **no onboarding follow-up draft PR warranted.**
- **Open issues (3, readable this run):** **#247** (`Daily Fro Bot Report — 2026-07-29 (UTC)` — the perpetual consolidated report, re-dated from #235's 2026-07-28), **#212** (authenticated git push for mention runs — still open), **#1** (Dependency Dashboard). `open_issues_count` reads 3. Notable disappearances vs. 2026-07-28: **#213 (missing footer landmark) and #204 (project preview image) are no longer listed** — consistent with the #244 footer redesign and the #242/#243 preview/projects work closing them. Stars 1. Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) still hold. No contradictions with prior ingests.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `51f5cab` | Initial survey |
| 2026-04-26 | `d8c0e43` | Agent v0.38.0→v0.41.3, Renovate #4.5.7→#4.5.8, opencode-config added, security overrides, no settings.yml noted, 39 open issues |
| 2026-05-21 | `88f7a4a` | Workflows consolidated: `fro-bot-autoheal.yaml` removed, single `fro-bot.yaml` with three modes (review/maintenance/autoheal). Agent v0.41.3 → v0.43.0. Renovate preset #4.5.8 → #5.2.0. Open issues 39 → 8 (autoheal backlog drained). Open PRs 4 (all pin-version Renovate). New pnpm overrides: `fast-uri ≥3.1.2`, `ip-address ≥10.1.1`, `uuid ≥14.0.0`. TypeScript bumped 5.6.x → 5.9.3 (still pre-v6). Vitest 4.1.4, pnpm 10.33.4. |
| 2026-06-02 | `7a49abc` | **pnpm `overrides` migrated `package.json` → `pnpm-workspace.yaml`** and expanded to ~20 entries with inline GHSA annotations, driven by a new `pnpm audit` CI gate (#177). New advisories pinned: `qs`, `ws`, `tmp`, `rollup`, `js-yaml`, `flatted`, `ajv`, `mdast-util-to-hast`, `minimatch`, `yauzl` — mostly transitive via `@lhci/cli`. **Fro Bot prompt hardening (#176):** ported 5 inserts from [[marcusrbrown--marcusrbrown]] (skipped-needs trap, `continue-on-error` red-flag, 7-day workflow-health monitor). Agent unchanged at v0.43.0. Open issues 8 → 4 (pin PRs merged). Open PRs 5 (Renovate). TypeScript still 5.9.3, pnpm 10.33.4, Vitest 4.1.4. No structural code/layout change. |
| 2026-06-13 | `7a49abc` | **No-delta re-survey — HEAD unchanged since 2026-06-02 (`pushed_at` 2026-05-28T02:28Z).** Every tracked fact re-verified against the same tree: agent v0.43.0, TypeScript 5.9.3, Vite 7.3.2, Vitest 4.1.4, pnpm 10.33.4 (`engines.pnpm ^10.28.2`), Node >=22.6.0, React Router 7.7.1, 7 workflows, no `settings.yml`. Open issues 4 (#162 autoheal, #13 maintenance, #1 Dependency Dashboard, #48 triage), open PRs 5 (unchanged set: #180/#178/#175/#172/#168). **Corrections against same SHA:** Playwright recorded as 1.54.x is actually 1.59.1; pnpm table said 10.33.0, true value 10.33.4. **New observable:** Renovate pin PRs (#180/#175/#172/#168) authored by `app/mrbro-bot`, security-override PR (#178) by `fro-bot` — the `mrbro-bot[bot]` actor (cf. [[marcusrbrown--ha-config]]) is now visibly active here, splitting automation labor with `fro-bot`. |
| 2026-06-23 | `7a49abc` | **No-delta re-survey — `main` HEAD still `7a49abc` (last main commit 2026-05-28T02:19Z).** `pushed_at` advanced to 2026-06-19 but that reflects PR-branch activity (renovate/*, fix/security-*, copilot/*), not the default branch. 7 workflows confirmed present including `fro-bot.yaml`. Open issues unchanged at 4. **Only delta is PR-queue movement:** open PRs 5 → 6 with new #181 `vite` 7.3.2 → 7.3.5 `[SECURITY]` (authored by `app/mrbro-bot`, labels `automerge`+`security`, opened 2026-06-15) — supersedes the standing 7.3.2 pin and continues the `mrbro-bot`-drives-version-bumps / `fro-bot`-drives-override-remediation split. No tree-level config, dependency, or workflow changes. |
| 2026-07-22 | `a5a6d8c` | **Substantive delta (surveyed via the `marcusrbrown.github.io` name binding → id `1174807412`).** First real motion on `main` since 2026-05-28. Agent v0.43.0 → **v0.93.1** (`a4976f4`). First-party blog with build-time gist publishing (#188/#190, `feed`/`shiki`/`unified` now direct deps, `blog-refresh.yaml`); self-hosted project preview images (#202, bug #204 open); accessible theme preset picker (#209); topic-curated portfolio feed (#195) with hardened GitHub-feed reliability (#187); landing page trimmed 6 sections (#206). Fro Bot CI: forbid `ce:*` skills in reviews (#210), fork-detection fix (#197), source maps dropped from prod build (#199). Stack: React 19 / TS 5.9.3 / Vite 7.3.6 / Vitest 4.1.10 / Playwright 1.61.1, pnpm 10.33.4, Node >=22.6.0. 8 workflows. Open issues 4 (#204/#162/#13/#1), stars 1. Split-brain override ledger persists. Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) hold. Fro Bot active — no onboarding PR needed. |
| 2026-07-26 | `2643703` | **pnpm 10 → 11 major crossing + GitHub Pages LFS-blob fix.** `main` advanced `0b31ea7` → `2643703` (`fix(projects): store preview images as real blobs, not LFS pointers (#228)`). **pnpm 10.33.4 → 11.1.3** (`engines.pnpm >=11.1.3`), **Node engine `>=22.6.0` → `>=24.0.0`**; `package.json` `pnpm.overrides` split-brain remnant now **empty** — ledger fully consolidated in `pnpm-workspace.yaml` (~24 GHSA entries + `auditConfig.ignoreGhsas`). `.gitattributes` LFS **exemption** for `public/project-previews/*.png` (Pages can't resolve LFS pointers) + 2 committed real-blob PNGs + `project-preview-refresh` script. Root `.agents/skills/` (agent-browser/impeccable/playwright-mcp) vendored; `.impeccable/design.json` + `live/`. Stack re-confirmed (React 19 / RR7.15 / TS 5.9.3 / Vite 7.3.6 / Vitest 4.1.10 / Playwright 1.61.1). Agent v0.93.1 (`a4976f4`), 8 workflows, Renovate #5.2.7 — unchanged. No `gh` auth (unauthenticated API + raw fetch); issue/PR counts carried forward. Gaps hold. Fro Bot active — no onboarding PR. |
| 2026-07-24 | `a5a6d8c` | **No structural delta — `main` frozen since 2026-07-20; motion is in the autoheal queue.** `pushed_at` 2026-07-24. Three new Fro-Bot-authored artifacts: PR #211 (stabilize SIGTERM timeout fixture), issue #212 (`fix(fro-bot): provide authenticated git push for mention runs` — mention-run created commit `e40c726` but push failed on missing `https://github.com` credentials; a self-filed infra bug), issue #213 (`Homepage missing footer landmark`, `bug` — autoheal Production Site Review found no `footer` a11y landmark; body cites stale `marcusrbrown.com` URL). Open issues 4 → 6 (#213/#212/#204/#162/#13/#1); API count 7 folds in PR #211. Agent v0.93.1 (`a4976f4`), 8 workflows, homepage `mrbro.dev`, stars 1 — all unchanged. Gaps hold. Fro Bot active — no onboarding PR. |
| 2026-07-25 | `0b31ea7` | **Tree-level delta — `main` advanced `a5a6d8c` → `0b31ea7` (`fix(audit): invoke the discovery finalizer entrypoint (#221)`).** Impeccable design gate vendored in-repo as an OpenCode plugin: new `opencode.json` registering `./.opencode/impeccable/plugin.ts`, new `.opencode/impeccable/` (`plugin.ts`, `hook-bridge.ts` + tests, `.opencode/tsconfig.json`), `@opencode-ai/plugin@1.18.2` devDep, `check-types` now type-checks the plugin — mirrors [[fro-bot--dashboard]]'s in-repo Impeccable move. New root `.codex/hooks.json` + `examples/`; new `security:react-router-rsc` boundary-check script and `pre-push` git hook. `pnpm-workspace.yaml` ledger ~18 GHSA overrides + new `auditConfig.ignoreGhsas`; `package.json` split-brain remnant persists. Stack re-confirmed (React 19 / RR7.15 / TS 5.9.3 / Vite 7.3.6 / Vitest 4.1.10 / Playwright 1.61.1 / ESLint 10.7.0 / Prettier 3.9.5 / pnpm 10.33.4 / Node >=22.6.0). Agent v0.93.1 (`a4976f4`), 8 workflows, Renovate #5.2.7 — unchanged. **No `gh` auth this run** (reads limited to raw fetch + shallow clone); issue/PR counts carried forward, not re-verified. Gaps hold. Fro Bot active — no onboarding PR. |
| 2026-07-28 | `345bc21` | **Fro Bot workflow architecture delta — two crons collapse to one daily oversight+autoheal pass (#234).** `main` advanced `2643703` → `345bc21` (`fix(blog): authenticate gist reads with a dedicated PAT (#238)`). `fro-bot.yaml` drops the `30 15` maintenance cron and the `maintenance` dispatch mode; **single `30 3 * * *` cron** now, dispatch modes `review`/`autoheal`/`live-audit`, with dedicated `live-audit-preflight`/`discovery`/`reporter` jobs and a `live-audit-slot` input. Scheduled autoheal now wires an authenticated git remote (#236, targets the #212 push-auth failure mode for the *scheduled* path; #212 still open for *mention* runs). Live-audit tolerates delayed scheduled delivery (#237); blog gist reads use a dedicated PAT (#238) with hook-skip follow-on PR #239. Impeccable design skill → v4.0.2 (#233); hero-CTA WCAG AA contrast fix (#231/#232). Report-issue set collapsed from the split #162/#13 pair to a single **#235 "Daily Fro Bot Report — 2026-07-28 (UTC)"**, mirroring the workflow consolidation. Stack steady (React 19 / RR7.15 / TS 5.9.3 / Vite 7.3.6 / Vitest 4.1.10 / Playwright 1.61.1 / pnpm 11.1.3 / Node >=24). Agent v0.93.1 (`a4976f4`), 8 workflows, Renovate #5.2.7, `pnpm.overrides` empty — unchanged. No `gh` auth (unauthenticated API + raw fetch). Gaps hold. Fro Bot active — no onboarding PR. |
| 2026-07-29 | `1b6f5eb` | **Content-delivery + footer delta.** `main` advanced `345bc21` → `1b6f5eb` (`chore(blog): refresh snapshot and preview images (#246)`). **Blog refresh now delivers via PR, not direct push to `main` (#240)** — the safer resolution of the #238/#239 automation-push friction; #245/#246 are the merged snapshot output. **`/projects` served from a build-time snapshot (#243)** (prerender posture extended from blog to projects). **Custom social-preview images honored when set (#242)** (continues #202→#228→#242). **Footer redesigned as a structured site-close (#244)** — `Footer.tsx`/`App.tsx`/`globals.css`; plausibly closes the long-open a11y issue **#213 (missing footer landmark)**. Open issues down to **3** (#247 perpetual Daily Fro Bot Report re-dated from #235, #212 mention-run push-auth still open, #1 Dependency Dashboard); **#213 and #204 no longer listed** — consistent with footer/preview work closing them. Stack steady (React 19 / RR7.15 / TS 5.9.3 / Vite 7.3.6 / pnpm 11.1.3 / Node >=24, `pnpm.overrides` empty). Agent v0.93.1 (`a4976f4`), 8 workflows, Renovate #5.2.7 — unchanged. No `gh` auth (unauthenticated API + raw fetch). Gaps hold. Fro Bot active — no onboarding PR. |
