# Copilot Instructions for Fro Bot .github Repository

## Project Overview

This is the foundational `.github` repository for Fro Bot, an AI-powered GitHub bot ecosystem. It serves as the automated control center containing community health files, shared configurations, and workflows that power repository management across all Fro Bot projects.

## Canonical Context (read first)

1. `README.md` — repository purpose and structure
2. `.cursorrules` — AI-development conventions and constraints
3. `.github/workflows/main.yaml` — current CI quality gate behavior
4. `.github/actions/setup/action.yaml` — required environment/bootstrap pattern
5. `package.json` — authoritative scripts and package-manager contract

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
- Development standards and quality gates (`.cursorrules`, TypeScript/ESLint/Prettier)

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
