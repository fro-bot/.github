---
title: 'feat: Wiki authority CI guard'
type: feat
status: active
date: 2026-04-19
---

# feat: Wiki authority CI guard

## Overview

Add a CI guard that fails pull requests touching auto-managed `knowledge/` and `metadata/` files unless authored by Fro Bot (either identity). This closes the divergence loop that caused today's wiki drift incident: legacy human PRs landing directly on `main` produced content that `data`'s snapshot lacked, which then crashed downstream survey runs under `git restore`.

The guard structurally enforces the single authority rule established earlier today: `data` is the only writable source for autonomously-managed state; `main` receives those files only via the `data → main` promotion PR opened by `merge-data.yaml`. Operators with intentional one-off edits commit to `data` and let the existing promotion flow land them on `main`.

## Problem Frame

Today's reconcile cron produced six failed survey runs traced to a structural drift between `main` and `data`. Root-cause analysis (see `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`) identified that `main` accumulated 22 wiki pages and their catalog/log entries directly — none went through `data` first — because prior agent versions and legacy human PRs had write paths that bypassed the intended `data`-branch-first model.

The immediate symptom was patched in `PR #3144` by filtering porcelain deletions in `scripts/wiki-ingest.ts`. The deeper cause — that `main` can accept wiki/metadata edits outside the promotion flow — remains. Oracle's architectural audit called out this as the highest-leverage structural change needed to prevent recurrence.

## Requirements Trace

- **R1.** Block PRs targeting `main` that modify `knowledge/wiki/**`, `knowledge/index.md`, `knowledge/log.md`, or `metadata/*.yaml` when authored by any identity other than `fro-bot` or `fro-bot[bot]`.
- **R2.** Allow the `data → main` promotion PR opened by `merge-data.yaml` to pass (authored by `fro-bot[bot]`).
- **R3.** Allow human-authored edits to human-maintained docs inside the same directories (`knowledge/schema.md`, `knowledge/README.md`, `knowledge/wiki/README.md`, `metadata/README.md`).
- **R4.** Fail closed with a clear, actionable error message naming the blocked files and pointing the PR author to the `data` branch workflow.
- **R5.** Enforce via required status check on `main` branch protection.
- **R6.** Run with zero new dependencies; stay consistent with existing `scripts/*.ts` + Vitest pattern.

## Scope Boundaries

- Does not guard `knowledge/schema.md`, `knowledge/README.md`, `knowledge/wiki/README.md`, or `metadata/README.md`. Those are intentionally human-editable documentation.
- Does not guard arbitrary files outside `knowledge/` and `metadata/`. The rest of the repo uses normal code-review.
- Does not add a label-based override mechanism. Oracle's Section 4 prescription is that `data` itself is the operator path; adding a bypass label would dilute the policy.
- Does not retroactively audit existing commits on `main`. The guard applies to future PRs only.
- Does not block direct pushes to `main` — branch protection already requires PRs, so the guard on the PR surface is sufficient.

### Deferred to Separate Tasks

