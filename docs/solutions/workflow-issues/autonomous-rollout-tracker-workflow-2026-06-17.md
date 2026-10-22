---
title: Autonomous rollout tracker workflows
module: gateway-rollout-tracker
date: 2026-06-17
last_updated: 2026-10-22
problem_type: workflow_issue
component: development_workflow
severity: medium
verified: true
applies_when:
  - a cross-repo rollout needs ongoing autonomous status tracking
  - a reusable agent workflow is called from a dedicated scheduled workflow
  - an operator comment must start a run that holds write credentials
  - tracker comments, the issue body and project fields are updated by the same agent workflow
related_components:
  - fro-bot-workflow
  - github-projects
  - daily-digest
tags:
  - github-actions
  - fro-bot
  - rollout-tracking
  - projects
  - reusable-workflows
  - issue-comment
---

# Autonomous rollout tracker workflows

## Context

The Gateway operator control-surface rollout spans `fro-bot/agent`, `fro-bot/dashboard`,
`marcusrbrown/infra`, and this control-plane repository. A static tracker issue is not enough: as
agent units land, deployments ship, and dashboard issues close, the issue body, the dependency
matrix and the `fro-bot` user-owned GitHub Project (project 1) need a routine updater.

Fro Bot owns three surfaces for the tracker `fro-bot/.github#3512`: the issue body, the comment
thread and the Project 1 fields. It writes them directly with `FRO_BOT_PAT`. There is no separate
state store or writer layer.

## Guidance

### Two entrances, one credentialed run

`gateway-rollout-tracker.yaml` is the only workflow that writes the tracker. It calls the reusable
Fro Bot workflow with one tracker prompt and has two entrances:

- the daily schedule and manual dispatch, which run a preflight and wake the agent only when the
  rollout moved;
- a `comment_id` dispatch from `rollout-tracker-mention.yaml`, which wakes the agent for an
  operator mention.

```yaml
concurrency:
  group: gateway-rollout-tracker
  cancel-in-progress: false

on:
  workflow_dispatch:
    inputs:
      comment_id:
        required: false
        default: ''
        type: string

jobs:
  update-rollout-tracker:
    needs: preflight
    if: >-
      needs.preflight.result == 'success' &&
      needs.preflight.outputs.should_comment == 'true'
    uses: ./.github/workflows/fro-bot.yaml
```

Both entrances share the caller-level concurrency group, so only one run edits the body and the
Project at a time. The dispatch input is `comment_id`, never `prompt`: in a called workflow
`github.event` is the caller's, and `fro-bot.yaml` prefers `github.event.inputs.prompt` over its own
`inputs.prompt`.

### Why mentions need a hop

`fro-bot/agent` withholds the `gh` credential from the model on `issue_comment`, `issues` and
`pull_request` runs. A run started by a comment can read and reply in conversation but cannot edit
the body or the Project. `schedule` and `workflow_dispatch` runs receive the credential.

`rollout-tracker-mention.yaml` bridges the two. On `issue_comment` `created` it runs one job when
all of these hold:

- the issue number is 3512 and the comment is not on a pull request;
- the comment author is `marcusrbrown`;
- the body contains `@fro-bot`.

The job has workflow `permissions: {}`, job permission `actions: write` only, no checkout and a
single step. The step checks that the comment ID matches `^[0-9]+$`, then runs
`gh workflow run gateway-rollout-tracker.yaml --ref main -f comment_id=<id>` with `GH_TOKEN` set to
the job `GITHUB_TOKEN` and `GH_REPO` set to the repository. A `workflow_dispatch` created with
`GITHUB_TOKEN` starts a run, so no App token is minted. Only the numeric ID crosses the hop; the
tracker run reads the comments itself.

The content job of `fro-bot.yaml` excludes exactly these comments (issue 3512, not a pull request,
author `marcusrbrown`), so the operator gets one reply. Mentions from other trusted authors, and
`marcusrbrown` mentions on other issues, still go to the general reply job.

