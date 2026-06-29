---
date: 2026-06-26
topic: a2-self-maintenance-portfolio
title: A2 — Semantic truth maintenance
---

# A2 — Semantic truth maintenance

## Summary

A2 turns Fro Bot into a proactive maintainer of its own control-plane truth. The first slice is
status-truth maintenance: Fro Bot detects public claims about issue, PR, release, plan, and
rollout state that have drifted from live GitHub reality, then creates durable proposals for
operator review. Bounded correction PRs are a graduation path after the claim kind proves useful.

---

## Problem Frame

The personal-agent north-star names A2 as the next Tier-2 thread after A1 grow-and-learn:
broader self-improvement of repo and control-plane operation, seeded by autoheal. A1 captures
what Fro Bot learns from solved work. A2 should verify that the repo’s public coordination layer
still matches shipped reality.

Recent rollout work exposed the gap. Plans, issues, and docs drifted around #3512, #48, #907,
#1033, release-versus-deploy state, and live verification. The operator had to manually reconcile
the board, tracker body, comments, memories, release state, and project docs before trusting the
next action. That reconciliation loop is exactly the kind of ongoing repo maintenance Fro Bot
should own.

This is not a generic docs linter. Existing wiki lint checks structural integrity, and existing
docs skills help regenerate prose when asked. A2 adds semantic truth maintenance: typed factual
claims, live source-of-truth checks, durable proposals, measured false-positive learning, and a
future path to bounded correction PRs.

---

## Actors

- Marcus: reviews proposals, closes false positives, merges future bounded PRs, and decides when
  a claim kind graduates to more autonomy.
- Fro Bot: inventories status-truth claims, checks live GitHub reality, proposes truth-maintenance
  work, and learns which claim kinds are reliable.
- Maintained repository: the `.github` control plane, including public docs, plans, issues, PRs,
  releases, workflow runs, and project tracker artifacts used as truth sources.

---

## Key Flows

- F1. Status-truth scan
  - **Trigger:** A scheduled or manual A2 run evaluates supported status-truth claim kinds for
    the `.github` control plane.
  - **Actors:** Fro Bot, Maintained repository
  - **Steps:** Fro Bot inventories typed status claims, fetches live public GitHub state,
    classifies each claim as current, drifted, unresolved, or unsafe to emit, then records
    counts-only telemetry.
  - **Outcome:** Fro Bot knows which public coordination claims are stale without leaking private
    state or writing to authority surfaces.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7
- F2. Proposal queue
  - **Trigger:** A status claim is drifted and safe to discuss on public GitHub surfaces.
  - **Actors:** Marcus, Fro Bot
  - **Steps:** Fro Bot creates or updates a fingerprinted proposal issue with the claim, source of
    truth, confidence, severity, proposed correction, and current outcome state.
  - **Outcome:** Stale coordination knowledge becomes reviewable work instead of latent operator
    memory.
  - **Covered by:** R8, R9, R10, R11, R12, R13, R14
- F3. Bounded PR graduation
  - **Trigger:** A claim kind has demonstrated low false-positive rates and a drifted claim has a
    mechanically provable correction inside an approved docs path.
  - **Actors:** Marcus, Fro Bot
  - **Steps:** Fro Bot applies the exact correction, opens at most one bounded PR, links it to the
    proposal state, and waits for human review and merge.
  - **Outcome:** Repeatedly reliable truth-maintenance work can move from proposal to small
    reviewable diff without allowing autonomous merge.
  - **Covered by:** R15, R16, R17, R18, R19

---

## Requirements

**First claim kind: status truth**

- R1. A2 v1 must focus on public status-truth claims that affect the next operator action.
- R2. The first inventory must cover public issue state, PR state, release state, plan status, and
  rollout-tracker status when those claims appear in `.github` docs, plans, or issue bodies.
- R3. A2 v1 must not scan arbitrary prose for “still accurate?” judgments.
- R4. Each supported claim kind must define its claim pattern, live source of truth, confidence
  rule, suppression rule, and proposal body fields.
- R5. Adding a new claim kind must be a reviewable repo change so false-positive history and
  safety rules can shape expansion.

**Source-of-truth checks**

