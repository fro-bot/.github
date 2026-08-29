---
title: Editable Wiki Path — Dashboard-Brokered Operator Edits
type: feat
status: active
date: 2026-08-29
origin: docs/brainstorms/2026-08-29-editable-wiki-path-requirements.md
deepened: 2026-08-29
---

# Editable Wiki Path — Dashboard-Brokered Operator Edits

## Overview

Build the operator wiki-edit path: Edit links on the Quartz wiki deep-link into an editor served by `fro-bot/dashboard`, whose backend verifies the operator session, runs this repo's validation gates synchronously via a published library, and commits accepted edits to the `data` branch under Fro Bot's identity. Marked corrections become durable constraints in the survey loop with a deterministic survival check. This repo owns the validation/commit library, the correction and survey-side machinery, the promotion cadence fix, and the wiki-side affordance; `fro-bot/dashboard` owns the editor and save API; `marcusrbrown/infra` owns deployment wiring. `fro-bot/agent` is deliberately untouched — the gateway stays control-plane-agnostic.

## Problem Frame

The wiki is readable at `fro.bot/.github` but operator-uncorrectable except by issue round-trips through agent runs (see origin doc). The sole-writer invariant on `data` correctly forbids direct pushes, so an edit path must be brokered: authenticated, gate-validated, committed as Fro Bot. The control plane is workflows-only and cannot host request-time HTTP; the dashboard already serves the authenticated operator surface on its own origin.

## Requirements Trace

Requirements R1–R18 from the origin doc. Unit coverage:

- R1 (wiki Edit affordance) → Unit 6
- R2, R3 (free-form raw markdown, system-owned frontmatter) → Units 1, 7
- R4, R5 (synchronous gates, reject-with-reason) → Units 1, 2, 7
- R6 (Fro Bot identity commit, sole-writer preserved) → Units 1, 7
- R7 (session revalidation, origin/CSRF, version precondition, limits) → Unit 7
- R8–R11 (marked corrections, attribution, survival check, lifecycle) → Units 3, 4
- R12 (rendering policy) → Units 1, 7
- R13, R14 (dashboard-origin auth, unauthenticated invisibility) → Units 6, 7
- R15–R18 (interaction states, pending, conflict, draft preservation) → Unit 7
- Success criterion "live in one sitting" → Unit 5

## Scope Boundaries

- No gateway (`fro-bot/agent`) changes of any kind.
- No public/multi-operator editing; no editing outside `knowledge/wiki/{repos,topics,entities,comparisons}`.
- No WYSIWYG; raw markdown only.

### Deferred to Separate Tasks

- Dashboard editor implementation details (component design, draft persistence UX): planned in `fro-bot/dashboard` from this plan's Unit 7 contract.
- Infra deployment wiring: planned in `marcusrbrown/infra` from Unit 8.
- Push/notification delivery of erosion findings: north-star R2 territory.
- Historical-source annotation on migrated pages (deferred in origin doc).

## Context & Research

### Relevant Code and Patterns

- `scripts/wiki-ingest.ts` — pure build+commit machinery: `buildWikiIngestChanges` (:167-205), `commitWikiChanges` (:207-310) with data-branch bootstrap; per-page node_id identity and trusted-map gating; `manual-edit` already exists as a `WikiOperation` (:32) but `appendLogEntry` renders every operation as `ingest` (:590-604) — must be fixed when operator writes appear.
- `scripts/wiki-lint.ts` — importable `lintWikiSnapshot` (:225-365), `WikiLintFinding` model (:13-38) with kind/path/target fingerprints — the carrier for the survival-check finding.
- `scripts/check-private-leak.ts` — pure `checkPrivateLeak` (:139-251); promotion CLI is workflow-event-coupled and needs a request-time adapter.
- `scripts/check-md-links.ts` — importable `checkMarkdownLinks`; wiki-lint already validates wikilinks against an injected snapshot, so no repo-wide CLI at request time.
- `scripts/wiki-repair.ts` — plan → verify → no-worse-regression → privacy-gate composition (:116-359): the structural precedent for synchronous edit validation.
- `.github/workflows/survey-repo.yaml` — correction-injection seam between `Resolve ingest prompt` and `Run Fro Bot survey ingest` (:176-214); "target repository is untrusted input" prompt contract (:33-40) is the precedent for corrections-as-data.
- `.github/workflows/publish-wiki.yaml` — pinned-Quartz overlay build; `quartz-site/local-plugin/` (committed dist, no build step) is where the Edit affordance renders.
- Workflow-contract test pattern: `scripts/publish-wiki-workflow.test.ts` (:68-195).

