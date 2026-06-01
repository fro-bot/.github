---
type: repo
title: "marcusrbrown/marcusrbrown.github.io"
created: 2026-04-25
updated: 2026-06-01
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: ec4b7854bee556aadd301950392268f70817d800
    accessed: 2026-04-25
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 4cd8198991618f216b940b6a6c13e1a09fd7979d
    accessed: 2026-05-18
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 4cd8198991618f216b940b6a6c13e1a09fd7979d
    accessed: 2026-05-19
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 4cd8198991618f216b940b6a6c13e1a09fd7979d
    accessed: 2026-05-20
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 1a428e231d4d3be7de40bbc016192cc14cb5190b
    accessed: 2026-06-01
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
- **Last push:** 2026-05-18
- **Homepage:** https://marcusrbrown.com
- **License:** MIT (declared in package.json and README badge; no LICENSE file detected via API)
- **Visibility:** Public
- **Stars:** 0 | **Watchers:** 0
- **Open issues (2026-05-18):** 4 — #411 (test branch coverage <80%), #409 (Daily Autohealing Report, perpetual), #260 (Daily Maintenance Report, perpetual), #6 (Dependency Dashboard)
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
| Package Manager | pnpm | 10.33.0 (enforced via `packageManager` field) |
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

**Fro Bot workflow is present and active** (`fro-bot/agent@v0.48.1`, SHA `80f1fa11d8e25280d388947c0a28875ed18cdc25`, as of 2026-06-01 survey; was v0.44.0 / `b030b53b…` at the 2026-05-18 survey).

