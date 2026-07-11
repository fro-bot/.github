# Quartz Site Configuration

This directory contains configuration and customizations for our web-viewable wiki, which is built using [Quartz](https://quartz.jzhao.xyz/).

## Fetch-at-Build Overlay Model

We do **not** vendor Quartz directly in this repository. Instead, we use a fetch-at-build overlay model in CI.

During the build process (e.g., in our GitHub Actions workflow), CI clones the upstream Quartz repository at a pinned version:
- **Pinned SHA**: `4923affa7722dfc751f1074348e6dad214fe0c08` (v4.5.2)

After cloning, the contents of this `quartz-site/` directory are overlaid onto the cloned repository.

### Overlay File Map

Currently, the following files are overlaid onto the Quartz clone:
- `quartz.config.ts` -> replaces upstream config.
- `quartz.layout.ts` -> replaces upstream layout config.

*(Note: A later unit will add custom components and a barrel edit, which will also be overlaid.)*

## Content Root Decision

When building the site, the content root is explicitly set to the `knowledge` directory, rather than just `knowledge/wiki`.
- **Build command argument**: `-d knowledge`

This allows us to include `knowledge/index.md` and `knowledge/schema.md` in the built site. To ensure our append-only log remains excluded, `log.md` has been added to `ignorePatterns` in `quartz.config.ts`.

## Privacy: `analytics: null`

In adherence to our strict privacy policies (telemetry must be opt-in and self-hosted), we explicitly set `analytics: null` in `quartz.config.ts`. No third-party or unconsented telemetry (like Plausible) is enabled.

## Upgrade Policy

Bumping the pinned Quartz version is a **deliberate, tested change**. It requires:
1. Re-verifying the build process.
2. Checking that our overlay files remain compatible.
3. Updating the pinned SHA documented here and used in the CI workflow.
