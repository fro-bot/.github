---
type: repo
title: "marcusrbrown/copiloting"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/copiloting
    sha: cfc8bb6d5e814c9918a6e55f4b6747c3a36e4fb1
    accessed: 2026-04-18
tags: [langchain, llm, ai, python, typescript, flask, sveltekit, openai, poetry, pnpm, monorepo]
aliases: [copiloting]
related:
  - langchain
---

# marcusrbrown/copiloting

Polyglot AI/LLM experimentation monorepo. [[langchain]]-based copilot experiments with a Flask + SvelteKit PDF chat application, Python course modules, and TypeScript tutorial scripts. Course/exploration code, not a shipped product.

## Overview

- **Purpose:** AI/LLM experimentation and learning
- **Default branch:** `main`
- **License:** MIT
- **Created:** 2021-07-02
- **Last push:** 2026-04-18
- **Languages:** Python (primary), TypeScript, Svelte, Jupyter Notebook, HTML, CSS, JavaScript
- **Topics:** `langchain`, `typescript`, `python`, `sveltekit`, `flask`, `openai`, `llm`, `ai`, `copilot`, `pnpm`, `poetry`

## Repository Structure

Dual-language monorepo: Python managed by Poetry, TypeScript/JavaScript managed by pnpm workspaces.

### Key Directories

| Directory                 | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `tutorials/`              | TypeScript LangChain tutorial scripts (pnpm workspace)           |
| `course/sections/`        | Python AI modules: agents, chains, facts, tchat (Poetry package) |
| `course/pdf-dist/`        | Flask + SvelteKit PDF chat app (standalone project)              |
| `course/pdf-dist/app/`    | Python backend (Flask, Celery, SQLAlchemy)                       |
| `course/pdf-dist/client/` | SvelteKit frontend (pnpm workspace)                              |
| `course/local-do/`        | Minimal Flask PDF upload server (separate Poetry project)        |
| `copiloting/`             | Empty Python stub (`__init__.py` only)                           |
| `tests/`                  | pytest (Python) and vitest (TypeScript) test suites              |

### PDF Chat App (`course/pdf-dist/`)

The most substantial sub-project. A full-stack PDF question-answering application:

- **Backend:** Flask app factory, SQLAlchemy models, Celery worker for async processing
- **Frontend:** SvelteKit with path aliases (`$c` for components, `$s` for store, `$api` for API client)
- **AI layer:** LangChain chains, retrievers, memory, embeddings, tracing (`app/chat/`)
- **Infrastructure:** Redis (Celery broker), SQLite (dev DB), Pinecone (vector store)

### Python Course Modules (`course/sections/`)

Poetry entry points expose CLI commands from the root:

- `poetry run agents` — LangChain agent demos
- `poetry run course` — Chain demos
- `poetry run facts` / `poetry run facts-create-embeddings` — Embedding/retrieval demos
- `poetry run tchat` — Chat demos

### TypeScript Tutorials (`tutorials/`)

Single file: `quickstart-llms.ts` — LangChain TypeScript quickstart.

## Technology Stack

### Python

- **Runtime:** Python 3.14 (pinned via mise)
- **Package manager:** Poetry 2.3.4
- **Core deps:** langchain ^1.2, langchain-openai ^1.1, langchain-community >=0.3, openai ^2.0, pydantic ^2.10, tiktoken ^0.12
- **Dev deps:** pytest ^9.0.2, ipykernel ^7.2, matplotlib ^3.10
- **PDF app deps:** Flask, Celery, SQLAlchemy, Redis, Pinecone (via pdf-dist sub-project)

### TypeScript / JavaScript

- **Runtime:** Node.js 24.15.0 (pinned via mise)
- **Package manager:** pnpm 10.33.0
- **Core deps:** langchain 0.0.212 (root-level, older version)
- **Dev deps:** @bfra.me/eslint-config, @bfra.me/prettier-config, @bfra.me/tsconfig, eslint 10.2.0, prettier 3.8.3, typescript 5.9.3, vitest ^2.1.9
- **Svelte:** prettier-plugin-svelte for formatting

### Tooling