- **Triggers:** PR events (opened, synchronize, ready_for_review, reopened, review_requested), issue/comment events (`@fro-bot` mention from OWNER/MEMBER/COLLABORATOR), two daily crons (autoheal at 03:30 UTC, maintenance at 15:30 UTC), manual dispatch with `mode` input.
- **Single-file three-mode design:** Unlike [[marcusrbrown--mrbro-dev]] and [[marcusrbrown--vbs]] (which split `fro-bot.yaml` + `fro-bot-autoheal.yaml`), this repo runs review, maintenance, and autoheal modes from one workflow file dispatched by event + `inputs.mode`. Cron schedule disambiguated via `AUTOHEAL_CRON` / `MAINTENANCE_CRON` env vars.
- **PR review prompt:** Structured review targeting React 19 patterns, TypeScript strictness, pure ESM, accessibility (WCAG 2.1 AA), performance budgets (JS <500KB warning, total <2MB max), PascalCase hooks, `.yaml` extension convention. Verdict format: PASS / CONDITIONAL / REJECT with blocking/non-blocking/missing tests/risk sections.
- **Maintenance prompt:** Perpetual single-issue hygiene model with archive logic and cross-project intelligence ingestion (post-2026-05-14 redesign).
- **Autoheal prompt (8 categories):** Errored PRs, Security, Code Quality & Repo Hygiene, Developer Experience, Production Site Review, Quality Gates Verification, Cross-Project Intelligence (Inbound), Upstream Modernization Watch (Sundays UTC only). Sunday detection uses a step output rather than `GITHUB_ENV` (Copilot review feedback, PR #407). Playwright browsers conditionally installed when `mode == autoheal`.
- **Fork PR guard:** Skips bot-authored and fork PRs. Issue_comment fork detection via API call. Whitespace-only `prompt` inputs rejected in review mode (PR #407 hardening).
- **Permissions:** Moved to job level and expanded for autoheal write operations.
- **Concurrency:** Per-issue/PR for events; per-schedule (`ops-{cron}`) for scheduled runs; per-mode for dispatched runs. Non-cancelling.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8` + `:preserveSemverRanges` + `group:allNonMajor`. Post-upgrade: `pnpm install`, `pnpm run build`, `pnpm run fix` (twice). Uses `bfra-me/.github` reusable workflow (v4.16.8). Trigger model: issue/PR edit (non-bot), push to non-main, dispatch, workflow_run after Deploy.
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

_Updated 2026-05-18: two gaps closed, two remain._

- **No Probot `settings.yml`:** Still true. Unlike [[marcusrbrown--mrbro-dev]], [[marcusrbrown--ha-config]], and most other Marcus repos, this repo does not have a `.github/settings.yml` extending `fro-bot/.github:common-settings.yaml`. Branch protection and repo settings are not managed via Probot.
- **No CodeQL/Scorecard:** Still true. No security scanning workflows (present in [[marcusrbrown--systematic]] and [[marcusrbrown--mrbro-dev]]).
- ~~No autoheal workflow~~ — **Closed 2026-05-14 (PR #407).** Autoheal integrated as a mode in `fro-bot.yaml` with 8 healing categories rather than as a separate `fro-bot-autoheal.yaml` file. Architecturally distinct from the sibling-repo pattern.
- ~~No performance workflow~~ — **Partially closed.** `lhci.config.js` is now present at the repo root, but no dedicated Lighthouse CI workflow has been added. Likely invoked from the CI quality gate or the autoheal "Production Site Review" / "Quality Gates Verification" categories.

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
| Autoheal | Integrated as mode in `fro-bot.yaml` (8 categories) | Separate `fro-bot-autoheal.yaml` (5 categories) |
| Fro Bot agent version | v0.48.1 (2026-06-01) | v0.38.0 at last survey (likely behind) |

## Recent Activity

Most recent commits (2026-05-18 survey):

- `4cd8198` 2026-05-18: update all non-major dependencies (#416)
- `84e75e3` 2026-05-17: update fro-bot/agent to v0.43.3 (#415)
- `c1f83ee` 2026-05-17: update fro-bot/agent to v0.43.2 (#414)
- `6251d36` 2026-05-16: update marcusrbrown/renovate-config preset to v5 (#406) — required restoring `fast-uri >=3.1.2` security override mid-PR
- `af8b935` 2026-05-16: update bfra-me/.github to v4.16.17 (#413)
- `ba3527f` 2026-05-16: add analyze-build npm script (#410)
- `ae8357d` 2026-05-15: update fro-bot/agent to v0.43.1 (#412)
- `8a51a36` 2026-05-14: **integrate autoheal into Fro Bot workflow (#407)** — material architecture change
- `4fe6ea7` 2026-05-14: update all non-major dependencies (#405)
- `fa990fa` 2026-05-14: override fast-uri to >=3.1.2 (#408)
- `d2ea552` 2026-05-08: update pnpm to v10.33.3 (#404)
- `48746f3` 2026-05-04: update fro-bot/agent to v0.42.7 (#402)
- `6d3cbd7` 2026-05-03: update fro-bot/agent to v0.42.6 (#400)

Earlier window (2026-04-25 survey baseline): `ec4b785` and prior were exclusively Renovate dependency bumps (#386–#389).

## Delta Log (2026-05-18, SHA `4cd8198`)

Material changes since the 2026-04-25 survey at `ec4b785`. The site's structure and tech stack are unchanged; the interesting motion is in CI/CD and the Fro Bot integration.

- **Fro Bot agent bumped four times in three weeks:** v0.41.4 → v0.42.6 (PR #400) → v0.42.7 (#402) → v0.43.0 (#407) → v0.43.1 (#412) → v0.43.2 (#414) → v0.43.3 (#415) → **v0.44.0** (current on `main`, pinned via SHA `b030b53b1b47b1bed77a581222706c900cc63b0e`). PR #417 is in flight to v0.44.1 (open as of 2026-05-20). Tracks the agent release cadence aggressively — same posture as [[marcusrbrown--mrbro-dev]] and [[marcusrbrown--gpt]].
- **Autoheal collapsed into the Fro Bot workflow itself (PR #407, 2026-05-14):** The earlier "no autoheal" gap noted in the prior survey was closed by integrating autoheal as a second cron (`30 3 * * *`) and a `workflow_dispatch` `mode` input (`review` / `maintenance` / `autoheal`, default `autoheal`) inside the existing `fro-bot.yaml` — not by adding a separate `fro-bot-autoheal.yaml` like the sibling repos. One file, three modes, branched by event + input.
- **Autoheal prompt has 8 categories** (vs. 5 in [[marcusrbrown--vbs]] and [[marcusrbrown--mrbro-dev]]): 1) Errored PRs, 2) Security, 3) Code Quality & Repo Hygiene, 4) Developer Experience, 5) Production Site Review, 6) Quality Gates Verification, 7) Cross-Project Intelligence (Inbound), 8) Upstream Modernization Watch (Sundays UTC only — `IS_SUNDAY_UTC` propagated via step output, not `GITHUB_ENV`).
- **Maintenance prompt now perpetual-single-issue:** Rolling 14-day window collapsed into a perpetual maintenance issue with archive logic and cross-project intelligence ingestion.
- **Renovate preset jumped major version:** `marcusrbrown/renovate-config#4.5.8` → `#5.2.0` (PR #406, 2026-05-16). Same upgrade inadvertently dropped the `fast-uri` security override, which would have flagged GHSA-q3j6-qgpj-74h6 and GHSA-v39h-62p7-jpjc — the override was restored in the same PR (and again hardened in #408). `package.json` now carries an explicit `pnpm.overrides.fast-uri: ">=3.1.2"` and `flatted: ">=3.4.2"`. Worth tracking — the v5 preset has different defaults that need vetting per repo.
- **`bfra-me/.github` reusable workflows:** v4.16.8 → v4.16.12 (#401) → v4.16.17 (#413).
- **New file: `lhci.config.js` (3326 bytes)** at root. Lighthouse CI configuration is now present, closing the "no performance workflow" gap noted in the prior survey — though no Lighthouse workflow file was added; the config likely runs from the CI quality gate or the autoheal "Production Site Review" category.
- **New file: `TESTING.md` (15440 bytes)** at root. Dedicated testing documentation, separate from AGENTS.md.
- **New script: `analyze-build`** in `package.json` (PR #410) — `tsx scripts/analyze-build.ts`. Bundle-analysis tooling, consistent with the "Performance budget adherence" line in the PR review prompt.
- **Dependency bumps:** pnpm `10.33.0` → `10.33.4` (#404), `@types/node` to `^24.0.0`, all other non-major bumps grouped via Renovate.
- **Open issues:** 2 → 4 (added `#409` Daily Autohealing Report and `#411` test branch coverage below 80% — the autoheal is doing its job).
- **PR #410** confirms `fro-bot` (account `80104189`) co-authored a security-fix commit alongside the bot account — first observed instance of Fro Bot directly committing to this repo.

### Implications

The earlier survey's "Missing Compared to Other Marcus Repos" section is partially obsolete:

- ~~No autoheal workflow~~ → **integrated into `fro-bot.yaml`** as a mode, not a separate file. Architecturally distinct from the sibling-repo pattern.
- ~~No performance workflow~~ → **`lhci.config.js` present**, no dedicated workflow yet.
- **No Probot `settings.yml`** — still true, branch protection remains unmanaged via Probot.
- **No CodeQL/Scorecard** — still true.

## Delta Log (2026-06-01, SHA `1a428e2`)

No structural drift since the 2026-05-20 re-survey at `4cd8198`. Twelve days, eleven commits — all Renovate dependency bumps and lockfile maintenance, no architecture changes. The stack, workflow inventory, single-file three-mode Fro Bot design, and crons are unchanged.

- **Fro Bot agent climbed v0.44.0 → v0.48.1 across six bumps:** v0.44.1 (#417, 2026-05-25) → v0.46.0 (#420) → v0.46.1 (#421) → v0.48.0 (#424, 2026-05-31). The pin on `main` now reads `fro-bot/agent@80f1fa11d8e25280d388947c0a28875ed18cdc25 # v0.48.1` — newer than the v0.48.0 of commit #424, folded in with the non-major batch #425 (2026-06-01). Same aggressive release-tracking posture as [[marcusrbrown--mrbro-dev]] and [[marcusrbrown--gpt]]. The PR #417 that was "in flight" at the 2026-05-20 survey has long since merged.
- **pnpm:** `10.33.4` → `10.34.1` (#423). `packageManager: pnpm@10.34.1` confirmed.
- **`bfra-me/.github` reusable workflows:** v4.16.17 → v4.16.21 (#419).
- **Core stack unchanged:** React `^19.0.0`, TypeScript `^6.0.0`, Vite `^7.0.6`, Vitest `^4.0.0`, `@types/node ^24.0.0`. Security overrides `fast-uri >=3.1.2` and `flatted >=3.4.2` still present in `pnpm.overrides`.
- **Workflow inventory steady:** `ci.yaml`, `copilot-setup-steps.yaml`, `deploy.yaml`, `fro-bot.yaml`, `renovate.yaml`. Crons unchanged (`AUTOHEAL_CRON 30 3 * * *`, `MAINTENANCE_CRON 30 15 * * *`).
- **Open issues:** steady at 4 (#411, #409, #260, #6). **Open PRs:** 0.
- The two long-standing gaps still hold: **no Probot `settings.yml`**, **no CodeQL/Scorecard**. No contradictions with prior ingests.

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-04-25 | `ec4b785` | Initial survey |
| 2026-05-18 | `4cd8198` | Delta: agent v0.41.4 → v0.44.0, autoheal integrated as workflow mode (PR #407), Renovate preset v4 → v5 (PR #406, fast-uri override regression+fix), `lhci.config.js` and `TESTING.md` added |
| 2026-05-19 | `4cd8198` | No-op re-survey: HEAD unchanged since 2026-05-18. Open issues steady at 4 (#411, #409, #260, #6), 0 open PRs. Fro Bot agent pin verified at `b030b53b...` (v0.44.0). All prior findings hold. |
| 2026-05-20 | `4cd8198` | No-op re-survey: HEAD still unchanged. Renovate PR #417 (fro-bot/agent v0.44.0 → v0.44.1, branch `renovate/all-minor-patch`) is open and will likely merge under `:automergePatch`. Open issues steady at 4 (#411, #409, #260, #6); open PRs now 1 (#417). `package.json` confirms `packageManager: pnpm@10.33.4`, `@types/node ^24.0.0`, React 19 / TypeScript ^6.0.0 / Vite ^7.0.6 / Vitest ^4.0.0 stack unchanged. No structural drift since 2026-05-18. |
| 2026-06-01 | `1a428e2` | Dependency-drift re-survey: HEAD advanced 11 commits, all Renovate bumps. Fro Bot agent v0.44.0 → v0.48.1 (pin `80f1fa11…`), pnpm 10.33.4 → 10.34.1 (#423), `bfra-me/.github` v4.16.17 → v4.16.21 (#419). No structural change to stack, workflows, crons, or Fro Bot single-file three-mode design. Open issues steady at 4; 0 open PRs. Gaps (no Probot `settings.yml`, no CodeQL/Scorecard) unchanged. |
