---
type: repo
title: "marcusrbrown/renovate-config — Shareable Renovate Configuration Presets"
created: 2026-04-28
updated: 2026-07-26
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
    sha: 5726e90bbcdfe2119d42630db1b9af7b2597a5f4
    accessed: 2026-07-26
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
| Latest release | `5.2.9` (2026-07-21) — six patch releases past `5.2.3` (5.2.4–5.2.9); was `5.2.3` at 2026-06-14/06-25. **Indirect signal (2026-08-03):** the [[marcusrbrown--marcusrbrown-com]] survey observed a downstream pin at `#5.2.10`, so at least one patch has shipped past this directly-surveyed figure — confirm on next direct survey of this repo. |
| Node.js | 24.18.0 (`.node-version`) — unchanged since 2026-06-25; was 24.16.0 at 2026-06-14, 24.15.0 prior |
| Package manager | pnpm 11.16.0 (was 11.8.0 at 2026-06-25, 11.5.3 at 2026-06-14, 11.5.0 at 2026-06-04, 11.1.3 at 2026-05-23, 10.33.2 at 2026-04-28) |
| Topics | renovate, renovate-config, renovate-preset, renovatebot, renovate-by-githubaction, semantic-release |
| Open issues | 7 — was 6 across four prior surveys; **new** #1417 (deprecated/removed Renovate options, authored by `fro-bot`) joins the stable legacy set (see note below) |
| Open PRs | 1 — **new** #1478 (`fast-uri` → 3.1.4 remediating CVE-2026-16221, authored by `fro-bot`); prior #1311 (picomatch@2 v4) and #1402 (undici CVE) both **merged** since 2026-06-25 |
| Stars / Watchers / Forks | 1 / 2 / 0 (unchanged since first star landed pre-2026-06-25) |

