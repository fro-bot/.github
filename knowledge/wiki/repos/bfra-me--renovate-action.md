---
type: repo
title: bfra-me/renovate-action
created: 2026-05-20
updated: 2026-08-10
sources:
  - url: https://github.com/bfra-me/renovate-action
    sha: bc9c45917d3f7b33962d3ba44b11d58d9f6c2647
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/renovate-action
    sha: 5b2b2faff7e3e9725fdfe87d5e1802f6f5cb831c
    accessed: 2026-06-11
  - url: https://github.com/bfra-me/renovate-action
    sha: 5cacb673ba19c31b04df2b58913b87285842b193
    accessed: 2026-06-21
  - url: https://github.com/bfra-me/renovate-action
    sha: 5ad371e079f747400f6ffdd13d0a20d06319a59f
    accessed: 2026-07-03
  - url: https://github.com/bfra-me/renovate-action
    sha: 318e0292303b530092c06861b6adb33c295df720
    accessed: 2026-07-18
  - url: https://github.com/bfra-me/renovate-action
    sha: a4b5a95579396b1e97a9a84d18e0ed5f37cf3ae5
    accessed: 2026-08-10
tags: [renovate, github-action, composite, self-hosted, docker, typescript, semantic-release, bfra-me]
related:
  - bfra-me--ha-addon-repository
  - marcusrbrown--renovate-config
  - marcusrbrown--ha-config
  - marcusrbrown--github
  - marcusrbrown--systematic
  - fro-bot--agent
  - github-actions-ci
  - docker-containers
  - probot-settings
---

# bfra-me/renovate-action

Composite GitHub Action that runs a **self-hosted Renovate bot** in a Docker container with **GitHub App** authentication. Published as `bfra-me/renovate-action@v10` (was `@v9` through 2026-07-18; major branch and tag crossed at the 2026-07-31 `10.0.0` release) and consumed across the `bfra-me` organization (and indirectly by `marcusrbrown/*` / `fro-bot/*` via the reusable `bfra-me/.github/.github/workflows/renovate.yaml` that wraps it).

