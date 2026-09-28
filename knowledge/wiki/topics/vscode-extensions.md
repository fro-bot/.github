---
type: topic
title: VS Code Extension Development
created: 2026-04-18
updated: 2026-09-15
sources:
  - url: https://github.com/marcusrbrown/extend-vscode
    sha: 2c78b3d2b86a0f3dd09171131ae6e29916118fcc
    accessed: 2026-09-15
tags: [vscode, vscode-extension, typescript, extension-development, semantic-release]
related:
  - marcusrbrown--extend-vscode
  - github-actions-ci
---

# VS Code Extension Development

Patterns and tooling for building VS Code extensions across the Fro Bot ecosystem.

## Repos

- [[marcusrbrown--extend-vscode]] — Modular toolkit for VS Code extension development (TypeScript, dual Node/Web targets, tsup, Vitest)

## Architecture Patterns Observed

### Controller-Based Lifecycle

A central `ExtensionController` manages extension state and disposable cleanup. All features register disposables through the controller or `context.subscriptions`, preventing memory leaks. This replaces the common anti-pattern of scattering disposal logic across unrelated modules.

### Feature-Module Convention

Each feature lives in its own directory under `src/` and exports a `setup*(context)` function. New features slot in by:

1. Creating a `src/featureX/` directory
2. Exposing a `setupFeatureX(context)` function returning disposables
3. Wiring it into `activate()` in `src/extension.ts`

### Dual-Target Builds (Node + Web)

VS Code supports both Node.js-hosted and browser-hosted extensions. A dual-target build (via tsup with separate platform configs) produces `out/node/` and `out/web/` outputs from the same source. Platform detection is handled via build-time environment variables.

### Generated Metadata

`vscode-ext-gen` generates TypeScript types and constants from `package.json` contribution points (commands, configuration keys, view IDs). This eliminates string-literal drift between the manifest and source code.

## Build Tooling

| Tool                                       | Role                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| tsup                                       | Fast bundler for dual Node/Web outputs               |
| Vitest                                     | Unit + web extension testing                         |
| `@vscode/test-electron`                    | Integration testing with real VS Code instance       |
| Playwright                                 | Visual regression testing                            |
| `vscode-ext-gen`                           | Type generation from package.json                    |
| semantic-release + `semantic-release-vsce` | Automated publishing to Marketplace + OpenVSIX + npm |

## Publishing Targets

Extensions in this ecosystem publish to three registries:

1. **VS Code Marketplace** — Primary distribution (VSIX)
2. **OpenVSIX** — Open registry for VS Code forks (VSCodium, etc.)
3. **npm** — Library consumption for reusable toolkit modules

## Testing Strategy

| Layer       | Purpose                                  | Tool                    |
| ----------- | ---------------------------------------- | ----------------------- |
| Unit        | Fast logic tests with mocked VS Code API | Vitest                  |
| Web         | Browser extension target tests           | Vitest (web config)     |
| Integration | End-to-end with real VS Code             | `@vscode/test-electron` |
| Visual      | Screenshot-based regression              | Playwright              |

## Release Posture

### Correction: the pipeline was never unexercised (2026-09-15)

The 2026-08-31 section below is preserved because its *advice* survives, but its central factual claim does not. `publish.yaml` at [[marcusrbrown--extend-vscode]] fires on every push to `main` and has run **233 times since 2025-08-17**. It failed 230 of them. It succeeded end-to-end — `Semantic Release` job green — on **three runs on 2025-11-01**.

So the chain is not unverified. It was verified, and then it stopped being able to reach the release job: since 2025-11-01 the `vulnerabilities` leg of the 8-way `pre-release-validation` matrix fails, `fail-fast: true` cancels the other seven, and `semantic-release` is skipped by `needs:`. Zero tags is the downstream symptom of a red supply-chain gate, not of an unwired pipeline.

Three things this changes for anyone reading the guidance below:

