---
title: Survey Repo dispatch boundary trusted caller-provided owner/repo, leaking private identity into public Actions surface
category: security-issues
problem_type: security_issue
component: tooling
module: .github/workflows/survey-repo.yaml
severity: high
date: 2026-05-16
last_updated: 2026-05-23
verified: 2026-05-16
related_components:
  - development_workflow
  - documentation
tags:
  - privacy
  - github-actions
  - workflow-dispatch
  - defense-in-depth
  - private-repos
  - graphql
  - node-id
  - dispatch-contract
root_cause: missing_validation
resolution_type: code_fix
symptoms:
  - Canonical owner/repo passed as workflow_dispatch inputs could surface in public Actions UI (run name, concurrency key, logs) before any privacy check ran
  - Privacy contract enforced only in caller scripts; any caller bug or operator misuse could leak private-repo identity
  - run-name echoed raw caller input, creating a log-line leak path independent of privacy verification
  - Stale nodeId from invitation payload could dispatch under wrong identity if repo was deleted and recreated mid-flight
  - Persistence and external-emit steps (metadata write, Discord/Bluesky broadcast) ran on agent success without reverifying repo visibility, leaking now-private repo identity if the repo flipped during a no-op survey
---

# Survey Repo dispatch boundary trusted caller-provided owner/repo, leaking private identity into public Actions surface

## Problem

The `survey-repo` workflow trusted dispatch callers to pass `owner` and `repo` as inputs, making the privacy contract enforceable only outside the workflow. Any caller bug, operator misuse, or future regression could leak a canonical private-repo identity into public Actions surfaces (run name, concurrency key, log lines, step summaries, social broadcasts) before any privacy check ran. Even after the first version of the in-workflow gate landed, the recheck was scoped too narrowly: persistence and external-emit steps (metadata write, broadcast) ran on agent success regardless, leaving leak windows on no-op surveys.

## Symptoms

- `workflow_dispatch` accepted any `{owner: string, repo: string}` from the caller with no validation.
- `run-name` interpolated raw caller input, so the public Actions UI displayed canonical owner/repo before any step executed.
- `concurrency.group` interpolated raw input, leaking identity into public scheduler state.
- If a caller passed a private repo's owner/repo (e.g., a regression in the engine's privacy gate, or manual operator misuse), that identity appeared in the run list before the agent step ran.
- Failure paths printed input values directly into logs, turning every aborted run into a leak channel.
- After the first in-workflow gate landed, no-op surveys (agent ran but wrote no wiki changes) skipped the visibility recheck, allowing `Record survey result` to persist `private: false` to the data branch and `broadcast` to publish owner/repo to Discord/Bluesky even when the repo had flipped private during the run.

## What Didn't Work

1. **Trusting the engine-side gate alone.** A separate doc (`docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md`) hardened the dispatch-planning engine to fail-closed on non-public entries. But if anything bypassed that gate — a future caller bug, manual `gh workflow run` from an operator, or a regression — the workflow itself had no fallback verification. A single privacy boundary outside the trust boundary it was protecting is not a boundary.
2. **Trusting the invitation API payload's `node_id`.** The invitation handler originally used the `node_id` from the invitation payload directly. But invitations can be stale (repo deleted and recreated between invitation send and acceptance), so dispatching under that node_id could survey the wrong repository entirely.
3. **Echoing raw input in failure messages.** Even a "failed" workflow run logs its input — `printf 'Aborting %s' "$NODE_ID"` is a leak channel. Aborting loudly with the bad value defeats the point of aborting.
4. **Gating only the wiki-commit step on the recheck.** The first attempt at the recheck scoped its `if:` to `steps.wiki-changes.outputs.changed == 'true'`. That closed the wiki leak but left two larger ones: the `Record survey result` step kept its hardcoded `REPO_PRIVATE: 'false'` sourced from the initial resolve, and the `broadcast` job depended only on `needs.survey-repo.result == 'success'`. On a no-op survey where the agent ran but wrote no wiki changes, both paths emitted post-flip identity to public surfaces.

