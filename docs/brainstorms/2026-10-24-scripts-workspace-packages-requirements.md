---
date: 2026-10-24
topic: scripts-workspace-packages
---

# Consolidate `scripts/` into Private Workspace Packages

## Summary

The control-plane code in `scripts/` moves into unpublished `@fro-bot/` workspace packages, one stage at a time.

The first stage adds a shared core package and a test kit, and it removes the duplicated mechanical primitives. Follow-up stages migrate the primitives whose behavior varies, then move each domain into a documented package with a goke CLI. Phase 1 is done when every module has a home and `scripts/` holds only thin entrypoints plus the release and build scripts.

Workflows, agent prompts, exit codes and outputs don't change in phase 1.

---

## Problem Frame

`scripts/` holds 81 source modules (40.7k lines) and 107 test files (99.9k lines). About 58 of the modules run as standalone CLIs from workflows. The rest are libraries that other scripts import. The scripts re-implement the same plumbing many times over:

- **Duplicated primitives.** `isRecord` is defined in 20 scripts and in 9 `wiki-write-core` modules. Other repeats have no shared helper at all:
  - About 48 modules read and validate env vars themselves.
  - 15 have their own retry loop.
  - 18 write JSON to stdout their own way.
  - 14 write `$GITHUB_OUTPUT` directly.
  - 11 build their own Octokit client.
  - Argument parsing is hand-rolled in most CLIs.
- **Duplicated test scaffolding.** Many test files build their own Octokit fake. `scripts/git-data-fake.ts` is the only shared fake.
- **Oversized domain modules.** `reconcile-repos.ts` is 4.3k lines. `cross-repo-dispatch.ts`, `status-truth-detect.ts`, `status-truth-proposals.ts` and `status-truth-prs.ts` are each about 2k lines. Changing one concern means reading the whole file.
- **Wrappers.**
  - `schemas.ts`, `wiki-utils.ts` and `markdown-links.ts` are one-line re-exports of `@fro.bot/wiki-write-core`.
  - `wiki-ingest.ts`, `wiki-lint.ts`, `wiki-slug.ts` and `data-branch-bootstrap.ts` are thin CLI entrypoints over that package. `wiki-ingest.ts` also maps a page conflict to exit 3, and `survey-repo.yaml` branches on that exit code.

Each new script copies this plumbing again, and the copies drift. Nothing documents what a script does or which pieces are shared.

Phase 2 will replace inline workflow shell with CLI calls, and may expose some commands to Fro Bot agent runs as MCP tools. That work needs a stable library and CLI layer to build on.

---

## Requirements

**Packages**

- R1. Shared control-plane code lives in unpublished workspace packages. They use the `@fro-bot/` scope and set `"private": true`. `@fro.bot/wiki-write-core` stays the only published package.
- R2. A core package provides the primitives that scripts duplicate today:
  - type guards
  - env reading
  - step output and step summary writing
  - retry
  - GitHub client construction
  - `metadata/*.yaml` read and write
  - JSON output

  Every non-test module that duplicates one of these uses the core version instead.

- R3. A test-kit package provides the shared test fakes and helpers: GitHub client and Git Data fakes, and the workflow step and expression helpers. Tests that build their own fake or guard for a covered surface use the kit instead.
- R4. Every module gets a home. Once core ships, each domain moves into its own package in its own PR:
  - **Repos registry:** metadata, reconcile, invitations, survey, `merge-back-data` and `rename-tracked-repo`.
  - **Cross-repo dispatch.**
  - **Status-truth.**
  - **CI checks:** mutation guards and Renovate checks.
  - **Privacy:** the privacy and private-leak checks and the shared redaction helpers. The wiki-authority predicates go to core.
  - **Wiki operations,** built on `@fro.bot/wiki-write-core`.
  - **Knowledge:** learnings, patterns and drafted-solutions.
  - **Reports:** daily digest, improvement metrics and gateway announce.

  The release and build scripts for `@fro.bot/wiki-write-core` stay in `scripts/`.

- R5. When a module of 2k lines or more moves into a package, it is split into focused modules as part of that move. `reconcile-repos.ts` is one such module.
- R6. Each package has a README covering its purpose, public API, CLI commands and how to test it.

**CLIs**

