---
title: "feat: web-viewable knowledge wiki (Quartz digital garden)"
type: feat
status: complete
date: 2026-07-10
deepened: 2026-07-10
origin: docs/brainstorms/2026-07-10-web-viewable-wiki-requirements.md
---

# feat: web-viewable knowledge wiki (Quartz digital garden)

## Overview

Publish the existing `knowledge/wiki/` tree as a read-only web digital garden — clickable wikilinks, backlinks, full-text search, and an interactive node-graph — built with Quartz v4, themed in the Fro Bot brand identity, and served from GitHub Pages on this repo. The wiki already compounds continuously as an agent-authored artifact; this adds the reading surface a human needs to browse it as the connected graph it is. The primary audience is the operator; public discoverability is a deliberate secondary upside.

**Exposure posture (operator decision).** The wiki is public-safe in the narrow sense the upstream invariant guarantees — no *private-repo* page, name, or content reaches it, enforced at survey dispatch, wiki ingest, and the `data → main` promotion gate. It is **not** automatically "safe to broadcast": pages survey public repos in operational detail (e.g. `knowledge/wiki/repos/marcusrbrown--infra.md` catalogs secret *names*, service endpoints, and deploy topology — all from a public repo, so fully in-contract for the invariant). Publishing to GitHub Pages makes this crawlable, search-indexed, and archive-cached — wider reach than the already-public git branch. The operator has explicitly accepted this exposure: all sources are public repos, and the delta is discoverability of already-public information, not secret leakage.

**No publish-time content scan.** An earlier design added a private-name-leak scan as a publish gate. It was dropped: the private-name token set built from `metadata/repos.yaml` is currently empty (both private repos are stored `[REDACTED]`, and the loader skips redacted entries), so the scan would be a no-op that adds CI complexity while protecting nothing. Private-content protection already lives upstream in the three-gate invariant; the fast mitigation for anything mistakenly published is the emergency-unpublish path (R13). If a private repo is ever surveyed under a real name, a publish-time name scan can be added then, when it has something to catch.

## Problem Frame

Fro Bot surveys 25+ repositories into a cross-referenced Karpathy-style wiki (40 pages: repos, topics, entities, comparisons) with Obsidian `[[wikilink]]` cross-refs and structured frontmatter. On GitHub the wikilinks are inert text, the graph is invisible, and `sources` don't resolve — so the compounding knowledge base is effectively write-only. The value exists on disk; the reading surface is missing. (See origin: `docs/brainstorms/2026-07-10-web-viewable-wiki-requirements.md`.)

## Requirements Trace

- R1. Render the wiki content tree (`knowledge/wiki/` pages + `index.md` + `schema.md`) as browsable HTML; exclude `log.md`; do not treat all of `knowledge/` as in scope.
- R2. Resolve `[[wikilink]]`/`[[wikilink|label]]` between pages, honoring the `{owner}--{repo}` slug convention and frontmatter `aliases`.
- R3. Render page frontmatter as human metadata (title, type, created/updated, tags, related).
- R4. Render each page's `sources` as clickable upstream links.
- R5. Landing view organized by the four page types, mirroring `index.md`.
- R6. Backlinks ("what links here") on each page.
- R7. Client-side full-text search over titles and body.
- R8. Interactive node-graph of the wikilink network.
- R9. Build the site with Quartz v4 from the wiki tree on `main`.
- R10. Deploy to GitHub Pages from this repository.
- R11. Rebuild/redeploy when wiki content lands on `main`; no real-time freshness.
- R12. Per-page link to the page's source on GitHub, routing a spotted error to the `data`-branch correction path.
- R13. Emergency unpublish path to take the public site (or a page) down quickly, independent of the weekly cadence — implemented before the first deploy.
- R14. Apply the Fro Bot brand identity to the site — palette, typography, spacing/radius tokens, light+dark themes, favicon, and OG image — per `assets/styleguide.md` and `assets/tokens.css`, using the assets in `branding/`. WCAG AA minimum (AAA for body), including the styleguide's non-compliant-pair bans and `prefers-reduced-motion` support.

## Scope Boundaries

