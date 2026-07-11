---
type: repo
title: bfra-me/.github
created: 2026-05-20
updated: 2026-07-02
sources:
  - url: https://github.com/bfra-me/.github
    sha: a81be4c5d5c93824fdcc426418c9433d5e5bd9be
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/.github
    sha: a27ccfa2f1bc670ddfa2dbfdcabe154d944daf0c
    accessed: 2026-06-10
  - url: https://github.com/bfra-me/.github
    sha: af0e41ef899e4083f3fc3c5a472c98093387c181
    accessed: 2026-06-20
  - url: https://github.com/bfra-me/.github
    sha: d51473c932f5e4d801044930196560e6baba8af9
    accessed: 2026-07-02
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
runtime (as of 2026-07-02 a **single unified `fro-bot.yaml`** rather than
a per-repo + org-sweep pair). Marketed as a template
(`is_template: true`) but in practice it runs as a full TypeScript pnpm
monorepo.

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
- **Last push:** 2026-07-02 (was 2026-06-20)
- **Package version:** `@bfra.me/.github` v4.16.33 (private root; was
  v4.16.27 on 2026-06-20)
- **Node:** 24.18.0 (`.node-version`; was 24.17.0 on 2026-06-20, 24.16.0
  on 2026-06-10, 24.15.0 on 2026-05-20)
- **Package manager:** pnpm **11.9.0** (2026-07-02 — a **major-version
  jump from the 10.34.x line** tracked across prior surveys; was 10.34.3
  on 2026-06-20). Ecosystem-wide pnpm 10→11 migration (see
  [[marcusrbrown--dotfiles]], [[bfra-me--works]]).
- **TypeScript:** 6.0.3, strict (unchanged across all four surveys)
- **Open issues / PRs:** 2 / 1 (2026-07-02). Open PR: #2384 Changesets
  release PR (`chore(🦋📦): publish release`, authored by `bfra-me[bot]`).
  Open issues: #2344 (unified **Daily Fro Bot Report** — see Fro Bot
  Integration) and #7 (Dependency Dashboard). Was 4/2 on 2026-06-20.

## Layout

```
.
├── .github/
│   ├── actions/
│   │   ├── renovate-changesets/         # Complex action: auto-changeset Renovate PRs (~125 src files)
│   │   ├── update-metadata/             # Repo metadata generator
│   │   └── update-repository-settings/  # Plugin-based settings sync
│   ├── instructions/                    # AI-consumed dev guides (changesets, GH Actions, pnpm, Renovate, TS)
│   ├── workflows/                       # 16 workflows: CI, Fro Bot, security, Copilot, renovate (was 17; autoheal-org merged into fro-bot.yaml 2026-07-02)
│   ├── codeql/
│   ├── copilot-instructions.md
│   ├── gitleaks.toml
│   ├── labeler.yaml
│   ├── renovate.json5
│   └── settings.yml
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
├── package.json                         # `@bfra.me/.github` v4.16.18
├── pnpm-workspace.yaml
├── tsconfig.json / tsconfig.build.json / tsconfig.eslint.json
└── vitest.config.ts
```

## Workspace

- 4 packages: root (`@bfra.me/.github`) + 3 actions under `.github/actions/*`
- Root is itself a workspace member (`packages: ['.', '.github/actions/*']`)
  with `ignoreWorkspaceRootCheck: true` — uncommon but intentional
- `shamefullyHoist: true`, `autoInstallPeers: true`, `savePrefix: ''`,
  `shellEmulator: true`, `strictPeerDependencies: false` (latter two
  confirmed 2026-06-10)
