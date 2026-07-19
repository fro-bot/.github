---
type: repo
title: bfra-me/works
created: 2026-05-20
updated: 2026-07-19
sources:
  - url: https://github.com/bfra-me/works
    sha: ef14b26085dab318fffad1b6c3062292f8ae60b8
    accessed: 2026-05-20
  - url: https://github.com/bfra-me/works
    sha: cd4a52d7d9ad59c8770784d9411d688e9a7d50db
    accessed: 2026-05-31
  - url: https://github.com/bfra-me/works
    sha: 499b2156515414fd1d85561b52efcce4fb93536d
    accessed: 2026-06-11
  - url: https://github.com/bfra-me/works
    sha: fb5c29876d21212793147eccf77d33c9d5888e4e
    accessed: 2026-06-22
  - url: https://github.com/bfra-me/works
    sha: b00229cd6d867af898ecda6b812c443917208373
    accessed: 2026-07-05
  - url: https://github.com/bfra-me/works
    sha: cf8689aea25a7402c24f9292669f10265d15c739
    accessed: 2026-07-19
tags:
  [
    bfra-me,
    monorepo,
    pnpm,
    typescript,
    eslint-config,
    prettier-config,
    tsconfig,
    semantic-release,
    changesets,
    astro-starlight,
    cli,
    workspace-analyzer,
    fro-bot,
  ]
related:
  - bfra-me--github
  - bfra-me--ha-addon-repository
  - fro-bot--agent
  - marcusrbrown--renovate-config
  - github-actions-ci
  - probot-settings
---

# bfra-me/works

The `@bfra-me` tooling monorepo. Nine published packages (8 in
`packages/*` plus the `docs` site) that ship the shared ESLint, Prettier,
and TypeScript configs, ES utility runtime, project-scaffolding CLI,
documentation sync engine, semantic-release presets, badge generator,
and a workspace static analyzer — all consumed by the rest of the
`@bfra-me` and `marcusrbrown` ecosystem.

This is the _source_ of the `@bfra.me/*` configs that show up as
devDependencies across the wider Fro Bot ecosystem. Where
[[bfra-me--github]] is the **org control plane** (workflows, settings,
automation actions), `bfra-me/works` is the **shared library plane**.

## Identity

