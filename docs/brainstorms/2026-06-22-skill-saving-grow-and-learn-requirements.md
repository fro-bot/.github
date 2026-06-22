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

## Capability A — Autonomous capture (Phase 2)

A scheduled capture run that retrospectively examines **cohorts of prior Fro Bot runs** and
proposes reusable learnings for human review, rather than detecting a learnable moment
mid-run. Seeing a collection of runs lets it find patterns invisible in any single run.

> **Phase 2 v1 is a suggestion engine, not fully autonomous capture.** The capture run
> proposes candidate learnings by opening GitHub issues with evidence; a human (Marcus)
> decides whether to author the final learning via `ce:compound`. This deliberately keeps
> Marcus in the loop to protect the curated `docs/solutions/` corpus and prove quality before
> any authoring machinery is built. The premise — that reasoning over outcome metadata like
> "this PR took 3 rounds" yields learnings comparable to human-noticed insights — is
> **unproven**; propose-only v1 exists precisely to test it cheaply. If proposals are shallow,
> that is a cheap, valuable negative result.

> **Phase 1's outcome-impact is not yet measured.** Capture proceeds as a cheap,
> directly-informative experiment. Measuring whether retrieval changes run outcomes is a
> Phase 3 concern (the deferred improvement metric, O8). Phase 2 v1 does not depend on that
> measurement.

### Harvest substrate (resolved): GitHub API outcome metadata, not prompt artifacts

The reliable substrate is what GitHub durably retains about run **outcomes**, not raw agent
transcripts. Verified during this brainstorm:

- **Merged PRs carry durable signals** — review-round counts, titles, `Closes #N`, CI
  conclusions, and review threads are all queryable via the GitHub API (e.g. a PR that took 2+
  review rounds is a clean multi-round signal).
- **Prompt artifacts are ephemeral/inconsistent** — only ~1 of 5 recent runs retained an
  `OPENCODE_PROMPT_ARTIFACT` upload, and GitHub artifacts expire. There is no run-journal in
  the agent. So the prompt artifact is **bonus enrichment when present**, never the foundation.

The capture run therefore reasons over **structured GitHub API outcome metadata** (this PR
took 3 rounds; these runs failed CI then passed; this triage decided skip-with-reason) rather
than over raw transcripts.

### Triggers (Phase 2 v1 — C1 only)

Phase 2 v1 narrows to the single highest-signal trigger. C2 and C3 move to Phase 2.5 once
C1 precision is proven. C4 remains Phase 3.

- **C1 — Multi-round-review PRs (v1 only).** PRs that needed several review rounds /
  changes-requested before merging encode a mistake-then-correction — the richest learning
  shape, and directly queryable from PR review history. A scheduled harvest collects merged
  PRs whose review history shows multiple rounds above a threshold (exact threshold: planning
  decision, O6). Lead trigger for v1.
- **C2 — Failed-then-fixed runs. DEFERRED to Phase 2.5.** Add once C1 precision is proven.
- **C3 — Issue triages. DEFERRED to Phase 2.5.** Add once C1 precision is proven.
- **C4 — Recurring patterns across runs (cross-run synthesis). DEFERRED to Phase 3.**

### Mechanism (resolved): script harvests + pre-filters → agent judges → proposal issue

The established repo pattern — a deterministic script feeds the agent curated context — applies
here, with the output being a GitHub issue proposal rather than an authored doc:

- **Script harvests + pre-filters (deterministic, testable).** A TS script queries the GitHub
  API for the C1 cohort (merged PRs + review-round counts above threshold), dedups candidates
  against the existing `docs/solutions/` corpus (module / tags / problem_type overlap — so it
  does not propose a learning that already exists), and emits a **structured, counts-only
  candidate digest** (opaque/redacted where private). This mirrors how
  `scripts/reconcile-repos.ts` and `scripts/wiki-query.ts` produce structured context for the
  agent.
- **Agent judges (judgment only).** The `fro-bot.yaml` agent run receives the digest and does
  only what it is good at: decide which candidates are genuinely proposal-worthy. It does not
  do open-ended API exploration (the over-prompting failure mode).
- **Output: proposal issue, not authored doc.** For each candidate the agent judges
  proposal-worthy, the run **opens a GitHub issue** proposing the candidate learning, with
  evidence (which PR, how many rounds, the correction pattern). No doc is authored into
  `docs/solutions/`. No data-branch write occurs for the learning itself. A human (Marcus)
  decides whether to author it via `ce:compound` later.
