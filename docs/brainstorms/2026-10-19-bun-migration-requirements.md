---
date: 2026-10-19
topic: bun-migration
---

# Migrate fro-bot/.github from pnpm to Bun

## Summary

fro-bot/.github moves from pnpm to Bun. Bun takes over installs, the lockfile and script dispatch, and becomes the runtime for the repo's scripts, Vitest and Stryker. Every tool install the repo runs, including the Renovate config gate, the release tools and the publish job, gets the same 3-day release-age protection. Each tool must pass on Bun before it switches. Where a tool cannot, it keeps a named Node exception.

---

## Problem Frame

agent, dashboard and space-bus already use Bun. This repo is the control center for those repos and still runs pnpm, with Node 24 executing its TypeScript. Contributors and agents therefore work with two sets of commands, two setup actions and two lockfile workflows.

The pnpm setup also has a gap that surfaced on 2026-10-19. The Renovate config gate and the release tools are installed with `npm install --prefix`, with no lockfile and no release-age check, so npm resolves the full transitive tree from the live registry on every run. `@aws-sdk/credential-provider-node@3.972.87` was published at 18:47:51Z and required `@aws-sdk/credential-provider-http@^3.972.77`, which only appeared at 18:53:07Z. The gate's install ran inside that window and failed with ETARGET, which turned the required "Check Workflows" job red on an unrelated PR. Nothing required npm there. It breaks the repo's single-package-manager rule and skips the 1-day release age that pnpm 11 applies to the main install by default.

---

## Requirements

**Package management**
- R1. Bun replaces pnpm for installing dependencies, managing the lockfile, and running package scripts. `packageManager` and `mise.toml` pin the same Bun version, the same way they pin pnpm today. The pnpm pins are removed.
- R2. Every security floor and pinned range enforced today stays enforced. That covers the `ajv@8` pin and the floors on `brace-expansion`, `fast-uri`, `flatted`, `minimatch`, `nanoid`, `picomatch`, `postcss`, `qs`, `source-map-js`, `undici`, `vite` and `yaml`. Overrides, the trusted build list and the workspace globs live only in the root `package.json`, the one place Bun reads them. The pnpm copies are removed.
- R3. Native builds run only for an explicit allowlist, and every package allowed to build today stays allowed.
- R4. Installs reject package versions younger than 3 days. This tightens pnpm 11's 1-day default to match agent and dashboard. The exemptions are `@bfra.me/eslint-config`, `@bfra.me/prettier-config` and `@bfra.me/tsconfig`, by exact name. Bun matches names only, so each exemption covers every version of that package.
- R5. Installs use a hoisted dependency layout. The repo relies on hoisting today (`shamefullyHoist`), and agent's isolated layout broke type-checking.
- R6. The `packages/wiki-write-core` workspace keeps working. That covers local linking, its build, and the dist check that fails on drift.

**Runtime**
- R7. Bun is the runtime for every repo script that workflows, package scripts and agent prompts invoke.
- R8. Vitest and Stryker run under Bun, unless R9 keeps a tool on Node. The required mutation gate keeps its fail-closed verdict contract. Its trigger list watches `bun.lock` in place of `pnpm-lock.yaml`.
- R9. A tool switches to Bun only after its required checks pass on Bun. Required checks are the branch-protection contexts in `.github/settings.yml`, plus the lint, check-types, test and mutation-guard scripts. A tool that cannot pass stays on Node 24, and the guidance names the exception and the reason.

**Gates and tooling**
- R10. The override-floor gate runs on `bun audit` and stays fail-closed. Bun's audit reports only advisories against installed versions, so the gate fails on any reported advisory at or above `high` and on any unknown severity. It also fails on audit output it cannot parse.
- R11. The Renovate config gate install and the release-tools install move off npm onto Bun, with the 3-day floor set explicitly. The Renovate install still builds the RE2 native binding and asserts that the regex engine is RE2. The publish job's semantic-release install stays on npm, with npm's own 3-day `min-release-age`, as a named exception.
- R12. The publish job restores no dependency cache, as today.
- R13. Renovate keeps `bun.lock` current on dependency updates. It does not propose npm package versions younger than the install release age, and that includes security updates.
- R14. When a security fix cannot wait 3 days, the operator adds a temporary exact-name exemption with a stated reason, then removes it after the window.
- R15. CI installs Bun through a shared setup path that uses a SHA-pinned setup action and a frozen install. No job restores a dependency cache or a cached Bun binary, because Bun does not re-verify cached packages against `bun.lock`. The private-leak workflow keeps its own install with scripts disabled, as a named exception.

