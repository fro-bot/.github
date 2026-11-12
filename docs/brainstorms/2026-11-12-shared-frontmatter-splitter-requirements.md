---
date: 2026-11-12
topic: shared-frontmatter-splitter
---

# One Shared Frontmatter Splitter

## Summary

One frontmatter splitter, exported from `@fro.bot/wiki-write-core`, replaces the twelve copied regexes that find a YAML frontmatter block. It defines once what a block is and reports one of three outcomes: no block, a block, or a malformed block. The wiki privacy gate then passes a gated page only when the page has a valid block with `sources`.

---

## Problem Frame

Twelve places in six packages find a frontmatter block with their own copy of a regex. Five copies are in the published `@fro.bot/wiki-write-core`. The others are in `wiki-ops`, `knowledge` (two), `reports`, `privacy` and `status-truth` (two).

The copies share one defect and disagree on the rest:

- **A close that is not a whole line.** Every copy ends the block at the first line that starts with `---`. A line such as `---x: y` or `----` inside the block ends it early, and the keys after that line are dropped without an error.
- **Line endings.** Nine copies accept LF only, so a CRLF file reads as having no frontmatter. Three accept both.
- **An empty block.** `---` directly followed by `---` reads as no frontmatter everywhere.
- **An unclosed block.** Every reader that tolerates a missing block also reads an opened block with no close as "no frontmatter", without an error.

The privacy gate is where this matters most. `packages/privacy/src/check-wiki-private-presence.ts` checks a wiki page's `sources` list when it can read one. When the block is missing, unclosed, not valid YAML or not a mapping, it falls back to a weaker test: the page passes if its body contains the public repository's URL. A page can therefore be shaped so that its real `sources` are not read and a decoy URL in the body passes it.

