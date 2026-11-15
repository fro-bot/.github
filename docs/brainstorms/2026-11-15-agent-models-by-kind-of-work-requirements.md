---
date: 2026-11-15
topic: agent-models-by-kind-of-work
---

# Choose the Agent's Model by Kind of Work

## Summary

Agent runs read one of three model settings: review, act or light. Each falls back to the current single setting, so an unset one changes nothing while that setting holds a model. Runs on a pull request use review. Remediate, Observe, surveys and the rollout tracker use act. Issue triage, issue and discussion comments, capture and drafted solutions use light.

---

## Problem Frame

Every agent step in this repository reads its model from one repository variable, `FRO_BOT_MODEL`. To review pull requests with one model family and run the daily passes with another, the operator edits that variable by hand between runs. On 2026-11-14 the morning's daily, survey and tracker runs used an Anthropic model, the variable was changed that evening, and the pull request reviews after it used an OpenAI model. Whatever runs next uses whatever the variable holds at that moment.

The jobs differ in what a wrong answer costs. A passing pull request review can result in an approval, subject to the action's delivery and safety guards, and `Fro Bot` is a required check. Remediate opens fix pull requests. Observe and surveys write wiki pages that reach `main` without a person reading them. Issue and comment runs can also write wiki pages that promote on their own. Capture jobs publish proposal issues, and drafted solutions open a pull request that a person merges.

One auth secret already reaches both providers, and both model IDs in use have completed runs here. An empty model input is a hazard: the action then uses whatever default its configuration resolves, without saying so.

Workflow runs, approximately, for 2026-11-01 to 2026-11-14: 125 to 135 pull request reviews, 35 to 40 tracker runs (a tracker run starts the agent only when its preflight finds a change), 32 to 35 surveys, 13 daily runs, 11 issue runs, two capture-learnings runs, two draft-solutions runs and one manual capture-patterns run.

---

## Requirements

**Settings**

- R1. There are three model settings, each a repository variable: review, act and light.
- R2. Each setting falls back to `FRO_BOT_MODEL` when it is unset or empty. With all three unset and `FRO_BOT_MODEL` holding a model, every run uses the model it uses today.
- R3. A run whose model resolves to empty fails before the agent starts, with a message naming the setting it read and `FRO_BOT_MODEL`. No run starts on an implicit default. This changes one case: today a run with an empty `FRO_BOT_MODEL` starts on whatever default the action's configuration resolves.

**Which run uses which setting**

- R4. Review: every agent run on a pull request. That covers the automatic review of a pull request, a run started by a comment on a pull request, and a run started by a review comment.
- R5. Act: Remediate and Observe, on their schedule, on a dispatch and when another workflow calls them (the rollout tracker and branding), and every survey attempt.
- R6. Light: a run started by an issue, by a comment on an issue or by a comment on a discussion, and the capture-learnings, capture-patterns and draft-solutions jobs.
- R7. Every agent step in the repository belongs to exactly one of the three for every event that can reach it. A new agent step cannot merge unclassified.
- R8. A re-run uses the setting of its original event. A survey re-dispatched after a conflict uses act, as every survey attempt does.

**Visibility**

- R9. Each run's log shows the model it used, so a reader can confirm which setting applied.
- R10. The documentation names the three variables, which runs read each, and the fallback.

**Initial values**

- R11. After the change merges, the operator sets the review variable to the OpenAI model and `FRO_BOT_MODEL` to the Anthropic model. Act and light stay unset and fall back. Until the operator sets them, every run keeps using `FRO_BOT_MODEL`.

---

## Acceptance Examples

- AE1. **Covers R2.** Given only `FRO_BOT_MODEL` is set, a pull request review, a daily pass, a survey and an issue run all use that model.
- AE2. **Covers R4, R5.** Given the review variable holds model A and `FRO_BOT_MODEL` holds model B, a pull request review uses A and the daily Remediate and Observe passes use B, with no edit between them.
- AE3. **Covers R4, R6.** Given the same values and a light variable holding model C, an `@fro-bot` comment on a pull request and a review comment each use A. A new issue, a comment on an issue and a comment on a discussion each use C.
- AE4. **Covers R5, R8.** Given an act variable holding model D, a tracker run that reaches Observe, a branding run that reaches Remediate, each of a survey's three attempts and a survey re-dispatched after a conflict all use D.
- AE5. **Covers R2.** Given the review variable is set to an empty string and `FRO_BOT_MODEL` holds model B, a pull request review uses B.
- AE6. **Covers R3.** Given every variable is unset or empty, an agent job fails before the agent step and names the setting it read and `FRO_BOT_MODEL`.
- AE7. **Covers R7.** Given a new workflow adds an agent step that belongs to none of the three settings, a test fails.
- AE8. **Covers R9.** Given a pull request review and a daily pass on different models, each run's log names its own model.
- AE9. **Covers R11.** Given the operator has set only the two initial values, a pull request review uses the OpenAI model, and a daily pass, a survey and an issue run use the Anthropic model.

