---
title: A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time
date: 2026-06-22
last_updated: 2026-06-22
problem_type: best_practice
component: development_workflow
module: github-workflows
severity: high
verified: 2026-06-22
tags:
  - credentials
  - least-privilege
  - mint-time-scoping
  - app-installation-tokens
  - token-scope
applies_when:
  - a second credential or key is added to isolate a use case from a broader-scoped principal
  - a GitHub App installation token is minted for a specific workflow step
  - a planning document describes a security invariant that needs verification against live data
  - least-privilege access is required but the parent App or principal has a broader registered scope
---

# A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time

## Context

A planning PR described adding a second GitHub App key to isolate a read-only use case from a
broader-scoped App. The intent was least-privilege access: the new key would be "read-only" by
virtue of being separate from the primary key. The review caught the flaw: adding another key
does not narrow what that key can do. Both keys mint tokens from the same App installation,
which has the same registered permission set. The second key gives rotation isolation — you can
rotate it independently — but not permission isolation.

The correct mechanism is to mint installation tokens with an explicit `permissions` subset at
mint time, regardless of what the parent App has registered. GitHub's Apps API supports this:
pass a `permissions` object to the token endpoint and the resulting token is constrained to
exactly those permissions, even if the App installation has broader access. Read-only by
construction, not by assumption.

The review also demonstrated a secondary discipline: when assessing a planning document with no
executable surface yet, verify its security invariants against live source rather than its prose.
Here that meant confirming that redacted entries in the live metadata used `owner: '[REDACTED]'`
and `name == node_id` as the stable join key — grounding the plan's leak-prevention design in
reality before trusting it.

Merged at `e88432c4223e2d7442ba2307407f7bb80b040f35`.

## Guidance

### 1. A second credential gives rotation isolation, not permission isolation

Adding a new key, secret, or credential for a principal does not change what that principal can
do. All keys for the same GitHub App installation mint tokens from the same registered permission
set. Conflating "different key" with "narrower key" is a common and dangerous shortcut.

Use a second credential when you need independent rotation. Use mint-time scoping when you need
least privilege. These are orthogonal concerns.

### 2. Enforce least privilege by scoping at mint time

When minting a GitHub App installation token, pass an explicit `permissions` object. The
resulting token is constrained to exactly those permissions, regardless of the App's broader
registered scope:

```ts
// Mint a read-only token regardless of what the App installation has registered
const {data: {token}} = await octokit.rest.apps.createInstallationAccessToken({
  installation_id: installationId,
  permissions: {
    contents: 'read',
    metadata: 'read',
  },
  // No 'issues', 'pull_requests', 'administration', etc.
})
```

This is the correct mechanism for least-privilege access with GitHub Apps. A token minted
without an explicit `permissions` object inherits the full installation scope.

### 3. Validate a plan's security invariants against live data, not its prose

A planning document can describe a correct security design while the live implementation
diverges from it. When reviewing a plan, pick one or two invariants the plan asserts and verify
them against the actual source or data:

- If the plan says "redacted entries use `node_id` as the stable join key," read the live
  metadata and confirm the shape.
- If the plan says "no canonical identifier is rendered publicly," check the committed files.
- If the plan says "the token is read-only," check what permissions the App installation has
  registered and whether mint-time scoping is in place.

Prose describes intent. Live data describes reality. Ground the review in reality.

## Related

- [Agent and automation steps need their GitHub token wired explicitly](../workflow-issues/required-github-token-for-agent-steps-2026-06-22.md) — the companion pattern: restrict capability by token scope, not by token absence; keep privileged operations in a separate step with its own credential.
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — the same separate-step-with-its-own-credential pattern, where a privacy gate runs under a distinct token so the boundary is enforced by which step holds which credential.
- [Diagnostic patches observability discipline](../best-practices/diagnostic-patches-observability-discipline-2026-05-20.md) — verify behavior against live state rather than assumptions; the same discipline applied to observability patches.
