---
title: Quote required-status-check contexts that contain a colon
date: 2026-06-09
category: workflow-issues
module: github-actions-workflows
problem_type: workflow_issue
component: development_workflow
severity: medium
last_updated: 2026-06-09
verified: 2026-06-09
applies_when:
  - Adding or renaming a required_status_checks.contexts entry in .github/settings.yml
  - Any settings.yml value contains a colon-space, slash, or other YAML-significant punctuation
  - A commit-status context must match byte-for-byte across the workflow POST, settings.yml, and docs
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

- [Normalize redacted metadata YAML quoting before data promotion](../integration-issues/normalize-redacted-yaml-quotes-2026-05-09.md) — a sibling YAML-quoting trap (scalar quote *style*) where a green producer workflow wrote a shape that broke a later step.
- [GitHub Actions step output interpolation](github-actions-step-output-interpolation-2026-04-21.md) — the same "keep the value byte-exact across surfaces" discipline in a workflow-shell context.
