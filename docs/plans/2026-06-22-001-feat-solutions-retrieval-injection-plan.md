---
title: 'feat: solutions retrieval — inject relevant prior learnings into the agent prompt'
type: feat
status: active
date: 2026-06-22
origin: docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
---

# feat: solutions retrieval — inject relevant prior learnings into the agent prompt

## Overview

Make Fro Bot reliably consult its existing `docs/solutions/` learnings during a run.
Today those 22 docs help a run only if it happens to search them; the
`.github/copilot-instructions.md` "search docs/solutions/" directive is prompt-only and
not mechanized anywhere. This plan adds a retrieval step that selects the most relevant
prior learnings for the current run and injects them into the agent prompt — exactly
mirroring the production wiki-context injection — so Fro Bot applies what it already knows
instead of relearning it.

This is **Phase 1** of the A1 grow-and-learn loop (see origin). It deliberately ships the
*retrieve-and-apply* half first: it consumes the existing curated corpus, with no
autonomous capture, no wiki traversal, and no decision log (those are Phase 2/3).

## Problem Frame

Fro Bot's knowledge does not compound because reuse is not surfaced at decision time. The
dominant gap is retrieval, not capture: 22 high-quality, hand-curated learnings sit in
`docs/solutions/`, but a run only benefits by chance. Mechanizing retrieval — selecting the
relevant subset and injecting it into the prompt — is the lowest-risk, highest-leverage
first move, and the production wiki-query injection path already proves the mechanism.

## Requirements Trace

- R1. (origin B1) Before acting on a class of work that has prior learnings, Fro Bot
  consults `docs/solutions/` and applies the relevant ones.
- R2. (origin B2) Retrieval is relevance-ranked via the docs' frontmatter so the injected
  set is small and on-point, not a dump.
- R3. (origin B3) Applied learnings are visible in the run's reasoning — the agent cites the
  consulted doc path when it applies one.
- R4. (origin B4) Stale learnings are handled: freshness metadata is surfaced and low-
  confidence/stale matches are presented as candidate suggestions, not asserted facts.
- R5. (origin SC5) Injection introduces no private-repo identifier into any public surface;
  the retrieval path honors the repo's no-private-leak discipline.

## Scope Boundaries

- Retrieval and injection only. No autonomous capture/writing of new learnings (Phase 2).
- No agentic wiki traversal (origin C-deep, Phase 3).
- No decision log / improvement metric / operator-web surfacing (origin G4, Phase 3).
- No new frontmatter fields on `docs/solutions/` docs — v1 uses the fields that already
  exist on all 22 docs.
- No learned/ML ranker — deterministic scoring only.

### Deferred to Separate Tasks

- Autonomous capture from run cohorts (origin Capability A): Phase 2, separate plan.
- Wiki-link traversal (origin C-deep) and decision log (origin G4): Phase 3, separate plan.
- A `docs/solutions/` index file, if the corpus grows enough to need one: future, only if
  the per-run directory scan becomes a cost.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/fro-bot.yaml` — the **injection pattern to mirror**. The `Query wiki
  context` step (`id: wiki-query`) runs `node scripts/wiki-query.ts`; its
  `outputs.excerpt` flows into the agent prompt via `WIKI_CONTEXT` and is rendered inside a
  `<wiki_context>` block alongside `<persona>` and the `TASK_PROMPT`. The new solutions
  step is a sibling of this, injected as a `<solutions_context>` block.
- `scripts/wiki-query.ts` — the **script to mirror structurally**: env-driven inputs
  (event name, owner, repo, title, body), a category-dir loader, `splitFrontmatter`
  (`---\n…\n---` + `yaml.parse`), a deterministic `scorePage` token-overlap scorer with
  per-field weights, event-aware base type-weighting, a byte-budget greedy packer with
  multi-byte-safe truncation, and a `GITHUB_OUTPUT` writer (multi-line `excerpt` via hex
  delimiter, `selected-paths` JSON, `byte-length` scalar). Its colocated
  `scripts/wiki-query.test.ts` is the **test template** (repo-priority, hard cap, topical
  match, empty-on-no-match, multi-byte truncation).
- `scripts/check-private-leak.ts` — the **leak-token source** for R5. Its private-identifier
  token set (canonical `owner/name`, sanitized `owner--slug`, raw `owner--name`) is reused
  to body-scan candidate docs before injection.
- `docs/solutions/` — the corpus: 22 docs in 6 category dirs
  (`best-practices`, `documentation-gaps`, `integration-issues`, `runtime-errors`,
  `security-issues`, `workflow-issues`). No index file. On `main` directly (not the `data`
  branch), so no sync step is needed — simpler than the wiki.

### Institutional Learnings

- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` —
  injected context is a direct leak vector: **scan content not just identifiers**, **fail
  closed on ambiguous**, **enforce at a trusted chokepoint**. Drives R5's body-scan design.
- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` +
  `private-repo-dispatch-visibility-gate-2026-05-08.md` — use **opaque identifiers in logs**
  (the doc's file path, never a resolved private name) and **fail-closed on unknown**.
- `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md` — the new script
  must be Node 24 strip-only safe (no parameter properties, enums, namespaces). `Test
  Scripts Load` CI + `erasableSyntaxOnly` lint catch this.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — if
  retrieval becomes a gating step, the success predicate must cover it; but here retrieval
  is **best-effort and non-gating** (a failed/empty retrieval must never fail the agent
  run), which sidesteps the silent-failure trap by design.
- `docs/solutions/best-practices/observability-before-structural-change-2026-06-09.md` — do
  not add a `relevance_score` field or `last_retrieved_at` counter; derive everything from
  existing frontmatter. No new persisted state in v1.

## Key Technical Decisions

- **New sibling step + new `scripts/solutions-query.ts`, mirroring `wiki-query.ts`** (origin
  O4 resolved). Lowest-risk: the precedent is in production. An agent-invoked retrieval tool
  is Phase 3 territory, consistent with the C-deep traversal decision.
- **All run types get retrieval.** The script early-returns an empty excerpt on no match, so
  the marginal cost on comment/issue events with no relevant docs is ~zero, and the byte
  budget bounds the rest. One step on all paths is simpler than gating per event.
- **Deterministic token-overlap scorer.** Mirror `wiki-query.ts` scoring: token overlap over
  `tags` + `title` + `module` + body, with `problem_type` giving event-aware weight (e.g.
  weight `security_issue` higher on security-flavored PR titles) and `applies_when` boosted
  where present. `module` is **free-form** (file paths, identifiers, comma/`+`-joined lists),
  so it is matched as a multi-token text field via substring/token overlap, never equality.
  No learned ranker.
- **Fail-closed body privacy scan (R5).** Before injecting a doc, scan its **body** (not just
  frontmatter) for private-repo identifiers using the `check-private-leak.ts` token set. Any
  hit excludes that doc fail-closed. Logs/outputs reference docs by **path only**, never a
  resolved private name. This is defense-in-depth: the corpus is already on public `main` and
  passed the merge-time gate, but the injection point is re-gated as the trusted chokepoint.
- **Freshness via existing `last_updated` (R4).** `last_updated` is present on all 22 docs
  (YYYY-MM-DD). The script surfaces it in each injected entry and applies a configurable
  staleness threshold (default 60 days) to down-rank/flag stale matches as candidate
  suggestions. `verified: true` (one doc, boolean not date) is treated as "valid as of
  authoring, do not time-demote." No new frontmatter, no schema migration.
- **Best-effort, non-gating.** Retrieval never fails the agent run. A parse error, empty
  result, or privacy exclusion yields an empty/partial `<solutions_context>` and the run
  proceeds. This avoids the autonomous-pipeline silent-failure class by not making retrieval
  load-bearing for run success.
- **Smaller byte budget than wiki.** Use a tighter cap (≈3–4KB vs the wiki's 5KB) because the
  solutions corpus is denser and R2 wants "small and on-point" — configurable via env.

## Open Questions

### Resolved During Planning

- O4 (origin) injection mechanism: new sibling step + `solutions-query.ts`. Resolved above.
- Run-type scope: all run types. Resolved above.
- Scorer sophistication: deterministic token-overlap. Resolved above.
- Privacy posture: fail-closed body scan reusing `check-private-leak.ts`. Resolved above.

### Deferred to Implementation

- Exact per-field score weights and the staleness-threshold default — start from the
  `wiki-query.ts` weights and tune against real fixtures; final values are an
  implementation-time calibration, not a planning decision.
- Whether `applies_when` (12/22 docs) is matched as free text or as discrete clauses — try
  free-text token overlap first; refine only if precision is poor.
- Reuse shape of the `check-private-leak.ts` token logic (import a shared helper vs.
  replicate the token-set construction) — depends on what that module currently exports;
  prefer extracting a shared helper if it is cheap, otherwise replicate the small token set.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not
> implementation specification. The implementing agent should treat it as context, not code
> to reproduce.*

```
fro-bot.yaml run (any event)
   │
   ├─ Query wiki context        → WIKI_CONTEXT       (existing)
   ├─ Query solutions context   → SOLUTIONS_CONTEXT  (new, this plan)
   │     node scripts/solutions-query.ts
   │       1. load docs/solutions/**.md  (6 category dirs, from main checkout)
   │       2. splitFrontmatter + parse   (title, module, tags, problem_type,
   │                                       applies_when, last_updated, verified)
   │       3. score vs event {title, body, owner, repo, event_name}
   │            token overlap: tags · title · module(substring) · body
   │            + problem_type event-weight + applies_when boost
   │       4. privacy body-scan (check-private-leak token set) → drop fail-closed
   │       5. freshness: surface last_updated; stale>threshold ⇒ candidate-flag
   │       6. greedy pack into byte budget (multi-byte-safe truncate)
   │       7. GITHUB_OUTPUT: excerpt (each entry cites Path: <doc-path>),
   │                          selected-paths[], byte-length
   │
   └─ agent prompt:
        <persona>…</persona>
        {TASK_PROMPT}
        <wiki_context>{WIKI_CONTEXT}</wiki_context>
        <solutions_context>{SOLUTIONS_CONTEXT}</solutions_context>   ← new
        <knowledge_persistence>
          …consult <solutions_context>; apply relevant learnings and
          cite "Path: <doc-path>" in your reasoning when you do…       ← R3
        </knowledge_persistence>
```

## Implementation Units

- [ ] **Unit 1: `scripts/solutions-query.ts` — retrieval engine (test-first)**

**Goal:** A script that loads `docs/solutions/**`, scores docs against the current run's
event context, applies the privacy body-scan and freshness handling, packs the top matches
into a byte budget, and writes the excerpt + metadata to `GITHUB_OUTPUT`.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** None (reads the working tree; reuses `check-private-leak.ts` token logic).

**Files:**
- Create: `scripts/solutions-query.ts`
- Test: `scripts/solutions-query.test.ts`
- Possibly modify: `scripts/check-private-leak.ts` (only if extracting a shared token-set
  helper is the clean reuse path — see deferred question)

**Approach:**
- Mirror `scripts/wiki-query.ts` structure: env-driven inputs
  (`SOLUTIONS_QUERY_EVENT_NAME`, `_OWNER`, `_REPO`, `_TITLE`, `_BODY`, falling back to
  `GITHUB_EVENT_NAME`), a category-dir loader over the 6 `docs/solutions/` subdirs,
  `splitFrontmatter` + `yaml.parse`, a deterministic scorer, byte-budget packer, and the
  `GITHUB_OUTPUT` writer shape.
- Scorer: token overlap on `tags`, `title`, `module` (free-form → substring/token match),
  and body; `problem_type` event-weighting; `applies_when` boost where present. Start from
  the `wiki-query.ts` weights.
- Privacy: for each candidate, body-scan with the `check-private-leak.ts` token set; any hit
  excludes the doc fail-closed. Never emit a resolved private name; reference docs by path.
- Freshness: parse `last_updated`; if `now - last_updated > threshold` (default 60d, env-
  overridable), flag the entry as a candidate suggestion in the excerpt; treat `verified:
  true` as non-time-demotable. Handle the `created:`-only / missing-`date` edge cases without
  throwing.
- Each emitted entry includes `Path: <doc-path>` (for R3) and its `last_updated` (for R4).
- Best-effort: on any parse/IO error, emit an empty excerpt and exit 0 — never throw in a
  way that would fail the workflow step.

**Execution note:** Implement test-first, mirroring `scripts/wiki-query.test.ts`.

**Patterns to follow:**
- `scripts/wiki-query.ts` (structure, byte budget, `GITHUB_OUTPUT` shape, multi-byte-safe
  truncation), `scripts/wiki-query.test.ts` (test shape).
- `scripts/check-private-leak.ts` (token-set construction for the body scan).
- Node 24 strip-only constraints (no parameter properties/enums/namespaces); `node:` import
  prefixes; `.js`-extension TS imports.

**Test scenarios:**
- Happy path: a PR event whose title/body match a doc's `module`/`tags` selects that doc;
  excerpt contains its title + `Path:` + `last_updated`.
- Edge case: no matching docs → empty excerpt, `selected-paths: []`, exit 0.
- Edge case: hard byte-budget cap enforced; an over-budget candidate is truncated with the
  marker, multi-byte/emoji boundary safe.
- Edge case: event-aware weighting — a security-flavored PR title ranks a `problem_type:
  security_issue` doc above an unrelated `best_practice` doc.
- Edge case: free-form `module` matches via substring (e.g. event token `reconcile-repos`
  matches `module: scripts/reconcile-repos.ts`).
- Error path (privacy, R5): a fixture doc whose **body** contains a private-identifier token
  is excluded fail-closed; assert it is NOT in the excerpt and that no resolved private name
  appears in any output/log (path-only references).
- Edge case (freshness, R4): a doc with `last_updated` older than the threshold is flagged as
  a candidate suggestion; a `verified: true` doc is not time-demoted; a doc missing `date`
  does not throw.
- Edge case: malformed frontmatter on one doc does not crash the run; that doc is skipped,
  others still returned.

**Verification:** `pnpm check-types`, `pnpm lint`, `pnpm test` green; the script loads under
Node strip-only (`Test Scripts Load` semantics); no resolved private identifier appears in
any output for the privacy fixture; excerpt respects the byte budget.

- [ ] **Unit 2: wire the retrieval step + injection into `fro-bot.yaml`**

**Goal:** Run `solutions-query.ts` on every Fro Bot run and inject its excerpt into the
agent prompt as a `<solutions_context>` block, with a prompt instruction to consult and cite
applied learnings.

**Requirements:** R1, R3.

**Dependencies:** Unit 1.

**Files:**
- Modify: `.github/workflows/fro-bot.yaml`

**Approach:**
- Add a `Query solutions context` step (`id: solutions-query`) as a sibling of `Query wiki
  context`, passing the same event-derived env (`event_name`, owner, repo, title, body).
- Add `SOLUTIONS_CONTEXT: ${{ steps.solutions-query.outputs.excerpt }}` to the agent step env
  and render a `<solutions_context>${{ env.SOLUTIONS_CONTEXT }}</solutions_context>` block in
  the prompt, adjacent to `<wiki_context>`.
- Add a one-line instruction in the `<knowledge_persistence>` block (and a short mention in
  the `SCHEDULE_PROMPT` / `PR_REVIEW_PROMPT` near the existing dedup/consult guidance):
  consult `<solutions_context>`, apply relevant learnings, and cite `Path: <doc-path>` in
  reasoning when applied (R3).
- The step is best-effort: a non-zero exit must not fail the run (mirror how the wiki step is
  treated; do not make the agent step depend on retrieval success).

**Execution note:** none (workflow wiring; validated by actionlint + a live dispatch).

**Patterns to follow:** the existing `Query wiki context` step and the `WIKI_CONTEXT`
injection in the same file; keep the App-token / permissions shape unchanged.

**Test scenarios:** `Test expectation: none -- workflow wiring; validated by actionlint and a
manual dispatch that shows the `<solutions_context>` block populated and the agent citing a
`Path:` it applied.`

**Verification:** actionlint clean; a manual `workflow_dispatch` (or a real PR/schedule run)
shows the solutions step ran, the `<solutions_context>` block is populated when relevant docs
exist, the block is empty (not erroring) when none match, and the agent cites an applied doc
path in its reasoning. Confirm no private identifier appears in the run log/step output.

## System-Wide Impact

- **Interaction graph:** adds one step to every `fro-bot.yaml` run type; the agent prompt
  gains one context block. No change to the App-token flow, permissions, persona injection,
  wiki injection, or the autonomous-write/data-branch paths.
- **Error propagation:** retrieval is best-effort and non-gating — failures yield an empty
  context block, never a failed run. This is deliberate to avoid the silent-failure trap
  (a non-load-bearing step cannot mask a downstream failure in the run's success predicate).
- **State lifecycle risks:** none — no persisted state, no new frontmatter, reads the working
  tree only.
- **API surface parity:** the wiki-context injection is the parallel surface; this mirrors it
  without changing it.
- **Unchanged invariants:** the no-private-leak discipline (the body scan strengthens it at a
  new chokepoint), the data-branch authority model (untouched — `docs/solutions/` is on
  `main`), and run success semantics (retrieval cannot fail a run).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Injected doc body leaks a private identifier into a public surface | Fail-closed body scan with the `check-private-leak.ts` token set at the injection chokepoint; path-only references in logs |
| Retrieval failure breaks an agent run | Best-effort, non-gating: empty excerpt + exit 0 on any error; agent step does not depend on retrieval success |
| New script crashes prod under Node 24 strip-only despite green tests | Strip-only-safe constructs only; `Test Scripts Load` CI + `erasableSyntaxOnly` lint cover it |
| Free-form `module` makes scoring miss or over-match | Token-overlap/substring matching (never equality); calibrate weights against real fixtures; tune in implementation |
| Context bloat / irrelevant dump | Tight byte budget (≈3–4KB) + relevance ranking; "small and on-point" is R2 |

## Documentation / Operational Notes

- After the feature lands, capture the retrieval-injection pattern as a new `docs/solutions/`
  learning (the learnings research noted this surface is net-new territory with no prior
  doc) — including the byte-budget truncation and the body-scan privacy chokepoint. (This is
  itself a small dogfood of the grow-and-learn loop.)
- Update `metadata/README.md` only if it documents the agent context-injection surface;
  otherwise no doc change is required for v1.

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
- Pattern to mirror: `.github/workflows/fro-bot.yaml` (`Query wiki context` step + injection),
  `scripts/wiki-query.ts`, `scripts/wiki-query.test.ts`
- Privacy token source: `scripts/check-private-leak.ts`
- Key learnings: `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`,
  `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`,
  `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md`
