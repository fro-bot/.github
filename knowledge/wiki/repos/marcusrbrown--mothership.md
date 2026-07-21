---
type: repo
title: "marcusrbrown/mothership"
created: 2026-07-06
updated: 2026-07-21
sources:
  - url: https://github.com/marcusrbrown/mothership
    sha: 48bd14a2b8735d35c7737716a512b9b365adcc27
    accessed: 2026-07-06
  - url: https://github.com/marcusrbrown/mothership
    sha: e7e305f1efa18017a50789e447b2d440803be296
    accessed: 2026-07-21
tags: [tauri, rust, react, typescript, opencode, space-bus, mcp, agentic-ide, dockview, bun, biome, localhost-only, dogfood, impeccable, mvp, fro-bot, changesets, code-signing, renovate, codeql, scorecard, release-engineering]
aliases: [mothership]
related:
  - fro-bot--space-bus
  - fro-bot--agent
  - fro-bot--dashboard
  - marcusrbrown--systematic
  - marcusrbrown--infra
  - opencode-plugins
  - github-actions-ci
---

# marcusrbrown/mothership

**Mothership** — a multimodal agentic IDE: a Tauri v2 desktop app (React 19 + TypeScript webview, Rust core) that renders a workspace of OpenCode agents as an adaptive panel layout. Its own tagline: _"The craft the fleet reports back to."_ Architecturally it is a **renderer for the bus** — `opencode serve` owns all agent state, [[fro-bot--space-bus]] is the control plane, and Mothership is a thin multiplexing client that turns a workspace into a dockview panel layout and exposes that layout as `ide_*` MCP tools so any agent can drive the UI.

## Overview

| Attribute        | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Created          | 2026-07-05 (latest survey 2026-07-21, HEAD `e7e305f`; initial survey 2026-07-06, HEAD `48bd14a`) |
| Last push        | 2026-07-21                                                                     |
| Description      | Multimodal agentic IDE — Tauri v2 workspace mission control for OpenCode agents on space-bus |
| Language         | JavaScript (GitHub primary language; substance is TypeScript + Rust)           |
| Runtime          | Bun (package manager + runtime; also runs the `ide_*` sidecar) + Rust/Tauri v2 |
| Package manager  | Bun (`bun.lock`, `bun install`)                                               |
| Package          | `mothership` — **private, unpublished** (`"private": true`, `version: 0.1.0`)  |
| License          | MIT (`LICENSE` file present at root)                                           |
| Visibility       | Public                                                                         |
| Stars            | 1                                                                              |
| Watchers / Forks | 1 / 0                                                                          |
| Open issues      | 6 (was 1 at 2026-07-06)                                                        |
| Topics           | (none set)                                                                     |
| Status           | Tracer-plus — shell runs (opens a `spacebus.json` workspace, streams live session state, dispatches to a control agent, exposes `ide_*` MCP tools) **and now carries a full v0.1 release-engineering apparatus** (signed/notarized macOS pipeline, Changesets versioning, tag rulesets, CODEOWNERS, release runbooks). Read-only/diff code view, Storybook panels, and MCP Apps skill panels still planned but not yet built |

## What it is

The app is a **thin client over a directory-routed `opencode serve`** (the same server line that [[fro-bot--space-bus]] rides). Three ideas carry the design:

1. **Mechanical project detection** — detectors produce a typed interface manifest that hydrates panels. No LLM, no network calls in the detection path.
2. **Structural dogfooding** — the app exposes its own layout as MCP tools (`ide_*`) so any agent can rearrange the UI. Layout parity is an invariant: every UI mutation is also an MCP tool, and vice versa, through one typed command layer.
3. **Skill panels ride a standard** — skill-provided panels use the MCP Apps standard (SEP-1865) rendered in sandboxed iframes over postMessage JSON-RPC, not a bespoke plugin format.

