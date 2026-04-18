---
type: repo
title: "marcusrbrown/gpt"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/gpt
    sha: 60bd62e86caa1a07610c2162d9ffbb917d172dc3
    accessed: 2026-04-18
tags: [react, typescript, vite, local-first, llm, gpt, heroui, indexeddb, langchain, mcp, web-crypto]
aliases: [gpt]
related:
  - marcusrbrown--ha-config
  - fro-bot-agent
---

# marcusrbrown/gpt

Local-first, privacy-focused GPT creation and management platform. Mirrors core OpenAI GPT builder functionality with complete data sovereignty — all configs, conversation histories, and API keys remain client-side, protected by Web Crypto AES-GCM encryption.

## Overview

- **Purpose:** Create, customize, and interact with AI assistants locally
- **Default branch:** `main`
- **Created:** 2023-12-01
- **Last push:** 2026-04-18
- **Homepage:** https://gpt.mrbro.dev
- **License:** MIT
- **Primary language:** TypeScript (1.4 MB)
- **Other languages:** JavaScript, CSS, HTML, Jupyter Notebook
- **Topics:** `gpt`, `transformers`, `nlp`, `chatgpt`, `gpt-4`

## Architecture

Four-layer modular design with provider abstraction:

| Layer    | Technology                       | Purpose                                              |
| -------- | -------------------------------- | ---------------------------------------------------- |
| Data     | IndexedDB (Dexie.js), Web Crypto | Structured storage, AES-GCM encryption for API keys  |
| Service  | Decoupled services               | Storage, encryption, provider management, MCP client |
| Provider | `BaseLLMProvider` abstraction    | Pluggable LLM backends                               |
| UI       | React 19, HeroUI, TailwindCSS 4  | Component-driven responsive interface                |

### Provider Layer

Pluggable LLM backends via `BaseLLMProvider` abstraction in `src/services/providers/`:

- `openai-provider.ts` — OpenAI API
- `anthropic-provider.ts` — Anthropic API
- `ollama-provider.ts` — Local Ollama models
- `azure-provider.ts` — Azure OpenAI
- `provider-registry.ts` — Runtime provider registration
- `base-provider.ts` — Abstract base class

UI code never imports LLM SDKs directly; all access goes through the provider layer.

### Service Layer

Business logic in `src/services/`:

- `storage.ts` — IndexedDB persistence via Dexie
- `encryption.ts` — Web Crypto API (AES-GCM, PBKDF2) for API key protection
- `session.ts` — Session management
- `mcp-client-service.ts` — Model Context Protocol client
- `mcp-oauth-provider.ts` — MCP OAuth flow
- `knowledge-service.ts` — Knowledge base management
- `conversation-export-service.ts`, `conversation-search-service.ts` — Conversation utilities
- `cross-tab-sync.ts` — Cross-tab synchronization
- `folder-service.ts` — GPT folder organization
- `export-service.ts`, `import-service.ts` — Data portability
- `version-history.ts` — Version tracking
- `migration.ts` — Data migration

### Utility Layer

`src/lib/`:

- `database.ts` — Dexie database schema and initialization
- `crypto.ts` — Cryptographic primitives
- `design-system.ts` — Semantic design tokens and utilities

## Tech Stack

| Category          | Technology                         | Version   |
| ----------------- | ---------------------------------- | --------- |
| Framework         | React                              | 19.2.5    |
| Language          | TypeScript                         | 5.9.3     |
| Build             | Vite                               | 8.0.8     |
| Type Checker      | tsgo (native preview)              | 7.0.0-dev |
| Component Library | HeroUI                             | 2.8.10    |
| Styling           | TailwindCSS                        | 4.2.2     |
| Storage           | Dexie.js (IndexedDB)               | 4.4.2     |
| AI Framework      | LangChain                          | 1.3.3     |
| AI Providers      | OpenAI (6.34.0), Anthropic, Ollama | —         |
| MCP               | @modelcontextprotocol/sdk          | 1.29.0    |
| Code Editor       | Monaco Editor                      | 4.7.0     |
| Routing           | React Router DOM                   | 7.14.1    |
| Validation        | Zod                                | 4.3.6     |
| Package Manager   | pnpm                               | 10.33.0   |

### Notable Stack Choices

