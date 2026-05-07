---
title: Private-repo handling
type: feat
status: draft
date: 2026-05-05
---

## Posture

Fro Bot operates inside private repos under a strict invariant: **no information about a private repo's existence, contents, or activity appears anywhere outside that repo**. This is a posture, not a feature. v1 establishes the gates going forward; existing leaks are enumerated and either remediated or explicitly accepted.

The posture lives in code, gates, and CI — never in the persona doc, agent prompts, or written guidance. The persona doc may reference the posture; it does not own it.

The posture rejects four nearby alternatives by name:

- **Half-secrets.** Redacted or sanitized public-wiki pages ("an undisclosed private project exists") leak more than full silence. Acknowledging that *something* is hidden is itself disclosure. Rejected.
- **Decline private invitations.** Refusing private-repo invitations at allowlist time is loss without need. Fro Bot can be useful inside private repos; the question is what it does *outside* them. Rejected.
- **Private wiki infrastructure.** A separate `fro-bot/private-knowledge` repo or per-repo `.fro-bot/wiki/` folders are deferred. Cross-repo wiki context for private repos is intentionally lost. Reconsidered when (a) more than 50% of tracked repos are private, OR (b) a specific cross-repo synthesis fails because of missing private context, OR (c) a piece of operational knowledge is identified as worth more than a second-wiki maintenance cost.
- **Two-form metadata (operator-canonical on `data`, redacted on `main`).** Verified during planning: `origin/data` is publicly readable to any unauthenticated git client (`git clone --depth=1 https://github.com/fro-bot/.github && git fetch origin data:data && git show data:metadata/repos.yaml`). Both branches of `fro-bot/.github` are equally public-visible; only write semantics differ via branch protection. A "redact in transit" lifecycle would be theater. Rejected.

The chosen architecture is **always-redacted-everywhere**: `metadata/repos.yaml` on both `data` and `main` carries `owner: '[REDACTED]'` + `name: <node_id>` for `private: true` entries. The operator's canonical lookup is via the GitHub API (`gh api /repos/{owner}/{repo}` resolves `node_id` → `owner/name` when needed). A small operator-only script (`scripts/resolve-private.ts`, runs locally, requires Marcus's PAT) provides the lookup convenience that YAML-grep used to provide.

## Problem

`marcusrbrown/poly` is the first private repo Fro Bot has been invited to. The existing pipeline produced multiple leaks before this brainstorm reached the plan:

- **Two commits on `main`** name `poly` in their subject lines:
  - `cb5811e` — `chore(metadata): add marcusrbrown/poly from invitation polling`
  - `d92d12c` — `chore(reconcile): record survey failure for marcusrbrown/poly`
- **Workflow run 25395917616** (Survey Repo) leaks the slug in workflow log content — `WIKI_TARGET=repo:marcusrbrown/poly`, `WIKI_SUMMARY`, `WIKI_COMMIT_MESSAGE`, `WIKI_SOURCES`, the `WikiIngestError` stderr, dispatch input parameters in the run details panel, and the concurrency group name `survey-repo-marcusrbrown-poly`. Public Actions tab. Permanent.
- **`metadata/repos.yaml`** on both `data` and `main` currently names `poly`.

The Survey Repo run failed before any wiki page was committed (the agent emitted a `[[Note]]` orphan wikilink and `validateWikilinks` rejected the commit). So no `knowledge/wiki/repos/marcusrbrown--poly.md` exists. But the architectural intent of the existing pipeline — given a successful run — is to write `poly`'s name, description, README excerpts, and topic associations to a publicly readable wiki at that path.

Once we trace every public artifact `fro-bot/.github` produces, the surface is broader than the wiki:

- **`metadata/repos.yaml`** on both branches.
- **Autonomous commit messages.** `addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`, and `commit-metadata.ts` write messages that name the repo. These messages are forever-public via git log and the GitHub UI commit list, regardless of which branch they're committed to.
- **`knowledge/wiki/`**, `knowledge/index.md`, `knowledge/log.md` (the original concern).
- **`social-broadcast.yaml`** posts surveyed-repo slugs to Discord and Bluesky on survey success. Both surfaces are public third-party.
- **Workflow run names, concurrency groups, dispatch inputs, JSON summaries** echo `owner/repo` strings into `fro-bot/.github`'s public Actions tab. Workflow run IDs are durable and indexable.
- **`reconcile-repos.ts` issue rendering** already redacts private-repo names in `pending-review` issues using `node_id` (the existing pattern this posture extends).
- **`fro-bot.yaml` daily-report and journal cross-repo posts** (if implemented in any cross-repo way; in-repo posts inherit private-repo visibility by App-token scoping).

Plus four failure modes that survive the listing above:

- **Probe coercion.** Existing code does `private: r.private === true`. A missing or null field collapses to `false`. Fail-open by construction.
- **Manual `workflow_dispatch` bypass.** `survey-repo.yaml` and `poll-invitations.yaml` accept arbitrary `owner/repo` inputs. A `gh workflow run` call bypasses any caller-side gate.
- **Visibility transitions.** A public repo flipping to private leaves its previously-written wiki page in `fro-bot/.github`'s git history forever. The leak is permanent and not auto-recoverable.
- **Probe failure modes.** HTTP 404 (access lost), 451 (DMCA/blocked), 304 (cached), or 200-with-malformed-body each carry different semantics. A binary "explicit-true / else" model collapses these and fails open for previously-public repos that lose access.

## Goals

- No information about a private repo's existence, contents, or activity appears in **new** public artifacts `fro-bot/.github` produces after this work lands. Public artifacts include: the wiki, `metadata/repos.yaml` on either branch, `knowledge/index.md`, `knowledge/log.md`, autonomous commit messages, social-broadcast posts, public workflow logs, public run names, concurrency group names, dispatch input parameters, and any future surface.
- Existing leaks (commit subjects on `main`, workflow run logs, current `metadata/repos.yaml` content on both branches) are enumerated and remediated according to a per-surface decision: history rewrite, run deletion, in-place redaction, or explicit accepted-disclosure.
- Fro Bot continues to operate normally inside private repos: PR review, issue triage, Renovate dispatch, and in-repo journal/issue activity all run.
- Privacy is enforced at every public-artifact write boundary, not at any single caller. Every dispatch site (`reconcile-repos.ts` classifyTracked, `survey-repo.yaml` workflow, `poll-invitations.yaml` workflow, `fro-bot.yaml` event handler, manual operator commands) carries a gate.
- Privacy violations are detectable in CI, not in production. A future code change that accidentally bypasses a gate fails CI before merging.
- The `private` flag becomes a stated convention: any pipeline producing artifacts on either branch or any public channel MUST consult `private` and document its handling. New pipelines without explicit private-handling are presumed broken.
- The redacted-everywhere model is observable by external testing: `git fetch origin data:data && git show data:metadata/repos.yaml | grep -i poly` returns nothing after this work lands.

## Non-Goals

- **Private wiki infrastructure** (deferred per Posture; reconsider triggers stated above).
- **Redacted/sanitized public wiki pages** (Posture: half-secrets rejected).
- **Declining private invitations** (Posture: accept and operate inside).
- **Auto-purge of git history on visibility transitions.** v1 detects transitions and alerts; rewriting `fro-bot/.github`'s git history for transition cases is operator-decided.
- **Org-wide visibility policies.** Each repo probed individually.
- **Visibility-aware discovery.** The survey-cadence-and-multi-channel-discovery work (sibling document) does not change. Channels (`collab`, `owned`, `contrib`) are orthogonal to visibility.
- **Resolving the `[[Note]]` orphan-wikilink agent prompt bug.** Tracked separately as a content-quality issue.
- **Recovering canonical owner/name from a redacted entry programmatically inside `fro-bot/.github`.** The operator looks up via API; the bot never needs the canonical form for public-facing operations. Any internal operation that genuinely needs canonical (e.g., dispatching a workflow against the repo) calls the GitHub API to resolve `node_id` → `owner/name` at the moment of use.

