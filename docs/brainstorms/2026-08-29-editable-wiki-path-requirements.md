---
title: Editable Wiki Path — Operator Edits Through the Data-Branch Authority Model
date: 2026-08-29
topic: editable-wiki-path
scope: deep
---

# Editable Wiki Path — Operator Edits Through the Data-Branch Authority Model

## Summary

Add operator editing to the Quartz wiki site: edit any repo or topic page in place, save through a broker that validates against the same gates as autonomous writes and commits to `data` under Fro Bot's identity. Edits the operator marks as corrections become durable constraints the surveyor must preserve; unmarked edits are feedback the surveyor absorbs on its next pass. This is the R3 editable half from the north-star map.

---

## Problem Frame

The wiki is live and readable at `fro.bot/.github`, but correcting it is indirect: the operator's paths today are filing an issue, mentioning `@fro-bot`, or waiting for wiki-lint or a future survey to catch the problem. Those loops work for detectable defects, but they fail the moment the operator is the only one who knows something — a wrong fact no gate can see, missing context about a repo's direction, knowledge that exists nowhere the pipeline reads. For those, the correction round-trips through an issue and an agent run when the operator is already looking at the wrong text with the right text in mind. There is also no path at all for operator knowledge to enter the wiki directly; the sole-writer invariant, correctly, forbids hand-editing `data`.

---

## Actors

- A1. Operator: the single authenticated human (S2 identity) reading and editing the wiki.
- A2. Surveyor: the LLM pipeline that generates and regenerates wiki pages on cadence.
- A3. Broker: the service path that receives a save, authenticates it, runs validation, and commits to `data` as Fro Bot.
- A4. Gates: the existing validation surface — wiki-lint, privacy/leak scans, link validation — applied identically to autonomous and operator writes.

---

## Key Flows

- F1. Successful edit
  - **Trigger:** Operator edits page text on the Quartz site and saves, optionally marking some changes as corrections.
  - **Actors:** A1, A3, A4
  - **Steps:** Editor sends the change to the broker with the page version it was based on; broker authenticates the operator session, verifies the page is unchanged since that version, runs all gates; all pass; broker records attribution (server-derived) and correction marks, commits to `data` under Fro Bot's identity; the editor shows a pending state until the published site reflects the change.
  - **Outcome:** The edit is live and attributed; marked corrections are registered as durable constraints.
  - **Covered by:** R2, R4, R6, R7, R14, R16, R17

- F2. Rejected edit
  - **Trigger:** Operator saves a change that trips a gate (e.g., names a private repo).
  - **Actors:** A1, A3, A4
  - **Steps:** Broker runs gates before any commit; a gate fails; the save is refused; the editor surfaces which gate failed and why, preserving the draft in place; the operator revises and retries.
  - **Outcome:** No partial or silent state exists; no draft work is lost.
  - **Covered by:** R4, R5, R18

- F3. Survey over a page with marked corrections
  - **Trigger:** The surveyor regenerates a page carrying operator corrections.
  - **Actors:** A2, A4
  - **Steps:** The surveyor receives the marked corrections as must-respect context, treated as data to preserve rather than instructions to follow; it regenerates around them; the survival check verifies each marked correction is preserved; erosion surfaces as a deterministic finding.
  - **Outcome:** Marked corrections survive regeneration or their loss is loud; unmarked edits are absorbed at the surveyor's discretion.
  - **Covered by:** R8, R9, R10, R11

- F4. Stale save
  - **Trigger:** Operator saves against a page that changed (survey commit or another edit) since they began editing.
  - **Actors:** A1, A3
  - **Steps:** The broker's page-version precondition fails; the save is refused with a conflict indication; the editor preserves the draft and offers the current page for comparison.
  - **Outcome:** No silent last-writer-wins; the operator merges deliberately.
  - **Covered by:** R16, R18

---

## Requirements

**Editing surface**

