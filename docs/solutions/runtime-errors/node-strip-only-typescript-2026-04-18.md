---
title: Node 24 Strip-Only TypeScript Silently Accepts Then Rejects Class-Rewriting Syntax
category: runtime-errors
problem_type: runtime_error
component: tooling
root_cause: language_semantics
resolution_type: process_improvement
severity: high
date: 2026-04-18
last_updated: 2026-04-18
module: scripts/repos-metadata.ts
tags:
  [
    typescript,
    node,
    strip-only,
    parameter-properties,
    enum,
    namespace,
    runtime-error,
    vitest,
    tsc,
    lint-rule,
    ci-smoke-test,
  ]
verified: true
---

## Problem

The scheduled `Poll invitations` workflow crashed at module load time with `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]` after a class that used TypeScript parameter properties landed on `main`. The type checker, the test suite, and local editor tooling all reported the file as clean. Only the production workflow surfaced the failure — exactly 15 minutes after the PR merged, on the next scheduled cron.

## Symptoms

- Scheduled `poll-invitations.yaml` run fails with exit code 1 on its very first step:

  ```
  file:///home/runner/work/.github/.github/scripts/repos-metadata.ts:110
    constructor(
      readonly owner: string,
               ^^^^^^^^^^^^^

  SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
      at parseTypeScript (node:internal/modules/typescript:68:40)
      at processTypeScriptCode (node:internal/modules/typescript:146:42)
      at stripTypeScriptModuleTypes (node:internal/modules/typescript:209:22)
  ```

- The error fires at _module load_, before the first line of application code runs. Import chains are affected transitively: every workflow whose entrypoint imports (directly or indirectly) the offending file fails the same way.
- `pnpm test` — all 186 Vitest tests pass.
- `pnpm check-types` — `tsc --noEmit` clean.
- `pnpm lint` — no diagnostics.
- Editor: no red squiggles.

## What Didn't Work

- **Trusting `pnpm test`.** Vitest runs under Vite's TypeScript transform, which is a full compiler. Parameter properties, `enum`, `namespace`, decorators, and CTS import aliases all pass through without issue. Tests that import the offending module succeed because Vite rewrites the class during transform — Node's strip-only parser never runs.
- **Trusting `pnpm check-types`.** `tsc --noEmit` type-checks TypeScript-the-language. Parameter properties are valid TypeScript, so `tsc` says "fine." Strip-only compatibility is a _runtime execution strategy_ concern that lives entirely outside the type system.
- **Trusting the editor.** Both VS Code and the language server evaluate TypeScript semantics, not Node's strip-only ABI.
- **Trusting `node --check`.** `node --check path/to/file.ts` only validates shell-parseable syntax, not strip-only-compatible syntax. It returned 0 for the offending file.

The failure mode is: every local guardrail passes, then the scheduled cron crashes. The feedback loop is measured in production-time, not developer-time.

## Solution

Two-layer guardrail: lint-time prevention plus CI smoke-test backstop.

### Layer 1 — ESLint catches strip-only incompatibility before it lands

The repo already consumes `@bfra.me/eslint-config`, which exposes a first-class option for this exact concern. Flip it on:

```ts
// eslint.config.ts
import {defineConfig} from '@bfra.me/eslint-config'

export default defineConfig({
  // ...
  typescript: {
    tsconfigPath: './tsconfig.json',
    // Enforce Node 24 strip-only TypeScript compatibility: rejects parameter properties,
    // enums, namespaces, and import aliases at lint time, before they surface as
    // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at runtime.
    erasableSyntaxOnly: true,
  },
})
```

`eslint-plugin-erasable-syntax-only` is a devDependency of `@bfra.me/eslint-config`, not a transitive dep, so consumers that opt in must add it explicitly:

```sh
pnpm add -DE eslint-plugin-erasable-syntax-only
```

The ruleset covers:

| Rule                                          | Catches                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `erasable-syntax-only/parameter-properties` | `constructor(readonly x: string)` constructor-field syntax  |
| `erasable-syntax-only/enums`                | `enum Kind { A, B }`                                        |
| `erasable-syntax-only/namespaces`           | `namespace X { ... }`                                       |
| `erasable-syntax-only/import-aliases`       | `import X = require(...)` / `import X = Y.Z` aliasing forms |

### Layer 2 — CI smoke test loads every production script under Node strip-only

Linting catches syntactic shapes. It does not catch semantically compatible-looking code that nevertheless fails at load — decorators without the experimental flag, dynamic import trickery, newly-introduced TS features. A focused CI job closes the remaining gap by running the actual strip-only parser on every non-test module:

