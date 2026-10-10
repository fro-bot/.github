---
title: A dispatch ref guard is not a security boundary; gate the credential with an environment and a deployment-branch policy
date: 2026-10-10
last_updated: 2026-10-10
verified: 2026-10-10
category: best-practices
module: .github/workflows/rename-tracked-repo.yaml
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - a workflow_dispatch job guards itself with an if on github.ref and then receives a credential or write token
  - an if guard on the ref is described as a boundary in a comment, PR, or test name
  - the job can read repo-level secrets because it does not reference an environment
tags:
  - workflow-dispatch
  - github-ref
  - environments
  - deployment-branches
  - app-token
  - defense-in-depth
---

# A dispatch ref guard is not a security boundary; gate the credential with an environment and a deployment-branch policy

## Context

`.github/workflows/rename-tracked-repo.yaml` is a dispatch-only workflow whose job mints a `contents: write` App token. Its job carries a ref guard (`:40-42`):

```yaml
    # Defense in depth, not a boundary: this skips dispatches from any ref other than main, but
    # workflow_dispatch runs the workflow file of whichever ref is selected, and that file can omit this line.
    if: github.ref == 'refs/heads/main'
```

An earlier version of that comment said that only `main` may mint the write token, "so an unreviewed branch cannot run its own copy of the script with it", and a test was named after the same claim: "runs only from main, so a dispatched branch can never run its own copy of the script with the write token". Both overstated what the guard does, and both were corrected in the same change as this document. The `if:` lives in the workflow file, and the file that runs is the one the selected ref supplies, so a branch can simply delete the line. The comment and the test name (`scripts/rename-tracked-repo-workflow.test.ts:74`) now say what the guard does. The test still pins the guard's text; it never pinned a property.

The guard has value: it skips the job, and so the token mint, for an accidental dispatch from the wrong ref. It is not what protects the credential.

## Guidance

1. **Treat a ref `if:` in a dispatch-only workflow as defense in depth, not as the boundary.** Do not describe it as one in a comment, a PR description or a test name.
2. **Put the boundary in a GitHub environment that holds the credential**, with a deployment-branch policy limited to `main`. The job then references that environment. This shape is a proposal and is not in the repository:

   ```yaml
   jobs:
     rename-tracked-repo:
       environment:
         name: repo-writer # proposed; deployment-branch policy: main only
   ```

3. **Scope the credential.** `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` are repository-level secrets, so any job in any workflow can read them unless they move into an environment. Moving them is a settings change, not a workflow edit.

What is documented, and what is not:

- GitHub documents that a `workflow_dispatch` run can be started against any branch or tag through the API or the CLI. The `gh workflow run --ref` manual describes the ref as the "branch or tag name which contains the version of the workflow file you'd like to run".
- GitHub documents that environments can restrict which branches and tags deploy to them, and that a job referencing an environment must follow its protection rules "before running or accessing the environment's secrets".
- Not verified: that a deployment-branch policy is enforced against a `workflow_dispatch` started from another ref, and that a dispatch from a branch whose workflow file lacks the ref guard really runs that file. Both need a live check before this repository relies on them. Treat the environment as the documented boundary to adopt, not one this repository has proven.

## Why This Matters

A dispatch-only job runs the code of whichever ref the operator selects. The description of PR #3977 records this as an accepted residual: "The `github.ref` guard is defense in depth, not a boundary. Any branch workflow can already mint the App token." That is true only for a job that references no environment, started by someone who is allowed to dispatch workflows. For those jobs, no `if:` in the file changes it.

A guard described as a boundary is worse than no guard, because it stops the next reviewer from asking where the boundary is.

## When to Apply

- Any `workflow_dispatch` job, or a `workflow_call` workflow reached from a dispatch, that mints a token or writes with a secret.
- Any comment, test name or document that calls a ref guard a boundary.
- Any repository where the credential is a repository-level secret.

## Examples

No environment gates the App token in this repository today.

`.github/workflows/publish-wiki.yaml:170` references an environment, `github-pages`, whose deployment-branch policy was limited to `main` when read through the API on 2026-10-10. It is the in-repository example of an environment with a branch policy. It does not touch the App-token path.

## Related

- [Quote required-status-check contexts that contain a colon](../workflow-issues/quoted-required-status-check-context-2026-06-09.md): a job skipped by `if:` reports Success, so a skipped job is not a safe default either.
- [A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time](credential-mint-time-permission-scoping-2026-06-22.md)
- [Pin Every App Token Mint in a Repo-Wide Contract Test](repo-wide-app-token-scope-contract-2026-10-10.md): what the token can do once minted.
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md): "A single privacy boundary outside the trust boundary it was protecting is not a boundary."
- [The wiki authority guard trusted a branch name without checking which repository it lives in](../security-issues/wiki-authority-guard-branch-name-spoofable-2026-10-10.md) shares the principle that a ref or branch name is not an origin.
- PR #3977 (merge `8792b53`). GitHub documentation: [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [`gh workflow run`](https://cli.github.com/manual/gh_workflow_run), [Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
