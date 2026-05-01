---
type: repo
title: "marcusrbrown/renovate-config — Shareable Renovate Configuration Presets"
created: 2026-04-28
updated: 2026-04-30
sources:
  - url: https://github.com/marcusrbrown/renovate-config
    sha: bf13a82fca143cd0cdcc9c5f12ef56c2b5196c20
    accessed: 2026-04-28
  - url: https://github.com/marcusrbrown/renovate-config
    sha: eecda7763e588c770a502b3a0b0c257f73c912c8
    accessed: 2026-04-30
tags: [renovate, renovate-config, renovate-preset, semantic-release, dependency-management]
aliases: [renovate-config]
related:
  - marcusrbrown--github
  - marcusrbrown--ha-config
  - marcusrbrown--containers
  - marcusrbrown--dotfiles
  - marcusrbrown--systematic
  - marcusrbrown--infra
  - marcusrbrown--gpt
  - marcusrbrown--vbs
  - marcusrbrown--copiloting
  - marcusrbrown--extend-vscode
  - marcusrbrown--mrbro-dev
  - marcusrbrown--tokentoilet
  - marcusrbrown--marcusrbrown
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--esphome-life
  - marcusrbrown--sparkle
---

# marcusrbrown/renovate-config

Shareable [Renovate](https://docs.renovatebot.com/) configuration presets for Marcus R. Brown's personal GitHub repositories. This is the canonical dependency-update policy source consumed by every `marcusrbrown/*` and `fro-bot/*` repo.

## Repository Basics

| Field | Value |
| --- | --- |
| Owner | `marcusrbrown` |
| Visibility | Public |
| License | MIT |
| Language | JavaScript (config-only; no application code) |
| Created | 2022-05-03 |
| Default branch | `main` |
| Latest release | `5.0.1` (2026-04-30) |
| Node.js | 24.15.0 (`.node-version`) |
| Package manager | pnpm 10.33.2 |
| Topics | renovate, renovate-config, renovate-preset, renovatebot, renovate-by-githubaction, semantic-release |
| Open issues | 30 |
| Stars / Watchers / Forks | 0 / 0 / 0 |

## Preset Architecture

Three preset files define the Renovate policy surface:

### `default.json` — Primary Preset

The main preset extended by downstream repos via `github>marcusrbrown/renovate-config` (or pinned to a release, e.g., `#5.0.1`).

Extends:
- `:assignAndReview(marcusrbrown)` — auto-assign PRs to Marcus
- `:preserveSemverRanges` — keep `^`/`~` ranges as-is
- `group:allNonMajor` — **[v5.0.0 breaking]** groups all non-major dependency updates into a single PR
- `npm:unpublishSafe` — wait for npm unpublish window before updating
- `helpers:pinGitHubActionDigestsToSemver` — pin GitHub Actions by digest with semver tag comments
- `github>bfra-me/renovate-config#5.2.1` — base config from the bfra-me organization
- `github>bfra-me/renovate-config:fro-bot.json5#5.2.1` — Fro Bot-specific overrides from bfra-me

Key package rules:
- **semantic-release grouping:** Groups major updates of `semantic-release` and `conventional-changelog-conventionalcommits` with `semanticCommitType: feat`
- **Own-project fast-track:** Automerges `@bfra.me/*`, `bfra-me/*`, `@fro.bot/*`, `fro-bot/*`, `@marcusrbrown/*`, `marcusrbrown/*`, and `pro-actions/*` packages with no minimum release age and immediate PR creation
- **Source URL fast-track:** Same immediate/no-age treatment for packages sourced from `github.com/bfra-me`, `github.com/fro-bot`, or `github.com/marcusrbrown`
- **Self-reference labeling:** Commits touching `marcusrbrown/renovate-config` use topic `{{{depName}}} preset`
- **Minimum version floor:** Consumers of this preset must be on `>=4.0.0`

**v5.0.0 breaking changes (2026-04-30):**
- `:disableRateLimiting` removed — rate limiting now uses Renovate defaults (inherited from bfra-me base config)
- `group:allNonMajor` added — all non-major updates (minor, patch, digest, pin) grouped into a single PR per repo
- Schedule override (`at any time`) removed — schedule now inherited from base config

**v5.0.1 fix (2026-04-30):**
- Ensured specific package rules (semantic-release grouping, own-project fast-track) override the broad `group:allNonMajor` preset by placing them after the extends list

**v4.5.9 fix (2026-04-30):**
- Re-enabled rate limiting (was previously disabled via `:disableRateLimiting`)
- Removed explicit schedule override

Suppresses `prIgnoreNotification`.

### `onboarding.json` — New Repository Bootstrap

Configures the Renovate onboarding PR for new `marcusrbrown` repositories:
- Extends `github>marcusrbrown/renovate-config` in the onboarding config
- Sets `enabled: false` initially (opt-in after merge)
- Config filename: `.github/renovate.json5`
- PR title: `feat(deps): configure Renovate`
- Includes a rebase checkbox

### `archived-repository.json` — Archived Repository Policy

A minimal preset for archived repos:
- Disables automerge, package updates, and vulnerability alerts
- Enables lockfile maintenance with an empty schedule (effectively disabled)
- Auto-closes the dependency dashboard
- Sets `rebaseWhen: never`, `recreateWhen: never`
- Zero rate limits (PR hourly/concurrent set to 0)
- Only `npm` manager enabled

## Self-Referential Configuration

`.github/renovate.json5` configures Renovate for _this_ repository:
- Extends `local>marcusrbrown/renovate-config` (self-reference) and `github>sanity-io/renovate-config:semantic-commit-type`
- Custom regex manager tracks `bfra-me/renovate-config` preset version pins in `default.json` against GitHub releases
- Package rules set `semanticCommitType: build` for semantic-release ecosystem packages
- Post-upgrade tasks: `pnpm run bootstrap && pnpm run fix`

## Release Pipeline

Uses `semantic-release` with conventional commits:

- Analyzed types: `feat` (minor), `fix` (patch), `build` (patch), `ci/renovate` (minor), `docs/readme.md` (patch)
- Plugins: commit-analyzer, release-notes-generator, npm (private — no publish), GitHub releases, `semantic-release-export-data`
- Tag format: `${version}` (bare semver, e.g., `5.0.1`)
- On release: pushes/creates a major version branch (`v4`, `v5`, etc.) pointing to the release SHA — enables downstream `#v5` pins
- Release commits authored by `mrbro-bot[bot]` (app ID 137683033)
- GitHub App token used for release pushes (`APPLICATION_ID` + `APPLICATION_PRIVATE_KEY` secrets)

### Recent Release History

| Version | Date | Type | Key Change |
| --- | --- | --- | --- |
| `5.0.1` | 2026-04-30 | patch | Ensure specific package rules override preset groups |
| `5.0.0` | 2026-04-30 | **major** | Group all non-major deps by default; re-enable rate limiting |
| `4.5.9` | 2026-04-30 | patch | Re-enable rate limiting; remove schedule override |
| `4.5.8` | 2026-04-17 | patch | Prior stable release |

## CI Pipeline

### `main.yaml`

Two sequential jobs:

1. **Lint** — pnpm install, `pnpm run lint` (ESLint with `@bfra.me/eslint-config` + Prettier)
2. **Release** — semantic-release with dry-run on PRs, real release on main push

### `renovate.yaml`

Uses reusable workflow `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.11`. Triggers on issue edits, PR edits, push to non-main branches, manual dispatch, and `workflow_run` after main CI succeeds. Includes `path-filters` scoped to Renovate config files and presets.

### `codeql-analysis.yaml` — CodeQL security scanning

### `scorecard.yaml` — OpenSSF Scorecard

### `update-repo-settings.yaml` — Probot Settings sync

## Fro Bot Integration

**Fro Bot workflow present and active** — `fro-bot.yaml` with `fro-bot/agent@v0.42.4` (SHA `c749e07137c53bba55d86d3dcb5f36babd8bc0c1`).

Trigger surface:
- Issue comments, PR review comments, discussion comments (mentioning `@fro-bot`)
- Issues opened/edited (non-bot)
- PRs opened/synced/reopened/ready_for_review/review_requested (non-bot, non-fork)
- Daily schedule at 15:30 UTC
- Manual dispatch with custom prompt
- Reusable `workflow_call` with prompt input

PR review prompt is domain-specific to Renovate configuration:
- JSON schema compliance
- Backward compatibility for version-pinned consumers
- packageRules correctness (matchers, grouping, automerge, schedules)
- Security implications of update policies
- Downstream PR storm risk assessment
- Structured verdict: PASS / CONDITIONAL / REJECT with blocking issues, non-blocking concerns, missing tests, and risk assessment

Schedule prompt: rolling daily maintenance issue with 14-day bounded history, stale issue/PR tracking, and recommended actions.

**Fro Bot Autoheal** — `fro-bot-autoheal.yaml`, daily at 03:30 UTC, reuses `fro-bot.yaml` via `workflow_call`.

Five autohealing categories:
1. **Errored PRs** — diagnose and fix failing CI on open PRs (skip dep/security PRs, verify author trust)
2. **Security** — remediate Dependabot/Renovate security alerts and failing security PRs
3. **Config Validation & Preset Quality** — validate all preset JSON/JSON5 against Renovate schema, check for deprecated options, verify base preset pin, detect rule conflicts, run lint
4. **Developer Experience** — lint/format auto-fix PRs
5. **bfra-me Ecosystem Health** — report-only audit of action pinning, reusable workflow versions, Scorecard/CodeQL drift, stale TODOs

## Dev Tooling

| Tool | Version / Config |
| --- | --- |
| ESLint | 10.2.1, extends `@bfra.me/eslint-config` 0.51.0 |
| Prettier | 3.8.3, extends `@bfra.me/prettier-config/120-proof` |
| lint-staged | 16.4.0 (`*.{js,json,jsx,md,toml,ts,tsx,yml,yaml}`) |
| simple-git-hooks | 2.13.1 (pre-commit runs lint-staged) |
| semantic-release | 25.0.3 |
| eslint-config-prettier | 10.1.8 |
| eslint-plugin-prettier | 5.5.5 |
| markdownlint | 0.40.0 |

ESLint config (`eslint.config.js`) is a single re-export of `@bfra.me/eslint-config` — no local overrides.

## Probot Settings

`.github/settings.yml` extends `fro-bot/.github:common-settings.yaml`:
- Topics: renovate, renovate-config, renovate-preset, renovatebot, renovate-by-githubaction, semantic-release
- Branch protection on `main`: required checks (Analyze, CodeQL, Fro Bot, Lint, Release, Renovate / Renovate), enforce admins, linear history, no PR reviews required
- No restrictions on pushes

## AGENTS.md

Contains comprehensive AI development guidance:
- Project overview with architecture and key technologies
- Setup and development workflow (pnpm)
- Testing instructions (lint-staged, ESLint, Prettier)
- Code style rules (JSON schema, 2-space indent, descriptions required)
- Build and deployment (semantic-release, conventional commits)
- PR guidelines and automerge rules
- Security considerations (npm:unpublishSafe, GitHub Actions digest pinning, GitHub App tokens)
- Renovate preset authoring patterns and testing strategies

## Downstream Consumers

This preset is the dependency-update policy backbone of the entire `marcusrbrown` ecosystem. Known consumers (from wiki surveys):

| Consumer | Pin | Post-Upgrade Tasks |
| --- | --- | --- |
| [[marcusrbrown--ha-config]] | `#4.5.8` | Prettier |
| [[marcusrbrown--github]] | `#4.5.8` | `npx prettier --write .` |
| [[marcusrbrown--containers]] | `#4.5.0` | `pnpm install && pnpm format` |
| [[marcusrbrown--dotfiles]] | `#4.5.8` | — |
| [[marcusrbrown--gpt]] | `#4.5.8` | — |
| [[marcusrbrown--vbs]] | `#4.5.8` | `pnpm install && pnpm fix` |
| [[marcusrbrown--copiloting]] | `#v4` | — |
| [[marcusrbrown--extend-vscode]] | `#4.5.0` + `sanity-io/renovate-config` | — |
| [[marcusrbrown--infra]] | `#4.5.8` | `bun install --ignore-scripts && bun run fix` |
| [[marcusrbrown--mrbro-dev]] | `#4.5.8` | — |
| [[marcusrbrown--tokentoilet]] | `#4.5.8` | — |
| [[marcusrbrown--marcusrbrown]] | `#4.5.1` | bootstrap + fix |
| [[marcusrbrown--marcusrbrown-github-io]] | `#4.5.8` | — |
| [[marcusrbrown--systematic]] | extends + `sanity-io/renovate-config:semantic-commit-type` | — |
| [[marcusrbrown--opencode-copilot-delegate]] | `#4.5.8` | bun install + fix + build |
| [[marcusrbrown--esphome-life]] | `#4.5.1` | — |
| [[marcusrbrown--sparkle]] | (pin TBD from survey) | — |

Notable: `marcusrbrown--copiloting` pins to the floating `#v4` major branch rather than a specific release — the v5.0.0 breaking change will not affect it until the pin is manually updated. `marcusrbrown--containers` and `marcusrbrown--extend-vscode` are on the older `#4.5.0` pin. All consumers pinned to specific v4 releases are unaffected by the v5 breaking changes until they bump their pin.

### v5 Migration Impact

The v5.0.0 release introduces two behavioral changes for consumers who upgrade:
1. **Non-major grouping**: All minor/patch/digest updates will be bundled into a single PR instead of individual PRs. This reduces PR volume but increases the blast radius of each merged PR.
2. **Rate limiting restored**: Consumers previously benefiting from `:disableRateLimiting` will now see default Renovate rate limits (inherited from `bfra-me/renovate-config`). This may slow PR creation cadence.

Consumers pinned to `#v4` (like `copiloting`) will automatically get the v5 changes if their pin is updated to `#v5`. Consumers on exact version pins (like `#4.5.8`) are insulated until they bump.

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-04-28 | `bf13a82` | Initial survey |
| 2026-04-30 | `eecda77` | v5.0.0 breaking: group all non-major, re-enable rate limiting; v4.5.9 + v5.0.1 fixes; Fro Bot agent → v0.42.4; bfra-me workflows → v4.16.11 |