## Users and Stakeholders

- **Operator (Marcus).** Wants Fro Bot helpful inside private repos without leaking their existence to any public surface. Accepts the operator-API-lookup tax in exchange for a verifiable redaction-everywhere invariant.
- **Fro Bot agent.** Continues to read the public wiki for cross-public-repo context during private-repo PR review. Loses wiki context *about* private repos by design.
- **Anyone reading `fro-bot/.github` publicly** (including via search, forks, or archive.org). Sees no trace of private repos in any artifact going forward; sees the explicitly-documented existing-leak surfaces in the v1 acceptance section if remediation is not chosen.
- **Future Fro Bot features.** Inherit the posture and the `private` flag as a convention.

## Functional Requirements

### Existing-leak handling

#### R0 — Enumerate and remediate existing leaks before v1 lands

Before any v1 unit ships, enumerate the existing leak surfaces for `marcusrbrown/poly`:

- Commit `cb5811e` on `main` — subject names the repo
- Commit `d92d12c` on `main` — subject names the repo
- Current `metadata/repos.yaml` content on both `data` and `main` — entry has `owner: marcusrbrown`, `name: poly`
- Workflow run `25395917616` (and any earlier runs) — log content names the repo in 7+ places

For each surface, choose one of:

- **Remediate**: rewrite git history (force-push) for commits; delete workflow runs via `gh api`; rewrite `metadata/repos.yaml` to redacted form on both branches in a single PR.
- **Accept**: explicitly document the leak as accepted disclosure with a short justification (e.g., "a single repo name in two commit subjects is below the disclosure threshold the posture is defending against").

The plan's success criteria for v1 (SC1) are conditional on this decision. If remediation is chosen, SC1 covers the post-remediation state. If acceptance is chosen, SC1 covers only future writes.

### Data model

#### R1 — Privacy field tracked in `metadata/repos.yaml`

`RepoEntry` gains an optional `private: boolean` field (loose-then-tight). Stored alongside `has_renovate` and `has_fro_bot_workflow`. The boolean flag itself is non-sensitive when paired with always-redacted owner/name (R6).

#### R2 — `node_id` field tracked in `metadata/repos.yaml`

`RepoEntry` gains a `node_id: string` field (required for new entries; backfilled for existing entries during the migration). `node_id` is the lookup key for redacted entries — without it, `metadata/repos.yaml` on either branch cannot disambiguate redacted entries.

`node_id` is non-secret in itself: it's a GitHub-internal identifier resolvable only via the API by an authenticated client. It does not leak the repo's name to public readers of `fro-bot/.github`.

### Probe pipeline

#### R3 — Reconcile probes `private` with explicit state semantics

`reconcile-repos.ts` adds `private` to the existing `fieldProbes` pass. Five states must be distinguished:

- **`public`** — API explicitly returns `private: false`.
- **`private`** — API explicitly returns `private: true`.
- **`access-lost`** — HTTP 404, 451, or 403 with block-reason body. The repo may be private and we lost access, or deleted, or transferred. Treat as `private` (fail-closed) and trigger a transition alert if the entry was previously `public`.
- **`transient`** — HTTP 5xx, network error, rate limit. Preserve prior `private` value (sticky).
- **`malformed`** — HTTP 200 with `private` field absent or non-boolean. Preserve prior + log a structured diagnostic. Treated as `transient` for sticky preservation but emits a separate signal.

`access-lost` is NOT collapsed into `transient`. The asymmetric handling (fail-closed when access is genuinely lost; preserve-prior on transient errors) prevents the fail-open path where a previously-public repo flips to private and the probe never sees explicit-true.

#### R4 — Probe credential is fixed and documented

The probe runs against the access-list response from `apps.listReposAccessibleToInstallation` using the fro-bot[bot] App installation token. Documented in `metadata/README.md` so future credential rotations don't silently change probe semantics.

### Public-artifact write gates

#### R5 — Always-redacted writes (single source of truth across both branches)

