---
title: Silent Failures in Autonomous Multi-Step Pipelines (Wiki Commit Drift + Misclassified Status)
category: runtime-errors
problem_type: runtime_error
component: workflow
root_cause: wrong_contract
resolution_type: code_fix
severity: high
date: 2026-04-19
last_updated: 2026-04-19
module: scripts/wiki-ingest.ts
tags: [workflow, github-actions, wiki-ingest, porcelain, silent-failure, status-classification, additive-pipeline, autonomous, reconcile]
verified: true
---

## Problem

Two linked bugs in the `Survey Repo` workflow produced silent wiki-coverage loss across the full daily reconcile fan-out. The agent step succeeded, the wiki commit step crashed on `ENOENT`, and the metadata write-back recorded `last_survey_status: success` anyway — telling the reconcile staleness gate to skip those repos for 30 days despite no wiki content landing.

Neither bug was visible in tests or CI. Both required the progressive-dispatch pipeline (`scripts/reconcile-repos.ts`) to fire real surveys in production to surface.

## Symptoms

- Scheduled `Reconcile Repos` run dispatches N surveys (up to the configured cap)
- Every downstream `Survey Repo` run marked `failure`, but only one step inside each run shows the crash:
  ```
  Error: ENOENT: no such file or directory, open 'knowledge/wiki/entities/mise.md'
      at loadWorkingTreeWikiFiles (scripts/wiki-ingest.ts:695)
      at async main (scripts/wiki-ingest.ts:820)
  ```
- Despite the overall run failure, `metadata/repos.yaml` on `data` gains `last_survey_at: <today>, last_survey_status: success` entries for every dispatched repo
- Commits on `data` from the `Record survey result` step show `chore(reconcile): record survey success for <owner>/<repo>`, but no corresponding `feat(knowledge): survey <owner>/<repo>` commit lands from wiki-ingest
- The next reconcile cron treats the affected repos as fresh — they fall out of the candidate list for 30 days under the staleness gate

## What Didn't Work

