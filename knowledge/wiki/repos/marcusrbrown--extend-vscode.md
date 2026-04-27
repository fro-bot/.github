---
type: repo
title: "marcusrbrown/extend-vscode"
created: 2026-04-18
updated: 2026-04-27
sources:
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: a4dcbbb175828a60855053d778fd21903a3d73d6
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 342872f8de739c03a0263e188395be7ab70457b6
    accessed: 2026-04-21
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 342872f8de739c03a0263e188395be7ab70457b6
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 342872f8de739c03a0263e188395be7ab70457b6
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 342872f8de739c03a0263e188395be7ab70457b6
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 342872f8de739c03a0263e188395be7ab70457b6
    accessed: 2026-04-25
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: b457a34f032149b03dddaca99eacca14eac91367
    accessed: 2026-04-26
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: b457a34f032149b03dddaca99eacca14eac91367
    accessed: 2026-04-27
tags: [vscode, vscode-extension, typescript, toolkit, tsup, vitest, semantic-release]
aliases: [extend-vscode]
related:
  - vscode-extensions
---

# marcusrbrown/extend-vscode

Modular toolkit for building VS Code extensions. Provides typed abstractions for commands, webviews, tree views, status bar, tasks, telemetry, configuration, and logging — targeting both Node.js and Web (browser) extension hosts.

## Overview

- **Purpose:** Reference extension + reusable toolkit for VS Code extension development
- **Default branch:** `main`
- **Created:** 2020-11-16
- **Last push:** 2026-04-25
- **Version:** 0.1.0 (pre-release, semantic-release configured)
- **License:** MIT
- **Engine:** VS Code `^1.102.0`
- **Topics:** `vscode`, `vscode-extension`
- **Package manager:** pnpm 10.33.0

## Architecture

Central `ExtensionController` manages extension lifecycle and disposable cleanup. Each feature lives in its own module under `src/`, exposing a `setup*` function that accepts `vscode.ExtensionContext`. Activation is orchestrated in `src/extension.ts`.

### Source Modules

| Module        | Path                    | Purpose                                                               |
| ------------- | ----------------------- | --------------------------------------------------------------------- |
| Core          | `src/core/`             | `ExtensionController` — central state + disposal                      |
| Commands      | `src/commands/`         | Typed command factory + bulk registration                             |
| Configuration | `src/configuration/`    | Settings management                                                   |
| Status Bar    | `src/status-bar/`       | Dynamic status bar item manager                                       |
| Tree View     | `src/tree-view/`        | Generic base + example hierarchical provider                          |
| Webview       | `src/webview/`          | Typed panel base with message bridge                                  |
| Tasks         | `src/tasks/`            | Extensible task provider + shell task example                         |
| Telemetry     | `src/telemetry/`        | Pluggable reporter (console-only default, no external transmission)   |
| Logger        | `src/utils/logger.ts`   | Level-based output channel logging (`extend-vscode.logLevel`)         |
| Generated     | `src/generated/meta.ts` | Auto-generated types/constants from package.json via `vscode-ext-gen` |

### Dual-Target Build

The extension builds for both Node.js (`out/node/`) and Web (`out/web/`) via `tsup`. Platform detection uses `process.env.PLATFORM` defined in `tsup.config.ts`. Conditional exports in `package.json` expose each feature module individually (`extend-vscode/commands`, `extend-vscode/webview`, etc.).

### Extension Contributions

- **Commands:** `extend-vscode.webHello`, `extend-vscode.showWebview`, `extend-vscode.refreshTree`
- **Views:** `extend-vscode.exampleTree` (Explorer sidebar)
- **Configuration:** `extend-vscode.logLevel` (debug/info/warn/error, default: info)
- **Activation:** `onStartupFinished`

## Build & Tooling

| Tool | Config | Notes |
| --- | --- | --- |
| TypeScript | `tsconfig.json` (extends `@bfra.me/tsconfig`) | Target ES2020, bundler resolution, noEmit |
| tsup | `tsup.config.ts` | Dual node/web outputs |
| ESLint | `eslint.config.ts` (`@bfra.me/eslint-config` 0.51.0) | Includes prettier, no-only-tests, node-dependencies |
| Prettier | `.prettierrc.yaml` | Formatting |
| Vitest | `vitest.config.ts`, `vitest.config.web.ts` | Unit (Node) + web tests, coverage via `@vitest/coverage-v8` |
| Playwright | `visual-test.config.ts` | Visual regression tests |
| vscode-ext-gen | `pnpm generate:meta` | Generates `src/generated/meta.ts` from package.json |

## Testing Strategy

