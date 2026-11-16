---
date: 2026-11-15
topic: repo-lifecycle-archive-and-declared-rename
---

# Repository lifecycle: archive and declared rename

## Summary

One operator workflow handles a tracked repository's lifecycle. `archive` records the repository as archived under its real name, marks its wiki page archived in place and stops all active work on it. `unarchive` reverses that. `declare-rename` records a new name ahead of time; when GitHub shows exactly that name on the same repository, the rename is applied without a second operator step and the old page address redirects.

---

## Problem Frame

Nothing here knows that a repository is about to be archived or renamed. Both are noticed after the fact, and both are handled defensively.

When a tracked repository is archived on GitHub, reconcile marks its row `lost-access` and stores it redacted as private, whatever its visibility. Its wiki page stays in place with nothing saying the repository is archived. Surveys stop, but the daily passes, cross-repo dispatch and the digest still treat the row as tracked. On 2026-11-15 the redacted row of a public archived repository made the leak scans treat its name as private, and every promotion was blocked until the scans learned to check live visibility.

When a tracked repository is renamed on GitHub, reconcile detects it by node ID and stops surveying it until the operator dispatches the rename workflow. The workflow has run once. It leaves the old page address dead, because it writes no redirect. Renames applied by reconcile alone were rejected earlier, because nobody had approved them.

One tracked repository is archived today (`marcusrbrown/copiloting`, since April 2026). Its row predates the privacy fields: it has no node ID and no `private` field. Its page passes the privacy gate only because it is unchanged from `main`.

---

## Actors

- A1. Operator: declares an archive or a rename, then performs it on GitHub. May still edit an archived page.
- A2. Lifecycle workflow: trusted code, and the only writer of the row-and-page commit for an archive or a rename.
- A3. Reconcile: the daily job that compares the registry with GitHub. It leaves an archived row alone except to redact it, and it starts the workflow when a declared rename has happened.
- A4. Active jobs: surveys, cross-repo dispatch, Renovate dispatch, `update-metadata`, and the daily Observe and Remediate passes.
- A5. Passive readers: wiki search, wiki lint, the page index for agents, the rollout tracker, status-truth and the capture jobs.

---

## Key Flows

- F1. Archive a repository
  - **Trigger:** the operator dispatches the workflow with `archive` and the repository's node ID, before or after archiving on GitHub.
  - **Actors:** A1, A2
  - **Steps:** the workflow confirms from GitHub that the node is the tracked repository and is public; it sets the row to archived, keeping owner and name; it marks the page archived; it rebuilds the index and appends a log entry, all in one commit.
  - **Outcome:** the row is archived and named, the index lists the page under an Archived heading, and no active job selects the repository.
  - **Covered by:** R1, R2, R3, R4, R5, R6
- F2. Declare and complete a rename
  - **Trigger:** the operator dispatches the workflow with `declare-rename`, the node ID and the new name, then renames the repository on GitHub.
  - **Actors:** A1, A2, A3
  - **Steps:** the workflow records the declared name on the row and changes nothing else; surveys continue under the current name; on a later run reconcile sees the same node, under the same owner, carrying exactly the declared name, and starts the workflow's apply action; the workflow proves identity and applies the rename in one commit, with a redirect from the old page, and clears the declaration.
  - **Outcome:** the row and page carry the new name, the old page address redirects, and no survey ran against a name that did not exist.
  - **Failure path:** when the workflow cannot prove identity, or a credential or API is unavailable, nothing is written, the declaration stays, and the block is reported for the next run or for the operator.
  - **Covered by:** R13, R14, R15, R16, R17, R18

---

## Requirements

**Archive**
- R1. The operator can archive a tracked public repository with one workflow dispatch that takes the repository's node ID.
- R2. An archived row keeps its owner and name and has a distinct archived state. It is not `lost-access` and is not stored as private. The archived state persists whatever happens to the repository's visibility.
- R3. The repository's wiki page stays at its current path and address. It carries the archive date, which is the date of the action, in its frontmatter and a one-line notice at the top of its body.
- R4. The wiki index page lists archived pages under their own heading, apart from active repositories, and every rebuild of the index keeps that grouping.
- R5. Active jobs skip an archived repository: no survey, dispatch, metadata refresh, issue, pull request or attention item is produced for it. The digest counts archived repositories separately.
- R6. Passive readers keep an archived page: it stays searchable, linted and listed in the page index for agents. A tracker or capture job may still refer to the repository when past work does.
- R7. The archive works before or after the repository is archived on GitHub.

