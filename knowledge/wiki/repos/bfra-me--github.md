---
type: repo
title: bfra-me/.github
created: 2026-05-20
updated: 2026-05-30
sources:
  - url: https://github.com/bfra-me/.github
    sha: a81be4c5d5c93824fdcc426418c9433d5e5bd9be
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/.github
    sha: 510bcb1cb8707601ed7387a3fe16a91790111270
    accessed: 2026-05-30
tags: [bfra-me, dotgithub, monorepo, pnpm, typescript, github-actions, probot, renovate, template]
related:
  - bfra-me--ha-addon-repository
  - marcusrbrown--github
  - marcusrbrown--renovate-config
  - fro-bot--agent
  - github-actions-ci
  - probot-settings
---

# bfra-me/.github

Org control center for the `bfra-me` GitHub organization. This is the
canonical home of the org's reusable workflows, custom GitHub Actions,
workflow templates, shared Probot settings, and Fro Bot org-wide autoheal
runtime. Marketed as a template (`is_template: true`) but in practice it
runs as a full TypeScript pnpm monorepo.

It is the bfra-me-side counterpart to [[marcusrbrown--github]] (Marcus's
personal `.github`). Where `marcusrbrown/.github` only ships Probot
settings and Prettier defaults, this repo also _executes_ org-wide
automation (Renovate dispatch, settings sync, Fro Bot org autoheal,
license/secret/container scanning).

## Identity

