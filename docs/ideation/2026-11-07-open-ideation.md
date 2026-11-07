---
date: 2026-11-07
topic: open-ideation
mode: repo-grounded
---

# Ideation: Next control-plane improvements

## Codebase Context

The scripts now live in ten private `@fro-bot/*` packages. Duplicated workflow shell became the `sync-data` and `resolve-public-repo` composites, the `route-stderr` CLI and typed `--event` gateway announces. Agent runs get a `knowledge` MCP server with a per-job call-log summary.

What remains is mostly operator time and CI time:

- Every push to a PR starts a full Fro Bot review of 6 to 15 minutes. The `fro-bot.yaml` concurrency group is one per PR, shared with mentions, with `cancel-in-progress: false`.
- `check:mutation-guards` runs the whole `mutate` list (about 15 minutes) on any PR that hits its trigger set, and never runs on `main` (`main.yaml:233-239`).
- Data promotions, Renovate PRs and drafted-solutions PRs all wait for a manual approval.
- The daily report's Needs Human Attention list mixes evidence-backed items with inferences. In #4131, items 1 and 4 to 6 were already resolved or speculative.

Earlier ideation (`docs/ideation/2026-09-04-open-ideation.md`) recorded the rejected ideas that this pass avoided re-proposing.

## Ranked Ideas

### 1. Review the settled PR head

**Description:** Give `pull_request` reviews their own concurrency group with cancellation; mentions keep the current non-cancelling group. Skip pushes whose PR patch is unchanged, such as a base-only rebase. Pass the agent the SHA it last reviewed so that a re-review covers only the change since then. **Warrant:** `direct:` `fro-bot.yaml:20-21` triggers on `synchronize`, and `:88-101` shares one non-cancelling group per PR, so a run of pushes queues one full review per SHA. **Rationale:** Review wait is paid on every follow-up push, and most of those pushes are small fixes to an already-reviewed change. **Downsides:** A cancelled run leaves a cancelled check on an old SHA. A delta-only review can miss how new and old changes interact. **Confidence:** 80% **Complexity:** Low-Medium **Status:** Unexplored

### 2. Scope the PR mutation run to the change, with a full run on main

**Description:** Use the gate's import closure in reverse, so a PR runs Stryker only on the `mutate` targets its change can reach. Add a scheduled or push-to-`main` full run, which does not exist today. **Warrant:** `direct:` `packages/ci-checks/src/check-mutation-guards.ts:955` always runs the full configuration. `main.yaml:233-239` runs the job only on `pull_request`. **Rationale:** Mutation Guards is the slowest required check, and most PRs touch a small part of the `mutate` list. **Downsides:** A closure mistake under-tests a PR, and the full run catches it after merge, not before. The gate gains code. **Confidence:** 65% **Complexity:** Medium **Status:** Explored

### 3. Fro Bot merges its own owned-surface PRs, data promotions first

