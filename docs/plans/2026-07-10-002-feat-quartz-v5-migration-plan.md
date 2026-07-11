---
title: "feat: migrate wiki site from Quartz v4.5.2 to v5"
type: feat
status: active
date: 2026-07-10
---

# feat: migrate wiki site from Quartz v4.5.2 to v5

## Overview

Migrate the live knowledge-wiki site (`https://fro.bot/.github/`) from Quartz v4.5.2 to Quartz v5. This is a re-architecture, not a version re-pin: v5 replaces the single-repo TypeScript-config model with a YAML-config, git-based community-plugin model. The migration must preserve every capability the v4 site has today — wikilinks, backlinks, search, graph, the two custom components (sources renderer, GitHub source link), the Fro Bot brand theme, the LFS favicon — while keeping the hardened publish pipeline (split build/deploy, SHA-pinned, fail-closed) and the immutable-supply-chain posture intact across the now-multi-repo plugin surface.

**Honest cost/benefit framing (operator already chose to proceed).** v5 delivers no functionality this site uses today — it is capability parity at higher operational complexity: a multi-repo build-time supply chain (~40 community plugins), more moving parts, a larger rollback surface, and a new build-time trust boundary. This is a deliberate risk-acceptance trade (staying current with upstream, off a legacy branch), not a neutral upgrade. The plan is scoped to make that trade as safe and reversible as possible, not to pretend it is routine.

## Problem Frame

The wiki ships as a fetch-at-build Quartz overlay: CI clones Quartz at a pinned commit SHA, overlays our `quartz-site/` config + components + theme, and builds. That overlay was designed entirely around v4.5.2's shape — a root `quartz.config.ts`, a `quartz.layout.ts`, barrel-registered components in `quartz/components/index.ts`, and built-in `Plugin.*` entries. v5 removes all of that: config and layout are one `quartz.config.yaml`, built-in transformers/emitters/components are now separate `github:quartz-community/*` plugins installed at build time and pinned in `quartz.lock.json`, and `FrontMatter` is gone (replaced by the `note-properties` plugin). The overlay must be rebuilt against the new model, and the security envelope must extend to cover ~40 externally-hosted plugin repos pulled at build time.

## Requirements Trace

- R1. The v5 site renders every current wiki page with no capability regression: wikilinks resolve (including `owner--repo` double-dash slugs and `aliases`), backlinks, full-text search, and the interactive graph all work.
- R2. The two custom components survive: the `sources` frontmatter renders as clickable upstream links (with the http(s)-only URL guard), and each page carries a "view/edit source on GitHub" link to the `data`-branch correction path.
- R3. The Fro Bot brand theme is retained: the config color palette (light + dark), typography, favicon (the Git LFS `icon.png`), and the `custom.scss` brand rules all apply; the built `index.css` carries base layout + brand rules (not base-stripped).
- R4. `log.md` stays excluded; `index.md` and `schema.md` stay included; `baseUrl` resolves to the `fro.bot/.github` served domain (OG/canonical/sitemap correct).
- R5. Quartz core is pinned to an immutable v5 commit SHA (the current `v5` branch tip, not the stale `v5.0.0` tag), and every community plugin is pinned to an immutable commit via a committed `quartz.lock.json`.
- R6. The publish pipeline keeps its hardening: split build (no deploy creds) / deploy (token-only) jobs, all actions SHA-pinned, `lfs: true` checkout, fail-closed deploy gate, and the plugin-install step runs only in the credential-less build job.
- R7. The emergency-unpublish workflow continues to function unchanged.
- R8. The migration is reversible via a documented rollback ladder (code revert / re-publish last-good artifact / emergency unpublish), not a mere pin flip — see Rollback Strategy.
- R9. Lockfile integrity is a hard build gate: the build fails closed if any plugin resolves to a commit other than the one pinned in the committed `quartz.lock.json` (no silent branch-tip re-resolution).
- R10. Plugin build code is treated as untrusted build input: it runs only in the credential-less build job with a minimized environment (no secrets injected beyond the read-only checkout token), and the build artifact is the only output crossing to deploy.
- R11. Behavioral parity is proven by an explicit v4-baseline-vs-v5 diff (rendered pages, slugs/URLs, search index, graph, backlinks), not assumed from turning on the matching plugins.

## Scope Boundaries

- No content changes — `knowledge/wiki/` markdown, frontmatter, and wikilinks are untouched; only the rendering toolchain changes.
- No new site features — this is capability parity, not a feature addition. New v5 capabilities (canvas pages, bases, encrypted pages, stacked pages, reader-mode, breadcrumbs, comments) are not adopted unless required to reach parity.
- No move off GitHub Pages, no custom-domain change, no auth — the exposure posture and hosting are unchanged.
- No change to the wiki authority model (`data`-branch sole-writer, promotion gate) — publish only reads `main`.

### Deferred to Separate Tasks