## Solution

**1. Change the `workflow_dispatch` contract to a single opaque identifier** — `.github/workflows/survey-repo.yaml`:

```yaml
on:
  workflow_dispatch:
    inputs:
      node_id:
        description: "GitHub repository node_id; resolves to owner/repo internally after privacy verification"
        required: true
        type: string

run-name: Survey Repo  # static; do NOT echo inputs.node_id
```

**2. Mint an App installation token for the gate's GraphQL lookup, then resolve and verify as the first step** before any other step exposes identity. The gate's only question is "is this node a public repository?" — that's a public read, but it must work for repos in any org the dispatch lands on, including orgs whose policy forbids long-lived fine-grained PATs (e.g., bfra-me requires ≤366d lifetime; see `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md` for the diagnostic loop that surfaced this). An installation token minted for the calling repo's owner sidesteps PAT policy entirely while still permitting public-read GraphQL:

```yaml
- name: Mint App token for privacy gate
  id: gate-token
  uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
  with:
    app-id: ${{ secrets.APPLICATION_ID }}
    private-key: ${{ secrets.APPLICATION_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}

- name: 🔒 Resolve and verify
  id: resolve
  env:
    NODE_ID: ${{ inputs.node_id }}
    GH_TOKEN: ${{ steps.gate-token.outputs.token }}
  run: |
    # Shape validation BEFORE any GraphQL or log — fail with neutral message
    if ! printf '%s' "$NODE_ID" | grep -qE '^[A-Za-z0-9_=-]+$'; then
      printf 'Aborting: dispatch input shape invalid\n' >&2
      exit 1
    fi

    # shellcheck disable=SC2016
    gql_query='query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner isPrivate } } }'
    # Capture stderr to a temp file so failures surface the real gh/GitHub error
    # (auth, permission, rate limit, network) instead of a generic abort line.
    gh_stderr=$(mktemp)
    if ! response=$(gh api graphql -F id="$NODE_ID" -f query="$gql_query" 2>"$gh_stderr"); then
      printf 'GraphQL lookup failed for node_id: %s\n' "$NODE_ID" >&2
      # Use %s format so leading dashes in the marker are treated as arguments,
      # not options (bash builtin printf rejects '---...' as an option).
      printf '%s\n' '--- gh stderr ---' >&2
      cat "$gh_stderr" >&2
      printf '%s\n' '--- end gh stderr ---' >&2
      rm -f "$gh_stderr"
      exit 1
    fi
    rm -f "$gh_stderr"

    name_with_owner=$(printf '%s' "$response" | jq -er '
      .data.node
      | select(type == "object")
      | select(.isPrivate == false)
      | select((.nameWithOwner | type) == "string")
      | select(.nameWithOwner != "")
      | .nameWithOwner
    ') || {
      printf 'Aborting: %s is not definitively public\n' "$NODE_ID" >&2
      exit 1
    }

    resolved_owner="${name_with_owner%%/*}"
    resolved_repo="${name_with_owner#*/}"

    {
      printf 'owner=%s\n' "$resolved_owner"
      printf 'repo=%s\n' "$resolved_repo"
      printf 'node_id=%s\n' "$NODE_ID"
    } >> "$GITHUB_OUTPUT"
```

**3. Recheck visibility before any persistence or external emit**, scoped to every survey (not just wiki-changed), reusing the App token from step 2:

```yaml
- name: 🔒 Recheck visibility
  id: recheck
  if: ${{ !cancelled() && steps.survey-agent.conclusion != 'skipped' }}
  env:
    NODE_ID: ${{ inputs.node_id }}
    GH_TOKEN: ${{ steps.gate-token.outputs.token }}
  run: |
    # ... same shape-validate + GraphQL check as resolve, neutral abort on any failure ...
    echo "private=false" >> "$GITHUB_OUTPUT"  # only reached on the confirmed-public path
```

