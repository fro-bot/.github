---
type: repo
title: "marcusrbrown/systematic"
created: 2026-04-24
updated: 2026-05-28
sources:
  - url: https://github.com/marcusrbrown/systematic
    sha: ef02119abd801487dc0e53a43ac2d6b6433873ab
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/systematic
    sha: 420ef650215a9ca8cefa01f125e02434e351952e
    accessed: 2026-05-06
  - url: https://github.com/marcusrbrown/systematic
    sha: 9b7570782190d540b4d57abdd94cf7ca8e1984f1
    accessed: 2026-05-28
tags: [opencode, plugin, ai, workflow, typescript, bun, biome, semantic-release, npm, zod, json-schema]
related:
  - marcusrbrown--opencode-copilot-delegate
  - marcusrbrown--dotfiles
  - marcusrbrown--copiloting
  - marcusrbrown--gpt
  - marcusrbrown--vbs
---

# marcusrbrown/systematic

OpenCode plugin providing structured engineering workflows for AI-powered development. Published to npm as `@fro.bot/systematic`. Adapted from the [Compound Engineering Plugin (CEP)](https://github.com/EveryInc/compound-engineering-plugin) for Claude Code, now evolving independently.

## Overview

| Attribute       | Value                                                |
| --------------- | ---------------------------------------------------- |
| Created         | 2026-01-24                                           |
| Last push       | 2026-05-28                                           |
| Latest release  | v2.24.0 (2026-05-27)                                 |
| Language        | TypeScript (strict, ESM)                             |
| Runtime         | Bun                                                  |
| License         | MIT                                                  |
| Stars           | 22                                                   |
| Open issues     | 3 (Weekly Maintenance #157, Daily Autohealing #153, Dependency Dashboard #15) |
| Homepage        | https://fro.bot/systematic                           |
| npm             | `@fro.bot/systematic`                                |
| Default branch  | main                                                 |

## Architecture

Two distinct parts:

1. **TypeScript source** (`src/`) — Plugin logic, tools, config handling, CLI
2. **Bundled assets** (`skills/`, `agents/`) — Markdown content shipped with the npm package

### Plugin Hooks

The plugin implements three OpenCode hooks:

- **`config`** — Discovers and merges bundled skills (45) and agents (50) into OpenCode configuration. Existing user/project config takes precedence.
- **`tool`** — Registers the `systematic_skill` tool for on-demand skill loading.
- **`system.transform`** — Injects the "Using Systematic" bootstrap guide into system prompts.

### Source Modules (`src/lib/`)

| Module                    | Role                                           |
| ------------------------- | ---------------------------------------------- |
| `config-handler.ts`       | Config hook — merges bundled assets             |
| `config-schema.ts`        | Zod schema for `systematic.json` user config (v2.16+); typed bundled-name validation with IDE autocomplete (#384) |
| `config.ts`               | JSONC config loading and merging; surfaces every Zod issue in top-level error message (#398); project-local Systematic overrides global Systematic output (#370) |
| `skill-tool.ts`           | `systematic_skill` tool factory                 |
| `skill-loader.ts`         | Skill content loading and formatting            |
| `skill-catalog.ts`        | Bootstrap-injected catalog of available skills (v2.18+, #365) |
| `bootstrap.ts`            | System prompt injection; SUBAGENT-STOP block + Instruction Priority section in `using-systematic` (#405); simplified skill usage guidance (#368) |
| `bundled-names.ts`        | Generated registry of bundled skill/agent names for typed validation |
| `agents.ts`               | Agent discovery (category from subdirectory)    |
| `agent-colors.ts`         | Per-category color assignments for agents       |
| `agent-overlays.ts`       | Model availability overlay for agent selection; memoized per OpencodeClient instance (#383); collapses empty cache/discovery to unknown status (#378, #372) |
| `model-availability.ts`   | Runs discovery before validation (#372, #376); upstream of overlay |
| `source-model-defaults.ts`| Default model assignments per agent/skill source |
| `skills.ts`               | Skill discovery (highest centrality in codebase)|
| `commands.ts`             | Command discovery (backward compat)             |
| `converter.ts`            | CEP-to-OpenCode content conversion (CLI)        |
| `frontmatter.ts`          | YAML frontmatter parsing                        |
| `validation.ts`           | Agent config validation and type guards         |
| `walk-dir.ts`             | Recursive directory walker                      |

`plugin-singleton.ts` (introduced v2.7.2) has been folded into the broader factory layer — modules now coordinate via the config-handler entry point. Per-process singleton semantics are preserved.

### Bundled Assets

- **47 skills** in `skills/` — Core CE workflows (`ce:brainstorm`, `ce:plan`, `ce:review`, `ce:work`, `ce:compound`, `ce:compound-refresh`, `ce:ideate`), development tools (`agent-browser`, `frontend-design`, `git-worktree`, `git-commit`, `git-commit-push-pr`, `git-clean-gone-branches`), specialized skills (`dhh-rails-style`, `dspy-ruby`, `gemini-imagegen`, `proof`, `rclone`, `andrew-kane-gem-writer`), engineering practice (`test-driven-development`, `writing-skills`, `writing-systematic-skills` — imported from obra/superpowers in #394), autonomous workflows (`lfg`, `slfg`), release automation (`release-notes-narrative` — new in v2.23.0, #429). Deprecation surface introduced in v2.18+ marks `orchestrating-swarms` and `claude-permissions-optimizer` (#401).
- **51 agents** in `agents/` across 6 categories: `design/` (3), `docs/` (1), `document-review/` (7), `research/` (7), `review/` (28), `workflow/` (5)
- **OCX registry** in `registry/` — Component-level installation via `ocx` CLI with named profiles (`omo`, `standalone`); v2.20.6 of the registry was the last published before the v2.21+ launch-surface refresh

### Configuration Schema

Starting in the v2.14–v2.17 arc, `systematic.json` user config is fully Zod-typed:

- `config-schema.ts` defines the canonical schema; `scripts/generate-config-schema.ts` emits a JSON Schema published at `fro.bot/systematic/schemas/v2/` (consumed by IDEs for autocomplete)
- `schema:drift` script gates the generated schema in CI
- Schema construction uses a factory pattern (#393) for composability
- Unrecognized keys and invalid values produce per-issue diagnostics surfaced in the top-level error message (#390, #398)
- Bundled skill/agent names are validated against `bundled-names.ts` for typo detection

### CLI

The `systematic` binary provides:
- `list [type]` — List available skills, agents, or commands
- `convert <type> <file>` — Convert CEP-format files to OpenCode format
- `config show` / `config path` — Configuration inspection

### Documentation Site

Starlight/Astro docs workspace in `docs/` with content generated from bundled assets via `docs/scripts/transform-content.ts`. Deployed to `fro.bot/systematic`. Includes guides (philosophy, main loop, agent install, conversion) and generated reference pages for all skills and agents.

## Stack Divergence

Systematic diverges from the `@bfra.me/*` shared config ecosystem used by most Marcus repos:

| Aspect     | Systematic                  | Other Marcus repos (typical)         |
| ---------- | --------------------------- | ------------------------------------ |
| Linter     | Biome 2.x                  | ESLint + `@bfra.me/eslint-config`    |
| Formatter  | Biome                       | Prettier + `@bfra.me/prettier-config`|
| Runtime    | Bun                         | Node.js (pnpm)                       |
| Test       | `bun:test`                  | Vitest                               |
| Build      | `bun build` (splitting)     | tsup / Vite / native TS              |

This divergence is deliberate — the plugin targets Bun as OpenCode's native runtime and uses Biome for unified lint+format. The `package.json` still requires `node >= 18` for compatibility (e.g., the CI build verification step uses Node.js to confirm the plugin loads outside Bun).

## CI/CD

8 GitHub Actions workflows (consolidated from 9 — `fro-bot-autoheal.yaml` merged into `fro-bot.yaml` in #446):

| Workflow                  | Purpose                                              | Trigger                          |
| ------------------------- | ---------------------------------------------------- | -------------------------------- |
| **Main**                  | Build, typecheck, lint, test, registry validate, docs build, release | PR, push to main, dispatch |
| **Fro Bot**               | PR review + weekly maintenance + daily autohealing in a single workflow with three operating modes routed via an inline PROMPT ternary | PR, issue, comment, discussion_comment, schedule (Mon 09:00 UTC review; daily 03:30 UTC autoheal), workflow_call, workflow_dispatch (mode: review/maintenance/autoheal) |
| **Renovate**              | Dependency updates via reusable workflow              | Issue/PR edits, push, workflow_run, dispatch |
| **CodeQL**                | Security vulnerability analysis                      | PR, push, schedule               |
| **Scorecard**             | OpenSSF supply-chain security                        | Push to main, schedule           |
| **Docs**                  | Documentation site build/deploy                      | PR, push                         |
| **Copilot Setup Steps**   | Copilot coding agent environment bootstrap           | PR                               |
| **Update Repo Settings**  | Probot settings sync                                 | Push, schedule, dispatch         |

### Release Pipeline

Semantic-release with conventional commits. Notable release rules:
- `build` scope triggers patch releases (except `build(dev)`)
- `docs(skill)`, `docs(skills)`, `docs(agents)`, `docs(commands)`, `docs(readme)` trigger patch releases — skill/agent content changes are published as npm updates
- Tag format: `v${version}`
- npm publishing with provenance, GitHub Releases, GitHub App token for commits

### Branch Protection

Required status checks: Build, Docs Build, Fro Bot, Typecheck, Lint, Test, Registry, Release, CodeQL Analyze (typescript), Renovate. Linear history enforced. Admin enforcement on.

## Fro Bot Integration

**Fully active.** Consolidated into a single workflow file as of #446 (v2.23+ era):

- `fro-bot.yaml` — `fro-bot/agent@v0.45.0` (SHA `8aac0fc36437a6c871321fa3389033c8262504b7`). Three operating modes selected by an inline `PROMPT` ternary keyed on `event_name × mode × cron`:
  1. **PR review** — `PR_REVIEW_PROMPT` env, TypeScript/Bun/Biome-specific (type safety, ESM conventions, zero-class convention, breaking change detection, security implications for prompt injection)
  2. **Weekly maintenance** — `MAINTENANCE_PROMPT` env, Mon 09:00 UTC, rolling issue with 28-day window
  3. **Daily autoheal** — `AUTOHEAL_PROMPT` env, daily 03:30 UTC, 4-category sweep: errored PRs (CI fix and push), security (Dependabot/Renovate alerts), health & maintenance (major version updates, Action SHA pinning), developer experience (typecheck, lint fixes)
- `workflow_call` accepts `prompt` (required) and optional `correlation-id` — used by the `release-notes-narrative` automation to dispatch verbatim prompts and match dispatched runs by scanning early log output (#430, #432, #433, #434)
- `workflow_dispatch` accepts `mode`, `prompt`, `correlation-id`; non-empty `prompt` is honored verbatim regardless of `mode` (this precedence is mandatory for the release-notes contract — documented inline in #450)
- `@fro-bot` mention responses (OWNER/MEMBER/COLLABORATOR gated)
- Fork-PR guard for `issue_comment` events handled by an explicit API-query step because `github.event.pull_request` is null on that path (#451). Other PR-adjacent event types (`pull_request`, `pull_request_review_comment`) catch forks via the top-level `if:` gate.

### PR Review Prompt Conventions

The PR review prompt enforces:
- No `any`, no `@ts-ignore`, explicit return types on exports
- ESM: `node:` protocol for builtins, `.js` extensions on relative imports
- Functions over classes (zero-class convention)
- Biome compliance (not ESLint/Prettier)
- Breaking change awareness for plugin API hooks
- Security evaluation for system prompt injection or skill loading
- Structured verdict: `PASS | CONDITIONAL | REJECT` with blocking issues, non-blocking concerns, missing tests, risk assessment

## Renovate Configuration

Extends `marcusrbrown/renovate-config` + `sanity-io/renovate-config:semantic-commit-type`. Package rules:
- `@types/node` limited to even (LTS) major versions
- Node.js in Actions limited to LTS versions
- Semantic-release packages use `build` commit type
- `@opencode-ai/*` packages use `build` commit type
- Post-upgrade: `bun install && bun run fix`

## Probot Settings

Extends `fro-bot/.github:common-settings.yaml` — same pattern as [[marcusrbrown--ha-config]], [[marcusrbrown--vbs]], [[marcusrbrown--containers]], and other Marcus repos.

## OpenCode Configuration

`opencode.json` uses `./src/index.ts` as a local plugin (development mode). Markdownlint configured as a formatter for `.md` files.

## Relationship to Other Repos

- **[[marcusrbrown--opencode-copilot-delegate]]** — The other OpenCode plugin in Marcus's portfolio. Different purpose (Copilot CLI delegation vs. workflow orchestration) but same plugin API. Copilot-delegate uses Biome + Bun like systematic, suggesting this is the emerging standard for Marcus's OpenCode plugin repos.
- **[[marcusrbrown--dotfiles]]** — Consumes systematic as an installed plugin (`@fro.bot/systematic@latest` in OpenCode config). The dotfiles repo's OpenCode model routing and agent configuration directly uses systematic's skills and agents.
- **[[marcusrbrown--copiloting]]** — Historical CEP/AI experimentation repo. Systematic supersedes CEP for the OpenCode ecosystem.
- **[[marcusrbrown--gpt]]**, **[[marcusrbrown--vbs]]** — Repos where Fro Bot agents use systematic-provided skills and agents during PR review and maintenance.
- **`fro-bot/.github`** — This repo. Runs systematic as a plugin in the Fro Bot agent workflow. Systematic's `systematic_skill` tool is available in every Fro Bot agent session.

## Release History (since v2.5.1)

| Version | Date       | Key change                                              |
| ------- | ---------- | ------------------------------------------------------- |
| v2.6.0  | 2026-04-25 | OCX V2 schema migration, content-integrity CI gate, single-export entry point fix |
| v2.6.1  | 2026-04-28 | Import 13 missing skill reference sub-files; sub-file integrity gate |
| v2.7.0  | 2026-04-30 | Skill authoring guardrails (#325)                       |
| v2.7.1  | 2026-05-01 | Stabilize system prompt prefix (#329)                   |
| v2.7.2  | 2026-05-04 | Deduplicate factory registration across opencode.json sources (#335) |
| v2.7.3  | 2026-05-05 | Omit `model` field from all 50 bundled agents (#336, upstream fix for sst/opencode#17888) |
| v2.14–v2.17 arc | 2026-05-13 → 2026-05-20 | Typed config validation: Zod-driven `systematic.json` schema, per-issue diagnostics (#388, #390, #393, #394, #397, #398); test-driven-development + writing-skills imported from obra/superpowers (#394); schema `$ref` dedup |
| v2.18.0 | ~2026-05-21 | Skill catalog moved into system prompt (#365); deprecation surface for `orchestrating-swarms` and `claude-permissions-optimizer` (#401) |
| v2.19.0 | 2026-05-21 | SUBAGENT-STOP block + Instruction Priority section injected into `using-systematic` bootstrap (#405); v3.0.0 CC-residue excision plan committed (#403) |
| v2.20.x | 2026-05-21 | Overlay hardening: discovery before validation (#372), empty-cache to unknown status (#378), per-client memoization (#383); project-local Systematic overrides global Systematic output (#370); registry advanced to v2.20.6 with 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin) |
| v2.21.0 | 2026-05-23 | Launch-surface cleanup (#428): README, home, Quick Start, config docs, contributor docs |
| v2.22.0 | 2026-05-23 | New `release-notes-narrative` project-scoped skill (#429) |
| v2.23.0–v2.23.6 | 2026-05-23 → 2026-05-27 | Automated release-notes-narrative via `@semantic-release/exec` (#430); successCmd extraction to `scripts/dispatch-release-notes.sh` (#432); bash escape for Lodash render (#431); timestamp-based run identification replacing log-scan (#434); correlation-id input on `fro-bot.yaml` (#433); docs modernization (#421, #422); design-iterator + docs aligned with Impeccable design laws (#418, #419) |
| v2.24.0 | 2026-05-27 | OpenCode dep bumped to v1.15.10 (#442); Starlight ^0.39.0 (#444); `docs:verify` script for local CI-parity pre-checks (#445); fork-guard asymmetry documented inline (#451); PROMPT routing precedence documented inline (#450); `fro-bot.yaml` + `fro-bot-autoheal.yaml` consolidated (#446) |

## Open Issues / PRs

| # | Title | Type |
|---|-------|------|
| #157 | Weekly Maintenance Report | Issue (rolling) |
| #153 | Daily Autohealing Report | Issue (rolling) |
| #15  | Dependency Dashboard | Issue (Renovate) |

0 open PRs at survey time — main is fully drained.

## Survey History

| Date       | SHA        | Delta                    |
| ---------- | ---------- | ------------------------ |
| 2026-04-24 | `ef02119`  | Initial survey           |
| 2026-05-06 | `420ef65`  | 28 commits, v2.5.1→v2.7.3, skills 45→46, agent v0.41.4→v0.42.7, `plugin-singleton.ts` added, OCX V2, content-integrity gate, skill guardrails, model field removal |
| 2026-05-28 | `9b75707`  | ~80 commits, v2.7.3→v2.24.0, skills 46→47, agents 50→51, agent v0.42.7→v0.45.0, `fro-bot.yaml` + `fro-bot-autoheal.yaml` consolidated (#446), `plugin-singleton.ts` removed, Zod config schema arc (v2.14–v2.17), `release-notes-narrative` skill + semantic-release-driven dispatch, launch-surface cleanup, docs modernization, deprecation surface, overlay hardening, project-local override fix |
