---
type: repo
title: "fro-bot/tokentoilet"
created: 2026-06-04
updated: 2026-06-04
sources:
  - url: https://github.com/fro-bot/tokentoilet
    sha: a141424e89c133a3c8e1a7544f31193afc5af21c
    accessed: 2026-06-04
tags: [next-js, react, web3, defi, wagmi, reown-appkit, tailwindcss, vitest, storybook, vercel, typescript, fork, fro-bot]
aliases: [tokentoilet-fork]
related:
  - marcusrbrown--tokentoilet
  - fro-bot--agent
  - web3-defi
---

# fro-bot/tokentoilet

A **public fork** of [[marcusrbrown--tokentoilet]] living under the `fro-bot` account. It is a [[web3-defi]] application for disposing of unwanted ERC-20/ERC-721 tokens, converting "wallet dust" into charitable contributions. This page tracks the fork specifically; the canonical upstream knowledge lives on [[marcusrbrown--tokentoilet]].

## Overview

| Attribute        | Value                                                  |
| ---------------- | ------------------------------------------------------ |
| Fork of          | [[marcusrbrown--tokentoilet]] (`marcusrbrown/tokentoilet`) |
| Created          | 2026-04-14                                             |
| Last push        | 2026-04-16 (frozen since — no commits in the surveyed window) |
| Default branch   | `main`                                                 |
| Visibility       | Public                                                 |
| License          | None specified (inherits upstream's no-license state)  |
| Homepage         | None set on the fork                                   |
| Topics           | `next-js`, `react`                                     |
| Stars            | 0                                                      |
| Primary language | TypeScript (~1.74 MB; CSS ~27 KB, trace JS)            |
| Latest release   | None                                                   |

## Fork Relationship

This is `marcusrbrown/tokentoilet`'s downstream fork, owned by the `fro-bot` user account (the same identity that authors automated wiki/PR work). It is a **frozen snapshot**, not an actively-diverging hard fork:

- **Created 2026-04-14, last pushed 2026-04-16** — a ~two-day window, then static. It predates the upstream MVP disposal-flow merge (PR #911, surveyed upstream 2026-04-24) and all subsequent upstream evolution.
- **The fork is roughly a month-plus behind upstream** on every tracked axis (see comparison table). It captures the pre-MVP codebase state, before the Sepolia `/flush` disposal flow shipped on the parent.
- No fork-specific divergence was observed in the surveyed surfaces (README, manifests, workflows) beyond version lag — the fork reads as a point-in-time copy of upstream `main`, not a feature branch.

## Tech Stack (fork snapshot, 2026-04-16)

| Layer      | Technology              | Fork version | Upstream now (2026-05-28) |
| ---------- | ----------------------- | ------------ | ------------------------- |
| Framework  | Next.js (App Router)    | 16.1.4       | 16.2.6                    |
| UI library | React                   | 19.2.4       | 19.2.6                    |
| Language   | TypeScript              | 6.0.2        | 6.0.3                     |
| Web3       | Wagmi + Reown AppKit    | wagmi ^2.14.11 / appkit ^1.7.18 | wagmi ^3.0.0 (v2→v3 crossed upstream) |
| Styling    | Tailwind CSS v4         | 4.2.2        | 4.3.0                     |
| Testing    | Vitest                  | ^4.0.7       | 4.1.7                     |
| Components | Storybook               | ^10.0.0 (mixed 9.0.0-alpha.* addons) | 10.4.1 (same alpha drift) |
| State      | TanStack React Query    | ^5.66.0      | ^5.66.0                   |
| Validation | Zod                     | ^4.1.8       | ^4.1.8                    |
| Lint       | ESLint                  | 10.1.0       | 10.4.0                    |
| Package mgr| pnpm                    | 10.33.0      | 11.3.0 (v10→v11 crossed upstream) |

The fork still sits on **wagmi v2** and **pnpm v10** — the two majors upstream has since crossed. Storybook alpha-addon drift (`@storybook/*` pinned at `9.0.0-alpha.*` alongside a `^10.0.0` core) is present in both, a footgun inherited from upstream rather than introduced here.

### Documentation Drift

The fork's `readme.md` badges advertise **Next.js 14 / TypeScript 5.7 / Tailwind 3.4** — stale relative to the actual `package.json` (Next 16, TS 6, Tailwind 4). `mvp.md` likewise references "Next.js 14 setup complete." This is upstream-inherited stale copy, not fork-specific rot, but worth flagging: the badges misrepresent the real stack by two major Next versions.

## Repository Structure

Root listing (2026-04-16 snapshot) mirrors upstream: `app/`, `components/`, `hooks/`, `lib/`, `config/`, `tests/`, `docs/`, `scripts/`, `RFCs/`, `public/`, `.storybook/`, `.ai/`, plus `AGENTS.md`, `llms.txt`, `mvp.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `vercel.json`, `next.config.ts`, `env.ts`, and the standard tooling configs (`eslint.config.ts`, `vitest.config.ts`, `postcss.config.mjs`, `.markdownlint-cli2.yaml`, `.prettierrc.yaml`).

See [[marcusrbrown--tokentoilet]] for the directory/hook/design-system breakdown — the fork's structure is identical at this snapshot.

## CI/CD Pipeline

Four workflows under `.github/workflows/`, matching the upstream set: `ci.yaml`, `fro-bot.yaml`, `renovate.yaml`, `update-repo-settings.yaml`.

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`) — this fork is one of the few non-`marcusrbrown` repos carrying the agent. Notable: it pins an **older agent version than upstream**.

- **Agent pin:** `fro-bot/agent@v0.37.0` (SHA `7fa14220cfde8dcba130e80acde709e76aed5427`). Upstream [[marcusrbrown--tokentoilet]] is at v0.45.0 and [[fro-bot--agent]]'s own latest is v0.53.1 — the fork is **~16 minor versions behind** the runtime. Pre-dates the workflow-health/silent-outage heuristics, OMO Slim, the S3 input expansion, and the `working-dir`/`branch-pr` output-mode maturation.
- **Triggers:** `issue_comment`, `pull_request_review_comment`, `discussion_comment`, `issues` (opened/edited), `pull_request`, `schedule` (`30 3 * * *` = 03:30 UTC daily), `workflow_dispatch` (required `prompt` input).
- **PR Review prompt:** Structured Web3-security review with mandatory `## Verdict: [PASS | CONDITIONAL | REJECT]` plus Blocking issues / Non-blocking concerns / Web3 security assessment / Missing tests / Risk assessment sections. Review-only — no commits, no branches.
- **Schedule prompt:** Five-category daily autohealing (errored PRs, security, code quality/hygiene, developer experience, quality gates) producing a single "Daily Autohealing Report — YYYY-MM-DD" summary issue. Respects Renovate ownership of routine dependency bumps; restricts security version changes to confirmed advisories.
- **Access gating:** Filters fork PRs, `[bot]`-authored and `fro-bot`-authored issues/PRs, and comment triggers from non-`OWNER`/`MEMBER`/`COLLABORATOR` associations. Concurrency keyed per issue/PR/discussion (else `run_id`), non-canceling.
- **Auth:** `FRO_BOT_PAT` for GitHub; `OPENCODE_AUTH_JSON` + `OMO_PROVIDERS` + `FRO_BOT_MODEL` for the agent runtime. `timeout: 0` (no limit). `OPENCODE_PROMPT_ARTIFACT: 'true'`.
- **Setup:** `./.github/actions/setup` (local composite action), `fetch-depth: 0`, PR-head ref resolution for comment-triggered runs.

Because the fork is frozen at 2026-04-16, the scheduled autoheal sweep — if the workflow is enabled and the fork's secrets are populated — would run against a static, month-stale tree. Whether the fork's `FRO_BOT_PAT`/`OPENCODE_AUTH_JSON` secrets exist is not observable from contents reads; the workflow definition being present does not prove it is live.

## Comparison: fork vs. upstream

| Axis              | fro-bot/tokentoilet (2026-04-16) | marcusrbrown/tokentoilet (2026-05-28) |
| ----------------- | -------------------------------- | ------------------------------------- |
| Fro Bot agent pin | `@v0.37.0`                       | `@v0.45.0`                            |
| wagmi             | v2 (`^2.14.11`)                  | v3 (`^3.0.0`)                         |
| pnpm              | 10.33.0                          | 11.3.0                                |
| Next.js           | 16.1.4                           | 16.2.6                                |
| MVP disposal flow | Not present (pre-PR #911)        | Shipped (Sepolia `/flush`)            |
| README badges     | Next 14 / TS 5.7 (stale)         | (upstream copy, same stale badges)    |
| Last push         | 2026-04-16 (frozen)              | 2026-05-06 (active)                   |

## Notable Observations

- **Frozen fork, not a divergent project.** Two days of activity in mid-April then silence. Treat it as a snapshot of upstream's pre-MVP state, not an independently-evolving codebase. For current Token Toilet knowledge, read [[marcusrbrown--tokentoilet]].
- **Carries its own Fro Bot workflow** at an older agent pin (v0.37.0). If the fork is meant to stay a passive mirror, the live `fro-bot.yaml` (with a daily schedule) is arguably unnecessary chrome — a scheduled daemon pointed at a corpse. If it is meant to be a live testbed for the agent under the `fro-bot` org identity, the agent pin is badly stale and a follow-up bump PR would be justified.
- **No license** — inherits upstream's missing license file; unusual for a public repo.
- The Fro Bot-workflow-presence requirement in the survey contract is **satisfied** — no missing-workflow follow-up draft is needed. The actionable gap instead is the stale agent pin and the question of whether the fork's automation is intentionally live.

## Survey History

| Date       | SHA       | Delta                                                                 |
| ---------- | --------- | -------------------------------------------------------------------- |
| 2026-06-04 | `a141424` | Initial survey. Public fork of [[marcusrbrown--tokentoilet]], frozen at 2026-04-16 (pre-MVP). Fro Bot workflow present but pinned to stale agent v0.37.0. wagmi v2 / pnpm v10 / Next 16.1.4 — ~month behind upstream. README/mvp badges stale (Next 14). |