```
                        ┌───────────── Mothership (Tauri v2) ─────────────┐
 any agent ──MCP──▶ ide_* tools │ dockview: roster · sessions · transcript │
                                │ terminal · Tiptap prompt bar · audit log  │
                        └───────────────┬──────────────────────────────────┘
                                        │ HTTP + SSE (127.0.0.1 only)
                                        ▼
                              opencode serve :4096  ◀── space-bus control agent
                                        │ x-opencode-directory
                                        ▼
                        agent · dashboard · control-plane · infra · …
```

The app opens the workspace named by `MOTHERSHIP_WORKSPACE` (or the launch directory), pointed at any directory containing a [[fro-bot--space-bus]] `spacebus.json` roster.

## Invariants (from AGENTS.md — the review contract)

The `AGENTS.md` Invariants section is the canonical contract; the Fro Bot review prompt cites it directly:

- **Renderer for the bus:** `opencode serve` owns all agent state. The app holds UI state only (layout, panel prefs). Persisting sessions/transcripts/agent memory in the app is forbidden.
- **Layout parity:** every layout mutation in the UI is available as an `ide_*` MCP tool and vice versa; UI and MCP handlers call the same typed command functions.
- **No embedded model:** the app never calls an LLM. Natural language becomes typed commands in whatever agent received it.
- **Mechanical detection:** the detector → interface-manifest path has no LLM and no network calls.
- **Localhost only:** all server/bus traffic to `127.0.0.1`/`::1`; credentials from env only; no telemetry, no off-machine calls at runtime.
- **Skill panels are sandboxed:** MCP Apps content renders only in sandboxed iframes over postMessage JSON-RPC — no skill code in the main webview context.
- **Design for deletion:** panels are self-contained; a panel type should be removable in one commit.
- **Tokens-only styling:** components style exclusively from `src/styles/tokens.css` (seeded from `design/tokens.css`) — no ad-hoc hex, no inline color literals. Enforced by the Impeccable design gate.

## Tech Stack

| Layer             | Technology                                                                        |
| ----------------- | --------------------------------------------------------------------------------- |
| Desktop shell     | Tauri v2 (`@tauri-apps/api` ^2, `@tauri-apps/cli` 2.11.4, `@tauri-apps/plugin-opener` ^2 — renamed from `tauri-plugin-opener` since 2026-07-06) |
| Frontend          | React 19.1 + React DOM 19.1, TypeScript ~5.8.3                                     |
| Build             | Vite ^7.0.4 + `@vitejs/plugin-react`                                              |
| Layout engine     | dockview ^7.0.2 + dockview-react (imperative panel API behind a typed command layer) |
| Prompt bar        | Tiptap ^3 (`core`, `react`, `starter-kit`, `extension-mention`, `pm`, `suggestion`) — `@`-mentions |
| Terminal          | `@xterm/xterm` ^6 + `@xterm/addon-fit` + `@xterm/addon-webgl`                     |
| Bus/server client | `@fro.bot/space-bus` 0.14.0 (pinned; contract + core library surface — was 0.7.0 at 2026-07-06, +7 minors in ~2 weeks; `workspace/tauri-fs.ts` now also consumes `@fro.bot/space-bus/attach` `resolveManagedServer`) |
| MCP               | `@modelcontextprotocol/sdk` 1.29.0 (`ide_*` server + bridge)                      |
| Boundary parsing  | zod ^4.4.3                                                                        |
| Rust core         | tauri 2, `tauri-plugin-opener` 2, serde/serde_json 1, `portable-pty` 0.9, uuid 1 (v4) |
| Test              | `bun test` (TS decision fns), `cargo test` (Rust decision fns); `vite.config.test.ts` present alongside `vite.config.ts` |
| Versioning        | Changesets (`@changesets/cli` 2.31.1); `scripts/sync-version.ts` converges `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` to one semver; `version.yml` opens the "Version Packages" PR (2026-07-21) |
| Lint/format       | Biome ^1.9.4 (`biome check`) — diverges from the `@bfra.me/*` ESLint+Prettier ecosystem, aligns with [[marcusrbrown--systematic]] / [[fro-bot--space-bus]] Bun+Biome shape |
| Design gate       | Impeccable `@3.2.0` (`impeccable detect`) — hard CI gate; skill installed at `.agents/skills/impeccable/` |

