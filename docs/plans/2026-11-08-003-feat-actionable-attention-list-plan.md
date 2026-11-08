---
title: "feat: make the daily report's attention list live and actionable"
type: feat
status: active
date: 2026-11-08
origin: docs/brainstorms/2026-11-08-actionable-attention-list-requirements.md
---

# feat: make the daily report's attention list live and actionable

## Overview

Rewrite the duties for "Needs Human Attention" in the Observe prompt:

- Each item is keyed by the object its next action works on.
- Each key is re-checked just before publishing.
- First-seen dates carry over from earlier reports.
- Operator-only items are listed first, under "Awaiting you".
- An item that recurs gets a labeled tracking issue, and Fro Bot closes that issue when the item resolves.

Add the label to the repo settings and pin the new duties with prompt contract tests.

## Problem Frame

See origin: `docs/brainstorms/2026-11-08-actionable-attention-list-requirements.md`. Across five reports, 9 of 32 items were already resolved and 8 were vague. The items have no stable key, owner or age.

## Requirements Trace

- R1–R7 (keys, item shape, re-check, carry-over, "Awaiting you"): Unit 1
- R8–R12 (escalation, the label exception): Units 1 and 2
- R13 (public repos only): Unit 1

## Scope Boundaries

- No collector script. The signals the daily passes inspect and the report's other sections stay the same.
- Remediate's own work does not change.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/fro-bot.yaml`:
  - `SHARED_RULES` and `AGENT_NOTES` at about lines 219–261 route items to the section.
  - `OBSERVE_CATEGORIES` category 5 at about line 396 says "Do NOT … apply labels".
  - `OBSERVE_OUTPUT` at about lines 438–478 creates the report, closes older ones and lays out the body structure.
- `scripts/fro-bot-workflow.test.ts` pins the Observe prompt text at about lines 340–410. New pins go next to those.
- `.github/settings.yml` `labels:` declares repo labels. `scripts/settings-labels-effective-set.test.ts` pins the effective set.

### Institutional Learnings

