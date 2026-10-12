---
title: "Agent drafts, trusted job publishes: a three-job split for agent-written docs"
date: 2026-10-10
last_updated: 2026-10-10
verified: 2026-10-10
category: best-practices
module: .github/workflows/draft-solutions.yaml
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - an agent writes files that will be committed to a repository
  - agent output must pass a privacy or path gate before any public write
  - a bot opens PRs that a human merges, and a required check gates on them
  - an agent step needs a token but must not hold write capability
tags:
  - agent-output
  - trust-boundary
  - github-actions
  - least-privilege
  - fail-closed
  - lost-update
  - coverage-rows
  - drafted-solutions
---

# Agent drafts, trusted job publishes: a three-job split for agent-written docs

## Context

PR #3971 (merged 2026-10-09, merge commit `267cf77613a807e002465634cdaadb0cc381f793`) added a weekly pipeline in `.github/workflows/draft-solutions.yaml`. An agent drafts `docs/solutions/` entries from learning-proposal issues, and a human reviews and merges the resulting PR. Fro Bot found write-path defects in four review rounds before merge. The topology that survived those rounds is the reusable part.

The defects were never in what the agent wrote. Each was a fail-open gap between "validation passed" and "the write landed".

## Guidance

1. **Three jobs, one trust direction.**
   - `harvest` is read-only, mints no App token and runs no agent. It writes the digest and pins two commits: `draft_base_sha`, the commit the agent edits, and `main_sha` (`draft-solutions.yaml:20-25`).
   - `draft` runs the agent under a read-only `GITHUB_TOKEN` (`:101-104`, with the rationale at `:230-233`). The agent step still receives the model credentials (`:234-237`). The job cannot write to the repository, but it is not free of secrets.
   - `publish` runs trusted default-branch code and is the only job that mints a write token (`:366-396`). The write mint is scoped to this repository with contents, pull-requests and issues write. A separate review-only mint carries pull-requests write and nothing else, and the two mints have mutually exclusive conditions, so a run holds exactly one.

   The step that builds the handoff runs inside `draft`, so it is not a trust boundary. `publish` re-validates everything.

2. **Validate the artifact as data at the boundary.** Reject any mode other than `100644`, symlinks, backslash paths and traversal (`scripts/wiki-handoff-core.ts:436`, `:256`, `:526`). Build the handoff from staged git blobs rather than working-tree paths, so nothing on the runner can swap a file between check and copy (`:376-388`).

3. **Separate "absent" from "probe failed".** The metadata overlay uses the `case "$status"` form (`draft-solutions.yaml:315-329`). The contract is documented in [Agent credential preflights make checkout persistence a workflow contract](../workflow-issues/agent-credential-preflights-are-workflow-contracts-2026-10-09.md), which also lists every site that follows it. This document does not restate it.

4. **Make the review exception an exact predicate.** A job skipped by a job-level `if:` reports Success, and when that job's check is required, the skip satisfies it ([Quote required-status-check contexts that contain a colon](../workflow-issues/quoted-required-status-check-context-2026-06-09.md)). The required `Fro Bot` job skips bot-authored PRs on purpose: Fro Bot does not review them, Renovate PRs report skipped, and the maintainer approves them manually. That predates the drafted-docs pipeline. The pipeline needed one bot PR to be reviewed, so the exception is narrowed to an exact match instead of being widened (`.github/workflows/fro-bot.yaml:491-496`):

   ```text
   !endsWith(github.event.pull_request.user.login || '', '[bot]') ||
   (
     github.event.pull_request.user.login == 'fro-bot[bot]' &&
     github.event.pull_request.head.ref == 'docs/drafted-solutions' &&
     github.event.pull_request.head.repo.full_name == github.repository
   )
   ```

   The bot, the branch and the repository must all match. The same three-way match appears in the event-specific clause at `:513-517`.

5. **Never write what nobody verified.** Unverified proposals are rejected from the coverage table (`scripts/drafted-solutions-pr-body.ts:255-262`) and closed directly with a comment. They never appear in the PR body, because a `Closes #N` line there would close them as completed when the PR merges (`:340` renders those lines). `closeProposal` closes only a `covered` row as completed and everything else as `not_planned` (`scripts/drafted-solutions-publish.ts:575`).

6. **Guard against lost updates.**
   - Pin `draft_base_sha` at harvest.
   - At publish, compare each handoff path's blob at the live base against its blob at the draft base, and refuse on any difference (`checkDraftBaseUnmoved`, `:278-294`).
   - Update refs with `force: false` (`:519`). Create the branch with `createRef`, which fails if the ref exists (`:534`), after a last check for an open PR (`:530-531`).

7. **Fail closed on stale branches.** Never reuse a branch left behind by a PR that was closed without merging (`:601-603`):

   ```ts fragment
   if (openPr === null && files.length > 0 && (await readRefSha(octokit, owner, repo, DRAFTED_UPDATE_REF)) !== null) {
     throw new DraftedSolutionsError(STALE_BRANCH_MESSAGE)
   }
   ```

