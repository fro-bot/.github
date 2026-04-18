---
type: repo
title: "marcusrbrown/vbs"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/vbs
    sha: a552e7335af70122f68380440c78a415a785749f
    accessed: 2026-04-18
tags: [star-trek, typescript, vite, local-first, viewing-guide, d3, github-pages, functional-factories]
aliases: [vbs, view-by-stardate]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/vbs

**VBS (View By Stardate)** — a local-first Star Trek chronological viewing guide. TypeScript + Vite web app deployed to GitHub Pages, using functional factory architecture with closure-based state, generic EventEmitters, and D3.js for timeline visualization.

## Overview

- **Purpose:** Interactive chronological Star Trek viewing guide with progress tracking
- **Homepage:** https://marcusrbrown.github.io/vbs/
- **Default branch:** `main`
- **Created:** 2025-07-18
- **Last push:** 2026-04-17
- **License:** MIT (stated in package.json, no LICENSE file observed)
- **Topics:** `star-trek`, `viewing-guide`, `chronological`, `progress-tracker`, `local-first`
- **Package name:** `@marcusrbrown/vbs` (private, v0.0.0)

## Tech Stack

| Layer           | Technology                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| Language        | TypeScript 5.9.x (strict mode, `erasableSyntaxOnly`, `verbatimModuleSyntax`) |
| Build           | Vite 7.x, `tsc && vite build`                                                |
| Testing         | Vitest 4.x, jsdom environment, coverage via `@vitest/coverage-v8`            |
| Linting         | ESLint 9.x (`@bfra.me/eslint-config`), Prettier (`@bfra.me/prettier-config`) |
| Runtime dep     | D3.js 7.x (timeline visualization)                                           |
| Package manager | pnpm 10.33.0                                                                 |
| Node.js         | 22.x                                                                         |
| Git hooks       | `simple-git-hooks` + `lint-staged`                                           |
| TypeScript base | `@bfra.me/tsconfig`                                                          |

## Architecture

### Functional Factory Pattern

The project enforces a strict **no-class, no-`this`** rule. All modules use functional factories with closure-based private state and return public API objects. Generic `createEventEmitter<TEventMap>()` provides type-safe event handling.

Key conventions (from AGENTS.md and workflow prompts):

- No `any`, `@ts-ignore`, or `@ts-expect-error`
- All imports must use `.js` extensions for ESM resolution
- CSS custom properties with `--vbs-` prefix; no inline styles
- Components must expose `destroy()` for cleanup
- Error boundaries via `withErrorHandling()` / `withSyncErrorHandling()`
- Event map types centralized in `src/modules/types.ts`

### Source Layout

```
src/
├── main.ts                    # App entry, application factory
├── style.css                  # Global styles, Star Trek theme
├── vite-env.d.ts              # Vite type declarations
├── components/                # UI components (co-located .ts + .css)
│   ├── metadata-debug-panel   # Dev/debug metadata panel
│   ├── metadata-expert-mode   # Expert metadata controls
│   ├── metadata-preferences   # Metadata display preferences
│   ├── metadata-quality-indicator
│   ├── metadata-source-attribution
│   ├── metadata-sync-status
│   ├── metadata-usage-controls
│   ├── migration-progress     # Data migration progress UI
│   ├── streaming-indicators   # Streaming availability indicators
│   ├── streaming-preferences  # Streaming service preferences
│   ├── timeline-controls      # Timeline navigation controls
│   └── timeline-viz.css       # Timeline visualization styles
├── data/
│   └── star-trek-data.ts      # Comprehensive Star Trek dataset (~570 lines)
├── modules/                   # Core logic factories
│   ├── types.ts               # Shared interfaces, event maps
│   ├── progress.ts            # Progress tracking factory
│   ├── search.ts              # Search/filtering factory
│   ├── timeline.ts            # Timeline rendering factory
│   ├── storage.ts             # Import/export, generic storage adapters
│   ├── events.ts              # Event system
│   ├── episodes.ts            # Episode-level tracking
│   ├── episode-tracker.ts     # Episode tracker factory
│   ├── themes.ts              # Theme management
│   ├── preferences.ts         # User preferences
│   ├── settings-manager.ts    # Settings UI factory
│   ├── logger.ts              # Structured logger
│   ├── error-handler.ts       # Error boundary factories
│   ├── migration.ts           # Data migration logic
│   ├── version-manager.ts     # Schema versioning
│   ├── cache-warming.ts       # Cache pre-warming
│   ├── metadata-*.ts          # Metadata sources, quality, queue, scheduler, storage
│   ├── streaming-api.ts       # Streaming service API integration
│   ├── timeline-viz.ts        # D3-based timeline visualization
│   ├── conflict-resolution.ts # Data conflict resolution
│   └── progress-validation.ts # Progress data validation
└── utils/
    ├── composition.ts         # Functional composition (pipe, compose, curry, tap)
    ├── download.ts            # File download utility
    ├── geographic.ts          # Geographic utilities
    ├── metadata-validation.ts # Metadata validation
    └── index.ts               # Utils barrel export
```

