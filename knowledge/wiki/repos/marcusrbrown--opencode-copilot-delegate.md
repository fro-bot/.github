---
type: repo
title: marcusrbrown/opencode-copilot-delegate
created: 2026-04-23
updated: 2026-09-10
sources:
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea3f576d7218900b9216a8a2c2947003660809b
    accessed: 2026-04-23
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 02cac9c024744a290c9257d5c740d2a83e2c8e42
    accessed: 2026-04-27
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 2744ce7fc07660baa4f17bfff3656141888261cf
    accessed: 2026-05-21
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: f9aaeead2a756f48d7cd8da0018ddea2cfbfea98
    accessed: 2026-06-03
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 60cbe42cfca2ba2625cdec8f99d21295bc69f0df
    accessed: 2026-06-13
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: bea97eaf9db3ef529ec9011de59d83e1e4b08ec0
    accessed: 2026-06-24
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: 61bc146a5e8fe6b92f84248594e9561d0f36819d
    accessed: 2026-07-24
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: c6c055d906b8df3de5f371221daf930c8bd49f99
    accessed: 2026-08-25
  - url: https://github.com/marcusrbrown/opencode-copilot-delegate
    sha: b67bd4da5f63825c51abd5dd8dd94e8ac48aad0c
    accessed: 2026-09-10
tags:
  - opencode
  - plugin
  - copilot
  - delegation
  - subprocess
  - async
  - bun
  - typescript
  - biome
  - changesets
  - tui
  - rpc
  - orphan-reaper
  - doc-drift
  - renovate
related:
  - marcusrbrown--dotfiles
  - marcusrbrown--systematic
  - marcusrbrown--github
node_id: R_kgDOSKIp0Q
---

# marcusrbrown/opencode-copilot-delegate

OpenCode plugin that delegates tasks to GitHub Copilot CLI as background subprocesses with async completion notifications.

## Overview

