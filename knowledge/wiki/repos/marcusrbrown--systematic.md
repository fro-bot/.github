---
type: repo
title: "marcusrbrown/systematic"
created: 2026-04-24
updated: 2026-07-15
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
  - url: https://github.com/marcusrbrown/systematic
    sha: 4d2c123f7f5568bba66433eb2a4e51c5ce42985c
    accessed: 2026-06-09
  - url: https://github.com/marcusrbrown/systematic
    sha: 11b12bfae2433577db84821b5788a99f339243c9
    accessed: 2026-06-19
  - url: https://github.com/marcusrbrown/systematic
    sha: c2c43fd828b324c31f93a1c22455caab2aa708e0
    accessed: 2026-07-01
  - url: https://github.com/marcusrbrown/systematic
    sha: 4eecc77c6482895698645748beff0f336142bc64
    accessed: 2026-07-15
tags: [opencode, plugin, ai, workflow, typescript, bun, biome, semantic-release, npm, zod, json-schema, slash-commands]
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
| Last push       | 2026-07-15                                           |
| Latest release  | v2.33.3 (2026-07-14)                                 |
| Language        | TypeScript (strict, ESM)                             |
| Runtime         | Bun                                                  |
| License         | MIT                                                  |
| Stars           | 23                                                   |
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