`metadata/repos.yaml` is **always-redacted** for `private: true` entries on both `data` and `main`. The mutators (`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`, and any future mutator) write the redacted form when `private: true`. There is no "redact in transit" lifecycle.

The redacted form for a private entry: `owner: '[REDACTED]'`, `name: <node_id>`, with `private: true`, `node_id: <actual>`, and other operational fields preserved (`onboarding_status`, `discovery_channel`, `has_*` flags, survey timestamps).

The canonical form (full owner/name) does not appear anywhere in `fro-bot/.github`. It is recoverable via `gh api repos/{owner}/{name}` (operator-side, not bot-side) using the operator's PAT.

#### R6 — Survey Repo workflow gates itself

`survey-repo.yaml` adds an in-workflow gate as its first job step. The step calls `gh api /repos/{owner}/{repo}` (App token), parses `private`, and aborts on `private: true` or any non-200 response. This is a primary control. It runs regardless of how the workflow was triggered (cron, reconcile dispatch, or manual `gh workflow run`).

The abort message uses `node_id` only — never `owner/repo` in the failure message, log lines, or step summary.

The concurrency group is renamed from `survey-repo-{owner}-{repo}` to `survey-repo-{node_id}` so the public Actions tab does not enumerate repo names.

#### R7 — Poll-invitations gate

`poll-invitations.yaml`'s `handle-invitation.ts` script consults the invitation's API response for `private` and computes the redacted form for the `metadata/repos.yaml` entry before calling `addRepoEntry`. The commit message generated by the autonomous write uses `node_id` for private repos (e.g., `chore(metadata): accept invitation MDEwOlJlcG9zaXRvcnk5MDAwMA==`) instead of `owner/repo`.

The invitation-accept API call itself echoes the slug into the workflow log for the duration of the run. Mitigation: the job's `name` and any explicit log statements use `node_id`; the GitHub API call's argument echo cannot be suppressed without proxy infrastructure.

#### R8 — Reconcile dispatch gate (defense in depth)

`reconcile-repos.ts` `classifyTracked` skips Survey Repo dispatch for entries where `private !== false`. The skip happens inside `classifyTracked` so private repos never enter `plan.dispatches` and cannot displace public repos in the dispatch cap.

Skipped entries DO NOT update `last_survey_at` or `last_survey_status`.

`summary.skippedPrivate` aggregate counter; no per-repo names in any public surface.

