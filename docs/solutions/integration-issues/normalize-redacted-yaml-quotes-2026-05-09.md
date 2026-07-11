---
title: Normalize redacted metadata YAML quoting before data promotion
date: 2026-05-09
category: integration-issues
module: commit-metadata
problem_type: integration_issue
component: tooling
severity: medium
last_updated: 2026-07-04
verified: 2026-05-09
symptoms:
  - Scheduled Reconcile Repos succeeded but wrote metadata/repos.yaml with double-quoted redacted owner values.
  - Main-branch lint expected single-quoted redacted values.
  - A later data-to-main promotion would fail even though the producing workflow was green.
root_cause: config_error
resolution_type: code_fix
related_components:
  - development_workflow
  - testing_framework
tags:
  - yaml
  - prettier
  - metadata
  - data-branch
  - reconcile-repos
  - redaction
---

# Normalize redacted metadata YAML quoting before data promotion

## Problem

The scheduled Reconcile Repos workflow can succeed while writing `metadata/repos.yaml` in a shape
that later fails the `data` -> `main` promotion quality gate. In this case, the data-branch writer
serialized the private-repo redaction sentinel as double-quoted YAML:

```yaml
owner: "[REDACTED]"
```

Prettier's YAML formatting expected the same value with single quotes:

```yaml
owner: '[REDACTED]'
```

That made the producing workflow look healthy while leaving the next promotion PR lint-blocked.

## Symptoms

- Reconcile Repos completed successfully and committed to `origin/data`.
- The resulting `metadata/repos.yaml` diff changed only generated metadata but used
  `owner: "[REDACTED]"`.
- A local diff against the data tip showed the formatting-only mismatch before promotion.
- Leak scans stayed clean, so this was a formatting-contract failure rather than a privacy leak.

## What Didn't Work

- Treating the green Reconcile Repos run as sufficient was misleading. The producer succeeded, but
  the artifact it produced was incompatible with the downstream promotion gate.
- Repairing `data` alone would only fix the current promotion. The next scheduled metadata write
  would reintroduce the same double-quoted sentinel.
- Testing only parsed object equality would miss the bug. The parsed metadata is semantically
  unchanged whether YAML uses single or double quotes.

## Solution

Make the shared metadata writer serialize YAML with the repository's quote style:

```ts
function serializeYaml(value: unknown): string {
  const serialized = stringify(value, {
    indent: 2,
    lineWidth: 0,
    singleQuote: true,
  })

  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}
```

Add regression coverage for both paths that matter:

1. New redacted metadata values serialize as `owner: '[REDACTED]'`.
2. An existing double-quoted data file is normalized even when the mutator returns the parsed
   metadata unchanged.

The second case matters because `commitMetadata` compares serialized text, not parsed objects, to
decide whether a write is needed. The test should prove a formatting-only normalization still
commits:

```ts
const result = await commitMetadata({
  path: 'metadata/repos.yaml',
  message: 'redacted formatting',
  mutator: current => current,
  octokit,
})

expect(result.committed).toBe(true)
expect(serialized).toContain("owner: '[REDACTED]'")
expect(serialized).not.toContain('owner: "[REDACTED]"')
```

The quoting fix is one piece of a broader redacted-metadata serialization contract enforced by the
shared metadata writer. `normalizeRepoEntryForStorage` (`scripts/repos-metadata.ts` ~82-137) is the
single place that decides an entry's redacted shape: for a private entry it forces
`owner: '[REDACTED]'` and writes `name` to the `node_id` value, short-circuiting to the same object
by reference when the entry is already in that canonical form. `addRepoEntry` (~236-297) routes every
new-entry write through it, so no caller can introduce a redacted entry with the wrong quoting or
field layout.

That canonical form has to survive reconcile, not just first-write. `scripts/reconcile-repos.ts`
keeps `node_id` sticky across probe outcomes it can't trust — `transient`/`malformed` probe results
and `still-accessible` disagreements with the access-list snapshot all return `...entry` unchanged
rather than writing a fresh value, and lost-access transitions preserve the prior `node_id` when no
fresh source is available. `database_id` is written onto redacted entries via
`normalizeRepoEntryForStorage`'s `storageInputWithProbe` only when the probe returns a positive
integer, and stays untouched otherwise (`reconcile-repos.ts` field-refresh block, ~966-1003) — it is
a format-independent denylist anchor that must never regress once populated.

## Why This Works

`[REDACTED]` requires quoting in YAML because of the brackets. Setting `singleQuote: true` makes
generated metadata match Prettier's enforced YAML style, including redaction sentinels.

The unchanged-parsed-metadata regression protects the delayed-failure path: a data file can be
semantically correct but still promotion-blocking because its serialized form is not lintable.

Routing every redacted-entry write through `normalizeRepoEntryForStorage` means the quoting fix and
the sticky `node_id`/`database_id` contract are enforced at the same choke point — a caller cannot
bypass one without bypassing the other.

## Prevention

- Treat formatting as part of the persisted data contract for autonomous branch writers.
- Regression-test exact serialized YAML for sentinel values such as `[REDACTED]`, not just parsed
  object shape.
- Include a normalization test when fixing generated-file formatting bugs; the mutator may return
  semantically unchanged data while the writer still needs to repair serialized text.
- Verify generated-file fixes through the full local quality gate before promotion.

## Related Issues

- [Silent failures in autonomous multi-step pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md)
- [Data Merge PR recovery must distinguish GitHub 422s and mergeability races](merge-data-pr-github-422-race-recovery-2026-05-02.md)
- [Private repo dispatch requires definitive public visibility](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md)
- PR: https://github.com/fro-bot/.github/pull/3270
