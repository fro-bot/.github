---
type: repo
title: marcusrbrown/cortexkit_anthropic-auth
created: 2026-05-28
updated: 2026-09-02
node_id: R_kgDOSmhCGA
sources:
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 517d38596432429a8fc5f78612edc80a1c3f3dc6
    accessed: 2026-05-28
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-06-09
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-06-19
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-06-30
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-07-14
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-08-05
  - url: https://github.com/cortexkit/anthropic-auth
    sha: v1.18.0
    accessed: 2026-08-05
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 99fdbe906c5875893d363c904f6e6bc066d997b1
    accessed: 2026-09-02
  - url: https://github.com/cortexkit/anthropic-auth
    sha: v1.21.0
    accessed: 2026-09-02
tags:
  - opencode
  - pi
  - anthropic
  - oauth
  - claude
  - bun
  - typescript
  - monorepo
  - biome
  - fork
  - relay
  - cloudflare-worker
  - mitmproxy
  - fro-bot
  - dependabot
  - npm-dist-tag
  - disabled-workflow
  - abandoned-fork
related:
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--systematic
  - marcusrbrown--dotfiles
  - bfra-me--ha-addon-repository
  - opencode-plugins
  - github-actions-ci
---

# marcusrbrown/cortexkit_anthropic-auth

Fork of `cortexkit/anthropic-auth` adding Claude Pro/Max OAuth, fallback accounts, quota routing, prompt-cache controls, and a Cloudflare Worker relay path for OpenCode and Pi. Marcus's fork publishes the OpenCode plugin and shared core under his own scope; the Pi package remains private to the fork.

## Overview

This is a Bun workspace monorepo with three packages: a shared core, an OpenCode plugin, and a Pi provider extension. The OpenCode plugin intercepts the final Anthropic request and rewrites it into the shape Anthropic's Claude Pro/Max OAuth path expects; the Pi package registers a CortexKit provider override under Pi's built-in `anthropic` provider ID. Both integrations share OAuth, fallback-account, quota, cache, relay, dump, SSE, and request-signing logic through the core package.

**Fork status (2026-06-09, SHA `99fdbe9`):**

- Default branch is `marcusrbrown/main` (not `main`) — fork-specific so upstream `main` can be tracked cleanly.
- Fork of `cortexkit/anthropic-auth`. Public, MIT-licensed, 1 star, 0 forks, issues enabled, no GitHub wiki, no discussions.
- Two packages published under `@marcusrbrown/*` at `1.2.5-mb.3`:
  - `@marcusrbrown/anthropic-auth-core` (shared)
  - `@marcusrbrown/opencode-anthropic-auth` (OpenCode plugin)