| Layer       | Path                            | Runner                                         |
| ----------- | ------------------------------- | ---------------------------------------------- |
| Unit        | `test/*.test.ts`, `test/suite/` | Vitest (Node)                                  |
| Web         | `test/web/`                     | Vitest (web config)                            |
| Integration | `test/integration/`             | `@vscode/test-electron` via `test/run-test.ts` |
| Visual      | `test/visual/`                  | Playwright                                     |
| Performance | `test/performance/`             | Custom benchmarks                              |
| Mocks       | `test/__mocks__/vscode.ts`      | Mock VS Code API                               |

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Lint, test, test:web, build |
| Publish | `publish.yaml` | push to release branches, dispatch | Semantic-release to VS Code Marketplace + OpenVSIX + npm |
| Emergency Rollback | `rollback.yaml` | dispatch (manual) | Rollback published versions across platforms |
| Renovate | `renovate.yaml` | issue/PR edit, push, dispatch, CI completion | Dependency updates via `bfra-me/.github` reusable workflow |
| Cache Cleanup | `cache-cleanup.yaml` | PR close, weekly cron, dispatch | Prune stale action caches |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync via `bfra-me/.github` reusable workflow |

### Branch Protection

Required status checks on `main`: `Renovate / Renovate`, `Run Checks`. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Publishing Pipeline

Semantic-release with conventional commits. Publishes to three targets:

1. **VS Code Marketplace** — via `semantic-release-vsce` (VSIX packaging)
2. **OpenVSIX** — via `ovsx` (open registry)
3. **npm** — via `@semantic-release/npm` (library consumption)

Release branches: `main`, `next`, `next-major`, `beta` (prerelease), `alpha` (prerelease), maintenance (`x.y.x`).

Pre-release validation runs a matrix of: lint, test, test-web, build, bundle-size, manifest, dual-target, vulnerabilities.

### Rollback

Emergency rollback workflow supports per-platform rollback (all, npm-only, marketplace-only, github-only) with confirmation gate and automatic issue creation.

## Dependency Management

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.0` + `sanity-io/renovate-config` presets (semantic commits, security, lock-file maintenance). Patch updates disabled except for TypeScript. Post-upgrade runs: `pnpm bootstrap`, `pnpm build`, `pnpm fix` (x2).
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (part of Fro Bot-managed ecosystem).
- **Authentication:** Renovate and settings workflows use `APPLICATION_ID` + `APPLICATION_PRIVATE_KEY` secrets (GitHub App via `bfra-me/.github` reusable workflows).

## AI/LLM Context

The repo ships AI context files:

- **`llms.txt`** — Structured LLM context document (architecture, file references, testing, configuration)
- **`.github/copilot-instructions.md`** — GitHub Copilot development guidelines (architecture, patterns, dual-platform support, command registration, testing strategy)
- **`.ai/`** and **`.cursor/`** directories present (likely additional AI assistant rules)

## Fro Bot Integration

**No Fro Bot agent workflow detected.** The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration for automated PR review and triage. A follow-up draft PR should be proposed to add the Fro Bot agent workflow.

The repo references `fro-bot/.github:common-settings.yaml` in its Probot settings, confirming it is part of the Fro Bot-managed ecosystem.

## Notable Patterns

- **Controller pattern:** Single `ExtensionController` centralizes lifecycle management — all disposables register through it, preventing leak vectors common in VS Code extensions.
- **Dual-target architecture:** Same source builds for both Node.js and browser extension hosts via tsup platform splitting. Conditional exports expose modules for library consumption.
- **Feature-module convention:** Each feature follows the `setup*(context)` pattern, returning disposables. New features slot in by adding a folder and wiring into `activate()`.
- **Generated metadata:** `vscode-ext-gen` auto-generates TypeScript types from `package.json` contributions, eliminating string-literal drift between manifest and code.
- **Three-target publishing:** Semantic-release publishes to VS Code Marketplace, OpenVSIX, and npm simultaneously, with rollback support per platform.
- **No external telemetry:** Default telemetry reporter logs only to the VS Code output channel. No data leaves the machine unless a custom reporter is plugged in.

## Delta Log

### 2026-04-21 (SHA `342872f8` from `a4dcbbb`)

Three Renovate dependency bumps merged since 2026-04-18 survey; no structural changes:

| PR | Change |
| --- | --- |
| #480 | `type-fest` v5.5.x → v5.6.0 |
| #479 | `actions/setup-node` → v6.4.0 (SHA `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`) |
| #478 | `@vscode/vsce` → v3.9.0 |

`bfra-me/.github` renovate reusable workflow now pinned at SHA `65caa6a021ae4a6597bd915f276e1ab9d75dc071` (v4.16.0). Repository structure, architecture, workflows, and publishing pipeline unchanged. **Fro Bot workflow still absent** — follow-up PR recommendation carried forward.

### 2026-04-23 (SHA `342872f8`, unchanged from 2026-04-21)

No changes detected since 2026-04-21 survey. The latest commit (`342872f8`) is the same SHA surveyed previously — dependency bump for `type-fest` v5.6.0 (#480). Repository structure, architecture, build tooling, CI/CD pipeline, AI context files, and Probot settings all identical to prior survey. Open issues: 9. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

### 2026-04-23 survey #2 (SHA `342872f8`, unchanged)

No merged changes since prior survey. Four open Renovate PRs pending (not yet merged):

| PR | Change |
| --- | --- |
| #466 | `typescript` → v6 |
| #467 | `eslint` → v10 |
| #468 | `eslint-plugin-node-dependencies` → v2 |
| #469 | `jsdom` → v29 |

All pending PRs are Renovate dependency bumps — no structural changes. Repository content, workflows, architecture, and Probot settings remain identical. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

### 2026-04-24 (SHA `342872f8`, unchanged)

No repository changes since 2026-04-21. HEAD remains at `342872f8` (type-fest v5.6.0 bump, #480). Last push: 2026-04-20. Same 4 open Renovate PRs (#466–#469) pending merge. Open issues unchanged at 5 (#142, #162, #317, #318, #319). Repo metadata: 1 star, 1 watcher, not archived, not forked.

Confirmed current dependency versions: pnpm 10.33.0, VS Code engine `^1.102.0`, TypeScript (tsconfig extends `@bfra.me/tsconfig`), tsup build, Vitest testing, semantic-release publishing. Six workflows present: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

### 2026-04-25 (SHA `342872f8`, unchanged)

No repository changes since 2026-04-20 (5 days dormant). HEAD remains at `342872f8` (type-fest v5.6.0 bump, #480). Last push: 2026-04-20. Repo metadata: 1 star, 1 watcher, 9 open issues (5 genuine + 4 Renovate PRs counted by API), not archived, not forked.

Open Renovate PRs (unchanged from prior survey):

| PR | Change | Author |
| --- | --- | --- |
| #466 | `typescript` → v6 | mrbro-bot[bot] |
| #467 | `eslint` → v10 | mrbro-bot[bot] |
| #468 | `eslint-plugin-node-dependencies` → v2 | mrbro-bot[bot] |
| #469 | `jsdom` → v29 | mrbro-bot[bot] |

Open issues (5):

| Issue | Title |
| --- | --- |
| #142 | Uplift `vscode-bash` |
| #162 | Dependency Dashboard |
| #317 | Advanced Testing Infrastructure - Phase 3: Accessibility Testing Integration |
| #318 | Advanced Testing Infrastructure - Phase 4: Multi-Version Integration Testing |
| #319 | Advanced Testing Infrastructure - Phase 5: Quality Gates and GitHub Actions Integration |

Confirmed dependency snapshot: `@bfra.me/eslint-config` 0.51.0, `@bfra.me/tsconfig` 0.13.0, `@playwright/test` 1.59.0, `@types/vscode` 1.115.0, `eslint` 9.39.0, `prettier` 3.8.0, `typescript` 5.9.3, `vitest` 4.1.0, `@vscode/vsce` 3.9.0, `tsup` ^8.0.2, `semantic-release` 25.0.1, `vscode-ext-gen` 1.6.0. Renovate extends `marcusrbrown/renovate-config#4.5.0` + `sanity-io/renovate-config`. Probot settings extend `fro-bot/.github:common-settings.yaml`.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward. Six workflows present: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`.

