# `@fro-bot/core`

Shared primitives for the Fro Bot control plane: type guards, `$GITHUB_OUTPUT` and step-summary writers, JSON line output, a retry loop, and the Octokit client factory. The package is private (`"private": true`), is never published, and exports `.ts` source with no build step, so Bun, Node strip-only loading, `tsc` and Vitest all load it as written. Its one dependency is `@octokit/rest`, at the root's range; `github` is the only module that imports it.

Where callers need different behavior, the primitive takes the difference as an explicit option or a separate export, so a caller states the behavior it means. `retry` is used by nine `scripts/` modules and `github` by every module that builds an Octokit client (both listed below). The other primitives have no caller yet; each domain package migrates its own copies when it moves.

## Modules

| Subpath | Exports | Notes |
| --- | --- | --- |
| `@fro-bot/core/guards` | `isRecord`, `isObject`, `isApiStatus`, `isApiStatusOfAnyObject` | `isRecord` rejects arrays and `isObject` (narrows to `object`) accepts them. `isApiStatus` rejects arrays and compares `status` strictly; `isApiStatusOfAnyObject` accepts any object. |
| `@fro-bot/core/output` | `writeGithubOutputs`, `appendStepSummary` | A required `onMissing: 'skip' \| 'throw'` policy for an unset or empty variable. A multiline value uses a heredoc with a UUID delimiter and is rejected if it contains the delimiter. |
| `@fro-bot/core/github` | `createOctokit`, `noopLog`, `loadOctokitConstructor`, `OctokitLoadError` | One authenticated `@octokit/rest` client per call. The caller passes the token and any `timeoutMs` and `log`; neither has a default. See below. |
| `@fro-bot/core/retry` | `retry` | `retry(operation, {attempts, delayMs, shouldRetry, retryResult, onRetry, sleep})`. The caller owns the numbers and the predicates. |
| `@fro-bot/core/json` | `formatJsonLine`, `writeJsonLine` | Compact JSON plus a newline. Both take `{indent}`; `{indent: 2}` is the output `reset-survey-status` prints. `writeJsonLine` also takes `{sink}`. A value with no JSON form throws. |

### `output`

- `writeGithubOutputs({name: value}, {onMissing})` appends every entry in one write and returns whether it wrote: no entries (or an empty summary) returns false and appends nothing. Names must match `[\w-]+`, so a name cannot carry a line break or `=` into the file. Every entry is formatted before the write, so a bad name or a colliding value writes nothing.
- `onMissing` is required, with no default: `wiki-change-detect` throws when `$GITHUB_OUTPUT` is unset and `dispatch-renovate` throws in plan mode, while the other writers skip. `missingMessage` sets the error text. An empty variable counts as unset.
- `appendStepSummary(markdown, {onMissing})` appends the text as given to `$GITHUB_STEP_SUMMARY`.
- The `env`, `append` and `delimiter` options are seams for tests.

### `retry`

- `operation(attempt)` runs up to `attempts` times (an integer of at least 1, otherwise a `RangeError` before any attempt). An attempt fails by throwing (`shouldRetry(error, attempt)`) or by returning a value the caller wants to try again (`retryResult(value, attempt)`); both default to never.
- The last attempt is never asked and never waited after: its error is thrown, or its value returned, exactly as the operation produced it, so the caller maps an exhausted outcome to its own error or result.
- `delayMs(attempt)` is the wait after failed attempt `attempt`; omitted, zero or negative means no wait. `onRetry(error, attempt)` runs after `shouldRetry` says yes and before the wait, for error retries only.
- `sleep` is a seam for tests. The default is a `setTimeout` looked up when it is used, so fake timers work.
- Callers: `commit-metadata` (409, plus the data-branch bootstrap), `wiki-repair` (tip moved), `rename-tracked-repo` (ref race), `cross-repo-dispatch` (compare-and-swap miss), `private-repo-resolution` (rate limit, 2s doubling), `merge-data-pr` (unknown mergeable state; PR not yet visible or retryable API error, 1s), `merge-back-data` (`raced` or `main-moved`), `gateway-announce` (one retry after 5s on a network error) and `check-renovate-config` (non-200/404). Each keeps its own error type or exhausted result around the call.

### `github`

