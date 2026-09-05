---
date: 2026-09-04
topic: control-plane-workstreams
focus: open-ended workstream proposals for the fro-bot/.github control plane
mode: repo-grounded
---

# Ideation: Control-Plane Workstreams

## Grounding Context

### Codebase Context

GitHub-org control plane, not an application. Node 24 + pnpm 11, native TypeScript scripts with no build step, Vitest colocated in `scripts/*.test.ts` (~2850 tests). Layout: `.github/` (workflows, actions, hooks, settings), `scripts/`, `docs/` (plans, brainstorms, solutions corpus, `status.md`, north-star), `metadata/*.yaml` (written only to the `data` branch), `knowledge/` (LLM-authored wiki plus `corrections.yaml`), `persona/`, `packages/wiki-write-core` (shared gate package with committed `dist/` and a required drift check), `quartz-site/`.

Constraints every workstream must respect: the `data` branch is the sole autonomous write target and is authored only by Fro Bot identities (`DATA_BRANCH_TAMPER`); `data → main` promotes weekly or by `repository_dispatch`; privacy and private-leak gates fail closed; one invariant, one implementation; silent success is a bug; status vocabulary must distinguish clean from could-not-check; Fro Bot auto-reviews every PR as a required check; Renovate is self-hosted through a SHA-pinned reusable workflow.

North-star open threads: R2 push-notification actions (other repos), R3 editable wiki (Units 1–2b shipped in `fro-bot/dashboard`, Units 3–6 pending), F1 agent-to-agent and human work negotiation, F2 personal-assistant expansion, spine item `deploy-verification`.

### Past Learnings

`docs/solutions/` holds four recurring failure classes with three or more docs each and only _written_ enforcement: divergent gates and fail-open trust boundaries (6), local verification lying about CI topology (3), status vocabulary collapsing distinct states (3), sole-writer and single-source invariants (3). Load-bearing subsystems with zero or one doc: persona and prompt contracts, wiki publishing pipeline, metadata-branch operations, LLM-artifact schema drift and repair, review-event classification.

### Recent Operational Signal