- R1. Every editable wiki page carries an Edit affordance that deep-links (with page identity and a return URL) into an editor served from the dashboard origin; system-generated pages (`index.md`, `log.md`) get none. After save, the operator returns to the page they came from.
- R2. Editing is free-form over the page body as raw markdown — the operator may change any text, not only designated regions.
- R3. Page frontmatter remains system-owned and is not operator-editable; identity, sources, and dates stay under pipeline control.
- R4. Saving routes through a broker that runs every gate applied to autonomous writes (wiki-lint, privacy/leak scan, link validation) before any commit; a failing edit lands nowhere. The synchronous path must fit an interactive latency budget; gates that cannot are split into fast blocking checks plus deferred verification rather than blocking the save indefinitely.
- R5. When a gate rejects an edit, the editor surfaces the failure synchronously with the gate's finding; there is no optimistic accept.

**Save path and authority**

- R6. Accepted edits commit to the `data` branch under Fro Bot's identity; the operator never acquires write access to `data`, preserving the sole-writer invariant and tamper check unchanged.
- R7. The broker accepts a save only from an authenticated S2 operator session, revalidated server-side on every save; requests are origin-bound with CSRF protection, carry a page-version precondition, and are subject to size and rate limits. The broker fails closed on expired, revoked, or partially authenticated sessions.

**Durability (marked corrections)**

- R8. The operator may mark parts of an edit as corrections; only marked corrections become durable constraints. Unmarked edits stand until the next survey, which reads them as feedback and owns the final text.
- R9. Marked corrections are recorded with server-derived attribution in system-owned metadata; attribution is never client-supplied.
- R10. When the surveyor regenerates a page, marked corrections are supplied as must-respect context and treated as data to preserve, not instructions to execute; a survival check verifies each marked correction is preserved and surfaces failure as a deterministic finding, never silently.
- R11. Corrections have a lifecycle: the operator can unmark or supersede a correction, and a correction whose subject has demonstrably changed upstream is flagged for operator re-confirmation rather than preserved unconditionally.

**Rendering safety**

- R12. Operator-edited content passes a rendering policy before publish: unsafe HTML is sanitized or stripped, and the published site must not execute scriptable content introduced through an edit.

**Identity and access**

- R13. The editor and save API live on the dashboard origin and authenticate against the existing S2 operator identity; no new credential class and no cross-origin session handoff is introduced. The wiki site itself never handles credentials.
- R14. Unauthenticated visitors see the wiki exactly as today; the edit affordance is invisible or inert without operator auth.

**Interaction states**

- R15. Edit mode has explicit entry and exit: a visible affordance enters it, cancel or navigation exits it, and exiting with unsaved changes warns before discarding.
- R16. Between broker acceptance and site publish, the editor shows a pending state; the operator can tell an in-flight edit from a published one.
- R17. Edit outcomes are observable end to end: accepted edits become visible after normal pipeline latency, and rejection, conflict, and erosion findings all reach the operator.
- R18. A rejected or conflicted save preserves the operator's draft in the editor for revision; no gate failure or version conflict discards work.

---

## Acceptance Examples

- AE1. **Covers R4, R5, R18.** Given an edit that adds a private repository's name, when the operator saves, the save fails synchronously with the privacy gate's finding, no commit occurs on any branch, and the draft remains editable.
- AE2. **Covers R6, R9.** Given an accepted edit with a marked correction, the `data` commit author is a Fro Bot identity, attribution derives from the authenticated session, and the reconcile tamper check passes on its next run.
- AE3. **Covers R8, R10.** Given a page where the operator marked a factual fix as a correction and also made an unmarked wording tweak, when the next survey regenerates the page, the marked correction survives verbatim-or-flagged while the wording tweak may be absorbed or rewritten.
- AE4. **Covers R16.** Given the operator saves against a page a survey rewrote mid-edit, the save is refused as a conflict, the draft is preserved, and nothing lands.
- AE5. **Covers R1, R14.** Given an unauthenticated visitor, no edit affordance is usable and the read experience matches today's.