- No web-based editing — editing stays on the `data`-branch → promotion path; R12 links to it. A browser-edit flow needs the operator-auth spine (`fro-bot/agent`).
- No authenticated/operator-only view — the operator accepted public exposure; there is no privileged content tier.
- No second copy or divergent store — the site renders the existing `main` tree; it never becomes an alternate source of truth.
- No `knowledge/log.md` rendering — high-volume survey churn, excluded.
- No real-time/push freshness — follows the existing promotion cadence.
- No publish-time content or name scan — protection is upstream (three-gate invariant) plus R13 unpublish; a scan is deferred until the private-name set is non-empty.
- No content redaction or curation of individual pages — the operator accepted publishing the tree as-is.

### Deferred to Separate Tasks

- Branded `fro.bot` domain: later CNAME on the GitHub Pages site, not a rebuild.
- Web-edit spine integration: separate slice owned by `fro-bot/agent`.
- Publish-time private-name scan: add when `metadata/repos.yaml` carries a real (non-redacted) private-name set, or when a scoped credential to resolve redacted node_ids is justified.
- Content-safety classification (secret-name/endpoint/topology pattern gate, per-page broadcast-exclusion list): a future hardening slice if the exposure posture is later revisited.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/merge-data.yaml` — weekly (`cron: '0 22 * * 0'`) + `workflow_dispatch`; PR-based `data → main` promotion; its `🔒 Block private wiki pages` step is the upstream privacy gate. No `push` trigger; **no GitHub Pages deploy exists anywhere in the repo today**.
- `.github/workflows/improvement-metrics.yaml`, `capture-patterns.yaml` — the repo's established multi-job workflow shape (scoped token, `bash -Eeuo pipefail`, jq step-summaries, no `cat` of secrets, static run-name/concurrency) to mirror.
- `scripts/wiki-utils.ts` — `WIKI_ROOT = 'knowledge/wiki'`, wikilink extraction, and the path/slug/alias resolver; useful for any tree enumeration.
- `scripts/improvement-metrics-workflow.test.ts`, `scripts/capture-patterns-workflow.test.ts` — the workflow-shape test pattern (parse YAML, assert triggers/permissions/job wiring) to mirror for the publish workflow.

### Institutional Learnings

- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — the upstream fail-closed privacy gate that already keeps private content out of the wiki.
- `docs/solutions/best-practices/observability-before-structural-change-2026-06-09.md` — don't add machinery that protects nothing; the dropped scan is an application of this.
- `knowledge/wiki/topics/github-pages.md` and the cross-repo Starlight→`gh-pages` deploy in `knowledge/wiki/topics/opencode-plugins.md` — prior static-site deploy familiarity.

### External References

- Quartz v4 (research-verified; pin by **commit SHA of `v4.5.2`**, not the mutable tag — v5 is now current, v4 is legacy-stable):
  - Native `[[wikilink]]`/`[[wikilink|label]]` (`ObsidianFlavoredMarkdown` + `CrawlLinks`, `markdownLinkResolution: "shortest"`); `sluggify` (`quartz/util/path.ts`) does not transform `--`, so `[[fro-bot--agent]]` resolves natively.
  - `aliases` frontmatter supported (`FrontMatter` + `AliasRedirects`). Caveat: backlinks *through* an alias may not appear on the canonical target without a small adapter — verify against the real corpus.
  - Unknown frontmatter (`type`, `sources`, `related`) preserved in `file.data.frontmatter`; a custom Preact component reads `fileData.frontmatter.sources`.
  - Backlinks (`Component.Backlinks`), Flexsearch search (`Component.Search` + `ContentIndex`), local/global graph (`Component.Graph`) ship in the default layout. Search and graph both consume `public/static/contentIndex.json`. 40 nodes is trivial scale.
  - Arbitrary content dir via `quartz build -d knowledge/wiki`.
  - Official GitHub Pages deploy: Node 22+, build → upload `public` → `actions/deploy-pages`. Emits warnings (not build failures) on unresolved wikilinks — verify during Unit 1.
  - No native "edit this page" component — small custom component building `https://github.com/<org>/<repo>/edit/<branch>/<root>/<relativePath>`.

## Key Technical Decisions

