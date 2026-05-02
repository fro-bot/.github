---
title: Wiki Lint Must Inspect the Authoritative Data Snapshot and Report Restore Failures Separately
category: integration-issues
problem_type: integration_issue
component: tooling
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: medium
date: 2026-05-02
last_updated: 2026-05-02
module: .github/workflows/wiki-lint.yaml + scripts/wiki-lint.ts
related_components:
  - development_workflow
tags:
  - wiki-lint
  - github-actions
  - data-branch
  - knowledge-wiki
  - wikilinks
  - artifacts
  - report-only
verified: true
symptoms:
  - Weekly wiki checks would be wrong if they linted the checked-out branch instead of the authoritative `data` snapshot
  - Alias-backed wikilinks could false-positive as broken references
  - Restore failures could end without a durable report artifact explaining why lint did not run
  - Missing cross-reference coverage could stop at repo pages instead of the full wiki graph
---

## Problem

Unit 17 originally assumed a dedicated wiki-lint branch and draft remediation PR flow. That model was wrong for this repo. The authoritative wiki lives on `data`, so a weekly lint run has to inspect the restored `origin/data` snapshot, classify findings, and report them without creating a second autonomous write path.

That also meant the failure path had to be explicit. If the workflow could not restore `knowledge/` from `origin/data`, the run still needed to emit a durable report artifact instead of just failing early and leaving no explanation behind.

## Symptoms

- The stale Unit 17 plan targeted a dedicated proposal branch instead of the repo's `data -> main` authority model.
- Valid alias-backed wikilinks like `[[workflow-patterns]]` could be misreported as `broken-wikilink` if lint only matched slugs.
- A page with no wikilinks could slip through if `missing-cross-reference` only applied to repo pages.
- Restore failure could fail the job before any markdown report artifact existed.

## What Didn't Work

- **Linting the checked-out tree.** `main` is not the authoritative wiki source, so linting checkout state would inspect drift instead of truth.
- **The old draft-PR remediation model.** That would have introduced a second mutation path for `knowledge/**` instead of a detect/report-only control.
- **Slug-only wikilink validation.** Pages can expose valid `aliases`, so looking at `page.slug` alone is incomplete.
- **Fail-fast restore handling without a report.** A red workflow with no artifact is not enough operational evidence for weekly unattended runs.

## Solution

The implementation restores the authoritative snapshot, lints it, emits findings, uploads a report, and writes nothing back.

`.github/workflows/wiki-lint.yaml` restores `knowledge/` from `origin/data`, runs lint only on restore success, and routes restore failure through the same reporting surface:

```yaml
- name: Restore wiki from data branch
  id: restore-wiki
  continue-on-error: true
  run: |
    if git ls-remote --exit-code origin data >/dev/null 2>&1; then
      git fetch origin data
      git restore --source FETCH_HEAD --worktree -- knowledge
    else
      printf '%s\n' 'cannot lint wiki snapshot: origin/data is unavailable' >&2
      exit 1
    fi

- name: Run wiki lint
  if: steps.restore-wiki.outcome == 'success'
  env:
    WIKI_LINT_REPORT_PATH: wiki-lint-report.md
  run: node scripts/wiki-lint.ts

- name: Report restore failure
  if: steps.restore-wiki.outcome == 'failure'
  env:
    WIKI_LINT_REPORT_PATH: wiki-lint-report.md
    WIKI_LINT_FAILURE_MESSAGE: 'cannot lint wiki snapshot: origin/data is unavailable'
  run: node scripts/wiki-lint.ts
```

`scripts/wiki-lint.ts` implements a detect/report-only engine around `lintWikiSnapshot()`, `writeWikiLintOutputs()`, `writeWikiLintFailureOutputs()`, and `runWikiLint()`.

- Deterministic findings: `broken-wikilink`, `orphan-page`, `index-drift`, `missing-frontmatter`, `invalid-frontmatter`
- Advisory findings: `stale-claim`, `missing-cross-reference`, `knowledge-gap`

The linter treats aliases as valid link targets by adding both the page slug and any frontmatter aliases into the target set, which prevents alias-backed links from false-positiving:

```ts
function collectPageTargets(pages: readonly ParsedPage[]): Set<string> {
  const targets = new Set<string>()

  for (const page of pages) {
    targets.add(page.slug)

    for (const alias of collectAliases(page.frontmatter.aliases)) {
      targets.add(alias)
    }
  }

  return targets
}
```

The review fix also broadened `missing-cross-reference` across all page types while keeping `knowledge-gap` intentionally narrower and repo-specific when non-repo knowledge already exists.

`scripts/wiki-lint.test.ts` now covers the current script contract: clean snapshot, alias-backed links, deterministic finding kinds, malformed frontmatter, advisory findings, non-repo `missing-cross-reference` coverage, output writing, execution-failure reporting, and disk-based runs. It also asserts that `.github/workflows/wiki-lint.yaml` includes the restore-failure reporting path.

## Why This Works

The fix works because it matches the repo's `data`-branch wiki source and preserves a reporting surface when restore fails.

- **Authority is correct:** the workflow restores `knowledge/` from `origin/data` before linting.
- **Signals stay distinct:** deterministic integrity defects and advisory content signals are reported separately.
- **False positives are reduced:** alias-backed wikilinks resolve against both slugs and aliases.
- **Page coverage is broader:** `missing-cross-reference` now applies to any page body with no wikilinks, not just repo pages.
- **Failure is reported:** the workflow still routes restore failure through `writeWikiLintFailureOutputs()`, although the current workflow message is a fixed `origin/data is unavailable` string rather than a fully diagnosed restore error.

## Prevention

1. **Lint the authoritative snapshot, not checkout state.** Any future wiki health workflow should restore from `origin/data` first.
2. **Keep the report artifact contract on script-handled paths.** Clean, findings, and `execution-failure` runs should keep producing the same markdown report surface.
3. **Keep alias resolution and page-type coverage in tests.** If wiki schema or page types evolve, preserve regression coverage for aliases and non-repo `missing-cross-reference` behavior.
4. **Do not smuggle remediation into v1.** Any future auto-fix or issue-escalation path should be an explicit follow-up, not a hidden side effect of linting.

## Related Issues

- Related issue: https://github.com/fro-bot/.github/issues/3148
- Related learning: [`docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md)
- Updated plan unit: `docs/plans/2025-04-15-001-feat-frobot-control-plane-plan.md`