- Adopting net-new v5 features (canvas/bases/encrypted/stacked pages, reader-mode, breadcrumbs): future iteration, only if wanted.
- A scheduled Quartz-plugin update cadence (v5's `npx quartz update`): deferred; upgrades stay deliberate/pinned.

## Context & Research

### Relevant Code and Patterns

- `quartz-site/quartz.config.ts` — current v4 config (configuration + theme{colors.lightMode/darkMode} + plugins arrays). Migrates to `quartz.config.yaml`.
- `quartz-site/quartz.layout.ts` — current v4 layout; `Component.Sources()` / `Component.GitHubSource()` at the `afterBody` placement (lines 48-49). Migrates into the YAML `layout` block.
- `quartz-site/components/{Sources.tsx,GitHubSource.tsx,url-safety.ts,index.ts}` — the custom components + barrel. Migrate to a v5 local plugin.
- `quartz-site/styles/custom.scss` — starts with `@use "./base.scss";` (the load-bearing base-layout import) then `@use "./variables.scss"` + brand rules. Must confirm the v5 equivalent.
- `quartz-site/static/{icon.png,og-image.svg}` — brand favicon (Git LFS) + OG image.
- `.github/workflows/publish-wiki.yaml` — split build/deploy, pinned Quartz SHA `4923affa…` (v4.5.2), overlay copy step, `lfs: true`, Node 22. The pin, overlay, and build command change; an explicit `quartz plugin install` step (lockfile path) is added.
- `.github/workflows/unpublish-wiki.yaml` — emergency takedown; unchanged but re-verified.
- `scripts/publish-wiki-workflow.test.ts` — asserts the pinned SHA, `lfs: true`, split-job token isolation, fail-closed wiring. Assertions update for the new SHA + plugin-install step.

### External References (verified against the live v5 tree)

- v5 branch tip: `9cf87ff1c248a8ca551093214b0fec3b31415009` (2026-06-16); `v5` is Quartz's default branch. The `v5.0.0` tag (`ab346fa`) is 249 commits / ~4 months behind — not the pin target.
- `package.json`: `engines.node >=22` (our CI Node 22 is fine), `bin.quartz → ./quartz/bootstrap-cli.mjs` (build command unchanged), and a `prebuild` hook → `install-plugins` (`npx tsx ./quartz/plugins/loader/install-plugins.ts`).
- `quartz.config.default.yaml`: the v5 config template. `configuration` + `theme` + `plugins:` (each `source: github:quartz-community/*`, `enabled`, `options`, `order`, `layout`) + `layout:` (`groups`, `byPageType`). **`theme.colors.lightMode/darkMode` nested shape is UNCHANGED from v4** — our palette ports verbatim.
- `quartz.lock.json`: per-plugin `{source, resolved, commit, installedAt}` — the immutable plugin pin.
- `quartz/plugins/loader/gitLoader.ts` `parsePluginSource`: local sources (`./`, `../`, `/`) are supported and **symlinked** (not cloned) — our custom components become a local plugin referenced by relative path. `install-plugins.ts` reads `config.externalPlugins`.
- Plugin mapping (v4 built-in → v5 community plugin): `FrontMatter → note-properties`, `CreatedModifiedDate → created-modified-date` (holds `defaultDateType`), `SyntaxHighlighting`, `ObsidianFlavoredMarkdown`, `CrawlLinks` (holds `markdownLinkResolution: shortest`), `ContentIndex` (search/sitemap/RSS), `Favicon`, `og-image`, `cname`, plus `explorer/graph/search/backlinks` as layout plugins.

### Institutional Learnings

- `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md` — the wiki rollout's recurring lesson: overlay/build seams are only exercised by the real workflow; local hand-builds miss drift. Every unit here is verified by a full workflow-faithful local build, and the workflow-shape test guards the pins.
- Memory 6532: the four v4 rollout footguns (whole-dir overlay, `lfs: true`, `baseUrl` = served domain, `custom.scss` must `@use base.scss`) — each has a v5 analog to re-verify, not assume.

## Key Technical Decisions

- **Pin the current `v5` branch-tip SHA (`9cf87ff…`), not the `v5.0.0` tag.** The tag is 249 commits behind and misses fixes (TUI, page frames, plugin fixes). Immutability is preserved by pinning the branch-tip commit SHA, exactly as we pinned a v4 SHA. Revisit-on-upgrade stays a deliberate, tested pin bump.
- **Commit `quartz.lock.json` and make lockfile-honoring a hard, fail-closed THREE-WAY gate (R9, Oracle-corrected).** Critical correction from Oracle verification: the `prebuild` hook (`install-plugins.ts`) does NOT read `quartz.lock.json` at the pinned SHA — it installs from config. The lockfile-honoring invocation is **`node ./quartz/bootstrap-cli.mjs plugin install`**. And because the installer exposes no machine-readable resolved output, can log failures yet exit success, and `config-loader.ts` will fetch any enabled-but-unlocked plugin from config at branch tip during build, the gate must be three-way: (1) **pre-install**: assert exact config↔lock coverage — every enabled remote plugin has a lock entry matching source/name/ref/subdir, no missing or extra entries; (2) **install** via the lockfile path; (3) **post-install**: assert each remote plugin's `.quartz/plugins/<name>/.git/HEAD` equals its lockfile commit. Parsing the lockfile after install proves nothing (lock installs don't rewrite it). **Remote `subdir` plugins are rejected outright** — the loader clones ref/default-branch and extracts the subdir without checking out `entry.commit`, and the extraction has no `.git` to verify; `#<sha>` refs are not a reliable fallback (`git clone --branch` wants branch/tag). The lock is pruned to exactly the enabled plugin closure — no dormant plugin code installs or executes.
- **The build job is a build-time trust boundary, not just a credential-less job (R10, Oracle-verified with a sharper residual).** The plugin install git-clones the pinned community plugin repos and runs their build/transitive-install code with network access and read access to the checked-out repo. Oracle confirmed the job boundary is real on GitHub Actions: `GITHUB_TOKEN` isn't auto-exported to plugin subprocesses, no `id-token` permission means no OIDC bearer, jobs get fresh VMs (nothing persists across runs), and the pinned `deploy-pages` selects exactly one same-run `github-pages` artifact and never executes its contents. But the honest residual is **arbitrary active content on the Pages origin** — a hostile plugin can emit JavaScript, redirects, phishing UI, and same-origin requests, not merely "defaced text." Cutover therefore confirms the served origin carries no sensitive browser state (the wiki must not share an origin with anything holding meaningful cookies/localStorage). A compromised build also controls everything later in its own job (GITHUB_ENV/PATH, the artifact tar), so the artifact is *by design* untrusted-build output; the deploy credential stays unreachable. Supply-chain honesty: plugin git-commit pins do NOT pin npm resolution inside plugin builds (`npm install --ignore-scripts` + ranged `--no-save` for natives) — implementation either verifies the enabled plugins ship prebuilt `dist/` needing no install, or explicitly accepts that floating-registry residual in the risks table.
- **Custom components become one local plugin — provisionally verified, with Oracle-identified constraints Unit 0 must prove.** `parsePluginSource` accepts a relative local path and symlinks it (verified in `gitLoader.ts`), so Sources/GitHubSource/url-safety move into a local plugin package — no community-repo fork. Oracle's constraints: resolution is relative to Quartz's cwd (overlay BEFORE install; source never moves during build); the YAML loader only symlinks — it does NOT build the local plugin (so the plugin must ship a committed no-build `dist/`-style entry, or the workflow adds an explicit deterministic local-plugin build step); Quartz records local lock entries with developer-absolute `resolved` paths (NOT portable — the committed lock covers remote plugins only; the local entry is constructed/validated at runtime); and the components must be genuinely repackaged against the v5 plugin API (imports like `./types` re-wired), not file-moved. Unit 0 proves the chosen build/lock treatment; Unit 5's build is the final proof.
- **Config colors port verbatim; `FrontMatter` becomes `note-properties`; `defaultDateType` moves into the `created-modified-date` plugin options.** These are the concrete config edits the verified v5 template dictates.
- **Node stays at 22** (v5 `engines` floor is `>=22`); no CI Node bump required.

