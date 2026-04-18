---
date: 2026-04-17
topic: repo-reconciliation
---

# Repo Reconciliation

## Problem Frame

`metadata/repos.yaml` is Fro Bot's local projection of which repos it is a collaborator on and what it knows about them. GitHub is the source of truth for collab access. The projection can drift from reality in several ways:

- **Partial-failure orphan** — Poll Invitations accepts an invitation but fails before writing the metadata entry and dispatching Survey Repo. Fro Bot ends up with collab access but no local record and no wiki page.
- **Out-of-band acceptance** — An operator adds fro-bot as a collaborator through GitHub's UI without going through the invitation flow. Poll Invitations never sees it.
- **Unsolicited collab grant** — GitHub allows a repo admin to add any user as a collaborator without that user's consent. fro-bot's access list can grow without any invitation ever being issued.
- **Lost access** — A repo owner revokes fro-bot's access, archives the repo, or deletes it. The metadata entry becomes stale.
- **Field drift** — `has_fro_bot_workflow` and `has_renovate` were captured at survey time and never refreshed. Repos that added/removed these after the initial survey are out of sync.

Each of these failure modes leaves Fro Bot operating on a wrong mental model. Left unchecked, the projection drifts indefinitely — and unsolicited grants in particular expand Fro Bot's attack surface without any trust gate.

## Prerequisites

Must land before reconcile can function:

- Extend `OnboardingStatus` in `scripts/schemas.ts` to add `lost-access` and `pending-review` values; update the `isOnboardingStatus` runtime guard. Existing `repos.yaml` entries stay valid.

## Requirements

- **R1. Discover new access with allowlist gate.** Detect repos where fro-bot has collaborator access but no matching entry exists in `metadata/repos.yaml`. Two paths based on repo owner:
  - Owner is in `approved_inviters` (per `metadata/allowlist.yaml`): add entry with `onboarding_status: pending` and dispatch Survey Repo.
  - Owner is NOT in `approved_inviters`: add entry with `onboarding_status: pending-review`, do NOT dispatch Survey Repo, and open a GitHub issue summarizing the unsolicited grant for operator review.
- **R2. Flag lost access across all three failure modes.** Detect entries where fro-bot no longer has collaborator access. Set-difference against `/user/repos?affiliation=collaborator` identifies candidates; for each candidate, `GET /repos/{owner}/{repo}` disambiguates:
  - 404 → repo deleted
  - 200 with `archived: true` → archived
  - 200 with fro-bot absent from collaborators → revoked

  All three map to `onboarding_status: lost-access` with all other fields preserved (wiki page, survey history, timestamps).
- **R3. Refresh drift-prone fields via existence checks.** On every run, re-query `has_fro_bot_workflow` and `has_renovate` for every still-accessible tracked repo using file or directory existence checks only (no content reads). Update the entry if different. Lost-access entries retain their last-known field values.
- **R4. Sequential dispatches with non-blocking failure.** When R1 or R9 discovers multiple repos needing survey, dispatch Survey Repo one at a time (not in parallel). Dispatch failures are logged but do not block subsequent dispatches and are not retried within the same run. The next daily run re-attempts dispatch for any entry still in `pending`.
- **R5. Commit-before-dispatch, one atomic commit per run.** Reconcile writes all metadata changes from a single run in one commit to the `data` branch before any Survey Repo dispatches. Dispatch failures do not roll back the commit — entries remain `pending` and the next run retries. Commit messages summarize changes as aggregate counts only (e.g., `chore(reconcile): +2 new, 1 pending-review, 1 lost-access, 3 refreshes`) — no repo names in commit metadata.
- **R6. Silent when unchanged.** When a run detects zero changes, skip the commit and exit with a run-log summary only. No empty commits, no no-op PRs, no GitHub issues.
- **R7. Scheduled and manual triggers.** Runs daily via scheduled cron (low-traffic UTC hour) and on manual `workflow_dispatch`. No inline integration with Poll Invitations.
- **R8. Dual credentials: user PAT for enumeration, app token for dispatch and commit.** Reconcile uses two Octokit clients:
  - `FRO_BOT_POLL_PAT` (classic user PAT) for `GET /user/repos?affiliation=collaborator` and `GET /repos/{owner}/{repo}` (user-scoped endpoints the app token cannot access).
  - `fro-bot[bot]` app token (minted via `APPLICATION_ID` + `APPLICATION_PRIVATE_KEY`) for Survey Repo dispatch, data-branch commits, and GitHub issue creation for `pending-review` events.
- **R9. Regained access rehydrates the entry.** If a `lost-access` entry is found to have collaborator access again, apply the same owner-allowlist gate as R1: owner in `approved_inviters` flips it to `pending` and dispatches Survey Repo; owner not allowlisted flips it to `pending-review` with an issue. Existing history (wiki page, last_survey_at, timestamps) is preserved either way.

## Success Criteria

