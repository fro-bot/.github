---
title: 'feat: Wiki authority repair loop'
type: feat
status: complete
completed: 2026-07-03
date: 2026-07-03
origin: docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md
---

# feat: Wiki authority repair loop

## Overview

Close the detect→issue→wait-for-human gap for the knowledge wiki's deterministic failure
classes. A new repair module regenerates `knowledge/index.md` (index-drift, orphan-page) and
applies a two-field mechanical frontmatter allowlist (`type` from directory, `title` from
canonical H1), verifies against the same tree it commits onto — the current `data` tip — with a
no-new-findings rule, gates the repaired tree through the private-presence check using
current-tip authority metadata, and commits once to `data` through the existing atomic-commit
envelope. Issue closure stays owned by wiki-lint's close-on-clear.

## Problem Frame

Wiki-lint detects seven failure classes and repairs none. Index regeneration is an operation the
bot already performs ungated during every ingest; `rebuild-wiki-index.ts` exposes it manually.
The gap is a trigger, not an authority: deterministic drift sits behind a human for no safety
gain (see origin: `docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md`).

## Requirements Trace

From the origin document: R1 (index regeneration only; log out of scope), R2 (frontmatter
allowlist: `type`, `title`-from-H1; shrink-only), R3–R4 (post-lint auto + manual dispatch, one
commit per run), R5/R5b (verify-and-commit on the same current-tip tree, no-new-findings rule;
pre-commit private-presence gate with current-tip repos.yaml), R6 (no repair on incomplete
scans), R7 (knowledge/-only writes, refusal at execution time), R8/R8b (data-branch-only atomic
commit, repair-job-only write mint, fixed identity-free commit message), R9
(recompute-on-conflict, no-op semantics), R10 (counts-only telemetry), R11 (no issue-state
writes).

## Scope Boundaries

- No repair of judgment classes: broken-wikilink, stale-claim, missing-cross-reference,
  knowledge-gap.
- `knowledge/log.md` is not regenerated (append-only; separate merge-heal op, out of v1).
- No `metadata/*.yaml` writes; no changes to wiki-lint detection, issue lifecycle, promotion
  gates, or ingest.
- No proposal machinery; no new schedules; no LLM/generative content in repairs.

### Deferred to Separate Tasks

- Log merge-heal automation (the `--merge-logs` operation) if conflict damage recurs.
- Any allowlist growth beyond `type`/`title` — requires a new reviewed requirements pass.

## Context & Research

### Relevant Code and Patterns

- `scripts/wiki-lint.ts` — report contract: `WikiLintJsonReport` (`scan_complete`,
  `snapshot_sha`, `repair_eligible`, `failure_class`, findings with
  `kind/severity/path/target/message/fingerprint`). `orphan-page`: path=page, target=null;
  `index-drift`: path=`knowledge/index.md`, target=missing slug. `splitFrontmatter` +
  required-field checks produce `missing-frontmatter`/`invalid-frontmatter`.
- `scripts/wiki-ingest.ts` — reuse seams: `rebuildWikiIndex({existingIndex?, wikiFiles})` →
  new index string, in-memory, preserves header/footer prose; `commitWikiChanges({owner?, repo?,
  branch?, message, files, octokit?, maxRetries?})` — atomic blob/tree/commit + ref update with
  conflict retry and `CONFLICT_EXHAUSTED`; `parseFrontmatter` (strict); `pageTypeFromPath`
  (directory → type derivation).
- `scripts/check-wiki-private-presence.ts` — `detectPrivateWikiLeaks({dataWikiPages,
  publicSlugMap, grandfatherPages})` is a pure exported detector; the promotion workflow feeds
  it `metadata/repos.yaml`, the data checkout's `knowledge/wiki/repos`, and a grandfather dir
  from the main checkout (`merge-data.yaml`).
- `.github/workflows/wiki-lint.yaml` — schedule + dispatch only; job `wiki-lint` (contents:
  read) restores `knowledge/` from `origin/data` via `git restore --source FETCH_HEAD`, runs
  lint with `WIKI_LINT_REPORT_PATH`/`WIKI_LINT_JSON_PATH`/`WIKI_LINT_SNAPSHOT_SHA`, uploads
  `wiki-lint-report` artifact; job `wiki-lint-issue-sync` downloads it and mints
  `permission-issues: write` + `permission-contents: read`.
