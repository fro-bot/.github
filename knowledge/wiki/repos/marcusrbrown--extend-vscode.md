---
type: repo
title: marcusrbrown/extend-vscode
created: 2026-04-18
updated: 2026-08-31
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
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: c322c419b6c3f50fd1515c022871e47ad4e4c35d
    accessed: 2026-07-13
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 9ecc7a554408716c714ab384240d623bf6cb6888
    accessed: 2026-08-02
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 2a3ec00223b951119cce53664dd8ce03ffa63d05
    accessed: 2026-08-31
tags:
  - vscode
  - vscode-extension
  - typescript
  - toolkit
  - tsup
  - vitest
  - semantic-release
  - renovate
aliases:
  - extend-vscode
related:
  - vscode-extensions
  - marcusrbrown--renovate-config
  - github-actions-ci
  - probot-settings
node_id: MDEwOlJlcG9zaXRvcnkzMTMzNjg1OTU=
---

# marcusrbrown/extend-vscode

Modular toolkit for building VS Code extensions. Provides typed abstractions for commands, webviews, tree views, status bar, tasks, telemetry, configuration, and logging — targeting both Node.js and Web (browser) extension hosts.

## Overview

- **Purpose:** Reference extension + reusable toolkit for VS Code extension development
- **Default branch:** `main`
- **Created:** 2020-11-16
- **Last push:** 2026-08-31 (re-verified 2026-08-31; repo id `313368595`, `private: false`, not a fork, not archived)
- **Version:** 0.1.0 (pre-release, semantic-release configured — **never fired**: zero tags, zero GitHub releases as of 2026-08-31)
- **License:** MIT
- **Engine:** VS Code `^1.102.0`
- **Topics:** `vscode`, `vscode-extension`
- **Package manager:** pnpm 10.34.4 (`packageManager` field; the fleet is on 11.x — see 2026-08-31 delta)
- **Node target:** 24.20.0 (`.node-version`)
- **Tree size:** 156 tracked blobs at HEAD (path list unchanged since 2026-07-28)

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

### Reusable-workflow wiring (verified 2026-08-31)

Both `bfra-me/.github` callers are SHA-pinned to the same ref and — importantly — to the **correct paths**:

| Caller                        | `uses:`                                                          | Pin                         |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------- |
| `renovate.yaml`               | `bfra-me/.github/.github/workflows/renovate.yaml`                | `eb1772eb` (v4.23.0)        |
| `update-repo-settings.yaml`   | `bfra-me/.github/.github/workflows/update-repo-settings.yaml`     | `eb1772eb` (v4.23.0)        |

This is the **counter-example** to the seven-survey settings-sync footgun at [[marcusrbrown--esphome-life]], where `update-repo-settings.yaml` calls the upstream *`renovate.yaml`* and has therefore never applied `settings.yml`. Same operator, same reusable-workflow family, same tag — extend-vscode wired it correctly, so the repair specified in the 2026-08-30 esphome ingest is not hypothetical: it exists verbatim in-fleet at `eb1772eb`. Because the two upstream workflows share an identical secrets signature (`APPLICATION_ID` + `APPLICATION_PRIVATE_KEY`, zero inputs), the difference between the working and broken wiring is one path token. See [[probot-settings]].

`update-repo-settings.yaml` fires on push to `main`, a `23 0` daily cron, and dispatch. Note the cron differs from esphome.life's `23 12` — no shared schedule between the two callers.

### `main.yaml` concurrency-group typo (noted 2026-08-31)

```yaml
concurrency:
  group: ${{ github.workflow }}-$${{ github.event.number || github.ref }}
```

The stray `$` before the second expression makes every group name literally `Main-$<ref>`. Benign — the group still varies per PR/ref, so cancel-in-progress behaves correctly — but it is a literal dollar sign living rent-free in every run's concurrency key. Cosmetic; recorded so a future reader doesn't mistake it for interpolation subtlety.

### Branch Protection

Required status checks on `main`: `Renovate / Renovate`, `Run Checks`. Linear history enforced, admin enforcement enabled, no required PR reviews. Declared in `.github/settings.yml` and applied by the Probot Settings App.

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

### Effective update policy: minors, majors, and CVEs only (established 2026-08-31)

The first `packageRules` entry in `.github/renovate.json5` is a blanket patch kill-switch:

