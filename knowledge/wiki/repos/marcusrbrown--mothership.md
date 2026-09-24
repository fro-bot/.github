---
type: repo
title: marcusrbrown/mothership
created: 2026-07-06
updated: 2026-09-08
node_id: R_kgDOTOX0_A
sources:
  - url: https://github.com/marcusrbrown/mothership
    sha: 48bd14a2b8735d35c7737716a512b9b365adcc27
    accessed: 2026-07-06
  - url: https://github.com/marcusrbrown/mothership
    sha: e7e305f1efa18017a50789e447b2d440803be296
    accessed: 2026-07-21
  - url: https://github.com/marcusrbrown/mothership
    sha: 739f23065e786f59a91c5fd9164edb1a5e0bb847
    accessed: 2026-08-22
  - url: https://github.com/marcusrbrown/mothership
    sha: 8895732b6b3a0f88fd3bf51117beeec985791fc5
    accessed: 2026-09-08
tags:
  - tauri
  - rust
  - react
  - typescript
  - opencode
  - space-bus
  - mcp
  - agentic-ide
  - dockview
  - bun
  - biome
  - localhost-only
  - dogfood
  - impeccable
  - mvp
  - fro-bot
  - changesets
  - code-signing
  - renovate
  - codeql
  - scorecard
  - release-engineering
  - agent-native
  - planning-lifecycle
  - mcp-principal
  - slsa-provenance
  - dependency-dashboard-approval
  - working-dir-delivery
aliases:
  - mothership
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

**Mothership** — a multimodal agentic IDE: a Tauri v2 desktop app (React 19 + TypeScript webview, Rust core) that renders a workspace of OpenCode agents as an adaptive panel layout. Its own tagline: _"The craft your agents report back to."_ (README wording as of 2026-09-08; the page previously recorded _"The craft the fleet reports back to"_ — the public-copy guard bars "fleet" from positioning copy, so the current wording is the guard applied to the tagline itself.) Architecturally it is a **renderer for the bus** — `opencode serve` owns all agent state, [[fro-bot--space-bus]] is the control plane, and Mothership is a thin multiplexing client that turns a workspace into a dockview panel layout and exposes that layout as `ide_*` MCP tools so any agent can drive the UI.

As of the 2026-09-08 survey the `ide_*` surface has doubled from layout control into **session control** (17 tools: 8 layout + 9 session), and a `src/planning/` subsystem has begun landing under an explicitly contract-first, prove-before-enable methodology. The repo's own working notes are the first place in this wiki where the **MCP agent-principal handoff gap in the [[fro-bot--agent]] OpenCode runtime** is written down precisely.

## Overview

| Attribute        | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Created          | 2026-07-05 (latest survey 2026-09-08, HEAD `8895732`; prior 2026-08-22, HEAD `739f230`; 2026-07-21, HEAD `e7e305f`; initial 2026-07-06, HEAD `48bd14a`) |
| `node_id`        | `R_kgDOTOX0_A`                                                                 |
| Last push        | 2026-09-08T05:22:13Z (`updated_at` 2026-09-08T05:22:19Z — actively moving, not frozen) |
| Description      | Multimodal agentic IDE — Tauri v2 workspace mission control for OpenCode agents on space-bus |
| Language         | JavaScript (GitHub primary language; substance is TypeScript + Rust)           |
| Runtime          | Bun (package manager + runtime; also runs the `ide_*` sidecar) + Rust/Tauri v2 |
| Package manager  | Bun (`bun.lock`, `bun install`; Bun pinned `1.3.14` in CI + fro-bot; no `packageManager`/`engines` field, Node unpinned) |
| Package          | `mothership` — **private, unpublished** (`"private": true`, `version: 0.1.0`)  |
| License          | MIT (`LICENSE` file present at root)                                           |
| Visibility       | Public                                                                         |
| Stars            | 1                                                                              |
| Watchers / Forks | 0 / 0 (`subscribers_count` 1 → 0 since 2026-08-22)                             |
| Open issues      | **3** (was 7 at 2026-08-22, 6 at 2026-07-21, 1 at 2026-07-06; count includes PRs — and **open PRs are 0**, which is misleading; see the Dependency Dashboard finding below) |
| Community health | **57%** — `code_of_conduct` (inherited from `marcusrbrown/.github`), `license`, `readme` present; `CONTRIBUTING.md`, `SECURITY.md`, and issue/PR templates absent (release-epic R10) |
| Tags / Releases  | **0 / 0** (third consecutive survey with a complete signed-release apparatus and no `v*.*.*` tag) |
| Topics           | (none set)                                                                     |
| Status           | Past tracer, running from source — README's own words: _"no tagged or signed release exists yet."_ Shell opens a `spacebus.json` workspace, streams live session state, dispatches prompts, and exposes **17 `ide_*` MCP tools (8 layout + 9 session control)**. A planning lifecycle (`src/planning/`) is landing contract-first with its runtime deliberately disabled. Read-only/diff code view, Storybook panels, and MCP Apps skill panels still planned but not built |

## 2026-09-08 Survey — the first real feature interval since inception

Nine surveys of this fleet have taught the shape of a "steady-state" interval: bot-authored version churn, no tree movement. This interval breaks that. Between `739f230` (2026-08-22) and `8895732` (2026-09-08) there are nine commits, seven of them `mrbro-bot[bot]` version bumps — and **two `marcusrbrown`-authored `feat` PRs that together changed 86 files and added ~27,000 lines**. Both landed in the last 48 hours of the window.

### 1. The `ide_*` surface doubled: layout control → session control (8 → 17 tools)

**PR #100** (`feat(ide): expose agent-native session controls`, merged 2026-09-07, +22,611/−350 across 53 files) adds a whole new module tree at `src/ide/` — `commands`, `errors`, `executor`, `focus`, `questions`, `views`, each with a colocated test — sitting beside the existing `src/layout/`. The nine new session tools:

`ide_list_projects` · `ide_list_sessions` · `ide_get_active_context` · `ide_select_project` · `ide_select_session` · `ide_dispatch_prompt` · `ide_get_transcript` · `ide_list_pending_questions` · `ide_answer_question`

This is the **layout-parity invariant generalized past layout**. `AGENTS.md`'s Verification section now carries a *standing dogfood check*: an agent connected only through the `ide_*` MCP surface (`scripts/ide-mcp-bridge.ts`, no terminal, no subprocess) must be able — **while a delegated task is running** — to rearrange the layout, discover the active project and session, dispatch a prompt, read the resulting transcript, and answer a pending question, observing the same state/audit-log convergence a human driving the app would see. That is a falsifiable acceptance test for "agent-native," not a slogan.

**The README documents the limit of its own redaction, which is the rare move.** Read tools return "only panel structure, display names, and bounded session/transcript text — never filesystem paths or credentials," and then immediately qualifies it for transcripts specifically: the tool allowlists *which structural fields* cross the boundary (roles, part types, byte budgets), but the user/assistant text itself **is returned verbatim and is not scrubbed or guaranteed secret-free** — "treat it as untrusted content that may itself contain paths, secrets, or instructions someone typed into a session." Most security prose in this fleet describes what a control does; this one describes what it does *not* cover. `sidecar/ide-server/redact.ts` correspondingly allowlist-serializes only `ide_list_panels` / `ide_get_layout` (`id` / `panelType` / `title`), and does not claim to cover transcript text.

### 2. `src/planning/` arrives contract-first, with its runtime deliberately switched off

**PR #102** (`feat(planning): preserve source and track planning revisions`, merged 2026-09-08, +4,383/−86 across 33 files) adds `src/planning/` (`contracts`, `document`, `proposals`, `revisions`, `units` + Markdown fixtures), a new `docs/architecture/` directory with two contract documents, an 18-requirement brainstorm (`2026-09-07-agent-native-planning-lifecycle-requirements.md`), and a nine-unit "Deep" plan.

**The methodology is the durable finding, not the feature.** Both contract documents open by enumerating what is *not* built, in language engineered to defeat the usual misreading:

- `planning-host-contract.md`: _"`src/planning/contracts.ts` defines proposed version-1 **untrusted reports**. Successful parsing establishes syntax only. It does not establish a host identity, principal, grant, verified outcome, or permission to activate planning features. The current runtime does not emit these proposed reports."_
- `planning-publication-contract.md`: _"Current `src-tauri/src/workspace_fs.rs` is read-only. U1 adds no native command, filesystem permission, writer, authority store, or runtime registration. Wire fixtures … validate proposed intent syntax only."_
- And the refusal clause: _"If a candidate algorithm cannot satisfy the final-check race or recovery contract on a filesystem, that publication capability stays unavailable. A watcher, advisory lock, or best-effort comparison is not a permitted substitute for the missing guarantee."_

This inverts the standard failure mode where a green schema test gets read as an implemented capability. The plan header states it outright: _"Dependent functionality stays disabled until the relevant host and filesystem guarantees are demonstrated."_ Compare [[marcusrbrown--systematic]]'s `HARNESSES.md`, where unverified matrix cells say the literal string `UNVERIFIED` — the same discipline (make the absence of proof legible in the artifact) applied to a different artifact class.

Even the source-authority table hedges correctly: _"The following mapping was checked on September 7, 2026. It identifies the configured package's source, not the identity of a currently running process."_

### 3. Mothership's planning contract found a principal-handoff gap in the [[fro-bot--agent]] OpenCode runtime

Tracing the call path at `@fro.bot/harness@1.18.29-harness.88b6b5fb` (runtime integration commit `88b6b5fb…` in `fro-bot/agent`, base OpenCode `1.18.29`), the host contract records:

1. The MCP service stores clients **by MCP server name within the service instance — a client is not allocated per agent session**.
2. `SessionTools.resolve` *does* hold full per-call context (`sessionID`, `messageID`, `callID`, `agent`).
3. But `McpCatalog.convertTool` constructs the `client.callTool` request from **tool name and arguments only** — it supplies abort/timeout/progress options and **does not construct an agent-principal assertion**.
4. Mothership's own stdio bridge then forwards tool name and arguments **with a shared bearer**; its request envelope contains no verified agent principal.

Net effect: **a shared MCP connection cannot distinguish simultaneous calls from differently-authorized sessions.** The contract is careful to scope the claim — _"The finding is the absence of a principal handoff in the inspected construction, not a claim that the SDK can never add any metadata"_ — and states the constraints any fix must satisfy: identity must come from runtime context, **never** from model arguments, agent display names, mutable client-global variables, or an earlier request on the same connection; and the assertion must bind to the actual outbound request, so a tool hook that mutates a call cannot make an assertion for one request authorize a different one.

A second, generalizable provenance rule falls out of the same table: **npm `gitHead` names the wrapper tree, not the runtime tree.** `gitHead cb4a1425…` (harness wrapper) ≠ runtime integration commit `88b6b5fb…`, and _"inspecting only `packages/harness` at npm `gitHead` does not establish the runtime MCP behavior."_ Cataloged in [[opencode-plugins]].

### 4. The three-survey "Renovate live but the majors never move" thread is root-caused — the queue is the dashboard, not the PR list

**Open PRs: 0.** Prior surveys of this repo read backlog by counting open PRs, and the 2026-08-22 page concluded the frozen majors were _"likely grouped-and-held or awaiting a manual cutover."_ **That reading is superseded.** Dependency Dashboard issue #9 shows **eleven update branches parked behind unchecked `Pending Approval` checkboxes**:

