---
type: repo
title: "marcusrbrown/marcusrbrown.com"
created: 2026-07-13
updated: 2026-07-13
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown.com
    sha: 389552270f1093250ad104a1160f53bba91693f1
    accessed: 2026-07-13
tags: [brand-site, react, typescript, vite, github-pages, pnpm, single-page]
aliases: [marcusrbrown.com, marcusrbrown-com]
related:
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--mrbro-dev
  - marcusrbrown--gpt
---

# marcusrbrown/marcusrbrown.com

Personal brand site for Marcus R. Brown ("Principal Software Engineer"). Single-page React 19 landing site deployed to [[github-pages]] at [marcusrbrown.com](https://marcusrbrown.com). Simpler than [[marcusrbrown--mrbro-dev]] (the full developer portfolio at mrbro.dev) — no routing, no theme system, no blog.

## Repository identity and the github.io rename

This repository is the **renamed successor** to the repo the wiki previously tracked as [[marcusrbrown--marcusrbrown-github-io]]. Multiple independent signals confirm they are the same underlying project:

- **Repo id `1021912280`**, `created_at` 2025-07-18 — matches the "Created 2025-07-18" recorded on the old `marcusrbrown-github-io` page.
- Identical open-issue inventory carried forward: **#411** (branch coverage <80%), **#409** (Daily Autohealing Report), **#260** (Daily Maintenance Report), **#6** (Dependency Dashboard).
- `package.json` `repository.url` still reads `https://github.com/marcusrbrown/marcusrbrown.github.io.git` (stale, un-renamed).
- README build-status badge still points at `marcusrbrown/marcusrbrown.github.io/actions` (stale).
- `.github/BRANCH_PROTECTION.md` still opens "…for the **mrbro.dev** project" — the same ported-doc curiosity the old page flagged 2026-06-12.

**Contradiction / name collision to be careful with:** a *different* repo now occupies `marcusrbrown/marcusrbrown.github.io` — repo id `1174807412`, `created_at` 2026-03-06, `homepage` **mrbro.dev** (not marcusrbrown.com). That repo has been repurposed as the GitHub Pages holder for [[marcusrbrown--mrbro-dev]] and is unrelated to this brand site. The old wiki slug `marcusrbrown--marcusrbrown-github-io` therefore now mixes two distinct repos across its survey history; this page is the canonical continuation for the **marcusrbrown.com brand site**. Treat the old page's pre-2026-07-13 deltas as this repo's history under its former name.

## Overview

- **Purpose:** Personal brand site / landing page
- **Default branch:** `main`
- **Created:** 2025-07-18 (as `marcusrbrown.github.io`, since renamed)
- **HEAD (2026-07-13):** `389552270f1093250ad104a1160f53bba91693f1` — `chore(deps): update fro-bot/agent to v0.87.1 (#474)`
- **Last push:** 2026-07-13
- **Homepage:** https://marcusrbrown.com (GitHub `homepage` field reads `http://marcusrbrown.com/`; `package.json` `homepage` is `https://marcusrbrown.com`)
- **License:** MIT (declared in `package.json` and README badge; GitHub `license` API reads null — no detectable `LICENSE` file, consistent with prior surveys)
- **Visibility:** Public
- **Primary language:** JavaScript (GitHub linguist)
- **Stars:** 1 | **Watchers:** 1 | **Forks:** 0
- **Open issues (2026-07-13):** 4 tracked — #411, #409, #260, #6 (API `open_issues_count` reads 8, folding in 4 open PRs)
- **Open PRs (2026-07-13):** 4 — #473 (docs: refresh stack versions), #471 (fix: honor pnpm overrides), #462 (chore: remove ignored pnpm overrides), plus the merged #474 agent bump on HEAD

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
| UI Framework | React | 19.x |
| Language | TypeScript | 6.0+ (strict) |
| Bundler | Vite | 7.x (SWC via `@vitejs/plugin-react-swc` v4) |
| Unit Testing | Vitest | 4.x (happy-dom 20.x) |
| Coverage | `@vitest/coverage-v8` | 4.x |
| E2E Testing | Playwright | 1.58.x |
| Accessibility | vitest-axe + axe-core | 4.11.x |
| Linting | ESLint 10 flat config (`eslint.config.ts`) | `@bfra.me/eslint-config` ^0.51.0 |
| Formatting | Prettier | `@bfra.me/prettier-config/120-proof` |
| Type Config | TypeScript | `@bfra.me/tsconfig` ^0.13.0 |
| Package Manager | pnpm | **11.11.0** (`packageManager` field; `engines.pnpm ^11.8.0`) |
| Node.js | >= 22.0.0 | |
| Git Hooks | simple-git-hooks + lint-staged | |

The stack is unchanged in shape from the last `github.io`-slug survey (2026-06-23); the notable drift is **pnpm crossing the 10 → 11 major boundary** to 11.11.0 with a matching `engines.pnpm ^11.8.0` — the same fleet-wide cutover recorded across [[marcusrbrown--marcusrbrown]], [[marcusrbrown--sparkle]], and [[marcusrbrown--containers]]. README's "pnpm 10.13.1+" line is stale relative to the enforced 11.x.

## Repository Structure

```
index.html                     # Vite entry HTML
src/                            # React app (App + sections + hooks + styles)
tests/                         # unit + e2e (Playwright)
scripts/                       # build analysis (analyze-build.ts) + test automation
public/                        # static assets (incl. CNAME for marcusrbrown.com)
.ai/                           # feature implementation plans (reference)
.github/
  workflows/                   # ci, deploy, fro-bot, renovate, copilot-setup-steps
  actions/setup/               # composite action: Node 22 + pnpm + optional Playwright
  ACTIONS.md, BRANCH_PROTECTION.md, copilot-instructions.md, renovate.json5
AGENTS.md, TESTING.md          # root-level code map + testing docs
lhci.config.js                 # Lighthouse CI config (no dedicated workflow)
eslint.config.ts, vite.config.ts, playwright.config.ts, tsconfig.json
pnpm-workspace.yaml            # security-override ledger + allowBuilds
```

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PR to `main`, dispatch | Setup → Lint, Build, Test, Type Check, Validate deps → quality-gate aggregation |
| Deploy | `deploy.yaml` | push to `main`, dispatch | Build + deploy to GitHub Pages (marcusrbrown.com) |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule, dispatch | PR review, daily maintenance, autoheal, @fro-bot mentions |
| Renovate | `renovate.yaml` | issue/PR edit, push to non-main, dispatch, workflow_run | Dependency management via `bfra-me/.github` reusable workflow |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | dispatch, workflow-touch | Copilot agent environment verification |

### CI Quality Gate (`ci.yaml`)

Shared `setup` (Setup and Cache) feeds five parallel jobs — **Lint** (ESLint + formatting check), **Build** (with build-output verification + artifact upload), **Test** (Vitest), **Type Check** (`tsc --noEmit`), **Validate** (dependency audit) — aggregated by a `quality-gate` job. Checkout pinned `actions/checkout@df4cb1c0 # v6.0.3`.

### Deploy (`deploy.yaml`)

Push-to-`main` pipeline: checkout → `./.github/actions/setup` → configure-pages (`actions/configure-pages@45bfe019 # v6.0.0`) → build → upload pages artifact → `actions/deploy-pages`. Custom domain `marcusrbrown.com` served via `public/CNAME`.

### Shared Setup Action (`.github/actions/setup/`)

Composite action: pnpm install via `pnpm/action-setup@0ebf4713 # v6.0.9`, Node via `actions/setup-node@48b55a01 # v6.4.0` (default Node 22), optional Playwright browser install with caching. Exposes `node-version` / `playwright-version` outputs. Used across all workflows.

## Fro Bot Integration

**Fro Bot workflow is present and active** — `fro-bot/agent@32dca3d787c9d591b2f7ce09ee06175ff5b4067e # v0.87.1` (2026-07-13). This continues the aggressive release-tracking posture recorded under the old slug (v0.61.0 at 2026-06-23); the agent has climbed ~26 minor versions in ~three weeks and this repo remains at or near the ecosystem version front alongside [[marcusrbrown--sparkle]] (v0.85.0) and [[fro-bot--dashboard]] (v0.84.2).

- **Single-file three-mode design:** review / maintenance / autoheal run from one `fro-bot.yaml` (29 KB) dispatched by event + `inputs.mode` (default `autoheal`), not split into a separate `fro-bot-autoheal.yaml`. This architecture was adopted 2026-05-14 (PR #407 under the old name) and holds.
- **Triggers:** PR events, issue/comment `@fro-bot` mentions, two daily crons (`AUTOHEAL_CRON '30 3 * * *'`, `MAINTENANCE_CRON '30 15 * * *'` UTC), manual dispatch with `mode` + optional `prompt`.
- **Review prompt:** React 19 patterns, TypeScript strictness (no `any` / `@ts-ignore` / `@ts-expect-error`), pure ESM, accessibility (WCAG), performance budgets, `.yaml` extension convention; PASS / CONDITIONAL / REJECT verdict format.
- **Autoheal prompt (8 categories):** Errored PRs, Security, Code Quality & Repo Hygiene, Developer Experience, Production Site Review, Quality Gates Verification, Cross-Project Intelligence, Upstream Modernization Watch (Sundays UTC).

## Developer Tooling

- **Renovate:** extends `github>marcusrbrown/renovate-config#5.2.4` (see [[marcusrbrown--renovate-config]]) + `:preserveSemverRanges` + `group:allNonMajor`. Post-upgrade tasks: `pnpm install`, `pnpm run build`, `pnpm run fix` (×2), `executionMode: branch`. Runs via `bfra-me/.github` reusable workflow.
- **Security-override ledger:** `pnpm-workspace.yaml` carries ~15 GHSA-style version overrides (`@isaacs/brace-expansion`, `ajv`, `basic-ftp`, `brace-expansion`, `js-yaml`, `lodash-es`, `mdast-util-to-hast`, `minimatch`, `picomatch`, `qs`, `rollup`, `tmp`, `vite >=7.3.5`, `ws`) plus an `allowBuilds` allowlist (`@swc/core`, `esbuild`, `simple-git-hooks`, `unrs-resolver`) and `shamefullyHoist: true`. `package.json` still retains a legacy `pnpm.overrides` pair (`fast-uri >=3.1.2`, `flatted >=3.4.2`) — the split-brain override management noted under the old slug persists, and open PRs **#471** ("honor pnpm overrides") and **#462** ("remove ignored pnpm overrides") are actively churning on exactly this reconciliation.
- **Git hooks:** simple-git-hooks + lint-staged running `eslint --fix` on staged `js,jsx,ts,tsx,json,css,md,yaml`.
- **AGENTS.md / TESTING.md:** root-level code map and dedicated testing docs.
- **Copilot instructions:** `.github/copilot-instructions.md`.
- **Lighthouse:** `lhci.config.js` present at root; still no dedicated Lighthouse workflow (invoked from CI or autoheal Production Site Review).

## Notable Patterns and Conventions

- **No routing:** single-page with anchor links, no React Router.
- **Pure ESM, no default exports, strict TS** (carried from AGENTS.md conventions).
- **SWC over Babel** (`@vitejs/plugin-react-swc`).
- **Accessibility-first:** `vitest-axe` matchers; open issue #465 ("Homepage lacks footer landmark") is a live a11y autoheal finding.
- **Stale self-references:** `package.json` `repository.url`, README build badge, and `BRANCH_PROTECTION.md` header all still name the *old* project (`marcusrbrown.github.io` / `mrbro.dev`) — housekeeping debt from the rename and doc-porting.

## Gaps (relative to other Marcus repos)

- **No Probot `settings.yml`:** confirmed — `.github/` contains `ACTIONS.md`, `BRANCH_PROTECTION.md`, `copilot-instructions.md`, `renovate.json5`, `actions/`, `workflows/`, but no `settings.yml`. Branch protection remains unmanaged via Probot (see [[probot-settings]]). Durable across all surveys under both slugs.
- **No CodeQL/Scorecard:** no security-scanning workflows.
- **`lhci.config.js` without a workflow:** performance config present, no dedicated Lighthouse CI job.

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-07-13 | `3895522` | **First survey under the `marcusrbrown.com` slug.** Confirmed rename from `marcusrbrown.github.io` (repo id `1021912280`, created 2025-07-18; issue set #411/#409/#260/#6 carried forward; stale `repository.url` + README badge). A *different* repo now holds the `marcusrbrown.github.io` name (id `1174807412`, homepage mrbro.dev). Fro Bot agent v0.61.0 → **v0.87.1** (`32dca3d`), single-file three-mode design and `30 3`/`30 15` crons hold. **pnpm 10 → 11 major** (11.11.0, `engines ^11.8.0`). Renovate preset `#5.2.1` → `#5.2.4`. `pnpm-workspace.yaml` override ledger grew to ~15 entries + `allowBuilds`; legacy `package.json` overrides (fast-uri/flatted) persist — PRs #471/#462 churning the reconciliation. New a11y issue #465. Gaps unchanged: no Probot `settings.yml`, no CodeQL/Scorecard. Prior history (2026-04-25 → 2026-06-23) recorded on [[marcusrbrown--marcusrbrown-github-io]] under the former name. |