- **Owner:** bfra-me (org)
- **Visibility:** public
- **License:** MIT
- **Default branch:** `main`
- **Created:** 2020-10-27
- **Last push:** 2026-07-19
- **Topics:** `bfra-me`, `works`, `components`, `semantic-release`, `tools`, `tsconfig`
- **Stars:** 4 (steady since 2026-06-22)
- **Open issues / PRs:** 38 open issues / 12 open PRs (2026-07-19; was 38 issues / 11 PRs on 2026-07-05). Issues flat across four surveys; PR count still creeping up — the review-pipeline backlog described in Open Questions keeps accreting.
- **Latest release:** `@bfra.me/workspace-analyzer@0.2.8` (2026-05-16) — still the tagged release on 2026-07-19; **no npm publish in ~9 weeks.** The prior survey's Changesets publish PR **#3854** was **closed unmerged** (2026-07-05, same day it opened) — the staged publish did *not* land. A fresh publish PR **#3972** (`chore(🦋📦): publish packages`) opened 2026-07-19; whether *it* merges is the open question. All nine published package versions on `main` remain byte-identical to the 2026-05-16 baseline (sixth consecutive survey).
- **Primary language:** TypeScript (~99%)
- **Node:** 24.18.0 (`.node-version`; unchanged since 2026-07-05, was 24.17.0 on 2026-06-22) — packages target ES2022+/Node 20+
- **Package manager:** **pnpm 11.13.1** (`packageManager` in root `package.json`; was 11.9.0 on 2026-07-05) — three minor bumps across the window (11.9.0 → 11.12.0 → 11.13.1; HEAD commit `cf8689a` is the pnpm 11.12.0 bump #3940, root manifest already carries 11.13.1). The 10.x → 11.x major boundary was crossed on 2026-07-05; the train now rolls steadily within v11.
- **TypeScript:** 6.0.3, strict (`noUncheckedIndexedAccess`)
- **Root package:** `@bfra.me/works` v0.0.0-development (private)

## Layout

```
.
├── .ai/                              # Agent context fixtures
├── .changeset/                       # Changesets state
├── .github/
│   ├── actions/
│   │   └── pnpm-install/             # Local composite action (used by every workflow)
│   ├── instructions/                 # AI-consumed dev guides
│   ├── prompts/                      # Reusable prompt templates
│   ├── workflows/                    # 11 workflows (.yaml) + 1 docs file (.md)
│   ├── CODEOWNERS
│   ├── filters.yaml
│   ├── renovate.json5
│   └── settings.yml
├── .husky/                           # Git hooks (lint-staged on commit)
├── .vscode/
├── docs/                             # Astro Starlight documentation site
├── packages/
│   ├── badge-config/                 # Shields.io URL generator
│   ├── create/                       # `create` CLI (templates + optional AI)
│   ├── doc-sync/                     # Astro docs sync engine + CLI
│   ├── es/                           # Result/async/functional/types/etc.
│   ├── eslint-config/                # @bfra.me/eslint-config
│   ├── prettier-config/              # 80/100/120-proof variants + semi
│   ├── semantic-release/             # SR shareable config + plugins
│   ├── tsconfig/                     # Library/app strict TS configs
│   └── workspace-analyzer/           # Static-analysis CLI + JSON output
├── scripts/                          # tsx workspace utilities
├── AGENTS.md                         # Agent-focused conventions
├── CLAUDE.md
├── CONTRIBUTING.md
├── PERFORMANCE.md
├── .git-blame-ignore-revs            # (new 2026-06-22) blame-noise suppression
├── .mailmap                          # (new 2026-06-22) contributor identity canonicalization
├── .mise.toml                        # mise toolchain (was `mise.toml`, dot-prefixed since 2026-06-22)
├── .playwright-mcp/                  # (new 2026-06-22) Playwright MCP fixtures/output
├── eslint.config.ts
├── json                              # (new 2026-06-22) stray file — a Changesets snapshot blob (`{"changesets":[{"releases":[…]}]}`), almost certainly an accidental redirect of `changeset status --output json`; still committed as of 2026-07-05
├── llms.txt
├── package.json                      # @bfra.me/works (private root)
├── pnpm-workspace.yaml
├── tsconfig.json / tsconfig.eslint.json
├── tsup.dts.ts                       # Shared tsup .d.ts helper
├── type-coverage.json
├── vitest.config.ts
└── workspace-analyzer.config.ts
```

## Workspace

- 11 workspace entries: root, `docs`, `scripts`, plus 8 `packages/*`
- `autoInstallPeers: true`, `shamefullyHoist: true`,
  `strictPeerDependencies: true`, `savePrefix: ''`,
  `shellEmulator: true`
- `onlyBuiltDependencies`: `esbuild`, `msw`, `sharp`, `unrs-resolver`
- An `allowBuilds` block mirrors the same four packages (`esbuild`,
  `msw`, `sharp`, `unrs-resolver`) alongside the existing
  `onlyBuiltDependencies` — the pnpm 11 build-approval surface, added
  with the pnpm 10.34.4 → 11.9.0 major bump on 2026-07-05 and confirmed
  durable on 2026-07-19.
- **Override split (observed 2026-06-22):** `fast-uri >=3.1.2` now lives
  in the **root `package.json`** `pnpm.overrides`, while the rest of the
  override surface stays in `pnpm-workspace.yaml`: `handlebars` pinned
  `^4.7.9`; `lodash ^4.17.23`; `picomatch` range patches (`2.3.2`,
  `4.0.4`); `read-pkg-up@^11` redirected to `read-package-up`; `undici`
  ranges forced safe — **`undici@<6.24.0 → ^8.0.0`** (was `^6.24.0` on
  2026-06-11, a major bump in the floor) and `undici@>=7.17.0 <7.24.0 →
  ^7.24.0`
- `packageExtensions` extend ESLint plugin peer ranges to ESLint 10
- `peerDependencyRules.allowedVersions` carries the TypeScript 6.0
  transition for the eslint-react family, type-coverage, tsconfck, and
  Astro check
- `manypkg.workspaceProtocol: require` — internal deps must use
  `workspace:` protocol
- Vitest resolves workspace packages to TypeScript source via
  `conditions: ['source']` (no pre-build required for testing)

## Published Packages

| Package                       | Version  | Bin                  | Notes                                                   |
| ----------------------------- | -------- | -------------------- | ------------------------------------------------------- |
| `@bfra.me/badge-config`       | 0.2.0    | —                    | Shields.io badge URL generator with preset generators   |
| `@bfra.me/create`             | 0.7.14   | `create`             | Project-scaffold CLI; optional OpenAI/Anthropic enhance |
| `@bfra.me/doc-sync`           | 0.1.9    | `doc-sync`           | Astro Starlight docs sync; subpath exports per layer    |
| `@bfra.me/es`                 | 0.1.0    | —                    | ES utilities; subpath exports: async/env/error/functional/module/result/types/validation/watcher |
| `@bfra.me/eslint-config`      | 0.51.1   | —                    | Shared ESLint config (TS/Prettier/Vitest)               |
| `@bfra.me/prettier-config`    | 0.16.9   | —                    | Variants: `80-proof`, `100-proof`, `120-proof`, `semi`, `default`, `define-config` |
| `@bfra.me/semantic-release`   | 0.3.7    | —                    | Semantic-release shareable config + plugins             |
| `@bfra.me/tsconfig`           | 0.13.1   | —                    | tsconfig presets for libs and apps                      |
| `@bfra.me/workspace-analyzer` | 0.2.8    | `workspace-analyzer` | Latest release (2026-05-16); CLI + JSON output for CI   |

All packages ship to `lib/` via tsup, **except** `@bfra.me/create`
which builds to `dist/`. Root exports two helper modules
(`./eslint.config`, `./tsup.dts`) for downstream consumption.

## Workflows (11 + 1 doc)

```
cache-cleanup.yaml         codeql-analysis.yaml       dependency-review.yaml
docs-sync.yaml             docs.yaml                  fro-bot.yaml
fro-bot-dispatch-examples.md   (documentation, not a workflow)
main.yaml                  release.yaml               renovate-changeset.yaml
renovate.yaml              scorecard.yaml             update-repo-settings.yaml
```

Surface area:

- **`main.yaml`** — primary CI: `Prepare → {Lint+type-coverage, Test,
  Build, Workspace Analysis} → CI`. Workspace Analysis runs
  `pnpm analyze` and uploads `workspace-analysis.json` (7-day retention,
  `continue-on-error: true`). The `CI` job is the branch-protection
  status check that depends on the four parallel jobs.
- **`release.yaml`** — Changesets-driven release. Triggers on
  `workflow_run` after `Main` succeeds on `main`, weekly Sunday
  `0 18 * * 0`, and `workflow_dispatch` with a `force-release` toggle.
  Uses a `bfra-me[bot]` GitHub App token for elevated permissions when
  invoked from schedule/`workflow_run`.
- **`fro-bot.yaml`** — full Fro Bot persona (see Fro Bot Integration
  below).
- **`docs.yaml`** — builds the Astro Starlight site and deploys to
  GitHub Pages (uses `actions/upload-pages-artifact@v5` and
  `concurrency: pages`). Public commit hash injected as
  `PUBLIC_COMMIT_HASH` for the Starlight footer.
- **`docs-sync.yaml`** — path-filtered automation for
  `@bfra.me/doc-sync`: re-syncs `docs/src/content/docs/packages/*.mdx`
  when package READMEs, sources, or `package.json` files change. Has a
  `dry-run` dispatch input.
- **`renovate.yaml`** — calls reusable
  `bfra-me/.github/.github/workflows/renovate.yaml@v4.16.37` (v4.16.18
  → v4.16.21 → v4.16.25 → v4.16.28 → v4.16.33 → v4.16.37 across
  surveys) after the Release workflow succeeds, with `log-level` and
  `print-config` dispatch inputs.
- **`renovate-changeset.yaml`** — auto-generates changesets for
  `bfra-me[bot]` / `renovate[bot]` PRs. Triggers on `merge_group`,
  `pull_request_target`, and `workflow_dispatch`. Uses
  `dorny/paths-filter` and a GitHub App token.
- **`update-repo-settings.yaml`** — calls reusable
  `bfra-me/.github/.github/workflows/update-repo-settings.yaml@v4.16.0`.
  Push to main, daily `02 18 * * *`, and dispatch.
- **`cache-cleanup.yaml`** — deletes workflow caches for the closing PR
  ref (and Sunday `0 0 * * 0` housekeeping). Permissions narrowed to
  `actions: write`.
- **`codeql-analysis.yaml`, `dependency-review.yaml`, `scorecard.yaml`**
  — security posture.
- **`fro-bot-dispatch-examples.md`** — sibling Markdown doc next to the
  workflow files documenting `workflow_dispatch` invocations.

Every workflow consumes the local `.github/actions/pnpm-install`
composite action for dependency hydration, which centralizes Node + pnpm
setup and cache restoration.

## Fro Bot Integration

`bfra-me/works` runs a **single-file three-mode Fro Bot** at
`fro-bot/agent@a4976f45 # v0.93.1` (as of 2026-07-19) — still the
leading agent pin in the surveyed ecosystem, now tied with
[[marcusrbrown--tokentoilet]] (v0.93.1) at the front. The pin advanced
v0.44.2 → v0.47.0 (2026-05-30) → v0.60.0 (2026-06-11) → v0.75.0
(2026-06-22) → v0.83.0 (2026-07-05) → **v0.93.1** (2026-07-19) — a
10-minor drift over the last 14 days, all automerged. PR #3491 patched
the inline shell mode resolution for `workflow_dispatch` and
`workflow_call` paths; that mode-resolution logic is unchanged in the
current file. A fresh Fro Bot-authored PR **#3973** (`docs: refresh
agent workflow notes`, 2026-07-19) touches only `AGENTS.md`.

**Pending major (v0 → v1) — deepening stale:** Renovate PR **#3691**
(`chore(deps): update fro-bot/agent to v1`, opened 2026-06-14 by
`app/bfra-me`) proposes the `v0.62.0 → v1.18.0` jump — the v1 boundary
for the [[fro-bot--agent]] harness. As of 2026-07-19 it remains open,
un-automerged, and **still untouched since 2026-06-14** (no rebase in
~5 weeks) while the live minor pin has climbed to v0.93.1. Renovate has
not refreshed it to the current v1.x tag; the PR now drifts ~31 minors
below the live pin and an unknown distance below the current v1.x tag.
The repo is effectively parked on the v0 tag train until the v1 cutover
is reviewed deliberately, and #3691 is a dead proposal that should be
closed and re-opened against a fresher v1.x rather than merged as-is.

### Triggers

- `issue_comment`, `pull_request_review_comment`, `discussion_comment`
  on `@fro-bot` mentions from `OWNER`/`MEMBER`/`COLLABORATOR`
- `issues` opened/edited, `pull_request` opened/synchronize/reopened/
  ready_for_review/review_requested (skipped for bot authors and forks)
- Two crons: **`0 16 * * *`** (maintenance) and **`30 3 * * *`**
  (autoheal)
- `workflow_dispatch` with `mode` choice
  (`review`/`maintenance`/`autoheal`, default `autoheal`) and an
  optional `prompt` override
- `workflow_call` with a required `prompt` input for reusable
  invocation

Concurrency keyed off issue/PR/discussion/schedule/run_id with
`cancel-in-progress: false` (autoheal must complete cleanly). The
`if:` guard explicitly filters out bot authors, forks, and the
`fro-bot` account itself.

### Mode resolution (inline shell)

```text
schedule "30 3"   → autoheal
schedule other    → maintenance
workflow_dispatch → autoheal (unless mode chosen)
pull_request      → review
otherwise         → custom prompt input
```

### `PR_REVIEW_PROMPT`

TypeScript-monorepo-specific. Enforces:

- No `as any`, `@ts-ignore`, or `@ts-expect-error` suppression
- `Result<T, E>` (from `@bfra.me/es/result`) instead of throwing
- Explicit named exports only — no `export *` in application code
- Breaking-change awareness for subpath exports, entrypoints, types
- Monorepo integrity: dep boundaries, build order impact, cross-package
  version alignment
- Test coverage for happy path, errors, boundaries (with explicit
  rationale when tests aren't needed)
- Verdict format: `PASS | CONDITIONAL | REJECT` with `Blocking issues
  / Non-blocking concerns / Missing tests / Risk assessment
  (LOW/MED/HIGH)` headings — every heading must be emitted (use
  "None") and formatting/lint nits are explicitly out of scope

### `MAINTENANCE_PROMPT` — "Daily Maintenance Report"

Maintains exactly **one** open rolling issue titled `Daily Maintenance
Report`. Behavior:

- Search by exact title; if multiple matches, use the most recently
  updated; if the most recent is closed, reopen it rather than create
  a new one
- After selecting the canonical issue, close any other open
  `Daily Maintenance Report` issues with a brief consolidation comment
- Append a new `## YYYY-MM-DD (UTC)` section per run
- After 14 days, collapse older dated sections into a single
  `## Historical Summary` (updated in place — never duplicate it)
- Flag first-time stale items with a `★` marker
- Sections: Summary metrics → Stale issues (>30d) → Stale PRs (>7d
  stale, >14d aged) → Unassigned bugs → Recommended actions → Notes
- Hard rule: no per-issue/PR comments or label changes; one issue
  update per run

### `AUTOHEAL_PROMPT` — "Daily Autohealing Report"

Five-category sweep, executed serially with deduplication against
existing bot-authored items:

1. **ERRORED PRs** — fix failing CI on trusted-author PRs
   (`renovate[bot]`, `dependabot[bot]`, `fro-bot`, write-access humans).
   Skip PRs that touch workflows, automation prompts, pnpm/lockfile, or
   exec scripts. Run `pnpm validate` to confirm fixes locally before
   pushing.
2. **SECURITY** — repair existing security update PRs or open new ones
   for critical/high advisories. Renovate owns routine bumps; Fro Bot
   only touches versions for confirmed security advisories. Skip with
   "security alerts unavailable" if data is missing.
3. **CODE QUALITY & REPO HYGIENE** — primarily report-only:
   `pnpm build` and `pnpm type-coverage` health, stale TODO/FIXME/HACK
   scan (>90 days via git blame), convention drift (no barrel exports
   outside `src/index.ts`, no `require()`, no `any`, named exports
   only), `AGENTS.md` drift, `pnpm analyze` regressions.
4. **DEVELOPER EXPERIENCE** — `pnpm lint`/`pnpm type-check` auto-fix
   PRs only (never direct push to default branch). Group related fixes
   into a single `chore(lint): apply auto-fixes from autohealing run`
   PR.
5. **PROGRESSIVE IMPROVEMENT** — report-only: tool-version gaps (>1
   minor behind), CI pipeline health, `package.json` analytics
   correctness, cross-project pattern check against
   [[bfra-me--github]], AGENTS.md convention drift.

Hard boundaries:

- Never force-push, rewrite history, delete branches, push directly to
  default, merge PRs, submit reviews, close/reopen issues/PRs, modify
  branch protection or secrets/org settings
- Never make checks pass by disabling tests, deleting assertions,
  lowering coverage budgets, weakening lint/type rules, or editing
  workflows/configs purely to suppress failures
- Output: **exactly one** issue titled `Daily Autohealing Report` with
  a structured table-driven body (Summary / Errored PRs / Security /
  Code Quality & Repo Hygiene / Developer Experience / Progressive
  Improvement / Needs Human Attention)

The single-issue rolling-update pattern matches
[[bfra-me--ha-addon-repository]] (which uses the same `Daily
Autohealing Report` convention) and diverges from sibling repos that
create a new report per cycle.

### Schedule alignment

- Maintenance cron `0 16 * * *` = 16:00 UTC
- Autoheal cron `30 3 * * *` = 03:30 UTC
- Distinct from [[bfra-me--github]] which runs org-wide autoheal
  weekdays at `0 5 * * 1-5` and from [[bfra-me--ha-addon-repository]]'s
  15:30 UTC autoheal

## Probot Settings

- `.github/settings.yml` `_extends: .github:common-settings.yaml`
  — resolves to the **bfra-me org** `.github` repo template
  (consistent with sibling [[bfra-me--ha-addon-repository]], unlike the
  `marcusrbrown/*` repos that extend `fro-bot/.github`)
- Repo-level overrides: name `works`, description
  `@bfra-me tools and components`, topics `works, bfra-me, tools,
  components, tsconfig, semantic-release`
- Branch protection (`main`): 12 required status checks — `Analyze`,
  `Build`, `CI`, `CodeQL`, `Create Renovate Changeset`, `Fro Bot`,
  `Lint`, `Prepare`, `Renovate / Renovate`, `Review Dependencies`,
  `Test`, `Workspace Analysis`; `strict: false`,
  `enforce_admins: true`, `required_linear_history: true`,
  `required_pull_request_reviews: null` (no human reviewers required
  — governance leans on status checks, same posture as
  [[bfra-me--github]])

## Renovate

- `.github/renovate.json5` extends:
  - `github>bfra-me/.github:internal.json5#v4.16.37` (org baseline;
    `#v4.16.18` on 2026-05-20, `#v4.16.21` on 2026-05-31,
    `#v4.16.25` on 2026-06-11, `#v4.16.28` on 2026-06-22,
    `#v4.16.33` on 2026-07-05)
  - `github>sanity-io/renovate-config:semantic-commit-type`
  - `security:minimumReleaseAgeNpm`
- `addLabels: ['{{{parentDir}}}']` auto-labels by directory (clean
  signal in a monorepo)
- `ignorePaths`: `**/dist/**`, `**/node_modules/**`, `**/test/**`,
  `packages/create/**/templates/**` (template fixtures aren't real
  deps)
- Notable package rules:
  - `@anthropic-ai/sdk` 0.x minor → automerge
    (`dependencyDashboardApproval: false`)
  - `bfra-me/renovate-config` GitHub tags pinned by SemVer, with
    `updatePinnedDependencies: true` only on major
  - `fetch-mock` capped `<12.0.0`
  - `@swc/**` scheduled every two weeks on Sunday
  - Mise manager disabled (mirrors [[bfra-me--github]] workaround)
- `patch.automerge: true`, `platformAutomerge: false`,
  `internalChecksFilter: 'flexible'`
- Post-upgrade tasks: `pnpm bootstrap`, `pnpm build`, `pnpm fix`
- Note: this repo extends `bfra-me/.github:internal.json5` directly,
  while the wiki's [[marcusrbrown--renovate-config]] is Marcus's
  parallel preset family. The two are organizationally distinct.

## Conventions (from AGENTS.md)

- TypeScript strict mode, `noUncheckedIndexedAccess`, no `any`, no
  `@ts-ignore`, no `@ts-expect-error`
- Pure ESM only (no `require()`, no `module.exports`)
- Explicit named exports; `export *` only inside `src/index.ts` barrel
- `Result<T, E>` from `@bfra.me/es/result` for expected errors —
  **never throw**
- Build output: `lib/` (tsup), `dist/` only for `@bfra.me/create`
- Tests in `packages/*/test/**/*.test.ts`; Vitest with
  `it.concurrent` and `expect.soft` where applicable; file snapshots
  via `toMatchFileSnapshot`
- Changesets required for publishable changes; patch/minor/major
  semantics with explicit rationale on majors
- Build order matters: `tsconfig` → `prettier-config` →
  `eslint-config` → all others (handled automatically by streaming
  `pnpm -r build`)
- Lint-staged on commit (husky); workflow files use `.yaml` (not
  `.yml`)
- Workspace dependency protocol: `manypkg.workspaceProtocol: require`

## Build, Test, Release

```bash
pnpm bootstrap                  # Install (prefer-offline)
pnpm validate                   # (type-check + lint + test) parallel → build → type-coverage
pnpm build                      # Streamed per-package + publint
pnpm test                       # Vitest run
pnpm dev / pnpm watch           # Parallel watch / build --watch
pnpm lint / pnpm fix            # manypkg check + ESLint (+ --fix)
pnpm type-check                 # tsc --noEmit
pnpm type-coverage              # type-coverage threshold check
pnpm analyze                    # workspace-analyzer CLI
pnpm inspect-eslint-config      # ESLint config inspector
pnpm clean                      # rimraf node_modules/lib/.turbo/tsbuildinfo
```

Release pipeline:

- `pnpm changeset` to create a changeset
- `pnpm version-changesets` → `clean-changesets` → `changeset version`
  → `pnpm bootstrap --no-frozen-lockfile` → `pnpm build` → docs
  version sync
- `pnpm publish-changesets` → `changeset publish`
- Driven by `release.yaml` on `workflow_run` after Main succeeds, with
  weekly Sunday schedule and dispatchable force-release toggle

## Cross-Repo Relationships

- **[[bfra-me--github]]** — the org control plane. Provides the
  reusable workflows this repo calls (`renovate.yaml@v4.16.37` as of
  2026-07-19, `update-repo-settings.yaml@v4.16.0`), the
  `internal.json5` Renovate baseline, and the `common-settings.yaml`
  Probot template. `bfra-me/works` leads the agent pin at `v0.93.1`,
  now tied with [[marcusrbrown--tokentoilet]]; sibling repos should be
  re-surveyed to confirm whether the org control plane and HA add-on
  template have followed the v0.9x train.
- **[[bfra-me--ha-addon-repository]]** — sibling `bfra-me` org repo.
  Shares the `Daily Autohealing Report` single-issue rolling-update
  convention, and also extends `.github:common-settings.yaml`. Stark
    contrast in update health: ha-addon-repository is review-deadlocked
    at agent v0.43.1 while `works` automerges its way to v0.83.0.
- **[[fro-bot--agent]]** — this repo runs `v0.93.1`, at the leading
  edge of the surveyed fleet; Renovate PR #3691 holds the pending
  v0 → v1 (`v1.18.0`) cutover, but that PR is dead (untouched since
  2026-06-14, ~31 minors behind the live pin) and should be closed and
  re-opened against a fresher v1.x.
- **[[marcusrbrown--renovate-config]]** — parallel Renovate preset
  family in the `marcusrbrown/*` ecosystem; `bfra-me/works` extends
  the `bfra-me/.github:internal.json5` baseline instead.
- **Downstream consumers** — `@bfra.me/eslint-config`,
  `@bfra.me/prettier-config`, `@bfra.me/tsconfig`, `@bfra.me/es`,
  `@bfra.me/semantic-release`, and `@bfra.me/workspace-analyzer` are
  referenced by name across the wider Fro Bot ecosystem. Surveys of
  downstream repos should cross-link back here when those packages
  surface as devDependencies.

## Open Questions / Follow-Ups

- The Fro Bot-authored PR backlog is still growing (11 → 12 open PRs by
  2026-07-19). Every stale/duplicate autoheal PR flagged on 2026-07-05
  is **still open and unmerged**: #3620 + #3724 (two copies of `docs:
  update AGENTS package count`), #3704 + #3713 (two copies of
  `fix(security): override esbuild to ^0.28.1`), #3508
  (`workspace-analyzer` peer ranges, now open ~7 weeks), #3619
  (create-templates vitest security bump), #3762 (undici override), and
  #3803 (lockfile metadata). No new autoheal remediation PRs appeared
  this window — instead the agent emitted a docs-only PR **#3973**
  (`docs: refresh agent workflow notes`, touches `AGENTS.md`), a third
  live variant of the AGENTS-package-count churn class alongside the
  two frozen copies. The dedup-against-existing-bot-items guard in
  `AUTOHEAL_PROMPT` still isn't reconciling against its own unmerged
  stale PRs. The esbuild override here mirrors the same HIGH advisory
  autoheal that [[bfra-me--github]] (PR #2292) landed cleanly; `works`
  still can't land its copy. The review pipeline, not the agent, is the
  bottleneck — and it has now held that state across three consecutive
  surveys.
- No npm publish since 2026-05-16 (**~9 weeks**) despite continuous
  dependency churn; package versions are byte-identical across six
  surveys. **Contradiction resolved (2026-07-19):** the 2026-07-05
  Changesets publish PR **#3854** did **not** merge — it was closed
  unmerged the same day it opened. The prior survey's "first staged
  publish, watch whether it merges" signal resolves to a non-event.
  A fresh publish PR **#3972** (`chore(🦋📦): publish packages`) opened
  2026-07-19; the publish pipeline restages the changeset each cycle
  but the human merge never happens. The drought is a review-gate
  artifact, not a tooling gap — same failure mode as the autoheal
  backlog above.

- The `docs` package uses Astro Starlight; its quality infrastructure
  (MDX lint, content tests, version-badge sync) is sophisticated
  enough to warrant a future `astro-starlight` topic page if a second
  ecosystem repo adopts the same pattern.
- `@bfra.me/workspace-analyzer` is the only published static-analysis
  tool in the ecosystem and runs as a non-blocking CI job here. Worth
  tracking adoption elsewhere — if [[bfra-me--github]] or sibling
  repos start invoking it, a dedicated tool page is justified.
- The Probot settings landscape now has the `bfra-me/works` row added
  to the `bfra-me/.github:common-settings.yaml` consumer list. See the
  [[probot-settings]] follow-up about reconciling `bfra-me` and
  `fro-bot` org templates.

## Survey History

| Date       | SHA       | Notes                                                                                          |
| ---------- | --------- | ---------------------------------------------------------------------------------------------- |
| 2026-05-20 | `ef14b26` | Initial survey. `fro-bot/agent@v0.44.2`, 11 workflows, 8 published packages + docs site, manypkg-enforced workspace protocol. |
| 2026-05-31 | `cd4a52d` | Re-survey. `fro-bot/agent` v0.44.2 → v0.47.0 (via v0.46.1, same day 2026-05-30). PR #3491 patched dispatch/reusable-call mode resolution in the inline shell. `bfra-me/.github` reusable workflows + `internal.json5` baseline v4.16.18 → v4.16.21. pnpm 10.33.4 → 10.34.1. Published package versions unchanged. Workflow inventory, package layout, Probot settings, branch protection, build/release pipeline all identical. Open PRs 1 → 2. |
| 2026-06-11 | `499b215` | Third survey. `fro-bot/agent` v0.47.0 → v0.60.0 (13 automerged bumps in 10 days — fastest agent cadence in the fleet). `bfra-me/.github` reusable renovate workflow + `internal.json5` baseline v4.16.21 → v4.16.25 (`update-repo-settings` still v4.16.0). Node 24.15.0 → 24.16.0. Changesets publish PR #3652 pending (`@bfra.me/create@0.7.15` + sibling patches); last actual npm release still 2026-05-16. Three Fro Bot-authored PRs open (#3508 workspace-analyzer peer-range fix, #3619 security template bump, #3620 docs). Workflow inventory, layout, workspace config, conventions all unchanged. Open PRs 2 → 4. |
| 2026-06-22 | `fb5c298` | Fourth survey. `fro-bot/agent` v0.60.0 → **v0.75.0** (another 15-minor automerge jump in 11 days; still fleet pin leader). **Pending v0 → v1:** Renovate PR #3691 proposes `v0.62.0 → v1.18.0`, open and un-automerged. `bfra-me/.github` reusable renovate + `internal.json5` v4.16.25 → v4.16.28. Node 24.16.0 → 24.17.0; pnpm 10.34.1 → 10.34.4. `fast-uri` override migrated to root `package.json`; `undici` floor `^6.24.0 → ^8.0.0`. New root files: `.git-blame-ignore-revs`, `.mailmap`, `.playwright-mcp/`, `json`; `mise.toml` → `.mise.toml`. All nine published package versions unchanged (no publish since 2026-05-16). Fro Bot PR backlog grew to 5+ with **duplicate** security/docs PRs (#3704/#3713 esbuild, #3620/#3724 docs) — autoheal re-emitting fixes the review pipeline never merges. Stars 3 → 4; open 38 issues / 7 PRs. Workflow inventory, branch protection, Probot settings, conventions otherwise unchanged. |
| 2026-07-05 | `b00229c` | Fifth survey. `fro-bot/agent` v0.75.0 → **v0.83.0** (steadier 8-minor drift; still fleet pin leader). **First major pnpm bump:** `packageManager` 10.34.4 → **11.9.0**; `pnpm-workspace.yaml` gained an `allowBuilds` block mirroring `onlyBuiltDependencies`. Node 24.17.0 → 24.18.0. `bfra-me/.github` reusable renovate + `internal.json5` v4.16.28 → v4.16.33. Root files `LICENSE.md`/`README.md` now lowercase `license.md`/`readme.md`; stray `json` file identified as a Changesets snapshot blob. Pending v1 PR #3691 has gone **stale** (untouched since 2026-06-14, drifting from both the v0.83.0 live pin and the current v1.x tag). All nine published package versions still byte-identical (no npm publish since 2026-05-16, ~7 weeks) — **but** Changesets publish PR **#3854** now open (2026-07-05), first staged publish in the window. Fro Bot PR backlog 7 → 11: prior duplicates (#3620/#3724, #3704/#3713) all still open; two new security PRs #3762 (undici) + #3803 (lockfile metadata). Branch protection, Probot settings, workflow inventory, conventions unchanged. |
| 2026-07-19 | `cf8689a` | Sixth survey. **No structural change** — 13 workflow files (11 + fro-bot + doc), 9 published packages + docs, layout, workspace config, Probot settings, branch protection, conventions all confirmed durable. `fro-bot/agent` v0.83.0 → **v0.93.1** (10-minor automerge drift; now tied with [[marcusrbrown--tokentoilet]] at the fleet lead). pnpm 11.9.0 → **11.13.1** (11.12.0 → 11.13.1 within the window; HEAD is the 11.12.0 bump #3940). Node 24.18.0 unchanged. `bfra-me/.github` reusable renovate + `internal.json5` v4.16.33 → **v4.16.37** (`update-repo-settings` still v4.16.0). **Publish contradiction resolved:** prior PR #3854 was **closed unmerged** (never landed); fresh publish PR **#3972** opened 2026-07-19 — all nine package versions still byte-identical, ~9-week drought unbroken. Pending-v1 PR #3691 still untouched since 2026-06-14 (~5 weeks, ~31 minors behind live pin) — now a dead proposal. Fro Bot PR backlog 11 → 12: all prior stale/duplicate PRs still open; new docs-only PR #3973 (`AGENTS.md`) is a third live variant of the package-count churn class. Open issues flat at 38; stars 4. |