The recheck still swallows `gh api` stderr with `2>/dev/null` — that's tracked as a follow-up (issue #3345) to apply the same tempfile-capture pattern from step 2. Until then, recheck failures are diagnostically opaque; if the recheck starts failing, the first investigation step is to copy the resolve-step pattern locally and resubmit a diagnostic dispatch.

**4. Route every persistence and external-emit step through the recheck-success gate.** This is the load-bearing detail. The recheck is only as useful as the breadth of its gating:

```yaml
- name: Commit wiki ingest to data branch
  id: wiki-commit
  if: steps.wiki-changes.outputs.changed == 'true' && steps.recheck.conclusion == 'success'
  # ...

- name: Record survey result
  if: always() && !cancelled() && steps.survey-agent.conclusion != 'skipped' && steps.recheck.conclusion == 'success'
  env:
    REPO_PRIVATE: ${{ steps.recheck.outputs.private }}  # NOT hardcoded 'false'
  # ...

broadcast:
  needs: survey-repo
  if: needs.survey-repo.result == 'success'  # recheck failure fails the job, suppressing broadcast
```

**5. Tighten the caller-side dispatch contract** — `scripts/reconcile-repos.ts`:

```typescript
export interface DispatchRequest {
  owner: string
  repo: string
  // GraphQL node_id surfaced to workflow_dispatch inputs as the sole identifier.
  // owner/repo stay on this interface for internal telemetry (logger,
  // prioritization) but never reach the Actions API.
  node_id: string
}

// In runDispatches:
await params.appOctokit.rest.actions.createWorkflowDispatch({
  owner: params.owner,
  repo: params.repo,
  workflow_id: params.workflowFile,
  ref: params.workflowRef,
  inputs: {node_id: dispatch.node_id},  // node_id only — NEVER owner/repo
})
```

**6. Use the refreshed `nodeId` from the invitation refresh path** — `scripts/handle-invitation.ts`:

```typescript
async function acceptedInvitationRepositoryPrivacy(...) {
  try {
    const response = await octokit.rest.repos.get({owner, repo})
    const nodeId =
      typeof response.data.node_id === 'string' && response.data.node_id !== ''
        ? response.data.node_id
        : invitationPrivacy.nodeId  // fallback preserves invitation's value when refresh is sparse
    if (response.data.private === false) {
      return {kind: 'public', nodeId}  // refreshed nodeId, NOT invitationPrivacy.nodeId
    }
    return {kind: 'private', nodeId}
  } catch (error: unknown) {
    // Fail closed on transient refresh failures — but make the failure observable.
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    const kind = error instanceof Error ? error.name : 'unknown'
    process.stderr.write(
      `handle-invitation: repos.get privacy refresh failed (status=${status}, kind=${kind}); treating invitation as private.\n`,
    )
    return {kind: 'private', nodeId: invitationPrivacy.nodeId}
  }
}
```

**7. Cross-job outputs serialize the identity contract.** The broadcast job consumes `needs.survey-repo.outputs.owner/repo`, which are only ever set after the resolve step's verification passes. Downstream jobs cannot see identity until verification has succeeded.

## Why This Works

The workflow is now its own privacy boundary, not a downstream consumer of someone else's gate. Even if engine-side gating fails or a caller regresses, the workflow refuses to expose canonical identity until GraphQL confirms `isPrivate === false`. Shape validation happens *before* any log statement or external call, so operator misuse (e.g., passing `owner/repo` as `node_id`) is rejected with a neutral message that doesn't echo the bad input. The recheck before persistence closes the visibility-flip race during long agent runs — if the repo flips private mid-run, the agent's output stays local to the runner and never reaches the data branch, the metadata file, or any social broadcast.

