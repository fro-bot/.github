# Quartz Site Configuration

This directory holds the configuration and customizations for the web-rendered wiki, built with [Quartz](https://quartz.jzhao.xyz/) v5 and published to [fro.bot/.github](https://fro.bot/.github/).

## Fetch-at-Build Overlay Model

I don't vendor Quartz in this repository. The **Publish Wiki** workflow clones upstream Quartz at a pinned commit during CI, then overlays this directory's files on top of that checkout before building.

- **Pinned SHA**: `9cf87ff1c248a8ca551093214b0fec3b31415009` (v5 branch tip)

Bumping that SHA is a deliberate, tested change, not a routine dependency bump — see "Upgrade Policy" below.

### Overlay File Map

Files in this directory that get copied onto the pinned Quartz checkout at build time:

- `quartz.config.yaml` — the single config+layout file. v5 collapsed `quartz.config.ts` and `quartz.layout.ts` into one YAML document; site config, plugin list, and page layout all live here now.
- `local-plugin/` — the custom components (attribution/sources renderer + edit-on-GitHub link), packaged as a Quartz v5 local plugin. See "Local Plugin Recipe" below.
- `styles/custom.scss` — theme overrides only. Does **not** import `base.scss` — v5 includes base styles itself, so importing it here would double-include and duplicate rules.
- `static/*` — static assets (icon, OG image) copied into the build output.

Everything else that used to live here as hand-maintained files — the ~30 built-in v4 features (search, graph, backlinks, table of contents, darkmode, etc.) — is now installed as pinned community plugins declared in `quartz.config.yaml` and resolved through `quartz.lock.json`. There's no `components/index.ts` barrel to re-sync anymore; that entire class of upgrade risk is gone.

## Plugin Model: Community Plugins + Lockfile

v5 ships almost no built-in functionality — nearly everything (search, graph view, backlinks, TOC, dark mode, breadcrumbs, footer, RSS-style content index, and more) is a separate plugin under `github:quartz-community/*`, enabled in `quartz.config.yaml` and pinned to an immutable commit in `quartz.lock.json`.

`quartz.lock.json` is committed. Every entry pins a plugin's `source` to an exact `commit`, not a branch or tag — floating refs are not permitted.

### fonts Plugin: Disabled

`github:quartz-community/fonts` is present in the plugin list but disabled. Leaving it enabled would override the brand typography (Inter for body text, JetBrains Mono for code) with the plugin's own font defaults. This is a deliberate exclusion, not an oversight — don't re-enable it without also reconciling font config.

## Build-Time Lockfile Enforcement (Fail-Closed)

The build job in `.github/workflows/publish-wiki.yaml` enforces the lockfile with a three-step chain. Any drift fails the build before it reaches `deploy`:

1. **Coverage gate (pre-install)** — before any network install happens, a script proves every enabled remote plugin in `quartz.config.yaml` has a matching entry in `quartz.lock.json`, that there are no orphaned lock entries for plugins that aren't enabled, and that no enabled remote plugin uses a rejected object-source `subdir` shape.
2. **Install from lockfile** — `node ./quartz/bootstrap-cli.mjs plugin install` installs strictly from `quartz.lock.json`. There's no `--latest`/`--from-config` invocation anywhere in this pipeline; nothing resolves floating refs at build time.
3. **Integrity gate (post-install)** — after install, a script compares each installed plugin's actual `.git/HEAD` against its lockfile `commit`. A branch checkout (`ref:` HEAD) counts as drift and fails exactly like a mismatched SHA — the installer can log a failure internally and still exit success, so this is the only step that actually proves the install happened as pinned.

If you need to bump a single plugin, edit that plugin's `commit` in `quartz.lock.json` deliberately — never regenerate the whole lockfile as a blanket refresh.

## Local Plugin Recipe

`local-plugin/` holds the custom components as a Quartz v5 local plugin, referenced from `quartz.config.yaml` as `./local-plugin` relative to the Quartz build root.

- `dist/` is committed, plain JS, with no build step. Quartz v5 symlinks local plugins rather than compiling them, so there's nothing to transpile at build time — what's committed is what runs.
- `package.json` declares a `quartz` manifest block so Quartz's plugin loader recognizes it, and requires `quartzVersion": ">=5.0.0"`.
- `preact` isn't vendored — the workflow installs it into `local-plugin/node_modules` at build time, pinned to whatever version the pinned Quartz checkout itself depends on (read from `quartz-build/package.json`, not hardcoded), so the local plugin's Preact always matches Quartz's own.
- The http(s)-only URL guard for the sources/edit-link renderer lives in `local-plugin/dist/url-safety.js`. Tested in `scripts/wiki-sources-url-safety.test.ts`.

## Content Root Decision

The build points at `knowledge/`, not `knowledge/wiki/`, so `knowledge/index.md` and `knowledge/schema.md` render alongside the wiki pages.

- **Build command argument**: `-d knowledge`
- `log.md` is excluded via `ignorePatterns` in `quartz.config.yaml` — it's an append-only ingest log, not a page.

## Privacy: `analytics: null`

`quartz.config.yaml` sets `analytics: null` explicitly. No third-party or unconsented telemetry — Plausible, GA, or otherwise — ships with this site.

## No Generic Frontmatter Rendering

The local plugin's components read only the explicit frontmatter fields they need. Neither one iterates over arbitrary frontmatter and renders whatever it finds. That's deliberate: wiki pages carry internal bookkeeping fields (`node_id`, `database_id`) that must never show up on a rendered page, and a "render everything" component would leak them the first time someone adds a new field upstream.

## CSS Output Is Split

v5 emits CSS across many hashed files (`component-*.css`, `index-<hash>.css`), not one `index.css`. If you're verifying `custom.scss` rules landed in the build output, check the aggregate of all emitted CSS files in `public/`, not a single index file — grepping for one filename will silently miss real output.

## OG Images

The `og-image` community plugin generates a raster social card per page at build time (`*-og-image.webp`), so link previews work without a hand-maintained raster. `static/og-image.svg` remains as a brand asset but is no longer the social-card source.

## Upgrade Policy

Two different things can move, and they're governed differently:

- **Bumping Quartz itself** — change the pinned SHA (here and in the workflow) and re-verify parity: the build succeeds, the overlay files still apply cleanly, and every enabled plugin is still compatible with the new Quartz version.
- **Bumping a single plugin** — change that plugin's `commit` in `quartz.lock.json` deliberately. Never a blanket lockfile refresh; each bump should be its own reviewed change.
