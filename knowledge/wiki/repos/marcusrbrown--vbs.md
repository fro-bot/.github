---
type: repo
title: "marcusrbrown/vbs"
created: 2026-04-18
updated: 2026-06-10
sources:
  - url: https://github.com/marcusrbrown/vbs
    sha: abe4998fdd597743219edf5c0249b71cc00c9e56
    accessed: 2026-06-10
  - url: https://github.com/marcusrbrown/vbs
    sha: 69db16a73245372a9a1b1c6c32d0a70fd0a22185
    accessed: 2026-05-29
  - url: https://github.com/marcusrbrown/vbs
    sha: b3c415bc4e0e25dd4e5ca8ccdc5ae7aaac9cbdec
    accessed: 2026-05-07
  - url: https://github.com/marcusrbrown/vbs
    sha: dd10e052347b5488dc09cd0d18391d67f1c21bb7
    accessed: 2026-04-25
  - url: https://github.com/marcusrbrown/vbs
    sha: a552e7335af70122f68380440c78a415a785749f
    accessed: 2026-04-18
tags: [typescript, vite, star-trek, viewing-guide, local-first, d3, github-pages, functional-architecture]
aliases: [vbs, view-by-stardate]
related:
  - github-actions-ci
  - marcusrbrown--tokentoilet
  - marcusrbrown--systematic
  - marcusrbrown--renovate-config
---

# marcusrbrown/vbs

**VBS (View By Stardate)** — a local-first, chronological Star Trek viewing guide web application. TypeScript + Vite + D3.js, deployed to GitHub Pages. Uses a functional factory architecture with closure-based state management and generic EventEmitters.

## Overview

- **Purpose:** Interactive Star Trek chronological viewing guide with progress tracking
- **Default branch:** `main`
- **Created:** 2025-07-18
- **Last push:** 2026-06-07 (as of 2026-06-10 survey)
- **Homepage:** https://marcusrbrown.github.io/vbs/
- **License:** MIT (declared in package.json; no LICENSE file observed at root)
- **Topics:** `star-trek`, `viewing-guide`, `chronological`, `progress-tracker`, `local-first`
- **Package manager:** pnpm 10.34.1 (as of 2026-06-10; previously 10.33.4)
- **Node.js:** 22.x

## Tech Stack

