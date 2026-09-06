---
type: repo
title: marcusrbrown/infra
created: 2026-04-18
updated: 2026-09-06
node_id: R_kgDOR4g8TA
sources:
  - url: https://github.com/marcusrbrown/infra
    sha: ac34a60e53bf0f6c5871116488978385896f7cd0
    accessed: 2026-09-06
  - url: https://github.com/marcusrbrown/infra
    sha: d276d935c6ca0f3507079103ba5cd7ffb0f84cde
    accessed: 2026-08-16
  - url: https://github.com/marcusrbrown/infra
    sha: e0e325205da0549708c07bb84409cde50f4f3634
    accessed: 2026-07-15
  - url: https://github.com/marcusrbrown/infra
    sha: 390cb5fafe9d4d1fceecd4976c3e2abc29c8aa11
    accessed: 2026-07-01
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
tags:
  - bun
  - deploy
  - github-actions
  - infra
  - keeweb
  - cliproxy
  - gateway
  - umami
  - dashboard
  - vpn
  - wireguard
  - aws-lightsail
  - aws-s3
  - aws-iam
  - mcp
  - cli
  - typescript
  - conventions
  - discord
  - analytics
  - codeql
  - broker
  - oidc
  - credential-broker
  - s3-storage-provisioner
  - auth-monitor
  - opencode
  - discord-mcp
  - slim-clonedeps
  - harden-runner
  - egress-policy
  - stranded-deploy
  - version-ceiling
  - body-marker
  - rolling-issue
  - package-smoke
  - release-alert
aliases:
  - infra
related:
  - marcusrbrown--ha-config
  - marcusrbrown--systematic
  - fro-bot--agent
  - fro-bot--dashboard
---

# marcusrbrown/infra

Bun workspace monorepo for Marcus R. Brown's personal infrastructure. Hosts KeeWeb deploy automation, the CLIProxyAPI proxy (routes Fro Bot agents to Claude via the Claude Code OAuth subscription), the [[fro-bot--agent]] Discord gateway deployment, self-hosted Umami analytics, the [[fro-bot--dashboard]] operator dashboard deploy, a WireGuard VPN egress box on AWS Lightsail, an OIDC-authenticated credential broker (short-lived off-runner cliproxy keys for the harness pipeline), an AWS S3 durable-storage provisioner for `fro-bot/agent` session state (OIDC → STS, per-repo least-privilege IAM roles), and an operational CLI with MCP bridge.

## Overview

- **Purpose:** Deploy automation, operational CLI, and infrastructure tooling
- **Default branch:** `main`
- **Created:** 2026-04-03
- **Last push:** 2026-09-06 (`ac34a60`, `chore(deps): update fro-bot/agent to v0.109.3 (#1282)`); prior surveys 2026-08-16 (`d276d93`), 2026-07-15 (`e0e3252`)
- **Runtime:** Bun v1.0+
- **Workspace package:** root is `@marcusrbrown/infra-workspace` (private); the published CLI is `@marcusrbrown/infra` (in `packages/cli/`)
- **Published package:** `@marcusrbrown/infra` **v0.22.0** on npm (published 2026-08-28; up from v0.15.4 at the prior survey — 0.19.0/0.20.0/0.21.0/0.22.0 all shipped in the 08-23 → 08-28 window)
- **Open items (2026-09-06):** **17** — 16 `fro-bot`-authored issues + the `mrbro-bot[bot]` Dependency Dashboard, and **zero open PRs**
- **Stars:** 3 (steady across five surveys) · forks 0
- **Topics:** `bun`, `deploy`, `github-actions`, `infra`, `keeweb`
- **License:** MIT
- **Visibility:** public · `node_id` `R_kgDOR4g8TA` · repo id `1200110668`

## 2026-09-06 Survey — Findings

Sixth survey (HEAD `ac34a60`). **No new apps** — still 8 apps, 2 packages. Workflows **18 → 19** (new `release-alert.yaml`). The delta is not surface area; it is that the repo's instrumentation matured to the point where it started reporting on its own operator, and five of its own gates are now measurably stalled.

### 1. `fro-bot.yaml` split into two jobs — the storage capability boundary went from documented to enforced

The 2026-08-16 page recorded an "Environment gating (documented invariant)": content-triggered jobs must never reach `id-token: write`. That invariant is now **implemented in this repo's own workflow**, which is also the first observed consumer of the `apps/agent` provisioner it ships. One file, two jobs, disjoint capabilities:

| | `fro-bot-content` (`name: Fro Bot`) | `fro-bot-storage` (`name: Fro Bot (storage)`) |
| --- | --- | --- |
| Triggers | PR events, `issues`, `@fro-bot` comments (OWNER/MEMBER/COLLABORATOR) | `schedule` **or** `workflow_dispatch` on `refs/heads/main` only |
| Prompt | `PR_REVIEW_PROMPT` (or none) | `SCHEDULE_PROMPT` / dispatch prompt |
| `permissions` | `contents: read`, `pull-requests: read` | `contents: read`, **`id-token: write`** |
| Environment | none | `fro-bot-storage` |
| AWS | none | `aws-actions/configure-aws-credentials@v6.2.4`, `role-duration-seconds: 7200` |
| Agent inputs | `brokered-push-extra-paths` | `s3-backup: true` + the five `FRO_BOT_S3_*` vars |
| Egress | default | `step-security/harden-runner` `egress-policy: block` + explicit allowlist |

Three things worth keeping:

- **The privileged job is the autoheal, not the review.** Content-triggered work runs unprivileged; the daily mutating pass is the one holding OIDC. That inverts the usual instinct and is correct — content triggers are the attacker-reachable surface.
- **`fro-bot-storage` is the only environment in the repo without `required_reviewers`.** All seven deploy environments (`keeweb`, `cliproxy`, `gateway`, `umami`, `dashboard`, `vpn`, `broker`) carry `required_reviewers` + `branch_policy`; `fro-bot-storage` carries `branch_policy` alone. Necessarily so — a daily cron cannot wait for a human — but it means the environment is a *branch* gate, not a *human* gate, and the job-level `if:` is doing the real work.
- **Fork-PR TOCTOU is handled explicitly.** Checkout always takes the default ref; a separate `Resolve same-repo PR-head ref` step calls the API and only emits a `trusted-head-sha` when `head.repo.full_name` equals the repository. The inline comment names the exact gap: an `issue_comment` on a fork PR exposes the PR only at `github.event.issue.pull_request`, so the job-level fork guard (which reads `github.event.pull_request`) does not fire. Server-verified head resolution instead of trusting the event payload.

Two loose threads:

- **The `harden-runner` allowlist is templated from repository variables.** Entries interpolate `vars.FRO_BOT_S3_REGION` / `vars.FRO_BOT_S3_BUCKET`. If either variable is unset the entries collapse to malformed hosts (`sts..amazonaws.com:443`, `.s3..amazonaws.com:443`) and the job fails as an egress denial rather than a missing-variable error — fail-closed, but the diagnostic points at the network instead of at configuration.
- **The `brokered-push-extra-paths` comment contradicts its own list.** The comment reads *"deploy-critical files under `apps/` remain intentionally excluded"*, and the list then enumerates `apps/<name>/src` for all eight apps — which is exactly where every app's `deploy.ts` lives (root `package.json`: `"deploy:broker": "bun run apps/broker/src/deploy.ts"`). The stated invariant and the encoded one disagree. Not an escalation by itself (brokered push is still mediated), but the comment is now misleading about what the allowlist covers.

### 2. The reconciliation contract that cannot see its own reports

