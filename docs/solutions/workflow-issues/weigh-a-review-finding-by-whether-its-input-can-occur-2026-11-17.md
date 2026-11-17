---
title: Weigh a review finding by whether its input can occur and what a miss costs
date: 2026-11-17
category: workflow-issues
module: docs/plans
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - a review finding describes a sequence of states that the code's own writers do not produce
  - handling a rare case would add a code path to every reader of a stored value
  - a plan has more units than the request needs
tags:
  - scope-control
  - review-triage
  - unsupported-cases
  - plan-sizing
  - repo-lifecycle
  - registry
---

# Weigh a review finding by whether its input can occur and what a miss costs

## Context

Before deciding how to address a review finding, assess two things: whether its input can occur, given every writer of the data, and what a miss would cost. Rarity does not dismiss a privacy finding. Where an input should not exist, reject it where the data is written. Where a case is left unhandled, record it as unsupported and say why that is safe. Without this assessment, every sequence a reviewer can construct becomes work, and the change grows well past the request.

The request here was an operator action that marks a tracked repository archived and lists its wiki page under an Archived heading. The plan (`docs/plans/2026-11-15-003-feat-repo-lifecycle-archive-declared-rename-plan.md`, [#4264](https://github.com/fro-bot/.github/pull/4264)) split the work into twelve units in two phases. Five pull requests built the first six units. The second phase, a declared rename, was not built.

Some of those requests found real defects. Others asked for handling of states that nothing writes.

## Guidance

1. **Ask whether the input can occur, and count every writer before you answer.** The registry here is `metadata/repos.yaml`, one row per tracked repository. Its writers are reconcile (the scheduled job that syncs the rows with GitHub), invitation handling, the survey write-back and the operator's rename and lifecycle actions. A state can be ruled out only when none of them produces it.
2. **Price the miss before you price the fix.** A private name on a public surface costs the most. A refused legitimate action comes next. A wrong count or an unused path costs least.
3. **Rarity does not dismiss a privacy finding.** When the miss is a leak, handle it or show that the input cannot occur.
4. **Prefer a refusal where the data is written to a special case in every reader.** One refusal covers every reader.
5. **Record what you do not handle where the next reader looks.** State it as unsupported in the plan or the README, with the reason.
6. **When successive designs for a rare case each introduce a failure, reassess whether to handle the case at all.** Consider keeping the existing behaviour and rejecting the input at the writer.

## Why This Matters

The cost of handling an input that does not occur is visible in the record. The squash merge of #4278 added 2,273 lines, 2,086 of them in one test file, and the plan records two designs for duplicate rows that each produced a new failure. The defects that mattered were found by the same reviews and were small: a private entry skipped before its evidence was read, a cached answer that could outlive a visibility change, and a notice that changed a page's spacing.

## When to Apply

- A finding needs two or more trusted writers to misbehave in order.
- A fix would add a branch to every reader of a stored field.
- A design for an edge case needs its own exceptions.

## Examples

**Handled: the input occurs and a miss is costly.**

- A collaborator entry with a null owner was skipped before its `private` flag was read ([#4278](https://github.com/fro-bot/.github/pull/4278) review; fixed in `7eaf3b0`).
- A published adapter cached an archived repository's public answer per registry commit ([#4273](https://github.com/fro-bot/.github/pull/4273) review; fixed in `162bc04`).
- The archive notice changed the spacing of ordinary pages, so the action refused them ([#4281](https://github.com/fro-bot/.github/pull/4281) reviews; see [the inverse rule](../best-practices/an-insert-and-its-removal-must-be-exact-inverses-when-a-check-compares-the-result-2026-11-17.md)).

**Refused at the writer: duplicate rows of an archived repository.** Reconcile already merges rows that describe the same repository. The plan records that special handling for duplicates of an archived row "produced a new failure in each of two designs" (`docs/plans/2026-11-15-003-feat-repo-lifecycle-archive-declared-rename-plan.md:98`). What shipped is that existing merge with one rule: when a group is merged, its first archived row survives exactly as stored (`packages/registry/src/reconcile-plan.ts:1055`). The `archive` action refuses a target when another row shares its node ID or database ID (`packages/registry/src/rename-tracked-repo.ts:1035`).

**Recorded as unsupported.**

- An archived row with no node ID gets no special handling beyond the early exit; the action always stores the IDs (same plan line).
- A repository that turns private while reconcile cannot see it keeps its name in the registry, and the scans treat it as private (the plan's risk table, `:599`).

## Related

- [Fix a fail-safe flag's false positive in the consumer](../best-practices/fix-a-fail-safe-flags-false-positive-in-the-consumer-2026-11-15.md): count the code paths before adding a stored value.
- [Observability before structural change](../best-practices/observability-before-structural-change-2026-06-09.md): measure a problem before building for it.
- [Requirements doc survives verification](../best-practices/requirements-doc-survives-verification-2026-06-24.md): check a requirement against the code before it becomes a unit.
- [#4264](https://github.com/fro-bot/.github/pull/4264), [#4265](https://github.com/fro-bot/.github/pull/4265), [#4270](https://github.com/fro-bot/.github/pull/4270), [#4273](https://github.com/fro-bot/.github/pull/4273), [#4278](https://github.com/fro-bot/.github/pull/4278), [#4281](https://github.com/fro-bot/.github/pull/4281).