- **Decision log is script-maintained state**, not agent-managed, so it is deterministic and
  durable.

### Harvest → redact → publish pipeline (privacy-first)

The harvested signals and any authored proposal may reference private-repo content (repo
names, org identifiers, issue titles, PR descriptions). The pipeline enforces a hard
separation:

1. **Harvest (counts-only / opaque).** The candidate digest is counts-only and opaque where
   private — no private-repo identifier appears in the digest, the decision log, or any
   workflow log line. Opaque keys (e.g. a hash or ordinal) are used for "examined cohort"
   entries; never "PR #X about `<private repo>`".
2. **Proposal issue body scan (gate).** The agent-authored proposal issue body — including any
   examples or correction-pattern prose — is scanned for private identifiers (reusing the
   token forms from `scripts/check-private-leak.ts`) **before the issue is posted**. A hit
   blocks or redacts the proposal. A counts-only digest does not prevent the agent from
   embedding a private repo name in its authored prose; the scan closes that gap.
3. **No promotion path in v1.** Because no doc is authored, the `docs/solutions/` promotion
   gates (`scripts/check-private-leak.ts`, `scripts/check-wiki-private-presence.ts`) are not
   on the v1 critical path. They remain the gates for when authoring is added in a later phase.

This pipeline is a first-class requirement, not an assertion. A proposal that cannot be
cleanly redacted must be discarded, not posted with caveats.

### Decision log — reset-resilient

A **script-maintained** durable decision log records which run cohorts were examined, which
candidates were proposed (issue opened), and which were deliberately skipped and why. This
lets the capture run avoid re-proposing the same candidate.

**Reset-resilience is a hard requirement.** The `data` branch is recreated from `main` on
squash-merge (the repo bootstraps/recreates `data` from `main`). A decision log living only
on `data` would be wiped on reset and re-propose everything. The log must survive data-branch
lifecycle events — e.g. keyed by immutable PR identity (PR number + merge commit SHA) so
re-derivation is idempotent, and/or stored where a reset does not wipe it. The exact
persistence mechanism is a planning decision (O4), but reset-resilience is a requirement, not
a nice-to-have.

The decision log is **operational metadata / control-plane state** — not a fourth knowledge
substrate, and not published to the operator web in early phases (operator-web surfacing is
Phase 3).

### Idempotent harvest

GitHub review state is mutable, paginated, and eventually consistent. The harvest must be
**idempotent**: each PR is identified by an immutable dedup key (PR number + merge commit
SHA) so reruns cannot double-count or miss late updates. The exact snapshot protocol (how far
back the harvest looks, how pagination is handled) is a planning decision (O7), but
idempotency is a requirement.

### Hard cost budget

Scheduled agent runs cost money. The following are acceptance-criteria-level bounds, not
vague guidance:

- **Cadence:** weekly (planning confirms or adjusts).
- **Max candidates per run:** a hard cap on how many proposal issues a single run may open
  (exact number: planning decision, O9).
- **Max cohort size:** a hard cap on how far back the harvest looks (e.g. merged PRs in the
  last N days; exact window: planning decision, O9).

Exceeding either cap causes the run to truncate and log the truncation, not silently expand.

### Deferred: authoring machinery (Phase 2.5+)

The following are explicitly **out of v1 scope** because propose-only dissolves the need:

- **No quarantine lane in `docs/solutions/`.** There is no autonomous authoring in v1, so no
  quarantine docs are created, and Phase 1 retrieval is untouched. _When authoring is added
  in a later phase, quarantine docs MUST be excluded from Phase 1 solutions-query retrieval —
  that is the deferred P0 mitigation._
- **No `docs/solutions/` data-branch authority path change (O2).** Propose-only does not
  write `docs/solutions/` at all. The authority-migration (bringing `docs/solutions/` onto
  the data-branch path, new guard logic, coexistence of human-authored and Fro-Bot-authored
  docs) moves to Phase 2.5+ when authoring lands. O2 remains an open question for that phase,
  not v1.
- **Human-reviewed promotion.** The requirement that captured-learning promotion is
  human-reviewed (not auto-merge) applies when authoring is added. In v1, the "promotion" is
  a human reading a proposal issue and deciding to run `ce:compound` — no PR promotion
  machinery is needed.
