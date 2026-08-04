---
type: repo
title: "marcusrbrown/Presentations"
created: 2026-08-05
updated: 2026-08-05
sources:
  - url: https://github.com/marcusrbrown/Presentations
    sha: 34321a4c4a38c99c4bd8b683f267ddba05cd6fe4
    accessed: 2026-08-05
tags: [presentations, slides, react, spectacle, slidev, github-pages, blockchain, llm, meetup]
related:
  - marcusrbrown--github
  - marcusrbrown--renovate-config
  - github-pages
  - probot-settings
---

# marcusrbrown/Presentations

Marcus R. Brown's slide-deck archive — "A collection of presentations I've given." A polyglot **monorepo of independent talks**, each in its own top-level directory with its own build toolchain, published to [[github-pages]] at `marcusrbrown.github.io/Presentations/`. Created 2017-02-21; the oldest deck dates to that first commit, the newest was added 2026-08-04.

## Overview

- **Purpose:** Archive of conference/meetup presentation decks, one directory per talk
- **Default branch:** `main`
- **Created:** 2017-02-21
- **Last push:** 2026-08-04
- **Homepage:** `https://marcusrbrown.github.io/Presentations/` (GitHub Pages enabled)
- **Topics:** `blockchain`, `ethereum`, `ethereum-classic`, `meetup`, `presentations`, `react`
- **License:** None declared
- **Language:** JavaScript (11.7 KB) / HTML (4.2 KB) / CSS (0.4 KB) — small footprint; decks vendor their own deps
- **Visibility:** Public
- **Stars:** 1 · **Watchers:** 1 · **Forks:** 0 · **Open issues:** 3

## Repository Structure

Each presentation is a self-contained subtree. There is no root `package.json` — the repo is not a workspace, just a directory collection under shared `.github/` governance.

| Path | Purpose |
| --- | --- |
| `.github/workflows/ci.yaml` | CI: build + test the 2017 blockchain deck |
| `.github/workflows/renovate.yaml` | Renovate runner (reusable from `bfra-me/.github@v4.16.44`) |
| `.github/workflows/update-repo-settings.yaml` | Probot settings sync (reusable from `bfra-me/.github@v4.16.44`) |
| `.github/settings.yml` | Probot settings, extends `.github:common-settings.yaml` |
| `.github/renovate.json5` | Renovate config (extends `marcusrbrown/renovate-config#5.2.10`) |
| `.editorconfig`, `.gitignore` | Editor / VCS hygiene |
| `README.md` | One-line title + CI badge (no index of decks) |
| `Blockchain-Meetup-Feb-2017/` | **Deck 1** — Create React App + Spectacle |
| `Cheap-LLMs-Meetup-Aug-2026/` | **Deck 2** — Slidev, added 2026-08-04 |

## Presentations

### Blockchain-Meetup-Feb-2017 (Deck 1)

The founding artifact. A **Create React App** single-page slide deck built on **Spectacle 10.2.3** (React presentation framework).

