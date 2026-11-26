---
date: 2026-11-25
topic: foreman-domain-programs
---

# Fro Bot as Foreman: Domain Briefs and Negotiated Programs (F1)

## Summary

Fro Bot directs work across repositories as a foreman. A reviewed domain file groups repositories and gives each domain a brief. Fro Bot runs programs the operator offers and proposes its own for approval. It sends each repository's own agent its part with the domain brief, and records each agent's accept, decline or counter, and the outcome, on the program tracker. The first program brings the harness tools up to the agent automation that suits each of them.

---

## Problem Frame

North-star item F1 asks Fro Bot to "offer and consume work from other agents or humans". Its 2026-11-25 reconciliation names an F1 work-offer brainstorm as the next control-plane move.

The pieces exist but don't add up to direction. 24 of the 31 public tracked repositories run their own Fro Bot agent workflow, and 21 have an `AGENTS.md`. Cross-repo dispatch can already send a prompt to each repository's agent and collect a receipt (goals #3633, #3640 and #4050). The program-tracker skill and #3512 show that one tracker can carry a multi-repository program. But no repository knows which domain it belongs to, no domain carries standards its agents should meet, and nothing has been dispatched since 2026-10-23. Every program and every goal starts by hand. A dispatched agent can only do the work or fail; it cannot say the ask conflicts with its own repository's rules.

The delivery path is uneven too. Of the three harness-tools repositories, only `fro-bot/dashboard` routes a dispatched prompt to a branch and pull request. `marcusrbrown/systematic` keeps a prompt-only dispatch comment-only, and `fro-bot/space-bus` runs it in a working directory that is discarded.

There is no collision problem to solve. In the 30 days to 2026-11-25 there were no duplicate Fro Bot pull requests, and the collisions that did occur already have fixes (#4189, #4197, #4290). The gap is direction: improving security, automation and developer experience across repositories one repository at a time, by hand.

---

## Actors

- A1. Operator (Marcus): approves proposals, merges each program's start pull request, approves dispatch, reviews and merges every pull request, edits the domain file.
- A2. Foreman (Fro Bot in this repository): reads the domain file, proposes and runs programs, splits them by repository, records answers and outcomes on the tracker.
- A3. Repository agent: the Fro Bot agent workflow in each target repository. It works under its own `AGENTS.md` and decides, for its own repository, whether to accept an ask.
- A4. Program tracker: the tracker issue and Project for one program, kept current by the existing tracker duty.

---

## Key Flows

- F1. Operator offers a program
  - **Trigger:** The operator asks for a program, as the program-tracker skill starts one today.
  - **Actors:** A1, A2, A4
  - **Steps:** The foreman reads the domain file and the program's goal, then accepts the program or declines it with a reason. On accept, it starts a tracker as the skill does. The operator merges the start pull request, which files one part issue in each repository. The operator then approves the dispatch.
  - **Outcome:** A tracker exists with one part issue per repository and an approved dispatch.
  - **Covered by:** R5, R6, R7, R18
- F2. Foreman proposes a program
  - **Trigger:** The same domain-wide gap is observed independently across runs for the minimum window.
  - **Actors:** A2, A1
  - **Steps:** The foreman opens one proposal that names the domain, the gap, the repositories and the dated observations. The operator approves it with a label, which makes it an offered program (F1), or closes it.
  - **Outcome:** An approved proposal enters F1. A closed one stays closed until the gap changes materially.
  - **Covered by:** R8, R9, R10, R11
- F3. Repository agent answers its part
  - **Trigger:** An approved dispatch reaches a repository agent.
  - **Actors:** A3, A2, A4
  - **Steps:** The agent checks the ask against its own `AGENTS.md` and repository state. It answers on its part issue: an accepted, declined or countered label, with the reason in plain prose. On accept it does the work through its pull request flow and posts the existing completion receipt when done. The tracker shows the answer and the outcome.
  - **Outcome:** Every part shows an answer and, when accepted, its pull request and result. A decline or counter waits for the operator.
  - **Covered by:** R12, R13, R14, R15, R16
- F4. A part goes silent
  - **Trigger:** A part has no answer, or no outcome after an accept, past its stall window.
  - **Actors:** A2, A4, A1
  - **Steps:** The tracker's own run notices the age, marks the part stalled, and the daily report lists it.
  - **Outcome:** No part stays silently pending.
  - **Covered by:** R17

---

## Requirements

**Domains**
- R1. A committed domain file on main names each domain, its repositories and its brief. Changes go through a reviewed pull request.
- R2. A brief states the domain's bar for security, agent automation and developer experience, as standards a repository agent can check its repository against, with any per-repository exceptions.
- R3. A repository belongs to at most one domain. Only public tracked repositories are eligible: the tracker's preflight reports a listed repository that is not, and dispatch's eligibility gate refuses it. The domain file's pull request checks structure only, so a registry change never blocks a promotion.
- R4. The first domain is harness tools: `marcusrbrown/systematic`, `fro-bot/space-bus` and `fro-bot/dashboard`.

**Offered programs**
- R5. The foreman accepts or declines an offered program with a reason before any repository work starts.
- R6. An accepted program runs on a program tracker started the way the program-tracker skill starts one, with one part issue per repository in the domain.
- R7. The operator's approval gates every dispatch, as `dispatch-approved` gates cross-repo goals today.

**Proposed programs**
- R8. A proposal is keyed by a stable gap and its affected repositories, so repeated reports of the same finding count as one candidate.
- R9. The foreman proposes only after the gap is observed independently, with dated observations, across a minimum window; the proposal cites them.
- R10. At most one foreman proposal is open at a time.
- R11. A proposal the operator closed is not proposed again unless the gap changed materially (a new affected repository, a regression, or a changed condition), and the new proposal says what changed. A fresh report of the same finding is not a change.

**Repository agents**
- R12. Each dispatched part carries the program goal and a reference to its domain's brief pinned to a commit on main, so the operator's approval covers that exact brief. A change of target, ask or brief commit needs a fresh approval. A missing or unreadable brief, or a part that would exceed dispatch's prompt limit, stops that dispatch visibly.
- R13. The repository agent answers before it works, on its own part issue: an accepted, declined or countered label with its reason in plain prose.
- R14. The repository agent decides under its own `AGENTS.md`. The foreman never instructs it to override its own rules.
- R15. Work starts only after an accept, and the existing completion receipt keeps its meaning: it reports the finished work and is final. A decline or counter, verified as coming from that repository's agent for that attempt, ends the attempt without a completion and without a missing-receipt alert; a revised ask is a new attempt with a fresh approval.
- R16. The tracker shows each part's answer and reason, its pull request when accepted, and its outcome. A decline or counter goes to the operator, and the foreman does not reroute it without the operator.
- R17. The tracker wakes on a changed answer and on a part's age. The answer clock starts at confirmed delivery and the outcome clock at the accept; a part past either window is marked stalled and listed in the daily report. A part waiting on approval or on a prerequisite is shown as held, not stalled, and a failed read leaves it unknown.

**First program**
- R18. The first program, automation parity for harness tools, starts with an inventory of which of this repository's agent automation applies to each repository and the exceptions, and the brief records it.
- R19. Part 0 in `marcusrbrown/systematic` and `fro-bot/space-bus` is that repository adopting dispatch-to-pull-request routing, as `fro-bot/dashboard` does. It is raised on the part issue as an operator-authorized ask to the repository's agent, not through dispatch. When that repository's issue path cannot open a pull request that changes workflows, the operator authors the change instead. Part 0 is tracked separately from the parity parts, and their dispatch is approved only after the tracker shows Part 0 merged in that repository.

---

## Acceptance Examples

- AE1. **Covers R5, R6, R7.** Given the harness-tools domain in the domain file, when the operator offers the automation-parity program, the foreman accepts it and starts a tracker. After the start pull request merges, each repository has a part issue, and nothing is dispatched until the operator approves.
- AE2. **Covers R13, R14, R16.** Given a part asking `fro-bot/dashboard` to adopt a rule its `AGENTS.md` forbids, when its agent receives the part, it labels the part declined with that reason, and the tracker shows the decline to the operator with no other repository affected.
- AE3. **Covers R13, R16.** Given `marcusrbrown/systematic` counters with a smaller change, the tracker shows the counter and its reason, and nothing more is dispatched for that part until the operator answers.
- AE4. **Covers R15.** Given an accepted part, the completion receipt is posted when the work finishes, not when the agent accepts.
- AE5. **Covers R8, R10.** Given one open foreman proposal, when a different gap recurs, the foreman records the observations but opens no second proposal.
- AE6. **Covers R11.** Given a proposal the operator closed, when daily reports keep listing the same finding with nothing new, the foreman does not propose it again; when a new repository shows the same gap, it may, and says so.
- AE7. **Covers R17.** Given a part with no answer past its stall window, the tracker marks it stalled on its next run and the daily report lists it. Given a part whose issue could not be read, it is shown as unknown.
- AE8. **Covers R12.** Given a brief that cannot be read on main, the dispatch for that program stops and the tracker says why.
- AE9. **Covers R3.** Given a domain file that lists a repository that is private, archived or not tracked, the pull request still passes its structural check, the tracker's preflight reports that repository as ineligible, and dispatch refuses it.
- AE10. **Covers R19.** Given Part 0 not yet merged in `fro-bot/space-bus`, its parity parts show as held and are not dispatched; once the tracker shows Part 0 merged, the operator approves the parity dispatch separately.
- AE11. **Covers R15, R17.** Given `marcusrbrown/systematic` counters and the operator has not answered for two days, the part shows the counter, no missing-receipt alert fires, and nothing is marked complete.
- AE12. **Covers R12.** Given an approved goal pinned to brief commit A, when the brief changes on main to commit B, the goal still sends A; brief B reaches repositories only through a new goal the operator approves.

---

## Success Criteria

- The harness-tools program finishes with every part answered on the tracker, and every accepted part ends in a merged pull request that suits that repository or a no-op with a stated reason. No part is silently pending.
- The program records whether each answer avoided rework (a decline or counter that stopped a change the repository would have rejected) and counts the operator's actions: proposal approval, start pull request, dispatch approval, answers to counters, pull request reviews. Those counts decide whether negotiation stays a blocking step.
- The operator reads the program's state on the tracker without asking.
- A planner can build this without inventing behaviour: each answer, proposal rule, stall rule and Part 0 dependency has a stated outcome.

---

## Scope Boundaries

### Deferred for later

- Repository agents raising cross-repository needs to the foreman as offers.
- Reaching bfra-me repositories, which cross-repo dispatch can't target today.
- Freshness leases on every report and claim (ideation 2026-09-04, item 3).
- Automatic rerouting of a declined or countered part.
- Domains beyond harness tools.

### Outside this product's identity

- Live, interactive orchestration of OpenCode sessions. That is Space Bus (`fro-bot/space-bus`), a separate layer.
- Coordinating non-Fro-Bot agents such as Copilot coding agent or Renovate as program participants.
- The foreman merging pull requests in target repositories. The operator merges.

---

## Key Decisions

- Domain file on main, not a registry field: the operator reviews every change, and the published registry schema doesn't change.
- Specialists are the repository agents briefed per domain, not separate agents: the specialists already exist (24 of 31 repositories run one).
- Repository agents negotiate before acting: it costs one round trip per part and keeps each agent bound by its own `AGENTS.md`. The first program measures whether that pays.
- Answers live on each repository's own part issue as a label and a plain-prose reason: the skill already files that issue, and labels add no comment syntax. The completion receipt is not reused as the answer, because it is final.
- Build on cross-repo dispatch, the program-tracker skill and trackers, with no new state store: this follows the operator's autonomy direction (fix routing, prompt duties and acceptance coverage; add no writer layer or comment syntax).
- The operator acts three times per program before work starts (approve a proposal when there is one, merge the start pull request, approve dispatch), then on counters and pull requests.
- Part 0 fixes the delivery path in the program itself, so the first program's own repositories fix the gap that blocks it. It can't travel over dispatch, the path it fixes, so it is an operator-authorized ask on the part issue, with the operator authoring the change as the fallback.
- The brief is pinned to a commit: dispatch fingerprints the prompt text, so a commit in the reference makes the approval cover the brief's content.
- A decline or counter ends the dispatch attempt rather than completing it, so the completion receipt keeps one meaning and a counter never looks like a missing receipt.
- F1 runs over GitHub; Space Bus runs live sessions: the two don't depend on each other.
- Prior art: "work offers" (ideation 2026-09-04 item 7, recorded as Unexplored) and "freshness leases" (item 3, Unexplored). This doc takes the offer idea as negotiation between foreman and repository agents, keeps it on existing GitHub surfaces, and defers leases.
- `marcusrbrown/systematic` is the Systematic repository; `fro-bot/systematic` has no agent and is not onboarded.

---

## Dependencies / Assumptions

- Cross-repo dispatch reaches the three harness-tools repositories: each is public, tracked, onboarded and has a Fro Bot workflow (verified 2026-11-25).
- Dispatch passes one `prompt` input built from one checklist line, at most 4,000 characters, so a part carries a reference to its brief rather than the brief's text.
- The program-tracker skill's start flow supports a second program; today only #3512 exists.
- The tracker's wake logic does not see labels, comments or elapsed time today; R17 needs it to.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R13, R16][Technical] The label names, and how the tracker reads a part's answer and reason.
- [Affects R9][Needs research] The minimum window and observation count for a proposal, and which runs record observations.
- [Affects R17][Technical] The stall windows (before an answer, after an accept), when each clock starts, and which tracker run checks them.
- [Affects R3][Technical] Resolved in planning: eligibility is checked at use by the tracker's preflight (`checkDomainReposInRegistry`) and by dispatch's gate, not on the domain file's pull request.
- [Affects R18][Needs research] The inventory itself: which of this repository's automation (repo skills, model tiers, Renovate approval, review triggers, dispatch routing) applies to each harness-tools repository.
- [Affects R19][Technical] Whether each repository's issue path can open a pull request that changes workflows, and so whether Part 0 there falls back to the operator.
- [Affects R15][Technical] How dispatch's tracking verifies an answer's author and attempt, and which item status a decline or counter maps to.

---

## Sources

- `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md` (F1, and the 2026-11-25 reconciliation)
- `docs/ideation/2026-09-04-open-ideation.md` (items 3 and 7)
- `.agents/skills/cross-repo-program/SKILL.md`, `program-trackers.json`, `packages/dispatch` (prompt input, result marker, receipt states), `packages/status-truth/src/rollout-tracker-snapshot.ts` (wake hash)
- #3512 (the first program), #3633, #3640, #4050 (cross-repo goals)
- `fro-bot.yaml` dispatch routing in `fro-bot/dashboard`, `marcusrbrown/systematic` and `fro-bot/space-bus`
