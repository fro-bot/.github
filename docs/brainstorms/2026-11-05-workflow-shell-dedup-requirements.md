---
date: 2026-11-05
topic: workflow-shell-dedup
---

# Workflow shell deduplication (scripts consolidation phase 2)

## Summary

Every block of workflow shell that is copied across workflows gets one definition. A single composite action owns the fail-closed `data`-branch sync. The three copied blocks that carry real logic (the survey privacy gate, the warning router around wiki ingest, and the gateway-announce event builder) move into the private package CLIs that already own that logic. Each workflow that held a copy calls the shared definition instead.

---

## Problem Frame

Phase 1 moved `scripts/` into `@fro-bot/*` packages and left workflow YAML untouched (see origin: `docs/brainstorms/2026-10-24-scripts-workspace-packages-requirements.md`). The YAML still carries hand-copied shell, and the copies have drifted:

- The `data` metadata overlay exists 17 times across 10 workflows and one composite action. It comes in six variants with three fetch forms, two ways of laying files down (one stages them in the index, one does not), two absent-branch behaviours and five different error strings. `reconcile-repos.yaml` carries a warning comment about the staging side effect, because a later step that expects a clean index breaks.
- The survey privacy gate runs the same `node(id)` GraphQL lookup twice in `survey-repo.yaml`, with different pass checks and error text, while the same query already lives in `packages/privacy`.
- The warning router around wiki ingest (redirect stderr, route prefixed lines to the step summary, map exit 3 to a page conflict) exists three times, two of them byte-identical. A fourth copy with a different prefix handles correction context.
- The gateway-announce event builder exists three times as a `jq -nc` step in front of the CLI. The CLI never fails the run, but the `jq` step can, so the "announce never fails the run" comments on two of the copies overstate the guarantee.

A fix to any of these lands in one copy and silently misses the others. The privacy gate and the overlay sit on fail-closed paths, where drift is a privacy or data-integrity risk, not just a tidiness one.

---

## Requirements

**Data-branch sync**

- R1. One composite action performs every sync of paths from the `data` branch into a workflow checkout, for both `metadata/` and `knowledge/`.
- R2. The action keeps the fail-closed probe: a present branch syncs, an absent branch follows the caller's declared absent-branch behaviour (skip or fail), and any other probe or fetch failure aborts the step.
- R3. The action lays files into the working tree only and leaves the index clean, for every caller.
- R4. All 17 current copies, including `.github/actions/sync-wiki`, are replaced by the shared action. No workflow keeps an inline `ls-remote origin data` overlay.
- R5. The action exposes the synced `data` commit to callers, as `sync-wiki` does today.

**Logic clusters to package CLIs**

- R6. Both survey privacy-gate steps call one private-package CLI that resolves a node ID to a public repository or refuses. The refusal stays neutral: no repository identity appears in logs or outputs on failure.
- R7. The four warning-router copies (three around wiki ingest, one around correction context) are replaced by one shared renderer. Each workflow keeps its current outputs, including survey's page-conflict output that the redispatch job reads.
- R8. The three gateway-announce event builders move into `packages/reports`. Building the event happens inside the CLI's never-fail guard, so a malformed input logs and exits 0 instead of failing the step.

**Contracts and tests**

- R9. Every workflow output, exit code and step-summary line that a downstream step, job or test reads stays the same, except the announce behaviour R8 changes.
- R10. Tests pin each shared definition's behaviour once, and pin each workflow's wiring to it. Tests that discover overlay or gate steps by their shell text keep finding every caller, so no caller silently drops out of coverage.
- R11. The App-token scope contract and the `env:`-only rule for passing expression values into shell hold for every moved step.

---

## Acceptance Examples

- AE1. **Covers R2.** Given the `data` branch is absent, when `reconcile-repos` syncs metadata, the step succeeds and reconcile bootstraps the branch. When `wiki-lint` syncs knowledge in the same state, the step fails.
- AE2. **Covers R2.** Given `git ls-remote` exits with a status other than 0 or 2, when any caller syncs, the step fails and no later step runs on unverified metadata.
- AE3. **Covers R3.** Given a workflow synced `metadata/` and later runs `git status` or builds a handoff from the working tree, the synced files show as unstaged changes, never as staged ones.
- AE4. **Covers R6.** Given a node ID for a private or unknown repository, when the survey gate runs, the step fails with a message that names neither owner nor repository.
- AE5. **Covers R7, R9.** Given wiki ingest exits 3, when the survey ingest step finishes, it sets the same conflict output it sets today and the redispatch job reruns the survey.
- AE6. **Covers R8.** Given `WIKI_PAGES_CHANGED` is not a number, when the survey announce step runs, the step logs the failure and exits 0. Today it fails.