- **Operator-accepted public exposure; no publish-time scan.** Verified: the wiki broadcasts operational detail from public repos, and the private-name token set is empty today (`repos.yaml` private entries are `[REDACTED]`; the loader skips them). A zero-token scan protects nothing, so it's dropped in favor of the upstream three-gate invariant plus R13 unpublish. Content-safety curation is deferred.
- **Supply chain: pin Quartz by commit SHA, isolate the build from the deploy token.** `quartz build` runs hundreds of transitive deps; that must not execute in a job holding `pages: write`/`id-token: write`. Two jobs: `build` (clone Quartz at the pinned SHA, `npm ci` against Quartz's lockfile, build `public/`, upload the Pages artifact — no Pages/id-token permissions) and `deploy` (`needs: build`, holds the Pages token, runs `actions/deploy-pages` only — no checkout, no shell, no untrusted code). This protects the deploy credential; per Oracle it does not make the artifact trustworthy against a malicious Quartz dep, which is an accepted residual for a public personal wiki (the credential is the valuable thing).
- **Every action pinned by commit SHA** (`checkout`, `setup-node`, `upload-pages-artifact`, `deploy-pages`) — especially `deploy-pages`, which runs with the write credential. Quartz pinned to the **v4.5.2 commit SHA `4923affa7722dfc751f1074348e6dad214fe0c08`** (not the mutable tag). `npm ci` against Quartz's lockfile; invoke the local binary directly (`node ./quartz/bootstrap-cli.mjs build` or `./node_modules/.bin/quartz`) — the earlier "npx could download" concern is unfounded once `npm ci` links the local bin, but the direct invocation is more deterministic. Clone Quartz fresh at the pinned SHA each run (no reused `.quartz-cache`).
- **The overlay set is FIVE files, not four (research-corrected).** Quartz registers components through a static barrel `quartz/components/index.ts`; a new component is `undefined` at build unless it's imported+exported there. So the overlay is: overwrite `quartz.config.ts` + `quartz.layout.ts` (project root), add `quartz/components/Sources.tsx` + `quartz/components/GitHubSource.tsx`, and **modify** (not replace) `quartz/components/index.ts` to import+export both. Component SCSS, if any, lives at `quartz/components/styles/*.scss`. Disable `Plugin.CustomOgImages()` from the default config unless a branded OG is wanted (satori+sharp, 5–10× the build cost); the branded OG (R14) is instead a static `branding/`-derived image. Set `baseUrl` to the project-page form `<owner>.github.io/.github` (no protocol/trailing slash).
- **Least privilege + fail-closed.** Workflow default `permissions: {}`; `build` overrides `contents: read` with `persist-credentials: false` on checkout; only `deploy` holds `pages: write` + `id-token: write`. `deploy` uses `needs: build` with no `continue-on-error` and no `always()`/status-function `if:` that could override the implicit success gate — a build failure blocks deploy.
- **`github-pages` environment protection on the normal deploy is a real publish gate.** Now that there's no publish-time scan, configure the `github-pages` environment with a branch policy (`main` only) and optionally a required reviewer / wait timer — a human/cooling-off gate before content goes live. Free on public repos.
- **Quartz footprint: fetch-at-build, not vendored.** CI clones Quartz at the pinned SHA and overlays our tracked config + components. Keeps the minimal-deps repo free of a whole SSG's source and confines the npm toolchain to CI.
- **`quartz-site/` lives outside the repo's type/lint gate.** Its `.tsx` files import Quartz types that only exist in the cloned tree, so they can't typecheck in the root pnpm workspace. Exclude `quartz-site/**` from root `tsconfig`/eslint; a local `quartz-site/tsconfig.json` gives authoring types; validate via a real build (Unit 1).
- **Publish trigger is content-landing-on-`main`** (`push` to `main` on `knowledge/wiki/**`, produced by the weekly promotion PR merge) plus `workflow_dispatch`. Checkout pins `ref: github.sha`. No new cadence.
- **R13 emergency unpublish = takedown-artifact deploy (research-resolved), before first deploy.** A dedicated `workflow_dispatch` workflow uploads a tiny tracked `takedown/` dir (an `index.html` + `404.html` carrying `<meta name="robots" content="noindex,nofollow">` and a "temporarily unavailable" message) and deploys it via `actions/deploy-pages`. GitHub Pages deployments fully replace the prior site (atomic; old sub-paths 404), so this takes everything down; a normal rebuild restores it — no reconfiguration. It uses only `pages: write` + `id-token: write` (least privilege), unlike `DELETE /pages` which needs `administration: write` and destroys site config. The takedown job targets a **separate `pages-emergency` environment** with NO required reviewers (so an incident isn't gated on the operator), scoped to its own branch policy. Residual: `*.github.io` edge cache `max-age=600` (~10 min) plus search-engine/Wayback caches are unretractable by any mechanism — documented, not solved.
- **Brand theming is design work, done by @designer with the `frontend-design` skill (operator directive).** Every unit that touches the rendered UI — the Quartz layout, the custom components, and the theme/token layer — is implemented by the `designer` subagent invoking the Systematic `frontend-design` skill, applying `assets/styleguide.md` + `assets/tokens.css` and the `branding/` assets. The orchestrator does not hand-roll the frontend; it dispatches the designer and verifies against the styleguide (WCAG pairings, non-compliant-pair bans, reduced-motion). Quartz theming maps the styleguide tokens into Quartz's SCSS theme variables (`cfg.theme` colors + custom `quartz/styles/custom.scss`).

## Open Questions

### Resolved During Planning

- Does Quartz handle the double-dash slugs + custom frontmatter + graph/search/backlinks? Yes, all native except `sources` rendering and the edit link (two small custom components). Pin the `v4.5.2` commit SHA. (Research-verified.)
- Should there be a publish-time name scan? No — empty token set today makes it a no-op; upstream invariant + R13 cover it. Deferred until the private-name set is real.
- Does a Pages deploy already exist? No — this plan introduces the first one.
- Is the wiki "safe to publish"? Not automatically — operator accepted the exposure of public-repo content.

### Deferred to Implementation

- Alias-backlink canonicalization: whether the real corpus needs the small adapter for backlinks through `aliases`, decided by testing against the 40 pages.
- Whether Quartz v4.5.2 runs clean on the CI Node 22 (verify in Unit 1); broken-wikilink build behavior (warn vs fail — research indicates warn, confirm on the real corpus).
- Exact mapping of styleguide tokens onto Quartz's `cfg.theme` color slots vs. a custom SCSS layer, and how much of the digital-garden chrome (graph, search, explorer) the designer restyles vs. accepts default — decided by the designer during Unit 4.
- Favicon/OG derivation: whether `branding/fro-bot.png` and `branding/banner.svg` are used directly as `quartz/static/` assets or need resizing/format conversion.

## Output Structure

    <tracked in this repo>
    quartz-site/                      # overlay: tracked Quartz config + components + theme (excluded from root ts/lint gate)
      quartz.config.ts                # cfg.theme mapped to brand palette, baseUrl, plugins (CustomOgImages off)
      quartz.layout.ts                # references Component.Sources + Component.GitHubSource
      components/
        Sources.tsx                   # R4
        GitHubSource.tsx              # R12
        index.ts                      # BARREL overlay — import+export both custom components (else undefined at build)
      styles/
        custom.scss                   # R14 — brand tokens → Quartz theme; light+dark, reduced-motion
      static/                         # R14 — favicon + OG image derived from branding/
      tsconfig.json                   # local config so authoring has types against the cloned Quartz
      README.md                       # fetch-at-build model, SHA pin, upgrade policy, no-generic-frontmatter convention
    takedown/                         # R13 — static emergency takedown site
      index.html                      # noindex + "temporarily unavailable"
      404.html
    .github/workflows/
      publish-wiki.yaml                # R9-R11 — build / deploy split jobs, SHA-pinned, fail-closed, github-pages env
      unpublish-wiki.yaml              # R13 — workflow_dispatch, deploys takedown/ via pages-emergency env

    <not committed — fetched at build>
    quartz@4923affa…                   # v4.5.2 SHA, cloned in CI, overlaid, built with -d knowledge/wiki

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Publish pipeline — build isolated from the deploy token, all actions SHA-pinned:

```
push to main touching knowledge/wiki/**   (or workflow_dispatch mode=publish)
        │  checkout ref: github.sha, persist-credentials: false
        ▼
  JOB build   permissions: { contents: read }   (no Pages/id-token)
    clone quartz@<SHA> → npm ci (Quartz lockfile) → overlay quartz-site/ → quartz build -d knowledge/wiki
    → actions/upload-pages-artifact(public/)
        │
        ▼
  JOB deploy  needs: build   env: github-pages (branch policy main, optional reviewer)
    permissions: { pages: write, id-token: write }
    actions/deploy-pages   (only this job holds the token; no checkout, no shell, no build)

separate workflow unpublish-wiki.yaml (workflow_dispatch):
    env: pages-emergency (NO required reviewers)   permissions: { pages: write, id-token: write }
    upload takedown/ (noindex index.html + 404.html) → actions/deploy-pages
    (atomic full-site replacement; normal rebuild restores; ~10min edge cache + search/Wayback residual)
```

## Implementation Units

> **Frontend execution mandate (operator directive).** Units 1, 2, and 3 touch the rendered UI. Each is implemented by the `designer` subagent invoking the Systematic `frontend-design` skill, working against `assets/styleguide.md` + `assets/tokens.css` and `branding/`. The orchestrator dispatches and verifies against the styleguide (WCAG pairings, non-compliant-pair bans, reduced-motion); it does not hand-roll the frontend. Unit 4 (workflows) and Unit 5 (docs) are orchestrator/@fixer work.

- [x] **Unit 1: Quartz site overlay — config, content wiring, native features, authoring boundary**

**Goal:** A tracked Quartz overlay (config + layout + local tsconfig) that, with a build-time clone of Quartz at the pinned `v4.5.2` SHA `4923affa…`, renders `knowledge/wiki/` with native wikilinks, backlinks, search, and graph — excluding `log.md` — and is explicitly excluded from the root type/lint gate.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9

**Dependencies:** None

**Files:**
- Create: `quartz-site/quartz.config.ts`, `quartz-site/quartz.layout.ts`, `quartz-site/tsconfig.json`, `quartz-site/README.md`
- Modify: root `tsconfig.json` / eslint config to exclude `quartz-site/**`

**Approach:**
- Config points content at `knowledge/wiki`, `markdownLinkResolution: "shortest"`, enables default backlinks/search/graph, landing view by page type (mirroring `index.md`), excludes `log.md` at the content boundary. Set `baseUrl` to the project-page form; disable `Plugin.CustomOgImages()` (slow satori+sharp; branded OG comes as a static asset in Unit 3). Keep `ObsidianFlavoredMarkdown` (required for wikilinks).
- Fetch-at-build: overlay copied onto a clone of Quartz at the pinned SHA; document the SHA pin and upgrade-is-a-deliberate-tested-change policy. Build with the local binary (`node ./quartz/bootstrap-cli.mjs build -d …`), not a downloadable `npx`.
- `quartz-site/tsconfig.json` gives authoring types against the cloned Quartz; root gate excludes `quartz-site/**`.

**Execution note:** Implemented by `designer` + `frontend-design` skill (UI-touching). Not test-first — SSG config validated by a real build.

**Patterns to follow:** Quartz v4.5.2 default `quartz.config.ts`/`quartz.layout.ts` (copy-and-modify, don't hand-roll — esbuild doesn't typecheck config), `docs/build.md`, `docs/hosting.md`.

**Test scenarios:**
- Test expectation: none — pure SSG configuration + gate-exclusion. Verified by a real build below; root `pnpm check-types`/lint must stay green with `quartz-site/**` excluded.

**Verification:**
- A local build (clone Quartz@SHA on Node 22 → overlay → `quartz build -d knowledge/wiki`) produces `public/` with every wiki page rendered, `[[...]]` links resolving, backlinks, search, graph, and `log.md` absent.
- Root `pnpm check-types` and `pnpm lint` remain green (quartz-site excluded).
- Confirm alias-backlink behavior and broken-wikilink warn-vs-fail against the real corpus (feeds deferred decisions).

- [x] **Unit 2: Custom components — sources renderer and GitHub source link (incl. barrel registration)**

**Goal:** Two Preact components — render each page's `sources` frontmatter as clickable upstream links (R4), and a per-page "view/edit source on GitHub" link (R12) — correctly registered in Quartz's component barrel so they resolve at build.

**Requirements:** R4, R12

**Dependencies:** Unit 1

**Files:**
- Create: `quartz-site/components/Sources.tsx`, `quartz-site/components/GitHubSource.tsx`
- Create/Modify: `quartz-site/components/index.ts` (barrel — import+export BOTH components)
- Modify: `quartz-site/quartz.layout.ts`

**Approach:**
- `Sources.tsx` reads `fileData.frontmatter.sources`, renders each `{url, sha, accessed}` as a link; renders nothing when absent. Reads ONLY the explicit `sources` field — no generic frontmatter iteration (documented convention, so `node_id`/`database_id` never render).
- `GitHubSource.tsx` builds `https://github.com/<org>/<repo>/edit/<branch>/<root>/<relativePath>` pointing at the correction branch.
- **Barrel registration is load-bearing:** the overlaid `quartz/components/index.ts` must `import` and `export` both components, else `Component.Sources`/`Component.GitHubSource` are `undefined` and the build hard-fails (research-confirmed). The overlay MODIFIES the existing barrel (keeping all standard exports), not replaces it.

**Execution note:** Implemented by `designer` + `frontend-design` skill (UI-touching).

**Patterns to follow:** Quartz `QuartzComponentProps`/`fileData` (`quartz/components/types.ts`), the existing `quartz/components/index.ts` barrel shape, default components under `quartz/components/`.

**Test scenarios:**
- Happy path: a page with a 2-entry `sources` list renders two links to the correct URLs.
- Edge case: a page with no `sources` renders no sources block (no error).
- Happy path: the GitHub source link resolves to the correct `edit/<branch>/...` URL for a page's relative path.
- Integration: both components are barrel-registered — a build with them referenced in the layout succeeds (not `undefined`).

**Verification:**
- In a local build, repo pages show clickable sources and a working source link; pages without sources render cleanly; no generic frontmatter appears; the build does not fail on unresolved components.

- [x] **Unit 3: Brand theming — Fro Bot identity applied to the site**

**Goal:** Apply the Fro Bot brand (palette, typography, spacing/radius, light+dark themes, favicon, OG image) to the Quartz site per `assets/styleguide.md` + `assets/tokens.css`, using `branding/` assets, meeting the styleguide's WCAG and reduced-motion rules (R14).

**Requirements:** R14

**Dependencies:** Unit 1 (config/layout must exist to theme)

**Files:**
- Create: `quartz-site/styles/custom.scss` (brand tokens → Quartz theme; light+dark; reduced-motion)
- Create: `quartz-site/static/` favicon + OG image derived from `branding/fro-bot.png` / `branding/banner.svg`
- Modify: `quartz-site/quartz.config.ts` (`cfg.theme` color/typography slots → brand palette + Inter/JetBrains Mono; wire `custom.scss`)

**Approach:**
- Map the styleguide's semantic tokens into Quartz's `cfg.theme` color slots (light + dark) and layer `custom.scss` for what `cfg.theme` can't express (component chrome, glow accents, code blocks, badges). Dark is the default theme per the styleguide.
- Fonts: Inter (display/body) + JetBrains Mono (code/labels) via Quartz's font config.
- Favicon → `quartz/static/icon.png` (from `branding/fro-bot.png`); static OG image from `branding/banner.svg`.
- Honor the styleguide's non-compliant-pair bans (no cyan/amber text on white), AA-minimum/AAA-body, and `prefers-reduced-motion`.

**Execution note:** Implemented by `designer` + `frontend-design` skill (this is the core design unit). The designer runs the frontend-design skill's visual-verification pass (screenshots, contrast checks) against the styleguide before the unit is called done.

**Patterns to follow:** `assets/styleguide.md` (authoritative), `assets/tokens.css` (ready tokens), Quartz `cfg.theme` structure + `quartz/styles/custom.scss` theming mechanism.

**Test scenarios:**
- Test expectation: none automated — visual/design verification. The designer verifies via the frontend-design skill's screenshot + contrast pass.

**Verification:**
- Built site renders in brand palette (dark default + light), Inter/JetBrains Mono, brand favicon + OG; a contrast pass confirms text pairings meet the styleguide's WCAG table and none of the banned pairs appear; reduced-motion honored. Designer attaches before/after screenshots.

- [x] **Unit 4: Publish + unpublish workflows — build/deploy split, SHA-pinned, fail-closed, takedown**

**Goal:** The GitHub Pages pipeline as two isolated jobs — read-only `build` (untrusted Quartz build, no deploy token) and token-holding `deploy` (`needs: build`, `github-pages` env, deploys the artifact only) — plus a separate `workflow_dispatch` takedown-artifact unpublish workflow (R13). Every action SHA-pinned, least-privilege, fail-closed.

**Requirements:** R9, R10, R11, R13

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Create: `.github/workflows/publish-wiki.yaml`, `.github/workflows/unpublish-wiki.yaml`
- Create: `takedown/index.html`, `takedown/404.html`
- Test: `scripts/publish-wiki-workflow.test.ts`

**Approach:**
- `publish-wiki.yaml`: triggers `push` to `main` on `knowledge/wiki/**` + `workflow_dispatch`. Checkout pins `ref: ${{ github.sha }}`, `persist-credentials: false`. Workflow default `permissions: {}`.
  - `build` job (`permissions: { contents: read }`): clone Quartz@SHA, `npm ci` (Quartz lockfile), overlay `quartz-site/`, build (Node 22), `actions/upload-pages-artifact`. No Pages/id-token.
  - `deploy` job (`needs: build`, `environment: github-pages`, `permissions: { pages: write, id-token: write }`): `actions/deploy-pages` only — no checkout/shell/build. No `continue-on-error`; no `always()`/status-function `if:`.
- `unpublish-wiki.yaml`: `workflow_dispatch` only, `environment: pages-emergency` (no required reviewers), `permissions: { pages: write, id-token: write }`. Uploads `takedown/` and deploys it — atomic full-site replacement. Concurrency cancels an in-flight normal deploy. `takedown/index.html` carries `<meta name="robots" content="noindex,nofollow">` + a "temporarily unavailable" message; `404.html` mirrors it.
- All actions commit-SHA pinned (esp. `deploy-pages`). Mirror the repo's `bash -Eeuo pipefail`, no-`cat`-of-secrets, static run-name/concurrency discipline. (`github-pages` environment branch/reviewer protection is configured in repo settings, noted in Unit 5 runbook — not YAML.)

**Execution note:** Orchestrator/@fixer work. Workflow YAML validated by a shape test (parse + assert job isolation, permissions, SHA pins, gate ordering), mirroring `scripts/improvement-metrics-workflow.test.ts`.

**Patterns to follow:** `.github/workflows/improvement-metrics.yaml` (multi-job, scoped token), Quartz `docs/hosting.md` Pages workflow, `scripts/capture-patterns-workflow.test.ts` (assertion style).

**Test scenarios:**
- Happy path: `deploy` declares `needs: build` — deploy is unreachable if build fails.
- Edge case (token isolation, the mutation that matters): only `deploy` has `pages: write`/`id-token: write`; `build` holds neither.
- Edge case (fail-closed): `deploy` has no `continue-on-error` and no `always()`/`failure()`/`!cancelled()` `if:` bypassing the `needs: build` success gate.
- Edge case: `push` path-filtered to `knowledge/wiki/**`; checkout pins `github.sha` + `persist-credentials: false`; Node 22 + Quartz SHA pinned; every `uses:` SHA-pinned; workflow default `permissions: {}`.
- Edge case (unpublish): `unpublish-wiki.yaml` is `workflow_dispatch` only, targets `pages-emergency`, deploys `takedown/`, and `takedown/index.html` contains the `noindex` meta.

**Verification:**
- `pnpm test scripts/publish-wiki-workflow.test.ts` green; actionlint clean; deploy provably unreachable when build fails; Pages token only in the deploy/unpublish jobs; all actions SHA-pinned; takedown carries noindex.

- [x] **Unit 5: Documentation and operational notes**

**Goal:** Operator-facing docs — what the site is, its URL, the publish/refresh model, the honest exposure posture, why there's no publish-time scan, the `github-pages` environment-protection setup, the takedown-unpublish runbook, and the Quartz SHA-pin/upgrade policy.

**Requirements:** R11, R12, R13, R14 (operational surfacing)

**Dependencies:** Units 1–4

**Files:**
- Modify: `README.md`
- Create/Modify: `quartz-site/README.md` (build/pin/upgrade + "no generic frontmatter rendering" convention + token→theme mapping note), takedown-unpublish runbook

**Approach:**
- README operator section: what the rendered wiki is, its Pages URL, refresh model, the accepted-exposure note (public info, aggregated + indexed), how to fix a spotted error (source link → `data`-branch), and how to run/settings-configure an emergency unpublish. Marcus's voice, no internal taxonomy.
- Runbook: the takedown workflow (dispatch → `pages-emergency`), the manual UI-unpublish fallback (Settings → Pages → Unpublish) if Actions is broken, the `github-pages` env protection setup (branch policy `main`, optional reviewer), and the honest residual (edge cache ~10min, search/Wayback unretractable). State plainly that private-content protection is upstream (three-gate invariant); publish adds no content scan.
- Document the Quartz commit-SHA pin, fetch-at-build model, and upgrade policy.

**Execution note:** Orchestrator/@fixer work.

**Test scenarios:**
- Test expectation: none — documentation. Verified by markdown lint + content review.

**Verification:**
- `pnpm lint` clean (markdown); README renders; no internal plan taxonomy; the takedown runbook, env-protection setup, and honest exposure/residual notes are present.

## System-Wide Impact

- **Interaction graph:** New `push`-on-`main` trigger for `knowledge/wiki/**`, produced by the weekly `merge-data.yaml` promotion PR merge. Promotion itself is unchanged; the publish workflow reacts to it. No existing workflow calls the new one.
- **Error propagation:** Build failure stops before deploy (`deploy needs: build`, fail-closed). An infra/crash error in build also blocks deploy because deploy requires build success.
- **State lifecycle risks:** GitHub Pages holds one live deployment; a bad publish is corrected by the next clean run or the R13 emergency path. Search-engine/archive caches persist beyond unpublish — documented residual, unsolvable in-repo.
- **API surface parity:** First GitHub Pages deploy in the repo; no other publish surface to keep in parity.
- **Integration coverage:** Build/deploy job dependency, token isolation, and takedown shape asserted by the Unit 4 workflow test; component barrel-registration asserted by Unit 2's build-integration check.
- **Unchanged invariants:** No change to the wiki content tree, the `data`-branch sole-writer model, `Check Wiki Authority`, or the promotion privacy gate. This plan only reads `main` and publishes; it never writes wiki content.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Public render broadcasts an aggregated recon catalog (secret names, endpoints, topology) from public repos | **Operator-accepted exposure** (all sources public; delta is discoverability). Documented honestly; R13 fast takedown; content-safety curation deferred. |
| Supply chain: `quartz build` runs many transitive deps; mutable tag | Pin Quartz + every action by commit SHA; `npm ci` against Quartz's lockfile; build job holds NO Pages/id-token — a compromised dep cannot reach the deploy credential. Artifact-integrity-vs-malicious-dep is an accepted residual (credential is protected; content is already accepted-public). |
| `quartz-site/*.tsx` can't typecheck in the pnpm root (Quartz not installed) | Exclude `quartz-site/**` from root ts/lint; local `quartz-site/tsconfig.json` for authoring; validate via real build. |
| Quartz v4 legacy; upgrades break slug/frontmatter/graph | SHA pin `4923affa…` + upgrade-is-a-deliberate-tested-change policy; minimal custom surface. |
| New component silently `undefined` at build (barrel not overlaid) | Unit 2 overlays `quartz/components/index.ts` (import+export); an integration test asserts the referenced components build. |
| Alias backlinks may not canonicalize | Flagged in Unit 1 verification; small adapter deferred, decided against the real corpus. |
| "Read-only, edit deferred" feels broken on a spotted typo | R12 per-page source link → existing `data`-branch correction path. |
| Brand theming drifts from the styleguide (wrong contrast, banned pairs, no reduced-motion) | R14 implemented by `designer` + `frontend-design` skill against `assets/styleguide.md`; orchestrator verifies the WCAG table + banned-pair bans + reduced-motion before accepting the unit. |
| Emergency takedown gated by reviewers / too slow | Takedown targets a separate `pages-emergency` env with NO required reviewers; atomic full-site replacement. Residual: ~10min edge cache + search/Wayback (documented, unsolvable). |
| A private repo surveyed under a real name would publish without a scan | Upstream three-gate invariant still blocks private content at survey/ingest/promotion; a publish-time name scan is the documented add-on when the private-name set becomes non-empty. |

## Documentation / Operational Notes

- README wiki-site section + `quartz-site/README.md` + takedown-unpublish runbook + `github-pages` env-protection setup (Unit 5), including the honest exposure posture, the no-publish-scan rationale, and the edge-cache/search residual.
- Revisit trigger: if a private repo enters the tracked set under a real name, or the exposure posture is reconsidered, add the deferred publish-time scan / content-safety classifier.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-07-10-web-viewable-wiki-requirements.md`
- Brand system: `assets/styleguide.md`, `assets/tokens.css`, `branding/fro-bot.png`, `branding/banner.svg`
- Upstream privacy gate: `.github/workflows/merge-data.yaml`, `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`
- Workflow shape: `.github/workflows/improvement-metrics.yaml`; test pattern: `scripts/improvement-metrics-workflow.test.ts`, `scripts/capture-patterns-workflow.test.ts`
- Quartz v4.5.2 (pin commit SHA `4923affa7722dfc751f1074348e6dad214fe0c08`): `docs/build.md`, `docs/hosting.md`, `docs/features/{wikilinks,backlinks,graph view,full-text search}.md`, `quartz/components/index.ts` (barrel), `quartz/build.ts`, `quartz/util/path.ts`
- GitHub Pages: `actions/deploy-pages` (atomic replacement, `pages:write`+`id-token:write`), Pages REST (`DELETE /pages` needs `administration:write` — rejected), environments/protection rules docs