Note the pins still predate the ecosystem's TypeScript 6 / Biome 2 sweep: `typescript` `5.8.3`, Vite `7.3.6`, `@biomejs/biome` `1.9.4`. As of 2026-07-21 **Renovate is now onboarded** (`renovate.json5` extends `marcusrbrown/renovate-config#5.2.4` + `renovate.yaml` calling `bfra-me/.github`'s shared workflow), so these will move on Renovate's cadence — the config even carries the same `skipArtifactsUpdate` + `postUpgradeTasks: bun install` bun.lock workaround [[fro-bot--space-bus]] uses, and disables the phantom `--yes impeccable` dep that the shared preset mis-parses from the `npx --yes impeccable@3.2.0` design-gate invocation.

## Repository Structure

```
mothership/
├── src/                         # React front end
│   ├── App.tsx, main.tsx
│   ├── app/                     # app shell wiring
│   ├── layout/                  # typed command layer (one executor owns dockview's imperative API;
│   │                            #   UI + MCP both call it), panel registry, layout persistence, WS bridge to sidecar
│   ├── panels/                  # one dir per panel type — each removable in one commit
│   │   ├── roster/  sessions/  transcript/  terminal/  audit-log/  placeholder/
│   ├── detect/                  # detectors + interface-manifest types (no LLM, no network)
│   ├── server/                  # opencode client, SSE demux, reconcilable session store
│   ├── workspace/               # spacebus.json parsing (localhost-guarded) + BusContext
│   ├── promptbar/               # Tiptap prompt bar with @-mentions
│   ├── styles/                  # tokens.css (seeded from design/tokens.css)
│   └── smoke.test.ts
├── src-tauri/                   # Rust core
│   ├── Cargo.toml, Cargo.lock, build.rs, tauri.conf.json
│   ├── src/                     # process supervision (opencode serve, PTYs, ide_* sidecar), FS commands, window mgmt
│   ├── capabilities/  icons/
├── sidecar/ide-server/          # Bun MCP server + WS bridge (the ide_* boundary)
├── scripts/                     # ide-mcp-config.ts, ide-mcp-bridge.ts (MCP config/stdio bridge)
│   ├── release-policy.ts        # pure event/ref/tag eligibility shape check (+ .test.ts)
│   ├── verify-release-settings.ts  # asserts ruleset + protected `release` env exist (+ .test.ts)
│   ├── apply-release-settings.ts   # idempotently applies release-critical repo settings (+ .test.ts)
│   ├── sync-version.ts          # converges package.json / tauri.conf.json / Cargo.toml semver (+ .test.ts)
│   └── validate-updater-manifest.ts  # updater manifest validation (+ .test.ts)
├── spikes/                      # de-risk harnesses: 0a-iframe-stress, 0b-pty, 0c-server-connectivity
├── design/                      # systematic-banner.svg, systematic.theme.json, tokens.css (seed)
├── public/                      # static assets (new since 2026-07-06)
├── .changeset/                  # config.json + README.md (Changesets, private-app mode, no npm publish)
├── docs/
│   ├── brainstorms/             # 2026-07-03 workspace-mission-control-requirements (R1–R15),
│   │                            #   2026-07-05 product-identity-release-preparedness-requirements (R1–R18)
│   ├── plans/                   # 2026-07-04 tracer-bullet plan, 2026-07-05 reliability-track plan
│   ├── release/                 # signing-key-custody, v0-1-checklist, v0-1-release-runbook,
│   │                            #   v0-1-rollback-procedure, v0-1-post-release-smoke-checklist
│   └── solutions/               # best-practices/, documentation-gaps/, integration-issues/ (YAML frontmatter)
├── .agents/skills/              # installed Impeccable skill
├── .impeccable/config.json      # detector allowlist for documented brand exceptions
├── .github/
│   ├── workflows/               # ci.yaml, fro-bot.yaml, release.yaml, version.yml, renovate.yaml,
│   │                            #   codeql.yaml, scorecard.yaml, dependency-review.yaml
│   ├── rulesets/v0-1-release-tags.json  # protects v*.*.* tags (deletion/non-ff/update/required checks)
│   ├── CODEOWNERS               # @marcusrbrown owns release-critical paths
│   └── renovate.json5
├── AGENTS.md  ARCHITECTURE.md  STRUCTURE.md  DESIGN.md  PRODUCT.md  HANDOFF.md  CHANGELOG.md  README.md
├── biome.json  tsconfig.json  tsconfig.node.json  vite.config.ts  vite.config.test.ts  index.html
└── LICENSE  bun.lock  package.json
```