- **Systematic `ce:compound` in the capture run.** Not needed in v1 (the agent opens an
  issue, not a doc). Confirm Systematic is enabled in the capture run surface when authoring
  is added (deferred O3).

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
   prior Fro Bot runs (GitHub API outcome metadata; prompt artifacts are optional enrichment)
            │
            │  ┌─────────────────────────────────────────────────────────┐
            │  │  PHASE 1 (shipped): retrieve + apply                    │
            │  │  B. consult docs/solutions/ (22 existing docs)          │
            │  │     relevance-ranked · freshness-gated · candidate-mode │
            │  │     for low-confidence matches                          │
            │  └─────────────────────────────────────────────────────────┘
            │
   ┌────────▼─────────┐   PHASE 2 v1: C1-only · propose-only
   │ A. capture run   │   harvest C1 cohort (private, counts-only digest)
   │ (suggest only)   │   → agent judges → proposal issue (no doc authored)
   └────────┬─────────┘   privacy gate: scan issue body before posting
            │ proposal issue opened · decision log updated (reset-resilient)
            │ human (Marcus) decides → ce:compound later if warranted
            │
            │ [authoring + quarantine lane + data-authority path: Phase 2.5+]
            │
            ▼
   docs/solutions/ canonical  (unchanged by Phase 2 v1)
            │
            │  decision log (internal audit trail, reset-resilient,
            │  NOT operator web in v1; operator-web surfacing: Phase 3)
   ┌────────▼─────────┐
   │ C. wiki grounding│  baseline always-on
   │ (C-deep: Ph. 3)  │  deep traversal: Phase 3, gate-passed content only
   └────────┬─────────┘
            │ better-grounded run
            ▼
       next Fro Bot run  ──────────────► (becomes input to the next capture cohort)
