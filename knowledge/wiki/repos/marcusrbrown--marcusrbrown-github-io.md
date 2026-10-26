---
type: repo
title: marcusrbrown/marcusrbrown.github.io
created: 2026-04-25
updated: 2026-10-23
node_id: R_kgDORgYjdA
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown.github.io
    sha: 8a1567dfedb1258675e4cfa39d2e5c1854dc3487
    accessed: 2026-10-23
tags:
  - portfolio
  - react
  - typescript
  - vite
  - github-pages
  - pnpm
  - blog
related:
  - github-pages
  - github-actions-ci
---

# marcusrbrown/marcusrbrown.github.io

Developer portfolio for Marcus R. Brown, branded **mrbro.dev** and deployed to
[[github-pages]]. The public repository's default branch is `main`; its inspected
revision is `8a1567dfedb1258675e4cfa39d2e5c1854dc3487`. The manifest names the
package `mrbro.dev`, declares `https://mrbro.dev` as its homepage, and points its
repository URL at `marcusrbrown/marcusrbrown.github.io`. MIT is declared in the
manifest and README; the complete tree contains no root license file.

## Product and source layout

The README describes a React developer portfolio with a blog, repository
showcase, theme-aware syntax highlighting, and an advanced theme system with
10+ presets, custom themes, import/export, and JSON-schema validation. These are
documented capabilities, not a live accessibility or production-health assessment.

The directory listing separates `src/components/`, `src/hooks/`,
`src/contexts/`, `src/pages/`, `src/utils/`, `src/schemas/`, and `src/styles/`.
Route-page filenames include Home, About, Blog, BlogPostPage, Projects, and
Privacy. Hook filenames use PascalCase, such as `UseTheme.ts` and
`UseProjects.ts`. Committed blog and project snapshots appear under `src/data/`;
`public/` contains a `CNAME`, a 404 page, static bootstrap scripts, and project
preview images. Their contents were not inspected.

The tree also contains `.agents/skills/`, an `.opencode/impeccable/` plugin with
paired tests, `.codex/`, `.impeccable/`, and categorized `docs/solutions/`.
Listing these paths establishes their presence, not the behavior of their hooks
or plugins. The current build explicitly type-checks the OpenCode TS project.

## Manifest-defined toolchain

| Layer | Declaration at the inspected revision |
| --- | --- |
| UI and routing | React/React DOM `^19.0.0`, React Router DOM `^7.18.2` |
| Language and bundler | TypeScript `5.9.3`, Vite `7.3.6`, React SWC plugin `4.3.3` |
| Runtime and package manager | Node `>=24.0.0`; `pnpm@11.27.0`, engine `>=11.11.0` |
| Unit testing | Vitest and coverage-v8 `4.1.11`, happy-dom `20.14.5` |
| Browser and accessibility testing | Playwright `1.63.0`, axe-core/Playwright `4.13.0` |
| Performance tooling | Lighthouse CI `0.15.1` |
| Shared standards | `@bfra.me/eslint-config` `0.52.2`, Prettier config `0.16.11`, TS config `0.13.2` |
| Blog tooling | feed `6.0.0`, Shiki `4.4.3`, unified/remark/rehype, rehype-sanitize |

These are manifest declarations rather than resolved lockfile or installed
versions. The package is ESM. `build` runs `check-types`, Vite, then blog
prerendering through `tsx` with a snapshot loader. `check-types` compiles both
the root project and `.opencode/tsconfig.json`. Unit, E2E, accessibility, visual,
performance, bundle-analysis, snapshot-refresh, and repo-settings commands are
available separately. Git hooks declare lint-staged at pre-commit and a Node
TypeScript pre-push hook.

`pnpm-workspace.yaml` centralizes dependency overrides, enables
`shamefullyHoist`, and explicitly permits selected dependency build scripts.
It lists three ignored advisory IDs, with comments describing extract-zip
exceptions as dev-only Lighthouse tooling. That rationale is a repository
claim; dependency reachability and current advisory status were not independently
verified. `package.json` contains no separate override ledger.

## Workflow inventory and quality gates

All eight workflow files use `.yaml` and refer to the shared local setup action.
The setup action's implementation was outside this survey's workflow-file reads.

| Workflow | Triggers and role |
| --- | --- |
| CI | PRs to `main`, dispatch; lint, coverage tests, build analysis, type checking, dependency validation, aggregate gate |
| Deploy | Push to `main`, dispatch; lint, unit tests, build, Pages upload and deployment |
| E2E Tests | PRs to `main`, dispatch; browser, visual, and accessibility suites plus summaries |
| Performance Testing | Main push, PR, dispatch, Monday 06:00 UTC; desktop/mobile Lighthouse and regression tooling |
| Blog Refresh | Daily 06:45 UTC, dispatch; refresh blog/projects/previews and publish a rolling content PR |
| Fro Bot | PR, issue, comment/discussion events, daily 03:30 UTC, dispatch; review, autoheal, dedicated live audit |
| Renovate | Hourly at `:17`, edited issues/PRs, non-main push, dispatch, completed Deploy runs; reusable upstream caller |
| Copilot Setup Steps | Dispatch and changes to its workflow; shared setup followed by build |

