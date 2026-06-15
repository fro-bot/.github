---
type: repo
title: "marcusrbrown/infra"
created: 2026-04-18
updated: 2026-06-09
sources:
  - url: https://github.com/marcusrbrown/infra
    sha: 9ce50f419995919aae53143eb797bd7798949cc0
    accessed: 2026-06-09
  - url: https://github.com/marcusrbrown/infra
    sha: 2f9bafd6cdb03d9ed28ee336d99d5f7bf09a3dfb
    accessed: 2026-05-27
  - url: https://github.com/marcusrbrown/infra
    sha: 938fa7c5fb1d10e844a214048e7928afe3095b79
    accessed: 2026-04-27
  - url: https://github.com/marcusrbrown/infra
    sha: cd3bb1631e67563c58df099feda5c53ea2e78d18
    accessed: 2026-04-26
  - url: https://github.com/marcusrbrown/infra
    sha: 9306b9bef8e6d3c6f821ee0c4df99e24acb750ac
    accessed: 2026-04-25
  - url: https://github.com/marcusrbrown/infra
    sha: 9306b9bef8e6d3c6f821ee0c4df99e24acb750ac
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/infra
    sha: 20de04713bf01294217dee4d3b64d5d7cfb2426e
    accessed: 2026-04-18
tags: [bun, deploy, github-actions, infra, keeweb, cliproxy, gateway, umami, mcp, cli, typescript, conventions, discord, analytics]
aliases: [infra]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--systematic
  - fro-bot--agent
---

# marcusrbrown/infra

Bun workspace monorepo for Marcus R. Brown's personal infrastructure. Hosts KeeWeb deploy automation, the CLIProxyAPI proxy (routes Fro Bot agents to Claude via the Claude Code OAuth subscription), the [[fro-bot--agent]] Discord gateway deployment, self-hosted Umami analytics, and an operational CLI with MCP bridge.

## Overview

- **Purpose:** Deploy automation, operational CLI, and infrastructure tooling
- **Default branch:** `main`
- **Created:** 2026-04-03
- **Last push:** 2026-06-09 (`9ce50f4`)
- **Runtime:** Bun v1.0+
- **Published package:** `@marcusrbrown/infra` v0.9.17 on npm
- **Open issues:** ~1+ (active Renovate Dependency Dashboard + autohealing reports; exact count fluctuates)
- **Open PRs:** 1 (as of 2026-06-09)
- **Topics:** `bun`, `deploy`, `github-actions`, `infra`, `keeweb`
- **License:** MIT

## Repository Structure

Bun workspace monorepo with `apps/*` and `packages/*` workspaces.

### Key Directories

| Directory             | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `apps/keeweb/`        | KeeWeb v1.18.7 static site deploy automation (`kw.igg.ms`)             |
| `apps/cliproxy/`      | CLIProxyAPI Docker Compose stack behind Caddy (`cliproxy.fro.bot`)     |
| `apps/gateway/`       | Fro Bot Discord gateway + workspace runner + mitmproxy (`gateway.fro.bot`) |
| `apps/umami/`         | Umami analytics Docker Compose stack (umami + postgres + caddy) at `metrics.fro.bot` |
| `packages/cli/`       | `@marcusrbrown/infra` CLI — health checks, deploy triggers, MCP bridge |
| `packages/shared/`    | Shared TypeScript helpers for DigitalOcean droplet provisioning (private) |
| `docs/brainstorms/`   | Requirements and brainstorm documents                                  |
| `docs/plans/`         | Implementation plans                                                   |
| `docs/solutions/`     | Compound learning docs (solved problems with YAML frontmatter)         |
| `docs/runbooks/`      | Operator day-2 procedures (e.g., Discord token lifecycle)              |
| `.agents/skills/`     | Agent skill context packets (goke)                                     |
| `.opencode/commands/` | OpenCode slash commands                                                |
| `.changeset/`         | Changesets config for versioning                                       |

### Apps

#### KeeWeb (`apps/keeweb`)