- R6. A2 must prefer live public GitHub state and current repo files over generated, historical,
  or narrative docs.
- R7. A2 must classify each claim as current, drifted, unresolved, or unsafe to emit.
- R8. When sources conflict, source data is unavailable, the resource is not definitively public,
  or the claim depends on private or unknown identity, A2 must fail closed and not emit a public
  proposal or PR.

**Proposal queue and learning loop**

- R9. Drifted claims that are safe to discuss publicly must become fingerprinted proposal issues
  or updates to existing proposal issues.
- R10. Proposal state must live on GitHub issue surfaces using hidden fingerprint markers, labels,
  and comments; no new metadata file is introduced in v1.
- R11. Each proposal must include the public claim location, sanitized claim excerpt, checked
  public source of truth, confidence, severity, proposed correction, fingerprint, and outcome
  state.
- R12. A2 must track proposed, accepted, rejected, false-positive, superseded, and manually-fixed
  outcomes in the proposal issue thread.
- R13. A2 must suppress repeated proposals for rejected, false-positive, or superseded findings
  until the claim text or source-of-truth reference materially changes.
- R14. A2 must measure accepted-versus-rejected outcomes by claim kind so bad heuristics become
  visible and correctable.

**Bounded PR graduation**

- R15. Bounded PRs are not required for the first proposal-only implementation, but the design
  must leave a clear graduation path for reliable claim kinds.
- R16. A2 may open a correction PR only when the change is a literal or tightly bounded
  substitution over a cited claim location.
- R17. A2 PRs must be limited to approved public docs paths and must never touch `knowledge/`,
  `metadata/`, repo settings, workflows, hooks, persona files, secrets, release config, or other
  authority-bearing surfaces.
- R18. Human merge remains required for every A2 PR.
- R19. A2 must not approve, merge, enable automerge, force-push, retarget, or bypass branch
  protection for its own PRs.

**Privacy and public artifact safety**

- R20. Before any public issue, comment, PR title, PR body, branch name, or workflow summary is
  emitted, A2 must run the shared privacy gate over the rendered content.
- R21. A2 public output must use a strict schema: public claim path, short sanitized excerpt,
  public source reference, confidence, severity, fingerprint, and proposed correction.
- R22. A2 must omit private or unknown repo names, branch names, issue titles, PR links, node IDs,
  database IDs, inferred identities, and secret-like content from public output.
- R23. A2 must treat privacy-gate failure, ambiguous public/private status, auth failure, API
  timeout, stale cached identity, or missing source-of-truth data as a block, not as a redaction
  opportunity.
- R24. A2 must keep workflow telemetry counts-only: claim counts, drift counts, proposal counts,
  blocked counts, and false-positive counts without paths, issue titles, repo names, branch names,
  fingerprints, or PR links.
- R25. A2 must separate read-only scan credentials from write credentials for proposal or PR
  creation, and credential values must never enter rendered proposals, PR metadata, logs, or
  workflow summaries.
- R26. Future correction PR branch names, titles, and labels must be generated from opaque
  fingerprints and fixed prefixes, never from claim text, source URLs, repo names, branch names,
  issue titles, or PR titles.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R6, R9, R11.** Given a rollout tracker says PR #907 is open but GitHub
  shows it closed, when A2 scans public tracker claims, it creates or updates one proposal citing
  the stale claim and the live PR state.
- AE2. **Covers R7, R8.** Given a plan claim conflicts with one public source while another public
  source is unavailable, when A2 evaluates the claim, it records unresolved evidence in counts
  only and emits no public proposal or PR.
- AE3. **Covers R10, R12, R13, R14.** Given Marcus closes a proposal as false-positive, when the
  same fingerprint appears on the next run, A2 suppresses it and increments the false-positive
  count for that claim kind.
- AE4. **Covers R15, R16, R18, R19.** Given a future graduated claim kind has a verifiably wrong
  public status phrase in an approved docs path, A2 may open one small correction PR and wait for
  human merge.
- AE5. **Covers R20, R21, R22, R23, R24, R25.** Given a claim references a private repo or
  private PR URL, when A2 evaluates it, all public output is blocked and workflow telemetry
  records only aggregate blocked counts.