```

## Open questions (resolve at planning)

- **O1 — Harvest substrate. RESOLVED (this brainstorm).** The reliable substrate is GitHub
  API outcome metadata (merged PRs + review-round counts, CI conclusions, issue triage
  history), not prompt artifacts. `OPENCODE_PROMPT_ARTIFACT='true'` is set but artifacts are
  ephemeral/inconsistent (~1 of 5 recent runs) and expire, so they are bonus enrichment when
  present, never the foundation. No new durable-harvest pipeline is required for v1 — the
  capture script reads what GitHub already retains.
- **O2 — `docs/solutions/` authority path. DEFERRED to Phase 2.5+.** Propose-only v1 does
  not write `docs/solutions/` at all, so the authority-migration is out of v1 scope. When
  authoring lands: `scripts/check-wiki-authority.ts` today guards only `knowledge/wiki/` and
  `metadata/` paths; bringing `docs/solutions/` onto the data-authority path requires new
  guard logic, a new promotion rule, and a coexistence model for human-authored and
  Fro-Bot-authored docs. Planning question for Phase 2.5+.
- **O3 — Systematic in the capture run surface. DEFERRED to Phase 2.5+.** Not needed in v1
  (no doc authoring). Confirm Systematic `ce:compound` is *enabled* (not just present) in the
  scheduled capture run when authoring is added, and whether capture is its own scheduled
  workflow or rides the existing daily oversight run.
- **O4 — Decision-log persistence / reset-resilience.** Where the script-maintained decision
  log lives and how it survives data-branch resets — a `metadata/` file keyed by immutable PR
  identity, a dedicated log file on `main`, or another channel — and its exact schema
  (examined cohorts, proposed, skipped+reason). Reset-resilience is a requirement; the
  mechanism is a planning decision.
- **O5 — Quarantine mechanism. DEFERRED to Phase 2.5+.** No quarantine docs in v1 (no
  authoring). When authoring lands: `origin: autonomous` frontmatter marker vs. a
  `docs/solutions/proposed/` subdir. Both keep autonomous captures visibly separable; the
  frontmatter marker is lighter and keeps Phase 1 retrieval working unchanged. Planning picks
  one — and quarantine docs MUST be excluded from Phase 1 solutions-query retrieval.
- **O6 — C1 round-count threshold.** The concrete threshold for "multi-round" (how many
  review rounds / changes-requested events counts as C1-qualifying). Calibration against real
  run history, planning-time.
- **O7 — Harvest snapshot protocol.** How far back the harvest looks (rolling window in days
  vs. since-last-run cursor), how pagination is handled, and how the per-PR immutable dedup
  key (PR number + merge commit SHA) is stored. Planning decision.
- **O8 — Improvement metric. Phase 3 scope.** What "compounding is improving outcomes"
  concretely measures (fewer repeat failures of a compounded class, fewer review rounds on a
  learned pattern). Early phases need only the internal audit trail. Phase 1's outcome-impact
  is not yet measured; that measurement is deferred here.
- **O9 — Cost budget specifics.** The hard caps for max candidates per run and max cohort
  size (harvest lookback window). Cadence is weekly as a default; planning confirms or
  adjusts. These are acceptance-criteria-level, not vague.
- **O10 — Proposal issue location and label.** Which repo the proposal issue is filed in,
  what label(s) it carries, and how Marcus discovers and acts on it. Planning decision.

## Success criteria

- **SC1** — Fro Bot reliably consults `docs/solutions/` before acting on a class of work
  with prior learnings, and the applied learning is visible in the run's reasoning. (Phase 1)
- **SC2** — A capture run examines a C1 cohort (multi-round-review PRs above threshold),
  opens at least one proposal issue with evidence (which PR, how many rounds, the correction
  pattern), deduped against existing `docs/solutions/`, with no operator invoking `ce:compound`
  to trigger the run. The proposal issue body passes the private-identifier scan before
  posting. (Phase 2 v1)
- **SC3** — A later run of a class with a relevant prior learning demonstrably consults and
  applies it (or surfaces it as a candidate for low-confidence matches), visible in the run's
  reasoning/decision log. (Phase 2)
- **SC4** — An agent run grounds itself from the repo's wiki page and, when it judges it
  needs more, traverses at least one wikilink to a related page within the guardrail budget,
  reading only gate-passed wiki content. (Phase 3)
- **SC5** — Capture produces no private-repo identifiers in any public surface. The proposal
  issue body (including agent-authored prose and examples) is scanned for private identifiers
  before posting; a hit blocks or redacts the proposal. The candidate digest, decision log,
  and workflow logs are counts-only / opaque — no private repo name, org, issue title, or PR
  description appears in any of them.
- **SC6** — The decision log records what was proposed (and what was skipped and why) as
  internal operational metadata, is keyed by immutable PR identity, and survives data-branch
  resets without re-proposing already-examined candidates.

## Phasing (directional — planning refines)

- **Phase 1 — Retrieve + apply (shipped).** Capability B over the existing 22
  `docs/solutions/` docs: reliable consultation before acting, relevance-ranked,
  freshness-gated, candidate-mode for low-confidence matches. Lower-risk, immediately
  testable, proves compounding value before the harvest pipeline is built.
- **Phase 2 — GitHub API outcome harvest, C1-only, propose-only.** A scheduled capture run
  harvests merged PRs whose review history shows multiple rounds (C1 trigger only). The run
  opens GitHub issue proposals with evidence; no doc is authored. A human decides whether to
  author via `ce:compound`. Includes: counts-only digest, proposal-issue-body privacy scan,
  reset-resilient decision log, idempotent harvest (per-PR dedup key), and hard cost budget.
  Operator-web surfacing stays strictly Phase 3.
- **Phase 2.5 — Add C2/C3 triggers + authoring machinery (once C1 precision is proven).**
  Add C2 (failed-then-fixed) and C3 (issue triages) triggers. Add autonomous doc authoring
  into a quarantine lane, the `docs/solutions/` data-branch authority path (O2), and the
  quarantine-exclusion guard for Phase 1 retrieval.
- **Phase 3 — Wiki traversal + observability.** Capability C-deep (agent-invoked wikilink
  traversal with concrete numeric guardrails, gate-passed content only), C4 cross-run
  synthesis, operator-web surfacing of the decision log, and improvement metric definition
  (O8).

## Dependencies & relationships

- **Depends on:** nothing in the operator spine (control-plane-native). Builds on existing
  `docs/solutions/`, `knowledge/wiki/`, `scripts/wiki-query.ts`,
  `scripts/check-private-leak.ts`, `scripts/check-wiki-private-presence.ts`, and the
  data-branch authority model. Systematic `ce:compound` is used by the human after reviewing
  a proposal; it is not invoked by the capture run in v1.
- **Soft relationship to operator web:** G4's decision-log surfacing is Phase 3 scope. A1's
  core loop does not block on the dashboard — the internal audit trail is durable
  control-plane state regardless of whether the web view exists yet.
- **Epic:** Tier-2 A1 in `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`.
