---
type: repo
title: bfra-me/renovate-action
created: 2026-05-20
updated: 2026-06-11
sources:
  - url: https://github.com/bfra-me/renovate-action
    sha: bc9c45917d3f7b33962d3ba44b11d58d9f6c2647
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/renovate-action
    sha: 5b2b2faff7e3e9725fdfe87d5e1802f6f5cb831c
    accessed: 2026-06-11
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

Composite GitHub Action that runs a **self-hosted Renovate bot** in a Docker container with **GitHub App** authentication. Published as `bfra-me/renovate-action@v9` and consumed across the `bfra-me` organization (and indirectly by `marcusrbrown/*` / `fro-bot/*` via the reusable `bfra-me/.github/.github/workflows/renovate.yaml` that wraps it).

This is the **execution surface** for the bfra-me dependency-update policy that [[marcusrbrown--renovate-config]] defines as preset content. Where `marcusrbrown/renovate-config` answers "what should Renovate do," this repo answers "how does Renovate actually run."

## Identity

- **Owner:** `bfra-me` (org)
- **Visibility:** public
- **License:** MIT
- **Author:** Marcus R. Brown <git@mrbro.dev>
- **Default branch:** `main` (release branch: `release`; major-version branch: `v9`)
- **Primary language:** Shell (action logic) + TypeScript (scaffold + tooling)
- **Topics:** `composite`, `github-action`, `github-actions`, `renovate`, `nodejs`, `typescript`, `action`, `self-hosted`
- **Created:** 2023-09-22
- **Last push:** 2026-06-11 (was 2026-05-20 at first survey)
- **Latest release:** `9.113.0` (2026-06-11; was `9.90.0` on 2026-05-20 — 23 minor releases in 22 days, consistent with Renovate self-bumps flowing through semantic-release)
- **Stars / Forks / Watchers:** 2 / 1 / 1
- **Open issues:** 62 (was 60; consistent with a long-lived autoheal / Renovate dependency dashboard)

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
   - Pins `RENOVATE_VERSION` (Renovate v43) with a `# renovate: datasource=docker depName=renovate packageName=ghcr.io/renovatebot/renovate versioning=semver` comment so Renovate self-bumps it. Pinned at `43.186.2` on 2026-05-20; `43.220.0` on 2026-06-11.
   - Builds the `renovate_git_author` identity from the GitHub App slug.
   - Defines `validate_json()` and `merge_global_config()` Bash functions that deep-merge the action's base config (`zzglobal_config` inline JSON) with the user-supplied `global-config` input.
   - **Security boundary:** `allowedCommands`, `platform`, `gitAuthor`, `gitIgnoredAuthors`, `cacheDir`, `repositoryCache` are protected. `allowedCommands` is restored from base after merge; the others emit warnings if the user tries to set them. Falls back to base config on any validation failure.
3. **`v9 deprecation notice`** — emits a `::warning::` that Docker execution is planned for removal in v10.
4. **`Restore Renovate Cache`** (conditional on `cache: true`) — `actions/cache/restore@v5.0.5` keyed on `renovate-cache-v<major>`.
5. **`Prepare Renovate Cache`** — `chown -R runneradmin:root /tmp/renovate` so the container user can write the cache.
6. **`Renovate <version>`** — `renovatebot/github-action@v46.1.4` runs the Renovate Docker image (`ghcr.io/renovatebot/renovate:<RENOVATE_VERSION>`) with `docker-user: root`, `mount-docker-socket: true`, custom `docker-cmd-file` at `docker/entrypoint.sh`. The action passes through a strict `env-regex` whitelist (CI vars, GitHub vars except PATH/ENV, proxy vars, log level, NODE_OPTIONS, `RENOVATE_*`, `RUNNER_*`).
7. **`Finalize Renovate Cache`** + **`Save Renovate cache`** — deletes the prior cache entry via `gh api -X DELETE` and saves the new one (always-runs on success or failure when cache enabled).

### Docker Entrypoint (`docker/entrypoint.sh`)

`bash -Eeuo pipefail`. Inside the container it:
- Initializes `/tmp/renovate-analytics`.
- Defines `record_docker_metric()` and `record_failure()` helpers that emit JSON metric files via inline Node.js (`fs.writeFileSync`).
- Installs runtime tools (yq, Node, Bun, pnpm, Yarn) that Renovate's package managers may invoke.
- Runs Renovate as the `ubuntu` user (the cache-prepare `chown` aligns ownership for read/write).

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

