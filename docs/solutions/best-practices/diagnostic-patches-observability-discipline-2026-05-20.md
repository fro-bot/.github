---
title: Diagnostic patches must fail loudly and preserve stderr
date: 2026-05-20
last_updated: 2026-05-20
verified: 2026-05-20
category: best-practices
module: .github/workflows/survey-repo.yaml
problem_type: best_practice
component: development_workflow
severity: low
related_components:
  - tooling
  - documentation
tags:
  - diagnostics
  - observability
  - bash
  - github-actions
  - workflow-debugging
  - printf
  - app-tokens
applies_when:
  - a workflow swallows stderr from a failing CLI call
  - adding temporary diagnostics to expose hidden failure context
  - marker output or logging helpers need to be shell-safe
  - the first diagnostic patch might itself fail and obscure the original problem
  - a public-read GraphQL call crosses an organization boundary
---

# Diagnostic patches must fail loudly and preserve stderr

## Context

When automation fails silently, the reflex is to throw one fix at the most obvious cause. That misses the actual problem most of the time, because the original failure mode has already proven that information is being lost. Each layer of swallowed error adds a turn to the investigation.

This pattern surfaced in a real 3-step progression on `.github/workflows/survey-repo.yaml`:

1. The privacy gate's `gh api graphql` call sent stderr to `/dev/null` and printed a generic "GraphQL lookup failed" line. The real `gh` error was discarded.
2. The first diagnostic patch surfaced stderr — but used a `printf` format string starting with `---`, which Ubuntu's bash builtin `printf` rejects as an invalid option. The patch died before printing.
3. Once the marker bug was fixed, the surfaced stderr revealed the actual cause: a cross-organization PAT lifetime policy. The real fix swapped the gate to an App installation token.

Three PRs over three iterations instead of one, because each layer of swallowed error obscured the next.

## Guidance

### 1. Never `2>/dev/null` a workflow gate's failure-path command

When `gh api`, `curl`, `jq`, or any external CLI fails inside a step that controls dispatch, operators have no visibility unless stderr is surfaced. Capture stderr to a tempfile and `cat` it on failure between stable marker lines:

```bash
gh_stderr=$(mktemp)
if ! response=$(gh api graphql -F id="$NODE_ID" -f query="$gql_query" 2>"$gh_stderr"); then
  printf 'GraphQL lookup failed for node_id: %s\n' "$NODE_ID" >&2
  printf '%s\n' '--- gh stderr ---' >&2
  cat "$gh_stderr" >&2
  printf '%s\n' '--- end gh stderr ---' >&2
  rm -f "$gh_stderr"
  exit 1
fi
rm -f "$gh_stderr"
```

The markers do double duty: they anchor the captured stderr in the log for humans and provide a stable string for any future log-parsing tooling.

### 2. Be wary of leading dashes in `printf` format strings

Bash's builtin `printf` rejects format strings starting with `---` because the leading `--` parses as an invalid option. Coreutils `printf` supports `--` as an end-of-options sentinel; bash builtin does NOT. The behavior diverges on Ubuntu runners specifically, and is invisible on macOS during local testing.

Use `printf '%s\n' '--- marker ---'` (marker as argument) instead of `printf '--- marker ---\n'` (marker as format string):

```bash
# Wrong — bash builtin exits with "printf: --: invalid option"
printf '--- gh stderr ---\n' >&2

# Right — bash builtin treats the marker as a %s argument
printf '%s\n' '--- gh stderr ---' >&2
```

### 3. Cross-org public reads use App tokens, not user PATs

Fine-grained PATs are subject to per-org lifetime policies. Real example from this investigation:

```
gh: The 'bfra-me' organization forbids access via a fine-grained personal access tokens
if the token's lifetime is greater than 366 days.
```

Classic PATs avoid the lifetime policy but their renewal is your responsibility. App installation tokens auto-rotate per-run, are scoped to the installation's permissions, and answer public-read questions without policy entanglement. Mint an installation token for the calling repo's owner and consume it via `GH_TOKEN`:

```yaml
- name: Mint App token for privacy gate
  id: gate-token
  uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
  with:
    app-id: ${{ secrets.APPLICATION_ID }}
    private-key: ${{ secrets.APPLICATION_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}

- name: 🔒 Resolve and verify
  env:
    NODE_ID: ${{ inputs.node_id }}
    GH_TOKEN: ${{ steps.gate-token.outputs.token }}
  run: |
    # public-read GraphQL works across orgs regardless of the calling
    # installation's per-org permissions
```

The `owner: ${{ github.repository_owner }}` argument is load-bearing: without it, the App token defaults to the calling repo's scope and `apps.listReposAccessibleToInstallation` returns only that one repo.

### 4. Keep diagnostic patches bounded