- R7. Each domain package exposes its commands through a goke CLI with schema-typed options, and goke parses argv for every migrated command. Each command declares whether it is read-only or writes, so phase 2 can choose which commands to expose as MCP tools without re-annotating them.
- R8. Existing CLI contracts don't change. The contract covers:
  - flags and env inputs;
  - stdout text and JSON shapes;
  - the stderr line prefixes that workflows parse (`wiki-ingest:warning:`, `wiki-ingest:finding:` and `corrections:warning:`);
  - `$GITHUB_OUTPUT` keys;
  - exit codes, including parse errors and `--help`.

  Workflows and agent prompts keep calling `scripts/<name>.ts`, which delegates to its package.

**Parity and gates**

- R9. Each PR preserves behavior. Before the change, record the Vitest test count on the parent commit with one fixed command, and put it in the PR body. List any moved, added or removed tests. Mutation coverage follows the code:
  - A module that is mutated today stays mutated after it moves or splits, including each split part.
  - Every new package source module appears either in the Stryker `mutate` list or in `mutation-guards.json` as not-mutated, with a reason.
  - `bun run check:mutation-guards` still passes at 100% kills.
- R10. Each gate that covers a script today still covers its code after the move. The gates are:
  - Test Scripts Load, the Node strip-only import check;
  - type checks and lint;
  - the mutation-guard triggers, which follow `@fro-bot/` package imports, so a package-only change still runs Stryker for the scripts that depend on it;
  - the `verify:` markers in `docs/solutions/`;
  - the private-leak scan.
- R11. The runtime rules carry over. Bun runs the CLIs, and the documented Node exceptions keep working. New code adds no `process.exit` on a success path. The existing exits in `record-survey-result.ts` and `enumerate-existing-leaks.ts` keep their exit codes under R8.
- R12. Security boundaries don't move. The following keep their isolation and their fail-closed behavior:
  - code that writes to `data`;
  - the privacy gates;
  - the agent handoff trust check;
  - App-token consumers.

  A package move never puts that code in a job that runs an agent step.

- R13. Phase 1 changes no path under `packages/wiki-write-core/`, because any commit there becomes a release candidate. The three one-line re-export scripts may be deleted once their importers import `@fro.bot/wiki-write-core` directly. The four CLI entrypoint wrappers stay.

**Phase 2 preparation**

- R14. A fro-bot/agent feature request for caller-provided MCP servers in agent runs is drafted now. It is filed after operator approval, so the upstream work can run while phase 1 proceeds. Phase 2 MCP work starts only once fro-bot/agent supports caller MCP servers. Until then, agent runs call the package CLIs through bash, as `wiki-context-expand.ts` does today.

---

## Acceptance Examples

- AE1. **Covers R8.** Given a workflow step runs `bun scripts/reconcile-repos.ts` both before and after the registry package lands, the stdout, stderr prefixes, `$GITHUB_OUTPUT` keys and exit code are identical for the same inputs.
- AE2. **Covers R9, R10.** Given `scripts/check-wiki-authority.ts` moves into the core package, all three of these hold:
  - Stryker still mutates its logic at 100%.
  - Test Scripts Load still loads it under Node.
  - Its `verify:` marker still resolves, and `bun run lint` passes.
- AE3. **Covers R2.** Given the PR that migrates a primitive merges, no non-test module under `scripts/` or a `@fro-bot/` package keeps its own copy of that primitive.
- AE4. **Covers R13.** Given a phase 1 PR, `git diff --stat` shows no path under `packages/wiki-write-core/`. The release decide job therefore counts zero commits for that path since the last tag.
- AE5. **Covers R12.** Given the private-leak scan moves into a package, both of its invocations still run on Node and fail closed when their inputs are missing:
  - the standalone job in `check-private-leak.yaml`;
  - the promotion step in `merge-data.yaml`.
- AE6. **Covers R10.** Given a PR that changes only a `@fro-bot/` core source file used by a mutated script, `bun run check:mutation-guards` runs Stryker for that script. It does not report not-applicable.

---

## Success Criteria

- Each primitive listed in R2 has one definition outside `@fro.bot/wiki-write-core`.
- A new script needs no copied plumbing. It imports core and its tests import the test kit.
- Every workflow behaves the same before and after each PR. No workflow or agent prompt needs an edit in phase 1.
- A contributor can learn what a command does, and where its logic lives, from the package READMEs, without reading a 4k-line file.
- In phase 2, a workflow `run:` block can be replaced with one CLI call, without new library code.

---

## Scope Boundaries

- **Phase 2 work is excluded.** This covers three things:
  - replacing inline workflow shell with CLI calls;
  - exposing commands as MCP tools;
  - calling package CLIs directly from workflows.

  The duplicated workflow YAML stays as it is through phase 1. That includes the 17 copies of the `data` metadata overlay across 11 workflow files.

