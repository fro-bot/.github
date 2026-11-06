---
date: 2026-11-05
topic: workflow-shell-dedup
---

# Workflow shell deduplication (scripts consolidation phase 2)

## Summary

Every block of workflow shell that is copied across workflows gets one definition. Two composite actions hold the shell-only blocks: the fail-closed data sync and the survey privacy gate. The two blocks that wrap package CLIs, the warning router and the gateway-announce event builder, move into private package code. Each workflow that held a copy calls the shared definition instead.

---

## Problem Frame

Phase 1 moved `scripts/` into `@fro-bot/*` packages and left workflow YAML untouched (see origin: `docs/brainstorms/2026-10-24-scripts-workspace-packages-requirements.md`). The YAML still carries hand-copied shell, and the copies have drifted:

- **Data sync.** Copying paths from the `data` branch into a checkout happens in 17 copied `run:` blocks across 10 workflows (16 probed overlay steps plus wiki-repair's unprobed restore in `wiki-lint.yaml`), and in the `sync-wiki` composite action that 7 more steps call. They use three fetch forms, two ways of laying files down (one stages them in the index, one does not), two absent-branch behaviours and five error strings. Only `sync-wiki` retries. `reconcile-repos.yaml` warns that a future step expecting a clean index would break on the staged files.
- **Survey privacy gate.** `survey-repo.yaml` runs the `node(id)` visibility lookup twice, with different pass checks and error text. The `packages/privacy` resolver selects `nameWithOwner` only and makes no visibility decision, so these two workflow copies are the only visibility allowlist in the repo.
- **Warning router.** The shell that redirects a CLI's stderr, routes prefixed lines to the step summary and maps wiki ingest's exit 3 to a page conflict exists three times around wiki ingest, two of them byte-identical. A fourth copy handles correction context with a different prefix.
- **Gateway-announce event builder.** It exists three times as a `jq -nc` step in front of the CLI. The CLI never fails the run, but the `jq` step can, so the "announce never fails the run" comments on two copies overstate the guarantee.

A fix to any of these lands in one copy and silently misses the others. The data sync and the privacy gate sit on fail-closed paths, where drift is a privacy or data-integrity risk, not just a tidiness one.

---

## Requirements

**Data sync**

- R1. One composite action, built from `.github/actions/sync-wiki` and renamed `sync-data` because it now serves metadata too, performs every data sync. It takes the list of paths to sync, so one caller can sync `knowledge` and `metadata/repos.yaml` together.
- R2. The action probes the branch first. Probe exit 0 syncs. Exit 2 (branch absent) follows the caller's required absent-branch input, `skip` or `fail`, with no default. Any other probe or fetch failure aborts the step after the bounded retry.
- R3. The action fetches with `--no-tags` at full depth and restores into the working tree only, leaving the index clean. Restore is additive: files deleted on `data` are not removed from the checkout.
- R4. The 17 copied `run:` blocks call the action, and so do the 7 steps that already use `sync-wiki`: 24 call sites in all. Each caller keeps its current absent-branch behaviour. Wiki-repair gains the probe and declares `fail`.
- R5. The action exposes the synced `data` commit, as `sync-wiki` does today.

**Survey privacy gate**

- R6. A second composite action holds the visibility gate in shell, and both survey gate steps call it. It admits a node only when the lookup reports `isPrivate` false and a non-empty `nameWithOwner`. It validates the node ID's shape before any lookup.
- R7. Gate refusals print a fixed reason and the opaque node ID. Owner and repository name never appear in a log or output on a refusal path, so the raw `gh` stderr dump is dropped.

**Package code**

- R8. One shared warning router replaces the four copies. It is parameterised by prefix and output set, so the correction-context copy keeps its unfiltered summary append and no conflict output. Survey keeps the page-conflict output the redispatch job reads.
- R9. The warning router lives outside `packages/wiki-write-core` and does not change the published emitter. A test pins the `wiki-ingest:` prefixes against the emitter's output.
- R10. The three event builders move into the gateway-announce CLI in `packages/reports`, inside its never-fail guard. A builder error prints one fixed `gateway-announce:` line naming only the event type, emits a `::warning::` annotation, and exits 0.

**Contracts and tests**

- R11. Every workflow output, exit code and step-summary line that a downstream step, job or test reads stays the same. The named exceptions are: R2 retry for callers that had none, R3 index state and fetch depth, R4 wiki-repair's probe and wiki-lint's step output renamed from `data_sha` to `data-sha`, R6 recheck's `nameWithOwner` check and the resolve job's new `contents: read` checkout, R7's refusal log text, and R10.
- R12. Tests pin each shared definition's behaviour once, including the probe's exit 0, exit 2 and other-exit matrix run against the action's own shell. A test holds an explicit list of callers with their declared inputs, so removing or adding a caller fails until the list changes.
- R13. The App-token scope contract holds for every moved step. Expression values reach shell only through `env:`, inside the composite actions as well as in workflows.
- R14. The data sync takes no token input and inherits each caller's checkout settings, including the five callers that run with `persist-credentials: false`. The privacy gate takes the job's App token as an explicit input.

---

## Acceptance Examples

- AE1. **Covers R2, R4.** Given the `data` branch is absent, when reconcile syncs metadata, the step succeeds and reconcile bootstraps the branch. When wiki-lint or wiki-repair syncs, the step fails.
- AE2. **Covers R2.** Given `git ls-remote` exits with a status other than 0 or 2 on every attempt, when any caller syncs, the step fails and no later step runs on unverified files.
- AE3. **Covers R3.** Given a workflow synced `metadata/`, when a later step runs `git diff --cached`, it reports no synced paths.
- AE4. **Covers R6, R7.** Given a node ID for a private repository, when either survey gate step runs, the step fails and its output names neither owner nor repository.
- AE5. **Covers R8, R11.** Given wiki ingest exits 3, when the survey ingest step finishes, it sets the same conflict output it sets today and the redispatch job reruns the survey.
- AE6. **Covers R10.** Given `WIKI_PAGES_CHANGED` is not a number, when the survey announce step runs, it prints the fixed error line without the value, raises a warning annotation, and exits 0. Today the step fails.

---

## Success Criteria

- A change to data sync, privacy gate, warning router or announce behaviour is made in one place, and a test fails if any workflow stops using that place.
- After merge, the live runs that exercise moved steps pass with the outputs R11 promises: reconcile, a survey, status-truth, capture-learnings, capture-patterns, cross-repo-dispatch, improvement-metrics, poll-invitations, draft-solutions, the daily Fro Bot run, and wiki-lint with repair.
- A planner can sequence the work without deciding behaviour: every behaviour change is listed in R11, and everything else is parity.

---

## Scope Boundaries

- Step-summary writers stay inline. There are 24 sites in 12 workflows, ten of them with two or three, but each renders a different result shape and none is a copy of another.
- Non-duplicated inline steps stay inline, even when they hold logic.
- `merge-data.yaml`'s fetch of `data` is not a data sync. It needs full history with `--prune` for promotion and is excluded.
- The operator instructions printed by `packages/registry/src/reconcile-issues.ts` contain a visibility query as text. They are not executed and are not part of the privacy gate.
- Retiring the data sync, so metadata readers read `origin/data` directly, is a follow-up.
- MCP exposure of the package CLIs waits on fro-bot/agent#1931 (caller-provided MCP servers), still open.
- Unifying wiki-change detection is a separate change. `fro-bot.yaml` uses `git diff` plus a hash and `survey-repo.yaml` uses the `wiki-change-detect` CLI, and unifying them changes behaviour.
- Agent prep blocks (persona, query and baseline assembly) are not in this phase. Their shape depends on the wiki-change split above.

---

## Key Decisions

- **Mechanism by fit, duplicates only.** Shell-only blocks go into composite actions, and blocks that wrap a package CLI go into package code. A package CLI for the data sync or the privacy gate would put a dependency install ahead of steps that are plain `git`, `gh` and `jq`, and the survey resolve job has no checkout at all today. It gains a credential-free checkout of `.github/actions` only.
- **The privacy gate does not reuse the `packages/privacy` resolver.** That resolver serves the private-leak scan and returns names without a visibility decision, so reusing it would fail open.
- **Node IDs are treated as opaque.** The 2026-05-16 survey gate design accepts only an opaque `node_id` and logs it on refusal. This phase keeps that.
- **Working-tree restore everywhere.** `sync-wiki`, survey and wiki-lint already do this. No step was found that relies on staged metadata: the handoff builders stage and read their own pathspec. The search covered `.github/workflows` and `packages/*/src`.
- **Retry for every data sync caller.** Failure still aborts after the bounded attempts, so only timing changes.
- **Full-depth fetch.** `--depth=1` would make the sync-calling jobs with `fetch-depth: 0` (in survey-repo, fro-bot, draft-solutions and improvement-metrics) shallow.
- **Draft-solutions publish keeps `skip` on an absent branch.** Its privacy check is a denylist, so an absent branch leaves it reading `main`'s metadata. This is an accepted gap: `data` is persistent and a ruleset blocks its deletion.
- **Announce failures are redacted and annotated.** The runner prints `error.message` by default, which could echo the repo list the CLI redacts today. The annotation keeps a dropped event visible without failing the run.
- **Prior work.** The phase 1 plan `docs/plans/2026-10-24-001-refactor-scripts-workspace-packages-plan.md` (status active, phase 1 units complete) records this work as deferred. `docs/solutions/workflow-issues/workflow-consolidation-invariant-trace-2026-06-24.md` (status active) is the checklist for tracing callers and invariants when consolidating workflow steps.

---

## Dependencies / Assumptions

- Every data sync block runs after `actions/checkout` in its job, and none reads output from the setup action.
- Unauthenticated callers fetch `data` anonymously, which works because the repository is public.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Technical] Which private package owns the warning router, within the import rules `scripts/package-layout.test.ts` enforces, and whether it is a CLI that runs the wrapped command or a renderer reading captured stderr.
- [Affects R6][Technical] The sparse checkout shape for the survey resolve job, so it fetches only `.github/actions` with no credentials persisted.
- [Affects R12][Technical] How the caller-list test is organised, and how it replaces the `ls-remote` text discovery in `scripts/data-branch-probe-workflows.test.ts`.
- [Affects R10][Technical] Whether the gateway-announce CLI keeps `EVENT_CONTEXT_JSON` as an input alongside the typed builders, since its tests pin that interface today.