### Data Model

Star Trek content organized as 7 chronological eras (22nd–32nd century, 1000+ years), each containing series, movies, and animated content. Items have IDs following conventions:

- Episode: `/^[a-z]+_s\d+_e\d+$/`
- Season: `/^[a-z]+_s\d+$/`
- Series: `/^[a-z]+(?:_s\d+)?$/`

### State Management

- **Local-first:** All progress stored in browser localStorage
- **Data portability:** JSON export/import for backup and sync
- **Generic storage adapters:** Type-safe `StorageAdapter<T>` interface with `LocalStorageAdapter` implementation
- **IndexedDB migration:** Planned (documented in `docs/indexeddb-migration.md`)

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main` | Lint, type-check, test with coverage, build |
| Deploy | `deploy.yaml` | push to `main`, dispatch | Build and deploy to GitHub Pages |
| Fro Bot | `fro-bot.yaml` | PR, issues, comments, schedule (daily 15:30 UTC), dispatch | AI PR review, daily maintenance reporting |
| Fro Bot Autoheal | `fro-bot-autoheal.yaml` | daily cron (03:30 UTC), dispatch | Automated repo healing: fix errored PRs, security, code quality, DX, data quality |
| Update Star Trek Data | `update-star-trek-data.yaml` | weekly (Mon 09:00 UTC), dispatch | Automated data generation from TMDB/Memory Alpha/TrekCore/STAPI |
| Renovate | `renovate.yaml` | issue/PR edit, push, dispatch, CI completion | Dependency updates via `bfra-me/.github` reusable workflow |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, 12h cron, dispatch | Probot settings sync via `bfra-me/.github` reusable workflow |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | dispatch, push/PR touching itself | Copilot coding agent environment bootstrap |

### Branch Protection

Required status checks on `main`: `Build`, `Fro Bot`, `Renovate / Renovate`, `Test`. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Infrastructure

- **Reusable workflows:** Renovate and repo settings workflows use `bfra-me/.github@v4.16.6`
- **Authentication:** `APPLICATION_ID` + `APPLICATION_PRIVATE_KEY` secrets (GitHub App), plus `FRO_BOT_PAT` for Fro Bot agent
- **Actions pinned by SHA:** All action references use full commit SHA pins (security best practice)

## Fro Bot Integration

**Fro Bot workflow present and active.** Uses `fro-bot/agent@v0.40.2` (SHA-pinned).

### PR Review

Structured review with VBS-specific checklist:

- Verdict format: `PASS | CONDITIONAL | REJECT`
- Focus areas: correctness, security, breaking API changes, test coverage
- VBS convention enforcement: `.js` imports, no `any`, functional factories, closure state, `destroy()` methods, CSS custom properties, event map types

### Daily Maintenance

Scheduled run (15:30 UTC) updates a rolling "Daily Maintenance Report" issue with:

- Summary metrics (issues, PRs, stale items, branch status)
- Stale issues/PRs flagged with recommended actions
- 14-day rolling window with historical summary

### Autoheal

Separate daily workflow (03:30 UTC) with five categories:

1. **Errored PRs** — diagnose and fix CI failures on open PRs
2. **Security** — remediate Dependabot/Renovate security alerts
3. **Code Quality** — build/test verification, coverage, stale TODOs, convention compliance, AGENTS.md drift
4. **Developer Experience** — lint/format fixes via PR
5. **Data Quality** — validate Star Trek dataset integrity (IDs, ordering, patterns)

Hard boundaries: no force-push, no direct pushes to `main`, no merging PRs, no weakening guardrails.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8`. Groups all non-major. Post-upgrade runs `pnpm install` + `pnpm fix`. Rebase when behind base branch.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (shared with [[marcusrbrown--ha-config]]).
- **ESLint:** `@bfra.me/eslint-config` with TypeScript support. Logger module gets relaxed `no-console` (allows warn, error, info). Ignores `.ai/`, `AGENTS.md`, copilot instructions, viewing guide, PWA manifest.
- **Git hooks:** `simple-git-hooks` runs `lint-staged` on pre-commit. Lint-staged runs `eslint --fix` on staged files.
- **Copilot:** Copilot setup steps workflow bootstraps environment with pnpm + build for the Copilot coding agent.

