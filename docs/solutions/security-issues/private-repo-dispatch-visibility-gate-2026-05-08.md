---
title: Private repo dispatch requires definitive public visibility
category: security-issues
problem_type: security_issue
component: tooling
root_cause: missing_validation
resolution_type: code_fix
severity: high
date: 2026-05-08
last_updated: 2026-05-08
module: scripts/reconcile-repos.ts
related_components:
  - development_workflow
  - testing_framework
tags:
  - privacy
  - private-repos
  - workflow-dispatch
  - reconcile
  - redaction
  - node-id
  - fail-closed
verified: true
symptoms:
  - Survey dispatch planning could include canonical owner/name for private, unknown, or visibility-conflicting repos.
  - Duplicate access-list rows sharing a node_id could allow a public-looking alias to dispatch before private visibility was considered.
  - Stored-public/live-private entries needed redaction and dispatch suppression in the same reconcile pass.
  - Internal skipped-private counters risked becoming a public commit-message side channel.
---

## Problem

Survey dispatch planning needs the same privacy boundary as metadata storage: private repo identities must never appear in public workflow inputs, commit subjects, issues, or logs.

The dangerous shape is a repo that looks public in one source but private or unknown in another. If dispatch planning trusts the public-looking source, it can send canonical `owner`/`repo` values through `workflow_dispatch` before redaction catches up.

## Symptoms

- Private access-list entries are redacted in metadata, but edge dispatch paths can still use canonical `owner`/`repo`.
- Missing or malformed `private` fields can be treated as public by boolean coercion.
- Duplicate access-list rows with the same `node_id` can make dispatch behavior depend on row ordering.
- Stored-public entries that become live-private can dispatch before the field-refresh path redacts them.
- Aggregate private-skip counts are safe in internal JSON, but unsafe in public commit subjects.

## What Didn't Work

- **Checking only `access.private === true`** fails open for `undefined`, `null`, malformed, or conflicting privacy data.
- **Trusting stored metadata alone** misses same-run visibility flips from public to private.
- **Trusting one access-list row at a time** misses duplicate aliases for the same GitHub repo identity.
- **Counting all private tracked repos as skipped dispatches** makes operational summaries noisy; only repos that would otherwise dispatch should increment the counter.
- **Putting aggregate private counts in public commit messages** creates a side channel about private repo activity.

## Solution

Make dispatch opt-in to public visibility. A repo can dispatch only when stored metadata and the live access-list state are both definitively public.

The reconcile engine now builds a node-level privacy index across the whole access list:

```ts
const accessNodePrivacy = indexAccessNodePrivacy(accessList)
```

The index treats anything not explicitly public as non-public, and duplicate `node_id` rows as unsafe:

```ts
function accessPrivateForStorage(access: AccessListEntry, accessNodePrivacy: Map<string, AccessNodePrivacy>): boolean {
  const nodePrivacy = accessNodePrivacy.get(access.node_id)
  return access.private !== false || nodePrivacy?.hasNonPublic === true || (nodePrivacy?.count ?? 0) > 1
}
```

Newcomers and regained entries use that derived privacy state before writing metadata or queueing dispatches:

```ts
const accessPrivate = accessPrivateForStorage(access, accessNodePrivacy)

next = addRepoEntry(next, {
  owner: access.owner,
  repo: access.name,
  private: accessPrivate,
  node_id: access.node_id,
  now,
})

if (accessPrivate) {
  summary.skippedPrivate += 1
} else {
  dispatches.push({owner: access.owner, repo: access.name})
}
```

Tracked entries compute survey eligibility separately, then apply the privacy gate only to repos that would otherwise dispatch:

```ts
const wouldDispatchIfPublic =
  (entry.onboarding_status === 'onboarded' && isEligibleForSurvey(entry.next_survey_eligible_at, params.now)) ||
  (entry.onboarding_status === 'pending' &&
    (entry.last_survey_status !== 'success' || isEligibleForSurvey(entry.next_survey_eligible_at, params.now)))

if (wouldDispatchIfPublic && (entry.private !== false || accessPrivate)) {
  summary.skippedPrivate += 1
} else if (wouldDispatchIfPublic) {
  dispatches.push({owner: access.owner, repo: access.name})
}
```

`summary.skippedPrivate` remains available in internal JSON output, but `formatCommitMessage` intentionally omits it so public commit subjects do not reveal private activity.

## Why This Works

The invariant changes from “dispatch unless known private” to “dispatch only when definitively public.” That closes the leak window for missing data, stale stored metadata, duplicate aliases, and same-run visibility flips.

The `node_id` privacy index makes privacy a property of the GitHub repository identity, not whichever access-list row happens to be processed first. Requiring both stored and live public visibility prevents canonical dispatch inputs from racing ahead of redaction.

## Prevention

Keep these regressions in place around any future reconcile dispatch changes:

- Duplicate `node_id` aliases in both row orders must not dispatch if any alias is non-public.
- Missing `private` on an access-list entry must fail closed.
- Stored-public/live-private entries must redact and skip in the same pass.
- Regained lost-access entries dispatch only when live visibility is explicitly public.
- Private entries that are not survey-eligible must not inflate `summary.skippedPrivate`.
- Public commit subjects must not include private-skip counts.

Review any future `workflow_dispatch` inputs as public artifacts. If an input would be unsafe in a GitHub Actions run page, it must be redacted or replaced with an opaque identifier before dispatch.

## Related Issues

- PR: https://github.com/fro-bot/.github/pull/3265
- Related (workflow-side counterpart): `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — operationalizes this doc's closing prevention rule by enforcing the same privacy invariant inside the Survey Repo workflow itself (opaque `node_id` input, GraphQL resolve+verify, recheck before persistence)
- Related: `docs/solutions/best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md`
- Related: `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`
- Related: `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`
- Related: `docs/solutions/workflow-issues/github-actions-step-output-interpolation-2026-04-21.md`
