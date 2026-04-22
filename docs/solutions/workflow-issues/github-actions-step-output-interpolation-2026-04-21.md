---
title: "Use env vars for step outputs in GitHub Actions run: blocks"
date: 2026-04-21
category: docs/solutions/workflow-issues/
module: github-workflows
problem_type: workflow_issue
component: development_workflow
severity: medium
last_updated: 2026-04-21
verified: true
applies_when:
  - Passing step output values into run: shell commands
  - Writing new workflow steps that reference ${{ steps.*.outputs.* }}
  - Reviewing workflow YAML for security or quoting issues
  - Embedding dynamic values in shell strings or JSON metadata args
tags:
  - github-actions
  - shell-injection
  - step-outputs
  - env-vars
  - workflow-pattern
  - security
---

# Use env vars for step outputs in GitHub Actions `run:` blocks

## Context

When wiring up GitHub Actions workflows, step outputs (`${{ steps.<id>.outputs.<name> }}`) are
commonly needed inside `run:` shell commands. The natural temptation is to interpolate them
directly into the shell string:

```yaml
run: |
  node scripts/notify.ts --message "Processed ${{ steps.poll.outputs.count }} items"
```

This is a latent shell injection vector. Even when today's output is always an integer, direct
`${{ }}` interpolation in `run:` blocks means any future weakening of output validation turns a
pattern issue into an exploitable path. It also creates subtle quoting failures when the value
appears inside JSON strings with single quotes.

This issue was caught in a PR review of `poll-invitations.yaml`, where three steps (Discord,
BlueSky, journal) interpolated `steps.poll.outputs.invitations_accepted` directly rather than
following the env-var pattern already established in `social-broadcast.yaml`.

## Guidance

**Always pass step outputs through `env:` blocks.** Define the output as an env var at the step
level, then reference it via POSIX shell expansion (`${VAR_NAME}`) in the `run:` body. The
`${{ }}` expression evaluator never touches shell parsing.

**Before (incorrect):**

```yaml
- name: Notify Discord
  run: |
    node scripts/discord-notify.ts \
      --message "Just joined ${{ steps.poll.outputs.invitations_accepted }} new spaces..."
```

```yaml
- name: Write journal
  run: |
    node scripts/journal-entry.ts \
      --metadata '{"count":${{ steps.poll.outputs.invitations_accepted }}}'
```

**After (correct):**

```yaml
- name: Notify Discord
  env:
    DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
    INVITATIONS_ACCEPTED: ${{ steps.poll.outputs.invitations_accepted }}
  run: |
    node scripts/discord-notify.ts \
      --message "Just joined ${INVITATIONS_ACCEPTED} new spaces..."
```

```yaml
- name: Write journal
  env:
    INVITATIONS_ACCEPTED: ${{ steps.poll.outputs.invitations_accepted }}
  run: |
    node scripts/journal-entry.ts \
      --metadata "{\"count\":${INVITATIONS_ACCEPTED}}"
```

Note the JSON metadata change: single-quoted strings (`'{"count":${{ }}'`) cannot escape embedded
values. Switching to double-quoted strings with `\"` allows proper interpolation.

## Why This Matters

GitHub's own security guidance flags direct expression interpolation in `run:` as a shell
injection vector. The expression evaluator replaces `${{ }}` **before** the shell parses the
line — so any newline, quote, semicolon, or command substitution embedded in the value executes
as shell code. An integer output is safe today; a string output from a less-controlled source is
not. The env-var pattern eliminates the risk class entirely:

- `${{ steps.poll.outputs.invitations_accepted }}` is evaluated by Actions, assigned to the env
  var (typed as a string, no shell parsing).
- `${INVITATIONS_ACCEPTED}` is then expanded by the shell, safely quoted as a scalar.

Secondary benefit: the env-var block makes all external values visible at a glance, improving
auditability during review.

## When to Apply

- Any `run:` step that references `${{ steps.*.outputs.* }}`
- Any `run:` step that references `${{ inputs.* }}` (workflow_call or workflow_dispatch inputs)
- Any `run:` step that references `${{ github.event.* }}` with user-controlled fields
- JSON metadata strings passed as CLI args — single-quoted shells cannot escape `${{ }}`

Secrets passed via `env:` are already masked by Actions and don't change this rule.

## Examples

### Full three-step fix from `poll-invitations.yaml`

```yaml
- name: Notify Discord
  if: steps.poll.outputs.invitations_accepted != '0'
  env:
    DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
    INVITATIONS_ACCEPTED: ${{ steps.poll.outputs.invitations_accepted }}
  run: |
    node scripts/discord-notify.ts \
      --message "🌐 Just joined ${INVITATIONS_ACCEPTED} new space(s)..."

- name: Post BlueSky
  if: steps.poll.outputs.invitations_accepted != '0'
  env:
    BLUESKY_HANDLE: ${{ secrets.BLUESKY_HANDLE }}
    BLUESKY_APP_PASSWORD: ${{ secrets.BLUESKY_APP_PASSWORD }}
    INVITATIONS_ACCEPTED: ${{ steps.poll.outputs.invitations_accepted }}
  run: |
    node scripts/bluesky-post.ts \
      "🌐 Just accepted ${INVITATIONS_ACCEPTED} collaboration invitation(s)..."

- name: Write journal
  if: steps.poll.outputs.invitations_accepted != '0'
  env:
    GITHUB_TOKEN: ${{ secrets.FRO_BOT_PAT }}
    INVITATIONS_ACCEPTED: ${{ steps.poll.outputs.invitations_accepted }}
  run: |
    node scripts/journal-entry.ts \
      --event invitation_accepted \
      --text "Joined ${INVITATIONS_ACCEPTED} new repo(s)..." \
      --metadata "{\"count\":${INVITATIONS_ACCEPTED}}"
```

### Reference: correct pattern in `social-broadcast.yaml`

`social-broadcast.yaml` was already following this pattern before the issue was caught in
`poll-invitations.yaml`, making it the canonical in-repo reference.

## Related

- GitHub Security Hardening docs: [Untrusted input](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections)
- In-repo reference: `.github/workflows/social-broadcast.yaml` (uses env-var pattern throughout)
- Caught in PR review: fro-bot/.github PR #3162