---

## Success Criteria

- The operator stops editing a variable between runs: pull request reviews and the daily passes use different model families on the same day with no manual step.
- A change of model for one kind of work is one edit of that kind's variable and does not affect the other two. A change to `FRO_BOT_MODEL` affects every kind still falling back to it.
- A planner can write the change from this document without deciding which run reads which setting or what an unset variable does.

---

## Scope Boundaries

- Adding up the per-run cost that each job summary shows. Nothing aggregates it today. It is a separate follow-up, and the light model is chosen after it.
- An independent review of Remediate's own pull requests. The review job skips pull requests the `fro-bot` user wrote, so those get no agent review under any setting.
- One setting per job. Three settings can be split later without undoing this change.
- Models for subagents, a fallback when a provider is down, and which provider accounts or model IDs are available.
- Running one job on two models to compare them.

---

## Key Decisions

- Three settings by kind of work, not one per job: the kinds match what a wrong answer costs, and nine knobs have no evidence behind them yet.
- A comment on a pull request counts as review. Work on a pull request is review work whether a push or a comment started it.
- A comment on a discussion counts as light, like a comment on an issue.
- Light is not purely low-stakes: its issue and comment runs can write wiki pages that promote on their own. It still ships unset, so those runs keep the act model until the operator chooses otherwise.
- Light ships unset. Its jobs are the fewest, so it saves the least, and its model is better chosen once costs are visible.
- Plain variables with a fallback, not one JSON variable: a malformed JSON value would break every job at once.
- Values live in repository variables, not in the workflow files, so a model change needs no pull request. The cost is that a variable edit leaves no history; the run log is the record.
- An empty model fails the run. Today it silently selects a default. The check reads the resolved value at run time, because a test of the workflow text cannot see a variable that is cleared later.

---

## Dependencies / Assumptions

- `OPENCODE_AUTH_JSON` reaches both providers. Run logs on 2026-11-14 list `anthropic` and `openai`.
- `anthropic/claude-opus-5-5` and `openai/gpt-6.1-sol` each appear as the model of a successful run here. No other model ID was checked.
- `FRO_BOT_MODEL` is set today, so R3's failure case does not occur at merge.
- A workflow called by another workflow in this repository reads this repository's variables.
- The action takes the model as `provider/model` and applies it to the session. Not checked: whether a configured default inside `OPENCODE_CONFIG` exists, which is what an empty input would select.
- The rollout tracker and branding reach the agent through Remediate or Observe, so they take the act setting without their own.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R6][Technical] How the content job tells a pull request run from an issue or discussion run for every trigger that reaches it, including a comment on a pull request, which arrives as an issue comment. An empty review value must fall back to `FRO_BOT_MODEL` and never to the light value.
- [Affects R3][Technical] Where the empty-model check runs so that it fails before the agent step in every workflow without repeating logic, and so that the value it checks is the value the agent step uses.
- [Affects R9][Technical] Whether each job's log already names the effective model, or the change must print it.
- [Affects R7][Technical] How the test that classifies every agent step pins the model expression.
- [Affects R1][Technical] The three variable names.

---

## Sources / Research

- Model input at every agent step: `.github/workflows/fro-bot.yaml`, `.github/workflows/survey-repo.yaml`, `.github/workflows/capture-learnings.yaml`, `.github/workflows/capture-patterns.yaml`, `.github/workflows/draft-solutions.yaml`. Each reads `vars.FRO_BOT_MODEL`.
- Callers of the daily jobs: `.github/workflows/gateway-rollout-tracker.yaml`, `.github/workflows/apply-branding.yaml`.
- A test already pins one model expression: `scripts/draft-solutions-workflow.test.ts`. Tests that classify every agent step: `scripts/knowledge-mcp-callers.test.ts`, `scripts/repo-skills-callers.test.ts`.
- The review job's author exclusion and its required check: `.github/workflows/fro-bot.yaml`, `.github/settings.yml`.
