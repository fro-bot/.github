---
type: repo
title: "marcusrbrown/mrbro.dev"
created: 2026-04-18
updated: 2026-07-07
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
  - url: https://github.com/marcusrbrown/mrbro.dev
    sha: c6f106bb57be6deac97fd9600448ef404d9cec4b
    accessed: 2026-07-07
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
- **Last push:** 2026-07-06 (default-branch HEAD `c6f106b` landed 2026-07-04)
- **Homepage:** https://mrbro.dev
- **Topics:** `blog`, `developer`, `github-pages`, `portfolio`, `react`, `typescript`, `vite`
- **License:** MIT (badge present, no LICENSE file detected via API)
- **Open issues:** 4 as of 2026-07-07 (unchanged since 2026-06-02) — the canonical rolling pair holds: "Daily Autohealing Report" #162 and "Daily Maintenance Report" #13, plus #1 Dependency Dashboard and #48 triage. (Was 8 on 2026-05-21; the four pin-version PRs that were inflating the count have mostly merged.)
- **Open PRs:** 5 as of 2026-07-07 — down one from 2026-06-23. #181 `vite` 7.3.2 → 7.3.5 `[SECURITY]` merged (Vite is now `7.3.5` on `main`). Remaining unchanged Renovate-class set: #180 `prettier` 3.8.3, #178 pnpm override for `tmp` path-traversal advisory (`fro-bot`), #175 `eslint-plugin-react-refresh` 0.5.2, #172 `@bfra.me/prettier-config` 0.16.8, #168 `@bfra.me/eslint-config` v0.51.0.

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
| UI Framework | React | 19.x |
| Language | TypeScript | 5.6+ (strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`) |
| Bundler | Vite | 7.3.5 (SWC via `@vitejs/plugin-react-swc` 4.3.0; bumped 7.3.2 → 7.3.5 via merged security PR #181, 2026-07) |
| Routing | React Router | v7 (`react-router-dom` ^7.15.0; was ^7.7.1 through 2026-06-23) |
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

#### Dispatch-prompt precedence fix (#182, 2026-07-04)

The `PROMPT` selection expression in `fro-bot.yaml` was reordered so a non-empty `workflow_dispatch.inputs.prompt` wins first for **any** dispatch, regardless of `mode`. Previously the custom prompt was only consumed when `mode == 'review'`; since `mode` defaults to `autoheal`, a dispatch that supplied only a prompt (no mode) silently fell through to the autoheal prompt and the custom text was discarded. The new head of the chain is `(github.event_name == 'workflow_dispatch' && inputs.prompt) || …`, with the mode-based maintenance/autoheal fallbacks preserved for prompt-less dispatches. This is the same fixed-a-silent-drop class of bug the ported review heuristics already guard against — here the discard was in the workflow's own prompt-routing logic.

#### Autoheal prompt expanded 5 → 8 categories (SHA `c6f106b`, observed 2026-07-07)

The consolidated `AUTOHEAL_PROMPT` has grown well past the five-category sweep recorded through 2026-05-21. As of `c6f106b` it runs eight categories with explicit execution-model, dedup, scope-cap, dependency-ownership, and trusted-authors preambles:

1. Errored PRs (trusted-author-gated branch repair; skips workflow/prompt/lockfile-touching branches)
2. Security (advisory remediation; no bulk unrelated bumps)
3. Code Quality & Repo Hygiene (bundle budgets, coverage thresholds, stale TODO scan, convention drift, AGENTS.md accuracy)
4. Developer Experience (lint/type/format fixes via PR, never direct-to-main)
5. Production Site Review (`npx agent-browser` over `/`, `/about`, `/projects`, `/blog` with retry-once-before-filing)
6. **Quality Gates Verification** (new) — `pnpm lint`, `tsc --noEmit`, `pnpm test`, `pnpm build`, `analyze-build` on the default branch
7. **Cross-Project Intelligence (inbound only)** (new) — surveys `tokentoilet`, `vbs`, `yield-farmer`, `renovate-config`, `.github`, and `fro-bot/agent` for patterns worth adopting *into* mrbro.dev; observation-only, never modifies other repos
8. **Upstream Modernization Watch (Sundays UTC only)** (new) — gated on a new `IS_SUNDAY_UTC` preflight step (`date -u +%u == 7`); reviews release notes for `fro-bot/agent`, `actions/checkout`, React, Vite, React Router. Documents findings in the perpetual issue; must not bump versions.

The report template correspondingly gained Quality Gates, Cross-Project Intelligence, and a Sunday-only Upstream Modernization Watch table. Agent pin unchanged at `fro-bot/agent@v0.43.0` (`1563f298`).

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

Vite upgraded to v7.3.2 for security fix (#121), then to **v7.3.5** via merged security PR #181 (2026-07). The migration to a CI dependency-audit gate (`pnpm audit`, #177) is now the forcing function that keeps this list current — overrides are added in response to a failing audit rather than ad-hoc.

**Contradiction noted (2026-07-07, SHA `c6f106b`):** the earlier claim that overrides migrated *out of* `package.json` entirely is now only partially true. `pnpm-workspace.yaml` remains the primary GHSA-annotated ledger (unchanged), but a **second, smaller `pnpm.overrides` block has reappeared in `package.json`** carrying four entries — `js-yaml: ^4.2.0`, `qs: ^6.15.2`, `tmp: ^0.2.7`, `uuid: ^11.1.1`. These overlap the workspace ledger by name but diverge in value: `package.json` pins `uuid ^11.1.1` while `pnpm-workspace.yaml` pins `uuid >=14.0.0`, and `package.json` pins `tmp ^0.2.7` vs the workspace's best-effort `tmp@<=0.2.3: >=0.2.6`. pnpm merges both surfaces, and the more specific `package.json` root override typically wins — so the effective `uuid`/`tmp` floors are the `package.json` values, not the workspace ones. This is a drift footgun: two override surfaces for the same advisories mean a fix applied to one can be silently masked by the other. Worth consolidating back to a single ledger.

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
- **`mrbro-bot[bot]` opening Renovate pin PRs (2026-06-13):** the dependency-pin PRs (#180, #175, #172, #168) are authored by `app/mrbro-bot`, while the security-override PR (#178) is authored by `fro-bot`. This is the same `mrbro-bot[bot]` actor first noted on merges in [[marcusrbrown--ha-config]] — a distinct GitHub App from `fro-bot[bot]` now visibly driving Renovate-class automation in this repo. The two bots split labor here: `mrbro-bot` for routine version pins, `fro-bot` for security-advisory remediation. **Update (2026-06-23):** the split now extends to security-labeled dependency bumps — PR #181 (`vite` 7.3.2 → 7.3.5 `[SECURITY]`, `automerge`+`security` labels) is authored by `mrbro-bot`, while `fro-bot` still owns the bespoke pnpm-override remediation (#178 `tmp`). So `mrbro-bot` handles upstream-published security *upgrades* via Renovate, and `fro-bot` handles override *workarounds* for advisories without a clean upstream fix. **Update (2026-07-07):** PR #181 merged — Vite is now `7.3.5` on `main`, confirming the `mrbro-bot`-drives-upstream-security-upgrades half of the split lands cleanly. `fro-bot`'s override PR #178 (`tmp`) remains open, consistent with the workaround-half being slower to resolve.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `51f5cab` | Initial survey |
| 2026-04-26 | `d8c0e43` | Agent v0.38.0→v0.41.3, Renovate #4.5.7→#4.5.8, opencode-config added, security overrides, no settings.yml noted, 39 open issues |
| 2026-05-21 | `88f7a4a` | Workflows consolidated: `fro-bot-autoheal.yaml` removed, single `fro-bot.yaml` with three modes (review/maintenance/autoheal). Agent v0.41.3 → v0.43.0. Renovate preset #4.5.8 → #5.2.0. Open issues 39 → 8 (autoheal backlog drained). Open PRs 4 (all pin-version Renovate). New pnpm overrides: `fast-uri ≥3.1.2`, `ip-address ≥10.1.1`, `uuid ≥14.0.0`. TypeScript bumped 5.6.x → 5.9.3 (still pre-v6). Vitest 4.1.4, pnpm 10.33.4. |
| 2026-06-02 | `7a49abc` | **pnpm `overrides` migrated `package.json` → `pnpm-workspace.yaml`** and expanded to ~20 entries with inline GHSA annotations, driven by a new `pnpm audit` CI gate (#177). New advisories pinned: `qs`, `ws`, `tmp`, `rollup`, `js-yaml`, `flatted`, `ajv`, `mdast-util-to-hast`, `minimatch`, `yauzl` — mostly transitive via `@lhci/cli`. **Fro Bot prompt hardening (#176):** ported 5 inserts from [[marcusrbrown--marcusrbrown]] (skipped-needs trap, `continue-on-error` red-flag, 7-day workflow-health monitor). Agent unchanged at v0.43.0. Open issues 8 → 4 (pin PRs merged). Open PRs 5 (Renovate). TypeScript still 5.9.3, pnpm 10.33.4, Vitest 4.1.4. No structural code/layout change. |
| 2026-06-13 | `7a49abc` | **No-delta re-survey — HEAD unchanged since 2026-06-02 (`pushed_at` 2026-05-28T02:28Z).** Every tracked fact re-verified against the same tree: agent v0.43.0, TypeScript 5.9.3, Vite 7.3.2, Vitest 4.1.4, pnpm 10.33.4 (`engines.pnpm ^10.28.2`), Node >=22.6.0, React Router 7.7.1, 7 workflows, no `settings.yml`. Open issues 4 (#162 autoheal, #13 maintenance, #1 Dependency Dashboard, #48 triage), open PRs 5 (unchanged set: #180/#178/#175/#172/#168). **Corrections against same SHA:** Playwright recorded as 1.54.x is actually 1.59.1; pnpm table said 10.33.0, true value 10.33.4. **New observable:** Renovate pin PRs (#180/#175/#172/#168) authored by `app/mrbro-bot`, security-override PR (#178) by `fro-bot` — the `mrbro-bot[bot]` actor (cf. [[marcusrbrown--ha-config]]) is now visibly active here, splitting automation labor with `fro-bot`. |
| 2026-06-23 | `7a49abc` | **No-delta re-survey — `main` HEAD still `7a49abc` (last main commit 2026-05-28T02:19Z).** `pushed_at` advanced to 2026-06-19 but that reflects PR-branch activity (renovate/*, fix/security-*, copilot/*), not the default branch. 7 workflows confirmed present including `fro-bot.yaml`. Open issues unchanged at 4. **Only delta is PR-queue movement:** open PRs 5 → 6 with new #181 `vite` 7.3.2 → 7.3.5 `[SECURITY]` (authored by `app/mrbro-bot`, labels `automerge`+`security`, opened 2026-06-15) — supersedes the standing 7.3.2 pin and continues the `mrbro-bot`-drives-version-bumps / `fro-bot`-drives-override-remediation split. No tree-level config, dependency, or workflow changes. |
| 2026-07-07 | `c6f106b` | **Real delta — `main` HEAD advanced `7a49abc` → `c6f106b` (last main commit 2026-07-04T20:30Z).** **Workflow:** `fro-bot.yaml` #182 fix — bare `workflow_dispatch` prompt now wins first regardless of `mode` (previously discarded unless `mode==review`). Autoheal prompt expanded **5 → 8 categories**: added Quality Gates Verification (#6), Cross-Project Intelligence inbound (#7, surveys tokentoilet/vbs/yield-farmer/renovate-config/.github/fro-bot·agent), and Sunday-only Upstream Modernization Watch (#8, gated on new `IS_SUNDAY_UTC` preflight step). Agent unchanged v0.43.0. **Deps:** `vite` 7.3.2 → **7.3.5** (PR #181 merged), `react-router-dom` ^7.7.1 → **^7.15.0**, `@eslint-react/eslint-plugin` 2.13.0. TypeScript still 5.9.3, pnpm 10.33.4, Vitest 4.1.4, Node >=22.6.0. **Security surface contradiction:** a second `pnpm.overrides` block reappeared in `package.json` (js-yaml/qs/tmp/uuid) alongside the primary `pnpm-workspace.yaml` ledger — values diverge (`uuid ^11.1.1` vs `>=14.0.0`; `tmp ^0.2.7` vs `>=0.2.6`), a drift footgun. 7 workflows, no `settings.yml`, Renovate preset still `#5.2.0`. Open issues 4 (unchanged), open PRs 6 → 5 (#181 merged). |
