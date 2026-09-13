---
type: repo
title: marcusrbrown/sparkle
created: 2026-04-28
updated: 2026-09-13
sources:
  - url: https://github.com/marcusrbrown/sparkle
    sha: 770356b3c83cec08a666960eab9c5fb4e1ab2a85
    accessed: 2026-04-28
  - url: https://github.com/marcusrbrown/sparkle
    sha: 712ab1bc2fdcd59ec9b8a2d71ad6d9ca88a023c5
    accessed: 2026-04-30
  - url: https://github.com/marcusrbrown/sparkle
    sha: 712ab1bc2fdcd59ec9b8a2d71ad6d9ca88a023c5
    accessed: 2026-05-01
  - url: https://github.com/marcusrbrown/sparkle
    sha: e757fa66aa223f4ccb8af16838d937562b97f713
    accessed: 2026-05-23
  - url: https://github.com/marcusrbrown/sparkle
    sha: e03e3173c70087d08e0def5196db624de964bf50
    accessed: 2026-06-05
  - url: https://github.com/marcusrbrown/sparkle
    sha: 5ccf10681cf1095bd0ffb113c0e1a3745b40109c
    accessed: 2026-06-16
  - url: https://github.com/marcusrbrown/sparkle
    sha: 81cbd991dadc2c3b7b5de173e03edd672684a71d
    accessed: 2026-06-27
  - url: https://github.com/marcusrbrown/sparkle
    sha: 2ef1cf1632e5ce4173007487f163908adddf55a5
    accessed: 2026-07-11
  - url: https://github.com/marcusrbrown/sparkle
    sha: 9c215ee477fb785ba148b826f7bf0ef8c7111617
    accessed: 2026-07-28
  - url: https://github.com/marcusrbrown/sparkle
    sha: 8508b7163202f2e547864b5419ab25253e55191c
    accessed: 2026-08-29
  - url: https://github.com/marcusrbrown/sparkle
    sha: e603ff54e34aa4f62cf6c74909abff334cf71880
    accessed: 2026-09-13
tags:
  - typescript
  - react
  - react-native
  - monorepo
  - design-system
  - storybook
  - tailwindcss
  - radix-ui
  - turborepo
  - expo
  - vite
  - astro
  - github-pages
  - zig
  - wasm
  - typedoc
  - decision-graph
aliases:
  - sparkle
related:
  - github-actions-ci
  - marcusrbrown--mrbro-dev
  - marcusrbrown--gpt
  - marcusrbrown--tokentoilet
  - marcusrbrown--vbs
  - marcusrbrown--github
  - bfra-me--works
  - fro-bot--dashboard
node_id: MDEwOlJlcG9zaXRvcnkzMTYxMDA5ODY=
---

# marcusrbrown/sparkle

**Sparkle** — a TypeScript playground and monorepo showcasing cross-platform web and mobile development. React component library, design token system, Expo/React Native mobile app, Astro Starlight documentation site, and comprehensive build tooling via Turborepo and pnpm workspaces.

## Overview

- **Purpose:** Experimental playground for modern TypeScript monorepo patterns, cross-platform UI, and design system tooling
- **Default branch:** `main`
- **Created:** 2020-11-26
- **Last push:** 2026-09-13
- **Homepage:** https://sparkle.mrbro.dev (Astro Starlight docs site on GitHub Pages; the GitHub `homepage` API field still reads `null` at the 2026-09-13 survey — unchanged across eleven surveys — but Pages is live and the autoheal daemon browser-verifies it nightly)
- **License:** MIT
- **Topics:** `typescript`, `playground`, `next-js`, `react`, `vite`
- **Package manager:** pnpm 11.26.0
- **Node.js:** 24.21.0 (pinned via `.node-version`)
- **Stars:** 2, **Forks:** 0, **Watchers:** 2 (steady)
- **Open issues:** 8 (non-PR), **Open PRs:** 2, **Has GitHub Pages:** yes
- **`node_id`:** `MDEwOlJlcG9zaXRvcnkzMTYxMDA5ODY=`

## 2026-09-13 Survey — The Backlog Drained and the Repo Audited Its Own Documentation Generator

