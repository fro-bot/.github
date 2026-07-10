---
type: repo
title: fro-bot/fro-bot.github.io
created: 2026-05-07
updated: 2026-06-26
sources:
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-05-07
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-05-24
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-06-05
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-06-15
  - url: https://github.com/fro-bot/fro-bot.github.io
    sha: 3e44653c4d185b239b44b3af12255d18c86463ab
    accessed: 2026-06-26
tags: [github-pages, custom-domain, fro-bot-org, infrastructure]
related:
  - marcusrbrown--systematic
  - marcusrbrown--infra
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
---

# fro-bot/fro-bot.github.io

Org-level GitHub Pages custom domain holder for the `fro-bot` organization. Serves the `fro.bot` domain.

## Overview

| Field           | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Full name       | `fro-bot/fro-bot.github.io`                             |
| Description     | "Custom domain pages for @fro-bot"                      |
| Visibility      | Public                                                  |
| Created         | 2026-02-09                                              |
| Default branch  | `main`                                                  |
| Language        | None (static content only)                              |
| License         | None                                                    |
| Has Pages       | Yes                                                     |
| Custom domain   | `fro.bot` (CNAME)                                       |
| HTTPS           | Approved certificate for `fro.bot` and `www.fro.bot` (renewed; expires 2026-09-07) |
| HTTPS enforced  | No                                                      |
| Build type      | Legacy (serves from `main` branch `/` path)             |
| Size            | 0 KB (single CNAME file)                                |
| Topics          | None                                                    |
| Archived        | No                                                      |

## Repository Contents

The entire repository consists of a single file:

- **`CNAME`** — contains `fro.bot`, instructing GitHub Pages to serve this org site at the custom domain

There is no README, no `.github` directory, no workflows, no application code, and no configuration files beyond CNAME.

## Commit History

Single commit on `main`:

| SHA       | Message       | Author   | Date       |
| --------- | ------------- | -------- | ---------- |
| `3e44653` | Create CNAME  | Fro Bot  | 2026-02-09 |

## GitHub Pages Configuration

- **Source:** `main` branch, root path (`/`)
- **Build type:** Legacy (no GitHub Actions deployment)
- **Custom domain:** `fro.bot`
- **TLS certificate:** Approved, covers `fro.bot` and `www.fro.bot`. **Renewed:** as of 2026-06-15 the cert expires **2026-09-07** (was 2026-07-09 in the 2026-05-07→2026-06-05 surveys). GitHub auto-renewed ahead of the prior expiry window; no longer time-sensitive.
- **HTTPS enforcement:** Not enabled (should be enabled for security)
- **Custom 404:** Not configured
- **Domain verification:** `protected_domain_state: unverified` (observed 2026-06-15) — the custom domain is not org-verified, leaving the namespace eligible for takeover if the repo's CNAME is ever removed. Verifying `fro.bot` at the org level would harden this.

## Domain Usage

The `fro.bot` domain is the vanity namespace for the Fro Bot organization:

- **`fro.bot/systematic`** — Starlight/Astro documentation site for [[marcusrbrown--systematic]] (`@fro.bot/systematic` npm package)
- **`cliproxy.fro.bot`** — CLIProxyAPI endpoint managed by [[marcusrbrown--infra]] (separate DNS, not served by this repo)

## Collaborators

- `fro-bot` — sole collaborator

## Open Issues

| #  | Title                                                            | Opened     |
| -- | ---------------------------------------------------------------- | ---------- |
| 1  | Enable code scanning (CodeQL / Scorecard) for coverage parity    | 2026-03-09 |

## Branch Protection

No branch protection configured on `main`. This is consistent with the repo's role as a static domain holder, but inconsistent with the ecosystem pattern where repos extend `fro-bot/.github:common-settings.yaml` via Probot Settings.

## Missing Ecosystem Integration

This is the first `fro-bot/*` org repo surveyed. Compared to `marcusrbrown/*` repos, the following standard integrations are absent:

