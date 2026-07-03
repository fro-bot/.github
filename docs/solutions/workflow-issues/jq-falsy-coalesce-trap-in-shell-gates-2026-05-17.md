---
title: 'jq // operator silently coalesces false to fallback in shell-driven gates'
date: 2026-05-17
last_updated: 2026-07-04
problem_type: workflow_issue
component: development_workflow
module: github-actions-workflows
severity: high
verified: 2026-05-17
tags:
  - jq
  - shell-parsing
  - github-actions
  - privacy-gate
  - boolean-handling
  - fail-closed
applies_when:
  - A shell-driven gate (CI step, agent guard, control-plane workflow) parses a JSON boolean from an API response and uses jq's `//` operator to provide a fallback value.
  - The gate makes a security or correctness decision based on the parsed string (e.g. abort unless `isPrivate` is `false`).
  - The desired-success branch of the gate is the `false` branch (allowed), and any other value triggers a fail-closed abort.
---

# jq `//` operator silently coalesces `false` to fallback in shell-driven gates

## Context

`jq`'s `//` operator looks like JavaScript's `??` (null-coalescing) — but it isn't. `//` coalesces on `false`, `null`, AND missing values identically, treating all three as "alternative needed." This is documented but surprising: anyone reaching for `// "fallback"` to handle "the field might be missing" gets bonus coalescing on `false` they didn't ask for.

In a shell-driven gate that decides based on a boolean — does this repo's `isPrivate` field equal `false`? — the trap is invisible until it bites. A response like `{"isPrivate": false}` is the *correct* shape; the gate should pass. Instead `jq -r '.isPrivate // "null"'` returns the literal string `"null"`, the gate's subsequent `[ "$is_private" = "null" ]` check fires, and the gate aborts.

The failure mode is particularly pernicious because:

- It looks correct in code review (the fallback is a defensive idiom).
- It fails **closed** — gates abort rather than allow — so privacy/security posture is preserved and no immediate breach signal fires.
- The abort message reads as if the *upstream API* returned bad data ("X is not definitively public"), so the operator blames the API and not the parse.
- Local jq runs against the same JSON reproduce the bug trivially, but only if you think to test it. The shell gate looks fine until something else (a manual dispatch, a scheduled cron) tries to exercise the desired-success branch.

In this repo, the survey-repo workflow's privacy gate refused every Survey Repo dispatch from the moment Unit 6 shipped (PR #3293, 2026-05-17) until PR #3298 fixed it the same day. Three manual dispatches that morning all aborted; the bug was diagnosed only after a diagnostic workflow showed the upstream GraphQL call was returning `{"isPrivate": false}` cleanly. The parse, not the call, was the problem.

## Guidance

**Do not use `jq -r '.flag // "fallback"'` to parse a boolean you intend to compare as a string.** The `//` operator coalesces `false` the same way it coalesces `null` and missing values. Use one of these patterns instead:

### Pattern 1 — `jq -e` assertion (preferred for binary gates)

When the gate's decision is binary ("is this definitively public?"), let `jq -e` make the assertion and exit non-zero on failure. Skip the intermediate variable entirely.

```sh
# Resolve gate — emit nameWithOwner only when the response is unambiguously public.
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
```

```sh
# Recheck gate — strict boolean equality, no string coercion.
if ! printf '%s' "$response" | jq -e '.data.node.isPrivate == false' >/dev/null; then
  printf 'Aborting: visibility recheck failed for %s\n' "$NODE_ID" >&2
  exit 1
fi
```

`select(.isPrivate == false)` filters out everything that isn't exactly the boolean `false`. `jq -e` exits non-zero on empty output or `false`/`null` — combined with `select`, it's the right tool for "abort unless this is true."

### Pattern 2 — Explicit null-check before coalesce

When you do need a stringified value for shell comparison, branch on `null` explicitly so `false` doesn't get folded in.

```sh
is_private=$(printf '%s' "$response" | jq -r '
  if .data.node.isPrivate == null
  then "null"
  else (.data.node.isPrivate | tostring)
  end
')
```

This pattern is more verbose and creates a string-comparison surface that's still error-prone (`[ "$is_private" = "false" ]` is correct; `[ "$is_private" != "true" ]` is subtly wrong). Pattern 1 is almost always better.

## Why This Matters

Shell-driven gates in workflow YAML are a load-bearing security surface in this repo:

- The Survey Repo resolve gate (`.github/workflows/survey-repo.yaml`) decides whether to expose a repo's `owner/name` to public log surfaces.
- The recheck gate at the same file verifies visibility hasn't flipped before persisting wiki commits.

Both gates failing-closed on `isPrivate: false` is "lucky" — privacy posture survives — but the pipeline is effectively dead. The next gate that fails-closed-but-wrong-direction (e.g. an auth check parsing `requires2FA: false`, a feature-flag check parsing `enabled: true`) might fail *open* and create a real incident.