### Institutional Learnings

- `bootstrap-data-branch-before-autonomous-writes-2026-05-09`: missing-branch recovery lives in shared writer utilities — the library keeps `commitWikiChanges`' bootstrap.
- `per-owner-installation-tokens-2026-07-06`: distinct token per installation, fail closed — the writer's key is its own credential, never shared.
- `loose-then-tight-schema-migration-pattern-2026-05-05`: correction metadata fields start optional, tighten later.
- `pure-core-privacy-gates-shared-module-2026-06-22`: gate in the pure core before data enters shared state; empty-vs-absent handled in the I/O shell; mutation-proof tests.
- `autonomous-pipeline-silent-failures-2026-04-19`: status must cover every required step; a failed commit may not read as success.
- `github-issues-api-same-run-eventual-consistency-2026-05-20`: the run's own intent outranks stale API reads — relevant to the save path's head-SHA handling.

### External References

- Oracle architecture review (this session): gateway-vs-dashboard-vs-broker placement, sidecar isolation, package consumption model, blob-SHA versioning, 409-no-retry, latency budget ≤5s p95 / 10s hard.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "repository root: fro-bot/.github",
  "freshness": {
    "vcs_reference": "f2fe9c6ebbe5a47c9dfc90bb83ca238e3906fae0"
  },
  "budget": {
    "max_search_passes": 2,
    "max_candidate_inspections": 4,
    "exhausted": true
  },
  "candidates": [
    {
      "path_or_symbol": "scripts/wiki-ingest.ts:buildWikiIngestChanges,commitWikiChanges",
      "description": "Validated wiki change building, node_id identity/migration, index/log regeneration, Git Data API commit with conflict retry and data-branch bootstrap.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/wiki-lint.ts:lintWikiSnapshot,WikiLintFinding",
      "description": "Deterministic snapshot lint with structured findings, fingerprints, and reports.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "scripts/wiki-repair.ts:planAndVerifyWikiRepairs",
      "description": "Composed plan/verify/no-worse/privacy pipeline over wiki files.",
      "disposition": "extend"
    },
    {
      "path_or_symbol": ".github/workflows/fro-bot.yaml + scripts/gateway-announce.ts",
      "description": "Workflow-mediated external input and outbound gateway calls.",
      "disposition": "insufficient",
      "insufficiency_reason": "Workflow/CLI paths coupled to GitHub event context; no request-time session auth, page-version preconditions, synchronous findings, or correction preservation."
    }
  ]
}
```

## Key Technical Decisions

- **Broker lives in `fro-bot/dashboard`, not the gateway and not `apps/broker`**: the dashboard already serves the authenticated operator surface on its own origin with server-side credentials; the gateway stays control-plane-agnostic by design; extending the OIDC credential broker would put GitHub write authority beside `CLIPROXY_MANAGEMENT_KEY` in the wrong trust domain.
- **Editor on the dashboard origin, entry on the wiki**: Edit links carry page identity + return URL; the input surface lives where origin/CSRF guarantees already hold. No credentialed CORS relaxation anywhere.
- **Gate code ships as an importable package (`@fro-bot/wiki-write-core`)**, extracted from existing scripts with the workflow CLIs consuming the same source — one implementation, pinned consumption, no runtime checkout or subprocess. Contract fixtures run against both entrypoints to prevent drift. Distribution: **git dependency pinned to an immutable commit** for the first cut (this repo has no package-publishing machinery — single private root package, no changesets, no publish workflow — and inventing a registry for one consumer is unjustified), contingent on a pnpm prototype proving subdirectory installation and Node 24 runtime consumption. Fallback if the prototype fails or a second consumer appears: public npm with deliberate release infrastructure. GitHub Packages rejected — private-registry credential plumbing in the dashboard deployment raises the auth blast radius for no requirement.
- **Page versioning by blob SHA** (optionally paired with the observed `data` head SHA); `node_id` is identity, not version. Stale saves return 409 with the draft preserved; no blind conflict retry — the existing `commitWikiChanges` retry loop is not used for operator saves without full refetch + revalidation.
- **Writer isolation**: the save API's commit step runs with a dedicated Fro Bot App write key scoped to this repo's `data` branch, materialized only to the writer component; hardcoded repo/branch/path allowlist; server-derived attribution; fixed commit format with correlation metadata.
- **Corrections are data, not instructions**: serialized into the survey prompt under an explicit delimited-data contract (precedent: the untrusted-target-repo block); survival verified mechanically by a wiki-lint finding kind, not by trusting the LLM.
- **Latency budget**: ≤5s p95, 10s hard deadline for the synchronous path; candidate-snapshot and privacy-resolution caching keyed by blob SHAs.

## Open Questions

### Resolved During Planning

- Broker placement: `fro-bot/dashboard` (operator decision; gateway stays control-plane-agnostic).
- Cross-origin auth: dissolved — editor and API share the dashboard origin.
- Validation-code consumption: published package over vendoring/subprocess/workflow-callback.
- Page-version definition: page blob SHA (+ observed head SHA).

### Deferred to Implementation

- Correction metadata file layout and exact schema fields (loose-then-tight; system-owned path under `knowledge/`): settled when Unit 3 touches real data.
- Survival-check matching (normalized-span rules, supersession mechanics): Unit 4, against real correction fixtures.
- Rendering-policy sanitizer specifics within the package: Unit 1, against Quartz's actual rendering pipeline.
- pnpm git-subdirectory dependency viability: Unit 1's acceptance prototype; if unworkable, escalate to the npm-registry fallback rather than improvising.
- Editor UX details (draft persistence, pending-state polling source): dashboard-side planning.

## Implementation Units

Units 1–6 land in this repo. Units 7–8 are cross-repo contracts to be planned in their owning repos; they are listed here for sequencing and requirements coverage.

- [ ] **Unit 1: Extract `@fro-bot/wiki-write-core` package**

**Goal:** One importable, published library holding the gate and commit machinery the save path needs; workflow CLIs consume the same source.

**Requirements:** R2, R3, R4, R6, R12

**Dependencies:** None

**Files:**
- Create: `packages/wiki-write-core/` (package source, exports: snapshot lint, wikilink validation, private-leak pure core + adapter interfaces, frontmatter reconstruction, rendering-policy validation, commit primitives with typed errors)
- Modify: `pnpm-workspace.yaml` (currently config-only — no `packages:` key; adding one changes hoisting semantics with `shamefullyHoist: true`, review deliberately), `tsconfig.json` / Vitest include globs as needed for the new package root
- Modify: `scripts/wiki-ingest.ts`, `scripts/wiki-lint.ts`, `scripts/check-private-leak.ts`, `scripts/wiki-repair.ts` (import from the package or re-export shared source; no behavior change)
- Test: `packages/wiki-write-core/src/*.test.ts`, contract fixtures exercising workflow CLI and package entrypoints against identical inputs

**Approach:**
- This repo has NO existing package/release machinery (verified: single private root package, no `.changeset/`, no publish workflow) — Unit 1 creates the package boundary from scratch: package-local `package.json` with explicit `exports`, runtime artifacts consumable by Node 24 strip-only TS, and a documented exact-pin/update procedure.
- Distribution per the Key Technical Decision: pinned git dependency first cut. Acceptance requires a working pnpm prototype: dashboard-side install of the subdirectory package at an immutable commit, with lockfile proof.
- `appendLogEntry` learns to render `manual-edit` operations distinctly (currently always `ingest`).
- Rendering policy placement (decided here, not deferred): the PRIMARY control is render-side — the Quartz build pipeline must sanitize/refuse unsafe HTML for ALL content regardless of writer (operator saves are only one of at least two writers; surveyor ingest is the other, and `quartz-site/` currently configures no sanitizer at all). The package's save-time validation is fast operator feedback, not the security boundary. Unit 1 delivers the save-side check; the render-side control lands in `quartz-site/` config/plugin within this plan's scope.

**Patterns to follow:** `wiki-repair.ts` composition; pure-core-privacy-gates learning.

**Test scenarios:**
- Happy path: a valid edit snapshot passes all gates and produces a commit payload with preserved system frontmatter.
- Error path: private-repo name in body → privacy finding, no commit payload; unsafe HTML → rendering finding.
- Edge case: edit to a page with node_id identity vs legacy page without; missing `data` branch → bootstrap path still works.
- Integration: CLI entrypoint and package entrypoint produce identical findings for identical fixtures (drift guard).

**Verification:** full repo gate green; `pnpm pack` produces a consumable artifact and the dashboard-side git-subdirectory install prototype succeeds with lockfile proof (this prototype runs BEFORE Unit 7 planning starts — a fallback to npm publishing changes that repo's dependency story); contract fixtures pass against both entrypoints.

- [ ] **Unit 2: Request-time privacy adapter**

**Goal:** The privacy scan runs outside workflow context: candidate content + current authority in, findings out, fail-closed on resolution failure.

**Requirements:** R4

**Dependencies:** Unit 1

**Files:**
- Create: adapter in `packages/wiki-write-core/` (interface + GitHub-backed implementation with batched resolution and caching keyed by `metadata/repos.yaml` blob SHA)
- Test: adapter tests covering resolution failure → fail closed

**Approach:** wrap `checkPrivateLeak`'s pure core; no `GITHUB_EVENT_PATH` or workflow_run assumptions; empty-vs-absent semantics live in the adapter shell per the shared-module learning.

**Test scenarios:**
- Happy path: public-only content passes.
- Error path: private name → finding; metadata unreadable → fail closed with distinct error (never silent pass).
- Edge: cache hit vs miss produce identical outcomes.

**Verification:** adapter usable with only a token + content, no workflow env.

- [ ] **Unit 3: Correction metadata schema and attribution**

**Goal:** System-owned storage for marked corrections: operator attribution (server-derived), correction spans, lifecycle state (active/superseded/retired/needs-reconfirmation).

**Requirements:** R8, R9, R11

**Dependencies:** Unit 1

**Files:**
- Create: schema + read/write module in `packages/wiki-write-core/` or `scripts/` (system-owned file under `knowledge/`)
- Modify: `scripts/check-wiki-authority.ts` — the corrections store MUST be a guarded path (requirement, not option): Unit 4 makes it fail-closed against ingest, so an unguarded store is a denial-of-service primitive on page regeneration
- Test: schema round-trip, lifecycle transitions, migration tolerance (loose-then-tight)

**Approach:** fields optional during rollout; corrections keyed to page node_id + span; never rendered into page content.

**Test scenarios:**
- Happy path: correction recorded with attribution; readable by survey tooling.
- Edge: correction on a page that later migrates slugs (node_id keying survives — integration with wiki-ingest migration).
- Error path: malformed corrections file → fail-soft read with warning, fail-hard write.

**Verification:** corrections survive a simulated page migration; guard behavior explicit.

- [ ] **Unit 4: Survey-loop correction injection and survival check**

**Goal:** Marked corrections reach the surveyor as delimited data and their survival is mechanically verified.

**Requirements:** R8, R10

**Dependencies:** Unit 3

**Files:**
- Modify: `.github/workflows/survey-repo.yaml` (assemble corrections context between prompt-resolve and agent-run; pass as explicitly delimited data block)
- Modify: `scripts/wiki-lint.ts` or ingest path (new deterministic finding kind: `correction-eroded`, fingerprinted per correction)
- Modify: `scripts/wiki-ingest.ts` (post-ingest survival verification against the corrections store)
- Test: workflow contract test for the injection step; lint tests for the finding; ingest tests for erosion detection

**Approach:** prompt contract mirrors the untrusted-target-repo precedent — corrections are data to preserve, isolated from instructions; enforcement is the mechanical check, not LLM compliance. Erosion blocks the ingest commit (fail-closed) and surfaces the finding. Context assembly follows the randomized-delimiter pattern at `survey-repo.yaml:183` (`EOF_$(openssl rand -hex 8)`) or passes a file path — correction text must never be able to forge step outputs in a job holding a PAT.

**Test scenarios:**
- Happy path: correction present in regenerated page → no finding, commit proceeds.
- Error path: correction absent → `correction-eroded` finding, ingest refuses that page, finding reaches the workflow summary.
- Edge: superseded/retired corrections don't block; needs-reconfirmation surfaces distinctly; absent corrections file → no-op.

**Verification:** end-to-end fixture: seeded correction + simulated regeneration missing it → blocked with finding.

- [ ] **Unit 5: Promotion cadence for operator edits**

**Goal:** An accepted edit reaches the published site in one sitting: data-branch pushes trigger the existing gated promotion pipeline instead of waiting for the weekly cron.

**Requirements:** success criterion 1; R16, R17 (pending state has a bounded horizon)

**Dependencies:** None (parallel)

**Files:**
- Modify: `.github/workflows/merge-data.yaml` (add a push-on-data trigger or a dispatchable fast-path with the same gates; least privilege unchanged)
- Test: workflow contract test updates

**Approach:**
- Add `push: branches: [data]` alongside the retained weekly cron and manual dispatch (verified compatible; `merge-data.yaml` currently has NO concurrency group).
- Coalesce by cancellation for pushes only: the concurrency group sets `cancel-in-progress` conditionally on the trigger (a push may cancel a queued/in-flight push run, but a `schedule`/`workflow_dispatch` run is never cancelable by a push) — otherwise a survey push landing during the Sunday cron would cancel the backstop itself, starving promotions silently.
- The promotion operation is already idempotent-friendly: `merge-data-pr.ts` reuses/updates the existing promotion PR rather than creating one per push (verified :127-146, :521-571) — keep it safely rerunnable.
- Scope note (verified): `merge-data-pr.ts` only CLASSIFIES and LABELS (`knowledge/`+`metadata/`-only diffs get `auto-merge`, else `needs-review`); the actual merge depends on repo automation consuming the label. Operator edits (knowledge/-only) ride the existing fast lane; this unit changes trigger cadence only, never the gate or label semantics.

**Test scenarios:** contract: push trigger present alongside cron/dispatch; concurrency configuration asserts a push run can never cancel a schedule/dispatch run (the exact conditional pinned); permissions unchanged; gate step ordering unchanged; existing-PR reuse behavior pinned.

**Verification:** a data push produces a promotion PR/merge through the existing gate path within the interactive horizon.

- [ ] **Unit 6: Wiki Edit affordance**

**Goal:** Every editable wiki page renders an Edit link carrying page identity and return URL into the dashboard editor; system pages and unauthenticated UX unchanged.

**Requirements:** R1, R13, R14

**Dependencies:** Unit 7's route contract (URL shape only)

**Files:**
- Modify: `quartz-site/local-plugin/` (new component or extension of the existing Sources component region), `quartz-site/quartz.config.yaml`
- Test: none — committed-dist plugin has no harness (per repo status quo); verification via build

**Approach:** static link construction from page frontmatter (node_id + slug); no credentials, no session awareness on the wiki side (R14 holds by construction — the link is inert for non-operators, who simply can't authenticate on the dashboard).

**Test expectation:** component rendering itself is harness-less (committed-dist plugin, per repo status quo); the LINK TARGET SHAPE is a cross-repo contract with Unit 7 and gets a config-level contract test in the style of `scripts/publish-wiki-workflow.test.ts` pinning the URL format.

**Verification:** local Quartz build renders the link on repo/topic pages, absent on index/log; link target matches Unit 7's contract.

- [ ] **Unit 7 (cross-repo contract — `fro-bot/dashboard`): Editor + save API + writer**

**Goal:** `/operator/wiki/edit` page and `/operator/wiki/pages/:nodeId` GET/POST: session revalidation per request, origin/CSRF binding, blob-SHA precondition (409 + draft preserved on mismatch), size/rate limits, synchronous gates via pinned `@fro-bot/wiki-write-core`, commit via a dedicated Fro Bot App write key held only by the writer component, pending-state UX until publish, structured audit records.

**Requirements:** R2–R7, R12–R18

**Dependencies:** Units 1, 2 published; Unit 3 schema for correction marking in the editor

**Planning note:** detailed planning happens in `fro-bot/dashboard` against this contract; this repo reviews the contract surface (route shapes, error taxonomy, latency budget ≤5s p95/10s hard).

- [ ] **Unit 8 (cross-repo contract — `marcusrbrown/infra`): Deployment wiring**

**Goal:** Writer credential (separate Fro Bot App write key) materialized only to the dashboard droplet's writer component; image/deploy updates; post-deploy save-path probe.

**Dependencies:** Unit 7

**Planning note:** planned in `marcusrbrown/infra`; no new droplet or public origin.

## System-Wide Impact

- **Interaction graph:** survey-repo workflow gains a context-assembly step; wiki-ingest gains survival verification; merge-data gains a trigger; the publish pipeline is unchanged.
- **Error propagation:** gate failures return synchronously to the editor; erosion blocks ingest commits fail-closed; promotion failures surface through the existing promotion gate reporting.
- **State lifecycle risks:** corrections store must survive page migrations (node_id-keyed, tested in Unit 3); ambiguous commit outcomes (timeout after ref update) return "outcome unknown" to the editor rather than retrying.
- **API surface parity:** none — no existing API changes; the gateway operator contract is untouched.
- **Integration coverage:** Unit 4's end-to-end erosion fixture; Unit 1's dual-entrypoint contract fixtures.
- **Unchanged invariants:** `data` sole-writer + tamper check (all commits remain Fro Bot-authored); `publicRepoEntryExists` and privacy gates; publish-wiki build contract; gateway operator API.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Writer compromise = valid Fro Bot commits the tamper check can't distinguish | Dedicated write key only in the writer; hardcoded repo/branch/path allowlist; fixed commit format with correlation metadata; server-derived attribution; audit records |
| Runtime gates drift from workflow gates | Single source consumed by both; exact version pinning; dual-entrypoint contract fixtures; coordinated rollout for security-affecting gate changes |
| Race/ambiguous GitHub outcomes on save | Blob-SHA precondition; no blind retry; 409 + preserved draft; head inspection on ambiguous failure |
| Correction spans unmatchable after heavy regeneration | Deterministic normalized-span matching defined against fixtures in Unit 4; needs-reconfirmation state instead of false erosion where ambiguous |
| Promotion-on-push spams the gate pipeline (12 survey pushes/day) | Cancelable concurrency group (newest wins) + existing-PR reuse; weekly cron backstop covers cancelled runs |
| Git-dependency distribution proves unworkable in pnpm | Prototype gate in Unit 1 acceptance; npm-registry fallback decided deliberately, not improvised |
| Promotion frequency turns fail-closed privacy gates into alert-fatigue generators (`FRO_BOT_POLL_PAT` runs weekly → ~12×/day) | Coalescing bounds run count; gate failures stay fail-closed but route to the existing reporting channel with dedup; watch the first weeks for fatigue signal before considering any relaxation |

## Documentation / Operational Notes

- `knowledge/schema.md` gains the corrections-store documentation when Unit 3 lands.
- `docs/status.md` / north-star: R3 editable path moves to in-progress once this plan's units start.
- Rollout order: Units 1–5 (this repo) → dashboard planning + build (Unit 7) → infra wiring (Unit 8) → enable the Edit affordance (Unit 6 ships last, dark until the API exists).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-29-editable-wiki-path-requirements.md](../brainstorms/2026-08-29-editable-wiki-path-requirements.md) — ships in the same PR as this plan.
- Related code: `scripts/wiki-ingest.ts`, `scripts/wiki-lint.ts`, `scripts/check-private-leak.ts`, `scripts/wiki-repair.ts`, `.github/workflows/survey-repo.yaml`, `.github/workflows/publish-wiki.yaml`, `quartz-site/local-plugin/`
- Related PRs: #3783 (node-ID identity), #3784 (wiki canonical identity)
- North-star: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md` (R3 editable path)