The content job also skips `issues` events whose sender is `fro-bot`. The tracker edits the #3512
body as `fro-bot`, and without that clause each edit would start a second, unserialized agent run.

### The preflight and its wake inputs

The preflight runs `scripts/rollout-tracker-snapshot.ts`, which makes no model call. It hashes:

- each tracked Project item's identity and issue state;
- the latest `releases/latest` tag of `fro-bot/agent` and `fro-bot/dashboard`;
- the run ID and head SHA of the latest successful run of `deploy-gateway.yaml`,
  `deploy-dashboard.yaml` and `deploy.yaml` in `marcusrbrown/infra`;
- the `contractVersion` from `https://dashboard.fro.bot/operator/health`.

infra's own release tags are not an input: they do not identify what is deployed. A router run
that deploys nothing wakes the agent once, and that run posts nothing.

Project field values, labels and prose stay out of the hash. Every read fails closed: a failed or
empty fetch ends the preflight with a `FATAL` line on stderr, empty stdout and a non-zero exit. A
failed read never counts as "no change". The update job requires a successful preflight and
`should_comment == 'true'`, so every agent run has a valid marker to write.

Pending operator mentions are a separate wake condition, not a hash input. The preflight reads the
#3512 comments through the REST API (`gh api --paginate`), which carries numeric comment IDs. A
mention is pending when its comment is by `marcusrbrown`, contains `@fro-bot`, and has an ID above
the baseline `last_mention_id` (see the marker section). The comment that dispatched the run reaches
the preflight as `ROLLOUT_TRACKER_COMMENT_ID` (numeric or empty). It is pending when it is above the
baseline, even if the comment read lags and does not list it yet, and it is ignored when at or below
the baseline because it is already acknowledged. A queued dispatch for a comment that an earlier run
already answered therefore finds nothing pending and does not wake. `decideComment` returns
`should_comment` when the hash changed or any mention is pending. Answering the mentions does not
change the next hash comparison.

A mention stays unanswered when the hop fails, the preflight fails, or GitHub displaces the run in a
concurrency group. A failed preflight in particular leaves the mention for the next scheduled run or
a manual `workflow_dispatch` of `gateway-rollout-tracker.yaml` (optionally with `comment_id`); that
run repeats the preflight and answers whatever is pending.

### The marker

The marker is `<!-- gateway-rollout-tracker:{"hash":…,"snapshot":…,"last_mention_id":…} -->`. The
preflight script builds the complete string and outputs it; the prompt embeds it and the agent copies
it verbatim into every tracker reply and every in-place edit. `<`, `>` and `&` are escaped inside the
JSON as `\u003c`, `\u003e` and `\u0026`, so Project text containing `-->` cannot close the HTML
comment early.

The marker comments authored by `fro-bot` or `fro-bot[bot]` are the only gate record; the script
writes no state. The parser requires a string `hash`. `last_mention_id` is the highest operator
`@fro-bot` comment ID the tracker has answered, and the baseline is the highest valid value across
every parseable marker comment in the thread, so a damaged latest marker cannot lower it. When no
marker carries a valid value, including a thread with no marker at all, the baseline is the highest
operator mention that precedes the latest `fro-bot` or `fro-bot[bot]` comment of any kind, because a
reply without a marker still answered the mentions before it. With no `fro-bot` comment at all, every
operator mention is pending. The new value is the highest pending ID, or the baseline when nothing is
pending, so it never moves over a mention outside the answer set.

### Mention anchoring

A run answers exactly the comment IDs in `pending_mention_ids`, fetching each by ID; the dispatched
`comment_id` is context only. Thread position does not decide what is pending: a mention posted while a run is
in flight can sit before that run's marker comment and is still pending afterwards, because its ID is
above the baseline.

When nothing needs to change and no pending mention ID is listed, the agent posts no new comment. The
preflight outputs `marker_comment_id`, the REST ID of the latest parseable marker comment (empty when
none exists). The prompt tells the agent to PATCH exactly that comment
(`gh api -X PATCH repos/fro-bot/.github/issues/comments/<id>`) and replace only its marker, so the
stored hash and `last_mention_id` stay current and the next scheduled run does not wake again for the
same state. The agent posts a one-line seed comment that ends with the marker only when the ID is
empty.