`fro-bot.yaml` carries a ~45-line **SINGLE-REPORT RECONCILIATION CONTRACT** whose clause (g) states the goal plainly: *"End state: exactly one open trusted managed report."* The prompt restates it a second time at the bottom of the output-format block. Observed state on 2026-09-06: **ten open `Daily Autohealing Report` issues** (#1204 08-27, #1212 08-28, #1220 08-29, #1235 08-31, #1242 09-01, #1250 09-02, #1259 09-03, #1264 09-04, #1272 09-05, #1279 09-06).

The mechanism is exact, and it is not a listing failure — clause (c) is already hardened against those (*"Do not request `body`, rely on GitHub search indexing, or accept a default page size"*). It is the **identity predicate**. Clause (b):

> An issue can become managed only when `author.login` is exactly `fro-bot`, label `autoheal-report` is present, AND its body contains `<!-- fro-bot:autoheal-report:v1 -->`.

All ten reports carry the correct body marker as line 1. **Only the newest (#1279) carries the label.** The other nine have no labels at all. So nine issues the agent itself authored, each stamped with the agent's own marker, are classified as *untrusted title-prefix collisions* — and clause (g) says untrusted collisions "remain untouched." Every run truthfully reports exactly one trusted managed report open, and the population grows by one per day.

The contract worked before: **18 issues have ever carried the `autoheal-report` label, 17 of them closed**, running cleanly through #1190 (2026-08-25). The label then goes missing for the 08-27 → 09-05 window and returns on 09-06. Most probable mechanism (inference, not confirmed): clause (c) instructs the agent to *"Ensure label `autoheal-report` exists"* before filtering, and issue creation with a not-yet-existing label drops the label while still creating the issue — the create succeeds, the identity token does not attach, and there is **no backfill path** in the contract for its own prior output.

The trust boundary itself is sound reasoning: a label is write-gated by triage permission, so requiring it defends against a third party planting a lookalike issue with a forged marker. The cost is that **the conjunction's recall is set by its weakest, most mutable key** — a label applied as a side effect — while its strongest key (a marker written atomically as byte 0 of a body the agent is already composing) is relegated to a confirmation step it never reaches.

The same defect exists a second time, worse. Category 10's Upstream Modernization Watch has its own trust triple keyed on label `autoheal-upstream-watch` — **that label does not exist in the repository at all**, and its only issue (#1162, 2026-08-23) is open and unlabelled. That contract can never recognise a managed artifact.

### 3. The PR queue is empty because the backlog moved downstream

**Zero open PRs.** Every Renovate PR automerges. On the fleet's usual axis this reads as the healthiest queue on the wiki — [[marcusrbrown--dev-like]]'s clean-queue control case, reproduced on a far larger surface.

It is not. The queue changed units. Five of the sixteen open `fro-bot` issues are **stranded-deploy findings**:

| Issue | Since | Subject |
| --- | --- | --- |
| #1234 | 2026-08-30T18:08Z | `dashboard`: manual deploy run stuck in `waiting` |
| #1249 | 2026-09-01T12:44Z | `cliproxy`: deploy stuck on approval gate, v7.2.147 bump undeployed |
| #1258 | router outage #1227 | `gateway` + `vpn`: 3 dependency bumps stranded on `main`, never redeployed |
| #1277 | 2026-09-05T20:33Z | `gateway` + `vpn`: 2 dependency bumps stranded on `main`, never redeployed |
| #1278 | 2026-09-05T07:24Z | `broker`: deploy stuck on approval gate, dependency bump undeployed |

This is structural, not incidental. Automerge to `main` fires the path-filtered per-app deploy workflow; that workflow enters a `required_reviewers` environment; nobody approves; the bump is committed but never reaches the droplet. **Frictionless merge plus a human-gated deploy produces silent divergence between the repository and production** — and the cleaner the PR queue, the faster the divergence accumulates. The correction to the fleet narrative: a clean PR queue does not mean the gate was removed, only that it was relocated to where nobody was counting.

The repo already knows this the hard way. The autoheal prompt's **STRANDED-DEPLOY CHECK** opens with the incident: *"a umami image bump landed on main but the deploy run was cancelled at its approval gate, so the app ran the old version for ~3 weeks. A cancelled run is NOT a failed run, so 'if it failed' misses it."* Category 7 now evaluates every app's latest deploy on `conclusion != success` with supersede-awareness (a later successful deploy self-heals the finding), and is explicitly **reporting-only — do not redeploy**. The daemon detects the stall and is forbidden from clearing it. Five open issues are the result: correct behaviour, accumulating.

### 4. Four verification-gated version ceilings, all stalled

`.github/renovate.json5` (preset `#5.2.13`) holds four `allowedVersions` ceilings, each with a written rationale — an unusually disciplined practice, and every one of them is currently parked:

| Package | Ceiling | Lift condition | State at survey |
| --- | --- | --- | --- |
| `caddy` | `<2.12.0` | manual `linux/amd64` manifest verification, last done **2026-07-13** | ~8 weeks, deployed at `2.11.4-alpine` |
| `postgres` | `<16` | executed cutover per `docs/plans/2026-06-01-001-feat-umami-postgres-major-upgrade-plan.md` (PG18 refuses a PG15 data dir; password baked into the named volume) | ~3 months, runbook unexecuted |
| `fro-bot/agent` (gateway `upstream.json`) | `<0.94.0` | source-contract verification pass — "verify no new boot-required secrets before the ceiling moves" | pin **v0.93.1**, upstream **v0.109.3** — ~16 minor series |
| `typescript` | `<7` | `typescript-eslint#10940` lands TS 7 support | external unblock; legitimately waiting |

Three of the four wait on a **human verification pass with no recurring trigger**. And the ownership is circular: Renovate is ceiling-gated by policy, and category 10 (Upstream Modernization Watch) is instructed it *"MUST NOT bump pinned versions (Renovate-owned)."* Nothing in the repo is responsible for lifting a ceiling.

This **corrects the prior page's reading** of the gateway pin. 2026-08-16 recorded that "the deployed daemon and the CI review action are versioned independently," which framed the gap as incidental. It is deliberate: an explicit, commented ceiling with a stated lift-condition. The correction cuts both ways — the gap is better-reasoned than recorded, and larger than reported (6 minors then, ~16 now, widening at roughly the upstream release rate).

The distinction against [[marcusrbrown--esphome-life]] is worth holding: there a pin froze *accidentally* (`versioning: loose` + calver defeating Renovate's major detection); here it froze *by design*. Same observable, opposite cause. **A ceiling with a written lift-condition is a policy; without a scheduled re-evaluation it decays into a freeze, and from the outside the two are indistinguishable.**

### 5. The repo gets the conclusion predicate right in one file and wrong in the next

New workflow `release-alert.yaml` (`workflow_run` on `Release`, `types: [completed]`) opens or comments on a marker-deduplicated `release-publish-failure` issue — the post-merge liveness assertion that the merge gate structurally cannot provide. Sound construction: lazy label creation, an HTML-comment marker (`<!-- release-publish-failure:v1 -->`) rather than title matching, `permissions: issues: write` only, and a global `concurrency: release-alert` group with `cancel-in-progress: false` that serialises the read-modify-write so two failures cannot race into duplicate issues.

Its gate is `if: github.event.workflow_run.conclusion == 'failure'`.

That is precisely the predicate this repo's own autoheal prompt was rewritten to stop using, after a cancelled deploy cost it three weeks of stale production. A `Release` run that is `cancelled`, `timed_out`, or `action_required` posts nothing. And `ci.yaml`, in the same repository, gets it right — the `ci` gate job runs `if: always()` and asserts `needs.<job>.result != "success"` for all four jobs, which catches cancelled and skipped alike.

**The lesson is not that the repo doesn't know better. It demonstrably does, in two other files. The lesson is that a conclusion-predicate invariant learned in one file does not propagate to the next file written.** Corollary observation: `release-alert.yaml` has fired zero times (every run to date `skipped`, because Release keeps succeeding), and unlike `cliproxy-auth-monitor.yaml` — which ships owner-only `synthetic-dead` / `synthetic-healthy` dispatch modes precisely so the alert path can prove it still works — the release alert has **no self-test**. Two alerting paths in one repo; one can demonstrate liveness, the other cannot.

### 6. `package-smoke` — the publish contract, shifted left

`ci.yaml` gained a fourth job, **`Package smoke`**, now in the `ci` gate's `needs`. It builds the CLI, `bun pm pack`s it, and then verifies the *tarball* rather than the repo:

- `dist/` present; the content-hashed `known_hosts` asset present.
- No `src/` files except the one intentionally source-exported path (`src/commands/vpn/peers.ts`, backing the `./vpn/peers` export).
- Published `package.json` has no `@marcusrbrown/infra-shared` in runtime `dependencies` (comment: *"0.10.0 regression"*) and no `workspace:` specifiers.
- **Clean-room install**: `bun add` the tarball into `mktemp -d`, run `infra --help`, then run `infra gateway status` and assert (a) it produced output at all — so a crash before the check cannot false-pass — and (b) the fail-closed string `Pinned SSH known_hosts file not found` is **absent**.
- `dist/cli.js` contains no `import`/`require` specifier for `infra-shared` (i.e. the build actually inlined it), matched on a call-shaped regex rather than a bare string, because the inlined `package.json` data legitimately contains the name.

This is the pre-merge half of the publish-liveness problem catalogued from [[marcusrbrown--systematic]]: rather than discovering a broken `files` field or a leaked workspace protocol at publish time, the packaging contract is asserted as a required check. Note the assertion discipline — negative canaries plus a did-it-even-run guard — which is the standard defence against grep-based checks that pass because nothing ran.

**Supersedes** the prior page's CI description: test failures now **do** block. The gate's `needs` is `[lint, type-check, test, package-smoke]` and it fails on any `result != "success"`.

### 7. A double-tagged upstream that froze a pin for four months

`renovate.json5` gained a second custom manager with a documented root cause worth generalising:

> `bfra-me/.github` tags the same commits twice: `v4.16.x` for the repo and `renovate-changesets@x.y.z` for the action. The built-in github-actions manager resolves only the repo tags, so **this pin sat at 0.2.31 for four months while 0.2.32 shipped**.

The fix is `extractVersionTemplate: '^renovate-changesets@(?<version>.+)$'` to constrain candidates to the correct tag family, plus capturing `currentDigest` and `currentValue` in one `matchStrings` so the SHA and its `# vX.Y.Z` comment move together. This is a fourth distinct instance of the ecosystem's "Renovate is tracking the wrong target" class — after the mis-pathed `uses:` in [[marcusrbrown--esphome-life]], the Alpine-branch-encoding `repology` manager in [[docker-containers]], and the never-advancing settings-sync ref in [[bfra-me--works]]. Same end state each time: a dependency that looks tracked and is frozen.

### 8. Documentation drift

`README.md`'s package table lists six apps — `keeweb`, `cliproxy`, `gateway`, `umami`, `dashboard`, `vpn` — plus `packages/cli`. The repo has **eight**: `apps/broker` (added 2026-07-01) and `apps/agent` (added 2026-08-16) appear in neither the table nor the Overview prose. The broker has been missing for ~9 weeks across three surveys. Category 3 (Code Quality & Repo Hygiene) runs daily; the drift persists — same shape as [[marcusrbrown--marcusrbrown-com]], where an autoheal check reported `AGENTS.md accuracy ✅ Current` while the Stack line was three majors stale, because the check read structure and not content.

### Daemon health

Fro Bot daily schedule: **16/20 success** over the last 20 scheduled runs; failures on 08-20, 08-23, 08-26, 08-30; the last seven consecutive passes are green. `cliproxy-auth-monitor` is firing on cadence and green. All 19 workflows `active` — no `disabled_inactivity`. The `Release` workflow runs and succeeds on every push (publishing only when changesets exist), which is why `release-alert` has never fired.

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
| `apps/broker/`        | OIDC-authenticated credential broker (`broker.fro.bot`); mints short-lived cliproxy keys for CI runs |
| `apps/agent/`         | AWS S3 durable-storage provisioner for `fro-bot/agent` session state (OIDC → STS, per-repo IAM roles); operator-run, no deployed service (added 2026-08-16) |
| `packages/cli/`       | `@marcusrbrown/infra` CLI — health checks, deploy triggers, MCP bridge |
| `packages/shared/`    | Shared TypeScript helpers for DigitalOcean droplet provisioning (private) |
| `docs/brainstorms/`   | Requirements and brainstorm documents                                  |
| `docs/plans/`         | Implementation plans                                                   |
| `docs/solutions/`     | Compound learning docs (solved problems with YAML frontmatter)         |
| `docs/runbooks/`      | Operator day-2 procedures (e.g., Discord token lifecycle)              |
| `.agents/skills/`     | Agent skill context packets (goke)                                     |
| `.opencode/commands/` | OpenCode slash commands                                                |
| `.changeset/`         | Changesets config for versioning                                       |
| `.slim/`              | `clonedeps.json` vendoring manifest (pins upstream source clones for local inspection) |
| `patches/`            | Bun `patchedDependencies` patches (currently `@changesets/get-github-info@0.6.0`) |
| `docs/ideation/`      | Early ideation notes (added by 2026-07-15; e.g., CLI/KeeWeb testing ideation) |

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

**First observed consumer + pending retention-boundary dependency (noted 2026-08-01 via the [[marcusrbrown--mrbro-dev]] survey):** the mrbro.dev portfolio added a privacy-preserving analytics subsystem (#256/#257) that points at this `metrics.fro.bot` instance as its collector. That work is **activation-gated on an infra-side retention control**: mrbro.dev's `docs/analytics.md` runbook states this Umami instance currently "retains data indefinitely," and its Go/No-Go matrix forbids production activation until a **version-controlled `marcusrbrown/infra` evidence artifact** — pinned to the exact deployed infra commit and Umami version — proves pageview/custom-interaction records are retained ≤13 months and that monthly session parent records are deleted after their last retained child expires. This implies a future infra deliverable (a retention policy in the `apps/umami` compose/config layer plus version-controlled evidence) that is not yet observed in the infra tree as of the last infra survey (2026-07-15, `e0e3252`, Umami steady `3.2.0`). Recorded here so the cross-repo dependency is discoverable from the processor side; a direct infra re-survey should confirm whether the retention control has landed.

#### Fro Bot Dashboard (`apps/dashboard`)

Fro Bot operator dashboard at `dashboard.fro.bot`, added post-2026-06-09 survey. Two-service Docker Compose stack (dashboard + caddy) on a dedicated DigitalOcean droplet (`s-1vcpu-1gb`, `docker-20-04`). The dashboard image is the **upstream released image** `ghcr.io/fro-bot/dashboard` (see [[fro-bot--dashboard]]), pinned by tag + digest in `docker-compose.yaml` (currently `2026.06.16@sha256:73b05ae…`). No on-droplet build.

- **Digest verification invariant:** deploy pulls the digest-pinned image, brings up the health-gated `dashboard` service, then verifies the running image's `RepoDigests` against the compose-pinned digest before bringing up `caddy`. A public HTTPS probe to `/api/healthz` confirms end-to-end reachability.
- **GitHub App private key is file-mounted, never an env var** — uploaded via SSH stdin to `/opt/dashboard/config/github-app.pem` (0600), mounted at `/run/secrets/github-app.pem`, read via `DASHBOARD_GITHUB_APP_KEY_FILE`
- Secret materialization via SSH stdin (`/opt/dashboard/.env`) — never argv; DNS preflight before deploy
- GitHub OAuth App login gated to a single operator (`DASHBOARD_OPERATOR_LOGIN`)
- Rollback runbook: `docs/runbooks/dashboard-released-image-rollback.md` (revert to a prior image digest)
- Anti-patterns: never `docker compose down -v` (destroys `caddy_data` TLS volume); never add `--build` (no on-droplet builds supported)
- **Upstream dispatch (observed from dashboard survey 2026-06-26):** [[fro-bot--dashboard]]'s `release.yaml` now best-effort `gh workflow run`s this repo's `deploy-dashboard.yaml` (inputs `version` + `digest`) after each CalVer GHCR release, using a short-lived token from an infra-scoped GitHub App (`actions:write` on `marcusrbrown/infra`). The dispatch only reaches the operator-approval gate here; it does not bypass it. (Survey-side detail; re-confirm against infra source on the next infra survey.)

#### WireGuard VPN (`apps/vpn`)

WireGuard egress box at a static IP on **AWS Lightsail** (`eu-west-1`, Ireland) — the **first AWS-backed deployable** in this repo. Native `wg-quick@wg0` + systemd, no Docker. Added post-2026-06-09 survey.

- Provisioned via `@aws-sdk/client-lightsail` (`3.1069.0`): creates the Lightsail instance, allocates a static IP (the durable client-facing endpoint), sets the exact firewall ruleset (SSH 22 + UDP 51820), installs WireGuard, pins the IP host key. Refuses to re-run against an existing instance without `--force`.
- **Deploy is SSH-only** — no AWS API calls. AWS credentials are provisioning-only (operator-local, not in the `vpn` Environment).
- **Peer roster:** `VPN_PEERS` GitHub Environment secret (JSON), mirrored locally to gitignored `apps/vpn/config/peers.json`; client `.conf` files written to gitignored `apps/vpn/clients/`. Auto-synced by `vpn client add/remove`.
- **Server-key invariants:** `--force-server-key` rotates the server key and invalidates all client configs; reprovisioning (fresh disk) destroys the server key (all clients fail handshake). Recovery paths in `apps/vpn/AGENTS.md`; runbook `docs/runbooks/vpn-egress-box.md` (bootstrap ordering, reprovision recovery, client onboarding, old-EC2 teardown).
- **Host validation:** `validateVpnHost` rejects `-`-prefixed values (SSH treats them as flags) before any SSH invocation — same pattern as `validateGatewayHost`.
- Deploy never reads the server private key locally — reads back only `server.pub`.

#### Credential Broker (`apps/broker`)

OIDC-authenticated credential broker at `broker.fro.bot`, added post-2026-06-19 survey. Two-service Docker Compose stack (Caddy + a Bun HTTP service on `:3000`) on a dedicated DigitalOcean droplet (`s-1vcpu-1gb`, `nyc1`). Its job: exchange a GitHub Actions OIDC token for a **short-lived, revocable cliproxy API key** so the durable provider key never lands on a CI runner. This is the credential half of the [[fro-bot--agent]] harness pipeline — a shift from static per-repo cliproxy keys toward per-run minted keys.

- **Mint flow:** a `fro-bot/agent` integrate job requests a GitHub OIDC token for the broker audience, POSTs it to `https://broker.fro.bot/v1/mint`. The broker verifies the JWT (`jose` JWKS, RS256 only, GitHub issuer, broker-minted `aud`, `exp`/`nbf`/`jti` replay denylist keyed `(jti, iss)`), evaluates claims against the code-owned `BROKER_TRUST_POLICY` allowlist (`repository_id`, `repository_owner_id`, `workflow_ref`, `ref`, `ref_type`, `ref_protected`, `event_name`, `runner_environment`, `repository_visibility`), then mints a `ghact-<run_id>-<random>` key in cliproxy via the management API (GET-modify-write + read-back, single-flight lock) and returns an OpenCode `auth.json` payload. The durable cliproxy management key stays inside the broker boundary.
- **Revocation is sweeper-only** — there is no run-end revoke endpoint. A **TTL sweep** (60s tick) revokes live entries past their 30-minute `expiresAt`; a **reconcile sweep** (5 min tick) lists cliproxy `api-keys` and deletes any `ghact-`-prefixed key not in the live set (recovers from a broker restart). Reconcile **never touches non-`ghact-` keys**.
- **Startup gate:** on boot the broker runs a reconcile sweep before accepting `/v1/mint`; `/healthz` serves during startup but `/v1/mint` returns 503 until the startup reconcile completes, bounding the stale-key window after a restart.
- **Broker→cliproxy is public-internet** — the broker runs on its own droplet (not co-located with cliproxy) and reaches cliproxy via `https://cliproxy.fro.bot`. The DO NAT-loopback hairpin concern does not apply (that only affects same-host container-to-container calls).
- **Bundle-based deploy:** `bun build src/main.ts --target bun --outfile dist/main.js` produces a self-contained ~300KB bundle (`jose` inlined via Web Crypto) that is mounted read-only into the `oven/bun:1.3.14-alpine` container. `dist/main.js` is gitignored — a deploy-time artifact, never committed. No source bind-mount, no `node_modules` on the droplet.
- **Deploy flow:** preflight (GET cliproxy `/v0/management/api-keys` with the management key; abort on 401/403 key drift or network failure before any compose change) → build → SCP compose + Caddyfile + bundle to `/opt/broker/` → write `.env` via SSH stdin → `docker compose pull && up -d --wait --wait-timeout 90` → GET `https://<BROKER_HOST>/healthz`. All SSH calls share one ControlPath socket (avoids UFW rate-limit at 6 conns/30s).
- **Caddyfile exposes `/v1/mint` and `/healthz` only** — all other paths 404. No public surface beyond mint + health.
- **Audit events** are structured JSON lines to stdout (`type: broker-audit`): decisions `mint` / `deny` / `deny-ratelimit` / `revoke` / `error`, carrying `srcIp`, `runId`, `jti`, `repositoryId`, `workflowRef` — **never** token bytes, minted key value, OIDC bearer, or management key. `Authorization` header always redacted before logging.
- **Host validation:** `validateBrokerHost` rejects `-`-prefixed / out-of-alphabet values before any SSH argv — same pattern as `validateGatewayHost`/`validateVpnHost`.
- **Security property delivered:** short-lived + revocable + off-runner. cliproxy has no per-key capability surface, so a minted key is **fungible with the durable key for its TTL** — in-run abuse during the TTL window is a documented non-goal (Pattern B / egress containment deferred). Never scale the broker horizontally: the single-flight lock is valid only because there is exactly one instance.
- **Cross-repo dependency:** `BROKER_TRUST_POLICY` in `apps/broker/src/policy.ts` ships with **placeholder** `repository_id`/`repository_owner_id`/`workflow_ref` values that must be replaced with real `fro-bot/agent` numeric IDs before deploy (tracked in `fro-bot/agent#1060`). The consuming-side integration (OIDC token request, broker call, `auth.json` injection) lands in [[fro-bot--agent]].

#### Agent S3 Storage Provisioner (`apps/agent`)

AWS S3 durable-storage provisioner for `fro-bot/agent` session state, added 2026-08-16 (HEAD `d276d93`). Private package `@marcusrbrown/infra-agent` — an **operator-run AWS provisioner, not a deployed service**: it has a `provision` script (`bun run provision:agent`) but **no `deploy` script and no `deploy-agent.yaml` workflow**. Its job is to stand up the durable-storage substrate so `fro-bot/agent` runs can persist OpenCode session state to S3 via native GitHub OIDC → AWS STS, with **no static AWS credential ever written to a consumer repository**. This is the *storage* half of the harness pipeline, complementing the [[fro-bot--agent]] credential half served by `apps/broker`. It is the **second AWS-backed component** (after the VPN Lightsail box) but the first to touch S3 + IAM.

- **What it provisions:** a dedicated S3 bucket (separate from the gateway bucket), the account-level `token.actions.githubusercontent.com` OIDC provider (append-only — adds the `sts.amazonaws.com` audience without recreating or changing existing thumbprints/audiences), and **one least-privilege IAM role + inline policy per consumer repository**. Each repo gets a prefix-scoped policy: the session prefix carries an **explicit delete deny**, and the coordination lock is a **separate exact object ARN** (`.../coordination/OWNER/REPO/locks/repo.json`).
- **Fail-closed key layout:** `src/key-layout.ts` version-pins the S3 session + coordination-lock paths against a `KEY_LAYOUT_VERSION` (currently `fro-bot/agent@v0.96.0`). Unknown or unverified action refs are **refused rather than widening IAM access** — the provisioner will not admit a layout it cannot verify.
- **Dedicated provisioning credentials:** accepts `AGENT_AWS_ACCESS_KEY_ID`/`AGENT_AWS_SECRET_ACCESS_KEY` (+ optional `AGENT_AWS_SESSION_TOKEN`) and **deliberately ignores ambient `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`** — the same operator-local-only credential discipline as the VPN box. These values must never be copied into a GitHub Environment or committed.
- **Convergence + readback + handoff manifest:** `server/provision.ts` discovers-or-creates each resource, applies the managed S3 controls, then readback-verifies. Managed drift is **reported and halts by default**; `--force` proceeds only after review, but **foreign/shared-resource drift is a hard stop even with `--force`**. On success it emits a single compact JSON **handoff manifest** (bucket, region, expected owner, `s3_prefix`, `session_prefix`, `lock_key`, `role_name`/`role_arn`, `policy_name`, `key_layout_version`, `oidc_provider_arn`) — identifiers and resource names only, **never credential bytes**.
- **CLI wiring (`agent` command group):** `agent storage --repo OWNER/REPO --manifest handoff.json` verifies live repository identity, the provisioned IAM role + S3 bucket, the repo OIDC subject, and the effective workflow/environment contract, then writes only the **five non-secret `FRO_BOT_S3_*` repository variables** (`FRO_BOT_S3_ROLE_TO_ASSUME`, `FRO_BOT_S3_BUCKET`, `FRO_BOT_S3_REGION`, `FRO_BOT_S3_PREFIX`, `FRO_BOT_S3_EXPECTED_BUCKET_OWNER`). A failed workflow check emits a **pasteable diff and never edits the consumer workflow**. A teardown command removes those variables and invokes the repository-scoped resource teardown.
- **Environment gating (documented invariant):** content-triggered jobs must not reach the storage job — **only the protected `fro-bot-storage` environment on scheduled or main-branch dispatched runs may receive `id-token: write`**.

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
| `infra broker status`  | GET `/healthz` on `broker.fro.bot` — HTTP reachability (MCP-exposed, read-only) |
| `infra broker deploy`  | Trigger Deploy Broker workflow (remote, default) or `--local` (runs `apps/broker/src/deploy.ts`) |
| `infra broker logs [--tail N] [--service broker]` | Stream broker service logs over SSH; may contain run identities (CLI-only) |
| `infra agent setup`     | Model-credential onboarding for a consumer repo (absorbs the former `cliproxy setup`; same `--repo`/`--harness`/`--key`/`--providers`/`--model`/`--force`/`--dry-run`/`--verify-smoke`/`--ack-key-reuse` options). Does **not** create AWS resources or modify the consumer workflow |
| `infra agent storage --repo OWNER/REPO --manifest FILE` | Verify provisioned IAM role/S3 bucket/OIDC subject/workflow contract, then write the 5 non-secret `FRO_BOT_S3_*` repo variables (AWS readback needs `AGENT_AWS_*`; ambient `AWS_*` ignored) |
| `infra agent storage` teardown | Remove the 5 `FRO_BOT_S3_*` variables + tear down repository-scoped AWS resources |
| `infra mcp`             | Start stdio MCP server exposing all CLI commands as tools (read-only allowlist) |

The MCP bridge (`infra mcp`) lets coding agents (Fro Bot, Copilot) call commands programmatically via the [Model Context Protocol](https://modelcontextprotocol.io).

### MCP Permission Backstop (`opencode.jsonc`)

Observed post-2026-07-01: a root `opencode.jsonc` wires two local MCP servers and a defense-in-depth permission block for agents driving this repo:

- **`infra` MCP server** — `bun run packages/cli/src/cli.ts mcp`, enabled by default. Secrets are inherited from the subprocess env (Bun auto-loads repo-root `.env` locally; CI/harness inherits parent env) — **no secret values live in the config file**.
- **`discord` MCP server** — `saseq/discord-mcp:1.0.0` (a Spring Boot/JVM image) run via `docker run`, **disabled by default**. Notable operational details baked into the config as comments: the JVM cold start (~30s) forces `timeout: 60000` to beat opencode's default 30s connect timeout; secrets are sourced by a shell wrapper (`set -a; . ./.env`) that forwards only `DISCORD_TOKEN`/`DISCORD_GUILD_ID` via `-e` because opencode's `{env:VAR}` interpolation doesn't carry repo-root `.env` and Docker's `--env-file` chokes on the multi-line VPN PEM.
- **Two-layer tool gating.** The primary gate is the CLI's `MCP_ALLOWLIST` in `packages/cli/src/commands/mcp.ts` — sensitive commands are simply never registered as MCP tools. The `permission` block in `opencode.jsonc` is a **secondary backstop**: even if the allowlist were mistakenly re-expanded, opencode's native permission check `deny`s the 6 infra mutating/sensitive tools (`cliproxy keys add/remove`, `cliproxy config get/set`, `gateway backup`) plus VPN (`vpn deploy/logs/client add|list|remove`) and broker (`broker deploy/logs`) tool ids. Tool ids use opencode's `<server>_<tool>` form (`infra_cliproxy_keys_add`, etc.) — **not** the `mcp_Infra_*` alias the Anthropic-auth plugin surfaces. Both layers are asserted by `packages/cli/src/conventions.test.ts`.
- **Discord tool policy** — baseline `discord_*: ask` (every Discord tool prompts, nothing auto-runs), with explicit `deny` on ~19 irreversible actions (member ban/kick/timeout/move, channel/category/message/role/webhook/emoji/invite/event deletions). opencode resolves the **last** matching rule, so the wildcard baseline is listed first and the explicit denies win.

## Vendored Upstream Sources (`.slim/clonedeps.json`)

The `.slim/clonedeps.json` manifest pins upstream repositories cloned for local inspection (not runtime deps). As of the manifest's `2026-06-02` timestamp it vendors **opencode** (`anomalyco/opencode` @ `v1.15.13`) into `.slim/clonedeps/repos/anomalyco__opencode`, with a stated reason: inspecting opencode's MCP tool registration + permission enforcement to correctly gate sensitive infra MCP tools — because empirically both `tools:false` and `permission:deny` had failed to fully suppress them. This is the source-of-truth for the `opencode.jsonc` two-layer gating design above.

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
| Deploy Broker | `deploy-broker.yaml` | Dispatch, `workflow_call` | Deploy OIDC credential broker (path-filtered, `broker` environment) |
| Release | `release.yaml` | Push to `main`, dispatch | Version and publish `@marcusrbrown/infra` via Changesets |
| Release Alert | `release-alert.yaml` | `workflow_run` on `Release` (`completed`) | **Added 2026-09-06 survey window.** Post-merge liveness alert: on a failed Release run, opens or comments on a marker-deduplicated (`<!-- release-publish-failure:v1 -->`) `release-publish-failure` issue. `permissions: issues: write` only; global `concurrency: release-alert` with `cancel-in-progress: false` serialises the read-modify-write. Gated on `conclusion == 'failure'` only — cancelled/timed-out Release runs are silent (see finding 5) |
| CLIProxy Auth Monitor | `cliproxy-auth-monitor.yaml` | Schedule (`7,22,37,52 * * * *` — every 15 min), dispatch | Probe CLIProxy's Anthropic auth health; on failure opens/updates a tracking issue + posts a Discord webhook. Dispatch supports `live` / `synthetic-dead` / `synthetic-healthy` validation modes (owner-only synthetics). Added 2026-08-16 |
| Renovate | `renovate.yaml` | Schedule, issue/PR edits, post-deploy | Automated dependency updates |
| Renovate Changesets | `renovate-changesets.yaml` | `pull_request_target` (Renovate PRs) | Auto-create changeset files for dependency updates |
| Fro Bot | `fro-bot.yaml` | PRs, @mentions, daily schedule, dispatch | AI code review and autohealing |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | Dispatch, changes to workflow file | Prepare environment for Copilot coding agent |
| Scorecard | `scorecard.yaml` | Weekly, push to `main` | OpenSSF security analysis |
| CodeQL | `codeql.yaml` | Push to `main`, PR, weekly (Wed 05:30 UTC) | CodeQL static analysis (`javascript-typescript` matrix); added post-2026-06-09 |
| Update Repo Settings | `update-repo-settings.yaml` | Daily, push to `main` | Sync repo settings from `.github/settings.yml` |

### CI Jobs (ci.yaml)

**Four** parallel jobs with a summary gate (updated 2026-09-06):

1. **Lint** — ESLint + Prettier formatting check (Node 24 pinned for ES2024 API compat)
2. **Type Check** — `bunx tsc --noEmit` (Node 24 pinned)
3. **Test** — `bun test --recursive`
4. **Package smoke** — build the CLI, `bun pm pack`, verify tarball contents, clean-room `bun add` into `mktemp -d` and exercise `infra --help` + `infra gateway status` (Bun pinned `1.4.0`). See 2026-09-06 finding 6 for the full assertion set
5. **CI** (gate) — `needs: [lint, type-check, test, package-smoke]`, `if: always()`, fails when any `needs.<job>.result != "success"`

**Supersedes the 2026-08-16 reading.** That survey recorded "test failures do not block (test job not in `needs`)." As of the 2026-09-06 survey `test` **is** in `needs` and blocks, and the gate asserts on `!= "success"` rather than `== "failure"`, so cancelled and skipped jobs also fail the gate.

### Deploy Pipeline (Split Architecture)

As of 2026-04-20 (#165), the deploy pipeline was split from a single `deploy.yaml` into dedicated per-app workflows. This ensures one app's failure doesn't block the other:

- **`deploy-keeweb.yaml`** — `keeweb` environment, triggered on push-to-main (path-filtered), dispatch, or `workflow_call`. Builds dist, deploys content via SSH/rsync, optionally deploys nginx config if changed. Post-deploy health check: `curl` to `https://kw.igg.ms/`. Secret validation step rejects early if `DEPLOY_SSH_KEY` or `DROPBOX_APP_SECRET` are missing.
- **`deploy-cliproxy.yaml`** — `cliproxy` environment, triggered on push-to-main (path-filtered), dispatch, or `workflow_call`. Deploys via `bun run --cwd apps/cliproxy deploy`. Post-deploy health check against management API (`/v0/management/config` with management key). Secret validation for `CLIPROXY_SSH_KEY`, `CLIPROXY_MANAGEMENT_KEY`, `CLIPROXY_DOMAIN`.
- **`deploy.yaml`** — Now a thin orchestrator that detects changes with `dorny/paths-filter` (`predicate-quantifier: every`) and calls all **seven** per-app deploy workflows via `workflow_call` (keeweb, cliproxy, gateway, umami, vpn, dashboard, broker), passing secrets explicitly. Each is independently path-gated so one app's failure cannot block the others. The broker leg passes `broker_aud: ${{ vars.BROKER_AUD }}` plus `BROKER_SSH_KEY`/`BROKER_HOST` and (optional) `CLIPROXY_MANAGEMENT_KEY`.

Both deploy workflows use `dorny/paths-filter` for change detection (native `paths:` breaks `workflow_dispatch`). Path filters exclude markdown, test, fixture, and snapshot files.

### Release Pipeline (release.yaml)

Uses `changesets/action` for versioning and npm publishing. Git user configured via GitHub App token (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Publishes to npm with provenance (`publishConfig.provenance: true`).

### Branch Protection

Required status checks on `main`: CI, Fro Bot, Lint, Type Check, `Renovate / Renovate`. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Developer Tooling

| Tool | Config | Notes |
| --- | --- | --- |
| ESLint | `eslint.config.ts` via `@bfra.me/eslint-config` **0.52.1** | Flat config; ignores `.agents/`, `.opencode/`, `docs/`, `dist/`. 0.51.1 → 0.52.1 by 2026-09-06 |
| Prettier | `@bfra.me/prettier-config/120-proof` ^0.16.0 (Prettier 3.8.3) | 120-char line width |
| TypeScript | `tsconfig.json` via `@bfra.me/tsconfig` 0.13.1 | Target ESNext, Bundler resolution, Bun types, noEmit |
| Git hooks | `simple-git-hooks` 2.13.1 + `lint-staged` 16.4.0 | `eslint --fix` on staged files |
| CLI framework | `goke` ^6.8.0 + Zod ^4.3.6 | Space-separated subcommands |
| Prompts | `@clack/prompts` ^1.2.0 | Scoped to `cliproxy setup` wizard |
| Changesets | `@changesets/cli` 3.0.1 + `@svitejs/changesets-changelog-github-compact` 1.2.0 | Versioning for `@marcusrbrown/infra` CLI package; **crossed v2 → v3 major** 2026-08-16 (#1106); 3.0.0 → 3.0.1 by 2026-09-06 |
| Renovate | Extends `marcusrbrown/renovate-config#5.2.13` + `group:allNonMajor` | v4→v5 crossed 2026-05-17 (#242); preset `#5.2.6` → `#5.2.12` → `#5.2.13` by 2026-09-06. Post-upgrade: `bun install --ignore-scripts` + `bun run fix` (`executionMode: 'branch'`). Docker source/changelog URLs for CLIProxyAPI, Caddy, Umami, Postgres, `ghcr.io/fro-bot/dashboard`. `bfra-me/.github` digest updates disabled. **Two custom managers** (`apps/*/upstream.json` daemon pin; the `renovate-changesets@x.y.z` double-tag fix) and **four `allowedVersions` ceilings** — see 2026-09-06 findings 4 and 7 |
| Probot Settings | Extends `fro-bot/.github:common-settings.yaml` | Repository configuration sync; declares `main` required contexts `[CI, Fro Bot, Lint, Type Check, Renovate / Renovate]`, `strict: false`, `enforce_admins: true`, `required_linear_history: true`, no required reviews |
| TypeScript runtime | TypeScript 6.0.3, ESLint **10.9.1** | ESLint 10.8.1 → 10.9.1 by 2026-09-06; Prettier steady 3.9.6, `@bfra.me/prettier-config` 0.16.9 → 0.16.11, `@bfra.me/tsconfig` 0.13.1 → 0.13.2, lint-staged 17.3.0 → 17.4.1, `simple-git-hooks` 2.13.1 → 2.14.0; new `@types/bun` 1.4.0 + `jiti` 2.7.0. TypeScript is Renovate-ceilinged at `<7` pending `typescript-eslint#10940` |
| CLI build | `packages/cli/scripts/build.ts` (`bun run build`, `prepack`) | The published CLI is a **build artifact** — `bin` is `./dist/cli.js`, `files` is `["dist", "src/commands/vpn/peers.ts"]`, and `@marcusrbrown/infra-shared` is inlined rather than shipped as a runtime dep. Verified by the `Package smoke` CI job |
| Patched deps | `patches/@changesets%2Fget-github-info@0.6.0.patch` via Bun `patchedDependencies` | Local patch applied to changesets GitHub-info resolver |

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

**Fro Bot workflow is present** (`fro-bot.yaml`, ~50 KB / 971 lines). Uses **`fro-bot/agent@v0.109.3`** (SHA `9d45b92e7c9f95f3e9d9d32cc0b361b4a59e79d7`) as of 2026-09-06; prior surveys v0.99.0 (`2167bb8`, 2026-08-16) and v0.90.0 (`42db56d`, 2026-07-15).

**As of the 2026-09-06 survey the workflow is split into two jobs with disjoint capabilities** — `fro-bot-content` (content-triggered, `contents: read` + `pull-requests: read`, no environment, no OIDC) and `fro-bot-storage` (schedule / main-branch dispatch only, `fro-bot-storage` environment, `id-token: write`, AWS STS, `s3-backup: true`, `harden-runner` egress block). The daily autoheal now runs exclusively in the privileged storage job; PR review runs unprivileged. See 2026-09-06 finding 1.

The workflow includes:

- **PR review** with structured verdict format (PASS / CONDITIONAL / REJECT) and sections for blocking issues, non-blocking concerns, missing tests, and risk assessment
- **Daily autohealing schedule** (single `30 3` UTC cron) now with **10 operational categories** (up from 8): (1) errored PRs, (2) security, (3) code quality, (4) **workflow integrity**, (5) **quality gates verification**, (6) developer experience, (7) deploy pipeline health, (8) live site review (via `agent-browser`), (9) cross-project intelligence, (10) **upstream modernization watch** (Sunday-only). The prompt hard-codes a serial execution model (one mutation → clean tree → continue), a dedup pass, a scope cap (non-minimal/irreversible fixes get an issue, not an auto-heal), a Renovate-owns-versions boundary (dependency edits only for confirmed critical/high advisories), and a trusted-authors allowlist (`renovate[bot]`, `dependabot[bot]`, `mrbro-bot[bot]`, `fro-bot`, owner/write-collaborators)
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

**`broker` environment (added post-2026-06-19):** Secrets: `BROKER_SSH_KEY`, `BROKER_HOST` (both required), `CLIPROXY_MANAGEMENT_KEY` (broker uses it to mint/revoke `ghact-` keys in cliproxy). Variable: `BROKER_AUD` — the broker-minted OIDC audience, set as a GitHub Environment **variable** (not a secret; it is a cross-context replay defense), flows at both provision time and deploy time. Environment gated with a required reviewer + main-only branch policy (pre-create before merge — auto-create is ungated). `DIGITALOCEAN_ACCESS_TOKEN` is repo-level.

**`fro-bot-storage` environment (added 2026-08-16, `apps/agent`; consumer job observed live 2026-09-06):** A protected GitHub Environment that gates `id-token: write` for the S3 storage job. Only scheduled or main-branch dispatched runs may reach it — content-triggered jobs are structurally excluded. **Its protection is `branch_policy` only** — it is the sole environment in the repo without `required_reviewers` (all seven deploy environments carry both), necessarily so because a daily cron cannot wait for approval. It also consumes five non-secret repository *variables* (`FRO_BOT_S3_ROLE_TO_ASSUME`, `FRO_BOT_S3_BUCKET`, `FRO_BOT_S3_REGION`, `FRO_BOT_S3_PREFIX`, `FRO_BOT_S3_EXPECTED_BUCKET_OWNER`), two of which are also interpolated into the `harden-runner` egress allowlist. The AWS provisioning credentials themselves (`AGENT_AWS_ACCESS_KEY_ID`/`AGENT_AWS_SECRET_ACCESS_KEY`/optional `AGENT_AWS_SESSION_TOKEN`) are **operator-local only** — never placed in this or any GitHub Environment. Consumer repos receive only the five non-secret `FRO_BOT_S3_*` variables.

**Repository secrets:** `APPLICATION_ID`, `APPLICATION_PRIVATE_KEY`, `DIGITALOCEAN_ACCESS_TOKEN`, `FRO_BOT_PAT`, `NPM_TOKEN`, `OPENCODE_AUTH_JSON`, `OPENCODE_CONFIG`, `CLIPROXY_API_KEY`, `CLIPROXY_AUTH_MONITOR_DISCORD_WEBHOOK` (the last two consumed by `cliproxy-auth-monitor.yaml`)

**Repository variables:** `FRO_BOT_MODEL`, plus the five non-secret `FRO_BOT_S3_*` variables written by `infra agent storage` (2026-08-16; consumed by the `fro-bot-storage` job and its egress allowlist as of 2026-09-06)

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
- **Broker key material:** Never log the OIDC bearer, minted key, management key, or raw claims; the `Authorization` header is redacted before any logging. Never full-array PUT against cliproxy `api-keys` (GET → append → PUT → read-back assert; a wholesale replace drops other consumers' keys). Never retry on management-API HTTP error (cliproxy IP-bans after ~5 bad-key attempts, ~30 min). The sweeper/reconcile only delete `ghact-`-prefixed keys — never durable or other consumers' keys. Never skip `validateBrokerHost`; never pass broker secret bytes via argv (SSH stdin only); never scale the broker horizontally (single-flight lock assumes exactly one instance).
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
- **Split deploy pipeline:** Seven of the eight apps deploy independently via dedicated path-gated workflows (keeweb, cliproxy, gateway, umami, dashboard, vpn, broker), preventing cascading failures. A thin `deploy.yaml` orchestrator exists for manual dispatch of all simultaneously. The eighth app, `apps/agent`, is **not in the deploy fan-out** — it is an operator-run *provisioner* (`provision:agent`), not a deployed service, so it has no `deploy-agent.yaml`.
- **OIDC credential broker (off-runner keys):** The broker exchanges a GitHub Actions OIDC token for a short-lived, revocable cliproxy key so the durable provider key never touches a CI runner. Revocation is sweeper-only (TTL + reconcile) — no run-end revoke endpoint — with a startup reconcile gate that blocks `/v1/mint` until stale `ghact-` keys are cleared. This is the ecosystem moving from static per-repo cliproxy keys toward per-run minted credentials, with the consuming half landing in [[fro-bot--agent]].
- **OIDC → STS durable-storage provisioner (no static AWS creds in repos):** `apps/agent` provisions per-repo S3 session storage for `fro-bot/agent` using native GitHub OIDC → AWS STS. Each consumer repo gets its own least-privilege IAM role + prefix-scoped inline policy (session prefix has an explicit delete-deny; the coordination lock is a separate exact object ARN), and the CLI writes only five non-secret `FRO_BOT_S3_*` repo *variables* — **never a static AWS credential**. The account-level OIDC provider is touched append-only (adds the `sts.amazonaws.com` audience without disturbing existing thumbprints/audiences). A **version-pinned key layout fails closed** on unknown action refs rather than widening IAM access. This is the *storage* counterpart to the broker's *credential* half — both push per-run, capability-scoped access instead of durable secrets on runners. Distinct from the VPN box in that provisioning credentials (`AGENT_AWS_*`) explicitly shadow-and-ignore ambient `AWS_*`.
- **Out-of-band health monitor with synthetic self-test:** `cliproxy-auth-monitor.yaml` probes CLIProxy's upstream Anthropic auth every 15 minutes on its own cadence (independent of the daily Fro Bot autoheal), escalating failures to a tracking issue + a Discord webhook. Dispatch exposes owner-only `synthetic-dead`/`synthetic-healthy` validation modes so the alerting path itself can be exercised without waiting for a real outage — the monitor can prove it still fires.
- **Digest-pinned upstream image consumption:** The dashboard app consumes the upstream-built `ghcr.io/fro-bot/dashboard` image by tag + digest and verifies the running container's `RepoDigests` against the pin before serving — a no-build deploy that keeps the build surface in [[fro-bot--dashboard]].
- **Multi-cloud:** Most apps run on DigitalOcean droplets, but the VPN egress box runs on **AWS Lightsail** (`eu-west-1`) — the first AWS-backed deployable, provisioned via the AWS SDK with credentials kept operator-local (deploy/status remain SSH-only).
- **One workflow, two capability tiers (2026-09-06):** `fro-bot.yaml` splits into `fro-bot-content` and `fro-bot-storage` so that the agent's *privileged* run (OIDC → STS, S3 session persistence, egress-blocked runner) is reachable only from `schedule` or a main-branch dispatch, while every content-triggered path runs with read-only permissions and no environment. The privileged job is the mutating autoheal; the attacker-reachable job is the read-only reviewer. Fork-PR head resolution is server-verified in a dedicated step rather than trusted from the event payload, closing the `issue_comment`-on-fork-PR gap where the job-level fork guard does not apply.
- **The publish contract asserted before the merge, and alerted after it (2026-09-06):** `ci.yaml`'s `Package smoke` job packs the CLI tarball and clean-room-installs it as a *required* check — catching a broken `files` field, a leaked `workspace:` specifier, or a missing runtime asset at PR time rather than at publish time — while `release-alert.yaml` covers the post-merge half that no merge gate can observe. Both halves are needed because a merge gate can only see jobs that run before the merge. The caveat is recorded in finding 5: the post-merge half currently only fires on `failure`.
- **Two-layer MCP tool gating with vendored-source provenance:** Sensitive infra commands are gated twice — an `MCP_ALLOWLIST` that never registers them as tools (primary), and an `opencode.jsonc` `permission: deny` backstop (secondary). Both layers are asserted by `conventions.test.ts`. The design is grounded in a **vendored upstream clone** (`.slim/clonedeps.json` pinning `anomalyco/opencode@v1.15.13`) because empirically neither `tools:false` nor `permission:deny` alone fully suppressed the tools — reading the upstream registration/permission code was the way to get the gating right. Vendoring the exact upstream you must reason about, rather than trusting docs, is the pattern.

## Infrastructure Components

### CLIProxyAPI Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.4-alpine` | Digest-pinned (`5f5c8640…`, shared across cliproxy/umami/dashboard/broker). **Renovate-ceilinged at `<2.12.0`** pending a manual `linux/amd64` manifest verification (last done 2026-07-13) |
| CLIProxyAPI | `eceasy/cli-proxy-api:v7.2.152` | Digest-pinned (2026-09-06; up from v7.2.133 → v7.2.77) |

Both images are digest-pinned in `docker-compose.yaml`. Renovate manages digest rotations with changelog context sourced from upstream repositories (`router-for-me/CLIProxyAPI`, `caddyserver/caddy`).

**Version note:** CLIProxyAPI crossed v6→v7 major boundary between 2026-05-27 and 2026-06-09. As of 2026-08-16 the deployment is **v7.2.133** (up from v7.2.77 at the prior survey). Caddy steady at `2.11.4-alpine` (digest `5f5c8640…`, shared across cliproxy/umami/dashboard/broker).

**Healthcheck change:** As of #469 (2026-06-09), the deploy healthcheck was moved from the CLIProxyAPI endpoint to the Caddy endpoint for Debian-image compatibility. The docker-compose healthcheck itself (`wget --spider http://localhost:8317/healthz`) is unchanged.

### Umami Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.4-alpine` | Digest-pinned (shared digest with cliproxy) |
| Umami analytics | `umamisoftware/umami:3.3.1` | Digest-pinned (2026-09-06; up from 3.3.0 → 3.2.0) |
| Postgres | `postgres:15-alpine` | Digest-pinned. **Renovate-ceilinged at `<16`** with `dependencyDashboardApproval` — PG18 refuses to start against a PG15 data directory and the password is baked into the named volume; the cutover runbook is `docs/plans/2026-06-01-001-feat-umami-postgres-major-upgrade-plan.md` (unexecuted as of 2026-09-06) |

Digest-pinned images managed by Renovate. Postgres port 5432 is never published to the host — DB is only accessible on the internal compose network.

### Fro Bot Dashboard Stack

| Component | Image | Version |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.4-alpine` | Digest-pinned (shared digest with cliproxy/umami/broker) |
| Dashboard | `ghcr.io/fro-bot/dashboard:2026.09.5` | Tag + digest-pinned (2026-09-06; up from `2026.08.17` → `2026.07.21`). Renovate rule requires `dependencyDashboardApproval` before a bump PR is even created, matching the cliproxy/umami gating pattern |

The dashboard image is built upstream in [[fro-bot--dashboard]] and consumed here by digest — no on-droplet build. Deploy verifies the running container's `RepoDigests` matches the compose-pinned digest before fronting it with Caddy.

### Fro Bot Gateway Stack

| Component | Source | Notes |
| --- | --- | --- |
| Gateway daemon | `fro-bot/agent@v0.93.1` (pinned in `apps/gateway/upstream.json`) | Cloned + reset on the droplet each deploy |
| Workspace executor | Same source | Runs inside the same Compose stack |
| mitmproxy | Per upstream compose | Starts first; certificate in `mitmproxy-certs` named volume |

**Upstream pin note (corrected 2026-09-06).** The gateway `upstream.json` pin is **still v0.93.1**, unmoved since the 2026-08-16 survey, while the `fro-bot.yaml` action pin advanced to v0.109.3 — a gap of ~16 minor series. The 2026-08-16 page attributed this to the two being "versioned independently," which understated it. The real cause is an explicit Renovate policy in `.github/renovate.json5`:

```json5
matchDatasources: ['github-releases'],
matchPackageNames: ['fro-bot/agent'],
groupName: null,          // each bump = a gateway daemon rebuild + redeploy
automerge: false,
dependencyDashboardApproval: true,
allowedVersions: '<0.94.0',
```

with the comment: *"verify no new boot-required secrets before the ceiling moves; v0.93.1 verified deploy-consumed contract identical to v0.88.0, so patch releases in the v0.93.x line may surface but v0.94+ stays gated pending the next verification pass."* A `github-releases` custom manager tracks the `repo`/`ref` pair in any `apps/*/upstream.json`, so the pin *is* watched — the ceiling is what holds it. The verification pass that would lift it has no scheduled owner (see 2026-09-06 finding 4).

Compose stack lives at `/opt/gateway/` on the droplet. Source materialization is `git clone || git fetch && git reset --hard && git clean -xfd` to the pinned SHA, isolated from `/opt/gateway/.secrets-checksum` so checksum survives `git clean -xfd`.

### Credential Broker Stack

| Component | Image | Notes |
| --- | --- | --- |
| Caddy reverse proxy | `caddy:2.11.4-alpine` | Digest-pinned (shared digest with cliproxy/umami/dashboard); exposes `/v1/mint` + `/healthz` only |
| Broker service | `oven/bun:1.4.2-alpine` | Digest-pinned (2026-09-06; up from `1.3.14-alpine`); runs `bun main.js` against a read-only-mounted pre-built bundle on `:3000` (internal only) |

Compose stack lives at `/opt/broker/` on the droplet. No source bind-mount and no `node_modules` — the deploy uploads a self-contained `dist/main.js` bundle (`jose` inlined via Web Crypto) mounted read-only at `/app/main.js`. The bundle is a gitignored deploy-time artifact rebuilt on every deploy.

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
| 2026-08-16 | `d276d93` | **New app: AWS S3 durable-storage provisioner + new auth-monitor workflow.** Added `apps/agent/` — private `@marcusrbrown/infra-agent`, an operator-run AWS provisioner (no deploy workflow) that stands up per-repo S3 session storage for `fro-bot/agent` via GitHub OIDC → AWS STS: dedicated bucket, append-only account OIDC provider, one least-privilege IAM role + prefix-scoped inline policy per consumer repo (session-prefix delete-deny, separate lock ARN), `key-layout.ts` fail-closed layout pinning (`fro-bot/agent@v0.96.0`), readback + JSON handoff manifest; new `agent` CLI group (`agent setup` absorbs the old `cliproxy setup`, kept as compat wrapper; `agent storage`/teardown writes only the 5 non-secret `FRO_BOT_S3_*` repo variables); new protected `fro-bot-storage` GitHub Environment gating `id-token: write`. Second AWS-backed component (first to touch S3/IAM). Added `cliproxy-auth-monitor.yaml` — 15-min Anthropic-auth health probe → tracking issue + Discord webhook, with owner-only `synthetic-dead`/`synthetic-healthy` self-test modes. **8 apps, 18 workflows.** Fro Bot agent v0.90.0 → **v0.99.0** (SHA `2167bb8`); autoheal categories 8 → **10** (added WORKFLOW INTEGRITY, QUALITY GATES VERIFICATION). CLI v0.13.20 → **v0.15.4**. CLIProxyAPI v7.2.77 → **v7.2.133**. Umami 3.2.0 → **3.3.0**. Dashboard `2026.07.21` → **`2026.08.17`**. Gateway upstream pin v0.88.0 → **v0.93.1**. Renovate preset `#5.2.6` → **`#5.2.12`**. `@changesets/cli` **v2 → v3** (#1106). ESLint 10.7.0 → 10.8.1, Prettier 3.9.5 → 3.9.6, lint-staged 17.0.8 → 17.3.0. New root `SECURITY.md` (private vuln reporting), `.ignore`. Stars 3, open issues ~28. |
| 2026-07-15 | `e0e3252` | **No new apps/workflows — config-hardening + vendoring survey.** Still 7 apps, 17 workflows. New durable structure: root `opencode.jsonc` (two local MCP servers — `infra` enabled, `discord`/`saseq/discord-mcp:1.0.0` disabled — plus a defense-in-depth `permission` deny backstop for 11 sensitive infra tools + ~19 destructive Discord tools; JVM 60s timeout + shell-wrapper secret sourcing documented inline); `.slim/clonedeps.json` vendoring manifest pinning `anomalyco/opencode@v1.15.13` for MCP registration/permission inspection; `patches/` with a Bun `patchedDependencies` patch for `@changesets/get-github-info@0.6.0`; root `AGENTS.md`, `.npmrc`, `docs/ideation/`. Root workspace package renamed `@marcusrbrown/infra-workspace`. Fro Bot agent v0.79.4 → v0.90.0 (SHA `42db56d`). Gateway upstream pin v0.79.1 → v0.88.0. CLI v0.13.13 → v0.13.20. CLIProxyAPI v7.2.48 → v7.2.77 (#852). Caddy 2.11.3-alpine → 2.11.4-alpine (shared digest). Dashboard `2026.06.57` → `2026.07.21`. Umami steady 3.2.0. Renovate preset `#5.2.3` → `#5.2.6`. ESLint 10.4.0 → 10.7.0, Prettier 3.8.4 → 3.9.5, lint-staged 16→17. |
| 2026-09-06 | `ac34a60` | **No new apps — the instrumentation matured and started reporting on its operator.** Still 8 apps / 2 packages; workflows **18 → 19** (new `release-alert.yaml`, a `workflow_run` post-merge liveness alert on `Release`). **`fro-bot.yaml` split into two jobs** — `fro-bot-content` (content-triggered, unprivileged) and `fro-bot-storage` (schedule/main-dispatch only, `fro-bot-storage` environment, `id-token: write`, AWS STS, `s3-backup: true`, `harden-runner` `egress-policy: block`) — turning the previously *documented* storage capability invariant into an enforced one, and making infra the first observed consumer of the `apps/agent` provisioner it ships. **`ci.yaml` gained a fourth job, `Package smoke`** (pack → tarball assertions → clean-room install → run the binary), now in the gate's `needs`; **supersedes** the prior "test failures do not block" reading — the gate is `needs: [lint, type-check, test, package-smoke]` asserting `!= "success"`. **Four findings.** (1) The **SINGLE-REPORT RECONCILIATION CONTRACT is not converging**: 10 open `Daily Autohealing Report` issues (08-27 → 09-06) against a contract demanding exactly one, because clause (b)'s identity predicate ANDs a mutable label onto an immutable body marker — all 10 carry the correct marker, only the newest carries the label, so nine of the agent's own artifacts are classified as untrusted collisions and deliberately left alone; 18 issues have ever held the label (17 closed, clean through #1190 on 08-25), and the sibling `autoheal-upstream-watch` label **does not exist in the repo at all**, so category 10's contract can never recognise a managed issue (#1162 open, unlabelled). (2) **Zero open PRs, and the backlog simply moved downstream** — five open stranded-deploy findings (#1234 dashboard, #1249 cliproxy, #1258 + #1277 gateway/vpn, #1278 broker): automerge to `main` fires a path-filtered deploy that then parks in a `required_reviewers` environment, so bumps are committed but never reach the droplets; the prompt's STRANDED-DEPLOY CHECK cites the precedent (a cancelled umami deploy left the app ~3 weeks stale) and is explicitly reporting-only. (3) **Four Renovate `allowedVersions` ceilings, three of them waiting on a human verification pass with no recurring trigger** — `caddy <2.12.0` (verified 2026-07-13), `postgres <16` (runbook dated 2026-06-01, unexecuted), `fro-bot/agent <0.94.0` (gateway daemon still v0.93.1 vs upstream v0.109.3, ~16 minors), `typescript <7` (external, waiting on typescript-eslint#10940); ownership is circular — Renovate is ceiling-gated and category 10 is forbidden from bumping pinned versions. This **corrects** the 2026-08-16 framing of the daemon/action pin gap as incidental. (4) **`release-alert.yaml` gates on `conclusion == 'failure'`** — the exact predicate this repo's own autoheal prompt was rewritten to abandon, and which `ci.yaml` gets right with `!= "success"` — so a cancelled or timed-out Release is silent; it also has no synthetic self-test, unlike `cliproxy-auth-monitor.yaml`. Plus: a new `renovate.json5` custom manager fixing a **double-tagged upstream** (`bfra-me/.github` tags one commit as both `v4.16.x` and `renovate-changesets@x.y.z`; the built-in manager resolved only repo tags and froze the pin at 0.2.31 for four months). Versions: agent v0.99.0 → **v0.109.3** (`9d45b92`); CLI v0.15.4 → **v0.22.0**; CLIProxyAPI v7.2.133 → **v7.2.152**; Umami 3.3.0 → **3.3.1**; dashboard `2026.08.17` → **`2026.09.5`**; broker base `oven/bun` 1.3.14 → **1.4.2-alpine**; Caddy steady 2.11.4; Renovate preset `#5.2.12` → **`#5.2.13`**; ESLint 10.8.1 → 10.9.1, `@bfra.me/eslint-config` 0.51.1 → 0.52.1, `@changesets/cli` 3.0.0 → 3.0.1. Runbooks 4 → **9**; `docs/plans/` at 46; new `.agents/skills/generating-project-docs/`. `.slim/clonedeps.json` unchanged since 2026-06-02 (opencode v1.15.13). README still lists 6 apps of 8 (`broker`, `agent` absent). Daily schedule 16/20 green; all 19 workflows `active`. Stars 3, open items 17, **0 open PRs**. |
| 2026-07-01 | `390cb5f` | **New app: OIDC credential broker.** Added `apps/broker/` — OIDC-authenticated credential broker at `broker.fro.bot`, 2-service Docker Compose (Caddy + `oven/bun:1.3.14-alpine` on its own `s-1vcpu-1gb`/`nyc1` droplet). Exchanges a GitHub Actions OIDC token for a short-lived, revocable cliproxy `ghact-` key so the durable provider key never lands on a CI runner; `jose` JWKS RS256 verify + replay denylist + code-owned `BROKER_TRUST_POLICY`; sweeper-only revocation (60s TTL + 5-min reconcile) with a startup reconcile gate; bundle-based deploy (`dist/main.js`, gitignored, mounted read-only). Added `deploy-broker.yaml` + `broker` GitHub Environment (`BROKER_SSH_KEY`/`BROKER_HOST`/`CLIPROXY_MANAGEMENT_KEY` secrets + `BROKER_AUD` variable) + CLI group (`broker status/deploy/logs`). Now **17 workflows** total; `deploy.yaml` orchestrator fans out to **7** per-app deploys. Consuming half tracked in `fro-bot/agent#1060` (trust-policy placeholders must be replaced before deploy). CLI v0.12.2 → v0.13.13. Fro Bot agent v0.71.0 → v0.79.4 (SHA `b3384d3`). Gateway upstream pin v0.69.0 → v0.79.1. CLIProxyAPI v7.2.20 → v7.2.48. Umami 3.1.0 → 3.2.0. Dashboard `2026.06.16` → `2026.06.57`. Renovate preset steady at `#5.2.3`. |
