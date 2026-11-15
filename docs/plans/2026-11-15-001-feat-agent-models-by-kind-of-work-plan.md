---
title: "feat: choose the agent's model by kind of work"
type: feat
status: active
date: 2026-11-15
origin: docs/brainstorms/2026-11-15-agent-models-by-kind-of-work-requirements.md
---

# feat: choose the agent's model by kind of work

## Overview

Every agent step reads its model from `vars.FRO_BOT_MODEL`. A small composite action resolves the model from one of three settings (review, act, light), each falling back to `FRO_BOT_MODEL`, fails when the result is empty, prints the result, and hands it to the agent step. Every agent step in five workflows reads the resolved value. A test classifies every agent step.

## Problem Frame

See the origin document. In short: one variable serves pull request reviews, the daily passes, surveys and the light jobs, so reviewing on one model family and acting on another means editing the variable by hand between runs. An empty model input makes the action use an unseen default.

## Requirements Trace

Requirement IDs are the origin document's.

- R1, R2. Three settings, each falling back to `FRO_BOT_MODEL`. Units 1 and 2.
- R3. An empty resolved model fails before the agent starts and names the setting read and `FRO_BOT_MODEL`. Unit 1, wired in Unit 2.
- R4–R6. Which run uses which setting. Unit 2.
- R7. Every agent step is classified for every event that reaches it. Unit 2.
- R8. A re-run keeps its event and therefore its setting; a re-dispatched survey uses act. Unit 2.
- R9. The run's log names the model. Unit 1.
- R10. Documentation. Unit 3.
- R11. Initial values, set by the operator after merge. Unit 4.

## Scope Boundaries

- No model IDs in the repository. Values live in repository variables.
- No change to the agent's prompts, tokens, permissions, `uses:` references or dependencies.
- No package module. The composite and its test are the whole mechanism.
- Wiki pages and `knowledge/log.md` that mention `FRO_BOT_MODEL` are generated and stay as they are.

### Deferred to Separate Tasks

- Adding up the per-run cost shown in job summaries, and choosing the light model from it.
- An independent review of Remediate's own pull requests.

## Context & Research

### Relevant Code and Patterns

- Nine agent steps: three in `.github/workflows/fro-bot.yaml` (the content job, Remediate, Observe), three attempts in `.github/workflows/survey-repo.yaml`, and one each in `capture-learnings.yaml`, `capture-patterns.yaml` and `draft-solutions.yaml`. Each sets `model: ${{ vars.FRO_BOT_MODEL }}`.
- Composite actions to model on: `.github/actions/knowledge-mcp-config/action.yaml` (inputs through `env:`, an output mapped from a step, whitespace stripping) and `.github/actions/knowledge-mcp-summary/action.yaml` (fixed message text). Their tests (`scripts/knowledge-mcp-config-action.test.ts`, `scripts/knowledge-mcp-summary-action.test.ts`) parse `action.yaml` and run the step's shell with `runStepWithStubs` from `@fro-bot/test-kit`.
- Tests that enumerate every `fro-bot/agent` step and fail on one missing from their table: `scripts/knowledge-mcp-callers.test.ts`, `scripts/repo-skills-callers.test.ts`.
- The content job already tests "a comment on a pull request" in `DELIVERY_NOTE` with `github.event_name == 'issue_comment'` and `github.event.issue.pull_request != null`, evaluated by `evaluateExpressionValue` from `@fro-bot/test-kit` (`scripts/fro-bot-pr-comment-delivery.test.ts`). The evaluator supports `||`, `&&`, `!`, `==`, `!=`, parentheses, literals, dotted paths, `endsWith`, `contains` and `fromJSON`.
- `draft-solutions.yaml`: the `draft` job checks out the drafted branch's head when a drafted pull request is open. That branch can predate a new composite. The `harvest` job checks out the workflow's own ref (the default branch on a scheduled run) and already exposes job outputs, which `scripts/draft-solutions-workflow.test.ts` compares as an exact object.
- No checkout in these jobs names a `ref` except `draft`. A local action is loaded from the checked-out workspace.
- `scripts/knowledge-mcp-callers.test.ts` requires the knowledge summary step immediately after every agent step, survey retries included. `scripts/agent-post-step-credential-guard.test.ts` scans steps before and after the agent for credentials.
- `scripts/draft-solutions-workflow.test.ts` pins `vars.FRO_BOT_MODEL` in the draft step's `model`.
- The runner echoes each step's `with:` block, so the log already shows `model: <value>`. The agent's own log says only that an override is present.