**What may change an archived row or page**
- R8. Reconcile leaves an archived row unchanged on every path, with one exception: when GitHub explicitly reports the repository private, the row is redacted and keeps its archived state. A failed or missing lookup, or ambiguous evidence, leaves the row unchanged. Rows that duplicate an archived row produce no active work.
- R9. A redacted archived row is never un-redacted automatically. The operator restores its name by running `archive` again, which requires GitHub to confirm the same node public.
- R10. Every leak scan checks every archived repository's visibility live, and when it is not public treats both its stored name and its current name on GitHub as private. A changed page is attributed to an archived repository only while GitHub confirms it public. When the result is anything except public, including a failed lookup, the repository's name is treated as private, using the stored name when the row still has one.
- R11. A survey of an archived repository is refused, including one dispatched by hand, and a survey already running when the archive lands does not write the page.
- R12. The operator's dashboard edits and wiki repair may change an archived page, and must keep the archive date and notice. An archived repository cannot be renamed through this workflow. Once an archived row is redacted, an edit to its page fails the privacy gate until the operator restores the name.
- R25. The operator can reverse an archive with `unarchive`. It requires GitHub to confirm the same node public and not archived. The row becomes `pending` and keeps its survey history, the archive date and notice are removed, and reconcile surveys it again under its normal throttling.

**Declared rename**
- R13. The operator can declare a new name for a tracked public repository with one workflow dispatch that takes the node ID and the new name. The row's name, the page and surveys do not change at that point.
- R14. A declaration is refused when the new name, or the wiki slug it maps to, belongs to another tracked repository, an existing page or an existing redirect.
- R15. When reconcile sees the same node, under the same owner, carrying exactly the declared name, it starts the lifecycle workflow's apply action for that node and writes nothing for that row itself.
- R16. The apply action renames the row, moves the page, updates inbound links and the index, writes a log entry and clears the declaration in one commit. It writes nothing when it cannot prove the node's identity; the declaration then stays and the block is reported.
- R17. After a rename is applied, by a declaration or by the operator's own dispatch, the old page address redirects to the new page, and later page writes keep the redirect. A redirect never attributes a page or identifies a repository. When the old and new names map to the same page address, no redirect is written.
- R26. Pages renamed earlier get the same redirect: an existing alias that is an old page slug is rewritten once so that the old page address redirects. Other aliases are left as they are.
- R18. When the node carries a new name that differs from the declared one, or has a new owner, nothing is applied. The case is reported as a rename or transfer is today, the report says the declared name differs, and the declaration stays until the operator replaces or cancels it.
- R19. The operator can replace or cancel a declaration. A pending declaration is listed in reconcile's summary on every run until it is applied or cancelled.
- R20. A rename with no declaration is handled as today: detected, surveys paused, and applied by the operator's dispatch.