---

## Success Criteria

- The operator can correct a wiki error from the browser in one sitting, without touching git, and see it live after the publish pipeline runs.
- No new writer identity exists on `data`; the sole-writer invariant and tamper check are untouched.
- A survey cannot silently erase a marked correction — erosion is either prevented or loudly surfaced.
- Within a quarter of shipping, the edit path demonstrably displaces issue-round-trip corrections (operator edits land directly instead of via correction issues); if it goes unused, that is signal to simplify, not extend.
- Planning can split the work across owning repos (control plane, agent/gateway, site) without inventing product behavior.

---

## Scope Boundaries

### Deferred for later

- Dashboard edit view — the venue is the wiki site; a dashboard editor can come later if reading habits change.
- Push/notification delivery of rejection or erosion findings (north-star capability R2, push notifications); findings surface through existing report/issue channels first.
- Edit history UI beyond what git provides.
- WYSIWYG or rich-text editing; v1 edits raw markdown.

### Outside this product's identity

- Public or multi-operator editing; this is a single-operator surface bound to S2 identity.
- General CMS ambitions — editing `docs/`, `metadata/`, or anything outside the wiki through the web.
- Operator editing of system-generated pages or frontmatter.

---

## Key Decisions

- Wiki-anchored entry, dashboard-origin editor: every wiki page links into an editor served where the operator security contract already lives; "edit where you read" survives as the entry and return path. Keeping the input surface on the wiki origin would have required relaxing origin/CSRF guarantees for no product gain.
- Durability narrowed to marked corrections: full-page durability would freeze the garden into operator-authored islands and make "preserved" untestable for free-form prose; marking bounds the constraint set, keeps preservation checkable, and leaves the surveyor owning ordinary text. Unmarked edits are absorb-as-feedback.
- Free-form raw-markdown editing over structured blocks or WYSIWYG: matches the source format the pipeline writes; durability enforcement rides the marked-correction subset rather than a parser guarantee over everything.
- Synchronous reject over optimistic accept: silent non-landing is this system's recurring failure mode; the save path refuses loudly instead.
- Operator text is data, not instruction: marked corrections enter the surveyor's context under a prompt-assembly contract that isolates them from system instructions.

---

## Dependencies / Assumptions

- S2 operator auth is live (OAuth/PKCE/session at `dashboard.fro.bot`); the wiki site is a different origin, so the edit path needs an explicit auth handoff design (R13).
- The gates are workflow-bound CLIs today (`GITHUB_EVENT_PATH`-dependent entrypoints); the broker needs request-time adapters or extracted library entrypoints — verified, not assumed.
- The `data`-branch authority model, privacy gates, and wiki-lint remain the single validation surface; the broker reuses them rather than reimplementing.
- Canonical page identity by `node_id` (shipped in the wiki pipeline) anchors attribution and the page-version precondition.
- The wiki publish pipeline (data → site) stays as-is; edits ride the existing rebuild path.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Broker placement and gate execution model — which gate logic is imported as libraries vs adapted from workflow CLIs, what request-time inputs replace workflow event payloads, and the concrete latency budget for the blocking set.
- [Affects R9][Technical] Correction metadata schema — how marked corrections and their attribution are stored in system-owned metadata without polluting page content, and how they survive page rewrites and migrations.
- [Affects R10][Technical] Preservation contract mechanics — the machine-checkable definition of "preserved" for a marked correction (verbatim span vs bounded transform), and the enforcement split between surveyor prompt context and the survival check.
- [Affects R10][Technical] Prompt-assembly contract — where marked corrections are injected into the survey pipeline (no injection point exists today) and how they are isolated from system instructions.

- [Affects R12][Technical] The concrete rendering policy for edited markdown (sanitizer choice, allowed constructs) within the existing Quartz build.
- [Affects R16, R17][Technical] Publish-latency expectations and how the pending state learns an edit went live.
