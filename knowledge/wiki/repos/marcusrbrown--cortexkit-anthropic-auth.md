---
type: repo
title: marcusrbrown/cortexkit_anthropic-auth
created: 2026-05-28
updated: 2026-05-28
sources:
  - url: https://github.com/marcusrbrown/cortexkit_anthropic-auth
    sha: 517d38596432429a8fc5f78612edc80a1c3f3dc6
    accessed: 2026-05-28
tags: [opencode, pi, anthropic, oauth, claude, bun, typescript, monorepo, biome, fork, relay, cloudflare-worker, mitmproxy]
related: [marcusrbrown--opencode-copilot-delegate, marcusrbrown--systematic, marcusrbrown--dotfiles]
---

# marcusrbrown/cortexkit_anthropic-auth

Fork of `cortexkit/anthropic-auth` adding Claude Pro/Max OAuth, fallback accounts, quota routing, prompt-cache controls, and a Cloudflare Worker relay path for OpenCode and Pi. Marcus's fork publishes the OpenCode plugin and shared core under his own scope; the Pi package remains private to the fork.

## Overview

This is a Bun workspace monorepo with three packages: a shared core, an OpenCode plugin, and a Pi provider extension. The OpenCode plugin intercepts the final Anthropic request and rewrites it into the shape Anthropic's Claude Pro/Max OAuth path expects; the Pi package registers a CortexKit provider override under Pi's built-in `anthropic` provider ID. Both integrations share OAuth, fallback-account, quota, cache, relay, dump, SSE, and request-signing logic through the core package.

**Fork status (2026-05-28):**

- Default branch is `marcusrbrown/main` (not `main`) — fork-specific so upstream `main` can be tracked cleanly.
- Fork of `cortexkit/anthropic-auth`. Public, MIT-licensed, 1 star, 0 forks, issues enabled, no GitHub wiki, no discussions.
- Two packages published under `@marcusrbrown/*` at `1.2.2-mb.2`:
  - `@marcusrbrown/anthropic-auth-core` (shared)
  - `@marcusrbrown/opencode-anthropic-auth` (OpenCode plugin)
- Pi package `@cortexkit/pi-anthropic-auth` is `private: true` in this fork — explicitly excluded from publish jobs.
- Recommended install pin: `@marcusrbrown/opencode-anthropic-auth@1.2.2-mb.2`.

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
| Disk Usage | 387 KB |
| TypeScript | 6.0.3 |

### Mise Tooling

`mise.toml` is minimal — only Bun 1.3.14 is pinned. No Node version pin at the root; the release workflow installs Node 24 explicitly via `actions/setup-node@v6`.

## Packages

| Package | Scope | Version | Purpose |
|---------|-------|---------|---------|
| `@marcusrbrown/anthropic-auth-core` | published, fork | `1.2.2-mb.2` | Shared OAuth, account, quota, cache, relay, dump, SSE, request-signing logic. Single runtime dep: `xxhash-wasm` (for body-derived `cch` signing). |
| `@marcusrbrown/opencode-anthropic-auth` | published, fork | `1.2.2-mb.2` | OpenCode plugin + CLI (`opencode-anthropic-auth` bin). Peer dep on `@opencode-ai/plugin`. Built with `bun build --target node --format esm --splitting --external @opencode-ai/plugin --minify` plus `tsc --emitDeclarationOnly`. Engines: `bun: 1.3.14`. |
| `@cortexkit/pi-anthropic-auth` | private in fork | `1.2.2` (unpublished here) | Pi extension declared via `pi.extensions` package-manifest field; registers a CortexKit Anthropic provider under Pi's `anthropic` provider ID. Depends on the fork's `@marcusrbrown/anthropic-auth-core`. Peer deps on three `@earendil-works/pi-*` packages (`pi-ai`, `pi-coding-agent`, `pi-tui`). |
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
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── instructions/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── copilot-setup-steps.yml
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

**No Fro Bot workflow detected.** The only workflows are `ci.yml`, `copilot-setup-steps.yml`, and `release.yaml`. No `fro-bot.yaml`, no maintenance/autoheal job, no scheduled wiki update.

Follow-up: a separate draft PR can propose a Fro Bot workflow tuned to this repo's profile (release-sensitive, OAuth/PII-sensitive captures, dual-package publish). The release contract above means the workflow must avoid touching version-sync, the OIDC publish path, or any release-tagging — its initial scope should be code review and triage, not autoheal.

## Operational Notes

- **Captures are gitignored.** `AGENTS.md` and `copilot-instructions.md` are unambiguous: `captures/` holds mitmproxy HTTPS interception artifacts of Claude Code / OpenCode system prompts. These contain sensitive data and PII. Treat any PR touching `captures/` as suspicious.
- **No file-content assertions in workflow/config tests.** `copilot-instructions.md` codifies this: verify syntax and behavior, not exact strings. Useful guardrail to import elsewhere.
- **Sidecar override env vars.** `OPENCODE_ANTHROPIC_AUTH_FILE` (OpenCode), `PI_ANTHROPIC_AUTH_FILE` and `PI_AGENT_DIR` (Pi). Both default to user config dirs, never `/etc` or anything system-wide.
- **OAuth refresh path.** As of `1.2.1`, tokens refresh through `https://api.anthropic.com/v1/oauth/token` (live-smoke-tested CLIProxyAPI path) after `platform.claude.com` repeatedly returned OAuth `429` during proactive refresh. Useful prior art for anyone else implementing Anthropic OAuth refresh.
- **OpenCode plugin singleton + lock semantics.** `1.2.2` adds jitter to background refresh timers and hardens cross-process refresh locks so a process can't steal a lock while another is still initializing it — preventing duplicate refreshes that burn a rotated refresh token and leave the loser with `invalid_grant`. This is exactly the kind of subtle multi-process pitfall worth carrying into [[opencode-plugins]].

## Cross-Cutting References

- [[opencode-plugins]] — Plugin architecture, Bun build target, peer-dep handling, plugin singleton patterns. This repo is an additional data point for the singleton + cross-process lock category.
- [[marcusrbrown--opencode-copilot-delegate]] — Another OpenCode plugin in Marcus's stack; same Biome 2.4.15 + Bun 1.3.14 toolchain, comparable peer-dep and build-target discipline.
- [[marcusrbrown--systematic]] — Sibling OpenCode plugin (skills/agents framework).
- [[marcusrbrown--dotfiles]] — Consumes OpenCode plugins via OpenCode config; relevant pinning target for `@marcusrbrown/opencode-anthropic-auth@1.2.2-mb.2`.
- [[github-actions-ci]] — General CI patterns; this repo contributes the tag-commit integrity check pattern and the "no manifest mutation in CI" release rule.

## Open Questions / Gaps

- Is the upstream `cortexkit/anthropic-auth` still actively maintained? The fork's release notes carry forward upstream changelog entries through `1.2.2`, suggesting recent sync, but no explicit upstream-tracking workflow was observed.
- The `docs/brainstorms/` and `docs/plans/` directories exist but were not read (per the survey constraint to limit reads to listings, README, manifests, workflows). Future ingest could enumerate plan filenames to map roadmap scope.
- `e2e-tests` package internals (test count, framework) were not read.