The anchor moves only when a comment with a valid marker lands. A run that fails before writing one
leaves the old marker, and its mentions stay pending. A reply whose marker the agent damaged does not
parse, so the preflight keeps reading the earlier marker comments and the mentions that reply answered
stay pending. A thread with no parseable marker writes its first marker on the next wake, and the baseline falls
back to the position rule above.

### The prompt

One prompt serves both modes. It tells the agent to verify claims against linked issue and pull
request state, releases, the infra deploy runs, the health contract and the acceptance-run results
the operator posts. It then rewrites every stale section of the body, updates Project 1 and adds
missing dependencies, and maintains the acceptance list. Each acceptance entry is labelled
operator-reported or agent-verified, and an unmet gate is never removed silently. When comment IDs
are listed the agent replies once to them; with none listed it replies only when something changed.

### Daily-only work

Reusable calls keep the caller's `event_name`. Gate daily-only steps away from custom-prompt calls:

```yaml
if: >-
  (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') &&
  inputs.prompt == ''
```

## Why This Matters

Reusable workflow calls keep the caller's `github` context. A scheduled tracker workflow that calls
the generic Fro Bot workflow still looks like `github.event_name == 'schedule'` inside the reusable
workflow. Without the `inputs.prompt == ''` guard, daily-report discovery, digest counting and
gateway announcements can run from the tracker path.

Tracker updates are write operations against shared state: one issue body, one thread and one
GitHub Project. The shared concurrency group serializes them.

The hop is its own workflow because `fro-bot.yaml` runs under `contents: read` for its callers. A
job inside it that requests `actions: write` exceeds the caller's ceiling and fails at startup.

Explicit secret mapping keeps the caller aligned with least-privilege workflow conventions and avoids
spreading unrelated repository secrets into reusable workflow calls.

The snapshot script also runs in Status Truth as a best-effort step. When one of its reads fails
there, rollout claims stay unresolved and the job continues.

## When to Apply

Apply this pattern when a Fro Bot workflow tracks progress across multiple repositories and updates
issues and Projects, or when a trusted operator's comment must start a credentialed run.

Do not use the general daily oversight prompt as the tracker writer. It reports drift; the dedicated
workflow owns the body, comments and Project mutations so duplicate update paths do not fight each
other.

## Examples

Good split:

- daily oversight: notices tracker drift and reports it in the daily issue
- dedicated tracker: rewrites the body, updates Project fields and posts `@fro-bot` status comments
- mention workflow: dispatches the tracker with a numeric comment ID and writes nothing

Bad split:

- daily oversight and dedicated tracker both post routine tracker comments
- the general reply job and the tracker both answer the same operator mention
- a dispatch input named `prompt` on the tracker
- comment text interpolated into a `run:` block or a prompt
- tracker runs without a concurrency group
- daily-digest announce steps running during custom tracker prompts
- a failed fetch recorded as an empty value in the snapshot

## Related

- [Agent credential preflights are workflow contracts](agent-credential-preflights-are-workflow-contracts-2026-10-09.md) —
  `issue_comment` runs are credential-withheld; gate on the comment author with a closed set and
  test step shells through the helper.
- [Safe workflow consolidation: trace every invariant and caller](workflow-consolidation-invariant-trace-2026-06-24.md) —
  when collapsing two scheduled workflows into one, trace each safety invariant and remaining
  caller explicitly; the concurrency-group and dispatch-entry-point patterns here are the
  invariants that consolidation must preserve.
- [Safely deleting a superseded workflow or signal path](safe-superseded-workflow-removal-2026-06-24.md) —
  the inverse lesson: before retiring a duplicate execution path, confirm no remaining callers,
  full replacement coverage, shared dependencies preserved, and no dangling declarations.
