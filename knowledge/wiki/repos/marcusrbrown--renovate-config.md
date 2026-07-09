---
type: repo
title: "marcusrbrown/renovate-config — Shareable Renovate Configuration Presets"
created: 2026-04-28
updated: 2026-07-09
sources:
  - url: https://github.com/marcusrbrown/renovate-config
    sha: bf13a82fca143cd0cdcc9c5f12ef56c2b5196c20
    accessed: 2026-04-28
  - url: https://github.com/marcusrbrown/renovate-config
    sha: 3478c88753d113b21c7cf10d9e58fd2f9be7e96a
    accessed: 2026-05-23
  - url: https://github.com/marcusrbrown/renovate-config
    sha: 499f0cac43d2077ab5498ed7b213366cbc74e079
    accessed: 2026-06-04
  - url: https://github.com/marcusrbrown/renovate-config
    sha: 42ee3cd0ad4b26b3976fb4b325a28a292ae6824c
    accessed: 2026-06-14
  - url: https://github.com/marcusrbrown/renovate-config
    sha: 561289f610aa17406424b945395de9d71c1dc69f
    accessed: 2026-06-25
  - url: https://github.com/marcusrbrown/renovate-config
    sha: 12263eb1834844429aad9252fb3094e6604641c0
    accessed: 2026-07-09
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
  - bfra-me--renovate-action
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
| Latest release | `5.2.4` (2026-07-01) — was `5.2.3` (2026-06-13) through 2026-06-25 |
| Node.js | 24.18.0 (`.node-version`) — unchanged since 2026-06-25; was 24.16.0 at 2026-06-14, 24.15.0 prior |
| Package manager | pnpm 11.10.0 (was 11.8.0 at 2026-06-25, 11.5.3 at 2026-06-14, 11.1.3 at 2026-05-23, 10.33.2 at 2026-04-28) |
| Topics | renovate, renovate-config, renovate-preset, renovatebot, renovate-by-githubaction, semantic-release |
| Open issues | 7 — was 6 across 2026-06-04 → 2026-06-25; +1 from **new** deprecated-options config-validation issue #1417 (see note below); was 46 at 2026-04-28 |
| Open PRs | 0 — **both prior PRs resolved**: #1311 (picomatch@2 v4) and #1402 (`undici` override) landed; was 2 at 2026-06-25 |
| Stars / Watchers / Forks | 1 / 2 / 0 (unchanged; first star landed 2026-06-25) |

