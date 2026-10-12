---
title: Pin every App token mint in a repo-wide contract test
date: 2026-10-10
last_updated: 2026-10-10
verified: 2026-10-10
category: best-practices
module: github-workflows
problem_type: best_practice
component: development_workflow
severity: high
root_cause: missing_permission
resolution_type: workflow_improvement
applies_when:
  - a workflow adds or changes an actions/create-github-app-token step
  - a mint sets owner without repositories, which yields an owner-wide token
  - a mint takes repositories from a computed list such as a planning step output
tags:
  - app-installation-tokens
  - least-privilege
  - github-actions
  - contract-test
  - owner-wide-token
---

# Pin every App token mint in a repo-wide contract test

## Context

A workflow's `permissions:` block constrains only `GITHUB_TOKEN`. It says nothing about a token minted by `actions/create-github-app-token`. A mint step with no `permission-*` input is not narrowed to what the workflow needs, and if `owner` is set while `repositories` is empty, the pinned action's README says "access will be scoped to all repositories in the provided repository owner's installation".

Before PR #3974 (parent commit `6b999fa`), eight mint steps across seven workflows had no `permission-*` inputs, and three of them were owner-wide: `dispatch-renovate`, `reconcile-repos` and `update-metadata`. Nothing failed, because a token that can do more than it needs works exactly like one that can do less.

[A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time](credential-mint-time-permission-scoping-2026-06-22.md) states the principle. This document covers how to enforce it across a whole repository, and the reach and endpoint details that principle leaves open.

## Guidance

1. **Give every mint explicit `permission-*` inputs and explicit reach.** Reach is either `repositories:` naming this repository, or a computed list.
2. **Treat owner-wide mints as exemptions, and pin each one.** Key it by file, job and step id, with its owner and permissions. A write on an owner-wide token is forbidden unless that exemption is pinned.
3. **Clean computed `repositories:` lists, and skip the mint when the list is empty.** Trim, drop empty entries and dedupe. Guard both the mint and the step that consumes it on a non-empty list, because the action treats an empty `repositories:` as owner-wide.
4. **Split owner-wide reads from writes.** The discovery token is owner-wide and read-only. The writer token covers this repository only and does the writing. Each token reaches only the steps that need it.
5. **Base the repo-wide test on parsed YAML, not prose.** Fail on unknown mints, missing rows, missing step ids and an empty scan, and enforce non-vacuity floors so a refactor that stops matching mints fails loudly.
6. **Map each call to its permission, and state only what the docs support.**
   - `pulls.updateBranch` requires pull-requests write. For a GitHub App it also requires contents write on the head repository; that comes from the endpoint description, not the permission table.
   - Deleting a cache, by key or by id, requires actions write.
   - `GET /installation/repositories` has no entry in the permission table. "No permission needed" is an inference from that absence.
   - Adding labels requires issues write, but the endpoint carries `additional-permissions: true` without naming the extra permission. Do not assume issues write alone is enough on a pull request.

## Why This Matters

A missing or oversized scope stays silent until a call exercises it. Recovery paths such as `pulls.updateBranch` run rarely, so a 403 from a too-narrow scope can surface weeks after the change. A too-wide scope never surfaces at all; it only widens the damage when a token leaks.

The contract test also needs its own tests. During review of #3974, the scan that looks for other steps consuming a split token matched only `steps.<id>.outputs.token` in dot notation. A leak written as `steps['writer-token'].outputs.token` slipped through. Matching on bracket notation, mixed notation, extra whitespace and any letter case closed it. A regex-based scan needs a fixture for each notation, or it quietly matches less than it claims.

## When to Apply

- Adding or changing any `create-github-app-token` step.
- Setting `owner` without `repositories`.
- Taking `repositories` from a computed list.
- Splitting a token into discovery and writer clients.

## Examples

**A repository-scoped writer** (`.github/workflows/wiki-lint.yaml:124-132`):

```yaml
      # issues: write covers the issues.* calls in wiki-lint-issues.ts; it makes no contents calls.
      - name: Mint App token
        id: app-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          app-id: ${{ secrets.APPLICATION_ID }}
          private-key: ${{ secrets.APPLICATION_PRIVATE_KEY }}
          repositories: ${{ github.event.repository.name }}
          permission-issues: write
```

**A mint from a computed list** (`.github/workflows/dispatch-renovate.yaml:45-56`):

```yaml
      # actions: write covers listWorkflowRuns and createWorkflowDispatch on the planned repos only.
      # An empty plan skips this mint, so `repositories:` can never resolve empty (owner-wide).
      - id: dispatch-token
        if: steps.plan.outputs.repositories != ''
        name: Get Dispatch Access Token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          app-id: ${{ secrets.APPLICATION_ID }}
          private-key: ${{ secrets.APPLICATION_PRIVATE_KEY }}
          owner: fro-bot
          repositories: ${{ steps.plan.outputs.repositories }}
          permission-actions: write
```

The list itself is cleaned in `scripts/dispatch-renovate.ts:116-128` (trim, drop empties, dedupe) and intersected with the repositories the installation can reach in `planDispatchRepositories` (`:137-147`).

**The contract test's floors** (`scripts/app-token-scope-guard.test.ts:389-392`, asserted at `:681-684`):

```ts
const EXPECTED_ROW_COUNT = 35
const EXPECTED_MINT_FILE_COUNT = 18
/** Mint census before this change (31); the tree must never scan fewer. */
const MINT_CENSUS_FLOOR = 32
```

The matcher is `stepOutputPattern` (`:425-434`). Its fixtures (`:36-47`) include `steps [ '${id}' ] . outputs [ "token" ]`. The binding checks (`BINDING_SPECS`, `:1057-1074`) cover the two split jobs only, `reconcile-repos` and `update-metadata`.

**Run evidence after merge.** These runs executed on the merged code. None of their logs contains a `403` or "Resource not accessible by integration".

| Workflow            | Run         | Result  | Tokens minted                                                       |
| ------------------- | ----------- | ------- | ------------------------------------------------------------------- |
| update-metadata     | 38011555943 | success | discovery: metadata and contents read; writer: contents write       |
| wiki-lint           | 38011646776 | success | issues write                                                        |
| manage-issues       | 38011772216 | success | close: issues write; stale: actions, issues and pull-requests write |
| reconcile-repos     | 38011934823 | success | discovery: read; writer: contents, issues and actions write         |
| dispatch-renovate   | 38012216677 | success | discovery: metadata read; dispatch: actions write                   |
| merge-data          | 38012603419 | success | contents, pull-requests and issues write                            |
| reset-survey-status | 38012906769 | success | contents write                                                      |

`manage-cache` is not in the table. It ran on the merged code when #3974 closed (a `pull_request` closed event), minting a token with only `actions: write`, and the pull request's merge ref was left with no caches. No `workflow_dispatch` run of it exists, so the manual path is untested.

## Related

- [A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time](credential-mint-time-permission-scoping-2026-06-22.md)
- [A token minted for one installation cannot speak for another — mint per-owner, fail loud](per-owner-installation-tokens-2026-07-06.md)
- [A policy scanner must parse tokens, not prose — and the tool may normalise away what you are checking for](a-policy-scanner-must-parse-tokens-not-prose-2026-09-08.md)
- [Agent and automation steps need their GitHub token wired explicitly](../workflow-issues/required-github-token-for-agent-steps-2026-06-22.md)
- PR #3974 (merge `a72ffde`).
