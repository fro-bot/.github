---
title: The wiki authority guard trusted a branch name without checking which repository it lives in
date: 2026-10-10
last_updated: 2026-10-10
verified: 2026-10-10
category: security-issues
module: scripts/check-wiki-authority.ts
problem_type: security_issue
component: tooling
severity: high
symptoms:
  - "Latent: a Fro Bot-authored PR could touch the guarded wiki, index, log, corrections and non-repos.yaml metadata paths from any head branch"
  - "Latent: metadata/repos.yaml was gated only by the head branch name data, never by the repository that branch lived in"
root_cause: missing_validation
resolution_type: code_fix
tags:
  - branch-name
  - trust-gate
  - fork
  - authority
  - check-wiki-authority
---

# The wiki authority guard trusted a branch name without checking which repository it lives in

## Problem

`check-wiki-authority` keeps autonomously managed paths (wiki pages, the index, the log, corrections and the `metadata/*.yaml` state) writable only through the `data` branch and its promotion PR. It exempted Fro Bot identities, on the premise that a Fro Bot author is the legitimate writer. For `metadata/repos.yaml` the exemption was conditional on the head branch being named `data`.

A branch name is not an origin. A fork can name its branch `data`, and who authored a PR says nothing about where its head lives. Nothing ever tested the premise that a Fro Bot identity never opens a PR from a fork, so the guard rested on an untested assumption.

Both symptoms were latent. No exploit was observed. The gap was found during review of PR #3974, before it merged.

## Symptoms

- A Fro Bot-authored PR could touch every guarded path other than `metadata/repos.yaml` from any head branch. Only `repos.yaml` required the `data` head.
- For `metadata/repos.yaml`, the head branch name `data` was enough. The repository the branch lived in was never compared with the repository the guard ran in.

## What Didn't Work

Adding a `typeof headRef === 'string'` and `typeof headRepo === 'string'` conjunct was tried and dropped. Strict `===` against a string already rejects every non-string, so the extra check was dead code, and the code comment records that its mutation-testing mutant is equivalent to the strict comparison and cannot be killed by any test (`scripts/check-wiki-authority.ts:90-93`). See the reconciliation below for how this squares with the repository's type-discipline rule.

## Solution

The old rule was: if the author is a Fro Bot identity, allow, unless the changed files include `metadata/repos.yaml` and the head is not `data` (`git show a72ffde^:scripts/check-wiki-authority.ts`, lines 66-80). The old comment justified the branch-name check with "a fro-bot identity never originates from a fork".

The guard now applies one rule to every guarded path. The Fro Bot allow needs the `data` head, a non-empty base repository, and a head repository equal to the base repository (`scripts/check-wiki-authority.ts:94-101`):

```ts fragment
  if (
    frobotAuthors().has(input.author) &&
    input.headRef === 'data' &&
    input.baseRepo !== '' &&
    input.headRepo === input.baseRepo
  ) {
    return {ok: true}
  }
```

The guard's inputs are typed `unknown` (`:50-55`). The event parser reads the head repository from the payload without validating it (`:171`):

```ts fragment
  const headRepo: unknown = parsed.pull_request!.head!.repo?.full_name
```

A guarded path from a non-Fro-Bot author is blocked on every head, as before. A Fro Bot PR that touches only unguarded paths is allowed from any head and any repository.

## Why This Works

The new check compares repository identity directly instead of inferring it from authorship. Strict `===` against a primitive narrows `unknown` to exactly `'data'` or exactly the base repository string. A `null` head repository (a deleted fork), a one-element array, a `String` object and a differently cased name never match. `baseRepo !== ''` keeps an unresolved base repository from matching an empty head repository.

### Reconciliation with the exact-match rule

[An exact-match trust gate needs type discipline](../best-practices/exact-match-trust-gates-need-type-discipline-2026-09-08.md) says to check `typeof` before any comparison a coercion could satisfy, and lists removing a `typeof` conjunct as a trigger for care. This change removed one, so it needs an explanation instead of silence.

The rule exists because a value can reach a consumer that coerces: template interpolation, `String(value)`, concatenation, `new URL(value)`, string methods. `headRef` and `headRepo` reach none of those. Their only consumer is `===` against a string, and `===` does not coerce. That is a third disposition, alongside the two the other document names ("keep the guard" and "make the invariant explicit in the type"): the consumer cannot coerce, and the `unknown` type keeps the compiler from letting anyone treat the value as a string without narrowing it.

That holds only while it stays true. If a coercing consumer is ever added, such as interpolating `headRepo` into a message or calling `.includes` on it, the `typeof` check has to come back at that point. The other document's rule stands for every other gate.

## Prevention

- When a head branch name grants authority, also compare the repository that branch lives in. A branch name alone is not an origin.
- Keep guard inputs `unknown` and narrow them by strict equality against the expected primitive.
- Test the decoys: a one-element array, a `String` object, a case variant, a trailing space, `undefined`, `null`, the empty string and a fork. They are in `scripts/check-wiki-authority.test.ts`: fork on the `data` head (`:193-203`), `headRef` decoys (`:269-286`), `headRepo` decoys (`:288-305`), an unresolved base (`:307-316`), the allowed promotion (`:318-327`) and the unguarded-only fork (`:329-338`). The event-payload tests (`:947` and `:972`) check the parse layer, including that a `null` `head.repo` yields `undefined` rather than a throw. The `null` case is not tested at the guard level in its own right.
- A premise stated in a comment needs a test that pins it, or the comment ends up doing the guard's job.

## Related Issues

- [An exact-match trust gate needs type discipline — establish shape before a coercing consumer sees the value](../best-practices/exact-match-trust-gates-need-type-discipline-2026-09-08.md): the rule this change qualifies, as described above.
- [Mutation coverage is silent about the branch you didn't write](mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md): precedent for the track and structure.
- [Structured-First Attribution for Public-Allowlist Privacy Gates](../best-practices/wiki-page-structured-attribution-2026-06-04.md)
- [A mutation score can measure nothing — check reachability before writing tests](../best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md)
- [A dispatch ref guard is not a security boundary](../best-practices/dispatch-ref-guard-is-not-a-security-boundary-2026-10-10.md) shares the principle that a ref or branch name is not an origin.
- PR #3974 (merge `a72ffde`).