- **`config`** — Discovers and merges bundled skills and agents into OpenCode configuration. Existing user/project config takes precedence. As of v2.32.0, removed bundled names listed in `disabled_skills`/`disabled_agents` are warn-and-ignored rather than rejected, so cleaning up a skill upstream no longer bricks configs that had disabled it (#534).
- **`tool`** — Registers the `systematic_skill` tool for on-demand skill loading.
- **`system.transform`** — Injects the "Using Systematic" bootstrap guide into system prompts.

### Source Modules (`src/lib/`)

| Module                    | Role                                           |
| ------------------------- | ---------------------------------------------- |
| `config-handler.ts`       | Config hook — merges bundled assets             |
| `config-schema.ts`        | Zod schema for `systematic.json` user config (v2.16+); typed bundled-name validation with IDE autocomplete (#384) |
| `config.ts`               | JSONC config loading and merging; surfaces every Zod issue in top-level error message (#398); project-local Systematic overrides global Systematic output (#370); v2.32.0 warn-and-ignore for removed bundled names in disable lists, stateless per-load dedup preserving raw config for merge precedence (#534) |
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
| `commands.ts`             | Command discovery + registration of discovered skills as slash commands (v2.33.x, #592–#594); honors `skills_as_commands` toggle and `disabled_commands`; single-read of discovered skills (#593); honest command descriptions distinguishing discovered vs. bundled skills (#594) |
| `discovered-skills.ts`    | v2.33.0 (#592) — walks the same six roots OpenCode uses to find skills (global `~/.claude`/`~/.agents`, project `.claude`/`.agents` walked to worktree root, `.opencode` config dirs) with upstream last-write-wins precedence (`.opencode` > `.claude`/`.agents` > global); emits `/slash` commands for discovered skills; model-invocable skills get a shim loading the skill via the native skill tool with `$ARGUMENTS` passthrough, command-only skills inline the `SKILL.md` body |
| `converter.ts`            | CEP-to-OpenCode content conversion (CLI)        |
| `frontmatter.ts`          | YAML frontmatter parsing                        |
| `validation.ts`           | Agent config validation and type guards         |
| `walk-dir.ts`             | Recursive directory walker                      |

`plugin-singleton.ts` (introduced v2.7.2) has been folded into the broader factory layer — modules now coordinate via the config-handler entry point. Per-process singleton semantics are preserved.

### Bundled Assets

- **Bundled skills** in `skills/` (48 skill directories present at SHA `11b12bf`, 2026-06-19; prior surveys counted 49 — the discrepancy is methodology drift, not removal: the live directory scan counts on-disk skill folders while earlier counts folded in the project-scoped `release-notes-narrative` skill that ships outside the bundled `skills/` tree) — Core CE workflows (`ce:brainstorm`, `ce:plan`, `ce:review`, `ce:work`, `ce:compound`, `ce:compound-refresh`, `ce:ideate`), development tools (`agent-browser`, `frontend-design`, `git-worktree`, `git-commit`, `git-commit-push-pr`, `git-clean-gone-branches`), specialized skills (`dhh-rails-style`, `dspy-ruby`, `gemini-imagegen`, `proof`, `rclone`, `andrew-kane-gem-writer`), engineering practice (`test-driven-development`, `writing-skills`, `writing-systematic-skills`), autonomous workflows (`lfg`, `slfg`), release automation (`release-notes-narrative`), new in v2.28.0: `orchestrating-subagents` (#491), new in v2.30.0: `npx skills` portable install path added to docs; new in v2.31.0: `ce:compound-refresh` gains `argument-hint` frontmatter (#505). Deprecation surface marks `orchestrating-swarms` and `claude-permissions-optimizer` (#401).
- **51 agents** in `agents/` across 6 categories: `design/` (3), `docs/` (1), `document-review/` (7), `research/` (7), `review/` (28), `workflow/` (5). All 51 agents now declare explicit `temperature:` in frontmatter (v2.29.0, #495) and explicit `mode: subagent` (v2.27.0, #488). Content-integrity gates enforce both invariants in CI.
- **OCX registry** in `registry/` — Component-level installation via `ocx` CLI with named profiles (`omo`, `standalone`); v2.20.6 of the registry was the last published before the v2.21+ launch-surface refresh

### Configuration Schema

Starting in the v2.14–v2.17 arc, `systematic.json` user config is fully Zod-typed:

- `config-schema.ts` defines the canonical schema; `scripts/generate-config-schema.ts` emits a JSON Schema published at `fro.bot/systematic/schemas/v2/` (consumed by IDEs for autocomplete)
- `schema:drift` script gates the generated schema in CI
- Schema construction uses a factory pattern (#393) for composability
- Unrecognized keys and invalid values produce per-issue diagnostics surfaced in the top-level error message (#390, #398)
- Bundled skill/agent names are validated against `bundled-names.ts` for typo detection
- v2.32.0 adds a removed-names list: the JSON Schema generator folds removed names into the `disabled_skills`/`disabled_agents` enums (ships empty today, future-proofed); a content-integrity gate enforces that removed names never overlap current bundled names, preventing misclassification as a name moves active→removed (#534)
- **New top-level config property `skills_as_commands`** — first surfaced 2026-07-08 as a downstream signal via the [[fro-bot--systematic]] hosted schema (property set 7 → 8). **Confirmed source-side 2026-07-15** (SHA `4eecc77`, `config-schema.ts`): `skills_as_commands` is a `z.boolean().default(true)` toggle that registers skills discovered from user/project skill directories (OpenCode config and other agent-harness-standard locations) as slash commands. Landed in the v2.33.x arc via #592 (`feat: register discovered skills as slash commands`), refined by #593 (`disabled_commands` suppression + single-read for discovered skills) and #594 (honest command descriptions distinguishing discovered vs. bundled skills). A companion `disabled_commands: z.array(z.string()).default([])` property (array of command names to disable globally) is also present. Net top-level config properties are now eight; the earlier "source-side details unconfirmed" caveat is resolved. See [[fro-bot--systematic]] for the deployed schema snapshot and [[opencode-plugins]] for the command-registration pattern.

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

8 GitHub Actions workflows (consolidated from 9 — `fro-bot-autoheal.yaml` merged into `fro-bot.yaml` in #446; unchanged count as of 2026-06-09):

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

As of v2.33.0 (#584), the `main`, `fro-bot`, and CodeQL workflows include the long-lived `v3` branch in their `pull_request.branches` filter, so `v3`-targeting PRs get the full check suite and Fro Bot review. Push triggers stay scoped to `main`, so the release job never runs against `v3` — in-progress v3 work cannot accidentally publish.

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

- `fro-bot.yaml` — `fro-bot/agent@v0.90.0` (SHA `42db56dc027a5c9aee99c0ada97a406554108894`; was v0.79.4 at last survey — ~11 minor bumps via Renovate over the 2026-07-01 → 2026-07-15 interval, all `mrbro-bot[bot]`-authored churn). Three operating modes selected by an inline `PROMPT` ternary keyed on `event_name × mode × cron`:
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

## Notable Dependencies (as of v2.33.3 / SHA `4eecc77`)

| Package | Version | Role |
|---------|---------|------|
| `@opencode-ai/plugin` | 1.17.18 | Plugin API host (peer `^1.1.30`) |
| `@opencode-ai/sdk` | 1.17.18 | SDK tooling |
| `zod` | 4.4.3 | Config schema validation |
| `js-yaml` | ^4.1.1 | Runtime YAML parsing (direct `dependency`, externalized in `bun build`) |
| `jsonc-parser` | ^3.3.0 | JSONC config parsing (runtime dependency) |
| `ajv` / `ajv-formats` | 8.20.0 / 3.0.1 | JSON Schema validation (schema tooling, dev) |
| `@biomejs/biome` | 2.5.3 | Lint + format |
| `typescript` | 6.0.3 | Type checking |
| `bun` (`@types/bun`) | latest | Runtime |
| `@types/node` | 24.13.3 | Node compatibility types |
| `markdownlint-cli` | 0.48.0 | Markdown lint (dev) |
| `semantic-release` | 25.0.6 | Release automation |

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
| v2.25.0 | 2026-06-05 | Hompage redesign (custom hero, live stats banner, feature grid, Open Graph/JSON-LD SEO); `ce:review` Stage 5b independent finding-validation pass (#485); content-integrity check for solution-doc YAML frontmatter unquoted comments; Umami analytics wired end-to-end in CI; reproducible eval harness with transcripts and rubrics (#455); `fro-bot/agent` bumped through v0.46.0–v0.52.1 |
| v2.26.0 | 2026-06-05 | `ce:brainstorm` Phase 2.5 Synthesis Summary scope checkpoint; `ce:plan` Anti-Expansion step 3.7 + solo/brainstorm-sourced dual paths + markdown rendering layer; upstream CEP improvements merged (#486) |
| v2.27.0 | 2026-06-05 | `mode: subagent` explicit on all 51 bundled agents; `checkAgentMode` content-integrity gate; converter-equivalence test for zero-behavior-change proof; CodeQL `js/incomplete-multi-character-sanitization` alert fixed in `transform-content.ts` (#31) |
| v2.28.0 | 2026-06-05 | New `orchestrating-subagents` skill (#491): full coordination lifecycle for serial/parallel subagent work in OpenCode via `task()` dispatch |
| v2.29.0 | 2026-06-07 | Explicit `temperature:` on all 51 bundled agents; `checkAgentTemperature` content-integrity gate; `fro-bot/agent` v0.55.1–v0.55.3 (#492–494) |
| v2.30.0–v2.30.1 | 2026-06-07 | `npx skills add marcusrbrown/systematic` as portable harness-agnostic install path; every non-deprecated skill reference page gets a copyable `npx skills add` command; MDX footguns documented (JSX `<name>` placeholder trap, copy-button on fenced blocks only); docs generator covered by 9 unit tests |
| v2.31.0 | 2026-06-07 | `ce:compound-refresh` gains `argument-hint` frontmatter (#505); `argument-hint` enforcement column in `writing-systematic-skills`; guard fails any skill referencing `$ARGUMENTS` outside fenced code blocks without `argument-hint`; release dispatch confirmation timeout now `::warning::` + exit 0 (#504); `fro-bot/agent` v0.55.6 (3 security hardening fixes: IPv6 egress bypass, DNS resolution timeout, compose topology guard) |
| v2.32.0 | 2026-06-15 | Removed-names lifecycle for `disabled_skills`/`disabled_agents` (#534): schema-enum acceptance + validation acceptance + load-time silent drop with per-load `[systematic]` warning; content-integrity gate enforces removed-names ∩ bundled-names = ∅; `biome.json` `$schema` synced to 2.4.16 (#533, fixes CLI deserialize/lint failure); OpenCode dep arc v1.16.2→v1.17.7; `orchestrating-subagents` corrected for OpenCode 1.17.6 + now recommends background subagents (#530); `fro-bot/agent` v0.59.1→v0.71.0; semantic-release v25.0.5 |
| v2.32.1 | 2026-06-26 | Pure maintenance release — no source/skill/agent changes. Pre-fixes two Biome 2.5.0 error-level rules ahead of the `@biomejs/biome` bump (#538): `noSvgWithoutTitle` on `docs/public/favicon.svg` (added `<title>` + `role="img"`/`aria-labelledby`) and `noImportantStyles` on `docs/src/styles/custom.css` (replaced three `!important` decls with higher-specificity `.install-header .install-title` selector, no visual change). Also folds OpenCode v1.17.4→v1.17.9 (#536, #541, #542, #544, #552, #557), `fro-bot/agent` v0.64.2→v0.78.0 (14 Renovate bumps #535–#561), Playwright v1.61.0 (#547) |
| v2.32.2 | 2026-07-04 | Maintenance patch: security bump of Pillow minimum version to patch known CVEs (#576); OpenCode v1.17.9→v1.17.13; `fro-bot/agent` v0.79.0→v0.81.0; `bfra-me/.github` v4.16.32→v4.16.33 |
| v2.33.0 | 2026-07-07 | **Feature: discovered skills as slash commands** (#592, `src/lib/discovered-skills.ts`). Skills discovered from user/project locations can now surface as `/slash` commands, not only model-invocable tools. New discovery pass walks the same six roots OpenCode uses with its own last-write-wins precedence. Gated behind new `skills_as_commands` config toggle (default true). Model-invocable skills get a shim loading via native skill tool with `$ARGUMENTS` passthrough; command-only skills inline the `SKILL.md` body. Each generated command carries a `(Systematic - Skill)` marker for idempotent re-runs. Also: `v3` long-lived branch added to `pull_request.branches` filter across main/fro-bot/CodeQL workflows (push stays main-scoped so release never runs on `v3`, #584); complexity refactor split `validateFieldExamples` (CC 41) and `extractFrontmatter` (CC 25) into helpers, repo complexity warnings 6→4 (#582); plan-status housekeeping (#583, #591) |
| v2.33.1 | 2026-07-07 | Follow-up to #592: `disabled_commands` now actually suppresses discovered-skill commands (filters emission by the free-form `disabled_commands` field, leaving the stricter `disabled_skills` bundled-name enum untouched); closes a CodeQL `js/file-system-race` TOCTOU (dropped `statSync` pre-check, read file directly relying on existing `EISDIR`/`ENOENT` catch); single-read fix — `extractFrontmatterFromContent` split out so command-only discovered skills read `SKILL.md` once instead of twice (#593) |
| v2.33.2 | 2026-07-07 | Labelling honesty for skills-as-commands (#594): discovered skills lose the `(Systematic - Skill)` prefix entirely (it falsely implied Systematic authorship) and surface the skill's own description as-is; bundled skills-as-commands drop the `- Skill` qualifier to read simply `(Systematic)`, matching bundled plain commands. `isSystematicCommandConfig` recognizes only `(Systematic)` going forward — no migration needed since OpenCode applies config-hook mutations in memory per load and never persists them |
| v2.33.3 | 2026-07-14 | Maintenance patch: security bump of Pillow minimum version to patch known CVEs (#620, closes #28); OpenCode v1.17.14→v1.17.18; `semantic-release` v25.0.6 (#619); `fro-bot/agent` v0.84.0→v0.88.0; `bfra-me/.github` v4.16.35→v4.16.36; CodeQL action v4.37.0 |

## Open Issues / PRs

| # | Title | Type |
|---|-------|------|
| #157 | Weekly Maintenance Report | Issue (rolling) |
| #153 | Daily Autohealing Report | Issue (rolling) |
| #15  | Dependency Dashboard | Issue (Renovate) |

0 open PRs at survey time — main is fully drained. Open-issue set unchanged across the last several surveys (the three rolling automation issues only). (Latest HEAD: `4eecc77` — `chore(deps): update fro-bot/agent to v0.90.0` (#625), 2026-07-15. Recent merges co-authored by `mrbro-bot[bot]`; the two substantive human-authored PRs this interval — #582 complexity refactor and #592–#594 skills-as-commands — are by `marcusrbrown`, security bumps #576/#620 by `fro-bot`.)

## Survey History

| Date       | SHA        | Delta                    |
| ---------- | ---------- | ------------------------ |
| 2026-04-24 | `ef02119`  | Initial survey           |
| 2026-05-06 | `420ef65`  | 28 commits, v2.5.1→v2.7.3, skills 45→46, agent v0.41.4→v0.42.7, `plugin-singleton.ts` added, OCX V2, content-integrity gate, skill guardrails, model field removal |
| 2026-05-28 | `9b75707`  | ~80 commits, v2.7.3→v2.24.0, skills 46→47, agents 50→51, agent v0.42.7→v0.45.0, `fro-bot.yaml` + `fro-bot-autoheal.yaml` consolidated (#446), `plugin-singleton.ts` removed, Zod config schema arc (v2.14–v2.17), `release-notes-narrative` skill + semantic-release-driven dispatch, launch-surface cleanup, docs modernization, deprecation surface, overlay hardening, project-local override fix |
| 2026-06-09 | `4d2c123`  | ~86 commits since last survey, v2.24.0→v2.31.0, skills 47→49 (+`orchestrating-subagents` v2.28.0), agent v0.45.0→v0.59.0; explicit `mode: subagent` on all 51 agents (#488); explicit `temperature:` on all 51 agents (#495); content-integrity gates for both; `ce:brainstorm` Phase 2.5 + `ce:plan` Anti-Expansion; `ce:review` Stage 5b validation; homepage redesign with live stats; `npx skills` portable install path (v2.30.0); `argument-hint` enforcement (v2.31.0); release dispatch timeout now non-fatal; OpenCode dep at v1.16.2 |
| 2026-06-19 | `11b12bf`  | 32 commits since last survey (mostly Renovate churn), v2.31.0→v2.32.0, agent v0.59.0→v0.71.0 (12 minor bumps), OpenCode v1.16.2→v1.17.7, semantic-release v25.0.3→v25.0.5. Feature: removed-names lifecycle for disable lists + content-integrity gate (#534, v2.32.0). Fix: `orchestrating-subagents` corrected for OpenCode 1.17.6, recommends background subagents (#530); `biome.json` `$schema` synced to 2.4.16 (#533). 8 workflows + 51 agents unchanged; bundled skill dir count 48 (methodology note added — no removals). New runtime deps surfaced in manifest: `js-yaml`, `jsonc-parser` |
| 2026-07-01 | `c2c43fd`  | **Pure-maintenance interval** — 23 commits since last survey, all Renovate/dep churn (22 `mrbro-bot[bot]`-authored bumps + 1 lint sync). v2.32.0→v2.32.1 (2026-06-26, no source/skill/agent changes; Biome 2.5.0 pre-fix for `noSvgWithoutTitle` + `noImportantStyles` in docs). agent v0.71.0→**v0.79.4** (8 minors), OpenCode v1.17.7→v1.17.11, Biome 2.4.16→**2.5.1** (`biome.json` `$schema` synced, #571), `bfra-me/.github` reusable workflows→v4.16.32 (#567), Playwright→v1.61.1. Structure unchanged: 8 workflows, 51 agents (3/1/7/7/28/5), 48 bundled skill dirs, MIT, `node >=18` compat floor holds. Confirmed pre-existing top-level `.slim/` (`clonedeps.json`) and `.opencode/` (`themes/`, `tui.json`, `package-lock.json`) dev-config dirs — present at prior SHA, not new. Stars 22→23, open issues unchanged (3 rolling) |
| 2026-07-15 | `4eecc77`  | **First feature interval since v2.31.0** — 42 commits since last survey. v2.32.1→**v2.33.3**. Headline: **discovered skills as slash commands** (#592, v2.33.0) — new `src/lib/discovered-skills.ts` walks the six OpenCode skill roots with upstream last-write-wins precedence and registers discovered skills as `/slash` commands, gated by new `skills_as_commands` config toggle (default true); refined by #593 (`disabled_commands` suppression + single-read + CodeQL TOCTOU fix) and #594 (labelling honesty — drop `(Systematic - Skill)` prefix). **This confirms the source semantics of the `skills_as_commands` property first surfaced downstream at the 2026-07-08 [[fro-bot--systematic]] schema survey** — caveat resolved. New config property `disabled_commands` also present. `v3` long-lived branch added to CI `pull_request.branches` filter (#584; push stays main-scoped, release never runs on `v3`). Complexity refactor (#582, warnings 6→4). Two security patches bumping Pillow minimum (#576 v2.32.2, #620 v2.33.3). agent v0.79.4→**v0.90.0** (~11 minors), OpenCode v1.17.11→v1.17.18, Biome 2.5.1→2.5.3, semantic-release v25.0.5→v25.0.6, `bfra-me/.github`→v4.16.36. Structure otherwise unchanged: 8 workflows, 51 agents (3/1/7/7/28/5), 48 bundled skill dirs, MIT, `node >=18` floor. Stars steady at 23, open issues unchanged (3 rolling), 0 open PRs |