- **mise:** Manages all tool versions (Python, Node, pnpm, Poetry) via `mise.toml`
- **ESLint + Prettier:** `@bfra.me/eslint-config` handles both; `singleQuote: true`, `bracketSpacing: false`, `tabWidth: 2`
- **TypeScript:** Extends `@bfra.me/tsconfig` (strict mode); ESM-only, `nodenext` module system, `.js` extensions required
- **EditorConfig:** LF line endings enforced

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main`, dispatch | Dual-language build + test |
| Fro Bot | `fro-bot.yaml` | PR events, issue events, @fro-bot mentions, schedule, dispatch | AI agent: PR review, triage, maintenance |
| Fro Bot Autoheal | `fro-bot-autoheal.yaml` | daily cron (03:30 UTC), dispatch | Automated repo healing and progressive improvement |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | dispatch, push/PR to self | GitHub Copilot coding agent environment bootstrap |
| Renovate | `renovate.yaml` | issue/PR edit, push, dispatch, CI completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync |

### CI Jobs (`ci.yaml`)

Uses `dorny/paths-filter` to detect changed files, then runs jobs conditionally:

1. **Build Node.js** (if JS/TS changed) — `pnpm install` → `pnpm lint` → `pnpm build` → `pnpm test`
2. **Build Python** (if Python changed) — `poetry install` → `poetry run pytest`

Caching: pnpm store, ESLint cache, SvelteKit build cache, Poetry virtualenv.

### Branch Protection

Required status checks on `main`: `Fro Bot`, `Build Node.js`, `Build Python`, `Renovate / Renovate`. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Workflows

`renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github` (v4.16.6). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

## Fro Bot Integration

**Fro Bot workflow is present and fully configured.** The repo has both `fro-bot.yaml` (main agent) and `fro-bot-autoheal.yaml` (daily healing).

### Fro Bot Agent (`fro-bot.yaml`)

- **Triggers:** PR events (opened, synchronize, reopened, ready_for_review, review_requested), issue events, @fro-bot comment mentions (OWNER/MEMBER/COLLABORATOR only), daily schedule (15:30 UTC), workflow_dispatch
- **PR review prompt:** Structured review with Verdict (PASS/CONDITIONAL/REJECT), blocking issues, non-blocking concerns, missing tests, risk assessment. Focuses on correctness, Python import compat, TS strictness, security, breaking changes.
- **Schedule prompt:** Daily maintenance report as a single rolling issue with 14-day retention.
- **Agent:** `fro-bot/agent@v0.40.2` (SHA-pinned)
- **Concurrency:** Grouped by issue/PR number, no cancellation of in-progress

### Fro Bot Autoheal (`fro-bot-autoheal.yaml`)

- **Schedule:** Daily at 03:30 UTC
- **Categories:** Errored PRs, security remediation, code quality (stale Python imports — one file per run), AGENTS.md accuracy, developer experience (lint/format fixes)
- **Constraints:** Never force-push, never push to default branch, never merge PRs, Renovate owns version bumps (security exceptions only)
- **Output:** Single daily summary issue

### GitHub Copilot Integration

- `copilot-setup-steps.yaml` — Environment bootstrap for GitHub Copilot coding agent
- `.github/copilot-instructions.md` — Supplements `AGENTS.md` with hard rules and verification commands
- `AGENTS.md` — Comprehensive project map for AI agents (structure, conventions, commands, anti-patterns)

## Known Issues

### Stale Python Imports

**Documented in AGENTS.md as an anti-pattern.** Python dependencies were upgraded to modern versions (langchain ^1.2, openai ^2.0, pydantic ^2.10) but application code still uses old import paths and APIs. The autoheal workflow migrates one file per run. Specific migrations needed:

- `from langchain.chat_models import ChatOpenAI` → `from langchain_openai import ChatOpenAI`
- `from langchain.llms import OpenAI` → `from langchain_openai import OpenAI`
- Old `openai.ChatCompletion.create(...)` → new client API
- pydantic v1 validators → v2 `model_validator`/`field_validator`

### Root-level langchain Version Mismatch

The root `package.json` pins `langchain: "0.0.212"` (very old JS SDK), while the Python side uses `langchain ^1.2`. The TypeScript tutorials workspace may have its own deps, but the root-level pin is significantly outdated.

## Developer Tooling

- **Renovate:** Extends `marcusrbrown/renovate-config#v4`. Python 3.14 constraint applied. Post-upgrade runs `poetry lock`. Rebase when behind base branch.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` for repository configuration sync.
- **VS Code:** Recommended extensions (`ms-python.python`, `ms-python.vscode-pylance`). Configured to use repo `.venv`, Pylance resolves `course/pdf-dist` imports.
- **Dev Container:** `.devcontainer.json` present (not inspected).
- **Env template:** `.env.template` for API keys (OpenAI, Pinecone, Redis, etc.)

## Testing

### Python Tests (`tests/`)

- `conftest.py` — shared fixtures
- `test_app_factory.py` — Flask app factory tests
- `test_auth_views.py` — authentication view tests
- `test_config.py` — configuration tests
- `test_health_views.py` — health endpoint tests
- `test_hooks.py` — hook tests
- `test_models.py` — database model tests

Configuration in `pyproject.toml`: `testpaths = ["tests"]`, `pythonpath = ["course/pdf-dist"]`.

### TypeScript Tests (`tests/ts/`)

Run via vitest (`vitest.config.ts` at root).

## Notable Patterns

- **Dual-language monorepo:** Python and TypeScript coexist with independent package managers (Poetry + pnpm), no cross-language bridge. CI runs them as separate jobs.
- **Path-filtered CI:** `dorny/paths-filter` skips irrelevant language jobs, reducing CI cost.
- **AI agent governance:** Three layers of AI agent configuration — `AGENTS.md` (project map), `copilot-instructions.md` (hard rules), and Fro Bot workflow prompts (review/maintenance).
- **Progressive autohealing:** The autoheal workflow systematically migrates stale imports one file per run, keeping diffs reviewable.
- **SHA-pinned actions:** All GitHub Actions are pinned by full SHA hash (security practice), with Renovate handling updates.
