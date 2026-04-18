---
type: repo
title: "marcusrbrown/infra"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/infra
    sha: 3fae5db4f57cce6a662da29c50ca9bbe37fdda2a
    accessed: 2026-04-18
tags: [bun, deploy, github-actions, infra, keeweb, cliproxy, cli, mcp, typescript]
aliases: [infra]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/infra

Personal infrastructure management monorepo. Bun workspace containing deploy automation for KeeWeb and CLIProxyAPI, an operational CLI published to npm, and an MCP bridge for agent-driven infrastructure operations.

## Overview

- **Purpose:** Deploy automation, operational CLI, and Claude proxy management
- **Default branch:** `main`
- **Created:** 2026-04-03
- **Last push:** 2026-04-18
- **Package manager:** Bun (workspace monorepo)
- **Published package:** `@marcusrbrown/infra` v0.4.3 on npm
- **Topics:** `bun`, `deploy`, `github-actions`, `infra`, `keeweb`

## Repository Structure

Bun workspace monorepo with two apps and one publishable CLI package.

### Workspace Layout

| Package | Name | Purpose |
| --- | --- | --- |
| `apps/keeweb` | `@marcusrbrown/infra-keeweb` | KeeWeb v1.18.7 static site deploy automation (private) |
| `apps/cliproxy` | `@marcusrbrown/infra-cliproxy` | CLIProxyAPI Docker Compose stack deployment (private) |
| `packages/cli` | `@marcusrbrown/infra` | Operational CLI: health checks, deploy triggers, MCP bridge (public, npm) |

### Key Directories

| Directory             | Purpose                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `apps/keeweb/`        | KeeWeb deploy: build script, deploy.sh, nginx config, server provisioning            |
| `apps/cliproxy/`      | CLIProxyAPI deploy: docker-compose, Caddyfile, config template, droplet provisioning |
| `packages/cli/`       | CLI entry point (goke framework), command modules, tests                             |
| `.agents/skills/`     | Agent skill context packets (goke)                                                   |
| `.github/workflows/`  | 9 workflow files (CI, deploy, release, Fro Bot, Renovate, etc.)                      |
| `.opencode/commands/` | OpenCode slash commands (generate-readme)                                            |
| `docs/brainstorms/`   | Requirements and brainstorm documents                                                |
| `docs/plans/`         | Implementation plans                                                                 |
| `docs/solutions/`     | Compound learning docs (solved problems)                                             |
| `.changeset/`         | Changesets versioning config                                                         |

## Apps

### KeeWeb (`apps/keeweb`)

Self-hosted [KeeWeb](https://keeweb.info) v1.18.7 password manager deployed to `kw.igg.ms`. Download-based build: fetches the upstream release archive, verifies SHA-256, injects Dropbox client credential, and produces a deploy-ready `dist/`.

- **Deploy target:** `box.heatvision.co` (Mail-In-A-Box server)
- **Deploy user:** `deploy-kw` (scoped sudo for activation script only)
- **Deploy method:** SSH/rsync via `deploy.sh` (the only bash script in the repo)
- **Content deploy:** default (rsync `dist/` to server)
- **Nginx config deploy:** opt-in via `--nginx` flag
- **Post-deploy health check:** HTTP 200 from `https://kw.igg.ms/`
- **Secret injection:** `DROPBOX_APP_SECRET` env var at build time

### CLIProxyAPI (`apps/cliproxy`)

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) Docker Compose stack fronted by Caddy at `cliproxy.fro.bot`. Authenticates to Claude once via OAuth, then issues per-repo API keys so Fro Bot agents across repositories can use Claude models through a single subscription.

- **Deploy target:** DigitalOcean droplet at `cliproxy.fro.bot`
- **Stack:** Docker Compose with Caddy reverse proxy
- **Provision:** `bun run --cwd apps/cliproxy provision` (one-time droplet + Docker + firewall setup)
- **Deploy:** `bun run --cwd apps/cliproxy deploy` (idempotent, preserves runtime `config.yaml`)
- **Config safety:** deploy skips `config.yaml` upload when file exists on server (runtime API keys live there); `--force-config` is explicit override
- **Upstream:** `eceasy/cli-proxy-api` Docker image (from `router-for-me/CLIProxyAPI`)

## CLI (`@marcusrbrown/infra`)

Published to npm as `@marcusrbrown/infra` (v0.4.3). Built with the `goke` CLI framework and Zod schemas. Exposes subcommands for both apps plus a unified status dashboard and an MCP bridge.

### Command Tree