Self-hosted [KeeWeb](https://keeweb.info) v1.18.7 password manager at `kw.igg.ms`. Download-based build: fetches the upstream release archive, verifies SHA-256, produces a deploy-ready `dist/` with optional Dropbox client-credential injection. Deployed via SSH/rsync to `box.heatvision.co` (a Mail-In-A-Box server).

- Deploy target: `/home/user-data/www/kw.igg.ms/` on `box.heatvision.co`
- Deploy user: `deploy-kw` with scoped sudo for a single activation script (`/usr/local/bin/kw-deploy-activate`)
- Content-only deploy by default; `--nginx` flag for config deploy
- Host keys pinned in `.github/known_hosts` (no `ssh-keyscan`)

#### CLIProxyAPI (`apps/cliproxy`)

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) Docker Compose stack fronted by Caddy at `cliproxy.fro.bot`. Authenticates to Claude once via the Claude Code OAuth flow, then issues per-repo API keys so Fro Bot agents across multiple repositories can use Claude models through a single subscription.

- Runs on a DigitalOcean droplet provisioned via `bun run --cwd apps/cliproxy provision`
- Deploy uploads compose files and restarts the stack (idempotent, preserves runtime `config.yaml` unless `--force-config`)
- Management API for runtime config, API key distribution, and login
- Multi-provider login support: Claude (default), OpenAI/Codex via device-code OAuth (added #303, 2026-05-24), OpenAI provider opt-in for `cliproxy setup --harness opencode` (#307, 2026-05-26)

#### Fro Bot Gateway (`apps/gateway`)

Fro Bot Discord client + workspace runner stack at `gateway.fro.bot`. Three-service Docker Compose deployment: gateway daemon, workspace executor, and mitmproxy egress filter. Upstream source is `fro-bot/agent`, pinned via `apps/gateway/upstream.json` (currently `v0.44.2`). No public HTTP surface — outbound to Discord and S3 only. Added in #264 (2026-05-18).

- Provisioned on a dedicated DigitalOcean droplet (`s-1vcpu-2gb`, `nyc1`, tagged `gateway`)
- **Secret materialization via SSH stdin only** — never via argv. 7 required + 2 optional secret files written atomically under `/opt/gateway/deploy/secrets/`; compose maps each to `/run/secrets/<snake_case>` and exposes via `${NAME}_FILE` env vars
- **Checksum-after-success invariant:** `/opt/gateway/.secrets-checksum` is written only after compose up + Discord command registration both succeed. Mid-rotation failures leave the old checksum so the next deploy force-recreates containers
- **Registration poll:** ~90s budget against `GET /applications/{app_id}/guilds/{guild_id}/commands`; 429 honors `Retry-After` without counting against attempts; 401/403/404 abort with token-sanitized errors
- **mitmproxy CA** lives in the `mitmproxy-certs` named volume; backup/restore via `gateway backup --include-ca` / `gateway restore --input FILE --include-ca` (tarball must contain exactly `mitmproxy-ca-cert.pem` + `mitmproxy-ca.pem`)
- **Host hardening:** `validateGatewayHost` rejects `-`-prefixed values before any SSH invocation (SSH treats `-`-prefixed hostnames as flags, including `-oProxyCommand=`); host keys pinned in `.github/known_hosts` (commit `cf0500af`, 2026-05-19)
- **Deploy SSH multiplexing** via ControlMaster (#277, 2026-05-20) to amortize handshake cost across the multi-step deploy

#### Umami (`apps/umami`)

Self-hosted [Umami](https://umami.is) privacy-respecting analytics at `metrics.fro.bot`. Added post-2026-05-27 survey. Three-service Docker Compose stack:

- **umami** — `umamisoftware/umami:3.1.0` (digest-pinned)
- **postgres** — `postgres:15-alpine` (digest-pinned); port 5432 never published to host
- **caddy** — `caddy:2.11.3-alpine` (digest-pinned); handles automatic HTTPS

Key operational properties:
- `DISABLE_TELEMETRY=1` and `PRIVATE_MODE=1` set in compose layer; cookie-free, respects DNT
- Admin password rotated on every deploy (before Caddy starts); DB-password fingerprint guard prevents volume-bricking changes
- Provisioned on `s-1vcpu-1gb` DigitalOcean droplet (`docker-20-04` image) — smallest in the infra fleet
- Secret materialization via SSH stdin (`/opt/umami/.env`) — never argv
- DNS preflight before deploy (validates `UMAMI_DOMAIN` resolves before touching droplet)
- `umami` environment in GitHub Actions with required reviewer gate

### CLI (`packages/cli`)

Published as `@marcusrbrown/infra` on npm. Built with [goke](https://github.com/remorses/goke) (CLI framework) + Zod Standard Schemas. Key commands:

| Command                 | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `infra status`          | Parallel health checks for all deployments (`--json` for machine output) |
| `infra keeweb status`   | HTTP reachability, last deploy timestamp, SHA-256 content hash           |
| `infra keeweb deploy`   | Trigger deployment (remote via GitHub Actions or `--local` via SSH)      |
| `infra keeweb open`     | Open KeeWeb in browser (fire-and-forget)                                 |
| `infra cliproxy status` | HTTP reachability, version, usage stats                                  |
| `infra cliproxy deploy` | Trigger CLIProxyAPI deployment                                           |
| `infra cliproxy config` | Read/update runtime config via management API                            |
| `infra cliproxy keys`   | Manage proxy API keys for Fro Bot repos                                  |
| `infra cliproxy login`  | OAuth authentication with Claude subscription (SSH + TTY)                |
| `infra cliproxy setup`  | Interactive onboarding wizard for connecting a repo to CLIProxyAPI       |
| `infra cliproxy open`   | Launch CLIProxyAPI terminal dashboard via SSH                            |
| `infra gateway status`  | SSH + `docker compose ps` (NDJSON parsed, #278) — service states, healthchecks |
| `infra gateway deploy`  | Trigger gateway deploy workflow (remote, default) or `--local` (requires `SSH_AUTH_SOCK`) |
| `infra gateway logs <svc> [--tail N]` | Stream `docker compose logs` for `gateway`/`workspace`/`mitmproxy`; `--allow-ci` required in headless contexts |
| `infra gateway backup --include-ca`   | Pull mitmproxy CA tarball; local file created with mode 0600 via `O_EXCL\|O_CREAT` (no chmod race) |
| `infra gateway restore --input FILE --include-ca` | Validate tarball locally, upload to unguessable `mktemp` path, extract, restart, byte-equal confirm |
| `infra umami status`    | HTTP reachability check for `metrics.fro.bot`                            |
| `infra umami deploy`    | Trigger Umami deployment (remote via GitHub Actions or `--local` via SSH) |
| `infra umami host`      | Display/validate the Umami droplet host                                  |
| `infra umami logs [--tail N]` | Stream docker compose logs for umami/db/caddy services             |
| `infra mcp`             | Start stdio MCP server exposing all CLI commands as tools (read-only allowlist) |

The MCP bridge (`infra mcp`) lets coding agents (Fro Bot, Copilot) call commands programmatically via the [Model Context Protocol](https://modelcontextprotocol.io).

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PR to `main`, dispatch | Lint + type check + test (parallel jobs) |
| Deploy | `deploy.yaml` | Dispatch only | Thin orchestrator — calls all per-app deploy workflows via `workflow_call` |
| Deploy KeeWeb | `deploy-keeweb.yaml` | Push to `main`, dispatch, `workflow_call` | Build and deploy KeeWeb (path-filtered, `keeweb` environment) |
| Deploy CLIProxy | `deploy-cliproxy.yaml` | Push to `main`, dispatch, `workflow_call` | Deploy CLIProxyAPI (path-filtered, `cliproxy` environment) |
| Deploy Gateway | `deploy-gateway.yaml` | Push to `main`, dispatch, `workflow_call` | Deploy Fro Bot gateway stack (path-filtered, `gateway` environment) |
| Deploy Umami | `deploy-umami.yaml` | Push to `main`, dispatch, `workflow_call` | Deploy Umami analytics stack (path-filtered, `umami` environment) |
| Release | `release.yaml` | Push to `main`, dispatch | Version and publish `@marcusrbrown/infra` via Changesets |
| Renovate | `renovate.yaml` | Schedule, issue/PR edits, post-deploy | Automated dependency updates |
| Renovate Changesets | `renovate-changesets.yaml` | `pull_request_target` (Renovate PRs) | Auto-create changeset files for dependency updates |
| Fro Bot | `fro-bot.yaml` | PRs, @mentions, daily schedule, dispatch | AI code review and autohealing |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | Dispatch, changes to workflow file | Prepare environment for Copilot coding agent |
| Scorecard | `scorecard.yaml` | Weekly, push to `main` | OpenSSF security analysis |
| Update Repo Settings | `update-repo-settings.yaml` | Daily, push to `main` | Sync repo settings from `.github/settings.yml` |

### CI Jobs (ci.yaml)

Three parallel jobs with a summary gate:

1. **Lint** — ESLint + Prettier formatting check (Node 24 pinned for ES2024 API compat)
2. **Type Check** — `bunx tsc --noEmit` (Node 24 pinned)
3. **Test** — `bun test --recursive`
4. **CI** (gate) — Fails if lint or type-check fails; test failures do not block (test job not in `needs`)

### Deploy Pipeline (Split Architecture)

As of 2026-04-20 (#165), the deploy pipeline was split from a single `deploy.yaml` into dedicated per-app workflows. This ensures one app's failure doesn't block the other:

- **`deploy-keeweb.yaml`** — `keeweb` environment, triggered on push-to-main (path-filtered), dispatch, or `workflow_call`. Builds dist, deploys content via SSH/rsync, optionally deploys nginx config if changed. Post-deploy health check: `curl` to `https://kw.igg.ms/`. Secret validation step rejects early if `DEPLOY_SSH_KEY` or `DROPBOX_APP_SECRET` are missing.
- **`deploy-cliproxy.yaml`** — `cliproxy` environment, triggered on push-to-main (path-filtered), dispatch, or `workflow_call`. Deploys via `bun run --cwd apps/cliproxy deploy`. Post-deploy health check against management API (`/v0/management/config` with management key). Secret validation for `CLIPROXY_SSH_KEY`, `CLIPROXY_MANAGEMENT_KEY`, `CLIPROXY_DOMAIN`.
- **`deploy.yaml`** — Now a thin orchestrator (dispatch-only) that calls both deploy workflows via `workflow_call`, passing secrets explicitly.

Both deploy workflows use `dorny/paths-filter` for change detection (native `paths:` breaks `workflow_dispatch`). Path filters exclude markdown, test, fixture, and snapshot files.

### Release Pipeline (release.yaml)

Uses `changesets/action` for versioning and npm publishing. Git user configured via GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Publishes to npm with provenance (`publishConfig.provenance: true`).

### Branch Protection

Required status checks on `main`: CI, Fro Bot, Lint, Type Check, `Renovate / Renovate`. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Developer Tooling

| Tool | Config | Notes |
| --- | --- | --- |
| ESLint | `eslint.config.ts` via `@bfra.me/eslint-config` 0.51.1 | Flat config; ignores `.agents/`, `.opencode/`, `docs/`, `dist/` |
| Prettier | `@bfra.me/prettier-config/120-proof` ^0.16.0 (Prettier 3.8.3) | 120-char line width |
| TypeScript | `tsconfig.json` via `@bfra.me/tsconfig` 0.13.1 | Target ESNext, Bundler resolution, Bun types, noEmit |
| Git hooks | `simple-git-hooks` 2.13.1 + `lint-staged` 16.4.0 | `eslint --fix` on staged files |
| CLI framework | `goke` ^6.8.0 + Zod ^4.3.6 | Space-separated subcommands |
| Prompts | `@clack/prompts` ^1.2.0 | Scoped to `cliproxy setup` wizard |
| Changesets | `@changesets/cli` 2.31.0 + `@svitejs/changesets-changelog-github-compact` | Versioning for `@marcusrbrown/infra` CLI package |
| Renovate | Extends `marcusrbrown/renovate-config#5.2.0` + `group:allNonMajor` | v4→v5 crossed 2026-05-17 (#242). Post-upgrade: `bun install --ignore-scripts` + `bun run fix`. Docker source URLs for CLIProxyAPI and Caddy. `bfra-me/.github` digest updates disabled |
| Probot Settings | Extends `fro-bot/.github:common-settings.yaml` | Repository configuration sync |
| TypeScript runtime | TypeScript 6.0.3, ESLint 10.4.0 | Both crossed major boundaries in this survey window |

### Key Dependencies

| Package          | Version | Purpose                                   |
| ---------------- | ------- | ----------------------------------------- |
| `goke`           | ^6.8.0  | CLI framework (root + cli package)        |
| `@goke/mcp`      | ^0.0.10 | MCP bridge for exposing CLI as tools      |
| `zod`            | ^4.3.6  | Schema validation for CLI commands        |
| `@clack/prompts` | ^1.2.0  | Interactive prompts for onboarding wizard |
| `string-dedent`  | ^3.0.2  | Template literal dedent utility           |
| `typescript`     | ^6.0.0  | Type checking (dev)                       |
| `eslint`         | ^10.0.0 | Linting (dev)                             |

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.59.0` (SHA `feb5365dca6dc56752e1258d1ca66afa7b035e04`; bumped from v0.44.3 via v0.45.x–v0.58.x over 2026-05-27 → 2026-06-09). The workflow includes:

- **PR review** with structured verdict format (PASS / CONDITIONAL / REJECT) and sections for blocking issues, non-blocking concerns, missing tests, and risk assessment
- **Daily autohealing schedule** (03:30 UTC) with 8 operational categories: errored PRs, security, code quality, developer experience, deploy pipeline health, live site review (via `agent-browser`), cross-project intelligence, and **upstream modernization watch** (Sunday-only)
- **@mentions** in comments by OWNER/MEMBER/COLLABORATOR
- **Custom dispatch prompts** via `workflow_dispatch`
- Concurrency per PR/issue/discussion, non-cancelling

### Upstream Modernization Watch (Category 8)

Added 2026-04-25 (#182). Runs fully on **Sundays UTC** (and on manual dispatch with empty prompt); skipped on other days. Tracks release notes of pinned upstream dependencies for config or feature adoption opportunities:

- `eceasy/cli-proxy-api` (upstream: `router-for-me/CLIProxyAPI`) — Claude-only filter; skips Codex, Gemini, OpenAI, Vertex, Antigravity, Kimi, Qwen, GPT-5.x changes
- `caddy` (upstream: `caddyserver/caddy`)
- `fro-bot/agent`
- `bfra-me/.github` action set

Action policy: low-risk mechanical changes (docker-compose, app config, AGENTS.md) get a draft PR; workflow/build-config changes are documented in a tracking issue only. At most one draft PR per scan. Never bumps pinned versions — Renovate owns that.

The autohealing schedule monitors:

- Cross-project config version drift across `marcusrbrown/containers`, `marcusrbrown/sparkle`, `marcusrbrown/gpt`, `marcusrbrown/copiloting`, `marcusrbrown/renovate-config`, `marcusrbrown/.github`
- Live site health at `kw.igg.ms` via browser automation
- **CLIProxy health** (added 2026-04-18, #155): `cliproxy.fro.bot` reachability (401/200 = up, 5xx = down), environment secrets, host keys, indirect OAuth token health (inferred from recent Fro Bot schedule run success/failure)
- Deploy pipeline health for **both apps** via the split `deploy-keeweb` and `deploy-cliproxy` workflows
- Security advisories, code quality, and convention compliance

### Required Secrets

**`keeweb` environment:** `DEPLOY_SSH_KEY`, `DROPBOX_APP_SECRET`

**`cliproxy` environment:** `CLIPROXY_SSH_KEY`, `CLIPROXY_MANAGEMENT_KEY`, `CLIPROXY_DOMAIN`

**`gateway` environment (updated 2026-06-09):** Required: `GATEWAY_SSH_KEY`, `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, `GATEWAY_HOST`, `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `WORKSPACE_OPENCODE_TOKEN`, `WORKSPACE_OPENCODE_AUTH`, `WORKSPACE_OPENCODE_MODEL`, `WORKSPACE_OPENCODE_CONFIG`, `GATEWAY_TRIGGER_ROLE_ID`. Optional: `S3_ENDPOINT`, `OBJECT_STORE_HOSTS`, `AWS_SESSION_TOKEN`, `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_PRESENCE_CHANNEL_ID`.

**`umami` environment (added post-2026-05-27):** `UMAMI_SSH_KEY`, `UMAMI_DOMAIN`, `UMAMI_APP_SECRET`, `UMAMI_DB_PASSWORD`, `UMAMI_ADMIN_PASSWORD`

**Repository secrets:** `APPLICATION_ID`, `APPLICATION_PRIVATE_KEY`, `DIGITALOCEAN_ACCESS_TOKEN`, `FRO_BOT_PAT`, `NPM_TOKEN`, `OPENCODE_AUTH_JSON`, `OPENCODE_CONFIG`

**Repository variables:** `FRO_BOT_MODEL`

## Conventions

- **Package manager:** Bun only (never npm/pnpm/yarn). CI installs with `--frozen-lockfile --ignore-scripts`.
- **TypeScript strict mode:** No `any`, `@ts-ignore`, `@ts-expect-error`.
- **Only bash script:** `apps/keeweb/deploy.sh`. All other scripts are TypeScript run via `bun run`.
- **YAML extension:** `.yaml` (not `.yml`) for GitHub Actions workflows.
- **Action pinning:** SHA-pinned with `# vX.Y.Z` version comment.
- **Cross-org workflows:** Never `secrets: inherit` with `bfra-me/.github`.
- **Tests:** Colocated `*.test.ts` alongside source. Fixtures in `__fixtures__/`, snapshots in `__snapshots__/`. `NO_COLOR=1` for deterministic subprocess output. Mock at boundaries (fetch, Bun.spawn).
- **CI Node pin:** Workflows running `bun run lint` or `bunx tsc` must pin Node 24 via `actions/setup-node` (ESLint shebang uses system Node; ubuntu-latest ships Node 20 without ES2024 APIs).
- **Lockfile:** `bun.lock` (text format) committed; `bun.lockb` (binary) is not used.
- **Config safety:** `config/config.json` template has empty `dropboxSecret`; real value injected at build time. Never overwrite `config.yaml` on cliproxy server (runtime API keys live there).
- **Host keys:** Pinned in `.github/known_hosts`. Never use `ssh-keyscan` in CI. Provisioning scripts may use it locally via the shared `pinHostKeys` helper in `packages/shared/server/droplet-helpers.ts`.
- **Gateway secrets:** Never pass gateway secret bytes via argv — `writeRemoteFile` pipes through SSH stdin only; `--body <value>` patterns are banned.
- **Gateway host validation:** Never skip `validateGatewayHost` — required before any SSH invocation against the gateway droplet.
- **CA rotation:** Never restart the gateway in-place to rotate the mitmproxy CA — workspaces lose trust in the egress proxy. Restore from backup instead.
- **`bundledDependencies`:** Banned (enforced). Bun's `.bun/` symlink layout creates `../../` paths that npm rejects with E415.

## Cross-Repository Patterns

Shared ecosystem with [[marcusrbrown--ha-config]]:

- Both extend `fro-bot/.github:common-settings.yaml` for Probot repo settings
- Both use Renovate extending `marcusrbrown/renovate-config` (infra at #4.5.8, ha-config at #4.5.7)
- Both use `@bfra.me/*` shared configs (eslint-config, prettier-config, tsconfig)
- Both use SHA-pinned GitHub Actions with version comments
- Both use reusable workflows from `bfra-me/.github`
- infra has a Fro Bot agent workflow; ha-config does not (follow-up PR recommended there)
- infra uses Bun as runtime; ha-config uses Python/YAML tooling
- infra uses Changesets for npm versioning; ha-config has no publishable packages

## Convention Enforcement

As of 2026-04-21, structural conventions from root `AGENTS.md` are mechanically gated pre-merge:

- **`packages/cli/src/conventions.test.ts`** (#161) — Bun tests that assert AGENTS.md rules at CI time. Rules marked `(enforced)` in AGENTS.md are the mechanically checked set.
- **`(enforced)` marker drift detection** (#167) — Tests detect when `(enforced)` markers in AGENTS.md drift from the actual test assertions, and when per-app `AGENTS.md` files diverge from their directory structure.
- Enforced rules include: only `deploy.sh` is bash, `.yaml` not `.yml` for workflows, SHA-pinned actions with version comments, no `secrets: inherit` with cross-org workflows, no `bundledDependencies`, no `any`/`@ts-ignore`/`@ts-expect-error`, no secret values in tracked config files, no `ssh-keyscan` in CI workflows.

This approach avoids relying solely on human review or agent-driven linting for structural invariants — the CI gate rejects violations before merge.

## Notable Patterns

- **MCP bridge:** The CLI exposes all commands as MCP tools (`infra mcp`), letting coding agents call deploy/status/config commands programmatically. This is the mechanism by which Fro Bot agents interact with infrastructure.
- **CLIProxyAPI as shared Claude proxy:** A single Claude Code OAuth subscription is shared across Fro Bot agents in multiple repos via per-repo API keys managed through `infra cliproxy keys`.
- **Download-based build:** KeeWeb is built from a release archive rather than source (2017-era upstream tooling makes source build infeasible). SHA-256 verification ensures integrity.
- **Scoped deploy user:** `deploy-kw` on the target server has write access to the site directory only, with sudo for a single activation script. Minimal privilege surface.
- **Compound learning:** `docs/solutions/` contains solved-problem documentation with YAML frontmatter, following the compound knowledge pattern.
- **Agent skills:** `.agents/skills/goke/SKILL.md` provides domain context for the goke CLI framework.
- **Split deploy pipeline:** Each app deploys independently via dedicated workflows (`deploy-keeweb.yaml`, `deploy-cliproxy.yaml`), preventing cascading failures. A thin `deploy.yaml` orchestrator exists for manual dispatch of both simultaneously.

## Infrastructure Components

### CLIProxyAPI Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.3-alpine` | Digest-pinned |
| CLIProxyAPI | `eceasy/cli-proxy-api:v7.1.56` | Digest-pinned |

Both images are digest-pinned in `docker-compose.yaml`. Renovate manages digest rotations with changelog context sourced from upstream repositories (`router-for-me/CLIProxyAPI`, `caddyserver/caddy`).

**Version note:** CLIProxyAPI crossed v6→v7 major boundary between 2026-05-27 and 2026-06-09. The prior survey recorded v6.10.9; the current deployment is v7.1.56. Intermediate v7.1.54/55 were rolled back (#463, 2026-06-09) due to a health check regression before settling at v7.1.56.

**Healthcheck change:** As of #469 (2026-06-09), the deploy healthcheck was moved from the CLIProxyAPI endpoint to the Caddy endpoint for Debian-image compatibility. The docker-compose healthcheck itself (`wget --spider http://localhost:8317/healthz`) is unchanged.

### Umami Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.3-alpine` | Digest-pinned (shared digest with cliproxy) |
| Umami analytics | `umamisoftware/umami:3.1.0` | Digest-pinned |
| Postgres | `postgres:15-alpine` | Digest-pinned |

Digest-pinned images managed by Renovate. Postgres port 5432 is never published to the host — DB is only accessible on the internal compose network.

### Fro Bot Gateway Stack

| Component | Source | Notes |
| --- | --- | --- |
| Gateway daemon | `fro-bot/agent@v0.57.0` (pinned in `apps/gateway/upstream.json`) | Cloned + reset on the droplet each deploy |
| Workspace executor | Same source | Runs inside the same Compose stack |
| mitmproxy | Per upstream compose | Starts first; certificate in `mitmproxy-certs` named volume |

**Upstream pin note:** Gateway daemon bumped from v0.44.2 (prior survey) to v0.57.0 (#466, 2026-06-09) to pick up the `daily_digest` presence event.

Compose stack lives at `/opt/gateway/` on the droplet. Source materialization is `git clone || git fetch && git reset --hard && git clean -xfd` to the pinned SHA, isolated from `/opt/gateway/.secrets-checksum` so checksum survives `git clean -xfd`.

## Survey History

| Date | SHA | Key Changes |
| --- | --- | --- |
| 2026-04-18 | `20de047` | Initial survey — workspace structure, 9 workflows, CLI v0.4.3, Fro Bot v0.40.2 |
| 2026-04-24 | `9306b9b` | Deploy pipeline split (#165), convention enforcement tests (#161, #167), Fro Bot v0.41.4, CLI v0.4.5, CLIProxy autohealing (#155), 11 workflows |
| 2026-04-25 | `9306b9b` | No code changes; open issues 4→5 (new autohealing report #178) |
| 2026-04-26 | `cd3bb16` | Fro Bot v0.41.4→v0.42.1, new category 8 (Upstream Modernization Watch, #182), CLIProxy healthcheck switched to `/healthz` (#181), CLI v0.4.6, CLIProxyAPI v6.9.38 |
| 2026-04-27 | `938fa7c` | Fro Bot v0.42.1→v0.42.2 (#185), CLIProxyAPI v6.9.38→v6.9.39 (#186), bfra-me/.github v4.16.8→v4.16.9 (#188). Open issues 4→5, 1 open PR (version packages #187) |
| 2026-05-27 | `2f9bafd` | **Major expansion.** New `apps/gateway/` (Fro Bot Discord stack at `gateway.fro.bot`, #264, 2026-05-18); new `packages/shared/` for droplet provisioning helpers (#290). 12 workflows (added `deploy-gateway.yaml`). Fro Bot agent v0.42.2 → v0.44.3 (multiple bumps). Renovate preset bumped major v4→v5 (#242, `marcusrbrown/renovate-config#5.2.0`) with `group:allNonMajor`. TypeScript 6.0.3, ESLint 10.4.0, `@bfra.me/eslint-config` 0.51.1. CLI v0.4.6 → v0.7.0; MCP fidelity refactor for status-only commands (#296). CLIProxy: OpenAI/Codex device-code OAuth login (#303), OpenAI provider opt-in for `cliproxy setup --harness opencode` (#307); CLIProxyAPI v6.10.9, Caddy 2.11.3-alpine. Gateway hardening: ControlMaster multiplexing (#277), pinned droplet host keys (#272), checksum-after-success secret rotation. Discord token-lifecycle runbook (#284). Open issues 5→38, 0 open PRs. |
| 2026-06-09 | `9ce50f4` | **New app: Umami analytics.** Added `apps/umami/` — self-hosted Umami at `metrics.fro.bot`, 3-service Docker Compose (umami 3.1.0 + postgres 15-alpine + caddy 2.11.3-alpine), `deploy-umami.yaml` workflow, `umami` GitHub Environment, new CLI command group (`umami status/deploy/host/logs`). Now 13 workflows total. CLI v0.7.0 → v0.9.17. Fro Bot agent v0.44.3 → v0.59.0 (SHA `feb5365`). Gateway upstream daemon pin v0.44.2 → v0.57.0 (#466, `daily_digest` presence event). CLIProxyAPI v6.x → v7.1.56 (major version; v7.1.54/55 reverted #463 for health check regression, v7.1.56 stable). CLIProxy deploy healthcheck moved to Caddy endpoint for Debian-image compat (#469). Renovate config bumped `marcusrbrown/renovate-config#5.2.1`. Gateway secrets contract expanded (added GitHub App credentials, workspace OpenCode secrets, presence channel secrets). `OMO_PROVIDERS` removed from repo secrets; `WORKSPACE_OPENCODE_TOKEN/AUTH/MODEL/CONFIG` and `GH_APP_ID/PRIVATE_KEY`, `GATEWAY_TRIGGER_ROLE_ID`, `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_PRESENCE_CHANNEL_ID` added. Provisioning management key now written to a 0600 file instead of stdout (#453). |