**Publishing and policy**
- R16. Publishing `@fro.bot/wiki-write-core` keeps npm trusted publishing (OIDC) with provenance. If Bun cannot publish with provenance, Node and `npm publish` stay in the publish job as a named exception.
- R17. Guidance names Bun as the only package manager and runtime and lists every exception. The exceptions are:
  - `npm publish`, the publish job's npm install and `npm pack` in the package test, under R11 and R16
  - the Quartz site build
  - the private-leak scan, "Test Scripts Load" and the `coverage` script, which stay on Node
  - an npm build step for re2, if Bun cannot run it
  - any Node fallback under R9

  Guidance here means:
  - the copilot instructions, the README, and `llms.txt`
  - the repo-scoped skills in `.agents/skills/`
  - the agent prompts in workflows, including the `fro-bot.yaml` text that names `pnpm-workspace.yaml`
  - the Copilot setup steps and `mise.toml`
  - the `mutation-guards.json` reasons and `.prettierignore`
- R18. The Quartz site build in `publish-wiki.yaml` stays on npm, with Quartz's own upstream lockfile, as a named exception.

---

## Acceptance Examples

- AE1. **Covers R4, R11.** A transitive dependency was published 5 minutes ago. When the Renovate config gate installs its tools, the install resolves an older version that satisfies the range, or fails before validation. It never hits the registry gap that caused ETARGET.
- AE3. **Covers R9, R8.** Stryker's Vitest runner does not complete under Bun. Stryker keeps running on Node 24, the mutation gate verdict is unchanged, and the guidance names the Node exception and the reason.
- AE5. **Covers R10, R2.** One floor is deleted from `package.json` and the lockfile is regenerated. If a vulnerable version is now installed, the audit reports it and the gate fails. If the lockfile still resolves a patched version, the audit is clean and the gate passes, which is correct. Deleting a floor without regenerating the lockfile fails the frozen install.
- AE6. **Covers R13, R14.** A security fix for a floored package ships today. Renovate opens the PR once the version is 3 days old. If the fix cannot wait, the operator adds an exact-name exemption with a reason and removes it after the window.

---

## Success Criteria

- Every required check passes on its assigned runtime. Each check runs on Bun, or on Node under an exception named in the guidance.
- No required check runs on Node except the named exceptions in R17.
- A fresh contributor or agent can bootstrap, lint, type-check, test and run the mutation gate with Bun commands. The only exceptions are the documented Node ones.
- No tool install can resolve a package version younger than the 3-day release age, unless an exemption from R4 or R14 applies.
- `ce:plan` can sequence the work without deciding scope, the runtime policy, the gate's fail-closed rules or the exemption policy.

---

## Scope Boundaries

- The shared Renovate preset (`default.json`) keeps its behavior for the repos that consume it. Its existing `minimumReleaseAge: null` rules for first-party packages are unchanged. Bun-specific Renovate settings go only in this repo's own config.
- Tests stay on Vitest. There is no rewrite to `bun:test`.
- semantic-release stays as the release engine for `@fro.bot/wiki-write-core`.
- Historical solution docs that describe pnpm stay as history. Only the guidance listed in R17 changes.
- No changes to other repos.
- Parity with pnpm only. The migration adds no gates, tests or checks beyond what the pnpm setup has today. Existing tests and gates are updated so they keep their current meaning on Bun.

---

## Key Decisions

- **Bun is the runtime everywhere, not only the package manager.** agent runs most scripts through `bun run` and keeps Node for a few checks. dashboard keeps Node for its server and CI guards. space-bus is the only sibling that uses Bun as the runtime, including `bun test`. This repo goes further than agent and dashboard, at the cost of touching more required checks.
- **Vitest stays and runs under Bun.** This keeps 109 test files and the `@stryker-mutator/vitest-runner` mutation gate. A move to `bun:test` would rewrite 1,288 `vi.*` calls and 11 module-mocking files, and Stryker has no official `bun:test` runner.
- **Prove each tool before switching it.** Bun's compatibility with Vitest, Stryker and these scripts is unconfirmed on Bun 1.4.3.
- **The override-floor gate stays.** agent and dashboard have no audit gate. This one caught real floor drift in October 2026.
- **The release age is 3 days, and security PRs wait it out too.** This matches agent's `vulnerabilityAlerts` setting. Urgent fixes get a temporary exact-name exemption instead of a blanket bypass.
- **First-party exemptions apply by name.** Bun cannot pin an exemption to a version. The three `@bfra.me` packages are published by the same owner, so the age gate buys nothing there and would only block Renovate's own update PRs.
- **Bun is installed with `oven-sh/setup-bun`, reading `packageManager`.** This matches agent and dashboard with a single pin, and avoids agent's mismatch between its action default and its `packageManager` value. mise keeps Node, for the exceptions, and python.
- **No CI caches.** Bun trusts its install cache even with `--frozen-lockfile`, and a cold install of this repo takes about 5 seconds. Dropping the dependency cache and the cached Bun binary removes the cache-poisoning path in every job, not only in the private-leak and publish jobs.
- **The private-leak job keeps a separate install with scripts disabled.** It runs on PR-derived data and does not use the shared setup action.
- **`npm publish` stays in the release job** unless Bun is shown to support trusted publishing with provenance.
- **Quartz stays on npm.** It is an upstream project with its own lockfile, and converting it adds nothing.
- **npm's own release-age setting is used only in the publish job.** That job already keeps npm for trusted publishing, so its tool install stays on npm with `min-release-age` instead of adding Bun to the job that holds `id-token: write`.