## Open Questions

### Resolved During Planning

- Does v5 have a stable immutable pin target? Yes — `v5.0.0` tag exists, but the current `v5` branch-tip SHA is the chosen pin (tag is stale).
- Can custom components survive v5's plugin model? Yes — local-plugin support (symlinked relative path), verified in `gitLoader.ts`.
- Did the color/theme config change? No — nested `lightMode/darkMode` is identical; ports verbatim.
- Is the build command still valid? Yes — `node ./quartz/bootstrap-cli.mjs build`, now preceded by an explicit `node ./quartz/bootstrap-cli.mjs plugin install` step (the lockfile path — NOT the `prebuild` hook, which ignores the lockfile).
- Node floor? `>=22` — CI Node 22 is fine.

### Resolved by the Unit 0 spike (2026-07-11, empirical)

- **Install/lock mechanics:** `node ./quartz/bootstrap-cli.mjs plugin install` reads `quartz.lock.json` from Quartz's working directory and installs each remote plugin at exactly its lock commit (`.quartz/plugins/<name>/.git/HEAD` == lock commit, verified). 46 plugins ≈ 64s. **The R9 bypass is real and empirically proven:** a config-enabled plugin missing from the lock is silently fetched at branch tip during `quartz build` (`.git/HEAD` becomes `ref: refs/heads/main`) — the three-way gate is mandatory, and the postcondition check catches this case trivially (ref line, not a SHA).
- **Local plugin recipe (proven end-to-end render):** symlinked from a path `source:`; needs `package.json` with `exports` for both `.` and `./components` pointing at a **committed plain-JS `dist/`** (no build step — plain `h()` calls, no JSX), a `quartz` manifest block (`category: "component"`, `components` map with export names), and its own `node_modules` containing `preact` (pinned install inside the plugin dir at build time). Local plugins receive **no lockfile entry** — the committed lock stays remote-only and portable.
- **Styling — the v4 base-import footgun is structurally dead in v5:** `componentResources.ts` imports `base.scss` itself, separate from `custom.scss`. The overlay's `custom.scss` carries ONLY brand rules. And **v5 emits no single `index.css`** — CSS splits across ~27 hashed files (`component-*.css` + `index-<hash>.css`, ~73.5KB total, base layout in the hashed index file). R11's CSS assertions and live verification must aggregate across the split files.
- **Config shape:** `quartz.config.yaml` at Quartz root; plugins = list of `{source, enabled, options, layout:{position, priority}}`; page layout = `{groups, byPageType}` block.