> **v10 correction (2026-08-10):** The `v10` major boundary landed 2026-07-31 — but it was **not** the Docker-execution removal five prior surveys predicted. `10.0.0` is a Renovate engine major bump: `renovate` v43 → **v44** (#3580, the sole `⚠ BREAKING CHANGE`). Docker-backed execution is **still present and still deprecated**: `action.yaml` continues to emit `::warning::Docker-based action execution is deprecated and is planned for removal in v10` and its inline warning still reads `execution-mode=... is not supported in v9`. That deprecation copy is now **stale/self-contradictory** — the repo is on v10 yet the text still names v9/v10 as the removal horizon. The removal is deferred, not delivered; re-flag as a probable autoheal "stale deprecation copy" candidate.

This is the **execution surface** for the bfra-me dependency-update policy that [[marcusrbrown--renovate-config]] defines as preset content. Where `marcusrbrown/renovate-config` answers "what should Renovate do," this repo answers "how does Renovate actually run."

## Identity

- **Owner:** `bfra-me` (org)
- **Visibility:** public
- **License:** MIT
- **Author:** Marcus R. Brown <git@mrbro.dev>
- **Default branch:** `main` (release branch: `release`; major-version branch: **`v10`**, was `v9`)
- **Primary language:** Shell (action logic) + TypeScript (scaffold + tooling)
- **Topics:** `composite`, `github-action`, `github-actions`, `renovate`, `nodejs`, `typescript`, `action`, `self-hosted`
- **Created:** 2023-09-22
- **Last push:** 2026-08-10 (was 2026-07-18, 2026-07-03, 2026-06-21, 2026-06-11, 2026-05-20 at prior surveys)
- **Latest release:** `10.11.0` (2026-08-09; **v10 major crossed at `10.0.0` on 2026-07-31** — Renovate v43 → v44 engine bump; was `9.147.0` on 2026-07-18, `9.133.0` on 2026-07-03, `9.123.0` on 2026-06-21, `9.113.0` on 2026-06-11, `9.90.0` on 2026-05-20. ~23 releases (9.147.0 → 10.11.0) in 22 days — same Renovate self-bump cadence through semantic-release, plus the v44 major)
- **Stars / Forks / Watchers:** 3 / 1 / 3 (steady across all six surveys)
- **Open issues:** 65 (was 64, 66, 61, 62; long-lived autoheal / Renovate dependency dashboard noise, oscillating in the low-to-mid 60s)
- **Template repository:** created from `bfra-me/github-action` (bfra-me's TypeScript GitHub Action template) — confirmed via API `template_repository` field 2026-07-18, re-confirmed 2026-08-10

## Layout

```
.
├── action.yaml              # THE runtime — composite steps, JSON config merge, Docker
├── docker/
│   └── entrypoint.sh        # Tool installs (yq, Node, Bun, pnpm, Yarn) + analytics
├── src/
│   ├── main.ts              # Scaffold TS — @actions/core wait utility (not used at runtime)
│   ├── wait.ts
│   └── __tests__/
├── dist/                    # tsup bundle — committed, verified for drift in CI
├── docs/                    # Astro/Starlight docs site (separate pnpm workspace package)
├── .github/
│   ├── CODEOWNERS
│   ├── copilot-instructions.md
│   ├── filters.yaml         # dorny/paths-filter config for CI gating
│   ├── renovate.json5       # self-referential Renovate config
│   ├── settings.yml         # Probot Settings
│   └── workflows/           # 8 workflows
├── .ai/                     # AI agent context (not surveyed under read-limit policy)
├── .cursor/                 # Cursor IDE context
├── AGENTS.md                # Project knowledge base for AI agents
├── README.md
├── action.yaml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsup.config.ts
├── tsconfig.json
├── eslint.config.ts
├── .releaserc.yaml          # semantic-release config (branch: release)
└── llms.txt
```

The TypeScript layer (`src/`, `dist/`) is **not** what consumers execute — `action.yaml` is. The TS scaffold exists for the published-action lint/check pipeline, dist drift verification, and as a placeholder for future TS-backed steps. The composite action's actual work happens in Bash inside `action.yaml` and `docker/entrypoint.sh`.

## How the Action Works

### Composite Steps (`action.yaml`)

1. **`get-renovate-app`** — `actions/create-github-app-token@v3.2.0` mints a short-lived installation token from the consumer's `renovate-app-id` + `renovate-app-private-key`. Scoped to `github.repository_owner`.
2. **`configure`** — Bash step (`bash -Eeuo pipefail`) that:
   - Pins `RENOVATE_VERSION` with a `# renovate: datasource=docker depName=renovate packageName=ghcr.io/renovatebot/renovate versioning=semver` comment so Renovate self-bumps it. Pinned at `43.186.2` on 2026-05-20; `43.220.0` on 2026-06-11; `43.233.3` on 2026-06-21; `43.251.0` on 2026-07-03; `43.269.1` on 2026-07-18; **`44.17.0` on 2026-08-10 (Renovate v43 → v44 major — this is the `10.0.0` breaking change).**
   - Builds the `renovate_git_author` identity from the GitHub App slug.
   - Defines `validate_json()` and `merge_global_config()` Bash functions that deep-merge the action's base config (`zzglobal_config` inline JSON) with the user-supplied `global-config` input.
   - **Security boundary:** `allowedCommands`, `platform`, `gitAuthor`, `gitIgnoredAuthors`, `cacheDir`, `repositoryCache` are protected. `allowedCommands` is restored from base after merge (and `onboardingConfig` is deep-merged with user overrides then re-pinned); the others emit warnings if the user tries to set them, and `merge_global_config()` explicitly `del(.onboardingConfig, .platform, .gitAuthor, .gitIgnoredAuthors, .cacheDir, .repositoryCache)` from the user config before the `*` merge. Falls back to base config on any validation failure.
   - **`allowedCommands` allowlist expanded substantially by 2026-08-10** — the merge-safety regex list grew from the JS/prettier/eslint/biome/corepack set to a **multi-ecosystem package-manager allowlist**: Node (npm/pnpm/yarn/bun install + corepack + biome/eslint/prettier/sort-package-json), **Python** (`poetry`, `pip`, `pip-compile`/`pip-sync`, `pipenv`, `uv`, `black`, `ruff`, `isort`, `pdm`), **Rust** (`cargo update|build|test --locked`), **Go** (`go mod tidy|download`, `go generate|test ./...`, `gofmt`), and **Ruby** (`bundle install|lock|update|exec rubocop -A`). Each entry is a `^…$`-anchored regex. This widens the `postUpgradeTasks` execution surface across every ecosystem Renovate might touch in autodiscover mode while keeping the anchored-regex guardrail — a meaningful expansion of what the self-hosted runner will execute post-upgrade.
3. **`v9 deprecation notice`** — emits a `::warning::Docker-based action execution is deprecated and is planned for removal in v10`. **Note (2026-08-10):** the step is still literally named `v9 deprecation notice` and still names v10 as the removal horizon even though the repo is now on v10 — stale copy (see the v10-correction callout above).
4. **`Restore Renovate Cache`** (conditional on `cache: true`) — `actions/cache/restore@v5.1.0` keyed on `renovate-cache-v<major>`, `enableCrossOsArchive: true`.
5. **`Prepare Renovate Cache`** — `chown -R runneradmin:root /tmp/renovate` so the container user can write the cache.
6. **`Renovate <version>`** — `renovatebot/github-action@v46.2.0` (was v46.1.4, steady since 2026-06-21 until this survey) runs the Renovate Docker image (`ghcr.io/renovatebot/renovate:<RENOVATE_VERSION>`) with `docker-user: root`, `mount-docker-socket: true`, custom `docker-cmd-file` at `docker/entrypoint.sh`. The action passes through a strict `env-regex` whitelist (CI vars, GitHub vars except PATH/ENV, proxy vars, log level, NODE_OPTIONS, `RENOVATE_*`, `RUNNER_*`). **New env vars observed 2026-08-10:** `RENOVATE_BINARY_SOURCE: install` (npm-installed Renovate binary inside the container, foreshadowing the eventual Docker-less path), `RENOVATE_BRANCH_PREFIX_OLD: renovate-github/` (migration prefix so branch renames are detected), `RENOVATE_USE_BASE_BRANCH_CONFIG` (`merge` when a `branch` override is set, else `none`), `RENOVATE_PRESET_CACHE_PERSISTENCE` (bound to cache-enable), and `RENOVATE_DEPENDENCY_DASHBOARD_FOOTER` (adds the manual-trigger checkbox to the dashboard).
7. **`Finalize Renovate Cache`** + **`Save Renovate cache`** — deletes the prior cache entry via `gh api -X DELETE` and saves the new one (always-runs on success or failure when cache enabled).

### Docker Entrypoint (`docker/entrypoint.sh`)

`bash -Eeuo pipefail`. Inside the container it:
- Initializes `/tmp/renovate-analytics`.
- Defines `record_docker_metric()` and `record_failure()` helpers that emit JSON metric files via inline Node.js (`fs.writeFileSync`).
- Installs runtime tools (yq, Node, Bun, pnpm, Yarn) that Renovate's package managers may invoke. Pinned tool versions at 2026-08-10: yq `v4.53.3` (steady), Node **`24.19.0`** (was 24.18.0), Bun **`1.3.14`** (was `bun-v1.3.6`), pnpm **`11.20.0`** (was 11.13.0), Yarn **`4.18.0`** (was 4.17.1) — each carries its own `# renovate:` comment so the self-Renovate loop keeps them current independently of `RENOVATE_VERSION`. The container `PNPM_VERSION` (11.20.0) matches the repo's own `packageManager` pin.
- Runs Renovate as the `ubuntu` user via `runuser -u ubuntu renovate` (the cache-prepare `chown -R ubuntu:ubuntu /tmp/renovate` aligns ownership for read/write).

### Key Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `renovate-app-id` | ✅ | — | GitHub App ID |
| `renovate-app-private-key` | ✅ | — | GitHub App private key |
| `autodiscover` | | `false` | When `false`, autodiscover-filter is forced to `github.repository` |
| `autodiscover-filter` | | `[]` | JSON array of glob filters |
| `branch` | | — | Optional base branch override |
| `cache` | | `false` | Enables `actions/cache` for `/tmp/renovate/cache` and `RENOVATE_REPOSITORY_CACHE` |
| `dry-run` | | `false` | When `true`, sets `RENOVATE_DRY_RUN=extract` (lightest dry-run mode) |
| `execution-mode` | | `container` | v9 deprecation scaffolding; non-container values warn and fall through |
| `global-config` | | `{}` | JSON string deep-merged into base config; protected fields enforced |
| `log-level` | | `info` | |
| `print-config` | | `false` | |

### Outputs

- `docker-image` — e.g., `ghcr.io/renovatebot/renovate:43.186.2`
- `renovate-version` — e.g., `43.186.2`

## Workflows

Eight workflows under `.github/workflows/`, all using `.yaml` extension and SHA-pinned actions with version comments:

### `main.yaml` — primary CI + release pipeline

- **Triggers:** `merge_group`, `pull_request` (main), `push` (main), `workflow_dispatch`.
- **Concurrency:** group-keyed on `workflow + event-number-or-ref`, cancel-in-progress.
- **Jobs:**
  - **`setup`** — checkout, pnpm/setup-node from `package.json`, `pnpm bootstrap`, `dorny/paths-filter@v4.0.1` against `.github/filters.yaml` to emit `dist-changed`, `docs-changed`, `should-check`, `src-changed`, `renovate-changed` flags.
  - **`check`** — `pnpm build && pnpm check`, plus a docs preview smoke test (`pnpm run preview`, `curl http://localhost:4321/renovate-action`).
  - **`test`** — `pnpm test` (Vitest), then a **self-test** step that runs `uses: ./` with `dry-run: true`, `log-level: debug`, `print-config: true` against the consumer's own repo (gated to `bfra-me` org, non-default branch, no `renovate-changed`).
  - **`build`** — `pnpm build` and dist drift verification (`git diff --ignore-space-at-eol dist/`). Uploads `dist/` artifact on failure.
  - **`build-docs`** + **`deploy-pages`** — Astro/Starlight site build with `actions/configure-pages@v6.0.0`, deployed via `actions/deploy-pages@v5.0.0` (main only).
  - **`release`** — checks out the `release` branch, fast-forwards `main` into `release` (`git merge --no-ff -Xtheirs -m 'skip: merge (<sha>) [skip release]'`), pushes, then runs `semantic-release` with GitHub App token. Dry-run on PRs.

### `fro-bot.yaml` — Fro Bot agent integration

- **Agent version:** `fro-bot/agent@v0.98.2` (SHA `994357c38748c9555e218468b20f4807e742d817`) as of 2026-08-10; was `v0.93.1` (SHA `a4976f45`) on 2026-07-18, `v0.82.0` (SHA `77d6a464`) on 2026-07-03, `v0.73.0` (SHA `df121025`) on 2026-06-21, `v0.60.0` (SHA `f2f3c08f`) on 2026-06-11, and `v0.44.2` (SHA `b97877b2`) at the 2026-05-20 survey — the last surveyed bump landed via `chore(deps): update fro-bot/agent to v0.98.2 (#3624)` on the 2026-08-10 HEAD commit. Still at or near the ecosystem's bleeding edge across all six surveys (canary confirmed again, though the lead over [[fro-bot--dashboard]]/[[marcusrbrown--gpt]] at v0.97.0 has narrowed to a fraction of a minor).
- **Triggers:** `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request` (opened/synchronize/reopened/ready_for_review/review_requested), `schedule` (`30 3 * * *` autoheal + `30 15 * * *` maintenance — daily 03:30 and 15:30 UTC), `workflow_dispatch` with `mode` choice (review/maintenance/autoheal, default `autoheal`) + `prompt` input, and `workflow_call` with required `prompt` input.
- **Bot-loop guards:** Identical pattern to the rest of the ecosystem — skip when issue/PR/comment author ends in `[bot]` or equals `fro-bot`. Comment triggers require `OWNER`/`MEMBER`/`COLLABORATOR` association and `@fro-bot` mention.
- **Mode resolution:** Inline Bash maps event type → mode (schedule `30 15 * * *` → maintenance, `30 3 * * *` → autoheal; `pull_request` → review; `workflow_dispatch`/`workflow_call` prompt used verbatim when non-empty; `workflow_dispatch` with no explicit mode input → **autoheal**). Mode selects which inline `env`-block prompt is used. Note the dispatch default changed: the 2026-05-20 survey recorded `workflow_dispatch` as user-selected only; the current workflow falls back to `autoheal` when the mode input is empty.
- **New guard (2026-08-10): `Validate review mode inputs` step** — a `workflow_dispatch` with `mode == 'review'` now hard-fails (`::error::Review mode requires a custom prompt…`) unless a `prompt` input is supplied. Review mode has no default prompt (its normal path is the `pull_request` event feeding `PR_REVIEW_PROMPT`), so this closes a footgun where a bare `mode=review` dispatch would otherwise run with an empty prompt. The `prompt` input doc-string now also states the verbatim-prompt path is "the path used by the release-notes-narrative automation" — an explicit hook into the two-phase release-notes narration pattern in [[fro-bot--agent]] / [[github-actions-ci]].
- **`PR_REVIEW_PROMPT`** — focused on the action's risk surface: JSON config merging security (`allowedCommands` must never be overridable), template variable substitution, shell script safety, Docker entrypoint security, cache ownership, workflow injection (untrusted input in `run:` blocks), TypeScript strictness (no `any`, no `@ts-ignore`, pure ESM), Renovate config (`allowedCommands` regex safety, onboardingConfig changes, gitIgnoredAuthors consistency), and **dist/ drift detection** ("if src/ changes, dist/ must be rebuilt"). Verdict format: `## Verdict: PASS / CONDITIONAL / REJECT` with mandatory `Blocking issues`, `Non-blocking concerns`, `Missing tests`, `Risk assessment` headings.
- **`MAINTENANCE_PROMPT`** — single rolling issue titled `Daily Maintenance Report`. 14-day bounded section history collapsed into a `Historical Summary`. Same single-perpetual-issue pattern as [[bfra-me--ha-addon-repository]].
- **`AUTOHEAL_PROMPT`** — five-category sweep:
  1. **ERRORED PRs** — diagnose/fix failing CI on trusted-author PRs only; **never** touches `.github/workflows/`, lockfiles, package-manager config, lockfile-maintenance branches, or the Fro Bot workflow itself; auto-rebuilds `dist/` when `src/` changes.
  2. **SECURITY** — Dependabot/Renovate alerts; remediate critical/high; do **not** batch unrelated bumps into a security PR.
  3. **CODE QUALITY & REPO HYGIENE** — report-only; runs `pnpm build`, `pnpm test`, `pnpm check`, validates allowedCommands regex, scans stale TODOs > 90 days via `git blame`.
  4. **DEVELOPER EXPERIENCE** — lint/format auto-fix PRs grouped into a single conventional-commit PR; rebuilds `dist/` when `src/` is touched.
  5. **PROGRESSIVE IMPROVEMENT** — report-only; checks Renovate version drift (don't open bump PRs — Renovate owns that), release-branch health, reusable-workflow versions, analytics integrity, cross-project pattern drift against `bfra-me/.github`.
- **Output:** single perpetual `Daily Autohealing Report` issue with structured tables (Summary, Errored PRs, Security, Code Quality, Developer Experience, Progressive Improvement, Needs Human Attention).
- **Dependency ownership rule** is explicit: "Renovate owns routine dependency/version bumps. You may change dependency versions only when remediating a confirmed security advisory (critical/high) or repairing an existing security-update PR." This is the cleanest articulation of the autoheal-vs-Renovate boundary observed across the ecosystem.

### `renovate.yaml` — self-managed Renovate orchestration

Direct workflow (not via `bfra-me/.github` reusable) because this repo is **upstream** of the reusable workflow it would normally consume. Triggers and uses `bfra-me/renovate-action@v9` against itself.

### `update-repo-settings.yaml` — Probot Settings sync

### `codeql-analysis.yaml` — CodeQL security scanning

Language: `typescript`. Schedule: `31 7 * * 3` (Wednesdays 07:31 UTC). Uses `github/codeql-action/init|autobuild|analyze@v4.35.5`.

### `scorecard.yaml` — OpenSSF Scorecard

Schedule: `20 7 * * 2` (Tuesdays 07:20 UTC). `branch_protection_rule` + `push` triggers. Publishes results to the public Scorecard dashboard.

### `dependency-review.yaml` — Dependency review on PRs

`actions/dependency-review-action@v4.9.0`. Job name `Review Dependencies` (status check name).

### `copilot-setup-steps.yaml` — GitHub Copilot agent bootstrap

Limited triggers: only `workflow_dispatch` plus path-filtered `push`/`pull_request` on the file itself. Pre-warms `pnpm install`.

## Configuration

### Renovate (`.github/renovate.json5`)

Extends:
- `github>bfra-me/.github:internal.json5#v4.16.45` (was `#v4.16.37` on 2026-07-18, `#v4.16.33` on 2026-07-03, `#v4.16.27` on 2026-06-21, `#v4.16.25` on 2026-06-11, `#v4.16.18` on 2026-05-20) — bfra-me org's internal Renovate preset
- `github>sanity-io/renovate-config:semantic-commit-type` — semantic commit type mapping

`ignorePresets` (observed 2026-07-18): `mergeConfidence:age-confidence-badges`, `mergeConfidence:all-badges` — suppresses the merge-confidence badge injection the internal preset would otherwise pull in, keeping PR bodies terse.

Notable rules:
- Pin `bfra-me/renovate-config` (`rangeStrategy: 'pin'`, `updatePinnedDependencies: false`) **except** for major updates (where pin updates are allowed).
- Renovate/Docker package updates (`ghcr.io/renovatebot/renovate`, `renovate`, `renovatebot/github-action`, `renovatebot/renovate`):
  - Major → `feat(deps)!:` (breaking)
  - Minor → `feat`
  - Patch → **disabled** (avoid noise)
  - Scheduled to nights/weekends only.
- All majors of the Renovate ecosystem grouped as `Renovate`.
- Custom regex manager updates `https://github.com/renovatebot/renovate/releases/tag/<ver>` links in `README.md`.
- Astro 0.x packages (`@astrojs/**`) automerge minor/patch via `github>bfra-me/renovate-config:automerge.json5#v4`.
- `postUpgradeTasks`: `pnpm run bootstrap && pnpm run build && pnpm run fix` (execution-mode: branch).
- `platformAutomerge: true`, `rebaseWhen: 'behind-base-branch'`.
- **Semantic-commit-type routing (observed 2026-08-10):** all `docker` datasource updates (now also `pinDigests: false`), the package set **`bun`/`pnpm`/`tsup`/`typescript`** (was `tsup`/`typescript` only on 2026-07-18 — `bun`/`pnpm` added), and `lockFileMaintenance` are typed `build` (which maps to a patch release under `.releaserc.yaml`). The Renovate-ecosystem rule (`ghcr.io/renovatebot/renovate`, `renovate`, `renovatebot/github-action`, `renovatebot/renovate`) schedules to `after 8pm every weekday`, `before 8am every weekday`, `every weekend` (natural-language schedule strings, equivalent to the prior "nights/weekends only" framing), carries `commitBody: '{{#if hasReleaseNotes}}{{{body}}}{{/if}}'`, and the major group sets `dependencyDashboardApproval: false` so grouped Renovate majors skip dashboard gating.

This is a **different** Renovate base preset family than the `marcusrbrown/renovate-config` line:

| Repo | Base preset |
| --- | --- |
| `bfra-me/renovate-action` (this repo) | `bfra-me/.github:internal.json5#v4.16.18` |
| [[bfra-me--ha-addon-repository]] | `bfra-me/renovate-config#5.2.1` |
| [[marcusrbrown--renovate-config]] (and downstream) | `bfra-me/renovate-config#5.2.1` + Marcus's overrides |
| Most Marcus repos | `marcusrbrown/renovate-config#4.5.x` (which itself extends `bfra-me/renovate-config#5.2.1`) |

So this repo is the most direct bfra-me-internal consumer; everyone else routes through either `bfra-me/renovate-config` or `marcusrbrown/renovate-config`.

### Probot Settings (`.github/settings.yml`)

- Extends `.github:common-settings.yaml` (bare `.github:` prefix → resolves to **`bfra-me/.github`**, not Marcus's `.github`).
- Topics, description, squash-merge commit policy.
- Teams: `actioneers` (push), `services` (maintain), `owners` (admin).
- **Branch protection on `main`:** required checks (strict): `Build`, `Check`, `Deploy to GitHub Pages`, `Fro Bot`, `Release`, `Test`, `Setup`, `Renovate / Renovate`, `Analyze`, `CodeQL`, `Review Dependencies`. `enforce_admins: true`, `required_linear_history: true`, no PR review requirement, no push restrictions.
- **Branch protection on `release`:** `enforce_admins: true`, no linear history, no required reviews/checks, no restrictions — the release branch is a fast-forward target only.

### Path Filters (`.github/filters.yaml`)

YAML anchors define reusable lists:
- `config` (anchor `&config`): `.github/**`, `pnpm-workspace.yaml`, `*.config.ts`, `**.json5?`, `**.md`, `**.yaml`, `**.yml`
- `dist-changed`: `dist/**` (added/modified only)
- `docs-changed` (anchor `&docs-changed`): `docs/**`
- `src-changed` (anchor `&src-changed`): workflows, docker, all `src/`, `action.yaml`, package manifests, lockfile, tsconfig
- `renovate-changed`: `.github/workflows/renovate.yaml`, `.github/renovate.json5`, `docker/entrypoint.sh`, `action.yaml` — the Renovate-blast-radius set used to suppress the self-test step
- `should-check`: aliased union of `config + docs-changed + src-changed`

### Tooling

| Tool | Version (2026-08-10; prior survey value in parens where changed) |
| --- | --- |
| Node.js | **24.19.0** (was 24.18.0) (`engines.node`; matches container `NODE_VERSION`) |
| pnpm | **11.20.0** (was 11.13.0; matches container `PNPM_VERSION`) |
| TypeScript | 6.0.3 (steady) |
| ESLint | **10.8.0** (was 10.7.0), extends `@bfra.me/eslint-config@0.51.1`; now also pins `eslint-config-prettier@10.1.8` + `eslint-plugin-prettier@5.5.6` explicitly |
| Prettier | **3.9.6** (was 3.9.5), extends `@bfra.me/prettier-config/120-proof@0.16.9` |
| tsup | 8.5.1 (bundler, ESM output, license-aware via `esbuild-plugin-license@1.2.3`) |
| Vitest | 4.1.10 (steady), `@vitest/eslint-plugin@1.6.26` (was 1.6.23) |
| `@actions/core` | 3.0.1 (only runtime dep) |
| semantic-release | **25.0.9** (was 25.0.7) with `@semantic-release/changelog@6.0.3`, `@semantic-release/git@10.0.1`, `semantic-release-export-data@1.2.0`, `conventional-changelog-conventionalcommits@9.3.1` |
| lint-staged | 16.4.0 (steady; this repo on 16 line) |
| simple-git-hooks + lint-staged | pre-commit runs `pnpm run fix` on TS/JS/CSS/MD/JSON/YAML |
| jiti | 2.7.0 (TS config loading) |
| js-yaml | **4.3.1** (was 4.3.0) |
| `@types/node` | **24.13.3** (was 24.13.2) |
| `@bfra.me/tsconfig` | 0.13.1 (base tsconfig) |
| eslint-plugin-node-dependencies | 2.2.0 (steady) |
| simple-git-hooks | 2.13.1 |

### Release Pipeline (`.releaserc.yaml`)

- **Branch:** `release` (separate from `main`; main → release fast-forward in CI).
- **Tag format:** bare semver (`9.90.0`), with a parallel major-version branch (`v9`) for downstream `@v9` pins.
- **Plugins:** commit-analyzer, release-notes-generator, changelog, npm (private package — no publish), git (commits `dist`, `package.json` with `chore(release): <version> [skip ci]`), github, `semantic-release-export-data`.
- **Custom release rules:** `build` → patch, `docs(readme.md)` → patch, `skip` → no release.
- **Preset:** conventionalcommits with extended type map (feat, build, fix, docs, test, ci, style, refactor, perf, revert, chore, skip-hidden).

## Cross-Ecosystem Notes

| Aspect | bfra-me/renovate-action | [[marcusrbrown--renovate-config]] | [[bfra-me--ha-addon-repository]] |
| --- | --- | --- | --- |
| Role | **Runner** (executes Renovate) | **Policy** (preset content) | Template (consumes policy + runner) |
| Branching | `main` → `release` → tagged + `v10` branch (was `v9`) | `main` → tagged + `v4` branch | `main` only |
| Renovate base preset | `bfra-me/.github:internal.json5#v4.16.45` | `bfra-me/renovate-config#5.2.1` | `bfra-me/renovate-config#5.2.1` |
| Fro Bot agent | v0.98.2 as of 2026-08-10 (v0.93.1 on 2026-07-18, v0.82.0 on 2026-07-03, v0.73.0 on 2026-06-21, v0.60.0 on 2026-06-11, v0.44.2 at first survey — newest in ecosystem all six times) | v0.76.2 (per 2026-06-25 survey) | v0.43.1 (frozen; Renovate targeting v0.92.1 at 2026-07-16) |
| Fro Bot pattern | Single workflow with mode dispatch (`fro-bot.yaml` only — no separate autoheal file) | Two-workflow split (`fro-bot.yaml` + `fro-bot-autoheal.yaml`) | Single workflow, two cron schedules |
| Fro Bot single-issue model | `Daily Maintenance Report` + `Daily Autohealing Report` (two perpetual issues) | Same two-issue model | `Daily Autohealing Report` only |
| dist/ artifact in repo | Yes (tsup bundle, drift-verified in CI) | No (JSON-only repo) | No |
| Self-test in CI | Yes (`uses: ./` with dry-run) | n/a | n/a |
| CodeQL + Scorecard | Yes | Yes | No (relies on Renovate alerts + autoheal) |

The **single-workflow-with-mode-dispatch** Fro Bot layout in this repo is notable: instead of separate `fro-bot.yaml` and `fro-bot-autoheal.yaml` files (the pattern in most Marcus repos), this repo collapses both into one workflow with an inline `Determine mode and prompt` step that selects from three inline prompts (review / maintenance / autoheal). This mirrors the [[marcusrbrown--marcusrbrown-github-io]] "single-file three-mode" evolution noted in the index (`agent v0.44.0, v0.44.1 in flight` — this repo was on `v0.44.2` at the time; `v0.60.0` as of 2026-06-11). The pattern has since consolidated: [[marcusrbrown--systematic]] (#446) and [[marcusrbrown--vbs]] (#594) both collapsed their two-workflow splits into single three-mode files.

## Observations

- **Agent version leadership — confirmed across six surveys.** At first survey (2026-05-20) this repo led the ecosystem on `fro-bot/agent@v0.44.2`; then `v0.60.0` (2026-06-11), `v0.73.0` (2026-06-21), `v0.82.0` (2026-07-03), `v0.93.1` (2026-07-18), and now `v0.98.2` (2026-08-10) — the highest (or effectively tied-highest) pin observed anywhere in the wiki each time. The canary hypothesis holds across all six checkpoints: this repo absorbs agent updates first, almost certainly because its self-Renovate loop (`renovate.yaml` running the action against itself) merges bumps continuously. The lead has *narrowed* — [[fro-bot--dashboard]] and [[marcusrbrown--gpt]] were at v0.97.0 at their 2026-08-08 surveys, so the canary is now roughly one patch ahead of the fleet's front rather than several minors. Still first-in.
- **`zzglobal_config` naming.** The `zz` prefix on the inline base config env var is intentional — it forces the variable to sort last when the GitHub Actions UI alphabetizes env blocks, keeping the (large) JSON payload out of the way visually. Mildly clever; mildly footgun if someone tries to grep for "global_config" expecting one canonical name.
- **Protected-fields enforcement is layered:** `validate_json()` only warns on dangerous fields. The actual enforcement happens in `merge_global_config()`, which restores `allowedCommands` from base after the deep merge. The other "dangerous" fields (`platform`, `gitAuthor`, `gitIgnoredAuthors`, `cacheDir`, `repositoryCache`) are set explicitly in the `env:` block of the Renovate step, so any user-supplied value gets overwritten by `RENOVATE_*` env vars regardless of what made it through the merge. The warning is hygiene; the runtime override is the real guard.
- **Docker execution deprecation — prediction corrected 2026-08-10.** Five surveys (2026-05-20 → 2026-07-18) recorded the standing plan that "**v10 will remove Docker-backed execution**." The v10 major shipped (`10.0.0`, 2026-07-31) and **did not** remove it. `10.0.0`'s sole `⚠ BREAKING CHANGE` is the Renovate engine bump v43 → v44 (#3580); Docker execution, the `v9 deprecation notice` step, the `execution-mode` input (still container-only), and the `::warning::… planned for removal in v10` copy are all still present, verbatim, on a repo that is now itself v10. So the deprecation copy has aged into a contradiction — the named removal horizon (v10) is now the current major. The npm-installed path is quietly being staged: `RENOVATE_BINARY_SOURCE: install` is set on the Renovate step, so the container already runs an npm-installed Renovate binary rather than the image's baked-in one — the plumbing for a Docker-less future exists, but the Docker wrapper itself has not been retired. Re-flag as an autoheal "stale deprecation copy" candidate (the AUTOHEAL_PROMPT's cross-project-drift/progressive-improvement categories are the natural home for it).
- **Analytics features removed in v9 per README, but `docker/entrypoint.sh` still contains `record_docker_metric` / `record_failure` / `/tmp/renovate-analytics` plumbing.** This is dead code from the v8-era analytics dashboard — likely a candidate for an autoheal "stale TODO" finding or a follow-up cleanup PR. Flag this as a possible README-vs-code contradiction to verify before relying on either claim. **Re-confirmed 2026-06-11:** the plumbing is still present at SHA `5b2b2faf` (`mkdir -p /tmp/renovate-analytics`, both helper functions). 22 days and ~23 releases later, nobody — including the daily autoheal — has cleaned it up. **Re-confirmed again 2026-06-21** at SHA `5cacb673`: `mkdir -p /tmp/renovate-analytics` (line 6), `record_docker_metric` (line 9), `record_failure` (line 63), and both functions still wired into the yq/node tool-install paths. A third consecutive survey across ~33 releases with the dead code untouched. **Re-confirmed a fourth time 2026-07-03** at SHA `5ad371e0`: identical line positions (`mkdir` line 6, `record_docker_metric` line 9, `record_failure` line 63), still wired through the yq/node install paths, ~10 more releases (9.123.0 → 9.133.0) with zero change. **Re-confirmed a fifth time 2026-07-18** at SHA `318e0292`: `mkdir -p /tmp/renovate-analytics` (line 6), `record_docker_metric` (line 9), `record_failure` (line 63) all byte-identical, still wired through every tool-install path plus the final `runuser -u ubuntu renovate` run block, ~14 more releases (9.133.0 → 9.147.0) untouched. The contradiction is now durable enough to treat as intentional-but-unaddressed rather than transient — a clean autoheal "stale code" candidate that the autoheal sweep itself keeps classifying as report-only. Note the AUTOHEAL_PROMPT category 5 explicitly asks the agent to "review the analytics collection in action.yaml for any issues (malformed JSON, missing error handling)" — the prompt treats the analytics plumbing as live infrastructure to audit, which likely explains why the sweep never flags it as dead code to remove. **Re-confirmed a sixth time 2026-08-10** at SHA `a4b5a955`: `mkdir -p /tmp/renovate-analytics` (line 6), `record_docker_metric` (line 9), `record_failure` (line 63) all still present and wired through every yq/Node/Bun/pnpm/Yarn install path plus the final `runuser -u ubuntu renovate` block, ~23 more releases (9.147.0 → 10.11.0) and a full major boundary later. Six consecutive surveys spanning ~82 days with the v8-era analytics plumbing untouched — this is now firmly intentional-but-unaddressed, not transient drift.
- **`gitIgnoredAuthors` list** includes `109017866+fro-bot[bot]@users.noreply.github.com` — Fro Bot's commits are explicitly ignored by Renovate so the bot's autoheal commits don't accidentally seed Renovate's "rebased by user" detection logic.
- **`mount-docker-socket: true` + `docker-user: root`** — Renovate's container needs root to install package managers at runtime and the mounted socket to spawn sibling containers when probing Docker-based managers. Sound for self-hosted use; would be unsafe in a multi-tenant runner.
- **CI status-check surface is large** (11 required contexts including `Setup`, `Check`, `Test`, `Build`, `Release`, `Deploy to GitHub Pages`, `Renovate / Renovate`, `Fro Bot`, `Analyze`, `CodeQL`, `Review Dependencies`). The `Setup` job emits all five `should-*` outputs and gates everything else, so most PRs skip most jobs while still satisfying the protection contract.
- **pnpm 10 → 11 major boundary crossed (2026-07-03).** `packageManager` moved from `pnpm@10.34.3` to `pnpm@11.9.0`, matching the same major cut landing across the bfra-me fleet ([[bfra-me--github]] at 11.9.0, [[marcusrbrown--containers]] and [[marcusrbrown--dotfiles]] also on the v11 line). Renovate-driven and merged without incident here — consistent with the canary role. Node also stepped 24.17.0 → 24.18.0 in the same window. By 2026-07-18 pnpm had advanced further along the v11 line to `11.13.0` (matching the `PNPM_VERSION` in `docker/entrypoint.sh`); by 2026-08-10 to `11.20.0`, with Node stepping 24.18.0 → **24.19.0** (repo `engines.node` and container `NODE_VERSION` stay in lockstep).
- **v10 = Renovate v44, not the Docker removal (2026-08-10).** The `10.0.0` release (2026-07-31) crossed the `v9 → v10` major branch/tag with a single breaking change: the vendored Renovate engine moved v43 → **v44** (#3580). `RENOVATE_VERSION` in `action.yaml` is now pinned `44.17.0`. This is the second Renovate-engine-major this action has shipped as its own semver major — the action's major version tracks the Renovate engine major, not its own runtime architecture (the composite/Docker mechanics are unchanged across the boundary). Downstream consumers pinned `@v9` will **not** auto-receive v44; the `renovate.json5` Renovate-ecosystem rule types the `renovate`/`ghcr.io/renovatebot/renovate` major as `feat(deps)!:` and groups it as `Renovate`, so this action's own bump to v44 flowed through the self-Renovate loop as a grouped breaking change.
- **Repo is template-derived.** The GitHub API `template_repository` field confirms this repo was scaffolded from `bfra-me/github-action`, bfra-me's TypeScript GitHub Action template. That explains the TS scaffold (`src/`, `dist/`, tsup, Vitest) present in what is functionally a Bash-composite action — the scaffold is template baggage the composite runtime does not execute, consistent with the "TS layer is not what consumers run" note above.
- **No `marcusrbrown--renovate-config` consumer relationship.** This action does **not** itself extend the Marcus presets. The consumption flow is one-way: Marcus's presets reference `bfra-me/renovate-config`, and Marcus's repos consume **either** preset family; this action is independent infrastructure.

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-05-20 | `bc9c4591` | Initial survey. Fro Bot agent v0.44.2, eight workflows (CI/CD + 5 security/agent), single-workflow three-mode Fro Bot pattern. Renovate v43.186.2 pinned. v9.90.0 latest release. Docker execution flagged for v10 removal. Dead analytics code observed in `docker/entrypoint.sh` despite v9 README claim of "analytics features removed." |
| 2026-06-11 | `5b2b2faf` | Re-survey. Fro Bot agent v0.44.2 → **v0.60.0** (ecosystem leader, canary confirmed). Renovate pin 43.186.2 → **43.220.0**. Release 9.90.0 → **9.113.0** (23 minors / 22 days). Internal preset v4.16.18 → v4.16.25. Node 24.16.0, pnpm 10.34.1, ESLint 10.4.1, Vitest 4.1.8. Workflow set unchanged (8). `workflow_dispatch` now defaults mode to `autoheal`. Branch protection contexts unchanged (11). Dead analytics code in `docker/entrypoint.sh` still present. v10 Docker-removal plan unchanged, no replacement implementation yet. Fro Bot workflow present and active — no onboarding follow-up needed. |
| 2026-06-21 | `5cacb673` | Re-survey. Fro Bot agent v0.60.0 → **v0.73.0** (still ecosystem leader; canary confirmed a third time). Renovate pin 43.220.0 → **43.233.3**. Release 9.113.0 → **9.123.0** (10 minors / 9 days). Internal preset v4.16.25 → v4.16.27. Node 24.16.0 → 24.17.0, pnpm 10.34.1 → 10.34.3, ESLint 10.4.1 → 10.5.0, Prettier 3.8.3 → 3.8.4, Vitest 4.1.8 → 4.1.9, semantic-release 25.0.3 → 25.0.5, js-yaml 4.1.1 → 4.2.0. `@bfra.me/eslint-config@0.51.1`. Stars 2 → 3, open issues 62 → 61. Workflow set unchanged (8). `renovatebot/github-action` still v46.1.4, `create-github-app-token` still v3.2.0, `actions/cache/restore` still v5.0.5. fro-bot.yaml structure unchanged (single-workflow three-mode, crons 03:30 + 15:30 UTC, `workflow_dispatch` default `autoheal`). Dead analytics code in `docker/entrypoint.sh` re-confirmed present (third consecutive survey). v10 Docker-removal plan unchanged, no replacement implementation. Fro Bot workflow present and active — no onboarding follow-up needed. |
| 2026-07-03 | `5ad371e0` | Re-survey. Fro Bot agent v0.73.0 → **v0.82.0** (ecosystem leader a fourth time; canary confirmed, though lead narrowed vs `bfra-me/.github` v0.81.0). Renovate pin 43.233.3 → **43.251.0**. Release 9.123.0 → **9.133.0** (10 minors / 12 days). Internal preset v4.16.27 → **v4.16.33**. **pnpm 10.34.3 → 11.9.0 (major 10 → 11 boundary crossed)**, Node 24.17.0 → 24.18.0, ESLint 10.5.0 → 10.6.0, Prettier 3.8.4 → 3.9.4, js-yaml 4.2.0 → 4.3.0, lint-staged pinned 16.4.0. Vitest 4.1.9, TypeScript 6.0.3, semantic-release 25.0.5, `@bfra.me/eslint-config@0.51.1` all steady. Watchers 1 → 3, stars steady 3, open issues 61 → **66** (trending up). Workflow set unchanged (8). `renovatebot/github-action` still v46.1.4, `create-github-app-token` still v3.2.0; `actions/cache/restore` v5.0.5 → **v5.1.0**. fro-bot.yaml structure unchanged (single-workflow three-mode, crons 03:30 + 15:30 UTC, `workflow_dispatch` default `autoheal`, `pnpm/action-setup@v5.0.0`, `actions/setup-node@v6.4.0`). Branch protection contexts unchanged (11). Dead analytics code in `docker/entrypoint.sh` re-confirmed present (**fourth** consecutive survey). v10 Docker-removal plan unchanged, no replacement implementation. Fro Bot workflow present and active — no onboarding follow-up needed. |
| 2026-08-10 | `a4b5a955` | Re-survey (unauthenticated `api.github.com` / `raw.githubusercontent.com` — no `gh` token). **v9 → v10 major boundary crossed** (`10.0.0`, 2026-07-31) — but it is a **Renovate engine major (v43 → v44), not the long-predicted Docker-execution removal.** Docker execution, the `v9 deprecation notice` step, and the `::warning::… removal in v10` copy all persist verbatim on a now-v10 repo — the deprecation copy is stale/self-contradictory (prediction corrected). Latest release 9.147.0 → **10.11.0** (~23 releases / 22 days). Fro Bot agent v0.93.1 → **v0.98.2** (SHA `994357c3`, #3624; ecosystem leader a sixth time, lead narrowed to ~1 patch over dashboard/gpt @ v0.97.0). `RENOVATE_VERSION` 43.269.1 → **44.17.0**. Internal preset v4.16.37 → **v4.16.45**. `renovatebot/github-action` v46.1.4 → **v46.2.0**; `create-github-app-token` still v3.2.0; `actions/cache` restore+save v5.1.0. **`allowedCommands` allowlist expanded to multi-ecosystem** (Node + Python/Rust/Go/Ruby package-manager + formatter regexes). New Renovate-step env vars: `RENOVATE_BINARY_SOURCE: install`, `RENOVATE_BRANCH_PREFIX_OLD`, `RENOVATE_USE_BASE_BRANCH_CONFIG`, `RENOVATE_PRESET_CACHE_PERSISTENCE`, `RENOVATE_DEPENDENCY_DASHBOARD_FOOTER`. Tooling: pnpm 11.13.0 → **11.20.0**, Node 24.18.0 → **24.19.0**, ESLint 10.7.0 → **10.8.0**, Prettier 3.9.5 → **3.9.6**, semantic-release 25.0.7 → **25.0.9**, js-yaml 4.3.0 → 4.3.1, `@types/node` 24.13.2 → 24.13.3, `@vitest/eslint-plugin` 1.6.23 → 1.6.26; TypeScript 6.0.3, tsup 8.5.1, Vitest 4.1.10, lint-staged 16.4.0 steady; `@bfra.me/tsconfig@0.13.1` + explicit `eslint-config-prettier`/`eslint-plugin-prettier` pins now visible. Container tool pins: yq v4.53.3 (steady), Node 24.19.0, Bun 1.3.14, pnpm 11.20.0, Yarn 4.18.0. `renovate.json5` `build`-type routing added `bun`/`pnpm`. **New fro-bot.yaml guard:** `Validate review mode inputs` hard-fails a `mode=review` dispatch without a `prompt`; `actions/checkout` v6.0.3 → **v6.1.0**, setup-node v6.5.0 + pnpm/action-setup v5.0.0 steady, single-workflow three-mode + crons 03:30/15:30 unchanged. Stars/forks/watchers steady 3/1/3, open issues 64 → **65**. Workflow set unchanged (8). Dead analytics code in `docker/entrypoint.sh` re-confirmed present (**sixth** consecutive survey). Fro Bot workflow present and active — no onboarding follow-up needed. |
| 2026-07-18 | `318e0292` | Re-survey (via unauthenticated `api.github.com` / `raw.githubusercontent.com` — no `gh` token this cycle). Fro Bot agent v0.82.0 → **v0.93.1** (SHA `a4976f45`; ecosystem leader a fifth time, canary confirmed). Renovate pin 43.251.0 → **43.269.1**. Release 9.133.0 → **9.147.0** (14 minors / 15 days). Internal preset v4.16.33 → **v4.16.37**. pnpm 11.9.0 → **11.13.0**, ESLint 10.6.0 → **10.7.0**, Prettier 3.9.4 → **3.9.5**, Vitest 4.1.9 → **4.1.10**, semantic-release 25.0.5 → **25.0.7**, `@types/node@24.13.2`. Node 24.18.0, TypeScript 6.0.3, js-yaml 4.3.0, lint-staged 16.4.0, `@bfra.me/eslint-config@0.51.1`, tsup 8.5.1 all steady. Stars/forks/watchers steady 3/1/3, open issues 66 → **64** (oscillating low-60s). Workflow set unchanged (8). `renovatebot/github-action` still v46.1.4, `create-github-app-token` still v3.2.0, `actions/cache` restore+save v5.1.0. fro-bot.yaml structure unchanged (single-workflow three-mode, crons 03:30 + 15:30 UTC, `workflow_dispatch` default `autoheal`); its `actions/checkout` bumped to **v6.0.3** (`df4cb1c`), `actions/setup-node` to **v6.5.0** (`24997072`), `pnpm/action-setup@v5.0.0` steady. **New finding:** `renovate.json5` adds `ignorePresets` (merge-confidence badges) and routes `docker`/`tsup`/`typescript`/`lockFileMaintenance` updates to the `build` commit type. Docker entrypoint tool pins: yq v4.53.3, Bun bun-v1.3.6, Yarn 4.17.1, pnpm 11.13.0. **API `template_repository` confirms scaffolded from `bfra-me/github-action`.** Dead analytics code in `docker/entrypoint.sh` re-confirmed present (**fifth** consecutive survey; AUTOHEAL_PROMPT still treats it as live infra to audit). v10 Docker-removal plan unchanged, no replacement implementation. Fro Bot workflow present and active — no onboarding follow-up needed. |