| Integration            | Status        | Notes                                                              |
| ---------------------- | ------------- | ------------------------------------------------------------------ |
| Fro Bot agent workflow | **Missing**   | No `.github/workflows/fro-bot.yaml` — follow-up PR recommended    |
| Fro Bot Autoheal       | **Missing**   | No autoheal workflow                                               |
| Probot Settings        | **Missing**   | No `.github/settings.yml` — branch protection not managed          |
| Renovate               | **Missing**   | No Renovate config (reasonable given zero dependencies)            |
| README                 | **Missing**   | No repository documentation                                        |
| License                | **Missing**   | No license file                                                    |
| HTTPS enforcement      | **Missing**   | TLS cert exists but enforcement not enabled                        |
| CodeQL / Scorecard     | **Missing**   | Issue #1 tracks this gap                                           |
| Copilot Setup Steps    | **Missing**   | No Copilot agent support                                           |

Given this repo has no application code and a single static file, most of these gaps are low-priority. The recommended follow-up actions are:

1. **Enable HTTPS enforcement** via GitHub Pages settings
2. **Add Probot Settings** extending `fro-bot/.github:common-settings.yaml` for branch protection consistency
3. **Add a Fro Bot workflow** — even a minimal one for issue triage and settings oversight
4. **Add a README** with the repo's purpose and its relationship to the `fro.bot` domain

## Cross-References

- [[marcusrbrown--systematic]] — documentation site deployed to `fro.bot/systematic`
- [[marcusrbrown--infra]] — manages `cliproxy.fro.bot` (separate infrastructure, not served by this repo)
- [[marcusrbrown--mrbro-dev]] — sibling custom-domain GitHub Pages site pattern (React+Vite at mrbro.dev)
- [[marcusrbrown--marcusrbrown-github-io]] — sibling custom-domain GitHub Pages site pattern (React+Vite at marcusrbrown.com)
- [[github-pages]] — topic page covering GitHub Pages deployment patterns across the ecosystem

## Survey History

| Date       | SHA       | Delta                          |
| ---------- | --------- | ------------------------------ |
| 2026-05-07 | `3e44653` | Initial survey. Single-file repo, CNAME-only domain holder for `fro.bot`. |
| 2026-05-24 | `3e44653` | No-op re-survey. HEAD unchanged in 105 days (still the original 2026-02-09 `Create CNAME` commit). Pages config, TLS cert (expires 2026-07-09), missing-integrations table, and issue #1 (CodeQL/Scorecard parity) all unchanged. HTTPS still not enforced. No Fro Bot workflow — all four follow-up recommendations carried forward. |
| 2026-06-05 | `3e44653` | No-op re-survey. HEAD still unchanged (116 days since last push on 2026-02-09). Repo structure, Pages config, TLS cert (expires 2026-07-09, **now 34 days out — approaching renewal**), missing-integrations table, and issue #1 all unchanged. HTTPS still not enforced. No Fro Bot workflow. All follow-up recommendations persist. TLS cert expiry is the only new time-sensitive observation. |
| 2026-06-15 | `3e44653` | Re-survey. HEAD unchanged (126 days since last push on 2026-02-09); still the single `Create CNAME` commit. **TLS cert renewed:** expiry moved 2026-07-09 → **2026-09-07** (GitHub auto-renewed before the flagged window — no action needed). Pages config (`legacy` build, source `main:/`, `custom_404: false`, `https_enforced: false`), `protected_domain_state: unverified`, missing-integrations table, and issue #1 (CodeQL/Scorecard parity) all unchanged. HTTPS still not enforced. No Fro Bot workflow — all four follow-up recommendations carried forward. |
| 2026-06-26 | `3e44653` | No-delta re-survey. HEAD still frozen (140 days since last push on 2026-02-09); single `Create CNAME` commit, lone `CNAME` blob (`fro.bot`) is the entire tree. Pages config byte-for-byte identical to 2026-06-15 (`legacy`, source `main:/`, `custom_404: false`, `https_enforced: false`, `protected_domain_state: unverified`, cert `approved` for `fro.bot`/`www.fro.bot` expiring **2026-09-07**). Issue #1 (CodeQL/Scorecard parity) still the only open issue. No Fro Bot workflow, no Probot Settings, no README/license. Recorded repo `description` ("Custom domain pages for @fro-bot") for the first time. All four follow-up recommendations carried forward unchanged. |