- **Unit tests**: `scripts/wiki-ingest.test.ts` covered the happy path plus modification variants (`' M'`, `'M '`, `'A '`, `'??'`) but never the deletion variants that `git restore` produces. All tests passed.
- **`pnpm check-types` / `pnpm lint` / `pnpm test`**: all green. The type system accepts both bugs because both are runtime-only: `parsePorcelainPaths` returned `string[]` regardless of the file's on-disk state; `SURVEY_STATUS` was a GitHub Actions expression that tsc never sees.
- **Prior CI surface** (`Test Scripts Load` smoke test from PR #3134): loads each script under Node strip-only but does not invoke the wiki commit path against a drifted working tree. The crash requires a specific runtime shape that only production produces.
- **The workflow's `success()` guard on the agent step**: `steps.survey-agent.conclusion == 'success'` is true when the agent exits cleanly, even when a downstream required step fails.

## Solution

Two fixes, both in PR #3144.

### Fix A — filter deletions out of porcelain parse

`scripts/wiki-ingest.ts` is additive-only by contract (renames already out of scope; never commits file removals). `git status --porcelain` reported deletions when the workflow's `Sync wiki from data branch` step ran `git restore --source FETCH_HEAD --worktree -- knowledge` and files that exist on `main` but not on `data` disappeared from the working tree. `parsePorcelainPaths` passed those deletions through to `loadWorkingTreeWikiFiles`, which crashed reading the absent paths.

```ts
// BEFORE (broken) — fed deletions to readFile
.filter(line => line.length >= 4)
.map(line => line.slice(3))

// AFTER — skip any status where X or Y position is 'D'
.filter(line => line.length >= 4)
.filter(line => !line.slice(0, 2).includes('D'))
.map(line => line.slice(3))
```

Tests added for the full deletion status matrix: `' D'`, `'D '`, `'DD'`, `'AD'`, `'MD'`, `'RD'`, `'CD'`. RED-confirmed by landing tests on unchanged code and watching them fail before applying the filter.

### Fix B — recorded status must reflect every required step

`survey-repo.yaml` was computing:

```yaml
SURVEY_STATUS: ${{ steps.survey-agent.conclusion == 'success' && 'success' || 'failure' }}
```

This ignored the wiki commit step's outcome. Fix: give the commit step an `id`, then require both the agent AND the commit to have succeeded (or the commit to have been skipped because the agent made no changes — a valid no-op survey):

```yaml
- name: Commit wiki ingest to data branch
  id: wiki-commit
  # ...

- name: Record survey result
  env:
    SURVEY_STATUS: >-
      ${{ (steps.survey-agent.conclusion == 'success'
        && (steps.wiki-commit.conclusion == 'success'
          || steps.wiki-commit.conclusion == 'skipped'))
        && 'success' || 'failure' }}
```

A wiki-commit failure now records `last_survey_status: failure`, and the reconcile staleness gate re-dispatches the repo on the next cron instead of waiting 30 days.

## Why This Works

The two bugs interact: Fix A without Fix B still loses data silently on any future wiki-commit failure (network error, conflict exhaustion, rate limit). Fix B without Fix A still crashes every dispatch until drift is eliminated. Landing both together closes both holes.

The deletion filter is safe because the wiki commit path's contract is additive-only. Anything that has disappeared from the working tree since the last `data`-branch snapshot is by definition out of scope — the workflow would never intentionally commit a removal.

The compound expression works because GitHub Actions evaluates every `steps.<id>.conclusion` even when the step was skipped (`'skipped'`) or the job was cancelled (`'cancelled'`). Including `|| steps.wiki-commit.conclusion == 'skipped'` preserves the legitimate no-op case (agent ran, decided nothing needed wiki changes, commit step skipped via its own `if:` guard).

## Recovery

After the fix lands, entries already contaminated with `last_survey_status: success` from the misclassified cron still need to be cleared. `scripts/reset-survey-status.ts` + `.github/workflows/reset-survey-status.yaml` (PR #3145) reset any entry's survey fields back to `null`, forcing the reconcile staleness gate to treat the repo as never-surveyed. Authored by `fro-bot[bot]` via App installation token so the reconcile integrity check doesn't tamper-alert on the recovery commits.

## Prevention

1. **Validate pipeline contracts at the parse boundary.** If a script declares an "additive-only" or "no-op-safe" contract, the input parser must enforce that contract — not delegate it to downstream callers. `parsePorcelainPaths` now rejects deletions at the source rather than passing them to `readFile` and relying on `readFile` to notice.

2. **Status expressions must cover every required step, not just the intuitive one.** Any workflow that records an aggregate outcome (success/failure, last-run-status, etc.) must evaluate *every* required intermediate step's conclusion in the expression. A general pattern:

   ```yaml
   AGGREGATE_STATUS: >-
     ${{ (steps.step-a.conclusion == 'success'
       && (steps.step-b.conclusion == 'success' || steps.step-b.conclusion == 'skipped')
       && steps.step-c.conclusion == 'success')
       && 'success' || 'failure' }}
   ```

   If adding a new required step to the workflow, update the aggregate expression at the same time. If a step is conditionally skipped by design, `'skipped'` is an acceptable success — otherwise include it explicitly in the failure branch.

3. **Test the production shape, not just the happy path.** `parsePorcelainPaths` tests only exercised what a clean agent run produces. The production shape — porcelain after a `git restore` synced a divergent branch snapshot over the current checkout — included deletions that the test matrix never covered. Add coverage for every input variant that pre-script steps might produce, including drift, sync, and reset states.

4. **Eliminate drift sources when they cause silent failures.** The deeper cause of today's deletions was `main` and `data` diverging on wiki content. Legacy wiki PRs had landed directly on `main` before the `output-mode: working-dir` agent contract; `data`'s wiki/ was stale. Filtering deletions in the parser is defensive, but eliminating the drift (merging `main`'s wiki into `data`) prevents the deletions from appearing at all.

5. **Match credential identity to integrity check expectations.** When a workflow writes to a branch protected by an integrity check (like `reconcile-repos.ts`'s `fro-bot[bot]`-or-operator-login check), choose the credential that matches:
   - App installation token → commits authored by `fro-bot[bot]` (passes by default)
   - User PAT → commits authored by the user login (must be in `RECONCILE_OPERATOR_LOGINS`)

   The `record-survey-result` step uses `FRO_BOT_PAT` → `fro-bot` user commits; `RECONCILE_OPERATOR_LOGINS` must list `fro-bot` or every reconcile run tamper-alerts after the first survey write-back.

## References

- Fix PR: https://github.com/fro-bot/.github/pull/3144
- Recovery mechanism PR: https://github.com/fro-bot/.github/pull/3145
- Integrity-check prerequisite PR: https://github.com/fro-bot/.github/pull/3146
- First production failure: https://github.com/fro-bot/.github/actions/runs/24623241672
- Related: `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md` (prior "tests passed, production failed" trap)
- Related: `docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md` (prior "custom interface masked real API mismatch" trap)