New root docs since 2026-07-06 (release-preparedness epic R1–R18): `ARCHITECTURE.md` (renderer-for-the-bus thesis + where each invariant is enforced in code, with a mermaid runtime topology), `STRUCTURE.md` (navigation map of `src/`, `src-tauri/src/`, `sidecar/ide-server/`), and `CHANGELOG.md` (Changesets-generated).

## The `ide_*` MCP Tool Surface

Mothership exposes its layout as MCP tools so any OpenCode agent can drive the UI:

- **Mutations:** `ide_open_panel`, `ide_split`, `ide_focus`, `ide_move_panel`, `ide_set_layout`, `ide_close_panel`
- **Read-only:** `ide_list_panels`, `ide_get_layout`

Every mutation appears in the in-app **audit log** with its source. The sidecar (`sidecar/ide-server/`) binds a **random loopback port with a per-launch bearer token**, written to a `0600` rendezvous file at `~/Library/Application Support/com.marcusrbrown.mothership/ide-bridge.json`. `scripts/ide-mcp-config.ts` prints the ready-to-paste config for the current launch; `scripts/ide-mcp-bridge.ts` is a `type: local` MCP entry that re-reads the rendezvous file each start and proxies `ide_*` over stdio — persistent wiring that survives port/token rotation across restarts.

Security carve-outs: read tools return only panel structure and display names — **never filesystem paths or credentials** — and agents **cannot open a terminal panel** through `ide_*` (no subprocess reach).

## CI/CD Pipeline

### Workflows (8 present — was 2 at 2026-07-06)

The `.github/` surface matured dramatically between surveys. All six of the workflows below joined `ci.yaml` + `fro-bot.yaml`, resolving nearly every 2026-07-06 "Open Thread" about missing supply-chain and release automation:

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PR + push to `main`, dispatch | Design Check (permanent gate) + `verify` matrix (typecheck/lint/test) + **Release Config Smoke** (new) + Check Workflows (actionlint) |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (daily 06:15 UTC), dispatch | PR review, daily oversight + autohealing (single unified run); agent bumped `v0.83.1` → **`v0.93.1`** |
| Release | `release.yaml` | version tag push (`v*.*.*`) or maintainer dispatch | Signed/notarized macOS release pipeline — the **only** workflow that touches Apple signing / updater keys (new) |
| Version | `version.yml` | push to `main` | Opens/updates the Changesets "Version Packages" PR; never builds or signs (new) |
| Renovate | `renovate.yaml` | issue/PR edit, non-main push, `workflow_run` after CI, dispatch | Calls `bfra-me/.github` shared Renovate workflow `@v4.16.37` (new) |
| CodeQL | `codeql.yaml` | PR, push `main`, weekly (Wed 07:31), dispatch | `javascript-typescript` + `actions` analysis, `+security-and-quality` (Rust deferred pending a macOS lane) (new) |
| Scorecard | `scorecard.yaml` | branch-protection-rule, weekly (Tue 07:20), push `main` | OSSF Scorecard supply-chain scan, publishes SARIF (new) |
| Dependency Review | `dependency-review.yaml` | PR to `main` | `actions/dependency-review-action`, `fail-on-severity: high` (new) |

