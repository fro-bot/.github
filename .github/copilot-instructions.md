# Copilot Instructions for Fro Bot .github Repository

## Project Overview

This is the foundational `.github` repository for Fro Bot, an AI-powered GitHub bot ecosystem. It serves as the automated control center containing community health files, shared configurations, and workflows that power repository management across all Fro Bot projects.

## Canonical Context (read first)

1. `README.md` — repository purpose and structure
2. `.github/workflows/main.yaml` — current CI quality gate behavior
3. `.github/actions/setup/action.yaml` — required environment/bootstrap pattern
4. `package.json` — authoritative scripts and package-manager contract

Additional high-signal config:

- `bunfig.toml` (install settings: hoisted layout, exact versions, 3-day release-age floor)
- `tsconfig.json` (extends `@bfra.me/tsconfig`)
- `eslint.config.ts` (uses `@bfra.me/eslint-config`)
- `common-settings.yaml` (repository settings contract)

If guidance conflicts, follow the order above.

## Repository Contract

- This repo is the automation/config control center for the Fro Bot org.
- Keep changes minimal and targeted; avoid broad refactors.
- Use **Bun** for dependencies and package scripts (`bun run <script>`, `bunx --no-install <bin>`); never yarn or pnpm; npm only in the places listed below. Never run bare `bun test` or `bun build`: those are Bun built-ins, not the package scripts.
- Bun is the runtime for `scripts/*.ts` (`bun scripts/<name>.ts`) and for the package source they import. Node 24 is the runtime for Vitest and Stryker, which run through their package binaries.
- npm stays in these places only: `npm publish` and the publish job's tool install in `release-wiki-write-core.yaml` (with `min-release-age=3`), `npm pack` in the package test, and the Quartz site build in `publish-wiki.yaml`.
- These also run on Node: the private-leak scan (`scripts/check-private-leak.ts`, which loads `@fro-bot/privacy`) and `scripts/enumerate-existing-leaks.ts`, the "Test Scripts Load" job in `main.yaml` (the strip-only import smoke test; it loads `scripts/*.ts` and every `packages/*/src` module except `packages/wiki-write-core`, and fails if its `find` matches nothing while `packages/core/src` exists), the Vitest step of the `coverage` script (its build step runs on Bun), and `check:renovate-config` (its `re2` native binding is built for Node's ABI and does not load under Bun, so `scripts/install-renovate.ts` and `scripts/check-renovate-config.ts` run with `node`).
- Use existing conventions from `@bfra.me/*` configs.

## Architecture & Key Components

- Community health files (`README.md`, `SECURITY.md`, `LICENSE.md`)
- Automation hub (`.github/workflows/`, `.github/actions/`)
- Copilot governance hooks (`.github/hooks/`)
- Shared repo policy/settings (`common-settings.yaml`, `.github/settings.yml`)
- Dependency policy (`package.json` `overrides` and `trustedDependencies`, `bunfig.toml`; the root `overrides` map pins 14 floors; [`docs/override-floors.md`](../docs/override-floors.md) records the rationale for six of them: brace-expansion, fast-uri, qs, source-map-js, undici and zod)
- Development standards and quality gates (TypeScript/ESLint/Prettier)
- Control-plane TypeScript (`scripts/*.ts`, executed with Bun except the Node exceptions listed under Repository Contract; no build step)
- Private workspace packages (`packages/core`, `packages/privacy`, `packages/test-kit`): `@fro-bot/` packages that export `.ts` source through subpath `exports`, with `private: true`, `workspace:*` internal dependencies and a README with a Mermaid `C4Component` diagram. `@fro.bot/wiki-write-core` stays the only published package. `packages/privacy` holds the privacy family (the private-leak scan, the wiki-presence gate, the public-output gate, the token and redacted-ID loaders, the operator tools); each of its CLIs keeps a six-line `scripts/<name>.ts` entrypoint that calls `main` from the package's `*-cli` module. The other domain packages (registry, dispatch, status-truth, wiki-ops, knowledge, reports, ci-checks) are planned: `scripts/` modules move into them behind thin `scripts/<name>.ts` entrypoints. The root `README.md` carries the package dependency graph (`flowchart`) and the `C4Container` view; `scripts/package-layout.test.ts` enforces the real graph and that only `*-cli.ts` modules import `@fro-bot/core/cli` (the goke runner; the four `@fro-bot/privacy` CLIs are on it). `@fro-bot/core` also depends on `@octokit/rest`, `goke` and `zod`; `@fro-bot/test-kit/spawn-entrypoint` runs an entrypoint in a child process for CLI parity tests
- Package release (`.github/workflows/release-wiki-write-core.yaml`, `packages/wiki-write-core/.releaserc.yaml`, `scripts/wiki-write-core-release.ts`): a merge to `main` that changes `packages/wiki-write-core/` publishes `@fro.bot/wiki-write-core` to npm via semantic-release; the release tools install into a scratch prefix with Bun (3-day `--minimum-release-age` floor), never `package.json` or the lockfile; the publish job installs its tools with npm and `--min-release-age=3`. Release-tool transitives are deliberately unlocked: the top-level tools are exact-pinned and installed with `--ignore-scripts`, and a committed lock would pin `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm, no patched version)
- Metadata state (`metadata/*.yaml`, written programmatically to the `data` branch)
- Knowledge wiki (`knowledge/{schema,index,log}.md` + `knowledge/wiki/`, Karpathy-style LLM-generated)
- Documented solutions (`docs/solutions/`, categorized learnings and fixes with YAML frontmatter for searchability)
- Character definition (`persona/`, injected into agent prompts)
- Repo-scoped agent skills (`.agents/skills/`)
- Brand assets (`assets/`, `branding/`) — downstream applied via the `apply-branding` workflow

### Tests

- Vitest runs tests colocated as `scripts/*.test.ts` and `packages/*/src/*.test.ts`.
- Shared fakes and helpers live in `@fro-bot/test-kit` (`git-data-fake`, `workflow-step`, `workflow-expression`, `repo-page-move-fixtures`). Tests import them by package name; no non-test module may import the test kit.
- A test that must kill mutants imports the mutated module by relative path. The Stryker sandbox links `node_modules` to the real tree, so a package-name import runs against the un-mutated file and every mutant survives. `scripts/mutation-guards-config.test.ts` rejects a `mutate` entry whose tests reach it only through an `@fro-bot/` name. Keep regexes and other constants whose mutants matter inside functions: a mutant in a module-level constant is covered by no test and survives.
- Mocks use `vi.hoisted()` + `vi.mock()` for static `@octokit/rest` shims.
- Prefer behavior-level assertions over implementation-coupled ones.

### Autonomous Commits

- Autonomous writes target the `data` branch, which a repository ruleset restricts to the Fro Bot App and a second, bypass-free ruleset protects from deletion (`main` has `enforce_admins: true`).
- All metadata writes go through `scripts/commit-metadata.ts`. There are two exceptions: the operator-dispatched rename workflow (`scripts/rename-tracked-repo.ts`), which writes `metadata/repos.yaml` together with the wiki page move in one atomic Git Data commit, and `scripts/merge-back-data.ts`, which merges `main` into `data` with a Git Data commit at the start of every merge-data run.
- `data → main` promotes via the `Merge Data Branch` workflow (weekly; see [`merge-data.yaml`](workflows/merge-data.yaml) for schedule).
- Drafted solution docs bypass `data`: the weekly [`draft-solutions.yaml`](workflows/draft-solutions.yaml) workflow commits `docs/solutions/` drafts to the `docs/drafted-solutions` branch and opens a PR that is reviewed and merged manually (Fro Bot cannot review a first-party App's PR, [fro-bot/agent#1520](https://github.com/fro-bot/agent/issues/1520)); merge is never automatic.
- Conditional auto-merge: PRs touching only `knowledge/` or `metadata/` paths are labeled for auto-merge; PRs touching code paths require human approval. See [`metadata/README.md`](../metadata/README.md) for schema, credential expectations, and commit conventions.

## Required Workflow for Every Change

1. Read nearby files and match existing style/patterns. In documented areas, also search `docs/solutions/` for relevant prior learnings using frontmatter like `module`, `tags`, and `problem_type`.
2. Implement the smallest safe diff.
3. Run verification commands locally.
4. Update docs when behavior or usage changes.

## Verification Commands (required)

Run these commands in repository root before finalizing:

```bash
bun run bootstrap
bun run check-types
bun run lint
bun run test
```

If you touched workflows, also validate YAML shape and action references in modified files.

If you touched docs/instructions/agent files, ensure markdown lint rules still pass.

If you touched a module listed in `stryker.config.json`'s `mutate` list or its paired test, also run `bun run check:mutation-guards`. A change under `packages/<pkg>/` (a source file a mutated module imports by name, or a `package.json`) triggers the gate too.

If you touched `default.json`, `.github/renovate.json5`, or `scripts/check-renovate-*.ts`, also run `bun run check:renovate-config` (needs network and Bun; installs the Renovate pinned in `main.yaml` into a scratch dir with a 3-day `--minimum-release-age` floor, never into the repo; CI runs it in the `Check Workflows` job).

## High-Risk Do / Don’t Patterns

### Package manager

- **Do:** `bun run bootstrap`
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

### Stryker disable directives

- **Do:** enumerate every variant the named mutator generates for that line before adding a `Stryker disable next-line` directive; prefer deleting dead code or adding a seam instead. See [`docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md`](../docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md).
- **Don’t:** write a directive that argues only the variant that prompted it — a `Stryker disable next-line` directive is mutator-scoped, not variant-scoped, so it silently suppresses every other variant that mutator produces on the same line.

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