8. **Bound the rendered body before any write.** GitHub rejects an oversize PR body after the branch writes have landed, so the check comes first (`:631`; `PR_BODY_MAX_LENGTH = 65_536` at `scripts/drafted-solutions-pr-body.ts:63`):

   ```ts fragment
   if (body.length > PR_BODY_MAX_LENGTH) throw new DraftedSolutionsError(PR_BODY_TOO_LONG_MESSAGE)
   ```

9. **Key idempotency on the decision, not the issue.** A changed body or outcome is a new decision and gets its own comment (`:363-365`):

   ```ts fragment
   return `<!-- fro-bot:drafted-solutions-closure v2 issue=${row.issue} outcome=${row.outcome} body=${row.bodyHash} -->`
   ```

## Why This Matters

The four review rounds found these write-path defects, none of them in the agent's output:

- a probe error read as "branch absent";
- a same-file edit overwritten by a publish built on an older base;
- a destructive reset racing a PR that was opened or reopened mid-run;
- a PR body that grew past GitHub's limit after the branch writes had landed.

Each one looks correct at every point a reviewer would read, because the validation did pass. What was missing was a guarantee that the world had not changed between validation and write.

Two claims need care:

- "The agent job holds no write token" is true, but incomplete. It holds model credentials, so assume anything the agent can read, it can disclose.
- "Publish does not trust the digest" is only partly true. Harvest produces the digest with no agent involved, and publish re-verifies proposals by hash. Existing coverage rows are re-authorized by label and author, without a hash check.

## When to Apply

- Agent output is committed to a repository behind a privacy or path gate.
- A bot opens PRs that a human merges.
- A required check must stay meaningful for bot-authored PRs.
- An agent step needs a token but must not be able to write with it.

## Examples

**Field limits come from the exported constants.** The validator rejects the whole batch when a row exceeds a limit, so the prompt states each limit, and a test pins the prompt to the constants (`draft-solutions.yaml:208-217`, enforced by `scripts/draft-solutions-workflow.test.ts:468-474`). Changing a limit in code without changing the prompt fails the test instead of failing a weekly run.

**The review rounds on #3971.**

| Round | State | Findings | Where fixed |
| --- | --- | --- | --- |
| 1 | Changes requested | Probe failure treated as "absent"; same-file edits overwritten; destructive reset racing a PR open; superseded coverage rows; PR body over 65,536 characters; prompt called the drafting branch "main" | `draft-solutions.yaml:315-329`; `publish.ts:278-294`, `:519`, `:534`, `:601-603`, `:631`; pins at `draft-solutions.yaml:20-25` and `:143-146` |
| 2 | Changes requested | A PR reopened just before `updateRef`; four dropped claims rejected by the validator; review-request recovery | `publish.ts:530-531`; field limits in the prompt, `:208-217`; review-only mode, `publish.ts:684` and `draft-solutions.yaml:411-423` |
| 3 | Dismissed | The review-only token was over-scoped | `draft-solutions.yaml:384-396` mints pull-requests write only |
| 4 | Approved | None | n/a |

The round-2 reopen window is structurally fail-closed rather than proven closed: a PR that appears after the final check still cannot have its tree replaced, because the branch is never reused. That is argued from the code, not reproduced against a live race.

The skipped-job-satisfies-a-required-check behavior is taken from the repository's own documentation, not reproduced live.

## Related

- [Agent credential preflights make checkout persistence a workflow contract](../workflow-issues/agent-credential-preflights-are-workflow-contracts-2026-10-09.md): the probe contract this pipeline follows.
- [Agent and automation steps need their GitHub token wired explicitly](../workflow-issues/required-github-token-for-agent-steps-2026-06-22.md)
- [Quote required-status-check contexts that contain a colon](../workflow-issues/quoted-required-status-check-context-2026-06-09.md)
- [A Second Credential Gives Rotation Isolation, Not Permission Isolation — Scope at Mint Time](credential-mint-time-permission-scoping-2026-06-22.md)
- [Pin Every App Token Mint in a Repo-Wide Contract Test](repo-wide-app-token-scope-contract-2026-10-10.md)
- [Pure-Core Privacy Gates with a Shared Module and Mutation-Proof Tests](pure-core-privacy-gates-shared-module-2026-06-22.md)
- [When a platform gives no reliable correlation handle, invert poll to a worker-authored hash-bound receipt](worker-authored-hash-bound-receipts-2026-07-06.md)
- [Widen input tolerance in a repair layer that sits before a trust gate, never inside it](repair-before-a-trust-gate-not-inside-it-2026-07-06.md)
- [A one-bit confirmation gesture can't encode which of several candidate edges was approved](edge-keyed-confirmation-markers-2026-07-10.md)
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md)
