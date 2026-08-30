---
type: topic
title: Probot Settings
created: 2025-06-18
updated: 2026-08-30
tags: [probot, github, repository-settings, automation, governance]
related:
  - marcusrbrown--github
  - marcusrbrown--dev-like
  - marcusrbrown--ha-config
  - marcusrbrown--esphome-life
  - bfra-me--github
  - bfra-me--ha-addon-repository
  - bfra-me--works
---

# Probot Settings

Repository configuration management via [Probot Settings](https://probot.github.io/apps/settings/) (repository-settings/app). Syncs `.github/settings.yml` declarations to GitHub repository settings, branch protection, labels, and collaborator access.

## How It Works

A `settings.yml` file in `.github/` declares the desired state of a repository. The Probot Settings App reads this file and applies the configuration to the GitHub repository via the API. Changes to `settings.yml` are synced automatically.

### Inheritance with `_extends`

Settings files can extend a base template using `_extends`:

```yaml
_extends: .github:common-settings.yaml
```

This pulls defaults from the named file. The extending file only needs to declare overrides. The `.github` shorthand resolves to the `{owner}/.github` repository — the conventional location for org/user-wide defaults.

## Usage Across Repos

### marcusrbrown/.github (Template Source)

[[marcusrbrown--github]] contains the canonical `common-settings.yaml` for Marcus's personal repositories. Its own `.github/settings.yml` self-extends this template, adding repo-specific overrides (description, topics, required status checks).

### marcusrbrown/ha-config

[[marcusrbrown--ha-config]] extends `fro-bot/.github:common-settings.yaml` (the Fro Bot org template) rather than Marcus's personal template. This means ha-config inherits Fro Bot org governance (1 required reviewer, code owner reviews, etc.) rather than Marcus's personal settings (no required reviews).

### marcusrbrown/esphome.life

[[marcusrbrown--esphome-life]] uses the bare short-form `_extends: .github:common-settings.yaml`, which resolves to the **owner's** `.github` — i.e. `marcusrbrown/.github` (per the `_extends` rule above), _not_ the Fro Bot org template. Surveys before 2026-07-12 misattributed this to `fro-bot/.github`; the file has always written the un-prefixed `.github`. This is a caution that the `marcusrbrown/*` fleet is **not** uniform: some repos extend `fro-bot/.github` explicitly (ha-config), others inherit `marcusrbrown/.github` via the short-form. Verify the literal prefix in `settings.yml` before assuming which org template a repo inherits.

### marcusrbrown/dev-like

[[marcusrbrown--dev-like]] (survey 2026-07-31) uses the bare short-form `_extends: .github:common-settings.yaml`, resolving to the **owner's** `.github` (`marcusrbrown/.github`) per the `_extends` rule — same inheritance shape as esphome.life above. Its overrides declare `repository.{name, description, homepage, topics}` and a `main` branch-protection block with `required_status_checks` strict on `validate` + **`Fro Bot`**, `enforce_admins: true`, `required_pull_request_reviews: null`, `required_linear_history: true` — the checks-over-reviewers posture. Note the `Fro Bot` status check is required for merge, wiring the repo's own agent into the gate (the agent's `pr-review` mode produces it). Applied via an `update-repo-settings.yaml` workflow, landed alongside the repo's other onboarding (Renovate, Fro Bot) after its 2026-07-12 initial survey had none.

### fro-bot/.github (Org Template)

The `fro-bot/.github` repository (this repo) has its own `common-settings.yaml` with stricter governance:

- Required PR reviews (1 approver, dismiss stale, code owner reviews, last push approval)
- `fro-bot` as admin, `marcusrbrown` as push
- Fewer, more focused labels

### bfra-me/.github (Bfra-Me Org Template)

[[bfra-me--github]] ships a **third** `common-settings.yaml` for the
`@bfra-me` org. Surveyed 2026-05-20 (SHA `a81be4c`):

- Repo-level: `is_template: true`, `has_projects: false`, `has_wiki: false`,
  squash-only merging, auto-merge enabled, branch deletion on merge,
  `allow_update_branch: true`, squash commit title `COMMIT_OR_PR_TITLE`
- Branch protection (`main`): 12 required status checks (Advanced
  Security Analysis, CodeQL, Container Scan, Create Renovate Changeset,
  Fro Bot, GitGuardian Scan, License Scan, Quality Check, Release,
  Renovate, Review Dependencies, Triage), strict mode, linear history,
  admin enforcement, `required_approving_review_count: 0` — governance
  leans on status checks rather than human reviewers
- `update-repository-settings` is shipped as a local custom action in
  this repo and consumed by `update-repo-settings.yaml`

[[bfra-me--ha-addon-repository]], [[bfra-me--works]], and other
`bfra-me/*` repos extend this template; most `marcusrbrown/*` repos
extend the `fro-bot/.github` template instead. Reconciling which org
template is canonical for what audience is an open follow-up.

The [[bfra-me--works]] settings file is a representative example of how
`bfra-me/*` repos compose the org template: it extends
`.github:common-settings.yaml` and overrides `repository.{name,
description, topics}` plus a 12-check branch-protection list (`Analyze`,
`Build`, `CI`, `CodeQL`, `Create Renovate Changeset`, `Fro Bot`,
`Lint`, `Prepare`, `Renovate / Renovate`, `Review Dependencies`,
`Test`, `Workspace Analysis`) with `enforce_admins: true`,
`required_linear_history: true`, and `required_pull_request_reviews:
null` — matching the org-template posture (checks over reviewers).

## Settings Sync Workflow

Repos using Probot Settings typically include an `update-repo-settings.yaml` workflow:

- **Trigger:** Push to main, daily cron, manual dispatch
- **Implementation:** Reusable workflow from `bfra-me/.github`
- **Auth:** GitHub App via `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets
- **Reusable workflow version:** `bfra-me/.github` v4.16.31 (as of 2026-06-28 in [[marcusrbrown--github]], SHA `7c7e50a5`; was v4.16.20 on 2026-05-25, bumped from v4.16.9 via sequential Renovate PRs — config-only repos like this one are dominated by reusable-workflow patch churn, ~16 v4.16.x bumps in five weeks)
- **Known defect (2026-06-10):** in [[bfra-me--github]] itself, the
  `update-repo-settings` workflow's `Filter Changed Files` step fails
  with git exit 128 on push events (bfra-me/.github#2213, opened
  2026-05-23, still open) — the settings-sync path has a live bug at
  its source repo. The upstream workflow now carries an explicit
  `fetch-depth: 0` with a comment citing #2213, so the source-side
  workaround has landed (confirmed at v4.22.0, 2026-08-30)

### Upstream contract (`bfra-me/.github`, confirmed at v4.22.0, 2026-08-30)

The canonical settings-sync reusable workflow lives at
`bfra-me/.github/.github/workflows/update-repo-settings.yaml`. Its
`workflow_call` interface is deliberately minimal:

- **Secrets:** `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY`, both
  `required: true`
- **Inputs:** none
- **Permissions:** `contents: read` at the workflow level; write
  authority arrives via the App token
- Internally it path-filters (`common-settings.yaml`,
  `.github/settings.yml`, the workflow file itself) on push events with
  `fetch-depth: 0`, and skips the token mint entirely when nothing
  relevant changed

Because the secrets signature is identical to the Renovate reusable
workflow's, a caller can be pointed at the wrong one and still resolve,
authenticate, and report success. That is exactly the failure mode below.

### Settings sync that never syncs settings (esphome.life, 7th confirmation)

[[marcusrbrown--esphome-life]]'s `update-repo-settings.yaml` calls
`bfra-me/.github/.github/workflows/renovate.yaml` rather than the
settings workflow. The workflow, the job, and the file are all named
"Update Repo Settings"; the daily `23 12` cron and the push-to-`main`
trigger both fire and both report success — while running Renovate.
`.github/settings.yml` in that repo has therefore never been applied by
the repo's own automation, and every merge to `main` runs Renovate
twice.

Two governance implications worth generalizing:

1. **A declared `settings.yml` is not an applied `settings.yml`.** The
   branch protection that repo declares (four required contexts, strict,
   linear history, admin enforcement) is in force — but that state
   traces to the Probot Settings App and/or historical manual
   application, not to the workflow that claims to maintain it. If the
   App is ever uninstalled or the declaration is edited, the drift will
   be silent. Verify sync by reading the workflow's actual run logs, not
   its name.
2. **Identical secrets signatures make miswiring undetectable.** Both
   reusable workflows take the same two required secrets and no inputs,
   so there is no type-level guard. When publishing a family of reusable
   workflows, differentiating the input surface (even a single required
   no-op input) would turn this class of error into a hard failure at
   `workflow_call` resolution time.

The repair is a one-token path swap. See [[github-actions-ci]] for the
generalized "SHA pinning validates the ref, not the path" analysis.

## Common Configuration Patterns

### Merge Strategy

Both templates enforce squash-only merging (merge commits and rebase disabled) with auto-merge enabled and branch deletion on merge. This produces clean, linear git histories.

### Branch Protection

Both templates require linear history and enforce admin restrictions. The key divergence is PR review requirements — personal repos (marcusrbrown) skip reviews, org repos (fro-bot) require them.

### Collaborator Access Model

| Context        | `marcusrbrown` | `fro-bot` |
| -------------- | -------------- | --------- |
| Personal repos | admin          | push      |
| Org repos      | push           | admin     |

This dual-permission model ensures the appropriate entity has administrative control based on repo ownership.
