---
type: repo
title: "marcusrbrown/extend-vscode"
created: 2026-04-18
updated: 2026-04-21
sources:
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: a4dcbbb175828a60855053d778fd21903a3d73d6
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 342872f8de739c03a0263e188395be7ab70457b6
    accessed: 2026-04-21
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
- **Last push:** 2026-04-17
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