- **Behavior fixes found during research go in separate PRs.** Two examples:
  - `apply-branding.yaml` substitutes the tagline into `sed` unescaped;
  - `manage-issues.yaml` hides close failures with `|| true`.
- **No package is published,** and no package moves to another repo.
- **`@fro.bot/wiki-write-core` keeps its own internal copies** of the shared helpers.

---

## Key Decisions

- **Unpublished `@fro-bot/` packages.** This follows the convention in fro-bot/agent and the other fro-bot repos: `@fro-bot/` is the scope for private workspace packages, and `@fro.bot/` is the scope for packages published to npm.
- **Core first, with the risky primitives in their own PRs.** The first core PR migrates the mechanical primitives: type guards, output and summary writers, and JSON output. Retry and the GitHub client each get their own PR with parity tests, because their behavior varies across scripts today. After that, each domain package gets its own PR. Smaller PRs are easier to review and revert than one 40k-line move.
- **goke now, `@goke/mcp` in phase 2.** goke 6.17.0 has no runtime dependencies. marcusrbrown/infra already uses it for a CLI that also serves an allowlisted, read-only MCP command, so the same command definitions can carry over to phase 2.
- **`scripts/` stays as the entrypoint layer in phase 1.** Workflows, agent prompts and docs keep their current paths. Phase 2 decides when a workflow calls a package CLI directly.
- **`@fro.bot/wiki-write-core` doesn't depend on private packages.** A published package can't import an unpublished one, so it keeps its own helper copies. The dedup covers `scripts/` and the new packages only.
- **Release and build scripts stay in `scripts/`.** The publish job deliberately runs no repo code, so the release tooling stays separate from the packages.

---

## Dependencies / Assumptions

- Adding `goke` is an approved dependency change, along with a schema library for its options if one is needed. Both go through the 3-day release-age floor and the override-floor audit.
- Bun workspaces already link `packages/*`, since `@fro.bot/wiki-write-core` resolves through them today.
- goke's parse-error, `--help` and exit behavior has not been checked against R8 and R11 yet.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] The order of the domain packages after core, and the exact module boundaries inside each package.
- [Affects R1, R10][Needs research] Whether `@fro-bot/` packages export `.ts` source or built output. A probe should confirm that Node 24 strip-only can load a workspace-linked source file, because Test Scripts Load and the private-leak scan both depend on it.
- [Affects R10][Technical] How each `verify:` marker survives a move. The resolver in `scripts/check-solutions-examples.ts` matches only top-level declarations in the named file. Options:
  - rewrite the marker path to the package file;
  - keep the declaration in the `scripts/` entrypoint;
  - teach the resolver to follow re-exports.
- [Affects R10][Technical] How the trigger closure and the hard-coded package paths in `scripts/check-mutation-guards.ts` learn `@fro-bot/` packages. The same question applies to the Stryker `mutate` and `testFiles` lists.
- [Affects R7, R8][Needs research] Which schema library goke uses here, given that zod is not a direct dependency today. Also probe goke's parse-error and exit behavior with a stub CLI under Bun.
- [Affects R4][Technical] Where `check-wiki-authority.ts` lives. `check-mutation-guards.ts` and `merge-back-data.ts` both import it today.
- [Affects R14][Needs research] Confirm the request's scope. fro-bot/agent has no issue for this. At `v0.125.3`, the `opencode-config` input is merged shallowly, so an `mcp` key reaches OpenCode. Nothing in the harness defines how a caller's MCP server starts, what working directory and env it gets, how credentials and tool permissions apply to it, or how it is tested.

---

## Sources / Research

- `scripts/` and `packages/wiki-write-core/`: the current module layout, the wrappers, and the helpers the package already provides.
- The gates and the release trigger that any move has to respect:
  - `.github/workflows/main.yaml` (Test Scripts Load)
  - `stryker.config.json`
  - `scripts/check-mutation-guards.ts`
  - `scripts/mutation-guards-config.test.ts`
  - `scripts/check-solutions-examples.ts`
  - `.github/workflows/release-wiki-write-core.yaml`
- `docs/plans/2026-10-18-001-feat-publish-wiki-write-core-plan.md`: the published package's release and `dist` constraints.
- `docs/plans/2026-10-20-001-fix-keep-data-branch-present-plan.md`: why `merge-back-data.ts` stays control-plane code and is not part of the published package.
- The strip-only, mutation-reach and shared-invariant rules:
  - `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md`
  - `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`
  - `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`
- marcusrbrown/infra `packages/cli/`: the goke CLI command groups, the `mcp` command with an explicit allowlist, and the convention tests that pin it.