- Overrides (HEAD 2026-07-02): `esbuild@>=0.17.0 <0.28.1` forced to
  `>=0.28.1` (security, PR #2292 — now on `main`); `flatted@3.4.2`
  pinned; `undici@<6.27.0` forced to `>=6.27.0` (floor raised from
  `<6.23.0`→`>=6.23.0` seen on prior surveys); `vite@>=8.0.0 <=8.0.4`
  forced to `>=8.0.5`
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

## Workflows (16)

```
auto-release.yaml          codeql-analysis.yaml         container-scan.yaml
copilot-setup-steps.yaml   dependency-review.yaml       fro-bot.yaml
license-compliance.yaml    main.yaml                    pr-triage.yaml
renovate-changeset.yaml    renovate.yaml                scorecard.yaml
secret-scan.yaml           trigger-org-renovate.yaml    update-metadata.yaml
update-repo-settings.yaml
```

**Structural change (2026-07-02):** `fro-bot-autoheal-org.yaml` was
**removed**; its org-wide sweep folded into a single unified
`fro-bot.yaml`. The maintenance/autoheal split also collapsed — the
per-repo daily maintenance cron (`0 5 * * *`) is gone; a single daily
pass at `30 15 * * *` now does **both** proactive oversight (detect and
report) **and** reactive autohealing (fix what is safe), for this repo
and across the org. This drops the workflow count 17 → 16.

Notable surface area:

- **`main.yaml`** — primary CI entry point (Quality Check job referenced by branch protection)
- **`fro-bot.yaml`** — the **single** Fro Bot execution engine (2026-07-02): PR review, mention handling, daily unified oversight+autoheal pass (`30 15 * * *`), org-wide sweep, `workflow_dispatch` with `mode` choice (**review/autoheal** — `maintenance` retired), optional `target-repo` input to narrow the org scan, `workflow_call` for reusable invocation
- **`renovate.yaml`** — drives self-hosted Renovate via `@bfra-me/renovate-action`
- **`trigger-org-renovate.yaml`** — fans Renovate runs out to other org repos
- **`update-repo-settings.yaml`** — applies `.github/settings.yml` (and downstream `common-settings.yaml`) via `update-repository-settings` action
- **`update-metadata.yaml`** — invokes local `update-metadata` action without the self-checkout pattern (action only runs in this repo)
- **`codeql-analysis.yaml`, `scorecard.yaml`, `container-scan.yaml`, `secret-scan.yaml`, `license-compliance.yaml`, `dependency-review.yaml`** — security posture
- **`copilot-setup-steps.yaml`** — Copilot coding agent bootstrap
- **`pr-triage.yaml`** — labeler-driven PR triage

## Fro Bot Integration

This repo **is** a Fro Bot workflow host, and it also _runs_ the org-wide
autoheal sweep. As of HEAD (2026-07-02) it pins:

- `fro-bot/agent@b13c6c424f56de405c3c1be39089f00d646e8830 # v0.81.0`
  (was v0.71.0 on 2026-06-20, v0.59.1 on 2026-06-10, v0.44.2 on
  2026-05-20). Renovate landed **10 more sequential agent bumps**
  between 2026-06-20 (v0.71.0) and 2026-07-02 (v0.81.0). Combined with
  the prior runs, that is **~39 agent bumps in ~six weeks**. It remains
  among the freshest agent pins in the ecosystem, though
  [[bfra-me--works]] (v0.75.0+), [[marcusrbrown--dotfiles]] (v0.79.1),
  and [[marcusrbrown--infra]] (v0.79.4) now trade the fleet-leader
  position survey to survey.

### Fro Bot workflow consolidation (2026-07-02)

The prior two-workflow / three-mode design collapsed into **one
workflow, one daily pass**:

- `fro-bot-autoheal-org.yaml` was **deleted**. The org-wide sweep is now
  a branch of `fro-bot.yaml`'s daily run rather than a separate
  scheduled workflow.
- The `maintenance` mode and its `0 5 * * *` cron are **retired**. Mode
  choices are now `review` / `autoheal` only.
- A single `30 15 * * *` cron runs a "unified pass" that does **both**
  proactive oversight (detect and report) **and** reactive autohealing
  (fix what is safe) — for this repo (categories 1–6) and across the org
  (categories 7–8) in the same invocation.
- The `target-repo` input (formerly on the org workflow) migrated to
  `fro-bot.yaml`'s `workflow_dispatch`; setting it restricts only the
  org-wide categories, while this-repo categories still run.

This is a real simplification of the org control plane: one execution
engine, one prompt, one schedule, instead of a per-repo maintenance job
plus a weekday org sweep that delegated back into it.

### Live Fro Bot security autoheal (PR #2292, MERGED 2026-06-25)

The esbuild remediation observed in-flight on 2026-06-20 **landed**: PR
#2292 (`fix(security): remediate esbuild vulnerability`, authored by
`fro-bot`) merged 2026-06-25, adding `esbuild@>=0.17.0 <0.28.1: '>=0.28.1'`
to `pnpm-workspace.yaml` overrides to close Dependabot alerts #52 (HIGH:
binary integrity verification bypass enabling RCE via
`NPM_CONFIG_REGISTRY`) and #51 (LOW: dev-server arbitrary file read on
Windows). The override is now **on `main`** — HEAD overrides are
`esbuild`, `flatted`, `undici@<6.27.0: '>=6.27.0'`, `vite`. This closes
the loop on the prior survey's open example: the autoheal contract
produced a real, transitive-only, advisory-scoped patch and it shipped.