### Institutional Learnings

- `docs/solutions/best-practices/a-status-line-must-not-mean-two-things-2026-11-14.md`: one fixed line per outcome. The resolver prints one line for a resolved model and a different one for failure.
- `docs/solutions/best-practices/search-for-every-consumer-before-ordering-units-that-delete-2026-11-14.md`: find every reader of a name before changing it. Here: every reader of the `model:` text.
- `docs/solutions/workflow-issues/agent-credential-preflights-are-workflow-contracts-2026-10-09.md`: a pre-agent step is part of the workflow's contract and gets its own test.

## Key Technical Decisions

- **A composite action resolves the model, and the agent reads its output.** The checked value is then the used value. An inline `vars.X || vars.FRO_BOT_MODEL` on each step cannot express the content job safely and would need a second copy for the check.
- **The tier is chosen before the fallback.** In `cond && vars.REVIEW || vars.LIGHT`, an empty review value falls through to the light value. The workflow passes a tier name (`review`, `act` or `light`) and all four values; the composite picks by tier, then falls back to `FRO_BOT_MODEL` only.
- **Leading and trailing whitespace is trimmed, and a value of only whitespace is empty.** A variable holding only spaces would otherwise pass an expression test and reach the agent. A value that still contains a line break after trimming is rejected with a fixed message, before anything is logged or written.
- **One resolver per job, unconditional, before the first agent step.** A resolver with its own condition could be skipped while an agent step runs. The survey's three attempts share one. In `capture-patterns` the job is already gated, so the resolver needs no condition.
- **The content job's tier is one expression:** review when the event is `pull_request` or `pull_request_review_comment`, or is `issue_comment` on a pull request; light otherwise. Issues, issue comments and discussion comments are light.
- **`draft-solutions` resolves in `harvest` and checks again in `draft`.** `harvest` runs at the workflow's ref, so the composite exists there on a scheduled run. It resolves after checkout and before the harvest step, exposes the model as a job output, and `draft` reads it. A job output can arrive empty, so `draft` has a step before the agent that fails with a fixed message when the value it received is empty, and the agent reads that same value. An empty configuration fails the run in `harvest` even when there is nothing to draft, and `draft` and `publish` are then skipped. R3 intends that.
- **A re-run of `draft` alone reuses the model `harvest` resolved.** A full re-run resolves again from the current variables. The tier is light either way.
- **Variable names:** `FRO_BOT_MODEL_REVIEW`, `FRO_BOT_MODEL_ACT`, `FRO_BOT_MODEL_LIGHT`, with `FRO_BOT_MODEL` as the fallback.
- **No shape check on the value.** The action already rejects a model that is not `provider/model`.
- **The resolver prints the model and which variable supplied it.** Variables are not secrets, and the runner already prints the value.

## Open Questions

### Resolved During Planning

- How the content job tells a pull request run from the rest: the expression above, in the form the delivery note already uses.
- Where the empty check runs: inside the composite, once per job, before the agent step.
- How the classification test pins the wiring: by the resolver step's `tier` input and the agent step's `model` reference.
- Whether the log names the model: the runner's echo does today; the resolver adds a line that also names the source.

### Deferred to Implementation

- The exact wording of the failure message and the log line.
- Whether the three survey attempts share one resolver step before the first attempt or each reads the same output. One step is expected.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

| Tier input | Tier value | Fallback | Result | Log |
| --- | --- | --- | --- | --- |
| `review` | set | any | the review value | resolved, from the review variable |
| `review` | empty or spaces | set | the fallback | resolved, from `FRO_BOT_MODEL` |
| `review` | empty | empty | failure | names the review variable and `FRO_BOT_MODEL` |
| `act`, `light` | as above for their own variable |  |  |  |
| anything else |  |  | failure | names the bad tier |

The light and act values are never used for a review tier, and the reverse.

## Implementation Units

- [x] **Unit 1: The model resolver**

**Goal:** A composite action that turns a tier and four values into one model, or fails.

**Requirements:** R1, R2, R3, R9.

**Dependencies:** None.

**Files:**

- Create: `.github/actions/agent-model/action.yaml`
- Test: `scripts/agent-model-action.test.ts`

**Approach:**