_HEAD `e603ff5` (`chore(dev): update dependency happy-dom to v20.14.3` #2056, `mrbro-bot[bot]`, 2026-09-13T01:12Z). Eleventh survey._

The 2026-08-29 page read this repo as a **propose-without-merge** backlog: 15 open PRs, 13 fro-bot-authored, none merging. That reading was accurate for its interval and is now **superseded as a trajectory**. Open PRs are **15 → 2**, and the whole queue cleared inside a **112-minute window on 2026-09-06 (14:04 → 15:56 UTC)**.

Authorship inverted with it. 89 commits since 2026-08-29: `mrbro-bot[bot]` 50 / **`marcusrbrown` 27** / `fro-bot` 12. Prior intervals were effectively all-bot. This is the second repo on the wiki (after [[marcusrbrown--systematic]]) observed doing sustained human architectural work, and here the work is almost entirely **auditing the machinery that had been reporting itself healthy**.

### 1. The queue drained — 10 merged, 3 closed as superseded, zero substance lost

| Disposition | PRs |
| --- | --- |
| Merged 09-06 14:04–14:48 | #1904 (nanoid override), #1787, #1816, #1841, #1844, #1875, #1883, #1886, #1891, #1914 |
| Closed unmerged 09-06 15:56:5x (4-second cluster) | #1838 (adm-zip), #1866 (brace-expansion), #1862 (postcss) |
| Merged separately | #1956 (`@bfra.me/eslint-config` 0.52.1), #1812 autoclosed 09-07 |

The three closures are **not rejections**. Human PR **#2002** (`fix(deps): consolidate outstanding security overrides`, merged 15:56:40 — 10 to 14 seconds before the closures) folded all three into one change against current `main`, and `marcusrbrown` left an identical supersede comment on each closed PR. This is a second confirmation of the class first recorded in [[bfra-me--works]] — _an audit measuring PR merge rate scores the window as three rejections; an audit diffing the manifest scores it as full remediation_ — with better hygiene than the bfra-me case, because the supersede note is explicit and on-thread rather than inferable.

**#2002 also raised the floor beyond what the bot PRs asked for.** Its stated rationale is worth quoting as a practice: `#1862`'s `^8.5.18` "clears the high advisory but leaves medium GHSA-fxqj-rqcc-2cmp open. This raises the floor to `^8.5.23` so both are closed **by constraint rather than by whatever resolution happens to land**." Verified against the lockfile (`adm-zip 0.6.0`, `brace-expansion 5.0.9`, `postcss 8.5.26`, `nanoid 3.3.18`), with the lockfile *shrinking* 819,723 → 818,697 bytes.

**The stall had a measurable maintenance cost.** Across the interval the autoheal daemon spent repeated cycles keeping those three branches alive: lockfile conflict-resolution comments on all three (#1838 twice, #1862 three times, #1866 twice), each regenerating `pnpm-lock.yaml` against a `main` that had moved 65+ commits including the Astro v7 major. On #1862 it went further and **widened its own override** from `^8.5.12` to `^8.5.18` when a second advisory (GHSA-r28c-9q8g-f849) was disclosed after the PR opened — which left the PR **title stale relative to its own diff**, a discrepancy #2002 explicitly called out. All of that branch-maintenance work was discarded. The cost of propose-without-merge is not just the delay; it is the daemon burning nightly cycles rebasing branches whose merge is gated on a human who will eventually redo the work in one shot.

### 2. The delivery-mode break was fixed — with the strongest version of the fix observed in the fleet

Two `marcusrbrown` commits on 2026-09-06: **#2001** (`fix(ci): enable authenticated git push for Fro Bot autoheal runs`, 15:50) and **#2003** (`fix(ci): request branch-pr delivery for Fro Bot autoheal runs`, 16:48). Together they close the class documented in [[fro-bot--dashboard]] (#413) and diagnosed as unfixed in [[marcusrbrown--tokentoilet]] (a fully-permissioned daemon whose caller workflow never grew the delivery half).

`fro-bot.yaml` now carries a **`Resolve delivery mode` gate step** that is the single source of truth for the run's delivery contract:

```yaml
id: gate
env:
  DELIVERS_BRANCH_PR: >-
    ${{ (github.event_name == 'workflow_dispatch' && (inputs.mode == 'autoheal' || inputs.mode == ''))
        || (github.event_name == 'schedule' && github.event.schedule == '0 5 * * *') }}
```

Its outputs feed **both** consumers — the conditional credential-restore step (`if: steps.gate.outputs.branch-pr == 'true'`) and the agent's `output-mode:` input. The inline comment names the failure mode it exists to prevent: _"Both the credential step and the agent's output-mode input read from here, so the two can never drift apart — which is the exact class of bug this workflow already hit once."_

Four properties make this stronger than the dashboard's repair:

1. **Least privilege by default.** Workflow-level `permissions: contents: read`; the single job escalates to `contents/issues/pull-requests/discussions: write`.
2. **`persist-credentials: false`** on checkout, so the PAT is never written into `.git/config` on the fork-PR-head comment path.
3. **The credential is restored only for `branch-pr` runs**, written to `.git/config` as a masked `extraheader` rather than passed by env — because, per the comment, `fro-bot/agent` scrubs its child environment.
4. **Write capability is scoped to the one mode that needs it.** `MAINTENANCE_PROMPT` updates a perpetual issue (API token suffices) and `PR_REVIEW_PROMPT` is review-only, so both stay `working-dir` regardless of arrival path. The comment also documents the harness contract that caused the original break: `resolveOutputMode()`'s `auto` default resolves to `working-dir`, "which is why autoheal fixes previously had nowhere to land — `branch-pr` must be explicit."

Cataloged in [[github-actions-ci]] as _Gate the Delivery Mode and the Credential on One Computed Value_.

### 3. The docs pipeline was green and wrong — four defects found by hand in one session

This is the interval's most durable finding, and it generalizes the wiki's existing _a run's conclusion measures the harness, not the deliverable_ theme from **liveness** to **correctness**.

- **#2022 (merged)** — `.github/actions/setup-ci` ends at `pnpm install`; it never builds. Every `@sparkle/*` package resolves only through `dist`, and `dist` is gitignored. So CI generated API documentation **without ever building the packages it documents**, and every cross-package type reference resolved against nothing. Concretely: `mergeThemes(baseTheme: ThemeConfig, overrideTheme: Partial<ThemeConfig>)` was published as `mergeThemes(baseTheme, overrideTheme): ThemeConfig` — the `Partial<>` silently dropped. One overload, so not a mis-documentation.
- **#2023 (open)** — the reason it was invisible. `docs/typedoc.json` sets `skipErrorChecking: true`, converting TypeScript resolution failures into silently wrong output rather than a failed build. The issue's own framing: _"Every regeneration was green. The documentation was wrong. Nothing surfaced it until someone diffed generated output against source by hand."_ The build-ordering bug is fixed; **the property that made it invisible is not**.
- **#2025 (open)** — `docs:automation:force` (and the `force: true` dispatch input on `regenerate-docs.yaml`) **deletes hand-authored documentation**. `cleanupPrevious()` removes generated output directories wholesale, but `docs/src/content/docs/components/` holds both generated and hand-written files and the generator only recreates its own. A forced run produced **`+1 −1858` across 6 files**. The discriminator is an extension collision nobody designed: the generator writes `button.md`; what got deleted was hand-maintained `button.mdx`. Nothing distinguishes the two categories at cleanup time. It has not bitten before only because `--force` is rare.
- **#2032 (open)** — the JSDoc parser underneath all of it is **`doctrine`, archived since 2018**. Called at three sites in `docs/scripts/extract-jsdoc.ts`, pinned `3.0.0` in `docs/package.json`, also reached transitively via `react-docgen` ← `@storybook/react-vite`. The issue is careful about the reasoning: nothing is broken, no advisory exists, and a JSDoc parser is the kind of thing that can be *finished*. The argument is positional — _"the difference is what it sits under,"_ i.e. a pipeline that already produced two independent silent-wrong-output defects.

Note the shape: Renovate flags `doctrine` under **Abandoned Dependencies** by inferring from release inactivity; the issue points out that the **archive flag is the stronger signal** because the maintainers stopped deliberately. Inference from silence and a declared state are not the same evidence.

### 4. `#1812` was stuck ~8 weeks on an undeclared bare-specifier import that only reproduced in CI

Carried on this page as an open Renovate PR since 2026-07-11. Root cause (**#2027**): `typedoc-plugin-frontmatter@1.3.1` imports `typedoc` with a bare specifier but declares it in neither `dependencies` nor `peerDependencies` (which listed only `typedoc-plugin-markdown`). pnpm therefore never linked `typedoc` into the plugin's own `node_modules`, and resolution walked up to whatever `shamefullyHoist: true` left at the root. **CI-only** — never reproduced locally under an identical lockfile and identical pnpm, because on `ubuntu-latest` the hoist produced a stub `node_modules/typedoc/dist/types` with no `package.json`, so Node ignored the `exports` map and failed looking for a legacy `index.js`.

`shamefullyHoist: true` is what made the plugin work at all for months and what made the failure non-reproducible when it broke. Upstream fixed the declaration in `1.3.2`; **#2048** (open, `marcusrbrown`) drops the root-level `typedoc` workaround #2027 added. `#1812` autoclosed 2026-09-07.

### 5. `#1800` closed after ~8 weeks — by deleting the duplicated fact, not by re-syncing it

The longest-running thread on this page. `llms.txt` text-declared `packageManager: pnpm@10.33.4` while the manifest advanced to `11.24.0`; the AUTOHEAL_PROMPT category-3 check flagged it on 2026-07-11 and re-flagged it across three surveys without healing it, because the prompt contract says open an issue, not a PR.

It closed `COMPLETED` on **2026-09-06T14:48:25Z** — one second after **#1816** merged. The repair was not a version bump. `llms.txt` now reads:

> - Package manager: **pnpm** — exact version pinned by `packageManager` in the root `package.json`
> - Node: pinned via `.node-version` (24.x) — repo `engines` floor is `>=22.13.1`

The version was **removed from the document** and replaced with a pointer to its single source. Five surveys of flag-but-don't-heal ended when the *fix shape* changed, not when someone finally got around to the sync. The category-3 check now reports `✅ Current` and is telling the truth for a structural reason rather than a maintenance one. Cataloged in [[github-actions-ci]].

### 6. `#1937` closed by changing the rule, not the code

The 2026-08-29 survey recorded the autoheal daemon auditing `src/` against the repo's own no-ES6-class convention and filing the residual violations. **#2015** resolved it by rewriting the convention:

> The rule is unambiguous but false. Enforcing it as written would mean converting a fluent builder whose entire API is method chaining, a transformer that owns cache lifecycle, and the shell subsystems that own process and job state — spending regression budget to make syntax uniform while leaving behavior identical.

The absolute ban ("avoid ES6 classes except for Error extensions," duplicated verbatim in four places) became a **justified-exception rule plus a `no-restricted-syntax` lint** requiring every permitted class to carry a local suppression explaining why a factory would be less clear. Seven flagged classes *were* genuinely unjustified and got deleted first (#2012 dormant module, #2013 deprecated forwarding adapter). The nightly audit's real finding was that the declared convention was wrong — a distinct and underrated outcome shape for a daemon that audits a repo against its own written contract.

### 7. One red check nobody owns — a coverage hole between two category definitions

**PR #2036** (`renovate/lock-file-maintenance`, opened 2026-09-07) has failed the `Setup` job on **every run since**, 9 of 9 in the last 30 `main.yaml` runs. Cause: `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @parcel/watcher@2.6.0` — a regenerated lockfile pulls in a package with a build script absent from `pnpm-workspace.yaml`'s `allowBuilds` / `onlyBuiltDependencies` / `ignoredBuiltDependencies`, and `engineStrict`-era pnpm exits 1. The fix is one allowlist line.

It is structurally orphaned:

- **Renovate cannot fix it** — the remedy is a workspace-config change, not a version bump, and Renovate is the author of the failing branch.
- **Autoheal explicitly will not** — the daemon reports it verbatim every run and states its own reason: _"Category 1 excludes dependency/security PRs; category 2 only covers security PRs with conflicts/failures."_ A routine lockfile-maintenance PR that is red but not a security PR falls in the gap between two category definitions.
- The human has not, for six days.

This is **not** a blind spot — the daemon names the PR, the exact error string, and files it under _Needs Human Attention_ with a concrete suggestion. It is a scope-definition hole, and the same family as [[marcusrbrown--github]]'s _the updater ships its own poison and cannot ship the antidote_: the actor with the capability lacks the mandate, and the actor with the mandate is the broken component. Cataloged in [[github-actions-ci]].

### 8. The autoheal report declares its populations — and is still not deterministic

Two observations that cut opposite ways, both from `#1665`.

**Positive.** The 2026-09-11 Workflow-health row reads: _"`main.yaml` on the `main` branch itself: 70 success / 1 cancelled over the last 7 days (0 failures). Raw `main.yaml` totals incl. PR branches: 287 runs, 84 failures (≈29%…) — isolated to Renovate/PR branches, not a `main` CI regression."_ It states the population, states the alternative population, and states the reconciliation. This is exactly the discipline this wiki's own _A Fixed Run-Count Window Is a Time Window of Unknown Length_ finding demanded, observed in the wild in a different repo. The 09-13 report also **refuses** to auto-rename `.github/settings.yml` to the `.yaml` convention, reasoning that the filename is very likely required verbatim by the Settings App and that renaming risks silently breaking settings sync — a correct refusal a naive convention-lint would not make.

**Negative.** On the same unchanged tree, two consecutive nightly runs return opposite verdicts on that same file:

| Run | Convention-drift verdict |
| --- | --- |
| 2026-09-11 | ✅ Clean — _"No `.yml` files in the repo."_ |
| 2026-09-13 | ⚠️ Issues — _"`.github/settings.yml` uses the `.yml` extension, violating the convention."_ |

`.github/settings.yml` exists and did not change. A prose-driven audit executed by a model is a **sampling process, not a lint**: it re-derives its own checklist each run, and coverage varies. The correct read of a green line in one of these reports is "this run did not find it," not "it is not there. " Anything that must hold every time belongs in `eslint.config.ts` or a CI job — which is precisely what #2015 did for the class rule, and precisely what has *not* been done for the file-extension rule. Cataloged in [[github-actions-ci]].

### 9. New subsystem — `.deciduous/`, a git-tracked decision graph

Landed in two `marcusrbrown` PRs: **#2038** (`feat(graph): add a reviewed, staged decision graph bootstrap`, 09-08) and **#2047** (`feat(graph): add initial decision graph dataset`, 09-09). Plus a new root script `scripts/bootstrap-graph.ts` (`pnpm bootstrap-graph`).

- `.deciduous/config.toml` — branch detection and grouping. `main_branches = ["main", "master"]`; nodes created on feature branches are auto-tagged with the branch name; always-on 24h non-blocking version check.
- `.deciduous/sync/` — one JSON file per record, git-tracked: `nodes/<change_id>.json` (goals, decisions, actions, outcomes), `edges/<edge_id>.json` (linked **by `change_id`, not local id**), plus `themes/` and `tags/`. **≥1000 node files** (GitHub contents API caps the listing) and **664 edge files** at survey time.
- Reconciliation model: each machine keeps a private SQLite database; `deciduous sync` reconciles it against the tracked directory. Deletions are `deleted_at` tombstones. The README is explicit: _"Do not edit files by hand; run `deciduous sync` after `git pull` and before `git push`."_

Architecturally this is the same problem this wiki solves, with the opposite trade: content-addressed records with machine-mergeable identity and no prose layer, versus prose pages with LLM-compiled synthesis. Worth watching whether the two converge or whether the graph stays repo-local. Note the identity design — edges reference `change_id` rather than local database ids — which is the same lesson as this wiki's own `node_id`-keyed corrections store: **key durable cross-references on something that survives regeneration**.

### 10. Contradiction: Probot settings do not extend `fro-bot/.github`

`.github/settings.yml` reads `_extends: .github:common-settings.yaml`. That is a **bare, owner-relative** reference, which the Settings App resolves within the same owner — so sparkle inherits from **`marcusrbrown/.github`** ([[marcusrbrown--github]], the canonical 48-label template), not from `fro-bot/.github`.

This page has recorded "Probot settings extending `fro-bot/.github:common-settings.yaml`" since the 2026-04-28 initial survey and repeated it as confirmation of Fro Bot ecosystem membership. Both readings are preserved here; the 2026-09-13 direct read of the file is the corrected one. Fro Bot ecosystem membership is independently true via `fro-bot.yaml` — the settings inheritance was never the evidence for it.

## Tech Stack

| Layer             | Technology                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| Language          | TypeScript 5.9.3 (strict mode, ESM-only `"type": "module"`)                      |
| Build             | Turborepo 2.9.x, tsdown 0.16.x, Vite                                             |
| Framework (web)   | React 19.x, Radix UI primitives, Tailwind CSS                                    |
| Framework (mobile)| Expo / React Native                                                               |
| Component docs    | Storybook                                                                         |
| Documentation     | Astro Starlight (`@sparkle/docs`), TypeDoc, automated JSDoc extraction            |
| Testing           | Vitest, Testing Library, axe-core accessibility, Playwright visual regression     |
| Linting           | ESLint 9.39.4 via `@bfra.me/eslint-config` 0.51.0 + Prettier via `@bfra.me/prettier-config` 0.16.8 (`120-proof` — 120 char) |
| TypeScript config | Extends `@bfra.me/tsconfig` 0.13.0                                               |
| Git hooks         | `simple-git-hooks` + `nano-staged` (runs `eslint --fix`, `sort-package-json`)     |
| Monorepo tools    | `@manypkg/cli` (workspace consistency checks), Changesets (versioning)            |
| Bundler           | tsdown (library packages), Vite (apps), Astro (docs)                              |

_Toolchain drift (2026-09-13 survey at SHA `e603ff5`):_ **First major-version movement in the docs stack since the Astro Starlight site was built.** `astro` **v6 → `^7.0.0`**, `@astrojs/starlight` → **`^0.41.0`**, `@astrojs/mdx` `^7.0.0`, `@astrojs/react` `^5.0.0`, `vitest` → **`^4.0.0`**, `react`/`react-dom` **19.3.0**, `playwright` **1.63.0**, `shiki` 3.23.0, `monaco-editor` 0.56.0, `sharp` `^0.35.0`. Root: **pnpm `11.24.0` → `11.26.0`**; **`.node-version` `24.20.0` → `24.21.0`** (`engines.node` floor holds `>=22.13.1`, `engines.pnpm` `>=11.8.0`); `@bfra.me/eslint-config` **`0.51.2` → `0.52.1`** (PR #1956); `tsx` `4.23.12` → `4.23.13`; **`typedoc` 0.28.20 added at the workspace root** as the #2027 hoist workaround (PR #2048, open, removes it). `turbo` 2.10.12, `prettier` 3.9.6, `eslint` 9.39.5, `@types/node` 24.13.3, `tsdown` 0.16.8, `@changesets/cli` 2.31.1, `@axe-core/cli` 4.13.0, `@manypkg/cli` 0.25.1, `markdownlint` 0.39.0, `consola` 3.4.2, TypeScript `5.9.3` — all unchanged. **`@lhci/cli` is gone from root devDependencies** (present since 2026-07-11). `pnpm-workspace.yaml` `overrides` grew to **14 entries** (`@xmldom/xmldom` ×2, `adm-zip`, `brace-expansion` ×2, `decode-uri-component`, `dompurify`, `fast-uri`, `js-yaml` ×2, `nanoid`, `postcss`, `svgo`, `tmp`) and gained a new **`minimumReleaseAgeExclude`** list (three `@bfra.me/*` pins) — a per-version escape hatch from the preset's release-age quarantine. `allowBuilds` (pnpm 11 form) and `onlyBuiltDependencies` (legacy form) both present with identical six-entry contents; `ignoredBuiltDependencies: ['@tailwindcss/oxide']`; `shamefullyHoist: true`. **`llms.txt` no longer text-declares any version** — see §5 above.

_Toolchain drift (2026-05-23 survey at SHA `e757fa6`):_ pnpm 10.33.4, Node.js 24.16.0, Turborepo 2.9.14, `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (still `120-proof`), `@bfra.me/tsconfig` 0.13.1. TypeScript 5.9.3 unchanged. No engine-level shifts — strict-mode TypeScript + ESM-only `"type": "module"` are stable invariants across surveys.

_Toolchain drift (2026-06-05 survey at SHA `e03e317`):_ pnpm bumped to `10.34.1` (root `packageManager` field updated). Node.js 24.16.0 unchanged. `llms.txt` still references pnpm `10.33.4` — minor doc drift. No other engine-level changes confirmed from manifest inspection.

_Toolchain drift (2026-06-16 survey at SHA `5ccf106`):_ pnpm `10.34.1` → `10.34.3` (root `packageManager`). Turborepo `2.9.14` → `2.9.18`. `@types/node` now pinned at `24.13.2`; `prettier` `3.8.4`; `tsdown` `0.16.8`; `tsx` `4.22.4`. `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (`120-proof`), `@bfra.me/tsconfig` 0.13.1, TypeScript 5.9.3 — all unchanged. `engines` floor remains `node >=22.13.1` / `pnpm >=9.15.4`; `.node-version` pins 24.16.0. `llms.txt` still references pnpm `10.33.4` — the doc drift has now widened by two patch releases (actual `10.34.3`). Strict-mode TypeScript + ESM-only `"type": "module"` remain stable invariants.

_Toolchain drift (2026-06-27 survey at SHA `81cbd99`):_ pnpm `10.34.3` → `10.34.4` (root `packageManager`). `.node-version` bumped `24.16.0` → **`24.18.0`** (first Node minor bump since 24.16.0 held across four surveys). Turborepo `2.9.18`, `@types/node` `24.13.2`, `prettier` `3.8.4`, `tsdown` `0.16.8`, `tsx` `4.22.4` — all unchanged. `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (`120-proof`), `@bfra.me/tsconfig` 0.13.1, TypeScript 5.9.3 — all unchanged. `engines` floor remains `node >=22.13.1` / `pnpm >=9.15.4`. `llms.txt` **still pins `pnpm@10.33.4` and `node 24.x`** — the pnpm doc drift now widens to three patch releases behind actual `10.34.4`, and the Node pin in docs no longer names the concrete `.node-version` value. The `category 3` autoheal prompt explicitly checks `llms.txt` accuracy and "open an issue (not a PR)" on drift — yet the drift persists across multiple surveys, suggesting the llms.txt accuracy check isn't firing or the drift isn't being flagged. Worth confirming on next survey.

_Toolchain drift (2026-07-28 survey at SHA `9c215ee`):_ Steady patch-level cadence after the v11 major cutover. **pnpm `11.10.0` → `11.17.0`** (root `packageManager`; `engines.pnpm` floor holds `>=11.8.0`). **turbo `2.10.4` → `2.10.7`** (HEAD commit itself is `chore(dev): update dependency turbo to v2.10.7` #1876, mrbro-bot/Renovate). `prettier` `3.9.4` → `3.9.6`; `tsx` `4.23.0` → `4.23.1`; `@types/node` `24.13.2` → `24.13.3`; `eslint` `9.39.4` → `9.39.5`; `@changesets/cli` `2.31.0` → `2.31.1`. `.node-version` holds `24.18.0`; `engines.node` floor `>=22.13.1`. `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (`120-proof`), `@bfra.me/tsconfig` 0.13.1, `tsdown` 0.16.8, TypeScript 5.9.3, `consola` 3.4.2, `@axe-core/cli` 4.12.1, `@lhci/cli` 0.15.1, `markdownlint` 0.39.0 — all unchanged. Strict-mode TypeScript + ESM-only `"type": "module"` remain stable invariants. **llms.txt drift persists and remains unremediated:** `llms.txt` line 40 still text-declares `packageManager: pnpm@10.33.4` (now a full major plus seven minors behind actual `11.17.0`) and line 41 still names Node only as `24.x`. Autoheal-authored issue **#1800** (opened 2026-07-11) is **still OPEN** — the category-3 check surfaced the drift but no fix PR has landed against `llms.txt` itself. The autoheal loop flags-but-does-not-heal the doc: it opens an issue (per prompt contract) rather than editing the file, and the human hasn't actioned #1800 across two surveys.

_Toolchain drift (2026-08-29 survey at SHA `8508b71`):_ Steady patch/minor cadence, no engine-level shift. **pnpm `11.17.0` → `11.24.0`** (root `packageManager`; `engines.pnpm` floor holds `>=11.8.0`). **turbo `2.10.7` → `2.10.12`**; **tsx `4.23.1` → `4.23.12`** (a multi-patch jump); `@axe-core/cli` `4.12.1` → `4.13.0`. **`.node-version` `24.18.0` → `24.20.0`** (`engines.node` floor holds `>=22.13.1`). `@bfra.me/*` toolchain nudged: `@bfra.me/eslint-config` `0.51.1` → `0.51.2`, `@bfra.me/prettier-config` `0.16.9` → `0.16.11` (still `120-proof`), `@bfra.me/tsconfig` `0.13.1` → `0.13.2`. `eslint` `9.39.5`, `prettier` `3.9.6`, `@types/node` `24.13.3`, `tsdown` `0.16.8`, `@changesets/cli` `2.31.1`, `consola` `3.4.2`, `@lhci/cli` `0.15.1`, `markdownlint` `0.39.0`, TypeScript `5.9.3` — all unchanged. Strict-mode TypeScript + ESM-only `"type": "module"` remain stable invariants. **llms.txt drift persists and widens further:** `llms.txt` still text-declares `packageManager: pnpm@10.33.4` — now a full major plus **fourteen** minors behind actual `11.24.0` — and still names Node only as `24.x`. Autoheal-authored issue **#1800** (opened 2026-07-11) is **still OPEN across three surveys**; the category-3 check flags but does not heal (see "llms.txt drift: flagged but unhealed" under Notable Patterns).

_Toolchain drift (2026-07-11 survey at SHA `2ef1cf1`):_ **Major version cutover: pnpm `10.34.4` → `11.10.0`** (root `packageManager`) — the pnpm v11 security bump (PR #1773 at the 2026-06-27 survey) has landed. `engines.pnpm` floor raised `>=9.15.4` → **`>=11.8.0`** to match. Turborepo `2.9.18` → **`2.10.4`** (first minor bump since the 2.9 line). `prettier` `3.8.4` → `3.9.4`; `tsx` `4.22.4` → `4.23.0`. `@axe-core/cli` now pinned `4.12.1`; `@lhci/cli` `0.15.1`; `markdownlint` `0.39.0` present as devDeps. `.node-version` holds at `24.18.0`. `@types/node` `24.13.2`, `tsdown` `0.16.8`, `@bfra.me/eslint-config` 0.51.1, `@bfra.me/prettier-config` 0.16.9 (`120-proof`), `@bfra.me/tsconfig` 0.13.1, TypeScript 5.9.3, `consola` 3.4.2 — all unchanged. `engines.node` floor remains `>=22.13.1`. **The `llms.txt` drift is now being flagged:** fro-bot opened issue **#1800** ("llms.txt drift: pnpm version reference is stale"). `llms.txt` still text says `packageManager: pnpm@10.33.4` (now four-plus releases behind actual `11.10.0`, and a full major behind), but the category-3 autoheal check **is firing** — resolving the prior open question about whether the llms.txt accuracy check was working. Strict-mode TypeScript + ESM-only `"type": "module"` remain stable invariants.

## Architecture

### Workspace Layout

```
sparkle/
├── apps/
│   ├── fro-jive/           # Expo/React Native mobile app
│   └── moo-dang/           # WASM web shell app (Vite)
├── packages/
│   ├── ui/                 # @sparkle/ui — React component library (Radix + Tailwind)
│   ├── theme/              # @sparkle/theme — Cross-platform design tokens
│   ├── types/              # @sparkle/types — Shared TypeScript definitions
│   ├── utils/              # @sparkle/utils — Utility functions and React hooks
│   ├── config/             # @sparkle/config — Shared build and lint configs
│   ├── storybook/          # Component development environment
│   ├── error-testing/      # @sparkle/error-testing — Error handling utilities
│   └── test-utils/         # Testing utilities
├── docs/                   # @sparkle/docs — Astro Starlight documentation site
├── scripts/                # Build validation and health-check utilities
├── docs-legacy/            # Legacy documentation (retained; absent from root tree since 2026-06-16)
├── .ai/                    # AI context (analysis, audit, notes, plan, review, security)
├── .deciduous/             # Decision graph: config.toml + sync/{nodes,edges,themes,tags} (new 2026-09-08)
└── .changeset/             # Changesets configuration
```

_Package and app membership is unchanged across all eleven surveys: `packages/{config,error-testing,storybook,test-utils,theme,types,ui,utils}` and `apps/{fro-jive,moo-dang}`._

### Build Graph (Turborepo)

Turborepo orchestrates builds via fine-grained task dependencies. Package-specific tasks use `build:packagename` convention:

- `build:types` → no deps (leaf)
- `build:utils` → depends on `@sparkle/types#build:types`
- `build:theme` → depends on `types` + `utils`
- `build:config` → depends on `theme`
- `build:ui` → depends on `config`
- `build:storybook` → depends on `ui` + `theme`
- `build:docs` → depends on `docs:automation` + `ui` + `theme` + `types` + `utils`
- `build:moo-dang` → depends on `ui` + `theme` + `types` + `utils`

### Design System

Cross-platform theme management via `@sparkle/theme`:

- Design tokens (light/dark modes)
- Web: CSS custom properties
- Native: StyleSheet integration
- Tailwind CSS integration via generated config

### Component Library

`@sparkle/ui` built on:

- Radix UI primitives for accessibility
- Tailwind CSS for styling
- React `forwardRef` pattern
- Storybook for development and documentation

### Documentation Site

Astro Starlight at `docs/` with automated documentation generation:

- TypeDoc for API reference extraction
- Custom JSDoc extraction scripts (`docs/scripts/`)
- Component playground via Storybook integration
- Deployed to GitHub Pages at https://sparkle.mrbro.dev
- Auto-regeneration workflow creates PRs when package source changes

## Repository Structure — Key Files

| File/Dir | Purpose |
| --- | --- |
| `turbo.json` | Task graph and caching configuration |
| `pnpm-workspace.yaml` | Workspace packages: `packages/*`, `apps/*`, `docs`, `scripts` |
| `.node-version` | Node.js 24.20.0 |
| `eslint.config.ts` | Root ESLint config |
| `tsconfig.json` / `tsconfig.node.json` | TypeScript project references |
| `.github/actions/setup-ci/` | Composite CI setup action |
| `.github/copilot-instructions.md` | AI agent development guide |
| `.ai/` | AI context files (analysis, audit, notes, plan, review, security) |
| `.changeset/config.json` | Changesets versioning config |
| `opencode.jsonc` | OpenCode config — `instructions` points to `.github/copilot-instructions.md` |

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Setup → Check (monorepo, types, deps, lint) → Build |
| Deploy Docs | `deploy-docs.yaml` | push to `main` (docs/packages paths), dispatch | Build Astro Starlight site, deploy to GitHub Pages |
| Regenerate Docs | `regenerate-docs.yaml` | push to `main` (package source), dispatch | Auto-generate docs from JSDoc, create PR with changes |
| Renovate | `renovate.yaml` | issues, PR, push to non-main, dispatch, workflow_run | Dependency updates via `bfra-me/.github` reusable workflow |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily 11:43 UTC, dispatch | Probot settings sync via `bfra-me/.github` reusable workflow |
| Cache Cleanup | `cleanup-cache.yaml` | PR close, weekly Sunday 00:00 UTC, dispatch | Clean up Actions caches |
| **Fro Bot** | **`fro-bot.yaml`** | **PR open/sync, issues, comments (@fro-bot), schedule (05:00 + 17:00 UTC), dispatch** | **PR review + daily maintenance (17:00) + autoheal (05:00)** |

### CI Jobs (main.yaml)

1. **Setup** — checkout + setup-ci composite action (pnpm install, optional Zig install)
2. **Check** — `pnpm check` (monorepo consistency, type-check, Turbo validation, dependency validation, ESLint)
3. **Build** — `pnpm build` (full Turborepo build graph, includes Zig support)

### Branch Protection

Required status checks on `main`: `Build`, `Check`, `Renovate / Renovate`, `Setup`. Enforces admins, linear history, no required PR reviews.

### Automated Documentation Pipeline

The `regenerate-docs.yaml` workflow detects package source changes, runs TypeDoc/JSDoc extraction, and creates a PR via `peter-evans/create-pull-request`. Commits are authored by `mrbro-bot[bot]` (app 137683033). Force rebuild option available via dispatch.

## Fro Bot Integration

**Fro Bot agent workflow detected as of 2026-06-05 survey (SHA `e03e317`).** The `fro-bot.yaml` workflow was added since the 2026-05-23 survey (it was absent at SHA `e757fa6`). This resolves the previously flagged gap.

### Workflow: `fro-bot.yaml`

- **Agent version (2026-09-13):** `fro-bot/agent@620a314e241ec2f4a72167eb1ad2c5a3a909cc86` — **v0.111.0**. Thirteen Renovate bumps in sixteen days (v0.105.1 → v0.106.0 → v0.106.2 → v0.107.0 → v0.107.1 → v0.107.2 → v0.107.3 → v0.108.1 → v0.109.0 → v0.109.2 → v0.109.3 → v0.109.4 → v0.110.0 → v0.110.1 → v0.111.0), each its own merged PR. The repo tracks the agent release cadence more aggressively than anything else in the fleet, and the 09-13 autoheal report verifies its own pin against latest as a cross-project-intelligence line item.
- **Prior agent version:** `fro-bot/agent@e9501a93f428fec4eedcef3f11ee97bbd903d6e8` (**v0.105.1** as of 2026-08-29 survey; was `4ad0054...` v0.95.0 at 2026-07-28, `e7453bd...` v0.85.0 at 2026-07-11, `720b721...` v0.79.1 at 2026-06-27, `b7efdd6...` v0.65.0 at 2026-06-16, `07820934...` v0.54.2 at 2026-06-05). The repo continues to track the agent release cadence aggressively — ~a full minor per survey, now crossing the cosmetic v0.100 line. The action ref pins `actions/checkout@d23441a` v6.1.0 in the fro-bot job (unchanged since 2026-07-28).
- **Triggers:**
  - `pull_request` (opened, synchronize, reopened, ready_for_review, review_requested)
  - `issues` (opened, edited) — from OWNER/MEMBER/COLLABORATOR only
  - `issue_comment` / `pull_request_review_comment` / `discussion_comment` — `@fro-bot` mentions from trusted author associations
  - `schedule`: autoheal at `0 5 * * *` (05:00 UTC), maintenance at `0 17 * * *` (17:00 UTC)
  - `workflow_dispatch` with `mode` input: `review` / `maintenance` / `autoheal` (default: `autoheal`)
- **Permissions:** `contents: write`, `issues: write`, `pull-requests: write`, `discussions: write`
- **Token:** `FRO_BOT_PAT` for checkout and GitHub operations
- **Setup:** Uses `./.github/actions/setup-ci` with Zig install enabled — full project setup before each run

### Embedded Prompts

The workflow carries three inline prompts (~9000 tokens combined):

- **`PR_REVIEW_PROMPT`:** 7-focus-area review targeting cross-package side effects, ESM invariants, TypeScript strict, cross-platform theme, Vitest coverage, security, and changeset coverage. Verdict format: `PASS | CONDITIONAL | REJECT`.
- **`MAINTENANCE_PROMPT`:** Perpetual issue "Daily Maintenance Report" updated daily at 17:00 UTC. 14-day rolling window, historical summary, 9 sections including cross-project intelligence, docs site health, and Renovate dashboard state.
- **`AUTOHEAL_PROMPT`:** Perpetual issue "Daily Autohealing Report" updated daily at 05:00 UTC. 8 categories: errored PRs, security, code quality, DX fixes, quality gates, docs site health (live via agent-browser), cross-project intelligence, and upstream modernization watch (Sundays only). Scope cap and dependency ownership rules match the ecosystem standard.

### Delivery-Mode Gate (new 2026-09-06)

`fro-bot.yaml` is 800 lines / 38 KB at the 2026-09-13 survey. Structure beyond the three prompts:

| Element | Value |
| --- | --- |
| Workflow-level `permissions` | `contents: read` |
| Job-level `permissions` | `contents`/`issues`/`pull-requests`/`discussions: write` |
| Checkout | `actions/checkout@d23441a` v6.1.0, `fetch-depth: 0`, `token: FRO_BOT_PAT`, **`persist-credentials: false`** |
| Delivery gate | `Resolve delivery mode` step (`id: gate`) → `branch-pr` for autoheal cron `0 5` + autoheal/bare dispatch; `working-dir` otherwise |
| Credential restore | Conditional on `steps.gate.outputs.branch-pr == 'true'`; masked `http.extraheader` written to `.git/config` (env is scrubbed by the agent) |
| Agent input | `output-mode: ${{ steps.gate.outputs.output-mode }}` |
| Concurrency | Keyed on issue/PR/discussion number, else cron expression, else `run_id`; `cancel-in-progress: false` |

The gate is the single source of truth for both the credential and the agent input, which is the property that prevents the two from drifting. See §2 of the 2026-09-13 survey section above.

### Fork Guard

The workflow has an explicit fork PR head refusal step on `issue_comment` triggers — resolves the event-context gap in job-level fork guards. It reads `.head.repo.fork // "unknown"` and refuses on anything that is not the literal `false`, so it **fails closed** on `unknown` — the correct polarity, and the inverse of the fail-open case cataloged in [[github-actions-ci]].

### Daemon Liveness (2026-09-13)

Two scheduled runs per day, **unbroken success** across the entire 08-24 → 09-13 window (40 consecutive scheduled runs; one `cancelled` on 09-12T05:15, no failures). Contrast with [[bfra-me--ha-addon-repository]] (17 consecutive scheduled failures invisible behind a skip-on-PR required check) and [[marcusrbrown--cortexkit-anthropic-auth]] (`disabled_inactivity`). Non-scheduled `fro-bot.yaml` events are ~87% `skipped` — the trigger surface is overwhelmingly bot-authored PRs, which the job-level `if` excludes by design.

### Schedule Stagger

- **Autoheal 05:00 UTC** — staggered from mrbro.dev (03:30), marcusrbrown (04:30), tokentoilet (03:30)
- **Maintenance 17:00 UTC** — staggered from marcusrbrown (16:30) and mrbro.dev (15:30)

### Active Perpetual Issues

_2026-09-13 status: every fro-bot hygiene issue tracked on this page has closed. #1664 and #1940 closed 09-06T16:52, #1799 20:29, #1937 21:11, #1800 14:48 — all on the same day, within the human's audit session. Only the two perpetual reports remain, plus a fresh **#2035 "Stale TODOs"** (fro-bot, opened 09-07) carrying a single ~567-day-old TODO in `apps/fro-jive/components/__tests__/StyledText.test.tsx:1`. **#1665** is now 45,239 characters — a rolling multi-day append log with no observed rotation; compare [[marcusrbrown--cortexkit-anthropic-auth]], where a 54,813-char perpetual issue against a 50,000-char rotation directive is the proximate suspect for six weeks of silent output loss. Sparkle is ~5,000 characters from the same threshold and still writing._

- **#1665** — "Daily Autohealing Report" (open, `fro-bot`-authored, first run 2026-06-05; still open at 2026-07-11)
- **#1666** — "Daily Maintenance Report" (`fro-bot`-authored; observed **OPEN** at the 2026-06-27 and 2026-07-11 surveys, after being **CLOSED** at 2026-06-16). **Resolved:** the maintenance perpetual issue is back in the open/reused state the 17:00 UTC prompt intends. The MAINTENANCE_PROMPT explicitly instructs reopening a closed matching issue rather than creating a new one ("If the most recent matching issue is closed, reopen it instead of creating a new one"), which matches the observed transition CLOSED → OPEN on the same issue number. The earlier closure was a transient state, not a lifecycle bug.
- **#1800** — "llms.txt drift: pnpm version reference is stale" (`fro-bot`-authored, opened by autoheal, observed at 2026-07-11; **still OPEN at 2026-08-29**). **Resolves the prior open question:** the AUTOHEAL_PROMPT category-3 llms.txt-accuracy check *is* firing — it correctly opened an issue (not a PR, per the prompt's "open an issue" instruction) flagging the stale `pnpm@10.33.4` reference. **New observation (2026-08-29):** the issue has now sat open across **three** surveys and `llms.txt` still text-declares `pnpm@10.33.4` (actual is `11.24.0` — a full major plus fourteen minors ahead). The check flags but does not heal — remediation waits on a human to close #1800, which hasn't happened. See the "llms.txt drift: flagged but unhealed" note under Notable Patterns.
- **#1799** — "Stale TODOs" (`fro-bot`-authored, opened by autoheal, observed at 2026-07-11) — companion to the older #1664 stale-annotation review issue.
- **#1937** — "Convention drift: residual `any` / `@ts-expect-error` / non-Error class usage in src/" (`fro-bot`-authored, opened by autoheal, first observed 2026-08-29). The autoheal daemon now surfaces the repo's own no-class / no-`any` conventions (from `copilot-instructions.md`) as a hygiene issue where `src/` violates them — a code-quality category-3/4 flag, again as an issue rather than a fix PR.
- **#1940** — "moo-dang#test flaky: turbo.json package-specific build task aliases (build:ui/build:config/build:types/build:utils) missing from most package.json scripts" (`fro-bot`-authored, opened by autoheal, first observed 2026-08-29). Third distinct surfacing of the recurring `moo-dang` cross-package build-reachability class (after #1681 Turbo-graph and #1875 manifest-declaration) — this one points at the `turbo.json` package-specific task aliases lacking matching `package.json` scripts, which is the Turbo-side twin of the #1940 symptom. Corroborates the "worth a lint that asserts every `@sparkle/*` coupling is declared" recommendation.

The repo also has:

- Probot settings via `.github/settings.yml`. **Correction (2026-09-13):** the file reads `_extends: .github:common-settings.yaml` — owner-relative, therefore **`marcusrbrown/.github`** ([[marcusrbrown--github]]), not `fro-bot/.github` as recorded from 2026-04-28 through 2026-08-29. Both readings preserved per the additive rule; the direct file read is authoritative.
- Renovate via `bfra-me/.github` reusable workflow (v4.27.0 at 2026-09-13) extending `marcusrbrown/renovate-config#5.2.13`
- GitHub App tokens via `actions/create-github-app-token` (for regenerate-docs workflow)
- `opencode.jsonc` — OpenCode config pointing to `.github/copilot-instructions.md` for instructions

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.12` (was `#5.2.9` at 2026-07-28, `#5.2.0` at 2026-07-11; major-bumped from `#4.5.9` between 2026-05-01 and 2026-05-23 — same ecosystem-wide cutover seen across the Marcus and Fro Bot portfolios) + `sanity-io/renovate-config:semantic-commit-type` + `:preserveSemverRanges`. Post-upgrade runs `pnpm bootstrap && pnpm fix`. React Native package grouping rules. Automerge on unstable minor/patch for `@astrojs/check` and `typedoc`. PR creation: `immediate`.
- **OpenCode config:** `opencode.jsonc` added at root — points `instructions` to `.github/copilot-instructions.md`. First survey confirmation of OpenCode config presence in this repo.
- **Probot Settings:** `_extends: .github:common-settings.yaml` → **`marcusrbrown/.github`** (see correction above). Fro Bot ecosystem membership is established by `fro-bot.yaml`, not by settings inheritance.
- **Decision graph:** `.deciduous/` + `pnpm bootstrap-graph` (`scripts/bootstrap-graph.ts`). Git-tracked JSON records reconciled against per-machine SQLite via `deciduous sync`; edges reference `change_id`, tombstones via `deleted_at`. New 2026-09-08.
- **Git hooks:** `simple-git-hooks` runs `nano-staged` on pre-commit. nano-staged runs `eslint --fix` on TS/JS/CSS/MD/JSON/YAML and `sort-package-json` on package.json files.
- **Monorepo validation:** `@manypkg/cli` checks workspace consistency. `scripts/validate-dependencies.ts` validates deps. `scripts/validate-turbo.ts` validates Turbo config. `scripts/validate-build.ts` validates build output.
- **Health check:** `scripts/health-check.ts` validates workspace, dependencies, TypeScript setup, and environment.
- **Error reporting:** `scripts/enhanced-error-reporter.ts` wraps `tsc` with better error output.
- **AI context:** `.github/copilot-instructions.md` (comprehensive), `.ai/` directory (analysis, audit, notes, plan, review, security subdirs). No root `AGENTS.md` observed.
- **Versioning:** Changesets (`@changesets/cli` 2.31.0) — pre-release changeset `initial-theme-release.md` present.
- **`consola`:** Required logger (no `console.log` per conventions).

## Notable Patterns

- **Cross-platform design system:** The `@sparkle/theme` + `@sparkle/ui` combo provides a design token pipeline from shared tokens to CSS custom properties (web) and StyleSheet objects (native). This is the only Marcus repo attempting cross-platform UI.
- **Expo/React Native app:** `apps/fro-jive` is an Expo mobile application — unique in the portfolio. `apps/moo-dang` is a WASM web shell — also unique.
- **Astro Starlight documentation:** Full documentation site with automated TypeDoc generation, accessibility auditing, and GitHub Pages deployment. The docs pipeline is more sophisticated than any other Marcus repo.
- **Zig support:** The CI setup action optionally installs Zig, and the repo has Zig source code (21KB per language stats). Purpose unclear from top-level manifest.
- **No-class convention:** Per copilot-instructions, avoids ES6 classes except for Error extensions — consistent with [[marcusrbrown--vbs]] functional pattern.
- **Enhanced error reporting:** Custom TypeScript error reporter wrapping `tsc --noEmit` with better DX — novel tooling not seen in other repos.
- **`nano-staged` vs `lint-staged`:** Sparkle uses `nano-staged` (smaller, faster), while most other Marcus repos use `lint-staged`. Both serve the same purpose.
- **`mrbro-bot[bot]` for commits:** Doc regeneration PRs authored by `mrbro-bot[bot]` (app 137683033), same as [[marcusrbrown--marcusrbrown]].
- **`fro-bot` as active PR author:** As of 2026-06-05, Fro Bot is opening PRs (#1681 Turbo fix, #1663 docs regen) in addition to the mrbro-bot[bot] automation — confirming the Fro Bot autoheal workflow is running and making commits.
- **Turbo task graph gap:** PR #1681 reveals a cold-cache Turborepo invariant: `@sparkle/test-utils` sub-path exports (`/dom`, `/console`) were not reachable in `moo-dang` tests because the `build:test-utils` task was missing from test task dependencies. This is a structural Turborepo pitfall when packages use sub-path exports that require a build step.
- **Oldest repo by creation date:** Created 2020-11-26, predating most other Marcus repos. Actively maintained despite age.
- **pnpm v11 major landed (2026-07-11):** The security-flagged pnpm v11 bump (PR #1773) merged, moving root `packageManager` to `pnpm@11.10.0` and raising the `engines.pnpm` floor to `>=11.8.0`. This is the first pnpm major cutover observed in this repo across the survey series — worth watching whether the portfolio follows on the same security-driven cadence.
- **Autoheal lint-fix PR archetype:** As of 2026-07-11 the open PR queue carries two `chore(lint): apply auto-fixes from autohealing run` PRs (#1787, #1816) authored by fro-bot. This is a new PR shape distinct from the earlier Turbo-fix and docs-regen PRs — the autoheal loop now lands its own ESLint `--fix` output as reviewable PRs rather than direct commits.
- **llms.txt drift now self-reported:** The persistent `pnpm@10.33.4` reference in `llms.txt` — flagged across five surveys as possibly-unchecked — is now covered by fro-bot-authored issue #1800. The category-3 autoheal llms.txt-accuracy check demonstrably fires and opens an issue (not a PR) on drift, matching the AUTOHEAL_PROMPT contract.
- **llms.txt drift: flagged but unhealed (2026-07-28):** Two surveys after #1800 opened, `llms.txt` line 40 *still* text-declares `pnpm@10.33.4` while the manifest is at `11.17.0`. This surfaces the boundary of the autoheal contract: the category-3 check opens an issue rather than a fix PR, so remediation depends on a human closing the loop — and #1800 has sat OPEN across 2026-07-11 → 2026-07-28. The daemon can see the drift but is contractually not allowed to patch the doc itself. If the goal is self-healing docs, the prompt would need to permit a `docs(llms)` fix PR for this narrow, mechanical case; as written it will keep re-flagging the same stale line.
- **Security-override PR archetype (2026-07-28):** Two open fro-bot autoheal PRs (#1866 brace-expansion `GHSA-mh99-v99m-4gvg`, #1862 postcss `GHSA-6g55-p6wh-862q`) remediate Dependabot alerts by adding `pnpm.overrides` entries in `pnpm-workspace.yaml` and regenerating the lockfile — forcing transitive dev-tooling deps up to a patched floor rather than waiting for the upstream package to bump. This is a distinct autoheal category-2 (security) shape from the earlier lint-fix and docs-regen archetypes: it targets transitive vulns that Renovate's direct-dependency model can't reach. The pattern (`pnpm.overrides` with `adm-zip`/`tmp` precedent noted in #1862's body) is the correct lever for pnpm workspaces — the alternative of pinning each intermediate package would be brittle chrome.
- **Recurring moo-dang test-utils dep gap (2026-07-28):** PR #1875 re-fixes the same class of bug PR #1681 addressed (2026-06-05): `apps/moo-dang` test files import `@sparkle/test-utils` subpaths (`/console`, `/dom`, `/react`, `/terminal`) but the package was never declared as a `workspace:*` devDependency. Under pnpm's strict non-hoisted linking this leaves the package unresolved. #1681 fixed the *Turbo task-graph* reachability (missing `build:test-utils` dependency); #1875 fixes the *package.json declaration* gap. Same root symptom — undeclared cross-package coupling in `moo-dang` tests — surfacing through two different resolution layers. Worth a lint that asserts every `@sparkle/*` import has a matching manifest entry.

- **Autoheal PR backlog accretion (2026-08-29):** The open PR queue jumped **3 → 15** in one survey interval, and **13 of 15 are fro-bot autoheal-authored** — none merging. The queue now stacks every archetype this repo has grown: lint auto-fixes (#1787, #1816, #1883, #1886, #1891, #1914 — six of them), security `pnpm.overrides` (#1838 adm-zip `GHSA-xcpc-8h2w-3j85`, #1862 postcss, #1866 brace-expansion, #1904 nanoid `GHSA-2v37-7h3g-55p8`), the moo-dang test-utils manifest fix (#1875), plus new correctness fixes (#1841 theme spacing-scale zero-anchor check, #1844 broken docs font preload). This is the same **propose-without-merge** dynamic catalogued in [[marcusrbrown--marcusrbrown-github-io]] and [[marcusrbrown--mrbro-dev]]: the daemon reliably *opens* fixes but the merge gate is human, and the human hasn't drained the queue. Six near-identical `chore(lint): apply auto-fixes from autohealing run` PRs stacking without consolidation is the sharpest signal — each autoheal run re-emits its lint delta as a fresh PR rather than updating or superseding the prior one, so the queue grows monotonically. Worth a dedup/supersede rule on the lint-fix archetype, or an automerge lane for the mechanical lint/security-override classes.
- **Convention-drift self-report (2026-08-29):** New issue #1937 has the autoheal daemon auditing `src/` against the repo's *own* declared conventions (no ES6 classes except Error extensions, no `any`, no `@ts-expect-error`) and filing the residual violations as an issue. This is the code-quality analogue of the llms.txt self-report (#1800): the daemon can *see* the drift from the copilot-instructions contract but files-not-fixes, consistent with the autoheal issue-vs-PR boundary. **Resolved 2026-09-06 (#2015) — by rewriting the rule, not the code.** See §6 above.

- **A doc that restates a manifest value should point at it instead (2026-09-13):** The definitive close of the five-survey `llms.txt` saga. The drift was never a maintenance failure; it was a **duplication of a fact that already had a single source**. Re-syncing `pnpm@10.33.4` → `pnpm@11.24.0` would have restarted the clock. Replacing the literal with "exact version pinned by `packageManager` in the root `package.json`" ends the class. The generalizable rule: when an accuracy check keeps firing on the same line, ask whether the line should exist, not whether it should be updated. Cataloged in [[github-actions-ci]].

- **A green pipeline can be a wrong pipeline (2026-09-13):** The docs generator produced incorrect API documentation for an extended period while every regeneration run concluded `success` (#2022 build ordering, #2023 `skipErrorChecking: true` as the suppressor). This extends the fleet-wide _a run's conclusion measures the harness, not the deliverable_ finding ([[marcusrbrown--cortexkit-anthropic-auth]], [[marcusrbrown--github]]) from **liveness** to **correctness**: not "the daemon ran but delivered nothing," but "the daemon ran, delivered, and the artifact was wrong." The only instrument that caught it was a human diffing generated output against source. The durable ask: a generator whose failure mode is silent-wrong-output needs an assertion on the *artifact*, not on the exit code.

- **A build-allowlist failure has no owner (2026-09-13):** PR #2036's `ERR_PNPM_IGNORED_BUILDS` on `@parcel/watcher@2.6.0` sits in the gap between Renovate's mandate (version bumps only) and autoheal's category definitions (category 1 excludes dependency PRs; category 2 covers only security PRs). Six days red on a one-line fix, correctly reported every night, actioned by nobody. See §7 above.

- **Consolidation beats sequential rebase when PRs share a hunk (2026-09-13):** #2002's stated reasoning is the generalizable part — #1838/#1862/#1866 all edited the same `overrides` block, so "rebasing them sequentially means three rounds of the same merge resolution. One entry point is cheaper and easier to review." The daemon had already paid that cost seven times over in branch maintenance. A fleet rule falls out: **when N autoheal PRs touch the same hunk, the correct action is one consolidating PR, not N rebases** — and the daemon should be able to recognize the condition, since it is the one filing the conflict-resolution comments.

- **Renovate's Abandoned-Dependencies inference vs. a declared archive (2026-09-13):** #2032 draws the distinction explicitly. Renovate flags `doctrine` from release inactivity; GitHub's archive flag says the maintainers stopped on purpose in 2018. Inference from silence and a declared terminal state are different evidence with different confidence, and only the second is a fact. Same shape as [[bfra-me--ha-addon-repository]]'s Abandoned Dependencies observations, sharpened.

- **`shamefullyHoist: true` makes undeclared dependencies work until it makes them unreproducible (2026-09-13):** The #1812/#2027 case. A plugin importing `typedoc` with a bare specifier and declaring it nowhere resolved fine for months through the root hoist, then failed **only on `ubuntu-latest`** when the hoist produced a `package.json`-less stub directory. Identical lockfile, identical pnpm, no local reproduction. A hoist is a resolution fallback with no contract, so anything depending on it has undefined behavior that varies by platform and install order — and the symptom surfaces as a version bump that "can't be upgraded" rather than as a manifest bug.

## Shared Ecosystem Patterns

_Values below reflect the 2026-09-13 survey._

| Feature | Sparkle | Portfolio Standard |
| --- | --- | --- |
| Probot settings | `_extends: .github:common-settings.yaml` → **`marcusrbrown/.github`** (owner-relative; corrects the prior `fro-bot/.github` reading) | Same as [[marcusrbrown--github]] consumers |
| Renovate preset | `marcusrbrown/renovate-config#5.2.13` | Same |
| `bfra-me/.github` reusable | **v4.27.0** (`4861d88a`) | Fleet current |
| ESLint config | `@bfra.me/eslint-config` 0.52.1 | Same (version varies) |
| Prettier config | `@bfra.me/prettier-config` 0.16.11 (`120-proof`) | Same |
| TS config | `@bfra.me/tsconfig` 0.13.2 | Same |
| pnpm | 11.26.0 | ~11.x |
| Node.js | 24.21.0 | 22–24 |
| TypeScript | 5.9.3 | 5.9–6.0 |
| Fro Bot workflow | **Present** (`fro-bot.yaml`, agent **v0.111.0**) | Present in most active repos |
| Fro Bot autoheal | **Present** (05:00 UTC, categories 1–8, `branch-pr` delivery) | Present in most active repos |
| Delivery-mode gate | **Present** — single computed source for `output-mode` + credential | **Strongest observed**; cf. [[fro-bot--dashboard]] (output-mode only), [[marcusrbrown--tokentoilet]] (absent) |
| Maintenance report | **Present** (17:00 UTC perpetual issue) | Present in most active repos |
| Copilot setup steps | **Missing** | Present in most active repos |
| AGENTS.md | **Missing (root)** — `.github/copilot-instructions.md` is canonical | Present in most active repos |
| `opencode.jsonc` | **Present** (points to copilot-instructions.md) | Emerging pattern |
| Decision graph | **Present** (`.deciduous/`) | **Unique in the fleet** |

## Open PRs and Issues

_As of 2026-09-13 survey (SHA `e603ff5`):_

### Open PRs (2)

- **#2048** — `chore(deps): drop the workspace-root typedoc workaround` (`marcusrbrown`, opened 09-09, all checks green). Bumps `typedoc-plugin-frontmatter` to 1.3.2 (which now declares an explicit `typedoc` peer, fixing typedoc2md/typedoc-plugin-markdown#891) and removes the root `typedoc` devDependency added by #2027. `docs/package.json` keeps its own `typedoc` — that one is a direct use.
- **#2036** — `chore(deps): maintain lockfiles` (`mrbro-bot[bot]` / Renovate lockFileMaintenance, opened 09-07). **Red since creation**: `Setup` fails `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @parcel/watcher@2.6.0`, `renovate/artifacts` also FAILURE, `Check`/`Build` skipped, `Fro Bot` skipped (bot author). `MERGEABLE` but ungated by any actor with both capability and mandate — see §7.

_The 13-PR autoheal backlog from 2026-08-29 cleared entirely on 2026-09-06 (10 merged, 3 superseded by #2002). This is the lowest open-PR count recorded for this repo outside the 2026-06-16 zero-state, and the first time the queue emptied by **being worked** rather than by the daemon idling._

### Open Issues (8 non-PR)

- **#2035** — "Stale TODOs" (fro-bot, opened 09-07; successor to the closed #1799/#1664 — one ~567-day-old TODO in `apps/fro-jive/components/__tests__/StyledText.test.tsx:1`)
- **#2032** — "docs: JSDoc extraction depends on doctrine, archived since 2018" (`marcusrbrown`, **new**)
- **#2025** — "docs: force regeneration deletes hand-authored documentation" (`marcusrbrown`, **new** — `+1 −1858` on a forced run)
- **#2023** — "docs: skipErrorChecking masks TypeDoc resolution failures as wrong output" (`marcusrbrown`, **new**)
- **#1666** — "Daily Maintenance Report" (fro-bot perpetual issue, open, last written 09-12)
- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open, last written 09-13; **45,239 chars**)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD (`marcusrbrown`, open since 2025-09-07)
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Count moved 9 → 8, but the **composition inverted**. Every fro-bot hygiene issue closed (#1664, #1799, #1800, #1937, #1940), and three human-authored issues opened — all three about the documentation generator. The daemon's issue queue was drained and replaced by a queue the daemon could not have written, because each of the three required diffing an artifact against its source rather than reading a manifest._

**Open Dependabot state** (from the 09-13 autoheal report, not independently verified): `image-size` high ×2 (#228/#229) with `first_patched_version: null` — no upstream fix exists, transitive via metro/Expo, build-time only for `fro-jive`; `adm-zip` medium (#247); `joi` low ×2 (#243/#244). The high-severity pair is genuinely unfixable rather than unfixed, which is a distinct state from [[marcusrbrown--tokentoilet]]'s parked-but-mergeable security queue.

---

_As of 2026-08-29 survey (SHA `8508b71`):_

### Open PRs (15)

fro-bot autoheal-authored (13): **#1787, #1816, #1883, #1886, #1891, #1914** (six `chore(lint): apply auto-fixes from autohealing run` — #1883 is the variant `chore(lint): add missing fenced code block languages`); **#1838** (adm-zip override, `GHSA-xcpc-8h2w-3j85`), **#1862** (postcss override, carried from 2026-07-28), **#1866** (brace-expansion override, carried), **#1904** (nanoid override, `GHSA-2v37-7h3g-55p8`); **#1875** (moo-dang @sparkle/test-utils workspace dep, carried); **#1841** (theme spacing-scale zero-anchor consistency fix); **#1844** (remove broken `system-ui.woff2` docs font preload). Renovate/mrbro-bot (2): **#1812** (typedoc v0.28.20, carried from 2026-07-11), **#1956** (`@bfra.me/eslint-config` v0.52.1).

_The queue **quadrupled 3 → 15** since 2026-07-28. #1862/#1866/#1875 persist unmerged from the prior survey; #1787/#1816 (lint-fixes) resurfaced/persisted; everything else is new fro-bot autoheal output. HEAD `8508b71` is a Renovate typedoc-plugin-markdown bump (#1966) that already merged. See "Autoheal PR backlog accretion" under Notable Patterns — this is propose-without-merge, not throughput._

### Open Issues (9 non-PR)

- **#1940** — "moo-dang#test flaky: turbo.json package-specific build task aliases missing from most package.json scripts" (fro-bot, **new** — third surfacing of the moo-dang cross-package build-reachability class)
- **#1937** — "Convention drift: residual `any` / `@ts-expect-error` / non-Error class usage in src/" (fro-bot, **new** — autoheal auditing src/ against the repo's own conventions)
- **#1800** — "llms.txt drift: pnpm version reference is stale" (fro-bot, **still OPEN** across three surveys; `llms.txt` still pins `pnpm@10.33.4` vs actual `11.24.0`)
- **#1799** — "Stale TODOs" (fro-bot, opened by autoheal)
- **#1666** — "Daily Maintenance Report" (fro-bot perpetual issue, open)
- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD (marcusrbrown)
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Non-PR issue set grew 7 → 9: two new autoheal-authored hygiene issues (#1937 convention drift, #1940 moo-dang turbo aliases). The four steady-state issues (#1664/#1665/#1666/#212), the two carried autoheal issues (#1799/#1800), and the marcusrbrown feature issue (#876) all persist._

---

_As of 2026-07-28 survey (SHA `9c215ee`):_

### Open PRs (3)

- **#1875** — `fix(moo-dang): add missing @sparkle/test-utils workspace dependency` (fro-bot; autoheal category — declares `@sparkle/test-utils` as `workspace:*` devDep in `apps/moo-dang`, fixing 6/17 moo-dang test files that couldn't resolve subpath imports under pnpm strict linking. Verification: `pnpm check`/`build` clean, `pnpm test` 17/17 files 445 pass/1 skip. Same bug class as the earlier #1681 Turbo-graph fix, different layer.)
- **#1866** — `fix(deps): override brace-expansion to ^5.0.8 to remediate GHSA-mh99-v99m-4gvg` (fro-bot; autoheal category 2 security — high-severity DoS in `brace-expansion` <=5.0.7 pulled via `minimatch@10.2.x`. Fix: `pnpm.overrides` entry in `pnpm-workspace.yaml`.)
- **#1862** — `fix(deps): override postcss to ^8.5.12 to remediate GHSA-6g55-p6wh-862q` (fro-bot; autoheal category 2 security — high-severity arbitrary file read in PostCSS <8.5.12 pulled transitively via `@expo/metro-config` → `expo` in `apps/fro-jive`. Fix: `pnpm.overrides` forcing `postcss@^8.5.12`, resolves to 8.5.20.)

_The two fro-bot lint-fix PRs (#1787, #1816) and the Renovate typedoc PR (#1812) from the 2026-07-11 survey have all cleared. The queue is now dominated by **security-override PRs** (#1866, #1862) plus a **cross-package dependency-declaration fix** (#1875) — a shift from the lint-fix archetype toward transitive-vuln remediation and manifest hygiene. All three are fro-bot-authored autoheal output; Renovate is absent from the open queue this survey. HEAD commit `9c215ee` is a Renovate turbo bump (#1876) that already merged._

### Open Issues (7 non-PR)

- **#1800** — "llms.txt drift: pnpm version reference is stale" (fro-bot, **still OPEN** — see Active Perpetual Issues; `llms.txt` still pins `pnpm@10.33.4` vs actual `11.17.0`)
- **#1799** — "Stale TODOs" (fro-bot, opened by autoheal)
- **#1666** — "Daily Maintenance Report" (fro-bot perpetual issue, open)
- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD (marcusrbrown)
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Non-PR issue set is steady at 7 — identical to the 2026-07-11 set. No new autoheal issues opened; the daemon's fresh work landed as PRs (#1875, #1866, #1862) rather than issues this cycle._

---

_As of 2026-07-11 survey (SHA `2ef1cf1`):_

### Open PRs (3)

- **#1816** — `chore(lint): apply auto-fixes from autohealing run` (fro-bot; autoheal-authored lint auto-fix PR — new PR shape, the autoheal loop now landing its own lint-fix commits as PRs)
- **#1812** — `chore(dev): update dependency typedoc to v0.28.20` (mrbro-bot[bot] / Renovate; grouped non-major bump)
- **#1787** — `chore(lint): apply auto-fixes from autohealing run` (fro-bot; second autoheal lint-fix PR, same shape as #1816)

_The pnpm v11 security PR (#1773) and the grouped non-major PR (#1771) from the 2026-06-27 survey have both landed — confirmed by `packageManager: pnpm@11.10.0` in the manifest. The recurring docs-regen PR (#1745) also cleared. The queue is now dominated by **two fro-bot autoheal lint-fix PRs** (#1787, #1816) — a new PR archetype for this repo, distinct from the earlier Turbo-fix and docs-regen PRs._

### Open Issues (5 non-PR)

- **#1800** — "llms.txt drift: pnpm version reference is stale" (fro-bot, opened by autoheal — see Active Perpetual Issues)
- **#1799** — "Stale TODOs" (fro-bot, opened by autoheal)
- **#1666** — "Daily Maintenance Report" (fro-bot perpetual issue, open)
- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD (marcusrbrown)
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Non-PR issue set has grown with two fresh autoheal-authored issues (#1800 llms.txt drift, #1799 stale TODOs) on top of the four steady-state issues. The autoheal daemon is actively surfacing hygiene work._

---

_As of 2026-06-27 survey (SHA `81cbd99`):_

### Open PRs (3)

- **#1773** — `fix(deps): update pnpm to v11 [SECURITY]` (mrbro-bot[bot] / Renovate; security-flagged pnpm major bump — the kind of grouped security upgrade the autoheal category 2 prompt is told to shepherd if it stalls)
- **#1771** — `chore(dev): update all non-major dependencies to v4.12.1` (mrbro-bot[bot] / Renovate; grouped non-major bump)
- **#1745** — `docs: regenerate API docs from current JSDoc sources` (fro-bot; the recurring automated docs-regen PR, same shape as prior #1663)

_PR queue refilled from 0 → 3 since the 2026-06-16 clean state. Renovate is driving two of the three; the third is the standard fro-bot docs-regen PR._

### Open Issues (5 non-PR)

- **#1666** — "Daily Maintenance Report" (fro-bot perpetual issue, **now OPEN** — see Active Perpetual Issues)
- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Issue count 4 → 5: the difference is #1666 returning to the open set, not a new issue. Net steady state otherwise._

---

_As of 2026-06-16 survey (SHA `5ccf106`):_

### Open PRs (0)

No open PRs. All three PRs open at the 2026-06-05 survey (#1681 Turbo fix, #1663 docs regen, #1646 Renovate `@storybook/test-runner`) have since merged or closed. A clean PR queue while the autoheal/maintenance issues stay active reads as a healthy steady state — the daemon is keeping the deck clear.

### Open Issues (4 non-PR)

- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, open)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD
- **#212** — Dependency Dashboard (mrbro-bot / Renovate)

_Issue count steady at 4. Note: the "Daily Maintenance Report" issue **#1666** exists but is **CLOSED** — see Active Perpetual Issues above for the open question on maintenance-report lifecycle._

---

_As of 2026-06-05 survey (SHA `e03e317`):_

### Open PRs (3)

- **#1681** — `fix(turbo): add @sparkle/test-utils#build dependency to test tasks` (fro-bot; fixes cold-cache Turborepo build failure where `moo-dang` tests couldn't resolve `@sparkle/test-utils` sub-path exports)
- **#1663** — `docs: regenerate API docs from current JSDoc sources` (fro-bot; automated docs regeneration PR)
- **#1646** — `chore(dev): update dependency @storybook/test-runner to v0.24.4` (mrbro-bot[bot] / Renovate)

_Note: Astro v6 security PR #1604 from prior surveys is no longer in the open PR list — either merged or closed between 2026-05-23 and 2026-06-05._

### Open Issues (4 non-PR)

- **#1665** — "Daily Autohealing Report" (fro-bot perpetual issue, first run 2026-06-05)
- **#1664** — "chore: review stale TODO/FIXME annotations (>90 days old)" (fro-bot, opened by autoheal)
- **#876** — [Feature] Astro Starlight Documentation - Phase 6: Deployment and CI/CD
- **#212** — Dependency Dashboard

_Issue #57 ("Uplift `sparkle`") and the Astro v6 security PR #1604 are no longer in the open state. Two new fro-bot-authored issues appeared (#1665, #1664) — first evidence of active Fro Bot autoheal operation in this repo._

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-09-13 | `e603ff5` | **Backlog drained; the interval is the repo auditing its own documentation generator.** Open PRs **15 → 2** — the 13-PR autoheal queue cleared in a **112-minute window on 09-06** (10 merged, 3 closed as superseded by human PR **#2002**, which consolidated all three security overrides and *raised* the postcss floor to `^8.5.23` to close an extra medium advisory "by constraint"). Second confirmation of the closed-not-merged class after [[bfra-me--works]], with explicit on-thread supersede notes. Authorship inverted: 89 commits, `mrbro-bot[bot]` 50 / **`marcusrbrown` 27** / `fro-bot` 12. **Delivery-mode break fixed (#2001 + #2003)** — new `Resolve delivery mode` gate step is the single computed source for *both* the conditional credential restore and the agent's `output-mode`, plus workflow-level `contents: read` and `persist-credentials: false`; strongest instance of this repair in the fleet. **Docs pipeline was green and wrong**: #2022 (CI generated API docs without building the packages, so `Partial<ThemeConfig>` published as `ThemeConfig`), #2023 open (`skipErrorChecking: true` is why it was invisible), #2025 open (`--force` regeneration deleted 1,858 lines of hand-authored docs; `.md` vs `.mdx` is the only discriminator), #2032 open (`doctrine`, the JSDoc parser, archived since 2018). **#1812 unstuck after ~8 weeks** — `typedoc-plugin-frontmatter@1.3.1` imported `typedoc` with no declaration and resolved through `shamefullyHoist`; CI-only, never reproduced locally (#2027 workaround, #2048 open to drop it). **#1800 llms.txt drift closed by deleting the duplicated version, not re-syncing it.** **#1937 closed by rewriting the rule (#2015)** — absolute class ban → justified-exception rule + `no-restricted-syntax` lint; seven genuinely unjustified classes deleted first. **PR #2036 red for six days** on `ERR_PNPM_IGNORED_BUILDS @parcel/watcher@2.6.0` — a one-line allowlist fix orphaned between Renovate's mandate and autoheal's category definitions; reported accurately every night under Needs Human Attention. Autoheal report **declares its populations** (main-branch vs. all-branch run health) yet is **not deterministic** — 09-11 says "No `.yml` files in the repo," 09-13 flags `.github/settings.yml`, same tree. **New `.deciduous/` decision graph** (#2038/#2047): ≥1000 node + 664 edge JSON records, git-tracked, edges keyed on `change_id`, reconciled against per-machine SQLite. **Docs stack majors: Astro v6 → ^7, Starlight → ^0.41, Vitest → ^4**, React 19.3.0. pnpm `11.24.0` → `11.26.0`; `.node-version` `24.20.0` → `24.21.0`; agent **v0.105.1 → v0.111.0** (13 bumps); `bfra-me/.github` → v4.27.0; Renovate preset `#5.2.13`. **Contradiction recorded:** `settings.yml` `_extends: .github:common-settings.yaml` resolves to `marcusrbrown/.github`, not `fro-bot/.github` as claimed since the initial survey. Scheduled daemon 40/40 green. |
| 2026-08-29 | `8508b71` | Re-survey — Fro Bot agent bumped v0.95.0 → **v0.105.1** (SHA `e9501a9`, crosses cosmetic v0.100); checkout still `d23441a` v6.1.0; crons unchanged. **pnpm `11.17.0` → `11.24.0`**; **turbo `2.10.7` → `2.10.12`**; **tsx `4.23.1` → `4.23.12`**; `@axe-core/cli` `4.12.1`→`4.13.0`; `@bfra.me/eslint-config` `0.51.1`→`0.51.2`, `@bfra.me/prettier-config` `0.16.9`→`0.16.11`, `@bfra.me/tsconfig` `0.13.1`→`0.13.2`. **`.node-version` `24.18.0` → `24.20.0`**; TypeScript 5.9.3 / eslint 9.39.5 / prettier 3.9.6 / tsdown 0.16.8 unchanged. Renovate preset `#5.2.9` → **`#5.2.12`**. Workflow count steady at 7; `apps/`+`packages/` layout + all three prompts durable — **no structural change**. Stars 2 / watchers 2 steady; **forks 1 → 0**. **Open PRs exploded 3 → 15** — 13 fro-bot autoheal-authored, none merging (six `chore(lint)` auto-fix PRs + four security `pnpm.overrides` #1838/#1862/#1866/#1904 + #1875 test-utils + #1841 theme + #1844 docs font); propose-without-merge backlog. Open non-PR issues 7 → 9 with two new autoheal issues: **#1937** (convention drift: residual any/@ts-expect-error/non-Error class in src/) and **#1940** (moo-dang turbo package-specific build-task aliases missing from package.json scripts — third surfacing of the moo-dang cross-package build-reachability class). **#1800 "llms.txt drift" still OPEN across three surveys** — `llms.txt` still pins `pnpm@10.33.4` (now a full major + fourteen minors behind actual `11.24.0`). |
| 2026-04-28 | `770356b` | Initial survey — full page created |
| 2026-04-30 | `712ab1b` | Re-survey — Renovate preset bumped `#4.5.8` → `#4.5.9`, `bfra-me/.github` reusable workflows bumped to v4.16.11, lockfile maintenance. No structural changes. |
| 2026-05-01 | `712ab1b` | Re-survey — SHA unchanged. Open PRs: 2 (including Astro v6 security update #1604). Open issues: 5. No structural changes. Still no Fro Bot agent workflow. |
| 2026-05-23 | `e757fa6` | Re-survey — Renovate preset major-bumped `#4.5.9` → `#5.2.0` (matches the ecosystem-wide cutover seen in [[marcusrbrown--opencode-copilot-delegate]] and others). Node `24.15.0` → `24.16.0`. pnpm `10.33.2` → `10.33.4`. turbo `2.9.6` → `2.9.14`. `@bfra.me/eslint-config` `0.51.0` → `0.51.1`, `@bfra.me/prettier-config` `0.16.8` → `0.16.9`, `@bfra.me/tsconfig` `0.13.0` → `0.13.1`. Open PRs: 2 (Renovate `@storybook/test-runner` #1646 replaces prior #1507; Astro v6 security #1604 still open and unmerged). Open issues: 3 (#876, #212, #57) — drop from 5; #876 Phase-6 docs deployment still open. Workflows unchanged (6 files). Still no Fro Bot agent workflow. |
| 2026-06-05 | `e03e317` | **Major delta: Fro Bot agent workflow landed.** `fro-bot.yaml` added (agent v0.54.2) — first Fro Bot presence in this repo. pnpm `10.33.4` → `10.34.1`. Node.js 24.16.0 unchanged. Workflow count: 6 → 7. `opencode.jsonc` added at root. PR #1604 (Astro v6 security) no longer open. Issue #57 ("Uplift sparkle") closed. Two new fro-bot issues: #1665 (perpetual autohealing report), #1664 (stale TODO review). Two new fro-bot PRs: #1681 (Turbo task graph fix), #1663 (API docs regen). Open issues: 4 (up from 3). Open PRs: 3 (up from 2). `llms.txt` lists `pnpm@10.33.4` — minor drift from actual `10.34.1`. |
| 2026-06-16 | `5ccf106` | Re-survey — Fro Bot agent bumped v0.54.2 → **v0.65.0** (SHA `b7efdd6`). pnpm `10.34.1` → `10.34.3`. turbo `2.9.14` → `2.9.18`. Node.js 24.16.0 and `@bfra.me/*` toolchain unchanged. Workflow count steady at 7. All 3 prior open PRs (#1681, #1663, #1646) now merged/closed — **open PRs: 0**. Open issues steady at 4 (#1665, #1664, #876, #212). New observation: "Daily Maintenance Report" issue **#1666** exists but is **CLOSED** — maintenance-report lifecycle flagged for follow-up. `docs-legacy/` no longer present in root tree. `llms.txt` still pins `pnpm@10.33.4` — doc drift widened to actual `10.34.3`. No structural/architecture changes. |
| 2026-06-27 | `81cbd99` | Re-survey — Fro Bot agent bumped v0.65.0 → **v0.79.1** (SHA `720b721`); checkout pinned `df4cb1c` v6.0.3. pnpm `10.34.3` → `10.34.4`. **`.node-version` bumped `24.16.0` → `24.18.0`** (first Node minor since 24.16.0). turbo 2.9.18 and full `@bfra.me/*` + TypeScript 5.9.3 toolchain unchanged. Workflow count steady at 7; `fro-bot.yaml` prompts (PR review / maintenance / autoheal categories 1–8) unchanged in structure. **#1666 "Daily Maintenance Report" now OPEN** (was CLOSED at 2026-06-16) — resolves the prior maintenance-report lifecycle question; the prompt's reopen-if-closed rule explains the transition. Open PRs 0 → 3 (#1773 pnpm v11 security, #1771 grouped non-majors, #1745 docs regen). Open issues 4 → 5 (#1666 returns to open set). `apps/` (fro-jive, moo-dang) and `packages/` (config, error-testing, storybook, test-utils, theme, types, ui, utils) layout unchanged. `llms.txt` still pins `pnpm@10.33.4` — doc drift now 3 patches behind actual `10.34.4`; autoheal category-3 llms.txt-accuracy check apparently not flagging it. No structural/architecture changes. |
| 2026-07-28 | `9c215ee` | Re-survey — Fro Bot agent bumped v0.85.0 → **v0.95.0** (SHA `4ad0054`); checkout `df4cb1c` v6.0.3 → **`d23441a` v6.1.0**. pnpm `11.10.0` → **`11.17.0`**; turbo `2.10.4` → **`2.10.7`** (HEAD commit is Renovate turbo bump #1876). prettier `3.9.4`→`3.9.6`, tsx `4.23.0`→`4.23.1`, `@types/node` `24.13.2`→`24.13.3`, eslint `9.39.4`→`9.39.5`, `@changesets/cli` `2.31.0`→`2.31.1`. Renovate preset `#5.2.0` → **`#5.2.9`**. `.node-version` holds `24.18.0`; `@bfra.me/*` toolchain + TypeScript 5.9.3 unchanged. **Stars 1 → 2, watchers 1 → 2.** Workflow count steady at 7; `apps/`+`packages/` layout unchanged. Open PRs steady at 3 but reshaped again: #1787/#1816 (lint-fixes) + #1812 (Renovate typedoc) all cleared; queue now **#1875 (moo-dang test-utils dep), #1866 (brace-expansion security override), #1862 (postcss security override)** — a **security-override + manifest-hygiene** shape, all fro-bot autoheal-authored. Open non-PR issues steady at 7 (identical set). **#1800 "llms.txt drift" still OPEN and `llms.txt` still pins `pnpm@10.33.4`** (now a full major behind actual `11.17.0`) — the category-3 check flags but does not heal; remediation waits on human action across two surveys. No structural/architecture changes. |
| 2026-07-11 | `2ef1cf1` | Re-survey — Fro Bot agent bumped v0.79.1 → **v0.85.0** (SHA `e7453bd`); checkout still `df4cb1c` v6.0.3. **pnpm major cutover `10.34.4` → `11.10.0`** — the #1773 pnpm v11 security bump landed; `engines.pnpm` floor raised `>=9.15.4` → `>=11.8.0`. **turbo `2.9.18` → `2.10.4`** (first 2.10 minor). prettier `3.8.4` → `3.9.4`; tsx `4.22.4` → `4.23.0`; new devDeps observed (`@axe-core/cli` 4.12.1, `@lhci/cli` 0.15.1, `markdownlint` 0.39.0). `.node-version` holds `24.18.0`; `@types/node` 24.13.2, `tsdown` 0.16.8, `@bfra.me/*` toolchain, TypeScript 5.9.3 — all unchanged. Workflow count steady at 7; `apps/`+`packages/` layout unchanged. **#1666 "Daily Maintenance Report" stays OPEN.** Open PRs steady at 3 but reshaped: #1773/#1771/#1745 all cleared; queue now #1816 + #1787 (two fro-bot autoheal lint-fix PRs — new archetype) + #1812 (Renovate typedoc). Open issues 5 → 7 with two fresh autoheal issues: **#1800 "llms.txt drift: pnpm version reference is stale"** and **#1799 "Stale TODOs"**. **#1800 resolves the prior open question**: the category-3 llms.txt-accuracy check *is* firing and correctly opened an issue (not a PR) for the stale `pnpm@10.33.4` reference (now a full major behind actual `11.10.0`). No structural/architecture changes. |
