# Copilot Instructions for Fro Bot .github Repository

## Project Overview

This is the foundational `.github` repository for Fro Bot, an AI-powered GitHub bot ecosystem. It serves as the automated control center containing community health files, shared configurations, and workflows that power repository management across all Fro Bot projects.

## Canonical Context (read first)

1. `README.md` — repository purpose and structure
2. `.github/workflows/main.yaml` — current CI quality gate behavior
3. `.github/actions/setup/action.yaml` — required environment/bootstrap pattern
4. `package.json` — authoritative scripts and package-manager contract

Additional high-signal config:

- `tsconfig.json` (extends `@bfra.me/tsconfig`)
- `eslint.config.ts` (uses `@bfra.me/eslint-config`)
- `common-settings.yaml` (repository settings contract)

If guidance conflicts, follow the order above.

## Repository Contract

- This repo is the automation/config control center for the Fro Bot org.
- Keep changes minimal and targeted; avoid broad refactors.
- Use **pnpm only** (never npm/yarn).
- Use existing conventions from `@bfra.me/*` configs.

## Architecture & Key Components

- Community health files (`README.md`, `SECURITY.md`, `LICENSE.md`)
- Automation hub (`.github/workflows/`, `.github/actions/`)
- Copilot governance hooks (`.github/hooks/`)
- Shared repo policy/settings (`common-settings.yaml`, `.github/settings.yml`)
- Development standards and quality gates (TypeScript/ESLint/Prettier)
- Control-plane TypeScript (`scripts/*.ts`, executed with Node 24 native TS; no build step)
- Metadata state (`metadata/*.yaml`, written programmatically to the `data` branch)
- Knowledge wiki (`knowledge/{schema,index,log}.md` + `knowledge/wiki/`, Karpathy-style LLM-generated)
- Character definition (`persona/`, injected into agent prompts)
- Repo-scoped agent skills (`.agents/skills/`)
- Brand assets (`assets/`, `branding/`) — downstream applied via the `apply-branding` workflow

### Tests

- Vitest runs tests colocated as `scripts/*.test.ts`.
- Mocks use `vi.hoisted()` + `vi.mock()` for static `@octokit/rest` shims.
- Prefer behavior-level assertions over implementation-coupled ones.

### Autonomous Commits

- Autonomous writes target the unprotected `data` branch (`main` has `enforce_admins: true`).
- All metadata writes go through `scripts/commit-metadata.ts`.
- `data → main` promotes via the `Merge Data Branch` workflow (weekly; see [`merge-data.yaml`](workflows/merge-data.yaml) for schedule).
- Conditional auto-merge: PRs touching only `knowledge/` or `metadata/` paths are labeled for auto-merge; PRs touching code paths require human approval. See [`metadata/README.md`](../metadata/README.md) for schema, credential expectations, and commit conventions.

## Required Workflow for Every Change

1. Read nearby files and match existing style/patterns.
2. Implement the smallest safe diff.
3. Run verification commands locally.
4. Update docs when behavior or usage changes.

## Verification Commands (required)

Run these commands in repository root before finalizing:

```bash
pnpm bootstrap
pnpm check-types
pnpm lint
pnpm test
```

If you touched workflows, also validate YAML shape and action references in modified files.

If you touched docs/instructions/agent files, ensure markdown lint rules still pass.

## High-Risk Do / Don’t Patterns

### Package manager

- **Do:** `pnpm bootstrap`
- **Don’t:** `npm install`, `yarn install`, or lockfile rewrites from other managers

### Workflow setup

- **Do:** use `./.github/actions/setup` in workflows that need dependencies
- **Don’t:** duplicate ad-hoc setup steps that drift from the shared setup action

### Type safety

- **Do:** prefer `unknown` + narrowing and explicit types where needed
- **Don’t:** introduce `any`, `@ts-ignore`, or silent type suppression

### Logging

- **Do:** prefer structured, meaningful logging where applicable
- **Don’t:** add noisy `console.log` debugging output to committed workflow scripts/code

### Scope control

- **Do:** change only files relevant to the request
- **Don’t:** bundle unrelated cleanup/refactors in the same PR

## Security & Safety Constraints

- Never add or expose credentials/secrets in code, workflow logs, or docs.
- Do not weaken branch protections, required checks, or security workflow coverage.
- Prefer least-privilege permissions in workflows and automation.
- Never add destructive commands without explicit requirement and safe guards.

## Platform-Specific Notes

### GitHub Copilot coding agent

- Setup-steps workflow job name must be `copilot-setup-steps`.
- Keep setup-steps deterministic and focused on environment preparation.
- Copilot hooks are configured via `.github/hooks/*.json`.
- MCP and firewall are configured in GitHub repository settings, not via committed repo files.

## Completion Criteria

A change is done only when:

1. The requested behavior/config is implemented.
2. Verification commands pass.
3. Documentation is updated if behavior changed.
4. No unrelated files were modified.
