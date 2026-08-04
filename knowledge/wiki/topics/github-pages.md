---
type: topic
title: GitHub Pages
created: 2026-04-18
updated: 2026-08-05
tags: [github-pages, deployment, ci-cd, static-sites, esp-web-tools, jekyll, astro, starlight, git-lfs, csp, analytics, spectacle, slidev, gh-pages-cli]
related:
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--esphome-life
  - marcusrbrown--presentations
  - fro-bot--systematic
---

# GitHub Pages

Static site hosting via GitHub. Deployment patterns observed across the Fro Bot ecosystem.

## Repos Using GitHub Pages

- [[marcusrbrown--mrbro-dev]] — React 19 + Vite 7 portfolio, custom domain at mrbro.dev
- [[marcusrbrown--marcusrbrown-github-io]] — React 19 + Vite 7 brand site, custom domain at marcusrbrown.com
- [[marcusrbrown--esphome-life]] — Jekyll (slate theme) + ESP Web Tools firmware installer, deployed to `gh-pages` branch
- [[marcusrbrown--presentations]] — slide-deck archive at `marcusrbrown.github.io/Presentations/`; per-talk subtrees (Spectacle/CRA 2017, Slidev/Bun 2026), `gh-pages`-CLI deploy
- [[fro-bot--systematic]] — Starlight/Astro docs site for `@fro.bot/systematic`, deployed to `gh-pages` branch at fro.bot/systematic/

## Deployment Patterns Observed

### Vite + GitHub Actions

The pattern used in [[marcusrbrown--mrbro-dev]]:

1. Build with Vite (`pnpm run build`) using `GITHUB_PAGES=true` env variable
2. Upload via `actions/upload-pages-artifact` (targets `./dist`)
3. Deploy via `actions/deploy-pages`
4. Requires `pages: write` and `id-token: write` permissions
5. Concurrency group `pages` with `cancel-in-progress: false` to prevent partial deploys

The deploy workflow runs lint and test gates before building, ensuring only validated code reaches production.

### Custom Domains

Two Marcus repos use custom domains with GitHub Pages:

- **mrbro.dev** — [[marcusrbrown--mrbro-dev]], full portfolio with React Router
- **marcusrbrown.com** — [[marcusrbrown--marcusrbrown-github-io]], single-page brand site (CNAME in `public/`)

Both use Vite with `base: '/'` for custom domain compatibility (no path prefix needed).

### Jekyll + ESP Web Tools (Firmware Distribution)

The pattern used in [[marcusrbrown--esphome-life]]:

1. CI builds ESPHome firmware via `esphome/build-action@v7.1.0` with a matrix of device YAML files
2. Build artifacts are uploaded and combined into a single `manifest.json` (jq merge of per-device manifests)
3. Static site files from `static/` are copied alongside the manifest
4. Deployed to `gh-pages` branch via `JamesIves/github-pages-deploy-action@v4.8.0`
5. Commit author is `mrbro-bot[bot]` using a GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` secrets)
6. The site uses `esp-web-tools@8.0.3` to provide browser-based USB firmware flashing

This pattern is distinct from the SPA deploy pattern — it serves firmware binaries alongside a minimal Jekyll site rather than a JS application bundle.

### Starlight/Astro Cross-Repo Deploy

The pattern used in [[marcusrbrown--systematic]] → [[fro-bot--systematic]]:

1. Astro/Starlight docs site lives in the source repo (`marcusrbrown/systematic/docs/`)
2. A `docs.yaml` workflow in the source repo builds the site and pushes output to a separate repo (`fro-bot/systematic:gh-pages`)
3. GitHub Pages serves the `gh-pages` branch at `fro.bot/systematic/`
4. All commits on the target repo are authored by `fro-bot[bot]` with provenance messages linking back to the source SHA
5. `.nojekyll` disables Jekyll processing; Pagefind provides client-side search
6. `.well-known/ocx.json` serves the OCX component registry, enabling `ocx` CLI to install skills/agents from the docs URL

This cross-repo pattern separates the docs deployment surface from the source repo, keeping the source repo's Pages available for other uses and giving the docs site its own URL under the `fro-bot` org.

### Slide decks via the `gh-pages` CLI (pre-Actions pattern)

The pattern used in [[marcusrbrown--presentations]]'s 2017 deck predates the `actions/deploy-pages` era: a Create React App build with `spectacle` slides deploys through the **`gh-pages` npm package** rather than a Pages workflow — `predeploy` runs `npm run build`, `deploy` runs `gh-pages -d build`, which force-pushes the built `build/` directory to the `gh-pages` branch. The CRA `homepage` field (`https://marcusrbrown.github.io/Presentations`) drives the relative asset paths. It's a manual, local-invocation deploy: no CI job publishes it; the author runs `npm run deploy`. Contrast with the Vite + `actions/deploy-pages` flow above, which is CI-triggered and artifact-based. The archive's newer 2026 Slidev deck (`slidev build` → static `dist/`) has no wired deploy at all in-repo — it's a presentable static SPA on demand, not a published page.

