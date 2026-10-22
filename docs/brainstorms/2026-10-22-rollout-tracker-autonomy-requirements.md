---
date: 2026-10-22
topic: rollout-tracker-autonomy
---

# Fro Bot Keeps the #3512 Rollout Tracker Current

## Summary

When the operator mentions `@fro-bot` on #3512, Fro Bot acts as the tracker. It checks each reported claim against the evidence it can reach, accepts or rejects the claim, brings the issue body and Project 1 up to date, and replies with what it changed. The scheduled tracker also wakes on releases, infra deploys and contract changes, not only on issue state, and reconciles the tracker the same way. Fro Bot maintains the tracker's acceptance list from the thread.

---

## Problem Frame

fro-bot/.github#3512 tracks the gateway operator control-surface rollout across fro-bot/agent, fro-bot/dashboard, marcusrbrown/infra and this repo. The comment thread stays current, but the body does not. On 2026-10-22 the body was out of date in three ways:

- **Contract and versions.** It reported operator contract `1.8.0` with gateway `v0.118.2` and dashboard `2026.10.15`. `https://dashboard.fro.bot/operator/health` returned `contractVersion` `1.13.0`. The operator's 2026-10-20 comment gave the live pair as gateway `v0.124.1` and dashboard `2026.10.55`.
- **Open defects.** It listed eight defects as open, but all eight were closed: agent #1736, #1737, #1739 and #1740, and dashboard #583–#586.
- **Acceptance.** It left checkout details unchecked, although the 2026-10-20 production acceptance pass covered them. Its acceptance list also lacked gates raised later in the thread: agent#1889 cancellation containment, provider and quota-failure presentation, iOS cold start and reconnect, Discord settlement, launch timeout and idempotency, server-side CSRF and logout invalidation, and privacy and policy-unavailable acceptance.

Two paths should keep the tracker current, and neither does:

- **Mentions.** An operator `@fro-bot` mention on #3512 runs the general reply job. That job cannot write. fro-bot/agent v0.125.1 classifies `issue_comment`, `issues` and `pull_request` as affected triggers (`classifyEvent` in `packages/runtime/src/agent/response-delivery.ts`) and withholds the gh credential from the model on those runs. No action input overrides this. On 2026-10-20 (run 39457512151) and again on 2026-10-22 (run 39830059003), the job verified the reported results and drafted the corrections. Both times it reported that it could not edit the body or Project 1. `schedule` and `workflow_dispatch` runs do receive the credential.
- **Schedule.** `.github/workflows/gateway-rollout-tracker.yaml` wakes only when a tracked issue opens or closes. Releases, infra deploys, contract changes and operator reports never wake it. Every run since 2026-10-16 skipped. Its prompt covers comments and Project fields, not the body.

The daily report flags the drift every day. Nothing fixes it.

---

## Requirements

**Mentions on #3512**

- R1. An operator `@fro-bot` mention on #3512 starts a credentialed tracker run, with the mention as its input. A conversational reply from the credential-withheld job is not enough.
- R2. Fro Bot checks each claim in the mention against the evidence it can reach. Sources:
  - linked issue and PR state;
  - release tags in the producing repos;
  - successful runs of infra's Deploy Gateway and Deploy Dashboard workflows;
  - `https://dashboard.fro.bot/operator/health`;
  - the operator's acceptance-run results posted on #3512.

  Fro Bot accepts a claim when the evidence supports it. Otherwise it rejects or flags the claim and states the reason.

- R3. Fro Bot then updates the #3512 body so every section matches the verified state. This covers current state, open items, the cross-repo dependency matrix and acceptance criteria.
- R4. Fro Bot updates the Project 1 items to match: status, readiness and gate fields.
- R5. Fro Bot replies once. The reply states what it verified, what it accepted, what it rejected or flagged and why, and what it changed in the body and on Project 1.

**Scheduled reconciliation**

- R6. The scheduled tracker wakes when any of these change:
  - a linked issue or PR's state;
  - the latest release of agent, dashboard or infra;
  - the latest successful infra Deploy Gateway or Deploy Dashboard run;
  - the health `contractVersion`.

  On waking, it reconciles the body and Project 1 using the same checks as R2–R4.

- R7. A scheduled run that finds nothing to change posts nothing.

**Acceptance**