- Project memory 12220: Fro Bot verifies its own surfaces, so behavior goes into prompt duties rather than new machinery.
- The `AGENT NOTES` format, which gives the root cause, the smallest fix and how to verify it, is reused as the body of each tracking issue.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "fro-bot/.github .github/workflows/fro-bot.yaml Observe prompt, .github/settings.yml labels, scripts/fro-bot-workflow.test.ts",
  "freshness": { "vcs_reference": "6ad9d7b" },
  "budget": { "max_search_passes": 4, "max_candidate_inspections": 6, "exhausted": false },
  "candidates": [
    { "path_or_symbol": ".github/workflows/fro-bot.yaml#OBSERVE_OUTPUT", "description": "Daily report creation, predecessor closing and body structure", "disposition": "extend" },
    { "path_or_symbol": ".github/workflows/fro-bot.yaml#AGENT_NOTES", "description": "Cold-start note format for deferred work", "disposition": "reuse" },
    { "path_or_symbol": ".github/settings.yml#labels", "description": "Declared repo labels synced by Update Repo Settings", "disposition": "extend" },
    { "path_or_symbol": "packages/status-truth", "description": "Labeled tracking issues opened by deterministic code and closed when they clear", "disposition": "insufficient", "insufficiency_reason": "Its tracking issues come from structured claim detection. Attention items are agent judgments from the daily pass, so the lifecycle is reused as a pattern only." }
  ]
}
```

## Key Technical Decisions

- **The new duties are text inside the `OBSERVE_OUTPUT` string.** They are not a separate env key: `format()` at about `fro-bot.yaml:1090` drops keys that aren't composed, so a separate key would vanish without warning. Keeping the duties next to the report structure means one block owns the section.
- **Every item renders its key.** Each attention item ends with a `key:` line holding the URL, path or repo/workflow. Each tracking issue body starts with the same line. Walk-back, the three-report count, reuse and the readback all match on that rendered line.
- **The label is `attention-tracking`.** It is declared in `.github/settings.yml`, so Update Repo Settings creates it.
- **Category 5 gets an explicit exception.** The agent may create, label, edit and close issues labeled `attention-tracking`. The rest of category 5 stays report-only.
- **Visibility comes from `gh repo view <owner/repo> --json visibility`.** The repo counts as public only when that call returns `PUBLIC`. Any other result, including an error, is treated as private. The same rule applies to item text, "could not re-check" sources and tracking issues.
- **Predecessor order is fixed in the prompt:** find the open predecessor, read it, create today's report, read today's report back, then close the predecessor. This replaces the current "before or after creating it" wording.
- **Closing evidence goes into an edit of the issue body.** It is not posted as a comment.

## Open Questions

### Resolved During Planning

- Label name: `attention-tracking`.
- Where the duties live: a single block in `OBSERVE_OUTPUT`.

### Deferred to Implementation

- Whether the agent's per-run comment budget is real. It does not affect this plan, because closing evidence goes in the body.

## Implementation Units

- [ ] **Unit 1: Observe prompt duties**

**Goal:** The Observe prompt carries R1–R13.

**Requirements:** R1–R13

**Dependencies:** Unit 2. Both units ship in one PR. Until Update Repo Settings creates the label after merge, the agent skips escalation and says so in the run summary.

**Files:**

- Modify: `.github/workflows/fro-bot.yaml` (`OBSERVE_OUTPUT`: the `ATTENTION_RULES` block, the predecessor order and the "Awaiting you" subsection; `OBSERVE_CATEGORIES` category 5: the label exception)
- Test: `scripts/fro-bot-workflow.test.ts`

**Approach:** The block tells the agent to:

1. Split bundled bullets so each item covers one problem.
2. Key each item to the object its next action works on: an issue, PR or Project item URL, a normalized repo path, or a repo plus workflow file. Runs, comments and documents are cited as evidence only.
3. Give each item an owner, which is a handle or "you", plus one next action and an observed or inferred tag.
4. Just before publishing, re-read each key. Drop the item if the key has resolved. If only the evidence has resolved, refresh the evidence and keep the item. If the read fails, mark the item "could not re-check", naming the source only if its repo is public.
5. Take first-seen from the oldest consecutive prior report that lists the same key. If no prior report has the key, use today. Never guess a date.
6. Put operator-only items first, under "Awaiting you", each with its exact step.
7. Escalate a key that is live on three consecutive reports:
   - Search `attention-tracking` issues, open and closed, for the same key. Reuse an open one. If the operator closed it as not planned, do not refile, and report the item once as declined.
   - Otherwise file a tracking issue in the `AGENT NOTES` format.
   - Do not escalate keys that are already issues, items that are already tracked, "Awaiting you" items, or Renovate-owned fixes.
   - Show each escalated item as one line linking its issue, ending with its `key:` line.
8. On every run, close any open `attention-tracking` issue whose key has resolved. Record the evidence in the issue body.
9. Name only public repos. A problem in a private repo is reported without its name. If a repo's visibility can't be confirmed, treat it as private.

**Patterns to follow:** the existing `SCOPE CAP`, `AGENT NOTES` and category wording.

**Test scenarios:**

- Happy path: the prompt pins each duty:
  - the key definition, with evidence that is never a key;
  - the re-check before publishing, including keeping an item whose evidence resolved but whose key did not;
  - "could not re-check";
  - first-seen by walking back, with today as the fallback;
  - the "Awaiting you" placement;
  - the three-report trigger and the exclusions;
  - reuse, and no refile after not-planned;
  - closing with evidence in the body;
  - public repos only.
- Happy path: the predecessor order reads find, read, create, read back, close, and the old "Before or after creating it" wording is gone.
- Happy path: category 5 names the `attention-tracking` exception and keeps "Do NOT modify individual issues/PRs" for everything else.
- Edge case: existing pins on "Needs Human Attention" routing (`SCOPE CAP`, `TRUSTED AUTHORS`, `AGENT NOTES`) and on the report title still hold.
- Happy path: the composed agent prompt (after `format()`) contains the duties, the `key:` line rule and the visibility rule. The test asserts on the composed prompt, not only on the env value.

**Verification:** the prompt contract tests pass.

- [ ] **Unit 2: The `attention-tracking` label**

**Goal:** Declare the label so the agent can apply it.

**Requirements:** R8, R12

**Dependencies:** None

**Files:**

- Modify: `.github/settings.yml` (`labels:`)
- Test: `scripts/settings-labels-effective-set.test.ts`

**Test scenarios:**

- Happy path: a new `it` asserts that the effective label set includes `attention-tracking` with a color and description. The existing test pins only the labels declared in code.

**Verification:** the settings tests pass. After merge, the Update Repo Settings run creates the label.

- [ ] **Unit 3: Live readback**

**Goal:** Check the success criteria against the first ten reports after release.

**Requirements:** the success criteria

**Dependencies:** Units 1 and 2 merged

**Files:** none. Record the result in a smart note readback.

**Approach:** For each report, check that:

- no item's key had already resolved at publish time;
- every key live on three consecutive reports is linked or excluded;
- every item has an owner and a next action;
- no private repo is named.

**Test expectation:** none. This unit is a live measurement.

**Verification:** the four criteria hold over ten reports, or the gaps are filed.

## System-Wide Impact

- **Interaction graph:** the Observe job's prompt, and Update Repo Settings, which creates the label.
- **Unchanged invariants:**
  - there is exactly one open daily report;
  - the report's section structure stays the same, apart from the "Awaiting you" lead in its last section;
  - Remediate does not change.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| The agent keys inconsistently across days | The prompt defines keys by object type, and the readback in Unit 3 measures it. |
| The first release escalates several items at once | Only keys live on three consecutive reports qualify. Older reports count only where they plainly list the same key. |
| `FRO_BOT_PAT` can't apply labels | The label is created by settings. If applying it fails, the agent reports that in the run summary, and the operator fixes the token scope. |

## Sources & References

- **Origin document:** `docs/brainstorms/2026-11-08-actionable-attention-list-requirements.md`
- Related: `docs/ideation/2026-11-07-open-ideation.md` (idea #4)
