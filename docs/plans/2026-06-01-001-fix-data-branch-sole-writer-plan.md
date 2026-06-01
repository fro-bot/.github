---
title: "fix: Make data the sole writer of metadata/repos.yaml"
type: fix
status: active
date: 2026-06-01
origin: docs/brainstorms/2026-06-01-data-branch-sole-writer-requirements.md
---

# fix: Make `data` the Sole Writer of `metadata/repos.yaml`

## Overview

The weekly `data → main` promotion (PR #3396) was born conflicted in `metadata/repos.yaml`. Root cause: that file is mutated on both branches — autonomous survey write-backs on `data`, and privacy-hygiene deletions on `main` (PR #3394) — and the main-side edits are themselves workarounds for a brittle privacy gate that fails closed on `node-null` private entries. This plan eliminates the conflict class by removing the second writer: fix the gate so it no longer needs main-side curation, stop editing `repos.yaml` on `main`, and add a safety net that makes any future born-conflicted promotion loud instead of silent.

## Problem Frame

`scripts/check-wiki-private-presence.ts` (`resolveCanonicalSlugs`) throws if *any* private entry is unresolvable, including `node-null` (repo deleted / App lost access). A single dead private orphan on `data` blocked every promotion. Two PRs worked around that: PR #3395 pointed the gate at `main`'s `repos.yaml` (`cp ../metadata/repos.yaml`), and PR #3394 deleted orphans from `main` to keep that copy clean. Together they turned `repos.yaml` into a both-sides-mutated file and produced the #3396 conflict. One root problem (brittle fail-closed gate), not two. See origin: docs/brainstorms/2026-06-01-data-branch-sole-writer-requirements.md.

## Requirements Trace

- R1. A `node-null` private entry on `data` must not block the weekly promotion (origin SC1).
- R2. A `subprocess-threw` (transport/auth) resolution failure must still fail the gate closed (origin SC2).
- R3. Slug-named wiki-page leak coverage for `node-null` private repos must be preserved — no privacy regression (origin SC1, review P1).
- R4. `merge-data.yaml` must stop copying `main`'s `repos.yaml`; the gate reads the `data` checkout (origin SC3).
- R5. A born-conflicted promotion PR must fail/alert rather than report success (origin SC4).
- R6. Two consecutive promotions complete with `repos.yaml` changing only on `data`, producing no conflict (origin SC5).
- R7. A redacted private entry on `data` promotes to `main` without being stripped, and the gate reports no leak for it (origin SC6).

## Scope Boundaries

- No file split of `metadata/repos.yaml` (origin non-goal). Single-writer makes it unnecessary.
- No bespoke YAML merge engine in `merge-data-pr.ts`.
- No change to the survey-side privacy gate (`survey-repo.yaml` visibility recheck) — that remains the primary gate.
- No relaxation of the redaction posture: private repos stay `name: <node_id>`, canonical identifiers never reach `main`.
- No `removeRepoEntry` helper — only needed for the manual orphan-deletion path being eliminated.

### Deferred to Separate Tasks

- Intent-based authority guard (a `repos.yaml` change on a `main` PR may only originate from the `data` promotion): decision in this plan (Unit 5) is to ship it as the code enforcement of the sole-writer invariant, OR defer as an explicit follow-up issue — resolved in Open Questions below.
- Auto-deletion of wiki pages for repos that go private: already owned by private-repo handling plan Unit 8 (ships as a check, operator deletes). Not duplicated here.
- Independent privacy source of truth (gate validating against a source the promoted branch can't edit): deferred unless the threat model tightens (origin Q6).

## Context & Research

### Relevant Code and Patterns

- `scripts/check-wiki-private-presence.ts` — the gate. `resolveCanonicalSlugs` (lines 142-191) throws on any failure; `detectPrivateWikiLeaks` (lines 24-49) does canonical-slug + node-id matching; `FailureMode = 'subprocess-threw' | 'node-null'` (line 123) already classifies the two failure modes — the classification exists, only the throw-on-both behavior needs changing.
- `.github/workflows/merge-data.yaml` lines 39-47 — the `cp ../metadata/repos.yaml` workaround + gate invocation.
- `scripts/merge-data-pr.ts` — `waitForKnownMergeableState` (lines 276-298) already polls `mergeable_state` past `unknown`; reuse it for DIRTY detection. `mergeDataPr` returns a result object; `main()` (lines 702-705) prints it.
- `scripts/reconcile-repos.ts` — sole programmatic writer of survey-state fields on `data`; `bootstrapDataBranch` re-seeds `data` from `main` after squash-delete (copies main's exact content → no divergence).
- `scripts/commit-metadata.ts` line 345 — already refuses writes to `main`, reinforcing data-as-only-programmatic-writer.
- `scripts/schemas.ts` line 67 — documents that canonical identifiers never reach `main` (the constraint that rules out caching slugs).

### Institutional Learnings

- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — the survey-side gate that makes `check-wiki-private-presence.ts` defense-in-depth.
- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — node_id-only public text; redaction posture rationale.
- `docs/solutions/integration-issues/merge-data-pr-github-422-race-recovery-2026-05-02.md` — prior merge-data race handling; informs the safety-net error classification.

### External References

- None needed — fully local patterns.

## Key Technical Decisions

- **Node-null leak coverage via DELTA-based public-allowlist inversion (the core design move).** The current gate iterates *private* entries and tries to match their slugs against wiki filenames — which requires resolving the private repo's canonical slug (impossible for `node-null`, and storing it would itself leak per schema line 67). Invert it: flag any wiki page that is **new in this promotion** and does not map to a known-public entry. Specifically:
  - Build `publicSlugs` from entries with explicit **`private === false`**, using `computeRepoSlug(owner, name)` from `scripts/wiki-slug.ts` (NOT raw `owner--name` — see the empirical finding below).
  - Build `grandfatheredSlugs` = the stems of repo pages **already present on `main`** (the promotion base). A page already on `main` already passed the gate and is already public knowledge; the gate's job is to stop NEW private pages, not re-litigate existing ones.
  - Flag a `knowledge/wiki/repos/*.md` page only when its stem is in NEITHER `publicSlugs` NOR `grandfatheredSlugs`. This catches a newly-promoted private/node-null/node_id page while leaving existing public pages alone.
  - *Fail-safe predicate (review P1, both reviewers):* the public set is built from `private === false` ONLY. The schema makes `private` optional and treats absent as private-until-confirmed; `private !== true` would wrongly admit absent/legacy entries and invert the fail-safe.
  - *EMPIRICAL FINDINGS that forced the delta design (verified against live `main`, 2026-06-01):*
    1. **Slug mismatch (P0 if ignored):** wiki filenames are produced by `computeRepoSlug` (dots→dashes, leading-dot stripped, underscore→dash), so entry `marcusrbrown/.dotfiles` → page `marcusrbrown--dotfiles.md`. A raw `owner--name` allowlist flags 9 of 26 legit public pages. The allowlist MUST use `computeRepoSlug`.
    2. **Lost-access over-block (P0, the reason for the delta design):** `marcusrbrown/copiloting` is `onboarding_status: lost-access` with ABSENT `private` (legacy entry, can't be re-probed) but is verifiably PUBLIC. Under a strict `private === false` predicate its existing public page is flagged — blocking every promotion. Grandfathering pages already on `main` resolves this without weakening the fail-safe for new pages.
  - *Rationale:* removes the dependency on resolving private identities entirely; the public entries are the source of truth for "what's allowed to have a page."
  - *Boundary to resolve (see Open Questions):* a repos page that maps to NO tracked entry at all (neither public nor private) — e.g., a stale page from before tracking. Recommended: fail closed (flag it) — an unattributable page is exactly the leak signal. This must not over-flag legitimately public pages, so the public-allowlist must be built from the same `data` `repos.yaml` the promotion carries.
- **Tamper trust boundary (review P0 — reframed).** Adversarial review flagged that building the allowlist from `data`'s own `repos.yaml` lets a fake `private: false` entry whitelist a private page. This is real but **trust-equivalent to the existing gate**, not a regression: the current gate reads the *private* list from the same file, and a tamper that *deletes* a private entry already causes the same under-block. Both designs anchor on fro-bot being the sole writer of `data` (enforced by Unit 5's authority guard + the integrity check in `reconcile-repos.ts`). An independently-anchored privacy source is out of scope for v1 (origin Q6). Document this as an accepted, unchanged trust boundary — do not claim the inversion introduces it.
- **Keep `subprocess-threw` fail-closed; stop failing on `node-null`.** Transport/auth uncertainty is genuinely unverifiable → must block + retry next run. `node-null` is now a non-event for coverage (the inversion doesn't need resolution), so it never blocks.
- **Gate reads `data`'s own `repos.yaml`.** Revert the `cp`. The branch being promoted is the correct source for "what entries does this promotion carry." Accepted trust boundary: `data` is written only by the fro-bot identity (origin Q6).
- **Safety net is policy-enforcement, not creep.** Sole-writer is a policy invariant, not structural. `merge-data-pr.ts` must detect a DIRTY/CONFLICTING result and fail/alert so a violated invariant is loud immediately.

## Open Questions

### Resolved During Planning

- **Node-null slug coverage mechanism** → public-allowlist inversion (above). Resolves origin Q1 without storing canonical slugs.
- **Can we cache the canonical slug on the entry?** → No. Schema line 67: canonical identifiers never reach `main`. Inversion avoids needing it.
- **Does anything remove a wiki page when a repo goes private?** → No removal path exists (wiki is additive-only; `wiki-ingest.ts` lines 791-814). Private-repo plan Unit 8 handles this as a check. This plan's gate is the promotion-time backstop.
- **Is `waitForKnownMergeableState` reusable for DIRTY detection?** → Yes (lines 276-298). The safety net reuses it.

### Deferred to Implementation

- Exact return-shape change to `resolveCanonicalSlugs` / `detectPrivateWikiLeaks` to express the inversion (likely: `detectPrivateWikiLeaks` takes `publicSlugs: Set<string>` + `wikiRepoFilenames` and flags non-members; `resolveCanonicalSlugs` may become unnecessary for the leak check, retained only if still used elsewhere). Settle when touching the code.
- Whether the safety net hard-fails the workflow, opens an alert issue, or both (origin Q3). Lean: both — non-zero exit AND a high-signal issue, mirroring the stale-divergence alert pattern already in `merge-data-pr.ts`.
- Whether Unit 5 (authority guard) bundles into this work or ships as a follow-up issue (origin Q5).

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Current gate (private-driven, needs resolution):

    for each PRIVATE entry:
        resolve canonical slug via GraphQL   ← throws on node-null (BRITTLE)
        match slug / node_id against wiki filenames → leak

Delta-based inverted gate (no private resolution, grandfathers existing pages):

    publicSlugs        = { computeRepoSlug(e.owner, e.name) for e in repos if e.private === false }
    grandfatheredSlugs = { stem(f) for f in main:knowledge/wiki/repos/*.md }   # already-public, already-passed

    for each file in data:knowledge/wiki/repos/*.md:
        stem = file without .md
        if stem NOT in publicSlugs AND stem NOT in grandfatheredSlugs:
            flag as leak              ← a NEW page that maps to no public entry

    # fail closed if repos.yaml or main page-list is unreadable
    # computeRepoSlug (not raw owner--name) and private===false (not !==true) are both load-bearing

## Implementation Units

- [x] **Unit 1: Invert the privacy gate to a public-allowlist model**

**Goal:** Make `check-wiki-private-presence.ts` detect leaks by flagging wiki pages that don't map to a known-public entry, eliminating the need to resolve private slugs and making `node-null` a non-blocking non-event.

**Requirements:** R1, R2, R3, R7

**Dependencies:** None

**Files:**
- Modify: `scripts/check-wiki-private-presence.ts`
- Modify: `.github/workflows/merge-data.yaml` (surface `main`'s repo-page list to the gate — the non-`data` checkout already has `knowledge/wiki/repos/` on `main`; pass its path/list)
- Reference: `scripts/wiki-slug.ts` (`computeRepoSlug`)
- Test: `scripts/check-wiki-private-presence.test.ts`

**Approach:**
- Build `publicSlugs: Set<string>` from `repos.yaml` entries where **`private === false`** via `computeRepoSlug(owner, name)`. **Critical 1:** use `computeRepoSlug`, NOT raw `${owner}--${name}` — wiki filenames are sanitized (dots/underscores→dashes, leading-dot stripped); a raw allowlist over-flags ~9 legit pages (empirically verified). **Critical 2:** use `private === false`, NOT `private !== true` — the schema makes `private` optional and treats absent as private-until-confirmed (fail-safe); `private !== true` inverts that.
- Build `grandfatheredSlugs: Set<string>` from the stems of `.md` files already present in `knowledge/wiki/repos/` on the promotion BASE (`main`). A page already on `main` is grandfathered (already public, already passed the gate). This resolves the `copiloting` lost-access over-block.
- Reframe `detectPrivateWikiLeaks` to flag any `data` `knowledge/wiki/repos/*.md` stem present in NEITHER `publicSlugs` NOR `grandfatheredSlugs`. Add an `unattributable-page` reason; retain existing taxonomy where applicable.
- Keep `subprocess-threw` fail-closed: if reading/parsing the `data` entries OR the `main` page list fails, block. `node-null` no longer participates in the throw path.
- Retain `resolveCanonicalSlugs` only if still referenced elsewhere; otherwise mark for removal (decide in-code).

**Execution note:** Test-first — add the failing grandfather + slug-sanitization scenarios before changing the detector.

**Patterns to follow:** existing `detectPrivateWikiLeaks` structure (lines 24-49); `computeRepoSlug` from `scripts/wiki-slug.ts`; existing fail-closed throw with per-entry mode hints (lines 179-188).

**Test scenarios:**
- Happy path: all `data` repo pages map to `private === false` entries (via `computeRepoSlug`) → no leak.
- **Slug-sanitization (empirical P0): entry `owner/.dotfiles` + page `owner--dotfiles.md` → NO leak** (allowlist uses `computeRepoSlug`). Assert a raw-join allowlist WOULD have flagged it.
- **Grandfather (empirical P0): a page already on `main` for a `lost-access`/absent-`private` entry (`marcusrbrown--copiloting.md`) → NO leak** (grandfathered). Assert that without grandfathering it WOULD flag.
- Edge case: a NEW page (on `data`, not `main`) for a private entry (node_id known) → flagged.
- Edge case (original P1 gap): a NEW page for a `node-null` private repo → flagged without GraphQL resolution.
- Edge case (fail-safe predicate): a NEW page for an entry with ABSENT/undefined `private` → flagged. Assert `private !== true` is NOT the predicate.
- Edge case: a NEW page named `<node_id>.md` → flagged (not a public slug, not grandfathered).
- Error path: `repos.yaml` parse failure OR main-page-list read failure → throws (fail closed); MUST NOT yield an empty set that silently over- or under-blocks.
- Happy path: redacted private entry present, no corresponding page → no leak (R7).

**Verification:** node-null private orphan no longer blocks; a NEW slug-named page for a private repo is still caught; the existing `copiloting` page does not over-block; transport failure still blocks.

- [x] **Unit 2: Revert the `cp` workaround in `merge-data.yaml`**

**Goal:** Gate reads `data`'s own `repos.yaml` instead of copying `main`'s.

**Requirements:** R4

**Dependencies:** Unit 1 (revert is only safe once the gate tolerates node-null orphans)

**Files:**
- Modify: `.github/workflows/merge-data.yaml`

**Approach:**
- Remove `cp ../metadata/repos.yaml metadata/repos.yaml` from the `🔒 Block private wiki pages` step.
- Update the step comment to state `data` is authoritative and the gate tolerates dead orphans.

**Execution note:** none (workflow YAML).

**Patterns to follow:** existing two-checkout structure in `merge-data.yaml` (lines 31-47).

**Test scenarios:** Test expectation: none — workflow config change. Validate via `actionlint` and a manual/dispatch promotion run (covered by R6 verification).

**Verification:** `merge-data.yaml` no longer references `cp`; the gate step runs against the `data` checkout.

- [x] **Unit 3: Documentation — sole-writer model + privacy boundary**

**Goal:** Document that `repos.yaml` is written only on `data`, that redacted private entries are allowed on `main`, and the residual-risk statement for a bare node_id.

**Requirements:** R7 (policy), supports R6

**Dependencies:** None (can land with Unit 1-2)

**Files:**
- Modify: `metadata/README.md`
- Modify: `knowledge/schema.md` (reinforce public-only / data-authoritative invariant if not already stated)

**Approach:**
- State plainly: `metadata/repos.yaml` is written only on `data`; `main` never edits it outside the promotion PR.
- Document that redacted private entries (`name: <node_id>`, `private: true`) are allowed on `main` and must not be deleted as hygiene.
- Include the residual-risk statement: a bare node_id exposes existence + timing, never canonical identity or content.

**Patterns to follow:** existing `metadata/README.md` credential/authority tables; origin doc "Privacy Boundary" section.

**Test scenarios:** Test expectation: none — documentation. Markdown lint must pass.

**Verification:** README and schema reflect the sole-writer model; no claim that private entries must be curated off `main`.

- [x] **Unit 4: Safety net — fail/alert on a born-conflicted promotion PR**

**Goal:** `merge-data-pr.ts` surfaces a DIRTY/CONFLICTING promotion PR loudly instead of reporting clean success.

**Requirements:** R5

**Dependencies:** None (independent of Unit 1-3)

**Files:**
- Modify: `scripts/merge-data-pr.ts`
- Test: `scripts/merge-data-pr.test.ts`

**Approach:**
- After find-or-create, reuse `waitForKnownMergeableState` to resolve `mergeable_state` past `unknown`.
- If the resolved state is `dirty`/`conflicting`, set a non-clean outcome: open (or reuse) a high-signal alert issue AND signal failure (non-zero exit from `main()` or an explicit `conflicted: true` flag the workflow checks). Decide both-vs-one per origin Q3 (lean both).
- Mirror the existing `maybeCreateStaleDivergenceAlert` dedup pattern so repeated runs don't spam issues.

**Execution note:** Test-first — add the DIRTY-result scenario with a mocked Octokit before changing `mergeDataPr`.

**Patterns to follow:** `maybeCreateStaleDivergenceAlert` (lines 335-384) for dedup + issue creation; `waitForKnownMergeableState` (lines 276-298); `MergeDataPrResult` shape (lines 28-35).

**Test scenarios:**
- Happy path: clean mergeable PR → result reports success, no alert.
- Error path: `mergeable_state: 'dirty'` → alert issue created + non-clean signal.
- Edge case: `mergeable_state` stays `unknown` after retries → existing behavior preserved (warn, no false alarm).
- Edge case: alert issue already open → no duplicate (dedup).
- Integration: a DIRTY result sets the field the workflow step inspects to fail the run.

**Verification:** a simulated born-conflicted PR causes a non-clean outcome + alert; a clean PR does not.

- [x] **Unit 5: (Conditional) Intent-based authority guard for `repos.yaml` on `main`**

**Goal:** Code-enforce that a `repos.yaml` change on a PR to `main` only originates from the `data` promotion — the enforcement of Unit 3's documented invariant.

**Requirements:** Supports R6 (prevents future both-sides mutation)

**Dependencies:** Unit 3 (documents the policy this enforces)

**Files:**
- Modify: `scripts/check-wiki-authority.ts`
- Test: `scripts/check-wiki-authority.test.ts`

**Approach:**
- Extend the existing author-identity guard so a `metadata/repos.yaml` modification on a non-promotion PR (head ≠ `data`) is rejected even when authored by a fro-bot identity.
- Allow the change when the PR head is `data` (the promotion path).

**Execution note:** Test-first.

**Patterns to follow:** existing `check-wiki-authority.ts` path-guard + author checks.

**Test scenarios:**
- Happy path: `data → main` promotion PR touching `repos.yaml` → allowed.
- Error path: a non-`data` PR (even fro-bot-authored) touching `repos.yaml` → blocked.
- Edge case: a non-`data` PR touching other `metadata/*.yaml` → existing behavior unchanged.

**Verification:** the guard blocks the exact both-sides-mutation path (#3394-style edit on `main`) that started this.

> **Unit 5 gating:** This unit is the code enforcement of Unit 3's policy. Per origin Q5, the decision is to **include it** unless the user prefers a separate follow-up — without it, change #3 is documentation-only and a future `main`-side edit silently reintroduces the conflict class. Confirmed in the handoff question.

## System-Wide Impact

- **Interaction graph:** `merge-data.yaml` → `check-wiki-private-presence.ts` (gate) + `merge-data-pr.ts` (PR open). `check-wiki-authority.ts` runs as a PR-time required check on `main`.
- **Error propagation:** gate `subprocess-threw` → blocks promotion (fail closed). Safety-net DIRTY → alert + fail. Both surface to the operator, not silent.
- **State lifecycle risks:** `bootstrapDataBranch` re-seeding `data` from `main` copies exact content (no divergence) — the sole-writer invariant holds across data-branch recreation.
- **API surface parity:** none — internal control-plane only.
- **Integration coverage:** a real promotion run (R6) is the cross-layer proof unit tests can't give; validate via manual `merge-data.yaml` dispatch after Units 1-2 land.
- **Unchanged invariants:** redaction posture (private = `name: <node_id>`), `commitMetadata` main-write refusal, survey-side visibility gate, additive-only wiki contract — none change.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Inversion over-flags a legitimately public page (public entry missing from `data`'s `repos.yaml`) | Build the allowlist from the same `data` `repos.yaml` the promotion carries; a missing public entry is itself a data-integrity signal worth surfacing. Test the unattributable-page boundary explicitly. |
| Unit 2 reverted before Unit 1 lands → node-null orphan re-blocks promotion | Enforce dependency: Unit 2 sequenced after Unit 1 in the same PR. |
| Safety net (Unit 4) spams alert issues | Reuse `maybeCreateStaleDivergenceAlert` dedup pattern. |
| Unit 5 blocks a legitimate emergency `main` hotfix to `repos.yaml` | Document an explicit override path (PR title marker or temporary guard bypass) in Unit 3 docs. |

## Documentation / Operational Notes

- After Units 1-2 merge, validate with a manual `merge-data.yaml` dispatch (the data branch will have been recreated by then via the next autonomous run or bootstrap).
- The 2 private orphans deleted from `main` (PR #3394) are not re-added; reconcile re-probes them naturally, and the tolerant gate handles them if dead.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-01-data-branch-sole-writer-requirements.md](docs/brainstorms/2026-06-01-data-branch-sole-writer-requirements.md)
- Related code: `scripts/check-wiki-private-presence.ts`, `scripts/merge-data-pr.ts`, `.github/workflows/merge-data.yaml`, `scripts/check-wiki-authority.ts`
- Related PRs: #3394 (orphan deletion, policy reverted here), #3395 (cp workaround, reverted here), #3396 (the conflicted promotion, merged manually)
- Related plan: `docs/plans/2026-05-05-002-feat-private-repo-handling-plan.md` (Unit 8 owns private-page-removal-as-check)