## Automated Data Pipeline

The Star Trek dataset is maintained via an automated generation pipeline:

- **Script:** `scripts/generate-star-trek-data.ts` (run via `jiti`)
- **Sources:** TMDB, Memory Alpha, TrekCore, STAPI — multi-source aggregation with conflict resolution
- **Validation:** `scripts/validate-episode-data.ts` with quality scoring (minimum: 0.6)
- **Modes:** Full regeneration or incremental (per-series) updates
- **Workflow:** Weekly automated PR creation via `peter-evans/create-pull-request`
- **Environment:** Optional `TMDB_API_KEY` for enhanced metadata

## Test Suite

Comprehensive Vitest test suite (~43 test files) covering:

- Core modules (progress, storage, search, events, episodes, timeline)
- Components (metadata panels, streaming indicators, timeline controls)
- Utilities (composition, geographic, metadata validation)
- Integration tests (composition, timeline-progress, parallel execution)
- Type-level tests (`type-safety.test-d.ts` with Vitest `typecheck`)
- Data validation tests (`validate-episode-data.test.ts`)
- Coverage reporting via `@vitest/coverage-v8`, uploaded to Codecov

## Documentation

The `docs/` directory contains:

- ADR directory (`adr/`) — architecture decision records (data generation architecture)
- `data-generation.md` — data generation guide
- `data-generation-migration.md` — migration from previous data approach
- `environment-variables.md` — env var configuration
- `automated-data-updates.md` — GitHub Actions data update workflow docs
- `composition-examples.md` — functional composition usage examples
- `generic-types-examples.md` — TypeScript generics usage
- `indexeddb-migration.md` — planned IndexedDB migration
- `metadata-storage-integration.md` — metadata storage patterns
- `settings-architecture.md` — settings system architecture

## Notable Patterns

- **Functional purity enforcement:** The entire codebase bans classes and `this` in favor of closure-based factories. This is enforced by convention (AGENTS.md), review prompts, and autoheal checks — not by lint rules.
- **Generic EventEmitter integration:** Event-driven architecture with compile-time type checking of event names and payloads.
- **Multi-source data aggregation:** Star Trek data isn't hand-maintained — it's programmatically generated from 4+ authoritative sources with quality scoring and conflict resolution.
- **Three-tier Fro Bot integration:** PR review + daily maintenance + nightly autoheal. This is the most comprehensive Fro Bot setup observed across Marcus's repositories.
- **Co-located component CSS:** Components pair `.ts` and `.css` files side-by-side in `src/components/`, using `--vbs-` namespaced custom properties.
- **Probot settings extend common baseline:** Same pattern as [[marcusrbrown--ha-config]], inheriting from `fro-bot/.github:common-settings.yaml`.
- **Shared config ecosystem:** TypeScript, ESLint, Prettier, and Renovate all extend `@bfra.me/*` or `marcusrbrown/*` shared configurations.