- `scripts/merge-data-pr.ts` `selectLabel()` — auto-merge only when every changed file is under
  `knowledge/` or `metadata/`.
- Test patterns: `wiki-lint.test.ts` `buildPage()`/`buildIndex()`/`buildCleanFiles()` file-map
  fixtures; `wiki-ingest.test.ts` `createWikiPage()`/`createOctokitMock()`;
  `rebuild-wiki-index.test.ts` `wikiPage()` tuples.

### Institutional Learnings

- `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`:
  lint findings must be tied to the authoritative data snapshot — the repair loop pins the same
  `snapshot_sha`.
- `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`:
  planner/shell independence, sentinel handling of untrusted file text.
- `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md`: the
  write mint lives only in the job that writes.
- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`: commit messages
  on a public branch are a public surface (R8b).
- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`: pure
  repair core, I/O shell.

## Key Technical Decisions

- **Pure core / thin shell, one new module:** `scripts/wiki-repair.ts` hosts a pure repair
  pipeline — `planWikiRepairs(report, wikiFiles)` → repair actions + repaired file map →
  `verifyWikiRepairs` (re-lint via the exported lint core against the repaired map) →
  `gateWikiRepairs` (`detectPrivateWikiLeaks` against the repaired map) — and a thin
  `runWikiRepair()` shell that loads the working tree, calls the pipeline, and commits via
  `commitWikiChanges`. No planner/shell trust: the shell re-checks the knowledge/-only path
  bound (R7) on the final file map before commit.
- **Report is trigger, tree is truth:** the lint report gates whether the repair job runs, but
  the job re-derives repairable findings by linting the tree it actually loads. This avoids
  betting correctness on report/tree lineage agreement. Repairable classes: `index-drift` and
  `orphan-page` map to one index regeneration; `missing-frontmatter`/`invalid-frontmatter` map
  to per-page frontmatter repair attempts that succeed only within the allowlist. Judgment
  classes count as out-of-scope. The workflow gate must key on deterministic repairable classes
  — the report's existing `repair_eligible` means only "complete scan with findings" and is too
  broad; the detect job computes a dedicated repairable-classes output.
- **Current-tip model (verify what you commit onto):** the shell fetches the current `data` tip,
  loads `knowledge/**` and `metadata/repos.yaml` from that tip, lints it (pre-repair baseline),
  repairs, re-lints (verification), gates, and commits with that tip as parent.
  `commitWikiChanges` reads `heads/data` at commit time; the shell compares the commit-time tip
  against the tip it verified and treats any movement as the R9 conflict path (full-pipeline
  recompute), so the job never silently commits onto unseen state even when no ref conflict
  fires.
- **No-new-findings verification:** verification fails not only when a targeted finding
  survives, but when the repaired tree contains any deterministic finding absent from the
  pre-repair baseline — a repair may not make the wiki worse. Partial frontmatter repairs whose
  page-level finding cannot fully clear (e.g. `created` still missing after `type` is fixed)
  make that page out-of-scope for this run: the page is reverted from the repair set and counted
  rather than aborting the whole run; the index regeneration and other pages proceed. Abort is
  reserved for repairs that fail verification, not for pages that were never fully repairable.
- **Frontmatter repair is parse-preserving:** repairs operate on the frontmatter block via the
  existing split/parse helpers; `type` derives from `pageTypeFromPath`; `title` copies the first
  `# ` heading verbatim (new bounded extractor) and repairs nothing when absent. Unparseable
  YAML that cannot be round-tripped safely is out of scope for v1 (counted, issue lifecycle
  unchanged) — rewriting broken YAML wholesale is judgment, not mechanics.
- **Pre-commit privacy gate uses current-tip authority:** the repair job wires
  `detectPrivateWikiLeaks` with repos.yaml from the current `data` tip (never a stale snapshot —
  a redaction landing after detection must still gate), repaired wiki pages, and grandfather
  pages from the main checkout (read-only input; main content never overwrites data content in
  the repair computation). Any leak → abort, counted (AE9).