The general lesson: a multi-talk presentation archive tends to accumulate *heterogeneous* deploy mechanisms over time (gh-pages-CLI, none, or a future Actions flow), because each deck freezes with the tooling of its year rather than migrating to a shared publish pipeline.

**Footgun — config files on a build-output branch.** On 2026-06-24, [[fro-bot--systematic]] merged a `.github/renovate.json5` directly onto `gh-pages` (its default, build-output branch). Because every other commit on that branch is a `fro-bot[bot]` "Deploy docs from ..." overwrite, hand-authored config living there is fragile: the next docs build can clobber or orphan it unless the source-repo build pipeline explicitly preserves the path. Onboarding a build-output-only repo into Renovate also adds operational surface (and, in this case, a config-error issue that halted Renovate) without a dependency target to update — there is no `package.json` on a pure static-output branch. When a deploy-target repo is one branch of build artifacts, repo automation that assumes a normal source branch tends to mis-fire.

## Performance Monitoring

[[marcusrbrown--mrbro-dev]] runs Lighthouse CI against the deployed site with device-specific budgets:

- Desktop: Performance >= 95%, LCP <= 2s, CLS <= 0.05
- Mobile: Performance >= 90%, LCP <= 2.5s, CLS <= 0.1
- Resource budgets: JS <= 512KB, CSS <= 100KB, total <= 2MB

Weekly scheduled performance runs (Monday 06:00 UTC) establish baselines for regression detection.

## Footgun — Git LFS and web-served assets

GitHub Pages does **not** resolve Git LFS pointers. If a binary asset (image, font, etc.) is tracked by LFS and committed as a pointer file, Pages serves the ~130-byte pointer text verbatim instead of the blob — the asset renders broken in production even though it displays correctly in the GitHub UI and local checkouts (which transparently smudge LFS pointers).

[[marcusrbrown--mrbro-dev]] hit this on 2026-07-26 (#228): self-hosted project-preview PNGs added a week earlier (#202) were tracked by a repo-wide `*.png filter=lfs` rule, so the images broke on the live site. The fix is a **`.gitattributes` exemption** that overrides LFS for the web-served path while keeping it for other PNGs:

```gitattributes
*.png filter=lfs diff=lfs merge=lfs -text

# Web-served preview images must be real blobs — GitHub Pages does not resolve LFS pointers
public/project-previews/*.png filter= diff= merge= -text
```

The empty `filter=`/`diff=`/`merge=` values unset the inherited LFS attributes for the narrower glob, forcing those files to commit as real blobs. General rule: any binary that ships in a Pages build output (`dist/`, `public/`) must be a real Git blob, not an LFS pointer.

## Build-time-gated, self-hosted analytics on a Pages SPA

[[marcusrbrown--mrbro-dev]] added a privacy-preserving web-analytics subsystem on 2026-08-01 (#256/#257) that is a reusable template for adding telemetry to a static Pages site without violating a no-unconsented-telemetry baseline:

- **Self-hosted processor, not a SaaS vendor.** The tracker points at a self-hosted Umami instance (`metrics.fro.bot`, an [[marcusrbrown--infra]] app), so no third-party analytics script loads and no data leaves the operator's own infrastructure.
- **Build-time injection gated on a repo variable.** Because a Pages SPA has no server, activation is a *build-time* decision: a GitHub repo variable (`UMAMI_WEBSITE_ID`) is mapped to a Vite env var (`VITE_UMAMI_WEBSITE_ID`) **only on the build step** of `deploy.yaml` (step-scoped, so it can't leak into unrelated steps). Vite injects exactly one tracker tag only when the variable is set; unconfigured builds and dev builds ship no tag. Leaving the variable unset is the **fail-closed default** — the deployed artifact contains no tracker until a human sets it.
- **Human activation gate + operator runbook.** `docs/analytics.md` carries a Go/No-Go matrix that blocks activation until version-controlled infrastructure evidence proves the retention boundary. The gate lives in docs + process, not in code, because the code already fails closed.
- **CSP-safe static bootstraps.** To keep a strict Content-Security-Policy (no inline `<script>`), executable SPA bootstraps (theme preload, SPA redirect/restore for the 404-rewrite trick) were moved from inline `index.html` into tested `public/scripts/*.js` files served as real static assets. This is a general Pages-SPA pattern: inline bootstrap logic that a redirect/theme flash needs must become external scripts to satisfy CSP, and they can be unit-tested in isolation.

General rule for Pages SPAs: telemetry activation is a build-time env decision (fail closed when unset), the processor should be self-hosted to honor a no-unconsented-telemetry baseline, and any bootstrap that would otherwise be an inline `<script>` should be an external, testable `public/scripts/*.js` asset for CSP compatibility.