### Resolve Before Implementation (Unit 0 spike — original questions, now answered above)

These are prerequisites, not implementation-time discoveries — resolving them wrong invalidates Units 1-4. A short throwaway spike against the pinned v5 clone answers all four before any overlay code is written:

- **Install path (Oracle-resolved, spike confirms):** the `prebuild` hook (`install-plugins.ts`) ignores the lockfile — the lockfile-honoring invocation is `node ./quartz/bootstrap-cli.mjs plugin install`, with the lockfile in Quartz's working directory (`plugin-data.js:6`). Spike confirms this end-to-end and prototypes the three-way R9 gate (config↔lock coverage → install → `.git/HEAD` postcondition).
- **Local-plugin build/lock treatment (Oracle-constrained):** the YAML loader symlinks local plugins but does NOT build them, and local lock entries carry non-portable absolute paths. Spike proves the chosen treatment: committed no-build plugin entry (or an explicit deterministic build step) + runtime-only local lock entry alongside the committed remote lock, resolved against Quartz's cwd with overlay-before-install.
- **Styling base import:** confirm the v5 equivalent of `@use "./base.scss";` (v5 styling is more plugin-driven; community plugins ship their own styles) so the built `index.css` carries base layout + brand rules and isn't base-stripped (the v4 unstyled-site footgun).

### Deferred to Implementation

- **OG image:** the v5 `og-image` plugin generates cards dynamically. Unit 2 enables it as the parity source of truth; whether it fully supersedes the static `og-image.svg` (resolving the raster-OG follow-up) or the static asset is retained is confirmed by inspecting the Unit 5 build output. (The plugin is in-scope either way; only the static-asset retention is the open detail.)
- **Final enabled-plugin set:** Unit 2 starts from the v5 default set and prunes toward parity, but the exact set is a **hypothesis validated by the Unit 5 parity diff (R11)**, not a settled list — v4 behavior lived inside core; v5 composes it across plugins with their own defaults, ordering, and interactions, so search/backlinks/graph/wikilink-resolution/page-type rendering may differ even when the matching plugin is enabled.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

v5 publish pipeline (changes from v4 marked ►):

```
push to main (knowledge/wiki|index|schema, quartz-site/**)  or  workflow_dispatch
        │  checkout ref: github.sha, persist-credentials: false, lfs: true
        ▼
  JOB build   permissions: { contents: read }   (no Pages/id-token)
    clone quartz@9cf87ff… (v5 tip)                       ► was v4.5.2 SHA
    overlay quartz-site/ (quartz.config.yaml, styles, static, local-plugin)  ► YAML + local plugin
    npm ci
  ► gate: config↔lock coverage (fail-closed)  → quartz plugin install (lockfile path)  → .git/HEAD == lock commit (fail-closed)
    node ./quartz/bootstrap-cli.mjs build -d knowledge -o public
    → upload-pages-artifact(public/)
        │
        ▼
  JOB deploy  needs: build   permissions: { pages: write, id-token: write }
    deploy-pages   (token-only job, unchanged)
```

Overlay shape (v4 → v5):

```
v4 overlay                          v5 overlay
──────────                          ──────────
quartz.config.ts        ─────────►  quartz.config.yaml   (configuration + theme + plugins + layout)
quartz.layout.ts        ──folds──►  (layout block inside quartz.config.yaml)
components/*.tsx+index.ts ────────►  local-plugin/  (Sources, GitHubSource, url-safety; referenced by relative source:)
styles/custom.scss      ─────────►  styles/custom.scss  (base import re-verified)
static/{icon.png,og}    ─────────►  static/{icon.png,og}  (unchanged; LFS favicon)
(none)                  ──new────►  quartz.lock.json  (committed plugin pins)
```

## Implementation Units

- [x] **Unit 0: Prerequisite spike (throwaway, resolve-before-building)**

**Goal:** Answer the four "Resolve Before Implementation" questions against the pinned v5 clone before writing any overlay code, so Units 1-4 build on verified mechanics, not assumptions.

**Requirements:** de-risks R1-R6, R9

**Dependencies:** None

**Files:** none committed — a scratch clone + notes folded back into this plan's Resolved section.

**Approach:**
- Clone Quartz at the pinned v5 SHA; trace the `plugins:` (YAML) → `externalPlugins` (loader) mapping through the config-loader and `quartz.ts`/`quartz.js`.
- Determine the lockfile location the loader reads, the install invocation that honors it, and how to assert resolved==pinned.
- Stand up a minimal local plugin (relative `source:`) and confirm it symlinks + renders.
- Confirm the base-layout style entrypoint for `custom.scss`.

**Execution note:** throwaway spike — its only deliverable is resolved answers written back into the plan's "Resolved During Planning" section; no production code.

**Test scenarios:** Test expectation: none — investigation spike.

**Verification:** all four prerequisites answered concretely enough that Units 1-4 have no load-bearing unknowns; if any answer contradicts the plan, the plan is updated before proceeding.