- Monitoring the first time a real human PR hits the guard, to decide whether a documented override is worth adding later: handled via a smart note after the guard ships. Not infrastructure work.
- Broader Oracle Section 4 items (survey-outcome classification as tested script, push protection in `common-settings.yaml`): separate plans.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/main.yaml` — existing CI job pattern (Lint, Check Types, Test, Test Scripts Load, Check Workflows). Each job uses `./.github/actions/setup`, runs on `pull_request` + `push` to `main`, `timeout-minutes: 10`, explicit `permissions`.
- `.github/settings.yml` — required-status-check registry under `branches.main.protection.required_status_checks.contexts`. Changes apply via the `Update Repo Settings` workflow after merge.
- `scripts/wiki-slug.ts` — precedent for a small pure function + CLI wrapper pattern. Takes CLI args, emits stdout, exits non-zero on error.
- `scripts/record-survey-result.ts` — precedent for a CLI that reads env + GitHub context and calls a tested helper.
- `scripts/reconcile-repos.ts` — precedent for fail-closed error shapes (`ReconcileError` with `code` + `remediation`) and for tight unit-test coverage over pure decision functions.
- `.github/workflows/merge-data.yaml` — authors the promotion PR as `fro-bot[bot]` (App installation token via `actions/create-github-app-token`). This is the legitimate actor the guard must allow.
- `scripts/reconcile-repos.ts:493` — the identity-equivalence set `EXPECTED_AUTHORS = {'fro-bot', 'fro-bot[bot]'}`. The new guard reuses the same semantics (two identities, one operator).

### Institutional Learnings

- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — captures the trap that motivates this plan. Prevention rule 4 explicitly names "eliminate drift sources rather than papering over them with filters" as the architectural move; this guard is that move for the `main ↔ data` drift surface.

### External References

Not required. This is a well-patterned CI guard, and the codebase has two direct precedents for tested pure-function + thin-CLI scripts.

## Key Technical Decisions

- **Guard lives in `scripts/` as a tested pure function + thin CLI wrapper.** Matches `scripts/wiki-slug.ts` and `scripts/record-survey-result.ts`. Pure function takes `{author, files}` and returns `{ok} | {ok: false, blockedFiles}`. CLI reads `GITHUB_EVENT_PATH` + `gh pr diff --name-only` for the actual PR context. Unit tests cover the pure function; CLI is pattern-matched against existing scripts.

- **Path rules are declarative and enumerated, not directory-wide.** Protect `knowledge/wiki/**`, `knowledge/index.md`, `knowledge/log.md`, and `metadata/*.yaml` exactly. `knowledge/schema.md`, `knowledge/README.md`, `knowledge/wiki/README.md`, and `metadata/README.md` stay human-editable. Avoids the "over-guard makes docs changes painful, under-guard leaves loopholes" failure modes.

- **Identity equivalence mirrors reconcile.** Allow `fro-bot` and `fro-bot[bot]` via an explicit set. Reuses the same pattern `scripts/reconcile-repos.ts` adopted earlier today. No operator allowlist env var — that mechanism was just removed for being identity theater; don't reintroduce it here.

- **Mixed PRs fail.** If a human PR touches any guarded file plus any unguarded file, the guard fails. Splitting the PR (human part stays, guarded edits move to `data`) is the correct resolution; a partial-accept path would erode the policy.

- **No override label.** The `data` branch is the operator path. If a true emergency arrives, admin can temporarily remove the required check from `settings.yml` (reversible in one PR). Avoiding the override keeps the policy crisp.

- **Mounted in `main.yaml`, not a dedicated workflow file.** Matches the existing cluster of CI jobs. New workflow file would add surface without benefit.

- **Runs on `pull_request` only.** The existing `main.yaml` triggers include `push: [main]`; the new job will gate itself with `if: github.event_name == 'pull_request'` so it only evaluates against PR context, not post-merge pushes.

- **Pure function design is case-sensitive and prefix-normalized.** GitHub's filesystem is case-sensitive; guard matches exact casing. Paths from `gh pr diff --name-only` arrive repo-relative without leading `./`, matching the regex shapes.

## Open Questions

### Resolved During Planning

- **Which files in `metadata/` and `knowledge/` are guarded?** Enumerated in Key Technical Decisions: `knowledge/wiki/**`, `knowledge/index.md`, `knowledge/log.md`, `metadata/*.yaml`. Human docs (README, schema) explicitly outside the guard.
- **Which identities can write to guarded files via PR?** `fro-bot` and `fro-bot[bot]`. The reconcile integrity check already models these as one operator; the guard reuses the same model.
- **Where does the guard execute?** New CI job `check-wiki-authority` inside `.github/workflows/main.yaml`, following existing job patterns.
- **Is there an override?** No. The `data` branch is the operator path; removing the required check temporarily is the break-glass option.

### Deferred to Implementation

- **Exact failure message copy.** The guard's error output goes into the CI log and becomes the first thing the PR author sees. Final wording will be tuned during Unit 1 to match repo voice (direct, factual, short). The substance — which files are blocked, who is authorized, and how to resubmit via `data` — is locked by the plan.

## Implementation Units

- [ ] **Unit 1: Pure guard function + CLI script**

**Goal:** Implement the wiki-authority decision function and a thin CLI that wires it to PR event context.

**Requirements:** R1, R2, R3, R4, R6

**Dependencies:** None.

**Files:**
- Create: `scripts/check-wiki-authority.ts`
- Test: `scripts/check-wiki-authority.test.ts`

**Approach:**
- Export a pure `checkWikiAuthority(input: {author: string; files: string[]}): GuardResult` where `GuardResult` is `{ok: true} | {ok: false; blockedFiles: string[]}`.
- Maintain an internal `FROBOT_AUTHORS = new Set<string>(['fro-bot', 'fro-bot[bot]'])` mirroring `scripts/reconcile-repos.ts`.
- Maintain an internal `GUARDED_PATTERNS: RegExp[]` covering the four rules: `^knowledge/wiki/.+\.md$`, `^knowledge/index\.md$`, `^knowledge/log\.md$`, `^metadata/[^/]+\.yaml$`.
- CLI wrapper at the bottom of the file: when invoked as a script (check `import.meta.url` against `process.argv[1]`), read PR context from `GITHUB_EVENT_PATH` (pull_request event payload), fetch changed files via `gh pr diff --name-only <pr-number>` or read from the event payload if present, call the pure function, emit a formatted failure message to stderr and exit 1 on block, or exit 0 with a brief success message on allow.
- Errors read by the pure function are typed; errors in the CLI layer (missing env, gh failure) exit with a distinct non-zero status and explicit message so workflow debugging is obvious.

**Execution note:** Test-first. Write the test file listing all scenarios (see below), confirm RED, then implement the pure function until GREEN. CLI wrapper is pattern-matched against `scripts/record-survey-result.ts` and smoke-tested manually in Unit 2.

**Patterns to follow:**
- `scripts/wiki-slug.ts` — pure function + CLI wrapper shape.
- `scripts/record-survey-result.ts` — env-driven CLI reading GitHub context.
- `scripts/reconcile-repos.ts` — identity-equivalence set + structured error messaging (just the message shape; this script doesn't need a full `ReconcileError` class).
- `scripts/reconcile-repos.test.ts` — Vitest conventions for pure decision functions with comprehensive scenario tables.

**Test scenarios:**
- Happy path: author `fro-bot[bot]`, files `['metadata/repos.yaml']` → `{ok: true}`.
- Happy path: author `fro-bot`, files `['knowledge/wiki/topics/home-assistant.md']` → `{ok: true}`.
- Happy path: author `fro-bot[bot]`, files `['knowledge/wiki/repos/marcusrbrown--x.md', 'metadata/allowlist.yaml', 'knowledge/index.md', 'knowledge/log.md']` (mixed guarded) → `{ok: true}`.
- Happy path: author `marcusrbrown`, files `['README.md', 'src/foo.ts']` → `{ok: true}` (no guarded paths touched).
- Happy path: author `marcusrbrown`, files `[]` → `{ok: true}` (vacuous).
- Happy path: author `marcusrbrown`, files `['knowledge/schema.md']` → `{ok: true}` (schema intentionally unguarded).
- Happy path: author `marcusrbrown`, files `['knowledge/README.md']` → `{ok: true}`.
- Happy path: author `marcusrbrown`, files `['knowledge/wiki/README.md']` → `{ok: true}`.
- Happy path: author `marcusrbrown`, files `['metadata/README.md']` → `{ok: true}`.
- Error path: author `marcusrbrown`, files `['metadata/repos.yaml']` → `{ok: false, blockedFiles: ['metadata/repos.yaml']}`.
- Error path: author `marcusrbrown`, files `['knowledge/wiki/topics/home-assistant.md']` → blocked.
- Error path: author `marcusrbrown`, files `['knowledge/index.md']` → blocked.
- Error path: author `marcusrbrown`, files `['knowledge/log.md']` → blocked.
- Error path: author `marcusrbrown`, files `['src/foo.ts', 'metadata/repos.yaml']` → blocked, only the guarded file in `blockedFiles`.
- Error path: author `marcusrbrown`, files `['metadata/repos.yaml', 'knowledge/wiki/repos/x.md', 'knowledge/index.md', 'knowledge/log.md']` → blocked, all four in `blockedFiles` preserving input order.
- Error path: author `github-actions[bot]`, files `['metadata/repos.yaml']` → blocked (not an allowed identity).
- Error path: author `dependabot[bot]`, files `['metadata/repos.yaml']` → blocked.
- Edge case: author `marcusrbrown`, files `['knowledge/wiki/comparisons/x-vs-y.md']` → blocked (nested wiki glob).
- Edge case: author `marcusrbrown`, files `['metadata/new-thing.yaml']` (hypothetical future file) → blocked (glob covers any `*.yaml` under `metadata/`).
- Edge case: author `marcusrbrown`, files `['metadata/subdir/x.yaml']` (hypothetical nested) → not blocked by current glob (glob is single-segment). Document this in the test as the current intended behavior; if nested metadata appears later, revisit.
- Edge case: author `marcusrbrown`, files `['metadata/repos.yml']` (wrong extension) → not blocked. Only `.yaml` is guarded.

**Verification:**
- `pnpm test` passes with the new test file contributing clean scenarios.
- `pnpm lint` and `pnpm check-types` clean on the new file.
- Smoke-test the CLI locally by invoking it with a synthetic `GITHUB_EVENT_PATH` JSON and observing exit status + message.

- [ ] **Unit 2: Wire guard into CI + required status check**

**Goal:** Add the `check-wiki-authority` job to `main.yaml` and register it in `settings.yml` so branch protection enforces it.

**Requirements:** R5

**Dependencies:** Unit 1 merged (the script must exist before the workflow invokes it).

**Files:**
- Modify: `.github/workflows/main.yaml`
- Modify: `.github/settings.yml`

**Approach:**
- Add a new job `check-wiki-authority` to `main.yaml` following the existing job layout (explicit `permissions`, `runs-on: ubuntu-latest`, `timeout-minutes: 10`, checkout with `ref: ${{ github.head_ref }}`, `./.github/actions/setup`).
- Gate with `if: github.event_name == 'pull_request'` so it runs only on PR events, not on post-merge `push: [main]` runs.
- Invoke via `run: node scripts/check-wiki-authority.ts`. Pass `GITHUB_TOKEN` from the default `${{ github.token }}` for `gh` CLI auth; the job only needs read access to PR metadata and diff, so `permissions: pull-requests: read, contents: read` is sufficient.
- In `settings.yml`, insert `Check Wiki Authority` into the alphabetically-ordered `branches.main.protection.required_status_checks.contexts` list.

**Patterns to follow:**
- `.github/workflows/main.yaml` jobs `Test Scripts Load` and `Check Workflows` — same shape.
- `.github/settings.yml` existing contexts list — keep alphabetical.

**Test scenarios:**

Test expectation: none — this unit is YAML config with no behavioral logic to unit-test. Verification happens via the workflow's actual run on Unit 2's own PR (the guard must pass on a PR authored by the user that changes only workflow/settings files, which are not guarded).

**Verification:**
- `actionlint` (via `Check Workflows` job) passes on the modified `main.yaml`.
- On the Unit 2 PR itself, the new `check-wiki-authority` job runs, evaluates `{author: <user>, files: ['.github/workflows/main.yaml', '.github/settings.yml']}`, and passes (neither file is guarded).
- After merge, `Update Repo Settings` workflow applies the new required check to branch protection. A subsequent test PR touching `metadata/repos.yaml` under a non-Fro-Bot author must fail the check and block merge.

- [ ] **Unit 3: Document operator workflow**

**Goal:** Document the policy so future operators know the correct workflow for one-off wiki or metadata edits.

**Requirements:** R4 (discoverable remediation)

**Dependencies:** None (can land in parallel with Unit 1).

**Files:**
- Modify: `metadata/README.md`
- Modify: `knowledge/schema.md`

**Approach:**
- Add a short section to `metadata/README.md` (after the existing schema sections) titled "Editing metadata files" that explains: `metadata/*.yaml` are auto-managed; edits must land via `data` branch; open the `data` worktree, commit, push, and let `merge-data.yaml` promote; README files are fine to edit on a normal human PR.
- Add the mirroring guidance to `knowledge/schema.md` — a short "Editing the wiki" subsection that describes the same workflow for `knowledge/wiki/**`, `knowledge/index.md`, `knowledge/log.md`.
- Both sections point to the CI guard as the enforcement mechanism, reference the guard script path, and note that the guard respects the two Fro Bot identities.
- No plan references, no session framing; write as operator-facing docs.

**Patterns to follow:**
- `metadata/README.md` existing voice (terse, factual, operator-focused).
- `knowledge/schema.md` existing voice (Karpathy-style conventions doc).

**Test scenarios:**

Test expectation: none — documentation change with no behavior to test.

**Verification:**
- `pnpm lint` clean (markdownlint rules applied via ESLint).
- Reading each updated section cold, an operator can correctly answer: "how do I edit `metadata/repos.yaml` as a human?"

## System-Wide Impact

- **Interaction graph:** The guard interposes between PRs and `main`. Existing CI jobs (Lint, Check Types, Test, Test Scripts Load, Check Workflows) are untouched. `merge-data.yaml` PR passes the guard via `fro-bot[bot]` identity; no workflow change needed.
- **Error propagation:** CI failure with exit 1 and a stderr message pointing at the correct workflow. Branch protection turns that into a "this check failed" state on the PR. No silent failures.
- **State lifecycle risks:** None. The guard evaluates PR metadata per run, no persistent state.
- **API surface parity:** `scripts/check-wiki-authority.ts` mirrors the identity-equivalence set from `scripts/reconcile-repos.ts`. If the operator identity model ever expands (unlikely), both files need to change together. Surface this in Unit 1's implementation comment so a future editor notices.
- **Integration coverage:** Unit-test coverage over the pure function is sufficient. CLI wrapper is smoke-tested on Unit 2's own PR via the real event path.
- **Unchanged invariants:** `data` branch remains unprotected (autonomous writers unchanged). `merge-data.yaml` flow unchanged. `reconcile-repos.yaml` integrity check unchanged. Human PRs touching code in `src/`, `scripts/`, workflows, or docs outside the guarded paths continue to work as today.

## Risks & Dependencies

| Risk                                                                                                                        | Mitigation                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard false-positives a legitimate operator edit                                                                            | Fail message tells the operator exactly how to resubmit via `data`. Worst case: a single extra round-trip. No data loss; the edit still lands, just through the intended channel.                                                           |
| Guard false-negatives a malformed path match (e.g., `./knowledge/wiki/x.md` with leading `./`)                              | Pure function tests pin the expected input shape to repo-relative paths without leading `./`. `gh pr diff --name-only` emits that shape. CLI layer could normalize defensively if a real mismatch appears — added as a deferred follow-up. |
| `merge-data.yaml` author identity drifts (e.g., GitHub renames bot suffix)                                                  | Identity set is centralized in one helper; changing it is a one-file change. Existing `scripts/reconcile-repos.ts` uses the same set, so drift affects both symmetrically.                                                                  |
| Required status check misconfigured in `settings.yml` and blocks merges before Unit 2's own PR lands                        | Add the context to `settings.yml` in Unit 2's PR only after the job itself is defined in the same PR. The new context applies only to PRs opened after the `Update Repo Settings` run. Unit 2's own PR is merged under the old rule set.    |
| A future metadata subdirectory (e.g., `metadata/archive/`) escapes the single-segment glob                                  | Documented in test scenarios as current intended behavior. If nested metadata is added, revise the glob in one line and update the test.                                                                                                    |
| Human operator accidentally creates a `.yml` (not `.yaml`) file in `metadata/` and it bypasses the guard                    | Documented in tests as current behavior. Lint or schema tooling can be layered later to enforce the canonical `.yaml` extension, tracked as a separate concern.                                                                             |

## Documentation / Operational Notes

- `metadata/README.md` and `knowledge/schema.md` carry the operator workflow (Unit 3).
- The `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` compound doc already notes "eliminate drift sources" as the architectural move; a short amendment after this plan lands can reference the guard as the concrete realization. Tracked as a follow-up, not part of this plan.
- Operational note for the first real human PR that hits the guard: monitor the fail message for clarity and adjust copy if needed. No pre-emptive tuning — wait for real feedback.

## Sources & References

- Related code: `scripts/reconcile-repos.ts` (`EXPECTED_AUTHORS` set), `scripts/wiki-slug.ts` (CLI pattern), `scripts/record-survey-result.ts` (CLI with env context), `.github/workflows/main.yaml` (job layout), `.github/workflows/merge-data.yaml` (promotion PR flow).
- Related PRs: `#3144` (porcelain deletion filter — patched the symptom), `#3149` (identity collapse — normalized the two Fro Bot identities), `#3147` (compound doc prevention rule 4 names this exact structural move).
- Architectural context: this plan executes Oracle's Section 4 recommendation from the 2026-04-19 control-plane audit — "Make `data` the only writable authority for `knowledge/**` and `metadata/**`. Add a guard in PR CI that fails non-promotion PRs touching those paths."
