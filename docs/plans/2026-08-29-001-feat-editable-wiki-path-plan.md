---
title: Editable Wiki Path — Dashboard-Backed Operator Edits
type: feat
status: active
date: 2026-08-29
origin: docs/brainstorms/2026-08-29-editable-wiki-path-requirements.md
deepened: 2026-08-29
---

# Editable Wiki Path — Dashboard-Backed Operator Edits

## Overview

Build the operator wiki-edit path: Edit links on the Quartz wiki deep-link into an editor served by `fro-bot/dashboard`, whose backend verifies the operator session and calls the private writer; the writer runs this repo's validation gates synchronously via a shared pinned library and commits accepted edits to the `data` branch under Fro Bot's identity. Marked corrections become durable constraints in the survey loop with a deterministic survival check. This repo owns the validation/commit library, the correction and survey-side machinery, the promotion cadence fix, and the wiki-side affordance; `fro-bot/dashboard` owns the editor, save API, and writer image; `marcusrbrown/infra` owns deployment wiring. `fro-bot/agent` is deliberately untouched — the gateway stays control-plane-agnostic.

## Problem Frame

The wiki is readable at `fro.bot/.github` but operator-uncorrectable except by issue round-trips through agent runs (see origin doc). The sole-writer invariant on `data` correctly forbids direct pushes, so an edit path must be authenticated, gate-validated, and committed as Fro Bot. The control plane is workflows-only and cannot host request-time HTTP; the dashboard already serves the authenticated operator surface on its own origin.

## Requirements Trace

Requirements R1–R18 from the origin doc. Unit coverage:

- R1 (wiki Edit affordance) → Unit 6
- R2, R3 (free-form raw markdown, system-owned frontmatter) → Units 1, 7a, 7b
- R4 (gate parity between runtime and workflow execution) → Units 1, 1b, 2, 7a, 7b
- R5 (synchronous gates, reject-with-reason) → Units 1, 2, 7a, 7b
- R6 (Fro Bot identity commit, sole-writer preserved) → Units 1, 7b
- R7 (session revalidation, origin/CSRF, version precondition, limits) → Units 7a, 7b
- R8–R11 (marked corrections, attribution, survival check, lifecycle) → Units 3, 4
- R12 (rendering policy) → Units 1, 7a, 7b
- R13, R14 (dashboard-origin auth, unauthenticated invisibility) → Units 6, 7a
- R15–R18 (interaction states, pending, conflict, draft preservation) → Units 7a, 7b
- Success criterion "live in one sitting" → Unit 5

## Scope Boundaries

- No gateway (`fro-bot/agent`) changes of any kind.
- No public/multi-operator editing; no editing outside `knowledge/wiki/{repos,topics,entities,comparisons}`.
- No WYSIWYG; raw markdown only.

### Deferred to Separate Tasks

- Dashboard editor implementation details (component design, draft persistence UX): planned in `fro-bot/dashboard` from this plan's Unit 7a contract.
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

- Cross-repo contract: the dashboard owns the authenticated editor and save API, a private writer owns GitHub mutation, and infra owns the writer's deployment boundary.

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

