---
type: repo
title: "marcusrbrown/mothership"
created: 2026-07-06
updated: 2026-07-06
sources:
  - url: https://github.com/marcusrbrown/mothership
    sha: 48bd14a2b8735d35c7737716a512b9b365adcc27
    accessed: 2026-07-06
tags: [tauri, rust, react, typescript, opencode, space-bus, mcp, agentic-ide, dockview, bun, biome, localhost-only, dogfood, impeccable, mvp, fro-bot]
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
| Created          | 2026-07-05 (survey 2026-07-06, HEAD `48bd14a`)                                 |
| Last push        | 2026-07-06                                                                     |
| Description      | Multimodal agentic IDE — Tauri v2 workspace mission control for OpenCode agents on space-bus |
| Language         | JavaScript (GitHub primary language; substance is TypeScript + Rust)           |
| Runtime          | Bun (package manager + runtime; also runs the `ide_*` sidecar) + Rust/Tauri v2 |
| Package manager  | Bun (`bun.lock`, `bun install`)                                               |
| Package          | `mothership` — **private, unpublished** (`"private": true`, `version: 0.1.0`)  |
| License          | MIT (`LICENSE` file present at root)                                           |
| Visibility       | Public                                                                         |
| Stars            | 1                                                                              |
| Watchers / Forks | 0 / 0                                                                          |
| Open issues      | 1                                                                              |
| Topics           | (none set)                                                                     |
| Status           | Early tracer — the shell runs (opens a `spacebus.json` workspace, streams live session state, dispatches to a control agent, exposes `ide_*` MCP tools). Read-only/diff code view, Storybook panels, and MCP Apps skill panels planned but not yet built |

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
| Desktop shell     | Tauri v2 (`@tauri-apps/api` ^2, `@tauri-apps/cli` ^2, `tauri-plugin-opener`)      |
| Frontend          | React 19.1 + React DOM 19.1, TypeScript ~5.8.3                                     |
| Build             | Vite ^7.0.4 + `@vitejs/plugin-react`                                              |
| Layout engine     | dockview ^7.0.2 + dockview-react (imperative panel API behind a typed command layer) |
| Prompt bar        | Tiptap ^3 (`core`, `react`, `starter-kit`, `extension-mention`, `pm`, `suggestion`) — `@`-mentions |
| Terminal          | `@xterm/xterm` ^6 + `@xterm/addon-fit` + `@xterm/addon-webgl`                     |
| Bus/server client | `@fro.bot/space-bus` 0.7.0 (pinned; contract + core library surface)              |
| MCP               | `@modelcontextprotocol/sdk` 1.29.0 (`ide_*` server + bridge)                      |
| Boundary parsing  | zod ^4.4.3                                                                        |
| Rust core         | tauri 2, `tauri-plugin-opener` 2, serde/serde_json 1, `portable-pty` 0.9, uuid 1 (v4) |
| Test              | `bun test` (TS decision fns), `cargo test` (Rust decision fns)                   |
| Lint/format       | Biome ^1.9.4 (`biome check`) — diverges from the `@bfra.me/*` ESLint+Prettier ecosystem, aligns with [[marcusrbrown--systematic]] / [[fro-bot--space-bus]] Bun+Biome shape |
| Design gate       | Impeccable `@3.2.0` (`impeccable detect`) — hard CI gate; skill installed at `.agents/skills/impeccable/` |

