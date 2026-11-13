---
title: An import closure does not see what a test reads at run time
date: 2026-11-14
category: best-practices
module: packages/ci-checks/src/check-mutation-guards.ts
problem_type: design_pattern
component: testing_framework
severity: high
applies_when:
  - a gate decides whether to run from the files a change touches
  - the set of files that matter is built by following imports
  - a test reads a repository file by path, or loads modules by a computed path
  - a guard is a list that someone must keep current
tags:
  - mutation-gate
  - trigger-set
  - import-closure
  - runtime-reads
  - pinned-list
  - fail-open
  - mutation-testing
  - stryker
---

# An import closure does not see what a test reads at run time

## Context

The PR mutation gate runs Stryker only when a changed file is in its trigger set: the `mutate` and `testFiles` entries, their import closure and a list of fixed files (`packages/ci-checks/src/check-mutation-guards.ts:1644-1655`, `buildTriggerSet`). The closure follows literal import specifiers. A listed test that reads a repository file, or imports modules by a computed path, depends on files the closure never reaches, and a PR that changed only one of them read `not-applicable` ([#4218](https://github.com/fro-bot/.github/pull/4218)).

A trace of every `fs` read of the listed tests found nine files outside the set, and `knowledge-mcp.test.ts` imports every `packages/*/src/*-cli.ts` by a path built at run time (`packages/wiki-ops/src/knowledge-mcp.test.ts:144-154`). Replayed against the 171 pull requests merged from 2026-10-13 to 2026-11-13, 5 of the 89 `not-applicable` ones would now run (`docs/ideation/2026-11-07-open-ideation.md:32`). Five of them are [#4056](https://github.com/fro-bot/.github/pull/4056) (`quartz-site/quartz.config.yaml`), [#4160](https://github.com/fro-bot/.github/pull/4160) and [#4171](https://github.com/fro-bot/.github/pull/4171) (`.github/settings.yml`), [#4146](https://github.com/fro-bot/.github/pull/4146) (`packages/status-truth/src/rollout-tracker-snapshot.ts`) and [#4197](https://github.com/fro-bot/.github/pull/4197) (`packages/registry/src/reconcile-effects.ts` and `reconcile-handler.ts`). In each, the only changed files that are trigger files under the new set are the ones named, and none was a trigger file before. The last two are modules a package CLI imports, so seeding the closure from the CLI modules is what adds them.

## Guidance

1. **Find what the listed tests read with a trace, not a scan of imports.** The pinned list came from a preload loaded through `NODE_OPTIONS=--require` that wraps the `fs` and `fs/promises` read functions and logs each path under the checkout with its first test-file frame (`packages/ci-checks/src/mutation-guards-config.test.ts:446-459`). A path built at run time appears in no import.
2. **Add a file to the trigger set when its content can change an assertion, and leave it out when it cannot.** `knowledge/` and `metadata/repos.yaml` are read, and no assertion depends on their content, so a data promotion stays `not-applicable` (`check-mutation-guards.ts:1517-1518`; `mutation-guards-config.test.ts:561-574` pins the exclusions).
3. **For a directory read through a computed path, seed the closure from the directory and add a pattern for the next file.** `listPackageCliModules` (`check-mutation-guards.ts:1586-1596`) returns every existing `*-cli.ts` as a seed for `buildImportClosure`, and `PACKAGE_CLI_PATTERN` (`:1574`) matches one that does not exist yet.
4. **Over-run when the exact answer needs a list nobody will keep.** 33 CLIs reach 49 modules outside the set and none feeds the commands the test asserts on. Seeding is wider than the assertions need, because a check for that would need a 49-entry allowlist (`check-mutation-guards.ts:1565-1572`).
5. **Pin each runtime read to its reader and fail when the pin goes stale.** Each `RUNTIME_READ_TRIGGERS` entry names `path`, `reader`, `marker` and `onDisk` (`mutation-guards-config.test.ts:460-535`). The guard fails when the reader leaves `testFiles`, stops containing the marker, or the file's presence differs from `onDisk` (`:552-559`).
6. **Say that a pinned list is a pinned list, in the code, the test and the README.** `mutation-guards-config.test.ts:449-450` reads "THIS IS A PINNED LIST, NOT A DETECTOR", and `packages/ci-checks/README.md:15` says a test that starts reading another file needs an entry there and in `FIXED_TRIGGER_FILES`. Without the statement a reader takes the guard for coverage it does not give.
7. **Replay the change against merged history and record the range and the counts.** The replay found no PR that ran under the old set and would be skipped under the new one, and it shows the cost: five more runs over 171 PRs.

## Why This Matters

A trigger set that follows imports fails open: a PR that changes a settings file a test reads goes unchecked, and the gate reports `not-applicable`. The fix costs a few extra Stryker runs, and rule 2 keeps a `knowledge/` and `metadata/` promotion `not-applicable`. A pinned list cannot find the next read. It can only keep the known reads from lapsing, so the limit belongs in the place a maintainer reads before adding a test.

## When to Apply

- A gate, cache key or selector decides from "what changed" and builds its dependency set statically.
- A test reads a file with `readFileSync`, `readdirSync` or a template-literal `import()`.
- A guard lists files by hand: pin each entry to the code that needs it.

## Examples

The CLI pattern and the check that a pinned file is a trigger:

```ts
const PACKAGE_CLI_PATTERN = /^packages\/[^/]+\/src\/[^/]+-cli\.ts$/u
```

<!-- verify: buildTriggerSet from packages/ci-checks/src/check-mutation-guards.ts -->
<!-- verify: changedFilesIntersectTriggerSet from packages/ci-checks/src/check-mutation-guards.ts -->
```ts
function runsStryker(config: StrykerConfigShape, changed: readonly string[]): boolean {
  const triggerSet = buildTriggerSet(config)
  return changedFilesIntersectTriggerSet(changed, triggerSet)
}
```

One pin, as `mutation-guards-config.test.ts:466-471` records it:

```ts
const pin = {
  path: 'common-settings.yaml',
  reader: 'packages/registry/src/protection-drift.test.ts',
  marker: 'common-settings.yaml',
  onDisk: true,
}
```

## Related

- [A mutation score can measure nothing](a-mutation-score-can-measure-nothing-2026-09-08.md): the reachability side of the same gate.
- [Read the test before crediting a requirement to it](read-the-test-before-crediting-a-requirement-to-it-2026-11-14.md): a static proxy (an import closure here, a test title there) is not the thing it stands for.
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): an existing or empty file as evidence of a start, and what that evidence does and does not prove.
- [Moving a script into a workspace package changes its contract](moving-a-script-into-a-workspace-package-changes-its-contract-2026-11-05.md): `FIXED_TRIGGER_FILES` entries for moved files.
- Pull request [#4218](https://github.com/fro-bot/.github/pull/4218) and the ideation item `docs/ideation/2026-11-07-open-ideation.md:32`.