An [OpenCode](https://opencode.ai) plugin registering four tools — `copilot_delegate`, `copilot_output`, `copilot_cancel`, `copilot_resume` — that allow a parent OpenCode agent to spawn `copilot -p` as a background process, continue productive work, and receive a `<system-reminder>` notification when the subprocess completes. The async pattern mirrors OMO's `background_task` / `background_output` architecture.

**Status (2026-09-10):** **v0.12.1** still — sixth straight steady-release survey, 48 days since the last tag. HEAD `b67bd4da`, `node_id R_kgDOSKIp0Q`, stars 1, forks 1, open count **9 → 8**. The window `c6c055d…b67bd4da` is **16 commits touching 7 files**, every one authored by `mrbro-bot[bot]`: `renovate.json5`, four lines across `ci.yaml`/`fro-bot.yaml`/`renovate.yaml`, `mise.toml`, `package.json`, `bun.lock`. **Zero source-tree change** — `src/`, `tests/`, `scripts/`, `README.md`, `AGENTS.md`, `biome.json`, `.github/settings.yml`, and `.github/workflows/update-repo-settings.yaml` are all untouched (verified against the compare endpoint, not inferred from a byte count). Three findings, and the first two are the reason this pass is worth more than its diff.

**(1) Three quarters of the commit log is the daemon versioning itself.** Twelve of the sixteen commits are `fro-bot/agent` pin bumps — #378 `v0.105.1`, #379 `v0.106.0`, #380 `v0.106.2`, #381 `v0.107.0`, #383 `v0.107.1`, #384 `v0.107.2`, #385 `v0.107.3`, #386 `v0.108.1`, #387 `v0.109.0`, #388 `v0.109.2`, #389 `v0.109.3`, #390 `v0.109.4` — twelve separate PRs, each merged same-day, each a one-line change to `fro-bot.yaml` that nevertheless runs the full `Lint, typecheck, build, unit tests` gate including the Node ESM export-shape smoke test. The remaining four are #382 (lockfile), #377 (non-major deps), #391 (`@opencode-ai/*` → 1.18.29), #392 (`bfra-me/.github` → v4.27.0). This repo carries **no** `matchUpdateTypes: ['patch'] → enabled: false` rule (`renovate.json5` holds exactly three `packageRules`, all allowlists), which makes it the **control case** for the 2026-09-10 fleet census in [[github-actions-ci]]: in the three repos that do carry the suppression rule, `fro-bot/agent` froze at `v0.109.0` while `v0.109.4` shipped; here, unsuppressed, the pin tracked every release — and the visible cost is a commit history that is 75% self-maintenance. Both postures have a price; only one of them is quiet about it.

**(2) The README is a whole tool behind, and the agent-facing doc is not.** `README.md` line 7 reads *"This plugin registers three tools in OpenCode"* and enumerates `copilot_delegate` / `copilot_output` / `copilot_cancel`. **`copilot_resume` does not appear anywhere in its 121 lines** — not in the overview, not in the limitations section, which also says "server-only installs continue to register the three tools." The tool shipped in **v0.12.0**, first recorded by the 2026-05-21 survey; the drift is ~3.7 months old. `AGENTS.md` line 5, by contrast, is correct: *"It exposes four tools to OpenCode sessions"*, with `copilot_resume` listed and `src/tools/resume.ts` in its tree diagram. So the doc that agents read is current and the doc that humans read is stale — an inversion that explains its own survival, because every reader positioned to fix it is reading the correct one. It is not a private artifact either: `README.md` is in `package.json`'s `files[]`, so it *is* the npm package page, and `.github/settings.yml` declares that npm page as the repository homepage. The published front door under-reports its own surface by 25%. Structurally invisible to the daemon: `SCHEDULE_PROMPT`'s four categories cover errored PRs, security, dependency/changeset hygiene, and lint/typecheck/build — **none of them reads prose for accuracy**. Same class as [[marcusrbrown--marcusrbrown-com]]'s AGENTS.md drift and [[marcusrbrown--tokentoilet]]'s "grep the non-code surfaces" rule, but sharper: what is missing here is a shipped public tool, not a version string.

**(3) `update-repo-settings.yaml` is pinned to a bare, untagged SHA that Renovate cannot see.** The reference is `bfra-me/.github/.github/workflows/update-repo-settings.yaml@f6a7976c5cc48af150f7de3df331362262f15a18` with **no `# vX.Y.Z` comment** — the only such reference in the repo. Resolved upstream, `f6a7976c` is `git describe` = **`v4.16.8-3-gf6a7976`**, dated **2026-04-23**, reachable from *no current branch or tag* in `bfra-me/.github`. 2026-04-23 is this repository's own `created_at`, so on the available evidence the pin has never moved. Its sibling in the same directory, `renovate.yaml`, carries `# v4.19.0` and advanced to `# v4.27.0` inside this very window (#392) — same owner, same datasource, same manager, same tag list. The difference is the version comment: without one, Renovate's `github-actions` manager has nothing to anchor a comparison to, so the pin is not stale-and-queued, it is **invisible**. This is the [[bfra-me--ha-addon-repository]] `chrisdickinson/setup-yq` defect class applied to a reusable workflow, and it makes this the **third** fleet instance of the settings-sync workflow specifically being the frozen one — see [[probot-settings]].

Toolchain deltas: Bun **1.4.0 → 1.4.2**, `npm:opencode-ai` **1.18.19 → 1.18.29**, `@github/copilot` CLI **1.0.80 → 1.0.83**, `@opencode-ai/plugin` dev pin **1.18.19 → 1.18.29**, `@biomejs/biome` **2.5.9 → 2.5.12**, `@types/bun` **1.3.14 → 1.4.1**, `jdx/mise-action` **v4.2.5 → v4.3.0**, Renovate preset **`#5.2.12` → `#5.2.13`**, `bfra-me/.github` Renovate reusable **v4.19.0 → v4.27.0**, Fro Bot agent **v0.105.0 → v0.109.4** (SHA `b799b64d`). Held: TypeScript **7.0.2**, `@types/node` **24.13.3**, `@changesets/cli` **2.31.1**, `solid-js` **1.9.15**, `@opentui/*` **0.2.7**, `zod` **^4.3.0**, `rimraf` **6.1.3**.

Queue: **#377 merged** (2026-09-07); the five remaining open PRs are **the same five carried from the prior survey, none merged** — #335 (fro-bot, `@opentui/*` 0.4.5, last touched 2026-08-11), #332 (fro-bot, Biome schema 2.5.8, last touched 2026-08-15), #278 (mrbro-bot, `@types/node` v26), #241 (fro-bot, `@types/node` v26, 80 days), #135 (mrbro-bot, `@opentui/solid` 0.4.3, **117 days**). Sixteen `mrbro-bot` PRs merged same-day in the same window against three `fro-bot` PRs parked 26–80 days: the merge-gates-sorted-by-authorship split from [[marcusrbrown--marcusrbrown-com]], reproduced exactly. Open issues unchanged (#38 / #26 / #25).

Delivery posture: `fro-bot.yaml`'s job ends at `Run Fro Bot` — there is **no commit, push, or PR step after the agent**, the shape flagged in [[marcusrbrown--tokentoilet]] as working-dir delivery with the caller's half missing, even though `SCHEDULE_PROMPT` opens with "making commits and pushing fixes directly where possible." Consistent with the observable: the newest `fro-bot`-authored artifact of any kind is PR #335 from **2026-08-01**, and no `fro-bot` commit appears in the 16-commit window — while perpetual issue #26 was updated as recently as **2026-09-09**. The reporting channel works; the delivery channel does not; the working report is what keeps the broken half invisible.

Minor artifact: `renovate.json5`'s own `description` reads `['Use the config preset for the @fro.bot/systematic repository']` — a copy-paste inheritance from a sibling repo, inert but wrong, and further evidence that prose in this repo is not audited by anything.

> **Survey limitation (2026-09-10):** this pass ran without GitHub credentials (`gh` unauthenticated; anonymous REST exhausted mid-run). Tree, manifests, workflows, compare range, commit authorship, repository metadata, and the open issue/PR list were all read successfully; **workflow-run telemetry was not** — no conclusion counts, no scheduled-run liveness series, no issue-body inspection. Claims above are scoped to what was actually observed.

### Corrections to prior surveys (2026-09-10)

Four claims on this page are corrected by the compare endpoint. All are recorded rather than deleted; the prior text stands below with its date.

1. **The Biome schema/CLI gap is widening, not "one hop."** The 2026-08-25 entry says `biome.json`'s `$schema` "perpetually trails the installed CLI by one hop." It does not. `biome.json` is **unmodified across all 16 commits** in this window and pins schema **2.5.5**, while `@biomejs/biome` moved 2.5.9 → **2.5.12**. The gap went from 4 patch releases to **7** and has never been closed by a merge — PR #332 (schema → 2.5.8) has been open since 2026-07-31 and was last touched 2026-08-15. The correct reading is not a lagging sync but a **sync that never lands**, with a superseding Renovate bundle arriving faster than the fro-bot correction can merge. The "one hop" phrasing came from reading the *proposals* rather than the *file*.
2. **`settings.yml` extends `marcusrbrown/.github`, not `fro-bot/.github`.** The file writes the bare short form `_extends: .github:common-settings.yaml`, which resolves to the **owner's** `.github` repository per the `_extends` rule documented in [[probot-settings]] — i.e. [[marcusrbrown--github]]. The prior "Extends `fro-bot/.github:common-settings.yaml`" line is the same misattribution already recorded for [[marcusrbrown--esphome-life]] and [[marcusrbrown--dev-like]]; this is its third instance, which is enough to treat the un-prefixed form as a standing trap rather than a one-off.
3. **`rimraf` and the `clean` script are not new, and neither is `actions/checkout` v7.** `rimraf` **6.1.3** is a devDependency and `build` is `bun run clean && bun scripts/build.ts && tsc --emitDeclarationOnly --noEmit false`; all four workflows pin `actions/checkout@3d3c42e5…# v7.0.1`. The compare shows every one of these unchanged across the window, so they predate `c6c055d` and were simply missed — the page last recorded `actions/checkout` at v6.0.3 on 2026-06-03, meaning the **v6 → v7 major crossed unrecorded**.
4. **The Renovate preset was already `#5.2.12`, not `#5.2.9`.** The 2026-08-25 entry carries `#5.2.9`; the diff for this window is `#5.2.12 → #5.2.13`. Three preset bumps landed between surveys without being caught, because the prior pass read the open-PR list for pin values instead of the config file.

The common cause in (1) and (4) is worth naming: **a proposed version is not an installed one.** Both errors came from sourcing pin values out of PR titles rather than out of the tracked file, and both resolved the same way — read the manifest.

**Status (2026-08-25):** **v0.12.1** on npm — unchanged; **five straight surveys now hold the release line steady while the source tree hasn't moved.** The month since 2026-07-24 (SHA `61bc146` → `c6c055d`) is pure dependency-churn plus autoheal: no release, no source-tree change, no new tools, no new workflows. Every commit in the window is `mrbro-bot[bot]` Renovate automerge (no human `marcusrbrown` commit landed). HEAD `c6c055d` is a Fro Bot agent bump (#376, v0.104.0 → **v0.105.0**). Toolchain deltas: **Bun 1.3.14 → 1.4.0** (a runtime minor, first Bun-minor crossing since the survey series began), `@biomejs/biome` 2.5.4 → **2.5.9**, `@opencode-ai/plugin` dev pin 1.18.4 → **1.18.19**, `opencode-ai` mise 1.18.4 → **1.18.19**, `@github/copilot` CLI 1.0.73 → **1.0.80**, `solid-js` 1.9.14 → **1.9.15**, `bfra-me/.github` reusable v4.16.28-era → **v4.19.0** (via #367 v4.18.0 → #369 v4.19.0), and the Fro Bot agent **v0.94.2 → v0.105.0** (SHA `335e4f8`, ~11 minors in a month, crossing the cosmetic v0.100 line while still 0.x). Two new devDeps surfaced in the manifest: **`@types/bun` 1.3.14** and **`@types/babel__core` 7.20.5**. Unchanged pins: TypeScript **7.0.2**, `@types/node` **24.13.3** (still 24.x LTS), zod **^4.3.0**, `@opentui/*` **0.2.7** (runtime), `@changesets/cli` **2.31.1**. Open count steady at 9 (6 PRs + 3 issues). **The Biome schema-vs-CLI drift became a durable recurring pattern:** the earlier #302 (2.5.4 sync) resolved, but the chase never ends — fro-bot PR **#332** now targets `biome.json` schema 2.5.8 (chasing installed 2.5.8), and the newest Renovate PR **#377** already queues 2.5.9 → 2.5.10, so the config schema perpetually trails the CLI by one hop. **New durable autoheal artifact: fro-bot PR #335** carries the stale Renovate `@opentui/*` 0.4.x branch (#135, `0.4.3`) forward to upstream `0.4.5` as a fro-bot-managed branch with an `overrides.@opentui/core` entry + patch changeset — a concrete instance of the "adopt-and-refresh a stalled Renovate major as an autoheal branch" pattern (see [[opencode-plugins]]). The architectural narrative below remains current as of v0.12.1.

**Status (2026-07-24):** **v0.12.1** on npm — first release since v0.12.0 held across four surveys. The one-month window since 2026-06-24 (SHA `bea97ea` → `61bc146`) shipped a single patch changeset (`488e8da`): *"Skip delayed orphan PID registration after a Copilot task has already reached a terminal state"* — closing a race where a subprocess that finished before its PID landed in the orphan file would still get registered, leaving a stale entry the reaper had to clean up. The source tree at `61bc146` matches the documented v0.12.0 layout (4 tools, `runtime/`, `discovery/`, `lib/`, `tui/`); no new tools or workflows. The TUI half gained three named components — `confirm-card.tsx`, `modal-list.tsx`, `row.tsx` — replacing the earlier flat `components/` set, and test fixtures now include `connect-mismatch.jsonl` / `resume-mismatch.jsonl` (origin-discriminator coverage). The rest is toolchain churn, with two notable *majors* landing: **TypeScript 6.0.3 → 7.0.2** (a full major, tracking the TS 7 "Corsa"/native-port line) and **`@opentui/*` 0.2.6 → 0.2.7** (the long-stalled #130/#135 pins finally moving — though #135 immediately reopened targeting v0.4.3). Other pins: **Biome 2.5.0 → 2.5.4**, `@opencode-ai/plugin` dev pin 1.17.8 → **1.18.4**, `opencode-ai` mise 1.17.8 → **1.18.4**, `@github/copilot` CLI 1.0.63 → **1.0.73**, `@types/node` 24.13.2 → **24.13.3** (still 24.x LTS), `@changesets/cli` 2.31.0 → **2.31.1**, `solid-js` 1.9.13 → **1.9.14**, Renovate preset `#5.2.3` → **`#5.2.9`**, and the Fro Bot agent **v0.76.0 → v0.94.2** (an 18-minor jump in a month, SHA `64029d5`). zod still `^4.3.0`. The architectural narrative below remains current as of v0.12.1 — the patch touches only the orphan-registration timing guard, not the tool catalog or contracts.

**Status (2026-06-24):** v0.12.0 on npm — unchanged from the prior three surveys. The window since 2026-06-13 (SHA `60cbe42` → `bea97ea`) is again pure dependency-update churn: no release, no source-tree change, no new tools, no new workflows. The source tree at `bea97ea` is byte-for-byte the documented v0.12.0 layout (4 tools, `runtime/`, `discovery/`, `lib/`, `tui/`). Deltas are toolchain pins: **Biome 2.4.16 → 2.5.0** (config schema migration in #223, which also replaced the now-deprecated `recommended` field), `@opencode-ai/plugin` dev pin 1.17.2 → **1.17.8**, `opencode-ai` mise 1.17.2 → **1.17.8**, `@github/copilot` CLI 1.0.61 → **1.0.63**, `@types/node` 24.13.1 → **24.13.2** (still within 24.x LTS), the `bfra-me/.github` Renovate reusable workflow v4.16.25 → **v4.16.28**, and the Fro Bot agent advancing **v0.62.0 → v0.76.0** (a 14-minor jump in eleven days). Renovate preset held at `marcusrbrown/renovate-config#5.2.3`; `@opentui/*` held at 0.2.6; zod still `^4.3.0`. The architectural narrative below remains current as of v0.12.0.

**Status (2026-06-13):** v0.12.0 on npm — unchanged from the prior two surveys. The window since 2026-06-03 (SHA `f9aaeea` → `60cbe42`) is again pure dependency-update churn: no release, no source-tree change, no new tools, no new workflows. Deltas are toolchain pins (`@opencode-ai/plugin` dev pin 1.15.13 → **1.17.2**, `opencode-ai` mise 1.15.13 → **1.17.2**, `@github/copilot` CLI 1.0.56 → **1.0.61**, `@types/node` 24.12.4 → **24.13.1**, Biome still 2.4.16), the Renovate preset advancing `marcusrbrown/renovate-config#5.2.0` → **`#5.2.3`**, the `bfra-me/.github` Renovate reusable workflow → **v4.16.25**, and the Fro Bot agent advancing **v0.51.0 → v0.62.0** (through v0.55.x/v0.56.x/v0.57.0/v0.58.0/v0.59.x/v0.60.0/v0.61.0). The architectural narrative below remains current as of v0.12.0.

**Status (2026-06-03):** v0.12.0 on npm — unchanged from the prior survey. The window since 2026-05-21 (SHA `2744ce7` → `f9aaeea`) is pure dependency-update churn driven by Renovate plus Fro Bot agent bumps: no new release, no source-tree changes, no new tools. The substantive deltas are toolchain pins (Biome 2.4.15 → 2.4.16, `@github/copilot` CLI 1.0.48 → 1.0.56, `opencode-ai`/`@opencode-ai/plugin` dev pin 1.15.4 → 1.15.13, `@types/node` 24.12.4) and the Fro Bot agent advancing **v0.44.3 → v0.51.0** (through v0.46.0/v0.48.0/v0.48.1/v0.50.0). The architectural narrative below remains current as of v0.12.0.

**Status (2026-05-21):** v0.12.0 on npm. The plugin has hardened substantially since the initial v0.1.0 scaffold — added an orphan-subprocess reaper with PID-file identity gate (v0.2.0), streaming worker pool for reap probes (v0.3.0), configurable timeouts with cooperative cancellation (v0.4.0), per-parameter tool description enrichment (v0.5.0–v0.7.0), an opt-in `/copilot-status` TUI half (v0.10.0), per-process plugin-factory singleton (v0.8.0, refined in v0.11.0), and a fourth `copilot_resume` tool (v0.12.0). The tool catalog is now 3 → 4. Source tree has expanded from the original 4 module groups to include `src/tui/` (Solid + opentui TUI entry) and a localhost RPC layer (`runtime/rpc-*.ts`, `tui/rpc-client.ts`). Test count has grown from ~6 to 21 unit test files plus an integration suite.

> **Prior contradiction (resolved):** The 2026-04-23 survey recorded all `src/` files as "TODO stubs with implementation plan." As of SHA `02cac9c` (2026-04-27) the source tree was fully implemented, and the 2026-05-21 survey confirms the plugin has shipped 11 minor releases on top of that foundation.

## Technology Stack

| Aspect | Detail |
|--------|--------|
| Language | TypeScript 7.0.2 (strict, ES2022 target, ESM modules). Bumped from 6.0.3 → 7.0.2 (major) in the 2026-07-24 window. |
| Runtime/Build | Bun 1.4.2 (both development and production build target; 1.3.14 → 1.4.0 in the 2026-08-25 window via #370, → 1.4.2 by 2026-09-10) |
| Linting/Formatting | Biome CLI **2.5.12** (NOT ESLint/Prettier — diverges from other Marcus repos using `@bfra.me/eslint-config`). v2.5.0 schema migration landed in #223, which also dropped the deprecated `recommended` field (now expressed as `linter.rules.preset: "recommended"`). **`biome.json`'s `$schema` is pinned at 2.5.5 and has not moved since at least 2026-08-25** — the gap to the installed CLI is 7 patch releases and widening; PR #332 (schema → 2.5.8) has been open since 2026-07-31. See correction (1) above: this is a sync that never lands, not a one-hop lag. |
| Build script | `bun run clean && bun scripts/build.ts && tsc --emitDeclarationOnly --noEmit false`; `clean` is `rimraf dist` (`rimraf` 6.1.3, devDependency). Present since before 2026-08-25 but first recorded 2026-09-10. |
| Versioning | Changesets (`@changesets/cli` v2.31.1, OIDC trusted publishing to npm) |
| Package Manager | Bun (`bun.lock`, `bun install`) |
| Test Runner | `bun test` — separate scripts for unit, TUI (with `--preload @opentui/solid/preload`), and integration |
| Peer Dependencies | `@opencode-ai/plugin >=1.14.41` (narrowed from `>=1.14.0` in v0.12.0; dev pin: **1.18.29** as of 2026-09-10, up from 1.18.19). `@opencode-ai/sdk` peer dep removed in v0.6.0 — it was never imported. |
| Runtime Dependencies | `fkill` 10.0.3 (cross-platform process tree kill); `@opentui/core` + `@opentui/solid` **0.2.7** (TUI; runtime pin held for a third survey — the 0.4.x jump is carried in fro-bot autoheal PR #335, open since 2026-08-01 and untouched since 2026-08-11); `solid-js` **1.9.15** (TUI reactive layer); `zod` ^4.3.0 (pinned with `overrides` to dodge TS2883 from dual-zod trees, added v0.7.0) |
| Dev Type Packages | `@types/bun` **1.4.1** (up from 1.3.14) and `@types/babel__core` **7.20.5**; `rimraf` **6.1.3** (both devDeps) |
| License | MIT |
| Node Engine | >=24 |
| Package exports | `.` (server plugin), `./plugin` (alias), `./tui` (opt-in TUI entry). `oc-plugin: ["server", "tui"]` declares both halves to OpenCode. |
| Build target split | `src/index.ts` builds with `target: 'node'` (plain-Node ESM loadable, gated by CI export-shape assertion); `src/tui/index.tsx` builds with `target: 'bun'` because `@opentui/solid` is Bun-specific. Both produced by `scripts/build.ts` + `tsc --emitDeclarationOnly`. |

### Mise Tooling

`mise.toml` pins (2026-09-10): Bun **1.4.2**, `npm:opencode-ai` **1.18.29**, `npm:@github/copilot` **1.0.83**. (Prior 2026-08-25: Bun 1.4.0, opencode-ai 1.18.19, copilot 1.0.80. Prior 2026-07-24: Bun 1.3.14, opencode-ai 1.18.4, copilot 1.0.73.)

## Architecture

### Plugin Tools

- **`copilot_delegate`** — Spawn `copilot -p` as background subprocess. Returns `task_id` (`cpl_`-prefixed UUID) immediately. Args: `prompt` (required), `agent?`, `model?`, `add_dir?`, `allow_tool?`, `deny_tool?`.
- **`copilot_output`** — Retrieve structured result envelope. Args: `task_id` (required), `block?` (default `false`), `timeout_ms?` (default 30000, max 120000). Envelope includes `status`, `final_message`, `tokens`, `tool_calls_summary`, `origin` (`'spawn' | 'resume' | 'connect'`), and `copilot_session_id` (the upstream Copilot session UUID parsed from the JSONL `result` event, omitted when never emitted).
- **`copilot_cancel`** — Cancel running delegation with SIGTERM → SIGKILL escalation. Returns `{cancelled, was_running}`.
- **`copilot_resume`** *(added v0.12.0)* — Resume a prior Copilot session by ID, name, or prefix via `copilot --resume=<target>`. UUID targets are validated against the local Copilot session store before spawn; missing sessions return a structured error without invoking the CLI. When a prior plugin task's session ID matches the target, that task's `--add-dir` workspace set is reused if the caller omits `addDirs`. CLI `No session, task, or name matched` errors are normalized to `Session not found`. All `cwd` and `addDirs` are validated against allowed roots before spawn; argv-injection-shaped values are rejected. Completion surfaces a `[COPILOT RESUME COMPLETED]` header (vs `[COPILOT DELEGATION COMPLETED]` for spawn).

### Module Layout

```
src/
├── index.ts                    # Plugin entrypoint — Node-loadable ESM, exports `default` only (CI-gated)
├── tools/
│   ├── delegate.ts             # copilot_delegate tool
│   ├── output.ts               # copilot_output tool
│   ├── cancel.ts               # copilot_cancel tool
│   └── resume.ts               # copilot_resume tool (v0.12.0)
├── runtime/
│   ├── subprocess.ts           # Spawns copilot CLI, streams JSONL stdout
│   ├── task-registry.ts        # In-memory task state (create/get/update/delete/cleanup)
│   ├── task-status.ts          # setStatus lifecycle helper — terminal-state-only transitions
│   ├── jsonl-parser.ts         # Single-line JSONL parser for Copilot CLI output
│   ├── envelope.ts             # Builds structured output envelopes from parsed events
│   ├── notify.ts               # Completion notifications + attachCompletionPipeline helper
│   ├── pid-file.ts             # Per-instance PID file (write/read/truncate/unlink), serialized per file
│   ├── orphan-reaper.ts        # Plugin-init reaper for foreign-instance subprocess orphans
│   ├── continuity-checks.ts    # Process-identity + liveness probes for reaper
│   ├── continuity-validation.ts# Validation layer over continuity-checks results
│   ├── plugin-singleton.ts     # Per-process factory singleton (globalThis Symbol)
│   ├── rpc-server.ts           # Localhost-only RPC listener for TUI
│   └── rpc-contract.ts         # Shared TS contract for RPC requests/responses
├── discovery/
│   ├── agents.ts               # Discovers .agent.md files (user + repo only; no builtin list)
│   └── description.ts          # Builds copilot_delegate description from discovered agents
├── lib/
│   ├── ansi.ts                 # Strip ANSI escapes
│   ├── errno.ts                # POSIX errno classification helpers
│   ├── kill-tree.ts            # Cross-platform process-tree kill via fkill + process-group probe
│   ├── normalize-tool-arg-schemas.ts # zod _zod.toJSONSchema override (host-zod compat shim)
│   └── rpc-cleanup.ts          # wireRpcServerCleanup (extracted from index.ts in v0.12.0)
└── tui/
    ├── index.tsx               # TUI plugin entry (Solid + opentui)
    ├── rpc-client.ts           # Client for the server half's RPC listener
    ├── components/             # SolidJS components for /copilot-status
    └── __tests__/              # TUI tests (require @opentui/solid/preload)
```

### Test Suite

```
tests/
├── jsonl-parser.test.ts         # JSONL parser
├── envelope.test.ts             # Envelope builder
├── subprocess.test.ts           # Subprocess wrapper (fake copilot binary)
├── agents.test.ts               # Agent discovery (temp fixture dirs)
├── notify.test.ts               # Notification injection
├── tools.test.ts                # End-to-end tool integration
├── resume.test.ts               # copilot_resume tool (v0.12.0)
├── task-registry.test.ts        # Registry lifecycle
├── task-status.test.ts          # setStatus terminal-state invariants
├── cancel-helper.test.ts        # Cancel helper
├── pid-file.test.ts             # PID file write/read/truncate/unlink + serialize
├── orphan-reaper.test.ts        # Reaper with abort, timeouts, identity gate
├── continuity-checks.test.ts    # comm/lstart probes
├── continuity-validation.test.ts# Validation layer
├── plugin-singleton.test.ts     # Per-process singleton + duplicate-invocation warning
├── rpc-server.test.ts           # RPC listener
├── rpc-contract.test.ts         # RPC contract shape
├── rpc-cleanup.test.ts          # wireRpcServerCleanup
├── normalize-tool-arg-schemas.test.ts # zod schema override
├── package-exports.test.ts      # Asserts dist/index.js exports only `default` (matches CI gate)
├── index.test.ts                # Plugin entry smoke
├── fixtures/jsonl/              # Real Copilot CLI JSONL captures (PII-scrubbed)
└── integration/                 # LLM-driven end-to-end via `opencode run` (gated on GH_TOKEN/COPILOT_PAT; not in CI per #38)
```

### Design Decisions

- **Single-line JSONL parser:** `parseJsonlLine` handles one line at a time, returns `{ type: 'unknown' }` for malformed input. Stream-level multiline accumulation belongs in the subprocess wrapper.
- **Task IDs:** Prefixed with `cpl_` to distinguish from OpenCode-native task IDs.
- **Process cleanup:** Uses `fkill` with `{ force: false, forceAfterTimeout: 2000, waitForExit: 5000 }` and `.catch()` guards on all `killProcessTree` calls. On macOS, `tree: true` is Windows-only, so kill targets the entire process group via `fkill(-pid, ...)` and subprocess is spawned with `detached: true`. Since v0.9.0 `killProcessTree` classifies fkill failures by probing the process *group* (`process.kill(-pid, 0)`); ESRCH is suppressed as "already gone," other states preserve the original throw.
- **Notification safety:** In-flight counter decremented synchronously (before any `await`) in close handlers; counter map entries deleted at zero to prevent memory leaks over long-lived sessions. Since v0.9.0 the fallback `client.app.log` call is wrapped in try/catch and uses the structured SDK shape so synchronous SDK throws can't escape the documented "never throws" contract.
- **Agent discovery (rewritten v0.5.0):** No more `BUILTIN_AGENTS` constant — passing one of the legacy six names (`default`, `explore`, `task`, `general-purpose`, `code-review`, `research`) made the standalone `@github/copilot` CLI fail at spawn with `No such agent`. `discoverAgents` now returns user agents (filtered by repo override) followed by repo agents; `Agent.source` is `'user' | 'repo'`. `buildDescription` emits an actionable hint pointing at `~/.copilot/agents` and `.github/agents` when discovery is empty.
- **Structured errors:** Tools return `{ error: string }` objects, never throw exceptions.
- **`setStatus` lifecycle:** Centralizes terminal-status mutations and is idempotent on terminal state. Since v0.8.0 terminal → non-terminal transitions are explicitly forbidden — once a task reaches `complete`, `failed`, or `cancelled`, every subsequent `setStatus` call is a no-op (closes a resurrection path no caller exercised but the prior contract permitted).
- **Origin discriminator (v0.12.0):** `TaskState`, `OutputEnvelope`, and `EnvelopeInput` carry `origin: 'spawn' | 'resume' | 'connect'`. `spawn`-origin tasks (from `copilot_delegate`) surface `[COPILOT DELEGATION COMPLETED]`; `resume`-origin tasks (from `copilot_resume`) surface `[COPILOT RESUME COMPLETED]`. `connect` is wired for forward compatibility but unused today.
- **Per-parameter description survival (v0.7.0):** OpenCode's tool catalog renders plugin schemas via the host's bundled zod, which lives in a different module instance from the plugin's zod and cannot see plugin-side `.describe()` metadata. Each tool arg schema is patched with a `_zod.toJSONSchema` override (`src/lib/normalize-tool-arg-schemas.ts`) that delegates serialization back to the plugin-local zod — same fix shipped by `@cortexkit/opencode-magic-context` and `@cortexkit/aft-opencode`. `zod` is pinned as a direct dependency with a matching `overrides` entry to keep this repo's tree on a single zod version (resolves TS2883 from two zod trees coexisting at build time).

### Orphan Reaper (added v0.2.0, hardened through v0.10.0)

- **PID file per instance:** `<XDG_STATE_HOME>/opencode-copilot-delegate/orphans/<plugin-pid>.pids` lists each spawned subprocess; entry removed on every terminal status transition.
- **Identity gate:** Reap requires a live process's `comm` (kernel-tracked executable name from `ps -o comm=`) AND `lstart` (start-time string) to match values recorded at spawn time. Combined with a spawner-liveness probe (`process.kill(<plugin-pid>, 0)`), this rules out both PID reuse of an unrelated process and cross-instance kill of a live foreign instance's children.
- **Streaming worker pool (v0.3.0):** Up to `MAX_CONCURRENT_PROBES = 5` workers drain a shared queue independently — a slow `ps` probe blocks only its own worker. Replaces the prior chunked `Promise.all` whose worst case stalled four siblings behind one slow probe.
- **Combined `ps` query (v0.3.0):** `getPidIdentity(pid)` runs `ps -p <pid> -o comm=,lstart=` in a single fork/exec, halving cost and providing an atomic kernel snapshot of both identity legs.
- **Configurable timeouts (v0.4.0):** Per-probe `ps` timeout (default 1000ms; warns on degradation) and overall `reapOrphans` timeout (default 15000ms) with cooperative `AbortSignal` cancellation. In-flight workers cooperate by skipping their next mutating step on abort, so dangerous side effects can't fire after the call returns. `ReapResult.timedOut: true` flags a timeout-aborted reap; count fields go to zero placeholders, not partial-progress accounting.
- **Same-user symlink hardening (v0.9.0):** PID file open and truncate paths use `O_NOFOLLOW`; PID file parent directories are rejected before orphan reaping, cleanup, and plugin init state-directory creation. Defends against attacker-controlled symlinks under same-UID write access.
- **Race-safe cleanup (v0.8.0):** `truncatePidFile(filePath)` and `unlinkPidFile(filePath)` route through the per-file `serializeWrite` lock. ENOENT silently swallowed. `cleanupAfterReap` uses these helpers so concurrent reap + task spawn is automatically race-safe.
- **Terminal-state registration guard (v0.12.1):** Delayed orphan-PID registration is skipped once a Copilot task has already reached a terminal state (`complete`/`failed`/`cancelled`). Closes a race where a subprocess finishing before its PID landed in the orphan file would still register, leaving a stale entry the reaper had to clean up on the next init. Complements the v0.8.0 terminal-transition lock in `setStatus` — same "no work after terminal" invariant, applied to the PID-file write path.
- **Logging prefix:** Since v0.9.0 all runtime warnings share the `[copilot-delegate]` prefix across `kill-tree`, `orphan-reaper`, `pid-file`, `task-registry`, and `task-status`, making operator log filtering predictable.

### Plugin Factory Singleton (added v0.8.0, refined in v0.11.0 and v0.12.0)

When a user lists `opencode-copilot-delegate` in both a user-level (`~/.config/opencode/opencode.json`) and project-level `opencode.json`, the OpenCode host previously invoked the factory once per source — evaluating the module fresh, running orphan reaping, and registering its own copy of the three tools. The factory now resolves at most once per process via a `globalThis` Symbol singleton (`Symbol.for('opencode-copilot-delegate.singleton.v1')`):

- **First invocation:** Runs `doInit` once, returns the real hooks.
- **Duplicate invocation (same PID, v0.11.0):** Returns **empty hooks** (`{}`) instead of the cached real hooks. The host's per-source iteration finds nothing to register a second time, eliminating the double-registration that previously caused each tool to appear twice in the LLM-visible catalog under dual-source configs. Heavy init (agent discovery, orphan reaping, RPC server startup) still runs at most once per process. Emits a one-time `console.warn` + `client.app.log` warning so duplicate-config situations stay observable.
- **Why this diverges from Systematic's PR #352 fix:** Systematic switched to per-load registration. This plugin keeps `plugInOnce` because `doInit` binds a TCP port (RPC server) and writes a PID file — running `doInit` twice in the same process would race on those exclusive resources. The divergence is documented inline in `plugin-singleton.ts` and `rpc-cleanup.ts` with cross-references to the Systematic PR.

### Public-Surface Hardening (v0.12.0)

OpenCode's plugin loader treats every named export from a plugin entry as a separate plugin factory and invokes it with `undefined` input. Systematic took hours of downtime from this contract in v2.5.0 and v2.12.1; this plugin institutionalized the fix:

- `wireRpcServerCleanup` moved out of `src/index.ts` into `src/lib/rpc-cleanup.ts`; the entry re-imports it internally so only `default` is exported.
- Plugin entry now builds with `target: 'node'` (was `'bun'`) so `dist/index.js` loads under plain Node ESM. TUI entry stays on `target: 'bun'` because `@opentui/solid` is Bun-specific.
- CI gate between `Build` and `Unit tests` runs `node --input-type=module -e "import('./dist/index.js').then(m => …)"` and exits non-zero if anything other than `default` is exported or `default` is not a function. `tests/package-exports.test.ts` mirrors the assertion locally. Failure message references the Systematic regressions so future contributors find the rationale.

### TUI Half (added v0.10.0)

- **Opt-in second entry.** `package.json` declares `oc-plugin: ["server", "tui"]` and exposes `./tui` as a separate export. Existing server-only installs continue to register only the three tools; `/copilot-status` only appears when the TUI half is installed in `tui.jsonc`.
- **Slash command registration with feature detection (v0.12.0).** OpenCode 1.14.42 removed `api.command.register` in favor of the keymap engine; 1.14.44+ restored it as a deprecated shim that translates to `api.keymap.registerLayer`. The TUI entry now runtime-feature-detects: 1.14.44+ uses `api.keymap.registerLayer({ commands: [{ namespace: 'palette', name: 'copilot-status', title: 'Copilot Status', category: 'Copilot', run() }], bindings: [] })`; 1.14.41 falls back to `api.command.register`; neither present logs a warning and continues without the slash command. Mirrors the dual-path pattern Magic Context shipped in commit `5fe1c4f`.
- **Re-entrant close fix (v0.10.1):** Pressing Escape on `/copilot-status` previously froze the TUI via re-entrant dialog close handling.
- **Component set (as of 2026-07-24):** `src/tui/components/` holds `confirm-card.tsx`, `modal-list.tsx`, and `row.tsx`, with SolidJS tests (`confirm-card.test.tsx`, `modal-list.test.tsx`) requiring `@opentui/solid/preload`. No release gate is tied to these — they moved in the toolchain window, not a version bump.

### RPC Layer (server ↔ TUI)

The server half exposes a **localhost-only** RPC listener for the TUI. It writes a per-session authenticated port file under `<XDG_CACHE_HOME or ~/.cache>/opencode/copilot-delegate/` so the TUI half can find and authenticate to the right server instance. Cleanup is best-effort: OpenCode's server plugin API has no dispose hook today, so cleanup is tied to process exit signals; the orphan-reaper posture covers missed shutdowns.

### Async Notification Pattern

When a Copilot subprocess completes, the plugin calls `client.session.promptAsync()` to inject a `<system-reminder>` block into the parent session. The `noReply` flag is set based on in-flight task count: `true` while other tasks are running (silent injection), `false` when all complete or on failure (forces a parent turn).

### Auth Precedence

```
COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN > ~/.copilot/auth
```

The plugin logs the resolved auth source (not the token value) at delegation start.

### Scope Boundary

Task state is in-memory within a single OpenCode process. `copilot_output` from a different process returns `{ status: 'unknown', error: 'task_id not found in this OpenCode process' }`. Cross-process sharing is deferred to a future version.

## CI and Automation

Six workflows on `main`:

| Workflow | File | Purpose |
|----------|------|---------|
| CI | `ci.yaml` | Lint (Biome), typecheck (tsc --noEmit), build (bun build + tsc declarations), unit tests (bun test) |
| Fro Bot | `fro-bot.yaml` | PR review + daily autohealing (16:00 UTC) + @fro-bot mentions + dispatch |
| Release | `release.yaml` | Changesets version + publish to npm (triggered on CI success on main, or dispatch) |
| Renovate | `renovate.yaml` | Automated dependency updates via `bfra-me/.github` reusable workflow, `@4861d88a` # **v4.27.0** |
| Update Repo Settings | `update-repo-settings.yaml` | Probot settings sync via `bfra-me/.github` reusable workflow, `@f6a7976c` — **bare SHA, no version comment**, `v4.16.8-3-gf6a7976`, dated 2026-04-23. Push on `settings.yml` change + daily `55 2` cron + dispatch. |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | GitHub Copilot coding agent bootstrap |

Action pins as of 2026-09-10: `actions/checkout@3d3c42e5` # v7.0.1, `actions/setup-node@24997072` # v6.5.0, `actions/cache@55cc8345` # v6.1.0, `jdx/mise-action@c2a87611` # v4.3.0, `oven-sh/setup-bun@0c5077e5` # v2.2.0, `changesets/action@a45c4d59` # v1.9.0, `actions/create-github-app-token@bcd2ba49` # v3.2.0, `fro-bot/agent@b799b64d` # v0.109.4. Every one carries a version comment **except** the `update-repo-settings.yaml` reusable-workflow reference above.

#### The one reference Renovate cannot see

`update-repo-settings.yaml`'s `uses:` is the sole unannotated pin in the repo, and it is frozen at a commit that is reachable from no current ref in `bfra-me/.github` — three commits past tag `v4.16.8` (2026-04-22), dated **2026-04-23**, which is this repository's own creation date. Upstream is at **v4.27.0**; the divergence is roughly eleven minor series and, on the available evidence, the pin has never moved. Renovate is demonstrably healthy here — it merged sixteen PRs in the last two weeks, including the *sibling* `bfra-me/.github` reference in the same directory from the same datasource — so the skip is specific to this line, and the mechanism is the missing `# vX.Y.Z` comment: with no version to anchor to, the `github-actions` manager produces no candidate update at all. Same defect class as [[bfra-me--ha-addon-repository]]'s `chrisdickinson/setup-yq`, and the third fleet instance of a *settings-sync* workflow being the frozen one. Cross-referenced in [[probot-settings]].

### Fro Bot Integration

- **Agent:** `fro-bot/agent@v0.109.4` (SHA `b799b64d102584774af338ddd26a4803d73ae192`) as of 2026-09-10 — reached through **twelve discrete Renovate PRs** (#378–#390 excluding #382) in sixteen days. (Prior: v0.105.0, SHA `335e4f8`; v0.94.2, SHA `64029d5`.)
- **Delivery shape:** the job's final step is `Run Fro Bot`. There is **no commit, push, or PR step after the agent**, and the top-level `permissions:` block grants only `contents: read` — write authority reaches the job solely through `secrets.FRO_BOT_PAT`, passed to both `actions/checkout` and the agent. `SCHEDULE_PROMPT` nevertheless instructs the agent to make "commits and pushing fixes directly where possible." Matches the working-dir delivery break diagnosed in [[marcusrbrown--tokentoilet]]; observable consequence here is that the newest `fro-bot`-authored artifact is PR #335 (2026-08-01) while perpetual issue #26 continued receiving updates through 2026-09-09.
- **Prompt/manifest coupling:** `SCHEDULE_PROMPT` category 3 names the exact devDependency set to watch for majors (`typescript`, `@biomejs/biome`, `@types/bun`, `@types/node`, `rimraf`) — a hand-maintained mirror of `package.json` that will silently under-cover any dependency added later. Instance of the prompt-text-is-an-unmanaged-dependency pattern in [[github-actions-ci]].
- **PR review:** Structured verdict format (PASS/CONDITIONAL/REJECT) with plugin-specific focus areas: TypeScript type safety, OpenCode API contracts (tool schema correctness, `ToolResult` shape, peerDependency compatibility), subprocess safety (spawn correctness, stdin/stdout buffering, signal propagation, process-tree kill, no zombies), tool output safety (no secrets/PATs/PII), changeset hygiene
- **Daily autohealing (16:00 UTC):** 4-category sweep — errored PRs, security, health & maintenance, developer experience. Single perpetual issue ("Daily Autohealing Report" #26) strategy.
- **Required secrets:** `FRO_BOT_PAT`, `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`
- **Required variables:** `FRO_BOT_MODEL`
- **Concurrency:** `fro-bot-{issue|pr|discussion|run_id}`, no cancel-in-progress

### Renovate Configuration

- Extends `marcusrbrown/renovate-config#5.2.13` (2026-09-10; was `#5.2.12` at `c6c055d`, not `#5.2.9` as previously recorded — see correction 4). Renovate config lives at `.github/renovate.json5`. The `bfra-me/.github` reusable Renovate workflow advanced **v4.19.0 → v4.27.0** in this window (#392).
- **No patch-suppression rule.** `renovate.json5` carries exactly three `packageRules`, all allowlists or commit-type overrides — nothing resembling the `matchUpdateTypes: ['patch'] → enabled: false` shape found in 3 of 34 fleet repos. This is why the `fro-bot/agent` pin here reached v0.109.4 while the suppressed repos sit at v0.109.0.
- **Config description is wrong.** `renovate.json5`'s `description` field reads `['Use the config preset for the @fro.bot/systematic repository']` — a copy-paste artifact from a sibling repo. Inert (Renovate ignores `description`), but a second data point that prose in this repo is unaudited.
- LTS-only Node.js constraints for `@types/node` (even majors via regex `/^v?([0-9]*[02468])\\./`) and GitHub Actions node versions. An in-flight autoheal PR (#134) is tightening this further to caret-range LTS pinning.
- `@opencode-ai/*` packages use `build` semantic commit type
- Post-upgrade tasks: `bun install`, `bun run fix`, `bun run build`

### Branch Protection

Required status checks on `main`: `Fro Bot`, `Lint, typecheck, build, unit tests`, `Renovate / Renovate`. Enforces admins. Linear history required. No required PR reviews.

### Probot Settings

Extends the bare short form `_extends: .github:common-settings.yaml`, which resolves to the **owner's** `.github` — i.e. [[marcusrbrown--github]], _not_ the Fro Bot org template. (Surveys before 2026-09-10 recorded this as `fro-bot/.github`; corrected — see correction 2 and [[probot-settings]].) Topics: `opencode, plugin, copilot, github-copilot, typescript, bun`. Homepage: the npm package page — which is rendered from `README.md`, the file documented as stale below.

### Release Pipeline

Uses Changesets via `changesets/action@v1.9.0` (bumped from v1.7.0 in #178 on 2026-06-03). GitHub App token for authenticated pushes (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`). Bun builds then Node.js publishes with npm provenance. Git user set from app slug.

## Open Issues

| # | Title | Notes |
|---|-------|-------|
| 38 | Re-add integration tests to CI | Integration test directory exists but not wired into CI; LLM-driven, gated on `GH_TOKEN`/`COPILOT_PAT` (model overridable via `OPENCODE_TEST_MODEL`, defaults to `opencode/minimax-m2.5`) |
| 26 | Daily Autohealing Report | Perpetual issue managed by Fro Bot |
| 25 | Dependency Dashboard | Renovate tracking issue |

## Open PRs (2026-09-10)

| # | Author | Opened | Last touched | Title |
|---|--------|--------|--------------|-------|
| 335 | `fro-bot` | 2026-08-01 | 2026-08-11 | `fix(deps): bump @opentui/core and @opentui/solid to 0.4.5` — carries the `overrides.@opentui/core` single-root-type-identity pin; still the newest fro-bot artifact of any kind |
| 332 | `fro-bot` | 2026-07-31 | 2026-08-15 | `chore(dev): bump biome config schema to 2.5.8` — now targets a version three releases behind the installed CLI (2.5.12); superseded before it can merge |
| 278 | `mrbro-bot[bot]` | 2026-07-07 | 2026-09-10 | `chore(dev): update dependency @types/node to v26` — blocked by the LTS-only even-majors rule; still refreshed daily by Renovate |
| 241 | `fro-bot` | 2026-06-22 | 2026-08-11 | `chore(dev): update @types/node 24 → 26 (major)` — duplicate track of #278, 80 days |
| 135 | `mrbro-bot[bot]` | 2026-05-16 | 2026-08-11 | `fix(deps): update dependency @opentui/solid to v0.4.3` — **117 days**; superseded by #335, which is itself parked |

**#377 merged** (2026-09-07, `884e7065`), the only movement in the queue. The other five are byte-for-byte the same five carried from 2026-08-25. Against that: sixteen `mrbro-bot[bot]` PRs opened and merged same-day in the same window. The split is authorship, not quality — all three `fro-bot` PRs are single-file dependency changes of exactly the kind Renovate gets automerged for. See [[github-actions-ci]], *Merge Gates Sorted by Authorship, Not Quality*. Note also the **duplicate-track pair** (#241/#278) surviving a third survey: the fro-bot proposal and the Renovate proposal for the same `@types/node` major coexist because neither bot deduplicates against the other's branch.

Open issues unchanged for six surveys: **#38** (re-add integration tests to CI), **#26** (Daily Autohealing Report, last updated 2026-09-09), **#25** (Dependency Dashboard). Open count 9 → **8**.

## Open PRs (2026-08-25)

| # | Title | Notes |
|---|-------|-------|
| 377 | build(dev): update all non-major dependencies | New (mrbro-bot, automerge-labeled) — chases Biome 2.5.9 → 2.5.10, `@opencode-ai/plugin` 1.18.19 → 1.18.21, `@types/bun` 1.3.14 → 1.4.0, `bfra-me/.github` v4.19.0 → v4.20.0, `opencode-ai` mise 1.18.19 → 1.18.21 |
| 335 | fix(deps): bump @opentui/core and @opentui/solid to 0.4.5 | **New fro-bot autoheal branch** — supersedes the stale Renovate #135 (`0.4.3`), carries the `@opentui/*` 0.2.7 → 0.4.5 major forward with an `overrides.@opentui/core` entry (forces single-root type identity to fix dual-`@opentui/core` TS breakage) + patch changeset. Concrete "adopt-and-refresh a stalled Renovate major as an autoheal branch" instance |
| 332 | chore(dev): bump biome config schema to 2.5.8 | fro-bot — successor to the resolved #302 (2.5.4); syncs `biome.json` `$schema` to installed 2.5.8. The perpetual schema-vs-CLI chase |
| 278 | chore(dev): update dependency @types/node to v26 | mrbro-bot duplicate-track of #241 (both target major 26); blocked by the LTS-only even-majors rule |
| 241 | chore(dev): update @types/node 24 → 26 (major) | fro-bot — carried since 2026-06-22; still stalled under the LTS-only (even majors) rule |
| 135 | fix(deps): update dependency @opentui/solid to v0.4.3 | Renovate — stale at 0.4.3; superseded by fro-bot #335 (recommend manual close + Renovate ignore) |

Delta from the 2026-07-24 survey: **#302 (Biome 2.5.4 schema) resolved**, replaced by the ongoing schema-sync chain **#332** (2.5.8) with the newest bundle **#377** already queuing 2.5.9 → 2.5.10. GitHub Actions majors **#276/#277** merged/closed (no longer open). **New fro-bot autoheal PR #335** adopts the stale Renovate `@opentui/*` 0.4.x branch and refreshes it to 0.4.5. **New mrbro-bot bundle #377** (non-major deps). #278/#241 (@types/node v26) and #135 (opentui 0.4.3) still stalled/carried. Open issues unchanged across all surveys: #38 (re-add integration tests to CI), #26 (Daily Autohealing Report), #25 (Dependency Dashboard). Open count steady at 9 (6 PRs + 3 issues).

## Documentation Drift

### README / AGENTS.md tool-count divergence (recorded 2026-09-10)

| Surface | Claim | Correct? |
|---------|-------|----------|
| `README.md` L7 | "This plugin registers **three** tools in OpenCode" — `copilot_delegate`, `copilot_output`, `copilot_cancel` | **No** — has been four since v0.12.0 (2026-05-21) |
| `README.md` L100 | "server-only installs continue to register the **three** tools" | **No** — same error, second occurrence |
| `AGENTS.md` L5 | "It exposes **four** tools to OpenCode sessions", `copilot_resume` enumerated, `src/tools/resume.ts` in the tree diagram | Yes |
| `src/tools/` | `delegate.ts`, `output.ts`, `cancel.ts`, `resume.ts` | Four files |

`copilot_resume` appears **zero times** in `README.md`'s 121 lines. Because `README.md` ships in `package.json`'s `files[]`, this is also the npm package page — the surface `.github/settings.yml` declares as the repository homepage. Three properties make this durable rather than trivial:

1. **The stale doc is the public one and the current doc is the private one.** Agents read `AGENTS.md` and get four tools; humans and npm visitors read `README.md` and get three. Every reader in a position to notice is reading the correct file.
2. **Nothing in CI or the autoheal prompt reads prose for accuracy.** The `Lint, typecheck, build, unit tests` gate covers Biome, `tsc`, `bun build`, the Node ESM export-shape smoke test, and unit tests. `SCHEDULE_PROMPT` covers errored PRs, security advisories, dependency and changeset hygiene, and lint/typecheck/build. No step compares documented surface to shipped surface.
3. **The obvious mechanical check exists and is cheap.** The tool names are string literals in `src/tools/*.ts` and in `README.md`; a test asserting that every registered tool name appears in the README would have failed on the v0.12.0 commit. This repo already ships exactly this shape of guard for a different invariant (`tests/package-exports.test.ts` mirrors the CI export-shape assertion), so the pattern is established locally — it just was not pointed at the docs.

**This page inherited the same error.** Its own Overview paragraph read "registering three tools — `copilot_delegate`, `copilot_output`, `copilot_cancel`" from the 2026-04-23 survey through 2026-08-25, while the sections *below it* correctly documented `copilot_resume` from 2026-05-21 onward. Corrected 2026-09-10. The lesson generalizes past this repo: a survey that reads a README for the summary and the tree for the detail will faithfully reproduce the README's lies in the summary. Read the tree for both, then diff the README against it.

A second suspected drift on the same line of `README.md` is **not** asserted here: it describes completion notification as `client.session.prompt` with `noReply: false` for the first notification per session, while this page's architecture section (sourced from an earlier full-source read) documents `client.session.promptAsync()` with `noReply` keyed on the in-flight task count. Confirming which is current requires reading `src/runtime/notify.ts`, outside this survey's read scope. Flagged for the next source-level pass.

## Design Documentation

- Implementation plan at `docs/plans/2026-04-21-copilot-delegate-plugin.md` — 11 ordered tasks from repo bootstrap through publish
- Solutions directory at `docs/solutions/` — documented solutions to past problems with YAML frontmatter (module, tags, problem_type)
- AGENTS.md — comprehensive agent guide covering architecture, coding standards, testing, commits, security constraints

## Coding Standards (from AGENTS.md)

- TypeScript strict mode, no `as any` / `@ts-ignore` / `@ts-expect-error`
- Prefer `satisfies` over type annotations for inference
- Discriminated unions over optional properties
- ESM imports only
- Biome: 2-space indent, single quotes, no semicolons (ASI)
- Tests: arrange-act-assert, real filesystem fixtures, no mocking libraries, deterministic (no wall-clock timing)
- Commits: conventional format with scopes (`runtime`, `tools`, `discovery`, `ci`, `docs`)

## Relationships

- **[[marcusrbrown--dotfiles]]** — The `copilot-cli` skill in `~/.agents/skills/copilot-cli/SKILL.md` branches on plugin presence. Also shares the OpenCode agent configuration ecosystem.
- **[[marcusrbrown--systematic]]** — Sibling OpenCode plugin. Both use Bun + Biome stack. Systematic is consumed by dotfiles; copilot-delegate is a complementary delegation tool.
- **[[opencode-plugins]]** — First Marcus repo building an OpenCode plugin; establishes patterns for plugin development (peer deps, Bun build, async notification pattern).

## Divergence from Marcus Ecosystem Norms

| Aspect | This repo | Other Marcus repos |
|--------|-----------|-------------------|
| Linting/Formatting | Biome 2.5.12 | ESLint + Prettier (`@bfra.me/eslint-config`) |
| Package Manager | Bun | pnpm (most repos) or Bun (infra) |
| Test Framework | `bun test` | Vitest (most repos) |
| CI Build | `bun build` + `tsc --emitDeclarationOnly` | Varies (Vite, tsup, etc.) |
| Shared Config | None (standalone Biome) | `@bfra.me/eslint-config`, `@bfra.me/tsconfig` |

These divergences are appropriate for an OpenCode plugin — Bun is the OpenCode runtime, Biome is lighter than ESLint+Prettier for a small plugin, and `bun test` matches the ecosystem convention. Same pattern as [[marcusrbrown--systematic]].

## Known Limitations (current as of v0.12.1)

- **Orphaned subprocesses *(largely mitigated since v0.2.0)*:** A PID-file reaper now scans `<XDG_STATE_HOME>/opencode-copilot-delegate/orphans/` at every plugin init, probes the owning plugin's liveness, and reaps subprocesses whose plugin has exited. The strict identity gate (kernel-tracked `comm` + start time) prevents PID-reuse misfires. The "mitigated" qualifier remains because the reap is best-effort under abort/timeout conditions.
- **Prompt visibility in `ps`:** Copilot CLI accepts the prompt as a command-line argument, exposing full prompt text in `ps` output for any user on the host. Upstream limitation — avoid delegating prompts containing secrets or PII; pass sensitive material via files, env vars, or `--secret-env-vars` instead.
- **No subprocess lifetime cap:** Hung `copilot` subprocess stays as `running` indefinitely. Cancel manually via `copilot_cancel`. Configurable timeout still planned for v1.x.
- **Single-process scope:** Task state is in-memory only; cross-process sharing requires future sqlite registry + IPC. `copilot_output` from a different OpenCode process returns `{ status: 'unknown', error: 'task_id not found in this OpenCode process' }`.
- **RPC cleanup is best-effort:** OpenCode's server plugin API has no dispose hook today, so RPC server cleanup relies on process-exit signals and the orphan-reaper posture for missed shutdowns.
- **TUI is opt-in:** Server plugin works alone. `/copilot-status` requires explicitly installing the TUI half in `tui.jsonc` — see the README for the dual-config snippet.
- **Integration tests not in CI:** Test directory exists but tracked as issue #38. Suite skips when neither `GH_TOKEN` nor `COPILOT_PAT` is set.

## 0.x Versioning Policy

Releases under `0.x` are unstable and may include breaking changes between minor versions. README explicitly recommends pinning to an exact version in production. `1.0.0` will be cut once the public surface stabilizes — likely after the configurable subprocess timeout and cross-process registry land.

## Survey History

| Date | SHA | Key delta |
|------|-----|-----------|
| 2026-09-10 | `b67bd4da` | **v0.12.1 held (6th straight steady-release survey, 48 days); zero source-tree change.** 16 commits / 7 files, all `mrbro-bot[bot]`. **12 of 16 commits are `fro-bot/agent` pin bumps** (v0.105.0 → **v0.109.4**, #378–#390 less #382) — the control case for [[github-actions-ci]]'s 2026-09-10 patch-suppression census, since this repo carries no patch-disable rule. **README is a tool behind**: says "three tools", `copilot_resume` absent from all 121 lines since v0.12.0 (~3.7 months), while `AGENTS.md` correctly says four — stale public doc, current agent doc; README is also the npm page via `files[]`. **`update-repo-settings.yaml` pinned to a bare untagged SHA** `f6a7976c` (= `v4.16.8-3-gf6a7976`, dated 2026-04-23 = repo creation) with no version comment ⇒ invisible to Renovate, ~11 minor series behind, while the sibling `renovate.yaml` went v4.19.0 → **v4.27.0** in the same window. Deps: Bun 1.4.0 → **1.4.2**, opencode-ai/`@opencode-ai/plugin` 1.18.19 → **1.18.29**, `@github/copilot` 1.0.80 → **1.0.83**, Biome CLI 2.5.9 → **2.5.12**, `@types/bun` 1.3.14 → **1.4.1**, `jdx/mise-action` v4.2.5 → **v4.3.0**, Renovate preset `#5.2.12` → **`#5.2.13`**. Held: TS 7.0.2, `@types/node` 24.13.3, changesets 2.31.1, solid-js 1.9.15, `@opentui/*` 0.2.7, zod ^4.3.0, rimraf 6.1.3. Queue: **#377 merged**; the other five open PRs unchanged and unmerged (#135 at 117 days) against 16 same-day `mrbro-bot` merges. Open count 9 → **8**. **Four prior claims corrected** (Biome "one hop", `_extends` target, rimraf/checkout-v7 under-recording, preset `#5.2.9`). Survey ran without GitHub credentials — no run-level telemetry. |
| 2026-08-25 | `c6c055d` | **v0.12.1 held (5th straight steady-release survey); no source-tree/tool change.** Pure dependency-churn + autoheal window — every commit is `mrbro-bot[bot]` Renovate automerge, no human commit. **Bun 1.3.14 → 1.4.0** (first Bun-minor crossing in the series), Biome 2.5.4 → **2.5.9**, `@opencode-ai/plugin` 1.18.4 → **1.18.19**, `opencode-ai` mise 1.18.4 → **1.18.19**, `@github/copilot` CLI 1.0.73 → **1.0.80**, `solid-js` 1.9.14 → **1.9.15**, `bfra-me/.github` reusable → **v4.19.0**, Fro Bot agent **v0.94.2 → v0.105.0** (SHA `335e4f8`, ~11 minors, crosses cosmetic v0.100). New devDeps `@types/bun` **1.3.14** + `@types/babel__core` **7.20.5**. Unchanged: TS 7.0.2, `@types/node` 24.13.3, zod ^4.3.0, `@opentui/*` runtime 0.2.7, `@changesets/cli` 2.31.1. Open PRs reshuffled: **#302 resolved**, schema-sync chain now **#332** (2.5.8) + newest **#377** (2.5.9 → 2.5.10); GH Actions majors #276/#277 merged; **new fro-bot autoheal #335** adopts stale Renovate `@opentui/*` 0.4.x → 0.4.5 with `overrides.@opentui/core`; #278/#241/#135 stalled. Open count steady at 9. Six workflows including `fro-bot.yaml` present. |
| 2026-07-24 | `61bc146` | **v0.12.0 → v0.12.1** — first release in four surveys. Single patch changeset (`488e8da`): skip delayed orphan-PID registration after a task reaches a terminal state (closes a stale-entry race). Source-tree layout unchanged (4 tools); TUI components refactored to `confirm-card.tsx`/`modal-list.tsx`/`row.tsx`; fixtures added `connect-mismatch.jsonl`/`resume-mismatch.jsonl`. Two major bumps: **TypeScript 6.0.3 → 7.0.2** and **`@opentui/*` 0.2.6 → 0.2.7** (#130 merged, #135 landed then reopened at v0.4.3). Also **Biome 2.5.0 → 2.5.4**, `@opencode-ai/plugin` 1.17.8 → **1.18.4**, `opencode-ai` mise 1.17.8 → **1.18.4**, `@github/copilot` CLI 1.0.63 → **1.0.73**, `@types/node` 24.13.2 → **24.13.3**, `@changesets/cli` 2.31.0 → **2.31.1**, `solid-js` 1.9.13 → **1.9.14**, Renovate preset `#5.2.3` → **`#5.2.9`**, Fro Bot agent **v0.76.0 → v0.94.2** (SHA `64029d5`, 18-minor jump). zod still `^4.3.0`. Open PRs reshuffled: #169/#134 closed, #302 (Biome 2.5.4 schema) new, GH Actions majors #276/#277 new, #278 second `@types/node` v26 track new; #241 stalled. Open issues unchanged (#38/#26/#25). Six workflows including `fro-bot.yaml` present. |
| 2026-06-24 | `bea97ea` | No release (still v0.12.0) and no source-tree change since `60cbe42`. Dependency-churn-only window: **Biome 2.4.16 → 2.5.0** (config schema migration #223, deprecated `recommended` field replaced); Fro Bot agent **v0.62.0 → v0.76.0** (14-minor jump in eleven days, through v0.63.0–v0.76.0); `@opencode-ai/plugin` dev pin 1.17.2 → **1.17.8**; `opencode-ai` mise 1.17.2 → **1.17.8**; `@github/copilot` CLI 1.0.61 → **1.0.63**; `@types/node` 24.13.1 → **24.13.2** (still within 24.x LTS); `bfra-me/.github` Renovate reusable v4.16.25 → **v4.16.28**. Renovate preset held at `#5.2.3`, `@opentui/*` held at 0.2.6, zod still `^4.3.0`. Open PR set shifted: #127 (24 → 25 major) closed, new #241 (24 → 26 major); #130/#134/#135/#169 still open (#169 now likely redundant post-#223). Open issues unchanged (#38/#26/#25). Six workflows including `fro-bot.yaml` present. |
| 2026-06-13 | `60cbe42` | No release (still v0.12.0) and no source-tree change since `f9aaeea`. Dependency-churn-only window: Fro Bot agent **v0.51.0 → v0.62.0** (11-minor jump in ten days, through v0.55.x–v0.61.0); `@opencode-ai/plugin` dev pin 1.15.13 → **1.17.2**; `opencode-ai` mise 1.15.13 → **1.17.2**; `@github/copilot` CLI 1.0.56 → **1.0.61**; `@types/node` 24.12.4 → **24.13.1** (still within 24.x LTS); Renovate preset `#5.2.0` → **`#5.2.3`**; `bfra-me/.github` Renovate reusable → **v4.16.25**. Biome held at 2.4.16, `@opentui/*` held at 0.2.6, zod still `^4.3.0`. Open PR set identical (#127/#130/#134/#135/#169 all still open); open issues unchanged (#38/#26/#25). Six workflows including `fro-bot.yaml` present. |
| 2026-04-23 | `bea3f57` | Initial survey — v0.1.0 scaffold with TODO stubs, no CI/Fro Bot/Renovate on main |
| 2026-04-27 | `02cac9c` | Implementation complete, CI active, Fro Bot v0.42.2, Renovate live, 6 workflows, `fkill` dependency added, Biome 1.9.4→2.4.13, TypeScript 6.0.3, 3 open issues |
| 2026-06-03 | `f9aaeea` | No release (still v0.12.0) and no source-tree change since `2744ce7`. Window is dependency-update churn only: Fro Bot agent v0.44.3 → v0.51.0 (through v0.46.0/v0.48.0/v0.48.1/v0.50.0); `changesets/action` v1.7.0 → v1.9.0 (#178); `actions/checkout` → v6.0.3; `bfra-me/.github` → v4.16.22; Biome 2.4.15 → 2.4.16; `@github/copilot` CLI 1.0.48 → 1.0.56; `opencode-ai`/`@opencode-ai/plugin` dev pin 1.15.4 → 1.15.13; `@types/node` 24.12.4. New open PR #169 (Biome schema/CLI version sync). The four prior open PRs (#127/#130/#134/#135) remain unmerged; open issues unchanged (#38/#26/#25). `@opentui/*` runtime deps still pinned at 0.2.6, zod still `^4.3.0`. |
| 2026-05-21 | `2744ce7` | v0.12.0 on npm (11 minor releases since prior survey). Fourth tool `copilot_resume` added. TUI half (`src/tui/`) shipped opt-in via `oc-plugin: ["server", "tui"]` and `./tui` export. Orphan reaper (v0.2.0+) hardened through streaming worker pool (v0.3.0), configurable timeouts (v0.4.0), symlink-attack defenses (v0.9.0), race-safe cleanup (v0.8.0). Per-process plugin singleton (v0.8.0/v0.11.0) returns empty hooks on duplicate invocation to fix double-registration under dual-config. Public-surface hardening (v0.12.0): plugin entry now Node-loadable, CI gates export shape. Localhost RPC layer wires server ↔ TUI. Fro Bot agent v0.42.2 → v0.44.3. Renovate preset `marcusrbrown/renovate-config#4.5.8` → `#5.2.0`. `@opencode-ai/sdk` peer dep removed (v0.6.0, was never imported). `@opencode-ai/plugin` peer narrowed `>=1.14.0` → `>=1.14.41`. zod pinned `^4.3.0` with `overrides` (v0.7.0) to dodge dual-zod TS2883. Tests grew from ~6 to 21 unit files plus integration. 3 open issues (same as prior), 4 open PRs (Renovate + one Fro Bot self-correction). |
