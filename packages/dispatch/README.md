# `@fro-bot/dispatch`

The dispatchers of the Fro Bot control plane. The package is private (`"private": true`), is never published, and exports `.ts` source with no build step, so Bun, Node strip-only loading, `tsc` and Vitest all load it as written.

It depends on `@fro-bot/core` (the Octokit client factory and the goke runner), `@fro.bot/wiki-write-core` (the `schemas` subpath), `@octokit/rest` and `yaml`.

## Modules

| Subpath | Exports | Notes |
| --- | --- | --- |
| `@fro-bot/dispatch/dispatch-renovate` | `buildDispatchPlan`, `planDispatchRepositories`, `runPlanMode`, `dispatchRenovate`, `runRenovatePlanCli`, `runRenovateDispatchCli` | Renovate plan and dispatch. |
| `@fro-bot/dispatch/dispatch-renovate-cli` | `dispatchRenovateCli`, `main` | The goke CLI over the two Renovate modes. |

## CLIs

| CLI | Caller and argv | Runtime | `readOnly` | Exit codes and outputs |
| --- | --- | --- | --- | --- |
| `dispatch-renovate plan` | `dispatch-renovate.yaml`: argv `plan` | Bun | `true` | `repositories=a,b` on `$GITHUB_OUTPUT`. Throws `GITHUB_OUTPUT is required in plan mode` when the variable is unset. |
| `dispatch-renovate` | `dispatch-renovate.yaml`: no argv, step-if `plan.outputs.repositories != ''` | Bun | `false` | A JSON summary on stdout; `dispatch-renovate: failed <name>: <error>` on stderr for each failed dispatch. |

`dispatch-renovate` accepts `plan` or no argument. Any other argv, `--help` and `pln` included, is a usage error: exit 1, usage on stderr, nothing planned or dispatched. A thrown error prints its message and exits 1.

```mermaid
C4Component
  title Components of @fro-bot/dispatch

  Container_Boundary(dispatch, "@fro-bot/dispatch") {
    Component(renovatecli, "dispatch-renovate-cli", "TypeScript", "goke CLI: plan and dispatch")
    Component(renovate, "dispatch-renovate", "TypeScript", "Renovate plan and dispatch")
  }

  System_Ext(entrypoints, "scripts/dispatch-renovate.ts", "Six-line entrypoint run by the workflow")
  System_Ext(core, "@fro-bot/core", "cli, github")
  System_Ext(wwc, "@fro.bot/wiki-write-core", "schemas")
  System_Ext(gh, "GitHub", "Installation repositories, workflow runs, dispatches")

  Rel(entrypoints, renovatecli, "main")
  Rel(renovatecli, renovate, "runs")
  Rel(renovatecli, core, "runs on")
  Rel(renovate, core, "builds its client with")
  Rel(renovate, wwc, "reads schemas from")
  Rel(renovate, gh, "lists repos, dispatches Renovate")

  UpdateRelStyle(entrypoints, renovatecli, $offsetX="-20", $offsetY="-20")
  UpdateRelStyle(renovatecli, renovate, $offsetX="-10", $offsetY="10")
  UpdateRelStyle(renovatecli, core, $offsetX="-60", $offsetY="20")
  UpdateRelStyle(renovate, core, $offsetX="20", $offsetY="30")
  UpdateRelStyle(renovate, wwc, $offsetX="40", $offsetY="10")
  UpdateRelStyle(renovate, gh, $offsetX="60", $offsetY="0")
```