The fix is procedural, not just textual: when writing a shell-driven gate that compares a JSON boolean, prefer `jq -e` assertions over `// "fallback"` parsing. The few minutes it takes to refactor save the hours of "why isn't this firing?" diagnosis when the gate finally meets its desired-success branch.

## When to Apply

- Any new `.github/workflows/*.yaml` step that pipes a JSON response into `jq` to make a control-flow decision.
- Any `scripts/**/*.ts` shell-outs that parse GitHub API booleans (less common, but the same trap exists for any tool using `jq`'s `//`).
- Any review of an existing workflow gate — `git grep -nE 'jq -r .+ // "(null|false|true)"'` is a fast audit for this exact pattern across the repo.

The audit distinction is numeric vs. boolean, not "does it use `//`":

- **Numeric count defaults are fine.** Every summary-table `jq` call across `status-truth.yaml`, `wiki-lint.yaml`, `reconcile-repos.yaml`, and `capture-learnings.yaml` uses `.field // 0` to default a missing/absent counter to zero for display — that's the correct, intended use of `//`, since a count is never legitimately the boolean `false`.
- **Boolean decision gates must never use string-fallback coalescing.** The two gates that decide control flow from a boolean — `survey-repo.yaml`'s resolve step (`jq -er '... | select(.isPrivate == false) | ...'`) and its recheck step (`jq -e '.data.node.isPrivate == false'`) — use `jq -e` assertions with `select()`/strict equality, never `// "fallback"`. Any future boolean gate should follow the same `jq -e` pattern; reach for `// 0` only when the field is a display-only count.

## Examples

### Before — falsy-coalesce trap

```yaml
# survey-repo.yaml — broke for ~10 hours after Unit 6 shipped
is_private=$(printf '%s' "$response" | jq -r '.data.node.isPrivate // "null"')
name_with_owner=$(printf '%s' "$response" | jq -r '.data.node.nameWithOwner // ""')

if [ -z "$name_with_owner" ] || [ "$is_private" = "null" ] || [ "$is_private" != "false" ]; then
  printf 'Aborting: %s is not definitively public\n' "$NODE_ID" >&2
  exit 1
fi
```

When `response = {"data":{"node":{"nameWithOwner":"x/y","isPrivate":false}}}`:

- `jq -r '.isPrivate // "null"'` → `"null"` (the trap)
- `[ "$is_private" = "null" ]` → true
- Abort

### After — `jq -e` assertion

```yaml
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
```

When `response = {"data":{"node":{"nameWithOwner":"x/y","isPrivate":false}}}`:

- `select(.isPrivate == false)` keeps the node
- `select(.nameWithOwner != "")` keeps the node
- `.nameWithOwner` emits `"x/y"`
- Exit 0, `name_with_owner=x/y`

When `response = {"data":{"node":{"isPrivate":true}}}`:

- `select(.isPrivate == false)` filters out
- No output
- `jq -e` exits non-zero
- Abort with the message

### Verification one-liners

```sh
# Verify a public response passes:
printf '%s' '{"data":{"node":{"nameWithOwner":"x/y","isPrivate":false}}}' \
  | jq -er '.data.node | select(.isPrivate == false) | .nameWithOwner'
# Exit 0, stdout: x/y

# Verify a private response aborts:
printf '%s' '{"data":{"node":{"isPrivate":true}}}' \
  | jq -er '.data.node | select(.isPrivate == false) | .nameWithOwner'
# Exit 4, no stdout

# Verify the trap explicitly (still useful as a one-liner sanity check):
printf '%s' '{"isPrivate":false}' | jq -r '.isPrivate // "null"'
# Outputs: null  (the bug)
```

## Related

- [Private repo dispatch requires definitive public visibility](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md) — the engine-side privacy gate this workflow gate complements.
- [Survey Repo dispatch boundary trusted caller-provided owner/repo](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — the workflow-side privacy gate where this bug lived.
- [Silent Failures in Autonomous Multi-Step Pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md) — the "silence becomes loud" principle. This gate failed silently in the wrong direction for ~10 hours; the fix preserves the failed-closed posture while letting the desired-success branch actually fire.
- [Autonomous pipeline minimum-progress floor for threshold-gated dispatch](../best-practices/autonomous-pipeline-minimum-progress-floor-2026-05-17.md) — the floor work motivated the urgent triage that surfaced this bug.

## References

- [jq manual — Alternative operator](https://stedolan.github.io/jq/manual/#alternative-operator-) — official documentation of `//`'s coalesce-on-false behavior.
- [Survey Repo gate fix PR](https://github.com/fro-bot/.github/pull/3298) — the original fix.
- [Survey Repo Unit 6 PR](https://github.com/fro-bot/.github/pull/3293) — where the bug was introduced.
