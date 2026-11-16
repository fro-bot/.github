---
title: A verified commit authenticates the committer, not the author
date: 2026-11-16
category: security-issues
module: packages/registry/src/renovate-approve.ts
problem_type: security_issue
component: tooling
severity: high
symptoms:
  - "Pre-merge: a commit whose author resolved to the App and whose signature showed as verified reached createReview(APPROVE), whoever signed it"
  - "Pre-merge: a rate-limited response moved the sweep on to the next candidate instead of stopping requests on the shared token"
root_cause: missing_validation
resolution_type: code_fix
applies_when:
  - a gate grants approval or trust to commits because a bot or App authored them
  - a check reads GitHub's commit verification fields to decide who made a change
  - a batch job shares one token across many requests and can be rate limited
tags:
  - commit-signing
  - provenance
  - trust-gate
  - renovate-approve
  - rate-limit
---

# A verified commit authenticates the committer, not the author

## Problem

The Renovate approver gives `fro-bot`'s code-owner approval to automerge-labelled Renovate PRs. The first version of its commit check (`isAppCommit`) accepted a commit when its author resolved to the App and `verification.verified` was true. The first review of [#4186](https://github.com/fro-bot/.github/pull/4186) blocked the merge on it (P1).

GitHub [verifies the committer's email against the signing key](https://docs.github.com/en/authentication/troubleshooting-commit-signature-verification/using-a-verified-email-address-in-your-gpg-key). Authorship is a separate field that the signer does not prove. Anyone who can write to the branch can add a commit with the App's public author email, sign it with their own verified key, and, once checks pass, get the approval for a change the App never made. The reviewer confirmed with an in-memory sweep that this response shape reached `createReview(APPROVE)`. No forged commit was pushed live.

## Symptoms

- A commit authored as the App but committed and signed by a person counted as an App commit.
- Nothing in the response told the two cases apart, because the check never read the committer.

## What Didn't Work

- **`author == App AND verified`.** `verified` says the committer's signature is good. It says nothing about the author.
- **Another author or committer text field as a stand-in.** The review ruled this out: names and emails are text that the person making the commit chooses.

## Solution

A commit counts only when GitHub itself committed and signed it: the author is the App by type and numeric id, the top-level committer is `web-flow` by numeric id, and the signature is verified with reason `valid` (`packages/registry/src/renovate-approve.ts:257-273`, identities at `:190-196`):

```ts fragment
function isAppCommit(entry: unknown): boolean {
  const commit = new Object(entry)
  const verification = new Object(Reflect.get(new Object(Reflect.get(commit, 'commit')), 'verification'))
  return (
    isApp(Reflect.get(commit, 'author')) &&
    Reflect.get(new Object(Reflect.get(commit, 'committer')), 'id') === identity().signerId &&
    Reflect.get(verification, 'verified') === true &&
    Reflect.get(verification, 'reason') === 'valid'
  )
}
```

Any commit that fails this makes the PR `foreign-commit`, with no approval call. The same rule runs again on the fresh read just before an approval.

## Why This Works

The committer is the identity the signature is checked against, so pinning the committer to GitHub's own numeric id ties the verified signature to GitHub, not to whoever pushed. Numeric ids, not logins or emails, are compared, and a string id such as `'19864447'` does not match. The author check then only has to say who GitHub made the commit for.

## Prevention

- Before trusting a commit field, write down what GitHub proves about it. `verification.verified`: the committer's key. `committer`: the identity checked against that key. `author`: a claim.
- Test the forgery: `packages/registry/src/renovate-approve.test.ts:1398-1431` refuses an App-authored commit committed by another user, by the App, with no committer, with a string id, with a reason other than `valid`, and one bad commit among good ones. `:1433-1438` checks that a person-signed App-authored commit gets no review while a clean PR next to it is approved; `:1440-1449` accepts the real Renovate shape.
- **A shared token's rate limit is account-wide.** The same review flagged (P2) that 429s were retried on a fixed backoff and a rate-limited 403 moved on to the next candidate. The merged fix does not wait out `Retry-After`; it treats a 429, or a 403 with the limit's headers or message, as never retryable and sets one sweep-wide latch, after which nothing more is sent and the remaining candidates end as `rate-limited` (`renovate-approve.ts:283-293`, `:421-436`).
- **Keep a rate limit's identity through timeout handling.** The second review reproduced, under Bun with the installed Octokit, a 429 whose body stalled until the request aborted. The abort normalization turned it into a timeout and the latch never set. `timed` now rethrows a recognized rate limit before normalizing an abort (`renovate-approve.ts:406-420`).

## Related

- [The wiki authority guard trusted a branch name](wiki-authority-guard-branch-name-spoofable-2026-10-10.md): the same mistake with a branch name standing in for an origin.
- [A dispatch ref guard is not a security boundary](../best-practices/dispatch-ref-guard-is-not-a-security-boundary-2026-10-10.md): a forgeable field is not an identity.
- [Check the first live event before trusting an event-driven workflow](../best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md): the rollout rule all three reviews asked to keep.
- [Exact-match trust gates need type discipline](../best-practices/exact-match-trust-gates-need-type-discipline-2026-09-08.md): why the ids are compared as numbers.
- Merge commit `9559b86d3a0fb736c00b14f07cc208b38e91295f` (#4186).
