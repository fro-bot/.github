---
title: Fix a fail-safe flag's false positive in the consumer
date: 2026-11-15
category: best-practices
module: packages/privacy/src/check-private-leak.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a conservative stored flag makes a consumer reject something it should accept
  - the proposed fix is a new, more precise stored state
  - the consumer can read the live fact the flag stands in for
  - a review finds a writer path that leaves the new state stale
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

When a conservative stored flag makes a check reject something it should accept, make the check read the live fact. Do not add a more precise stored state: every writer that touches the row then has to keep it correct.

`metadata/repos.yaml` stores a row as `private: true`, redacted, for any repository reconcile cannot vouch for. That includes an archived repository, whatever its visibility: "Fail-safe: write `private: true` because we cannot reach the repo to confirm visibility" (`packages/registry/src/reconcile-plan.ts:1239`, and the same value at `:1299`). The leak scans built a private name from every such row, so a public archived repository's name counted as private. A wiki page that linked to that repository's published page failed the promotion scan ([run 43663083818](https://github.com/fro-bot/.github/actions/runs/43663083818)), and every promotion after it.

[#4251](https://github.com/fro-bot/.github/pull/4251) corrected the stored state: reconcile kept an archived public repository as a public, named row. Its review reproduced two sequences that left a private repository named, one through a name reused by another repository and one through a return path the change had not touched. `classifyTracked` writes a `lost-access` row at five sites and returns one unchanged at five more; the change edited three of the ten. The pull request was closed.

[#4256](https://github.com/fro-bot/.github/pull/4256) left reconcile alone. The lookup the scans already made now also reads the repository's `visibility` (`packages/privacy/src/private-repo-resolution.ts:38`), and a row contributes no private name only when GitHub reports exactly `PUBLIC` (`packages/privacy/src/check-private-leak.ts:803`). The next promotion passed ([run 43705065121](https://github.com/fro-bot/.github/actions/runs/43705065121)).

## Guidance

1. **Look up the live fact before reasoning from the flag.** A fail-safe flag means "not vouched for". It does not mean the stronger claim. Here one query by node ID, `node(id: $id) { ... on Repository { visibility isArchived } }`, shows whether a `private: true` row is private.
2. **Count the writer paths before adding a stored state.** List every site that writes or preserves the row. Each one must keep the new state correct, including the ones the change does not edit.
3. **Put the precision in the consumer when it can read the fact.** The stored flag stays conservative, and nothing has to be corrected by a later run.
4. **Keep the relaxation strict.** One exact value relaxes the check. Every other value, and every lookup failure, behaves as before. A public row never hides a failure beside it.
5. **Fix every mode of the check.** The promotion step and the per-PR scan each built names from the rows, and the per-PR scan posts the required `Security: Private Leak Scan` status on the promotion pull request too (`.github/workflows/check-private-leak.yaml:134`). Both now call one function, `resolvePrivateRows` (`packages/privacy/src/check-private-leak.ts:881` and `:1195`).
6. **State the time-of-check limit.** The lookup answers for the moment of the scan. A repository that turns private after the scan and before the merge is not checked again.
7. **Change layer when a review finds a stale path in the new state.** A second sequence in the same state machine is evidence that the state is in the wrong place, not that one more branch is missing.

## Why This Matters

A new stored state moves a privacy rule onto every writer of the row, and a gap in any one of them publishes a private name. The check in the consumer fails closed on everything except one value, so a case it misses costs a blocked promotion.

## When to Apply

- A fail-safe flag and a gate disagree about something that is true now.
- A fix proposes a new value or combination for a stored field that several code paths write.
- A gate runs in more than one mode, or posts more than one required result.

## Examples

Before, at the parent of the #4256 merge (`128cf71^`, `packages/privacy/src/check-private-leak.ts:840`): every resolved row became a private name.

```ts
for (const nodeId of privateNodeIds) {
  const result = await resolver(nodeId)
  if ('nameWithOwner' in result) {
    resolvedNames.push(result.nameWithOwner)
  } else {
    failedNodeIds.push(nodeId)
  }
}
```

After (`packages/privacy/src/check-private-leak.ts:800`): one exact value skips the row, and the skip is counted.

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

| Lookup result | Outcome |
| --- | --- |
| `PUBLIC` | no private name; counted in `N private row(s) resolve to public repositories and are not scanned` |
| `PRIVATE`, `INTERNAL`, a missing field, `null`, `public`, `PUBLIC ` with a space, a number, any other value | scanned as before |
| a lookup failure, alone or beside a `PUBLIC` row | the scan blocks |

The table of non-public values is at `packages/privacy/src/check-private-leak.test.ts:5982`, and the same table runs against the per-PR scan.

## Related

- [Privacy Gate Design for Data→Main Promotion Leak Prevention](privacy-gate-promotion-leak-prevention-2026-06-04.md): the scans this changes, and their fail-closed lookup rules.
- [Private repo dispatch requires definitive public visibility](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md): the same "public only on definite evidence" rule on the writer side.
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): one signal read as a stronger claim than it makes.
- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): another change of approach after patches kept moving the defect.
- [#4251](https://github.com/fro-bot/.github/pull/4251), [#4256](https://github.com/fro-bot/.github/pull/4256).
