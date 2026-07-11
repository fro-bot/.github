---
title: Verify in the CI topology, not just locally
date: 2026-07-11
category: best-practices
module: wiki-site
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - "a claim like 'the script resolves its dependency from a foreign cwd' is verified on a developer machine"
  - "the runtime environment (CI job) populates different dependency trees than the dev environment"
  - "module resolution, PATH lookup, or file discovery depends on which directories exist along a search path"
  - "a workflow job deliberately skips the repo bootstrap and installs deps only in a scratch directory"
related_components:
  - development_workflow
  - tooling
tags:
  - false-positive-verification
  - ci-topology
  - module-resolution
  - node-modules
  - createrequire
  - environment-divergence
---

# Verify in the CI topology, not just locally

## Context

While extracting the wiki publish workflow's inline lockfile gates into a tested module (PR #3685), the module's CLI parsed YAML via a bare `await import('yaml')`. I "verified" the concern that mattered — does the import resolve when the script is invoked from a foreign working directory? — by running the script from a `/tmp` directory locally. It passed, and I shipped the claim "Node resolves from the script's own location, not cwd" in the PR description.

The claim was true. The verification was still a false positive. Node resolves bare specifiers by walking **up from the script's location** — `scripts/` → repo-root `node_modules` — and on my machine that tree existed because `pnpm bootstrap` had run. In the publish workflow's build job it never exists: that job deliberately skips the repo setup action and runs `npm ci` only inside a scratch `quartz-build/` directory. The import would have thrown on every publish, killing the supply-chain gate at startup. Review caught it before merge.

## Guidance

A verification only proves a claim for environments that share the **topology** the claim depends on. For module resolution, that topology is "which dependency trees exist along the search path" — not "which directory I ran from."

Before trusting a local check of environment-sensitive behavior:

1. **Name the variable the behavior actually depends on.** "Foreign cwd" was the wrong variable; "which `node_modules` trees exist on the walk-up path" was the right one. A verification that varies the wrong variable proves nothing.
2. **Enumerate what the CI job actually populates.** Read the workflow: which setup steps run, which directories get installs. A job that skips bootstrap has no repo-root `node_modules`, no matter what your machine has.
3. **Reproduce the CI topology in a test, including the negative case.** The fix here added a fixture shaped like the CI job — the dependency present *only* in a sibling `quartz-build/node_modules` — plus the negative: no reachable dependency ⇒ the documented failure exit. The negative case is what makes the test meaningful; it fails if resolution quietly falls back to a tree that CI won't have. Fixtures under `/tmp` are outside the repo tree, so the walk-up can never reach repo-root `node_modules` — that isolation is what makes the fixture honest.
4. **When the runtime should resolve from its working directory, say so in code.** `createRequire(join(cwd, 'some-anchor-file'))` roots resolution explicitly instead of inheriting whatever the script's location happens to see:

```ts
// Resolves 'yaml' from the WORKING directory's node_modules (the CI job's
// quartz-build/), not from the script's own location (repo root — empty in CI).
const requireFromCwd = createRequire(join(cwd, 'quartz.config.yaml'))
const YAML = requireFromCwd('yaml') as typeof import('yaml')
```

## Why This Matters

Environment-sensitive false positives are worse than missing tests: they produce *confidently wrong* claims that survive review unless someone re-derives the resolution semantics. Here the broken gate would have failed loud (fail-closed), but the failure mode was "every publish breaks at the coverage gate" — a supply-chain control regressing into an outage. The class generalizes beyond Node resolution: PATH lookups, config-file discovery, git metadata presence (shallow vs full clone), and LFS materialization all differ between a dev machine and a CI job, and all can validate a false claim locally.

## When to Apply

- Any claim of the form "X resolves / is found / is present" verified outside the environment that matters.
- Workflow jobs that intentionally minimize their environment (least-privilege builds, scratch-directory installs) — minimization is exactly what makes dev-machine verification unrepresentative.
- Reviewing a PR whose description says "verified locally" for behavior that depends on installed trees, clone depth, or filesystem case-sensitivity.

## Examples

Before — the false-positive verification:

```bash
# Passes on a dev machine: /tmp cwd, but the script's own walk-up path
# still reaches the repo's populated node_modules. Proves nothing about CI.
cd /tmp/cwd-test && node "$REPO/scripts/wiki-lockfile-gates.ts" coverage
```

After — the CI-shaped test:

```ts
// Fixture: <tmp>/quartz-build with its own node_modules/yaml — the ONLY
// yaml on any reachable path. Passes only if resolution roots at cwd.
const dir = await makeFixture({yamlIn: 'quartz-build/node_modules'})
expect(runCli(['coverage'], dir).exitCode).toBe(0)

// Negative: no yaml reachable from the fixture ⇒ documented failure exit.
const bare = await makeFixture({yamlIn: null})
expect(runCli(['coverage'], bare).exitCode).toBe(2)
```

## Related

- [Test the integration seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — sibling class: there the seam was never exercised at all; here the verification *ran* but under the wrong topology.
- [Immutable history keys for trend recompute](immutable-history-keys-for-trend-recompute-2026-07-10.md) — CI topology divergence via clone depth (shallow clones lack the git history a dev machine has).
- [Node strip-only TypeScript constraints](../runtime-errors/node-strip-only-typescript-2026-04-18.md) — the "local guardrails lied about the production shape" family.