- [ ] **Unit 1: Custom components as a v5 local plugin**

**Goal:** Repackage the two custom components (`Sources`, `GitHubSource`) and their `url-safety` guard as a v5 local plugin in the overlay, referenced by a relative `source:` path, symlinked at install.

**Requirements:** R2

**Dependencies:** Unit 0

**Files:**
- Create: `quartz-site/local-plugin/` (plugin manifest + component sources + `url-safety.ts`)
- Remove: `quartz-site/components/index.ts` (v4 barrel — obsolete)
- Reference: existing `quartz-site/components/{Sources.tsx,GitHubSource.tsx,url-safety.ts}` as the migration source

**Approach:**
- Model the local plugin on a `github:quartz-community/*` component plugin's structure (manifest declaring the component, its layout category, and exports) pulled from the cloned v5 tree.
- Preserve `isSafeHttpUrl` (http/https-only) filtering in `Sources`, and the `edit/data/knowledge/...` GitHub link in `GitHubSource`.
- Reads only explicit frontmatter fields (`sources`) — no generic frontmatter iteration (keeps `node_id`/`database_id` out of output).

**Execution note:** Not unit-testable in isolation (Quartz plugin types exist only in the clone); verified by the full build in Unit 5. The `isSafeHttpUrl` guard retains its existing standalone test (`scripts/wiki-sources-url-safety.test.ts`), which must continue to pass unchanged.

**Patterns to follow:** a community component plugin's manifest/layout shape from the v5 tree; the existing component logic in `quartz-site/components/`.

**Test scenarios:**
- Happy path: a page with a 2-entry `sources` list renders two links to the correct URLs (verified in Unit 5 build).
- Edge case: a page with no `sources` renders no sources block.
- Edge case: a `javascript:`/`data:` URL in `sources` is dropped (guard retained) — `scripts/wiki-sources-url-safety.test.ts` stays green.
- Happy path: the GitHub source link resolves to the correct `edit/data/knowledge/...` path.

**Verification:** the local plugin installs (symlinks) and its components render in the Unit 5 build; the url-safety test passes unchanged.

- [ ] **Unit 2: YAML config + layout migration**

**Goal:** Replace `quartz.config.ts` + `quartz.layout.ts` with a single `quartz.config.yaml`: configuration, theme (colors verbatim), the community-plugin set pruned to parity, our local plugin, and the layout block placing our components.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 0, Unit 1

**Files:**
- Create: `quartz-site/quartz.config.yaml`
- Remove: `quartz-site/quartz.config.ts`, `quartz-site/quartz.layout.ts`

**Approach:**
- Port `configuration`: `pageTitle`, `enableSPA`, `enablePopovers`, `analytics: null` (telemetry rule — no plausible), `baseUrl: fro.bot/.github`, `ignorePatterns` (exclude `log.md`), and `theme` (typography Inter/JetBrains Mono, colors `lightMode`/`darkMode` verbatim from the v4 config).
- Declare the community plugins needed for parity — **derived from the ACTUAL v4 enabled surface** (`quartz-site/quartz.config.ts:69-90` plugins + `quartz.layout.ts:18-49` components), not from an assumed-minimal list. That means (Oracle-corrected): `note-properties` (replaces FrontMatter), `created-modified-date` (`defaultDateType: modified`), `syntax-highlighting`, `obsidian-flavored-markdown`, `github-flavored-markdown`, `crawl-links` (`markdownLinkResolution: shortest`), `content-index` (sitemap+RSS), **`alias-redirects`** (v4 emits alias redirect pages — omitting it breaks alias URLs), `favicon`, `og-image`, `cname`, `explorer`, `graph`, `search`, `backlinks`, **table-of-contents, description, LaTeX, draft filtering, article/content metadata, page-title, dark-mode toggle, breadcrumbs, footer, spacer, reader-mode, tag-list** (all rendered by the v4 layout today), plus content/folder/tag page types. Disable only what v4 genuinely lacks (canvas/bases/encrypted/stacked/comments/recent-notes). The final set is still validated by the R11 diff.
- Add our local plugin via a relative `source:` and place `Sources`/`GitHubSource` in the `layout` block (equivalent to the v4 `afterBody` placement).
- Resolve the `plugins:` → `externalPlugins` mapping (Deferred question) so both the community set and the local plugin install.

**Execution note:** SSG configuration — verified by the Unit 5 build, not unit tests.

**Patterns to follow:** `quartz.config.default.yaml` from the v5 tree; the current `quartz-site/quartz.config.ts` values.

**Test scenarios:** Test expectation: none — pure SSG configuration; behavior verified by the Unit 5 build (wikilinks, graph, search, backlinks, page-type rendering, log.md excluded, baseUrl baked as fro.bot).

**Verification:** the Unit 5 build renders all pages with wikilinks/backlinks/search/graph; `og:url` bakes `https://fro.bot/.github/...`; `log.md` absent.

- [ ] **Unit 3: Brand styling under v5**

**Goal:** Ensure the brand theme applies under v5: config colors (Unit 2) plus `custom.scss` brand rules, with the base layout stylesheet present (no base-stripping regression).

**Requirements:** R3

**Dependencies:** Unit 2

