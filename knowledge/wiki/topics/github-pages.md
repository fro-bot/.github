---
type: topic
title: GitHub Pages
created: 2026-04-18
updated: 2026-06-25
tags: [github-pages, deployment, ci-cd, static-sites, esp-web-tools, jekyll, astro, starlight]
related:
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--esphome-life
  - fro-bot--systematic
---

# GitHub Pages

Static site hosting via GitHub. Deployment patterns observed across the Fro Bot ecosystem.

## Repos Using GitHub Pages

- [[marcusrbrown--mrbro-dev]] — React 19 + Vite 7 portfolio, custom domain at mrbro.dev
- [[marcusrbrown--marcusrbrown-github-io]] — React 19 + Vite 7 brand site, custom domain at marcusrbrown.com
- [[marcusrbrown--esphome-life]] — Jekyll (slate theme) + ESP Web Tools firmware installer, deployed to `gh-pages` branch
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

**Footgun — config files on a build-output branch.** On 2026-06-24, [[fro-bot--systematic]] merged a `.github/renovate.json5` directly onto `gh-pages` (its default, build-output branch). Because every other commit on that branch is a `fro-bot[bot]` "Deploy docs from ..." overwrite, hand-authored config living there is fragile: the next docs build can clobber or orphan it unless the source-repo build pipeline explicitly preserves the path. Onboarding a build-output-only repo into Renovate also adds operational surface (and, in this case, a config-error issue that halted Renovate) without a dependency target to update — there is no `package.json` on a pure static-output branch. When a deploy-target repo is one branch of build artifacts, repo automation that assumes a normal source branch tends to mis-fire.

## Performance Monitoring

[[marcusrbrown--mrbro-dev]] runs Lighthouse CI against the deployed site with device-specific budgets:

- Desktop: Performance >= 95%, LCP <= 2s, CLS <= 0.05
- Mobile: Performance >= 90%, LCP <= 2.5s, CLS <= 0.1
- Resource budgets: JS <= 512KB, CSS <= 100KB, total <= 2MB

Weekly scheduled performance runs (Monday 06:00 UTC) establish baselines for regression detection.
