---
title: Normalize redacted metadata YAML quoting before data promotion
date: 2026-05-09
category: integration-issues
module: commit-metadata
problem_type: integration_issue
component: tooling
severity: medium
last_updated: 2026-05-09
verified: true
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

## Why This Works

`[REDACTED]` requires quoting in YAML because of the brackets. Setting `singleQuote: true` makes
generated metadata match Prettier's enforced YAML style, including redaction sentinels.

The unchanged-parsed-metadata regression protects the delayed-failure path: a data file can be
semantically correct but still promotion-blocking because its serialized form is not lintable.

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
