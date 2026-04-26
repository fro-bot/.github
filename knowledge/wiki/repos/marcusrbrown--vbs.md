---
type: repo
title: "marcusrbrown/vbs"
created: 2026-04-18
updated: 2026-04-26
sources:
  - url: https://github.com/marcusrbrown/vbs
    sha: de10b9b
    accessed: 2026-04-26
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
---

# marcusrbrown/vbs

**VBS (View By Stardate)** — a local-first, chronological Star Trek viewing guide web application. TypeScript + Vite + D3.js, deployed to GitHub Pages. Uses a functional factory architecture with closure-based state management and generic EventEmitters.

## Overview

- **Purpose:** Interactive Star Trek chronological viewing guide with progress tracking
- **Default branch:** `main`
- **Created:** 2025-07-18
- **Last push:** 2026-04-26
- **Homepage:** https://marcusrbrown.github.io/vbs/
- **License:** MIT (declared in package.json; no LICENSE file observed at root)
- **Topics:** `star-trek`, `viewing-guide`, `chronological`, `progress-tracker`, `local-first`
- **Package manager:** pnpm 10.33.1
- **Node.js:** 22.x

## Tech Stack

| Layer             | Technology                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| Language          | TypeScript 5.9 (strict mode, `erasableSyntaxOnly`, `verbatimModuleSyntax`)        |
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
│   ├── modules/                 # Core business logic (27 files)
│   │   ├── types.ts             # Central type definitions + event maps
│   │   ├── progress.ts          # Progress tracking factory
│   │   ├── search.ts            # Search/filtering factory
│   │   ├── timeline.ts          # Timeline rendering factory
│   │   ├── storage.ts           # Import/export functionality
│   │   ├── events.ts            # EventEmitter implementation
│   │   ├── episode-tracker.ts   # Episode-level tracking
│   │   ├── error-handler.ts     # Error boundary utilities
│   │   ├── logger.ts            # Structured logging
│   │   ├── preferences.ts       # User preferences
│   │   ├── themes.ts            # Theme management
│   │   ├── settings-manager.ts  # Settings UI
│   │   ├── metadata-*.ts        # Metadata enrichment subsystem (6 files)
│   │   ├── streaming-api.ts     # Streaming availability
│   │   ├── cache-warming.ts     # Cache pre-population
│   │   ├── conflict-resolution.ts
│   │   ├── migration.ts         # Data migration
│   │   ├── version-manager.ts   # Version tracking
│   │   └── timeline-viz.ts      # D3 timeline visualization
│   ├── components/              # UI components (11 .ts + 11 .css)
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
│   ├── workflows/               # 8 workflow files
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
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (daily 15:30 UTC), dispatch | PR review, daily maintenance, ad-hoc prompts |
| Fro Bot Autoheal | `fro-bot-autoheal.yaml` | daily cron (03:30 UTC), dispatch | Automated repo healing (errored PRs, security, lint, data quality) |
| Update Star Trek Data | `update-star-trek-data.yaml` | weekly Monday 09:00 UTC, dispatch | Regenerate data from external sources, validate, create PR |
| Renovate | `renovate.yaml` | — | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | — | Probot settings sync |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | — | GitHub Copilot agent environment |

### CI Jobs (ci.yaml)

1. **Test** — checkout → setup pnpm → lint → type-check → test with coverage → upload to Codecov
2. **Build** — checkout → setup pnpm → build → upload artifact (7-day retention)

### Branch Protection

Required status checks on `main`: Build, Fro Bot, Renovate, Test. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Fro Bot Integration

