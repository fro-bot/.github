---
title: 'A1 — Skill saving / grow-and-learn (autonomous compounding loop)'
type: feat
date: 2026-06-22
status: requirements
epic: docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md
---

# A1 — Skill saving / grow-and-learn

## Purpose

Make Fro Bot *grow and learn*: a compounding loop where it reliably retrieves and applies
saved learnings in every run, captures new reusable learnings from cohorts of prior runs,
and grounds itself in the surveyed wiki for whatever repo it is working in. This is the
Tier-2 **A1** capability from the personal-agent north-star — the most control-plane-native
capability, requiring nothing from the operator spine, so it runs in parallel with the
operator rollout.

## Problem frame

Fro Bot already produces and stores knowledge, but the loop is open in three places:

1. **Retrieval is unreliable (lead problem).** The 22 existing `docs/solutions/` compound
   docs represent hard-won, hand-curated learnings — but a saved learning helps a later run
   only if that run happens to search for it. There is no reliable consultation step, so the
   compounding value of the existing corpus is largely unrealized. This is the dominant gap:
   the demand side is broken before the supply side.
2. **Capture is human-triggered.** Reusable learnings reach `docs/solutions/` only when an
   operator invokes `ce:compound` after solving something. Fro Bot's own runs — which now
   number in the thousands across surveys, reconciles, autoheal, reviews, and fixes —
   generate reusable judgment that is never captured unless a human notices and acts.
3. **Wiki grounding is shallow.** The survey builds extensive wiki pages per repo, and
   `fro-bot.yaml` already injects a single page of wiki context (`scripts/wiki-query.ts`,
   ~5KB budget). But Fro Bot cannot *deepen* that context by following wikilinks to related
   repo, topic, or entity pages — so it works with a thin slice of what it actually knows.

The result: Fro Bot's knowledge does not compound. Each run starts roughly as capable as
the last, instead of standing on what prior runs learned.

## Goals

- **G1** — Fro Bot reliably retrieves and applies relevant saved learnings when a run hits a
  similar situation, making the existing 22-doc corpus earn its keep before new captures are
  added.
- **G2** — Fro Bot autonomously captures reusable learnings from cohorts of its own prior
  runs, without an operator triggering each capture.
- **G3** — Fro Bot grounds itself in the surveyed wiki for the repo it is working in, and
  can deepen that context on demand by traversing wikilinks.
- **G4** — The loop is observable: Fro Bot maintains an internal audit trail of what it has
  compounded. Operator-web surfacing and a formal improvement metric are later-phase
  observability, not v1 goals.

## Non-goals

- **Not new storage.** The three substrates exist (`docs/solutions/` compound docs,
  `knowledge/wiki/` Karpathy wiki, `.agents/skills/`). A1 closes the loop over them; it does
  not invent a new store.
- **Not the operator spine.** S1/S2 web control surface and operator auth are the
  agent/dashboard sessions' work. A1 depends on none of it.
- **Not executable/runnable skills.** A "skill" here is durable knowledge (a compound doc or
  wiki page Fro Bot reads and applies), not a generated runnable tool or plugin.
- **Not a broad-net run sweep in v1.** General scheduled/manual-dispatch run cohorts are
  low-signal-per-run; deferred until the high-signal triggers are proven.
- **v1/early phases explicitly exclude:** C4 cross-run synthesis, C-deep wiki traversal, and
  operator-web decision-log surfacing. These are Phase 3 scope.

## Capability A — Autonomous capture (retrospective, batch)

A dedicated compounding run that retrospectively examines **cohorts of prior Fro Bot runs**
and distills reusable learnings, rather than detecting a learnable moment mid-run. Seeing a
collection of runs lets it find patterns invisible in any single run.

> **Identity bet:** the existing 22 `docs/solutions/` docs are hand-curated and high-signal.
> Autonomous capture must not pollute this corpus. All autonomous captures land in a
> **quarantine lane** (separately labeled, not in the canonical `docs/solutions/` set) until
> precision is proven. Only clearly high-confidence captures promote to canonical. This
> protects the hand-curated corpus as the authoritative signal source.

### Triggers (v1 — the high-signal set, Phase 2)

- **C1 — Multi-round-review PRs.** PRs that needed several review rounds /
  changes-requested before merging encode a mistake-then-correction — the richest learning
  shape. Lead trigger.