- **Agent version:** `fro-bot/agent@v0.60.0` (SHA `f2f3c08f3933822e1a4284fbba952684db1ceb70`) as of 2026-06-11; was `v0.44.2` (SHA `b97877b2`) at the 2026-05-20 survey — a 16-minor jump in 22 days, keeping this repo at or near the ecosystem's bleeding edge.
- **Triggers:** `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request` (opened/synchronize/reopened/ready_for_review/review_requested), `schedule` (`30 3 * * *` autoheal + `30 15 * * *` maintenance — daily 03:30 and 15:30 UTC), `workflow_dispatch` with `mode` choice (review/maintenance/autoheal, default `autoheal`) + `prompt` input, and `workflow_call` with required `prompt` input.
- **Bot-loop guards:** Identical pattern to the rest of the ecosystem — skip when issue/PR/comment author ends in `[bot]` or equals `fro-bot`. Comment triggers require `OWNER`/`MEMBER`/`COLLABORATOR` association and `@fro-bot` mention.
- **Mode resolution:** Inline Bash in the `Determine mode and prompt` step maps event type → mode (schedule cron containing `15` → maintenance, otherwise → autoheal; `pull_request` → review; `workflow_dispatch` with no explicit mode input → **autoheal**). Mode controls which inline `env`-block prompt is used. Note the dispatch default changed: the 2026-05-20 survey recorded `workflow_dispatch` as user-selected only; the current workflow falls back to `autoheal` when the mode input is empty.
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
- `github>bfra-me/.github:internal.json5#v4.16.25` (was `#v4.16.18` on 2026-05-20) — bfra-me org's internal Renovate preset
- `github>sanity-io/renovate-config:semantic-commit-type` — semantic commit type mapping

Notable rules:
- Pin `bfra-me/renovate-config` (`rangeStrategy: 'pin'`, `updatePinnedDependencies: false`) **except** for major updates (where pin updates are allowed).
- Renovate/Docker package updates (`ghcr.io/renovatebot/renovate`, `renovate`, `renovatebot/github-action`, `renovatebot/renovate`):
  - Major → `feat(deps)!:` (breaking)
  - Minor → `feat`
  - Patch → **disabled** (avoid noise)
  - Scheduled to nights/weekends only.
- All majors of the Renovate ecosystem grouped as `Renovate`.
- Custom regex manager updates `https://github.com/renovatebot/renovate/releases/tag/<ver>` links in `README.md`.
- Astro 0.x packages automerge minor/patch.
- `postUpgradeTasks`: `pnpm run bootstrap && pnpm run build && pnpm run fix` (execution-mode: branch).
- `platformAutomerge: true`, `rebaseWhen: 'behind-base-branch'`.

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

| Tool | Version (2026-06-11; 2026-05-20 in parens where changed) |
| --- | --- |
| Node.js | 24.16.0 (was 24.15.0) (`engines.node` in package.json) |
| pnpm | 10.34.1 (was 10.33.4) |
| TypeScript | 6.0.3 |
| ESLint | 10.4.1 (was 10.4.0), extends `@bfra.me/eslint-config` |
| Prettier | 3.8.3, extends `@bfra.me/prettier-config/120-proof` |
| tsup | 8.5.1 (bundler, ESM output, license-aware via `esbuild-plugin-license@1.2.3`) |
| Vitest | 4.1.8 (was 4.1.6) |
| `@actions/core` | 3.0.1 (only runtime dep) |
| semantic-release | 25.0.3 with `@semantic-release/changelog`, `@semantic-release/git`, `semantic-release-export-data`, `conventional-changelog-conventionalcommits@9.3.1` |
| simple-git-hooks + lint-staged | pre-commit runs `pnpm run fix` on TS/JS/CSS/MD/JSON/YAML |
| jiti | 2.7.0 (TS config loading) |
| js-yaml | 4.1.1 |

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
| Branching | `main` → `release` → tagged + `v9` branch | `main` → tagged + `v4` branch | `main` only |
| Renovate base preset | `bfra-me/.github:internal.json5#v4.16.18` | `bfra-me/renovate-config#5.2.1` | `bfra-me/renovate-config#5.2.1` |
| Fro Bot agent | v0.60.0 as of 2026-06-11 (v0.44.2 at first survey — newest in ecosystem both times) | v0.42.2 (v0.52.1 per 2026-06-04 survey) | v0.43.1 |
| Fro Bot pattern | Single workflow with mode dispatch (`fro-bot.yaml` only — no separate autoheal file) | Two-workflow split (`fro-bot.yaml` + `fro-bot-autoheal.yaml`) | Single workflow, two cron schedules |
| Fro Bot single-issue model | `Daily Maintenance Report` + `Daily Autohealing Report` (two perpetual issues) | Same two-issue model | `Daily Autohealing Report` only |
| dist/ artifact in repo | Yes (tsup bundle, drift-verified in CI) | No (JSON-only repo) | No |
| Self-test in CI | Yes (`uses: ./` with dry-run) | n/a | n/a |
| CodeQL + Scorecard | Yes | Yes | No (relies on Renovate alerts + autoheal) |

