---
type: repo
title: "fro-bot/systematic"
created: 2026-05-07
updated: 2026-06-04
sources:
  - url: https://github.com/fro-bot/systematic
    sha: 73fa108
    accessed: 2026-05-07
  - url: https://github.com/fro-bot/systematic
    sha: 12cae87
    accessed: 2026-05-22
  - url: https://github.com/fro-bot/systematic
    sha: 33cc55a
    accessed: 2026-06-04
tags: [documentation, github-pages, astro, starlight, opencode, plugin, ocx, json-schema]
related:
  - marcusrbrown--systematic
  - marcusrbrown--dotfiles
---

# fro-bot/systematic

Documentation deployment target for [[marcusrbrown--systematic]]. Hosts the Starlight/Astro docs site for the `@fro.bot/systematic` OpenCode plugin at **https://fro.bot/systematic/**.

## Overview

| Attribute       | Value                                                |
| --------------- | ---------------------------------------------------- |
| Created         | 2026-02-09                                           |
| Last push       | 2026-06-04                                           |
| Default branch  | `gh-pages`                                           |
| Language        | HTML (static build output)                           |
| License         | None specified                                       |
| Stars           | 0                                                    |
| Open issues     | 1 (+ 1 open PR)                                      |
| Pages URL       | https://fro.bot/systematic/                          |
| Visibility      | Public                                               |
| Description     | "Documentation site for @marcusrbrown/systematic" (added since the 2026-05-22 survey; the repo previously carried no description) |

## Purpose

This repo is **not a fork** of `marcusrbrown/systematic`. It is a standalone repository whose sole purpose is to receive automated documentation deployments from the source repo. The `gh-pages` branch is the default (and only substantive) branch — there is no application source code here.

Every commit is authored by `fro-bot[bot]` with messages in the format:

```
Deploy docs from marcusrbrown/systematic@<sha>
```

The deploy workflow lives in `marcusrbrown/systematic` (the `docs.yaml` workflow). This repo is simply the push target.

## Contents

The `gh-pages` branch contains the built Starlight/Astro static site:

- `index.html` — Landing page
- `404.html` — Starlight not-found page (added 2026-05-22 survey)
- `favicon.svg` — Site favicon (new since the 2026-05-22 survey)
- `_astro/` — Bundled CSS, JS, and image assets
- `components/` — OCX component pages (one per agent/skill)
- `getting-started/` — Getting started guides
- `guides/` — Philosophy, main loop, agent install, conversion guides
- `privacy/` — Privacy policy page (`privacy/index.html`, new since the 2026-05-22 survey)
- `reference/` — Generated reference pages for skills and agents
- `schemas/` — Hosted JSON Schemas for the user config file (added 2026-05-22 survey)
- `pagefind/` — Client-side search index
- `.well-known/ocx.json` — OCX registry pointer (`{"version":1,"registry":"/systematic/index.json"}`)
- `index.json` — OCX component registry for `ocx` CLI installation
- `og-image.png` — Open Graph share image
- `.nojekyll` — Disables Jekyll processing
- `sitemap-index.xml`, `sitemap-0.xml` — Sitemap for search engines

## OCX Registry

The `.well-known/ocx.json` file points to the OCX component registry at `/systematic/index.json`. This enables the `ocx` CLI to discover and install individual skills and agents from the documentation site URL. The registry uses V2 schema (since `@fro.bot/systematic` v2.6.0).

As of the 2026-06-04 survey, `index.json` advertises:

| Field        | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| `name`       | `Systematic`                                                 |
| `namespace`  | `systematic`                                                 |
| `version`    | `2.24.0` (up from v2.20.6 at the 2026-05-22 survey — see [[marcusrbrown--systematic]] for source-side release history; this now matches the latest source release v2.24.0) |
| `author`     | `Marcus R. Brown <human@fro.bot>`                            |
| `components` | 103 total                                                    |

Component breakdown (unchanged since the 2026-05-22 survey):

