---
type: topic
title: GitHub Pages
created: 2026-04-18
updated: 2026-04-25
tags: [github-pages, deployment, ci-cd, static-sites, esp-web-tools, jekyll]
related:
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--esphome-life
---

# GitHub Pages

Static site hosting via GitHub. Deployment patterns observed across the Fro Bot ecosystem.

## Repos Using GitHub Pages

- [[marcusrbrown--mrbro-dev]] — React 19 + Vite 7 portfolio, custom domain at mrbro.dev
- [[marcusrbrown--marcusrbrown-github-io]] — React 19 + Vite 7 brand site, custom domain at marcusrbrown.com
- [[marcusrbrown--esphome-life]] — Jekyll (slate theme) + ESP Web Tools firmware installer, deployed to `gh-pages` branch

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

## Performance Monitoring

[[marcusrbrown--mrbro-dev]] runs Lighthouse CI against the deployed site with device-specific budgets:

- Desktop: Performance >= 95%, LCP <= 2s, CLS <= 0.05
- Mobile: Performance >= 90%, LCP <= 2.5s, CLS <= 0.1
- Resource budgets: JS <= 512KB, CSS <= 100KB, total <= 2MB

Weekly scheduled performance runs (Monday 06:00 UTC) establish baselines for regression detection.
