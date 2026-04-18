---
type: entity
title: Fro Bot Agent
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/gpt
    sha: 60bd62e86caa1a07610c2162d9ffbb917d172dc3
    accessed: 2026-04-18
tags: [fro-bot, github-actions, ci-cd, agent, automation, code-review]
aliases: [fro-bot-agent, fro-bot-workflow]
related:
  - marcusrbrown--gpt
  - marcusrbrown--ha-config
---

# Fro Bot Agent

The Fro Bot agent (`fro-bot/agent`) is a GitHub Actions-based autonomous code review, triage, and maintenance agent. It is the runtime engine for the Fro Bot persona, deployed as a reusable workflow action across Marcus R. Brown's repositories.

## Action Reference

- **Action:** `fro-bot/agent@v0.40.2` (SHA-pinned: `df5588ff823628b4a17b248d546dd527c7bcfd0e`)
- **Platform:** GitHub Actions
- **Engine:** OpenCode (`OPENCODE_PROMPT_ARTIFACT`)

### Required Secrets/Variables

| Secret/Variable      | Purpose                         |
| -------------------- | ------------------------------- |
| `OPENCODE_AUTH_JSON` | OpenCode authentication         |
| `FRO_BOT_PAT`        | GitHub PAT for repo operations  |
| `FRO_BOT_MODEL`      | LLM model identifier (variable) |
| `OMO_PROVIDERS`      | Provider configuration          |

## Operational Modes

Observed in [[marcusrbrown--gpt]] workflow configurations:

### 1. PR Review

- **Trigger:** `pull_request` (opened, synchronize, reopened, ready_for_review, review_requested)
- **Behavior:** Structured code review with explicit verdict framework (PASS / CONDITIONAL / REJECT)
- **Sections:** Blocking issues, non-blocking concerns, missing tests, risk assessment (LOW/MED/HIGH)
- **Constraints:** Read-only — does not push commits, modify code, or create branches

### 2. Daily Maintenance

- **Trigger:** `schedule` (cron)
- **Behavior:** Updates a rolling "Daily Maintenance Report" issue with repo health metrics
- **Sections:** Summary metrics, stale issues/PRs, unassigned bugs, quality gate status, recommended actions
- **Rolling window:** 14-day retention per dated section, historical summary for older runs

### 3. Autoheal

- **Trigger:** Separate workflow (`fro-bot-autoheal.yaml`), daily cron + dispatch
- **Behavior:** Five-category automated repair cycle
- **Categories:**
  1. Errored PRs — diagnose and fix failing CI on open PRs
  2. Security — remediate Dependabot/Renovate security alerts
  3. Code quality & repo hygiene — build, test, coverage, conventions, AGENTS.md drift
  4. Developer experience — lint fixes, formatting
  5. Quality gates verification — full gate pass on default branch
- **Hard boundaries:** No force-push, no direct-to-main, no test weakening, no config tampering

### 4. Ad-hoc / Dispatch

- **Trigger:** `workflow_dispatch` with custom prompt, or `@fro-bot` mention in issue/PR comments
- **Constraint:** Comment-triggered runs require `OWNER`, `MEMBER`, or `COLLABORATOR` association

## Concurrency

Workflows use `fro-bot-{number}` concurrency groups keyed to the issue/PR/discussion number (or run ID for schedule/dispatch). `cancel-in-progress: false` — concurrent runs queue rather than cancel.

## Adoption Status

| Repository | Fro Bot Workflow | Autoheal | Notes |
| --- | --- | --- | --- |
| [[marcusrbrown--gpt]] | Yes | Yes | Full integration (PR review, daily maintenance, autoheal) |
| [[marcusrbrown--ha-config]] | No | No | Follow-up PR recommended to add Fro Bot workflow |