- **Owner:** bfra-me (org)
- **Visibility:** public, template repository
- **License:** MIT
- **Default branch:** `main`
- **Created:** 2022-03-17
- **Last push:** 2026-05-30 (was 2026-05-20)
- **Package version:** `@bfra.me/.github` v4.16.21 (was v4.16.18 on 2026-05-20)
- **Node:** 24.16.0 (`.node-version`; bumped from 24.15.0 via #2207)
- **Package manager:** pnpm 10.33.4
- **TypeScript:** 6.0.3, strict
- **Open issues / PRs:** 6 / — (2026-05-30; was 5 / 1 on 2026-05-20)

## Layout

```
.
├── .github/
│   ├── actions/
│   │   ├── renovate-changesets/         # Complex action: auto-changeset Renovate PRs (~125 src files)
│   │   ├── update-metadata/             # Repo metadata generator
│   │   └── update-repository-settings/  # Plugin-based settings sync
│   ├── instructions/                    # AI-consumed dev guides (changesets, GH Actions, pnpm, Renovate, TS)
│   ├── workflows/                       # 17 workflows: CI, Fro Bot, security, Copilot, renovate
│   ├── codeql/
│   ├── copilot-instructions.md
│   ├── gitleaks.toml
│   ├── labeler.yaml
│   ├── renovate.json5
│   └── settings.yml
├── .changeset/                          # Manually-authored changesets (renovate auto-creates per dep update)
├── workflow-templates/                  # Org-wide templates (.yaml + .properties.json pairs)
├── scripts/                             # tsx utilities: release, build perf, workspace validation
├── docs/
│   ├── workflows/                       # Workflow docs and troubleshooting
│   └── solutions/                       # Compound-engineering learnings
├── metadata/
│   └── renovate.yaml                    # Org-wide Renovate config consumed by other repos
├── profile/                             # GitHub org profile README
├── common-settings.yaml                 # Org-wide Probot Settings template
├── AGENTS.md                            # Repo conventions (consumed by Fro Bot and Copilot)
├── eslint.config.ts
├── internal.json5                       # Renovate internal config extended by .github/renovate.json5
├── mise.toml                            # Adds ./node_modules/.bin to PATH
├── package.json                         # `@bfra.me/.github` v4.16.21
├── pnpm-workspace.yaml
├── tsconfig.json / tsconfig.build.json / tsconfig.eslint.json
└── vitest.config.ts
```

## Workspace

- 4 packages: root (`@bfra.me/.github`) + 3 actions under `.github/actions/*`
- Root is itself a workspace member (`packages: ['.', '.github/actions/*']`)
  with `ignoreWorkspaceRootCheck: true` — uncommon but intentional
- `shamefullyHoist: true`, `autoInstallPeers: true`, `savePrefix: ''`
- Overrides: `flatted@3.4.2` pinned; `undici@<6.23.0` forced to `>=6.23.0`;
  `vite@>=8.0.0 <=8.0.4` forced to `>=8.0.5`
- `onlyBuiltDependencies`: `esbuild`, `unrs-resolver`
- No inter-package deps; actions are self-contained, root provides shared
  dev tooling
- Parallel builds: `pnpm -r run build` with no dependency ordering needed

## Custom Actions

| Action                          | Purpose                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `renovate-changesets`           | Auto-generates `.changeset/*.md` files for Renovate PRs                                 |
| `update-metadata`               | Generates/updates per-repo metadata (badges, scorecards, etc.)                          |
| `update-repository-settings`    | Plugin-based action that syncs `.github/settings.yml` to the GitHub API                 |

All actions:

- Use Node.js 24 runtime (`using: node24` in `action.yaml`)
- Ship pre-built `dist/` in the repo (GitHub requires committed JS)
- Standardized on `action.yaml` (never `action.yml`)
- Have their own AGENTS.md for action-local conventions

## Workflows (17)

```
auto-release.yaml          codeql-analysis.yaml         container-scan.yaml
copilot-setup-steps.yaml   dependency-review.yaml       fro-bot-autoheal-org.yaml
fro-bot.yaml               license-compliance.yaml      main.yaml
pr-triage.yaml             renovate-changeset.yaml      renovate.yaml
scorecard.yaml             secret-scan.yaml             trigger-org-renovate.yaml
update-metadata.yaml       update-repo-settings.yaml
```

Notable surface area:

- **`main.yaml`** — primary CI entry point (Quality Check job referenced by branch protection)
- **`fro-bot.yaml`** — full Fro Bot persona: PR review, mention handling, daily maintenance (`0 5 * * *`), daily autoheal (`30 15 * * *`), `workflow_dispatch` with `mode` choice (review/maintenance/autoheal), `workflow_call` for reusable invocation
- **`fro-bot-autoheal-org.yaml`** — org-wide autoheal sweep across **all non-archived** `bfra-me` repos, weekdays at `0 5 * * 1-5`. Processes repos serially, deduplicates against existing bot-authored issues/PRs, defers dependency bumps to Renovate, and only applies minimal reversible fixes
- **`renovate.yaml`** — drives self-hosted Renovate via `@bfra-me/renovate-action`
- **`trigger-org-renovate.yaml`** — fans Renovate runs out to other org repos
- **`update-repo-settings.yaml`** — applies `.github/settings.yml` (and downstream `common-settings.yaml`) via `update-repository-settings` action
- **`update-metadata.yaml`** — invokes local `update-metadata` action without the self-checkout pattern (action only runs in this repo)
- **`codeql-analysis.yaml`, `scorecard.yaml`, `container-scan.yaml`, `secret-scan.yaml`, `license-compliance.yaml`, `dependency-review.yaml`** — security posture
- **`copilot-setup-steps.yaml`** — Copilot coding agent bootstrap
- **`pr-triage.yaml`** — labeler-driven PR triage

## Fro Bot Integration

This repo **is** a Fro Bot workflow host, and it also _runs_ the org-wide
autoheal sweep. As of HEAD it pins:

- `fro-bot/agent@9a2d4b08196d3d5ad70692b655311e18ed6b2726 # v0.46.1`
  (bumped via Renovate, PR #2225 on 2026-05-30; previously v0.44.2 PR #2200,
  v0.44.3 #2201, v0.45.0 #2216, v0.46.0 #2223)

### `fro-bot.yaml` (per-repo)

- Triggers: `issue_comment`, `pull_request_review_comment`,
  `discussion_comment`, `issues` (opened/edited), `pull_request` (opened,
  synchronize, reopened, ready_for_review, review_requested), two crons,
  `workflow_dispatch` with `mode` input, `workflow_call`
- Concurrency keyed off issue/PR/discussion/schedule/run_id; never
  cancels in progress (autoheal runs must finish cleanly)
- `PR_REVIEW_PROMPT` is security-focused for an org control center —
  enforces SHA-pinned actions with version comments, blocks workflow
  injection via untrusted input in `run:` blocks, requires `dist/`
  rebuild for action source changes, enforces manually-authored
  changesets (`pnpm changeset` CLI explicitly banned), and TypeScript
  strictness (no `any`, no `@ts-ignore`, ESM only)

### `fro-bot-autoheal-org.yaml` (org-wide)

- Schedule: weekdays at `0 5 * * 1-5`; `workflow_dispatch` accepts an
  optional `target-repo` to narrow the sweep
- Execution model: process repos serially, never keep multiple repos
  checked out simultaneously, return to a clean working tree between
  repos
- Dedup rule: search for an existing open bot-authored item per root
  cause before opening anything new
- Scope cap: minimal and reversible only — broad refactors get logged
  under "Needs Human Attention" rather than executed
- Dependency ownership: Renovate owns routine version bumps; Fro Bot may
  change versions **only** to remediate confirmed high/critical
  advisories

## Probot Settings

- `.github/settings.yml` extends `.github:common-settings.yaml`
  (self-extending — pulls from the same repo)
- `common-settings.yaml` is the **org-wide template** consumed by other
  `bfra-me` repos and by Marcus's repos via `_extends:
  fro-bot/.github:common-settings.yaml` (note: across the wiki, repos
  reference `fro-bot/.github:common-settings.yaml`, but the bfra-me
  control-plane file lives at `bfra-me/.github:common-settings.yaml` —
  these are organizationally distinct settings sources)
- Repo-level overrides: `is_template: true`, `has_projects: false`,
  `has_wiki: false`, `allow_merge_commit: false`, `allow_rebase_merge:
  false`, `allow_auto_merge: true`, `delete_branch_on_merge: true`,
  `allow_update_branch: true`, squash commit title
  `COMMIT_OR_PR_TITLE`, message `COMMIT_MESSAGES`
- Branch protection (`main`): strict status checks with 12 required
  contexts (Advanced Security Analysis, CodeQL, Container Scan, Create
  Renovate Changeset, Fro Bot, GitGuardian Scan, License Scan, Quality
  Check, Release, Renovate, Review Dependencies, Triage), admin
  enforcement enabled, linear history required, `required_approving_review_count: 0`
  (governance leans on status checks, not human reviewers)

## Renovate

- `.github/renovate.json5` extends `local>bfra-me/.github:internal.json5`
- `automergeType: pr`
- Package rules: `aquasecurity/trivy-action` uses `github-releases`
  versioning; `elstudio/actions-settings` disabled (the settings action
  is consumed via the local custom action); `mise` manager disabled
  (workaround for missing `tools` key)
- Post-upgrade tasks: `pnpm run bootstrap && pnpm run build && pnpm run
  fix`, executionMode `branch`
- `metadata/renovate.yaml` is the **org-wide** Renovate config inherited
  by other `bfra-me` repos

## Conventions (from AGENTS.md)

- Actions pinned to commit SHA with version comment — never floating
  tags
- Changesets authored **manually** in `.changeset/*.md`; the `pnpm
  changeset` CLI is explicitly banned (creates inconsistent format)
- Changesets scoped to closest package — only target
  `@bfra.me/.github` for root-level changes
- ESM only (`type: module`, no `require()`)
- Shared configs: `@bfra.me/eslint-config`, `@bfra.me/prettier-config`,
  `@bfra.me/tsconfig`
- GitHub App auth: `bfra-me[bot]` via `actions/create-github-app-token`
- 120-char line limit (`.editorconfig`), 2-space indent
- Vitest exclusively; coverage thresholds 80% statements/functions/lines,
  75% branches
- Workspace scripts: `#!/usr/bin/env tsx`, function-based, typed
  interfaces
- Reusable workflows that call internal actions use `GITHUB_WORKFLOW_REF`
  (not `github.workflow_sha`) for cross-repo checkout — `workflow_sha`
  resolves to the caller's SHA in `workflow_call`

## Anti-Patterns (Documented)

- `pnpm changeset` CLI
- Floating action versions
- Hardcoded secrets
- Workflow templates without `.properties.json`
- `contexts` in branch protection (use `checks`)
- Cancelling Renovate jobs that push to main
- `@ts-ignore` / `as any`
- `github.workflow_sha` for cross-repo checkout in `workflow_call`

## Build, Test, Release

```bash
pnpm bootstrap                  # Install (prefer-offline)
pnpm run quality-check          # type-check + lint + build + test
pnpm build                      # All workspace packages, parallel
pnpm test                       # Vitest
pnpm run lint / pnpm run fix    # ESLint (auto-fix variant)
pnpm run type-check             # tsc --noEmit
pnpm run release                # Multi-package release with tag mgmt
pnpm run workspace:validate     # Dep analysis + consistency check
pnpm run build:monitor          # Build performance analysis
```

Release tagging: the monorepo root is private and tagged as `v{ver}`,
but `scripts/release.ts` also logs `{name}@{ver}` so the Changesets
action can detect it as a published package.

## Cross-Repo Relationships

- **[[marcusrbrown--github]]** — Marcus's personal `.github`; its
  reusable workflow pins to `bfra-me/.github` (e.g. `v4.16.8` /
  `v4.16.9` in recent logs). Most `marcusrbrown/*` repos extend
  `fro-bot/.github:common-settings.yaml` rather than this one,
  but they consume `bfra-me/.github` reusable workflows.
- **[[bfra-me--ha-addon-repository]]** — sibling org template; pulls
  reusable workflows and Probot settings from here.
- **[[fro-bot--agent]]** — this repo pins `fro-bot/agent@v0.44.2`,
  ahead of most other ecosystem repos (commonly `v0.41.x`–`v0.43.x`).
- **[[marcusrbrown--renovate-config]]** — Marcus's preset is the
  Renovate baseline for `marcusrbrown/*` repos; `bfra-me/.github` ships
  its own `metadata/renovate.yaml` for `bfra-me/*` repos.

## Open Questions / Follow-Ups

- The Probot settings landscape now has **three** common-settings
  sources visible in this wiki: `marcusrbrown/.github:common-settings.yaml`
  (Marcus's personal template), `fro-bot/.github:common-settings.yaml`
  (Fro Bot org template), and `bfra-me/.github:common-settings.yaml`
  (this repo, org template for `@bfra-me`). The
  [[probot-settings]] topic currently documents only the first two.
  A follow-up survey should map which repos extend which and reconcile
  the relationship between `bfra-me` and `fro-bot` org settings.

## Survey History

| Date       | SHA        | Notes                                                                      |
| ---------- | ---------- | -------------------------------------------------------------------------- |
| 2026-05-20 | `a81be4c`  | Initial survey. `fro-bot/agent@v0.44.2` (PR #2200). 17 workflows, 3 custom actions. |
| 2026-05-30 | `510bcb1`  | Re-survey. No structural drift: same 17 workflows, same 3 custom actions, same Probot settings model. Pure version churn since last visit — `@bfra.me/.github` v4.16.18→v4.16.21 (3 changesets publishes), Node 24.15.0→24.16.0 (#2207), `fro-bot/agent` v0.44.2→v0.46.1 in 4 hops (v0.44.3 #2201 → v0.45.0 #2216 → v0.46.0 #2223 → v0.46.1 #2225), `bfra-me/renovate-action` walked v9.90→v9.99 (10 bumps in 10 days; high-velocity dependency). pnpm still 10.33.4, TS still 6.0.3. No new structural follow-ups; the three-source Probot settings reconciliation question from 2026-05-20 remains open. |