Note the pins predate the ecosystem's TypeScript 6 / pnpm 11 sweep: `typescript` `~5.8.3` and Vite `^7.0.4`. Renovate owns routine bumps (the Fro Bot prompt explicitly cedes non-security version bumps to Renovate), so these will move on their own cadence — but there is no Renovate config observed in the repo yet (see Developer Tooling).

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
├── scripts/
│   ├── ide-mcp-config.ts        # one-shot inspector: prints current-launch MCP config
│   └── ide-mcp-bridge.ts        # persistent stdio bridge: re-reads rendezvous file, proxies ide_* over stdio
├── spikes/                      # de-risk harnesses: 0a-iframe-stress, 0b-pty, 0c-server-connectivity
├── design/                      # systematic-banner.svg, systematic.theme.json, tokens.css (seed)
├── docs/
│   ├── brainstorms/             # 2026-07-03 workspace-mission-control-requirements (R1–R15),
│   │                            #   2026-07-05 product-identity-release-preparedness-requirements (R1–R18)
│   ├── plans/                   # 2026-07-04 tracer-bullet plan, 2026-07-05 reliability-track plan
│   └── solutions/               # best-practices/, documentation-gaps/, integration-issues/ (YAML frontmatter)
├── .agents/skills/              # installed Impeccable skill
├── .impeccable/config.json      # detector allowlist for documented brand exceptions
├── .github/workflows/           # ci.yaml, fro-bot.yaml
├── AGENTS.md  DESIGN.md  PRODUCT.md  HANDOFF.md  README.md
├── biome.json  tsconfig.json  tsconfig.node.json  vite.config.ts  index.html
└── LICENSE  bun.lock  package.json
```

## The `ide_*` MCP Tool Surface

Mothership exposes its layout as MCP tools so any OpenCode agent can drive the UI:

- **Mutations:** `ide_open_panel`, `ide_split`, `ide_focus`, `ide_move_panel`, `ide_set_layout`, `ide_close_panel`
- **Read-only:** `ide_list_panels`, `ide_get_layout`

Every mutation appears in the in-app **audit log** with its source. The sidecar (`sidecar/ide-server/`) binds a **random loopback port with a per-launch bearer token**, written to a `0600` rendezvous file at `~/Library/Application Support/com.marcusrbrown.mothership/ide-bridge.json`. `scripts/ide-mcp-config.ts` prints the ready-to-paste config for the current launch; `scripts/ide-mcp-bridge.ts` is a `type: local` MCP entry that re-reads the rendezvous file each start and proxies `ide_*` over stdio — persistent wiring that survives port/token rotation across restarts.

Security carve-outs: read tools return only panel structure and display names — **never filesystem paths or credentials** — and agents **cannot open a terminal panel** through `ide_*` (no subprocess reach).

## CI/CD Pipeline

### Workflows (2 present)

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | PR + push to `main`, dispatch | Design Check (permanent gate) + `verify` matrix (typecheck/lint/test) + Check Workflows (actionlint) |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (daily 06:15 UTC), dispatch | PR review, daily oversight + autohealing (single unified run) |

**No Renovate workflow, no Probot `settings.yml`, no CodeQL/Scorecard** observed in `.github/` (only `workflows/`). The Fro Bot schedule prompt references Renovate as the owner of dependency bumps ("Renovate owns routine dependency and version bumps") and a `bfra-me/works`/Renovate-preset cross-project intelligence check, implying Renovate onboarding is expected but not yet landed.

### `ci.yaml` jobs

- **Design Check** — `npx --yes impeccable@3.2.0 detect --json src` must return `[]`; armed but no-op if `src/` absent. This is the permanent design gate enforcing tokens-only styling.
- **verify** (matrix: `typecheck`, `lint`, `test`) — `bun install --frozen-lockfile` then `bun run <check>`; armed but no-op if `package.json` absent.
- **check-workflows** — `raven-actions/actionlint` for workflow linting.

All third-party actions are SHA-pinned with version comments (`actions/checkout@df4cb1c… # v6.0.3`, `oven-sh/setup-bun@0c5077e… # v2.2.0`, `raven-actions/actionlint@3d39aea… # v2.2.0`). Strict bash defaults (`bash -Eeuo pipefail`), `contents: read` least-privilege per job, `cancel-in-progress` only off `main`.

## Fro Bot Integration

**Fro Bot workflow is present and active** (`fro-bot.yaml`, pinned `fro-bot/agent@d1786f3b… # v0.83.1` — the ecosystem version co-leader, matching [[marcusrbrown--marcusrbrown]]). This is a mature, repo-specific configuration for a repo only one day old, reflecting that mothership was scaffolded with the current fleet workflow template rather than growing one incrementally.

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

- **No Renovate config / no Probot Settings / no CodeQL/Scorecard** — the Fro Bot prompt assumes Renovate ownership of bumps, but no `renovate.json5` or `.github/settings.yml` was observed. Candidate for follow-up onboarding PRs (Renovate + `common-settings.yaml` inheritance + security workflows). Unlike [[fro-bot--space-bus]], the Fro Bot workflow itself _is_ already present.
- **v0.1 release-preparedness epic (R1–R18):** track which requirements land — ARCHITECTURE.md, STRUCTURE.md, community health files, release workflow, Changesets config, signed-build pipeline. LICENSE (MIT) is already present.
- **`@fro.bot/space-bus` pin (0.7.0):** verify it stays lockstep as space-bus advances (it was `0.0.0` private/unpublished at the 2026-07-03 space-bus survey — now published to 0.7.0, a fast maturation worth confirming on the space-bus page next survey).
- **Toolchain pins (`typescript ~5.8.3`, `vite ^7.0.4`, `@biomejs/biome ^1.9.4`):** predate the fleet's TS 6 / Biome 2 / pnpm 11 sweep — watch for the Renovate-driven catch-up once onboarding lands.
- **Planned-but-unbuilt surfaces:** read-only/diff code view, Storybook panels, MCP Apps skill panels (SEP-1865) — track when they land.

## Survey History

| Date       | HEAD      | Notes                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| 2026-07-06 | `48bd14a` | Initial survey. New repo (created 2026-07-05), public, MIT, private/unpublished Bun/TS + Rust/Tauri v2 package. Tracer-stage multimodal agentic IDE rendering a directory-routed `opencode serve` workspace via dockview; exposes layout as `ide_*` MCP tools (loopback + per-launch bearer token rendezvous); space-bus 0.7.0 as the bus client. **Fro Bot workflow present** (`fro-bot/agent@v0.83.1`, unified single-run oversight+autoheal, 06:15 UTC) + CI (Impeccable design gate, verify matrix, actionlint). **No Renovate / no Probot Settings / no CodeQL** yet. |
