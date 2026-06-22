---
type: repo
title: marcusrbrown/cortexkit_anthropic-auth
created: 2026-05-28
updated: 2026-06-19
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
tags: [opencode, pi, anthropic, oauth, claude, bun, typescript, monorepo, biome, fork, relay, cloudflare-worker, mitmproxy, fro-bot]
related: [marcusrbrown--opencode-copilot-delegate, marcusrbrown--systematic, marcusrbrown--dotfiles]
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
- Recommended install pin: `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3`.
- Fro Bot workflow active since the `1.2.5-mb.3` release cycle — see [Fro Bot Status](#fro-bot-status).

**No-delta re-survey (2026-06-19):** HEAD is still `99fdbe9` (`chore(release): bump fork packages to 1.2.5-mb.3`, committed 2026-05-31T04:03Z) — no upstream sync or fork release since the 2026-06-09 survey. Workflow set unchanged (`ci.yml`, `copilot-setup-steps.yml`, `fro-bot.yaml`, `release.yaml`); published versions hold at `1.2.5-mb.3`; Pi package still `private`; repo still public, MIT, fork of `cortexkit/anthropic-auth`, default branch `marcusrbrown/main`, 1 star / 0 forks, 520 KB. The fork is parked at the last release with no drift. Every prior fact below re-verified, nothing contradicted.

**Fork status (2026-05-28, SHA `517d385`):** _(prior survey — preserved for delta tracking)_

- Published versions at `1.2.2-mb.2`. No Fro Bot workflow present at that time.

## Why the Fork Exists

Two practical drivers visible from `CHANGELOG.md` and `README.md`:

1. **Namespace pinning.** Marcus needs to pin a specific OpenCode plugin build from his own scope so OpenCode's plugin loader resolves an immutable artifact (and `rm -rf ~/.cache/opencode` can predictably reset state). Publishing `@marcusrbrown/opencode-anthropic-auth` removes the dependency on whatever CortexKit ships at upstream `latest`.
2. **Closing the core namespace gap.** Release `1.2.2-mb.1` shipped only the OpenCode package and still pulled `@cortexkit/anthropic-auth-core` from upstream. `1.2.2-mb.2` published `@marcusrbrown/anthropic-auth-core` and re-pointed the OpenCode plugin's dependency, making the fork install self-contained without any upstream-scoped runtime dependency.

This pattern — fork → republish under personal scope → re-target internal dependencies — appears elsewhere in the Marcus ecosystem; see the broader ecosystem notes in [[marcusrbrown--dotfiles]] for the OpenCode plugin stack.

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
│   ├── instructions/
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
│   └── plans/
├── captures/       # gitignored mitmproxy / system-prompt captures
├── images/
├── scripts/
│   ├── analyze-cache-usage.mjs
│   ├── analyze-claude-dumps.mjs   # added since 2026-05-28 survey
│   ├── capture-with-mitmproxy.sh
│   ├── dev.ts / dev-clean.ts
│   ├── extract-system-prompt.ts
│   ├── release.sh / release.test.ts
│   ├── verify-artifacts.mjs / verify-artifacts.test.ts
│   ├── version-sync.mjs / version-sync.test.ts
│   └── wait-release.sh
├── AGENTS.md
├── CHANGELOG.md
├── biome.json
├── bun.lock
├── lefthook.yml
├── mise.toml
├── package.json
└── tsconfig.scripts.json
```

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

## Fro Bot Status

**Active.** `fro-bot.yaml` landed between the 2026-05-28 survey and the 2026-06-09 re-survey (last push `2026-05-31T04:03:34Z`). Agent version: `v0.45.0` (SHA `8aac0fc36437a6c871321fa3389033c8262504b7`).

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
- [[marcusrbrown--dotfiles]] — Consumes OpenCode plugins via OpenCode config; pinned at `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` as of the 2026-06-06 dotfiles survey.
- [[github-actions-ci]] — General CI patterns; this repo contributes the tag-commit integrity check pattern and the "no manifest mutation in CI" release rule.

## Open Questions / Gaps

- Is the upstream `cortexkit/anthropic-auth` still actively maintained? The fork's CHANGELOG carried forward upstream entries through `1.2.5` as of 2026-05-31, and the commit history shows a deliberate `chore(sync): merge upstream v1.2.5` on 2026-05-28. The `.agents/skills/anthropic-auth-upstream-release/` skill codifies the sync/release procedure — suggesting an explicit, maintained upstream-tracking practice, though no automated tracking workflow is present.
- The `docs/brainstorms/` and `docs/plans/` directories exist but were not read (per the survey constraint to limit reads to listings, README, manifests, workflows). Future ingest could enumerate plan filenames to map roadmap scope.
- `e2e-tests` package internals (test count, framework) were not read.