- **Dashboard owns the editor and save API; a private writer owns mutation**: `fro-bot/dashboard` handles operator auth, CSRF/origin verification, recent-auth enforcement, request validation, rate limiting, server-derived attribution, and the writer call. It never receives the Fro Bot App key and performs no GitHub writes. A separate private `wiki-writer` process/container owns commits and the Fro Bot App credential; its code and image live in `fro-bot/dashboard`, while its service definition, private network, and credential mount live in `marcusrbrown/infra/apps/dashboard/docker-compose.yaml`. `fro-bot/.github` remains workflows-only: no service, image, or deployment ownership.
- **Editor on the dashboard origin, entry on the wiki**: Edit links carry page identity + return URL; the input surface lives where origin/CSRF guarantees already hold. No credentialed CORS relaxation anywhere.
- **Gate code ships as an importable package (`@fro-bot/wiki-write-core`)**, extracted from existing scripts with the workflow CLIs consuming the same source — one implementation, pinned consumption, no runtime checkout or subprocess. Contract fixtures run against both entrypoints to prevent drift. Distribution is **a git subdirectory dependency pinned by immutable SHA**: pnpm subdirectory installation works with a clean lockfile and `--frozen-lockfile`, `private: true` is irrelevant to git installs, and exports resolve. Node 24 runtime consumption from real `node_modules` failed for strip-only TypeScript with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, so the package now ships committed compiled ESM `dist/`; all 13 subpath exports resolve to `dist/*.js` plus `dist/*.d.ts`. A real `node_modules` install and Node 24 execution gate pass. `GATE_CONTRACT_VERSION` and `GATE_SOURCE_TREE_HASH` are embedded in the artifact, and required CI check `Check Wiki Write Core Dist` fails if committed `dist/` drifts from a fresh build. npm publishing stays deferred until a second independent consumer appears or committed build output becomes painful. GitHub Packages remains rejected because private-registry credential plumbing adds auth blast radius without a requirement.
- **Page snapshots, not blob SHAs, are the concurrency contract**: `GET` returns an opaque edit-snapshot `ETag` covering page version and page-relevant correction state; the blob SHA is an input to that snapshot, not the contract itself. Writes require `If-Match`; a missing precondition returns 428, a stale snapshot returns 412 with the draft preserved, and a later branch-head race returns 409 unless the writer fully refetches and revalidates first. `node_id` is identity, not version. Ambiguous GitHub outcomes reconcile through the idempotency key, current blob, and commit correlation metadata; never blind retry.
- **Writer isolation**: the writer has no public port and no Caddy route, is reachable only from the dashboard server over a dedicated private network, and has outbound access restricted to required GitHub endpoints. Dashboard-to-writer authentication is separate and internal. The Fro Bot App write key is mounted only in the writer. The writer independently enforces repo (`fro-bot/.github`), branch (`data`), an explicit path allowlist, body limits, blob CAS, validation gates, and no-blind-retry; otherwise this is credential concealment, not privilege separation.
- **Sole-writer identity remains Fro Bot's**: the dashboard authenticates as a separate `DASHBOARD_GITHUB_APP_*` App, so it must not commit to `data`, widen `EXPECTED_AUTHORS`, or forge Fro Bot git author fields. The writer uses a separately managed private key for the existing Fro Bot App, minting installation tokens scoped to this repo with only the writer's required permissions. Before rollout, a canary commit on a disposable branch must verify GitHub reports `fro-bot[bot]`; after every production write, tip identity is checked and the writer is disabled loudly on mismatch.
- **Privilege separation has an honest limit**: it prevents credential exfiltration and arbitrary GitHub operations, but it cannot prevent a compromised dashboard from submitting in-scope wiki edits because the dashboard is the authenticated caller.
- **Request limits**: accept a 1 MiB request envelope and a 512 KiB decoded page body. The larger envelope covers JSON escaping and correction spans duplicating selected page text. Reject unsupported request compression, enforce byte limits before JSON parsing, and parse only after auth and CSRF. Three of the 46 live wiki pages already exceed 64 KiB (130.8/80.9/73.7 KiB), and three more are within 1.5% of it; a small cap would make roughly 13% of pages unsaveable on day one and rising.
- **Rate limiting**: retain the dashboard's coarse 60/min IP limiter and add a writer-specific authenticated limiter: save burst 3, sustained 10/min per operator, one in-flight save per page, and a small global writer concurrency cap starting at 2. Caddy owns the coarse external cap; the application owns identity- and page-scoped limiting.
- **Session step-up**: the existing 24-hour signed cookie remains for reading, but writes require authentication issued within the last 30 minutes. Return a step-up response and preserve the draft when needed. Wiki CSRF tokens bind to session identifier, action, and a bounded time window.
- **Gate-contract drift is fail-closed**: the writer fetches `packages/wiki-write-core/dist/gate-contract.json` from this repo's `main` through the GitHub API and compares its `version` with embedded `GATE_CONTRACT_VERSION`. Unit 1b generates that marker from the constant during the build, so the existing dist drift check makes divergence structurally impossible rather than merely detectable — a marker free to drift would invert the control, letting the writer approve a stale contract while reporting green. Cache the marker by `main` head SHA with a 5-minute TTL so the ≤5s p95 save budget absorbs at most one conditional request. A version mismatch refuses writes. Fetch failure is not a mismatch: with a cached value inside a 1-hour bounded staleness ceiling, proceed on cache, log a warning, and surface staleness in readiness/audit metadata; with no cache or past the ceiling, refuse writes because the contract cannot be established. Fail-closed on mismatch is correct; fail-closed on transient unavailability is an outage wearing a security control's clothes.
- **Draft persistence is required**: drafts survive step-up auth, session expiry, 412 responses, and network failures.
- **Corrections are data, not instructions**: serialized into the survey prompt under an explicit delimited-data contract (precedent: the untrusted-target-repo block); survival verified mechanically by a wiki-lint finding kind, not by trusting the LLM.
- **Latency budget**: ≤5s p95, 10s hard deadline for the synchronous path; candidate-snapshot and privacy-resolution caching keyed by blob SHAs.