**Fro Bot workflow is present and active** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.42.1` (SHA `6c45d8ce66b0b69f1b80b23f283ed455deb59517`).

### PR Review

Triggers on `opened`, `synchronize`, `reopened`, `ready_for_review`, `review_requested`. Custom review prompt focuses on:

- Correctness, security, breaking changes to factory APIs
- VBS-specific violations (missing `.js` extensions, `any` usage, class patterns, `this` binding, missing `destroy()`, inline styles, missing event map types)
- Structured review output: Verdict (PASS/CONDITIONAL/REJECT), Blocking issues, Non-blocking concerns, Missing tests, Risk assessment

### Daily Maintenance

Scheduled at 15:30 UTC daily. Maintains a rolling "Daily Maintenance Report" issue with metrics, stale issues/PRs, unassigned bugs, and recommended actions. 14-day rolling window with historical summary compression.

### Daily Autoheal

Scheduled at 03:30 UTC daily via separate `fro-bot-autoheal.yaml`. Five-category sweep:

1. Errored PRs — diagnose and fix failing CI on open PRs
2. Security — remediate Dependabot/Renovate security alerts
3. Code quality — build, test coverage, stale TODOs, convention compliance, AGENTS.md drift
4. Developer experience — lint fixes
5. Data quality — validate Star Trek dataset integrity

Hard boundaries: no force-push, no direct commits to main, no merging PRs, no disabling tests to pass checks.

### Mention-triggered

Responds to `@fro-bot` mentions in issue/PR/discussion comments from OWNER/MEMBER/COLLABORATOR.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8` + `group:allNonMajor`. Post-upgrade tasks run `pnpm install` + `pnpm fix`. Rebase when behind base branch.
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
- **Aggressive autoheal:** The `fro-bot-autoheal.yaml` workflow is one of the most comprehensive automated maintenance configurations in the ecosystem, covering 5 categories with detailed output formatting.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `a552e73` | Initial survey — full page created |
| 2026-04-25 | `dd10e05` | Incremental — 7 Renovate commits, agent bump v0.40.2 → v0.41.4, no structural changes |
| 2026-04-26 | `de10b9b` | Incremental — 2 Renovate commits, pnpm 10.33.1, agent bump v0.41.4 → v0.42.1 |

### 2026-04-26 Delta (SHA `dd10e05` → `de10b9b`)

2 commits, all Renovate-authored (`mrbro-bot[bot]`). No structural, architectural, or application code changes.

- **`fro-bot/agent` bumped:** v0.41.4 → v0.42.1 (SHA `6c45d8ce66b0b69f1b80b23f283ed455deb59517`; PR #525)
- **pnpm bumped:** 10.33.0 → 10.33.1 (PR #524)
- **Renovate config unchanged:** still extends `marcusrbrown/renovate-config#4.5.8` + `group:allNonMajor`

Current activity (as of 2026-04-26):

- **Open PRs:** 5 — four automated Star Trek data updates (#454 data-29, #476 data-30, #497 data-31, #517 data-32) and one Copilot-authored feature PR (#458, multi-track timeline visualization)
- **Open issues:** 43 total (includes PRs). Daily Autohealing Reports from Fro Bot running consistently (latest: #526, 2026-04-26), authored by `fro-bot`
- **No human-authored commits** since at least 2026-04-18 — repository remains in pure maintenance/dependency-update mode

### 2026-04-25 Delta (SHA `a552e73` → `dd10e05`)

7 commits, all Renovate-authored (`mrbro-bot[bot]`). No structural, architectural, or application code changes.

- **`fro-bot/agent` bumped:** v0.40.2 → v0.41.4 (through v0.41.0, v0.41.1, v0.41.2 intermediates; PRs #509, #510, #512, #520)
- **`bfra-me/.github` reusable workflows updated** in `renovate.yaml` and `update-repo-settings.yaml`
- **`actions/setup-node` updated** to v6.4.0 (PR #514) in `.github/actions/setup-pnpm/action.yaml`
- **Lockfile maintenance** (PR #516) and non-major dependency batch (PR #513, #520)
- **Renovate config unchanged:** still extends `marcusrbrown/renovate-config#4.5.8` + `group:allNonMajor`
