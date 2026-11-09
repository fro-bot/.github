---
title: Native auto-merge refuses an already-clean PR, and a protection edit persists until the next settings run
date: 2026-11-09
last_updated: 2026-11-09
verified: 2026-11-09
category: workflow-issues
module: github-workflows
problem_type: workflow_issue
component: development_workflow
severity: medium
related_components:
  - tooling
applies_when:
  - a promotion or bot PR is meant to merge itself once its required checks pass
  - the required checks are produced inside the same run that opens the PR
  - the branch protection rule can be edited in the web UI by an account that the settings automation also uses
tags:
  - auto-merge
  - branch-protection
  - strict-status-checks
  - code-owners
  - drift
  - promotion
---

# Native auto-merge refuses an already-clean PR, and a protection edit persists until the next settings run

## Problem

`Merge Data Branch` opened the `data` to `main` promotion PR, labeled it `automerge`, and nothing read the label. The operator approved and merged ten promotions by hand. Two assumptions looked like shortcuts and both were wrong.

1. **Native auto-merge would finish the job.** `allow_auto_merge` is on, but GitHub refuses to arm auto-merge on a PR that is already clean, which is exactly what a promotion is when its strong leak gates ran as steps of the run that opened it and no required check is pending. No event fires reliably after the last required check finishes on an Actions-authored head, so no later job can arm it either.
2. **A stale promotion would be caught up by the next run.** `strict: true` makes a PR behind `main` unmergeable. `main` takes several merges a day, so the PR fell behind within hours and was caught up only by the weekly run.

A third problem sat next to them: two edits to the `main` protection rule in the web UI by the `fro-bot` user left the review requirement unenforced for hours. The daily settings run rewrote the rule, so nothing was persistently wrong, and nothing reported the window either.

## What works

- **Merge in the run that gated.** Pin one `data` commit after the merge-back, run both leak gates on it, then wait for the required checks on that commit and approve and merge pinned to it (`commit_id` on the review, `sha` on the merge). A moved head is refused by GitHub and the next run handles it.
- **Approve as a code owner who did not push.** The App pushes `data`, so an approval by the `fro-bot` user meets the last-push rule. Any push after the approval, `updateBranch` included, dismisses it, so the run never updates the PR branch after the gates.
- **Read the required list live and fail closed.** Take it from `GET /branches/main`, require it to hold every context declared in `.github/settings.yml`, and stop on an empty, short or unreadable list. A silent fallback to an empty set turns "no checks required" into "all checks passed".
- **Match checks the way GitHub does.** Check runs match by name and app. A commit status has no app, so it matches by context alone, newest first. A skipped or neutral conclusion passes.
- **Keep a kill switch the operator can reach.** A repository variable that must read `on`, read through the API before the approval and again before the merge, plus a per-PR hold label.
- **Report protection drift instead of blocking it.** A stateless watcher on `branch_protection_rule` compares the event's rule with the declared settings, identifies the settings automation by actor type and numeric id (never by login, and never the `fro-bot` user), treats a field the event does not report as neither drift nor a match, and closes its issue only on a settings write where every declared field is present and matching.

## Things that stay true

- An edit to the protection rule persists until the next settings write. Between the two, the rule is whatever the editor left, so the report has to come from the event, not from the settings run.
- A concurrency group with `cancel-in-progress: false` keeps one running and one pending run. A third event replaces the pending one, so the watcher compares each event's own rule and never relies on seeing every event.
- The first live approval has to be checked before the switch is trusted: if GitHub does not count the `fro-bot` approval as a code-owner review the merge answers 405 `blocked`, and the run must exit non-zero rather than report a green skip.