## Open Questions

### Resolved During Planning

- Component placement: dashboard editor/save API, private `wiki-writer` process in the dashboard deployment, and workflows-only `fro-bot/.github`; the gateway stays control-plane-agnostic.
- Cross-origin auth: dissolved — editor and API share the dashboard origin.
- Validation-code consumption: importable package pinned to a git subdirectory by immutable SHA; committed compiled `dist/` makes real Node 24 `node_modules` consumption work. npm publishing is deferred until a second independent consumer appears or committed build output becomes painful.
- Page-version definition: opaque edit-snapshot `ETag` covering page version and page-relevant correction state; `node_id` remains identity, not version.
- Sole-writer identity: the private writer mints repo-scoped installation tokens for the existing Fro Bot App; the Dashboard App never commits to `data`.
- Writer boundary: private-network reachability from dashboard only, no public port or Caddy route, restricted GitHub egress, separate internal auth, and independent constraint enforcement.
- Dashboard write-path invariant: `fro-bot/dashboard`'s `AGENTS.md` currently says “never add a write code path,” which this design makes false. It is rewritten honestly rather than reinterpreted — read-only by default with one isolated wiki-write capability, `DASHBOARD_GITHUB_APP_*` strictly read-only and never minting write tokens, and the only write authority being the separately deployed writer scoped to `fro-bot/.github:data` under an explicit path allowlist. The cost is stated plainly in that document: dashboard authentication compromise can now produce valid wiki edits. Any additional write target requires approval and a new threat model. Prerequisite for Unit 7a, owned by `fro-bot/dashboard`.

### Deferred to Implementation

- Correction metadata file layout and exact schema fields (loose-then-tight; system-owned path under `knowledge/`): settled when Unit 3 touches real data.
- Survival-check matching (normalized-span rules, supersession mechanics): Unit 4, against real correction fixtures.
- Rendering-policy sanitizer selection (which sanitizer/rehype configuration the Quartz build uses): Unit 1, placement already decided — render-side primary, save-side feedback.
- Editor UX details (draft persistence, pending-state polling source): dashboard-side planning.

## Implementation Units

Units 1–6 (including 1b) land in this repo. Units 7–8 are cross-repo contracts to be planned in their owning repos; they are listed here for sequencing and requirements coverage.

- [x] **Unit 1: Extract `@fro-bot/wiki-write-core` package**

**Goal:** One importable library (git-dependency-pinned) holding the gate and commit machinery the save path needs, with workflow CLIs consuming the same source — plus the render-side sanitizer in the Quartz build, live before any operator save path exists.

