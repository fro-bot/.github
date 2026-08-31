---
type: topic
title: GitHub Actions CI
created: 2026-04-18
updated: 2026-08-31
tags: [github-actions, ci-cd, automation, security, renovate, oidc, aws-sts, autoheal, gh-cli, reusable-workflows, branch-protection, sha-pinning]
related:
  - fro-bot--agent
  - bfra-me--ha-addon-repository
  - marcusrbrown--dev-like
  - marcusrbrown--esphome-life
  - marcusrbrown--gpt
  - fro-bot--dashboard
  - marcusrbrown--containers
  - marcusrbrown--ha-config
  - marcusrbrown--github
  - marcusrbrown--systematic
  - marcusrbrown--infra
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-github-io
  - marcusrbrown--marcusrbrown
  - marcusrbrown--mothership
  - marcusrbrown--renovate-config
  - marcusrbrown--sparkle
  - marcusrbrown--vbs
  - bfra-me--github
  - bfra-me--works
  - bfra-me--renovate-action
---

# GitHub Actions CI

Cross-cutting CI/CD patterns observed across Marcus's repositories in the Fro Bot ecosystem.

## Repos Using GitHub Actions

- [[fro-bot--agent]] — Path-filtered Setup → Lint, Build (dist/ drift detection + CI SBOM as of v0.75.0), Test, Test Action (live self-referencing PR review), Dependency Review, Release (semantic-release via `next` → `release` PR flow), CodeQL, Scorecard; plus fenced `harness-release.yaml` (read-only build job / OIDC trusted-publish). **Bun-based workspace CI as of the 2026-06-24 survey** (migrated off pnpm; `packageManager: bun@1.3.14`, `bun.lock`), joining [[marcusrbrown--systematic]] / [[marcusrbrown--infra]] in the Bun-CI cohort
- [[marcusrbrown--containers]] — Multi-arch container builds, Python/Dockerfile linting, Trivy security scanning
- [[marcusrbrown--ha-config]] — YAML lint, Remark lint, Prettier, Home Assistant config validation
- [[marcusrbrown--github]] — Prettier-only CI, Renovate with event-driven triggers, Probot settings sync
- [[marcusrbrown--systematic]] — Bun build + Node.js verification, Biome lint, bun:test, semantic-release to npm, OCX registry validation, Starlight docs build
- [[marcusrbrown--infra]] — Split deploy pipeline (per-app dedicated workflows), convention enforcement tests, Bun workspace CI, Changesets publishing; **18 workflows** as of 2026-08-16 (added `cliproxy-auth-monitor.yaml`, a 15-min out-of-band Anthropic-auth health probe with synthetic self-test); OIDC→AWS-STS per-run storage credentials via the new `apps/agent` provisioner (no static AWS secret on runners)
- [[marcusrbrown--renovate-config]] — Lint + semantic-release pipeline for Renovate presets, self-referential Renovate config, CodeQL, OpenSSF Scorecard
- [[marcusrbrown--sparkle]] — Turborepo-orchestrated Setup → Check → Build pipeline, Astro Starlight docs deployment to GitHub Pages, auto-regenerate-docs PR workflow
- [[marcusrbrown--dev-like]] — 7 workflows (as of 2026-07-31): `ci.yaml` (Bun `validate` + Node/Bun dual-runner tests), `release.yaml` (Changesets + npm OIDC trusted-publish + `mrbro-bot`-App version PRs + `alias-release`), `fro-bot.yaml` (**two-mode** autoheal + pr-review, agent v0.96.0), `site.yaml` (Astro/Starlight → Pages), `link-check.yaml`, `renovate.yaml` (extends [[marcusrbrown--renovate-config]]), `update-repo-settings.yaml` (Probot Settings extends `.github:common-settings.yaml`, gates `main` on `validate`+`Fro Bot`). No CodeQL/Scorecard yet.
- [[bfra-me--github]] — Org control center; **16 workflows** (2026-08-06, durable since the 2026-07-02 consolidation) including `main.yaml` (Quality Check), a **single unified `fro-bot.yaml`** (per-repo persona + org-wide sweep folded in; the separate `fro-bot-autoheal-org.yaml` was **removed** 2026-07-02, and a single `30 15` daily pass now does both oversight and autohealing), `renovate.yaml` + `trigger-org-renovate.yaml` (self-hosted Renovate fan-out), and three custom actions (`renovate-changesets`, `update-metadata`, `update-repository-settings`). Source of the reusable workflows that `marcusrbrown/*` repos consume. 2026-08-06 note: two upstream **majors** (`bfra-me/renovate-action` v9 → v10, `actions/checkout` v6 → v7) landed as ordinary SHA-pin automerge churn — a data point that the SHA-pin-plus-Renovate model absorbs even major action bumps without workflow-structure change (agent pin v0.96.0, fleet lead). The [[bfra-me--renovate-action]] `v10.0.0` in particular was a **Renovate-engine major (v43 → v44), not a runtime-architecture change** (confirmed 2026-08-10 source survey) — its composite/Docker mechanics are byte-stable across the boundary, which is precisely why downstream `@v10` consumers absorbed it as noise. The action's own major version tracks the vendored Renovate engine major, so a `v_N → v_{N+1}` action bump generally means "new Renovate major inside," not "action rewritten."
- [[bfra-me--works]] — `@bfra-me` tooling monorepo; 11 workflows including `main.yaml` (Prepare → parallel {Lint+type-coverage, Test, Build, Workspace Analysis} → CI), `release.yaml` (Changesets, `workflow_run` after Main + Sunday cron + dispatch with force-release toggle), `fro-bot.yaml` (three-mode single-file at v0.44.2), `docs.yaml` (Astro Starlight → GitHub Pages), `docs-sync.yaml` (path-filtered @bfra.me/doc-sync re-sync), `renovate.yaml` + `update-repo-settings.yaml` (reusable `bfra-me/.github` callers), `renovate-changeset.yaml`, `cache-cleanup.yaml`, plus CodeQL/Scorecard/Dependency Review. Local composite action `.github/actions/pnpm-install` consumed by every workflow.