- **C2 — Failed-then-fixed runs.** Runs/PRs whose first attempt failed CI or was wrong and
  then got corrected. The delta between broken and fixed *is* the learning. (This is the
  shape of the strongest existing compound docs — the `jq //` trap, the Octokit method
  hallucinations, the strip-only TypeScript failures.)
- **C3 — Issue triages.** The daily oversight+autoheal run triages issues with fix/skip/defer
  rationale. That judgment is reusable and teaches future triage.
- **C4 — Recurring patterns across runs (cross-run synthesis). DEFERRED to Phase 3.** When
  the *same kind* of issue recurs across multiple runs (repeated rate-limit failures, repeated
  privacy-gate catches), compound the **pattern**. This is materially harder (clustering,
  temporal comparison, sameness judgment) and is out of scope for v1.

### Harvest → redact → publish pipeline (privacy-first)

Raw artifact harvesting may contain private-repo content (repo names, org identifiers, issue
titles, PR descriptions). The pipeline enforces a hard separation:

1. **Harvest (private control-plane state).** Raw run artifacts are written to the `data`
   branch as private operational state. They are never directly published.
2. **Redact / extract.** The capture run extracts only the reusable, non-attributable
   learning from the raw artifact. Private-repo identifiers, org names, and any content that
   would identify a private repo are stripped at this step.
3. **Gate.** Before any extracted learning reaches `docs/solutions/` or any public surface,
   it MUST pass through the existing promotion-time gates:
   - `scripts/check-private-leak.ts` — scans for private-repo names on the `data → main`
     path.
   - `scripts/check-wiki-private-presence.ts` — wiki promotion gate semantics.
   Both gates must pass. Failure blocks promotion; the capture stays in quarantine.

This pipeline is a first-class requirement, not an assertion. Capture that cannot be cleanly
redacted must be discarded, not published with caveats.

### Capture mechanics

- **Rides Systematic `ce:compound`.** Systematic is present in the agent workspace
  (`src/services/setup/systematic-config.ts` in `fro-bot/agent`), so capture can use the
  existing compound-doc authoring rather than new machinery. _Open question O3: confirm
  Systematic is enabled (not merely present) in the relevant run surface._
- **Quarantine lane first.** Autonomous captures land in a quarantine lane (separately
  labeled, not in the canonical `docs/solutions/` set) until precision is proven. Only
  clearly high-confidence, gate-passed captures promote to canonical.
- **Autonomous write → data branch → promotion PR.** Captures (quarantine and promoted) are
  written under Fro Bot identity to the `data` branch and promoted to `main` via the existing
  conditional promotion PR. _Open question O2: `docs/solutions/` is today human-authored on
  `main`; A1 brings it onto the data-branch authority path. This is an architectural change
  for planning to resolve._
- **Quality gate (specified).** Capture must avoid noise and duplication:
  - **Dedup:** similarity check against existing docs; prefer updating an existing doc over
    creating a near-duplicate (the `ce:compound` overlap behavior already does this for human
    runs).
  - **Genuine reusable delta:** the learning must be applicable beyond the specific run that
    generated it — not a one-off fix for a unique situation.
  - **Evidence threshold:** the capture must cite the run cohort and the pattern it
    generalizes; unsupported assertions are rejected.
  - **Quarantine path:** ambiguous captures (borderline dedup, unclear generalizability) go
    to quarantine, not canonical. They are not discarded — they wait for human review or
    additional evidence.

### Decision log (G4 — internal audit trail)

Fro Bot maintains a durable decision log of what it has compounded: which run cohorts it
examined, what learnings it captured or updated, and what it deliberately skipped and why.
This lets it (a) avoid re-compounding the same thing, and (b) provide an internal audit
trail for later metric definition. The decision log is **operational metadata / control-plane
state on the `data` branch** — it is not a fourth knowledge substrate, and it is not
published to the operator web in early phases. Operator-web surfacing is Phase 3 scope.

## Capability B — Retrieve + apply

Fro Bot reliably consults its saved learnings when a run hits a similar situation, instead
of only by chance. **This is Phase 1 — the first thing built, before the capture pipeline.**
It is lower-risk, immediately testable against the existing 22 docs, and proves compounding
value before the harvest pipeline is built.