- **Stack:** React 18.3.1 + ReactDOM 18.3.1, `react-scripts` 5.0.1, `spectacle` 10.2.3, `gh-pages` 6.3.0 for deploy
- **Package manager:** Yarn (`yarn.lock`, `yarn install --frozen-lockfile` in CI)
- **Scripts:** `start`/`build`/`test`/`eject` (CRA defaults) + `predeploy`/`deploy` (gh-pages to `build/`)
- **Structure:** `src/{App,Demo,Introduction,Overview,renderSlideSet}.js` — slides composed as React components; `public/{index,404}.html`
- **`homepage`:** `https://marcusrbrown.github.io/Presentations` (drives CRA's relative-path build)
- Modernized well past its 2017 origins: React 16-era CRA scaffolds have been bumped to React 18 / react-scripts 5, and the deps carry `renovate:` annotations. This is the only deck the CI pipeline builds and tests.

### Cheap-LLMs-Meetup-Aug-2026 (Deck 2)

Added 2026-08-04 (`chore: add 2026-08-04 presentation (#49)`). Working title on the slide subtree: **"$200 Intelligence on a $10 Budget"** — a talk for the "Cracked Claude Cowork and Codex Club" (Aug 4 & 5, 2026). A nine-year jump in toolchain from Deck 1.

- **Stack:** [Slidev](https://sli.dev) — `@slidev/cli` ^52.1.0 + `@slidev/theme-seriph` ^0.25.0. Markdown-driven slides (`slides.md`), not React components.
- **Package manager:** **Bun** (`bun.lock`, `bun install` / `bun run dev|build|export`) — diverges from Deck 1's Yarn and from the pnpm norm elsewhere in Marcus's ecosystem.
- **Layout:** `Cheap-LLMs-Meetup-Aug-2026/slides/{slides.md, package.json, bun.lock, public/images/*}`. Assets include `aa-intelligence-vs-cost.png` and a `repo-qr.png`.
- **Workflow:** `bun run dev` presents at `localhost:3030` (presenter mode `/presenter`); `bun run build` emits a static SPA in `dist/`; `bun run export` renders PDF via playwright-chromium. Speaker notes are inline HTML comments in `slides.md`.
- **Provenance note:** the deck's README references a sibling `../OUTLINE.md` with research notes, but that file was **deliberately removed from source control** (`chore: update slides, outline, and add QR png (#50)` — "remove OUTLINE.md from source control"). Not surveyed; content unknown by design.

The two decks bracket the archive's evolution: a 2017 React/Spectacle SPA at one end, a 2026 Slidev/Bun Markdown deck at the other. No shared build tooling between them — each talk is frozen in the stack of its era.

## CI/CD Pipeline

### ci.yaml

Single-purpose: it builds and tests **only** `Blockchain-Meetup-Feb-2017` (hard-coded `working-directory`). The Slidev deck has no CI coverage.

- **Triggers:** `pull_request`, `push` to `main`, `workflow_dispatch`
- **Concurrency:** `${{ github.workflow }}-<head_ref|ref>`, cancel-in-progress
- **Jobs:** `Build` (yarn install --frozen-lockfile → `yarn build`) and `Test` (→ `yarn test`), both on `ubuntu-latest`, Node **20.20.2** (pinned via `NODE_VERSION` env with a `renovate:` annotation)
- **Actions:** `actions/checkout` (SHA-pinned v4.4.0), `actions/setup-node` (SHA-pinned v4.4.0)

> Footgun: the `NODE_VERSION` env is declared under each step's `env:` block but consumed by `with.node-version: ${{ env.NODE_VERSION }}` at the step level — a fragile placement. It resolves today, but a future refactor that moves the `with:` above the `env:` would silently pass an empty node-version.

### renovate.yaml / update-repo-settings.yaml

Both delegate to `bfra-me/.github` reusable workflows pinned at SHA `dd02bc5f` (v4.16.44), authenticated via `APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` GitHub App secrets — the same hybrid-trigger Renovate model documented on [[marcusrbrown--github]] and across [[github-actions-ci]]. `update-repo-settings.yaml` runs on push-to-main, a daily `19 14 * * *` cron, and dispatch.

## Probot Settings (.github/settings.yml)

Extends `.github:common-settings.yaml` (resolves to [[marcusrbrown--github]]'s personal template, not the org template). Repo-specific overrides:

- **Description / homepage / topics** set to match the archive
- **Branch protection on `main`:** required status checks `Build` + `Test` (non-strict), `enforce_admins: true`, `required_linear_history: true`, no required PR reviews
- **`archived: true`** — declared in settings

### Contradiction: archive intent vs. live state

The settings file declares `archived: true`, and there is a commit `chore: archive repository (#48)`. **But the live GitHub API reports `archived: false`** at survey time (2026-08-05), and the repo has active commits *after* #48 (#49 added a new deck, #50–#56 followed). Two readings:

1. The archive flag was set in `settings.yml` but the Probot settings sync has not (or cannot) flip a repo to archived, so the declared state and the live state have diverged.
2. Archiving was reverted in practice — the Aug-2026 talk arrived and the repo went active again — but the `archived: true` line in `settings.yml` was never removed.

Either way, `settings.yml` and reality disagree. If the intent is "keep it live for new talks," drop the `archived: true` line so the settings sync stops asserting a state nobody wants. If the intent is "archive after this talk," expect the next successful settings-sync run to freeze the repo. Recorded here per the additive/contradiction rule; not resolved by this survey.

## Renovate

`.github/renovate.json5` extends `github>marcusrbrown/renovate-config#5.2.10` — on the current v5 line of [[marcusrbrown--renovate-config]] (unlike [[marcusrbrown--github]] itself, which is still a v4.x holdout). One custom rule: **`spectacle` major updates auto-approve** in the dependency dashboard (`dependencyDashboardApproval: false` for major bumps of `spectacle`) — a pragmatic exception since Spectacle only lives in the frozen 2017 deck and a major bump there is low-stakes. Recent history is `mrbro-bot[bot]`-authored dependency maintenance (`fix(deps): update all non-major dependencies (#53)`, lockfile maintenance) plus the Aug-2026 content additions.

## Fro Bot Integration

**No Fro Bot agent workflow detected.** There is no `fro-bot.yaml`; automation is limited to Renovate + Probot settings sync, and every merge is authored by `mrbro-bot[bot]` — Fro Bot is not in the loop. This matches the gap on sibling low-activity personal repos ([[marcusrbrown--github]], [[marcusrbrown--esphome-life]], [[marcusrbrown--ha-config]]).

**Recommendation (open):** if this repo is meant to stay live for future talks, a follow-up draft PR could add the single-file three-mode Fro Bot workflow (the canonical shape from [[marcusrbrown--marcusrbrown-github-io]] / [[marcusrbrown--renovate-config]]). But weigh it against the pending archive decision above — wiring an autonomous agent into a repo that may be archived is wasted chrome. Resolve the archive contradiction first; then decide.

## Notable Patterns

- **One directory = one frozen talk:** decks are not migrated to a shared toolchain; each keeps the stack it shipped with (Spectacle/CRA 2017, Slidev/Bun 2026). The archive is a stratigraphic record of Marcus's tooling over nine years.
- **CI covers only the buildable deck:** `ci.yaml` hard-codes the 2017 subtree; the Markdown-based Slidev deck needs no build gate to be presentable, so it gets none.
- **Governance without an agent:** shared `.github/` (Renovate + settings sync + branch protection) provides hygiene; there is no PR-review automation because the repo takes almost no external PRs.
- **Declared-vs-live drift:** the `archived: true` / live-`false` split is a clean example of Probot settings declaring an intent the platform state doesn't reflect.

## Survey History

| Date | SHA | Changes |
| --- | --- | --- |
| 2026-08-05 | `34321a4` | Initial ingest. Two decks: `Blockchain-Meetup-Feb-2017` (React 18 / Spectacle 10 / CRA, Yarn) and `Cheap-LLMs-Meetup-Aug-2026` (Slidev 52 / Bun, added #49 on 2026-08-04). `.github/`: `ci.yaml` (builds+tests 2017 deck only, Node 20.20.2), `renovate.yaml` + `update-repo-settings.yaml` (reusable `bfra-me/.github` v4.16.44), `settings.yml` (extends `.github:common-settings.yaml`), `renovate.json5` (extends `marcusrbrown/renovate-config#5.2.10`, spectacle-major auto-approve). **Contradiction flagged:** `settings.yml` `archived: true` + `chore: archive repository (#48)` vs. live API `archived: false` and post-#48 activity. No Fro Bot workflow; `mrbro-bot[bot]` authors merges. 1 star, 3 open issues. |
