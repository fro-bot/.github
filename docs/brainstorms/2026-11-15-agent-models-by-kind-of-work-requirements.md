---
date: 2026-11-15
topic: agent-models-by-kind-of-work
---

# Choose the Agent's Model by Kind of Work

## Summary

Agent runs read one of three model settings: review, act or light. Each falls back to the current single setting, so an unset one changes nothing. Runs on a pull request use review. Remediate, Observe, surveys and the rollout tracker use act. Issue triage, issue comments, capture and drafted solutions use light.

---

## Problem Frame

Every agent step in this repository reads its model from one repository variable, `FRO_BOT_MODEL`. To review pull requests with one model family and run the daily passes with another, the operator edits that variable by hand between runs. On 2026-11-14 the morning's daily, survey and tracker runs used an Anthropic model, the variable was changed that evening, and the pull request reviews after it used an OpenAI model. Whatever runs next uses whatever the variable holds at that moment.

The jobs differ in what a wrong answer costs. A pull request review that ends in `PASS` becomes an approval on a required check. Remediate opens fix pull requests. Observe and surveys write wiki pages that reach `main` without a person reading them. Issue triage, captured learnings and drafted solutions are read by a person before anything merges.

One auth secret already reaches both providers, and both model IDs in use have completed runs here. An empty model input is a hazard: the action then uses whatever default its configuration resolves, without saying so.

Volume over 14 days: about 135 pull request reviews, 40 tracker runs, 35 surveys, 13 daily runs, 11 issue runs, and two runs each of the weekly capture and drafting jobs.

---

## Requirements

**Settings**

- R1. There are three model settings, each a repository variable: review, act and light.
- R2. Each setting falls back to `FRO_BOT_MODEL` when it is unset or empty. With all three unset, every run uses the model it uses today.
- R3. A run whose model resolves to empty fails before the agent starts, with a message naming the variables to set. No run starts on an implicit default.

**Which run uses which setting**

- R4. Review: every agent run on a pull request. That covers the automatic review of a pull request and a run started by a comment on a pull request.
- R5. Act: Remediate and Observe, on their schedule, on a dispatch and when another workflow calls them (the rollout tracker and branding), and every survey attempt.
- R6. Light: a run started by an issue or by a comment on an issue, and the capture-learnings, capture-patterns and draft-solutions jobs.
- R7. Every agent step in the repository belongs to exactly one of the three. A new agent step cannot merge without one.

**Visibility**

- R8. Each run's log shows the model it used, as it does today, so a reader can confirm which setting applied.
- R9. The documentation names the three variables, which runs read each, and the fallback.

**Initial values**

- R10. After the change merges, the operator sets the review variable to the OpenAI model and `FRO_BOT_MODEL` to the Anthropic model. Act and light stay unset and fall back. Until the operator sets them, behaviour is unchanged.

---

## Acceptance Examples

- AE1. **Covers R2.** Given only `FRO_BOT_MODEL` is set, a pull request review, a daily pass, a survey and an issue run all use that model.
- AE2. **Covers R4, R5.** Given the review variable holds model A and `FRO_BOT_MODEL` holds model B, a pull request review uses A and the daily Remediate and Observe passes use B, with no edit between them.
- AE3. **Covers R4, R6.** Given the same values and a light variable holding model C, an `@fro-bot` comment on a pull request uses A, and a new issue uses C.
- AE4. **Covers R5.** Given an act variable holding model D, a tracker run that reaches Observe through a workflow call uses D.
- AE5. **Covers R3.** Given every variable is unset, an agent job fails before the agent step and names the variables.
- AE6. **Covers R7.** Given a new workflow adds an agent step with a literal model or the bare `FRO_BOT_MODEL`, a test fails.

---

## Success Criteria

- The operator stops editing a variable between runs: pull request reviews and the daily passes use different model families on the same day with no manual step.
- A change of model for one kind of work is one variable edit and does not affect the other two.
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
- Light ships unset. Its jobs are the fewest, so it saves the least, and its model is better chosen once costs are visible.
- Plain variables with a fallback, not one JSON variable: a malformed JSON value would break every job at once.
- Values live in repository variables, not in the workflow files, so a model change needs no pull request. The cost is that a variable edit leaves no history; the run log is the record.
- An empty model fails the run. Today it silently selects a default.

---

## Dependencies / Assumptions

- `OPENCODE_AUTH_JSON` reaches both providers. Run logs on 2026-11-14 list `anthropic` and `openai`.
- `anthropic/claude-opus-5-5` and `openai/gpt-6.1-sol` have each completed runs here. No other model ID was checked.
- The action takes the model as `provider/model` and applies it to the session. Not checked: whether a configured default inside `OPENCODE_CONFIG` exists, which is what an empty input would select.
- The rollout tracker and branding reach the agent through Remediate or Observe, so they take the act setting without their own.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R6][Technical] How the content job tells a pull request run from an issue run for every trigger that reaches it, including a comment on a pull request, which arrives as an issue comment.
- [Affects R3][Technical] Where the empty-model check runs so that it fails before the agent step in every workflow without repeating logic.
- [Affects R7][Technical] How the test that classifies every agent step pins the model expression.
- [Affects R1][Technical] The three variable names.

---

## Sources / Research

- Model input at every agent step: `.github/workflows/fro-bot.yaml`, `.github/workflows/survey-repo.yaml`, `.github/workflows/capture-learnings.yaml`, `.github/workflows/capture-patterns.yaml`, `.github/workflows/draft-solutions.yaml`. Each reads `vars.FRO_BOT_MODEL`.
- Callers of the daily jobs: `.github/workflows/gateway-rollout-tracker.yaml`, `.github/workflows/apply-branding.yaml`.
- A test already pins one model expression: `scripts/draft-solutions-workflow.test.ts`. Tests that classify every agent step: `scripts/knowledge-mcp-callers.test.ts`, `scripts/repo-skills-callers.test.ts`.
- The review job's author exclusion and its required check: `.github/workflows/fro-bot.yaml`, `.github/settings.yml`.