Still **no Probot `settings.yml`** — release-critical repo settings are instead managed in code by `scripts/apply-release-settings.ts` / `verify-release-settings.ts` plus `.github/rulesets/v0-1-release-tags.json` and `CODEOWNERS`, a different (script-driven) posture than the fleet's `common-settings.yaml` inheritance.

### `ci.yaml` jobs

- **Design Check** — `npx --yes impeccable@3.2.0 detect --json src` must return `[]`; armed but no-op if `src/` absent. Permanent design gate enforcing tokens-only styling.
- **verify** (matrix: `typecheck`, `lint`, `test`) — `bun install --frozen-lockfile` then `bun run <check>`; armed but no-op if `package.json` absent.
- **release-smoke** (**Release Config Smoke**, new) — no-secrets sanity of the release apparatus: `version:check`, `release-policy.ts` against a synthetic eligible context (`--ref refs/tags/v0.0.0-ci-smoke`), a Tauri release-config parse (strict CSP, updater pubkey), and entitlements-separation check. This is one of the six required-check contexts the release pipeline's preflight demands.
- **check-workflows** — `raven-actions/actionlint` for workflow linting.

All third-party actions are SHA-pinned with version comments. Strict bash defaults (`bash -Eeuo pipefail`), `contents: read` least-privilege per job, `cancel-in-progress` only off `main`.

### Release pipeline (`release.yaml`) — the trust-boundary centerpiece

A deliberately gated, secrets-minimizing macOS signing pipeline. The design worth remembering:

- **Narrow trigger surface** — only a protected `v*.*.*` tag push or explicit maintainer `workflow_dispatch` (required `version` input). No `pull_request`, `pull_request_target`, `workflow_run`, or `workflow_call` trigger exists. `scripts/release-policy.ts` re-checks eligibility as job 1 regardless of what the trigger config claims.
- **Tag SHA is resolved, never trusted from the ref** — on dispatch, `github.sha` is whatever branch the maintainer ran from; the pipeline resolves `refs/tags/<tag>` via the API (dereferencing annotated tags) so every downstream job operates on the exact tagged commit.
- **Pre-secrets preflight** — `required-check-preflight` verifies via the **Checks API** (not the legacy combined-status endpoint, which silently ignores check-run-only results) that all six required contexts (`typecheck`, `lint`, `test`, `Design Check`, `Check Workflows`, `Release Config Smoke`) passed on the tagged SHA, and that release-critical repo settings are actually configured (`verify-release-settings.ts`).
- **Secrets isolated to one job** — only `sign-and-notarize`, gated behind a protected `release` GitHub Actions environment (required reviewers), sees Apple certificate / updater-key secrets. `build` runs unsigned with `createUpdaterArtifacts:false` (Tauri fails closed if it sees a public key but no private key); the updater archive+signature are produced only in the gated job. Decoded certs are wiped via `trap … EXIT`.
- **Bogus-tag guards** — multiple jobs refuse to proceed if the resolved tag is `main` or not shaped like `vX.Y.Z`, so a failed-open version resolution can't ship a mainline-named build.
- **Serial concurrency** (`group: release`, `cancel-in-progress: false`) — one release at a time repo-wide.

`docs/release/` documents the human side: `signing-key-custody.md`, `v0-1-checklist.md` (R-tagged burn-down), `v0-1-release-runbook.md`, `v0-1-rollback-procedure.md`, `v0-1-post-release-smoke-checklist.md`. The tag ruleset `v0-1-release-tags.json` protects `refs/tags/v*` with deletion / non-fast-forward / update / required-status-checks rules.

## Fro Bot Integration

**Fro Bot workflow is present and active** (`fro-bot.yaml`, pinned `fro-bot/agent@a4976f45… # v0.93.1` at 2026-07-21 — was `v0.83.1` at 2026-07-06). This is a mature, repo-specific configuration, reflecting that mothership was scaffolded with the current fleet workflow template rather than growing one incrementally.