### 2026-04-26 (SHA `b457a34f` from `342872f8`)

One Renovate dependency bump merged since 2026-04-25 survey — breaks the 5-day dormant streak:

| PR | Change |
| --- | --- |
| #481 | `typescript-eslint` v8.58.x → v8.59.0 |

Updated dependency snapshot: `typescript-eslint` now at 8.59.0. All other dependencies, repository structure, architecture, workflows, publishing pipeline, and Probot settings unchanged. Same 4 open Renovate PRs (#466–#469) pending merge. Open issues: 5 (#142, #162, #317–#319). Repo metadata: 1 star, 1 watcher, not archived.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward. Six workflows present: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`.

### 2026-04-27 (SHA `b457a34f`, unchanged from 2026-04-25)

No repository changes since 2026-04-25 push. HEAD remains at `b457a34f` (`typescript-eslint` v8.59.0 bump, #481). Last push: 2026-04-25T15:12:46Z.

Open Renovate PRs (unchanged):

| PR | Change |
| --- | --- |
| #466 | `typescript` → v6 |
| #467 | `eslint` → v10 |
| #468 | `eslint-plugin-node-dependencies` → v2 |
| #469 | `jsdom` → v29 |

Open issues (5): #142 (Uplift `vscode-bash`), #162 (Dependency Dashboard), #317–#319 (Advanced Testing Infrastructure Phases 3–5).

Confirmed full dependency snapshot: `@bfra.me/eslint-config` 0.51.0, `@bfra.me/tsconfig` 0.13.0, `@playwright/test` 1.59.0, `@types/vscode` 1.115.0, `eslint` 9.39.0, `eslint-config-prettier` 10.1.1, `prettier` 3.8.0, `typescript` 5.9.3, `typescript-eslint` 8.59.0, `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `@vitest/ui` 4.1.0, `@vscode/vsce` 3.9.0, `tsup` ^8.0.2, `tsx` 4.21.0, `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `vscode-ext-gen` 1.6.0, `jsdom` 27.4.0, `type-fest` 5.6.0, `jiti` 2.6.1, `ovsx` 0.10.5. Package manager: pnpm 10.33.0. VS Code engine: `^1.102.0`. Node target: 18 (tsup). Renovate extends `marcusrbrown/renovate-config#4.5.0` + `sanity-io/renovate-config`. Probot settings extend `fro-bot/.github:common-settings.yaml`.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward. Six workflows present: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`.