`actions/checkout` v7 · `changesets/action` v2 · `@changesets/cli` v3 · `@biomejs/biome` v2 · `typescript` v7 · Vite majors (`vite`, `@vitejs/plugin-react`) · `dockview` v8 · `dockview-react` v8 · `softprops/action-gh-release` v3 · `macos` v26 — **and the entire non-major group too** (`renovate/all-minor-patch`, carrying `typescript` 5.9.3, `actions/checkout`, `bfra-me/.github`, `bun`, `github/codeql-action`, `ossf/scorecard-action`, `marcusrbrown/renovate-config`, `@modelcontextprotocol/sdk`, `@types/bun`).

That is `dependencyDashboardApproval` inherited from the [[marcusrbrown--renovate-config]] preset. The TS 5.8.3 / Vite 7.3.6 / Biome 1.9.4 freeze is **not automation failing to act** — it is automation correctly waiting on a human checkbox, and the branch is never created, so **no PR ever exists to be counted.**

The asymmetry is instructive: `fro-bot/agent` bumps sail straight through — v0.100.0 → v0.105.0 → v0.108.1 → v0.109.3 → **v0.109.4**, each merged same-day. One dependency class is exempt from the gate; everything else queues invisibly. It also explains stale pins that never showed up on the PR list: the `bfra-me/.github` Renovate reusable is still `@v4.16.37` while the fleet is at v4.26.0 (eight minor boundaries), the preset is still `#5.2.4` against a fleet `#5.2.13`, `actions/checkout` is `v6.0.3` in `ci.yaml`/`version.yml`/`fro-bot.yaml`/`release.yaml` while `codeql`/`scorecard`/`dependency-review` already run `v7.0.0`, and Bun is `1.3.14` against `1.4.2`.

**Rule:** with `dependencyDashboardApproval` enabled, `open_issues_count` and the open-PR list are the wrong instrument — **an empty queue and a fully-blocked queue are indistinguishable from outside.** Read the dashboard body. Three fleet repos now show three different mechanisms behind three superficially similar queue shapes: [[marcusrbrown--dev-like]]'s zero-PR queue is genuine same-day merging (healthy), [[bfra-me--ha-addon-repository]]'s fixed 5-PR window is `prConcurrentLimit` throttling a deeper backlog, and Mothership's zero-PR queue is approval-gating at branch creation. Only the first means what it looks like.

### 5. The space-bus bump landed by hand 126 seconds before Renovate garbage-collected its own PR

`@fro.bot/space-bus` **`0.14.0` → `0.15.0`**, closing a thread carried across two surveys. The mechanism deserves recording exactly, because it looks identical to a known failure and is its benign inverse:

- The bump landed inside **PR #100** — a *feature* PR — merged **2026-09-07T05:58:27Z**.
- Renovate's own **PR #45**, open since 2026-07-19 (50 days), was **autoclosed at 2026-09-07T06:00:33Z**, retitled `fix(deps): update dependency @fro.bot/space-bus to v0.15.0 - autoclosed`.

**Contrast with [[bfra-me--ha-addon-repository]] #556**, where an autoclose after 106 days was a governance stall being garbage-collected — the dependency stayed stale and the update was demoted to a rate-limited checkbox. Here Renovate observed the dependency was *already satisfied* and cleaned up after a human who beat it to the fix. The API-visible event is the same in both cases (`merged_at: null`, `- autoclosed` title suffix, long open duration). **An autoclosed Renovate PR is only a stall signal if the manifest still shows the old version.** Read the manifest, not the PR state.

### 6. Third independent confirmation of the working-dir delivery defect — and the first time the agent caught it itself

`fro-bot.yaml` has exactly three `uses:` steps — `actions/checkout`, `oven-sh/setup-bun`, `fro-bot/agent@v0.109.4` — and **nothing after `Run Fro Bot`**. No commit, no push, no PR. Structurally identical to [[marcusrbrown--tokentoilet]] and to the control plane's own workflow (see [[github-actions-ci]], *The Control Plane Fails Its Own Delivery Lint*).

What is new is that the daily report **detected its own prior drops**. The 2026-09-08 run records that the 2026-09-06 *and* 2026-09-07 reports both claimed two CodeQL findings fixed — `js/unused-local-variable` in `spikes/0c-server-connectivity/probe.ts` and `js/tainted-format-string` at `src/main.tsx:40` — that `git log` shows no commit for either ever landed on `main` (`src/main.tsx` untouched since 2026-07-04; `probe.ts` untouched since its authoring commit), and that both alerts were still open at the run's start. It applied both fixes, re-verified the gates green — and then closed with: _"These two file edits are staged in the working tree for the caller workflow to commit/PR."_ **There is no caller half.** The fix is being dropped a third time.

This **validates** the rule [[github-actions-ci]] recorded one day earlier (*re-read the file on the next run before treating a "staged" change as done*) — it works, it caught the defect, it named the exact dates — and simultaneously proves the rule **insufficient**: detection without a delivery channel is a loop that regenerates the same diff every 24 hours and files an honest report about it. The run itself even cites the upstream fix by name, `marcusrbrown/mrbro.dev` #350, _"stop reporting success on work that did not happen."_ The fleet is now converging on the diagnosis from three repos independently; nothing has yet converged on the fix.

Daemon health is otherwise fine: of the last 20 runs, 3 `schedule` and 3 `pull_request` runs concluded `success` and 14 concluded `skipped` — the skips are the bot-author guard doing its job against a trigger surface that is overwhelmingly `mrbro-bot[bot]` traffic.

### 7. The single-perpetual-report contract converges here, because its predicate is simpler

**61** `Daily Fro Bot Report —` issues have existed in this repo; **exactly one is open.** Contrast [[marcusrbrown--infra]], where the same single-report contract has **ten** open, because its trust clause ANDs a *mutable label* onto an *immutable body marker* and the agent therefore classifies nine of its own artifacts as untrusted and refuses to touch them.