- **tsgo** (`@typescript/native-preview`): Uses the native Go-based TypeScript type checker for faster builds (invoked via `pnpm build`).
- **Zod 4**: Schema-first validation — define Zod schema, then infer TypeScript types.
- **Vite CSP plugin**: Custom Vite plugin injects Content-Security-Policy meta tag at build time with explicit `connect-src` allowlist for OpenAI, Anthropic, and Ollama endpoints.
- **Manual chunks**: Vite config splits bundles into `react`, `router`, `heroui`, `ai`, `monaco`, and `utils` chunks.

## Repository Structure

```
├── .ai/                  # AI agent configuration
├── .github/
│   ├── actions/          # Custom composite actions (setup-pnpm)
│   ├── agents/           # Agent-specific config
│   ├── workflows/        # CI/CD workflows
│   ├── settings.yml      # Probot repo settings
│   ├── renovate.json5    # Renovate config
│   └── copilot-instructions.md
├── docs/                 # Documentation (PRD, design system, features, rules)
├── notebooks/            # Deno Jupyter notebooks for agent R&D
│   ├── agents/           # Agent implementations
│   └── templates/        # Notebook templates
├── RFCs/                 # 13 accepted RFCs (RFC-001 through RFC-013)
├── scripts/              # Build/test utilities
├── src/                  # Application source
│   ├── components/       # React components (HeroUI-based)
│   ├── config/           # App configuration
│   ├── contexts/         # React Context providers
│   ├── hooks/            # Custom hooks
│   ├── lib/              # Database, crypto, design system
│   ├── pages/            # Route pages
│   ├── services/         # Business logic + provider layer
│   ├── test/             # Test setup
│   └── types/            # Zod schemas and types
├── tests/                # Integration/E2E/a11y/visual/perf tests
├── public/               # Static assets
├── AGENTS.md             # Root agent conventions
├── RFCS.md               # RFC index
├── index.html            # SPA entry
└── vite.config.ts        # Vite + Vitest config
```

### Pages (Routes)

- `home-page.tsx` — Landing/dashboard
- `gpt-editor-page.tsx` — GPT creation/editing
- `gpt-showcase-page.tsx` — GPT library/showcase
- `gpt-test-page.tsx` — GPT testing sandbox
- `settings-page.tsx` — App settings
- `backup-restore-page.tsx` — Data backup/restore
- `oauth-callback-page.tsx` — OAuth callback handler

## RFCs

The project has 13 RFCs documenting architectural decisions:

| RFC     | Title                          |
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

RFC-012 (Tauri Desktop Application) indicates a planned desktop app path beyond the current browser-based deployment.

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | PR, push to main, dispatch | Lint + test + build + deploy |
| Fro Bot | `fro-bot.yaml` | PR, issues, comments, schedule, dispatch | Agent PR review + daily maintenance |
| Fro Bot Autoheal | `fro-bot-autoheal.yaml` | Daily cron (03:30 UTC), dispatch | Automated repair + quality audit |
| Renovate | `renovate.yaml` | Schedule | Dependency updates |
| Test Coverage | `test-coverage.yaml` | — | Coverage reporting |
| Visual Tests | `visual-tests.yaml` | — | Screenshot regression |
| Test Accessibility | `test-accessibility.yaml` | — | WCAG 2.1 AA audit |
| Test Performance | `test-performance.yaml` | — | Lighthouse/Core Web Vitals |
| Cache Cleanup | `cache-cleanup.yaml` | — | GH Actions cache management |
| Copilot Setup | `copilot-setup-steps.yaml` | — | GitHub Copilot agent bootstrap |
| Update Repo Settings | `update-repo-settings.yaml` | — | Probot settings sync |

Note: `test-e2e.yaml.disabled` — E2E workflow exists but is currently disabled.

### Main Pipeline (main.yaml)

1. **Prepare** — Checkout + pnpm install (cached)
2. **Lint** — `pnpm lint` (ESLint)
3. **Test** — `pnpm test:coverage` with Codecov upload
4. **Build** — `pnpm build` (tsgo + Vite), cached
5. **Deploy** — GitHub Pages (main branch only, `gpt.mrbro.dev`)

### Branch Protection

Required checks on `main`: Build, Deploy, E2E Test Coverage, E2E Test Report, Generate Accessibility Report, Generate Performance Report, Lint, Prepare, Renovate, Run Accessibility Tests, Run Performance Tests, Run Tests, Run Visual Tests. Linear history enforced, admin enforcement enabled.

### Quality Gates

Five-gate system enforced before PR merge:

1. `pnpm lint` — 0 ESLint errors
2. `pnpm test` — All Vitest unit tests passing
3. `pnpm build` — tsgo type-check + Vite production build
4. `pnpm test:accessibility` — WCAG 2.1 AA compliance (axe-core)
5. `pnpm test:e2e` — Playwright E2E tests (currently disabled in CI)

