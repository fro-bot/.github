---
title: 'Classifying GitHub review events when detecting iteration signals'
date: 2026-06-22
last_updated: 2026-06-22
problem_type: workflow_issue
component: development_workflow
module: github-actions-workflows
severity: medium
verified: 2026-06-22
tags:
  - github-api
  - code-review
  - detection-heuristic
  - review-states
  - bot-reviewer
applies_when:
  - A script or workflow classifies a PR's review history to detect "multi-round" or "iterated" pull requests.
  - The reviewer whose behavior is being measured is a bot or automated reviewer with its own review-submission pattern.
  - The heuristic counts review events (rounds, corrections, state transitions) to drive a downstream decision.
---

# Classifying GitHub review events when detecting iteration signals

## Context

A detector that scores PRs by "how many review rounds did this take" is only as good as its model of how the reviewer actually records reviews. The first implementation of the learning-capture harvest counted reviews in state `CHANGES_REQUESTED` and required two or more — a reasonable model for a human reviewer who explicitly requests changes each round.

It found nothing. The run examined real merged PRs and emitted zero candidates.

The reason was a wrong model of the reviewer. The Fro Bot reviewer (login `fro-bot`, a `User`-type bot) almost never submits `CHANGES_REQUESTED`. Its pattern is to **approve**, and when a new commit lands after approval, GitHub **auto-dismisses** that approval and the bot re-reviews — recording a `DISMISSED` event, not a `CHANGES_REQUESTED`. So the real iteration signal lived entirely in `DISMISSED` events the detector ignored, while the state it counted was one the reviewer effectively never enters.

The failure was invisible in tests (which used `CHANGES_REQUESTED` fixtures that matched the code) and only surfaced when the detector ran against real review history and returned an empty cohort. Two more wrong guesses followed before the signal was grounded against actual review-state data across recent PRs.

The distinction that matters: **a dismissed approval is not a fresh review round on its own merits — it is a marker that a new push invalidated a prior sign-off.** Conflating "any review event" with "a round," or assuming the human `CHANGES_REQUESTED` idiom, corrupts the count.

## Guidance

**Before counting review events, gather real review-state data for the specific reviewer and verify which states they actually emit.** Do not assume the human `CHANGES_REQUESTED`-per-round idiom; a bot reviewer may express the same "this changed, look again" signal as `DISMISSED`.

When implementing the detector:

- **Key on the reviewer identity explicitly.** Filter reviews to the reviewer login(s) you mean to measure (e.g. a `FRO_BOT_REVIEWER_LOGINS` set), not all reviewers. Counting every reviewer conflates unrelated activity into the signal.
- **Enumerate every review state and decide its contribution deliberately.** GitHub review states are `APPROVED`, `CHANGES_REQUESTED`, `DISMISSED`, `COMMENTED`. Decide what each means for your metric rather than treating any non-empty review as a round. A useful split:
  - *substantive rounds* = `APPROVED | CHANGES_REQUESTED | DISMISSED` (exclude `COMMENTED` — a comment is not a round).
  - *correction signals* = `DISMISSED | CHANGES_REQUESTED` (the events that mean "this needed another pass").
  - A predicate like `substantiveRounds >= 2 AND correctionSignals >= 1` captures genuine iteration whether the reviewer uses `CHANGES_REQUESTED` or `DISMISSED`.
- **Do not use a proxy axis like commit count.** Commit count is a tempting "iteration" proxy but is the wrong axis: dependency-automation PRs can carry dozens of commits with no review iteration, while a genuinely iterated PR may have a handful. Exclude automation by author/label instead, and base the signal on review events.
- **Paginate the reviews call.** `pulls.listReviews` defaults to a small page; an iterated PR can have reviews spanning pages, so an unpaginated call undercounts rounds.
- **Pair the logic with a fixture covering the dismissed-then-reapproved sequence** specifically, plus a non-candidate fixture where the count threshold is met but the correction-signal requirement is not — that boundary is exactly where a naive "rounds >= N" predicate goes wrong.

The general rule: **a heuristic that classifies its own historical signal is easy to get subtly wrong on the boundary cases, and the error stays invisible until you run it against real data.** Ground the model in observed reviewer behavior before trusting the count.