- Inputs: `tier`, `review`, `act`, `light`, `fallback`. Output: `model`.
- Trim each value. Pick the tier's value; when empty, use the fallback; when that is empty too, fail with a fixed message naming the tier's variable and `FRO_BOT_MODEL`.
- An unknown tier fails with a fixed message that does not echo the input. A value with a line break inside it fails the same way.
- The script sets its own strict mode, because the test harness runs it with plain `bash`.
- On success print one line with the model and the variable it came from, and write the output.
- Inputs reach the shell through `env:`, never by interpolation into the script.

**Execution note:** Test-first.

**Patterns to follow:** `knowledge-mcp-config/action.yaml` for inputs through `env:` and the mapped output; `scripts/knowledge-mcp-summary-action.test.ts` for running the step's shell.

**Test scenarios:**

- Happy path: each tier with its own value set returns that value and names its variable in the log.
- Happy path: each tier with its own value empty returns the fallback and names `FRO_BOT_MODEL`.
- Edge case: a value of only spaces or only a line break counts as empty.
- Edge case: a model padded with spaces or followed by a line break resolves to the model alone, with the right source named.
- Edge case: tier `review` with the review value empty and the light, act and fallback values set returns the fallback, never the light or act value. The same for the other two tiers.
- Error path: the tier's value and the fallback both empty exits non-zero, names both variables, and writes no `model` output.
- Error path: an unknown or empty tier exits non-zero with the fixed message and writes no output.
- Error path: a value with a line break inside it exits non-zero, writes no `model` output and adds no output line.
- Edge case: a value containing shell metacharacters is not executed.

**Verification:**

- Type check, lint and tests pass. No workflow references the action yet.

---

- [x] **Unit 2: Wire the workflows and classify every agent step**

**Goal:** Every agent step reads the resolved model, and a test fails for a step that does not.

**Requirements:** R2, R4–R8.

**Dependencies:** Unit 1.

**Files:**