## Common Patterns

### Action Pinning

All repositories SHA-pin GitHub Actions with version comments:

```yaml
uses: actions/checkout@de0fac2e... # v6.0.2
```

This prevents supply-chain attacks from tag mutation. Renovate manages SHA updates automatically.

### Probot Settings

Both repos extend `fro-bot/.github:common-settings.yaml` via `.github/settings.yml`. This synchronizes branch protection rules, required status checks, and repository settings from a central source.

### Renovate Configuration

Both repos extend `marcusrbrown/renovate-config` for dependency updates, with repo-specific overrides:

- [[marcusrbrown--containers]] — `#5.2.0` (v4→v5 crossed 2026-05-20), ignores `templates/`, disables patch updates (except TypeScript/Python), post-upgrade runs `poetry lock && pnpm install && pnpm format`
- [[marcusrbrown--ha-config]] — `#4.5.8`, custom managers for pre-commit and mise, post-upgrade runs Prettier, automerge on minor/patch pip updates
- [[marcusrbrown--github]] — `#4.5.8`, post-upgrade runs `npx prettier@3.8.3 --no-color --write .`, PR creation set to `immediate`
- [[marcusrbrown--infra]] — `#5.2.0` + `group:allNonMajor` (v4→v5 crossed 2026-05-17), post-upgrade runs `bun install --ignore-scripts && bun run fix`, Docker source URLs for CLIProxyAPI/Caddy, `bfra-me/.github` digest updates disabled
- [[marcusrbrown--renovate-config]] — Self-referential (`local>marcusrbrown/renovate-config`), custom regex manager for `bfra-me/renovate-config` preset pin in `default.json`, post-upgrade runs `pnpm run bootstrap && pnpm run fix`
- [[marcusrbrown--sparkle]] — `#5.2.9` (was `#5.2.0`; v4→v5 crossed 2026-05-23 from `#4.5.9`; observed `#5.2.9` at 2026-07-28) + `sanity-io/renovate-config:semantic-commit-type` + `:preserveSemverRanges`, post-upgrade runs `pnpm bootstrap && pnpm fix`, React Native package grouping, automerge on unstable `@astrojs/check`/`typedoc`

### Renovate Trigger Model

The Renovate workflow trigger pattern varies across repos:

- **Event-driven** (recommended): [[marcusrbrown--github]] uses PR events (opened/reopened/synchronize/edited), issue edits (non-bot), push to non-main, and `workflow_run` after CI success. Hourly schedule is commented out. This prevents unnecessary runs while ensuring timely updates.
- **Schedule + event hybrid**: Most other repos use a combination of hourly cron schedules and event triggers.

### Branch Protection

Both repos enforce linear history, enable admin enforcement, and require specific status checks. Neither requires PR reviews for merge.

### Change Detection

Repos use `dorny/paths-filter` to scope CI runs to relevant file changes, reducing unnecessary builds. Native `paths:` triggers are avoided where `workflow_dispatch` support is needed (the native filter silently skips dispatch events).

### Split Deploy Pipelines

[[marcusrbrown--infra]] pioneered a pattern of splitting monolithic deploy workflows into per-app dedicated workflows connected by `workflow_call`:

