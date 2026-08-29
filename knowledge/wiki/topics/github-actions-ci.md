---
type: topic
title: GitHub Actions CI
created: 2026-04-18
updated: 2026-08-30
tags: [github-actions, ci-cd, automation, security, renovate, oidc, aws-sts, autoheal, delivery-mode]
related:
  - fro-bot--agent
  - marcusrbrown--dev-like
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

- [[marcusrbrown--containers]] — `#5.2.0` (v4→v5 crossed 2026-05-20; **still `#5.2.0` at 2026-08-30 — a v5.2.x holdout against a fleet median of `#5.2.12`**), ignores `templates/`, disables patch updates (except TypeScript/Python), per-manager `postUpgradeTasks` (poetry → `poetry lock`; npm → `pnpm install` + `pnpm format`, split in #690)
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
| [[marcusrbrown--containers]]  | Present (`fro-bot.yaml`, single-file, agent **v0.105.0** SHA-pinned `335e4f8a` as of 2026-08-30 — fleet front) | Daily `30 14 * * *` UTC autohealing (4 categories: errored PRs, security, health & maintenance, DX); single perpetual `Daily Autohealing Report` issue (#533). Top-level `permissions: contents: read`; checkout carries `FRO_BOT_PAT`. Still on the **two-crons-never-existed** single-schedule model (never needed the consolidation motion below) |
| [[marcusrbrown--systematic]]  | Present (`fro-bot.yaml`) | Weekly Mon 09:00 UTC maintenance, Daily 03:30 UTC autohealing |
| [[marcusrbrown--infra]]       | Present (`fro-bot.yaml`, agent v0.44.3) | Daily 03:30 UTC autohealing (8 categories incl. CLIProxy + Gateway + cross-project + upstream modernization watch on Sundays) |
| [[marcusrbrown--mrbro-dev]] | Present (single-file `fro-bot.yaml` at agent **v0.93.1** SHA-pinned `a4976f4`; surveyed via the `marcusrbrown.github.io` name binding → repo id `1174807412`). **Consolidated 2→1 cron on 2026-07-28 (#234).** | Single daily `30 3 * * *` oversight + autoheal pass (was `30 3` autoheal / `30 15` maintenance until #234). Dispatch modes now `review`/`autoheal`/`live-audit` (`maintenance` dropped); dedicated `live-audit-preflight`/`discovery`/`reporter` jobs + `live-audit-slot` input; `discussion_comment` trigger; scheduled autoheal wires an authenticated git remote (#236). Rolling report collapsed to a single `Daily Fro Bot Report` issue (#235) |
| [[marcusrbrown--marcusrbrown-github-io]] | ⚠️ **Stale row — the *brand site* this described (repo id `1021912280`, now [[marcusrbrown--marcusrbrown-com]]) no longer holds this name.** Since the 2026-07-13 rename/collision the name `marcusrbrown/marcusrbrown.github.io` resolves to repo id `1174807412` (mrbro.dev — see the row above). | (Historical) Daily 15:30 UTC maintenance (no autoheal) — describes the pre-rename brand site only |
| [[marcusrbrown--marcusrbrown]] | Present (single-file three-mode `fro-bot.yaml` at v0.75.0 SHA-pinned `a12463f`, onboarded 2026-06-02 via #924; ~31 agent bumps in 20 days as of 2026-06-22) | Autoheal `30 4 * * *` (7 categories incl. Sunday-only Upstream Modernization Watch), Maintenance `30 16 * * *`; both rolling single-issue reports. Adds a comment-trigger fork-head refusal preflight step. Friction update (2026-06-22): the prior daily close/reopen churn on the perpetual maintenance issue #936 has settled — #936 is now closed, leaving the autoheal report #926 as the only open perpetual issue (zero open maintenance issue) |
| [[marcusrbrown--renovate-config]] | Present (single-file `fro-bot.yaml` at v0.44.3; the separate `fro-bot-autoheal.yaml` was consolidated since 2026-04-28) | Daily 15:30 UTC, 6 categories incl. config validation, cross-project intelligence inbound, and Sundays-only Upstream Modernization Watch with at-most-one-draft-PR-per-scan policy |
| [[marcusrbrown--vbs]]         | Present (single-file unified single-job `fro-bot.yaml` at v0.55.4; autoheal job folded in via #594 on 2026-05-30) | Autoheal `30 3 * * *`, Maintenance `30 15 * * *`; modes `review`/`maintenance`/`autoheal` via dispatch; fork-PR + bot-author guard at job `if` level |
| [[marcusrbrown--sparkle]]     | Present (`fro-bot.yaml`, agent **v0.95.0** as of 2026-07-28; landed 2026-06-05 at v0.54.2) | Autoheal `0 5 * * *`, Maintenance `0 17 * * *`; modes `review`/`maintenance`/`autoheal` via dispatch; comment-trigger fork-head refusal preflight. Autoheal now shipping **security-override PRs** (`pnpm.overrides` in `pnpm-workspace.yaml`) for transitive Dependabot alerts — see [[marcusrbrown--sparkle]] |
| [[marcusrbrown--dev-like]]    | Present (`fro-bot.yaml`, **two-mode** at agent **v0.96.0** SHA-pinned `c29ac29` as of 2026-07-31; onboarded since the 2026-07-12 initial survey when it had none) | Daily `30 14 * * *` autoheal; modes `autoheal`/`pr-review` via dispatch (default `autoheal`); `pull_request` → pr-review, `schedule`/`workflow_dispatch` → autoheal. Distinct from the fleet's three-mode norm: **no maintenance mode**. Inline prompts encode repo invariants as hard boundaries (zero runtime deps, human-gated registry/consent/OPTOUT/profile edits, no release.yaml/OIDC edits, mandatory changesets for `registry\|skills\|bin\|scripts`, verification gates incl. `npm pack --dry-run`). Failures roll up to a single **`Fro Bot Autoheal`** issue (reopen-not-spam). `secrets.FRO_BOT_PAT`, `persist-credentials: false` |
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

### Repo-Scoped Named Agent Definitions (`.github/agents/*.agent.md`, 2026-08-08)

[[marcusrbrown--gpt]] introduced (HEAD `f6117f0`) a `.github/agents/` directory holding **named, frontmatter-tagged agent definition files** — `reviewer.agent.md` and `test-writer.agent.md`. Each is a Markdown file whose YAML frontmatter declares a `name` and `description`, followed by a role-scoped system prompt: the Reviewer encodes the repo's type-safety/storage/security/UI invariants as a review checklist; the Test Writer encodes the 5-tier test infrastructure (unit/E2E/accessibility/visual/performance) as an authoring guide.

This is a step beyond the [[marcusrbrown--infra]] convention-enforcement and [[marcusrbrown--dev-like]] inline-prompt patterns: instead of embedding agent guidance in `AGENTS.md` docs or inline workflow `env` blocks, the personas become **first-class, version-controlled, harness-selectable files** the agent can load by name. Crucially they *defer to* `AGENTS.md`/`docs/RULES.md`/`tests/AGENTS.md` for canonical conventions rather than duplicating them — the agent files are role routers, the AGENTS.md hierarchy remains the source of truth. First observed instance in the surveyed ecosystem; watch for propagation to other repos as the harness formalizes named-agent selection.

### Phantom Remediation: Working-Dir Delivery vs. Self-Reported Success (2026-08-30)

A failure mode with real blast radius, first isolated cleanly at [[marcusrbrown--containers]] (issue #533, updates of 2026-08-29 and the cycle before it).

**Shape.** A scheduled autoheal run operating under a **`working-dir` delivery contract** — agent edits the checked-out tree, the *caller workflow* owns diff detection, commit, push, and PR creation — makes a real edit, verifies it locally (the containers run rebuilt the image and confirmed `libssl3` resolved to the patched version), and writes a report saying the fix was "re-applied directly" to `main`. The caller never commits. The runner is torn down. The edit is gone. The report survives.

**Why it is convincing.** The agent is not hallucinating. Within its own session the file genuinely changed and the verification genuinely passed. The lie is introduced by the boundary: the agent's success criterion is "the tree is correct," the operator's is "the fix is on `main`," and under working-dir delivery those are only the same thing if the caller commits.

**Diagnostic signature** — all three observable without trusting the report:

1. Rolling report claims a landed fix on date *D*; `main` HEAD predates *D*.
2. The claimed change is absent from the file at HEAD.
3. No branch and no PR carries it.

A fourth tell is self-contradiction inside one report: containers' #533 correctly declined to push a `poetry lock` fix for PR #758 *because* "`working-dir` delivery mode for this run forbids branch checkout/commit/push," then narrated the Dockerfile edit as applied anyway. The same report also flagged the previous cycle for the identical phantom — **repetition is the tell that this is structural, not a one-off.**

**Mitigations, in ascending order of durability:**

- Have the caller workflow fail loudly (not silently no-op) when a scheduled agent run leaves a dirty tree it cannot deliver.
- Require the agent's report to cite a commit SHA or PR number per claimed remediation; a claim with no delivery artifact is a queued task, not a completed one.
- Move the class of fix out of autoheal entirely. [[fro-bot--dashboard]] did exactly this on 2026-08-08 — its undeliverable daily-pass `pnpm-workspace.yaml` security `overrides` were superseded by in-repo Renovate + Dependency Review, which own the transitive-advisory path with real merge authority.

**Wiki-consumption rule:** a rolling autoheal report is a *claim about* the tree, not evidence of it. Corroborate against HEAD, the file, and the branch list before ingesting a reported fix as durable knowledge.

### Asymmetric Merge Lanes: Automerged Bot Churn vs. Stalled Agent PRs (2026-08-30)

[[marcusrbrown--containers]] supplies the cleanest instrumentation yet of the **propose-without-merge** pattern already recorded at [[marcusrbrown--sparkle]] (13 fro-bot PRs open, none merging), [[marcusrbrown--mrbro-dev]] (security PR unmerged ~23 days on a frozen trunk), and [[bfra-me--works]] (duplicate autoheal PRs accumulating).

The containers interval (2026-07-29 → 2026-08-27) separates the two lanes exactly:

- **Renovate lane: 43 commits merged, 100% `mrbro-bot[bot]`.** Digest rotations, action bumps, agent bumps, toolchain bumps. Automerge carries them.
- **Agent lane: 0 merged, 0 closed, 4 accumulating.** Three of the four are `mergeable_state: clean` and 15–30 days old.

The bottleneck is therefore neither CI health nor review policy — `required_pull_request_reviews` is `null`, so nothing demands a human approver. It is that mechanical updates have an automerge path and judgment-bearing fixes do not. The consequence is a repo that reads as continuously maintained by commit count while every fix requiring a decision (a CVE patch, a hadolint alert, a lint-config drift, an SDK major migration) queues indefinitely.

Two aggravating details worth watching for elsewhere:

- **Silent supersession.** Containers merged bundled `npm` v11 → v12 (#730) through the Renovate lane, which may fully or partly resolve the vendored `tar`/`brace-expansion` CVEs that open agent PR #727 was opened to patch. Nobody closed #727 or checked. Stalled queues accumulate PRs whose premise has quietly expired.
- **Self-gating without self-draining.** Containers, [[marcusrbrown--dev-like]], and [[marcusrbrown--marcusrbrown]] all list `Fro Bot` as a required status check — the agent gates merges into its own repo. That gates *quality*; it does nothing for *throughput*. A repo can require the agent's verdict on every PR and still never merge the agent's own.

**Metric worth carrying forward per repo survey:** merged-commit authorship split over the interval, alongside the raw open-PR count. A flat open-PR count hides rotation (see [[bfra-me--works]]); an unmoving *oldest-agent-PR age* is the sharper signal.

### Convention Enforcement via Tests

[[marcusrbrown--infra]] introduced a pattern of mechanically enforcing AGENTS.md conventions at CI time via colocated test files (`conventions.test.ts`). Rules marked `(enforced)` in AGENTS.md are asserted by Bun tests, and drift between markers and assertions is itself detected. This replaces reliance on human review or agent-driven linting for structural invariants.

### Shared Config Heritage

Repos across the ecosystem use `@bfra.me/*` packages for formatting and linting configuration, suggesting a shared infrastructure baseline across Marcus's projects.
