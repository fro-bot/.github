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

When automation pauses for a person's work, exempt the automation's own service account by exact login. GitHub reports a service account as a `User`, so a rule keyed on the account type treats it as a person.

The Renovate approver yields: it approves nothing while an open, non-draft pull request against `main`, from a branch in this repository, is by a user account, so that its merges don't put that pull request behind `main`. `isYieldTarget` in `packages/registry/src/renovate-approve.ts` excluded only authors whose type is `Bot`. The `fro-bot` user is Fro Bot's service account; Remediate, the daily job that opens fix pull requests, writes through it. While [#4299](https://github.com/fro-bot/.github/pull/4299) by `fro-bot` was open, from 2026-11-19 to 2026-11-23, the approver approved no Renovate pull request.

## Guidance

1. **List every account your automation acts as** (the App, any bot account, any service user) before writing the rule.
2. **Exempt the service account by exact login,** with the constant the module already has. The approver compares against `identity().approver`, the login it approves as.
3. **Let doubt still yield.** An unreadable author type yields before the login is compared.
4. **Test the near misses.** As `User` authors, `Fro-Bot`, `fro-bot-2` and `fro-bot[bot]` still yield, and so does a `fro-bot` login whose type cannot be read. The real App is type `Bot` and never pauses approvals.

## Why This Matters

The rule fails silently. Each approval pass reported `yielded`, which is right for a person's pull request, so the service account's pull request looked like one.

## When to Apply

Any pause or hold keyed on "a person is working": approvals, merges, automatic rebases and notification quiet periods.

## Examples

[#4317](https://github.com/fro-bot/.github/pull/4317) added the exemption and the near-miss tests in `packages/registry/src/renovate-approve.test.ts`.

## Related

- [A workflow_run trigger starts on every branch unless it is filtered](../integration-issues/a-workflow-run-trigger-starts-on-every-branch-unless-filtered-2026-11-25.md)
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md)
