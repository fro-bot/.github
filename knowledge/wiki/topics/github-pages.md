---
type: topic
title: GitHub Pages
created: 2026-04-18
updated: 2026-04-18
tags: [github-pages, deployment, ci-cd, static-sites]
related:
  - marcusrbrown--mrbro-dev
---

# GitHub Pages

Static site hosting via GitHub. Deployment patterns observed across the Fro Bot ecosystem.

## Repos Using GitHub Pages

- [[marcusrbrown--mrbro-dev]] — React 19 + Vite 7 portfolio, custom domain at mrbro.dev

## Deployment Patterns Observed

### Vite + GitHub Actions

The pattern used in [[marcusrbrown--mrbro-dev]]:

1. Build with Vite (`pnpm run build`) using `GITHUB_PAGES=true` env variable
2. Upload via `actions/upload-pages-artifact` (targets `./dist`)
3. Deploy via `actions/deploy-pages`
4. Requires `pages: write` and `id-token: write` permissions
5. Concurrency group `pages` with `cancel-in-progress: false` to prevent partial deploys

The deploy workflow runs lint and test gates before building, ensuring only validated code reaches production.

### Custom Domain

mrbro.dev uses a custom domain with GitHub Pages. The Vite config sets `base: '/'` for custom domain compatibility (no path prefix needed).

## Performance Monitoring

[[marcusrbrown--mrbro-dev]] runs Lighthouse CI against the deployed site with device-specific budgets:

- Desktop: Performance >= 95%, LCP <= 2s, CLS <= 0.05
- Mobile: Performance >= 90%, LCP <= 2.5s, CLS <= 0.1
- Resource budgets: JS <= 512KB, CSS <= 100KB, total <= 2MB

Weekly scheduled performance runs (Monday 06:00 UTC) establish baselines for regression detection.
