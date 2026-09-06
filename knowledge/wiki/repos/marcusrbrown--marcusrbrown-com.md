---
type: repo
title: marcusrbrown/marcusrbrown.com
created: 2026-07-13
updated: 2026-09-01
node_id: R_kgDOPOkk2A
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown.com
    sha: 389552270f1093250ad104a1160f53bba91693f1
    accessed: 2026-07-13
  - url: https://github.com/marcusrbrown/marcusrbrown.com
    sha: 3b863c9e16f169d26ed139b013afb5d1bd3a3f8c
    accessed: 2026-08-03
  - url: https://github.com/marcusrbrown/marcusrbrown.com
    sha: 89231800828a4edac09931844ed58bb2a2acb176
    accessed: 2026-09-01
tags:
  - brand-site
  - react
  - typescript
  - vite
  - github-pages
  - pnpm
  - single-page
  - autoheal
  - propose-without-merge
  - doc-drift
aliases:
  - marcusrbrown.com
  - marcusrbrown-com
related:
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--mrbro-dev
  - marcusrbrown--gpt
  - marcusrbrown--sparkle
  - marcusrbrown--dev-like
  - bfra-me--ha-addon-repository
  - github-actions-ci
  - probot-settings
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

**Contradiction / name collision to be careful with:** a _different_ repo now occupies `marcusrbrown/marcusrbrown.github.io` — repo id `1174807412`, `created_at` 2026-03-06, `homepage` **mrbro.dev** (not marcusrbrown.com). That repo has been repurposed as the GitHub Pages holder for [[marcusrbrown--mrbro-dev]] and is unrelated to this brand site. The old wiki slug `marcusrbrown--marcusrbrown-github-io` therefore now mixes two distinct repos across its survey history; this page is the canonical continuation for the **marcusrbrown.com brand site**. Treat the old page's pre-2026-07-13 deltas as this repo's history under its former name.

## Overview

- **Purpose:** Personal brand site / landing page
- **Default branch:** `main`
- **Created:** 2025-07-18 (as `marcusrbrown.github.io`, since renamed)
- **Repo id / node_id:** `1021912280` / `R_kgDOPOkk2A`
- **HEAD (2026-09-01):** `89231800828a4edac09931844ed58bb2a2acb176` — `chore(deps): update fro-bot/agent to v0.107.0 (#542)` (prior survey HEADs: `3b863c9` 2026-08-03, `3895522` 2026-07-13)
- **Last push:** 2026-08-31 (`updated_at` 2026-08-31, `pushed_at` 2026-08-31)
- **Homepage:** https://marcusrbrown.com (GitHub `homepage` field reads `http://marcusrbrown.com/`; `package.json` `homepage` is `https://marcusrbrown.com`)
- **License:** MIT (declared in `package.json` and README badge; GitHub `license` API reads null — no detectable `LICENSE` file, consistent across all surveys)
- **Visibility:** Public (`private: false`, `visibility: public`, not a fork, not a template)
- **Primary language:** JavaScript (GitHub linguist) | **Size:** 1,774 KB | **Tracked blobs:** 66
- **Stars:** 1 | **Watchers:** 1 | **Forks:** 0
- **Open issues (2026-09-01):** 6 tracked — #517 (CONTACT nav anchor, `bug`), #465 (footer landmark a11y), #411 (branch coverage <80%), #409 (Daily Autohealing Report), #260 (Daily Maintenance Report), #6 (Dependency Dashboard). API `open_issues_count` reads 12, folding in the 6 open PRs.
- **Open PRs (2026-09-01):** 6, **all `fro-bot`-authored, all green, none merged** — #523, #484, #478, #473, #471, #462. See [Two merge realities](#two-merge-realities-in-one-repository).

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
| UI Framework | React | 19.x |
| Language | TypeScript | 6.0+ (strict) |
| Bundler | Vite | **8.x** (8.1.3; SWC via `@vitejs/plugin-react-swc` v4) |
| Unit Testing | Vitest | 4.x (happy-dom 20.x) |
| Coverage | `@vitest/coverage-v8` | 4.x |
| E2E Testing | Playwright | 1.58.x |
| Accessibility | vitest-axe + axe-core | 4.11.x |
| Linting | ESLint 10 flat config (`eslint.config.ts`) | `@bfra.me/eslint-config` **^0.52.0** |
| Formatting | Prettier | `@bfra.me/prettier-config/120-proof` |
| Type Config | TypeScript | `@bfra.me/tsconfig` ^0.13.0 |
| Package Manager | pnpm | **11.24.0** (`packageManager` field; `engines.pnpm ^11.8.0`) |
| Node.js | >= 22.0.0 engine floor; **CI actually runs Node 22** (setup-action default); `@types/node` ^24 |  |
| Git Hooks | simple-git-hooks + lint-staged |  |

The stack is unchanged in shape from the last `github.io`-slug survey (2026-06-23); the notable drift is **pnpm crossing the 10 → 11 major boundary** to 11.11.0 with a matching `engines.pnpm ^11.8.0` — the same fleet-wide cutover recorded across [[marcusrbrown--marcusrbrown]], [[marcusrbrown--sparkle]], and [[marcusrbrown--containers]]. README's "pnpm 10.13.1+" line is stale relative to the enforced 11.x.

