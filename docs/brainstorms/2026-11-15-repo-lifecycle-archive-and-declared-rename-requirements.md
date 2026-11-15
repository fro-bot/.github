---
date: 2026-11-15
topic: repo-lifecycle-archive-and-declared-rename
---

# Repository lifecycle: archive and declared rename

## Summary

One operator workflow handles a tracked repository's lifecycle. `archive` records the repository as archived under its real name, marks its wiki page archived in place and makes every recurring job skip it. `declare-rename` records a new name ahead of time; when GitHub shows exactly that name on the same repository, the rename is applied without a second operator step and the old page address redirects.

---

## Problem Frame

Nothing here knows that a repository is about to be archived or renamed. Both are noticed after the fact, and both are handled defensively.

When a tracked repository is archived on GitHub, reconcile marks its row `lost-access` and stores it redacted as private, whatever its visibility. Its wiki page stays in place with nothing saying the repository is archived. Surveys stop, but the daily passes, cross-repo dispatch and the digest still treat the row as tracked. On 2026-11-15 the redacted row of a public archived repository made the leak scans treat its name as private, and every promotion was blocked until the scans learned to check live visibility.

When a tracked repository is renamed on GitHub, reconcile detects it by node ID and stops surveying it until the operator dispatches the rename workflow. The workflow has run once. It leaves the old page address dead, because it writes no redirect. Renames applied by reconcile alone were rejected earlier, because nobody had approved them.

One tracked repository is archived today (`marcusrbrown/copiloting`, since April 2026). Its row predates the privacy fields and its page passes the privacy gate only because it is unchanged from `main`.

---

## Actors

- A1. Operator: declares an archive or a rename, then performs it on GitHub.
- A2. Lifecycle workflow: trusted code that writes the registry row and the wiki page on `data` in one commit.
- A3. Reconcile: the daily job that compares the registry with GitHub. It applies a declared rename and keeps an archived row as it is.
- A4. Recurring jobs: surveys, the daily Observe and Remediate passes, cross-repo dispatch, Renovate dispatch and the digest.

---

## Key Flows

- F1. Archive a repository
  - **Trigger:** the operator dispatches the workflow with `archive` and the repository's node ID, before or after archiving on GitHub.
  - **Actors:** A1, A2
  - **Steps:** the workflow confirms from GitHub that the node is the tracked repository and is public; it sets the row to archived, keeping owner and name; it marks the page archived; it rebuilds the index and appends a log entry, all in one commit.
  - **Outcome:** the row is archived and named, the page is listed under an Archived heading, and no recurring job selects the repository.
  - **Covered by:** R1, R2, R3, R4, R5, R6
- F2. Declare and complete a rename
  - **Trigger:** the operator dispatches the workflow with `declare-rename`, the node ID and the new name, then renames the repository on GitHub.
  - **Actors:** A1, A2, A3
  - **Steps:** the workflow records the declared name on the row and changes nothing else; surveys continue under the current name; on a later run reconcile sees the same node, under the same owner, carrying exactly the declared name; the rename is applied in the existing atomic commit, with a redirect from the old page; the declaration is cleared.
  - **Outcome:** the row and page carry the new name, the old page address redirects, and no survey ran against a name that did not exist.
  - **Covered by:** R9, R10, R11, R12, R13

---

## Requirements

**Archive**
- R1. The operator can archive a tracked public repository with one workflow dispatch that takes the repository's node ID.
- R2. An archived row keeps its owner and name and has a distinct archived state. It is not `lost-access` and is not stored as private.
- R3. The repository's wiki page stays at its current path and address. It carries the archive date in its frontmatter and a one-line notice at the top of its body.
- R4. The wiki index and the published site list archived pages under their own heading, apart from active repositories.
- R5. Every recurring job that selects tracked repositories skips an archived one: surveys, the daily Observe and Remediate passes, cross-repo dispatch and Renovate dispatch. The digest counts archived repositories separately.
- R6. The archive works before or after the repository is archived on GitHub. When reconcile later sees an archived row's repository archived on GitHub, the row and page do not change.
- R7. When an archived row's repository is seen private, or its visibility can no longer be confirmed, the row is redacted and the leak scans treat its name as private.
- R8. A repository that was archived on GitHub without a declaration keeps today's handling. Running `archive` afterwards converts its row to the archived state and restores its name, provided GitHub still shows that node public.

**Declared rename**
- R9. The operator can declare a new name for a tracked public repository with one workflow dispatch that takes the node ID and the new name. The row's name, the page and surveys do not change at that point.
- R10. A declaration is refused when the new name belongs to another tracked repository, or when a wiki page already exists at the new name's slug.
- R11. When reconcile sees the same node, under the same owner, carrying exactly the declared name, the rename is applied without another operator action: the row is renamed, the page moves, inbound links and the index are updated, and a log entry is written, in one commit.
- R12. After a rename is applied, the old page address redirects to the new page.
- R13. When the node carries a new name that differs from the declared one, or has a new owner, nothing is applied. The case is reported as a rename or transfer is today, and the report states that the declared name differs.
- R14. The operator can replace or cancel a declaration. A pending declaration is listed in reconcile's summary on every run until it is applied or cancelled.
- R15. A rename with no declaration is handled as today: detected, surveys paused, and applied by the operator's dispatch. That dispatch also leaves a redirect from the old page.

