---
type: repo
title: "marcusrbrown/systematic"
created: 2026-04-24
updated: 2026-05-06
sources:
  - url: https://github.com/marcusrbrown/systematic
    sha: ef02119abd801487dc0e53a43ac2d6b6433873ab
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/systematic
    sha: 420ef650215a9ca8cefa01f125e02434e351952e
    accessed: 2026-05-06
tags: [opencode, plugin, ai, workflow, typescript, bun, biome, semantic-release, npm]
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
| Last push       | 2026-05-06                                           |
| Latest release  | v2.7.3 (2026-05-05)                                 |
| Language        | TypeScript (strict, ESM)                             |
| Runtime         | Bun                                                  |
| License         | MIT                                                  |
| Stars           | 14                                                   |
| Open issues     | 4                                                    |
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

| Module             | Role                                           |
| ------------------ | ---------------------------------------------- |
| `config-handler.ts`| Config hook — merges bundled assets             |
| `skill-tool.ts`    | `systematic_skill` tool factory                 |
| `skill-loader.ts`  | Skill content loading and formatting            |
| `bootstrap.ts`     | System prompt injection                         |
| `converter.ts`     | CEP-to-OpenCode content conversion (CLI)        |
| `frontmatter.ts`   | YAML frontmatter parsing                        |
| `plugin-singleton.ts`| Factory deduplication across opencode.json sources (v2.7.2) |
| `validation.ts`    | Agent config validation and type guards         |
| `skills.ts`        | Skill discovery (highest centrality in codebase)|
| `agents.ts`        | Agent discovery (category from subdirectory)    |
| `commands.ts`      | Command discovery (backward compat)             |
| `config.ts`        | JSONC config loading and merging                |
| `walk-dir.ts`      | Recursive directory walker                      |

### Bundled Assets

- **46 skills** in `skills/` — Core CE workflows (`ce:brainstorm`, `ce:plan`, `ce:review`, `ce:work`, `ce:compound`, `ce:ideate`), development tools (`agent-browser`, `frontend-design`, `git-worktree`, `orchestrating-swarms`), specialized skills (`dhh-rails-style`, `dspy-ruby`, `gemini-imagegen`, `proof`, `rclone`), autonomous workflows (`lfg`, `slfg`). Skill authoring guardrails added in v2.7.0 (#325).
- **50 agents** in `agents/` across 6 categories: `design/`, `docs/`, `document-review/`, `research/`, `review/`, `workflow/`
- **OCX registry** in `registry/` — Component-level installation via `ocx` CLI with named profiles (`omo`, `standalone`)

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

9 GitHub Actions workflows:

| Workflow                  | Purpose                                              | Trigger                          |
| ------------------------- | ---------------------------------------------------- | -------------------------------- |
| **Main**                  | Build, typecheck, lint, test, registry validate, docs build, release | PR, push to main, dispatch |
| **Fro Bot**               | PR review, weekly maintenance, @fro-bot mentions, dispatch | PR, issue, comment, schedule (Mon 09:00 UTC), dispatch |
| **Fro Bot Autoheal**      | Daily repo autohealing (4 categories)                | Daily 03:30 UTC, dispatch        |
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

**Fully active.** Three workflow files:

- `fro-bot.yaml` — `fro-bot/agent@v0.42.7` (SHA `30a8e428`)
  - PR review with TypeScript/Bun/Biome-specific prompt (type safety, ESM conventions, no classes, breaking change detection, security implications for prompt injection)
  - Weekly maintenance report (rolling issue, 28-day window)
  - `@fro-bot` mention responses (OWNER/MEMBER/COLLABORATOR gated)
  - `workflow_call` support for reuse from autoheal
- `fro-bot-autoheal.yaml` — Daily autohealing with 4-category sweep:
  1. Errored PRs (CI fix and push)
  2. Security (Dependabot/Renovate alerts)
  3. Health & Maintenance (major version updates, Action SHA pinning)
  4. Developer Experience (typecheck, lint fixes)

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

## Open Issues / PRs

| # | Title | Type |
|---|-------|------|
| #327 | build(dev): pin dependencies | PR (Renovate) |
| #157 | Weekly Maintenance Report | Issue |
| #153 | Daily Autohealing Report | Issue |
| #15  | Dependency Dashboard | Issue (Renovate) |

## Survey History

| Date       | SHA        | Delta                    |
| ---------- | ---------- | ------------------------ |
| 2026-04-24 | `ef02119`  | Initial survey           |
| 2026-05-06 | `420ef65`  | 28 commits, v2.5.1→v2.7.3, skills 45→46, agent v0.41.4→v0.42.7, plugin-singleton.ts added, OCX V2, content-integrity gate, skill guardrails, model field removal |
