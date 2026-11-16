---
title: Fix a fail-safe flag's false positive in the consumer
date: 2026-11-15
category: best-practices
module: packages/privacy/src/check-private-leak.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a conservative stored flag makes a check reject a result that current evidence would allow
  - the proposed fix adds a stored value that several code paths write or preserve
  - the check can read the current fact itself and reject when the lookup fails
tags:
  - fail-safe-flag
  - privacy-gate
  - private-leak-scan
  - reconcile
  - live-evidence
  - fail-closed
  - stored-state
---

# Fix a fail-safe flag's false positive in the consumer

## Context

When a check rejects a valid result because it relies on a conservative stored flag, have the check (the consumer of the flag) read the current fact directly, if it can do so reliably. Keep the stored flag as it is, and keep rejecting when the lookup fails. The alternative, a more precise stored value, must be kept correct by every code path that writes or preserves the record.

Here `metadata/repos.yaml` stores one record per tracked repository. Reconcile writes `private: true` and redacts the name when it cannot confirm visibility: "Fail-safe: write `private: true` because we cannot reach the repo to confirm visibility" (`packages/registry/src/reconcile-plan.ts:1239`). It does the same for an archived repository, whatever its visibility (`:1299`), and gives the record the status `lost-access`, the status of a repository that was revoked, archived or deleted and whose record is kept for audit. The two leak scans (one in the promotion run, one on every pull request) each built a private name from every such record, so a public archived repository's name counted as private. A wiki page that linked to that repository's published page failed the promotion scan ([run 43663083818](https://github.com/fro-bot/.github/actions/runs/43663083818)).

[#4251](https://github.com/fro-bot/.github/pull/4251) made the stored value precise: reconcile kept an archived public repository as a public, named record. Its review reproduced two sequences that left a private repository named, one through a name reused by another repository and one through a return path the change had not edited. The pull request was closed.

[#4256](https://github.com/fro-bot/.github/pull/4256) left reconcile alone. The lookup the scans already made now also requests the repository's `visibility` (`packages/privacy/src/private-repo-resolution.ts:42`), and a record contributes no private name only when GitHub reports exactly `PUBLIC` (`packages/privacy/src/check-private-leak.ts:803`). The next promotion run passed ([run 43705065121](https://github.com/fro-bot/.github/actions/runs/43705065121)). An archived repository later got a row of its own, stored `private: false` with its real name; the same consumer-side rule selects that row too, but reads the opposite way: only a live `PUBLIC` clears it, and a failed lookup scans by its stored name instead of blocking.

## Guidance

1. **Read the current fact in the consumer, and keep the stored flag conservative.** A fail-safe flag means "not vouched for", not the stronger claim. Look the fact up before reasoning from the flag: a query by node ID that requests `visibility` shows whether a `private: true` record is private.
2. **Count the code paths that write or preserve the record before adding a stored value.** Each one must keep the new value correct, including the ones the change does not edit. `classifyTracked` has five sites that write a `lost-access` record and five guarded returns that keep one, and other general returns can keep one too.
3. **Skip a record only for one exact result.** Here that is `visibility === 'PUBLIC'`. Every other value is treated as before, and so is a failed lookup. Test a batch that holds both a public result and a failed lookup: the failure must still fail the scan.
4. **Find every mode of the check and route each through the same logic.** The per-PR scan also runs on the promotion pull request and posts the required `Security: Private Leak Scan` status there (`.github/workflows/check-private-leak.yaml:134`). Both scans now call `resolvePrivateRows` (`packages/privacy/src/check-private-leak.ts:881` and `:1195`).
5. **Document that the fact can change after the check.** Visibility is read at scan time. A repository that turns private between the scan and the merge is not checked again.
6. **When a review finds a missed path, reassess the layer.** Ask whether keeping the new stored value correct on every path is worth the risk, before adding one more branch.

## Why This Matters

A new stored value puts a privacy rule on every code path that touches the record, and a gap in one of them could expose a private name. With the check in the consumer, a repository that the lookup cannot confirm as public stays scanned, so the cost of a missed case is a blocked promotion.

## When to Apply

- A conservative stored flag causes a false positive in a check.
- A proposed fix adds a value or combination to a stored field that several code paths maintain.
- The check can obtain current evidence itself, and can reject when it cannot.

## Examples

Before #4256, every successful lookup added a private name. After (`packages/privacy/src/check-private-leak.ts:800`):

```ts
for (const nodeId of nodeIds) {
  const result = await resolver(nodeId)
  if ('nameWithOwner' in result) {
    if (result.visibility === 'PUBLIC') {
      publicSkipped += 1
    } else {
      scanned += 1
      privateTokens.push(...buildTokensForName(result.nameWithOwner))
    }
  } else {
    failures.push({nodeId, error: result.error})
  }
}
```

| Resolver result | Outcome |
| --- | --- |
| `visibility` is `PUBLIC` | no private name; the skip is counted, and a scan that reaches its report prints `N private row(s) resolve to public repositories and are not scanned` |
| `PRIVATE`, `INTERNAL`, a missing field, `null`, `public`, `PUBLIC ` with a space, a number, any other value | scanned as before |
| a failed lookup, alone or beside a `PUBLIC` result | as before: the promotion scan fails, and the per-PR scan reports an error (which the operator override can pass) |

The non-public values are a test table at `packages/privacy/src/check-private-leak.test.ts:5982`, and an equivalent table runs against the per-PR scan at `:6294`.

## Related

- [Privacy Gate Design for Data→Main Promotion Leak Prevention](privacy-gate-promotion-leak-prevention-2026-06-04.md): the scans this changes, and their fail-closed lookup rules.
- [Private repo dispatch requires definitive public visibility](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md): the same "public only on definite evidence" rule on the writer side.
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): one signal read as a stronger claim than it makes.
- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): another change of approach after patches kept moving the defect.
- [#4251](https://github.com/fro-bot/.github/pull/4251), [#4256](https://github.com/fro-bot/.github/pull/4256).