- AE6. **Covers R26.** Given a future bounded PR is opened for a public status correction, when A2
  creates its branch and title, both use a fixed docs-drift prefix plus an opaque fingerprint
  instead of source-derived text.

---

## Success Criteria

- Fro Bot identifies stale public coordination claims before Marcus manually reconciles them.
- Every emitted proposal is reviewable from its claim tuple without trusting agent vibes.
- The first implementation improves repo truthfulness through accepted proposals or documented
  false-positive reductions.
- A2 produces a measurable accuracy signal per status claim kind so the system can graduate useful
  checks and retire noisy ones.
- Human approval and existing authority boundaries remain intact.

---

## Scope Boundaries

- First implementation is `.github` control-plane only; no org-wide repo scanning.
- First implementation covers public status-truth claims, not broad prose quality or style.
- General issue/PR lifecycle management is out of scope except proposal tracking for A2 findings.
- Bounded correction PRs are a graduation path, not required for the first proposal-only version.
- No dependency hygiene, broad CI/test hardening, review-to-fix, or metadata/wiki authority repair
  in this slice.
- No A1 capture, autonomous authoring, quarantine-doc design, or A3 cross-repo dispatch.
- No dashboard/operator UI work.
- No autonomous merges or automerge enablement.
- No new write authority path around `data`, wiki, metadata, repo settings, secrets, workflows,
  or release configuration.

---

## Key Decisions

- **Status truth is the first wedge:** Stale public status claims caused recent operator
  reconciliation pain, and they have clean public GitHub sources of truth.
- **Semantic truth maintenance, not docs lint:** A2 checks factual coordination claims against
  live reality; structural wiki lint and prose regeneration stay separate.
- **Typed claims before semantic comparison:** The system starts with claim kinds that have named
  sources of truth so findings are auditable and measurable.
- **Proposal queue as the safety primitive:** Proposals are durable review artifacts and carry the
  state machine that prevents repeated stale work.
- **PRs are a graduation path:** The intended product is proactive repo maintenance, but PR
  autonomy should be earned by claim-kind accuracy rather than granted before signal exists.
- **Privacy gate is the chokepoint:** Public output is blocked when identity, source-of-truth, or
  rendered content safety is uncertain.
- **Credentials do not cross output boundaries:** Scan credentials, write credentials, and
  rendered public artifacts stay separated so secret values cannot leak through proposals, PRs, or
  telemetry.

---

## Dependencies / Assumptions

- The personal-agent north-star remains the parent strategy document.
- Existing wiki lint, issue fingerprinting, privacy gates, data-branch authority rules, and docs
  skills remain load-bearing primitives.
- Public GitHub issues are the right proposal queue surface for `.github`-scoped status claims.
- Planning will define the first status-claim inventory, proposal labels, fingerprint shape,
  privacy-gate adapter, workflow shape, and future PR graduation rule.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R2, R4][Product/technical] Which exact status claim kinds belong in the first
  inventory?
- [Affects R10, R12][Technical] Which labels and hidden markers encode proposal outcome state?
- [Affects R20, R21, R22, R23][Technical] What shared privacy-gate adapter protects every public
  output surface?
- [Affects R25, R26][Technical] What exact workflow credential split and opaque PR metadata
  format should the implementation use?

### Deferred to Planning

- [Affects R14, R24][Technical] What minimum accuracy counters should appear in the workflow
  summary without creating public noise?
- [Affects R15, R16, R17][Technical] What accepted-proposal threshold promotes a claim kind from
  proposal-only to PR-eligible later?

---

## Sources / Research

- Personal-agent north-star: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`
- A1 grow-and-learn requirements: `docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md`
- Existing structural and lifecycle primitives: `scripts/wiki-lint.ts`, `scripts/wiki-lint-issues.ts`, `scripts/capture-learnings-privacy.ts`, `scripts/merge-data-pr.ts`
- Related maintenance patterns: `docs/solutions/documentation-gaps/doc-drift-cleanup-pattern-2026-04-18.md`, `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`, `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`
- External patterns reviewed: Renovate/Dependabot confidence-tiered PR automation, GitHub Copilot coding agent approval boundaries, API/docs drift tools, durable workflow control planes, and verification-first self-improving agent research.
