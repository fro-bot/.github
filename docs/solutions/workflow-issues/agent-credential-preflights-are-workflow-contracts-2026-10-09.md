---
title: Agent credential preflights make checkout persistence a workflow contract
date: 2026-10-09
category: workflow-issues
module: github-actions-workflows
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - a pinned agent or action performs a fail-closed credential preflight before execution
  - a checkout token is needed for setup but must not persist into model-controlled git config
  - untrusted issue, PR, or comment fields flow into an agent prompt or context query
  - removing persisted credentials changes downstream git fetch, restore, or push behavior
tags:
  - github-actions
  - credentials
  - persist-credentials
  - agent-preflight
  - trusted-authors
  - fail-closed
  - fro-bot-agent
  - wiki-sync
---

# Agent credential preflights make checkout persistence a workflow contract

## Context

PR #3878 changed the content-triggered job in `.github/workflows/fro-bot.yaml`. Two of its lines are
runtime contract, not hardening that can be cleaned up later.

The first is `persist-credentials: false` on checkout. The job still checks out with
`secrets.FRO_BOT_PAT`, because setup and repository reads need the token:

```yaml
- name: Checkout repository
  uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
  with:
    fetch-depth: 0
    token: ${{ secrets.FRO_BOT_PAT }}
    # Content-triggered runs never retain checkout credentials.
    persist-credentials: false
```

The pinned `fro-bot/agent` (`e6efc1f`, v0.117.0) classifies `pull_request`, `issues`, and
`issue_comment` as credential-withheld triggers (`packages/runtime/src/agent/response-delivery.ts`).
For those runs, bootstrap calls `assertNoPersistedGitCredentials`
(`src/services/setup/git-credential-check.ts`) before model setup. It checks the effective git config
for `http.*.extraheader` entries and the `origin` remote URL for an embedded credential. Finding
either fails the run with an error that names `persist-credentials: false`. With default checkout
behavior, an affected run fails before the agent does any work.

Other triggers differ. `pull_request_review_comment` and `discussion_comment` are not withheld, so
the hard preflight applies only to the three triggers above. The content job still sets
`persist-credentials: false` uniformly.

The second is the trusted-author gate on issue-triggered runs, also added in #3878:

```yaml
github.event_name == 'issues' &&
!endsWith(github.event.issue.user.login || '', '[bot]') &&
(github.event.issue.user.login || '') != 'fro-bot' &&
contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.issue.author_association || '')
```

`github.event.issue.body` feeds the wiki-context query (`WIKI_QUERY_BODY`) and, through it, the
agent prompt, so an untrusted issue body reaching that path is an event-boundary problem. The `issues`
trigger includes `edited`, but the gate reads the issue author's association from the payload, not the
editor's.

Review also flagged a second-order risk. Once checkout stops persisting credentials, every later
`git fetch`, `git restore`, or `git push` that relied on them has to be audited. The wiki sync step
was the case in point in #3878; it has since moved into `.github/actions/sync-wiki/action.yaml`, which
fails closed (see Examples).

## Guidance

1. **Treat an action's credential preflight as part of the caller's contract.** If the action fails
   before execution when a persisted credential exists, the workflow must satisfy that near checkout.
   Do not treat `persist-credentials: false` as optional hardening.

2. **Separate "token input required" from "git credential persistence allowed".** They are different
   channels. `with.github-token` gives the action an explicit API credential under its own handling.
   `persist-credentials` decides whether checkout writes an auth header into git config for any later
   git command. The agent step keeps both invariants:

   ```yaml
   - name: Run Fro Bot
     id: fro-bot-agent
     uses: fro-bot/agent@e6efc1f13ed05056cc9ba68d6f8fb5e71bed8ca6 # v0.117.0
     with:
       github-token: ${{ secrets.FRO_BOT_PAT }}
       auth-json: ${{ secrets.OPENCODE_AUTH_JSON }}
   ```

   Do not "fix" a preflight failure by removing the token input.