- Pi package `@cortexkit/pi-anthropic-auth` is `private: true` in this fork at upstream version `1.2.5` — explicitly excluded from publish jobs.
- Recommended install pin: `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3`. _(Corrected 2026-09-02: this is the npm `latest` version, **not** what the README recommends. `README.md` line 66 still says `@1.2.2-mb.2`. See [Two Stale Pointers](#two-stale-pointers-the-mb-dist-tag-and-the-readme-pin).)_
- Fro Bot workflow active since the `1.2.5-mb.3` release cycle — see [Fro Bot Status](#fro-bot-status). _(Superseded 2026-09-02: the workflow is now `disabled_inactivity`.)_

**Sixth re-survey (2026-09-02, SHA `99fdbe9`) — the tree is still frozen, but the automation died twice while nobody was reading.** HEAD unchanged at `99fdbe9` (`chore(release): bump fork packages to 1.2.5-mb.3`, 2026-05-31T04:03Z); `pushed_at 2026-05-31T04:03:34Z` / `updated_at 2026-05-31T04:03:23Z` still frozen — now **93 days**. Tree is byte-identical by definition (same SHA): 104 blobs / 28 trees, 4 workflow files, all pins as previously recorded (Biome `2.4.15`, TypeScript `6.0.3`, Lefthook `2.1.6`, `@opencode-ai/plugin` `1.15.5`, Bun `1.3.14`, agent pin **`v0.45.0`** / `8aac0fc`). Public, MIT, fork of `cortexkit/anthropic-auth`, default branch `marcusrbrown/main`, 1 star / 0 forks / 1 watcher, 520 KB, `open_issues_count` 1 (issue #11, no PRs). Repo id `1248346648`, `node_id R_kgDOSmhCGA`, `archived: false` — still no deprecation signal.

The five prior surveys read the frozen tree as "parked but healthy: the daemon runs, finds nothing, and reports." That reading is now **falsified in two independent ways**, both of which were already true at the 2026-08-05 survey and were not visible from repository content alone:

1. **The Fro Bot workflow is `disabled_inactivity`** — GitHub's 60-day auto-disable for scheduled workflows, and the arithmetic is exact. See [The 60-Day Watchdog Shutoff](#the-60-day-watchdog-shutoff-2026-07-30).
2. **The daemon stopped producing output six weeks before it was switched off**, while every run kept concluding `success`. See [Green Runs, Empty Channel](#green-runs-empty-channel).

Two further findings this cycle: the divergence from upstream is now **numerically pinned** (334 commits behind / 30 ahead, 32 upstream releases missed — see [Divergence, Quantified](#divergence-quantified-2026-09-02)), and a **dangling `mb` dist-tag** the release contract explicitly forbids is still live on npm ([Two Stale Pointers](#two-stale-pointers-the-mb-dist-tag-and-the-readme-pin)). Nothing in the sections below is contradicted on repository content; the contradictions are all in the prior pages' claims about the automation's liveness, and are annotated in place.

**No-delta re-survey (2026-08-05, SHA `99fdbe9`):** Fifth consecutive parked re-survey. HEAD unchanged at `99fdbe9` (`chore(release): bump fork packages to 1.2.5-mb.3`, committed 2026-05-31T04:03Z); `pushed_at` `2026-05-31T04:03:34Z` / `updated_at` `2026-05-31T04:03:23Z` both still frozen — now **~66 days with zero drift**. Re-verified live against the tree at `99fdbe9`: 4 workflows unchanged (`ci.yml`, `copilot-setup-steps.yml`, `fro-bot.yaml`, `release.yaml`); root manifest `@cortexkit/anthropic-auth` (`private: true`, `workspaces: packages/*`); published packages hold `1.2.5-mb.3` (`@marcusrbrown/anthropic-auth-core`, `@marcusrbrown/opencode-anthropic-auth`); Pi `@cortexkit/pi-anthropic-auth` still `private: true` at `1.2.5`; Biome `2.4.15`, TypeScript `6.0.3`, Lefthook `2.1.6`, `@opencode-ai/plugin` `1.15.5`, Bun `1.3.14` (`mise.toml`), opencode engine pin `bun: 1.3.14`; Fro Bot agent pin still **`v0.45.0`** (SHA `8aac0fc`). Repo still public, MIT, fork of `cortexkit/anthropic-auth`, default branch `marcusrbrown/main`, 1 star / 0 forks, 520 KB. Sole open item is still issue #11 "Daily Autohealing Report" (by `marcusrbrown`). The `v0.45.0` pin has no forcing function on a frozen tree and now trails fleet leaders sitting at v0.95–v0.96 by a wide margin. Nothing below contradicted. **The one durable delta this cycle is upstream-side, not fork-side** — see the hardened divergence signal directly below.

> **Contradiction noted 2026-09-02.** This block's implicit premise — that scheduled passes were still running — was false when written. The `Fro Bot` workflow had been `disabled_inactivity` since **2026-07-30**, six days before this survey, and had produced no issue write since 2026-06-29. Repository content was re-verified correctly; the error was inferring daemon liveness from a green-looking history without querying `actions/workflows`. Both prior readings are preserved above; the corrected account is in [Fro Bot Status](#fro-bot-status).

**Fork-relevance divergence signal — now upstream-confirmed (2026-08-05):** The 2026-07-14 divergence inference is now backed by a direct upstream reading. Live check of the parent `cortexkit/anthropic-auth`: **actively maintained** — latest release **`v1.18.0`** (published 2026-07-24), `pushed_at 2026-07-29T14:34Z`, 29 stars, 11 forks, 13 open issues. Upstream has advanced ~sixteen minor releases (1.2.x → 1.18.0) while this fork sat frozen at `1.2.5-mb.3` for ~66 days. Combined with the [[marcusrbrown--dotfiles]] consumer switch to upstream `@cortexkit/opencode-anthropic-auth@1.13.0` (2026-07-10) — itself since advanced to `1.18.0` per the 2026-07-27 dotfiles survey — the evidence now reads as: the active consumer surface is tracking **upstream directly**, and the fork's original drivers (namespace pinning, closing the core-scope gap — see [Why the Fork Exists](#why-the-fork-exists)) appear superseded. This is still a signal, not a confirmed decommission: no archive flag, no README deprecation notice, and the `.agents/skills/anthropic-auth-upstream-release/` skill still ships, so the fork could resync and resume at any time. The forcing question in [Open Questions](#open-questions--gaps) stands — recommend a direct operator confirmation before treating the fork as retired.

**No-delta re-survey (2026-07-14, SHA `99fdbe9`):** Fourth consecutive parked re-survey. HEAD unchanged at `99fdbe9` (`chore(release): bump fork packages to 1.2.5-mb.3`, committed 2026-05-31T04:03Z); `pushed_at`/`updated_at` both frozen at 2026-05-31T04:03Z — now **~50 days with zero drift**. Every fact re-verified live against the tree at `99fdbe9`: 104 blobs, layout identical; 4 workflows unchanged (`ci.yml`, `copilot-setup-steps.yml`, `fro-bot.yaml`, `release.yaml`); root manifest `@cortexkit/anthropic-auth` (`private: true`); published packages hold `1.2.5-mb.3` (`@marcusrbrown/anthropic-auth-core`, `@marcusrbrown/opencode-anthropic-auth`); Pi `@cortexkit/pi-anthropic-auth` still `private: true` at `1.2.5`; Biome `2.4.15`, TypeScript `6.0.3`, Bun `1.3.14` (`mise.toml`), opencode engine pin `bun: 1.3.14`; Fro Bot agent pin still **`v0.45.0`** (SHA `8aac0fc`). Repo still public, MIT, fork of `cortexkit/anthropic-auth`, default branch `marcusrbrown/main`, 1 star / 0 forks, 520 KB. Sole open item is still issue #11 "Daily Autohealing Report" (by `marcusrbrown`). The `v0.45.0` pin is now a **~9-month-equivalent laggard** against fleet leaders sitting at v0.84–v0.85 — but with no PR or maintenance churn to carry a bump, and the workflow's schedule (Monday 09:00 maintenance / daily 03:30 autoheal) finding nothing to fix on a frozen tree, the pin has no forcing function. Nothing below contradicted.

> **Partial correction noted 2026-09-02.** The cron schedule is accurate (`0 9 * * 1` maintenance, `30 3 * * *` autoheal, confirmed at `fro-bot.yaml` L19–L20). "Finding nothing to fix" is not: by 2026-07-14 the autoheal mode had already gone **28 consecutive green runs without writing a single comment**. The runs were not reporting an empty finding — they were reporting nothing at all.

**Fork-relevance divergence signal (2026-07-14, cross-repo):** The active consumer surface has drifted away from this fork. As of the 2026-07-10 [[marcusrbrown--dotfiles]] survey, Marcus's OpenCode auth plugin is `@cortexkit/opencode-anthropic-auth@1.13.0` — the **upstream** CortexKit scope at v1.13.0, not this fork's `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3`. Upstream has advanced roughly eleven minor releases (1.2.x → 1.13.0) while the fork sat frozen at `1.2.5-mb.3`. Read together, the two data points suggest the fork's original drivers (namespace pinning, closing the core-scope gap — see [Why the Fork Exists](#why-the-fork-exists)) have been superseded: upstream is being consumed directly again. This is a signal, not a confirmed decommission — no archive flag, no README deprecation notice, and the `.agents/skills/anthropic-auth-upstream-release/` skill still ships. Worth a direct question to the operator on the next active window (see [Open Questions](#open-questions--gaps)).

**No-delta re-survey (2026-06-30):** HEAD is still `99fdbe9` (committed 2026-05-31T04:03Z); `pushedAt`/`updatedAt` both hold at 2026-05-31T04:03Z. Third consecutive parked re-survey, now 30 days with zero drift. Re-verified live: 4 workflows unchanged (`ci.yml`, `copilot-setup-steps.yml`, `fro-bot.yaml`, `release.yaml`); root manifest still `@cortexkit/anthropic-auth` (`private: true`, `workspaces: packages/*`); published packages hold at `1.2.5-mb.3` (`@marcusrbrown/anthropic-auth-core`, `@marcusrbrown/opencode-anthropic-auth`); Pi package `@cortexkit/pi-anthropic-auth` still `private: true` at upstream `1.2.5`; Biome `2.4.15`, `@opencode-ai/plugin` `1.15.5`, Pi peers `@earendil-works/pi-{ai,coding-agent,tui}` `0.75.3`; Fro Bot agent pin still **`v0.45.0`** (SHA `8aac0fc`). Repo still public, MIT, fork of `cortexkit/anthropic-auth`, default branch `marcusrbrown/main`, 1 star / 0 forks, 520 KB. The fork remains parked at the last release. The `v0.45.0` agent pin is now a notable ecosystem laggard — fleet leaders sit at v0.77.0+ — but the workflow has had no PR or maintenance churn to carry a bump. Nothing below contradicted.

**No-delta re-survey (2026-06-19):** HEAD is still `99fdbe9` (`chore(release): bump fork packages to 1.2.5-mb.3`, committed 2026-05-31T04:03Z) — no upstream sync or fork release since the 2026-06-09 survey. Workflow set unchanged (`ci.yml`, `copilot-setup-steps.yml`, `fro-bot.yaml`, `release.yaml`); published versions hold at `1.2.5-mb.3`; Pi package still `private`; repo still public, MIT, fork of `cortexkit/anthropic-auth`, default branch `marcusrbrown/main`, 1 star / 0 forks, 520 KB. The fork is parked at the last release with no drift. Every prior fact below re-verified, nothing contradicted.

**Fork status (2026-05-28, SHA `517d385`):** _(prior survey — preserved for delta tracking)_

- Published versions at `1.2.2-mb.2`. No Fro Bot workflow present at that time.

## Why the Fork Exists

Two practical drivers visible from `CHANGELOG.md` and `README.md`:

1. **Namespace pinning.** Marcus needs to pin a specific OpenCode plugin build from his own scope so OpenCode's plugin loader resolves an immutable artifact (and `rm -rf ~/.cache/opencode` can predictably reset state). Publishing `@marcusrbrown/opencode-anthropic-auth` removes the dependency on whatever CortexKit ships at upstream `latest`.
2. **Closing the core namespace gap.** Release `1.2.2-mb.1` shipped only the OpenCode package and still pulled `@cortexkit/anthropic-auth-core` from upstream. `1.2.2-mb.2` published `@marcusrbrown/anthropic-auth-core` and re-pointed the OpenCode plugin's dependency, making the fork install self-contained without any upstream-scoped runtime dependency.

This pattern — fork → republish under personal scope → re-target internal dependencies — appears elsewhere in the Marcus ecosystem; see the broader ecosystem notes in [[marcusrbrown--dotfiles]] for the OpenCode plugin stack.

## Divergence, Quantified (2026-09-02)

Prior surveys described the divergence qualitatively ("~sixteen minor releases"). It is now measured directly off the compare API.

| Comparison | Result |
| --- | --- |
| `marcusrbrown/main` (HEAD `99fdbe9`) vs `cortexkit:main` | `diverged` — **334 commits behind**, **30 commits ahead** |
| Fork's own `main` mirror vs `cortexkit:main` | **334 behind, 0 ahead** |
| Fork's `main` mirror vs `marcusrbrown/main` | 0 ahead, 30 behind |
| Upstream releases published since the fork's sync point (`chore(sync): merge upstream v1.2.5`, 2026-05-28T17:04Z) | **32** (`v1.3.0` 2026-05-29 → `v1.21.0` 2026-08-28) |
| npm: fork `latest` vs upstream `latest` | `1.2.5-mb.3` vs `1.21.0` (43 published versions upstream, 5–6 in the fork) |

The 30 fork-local commits are the entire fork delta — release bumps, the publish-pipeline fixes (#2–#6), the Copilot and Fro Bot wiring (#7, #12, #13), the two dump fixes (#17, #18), and the one upstream merge (#15).

**The upstream-tracking branch was abandoned at the first sync.** The fork carries a `main` branch whose stated purpose (per the 2026-06-09 fork-status note) is tracking upstream cleanly so `marcusrbrown/main` can stay fork-specific. That branch sits at `0511865` — `release: v1.2.2`, **2026-05-21** — which is older than the fork's own sync point. The v1.2.5 merge went straight onto `marcusrbrown/main` without advancing the mirror. So the mechanism adopted to make future syncs cheap was used zero times and is now 334 commits stale; a resync today would start from `marcusrbrown/main` and gain nothing from `main` existing.

This is the general cost profile of the two-branch fork pattern: it front-loads a structural decision whose benefit only materializes if someone keeps paying a small recurring maintenance cost. One missed payment and the branch is worse than absent, because it looks like a tracking branch and is not one. Neither branch is protected (`protected: false` on both), so nothing enforced the discipline.

Upstream health, re-verified 2026-09-02: `cortexkit/anthropic-auth` `pushed_at 2026-09-02T09:21:24Z` (same day as this survey), **38 stars** (29 at 2026-08-05), **14 forks** (11), 7 open issues (13 — trending down, i.e. being worked), latest release `v1.21.0` (2026-08-28). All three upstream packages — including `@cortexkit/pi-anthropic-auth`, the one this fork keeps private — publish in lockstep at `1.21.0`. Upstream is not merely alive; it is accelerating relative to the fork.

## Technology Stack

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (per `primaryLanguage`); also Shell and JavaScript |
| Runtime/Build | Bun 1.3.14 (pinned via `mise.toml`) |
| Linting/Formatting | Biome 2.4.15 (single tool, like [[marcusrbrown--opencode-copilot-delegate]] — diverges from `@bfra.me/eslint-config` repos) |
| Package Manager | Bun workspaces (`bun.lock`, `workspaces: ["packages/*"]`) |
| Git Hooks | Lefthook 2.1.6 |
| Test Runner | `bun test` for unit and e2e |
| License | MIT |
| Default Branch | `marcusrbrown/main` |
| Disk Usage | 520 KB (387 KB at 2026-05-28) |
| TypeScript | 6.0.3 |

### Mise Tooling

`mise.toml` is minimal — only Bun 1.3.14 is pinned. No Node version pin at the root; the release workflow installs Node 24 explicitly via `actions/setup-node@v6`.

## Packages

| Package | Scope | Version | Purpose |
|---------|-------|---------|---------|
| `@marcusrbrown/anthropic-auth-core` | published, fork | `1.2.5-mb.3` (was `1.2.2-mb.2`) | Shared OAuth, account, quota, cache, relay, dump, SSE, request-signing logic. Single runtime dep: `xxhash-wasm` (for body-derived `cch` signing). |
| `@marcusrbrown/opencode-anthropic-auth` | published, fork | `1.2.5-mb.3` (was `1.2.2-mb.2`) | OpenCode plugin + CLI (`opencode-anthropic-auth` bin). Peer dep on `@opencode-ai/plugin` (devDep pinned at `1.15.5`). Built with `bun build --target node --format esm --splitting --external @opencode-ai/plugin --minify` plus `tsc --emitDeclarationOnly`. Engines: `bun: 1.3.14`. |
| `@cortexkit/pi-anthropic-auth` | private in fork | `1.2.5` (unpublished here, was `1.2.2`) | Pi extension declared via `pi.extensions` package-manifest field; registers a CortexKit Anthropic provider under Pi's `anthropic` provider ID. Depends on the fork's `@marcusrbrown/anthropic-auth-core`. Peer deps on three `@earendil-works/pi-*` packages (`pi-ai`, `pi-coding-agent`, `pi-tui`). |
| `packages/e2e-tests/` | internal | n/a | OpenCode end-to-end harness invoked via root `test:e2e` script; gated behind a core build. |

### Two Stale Pointers: the `mb` Dist-Tag and the README Pin

Live npm registry state, 2026-09-02:

| Package | `dist-tags` | Versions | `latest` published |
| --- | --- | --- | --- |
| `@marcusrbrown/anthropic-auth-core` | `latest: 1.2.5-mb.3`, **`mb: 1.2.2-mb.2`** | 5 | 2026-05-31T04:04:57Z |
| `@marcusrbrown/opencode-anthropic-auth` | `latest: 1.2.5-mb.3`, **`mb: 1.2.2-mb.2`** | 6 | 2026-05-31T04:05:28Z |
| `@cortexkit/anthropic-auth-core` | `latest: 1.21.0` | 43 | 2026-08-28T15:17:21Z |
| `@cortexkit/opencode-anthropic-auth` | `latest: 1.21.0` | 43 | 2026-08-28T15:17:19Z |
| `@cortexkit/pi-anthropic-auth` | `latest: 1.21.0` | 43 | 2026-08-28T15:19:57Z |

**The `mb` dist-tag lane is decommissioned in CI and still live on the registry.** The repo's release contract is explicit and enforced in three places — `.github/instructions/release.instructions.md` L28 (_"Do **not** reintroduce the `mb` dist-tag lane"_), `.github/copilot-instructions.md`, and the `fro-bot.yaml` prompt env vars. PR #6 (`fix(release): publish to latest only`, 2026-05-26) removed the lane from the workflow. Nobody ran `npm dist-tag rm`. The tag survives, pointing at `1.2.2-mb.2` — three fork releases behind the fork's own `latest`, and the only version that lane ever published.

`npm install @marcusrbrown/opencode-anthropic-auth@mb` resolves today, succeeds, and installs a superseded build. It will resolve to that build forever, because the pipeline that would have advanced it no longer exists. No CI assertion catches this: `verify-artifacts.mjs` validates what the release publishes, and the release does not publish to `mb`.

**The README points at the same stale version, by a different route.** `README.md` L5/L15/L66 all state the fork publishes "both at `1.2.2-mb.2`" and instruct `Pin @marcusrbrown/opencode-anthropic-auth@1.2.2-mb.2` in OpenCode config. That was true at the first fork release and was never updated across `1.2.5-mb.1`, `-mb.2`, and `-mb.3` — three tagged releases, three GitHub releases, two npm publishes. (L80 has the same shape for Pi: `pi install npm:@cortexkit/pi-anthropic-auth@1.0.0` against an upstream now at `1.21.0`.) This corrects the "Recommended install pin: `1.2.5-mb.3`" line recorded on this page since 2026-06-09 — `1.2.5-mb.3` is what npm serves as `latest`, not what the repo documents.

So the fork has **two independent stale pointers that converge on the same abandoned version**, one in registry metadata and one in documentation, while the release pipeline moved on without either. Generalized into [[opencode-plugins]]: **decommissioning a release lane takes three deletions — the CI job, the registry pointer, and the docs that reference it.** Only the first was done, and only the first is the one CI can verify. A dangling dist-tag is strictly worse than a deleted one: it is a live install surface with no producer, and it fails silently by succeeding.

The release-lane-watch section of the maintenance prompt is scoped to _"recent release workflow failures … Trusted Publishing, latest dist-tag verification, or fork package dependency checks"_ — it reads run outcomes, not registry state, so it would not have caught either pointer even while running.

## Architecture

### Integration model

Two agents, one shared core:

- **OpenCode plugin.** Hooks into OpenCode's fetch/request transform path. Reuses OpenCode's normal `/connect anthropic` for the primary account; the plugin layers in OAuth headers, request rewrites, fallback routing, quota gates, cache controls, relay handoff, and dumps. Sidecar config lives at `~/.config/opencode/anthropic-auth.json` (overridable via `OPENCODE_ANTHROPIC_AUTH_FILE`).
- **Pi provider extension.** Calls `registerProvider("anthropic")` to override Pi's built-in Anthropic provider with a CortexKit one that takes the same Claude-compatible request path. Primary OAuth credentials live in Pi's normal credential store via `/login anthropic`; CortexKit-specific state lives at `~/.pi/agent/anthropic-auth.json` (overridable via `PI_ANTHROPIC_AUTH_FILE`, `PI_AGENT_DIR`).

Both sidecars use the same JSON shape (`version`, `main`, `fallbackOn`, `refresh`, `quota`, `claudeCache`, `cacheKeep`, `dump`, `claudeFast`, `relay`, `accounts`), so a user's mental model is portable across agents.

### What the core actually does

From the README's "What CortexKit adds" matrix:

- **Fallback accounts.** Ordered list of secondary OAuth accounts; routed on auth/quota/rate-limit failures (default `fallbackOn: [401, 403, 429]`).
- **Quota-aware routing.** Skips main or fallback accounts when 5-hour or 7-day Claude quota falls below configured `minimumRemaining` thresholds. `failClosedOnUnknownQuota` makes the safe default explicit.
- **Persistent prompt-cache controls.** `/claude-cache` toggles Anthropic's 1-hour cache in explicit, automatic, or hybrid modes; `/claude-cachekeep HH-HH` pre-warms hybrid anchors before the 1-hour TTL expires.
- **Fast mode toggle.** `/claude-fast on|off` requests Anthropic fast mode for supported Opus models.
- **Quota visibility.** `/claude-quota` surfaces live main + fallback state, reset times, refresh errors.
- **User-owned Cloudflare relay.** Optional Worker relay that reduces repeated client upload bytes for large requests; HTTP transport with `fallbackToDirect: true` as the resilient default.
- **Request hardening.** Final-body billing signing (`cch` derived from body via `xxhash-wasm`), token-refresh persistence safety, replay-safe fallback retries, subagent cache isolation. Background OAuth refresh uses jitter to avoid concurrent OpenCode processes refreshing on identical timestamps (`1.2.2`).
- **Dumps.** `/claude-dump` captures Claude-compatible request/response data for debugging when `dump.enabled: true`.

### Commands (both agents)

`/claude-cache`, `/claude-cachekeep`, `/claude-fast`, `/claude-quota`, `/claude-dump` — identical surface for OpenCode and Pi.

## Repository Layout

```
.
├── .agents/
│   └── skills/
│       └── anthropic-auth-upstream-release/  # bundled Fro Bot skill for upstream sync / fork releases
│           └── SKILL.md
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── instructions/
│   │   └── release.instructions.md   # the locked release contract (see CI/CD)
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── copilot-setup-steps.yml
│   │   ├── fro-bot.yaml           # added between 2026-05-28 and 2026-05-31
│   │   └── release.yaml
│   ├── copilot-instructions.md
│   └── dependabot.yml
├── packages/
│   ├── core/       # @marcusrbrown/anthropic-auth-core
│   ├── opencode/   # @marcusrbrown/opencode-anthropic-auth
│   ├── pi/         # @cortexkit/pi-anthropic-auth (private in fork)
│   └── e2e-tests/
├── docs/
│   ├── brainstorms/
│   │   └── 2026-05-25-fork-core-opencode-publish-requirements.md
│   ├── plans/
│   │   └── 2026-05-25-001-fix-fork-core-opencode-publish-plan.md
│   └── solutions/                 # NOT a repo change — omitted from this diagram until 2026-09-02
│       └── workflow-issues/       # 3 docs: fro-bot orchestrator mistakes, release-process
│                                  # lessons (v1.2.2-mb.3), upstream-sync v1.2.5 conflicts
├── captures/       # gitignored mitmproxy / system-prompt captures
│   └── AGENTS.md   # the directory's guardrail doc IS tracked; the captures are not
├── images/
│   └── renaming.jpg
├── scripts/
│   ├── analyze-cache-usage.mjs
│   ├── analyze-claude-dumps.mjs   # added since 2026-05-28 survey
│   ├── analyze-claude-dumps.test.ts
│   ├── capture-with-mitmproxy.sh
│   ├── dev.ts / dev-clean.ts
│   ├── extract-system-prompt.ts
│   ├── release.sh / release.test.ts
│   ├── verify-artifacts.mjs / verify-artifacts.test.ts
│   ├── version-sync.mjs / version-sync.test.ts
│   └── wait-release.sh
├── .gitignore
├── AGENTS.md
├── CHANGELOG.md
├── LICENSE
├── README.md
├── biome.json
├── bun.lock
├── lefthook.yml
├── mise.toml
├── package.json
└── tsconfig.scripts.json
```

104 blobs / 28 trees at `99fdbe9`, unchanged since 2026-05-31.

**Page-completeness fix (2026-09-02, not a repo change):** `docs/solutions/`, `.github/instructions/release.instructions.md`, `scripts/analyze-claude-dumps.test.ts`, `captures/AGENTS.md`, `images/renaming.jpg`, `LICENSE`, `README.md`, and `.gitignore` were present at every prior survey and missing from this diagram. `docs/solutions/workflow-issues/` is the notable omission — three dated post-mortems written during the fork's active week (all 2026-05-28), mirroring the `docs/solutions/` convention used in `fro-bot/.github` itself. They are the fork's own record of what went wrong in its release and upstream-sync work, and the prior "Open Questions" entry about unread `docs/` directories did not know they existed.

## CI/CD

### `ci.yml` — Pull Request validation

Runs on `pull_request` only. Single `check` job on `ubuntu-latest` with `permissions: contents: read`:

1. Checkout (`actions/checkout@v6` pinned by SHA).
2. `jdx/mise-action@v4` (pinned by SHA) installs Bun.
3. `bun install --frozen-lockfile`.
4. `bun run types` (typecheck across core/opencode/pi + scripts tsconfig).
5. `bun run build` (sequential builds: core → opencode → pi).
6. `bun run test` (build + version-sync + verify-artifacts + release scripts tests + OpenCode package tests).
7. `bun run format:check` (Biome format).
8. `bun run lint` (Biome lint).

Concurrency group cancels in-progress runs per PR. See [[github-actions-ci]] for cross-repo workflow patterns.

**`on: pull_request` only — there is no default-branch verification.** Confirmed 2026-09-02 at `ci.yml` L3–L4. The repo has 14 lifetime `push` runs, all `Copilot Setup Steps` / `Release`, none `CI`. The fork's own maintenance report noticed this and filed it as a metric rather than a defect: _"No `CI` run found on `marcusrbrown/main` in the recent run window; latest available CI run is PR-only and passed on 2026-05-31."_ Combined with `protected: false` on both branches and the now-disabled Fro Bot daemon, **nothing verifies `marcusrbrown/main` at all** — not on push, not on a schedule, not via branch protection. This is tolerable on a frozen tree and becomes a live gap the moment a resync lands, which is exactly when a 334-commit merge most needs a gate.

### `release.yaml` — Tag-driven publish

Triggers on `push` tags matching `v*` and on `workflow_dispatch` with a `version` input. Top-level `permissions: contents: read`; elevated permissions are scoped per-job.

Notable hardening (from the visible job head):

- Tag-commit integrity check: when triggered by tag push, verifies `HEAD` matches `git rev-list -n1 refs/tags/<tag>`. Mismatch is a hard failure.
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` at env scope.
- Concurrency group keyed to the resolved version (not run id), with `cancel-in-progress: false` so concurrent release runs queue instead of cancelling each other.
- `version-sync.mjs … --validate` enforces that package manifests already match the requested version — CI does not mutate manifests during release.

Per `.github/copilot-instructions.md`, the release contract is locked:

- npm Trusted Publishing/OIDC + provenance only — no `NPM_TOKEN` fallback secret.
- No `NPM_DIST_TAG_TOKEN`.
- No `mb` dist-tag lane (the `-mb.N` suffix is encoded in the version, not in a dist-tag).
- `npm publish --tag latest`.
- No `environment: npm-publish` unless both the GitHub environment and npm Trusted Publisher config are confirmed present.

### `copilot-setup-steps.yml`

Returns `Not Found` via the contents API for the resolved ref — either gitignored, missing, or readable only via the workflow runner. Not analyzed.

### Dependabot

`enable-beta-ecosystems: true`. Two ecosystems:

- `bun` (root), weekly, max 10 open PRs.
- `github-actions` (root), weekly, max 5 open PRs.

No Renovate config detected at the root — the repo uses Dependabot, not the [[marcusrbrown--renovate-config]] preset. That's a deliberate divergence from most Marcus repos.

**And Dependabot has never opened a pull request here (2026-09-02).** All 15 PRs in the repo's lifetime are authored by `marcusrbrown` (14) or `Copilot` (1). Zero from `dependabot[bot]`. The config is valid and declares two weekly ecosystems, one of which (`github-actions`) is stable, non-beta, and demonstrably has updates available — `actions/checkout@v6` (v6.1.0 and v7 shipped since), `actions/setup-node@v6`, `jdx/mise-action@v4`. Over 93 frozen days that is ~13 missed weekly cycles on each ecosystem, producing nothing.

The most likely cause is that **Dependabot version updates are disabled by default on forked repositories** and must be explicitly enabled per-fork. The `dependabot.yml` was inherited from upstream at fork time; the enablement was not, because enablement is repository settings, not repository content. Unverifiable from here without settings access, so recorded as a strong hypothesis rather than a fact — but the observable is unambiguous: a syntactically valid config, two declared schedules, and zero output for the repo's entire existence.

This is why the toolchain is uniformly stale in a way no other surveyed repo's is: Biome `2.4.15` (vs `2.5.9` at [[marcusrbrown--opencode-copilot-delegate]]), `@opencode-ai/plugin` `1.15.5` (vs `1.18.19`), Bun `1.3.14` (vs `1.4.0`). The prior surveys attributed the freeze entirely to operator inactivity. It is also a governance vacuum: **this repo has no working dependency bot, no working agent, and no default-branch CI.** Every automated maintenance surface the fleet relies on is either absent or off — and each was individually plausible enough to escape five surveys. Recorded in [[github-actions-ci]] as the fork-inherited-config gap.

## Fro Bot Status

**Disabled since 2026-07-30 (as of the 2026-09-02 survey).** Workflow state is `disabled_inactivity`; last run of any kind was run #141 at `2026-07-30T06:05:02Z`. Not paused, not failing — switched off by GitHub, and it will stay off until a human re-enables it or the repo receives a push. A `workflow_dispatch` will not revive it either; disabled workflows reject all triggers.

_Prior reading, preserved:_ **Active but pinned to a stale agent.** `fro-bot.yaml` landed between the 2026-05-28 survey and the 2026-06-09 re-survey (last push `2026-05-31T04:03:34Z`). Agent version: `v0.45.0` (SHA `8aac0fc36437a6c871321fa3389033c8262504b7`) — re-confirmed unchanged through the 2026-08-05 survey. This is the oldest agent pin in the surveyed fleet by a wide margin (leaders sit at v0.95–v0.96 as of early August). The pin doesn't advance because the tree is frozen: no PRs to review, and the scheduled maintenance/autoheal passes find nothing to fix, so nothing generates the churn that would carry an agent bump. If the fork ever resumes (upstream sync + fork release), expect a large single-step agent jump on the first active PR.

The agent-pin observation stands and is now worse: `v0.45.0` against a fleet leader at **v0.107.0** ([[marcusrbrown--marcusrbrown-com]], 2026-08-31). The "no forcing function" explanation was right about the mechanism and wrong about the state — there is no forcing function *and* no daemon.

### The 60-Day Watchdog Shutoff (2026-07-30)

GitHub disables scheduled workflows in repositories with no activity for 60 days. The arithmetic here is exact, not approximate:

| Fact | Value |
| --- | --- |
| Repo `pushed_at` (last activity) | `2026-05-31T04:03:34Z` |
| `pushed_at` + 60 days | `2026-07-30T04:03:34Z` |
| Last `Fro Bot` run (run #141, `schedule`, `success`) | `2026-07-30T06:05:02Z` |
| Workflow `state` | `disabled_inactivity` |
| Workflow `updated_at` | `2026-07-30T06:05:02Z` — identical to the last run |

The daily `30 3` cron fired ~2 hours past the 60-day mark, completed green, and was the last thing the workflow ever did. Total lifetime: 141 runs (66 `schedule`, 19 `issues`, 15 `issue_comment`; 64 `success`, 34 `skipped`, 1 `failure`, 1 `cancelled`).

The structural point is that **the condition that disables the watchdog is the condition the watchdog exists to detect.** An autoheal daemon's value is highest on a repository nobody is touching — that is precisely where drift accumulates unobserved. GitHub's inactivity policy is calibrated for abandoned repos burning free minutes, and it cannot distinguish "abandoned" from "deliberately quiet and monitored by a bot." A repo pinned at v0.45.0 while upstream ships 32 releases is exactly the situation the autoheal prompt's cross-project-intelligence and release-lane-watch sections were written for, and it is the situation in which those sections are guaranteed not to run.

Generalized into [[github-actions-ci]]. Fleet-relevant scope: any repo whose only Fro Bot trigger is `schedule` and whose tree is stable for 60 days is on the same clock. This is a distinct failure mode from [[bfra-me--ha-addon-repository]], where the daemon failed **loudly** 17 consecutive times and was ignored because the required-check surface never evaluated it. Here there is nothing to ignore: no red run, no failure notification, just an absence. Compare the two:

| | [[bfra-me--ha-addon-repository]] | This repo |
| --- | --- | --- |
| Daemon state | Runs, fails (17×) | Does not run |
| Actions list evidence | 17 red rows | Nothing after 2026-07-30 |
| Trigger of death | Stale `agent@v0.43.1` breaking | GitHub inactivity policy |
| Why unnoticed | Red never reached the gate | No artifact is produced at all |
| Recovery | Merge the pin-bump PR (#557) | Push a commit, or click Enable |

The second column is harder to detect and cheaper to fix. Both are invisible to any survey that reads only repository content — which is how five consecutive surveys of this page missed it.

### Green Runs, Empty Channel

The daemon went quiet **six weeks before** it was disabled, and reported `success` throughout.

| Output channel | Mode | Last write | Green runs after that write |
| --- | --- | --- | --- |
| Issue #11 comments | autoheal (daily `30 3`) | `2026-06-16T05:18:52Z` (19th comment) | **44 consecutive `success`** (2026-06-17 → 2026-07-30) |
| Issue #11 body prepend | maintenance (Monday `0 9`) | `2026-06-29T10:46:28Z` | 2 `success` Mondays (07-20, 07-27); 07-06 `cancelled`, 07-13 `failure` |

35 scheduled runs fired after the last issue write of any kind; 33 concluded `success`. As of 2026-09-02 the perpetual issue has been silent for **64 days** and the daemon dead for 33.

The likely mechanism is visible in the prompt. `fro-bot.yaml` L131:

> `If the issue body approaches 50,000 characters, keep the 30 most recent sections and add an archival note.`

Issue #11's body is **54,813 characters** — past the threshold, with no archival note and no rotation performed. The instruction is a soft, judgement-loaded directive ("approaches", "keep the 30 most recent") handed to a model that must rewrite a 54 KB body correctly to comply. The most parsimonious read: the agent reached a state where it could neither append nor safely truncate, elected not to write, and — because the run's exit status reflects the harness completing, not the report landing — exited `0`.

Three transferable rules, recorded in [[github-actions-ci]]:

- **A run's conclusion measures the harness, not the deliverable.** If the job's purpose is "write a report," success must be asserted against the write, not the process. An `if: failure()` guard cannot catch an outcome the job never classified as a failure.
- **Unbounded append-only artifacts have a cliff, and the rotation logic runs least often at exactly the moment it is needed.** A perpetual issue crosses 50 KB once, silently, and every subsequent run inherits the broken state. Prefer bounded rotation the agent cannot get wrong (write to a dated comment; cap the body at N sections mechanically) over a prose size budget.
- **Monitor output freshness, not run status.** "Last successful run" was green here for six weeks after the last useful output. `issue.updated_at` would have caught it on day two.

Note the coupling with the shutoff above: the reporting failure (2026-06-16/06-29) came **first**, so by the time the 60-day timer expired there was already no artifact anyone was watching. The two failures are independent in cause and mutually concealing in effect.

### Workflow profile

Three-mode single-file workflow:

| Trigger | Mode | Prompt |
|---------|------|--------|
| `pull_request` events (non-bot, non-fork) | review | `PR_REVIEW_PROMPT` |
| `schedule` — Monday 09:00 UTC | maintenance | `MAINTENANCE_PROMPT` |
| `schedule` — daily 03:30 UTC | autoheal | `AUTOHEAL_PROMPT` |
| `workflow_dispatch mode=review` | review | `PR_REVIEW_PROMPT` |
| `workflow_dispatch mode=maintenance` | maintenance | `MAINTENANCE_PROMPT` |
| `workflow_dispatch mode=autoheal` | autoheal | `AUTOHEAL_PROMPT` |
| `workflow_dispatch prompt=<non-empty>` | custom | verbatim custom prompt |
| issues / comments / discussions / PR review events | interaction | `GENERAL_INTERACTION_PROMPT` |

PR review trusted actors (same list as autoheal fixable-PR check): `marcusrbrown`, `app/copilot-swe-agent`, `dependabot[bot]`, `renovate[bot]`, `fro-bot`, `mrbro-bot[bot]`.

### Release constraints in workflow

The workflow bakes release invariants directly into env-var prompt variables. Every mode prompt references them:

- Fork publishes only `@marcusrbrown/anthropic-auth-core` and `@marcusrbrown/opencode-anthropic-auth`.
- Pi stays private/unpublished in this fork.
- npm Trusted Publishing/OIDC/provenance only; `npm publish --tag latest`; no `NPM_DIST_TAG_TOKEN`; no `NPM_TOKEN` fallback.
- No `environment: npm-publish` unless both the GitHub environment and npm Trusted Publisher configs are confirmed present.

### Autoheal categories

The `AUTOHEAL_PROMPT` defines five categories: errored PRs, code quality and repo hygiene, release and package health, developer experience, and cross-project intelligence. Cross-project intelligence is inbound-only (read, never write to other repos): `fro-bot/agent`, `marcusrbrown/opencode-copilot-delegate`, `marcusrbrown/systematic`, `anomalyco/opencode`, `cortexkit/opencode-magic-context`.

### Perpetual issue management

Both maintenance and autoheal modes manage a single perpetual open issue titled "Daily Autohealing Report" — prepend-by-section, never close, archive oldest sections when body exceeds 50 000 characters.

Issue #11 ("Daily Autohealing Report") created under `marcusrbrown`'s account is the active perpetual issue as of 2026-06-09.

**Status 2026-09-02: still open, no longer active.** 19 comments (last `2026-06-16T05:18:52Z`), body last edited `2026-06-29T10:46:28Z`, body length **54,813 characters** — over the 50,000 threshold the prompt sets, with no archival note and no rotation performed. Silent for 64 days. See [Green Runs, Empty Channel](#green-runs-empty-channel) for why this is the more consequential of the two automation failures: the issue *is* the daemon's only output surface, so its staleness was observable from 2026-06-30 onward, six weeks before GitHub disabled the workflow.

The two modes wrote to different channels, which matters for anyone diagnosing this class: **autoheal appended comments** (`## Autoheal Update — YYYY-MM-DD`, ~1,672 bytes each, near-identical "all checks passed / no changes needed" tables), while **maintenance prepended sections into the issue body** (`## Maintenance Update — YYYY-MM-DD`). Only the body has a size ceiling. Autoheal's comments stopped on 2026-06-16 — thirteen days *before* the body's last write — so the 50 KB cliff does not explain the comment silence on its own, and the true cause of the autoheal stoppage is not recoverable from public metadata (run logs for that window are past retention).

### Bundled skill

`.agents/skills/anthropic-auth-upstream-release/SKILL.md` — teaches Fro Bot (and any OpenCode agent with `.agents/` skill discovery) how to: sync from upstream `cortexkit/anthropic-auth`, resolve fork conflicts, cut `vX.Y.Z-mb.N` releases, and validate npm metadata. Scope is explicit: upstream sync + fork release only; not for ordinary feature work.

_Prior gap note (2026-05-28): No Fro Bot workflow was present at that time. The gap is now closed._

## Operational Notes

- **Captures are gitignored.** `AGENTS.md` and `copilot-instructions.md` are unambiguous: `captures/` holds mitmproxy HTTPS interception artifacts of Claude Code / OpenCode system prompts. These contain sensitive data and PII. Treat any PR touching `captures/` as suspicious.
- **No file-content assertions in workflow/config tests.** `copilot-instructions.md` codifies this: verify syntax and behavior, not exact strings. Useful guardrail to import elsewhere.
- **Sidecar override env vars.** `OPENCODE_ANTHROPIC_AUTH_FILE` (OpenCode), `PI_ANTHROPIC_AUTH_FILE` and `PI_AGENT_DIR` (Pi). Both default to user config dirs, never `/etc` or anything system-wide.
- **OAuth refresh path.** As of `1.2.1`, tokens refresh through `https://api.anthropic.com/v1/oauth/token` (live-smoke-tested CLIProxyAPI path) after `platform.claude.com` repeatedly returned OAuth `429` during proactive refresh. Useful prior art for anyone else implementing Anthropic OAuth refresh.
- **OpenCode plugin singleton + lock semantics.** `1.2.2` adds jitter to background refresh timers and hardens cross-process refresh locks so a process can't steal a lock while another is still initializing it — preventing duplicate refreshes that burn a rotated refresh token and leave the loser with `invalid_grant`. This is exactly the kind of subtle multi-process pitfall worth carrying into [[opencode-plugins]].
- **Fallback-account quota snapshot reuse.** `1.2.5` preserves cached fallback-account quota snapshots when transient quota probes are rate limited, and clears stale quota errors during explicit checks — preventing a transient `429` from hiding an otherwise viable fallback account.
- **Fallback OAuth refresh serialization.** `1.2.4` serializes fallback-account OAuth refreshes across OpenCode processes, closing the same rotating-token invalidation window for fallback accounts that `1.2.2` closed for the main account.
- **Dump improvements.** `1.2.5-mb.2` added direct Claude request dumping; `1.2.5-mb.3` added `analyze-claude-dumps.mjs` with volatile `cch` field filtering so dump analysis diffs are stable across requests.
- **OAuth token refresh realignment.** `1.2.3` aligned the Claude OAuth token refresh with the live-tested PR #40 request shape (`platform.claude.com/v1/oauth/token`, JSON payloads, `axios/1.13.6` UA), and added `Retry-After`-aware backoff. Upstream contributor: @iceteaSA.

## Cross-Cutting References

- [[opencode-plugins]] — Plugin architecture, Bun build target, peer-dep handling, plugin singleton patterns. This repo is an additional data point for the singleton + cross-process lock category.
- [[marcusrbrown--opencode-copilot-delegate]] — Another OpenCode plugin in Marcus's stack; same Biome 2.4.15 + Bun 1.3.14 toolchain, comparable peer-dep and build-target discipline.
- [[marcusrbrown--systematic]] — Sibling OpenCode plugin (skills/agents framework).
- [[marcusrbrown--dotfiles]] — Consumes OpenCode plugins via OpenCode config. Pinned at `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (this fork) as of the 2026-06-06 dotfiles survey, **but switched to upstream `@cortexkit/opencode-anthropic-auth@1.13.0` by the 2026-07-10 survey and advanced to `1.18.0` by 2026-07-27** — see the upstream-confirmed fork-relevance divergence signal above. The consumer surface now tracks upstream, which is itself confirmed live at `v1.18.0`.
- [[github-actions-ci]] — General CI patterns; this repo contributes the tag-commit integrity check pattern and the "no manifest mutation in CI" release rule, and (2026-09-02) the **60-day scheduled-workflow inactivity shutoff**, the **green-run/empty-channel** class, and the **fork-inherited dependency-bot config that never runs**.
- [[bfra-me--ha-addon-repository]] — The fleet's other dead Fro Bot daemon, and the instructive contrast: that one fails **loudly** and is ignored because the required-check surface never evaluates scheduled runs; this one produces no artifact at all. Both were invisible to content-only surveys. See the comparison table in [The 60-Day Watchdog Shutoff](#the-60-day-watchdog-shutoff-2026-07-30).

## Open Questions / Gaps

- ~~Is the upstream `cortexkit/anthropic-auth` still actively maintained?~~ **Answered (2026-08-05): yes, and vigorously.** Upstream is at release **`v1.18.0`** (2026-07-24), `pushed_at 2026-07-29`, 29 stars / 11 forks / 13 open issues — ~sixteen minor releases past the fork's frozen `1.2.5-mb.3`. The fork's CHANGELOG carried forward upstream entries through `1.2.5` as of 2026-05-31, and the commit history shows a deliberate `chore(sync): merge upstream v1.2.5` on 2026-05-28; the `.agents/skills/anthropic-auth-upstream-release/` skill still codifies the sync/release procedure. The open question flips from "is upstream alive?" to "will the fork resync, or has it been quietly superseded?" — see the retirement question below.
- ~~The `docs/brainstorms/` and `docs/plans/` directories exist but were not read.~~ **Partially closed (2026-09-02):** filenames enumerated from the tree listing and added to [Repository Layout](#repository-layout). Contents still unread per the survey constraint. Both directories hold exactly one dated doc from 2026-05-25 (fork-core/opencode publish requirements + the corresponding fix plan) — the fork's founding scope, not an ongoing roadmap. A third directory, **`docs/solutions/workflow-issues/`, was missed entirely by five surveys** and holds three 2026-05-28 post-mortems on the fro-bot orchestrator, the release process, and the v1.2.5 upstream-sync conflicts. Those are the highest-value unread files in the repo for wiki purposes and are worth a targeted read on any future ingest that relaxes the read constraint.
- `e2e-tests` package internals (test count, framework) were not read.
- **Why did autoheal stop commenting on 2026-06-16 while continuing to report `success` for 44 more runs?** Not answerable from public metadata — Actions logs for that window are past retention and the runs left no artifact. The 50 KB body-size cliff explains the *maintenance* stoppage plausibly but post-dates the comment stoppage by 13 days. Resolvable only by re-enabling the workflow and observing, or by reading logs with an authenticated token before they expire (already too late for the 2026-06 window).
- **Is Dependabot enabled at the repository level?** Zero PRs in the repo's lifetime against a valid two-ecosystem config strongly suggests the fork-default-disabled behavior, but repository settings are not readable unauthenticated. One `gh api repos/.../vulnerability-alerts` or a settings glance would settle it.
- **Is this fork still the intended consumer target, or is it being retired in favor of upstream?** (raised 2026-07-14; **evidence hardened 2026-08-05**) [[marcusrbrown--dotfiles]] switched to upstream `@cortexkit/opencode-anthropic-auth` (`1.13.0` at 2026-07-10, `1.18.0` by 2026-07-27) while this fork remains frozen at `1.2.5-mb.3` for ~66 days. Upstream is now directly confirmed alive at `v1.18.0`, so the "upstream might be dead, keep the fork warm" hypothesis is dead — the fork's namespace-pinning rationale looks superseded by upstream simply being the live, consumable artifact again. Still no archive/deprecation signal on the repo, and the upstream-release skill still ships, so a resync could revive it. **Recommend a direct operator question on the next active window:** is the fork intentionally parked as a fallback, or should it be archived? Until answered, keep re-surveying at low cost but stop treating the frozen state as anomalous — it is now the steady state.

- **Escalated (2026-09-02): the "parked as a fallback" reading no longer holds up, and the question is now about cost, not intent.** A fallback has to be reachable. This one is 334 commits and 32 releases behind upstream, has no working dependency bot, no default-branch CI, an agent daemon that GitHub switched off, and an unprotected default branch — reviving it means merging a 334-commit upstream delta with no gate on the result. The `.agents/skills/anthropic-auth-upstream-release/SKILL.md` still ships and still describes the procedure, but the procedure assumes an `main` mirror that was never advanced. Meanwhile the fork is not inert: `@marcusrbrown/opencode-anthropic-auth@mb` and the README both actively direct installs to `1.2.2-mb.2`, a build three fork-releases and 19 upstream minors stale. **Archiving is now the cheaper correct action than resyncing**, and it is the only one that stops the stale pointers from serving. Two lower-cost partial steps if the operator wants to keep the option open: `npm dist-tag rm` the `mb` lane on both packages, and fix the README pin. Both are one-line changes; both are currently blocked on nothing.

- **Onboarding note (per survey brief):** a Fro Bot workflow **is** present, so no follow-up draft PR proposing one is warranted. The actionable item here is the inverse — the workflow exists, is correctly written, and is switched off. Re-enabling it (a push, or the Actions UI "Enable workflow" button) restarts the daemon at `agent@v0.45.0`, ~62 minor versions behind the fleet leader, against a harness that may no longer be compatible. Bumping the pin and re-enabling should be done together, and would be a reasonable single follow-up PR if the fork is being kept.