**Open-issue composition (2026-07-09):** the count moved 6 → 7. Six carry-overs are unchanged — `Daily Autohealing Report` (#1314), `Daily Maintenance Report` (#1111), three legacy `Weekly Maintenance Report — YYYY-MM-DD` issues (#1096/#1079/#1068), and the Renovate `Dependency Dashboard` (#556). The +1 is **new issue #1417 `Renovate config uses deprecated/removed options`** (authored by `fro-bot`) — the category-3 Config Validation & Preset Quality path firing as designed: it cross-referenced the three presets against the Renovate 43.244.1 schema and filed a single tracking issue enumerating deprecated keys (see [Config drift finding](#config-drift-deprecated-options-2026-07-09) below). Everything the autoheal cleanup matcher fails to sweep from prior surveys still lingers: the dated `Daily Autohealing Report — YYYY-MM-DD` matcher does not touch the differently-titled legacy `Daily Maintenance` / `Weekly Maintenance` report issues. Candidate for manual cleanup or a broadened cleanup matcher (durable across five consecutive surveys).

## Preset Architecture

Three preset files define the Renovate policy surface:

### `default.json` — Primary Preset

The main preset extended by downstream repos via `github>marcusrbrown/renovate-config` (or pinned to a release, e.g., `#4.5.8`).

Extends (as of v5.2.0):
- `:assignAndReview(marcusrbrown)` — auto-assign PRs to Marcus
- `:preserveSemverRanges` — keep `^`/`~` ranges as-is
- `group:allNonMajor` — **new in v5**: groups non-major updates from upstream presets (counterbalanced by an unstable-package opt-out, see below)
- `npm:unpublishSafe` — wait for npm unpublish window before updating
- `helpers:pinGitHubActionDigestsToSemver` — pin GitHub Actions by digest with semver tag comments
- `github>bfra-me/renovate-config#5.2.3` — base config from the bfra-me organization (was `#5.2.1` at 2026-06-04; Renovate-bumped via the custom regex manager)
- `github>bfra-me/renovate-config:fro-bot.json5#5.2.3` — Fro Bot-specific overrides from bfra-me

The `:disableRateLimiting` preset present in v4 has been **dropped from the extends list** in v5; rate-limiting now defers to the bfra-me base preset's defaults.

Key package rules:
- **semantic-release grouping:** Groups major updates of `semantic-release` and `conventional-changelog-conventionalcommits` with `semanticCommitType: feat`
- **Own-project fast-track:** Automerges `@bfra.me/*`, `bfra-me/*`, `@fro.bot/*`, `fro-bot/*`, `@marcusrbrown/*` (regex `/^@?marcusrbrown/`), `marcusrbrown/*`, and `pro-actions/*` packages with no minimum release age and immediate PR creation
- **Source URL fast-track:** Same immediate/no-age treatment for packages sourced from `github.com/bfra-me`, `github.com/fro-bot`, or `github.com/marcusrbrown`
- **Self-reference labeling:** Commits touching `marcusrbrown/renovate-config` use topic `{{{depName}}} preset`
- **Minimum version floor:** Consumers of this preset must be on `>=5.0.0` (was `>=4.0.0` in v4.x — **breaking change** for any consumer still pinned below v5)
- **Unstable (0.x) ungrouping (v5.x):** `matchCurrentVersion: /^0\./` sets `groupName: null`, peeling 0.x packages back out of `group:allNonMajor` so each pre-release lib gets its own PR. This is the safety valve that makes the new `group:allNonMajor` extension tolerable for downstream consumers.

Schedule: `at any time` (no restriction).

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
- Tag format: `${version}` (bare semver, e.g., `4.5.8`)
- On release: pushes/creates a major version branch (`v4`, `v5`, etc.) pointing to the release SHA — enables downstream `#v4` pins
- Release commits authored by `mrbro-bot[bot]` (app ID 137683033)
- GitHub App token used for release pushes (`APPLICATION_ID` + `APPLICATION_PRIVATE_KEY` secrets)

## CI Pipeline

### `main.yaml`

Two sequential jobs:

1. **Lint** — pnpm install, `pnpm run lint` (ESLint with `@bfra.me/eslint-config` + Prettier)
2. **Release** — semantic-release with dry-run on PRs, real release on main push

### `renovate.yaml`

Uses reusable workflow `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.35` (SHA `aac0d9b`; was `@v4.16.30` at 2026-06-25, `@v4.16.25` at 2026-06-14, `@v4.16.9` at 2026-05-23). Triggers on issue edits, PR edits, push to non-main branches, manual dispatch, and `workflow_run` after main CI succeeds. Includes `path-filters` scoped to Renovate config files and presets.

### `codeql-analysis.yaml` — CodeQL security scanning

### `scorecard.yaml` — OpenSSF Scorecard

### `update-repo-settings.yaml` — Probot Settings sync

## Fro Bot Integration

**Fro Bot workflow present and active** — `fro-bot.yaml` with `fro-bot/agent@v0.84.2` (SHA `99e7d853bac9c505418920b38a18718420392147`). The agent pin advanced v0.76.2 → v0.84.2 between 2026-06-25 and 2026-07-09 — another fast Renovate-authored cadence, continuing the rapid [[fro-bot--agent]] release tracking (crosses the agent's credential-broker consumer + operator-web-surface wiring arcs documented on [[fro-bot--agent]]; those are runtime-internal to the agent — this repo's workflow invocation surface is unaffected). Runner action pins **all unchanged this window**: `actions/checkout` v6.0.3 (`df4cb1c`), `actions/setup-node` v6.4.0 (`48b55a0`), `pnpm/action-setup` v6.0.9 (`0ebf471`).

Trigger surface:
- Issue comments, PR review comments, discussion comments (mentioning `@fro-bot`)
- Issues opened/edited (non-bot, OWNER/MEMBER/COLLABORATOR only)
- PRs opened/synced/reopened/ready_for_review/review_requested (non-bot, non-fork)
- Daily schedule at 15:30 UTC
- Manual dispatch with custom prompt
- Reusable `workflow_call` with prompt input

**Architectural shift since prior survey:** the separate `fro-bot-autoheal.yaml` is gone. Autoheal now lives inside `fro-bot.yaml` itself, with the schedule prompt covering both maintenance and autoheal categories under a single perpetual issue. Mirrors the single-file three-mode pattern observed in [[marcusrbrown--marcusrbrown-github-io]], though here the dispatch surface is a single freeform `prompt` input rather than a `mode` enum.

PR review prompt remains domain-specific to Renovate configuration:
- JSON schema compliance against `https://docs.renovatebot.com/renovate-schema.json`
- Backward compatibility for consumers pinning to major version branches
- packageRules correctness (`matchPackageNames` patterns, grouping logic, automerge conditions, schedule expressions)
- Security implications of dependency update policies (`minimumReleaseAge`, vulnerability settings, `npm:unpublishSafe`)
- Downstream PR storm risk assessment
- Consistency with the base preset extended from `bfra-me/renovate-config`
- Structured verdict: PASS / CONDITIONAL / REJECT with blocking issues, non-blocking concerns, missing tests, and risk assessment (LOW/MED/HIGH + rationale)
- Hard ban on push, branch creation, merge, approve, request-reviewers, or @-mentioning other users

Daily autohealing categories (now 6, was 5):

1. **Errored PRs** — diagnose and fix failing CI on open PRs (skip dep/security PRs, verify author trust, do not run project commands from PR branches that touch workflows/automation prompts/lockfiles/execution scripts)
2. **Security** — remediate Dependabot/Renovate security alerts and failing security PRs; explicit "if alert data unavailable, skip and note" branch
3. **Config Validation & Preset Quality** — validate all preset JSON/JSON5 against Renovate schema, check for deprecated options, verify base preset pin is released and not auto-bumped (Renovate owns version bumps), detect rule conflicts, run lint
4. **Developer Experience** — lint/format auto-fix PRs only (never direct-to-`main` commits)
5. **Cross-Project Intelligence (Inbound)** — survey focus repos for tooling/CI/preset patterns worth importing; **observation-only**, never modify other repos. Replaces v4's "bfra-me Ecosystem Health" category. **Focus-list stable (re-confirmed 2026-06-25):** the prompt still leads with two of Marcus's other repositories — chosen for agentic-safety-guardrail and autohealing-strategy intelligence — alongside the retained `marcusrbrown/.github`, `bfra-me/renovate-config`, and `fro-bot/agent`. The prompt explicitly frames the list as living — "drop repos that consistently have nothing actionable, add repos that become relevant." Note: both leading focus repos are **private** (visibility re-verified `PRIVATE` at 2026-06-25), so their names and contents are deliberately omitted here per the wiki public-only invariant — even though the two slugs are now spelled out in plaintext in this public workflow's `SCHEDULE_PROMPT` env block. The repo's own source leaking the names does not relax the wiki invariant: the wiki records that two private repos are surveyed, not which ones.
6. **Upstream Modernization Watch (Sundays only)** — **new category**. Gated by `IS_SUNDAY_UTC` env var set by a preflight `date -u +%u` step. Parses release notes for pinned upstreams (`fro-bot/agent`, `actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `@bfra.me/eslint-config`, `@bfra.me/prettier-config`) and identifies config/feature adoption opportunities. Action policy: at most one draft PR per scan, only for mechanical changes touching docstrings/AGENTS.md/config examples; anything touching `.github/workflows/`, `package.json`, lockfile, or preset JSON is **tracking-issue-only** (never opens a PR). Hard rule: never bump pinned versions — Renovate owns that.

Single-issue management: the perpetual `Daily Autohealing Report` issue receives prepended dated sections; dated-format daily issues are auto-consolidated and closed with a link to the perpetual issue. This is the same single-perpetual-issue strategy observed across [[bfra-me--ha-addon-repository]], [[bfra-me--works]], and [[bfra-me--github]] — and explains the open-issue count crash from 46 → 6 since the prior survey.

## Dev Tooling

| Tool | Version / Config |
| --- | --- |
| ESLint | 10.6.0 (was 10.5.0), extends `@bfra.me/eslint-config` 0.51.1 |
| Prettier | 3.9.4 (was 3.8.4 — crossed 3.8 → 3.9), extends `@bfra.me/prettier-config/120-proof` (0.16.9) |
| lint-staged | 17.0.8 (unchanged) (`*.{js,json,jsx,md,toml,ts,tsx,yml,yaml}`) |
| simple-git-hooks | 2.13.1 (pre-commit runs lint-staged) |
| semantic-release | 25.0.5 |
| eslint-config-prettier | 10.1.8 |
| eslint-plugin-prettier | 5.5.6 |
| markdownlint | 0.40.0 |
| conventional-changelog-conventionalcommits | 9.3.1 |

ESLint config (`eslint.config.js`) is a single re-export of `@bfra.me/eslint-config` — no local overrides.

**New `pnpm-workspace.yaml` (2026-07-09):** the repo gained a `pnpm-workspace.yaml` since the prior survey — the same pnpm-10→11 config-migration pattern seen ecosystem-wide (cf. [[marcusrbrown--marcusrbrown]], [[bfra-me--works]]). It carries:

- `allowBuilds: { simple-git-hooks: true, unrs-resolver: true }` and `onlyBuiltDependencies: [simple-git-hooks]` — the pnpm 11 build-approval surface
- `overrides: { undici: 7.28.0 }` — **this is where #1402 landed** (see below), not in `package.json` `pnpm.overrides`. The security override migrated into the workspace file rather than the manifest block, splitting the override surface across two files
- `savePrefix: ''`, `shamefullyHoist: true`, `shellEmulator: true`, `strictPeerDependencies: false`

**pnpm overrides for supply-chain hardening:** the `package.json` `pnpm.overrides` block now holds `fast-uri >=3.1.2`, `flatted >=3.4.2`, `handlebars >=4.7.9`, `lodash-es >=4.18.0`, `picomatch@2 ^4.0.0` (**bumped from `^2.3.2`** — the long-standing picomatch@2→v4 pin that PR #1311 tracked has now landed, closing that five-survey-open PR), `picomatch@4 ^4.0.4`. Plus the migrated `undici 7.28.0` override now living in `pnpm-workspace.yaml`. Mirrors the transitive-dep-pin approach used in [[marcusrbrown--mrbro-dev]] and [[marcusrbrown--marcusrbrown-github-io]] — a config-only repo carrying transitive-dep pins because npm advisory floors propagate via the lockfile. **Resolved since 2026-06-25:** the two PRs open at the prior survey both landed — #1402 (`fro-bot`-authored `undici >=7.28.0`, CVE-2026-9697 / CVE-2026-9678 remediation, now a `7.28.0` pin in the workspace file) and #1311 (`mrbro-bot`'s picomatch@2→v4, open across five surveys). Open-PR count is back to 0.

## Config Drift: Deprecated Options {#config-drift-deprecated-options-2026-07-09}

The 2026-07-09 survey surfaced the first substantive **preset-quality** finding since inception: the daily autoheal's category-3 (Config Validation & Preset Quality) opened **issue #1417 `Renovate config uses deprecated/removed options`** (authored by `fro-bot`). It cross-referenced all three presets plus `.github/renovate.json5` against the Renovate 43.244.1 JSON schema's deprecated `not` block and enumerated the drift. The configs still function in production (backward-compat-tolerated), but they diverge from the upstream `bfra-me/renovate-config` conventions this repo extends — upstream has already migrated to the replacement keys.

Deprecated keys found (per #1417):

| File | Deprecated option | Suggested replacement |
| --- | --- | --- |
| `default.json` | `matchSourceUrlPrefixes` (packageRules[1]) | `matchSourceUrls` (with `https://github.com/**`-style globs; upstream already uses this form) |
| `onboarding.json` | `onboardingConfig` | inline in preset (no `onboardingConfig*` wrapper) |
| `onboarding.json` | `onboardingConfigFileName` | `configFileNames` (array) |
| `onboarding.json` | `onboardingPrTitle` | `prTitleTemplate` / `commitMessage` |
| `onboarding.json` | `onboardingRebaseCheckbox` | `dependencyDashboardRebaseAll` / default behavior |
| `archived-repository.json` | `includeForks` | `forkProcessing: "enabled"` |
| `archived-repository.json` | `ignorePrAuthor` | `gitIgnoredAuthors` |
| `.github/renovate.json5` | _(none — already modern)_ | already uses `customManagers` / `managerFilePatterns` / `customType: 'regex'` |

This is the category-3 policy working exactly as written: it reports (opens a tracking issue) but does **not** auto-fix config logic — the prompt reserves auto-fixes for formatting/lint only (category 4), and #1417 explicitly frames the migration as a follow-up housekeeping PR, not an autoheal mutation. It is the cleanest live example so far of the observation-only preset-validation guardrail holding the line. Note the whole onboarding-config wrapper (all four keys) is deprecated — the modern pattern folds onboarding config inline into the primary preset, which would be a larger rewrite than the one-line `matchSourceUrlPrefixes → matchSourceUrls` swap.

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

| Consumer | Pin (most recent survey) | Post-Upgrade Tasks |
| --- | --- | --- |
| [[marcusrbrown--ha-config]] | `#5.2.0` (crossed v4→v5 boundary on 2026-05-16 via #776) | Prettier |
| [[marcusrbrown--github]] | `#4.5.8` | `npx prettier --write .` |
| [[marcusrbrown--containers]] | `#4.5.0` | `pnpm install && pnpm format` |
| [[marcusrbrown--dotfiles]] | `#4.5.8` | — |
| [[marcusrbrown--gpt]] | `#4.5.8` | — |
| [[marcusrbrown--vbs]] | `#4.5.9` | `pnpm install && pnpm fix` |
| [[marcusrbrown--copiloting]] | `#v4` (floating major-version branch) | — |
| [[marcusrbrown--extend-vscode]] | `#4.5.0` + `sanity-io/renovate-config` | — |
| [[marcusrbrown--infra]] | `#4.5.8` | `bun install --ignore-scripts && bun run fix` |
| [[marcusrbrown--mrbro-dev]] | `#4.5.8` | — |
| [[marcusrbrown--tokentoilet]] | `#4.5.8` | — |
| [[marcusrbrown--marcusrbrown]] | `#4.5.1` | bootstrap + fix |
| [[marcusrbrown--marcusrbrown-github-io]] | `#5.2.0` (crossed v4→v5 boundary on 2026-05-16 via #406) | — |
| [[marcusrbrown--systematic]] | extends + `sanity-io/renovate-config:semantic-commit-type` | — |
| [[marcusrbrown--opencode-copilot-delegate]] | `#5.2.0` (crossed v4→v5 boundary, prior survey 2026-05-21) | bun install + fix + build |
| [[marcusrbrown--esphome-life]] | `#4.5.1` | — |
| [[marcusrbrown--sparkle]] | `#4.5.9` | — |

**v4→v5 migration wave** (since 2026-04-28): `ha-config`, `marcusrbrown.github.io`, and `opencode-copilot-delegate` have all bumped to `#5.2.0` and survived the breaking change (`group:allNonMajor` extends, `>=5.0.0` floor, dropped `:disableRateLimiting`). Migrations were straightforward Renovate-authored PRs — no consumer required manual config overrides.

**Outstanding v4 holdouts:** `containers` and `extend-vscode` (still `#4.5.0`), `marcusrbrown` (`#4.5.1`), `esphome-life` (`#4.5.1`), `copiloting` (floating `#v4`), plus a long tail still on `#4.5.8`/`#4.5.9`. None will be force-bumped — Renovate routes the upgrade as a major PR per repo, and each consumer's preset pin policy decides timing.

**Pre-survey concern resolved:** the prior survey flagged the `bf13a82` SHA against a `#4.5.8` release. The repo has since shipped seven releases (`5.0.1`, `5.0.2`, `5.1.0`, `5.1.1`, `5.2.0`, plus a 4.5.9 patch).

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-04-28 | `bf13a82` | Initial survey; v4.5.8, agent v0.42.2, 46 open issues, separate `fro-bot-autoheal.yaml` |
| 2026-05-23 | `3478c88` | v4→v5 boundary crossed (5.2.0); agent v0.44.3; autoheal merged into `fro-bot.yaml`; new category 6 Sundays-only Upstream Modernization Watch; 0.x ungrouping rule; minimum version floor `>=5.0.0`; pnpm 11.1.3; lint-staged 17.0.5; pnpm overrides for fast-uri/flatted/handlebars/lodash-es/picomatch; open issues 46 → 6 |
| 2026-06-04 | `499f0ca` | Dependency-churn survey — no preset policy change. Latest release still 5.2.0; `default.json` + bfra-me pin `#5.2.1` unchanged. agent v0.44.3 → **v0.52.1** (8 bumps in ~12 days); runner actions checkout v6.0.3 / setup-node v6.4.0 / pnpm-action-setup v6.0.8; bfra-me renovate reusable workflow v4.16.9 → v4.16.23; pnpm 11.1.3 → 11.5.0; eslint 10.4.0 → 10.4.1; eslint-plugin-prettier 5.5.5 → 5.5.6; lint-staged 17.0.5 → 17.0.7. Cross-Project Intelligence focus-list now leads with two **private** Marcus repos (names withheld per public-only invariant). Open-issue count holds at 6 but legacy `Daily Maintenance` / `Weekly Maintenance` report issues linger outside the autoheal cleanup matcher. |
| 2026-06-14 | `42ee3cd` | Dependency-churn survey — no preset policy change. Preset `extends` list, packageRules, schedule, and onboarding/archived presets all byte-identical in shape; only the bfra-me base pin moved `#5.2.1` → **`#5.2.3`** (default.json, Renovate-bumped via custom regex manager). Latest release 5.2.0 → **5.2.3** (three patch releases). agent v0.52.1 → **v0.63.0** (`817d4ada`, latest bump #1385); runner action pins **unchanged**; bfra-me renovate reusable workflow v4.16.23 → **v4.16.25** (`11b3f16`); node 24.15.0 → 24.16.0; pnpm 11.5.0 → 11.5.3; prettier 3.8.3 → 3.8.4; semantic-release 25.0.3 → 25.0.5. Daily autoheal six-category prompt unchanged; category-5 focus repos still the two **private** Marcus repos (names withheld; visibility re-verified `PRIVATE`). Open-issue set stable at 6 (no churn); same legacy report issues still outside the autoheal cleanup matcher. Sole open PR still #1311 (picomatch@2 v4). |
| 2026-06-25 | `561289f` | Dependency-churn survey — no preset policy change. `default.json` extends/packageRules/schedule, onboarding/archived presets, and `renovate.json5` custom regex manager all byte-identical in shape; bfra-me base pin holds at **`#5.2.3`**. Latest release unchanged at **5.2.3**. agent v0.63.0 → **v0.76.2** (`69aedbc`) — crosses the agent's pnpm→Bun + gateway operator-web-surface internal shifts (runtime-internal to [[fro-bot--agent]]; this repo's invocation surface unaffected). `pnpm/action-setup` v6.0.8 → **v6.0.9** (`0ebf471`); `actions/checkout` v6.0.3 / `actions/setup-node` v6.4.0 **unchanged**; bfra-me renovate reusable workflow v4.16.25 → **v4.16.30** (`a2676c9`); node 24.16.0 → **24.18.0**; pnpm 11.5.3 → **11.8.0**; eslint 10.4.1 → **10.5.0**; lint-staged 17.0.7 → **17.0.8**. Daily autoheal six-category prompt unchanged. **New finding:** category-5 focus repos are now **named in plaintext** in the workflow `SCHEDULE_PROMPT` (`marcusrbrown/yield-farmer`, `marcusrbrown/poly`); both re-verified **`PRIVATE`** at 2026-06-25, so the names stay withheld from the wiki per the public-only invariant despite the source leak. First **star** landed (0 → 1). Open PRs 1 → 2: #1311 (picomatch@2 v4) still open + **new** #1402 (`fro-bot`-authored `undici` → 7.28.0, CVE-2026-9697 / CVE-2026-9678 remediation) — a live example of the category-2 security-override autoheal path. Open-issue set stable at 6; same legacy report issues still outside the autoheal cleanup matcher. |
| 2026-07-09 | `12263eb` | Dependency-churn survey + **first preset-quality finding**. Preset _policy_ still byte-identical in shape (`default.json` extends/packageRules/schedule, onboarding/archived presets, `renovate.json5` regex manager); bfra-me base pin holds **`#5.2.3`**. Latest release **5.2.3 → 5.2.4** (2026-07-01). agent v0.76.2 → **v0.84.2** (`99e7d853`); all runner action pins **unchanged** (checkout v6.0.3, setup-node v6.4.0, pnpm/action-setup v6.0.9); bfra-me renovate reusable workflow v4.16.30 → **v4.16.35** (`aac0d9b`); node 24.18.0 unchanged; pnpm 11.8.0 → **11.10.0**; eslint 10.5.0 → **10.6.0**; prettier 3.8.4 → **3.9.4** (crossed 3.8→3.9); lint-staged 17.0.8 unchanged. **New `pnpm-workspace.yaml`** (allowBuilds/onlyBuiltDependencies + `overrides: undici 7.28.0` + shamefullyHoist/shellEmulator/strictPeerDependencies:false) — the pnpm-11 config-migration pattern; the `undici` security override migrated here from `package.json`. `package.json` override `picomatch@2 ^2.3.2 → ^4.0.0`. **Both prior PRs landed** — #1402 (undici) and #1311 (picomatch@2→v4, five surveys open); open PRs 2 → 0. **New issue #1417** (`fro-bot`, category-3 Config Validation) enumerates deprecated Renovate schema options in all three presets (`matchSourceUrlPrefixes`, the four `onboarding*` wrapper keys, `includeForks`/`ignorePrAuthor`) — reports only, no auto-fix, framed as follow-up housekeeping; open issues 6 → 7. Daily autoheal six-category prompt unchanged; category-5 focus repos still the two **private** Marcus repos (names withheld per public-only invariant). `readme.md`/`license.md` lowercased. |