3. **Gate untrusted event bodies before they enter agent context.** If an issue, PR, or comment body
   flows into a context query or prompt, give the event path its own authorization predicate. Use a
   closed trust set, and default-deny missing values: the `|| ''` fallback makes an absent
   association compare as empty, which is not in the set, so the run is skipped.

4. **Audit downstream git commands when removing persisted credentials.** For each one, choose the
   failure mode and make it visible:
   - fail closed when stale state could corrupt authority or produce unsafe writes;
   - fail soft only when the missing data is optional context and the fallback is explicitly safe;
   - emit a diagnostic either way.

## Why This Matters

Credential posture in an agent workflow is several independent settings. A workflow can need a token
for setup and API calls while needing that token absent from git config before model-controlled
execution starts.

If the checkout setting drifts, the failure is blunt: the preflight fails and the job never reaches
the model. If the event gate drifts, untrusted issue text can seed the agent's context. If downstream
git assumptions go unaudited after a credential change, a run can proceed on stale state or fail far
from the change that caused it.

## When to Apply

- A workflow runs `fro-bot/agent` or another pinned action with a fail-closed credential preflight.
- `actions/checkout` uses a PAT or App token, but model-controlled steps must not inherit git
  credentials.
- An issue, PR, or comment body feeds a query, environment variable, prompt, or context artifact that
  an agent consumes.
- Removing `persist-credentials` could affect later `git fetch`, `git restore`, `git push`, or
  wiki and data synchronization.
- A workflow handles both trusted autonomous runs and content-triggered runs with different
  credential expectations.

## Examples

### The event gate sits where the untrusted event becomes a run

The body reaches the agent through the wiki-context step:

```yaml
WIKI_QUERY_BODY: >-
  ${{
    github.event.pull_request.body ||
    github.event.issue.body ||
    github.event.comment.body ||
    ''
  }}
```

The gate belongs in the job's `if:`, before checkout and before this step runs, not in prompt text
downstream.

### Separate "branch absent" from "probe failed"

A bare `if git ls-remote ...; then git fetch ...; fi` conflates a missing branch with a failed probe.
The current `.github/actions/sync-wiki/action.yaml` discriminates on exit code, retries transient
failures, and refuses to continue on a possibly stale `knowledge/` snapshot:

```bash
ls_remote_status=0
run_with_retry "data branch probe" 2 1 git ls-remote --exit-code origin data || ls_remote_status=$?
if [ "$ls_remote_status" -eq 0 ]; then
  if run_with_retry "data branch fetch" "" 0 git fetch origin data; then
    git restore --source FETCH_HEAD --worktree -- knowledge
  else
    echo "::error::data branch fetch failed; refusing to run on a possibly stale knowledge/ snapshot."
    exit 1
  fi
elif [ "$ls_remote_status" -eq 2 ]; then
  echo "data branch not yet established; skipping wiki sync."
else
  echo "::error::data branch probe failed (exit $ls_remote_status); refusing to run on a possibly stale knowledge/ snapshot."
  exit 1
fi
```

An absent `data` branch is a bootstrap case (`git ls-remote --exit-code` exits 2). Any other probe
failure is an unsafe ambiguity.

## Related

- [Agent and automation steps need their GitHub token wired explicitly](required-github-token-for-agent-steps-2026-06-22.md) — the opposite credential failure: a required `github-token` input that was never passed. Kept separate because the mechanism and fix direction differ.
- [Privacy Gate Design for Data→Main Promotion Leak Prevention](../best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md) — fail-closed design at a trust boundary.
- [A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time](../best-practices/credential-mint-time-permission-scoping-2026-06-22.md) — capability is constrained by scope and minting, not by credential count.
- [Make failure boundaries and shared predicates explicit](../best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md) — explicit fail-hard and fail-soft contracts for workflow steps.
- Source PR: #3878 (merge `e86b087`).
