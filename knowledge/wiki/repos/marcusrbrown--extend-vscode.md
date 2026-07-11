---
type: repo
title: "marcusrbrown/extend-vscode"
created: 2026-04-18
updated: 2026-06-29
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
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 516a9eb442f97212f45d890e65fb7d7642566206
    accessed: 2026-05-26
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 73790dd8d45ee3a58c43a225f0ea8a7bc21b0924
    accessed: 2026-06-08
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 5724bd8b1d7567a81c282bac2779184b419385a2
    accessed: 2026-06-18
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 347447ca73e25364c3917e2169c9b80efc075e98
    accessed: 2026-06-29
tags: [vscode, vscode-extension, typescript, toolkit, tsup, vitest, semantic-release]
aliases: [extend-vscode]
related:
  - vscode-extensions
  - marcusrbrown--renovate-config
---

# marcusrbrown/extend-vscode

Modular toolkit for building VS Code extensions. Provides typed abstractions for commands, webviews, tree views, status bar, tasks, telemetry, configuration, and logging — targeting both Node.js and Web (browser) extension hosts.

## Overview

- **Purpose:** Reference extension + reusable toolkit for VS Code extension development
- **Default branch:** `main`
- **Created:** 2020-11-16
- **Last push:** 2026-06-03
- **Version:** 0.1.0 (pre-release, semantic-release configured)
- **License:** MIT
- **Engine:** VS Code `^1.102.0`
- **Topics:** `vscode`, `vscode-extension`
- **Package manager:** pnpm 10.33.0
- **Node target:** 24.16.0 (`.node-version`)

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

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.0` + `sanity-io/renovate-config` presets (semantic commits, security, lock-file maintenance). Crossed the v4 → v5 boundary on 2026-05-14 (PR #487). Patch updates disabled except for TypeScript. GitHub Actions grouped except `bfra-me/*`. Post-upgrade runs: `pnpm bootstrap`, `pnpm build`, `pnpm fix` (x2). See [[marcusrbrown--renovate-config]].
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

### 2026-05-26 (SHA `516a9eb4` from `b457a34f`)

Repo broke its dormancy: 12 commits merged between 2026-04-29 and 2026-05-21, all Renovate dependency bumps. No structural, architectural, or workflow changes.

**Most significant change: Renovate preset crossed the v4 → v5 boundary** (PR #487, 2026-05-14): `marcusrbrown/renovate-config#4.5.0` → `#5.2.0`. This aligns extend-vscode with [[marcusrbrown--renovate-config]]'s v5 line (the `group:allNonMajor` + 0.x ungrouping policy). Cross-reference accordingly.

Merged dependency changes since 2026-04-25:

| PR | Date | Change |
| --- | --- | --- |
| #493 | 2026-05-21 | Node.js → v24.16.0 (`.node-version`) |
| #492 | 2026-05-18 | `eslint` → v10.4.0 |
| #491 | 2026-05-17 | `tsx` → v4.22.0 |
| #490 | 2026-05-15 | `@types/vscode` → v1.118.0 |
| #489 | 2026-05-14 | `@playwright/test` → v1.60.0 |
| #488 | 2026-05-14 | `tsup` pinned to 8.5.1 (from `^8.0.2` range) |
| #487 | 2026-05-14 | `marcusrbrown/renovate-config` → v5.2.0 (**major preset jump**) |
| #486 | 2026-05-09 | `jiti` → v2.7.0 |
| #485 | 2026-05-04 | `eslint` → v10.3.0 |
| #484 | 2026-05-02 | `eslint-plugin-no-only-tests` → v3.4.0 |
| #483 | 2026-05-01 | `@types/vscode` → v1.116.0 |
| #482 | 2026-04-30 | `jsdom` → v29.1.0 |
| #468 | 2026-04-30 | `eslint-plugin-node-dependencies` → v2 (major) |
| #467 | 2026-04-30 | `eslint` → v10 (major) |
| #469 | 2026-04-29 | `jsdom` → v29 (major) |

Three of the four previously-pending majors closed: `eslint` v10, `eslint-plugin-node-dependencies` v2, `jsdom` v29. The remaining outstanding major is `typescript` v6 (#466) — still pending, now the sole holdout.

Confirmed dependency snapshot at HEAD:

- Runtime: pnpm 10.34.0, Node 24.16.0, VS Code engine `^1.102.0`
- Core: `typescript` 5.9.3, `tsup` 8.5.1 (pinned), `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `@vitest/ui` 4.1.0, `@vitest/eslint-plugin` 1.6.1 (new)
- Lint: `eslint` 10.4.0, `typescript-eslint` 8.60.0, `@bfra.me/eslint-config` 0.51.0, `eslint-plugin-node-dependencies` 2.2.0, `eslint-plugin-no-only-tests` 3.4.0, `eslint-plugin-prettier` 5.5.0 (now explicit), `eslint-config-prettier` 10.1.1, `prettier` 3.8.0
- VS Code tooling: `@types/vscode` 1.120.0, `@types/node` 24.12.0 (now explicit), `@vscode/vsce` 3.9.0, `@vscode/test-electron` 2.5.2, `@vscode/test-web` 0.0.67, `@vscode/test-cli` 0.0.10, `vscode-ext-gen` 1.6.0
- Publishing: `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5
- Testing: `@playwright/test` 1.60.0, `jsdom` 29.1.0
- Build helpers: `tsx` 4.22.0, `jiti` 2.7.0, `type-fest` 5.7.0, `esbuild-plugin-polyfill-node` 0.3.0 (new, explicit web polyfill)

Repo metadata: 1 star, 1 watcher, not archived, not forked. Open issues: 5 (#142 Uplift `vscode-bash`, #162 Dependency Dashboard, #317–#319 Advanced Testing Infrastructure Phases 3–5). Open PRs: 1 (#466, `typescript` v6 — pending).

**Footgun observation:** `tsup` was previously declared with a `^8.0.2` semver range while every other devDependency was pinned exactly. PR #488 corrected the drift to `8.5.1`. The repo now has a consistent pin-exact policy across all devDependencies — useful invariant to preserve if a future contributor adds a new devDep.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward (now ~6 weeks open across surveys). Six workflows present, unchanged: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`. Probot settings still extend `fro-bot/.github:common-settings.yaml`; branch protection (`Renovate / Renovate`, `Run Checks`, linear history, admin enforcement) unchanged.

### 2026-06-08 (SHA `73790dd8` from `516a9eb4`)

Five dependency bumps merged between 2026-05-27 and 2026-06-03. One security patch included. No structural, architectural, or workflow changes.

| PR | Date | Change |
| --- | --- | --- |
| #498 | 2026-06-03 | `type-fest` v5.6.0 → v5.7.0 |
| #497 | 2026-06-01 | `@types/vscode` → v1.120.0 |
| #496 | 2026-05-30 | `pnpm` → v10.34.0 |
| #495 | 2026-05-28 | `typescript-eslint` v8.59.0 → v8.60.0 |
| #494 | 2026-05-27 | `tmp` → v0.2.6 [SECURITY] |

The `tmp` security patch (#494) is the only notable deviation from routine Renovate cadence — the commit message flags `[SECURITY]`, meaning a CVE-triggered bump was processed ahead of the weekly schedule.

The `package.json` at HEAD also reveals several devDependencies now explicitly declared that were previously implicit or unlisted in surveys: `@types/node` 24.12.0, `@vitest/eslint-plugin` 1.6.1, `esbuild-plugin-polyfill-node` 0.3.0, `eslint-plugin-prettier` 5.5.0. These may have been present in the lockfile but are now promoted to first-class manifest entries — consistent with a deliberate effort to make the dependency graph auditable. The `esbuild-plugin-polyfill-node` entry is functionally interesting: it confirms the web extension build uses explicit Node.js polyfills rather than relying on esbuild/tsup auto-polyfill behavior.

Confirmed dependency snapshot at HEAD (`73790dd8`):

- Runtime: pnpm 10.34.0, Node 24.16.0, VS Code engine `^1.102.0`
- Core: `typescript` 5.9.3, `tsup` 8.5.1 (pinned), `vitest` 4.1.0
- Lint: `eslint` 10.4.0, `typescript-eslint` 8.60.0
- VS Code tooling: `@types/vscode` 1.120.0, `@vscode/vsce` 3.9.0
- Build helpers: `type-fest` 5.7.0, `esbuild-plugin-polyfill-node` 0.3.0 (explicit)

Repo metadata: 1 star, 1 watcher, not archived, not forked. Open issues: 6 (#142, #162, #317–#319, #466). Open PRs: 1 (#466, `typescript` v6 — pending, now carrying `major` + `dependencies` labels).

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward (~7+ weeks open across surveys). Six workflows present, unchanged: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`.

### 2026-06-18 (SHA `5724bd8b` from `73790dd8`)

Five dependency bumps merged between 2026-06-11 and 2026-06-18. One security patch included. No structural, architectural, or workflow changes — the toolkit's drift remains pure dependency maintenance.

| PR | Date | Change |
| --- | --- | --- |
| #503 | 2026-06-18 | All non-major dependencies → v24.17.0 (grouped `@types`/Node bump) |
| #502 | 2026-06-15 | `form-data` → v4.0.6 [SECURITY] |
| #501 | 2026-06-15 | `eslint` monorepo → v10.5.0 |
| #500 | 2026-06-15 | `@types` devDependencies → v24.13.2 |
| #499 | 2026-06-11 | `typescript-eslint` v8.60.0 → v8.61.0 |

The `form-data` security patch (#502) is the second consecutive survey to surface a CVE-triggered bump out of routine cadence — `tmp` (#494) carried the same `[SECURITY]` flag on 2026-05-27. Two transitive-dependency CVEs in three weeks is a signal worth watching, but both were patched promptly via Renovate's vulnerability path; the daemon is doing its job.

Confirmed dependency snapshot at HEAD (`5724bd8b`):

- Runtime: pnpm 10.34.0, Node 24.16.0 (`.node-version`), VS Code engine `^1.102.0`
- Core: `typescript` 5.9.3, `tsup` 8.5.1 (pinned), `vitest` 4.1.0
- Lint: `eslint` 10.5.0, `typescript-eslint` 8.61.0, `@bfra.me/eslint-config` 0.51.0, `eslint-plugin-node-dependencies` 2.2.0, `eslint-plugin-prettier` 5.5.0, `eslint-config-prettier` 10.1.1, `prettier` 3.8.0
- VS Code tooling: `@types/vscode` 1.120.0, `@types/node` 24.13.2, `@vscode/vsce` 3.9.0
- Build helpers: `type-fest` 5.7.0, `esbuild-plugin-polyfill-node` 0.3.0 (explicit web polyfill), `tsx` 4.22.0, `jiti` 2.7.0
- Publishing: `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5

Repo metadata: 1 star, 1 watcher, not archived, not forked, public. Open issues: 5 (#142 Uplift `vscode-bash`, #162 Dependency Dashboard, #317–#319 Advanced Testing Infrastructure Phases 3–5). Open PRs: 1 (#466, `typescript` v6 — still the sole outstanding major, now ~7 weeks pending). The pin-exact devDependency policy holds: every entry in `package.json` is an exact version. The `prepare` script runs `generate:meta` (vscode-ext-gen), confirming generated metadata is regenerated on install.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward (~8+ weeks open across surveys). Six workflows present, unchanged: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`. Probot settings still extend `fro-bot/.github:common-settings.yaml`.

### 2026-06-29 (SHA `347447ca` from `5724bd8b`)

Four dependency bumps merged between 2026-06-22 and 2026-06-25. One security patch included. No structural, architectural, or workflow changes — the toolkit continues its steady-state dependency drift.

| PR | Date | Change |
| --- | --- | --- |
| #507 | 2026-06-25 | `typescript-eslint` v8.61.0 → v8.62.0 |
| #506 | 2026-06-24 | All non-major dependencies (grouped) |
| #505 | 2026-06-22 | `tmp` → v0.2.7 [SECURITY] |
| #504 | 2026-06-18 | `playwright` monorepo → v1.61.0 |

The `tmp` security patch (#505) is the **third consecutive survey** to surface a CVE-triggered bump out of routine cadence — `tmp` first patched at #494 (v0.2.6, 2026-05-27), `form-data` at #502 (2026-06-15), and now `tmp` again at #505 (v0.2.7). The repeat on `tmp` suggests an incomplete first patch or a freshly disclosed CVE in the same transitive dependency; either way Renovate's vulnerability path keeps closing them inside a day. The daemon stays ahead of the rot.

Confirmed dependency snapshot at HEAD (`347447ca`):

- Runtime: pnpm 10.34.0, Node 24.18.0 (`.node-version`, bumped from 24.16.0), VS Code engine `^1.102.0`
- Core: `typescript` 5.9.3, `tsup` 8.5.1 (pinned), `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `@vitest/eslint-plugin` 1.6.1, `@vitest/ui` 4.1.0
- Lint: `eslint` 10.5.0, `typescript-eslint` 8.62.0, `@bfra.me/eslint-config` 0.51.0, `eslint-plugin-node-dependencies` 2.2.0, `eslint-plugin-no-only-tests` 3.4.0, `eslint-plugin-prettier` 5.5.0, `eslint-config-prettier` 10.1.1, `prettier` 3.8.0
- VS Code tooling: `@types/vscode` 1.120.0, `@types/node` 24.13.2, `@vscode/vsce` 3.9.0, `@vscode/test-electron` 2.5.2, `@vscode/test-web` 0.0.67, `@vscode/test-cli` 0.0.10, `vscode-ext-gen` 1.6.0
- Publishing: `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5, `@semantic-release/changelog` 6.0.3, `@semantic-release/git` 10.0.1
- Testing/build: `@playwright/test` 1.61.0, `jsdom` 29.1.0, `type-fest` 5.7.0, `esbuild-plugin-polyfill-node` 0.3.0 (explicit web polyfill), `tsx` 4.22.0, `jiti` 2.7.0

Repo metadata: **2 stars** (up from 1), 1 watcher, not archived, not forked, public. Open issues: 5 (#142 Uplift `vscode-bash`, #162 Dependency Dashboard, #317–#319 Advanced Testing Infrastructure Phases 3–5 — issue set unchanged across ~10 weeks of surveys). Open PRs: 2 — #466 (`typescript` v6, still the sole outstanding major, now ~9 weeks pending) and **new #508** (`pnpm` → v11, labeled `security` + `automerge`, marked `[SECURITY]`). #508 is a major runtime bump (pnpm 10 → 11) on the automerge track; worth watching whether it lands clean given the pinned `packageManager: pnpm@10.34.0` field must move in lockstep.

The pin-exact devDependency policy holds: every entry in `package.json` is an exact version. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward (~10 weeks open across surveys). Six workflows present, unchanged.