### `fro-bot.yaml` (unified execution engine)

- Triggers: `issue_comment`, `pull_request_review_comment`,
  `discussion_comment`, `issues` (opened/edited), `pull_request` (opened,
  synchronize, reopened, ready_for_review, review_requested), a **single**
  `30 15 * * *` cron, `workflow_dispatch` (`mode` = review/autoheal,
  `prompt`, `target-repo`), `workflow_call`
- Concurrency keyed off issue/PR/discussion/schedule/run_id; never
  cancels in progress (autoheal runs must finish cleanly)
- `workflow_dispatch` accepts a custom `prompt` input that overrides mode
  selection entirely; mode resolution now falls back through explicit
  input → caller (`workflow_call`) mode → event type
  (schedule = autoheal, dispatch = autoheal, PR = review), with hard
  validation against the **two** known modes (`review`, `autoheal`)
- Execution model (carried from the retired org workflow): analyze every
  category, but perform write actions serially — never keep more than one
  branch checked out, return to a clean working tree between mutations,
  process org repos serially the same way
- Dedup rule: before creating any PR/issue, search for an existing open
  bot-authored item for the same root cause in the affected repo; reuse
  or update rather than duplicate
- Scope cap: minimal and reversible only — broad refactors / architecture
  changes get logged under "Needs Human Attention" rather than executed
- Dependency ownership: Renovate owns routine version bumps; Fro Bot may
  change versions **only** to remediate confirmed high/critical advisories
  (PR #2292 is the canonical example)
- `PR_REVIEW_PROMPT` is security-focused for an org control center —
  enforces SHA-pinned actions with version comments, blocks workflow
  injection via untrusted input in `run:` blocks, requires `dist/`
  rebuild for action source changes, enforces manually-authored
  changesets (`pnpm changeset` CLI explicitly banned), and TypeScript
  strictness (no `any`, no `@ts-ignore`, no `@ts-expect-error`, ESM only)

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
- Git hooks via **husky** + **lint-staged** (added by 2026-07-02):
  `prepare: husky`, `lint-staged` runs `eslint --fix` on staged
  `js/json/jsx/md/toml/ts/tsx/yaml/yml`. Note the distinction from the
  banned CLI: the `bump` script uses `changeset version` (release
  automation), which is **not** the prohibited `pnpm changeset`
  authoring CLI — authoring changesets by hand remains the rule.
- Workspace scripts: `#!/usr/bin/env tsx`, function-based, typed
  interfaces. Workspace validation now also exposes `manypkg`
  (`workspace:check`/`workspace:fix`) and TypeScript project-reference
  auditing (`typescript:audit`, `typescript:cross-package-validation`)
  plus a build-cache manager (`build:cache:*`) and incremental-build
  analyzer (`build:incremental:*`)
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
- **[[fro-bot--agent]]** — this repo pins `fro-bot/agent@v0.81.0`
  (2026-07-02; was v0.71.0 on 2026-06-20, v0.59.1 on 2026-06-10, v0.44.2
  on 2026-05-20), among the freshest ecosystem pins. Renovate automerge
  keeps it within a day of each agent release.
- **[[marcusrbrown--renovate-config]]** — Marcus's preset is the
  Renovate baseline for `marcusrbrown/*` repos; `bfra-me/.github` ships
  its own `metadata/renovate.yaml` for `bfra-me/*` repos.

## Operational Notes

- **Issue #2213 is RESOLVED** (closed 2026-06-25, `COMPLETED`): the
  `update-repo-settings` `Filter Changed Files` git-exit-128-on-push
  defect that survived ~29 agent bumps across three prior surveys was
  finally fixed. The prior-survey read that a workflow logic bug sits
  under "Needs Human Attention" outside the autoheal scope cap held up
  — it took a deliberate fix, not an autoheal sweep, to close it.
- **Report-issue consolidation (contradiction with prior surveys):**
  the three standing bot-authored report issues — #2185 (Daily
  Maintenance Report), #1960 (Org Autohealing Report), #1959 (Daily
  Autohealing Report) — are now all **CLOSED** (`COMPLETED`). They are
  superseded by a single **#2344 (Daily Fro Bot Report)** (opened
  2026-06-25), matching the workflow consolidation into one unified
  daily pass. This is the same three-into-one collapse visible in the
  workflows and modes: fewer moving parts, one report surface.