The **single-workflow-with-mode-dispatch** Fro Bot layout in this repo is notable: instead of separate `fro-bot.yaml` and `fro-bot-autoheal.yaml` files (the pattern in most Marcus repos), this repo collapses both into one workflow with an inline `Determine mode and prompt` step that selects from three inline prompts (review / maintenance / autoheal). This mirrors the [[marcusrbrown--marcusrbrown-github-io]] "single-file three-mode" evolution noted in the index (`agent v0.44.0, v0.44.1 in flight` — this repo was on `v0.44.2` at the time; `v0.60.0` as of 2026-06-11). The pattern has since consolidated: [[marcusrbrown--systematic]] (#446) and [[marcusrbrown--vbs]] (#594) both collapsed their two-workflow splits into single three-mode files.

## Observations

- **Agent version leadership — confirmed across surveys.** At first survey (2026-05-20) this repo led the ecosystem on `fro-bot/agent@v0.44.2`; at re-survey (2026-06-11) it leads again at `v0.60.0`, the highest pin observed anywhere in the wiki (next closest: [[marcusrbrown--tokentoilet]] at v0.59.0). The canary hypothesis holds: this repo absorbs agent updates first, almost certainly because its self-Renovate loop (`renovate.yaml` running the action against itself) merges bumps continuously.
- **`zzglobal_config` naming.** The `zz` prefix on the inline base config env var is intentional — it forces the variable to sort last when the GitHub Actions UI alphabetizes env blocks, keeping the (large) JSON payload out of the way visually. Mildly clever; mildly footgun if someone tries to grep for "global_config" expecting one canonical name.
- **Protected-fields enforcement is layered:** `validate_json()` only warns on dangerous fields. The actual enforcement happens in `merge_global_config()`, which restores `allowedCommands` from base after the deep merge. The other "dangerous" fields (`platform`, `gitAuthor`, `gitIgnoredAuthors`, `cacheDir`, `repositoryCache`) are set explicitly in the `env:` block of the Renovate step, so any user-supplied value gets overwritten by `RENOVATE_*` env vars regardless of what made it through the merge. The warning is hygiene; the runtime override is the real guard.
- **Docker execution deprecation.** The action ships a `v9 deprecation notice` and an `execution-mode` input that currently only accepts `container`. The plan signaled by README and `action.yaml`: v10 will remove Docker-backed execution. No replacement implementation is present in this branch yet — consumers should expect a non-trivial migration (likely to direct npm-installed Renovate, matching the upstream `renovatebot/github-action` `BINARY_SOURCE=install` env var already set).
- **Analytics features removed in v9 per README, but `docker/entrypoint.sh` still contains `record_docker_metric` / `record_failure` / `/tmp/renovate-analytics` plumbing.** This is dead code from the v8-era analytics dashboard — likely a candidate for an autoheal "stale TODO" finding or a follow-up cleanup PR. Flag this as a possible README-vs-code contradiction to verify before relying on either claim. **Re-confirmed 2026-06-11:** the plumbing is still present at SHA `5b2b2faf` (`mkdir -p /tmp/renovate-analytics`, both helper functions). 22 days and ~23 releases later, nobody — including the daily autoheal — has cleaned it up. The contradiction stands.
- **`gitIgnoredAuthors` list** includes `109017866+fro-bot[bot]@users.noreply.github.com` — Fro Bot's commits are explicitly ignored by Renovate so the bot's autoheal commits don't accidentally seed Renovate's "rebased by user" detection logic.
- **`mount-docker-socket: true` + `docker-user: root`** — Renovate's container needs root to install package managers at runtime and the mounted socket to spawn sibling containers when probing Docker-based managers. Sound for self-hosted use; would be unsafe in a multi-tenant runner.
- **CI status-check surface is large** (11 required contexts including `Setup`, `Check`, `Test`, `Build`, `Release`, `Deploy to GitHub Pages`, `Renovate / Renovate`, `Fro Bot`, `Analyze`, `CodeQL`, `Review Dependencies`). The `Setup` job emits all five `should-*` outputs and gates everything else, so most PRs skip most jobs while still satisfying the protection contract.
- **No `marcusrbrown--renovate-config` consumer relationship.** This action does **not** itself extend the Marcus presets. The consumption flow is one-way: Marcus's presets reference `bfra-me/renovate-config`, and Marcus's repos consume **either** preset family; this action is independent infrastructure.

## Survey History

| Date | SHA | Notes |
| --- | --- | --- |
| 2026-05-20 | `bc9c4591` | Initial survey. Fro Bot agent v0.44.2, eight workflows (CI/CD + 5 security/agent), single-workflow three-mode Fro Bot pattern. Renovate v43.186.2 pinned. v9.90.0 latest release. Docker execution flagged for v10 removal. Dead analytics code observed in `docker/entrypoint.sh` despite v9 README claim of "analytics features removed." |
| 2026-06-11 | `5b2b2faf` | Re-survey. Fro Bot agent v0.44.2 → **v0.60.0** (ecosystem leader, canary confirmed). Renovate pin 43.186.2 → **43.220.0**. Release 9.90.0 → **9.113.0** (23 minors / 22 days). Internal preset v4.16.18 → v4.16.25. Node 24.16.0, pnpm 10.34.1, ESLint 10.4.1, Vitest 4.1.8. Workflow set unchanged (8). `workflow_dispatch` now defaults mode to `autoheal`. Branch protection contexts unchanged (11). Dead analytics code in `docker/entrypoint.sh` still present. v10 Docker-removal plan unchanged, no replacement implementation yet. Fro Bot workflow present and active — no onboarding follow-up needed. |