| Command                 | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `infra status`          | Parallel health checks for all deployments (`--json` for machine output) |
| `infra keeweb status`   | HTTP reachability, last deploy timestamp, SHA-256 content hash           |
| `infra keeweb deploy`   | Trigger deploy via GitHub Actions or `--local` SSH                       |
| `infra keeweb open`     | Open KeeWeb in browser                                                   |
| `infra cliproxy status` | HTTP reachability, version, usage stats                                  |
| `infra cliproxy deploy` | Trigger deploy via GitHub Actions or `--local` SSH                       |
| `infra cliproxy config` | Read/update runtime configuration via management API                     |
| `infra cliproxy keys`   | Manage proxy API keys (list, add, remove)                                |
| `infra cliproxy login`  | OAuth authentication with Claude subscription (SSH + TTY)                |
| `infra cliproxy open`   | Launch CLIProxyAPI terminal dashboard via SSH                            |
| `infra cliproxy setup`  | Interactive onboarding wizard for connecting repos to CLIProxyAPI        |
| `infra mcp`             | Start stdio MCP server exposing all commands as tools                    |

### Key Dependencies

| Dependency       | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `goke`           | CLI framework with space-separated subcommands          |
| `@goke/mcp`      | MCP bridge for goke commands                            |
| `zod` (v4)       | Schema validation for CLI args                          |
| `@clack/prompts` | Interactive prompts (scoped to `cliproxy setup` wizard) |
| `string-dedent`  | Template literal dedenting                              |

## CI/CD Pipeline

See [[github-actions-ci]] for shared CI patterns across Marcus's repos.

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PRs to `main`, dispatch | Lint, type check, test (3 parallel jobs + summary gate) |
| Deploy | `deploy.yaml` | Push to `main`, dispatch | Path-filtered deploy for keeweb and cliproxy |
| Release | `release.yaml` | Push to `main`, dispatch | Changesets version + npm publish |
| Fro Bot | `fro-bot.yaml` | PRs, @mentions, daily schedule, dispatch | AI code review, autohealing, cross-project intel |
| Renovate | `renovate.yaml` | Schedule, issue/PR edits, post-deploy | Dependency updates |
| Renovate Changesets | `renovate-changesets.yaml` | Renovate PRs | Auto-create changeset files for dep updates |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | Dispatch, self-changes | Copilot agent environment prep |
| Scorecard | `scorecard.yaml` | Weekly, push to `main` | OpenSSF security analysis |
| Update Repo Settings | `update-repo-settings.yaml` | Daily, push to `main` | Probot settings sync from `settings.yml` |

### CI Jobs (ci.yaml)

Three parallel jobs + a summary gate:

1. **Lint** -- ESLint via `bun run lint` + formatting check via `bun run fix` + git diff
2. **Type Check** -- `bunx tsc --noEmit`
3. **Test** -- `bun test --recursive`
4. **CI** (gate) -- `needs: [lint, type-check, test]`, fails if any upstream job failed

All lint/type-check jobs pin Node 24 via `actions/setup-node` because ESLint's shebang uses system Node, and ubuntu-latest ships Node 20 which lacks ES2024 APIs (`Object.groupBy`) used by `eslint-flat-config-utils`.

### Deploy Pipeline (deploy.yaml)

Uses `dorny/paths-filter` for change detection (native `paths:` breaks `workflow_dispatch`). Each app has a dedicated job gated by its sub-filter and a GitHub Environment with approval.

- **deploy-keeweb** -- `keeweb` environment, builds `dist/`, deploys via SSH/rsync, post-deploy health check
- **deploy-cliproxy** -- `cliproxy` environment, deploys via `bun run --cwd apps/cliproxy deploy`, post-deploy health check via management API

### Release Pipeline (release.yaml)

Uses `changesets/action` for version management and npm publishing. Git identity from a GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Publishes `@marcusrbrown/infra` with provenance.

### Branch Protection