Mothership's clause is a title-prefix match and nothing else: _"CLOSE every older open issue whose title starts with `Daily Fro Bot Report —`."_ One predicate, one source of truth, derivable from the artifact itself on every run — so it converges, and has for 61 iterations. The lesson generalizes: **a self-cleanup contract must key on something the agent can always re-derive from the artifact, not on mutable server-side state applied at creation time.**

The cost is real and should not be elided: a title-prefix predicate is also a title-matched public write surface (see [[github-actions-ci]], *A Title-Matched Rolling Issue Is a Public Write Surface*). Simpler predicate, wider blast radius. Mothership takes that trade; infra took the other one and stopped converging.

### 8. Release pipeline gained SLSA provenance attestation, a second build target, and a compiled sidecar

`release.yaml` is now six jobs: `policy-guard` → `required-check-preflight` → `build` (matrix **`aarch64-apple-darwin` + `x86_64-apple-darwin`**) → `sign-and-notarize` (`environment: release`) → **`attest`** (`actions/attest-build-provenance@v4.1.1`, `id-token: write`) → **`publish-draft`** (`environment: release`). The `attest` job, the `publish-draft` job, and the dual-target matrix were not recorded at 2026-08-22.

The sidecar is no longer a script — it is a **compiled Tauri external binary**: `bun build --compile --target=bun-darwin-{arm64,x64}` produces `src-tauri/binaries/ide-server-{aarch64,x86_64}-apple-darwin`, declared as `externalBin`, carrying **its own entitlements file**. `ci.yaml`'s Release Config Smoke asserts the separation mechanically rather than documenting it: `Entitlements.plist` and `sidecar-Entitlements.plist` must **not** be byte-identical, and the main app's entitlements must **not** contain `disable-library-validation` (a sidecar-only exception). It also asserts the release config declares the `ide-server` `externalBin`, enables `hardenedRuntime`, and does not ship the placeholder updater public key. Tauri config split into `tauri.dev.conf.json` / `tauri.release.conf.json`.

**And still zero tags, zero releases.** The apparatus grew more elaborate across an interval in which it was never executed — third consecutive survey of the release drought. The `release` environment does now exist and is confirmed present via the environments API, which closes half of the standing "confirm the protected environment is configured live" question; the other half (required reviewers) is not readable with a public-scope token.

### 9. AGENTS.md invariants 8 → 9 (correction by addition)

A ninth invariant is present that the prior page did not record: **"Release secrets never reach PR/agent-triggered workflows"** — Apple signing/notarization credentials and the Tauri updater private key live only in the `release` GitHub Actions environment (required reviewers), and no `pull_request` / `pull_request_target` / `workflow_run` / `workflow_call` trigger exists on the workflow that sees them. The original eight are verbatim-durable; this is an addition to the list, not a revision of it.

### 10. Security surface: declared, not confirmed

`code-scanning/alerts`, `dependabot/alerts`, and `branches/main/protection` all returned **403** to this survey's public-scope token. The following is **declared by Fro Bot's own 2026-09-08 report** and is recorded as such, not as independently verified fact:

- **1** Dependabot alert, **dismissed** — `glib` RUSTSEC-2024-0429, with a documented rationale that the glib/GTK stack is Linux-only and never compiled into the macOS build.
- **7** open `actions/untrusted-checkout` + **11** `actions/cache-poisoning` CodeQL alerts on `ci.yaml` / `release.yaml`. The report's own analysis is that the flagged jobs carry only `contents: read` and that `release.yaml` has no `pull_request` trigger at all, so the smallest "fix" would change which commit CI validates — deliberately escalated to the owner rather than mechanically patched.
- **2** spike-only `js/functionality-from-untrusted-source` alerts (`iframe.src` set to hardcoded `localhost` strings in `spikes/0a-iframe-stress/panels.ts`).
- A standing, **deliberately not auto-healed** finding: `sidecar/ide-server/http-auth.ts:14` and `ws-bridge.ts:171` compare bearer tokens with plain `===` / `!==` rather than a constant-time comparison. Low severity given loopback-only binding and a high-entropy per-launch token; deferred on the reasoning that an auth-boundary change should land both call sites *plus* test coverage in one reviewed change rather than as an autoheal touch. That is the SCOPE CAP clause working as designed.
- **17** RUSTSEC advisories surfaced by OSSF Scorecard against `src-tauri/Cargo.lock`, **untriaged** — the runner has no cargo toolchain (the Rust-review-only TOOLING CONSTRAINT), so 16 of the 17 are unconfirmed as applicable or inapplicable. The tooling constraint the prior page praised as "honestly scoping its own limits" now has a measurable cost: a whole dependency ecosystem the daemon cannot assess.

Also declared: **1190 tests passing across 57 files**; biome checks 155 files; `design/tokens.css` and `src/styles/tokens.css` **byte-identical, no drift**.

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
- **Release secrets never reach PR/agent-triggered workflows** _(ninth invariant, first recorded 2026-09-08):_ Apple signing/notarization credentials and the Tauri updater private key live only in the `release` GitHub Actions environment (required reviewers); no `pull_request`, `pull_request_target`, `workflow_run`, or `workflow_call` trigger exists on the workflow that sees them. Runbook, key custody, rollback, and checklist docs live under `docs/release/`.

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