```yaml
# .github/workflows/main.yaml
test-scripts-load:
  name: Test Scripts Load
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@...
    - uses: ./.github/actions/setup
    - name: Load production scripts under Node strip-only
      run: |
        for f in scripts/*.ts; do
          case "$f" in *.test.ts) continue ;; esac
          node -e "import('./$f').then(() => {}).catch(err => { process.stderr.write('FAIL $f: ' + (err.code || err.message) + '\\n'); process.exit(1); })"
          echo "  ok   $f"
        done
```

Add the job name to the required status checks in `.github/settings.yml` so a regression blocks merge rather than ships.

### The original code fix

Replace parameter properties with explicit field declarations plus in-body assignment:

```ts
// BEFORE — rejected by strip-only
export class RepoEntryNotFoundError extends Error {
  readonly code = 'REPO_ENTRY_NOT_FOUND'

  constructor(
    readonly owner: string,
    readonly repo: string,
  ) {
    super(`metadata/repos.yaml has no entry for ${owner}/${repo}`)
    this.name = 'RepoEntryNotFoundError'
  }
}

// AFTER — strip-only accepts
export class RepoEntryNotFoundError extends Error {
  readonly code = 'REPO_ENTRY_NOT_FOUND'
  readonly owner: string
  readonly repo: string

  constructor(owner: string, repo: string) {
    super(`metadata/repos.yaml has no entry for ${owner}/${repo}`)
    this.name = 'RepoEntryNotFoundError'
    this.owner = owner
    this.repo = repo
  }
}
```

Semantics unchanged. Field declarations plus assignment are pure type erasure — strip-only accepts.

## Why This Works

Node 24's built-in TypeScript execution (`--experimental-strip-types`, default on in Node 24) operates in **strip-only mode**. It erases type annotations but refuses to _rewrite_ code. Any TypeScript construct that expands into different JavaScript at runtime is rejected with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`:

| Construct            | Why strip-only rejects                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Parameter properties | Expands into class field declarations plus constructor assignments      |
| `enum`               | Generates an object with bidirectional key/value mapping                |
| `namespace`          | Generates an IIFE that attaches exports to a shared object              |
| Decorators           | Generate calls to decorator factories (unless behind experimental flag) |
| Import aliases (TS)  | Generate CommonJS-style requires or property accesses                   |

Everything else — type annotations, interfaces, type-only imports, class field declarations with type annotations, generics, `as` assertions — is pure type erasure and passes through strip-only cleanly.

The trap is that:

1. `tsc` accepts all of the rejected constructs as valid TypeScript.
2. Vitest (via Vite's full compiler) silently transforms them away.
3. Neither local tool exercises the strip-only parser.
4. Only the actual Node invocation on a CI runner — or on the scheduled cron — fails.

## Prevention

1. **Opt in to `erasable-syntax-only` lint rules** for any codebase running Node strip-only TypeScript. This is the first and cheapest line of defense. The `@bfra.me/eslint-config` option is a single line; bare ESLint setups can install the plugin directly.

2. **Add a CI job that imports every production entrypoint under Node.** Lint catches syntactic shapes; Node's actual parser catches everything else. Make the job a required status check so regressions block merge.

3. **Reason about runtime strategy, not just TypeScript validity, when adding new language features.** If a construct generates runtime code (any class-rewriting, any enum, any namespace, any decorator), ask: "Does the target Node runtime strip or transform?" If strip-only, stick to the erasable subset.

4. **Recognize the pattern from symptoms.** `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]` is the canonical indicator. The stack trace will point at `node:internal/modules/typescript:*` — not your code. Cold start, no application code runs.

5. **Treat subagent-generated SDK types and class shapes with the same skepticism you already apply to subagent method names.** Parameter properties are a compact class-declaration style subagents reach for naturally; they look like valid TypeScript and pass type-checking.

## References

### This occurrence (PR #3134)

- Failed run: https://github.com/fro-bot/.github/actions/runs/24602307971/job/71942909298
- Fix PR: https://github.com/fro-bot/.github/pull/3134
- Guardrail PR: open follow-up to #3134

### Related doc

- [`docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md`](./octokit-invitation-method-names-2026-04-17.md) — same category of trap: tests passed because they ran under a different runtime path than production. Different class (hallucinated method names on handwritten interfaces), same lesson (local guardrails that don't exercise the real runtime give false confidence).

### External

- Node 24 strip-only TypeScript docs: https://nodejs.org/api/typescript.html#type-stripping
- `eslint-plugin-erasable-syntax-only`: https://github.com/JoshuaKGoldberg/eslint-plugin-erasable-syntax-only
- TypeScript `--erasableSyntaxOnly` compiler option: https://www.typescriptlang.org/tsconfig#erasableSyntaxOnly
- GitHub Node bug tracker (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` class): https://github.com/nodejs/node/issues?q=ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