- `createOctokit(token, {timeoutMs, log, loadConstructor, missingToken})` constructs the client with `{auth: token}` and adds `request: {timeout: timeoutMs}` and `log` only when they are given. There is no default timeout and no default logger: a caller that passed neither keeps passing neither, and each caller passes the numbers it uses (10 s or 15 s, the no-op logger).
- A token read from the environment passes `missingToken`, a function returning the caller's own error. An undefined or empty token throws it before the constructor is loaded. Without `missingToken`, the token is used as given, an empty string included.
- `@octokit/rest` is loaded by a dynamic import inside this module, so a test's `vi.mock('@octokit/rest')` reaches the client whichever way the caller imported it before. `loadConstructor` is the seam for a test that would rather not touch the module registry.
- A missing or non-function `Octokit` export throws `OctokitLoadError`, a `TypeError` with `reason` of `'missing-export'` or `'not-a-constructor'`. Callers with a domain error class (`reconcile-repos`, `handle-invitation`, `commit-metadata`, `merge-data-pr`, `wiki-repair`) catch it and rethrow their own.
- `noopLog()` returns four no-op log methods; it is a function so Stryker covers its mutants.
- Callers: the nine `createOctokitFromEnv` factories (`capture-learnings-harvest`, `cross-repo-dispatch`, `status-truth-proposals`, `reconcile-repos` for three credentials, `status-truth-prs`, `wiki-repair`, `merge-data-pr`, `handle-invitation` for two, `commit-metadata`) and the inline sites in `dispatch-renovate`, `drafted-solutions-*`, `merge-back-data`, `rename-tracked-repo`, `status-truth-detect`, `update-metadata`, `wiki-lint-issues` and four `improvement-metrics-*` and `capture-patterns-*` entrypoints. `reconcile-repos` and `handle-invitation` keep one client per credential.

### Mutation coverage

`guards`, `output`, `json`, `retry` and `github` are in the `mutate` set of `stryker.config.json` and held at 100% kills by `bun run check:mutation-guards`. Their tests import them by relative path, because the Stryker sandbox links `node_modules` to the real tree and a package-name import would run against the un-mutated file. Core's tests must kill core's mutants on their own: a consumer's tests never run against them.

## Package diagram

```mermaid
C4Component
  title Components of @fro-bot/core

  Container_Boundary(core, "@fro-bot/core") {
    Component(guards, "guards", "TypeScript", "isRecord, isObject, isApiStatus")
    Component(output, "output", "TypeScript", "GITHUB_OUTPUT and step summary writers")
    Component(json, "json", "TypeScript", "JSON line output")
    Component(retry, "retry", "TypeScript", "Retry loop with caller-supplied policy")
    Component(github, "github", "TypeScript", "Octokit client factory, no-op logger")
  }

  System_Ext(callers, "Domain packages and scripts/", "Import by package name")
  System_Ext(runner, "GitHub Actions runner", "Provides GITHUB_OUTPUT and GITHUB_STEP_SUMMARY files")
  System_Ext(stdout, "stdout", "Read by workflow shell and jq")
  System_Ext(octokit, "@octokit/rest", "Npm dependency, loaded by dynamic import")

  Rel(callers, guards, "imports")
  Rel(callers, output, "imports")
  Rel(callers, json, "imports")
  Rel(callers, retry, "imports")
  Rel(callers, github, "imports")
  Rel(output, runner, "appends to")
  Rel(json, stdout, "writes to")
  Rel(github, octokit, "constructs clients from")

  UpdateRelStyle(callers, guards, $offsetX="-50", $offsetY="-20")
  UpdateRelStyle(callers, output, $offsetX="-10", $offsetY="-30")
  UpdateRelStyle(callers, json, $offsetX="40", $offsetY="-20")
  UpdateRelStyle(callers, retry, $offsetX="80", $offsetY="-10")
  UpdateRelStyle(callers, github, $offsetX="110", $offsetY="0")
  UpdateRelStyle(github, octokit, $offsetX="-20", $offsetY="-10")
  UpdateRelStyle(output, runner, $offsetX="-20", $offsetY="10")
  UpdateRelStyle(json, stdout, $offsetX="20", $offsetY="10")
```

No CLI runs on this package yet.

## Adding a module

1. Add `src/<name>.ts` and its subpath to `exports` in `package.json`. Use erasable TypeScript syntax only: Node strip-only loads the file, and Test Scripts Load fails on `enum`, `namespace` and parameter properties.
2. Add `src/<name>.test.ts` and import the module by relative path.
3. Keep regexes and other constants whose mutants matter inside functions. Stryker covers a mutant in a module-level constant with no test, so it survives.
4. List the module in `stryker.config.json` `mutate` (and its test in `testFiles`), or in `mutation-guards.json` `not-mutated` with a reason. `scripts/mutation-guards-config.test.ts` fails an unlisted module.
5. Update the diagram above and the package graph in the root `README.md`.
