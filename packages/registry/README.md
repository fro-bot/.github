# `@fro-bot/registry`

The writers of `metadata/repos.yaml` and the data-branch merges of the Fro Bot control plane: the App-token metadata writer, the reconcile that syncs the registry with real collaborator access, invitation polling, the survey write-back and its recovery tool, the onboarded gate, `merge-back-data`, `merge-data-pr`, `rename-tracked-repo` and the Renovate metadata refresh. The package is private (`"private": true`), is never published, and exports `.ts` source with no build step, so Bun, Node strip-only loading, `tsc` and Vitest all load it as written.

It depends on `@fro-bot/core` (guards, retry, the Octokit client factory, the goke runner and the PR wiki-authority check), `@fro.bot/wiki-write-core` (the `schemas`, `data-branch-bootstrap` and `wiki-slug` subpaths, and the `assertBranchWritable` guard), `@octokit/rest` (types, and the test mocks) and `yaml`. It depends on nothing else in the workspace.

Every data writer here uses an App token and writes only to the `data` branch, which a repository ruleset restricts to the Fro Bot App; `main` receives those writes only through the weekly `Merge Data Branch` promotion and its gates. Nothing here runs in an agent job. Each CLI keeps a six-line `scripts/<name>.ts` entrypoint that calls `main` from the package's `*-cli` module, so workflow paths do not change.

## Modules

| Subpath | Exports | Notes |
| --- | --- | --- |
| `@fro-bot/registry/commit-metadata` | `commitMetadata`, `CommitMetadataError`, `deepEquals` | The mutator-based writer for `metadata/*.yaml` on `data`: bootstraps the branch, refuses a protected or non-`data` branch, retries a 409 through `@fro-bot/core/retry`. A library with no CLI. |
| `@fro-bot/registry/repos-metadata` | `addRepoEntry`, `applySurveyResult`, `resetSurveyResult`, `publicRepoEntryExists`, `RepoEntryNotFoundError`, `DuplicateRepoIdentityError`, ... | The shape and lookup helpers for `metadata/repos.yaml`. Every writer builds new rows through `addRepoEntry`. |
| `@fro-bot/registry/metadata-wiki-rename-guard` | `findBlockedPublicAssociations`, `lookupRepoWikiPage`, `publicAssociationKey` | Stops a rename or merge from stranding a wiki page. |
| `@fro-bot/registry/update-metadata`, `update-metadata-cli` | `runUpdateMetadata`, `runFromEnv`, `discoverRenovateRepos`, `buildRenovateFile`; `updateMetadataCli`, `main` | Refreshes `metadata/renovate.yaml` from the repos the App installation can see. |
| `@fro-bot/registry/handle-invitation`, `handle-invitation-cli` | `handleInvitations`, `formatInvitationGithubOutput`, `countPublicAcceptedInvitations`, `runHandleInvitation`; `handleInvitationCli`, `main` | Polls repository invitations against the allowlist, with one client per credential. |
| `@fro-bot/registry/record-survey-result`, `record-survey-result-cli` | `runRecordSurveyResult`, `createSurveyWriteBack`, `buildRecordSurveyResultInput`, ...; `recordSurveyResultCli`, `main` | Writes a Survey Repo outcome back to the matching row. |
| `@fro-bot/registry/reset-survey-status`, `reset-survey-status-cli` | `runResetSurveyStatus`, `parseTargets`, `formatResetSurveyTarget`; `resetSurveyStatusCli`, `main` | Operator recovery for survey fields. |
| `@fro-bot/registry/check-repo-onboarded`, `check-repo-onboarded-cli` | `runCheck`, `runCheckRepoOnboarded`; `checkRepoOnboardedCli`, `main` | The survey routing gate. Fails closed to `onboarded=false`. |
| `@fro-bot/registry/merge-back-data`, `merge-back-data-cli` | `mergeBackData`, `runCli`, `MergeBackError`; `mergeBackDataCli`, `main` | Merges `main` into `data` at the start of a merge-data run. Mutated. |
| `@fro-bot/registry/merge-data-pr`, `merge-data-pr-cli` | `mergeDataPr`, `upsertAlertIssue`, `MergeDataPrError`, `runMergeDataPr`; `mergeDataPrCli`, `main` | Opens or refreshes the `data` to `main` promotion PR. |
| `@fro-bot/registry/rename-tracked-repo`, `rename-tracked-repo-cli` | `renameTrackedRepo`, `runCli`, `RenameError`; `renameTrackedRepoCli`, `main` | The operator-dispatched rename: it commits the row and the wiki page move in one Git Data commit. |
| `@fro-bot/registry/reconcile-cli` | `reconcileReposCli`, `main` | The goke CLI over `handleReconcile`. |
| `@fro-bot/registry/reconcile-handler` | `handleReconcile`, `formatCommitMessage`, `HandleReconcileParams`, `HandleReconcileResult` | The I/O shell: read, plan, verify `data`, commit, then dispatch, file issues and sync stars. |
| `@fro-bot/registry/reconcile-plan` | `reconcileRepos`, `detectRenames`, `migrateRepoEntry`, `isEligibleForSurvey`, the probe, input and result types | The pure engine. |
| `@fro-bot/registry/reconcile-discovery` | `fetchPerRepoStatus`, `fetchFieldProbes`, `mergeAccessChannels`, `containsFroBotAgentReference`, ... | The read probes. |
| `@fro-bot/registry/reconcile-integrity` | none outside the handler | The `data` tip-author and rules check, and the alert issue. |
| `@fro-bot/registry/reconcile-issues` | `renderIssuePayload`, `IssuePayload` | Pure issue renderers. |
| `@fro-bot/registry/reconcile-effects` | `syncStars`, `loadDispatchStaggerFromEnv`, `loadMaxDispatchesPerRunFromEnv`, `DISPATCH_DEFAULTS` | The writes: stars, survey dispatches, the issue queue, labels, auto-close and self-heal. |
| `@fro-bot/registry/reconcile-labels` | `TRANSITION_LABELS`, `RENAME_PENDING_LABELS` | The reconcile label constants, a leaf with no imports. |
| `@fro-bot/registry/reconcile-model` | `ReconcileError`, `ReconcileLogger`, `OctokitClient`, `toApiError`, the owner, repo and path defaults | The shared vocabulary, a leaf. |
| `@fro-bot/registry/registry-io` | `RegistryIo` | The stdout and stderr sinks a CLI body writes to. Type only. |

