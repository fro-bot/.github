---
type: repo
title: "marcusrbrown/gpt"
created: 2026-04-18
updated: 2026-06-30
sources:
  - url: https://github.com/marcusrbrown/gpt
    sha: 174e5179026331ef6cc72549c2519af5acae3dc0
    accessed: 2026-06-30
  - url: https://github.com/marcusrbrown/gpt
    sha: 182e23d701acef6615ae3194343c2bda2e0cfa5b
    accessed: 2026-06-19
  - url: https://github.com/marcusrbrown/gpt
    sha: 36b50c9254c1795edd75331a4b0dad07961a49e1
    accessed: 2026-06-08
  - url: https://github.com/marcusrbrown/gpt
    sha: aac010356a3e0d7fd21a5883b98d0cdf6229ed60
    accessed: 2026-05-27
  - url: https://github.com/marcusrbrown/gpt
    sha: 0bb8eedf6e23bfb5715d127763fd864ab7da72cd
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/gpt
    sha: 60bd62e86caa1a07610c2162d9ffbb917d172dc3
    accessed: 2026-04-18
tags: [gpt, react, typescript, vite, langchain, mcp, local-first, heroui, tailwindcss, indexeddb, web-crypto]
aliases: [gpt]
related:
  - "[[marcusrbrown--mrbro-dev]]"
  - "[[marcusrbrown--copiloting]]"
---

# marcusrbrown/gpt