1. **The recommendation to "add a `publish:dry-run` invocation to CI so the packaging legs stay exercised" is already satisfied and was not sufficient.** The legs run. They are cancelled before they report. Exercising a pipeline does not help if its result is not required reading — `Publish` is not in `required_status_checks.contexts`, so ten months of red blocked nothing and notified no one. See [[github-actions-ci]], *A Release Gate Outside the Required Set Degrades to No Gate*.
2. **Count the runs before calling a pipeline untested.** "Never released" and "never ran" look the same from the repository root and call for opposite fixes. The run history is the only thing that separates them, and it is one API call.
3. **The pre-seeded-changelog point stands unchanged.** It was a liability on 2025-08-17 and it is a liability now; the `releases/tag/v0.1.0` link has 404'd for thirteen months.

### `@types/vscode` drifts; `engines.vscode` does not (2026-09-15)

A VS Code extension carries two independent statements about which API surface it targets:

| Declaration | Meaning | Who moves it |
| --- | --- | --- |
| `devDependencies["@types/vscode"]` | what the compiler will accept | Renovate, continuously |
| `engines.vscode` | what the Marketplace will let you install on | a human, never |

At [[marcusrbrown--extend-vscode]] these have diverged by **35 minor versions**: `@types/vscode` reached **1.137.0** on 2026-09-15 (1.125.0 → 1.134.0 → 1.137.0 in a two-week window) while `engines.vscode` has read **`^1.102.0`** across all seventeen surveys since 2026-04-18. Nothing in the repo compares them — not `Run Checks`, not the `manifest` validation leg of `publish.yaml`, not ESLint.

The failure mode is quiet and ships to users: the compiler accepts any API introduced through 1.137, the manifest promises the extension runs on 1.102, and the first person to find the gap is someone on an older VS Code getting an `undefined is not a function` at activation. Nothing here is broken today — no post-1.102 API use was verified, and `src/` was out of read scope — but the *guardrail* is verifiably absent, and for a toolkit published to three registries for third-party consumption that is the durable finding.

**The pattern to adopt:** treat `@types/vscode` as version-locked to `engines.vscode` rather than as an ordinary devDependency. Either pin it exactly to the engine floor and bump both in one commit, or add a manifest-validation assertion that fails when the types major.minor exceeds the engine floor. Renovate can express the first directly (a `matchPackageNames: ['@types/vscode']` rule with `enabled: false`, so the pin only moves when a human moves the engine); the second is a five-line check in whatever script already validates the manifest. The general shape — *an automated updater advancing one half of a two-sided contract* — is the same class as the Wagmi-version staleness recorded in [[web3-defi]], where an abstraction absorbed a major bump and the non-code surfaces kept describing the old version.

### The unexercised publish pipeline (2026-08-31)

Observed at [[marcusrbrown--extend-vscode]]: a complete three-target semantic-release pipeline — `semantic-release-vsce` (Marketplace VSIX), `ovsx` (OpenVSIX), `@semantic-release/npm` — plus an emergency per-platform rollback workflow with a confirmation gate, `release.config.mjs`, token-validation and publish-utility scripts, and `CHANGELOG.md` wired into the published `files[]` array. As of 2026-08-31 it has produced **zero git tags and zero GitHub releases**; `version` has read `0.1.0` since the repo's first survey (2026-04-18).

The seeded `CHANGELOG.md` entry is formatted as semantic-release output and links to `releases/tag/v0.1.0`, a URL that 404s because the tag was never created.

Two things this is worth remembering for:

1. **VS Code extension publishing has an unusually high setup cost** — three registries, three credential sets (`VSCE_PAT`, `OVSX_TOKEN`, npm), and a VSIX packaging step that diverges from ordinary npm publishing. Building it before you need it is defensible. The observable consequence is that the entire chain stays *unverified* until the first real release, while dependency automation keeps mutating it underneath (`semantic-release` 25.x, `@vscode/vsce` 3.9.0, `ovsx` 0.10.5 have all moved since the pipeline was authored).
2. **A pre-seeded changelog is a liability, not a head start.** It asserts a release that does not exist and its permalink is broken from day one. Let the release tool write its own history; an empty `CHANGELOG.md` is more honest than a fictional one.

Guidance for future extension repos in this ecosystem: if the publish path is not going to run soon, add a `publish:dry-run` invocation to CI (the script already exists at extend-vscode) so at least the packaging and token-validation legs stay exercised. An untested release path is a footgun that only discharges on the day you most need it to work.