`reconcile-repos` was one 4,280-line module. No non-test module in this package reaches 2,000 lines, and each top-level declaration of the original lives in exactly one seam. `reconcile-repos.test.ts` stays whole and imports the seams by relative path; there is no facade that re-exports them.

## CLIs

Each command declares `readOnly`, a static capability: `true` unless the command can mutate GitHub, `data`, an external service, or a tracked path in the checkout. `$GITHUB_OUTPUT` and stdout do not count.

| CLI | Caller and argv | `readOnly` | Exit codes and outputs |
| --- | --- | --- | --- |
| `reconcile-repos` | `reconcile-repos.yaml`: no argv, piped to `tee`, `shell: bash` | `false` | stdout is one JSON object; the summary step reads 27 `jq` fields from it, and a missing field falls back to 0, so a renamed field fails silently (a test pins every path). Exit 1 on a `ReconcileError`, with its message on stderr. |
| `handle-invitation` | `poll-invitations.yaml`: no argv | `false` | `$GITHUB_OUTPUT` `public_invitations_accepted` and `public_invitations_accepted_repos`, written only when `GITHUB_OUTPUT` is set and non-empty. Exit 1 on a failure. |
| `record-survey-result` | `survey-repo.yaml`: no argv, after the agent and the recheck | `false` | Exit 0 when the target has no entry (stderr `record-survey-result: ...; skipping (non-fatal)`) and for a duplicate identity; exit 1 otherwise. |
| `reset-survey-status` | `reset-survey-status.yaml`: no argv | `false` | stdout JSON indented by two spaces, the only indented output; stderr `reset-survey-status: <message>`; exit 1. |
| `check-repo-onboarded` | `survey-repo.yaml`: no argv | `true` | `onboarded=true\|false` on `$GITHUB_OUTPUT`; stderr `check-repo-onboarded: <reason>`. Never fails. |
| `merge-back-data` | `merge-data.yaml`: no argv, no `continue-on-error` | `false` | stderr `::error::merge-back-data: <CODE>`; exit 1 stops the job before the privacy gates. |
| `merge-data-pr` | `merge-data.yaml`: no argv | `false` | stdout JSON; exit 1 when the PR is conflicted or its mergeability could not be read. |
| `rename-tracked-repo` | `rename-tracked-repo.yaml`: no argv, `refs/heads/main` only | `false` | stdout `{"result": ...}`; stderr `::error::rename-tracked-repo: <CODE>`; exit 1 when blocked or failed. |
| `update-metadata` | `update-metadata.yaml`: no argv | `false` | stdout JSON summary, unconsumed. |

Argv that matches nothing declared, `--help` included, is a usage error: exit 1, usage on stderr, and nothing runs. A failure that used to escape as an uncaught throw now prints its message and exits 1 with no stack.

## Package diagram