**Both**
- R21. Each action is refused, with a reason that names no private repository, when the node is not a tracked row, when the row is private, or when GitHub does not confirm the node's identity.
- R27. `archive` is refused while the row has a pending declaration. `declare-rename` is refused on an archived row. `archive` is refused for a redacted archived row whose repository now has a different name or owner.
- R22. For a row with no stored node ID, `archive` accepts the supplied node only when GitHub confirms that the node carries the row's exact owner and name and is public, and exactly one row and one page match. It then stores the node ID in the same commit. A declaration requires a row that already has its IDs.
- R23. No row is given the archived state or a declaration until every reader of the registry on `main` accepts them, and until the dashboard runs a package release that keeps the Archived grouping and the notice on save.
- R24. `marcusrbrown/copiloting` is converted to the archived state by the `archive` action as the first live use.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given an onboarded public repository that is not archived on GitHub, when the operator runs `archive`, the row is archived and named, the page has the archive date and notice, and the index lists it under Archived.
- AE2. **Covers R5, R6.** Given an archived repository, when reconcile, the daily passes and the dispatch jobs next run, none produces a survey, dispatch, issue or attention item for it; the digest reports it in the archived count; a wiki search still returns its page.
- AE3. **Covers R7, R8.** Given an archived row, when the operator archives the repository on GitHub and reconcile runs, the row is unchanged: still archived, still named.
- AE4. **Covers R8.** Given an archived row whose repository is un-archived on GitHub and still public, when reconcile runs, the row is unchanged and no survey is dispatched.
- AE5. **Covers R8, R10.** Given an archived row, when its repository is made private and reconcile runs, the row is redacted and still archived. Before that run, a promotion that adds a line naming it already fails the leak scan.
- AE6. **Covers R8, R10.** Given an archived row whose repository is no longer in the access list and whose lookup fails, when reconcile runs, the row is unchanged. A promotion that adds a line naming it fails the leak scan.
- AE7. **Covers R9.** Given a redacted archived row whose repository is public again, when reconcile runs, the row stays redacted. When the operator runs `archive`, its name is restored.
- AE8. **Covers R11.** Given an archived repository, when the operator dispatches a survey of it with rewrite, the survey is refused and the page is unchanged.
- AE9. **Covers R12.** Given an archived page, when the operator saves an edit from the dashboard, the edit is kept and the archive date and notice are still present.
- AE10. **Covers R22, R24.** Given a `lost-access` row with no node ID and no `private` field, whose repository GitHub shows as public and archived under the same owner and name, when the operator runs `archive` with that node ID, the row becomes archived and named, the node ID is stored, and the next promotion passes the privacy gates.
- AE11. **Covers R13, R15, R16, R17.** Given a declaration of `new-name`, when the operator renames the repository to `new-name` on GitHub and reconcile runs, the workflow is started, the row and page are renamed in one commit, and the old page address redirects on the published site.
- AE12. **Covers R13.** Given a declaration and no rename on GitHub yet, when a survey runs, it surveys the repository under its current name and succeeds.
- AE13. **Covers R16.** Given a declared rename that has happened on GitHub, when the apply action cannot prove the node's identity, nothing is written, the declaration is still present, the workflow run reports the block, and the next reconcile summary lists the declaration as still pending.
- AE14. **Covers R18.** Given a declaration of `new-name`, when the repository is renamed to `other-name`, nothing is applied, the report says the declared name differs, and the declaration is still present.
- AE15. **Covers R14.** Given a tracked repository named `my.repo`, when the operator declares `my-repo` for another repository and both names map to the same wiki slug, the declaration is refused.
- AE16. **Covers R19.** Given a pending declaration, when the operator cancels it, the row has no declaration and reconcile's next summary does not list it.
- AE17. **Covers R21.** Given a node ID of a private row, when either action is run, it is refused and the message names no repository.
- AE18. **Covers R5, R11.** Given a survey that has started, when the archive commits before the survey persists, no page write, survey-result write or re-dispatch lands.
- AE19. **Covers R25.** Given an archived repository that GitHub shows public and not archived, when the operator runs `unarchive`, the row is `pending` with its survey history kept, the page has no archive date or notice, and the next reconcile may survey it.
- AE20. **Covers R27.** Given a row with a pending declaration, when the operator runs `archive`, it is refused until the declaration is cancelled.
- AE21. **Covers R17.** Given a rename whose old and new names map to the same page address, when it is applied, the page keeps its address and gains no redirect.
- AE22. **Covers R26.** Given a page that carries an old page slug as a bare alias, after the one-time rewrite its old page address redirects on the published site.

---

## Success Criteria

- `copiloting` is archived through the action, and the following promotion passes both privacy gates, provided its unrelated gates pass.
- Over seven days after an archive, no survey, dispatch, issue, pull request or attention item is produced for the archived repository.
- A declared rename is applied by the first reconcile run that sees the new name and is not blocked, with no operator dispatch, and the old page address redirects once the site has published.
- A planner can list every job that must skip an archived row, and every code path that writes or preserves an archived row, without inventing behaviour.

---

## Scope Boundaries

- Owner transfers. They stay detected and blocked.
- Renaming an archived repository.
- A dashboard control, or asking Fro Bot to run the action. Both can sit in front of the workflow later.
- Rewriting old names in page prose, in other pages' prose and in old log entries.
- Archiving or renaming a private row.
- Reconcile archiving a repository by itself when it sees it archived on GitHub. That repository keeps today's `lost-access` handling until the operator runs `archive`.
- A physical `archived` directory in the wiki, and a separate archived grouping on the published site beyond the index page.
- Removing content that was already published before a repository turned private.

