# Metadata

This directory contains the Fro Bot control plane's public, versioned, auditable metadata state. These files are intentionally GitHub-native so humans and automation can review changes through ordinary branch history and pull requests.

## Files

### `allowlist.yaml`

Approved inviters whose collaboration invitations Fro Bot may accept.

```yaml
version: 1
approved_inviters:
  - username: string
    added: ISO date
    role: string
```

Update convention: human-maintained. Changes go through PRs to `main`.

### `repos.yaml`

Collaborator repositories where Fro Bot is active.

```yaml
version: 1
repos:
  - owner: string
    name: string
    added: ISO date
    onboarding_status: pending | onboarded | failed
    last_survey_at: ISO datetime | null
    last_survey_status: success | failure | null
    has_fro_bot_workflow: boolean
    has_renovate: boolean
```

Update convention: invitation handler (Unit 7) and metadata workflow (Unit 16) update this file programmatically on the `data` branch.

### `renovate.yaml`

Repositories where Fro Bot can dispatch Renovate through `workflow_dispatch`.

```yaml
version: 1
repos:
  - owner: string
    name: string
    workflow_path: .github/workflows/renovate.yaml
    last_dispatched_at: ISO datetime | null
    last_dispatch_status: success | skipped-running | failure | null
```

Update convention: metadata workflow (Unit 16) and Renovate dispatch (Unit 15) update this file programmatically on the `data` branch.

### `social-cooldowns.yaml`

Last broadcast timestamps used to avoid social spam.

```yaml
version: 1
cooldowns:
  <event-type>:
    last_broadcast_at: ISO datetime
    repo: optional scoping string
```

Update convention: social broadcast workflow (Unit 14) updates this file programmatically on the `data` branch.

## Credential expectations

| File                    | Updated by                                       | Credential         |
| ----------------------- | ------------------------------------------------ | ------------------ |
| `allowlist.yaml`        | Human PR                                         | n/a (human commit) |
| `repos.yaml`            | Invitation handler (U7), Metadata workflow (U16) | `FRO_BOT_PAT`      |
| `renovate.yaml`         | Metadata workflow (U16), Renovate dispatch (U15) | `FRO_BOT_PAT`      |
| `social-cooldowns.yaml` | Social broadcast (U14)                           | `FRO_BOT_PAT`      |

PAT split summary:

- `FRO_BOT_POLL_PAT`: invitation polling, acceptance, starring, metadata commits to `data` branch, and survey workflow dispatch. Required scopes: `repo` (contents:write for data branch commits, actions:write for workflow dispatch), `user` (read:user for invitation polling, user:invite for acceptance), `starring`.
- `FRO_BOT_PAT`: agent execution, PR review, autoheal, branding. Write-capable across repos.

### Workflow secret mapping

| Workflow                | Secrets passed (explicit, not inherited)                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| `fro-bot.yaml`          | `FRO_BOT_PAT`, `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG`    |
| `fro-bot-autoheal.yaml` | Same 4 (via reusable call to `fro-bot.yaml`)                               |
| `apply-branding.yaml`   | Same 4 (via reusable call to `fro-bot.yaml`)                               |
| `poll-invitations.yaml` | `FRO_BOT_POLL_PAT` only (Phase 2 Unit 7)                                   |
| `merge-data.yaml`       | `GITHUB_TOKEN` (auto-provisioned, job-scoped permissions) (Phase 2 Unit 5) |

## Commit conventions

- All programmatic metadata writes must go through `scripts/commit-metadata.ts` and target the `data` branch.
- Manual edits go through normal PR review to `main`.
- Metadata files are initialized in-repo first; automation updates existing files only.

## Metrics note

`metrics.yaml` is intentionally not created in this phase. Active-phase operational telemetry is routed through the journal issue system in Unit 13. The metrics pipeline belongs to the deferred self-improvement plan.
