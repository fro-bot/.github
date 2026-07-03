---
date: 2026-07-03
topic: wiki-authority-repair-loop
title: Wiki authority repair loop
---

# Wiki authority repair loop

## Summary

Close the detect→issue→wait-for-human gap for the knowledge wiki's deterministic failure
classes. When a completed wiki-lint scan reports repairable findings, a repair job regenerates
the affected surfaces — index regeneration and strictly mechanical frontmatter fixes —
verifies the repair clears the finding, and commits it to the `data` branch through the existing
atomic-commit envelope. The promotion pipeline carries it to `main`; wiki-lint's close-on-clear
confirms the fix on the next scan. No new write authority is created.

---

## Problem Frame

Wiki-lint detects seven failure classes and turns the deterministic ones into fingerprinted
issues with a full lifecycle — but repairs zero of them. Index drift and orphan pages are fixed
by regenerating `knowledge/index.md` and `knowledge/log.md` from the wiki pages, an operation the
bot already performs autonomously on every ingest and that `rebuild-wiki-index.ts` exposes as a
manual healer. The gap is purely a trigger: the same regeneration the bot runs ungated during
writes sits behind a human when lint finds drift.

The A2 portfolio named metadata/wiki authority repair as the deferred second surface after
status truth. Status truth built the proposal-first posture for judgment claims; this slice is
the complementary case — repairs that are deterministic regenerations need no proposal gate,
they need the existing operation wired to the existing detector.

---

## Actors

- A1. Marcus: reviews the weekly promotion PR (or the auto-merged knowledge-only PR), handles
  judgment-class lint issues, and can dispatch on-demand healing.
- A2. Fro Bot: detects via wiki-lint, repairs deterministic findings, commits to `data`, and
  closes lint issues via the existing close-on-clear when the fix lands.
- A3. Promotion pipeline: existing `data → main` gates (private-presence, private-leak,
  merge PR with knowledge-only auto-merge) — unchanged, load-bearing.

---

## Key Flows

- F1. Post-lint auto-repair
  - **Trigger:** A completed wiki-lint scan reports at least one repairable deterministic
    finding.
  - **Actors:** A2, A3
  - **Steps:** The repair job regenerates the affected surfaces, re-lints locally to verify the
    findings clear, commits once to `data` through the atomic-commit path, and records
    counts-only telemetry. The next scheduled lint scan closes the corresponding issues via
    close-on-clear.
  - **Outcome:** Deterministic wiki drift heals without operator action; issue lifecycle
    confirms it.
  - **Covered by:** R1, R2, R3, R5, R6, R7, R8, R9
- F2. Manual healing dispatch
  - **Trigger:** Marcus dispatches the repair workflow on demand.
  - **Actors:** A1, A2
  - **Steps:** Same repair path as F1, same bounds, same verification.
  - **Outcome:** On-demand healing without shell access or local scripts.
  - **Covered by:** R4
- F3. Non-repairable finding
  - **Trigger:** Lint reports a judgment-class finding (broken wikilink, stale claim, missing
    cross-reference, knowledge gap) or a frontmatter defect outside the mechanical allowlist.
  - **Actors:** A2
  - **Steps:** The finding follows the existing issue lifecycle untouched; the repair job counts
    it as out-of-scope and does not modify the page.
  - **Outcome:** Judgment work stays human-owned; the repair loop cannot creep into prose.
  - **Covered by:** R2, R10

---

## Requirements

**Repair classes and bounds**

- R1. The repair loop owns exactly two repair operations in v1: (a) regeneration of
  `knowledge/index.md` from the wiki pages (covering index-drift and orphan-page findings) via
  the existing `rebuildWikiIndex` logic, and (b) mechanical frontmatter repair on wiki pages.
  `knowledge/log.md` is not regenerated from pages — it is an append-only log with a separate
  merge-heal operation — and is out of scope for v1 repair.
