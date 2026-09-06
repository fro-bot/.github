---
type: topic
title: VS Code Extension Development
created: 2026-04-18
updated: 2026-08-31
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

### The unexercised publish pipeline (2026-08-31)

Observed at [[marcusrbrown--extend-vscode]]: a complete three-target semantic-release pipeline — `semantic-release-vsce` (Marketplace VSIX), `ovsx` (OpenVSIX), `@semantic-release/npm` — plus an emergency per-platform rollback workflow with a confirmation gate, `release.config.mjs`, token-validation and publish-utility scripts, and `CHANGELOG.md` wired into the published `files[]` array. As of 2026-08-31 it has produced **zero git tags and zero GitHub releases**; `version` has read `0.1.0` since the repo's first survey (2026-04-18).

The seeded `CHANGELOG.md` entry is formatted as semantic-release output and links to `releases/tag/v0.1.0`, a URL that 404s because the tag was never created.

Two things this is worth remembering for:

1. **VS Code extension publishing has an unusually high setup cost** — three registries, three credential sets (`VSCE_PAT`, `OVSX_TOKEN`, npm), and a VSIX packaging step that diverges from ordinary npm publishing. Building it before you need it is defensible. The observable consequence is that the entire chain stays *unverified* until the first real release, while dependency automation keeps mutating it underneath (`semantic-release` 25.x, `@vscode/vsce` 3.9.0, `ovsx` 0.10.5 have all moved since the pipeline was authored).
2. **A pre-seeded changelog is a liability, not a head start.** It asserts a release that does not exist and its permalink is broken from day one. Let the release tool write its own history; an empty `CHANGELOG.md` is more honest than a fictional one.

Guidance for future extension repos in this ecosystem: if the publish path is not going to run soon, add a `publish:dry-run` invocation to CI (the script already exists at extend-vscode) so at least the packaging and token-validation legs stay exercised. An untested release path is a footgun that only discharges on the day you most need it to work.