---

## Success Criteria

- A change to overlay, privacy-gate, warning-router or announce behaviour is made in one place, and a test fails if any workflow stops using that place.
- The live runs that exercise each moved step (reconcile, a survey, status-truth, capture-learnings, cross-repo-dispatch, the daily Fro Bot run, wiki-lint, merge-data) pass after merge with unchanged outputs.
- A planner can sequence the work without deciding product behaviour: every behaviour change is named here (R3, R8) and everything else is parity.

---

## Scope Boundaries

- Step-summary writers (24 sites in 12 workflows) stay inline. Most are one per workflow and are not copies.
- Non-duplicated inline steps stay inline, even when they hold logic.
- Retiring the overlay, so metadata readers read `origin/data` directly instead of from a synced checkout, is a follow-up.
- MCP exposure of the package CLIs waits on fro-bot/agent#1931 (caller-provided MCP servers), still open.
- Unifying wiki-change detection is a separate change. `fro-bot.yaml` uses `git diff` plus a hash and `survey-repo.yaml` uses the `wiki-change-detect` CLI, and unifying them changes behaviour.
- Agent prep blocks (persona, query and baseline assembly) are not in this phase. They are near-copies, but their shape depends on the wiki-change split above.

---

## Key Decisions

- **Mechanism by fit, duplicates only.** Git plumbing goes into a composite action; logic goes into package CLIs. Forcing the overlay into a CLI would put a dependency install ahead of steps that are plain git, and TypeScript adds little to an exit-code switch. Two mechanisms is the accepted cost.
- **Restore to the working tree everywhere.** `sync-wiki`, survey and wiki-lint already do this. It removes the staged-index trap that `reconcile-repos.yaml` warns about, and no caller was found to rely on the staged state.
- **Extend the existing composite.** `.github/actions/sync-wiki` is already a fail-closed sync for `knowledge/` with bounded retry, so it is the base rather than a new action beside it.
- **Announce builder inside the never-fail guard.** This is a fix: the documented contract is that announcing never fails the run.
- **Correction-context renderer is folded in** as the fourth copy of the warning-router shape.
- **Prior work.** The phase 1 plan `docs/plans/2026-10-24-001-refactor-scripts-workspace-packages-plan.md` (status active, phase 1 units complete) records this work as deferred. `docs/solutions/workflow-issues/workflow-consolidation-invariant-trace-2026-06-24.md` (status active) is the checklist for tracing callers and invariants when consolidating workflow steps.

---

## Dependencies / Assumptions

- Every overlay caller checks out the repository before the overlay, so a local `uses: ./.github/actions/...` resolves. Verified for reconcile-repos, status-truth, capture-learnings, cross-repo-dispatch and improvement-metrics. The rest are unverified.
- Checkout credential persistence is a workflow contract that some fetches depend on (`docs/solutions/workflow-issues/agent-credential-preflights-are-workflow-contracts-2026-10-09.md`). The shared action must work under each caller's current checkout settings.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Where the shared warning router lives. The wiki-ingest CLI is in the published `@fro.bot/wiki-write-core`, so changing its surface triggers an npm release. A renderer in a private package that reads the captured stderr avoids that.
- [Affects R2][Technical] Whether the bounded retry in `sync-wiki` applies to every caller. Today only `sync-wiki` retries, and the 13 canonical copies do not.
- [Affects R6][Technical] Whether `packages/privacy/src/private-repo-resolution.ts` already covers the node-ID-to-public-repo check, or whether a new CLI is needed. The survey gate also validates node-ID shape and `nameWithOwner`.
- [Affects R2][Technical] Fetch form. Copies use `--no-tags`, no flag and `--depth=1`. Pick one.
- [Affects R10][Technical] How `scripts/data-branch-probe-workflows.test.ts` discovers callers once the shell lives in the action, for example by `uses:` reference instead of shell text.
- [Affects R1][Needs research] Ordering inside each job relative to `./.github/actions/setup`, for the callers not yet checked.