Structural shape (the dominant fleet pattern — single unified job, mode routed by prompt):

- **Triggers:** `issue_comment`, `pull_request_review_comment`, `issues` (opened/edited), `pull_request` (opened/synchronize/ready_for_review/reopened/review_requested), `schedule` (`15 6 * * *` — 06:15 UTC daily), `workflow_dispatch` (optional `prompt` input).
- **Concurrency:** keys on PR head SHA (each push gets its own slot), else issue/PR number, else a shared `daily` slot for schedule/dispatch — a more granular key than the hardcoded-string groups in older sibling workflows.
- **Guards:** fork-PR head guard, bot-author skip, `OWNER`/`MEMBER`/`COLLABORATOR` gating on comments and issues, explicit `fro-bot` self-exclusion. Always checks out the **default/workflow ref, never PR-head code** (`persist-credentials: false`), closing the `issue_comment` secret-exfiltration vector that the inline comment calls out explicitly.
- **Prompt routing:** `workflow_dispatch` with a non-empty `prompt` wins first; else schedule/dispatch → `SCHEDULE_PROMPT`; else `pull_request` → `PR_REVIEW_PROMPT`. This is the same **bare-prompt-dispatch-wins-first** fix landed in [[marcusrbrown--vbs]] (#662) and [[marcusrbrown--marcusrbrown]] (#1045) — present from the start here, not retrofitted.

### PR review prompt (`PR_REVIEW_PROMPT`)

A skeptical single-pass reviewer keyed to the AGENTS.md Invariants as the review contract. Explicitly **forbids invoking `ce:review` / any `ce:*` skill** (author runs `ce:review` before pushing; repeating it in review is redundant). Priority scope: invariant violations (app persisting server-owned state, LLM calls from the app, detector network access, non-localhost traffic, credentials outside env/IPC, skill-panel iframe escape, non-removable panel types, layout/MCP parity gaps); the `ide_*` sidecar security boundary (token rendezvous, WS first-frame auth, allowlist read serializers — credentials must never appear in tool responses or persisted layout); React StrictMode double-mount lifecycles, session-store reconcile/race paths, Rust supervisor transitions, zod boundary parsing; tokens-only styling; SHA-pinned workflow changes; and public-copy hygiene (**never the word "fleet"**, OpenCode confined to architecture docs, no present-tense claims for unshipped capability). Structured output: `## Verdict: [PASS | CONDITIONAL | REJECT]` → Blocking issues → Non-blocking concerns → Missing tests → Risk assessment.

### Daily oversight + autoheal (`SCHEDULE_PROMPT`)

A single run doing **both** proactive oversight and reactive autohealing. Six categories: (1) Errored PRs, (2) Security, (3) Code Quality, (4) Workflow Integrity, (5) Progressive Improvement (report-only), (6) Cross-Project Intelligence (report-only). Notable specifics:

- **Tooling constraint honesty:** the runner has Bun + Node but **not the Tauri system libraries** — the prompt forbids `cargo` commands (they fail on missing `webkit2gtk`) and treats Rust as review/report-only. This is a repo-specific adaptation absent from the JS-only sibling repos.
- **Pinned design gate:** all impeccable invocations must pin `@3.2.0` (a floating `npx impeccable` resolves to an older major that false-positives documented brand exceptions in `.impeccable/config.json`).
- **Release-preparedness tracking:** category 5 reads `docs/brainstorms/2026-07-05-product-identity-release-preparedness-requirements.md` (R1–R18) and reports which epic requirements have landed (LICENSE, ARCHITECTURE.md, STRUCTURE.md, community files, release workflow, Changesets, signed-build pipeline), the `@fro.bot/space-bus` pin vs latest npm, and `design/tokens.css` (seed) vs `src/styles/tokens.css` drift.
- **Public-copy guardrail:** never introduce "fleet" into public copy; never rewrite PRODUCT.md/DESIGN.md positioning voice beyond mechanical fixes. (Note the irony: the README tagline and space-bus lineage lean on "fleet" framing internally, but the guard bars it from _public positioning copy_ specifically.)
- **One perpetual report issue:** maintains exactly one open `Daily Fro Bot Report — YYYY-MM-DD (UTC)` issue, closing older ones with a link to the newest.

Hard boundaries mirror the fleet: no force-push, no direct main pushes (only existing non-default PR branches under categories 1–2), no merging/approving PRs, no disabling tests/lowering thresholds to pass checks.

## Design System

Systematic / Fro Bot lineage — **afrofuturism × cyberpunk, dark-default, cyan/magenta/orange with strict intent**. `PRODUCT.md` + `DESIGN.md` are the Impeccable design context; tokens live in `design/tokens.css` (seed) and `src/styles/tokens.css` (runtime). The Impeccable skill is installed at `.agents/skills/impeccable/` and CI runs `impeccable detect` as a hard gate. Intentional brand exceptions get scoped entries in `.impeccable/config.json`, never rule-wide disables. This is the same design-gate pattern seen in [[fro-bot--dashboard]] (Design Check `impeccable`).

## Relationship to the Fro Bot Ecosystem

- **[[fro-bot--space-bus]]** — the control plane Mothership renders. Mothership pins `@fro.bot/space-bus` 0.7.0 and consumes its `/contract` + `/core` library surface for schemas and reads. space-bus is the _tasking_ plane (control agent delegates via `bus_*` tools); Mothership is the _visual mission-control_ surface over the same directory-routed `opencode serve`. Where [[fro-bot--dashboard]] is the read-only web observation plane, Mothership is the interactive desktop cockpit.
- **[[fro-bot--agent]]** — the runtime powering the Fro Bot workflow (agent v0.83.1). Both ride the same OpenCode server line; the cross-project intelligence check watches agent release notes and workflow-example evolution.
- **[[marcusrbrown--systematic]] / [[fro-bot--space-bus]]** — shares the Bun + Biome + zod toolchain shape (diverging from the `@bfra.me/*` ESLint+Prettier ecosystem), and the `ce:*` systematic workflow lineage referenced in the review prompt.
- **[[marcusrbrown--infra]]** — a sibling bus target and the fleet's deploy/infra plane; cross-project intelligence learns from its conventions.
- **[[opencode-plugins]]** — Mothership rides the OpenCode server API and the MCP `tool()` surface; the `ide_*` tools + sidecar bridge are an MCP integration pattern parallel to space-bus's `.opencode/tools/` custom tools.

## Notable Patterns

- **App-as-MCP-server (structural dogfooding):** the UI's own layout is an MCP tool surface, so the same agents the app renders can also rearrange it. Layout parity is enforced as an invariant, not a convention.
- **Renderer, not owner:** a deliberate no-persistence stance — the app is stateless w.r.t. agent/session data; the server is the single source of truth. This inverts the usual IDE model where the editor owns project state.
- **Design-for-deletion panels:** one directory per panel type, each removable in a single commit — an unusually strict modularity contract.
- **Spike-first de-risking:** `spikes/` (iframe stress, PTY, server connectivity) de-risked the platform before the tracer bullet — same phased-verification discipline as [[fro-bot--space-bus]]'s Phase 0 smoke spike.
- **Rust-review-only in CI:** the Fro Bot autoheal prompt encodes the runner's lack of Tauri system libs as a hard constraint, treating Rust as report-only — a rare example of a workflow prompt honestly scoping its own tooling limits.
- **Release-preparedness epic in the prompt:** the daily pass tracks a documented v0.1 daily-driver release epic (R1–R18) as report-only progressive improvement — the workflow is aware of the roadmap.

## Open Threads / To Re-confirm Next Survey

### Resolved since 2026-07-06

- **Renovate / CodeQL / Scorecard / dependency-review — all landed** (2026-07-21). Renovate extends `marcusrbrown/renovate-config#5.2.4`; CodeQL, Scorecard, and dependency-review workflows are present and SHA-pinned. The prior "no supply-chain automation" thread is closed.
- **v0.1 release-preparedness epic — substantially landed:** `ARCHITECTURE.md`, `STRUCTURE.md`, `CHANGELOG.md`, Changesets config, `version.yml` (Version Packages PR), the signed/notarized `release.yaml` pipeline, `docs/release/` runbooks, `CODEOWNERS`, and the `v0-1-release-tags` ruleset are all in place. Remaining: confirm the `release` protected environment is configured live and run the `docs/release/v0-1-checklist.md` burn-down against an actual draft/published release.

### Still open

- **Probot Settings** — still no `.github/settings.yml`. Repo settings are managed by script (`apply-/verify-release-settings.ts` + rulesets + CODEOWNERS) rather than `common-settings.yaml` inheritance. Confirm whether the fleet expects this repo to adopt Probot Settings or keep the script-driven posture.
- **`@fro.bot/space-bus` pin (now 0.14.0):** was 0.7.0 at 2026-07-06 (0.0.0 unpublished at the 2026-07-03 space-bus survey) — +7 minors in ~2 weeks. Confirm lockstep and update the [[fro-bot--space-bus]] page's version trail next survey.
- **Toolchain pins (`typescript 5.8.3`, `vite 7.3.6`, `@biomejs/biome 1.9.4`):** still predate the fleet's TS 6 / Biome 2 sweep — now that Renovate is onboarded, watch for the driven catch-up.
- **Planned-but-unbuilt surfaces:** read-only/diff code view, Storybook panels, MCP Apps skill panels (SEP-1865) — still not built (ARCHITECTURE.md confirms sandboxed skill panels remain a planned panel type). Track when they land.
- **Rust CodeQL deferred:** the CodeQL matrix covers `javascript-typescript` + `actions` only; Rust analysis waits on a macOS build lane (Tauri system-lib build fails on `ubuntu-latest`) — the same tooling constraint the daily autoheal prompt already encodes.

## Survey History

| Date       | HEAD      | Notes                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| 2026-07-21 | `e7e305f` | Re-survey. Major CI/CD + release-engineering maturation in ~2 weeks: workflows 2→8 (added `release.yaml` signed/notarized macOS pipeline with a protected `release` environment + Checks-API required-check preflight + resolved-tag-SHA discipline, `version.yml` Changesets Version PR, `renovate.yaml`, `codeql.yaml`, `scorecard.yaml`, `dependency-review.yaml`; `ci.yaml` gained a Release Config Smoke gate). Release-preparedness epic largely landed: `ARCHITECTURE.md`, `STRUCTURE.md`, `CHANGELOG.md`, Changesets, `CODEOWNERS`, `v0-1-release-tags` ruleset, `docs/release/` runbooks, `scripts/{release-policy,verify-/apply-release-settings,sync-version,validate-updater-manifest}.ts`. Renovate onboarded (`renovate-config#5.2.4`). `@fro.bot/space-bus` 0.7.0→0.14.0; `tauri-plugin-opener`→`@tauri-apps/plugin-opener`; Fro Bot agent v0.83.1→v0.93.1. Open issues 1→6. Still no Probot Settings; Rust CodeQL deferred. |
| 2026-07-06 | `48bd14a` | Initial survey. New repo (created 2026-07-05), public, MIT, private/unpublished Bun/TS + Rust/Tauri v2 package. Tracer-stage multimodal agentic IDE rendering a directory-routed `opencode serve` workspace via dockview; exposes layout as `ide_*` MCP tools (loopback + per-launch bearer token rendezvous); space-bus 0.7.0 as the bus client. **Fro Bot workflow present** (`fro-bot/agent@v0.83.1`, unified single-run oversight+autoheal, 06:15 UTC) + CI (Impeccable design gate, verify matrix, actionlint). **No Renovate / no Probot Settings / no CodeQL** yet. |