| Type      | Count |
| --------- | ----- |
| `agent`   | 51    |
| `skill`   | 47    |
| `bundle`  | 2     |
| `profile` | 2     |
| `plugin`  | 1     |

The `bundle` and `profile` types (V2 registry capabilities) were new in the 2026-05-22 survey. The v2.20.6 → v2.24.0 advance carried no net component-count change — the v2.21+ launch-surface and release-automation work on the source repo was content/tooling churn rather than component additions or removals.

## Hosted JSON Schemas (new in this survey)

The `schemas/` tree appeared on `gh-pages` between the 2026-05-07 survey and now. Two URLs are served:

- `https://fro.bot/systematic/schemas/latest/systematic-config.schema.json`
- `https://fro.bot/systematic/schemas/v2/systematic-config.schema.json`

Both are draft-07 JSON Schemas titled `Systematic user configuration file (systematic.json / systematic.jsonc)`. The `$id` on the v2 file is the v2 URL above, which makes that the canonical pinned reference. Top-level schema fields: `$schema`, `agents`, `categories`, `disabled_skills`, `disabled_agents`, `disabled_commands`, `bootstrap` — matching the `systematic.json` config shape consumed by `marcusrbrown/systematic`'s `config-handler.ts`.

The schema's own `$schema` property is documented as informational only — the loader does not fetch or validate against it. Its purpose is to flip on field-level autocomplete in VSCode, Zed, IntelliJ, and any other editor that resolves `$schema` URLs.

Consequence: this deployment target is no longer purely a docs site. It is now also a stable schema host. Renaming, restructuring, or breaking the URL shape of `schemas/v2/systematic-config.schema.json` would silently break IDE autocomplete in every consumer that pinned the v2 URL. Treat it like a public API.

## Branches

| Branch               | Purpose                              |
| -------------------- | ------------------------------------ |
| `gh-pages` (default) | Built documentation site             |
| `renovate/configure` | Open PR #2 — Renovate onboarding     |

## Open Issues

| #  | Title                                              | Status |
| -- | -------------------------------------------------- | ------ |
| 1  | Enable code scanning (CodeQL / Scorecard) for coverage parity | Open   |
| 2  | feat(deps): configure Renovate                     | Open (PR) |

## Fro Bot Workflow

**No Fro Bot agent workflow detected.** This is expected — the repo contains only static build output. No PR review, autoheal, or maintenance workflows are present. Only GitHub's built-in `pages-build-deployment` and `Dependency Graph` dynamic workflows are active.

A Fro Bot workflow is not recommended for this repo. The source repo ([[marcusrbrown--systematic]]) already has full Fro Bot integration covering the documentation source.

## Renovate