- R2. Mechanical frontmatter repair is bounded by an explicit field allowlist: a field is
  repairable only when its correct value is computable from the page's filename or existing
  content alone, per the schema in `knowledge/schema.md`. The v1 allowlist is `type` (derived
  from the page's directory) and `title` only when the page carries a canonical H1 to copy;
  `created`, `updated`, `sources`, `tags`, `aliases`, and `related` are explicitly excluded. Any
  field requiring judgment is out of scope and follows the existing issue lifecycle. Planning
  validates the allowlist against the live corpus and may shrink — never grow — it.
- R3. The repair job runs as part of the wiki-lint workflow after a completed scan reporting
  repairable findings, and produces at most one repair commit per run covering all repairable
  findings from that scan.
- R4. A manual dispatch path runs the identical repair pipeline with identical bounds.

**Verification and fail-closed behavior**

- R5. Before committing, the repair job re-runs wiki-lint against the repaired working tree and
  requires every targeted finding to clear; if any targeted finding persists, the job aborts
  without committing and reports the abort as a distinct count. Verification and commit key off
  the same tree: the repair job loads the current `data` tip, re-derives repairable findings by
  linting that tree (the report is the trigger, not the source of truth), repairs, verifies, and
  commits with that tip as parent — a repair never verifies against one tree and commits onto
  another. Verification also fails if the repaired tree introduces any new deterministic finding
  absent from the pre-repair tree.
- R5b. Before any `data` commit, the repaired tree passes the same private-presence checks the
  promotion pipeline enforces, using the authority metadata (`metadata/repos.yaml`) from the
  current `data` tip — never a stale snapshot — so a redaction that landed after detection still
  gates the repair. Any would-be introduction or resurrection of a private repo identifier on
  the public branch aborts with a counted failure. The `data` branch is publicly readable —
  promotion-time gating alone is too late.
- R6. Repairs never run against an incomplete or failed lint scan; scan-execution failures
  produce no repair activity.
- R7. A repair that would modify any path outside `knowledge/` is refused at execution time;
  `metadata/*.yaml` and all non-knowledge surfaces are structurally out of scope.

**Write path and authority**

- R8. Repair commits go exclusively to the `data` branch through the existing atomic-commit
  envelope (`wiki-ingest`-style Git data API commit), and reach `main` only via the existing
  promotion pipeline. The repair loop never pushes to `main` or any other branch. The lint
  workflow's current mint is read-only for contents, so the repair step mints its own
  least-privilege token (`contents: write`, repo-scoped) inside the repair job only; issue-sync
  and detection jobs never hold write credentials, and the workflow's schedule/dispatch-only
  trigger model is a stated precondition for hosting a writer.
- R8b. Repair commit messages use a fixed template that may carry at most aggregate counts and
  the fixed operation name — never page slugs, filenames, titles, or repo names. A constant
  message satisfies this. Commit messages on `data` are public surfaces.
- R9. On a data-branch ref conflict (concurrent ingest), the repair job re-fetches the new tip,
  recomputes the regeneration against it, re-verifies, and retries; it never blind-retries a
  stale computation. If recomputation finds the targeted findings already cleared by the
  intervening commit, the job exits as a counted no-op without committing. Retry exhaustion
  aborts with a counted failure.

**Telemetry and lifecycle**

- R10. Telemetry is counts-only: repairable findings seen, repairs applied, aborts,
  out-of-scope findings, conflict retries — no paths, slugs, fingerprints, or page titles in
  workflow summaries or logs.
- R11. The repair loop does not open, close, or comment on lint issues directly; issue closure
  happens exclusively through wiki-lint's existing close-on-clear on the next completed scan.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R5, R8.** Given a completed lint scan reporting index-drift, when the
  repair job runs, it regenerates the index from the pages, verifies the finding clears, and
  lands exactly one commit on `data`; the next scan closes the issue.
- AE2. **Covers R2.** Given a wiki page whose frontmatter slug field is missing but derivable
  from its filename, when the repair job runs, the field is restored; given a page with a
  missing title requiring judgment, the page is untouched and the finding stays issue-only.
- AE3. **Covers R5.** Given a repair whose re-lint still reports the targeted finding, when
  verification runs, no commit is created and the abort is counted.
- AE4. **Covers R6.** Given a lint scan that failed or is incomplete, when the workflow
  evaluates the repair job, no repair activity occurs.
- AE5. **Covers R7.** Given a hypothetical repair computation that touches a path outside
  `knowledge/`, when the job validates its changeset, the write is refused and counted.
- AE6. **Covers R9.** Given an ingest commit lands on `data` between the repair's read and
  write, when the commit conflicts, the job recomputes against the new tip and retries; the
  final commit reflects the post-ingest state.
- AE7. **Covers R10, R8b.** Given any repair run, when its summary and commit message render,
  they contain only counts and fixed template text.
- AE8. **Covers R11.** Given a repair run that fixes a finding with an open lint issue, when the
  run completes, the issue is untouched — no comment, no close — and closes only via the next
  completed scan's close-on-clear.
- AE9. **Covers R5b.** Given a regeneration whose output would reintroduce a redacted private
  slug into `knowledge/index.md`, when the pre-commit privacy check runs, no commit is created
  and the abort is counted.

---

## Success Criteria

- Index-drift and orphan-page lint issues stop requiring operator action: they open, a repair
  lands, and close-on-clear resolves them within one lint cycle when the promotion diff is
  knowledge/metadata-only (auto-merge); when unrelated code changes sit on `data`, the repair
  still lands but promotion — and therefore closure — waits for the human-reviewed promotion PR,
  which is accepted latency, not failure.
- The mechanical-frontmatter allowlist produces zero judgment edits — no repair commit ever
  changes prose, titles, or topics.
- Every repair commit rides the existing promotion pipeline unchanged, auto-merging when
  knowledge-only.
- A dispatch-run rehearsal on a fixture-drifted wiki demonstrates regenerate → verify → commit →
  close-on-clear end to end.

---

## Scope Boundaries

- No repair of judgment classes: broken-wikilink, stale-claim, missing-cross-reference,
  knowledge-gap.
- No `metadata/*.yaml` writes — reconcile-repos owns metadata drift.
- No changes to wiki-lint detection, the issue lifecycle, promotion gates, or ingest.
- No proposal-issue machinery for repairs — deterministic regenerations ride the existing
  write envelope; judgment repairs (if ever) would be a separate graduated slice.
- No new schedules; detection cadence is repair cadence.
- No LLM/generative content in any repair — regeneration and derivation only.

---

## Key Decisions

- **Repair rides the existing envelope:** the bot already regenerates index/log ungated during
  ingest; wiring the same operation to the lint trigger creates no new authority, so the
  proposal-first posture status truth needed for judgment claims would be pure ceremony here.
- **Verify-before-commit is the safety primitive:** re-linting the repaired tree and requiring
  the targeted findings to clear turns "the repair worked" into a precondition instead of a
  hope.
- **Mechanical means computable:** the frontmatter allowlist is defined by derivability from
  filename/content, drawn from `knowledge/schema.md` — a bright line that keeps the loop out of
  prose.
- **Issue lifecycle stays owned by lint:** the repair loop writes pages, never issue state;
  close-on-clear remains the single source of issue truth and doubles as end-to-end
  verification.
- **One commit per run:** bounded blast radius, reviewable promotion diffs, deterministic
  telemetry.

---

## Dependencies / Assumptions

- `rebuildWikiIndex` (exported from `wiki-ingest.ts`; `rebuild-wiki-index.ts` is its CLI
  wrapper) and `wiki-ingest.ts`'s atomic Git-data commit path (with conflict retry) are the
  reuse seams.
- Wiki-lint runs against files on disk and already records `snapshot_sha` from `origin/data`,
  so working-tree re-lint verification and snapshot pinning are supported; the workflow's
  current checkout/restore step is the place the repair job inherits its tree.
- The lint workflow triggers are schedule and manual dispatch only (no PR-triggered runs) — a
  precondition for hosting a write-capable repair job.
- The promotion pipeline's knowledge-only auto-merge continues to treat repair commits like
  ingest commits.
- Assumption (labeled): wiki-lint's finding classification is precise enough that "repairable"
  can be computed from the report JSON alone; if repairability needs page inspection, the
  repair job derives it locally without widening lint.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R2][Technical] The exact mechanical-frontmatter field allowlist from
  `knowledge/schema.md` — which fields are derivable in practice on the current corpus?

### Deferred to Planning

- [Affects R3][Technical] Whether the repair job is a new job in the wiki-lint workflow or a
  called reusable workflow.
- [Affects R8][Technical] Extract regeneration from `rebuild-wiki-index.ts`/`wiki-ingest.ts`
  into a shared module vs invoke as-is.
- [Affects R10][Technical] Result JSON shape and summary rendering, mirroring the status-truth
  counts pattern.

---

## Sources / Research

- A2 portfolio requirements: `docs/brainstorms/2026-06-26-a2-self-maintenance-portfolio-requirements.md`
- Detection and lifecycle: `scripts/wiki-lint.ts`, `scripts/wiki-lint-issues.ts`
- Regeneration and write primitives: `scripts/rebuild-wiki-index.ts`, `scripts/wiki-ingest.ts`,
  `scripts/commit-metadata.ts`
- Authority model: `scripts/check-wiki-authority.ts`, `.github/workflows/merge-data.yaml`,
  `metadata/README.md`
- Related learnings: `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`,
  `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`