**Requirements:** R2, R3, R4, R6, R12

**Dependencies:** None

**Files:**
- Create: `packages/wiki-write-core/` (package source, exports: snapshot lint, wikilink validation, private-leak pure core + adapter interfaces, frontmatter reconstruction, rendering-policy validation, commit primitives with typed errors)
- Modify: `pnpm-workspace.yaml` (currently config-only — no `packages:` key; adding one changes hoisting semantics with `shamefullyHoist: true`, review deliberately), `tsconfig.json` / Vitest include globs as needed for the new package root, `quartz-site/` config/plugin for the render-side sanitizer (see rendering-policy decision below)
- Modify: `scripts/wiki-ingest.ts`, `scripts/wiki-lint.ts`, `scripts/check-private-leak.ts`, `scripts/wiki-repair.ts` (import from the package or re-export shared source; no behavior change)
- Test: `packages/wiki-write-core/src/*.test.ts`, contract fixtures exercising workflow CLI and package entrypoints against identical inputs

**Approach:**
- This repo has NO existing package/release machinery (verified: single private root package, no `.changeset/`, no publish workflow) — Unit 1 creates the package boundary from scratch: package-local `package.json` with explicit `exports`, runtime artifacts consumable by Node 24 strip-only TS, and a documented exact-pin/update procedure.
- Distribution per the Key Technical Decision: pinned git dependency first cut. Acceptance requires a working pnpm prototype: dashboard-side install of the subdirectory package at an immutable commit, with lockfile proof.
- `appendLogEntry` learns to render `manual-edit` operations distinctly (currently always `ingest`).
- Rendering policy placement (decided here, not deferred): the PRIMARY control is render-side — the Quartz build pipeline must sanitize/refuse unsafe HTML for ALL content regardless of writer (operator saves are only one of at least two writers; surveyor ingest is the other, and `quartz-site/` currently configures no sanitizer at all). The package's save-time validation is fast operator feedback, not the security boundary. Unit 1 owns BOTH: the save-side check in the package AND the render-side sanitizer in `quartz-site/` config — the render-side control must be live before Unit 7 makes operator saves possible, so it cannot ride with Unit 6 (which ships last).

**Patterns to follow:** `wiki-repair.ts` composition; pure-core-privacy-gates learning.

**Test scenarios:**
- Happy path: a valid edit snapshot passes all gates and produces a commit payload with preserved system frontmatter.
- Error path: private-repo name in body → privacy finding, no commit payload; unsafe HTML → rendering finding.
- Edge case: edit to a page with node_id identity vs legacy page without; missing `data` branch → bootstrap path still works.
- Integration: CLI entrypoint and package entrypoint produce identical findings for identical fixtures (drift guard).
- Integration (render-side control): a fixture page containing scriptable content, built through the local Quartz pipeline, produces inert output — the primary security control gets a build-level assertion, not just a config edit.