- **Fixed commit message:** `chore(knowledge): repair wiki integrity findings` — constant
  string, nothing derived from page identity; counts live in the result JSON/summary. Satisfies
  R8b's at-most-counts-and-operation-name template.
- **Workflow: third job, own mint, mint-after-decision:** `wiki-repair` job in
  `wiki-lint.yaml`, `needs: wiki-lint`, `if:` gate on the detect job's dedicated
  repairable-classes output; dual checkout (main + current-data restore);
  `create-github-app-token` mint with `permission-contents: write` repo-scoped inside this job
  only, and the mint step itself is skipped on dry-run dispatches (least privilege: no write
  token exists on a run that cannot write). Manual dispatch reuses the same job via the
  existing workflow_dispatch trigger.

## Open Questions

### Resolved During Planning

- Lint core invocable against a working tree: yes — `lintWikiSnapshot` is exported and operates
  on a file map; the repair module lints baseline and repaired maps in-memory, no second
  checkout. Finding identity for baseline/verification comparison uses the same
  kind/path/target fingerprint inputs the report generator uses.
- The report's `repair_eligible` means only "complete scan with findings" — too broad for the
  job gate; the detect job computes a dedicated output from the deterministic repairable
  classes instead.
- Export surface: `splitFrontmatter` (wiki-lint) and `parseFrontmatter`/`pageTypeFromPath`
  (wiki-ingest) are currently unexported — exporting them (or narrowly re-hosting them in the
  repair module) is in-scope Unit 1 work.
- Write mint: new `permission-contents: write` mint inside the repair job only, skipped on
  dry-run — the brainstorm's R8 as amended.

### Deferred to Implementation

- Exact result JSON field names (mirror the status-truth counts pattern).
- Whether the H1 extractor tolerates leading HTML comments/blank lines before the first heading
  (characterize corpus; strictest viable rule wins).

## Implementation Units

- [x] **Unit 1: Pure repair core — planning, repair computation, verification, privacy gate**

**Goal:** The complete repair pipeline as pure functions over a report + file map.

**Requirements:** R1, R2, R5, R5b, R6, R7, R9 (no-op semantics), R10 (count classes)

**Dependencies:** None

**Files:**
- Create: `scripts/wiki-repair.ts`
- Create: `scripts/wiki-repair.test.ts`
- Modify: `scripts/wiki-ingest.ts` (export seams only, if any helper needs exporting)

**Approach:**
- `planWikiRepairs({baselineFindings, wikiFiles})`: takes the pre-repair lint result of the
  loaded tree (the shell lints the tree it loaded; the report artifact only gated job startup);
  partitions findings into repairable (index-drift, orphan-page → one index regeneration;
  missing/invalid-frontmatter → per-page allowlist attempts) and out-of-scope; computes the
  repaired file map via `rebuildWikiIndex` and the frontmatter repairers; pages whose finding
  cannot fully clear within the allowlist are reverted from the repair set and counted
  out-of-scope; every repaired path must be under `knowledge/` (refusal otherwise).
- Frontmatter repairers: `type` via `pageTypeFromPath`; `title` via a new strict first-`# `
  heading extractor (verbatim copy; absent → no repair). Unparseable YAML → out-of-scope count.
- `verifyWikiRepairs`: re-runs the lint core against the repaired map; every targeted finding
  must clear AND no deterministic finding absent from the baseline may appear; any survivor or
  regression → abort result (no partial commits).
- `gateWikiRepairs`: `detectPrivateWikiLeaks` over the repaired pages with snapshot repos.yaml +
  grandfather pages; any leak → abort result.
- No-op detection: if planning yields zero repairable findings or the repaired map equals the
  input map, return a counted no-op.

**Execution note:** Test-first; every drift matrix cell and count class is table-testable with
the existing file-map fixture patterns.

**Test scenarios:**
- Index-drift fixture → regenerated index clears the finding; verification passes (AE1 shape).
- Orphan-page fixture → same regeneration covers it.
- Missing `type` → derived from directory; missing `title` with H1 → copied verbatim; missing
  `title` without H1 → untouched, counted out-of-scope (AE2).
