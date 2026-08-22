---
type: repo
title: bfra-me/.github
created: 2026-05-20
updated: 2026-08-06
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
  - url: https://github.com/bfra-me/.github
    sha: 1c1269568de61df2d8a3ddf19fb01637c166ef00
    accessed: 2026-07-16
  - url: https://github.com/bfra-me/.github
    sha: d9feab2e628a21b1f38048fd2bf0563dbc814c5e
    accessed: 2026-08-06
tags: [bfra-me, dotgithub, monorepo, pnpm, typescript, github-actions, probot, renovate, template]
related:
  - bfra-me--ha-addon-repository
  - bfra-me--renovate-action
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
runtime (a **single unified `fro-bot.yaml`** since 2026-07-02, still the
shape at 2026-08-06, rather than a per-repo + org-sweep pair). Marketed
as a template
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
- **Last push:** 2026-08-04 (HEAD commit dated 2026-07-31; was 2026-07-16)
- **Package version:** `@bfra.me/.github` v4.16.44 (private root; was
  v4.16.37 on 2026-07-16)
- **Node:** 24.18.1 (`.node-version`; **first bump since 2026-07-02** —
  was 24.18.0 across the prior two surveys, 24.17.0 on 2026-06-20,
  24.16.0 on 2026-06-10, 24.15.0 on 2026-05-20)
- **Package manager:** pnpm **11.17.0** (2026-08-06; was 11.11.0 on
  2026-07-16 — routine minor churn within the 11.x line, six sequential
  Renovate bumps 11.12.0 → 11.17.0 across the window; the 10→11 boundary
  remains settled)
