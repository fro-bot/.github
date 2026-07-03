---
date: 2026-07-03
topic: bounded-correction-pr-execution
title: Bounded correction PR execution for Status Truth
---

# Bounded correction PR execution for Status Truth

## Summary

Build the real PR-execution path for the Status Truth loop and ship it fully disarmed. The slice
adds kind-specific pure correctors with mandatory re-verification, a real workflow job behind a
three-key arming model, stale-PR auto-close, and strict volume caps. Codify the graduation policy;
graduate no claim kind.

---

## Problem Frame

The A2 arc gated bounded correction PRs on proposal outcome signal, and the first signal now
exists: the plan-consistency kind produced three drifted findings, three proposal issues, and
three resolved-positive outcomes with zero false positives in one lifecycle. The corrections were
mechanically provable one-line frontmatter edits — exactly the shape the graduation path was
designed for.

But the execution machinery is a disabled placeholder. The workflow PR job is a documented no-op,
the pure planner has no way to compute corrected file content, and no credential path exists for
branch or PR creation. Even when a claim kind earns graduation, nothing can act on it. Meanwhile
the outcome evidence so far is bot-inferred (close-on-clear), not human-confirmed — so building
the machinery and graduating a kind are two different decisions, and only the first is ready.

---

## Actors

- A1. Marcus: sets the arming variable, dispatches PR-enabled runs, reviews and merges every
  correction PR, applies outcome labels that feed graduation.
- A2. Fro Bot: plans correction PR actions for graduated kinds, computes corrected content, opens
  at most one bounded PR per run, and closes its own stale correction PRs.
- A3. Status Truth workflow: hosts the detect/open/prs jobs and enforces the arming keys and
  credential boundaries.

---

## Key Flows

- F1. Bounded correction PR
  - **Trigger:** A manually dispatched PR-enabled run finds a drifted, proposal-eligible finding
    of a graduated claim kind.
  - **Actors:** A2, A3, then A1
  - **Steps:** Planner selects the finding under caps; the kind's corrector computes new file
    content; the resolver re-verifies the corrected content as current; the job mints write
    credentials, creates the opaque branch, opens the PR linked to the proposal fingerprint;
    Marcus reviews and merges.
  - **Outcome:** A stale public claim becomes a reviewable one-line diff without autonomous merge.
  - **Covered by:** R1, R2, R5, R6, R7, R8, R9
- F2. Stale correction PR cleanup
  - **Trigger:** A complete scan shows a fingerprint with an open correction PR is no longer
    drifted.
  - **Actors:** A2
  - **Steps:** Planner emits a close action; the shell closes the bot's own PR with a short
    comment and deletes the correction branch.
  - **Outcome:** Manually fixed drift does not leave zombie PRs.
  - **Covered by:** R10
- F3. Kind graduation
  - **Trigger:** A claim kind accumulates the required explicit outcome signal.
  - **Actors:** A1, A2
  - **Steps:** Marcus adds the kind to the graduated set in a reviewed code PR; the change cites
    the outcome counts that satisfy the policy.
  - **Outcome:** Autonomy expands only through reviewed repo changes backed by human-confirmed
    signal.
  - **Covered by:** R3, R4

---

## Requirements

**Arming and graduation**

- R1. Real PR execution requires three independent keys: the repository variable
  `STATUS_TRUTH_PRS_ENABLED` set to `'true'`, at least one kind in the reviewed
  `GRADUATED_CLAIM_KINDS` set, and a manual `workflow_dispatch` input explicitly requesting PR
  actions. Scheduled runs never open PRs.
- R2. This slice ships fully disarmed: the variable stays unset, the graduated set stays empty,
  and the dispatch input defaults to off.
- R3. Graduation policy, codified in operator docs: a kind becomes graduation-eligible only after
  at least one explicit `status-truth:accepted` outcome; resolved positives count toward but
  cannot solely satisfy the bar. A false-positive outcome removes the kind from the graduated set
  via a reviewed code change, and re-graduation requires a new reviewed change citing fresh
  accepted signal.
- R4. Graduating a kind is a reviewed code change to the graduated set, never a config or
  variable toggle.