- **B1** — Before acting on a class of work that has prior learnings (e.g. autoheal before
  fixing, a review before flagging, a survey before ingesting), Fro Bot consults
  `docs/solutions/` for relevant prior learnings and applies them.
- **B2** — Retrieval is relevance-ranked (the compound docs already carry frontmatter:
  `module`, `tags`, `problem_type`) so the consulted set is small and on-point, not a dump.
- **B3** — Applied learnings should be visible in the run's reasoning (so the decision log
  and the operator can see that a prior learning shaped the run) — closing the loop with G4.
- **B4 — Freshness / staleness.** Saved learnings carry freshness/validity metadata.
  Retrieval suppresses or down-ranks stale items. For low-confidence matches (stale learning,
  weak relevance signal), the agent surfaces the learning as a **candidate suggestion** rather
  than applying it directly — a stale learning applied confidently is worse than none.

## Capability C — Wiki grounding (tiered)

- **C-baseline (exists, stays always-on).** The single-page wiki-context injection in
  `fro-bot.yaml` (`scripts/wiki-query.ts`, ~5KB) continues to ground every run cheaply.
- **C-deep (new, Phase 3).** Deep wikilink **traversal** becomes a capability the agent
  invokes on its own judgment when it needs more context — following wikilinks from the
  repo's page to related repo, topic, entity, and comparison pages. Callers may also enable
  it for heavier missions. **C-deep is deferred to Phase 3** — it is out of scope for v1.
- **C-guardrails (Phase 3, when C-deep is planned).** Traversal is bounded. Concrete numeric
  caps (depth, breadth, page count, token budget) and a stop condition must be defined when
  C-deep is planned — not hand-waved. The agent decides *when* to go deeper; the guardrails
  bound *how far*.
- **C-deep privacy.** Deep traversal must only read already-gate-passed wiki content (content
  that has cleared `scripts/check-wiki-private-presence.ts` semantics). Traversal fails
  closed on private or unattributable pages — it does not surface content that has not passed
  the wiki privacy gate.
- **Surfacing across entry points.** The tiered model applies uniformly across the three
  entry points Fro Bot acts through: the gateway operator flow, the Discord mention loop, and
  the action. Baseline grounding is on for all; deep traversal (Phase 3) is agent-invoked on
  its own judgment, with callers able to enable it for heavier missions.

## How the loop compounds (text diagram)

```
   prior Fro Bot runs (prompt artifacts, harvested durably to data branch)
            │
            │  ┌─────────────────────────────────────────────────────────┐
            │  │  PHASE 1 (first): retrieve + apply                      │
            │  │  B. consult docs/solutions/ (22 existing docs)          │
            │  │     relevance-ranked · freshness-gated · candidate-mode │
            │  │     for low-confidence matches                          │
            │  └─────────────────────────────────────────────────────────┘
            │
   ┌────────▼─────────┐   PHASE 2: triggers C1 · C2 · C3
   │ A. capture run   │   harvest (private) → redact → gate → quarantine
   │ (ce:compound)    │   → promote (high-confidence, gate-passed only)
   └────────┬─────────┘
            │ autonomous write → data branch → promotion PR
            │ gates: check-private-leak.ts · check-wiki-private-presence.ts
            ▼
   quarantine lane  →  (proven) →  docs/solutions/ canonical
            │                              │
            │                    decision log (internal audit trail,
            │                    data branch, NOT operator web in v1)
   ┌────────▼─────────┐
   │ C. wiki grounding│  baseline always-on
   │ (C-deep: Ph. 3)  │  deep traversal: Phase 3, gate-passed content only
   └────────┬─────────┘
            │ better-grounded run
            ▼
       next Fro Bot run  ──────────────► (becomes input to the next capture cohort)
```

## Open questions (resolve at planning)

- **O1 — Durable run harvest.** Verified: `OPENCODE_PROMPT_ARTIFACT='true'` is set in
  `fro-bot.yaml` (line 372) and honored by the agent runtime, **but the artifacts are
  ephemeral and inconsistent** — of three recent runs, only one had an artifact, and GitHub
  artifacts expire. Capture cannot rely on artifacts still being present. Planning must
  decide how run data is durably harvested (harvest-as-you-go into the data branch vs.
  best-effort read of unexpired artifacts vs. another channel).