- **TypeScript:** 6.0.3, strict (unchanged across all six surveys; note
  a **v7** major bump is now in the open-PR queue — #2526/#2527)
- **Open issues / PRs:** 2 / 7 (2026-08-06). Open issues: #2344 (unified
  **Daily Fro Bot Report** — see Fro Bot Integration) and #7 (Dependency
  Dashboard) — the same two durable surfaces. Open PRs are **all
  `bfra-me[bot]` Renovate major-version bumps** the automerge policy
  holds back for human review: #2528 (lint-staged v17), #2526/#2527
  (typescript v7, dup), #2525 (fossas/fossa-action v2), #2524
  (actions/setup-node v7), #2523 (actions/labeler v7), #2522
  (actions/dependency-review-action v5). Was 2/2 on 2026-07-16. The
  standing report surface (#2344) and the Dependency Dashboard (#7)
  remain the only two durable open issues — the three-into-one report
  consolidation from 2026-07-02 holds across four windows.

## Layout

```
.
├── .ai/                                 # AI-consumed roadmap (added by 2026-07-16)
│   ├── notes/implementation-plan-prompts.md
│   └── plan/                            # 10 plan docs (federation, Astro docs, org health, etc.)
├── .husky/                             # Git hooks (pre-commit → pnpm exec lint-staged)
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
├── CHANGELOG.md                         # Changesets-generated release history (added by 2026-07-16)
├── CONTRIBUTING.md                      # Contributor guide (added by 2026-07-16)
├── .git-blame-ignore-revs               # Blame-ignore for bulk reformats (added by 2026-07-16)
├── .cursorindexingignore                # Cursor indexing excludes (added by 2026-07-16)
├── .gitattributes                       # Git attributes (present ≥2026-07-16)
├── .markdownlint-cli2.yaml              # Markdown lint config (present ≥2026-07-16)
├── llms.txt                             # AI-consumption manifest (present ≥2026-07-16, first enumerated 2026-08-06)
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
- Overrides (HEAD 2026-08-06): `esbuild@>=0.17.0 <0.28.1` forced to
  `>=0.28.1` (security, PR #2292 — on `main` since 2026-06-25);
  `flatted` pinned to `3.4.3` (bumped from `3.4.2` via #2491);
  `undici@<6.27.0` forced to `>=6.27.0`; `vite@>=8.0.0 <=8.0.4` forced to
  `>=8.0.5`. Override _set_ is otherwise stable across the window — no
  new security overrides added, one pin refresh only.
- Built-dependency allowlist: `esbuild`, `unrs-resolver`. As of
  2026-07-16 this is expressed via a pnpm **`allowBuilds:`** block in
  `pnpm-workspace.yaml` (`esbuild: true`, `unrs-resolver: true`) — the
  older `onlyBuiltDependencies` array form seen through 2026-07-02 has
  been migrated to the newer pnpm 11 key. Same allowlist, new spelling.
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
autoheal sweep. As of HEAD (2026-08-06) it pins:

- `fro-bot/agent@c29ac295b8da06768b140c32e5bd0ae3aff45dc6 # v0.96.0`
  (was v0.92.1 on 2026-07-16, v0.81.0 on 2026-07-02, v0.71.0 on
  2026-06-20, v0.59.1 on 2026-06-10, v0.44.2 on 2026-05-20). Renovate
  landed **~7 more sequential agent bumps** across the window
  (v0.93.0 → v0.93.1 → v0.94.0 → v0.94.1 → v0.94.2 → v0.94.3 → v0.94.4
  → v0.95.0 → v0.95.1 → v0.96.0). Cumulative: **~57 agent bumps in
  ~2.5 months**. Back at the front of the fleet — v0.96.0 ties the
  ecosystem lead held survey-to-survey by [[marcusrbrown--dotfiles]]
  (v0.95.0/v0.96.0), [[marcusrbrown--marcusrbrown-com]] (v0.96.0), and
  [[marcusrbrown--dev-like]] (v0.96.0); the pins cluster within a day of
  each release as automerge fans the bumps across the fleet.

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

**Confirmed durable (2026-07-16):** the consolidated design held with no
regression across this survey window — still one `fro-bot.yaml`, still
the two `review`/`autoheal` modes (`default: autoheal`), still the single
`30 15 * * *` unified pass, still the `target-repo` narrowing input. What
changed is only the agent pin (v0.81.0 → v0.92.1). The 2026-07-02
consolidation was not a transient state; it is now the steady-state shape
of the control plane.

**Re-confirmed durable (2026-08-06):** third consecutive survey with no
structural regression — one `fro-bot.yaml`, two `review`/`autoheal`
modes (`default: autoheal`), single `30 15 * * *` unified pass,
`target-repo` narrowing input, and the security-focused `PR_REVIEW_PROMPT`
all byte-stable. The only workflow-file delta is the agent pin
(v0.92.1 → v0.96.0). The `fro-bot.yaml` never-merge/never-approve
guardrails, the category taxonomy (1–6 this-repo, 7–8 org-wide), and the
dedup-before-create rule are all intact. The consolidation is now
four-window steady state.

### AI planning corpus (`.ai/`, new 2026-07-16)

A new top-level `.ai/` directory carries an **AI-consumed roadmap** — not
runtime config, but structured planning input for coding agents:

- `.ai/notes/implementation-plan-prompts.md` — an index of seed prompts
  meant to feed a `/create-implementation-plan` workflow, each pointing
  at a plan doc below.
- `.ai/plan/` — **10 plan documents** sketching ambitious future work:
  release-testing infrastructure for `release.ts`, an enhanced
  renovate-changesets action, an **Astro Starlight docs platform** (the
  same Starlight pattern [[bfra-me--works]] already ships), a
  **multi-org template federation system**, intelligent workflow
  generation, workflow validation, a cross-platform bridge, monorepo
  build optimization, **org-health monitoring**, and production-readiness
  validation.

These are aspirational specs, not shipped features — treat them as a
declared direction for the org control plane, not current capability.
Several (template federation, org-health monitoring) would substantially
expand this repo's remit beyond settings/workflow distribution into
active cross-org governance. Worth watching whether any graduate from
`.ai/plan/` into real workflows in future surveys. **2026-08-06:** none
have graduated yet — `.ai/plan/` is unchanged, still 10 aspirational
docs, still no corresponding shipped workflow. The declared direction
held static across the window.

### AI-consumption manifest (`llms.txt`)

The repo ships a top-level **`llms.txt`** — an [llmstxt.org](https://llmstxt.org)-style
manifest pointing AI agents at the canonical entry points (README,
`docs/workflows/*`, workflow templates, `package.json`/`tsconfig.json`/
`eslint.config.ts`, `common-settings.yaml`, `.github/copilot-instructions.md`,
`.github/settings.yml`). It self-describes as "Central configuration hub
and template repository for the @bfra-me GitHub organization." First
enumerated here on 2026-08-06 but **present since at least 2026-07-16**
(verified 200 at prior SHA `1c12695`) — it is a durable feature the
earlier layout snapshot simply omitted, not a new addition. The
`llms.txt`-drift autoheal check that flags stale manifests in sibling
repos ([[marcusrbrown--sparkle]] #1800, [[marcusrbrown--marcusrbrown]]
#1039) has no open counterpart here, so the manifest is presumed current.

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
  `js/json/jsx/md/toml/ts/tsx/yaml/yml`. The `.husky/pre-commit` hook
  (materialized in-tree by 2026-07-16) is a one-liner: `pnpm exec
  lint-staged`. Note the distinction from the
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
- **[[fro-bot--agent]]** — this repo pins `fro-bot/agent@v0.96.0`
  (2026-08-06; was v0.92.1 on 2026-07-16, v0.81.0 on 2026-07-02,
  v0.71.0 on 2026-06-20, v0.59.1 on 2026-06-10, v0.44.2 on 2026-05-20),
  back at the front of the ecosystem pin race. Renovate automerge keeps
  it within a day of each agent release.
- **[[bfra-me--renovate-action]]** — the org's Renovate execution
  surface, consumed here via `renovate.yaml`; crossed its own **v9 → v10
  major** during this window (#2520, now v10.1.0). This repo tracks it as
  a routine action pin, so the major landed as ordinary automerge churn
  rather than a structural event.
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
  (#2292), and `chore(🦋📦): publish release` merges.
- Commit traffic between 2026-07-02 and 2026-07-16 is **pure churn +
  scaffolding, no structural change**: fro-bot/agent v0.81.0→v0.92.1
  (~11 bumps), pnpm 11.9.0→11.11.0 (open PR #2436 queues 11.12.0),
  eslint 10.6.0→10.7.0, prettier 3.9.1→3.9.5, vite 8.1.0→8.1.4,
  @types/node 24.13.2→24.13.3, vitest/@vitest-coverage-v8 4.1.9→4.1.10,
  tsx 4.22.x→4.23.1, bfra-me/renovate-action 9.142.0→9.144.0,
  actions/setup-node v6.4.0→v6.5.0. Scaffolding additions: the `.ai/`
  planning corpus, `.husky/pre-commit`, root `CHANGELOG.md` and
  `CONTRIBUTING.md`, `.git-blame-ignore-revs`, `.cursorindexingignore`.
  Dev toolchain at HEAD (2026-07-16): eslint 10.7.0, prettier 3.9.5,
  vitest 4.1.10, @vitest/coverage-v8 4.1.10, vite 8.1.4, @types/node
  24.13.3, tsx 4.23.1, @bfra.me/eslint-config 0.51.1,
  @bfra.me/prettier-config 0.16.9, @bfra.me/tsconfig 0.13.1.
- **Doc drift (persists, widened — 2026-08-06):** `CONTRIBUTING.md`
  still states a pnpm prerequisite of "Version 10.8.1 or later" and
  lists "pnpm 10.8.1 (workspaces)" / "Changesets 2.29.5", but the repo
  now enforces pnpm **11.17.0** (`packageManager`) and ships
  `@changesets/cli` **2.31.1**. The gap _widened_ (11.11.0 → 11.17.0)
  across this window without any correcting commit — a category-3
  documentation-drift candidate unhealed across **two** consecutive
  surveys. Fro Bot's autoheal has not opened a fix; likely below the
  drift detector's threshold or not in a scanned surface. Worth
  watching whether the manifest-aware autoheal (which patches
  `llms.txt` drift in siblings) ever extends to `CONTRIBUTING.md` prose.
- Commit traffic between 2026-07-16 and 2026-08-06 is **pure churn, no
  structural change** — 82 commits, all Renovate dependency bumps,
  Changesets `publish release` merges, and `chore: update internal
  action SHA pins` maintenance. fro-bot/agent v0.92.1 → v0.96.0
  (~10 bumps), pnpm 11.11.0 → 11.17.0 (six bumps), Node 24.18.0 →
  24.18.1, eslint 10.7.0 → 10.8.0, prettier 3.9.5 → 3.9.6, vite 8.1.4 →
  8.1.5, @changesets/cli 2.31.0 → 2.31.1, flatted 3.4.2 → 3.4.3,
  minimatch → 10.2.6, `bfra-me/renovate-action` v9.144.0 → **v10.1.0**
  (**v9 → v10 major**, #2520), `actions/checkout` v6 → **v7** (#2521),
  github/codeql-action v4.37.1 → v4.37.4, ossf/scorecard-action v2.4.4,
  self-consumed `bfra-me/.github` reusable-workflow pin v4.16.37 →
  v4.16.44 (#2477/#2499). Dev toolchain at HEAD: eslint 10.8.0, prettier
  3.9.6, vitest 4.1.10, @vitest/coverage-v8 4.1.10, vite 8.1.5,
  @types/node 24.13.3, tsx 4.23.1, husky 9.1.7, lint-staged 16.4.0,
  @bfra.me/eslint-config 0.51.1, @bfra.me/prettier-config 0.16.9,
  @bfra.me/tsconfig 0.13.1. New devDeps for AI/manifest tooling surface:
  `remark`/`remark-parse`/`remark-stringify`/`unified`/`mdast-util-to-string`
  + `glob` 13.0.6 (markdown/AST processing, consistent with `llms.txt`
  generation).
- Structural changes 2026-06-20→2026-07-02: **17 → 16 workflows**,
  **3 modes → 2**, **3 report issues → 1**, pnpm **10.x → 11.x**,
  husky/lint-staged added. Structural changes 2026-07-02→2026-07-16:
  **none** — 16 workflows, 2 modes, 3 custom actions, one unified daily
  pass, all confirmed unchanged. Only additive scaffolding (`.ai/`,
  hooks, root docs) and version churn. Structural changes
  2026-07-16→2026-08-06: **none** — 16 workflows, 2 modes, 3 custom
  actions, single `30 15` unified pass, all durable. Two upstream
  **major** dependency crossings landed (`bfra-me/renovate-action`
  v9 → v10, `actions/checkout` v6 → v7) but neither altered this repo's
  own structure; `llms.txt`/`.gitattributes`/`.markdownlint-cli2.yaml`
  first enumerated but confirmed pre-existing.

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
| 2026-07-16 | `1c12695`  | Re-survey. v4.16.37, pnpm 11.11.0 (routine 11.x churn; #2436 queues 11.12.0), Node 24.18.0, agent **v0.92.1** (~11 more bumps, ~50 in two months). **No structural change** — 16 workflows, 2 modes, 3 custom actions, single `30 15` unified pass all confirmed durable; the 2026-07-02 consolidation is now steady-state. Additive scaffolding: new `.ai/` planning corpus (10 aspirational plan docs + notes), `.husky/pre-commit`, root `CHANGELOG.md`/`CONTRIBUTING.md`, `.git-blame-ignore-revs`, `.cursorindexingignore`. `onlyBuiltDependencies` array migrated to pnpm 11 `allowBuilds:` block (same allowlist). Doc drift: `CONTRIBUTING.md` cites pnpm "10.8.1+" while repo enforces 11.x. Open 2/2 (report #2344, dashboard #7; PRs #2444 release, #2436 pnpm bump). |
| 2026-08-06 | `d9feab2`  | Re-survey (82 commits ahead, all Renovate/release/SHA-pin churn). v4.16.44, pnpm **11.17.0** (six 11.x bumps), Node **24.18.1** (first bump since 2026-07-02), agent **v0.96.0** (~10 more bumps, ~57 in ~2.5 months, back at fleet lead). **No structural change** — 16 workflows, 2 modes, 3 custom actions, single `30 15` unified pass, security `PR_REVIEW_PROMPT` all durable (4th steady-state window). Two upstream **majors** landed as ordinary automerge: `bfra-me/renovate-action` v9 → **v10.1.0** (#2520), `actions/checkout` v6 → **v7** (#2521). Overrides stable (only `flatted` 3.4.2 → 3.4.3). `.ai/plan/` unchanged (0 of 10 graduated). `llms.txt`/`.gitattributes`/`.markdownlint-cli2.yaml` first enumerated but pre-existing. Doc drift persists + widened (`CONTRIBUTING.md` still "pnpm 10.8.1" vs enforced 11.17.0). Open **2/7** (report #2344, dashboard #7; 7 held-back major-bump PRs #2522–#2528 incl. typescript v7, lint-staged v17, actions v5–v7). |
