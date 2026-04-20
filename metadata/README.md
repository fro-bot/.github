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

Update convention: human-maintained; edits land via the `data` branch (see [Editing metadata files](#editing-metadata-files) below).

### `repos.yaml`

Collaborator repositories where Fro Bot is active.

```yaml
version: 1
repos:
  - owner: string
    name: string
    added: ISO date
    onboarding_status: pending | onboarded | failed | lost-access | pending-review
    last_survey_at: ISO datetime | null
    last_survey_status: success | failure | null
    has_fro_bot_workflow: boolean
    has_renovate: boolean
```

Update convention: invitation handler, metadata workflow, and daily reconcile update this file programmatically on the `data` branch.

Onboarding status values:

- `pending` — repo was added but has not been surveyed yet.
- `onboarded` — repo was surveyed successfully at least once.
- `failed` — the most recent survey attempt failed.
- `lost-access` — fro-bot no longer has collaborator access (revoked, archived, or deleted). The entry is preserved for audit; other fields stay at their last-known values.
- `pending-review` — repo was discovered via collaborator access from an owner not listed in `allowlist.yaml`. A GitHub issue labeled `reconcile:pending-review` tracks each one; the entry stays in this state until an operator promotes it (approve and change status to `pending`) or removes it.

For private repos in `pending-review`, the issue body omits the owner/repo name and identifies the subject via its GitHub `node_id`. Public-repo `pending-review` issues include the full `owner/repo`. The control-plane repo is public, so issue bodies never leak private repo names.

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

Update convention: metadata workflow and Renovate dispatch update this file programmatically on the `data` branch.

### `social-cooldowns.yaml`

Last broadcast timestamps used to avoid social spam.

```yaml
version: 1
cooldowns:
  <event-type>:
    last_broadcast_at: ISO datetime
    repo: optional scoping string
```

Update convention: social broadcast workflow updates this file programmatically on the `data` branch.

## Credential expectations

| File                    | Updated by                            | Credential         |
| ----------------------- | ------------------------------------- | ------------------ |
| `allowlist.yaml`        | Human PR                              | n/a (human commit) |
| `repos.yaml`            | Invitation handler, Metadata workflow | `FRO_BOT_PAT`      |
| `renovate.yaml`         | Metadata workflow, Renovate dispatch  | `FRO_BOT_PAT`      |
| `social-cooldowns.yaml` | Social broadcast                      | `FRO_BOT_PAT`      |

PAT split summary:

- `FRO_BOT_POLL_PAT`: invitation polling, acceptance, starring, metadata commits to `data` branch, and survey workflow dispatch. Required scopes: `repo` (contents:write for data branch commits, actions:write for workflow dispatch), `user` (read:user for invitation polling, user:invite for acceptance), `starring`.
- `FRO_BOT_PAT`: agent execution, PR review, autoheal, branding. Write-capable across repos.

### Workflow secret mapping

| Workflow                | Secrets passed (explicit, not inherited)                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `fro-bot.yaml`          | `FRO_BOT_PAT`, `OPENCODE_AUTH_JSON`, `OMO_PROVIDERS`, `OPENCODE_CONFIG` |
| `fro-bot-autoheal.yaml` | Same 4 (via reusable call to `fro-bot.yaml`)                            |
| `apply-branding.yaml`   | Same 4 (via reusable call to `fro-bot.yaml`)                            |
| `poll-invitations.yaml` | `FRO_BOT_POLL_PAT` only                                                 |
| `merge-data.yaml`       | `GITHUB_TOKEN` (auto-provisioned, job-scoped permissions)               |
| `reconcile-repos.yaml`  | `FRO_BOT_POLL_PAT` + `APPLICATION_ID` + `APPLICATION_PRIVATE_KEY`       |

## Editing metadata files

The `metadata/*.yaml` files are enforced as Fro-Bot-writable-only on `main`. A CI job (`Check Wiki Authority`, backed by `scripts/check-wiki-authority.ts`) fails any PR that modifies them unless authored by `fro-bot` or `fro-bot[bot]`. This prevents `main` from drifting relative to `data`, which is the single authoritative source.

For intentional manual edits (e.g., adding an entry to `allowlist.yaml`), land the change on `data` directly and let the existing promotion flow land it on `main`:

```bash
git worktree add ../fro-bot-.github-data data
cd ../fro-bot-.github-data
# edit the file
git add metadata/<file>.yaml
git commit -m "chore(metadata): <what changed and why>"
git push origin data
```

The `Merge Data Branch` workflow runs on a schedule (weekly) and opens a `data → main` promotion PR authored by `fro-bot[bot]`, which is allowed through the guard. For faster turnaround, trigger it manually via `gh workflow run merge-data.yaml`.

`metadata/README.md` (this file) and other human documentation remain editable through normal PRs to `main` — the guard targets only `metadata/*.yaml`.

## Commit conventions

- All programmatic metadata writes must go through `scripts/commit-metadata.ts` and target the `data` branch.
- Manual edits to `metadata/*.yaml` also target `data` and are promoted via the `Merge Data Branch` workflow — see above.
- Metadata files are initialized in-repo first; automation updates existing files only.

## Metrics note

`metrics.yaml` is intentionally deferred. Operational telemetry is routed through the journal issue system. The metrics pipeline belongs to the deferred self-improvement plan.
