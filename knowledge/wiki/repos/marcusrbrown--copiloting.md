---
type: repo
title: "marcusrbrown/copiloting"
created: 2026-04-18
updated: 2026-04-21
sources:
  - url: https://github.com/marcusrbrown/copiloting
    sha: cfc8bb6d5e814c9918a6e55f4b6747c3a36e4fb1
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/copiloting
    sha: 904352923eff555699384071c1c9db87557adb44
    accessed: 2026-04-21
tags: [python, typescript, langchain, openai, flask, sveltekit, pnpm, poetry, ai, llm, monorepo]
aliases: [copiloting]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/copiloting

Polyglot AI/LLM experimentation monorepo. LangChain-based copilot experiments, a Flask + SvelteKit PDF chat application, and standalone tutorial scripts. Course/exploration code, not a shipped product.

## Overview

- **Purpose:** AI copilot experimentation and LangChain learning
- **Default branch:** `main`
- **License:** MIT
- **Created:** 2021-07-02
- **Last push:** 2026-04-20
- **Primary language:** Python
- **Topics:** `copilot`, `langchain`, `llm`, `ai`, `flask`, `openai`, `pnpm`, `poetry`, `python`, `sveltekit`, `typescript`

## Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Python runtime | Python | ^3.14 |
| Python package manager | Poetry | 2.3.4 |
| Python LLM framework | LangChain | ^1.2 (langchain-openai ^1.1, langchain-community >=0.3) |
| Python LLM client | OpenAI | ^2.0 |
| Python data validation | Pydantic | ^2.10 |
| Python web framework | Flask | (via pdf-dist sub-package) |
| Node.js runtime | Node.js | 24.15.0 |
| JS package manager | pnpm | 10.33.0 |
| JS LLM framework | langchain (JS) | 0.0.212 (root dep, older) |
| Frontend framework | SvelteKit | (pdf-dist/client workspace) |
| TypeScript | TypeScript | 5.9.3 |
| Test (JS) | Vitest | ^2.1.9 |
| Test (Python) | pytest | ^9.0.2 |
| Tool version manager | mise | manages python, node, pnpm, poetry |
| Linting | ESLint (@bfra.me/eslint-config) | 0.51.0 |
| Linting runner | eslint | 10.2.1 (upgraded from unrecorded; security + compatibility) |
| Formatting | Prettier (@bfra.me/prettier-config) | 0.16.8 |
| HTTP client | axios | security patch applied 2026-04-18 (PR #727) |

## Repository Structure

```
copiloting/
├── tutorials/           # TS LangChain tutorial scripts (pnpm workspace)
│   └── quickstart-llms.ts
├── course/
│   ├── sections/        # Python AI modules: agents, chains, facts, tchat (Poetry pkg)
│   ├── pdf-dist/        # Flask PDF chat app + SvelteKit frontend
│   │   ├── app/         # Python backend (chat/, web/)
│   │   └── client/      # SvelteKit frontend (pnpm workspace)
│   └── local-do/        # Minimal Flask PDF upload server (separate Poetry project)
├── copiloting/          # Empty Python stub (ignore)
├── tests/               # Python (pytest) + TypeScript (vitest) tests
├── package.json         # Root pnpm workspace
├── pyproject.toml        # Root Poetry config with CLI entry points
├── pnpm-workspace.yaml  # JS workspaces + pnpm settings
├── mise.toml            # Tool versions
├── AGENTS.md            # Full project conventions doc
└── vitest.config.ts     # TS test config
```

### Workspace Layout

**pnpm workspaces:** `course/pdf-dist/client`, `tutorials`

**Poetry path deps:** `course/pdf-dist` (group: pdf-dist), `course/sections` (group: sections)

### Python CLI Entry Points

Defined in `pyproject.toml` under `[tool.poetry.scripts]`:

- `agents` — `course.sections.agents:main`
- `course` — `course.sections.chain:main`
- `facts` / `facts-create-embeddings` — `course.sections.facts:main` / `create_embeddings`
- `tchat` — `course.sections.tchat:main`

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `ci.yaml` | push/PR to `main`, dispatch | Lint + build + test (Node.js and Python, path-filtered) |
| Fro Bot | `fro-bot.yaml` | PR events, issue events, comments (@fro-bot), daily schedule, dispatch | Automated PR review, triage, daily maintenance |
| Fro Bot Autoheal | `fro-bot-autoheal.yaml` | Daily cron (03:30 UTC), dispatch | Automated repo healing: fix errored PRs, security, code quality, stale imports |
| Copilot Setup Steps | `copilot-setup-steps.yaml` | push/PR touching itself, dispatch | GitHub Copilot agent environment bootstrap |
| Renovate | `renovate.yaml` | issue/PR edits, push, dispatch, CI completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync |

### CI Jobs (ci.yaml)

Uses `dorny/paths-filter` to detect changed file types and skip unnecessary jobs:

1. **Build Node.js** — `pnpm install` -> `pnpm lint` -> `pnpm build` -> `pnpm test` (vitest). Caches pnpm store, ESLint cache, and SvelteKit build.
2. **Build Python** — `poetry install` -> `poetry run pytest`. Caches `.venv`.

### Branch Protection

Required status checks on `main`: `Fro Bot`, `Build Node.js`, `Build Python`, `Renovate / Renovate`. Strict merge queue, linear history enforced, admin enforcement enabled, no required PR reviews.

### Shared Workflows

`renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github` (v4.16.7; updated from v4.16.6 on 2026-04-19, SHA `a518e036563790803ccbd2d90d6a1eb2e08d2fa1`). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.41.3` (SHA-pinned: `36c9850c2ac6e6d4d532662fca2ca89bd2bc559d`). _Updated from v0.40.2 → v0.41.0 → v0.41.1 → v0.41.2 → v0.41.3 between 2026-04-18 and 2026-04-19._

### Fro Bot Capabilities in This Repo

- **PR Review:** Triggered on PR open/sync/reopen/ready_for_review/review_requested. Structured review with Verdict (PASS/CONDITIONAL/REJECT), blocking issues, risk assessment. Focuses on correctness, Python import compatibility (stale APIs), TS strictness, security.
- **Issue Triage:** Triggered on issue open/edit by non-bot users.
- **Comment Interaction:** Triggered by `@fro-bot` mentions from OWNER/MEMBER/COLLABORATOR.
- **Daily Maintenance:** Scheduled at 15:30 UTC. Updates a rolling "Daily Maintenance Report" issue with metrics, stale issues/PRs, recommendations.
- **Custom Prompts:** Supports workflow_dispatch with custom prompt input.

### Fro Bot Autoheal

Daily automated healing (`fro-bot-autoheal.yaml`) at 03:30 UTC:

1. **Errored PRs** — diagnoses and fixes CI failures on trusted PR branches
2. **Security** — remediates critical/high advisories, fixes failing security update PRs
3. **Code Quality** — migrates stale Python imports (one file per run), checks convention compliance, validates AGENTS.md accuracy
4. **Developer Experience** — fixes lint/format issues, opens PRs for fixes
5. Produces a daily "Daily Autohealing Report" issue

### Concurrency and Filtering

Fro Bot runs are grouped by issue/PR number, cancel-in-progress disabled. Filters out forks, bot-authored PRs, and bot-authored issues. Comment triggers require OWNER/MEMBER/COLLABORATOR association.

## Developer Tooling

- **mise:** Manages Python 3.14, Node.js 24.15.0, pnpm 10.33.0, Poetry 2.3.4. Adds `node_modules/.bin` to PATH and creates `.venv` automatically.
- **Renovate:** Extends `marcusrbrown/renovate-config#v4`. Python constrained to <=3.14. Rebases behind base branch. Post-upgrade runs `poetry lock` for Python deps.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (`.github/settings.yml`).
- **AGENTS.md:** Comprehensive project conventions doc at repo root. Also has a `tutorials/AGENTS.md`.
- **Copilot Instructions:** `.github/copilot-instructions.md` supplements AGENTS.md with hard rules for TypeScript strictness, Python conventions, package managers, and formatting.
- **VS Code:** `.vscode/` configuration for Python interpreter, Pylance path resolution (`course/pdf-dist` imports).
- **EditorConfig:** LF line endings enforced.

## Known Issues and Anti-Patterns

Per AGENTS.md (self-documented):

- **Stale Python imports:** Dependencies upgraded to langchain ^1.2/0.3, openai ^2.0, pydantic ^2.10, but application code still uses old import paths. The autoheal workflow progressively migrates these one file at a time.
- **`copiloting/__init__.py`** is an empty stub — not a real importable package.
- **`.env` risk:** `.env` may contain committed secrets historically. Template at `.env.template` is the safe reference.
- **JS langchain version mismatch:** Root `package.json` pins `langchain` at `0.0.212` (very old) while Python side uses ^1.2.

## Conventions

- **TypeScript:** Extends `@tsconfig/strictest` — no `any`, no `@ts-ignore`, no `@ts-expect-error`. ESM only, `.js` extensions in imports, `nodenext` module system.
- **Python:** ^3.14, Poetry-managed. Each subdirectory is an independent Poetry project.
- **Package managers:** pnpm 10 only (JS/TS), Poetry only (Python). Never npm/yarn/pip.
- **Formatting:** Prettier with `singleQuote: true`, `bracketSpacing: false`, `tabWidth: 2`. Svelte files use svelte parser.
- **Actions:** Pinned by full SHA hash, Renovate updates them.
- **SvelteKit aliases:** `$c` -> `src/components`, `$s` -> `src/store`, `$api` -> `src/api/axios.js`.

## Testing

- **Python tests** (`tests/`): pytest. Tests cover app factory, auth views, config, health views, hooks, DB models.
- **TypeScript tests** (`tests/ts/`): vitest. Config at `vitest.config.ts`, includes `tests/**/*.test.ts`.
- `pyproject.toml` sets `pythonpath = ["course/pdf-dist"]` so tests can import the Flask app.