- Any repo fro-bot gains collaborator access to appears in `metadata/repos.yaml` within 24 hours of access being granted, with the appropriate onboarding status based on the allowlist gate.
- Allowlisted owners: Survey Repo is dispatched within 24 hours. Non-allowlisted owners: operator is notified via a GitHub issue within 24 hours; Survey Repo is NOT auto-dispatched.
- Revoked, archived, or deleted access is reflected as `onboarding_status: lost-access` within 24 hours, with the entry otherwise preserved.
- `has_fro_bot_workflow` and `has_renovate` on accessible entries match current repo state with a maximum staleness of 24 hours.
- Running reconcile a second time immediately after a successful run produces zero metadata changes (idempotent).
- Normal operation produces no GitHub issues outside the `pending-review` flow and no noise when state is already in sync.

## Scope Boundaries

- Does NOT alter Poll Invitations behavior. That workflow remains single-purpose: handle pending invitations.
- Does NOT auto-dispatch Survey Repo for repos whose owner is outside `approved_inviters`. Operator must explicitly approve via a follow-up manual dispatch after reviewing the issue.
- Does NOT delete metadata entries for `lost-access` or `pending-review` repos. Deletion is always a deliberate operator action, performed manually.
- Does NOT create GitHub issues for reconcile events EXCEPT the `pending-review` security-relevant case (narrow exception). Git history and the `data → main` PR description are the primary audit trail.
- Does NOT rate-limit dispatches beyond "sequential, one at a time". No explicit cooldown.
- Does NOT refresh wiki content. That happens via Survey Repo, which reconcile dispatches but does not replace.
- Does NOT include repo names in commit messages or workflow logs. Private repo names must not leak via audit artifacts.
- Does NOT refresh field drift via file-content reads. Existence checks only.

## Key Decisions

- **Daily cron only, no inline poll integration.** Keeps Poll Invitations single-purpose; 24-hour reconciliation latency is acceptable at current scale.
- **Full bidirectional reconciliation.** Detects both directions of drift (new access, lost access) and refreshes drift-prone fields. The principle "GitHub is the source of truth" applies to the whole metadata projection, not just presence/absence.
- **Flag lost access, preserve the entry.** Audit trail stays in git; operator controls cleanup. Deletion requires a deliberate act.
- **Owner-allowlist gate for newly-discovered repos.** Defends against unsolicited collab grants (GitHub lets any repo admin add any user without consent). Repos from non-allowlisted owners land in `pending-review` and do not auto-dispatch Survey Repo.
- **`pending-review` is the security-review queue.** One GitHub issue per event; operator decides whether to promote to `pending` (approve + survey) or remove the entry.
- **Silent operation by default.** One commit per run when changes exist; GitHub issues only for `pending-review` events.
- **Sequential Survey Repo dispatches with non-blocking failure.** Simple, avoids parallel agent contention. A stuck or failed dispatch doesn't block subsequent ones; the next daily run retries.
- **Commit-before-dispatch ordering.** Metadata state is durable before any external side effects. Partial-dispatch failures are self-healing on the next run.
- **Dual-credential architecture.** `FRO_BOT_POLL_PAT` for user-scoped enumeration; `fro-bot[bot]` app token for writes and dispatches. Two Octokit clients in one script.
- **Aggregate-only commit messages and logs.** No repo names in any audit artifact the workflow produces.

## Dependencies / Assumptions

- `FRO_BOT_POLL_PAT` scope is sufficient to call `GET /user/repos?affiliation=collaborator` and `GET /repos/{owner}/{repo}`.
- `fro-bot[bot]` app installation has `contents: write` (data branch), `actions: write` (workflow dispatch), and `issues: write` (pending-review issues) on this repo.
- `commitMetadata` continues to handle concurrent-writer 409s via retry; reconcile uses it for data-branch writes.
- `approved_inviters` in `metadata/allowlist.yaml` is the right trust principal list. If repos owned by orgs (not individuals) are added later, the allowlist may need to be extended to accept org logins.
- `survey-repo.yaml` workflow remains dispatched via `workflow_dispatch` with `owner` + `repo` inputs; no changes to that workflow are required.

## Outstanding Questions

### Resolve Before Planning

_(none)_

### Deferred to Planning

- [Affects R3][Technical] Existence-check API strategy for `has_fro_bot_workflow` and `has_renovate`. Use `GET /repos/{owner}/{repo}/contents/.github/workflows` (one call, scan for `fro-bot*.yaml`) and `GET /repos/{owner}/{repo}/contents` at root + `.github` for renovate files. Exact predicates and fallback paths to settle during implementation.
- [Affects R2][Technical] Rename/transfer detection via GitHub's repo `node_id`. Matching by `owner+name` is simpler but fragile across renames. Node_id cross-reference adds stability but introduces retention questions (fro-bot tracks across renames). Planning decides whether to adopt, and if so, what retention policy applies.
- [Affects R4][Technical] Dispatch timeout value. Serial `await` on `createWorkflowDispatch` can hang on a stuck GitHub Actions API call; planning settles the per-dispatch timeout and `retry-after` backoff semantics.
- [Affects R3/R4][Technical] Secondary rate-limit backoff. Honor `retry-after` headers on 403s; log and continue on other secondary limits. Exact policy during implementation.
- [Affects R5] Commit message summary format. Aggregate counts only — exact wording (`+2 new, 1 pending-review, 1 lost-access, 3 refreshes`) is a small planning-time decision.
- [Affects R1/R9] `pending-review` issue format. Title, body, labels — planning settles the issue template so operator review is fast.

## Next Steps

→ `/ce:plan` for structured implementation planning.
