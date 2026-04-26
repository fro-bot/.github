---
type: topic
title: VS Code Extension Development
created: 2026-04-18
updated: 2026-04-25
tags: [vscode, vscode-extension, typescript, extension-development]
related:
  - marcusrbrown--extend-vscode
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
