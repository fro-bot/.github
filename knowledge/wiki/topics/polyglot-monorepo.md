---
type: topic
title: Polyglot Monorepo Patterns
created: 2026-04-18
updated: 2026-04-18
tags: [monorepo, pnpm, poetry, python, typescript, ci]
related:
  - marcusrbrown--copiloting
---

# Polyglot Monorepo Patterns

Patterns for managing repositories with multiple language runtimes (Python + TypeScript) under a single root.

## Observed Patterns

### marcusrbrown/copiloting

[[marcusrbrown--copiloting]] is a Python (Poetry) + TypeScript (pnpm) monorepo with independent toolchains:

- **Tool version management:** `mise.toml` pins Python, Node.js, pnpm, and Poetry versions in one file. Developers run `mise install` to get the correct versions.
- **Workspace isolation:** pnpm workspaces handle JS/TS packages (`tutorials/`, `course/pdf-dist/client/`). Poetry path dependencies handle Python packages (`course/sections/`, `course/pdf-dist/`). No cross-language tooling bridge.
- **CI path filtering:** `dorny/paths-filter` detects which language files changed and skips unaffected build jobs. The Node.js and Python CI jobs run independently.
- **Dual lockfiles:** `pnpm-lock.yaml` for JS/TS, `poetry.lock` for Python. Both committed. Renovate manages updates to both.
- **Convention enforcement:** Separate linting/formatting pipelines per language. ESLint + Prettier for JS/TS, pytest for Python. No shared quality tool spans both.

### Key Risks

- **Version drift:** Language-specific deps can drift independently. The JS `langchain` version in copiloting is significantly older than the Python version.
- **Stale imports:** Upgrading deps in lock files without updating application code creates import path mismatches (observed in copiloting's Python LangChain imports).
- **Onboarding complexity:** Two package managers, two test runners, two sets of conventions. The `AGENTS.md` pattern helps document this.
