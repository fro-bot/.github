---
type: repo
title: marcusrbrown/renovate-config — Shareable Renovate Configuration Presets
created: 2026-04-28
updated: 2026-09-11
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
  - url: https://github.com/marcusrbrown/vbs
    sha: 986b1c296c782dc2fb5acce19f5d594388619faf
    accessed: 2026-09-08
  - url: https://github.com/marcusrbrown/renovate-config
    sha: ea21e165a24d7154565e369dd916b9e33e16690b
    accessed: 2026-09-11
tags:
  - renovate
  - renovate-config
  - renovate-preset
  - semantic-release
  - dependency-management
  - working-dir-delivery
  - override-ledger
  - minimum-release-age
  - preset-extends-order
  - perpetual-issue
aliases:
  - renovate-config
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
  - marcusrbrown--sparkle
  - marcusrbrown--marcusrbrown-com
  - marcusrbrown--mothership
  - marcusrbrown--cortexkit-anthropic-auth
  - bfra-me--github
  - bfra-me--works
  - bfra-me--ha-addon-repository
  - fro-bot--agent
node_id: R_kgDOHRfvyQ
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
| Latest release | `5.2.13` (2026-09-05) — four patches past the last directly-surveyed `5.2.9` (5.2.10 on 08-03, 5.2.11/5.2.12 both on 08-08, 5.2.13 on 09-05). Confirms the 2026-08-03 indirect signal from [[marcusrbrown--marcusrbrown-com]] (`#5.2.10`) and the 2026-09-08 signal from [[marcusrbrown--vbs]] (`#5.2.12`/`#5.2.13`) |
| Node.js | 24.21.0 (`.node-version`) — was 24.18.0 across 2026-06-25 → 07-26, 24.16.0 at 2026-06-14, 24.15.0 prior |
| Package manager | pnpm 11.26.0 (was 11.16.0 at 2026-07-26, 11.8.0 at 2026-06-25, 11.5.3 at 2026-06-14, 11.5.0 at 2026-06-04, 11.1.3 at 2026-05-23, 10.33.2 at 2026-04-28) |
| Topics | renovate, renovate-config, renovate-preset, renovatebot, renovate-by-githubaction, semantic-release |
| Tracked tree | 26 blobs (baseline recorded 2026-09-11) — no test directory, no `src/`; `.github/workflows/fro-bot.yaml` (21,403 B / 477 lines) is the single largest non-lockfile file, ~10× `default.json` (2,191 B) |
| Open issues | 7 — unchanged in **count and membership** since 2026-07-26 (#1417, #1314, #1111, #1096, #1079, #1068, #556). A seventh survey with the same legacy report issues outside the autoheal cleanup matcher |
| Open PRs | **0** — #1478 (`fast-uri`, `fro-bot`) merged 2026-08-03; #1507 (`js-yaml`, `fro-bot`) merged 2026-09-05. See the clean-queue finding below |
| Stars / Watchers / Forks | 1 / 2 / 0 (unchanged since first star landed pre-2026-06-25) |

**Open-issue composition (2026-07-26):** count ticks 6 → 7. The stable set persists — `Daily Autohealing Report` (#1314), `Daily Maintenance Report` (#1111), three legacy `Weekly Maintenance Report — YYYY-MM-DD` issues (#1096/#1079/#1068), and the Renovate `Dependency Dashboard` (#556) — plus **new** #1417 `Renovate config uses deprecated/removed options` (authored by `fro-bot`). #1417 is the category-3 (Config Validation & Preset Quality) path landing a tracked issue exactly as the prompt specifies: deprecated-option findings open/update a single issue rather than an auto-fix PR. The legacy `Daily Maintenance` / `Weekly Maintenance` report issues still fall outside the autoheal cleanup matcher (which only closes dated `Daily Autohealing Report — YYYY-MM-DD` issues) — a fifth-survey-running candidate for manual cleanup or a broadened matcher.

## 2026-09-11 Survey — Headline Findings

First direct source-side survey since 2026-07-26 (HEAD `ea21e16`, `chore(deps): update fro-bot/agent to v0.110.1`, authored by `mrbro-bot[bot]`). The preset policy surface is unchanged in shape for a **seventh consecutive survey** — `default.json`'s extends list, packageRules, and the onboarding/archived presets are structurally identical, with only the `bfra-me/renovate-config` pin moving `#5.2.6` → `#5.2.7`. The interval's value is elsewhere: **three carried open questions are answered, and the repo turns out to be running the cleanest merge queue in the fleet on top of a delivery channel that has been discarding its output for at least four days.**

### 1. A perfect queue and a severed output channel, in the same repo

Every metric that measures *governance* on this repo is best-in-fleet:

- **0 open PRs.** Not "few" — zero. The fleet's other repos carry 4–15 parked bot PRs.
- **10 `fro-bot`-authored PRs in the repo's entire history, 10 merged, 0 closed-unmerged.** A 100% merge rate on agent-authored work. Against [[marcusrbrown--tokentoilet]] (7 PRs parked 29–48 days), [[marcusrbrown--sparkle]] (13 autoheal PRs, none merging), and [[marcusrbrown--marcusrbrown-com]] (6 PRs open 18–56 days), this is the control case proving the propose-without-merge backlog is **not** a property of the agent.
- **The Renovate half merges same-day**, 40 consecutive `mrbro-bot[bot]` automerges in the surveyed window.

And yet: **`fro-bot.yaml`'s final step is `Run Fro Bot`. There is no commit, push, or PR-creation step after it.** This is the working-dir delivery break already recorded for [[marcusrbrown--tokentoilet]], `fro-bot/.github` itself, and [[marcusrbrown--mothership]] — this repo is the **fourth independent instance**, and the most instructive one, because it isolates the variable. Tokentoilet's outage was confounded with an undrained merge queue and a stale `Security Audit`. Here there is nothing else wrong. The queue is clean, the daemon runs green (4/4 scheduled runs `success`, workflow `state: active`), the perpetual report is updated daily — and the work still evaporates.

**Directly verified, not merely self-reported.** The `Daily Autohealing Report` (#1314, self-reported and therefore treated as untrusted input) states that the same security remediation was written to the working tree on 2026-09-07, 09-08, 09-09, and 09-10 — *"Fourth working-tree write for this fix — caller-workflow commit/push step regression appears persistent."* That claim is independently confirmable from `main`: `pnpm-workspace.yaml` at HEAD `ea21e16` (2026-09-11T04:34Z, **after** the 09-10 run) declares exactly three overrides — `fast-uri`, `js-yaml`, `undici`. There is **no `browserslist` entry**. Four correct fixes, zero landings.

The remediated advisory is not hypothetical: GHSA-73wf-gq98-2v4g / CVE-2026-73088 (`browserslist`, HIGH, CVSS 7.5, transitive devDep via `core-js-compat → eslint-plugin-unicorn → @bfra.me/eslint-config@0.52.1`), plus GHSA-w5vr-8v7q-w6rv / CVE-2026-45819 (`baseline-browser-mapping`, MEDIUM) which the same override would close transitively. Meanwhile `Fro Bot` is a **required status check on `main`** with `enforce_admins: true` — so the merge gate reports a passing daemon whose only remaining product is prose.

The sharpest framing this instance adds to the class: **a repo can have solved every governance problem the fleet has and still deliver nothing, because delivery is a workflow-shape property and governance is a merge-policy property. They are measured by different instruments and neither one reveals the other.** The clean queue is also the reason the break is invisible here — with zero open PRs, "no new PR appeared" reads as a healthy steady state rather than a symptom.

One more caution for the audit trail: the 10/10 merge rate **predates** the break. The last `fro-bot` PR was created 2026-08-07 (#1507). Nothing since — 35 days. Any future reading of "100% merge rate" must be scoped to the window in which the agent could still open PRs at all.

### 2. The 0.x ungrouping valve is correct; the consumer's `extends` order voids it

The 2026-09-08 note on this page recorded an unresolved contradiction: [[marcusrbrown--vbs]]'s `@bfra.me/eslint-config` `0.51.2 → 0.52.1` rode inside a grouped `renovate/all-minor-patch` PR even though the preset carries a 0.x ungrouping safety valve. Source-side reading resolves it, and **the preset is not at fault.**

`default.json`'s last packageRule is exactly what was recorded:

```json
{
  "description": "Ungroup unstable (v0.x[.x]) packages so they are not grouped by presets such as `group:allNonMajor`.",
  "matchCurrentVersion": "/^0\\./",
  "groupName": null
}
```

`0.51.2` matches `/^0\./`, and the rule is positioned last so it wins over the `group:allNonMajor` grouping the preset itself extends. The valve is well-constructed.

The consumer's config is what breaks it. VBS's `.github/renovate.json5` reads:

```json5
extends: ['github>marcusrbrown/renovate-config#5.2.12', 'group:allNonMajor'],
```

`group:allNonMajor` is re-extended **after** the preset — a preset the base already extends. Renovate resolves `extends` left-to-right and concatenates `packageRules` in resolution order, with later rules overriding earlier ones on the same field. So the consumer's redundant re-extension appends `groupName: 'all non-major dependencies'` *after* the valve's `groupName: null`, silently re-grouping the 0.x packages the valve had just peeled out. One duplicated line, 14 days of frozen updates, and a HIGH-severity-free but fully-stalled dependency pipeline.

The generalizable footgun, which is not Renovate-specific: **re-extending a preset that your base preset already extends relocates it to the end of the rule chain, where it overrides every narrowing rule your base applied on top of it.** The duplicate looks harmless — it is the same preset name, already in effect — so review reads it as redundant rather than destructive. It is strictly worse than redundant: a base preset's whole job is to layer refinements *after* the broad presets it pulls in, and re-declaring one of those broad presets downstream inverts that layering.

Confidence note: this is an inference from Renovate's documented `extends` and `packageRules` merge semantics, not from a resolved-config dump. The cheap proof is already wired — `renovate.yaml` exposes a `print-config` dispatch input ("Log the fully-resolved Renovate config for each repository, plus fully-resolved presets"). A single dispatch on the consumer settles it, and the fix is deleting one array element.

A preset-side hardening is also worth weighing, independent of the consumer bug. [[marcusrbrown--vbs]] demonstrated that a single `@bfra.me/eslint-config` minor introduced a new `unicorn/prefer-array-some` violation that `pnpm fix` could not auto-fix, turning the whole group red and freezing pnpm, `bfra-me/.github`, `fro-bot/agent`, and this preset's own bump. **Lint and formatter packages can turn previously-valid source into a CI failure with no source change** — a property ordinary devDependencies do not have. Ungrouping them by name would be a narrower, order-independent guard than relying on a 0.x version heuristic that a downstream `extends` line can undo.

### 3. `minimumReleaseAge` — the origin question, answered

The 2026-09-08 note asked whether this preset sets `minimumReleaseAge`, on the theory that it explained the `minimumReleaseAgeExclude` entries Renovate wrote into VBS's `pnpm-workspace.yaml`. **It does not.** `default.json` mentions `minimumReleaseAge` twice and both are `null` — the own-project fast-track rules that *waive* a cooldown for `@bfra.me/**`, `bfra-me/**`, `@fro.bot/**`, `fro-bot/**`, `/^@?marcusrbrown/`, `marcusrbrown/**`, `pro-actions/**` and for packages sourced from those three GitHub orgs. No positive value is declared anywhere in the repo. The Renovate-side cooldown therefore originates upstream, in `github>bfra-me/renovate-config#5.2.7`.

More useful than the answer is what it exposes. This repo carries its own exclusion list:

```yaml
minimumReleaseAgeExclude:
  - '@bfra.me/eslint-config@0.51.2 || 0.51.3 || 0.51.4 || 0.52.0 || 0.52.1'
  - '@bfra.me/prettier-config@0.16.10 || 0.16.11'
```

Every excluded package is one the preset fast-tracks with `minimumReleaseAge: null`. That correlation is the mechanism: **`minimumReleaseAge` names two independently-configured gates at two different layers** — Renovate's (when may a PR be opened) and pnpm 11's install-time gate (will the package manager install a version this new). Setting Renovate's to `null` relaxes exactly one of them. Renovate then has to reconcile with the other by emitting per-version escape hatches into the workspace manifest, one version at a time, forever. The list grows monotonically and is append-only by construction: VBS's already differs from this repo's, and this one has accumulated five `eslint-config` versions where the 2026-09-08 VBS sighting had one.

The second-order consequence is the part worth carrying forward: **the harder a preset fast-tracks its own org's packages, the more install-layer exclusions accumulate downstream.** The fast-track is a policy decision made once in a shared preset; the exclusions are mechanical debt paid per-repo, per-version, in a file nobody reviews.

Unresolved, honestly: no `minimumReleaseAge` value, no `.npmrc`, and no such key appears in *either* repo's `pnpm-workspace.yaml`. Where pnpm's half of the gate is configured is still not visible in-repo. Either it is a pnpm 11 default, or it comes from a global/CI config outside the tree — and if neither, the exclusions are inert and Renovate is writing them speculatively. Worth one `pnpm config get minimumReleaseAge` in CI to settle.

### 4. Split-brain override ledgers (new)

`pnpm-workspace.yaml` is **new to this page** and did not exist at the 2026-07-26 survey. The repo now maintains *two* override ledgers with different syntax, different maintenance semantics, and one overlapping key:

| Ledger | Entries | Form | Maintained by |
| --- | --- | --- | --- |
| `package.json` → `pnpm.overrides` | `fast-uri >=3.1.2`, `flatted >=3.4.2`, `handlebars >=4.7.9`, `lodash-es >=4.18.0`, `picomatch@2 ^4.0.0`, `picomatch@4 ^4.0.4` | open-ended floors | nothing — a `>=` floor gives Renovate no version to bump |
| `pnpm-workspace.yaml` → `overrides` | `fast-uri 3.1.7`, `js-yaml 4.3.2`, `undici 7.29.1` | exact pins | Renovate, actively (#1568 `fast-uri → 3.1.7`, #1563 `js-yaml → 4.3.2`, #1574 `undici → 7.29.1`, all merged 09-05 → 09-07) |

The migration is happening **one advisory at a time, as Renovate touches each key**. `undici` was recorded in `package.json` at the 2026-07-26 survey and now appears only in `pnpm-workspace.yaml`. `fast-uri` is mid-migration and currently sits in **both**, at `>=3.1.2` and `3.1.7` respectively. There is no live conflict today — `3.1.7` satisfies `>=3.1.2` — but the precedence between the two files is not asserted anywhere, and the failure is latent rather than absent: whichever ledger loses is dead weight that still reads as authoritative during review. If `package.json` wins, the Renovate-tracked exact pin never applies; if `pnpm-workspace.yaml` wins, the stale floor is decoration. Nothing in the repo tells a reader which.

The shape to generalize: **a half-finished config migration driven by an update bot produces divergence proportional to how rarely each key is touched.** Frequently-bumped keys migrate quickly; the quiet ones (`flatted`, `handlebars`, `lodash-es`, `picomatch`) stay behind indefinitely, because the thing performing the migration only visits a key when a new version ships. The migration will never complete on its own.

Same file, same class, second instance: `pnpm-workspace.yaml` declares **both** `allowBuilds` (pnpm 11's key — `simple-git-hooks`, `unrs-resolver`) **and** the legacy `onlyBuiltDependencies` (`simple-git-hooks` only). The lists disagree by one entry, so whether `unrs-resolver` is permitted to run its build scripts depends entirely on which key pnpm 11 honors. [[bfra-me--github]] completed this exact rename (`onlyBuiltDependencies` → `allowBuilds`); here both survive side by side.

### 5. Everything that did *not* move

Worth recording because the survey cost is in verifying it: the bfra-me base pin `#5.2.7` is **current** — `bfra-me/renovate-config`'s latest release is `5.2.7` (2026-08-08), so the custom regex manager is tracking correctly and there is no upstream lag. The two repos' coincidentally parallel `5.2.x` lines are unrelated version spaces and should not be conflated. The open-issue set is byte-stable in membership across seven surveys. `default.json`, `onboarding.json`, and `archived-repository.json` are structurally unchanged.

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
- `github>bfra-me/renovate-config#5.2.7` — base config from the bfra-me organization (was `#5.2.6` at 2026-07-26, `#5.2.3` at 2026-06-14/06-25, `#5.2.1` at 2026-06-04; Renovate-bumped via the custom regex manager). **Current as of 2026-09-11** — upstream's latest release is also `5.2.7` (2026-08-08), so there is no pin lag
- `github>bfra-me/renovate-config:fro-bot.json5#5.2.7` — Fro Bot-specific overrides from bfra-me

The `:disableRateLimiting` preset present in v4 has been **dropped from the extends list** in v5; rate-limiting now defers to the bfra-me base preset's defaults.

Key package rules:
- **semantic-release grouping:** Groups major updates of `semantic-release` and `conventional-changelog-conventionalcommits` with `semanticCommitType: feat`
- **Own-project fast-track:** Automerges `@bfra.me/*`, `bfra-me/*`, `@fro.bot/*`, `fro-bot/*`, `@marcusrbrown/*` (regex `/^@?marcusrbrown/`), `marcusrbrown/*`, and `pro-actions/*` packages with no minimum release age and immediate PR creation
- **Source URL fast-track:** Same immediate/no-age treatment for packages sourced from `github.com/bfra-me`, `github.com/fro-bot`, or `github.com/marcusrbrown`
- **Self-reference labeling:** Commits touching `marcusrbrown/renovate-config` use topic `{{{depName}}} preset`
- **Minimum version floor:** Consumers of this preset must be on `>=5.0.0` (was `>=4.0.0` in v4.x — **breaking change** for any consumer still pinned below v5)
- **Unstable (0.x) ungrouping (v5.x):** `matchCurrentVersion: /^0\./` sets `groupName: null`, peeling 0.x packages back out of `group:allNonMajor` so each pre-release lib gets its own PR. This is the safety valve that makes the new `group:allNonMajor` extension tolerable for downstream consumers. **Verified source-side 2026-09-11:** the rule is positioned last in `packageRules`, so it wins over the grouping the preset itself extends. It can still be defeated *downstream* by a consumer re-extending `group:allNonMajor` after this preset — see headline finding 2.
- **No positive `minimumReleaseAge`** (verified 2026-09-11): the only two occurrences are `minimumReleaseAge: null` in the own-project fast-track rules. Any cooldown a consumer observes comes from the `bfra-me/renovate-config` base preset, not from here.

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

Uses reusable workflow `bfra-me/.github/.github/workflows/renovate.yaml@v4.27.0` (SHA `4861d88`; was `@v4.16.40` / `0ff5a4d` at 2026-07-26, `@v4.16.30` at 2026-06-25, `@v4.16.25` at 2026-06-14, `@v4.16.23` at 2026-06-04, `@v4.16.9` at 2026-05-23). Triggers on issue edits, PR edits, push to non-main branches, manual dispatch, and `workflow_run` after main CI succeeds. Includes `path-filters` scoped to Renovate config files and presets.

Carries a `print-config` dispatch input (*"Log the fully-resolved Renovate config for each repository, plus fully-resolved presets"*) — the cheapest available instrument for settling preset-resolution questions like the `extends`-order finding above, and currently unused in any survey.

### `codeql-analysis.yaml` — CodeQL security scanning

`github/codeql-action` v4.38.0 (SHA `b96794f`) across init/autobuild/analyze; PR + push to `main` + weekly Friday `05 11` cron; `javascript`.

### `scorecard.yaml` — OpenSSF Scorecard

### `update-repo-settings.yaml` — Probot Settings sync

Calls `bfra-me/.github/.github/workflows/update-repo-settings.yaml@v4.27.0` (SHA `4861d88`) on push to `main`, a daily `23 12` cron, and dispatch.

**Reference implementation for a defect flagged elsewhere.** [[marcusrbrown--esphome-life]] has carried a seven-survey footgun where its own `Update Repo Settings` workflow `uses:` the **`renovate.yaml`** path from the same reusable-workflow repo — so `settings.yml` is never applied and every merge runs Renovate twice. That page recorded the fix as "a one-token path swap" based on the upstream file existing at v4.22.0. This repo is the working proof: identical secrets signature (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`), zero inputs, correct path, in production. The repair is now demonstrated, not just available.

## Fro Bot Integration

**Fro Bot workflow present and active** — `fro-bot.yaml`, 477 lines / 21,403 B, with `fro-bot/agent@v0.110.1` (SHA `2a9e2dd610db6006ad92aedc7991d1375a415b4c`) as of 2026-09-11. The agent pin advanced v0.95.0 → **v0.110.1** since 2026-07-26 (~15 minors, crossing the cosmetic v0.100 boundary; still 0.x), the same rapid Renovate-authored cadence tracking [[fro-bot--agent]]. Prior: v0.76.2 → v0.95.0 between 2026-06-25 and 2026-07-26. Runner action pins at 2026-09-11: `actions/checkout` **v6.1.0** (`d23441a`, held), `actions/setup-node` **v6.5.0** (`2499707`, held), `pnpm/action-setup` v6.0.9 → **v6.1.0** (`ea17c68`, #1567). `actions/create-github-app-token` **v3.2.0** (`bcd2ba4`) in `main.yaml`.

**Delivery shape (2026-09-11):** the job's steps are, in order — `Refuse fork PR heads from comment triggers`, `Detect Sunday UTC for upstream watch cadence`, `Checkout repository`, `Setup pnpm`, `Setup Node.js`, `Install dependencies`, `Run Fro Bot`. **Nothing follows `Run Fro Bot`.** Under the harness's working-dir delivery contract that makes the caller responsible for `git commit` / `git push` / `gh pr create`, this workflow has no delivery channel for file edits. See headline finding 1. The `gh`-mediated paths (updating the perpetual issue, commenting on PRs) are unaffected and demonstrably still work — #1314 was updated 2026-09-10.

**Security controls worth recording** (present at this survey; novelty vs. prior surveys not established):

- **`Refuse fork PR heads from comment triggers`** — a first step that resolves `repos/{repo}/pulls/{n}` via `gh api --jq '.head.repo.fork'` and hard-`exit 1`s if true, before any checkout. Server-verified rather than payload-trusted, the same shape as [[marcusrbrown--infra]]'s fork guard. Note it depends on `gh api` succeeding; a transient API failure with `set -e` absent on the comparison would fall through — the guard is written as a bare `if [ "$is_fork" = "true" ]`, so a failed call yielding an empty string does **not** block. Fail-open on error, fail-closed on a clean `true`.
- **`persist-credentials: false`** on checkout in both `fro-bot.yaml` and `main.yaml`'s release job.
- Job-level `permissions:` grant `contents`/`discussions`/`issues`/`pull-requests: write` on a file whose top-level default is `contents: read`.
- The routing `if:` excludes fork PR heads, `[bot]`-suffixed authors, the `fro-bot` login itself, and restricts issue/comment triggers to `OWNER`/`MEMBER`/`COLLABORATOR`.

**Run profile:** of the last 40 `Fro Bot` runs, **36 concluded `skipped`** (24 `issues`, 9 `pull_request`, 3 `issue_comment`) and 4 executed — all four the `30 15` schedule, all `success`. The trigger surface is ~100% bot-authored (Renovate), so the content-triggered half of the daemon is inert by construction. Fourth instance of the no-op run storm after [[marcusrbrown--tokentoilet]] (98/100), [[marcusrbrown--dotfiles]] (97/100), and [[bfra-me--ha-addon-repository]].

**Prompt preamble blocks (recorded 2026-09-11; not present on this page before).** `SCHEDULE_PROMPT` now opens with four named contract blocks ahead of the numbered categories — **EXECUTION MODEL** (analyze in parallel, mutate serially, return to a clean tree between mutations), **DEDUPLICATION** (search for an existing open bot-authored PR/issue for the same root cause before creating one), **SCOPE CAP** (if the smallest safe fix is not clearly minimal and reversible, log it under "Needs Human Attention" instead of auto-healing), and **DEPENDENCY OWNERSHIP** (Renovate owns routine bumps; the agent may touch versions only for confirmed critical/high advisories, never batching unrelated changes into a security fix). This is the same prompt-contract vocabulary observed in [[bfra-me--works]]'s 2026-09-03 `fro-bot.yaml` rewrite (EXECUTION MODEL / MINIMALITY GATE / TRUSTED AUTHORS / HONESTY CONTRACT) — the blocks are propagating across the fleet as a shared dialect rather than being authored per-repo.

On DEDUPLICATION specifically: this repo shows **zero** duplicate bot PRs, against confirmed failures of the same clause in [[marcusrbrown--marcusrbrown-com]] (#473/#523 byte-identical, 32 days apart) and [[marcusrbrown--gpt]] (six PRs on one file). That is not yet evidence the clause works — the agent here has not been able to open a PR since 2026-08-07, so the clause has had nothing to deduplicate. Re-test after delivery is restored.

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

**The perpetual issue is unbounded by design and has crossed GitHub's soft limit by ~2.6× (2026-09-11).** Issue #1314's body measures **173,872 characters** with 73 comments. GitHub's REST API soft limit for issue bodies is 64 KiB. The prompt's SINGLE ISSUE MANAGEMENT block mandates *"PREPEND a new dated section to the TOP of the issue body"* and *"ALWAYS prepend new updates to existing content"* — with **no size cap, no rotation directive, and no archival branch**. Growth is monotonic and the prompt contains nothing that could ever stop it. Each daily section costs ~10 KB.

This is the third instance of the unbounded-perpetual-issue class, and the most clearly structural. [[marcusrbrown--cortexkit-anthropic-auth]] reached 54,813 chars against a prompt directive to rotate at 50,000 — a *violated* budget the agent was supposed to reason about. Here there is no budget to violate. The distinction matters for remediation: a soft prose budget an agent must self-enforce is unreliable (cortexkit proved that), but the absence of one is a guaranteed failure rather than a probable one.

Two properties make it worse than a slow leak:

- **The overflow is silently accepted.** The agent's own report notes the API has been taking oversized bodies since 2026-09-07. There is no error, no failed run, no degraded status — until whatever limit is actually enforced is reached, at which point the daily write starts failing in a repo where nobody reads the run logs because they are always green.
- **A 174 KB body is the agent's own working context.** Every run that prepends must first read what it is prepending to. The report format is also the input format, so unbounded growth is a monotonically increasing per-run cost on a daemon whose product is already being discarded.

The fix is a rotation contract with a hard character budget and a named archival destination (close-and-link to a dated successor, the pattern the *dated-issue cleanup* half of this same prompt already implements in the opposite direction).

## Dev Tooling

Versions below are as of 2026-09-11 (`ea21e16`); the prior column is the 2026-07-26 survey.

| Tool | Version / Config | Was (2026-07-26) |
| --- | --- | --- |
| ESLint | 10.10.0 | 10.7.0 |
| `@bfra.me/eslint-config` | 0.52.1 — **crossed the 0.51 → 0.52 minor** that broke [[marcusrbrown--vbs]]'s grouped PR; landed cleanly here (#1543) | 0.51.1 |
| Prettier | 3.9.6 (held) | 3.9.6 |
| `@bfra.me/prettier-config` | 0.16.11, `/120-proof` | 0.16.9 |
| lint-staged | 17.5.0 (`*.{js,json,jsx,md,toml,ts,tsx,yml,yaml}`) | 17.1.1 |
| simple-git-hooks | 2.14.0 (pre-commit runs lint-staged) | 2.13.1 |
| semantic-release | 25.0.9 | 25.0.8 |
| eslint-config-prettier | 10.1.8 (held) | 10.1.8 |
| eslint-plugin-prettier | 5.5.6 (held) | 5.5.6 |
| markdownlint | 0.40.0 (held) | 0.40.0 |
| conventional-changelog-conventionalcommits | 9.3.1 (held) | 9.3.1 |
| semantic-release-export-data | 1.2.0 | 1.2.0 |

Note the asymmetry with [[marcusrbrown--vbs]]: the identical `@bfra.me/eslint-config` 0.51.x → 0.52.1 bump that froze VBS's grouped PR for 14 days merged here without incident. This repo lints only JSON/YAML/Markdown through a bare re-export config, so a new `unicorn/*` rule has almost no surface to catch. **The blast radius of a lint-tooling bump is a function of the consumer's source tree, not of the bump** — which is an argument for ungrouping lint packages at the preset level rather than expecting each consumer to discover the cost independently.

ESLint config (`eslint.config.js`) is a single re-export of `@bfra.me/eslint-config` — no local overrides.

**2026-09-11 — the override ledger split in two.** See headline finding 4 for the full table. `package.json` → `pnpm.overrides` still carries the six `>=`-floor entries below; a **new** `pnpm-workspace.yaml` now carries three Renovate-maintained exact pins (`fast-uri: 3.1.7`, `js-yaml: 4.3.2`, `undici: 7.29.1`), and `undici` has migrated out of `package.json` entirely since the prior survey. `fast-uri` currently exists in both files. `pnpm-workspace.yaml` additionally declares `allowBuilds` + the legacy `onlyBuiltDependencies` (disagreeing by one entry), `savePrefix: ''`, `shamefullyHoist: true`, `shellEmulator: true`, `strictPeerDependencies: false`, and the `minimumReleaseAgeExclude` list discussed in headline finding 3.

**pnpm overrides for supply-chain hardening:** `fast-uri >=3.1.2`, `flatted >=3.4.2`, `handlebars >=4.7.9`, `lodash-es >=4.18.0`, `picomatch@2 ^4.0.0`, `picomatch@4 ^4.0.4` (2026-07-26; unchanged at 2026-09-11). The `picomatch@2` selector was **bumped `^2.3.2` → `^4.0.0`** since 2026-06-25 — this is PR #1311 (the picomatch@2-v4 update open across five prior surveys) finally landing. Note the override now forces the `@2` alias onto the v4 line, collapsing the two selectors toward a single major. Mirrors the override approach used in [[marcusrbrown--mrbro-dev]] and [[marcusrbrown--marcusrbrown-github-io]] — a config-only repo carrying transitive-dep pins because npm advisory floors propagate via the lockfile. **Merged since prior survey:** #1402 (`undici >=7.28.0`, CVE-2026-9697 / CVE-2026-9678) landed — the category-2 security-override autoheal path completed end-to-end. **In-flight (2026-07-26):** open PR #1478 (authored by `fro-bot`) adds a `fast-uri` bump to `3.1.4` remediating CVE-2026-16221 — the same category-2 path firing again; not yet merged, so the `fast-uri >=3.1.2` floor above is unchanged pending it. **Resolved 2026-09-11:** #1478 merged 2026-08-03 (12 days open), and a further category-2 PR #1507 (`js-yaml → 4.3.1`, GHSA-5p4m-2wfm-xmqj) merged 2026-09-05 after **29 days**.

**The category-2 path has a clean record and a lengthening latency (2026-09-11).** All ten `fro-bot`-authored PRs in the repo's history merged; none was closed unmerged. But the time-to-merge on the security-override class is climbing monotonically: #1152 same-day (2026-03-23) → #1195 1 day → #1295 4 days → #1402 12 days → #1478 12 days → **#1507 29 days**. The queue is clean because everything eventually lands, not because it lands promptly, and the trend is one-directional across six months. Given that the delivery channel has since gone silent (no `fro-bot` PR created since 2026-08-07), the next data point in this series will not arrive until the workflow grows a delivery step.

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
| [[marcusrbrown--vbs]] | `#5.2.12` (2026-09-08; `#5.2.13` stranded in a blocked grouped PR) + **redundant `group:allNonMajor` re-extension that voids the preset's 0.x valve** — see headline finding 2 | `pnpm install && pnpm fix` (`executionMode: branch`) |
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

**2026-09-08 — two observations from the [[marcusrbrown--vbs]] survey (consumer side; this repo's source was not re-read).** VBS pins `#5.2.12` + `group:allNonMajor`, `postUpgradeTasks: ['pnpm install', 'pnpm fix']` in `branch` execution mode, `rebaseWhen: 'behind-base-branch'`.

1. **`group:allNonMajor` has a measurable blast radius.** A single `@bfra.me/eslint-config` `0.51.2 → 0.52.1` bump inside the grouped `renovate/all-minor-patch` PR introduced a new `unicorn/prefer-array-some` violation, turning the PR's required `Test` context red and `renovate/artifacts` red with it (`pnpm fix` could not auto-fix). Because the group holds everything non-major, that one lint rule froze pnpm `11.22.0 → 11.25.0`, `bfra-me/.github` `v4.20.0 → v4.26.0`, `fro-bot/agent` `v0.105.0 → v0.109.4`, this preset's own `5.2.12 → 5.2.13`, and `simple-git-hooks` for 14 days and counting. Worth considering a preset-level ungrouping rule for lint/format tooling: those packages can turn previously-valid source into a CI failure with no source change, which is not a property ordinary devDependencies have.
2. **The 0.x ungrouping safety valve did not fire on a 0.x minor.** The v5 preset is recorded here as adding `group:allNonMajor` *with* a 0.x ungrouping safety valve, yet `@bfra.me/eslint-config` `0.51.2 → 0.52.1` — breaking under 0.x semantics — rode inside the grouped PR rather than being separated. Recorded as an unresolved observation, not a defect claim: the preset source was not read this survey and the valve's exact scope (`separateMinorPatch`? a `packageRules` match on `0.x`? consumer-side `group:allNonMajor` overriding it?) is unverified. A source-side re-survey should resolve it, since the failure mode above is exactly what the valve appears intended to prevent.

   **RESOLVED 2026-09-11 (source-side):** the third hypothesis was correct — consumer-side `group:allNonMajor` overriding it. The valve is present, correctly written, and correctly positioned last in the preset's `packageRules`; VBS re-extends `group:allNonMajor` *after* the preset in its own `extends` array, which appends the grouping rule behind the valve and re-groups what the valve peeled out. The preset is not defective. Full mechanism and the generalizable footgun in headline finding 2 above.

**2026-09-08 — new downstream artifact: `minimumReleaseAgeExclude`.** VBS's `pnpm-workspace.yaml` gained a `minimumReleaseAgeExclude:` list (`'@bfra.me/eslint-config@0.51.2'`, `'@bfra.me/prettier-config@0.16.10 || 0.16.11'`), written by Renovate on 2026-08-23. This is Renovate reconciling its own release-age cooldown with pnpm 11's install-time `minimumReleaseAge` gate by emitting per-version escape hatches into the workspace manifest — first sighting in this ecosystem. **No `minimumReleaseAge` value is declared in the consumer repo** (no such key in `pnpm-workspace.yaml`, no `.npmrc`), so the cooldown originates outside the repo or the exclusions are inert. If this preset sets `minimumReleaseAge`, that is the likely origin and should be documented here on the next source-side survey.

**ANSWERED 2026-09-11 (source-side): it does not.** `default.json`'s only two `minimumReleaseAge` occurrences are both `null`, in the own-project fast-track rules. The Renovate-side cooldown comes from `github>bfra-me/renovate-config#5.2.7`. This repo carries its own (longer) exclusion list covering exactly the packages the fast-track waives, which identifies the mechanism: two same-named gates at different layers, only one of which `null` relaxes. Full treatment in headline finding 3. Still unresolved: where pnpm's half of the gate is configured — it appears in neither repo's tree.

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
| 2026-09-11 | `ea21e16` | **Preset policy unchanged for a seventh survey; three carried open questions answered and one new structural defect found.** bfra-me base pin `#5.2.6` → **`#5.2.7`** — and **current**, matching upstream's latest release (2026-08-08). Latest release **5.2.9 → 5.2.13** (four patches: 5.2.10 08-03, 5.2.11/5.2.12 08-08, 5.2.13 09-05), confirming the indirect signals from [[marcusrbrown--marcusrbrown-com]] and [[marcusrbrown--vbs]]. agent **v0.95.0 → v0.110.1** (`2a9e2dd`, crosses cosmetic v0.100); `pnpm/action-setup` v6.0.9 → **v6.1.0** (`ea17c68`); `actions/checkout` v6.1.0 and `actions/setup-node` v6.5.0 **held**; `bfra-me/.github` reusable **v4.16.40 → v4.27.0** (`4861d88`, both `renovate.yaml` and `update-repo-settings.yaml`); `github/codeql-action` **v4.38.0**. node 24.18.0 → **24.21.0**; pnpm 11.16.0 → **11.26.0**; eslint 10.7.0 → **10.10.0**; `@bfra.me/eslint-config` 0.51.1 → **0.52.1**; `@bfra.me/prettier-config` 0.16.9 → **0.16.11**; lint-staged 17.1.1 → **17.5.0**; simple-git-hooks 2.13.1 → **2.14.0**; semantic-release 25.0.8 → **25.0.9**; prettier 3.9.6 held. **(1) Working-dir delivery break — fourth fleet instance, and the cleanest isolation of it.** `fro-bot.yaml`'s last step is `Run Fro Bot` with no commit/push/PR step; the daemon has written the same HIGH-severity `browserslist` override (GHSA-73wf-gq98-2v4g / CVE-2026-73088) to the working tree on four consecutive runs and it is **absent from `pnpm-workspace.yaml` at HEAD** — directly verified, not taken from the self-report. `Fro Bot` is a required check on `main` with `enforce_admins: true` and reports success throughout. **(2) The 0.x ungrouping valve is correct; [[marcusrbrown--vbs]] defeats it downstream** by re-extending `group:allNonMajor` *after* the preset, appending the grouping behind the valve — resolves the 2026-09-08 contradiction and the preset is exonerated. **(3) `minimumReleaseAge` origin answered:** this preset never sets a positive value (only `null` fast-track waivers); the cooldown is upstream from bfra-me, and the growing `minimumReleaseAgeExclude` lists are Renovate reconciling two same-named gates at different layers. **(4) New split-brain override ledger:** `pnpm-workspace.yaml` (new to this page) carries three Renovate-maintained exact pins while `package.json` keeps six unmaintainable `>=` floors, with `fast-uri` in both and precedence undeclared; `allowBuilds` and legacy `onlyBuiltDependencies` also coexist and disagree. **(5) Perpetual issue #1314 at 173,872 chars — ~2.6× GitHub's 64 KiB soft limit**, with no rotation directive anywhere in the prompt. **Queue inverted vs the fleet:** **0 open PRs**, 10/10 `fro-bot` PRs merged all-time — but merge latency on the security class is climbing (same-day → 29 days) and no `fro-bot` PR has been created since 2026-08-07. Open issues **7, membership byte-stable** since 2026-07-26; legacy maintenance-report issues still outside the autoheal cleanup matcher (seventh survey). 36 of last 40 runs `skipped`; 4/4 scheduled `success`. Tree baseline 26 blobs. Stars/watchers/forks 1/2/0 unchanged. Category-5 focus repos still the two **private** Marcus repos (names withheld per the public-only invariant). Survey conducted with unauthenticated public reads — `gh` had no token in the run environment. |
