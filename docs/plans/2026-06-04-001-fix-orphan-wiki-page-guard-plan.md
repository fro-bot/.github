---
title: 'fix: gate survey wiki-commit on an onboarded repos.yaml entry'
type: fix
status: active
date: 2026-06-04
---

# Gate survey wiki-commit on an onboarded repos.yaml entry

## Overview

A manual `survey-repo.yaml` dispatch can write a promotable wiki page to the
`data` branch for a repository that has **no `metadata/repos.yaml` entry**. The
resulting orphan page is `unattributable` to the privacy gate
(`scripts/check-wiki-private-presence.ts`), which fail-closed blocks every
`data → main` promotion until the page is removed by hand.

This plan establishes the invariant: **a survey only writes a wiki page to `data`
if the surveyed repo is already onboarded in `metadata/repos.yaml` on `data`.**

## Problem Frame

Triage issue #3440 (and the live incident it documents): a Merge Data Branch run
failed at `🔒 Block private wiki pages` with one `unattributable-page`. Root cause
(diagnosed via the gate's own exported functions, operator-side):

- A manual survey of `fro-bot/tokentoilet` (an archived fork, never onboarded
  because reconcile excludes archived repos via `archived === false` filtering)
  wrote `knowledge/wiki/repos/fro-bot--tokentoilet.md` to `data`.
- `fro-bot/tokentoilet` has no `repos.yaml` entry, so the page is not in the
  public slug map and is not grandfathered on `main` → `unattributable-page`.
- `scripts/record-survey-result.ts` already requires an entry and **silently
  no-ops** (`RepoEntryNotFoundError` → exit 0, treated as "legitimate when a
  manual survey dispatch runs against an un-onboarded repo"). But the wiki page is
  committed in an **earlier** step, independent of that check, so the orphan page
  lands regardless.

The asymmetry: reconcile-driven surveys are always preceded by `addRepoEntry`
onboarding, so they never orphan. Only **manual dispatch** can.

The one-off orphan page was already removed from `data` via a Fro Bot identity
dispatch (commit `1dd3b5c`); the gate now passes. This plan prevents recurrence.

## Requirements Trace

- R1. A survey of a repo with no `metadata/repos.yaml` entry on `data` must NOT
  commit a wiki page to `data` (no orphan promotable pages).
- R2. The guard must cover the general un-onboarded class, not just archived forks
  (a non-archived, non-fork, public-but-not-yet-onboarded repo must also be
  gated).
- R3. The guard must be consistent with the existing `record-survey-result`
  contract, which already requires an entry.
- R4. Reconcile-driven surveys (which onboard via `addRepoEntry` first) must
  continue to work unchanged.
- R5. The survey run must not be marked failed when it gates out — it should skip
  the wiki-commit + announce and exit cleanly (same fail-soft posture as the
  existing no-op).

## Scope Boundaries

- Not changing reconcile's onboarding eligibility policy (archived/fork
  exclusion stays as-is).
- Not auto-onboarding repos during survey (explicitly rejected — would bypass
  reconcile's eligibility policy and write entries for repos that shouldn't be
  tracked).
- Not changing the privacy gate (`check-wiki-private-presence.ts`) — it behaved
  correctly (fail-closed). This plan stops the orphan from being created, not the
  gate from catching it.
- Not adding a dispatch-time archived/fork rejection (considered; the onboarded-
  entry gate is strictly more general and covers the archived-fork case too).

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/survey-repo.yaml` — the survey job. Key steps in order:
  `🔒 Resolve and verify` (resolves node_id → owner/repo, public-only), `Sync wiki
  from data branch` (already does `git fetch origin data`), `Commit wiki ingest to
  data branch` (`id: wiki-commit`, writes the page), `Record survey result`
  (requires the entry, no-ops if missing), `📣 Announce survey to gateway`.
- `scripts/record-survey-result.ts` — already throws/handles `RepoEntryNotFoundError`
  and exits 0 on a missing entry. This is the existing "is it onboarded?" check —
  the plan moves an equivalent check **earlier**, before the wiki-commit.
- `scripts/reconcile-repos.ts:1793` — `archived === false` filtering; `addRepoEntry`
  called before dispatch (why reconcile never orphans).
- The `data` metadata overlay pattern: `survey-repo.yaml` already does
  `git fetch origin data` for the wiki sync; `reconcile-repos.yaml` overlays
  `metadata/` from `data` with `git checkout origin/data -- metadata/`. The same
  cheap, precedented overlay gives the survey read access to the authoritative
  `repos.yaml`.

### Institutional Learnings

- `docs/solutions/` (data-branch sole-writer / privacy-gate docs): `data` is the
  authoritative writer for `knowledge/**` + `metadata/**`; `wiki-ingest.ts` is
  additive-only (cannot delete); manual `data` writes by a human author trip
  `DATA_BRANCH_TAMPER` in reconcile.
- Memory: reconcile reads authoritative survey state by overlaying `metadata/`
  from `data` before planning — the same technique applies here.

## Key Technical Decisions

- **Gate location: a new step before `wiki-commit`, after `resolve`.** It reads
  the overlaid `data` `metadata/repos.yaml`, checks whether the resolved
  owner/repo has an entry, and sets an output the `wiki-commit` and `announce`
  steps gate on. Rationale: stops the orphan at the source (R1), covers the whole
  un-onboarded class (R2), and mirrors `record-survey-result`'s contract (R3).
- **Reuse the existing data overlay.** The survey already fetches `data` for the
  wiki sync; extend it to also read `repos.yaml` (or overlay `metadata/`), so no
  new credential or network surface is added.
- **A small TS helper, not inline YAML/jq.** A pure, tested function
  (`repoEntryExists(reposYaml, owner, repo)`) keeps the logic testable and
  strip-only safe, consistent with the repo's "logic in scripts, not shell"
  convention. The workflow calls it and gates on its output.
- **Fail-soft skip, not failure (R5).** When the entry is absent, the run skips
  wiki-commit + announce and exits 0 with a clear stderr note — matching the
  existing `record-survey-result` posture so manual dispatches of un-onboarded
  repos degrade cleanly instead of erroring.

## Open Questions

### Resolved During Planning

- *Where to gate?* → before `wiki-commit` (the step that creates the orphan), not
  at dispatch. Resolved per the design decision above.
- *Archived/fork rejection too?* → no; the onboarded-entry gate is strictly more
  general. Recorded as a scope boundary.
- *Auto-onboard?* → rejected (scope boundary).

### Deferred to Implementation

- Exact mechanism to expose the "entry exists" result to later steps (a step
  output set from the helper's stdout vs. an env var). Resolve when wiring.
- Whether to overlay all of `metadata/` or read only `repos.yaml` — pick the
  minimal form that the helper needs at implementation time.

## Implementation Units

- [ ] **Unit 1: `repoEntryExists` helper + tests**

**Goal:** A pure, tested predicate that answers "does `metadata/repos.yaml` have
an entry for this owner/repo?" for the survey gate to call.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `scripts/repos-metadata.ts` (add `repoEntryExists`, or a thin
  CLI-friendly wrapper) — or a new small `scripts/check-repo-onboarded.ts` CLI if
  a standalone entrypoint is cleaner for the workflow to call
- Test: `scripts/repos-metadata.test.ts` (or the new script's `.test.ts`)

**Approach:**
- Parse the provided `repos.yaml` content and return whether an entry matches the
  given `owner` + `repo` (case-sensitive, matching how entries are stored).
- Pure function over parsed YAML — no I/O in the predicate. A thin CLI wrapper
  reads the file + env (`REPO_OWNER`, `REPO_NAME`) and prints a gate-friendly
  result (e.g. `onboarded=true|false` to `GITHUB_OUTPUT`), exiting 0 either way.
- Reuse existing schema/parse helpers in `repos-metadata.ts`; do not hand-roll
  YAML parsing.

**Patterns to follow:**
- `scripts/record-survey-result.ts` CLI shape (env-driven, `import.meta.url`
  entrypoint guard, structured stderr, exit-0 posture).
- Existing `repos-metadata.ts` pure-function + `RepoEntryNotFoundError` style.

**Test scenarios:**
- Happy path: entry present for `owner/repo` → true.
- Edge: entry absent → false.
- Edge: empty/missing `repos:` list → false (not a crash).
- Edge: owner matches but name differs (and vice versa) → false.
- Edge: malformed YAML → fail-closed (treat as not-onboarded / surface a clear
  error per the chosen wrapper contract), never a silent true.

- [ ] **Unit 2: wire the onboarded gate into `survey-repo.yaml`**

**Goal:** Survey only commits the wiki page (and announces) when the resolved repo
is onboarded on `data`.

**Requirements:** R1, R2, R4, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/survey-repo.yaml`

**Approach:**
- After `🔒 Resolve and verify`, ensure `metadata/repos.yaml` from `data` is
  available (reuse/extend the existing `git fetch origin data`; overlay
  `metadata/` if needed). Add a `Check repo onboarded` step that runs the Unit 1
  helper with `REPO_OWNER`/`REPO_NAME` and sets `steps.onboarded.outputs.onboarded`.
- Add `&& steps.onboarded.outputs.onboarded == 'true'` to the `if:` of the
  `Commit wiki ingest to data branch` step and the `📣 Announce survey to gateway`
  step. (The `Record survey result` step already no-ops on a missing entry; leave
  its behavior, but it will now agree with the wiki gate.)
- When not onboarded: emit a clear stderr note, skip wiki-commit + announce, and
  let the job conclude successfully (R5).
- Confirm reconcile-driven dispatches still pass: reconcile onboards via
  `addRepoEntry` before dispatch, so the entry exists on `data` by survey time
  (R4).

**Execution note:** Validate with `actionlint` (the repo's `Check Workflows`
gate); workflow logic can't be unit-tested, so the helper (Unit 1) carries the
test coverage and the workflow carries an actionlint + a live manual-dispatch
verification.

**Patterns to follow:**
- The existing `data` fetch/overlay in `survey-repo.yaml` (wiki sync) and
  `reconcile-repos.yaml` (`git checkout origin/data -- metadata/`).
- The existing step-output gating pattern already used across the survey steps
  (`steps.recheck.conclusion`, `steps.wiki-changes.outputs.changed`).

**Test scenarios:**
- Test expectation: none (workflow YAML) — covered by Unit 1 tests +
  `actionlint` + a post-merge manual-dispatch verification (onboarded repo →
  page commits; un-onboarded repo → no page, run succeeds).

## System-Wide Impact

- **Interaction graph:** Only `survey-repo.yaml`'s wiki-commit + announce gating
  changes. `record-survey-result` already gated on the entry; this brings the
  wiki-commit into agreement. No change to reconcile, the privacy gate, or the
  gateway announce script.
- **Error propagation:** Not-onboarded is a clean skip (exit 0), not a failure —
  consistent with the existing `record-survey-result` no-op.
- **State lifecycle risks:** Eliminates the orphan-page state that blocked
  promotion. No new state introduced.
- **API surface parity:** `poll-invitations.yaml` and `reconcile-repos.yaml` both
  onboard before any wiki write, so they don't need the guard — but if a future
  manual wiki-writing path is added, it should reuse the Unit 1 helper.
- **Unchanged invariants:** The privacy gate, `wiki-ingest.ts` additive-only
  behavior, and reconcile onboarding eligibility are all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Overlaying `data` metadata adds a step that could fail and block legit surveys | Reuse the existing `git fetch origin data` already in the job; fail-closed only on the onboarded check itself, and make malformed/missing read a clear skip, not a hard error mid-job |
| A legit brand-new public repo manual-survey now no-ops until onboarded | Documented + intended: onboard via reconcile or the allowlist first. Surfaced in the skip stderr message so the operator knows the next step |
| Helper case-sensitivity mismatch vs. stored entries | Unit 1 tests cover owner/name exact-match; mirror how `record-survey-result` matches |

## Documentation / Operational Notes

- Note in `metadata/README.md` (or the survey workflow header comment) that a
  manual survey of an un-onboarded repo will skip the wiki write by design, and
  how to onboard first.
- Close #3440 referencing the unblock (already done on `data`) + this guard once
  shipped.

## Sources & References

- Triage issue: #3440
- Unblock commit on `data`: `1dd3b5c` (Fro Bot identity)
- Gate: `scripts/check-wiki-private-presence.ts` (`detectPrivateWikiLeaks`)
- Existing entry-check precedent: `scripts/record-survey-result.ts`,
  `scripts/repos-metadata.ts` (`RepoEntryNotFoundError`)
- Onboarding/exclusion: `scripts/reconcile-repos.ts` (`addRepoEntry`,
  `archived === false`)
