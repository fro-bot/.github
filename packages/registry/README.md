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
    Component(check_repo_onboarded, "check-repo-onboarded", "TypeScript", "Survey routing gate; fails closed to onboarded=false")
    Component(check_repo_onboarded_cli, "check-repo-onboarded-cli", "TypeScript", "goke CLI")
    Component(commit_metadata, "commit-metadata", "TypeScript", "Mutator-based writer for data, 409 retry")
    Component(handle_invitation, "handle-invitation", "TypeScript", "Invitation polling against the allowlist")
    Component(handle_invitation_cli, "handle-invitation-cli", "TypeScript", "goke CLI")
    Component(merge_back_data, "merge-back-data", "TypeScript", "Merges main into data; mutated")
    Component(merge_back_data_cli, "merge-back-data-cli", "TypeScript", "goke CLI; mutated")
    Component(merge_data_pr, "merge-data-pr", "TypeScript", "Opens the data to main promotion PR")
    Component(merge_data_pr_cli, "merge-data-pr-cli", "TypeScript", "goke CLI")
    Component(metadata_wiki_rename_guard, "metadata-wiki-rename-guard", "TypeScript", "Stops a rename from stranding a wiki page")
    Component(record_survey_result, "record-survey-result", "TypeScript", "Survey outcome write-back")
    Component(record_survey_result_cli, "record-survey-result-cli", "TypeScript", "goke CLI")
    Component(registry_io, "registry-io", "TypeScript", "RegistryIo sink type; type only")
    Component(rename_tracked_repo, "rename-tracked-repo", "TypeScript", "Operator rename: row and wiki page in one commit")
    Component(rename_tracked_repo_cli, "rename-tracked-repo-cli", "TypeScript", "goke CLI")
    Component(repos_metadata, "repos-metadata", "TypeScript", "Row helpers for repos.yaml")
    Component(reset_survey_status, "reset-survey-status", "TypeScript", "Operator recovery for survey fields")
    Component(reset_survey_status_cli, "reset-survey-status-cli", "TypeScript", "goke CLI")
    Component(update_metadata, "update-metadata", "TypeScript", "Renovate metadata refresh")
    Component(update_metadata_cli, "update-metadata-cli", "TypeScript", "goke CLI")
    Boundary(reconcile, "reconcile-repos seams") {
      Component(reconcile_cli, "reconcile-cli", "TypeScript", "goke CLI over handleReconcile")
      Component(reconcile_discovery, "reconcile-discovery", "TypeScript", "Read probes: access list, status, identity, channels")
      Component(reconcile_effects, "reconcile-effects", "TypeScript", "Writes: stars, dispatches, issue queue, labels")
      Component(reconcile_handler, "reconcile-handler", "TypeScript", "I/O shell: read, plan, verify, commit, act")
      Component(reconcile_integrity, "reconcile-integrity", "TypeScript", "data tip-author and rules check, alert issue")
      Component(reconcile_issues, "reconcile-issues", "TypeScript", "Pure issue payload renderers")
      Component(reconcile_labels, "reconcile-labels", "TypeScript", "Label constants; a leaf")
      Component(reconcile_model, "reconcile-model", "TypeScript", "ReconcileError, client type, defaults; a leaf")
      Component(reconcile_plan, "reconcile-plan", "TypeScript", "Pure reconcile engine")
    }
  }

  System_Ext(entrypoints, "scripts/<name>.ts", "Six-line entrypoints run by workflows")
  System_Ext(core, "@fro-bot/core", "cli, github, retry, guards, wiki-authority")
  System_Ext(wwc, "@fro.bot/wiki-write-core", "schemas, data-branch-bootstrap, wiki-slug, wiki-utils")
  System_Ext(github, "GitHub", "REST and Git Data API")

  Rel(entrypoints, check_repo_onboarded_cli, "main")
  Rel(entrypoints, handle_invitation_cli, "main")
  Rel(entrypoints, merge_back_data_cli, "main")
  Rel(entrypoints, merge_data_pr_cli, "main")
  Rel(entrypoints, reconcile_cli, "main")
  Rel(entrypoints, record_survey_result_cli, "main")
  Rel(entrypoints, rename_tracked_repo_cli, "main")
  Rel(entrypoints, reset_survey_status_cli, "main")
  Rel(entrypoints, update_metadata_cli, "main")
  Rel(check_repo_onboarded, registry_io, "types with")
  Rel(check_repo_onboarded, repos_metadata, "imports")
  Rel(check_repo_onboarded_cli, check_repo_onboarded, "runs")
  Rel(handle_invitation, commit_metadata, "imports")
  Rel(handle_invitation, registry_io, "types with")
  Rel(handle_invitation, repos_metadata, "imports")
  Rel(handle_invitation_cli, handle_invitation, "runs")
  Rel(merge_back_data, merge_data_pr, "imports")
  Rel(merge_back_data_cli, merge_back_data, "runs")
  Rel(merge_data_pr, registry_io, "types with")
  Rel(merge_data_pr_cli, merge_data_pr, "runs")
  Rel(metadata_wiki_rename_guard, commit_metadata, "imports")
  Rel(reconcile_cli, reconcile_handler, "runs")
  Rel(reconcile_cli, reconcile_model, "runs")
  Rel(reconcile_discovery, reconcile_model, "imports")
  Rel(reconcile_discovery, reconcile_plan, "imports")
  Rel(reconcile_effects, reconcile_discovery, "imports")
  Rel(reconcile_effects, reconcile_issues, "imports")
  Rel(reconcile_effects, reconcile_labels, "imports")
  Rel(reconcile_effects, reconcile_model, "imports")
  Rel(reconcile_effects, reconcile_plan, "imports")
  Rel(reconcile_handler, commit_metadata, "imports")
  Rel(reconcile_handler, metadata_wiki_rename_guard, "imports")
  Rel(reconcile_handler, reconcile_discovery, "imports")
  Rel(reconcile_handler, reconcile_effects, "imports")
  Rel(reconcile_handler, reconcile_integrity, "imports")
  Rel(reconcile_handler, reconcile_model, "imports")
  Rel(reconcile_handler, reconcile_plan, "imports")
  Rel(reconcile_integrity, reconcile_effects, "imports")
  Rel(reconcile_integrity, reconcile_labels, "imports")
  Rel(reconcile_integrity, reconcile_model, "imports")
  Rel(reconcile_issues, reconcile_labels, "imports")
  Rel(reconcile_issues, reconcile_plan, "imports")
  Rel(reconcile_plan, metadata_wiki_rename_guard, "imports")
  Rel(reconcile_plan, repos_metadata, "imports")
  Rel(record_survey_result, commit_metadata, "imports")
  Rel(record_survey_result, registry_io, "types with")
  Rel(record_survey_result, repos_metadata, "imports")
  Rel(record_survey_result_cli, record_survey_result, "runs")
  Rel(rename_tracked_repo_cli, rename_tracked_repo, "runs")
  Rel(reset_survey_status, commit_metadata, "imports")
  Rel(reset_survey_status, registry_io, "types with")
  Rel(reset_survey_status, repos_metadata, "imports")
  Rel(reset_survey_status_cli, reset_survey_status, "runs")
  Rel(update_metadata, commit_metadata, "imports")
  Rel(update_metadata, registry_io, "types with")
  Rel(update_metadata_cli, update_metadata, "runs")
  Rel(check_repo_onboarded_cli, core, "runs on")
  Rel(handle_invitation_cli, core, "runs on")
  Rel(merge_back_data_cli, core, "runs on")
  Rel(merge_data_pr_cli, core, "runs on")
  Rel(reconcile_cli, core, "runs on")
  Rel(record_survey_result_cli, core, "runs on")
  Rel(rename_tracked_repo_cli, core, "runs on")
  Rel(reset_survey_status_cli, core, "runs on")
  Rel(update_metadata_cli, core, "runs on")
  Rel(commit_metadata, core, "imports")
  Rel(commit_metadata, wwc, "imports")
  Rel(commit_metadata, github, "calls")
  Rel(handle_invitation, core, "imports")
  Rel(handle_invitation, wwc, "imports")
  Rel(handle_invitation, github, "calls")
  Rel(merge_back_data, core, "imports")
  Rel(merge_back_data, wwc, "imports")
  Rel(merge_back_data, github, "calls")
  Rel(merge_data_pr, core, "imports")
  Rel(merge_data_pr, github, "calls")
  Rel(metadata_wiki_rename_guard, wwc, "imports")
  Rel(reconcile_discovery, core, "imports")
  Rel(reconcile_discovery, wwc, "imports")
  Rel(reconcile_discovery, github, "calls")
  Rel(reconcile_effects, core, "imports")
  Rel(reconcile_effects, wwc, "imports")
  Rel(reconcile_effects, github, "calls")
  Rel(reconcile_handler, core, "imports")
  Rel(reconcile_handler, wwc, "imports")
  Rel(reconcile_integrity, core, "imports")
  Rel(reconcile_integrity, github, "calls")
  Rel(reconcile_plan, wwc, "imports")
  Rel(record_survey_result, wwc, "imports")
  Rel(rename_tracked_repo, core, "imports")
  Rel(rename_tracked_repo, wwc, "imports")
  Rel(rename_tracked_repo, github, "calls")
  Rel(repos_metadata, wwc, "imports")
  Rel(update_metadata, core, "imports")
  Rel(update_metadata, wwc, "imports")
  Rel(update_metadata, github, "calls")

  UpdateRelStyle(entrypoints, check_repo_onboarded_cli, $offsetX="-80", $offsetY="-50")
  UpdateRelStyle(entrypoints, handle_invitation_cli, $offsetX="-43", $offsetY="3")
  UpdateRelStyle(entrypoints, merge_back_data_cli, $offsetX="-6", $offsetY="-45")
  UpdateRelStyle(entrypoints, merge_data_pr_cli, $offsetX="31", $offsetY="8")
  UpdateRelStyle(entrypoints, reconcile_cli, $offsetX="68", $offsetY="-40")
  UpdateRelStyle(entrypoints, record_survey_result_cli, $offsetX="-56", $offsetY="13")
  UpdateRelStyle(entrypoints, rename_tracked_repo_cli, $offsetX="-19", $offsetY="-35")
  UpdateRelStyle(entrypoints, reset_survey_status_cli, $offsetX="18", $offsetY="18")
  UpdateRelStyle(entrypoints, update_metadata_cli, $offsetX="55", $offsetY="-30")
  UpdateRelStyle(check_repo_onboarded, registry_io, $offsetX="-69", $offsetY="23")
  UpdateRelStyle(check_repo_onboarded, repos_metadata, $offsetX="-32", $offsetY="-25")
  UpdateRelStyle(check_repo_onboarded_cli, check_repo_onboarded, $offsetX="5", $offsetY="28")
  UpdateRelStyle(handle_invitation, commit_metadata, $offsetX="42", $offsetY="-20")
  UpdateRelStyle(handle_invitation, registry_io, $offsetX="79", $offsetY="33")
  UpdateRelStyle(handle_invitation, repos_metadata, $offsetX="-45", $offsetY="-15")
  UpdateRelStyle(handle_invitation_cli, handle_invitation, $offsetX="-8", $offsetY="38")
  UpdateRelStyle(merge_back_data, merge_data_pr, $offsetX="29", $offsetY="-10")
  UpdateRelStyle(merge_back_data_cli, merge_back_data, $offsetX="66", $offsetY="43")
  UpdateRelStyle(merge_data_pr, registry_io, $offsetX="-58", $offsetY="-5")
  UpdateRelStyle(merge_data_pr_cli, merge_data_pr, $offsetX="-21", $offsetY="48")
  UpdateRelStyle(metadata_wiki_rename_guard, commit_metadata, $offsetX="16", $offsetY="0")
  UpdateRelStyle(reconcile_cli, reconcile_handler, $offsetX="53", $offsetY="-48")
  UpdateRelStyle(reconcile_cli, reconcile_model, $offsetX="-71", $offsetY="5")
  UpdateRelStyle(reconcile_discovery, reconcile_model, $offsetX="-34", $offsetY="-43")
  UpdateRelStyle(reconcile_discovery, reconcile_plan, $offsetX="3", $offsetY="10")
  UpdateRelStyle(reconcile_effects, reconcile_discovery, $offsetX="40", $offsetY="-38")
  UpdateRelStyle(reconcile_effects, reconcile_issues, $offsetX="77", $offsetY="15")
  UpdateRelStyle(reconcile_effects, reconcile_labels, $offsetX="-47", $offsetY="-33")
  UpdateRelStyle(reconcile_effects, reconcile_model, $offsetX="-10", $offsetY="20")
  UpdateRelStyle(reconcile_effects, reconcile_plan, $offsetX="27", $offsetY="-28")
  UpdateRelStyle(reconcile_handler, commit_metadata, $offsetX="64", $offsetY="25")
  UpdateRelStyle(reconcile_handler, metadata_wiki_rename_guard, $offsetX="-60", $offsetY="-23")
  UpdateRelStyle(reconcile_handler, reconcile_discovery, $offsetX="-23", $offsetY="30")
  UpdateRelStyle(reconcile_handler, reconcile_effects, $offsetX="14", $offsetY="-18")
  UpdateRelStyle(reconcile_handler, reconcile_integrity, $offsetX="51", $offsetY="35")
  UpdateRelStyle(reconcile_handler, reconcile_model, $offsetX="-73", $offsetY="-13")
  UpdateRelStyle(reconcile_handler, reconcile_plan, $offsetX="-36", $offsetY="40")
  UpdateRelStyle(reconcile_integrity, reconcile_effects, $offsetX="1", $offsetY="-8")
  UpdateRelStyle(reconcile_integrity, reconcile_labels, $offsetX="38", $offsetY="45")
  UpdateRelStyle(reconcile_integrity, reconcile_model, $offsetX="75", $offsetY="-3")
  UpdateRelStyle(reconcile_issues, reconcile_labels, $offsetX="-49", $offsetY="50")
  UpdateRelStyle(reconcile_issues, reconcile_plan, $offsetX="-12", $offsetY="2")
  UpdateRelStyle(reconcile_plan, metadata_wiki_rename_guard, $offsetX="25", $offsetY="-46")
  UpdateRelStyle(reconcile_plan, repos_metadata, $offsetX="62", $offsetY="7")
  UpdateRelStyle(record_survey_result, commit_metadata, $offsetX="-62", $offsetY="-41")
  UpdateRelStyle(record_survey_result, registry_io, $offsetX="-25", $offsetY="12")
  UpdateRelStyle(record_survey_result, repos_metadata, $offsetX="12", $offsetY="-36")
  UpdateRelStyle(record_survey_result_cli, record_survey_result, $offsetX="49", $offsetY="17")
  UpdateRelStyle(rename_tracked_repo_cli, rename_tracked_repo, $offsetX="-75", $offsetY="-31")
  UpdateRelStyle(reset_survey_status, commit_metadata, $offsetX="-38", $offsetY="22")
  UpdateRelStyle(reset_survey_status, registry_io, $offsetX="-1", $offsetY="-26")
  UpdateRelStyle(reset_survey_status, repos_metadata, $offsetX="36", $offsetY="27")
  UpdateRelStyle(reset_survey_status_cli, reset_survey_status, $offsetX="73", $offsetY="-21")
  UpdateRelStyle(update_metadata, commit_metadata, $offsetX="-51", $offsetY="32")
  UpdateRelStyle(update_metadata, registry_io, $offsetX="-14", $offsetY="-16")
  UpdateRelStyle(update_metadata_cli, update_metadata, $offsetX="23", $offsetY="37")
  UpdateRelStyle(check_repo_onboarded_cli, core, $offsetX="60", $offsetY="-11")
  UpdateRelStyle(handle_invitation_cli, core, $offsetX="-64", $offsetY="42")
  UpdateRelStyle(merge_back_data_cli, core, $offsetX="-27", $offsetY="-6")
  UpdateRelStyle(merge_data_pr_cli, core, $offsetX="10", $offsetY="47")
  UpdateRelStyle(reconcile_cli, core, $offsetX="47", $offsetY="-1")
  UpdateRelStyle(record_survey_result_cli, core, $offsetX="-77", $offsetY="-49")
  UpdateRelStyle(rename_tracked_repo_cli, core, $offsetX="-40", $offsetY="4")
  UpdateRelStyle(reset_survey_status_cli, core, $offsetX="-3", $offsetY="-44")
  UpdateRelStyle(update_metadata_cli, core, $offsetX="34", $offsetY="9")
  UpdateRelStyle(commit_metadata, core, $offsetX="71", $offsetY="-39")
  UpdateRelStyle(commit_metadata, wwc, $offsetX="-53", $offsetY="14")
  UpdateRelStyle(commit_metadata, github, $offsetX="-16", $offsetY="-34")
  UpdateRelStyle(handle_invitation, core, $offsetX="21", $offsetY="19")
  UpdateRelStyle(handle_invitation, wwc, $offsetX="58", $offsetY="-29")
  UpdateRelStyle(handle_invitation, github, $offsetX="-66", $offsetY="24")
  UpdateRelStyle(merge_back_data, core, $offsetX="-29", $offsetY="-24")
  UpdateRelStyle(merge_back_data, wwc, $offsetX="8", $offsetY="29")
  UpdateRelStyle(merge_back_data, github, $offsetX="45", $offsetY="-19")
  UpdateRelStyle(merge_data_pr, core, $offsetX="-79", $offsetY="34")
  UpdateRelStyle(merge_data_pr, github, $offsetX="-42", $offsetY="-14")
  UpdateRelStyle(metadata_wiki_rename_guard, wwc, $offsetX="-5", $offsetY="39")
  UpdateRelStyle(reconcile_discovery, core, $offsetX="32", $offsetY="-9")
  UpdateRelStyle(reconcile_discovery, wwc, $offsetX="69", $offsetY="44")
  UpdateRelStyle(reconcile_discovery, github, $offsetX="-55", $offsetY="-4")
  UpdateRelStyle(reconcile_effects, core, $offsetX="-18", $offsetY="49")
  UpdateRelStyle(reconcile_effects, wwc, $offsetX="19", $offsetY="1")
  UpdateRelStyle(reconcile_effects, github, $offsetX="56", $offsetY="-47")
  UpdateRelStyle(reconcile_handler, core, $offsetX="-68", $offsetY="6")
  UpdateRelStyle(reconcile_handler, wwc, $offsetX="-31", $offsetY="-42")
  UpdateRelStyle(reconcile_integrity, core, $offsetX="6", $offsetY="11")
  UpdateRelStyle(reconcile_integrity, github, $offsetX="43", $offsetY="-37")
  UpdateRelStyle(reconcile_plan, wwc, $offsetX="80", $offsetY="16")
  UpdateRelStyle(record_survey_result, wwc, $offsetX="-44", $offsetY="-32")
  UpdateRelStyle(rename_tracked_repo, core, $offsetX="-7", $offsetY="21")
  UpdateRelStyle(rename_tracked_repo, wwc, $offsetX="30", $offsetY="-27")
  UpdateRelStyle(rename_tracked_repo, github, $offsetX="67", $offsetY="26")
  UpdateRelStyle(repos_metadata, wwc, $offsetX="-57", $offsetY="-22")
  UpdateRelStyle(update_metadata, core, $offsetX="-20", $offsetY="31")
  UpdateRelStyle(update_metadata, wwc, $offsetX="17", $offsetY="-17")
  UpdateRelStyle(update_metadata, github, $offsetX="54", $offsetY="36")
```

## Adding a module

1. Add `src/<name>.ts` and its subpath to `exports` in `package.json`. Use erasable TypeScript syntax only: Node strip-only loads the file, and Test Scripts Load fails on `enum`, `namespace` and parameter properties.
2. Add `src/<name>.test.ts` and import the module by relative path.
3. Keep regexes and other constants whose mutants matter inside functions.
4. List the module in `stryker.config.json` `mutate` (and its test in `testFiles`), or in `mutation-guards.json` `not-mutated` with a reason. `scripts/mutation-guards-config.test.ts` fails an unlisted module.
5. Update the diagram above and the package graph in the root `README.md`.
6. A new CLI gets a `*-cli.ts` module (the only kind that may import `@fro-bot/core/cli`), a six-line `scripts/<name>.ts` entrypoint, and a case in `scripts/registry-entrypoints.test.ts`.
