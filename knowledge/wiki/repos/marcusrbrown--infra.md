---
type: repo
title: "marcusrbrown/infra"
created: 2026-04-18
updated: 2026-06-19
sources:
  - url: https://github.com/marcusrbrown/infra
    sha: ac7946892a6a12c7b1720e273d4c7398e7d738c0
    accessed: 2026-06-19
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
tags: [bun, deploy, github-actions, infra, keeweb, cliproxy, gateway, umami, dashboard, vpn, wireguard, aws-lightsail, mcp, cli, typescript, conventions, discord, analytics, codeql]
aliases: [infra]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--systematic
  - fro-bot--agent
  - fro-bot--dashboard
---

# marcusrbrown/infra

Bun workspace monorepo for Marcus R. Brown's personal infrastructure. Hosts KeeWeb deploy automation, the CLIProxyAPI proxy (routes Fro Bot agents to Claude via the Claude Code OAuth subscription), the [[fro-bot--agent]] Discord gateway deployment, self-hosted Umami analytics, the [[fro-bot--dashboard]] operator dashboard deploy, a WireGuard VPN egress box on AWS Lightsail, and an operational CLI with MCP bridge.

## Overview

- **Purpose:** Deploy automation, operational CLI, and infrastructure tooling
- **Default branch:** `main`
- **Created:** 2026-04-03
- **Last push:** 2026-06-19 (`ac79468`)
- **Runtime:** Bun v1.0+
- **Published package:** `@marcusrbrown/infra` v0.12.2 on npm
- **Open issues:** active Renovate Dependency Dashboard + autohealing reports; exact count fluctuates
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
| `apps/dashboard/`     | Fro Bot operator dashboard deploy (2-service compose, digest-pinned upstream image) at `dashboard.fro.bot` |
| `apps/vpn/`           | WireGuard VPN egress box on AWS Lightsail (`eu-west-1`); native `wg-quick`/systemd, no Docker |
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

Fro Bot Discord client + workspace runner stack at `gateway.fro.bot`. Three-service Docker Compose deployment: gateway daemon, workspace executor, and mitmproxy egress filter. Upstream source is `fro-bot/agent`, pinned via `apps/gateway/upstream.json` (currently `v0.69.0`). No public HTTP surface — outbound to Discord and S3 only. Added in #264 (2026-05-18).

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

#### Fro Bot Dashboard (`apps/dashboard`)

Fro Bot operator dashboard at `dashboard.fro.bot`, added post-2026-06-09 survey. Two-service Docker Compose stack (dashboard + caddy) on a dedicated DigitalOcean droplet (`s-1vcpu-1gb`, `docker-20-04`). The dashboard image is the **upstream released image** `ghcr.io/fro-bot/dashboard` (see [[fro-bot--dashboard]]), pinned by tag + digest in `docker-compose.yaml` (currently `2026.06.16@sha256:73b05ae…`). No on-droplet build.

- **Digest verification invariant:** deploy pulls the digest-pinned image, brings up the health-gated `dashboard` service, then verifies the running image's `RepoDigests` against the compose-pinned digest before bringing up `caddy`. A public HTTPS probe to `/api/healthz` confirms end-to-end reachability.
- **GitHub App private key is file-mounted, never an env var** — uploaded via SSH stdin to `/opt/dashboard/config/github-app.pem` (0600), mounted at `/run/secrets/github-app.pem`, read via `DASHBOARD_GITHUB_APP_KEY_FILE`
- Secret materialization via SSH stdin (`/opt/dashboard/.env`) — never argv; DNS preflight before deploy
- GitHub OAuth App login gated to a single operator (`DASHBOARD_OPERATOR_LOGIN`)
- Rollback runbook: `docs/runbooks/dashboard-released-image-rollback.md` (revert to a prior image digest)
- Anti-patterns: never `docker compose down -v` (destroys `caddy_data` TLS volume); never add `--build` (no on-droplet builds supported)

#### WireGuard VPN (`apps/vpn`)

WireGuard egress box at a static IP on **AWS Lightsail** (`eu-west-1`, Ireland) — the **first AWS-backed deployable** in this repo. Native `wg-quick@wg0` + systemd, no Docker. Added post-2026-06-09 survey.