Local-first, privacy-focused GPT creation and management platform. Mirrors core OpenAI GPT Builder functionality while keeping all data client-side. Deployed to GitHub Pages at [gpt.mrbro.dev](https://gpt.mrbro.dev).

## Overview

- **Purpose:** Create, customize, and interact with AI assistants locally
- **Default branch:** `main`
- **Created:** 2023-12-01
- **Last push:** 2026-06-30
- **Homepage:** https://gpt.mrbro.dev (GitHub Pages)
- **License:** MIT
- **Topics:** `gpt`, `transformers`, `nlp`, `chatgpt`, `gpt-4`
- **Node.js:** 24.18.0 (`.tool-versions`) — bumped from 24.17.0
- **Package manager:** pnpm 10.34.4 — bumped from 10.34.3

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Framework | React 19.2.5, TypeScript 5.9.3 | Strict mode, `@/` import alias |
| Build | Vite 8.1.0, `@vitejs/plugin-react-swc` 4.3.1 | `tsgo` (`@typescript/native-preview` 7.0.0-dev.20260626.1) for type-checking |
| Styling | TailwindCSS 4.3.1, HeroUI 2.8.10 | Semantic design tokens only, no hardcoded colors |
| Storage | IndexedDB via Dexie 4.4.4 | Local-first; no localStorage for structured data |
| Security | Web Crypto API (AES-GCM, PBKDF2) | Client-side encryption for API keys |
| AI | LangChain 1.5.2, `@langchain/core` 1.2.1, `@langchain/openai` 1.5.3, `@langchain/anthropic` 1.5.1, `@langchain/langgraph` 1.4.7 | Provider-abstracted via `BaseLLMProvider` |
| MCP | `@modelcontextprotocol/sdk` 1.29.0 | Tool integration via Model Context Protocol |
| Editor | Monaco Editor (`@monaco-editor/react` 4.7.0) | In-app code/prompt editing |
| Routing | React Router DOM 7.18.0 | Route-level lazy loading |
| Validation | Zod 4.4.3 | Zod-first: define schema, infer type |
| Testing | Vitest 4.1.9, `@vitest/eslint-plugin` 1.6.20, Playwright 1.61.1, axe-core | Unit, E2E, accessibility, visual, performance |
| Linting | ESLint 10.6.0, `@bfra.me/eslint-config` 0.50.1, Prettier 3.8.5 | `@bfra.me/prettier-config/120-proof` (120-char lines); `@bfra.me/tsconfig` 0.13.1 |

## Architecture

The project follows a modular, provider-abstracted architecture with four layers:

1. **Data Layer:** IndexedDB (Dexie.js) for structured data, Web Crypto for security, LRU cache for performance
2. **Service Layer:** Decoupled services for storage, encryption, provider management, MCP, conversations, export/import
3. **Provider Layer:** Pluggable LLM backends via `BaseLLMProvider` — OpenAI, Anthropic, Azure, Ollama
4. **UI Layer:** Component-driven with HeroUI and TailwindCSS 4 semantic tokens

### Key Directories

| Directory | Purpose |
| --- | --- |
| `src/components/` | React components (HeroUI-based, chat UI, forms, settings, MCP, editor tabs) |
| `src/services/` | Business logic — storage, encryption, providers, MCP client, export/import, versioning |
| `src/services/providers/` | LLM provider implementations (OpenAI, Anthropic, Azure, Ollama, registry) |
| `src/lib/` | Utilities — `design-system.ts`, `crypto.ts`, `database.ts` |
| `src/pages/` | Route-level components — home, GPT editor, showcase, settings, backup/restore, test, OAuth callback |
| `src/hooks/` | Custom React hooks (state access) |
| `src/types/` | Zod schemas and inferred TypeScript types |
| `src/contexts/` | React Context providers |
| `src/config/` | App configuration (site metadata) |
| `tests/` | E2E, accessibility, visual regression, performance tests |
| `notebooks/` | Deno Jupyter notebooks for agent development |
| `docs/` | Project docs — overview, PRD, features, design system, rules, agent development |
| `RFCs/` | 13 architectural decision records (RFC-001 through RFC-013) |
| `.ai/` | AI-specific configuration |

### LLM Providers

Four provider implementations in `src/services/providers/`:

- `openai-provider.ts` — OpenAI API (GPT-4, etc.)
- `anthropic-provider.ts` — Anthropic API (Claude)
- `azure-provider.ts` — Azure OpenAI Service
- `ollama-provider.ts` — Local Ollama models
- `base-provider.ts` — Abstract base class (`BaseLLMProvider`)
- `provider-registry.ts` — Provider registration and discovery

UI code never imports LLM SDKs directly; all access goes through the provider abstraction.

### RFCs

13 RFCs tracking architectural decisions:

| RFC     | Topic                          |
| ------- | ------------------------------ |
| RFC-001 | IndexedDB Storage Foundation   |
| RFC-002 | Security Infrastructure        |
| RFC-003 | Provider Abstraction Layer     |
| RFC-004 | GPT Configuration Management   |
| RFC-005 | Conversation Management        |
| RFC-006 | Knowledge Base Enhancement     |
| RFC-007 | Export/Import System           |
| RFC-008 | Anthropic Provider Integration |
| RFC-009 | MCP Tool Integration           |
| RFC-010 | Ollama Local Models            |
| RFC-011 | Advanced Tools Sandbox         |
| RFC-012 | Tauri Desktop Application      |
| RFC-013 | UI/UX Improvements             |

### Notebooks

Deno Jupyter notebooks in `notebooks/agents/`:

- `01-repo-ranger.ipynb` — Code analysis and security checking agent
- `01-gpt-architect.ipynb` — Assistant development and optimization tool
- `01-baroque-bitch.ipynb` — Art generation and style transfer assistant

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Lint + test + build + deploy |
| Fro Bot | `fro-bot.yaml` | PR, issues, comments, schedule (03:30 + 15:30 UTC), dispatch | Three-mode single-file workflow: review / maintenance / autoheal |
| Renovate | `renovate.yaml` | — | Dependency updates (via `bfra-me/.github` reusable workflow) |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, schedule, dispatch | Probot settings sync |
| Test Coverage | `test-coverage.yaml` | — | Coverage reporting |
| Test Accessibility | `test-accessibility.yaml` | — | WCAG 2.1 AA audit |
| Visual Tests | `visual-tests.yaml` | — | Screenshot regression testing |
| Test Performance | `test-performance.yaml` | — | Lighthouse audits |
| Cache Cleanup | `cache-cleanup.yaml` | — | Actions cache maintenance |
| Copilot Setup | `copilot-setup-steps.yaml` | — | GitHub Copilot coding agent bootstrap |
| E2E Tests | `test-e2e.yaml.disabled` | — | E2E tests (currently disabled) |

**Note:** The prior `fro-bot-autoheal.yaml` has been folded into `fro-bot.yaml` as an `autoheal` mode (PR review → `pull_request`, maintenance/autoheal → cron). This matches the consolidated three-mode pattern adopted across the ecosystem.

**Setup composite action (2026-06-30):** A new `.github/actions/setup-pnpm/action.yaml` composite action centralizes the pnpm + Node bootstrap (and optional Playwright browser install/caching) across all workflows. It is adapted from `bfra-me/works`'s `pnpm-install` action and pins `pnpm/action-setup@v5.0.0`, `actions/setup-node@v6.4.0`, and `actions/cache@v5.1.0`, reading the Node version from `.tool-versions`. Workflows (`fro-bot.yaml`, `main.yaml`, `renovate.yaml`, `update-repo-settings.yaml`) now call `uses: ./.github/actions/setup-pnpm` instead of inlining setup steps — a DRY consolidation, not a behavior change.

### Main CI Jobs

The main workflow runs four jobs after a `Prepare` step:

1. **Lint** — `pnpm lint` (ESLint)
2. **Run Tests** — `pnpm test:coverage` with Codecov upload
3. **Build** — `pnpm build` (tsgo + Vite production build)
4. **Deploy** — GitHub Pages deployment (main branch only)

### Branch Protection

Required status checks on `main`: Build, Deploy, E2E Test Coverage, E2E Test Report, Generate Accessibility Report, Generate Performance Report, Lint, Prepare, Renovate, Run Accessibility Tests, Run Performance Tests, Run Tests, Run Visual Tests. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Content Security Policy

Vite build injects a CSP `<meta>` tag restricting:

- `connect-src` to `self`, `api.openai.com`, `api.anthropic.com`, `localhost:11434` (Ollama)
- `script-src` to `self`
- `object-src` and `form-action` locked down

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.3` — crossed the v4 → v5 boundary on 2026-05-13 (PR #2435). Groups LangChain.js monorepo packages. Automerges unstable minor updates of `lucide-react` (monthly) and select LangChain/TailwindCSS packages via `bfra-me/renovate-config:automerge.json5#5.2.3`. Post-upgrade runs bootstrap, fix, and build. `pnpm.overrides` pins `fast-uri>=3.1.2`, `langsmith>=0.6.0`, `path-to-regexp>=8.4.0`.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` for repository configuration sync.
- **Git Hooks:** `simple-git-hooks` with `lint-staged` running ESLint with auto-fix on staged files.
- **AGENTS.md hierarchy:** Root AGENTS.md plus directory-level guides in `src/`, `tests/`, `scripts/`, `notebooks/`, `docs/`, `.github/`, `RFCs/`, `.ai/`. Comprehensive conventions for AI-assisted development.
- **Copilot:** `copilot-instructions.md` and `copilot-setup-steps.yaml` for GitHub Copilot coding agent.
- **Codecov:** Coverage tracking via `codecov.yml`.
- **Configs:** Extends `@bfra.me/tsconfig`, `@bfra.me/eslint-config`, `@bfra.me/prettier-config` shared configurations.

## Fro Bot Integration

**Full Fro Bot integration detected.** Single consolidated workflow — `fro-bot.yaml` — handling three modes via a `workflow_dispatch` `mode` input plus dual cron schedules (03:30 UTC autoheal, 15:30 UTC maintenance):

- **review** — PR reviews (structured verdict format: PASS/CONDITIONAL/REJECT) and issue/discussion triage (triggered by `@fro-bot` mention from OWNER/MEMBER/COLLABORATOR); manual dispatch requires a custom `prompt` input (validated, fails fast if absent)
- **maintenance** (15:30 UTC cron) — daily maintenance → rolling "Daily Maintenance Report" issue. Includes an **Upstream Modernization Watch** (Sundays UTC only) that surveys OpenCode/Fro Bot runtime docs but MUST NOT bump pinned agent SHAs
- **autoheal** (03:30 UTC cron) — fixes failing CI on open PRs, remediates critical/high security advisories, runs code-quality audits (build, coverage, accessibility, convention drift, AGENTS.md accuracy), lands lint/format fixes via PR, and verifies quality gates → "Daily Autohealing Report" issue

Pins `fro-bot/agent@v0.79.4` (SHA `b3384d37fb3c66e4249c0fb35037c6d244f34314`) as of 2026-06-30 — bumped from v0.70.0; `actions/checkout` pinned at v6.0.3 (`df4cb1c`). Secrets/vars: `OPENCODE_AUTH_JSON`, `FRO_BOT_PAT`, `FRO_BOT_MODEL`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`.

**Note (2026-05-27 → confirmed 2026-06-19):** The two-workflow split observed in surveys before 2026-05-27 has consolidated. The standalone `fro-bot-autoheal.yaml` is no longer present in the workflow directory; `fro-bot.yaml` is the sole agent workflow. This aligns with the three-mode single-file pattern documented in [[marcusrbrown--marcusrbrown-github-io]] and other recent ecosystem updates.

## Conventions (from AGENTS.md)

- **Imports:** `@/` alias for `src/` paths
- **Types:** Zod schema first → `z.infer<typeof Schema>`
- **Handlers:** `handle` prefix (`handleSubmit`, `handleClick`)
- **Errors:** `catch (error_)` naming, re-throw for error boundaries
- **Async UI:** `.catch(console.error)` in `onPress`/`onClick`, never `void`
- **State:** Access via hooks only, never localStorage directly
- **Colors:** Semantic tokens only (`surface-primary`, `content-primary`)
- **Forbidden:** `as any`, `@ts-ignore`, `@ts-expect-error`, localStorage for data, hardcoded colors, `void asyncFn()`, nested buttons in Card, array index as key

## Notable Patterns

- **Local-first architecture:** All data stays in the browser via IndexedDB. API keys encrypted with AES-GCM/PBKDF2. No server-side storage.
- **Provider abstraction:** UI is fully decoupled from LLM SDKs. Adding a new provider means extending `BaseLLMProvider` and registering it.
- **RFC-driven design:** 13 RFCs document major architectural decisions, from storage foundations to desktop app (Tauri) aspirations.
- **Aggressive quality gates:** 5 distinct test dimensions (unit, E2E, accessibility, visual, performance) with CI enforcement.
- **Consolidated Fro Bot workflow:** A single `fro-bot.yaml` carries review/triage, maintenance, and autoheal as discrete `mode`-gated paths with detailed structured prompts.
- **Manual chunk splitting:** Vite config defines explicit `manualChunks` for React, Router, HeroUI, AI libs, Monaco, and utilities.
- **Cross-tab sync:** `cross-tab-sync.ts` service for multi-tab data consistency via IndexedDB.

## Open Work Items

- **PR #2165** — HeroUI v2 → v3 migration (authored by `fro-bot`, long-running — still open as of 2026-06-30; HeroUI/`@heroui/react` still pinned at 2.8.10)
- **PR #2620** — pnpm v10 → v11 `[SECURITY]` bump (authored by `mrbro-bot`, open). Mirrors the `mrbro-bot`-drives-bumps split seen across the ecosystem; root still on pnpm 10.34.4.
- **Accessibility autoheal cluster (Ollama contrast):** PRs #2628, #2612, #2557 (all `fro-bot`) plus prior #2612-lineage all target Ollama settings/status-chip contrast. Three open PRs on the same theme suggests the contrast fix hasn't landed cleanly — a recurring autoheal target, not a one-shot.
- **Security override PRs:** #2587 (undici pin), #2586 (hono pin) — `fro-bot` autoheal remediations awaiting merge.
- **23 open issues** (as of 2026-06-30, up from 22)

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `60bd62e` | Initial survey |
| 2026-04-24 | `0bb8eed` | Dependency-only delta: `fro-bot/agent` v0.40.2→v0.41.4, `vite` 8.0.8→8.0.9, `@langchain/langgraph` 1.2.8→1.2.9, `eslint` 10.2.0→10.2.1, `uuid` v14 security patch, `@typescript/native-preview` 7.0.0-dev.20260419.1, `actions/setup-node` v6.4.0, `bfra-me/.github` v4.16.8. No structural or application code changes. |
| 2026-05-27 | `aac0103` | Five-week delta. **Renovate preset crossed v4 → v5.2.0 boundary (#2435, 2026-05-13).** `fro-bot/agent` advanced through 8 versions: v0.41.4 → v0.42.5/.6/.7/.8/.9/.10 → v0.43.0/.1/.3 → v0.44.3 → v0.45.0. Workflow consolidation: `fro-bot-autoheal.yaml` folded into `fro-bot.yaml` as `autoheal` mode (three-mode single-file pattern). Vite 8.0.9 → 8.0.14; LangChain monorepo bumps (`langchain` → 1.4.2, `@langchain/core` → 1.1.48, `@langchain/openai` → 1.4.7, `@langchain/anthropic` → 1.4.0, `@langchain/langgraph` → 1.3.2); TailwindCSS 4.2.2 → 4.3.0; React Router 7.14.1 → 7.15.1; Zod 4.3.6 → 4.4.3; Vitest 4.1.4 → 4.1.7; `@vitest/eslint-plugin` 1.6.18 newly added; ESLint 10.2.1 → 10.4.0; `@bfra.me/prettier-config` → 0.16.9; `@bfra.me/tsconfig` → 0.13.1; Node 24.15.0 → 24.16.0; pnpm 10.33.0 → 10.33.4; `@typescript/native-preview` advanced to 7.0.0-dev.20260523.1; `bfra-me/.github` updated through v4.16.12 → v4.16.19. No structural or application-code changes — exclusively dependency hygiene and workflow consolidation. |
| 2026-06-08 | `36b50c9` | Eleven-day delta. `fro-bot/agent` v0.45.0 → v0.57.0 (SHA `4470582693390235d4ab6fce1049373225025590`). New `opencode-config` secret input added to agent step. `actions/checkout` pinned at v6.0.3 (`df4cb1c`). Dependency bumps: `langchain` 1.4.2 → 1.4.4, `@langchain/langgraph` 1.3.2 → 1.3.5, `vite` 8.0.14 → 8.0.16, `react-router-dom` 7.15.1 → 7.17.0, `openai` → 6.42.0, `dexie` 4.4.2 → 4.4.3, `vitest` 4.1.7 → 4.1.8, `@vitest/eslint-plugin` 1.6.18 → 1.6.19, `@vitest/coverage-v8` 4.1.7 → 4.1.8, `eslint` 10.4.0 → 10.4.1, `@types/node` → 24.12.4, `lucide-react` → 0.577.0, `lint-staged` → 16.4.0, `pnpm` 10.33.4 → 10.34.1, `@typescript/native-preview` → 7.0.0-dev.20260604.1. Accessibility fix: removed nested sidebar landmark (PR #2525). AGENTS.md updated for Vite 8 alignment. No structural or application-code changes. |
| 2026-06-19 | `182e23d` | Eleven-day, 50-commit delta — exclusively dependency/workflow hygiene (changed files: `.github/renovate.json5`, `.github/workflows/{fro-bot,main,renovate,update-repo-settings}.yaml`, `.tool-versions`, `package.json`, `pnpm-lock.yaml`). `fro-bot/agent` v0.57.0 → v0.70.0 (SHA `60e600f39316758524f4fefe4c8a44f5bb25b089`). Renovate preset `marcusrbrown/renovate-config` 5.2.0 → 5.2.3; `bfra-me/renovate-config:automerge.json5` 5.2.1 → 5.2.3. Node 24.16.0 → 24.17.0; pnpm 10.34.1 → 10.34.3. Dependency bumps: `@langchain/core` 1.1.48 → 1.1.49, `@langchain/anthropic` 1.4.0 → 1.4.1, `@langchain/langgraph` 1.3.5 → 1.4.2, `langchain` 1.4.4 → 1.4.5, `tailwindcss`/`@tailwindcss/vite` → 4.3.1, `@playwright/test` → 1.61.0, `vitest`/`@vitest/coverage-v8` → 4.1.9, `@vitest/eslint-plugin` → 1.6.20, `eslint` → 10.5.0, `prettier` → 3.8.4, `@types/node` → 24.13.2, `@types/react` → 19.2.14, `@typescript/native-preview` → 7.0.0-dev.20260615.1. No structural or application-code changes. Open issues 25 → 22. |
| 2026-06-30 | `174e517` | Eleven-day, 41-commit delta — dependency/workflow hygiene plus one CI structural change. Changed files: `.github/actions/setup-pnpm/action.yaml` (**new**), `.github/workflows/{fro-bot,main,renovate,update-repo-settings}.yaml`, `.tool-versions`, `package.json`, `pnpm-lock.yaml`. **New `setup-pnpm` composite action** centralizes pnpm/Node/Playwright bootstrap across all four workflows (adapted from `bfra-me/works` `pnpm-install`; pins `pnpm/action-setup@v5.0.0`, `actions/setup-node@v6.4.0`, `actions/cache@v5.1.0`) — DRY consolidation, no behavior change. `fro-bot/agent` v0.70.0 → v0.79.4 (SHA `b3384d37fb3c66e4249c0fb35037c6d244f34314`). Renovate preset unchanged (`marcusrbrown/renovate-config#5.2.3`, `bfra-me/renovate-config:automerge.json5#5.2.3`). Node 24.17.0 → 24.18.0; pnpm 10.34.3 → 10.34.4. Dependency bumps: `langchain` 1.4.5 → 1.5.2, `@langchain/core` 1.1.49 → 1.2.1, `@langchain/openai` 1.4.7 → 1.5.3, `@langchain/anthropic` 1.4.1 → 1.5.1, `@langchain/langgraph` 1.4.2 → 1.4.7, `vite` 8.0.16 → 8.1.0, `react-router-dom` 7.17.0 → 7.18.0, `dexie` 4.4.3 → 4.4.4, `openai` → 6.45.0, `@playwright/test` 1.61.0 → 1.61.1, `eslint` 10.5.0 → 10.6.0, `prettier` 3.8.4 → 3.8.5, `@typescript/native-preview` → 7.0.0-dev.20260626.1. HeroUI (`@heroui/react` 2.8.10), Monaco (4.7.0), Zod (4.4.3), `@modelcontextprotocol/sdk` (1.29.0) unchanged. No application-code changes. Open issues 22 → 23; PR #2165 (HeroUI v3) still open; new autoheal PRs — Ollama a11y contrast (#2628/#2612/#2557) and security pins undici #2587 / hono #2586. |