- Only two issues open at HEAD: #2344 (unified report) and #7
  (Dependency Dashboard, reopened by the bfra-me app).
- Commit traffic between 2026-06-20 and 2026-07-02 is again almost
  entirely Renovate dependency churn (fro-bot/agent v0.71.0→v0.81.0,
  pnpm **10.34.3→11.9.0** (major), Node 24.17.0→24.18.0, eslint
  10.5.0→10.6.0, prettier 3.8.4→3.9.1, vite 8.0.16→8.1.0, @types/node
  24.12.4→24.13.2, tsx→4.22.4) plus the husky/lint-staged + manypkg +
  build-cache tooling additions, the merged esbuild remediation
  (#2292), and `chore(🦋📦): publish release` merges. Dev toolchain at
  HEAD: eslint 10.6.0, prettier 3.9.1, vitest 4.1.9, @vitest/coverage-v8
  4.1.9, vite 8.1.0, @types/node 24.13.2, @bfra.me/eslint-config 0.51.1,
  @bfra.me/prettier-config 0.16.9, @bfra.me/tsconfig 0.13.1.
- Structural changes this period: **17 → 16 workflows** (autoheal-org
  merged into fro-bot.yaml), **3 modes → 2**, **3 report issues → 1**,
  pnpm **10.x → 11.x**, husky/lint-staged added. Custom actions
  unchanged (still 3).

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
| 2026-06-10 | `a27ccfa`  | Re-survey. v4.16.24, pnpm 10.34.1, Node 24.16.0, agent v0.59.1 (17 bumps in 3 weeks). Structure unchanged. Issue #2213 (settings-sync git exit 128) open. |
| 2026-06-20 | `af0e41e`  | Re-survey. v4.16.27, pnpm 10.34.3, Node 24.17.0, agent v0.71.0 (12 more bumps in 10 days, ~29 in a month). Structure unchanged (17 workflows, 3 actions). Issue #2213 still open (now 4 weeks). New: Fro Bot PR #2292 esbuild security autoheal (HIGH alert #52), still open. |
| 2026-07-02 | `d51473c`  | Re-survey. v4.16.33, pnpm **11.9.0** (major 10→11), Node 24.18.0, agent v0.81.0 (~10 more bumps, ~39 in six weeks). **First structural change since initial survey:** `fro-bot-autoheal-org.yaml` merged into `fro-bot.yaml` (17→16 workflows); `maintenance` mode + `0 5` cron retired (3→2 modes, single `30 15` unified pass); three report issues (#2185/#1960/#1959) closed and consolidated into #2344. Issue #2213 **RESOLVED** (closed 2026-06-25). PR #2292 esbuild remediation **MERGED** (override now on `main`). Added husky/lint-staged + manypkg + build-cache tooling. Custom actions unchanged (3). |
