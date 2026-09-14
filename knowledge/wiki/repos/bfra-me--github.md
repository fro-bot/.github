---
type: repo
title: bfra-me/.github
created: 2026-05-20
updated: 2026-09-14
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
  - url: https://github.com/bfra-me/.github
    sha: 1b219902fd37d2f4206a9505e3cda8dabba786e0
    accessed: 2026-08-30
  - url: https://github.com/bfra-me/.github
    sha: a4180e7c31b3738c29fa3906902ec45e35d42a30
    accessed: 2026-09-14
tags:
  - bfra-me
  - dotgithub
  - monorepo
  - pnpm
  - typescript
  - github-actions
  - probot
  - renovate
  - template
  - contract-testing
related:
  - bfra-me--ha-addon-repository
  - bfra-me--renovate-action
  - marcusrbrown--github
  - marcusrbrown--renovate-config
  - marcusrbrown--infra
  - bfra-me--works
  - fro-bot--agent
  - marcusrbrown--tokentoilet
  - marcusrbrown--sparkle
  - github-actions-ci
  - probot-settings
node_id: R_kgDOHBEXpg
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

**2026-09-14 headline.** The org control plane is now the fleet's
best-documented instance of the delivery-mode break — and the only one
where the daemon root-caused its own paralysis in public, in writing, for
ten consecutive days, and could not act on the diagnosis because the
instruction blocking it outranks the instruction telling it to ship. Two
independent halves of the same interval:

1. **The daemon writes fixes that evaporate.** Every scheduled run edits
   the same three files, re-applies the same CodeQL fix, and ends. The
   tree at HEAD independently confirms none of it landed. See
   [The delivery-mode layer conflict](#the-delivery-mode-layer-conflict-2026-09-14).
2. **The human, meanwhile, shipped the strongest settings-sync work in
   the wiki.** Six `marcusrbrown` commits — five of them `fix(…)` —
   including applied-state read-back verification and diagnosable API
   failures for `update-repository-settings`, which is the first
   engineered answer to the long-running *a declared manifest is not an
   applied one* thread on [[probot-settings]]. See
   [Settings-sync diagnosability](#settings-sync-diagnosability-and-applied-state-read-back-landed-2026-09-04).

Read together: the repo's *manual* throughput is the highest recorded
here, and its *automated* throughput is zero. The first survey where
those two facts are simultaneously true.

## Identity

- **Owner:** bfra-me (org)
- **Visibility:** public, template repository
- **License:** MIT
- **Default branch:** `main`
- **Created:** 2022-03-17
- **Last push:** 2026-09-14 (HEAD commit `a4180e7`, dated
  2026-09-14T07:02Z; was `1b21990` / 2026-08-30)
- **Package version:** `@bfra.me/.github` **v4.29.0** (private root; was
  v4.22.0 on 2026-08-30, v4.16.44 on 2026-08-06). **Seven minor releases
  in 15 days** — but the CHANGELOG shows every one of them is a Renovate
  bump: this repo's changeset policy classifies dependency-version
  updates as `minor`, so the root version number tracks *upstream release
  cadence*, not this repo's feature work. The five human `fix(…)` PRs of
  this window appear nowhere in the root CHANGELOG; they landed as
  **patch releases of the action packages** (`update-repository-settings`
  0.1.10 → **0.2.0** → **0.2.1**, `renovate-changesets` 0.2.46 →
  **0.2.47**). Reading the root version as a proxy for repo activity
  inverts the truth here.
- **Node:** **24.21.0** (`.node-version`; was 24.20.0 on 2026-08-30,
  24.18.1 on 2026-08-06, 24.18.0 through 2026-07-16, 24.17.0 on
  2026-06-20, 24.16.0 on 2026-06-10, 24.15.0 on 2026-05-20)
- **Package manager:** pnpm **11.26.0** (2026-09-14; was 11.24.0 on
  2026-08-30, 11.17.0 on 2026-08-06 — routine minor churn within the
  11.x line; the 10→11 boundary remains settled)
- **TypeScript:** 6.0.3, strict — **unchanged across all eight surveys,
  and deliberately frozen since 2026-08-30.** Still 6.0.3 at 2026-09-14,
  and the `allowedVersions: '<7'` rule still carries its exit condition.
  Worth noting against the fleet: [[marcusrbrown--dotfiles]] crossed
  `npm:typescript` to **7.0.2** in this same window, so the org control
  plane is now deliberately two majors behind a repo it does not govern.
  That is the pin working as designed, not drift — the annotation is what
  makes the difference legible. The v7 bump PRs open on 2026-08-06
  (#2526/#2527) are gone, replaced by an explicit Renovate rule
  (`allowedVersions: '<7'`) with the rationale *"typescript-eslint lacks
  TS7 support; remove once support lands."* The prior survey read this
  as a held-back queue item; it is now a recorded decision with an exit
  condition. See [Renovate](#renovate).
- **Open issues / PRs:** **4 / 0** (2026-09-14; was 4 / 2 on 2026-08-30,
  2 / 7 on 2026-08-06). **The PR queue is empty** — the first zero
  recorded on this page, and an outright inversion of the fleet, where
  [[marcusrbrown--tokentoilet]] parks six green one-line security PRs for
  29–48 days and [[marcusrbrown--sparkle]] ran a 15-deep autoheal backlog
  until 09-06. The four open issues are unchanged from the prior survey:
  #2344 (Daily Fro Bot Report), #7 (Dependency Dashboard), and the two
  human issues #2545 / #2546 — now **30 days old**, and the daemon's own
  09-13 report flags them as "approaching but not yet past the 30-day
  stale threshold." Note the quiet contradiction on #2545 ("Add test
  coverage for `scripts/release.ts`): `scripts/release.test.ts` and
  `scripts/vitest.config.ts` both exist at HEAD. Either the issue is
  satisfied and unclosed, or the coverage it asks for is narrower than
  the file that exists. An open issue is not evidence of missing work.
  Prior-survey text, retained: **4 / 2** (2026-08-30; was 2 / 7). The
  seven-deep major-bump queue **fully drained** — lint-staged v17,
  `actions/setup-node` v7, `actions/labeler` v7,
  `actions/dependency-review-action` v5, `fossas/fossa-action` v2 all
  landed; typescript v7 was closed in favour of the pin rule. Remaining
  open PRs are both routine `bfra-me[bot]` maintenance (#2642 publish
  release, #2640 internal action SHA pins). Open issues: the two durable
  bot surfaces #2344 (**Daily Fro Bot Report**) and #7 (Dependency
  Dashboard), plus **two new human-authored issues** — #2545 (add test
  coverage for `scripts/release.ts`) and #2546 (automate
  workflow-templates standards validation), both filed by `marcusrbrown`
  on 2026-08-15 alongside the refactor planning burst. These are the
  **first non-bot open issues** recorded here across seven surveys; the
  backlog is no longer purely machine-generated. Note the contrast with
  the fleet's propose-without-merge queues ([[marcusrbrown--sparkle]] at
  15 open PRs, [[bfra-me--works]] at 12) — this repo drains.

## Layout