**Correction mechanics**

- R5. Each graduated kind ships a pure corrector: current file content in, corrected content out,
  no I/O. Correctors are bounded to the claim's cited location class (plan-consistency rewrites
  exactly the frontmatter status line).
- R6. Corrected content must re-resolve as current through the kind's own resolver before any
  branch or PR action is planned; re-verification failure downgrades the action to proposal-only
  and is counted. At execution time the PR job re-reads the target file from the current base
  branch, re-runs the corrector and re-verification against that live content, and fails closed
  (downgrade, no push) if the file no longer produces the planned drifted-to-current transition.
- R7. Correction PRs touch exactly one file per PR, within the existing allowed-path prefixes;
  forbidden paths, path traversal, and privacy-gate failures downgrade to proposal-only.

**Volume and lifecycle**

- R8. At most one open correction PR exists per fingerprint; rediscovery uses the existing opaque
  digest match plus bot ownership plus main-target checks.
- R9. A run opens at most one new correction PR; further eligible actions remain proposal-only
  and are reported as blocked counts. Rediscovering an existing open PR does not consume the
  new-open budget, so a long-lived open PR cannot starve other findings.
- R10. When a complete, non-execution-failure scan shows a fingerprint's drift cleared while its
  correction PR is open, the bot closes its own PR with a brief comment and deletes the
  correction branch. Incomplete scans never trigger PR closure. Merged PRs are never touched.
- R10b. When the linked proposal carries a terminal outcome label (`status-truth:rejected` or
  `status-truth:false-positive`), any open correction PR for that fingerprint is closed and its
  branch deleted on the next armed run, regardless of drift state — terminal suppression governs
  both surfaces.

**Credentials and safety**

- R11. Write credentials (`contents: write`, `pull-requests: write`) are minted only inside the
  PR job, only on armed runs, scoped at mint time, and never exposed to detect/open jobs or
  rendered output.
- R11b. Planner limits are re-enforced in the execution shell: before any push, the PR job
  independently validates that the branch content deviates from base by exactly the planned
  single file and diff; any mismatch aborts without pushing.
- R11c. The PR job creates, pushes, or deletes only branches matching the bot-owned
  `status-truth/correction-*` pattern for the current fingerprint; any write or delete targeting
  another branch — including `data` and any protected branch — is refused at execution time.
- R11d. The PR job consumes only same-run producer-job outputs for correction planning;
  cross-run or externally supplied artifacts are never trusted for security-relevant fields.
- R12. The bot never merges, approves, enables automerge, force-pushes, retargets, or edits
  branch protection for correction PRs; closing its own stale PRs and deleting its own correction
  branches are the only permitted PR-state mutations.
- R13. PR titles, branch names, bodies, and comments are built from fixed prefixes, opaque
  fingerprint digests, and normalized fields only, and every rendered surface passes the existing
  public-output gate; gate failure downgrades to proposal-only.
- R14. Workflow summaries and logs remain counts-only for PR actions (planned, opened,
  rediscovered, downgraded, closed, blocked).

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given the shipped defaults (variable unset, graduated set empty), when
  any run executes — scheduled or dispatched — zero PR actions occur and the PR job reports
  disarmed counts only.
- AE2. **Covers R1.** Given the variable is set and a kind is graduated, when a scheduled run
  finds eligible drift, the action downgrades to proposal-only because no dispatch input
  requested PR execution.
- AE3. **Covers R5, R6.** Given a graduated plan-consistency finding, when the corrector rewrites
  the frontmatter status line and the resolver re-verifies the result as current, an open-PR
  action is planned; given re-verification fails, the action downgrades and increments a
  downgrade count.
- AE4. **Covers R8, R9.** Given three eligible graduated findings in one armed run, when planning
  completes, exactly one PR opens and two actions are reported as blocked proposal-only counts.
- AE5. **Covers R10.** Given an open correction PR whose fingerprint is absent from the next
  complete scan, when the armed run plans actions, the bot closes that PR with a comment and
  deletes its branch; given the scan was incomplete, no closure occurs.