- Each app gets its own workflow file with independent path filtering, environment gating, and secret validation
- A thin orchestrator workflow dispatches all of them via `workflow_call` for manual "deploy everything" scenarios
- Benefit: one app's deploy failure doesn't block the others; each workflow is independently triggerable
- Validated at scale: as of 2026-05-27, infra has 3 per-app deploy workflows (`deploy-keeweb.yaml`, `deploy-cliproxy.yaml`, `deploy-gateway.yaml`) gated by a thin `deploy.yaml` orchestrator. The Discord gateway (`apps/gateway`, added #264) is the third app onboarded to this pattern
- **Cross-repo build→deploy dispatch (observed 2026-06-26):** [[fro-bot--dashboard]]'s `release.yaml` extends this beyond a single repo — after publishing a CalVer GHCR image it best-effort `gh workflow run`s [[marcusrbrown--infra]]'s `deploy-dashboard.yaml` (passing `version` + `digest`) using a short-lived token from a dedicated infra-scoped GitHub App. The deploy job is `continue-on-error` for its whole scope, so a dispatch/secret gap warns without reddening a published release, and it only reaches infra's operator-approval gate (never bypasses it).

### CalVer GHCR Release with Digest-Promote + Smoke-Test

[[fro-bot--dashboard]]'s `release.yaml` (2026-06-26) is the ecosystem's reference for image-only releases decoupled from `package.json` version:

- **Guard job** runs a script over the changed-file range + a base-vs-head `package.json` diff to decide whether to release at all.
- **Candidate-then-promote:** build + push a throwaway `ci-<run>-<attempt>` tag, smoke-test it **by digest**, then `docker buildx imagetools create` to promote the *same digest* to `<calver>`/`latest`/`sha-<short>`, verifying each promoted tag resolves back to the smoke-tested digest (no rebuild between test and release).
- **Layered smoke test:** host-port `/api/healthz` poll (catches `127.0.0.1`-bind regressions), sibling-container reachability by service name (catches a 127.0.0.1-only bind that 502s behind a reverse proxy), SPA `/manifest.webmanifest` served, and a CSP `script-src 'self'` header assertion.
- **Identity split:** GHCR push uses `GITHUB_TOKEN` (App installation tokens cannot push GHCR); a `fro-bot[bot]` App token is reserved for the identity-sensitive tag push + GitHub Release; failure cleanup deletes the tag + partial release.

**Supply-chain parity added 2026-08-08:** [[fro-bot--dashboard]] closed its CodeQL/Scorecard gap in one wave — workflow count 3 → 7 with `codeql.yaml` (weekly `javascript-typescript` CodeQL v4), `scorecard.yaml` (weekly OpenSSF Scorecard v2.4.4 + SARIF upload), `dependency-review.yaml` (PR-gated v5.0.0), and a **self-hosted `renovate.yaml`** (`bfra-me/.github` reusable @v4.16.44 — Renovate was previously org-side only), plus an OpenSSF Scorecard README badge. This is the same CodeQL+Scorecard+Dependency-Review triad already durable in [[bfra-me--works]], [[bfra-me--renovate-action]], [[marcusrbrown--renovate-config]], and [[fro-bot--agent]]. Notably it **superseded a harness-delivery gap**: the prior daily-pass `pnpm-workspace.yaml` security `overrides` (`brace-expansion`/`fast-uri`) that never landed under working-dir delivery are gone — the transitive-advisory path is now owned by in-repo Renovate + Dependency Review rather than an undeliverable autoheal edit. A data point that repo-local supply-chain automation is the durable fix for autoheal edits a `schedule`-trigger working-dir contract can't commit.

### Fro Bot Agent

| Repo                          | Fro Bot Workflow         | Schedule                          |
| ----------------------------- | ------------------------ | --------------------------------- |
| [[fro-bot--agent]]            | Present (`fro-bot.yaml`, self-hosted; agent v0.94.0 as of 2026-07-21). As of v0.93.0 the workflow carries a two-job release-notes path (read-only generation + `FRO_BOT_PAT` apply) and a `review-skip-label` opt-out for automatic PR reviews. | Daily 15:30 UTC DMR, Weekly Sun 20:00 UTC wiki update |
| [[fro-bot--dashboard]]        | Present (single-file three-mode `fro-bot.yaml`, self-hosted at agent **v0.97.0** SHA-pinned `3f19f02` as of 2026-08-08 — ecosystem version co-leader with [[marcusrbrown--gpt]]) | Daily `0 0 * * *` (midnight UTC) oversight + autohealing; modes review/triage/schedule + dispatch; checkout pins to default ref (never PR-head) to protect `FRO_BOT_PAT` |
| [[marcusrbrown--containers]]  | Present (`fro-bot.yaml`, agent v0.55.0) | Daily 14:30 UTC autohealing       |
| [[marcusrbrown--systematic]]  | Present (`fro-bot.yaml`) | Weekly Mon 09:00 UTC maintenance, Daily 03:30 UTC autohealing |
| [[marcusrbrown--infra]]       | Present (`fro-bot.yaml`, agent v0.44.3) | Daily 03:30 UTC autohealing (8 categories incl. CLIProxy + Gateway + cross-project + upstream modernization watch on Sundays) |
| [[marcusrbrown--mrbro-dev]] | Present (single-file `fro-bot.yaml` at agent **v0.93.1** SHA-pinned `a4976f4`; surveyed via the `marcusrbrown.github.io` name binding → repo id `1174807412`). **Consolidated 2→1 cron on 2026-07-28 (#234).** | Single daily `30 3 * * *` oversight + autoheal pass (was `30 3` autoheal / `30 15` maintenance until #234). Dispatch modes now `review`/`autoheal`/`live-audit` (`maintenance` dropped); dedicated `live-audit-preflight`/`discovery`/`reporter` jobs + `live-audit-slot` input; `discussion_comment` trigger; scheduled autoheal wires an authenticated git remote (#236). Rolling report collapsed to a single `Daily Fro Bot Report` issue (#235) |
| [[marcusrbrown--marcusrbrown-github-io]] | ⚠️ **Stale row — the *brand site* this described (repo id `1021912280`, now [[marcusrbrown--marcusrbrown-com]]) no longer holds this name.** Since the 2026-07-13 rename/collision the name `marcusrbrown/marcusrbrown.github.io` resolves to repo id `1174807412` (mrbro.dev — see the row above). | (Historical) Daily 15:30 UTC maintenance (no autoheal) — describes the pre-rename brand site only |
| [[marcusrbrown--marcusrbrown]] | Present (single-file three-mode `fro-bot.yaml` at v0.75.0 SHA-pinned `a12463f`, onboarded 2026-06-02 via #924; ~31 agent bumps in 20 days as of 2026-06-22) | Autoheal `30 4 * * *` (7 categories incl. Sunday-only Upstream Modernization Watch), Maintenance `30 16 * * *`; both rolling single-issue reports. Adds a comment-trigger fork-head refusal preflight step. Friction update (2026-06-22): the prior daily close/reopen churn on the perpetual maintenance issue #936 has settled — #936 is now closed, leaving the autoheal report #926 as the only open perpetual issue (zero open maintenance issue) |
| [[marcusrbrown--renovate-config]] | Present (single-file `fro-bot.yaml` at v0.44.3; the separate `fro-bot-autoheal.yaml` was consolidated since 2026-04-28) | Daily 15:30 UTC, 6 categories incl. config validation, cross-project intelligence inbound, and Sundays-only Upstream Modernization Watch with at-most-one-draft-PR-per-scan policy |
| [[marcusrbrown--vbs]]         | Present (single-file unified single-job `fro-bot.yaml` at v0.55.4; autoheal job folded in via #594 on 2026-05-30) | Autoheal `30 3 * * *`, Maintenance `30 15 * * *`; modes `review`/`maintenance`/`autoheal` via dispatch; fork-PR + bot-author guard at job `if` level |
| [[marcusrbrown--sparkle]]     | Present (`fro-bot.yaml`, agent **v0.95.0** as of 2026-07-28; landed 2026-06-05 at v0.54.2) | Autoheal `0 5 * * *`, Maintenance `0 17 * * *`; modes `review`/`maintenance`/`autoheal` via dispatch; comment-trigger fork-head refusal preflight. Autoheal now shipping **security-override PRs** (`pnpm.overrides` in `pnpm-workspace.yaml`) for transitive Dependabot alerts — see [[marcusrbrown--sparkle]] |
| [[marcusrbrown--dev-like]]    | Present (`fro-bot.yaml`, **two-mode** at agent **v0.105.1** SHA-pinned `e9501a9` as of 2026-08-30 — fleet-front pin, was v0.96.0/`c29ac29` at 2026-07-31; workflow body otherwise byte-identical across the interval; onboarded since the 2026-07-12 initial survey when it had none) | Daily `30 14 * * *` autoheal; modes `autoheal`/`pr-review` via dispatch (default `autoheal`); `pull_request` → pr-review, `schedule`/`workflow_dispatch` → autoheal. Distinct from the fleet's three-mode norm: **no maintenance mode**. Inline prompts encode repo invariants as hard boundaries (zero runtime deps, human-gated registry/consent/OPTOUT/profile edits, no release.yaml/OIDC edits, mandatory changesets for `registry\|skills\|bin\|scripts`, verification gates incl. `npm pack --dry-run`). Failures roll up to a single **`Fro Bot Autoheal`** issue (reopen-not-spam). `secrets.FRO_BOT_PAT`, `persist-credentials: false` |
| [[marcusrbrown--ha-config]]   | **Not present**          | N/A                               |
| [[bfra-me--works]]            | Present (`fro-bot.yaml`, single-file three-mode at **v0.83.0** as of 2026-07-05 — fleet pin leader; stale Renovate PR #3691 holds the pending v0 → v1 (`v1.18.0`) cutover, untouched since 2026-06-14) | Maintenance `0 16 * * *`, Autoheal `30 3 * * *`; both rolling-update single-issue reports (`Daily Maintenance Report` / `Daily Autohealing Report`). Autoheal still re-emitting **duplicate** security/docs PRs (#3704/#3713, #3620/#3724 all still open) plus new #3762/#3803 — dedup guard not catching its own stale cross-run PRs; backlog 7 → 11 open PRs |
| [[bfra-me--renovate-action]]  | Present (single-file three-mode `fro-bot.yaml` at **v0.98.2** SHA-pinned `994357c3` as of 2026-08-10 — ecosystem version leader/canary a sixth time, now only ~1 patch ahead of the fleet front) | Autoheal `30 3 * * *`, Maintenance `30 15 * * *`; dispatch defaults to autoheal; two perpetual issues (`Daily Maintenance Report` / `Daily Autohealing Report`); explicit Renovate-owns-dependency-bumps boundary in autoheal prompt. **2026-08-10 adds a `Validate review mode inputs` guard**: a `mode=review` dispatch hard-fails without a `prompt` (review mode has no default prompt — its normal path is the `pull_request` event), and the `prompt` doc-string names the verbatim-prompt path as the release-notes-narrative automation hook |

The containers repo's Fro Bot workflow includes domain-specific PR review prompts (Dockerfile best practices, multi-arch correctness) and a structured autohealing schedule (errored PRs, security alerts, dependency bumps, linting consistency).

The systematic repo's Fro Bot workflow includes TypeScript/Bun/Biome-specific PR review prompts (type safety, ESM conventions, zero-class convention, plugin API breaking changes, system prompt injection security). Its autoheal covers 4 categories: errored PRs, security, health & maintenance, developer experience.

### Two-Phase Read-Only Generation + Credential-Boundary Apply

[[fro-bot--agent]] v0.93.0 (#1239) established a reusable CI pattern for **LLM steps that consume untrusted input** (PR bodies, diffs) yet must ultimately mutate a protected resource: split the work across two jobs with a hard credential boundary.

- **Generation job** runs on the workflow `GITHUB_TOKEN` scoped to the minimum read set (`contents: read`, `pull-requests: read`), gathers **bounded** evidence (agent caps: ≤25 PRs, per-PR body truncation, ≤5 diffs), and writes its output to the **job artifact store** — not the target resource. Because the token is read-only, this phase *structurally cannot* edit, comment, or mutate regardless of what injected instructions the untrusted content carries.
- **Apply job** downloads the artifact candidate and performs the mutation; the write authority is carried by a **distinct credential** (`FRO_BOT_PAT`), never the read-only `GITHUB_TOKEN`. A **fail-closed validator** runs on the candidate before apply (rejects forged idempotency markers / `<details>` tags, control chars, oversized/empty bodies, missing links), with a `stripCodeSpans()` pre-pass so a candidate legitimately *describing* a marker (in code quotes) is not falsely rejected while broken markup still trips the guard.

This is the release-notes-narration path, but the shape generalizes to any "read untrusted → decide → write privileged" CI flow. It is the CI-job-level analogue of the `harness-integrate` broker containment (untrusted merge runs under a read-only / minted credential; write authority is granted only to a separate, policy-pinned job).

**Consumer-side hook (2026-08-10):** [[bfra-me--renovate-action]]'s `fro-bot.yaml` documents the verbatim-`prompt` dispatch path (`workflow_dispatch`/`workflow_call` prompt used as-is when non-empty) as "the path used by the release-notes-narrative automation" — i.e. the apply-phase caller drives the agent by injecting a fully-formed prompt rather than selecting a mode. That repo also added an input-validation guard (`mode=review` without a `prompt` hard-fails) so the review persona never runs promptless; a small hardening that pairs with the two-phase pattern's fail-closed discipline.

### OIDC → Cloud-STS Per-Run Credentials (no static cloud secrets on runners, 2026-08-16)

[[marcusrbrown--infra]] now runs **both halves** of an "eliminate durable secrets on CI runners" pattern, one per cloud primitive:

- **Credential half (`apps/broker`, since 2026-07-01):** a GitHub Actions run mints its own OIDC token, exchanges it at `broker.fro.bot` for a short-lived, revocable cliproxy `ghact-` key, and never sees the durable provider key. Sweeper-only revocation (TTL + reconcile).
- **Storage half (`apps/agent`, since 2026-08-16):** native GitHub OIDC → **AWS STS** `AssumeRoleWithWebIdentity` — no broker, no minted bearer, no static AWS key. A provisioner stands up one **least-privilege IAM role + prefix-scoped inline policy per consumer repo** (session prefix carries an explicit delete-deny; the coordination lock is a separate exact object ARN). The consumer repo receives only five **non-secret** `FRO_BOT_S3_*` *variables* (`ROLE_TO_ASSUME`/`BUCKET`/`REGION`/`PREFIX`/`EXPECTED_BUCKET_OWNER`) — the `role_arn` a job assumes via OIDC, not a credential.

Two invariants recur across both halves and are worth generalizing:

1. **Provisioning credentials shadow-and-ignore ambient cloud creds.** `apps/agent` accepts dedicated `AGENT_AWS_*` and *deliberately ignores* ambient `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — the same operator-local discipline the VPN Lightsail box uses. The privileged provisioning identity is never the CI identity.
2. **`id-token: write` is gated behind a protected environment on trusted triggers only.** The storage job runs under a protected `fro-bot-storage` environment reachable only on scheduled or main-branch-dispatched runs — content-triggered jobs (PRs from untrusted forks/comments) are structurally excluded from ever requesting an OIDC token. This is the same "untrusted content cannot reach the privileged job" containment as the two-phase read-only/apply split above, applied to OIDC issuance rather than a PAT.

A third detail generalizes as **fail-closed capability pinning**: the provisioner version-pins the S3 key layout to a verified `fro-bot/agent` action ref and refuses unknown layouts rather than widening IAM. The account-level OIDC provider is touched append-only (adds an audience without disturbing existing thumbprints). Together these move the fleet from "durable cloud secret sitting in a GitHub Environment" to "per-run, capability-scoped, policy-pinned cloud access."

### Out-of-Band Health Monitor with Synthetic Self-Test (2026-08-16)

[[marcusrbrown--infra]]'s `cliproxy-auth-monitor.yaml` probes CLIProxy's upstream Anthropic auth on its **own 15-minute cadence**, independent of the daily Fro Bot autoheal, and escalates failures to a tracking issue (`issues: write`, `contents: read` only) plus a Discord webhook. The notable twist is a **dispatch-only synthetic validation input** (`synthetic-dead`/`synthetic-healthy`, owner-only) that lets an operator exercise the *alerting path itself* without waiting for a real outage — the monitor can prove it still fires and still opens/updates the issue. Health checks that can only be validated by a real failure tend to rot silently; a synthetic self-test mode is cheap insurance that the escalation plumbing still works.

### Fro Bot Scheduled-Run Consolidation (two crons → one daily pass)

A recurring fleet motion: repos that ran **two separate scheduled Fro Bot passes** — an `autoheal` cron (typically `30 3` UTC) and a `maintenance` cron (typically `30 15` UTC), each emitting its own rolling report issue — collapse into a **single daily oversight+autoheal pass** with one report issue. The `maintenance` dispatch mode is retired; repository oversight becomes a report-only category inside the unified autoheal run.

Confirmed instances (chronological):

- [[marcusrbrown--vbs]] (#594, 2026-05-30) — autoheal job folded into a single unified job.
- [[bfra-me--github]] (2026-07-02) — 3 → 2 modes, one unified 15:30 pass, reports consolidated to a single issue (#2344).
- [[marcusrbrown--mothership]] (initial survey 2026-07-06) — onboarded already unified (single-run oversight+autoheal at 06:15 UTC).
- [[fro-bot--dashboard]] — single `0 0` midnight pass.
- [[marcusrbrown--mrbro-dev]] (**#234, 2026-07-28**) — the two-cron model (`30 3` autoheal / `30 15` maintenance) collapsed to a single `30 3` daily oversight+autoheal pass; `maintenance` dispatch mode dropped, a **`live-audit`** mode added (dedicated `live-audit-preflight`/`discovery`/`reporter` jobs + `live-audit-slot` input); the split `Daily Autohealing Report`/`Daily Maintenance Report` issue pair collapsed to a single `Daily Fro Bot Report` (#235).

The consolidation reduces scheduled-run surface area and eliminates the split-report bookkeeping (two perpetual issues → one). Repos still running the two-cron split (e.g. [[bfra-me--works]], [[bfra-me--renovate-action]], [[marcusrbrown--marcusrbrown]], [[marcusrbrown--sparkle]]) are candidates for the same collapse.

### Invariant-Encoding Fro Bot Prompts (2026-07-31)

[[marcusrbrown--dev-like]] runs a **two-mode** `fro-bot.yaml` (autoheal + pr-review, no maintenance mode) whose inline `AUTOHEAL_PROMPT`/`PR_REVIEW_PROMPT` env blocks hard-code the repository's own product invariants as agent guardrails: zero runtime dependencies, **human-gated** registry/consent-tier/OPTOUT/profile-prose edits (the ethics floor is not delegated to the bot), no release.yaml/OIDC/publish edits, no direct commit/merge to `main`, mandatory `bunx changeset` for any `registry|skills|bin|scripts` touch, and required verification gates before opening a PR (`bun run validate`, `bun run test`, `bun run --cwd docs test`, `bun run --cwd docs build`, `npm pack --dry-run`). Failures roll up to a single reopen-not-spam `Fro Bot Autoheal` issue.

This is the CI-prompt analogue of [[marcusrbrown--infra]]'s convention-enforcement-via-tests: the same `AGENTS.md` invariants that humans read are re-stated to the autonomous maintainer so provenance/consent ethics and release safety survive automation. Contrast the domain review prompts in [[marcusrbrown--containers]] (Dockerfile/multi-arch) and [[marcusrbrown--systematic]] (TS/Bun/Biome) — dev-like's twist is boundaries that protect a *data/ethics* invariant, not just code style.

**Two further boundaries recorded 2026-08-30** (present in the same prompt since ≤2026-07-31, previously under-recorded), both generalizable:

- **Tool-skepticism clause:** *"Do not delete dead code flagged by AFT or any tool without independently verified evidence it is unreachable."* Static-analysis reachability findings are named as **evidence to corroborate, not instructions to execute**. Valuable anywhere generated or convention-loaded files (registry-generated skills, fixtures, plugin entrypoints) legitimately appear unreferenced to a call-graph analyzer.
- **Automation-boundary clause:** *"Do not re-enable Renovate."* A fence around a *deliberate exclusion* — in dev-like's case most plausibly the `evals/**` ignore in `renovate.json5` that keeps intentionally-pinned eval fixtures frozen. The wider pattern: when a repo has consciously narrowed an automation's scope, say so in the agent prompt, or a well-meaning autoheal run will "fix" the gap and silently destroy the reason it existed.

The review half also carries a **workflow-selection** boundary worth noting: `PR_REVIEW_PROMPT` explicitly forbids invoking `ce:review` or any `ce:*` authoring workflow ("a focused, single-pass review, not a formal review pipeline run"), enforces review-only mode (no edits, commits, branches, or PR modification beyond comments), and fixes the review body to four headings with `None` required for empty sections. Constraining *which* skill the agent may reach for is a distinct lever from constraining what it may change.

### Repo-Scoped Named Agent Definitions (`.github/agents/*.agent.md`, 2026-08-08)

[[marcusrbrown--gpt]] introduced (HEAD `f6117f0`) a `.github/agents/` directory holding **named, frontmatter-tagged agent definition files** — `reviewer.agent.md` and `test-writer.agent.md`. Each is a Markdown file whose YAML frontmatter declares a `name` and `description`, followed by a role-scoped system prompt: the Reviewer encodes the repo's type-safety/storage/security/UI invariants as a review checklist; the Test Writer encodes the 5-tier test infrastructure (unit/E2E/accessibility/visual/performance) as an authoring guide.

This is a step beyond the [[marcusrbrown--infra]] convention-enforcement and [[marcusrbrown--dev-like]] inline-prompt patterns: instead of embedding agent guidance in `AGENTS.md` docs or inline workflow `env` blocks, the personas become **first-class, version-controlled, harness-selectable files** the agent can load by name. Crucially they *defer to* `AGENTS.md`/`docs/RULES.md`/`tests/AGENTS.md` for canonical conventions rather than duplicating them — the agent files are role routers, the AGENTS.md hierarchy remains the source of truth. First observed instance in the surveyed ecosystem; watch for propagation to other repos as the harness formalizes named-agent selection.

### Converged Autoheal: the Null Verdict as a First-Class Outcome (2026-08-30)

Most surveyed repos accumulate an **agent-authored PR backlog**: [[marcusrbrown--sparkle]] carries 15 open PRs (13 fro-bot-authored, six near-identical stacked `chore(lint)` fixes), [[bfra-me--works]] re-emits duplicate security/docs PRs across runs, [[marcusrbrown--mrbro-dev]] holds a security remediation unmerged for weeks against a frozen trunk. [[marcusrbrown--dev-like]] is the counter-example and worth studying as a control case.

At the 2026-08-30 survey its rolling `Fro Bot Autoheal` issue (#10) carried **53 comments** from ~6 weeks of daily scheduled runs, and every recent verdict reads *"No safe fix found. Repo remains healthy. No PR opened."* Zero autoheal PRs, zero issue spam, one issue. Two prompt properties produce this:

1. **The null verdict is explicitly granted and explicitly routed.** The prompt says: *"If no safe fix exists, do not open a PR. Instead update the rolling issue with findings."* Without that clause an agent under a "perform active repository autoheal" instruction is pressured to justify the run with *something* — which is how speculative and duplicate PRs get born. Naming "nothing to do" as a valid, reportable outcome removes the pressure.
2. **A strict-order ladder with early exit.** Four categories — (1) CI/site/link-check/workflow failures, (2) security advisories, (3) schema/generated drift, (4) docs/tests/changesets hygiene — investigated in order, *"stopping at the first category with a safe, evidence-backed fix."* Bounded search, deterministic termination, no scope drift into category 4 busywork when categories 1–3 are clean.

Paired with the **reopen-not-spam** rolling-issue lookup (search by exact title across all states → reopen if closed → comment; create only if absent) and a hard `at most ONE focused PR or run per invocation` cap, the result is a daemon that converges and *stays* converged.

The second half of the lesson is structural, not prompt-level. dev-like's mutable surface at rest is essentially **action pins**, which Renovate automerges — 30 commits and 0 open PRs in the same four weeks. Repos with large source trees generate autoheal-eligible findings faster than a human merge gate drains them. So fleet PR backlogs are a **merge-gate-plus-surface-area** problem, not evidence the agent is unproductive; dev-like's clean queue is not a better agent, it is a smaller surface plus full automerge coverage plus a prompt that permits doing nothing.

### `gh --body` Does Not Expand `@path` (agent comment-delivery footgun, 2026-08-30)

Observed once in [[marcusrbrown--dev-like]]: the 2026-08-26 autoheal comment on its rolling issue has a body that is, in full, the literal 40-character string `@/tmp/opencode/autoheal-comment-final.md`. The run composed a long report to a temp file and then passed the path to `gh issue comment --body` — but `@`-expansion is **not** a `--body` feature. `--body-file <path>` reads from disk; `--body` takes the string verbatim. (`curl` and some other CLIs *do* use `@file` syntax, which is likely where the habit comes from.)

The failure is silent and total: the step exits 0, the comment posts, the issue's `updated_at` moves, and a full report is replaced by a dangling pointer to a file on a runner that no longer exists. One of 53 reports evaporated with no signal anywhere in CI. Nothing in the workflow can catch it, because nothing failed.

Generalizable guidance for any agent that composes long output then delivers it via `gh`:

- Use **`--body-file`** for file-sourced bodies, or `--body-file -` with the content on stdin. Reserve `--body` for genuinely inline strings.
- Prefer stdin piping over temp files where possible — it removes the path-versus-content ambiguity entirely.
- If a temp-file path is unavoidable, **assert the delivered body doesn't start with `@` and is longer than the path**, or post-verify the comment length. A body that is exactly a filesystem path is always a bug.

This sits alongside the two-phase credential-boundary pattern as a reminder that the *delivery* leg of an agent run deserves the same scrutiny as the reasoning leg. An agent can investigate correctly, write a correct report, and still deliver nothing.

### SHA Pinning Validates the Ref, Not the Path (2026-08-30)

[[marcusrbrown--esphome-life]] has carried a defect through **seven consecutive surveys** and, as of this one, **≥100 commits**: its `update-repo-settings.yaml` workflow calls

```yaml
uses: bfra-me/.github/.github/workflows/renovate.yaml@b830359… # v4.22.0
```

That is the *Renovate* reusable workflow, invoked from a workflow and job both named "Update Repo Settings." The call is perfectly valid — same owner, same repo, real file, valid SHA, matching secrets signature — so nothing anywhere fails. It just does the wrong job.

The instructive part is what automation did with it. Renovate has faithfully bumped that `uses:` line ~100+ times, reaching back to `v4.0.9` on 2025-07-27, walking it through 47 `v4.16.x` patches and six minor boundaries up to `v4.22.0`. **A dependency bot validates the ref; it never questions the path.** The misconfiguration is not merely surviving automation — it is being actively groomed by it, and every green bump PR reads as fresh evidence of health.

Three transferable lessons:

1. **A wrong-but-resolvable `uses:` path is invisible to every layer of the stack.** Not to Actions (it runs), not to Renovate (the ref updates cleanly), not to branch protection (the job reports success), not to a reviewer skimming a `chore(deps)` diff that changes one SHA. The only detector is someone reading the `uses:` line against the workflow's name. Cheap mitigation: assert in CI that each reusable-workflow caller's `uses:` basename matches its own filename, or at minimum that a workflow named `X` calls something named `X`.
2. **Reusable-workflow callers are the least-reviewed files in a repo and the most-modified.** A 10-line caller touched 100+ times by a bot is a place where a one-token error can live for over a year. Weight review attention by *time since a human read the file*, not by churn.
3. **Confirm the correct target exists before filing the defect.** This survey established that `bfra-me/.github` ships `.github/workflows/update-repo-settings.yaml` at v4.22.0 with `on: workflow_call`, `APPLICATION_ID` + `APPLICATION_PRIVATE_KEY` both required, and zero inputs — an exact signature match, so the repair is a single-token path swap with no other caller changes. Six prior surveys flagged the symptom without pinning the fix; a defect note that includes the verified diff is the one that gets merged.

Measured cost in this instance: `Update Repo Settings` executes a full Renovate pass on its daily `23 12` cron *and* on every push to `main`, so `.github/settings.yml` is never applied by the repo's own automation and each merge triggers Renovate twice.

### Dependency-Bot Coverage Is Not Repository Health (2026-08-30)

Related, and visible in the same repo. [[marcusrbrown--esphome-life]] runs one of the cleanest dependency operations in the fleet — 400+ merged Renovate PRs, 0 open PRs across every survey, every action SHA-pinned, daily cadence, drain-clean queue. It also carries three unaddressed defects, each **structurally invisible to Renovate**:

| Defect | Why the bot can't see it |
| --- | --- |
| Settings workflow calls the Renovate reusable workflow | The ref is valid and updates cleanly; paths aren't semantic to Renovate |
| ESPHome runtime pinned 8 months / 9 minor series behind upstream | `versioning: loose` + `separateMajorMinor: false` on a **calendar-versioned** upstream suppresses the update branch entirely |
| `esp-web-tools@8.0.3` loaded from an unpkg URL in `static/index.md` | No manifest, no `customManagers` regex, no SRI — the dependency is a string in a markdown file |

Every one of these lives in a blind spot the configuration itself created. The pattern to name: **a green dependency dashboard measures the health of what the bot was pointed at, and is routinely mistaken for the health of the repository.** The inverse correlation is worth internalizing — the tidier the automation, the more confidently the untracked surface gets ignored.

Two concrete checks worth running on any Renovate-managed repo:

- **Calendar-versioned deps must not use `versioning: loose`.** Loose has no notion of a year rollover; pairing it with `separateMajorMinor: false` removes the branch that would surface `2025.12 → 2026.8`. A pin that never moves under an otherwise-hot bot is a suppression signal, not a stability signal.
- **Inventory the dependencies with no manifest.** CDN `<script src>` tags, `curl | sh` install lines in workflows, version strings in docs and templates. These are the ones actually shipped to users and the ones nothing is watching. A `customManagers` regex is usually a five-line fix.

### A Required Check That Cannot Fail Loudly (2026-08-31)

From [[bfra-me--ha-addon-repository]]. The `Fro Bot` workflow is a **required status check** on `main` — the strongest signal branch protection can give. Its scheduled autoheal job failed **17 consecutive days** (2026-08-14 → 2026-08-30) without anyone noticing.

The mechanism is worth internalizing because it generalizes to any multi-trigger workflow used as a status check:

1. Branch protection evaluates a check's state **only in the context of a PR's head SHA**.
2. The workflow's job-level `if:` guard skips bot-authored PRs; a skipped job reports as **passing**.
3. Every PR in the repo is Renovate-authored, so the required check is *always* skipped-and-green.
4. `schedule` runs share the workflow name but never attach to a PR head SHA, so their `failure` conclusion is invisible to the gate.

Net: the same workflow name carries two entirely different jobs — a PR reviewer and a nightly autoheal daemon — and the governance surface only observes the one that is structurally incapable of failing. The daemon's death produced zero red anywhere a human looks.

Mitigations, roughly in order of cost:

- **Split the schedule into its own workflow file.** A `Fro Bot Autoheal` workflow that is not a required check is at least legible as a separate red row in the Actions list.
- **Make failure self-reporting.** An `if: failure()` step that comments on the perpetual issue or opens one converts a silent workflow-run conclusion into an artifact in the surface humans actually read. The autoheal daemon already owns an issue; it just can't write to it when it's the thing that's broken.
- **Monitor externally.** A scheduled job elsewhere in the fleet that queries `actions/workflows/*/runs?event=schedule` and alerts on consecutive failures. [[fro-bot--dashboard]] already ingests `metadata/repos.yaml`; scheduled-run health is a natural extension.

Corollary rule: **"required check is green" and "the automation works" are different claims.** Ask which trigger produced the green.

### Renovate Autoclose Erases the Evidence of a Governance Stall (2026-08-31)

From [[bfra-me--ha-addon-repository]]. PR #556 sat open, green, and `REVIEW_REQUIRED` for **106 days**, retargeted upward through eight surveys of the wiki as the definitive artifact of the repo's review deadlock. On 2026-08-30 Renovate **autoclosed it unmerged** — the title now carries Renovate's `- autoclosed` suffix — and the update reappeared as a checkbox under *Rate-Limited* on the Dependency Dashboard.

Nothing was fixed. The record was garbage-collected.

Three transferable points:

1. **PR age is not a durable record.** A dependency bot owns the lifecycle of its own PRs and will recycle them on its own schedule. An auditor arriving after the autoclose sees a tidy queue and no evidence of a 106-day stall. If you are tracking a governance failure, the record has to live somewhere the bot does not control — a wiki survey history, a tracked issue, a metrics snapshot.
2. **A fixed open-PR count is a ceiling, not a measurement.** This repo reported exactly 5 open PRs on every survey from 2026-06-10 through 2026-08-31 while the membership rotated and the dashboard's rate-limited section grew to 6. That is `prConcurrentLimit` behavior, not a 5-item backlog. Reading queue depth off the PR list systematically understates it — always cross-check the Dependency Dashboard's *Rate-Limited* and *Pending Approval* sections.
3. **Dashboard checkboxes are not notifications.** Major-version updates gated behind `dependencyDashboardApproval` (here: `actions/checkout` v7, `home-assistant/tempio` v2026 against a pin that is ~21 months stale) generate no PR, no review request, and no email. They accumulate silently in an issue body. Combine this with the calendar-versioning trap from [[marcusrbrown--esphome-life]] and you get pins that freeze indefinitely under an otherwise-hot bot.

### The `issues: [edited]` No-Op Run Storm (2026-08-31)

From [[bfra-me--ha-addon-repository]]: the `Fro Bot` workflow has **8,471 runs** against an agent that has produced 23 comments in the repo's lifetime; 40,000 total Actions runs on a 31-blob template that has not merged a commit in 107 days. Roughly **1,500 Fro Bot runs fired in a two-day window**, every one concluding `skipped`.

Cause: `fro-bot.yaml` listens on `issues: [opened, edited]` and `renovate.yaml` on `issues.edited`, while Renovate continuously rewrites the Dependency Dashboard issue and retargets PR bodies in the same repo. Each edit dispatches **both** workflows; each boots a runner and evaluates a bot-author guard in the job-level `if:`, then skips.

The guard is correct — its *placement* is the problem. A job-level `if:` is evaluated after the workflow is queued and the runner assigned. GitHub exposes no event-level "sender is not a Bot" filter, so there is no way to decline the trigger.

Mitigations:

- **Drop `edited` from the `issues` trigger** unless there is a concrete reason to react to issue-body rewrites. An agent has essentially no reason to re-run because a bot rewrote a dashboard.
- **Move the guard to the workflow level** where possible; a top-level `if:` on the job still queues, but consolidating multiple jobs behind one guard reduces the multiplier.
- **Treat "a bot that edits an issue" and "a workflow that triggers on issue edits" in the same repo as a self-amplifying loop** and check for it explicitly when onboarding an agent into a Renovate-managed repo.

Cost is not primarily billing (skipped jobs are cheap) — it is queue slots, API budget, and the destruction of the Actions run list as a diagnostic surface. When 99% of runs are no-ops, 17 days of scheduled failures do not stand out. The storm and the silent-death pattern above are the same incident viewed from two angles.

### SHA-Pinning Rules That Only Reject Known-Bad Refs (2026-08-31)

From [[bfra-me--ha-addon-repository]]. Both the repo's PR-review and autoheal prompts instruct the agent to enforce *"SHA-pinned actions (no @latest/@main/@develop)"*. Every action in the repo satisfies that rule. One of them is not SHA-pinned: `home-assistant/builder@2026.03.2` — a mutable tag — in the only job holding `packages: write` + `id-token: write` and performing the cosign signing.

The rule is written as a **denylist of three known-bad refs**, so any ref that merely *looks* like a version passes. Write the rule as an allowlist instead: *the ref must be a 40-character hex SHA, with the human-readable version in a trailing comment.* This applies equally to prompt-encoded policy and to CI assertions.

Second-order finding from the same repo: a companion action, `chrisdickinson/setup-yq`, **is** SHA-pinned but carries no `# vX.Y.Z` comment — and is therefore **absent from Renovate's detected-dependency list entirely**. It is unmaintained upstream (last push 2024-05-15, latest release v1.0.0 from 2019) and is invisible to the abandonment detector too, because abandonment detection only reports on packages Renovate already tracks. The version comment is not cosmetic; it is what makes the pin *legible* to the bot. Pin the SHA **and** annotate the version, or the dependency drops out of governance while looking maximally rigorous.

### Convention Enforcement via Tests

[[marcusrbrown--infra]] introduced a pattern of mechanically enforcing AGENTS.md conventions at CI time via colocated test files (`conventions.test.ts`). Rules marked `(enforced)` in AGENTS.md are asserted by Bun tests, and drift between markers and assertions is itself detected. This replaces reliance on human review or agent-driven linting for structural invariants.

### Shared Config Heritage

Repos across the ecosystem use `@bfra.me/*` packages for formatting and linting configuration, suggesting a shared infrastructure baseline across Marcus's projects.