Layout at HEAD `1b21990` (2026-08-30, 314 blobs). The `.ai/` corpus is
**gone** — see [AI planning corpus](#ai-planning-corpus-ai-removed-2026-08-30).

```
.
├── .husky/                             # Git hooks (pre-commit → pnpm exec lint-staged)
├── .github/
│   ├── actions/
│   │   ├── renovate-changesets/         # Auto-changeset Renovate PRs (75 src files; was ~125 pre-refactor)
│   │   ├── update-metadata/             # Repo metadata generator (1 src file)
│   │   └── update-repository-settings/  # Plugin-based settings sync (26 src files, incl. src/plugins/)
│   ├── instructions/                    # AI-consumed dev guides (changesets, GH Actions, pnpm, Renovate, TS)
│   ├── workflows/                       # 16 workflows: CI, Fro Bot, security, Copilot, renovate (was 17; autoheal-org merged into fro-bot.yaml 2026-07-02)
│   ├── codeql/
│   ├── auto-assign.yaml
│   ├── copilot-instructions.md
│   ├── gitleaks.toml
│   ├── labeler.yaml
│   ├── renovate.json5
│   └── settings.yml
├── workflow-templates/                  # Org-wide templates (.yaml + .properties.json pairs)
├── scripts/                             # 7 tsx utilities: release, build perf, workspace + TS-reference validation
├── docs/
│   ├── workflows/                       # Workflow docs and troubleshooting
│   ├── plans/                           # 3 plan docs (2 promoted from .ai/plan/, 1 dated refactor plan) — new 2026-08-30
│   ├── brainstorms/                     # Requirements docs — new 2026-08-30
│   └── solutions/                       # Compound-engineering learnings: README contract + 7 entries (was README-only)
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
├── .vscode/                             # extensions.json, settings.json, spellright.dict (first enumerated 2026-08-30)
├── llms.txt                             # AI-consumption manifest (present ≥2026-07-16, first enumerated 2026-08-06)
├── eslint.config.ts
├── internal.json5                       # Renovate internal config extended by .github/renovate.json5
├── mise.toml                            # Adds ./node_modules/.bin to PATH
├── package.json                         # `@bfra.me/.github` v4.22.0
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
- Overrides (HEAD 2026-08-30) — **grew 4 → 7**, the first override-set
  expansion since the esbuild remediation: `brace-expansion@<5.0.9` →
  `>=5.0.9` (**new**), `esbuild@>=0.17.0 <0.28.1` → `>=0.28.1`
  (security, PR #2292 — on `main` since 2026-06-25),
  `fast-uri@>=3.0.0 <3.1.5` → `>=3.1.5` (**new**), `flatted` pinned to
  `3.4.4` (was 3.4.3), `js-yaml@>=3.0.0 <3.15.1` → `3.15.2` (**new**),
  `undici@<6.27.0` → `>=6.27.0`, `vite@>=8.0.0 <=8.0.4` → `>=8.0.5`.
  The `brace-expansion` and `fast-uri` additions are the same transitive
  advisories that produced override entries at
  [[marcusrbrown--marcusrbrown-com]], [[bfra-me--works]], and
  [[fro-bot--dashboard]] — the fleet converged on the same two pins in
  the same window.
- **New key: `minimumReleaseAgeExclude:`** (2026-08-30) listing
  `@bfra.me/eslint-config@0.51.2 || 0.52.1` and
  `@bfra.me/prettier-config@0.16.10 || 0.16.11`. This is a
  **cooldown-bypass allowlist**: the org's own first-party configs are
  exempted from the install-time release-age quarantine that otherwise
  delays fresh npm versions. Notably, **no `minimumReleaseAge` value is
  declared anywhere in the surveyed files** — not in
  `pnpm-workspace.yaml`, not in `internal.json5`, and there is no
  `.npmrc` in the tree. The exclusion list therefore modifies a cooldown
  sourced from pnpm's own default or an unsurveyed location. Worth
  resolving next survey; an allowlist whose enabling setting isn't
  visible in-repo is the kind of config that quietly stops meaning
  anything after a package-manager upgrade.
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

Source-file counts at HEAD (2026-09-14): `renovate-changesets` 75 src /
45 test + contract tier, **`update-repository-settings` 32 src** (was 26
on 2026-08-30) / 13 colocated `__tests__`, `update-metadata` 1 src / 1
test. The +6 on `update-repository-settings` is the diagnosability work
below: `plugins/branch-protection-equivalence.ts`,
`plugins/branch-protection-shape.ts`, `plugins/error-detail.ts` and their
three test files.

Prior count (2026-08-30): `renovate-changesets` 75 src / 64 test,
`update-repository-settings` 26 src / 13 test, `update-metadata` 1 src /
1 test.

### Settings-sync diagnosability and applied-state read-back (landed 2026-09-04)

Two human PRs — **#2684** (`update-repository-settings` **0.2.0**) and
its same-day follow-up **#2687** (**0.2.1**) — plus a requirements doc
(`docs/brainstorms/2026-09-03-settings-sync-diagnosability-requirements.md`)
and a dated plan. This is the first **engineered** answer to the thread
[[probot-settings]] has been carrying for seven surveys: *a declared
manifest is not an applied one*.

**The trigger was a sibling repo, and the evidence is quantified.** The
requirements doc opens on [[bfra-me--ha-addon-repository]] failing
settings sync since 2026-08-24 — **14 of its last 60 runs, 23%** — every
sampled failure identical: `PUT /repos/.../branches/main/protection`
returning **500 after 8273 ms, 8234 ms, and 8324 ms** on three separate
days. What the operator saw was two lines, one of them an empty bullet:

```text
##[error]Failed to apply branches settings:
##[error]Failed to apply settings:
```

The status code and request ID were in the job log all along — Octokit's
bundled request logger emits them — but absent from the action's own
error, *"which is what an operator reads first and what any downstream
alerting would capture."* **A diagnostic that exists somewhere in the log
but not in the error object is not instrumented**; alerting reads the
error.

Design decisions worth carrying beyond this repo:

- **Diagnostics are the requirement; retry is a hypothesis.** The doc
  refuses to promote three same-duration failures to a finding: *"three
  samples cannot separate a fixed upstream timeout from queueing or a
  slow downstream dependency. A retry that succeeds after a delayed
  attempt falsifies it. If the hypothesis holds, retry repeats the
  failure at triple the cost; it ships because it is cheap and may help,
  and the diagnostics settle it."* Shipping an instrument and naming what
  would refute it, in the same document.
- **Read-back reports before it enforces.** R7: divergence is reported
  and **does not fail the run**, because GitHub's read shape differs from
  its write shape and gating on day one would manufacture false failures.
  Evidence first, gate second.
- **Normalize one side only.** `compareBranchProtection` sanitizes the
  *observed* read-back and leaves the *declared* config raw, with the
  reason stated in the source: *"normalizing both sides would let a bug
  in the normalizer distort intent and observation identically, hiding
  the exact class of bug this comparison exists to catch."* The general
  rule for any verifier: **never pass intent and observation through the
  same transform.**
- **Subset match, not equality.** Only fields the declared config
  mentions are compared, so GitHub adding a server-populated response
  field cannot produce false divergence. #2687 is the immediate proof
  this matters — it shipped the same day, to stop *representational*
  drift from reporting as real drift.
- **Redact before you truncate.** `error-detail.ts`: *"Structured bodies
  are redacted before truncation so a length bound can never expose a
  field the denylist would have removed."* Ordering bug that would
  otherwise be invisible until the one pathological body arrives.
- **Allowlist headers, don't denylist them.** Only
  `x-github-request-id` survives; *"every other header (including
  `authorization`) is dropped, never merely hidden. Serializing
  `error.response.headers` wholesale would turn a diagnostic into a
  header dump."* The denylisted body keys are named and scoped by
  meaning, not pattern: `slug`, `login`, `id`,
  `bypass_pull_request_allowances`, `dismissal_restrictions`.
- **Scope the verification to where the failures are.** R8 confines
  read-back to branch protection; repository/labels/teams are explicitly
  *not* read back, *"informed by whether the first implementation
  produces signal or noise."*
- **Split the unrelated cleanup out.** The deprecated `app-id` input on
  `actions/create-github-app-token` spans eight workflow files and ships
  separately, because *"coupling them would put an eight-file rename in
  the same review as a bugfix."*

The doc is also honest about its own limits: the 500 body *"may itself be
empty — that is the likely reason `err.message` is empty today. If so, R2
yields nothing and the diagnostic value comes from R3 and R5 instead."*
Requirements that pre-register which of them might return nothing.

Cataloged as a cross-cutting pattern in [[probot-settings]].

### `renovate-changesets` dedup survivor bug (#2682, 2026-09-03)

Action **0.2.47**: *"Keep the representative changeset when semantic
deduplication removes a similar sibling."* A deduplicator that removed
the survivor along with the duplicates — the same family as the
`changeset-dedup-ignored-summaries` learning already in
`docs/solutions/logic-errors/`. Two dedup defects in one subsystem in
three weeks is a signal about the subsystem, not about either bug: the
post-refactor pipeline's identity notion for "the same change" is still
being discovered empirically.

### `renovate-changesets` simplification (landed 2026-08-15 → 08-19)

**The one structural change of this window, and the largest single
refactor observed in this repo.** The action's version is `0.2.45`.

Deleted wholesale:

- **`src/detectors/` (~40 files)** — a per-ecosystem breaking-change
  detection layer covering Docker (compose analyzer, file parser, image
  and version comparators), GitHub Actions (workflow parser, change
  analyzer, version comparator), Go, JVM (Gradle/Maven/properties
  parsers), npm (package + lockfile parsers, version comparator),
  Python (requirements parser, package-manager analyzer), and security
  advisories (parser, patterns, severity classifier), plus the
  `breaking-change-{analyzers,patterns,synthesizer}` trio.
- **`src/summaries/` (~11 files)** — a template-context/summary-builder
  layer (`ci-`, `infrastructure-`, `js-ecosystem-`, `jvm-ecosystem-`,
  `manager-`, `structural-summaries`, `summary-contexts`,
  `summary-helpers`, `template-context-builders`).
- The seven `src/*-change-detector.ts` façades, `detector-runner.ts`,
  `changeset-template-engine.ts`, and their nine matching test files.

Replaced by a much smaller pipeline: `classify/renovate-classifier.ts`,
`extract/renovate-body-extractor.ts` + `extract/non-package-renovate-operation.ts`,
`format/changeset-summary-formatter.ts`, `changesets-release-policy.ts`,
and `compatibility-adapter.ts` (with `detectors/security-vulnerability-types.ts`
renamed up to `src/analysis-types.ts`). Net: **src 125 → 75 files.**

The refactor was planned in-repo rather than improvised — a requirements
doc (`docs/brainstorms/renovate-changesets-simplification-requirements.md`)
and a dated plan (`docs/plans/2026-08-15-001-refactor-renovate-changesets-simplification-plan.md`)
both landed with it, and five `docs/solutions/` entries record what broke
along the way.

### Consumer-fixture contract testing (new tier, 2026-08-19)

The refactor shipped with a **second Vitest project**
(`vitest.contract.config.ts`) and a `test/contract/` tree — 12
non-fixture files (10 `*.contract.test.ts` scenarios + `setup.ts` +
`changesets-oracle.ts`, 25 tests) plus 19 fixture files. This is the
durable artifact, more interesting than the deletion.

The action is *developed* here but *executes in other repositories*, so
its real contract is far wider than this repo's build: consumer bot
identity, Renovate PR body dialect, workspace topology, dependency-install
state, and `.changeset/config.json` semantics. The repo's own learning
doc is blunt about the prior failure mode: an earlier slimming pass was
*"scoped by local reachability — it mapped what could be deleted here,
never modeling the environment the action actually runs in"*, and
`marcusrbrown/infra` correctness was *"an aspiration, never a gate."*

Six assumptions that were true here and false in consumers, now
executable as tests:

1. Renovate always runs as `renovate[bot]` — consumers also use
   `bfra-me[bot]` and `mrbro-bot[bot]`.
2. Docker references always carry full digests — consumers supply short
   SHAs.
3. `@changesets/write` succeeds because dependencies are installed —
   consumer workspaces have no `node_modules` at that point.
4. An affected package is always listed in a manifest.
5. Every workspace package is releasable.
6. One grouped Renovate PR has one package manager.

Mechanics worth copying:

- **Fixtures model real downstream repos.** `test/contract/fixtures/`
  carries `bfra-github/` (this repo's own 4-package shape) and
  `marcusrbrown-infra/repo/` — a deliberately hostile replica of
  [[marcusrbrown--infra]] with `apps/*`/`packages/*`/`libs/*`
  workspaces, an unresolvable prettier config, versionless
  `apps/cliproxy` and `apps/vpn`, a `.changeset/config.json` that
  ignores a package while enabling private-package versioning, and a
  `packages/shared` with real dependents so both propagation and
  exclusion are exercised.
- **Enter through the real `run()` in `src/run.ts`, never `index.ts`** —
  importing `index.ts` executes the action as an import side effect.
- **Real temp workspaces**, copied per scenario with
  `fs.cp(..., {recursive: true})`.
- **Deliberately narrow mock boundary.** Only `@actions/core`,
  `@octokit/rest`, and a single exec lookup are stubbed;
  `getExecOutput` accepts exactly `git rev-parse --short HEAD` and
  **throws on anything else**, so an unplanned shell-out fails loudly
  instead of silently returning a mock default.

Cataloged as a cross-cutting pattern in [[github-actions-ci]].

## Workflows (16)

```
auto-release.yaml          codeql-analysis.yaml         container-scan.yaml
copilot-setup-steps.yaml   dependency-review.yaml       fro-bot.yaml
license-compliance.yaml    main.yaml                    pr-triage.yaml
renovate-changeset.yaml    renovate.yaml                scorecard.yaml
secret-scan.yaml           trigger-org-renovate.yaml    update-metadata.yaml
update-repo-settings.yaml
```

**2026-09-14:** same 16 names, **sixth consecutive survey with no
workflow added or removed.** One workflow *body* change this window, the
first since 2026-07-02 that is not SHA-pin maintenance: `fro-bot.yaml`
gained a conditional `persist-credentials` expression (#2717) — see
[Credential scoping on content triggers](#credential-scoping-on-content-triggers-2717-2026-09-11).
What it did *not* gain is a post-agent commit/push/PR step, which is the
whole of this survey's central finding.

Prior: workflow set re-verified byte-identical at 2026-08-30 (same 16 names).
All 16 files were *modified* across the window, but by SHA-pin
maintenance only — no trigger, job, or permission changes observed in
`fro-bot.yaml`, and no workflow added or removed. Five survey windows of
structural stability in the control plane.

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
autoheal sweep.

**2026-09-14 pin and daemon health.** `fro-bot/agent@5494812 # v0.112.0`
(was v0.106.1 on 2026-08-30) — **~6 more minors in 15 days, ~74 bumps in
~4 months**, and still the ecosystem version leader, ahead of
[[marcusrbrown--sparkle]] (v0.111.0) and [[marcusrbrown--dotfiles]]
(v0.109.4). Runner pins advanced to `pnpm/action-setup@ea17c68 # v6.1.0`;
`actions/checkout@3d3c42e # v7.0.1` and `actions/setup-node@8207627 #
v7.0.0` hold. `OPENCODE_PROMPT_ARTIFACT: 'true'` persists.

Scheduled daemon health, last 30 `schedule` runs (225 lifetime):
**28 success / 2 failure** (09-12 and 09-06; 08-23 the one before that).
Green by conclusion. See the next section for why that number measures
nothing that matters.

Two scheduling observations that only show up when you query `?event=schedule`
rather than reading a flat run list:

- **Cron start-time drift.** The cron is `30 15 * * *`. Actual starts
  moved from **15:46** (08-15, +16 min) to **16:04** (08-24, +34 min) to
  **18:43** (09-01, +3h13m) to **18:17** (09-13, +2h47m). A "daily 15:30
  pass" now routinely begins after 18:00 UTC. GitHub's scheduled-run
  queue deprioritizes busy repos, and this repo fires **7,559 workflow
  runs** on `fro-bot.yaml` alone.
- **A dropped day and a doubled day.** No scheduled run on 2026-08-27;
  two on 2026-08-29 (00:03 and 18:45). A daily cron is a best-effort
  request, not a guarantee, and any "N consecutive days" claim built on
  cron alone will be wrong on a repo this loud.

A third observation belongs to the **trigger surface, not the daemon**:
the 40 most recent `fro-bot.yaml` runs are **40/40 `skipped`** — all
`pull_request` and `issues` events from `bfra-me[bot]`, filtered by the
workflow's own `[bot]` author guard. Same shape as
[[marcusrbrown--tokentoilet]]'s 98-of-100. On a repo whose content
traffic is ~100% Renovate, the reactive half of the daemon is
structurally inert and the scheduled half is the entire product. A flat
`gh run list` on this repo reaches back roughly half a day and can see
**none** of the scheduled runs — the exact sampling trap recorded in
[[github-actions-ci]].

Prior-survey pin record (2026-08-30):

- `fro-bot/agent@d8c47fdac44f39f6ef8fb4bab65609c6e645c58d # v0.106.1`
  (was v0.96.0 on 2026-08-06, v0.92.1 on 2026-07-16, v0.81.0 on
  2026-07-02, v0.71.0 on 2026-06-20, v0.59.1 on 2026-06-10, v0.44.2 on
  2026-05-20). Cumulative: **~68 agent bumps in ~3.5 months**. HEAD
  itself is the pin bump (`chore(deps): update fro-bot/agent to v0.106.1
  (#2656)`). **Sole ecosystem version leader** at this survey — ahead of
  [[marcusrbrown--dev-like]] and [[marcusrbrown--sparkle]] (v0.105.1),
  [[marcusrbrown--dotfiles]] and
  [[marcusrbrown--opencode-copilot-delegate]] (v0.105.0). Consistent
  with the pattern that the org control center absorbs agent releases
  first.
- The agent step gained a new env var: **`OPENCODE_PROMPT_ARTIFACT: 'true'`**,
  which opts this repo into uploading the resolved prompt as a run
  artifact. Given that the prompt is assembled at runtime from
  `PR_REVIEW_PROMPT`/`AUTOHEAL_PROMPT` plus an optional `TARGET_REPO`
  suffix, this makes the *actual* instruction text auditable after the
  fact rather than reconstructable from workflow source. First observed
  use of this flag in the surveyed ecosystem.
- Runner action pins at HEAD: `actions/checkout@3d3c42e # v7.0.1`,
  `pnpm/action-setup@0977fd9 # v6.0.10`,
  `actions/setup-node@8207627 # v7.0.0` (the v7 major from the
  2026-08-06 held-back queue, now landed).

### The delivery-mode layer conflict (2026-09-14)

**The finding of this survey, and the sharpest instance of the
delivery-mode class anywhere in the wiki.** Prior cases were silent: at
[[marcusrbrown--tokentoilet]] a fully-permissioned daemon simply wrote
nothing for a month and nobody noticed; at [[fro-bot--dashboard]] and
[[marcusrbrown--sparkle]] the missing half was added once diagnosed. Here
the daemon **diagnosed itself, in public, correctly, ten times**, and the
diagnosis changed nothing — because the instruction that blocks it
outranks every instruction telling it to ship.

**Two authoritative delivery contracts, in direct contradiction.**

- `fro-bot.yaml`'s `AUTOHEAL_PROMPT` carries a **DELIVERY CONTRACT (READ
  THIS — REQUIRED)** block, added 2026-08-30, whose five numbered steps
  are branch → commit → push → `gh pr create` → dedupe, closing with:
  *"The agent that writes the fix is the agent that ships it. Do not
  delegate the push/PR to a 'caller workflow' — there is none."*
- The harness-injected **Delivery Mode** block resolves `schedule` runs
  to `working-dir` and forbids `git branch` / `git commit` / `git push` /
  `gh pr create` / `gh pr merge`, stating *"the caller workflow owns diff
  detection, commit, push, and pull-request creation after this action
  completes."*

The prompt's claim is **true** — `fro-bot.yaml` is 586 lines and its last
step is `Run Fro Bot` at line 576; there is no post-agent step of any
kind. The harness's claim is **false**. The false one wins, because it is
operator-level and the agent correctly honors that precedence. The result
is a daemon holding `FRO_BOT_PAT` and a full checkout that is contractually
forbidden from using either.

**The measured cost, verifiable from the tree without reading a log.**
Three files are re-edited every scheduled run and none of them has ever
landed. At HEAD `a4180e7`:

| Fix | Independent check at HEAD | Verdict |
| --- | --- | --- |
| CodeQL #53 dead assignment, `scripts/validate-type-only-imports.ts:117` | `let type: ImportDeclaration['type'] = 'regular'` still present | not landed |
| `AGENTS.md` stale src-file count for `renovate-changesets` | line 15 still reads `(125 src files)`; actual is **75** | not landed |
| `scripts/workspace-validate.ts` extends-chain / JSONC / regex / private-package fixes | reported 65% → 100% health every run | not landed |

The 09-13 report calls it the **"10th consecutive run re-applying this
fix"** and states all three *"had silently reverted since the last
report."* They did not revert. They were never committed. The daemon's
own model of its failure is off by one layer — it is describing an
absent write as a rollback — which is itself worth recording: an agent
that cannot observe its own delivery step will narrate the gap as
regression.

**This also resolves the 2026-08-30 open question** *"Is autoheal
category 5b actually running?"* — the one asking why the `AGENTS.md`
"125 src files" claim survived ~11 days of daily passes. **Answer: the
check runs, finds it, and fixes it every single day.** Neither of the two
hypotheses on offer (silent ✅ over stale data / ⚠️ with no PR) was right;
the failure is downstream of both, at delivery. Record the shape: *a
detection gap and a delivery gap look identical from the artifact.*

**What the daemon got right, and what it could not do.** The 09-12 report
is a model of agent self-instrumentation: it ran `git log --oneline -5`
on the three paths at run start, confirmed no related commit,
independently re-confirmed CodeQL #53 `open` via the API, then left an
explicit instruction for its successor — *"`.github/workflows/fro-bot.yaml`
… has been directly re-confirmed to contain no post-agent commit/push/PR
step in at least 3 prior runs — **do not re-read that workflow file
again**"* — and redirected the next run to inspect the `fro-bot/agent`
action's own execution logs instead of "re-applying the same fix a 10th
time without new information." It then re-applied the fix a 10th time,
because that is the only action its contract permits. It also states the
constraint precisely: *"Do not attempt to fix this by changing the
agent's own delivery instructions — the Delivery Mode block is
operator-controlled and takes priority per `harness_rules`."*

**The asymmetry that makes this worth generalizing.** The `working-dir`
restriction is scoped to the **checked-out repository**, and the daemon
found the seam: on 09-11 it delivered a real org-wide fix —
`bfra-me/renovate-config` PR #1558, a missing-`permissions` Scorecard
finding — *"via GitHub API + a temporary local clone in `/tmp` (no local
git/PR operations were performed against this repo's own checkout)."*
So the org control plane can ship a fix to every repo in the org **except
the one it is running in**. A delivery restriction expressed as a ban on
local git verbs restricts the *mechanism*, not the *capability*, and the
repo it actually protects is the one you least meant to freeze.

**A correctness inversion inside the report itself.** Compare two dated
sections of #2344 on an unchanged file:

- 09-11: *"`AGENTS.md` src-file-count is now accurate (75) — **this
  landed since the last report**."*
- 09-13: *"`AGENTS.md`'s stale '125 src files' count … **had silently
  reverted** since the last report."*

`AGENTS.md` at HEAD says `125`. The 09-11 line is simply wrong, and it is
wrong in the direction that closes the investigation. Second confirmation
of *a prose-driven audit is a sampling process, not a lint*
([[github-actions-ci]]), now with an independently falsifiable instance:
the claim was checkable against one line of one file in the same
repository the agent had checked out.

**And the conclusion signal is inverted in both directions in one
12-day window.** Cross-referencing scheduled-run conclusions against the
dated sections actually written to #2344:

- **09-12 concluded `failure`** and *has* a full report section.
- **09-10 and 09-05 concluded `success`** and have **no section at all**.

A red run that delivered, and two green runs that did not. The fleet rule
*a run's conclusion measures the harness, not the deliverable*
([[marcusrbrown--cortexkit-anthropic-auth]], [[marcusrbrown--github]]) is
usually demonstrated one direction at a time. Here both inversions sit on
the same workflow, inside a fortnight.

**Report hygiene: the rotation works and the body is still 144 KB.** The
prompt bounds the issue by *age* — sections older than 14 days collapse
into a single `## Historical Summary`. It is honored: nine dated sections
plus one Historical Summary, no duplicate summary. Body size:
**143,241 characters**, because each daily section runs ~10 KB. Compare
[[marcusrbrown--cortexkit-anthropic-auth]], where a 54,813-char body
against a 50,000-char soft budget is the leading suspect for a daemon
that went quiet. **A section-count rotation is not a size budget**, and
this repo's prompt declares no byte bound at all. The rotation directive
is doing exactly what it says and nothing that constrains the failure
mode it looks like it constrains.

**Smallest safe fix, as the daemon itself specified it:** add a post-agent
step to `fro-bot.yaml` that runs `git status --porcelain`, and on
non-empty output branches, commits, pushes, and opens a PR. The repo
already SHA-pins everything and has `FRO_BOT_PAT` on the checkout, so
this is additive. [[marcusrbrown--sparkle]] shipped the strongest
version of this repair on 09-06 (#2001/#2003): a single `Resolve delivery
mode` gate step feeding **both** the agent's `output-mode` and the
conditional credential restore, so the decision cannot be expressed twice
and disagree with itself. That is the pattern to copy here.

### Credential scoping on content triggers (#2717, 2026-09-11)

A human `fix(ci)` PR — *"withhold checkout credentials on affected
triggers"* — made `persist-credentials` conditional:

```yaml
persist-credentials: >-
  ${{ !contains(fromJSON('["pull_request", "issue_comment", "issues"]'), github.event_name) }}
```

The reasoning is sound and matches the fleet's direction of travel
(cf. [[marcusrbrown--infra]]'s two-job disjoint-capability split, where
the attacker-reachable job is the read-only one). **But the denylist
names three of the five content triggers.** `pull_request_review_comment`
and `discussion_comment` still persist `FRO_BOT_PAT` into `.git/config`.

The split is not explained by trust gating: all three comment triggers
pass through the *same* `author_association` check
(`OWNER`/`MEMBER`/`COLLABORATOR`) and the same `@fro-bot` mention
requirement — yet `issue_comment` is denied credentials and its two
siblings are not. Whatever the intended rule was, the expression does not
encode it. **A security control written as an enumeration of event names
silently omits the events nobody was thinking about**; the safer shape is
an allowlist of the triggers that *need* credentials (`schedule`,
`workflow_dispatch`, `workflow_call`), which is a closed set of three and
fails safe when a new trigger is added to `on:`.

Filed as an observation, not a live exploit: the mention gate still
requires a repository-associated principal.

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

**Re-confirmed durable (2026-08-30):** fourth consecutive survey with no
structural regression to the *shape* — one `fro-bot.yaml`, two
`review`/`autoheal` modes (`default: autoheal`), single `30 15 * * *`
unified pass, `target-repo` narrowing input, `cancel-in-progress: false`,
`permissions: contents: read` at workflow level, and the same
author-association gate (`OWNER`/`MEMBER`/`COLLABORATOR` for `@fro-bot`
mentions, bot-authored events excluded, forks excluded). The
consolidation is now **five-window steady state**. The *prompt body*,
however, changed substantially — see below.

### Autoheal prompt expansion: 8 → 10 categories (2026-08-30)

The category taxonomy grew for the first time since the 2026-07-02
consolidation. Categories 1–6 remain this-repo, 7–8 remain org-wide, and
two new **report-only** categories were appended:

- **9. CROSS-PROJECT INTELLIGENCE** — scan sibling repos (`bfra-me/works`,
  [[bfra-me--renovate-action]], and tracked `fro-bot` repos) for
  automation patterns, prompt strategies, or workflow improvements
  adoptable here or org-wide. Report only; no changes.
- **10. PROGRESSIVE IMPROVEMENT** — durable improvement opportunities:
  tool-version drift in `package.json` (ESLint, Prettier, TypeScript,
  Vitest more than a minor behind), missing or degraded CI jobs,
  convention drift from AGENTS.md, stale TODO/FIXME. Report only.

Both are recognizable as *the surviving half* of deleted `.ai/plan/`
proposals — "org-health monitoring" and "production-readiness
validation" reduced from systems-to-build into prompt categories that
emit a table row in the daily report. That is a strictly cheaper way to
buy the same signal, and a fair trade to note when evaluating whether an
aspirational plan corpus was "lost."

Categories 3 and 4 were also renamed to **ACTION & WORKFLOW INTEGRITY**
and **CODE QUALITY & MONOREPO HEALTH** — the same "WORKFLOW INTEGRITY"
naming [[marcusrbrown--infra]] adopted when it went 8 → 10 categories on
2026-08-16. Two repos, same window, same expansion count, converging
vocabulary.

### New autoheal guardrails (2026-08-30)

Five additions to `AUTOHEAL_PROMPT`, all of which generalize:

- **TRUSTED AUTHORS gate.** *"Only repair a PR branch authored by the
  repository owner/a collaborator with write access, or an approved
  automation bot (`renovate[bot]`, `dependabot[bot]`, `fro-bot`). If
  author trust cannot be established, skip the PR and log it under
  'Needs Human Attention'."* An agent with push access to PR branches is
  an agent that can be steered by anyone who can open a PR; this makes
  provenance a precondition rather than an assumption.
- **Poisoned-branch execution guard.** *"If the PR touches workflows,
  automation prompts, package-manager config, lockfiles, or execution
  scripts, do not run project commands from that branch. Skip it and log
  why."* This is the sharper of the two — trusting the *author* is not
  enough, because the autoheal flow's remedy is to run `pnpm bootstrap` /
  `pnpm build` / `pnpm run quality-check` from the branch under repair.
  A lockfile or postinstall change in a "trusted" PR would execute on a
  runner holding `FRO_BOT_PAT`. Naming the exact file classes that make
  a branch unsafe to *execute* (as distinct from unsafe to *merge*) is
  the correct boundary and one most autoheal prompts in the fleet do not
  draw.
- **Tool-skepticism on missing data.** *"If security advisory/alert data
  is unavailable to the token or CLI, skip this category and note
  'security alerts unavailable' under 'Needs Human Attention'. Do not
  guess."* Same family as [[marcusrbrown--dev-like]]'s dead-code
  clause: absence of a signal is not a clean signal.
- **DELIVERY CONTRACT.** An explicit, numbered branch → commit → push →
  `gh pr create` obligation, closing with *"The agent that writes the fix
  is the agent that ships it. Do not delegate the push/PR to a 'caller
  workflow' — there is none."* This reads as a scar: a single-step agent
  that writes a correct fix to disk and ends the run produces a green
  build and zero delivered work. It is the same class of failure as the
  `gh --body`/`@path` footgun recorded in [[github-actions-ci]] — the
  *delivery* leg silently doing nothing.
- **Guardrail-preservation clause.** *"Never make checks pass by
  disabling tests, deleting failing assertions, lowering coverage
  thresholds, weakening lint/type rules, or editing workflows/
  configuration only to suppress failures… If the smallest safe fix
  would weaken a guardrail or reduce validation, skip it and log it."*
  The failure mode this blocks — an agent optimizing for a green check
  rather than a working repo — is the single most predictable way an
  autoheal daemon destroys value.

Two further hygiene rules:

- **Bounded report issue.** After prepending the daily section, sections
  older than **14 days** collapse into a single `## Historical Summary`
  listing prior-run count and items unresolved across them, updated in
  place. Perpetual rolling issues otherwise grow without limit; this is
  the first explicit bound observed in the fleet.
- **AGENT NOTES.** *"Do NOT create follow-up tasks addressed to a
  specific agent (Fro Bot, Copilot, etc.)."* Deferrals must be written
  cold-readable — exact paths, root cause, smallest safe fix,
  "do not retry" warnings, and how to verify. Deferred work addressed to
  a named agent is work addressed to nobody.

### AI planning corpus (`.ai/`, REMOVED 2026-08-30)

> **Resolved:** the 2026-08-06 note asked whether any `.ai/plan/` doc
> would "graduate from `.ai/plan/` into real workflows." The answer
> arrived as a deletion. `.ai/` no longer exists. **One** plan shipped
> (`feature-enhanced-renovate-changesets-action-1.md` → promoted to
> `docs/plans/enhanced-renovate-changesets-action.md` and executed as the
> simplification refactor above); **one** was retained as a plan
> (`infrastructure-monorepo-build-optimization-1.md` →
> `docs/plans/monorepo-build-optimization.md`); the remaining **eight
> were deleted outright**, along with the `implementation-plan-prompts.md`
> index:
>
> - `architecture-cross-platform-bridge-1.md`
> - `architecture-template-federation-system-1.md`
> - `feature-astro-starlight-docs-platform-1.md`
> - `feature-intelligent-workflow-generation-1.md`
> - `feature-release-testing-infrastructure-1.md`
> - `feature-workflow-validation-system-1.md`
> - `infrastructure-org-health-monitoring-1.md`
> - `infrastructure-production-readiness-validation-1.md`
>
> The two most remit-expanding proposals — **multi-org template
> federation** and **org-health monitoring** — are among the deleted.
> The prior survey's caution that these "would substantially expand this
> repo's remit beyond settings/workflow distribution into active
> cross-org governance" is now moot: that direction was abandoned rather
> than pursued. Read as a pruning of aspirational scope, not a loss —
> the surviving planning surface (`docs/plans/` + `docs/brainstorms/`)
> is smaller, dated, and demonstrably attached to shipped work. Two of
> the deleted themes did partly resurface, but as *report-only agent
> prompt categories* rather than built systems (see autoheal categories
> 9–10 below), which is a far cheaper way to get the same signal.
>
> Note that `feature-release-testing-infrastructure-1.md` was deleted as
> a plan while the same need reappeared as human-filed issue #2545
> ("Add test coverage for `scripts/release.ts`"), and
> `feature-workflow-validation-system-1.md` was deleted while its need
> reappeared as #2546 ("Automate workflow-templates standards
> validation"). The work didn't vanish — it moved from speculative
> agent-consumed plan docs into the ordinary issue tracker, at a
> realistic size.

Historical description (accurate 2026-07-16 → 2026-08-06):

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

### Solved-problem corpus (`docs/solutions/`, materialized 2026-08-19)

Through 2026-08-06 `docs/solutions/` existed but held only a README. It
is now a **real corpus**: a README that defines a repo-local,
self-described **authoritative** frontmatter contract plus seven entries
across `best-practices/`, `integration-issues/`, `logic-errors/`, and
`process/`.

The contract is worth noting because it decouples the store from the
tooling that populates it — *"Entries are written by the `ce:compound`
workflow, but the frontmatter contract below is repo-local and
authoritative on its own — you do not need the skill to add or read an
entry."* Two tracks (**Bug** and **Knowledge**) select required fields;
files live in a category directory named after `problem_type` and are
named `[problem-slug]-[YYYY-MM-DD].md`. The README is also candid that
the inherited `component`/`root_cause`/`resolution_type` enums carry
Rails/Hotwire values irrelevant to a TypeScript/Actions monorepo, and
names the subset that actually applies rather than silently mismatching.

Five of the seven entries were written during the refactor window and
read as a post-mortem of it:

| Entry | Class |
| --- | --- |
| `best-practices/contract-testing-actions-that-run-in-foreign-repos-2026-08-19` | The contract-suite rationale above |
| `best-practices/test-fixtures-underspecified-in-ignored-dimension-2026-08-19` | Fixtures that under-specify the dimension under test |
| `integration-issues/renovate-sha-pin-rot-two-tag-families-2026-08-15` | Two tag families → silent SHA-pin rot (below) |
| `logic-errors/changeset-dedup-ignored-summaries-2026-08-19` | Dedup keyed without summary content |
| `logic-errors/release-propagation-walked-dependency-graph-backwards-2026-08-19` | Propagation traversed dependents/dependencies inverted |
| `integration-issues/shallow-checkout-breaks-paths-filter-on-push-events-2026-06-25` | Carried from June |
| `process/renovate-changesets-fix-workflow` | Workflow guide, kept for inbound cross-links |

This is the same `docs/solutions/` convention `fro-bot/.github` itself
uses and that [[marcusrbrown--dev-like]] arrived at independently — three
repos, one shape.

### Two tag families and silent SHA-pin rot

Recorded in `AGENTS.md` and in `docs/solutions/integration-issues/renovate-sha-pin-rot-two-tag-families-2026-08-15.md`.
A released action is tagged `{action}@{ver}`; the repo tag `v{ver}` is cut
only when the **root** package also has pending changesets. The two often
land on the same commit but are not guaranteed to — the repo cites
`renovate-changesets@0.2.34` with no companion `v4.16.48`.

The footgun: Renovate's built-in `github-actions` manager resolves only
the `v{ver}` family. An external repo that SHA-pins one of these actions
and annotates the pin `# {action}@{ver}` therefore receives **no updates
at all**, silently. [[marcusrbrown--infra]] sat **four months behind**
this way. The fix is a regex `customManager` with
`extractVersionTemplate: '^{action}@(?<version>.+)$'`; consumers calling
the *reusable workflow* instead of SHA-pinning the action are unaffected.

Generalizable: any repo that publishes artifacts under a tag namespace
distinct from its release tags will rot downstream pins unless consumers
opt into a matching custom manager. Cataloged in [[github-actions-ci]].

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
- **New rule (2026-08-30) — TypeScript held below v7:**
  `matchPackageNames: ['typescript'], allowedVersions: '<7'` with the
  `description` *"Hold TypeScript below v7 because typescript-eslint
  lacks TS7 support; remove once support lands."* This resolves the
  2026-08-06 open PRs #2526/#2527 not by merging or ignoring them but by
  **recording the blocker with its exit condition in the config that
  enforces it**. Good practice worth propagating: a version pin whose
  reason and removal trigger live next to the pin doesn't decay into
  unexplained lag. Contrast the fleet repos carrying long-open,
  unannotated major-bump PRs ([[marcusrbrown--gpt]]'s HeroUI v3 across
  five surveys, [[marcusrbrown--extend-vscode]]'s `typescript` v6 across
  ~9 weeks).
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
  surface, consumed here via `renovate.yaml`. **2026-09-14: the pin is
  `10.39.0`, up from `10.25.1` — 14 more minors in 15 days, and the
  single most frequent commit subject in the repo's entire history for
  this window** (roughly a third of all 74 commits are
  `chore(deps): update bfra-me/renovate-action to …`). More important,
  **this repo took the `10.34.0` `tar` regression and escaped it the same
  way its downstream did: by hand.** Renovate merged #2685 (`10.34.0`) on
  2026-09-04; `marcusrbrown` then merged **#2689** manually — *"Update
  `bfra-me/renovate-action` to 10.34.1, which bundles Renovate 44.64.1
  and promotes `tar` to a production dependency"* — cut as patch release
  **v4.25.1**, the exact tag [[marcusrbrown--github]] could not reach
  without its own manual one-line edit. **Second independent instance of
  the bootstrap-dependency stall, and this one is the upstream**: the org
  control plane publishes the tag that carries the fix, consumes the
  broken updater itself, and still needed a human to close the loop. A
  self-Renovating control plane is not exempt from its own updater's
  outages; it is the *first* repo affected and the *last* able to
  automate its way out. Prior: crossed its own **v9 → v10 major** in the
  2026-08-06 window (#2520). This repo tracks it as a routine
  action pin, so the major landed as ordinary automerge churn rather than
  a structural event. At 2026-08-30 the pin is **`10.25.1`**
  (`d39cbd8`), up from `10.1.0` — 24 minors absorbed in ~3.5 weeks with
  no workflow-source change, which is the strongest available evidence
  that the v10 boundary really was a vendored-engine major and not a
  runtime-architecture change.
- **[[marcusrbrown--infra]]** — a downstream consumer that SHA-pins
  these actions directly rather than calling the reusable workflows. It
  is the repo named in the two-tag-family pin-rot learning (four months
  behind), and its workspace layout is replicated as a hostile fixture in
  the new `renovate-changesets` contract suite. The dependency now runs
  both ways: this repo's release-tag scheme broke infra's pins, and
  infra's topology is now a regression gate here.
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
- **Doc drift (persists, widened again, and now demonstrably skipped —
  2026-08-30):** `CONTRIBUTING.md` **still** states "pnpm: Version 10.8.1
  or later" and lists "pnpm 10.8.1 (workspaces)" / "Changesets 2.29.5",
  against an enforced pnpm **11.24.0** and `@changesets/cli` **2.31.1**.
  Third consecutive survey unhealed, and the gap widened again
  (11.17.0 → 11.24.0). The sharper finding: **`CONTRIBUTING.md` was
  modified in this window** and the stale prerequisite survived the edit
  — this is no longer "the drift detector never looked at the file," it
  is "the file was edited and the drift wasn't noticed." The same file
  also documents `pnpm run test:coverage` and `pnpm run test:watch`,
  neither of which exists in `package.json`.
- **New drift (2026-08-30): `AGENTS.md` file count is stale.** Line 15
  describes `renovate-changesets/` as *"Complex action: auto-generates
  changesets for Renovate PRs (125 src files)"*. Actual count at HEAD is
  **75** — the simplification refactor cut 40% of the tree and the
  self-description didn't follow. This one stings because
  `AUTOHEAL_PROMPT` category 5b is *precisely* this check: *"Verify
  AGENTS.md accuracy: check that the directory structure and file counts
  described in AGENTS.md match reality. If drift is found, open a PR with
  corrections."* An org control center running a daily pass that
  explicitly audits its own AGENTS.md for stale file counts is carrying a
  stale file count in its AGENTS.md. Either the check isn't being
  executed, or "125 src files" isn't being parsed as a count claim.
  Worth confirming against the #2344 report body next survey — if
  category 5 has been reporting ✅ throughout, that is a
  self-verification gap of the same class as
  [[marcusrbrown--dev-like]]'s dangling `$schema` pointer.
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
- Commit traffic between 2026-08-06 and 2026-08-30 is **125 commits, and
  for the first time since 2026-07-02 it is not pure churn.** The diff
  spans 238 files: 78 added, 74 removed, 83 modified, 3 renamed —
  overwhelmingly the `renovate-changesets` refactor plus its contract
  suite, the `.ai/` deletion, and the `docs/solutions/` corpus. All 16
  workflow files and 6 of 14 `workflow-templates/` files were touched,
  but by SHA-pin maintenance rather than logic change (the workflow
  *set* and `fro-bot.yaml`'s trigger/mode/cron surface are unchanged).
- Version churn 2026-08-06 → 2026-08-30: pkg **v4.16.44 → v4.22.0**,
  Node 24.18.1 → **24.20.0**, pnpm 11.17.0 → **11.24.0**,
  `fro-bot/agent` v0.96.0 → **v0.106.1**, eslint 10.8.0 → **10.9.1**,
  vitest + `@vitest/coverage-v8` 4.1.10 → **4.1.11**, vite 8.1.5 →
  **8.2.2**, tsx 4.23.1 → **4.23.12**, lint-staged 16.4.0 → **17.3.0**
  (**v16 → v17 major landed**), `@bfra.me/eslint-config` 0.51.1 →
  **0.52.1**, `@bfra.me/prettier-config` 0.16.9 → **0.16.11**,
  `@bfra.me/tsconfig` 0.13.1 → **0.13.2**,
  `bfra-me/renovate-action` v10.1.0 → **10.25.1**, `actions/setup-node`
  v6 → **v7.0.0** (major), `actions/checkout` **v7.0.1**,
  `pnpm/action-setup` **v6.0.10**. Held: TypeScript **6.0.3** (pinned
  `<7` by rule), prettier 3.9.6, husky 9.1.7, `@types/node` 24.13.3,
  `@changesets/cli` 2.31.1, glob 13.0.6.
- New root devDeps this window, all Changesets/workspace tooling
  consistent with the release-policy work in the refactor:
  `@changesets/config` 3.1.4, `@changesets/should-skip-package` 0.1.2,
  `@changesets/types` 6.1.0, `@manypkg/get-packages` 3.1.0,
  `@svitejs/changesets-changelog-github-compact` 1.2.0, plus `jiti`
  2.7.0, `eslint-config-prettier` 10.1.8, `eslint-plugin-prettier`
  5.5.6.
- New root scripts: `build:composite:*` (TS project-reference builds via
  `tsc --build tsconfig.build.json`, incl. `--dry` validate and
  `--watch`), `typescript:validate-type-only`,
  `workspace:export-{dot,json,mermaid}`,
  `workspace:standardize-scripts[:apply]`, `type-check:build`. Two new
  `scripts/` utilities back them: `validate-type-only-imports.ts` and
  the existing `audit-typescript-references.ts` (modified).
- **Structural changes 2026-08-06→2026-08-30: yes** — the first since
  2026-07-02, and the first that is *product* rather than *control
  plane*: `renovate-changesets` src 125 → 75 with detectors/summaries
  deleted, a new consumer-fixture contract-test tier, `.ai/` removed
  (8 plans deleted / 2 promoted), `docs/{plans,brainstorms}/` created,
  `docs/solutions/` populated 0 → 7 entries, autoheal categories 8 → 10,
  five new autoheal guardrails. Unchanged: 16 workflows, 2 modes, 3
  custom actions, 4-package workspace, single `30 15` unified pass,
  branch protection (12 contexts, `enforce_admins`, 0 required
  approvals).

## Open Questions / Follow-Ups

- The Probot settings landscape now has **three** common-settings
  sources visible in this wiki: `marcusrbrown/.github:common-settings.yaml`
  (Marcus's personal template), `fro-bot/.github:common-settings.yaml`
  (Fro Bot org template), and `bfra-me/.github:common-settings.yaml`
  (this repo, org template for `@bfra-me`). The
  [[probot-settings]] topic currently documents only the first two.
  A follow-up survey should map which repos extend which and reconcile
  the relationship between `bfra-me` and `fro-bot` org settings.
  **Still open at 2026-08-30** — `.github/settings.yml` and its
  `_extends: .github:common-settings.yaml` self-reference are byte-stable
  across this window, so nothing new to reconcile from this side.
- ~~**Is autoheal category 5b actually running?**~~ **RESOLVED
  2026-09-14.** It runs, detects the stale `AGENTS.md` count, and fixes
  it — every day, into a working tree that is never committed. Neither
  posed hypothesis (silent ✅ over stale data / ⚠️ with no PR) was
  correct. See
  [The delivery-mode layer conflict](#the-delivery-mode-layer-conflict-2026-09-14).
- **Where does `minimumReleaseAge` come from?** Still open at 2026-09-14
  and now **larger**: `pnpm-workspace.yaml` still declares
  `minimumReleaseAgeExclude` (two entries, both `@bfra.me/*` configs,
  refreshed this window to cover `eslint-config@0.52.2` /
  `prettier-config@0.16.11`) with no corresponding `minimumReleaseAge` in
  any surveyed file and no `.npmrc` in the tree. Someone is actively
  maintaining the exclusion list, which makes the missing enabling key
  harder to read as an oversight and more likely to live somewhere
  unsurveyed (CI env, org-level npm config). Cross-reference:
  [[marcusrbrown--sparkle]] added a `minimumReleaseAgeExclude` escape
  hatch in the same window — worth checking whether *it* declares the
  enabling key, which would settle this from the other end.
- **Does the daemon's paralysis have a blast radius beyond this repo?**
  It runs the org-wide sweep, and the `working-dir` restriction binds
  only its own checkout — the 09-11 `/tmp`-clone workaround proves
  org-wide delivery still functions. But the 09-13 run declares
  categories 7–8 *"report-only … no branch/PR delivery available"*, so
  the workaround is applied inconsistently run to run. Six
  human-attention items across `bfra-me/github-app`,
  `bfra-me/github-action` and `bfra-me/renovate-config` — including an
  **8-alert Dependabot backlog with one HIGH (undici WebSocket DoS)**
  behind three `CONFLICTING` fro-bot PRs open ~3 months — are currently
  reported and not acted on. Whether that is the Delivery Mode block or
  the minimality cap is not resolvable from this side.
- **Page-size pressure (schema).** `knowledge/schema.md` targets 500–2000
  words per page and asks that larger pages be split into sub-topics.
  This page is well past that and grew substantially this survey.
  A defensible split would lift the durable, non-time-varying material
  (Layout, Workspace, Custom Actions, Conventions, Anti-Patterns, Build/
  Test/Release) into a stable core and move the seven survey deltas into
  a dated companion, or promote the `renovate-changesets` action to its
  own page — it now has a version line, a refactor history, and a test
  architecture of its own. Not attempted here because the ingest brief is
  additive-only; recording it so the decision is deliberate rather than
  deferred by neglect. The same pressure applies fleet-wide to
  [[marcusrbrown--dotfiles]], [[marcusrbrown--infra]], and
  [[marcusrbrown--mrbro-dev]].
- **Does the contract-suite pattern propagate?** The consumer-fixture
  approach is the most reusable thing this repo has produced in months
  and applies directly to [[bfra-me--renovate-action]] (a composite
  action executing in foreign repos) and to
  [[fro-bot--agent]] (an action executing in every repo in the fleet).
  Neither had such a tier at last survey. Worth checking next pass.

## Survey History

| Date       | SHA        | Notes                                                                      |
| ---------- | ---------- | -------------------------------------------------------------------------- |
| 2026-05-20 | `a81be4c`  | Initial survey. `fro-bot/agent@v0.44.2` (PR #2200). 17 workflows, 3 custom actions. |
| 2026-06-10 | `a27ccfa`  | Re-survey. v4.16.24, pnpm 10.34.1, Node 24.16.0, agent v0.59.1 (17 bumps in 3 weeks). Structure unchanged. Issue #2213 (settings-sync git exit 128) open. |
| 2026-06-20 | `af0e41e`  | Re-survey. v4.16.27, pnpm 10.34.3, Node 24.17.0, agent v0.71.0 (12 more bumps in 10 days, ~29 in a month). Structure unchanged (17 workflows, 3 actions). Issue #2213 still open (now 4 weeks). New: Fro Bot PR #2292 esbuild security autoheal (HIGH alert #52), still open. |
| 2026-07-02 | `d51473c`  | Re-survey. v4.16.33, pnpm **11.9.0** (major 10→11), Node 24.18.0, agent v0.81.0 (~10 more bumps, ~39 in six weeks). **First structural change since initial survey:** `fro-bot-autoheal-org.yaml` merged into `fro-bot.yaml` (17→16 workflows); `maintenance` mode + `0 5` cron retired (3→2 modes, single `30 15` unified pass); three report issues (#2185/#1960/#1959) closed and consolidated into #2344. Issue #2213 **RESOLVED** (closed 2026-06-25). PR #2292 esbuild remediation **MERGED** (override now on `main`). Added husky/lint-staged + manypkg + build-cache tooling. Custom actions unchanged (3). |
| 2026-07-16 | `1c12695`  | Re-survey. v4.16.37, pnpm 11.11.0 (routine 11.x churn; #2436 queues 11.12.0), Node 24.18.0, agent **v0.92.1** (~11 more bumps, ~50 in two months). **No structural change** — 16 workflows, 2 modes, 3 custom actions, single `30 15` unified pass all confirmed durable; the 2026-07-02 consolidation is now steady-state. Additive scaffolding: new `.ai/` planning corpus (10 aspirational plan docs + notes), `.husky/pre-commit`, root `CHANGELOG.md`/`CONTRIBUTING.md`, `.git-blame-ignore-revs`, `.cursorindexingignore`. `onlyBuiltDependencies` array migrated to pnpm 11 `allowBuilds:` block (same allowlist). Doc drift: `CONTRIBUTING.md` cites pnpm "10.8.1+" while repo enforces 11.x. Open 2/2 (report #2344, dashboard #7; PRs #2444 release, #2436 pnpm bump). |
| 2026-08-06 | `d9feab2`  | Re-survey (82 commits ahead, all Renovate/release/SHA-pin churn). v4.16.44, pnpm **11.17.0** (six 11.x bumps), Node **24.18.1** (first bump since 2026-07-02), agent **v0.96.0** (~10 more bumps, ~57 in ~2.5 months, back at fleet lead). **No structural change** — 16 workflows, 2 modes, 3 custom actions, single `30 15` unified pass, security `PR_REVIEW_PROMPT` all durable (4th steady-state window). Two upstream **majors** landed as ordinary automerge: `bfra-me/renovate-action` v9 → **v10.1.0** (#2520), `actions/checkout` v6 → **v7** (#2521). Overrides stable (only `flatted` 3.4.2 → 3.4.3). `.ai/plan/` unchanged (0 of 10 graduated). `llms.txt`/`.gitattributes`/`.markdownlint-cli2.yaml` first enumerated but pre-existing. Doc drift persists + widened (`CONTRIBUTING.md` still "pnpm 10.8.1" vs enforced 11.17.0). Open **2/7** (report #2344, dashboard #7; 7 held-back major-bump PRs #2522–#2528 incl. typescript v7, lint-staged v17, actions v5–v7). |
| 2026-08-30 | `1b21990`  | Re-survey (125 commits ahead; 238 files changed — **not pure churn**). v**4.22.0**, pnpm **11.24.0**, Node **24.20.0**, agent **v0.106.1** (`d8c47fd`, ~68 bumps in ~3.5 months, sole ecosystem leader). **First structural change since 2026-07-02, and the first at the product layer:** the `renovate-changesets` **simplification landed** — `src/detectors/` (~40 files, 6 ecosystem detectors + security advisories) and `src/summaries/` (~11 template files) **deleted**, replaced by a small `classify`/`extract`/`format` + `changesets-release-policy` pipeline (src **125 → 75**, action v0.2.45); planned in-repo via new `docs/brainstorms/` + `docs/plans/`. Shipped with a **consumer-fixture contract-test tier** (`vitest.contract.config.ts`, `test/contract/` — 10 scenarios/25 tests + hostile fixtures modeling [[marcusrbrown--infra]] and this repo), entering through real `run()`, real temp workspaces, and a mock boundary that throws on unexpected `getExecOutput`. **`.ai/` removed** — 1 plan shipped, 1 promoted to `docs/plans/`, **8 deleted** (incl. template federation + org-health monitoring); two of the deleted needs resurfaced as human issues #2545/#2546. **`docs/solutions/` materialized** 0 → 7 entries under a repo-local authoritative frontmatter contract. **Autoheal categories 8 → 10** (+CROSS-PROJECT INTELLIGENCE, +PROGRESSIVE IMPROVEMENT, both report-only) with five new guardrails: TRUSTED AUTHORS gate, **poisoned-branch execution guard** (don't run project commands from branches touching workflows/prompts/PM config/lockfiles/scripts), missing-data tool-skepticism, an explicit **DELIVERY CONTRACT** ("the agent that writes the fix is the agent that ships it"), and a guardrail-preservation clause; report issue now bounded to 14 days + Historical Summary. New `OPENCODE_PROMPT_ARTIFACT` env. **TypeScript frozen `<7` by an annotated Renovate rule** (typescript-eslint gap) — resolves #2526/#2527 as a recorded decision. Overrides 4 → 7 (+brace-expansion/fast-uri/js-yaml); new `minimumReleaseAgeExclude` with no visible `minimumReleaseAge`. Majors landed: lint-staged v17, `actions/setup-node` v7; `bfra-me/renovate-action` 10.1.0 → 10.25.1. Open **4/2** — 7-deep major queue **fully drained**, first non-bot open issues (#2545/#2546). Unchanged: 16 workflows, 2 modes, 3 actions, single `30 15` pass, branch protection. Drift: `CONTRIBUTING.md` pnpm/Changesets stale for a 3rd survey **despite the file being edited this window**; **new** — `AGENTS.md` still claims 125 src files vs actual 75, the exact claim autoheal category 5b exists to catch. |
| 2026-09-14 | `a4180e7`  | Re-survey (74 commits ahead: **68 `bfra-me[bot]`, 6 `marcusrbrown`** — five of the six are `fix(…)`). v**4.29.0**, pnpm **11.26.0**, Node **24.21.0**, agent **v0.112.0** (~74 bumps in ~4 months, still ecosystem leader). **Two headlines, pointing opposite directions.** (1) **The delivery-mode layer conflict** — the `AUTOHEAL_PROMPT`'s DELIVERY CONTRACT ("the agent that writes the fix is the agent that ships it … do not delegate to a caller workflow — there is none") is *correct* (`fro-bot.yaml` ends at `Run Fro Bot`, line 576 of 586) and is *overridden* by the harness `working-dir` Delivery Mode block, which forbids `git commit`/`push`/`gh pr create` and asserts a caller workflow that does not exist. Result: **10+ consecutive scheduled runs re-applying the same three fixes into a working tree that is never committed**, independently verified at HEAD (`validate-type-only-imports.ts:117` still carries the CodeQL #53 dead assignment; `AGENTS.md` still says `125 src files` vs actual 75). **Resolves the 2026-08-30 open question** on autoheal category 5b — it runs, detects, and fixes daily; the gap is delivery, not detection. The daemon root-caused itself in public (ran `git log` on the three paths at run start, re-confirmed the CodeQL alert via API, told its successor **"do not re-read that workflow file again"**) and states it cannot act: *"the Delivery Mode block is operator-controlled and takes priority."* Asymmetry: the restriction binds only the **checked-out** repo, so on 09-11 it shipped `bfra-me/renovate-config` PR #1558 via the GitHub API + a `/tmp` clone — the org control plane can fix every repo in the org except itself. Two conclusion inversions in one fortnight (**09-12 `failure` wrote a full report; 09-10 and 09-05 `success` wrote nothing**), plus a falsifiable audit error (09-11 "`AGENTS.md` … this landed" vs 09-13 "silently reverted" — it says `125` at HEAD). Report rotation honored (9 dated sections + one Historical Summary) yet body is **143,241 chars** — a section-count rotation is not a size budget. (2) **Settings-sync diagnosability shipped** (#2684 → `update-repository-settings` **0.2.0**, #2687 → **0.2.1**, src 26 → 32): applied-state read-back for branch protection, status + `x-github-request-id` + redacted body on failure, bounded retry — the first engineered answer to *a declared manifest is not an applied one*. Triggered by [[bfra-me--ha-addon-repository]] failing **14 of 60 runs (23%)** since 08-24 with a 500 at 8273/8234/8324 ms. Rules extracted: normalize observation but never intent; subset-match so new server fields aren't drift; redact before truncate; allowlist headers; report before enforce; name what would refute the retry hypothesis. Also: **#2717** made `persist-credentials` conditional but enumerates only 3 of 5 content triggers (`pull_request_review_comment`/`discussion_comment` still persist `FRO_BOT_PAT`, despite identical `author_association` gating to the denied `issue_comment`). **The `tar` regression hit the control plane too** — Renovate merged `10.34.0` (#2685), `marcusrbrown` hand-merged `10.34.1` (#2689 → v4.25.1), the exact tag [[marcusrbrown--github]] could not reach; second instance of the bootstrap-dependency stall, this one upstream. **Open 4/0 — first empty PR queue on this page**, inverting [[marcusrbrown--tokentoilet]] and [[marcusrbrown--sparkle]]. Cron drift: `30 15` now starts 18:17–18:43 (was 15:46 on 08-15); no run 08-27, two on 08-29; 40/40 most-recent runs `skipped` (~100% bot trigger surface). Unchanged: 16 workflows, 2 modes, 3 actions, 4-package workspace, TS frozen at 6.0.3 `<7`, overrides at 7, branch protection. |
