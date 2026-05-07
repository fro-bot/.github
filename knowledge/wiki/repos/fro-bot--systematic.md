---
type: repo
title: "fro-bot/systematic"
created: 2026-05-07
updated: 2026-05-07
sources:
  - url: https://github.com/fro-bot/systematic
    sha: 73fa108
    accessed: 2026-05-07
tags: [documentation, github-pages, astro, starlight, opencode, plugin, ocx]
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
| Last push       | 2026-05-05                                           |
| Default branch  | `gh-pages`                                           |
| Language        | HTML (static build output)                           |
| License         | None specified                                       |
| Stars           | 0                                                    |
| Open issues     | 2                                                    |
| Pages URL       | https://fro.bot/systematic/                          |
| Visibility      | Public                                               |

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
- `_astro/` — Bundled CSS, JS, and image assets
- `components/` — OCX component pages (one per agent/skill)
- `getting-started/` — Getting started guides
- `guides/` — Philosophy, main loop, agent install, conversion guides
- `reference/` — Generated reference pages for skills and agents
- `pagefind/` — Client-side search index
- `.well-known/ocx.json` — OCX registry pointer (`{"version":1,"registry":"/systematic/index.json"}`)
- `index.json` — OCX component registry for `ocx` CLI installation
- `.nojekyll` — Disables Jekyll processing
- `sitemap-index.xml`, `sitemap-0.xml` — Sitemap for search engines

## OCX Registry

The `.well-known/ocx.json` file points to the OCX component registry at `/systematic/index.json`. This enables the `ocx` CLI to discover and install individual skills and agents from the documentation site URL. The registry uses V2 schema (since `@fro.bot/systematic` v2.6.0).

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

Based on commit history, deployments track releases of `@fro.bot/systematic`:

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