- R8. Fro Bot maintains the acceptance list in the body from the thread. It adds any gate raised in a comment or an acceptance run. It checks off a gate when the evidence supports it. It never removes an unmet gate without saying so.
- R9. Results from the operator's acceptance runs count as operator-reported acceptance. These runs follow infra's `docs/runbooks/operator-surface-acceptance-automated.md`. Fro Bot's own checks count as agent-verified. The body shows which kind each acceptance is.

---

## Acceptance Examples

- AE1. **Covers R2, R3, R4, R5.** Given the operator posts "@fro-bot gateway v0.125.2 is deployed", Fro Bot finds the release and a successful Deploy Gateway run that shipped it. It then updates the body's current state and Project 1, and replies listing both.
- AE2. **Covers R2, R5.** Given a claim with no supporting evidence, such as a deploy with no successful deploy run, Fro Bot flags it in the reply and leaves that item unchanged.
- AE3. **Covers R8, R9.** Given the operator posts an acceptance-run table, Fro Bot checks off each passing gate as operator-reported. Each failing or uncovered gate stays open, with the run's note.
- AE4. **Covers R6, R7.** Given a successful infra Deploy Dashboard run and no other change, the next scheduled run wakes and updates the dashboard version in the body. Given no change at all, the scheduled run posts nothing.
- AE5. **Covers R8.** Given a comment raises a new gate, such as agent#1889 cancellation containment, Fro Bot adds it to the acceptance list unchecked.

---

## Success Criteria

- After the next operator mention or scheduled run, the #3512 body and Project 1 match live state. The contract and versions are current, the closed defects have moved out of the open items, the checkout details box is checked, and the missing gates are listed.
- The operator never edits the body or Project 1 by hand to keep them current.
- The daily report stops flagging #3512 drift.

---

## Scope Boundaries

- No new state store, writer layer or comment syntax. Fro Bot keeps writing with `FRO_BOT_PAT`, as it does today.
- No change to credentials or token scopes.
- No CI-run acceptance automation. The agent-browser acceptance pass stays operator-run, and Fro Bot reads its posted results.
- Other trackers, cross-repo dispatch, and opening or merging PRs are out of scope.

---

## Key Decisions

- **Fix triggers, prompts and acceptance coverage. Do not add architecture.** The existing system already lets Fro Bot read the sources and write the issue and board. It fails because the right job never runs and no prompt gives it the responsibility. This replaces an earlier draft that moved tracker state into a file on `data`, with a separate writer that re-verified agent proposals. That design treated Fro Bot as untrusted on a surface it owns.
- **Mentions dispatch a credentialed run.** fro-bot/agent withholds the gh credential on comment triggers, and no input changes that. A `marcusrbrown` mention on #3512 therefore dispatches a `workflow_dispatch` tracker run that carries the comment, and that run does the verification, the edits and the reply. On 2026-10-22, run 39831791869 tested this path by applying the corrections that the credential-withheld run had prepared.
- **Fro Bot decides acceptance on evidence.** It verifies claims itself and credits the operator's posted acceptance runs. The operator is not asked for any extra confirmation step.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Where the mention-to-dispatch hop lives. Options: a step in the content-triggered job of `fro-bot.yaml`, or a small `issue_comment` workflow scoped to #3512. Planning also decides whether the credential-withheld reply job should skip #3512 mentions, so Fro Bot doesn't reply twice.
- [Affects R6][Technical] How `scripts/rollout-tracker-snapshot.ts` adds release tags, infra deploy runs and the health contract to its wake check, and whether the agent-written marker comment stays the gate record.
- [Affects R6][Needs research] Which infra tag counts as "latest release". infra tags per package: `@marcusrbrown/infra@…`, `infra-vpn`, `infra-shared`.
- [Affects R1, R6][Technical] Whether mention-triggered and scheduled runs share a concurrency group, so they never edit the body at the same time.

---

## Sources / Research

- `.github/workflows/gateway-rollout-tracker.yaml`, `scripts/rollout-tracker-snapshot.ts`: the current wake check (issue state only) and the tracker prompt.
- `.github/workflows/fro-bot.yaml`: the content-triggered job that handles #3512 mentions today.
- `docs/solutions/workflow-issues/autonomous-rollout-tracker-workflow-2026-06-17.md`: the tracker's origin. The dedicated tracker writes; the daily report only reports.
- marcusrbrown/infra `docs/runbooks/operator-surface-acceptance-automated.md` and `operator-surface-acceptance.md`: the acceptance checks and their numbering.
- marcusrbrown/infra workflows Deploy Gateway (`deploy-gateway.yaml`) and Deploy Dashboard (`deploy-dashboard.yaml`): deploy evidence.