| Layer             | Technology                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| Language          | TypeScript 5.9 (strict mode, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports`) |
| Build             | Vite 7.x (base `/vbs/`, source maps, manual chunk for data module)                |
| Runtime           | Vanilla TS — no framework, functional factories with closures                     |
| Visualization     | D3 7.x (production dependency)                                                    |
| Testing           | Vitest 4.x + jsdom + `@vitest/coverage-v8` + `@vitest/ui`                         |
| Linting           | ESLint 9.x via `@bfra.me/eslint-config` + Prettier via `@bfra.me/prettier-config` |
| TypeScript config | Extends `@bfra.me/tsconfig`                                                       |
| Git hooks         | `simple-git-hooks` + `lint-staged`                                                |
| Env management    | `dotenv` for optional API keys (TMDB)                                             |

## Architecture

### Functional Factory Pattern

The codebase enforces a strict **no-class** policy. All state management uses closure-based factories that return public API objects. Key constraints:

- No `this` binding — closures eliminate context issues
- No `any` / `@ts-ignore` / `@ts-expect-error`
- All imports use `.js` extensions for ESM resolution
- Components must provide `destroy()` for listener cleanup
- CSS custom properties use `--vbs-` prefix; no inline styles
- Error handling via `withErrorHandling()` (async) / `withSyncErrorHandling()`

### Generic EventEmitter

Type-safe event system using `createEventEmitter<TEventMap>()`. Event map types are centralized in `src/modules/types.ts`.

### Data Model

Star Trek content organized as 7 chronological eras (22nd–32nd century), each containing `StarTrekItem` entries (series, movies, animated). Items have IDs, types, and stardate ranges.

- Episode ID pattern: `/^[a-z]+_s\d+_e\d+$/`
- Season ID pattern: `/^[a-z]+_s\d+$/`
- Series ID pattern: `/^[a-z]+(?:_s\d+)?$/`

### Data Generation Pipeline

An automated pipeline (`scripts/generate-star-trek-data.ts`) aggregates metadata from TMDB, Memory Alpha, TrekCore, and STAPI. Quality scoring (minimum 0.6) validates completeness. Runs weekly via the `update-star-trek-data.yaml` workflow, which creates PRs for data changes using `peter-evans/create-pull-request`.

## Repository Structure

```
vbs/
├── src/
│   ├── main.ts                  # Application entry factory
│   ├── style.css                # Global Star Trek theme
│   ├── data/
│   │   └── star-trek-data.ts    # Comprehensive dataset (~570 lines)
│   ├── modules/                 # Core business logic (28 files)
│   │   ├── types.ts             # Central type definitions + event maps
│   │   ├── progress.ts          # Progress tracking factory
│   │   ├── search.ts            # Search/filtering factory
│   │   ├── timeline.ts          # Timeline rendering factory
│   │   ├── storage.ts           # Import/export functionality
│   │   ├── events.ts            # EventEmitter implementation
│   │   ├── episode-tracker.ts   # Episode-level tracking
│   │   ├── episodes.ts          # Episode data module
│   │   ├── error-handler.ts     # Error boundary utilities
│   │   ├── external-api-types.ts # External API type definitions
│   │   ├── logger.ts            # Structured logging
│   │   ├── preferences.ts       # User preferences
│   │   ├── progress-validation.ts # Progress data validation
│   │   ├── themes.ts            # Theme management
│   │   ├── settings-manager.ts  # Settings UI
│   │   ├── metadata-*.ts        # Metadata enrichment subsystem (5 files)
│   │   ├── streaming-api.ts     # Streaming availability
│   │   ├── cache-warming.ts     # Cache pre-population
│   │   ├── conflict-resolution.ts
│   │   ├── migration.ts         # Data migration
│   │   ├── version-manager.ts   # Version tracking
│   │   └── timeline-viz.ts      # D3 timeline visualization
│   ├── components/              # UI components (12 .ts + 12 .css)
│   │   ├── metadata-*.ts/css    # Metadata UI components
│   │   ├── streaming-*.ts/css   # Streaming UI components
│   │   ├── timeline-*.ts/css    # Timeline visualization controls
│   │   └── migration-progress.ts
│   └── utils/
│       ├── composition.ts       # Functional composition (pipe, compose, curry, tap)
│       ├── download.ts          # Download utilities
│       ├── geographic.ts        # Geographic utilities
│       ├── metadata-validation.ts
│       └── index.ts
├── test/                        # Vitest test suite
├── scripts/                     # CLI tools (data generation, validation)
├── docs/                        # Documentation + ADRs
├── public/                      # Static assets
├── .ai/                         # AI context files
├── .github/
│   ├── workflows/               # 7 workflow files (was 8 — fro-bot-autoheal.yaml folded into fro-bot.yaml on 2026-05-14, PR #564)
│   ├── actions/                 # Custom actions (setup-pnpm)
│   ├── agents/                  # Agent definitions (data-curator)
│   └── settings.yml             # Probot settings
├── AGENTS.md                    # Root AI development conventions
├── viewing-guide.md             # Content reference
└── llms.txt                     # LLM context file
```

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main` | Lint, type-check, test with coverage, build |
| Deploy | `deploy.yaml` | push to `main`, dispatch | Build + deploy to GitHub Pages |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (daily 15:30 UTC + 03:30 UTC autoheal), dispatch | PR review, daily maintenance, autoheal (single workflow as of 2026-05-14, PR #564; single unified job as of 2026-05-30, PR #594) |
| ~~Fro Bot Autoheal~~ | ~~`fro-bot-autoheal.yaml`~~ | _Removed 2026-05-14 (PR #564) — folded into `fro-bot.yaml` with `mode` dispatch input (`review`/`maintenance`/`autoheal`/`both`)_ | _historical_ |
| Update Star Trek Data | `update-star-trek-data.yaml` | weekly Monday 09:00 UTC, dispatch | Regenerate data from external sources, validate, create PR |
| Renovate | `renovate.yaml` | — | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | — | Probot settings sync |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | — | GitHub Copilot agent environment |

### CI Jobs (ci.yaml)

1. **Test** — checkout → setup pnpm → lint → type-check → test with coverage → upload to Codecov
2. **Build** — checkout → setup pnpm → build → upload artifact (7-day retention)

### Branch Protection

Required status checks on `main`: Build, Fro Bot, Renovate / Renovate, Test. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Fro Bot Integration

**Fro Bot workflow is present and active** (`fro-bot.yaml`). As of 2026-06-10 survey: agent `v0.55.4` (was `v0.46.0` at 2026-05-29 — see Survey History for the version trail). As of 2026-05-14 (PR #564) the separate `fro-bot-autoheal.yaml` was folded into a single `fro-bot.yaml` with operating modes routed by `workflow_dispatch.inputs.mode` and dual cron schedules (`30 3 * * *` autoheal, `30 15 * * *` maintenance). PR #594 (2026-05-30, Fro Bot-authored) completed the consolidation into a **unified single-job workflow**: the separate `fro-bot-autoheal` job was removed, the `both` mode was dropped (modes are now `review` | `maintenance` | `autoheal`, default `autoheal`), concurrency for schedule triggers now keys on `github.event.schedule` (the actual cron string) instead of a hardcoded string, and a fork-PR-head guard was added at the job `if` level (skips fork PRs and bot-authored PRs). PR #593 (2026-05-30, Marcus-authored) added `opencode-config` to job secrets. This mirrors the consolidation pattern landed in [[marcusrbrown--systematic]] (#446), [[marcusrbrown--marcusrbrown-github-io]], and `marcusrbrown/marcusrbrown` / [[marcusrbrown--tokentoilet]], and is the dominant Fro Bot workflow shape across the ecosystem now.

### PR Review

Triggers on `opened`, `synchronize`, `reopened`, `ready_for_review`, `review_requested`. Custom review prompt focuses on:

- Correctness, security, breaking changes to factory APIs
- VBS-specific violations (missing `.js` extensions, `any` usage, class patterns, `this` binding, missing `destroy()`, inline styles, missing event map types)
- Structured review output: Verdict (PASS/CONDITIONAL/REJECT), Blocking issues, Non-blocking concerns, Missing tests, Risk assessment

### Daily Maintenance

Scheduled at 15:30 UTC daily. Maintains a rolling "Daily Maintenance Report" issue with metrics, stale issues/PRs, unassigned bugs, and recommended actions. 14-day rolling window with historical summary compression.

### Daily Autoheal

Scheduled at 03:30 UTC daily. Originally ran via a separate `fro-bot-autoheal.yaml` (removed 2026-05-14, PR #564) and then a separate job within `fro-bot.yaml` (removed 2026-05-30, PR #594); now routed through the single unified `fro-bot` job. Five-category sweep:

1. Errored PRs — diagnose and fix failing CI on open PRs
2. Security — remediate Dependabot/Renovate security alerts
3. Code quality — build, test coverage, stale TODOs, convention compliance, AGENTS.md drift
4. Developer experience — lint fixes
5. Data quality — validate Star Trek dataset integrity

Hard boundaries: no force-push, no direct commits to main, no merging PRs, no disabling tests to pass checks.

### Mention-triggered

Responds to `@fro-bot` mentions in issue/PR/discussion comments from OWNER/MEMBER/COLLABORATOR.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.1` (as of 2026-06-10; was `#5.2.0` at 2026-05-29, `#4.5.9` before that) + `group:allNonMajor`. Post-upgrade tasks run `pnpm install` + `pnpm fix`. Rebase when behind base branch.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` — confirms membership in the Fro Bot-managed ecosystem.
- **Git hooks:** `simple-git-hooks` runs `lint-staged` on pre-commit. Lint-staged runs `eslint --fix` on TS/JS/CSS/MD/JSON/YAML files.
- **AI context:** Root `AGENTS.md`, `src/modules/AGENTS.md`, `src/components/AGENTS.md`, `.ai/` directory, `llms.txt`, `.github/copilot-instructions.md`, `.github/agents/` (data-curator agent).
- **pnpm workspace:** Single-package workspace with `autoInstallPeers`, `shamefullyHoist`, `shellEmulator` enabled.
- **Environment:** Optional TMDB API key via `.env` for metadata enrichment scripts.

## Notable Patterns

- **No framework:** Pure TypeScript with functional factories — deliberate avoidance of React/Vue/Svelte. State lives in closures, not component trees.
- **Comprehensive metadata subsystem:** 6 metadata modules + 6 metadata UI components for enrichment from external sources (TMDB, Memory Alpha, TrekCore, STAPI).
- **Functional composition utilities:** `src/utils/composition.ts` provides `pipe()`, `compose()`, `curry()`, `tap()`, `asyncPipe()`, `asyncCompose()` — a mini FP library embedded in the project.
- **Generic storage adapters:** Type-safe `StorageAdapter<T>` interface with `LocalStorageAdapter` implementation; designed for future IndexedDB migration.
- **D3 timeline visualization:** `timeline-viz.ts` module + `timeline-controls.ts` component for interactive chronological visualization.
- **Streaming availability layer:** `streaming-api.ts` module with UI components for Paramount+/Netflix availability.
- **Data-curator agent:** Dedicated `.github/agents/data-curator.agent.md` for Star Trek data management via Copilot agents.
- **Aggressive autoheal:** The autoheal configuration (originally `fro-bot-autoheal.yaml`, now a mode of the unified `fro-bot.yaml` as of PR #594) is one of the most comprehensive automated maintenance configurations in the ecosystem, covering 5 categories with detailed output formatting.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `a552e73` | Initial survey — full page created |
| 2026-04-25 | `dd10e05` | Incremental — 7 Renovate commits, agent bump v0.40.2 → v0.41.4, no structural changes |
| 2026-05-07 | `b3c415b` | Incremental — 15 Renovate commits, agent bump v0.41.4 → v0.42.8, Renovate preset #4.5.8 → #4.5.9 |
| 2026-05-29 | `69db16a` | Workflow consolidation (PR #564), Renovate preset v4.5.9 → v5.2.0 (#567), multi-track timeline merged (#458), data-automation stabilization (#574), agent v0.42.8 → v0.46.0, backlog cleared |
| 2026-06-10 | `abe4998` | Single-job workflow unification (PR #594), opencode-config secret (#593), agent v0.46.0 → v0.55.4, Renovate preset v5.2.0 → v5.2.1, pnpm 10.34.1, rest is Renovate cadence |

### 2026-06-10 Delta (SHA `69db16a` → `abe4998`)

28 commits over 9 days. Two structural CI commits on 2026-05-30; everything else is Renovate-authored (`mrbro-bot[bot]`) dependency cadence. No application code changes.

**Structural changes (non-Renovate):**

- **Unified single-job Fro Bot workflow (PR #594, `8b1e7ae`, 2026-05-30, Fro Bot-authored):** Completes the consolidation started in PR #564. The separate `fro-bot-autoheal` job inside `fro-bot.yaml` was removed; autoheal logic now routes through the single `fro-bot` job via schedule/mode-based `PROMPT` dispatch. The `both` dispatch mode was dropped (`review` | `maintenance` | `autoheal`, default `autoheal`). Concurrency for schedule triggers now keys on `github.event.schedule` rather than a hardcoded string. A fork-PR / bot-author guard was added at the job `if` level. Autoheal prompt expanded with strategies ported from sibling repos. Explicitly matches the pattern in `marcusrbrown/marcusrbrown` and [[marcusrbrown--tokentoilet]].
- **opencode-config secret (PR #593, `4bacf6b`, 2026-05-30, Marcus-authored):** Adds `opencode-config` to the Fro Bot job secrets — the only human-authored commit in the delta.

**Renovate / dependency cadence:**

- **`fro-bot/agent` version trail:** v0.46.0 → v0.46.1 (#591) → v0.48.0 (#597) → v0.49.0 (#600) → v0.50.0 (#601) → v0.51.0 (#603) → v0.52.0 (#604) → v0.52.1 (#605) → v0.53.1 (#609) → v0.54.1 (#610) → v0.54.2 (#611) → v0.55.0 (#612) → v0.55.2 (#614) → v0.55.3 (#615) → v0.55.4 (#616). Fifteen bumps in 9 days — tracking upstream agent releases at full cadence.
- **Renovate preset:** `marcusrbrown/renovate-config#5.2.0` → `#5.2.1`.
- **pnpm:** 10.33.4 → 10.34.1 (#595).
- **vite:** pinned to 7.3.2 (#577, the long-open PR finally merged 2026-05-30) → 7.3.3 (#596) → 7.3.5 (#608).
- **bfra-me tooling pins advanced:** `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9, `@bfra.me/tsconfig` 0.13.1.
- **`bfra-me/.github` reusable workflows:** → v4.16.23 (#606). `actions/checkout` → v6.0.3 (#602).

**Activity shape (as of 2026-06-10):**

- **Open PRs:** 0 (down from 1) — #577 merged. Clean PR surface.
- **Open issues:** 13 (down from 14). Steady state.
- **Star count:** 1.
- **No license file at root** (still — only `license: MIT` in `package.json`). Carried forward; no contradiction.
- Repository remains in maintenance/dependency autopilot mode aside from the CI consolidation work.

### 2026-05-29 Delta (SHA `b3c415b` → `69db16a`)

32 commits over 22 days. The maintenance-mode lull from prior surveys broke — three human/Copilot-authored feature/ci commits landed, the data-PR backlog cleared, and two significant structural changes shipped.

**Structural changes (non-Renovate):**

- **Fro Bot workflow consolidation (PR #564, `67d30b2`, 2026-05-14, authored by Fro Bot):** `fro-bot.yaml` + `fro-bot-autoheal.yaml` merged into a single `fro-bot.yaml` with `workflow_dispatch.inputs.mode = review | maintenance | autoheal | both` and dual cron schedules (`30 3 * * *` autoheal, `30 15 * * *` maintenance). Concurrency group keyed on issue/PR/discussion number with `cancel-in-progress: false`. Matches the pattern landed in [[marcusrbrown--systematic]] (#446) and [[marcusrbrown--marcusrbrown-github-io]]. Workflow count: 8 → 7.
- **Multi-track timeline visualization merged (PR #458, `87f0ae4`, 2026-05-16, Copilot-authored):** The Copilot feature PR that had been open since the 2026-05-07 survey finally landed — adds multi-track D3 timeline visualization differentiating event types.
- **Data automation stabilization (PR #574, `466875a`, 2026-05-16, Copilot-authored):** "Stabilize Star Trek data automation with perpetual PRs and CI-safe artifact generation." Replaces the prior stacking-PR-per-week pattern with a perpetual PR model — confirms why the 2026-05-07 survey saw 6 data PRs (data-29 through data-34) backed up. The new model collapses them into a single recurring PR surface.
- **Data generation hardening (PR #571, `598af37`, 2026-05-16, Fro Bot):** `fix(data-generation): include required notes field in generated season items`. Quality-scoring schema enforcement caught a missing field in the generator.
- **Renovate preset v4 → v5 (PR #567, `d3b6a1a`, 2026-05-14):** `marcusrbrown/renovate-config#4.5.9` → `#5.2.0`. Crosses the same v4→v5 boundary now adopted across the wider ecosystem (see [[marcusrbrown--renovate-config]]). v5 adds `group:allNonMajor` + 0.x ungrouping safety valve.

**Renovate / dependency cadence:**

- **`fro-bot/agent` version trail:** v0.42.8 → v0.42.10 (#560) → v0.43.0 (#561) → v0.43.2 (#578) → v0.43.3 (#579) → v0.44.1 (#582) → v0.44.2 (#583) → v0.44.3 (#584) → v0.46.0 (#590). Nine bumps in 22 days — VBS tracks agent releases at roughly the upstream cadence.
- **`bfra-me/.github` reusable workflows:** v4.16.12 → v4.16.21 (PRs #565, #566, #585, #589).
- **pnpm:** 10.33.2 → 10.33.3 → 10.33.4 (PRs #551, #554).
- **Dev tooling pinned:** `@bfra.me/eslint-config` to v0.51.0 (#568), `@bfra.me/prettier-config` to 0.16.8 (#569), `@bfra.me/tsconfig` to v0.13.0 (#570), `prettier` to 3.8.3 (#576) — VBS aligning with the same pinned-bfra-me-tooling pattern visible across the ecosystem.
- **Non-major dep batches:** #549, #556, #573, #580, #586, #588.

**Activity shape (as of 2026-05-29):**

- **Open PRs:** 1 (down from 7) — only #577 (vite v7.3.2 pin) remains. The Copilot timeline feature merged, all six stacked data PRs collapsed into the perpetual-PR model.
- **Open issues:** 14 (down from 30) — significant cleanup. Backlog burn confirms the autoheal + maintenance modes are now operating against real triage rather than accumulating.
- **Star count:** 1.
- **No license file at root** (still — only `license: MIT` in `package.json`). Carried forward from prior surveys; no contradiction.

**Contradictions noted:**

- The "8 workflow files" count in the prior page text is now stale — current count is 7 after the autoheal fold-in. Page updated additively (struck-through row in workflows table, prose updated in Fro Bot Integration section) rather than overwriting history.

### 2026-05-07 Delta (SHA `dd10e05` → `b3c415b`)

15 commits since prior survey, all Renovate-authored (`mrbro-bot[bot]`). No structural, architectural, or application code changes.

- **`fro-bot/agent` bumped:** v0.41.4 → v0.42.8 (through v0.42.1, v0.42.4, v0.42.5, v0.42.6, v0.42.7 intermediates; PRs #525, #535, #540, #542, #544, and final non-major batch #549)
- **Renovate config preset bumped:** `marcusrbrown/renovate-config#4.5.8` → `#4.5.9` (PR #537)
- **`bfra-me/.github` reusable workflows updated:** v4.16.8 → v4.16.12 (PRs #528, #536, #543)
- **pnpm bumped:** 10.33.0 → 10.33.2 (PRs #524, via non-major batches)
- **Non-major dependency batches:** #527, #533, #549 (eslint, vitest, prettier, lint-staged, codecov-action, etc.)
- **Lockfile maintenance** included in batch PRs

Current activity (as of 2026-05-07):

- **Open PRs:** 7 — six automated Star Trek data updates (#454 data-29, #476 data-30, #497 data-31, #517 data-32, #530 data-33, #546 data-34) and one Copilot-authored feature PR (#458, multi-track timeline visualization)
- **Open issues:** 30 (majority are Daily Autohealing Reports from Fro Bot; net growth from ~23 to 30 since prior survey)
- **Fro Bot autoheal cadence:** daily reports running consistently, all authored by `fro-bot`
- **No human-authored commits** in the 15-commit delta — repository remains in pure maintenance/dependency-update mode
- **Accumulating data-update PRs:** 6 weekly data PRs stacking up unmerged (data-29 through data-34), suggesting review bottleneck or intentional batching

### 2026-04-25 Delta (SHA `a552e73` → `dd10e05`)

7 commits, all Renovate-authored (`mrbro-bot[bot]`). No structural, architectural, or application code changes.

- **`fro-bot/agent` bumped:** v0.40.2 → v0.41.4 (through v0.41.0, v0.41.1, v0.41.2 intermediates; PRs #509, #510, #512, #520)
- **`bfra-me/.github` reusable workflows updated** in `renovate.yaml` and `update-repo-settings.yaml`
- **`actions/setup-node` updated** to v6.4.0 (PR #514) in `.github/actions/setup-pnpm/action.yaml`
- **Lockfile maintenance** (PR #516) and non-major dependency batch (PR #513, #520)
- **Renovate config unchanged:** still extends `marcusrbrown/renovate-config#4.5.8` + `group:allNonMajor`
