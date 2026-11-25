---
title: A yield-to-people rule must exempt your own service account
date: 2026-11-25
category: best-practices
module: packages/registry/src/renovate-approve.ts
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - automation pauses while a person has work open, and decides who is a person from the author's account type
  - the operator's own automation writes through a user account, not an App or bot account
tags:
  - renovate-approve
  - service-account
  - identity
  - yield-rule
  - exact-match
---

# A yield-to-people rule must exempt your own service account

## Context

When automation steps aside while a person has work open, decide "person" by identity, not by account type alone. A service account that the automation's owner runs is a `User` on GitHub, so a rule keyed on `user.type` treats it as a person.

The Renovate approver yields while any open, non-draft pull request against `main` from a branch in this repository is by a user account, so that its merges don't push that pull request behind `main`. `isYieldTarget` in `packages/registry/src/renovate-approve.ts` excluded only authors whose type is `Bot`. The `fro-bot` user is Fro Bot's own service account, which authors Remediate's pull requests. [#4299](https://github.com/fro-bot/.github/pull/4299) by `fro-bot` was open from 2026-11-19 to 2026-11-23, and the sweep approved no Renovate PR for those four days.

## Guidance

1. **List your own accounts before writing the rule.** Every account your automation acts as is a candidate for a wrong match: the App, the bot account and any service user.
2. **Exempt the service account by exact login,** using the constant the module already has for it. The approver reuses `identity().approver`, the same login it approves as:

```ts
declare const identity: () => {appType: string; approver: string}
declare const type: unknown
declare const login: unknown

function isAutomation(): boolean {
  return type === identity().appType || login === identity().approver
}
```

3. **Let doubt still yield.** An unreadable author type yields before the login is compared, and an unreadable login on a `User` yields too.
4. **Test the near misses.** `Fro-Bot`, `fro-bot-2` and `fro-bot[bot]` still yield, and so does a `fro-bot` login with a missing type.

## Why This Matters

The rule fails silently. Each sweep reported `yielded`, which is a correct outcome for a person's pull request, so nothing looked broken until someone asked why no approval had happened for days.

## When to Apply

Any pause, hold or quiet period that is keyed on "a person is working": approvals, merges, auto-rebases and notification suppression.

## Examples

[#4317](https://github.com/fro-bot/.github/pull/4317) added the exact-login exemption and its tests; the module stays at a 100% mutation score. Its review asked for the case of a `fro-bot` login with an unreadable type, which pins that doubt wins over the exemption.

## Related

- [A workflow_run trigger starts on every branch unless it is filtered](../integration-issues/a-workflow-run-trigger-starts-on-every-branch-unless-filtered-2026-11-25.md)
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md)
