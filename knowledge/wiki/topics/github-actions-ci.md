---
type: topic
title: GitHub Actions CI
created: 2026-04-18
updated: 2026-08-10
tags: [github-actions, ci-cd, automation, security, renovate]
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
- [[marcusrbrown--infra]] — Split deploy pipeline (per-app dedicated workflows), convention enforcement tests, Bun workspace CI, Changesets publishing
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

### Convention Enforcement via Tests

[[marcusrbrown--infra]] introduced a pattern of mechanically enforcing AGENTS.md conventions at CI time via colocated test files (`conventions.test.ts`). Rules marked `(enforced)` in AGENTS.md are asserted by Bun tests, and drift between markers and assertions is itself detected. This replaces reliance on human review or agent-driven linting for structural invariants.

### Shared Config Heritage

Repos across the ecosystem use `@bfra.me/*` packages for formatting and linting configuration, suggesting a shared infrastructure baseline across Marcus's projects.