**Files:**
- Modify: `quartz-site/styles/custom.scss` (confirm/adjust the base import for v5)
- Reference: v5 `quartz/styles/` for the base stylesheet entrypoint

**Approach:**
- Confirm the v5 base-layout import (v4's `@use "./base.scss";`). If v5 renamed/moved it or drives base layout through plugin styles, adjust so the built `index.css` carries base layout + brand rules.
- Keep the `--frobot-*` brand tokens, shadow/glow, and component section styles.

**Execution note:** verified by measuring the built `index.css` in Unit 5 (size + presence of base grid AND brand rules), per the v4 unstyled-site lesson.

**Patterns to follow:** the v4 `custom.scss`; memory 6532's base-import footgun.

**Test scenarios:** Test expectation: none — styling; verified by the Unit 5 CSS assertion (base layout selectors present, `--frobot-*` tokens present, non-trivial size).

**Verification:** built `index.css` contains base layout (`grid-template`, sidebar, `#quartz-body`) AND brand theme (`--frobot-*`, `sources-section`); not base-stripped.

- [ ] **Unit 4: Publish workflow — v5 pin, plugin install, committed lockfile**

**Goal:** Update `publish-wiki.yaml` to pin Quartz v5 by SHA, run the `prebuild` plugin-install in the credential-less build job against a committed `quartz.lock.json` with a fail-closed lockfile-integrity gate and a minimized build env, keep the split/hardened pipeline, and update the workflow-shape test.

**Requirements:** R5, R6, R7, R9, R10

**Files:**
- Modify: `.github/workflows/publish-wiki.yaml`
- Create: `quartz.lock.json` (committed plugin pins) — location per the loader's expectation (repo root or overlay)
- Modify: `scripts/publish-wiki-workflow.test.ts`
- Re-verify: `.github/workflows/unpublish-wiki.yaml`

**Approach:**
- Change the Quartz clone pin from `4923affa…` to the v5 tip SHA `9cf87ff…`; keep `--depth 1` fetch of that SHA.
- Overlay the new shape: `quartz.config.yaml`, `styles/`, `static/`, and the local plugin dir (whole-dir copies, per the v4 lesson).
- Add the plugin-install step — **`node ./quartz/bootstrap-cli.mjs plugin install`** (the lockfile path; NOT the `prebuild` hook, which installs from config and ignores the lockfile; NOT `--latest`/`--from-config`) — in the **build** job only (contents:read, no deploy creds). Bound install concurrency (upstream warns of CI OOM/hangs at CPU-count default) and validate elapsed time under the job timeout.
- Add `quartz.lock.json` (at its Unit-0-confirmed location) to the workflow's `on.push.paths` — otherwise lock-only changes never republish.
- **Lockfile-integrity gate (R9, three-way):** (1) pre-install: exact config↔lock coverage (every enabled remote plugin locked — source/name/ref/subdir match; no missing/extra entries; no remote `subdir` plugins at all); (2) lockfile install; (3) post-install: each `.quartz/plugins/<name>/.git/HEAD` equals its lock commit. Fail closed at any step — the installer can log failures yet exit success, so postcondition checks are mandatory.
- **Minimize the build env (R10):** the build job carries only the read-only checkout token — no id-token, no extra secrets — so untrusted plugin build code has nothing worth exfiltrating; the artifact is the sole output crossing to deploy.
- Keep: `lfs: true` checkout, `persist-credentials: false`, `ref: github.sha`, split build/deploy, all-actions-SHA-pinned, fail-closed deploy (`needs: build`, no `always()`/`continue-on-error`).
- Update `scripts/publish-wiki-workflow.test.ts`: assert the new v5 SHA, the plugin-install step present in build and ABSENT from deploy, install-before-build, the lockfile-integrity gate present, the build job holds no id-token/extra secrets, and retain the existing `lfs: true` / token-isolation / fail-closed assertions.

**Execution note:** workflow YAML validated by the shape test + actionlint; the real build is exercised by the Unit 5 dispatch.

**Patterns to follow:** the current `publish-wiki.yaml` split-job structure; `scripts/publish-wiki-workflow.test.ts` assertion style.

**Test scenarios:**
- Edge case: the plugin-install step exists in `build` and NOT in `deploy` (supply-chain isolation).
- Edge case: install runs before the build step; Quartz pinned to the v5 SHA (not a floating branch).
- Edge case (R9): a lockfile-integrity assertion step exists and gates the build (fail-closed on resolved≠pinned).
- Edge case (R10): the build job declares no `id-token` and no extra secrets — only the read-only checkout token.
- Edge case (retained): only `deploy` holds `pages: write`/`id-token: write`; `lfs: true`; fail-closed (`needs: build`, no `always()`/`continue-on-error`); all `uses:` SHA-pinned.
- Integration: the workflow references `quartz.config.yaml` and the committed lockfile.

**Verification:** `pnpm test scripts/publish-wiki-workflow.test.ts` green; actionlint clean; deploy unreachable if build fails; plugin install confined to the build job.

- [ ] **Unit 5: Full-parity verification + docs**

**Goal:** Prove capability parity via an explicit v4-baseline-vs-v5 diff on a workflow-faithful local build, then a live dispatch after merge; update docs and memory to the v5 model.

**Requirements:** R1-R11

**Dependencies:** Units 1-4

**Files:**
- Modify: `quartz-site/README.md` (v5 model: YAML config, plugin lockfile, local plugin, pin/upgrade policy)
- Modify: `README.md` (any v4-specific wording)
- Reference: `docs/wiki-site-runbook.md` (confirm unpublish steps still valid)

**Approach:**
- Reproduce the workflow exactly locally: clone Quartz@`9cf87ff…`, overlay, `npm ci`, run install-plugins against the committed lockfile, build `-d knowledge -o public`.
- **Explicit parity diff (R11, Oracle-expanded):** capture the current v4 build's emitted surface as a baseline and diff the v5 build against it. The diff covers: the full output HTML path/slug set (esp. `owner--repo` double-dash — byte-identical, not "look similar"); **alias-redirect pages (paths, targets, canonical destination); `sitemap.xml` + `index.xml` (RSS) path sets and absolute URLs; `404.html`; per-page heading `id` sets (inbound `#fragment` targets); canonical URLs alongside `og:url`; internal `href`/`src` resolution under `/.github/`; the static-asset path set (JS/CSS/fonts/images); CNAME output**; the search index `contentIndex.json`; graph data; per-page backlinks; both custom components; `index.css` (base layout + brand); favicon (real PNG via LFS); `log.md` excluded. Plus **behavioral smoke checks** — search returns results, graph renders, SPA nav works — since data-file presence doesn't prove client execution. Any slug/redirect/anchor drift is a bookmark/backlink break and blocks cutover (fix via aliases/redirects/config before merge).
- After merge + live dispatch: verify `https://fro.bot/.github/` renders styled, pages 200 (spot-check `owner--repo` and topic pages), CSS non-trivial — served-output verification, not green-check proxy. Note the residual: things that can still pass local + green CI but break live (Pages base-path/canonical behavior, LFS fetch under Actions, plugin-install under Actions network, live CDN serving stale CSS) — the live dispatch is the real gate, local parity is only a proxy.
- Update `quartz-site/README.md`, `README.md`, and memory 6532 to the v5 architecture; reconcile any doc still naming `fro-bot.github.io/.github` — the canonical served origin is `https://fro.bot/.github/` (verified live), and OG/sitemap/CNAME judgments key off it.
- Origin-isolation check (R10 residual): confirm the `fro.bot` origin carries no sensitive browser state reachable by wiki-served script.

**Execution note:** the holistic integration gate for the whole migration — the "test the integration seam" discipline that caught all four v4 footguns.

**Patterns to follow:** the v4 live-verification method (served CSS size + baked URLs + page 200s).

**Test scenarios:** Test expectation: none — verification + docs. Parity is asserted by the local build + live-fetch checks above; the only automated test is the retained url-safety test and the Unit 4 workflow-shape test.

**Verification:** local v5 build reaches full parity with the v4 baseline; post-merge live site renders styled and serves 200 across index + wiki pages; docs/memory reflect v5.

## Rollback Strategy

"Roll back to v4.5.2" is **not** a pin flip once the migration lands — the commit deletes `quartz.config.ts`/`quartz.layout.ts`, replaces components with a local plugin, adds `quartz.config.yaml` + `quartz.lock.json`, and rewrites the workflow. Rollback is a three-tier ladder, fastest first:

1. **Site recovery (seconds–minutes):** run the emergency-unpublish workflow (`unpublish-wiki.yaml`) to take the live site to the takedown page. Use when the live v5 site is actively wrong and must stop serving now.
2. **Deployment rollback (minutes, with a caveat):** re-run the last green pre-migration publish workflow from its commit (`workflow_dispatch` on the pre-migration SHA is not available — Pages artifacts expire at 1-day retention, so "re-deploy the old artifact" is NOT reliable). The operational form of this tier is: dispatch a rebuild from the last-good code state (tier 3's revert, or a temporary branch at the pre-migration commit). If minutes matter more, use tier 1 first.
3. **Code rollback (a PR):** `git revert` the migration commit(s) — this restores the entire v4 overlay (config, layout, components, workflow, pin) as one atomic unit, because they all landed together. This is the true "back to v4.5.2," not a pin edit. Because the migration lands as a cohesive commit set, the revert is clean.

The v4.5.2 overlay is only a "known-good rollback" in the sense that it is recoverable via tier 3; the plan does not claim a live v4 build coexists with v5. Parity is verified (R11) before the live cutover specifically to avoid needing rollback.

## System-Wide Impact

- **Interaction graph:** `publish-wiki.yaml`'s build job gains a network-fetching plugin-install step (git-clones community plugins). No other workflow calls it. The `data → main` promotion still produces the `push` that triggers publish.
- **Error propagation:** plugin-install failure fails the build job → deploy blocked (fail-closed). A build failure (bad config, missing plugin) blocks deploy exactly as today.
- **State lifecycle risks:** one live Pages deployment; a bad v5 publish is corrected by the rollback ladder (see Rollback Strategy). Rollback is a migration-commit revert, not a pin flip.
- **API surface parity:** the served site URLs must stay unchanged (same `fro.bot/.github/` paths and slugs). v5 lowercases+hyphenates URLs; our `owner--repo` slugs *look* already-conformant but this must be **proven byte-identical** against the v4 baseline (R11), not assumed — slug drift breaks inbound bookmarks and backlinks.
- **Integration coverage:** the overlay/plugin-install/build seam is only exercised by the real workflow — covered by the Unit 5 workflow-faithful local build + live dispatch, and the Unit 4 shape test.
- **Unchanged invariants:** wiki content tree, `data`-branch sole-writer, `Check Wiki Authority`, promotion privacy gate, hosting, exposure posture — all unchanged. This migration only swaps the render toolchain.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Build job runs ~40 plugins' untrusted install/build code with network + repo-read → artifact poisoning, repo/env exfiltration, hostile transitive deps | Minimize the build env (R10): no id-token, no secrets beyond the read-only checkout token — nothing worth stealing; artifact is the only output to deploy. Deploy credential stays in a separate job. Accepted residual for a public wiki: a malicious plugin can deface already-public content. |
| Lockfile not honored → build resolves plugin branch tips (pin integrity lost) — TOCTOU/resolver-trust gap | Hard fail-closed gate (R9): assert resolved commit set == `quartz.lock.json`; use the lockfile-honoring install (not `--latest`/`--from-config`); fallback to explicit `#<sha>` on each `source:`. |
| Some pinned plugins may not build cleanly at an older commit (upstream troubleshooting notes this) | Pin is operationally immutable, not eternally reproducible; policy: if a pinned plugin breaks, bump THAT plugin's lockfile commit deliberately and re-verify parity — never blanket `--latest`. |
| Plugin PARITY is a new composition model, not "turn on the matching plugin" — search/backlinks/graph/wikilink/page-type behavior may differ from v4 core | Treat the enabled set as hypothesis; R11 parity diff against the v4 baseline is the gate, not plugin presence. |
| v5 lowercase+hyphenate URL change breaks `owner--repo` slugs / inbound bookmarks / backlinks | R11 proves slugs byte-identical to the v4 baseline (not "look similar"); slug drift blocks cutover, fixed via aliases/redirects/config before merge. |
| Custom components don't cleanly become a local plugin | Provisionally verified: `gitLoader.ts` confirms local-path symlink support, but bundling/layout wiring under the overlay workspace is unproven until Unit 5 build; Unit 0 spike de-risks first. |
| Base-layout stylesheet stripped under v5 (the v4 unstyled footgun, one tier over) | Unit 0 confirms the v5 base import; Unit 5 asserts base layout + brand rules in the built `index.css`. |
| Live v5 site broken after cutover | Three-tier rollback ladder (see Rollback Strategy): emergency unpublish → re-deploy last-good artifact → revert migration commit. Parity verified before cutover to avoid needing it. |
| "Workflow-faithful local build" is still only a proxy for the live seam (the rollout's recurring lesson) | Unit 5 does the local parity diff AND a post-merge live dispatch with served-output verification; the live dispatch is the real gate. |
| `og-image` plugin changes social-card behavior | Unit 2 enables it; Unit 5 confirms OG output; static-asset retention decided from build output. |
| Node/toolchain drift | v5 `engines.node >=22` — CI Node 22 unchanged; `npm ci` unchanged. |
| Plugin git pins don't pin npm resolution inside plugin builds (`--ignore-scripts` + ranged `--no-save` natives) | Unit 0 verifies enabled plugins ship prebuilt `dist/` needing no install; otherwise the floating-registry residual is explicitly accepted and documented. |
| Hostile plugin output = arbitrary active content on the Pages origin (JS/redirects/phishing/same-origin requests), not just defacement | Cutover confirms the served origin carries no sensitive browser state; the wiki origin is isolated from anything holding meaningful cookies/localStorage. |
| Plugin-install concurrency OOM/hangs on CI runners (upstream-documented) | Bounded concurrency; validate elapsed time under the job timeout. |
| Lock-only changes don't republish | `quartz.lock.json` added to `on.push.paths`. |

## Documentation / Operational Notes

- `quartz-site/README.md`: rewrite for the v5 model (YAML config, `quartz.lock.json`, local plugin, v5 SHA pin + deliberate-upgrade policy).
- Update memory 6532 to the v5 architecture and the v5 analogs of the four footguns.
- Rollback runbook: if the live v5 site regresses, revert the pin/overlay commit to restore the known-good v4.5.2 build.

## Sources & References

- Live v5 tree (pinned SHA `9cf87ff1c248a8ca551093214b0fec3b31415009`): `quartz.config.default.yaml`, `quartz.lock.json`, `package.json`, `quartz/plugins/loader/gitLoader.ts`, `quartz/plugins/loader/install-plugins.ts`, `docs/`
- Current overlay: `quartz-site/**`, `.github/workflows/publish-wiki.yaml`, `.github/workflows/unpublish-wiki.yaml`, `scripts/publish-wiki-workflow.test.ts`
- Learnings: `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md`; memory 6532
- Upgrade guide: https://quartz.jzhao.xyz/upgrading