- Modify: `.github/workflows/fro-bot.yaml`, `.github/workflows/survey-repo.yaml`, `.github/workflows/capture-learnings.yaml`, `.github/workflows/capture-patterns.yaml`, `.github/workflows/draft-solutions.yaml`
- Create: `scripts/agent-model-callers.test.ts`
- Test: `scripts/draft-solutions-workflow.test.ts` (the exact `harvest` outputs object and the draft step's model assertion), and any other workflow test the search below finds

**Approach:**

- Add one resolver step after checkout and before the first agent step in the content job, Remediate, Observe, the survey job, `capture-learnings` and `capture-patterns`. It has no `if:` and no `continue-on-error`. Tier: the expression for the content job; `act` for Remediate, Observe and surveys; `light` for the two capture jobs.
- Keep the knowledge summary step immediately after each agent step, and add nothing between a survey attempt and its summary.
- In `draft-solutions`, add the resolver to `harvest` with tier `light`, after checkout and before the harvest step, and expose its output as a job output. In `draft`, add the step that fails on an empty received value, before the agent.
- Each agent step's `model` reads the resolver's output. No `model` reads a variable directly.
- The resolver step carries no credential and runs before the agent, so the post-agent credential guard does not apply to it.
- Before editing, search for every reader of the `model:` text and of step positions in these jobs.

**Execution note:** Test-first. Write the classification test, watch it fail on all nine steps, then edit the YAML.

**Patterns to follow:** `scripts/knowledge-mcp-callers.test.ts` for the table and the totality check; `scripts/fro-bot-pr-comment-delivery.test.ts` for evaluating a job expression per event.

**Test scenarios:**

- Happy path: the table holds exactly the nine agent steps, each with a tier; a tenth step in any workflow fails the totality check. (Origin AE7.)
- Happy path: each agent step's `model` is the resolver's output (a step output, or the `harvest` job output for `draft`), and a resolver step precedes the job's first agent step with the table's tier and the four variables in the right inputs.
- Edge case: no resolver step has an `if:` or `continue-on-error`.
- Happy path: in `draft-solutions`, `harvest` declares the model output, `draft` needs `harvest`, and `draft` has a step before the agent that fails when the received model is empty; running that step's shell with an empty value exits non-zero and with a value exits zero.
- Happy path: with only the two initial values set, a pull request review resolves to the review value, and a daily pass, a survey and an issue run resolve to the fallback. (Origin AE9, through the resolver's shell and the tier table.)
- Happy path: the content job's tier evaluates to review for `pull_request`, `pull_request_review_comment` and an issue comment on a pull request, and to light for `issues`, an issue comment on an issue and `discussion_comment`. (Origin AE3.)
- Happy path: Remediate, Observe and all three survey attempts use `act`; the tracker and branding reach those jobs and add no agent step of their own. (Origin AE4.)
- Edge case: no agent step's `model` contains `vars.`.
- Edge case: the survey's three attempts read the same resolved value.
- Integration: `actionlint` passes on the five workflows.

**Verification:**

- Type check, lint, tests and `actionlint` pass with only `FRO_BOT_MODEL` set, which is today's configuration.
- The pull request's own review run shows the resolver's line naming `FRO_BOT_MODEL` as the source.

---

- [ ] **Unit 3: Documentation**

**Goal:** The documentation names the settings.

**Requirements:** R10.

**Dependencies:** Unit 2.

**Files:**

- Modify: `README.md`, `.github/copilot-instructions.md`

**Approach:**

- `README.md`: near the workflow tables, the three variables, which runs read each, the fallback, and that a run with no model fails before the agent starts.
- `.github/copilot-instructions.md`: one sentence where the agent steps are described, naming the composite and the classification test.

**Test expectation:** none -- documentation only. Lint and the link check cover it.

**Verification:**

- `bun run lint` passes.

---

- [ ] **Unit 4: Set the values and read the first runs**

**Goal:** Reviews and the daily passes run on different model families with no manual step.

**Requirements:** R11 and the origin's success criteria.

**Dependencies:** Units 1–3 merged.

**Files:**

- Modify: `docs/plans/2026-11-15-001-feat-agent-models-by-kind-of-work-plan.md` (record the results)

**Approach:**

- The operator sets `FRO_BOT_MODEL_REVIEW` to the OpenAI model and `FRO_BOT_MODEL` to the Anthropic model.
- Read the resolver's line in the next pull request review, the next daily run, the next survey and the next issue run.

**Test expectation:** none -- live verification.

**Verification:**

- A pull request review's log names the review variable and the OpenAI model. A daily run's and a survey's logs name `FRO_BOT_MODEL` and the Anthropic model. Each is recorded here with its run.

## System-Wide Impact

- **Interaction graph:** five workflows and nine agent steps; the tracker and branding reach Observe and Remediate through `fro-bot.yaml`.
- **Error propagation:** an empty configuration fails the job before the agent step. In `draft-solutions` it fails in `harvest`.
- **State lifecycle risks:** a full re-run reads the variables' current values, not the values at the original run. A re-run of `draft` alone reuses the model `harvest` resolved.
- **API surface parity:** none. No package or published contract changes.
- **Unchanged invariants:** prompts, tokens, permissions, triggers, the fork gate, and the agent's other inputs.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| An empty tier value falls through to another tier's value | The composite picks by tier before any fallback; Unit 1 tests each cross-tier case. |
| A drafted branch that predates the composite breaks `draft` | `draft` reads a job output from `harvest`, which runs at the default ref. |
| A new agent step ships without a tier | The totality check in Unit 2 fails. |
| The operator clears `FRO_BOT_MODEL` | Every tier without its own value fails before the agent with a message naming the variables. That is intended. |
| A job output arrives empty in `draft` | The step before the agent fails on an empty value. |
| `actionlint` does not check the composite's shell | The shell contract tests in Unit 1 are the check. |
| A workflow dispatched from a branch that predates the composite fails to load it | Scheduled runs use the default branch. The same exposure exists for the other local actions. |
| A step-count or step-order test breaks on the added step | Unit 2 searches for those tests before editing. |

## Documentation / Operational Notes

- A model change is a variable edit. It leaves no history; the run log's resolver line is the record.
- The pull request touches only `.github/` and `scripts/`, so the mutation gate does not apply unless a touched test is in the gate's trigger set.

## Sources & References

- Origin: `docs/brainstorms/2026-11-15-agent-models-by-kind-of-work-requirements.md`
- Agent steps: `.github/workflows/fro-bot.yaml`, `.github/workflows/survey-repo.yaml`, `.github/workflows/capture-learnings.yaml`, `.github/workflows/capture-patterns.yaml`, `.github/workflows/draft-solutions.yaml`
- Composite patterns: `.github/actions/knowledge-mcp-config/action.yaml`, `.github/actions/knowledge-mcp-summary/action.yaml`
- Classification tests: `scripts/knowledge-mcp-callers.test.ts`, `scripts/repo-skills-callers.test.ts`