A scaling guard flaked CI because it could never fail against the bug it named; a follow-up PR shipped a test that could not fail one merge later. Two plans describing one system drifted: the parent mandated a control the child dropped. Renovate broke org-wide (missing `tar`) and could not self-heal; recovery required a scripted 17-repository pin fan-out because Cross-Repo Dispatch excludes `bfra-me/*` and delegates edits to an agent. Renovate silently omitted a `fro-bot/agent` v0.107.1 proposal here. Improvement Metrics (#3674) had no cron and was read as current for 47 days. The daily report read check-runs but not legacy commit statuses. The cross-repo security backlog (#3652) is triaged but unactioned.

## Ranked Ideas

### 1. Counterexample-proven guards

- **Description:** Every load-bearing guard ships a paired mutation fixture reproducing the defect it names. A meta-test proves each guard turns red against its counterexample, executed under CI's checkout depth, credential shape, and artifact topology rather than only on a developer machine.
- **Warrant:** `direct:` #3810 removed two scaling guards whose own comments conceded they could not distinguish the vulnerable implementation from the fixed one; #3813 then shipped a rewrite test whose fixture never matched the rewrite regex. Discrimination proof was required by hand in eight separate implementation briefs across two weeks.
- **Rationale:** A guard that cannot fail is indistinguishable from no guard, and it costs CI time and trust while providing nothing. Making non-vacuity structural removes a manual rule that has already been forgotten repeatedly.
- **Downsides:** Deciding which guards are load-bearing is a judgment call; each fixture is per-guard authoring cost; topology-faithful execution needs a harness that does not exist yet.
- **Confidence:** 90%
- **Complexity:** Medium
- **Status:** Explored

### 2. Dependency operations plane

- **Description:** A scheduled Renovate canary with a known-expected proposal and an SLA, classifying engine failure, prerequisite failure, configuration suppression, no update, and could-not-check as distinct outcomes; plus a deterministic fleet-patch lane for mechanical cross-repository edits defined by exact path, expected value, replacement, verification command, dry-run receipt, and canary target, with no language model in the loop.
- **Warrant:** `direct:` The missing-`tar` build broke Renovate in 17 repositories with no self-heal path; Cross-Repo Dispatch (`scripts/cross-repo-dispatch.ts`) excludes `bfra-me/*` by owner allowlist and hands edits to an agent; Renovate silently omitted the `fro-bot/agent` v0.107.1 bump in this repository with no diagnostic.
- **Rationale:** Dependency automation is the substrate every other loop stands on, and it currently has no self-verification and no deterministic escape hatch when it breaks.
- **Downsides:** The fleet-patch lane is a new write-capable cross-organization primitive requiring its own allowlist and threat model; `bfra-me` inclusion is an owner-approval design question.
- **Confidence:** 85%
- **Complexity:** Medium-High
- **Status:** Unexplored

### 3. Freshness leases on autonomous claims

- **Description:** Every generated report, metric, rollout claim, and cached observation carries `observed_at`, `expires_at`, expected cadence, and source coverage. Status Truth and the daily report render expired leases as stale and partial coverage as could-not-check. The first consumer beyond reports is the open `deploy-verification` spine item.
- **Warrant:** `direct:` #3674 was read as current operational truth for 47 days; the daily report only consulted check-runs, missing legacy commit statuses on #3741; both were fixed piecemeal (#3776, #3771). Three learnings docs describe status-vocabulary collapse; none has a structural check.
- **Rationale:** Time becomes part of the status contract, so a stalled producer cannot leave its last conclusion looking current.
- **Downsides:** Many producers to retrofit; schema design invites bikeshedding.
- **Confidence:** 85%
- **Complexity:** Medium
- **Status:** Unexplored

### 4. Plan requirement graph

- **Description:** Parse parent and child plans, across repositories, into a graph of requirement IDs, inherited controls, owning repositories, and verification obligations. Status Truth flags a child plan that drops a parent control, a parent that mandates a control its child rejected, or two plans that contradict each other about one system.
- **Warrant:** `direct:` `docs/plans/2026-08-29-001-feat-editable-wiki-path-plan.md` mandated recent-auth step-up while the derived `fro-bot/dashboard` plan dropped it as unimplementable; both passed review, and the contradiction was caught only by a manual reread after the fact. Requirement IDs and Requirements Trace sections already exist in every plan.
- **Rationale:** Plans are the coordination contract between repositories; prose that drifts independently is the failure class this repository has paid for most often this quarter.
- **Downsides:** Cross-repository graph must span checkouts; risk of over-formalizing documents meant to remain readable.
- **Confidence:** 80%
- **Complexity:** Medium
- **Status:** Unexplored

### 5. Learnings-to-enforcement promotion

- **Description:** Accepted recurring-pattern proposals nominate an enforcement form: regression fixture, lint rule, workflow contract, schema constraint, or prompt/output test. Improvement Metrics measures recidivism before and after enforcement graduates. Idea 1 is the enforcement form this loop most often emits.
- **Warrant:** `direct:` The corpus has four failure classes with three or more docs each and only written enforcement; O8 measures recurrence but nothing ever graduates to a check.
- **Rationale:** Turns the solutions corpus from accumulated prose into a control-manufacturing loop.
- **Downsides:** Adds a step to a capture pipeline that has already stalled silently for 44 days once.
- **Confidence:** 75%
- **Complexity:** Medium
- **Status:** Unexplored

### 6. Versioned agent-artifact contracts

- **Description:** Persona rules, prompt blocks, marker grammars, output schemas, and cross-repo receipts become versioned contracts with privacy-safe fixtures. Candidate `fro-bot/agent` pins are replayed against the corpus and classified compatible, repairable drift, or contract breakage. `GATE_CONTRACT_VERSION` in `packages/wiki-write-core` is the existing seed.
- **Warrant:** `reasoned:` The learnings gap analysis shows persona, prompt, and output schemas at zero or one doc despite being load-bearing across every agent workflow; agent upgrades are currently validated only by workflow completion.
- **Rationale:** Agent behavior becomes an explicit protocol surface rather than prose distributed across workflows and instruction files.
- **Downsides:** Large surface; registry-for-its-own-sake risk; the fixture corpus must be privacy-safe by construction.
- **Confidence:** 65%
- **Complexity:** High
- **Status:** Unexplored

### 7. Negotiable work objects

- **Description:** Extend cross-repo dispatch receipts into durable work offers carrying desired outcome, evidence, required capability, authority, deadline, and accept, counter, decline, blocked, or indeterminate outcomes. The structural bridge from A3 dispatch to F1 negotiation.
- **Warrant:** `reasoned:` #3652's backlog is triaged and unactioned because dispatch is one-way command with a receipt; F1 is the next open north-star thread and has no substrate today.
- **Rationale:** Turns cross-repo backlogs into actionable queues while establishing the protocol F1 needs.
- **Downsides:** F1-scale; needs its own requirements before anything is buildable.
- **Confidence:** 55%
- **Complexity:** High
- **Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
| --- | --- | --- |
| 1 | Review evidence provenance envelope | Misattributed: the wrong reviewers were Systematic personas in `bfra-me/works`, not Fro Bot's workflow, which got it right. The fix belongs there. |
| 2 | Operator attention queue | Dashboard feature in another repository; the daily report's Needs Human Attention section already serves as the queue. |
| 3 | Data-branch flight recorder | Subsumed by freshness leases plus existing reconcile and merge-data signals. |
| 4 | Deployment attestation spine | Folded into freshness leases as its first consumer. |
| 5 | CI-topology verification harness | Folded into counterexample-proven guards as the execution dimension. |
| 6 | Fleet desired-state controller | Superset of the dependency operations plane at several times the cost. |
| 7 | Capability-based repository federation | Single-incident warrant; a brainstorm variant inside the dependency operations plane. |
| 8 | Content-addressed state replacing the `data` branch | Grounding wrong (lockfile conflicts were on feature branches); replaces a working security control. |
| 9 | Wiki as mission graph | Premature while R3 is unshipped; mechanics too vague. |
| 10 | Control-plane event ledger | Unbounded scope; freshness leases cover the concrete pain. |
| 11 | Corrections as surveyor eval corpus | Zero corrections exist yet; revisit after R3 Units 3–6 ship. |