Not yet configured on `gh-pages`. A `renovate/configure` branch exists with a `renovate.json5` extending `github>bfra-me/renovate-config`. The corresponding PR (#2) is open but unmerged. Given that the repo contains only static HTML output (no `package.json`, no dependencies), Renovate has limited applicability here — the PR may be noise from the onboarding bot.

## Collaborators

- `fro-bot` — sole collaborator (push access)

## Relationship to marcusrbrown/systematic

| Aspect          | `marcusrbrown/systematic`           | `fro-bot/systematic`                     |
| --------------- | ----------------------------------- | ---------------------------------------- |
| Purpose         | Source code + plugin + docs source  | Built docs deployment target             |
| Default branch  | `main`                              | `gh-pages`                               |
| Contains code   | Yes (TypeScript, Bun)               | No (static HTML)                         |
| npm package     | `@fro.bot/systematic`               | N/A                                      |
| Fro Bot agent   | Yes (PR review, autoheal, weekly)   | No (not needed)                          |
| Renovate        | Active                              | Not configured                           |
| Commits by      | Various (Marcus, Renovate, Fro Bot) | `fro-bot[bot]` only                      |
| Pages URL       | N/A                                 | https://fro.bot/systematic/              |

The documentation build pipeline flows: `marcusrbrown/systematic` → Astro build → push to `fro-bot/systematic:gh-pages` → GitHub Pages serves at `fro.bot/systematic/`.

## Deploy Cadence

Based on commit history, deployments track releases of `@fro.bot/systematic`. Recent activity is markedly bursty — multiple deploys per day during active development windows on the source repo, suggesting CI fans out per merge rather than per release tag.

Latest deploys observed on 2026-06-04 (source SHAs are the `marcusrbrown/systematic` commit each deploy was built from). Cadence cooled relative to the May burst — deploys now track discrete merge windows rather than firing many times per day:

| Date (UTC)         | gh-pages SHA | Source SHA  |
| ------------------ | ------------ | ----------- |
| 2026-06-04 06:34   | `33cc55a`    | `9914b6c`   |
| 2026-05-30 15:52   | `6e9b231`    | `1594a7e`   |
| 2026-05-30 02:56   | `08eb5f6`    | `7a91b88`   |
| 2026-05-30 01:05   | `96a40f2`    | `a958aeb`   |
| 2026-05-27 05:38   | `a056444`    | `1065d83`   |
| 2026-05-27 05:19   | `335fce6`    | `357107e`   |
| 2026-05-26 23:15   | `fc81e43`    | `0a75480`   |
| 2026-05-24 00:20   | `c4362a2`    | `5568ffc`   |
| 2026-05-24 00:05   | `d6b384e`    | `5dc7101`   |
| 2026-05-23 23:59   | `b4d05ef`    | `d0c6486`   |

Deploys observed on the 2026-05-22 survey:

| Date (UTC)         | gh-pages SHA | Source SHA  |
| ------------------ | ------------ | ----------- |
| 2026-05-21 23:12   | `12cae87`    | `dae829a`   |
| 2026-05-21 22:25   | `bf26128`    | `3810786`   |
| 2026-05-21 18:49   | `f59ab5e`    | `3b1515e`   |
| 2026-05-21 18:40   | `bf76020`    | `1425dd6`   |
| 2026-05-21 18:27   | `cbaced6`    | `e8a981e`   |
| 2026-05-21 04:16   | `ffa2463`    | `9551607`   |
| 2026-05-21 03:50   | `1bd39c8`    | `350a637`   |
| 2026-05-18 18:09   | `b841b51`    | `4c780cb`   |
| 2026-05-18 03:03   | `a3e28f3`    | `402ef5c`   |
| 2026-05-17 20:53   | `9254502`    | `862a098`   |

Earlier deploys remain documented from the prior survey:

| Date       | Source SHA  | Likely version |
| ---------- | ----------- | -------------- |
| 2026-05-05 | `072e755`   | v2.7.3         |
| 2026-05-04 | `088598e`   | v2.7.2         |
| 2026-05-01 | `7d361ce`   | v2.7.1         |
| 2026-04-30 | `2e9453a`   | v2.7.0         |
| 2026-04-28 | `b80f4ce`   | v2.6.1         |
| 2026-04-25 | `581f357`   | v2.6.0         |
| 2026-03-27 | `d0fcffa`   | (pre-survey)   |

## Survey History

| Date       | SHA        | Delta                    |
| ---------- | ---------- | ------------------------ |
| 2026-05-07 | `73fa108`  | Initial survey           |
| 2026-05-22 | `12cae87`  | Registry advanced v2.7.3 → v2.20.6; 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin); `schemas/{latest,v2}/systematic-config.schema.json` now hosted; `404.html` and `og-image.png` added; deploy cadence visibly intensified |
| 2026-06-04 | `33cc55a`  | Registry advanced v2.20.6 → v2.24.0 (now matches latest source release); component counts unchanged (103: 51/47/2/2/1); `favicon.svg` and `privacy/index.html` added; repo description set to "Documentation site for @marcusrbrown/systematic"; schema `$id`/shape and `.well-known/ocx.json` unchanged; deploy cadence cooled from the May burst; no Fro Bot workflow (still expected); issue #1 and PR #2 still open |