---

## Dependencies / Assumptions

- Bun 1.4.3 is the latest stable release as of 2026-10-10. agent and dashboard pin it in `packageManager`.
- Bun's `minimumReleaseAge` is in seconds and off by default. Its exemption list matches exact names only. Whether it covers transitive dependencies is unconfirmed, and so is whether it applies to installs outside the repo directory through a flag or local config.
- `bun audit` exists, since 1.3.4. Its docs describe exit code 1 when advisories remain and an `--ignore` option. The JSON shape is unconfirmed.
- Bun reads `overrides` only from the root `package.json`, not from workspace packages.
- pnpm 11's `minimumReleaseAge` defaults to 1 day, and this repo sets no override.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8, R9][Needs research] Do Vitest and `@stryker-mutator/vitest-runner` run under Bun 1.4.3? This includes the Stryker sandbox, `vi.hoisted` module mocks and fake timers.
- [Affects R10][Needs research] Does the JSON from `bun audit --json` on Bun 1.4.3 carry what the gate needs: package name, severity, vulnerable range and patched versions?
- [Affects R11][Technical] How does each install outside the repo receive the age floor and prove that it applied? How do the scripts locate Renovate internals and semantic-release plugins after a Bun install?
- [Affects R4, R13][Needs research] When every version that satisfies an override is younger than the floor, does Bun fail or fall back? The gate checks ranges, not installed versions.
- [Affects R16][Needs research] Does `bun publish` support npm OIDC trusted publishing with provenance, or does `@semantic-release/npm` keep calling `npm publish`?
- [Affects R7][Technical] Do the scripts' `import.meta.main` entry guards, `createRequire` calls and the strip-only module-load check behave the same under Bun?
- [Affects R11, R15][Technical] Can the incident fix (moving the tool installs to Bun with the age floor) ship ahead of the runtime switch? The constraints are one open PR at a time and each switch revertible on its own.

---

## Sources / Research

- **agent:**
  - `bunfig.toml`: hoisted linker, `minimumReleaseAge = 259200`, four `@bfra.me` exemptions by exact name, and a comment that Bun has no glob support.
  - `package.json`: `packageManager: bun@1.4.3`, `overrides`, `trustedDependencies`.
  - The shared setup action, with SHA-pinned `oven-sh/setup-bun` and a cache keyed on `bun.lock`.
  - `.github/renovate.json5`: `vulnerabilityAlerts.minimumReleaseAge: "3 days"`, and `postUpgradeTasks` that regenerate `bun.lock`.
- **dashboard:** `bunfig.toml` (three `@bfra.me` exemptions by exact name, with a note that Bun ignores `name@version`). It runs Vitest under Node.
- **space-bus:** `bun test` and `bun run` entry points. Release uses Node and npm for OIDC publishing.
- **This repo's pnpm surface:**
  - `package.json` scripts and `packageManager`.
  - `pnpm-workspace.yaml`: overrides, build allowlists, workspace globs, `shamefullyHoist`, and a single `@bfra.me/eslint-config@0.54.0` release-age exemption.
  - `mise.toml`: node, pnpm and python pins.
  - `.github/actions/setup/action.yaml`, used by 21 workflows.
  - 76 `node scripts/` call sites across 20 workflow files.
  - `scripts/check-override-floors.ts`, which runs `pnpm audit --json` and skips non-string override values.
  - `scripts/check-mutation-guards.ts`, which runs `pnpm exec stryker` and has `pnpm-lock.yaml` in its trigger list.
  - `scripts/build-wiki-write-core.ts`, which runs `pnpm exec tsc`.
  - `scripts/renovate-runtime.ts` and `scripts/install-renovate.ts`, the Renovate gate install with its RE2 build.
  - `scripts/wiki-write-core-release.ts` and the inline install in the publish job of `release-wiki-write-core.yaml`.
  - `check-private-leak.yaml`, the cache-free install.
  - `publish-wiki.yaml`, the Quartz npm build.
  - `.github/renovate.json5` `postUpgradeTasks`.
- **The triggering failure:** Main run 39305952489, job 118242962583 ("Check Workflows"), step "Validate Renovate Config". npm registry publish times: `@aws-sdk/credential-provider-node@3.972.87` at 18:47:51Z, `@aws-sdk/credential-provider-http@3.972.77` at 18:53:07Z.