**Description:** A trusted job merges the weekly data promotion when the existing promotion privacy gates pass and every changed path is under `knowledge/` or `metadata/`. It uses an App bypass, and anything else falls back to review. A second step answers the `:assignAndReview(fro-bot)` request on Renovate PRs, which the job never serves, with a read-only brief: release notes, lockfile delta, advisories, CI and a verdict. **Warrant:** `direct:` `packages/registry/src/merge-data-pr.ts` labels promotions `automerge`, but nothing reads that label, and the last four promotions (#4088, #4063, #4048, #4046) were merged by hand. `default.json:9` requests Fro Bot's review, and the job's `if:` excludes bot-authored PRs. **Rationale:** It removes a weekly approval on a surface Fro Bot already owns, which fits the standing direction to give it more autonomy. **Downsides:** It changes `main` protection, so it is an Ask First change. Drafted-solutions PRs stay manual, as recorded. **Confidence:** 60% **Complexity:** Medium **Status:** Unexplored

### 4. Make the daily report's attention list actionable

**Description:** Change the Observe prompt so it tags every Needs Human Attention entry as observed (with a linked run, PR or error) or inferred. Inferred entries go into a collapsed Hypotheses section. Add a script-built "Awaiting your approval" table listing open PRs that are blocked only on the operator, with CI state, verdict, age and whether the approval is stale. Fix the `manage-issues.yaml:41` title regex, which still matches `Daily (Org Oversight|Autohealing) Report`. **Warrant:** `direct:` In #4131, items 1 and 4 to 6 were resolved or speculative. `fro-bot.yaml:251-262` sends all deferred work to Needs Human Attention. **Rationale:** Each speculative item costs the operator a manual check. **Downsides:** Prompt changes need contract tests, and the table is new report code. **Confidence:** 70% **Complexity:** Low-Medium **Status:** Unexplored

### 5. Delta-aware repeat surveys

**Description:** Fingerprint a survey's permitted inputs, applicable corrections and prompt version. When the fingerprint matches the last completed survey, record success without running the agent. Otherwise give the agent a bounded diff since the recorded source SHA. First surveys keep the full mode. **Warrant:** `direct:` `survey-repo.yaml:331-442` retries clean no-ops, `:487-497` fails on unchanged exhaustion, and `knowledge/schema.md:30-33` records source SHAs. **Rationale:** Repeat surveys stop spending agent time on unchanged repositories. **Downsides:** It changes the rule that a successful survey must change the wiki. The fingerprint must also cover the prompt and the corrections. **Confidence:** 60% **Complexity:** Medium-High **Status:** Unexplored

### 6. Give Remediate a wiki handoff

**Description:** Reuse Observe's chain of baseline, build and trusted ingest for Remediate, so that its learnings land on `data` instead of in Needs Human Attention. **Warrant:** `direct:` `fro-bot.yaml:972-983` says "there is no later step in this job that captures or commits a wiki edit". Observe's handoff is at `:1158-1195`, and the trusted ingest job is at `:1347-1410`. **Rationale:** The pass that does the fixing currently loses the most learnings. **Downsides:** It adds a second ingest to each run. Edits to the same page from Remediate and Observe depend on the existing staleness check. **Confidence:** 55% **Complexity:** Medium **Status:** Unexplored

### 7. Search recorded decisions

**Description:** Add a knowledge tool over the dispositions recorded in plans, brainstorms and ideation documents, so an agent can ask whether an idea was rejected and why. **Warrant:** `reasoned:` This ideation needed a separate learnings lane to avoid re-proposing rejected ideas, and `packages/wiki-ops/src/knowledge-mcp.ts` searches only solutions. **Rationale:** Recorded decisions would build on each other instead of being rediscovered. **Downsides:** Demand is unknown. Wait until the call-log summaries show that agents use the existing tools. **Confidence:** 45% **Complexity:** Low **Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
| --- | --- | --- |
| 1 | Run the daily report after the morning producers | The premise is false: the `0 0 * * *` cron starts at 05:24 to 05:56Z, after the settings, metadata and reconcile runs. |
| 2 | A read-time `resolved-when:` pass that strikes resolved items | It needs new per-item syntax and a writer. Idea 4 removes most stale items at the source. |
| 3 | Merge queue or `rebaseWhen: conflicted` against re-approval churn | Merge queues need an org-owned repository, and `fro-bot` is a user. Loosening `strict` weakens protection. |
| 4 | Parallel mutation shards, or an incremental mutation cache | Folded into idea 2. Shards spend more runner minutes without reducing the work, and a cache adds state. |
| 5 | One permanent report issue, or a report that updates only on transitions | The link and rollover churn outweighs the gain. Idea 4 addresses the actual pain. |
| 6 | Event-driven reactive categories | Red PRs already get reviews, and the daily pass catches the rest. Too expensive. |
| 7 | Run Observe before Remediate | The report summarizes what Remediate produced, so the current order is load-bearing. |
| 8 | Promote data on every commit, or chain the Sunday jobs on completion | Until idea 3 lands, this multiplies approval PRs. Revisit afterwards. |
| 9 | Task-shaped knowledge delivery, or a change-shaped lookup | Premature until the call-log summaries show tool usage. |
| 10 | The wiki as an operator query surface | The published Quartz site already covers it. |
| 11 | The fleet's nearest working example, or cross-survey synthesis | Overlaps the survey's related-page duties and `capture-patterns`. |
| 12 | Adaptation recipes, a workflow acceptance kit, or a scenario workbench | No current demand, and the workbench resembles the rejected flight recorder. |
| 13 | Replace goke with `node:util.parseArgs` | It reopens a settled decision. The runner is stable at a 100% mutation score across about 60 CLIs. |
| 14 | Generate the architecture diagrams | The package moves are finished, so diagrams now change rarely. |
| 15 | A branding renderer | The branding workflow runs rarely. |
| 16 | Stop the weekly cache purge | Below the ambition floor. It is a one-line cleanup if wanted. |
| 17 | Repair the wiki before opening lint issues | Recent lint runs found nothing repairable. |
| 18 | Automatically rerun known transient agent failures | They are rare (the plugin gate hit 1 in 81 runs), and the drain bug is fixed upstream. |