The breadth of the recheck gate matters as much as its existence. Routing the recheck through every persistence and external-emit step (not just wiki-commit) means the broadcast job's existing `needs.survey-repo.result == 'success'` dependency picks up the privacy guarantee for free — when the recheck fails, the job fails, and broadcast is suppressed automatically. One change closes three leak paths.

## Prevention

1. **Public-read GraphQL gates use App installation tokens, not user PATs.** Fine-grained PATs hit per-org lifetime policies (e.g., bfra-me's 366d cap) that surface as 401s on cross-org node lookups; App tokens auto-rotate and sidestep that class of footguns. The gate's only question is "is this node a public repository?" — a question App tokens answer for any public repo regardless of installation membership. Reserve PATs for steps that need user identity (commit author, invitation accept, star).
2. **Treat any `workflow_dispatch` input as a public artifact.** If it would be unsafe on a GitHub Actions run page, it must be opaque (e.g., a GraphQL node_id) or redacted before dispatch.
3. **Never interpolate raw inputs into `run-name`, concurrency keys, or log lines until they're verified.** Use static run-names, opaque concurrency keys, and shape-validated values only.
4. **Validate input shape BEFORE any external call or log statement.** A failed validation must not echo the invalid input — neutral abort messages only.
5. **When a multi-step workflow persists state or emits to external surfaces, gate EVERY persistence and emit step on the verification step's success — not just the most obvious one.** Recheck-before-wiki is necessary but not sufficient; the metadata write and broadcast are also persistence/emit paths. List every step that writes outside the runner, gate them all.
6. **Caller dispatch payloads should carry the minimum identity needed.** Internal telemetry fields (owner/repo for logging, prioritization) belong on internal types, not in `workflow_dispatch.inputs`.
7. **When refreshing identity from a downstream API (`repos.get`, GraphQL), use the refreshed value, not the pre-refresh original.** Stale identifiers — especially from invitation payloads — can dispatch under the wrong repo.
8. **Test the contract directly.** At least one test should assert the exact `inputs:` shape the caller sends to `createWorkflowDispatch`, separate from logic tests. Contract drift is invisible to behavior tests until it leaks.
9. **Make fail-closed paths observable.** Silent `catch {}` that downgrades to a safe default is correct but mute. Write a structured stderr line carrying error status and kind (no canonical identifiers) so transient failures are visible in CI logs.
10. **Capture `gh api` stderr to a tempfile, not `2>/dev/null`.** Workflow gates that swallow the underlying API error force every future investigation to start from zero. Use `2>"$gh_stderr"` + `cat "$gh_stderr" >&2` between marker lines on failure. See `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md` for the bash-builtin-`printf` marker pattern.

## Related Issues

- PR: https://github.com/fro-bot/.github/pull/3293 — original landing PR for this gate
- PR: https://github.com/fro-bot/.github/pull/3344 — stderr capture pattern (`2>"$gh_stderr"` + tempfile + marker dump)
- PR: https://github.com/fro-bot/.github/pull/3346 — bash-builtin `printf` marker fix (use `'%s\n' '--- text ---'`)
- PR: https://github.com/fro-bot/.github/pull/3347 — App-token mint for cross-org public-read gate
- Follow-up: https://github.com/fro-bot/.github/issues/3345 — apply tempfile-capture pattern to recheck step
- Follow-up: https://github.com/fro-bot/.github/issues/3349 — App-token expiry race + cross-org install assumption documentation
- Related (engine-side counterpart): `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — engine-side dispatch planning gate; this doc captures the workflow-side enforcement that fulfills its closing prevention rule
- Related (diagnostic discipline): `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md` — the three-PR investigation that surfaced the stderr-swallowing, printf-marker, and App-token issues fixed inline above
- Compliance: `docs/solutions/workflow-issues/github-actions-step-output-interpolation-2026-04-21.md` — env-var-only shell expansion pattern used in every new `run:` block
- Compliance: `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — aggregate status semantics in `Survey Repo`; same principle of "downstream steps must check upstream conclusions, not assume agent success"