Performance budgets: LCP <2500ms, FCP <1800ms, CLS <0.1.

## Fro Bot Integration

**Active Fro Bot agent workflow present.** This repo has full [[fro-bot-agent]] integration with three operational modes:

1. **PR Review** (`pull_request` events) — Structured review with Verdict (PASS/CONDITIONAL/REJECT), blocking issues, risk assessment. Reviews focus on security (API key handling, encryption, CSP), type safety, Zod-first validation, provider abstraction, storage rules, async handler patterns, and design system compliance.

2. **Daily Maintenance** (`schedule`, 15:30 UTC) — Rolling "Daily Maintenance Report" issue with metrics, stale issue/PR tracking, quality gate status, and recommended actions. 14-day rolling window with historical summary.

3. **Autoheal** (`fro-bot-autoheal.yaml`, 03:30 UTC daily) — Five-category automated repair: errored PRs, security remediation, code quality/repo hygiene, developer experience, and quality gates verification. Produces a daily "Daily Autohealing Report" issue. Hard boundaries prevent force-push, direct-to-main commits, test weakening, or config tampering.

Both workflows use `fro-bot/agent@v0.40.2` with `OPENCODE_PROMPT_ARTIFACT`, `FRO_BOT_PAT`, `FRO_BOT_MODEL`, and `OMO_PROVIDERS` configuration.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.8`. Custom rules for LangChain monorepo grouping, lucide-react monthly minor automerge, and unstable package automerge (via `bfra-me/renovate-config:automerge.json5`). Post-upgrade runs bootstrap + fix + build.
- **ESLint:** `@bfra.me/eslint-config` (0.50.1) with `@eslint-react/eslint-plugin`, Prettier integration via `eslint-plugin-prettier`.
- **Prettier:** `@bfra.me/prettier-config/120-proof` (120-char line length).
- **TypeScript:** `@bfra.me/tsconfig` extended with strict mode, path aliases (`@/` → `src/`).
- **Git hooks:** `simple-git-hooks` + `lint-staged` — pre-commit runs ESLint fix on staged files.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (shared with [[marcusrbrown--ha-config]]).
- **AGENTS.md:** Hierarchical agent instruction files in root, `src/`, `tests/`, `scripts/`, `notebooks/`, `docs/`, `.github/`, `RFCs/`, `.ai/`.

## Notebooks

Interactive Deno Jupyter notebooks for agent R&D:

- `01-repo-ranger.ipynb` — Code analysis and security checking agent
- `01-gpt-architect.ipynb` — Assistant development and optimization tool
- `01-baroque-bitch.ipynb` — Art generation and style transfer assistant

## Conventions (from AGENTS.md)

- **Imports:** `@/` alias for `src/` paths
- **Types:** Zod schema first, then `z.infer<typeof Schema>`
- **Handlers:** `handle` prefix (`handleSubmit`, `handleClick`)
- **Errors:** `catch (error_)` naming, re-throw for error boundaries
- **Async UI:** `.catch(console.error)` in `onPress`/`onClick`, never `void`
- **State:** Access via hooks only, never `localStorage` directly
- **Colors:** Semantic design tokens only, no hardcoded values
- **Storage:** IndexedDB via Dexie only, never `localStorage` for data

### Anti-Patterns (Explicitly Forbidden)

- `localStorage` for data → use IndexedDB via `useStorage()`
- Hardcoded colors → use design system tokens
- `as any`, `@ts-ignore`, `@ts-expect-error` → proper types + Zod validation
- `void asyncFn()` → `.catch(console.error)`
- Array index as React key → content-based unique keys
- Nested buttons in Card → separate clickable areas

## Shared Ecosystem Patterns

This repo shares infrastructure patterns with [[marcusrbrown--ha-config]] and the broader Fro Bot ecosystem:

- **Renovate config:** Both extend `marcusrbrown/renovate-config`
- **Probot settings:** Both extend `fro-bot/.github:common-settings.yaml`
- **ESLint/Prettier/TypeScript:** Both use `@bfra.me/*` shared configs
- **Package manager:** Both use pnpm exclusively
- **Branch protection:** Both enforce linear history, admin enforcement, no required PR reviews

Key difference: This repo has active Fro Bot agent workflows (PR review, daily maintenance, autoheal), while [[marcusrbrown--ha-config]] does not yet have Fro Bot CI integration.