- AE6. **Covers R13.** Given a finding whose rendered PR body fails the public-output gate, when
  planning completes, no PR action occurs and the finding remains proposal-only.
- AE7. **Covers R6.** Given the target file changed on the base branch between detection and PR
  execution such that the live content no longer re-verifies, when the PR job runs, no branch is
  pushed and the action is reported as a downgraded count.
- AE8. **Covers R10b.** Given an open correction PR whose linked proposal was labeled
  `status-truth:rejected`, when the next armed run plans actions, the PR is closed and its branch
  deleted even though the drift still exists.
- AE9. **Covers R11c.** Given a hypothetical planned action whose branch name does not match the
  correction-branch pattern, when the PR job validates it, the push is refused and the run
  reports a safety-refusal count.

---

## Success Criteria

- The disabled placeholder is replaced by a real, tested execution path that provably does
  nothing until all three arming keys turn.
- A future graduation is a one-line reviewed change plus a manual dispatch — no new machinery.
- A dry-run-style armed rehearsal (graduated fixture kind, fixture drift) demonstrates the full
  open → re-verify → cap → close lifecycle in tests without touching live GitHub state.
- Every safety property (arming, caps, downgrade classes, credential boundaries, gate coverage)
  is pinned by tests, not just documented.

---

## Scope Boundaries

- No claim kind graduates in this slice; `GRADUATED_CLAIM_KINDS` ships empty.
- No autonomous merge, approve, automerge, or branch-protection interaction, ever.
- No multi-file or multi-finding correction PRs.
- No corrections outside graduated kinds or outside the existing allowed-path prefixes.
- No changes to the proposal loop, detect resolvers, or scheduled-run behavior.
- No new outcome labels; graduation math reads the existing label contract.

---

## Key Decisions

- **Machinery before graduation:** building execution and expanding autonomy are separate
  reviewed decisions; the first has evidence, the second does not yet.
- **Three-key arming:** variable, reviewed graduated set, and per-run manual dispatch must all
  agree; the intersection makes accidental arming implausible without making a real launch
  ceremony-heavy.
- **Corrector + re-verification over generic substitution:** a pure per-kind corrector whose
  output must re-resolve as current turns "the fix is right" into a testable property instead of
  a text-surgery hope.
- **Self-cleanup is bounded autonomy:** closing the bot's own stale PR and deleting its own
  branch mirrors proposal close-on-clear and avoids zombie review load without touching protected
  actions.
- **Global cap of one PR per run:** review load is the scarce resource; the cap is a launch
  posture, liftable later by a reviewed change.

---

## Dependencies / Assumptions

- `scripts/status-truth-prs.ts` remains the pure planner seam: `GRADUATED_CLAIM_KINDS`,
  opaque branch/title builders, allow/forbid path logic, and downgrade actions extend rather than
  restart. The planner currently has no close-PR action type and `ExistingStatusTruthPr` carries
  no branch field — both extensions are planning-owned work, not existing capability.
- The workflow's `workflow_dispatch` block currently exposes only `dry_run`; the R1 arming input
  is new. Sibling workflows and the status-truth snapshot step already use scoped GitHub App
  token minting (`actions/create-github-app-token`) as the R11 precedent.
- The existing proposal lifecycle supplies fingerprints, outcome labels, and close-on-clear
  semantics unchanged.
- GitHub App credential minting used elsewhere in the workflow can scope `contents: write` +
  `pull-requests: write` at mint time for the PR job.
- Assumption (labeled): the dispatch input can gate the PR job alongside the existing variable
  without restructuring the workflow's job graph; verify during planning.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] Whether re-verification runs inside the planner (pure, against
  corrected content) or as a shell step before branch creation — or both.
- [Affects R10][Technical] Exact rediscovery fields needed to safely map fingerprint → open PR →
  branch for closure (existing `ExistingStatusTruthPr` shape may need branch info).
- [Affects R11][Technical] Which credential mint pattern in the existing workflows is the right
  precedent for the PR job's scoped token.
- [Affects R14][Technical] Whether PR-action counts join the existing report artifact or a
  job-local summary only.