- **O2 — `docs/solutions/` authority path.** Today human-authored on `main`; A1 brings
  autonomous captures onto the data-branch authority + promotion path. Resolve the promotion
  model (auto-merge vs. human-reviewed for captured learnings) and how human-authored and
  Fro-Bot-authored docs coexist. **Note:** this is a bigger change than it appears —
  `scripts/check-wiki-authority.ts` today guards only `knowledge/wiki/` and `metadata/`
  paths, not `docs/solutions/`; `scripts/commit-metadata.ts` is path-restricted to
  `metadata/*.yaml`. Bringing `docs/solutions/` onto the data-authority path requires new
  guard logic and new promotion behavior, not just a config change.
- **O3 — Systematic in the run surface.** Confirm Systematic `ce:compound` is *enabled* (not
  just present) in the surface that runs capture, and whether capture is its own scheduled
  workflow or rides the existing daily oversight run.
- **O4 — Retrieval injection mechanism.** How the consulted learnings reach the agent's
  working context (extend the existing `wiki-query` injection step, a new retrieval step, or
  an agent-invoked tool) — parallels the wiki-traversal tool decision.
- **O5 — Improvement metric.** What "compounding is improving outcomes" concretely measures
  (fewer repeat failures of a compounded class, fewer review rounds on a learned pattern,
  etc.) so the decision log's G4 claim is testable, not narrative. Metric definition is Phase
  3 scope; early phases need only the internal audit trail.

## Success criteria

- **SC1** — Fro Bot reliably consults `docs/solutions/` before acting on a class of work
  with prior learnings, and the applied learning is visible in the run's reasoning. (Phase 1)
- **SC2** — A capture run examines a cohort of prior Fro Bot runs and produces at least one
  genuine, deduplicated learning via the quarantine lane and data-branch promotion path, with
  no operator invoking `ce:compound`. (Phase 2)
- **SC3** — A later run of a class with a relevant prior learning demonstrably consults and
  applies it (or surfaces it as a candidate for low-confidence matches), visible in the run's
  reasoning/decision log. (Phase 2)
- **SC4** — An agent run grounds itself from the repo's wiki page and, when it judges it
  needs more, traverses at least one wikilink to a related page within the guardrail budget,
  reading only gate-passed wiki content. (Phase 3)
- **SC5** — Capture produces no private-repo identifiers in any public surface. All
  autonomous writes pass through `scripts/check-private-leak.ts` and
  `scripts/check-wiki-private-presence.ts` before promotion to `main`. Raw harvest artifacts
  remain private control-plane state on the `data` branch and are never directly published.
- **SC6** — The decision log records what was compounded (and what was skipped and why) as
  internal operational metadata on the `data` branch.

## Phasing (directional — planning refines)

- **Phase 1 — Retrieve + apply.** Capability B over the existing 22 `docs/solutions/` docs:
  reliable consultation before acting, relevance-ranked, freshness-gated, candidate-mode for
  low-confidence matches. Lower-risk, immediately testable, proves compounding value before
  the harvest pipeline is built.
- **Phase 2 — Autonomous capture, narrow.** Durable run harvest (O1) + a capture run over
  the two highest-signal triggers (C1 multi-round-review, C2 failed-then-fixed), with the
  full harvest→redact→gate→quarantine→promote pipeline, the quality gate, and the decision
  log. Add C3 (issue triages) once C1/C2 precision is proven.
- **Phase 3 — Wiki traversal + observability.** Capability C-deep (agent-invoked wikilink
  traversal with concrete numeric guardrails, gate-passed content only), C4 cross-run
  synthesis, and operator-web surfacing of the decision log + improvement metric definition.

## Dependencies & relationships

- **Depends on:** nothing in the operator spine (control-plane-native). Builds on existing
  `docs/solutions/`, `knowledge/wiki/`, `scripts/wiki-query.ts`,
  `scripts/check-private-leak.ts`, `scripts/check-wiki-private-presence.ts`, the
  data-branch authority model, and Systematic `ce:compound`.
- **Soft relationship to operator web:** G4's decision-log surfacing is Phase 3 scope. A1's
  core loop does not block on the dashboard — the internal audit trail is durable
  control-plane state regardless of whether the web view exists yet.
- **Epic:** Tier-2 A1 in `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`.