**Both**
- R16. Each action is refused, with a reason that names no private repository, when the node is not a tracked row, when the row is private, or when GitHub does not confirm the node's identity.
- R17. `marcusrbrown/copiloting` is converted to the archived state by the `archive` action as the first live use.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given an onboarded public repository that is not archived on GitHub, when the operator runs `archive`, the row is archived and named, the page has the archive date and notice, and the index lists it under Archived.
- AE2. **Covers R5.** Given an archived repository, when reconcile, the daily passes and both dispatch jobs next run, none selects it, and the digest reports it in the archived count.
- AE3. **Covers R6.** Given an archived row, when the operator archives the repository on GitHub and reconcile runs, the row is unchanged: still archived, still named.
- AE4. **Covers R7.** Given an archived row, when its repository is made private and reconcile runs, the row is redacted. A promotion that adds a line naming it fails the leak scan.
- AE5. **Covers R8, R17.** Given a `lost-access` row whose repository GitHub shows as public and archived, when the operator runs `archive`, the row becomes archived and named, and the next promotion passes.
- AE6. **Covers R9, R11, R12.** Given a declaration of `new-name`, when the operator renames the repository to `new-name` on GitHub and reconcile runs, the row and page are renamed in one commit and the old page address redirects.
- AE7. **Covers R9.** Given a declaration and no rename on GitHub yet, when a survey runs, it surveys the repository under its current name and succeeds.
- AE8. **Covers R13.** Given a declaration of `new-name`, when the repository is renamed to `other-name`, nothing is applied and the report says the declared name differs.
- AE9. **Covers R10.** Given another tracked repository already named `new-name`, when the operator declares `new-name`, the declaration is refused.
- AE10. **Covers R16.** Given a node ID of a private row, when either action is run, it is refused and the message names no repository.

---

## Success Criteria

- `copiloting` is archived through the action, and the following promotion passes both leak scans with no row skipped as "resolves to public".
- Over seven days after an archive, no survey, daily pass or dispatch touches the archived repository.
- A declared rename completes on the first reconcile run after the GitHub rename, with no operator dispatch, and the old page address redirects on the published site.
- A planner can list every job that must skip an archived row, and every code path that writes or preserves an archived row, without inventing behaviour.

---

## Scope Boundaries

- Un-archiving. A mistaken archive is corrected by hand for now.
- Owner transfers. They stay detected and blocked.
- A dashboard control, or asking Fro Bot to run the action. Both can sit in front of the workflow later.
- Rewriting old names in page prose, in other pages' prose and in old log entries.
- Archiving or renaming a private row.
- Reconcile archiving a repository by itself when it sees it archived on GitHub.
- A physical `archived` directory in the wiki.

---

## Key Decisions

- The archived page stays where it is: no new directory means the privacy gate, the index builder and the page-move code have no new place to cover, and no address changes.
- An archive is a declared state, separate from `lost-access`: the operator's action records what happened, so the row does not need the fail-safe that redacts a repository reconcile cannot vouch for.
- An archived row still loses its name when the repository stops being confirmed public: the public registry must not keep the name of a repository that has turned private.
- A declared rename applies itself; an undeclared one waits: the declaration is the approval that the earlier rejection of automatic renames asked for. Recorded as complete in `docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md`.
- The declaration changes nothing until GitHub agrees: the registry is never ahead of GitHub, and an abandoned declaration costs nothing.
- One workflow, three actions: the existing rename dispatch grows `archive` and `declare-rename` and keeps today's apply action.
- Redirects from an old page address are allowed. Aliases are used for redirects only, never to attribute a page or identify a repository. This narrows the earlier rejection of rename aliases, recorded in `docs/solutions/integration-issues/identity-probe-follows-redirects-hides-repo-renames-2026-10-10.md`.

---

## Dependencies / Assumptions

- A new row state and a new row field change the registry schema in the published `@fro.bot/wiki-write-core` package, so the change needs a package release. How `fro-bot/dashboard` treats a state it does not know is not verified.
- `copiloting`'s row has no node ID and no `private` field. The action must be able to convert it.
- The published site already turns `aliases` into redirects. This is configured but was not run for this document.
- The survey ingest already writes an alias when it migrates a page by node ID, while `knowledge/schema.md` says no alias is added. The two must agree after this work.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Which code paths write or preserve an archived row, and which of them redacts it. `docs/solutions/best-practices/fix-a-fail-safe-flags-false-positive-in-the-consumer-2026-11-15.md` applies: prefer a live check in the leak scans over more stored states.
- [Affects R5][Technical] The full list of jobs and prompts that select tracked repositories, and how each skips an archived row.
- [Affects R11][Technical] Whether reconcile applies the declared rename itself or starts the lifecycle workflow.
- [Affects R12, R15][Needs research] Whether the published site emits a working redirect for an alias in this configuration, and what happens to the alias when another repository later takes the old name.
- [Affects R2, R9][Needs research] Whether the dashboard accepts the new state and field, and whether the gate contract version must change.
- [Affects R15][Technical] Whether the two manual follow-ups recorded for the rename workflow (the allowlist, and `reset-survey-status` taking the new name) still exist and should fold into the action.

---

## Sources / Research

- `packages/registry/src/reconcile-plan.ts`: archived handling, rename detection, the states that are surveyed.
- `packages/registry/src/rename-tracked-repo.ts` and `packages/wiki-write-core/src/repo-page-move.ts`: the atomic rename commit and its refusals.
- `packages/privacy/src/check-wiki-private-presence.ts` and `packages/privacy/src/check-private-leak.ts`: what the privacy gates read.
- `packages/wiki-ops/src/wiki-index.ts`: the index is built from four fixed directories.
- `docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md`: the original rule that archived, revoked and deleted are all `lost-access`. This document changes that for a declared archive.
- #4251 (closed) and #4256: why a more precise stored state for archived repositories was abandoned once already.