A diagnostic patch should fix the immediate visibility blocker, not propagate the pattern to every symmetric call site. The first stderr-surfacing patch in this investigation touched only the `🔒 Resolve and verify` step, NOT the symmetric `🔒 Recheck visibility` step that has the same `2>/dev/null` shape. The cleanup PR for the recheck step was filed as a separate follow-up issue.

Why bounded matters: every line in a diagnostic patch is a line that could itself be wrong (as the printf bug demonstrated). Smaller surface → fewer ways for the diagnostic to fail before it prints.

## Why This Matters

- **Three PRs instead of one.** Swallowed stderr forced the investigation to walk down the stack: surface stderr → fix the surface mechanism → fix the real error. Each layer was necessary because the previous one obscured information.
- **Bash builtin vs coreutils `printf` is a real portability gap.** It bites on Ubuntu runners specifically, and is invisible during local macOS testing. The fix is a one-character pattern change that applies forever.
- **Cross-org PAT policy is invisible until something fails.** App tokens are the structurally correct primitive for public-read questions — they sidestep PAT lifetime policy entirely, auto-rotate, and don't depend on a human renewing them yearly.

## When to Apply

This guidance applies whenever writing or reviewing a workflow that:

- Calls external CLI tools (`gh`, `curl`, `jq`) in `run:` steps
- Has a gate or conditional dispatch path that exits non-zero on failure
- Crosses organization boundaries for reads
- Prints diagnostic markers via `printf` with leading-dash format strings
- Uses fine-grained PATs to call APIs in orgs other than the calling repo's owner

## Examples

### Swallowed stderr removed, tempfile capture added

`.github/workflows/survey-repo.yaml` before (PR #3344 before):

```bash
response=$(gh api graphql \
  -F id="$NODE_ID" \
  -f query="$gql_query" \
  2>/dev/null) || {
  printf 'GraphQL lookup failed for node_id: %s\n' "$NODE_ID" >&2
  exit 1
}
```

After (PR #3344):

```bash
# Capture stderr to a temp file so a failure surfaces the real gh/GitHub error
# (auth, permission, rate limit, network) instead of a generic abort line.
gh_stderr=$(mktemp)
if ! response=$(gh api graphql -F id="$NODE_ID" -f query="$gql_query" 2>"$gh_stderr"); then
  printf 'GraphQL lookup failed for node_id: %s\n' "$NODE_ID" >&2
  printf '%s\n' '--- gh stderr ---' >&2
  cat "$gh_stderr" >&2
  printf '%s\n' '--- end gh stderr ---' >&2
  rm -f "$gh_stderr"
  exit 1
fi
rm -f "$gh_stderr"
```

### Broken `printf` markers fixed

Before (PR #3344, broken on Ubuntu):

```bash
printf '--- gh stderr ---\n' >&2
cat "$gh_stderr" >&2
printf '--- end gh stderr ---\n' >&2
```

After (PR #3346):

```bash
# Use %s format so leading dashes in the marker are treated as arguments,
# not options (bash builtin printf otherwise rejects '---...' as an option).
printf '%s\n' '--- gh stderr ---' >&2
cat "$gh_stderr" >&2
printf '%s\n' '--- end gh stderr ---' >&2
```

### PAT env replaced with App token

Before (PR #3347 before):

```yaml
- name: 🔒 Resolve and verify
  id: resolve
  env:
    NODE_ID: ${{ inputs.node_id }}
    GH_TOKEN: ${{ secrets.FRO_BOT_PAT }}
  run: |
    # ...

- name: 🔒 Recheck visibility
  id: recheck
  env:
    NODE_ID: ${{ inputs.node_id }}
    GH_TOKEN: ${{ secrets.FRO_BOT_PAT }}
  run: |
    # ...
```

After (PR #3347):

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
    # ...

- name: 🔒 Recheck visibility
  id: recheck
  env:
    NODE_ID: ${{ inputs.node_id }}
    GH_TOKEN: ${{ steps.gate-token.outputs.token }}
  run: |
    # ...
```

## Related

- [Survey Repo dispatch boundary trusted caller-provided owner/repo, leaking private identity into public Actions surface](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — same workflow file and same privacy gate; defense-in-depth shape rather than diagnostic discipline. Note: the code example in that doc still shows `2>/dev/null` and the leading-dash `printf` pattern; both are now updated in production but stale in the doc.
- [The jq `//` falsy-coalesce trap in shell-driven gates](../workflow-issues/jq-falsy-coalesce-trap-in-shell-gates-2026-05-17.md) — companion "the gate can lie if the parser silently coerces" pattern in the same workflow.
- [Autonomous-pipeline silent failures: status misclassification and additive-pipeline drift](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md) — same workflow-observability family; different cause shape (compound-expression status classification, not stderr blackout).
- PR #3344 — diagnostic stderr capture
- PR #3346 — printf marker fix
- PR #3347 — App token for cross-org privacy gate
- Issues #3345, #3349 — bounded follow-ups for symmetric cleanup