```mermaid
C4Component
  title Components of @fro-bot/registry

  Container_Boundary(registry, "@fro-bot/registry") {
    Component(cli, "*-cli modules", "TypeScript", "goke CLIs: one per entrypoint")
    Component(reconcilecli, "reconcile-cli", "TypeScript", "goke CLI over handleReconcile")
    Component(handler, "reconcile-handler", "TypeScript", "I/O shell of a reconcile run")
    Component(plan, "reconcile-plan", "TypeScript", "Pure reconcile engine")
    Component(discovery, "reconcile-discovery", "TypeScript", "Read probes")
    Component(integrity, "reconcile-integrity", "TypeScript", "data tip-author and rules check")
    Component(effects, "reconcile-effects", "TypeScript", "Stars, dispatches, issue queue")
    Component(issues, "reconcile-issues", "TypeScript", "Issue payload renderers")
    Component(model, "reconcile-model", "TypeScript", "ReconcileError, client type, defaults")
    Component(commit, "commit-metadata", "TypeScript", "Mutator-based writer for data")
    Component(repos, "repos-metadata", "TypeScript", "Row helpers for repos.yaml")
    Component(writers, "Writers and gates", "TypeScript", "invitations, survey result, reset, onboarded, merge-back, merge-data-pr, rename, update-metadata")
  }

  System_Ext(entrypoints, "scripts/<name>.ts", "Six-line entrypoints run by workflows")
  System_Ext(core, "@fro-bot/core", "cli, github, retry, guards, wiki-authority")
  System_Ext(wwc, "@fro.bot/wiki-write-core", "schemas, data-branch-bootstrap, wiki-slug")
  System_Ext(github, "GitHub", "REST and Git Data API")

  Rel(entrypoints, cli, "main")
  Rel(entrypoints, reconcilecli, "main")
  Rel(reconcilecli, handler, "runs")
  Rel(handler, plan, "plans with")
  Rel(handler, discovery, "reads with")
  Rel(handler, integrity, "verifies with")
  Rel(handler, effects, "writes with")
  Rel(effects, issues, "renders with")
  Rel(handler, commit, "commits with")
  Rel(plan, repos, "builds rows with")
  Rel(plan, model, "uses")
  Rel(cli, writers, "runs")
  Rel(writers, commit, "commits with")
  Rel(writers, repos, "builds rows with")
  Rel(cli, core, "runs on")
  Rel(commit, core, "retries with")
  Rel(commit, wwc, "bootstraps data with")
  Rel(writers, wwc, "validates with")
  Rel(commit, github, "writes data to")
  Rel(effects, github, "dispatches and files issues on")

  UpdateRelStyle(entrypoints, cli, $offsetX="-60", $offsetY="-20")
  UpdateRelStyle(entrypoints, reconcilecli, $offsetX="20", $offsetY="-30")
  UpdateRelStyle(reconcilecli, handler, $offsetX="-10", $offsetY="10")
  UpdateRelStyle(handler, plan, $offsetX="-60", $offsetY="10")
  UpdateRelStyle(handler, discovery, $offsetX="-20", $offsetY="20")
  UpdateRelStyle(handler, integrity, $offsetX="20", $offsetY="20")
  UpdateRelStyle(handler, effects, $offsetX="60", $offsetY="10")
  UpdateRelStyle(effects, issues, $offsetX="-10", $offsetY="10")
  UpdateRelStyle(handler, commit, $offsetX="100", $offsetY="0")
  UpdateRelStyle(plan, repos, $offsetX="-30", $offsetY="30")
  UpdateRelStyle(plan, model, $offsetX="30", $offsetY="30")
  UpdateRelStyle(cli, writers, $offsetX="-20", $offsetY="10")
  UpdateRelStyle(writers, commit, $offsetX="-10", $offsetY="20")
  UpdateRelStyle(writers, repos, $offsetX="30", $offsetY="20")
  UpdateRelStyle(cli, core, $offsetX="-90", $offsetY="10")
  UpdateRelStyle(commit, core, $offsetX="-40", $offsetY="20")
  UpdateRelStyle(commit, wwc, $offsetX="10", $offsetY="30")
  UpdateRelStyle(writers, wwc, $offsetX="50", $offsetY="30")
  UpdateRelStyle(commit, github, $offsetX="-20", $offsetY="40")
  UpdateRelStyle(effects, github, $offsetX="20", $offsetY="40")
```

## Adding a module

1. Add `src/<name>.ts` and its subpath to `exports` in `package.json`. Use erasable TypeScript syntax only: Node strip-only loads the file, and Test Scripts Load fails on `enum`, `namespace` and parameter properties.
2. Add `src/<name>.test.ts` and import the module by relative path.
3. Keep regexes and other constants whose mutants matter inside functions.
4. List the module in `stryker.config.json` `mutate` (and its test in `testFiles`), or in `mutation-guards.json` `not-mutated` with a reason. `scripts/mutation-guards-config.test.ts` fails an unlisted module.
5. Update the diagram above and the package graph in the root `README.md`.
6. A new CLI gets a `*-cli.ts` module (the only kind that may import `@fro-bot/core/cli`), a six-line `scripts/<name>.ts` entrypoint, and a case in `scripts/registry-entrypoints.test.ts`.