- Provisioned via `@aws-sdk/client-lightsail` (`3.1069.0`): creates the Lightsail instance, allocates a static IP (the durable client-facing endpoint), sets the exact firewall ruleset (SSH 22 + UDP 51820), installs WireGuard, pins the IP host key. Refuses to re-run against an existing instance without `--force`.
- **Deploy is SSH-only** — no AWS API calls. AWS credentials are provisioning-only (operator-local, not in the `vpn` Environment).
- **Peer roster:** `VPN_PEERS` GitHub Environment secret (JSON), mirrored locally to gitignored `apps/vpn/config/peers.json`; client `.conf` files written to gitignored `apps/vpn/clients/`. Auto-synced by `vpn client add/remove`.
- **Server-key invariants:** `--force-server-key` rotates the server key and invalidates all client configs; reprovisioning (fresh disk) destroys the server key (all clients fail handshake). Recovery paths in `apps/vpn/AGENTS.md`; runbook `docs/runbooks/vpn-egress-box.md` (bootstrap ordering, reprovision recovery, client onboarding, old-EC2 teardown).
- **Host validation:** `validateVpnHost` rejects `-`-prefixed values (SSH treats them as flags) before any SSH invocation — same pattern as `validateGatewayHost`.
- Deploy never reads the server private key locally — reads back only `server.pub`.

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
| `infra dashboard status` | SSH + `docker compose ps` — service states (MCP-exposed; `dashboard` row in `infra status`) |
| `infra dashboard deploy` | Trigger dashboard deploy (remote via GitHub Actions or `--local` via SSH) |
| `infra dashboard logs [service] [--tail N]` | Stream dashboard/caddy container logs                      |
| `infra vpn status`      | SSH + `wg show wg0` — interface state, server pubkey, peer count (MCP-exposed, read-only) |
| `infra vpn deploy`      | Trigger VPN deploy (remote or `--local`; `--force-server-key` rotates server key) |
| `infra vpn logs [--tail N]` | Stream `journalctl -u wg-quick@wg0`                                  |
| `infra vpn client add\|list\|remove <name>` | Manage peers — generate keypair, assign tunnel IP, write `.conf`, redeploy (CLI-only, sensitive) |
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
| Deploy Dashboard | `deploy-dashboard.yaml` | Push to `main`, dispatch, `workflow_call` | Deploy Fro Bot dashboard stack (path-filtered, `dashboard` environment) |
| Deploy VPN | `deploy-vpn.yaml` | Push to `main`, dispatch, `workflow_call` | Deploy WireGuard VPN box (path-filtered, `vpn` environment) |
| Release | `release.yaml` | Push to `main`, dispatch | Version and publish `@marcusrbrown/infra` via Changesets |
| Renovate | `renovate.yaml` | Schedule, issue/PR edits, post-deploy | Automated dependency updates |
| Renovate Changesets | `renovate-changesets.yaml` | `pull_request_target` (Renovate PRs) | Auto-create changeset files for dependency updates |
| Fro Bot | `fro-bot.yaml` | PRs, @mentions, daily schedule, dispatch | AI code review and autohealing |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | Dispatch, changes to workflow file | Prepare environment for Copilot coding agent |
| Scorecard | `scorecard.yaml` | Weekly, push to `main` | OpenSSF security analysis |
| CodeQL | `codeql.yaml` | Push to `main`, PR, weekly (Wed 05:30 UTC) | CodeQL static analysis (`javascript-typescript` matrix); added post-2026-06-09 |
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
- **`deploy.yaml`** — Now a thin orchestrator (dispatch-only) that calls all six per-app deploy workflows via `workflow_call` (keeweb, cliproxy, gateway, umami, vpn, dashboard), passing secrets explicitly. Each is independently path-gated by `dorny/paths-filter` so one app's failure cannot block the others.

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
| Renovate | Extends `marcusrbrown/renovate-config#5.2.3` + `group:allNonMajor` | v4→v5 crossed 2026-05-17 (#242); preset `#5.2.0` → `#5.2.3` by 2026-06-19. Post-upgrade: `bun install --ignore-scripts` + `bun run fix`. Docker source URLs for CLIProxyAPI and Caddy. `bfra-me/.github` digest updates disabled |
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

**Fro Bot workflow is present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.71.0` (SHA `9b89fb3acadec6f26fdfe49412b9c5cbd5a039d1`; bumped from v0.59.0 via v0.60.x–v0.70.x over 2026-06-09 → 2026-06-19). The workflow includes:

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

**`dashboard` environment (added post-2026-06-09):** `DASHBOARD_SSH_KEY`, `DASHBOARD_DOMAIN`, `DASHBOARD_GITHUB_APP_ID`, `DASHBOARD_GITHUB_APP_KEY` (PEM, file-mounted not env var), `DASHBOARD_OAUTH_CLIENT_ID`, `DASHBOARD_OAUTH_CLIENT_SECRET`, `DASHBOARD_OPERATOR_LOGIN`, `DASHBOARD_COOKIE_KEY`

**`vpn` environment (added post-2026-06-09):** Required: `VPN_SSH_KEY`, `VPN_HOST` (static IP). Optional: `VPN_PEERS` (peer roster JSON; empty roster valid). AWS provisioning credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are operator-local only — **not** in the `vpn` Environment and not used by deploy or status.

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
- **Dashboard GitHub App key:** File-mounted only — never an env var. Never `docker compose down -v` (destroys `caddy_data` TLS volume); never `--build` (the deploy pulls the digest-pinned `ghcr.io/fro-bot/dashboard` image, no on-droplet builds).
- **VPN host validation:** Never skip `validateVpnHost`. Never read the server private key locally — deploy reads back only `server.pub`. AWS credentials are provisioning-only; deploy and status are SSH-only.
- **VPN server key:** Reprovisioning a fresh disk destroys the server key and breaks all clients — follow the recovery paths in `apps/vpn/AGENTS.md`.
- **`bundledDependencies`:** Banned (enforced). Bun's `.bun/` symlink layout creates `../../` paths that npm rejects with E415.

## Cross-Repository Patterns

Shared ecosystem with [[marcusrbrown--ha-config]]:

- Both extend `fro-bot/.github:common-settings.yaml` for Probot repo settings
- Both use Renovate extending [[marcusrbrown--renovate-config]] (infra at #5.2.3 as of 2026-06-19; ha-config tracks the same preset family)
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
- **Split deploy pipeline:** Each of the six apps deploys independently via dedicated path-gated workflows (keeweb, cliproxy, gateway, umami, dashboard, vpn), preventing cascading failures. A thin `deploy.yaml` orchestrator exists for manual dispatch of all simultaneously.
- **Digest-pinned upstream image consumption:** The dashboard app consumes the upstream-built `ghcr.io/fro-bot/dashboard` image by tag + digest and verifies the running container's `RepoDigests` against the pin before serving — a no-build deploy that keeps the build surface in [[fro-bot--dashboard]].
- **Multi-cloud:** Most apps run on DigitalOcean droplets, but the VPN egress box runs on **AWS Lightsail** (`eu-west-1`) — the first AWS-backed deployable, provisioned via the AWS SDK with credentials kept operator-local (deploy/status remain SSH-only).

## Infrastructure Components

### CLIProxyAPI Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.3-alpine` | Digest-pinned |
| CLIProxyAPI | `eceasy/cli-proxy-api:v7.2.20` | Digest-pinned |

Both images are digest-pinned in `docker-compose.yaml`. Renovate manages digest rotations with changelog context sourced from upstream repositories (`router-for-me/CLIProxyAPI`, `caddyserver/caddy`).

**Version note:** CLIProxyAPI crossed v6→v7 major boundary between 2026-05-27 and 2026-06-09. As of 2026-06-19 the deployment is **v7.2.20** (up from v7.1.56 at the prior survey). Caddy steady at `2.11.3-alpine` (digest shared across cliproxy/umami/dashboard).

**Healthcheck change:** As of #469 (2026-06-09), the deploy healthcheck was moved from the CLIProxyAPI endpoint to the Caddy endpoint for Debian-image compatibility. The docker-compose healthcheck itself (`wget --spider http://localhost:8317/healthz`) is unchanged.

### Umami Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.3-alpine` | Digest-pinned (shared digest with cliproxy) |
| Umami analytics | `umamisoftware/umami:3.1.0` | Digest-pinned |
| Postgres | `postgres:15-alpine` | Digest-pinned |

Digest-pinned images managed by Renovate. Postgres port 5432 is never published to the host — DB is only accessible on the internal compose network.

### Fro Bot Dashboard Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.3-alpine` | Digest-pinned (shared digest with cliproxy/umami) |
| Dashboard | `ghcr.io/fro-bot/dashboard:2026.06.16` | Tag + digest-pinned (upstream released image) |

The dashboard image is built upstream in [[fro-bot--dashboard]] and consumed here by digest — no on-droplet build. Deploy verifies the running container's `RepoDigests` matches the compose-pinned digest before fronting it with Caddy.

### Fro Bot Gateway Stack

| Component | Source | Notes |
| --- | --- | --- |
| Gateway daemon | `fro-bot/agent@v0.69.0` (pinned in `apps/gateway/upstream.json`) | Cloned + reset on the droplet each deploy |
| Workspace executor | Same source | Runs inside the same Compose stack |
| mitmproxy | Per upstream compose | Starts first; certificate in `mitmproxy-certs` named volume |

**Upstream pin note:** Gateway daemon bumped to v0.69.0 (from v0.57.0 at the prior survey).

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
| 2026-06-19 | `ac79468` | **Two new apps: dashboard + VPN.** Added `apps/dashboard/` — Fro Bot operator dashboard at `dashboard.fro.bot`, 2-service compose (caddy + digest-pinned `ghcr.io/fro-bot/dashboard:2026.06.16`), `deploy-dashboard.yaml`, `dashboard` GitHub Environment, GitHub App key file-mounted, CLI group (`dashboard status/deploy/logs`). Added `apps/vpn/` — WireGuard egress box on **AWS Lightsail** (`eu-west-1`), first AWS-backed deployable; native `wg-quick`/systemd, no Docker; provisioned via `@aws-sdk/client-lightsail`; `deploy-vpn.yaml`, `vpn` Environment, CLI group (`vpn status/deploy/logs/client add\|list\|remove`). Now **16 workflows** total (added deploy-dashboard, deploy-vpn, `codeql.yaml` — CodeQL JS/TS analysis). `deploy.yaml` orchestrator now fans out to 6 per-app deploy workflows. CLI v0.9.17 → v0.12.2. Fro Bot agent v0.59.0 → v0.71.0 (SHA `9b89fb3`). Gateway upstream pin v0.57.0 → v0.69.0. CLIProxyAPI v7.1.56 → v7.2.20. Root docs `ARCHITECTURE.md` + `STRUCTURE.md` added. ESLint 10.4.0 → 10.5.0, lint-staged 16 → 17, Prettier 3.8.3 → 3.8.4. |
| 2026-06-09 | `9ce50f4` | **New app: Umami analytics.** Added `apps/umami/` — self-hosted Umami at `metrics.fro.bot`, 3-service Docker Compose (umami 3.1.0 + postgres 15-alpine + caddy 2.11.3-alpine), `deploy-umami.yaml` workflow, `umami` GitHub Environment, new CLI command group (`umami status/deploy/host/logs`). Now 13 workflows total. CLI v0.7.0 → v0.9.17. Fro Bot agent v0.44.3 → v0.59.0 (SHA `feb5365`). Gateway upstream daemon pin v0.44.2 → v0.57.0 (#466, `daily_digest` presence event). CLIProxyAPI v6.x → v7.1.56 (major version; v7.1.54/55 reverted #463 for health check regression, v7.1.56 stable). CLIProxy deploy healthcheck moved to Caddy endpoint for Debian-image compat (#469). Renovate config bumped `marcusrbrown/renovate-config#5.2.1`. Gateway secrets contract expanded (added GitHub App credentials, workspace OpenCode secrets, presence channel secrets). `OMO_PROVIDERS` removed from repo secrets; `WORKSPACE_OPENCODE_TOKEN/AUTH/MODEL/CONFIG` and `GH_APP_ID/PRIVATE_KEY`, `GATEWAY_TRIGGER_ROLE_ID`, `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_PRESENCE_CHANNEL_ID` added. Provisioning management key now written to a 0600 file instead of stdout (#453). |