**2026-08-03 stack drift:** the big move this cycle is **Vite crossing the 7 → 8 major boundary** to `8.1.3` — a real API-surface jump the SWC React plugin (still v4) rides without a version bump. `@types/node` climbed 22 → **^24** (Node engine still pinned `>= 22.0.0`, so the type floor now runs ahead of the runtime floor — a mild footgun if code leans on Node 24-only typings). pnpm advanced within-major `11.11.0 → 11.18.0`. Everything else (React 19, TS 6, Vitest 4, Playwright 1.58, ESLint 10, the `@bfra.me/*` config trio) holds shape.

**2026-09-01 stack drift:** nothing crossed a major. pnpm `11.18.0 → 11.24.0`, `@bfra.me/eslint-config` `^0.51.0 → ^0.52.0`, and that is the entire manifest delta. The Node-22-vs-`@types/node`-24 gap flagged last cycle is now confirmed concrete rather than theoretical: `.github/actions/setup/action.yaml` declares `node-version` default `'22'` and **no workflow overrides it**, so every CI, deploy, and agent run executes on Node 22 while the type surface is Node 24.

**Seven approval-gated majors are parked** on Dependency Dashboard #6 as unchecked checkboxes, none of which anyone has clicked: `actions/cache` v6, `actions/checkout` v7, `actions/setup-node` v7, `fast-uri` v4, `@eslint-react/eslint-plugin` v5, `lint-staged` v17, `typescript` v7. Same "major update lands as a dashboard checkbox rather than a PR" shape recorded at [[bfra-me--ha-addon-repository]]. Note the collision: **`fast-uri` v4 is one of the parked majors**, and `fast-uri` is also the package caught in this repo's two-ledger split-brain (below) — whoever eventually clicks that box inherits an ambiguity about which ledger wins.

## Repository Structure

```
index.html                     # Vite entry HTML
src/            (15 blobs)     # React app: App.tsx, main.tsx, Navigation.tsx,
                               #   sections/{About,Contact,Experience,Skills}.tsx,
                               #   hooks/UseScrollReveal.ts, styles/{brand,Navigation}.css,
                               #   co-located __tests__/, test-setup.ts, vite-env.d.ts
tests/e2e/      (1 blob)       # scroll-reveal.spec.ts (Playwright)
scripts/        (15 blobs)     # analyze-build.ts + test automation + 8 verify-*.sh /
                               #   migrate-repo.sh rename-migration scripts + AGENTS.md
public/         (3 blobs)      # CNAME (marcusrbrown.com), favicon.ico, robots.txt
.ai/plan/       (7 blobs)      # aspirational feature plans: blog-system, flagging-system,
                               #   github-stats, home-landing, parallax-hero-hook,
                               #   testing-comprehensive, theme-system
.github/        (10 blobs)
  workflows/                   # ci, deploy, fro-bot, renovate, copilot-setup-steps
  actions/setup/               # composite action: Node 22 + pnpm + optional Playwright
  ACTIONS.md, BRANCH_PROTECTION.md, copilot-instructions.md, renovate.json5
AGENTS.md, TESTING.md          # root-level code map + testing docs
lhci.config.js                 # Lighthouse CI config (no dedicated workflow)
eslint.config.ts, vite.config.ts, playwright.config.ts, tsconfig.json
pnpm-workspace.yaml            # security-override ledger + allowBuilds
.gitattributes, .gitignore, .markdownlint-cli2.yaml, README.md, package.json, pnpm-lock.yaml
```

**66 tracked blobs total.** Two proportions worth recording:

- **`.github/workflows/fro-bot.yaml` is 29,251 bytes — larger than the entire `src/` tree (~26 KB across 15 files).** The governance layer outweighs the artifact it governs. This is a four-section landing page carrying a 625-line autonomous-agent workflow.
- **`scripts/` (15 blobs) is the same size as `src/` (15 blobs)**, and eight of those scripts (`migrate-repo.sh`, `verify-{brand-sections,dns-baseline,domains,evidence-naming,history-parity,migration-parity,repo-bootstrap}.sh`) are one-time tooling for the `marcusrbrown.github.io → marcusrbrown.com` rename. AGENTS.md acknowledges them: _"`scripts/verify-*.sh` are one-time migration/verification scripts — safe to ignore."_ The migration toolkit is still resident ~7 weeks after the wiki first confirmed the rename, while the stale self-references those scripts were presumably meant to catch (below) are still wrong.
- **`.ai/plan/` holds 7 feature plans** — blog system, feature flagging, GitHub stats, home landing, parallax hero hook, comprehensive testing, theme system. None are implemented: `src/` has no router, no theme system, no blog. Same aspirational-planning-corpus shape recorded at [[bfra-me--github]]'s `.ai/` directory. The plans describe the site [[marcusrbrown--mrbro-dev]] actually is.

## Two merge realities in one repository

This is the durable finding of the 2026-09-01 survey, and it is cleanly quantified because the interval was otherwise inert.

Between `3b863c9` (2026-08-03) and `89231800` (2026-09-01): **32 commits, every single one authored by `mrbro-bot[bot]`**, touching **7 files** — six of them pure version tokens (`.github/actions/setup/action.yaml`, `.github/renovate.json5`, `.github/workflows/fro-bot.yaml`, `.github/workflows/renovate.yaml`, `package.json`, `pnpm-workspace.yaml`) plus `pnpm-lock.yaml`. **Zero `src/` changes. Zero human commits. Zero merged non-Renovate PRs.**