A first fix (#4185) tightened each copy's regex in place. Review found a new way to reach the fallback in each of three rounds, because every parser error had its own special case. The PR was closed in favour of one splitter with a defined result for a malformed block (#4148).

On the `data` branch today all 33 gated repo pages have a valid block with `sources`. None uses the fallback.

---

## Requirements

**The splitter**

- R1. One splitter decides where a frontmatter block starts and ends for every production reader in the repository. No other code finds the block by itself.
- R2. A block opens only when the first line of the content is exactly `---`.
- R3. A block closes at the first later line that is `---`, optionally followed by spaces or tabs, and then a line break or the end of the content. Any other line, including `---x`, `----` and `--- text`, is content of the block.
- R4. LF and CRLF line endings are both accepted, for the opening line, the closing line and the lines between.
- R5. The splitter reports one of three outcomes: no block, a block (its text and the body after it), or a malformed block. An opened block with no closing line is malformed.
- R6. An empty block is a block with empty text. Callers that parse it get an empty mapping.
- R7. The body returned with a block is the content after the closing line, byte for byte. The splitter does not trim or re-encode it.
- R8. The splitter's running time grows linearly with the length of the content, including for content that opens a block and never closes it.
- R9. The splitter does not parse YAML. Parsing the block's text and judging its value stay with each caller.

**Where it lives**

- R10. The splitter is an export of `@fro.bot/wiki-write-core`. The five copies in that package and the seven in the private packages all use it.
- R11. `knowledge`, `reports` and `status-truth` gain a declared dependency on `@fro.bot/wiki-write-core`. The package graph stays acyclic, and the published package still depends on no private package.

**The privacy gate**

- R12. A gated wiki page passes attribution only when it has a block, the block parses as a YAML mapping, and its `sources` has a URL that matches the public repository by the existing exact rule.
- R13. A gated page with no block, a malformed block, a block that is not valid YAML, a block that is not a mapping, or a mapping with no `sources` key is blocked. The body-URL fallback and its warning are removed.
- R14. The gate's other rules do not change: the exact URL match, the present-but-invalid `sources` rule, ambiguous public slugs and grandfathered pages.

**The other callers**

- R15. Each other caller treats a malformed block the way it treats a block that is not valid YAML today. It gains no new warning, error type or output.
- R16. The plan-status corrector does not rewrite a file whose block is malformed, not valid YAML or not a mapping (#4183).
- R17. For a file with a well-formed block that none of R2 to R6 affects, every caller returns what it returns today.

**Proof**

- R18. Each replaced copy is compared with its old regex over one shared corpus of well-formed, malformed and adversarial inputs. Every difference found is one of the intended changes listed in this document.
- R19. A scaling test feeds the splitter long adversarial input, and it fails when run against one of the old regexes.

---

## Acceptance Examples

- AE1. **Covers R3.** Given a block whose third line is `---x: y` and whose fifth line is `---`, when any caller reads the file, the block ends at the fifth line and the keys on the fourth line are present.
- AE2. **Covers R3.** Given a closing line of `---` followed by two spaces, when the file is read, the block closes at that line.
- AE3. **Covers R4.** Given a CRLF file with a well-formed block, when solutions search reads it, the document's title and tags come from the block.
- AE4. **Covers R5, R15.** Given a file that opens a block and never closes it, when the wiki page reader reads it, the result carries a frontmatter error, as it does today for invalid YAML. When solutions search reads it, the document is skipped with the existing warning.
- AE5. **Covers R6.** Given a file that starts with `---` directly followed by `---`, when it is read, it has a block and an empty mapping, and the body is everything after the second line.
- AE6. **Covers R12, R13.** Given a gated page whose block lists a non-matching source, then has a `--- text` line, then a later `---`, and whose body contains the public repository's URL, when the gate runs, the page is blocked.
- AE7. **Covers R13.** Given a gated page with no block whose body contains the public repository's URL, when the gate runs, the page is blocked.
- AE8. **Covers R13.** Given a gated page with a valid block that has no `sources` key and a body that contains the public repository's URL, when the gate runs, the page is blocked.
- AE9. **Covers R14.** Given a gated page with a valid block whose `sources` has the matching URL, when the gate runs, the page passes, whatever the body contains.
- AE10. **Covers R16.** Given a plan whose block is followed by a `--- text` line, a body line `status: active` and a later `---`, when the corrector runs, the file is returned unchanged.
- AE11. **Covers R17.** Given every wiki page on `data` and every document under `docs/`, when each caller reads them before and after the change, the results are the same, except where a file is CRLF or has an empty or unclosed block.

---

## Success Criteria

- The three inputs that broke #4185 are blocked by the gate without a rule written for any of them: a decoy URL after a `--- text` line, the same after `---x`, and an empty block.
- One implementation of the block rule exists. A search for a frontmatter-delimiter regex in production code finds none.
- No page on `data` and no document under `docs/` changes outcome, apart from the intended changes for CRLF, empty and unclosed blocks.
- The planner can start from this document without deciding what a block is, what a malformed block means to any caller, or what the gate does without `sources`.

---

## Scope Boundaries

- New warnings in callers that are silent on bad frontmatter today: learnings harvest drops such a document without a message, and improvement metrics treats it as having no metadata.
- What any caller does with a well-formed block.
- The YAML parser and its options.
- The test-only parsers in `scripts/agent-skills.test.ts`, `packages/wiki-ops/src/solutions-query.test.ts` and `packages/privacy/src/repo-page-move.test.ts`.
- The promotion leak gate and the write-time presence checks that work on node IDs.
- A migration of existing pages. None is needed: every gated page already meets R12.

---

## Key Decisions

- **One splitter exported from the published package.** The published package cannot import a private one, and five of the twelve copies are inside it. A second copy in `@fro-bot/core` would leave two implementations to keep in step.
- **The gate requires a valid block with `sources`; the fallback is removed.** Each failed round of #4185 reached the fallback through a different malformed block. The fallback served pages written before structured attribution, and no such page remains on `data`. This replaces the three-state rule recorded in `docs/solutions/best-practices/wiki-page-structured-attribution-2026-06-04.md`, where an absent `sources` key fell back to the body.
- **A malformed block maps to each caller's existing invalid-YAML behaviour.** This gives every caller a defined reaction without a new behaviour to design or test for each one.
- **The splitter does not parse YAML.** Callers differ on purpose in how they treat invalid YAML and non-mapping values. Sharing the split and leaving the parse keeps those differences where they are.
- **An unclosed block is an error, not "no frontmatter".** A file that starts with `---` meant to carry metadata. Reading it as plain text hides the mistake and, at the gate, hid the page's real sources.
- **Trailing spaces and tabs on the closing line are accepted.** Every copy on `main` accepts them today, because each matches only the start of the line.
- **#4183 is folded in.** The corrector's defect only becomes reachable once a close must be a whole line, and the splitter is what makes that true.

---

## Dependencies / Assumptions

- The next release of `@fro.bot/wiki-write-core` after this lands is a minor version, because the package gains an export. Its exported `splitFrontmatter` also starts reporting an error for an unclosed block.
- `fro-bot/dashboard` is the known consumer outside this repository. This brainstorm did not read its code.
- The count of CRLF files on `data` and under `docs/` was not measured. AE11 depends on it being known before the change is judged.
- The page counts on `data` were measured on 2026-11-12: 49 Markdown files under `knowledge/wiki/`, 33 of them gated repo pages, and all 33 have a valid block with `sources`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R10][Technical] Whether the change to the exported `splitFrontmatter` needs a gate-contract version bump, and what the dashboard does with the new error.
- [Affects R10, R11][Technical] How the work is split into PRs. The published package's change cuts a release; the private packages' changes do not.
- [Affects R15][Needs research] What the caller of the pattern-synthesis reader does when the reader throws on invalid YAML, since a malformed block will now take that path.
- [Affects R15][Needs research] Whether the repo-page move reaches its string edit before or after the document parse that throws on a missing block.
- [Affects R17][Needs research] How many files on `data` and under `docs/` use CRLF or have an empty block, so the intended differences in AE11 can be listed by file.
- [Affects R18][Technical] Whether the splitter joins the mutation gate's `mutate` list, as the privacy gate's module already does.

---

## Sources / Research

- Issue #4148, including the comment that lists what the splitter must define. Closed PR #4185 and its three review rounds.
- Issue #4183, the plan-status corrector.
- The branch `fix/frontmatter-closing-delimiter` keeps the tests and reproductions from #4185.
- `packages/privacy/src/check-wiki-private-presence.ts`: `parseFrontmatterSources` and `detectPrivateWikiLeaks` hold the gate's decision table. `check-wiki-private-presence.test.ts` pins the fallback that R13 removes.
- The twelve sites: `packages/wiki-write-core/src/frontmatter.ts`, `wiki-utils.ts`, `wiki-ingest.ts` (two) and `repo-page-move.ts`; `packages/wiki-ops/src/solutions-query.ts`; `packages/knowledge/src/capture-learnings-harvest.ts` and `capture-patterns-synthesis.ts`; `packages/reports/src/improvement-metrics-detect.ts`; `packages/privacy/src/check-wiki-private-presence.ts`; `packages/status-truth/src/detect-plan-consistency.ts` (two).
- `scripts/package-layout.test.ts` enforces the package graph that R11 changes.
- `docs/solutions/best-practices/equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md`: the differential proof in R18.
- `docs/solutions/best-practices/moving-a-script-into-a-workspace-package-changes-its-contract-2026-11-05.md`: an exported function's input is library input for CodeQL, and a scaling test must fail on the old code (R8, R19).
- `docs/solutions/best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md`: absent, unreadable and present are separate results (R5).
- Prior art: `marcusrbrown/systematic` `src/lib/frontmatter.ts` requires a whole-line close and accepts an empty block. It reads an unclosed block as no frontmatter and rejects trailing spaces on the close, which R3 and R5 do not follow.
