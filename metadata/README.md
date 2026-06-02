# Metadata

This directory contains the Fro Bot control plane's public, versioned, auditable metadata state. These files are intentionally GitHub-native so humans and automation can review changes through ordinary branch history and pull requests.

## Files

### `allowlist.yaml`

Operator-curated trust surface: who Fro Bot accepts invitations from, plus which cross-org repos can surface via the `contrib` discovery channel.

```yaml
version: 1
approved_inviters:
  - username: string
    added: ISO date
    role: string
# Optional. Empty/missing = no contrib-channel discovery.
approved_contrib_orgs:
  - string  # GitHub org login (e.g., "bfra-me")
# Optional. Empty/missing = no contrib-channel direct probes.
approved_contrib_repos:
  - string  # "owner/name" (e.g., "bfra-me/.github")
```

- `approved_inviters` — collaboration invitations from these usernames are auto-accepted by `poll-invitations.yaml`.
- `approved_contrib_repos` — direct list of `owner/name` strings probed individually for `.github/workflows/fro-bot.yaml`. The probe parses the workflow as YAML and checks that a job-level or step-level `uses:` value points at `fro-bot/agent` (or a sub-path under it). The Fro Bot App must be installed on each named repo first.
- `approved_contrib_orgs` — **not yet supported in v1.** Cross-org enumeration requires minting per-installation App tokens, which is deferred to a future plan. A non-empty value triggers a warn and is otherwise ignored. Until that infrastructure lands, surface specific cross-org repos via `approved_contrib_repos`.

The content probe is the trust signal: file presence alone is forge-able, but a structural `uses: fro-bot/agent@<ref>` directive proves the operator of that repo opted in. Comments, `name:` strings, `run:` shell, and `with:` inputs that mention `fro-bot/agent` are not action sources and do not pass the check.

