---
title: 'fix: Unblock wiki promotion after a repository rename'
type: fix
status: active
date: 2026-09-26
---

# Unblock wiki promotion after a repository rename

## Problem

`data → main` promotion is blocked because an old-name wiki page no longer matches its repository metadata. A rename/dedup removed the old metadata name, while the page continued changing. The existing canonical page and metadata entry identify a currently public repository; that does **not** validate the old page's claims. The privacy gate is correctly refusing to promote the unmatched page.

Fix this occurrence first. Then prevent metadata writers from dropping an old name while its page still exists. Do not merge unaudited text, relax the privacy gate, or bypass the App-only `data` ruleset.

## 1. One-time, LLM-assisted repair

Use an operator-approved Fro Bot run to let the LLM make the repair on a fresh `data` snapshot. The model may use a GitHub App token for this **one-time** run; never print, store in an artifact, or commit the token. Reuse existing agent execution and the App-backed Git Data writer where possible. If temporary wiring is needed to put them in one job, remove it after the repair. Do not build a permanent workflow or general wiki-deletion API.

- Identify the unique page rejected by `detectPrivateWikiLeaks` **inside the run**; public gate output stays redacted. Confirm its old-to-current repository identity from reviewed metadata history, current canonical metadata, and a fresh public-visibility check. Abort on zero/multiple candidates or conflicting/private/unknown identity. No operator-supplied deletion path.
- Delete that old page. Keep the existing canonical page and copy **none** of the old page's unaudited prose, sources, or claims.
- Repair references across `knowledge/wiki/**` and `knowledge/index.md`: point links from other pages and the index to the canonical page; update structured `related` references; on the canonical page, remove only the old-link markup so its visible text and claims stay unchanged instead of creating self-links. The current snapshot has 73 canonical links, 58 other-page links, 10 index links, and 13 `related` references; enumerate again on the live tip rather than relying on those counts.
- Commit the page deletion and reference edits together through the existing non-force App Git Data writer (`commitWikiChanges`). If the tip changes, re-read and recompute or stop; do not replay a stale deletion. Keep names, page contents, and credentials out of public workflow logs and commit messages.
- Read back the actual `data` tree. Confirm the old page and all old link/`related` references are gone, the canonical page has no new claims or self-links, only intended paths changed, and the existing wiki-link and promotion privacy checks pass. If any check fails, stop; do not force promotion or silently call the repair complete.

The ordinary survey handoff ignores deletions, so merely asking its agent to delete a file will **not** persist this repair. The one-time run must use the existing deletion-capable Git Data primitive, not a PAT push or a PR that edits `main` directly.

## 2. Prevent the known recurrence

After the live repair, make a separate, focused code change in `scripts/reconcile-repos.ts`. For writes to `metadata/repos.yaml`, compare the old and proposed stable-identity/name associations. If a rename or duplicate merge would remove an old public name while its wiki page still exists on the current `data` tree, keep that attribution and report the skip with a redacted, counts-only warning. The guard is reconcile-only, the sole writer that renames or merges rows; invitation acceptance, survey results, and survey resets are unguarded and rely on the promotion privacy gate.

Preserve restrictive private/unknown visibility updates rather than restoring stale public status. Recheck on metadata retries; only verified absence of the old page permits the rename, while unreadable or ambiguous state blocks it. No persistent alias registry or cross-writer transaction coordinator. The existing privacy gate remains the backstop for the small residual race between metadata and wiki writes. Add a stale-ingest guard only if that race recurs; it is **not** a prerequisite for this repair.

Test the guard through reconcile, asserting persisted rows: single-row rename, duplicate-row merge, same-slug rename, slug collision, ID-less downgrade, and retry. Run the repository's `pnpm bootstrap`, `pnpm check-types`, `pnpm lint`, and `pnpm test` gates for code changes; run mutation guards if the changed module or test is listed in `stryker.config.json`.

## Boundaries and next action

This document authorizes **no** PR, workflow change, dispatch, or `data` deletion. Request approval before each remote action. Ship the one-time repair and the recurrence guard as separate changes; do not delay the repair for the guard. After the verified App commit, let the normal promotion workflow run and inspect its actual privacy-gate result. If temporary workflow wiring was needed, remove it promptly as a separate approved change.

Relevant existing seams: `scripts/check-wiki-private-presence.ts`, `scripts/wiki-repair.ts`, `scripts/commit-metadata.ts`, `packages/wiki-write-core/src/wiki-ingest.ts`, `.github/workflows/wiki-lint.yaml`, and `metadata/README.md`.
