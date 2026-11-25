---
date: 2026-11-25
topic: foreman-domain-programs
---

# Fro Bot as Foreman: Domain Briefs and Negotiated Programs (F1)

## Summary

Fro Bot directs work across repositories as a foreman. A reviewed domain file groups repositories and gives each domain a brief. Fro Bot runs programs the operator offers and proposes its own for approval. It sends each repository's own agent its part with the domain brief, and records each agent's accept, decline or counter, and the outcome, on the program tracker. The first program brings the harness tools up to this repository's agent automation.

---

## Problem Frame

North-star item F1 asks Fro Bot to "offer and consume work from other agents or humans". Its 2026-11-25 reconciliation names an F1 work-offer brainstorm as the next control-plane move.

The pieces exist but don't add up to direction. 24 of the 31 public tracked repositories run their own Fro Bot agent workflow, and 21 have an `AGENTS.md`. Cross-repo dispatch can already send a prompt to each repository's agent and collect a receipt (goals #3633, #3640 and #4050). The program-tracker skill and #3512 show that one tracker can carry a multi-repository program. But no repository knows which domain it belongs to, no domain carries standards its agents should meet, and nothing has been dispatched since 2026-10-23. Every program and every goal starts by hand, and a dispatched agent can only do the work or fail. It cannot say the ask conflicts with its own repository's rules.

There is no collision problem to solve. In the 30 days to 2026-11-25 there were no duplicate Fro Bot pull requests, and the collisions that did occur already have fixes (#4189, #4197, #4290). The gap is direction: improving security, automation and developer experience across repositories one repository at a time, by hand.

---

## Actors

- A1. Operator (Marcus): offers programs, approves Fro Bot's proposals and dispatches, reviews and merges every pull request, edits the domain file.
- A2. Foreman (Fro Bot in this repository): reads the domain file, proposes and runs programs, splits them by repository, records answers and outcomes on the tracker.
- A3. Repository agent: the Fro Bot agent workflow in each target repository. It works under its own `AGENTS.md` and decides, for its own repository, whether to accept an ask.
- A4. Program tracker: the tracker issue and Project for one program, kept current by the existing tracker duty.

---

## Key Flows

- F1. Operator offers a program
  - **Trigger:** The operator asks for a program (as the program-tracker skill starts one today) or opens a goal for a domain.
  - **Actors:** A1, A2, A4
  - **Steps:** The foreman reads the domain file and the program's goal. It accepts the program or declines it with a reason. On accept, it starts a program tracker as the skill does, listing each repository's part. The operator approves the dispatch.
  - **Outcome:** A tracker exists with one part per repository and an approved dispatch.
  - **Covered by:** R5, R6, R7, R13
- F2. Foreman proposes a program
  - **Trigger:** Repeated evidence across runs (daily reports, surveys, scanners) points to a domain-wide gap.
  - **Actors:** A2, A1
  - **Steps:** The foreman opens one proposal that names the domain, the goal, the repositories and the evidence. The operator approves it with a label, or closes it.
  - **Outcome:** An approved proposal becomes a program through F1. A closed one is not proposed again without new evidence.
  - **Covered by:** R8, R9, R10
- F3. Repository agent answers a part
  - **Trigger:** An approved dispatch reaches a repository agent.
  - **Actors:** A3, A2, A4
  - **Steps:** The agent checks the ask against its own `AGENTS.md` and repository state, then answers accept, decline with a reason, or counter with a different change. On accept it does the work through its normal pull request flow. The foreman records the answer and the outcome on the tracker.
  - **Outcome:** Every part shows an answer and, when accepted, its pull request and result. A decline or counter goes to the operator, not to automatic rerouting.
  - **Covered by:** R11, R12, R13, R14
- F4. A part goes silent
  - **Trigger:** A dispatched part has no answer after the stall window.
  - **Actors:** A2, A4, A1
  - **Steps:** The tracker marks the part stalled and lists it for the operator.
  - **Outcome:** No part stays silently pending.
  - **Covered by:** R15

---

## Requirements

**Domains**
- R1. A committed domain file on main names each domain, its repositories and its brief. Changes go through a reviewed pull request.
- R2. A brief states the domain's bar for security, agent automation and developer experience, as standards a repository agent can check its repository against.
- R3. A repository belongs to at most one domain, and only public tracked repositories can be listed.
- R4. The first domain is harness tools: `marcusrbrown/systematic`, `fro-bot/space-bus` and `fro-bot/dashboard`.

**Offered programs**
- R5. The foreman accepts or declines an offered program with a reason before any repository work starts.
- R6. An accepted program runs on a program tracker started the way the program-tracker skill starts one, with one part per repository in the domain.
- R7. The operator's approval gates every dispatch, as `dispatch-approved` gates cross-repo goals today.

**Proposed programs**
- R8. The foreman may propose a program only from evidence that recurs across runs, and the proposal cites that evidence.
- R9. At most one foreman proposal is open at a time.
- R10. A proposal the operator closed is not proposed again unless the evidence changed, and the new proposal says what changed.

**Repository agents**
- R11. Each dispatched part carries the domain brief and the program goal, and asks for an answer before work: accept, decline with a reason, or counter.
- R12. The repository agent decides under its own `AGENTS.md`. The foreman never instructs it to override its own rules.
- R13. The tracker shows each part's answer, its pull request when accepted, and its outcome.
- R14. A decline or counter is shown to the operator with the agent's reason, and the foreman does not reroute it without the operator.
- R15. A part with no answer after the stall window is marked stalled on the tracker and listed for the operator.

**First program**
- R16. The first program brings the harness tools to this repository's agent automation, measured against the harness-tools brief.

---

## Acceptance Examples

- AE1. **Covers R5, R6, R7.** Given the harness-tools domain in the domain file, when the operator offers the automation-parity program, the foreman accepts it, starts a tracker with three parts, and dispatches nothing until the operator approves.
- AE2. **Covers R11, R12, R14.** Given a part asking `fro-bot/dashboard` to adopt a rule its `AGENTS.md` forbids, when its agent receives the part, it declines with that reason, and the tracker shows the decline to the operator with no other repository affected.
- AE3. **Covers R11, R13.** Given a part `marcusrbrown/systematic` counters with a smaller change, when the counter arrives, the tracker shows the counter, and nothing is dispatched for it until the operator answers.
- AE4. **Covers R8, R9.** Given one open foreman proposal, when new evidence for a different gap recurs, the foreman records the evidence but opens no second proposal.
- AE5. **Covers R10.** Given a proposal the operator closed, when the same evidence recurs with nothing new, the foreman does not propose it again.
- AE6. **Covers R15.** Given a part with no answer after the stall window, the tracker marks it stalled and the daily report lists it.
- AE7. **Covers R3.** Given a domain file that lists a private or untracked repository, the change fails review checks and the foreman never dispatches to it.

---

## Success Criteria

- The harness-tools program completes: each of the three repositories has an answer on the tracker, and every accepted part ends in a merged pull request or a recorded decline, with no part silently pending.
- The operator starts or approves the program with one offer and one approval, and reads its state on the tracker without asking.
- A planner can build this without inventing behaviour: each answer, proposal limit and stall rule has a stated outcome.

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
- Repository agents negotiate before acting: it costs one round trip per part and keeps each agent bound by its own `AGENTS.md`.
- Build on cross-repo dispatch, the program-tracker skill and trackers, with no new state store: this follows the operator's autonomy direction (fix routing, prompt duties and acceptance coverage; add no writer layer or comment syntax).
- F1 runs over GitHub; Space Bus runs live sessions: the two don't depend on each other.
- Prior art: "work offers" (ideation 2026-09-04 item 7, recorded as Unexplored) and "freshness leases" (item 3, Unexplored). This doc takes the offer idea as negotiation between foreman and repository agents, keeps it on existing GitHub surfaces, and defers leases.
- `marcusrbrown/systematic` is the Systematic repository; `fro-bot/systematic` has no agent and is not onboarded.

---

## Dependencies / Assumptions

- Cross-repo dispatch reaches the three harness-tools repositories: each is public, tracked, onboarded and has a Fro Bot workflow (verified 2026-11-25).
- A dispatched prompt can carry the brief and the answer request, since dispatch passes only a `prompt` input.
- The program-tracker skill's start flow works for a second program; today only #3512 exists.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R11, R13][Technical] How a repository agent's answer reaches the tracker: the existing result marker, a receipt state, or a comment on the part's issue.
- [Affects R8][Needs research] What counts as recurring evidence for a proposal, and which runs produce it.
- [Affects R15][Technical] The stall window length and which run checks it.
- [Affects R3][Technical] Which check enforces the domain file's public-tracked rule.
- [Affects R16][Needs research] The harness-tools brief's concrete bar: which of this repository's automation (repo skills, model tiers, Renovate approval, review triggers) applies to each repository.

---

## Sources

- `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md` (F1, and the 2026-11-25 reconciliation)
- `docs/ideation/2026-09-04-open-ideation.md` (items 3 and 7)
- `.agents/skills/cross-repo-program/SKILL.md`, `program-trackers.json`, `packages/dispatch`
- #3512 (the first program), #3633, #3640, #4050 (cross-repo goals)