In the same window, six `fro-bot`-authored PRs sat open. They are not stuck on quality:

| PR | Opened | Age at survey | Files | Head checks |
| --- | --- | --- | --- | --- |
| #462 `chore(config): remove ignored pnpm overrides` | 2026-07-07 | 56 d | `package.json` | Quality Gate ✅ (all 6 jobs green) |
| #471 `fix(config): honor pnpm overrides` | 2026-07-12 | 51 d | `package.json` | ✅ |
| #473 `docs(agents): refresh stack versions` | 2026-07-13 | 50 d | `AGENTS.md` | ✅ |
| #478 `chore(repo): refresh workflow docs and pnpm config` | 2026-07-14 | 49 d | `.github/ACTIONS.md`, `package.json` | ✅ |
| #484 `docs(agents): fix coverage command example` | 2026-07-18 | 45 d | `AGENTS.md` | ✅ |
| #523 `docs(agents): refresh stack versions` | 2026-08-14 | 18 d | `AGENTS.md` | ✅ |

Every one has `updated_at` ≈ `created_at` + ~70 seconds — created, one commit pushed, then **never touched again**: no review, no comment, no rebase, no close. The `Fro Bot` check on each resolves to **`skipped`** (the workflow's bot-author guard), and `skipped` reads as passing.

So the sorting function is not CI, not review verdict, and not merge conflict. **It is authorship.** Renovate PRs carry automerge from the [[marcusrbrown--renovate-config]] preset and land the same day — 32 of them. Fro Bot's own PRs have no automerge path and require a human click that never comes. Two bots, one repository, one green gate, and a 32-to-0 merge ratio decided entirely by which bot opened the PR.

This is the **propose-without-merge** backlog already recorded at [[marcusrbrown--sparkle]] (15 open, 13 autoheal-authored) and [[marcusrbrown--mrbro-dev]], and the inverse of [[marcusrbrown--dev-like]] (0 open, every PR merged same-day). What this survey adds is the controlled comparison: dev-like's clean queue was previously read as "small surface area + permissive merge gate." Here the surface area is _also_ tiny (66 blobs, four React sections) and the gate is _also_ trivially satisfiable — yet the queue is six deep. The variable that actually moves is **whether the proposing identity has automerge**, not repo size and not gate strictness.

### The six PRs are really two contested files

Three PRs (#473, #484, #523) edit `AGENTS.md`. Three (#462, #471, #478) edit `package.json`. The `package.json` trio is **mutually incompatible** — #462 deletes the `pnpm.overrides` block outright (`+0-6`), #471 rewrites it (`+4-6`), #478 rewrites it alongside a docs refresh (`+8-18`). They propose competing resolutions of the same split-brain, so at most one can land, and each additional proposal makes the decision look larger than it is.

### Deduplication failed across the gap

**#473 and #523 are the same PR.** Identical title (`docs(agents): refresh stack versions`), identical target (`AGENTS.md`), identical shape (1 commit, 1 file, `+1-1`), opened 32 days apart on differently-named branches (`chore/update-agents-stack-notes` vs `chore/refresh-agents-stack-notes`).

The `AUTOHEAL_PROMPT` contains an explicit guard against exactly this:

> DEDUPLICATION (applies to ALL categories) — Before creating any new PR or issue, search for an existing open bot-authored PR/issue for the same root cause. Reuse or update the existing item instead of creating a duplicate.

It did not hold. Branch-name variance is enough to defeat a natural-language "search for an existing PR for the same root cause" instruction, and the longer the unmerged queue gets, the more candidates the search has to scan. Same failure class as the #283-vs-#254 byte-title docs duplicate at [[marcusrbrown--mrbro-dev]] — now confirmed in a second repo, which upgrades it from anecdote to pattern: **an unmerged backlog is not inert; it is a duplicate-generating surface.**

## The autoheal loop is open at the merge step

The three `AGENTS.md` PRs exist because `AUTOHEAL_PROMPT` category 3 instructs the agent to file them:

> Check that AGENTS.md accurately reflects the current directory structure and file counts. If drift is found, open a PR with corrections.

The drift is real and specific. `AGENTS.md` carries a generation stamp — **"Generated: 2026-03-10 | Commit: f1ce08f"** — and a stack line reading:

> **Stack:** React 19 + Vite 7 + TypeScript 5.6+ + pnpm 10.30+ + Node 22+

Actual: **Vite 8.1.3, TypeScript ^6.0.0, pnpm 11.24.0**. Three of five claims wrong, two of them across major boundaries. Its CI/CD table additionally claims `ci.yaml` triggers on _"pushes to non-main"_ and runs a _"cross-platform matrix"_ — `ci.yaml` has neither; it triggers on `pull_request` to `main` plus `workflow_dispatch`, and every job is `ubuntu-latest`. It also references a `.lighthouseci/` directory that does not exist in the tree.

Now the closed loop. Perpetual issue **#409 (`Daily Autohealing Report`, 68 comments, body 23 KB)** carries 12 dated sections spanning 2026-08-18 → 2026-09-01. **All twelve report `AGENTS.md accuracy | ✅ Current`**, justified with rationales like _"Repo layout still matches the documented structure"_ and _"Structure and file naming still match the repo tree."_

Both halves are individually true. The layout **is** accurate. The version claims are **not** — and nothing in the check looks at them. The prompt says "directory structure and file counts"; the daemon obeys the letter and emits a green check on a file whose headline is three versions stale. The result is that the daemon's own past output (#473, #484, #523) is contradicted daily by its own present output, and a reviewer skimming #409 sees ✅ and concludes the open PRs are noise.

**Generalizable:** a narrowly-scoped check that emits a whole-artifact verdict manufactures false confidence. The check should report what it checked (`AGENTS.md structure: ✅ / AGENTS.md version claims: not checked`), or its scope should match its label. Cataloged in [[github-actions-ci]].

There is also one unverified self-report to flag: one dated section claims the run _"Added the `src/__tests__/` directory to the documented tree."_ No `src/__tests__/` exists in the tree at `89231800`, and `AGENTS.md` does not document one. Either the edit landed only in an unmerged PR, or the report describes work that was not delivered. Recorded as a contradiction, not a conclusion — the underlying run logs require authentication.

## Stale identity: the rename never finished, and a name reuse made it worse

Prior surveys recorded three stale self-references as housekeeping debt. This survey establishes that one of them is no longer merely stale — it is **confidently wrong**, and that the staleness reaches into the agent prompts.

### The build badge renders another repository's status

`README.md`'s first badge is:

```
https://img.shields.io/github/actions/workflow/status/marcusrbrown/marcusrbrown.github.io/deploy.yaml
```

`marcusrbrown/marcusrbrown.github.io` now resolves to **repo id `1174807412`** — the Pages holder for [[marcusrbrown--mrbro-dev]], a different project (see [[marcusrbrown--marcusrbrown-github-io]] for the collision record). That repo **has** a `.github/workflows/deploy.yaml` (208 runs, most recent five all `success`, latest 2026-09-01). So the badge is not broken. It resolves, it renders, and it is **green** — reporting the deploy health of an unrelated repository, updating live as that repository deploys.

A broken badge gets noticed. A green badge for the wrong repo does not. `package.json`'s `repository.url` (`https://github.com/marcusrbrown/marcusrbrown.github.io.git`) has the same defect and the same consequence for any tooling that resolves it.

This is the same defect class as the mis-pathed `uses:` at [[marcusrbrown--esphome-life]] and the `alpine_3_20` custom-manager template at [[bfra-me--ha-addon-repository]] — **syntactically valid, semantically aimed at the wrong target, and green** — with a new twist worth naming: here the wrong target was created _after_ the reference went stale. A rename leaves dangling self-references; a later reuse of the freed name silently re-binds them to a live, healthy, unrelated resource. Cataloged in [[github-actions-ci]].

### The agent is told it is reviewing a repository that no longer exists

All three prompts in `fro-bot.yaml` open the same way:

- `PR_REVIEW_PROMPT`: _"You are reviewing a pull request for **marcusrbrown.github.io** — a React 19+ / TypeScript / **Vite 7+** brand site…"_
- `MAINTENANCE_PROMPT`: _"Perform daily repository maintenance for **marcusrbrown.github.io** — … **Vite 7+**…"_
- `AUTOHEAL_PROMPT`: _"Perform daily repository autohealing for **marcusrbrown.github.io** — … **Vite 7+**…"_

`PR_REVIEW_PROMPT` further instructs _"ESLint 9+ flat config"_ (actual: ESLint 10), and `AUTOHEAL_PROMPT` categories 3 and 7 both phrase their goal as making _"marcusrbrown.github.io"_ better. The `.github/actions/setup` composite action's `description` still reads _"for the portfolio project"_ — this is the brand site; mrbro.dev is the portfolio. `.github/BRANCH_PROTECTION.md` still opens _"…for the **mrbro.dev** project"_ (flagged since 2026-06-12, unchanged).

The reviewing agent is therefore primed with a repository name that now belongs to a different project and a Vite major the repo left behind. Every version bump widens the gap, and the only mechanism that would close it — an autoheal PR — cannot merge. **Prompt text is a dependency with no dependency bot**: Renovate advanced `fro-bot/agent` eleven times in this interval and cannot see a single word of the prose it ships.

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

Shared `setup` (Setup and Cache) feeds five parallel jobs — **Lint** (ESLint + formatting check), **Build** (with build-output verification + artifact upload), **Test** (Vitest), **Type Check** (`tsc --noEmit`), **Validate** (dependency audit) — aggregated by a `quality-gate` job. Top-level `permissions: contents: read`; concurrency keyed on workflow + ref with `cancel-in-progress: true`.

Action pins as of 2026-09-01: `actions/checkout@d23441a4 # v6.1.0` (was `df4cb1c0 # v6.0.3`), `actions/upload-artifact@043fb46d # v7.0.1`, `actions/create-github-app-token@bcd2ba49 # v3.2.0`.

Three details worth recording:

- **The Lint job runs the fixer, then fails on the diff.** `pnpm run lint` (ESLint) followed by `pnpm run fix` + `git diff --exit-code` — formatting is enforced by attempting the auto-fix in CI and rejecting if it changed anything.
- **`Validate Dependencies` runs `pnpm audit --audit-level moderate` as a hard gate.** This is the reason the `pnpm-workspace.yaml` override ledger exists and keeps growing — the overrides are there to keep the audit green. Same construction as [[marcusrbrown--mrbro-dev]]'s ledger + audit gate.
- **`quality-gate` mints a GitHub App token with `pull-requests: write` and comments `"✅ All CI checks passed! Ready for review."` on every PR.** The six open Fro Bot PRs each carry that comment. The repo is, literally, telling itself a PR is ready for review and then not reviewing it for 56 days.

### Deploy (`deploy.yaml`)

Push-to-`main` pipeline: checkout → `./.github/actions/setup` → `actions/configure-pages@45bfe019 # v6.0.0` → `pnpm run lint` → `pnpm run build` → `actions/upload-pages-artifact@fc324d35 # v5.0.0` → `actions/deploy-pages@cd2ce8fc # v5.0.0`. Custom domain `marcusrbrown.com` served via `public/CNAME`. `concurrency: pages`, `cancel-in-progress: false`.

Note the shape: deploy re-runs `lint` (already green pre-merge) but **never runs `pnpm test`**. 488 deploy runs to date — the site rebuilds and redeploys on every dependency merge, so a landing page whose content has not changed in a month has redeployed dozens of times this interval.

### Shared Setup Action (`.github/actions/setup/`)

Composite action: pnpm install via `pnpm/action-setup@0977fd99 # v6.0.10` (was `0ebf4713 # v6.0.9`), Node via `actions/setup-node@24997072 # v6.5.0` (default **Node 22**), `pnpm install --frozen-lockfile`, and opt-in Playwright browser install cached by `actions/cache@caa29612 # v5.1.0` keyed on the resolved `@playwright/test` version. Exposes `node-version` / `cache-hit` / `playwright-version` / `playwright-cache-hit`. Used by every workflow.

**The E2E suite never runs in CI.** `install-playwright` defaults to `'false'`, and the only caller that sets it true is `fro-bot.yaml` (autoheal runs only). `ci.yaml`, `deploy.yaml`, and `copilot-setup-steps.yaml` all invoke the setup action with no `with:` block. So `tests/e2e/scroll-reveal.spec.ts` and `playwright.config.ts` are configured, documented in AGENTS.md and TESTING.md, exercised by `pnpm test:e2e` locally — and executed by no gate. Same shape as the long-flagged `lhci.config.js`-without-a-workflow gap: **the config exists, the runner does not.** Two of the repo's three declared test tiers (E2E, Lighthouse) have no CI actuator; only Vitest does.

## Fro Bot Integration

**Fro Bot workflow is present and active** — `fro-bot/agent@26fdb0b5b9a30aa9641a60cce99fe5d53af320c7 # v0.107.0` (2026-08-31), up from `v0.96.0` at 2026-08-03 and `v0.87.1` at 2026-07-13.

**This repo is the fleet's fastest agent adopter, and it is now measurable.** `fro-bot/agent` published `v0.107.0` at 2026-08-31T04:22:09Z; the bump merged here at **04:42** — a **20-minute lag from upstream release to merged pin**. Eleven agent bumps landed in this interval alone (#511 → #542: v0.96.1, .2, .3, v0.97.0, v0.98.2, .3, .5, v0.99.0, v0.100.0, v0.101.0, v0.103.0, v0.104.0, v0.105.1, v0.106.0, v0.106.1, v0.107.0). The contrast inside one ecosystem is stark: [[bfra-me--ha-addon-repository]] is pinned at v0.43.1 with its bump PR unreviewed since 2026-05-17 (~64 minors behind, autoheal dead); this repo is at HEAD within the hour.

The single-file three-mode `fro-bot.yaml` (625 lines, 29 KB), `30 3` / `30 15` UTC crons, and `default: autoheal` dispatch are all unchanged. `fro-bot.yaml` changed by exactly **one line** across 32 commits — the agent pin.

### Daemon health

Unlike [[bfra-me--ha-addon-repository]], **the scheduled daemon here is alive**: 288 `schedule`-triggered runs, and of the 20 most recent only one concluded `failure` (2026-08-29T03:33). Both crons fire (03:3x and 15:3x UTC, with the usual GitHub scheduler drift). The workflow has 2,445 total runs.

The daemon is not the failure point in this repo. The failure point is downstream of it: it observes correctly, files correctly, and nothing it files gets merged.

### Workflow hardening (predates this survey; not previously recorded)

The `fro-bot.yaml` job carries guards the prior page did not capture. These were already present at `3b863c9` — the one-line diff confirms it — so they are page-completeness, not new behavior:

- **`Validate review mode inputs`** — hard-fails a `workflow_dispatch` with `mode=review` and a blank/whitespace prompt (`::error::Review mode requires a custom prompt`). Same guard recorded at [[bfra-me--renovate-action]].
- **`Refuse fork PR heads from comment triggers`** — on `issue_comment` against a PR, queries `.head.repo.fork` and hard-fails unless it is exactly `false`, treating `unknown` as unsafe. Fail-closed.
- **`Detect Sunday UTC for category 8 cadence`** — preflight setting `IS_SUNDAY_UTC` so the Upstream Modernization Watch category runs weekly without a third cron.
- **Checkout hardening** — `persist-credentials: false`, `fetch-depth: 0`, explicit `ref` resolution, `FRO_BOT_PAT`.
- **Conditional dependency install** — `install-dependencies` and `install-playwright` are computed expressions, true only for autoheal-cron / autoheal-dispatch (and `install-dependencies` also for `pull_request`). The maintenance run deliberately skips `pnpm install`.
- **Comment-trigger author gating** — `@fro-bot` mentions honored only from `OWNER`/`MEMBER`/`COLLABORATOR` author associations, with a self-mention exclusion.

### Cross-project intelligence targets are partly unreachable

`AUTOHEAL_PROMPT` category 7 names seven focus repos to survey each run. Two do not resolve cleanly:

- **`marcusrbrown/mrbro.dev` returns HTTP 301** — renamed to `marcusrbrown/marcusrbrown.github.io`. `gh` follows redirects, so this works but is stale, and it is the _third_ place in this repo where the two site projects' names are crossed.
- **One focus-repo entry is not publicly resolvable (HTTP 404 unauthenticated).** Name withheld per the wiki's public-only invariant, consistent with the handling on [[marcusrbrown--renovate-config]]. Whether the workflow's `FRO_BOT_PAT` can read it is unverified from here.

The remaining five (`tokentoilet`, `vbs`, `renovate-config`, `marcusrbrown/.github`, `fro-bot/agent`) resolve HTTP 200.

### The two daily reports disagree about security visibility

Both reports come from the same workflow, same `FRO_BOT_PAT`, one cron apart:

- **#409 (autoheal, 2026-09-01):** `security alerts unavailable | N/A | Skipped; CLI/token scope does not expose Dependabot alert data.`
- **#260 (maintenance, 2026-08-31):** `Security alerts | 0 open Dependabot; code scanning data unavailable`

One of these is wrong, and neither escalates the disagreement. The autoheal run's category 2 (SECURITY) has therefore been a **permanent no-op** — it skips on "unavailable" every run — while the maintenance run reports a clean bill from data the autoheal run claims it cannot see. Recorded as an open contradiction; resolving it requires authenticated access.

### Production Site Review is degrading

Category 5 drives `npx agent-browser` against the live site. Issue **#517** (`CONTACT nav anchor does not reach #contact`, opened 2026-08-09, labelled `bug`, 0 comments) is a textbook category-5 finding, complete with a reproduction (`agent-browser wait --url "**/#contact"` timed out twice) and a screenshot path. The capability works.

But across the 12 dated sections in #409, the string `agent-browser unavailable` appears **17 times**, and the most recent run (2026-09-01) skipped **all five** sections (`/`, `#about`, `#experience`, `#skills`, `#contact`) on that basis. The prompt's `Do not fail the workflow` escape hatch is doing its job — the run stays green — which is exactly why an eroding capability produces no signal. Meanwhile #517, the one finding it did produce, has sat untouched for 23 days.

- **Single-file three-mode design:** review / maintenance / autoheal run from one `fro-bot.yaml` (29 KB) dispatched by event + `inputs.mode` (default `autoheal`), not split into a separate `fro-bot-autoheal.yaml`. This architecture was adopted 2026-05-14 (PR #407 under the old name) and holds.
- **Triggers:** PR events, issue/comment `@fro-bot` mentions, two daily crons (`AUTOHEAL_CRON '30 3 * * *'`, `MAINTENANCE_CRON '30 15 * * *'` UTC), manual dispatch with `mode` + optional `prompt`.
- **Review prompt:** React 19 patterns, TypeScript strictness (no `any` / `@ts-ignore` / `@ts-expect-error`), pure ESM, accessibility (WCAG), performance budgets, `.yaml` extension convention; PASS / CONDITIONAL / REJECT verdict format.
- **Autoheal prompt (8 categories):** Errored PRs, Security, Code Quality & Repo Hygiene, Developer Experience, Production Site Review, Quality Gates Verification, Cross-Project Intelligence, Upstream Modernization Watch (Sundays UTC).

## Developer Tooling

- **Renovate:** extends `github>marcusrbrown/renovate-config#5.2.12` (was `#5.2.10` on 2026-08-03, `#5.2.4` on 2026-07-13; see [[marcusrbrown--renovate-config]] — `5.2.12` is the preset's current latest) + `:preserveSemverRanges` + `group:allNonMajor`. Post-upgrade tasks: `pnpm install`, `pnpm run build`, `pnpm run fix` (×2), `executionMode: branch`. Runs via the `bfra-me/.github` reusable workflow, bumped **v4.16.44 → v4.23.0** this interval.
- **Security-override ledger:** `pnpm-workspace.yaml` carries **exactly 16** GHSA-style version overrides (`@isaacs/brace-expansion`, `ajv`, `basic-ftp`, `brace-expansion 5.0.9`, `fast-uri 3.1.6`, `js-yaml`, `lodash-es`, `mdast-util-to-hast`, `minimatch`, `postcss 8.5.26`, `picomatch`, `qs`, `rollup`, `tmp`, `vite >=7.3.5`, `ws`) plus an `allowBuilds` allowlist (`@swc/core`, `esbuild`, `simple-git-hooks`, `unrs-resolver`) and `shamefullyHoist: true`. _(Page-completeness correction: prior surveys recorded "~15" then "~17"; the enumerated list has been these same 16 entries since 2026-08-03. The count did not grow this interval — only `fast-uri 3.1.4 → 3.1.6` and `postcss 8.5.25 → 8.5.26` moved.)_
- **Dead ledger entry after the Vite major:** the override `vite@>=7.0.0 <=7.3.4: '>=7.3.5'` is scoped to the Vite 7 range on a project that now runs Vite **8.1.3**. It can only ever match a transitive v7 resolution. Security-override ledgers accumulate; nothing prunes them when the constrained dependency crosses a major, and `pnpm audit` staying green gives no signal either way.
- **Split-brain persists, unchanged:** `package.json` still retains a legacy `pnpm.overrides` pair (`fast-uri: ">=3.1.2"`, `flatted: ">=3.4.2"`), and `fast-uri` remains _double-declared_ — a floor range in `package.json` and a hard pin (`3.1.6`) in `pnpm-workspace.yaml`. Renovate keeps the workspace pin current and leaves the `package.json` floor alone, so the two ledgers drift a little further with each bump. The three PRs written to resolve it (**#471**, **#462**, **#478**) are the mutually-incompatible trio described above, all still open, now 49–56 days old. `fast-uri` v4 sits parked on the dashboard behind an unchecked approval box.
- **Renovate flags `vitest-axe` as an abandoned dependency** (Dependency Dashboard #6, `abandonmentThreshold` detection; npm `latest` is **0.1.0 published 2022-10-21**). `vitest-axe` is this repo's **entire accessibility test surface** — `src/test-setup.ts` extends Vitest with its matchers, AGENTS.md names `toHaveNoViolations()` as the a11y convention, and the Fro Bot review prompt enforces WCAG 2.1 AA. An accessibility-first repo's a11y assertion library is pre-1.0 and ~46 months without a release. Precisely the shape recorded at [[bfra-me--ha-addon-repository]], where the abandoned dependency was `creyD/prettier_action` — the entire Prettier gate. **Two repos, same pattern: the abandoned dependency is disproportionately the one that owns a whole quality gate**, because gate libraries are small and single-purpose, so release inactivity is indistinguishable from being finished.
- **`osv.dev` reports zero CVEs** for this repo while the 16-entry override ledger exists to satisfy `pnpm audit --audit-level moderate` (GitHub Advisory Database). The two vulnerability sources disagree by construction; the ledger is calibrated to the one that gates CI.
- **Git hooks:** simple-git-hooks + lint-staged running `eslint --fix` on staged `js,jsx,ts,tsx,json,css,md,yaml`.
- **AGENTS.md / TESTING.md:** root-level code map and dedicated testing docs.
- **Copilot instructions:** `.github/copilot-instructions.md`.
- **Lighthouse:** `lhci.config.js` present at root; still no dedicated Lighthouse workflow (invoked from CI or autoheal Production Site Review).

## Notable Patterns and Conventions

- **No routing:** single-page with anchor links, no React Router.
- **Pure ESM, no default exports, strict TS** (carried from AGENTS.md conventions).
- **SWC over Babel** (`@vitejs/plugin-react-swc`).
- **Accessibility-first:** `vitest-axe` matchers; two live a11y/UX autoheal findings sit open and untouched — #465 ("Homepage lacks footer landmark", 2026-07-08) and #517 ("CONTACT nav anchor does not reach #contact", 2026-08-09). Both were found by the daemon; neither has a comment.
- **Stale self-references (now four, one actively misleading):** `package.json` `repository.url`, the README build badge (**green, pointing at a different repository**), `BRANCH_PROTECTION.md`'s "mrbro.dev project" header, the `.github/actions/setup` description ("for the portfolio project"), and all three `fro-bot.yaml` prompts. See [Stale identity](#stale-identity-the-rename-never-finished-and-a-name-reuse-made-it-worse).
- **Observability without an actuator:** #260 (`Daily Maintenance Report`, 171 comments, body 44.8 KB) correctly lists all six stale PRs and both stale issues, every day, with links and recommended actions. The reporting layer is accurate and well-maintained. Nothing consumes it.

## Gaps (relative to other Marcus repos)

- **No Probot `settings.yml`:** confirmed again at `89231800` — `.github/` holds `ACTIONS.md`, `BRANCH_PROTECTION.md`, `copilot-instructions.md`, `renovate.json5`, `actions/`, `workflows/` and nothing else. Branch protection here is governed by **`scripts/configure-branch-protection.mjs` plus a prose doc** (`.github/BRANCH_PROTECTION.md`, 7.1 KB) rather than a declarative Probot manifest — an imperative, run-once alternative with no drift detection and no artifact any lint can diff. Contrast [[marcusrbrown--marcusrbrown]], which used `settings.yml` to make `Fro Bot` a _required_ status check with `enforce_admins: true`. See [[probot-settings]]. Durable across all surveys under both slugs.
- **No CodeQL/Scorecard:** no security-scanning workflows. `pnpm audit` in `ci.yaml` is the only automated security gate. Contrast [[fro-bot--dashboard]], which closed this parity gap in-repo.
- **`lhci.config.js` without a workflow:** performance config present (3.3 KB), no dedicated Lighthouse CI job. AGENTS.md additionally references a `.lighthouseci/` directory that does not exist.
- **Playwright E2E without a workflow:** `playwright.config.ts` + `tests/e2e/scroll-reveal.spec.ts` are never executed by CI (see Shared Setup Action above).
- **No automerge for agent-authored PRs:** the single highest-leverage gap. Everything the daemon finds is correct; nothing it proposes lands.

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-09-01 | `89231800` | **Third survey. No structural change; the interval is a controlled experiment in merge governance.** 32 commits, **100% `mrbro-bot[bot]` Renovate automerges**, 7 files touched (6 pure version tokens + lockfile), **zero `src/` changes, zero human commits**. Deltas: Fro Bot agent **v0.96.0 → v0.107.0** (`26fdb0b5`, **20 minutes** behind upstream release — fleet's fastest adopter), `bfra-me/.github` reusable **v4.16.44 → v4.23.0**, Renovate preset `#5.2.10 → #5.2.12`, pnpm `11.18.0 → 11.24.0`, `pnpm/action-setup` v6.0.9 → v6.0.10, `actions/checkout` v6.0.3 → v6.1.0, `@bfra.me/eslint-config` ^0.51.0 → ^0.52.0. Override ledger **flat at 16** (only `fast-uri 3.1.4→3.1.6`, `postcss 8.5.25→8.5.26`). **Headline: two merge realities sorted by authorship** — 32 Renovate PRs merged same-day vs **6 `fro-bot` PRs open 18–56 days, all green, all `updated_at` ≈ creation + 70s**; the six are really two contested files (`AGENTS.md` ×3, `package.json` ×3, the latter mutually incompatible). **Dedup clause failed**: #473 and #523 are byte-identical proposals 32 days apart on differently-named branches. **The autoheal loop is open at the merge step** — `AUTOHEAL_PROMPT` category 3 files AGENTS.md-drift PRs while #409 reports `AGENTS.md accuracy ✅ Current` **12 dated sections running**, because the check reads only "structure and file naming" and never the Stack line (`Vite 7 / TS 5.6+ / pnpm 10.30+` vs actual `8.1.3 / ^6 / 11.24.0`, plus a nonexistent "cross-platform matrix" and `.lighthouseci/`). **The README build badge is green and points at a different repository** — `marcusrbrown/marcusrbrown.github.io` (id `1174807412`, the [[marcusrbrown--mrbro-dev]] Pages holder, 208 deploy runs, latest success 2026-09-01); a rename left the reference dangling and a name reuse re-bound it to a live healthy resource. All three `fro-bot.yaml` prompts still say "marcusrbrown.github.io … Vite 7+"; setup action still says "portfolio project". Daemon **healthy** (288 scheduled runs, 1 failure in last 20) — unlike [[bfra-me--ha-addon-repository]]. New findings: E2E + Lighthouse configured but never run by any workflow; `vitest-axe` (the whole a11y surface) flagged **abandoned**, npm latest `0.1.0`/2022-10-21; **7 approval-gated majors parked** on dashboard #6 (incl. `fast-uri` v4, `typescript` v7); dead `vite@>=7.0.0 <=7.3.4` ledger entry post-major; `quality-gate` comments "Ready for review" on PRs that sit 56 days; autoheal vs maintenance reports **contradict each other on Dependabot alert visibility**; `agent-browser unavailable` 17× (Production Site Review eroding); one cross-project focus repo unresolvable (name withheld, public-only invariant), `marcusrbrown/mrbro.dev` 301s. Open issues 5 → 6 (new #517 CONTACT-anchor `bug`), open PRs 5 → 6. Gaps unchanged: no Probot `settings.yml` (branch protection is imperative via `scripts/configure-branch-protection.mjs`), no CodeQL/Scorecard. Fro Bot present — no onboarding PR needed. |
| 2026-08-03 | `3b863c9` | Re-survey. Fro Bot agent **v0.87.1 → v0.96.0** (`c29ac29`); single-file three-mode design + `30 3`/`30 15` crons hold. **Vite 7 → 8 major** (`8.1.3`); `@types/node` 22 → **^24** (now ahead of the Node `>=22` engine floor); pnpm within-major `11.11.0 → 11.18.0`. Renovate preset `#5.2.4 → #5.2.10`. Override ledger grew to ~17 entries (added `fast-uri 3.1.4`, `postcss 8.5.25`); `fast-uri` now double-declared across `package.json` + `pnpm-workspace.yaml` — split-brain sharper, PRs #471/#462/#478 all still open/unmerged. Open issues 5 (#465/#411/#409/#260/#6), open PRs 5 (#484/#478/#473/#471/#462). Stale self-references (`repository.url`, README badge, `BRANCH_PROTECTION.md`) unchanged. Gaps unchanged: no Probot `settings.yml`, no CodeQL/Scorecard, `lhci.config.js` still workflow-less. Fro Bot present — no onboarding/draft PR needed. |
| 2026-07-13 | `3895522` | **First survey under the `marcusrbrown.com` slug.** Confirmed rename from `marcusrbrown.github.io` (repo id `1021912280`, created 2025-07-18; issue set #411/#409/#260/#6 carried forward; stale `repository.url` + README badge). A _different_ repo now holds the `marcusrbrown.github.io` name (id `1174807412`, homepage mrbro.dev). Fro Bot agent v0.61.0 → **v0.87.1** (`32dca3d`), single-file three-mode design and `30 3`/`30 15` crons hold. **pnpm 10 → 11 major** (11.11.0, `engines ^11.8.0`). Renovate preset `#5.2.1` → `#5.2.4`. `pnpm-workspace.yaml` override ledger grew to ~15 entries + `allowBuilds`; legacy `package.json` overrides (fast-uri/flatted) persist — PRs #471/#462 churning the reconciliation. New a11y issue #465. Gaps unchanged: no Probot `settings.yml`, no CodeQL/Scorecard. Prior history (2026-04-25 → 2026-06-23) recorded on [[marcusrbrown--marcusrbrown-github-io]] under the former name. |