**Open-issue composition (2026-07-26):** count ticks 6 → 7. The stable set persists — `Daily Autohealing Report` (#1314), `Daily Maintenance Report` (#1111), three legacy `Weekly Maintenance Report — YYYY-MM-DD` issues (#1096/#1079/#1068), and the Renovate `Dependency Dashboard` (#556) — plus **new** #1417 `Renovate config uses deprecated/removed options` (authored by `fro-bot`). #1417 is the category-3 (Config Validation & Preset Quality) path landing a tracked issue exactly as the prompt specifies: deprecated-option findings open/update a single issue rather than an auto-fix PR. The legacy `Daily Maintenance` / `Weekly Maintenance` report issues still fall outside the autoheal cleanup matcher (which only closes dated `Daily Autohealing Report — YYYY-MM-DD` issues) — a fifth-survey-running candidate for manual cleanup or a broadened matcher.

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
- `github>bfra-me/renovate-config#5.2.6` — base config from the bfra-me organization (was `#5.2.3` at 2026-06-14/06-25, `#5.2.1` at 2026-06-04; Renovate-bumped via the custom regex manager)
- `github>bfra-me/renovate-config:fro-bot.json5#5.2.6` — Fro Bot-specific overrides from bfra-me

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

Uses reusable workflow `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.40` (SHA `0ff5a4d`; was `@v4.16.30` at 2026-06-25, `@v4.16.25` at 2026-06-14, `@v4.16.23` at 2026-06-04, `@v4.16.9` at 2026-05-23). Triggers on issue edits, PR edits, push to non-main branches, manual dispatch, and `workflow_run` after main CI succeeds. Includes `path-filters` scoped to Renovate config files and presets.

### `codeql-analysis.yaml` — CodeQL security scanning

### `scorecard.yaml` — OpenSSF Scorecard

### `update-repo-settings.yaml` — Probot Settings sync

## Fro Bot Integration

**Fro Bot workflow present and active** — `fro-bot.yaml` with `fro-bot/agent@v0.95.0` (SHA `4ad00541cd9e4f1853f9dcd1fb2ac316d559d54f`). The agent pin advanced v0.76.2 → v0.95.0 between 2026-06-25 and 2026-07-26 — ~19 minors in a month, the same rapid Renovate-authored cadence tracking [[fro-bot--agent]] (now a fleet pin leader). Runner action pins moved this cycle: `actions/checkout` v6.0.3 → **v6.1.0** (`d23441a`), `actions/setup-node` v6.4.0 → **v6.5.0** (`2499707`); `pnpm/action-setup` holds at **v6.0.9** (`0ebf471`).

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
3. **Config Validation & Preset Quality** — validate all preset JSON/JSON5 against Renovate schema, check for deprecated options, verify base preset pin is released and not auto-bumped (Renovate owns version bumps), detect rule conflicts, run lint. **Live example (2026-07-26):** this category fired, opening `fro-bot`-authored issue #1417 (`Renovate config uses deprecated/removed options`) — the prompt's "open or update a single issue listing deprecated options" branch working as designed (tracked-issue-only, never an auto-fix PR)
4. **Developer Experience** — lint/format auto-fix PRs only (never direct-to-`main` commits)
5. **Cross-Project Intelligence (Inbound)** — survey focus repos for tooling/CI/preset patterns worth importing; **observation-only**, never modify other repos. Replaces v4's "bfra-me Ecosystem Health" category. **Focus-list stable (re-confirmed 2026-07-26):** the prompt still leads with two of Marcus's other repositories — chosen for agentic-safety-guardrail and autohealing-strategy intelligence — alongside the retained `marcusrbrown/.github`, `bfra-me/renovate-config`, and `fro-bot/agent`. The prompt explicitly frames the list as living — "drop repos that consistently have nothing actionable, add repos that become relevant." Note: both leading focus repos are **private** (both slugs return HTTP 404 to unauthenticated reads at 2026-07-26, consistent with the `PRIVATE` verification at 2026-06-25/06-14), so their names and contents are deliberately omitted here per the wiki public-only invariant — even though the two slugs remain spelled out in plaintext in this public workflow's `SCHEDULE_PROMPT` env block, now with per-repo intelligence foci annotated inline. The repo's own source leaking the names does not relax the wiki invariant: the wiki records that two private repos are surveyed, not which ones.
6. **Upstream Modernization Watch (Sundays only)** — **new category**. Gated by `IS_SUNDAY_UTC` env var set by a preflight `date -u +%u` step. Parses release notes for pinned upstreams (`fro-bot/agent`, `actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `@bfra.me/eslint-config`, `@bfra.me/prettier-config`) and identifies config/feature adoption opportunities. Action policy: at most one draft PR per scan, only for mechanical changes touching docstrings/AGENTS.md/config examples; anything touching `.github/workflows/`, `package.json`, lockfile, or preset JSON is **tracking-issue-only** (never opens a PR). Hard rule: never bump pinned versions — Renovate owns that.

Single-issue management: the perpetual `Daily Autohealing Report` issue receives prepended dated sections; dated-format daily issues are auto-consolidated and closed with a link to the perpetual issue. This is the same single-perpetual-issue strategy observed across [[bfra-me--ha-addon-repository]], [[bfra-me--works]], and [[bfra-me--github]] — and explains the open-issue count crash from 46 → 6 since the prior survey.

## Dev Tooling

| Tool | Version / Config |
| --- | --- |
| ESLint | 10.7.0 (was 10.5.0), extends `@bfra.me/eslint-config` 0.51.1 |
| Prettier | 3.9.6 (was 3.8.4 — crossed 3.8 → 3.9), extends `@bfra.me/prettier-config/120-proof` (0.16.9) |
| lint-staged | 17.1.1 (was 17.0.8 — crossed 17.0 → 17.1) (`*.{js,json,jsx,md,toml,ts,tsx,yml,yaml}`) |
| simple-git-hooks | 2.13.1 (pre-commit runs lint-staged) |
| semantic-release | 25.0.8 (was 25.0.5) |
| eslint-config-prettier | 10.1.8 |
| eslint-plugin-prettier | 5.5.6 |
| markdownlint | 0.40.0 |
| conventional-changelog-conventionalcommits | 9.3.1 |

ESLint config (`eslint.config.js`) is a single re-export of `@bfra.me/eslint-config` — no local overrides.

**pnpm overrides for supply-chain hardening:** `fast-uri >=3.1.2`, `flatted >=3.4.2`, `handlebars >=4.7.9`, `lodash-es >=4.18.0`, `picomatch@2 ^4.0.0`, `picomatch@4 ^4.0.4` (2026-07-26). The `picomatch@2` selector was **bumped `^2.3.2` → `^4.0.0`** since 2026-06-25 — this is PR #1311 (the picomatch@2-v4 update open across five prior surveys) finally landing. Note the override now forces the `@2` alias onto the v4 line, collapsing the two selectors toward a single major. Mirrors the override approach used in [[marcusrbrown--mrbro-dev]] and [[marcusrbrown--marcusrbrown-github-io]] — a config-only repo carrying transitive-dep pins because npm advisory floors propagate via the lockfile. **Merged since prior survey:** #1402 (`undici >=7.28.0`, CVE-2026-9697 / CVE-2026-9678) landed — the category-2 security-override autoheal path completed end-to-end. **In-flight (2026-07-26):** open PR #1478 (authored by `fro-bot`) adds a `fast-uri` bump to `3.1.4` remediating CVE-2026-16221 — the same category-2 path firing again; not yet merged, so the `fast-uri >=3.1.2` floor above is unchanged pending it.

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
| 2026-07-26 | `5726e90` | Dependency-churn survey — no preset policy change. `default.json` extends/packageRules/schedule, onboarding/archived presets, and `renovate.json5` custom regex manager all byte-identical in shape. bfra-me base pin **`#5.2.3` → `#5.2.6`** (default.json, Renovate-bumped). Latest release **5.2.3 → 5.2.9** (six patches). agent **v0.76.2 → v0.95.0** (`4ad00541`); `actions/checkout` v6.0.3 → **v6.1.0** (`d23441a`), `actions/setup-node` v6.4.0 → **v6.5.0** (`2499707`), `pnpm/action-setup` v6.0.9 **unchanged**; bfra-me renovate reusable workflow v4.16.30 → **v4.16.40** (`0ff5a4d`). node **24.18.0** steady; pnpm 11.8.0 → **11.16.0**; eslint 10.5.0 → **10.7.0**; prettier 3.8.4 → **3.9.6**; lint-staged 17.0.8 → **17.1.1**; semantic-release 25.0.5 → **25.0.8**. **pnpm override change:** `picomatch@2` selector `^2.3.2` → **`^4.0.0`** — PR #1311 (picomatch@2-v4, open across five prior surveys) landed. Prior undici PR #1402 also **merged** (category-2 security-override completed). Daily autoheal six-category prompt unchanged; category-5 focus repos still the two **private** Marcus repos (both 404 to unauthenticated reads at 2026-07-26; names withheld per public-only invariant, now with per-repo intelligence foci annotated inline in `SCHEDULE_PROMPT`). Open issues **6 → 7**: new #1417 (`fro-bot`-authored deprecated/removed-options tracking issue — category-3 output). Open PRs **2 → 1**: #1311/#1402 merged, **new** #1478 (`fro-bot`-authored `fast-uri` → 3.1.4, CVE-2026-16221 — category-2 again). Legacy maintenance-report issues still outside the autoheal cleanup matcher (fifth survey running). Stars/watchers/forks 1/2/0 unchanged. |
| 2026-06-25 | `561289f` | Dependency-churn survey — no preset policy change. `default.json` extends/packageRules/schedule, onboarding/archived presets, and `renovate.json5` custom regex manager all byte-identical in shape; bfra-me base pin holds at **`#5.2.3`**. Latest release unchanged at **5.2.3**. agent v0.63.0 → **v0.76.2** (`69aedbc`) — crosses the agent's pnpm→Bun + gateway operator-web-surface internal shifts (runtime-internal to [[fro-bot--agent]]; this repo's invocation surface unaffected). `pnpm/action-setup` v6.0.8 → **v6.0.9** (`0ebf471`); `actions/checkout` v6.0.3 / `actions/setup-node` v6.4.0 **unchanged**; bfra-me renovate reusable workflow v4.16.25 → **v4.16.30** (`a2676c9`); node 24.16.0 → **24.18.0**; pnpm 11.5.3 → **11.8.0**; eslint 10.4.1 → **10.5.0**; lint-staged 17.0.7 → **17.0.8**. Daily autoheal six-category prompt unchanged. **New finding:** category-5 focus repos are now **named in plaintext** in the workflow `SCHEDULE_PROMPT` (`[REDACTED]`, `[REDACTED]`); both re-verified **`PRIVATE`** at 2026-06-25, so the names stay withheld from the wiki per the public-only invariant despite the source leak. First **star** landed (0 → 1). Open PRs 1 → 2: #1311 (picomatch@2 v4) still open + **new** #1402 (`fro-bot`-authored `undici` → 7.28.0, CVE-2026-9697 / CVE-2026-9678 remediation) — a live example of the category-2 security-override autoheal path. Open-issue set stable at 6; same legacy report issues still outside the autoheal cleanup matcher. |