```json5
{
  description: 'Disable patch updates except for select dependencies.',
  matchUpdateTypes: ['patch'],
  matchPackageNames: ['!typescript'],
  enabled: false,
}
```

Written to keep the PR queue quiet, it also makes an entire update class structurally invisible. Two measurable consequences at HEAD:

| Pin                                  | This repo | Fleet current | Frozen since             |
| ------------------------------------ | --------- | ------------- | ------------------------ |
| `marcusrbrown/renovate-config` preset | `#5.2.0`  | `#5.2.12`     | 2026-05-14 (PR #487)     |
| `pnpm/action-setup`                  | `v6.0.0`  | `v6.0.9`      | no minor since adoption  |

The repo's own dependency policy is set by a preset that its own dependency policy prevents it from updating. That is a closed loop — twelve patch releases of [[marcusrbrown--renovate-config]] have shipped without reaching the repo that consumes them. Nothing here is broken; the point is that **the queue looks drain-clean because a whole update class was muted, not because there is nothing to update.**

The security path bypasses the rule (Renovate's vulnerability alerts ignore `enabled: false`), which is why every `[SECURITY]` patch in this repo's history — `tmp` #494/#505, `form-data` #502, pnpm #508 — landed while ordinary patches did not. Same shape as the calendar-versioning suppression recorded at [[marcusrbrown--esphome-life]] (`versioning: loose` + `separateMajorMinor: false`): a rule authored for tidiness converts a class of drift into a blind spot, and the resulting quiet queue reads as health. Cataloged in [[github-actions-ci]].

### Release posture: full pipeline, zero releases

As of 2026-08-31 the repository has **zero git tags and zero GitHub releases**, and `package.json` has read `"version": "0.1.0"` across all sixteen surveys since 2026-04-18. Standing against that: a three-target semantic-release publish workflow, a per-platform emergency rollback workflow with confirmation gate, `release.config.mjs`, `scripts/{rollback,publish-utils,validate-tokens}.ts`, and `CHANGELOG.md` wired into the published `files` array.

`CHANGELOG.md`'s sole entry is `## [0.1.0](https://github.com/marcusrbrown/extend-vscode/releases/tag/v0.1.0) (2025-08-17)` — a hand-seeded entry in semantic-release's output format whose release link 404s, because no `v0.1.0` tag exists. The changelog documents a release that never cut. It is scaffolding wearing the costume of history.

This is not a defect so much as a posture: the publishing chrome was built first and has been maintained by Renovate ever since (`semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5, `@vscode/vsce` 3.9.0 all kept current). The gap worth watching is that an unexercised release path accumulates untested assumptions — the first real `publish.yaml` run will be the first integration test of a pipeline that has been drifting under dependency updates for over a year.

## AI/LLM Context

The repo ships AI context files:

- **`llms.txt`** — Structured LLM context document (architecture, file references, testing, configuration)
- **`.github/copilot-instructions.md`** — GitHub Copilot development guidelines (architecture, patterns, dual-platform support, command registration, testing strategy)

### `.ai/` and `.cursor/` (enumerated 2026-08-31; present but uncataloged in prior surveys)

Both directories predate the 2026-08-31 survey — earlier entries flagged them as "likely additional AI assistant rules" without enumerating. Contents at HEAD:

| Path                 | Files | Contents                                                                                                                                                                                                       |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ai/analysis/`      | 5     | Kebab-case migration artifacts: `conversion-mapping.md`, `edge-cases-analysis.md`, `file-inventory-kebab-case.md`, `import-dependency-analysis.md`, `rollback-procedure.md`                                     |
| `.ai/plan/`          | 8     | `architecture-modern-development-research-1`, `feature-advanced-testing-infrastructure-1`, `feature-configuration-validation-1`, `feature-developer-experience-tooling-1`, `feature-dual-purpose-documentation-1`, `feature-explorer-context-menu-1`, `infrastructure-publishing-workflow-1`, `refactor-kebab-case-naming-1` |
| `.ai/scripts/`       | 2     | `convert-to-kebab-case.mjs`, `convert-to-kebab-case.sh`                                                                                                                                                        |
| `.cursor/rules/`     | 4     | `tsup-best-practices.mdc`, `typescript-best-practices.mdc`, `vitest-best-practices.mdc`, `vscode-extension-best-practices.mdc`                                                                                  |

`.ai/plan/feature-advanced-testing-infrastructure-1.md` is the source document for the long-open issue triad #317/#318/#319 (Advanced Testing Infrastructure Phases 3–5, filed 2025-08-17, untouched for ~12.5 months). The `.ai/analysis/` set is closed work — the kebab-case refactor landed; the plan corpus is the aspirational half.

This is the same **aspirational `.ai/` planning corpus** shape recorded at [[bfra-me--github]] (2026-07-16, 10 plan docs). Two independent repos in the fleet keep a version-controlled plan directory whose contents outlive their execution. Useful signal for a future agent: `.ai/plan/` is intent, not state — do not read it as a description of the repo.

## Fro Bot Integration

**No Fro Bot agent workflow detected** (re-confirmed 2026-08-31, sixteenth consecutive survey, ~19 weeks). The repository does not contain a `fro-bot.yaml` workflow or any Fro Bot-specific CI integration for automated PR review and triage. The six workflows present are all dependency/publish/settings plumbing. A follow-up draft PR should be proposed to add the Fro Bot agent workflow.

The repo references `.github:common-settings.yaml` in its Probot settings (`_extends`), confirming it is part of the Fro Bot-managed ecosystem. Note that a bare `_extends: .github:common-settings.yaml` resolves within the repository's **own owner org** — for `marcusrbrown/*` repos that is `marcusrbrown/.github`, not `fro-bot/.github`. Earlier entries on this page assert `fro-bot/.github:common-settings.yaml`; that is the same misattribution corrected for [[marcusrbrown--esphome-life]] on 2026-07-12. Recorded as a contradiction rather than silently rewritten — the underlying fact (this repo inherits an org-level settings template) holds either way; the resolving org is `marcusrbrown`.

## Notable Patterns

- **Controller pattern:** Single `ExtensionController` centralizes lifecycle management — all disposables register through it, preventing leak vectors common in VS Code extensions.
- **Dual-target architecture:** Same source builds for both Node.js and browser extension hosts via tsup platform splitting. Conditional exports expose modules for library consumption.
- **Feature-module convention:** Each feature follows the `setup*(context)` pattern, returning disposables. New features slot in by adding a folder and wiring into `activate()`.
- **Generated metadata:** `vscode-ext-gen` auto-generates TypeScript types from `package.json` contributions, eliminating string-literal drift between manifest and code.
- **Three-target publishing:** Semantic-release publishes to VS Code Marketplace, OpenVSIX, and npm simultaneously, with rollback support per platform.
- **No external telemetry:** Default telemetry reporter logs only to the VS Code output channel. No data leaves the machine unless a custom reporter is plugged in.
- **Patch suppression as an invisible-drift generator** (2026-08-31): a `matchUpdateTypes: ['patch'] → enabled: false` rule keeps the queue quiet and simultaneously freezes the repo's own Renovate preset pin (`#5.2.0` vs `#5.2.12`) and its action pins (`pnpm/action-setup` v6.0.0 vs v6.0.9). The policy that governs updates is itself an update the policy forbids. See [[github-actions-ci]].
- **A Renovate PR title is mutable state** (2026-08-31): #508 opened as "update pnpm to v11 [SECURITY]" and merged as a `10.34.0 → 10.34.4` patch after Renovate retargeted and retitled the branch. Long-lived bot PRs must be re-read at merge; the branch name and diff are durable, the title is not.
- **Publishing chrome without a release** (2026-08-31): three-target semantic-release, per-platform rollback workflow, seeded `CHANGELOG.md`, and `files[]` packaging — with zero tags and zero releases across 16 surveys. The changelog's `[0.1.0]` link 404s. The pipeline has been maintained by dependency automation for over a year without ever executing.
- **`.ai/plan/` is intent, not state** (2026-08-31): the plan corpus describes eight features, three of which have been open as issues #317–#319 since 2025-08-17 without movement. Same shape as [[bfra-me--github]]'s `.ai/` corpus. Read it as a wishlist, never as documentation.

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

### 2026-07-13 (SHA `c322c419` from `347447ca`)

Six dev dependency bumps merged between 2026-06-29 and 2026-07-09 (#509–#514). No security patch this cycle — the three-survey CVE streak (`tmp` #494/#505, `form-data` #502) breaks here. No structural, architectural, or workflow changes.

| PR | Date | Change |
| --- | --- | --- |
| #514 | 2026-07-09 | `typescript-eslint` v8.62.0 → v8.63.0 |
| #513 | 2026-07-08 | `type-fest` v5.7.0 → v5.8.0 |
| #512 | 2026-07-06 | `tsx` v4.22.0 → v4.23.0 |
| #511 | 2026-07-01 | `@types/vscode` → v1.125.0 |
| #510 | 2026-06-30 | `prettier` v3.8.0 → v3.9.0 |
| #509 | 2026-06-29 | `eslint` v10.5.0 → v10.6.0 |

**The `typescript` v6 major (#466) is finally resolved — by abandonment, not merge.** After ~9 weeks as the sole outstanding major, Renovate **autoclosed #466 unmerged on 2026-07-11** (`merged_at: null`, `closed_at: 2026-07-11T16:32:45Z`, title suffix `- autoclosed`). `typescript` stays pinned at **5.9.3**. Autoclose means Renovate detected the update was superseded, un-schedulable, or blocked (a v6 release line that no longer satisfies the config's constraints), and swept it. The v6 uplift is not done — it's deferred; expect a fresh PR when the ecosystem (`@bfra.me/tsconfig`, `typescript-eslint`, `@types/*`) catches up to a TS 6 baseline. The ghost got swept out of the queue, but the debt didn't leave the building.

**`pnpm` v11 (#508) still open** — the `[SECURITY]` + `automerge`-labeled major from the prior survey has not landed. `packageManager` remains `pnpm@10.34.0`, so the lockstep bump the last survey flagged still hasn't cleared automerge. Worth continued watching: a security-flagged major stuck on the automerge track for 2+ weeks usually means a failing gate (lockfile/`packageManager` field mismatch) rather than a policy hold.

Confirmed dependency snapshot at HEAD (`c322c419`):

- Runtime: pnpm 10.34.0, Node **24.18.0** (`.node-version`, bumped from 24.16.0), VS Code engine `^1.102.0`
- Core: `typescript` 5.9.3 (v6 deferred), `tsup` 8.5.1 (pinned), `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `@vitest/eslint-plugin` 1.6.1, `@vitest/ui` 4.1.0
- Lint: `eslint` 10.6.0, `typescript-eslint` 8.63.0, `@bfra.me/eslint-config` 0.51.0, `@bfra.me/tsconfig` 0.13.0, `eslint-plugin-node-dependencies` 2.2.0, `eslint-plugin-no-only-tests` 3.4.0, `eslint-plugin-prettier` 5.5.0, `eslint-config-prettier` 10.1.1, `prettier` 3.9.0
- VS Code tooling: `@types/vscode` 1.125.0, `@types/node` 24.13.2, `@vscode/vsce` 3.9.0, `@vscode/test-electron` 2.5.2, `@vscode/test-web` 0.0.67, `@vscode/test-cli` 0.0.10, `vscode-ext-gen` 1.6.0
- Publishing: `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5, `@semantic-release/changelog` 6.0.3, `@semantic-release/git` 10.0.1
- Testing/build: `@playwright/test` 1.61.0, `jsdom` 29.1.0, `type-fest` 5.8.0, `esbuild-plugin-polyfill-node` 0.3.0 (explicit web polyfill), `tsx` 4.23.0, `jiti` 2.7.0

Repo metadata: 2 stars, 1 watcher, not archived, not forked, public. `pushed_at` 2026-07-11 (the #466 autoclose branch cleanup; `main` HEAD commit is #514 at 2026-07-09). Open issues: 5 (#142 Uplift `vscode-bash`, #162 Dependency Dashboard, #317–#319 Advanced Testing Infrastructure Phases 3–5 — issue set unchanged across ~12 weeks of surveys). Open PRs: 1 — #508 (`pnpm` v11 [SECURITY], automerge). Note: with #466 closed, the repo now carries **zero pending majors** in the manifest; the only open change is the security automerge.

The pin-exact devDependency policy holds: every entry in `package.json` is an exact version. Nine conditional exports confirmed in `package.json` (`.`, `./commands`, `./configuration`, `./webview`, `./treeView`, `./tasks`, `./statusBar`, `./telemetry`, `./utils`). Root now shows `release.config.mjs` (semantic-release config) and a top-level `types/` directory alongside the tracked `src/`, `test/`, `scripts/`. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward (~12 weeks open across surveys). Six workflows present, unchanged: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`. Probot settings unchanged.

### 2026-08-02 (SHA `9ecc7a55` from `c322c419`)

Seven bumps merged between 2026-07-09 and 2026-07-28 (#515–#521). No security patch this cycle. No structural, architectural, or workflow changes — the toolkit holds its steady-state dependency drift.

| PR | Date | Change |
| --- | --- | --- |
| #521 | 2026-07-27 | `@playwright/test` v1.61.0 → v1.62.0 |
| #520 | 2026-07-23 | `eslint` v10.7.0 → v10.8.0 |
| #519 | 2026-07-20 | `typescript-eslint` v8.64.0 → v8.65.0 |
| #518 | 2026-07-16 | `actions/checkout` action → v6.1.0 |
| #517 | 2026-07-14 | `typescript-eslint` v8.63.0 → v8.64.0 |
| #516 | 2026-07-14 | `actions/setup-node` action → v6.5.0 |
| #515 | 2026-07-09 | `eslint` v10.6.0 → v10.7.0 |

**New tracked artifact: `CHANGELOG.md` is now committed at repo root** and listed in the `package.json` `files` array (`["CHANGELOG.md", "LICENSE.md", "README.md", "out/"]`), so it ships in the published package. The changelog is semantic-release-generated (Conventional Commits header) but currently carries only the `[0.1.0]` (2025-08-17) initial-release entry — no post-1.0 release has cut, consistent with the version pinned at `0.1.0` across every survey. This is a packaging-surface change, not a release event: the daemon wired the changelog into distribution ahead of the first automated release. `release.config.mjs` (noted 2026-07-13) remains the semantic-release config.

**`pnpm` v11 (#508) still open** — the `[SECURITY]` + `automerge`-labeled major has now sat unmerged for ~5 weeks across three surveys (first flagged 2026-06-29). `packageManager` remains `pnpm@10.34.0`. A security-flagged automerge major stalled this long is almost certainly a failing gate, not a policy hold — the standing hypothesis (lockfile / `packageManager`-field lockstep mismatch, or a v11 engine constraint the CI runner doesn't satisfy) holds. Worth a human glance if it crosses the 6-week mark; Renovate won't autoclose a security PR the way it swept the TS v6 major (#466).

Confirmed dependency snapshot at HEAD (`9ecc7a55`):

- Runtime: pnpm 10.34.0, Node **24.18.0** (`.node-version`), VS Code engine `^1.102.0`
- Core: `typescript` 5.9.3 (v6 still deferred post-#466 autoclose), `tsup` 8.5.1 (pinned), `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `@vitest/eslint-plugin` 1.6.1, `@vitest/ui` 4.1.0
- Lint: `eslint` **10.8.0**, `typescript-eslint` **8.65.0**, `@bfra.me/eslint-config` 0.51.0, `@bfra.me/tsconfig` 0.13.0, `eslint-plugin-node-dependencies` 2.2.0, `eslint-plugin-no-only-tests` 3.4.0, `eslint-plugin-prettier` 5.5.0, `eslint-config-prettier` 10.1.1, `prettier` 3.9.0
- VS Code tooling: `@types/vscode` 1.125.0, `@types/node` 24.13.2, `@vscode/vsce` 3.9.0, `@vscode/test-electron` 2.5.2, `@vscode/test-web` 0.0.67, `@vscode/test-cli` 0.0.10, `vscode-ext-gen` 1.6.0
- Publishing: `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5, `@semantic-release/changelog` 6.0.3, `@semantic-release/git` 10.0.1
- Testing/build: `@playwright/test` **1.62.0**, `jsdom` 29.1.0, `type-fest` 5.8.0, `esbuild-plugin-polyfill-node` 0.3.0 (explicit web polyfill), `tsx` 4.23.0, `jiti` 2.7.0

Two of the seven bumps this cycle (#516, #518) are GitHub Actions SHA updates (`actions/setup-node` v6.5.0, `actions/checkout` v6.1.0) — the SHA-pin-with-version-comment discipline holds, managed by Renovate. See [[github-actions-ci]].

Repo metadata: 2 stars, 2 watchers, not archived, not forked, public. `pushed_at` 2026-07-28. Open issues: 5 (#142 Uplift `vscode-bash`, #162 Dependency Dashboard, #317–#319 Advanced Testing Infrastructure Phases 3–5 — issue set unchanged across ~15 weeks of surveys). Open PRs: 1 — #508 (`pnpm` v11 [SECURITY], automerge). Zero pending majors in the manifest.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward (~15 weeks open across surveys). The repo remains part of the Fro Bot-managed ecosystem via Probot (`.github/settings.yml` `_extends: .github:common-settings.yaml`), but has no `fro-bot.yaml` for automated PR review/triage. A follow-up draft PR to add the agent workflow should be proposed separately. Six workflows present, unchanged: `main.yaml`, `publish.yaml`, `rollback.yaml`, `renovate.yaml`, `cache-cleanup.yaml`, `update-repo-settings.yaml`. `.github/` also carries `copilot-instructions.md`, `renovate.json5`, and `settings.yml`.

### 2026-08-31 (SHA `2a3ec002` from `9ecc7a55`)

Fifteen commits merged between 2026-08-03 and 2026-08-31 (#522–#535, plus the long-pending #508), every one a `mrbro-bot[bot]` Renovate automerge. **The recursive tracked-tree path list is byte-identical at `9ecc7a55` and `2a3ec002` — 156 blobs each.** Zero files added, zero removed. Sixteenth consecutive survey with no structural, architectural, or workflow change.

| PR   | Date       | Change                                              |
| ---- | ---------- | --------------------------------------------------- |
| #535 | 2026-08-31 | `bfra-me/.github` → v4.23.0                         |
| #534 | 2026-08-27 | `typescript-eslint` v8.67.0 → v8.68.0                |
| #533 | 2026-08-27 | `bfra-me/.github` → v4.22.0                         |
| #532 | 2026-08-26 | Node.js → v24.20.0 (`.node-version`)                 |
| #531 | 2026-08-26 | `bfra-me/.github` → v4.21.0                         |
| #530 | 2026-08-25 | `@bfra.me/eslint-config` 0.51.0 → 0.52.0             |
| #529 | 2026-08-24 | `eslint` v10.8.0 → v10.9.0                           |
| #528 | 2026-08-23 | `bfra-me/.github` → v4.20.0                         |
| #527 | 2026-08-20 | `bfra-me/.github` → v4.19.0                         |
| #526 | 2026-08-19 | `bfra-me/.github` → v4.18.0                         |
| #525 | 2026-08-17 | `bfra-me/.github` → v4.17.0                         |
| #524 | 2026-08-13 | `typescript-eslint` v8.66.0 → v8.67.0                |
| #508 | 2026-08-13 | `pnpm` → v10.34.4 [SECURITY] — **see correction**    |
| #523 | 2026-08-07 | `typescript-eslint` v8.65.0 → v8.66.0                |
| #522 | 2026-08-03 | Node.js → v24.19.0                                   |

**Open PR queue drained to zero** — first zero-PR reading in the survey series. Open issues steady at 5 (#142, #162, #317–#319), unchanged for ~19 weeks. Stars 2, watchers 2, subscribers 1, forks 0. `pushed_at` 2026-08-31T01:08.

#### Correction: #508 was never a pnpm v11 major

Three prior surveys (2026-06-29, 2026-07-13, 2026-08-02) recorded PR #508 as `chore(deps): update pnpm to v11 [SECURITY]` — a stalled major on the automerge track — and advanced a standing hypothesis that it was blocked by a `packageManager`-field / lockfile lockstep mismatch. **Both the characterization and the hypothesis are wrong**, and the record is corrected here rather than overwritten.

At merge, the PR's title read `chore(deps): update pnpm to v10.34.4 [SECURITY]` and its single commit (`e7e222dd`) is a one-line diff:

```diff
-  "packageManager": "pnpm@10.34.0",
+  "packageManager": "pnpm@10.34.4",
```

Renovate had retargeted and retitled the branch (`renovate/npm-pnpm-vulnerability`) from the v11 line to the in-major patch that carries the same fix. The advisory is **CVE-2026-50021 / GHSA-q6j5-fjx5-2mc3** — pnpm's tarball-extraction worker skipping integrity verification when the lockfile `integrity` field is absent. The security fix landed; the major did not. Prior surveys read a title and inferred a payload. Lesson worth generalizing: **a Renovate PR's title is mutable state, not a record of what it will merge** — the branch name (`-vulnerability`) and the diff are the durable facts, and long-lived PRs should be re-read at merge, not at open.

What survives from the earlier entries: the PR *did* sit ~47 days (2026-06-27 → 2026-08-13) despite carrying `security` + `automerge` labels, so the stall itself was real. What does not survive: the claim that a pnpm major was pending or that a lockstep mismatch was gating it.

#### pnpm 10 holdout, quantified

`packageManager` is now `pnpm@10.34.4`; `pnpm-lock.yaml` is `lockfileVersion: '9.0'`. The fleet crossed pnpm 10 → 11 months ago — [[marcusrbrown--sparkle]] at 11.24.0, [[marcusrbrown--marcusrbrown]] at 11.22.0, [[bfra-me--works]] and [[fro-bot--dashboard]] at 11.20.0, [[marcusrbrown--gpt]] and [[marcusrbrown--containers]] across the boundary since June. extend-vscode is now the fleet's last pnpm-10 repository.

Root cause is not mystery, it is policy: see **Effective update policy** above. `pnpm-workspace.yaml` still uses the pnpm-10 `onlyBuiltDependencies:` key (pnpm 11 renames it to `allowBuilds:`, the migration recorded at [[bfra-me--github]] and [[marcusrbrown--marcusrbrown-com]]), so the eventual v11 crossing carries a real workspace-config edit, not just a field bump. Whoever schedules it should expect the `onlyBuiltDependencies` → `allowBuilds` rewrite plus a lockfile regeneration in the same PR.

The `pnpm-workspace.yaml` override ledger is also recorded here for the first time — 8 entries, all transitive security pins, several matching GHSA ranges (`form-data 4.0.6`, `glob@>=11.0.0 <11.1.0`, `js-yaml@>=4.0.0 <4.1.1`, `koa@>=2.16.2 <2.16.3`, `on-headers 1.1.0`, `tar-fs@>=3.0.0 <3.1.1`, `tmp 0.2.7`, `vite@>=6.0.0 <=6.4.0`) alongside `saveExact: true`, `shamefullyHoist: true`, `shellEmulator: true`, `autoInstallPeers: false`. The `saveExact: true` setting is the mechanical enforcement behind the pin-exact devDependency policy noted since 2026-05-26 — it was never contributor discipline, it was a workspace flag.

#### `bfra-me/.github` minor surge — cross-repo corroboration

Seven minor boundaries in fifteen days: v4.16.x → **v4.23.0** (#525, #526, #527, #528, #531, #533, #535, 08-17 → 08-31). The 2026-08-30 [[marcusrbrown--esphome-life]] survey recorded six-in-eleven-days to v4.22.0 from the same upstream; this repo carries the same wave one release further and independently confirms it is upstream cadence, not a per-repo artifact. Both callers absorbed it as ordinary automerge churn — `bfra-me/*` is deliberately excluded from the `GitHub Actions` grouping rule, so each release arrives as its own PR.

#### Settings-sync wiring: the working reference

`update-repo-settings.yaml` here calls `bfra-me/.github/.github/workflows/update-repo-settings.yaml@eb1772eb` — the correct path, pinned to the same v4.23.0 SHA as its `renovate.yaml` sibling. This is the live in-fleet counter-example to esphome.life's seven-survey miswiring and makes that repair a copy-paste. Recorded in the **Reusable-workflow wiring** section above and in [[probot-settings]].

#### Carried forward

- **TypeScript v6 still deferred.** `typescript` remains 5.9.3. #466 autoclosed unmerged 2026-07-11; ~7 weeks later Renovate has not re-proposed it. Zero pending majors in the manifest — the queue is empty because the proposals are gone, not because the work is done.
- **Still no Fro Bot agent workflow — sixteenth consecutive survey, ~19 weeks.** Six workflows, unchanged. The repo is in the Fro Bot-managed ecosystem by Probot (`_extends: .github:common-settings.yaml`) but has no `fro-bot.yaml`. The recommendation strengthens: this survey produced three actionable items (pnpm 10 → 11 with the `allowBuilds` rewrite, the frozen `#5.2.0` preset pin, the unexercised release pipeline) that a resident autoheal daemon would plausibly have surfaced months ago. A follow-up draft PR to onboard the agent should be proposed separately.
- Code scanning status **unverified** this run — the API returned `401` (unauthenticated), which is inconclusive rather than the `404` that would indicate "not enabled." No claim recorded either way.

#### Dependency snapshot at HEAD (`2a3ec002`)

- Runtime: **pnpm 10.34.4**, Node **24.20.0** (`.node-version`), VS Code engine `^1.102.0`, lockfile `9.0`
- Core: `typescript` 5.9.3 (v6 deferred), `tsup` 8.5.1, `vitest` 4.1.0, `@vitest/coverage-v8` 4.1.0, `@vitest/eslint-plugin` 1.6.1, `@vitest/ui` 4.1.0
- Lint: `eslint` **10.9.0**, `typescript-eslint` **8.68.0**, `@bfra.me/eslint-config` **0.52.0**, `@bfra.me/tsconfig` 0.13.0, `eslint-plugin-node-dependencies` 2.2.0, `eslint-plugin-no-only-tests` 3.4.0, `eslint-plugin-prettier` 5.5.0, `eslint-config-prettier` 10.1.1, `prettier` 3.9.0
- VS Code tooling: `@types/vscode` 1.125.0, `@types/node` 24.13.2, `@vscode/vsce` 3.9.0, `@vscode/test-electron` 2.5.2, `@vscode/test-web` 0.0.67, `@vscode/test-cli` 0.0.10, `vscode-ext-gen` 1.6.0
- Publishing: `semantic-release` 25.0.1, `semantic-release-vsce` 6.1.0, `ovsx` 0.10.5, `@semantic-release/changelog` 6.0.3, `@semantic-release/git` 10.0.1
- Testing/build: `@playwright/test` 1.62.0, `jsdom` 29.1.0, `type-fest` 5.8.0, `esbuild-plugin-polyfill-node` 0.3.0, `tsx` 4.23.0, `jiti` 2.7.0
- Actions: `actions/checkout` v6.1.0 (`d23441a4`), `actions/setup-node` v6.5.0 (`24997072`), `pnpm/action-setup` **v6.0.0** (`08c4be7e`, frozen by the patch rule), `bfra-me/.github` v4.23.0 (`eb1772eb`)

## Survey History

| Date       | HEAD       | Headline                                                                                              |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 2026-04-18 | `a4dcbbb1` | Initial survey — toolkit architecture, dual-target build, three-target publish pipeline                |
| 2026-04-21 | `342872f8` | Three Renovate bumps; no structural change                                                             |
| 2026-04-23 | `342872f8` | No change; 4 pending majors (#466–#469)                                                                |
| 2026-04-24 | `342872f8` | No change; dependency snapshot confirmed                                                               |
| 2026-04-25 | `342872f8` | No change; 5-day dormancy                                                                              |
| 2026-04-26 | `b457a34f` | `typescript-eslint` 8.59.0; dormancy broken                                                            |
| 2026-04-27 | `b457a34f` | No change; full dependency snapshot                                                                    |
| 2026-05-26 | `516a9eb4` | Renovate preset v4 → **v5.2.0** (#487); `tsup` pinned; 3 of 4 majors closed                            |
| 2026-06-08 | `73790dd8` | `tmp` #494 [SECURITY]; devDeps promoted to explicit manifest entries                                   |
| 2026-06-18 | `5724bd8b` | `form-data` #502 [SECURITY]; second consecutive CVE cycle                                              |
| 2026-06-29 | `347447ca` | `tmp` #505 [SECURITY], third consecutive; #508 opened (mis-read as pnpm v11 major)                     |
| 2026-07-13 | `c322c419` | TS v6 (#466) **autoclosed unmerged**; CVE streak breaks                                                |
| 2026-08-02 | `9ecc7a55` | `CHANGELOG.md` wired into published `files[]`; #508 still open                                         |
| 2026-08-31 | `2a3ec002` | **Tree byte-identical (156 blobs); PR queue drained to 0; #508 corrected — patch, not major; patch-suppression policy root-caused; pnpm-10 holdout; zero releases** |
