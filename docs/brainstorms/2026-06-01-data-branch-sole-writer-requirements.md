# Make `data` the Sole Writer of `metadata/repos.yaml`

**Date:** 2026-06-01
**Status:** Requirements
**Scope:** Standard (architectural — state ownership + privacy-gate robustness)

## Problem

The weekly `data → main` promotion (PR #3396) was born with a merge conflict in `metadata/repos.yaml`. Diagnosis confirmed the conflict is not a wiki problem — all 38 `knowledge/**` files auto-merge cleanly. The single conflicting file, `metadata/repos.yaml`, was mutated on **both** branches since the merge-base:

- On `data`: 43 autonomous survey write-backs advancing `last_survey_at`/`last_survey_status` + new repo entries (all public).
- On `main`: PR #3394 *deleted* two redacted private-repo orphan entries.

That both-sides mutation is the proximate cause. But it is itself a **workaround for a deeper problem**, revealed by the comment at `.github/workflows/merge-data.yaml:39-40`:

> "Use main's metadata/repos.yaml as the authoritative private-repo list so stale orphan entries on the data branch cannot block the privacy gate."

The real root cause: **`scripts/check-wiki-private-presence.ts` fails closed on *any* unresolvable private entry**, including `node-null` (the repo was deleted or the App lost access). A single dead private repo on `data` makes `resolveCanonicalSlugs` throw, which blocks every promotion. Two PRs were written to work around that brittleness:

- **PR #3395** pointed the privacy gate at `main`'s `repos.yaml` (via `cp ../metadata/repos.yaml`) so curated-clean main data wouldn't carry orphans.
- **PR #3394** deleted the orphan entries from `main` to keep that copy clean.

Together those two workarounds turned `repos.yaml` into a both-sides-mutated file and produced the #3396 conflict. There is one root problem (a brittle fail-closed gate), not two.

## The Decision

**Remove the second writer instead of splitting state or building merge-resolution machinery.**

The privacy posture already redacts private repos (`name: <node_id>`, never canonical identifiers), so a redacted private entry on `main` is — by design — not a leak. There is therefore no reason to curate private entries off `main`, and no reason for `main` to ever edit `repos.yaml` independently. Once `data` is the sole writer:

- `main`'s `repos.yaml` is updated **only through the promotion PR**. The one exception is `bootstrapDataBranch` re-seeding `data` from `main` after a squash-merge deletes the `data` ref — but that copies `main`'s exact content onto a fresh `data`, so it introduces no divergence (data starts equal to main, then only data advances). The no-both-sides-mutation property holds as long as nothing edits `repos.yaml` on `main` outside the promotion PR.
- No independent `main` edits ⇒ no both-sides mutation ⇒ **the conflict class is eliminated**, with no file split and no "data wins" resolution logic. This property is a *policy* invariant (nothing should edit `repos.yaml` on `main` except the promotion PR), not a structural guarantee — see change #4 for the safety net that makes a violation loud, and Q5 for whether to enforce it in code.

This is preferred over the two alternatives surfaced during diagnosis:

- **Splitting `repos.yaml`** into data-state + main-policy files (Oracle fix #1) — unnecessary once `main` stops editing the file; adds a schema migration and a second file for no benefit.
- **Auto-resolving the conflict** in `merge-data-pr.ts` (Oracle fix #3) — unnecessary once there is no conflict to resolve.

## Scope (the change set)

### 1. Make the privacy gate tolerate `node-null` (the root fix)

`scripts/check-wiki-private-presence.ts` — `resolveCanonicalSlugs`:

- A `node-null` result means the repo is deleted or the App lost access. The current gate fails closed on it, which is the brittleness that triggered the workarounds. The fix must stop node-null from blocking promotion **without losing leak coverage**.
- **Critical coverage gap to close (reviewer-flagged P1):** the node-id-match sweep only catches files literally named `<node_id>.md`. Wiki pages are named by canonical slug `<owner>--<repo>.md`. So naively "skip slug resolution, keep node-id sweep" would LOSE detection of a stale `<owner>--<repo>.md` page for a repo that was surveyed while public, then went private, then was deleted (now `node-null`, slug unresolvable via GraphQL). The node-id sweep does not cover that file. This is a privacy regression, not benign orphan cleanup.
- Therefore node-null handling MUST retain canonical-slug leak coverage. Candidate mechanisms (planning decides): (a) cache the last-known canonical slug on the entry when first resolved, so node-null entries still carry a slug to sweep; (b) treat node-null as warn-and-continue only when NO wiki page could plausibly match, else fail closed; (c) sweep every `knowledge/wiki/repos/*.md` filename against the node-null private set using any retained identifier. The point: a deleted private repo must not be able to leave a slug-named page behind undetected.
- Keep fail-closed behavior **only** for `subprocess-threw` (network / rate-limit / auth) — those are genuinely unverifiable and must block, with a retry on the next run.

Net effect: stale/dead private orphans on `data` no longer *block* promotion, but their slug-named leak surface stays covered. Genuine transport uncertainty still fails closed.

### 2. Revert the `cp` workaround in `merge-data.yaml`

`.github/workflows/merge-data.yaml` — `🔒 Block private wiki pages` step:

- Remove `cp ../metadata/repos.yaml metadata/repos.yaml`. The gate reads `data`'s own `repos.yaml` again (the branch being promoted is the correct source for "what private entries does this promotion carry?").
- Update the step comment to reflect that `data` is authoritative and the gate tolerates dead orphans.
- **Sequencing:** this revert is only safe *after* change #1 lands, because the `cp` exists precisely to dodge the fail-closed-on-orphan behavior.

### 3. Stop curating private entries off `main` (policy + docs)

- Document that redacted private entries (`name: <node_id>`, `private: true`) are allowed on `main` and must not be deleted as "hygiene." PR #3394's deletion was an unnecessary workaround.
- No need to re-add the two already-deleted entries — `data` will re-introduce them through normal reconcile probing if those repos are still accessible; if they are dead, the now-tolerant gate handles them.
- Update `metadata/README.md` to state plainly: `metadata/repos.yaml` is written **only** on `data`; `main` never edits it outside the promotion PR.

### 4. Safety net — fail loud on a born-conflicted promotion PR (Oracle fix #2)

`scripts/merge-data-pr.ts`:

- After find-or-create, check the resulting PR's mergeability. If it is `DIRTY`/`CONFLICTING`, do not let the workflow report a clean `success` — surface it (non-zero exit or a high-signal alert issue) so a conflicted promotion can never again accumulate silently behind a green check.
- This is defense-in-depth and is **not** scope creep: the sole-writer property (change #1-3) is a policy invariant, not a structural guarantee. A future emergency hand-edit on `main`, a bootstrap-recovery edge case, or any non-promotion writer can violate it. When that happens the conflict must be loud immediately rather than discovered weeks later (the exact failure mode that hid #3396 behind a 27/76 divergence). The reviewer tension here — "conflict should be impossible, so #4 is creep" vs "the premise isn't airtight, so #4 is required" — resolves in favor of keeping #4 precisely because the invariant is enforced by policy, not by structure.

## Non-Goals

- **No file split.** `metadata/repos.yaml` stays one file. (Revisit only if `main` ever genuinely needs to edit repo identity/policy independently of `data` — not foreseen.)
- **No bespoke YAML merge engine** in `merge-data-pr.ts`. Removing the second writer removes the need.
- **No change to the survey-side privacy gate** (`survey-repo.yaml` visibility recheck). That remains the primary gate; `check-wiki-private-presence.ts` is defense-in-depth.
- **No change to the redaction posture.** Private repos stay redacted as `name: <node_id>`; this work does not relax that.
- **No `removeRepoEntry` helper.** It was only needed for the manual orphan-deletion path we are eliminating.

## Success Criteria

- **SC1**: A private repo entry on `data` whose `node_id` resolves to `node-null` (deleted/lost-access) does **not** block the weekly promotion; the gate skips its slug resolution but still runs the node-id-match sweep.
- **SC2**: A private entry whose resolution fails with a transport/auth error (`subprocess-threw`) **still** blocks the gate (fail-closed preserved).
- **SC3**: `merge-data.yaml` no longer copies `main`'s `repos.yaml`; the gate reads the `data` checkout and passes for a clean promotion.
- **SC4**: A simulated born-conflicted promotion PR causes `merge-data-pr.ts` to fail/alert rather than report success.
- **SC5**: Two consecutive weekly promotions complete with `repos.yaml` changing only on `data` (no `main`-side edits), producing no conflict.
- **SC6**: A redacted private entry present on `data` promotes to `main` without being stripped, and `check-wiki-private-presence.ts` reports no leak for it (redaction ≠ leak).

## Privacy Boundary (residual-risk statement)

The sole-writer model leaves redacted private entries (`name: <node_id>`, `private: true`) on the public `main` branch. This is an explicit, auditable trust decision, not an oversight:

- **What a bare `node_id` exposes:** that *a* private repo exists in fro-bot's access graph, plus a stable opaque identifier. GitHub node_ids are opaque, non-enumerable, and resolving one to `owner/repo` requires API access that itself gates on the repo's privacy. A reader without that access learns only "some private repo, identified by an opaque token, exists."
- **Residual correlation risk (accepted):** the node_id is stable across branches, commits, and workflow artifacts, so an observer could correlate the same private repo across those public surfaces over time, and infer lifecycle events (added/surveyed/removed dates). This is judged acceptable: it reveals existence and timing, never canonical identity or content.
- **What stays protected:** canonical `owner/repo`, repo name, and all wiki content. The redaction posture (change does not relax it) keeps those off `main`.
- **Defense-in-depth note:** the promotion privacy gate now reads `data`'s own `repos.yaml` (change #2). Since `data` is the sole writer and is only writable by the fro-bot identity, the gate trusts the same identity that produced the content. This is an accepted trust boundary for v1; an independently-anchored private-id source is deferred (see Q6) unless the threat model tightens.

## Open Questions for Planning

- **Q1**: `detectPrivateWikiLeaks` already runs both canonical-slug and node-id matches. Confirm the cleanest way to feed `node-null` entries into the node-id sweep while excluding them from slug resolution — likely `resolveCanonicalSlugs` returns resolved + a separate `nodeNullEntries` list, and `main()` passes both into the detector (resolved → slug+node-id checks; node-null → node-id check only). Planning settles the exact shape and the return type change.
- **Q2**: Test strategy for the gate change — unit-test `resolveCanonicalSlugs` classification (node-null tolerated, subprocess-threw throws) with mocked `execFileSync`, and `detectPrivateWikiLeaks` with node-null entries in the node-id sweep. No live GraphQL in CI.
- **Q3**: For the safety net (#4), does `merge-data-pr.ts` poll for mergeability (it can be `unknown` immediately after create — there is already a `waitForKnownMergeableState` helper) before deciding DIRTY? Reuse that helper. Decide fail-the-run vs. open-an-alert-issue (or both).
- **Q4**: Sequencing within a single PR vs. split PRs — changes #1 and #2 are coupled (revert is unsafe before the gate fix). Likely one PR for #1+#2+#3, a separate PR for #4 (independent). Planning confirms.
- **Q5**: `check-wiki-authority.ts` currently guards `metadata/*.yaml` by author identity. Should it additionally assert that a `repos.yaml` change on a PR to `main` only ever originates from the `data` promotion (intent-based guard, Oracle fix #5)? This is the code enforcement of the policy invariant that change #3 only documents — without it, change #3 is documentation-only and a future `main`-side edit can silently reintroduce the conflict class. Decide: bundle the guard into this work, or ship it as an explicit follow-up hardening item (not leave it as an open question).
- **Q6**: Independent privacy source of truth. The gate trusting `data`'s own `repos.yaml` (change #2) is an accepted v1 trust boundary. If the threat model ever requires the gate to validate against a source the promoted branch cannot itself edit, that is a separate design. Confirm v1 accepts the current boundary.
- **Q7**: Sole-writer commitment vs. reversibility. The model forecloses `main` editing `repos.yaml` independently. If `main`-side repo *policy* (distinct from survey *state*) is ever needed, the split becomes necessary after all. Planning should note the migration path back to split state ownership stays open (it does — the split is strictly additive later), so this is a low-cost, reversible commitment rather than a one-way door.

## Related Work

- **PR #3396** — the conflicted promotion that triggered this; resolved manually via two Fro Bot-identity agent dispatches (orphan removal + data-wins merge), merged at `37618e5`.
- **PR #3394** — deleted the two private orphans from `main`; this work reverts that *policy* (the entries themselves stay gone).
- **PR #3395** — pointed the gate at `main`'s `repos.yaml`; this work reverts that `cp`.
- **`scripts/check-wiki-private-presence.ts`** — the fail-closed gate at the center of the root cause.
- **`scripts/commit-metadata.ts:345`** — already refuses writes to `main`; reinforces that `data` is the only programmatic writer.
- **`docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`** — the primary (survey-side) privacy gate that makes `check-wiki-private-presence.ts` defense-in-depth.
- **Oracle diagnosis (2026-06-01)** — proposed file-split (fix #1) + fail-on-dirty (fix #2); this brainstorm adopts a simpler root fix that subsumes #1 and keeps #2 as the safety net.
