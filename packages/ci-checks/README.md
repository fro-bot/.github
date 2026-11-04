# `@fro-bot/ci-checks`

The repository checks of the Fro Bot control plane: the mutation gate, the markdown, advisory and `docs/solutions` lints, and the Renovate tooling. Every CLI here runs in pull-request CI (`check:mutation-guards`, `check:renovate-config`, `check:override-floors`, `check:md-links`, `check:solutions-examples`), so a pull request is its own proof that they run. The package is private (`"private": true`), is never published, and exports `.ts` source with no build step, so Bun, Node strip-only loading, `tsc` and Vitest all load it as written.

It depends on `@fro-bot/core` (guards, retry, the goke runner and the pull-request event reader of `wiki-authority`), `@fro.bot/wiki-write-core` (`markdown-links`), `typescript` and `yaml`. It imports no domain package. Tests also import `@fro-bot/test-kit`.

## The gate and where it lives

`check-mutation-guards` resolves everything it reads from one place, `findRepositoryRoot()` in `repository-root.ts`: three levels above `packages/ci-checks/src`. `stryker.config.json`, the report path that config names, the files the trigger set enumerates, the manifests of every package and the Stryker spawn's working directory all come from it. The root is a function, not a constant, so a test exercises every mutant of the path. A root one level short (`packages/ci-checks`) would find no `stryker.config.json`, and the gate fails closed: reading the config throws, the CLI prints the message and exits 1.

The gate fails closed in these ways, each pinned by a test:

- **No config.** A missing, unparseable or ill-shaped `stryker.config.json` throws before anything runs, exit 1. A listed `mutate` file that is missing, a `reporters` list without `json`, and a `jsonReporter.fileName` that is not the report path the gate reads are `instrumentation-failed`.
- **No event, no list.** On a `pull_request`, an unreadable event, a missing `base.repo.full_name` or a failing `gh api` is `instrumentation-failed`, never `not-applicable`.
- **A closed trigger set.** A changed file is a trigger when it is a `mutate` or `testFiles` entry, is in the import closure of one (relative imports, `@fro.bot/wiki-write-core` subpaths and `@fro-bot/<pkg>` names through each package's `exports` map), is a fixed infrastructure file, or is a package manifest. The fixed files include the gate itself: the `scripts/check-mutation-guards.ts` entrypoint, `check-mutation-guards.ts`, `check-mutation-guards-cli.ts`, `repository-root.ts` and `mutation-guards-config.test.ts`. A docs-only change is `not-applicable`; a change to `packages/core/src/guards.ts` is applicable.
- **A guard that runs.** `scripts/check-mutation-guards.ts` uses `import.meta.main`, not the `file://${process.argv[1]}` comparison of the other entrypoints: a path the URL form escapes would make that comparison false, and the gate would end in exit 0 without running.
- **The report is cleared first.** A Stryker that dies before writing leaves no stale `clean` behind.

`mutation-guards-config.test.ts` enumerates `packages/*/src` and the `scripts/` entrypoints against `stryker.config.json` and `mutation-guards.json`, so a module nobody classified fails the build. Deleting `mutation-guards.json` fails that test; deleting `stryker.config.json` fails the gate.

## Regexes and scans

Everything in this package that reads text a pull request controls is linear in that text, and `src/regex-scaling.test.ts` times it: the source of a `mutate` or `testFiles` entry and of every file it imports (the import-closure scans and the directive scanner), the barrel check, and the markdown of `docs/solutions` (comment, fence and `verify:` marker scans) and of the repository. Four scans were not, and are rewritten to give exactly the output they gave before, held to it by a seeded differential in `src/superlinear-differential.test.ts` and `src/inline-literal-interpolations.test.ts`:

- the template-literal lookup `${'...'}` (exponential on a run of backslashes) is `inlineLiteralInterpolations`;
- the `vi.mock<...>(` type-argument introducer (a rescan to the same `>` from every `<`) is `markVitestTypeArguments`;
- the brace forms of the barrel export pattern (a rescan to the same `}`) are `stripBarrelExports`;
- the HTML comment scan of a solution document (a rescan to the end of the document from every unclosed `<!--`, and a line count from the start for every comment) is `findCommentSpans`.

## Modules

| Subpath | Exports | Notes |
| --- | --- | --- |
| `@fro-bot/ci-checks/check-mutation-guards`, `-cli` | `runMutationGuardCheck`, `classifyMutationReport`, `buildTriggerSet`, `evaluateTriggerGate`, `buildImportClosure`, `markVitestTypeArguments`, `inlineLiteralInterpolations`, `exitCodeFor`, `printResult`, `VERDICTS`, ...; `checkMutationGuardsCli`, `main` | One file of 1,600 lines. Not in `mutate`: a directive scanner cannot describe its own grammar in comments without matching it. |
| `@fro-bot/ci-checks/mutation-guards-reach` | `findMutateEntriesWithoutSourceReach`, `isPureReexportBarrel`, `stripBarrelExports`, `sourceReachTransitive`, `normalizePath`, `treeOf` | Mutated. The strict, barrel-excluding reach the enumeration test uses. |
| `@fro-bot/ci-checks/repository-root` | `findRepositoryRoot` | Mutated. |
| `@fro-bot/ci-checks/check-md-links`, `-cli` | `checkMarkdownLinks`, `runCheckMarkdownLinks`; `checkMarkdownLinksCli`, `main` | Root-level `*.md` and `docs/**/*.md` of the working directory. |
| `@fro-bot/ci-checks/check-override-floors`, `-cli` | `checkOverrideFloors`, `parseAuditOutput`, `runBunAudit`, `formatProblem`, `runCheckOverrideFloors`; `checkOverrideFloorsCli`, `main` | `bun audit --json`; anything it cannot interpret is a failure. |
| `@fro-bot/ci-checks/check-solutions-examples`, `-cli` | `checkSolutionsExamples`, `extractCodeBlocks`, `findCommentSpans`, `runCheckSolutionsExamples`, ...; `checkSolutionsExamplesCli`, `main` | Imports `typescript`, so no barrel re-exports it. |
| `@fro-bot/ci-checks/install-renovate`, `-cli` | `runInstallRenovate`; `installRenovateCli`, `main` | Runs under Node. |
| `@fro-bot/ci-checks/renovate-runtime` | `readPinnedVersion`, `resolvePrefix`, `installRenovate`, `loadRenovateRuntime`, `assertRenovateInstalled`, ... | The pin lives in `env.RENOVATE_VERSION` of `main.yaml`. |
| `@fro-bot/ci-checks/check-renovate-config`, `-cli` | `checkRenovateConfig`, `classifyExtends`, `fetchPinnedPreset`, `runRenovateValidator`, `runCheckRenovateConfig`; `checkRenovateConfigCli`, `main` | Runs under Node. |
| `@fro-bot/ci-checks/check-renovate-ranges`, `-cli` | `checkRenovateRanges`, `collectAllowedVersions`, `readConfigSources`, `reportRangeCheck`, `runCheckRenovateRanges`; `checkRenovateRangesCli`, `main` | Runs under Node. |

## CLIs

Each command declares `readOnly`, a static capability: `true` unless the command can mutate GitHub, `data`, an external service, or a tracked path in the checkout. Writes to `reports/mutation/`, `.stryker-tmp`, the step summary and the `RENOVATE_PREFIX` scratch install are tool output and do not count, so all seven are `true`.

| CLI | Caller and argv | `readOnly` | Outputs and exit codes |
| --- | --- | --- | --- |
| `check-mutation-guards` | `main.yaml` via `bun run check:mutation-guards`, job-if `pull_request`; no argv | `true` | Exit `exitCodeFor(verdict)`: 0 for `clean` and `not-applicable`, 1 for every other verdict and for a throw. Stdout and the step summary carry the located mutants and the verdict; `reports/mutation/mutation.json` is uploaded `if: always()`. |
| `check-md-links` | `bun run check:md-links`, link one of `lint` (`&&`); no argv | `true` | Exit 1 with `path:line -> target` on stderr. |
| `check-override-floors` | `bun run check:override-floors`, link two of `lint`; the agent prompt in `fro-bot.yaml` (`bun scripts/check-override-floors.ts`); no argv | `true` | Exit 1 on a high or critical advisory or on anything uninterpretable, `check-override-floors: ...` on stderr; 0 otherwise. The prompt acts on exit 0. |
| `check-solutions-examples` | `bun run check:solutions-examples`, link three of `lint`; no argv | `true` | Exit 1 with `path:line -> reason` on stderr; the `verify:` markers use `findSignature`. |
| `install-renovate` | `node scripts/install-renovate.ts`, first half of `check:renovate-config` (`&&`); no argv | `true` | Prefix on stdout, `install-renovate: ...` on stderr, exit 1 on failure. |
| `check-renovate-config` | `node scripts/check-renovate-config.ts`, second half of `check:renovate-config`, and `main.yaml`; no argv | `true` | Exit 1; output goes straight to the process streams in the order the checks produce it. |
| `check-renovate-ranges` | No workflow caller; tests and `check-renovate-config`. Variadic config paths, default `default.json` and `.github/renovate.json5` | `true` | Exit 1. |

Argv that matches nothing declared, `--help` included, is a usage error: exit 1 and usage on stderr, with nothing run. Before the runner these CLIs ignored extra argv and ran, so `check-md-links --help` was a pass.

## Package diagram

```mermaid
C4Component
  title Components of @fro-bot/ci-checks

  Container_Boundary(cichecks, "@fro-bot/ci-checks") {
    Component(check_md_links, "check-md-links", "TypeScript", "Finds broken relative links in root and docs/ markdown")
    Component(check_md_links_cli, "check-md-links-cli", "TypeScript", "goke CLI; read-only")
    Component(check_mutation_guards, "check-mutation-guards", "TypeScript", "The mutation gate: trigger set, Stryker spawn, report classifier, verdict and exit code")
    Component(check_mutation_guards_cli, "check-mutation-guards-cli", "TypeScript", "goke CLI; read-only; exit from exitCodeFor")
    Component(check_override_floors, "check-override-floors", "TypeScript", "Fails on a high or critical bun audit advisory")
    Component(check_override_floors_cli, "check-override-floors-cli", "TypeScript", "goke CLI; read-only")
    Component(check_renovate_config, "check-renovate-config", "TypeScript", "Validates the Renovate preset and its pinned presets with the pinned Renovate")
    Component(check_renovate_config_cli, "check-renovate-config-cli", "TypeScript", "goke CLI; read-only; runs under Node")
    Component(check_renovate_ranges, "check-renovate-ranges", "TypeScript", "Judges every allowedVersions value with Renovate versioning")
    Component(check_renovate_ranges_cli, "check-renovate-ranges-cli", "TypeScript", "goke CLI; read-only; variadic config paths; runs under Node")
    Component(check_solutions_examples, "check-solutions-examples", "TypeScript", "Parses docs/solutions code examples and checks verify markers")
    Component(check_solutions_examples_cli, "check-solutions-examples-cli", "TypeScript", "goke CLI; read-only")
    Component(install_renovate, "install-renovate", "TypeScript", "Installs the pinned Renovate into a scratch prefix")
    Component(install_renovate_cli, "install-renovate-cli", "TypeScript", "goke CLI; read-only; runs under Node")
    Component(mutation_guards_reach, "mutation-guards-reach", "TypeScript", "Strict barrel-excluding reach used by the enumeration test")
    Component(renovate_runtime, "renovate-runtime", "TypeScript", "Pin parsing, scratch install and loading of the pinned Renovate")
    Component(repository_root, "repository-root", "TypeScript", "The repository root, three levels above this package source")
  }

  System_Ext(entrypoints, "scripts/<name>.ts", "Six-line entrypoints run by workflows and package scripts")
  System_Ext(core, "@fro-bot/core", "cli, guards, retry, wiki-authority")
  System_Ext(wwc, "@fro.bot/wiki-write-core", "markdown-links")
  System_Ext(typescript, "typescript", "Compiler API, syntax diagnostics only")
  System_Ext(yaml, "yaml", "Workflow pin parsing")
  System_Ext(github, "GitHub", "gh api for the changed files of a pull request")
  System_Ext(stryker, "Stryker", "bunx stryker run, report on disk")
  System_Ext(renovate, "Renovate", "Pinned scratch install, validator and versioning")

  Rel(entrypoints, check_md_links_cli, "main")
  Rel(entrypoints, check_mutation_guards_cli, "main")
  Rel(entrypoints, check_override_floors_cli, "main")
  Rel(entrypoints, check_renovate_config_cli, "main")
  Rel(entrypoints, check_renovate_ranges_cli, "main")
  Rel(entrypoints, check_solutions_examples_cli, "main")
  Rel(entrypoints, install_renovate_cli, "main")
  Rel(check_md_links_cli, check_md_links, "imports")
  Rel(check_mutation_guards, repository_root, "imports")
  Rel(check_mutation_guards, x, "imports")
  Rel(check_mutation_guards_cli, check_mutation_guards, "imports")
  Rel(check_override_floors_cli, check_override_floors, "imports")
  Rel(check_renovate_config, check_renovate_ranges, "types with")
  Rel(check_renovate_config, renovate_runtime, "types with")
  Rel(check_renovate_config_cli, check_renovate_config, "imports")
  Rel(check_renovate_ranges, renovate_runtime, "imports")
  Rel(check_renovate_ranges_cli, check_renovate_ranges, "imports")
  Rel(check_solutions_examples_cli, check_solutions_examples, "imports")
  Rel(install_renovate, renovate_runtime, "imports")
  Rel(install_renovate_cli, install_renovate, "imports")
  Rel(mutation_guards_reach, check_mutation_guards, "imports")
  Rel(mutation_guards_reach, repository_root, "imports")
  Rel(renovate_runtime, check_renovate_ranges, "types with")
  Rel(check_md_links, wwc, "imports")
  Rel(check_md_links_cli, core, "runs on")
  Rel(check_mutation_guards, core, "imports")
  Rel(check_mutation_guards_cli, core, "runs on")
  Rel(check_override_floors, core, "imports")
  Rel(check_override_floors_cli, core, "runs on")
  Rel(check_renovate_config, core, "imports")
  Rel(check_renovate_config_cli, core, "runs on")
  Rel(check_renovate_ranges, core, "imports")
  Rel(check_renovate_ranges_cli, core, "runs on")
  Rel(check_solutions_examples, typescript, "imports")
  Rel(check_solutions_examples_cli, core, "runs on")
  Rel(install_renovate_cli, core, "runs on")
  Rel(renovate_runtime, core, "imports")
  Rel(renovate_runtime, yaml, "imports")
  Rel(check_mutation_guards, github, "reads")
  Rel(check_mutation_guards, stryker, "spawns")
  Rel(renovate_runtime, renovate, "installs and loads")
  Rel(check_renovate_config, renovate, "validates with")

  UpdateRelStyle(entrypoints, check_md_links_cli, $offsetX="-14", $offsetY="-13")
  UpdateRelStyle(entrypoints, check_mutation_guards_cli, $offsetX="-33", $offsetY="33")
  UpdateRelStyle(entrypoints, check_override_floors_cli, $offsetX="-21", $offsetY="35")
  UpdateRelStyle(entrypoints, check_renovate_config_cli, $offsetX="-43", $offsetY="-22")
  UpdateRelStyle(entrypoints, check_renovate_ranges_cli, $offsetX="-33", $offsetY="-34")
  UpdateRelStyle(entrypoints, check_solutions_examples_cli, $offsetX="-62", $offsetY="18")
  UpdateRelStyle(entrypoints, install_renovate_cli, $offsetX="-26", $offsetY="45")
  UpdateRelStyle(check_md_links_cli, check_md_links, $offsetX="-5", $offsetY="-47")
  UpdateRelStyle(check_mutation_guards, repository_root, $offsetX="30", $offsetY="-34")
  UpdateRelStyle(check_mutation_guards, x, $offsetX="75", $offsetY="-49")
  UpdateRelStyle(check_mutation_guards_cli, check_mutation_guards, $offsetX="-10", $offsetY="-32")
  UpdateRelStyle(check_override_floors_cli, check_override_floors, $offsetX="-59", $offsetY="-17")
  UpdateRelStyle(check_renovate_config, check_renovate_ranges, $offsetX="35", $offsetY="45")
  UpdateRelStyle(check_renovate_config, renovate_runtime, $offsetX="31", $offsetY="-33")
  UpdateRelStyle(check_renovate_config_cli, check_renovate_config, $offsetX="-15", $offsetY="-5")
  UpdateRelStyle(check_renovate_ranges, renovate_runtime, $offsetX="-21", $offsetY="12")
  UpdateRelStyle(check_renovate_ranges_cli, check_renovate_ranges, $offsetX="60", $offsetY="22")
  UpdateRelStyle(check_solutions_examples_cli, check_solutions_examples, $offsetX="29", $offsetY="35")
  UpdateRelStyle(install_renovate, renovate_runtime, $offsetX="13", $offsetY="5")
  UpdateRelStyle(install_renovate_cli, install_renovate, $offsetX="0", $offsetY="33")
  UpdateRelStyle(mutation_guards_reach, check_mutation_guards, $offsetX="-50", $offsetY="-6")
  UpdateRelStyle(mutation_guards_reach, repository_root, $offsetX="72", $offsetY="31")
  UpdateRelStyle(renovate_runtime, check_renovate_ranges, $offsetX="-13", $offsetY="38")
  UpdateRelStyle(check_md_links, wwc, $offsetX="34", $offsetY="20")
  UpdateRelStyle(check_md_links_cli, core, $offsetX="76", $offsetY="45")
  UpdateRelStyle(check_mutation_guards, core, $offsetX="-46", $offsetY="6")
  UpdateRelStyle(check_mutation_guards_cli, core, $offsetX="33", $offsetY="18")
  UpdateRelStyle(check_override_floors, core, $offsetX="-35", $offsetY="-13")
  UpdateRelStyle(check_override_floors_cli, core, $offsetX="-29", $offsetY="-28")
  UpdateRelStyle(check_renovate_config, core, $offsetX="53", $offsetY="-5")
  UpdateRelStyle(check_renovate_config_cli, core, $offsetX="-16", $offsetY="-3")
  UpdateRelStyle(check_renovate_ranges, core, $offsetX="37", $offsetY="-17")
  UpdateRelStyle(check_renovate_ranges_cli, core, $offsetX="75", $offsetY="-15")
  UpdateRelStyle(check_solutions_examples, typescript, $offsetX="21", $offsetY="-34")
  UpdateRelStyle(check_solutions_examples_cli, core, $offsetX="67", $offsetY="12")
  UpdateRelStyle(install_renovate_cli, core, $offsetX="60", $offsetY="-20")
  UpdateRelStyle(renovate_runtime, core, $offsetX="64", $offsetY="-20")
  UpdateRelStyle(renovate_runtime, yaml, $offsetX="-31", $offsetY="39")
  UpdateRelStyle(check_mutation_guards, github, $offsetX="13", $offsetY="-34")
  UpdateRelStyle(check_mutation_guards, stryker, $offsetX="-62", $offsetY="5")
  UpdateRelStyle(renovate_runtime, renovate, $offsetX="38", $offsetY="-1")
  UpdateRelStyle(check_renovate_config, renovate, $offsetX="-80", $offsetY="42")
```

## Adding a module

Add `src/<name>.ts` and an `exports` entry in `package.json`. A CLI adds `src/<name>-cli.ts`, which is the only kind of module that imports `@fro-bot/core/cli`, and a six-line `scripts/<name>.ts` that calls its `main`. Tests sit beside the module and import it by relative path. Then do all of these:

- Classify the module in `stryker.config.json` (`mutate`) or `mutation-guards.json` (`not-mutated`, with a measured score). Add it to `FIXED_TRIGGER_FILES` in `check-mutation-guards.ts` if a change to it changes what the gate enforces.
- Every filesystem call in a test targets a test-owned temp root. A test never calls `runMutationGuardCheck` with the default report path, because it removes that file.
- Time any regex that markdown, a `verify:` marker, audit JSON, Renovate output or a git diff name reaches, with a long run and with many separate matches in one document.
- Update this diagram, the root `README.md` graph and `llms.txt`.