Required status checks on `main`: CI, Fro Bot, Lint, Type Check, Renovate. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`). Uses `fro-bot/agent@df5588ff` (v0.40.2).

Triggers:

- PRs (opened, synchronize, reopened, ready_for_review, review_requested)
- @fro-bot mentions in comments (owner/member/collaborator only)
- Daily schedule (03:30 UTC)
- `workflow_dispatch` with optional custom prompt

The workflow has dedicated prompt templates:

- **PR review prompt:** Structured review with Verdict (PASS/CONDITIONAL/REJECT), blocking issues, risk assessment
- **Schedule prompt:** 7-category daily autohealing (errored PRs, security, code quality, DX, deploy health, live site review, cross-project intelligence)

Concurrency: per-PR/issue/discussion/run, non-canceling (important for autohealing runs).

## Developer Tooling

- **Bun:** Package manager and runtime (`bun.lock` text format committed, `bun.lockb` binary not used)
- **ESLint:** Flat config via `@bfra.me/eslint-config` (v0.51.0), ignores `.agents/`, `.opencode/`, `docs/`, `dist/`, `.cache/`, `AGENTS.md`
- **Prettier:** `@bfra.me/prettier-config/120-proof` (v0.16.0, 120-char line width)
- **TypeScript:** `@bfra.me/tsconfig` (v0.13.0), ESNext target/module, Bundler resolution, Bun types
- **Git hooks:** `simple-git-hooks` + `lint-staged` (ESLint `--fix` on staged `*.{ts,js,json,md,yaml,yml,conf}`)
- **Changesets:** `@changesets/cli` (v2.30.0) with `@svitejs/changesets-changelog-github-compact`
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8`, groups all non-major, post-upgrade runs `bun install --ignore-scripts && bun run fix`
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml`
- **AGENTS.md:** Root-level + per-app/package AGENTS.md files for AI agent context
- **Copilot:** `.github/copilot-instructions.md` references AGENTS.md
- **OpenCode:** `.opencode/commands/generate-readme.md` slash command

## Required Secrets and Variables

### Environment: `keeweb`

| Secret               | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `DEPLOY_SSH_KEY`     | Ed25519 key for `deploy-kw@box.heatvision.co`  |
| `DROPBOX_APP_SECRET` | Dropbox credential for KeeWeb config injection |

### Environment: `cliproxy`

| Secret                    | Purpose                             |
| ------------------------- | ----------------------------------- |
| `CLIPROXY_SSH_KEY`        | Ed25519 key for cliproxy DO droplet |
| `CLIPROXY_MANAGEMENT_KEY` | Management API bearer token         |
| `CLIPROXY_DOMAIN`         | FQDN of CLIProxyAPI instance        |

### Repository-level

| Secret                      | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `APPLICATION_ID`            | GitHub App ID (Renovate, settings sync, release)      |
| `APPLICATION_PRIVATE_KEY`   | GitHub App private key                                |
| `DIGITALOCEAN_ACCESS_TOKEN` | DO API token (cliproxy provisioning)                  |
| `FRO_BOT_PAT`               | PAT for fro-bot user identity                         |
| `NPM_TOKEN`                 | npm publish token                                     |
| `OMO_PROVIDERS`             | Comma-separated oMo provider list                     |
| `OPENCODE_AUTH_JSON`        | LLM provider credentials JSON                         |
| `OPENCODE_CONFIG`           | OpenCode provider config (Anthropic baseURL override) |

| Variable        | Purpose                        |
| --------------- | ------------------------------ |
| `FRO_BOT_MODEL` | LLM model ID for Fro Bot agent |

## Notable Patterns

- **Bun-native monorepo:** Uses Bun workspaces (`bun.lock` text format, not lockb binary). Contrasts with the YAML/Python tooling in [[marcusrbrown--ha-config]].
- **Download-based build:** KeeWeb v1.18.7 release zip is downloaded and verified (source build infeasible due to 2017-era tooling). Cached in `.cache/`.
- **Deploy separation:** Content-only by default, nginx config requires explicit `--nginx` flag + environment approval.
- **Scoped deploy user:** `deploy-kw` has write to site dir only + sudo for single activation script. Least-privilege.
- **Config.yaml safety:** CLIProxyAPI deploy never overwrites server-side `config.yaml` (runtime API keys) unless `--force-config`. This is critical.
- **Host key pinning:** SSH host keys for `box.heatvision.co` and `cliproxy.fro.bot` committed in `.github/known_hosts`. No runtime `ssh-keyscan`.
- **Node 24 pin in CI:** Required because ESLint binary shebang hits system Node, and ubuntu-latest Node 20 lacks ES2024 APIs.
- **MCP bridge:** CLI exposes all commands as MCP tools, letting Fro Bot and Copilot call infrastructure operations programmatically.
- **Compound learning:** `docs/solutions/` captures solved problems with YAML frontmatter for future reference by agents.
- **7-category autohealing:** Daily Fro Bot schedule covers errored PRs, security, code quality, DX, deploy health, live site review, and cross-project intelligence.

## Conventions (from AGENTS.md)

- Only `deploy.sh` is bash; all other scripts are TypeScript via Bun
- `.yaml` extension (not `.yml`) for GitHub Actions workflows
- SHA-pin all actions with `# vX.Y.Z` version comment
- Never `secrets: inherit` with cross-org reusable workflows
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- Never commit real secret values; `config/config.json` template stays empty
- Never overwrite `config.yaml` on cliproxy server without `--force-config`
- Tests colocated as `*.test.ts`, fixtures in `__fixtures__/`, snapshots in `__snapshots__/`
- Mock at boundaries (fetch, Bun.spawn), not internals
- `NO_COLOR=1` in subprocess env for deterministic snapshots
- CI install: `bun install --frozen-lockfile --ignore-scripts`

## Cross-References

- Shares `@bfra.me/*` config ecosystem with [[marcusrbrown--ha-config]]
- Both repos extend `fro-bot/.github:common-settings.yaml` for Probot settings
- Both repos use Renovate extending `marcusrbrown/renovate-config`
- infra has a Fro Bot agent workflow; [[marcusrbrown--ha-config]] does not (noted as follow-up)
- CLIProxyAPI at `cliproxy.fro.bot` is the Claude proxy that powers Fro Bot agent runs across repos