- `created`/`updated`/`tags` defects → never repaired regardless of derivability.
- Verification survivor (repair that doesn't clear its finding) → abort, no output map (AE3).
- Repair that clears its targets but introduces a new deterministic finding → abort (no-worse
  rule).
- Page missing `type` AND `created`: `type` fixed but finding can't clear → page reverted,
  counted out-of-scope; index regeneration still proceeds.
- Incomplete scan / failure_class set → no repair activity (AE4).
- Hypothetical repaired path outside `knowledge/` → refusal, counted (AE5).
- Privacy gate: repaired index reintroducing a redacted slug → abort, counted (AE9).
- Judgment-class findings → out-of-scope counts only, pages untouched (F3).
- Unparseable frontmatter YAML → out-of-scope, file byte-identical.

**Verification:**
- Module imports nothing from Octokit; pure functions only. `pnpm vitest run
  scripts/wiki-repair.test.ts` green.

- [x] **Unit 2: Repair shell — snapshot load, conflict retry, atomic commit, result JSON**

**Goal:** `runWikiRepair()` executes the pipeline against the real tree and commits to `data`.

**Requirements:** R3 (one commit per run), R8, R8b, R9, R10, R11

**Dependencies:** Unit 1

**Files:**
- Modify: `scripts/wiki-repair.ts`
- Modify: `scripts/wiki-repair.test.ts`

**Approach:**
- Load `knowledge/**` and `metadata/repos.yaml` from the current `data` tip (the workflow's
  restore step fetches origin/data at job start; the shell records the tip SHA it loaded);
  grandfather pages from the main checkout. Lint the loaded tree for the baseline.
- Run the pure pipeline; before committing, re-read `heads/data` and require it to equal the
  loaded tip — movement → conflict path. Commit once via `commitWikiChanges({branch: DATA_BRANCH
  (constant), message: FIXED_MESSAGE, files: repairedChangedFiles})` — changed files only, all
  under `knowledge/`; the branch is a module constant, never an input.
- Conflict path (tip moved or ref-update conflict): re-fetch the new data tip, reload the tree,
  re-run the FULL pipeline (baseline lint, plan, verify, gate), retry bounded times; recompute
  finding nothing to fix → counted no-op exit (AE6). Retry exhaustion → counted abort.
- Result JSON to `WIKI_REPAIR_RESULT_PATH`: counts only (repairable_seen, repaired, aborted,
  out_of_scope, privacy_blocked, conflict_retries, noop) + `dry_run` marker; stdout mirrors it.
  `WIKI_REPAIR_DRY_RUN=true` runs the full pipeline with zero mutating calls.
- No issue API calls anywhere in the module (R11).

**Test scenarios:**
- Happy path: mocked Octokit receives exactly one commit with the fixed message and only
  changed knowledge/ files.
- Dry-run: pipeline runs, zero Octokit mutations, result carries dry-run marker.
- Conflict retry: first commit 409s; reload returns a tree where findings persist → recompute →
  second commit succeeds; result counts one retry (AE6).
- Conflict-then-cleared: reload returns a tree where ingest already fixed the drift → no-op
  exit, no commit.
- Commit message is byte-identical to the constant across all scenarios (AE7).
- Result JSON contains no paths/slugs/fingerprints (AE7); no `issues.*` mock is ever called
  (AE8).

**Verification:**
- Full repo gate green; mocked-shell tests assert call shapes like the status-truth shell tests.

- [x] **Unit 3: Workflow wiring — repair job with scoped mint**

**Goal:** `wiki-lint.yaml` gains the gated repair job; manual dispatch works.

**Requirements:** R3, R4, R6 (job-level gate), R8 (mint boundary)

**Dependencies:** Unit 2

**Files:**
- Modify: `.github/workflows/wiki-lint.yaml`

**Approach:**
- `wiki-lint` job exposes a dedicated repairable-classes output (computed from the JSON report
  while it is still on disk in that job) — true only when the completed scan contains
  deterministic repairable findings (index-drift, orphan-page, missing/invalid-frontmatter).
- New `wiki-repair` job: `needs: wiki-lint`, `if:` gate on that output; checkout main; keep a
  grandfather copy of main's `knowledge/wiki/repos` before restoring; fetch origin/data and
  restore `knowledge/` + `metadata/repos.yaml` from the current data tip (mirroring
  `merge-data.yaml`'s dual-tree wiring — note the existing lint restore only covers
  `knowledge/`, so the repos.yaml restore is new plumbing); mint `create-github-app-token` with
  `permission-contents: write` repo-scoped (this job only, step skipped when the dispatch is
  dry-run); run `node scripts/wiki-repair.ts`; append counts-only summary from the result JSON.
- Issue-sync job unchanged; detection job permissions unchanged (contents: read).

**Test scenarios:**
- Test expectation: none — workflow YAML; verified by YAML lint, `Check Workflows` CI, and the
  live rehearsal below.

**Verification:**
- YAML parses; eslint yml rules pass; a dispatch on a clean wiki produces a skipped or no-op
  repair job with counts-only summary.

- [x] **Unit 4: Operator documentation**

**Goal:** Document the repair loop's bounds and lifecycle.

**Requirements:** R1, R2, R11 (documented boundaries)

**Dependencies:** Units 1–3

**Files:**
- Modify: `metadata/README.md` (wiki/authority section) or `README.md` — match where the wiki
  lint lifecycle is documented today; smallest accurate diff.

**Approach:**
- Document: which classes auto-repair vs stay issue-only, the two-field frontmatter allowlist
  and its shrink-only rule, the data-branch write path and promotion latency semantics, and
  that issue closure remains lint-owned.

**Test scenarios:**
- Test expectation: none — docs-only; markdown lint.

**Verification:**
- A reader can predict, for each of the seven lint classes, whether a finding self-heals or
  waits for a human.

## System-Wide Impact

- **Interaction graph:** lint detection and issue lifecycle unchanged; promotion pipeline
  unchanged (repair commits look like ingest commits); ingest unchanged. New edge: lint report →
  repair job → data commit → (next scan) close-on-clear.
- **Error propagation:** every abort class (verification survivor, privacy block, path refusal,
  conflict exhaustion) exits without committing and is a distinct count; the lint workflow's
  detection job cannot be failed by the repair job (separate job, `needs` only).
- **State lifecycle risks:** repeated identical repairs across runs are bounded by no-op
  detection (repaired map == input map after the prior repair landed); close-on-clear latency
  when promotion waits on human review is accepted and documented.
- **Unchanged invariants:** `main` protection, data-branch sole-writer authority model,
  promotion gates, issue fingerprint lifecycle, counts-only telemetry, `metadata/*.yaml`
  untouched by repair.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Write credential in the lint workflow | Mint only inside the repair job; schedule/dispatch-only triggers; detection/issue-sync jobs keep read-only contents. |
| Repair resurrects private content on public `data` | Pre-commit `detectPrivateWikiLeaks` gate with promotion-identical inputs; abort on any leak (AE9). |
| Verify/commit tree divergence | Snapshot-lineage pinning + full-pipeline recompute on conflict; no blind retry. |
| Repair oscillation across runs | No-op detection + verify-before-commit; close-on-clear remains the single issue-state owner. |
| Frontmatter repair judgment creep | Two-field allowlist, shrink-only; unparseable YAML out of scope; verbatim-only title copy. |
| Log damage unaddressed in v1 | Documented deferral; `--merge-logs` healer remains the manual path. |

## Documentation / Operational Notes

- Rehearsal after merge: dispatch `wiki-lint.yaml` on the clean wiki — expect repair job
  skipped (no repairable findings) or counts-only no-op. A live drift rehearsal requires a
  fro-bot-authored drift commit on `data` (check-wiki-authority blocks manual staging); use an
  agent-workflow write or accept waiting for organic drift.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md](../brainstorms/2026-07-03-wiki-authority-repair-loop-requirements.md)
- Related code: `scripts/wiki-lint.ts`, `scripts/wiki-lint-issues.ts`, `scripts/wiki-ingest.ts`,
  `scripts/rebuild-wiki-index.ts`, `scripts/check-wiki-private-presence.ts`,
  `.github/workflows/wiki-lint.yaml`, `.github/workflows/merge-data.yaml`,
  `scripts/merge-data-pr.ts`
- Prior plans: [docs/plans/2026-07-03-001-feat-bounded-correction-pr-execution-plan.md](2026-07-03-001-feat-bounded-correction-pr-execution-plan.md)
- Related learnings: `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`,
  `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md`,
  `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`
