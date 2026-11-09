---
title: Check subprocess success before asserting absence
date: 2026-11-09
category: best-practices
module: scripts/test-git-isolation.test.ts
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - subprocess output supports a negative assertion
  - empty command output could also indicate execution failure
  - tests check Git configuration isolation or caller overrides
tags:
  - subprocess
  - negative-assertions
  - git-config
  - false-confidence
---

# Check subprocess success before asserting absence

## Context

PR #4133 added child-Git scope checks for test-process isolation. Review found that empty output
from a failed Git invocation could pass the assertion that no global or system scopes were loaded.
Separate environment assertions protected the defaults, but did not make that scope check valid.

## Guidance

Establish successful observation before interpreting output as absence. Assert the child status first,
include stderr in the failure diagnostic, then inspect the result. Keep environment-default and caller
override checks separate: they establish different parts of the isolation contract.

## Why This Matters

Failure to read configuration is not evidence that configuration is absent. Negative assertions can
otherwise reward a broken probe with a passing test.

## When to Apply

Apply this rule whenever a test concludes that an unwanted setting or record is absent from a
subprocess response. Treat spawn failures and nonzero exits as failed observations, not empty data.

## Examples

The merged test, still present on pinned main, checks status before parsing scopes:

```ts
import {spawnSync} from 'node:child_process'
import {expect} from 'vitest'

const listed = spawnSync('git', ['config', '--show-scope', '--list'], {cwd: '/', encoding: 'utf8'})
expect(listed.status, listed.stderr).toBe(0)
const scopes = new Set(listed.stdout.split('\n').map(line => line.split('\t')[0]))
expect(scopes.has('global')).toBe(false)
expect(scopes.has('system')).toBe(false)
```

The follow-up review confirmed the correction and 34 passing targeted tests; it did not rerun the
full suite. This is evidence for the scope-probe fix, not a claim about every configuration source.

## Related

- Source PR #4133: merge `0012f045ed92e89a87a8b09397fd8c248b1a2dfe`.
- [Diagnostic patches must fail loudly and preserve stderr](diagnostic-patches-observability-discipline-2026-05-20.md) — `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md`.
