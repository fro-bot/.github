# Quartz Site Configuration

This directory holds the configuration and customizations for the web-rendered wiki, built with [Quartz](https://quartz.jzhao.xyz/) and published to [fro-bot.github.io/.github](https://fro-bot.github.io/.github/).

## Fetch-at-Build Overlay Model

I don't vendor Quartz in this repository. The **Publish Wiki** workflow clones upstream Quartz at a pinned commit during CI, then overlays this directory's files on top of that checkout before building.

- **Pinned SHA**: `4923affa7722dfc751f1074348e6dad214fe0c08` (v4.5.2)

Bumping that SHA is a deliberate, tested change, not a routine dependency bump:

1. Re-verify the build succeeds against the new upstream commit.
2. Check every overlay file below for compatibility — Quartz internals move between versions.
3. Update the pinned SHA here and in `.github/workflows/publish-wiki.yaml`.

### Overlay File Map

Files in this directory that get copied onto the pinned Quartz checkout at build time:

- `quartz.config.ts` — replaces upstream site config.
- `quartz.layout.ts` — replaces upstream layout config.
- `components/Sources.tsx`, `components/GitHubSource.tsx` — custom components (attribution + edit-on-GitHub link).
- `components/index.ts` — **a pinned copy of Quartz's own component barrel**, not a from-scratch file. It re-exports upstream components plus the two custom ones above. Any Quartz version bump has to re-sync this file against the new upstream barrel, or new/renamed upstream components silently won't be available.
- `styles/custom.scss` — theme overrides.
- `static/*` — static assets (icon, OG image) copied into the build output.

## Content Root Decision

The build points at `knowledge/`, not `knowledge/wiki/`, so `knowledge/index.md` and `knowledge/schema.md` render alongside the wiki pages.

- **Build command argument**: `-d knowledge`
- `log.md` is excluded via `ignorePatterns` in `quartz.config.ts` — it's an append-only ingest log, not a page.

## Privacy: `analytics: null`

`quartz.config.ts` sets `analytics: null` explicitly. No third-party or unconsented telemetry — Plausible, GA, or otherwise — ships with this site.

## No Generic Frontmatter Rendering

The custom components (`Sources.tsx`, `GitHubSource.tsx`) read only the explicit frontmatter fields they need. Neither one iterates over arbitrary frontmatter and renders whatever it finds. That's deliberate: wiki pages carry internal bookkeeping fields (`node_id`, `database_id`) that must never show up on a rendered page, and a "render everything" component would leak them the first time someone adds a new field upstream.

## Known Gap: OG Image

`static/og-image.svg` exists, but there's no raster `og-image.png`. SVG Open Graph images don't render as social-card previews on most platforms (Slack, Twitter/X, Discord). Generate a PNG export before relying on social-card previews for this site.

## Upgrade Policy

Bumping the pinned Quartz version requires all three steps in "Fetch-at-Build Overlay Model" above — re-verify the build, check overlay compatibility (especially `components/index.ts`), update the pinned SHA in both this file and the workflow.
