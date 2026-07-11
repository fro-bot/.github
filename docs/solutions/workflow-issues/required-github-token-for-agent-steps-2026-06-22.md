---
title: 'Agent and automation steps need their GitHub token wired explicitly'
date: 2026-06-22
last_updated: 2026-06-22
problem_type: workflow_issue
component: development_workflow
module: github-actions-workflows
severity: medium
verified: 2026-06-22
tags:
  - github-actions
  - github-token
  - agent-step
  - credentials
  - least-privilege
applies_when:
  - A workflow invokes a third-party action or agent step that performs GitHub API operations.
  - The step declares a required token input, or relies on a token to authenticate.
  - A privacy or security review removed a token from a step and now the step fails at startup.
---

# Agent and automation steps need their GitHub token wired explicitly

## Context

The learning-capture workflow's agent step failed on its first run at bootstrap with:

```
Invalid inputs: Input required and not supplied: github-token
```

The harvest step before it succeeded; only the agent step failed. The cause was a token-wiring gap created by a well-intentioned security fix: the agent step had been stripped of its `github-token` to prevent the agent from creating issues directly (issue creation was meant to happen only in a later deterministic step). But the agent action declares `github-token` as a **required** input, so removing it entirely breaks the step before any of its logic runs.

The symptom is easy to misread. "Input required and not supplied" surfaces from inside the action, so it can look like a logic or configuration bug in the agent rather than a missing-credential bug in the workflow. The first instinct was to investigate the agent's behavior; the actual fix was one line of token wiring.

The right resolution was **not** to hand back a broad token. The agent does need *a* token to satisfy the required input, but it must not be able to perform the writes the deterministic step owns. The fix passed the workflow's auto-provisioned `GITHUB_TOKEN`, scoped by the job's `permissions:` block to `contents: read` only. That satisfies the required input while denying the agent any issue-creation reach — issue creation stays in the deterministic step under a separate App token. The security goal (the agent cannot bypass the downstream gate) is preserved by the **token scope**, not by token absence.

## Guidance

**Treat token wiring into agent/automation steps as a first-class concern, separate from token scope.**

- **A required `github-token` input must be supplied** even when you want to restrict what the step can do. Removing it breaks the step at startup, not at the point of a privileged operation.
- **Restrict capability by scope, not by omission.** To deny a step write access, pass the auto-provisioned `GITHUB_TOKEN` and constrain the job's `permissions:` (e.g. `contents: read`, no `issues: write`). The step authenticates but cannot perform writes outside its scope.
- **Keep privileged operations in a separate step with its own credential.** If one step must read and another must write, give the write step its own token (e.g. a GitHub App installation token) and keep the read-only step on the constrained `GITHUB_TOKEN`. The trust boundary is then enforced by which step holds which token.
- **When a step claims a token is missing, start debugging at the credential wiring, not the step's logic.** The failure signature ("input required and not supplied", or auth/permission errors surfacing from inside a nested tool invocation) points at the token plumbing first. The default workflow token is not always wired through to nested tool steps, and a required input will not inherit implicitly.
- **Keep the comments honest about the mechanism.** If a step omits a token "so it can't write," and a later change adds the token back under a read-only scope, update the comment — the invariant moved from *token absence* to *token scope*, and a stale comment documents a false security guarantee for the next reviewer.

## Related

- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — the same separate-step-with-its-own-credential pattern, where a privacy gate runs under a distinct token so the boundary is enforced by which step holds which credential.
- [Privacy-gate promotion leak prevention](../best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md) — a related case of a gate that must live inside the trust boundary it protects, using a scoped default token rather than a broad PAT for the read it needs.