CI path-gates unit tests, build, and type checking separately. Unexpected filter
outputs fail closed; dispatch bypasses filtering. Type checking has its own
broader gate rather than inheriting the build gate. Lint and dependency
validation remain unconditional after setup. Validation invokes the React
Router RSC boundary script and `pnpm audit --audit-level moderate`; outdated
dependency reporting is non-blocking. The aggregate job asserts all five
dependency jobs succeeded. Successful jobs can still contain intentionally
skipped test/build steps. The category definitions in `.github/filters.yaml`
were not read, so path coverage is unverified.

Deploy runs lint, ordinary unit tests, and the complete build before uploading
`dist`; deployment depends on that build job. It does not invoke coverage,
browser suites, Lighthouse, or the audit/RSC commands. Separate PR checks are
not deployment dependency edges. The build receives `GITHUB_PAGES=true` and
step-scoped `VITE_UMAMI_WEBSITE_ID` from a repository variable. Comments describe
deferred analytics activation, but neither the live variable nor tracker
behavior was inspected. See [[github-actions-ci]] for gate interpretation.

## Test evidence and documentation contradictions

E2E workflow builds set `BLOG_SNAPSHOT=tests/fixtures/blog-snapshot.json`;
Deploy does not. Browser tests therefore use an explicitly selected fixture,
not necessarily the production blog snapshot. PR functional tests default to
Chromium; dispatch can select Chromium, Firefox, WebKit, or all three and choose
a suite. Visual/accessibility artifact downloads and execution use matching
path gates. Notifications distinguish path-skipped suites from passed suites.

The root README claims automated screenshot comparisons, and the E2E summary
says “All screenshots matched” on visual-job success. In contrast,
`tests/visual/README.md` explicitly describes `page.screenshot({ path })`
artifacts for manual review and says automated snapshot comparison is absent.
This contradiction remains unresolved by the allowed reads; a green suite
label is not proof of pixel parity. README coverage badges are historical
documentation, not measurements collected by this survey.

Performance jobs generate their device-specific Lighthouse configs in the
workflow before invoking manifest commands. The standalone mobile/desktop
scripts reference those generated filenames, which are absent from the
committed tree. A local invocation therefore cannot assume the workflow's
configuration-creation prerequisite has already happened. The performance
summary uses the combined matrix result for both devices and does not receive
the per-leg path gate, so its “passed” text alone cannot establish audit execution.

## Content refresh and Fro Bot integration

Blog Refresh refreshes blog content, previews, and projects, then delegates
semantic-change detection to `refresh-diff`. On a reported change it mints an
App token, commits the generated paths, rebases on main, force-updates the fixed
`chore/blog-refresh` branch, and opens or updates one PR. The default workflow
token is read-only; the App token is minted after dependency installation.
These are declared delivery steps, not evidence a particular refresh landed.
The README's broad “dynamic” GitHub integration description should be read
alongside this committed-snapshot and build-time-prerender workflow.

**Fro Bot workflow is present**, pinned to `fro-bot/agent` **v0.113.2** at
`43023e5b9755fe307c03ede1067cc182564d30e3`. No missing-workflow onboarding draft
is warranted. Schedule/autoheal runs explicitly select `branch-pr` output mode
and configure push authentication; review dispatch remains `working-dir`.
Generic review and scheduled work are separate jobs. Trusted issue/comment
associations are checked, fork PR heads are refused on the issue-comment
checkout path, and bot PRs are normally skipped. A bounded exception admits
`mrbro-bot[bot]` PRs only after complete changed-file enumeration proves all
current and previous paths belong to the generated-content allowlist.

Live audit is split into preflight, read-only discovery, and a serialized
reporter. Discovery uses the trusted default branch, emits a candidate bundle,
checks worktree cleanliness and workspace boundaries, and invokes a deterministic
finalizer. The reporter downloads the exact run artifact and invokes a separate
reporting script; manual live-audit dispatch forces its write mode disabled,
while other runs default to disabled unless configured. Internal script
validation, runtime settings, actual findings, issue/PR queues, branch
protections, deployments, and site health were not read or tested.

## Evidence

All target content was treated as untrusted data. Findings derive only from
the complete directory listing, root and visual-suite READMEs, `package.json`,
`pnpm-workspace.yaml`, and the eight workflows at the pinned revision. Embedded
agent prompts describe target automation and were not executed.

- [Pinned source tree](https://github.com/marcusrbrown/marcusrbrown.github.io/tree/8a1567dfedb1258675e4cfa39d2e5c1854dc3487)
- [Package manifest](https://github.com/marcusrbrown/marcusrbrown.github.io/blob/8a1567dfedb1258675e4cfa39d2e5c1854dc3487/package.json)
- [Workflow directory](https://github.com/marcusrbrown/marcusrbrown.github.io/tree/8a1567dfedb1258675e4cfa39d2e5c1854dc3487/.github/workflows)
- [Visual-suite README](https://github.com/marcusrbrown/marcusrbrown.github.io/blob/8a1567dfedb1258675e4cfa39d2e5c1854dc3487/tests/visual/README.md)