Update convention: human-maintained; edits land via the `data` branch (see [Editing metadata files](#editing-metadata-files) below).

### `repos.yaml`

Repositories where Fro Bot is active. Surfaced through three discovery channels: collaborator invitations on user accounts, fro-bot's own org, and operator-allowlisted cross-org repos.

```yaml
version: 1
repos:
  - owner: string
    name: string
    node_id: string
    private: boolean
    added: ISO date
    onboarding_status: pending | onboarded | failed | lost-access | pending-review
    last_survey_at: ISO datetime | null
    last_survey_status: success | failure | null
    has_fro_bot_workflow: boolean
    has_renovate: boolean
    discovery_channel: collab | owned | contrib
    next_survey_eligible_at: ISO date | null
```

Field notes:

- `node_id` — GitHub GraphQL node ID for the repository. Used as the manual dispatch identifier: `gh workflow run survey-repo.yaml -f node_id=<node_id>`. Also used as the privacy-safe identifier in `pending-review` issue bodies for private repos.
- `private` — whether the repository is private. Entries with `private: true` are stored redacted: `owner` and `name` are replaced with `<node_id>` and canonical identifiers never reach `main`. The `node_id` is used as the subject identifier in issue bodies and workflow dispatch. Redacted entries appear on `main` as part of normal promotion — this is by design, not a privacy leak. They must not be deleted from `main` as hygiene (see [Sole-writer rule and privacy boundary](#sole-writer-rule-and-privacy-boundary) below).

Sole-writer rule: `repos.yaml` is written exclusively on the `data` branch — by the invitation handler, daily reconcile, and survey workflows running under the fro-bot identity. `main` never edits this file directly. The sole path from `data` to `main` is the weekly `data → main` promotion PR; manual hygiene edits to `repos.yaml` on a `main`-targeting feature branch are prohibited because they create a both-sides mutation that conflicts the promotion. If a private repo entry is deleted or access is lost, leave its redacted entry in `repos.yaml` as-is — the promotion privacy gate tolerates dead orphans (it grandfathers pages already present on `main` and blocks only newly-promoted unattributable pages).

Onboarding status values:

- `pending` — repo was added but has not been surveyed yet.
- `onboarded` — repo was surveyed successfully at least once.
- `failed` — the most recent survey attempt failed.
- `lost-access` — fro-bot no longer has collaborator access (revoked, archived, or deleted). The entry is preserved for audit; other fields stay at their last-known values.
- `pending-review` — repo was discovered via collaborator access from an owner not listed in `allowlist.yaml`. A GitHub issue labeled `reconcile:pending-review` tracks each one; the entry stays in this state until an operator promotes it (approve and change status to `pending`) or removes it.

For private repos in `pending-review`, the issue body omits the owner/repo name and identifies the subject via its GitHub `node_id`. Public-repo `pending-review` issues include the full `owner/repo`. The control-plane repo is public, so issue bodies never leak private repo names.

Discovery channel values:

- `collab` — repo surfaced via a collaborator invitation accepted by `poll-invitations.yaml`. Default channel for newcomers when none is specified.
- `owned` — repo surfaced via fro-bot's own org enumeration (`apps.listReposAccessibleToInstallation`). Skips `fro-bot/.github` unconditionally.
- `contrib` — repo surfaced via the operator-curated allowlist in `allowlist.yaml` (`approved_contrib_orgs` / `approved_contrib_repos`), with a successful probe for `.github/workflows/fro-bot.yaml` proving fro-bot is invoked there.

The channel is sticky after first write — neither reconcile nor any other writer auto-rewrites it. Operators re-classify by editing `metadata/repos.yaml` on the `data` branch directly.

`next_survey_eligible_at` is the ISO date at which an entry becomes eligible for re-survey, computed at survey-completion time as `last_survey_at + base_interval[channel] + jitter(owner, name, last_survey_at)`. `null` means never-surveyed (treat as immediately eligible).

### Sole-writer rule and privacy boundary

Redacted private entries (`name: <node_id>`, `private: true`) on the public `main` branch are an explicit, auditable trust decision, not an oversight. A bare `node_id` exposes only that _a_ private repo exists in fro-bot's access graph, plus a stable opaque identifier and lifecycle timing (added/surveyed dates). Resolving a `node_id` to `owner/repo` requires API access that itself gates on the repo's privacy; a reader without that access learns only that some private repo exists. Canonical `owner/repo`, repo name, and all wiki content stay off `main`. This is an accepted residual risk — existence and timing may be inferred, never identity or content.

### Privacy gates and operator tooling

A private repo's existence, name, or content must never reach a public surface. Several layers enforce this:

- **Redacted-on-write** — the mutators that write `repos.yaml` (`addRepoEntry`, `recordSurveyResult`, `resetSurveyResult`) store `private: true` entries with `owner: '[REDACTED]'` and `name: <node_id>`. Canonical identifiers never land on `data` or `main`.
- **Dispatch gate** — daily reconcile skips Survey Repo dispatch for any entry that is not definitively public.
- **Workflow resolution gate** — `survey-repo.yaml` takes a `node_id` input and resolves it to `owner/repo` only after verifying the repo is public; a private (or inaccessible) `node_id` aborts the run before any name reaches a log, run name, or concurrency key.
- **Social gate** — `social-broadcast.yaml` defaults `private: true`, so a caller that omits the flag skips external posts (fail-safe).
- **Merge-ceremony gate** — the `data → main` promotion blocks if a wiki page in `knowledge/wiki/repos/` would promote that can't be attributed to a known-public repo (by filename-slug attribution via `scripts/check-wiki-private-presence.ts`). **Known open seam:** this gate scans ONLY `knowledge/wiki/repos/` by filename slug. Non-repo wiki areas (`knowledge/wiki/topics/`, `entities/`, `comparisons/`) and free-text body mentions of a private repo name are NOT gated on the promotion path today — the companion content scan (`check-private-leak.ts`) is not yet wired into the promotion (tracked as in-progress follow-up hardening to cover a promotion-time trusted content scan). This is a known, plainly-stated limitation, not a solved problem. Because the `data` branch is publicly readable, this gate is defense-in-depth for `main`, not a first-disclosure control. The gate reads `metadata/repos.yaml` from the `data` branch it is validating (not a PR tree); the original "open a PR flipping `private:true→false` to bypass" path is moot because (a) the gate runs only on schedule/workflow_dispatch, never on a PR tree, and (b) `check-wiki-authority` blocks non-fro-bot and non-`data`-head edits to `repos.yaml`. Residual: a trusted-writer visibility downgrade on `data` (buggy reconcile probe, compromised token, direct push) could still mark a repo public; mitigated by fro-bot sole-writer + the public-attribution requirement. A `private→false` transition is worth an audit alert (future hardening).
- **CI guard** — `scripts/check-private-leak.ts` scans a PR's added lines for any private repo's canonical `owner/name`, resolved from `data`'s `node_id` values via the GitHub API. A match reports only the offending file path, never the leaked name. Operator override: a PR titled `[allow-private-leak] …` authored by `marcusrbrown` passes with a logged transparency comment. The CI wiring that runs this guard on every PR is deferred: resolving cross-account private names requires a broad-scope credential, which must not run in a job that checks out PR-author code (token-exfiltration risk). The guard ships as a standalone, tested script; its CI integration lands separately in a trusted (`workflow_run`) topology that treats the PR diff as data.

**Operator lookup** — to map a redacted `node_id` back to its `owner/repo` (the convenience a plain `grep` of `repos.yaml` used to provide), run `GH_TOKEN=<operator-PAT> node scripts/resolve-private.ts`. It reads `repos.yaml`, resolves each private entry's `node_id` via the GitHub API, and prints a `node_id → owner/name` table to stdout. It never writes to the working tree and is invoked by no workflow.

### `renovate.yaml`

Auto-discovered list of fro-bot org repositories with Renovate workflows. Used by `dispatch-renovate.yaml` to determine which repos to dispatch `workflow_dispatch` events to.

```yaml
repositories:
  with-renovate:
    - .github
    - agent
    - tokentoilet
```

Update convention: the `Update Metadata` workflow (`update-metadata.yaml`) scans the fro-bot org daily for repos containing `.github/workflows/renovate.yaml` and writes the sorted list to this file on the `data` branch via `commitMetadata`. No-op when nothing changed.

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

| File                    | Updated by                          | Credential                   |
| ----------------------- | ----------------------------------- | ---------------------------- |
| `allowlist.yaml`        | Human edit on `data` branch         | n/a (human commit on `data`) |
| `repos.yaml`            | Invitation handler, Daily reconcile | `FRO_BOT_PAT` / app token    |
| `renovate.yaml`         | Daily metadata workflow             | app token (`fro-bot[bot]`)   |
| `social-cooldowns.yaml` | Social broadcast                    | `FRO_BOT_PAT`                |

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
| `update-metadata.yaml`  | `APPLICATION_ID` + `APPLICATION_PRIVATE_KEY`                            |

## Editing metadata files

All `metadata/*.yaml` files are enforced as Fro-Bot-writable-only on `main`. A CI job (`Check Wiki Authority`, backed by `scripts/check-wiki-authority.ts`) fails any PR that modifies them unless authored by `fro-bot` or `fro-bot[bot]`. This prevents `main` from drifting relative to `data`, which is the single authoritative source for metadata state.

`repos.yaml` carries an additional sole-writer invariant: changes to it on `main` must originate only from the `data` promotion branch. A direct edit to `repos.yaml` on a non-promotion branch is prohibited even if fro-bot-authored. Any exception requires an explicit override and is treated as an emergency measure, not routine workflow — the invariant exists precisely to prevent the both-sides mutation that causes promotion conflicts.

A companion guard, `scripts/check-private-leak.ts`, detects a private repo's canonical `owner/name` introduced in a PR's added lines (see [Privacy gates and operator tooling](#privacy-gates-and-operator-tooling)). It ships as a tested script; its always-on CI wiring is deferred to a trusted (`workflow_run`) topology so the broad-scope resolution credential never runs against PR-author code.

For intentional manual edits to any metadata file (including `allowlist.yaml`), land the change on `data` directly and let the existing promotion flow land it on `main`:

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