**Verification:** full repo gate green; `pnpm pack` produces a consumable artifact and the dashboard-side git-subdirectory install prototype succeeds with lockfile proof (this prototype runs BEFORE Unit 7 planning starts — a fallback to npm publishing changes that repo's dependency story); contract fixtures pass against both entrypoints.

- [ ] **Unit 1b: Gate-contract marker and drift test**

**Goal:** The control plane publishes a fetchable contract marker so the writer's drift check has a real counterparty instead of comparing its embedded constant against itself.

**Requirements:** R4 (gate parity between runtime and workflow execution)

**Dependencies:** Unit 1. Must land before Unit 7b starts.

**Files:**
- Modify: `scripts/build-wiki-write-core.ts` (emit the marker as a build artifact)
- Create: `packages/wiki-write-core/dist/gate-contract.json` (generated, committed: `{"version": <GATE_CONTRACT_VERSION>}`)

**Approach:** generate the marker from `GATE_CONTRACT_VERSION` during the build rather than committing a hand-maintained file beside a test that checks it. The build already substitutes a derived value into a built artifact and `--check` already tree-compares committed output against a fresh build, so the existing required `Check Wiki Write Core Dist` enforces the mirror for free — no second gate to keep green. A test detects drift after the fact; a generated artifact cannot drift at all, and this repo already owns the machine for it. The marker ships under `dist/`, equally reachable through the contents API.

The write seam is load-bearing and has exactly one correct position: inside `main()` between the `tsc` invocation and the `checkOnly` branch, beside `embedSourceTreeHash`, writing into `temporaryRoot`. Writing to `distRoot` directly instead means the next build's atomic directory swap deletes the marker, and nothing surfaces it until the writer starts refusing writes against a 404. Writing after `compareTrees` means `--check` never sees the file, restoring the exact drift this design eliminates while labelled as structural. This would also be the first non-`.js`/`.d.ts` file in `dist/` — the path is unexercised, so run the scenarios below rather than reasoning about them.

**Test scenarios:** hand-editing the generated marker fails `check:wiki-write-core-dist`; bumping `GATE_CONTRACT_VERSION` without rebuilding fails it; a rebuilt pair passes.

**Verification:** the drift check fails against a hand-edited marker and passes against the committed one.

- [x] **Unit 2: Request-time privacy adapter**

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

- [x] **Unit 3: Correction metadata schema and attribution**

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

- [x] **Unit 4: Survey-loop correction injection and survival check**

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

- [x] **Unit 5: Promotion cadence for operator edits**

**Goal:** An accepted edit reaches the published site in one sitting: the private writer dispatches the existing gated promotion pipeline instead of waiting for the weekly cron.

**Requirements:** success criterion 1; R16, R17 (pending state has a bounded horizon)

**Dependencies:** None (parallel)

**Files:**
- Modify: `.github/workflows/merge-data.yaml` (add a repository-dispatch fast path with the same gates; least privilege unchanged)
- Test: workflow contract test updates

**Approach:**
- Add `repository_dispatch` with an explicit `promote-data` type alongside the retained weekly cron and manual dispatch. The private writer fires it after a successful `data` commit, while survey writes continue to use the weekly backstop.
- Execute the fast path from `main`'s workflow definition and scripts: `data` carries executable copies under `scripts/` and `.github/workflows/` and is autonomously written without branch protection, so a push trigger would invert the trust boundary and let the promoted branch decide how it is checked.
- Coalesce automated dispatch runs by cancellation via TRIGGER-DISCRIMINATED GROUPS: repository-dispatch runs share one group (cancel-in-progress among themselves, newest wins) while `schedule`/`workflow_dispatch` runs live in a separate group a dispatch can never reach — e.g. `group: merge-data-${{ github.event_name == 'repository_dispatch' && 'dispatch' || 'manual' }}`. A single group with a conditional `cancel-in-progress` flag does NOT work: the flag is evaluated on the incoming run and applied to whatever is in progress, so a dispatch would still cancel the Sunday cron and starve the backstop.
- The promotion operation is already idempotent-friendly: `merge-data-pr.ts` reuses/updates the existing promotion PR rather than creating one per dispatch (verified :127-146, :521-571) — keep it safely rerunnable.
- Scope note (verified): `merge-data-pr.ts` only CLASSIFIES and LABELS (`knowledge/`+`metadata/`-only diffs get `auto-merge`, else `needs-review`); the actual merge depends on repo automation consuming the label. Operator edits (knowledge/-only) ride the existing fast lane; this unit changes trigger cadence only, never the gate or label semantics.

**Test scenarios:** contract: explicit `repository_dispatch` type present alongside cron/dispatch and `push` absent; the concurrency GROUP KEY discriminates by trigger (asserting the flag alone can pass against a broken single-group config — the test must pin the group-key split); first checkout pins `main`; permissions unchanged; gate step ordering unchanged; existing-PR reuse behavior pinned. Unit: identical data/grandfather snapshots are rejected as a caller error (or an unattributable stem is still flagged).

**Verification:** a `promote-data` repository dispatch produces a promotion PR/merge through the existing gate path within the interactive horizon.

- [ ] **Unit 6: Wiki Edit affordance**

**Goal:** Every editable wiki page renders an Edit link carrying page identity and return URL into the dashboard editor; system pages and unauthenticated UX unchanged.

**Requirements:** R1, R13, R14

**Dependencies:** Unit 7a's route contract (URL shape only)

**Files:**
- Modify: `quartz-site/local-plugin/` (new component or extension of the existing Sources component region), `quartz-site/quartz.config.yaml`
- Test: component rendering none (harness-less committed-dist plugin); link target shape gets the contract test below

**Approach:** static link construction from page frontmatter (node_id + slug); no credentials, no session awareness on the wiki side (R14 holds by construction — the link is inert for non-operators, who simply can't authenticate on the dashboard).

**Test expectation:** component rendering itself is harness-less (committed-dist plugin, per repo status quo); the LINK TARGET SHAPE is a cross-repo contract with Unit 7a and gets a config-level contract test in the style of `scripts/publish-wiki-workflow.test.ts` pinning the URL format.

**Verification:** local Quartz build renders the link on repo/topic pages, absent on index/log; link target matches Unit 7a's contract.

- [ ] **Unit 7a (cross-repo contract — `fro-bot/dashboard`): Editor UI and save API**

**Goal:** The dashboard owns the editor UI and public save API: `/operator/wiki/edit` and `/operator/wiki/pages/:nodeId` GET/POST with authenticated, draft-preserving saves.

**Requirements:** R2–R5, R7, R12–R18

**Dependencies:** Units 1, 2 landed and consumable; Unit 3 schema for correction marking in the editor

**Planning note:** `fro-bot/dashboard` follows its existing React-state view switching in `web/src/App.tsx`; it does not introduce a router. The API revalidates the session per request, enforces origin/CSRF, recent-auth step-up, request/body limits, authenticated and page-scoped rate limits, opaque edit-snapshot `ETag`/`If-Match` semantics (428/412/409), server-derived attribution, draft persistence, and pending-state UX. Established mutation posture from `web/src/push/subscribe.ts` is mandatory: `credentials: 'include'`, `redirect: 'error'`, CSRF fetched before mutations, and `idempotency-key`. Do not copy its bounded POST retry; GitHub commits are not safely retryable. The dashboard performs no GitHub writes and never receives the Fro Bot App key; it authenticates and calls Unit 7b. The `AGENTS.md` write-path invariant must be updated before this unit starts.

**Test scenarios:** authenticated editor load and save; unauthenticated invisibility; missing/invalid CSRF and origin; stale/missing `If-Match`; body and envelope limits; rate-limit boundaries; step-up response with draft preservation; network failure with draft preservation; idempotency key propagation; no retry after an ambiguous writer response; pending state after accepted commit; route contract matches Unit 6.

**Verification:** dashboard tests cover the route/error contract and full mutation posture; the save API reaches the private writer without GitHub credentials in the dashboard process; drafts survive every specified failure state.

- [ ] **Unit 7b (cross-repo contract — `fro-bot/dashboard`): Private wiki-writer service**

**Goal:** The private `wiki-writer` process/container owns the commit path and existing Fro Bot App credential, executes gates through the pinned `@fro-bot/wiki-write-core`, and enforces the complete privilege boundary independently.

**Requirements:** R2–R7, R12, R15–R18

**Dependencies:** Unit 7a's writer-call contract; Units 1, 1b, 2 landed and consumable; Unit 3 schema for correction marking

**Planning note:** the writer has no public port or Caddy route and is reachable only from the dashboard server over a dedicated private network with restricted GitHub egress and separate internal authentication. It mounts only the separately managed private key for the existing Fro Bot App, mints repo-scoped installation tokens, and refuses any repo other than `fro-bot/.github`, branch other than `data`, or path outside the explicit allowlist. It independently enforces body limits, blob CAS, gate-contract version, validation gates, idempotency/reconciliation, commit correlation metadata, no-blind-retry, and Fro Bot tip identity. For gate-contract drift, it fetches `packages/wiki-write-core/dist/gate-contract.json` from this repo's `main` through the GitHub API and compares `version` with embedded `GATE_CONTRACT_VERSION`. Unit 1b generates that marker and must land first. Cache by `main` head SHA with a 5-minute TTL and allow a cached value for at most 1 hour of bounded staleness: mismatch refuses writes, while fetch failure uses fresh-enough cache with a warning and readiness/audit staleness metadata; no cache or expired cache refuses writes. Fail-closed on mismatch is correct; fail-closed on transient unavailability is an outage wearing a security control's clothes. A compromised dashboard may still submit in-scope edits; the boundary prevents credential exfiltration and arbitrary GitHub operations, not abuse of the dashboard's authenticated edit capability.

**Test scenarios:** valid commit with preserved system frontmatter; rejection of wrong repo/branch/path, oversized body, stale blob, contract drift, invalid gates, and missing internal auth; ambiguous GitHub outcome reconciled without blind retry; canary and production tip identity checks; writer concurrency and per-page in-flight limits; dashboard cannot read the Fro Bot key.

**Verification:** writer tests cover independent enforcement and reconciliation; a disposable-branch canary reports `fro-bot[bot]`; real Node 24 consumption of all 13 pinned package exports passes; no writer endpoint is public or routed through Caddy.

- [ ] **Unit 8 (cross-repo contract — `marcusrbrown/infra`): Deployment wiring**

**Goal:** Define and deploy the private writer service alongside the existing dashboard deployment: service definition, private network, credential mount, image/deploy updates, and post-deploy save-path probe.

**Dependencies:** Units 7a and 7b

**Planning note:** `marcusrbrown/infra` adds the writer service to `apps/dashboard/docker-compose.yaml`, which currently runs `caddy` and `dashboard` pulling `ghcr.io/fro-bot/dashboard`. The writer remains on the dedicated private network, has no public port or Caddy route, mounts the separately managed Fro Bot App key only into the writer, and receives the dashboard image/deploy updates. No new droplet and no new public origin. `marcusrbrown/infra` owns operational rotation and revocation of the writer key and maintains an inventory recording which key is deployed where. Rotation and revocation are a two-party operation with `fro-bot/dashboard`: dashboard owns the writer image/config changes and infra owns the deployed secret plus GitHub App revocation. If the writer key leaks, revoke that key, remove it from the infra secret mount and writer deployment, deploy the replacement, and keep operator saves disabled until the canary and tip-identity checks pass. Pulling the writer key does not interrupt autonomous survey writes: those 16 workflows authenticate with `secrets.APPLICATION_PRIVATE_KEY`, a distinct key object on the same App, so revoking the writer's key pauses only operator wiki writes until replacement validation completes. That containment holds at the key tier ONLY. Suspending the App installation or rotating the App itself takes the entire control plane dark — survey, promotion, reconcile, and every other autonomous loop. The runbook must name that escalation tier explicitly, because an operator reaching for the bigger hammer mid-incident will otherwise still believe the narrower reassurance applies. Verify the save path after deployment, including the Fro Bot tip-identity check.

## System-Wide Impact

- **Interaction graph:** survey-repo workflow gains a context-assembly step; wiki-ingest gains survival verification; merge-data gains a trigger; the publish pipeline is unchanged.
- **Error propagation:** gate failures return synchronously to the editor; erosion blocks ingest commits fail-closed; promotion failures surface through the existing promotion gate reporting.
- **State lifecycle risks:** corrections store must survive page migrations (node_id-keyed, tested in Unit 3); ambiguous commit outcomes (timeout after ref update) return "outcome unknown" to the editor rather than retrying.
- **API surface parity:** none — no existing API changes; the gateway operator contract is untouched.
- **Integration coverage:** Unit 4's end-to-end erosion fixture; Unit 1's dual-entrypoint contract fixtures.
- **Unchanged invariants:** `data` sole-writer + tamper check remains true because only Unit 7b authenticates the ref mutation with the existing Fro Bot App; the Dashboard App never commits and git author fields are not treated as the authority boundary. `publicRepoEntryExists` and privacy gates; publish-wiki build contract; gateway operator API.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Writer compromise = valid Fro Bot commits the tamper check can't distinguish | Dedicated write key only in the writer; hardcoded repo/branch/path allowlist; fixed commit format with correlation metadata; server-derived attribution; audit records. Dashboard compromise can still submit in-scope edits, which is the honest limit of this boundary |
| Writer key leaks or requires rotation | `marcusrbrown/infra` owns revocation/rotation and a deployed-key inventory; coordinate the two-party operation with `fro-bot/dashboard` to remove the old mount, deploy the replacement, and rerun canary/tip-identity checks. Pulling the writer key pauses operator saves but does not interrupt autonomous survey writes, which use their separate credential |
| Runtime gates drift from workflow gates | Single source consumed by both; exact version pinning; dual-entrypoint contract fixtures; coordinated rollout for security-affecting gate changes |
| Race/ambiguous GitHub outcomes on save | Opaque edit-snapshot `ETag` + required `If-Match`; 428 when missing, 412 when stale, 409 for a later branch-head race; reconcile ambiguous outcomes with idempotency key, current blob, and commit correlation metadata; preserve the draft and never blind retry |
| Correction spans unmatchable after heavy regeneration | Deterministic normalized-span matching defined against fixtures in Unit 4; needs-reconfirmation state instead of false erosion where ambiguous |
| Promotion dispatch can spam the gate pipeline (12 survey writes/day) | Unit 5 uses `repository_dispatch`, not `push`: dispatch runs coalesce in their own concurrency group (newest wins), while cron/manual-dispatch runs are in a separate group that dispatch cannot cancel; existing-PR reuse remains |
| Git-subdirectory distribution fails in real Node 24 consumption | Resolved: pnpm subdirectory installation and frozen lockfile pass; committed compiled `dist/` makes all 13 exports consumable from real `node_modules`; required `Check Wiki Write Core Dist` fails closed on drift. npm publishing stays deferred until a second independent consumer appears or committed output becomes painful |
| Promotion frequency turns fail-closed privacy gates into alert-fatigue generators (`FRO_BOT_POLL_PAT` runs weekly → ~12×/day) | Coalescing bounds run count; gate failures stay fail-closed but route to the existing reporting channel with dedup; watch the first weeks for fatigue signal before considering any relaxation |

## Documentation / Operational Notes

- `knowledge/schema.md` gains the corrections-store documentation when Unit 3 lands.
- `docs/status.md` / north-star: R3 editable path moves to in-progress once this plan's units start.
- Rollout order: Units 1–5 (this repo, done) → Unit 1b gate-contract marker (this repo, gates Unit 7b) → dashboard AGENTS.md prerequisite → dashboard Unit 7a editor/save API → dashboard Unit 7b private writer → infra Unit 8 wiring and post-deploy probe → enable the Unit 6 Edit affordance last, dark until the API and writer exist.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-29-editable-wiki-path-requirements.md](../brainstorms/2026-08-29-editable-wiki-path-requirements.md) — ships in the same PR as this plan.
- Related code: `scripts/wiki-ingest.ts`, `scripts/wiki-lint.ts`, `scripts/check-private-leak.ts`, `scripts/wiki-repair.ts`, `.github/workflows/survey-repo.yaml`, `.github/workflows/publish-wiki.yaml`, `quartz-site/local-plugin/`
- Related PRs: #3783 (node-ID identity), #3784 (wiki canonical identity)
- North-star: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md` (R3 editable path)