**2026-09-08 update:** `@fro.bot/space-bus` moved **0.14.0 → 0.15.0** (see finding 5 above). `@types/react` → `19.2.18`, `@types/react-dom` → `19.2.7` (PR #63, react monorepo), and a new `@types/bun 1.3.14` devDep. **Everything else held again:** `typescript 5.8.3`, `vite 7.3.6`, `@biomejs/biome 1.9.4`, `@modelcontextprotocol/sdk 1.29.0`, `zod ^4.4.3`, `dockview ^7.0.2`, React 19.1, `@changesets/cli 2.31.1`, `@tauri-apps/cli 2.11.4`, `@vitejs/plugin-react 4.7.0`. The 2026-08-22 hypothesis for *why* ("grouped-and-held or awaiting a manual cutover") is **superseded** — every one of these is sitting behind an unchecked `dependencyDashboardApproval` checkbox on issue #9, including the non-major group. Renovate is not idle; it is gated. Available-but-unapproved as of this survey: `typescript` 5.9.3 **and** 7.0.2, `@biomejs/biome` 2.5.12, `vite` 8.2.2, `@vitejs/plugin-react` 6.1.1, `dockview`/`dockview-react` ^8.0.0, `@changesets/cli` 3.0.2, `@modelcontextprotocol/sdk` 1.30.0, `@types/bun` 1.4.1. The dashboard also flags one **abandoned** dependency: cargo `portable-pty` (last release 2025-02-11).

**2026-08-22 update:** these pins are **all byte-identical one month later** — `typescript 5.8.3`, `vite 7.3.6`, `@biomejs/biome 1.9.4`, `@fro.bot/space-bus 0.14.0`, `@modelcontextprotocol/sdk 1.29.0`, `zod ^4.4.3`, `dockview ^7.0.2`, React 19.1, `@changesets/cli 2.31.1`, `@tauri-apps/cli 2.11.4` all held. Renovate has been live ~1 month and driven **only** the agent-pin bump train (see below), not the TS 6 / Biome 2 catch-up. `@types/react` did move to `19.2.17` / `@types/react-dom 19.2.3` (types-only), and `@vitejs/plugin-react` to `4.7.0`. The TS6/Biome2 sweep remains the standing open thread — a full month of Renovate cadence has not touched it, suggesting these majors are either grouped-and-held or awaiting a manual cutover like the sibling repos.

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

Mothership exposes its layout **and, since 2026-09-07, its session control** as MCP tools so any OpenCode agent can drive the app. **17 tools total (8 layout + 9 session):**

- **Layout mutations:** `ide_open_panel`, `ide_split`, `ide_focus`, `ide_move_panel`, `ide_set_layout`, `ide_close_panel`
- **Layout read-only:** `ide_list_panels`, `ide_get_layout`
- **Session control (new, PR #100):** `ide_list_projects`, `ide_list_sessions`, `ide_get_active_context`, `ide_select_project`, `ide_select_session`, `ide_dispatch_prompt`, `ide_get_transcript`, `ide_list_pending_questions`, `ide_answer_question` — backed by a new `src/ide/` module tree (`commands`, `errors`, `executor`, `focus`, `questions`, `views`, each with a colocated test) running through the same typed executor the UI uses

Every mutation appears in the in-app **audit log** with its source. The sidecar (`sidecar/ide-server/`) binds a **random loopback port with a per-launch bearer token**, written to a `0600` rendezvous file at `~/Library/Application Support/com.marcusrbrown.mothership/ide-bridge.json`. `scripts/ide-mcp-config.ts` prints the ready-to-paste config for the current launch; `scripts/ide-mcp-bridge.ts` is a `type: local` MCP entry that re-reads the rendezvous file each start and proxies `ide_*` over stdio — persistent wiring that survives port/token rotation across restarts.

Security carve-outs: read tools return only panel structure, display names, and bounded session/transcript text — **never filesystem paths or credentials** — and agents **cannot open a terminal panel** through `ide_*` (no subprocess reach).

**The transcript caveat is documented in the README rather than papered over** (2026-09-08): the transcript tool allowlists *which structural fields* cross the boundary (roles, part types, byte budgets), but the user/assistant text itself is **returned verbatim, not scrubbed, not guaranteed secret-free** — the README instructs callers to treat it as untrusted content that may contain paths, secrets, or instructions someone typed into a session. `sidecar/ide-server/redact.ts` allowlist-serializes `ide_list_panels` / `ide_get_layout` responses (`id` / `panelType` / `title` only) and makes no claim over transcript bodies. Recording the *boundary of a control* alongside the control is the notable pattern here.

## CI/CD Pipeline

### Workflows (8 present — was 2 at 2026-07-06)

The `.github/` surface matured dramatically between surveys. All six of the workflows below joined `ci.yaml` + `fro-bot.yaml`, resolving nearly every 2026-07-06 "Open Thread" about missing supply-chain and release automation:

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PR + push to `main`, dispatch | Design Check (permanent gate) + `verify` matrix (typecheck/lint/test) + **Release Config Smoke** (new) + Check Workflows (actionlint) |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (daily 06:15 UTC), dispatch | PR review, daily oversight + autohealing (single unified run); agent `v0.83.1` → `v0.93.1` → `v0.100.0` → `v0.105.0` → `v0.108.1` → `v0.109.3` → **`v0.109.4`** (SHA `b799b64`, #99, 2026-09-06) |
| Release | `release.yaml` | version tag push (`v*.*.*`) or maintainer dispatch | Signed/notarized macOS release pipeline — the **only** workflow that touches Apple signing / updater keys. **Six jobs as of 2026-09-08**: `policy-guard` → `required-check-preflight` → `build` (matrix aarch64 + x86_64 darwin) → `sign-and-notarize` (`environment: release`) → **`attest`** (`actions/attest-build-provenance@v4.1.1`, `id-token: write`) → **`publish-draft`** (`environment: release`) |
| Version | `version.yml` | push to `main` | Opens/updates the Changesets "Version Packages" PR; never builds or signs (new) |
| Renovate | `renovate.yaml` | issue/PR edit, non-main push, `workflow_run` after CI, dispatch | Calls `bfra-me/.github` shared Renovate workflow `@v4.16.37` (new) |
| CodeQL | `codeql.yaml` | PR, push `main`, weekly (Wed 07:31), dispatch | `javascript-typescript` + `actions` analysis, `+security-and-quality` (Rust deferred pending a macOS lane); `github/codeql-action@v4.37.0` |
| Scorecard | `scorecard.yaml` | branch-protection-rule, weekly (Tue 07:20), push `main` | OSSF Scorecard supply-chain scan, publishes SARIF; `ossf/scorecard-action@v2.4.3`, `permissions: read-all` |
| Dependency Review | `dependency-review.yaml` | PR to `main` | `actions/dependency-review-action`, `fail-on-severity: high` (new) |

Still **no Probot `settings.yml`** — release-critical repo settings are instead managed in code by `scripts/apply-release-settings.ts` / `verify-release-settings.ts` plus `.github/rulesets/v0-1-release-tags.json` and `CODEOWNERS`, a different (script-driven) posture than the fleet's `common-settings.yaml` inheritance.

### `ci.yaml` jobs

- **Design Check** — `npx --yes impeccable@3.2.0 detect --json src` must return `[]`; armed but no-op if `src/` absent. Permanent design gate enforcing tokens-only styling.
- **verify** (matrix: `typecheck`, `lint`, `test`) — `bun install --frozen-lockfile` then `bun run <check>`; armed but no-op if `package.json` absent.
- **release-smoke** (**Release Config Smoke**, new) — no-secrets sanity of the release apparatus: `version:check`, `release-policy.ts` against a synthetic eligible context (`--ref refs/tags/v0.0.0-ci-smoke`), a Tauri release-config parse (strict CSP, updater pubkey), and entitlements-separation check. This is one of the six required-check contexts the release pipeline's preflight demands. **Assertions confirmed 2026-09-08:** the release config must not ship the placeholder updater public key, must declare the `ide-server` `externalBin` sidecar, must reference `Entitlements.plist` and enable `hardenedRuntime`; the base config must not ship a null CSP; and `Entitlements.plist` vs `sidecar-Entitlements.plist` must **not** be byte-identical, with `disable-library-validation` banned from the main-app file. A design decision (sidecar-only entitlement exceptions) enforced as a diff check rather than a comment.
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

**Fro Bot workflow is present and active** (`fro-bot.yaml`, pinned `fro-bot/agent@b799b64d… # v0.109.4` at 2026-09-08 — was `v0.100.0` at 2026-08-22, `v0.93.1` at 2026-07-21, `v0.83.1` at 2026-07-06). This is a mature, repo-specific configuration, reflecting that mothership was scaffolded with the current fleet workflow template rather than growing one incrementally. The structural shape (triggers, concurrency key, guards, prompt routing, six autoheal categories, Rust-review-only tooling constraint, `@3.2.0` design-gate pin) is **byte-identical across all four surveys** — only the agent pin has ever moved.

**The gap is delivery, not configuration** (2026-09-08). The job holds `contents: write` / `issues: write` / `pull-requests: write` and carries `FRO_BOT_PAT`, but the workflow's last step is `Run Fro Bot` — there is no commit, push, or PR step after it. Under the harness's `working-dir` delivery mode the agent stages edits for a caller half that does not exist, so code fixes evaporate at job teardown while issue writes (the daily report) land normally. See finding 6 above, and [[github-actions-ci]] for the fleet-wide pattern.

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

Systematic / Fro Bot lineage — **afrofuturism × cyberpunk, dark-default, cyan/magenta/orange with strict intent**. `PRODUCT.md` + `DESIGN.md` are the Impeccable design context; tokens live in `design/tokens.css` (seed) and `src/styles/tokens.css` (runtime). The Impeccable skill is installed at `.agents/skills/impeccable/` and CI runs `impeccable detect` as a hard gate. Intentional brand exceptions get scoped entries in `.impeccable/config.json` — as of 2026-08-22 exactly one: a `bounce-easing` allow for the `cubic-bezier(0.34, 1.56, 0.64, 1)` `--ease-spring` brand token — never rule-wide disables. This is the same design-gate pattern seen in [[fro-bot--dashboard]] — and as of that repo's 2026-07-23 survey the convergence is now near-total: dashboard vendors the Impeccable **skill** at `.agents/skills/impeccable/`, an Impeccable **OpenCode plugin** at `.opencode/impeccable/`, and a brand-token `assets/tokens.css` + `styleguide.md`, mirroring Mothership's skill-install + `tokens.css` seed pattern (dashboard also keeps `impeccable detect` as a hard CI gate, pinned `impeccable@3.2.1`).

## Relationship to the Fro Bot Ecosystem

- **[[fro-bot--space-bus]]** — the control plane Mothership renders. Mothership pins `@fro.bot/space-bus` **0.15.0** as of 2026-09-07 (0.7.0 at first survey, 0.14.0 across 2026-07-21/2026-08-22) and consumes its `/contract` + `/core` library surface for schemas and reads, plus `/attach` `resolveManagedServer` in `workspace/tauri-fs.ts`. space-bus is the _tasking_ plane (control agent delegates via `bus_*` tools); Mothership is the _visual mission-control_ surface over the same directory-routed `opencode serve`. Where [[fro-bot--dashboard]] is the read-only web observation plane, Mothership is the interactive desktop cockpit.
- **[[fro-bot--agent]]** — the runtime powering the Fro Bot workflow (agent **v0.109.4** as of 2026-09-08; v0.83.1 at first survey). Both ride the same OpenCode server line; the cross-project intelligence check watches agent release notes and workflow-example evolution. **As of 2026-09-08 the relationship runs both ways:** Mothership's planning host contract is the first artifact in this wiki to document a concrete architectural gap *in* the agent runtime — the missing MCP agent-principal handoff at `McpCatalog.convertTool`, against `@fro.bot/harness@1.18.29-harness.88b6b5fb`. The consumer is now auditing the platform.
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

### Resolved / root-caused since 2026-08-22

- **`@fro.bot/space-bus` pin — RESOLVED at 0.15.0** (2026-09-07, hand-carried inside feature PR #100; Renovate's own #45 autoclosed 126 s later). Now current with [[fro-bot--space-bus]]'s latest published release.
- **"Renovate live but the majors never move" — ROOT-CAUSED, not resolved.** The cause is `dependencyDashboardApproval` from the [[marcusrbrown--renovate-config]] preset: eleven update branches (majors *and* the whole non-major group) are parked behind unchecked checkboxes on issue #9. The prior hypothesis ("grouped-and-held or awaiting a manual cutover") is superseded. The pins are still frozen; what changed is that we now know why and where to look.
- **`release` protected environment — partially confirmed.** The environments API confirms a `release` environment exists. Whether required reviewers are configured on it is not readable with a public-scope token; that half of the question stays open.
- **Planned-but-unbuilt surfaces — partially superseded.** Read-only/diff code view, Storybook panels, and MCP Apps skill panels are still unbuilt, but the "planned surfaces" list is no longer the whole story: **session control shipped** (9 tools, PR #100) and a **planning lifecycle is landing contract-first** (PR #102) — neither was on the 2026-08-22 roadmap list.

### Still open

- **Delivery half missing from `fro-bot.yaml`** *(new, 2026-09-08, highest priority):* the workflow has no commit/push/PR step after `Run Fro Bot`, so every code fix the daily pass produces is discarded. Confirmed to have silently dropped the same two CodeQL fixes on 2026-09-06, 2026-09-07, and again on 2026-09-08. The daemon files honest reports about work that never lands. Next survey: check whether a delivery step was added, and whether those two alerts (`js/unused-local-variable` in `spikes/0c-server-connectivity/probe.ts`, `js/tainted-format-string` at `src/main.tsx:40`) are finally closed — they are a perfect canary.
- **MCP agent-principal handoff** *(new, 2026-09-08):* the planning host contract documents that the [[fro-bot--agent]] runtime's `McpCatalog.convertTool` sends no principal assertion and the MCP service keys clients by server name, not session — so Mothership's shared-bearer bridge cannot distinguish differently-authorized sessions. U4 owns the fix. Track whether it lands upstream in `fro-bot/agent` or as a Mothership-local native authority.
- **Planning subsystem stays disabled by design** *(new, 2026-09-08):* `src/planning/` parses proposed schemas but the runtime emits none of them and `workspace_fs.rs` is still read-only. The interesting question next survey is whether U3/U4 ship *with* their proof obligations met, or whether the "stays unavailable until demonstrated" clause quietly erodes.
- **Community files (release-epic R10)** *(new, 2026-09-08):* health 57% — `CONTRIBUTING.md`, `SECURITY.md`, and issue/PR templates absent; `CODE_OF_CONDUCT.md` is inherited from `marcusrbrown/.github`, not local. Directly drives Scorecard's open `SecurityPolicyID` finding. Blocked on an unresolved DCO/CLA contributor-rights question from the epic doc.
- **17 untriaged RUSTSEC advisories** *(new, 2026-09-08):* surfaced by Scorecard against `src-tauri/Cargo.lock`; the autoheal runner has no cargo toolchain and cannot assess them. The Rust-review-only constraint is honest but now has a cost.
- **Constant-time bearer comparison** *(new, 2026-09-08):* `sidecar/ide-server/http-auth.ts:14` and `ws-bridge.ts:171` use plain `===`/`!==` on the bearer token. Deliberately deferred by the SCOPE CAP clause pending a single change covering both call sites plus tests. Confirm it is not still deferred three surveys from now.
- **Probot Settings** — still no `.github/settings.yml` (re-confirmed 2026-09-08). Repo settings are managed by script (`apply-/verify-release-settings.ts` + rulesets + CODEOWNERS) rather than `common-settings.yaml` inheritance. Confirm whether the fleet expects this repo to adopt Probot Settings or keep the script-driven posture.
- ~~**`@fro.bot/space-bus` pin — held at 0.14.0**~~ — **resolved 2026-09-07 at 0.15.0** (see above). Retained for history: was 0.7.0 at 2026-07-06 (0.0.0 unpublished at the 2026-07-03 space-bus survey), 0.14.0 at 2026-07-21 and 2026-08-22.
- **Toolchain pins (`typescript 5.8.3`, `vite 7.3.6`, `@biomejs/biome 1.9.4`) — now three surveys frozen, cause identified 2026-09-08.** Not a Renovate cadence problem: `dependencyDashboardApproval` gates branch creation, so no PR is ever produced. Also frozen behind the same gate: `bfra-me/.github` reusable `@v4.16.37` (fleet at v4.26.0), preset `#5.2.4` (fleet `#5.2.13`), Bun `1.3.14` (latest `1.4.2`), and `actions/checkout v6.0.3` in four of eight workflows while three others already run `v7.0.0`. Track whether the checkboxes get clicked or the approval gate gets relaxed.
- **Rust CodeQL deferred:** the CodeQL matrix covers `javascript-typescript` + `actions` only; Rust analysis waits on a macOS build lane (Tauri system-lib build fails on `ubuntu-latest`) — the same tooling constraint the daily autoheal prompt already encodes. Still deferred 2026-09-08, and now visibly coupled to the 17 untriaged RUSTSEC advisories above.
- **v0.1 release drought — third consecutive survey.** The signed/notarized apparatus has been in place since 2026-07-21 and has since *grown* (SLSA attestation, dual-target matrix, compiled sidecar with its own entitlements, draft-publish job), but **`tags: 0`, `releases: 0`** and `version 0.1.0` across `package.json` / `Cargo.toml` / `tauri.conf.json`. Elaborating machinery that has never executed is its own risk class — every added job is untested in the only context that matters. Run the `docs/release/v0-1-checklist.md` burn-down against a real draft.

## Survey History

| Date       | HEAD      | Notes                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| 2026-09-08 | `8895732` | Re-survey. **First real feature interval since inception** — 9 commits, 7 bot version bumps and **two `marcusrbrown` `feat` PRs totaling 86 files / ~27k added lines**, both in the final 48 hours. (1) **`ide_*` surface doubled 8 → 17** (#100, +22,611/−350): new `src/ide/` tree and 9 session-control tools (`ide_list_projects`/`ide_list_sessions`/`ide_get_active_context`/`ide_select_project`/`ide_select_session`/`ide_dispatch_prompt`/`ide_get_transcript`/`ide_list_pending_questions`/`ide_answer_question`), with AGENTS.md adding a falsifiable **standing dogfood check**; README documents the *limit* of its own redaction (transcript text returned verbatim, explicitly untrusted). (2) **`src/planning/` lands contract-first** (#102, +4,383/−86) with two `docs/architecture/` contracts whose opening paragraphs enumerate what is **not** implemented — "successful parsing establishes syntax only" — and a refusal clause that keeps publication unavailable absent a proven guarantee. (3) **Cross-repo finding:** the host contract documents an **MCP agent-principal handoff gap** in [[fro-bot--agent]]'s runtime (`McpCatalog.convertTool` sends no principal; clients keyed by server name, not session), plus the rule that npm `gitHead` names the wrapper tree, not the runtime tree. (4) **Three-survey "majors never move" thread root-caused:** `dependencyDashboardApproval` parks **11 update branches** — majors *and* the whole non-major group — behind unchecked checkboxes on issue #9, so **0 open PRs means blocked, not clean**; prior "grouped-and-held" hypothesis **superseded**. (5) **space-bus 0.14.0 → 0.15.0**, hand-carried in #100 and Renovate autoclosed its own 50-day-old #45 **126 seconds later** — the benign inverse of [[bfra-me--ha-addon-repository]] #556. (6) **Third confirmation of the working-dir delivery defect**, and the first time an agent caught it itself: the daily report proves via `git log` that its 09-06 and 09-07 reports claimed CodeQL fixes that never landed, applies them, then stages them for a caller half that does not exist. (7) **The single-report contract converges here** (61 reports ever, exactly 1 open) because its predicate is a title prefix, not [[marcusrbrown--infra]]'s mutable-label AND. (8) Release pipeline gained **`attest` (SLSA provenance) + `publish-draft` + a dual-target build matrix**, and the sidecar became a compiled `externalBin` with its own entitlements, enforced by a byte-inequality check in CI. (9) **AGENTS.md invariants 8 → 9** (release-secret isolation; addition, not revision). (10) Security counts are **declared by Fro Bot, 403 to this survey's token**. Open issues 7 → 3; open PRs 0; subscribers 1 → 0; tags/releases still 0/0; community health 57%. |
| 2026-08-22 | `739f230` | Re-survey. **No structural change in ~1 month** — the 8-workflow surface, signed/notarized release pipeline, `ide_*` MCP sidecar, dockview panel model, Changesets/version.yml, script-driven release settings, and all eight AGENTS.md invariants are durable (steady-state). The **sole substantive commit** in the interval is the Fro Bot agent pin `v0.95.0 → v0.100.0` (#58, `mrbro-bot[bot]`, 2026-08-19) — ecosystem version leader, matching [[marcusrbrown--marcusrbrown]]. Manifest pins **byte-identical** (TS 5.8.3, Vite 7.3.6, Biome 1.9.4, `@fro.bot/space-bus` 0.14.0, MCP SDK 1.29.0, zod ^4.4.3, dockview ^7.0.2, React 19.1) except types-only `@types/react` 19.2.17 + `@vitejs/plugin-react` 4.7.0. Confirmed exact pins: `github/codeql-action@v4.37.0`, `ossf/scorecard-action@v2.4.3`, Renovate reusable `@v4.16.37`, config `#5.2.4`, Bun `1.3.14`, `.impeccable/config.json` single `bounce-easing`/`--ease-spring` exception. Open issues 6→7. **Renovate live ~1 month but TS6/Biome2 sweep untouched** and **space-bus 0.15.0 available but pin held at 0.14.0** — automation present, majors not driven. Still no Probot Settings; Rust CodeQL deferred; no `v*.*.*` release tag yet (still `0.1.0`). |
| 2026-07-21 | `e7e305f` | Re-survey. Major CI/CD + release-engineering maturation in ~2 weeks: workflows 2→8 (added `release.yaml` signed/notarized macOS pipeline with a protected `release` environment + Checks-API required-check preflight + resolved-tag-SHA discipline, `version.yml` Changesets Version PR, `renovate.yaml`, `codeql.yaml`, `scorecard.yaml`, `dependency-review.yaml`; `ci.yaml` gained a Release Config Smoke gate). Release-preparedness epic largely landed: `ARCHITECTURE.md`, `STRUCTURE.md`, `CHANGELOG.md`, Changesets, `CODEOWNERS`, `v0-1-release-tags` ruleset, `docs/release/` runbooks, `scripts/{release-policy,verify-/apply-release-settings,sync-version,validate-updater-manifest}.ts`. Renovate onboarded (`renovate-config#5.2.4`). `@fro.bot/space-bus` 0.7.0→0.14.0; `tauri-plugin-opener`→`@tauri-apps/plugin-opener`; Fro Bot agent v0.83.1→v0.93.1. Open issues 1→6. Still no Probot Settings; Rust CodeQL deferred. |
| 2026-07-06 | `48bd14a` | Initial survey. New repo (created 2026-07-05), public, MIT, private/unpublished Bun/TS + Rust/Tauri v2 package. Tracer-stage multimodal agentic IDE rendering a directory-routed `opencode serve` workspace via dockview; exposes layout as `ide_*` MCP tools (loopback + per-launch bearer token rendezvous); space-bus 0.7.0 as the bus client. **Fro Bot workflow present** (`fro-bot/agent@v0.83.1`, unified single-run oversight+autoheal, 06:15 UTC) + CI (Impeccable design gate, verify matrix, actionlint). **No Renovate / no Probot Settings / no CodeQL** yet. |