**Gate ordering with sibling cadence plan**: the privacy gate runs FIRST in `classifyTracked`, before the eligibility gate (cadence Unit 2's `isEligibleForSurvey`). A private repo is skipped regardless of eligibility.

#### R9 — `social-broadcast.yaml` privacy-aware

`social-broadcast.yaml` accepts a `private: boolean` input with **default `true`** (fail-safe; uses redacted slug or skip steps when caller doesn't explicitly opt-in). When `true`, all external posts (Discord, Bluesky) are skipped; only in-repo journal entries proceed.

The fail-safe default protects against the in-flight reusable-workflow versioning hazard: if the broadcast contract changes between `private: optional` and a stricter form, in-flight callers continue to invoke it without breaking, but get the safe-default behavior.

Callers (`survey-repo.yaml`, future broadcast triggers) MUST pass the flag explicitly.

#### R10 — Autonomous commit message redaction

Any path that writes a commit message naming a repo MUST consult `private` and use `node_id` for private repos. Affected paths:

- `addRepoEntry` (via `commit-metadata.ts` invocation in `handle-invitation.ts`)
- `recordSurveyResult` (via `record-survey-result.ts`)
- `resetSurveyResult` (via `reset-survey-status.ts`)
- Any redact-on-write step (R5 implementation)
- Future mutators

Convention: when an entry's `private` is `true | undefined`, the commit message omits `owner/repo` and uses `node_id` instead. When `private: false`, the commit message includes `owner/repo` as today.

#### R11 — Knowledge wiki paths exclude private references

Index entries and log entries about private repos are not written. By construction via R6 (Survey Repo gate prevents the agent run); R11 documents the invariant for future code paths.

Wiki page redaction in the merge ceremony: if the merge from `data` to `main` ever includes a wiki page at `knowledge/wiki/repos/<owner>--<name>.md` for a private entry, the `data → main` promotion blocks. This is an additional check, not a redaction (deletion-style remediation is operator-driven; the gate just ensures we never silently promote a wiki page about a private repo).

#### R12 — Workflow surface privacy

Concurrency groups, run names, JSON summary emissions, and dispatch input echoes in any workflow that may handle private-repo identifiers MUST use `node_id` for the public-visible surfaces.

The fundamental constraint: dispatch inputs to `workflow_dispatch` are logged at API-call time, before any in-workflow gate runs. Mitigation:

- Caller-side dispatch (e.g., `reconcile-repos.ts` calling `actions.createWorkflowDispatch`) passes `node_id`-only inputs to private-repo dispatches. The workflow then resolves `node_id` → `owner/repo` internally via the App token only when `private: false` is verified, OR the workflow refuses to run for `node_id` references it can't resolve to `private: false`.
- This means: no `workflow_dispatch` against any survey/wiki workflow takes raw `owner/repo` inputs anymore. They take `node_id` inputs and resolve internally.

#### R13 — `summary.skippedPrivate` is aggregate-only

Reconcile JSON output and commit messages may surface counts of skipped-private entries. Names MUST NOT appear in any public surface. Specifically:

- JSON summary: `{skippedPrivate: 1}` is fine.
- Commit message on `data`: `+0 dispatched, 1 skipped private` is fine.
- Workflow logs: aggregate counts only.

### Visibility transitions

#### R14 — Public→private transition detection

When the probe (R3) observes a tracked repo's stored `private` flag flip from `false` to `true` (including via `access-lost`), reconcile MUST file a `reconcile:visibility-transition` integrity-alert issue identifying:

- The `node_id` of the repo (never the name in title or public body).
- The slugs of any `knowledge/wiki/repos/*.md` pages that may need manual review (the slug already names the repo and is on `main` from prior public surveys — the leak is pre-existing; the alert is the operator's prompt).
- Operator-facing remediation guidance (delete the wiki page from `data`; consider git-history rewrite if content is sensitive).

The detection compares **probe result vs stored state**, not probe vs prior probe (so the rapid-flip case from F5 doesn't false-positive or false-negative).

Auto-deletion is NOT in scope. Manual close, matching existing integrity-alert pattern.

#### R15 — Private→public transition

When the probe observes `true → false`, the next reconcile run treats the repo as eligible for survey under normal cadence rules. The redacted entry on `metadata/repos.yaml` is rewritten to canonical form by `recordSurveyResult` on the next survey or by a one-shot `recanonicalize-public-entries` step.

### Continuous detection

#### R16 — CI guard against private-name introduction

A new CI check on `fro-bot/.github` runs on every PR to `main`. It reads `node_id` values for `private: true` entries from `metadata/repos.yaml` on `data` (the always-redacted form), resolves each to `owner/name` via the GitHub API (App token, scoped to `fro-bot[bot]`), then scans the PR's added-lines diff (not removed lines, not unchanged lines) for any string match.

Match is case-insensitive substring match. The failure message identifies the file path but does NOT echo the matched private name. The match-evidence is surfaced via `node_id` reference in the failure message and a structured workflow output that the operator can resolve locally.

The guard passes when:
- The diff contains no private-repo names (normal case).
- The PR is itself the redaction PR (Unit-defined; checks are scoped to `+` lines so removed canonical names don't trigger).
- The PR has an explicit `[allow-private-leak]` title prefix AND the operator is the PR author (override mechanism for rare false positives like Renovate transitive content).

The guard catches:
- Future PRs that introduce a private-repo name in a wiki page, comment, code, or any other file.
- PRs that flip `private: true → false` while introducing the name elsewhere in the same diff.

The guard does NOT catch:
- Pre-existing leaks already on `main` (R0 handles).
- Names introduced via direct push to `data` (no PR check) — mitigated by the always-redacted invariant in mutators.
- Names in commit messages or PR bodies (only file diffs scanned) — mitigated by R10 for autonomous paths; for operator paths, documented limitation.
- Names visible in the GitHub PR UI's "Files Changed" tab during the PR's open lifetime, even if the PR fails CI (the GitHub UI is itself a leak surface).

### Subsystems unchanged

#### R17 — `fro-bot.yaml` event handler runs unchanged

PR review, issue triage, daily reports, and event-driven Fro Bot activity inside a private repo run unchanged. The agent's GitHub App installation token is per-repo: it can only read the repo it was invoked against and write outputs (issue comments, PR reviews, check runs) inside that repo. Outputs inherit the repo's visibility automatically.

The "App installation is per-repo" guarantee covers GitHub-API outputs only. Any writes that escape the API — workflow log artifacts, commits to `data` in `fro-bot/.github`, broadcasts via R9 — are covered by R5/R7/R9/R10/R12/R16 explicitly.

#### R18 — Renovate dispatch unchanged

`dispatch-renovate.ts` reads `metadata/renovate.yaml`, populated by auto-discovery of repos in the `fro-bot` org. Collab repos (private or public) are never candidates regardless of visibility. The privacy posture is preserved by data-shape, not by an explicit filter.

#### R19 — In-repo journal unchanged

If a journal step posts in-character "today I did X" comments inside the target repo, those comments inherit the repo's visibility (R17). No additional gate needed at the workflow level for in-repo journal. Cross-repo journal (e.g., a journal post in `fro-bot/.github`'s `knowledge/log.md` mentioning work elsewhere) is governed by R5 + R10 + R16.

### Operational

#### R20 — Operator lookup convenience

A new operator-only script `scripts/resolve-private.ts` reads `node_id` values from `metadata/repos.yaml` and resolves each to `owner/name` via the GitHub API using the operator's PAT (or other authenticated credential). Output is stdout-only, never written to a file in the repo. Provides the lookup convenience that YAML-grep used to provide for non-private entries.

The script is excluded from `data` branch writes by convention (it's a read-only operator tool, not part of the autonomous pipeline).

#### R21 — Persona acknowledgment is documentation-only

`persona/fro-bot-persona.md` MAY add one short sentence indicating Fro Bot respects the privacy of repos it is invited into. This is documentation, not a control. The privacy guarantee is R5–R16. The persona sentence references the posture; it does not own it.

#### R22 — Documentation

`metadata/README.md` documents the `private` and `node_id` fields, every gate (R5–R16), the redaction model, the visibility-transition alert (R14), the CI guard (R16), the operator lookup script (R20), and the existing-leak handling (R0). `knowledge/schema.md` notes that the public wiki contains only public-repo content by design.

### Test coverage

#### R23 — Test scenarios

Tests cover (consolidated; per-unit scenarios in the plan):

- All 5 probe states (R3) including HTTP 404 / 451 / 304 / malformed-200 / 5xx.
- `private: true` entries skipped at `classifyTracked` (R8); `private: false` dispatched.
- Privacy gate runs before eligibility gate (R8 ordering).
- Survey Repo workflow gate (R6) aborts on `private: true` and on indeterminate API responses.
- Poll-invitations gate (R7) writes redacted entries and uses `node_id` in commit messages.
- Mutators (`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`) write redacted form for `private: true` entries (R5).
- Mutator behavior on existing redacted entry: probe finds repo, mutator updates in place (no duplicate creation).
- Social-broadcast (R9) skips Discord/Bluesky on `private: true` and on missing `private` input (default `true`).
- CI guard (R16) catches contrived diffs introducing private names; passes on the redaction PR; honors the `[allow-private-leak]` override.
- Public→private transition (R14) fires alert; private→public (R15) recanonicalizes.
- Existing-leak enumeration (R0) script identifies all surfaces accurately on a fixture.

## Success Criteria

### SC1 — No private content in any new public artifact

After this feature lands and the first reconcile run + first `data → main` promotion complete, all of the following hold for any new public artifact:

- `knowledge/wiki/repos/marcusrbrown--poly.md` does not exist on `data` or `main`.
- No file under `knowledge/wiki/`, `knowledge/index.md`, or `knowledge/log.md` references `poly` or `Polymarket`.
- `metadata/repos.yaml` on either branch does not contain the strings `poly` or `marcusrbrown/poly` in any field of a `private: true` entry. Redacted entries appear with `owner: '[REDACTED]'`, `name: <node_id>`.
- No new Discord post or Bluesky post mentions `poly`.
- No new public workflow run name in `fro-bot/.github`'s Actions tab references `poly` by name.
- No autonomous commit message after the v1 ship date names `poly` (or any other private repo).
- The verifiable test `git fetch origin data:data && git show data:metadata/repos.yaml | grep -i poly` returns nothing.

### SC2 — Existing leaks handled per R0 decision

If R0 chose remediation: existing leak surfaces are no longer accessible (force-pushed history, deleted runs, redacted entries). The `git log main --grep=poly` test returns nothing.

If R0 chose acceptance: the accepted-disclosure section of `metadata/README.md` documents each surface with a justification.

### SC3 — Fro Bot remains useful inside private repos

If a PR is opened on a private repo after this lands, `fro-bot.yaml` fires and the agent comments with the same persona and capability as on public repos.

### SC4 — Posture is enforced in code

R16's CI guard is required to merge any PR to `main`. Any future code change that would introduce a private-repo name into a public artifact fails CI.

### SC5 — No regression in current behavior

All currently-tracked public repos continue to be surveyed on cadence after this lands. Excluding the first reconcile run after deploy, cadence is uninterrupted.

## References

- Sibling brainstorm: `docs/brainstorms/2026-05-04-survey-cadence-and-multi-channel-discovery-requirements.md` defines `discovery_channel` (collab/owned/contrib) and per-channel cadence. This document's `private` and `node_id` flags are orthogonal: a repo can be `collab + private`, `owned + private`, etc.
- Loose-then-tight migration pattern: `docs/solutions/best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md`. R1 follows this pattern.
- Existing redaction reference: `scripts/reconcile-repos.ts:1292-1311` and `1335-1337` (pending-review issue rendering with `node_id`).
- Verified during planning (2026-05-04): `origin/data` of `fro-bot/.github` is publicly readable to any unauthenticated git client. Both branches are equally public-visible; only write semantics differ.

## Open Questions for Planning

- **Q1.** Existing-leak handling per R0 — for each surface (commit subjects, workflow run logs, current `metadata/repos.yaml` content), does the operator choose remediation or acceptance? This is a Phase-0 decision before any v1 unit ships.
- **Q2.** Does the loose-then-tight tightening of `private` and `node_id` happen with this plan or as a follow-up after one full reconcile cycle? Tightening can be deferred without affecting v1's invariants.
- **Q3.** Backfill strategy for existing entries (`node_id` is required by R2 for new entries; existing entries on `data` need it backfilled). One-shot script, or a probe-time write inside reconcile?
- **Q4.** Operator override mechanism for R16 false positives: `[allow-private-leak]` PR title prefix is one option. Should this also require an explicit `private-leak-override.yaml` operator-curated file that lists which exact strings are allowed past the guard? More ceremony, but more auditable than a title prefix.
- **Q5.** Does R12 ("workflow surface privacy") require all current `workflow_dispatch` inputs to be migrated to `node_id` form, or only the survey-repo path? Migrating all of them is invasive; migrating only survey-repo leaves a gap.
- **Q6.** R20's `resolve-private.ts` operator script — should it cache `node_id → owner/name` mappings in a local-only file, or always hit the API? Caching is faster but creates an off-repo file the operator must protect.
- **Q7.** The wiki-page redaction in R11 is a check ("the merge blocks if a private wiki page is in the diff"), not an active redaction. Should v1 also include a delete-on-detection step that removes the page from `data` before promotion, or leave that to operator action via the integrity alert?
