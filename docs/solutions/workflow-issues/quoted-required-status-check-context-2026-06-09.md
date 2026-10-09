---
title: Quote required-status-check contexts that contain a colon
date: 2026-06-09
category: workflow-issues
module: github-actions-workflows
problem_type: workflow_issue
component: development_workflow
severity: medium
last_updated: 2026-10-09
verified: 2026-06-09
applies_when:
  - Adding or renaming a required_status_checks.contexts entry in .github/settings.yml
  - Any settings.yml value contains a colon-space, slash, or other YAML-significant punctuation
  - A commit-status context must match byte-for-byte across the workflow POST, settings.yml, and docs
  - Promoting a workflow job to a required branch-protection check
  - A workflow-to-settings context contract could drift if both files restate the same literal
root_cause: config_error
resolution_type: config_change
related_components:
  - development_workflow
tags:
  - yaml
  - quoting
  - github-actions
  - branch-protection
  - repository-settings
  - required-checks
---

# Quote required-status-check contexts that contain a colon

## Context

A required GitHub branch-protection status check was renamed to a friendlier
name containing a colon: `Security: Private Leak Scan`. It was added to
`.github/settings.yml` under `branches[].protection.required_status_checks.contexts`
as an unquoted YAML list item, which made it parse as a mapping instead of a
string — and the settings sync silently rejected it.

## Guidance

Treat any status-check context as a literal string and quote it whenever it
contains YAML-significant punctuation (a colon followed by a space is the common
trap). Keep the exact string byte-identical across every surface that references
it: the workflow that posts the commit status, the `settings.yml` required-checks
list, and any docs.

**Bad** — parses as a mapping `{Security: "Private Leak Scan"}`:

```yaml
contexts:
  - Security: Private Leak Scan
```

**Good** — a scalar string:

```yaml
contexts:
  - 'Security: Private Leak Scan'
```

A GitHub commit *status* (as opposed to a check-run) displays its `context`
verbatim on the PR — there is no separate display name. So the "friendly name"
of a status check *is* its `context` string, and that string must match exactly
in all three places:

- the workflow POST — `gh api repos/.../statuses/{sha} -f context="Security: Private Leak Scan"`
- the `settings.yml` required-checks entry
- operator docs (`metadata/README.md`)

A mismatch leaves branch protection waiting forever on a context that never arrives.

### Derive required-check contexts from the workflow

When a workflow job becomes a required check, do not have a test restate the context string by hand.
Parse the workflow, read the job's own `name`, and assert that `.github/settings.yml` contains that
derived value. PR #3860 did this when it made `Check Mutation Guards` required
(`scripts/main-workflow.test.ts`):

```ts
const job = parsedWorkflow.jobs['check-mutation-guards']

it('lists the check-mutation-guards job name as a required status check context (byte-for-byte, not a repeated literal)', () => {
  expect(job?.name).toBeDefined()
  expect(mainBranch?.protection?.required_status_checks?.contexts).toContain(job?.name)
})
```

The workflow is then the source of truth for the check name. Renaming the job without updating branch
protection fails the test, and so does renaming the settings entry without the job. This covers the
`check-mutation-guards` job; it is not a repo-wide assertion over every context, so a new required
check needs its own derived assertion.

Keep the sibling invariant from the quoting failure above: type `contexts` as `unknown[]` and assert
that every entry is a string. A `string[]` type would assume away the failure this document is about.

```ts
for (const context of contexts ?? []) {
  expect(typeof context, `context entry ${JSON.stringify(context)} is not a string`).toBe('string')
}
```

### Check how a required context can go unreported or skipped

GitHub treats a skipped workflow and a skipped job differently
("Handling skipped but required checks" in the GitHub docs):

| Cause | Required check |
| --- | --- |
| Workflow skipped by `paths`/`branches` filtering or a commit-message skip | Stays "Pending" and blocks merging |
| Job skipped by `jobs.<job_id>.if` | Reports "Success" and satisfies the check without running anything |

A skipped workflow is the deadlock. A job-level `if:` that can be false on a PR is the opposite
risk: a silent pass that validates nothing. Before adding a job name to
`required_status_checks.contexts`:

- Confirm the workflow has no `paths:` or `branches:` filter that can skip the whole run for
  ordinary PRs, and that `pull_request.types` covers the lifecycle events the repo accepts for review
  (`opened`, `ready_for_review`, `reopened`, `synchronize` in `main.yaml`). A missing context also
  blocks the PR.
- Confirm the workflow runs on an event GitHub evaluates for pull requests (such as `pull_request`),
  not `workflow_dispatch`.
- Do not put an applicability decision in a job-level `if:` that can be false on PRs. Put it inside
  the job and exit `0` for "not applicable", so the decision is explicit and visible in the log.
- Check that existing required jobs run under the same trigger and checkout ref, or justify the
  difference.

`Check Mutation Guards` is built this way. Its job-level condition is only
`github.event_name == 'pull_request'`, because a push to `main` has no PR to diff against. The
changed-file gate lives in `scripts/check-mutation-guards.ts`: an unmatched change set returns
`not-applicable`, which maps to exit code `0`. A job-level skip would also report Success, but with
no record of why validation did not run; the in-script gate leaves that decision in the job's output.

## Why This Matters

In YAML, `- key: value` (colon + space) is a single-pair mapping, not a scalar.
So the branch-protection sync read `{"Security": "Private Leak Scan"}` where the
GitHub API requires `contexts` to be an array of strings, and rejected the whole
branch-protection update.

The insidious part: this passed `pnpm lint` and **all** pull-request CI.
`.github/settings.yml` is consumed only by the settings-sync workflow at apply
time — nothing validates it during PR CI — so the bug shipped green and surfaced
only when the sync ran post-merge. The required check was never registered, and
the failure was visible only in the `Update Repository Settings` workflow run, not
on the PR.

## When to Apply

Any time you add or rename a `required_status_checks.contexts` entry — or set any
`settings.yml` value — that contains:

- `: ` (colon-space)
- `/`
- other YAML-significant punctuation

Contexts without such punctuation (e.g. `Test Scripts Load`) are fine unquoted;
the quote is only required when the raw token would parse as something other than
a string.

## Examples

Failing settings-sync log:

```text
Failed to apply branches settings: Invalid request.
For 'items', {"Security" => "Private Leak Scan"} is not a string.
For 'anyOf/1', {"strict"=>true, "contexts"=>[..., {"Security"=>"Private Leak Scan"}, ...]} is not a null.
```

Corrected YAML:

```yaml
contexts:
  - 'Security: Private Leak Scan'
```

Verifying the fix (note: an operator token may have `repo` scope but not
`administration:read`, in which case `gh api repos/.../branches/main/protection/...`
returns 404 — you cannot read protection directly). Verify through the sync run
instead:

- re-run `update-repo-settings.yaml`
- confirm the log says `Branch protection updated for: main`
- confirm there are no `is not a string` errors

## Related

- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) — GitHub docs: a workflow skipped by path/branch filtering leaves its checks pending, while a job skipped by a conditional reports Success.
- [Using conditions to control job execution](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions) — GitHub docs: a skipped job reports "Success" and does not block a pull request, even when its check is required.
- [Normalize redacted metadata YAML quoting before data promotion](../integration-issues/normalize-redacted-yaml-quotes-2026-05-09.md) — a sibling YAML-quoting trap (scalar quote *style*) where a green producer workflow wrote a shape that broke a later step.
- [GitHub Actions step output interpolation](github-actions-step-output-interpolation-2026-04-21.md) — the same "keep the value byte-exact across surfaces" discipline in a workflow-shell context.
