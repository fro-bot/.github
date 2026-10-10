---
title: 'fix: Least-privilege App tokens and data-only guarded paths'
type: fix
status: active
date: 2026-10-09
---

# fix: Least-privilege App tokens and data-only guarded paths

## Overview

Every GitHub App installation token minted in this repo's workflows gets explicit `permission-*` inputs and an explicit repository reach. A repo-wide contract test pins every mint's scope, so a new unscoped mint can't merge. Separately, `scripts/check-wiki-authority.ts` now requires a Fro Bot identity to use head `data` for every guarded path, not only `metadata/repos.yaml`.

## Problem Frame

The 2026-10-08 daily report (#3958, carried into #3966 item 4) flagged two integrity gaps.

**Unscoped App tokens.** `actions/create-github-app-token` with no `permission-*` input mints a token that carries every permission of the App installation. Workflow `permissions:` blocks don't constrain it; they only constrain `GITHUB_TOKEN`. When `owner` is set and `repositories` is empty, the token also reaches every repo the installation covers under that owner.

Eight mint steps pass no permissions:
- `dispatch-renovate`
- `manage-cache`
- `manage-issues` (×2)
- `merge-data`
- `reconcile-repos`
- `reset-survey-status`
- `update-metadata`

Three of these are owner-wide: `dispatch-renovate`, `reconcile-repos` and `update-metadata`. Separately, `wiki-lint`'s issue-sync mint has permissions but no repository reach.

**Authority gap.** `checkWikiAuthority` lets any PR authored by `fro-bot` or `fro-bot[bot]` touch any guarded path from any head branch, except `metadata/repos.yaml`. All current guarded-path writers target `data`. The rule therefore admits a path that no current writer needs.

## Requirements Trace

- R1. Every App-token mint has at least one explicit `permission-*` input, and neither `permission-workflows` nor `permission-administration`.
- R2. Every mint sets an explicit `repositories:`. That is either this repository, or a computed list of repositories whose mint and consuming step are both guarded on the list being non-empty. The only mints without `repositories:` are owner-wide entries on an exemption table, each with a recorded justification.
- R3. Owner-wide mints carry read-only permissions. The single exception is the cross-repo dispatch target token, which needs `actions: write`.
- R4. Discovery across the installation and writes to this repo use separate tokens. The owner-wide token never holds write permissions, and it reads repository contents only at fixed probe paths.
- R5. A repo-wide test fails on any mint that is missing from, or differs from, the expected-scope table. It also fails on an owner-scoped mint whose `repositories:` could resolve empty.
- R6. A Fro Bot-authored PR touching any guarded path must have head ref `data`.
- R7. Each changed workflow is dispatched once after merge, with operator approval per dispatch, and runs successfully. `reset-survey-status` runs against a real target the operator picks, one whose survey is stale or due anyway.

## Scope Boundaries

- `GITHUB_TOKEN` `permissions:` blocks are unchanged.
- The cross-repo dispatch target tokens stay owner-wide, with actions permissions only (operator decision). They become documented entries on the exemption table, which records their existing controls:
  - the `dispatch` job runs only when the `dispatch-approved` label is added and the sender is `marcusrbrown` (`.github/workflows/cross-repo-dispatch.yaml`);
  - the token is minted after that gate;
  - the script checks the sender again;
  - targets are checked against the `metadata/repos.yaml` registry for the fixed owners `fro-bot` and `marcusrbrown`;
  - the `track` job's tokens are `actions: read`.

  The exemption has to be re-evaluated if target selection stops being operator-approved and registry-gated, or the owner set grows.
- The survey gate and recheck tokens stay owner-wide with `metadata: read`. Their node-ID visibility lookups target arbitrary repos.
- `dispatch-renovate` keeps reading `metadata/renovate.yaml` from `main`. Freshness from `data` is out of scope.
- No change to the `data` ruleset, `FRO_BOT_PAT`/`FRO_BOT_POLL_PAT` usage, or agent jobs.

## Context & Research

### Relevant Code and Patterns

- Mint census: 31 `create-github-app-token` steps, all in `.github/workflows/`. None are in `.github/actions/`. The pinned action is v3.2.0, which supports `owner`, `repositories`, `permission-actions` and `permission-workflows`.
- Scoped exemplars:
  - `.github/workflows/draft-solutions.yaml`: mutually exclusive publish and review mints.
  - `.github/workflows/status-truth.yaml`: separate write and fetch mints.
  - `.github/workflows/survey-repo.yaml`: an owner-wide `metadata: read` gate mint, plus a repo-scoped `data` writer.
- Repo-wide workflow guards to mirror:
  - `scripts/agent-post-step-credential-guard.test.ts`
  - `scripts/data-write-token-guard.test.ts`, which uses YAML parsing and asserts the scan isn't empty.
  - The exact-scope assertion style in `scripts/draft-solutions-workflow.test.ts`.
- `scripts/reconcile-repos.ts` already injects `userOctokit` and `appOctokit` into `handleReconcile`. The split turns `appOctokit` into a discovery client and a writer client.
- `scripts/update-metadata.ts` handles discovery (`apps.listReposAccessibleToInstallation`, then `repos.getContent` on each repo's `.github/workflows/renovate.yaml`) and `commitMetadata` to `data`.
- `scripts/dispatch-renovate.ts` reads `metadata/renovate.yaml` with `fro-bot` as the default owner, then calls `actions.listWorkflowRuns` and `actions.createWorkflowDispatch`.
- `scripts/merge-data-pr.ts` calls compare, `pulls.create/get/list/updateBranch`, `repos.listPullRequestsAssociatedWithCommit`, issues list/create, and `addLabels`.
- `scripts/check-wiki-authority.ts`:
  - `frobotAuthors()` and `guardedPatterns()` are functions, so their mutants stay killable.
  - It is in the `stryker.config.json` mutate list.
  - `Check Wiki Authority` is a required check (`.github/settings.yml`).

### Permission facts (GitHub Docs and action READMEs)

| Call | Required App permission |
|---|---|
| `pulls.updateBranch` | Pull requests write **and** Contents write on the head repo |
| `pulls.create` | Pull requests write |
| `pulls.list`, `pulls.get` | Pull requests read |
| compare, `listPullRequestsAssociatedWithCommit` | Contents read |
| Actions cache list / delete | Actions read / write |
| `createWorkflowDispatch` / `listWorkflowRuns` | Actions write / read |
| `addLabels`, including on a PR | Issues write |
| `GET /installation/repositories` | No permission, but returns only repos the token can access, so discovery needs an owner-wide token |
| `actions/stale` | actions, issues and pull-requests write (contents write only for `delete-branch`) |

`create-github-app-token`'s repository reach:
- `owner` set and `repositories` empty: owner-wide token.
- Both omitted: current repository.

### Institutional Learnings

- `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md`: with no permissions input, the token is the broadest one. Scope from the consumer's actual calls.
- `docs/solutions/integration-issues/merge-data-pr-github-422-race-recovery-2026-05-02.md`: the promotion's recovery path uses `updateBranch`. A missing scope shows up as a runtime 403 on that path, not at startup.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` and `bootstrap-data-branch-before-autonomous-writes-2026-05-09.md`: `data` writes must keep the `fro-bot[bot]` identity. The ruleset bypass is actor-based (integration 218644, `.github/settings.yml`), so a narrower token from the same App still bypasses.
- `docs/solutions/best-practices/a-policy-scanner-must-parse-tokens-not-prose-2026-09-08.md`: parse the YAML, cross-check against the full mint set, and fail closed on mints the scan didn't examine.
- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`: keep guarded sets in function form.
- `exact-match-trust-gates-need-type-discipline-2026-09-08.md`: check the value is a string, then compare exactly. Test a one-element-array decoy.
- `enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md`: no shortcut directives.
- `docs/solutions/best-practices/per-owner-installation-tokens-2026-07-06.md`: tokens don't cross installation boundaries.

### Writer audit for the authority guard

Every current guarded-path writer targets `data`:
- `wiki-repair.ts`
- `commit-metadata.ts`
- the wiki-ingest handoff in `fro-bot.yaml`
- the `merge-data-pr.ts` promotion

The remediation prompts forbid touching guarded paths. Merged history does include older non-`data` Fro Bot PRs:
- the wiki-ingest series #3100–#3120 (`fro-bot` user);
- #3315, #3394 and #3421, which touched `metadata/*.yaml` from fix branches.

They predate the current writers. Manual edits go through `data`, as the guard's block message already says.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": ".github/workflows/*.yaml, .github/actions/**, scripts/*.test.ts",
  "freshness": {
    "vcs_reference": "0ec42a907fc1ca3f5c200bd3ac68376065e2feb7"
  },
  "budget": {
    "max_search_passes": 3,
    "max_candidate_inspections": 10,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "scripts/data-write-token-guard.test.ts",
      "description": "Repo-wide workflow scan inventorying data-branch writer steps and their token source.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/agent-post-step-credential-guard.test.ts",
      "description": "Repo-wide workflow scan forbidding App-token mints in agent jobs.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/draft-solutions-workflow.test.ts",
      "description": "Exact permission-* and repositories assertions for one workflow's mints.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/status-truth-prs.test.ts",
      "description": "Workflow contract tests pinning separate write and read-only mints.",
      "disposition": "reuse"
    }
  ]
}
```

## Key Technical Decisions

- **One repo-wide mint contract test, keyed by `(workflow, job, step id)`.**
  - Every mint must have a step `id`.
  - The expected-scope table lists each mint's exact `permission-*` map and one of three kinds of reach:
    - `repo`: `repositories: ${{ github.event.repository.name }}`.
    - `computed list`: a fixed `owner`, the exact `repositories:` expression, and the exact non-empty `if:` guard that the mint and its consuming step must both carry.
    - `owner-wide`: `owner` with no `repositories`. Exemption rows only, each with a justification.
  - Exempt rows are pinned to their exact `(workflow, job, step id)` and owner, so a write permission on an owner-wide mint anywhere else fails.
  - Rationale: per-workflow tests already exist but can't see a new mint added to an unrelated workflow.
- **Explicit `repositories: ${{ github.event.repository.name }}` on every repo-scoped mint,** even where omitting both inputs would already default to this repo. That makes the reach visible in review and keeps the test's rule uniform.
- **Split discovery from writes in `update-metadata` and `reconcile-repos`.**
  - The owner-wide discovery mint gets `metadata: read` and `contents: read`.
  - The repo-scoped writer mint gets only the write permissions its calls need.
  - Each script takes two clients, and a routing table names the client for every call.
  - A write permission on an owner-wide token would let it write to every repo the App is installed on.
  - Calls on `FRO_BOT_POLL_PAT` stay on it. Only calls that use the App token today are split: reads to discovery, writes to the writer.
  - The discovery client calls `repos.getContent` only at fixed probe paths, such as `.github/workflows/renovate.yaml` and reconcile's existing probe paths. It never logs or persists response bodies; logs carry owner, repo and status only.
- **`dispatch-renovate` mints only for the repos it will dispatch to.**
  1. An owner-wide `metadata: read` discovery mint lists the installation's repos.
  2. A planning step intersects that list with `metadata/renovate.yaml`, then trims, dedupes and drops empties.
  3. The `actions: write` mint receives the result as `repositories:`.
  4. If the list is empty, the run skips both the mint and the dispatch.
  - Stale names never reach the mint, which would otherwise reject the whole list. Because the empty-list check runs on the cleaned list, the mint can never fall back to owner-wide reach.
- **merge-data gets `contents: write`, `pull-requests: write` and `issues: write`.** `updateBranch` needs Contents write, and the conflict journal and labels need Issues write.
- **`actions/stale` gets `actions: write`, `issues: write` and `pull-requests: write`.** No contents write, because `delete-branch` isn't used. Confirm during implementation.
- **Authority guard: Fro Bot identity plus any guarded path requires `headRef === 'data'`,** checked only after confirming `headRef` is a string. Non-Fro-Bot authors are still blocked from guarded paths outright. The block message keeps its contract: it names `data`, `fro-bot` and `fro-bot[bot]`.

## Open Questions

### Resolved During Planning

- **Does a narrower token break the `data` ruleset bypass?** No. The bypass is keyed on the integration actor (218644), not on token scope.
- **Can discovery use a repo-scoped token?** No. `GET /installation/repositories` returns only the repos the token can access.
- **Should the cross-repo dispatch tokens be narrowed?** No (operator decision). They become exemption entries, with their existing controls recorded (see Scope Boundaries).
- **Does `wiki-lint`'s issue sync need `contents: read`?** No. `scripts/wiki-lint-issues.ts` makes no repository-contents calls, so its mint drops to `issues: write`.

### Deferred to Implementation

- **Exact call-site list per client in `reconcile-repos.ts`.** The routing rule is fixed. The implementer lists every current `appOctokit` call site and its new client, including `bootstrapDataBranch` and the issue lifecycle helpers. Each `userOctokit` call is confirmed unchanged.


## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

| Workflow | Mint | Reach | Permissions |
|---|---|---|---|
| dispatch-renovate | discovery (new) | owner `fro-bot` (exempt) | metadata read |
| dispatch-renovate | dispatch | computed list (`fro-bot` + planning output, guarded non-empty) | actions write |
| manage-cache | cleanup | this repo | actions write |
| manage-issues | close reports | this repo | issues write |
| manage-issues | stale | this repo | actions, issues, pull-requests write |
| merge-data | promotion | this repo | contents, pull-requests, issues write |
| reset-survey-status | writer | this repo | contents write |
| update-metadata | discovery (split) | owner (exempt) | metadata, contents read |
| update-metadata | writer (split) | this repo | contents write |
| reconcile-repos | discovery (split) | owner (exempt) | metadata, contents read |
| reconcile-repos | writer (split) | this repo | contents, issues, actions write |
| wiki-lint | issue sync | this repo (add `repositories`) | issues write (drop contents read) |
| cross-repo-dispatch | target ×4 | per owner (exempt) | actions write/read, unchanged |
| survey-repo | gate, recheck | owner (exempt) | metadata read, unchanged |

Reconcile routing rule. Every call keeps the client it uses today; only today's App-token calls are split.

| Call (today's client) | Client after the split |
|---|---|
| Collaborator access list, collab status, field, identity and rename probes, star sync (`userOctokit`) | `userOctokit` (unchanged) |
| Installation enumeration (App) | discovery |
| Owned and contrib probes at fixed paths (App) | discovery |
| Any other App-token read of a repo other than this one | discovery |
| `commitMetadata` and `bootstrapDataBranch` on `data` (App) | writer |
| Issues, labels and integrity alerts in this repo (App) | writer |
| `createWorkflowDispatch` of `survey-repo.yaml` (App) | writer |

A misrouted probe returns 403 or 404 and wrongly marks a tracked repo as `lost-access`. There are two ways to misroute: sending an App read to the repo-scoped writer, or moving a collaborator probe from the user PAT onto an App token that can't see that repo. Routing is a correctness requirement, not only a privilege one.

## Implementation Units

- [x] **Unit 1: Repo-wide App-token mint contract test**

**Goal:** Pin every mint's scope and reach. Fail closed on drift, omission, or owner-wide mints that are not on the exemption list.

**Requirements:** R1, R2, R3, R5

**Dependencies:** None. Written first. It fails against the current tree until Units 2–5 land.

**Files:**
- Create: `scripts/app-token-scope-guard.test.ts`

**Approach:**
- Parse every `.github/workflows/*.y*ml`. Collect every step whose `uses` starts with `actions/create-github-app-token@`.
- Key each mint by `(file, job, step id)`.
- Compare it to an expected table holding the exact permission map and the reach kind (`repo`, `computed list` or `owner-wide`). Owner-wide rows also carry a justification.
- For `computed list` rows, assert the exact `repositories:` expression, and assert the non-empty `if:` guard on both the mint and its consuming step.
- Assert the scan is not empty: at least the expected row count, across at least the expected number of files.

**Patterns to follow:** `scripts/data-write-token-guard.test.ts`, and `scopesOf()` in `scripts/draft-solutions-workflow.test.ts`.

**Test scenarios:**

Happy path:
- Every mint in the tree matches its table row exactly.

Error path (each rule proven against an in-memory workflow fixture):
- A mint with no `permission-*` → fails.
- `permission-workflows` or `permission-administration` → fails.
- A mint missing from the table → fails, naming its key.
- A table row whose mint is missing from the tree → fails.
- A mint without a step `id` → fails.

Edge cases:
- `owner:` set with no `repositories:` and not on the exemption list → fails.
- `owner:` set with an empty or whitespace `repositories:` literal → fails.
- An owner-wide mint carrying a write permission → fails, unless it is one of the pinned cross-repo dispatch target rows: that exact `(workflow, job, step id)` and owner.
- A `computed list` mint whose consuming step lacks the non-empty guard → fails.
- A comment mentioning a permission doesn't count, because the test reads parsed `with` keys.

**Verification:** The test enumerates every mint and pins it to the target table. It goes green only after Units 2–5.

- [x] **Unit 2: Scope the config-only mints**

**Goal:** Explicit permissions and repository reach for the mints whose consumers need no script change.

**Requirements:** R1, R2

**Dependencies:** Unit 1

**Files:**
- Modify:
  - `.github/workflows/manage-cache.yaml`
  - `.github/workflows/manage-issues.yaml`
  - `.github/workflows/merge-data.yaml`
  - `.github/workflows/reset-survey-status.yaml`
  - `.github/workflows/wiki-lint.yaml`
- Test: `scripts/app-token-scope-guard.test.ts` (rows), plus any existing workflow test for these files that pins mint inputs.

**Approach:**
- Apply the scopes from the design table.
- Give every mint a step `id`.
- Comments state which calls each permission covers. One line per mint, no history.

**Test scenarios:**
- Happy path: each mint matches its row.
- Integration: `merge-data`'s row includes contents write, so a regression that drops it fails Unit 1 on the `updateBranch` requirement.

**Verification:** Unit 1 rows for these files pass, and `actionlint` is clean.

- [x] **Unit 3: dispatch-renovate planned reach**

**Goal:** The dispatch token reaches only the Renovate targets the installation still covers.

**Requirements:** R1, R2, R3, R5

**Dependencies:** Unit 1

**Files:**
- Modify:
  - `.github/workflows/dispatch-renovate.yaml`
  - `scripts/dispatch-renovate.ts`
- Test:
  - `scripts/dispatch-renovate.test.ts`
  - `scripts/app-token-scope-guard.test.ts`

**Approach:**
- A planning mode in `dispatch-renovate.ts` takes the discovery client and the parsed `metadata/renovate.yaml`, and returns the cleaned intersection.
- The workflow writes that list to `GITHUB_OUTPUT`.
- The dispatch mint and the dispatch step both carry `if:` on a non-empty list.
- The dispatch step uses only the dispatch token.

**Test scenarios:**

Happy path:
- Two listed repos, both installed → list of two; the dispatch mint is scoped to them.

Edge cases:
- A listed repo the installation no longer covers → dropped.
- Whitespace, duplicate and empty entries → cleaned.
- Every entry stale, or the file has no `with-renovate` list → empty output; the mint and dispatch are skipped.

Error path:
- The discovery call fails → the step fails. It never falls back to an unscoped list.

Integration (workflow contract):
- The dispatch mint has `owner: fro-bot` and `repositories` taken from the planning output.
- Both the mint and the dispatch step are guarded on a non-empty list.

**Verification:** The planning tests and Unit 1 rows pass. An empty list provably produces no mint.

- [x] **Unit 4: update-metadata discovery and writer split**

**Goal:** Owner-wide reads use a read-only token. The `data` write uses a repo-scoped `contents: write` token.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify:
  - `.github/workflows/update-metadata.yaml`
  - `scripts/update-metadata.ts`
- Test:
  - `scripts/update-metadata.test.ts`
  - `scripts/app-token-scope-guard.test.ts`

**Approach:**
- Two env tokens, two Octokit clients.
- Discovery and the per-repo `getContent` probes use the discovery client.
- `commitMetadata` uses the writer.
- Commit the workflow and script changes together, so a partial revert can't mismatch tokens and clients.

**Execution note:** Prove routing with adversarial mocks before changing call sites.

**Test scenarios:**
- Integration:
  - The discovery mock throws on every mutating method, and on any `getContent` outside `.github/workflows/renovate.yaml`.
  - The writer mock throws on `listReposAccessibleToInstallation` and on reads of other repos.
  - A full run succeeds under both mocks.
  - No log line contains a response body.
- Happy path: the renovate list is committed through the writer with the same content as before.
- Error path: a missing writer token fails before any discovery call.

**Verification:** Tests pass under both adversarial mocks, and the Unit 1 rows pass.

- [x] **Unit 5: reconcile-repos discovery and writer split**

**Goal:** Same split as Unit 4, for reconcile, following the routing rule above.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1, Unit 4 (same pattern)

**Files:**
- Modify:
  - `.github/workflows/reconcile-repos.yaml`
  - `scripts/reconcile-repos.ts`
- Test:
  - `scripts/reconcile-repos.test.ts`
  - `scripts/app-token-scope-guard.test.ts`

**Approach:**
- Replace `appOctokit` with discovery and writer clients through the existing injection seam. `userOctokit` and every call on it are unchanged.
- Route each current `appOctokit` call site as the routing table says, including `bootstrapDataBranch` and the issue lifecycle helpers.
- Discovery's `getContent` calls stay at reconcile's existing fixed probe paths.
- Workflow and script land in one commit.

**Execution note:** Write the adversarial two-mock tests first.

**Test scenarios:**

Integration:
- Discovery mock that throws on writes and on non-probe-path `getContent`, plus writer mock that throws on discovery and other-repo reads: a full reconcile across owned, contrib and collaborator repos completes.
- No log line contains a response body.

Error path:
- A collaborator repo the App can't see: its status and field probes still go through `userOctokit`, and the repo is not marked `lost-access`.
- An App-side read of another repo goes to discovery, never to the writer.

Happy path:
- Metadata commit, issue creation and labels, and survey dispatch all go through the writer.
- Commit authorship is unchanged.

**Verification:** The existing reconcile suite passes unchanged in behavior, and the routing tests pass under both adversarial mocks.

- [x] **Unit 6: Guarded paths require data for Fro Bot**

**Goal:** Close the authority gap.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `scripts/check-wiki-authority.ts`
- Test: `scripts/check-wiki-authority.test.ts`

**Approach:**
- For a Fro Bot author, collect the guarded files using `guardedPatterns()`. If any match and `headRef` is not the string `data`, block those files.
- Widen `GuardInput.headRef` to `unknown` at the pure-function boundary, so tests can pass non-string values without casts.
- Keep `frobotAuthors()` and `guardedPatterns()` in function form.
- Update the docstrings and the block message to match the new rule.

**Execution note:** Test-first. The module is in the Stryker mutate list.

**Test scenarios** (truth table over every guarded pattern):

Happy path:
- Fro Bot plus a guarded path on `data` → allowed.
- Fro Bot plus only unguarded paths on any head → allowed.
- A promotion PR (`fro-bot[bot]`, head `data`, mixed paths) → allowed.

Error path:
- Fro Bot plus each guarded pattern on a non-`data` head → blocked, listing exactly the guarded files.
- A non-Fro-Bot author plus a guarded path on `data` → still blocked.

Edge cases:
- `headRef` given as `['data']` → blocked.
- `headRef` is `'Data'` or `'data '` → blocked.
- Mixed guarded and unguarded files on a non-`data` head → only the guarded files are listed.

**Verification:** `pnpm check:mutation-guards` passes with no new directives, and the mutants on the new branch are killed.

## System-Wide Impact

- **Interaction graph:**
  - `merge-data` promotion and `updateBranch`
  - the reconcile → `survey-repo` dispatch fan-out
  - the `update-metadata` → `metadata/renovate.yaml` → `dispatch-renovate` chain
  - the required `Check Wiki Authority` check on every PR to `main`
- **Error propagation:** A missing scope surfaces as a runtime 403 on the first call that needs it. Recovery paths such as `updateBranch` only run occasionally, which is why scopes come from traced calls and the live dispatches.
- **State lifecycle risks:** Misrouting a reconcile read to the writer corrupts `metadata/repos.yaml` with false `lost-access` states. Units 4 and 5 prove routing with adversarial mocks.
- **Unchanged invariants:**
  - `fro-bot[bot]` authorship.
  - The `data` ruleset bypass.
  - The cross-repo dispatch reach.
  - The survey gate and recheck tokens.
  - The agent-job credential isolation guards.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| A scope missing on a rarely run path (`updateBranch`, stale PR handling) | Scopes come from traced calls and the docs. Live dispatch after merge. |
| An owner-scoped mint with an empty list goes owner-wide | Cleaned list, `if:` guard on both mint and dispatch, and a Unit 1 rule. |
| A stale renovate entry rejects the whole mint | Intersect with the installation's repo list before minting. |
| A partial revert leaves workflow tokens and script clients mismatched | Each split lands as one commit covering workflow and script. |
| The tighter guard blocks an urgent metadata fix PR | The manual route through `data` is already documented in the block message. |

## Documentation / Operational Notes

Post-merge verification (R7). Each dispatch needs separate operator approval. They run in ascending order of how much each one changes:

1. `update-metadata`: an idempotent commit.
2. `wiki-lint` (issue sync).
3. `manage-cache`, with a throwaway `ref` so `main`'s caches are kept.
4. `manage-issues`: runs the same as its schedule.
5. `reconcile-repos`: may commit to `data` and fan out up to 12 staggered surveys.
6. `dispatch-renovate`: fans Renovate out to the scoped list.
7. `merge-data`: opens or updates the real promotion PR.
8. `reset-survey-status`: no safe no-op, so the operator picks a real target whose survey is stale or due anyway.

A failed dispatch stops the sequence, and its run log decides the fix.

## Sources & References

- #3966 item 4; #3958 (2026-10-09 remediation comment on the integrity findings)
- Related code:
  - `scripts/check-wiki-authority.ts`
  - `scripts/reconcile-repos.ts`
  - `scripts/update-metadata.ts`
  - `scripts/dispatch-renovate.ts`
  - `scripts/merge-data-pr.ts`
- External docs:
  - <https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch>
  - <https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation>
  - <https://github.com/actions/create-github-app-token#inputs>
  - <https://github.com/actions/stale#recommended-permissions>