---

## Key Decisions

- The archived page stays where it is: no new directory means the privacy gate, the index builder and the page-move code have no new place to cover, and no address changes.
- An archive is a declared state, separate from `lost-access`: the operator's action records what happened, so the row does not need the fail-safe that redacts a repository reconcile cannot vouch for.
- Reconcile has one rule for an archived row, redact when GitHub shows it private, and the leak scans carry the precision: they treat an archived repository as private whenever they cannot confirm it public. A failed lookup does not redact, because a redaction is never undone automatically. #4251 showed that a named, inactive row is unsafe when several reconcile paths each have to maintain it; see `docs/solutions/best-practices/fix-a-fail-safe-flags-false-positive-in-the-consumer-2026-11-15.md`.
- A declared rename applies itself; an undeclared one waits: the declaration is the approval that the earlier rejection of automatic renames asked for. Recorded as complete in `docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md`.
- The declaration changes nothing until GitHub agrees: the registry is never ahead of GitHub, and an abandoned declaration costs nothing.
- The lifecycle workflow is the only writer of the row-and-page commit. Reconcile detects and starts it, so one run never has two writers of the registry for the same row.
- Archived pages are frozen to automation and open to the operator: surveys are refused, edits and repair keep the marker.
- `unarchive` exists because nothing else can undo an archive: `data` takes writes only from trusted workflows.
- Skipping covers active work only. Passive readers keep the page, because it stays useful as reference.
- Redirects from an old page address are allowed. Aliases are used for redirects only. This narrows the earlier rejection of rename aliases, recorded in `docs/solutions/integration-issues/identity-probe-follows-redirects-hides-repo-renames-2026-10-10.md`.

---

## Dependencies / Assumptions

- A new row state and a new row field change the registry schema in the published `@fro.bot/wiki-write-core` package. Code built against the current schema rejects a state it does not know, so the schema reaches `main` before any row carries the state.
- `fro-bot/dashboard` does not validate a row's state, does not write the registry, and keeps unknown frontmatter keys on save. It does rebuild the index and replace the page body on save, with its own pinned copy of the shared package.
- The published site writes a redirect at exactly the alias text. A bare alias redirects from the site root, so a redirect from an old page address needs the page's full site path.
- The survey ingest writes an alias when it migrates a page by node ID, and `knowledge/schema.md` says the operator rename adds none. The schema text must match the behaviour after this work.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Technical] Where reconcile takes an archived row out of its existing classification, so that no existing path can turn it into `lost-access`, refresh it or un-redact it.
- [Affects R5, R11][Technical] The change each active job needs. The onboarding gate, cross-repo dispatch and Renovate dispatch do not read the row's state today, and the daily prompts list every accessible row.
- [Affects R12][Technical] How the archive date and notice survive each permitted writer: the dashboard save, wiki repair and the ingest's frontmatter handling.
- [Affects R15, R16][Technical] How reconcile starts the workflow, with which credential, and how the apply action's proofs behave when the old address no longer redirects.
- [Affects R14, R17][Technical] The rule for an old page address that another repository later takes. The site build does not warn when an alias equals a live page.
- [Affects R20][Technical] Whether the two manual follow-ups recorded for the rename workflow, the allowlist and `reset-survey-status` taking the new name, still exist and should fold into the action.

---

## Sources / Research

- `packages/registry/src/reconcile-plan.ts`: archived handling, rename detection, the states that are surveyed.
- `packages/registry/src/rename-tracked-repo.ts` and `packages/wiki-write-core/src/repo-page-move.ts`: the atomic rename commit, its proofs and its refusals.
- `packages/privacy/src/check-wiki-private-presence.ts` and `packages/privacy/src/check-private-leak.ts`: what the privacy gates read. The leak scans select rows stored as private today, so a named archived row needs R10.
- `packages/wiki-write-core/src/wiki-ingest.ts`: the index rebuild groups pages by type, and the ingest keeps only the frontmatter keys an incoming page carries.
- `packages/wiki-write-core/src/wiki-slug.ts`: different names can map to one slug.
- `docs/brainstorms/2026-04-17-repo-reconciliation-requirements.md`: the original rule that archived, revoked and deleted are all `lost-access`. This document changes that for a declared archive.
- #4251 (closed) and #4256: why a more precise stored state for archived repositories was abandoned once already.
