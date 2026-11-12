---
date: 2026-11-12
topic: shared-frontmatter-splitter
---

# One Shared Frontmatter Splitter

## Summary

One frontmatter splitter, exported from `@fro.bot/wiki-write-core`, replaces the twelve copied regexes that find a YAML frontmatter block. It defines once what a block is and reports one of three outcomes: no block, a block, or a malformed block. The wiki privacy gate then passes a public repo page only when its block is valid and its `sources` names that repository.

---

## Problem Frame

Twelve places in six packages find a frontmatter block with their own copy of a regex. Five copies are in the published `@fro.bot/wiki-write-core`. The others are in `wiki-ops`, `knowledge` (two), `reports`, `privacy` and `status-truth` (two).

The copies share one defect and disagree on the rest:

- **A close that is not a whole line.** Every copy ends the block at the first line that starts with `---`. A line such as `---x: y` or `----` inside the block ends it early, and the keys after that line are dropped without an error.
- **Line endings.** Nine copies accept LF only, so a CRLF file reads as having no frontmatter. Three accept both.
- **An empty block.** `---` directly followed by `---` is not read as a block by any copy.
- **An unclosed block.** Every reader that tolerates a missing block also reads an opened block with no close as "no frontmatter", without an error.

The privacy gate is where this matters most. `packages/privacy/src/check-wiki-private-presence.ts` checks a wiki page's `sources` list when it can read one. When the block is missing, unclosed, not valid YAML, not a mapping, or a mapping with no `sources` key, it falls back to a weaker test: the page passes if its body contains the public repository's URL. A page can therefore be shaped so that its real `sources` are not read and a decoy URL in the body passes it.

A first fix (#4185) tightened each copy's regex in place. Its review reproduced the decoy route through a `---x` line and a `----` line, and found that an empty block was now wrongly blocked. The fix had grown a special case for each parser error. The PR was closed in favour of one splitter with a defined result for a malformed block (#4148).

---

## Requirements

**The splitter**

- R1. One splitter decides where a frontmatter block starts and ends for every production reader in the repository. No other production code finds the block by itself.
- R2. A block opens only when the content starts with a line that is exactly `---`, with nothing before it and nothing after it on that line.
- R3. A block closes at the first later line that is `---`, optionally followed by spaces or tabs, and then a line ending or the end of the content. Any other line, including `---x`, `----` and `--- text`, is content of the block.
- R4. A line ending is LF or CRLF. Both are accepted for the opening line, the closing line and the lines between. A lone CR is not a line ending.
- R5. The splitter reports one of three outcomes: no block, a block, or a malformed block. An opened block with no closing line is malformed, and that is the only malformed case.
- R6. An empty block is a block with empty text. A site that parses the text treats empty text as an empty mapping, and then applies its usual checks to that mapping.
- R7. With a block, the splitter gives the block's text and the body. The body is the content after the closing line's line ending, byte for byte. A site that rewrites a file in place can still reproduce every byte it does not change.
- R8. The splitter's running time grows linearly with the length of the content, including for content that opens a block and never closes it.
- R9. The splitter does not parse YAML. Parsing the block's text and judging its value stay with each site.

**Where it lives**

- R10. The splitter is an export of `@fro.bot/wiki-write-core`. The five copies in that package and the seven in the private packages all use it.
- R11. `knowledge`, `reports` and `status-truth` gain a production dependency on `@fro.bot/wiki-write-core`. The package graph stays acyclic, and the published package still depends on no private package.

**The privacy gate**

A _public repo page_ is a page directly under `knowledge/wiki/repos/` whose slug maps to exactly one public repository. These are the pages whose attribution the gate reads.

- R12. A public repo page passes attribution only when it has a block, the block parses as a YAML mapping, and its `sources` has a URL that matches the repository by the existing rule.
- R13. A public repo page with no block, a malformed block, a block that is not valid YAML, a block that is not a mapping, or a mapping with no `sources` key is blocked. The body-URL fallback and its warning are removed.
- R14. Every case in R13 reports the existing `unattributable-page` reason. The gate's output gains no reason code, and it prints no page text, file content or parser message.
- R15. The gate's other rules do not change: the URL match, the present-but-invalid `sources` rule, the block on a slug shared by two public repositories, and the pass for a non-public page that is unchanged from `main`.

**The other sites**

- R16. Each other site reacts to a malformed block as the table below says. No site gains a new kind of message, error class or output field.
- R17. Each site keeps its own handling of the body: the sites that trim it still trim it, and the sites that rewrite a file in place still preserve the bytes they do not change. The one exception is the repo-page move on a CRLF page. It re-renders the block structurally, which writes LF line endings there.
- R18. The plan-status corrector makes no correction when the block is malformed or its text does not parse as a YAML mapping (#4183).
- R19. For a file that none of the intended changes below and R23 affects, every site returns what it returns today.

| Site | Reaction to a malformed block |
| --- | --- |
| Wiki page reader (`wiki-utils.ts`) | Returns its frontmatter error, as for invalid YAML. Wiki query then fails the baseline context, and the run continues without it (out of scope here). Context expansion drops the page, and lint reports it. |
| Wiki ingest, both readers (`wiki-ingest.ts`) | Each throws the error it throws today for a missing block. |
| Frontmatter document reader (`frontmatter.ts`) and the repo-page move that uses it | Throws its missing-frontmatter error, as it does today. |
| Solutions search (`solutions-query.ts`) | Skips the document with its existing malformed-frontmatter warning. |
| Learnings harvest (`capture-learnings-harvest.ts`) | Skips the document without a message, as for invalid YAML. |
| Pattern synthesis (`capture-patterns-synthesis.ts`) | Excludes the document and counts it as invalid, as for invalid YAML. |
| Improvement metrics (`improvement-metrics-detect.ts`) | Treats the document as having no metadata, as for invalid YAML. |
| Plan-status resolver (`detect-plan-consistency.ts`) | Reports the status as unavailable, as it does today for a missing block. |
| Plan-status corrector (`detect-plan-consistency.ts`) | Makes no correction, as it does today for a missing block. |

**Proof and records**

- R20. Each replaced copy is compared with its old regex over one shared corpus of well-formed, malformed and adversarial inputs. Every difference found is one of the intended changes below.
- R21. A scaling test shows that the splitter's time grows linearly on long adversarial input, including an opened block with no close.
- R22. The records that describe the old behaviour are updated in the same change: the three-state rule, the "keep the fallback for legacy data" guidance and the code example in `docs/solutions/best-practices/wiki-page-structured-attribution-2026-06-04.md`, the cross-reference in `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`, and the package graph in `README.md` and `.github/copilot-instructions.md`.

**The writer**

- R23. When the ingest writes the target repository's page and that page has no `sources` or an empty `sources` list, the page's `sources` holds that repository's URL. The ingest never changes a page that lists sources, and it stamps no other repo page in the same write.

---

## Intended Changes

Apart from R23, these are the only inputs for which a site's result differs from today.

- **A line that starts with `---` but is not a close** (`---x`, `----`, `--- text`). It no longer ends the block. The block runs to the real closing line, so keys after that line are read. The block's text may now be invalid YAML where its first part alone was valid.
- **Spaces or tabs after the closing `---`.** They belong to the closing line. Today they are left at the start of the body by the sites that do not trim it.
- **CRLF files.** The nine LF-only sites now read the block.
- **An empty block.** It is a block with an empty mapping. Today no site reads it as a block.
- **An unclosed block.** It is malformed and each site reacts as R16 says. Today it is read as "no frontmatter": solutions search, the wiki page reader and pattern synthesis keep such a document with its whole text as body, and after the change they skip, drop or exclude it.
- **The privacy gate.** A public repo page without a valid block and `sources` is blocked, where the body URL could pass it (R13).
- **The plan-status corrector.** It makes no correction for a block that is not a YAML mapping, where it rewrote any `status:` line it found (R18).
- **The ingest's repo page.** It adds the target repository's URL to the target's page when that page lists no sources (R23).

---

## Acceptance Examples

- AE1. **Covers R2.** Given a file whose first line is `--- ` with a trailing space, or one that starts with a byte-order mark or a blank line before `---`, when it is read, it has no block.
- AE2. **Covers R3.** Given a block whose third line is `---x: y` and whose fifth line is `---`, when a site reads the file, the block ends at the fifth line and the key on the fourth line is present.
- AE3. **Covers R3, R7.** Given a closing line of `---` followed by two spaces, when the file is read, the block closes at that line and the body starts on the next line.
- AE4. **Covers R3.** Given a file that is `---`, a line of YAML and a final `---` with no line ending after it, when it is read, it has a block and an empty body.
- AE5. **Covers R4.** Given a CRLF file with a well-formed block, when solutions search reads it, the document's title and tags come from the block.
- AE6. **Covers R5, R16.** Given a file that opens a block and never closes it, when the wiki page reader reads it, the result carries a frontmatter error. When solutions search reads it, the document is skipped with the existing warning. A file that is only `---` gives the same results.
- AE7. **Covers R6.** Given a file that starts with `---` directly followed by `---`, when a site that parses reads it, it has a block and an empty mapping, and the body is everything after the second line.
- AE8. **Covers R3, R12, R13.** Given a public repo page whose block lists a non-matching source, then has a `---x` line, then a later `---`, and whose body contains the repository's URL, when the gate runs, the page is blocked.
- AE9. **Covers R13, R14.** Given a public repo page whose body contains the repository's URL and which has no block, an unclosed block, a block that is a YAML list, or a valid mapping with no `sources` key, when the gate runs, each is blocked as `unattributable-page`.
- AE10. **Covers R12.** Given a public repo page with a valid block whose `sources` has the matching URL, when the gate runs, attribution passes, whatever the body contains.
- AE11. **Covers R15.** Given a page under `knowledge/wiki/repos/` whose slug maps to no public repository and whose content equals the copy on `main`, when the gate runs, the page passes without its block being read.
- AE12. **Covers R3, R18.** Given a plan whose block text contains a `--- text` line before a `status: active` line and a later `---`, when the corrector runs, it makes no correction, because the block's text is not valid YAML.
- AE13. **Covers R19.** Given every Markdown file under `knowledge/` on `data` and under `docs/` on `main`, when each site reads them before and after the change, the results are the same.

---

## Success Criteria

- The inputs that defeated #4185 are handled without a rule written for any of them: the gate blocks a decoy URL behind a `---x` or `----` line, and an empty block is read as a block.
- One implementation of the block rule exists. No production code outside the splitter finds a frontmatter block.
- No file under `knowledge/` on `data` or under `docs/` on `main` changes outcome at any reader site.
- The planner can start from this document without deciding what a block is, how any site reacts to a malformed block, or what the gate does without `sources`.

---

## Scope Boundaries

- New kinds of message in sites that are silent on bad frontmatter today: learnings harvest and improvement metrics.
- What any site does with a well-formed block that the intended changes and R23 do not affect.
- The YAML parser and its options.
- The gate's URL match. A page can list the right URL in `sources` beside others, and the match accepts trailing path segments. This work removes the body-URL route, not a false claim inside `sources`.
- The test-only parsers in `scripts/agent-skills.test.ts`, `packages/wiki-ops/src/solutions-query.test.ts` and `packages/privacy/src/repo-page-move.test.ts`.
- The promotion leak gate (`check-private-leak`), which works on node IDs and never reads `sources`.
- A migration of existing pages. None is needed: all 31 public repo pages on `data` already meet R12.

---

## Key Decisions

- **One splitter exported from the published package.** The published package cannot import a private one, and five of the twelve copies are inside it. A second copy in `@fro-bot/core` would leave two implementations to keep in step.
- **The gate requires a valid block with a matching source; the fallback is removed.** The fallback is the route #4185 could not close without a special case per parser error. It served pages written before structured attribution, and no public repo page on `data` uses it. This replaces the "key absent" state of the three-state rule in `docs/solutions/best-practices/wiki-page-structured-attribution-2026-06-04.md`.
- **Each site reacts to a malformed block with a behaviour it already has.** Most reuse their invalid-YAML reaction. The sites that never parse YAML, or that throw a parser error with no equivalent for a missing close, reuse their missing-block reaction.
- **The splitter does not parse YAML.** Sites differ on purpose in how they treat invalid YAML and non-mapping values. Sharing the split and leaving the parse keeps those differences where they are.
- **An unclosed block is an error, not "no frontmatter".** A file that starts with `---` meant to carry metadata. Reading it as plain text hides the mistake and, at the gate, hid the page's real sources.
- **The opening line is exact; the closing line may carry trailing spaces or tabs.** Every copy on `main` accepts trailing whitespace on the close, because each matches only the start of that line, and none accepts it on the opening line.
- **The corrector's guard follows the block rule, not the author's intent.** A `---x: y` line followed by `status:` is a valid mapping under R3, so the corrector still rewrites that status. R18 stops rewrites in blocks that are not valid mappings. It cannot tell that an author meant an earlier line to close the block.

---

## Dependencies / Assumptions

- The next release of `@fro.bot/wiki-write-core` after this lands is a minor version. The package gains an export, and its existing wiki page reader starts reporting an error for an unclosed block, which a consumer can observe.
- `packages/wiki-write-core/dist/gate-contract.json` is regenerated, because the package's source changes.
- `fro-bot/dashboard` is the known consumer outside this repository. This brainstorm did not read its code.
- `knowledge` has the published package as a development dependency today. `privacy` and `wiki-ops` already depend on it in production.
- R18 has the corrector judge whether text is a YAML mapping. `status-truth` declares no YAML parser today.
- `detectPrivateWikiLeaks` is also called by the wiki repair path (`packages/wiki-ops/src/wiki-repair.ts`), so R13 applies there too.
- The fallback's warning line, `legacy-substring-attribution`, has no consumer in this repository's workflows. A consumer outside the repository was not ruled out.
- Measured on 2026-11-12 at `origin/data` `62f9a45` and `origin/main` `81ac1de`: 57 files under `knowledge/` and 186 under `docs/`. None contains a CR, an empty block, an unclosed block, or a line that starts with `---` and is not exactly `---`. Of the 33 pages under `knowledge/wiki/repos/`, 31 are public repo pages with a matching source, and 2 have a non-public slug and pass as unchanged from `main`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R10][Technical] Whether the wiki page reader's new error for an unclosed block needs a gate-contract version bump, and what the dashboard does with it.
- [Affects R10, R11][Technical] How the work is split into PRs. The published package's change cuts a release; the private packages' changes do not.
- [Affects R18][Technical] How the corrector checks that the block is a YAML mapping: a declared parser dependency in `status-truth`, or a check that the published package exports.
- [Affects R20][Technical] Whether the splitter joins the mutation gate's `mutate` list, as the privacy gate's module already does.

---

## Sources / Research

- Issue #4148, including the comment that lists what the splitter must define. Closed PR #4185 and its review.
- Issue #4183, the plan-status corrector.
- The branch `fix/frontmatter-closing-delimiter` keeps the tests and reproductions from #4185.
- `packages/privacy/src/check-wiki-private-presence.ts`: `parseFrontmatterSources` and `detectPrivateWikiLeaks` hold the gate's decision table. `check-wiki-private-presence.test.ts` pins the fallback that R13 removes. The solution doc's examples carry `verify:` markers that name `parseFrontmatterSources`.
- The twelve sites: `packages/wiki-write-core/src/frontmatter.ts`, `wiki-utils.ts`, `wiki-ingest.ts` (two) and `repo-page-move.ts`; `packages/wiki-ops/src/solutions-query.ts`; `packages/knowledge/src/capture-learnings-harvest.ts` and `capture-patterns-synthesis.ts`; `packages/reports/src/improvement-metrics-detect.ts`; `packages/privacy/src/check-wiki-private-presence.ts`; `packages/status-truth/src/detect-plan-consistency.ts` (two).
- `scripts/package-layout.test.ts` enforces the package graph that R11 changes.
- `docs/solutions/best-practices/equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md`: the differential proof in R20.
- `docs/solutions/best-practices/moving-a-script-into-a-workspace-package-changes-its-contract-2026-11-05.md`: an exported function's input is library input for CodeQL (R8, R21). The old regexes were measured as linear on failure, so R21 asks for linear growth and not for a failure on the old code.
- `docs/solutions/best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md`: absent, unreadable and present are separate results (R5).
- Prior art: `marcusrbrown/systematic` `src/lib/frontmatter.ts` requires a whole-line close and accepts an empty block. It reads an unclosed block as no frontmatter and rejects trailing spaces on the close, which R3 and R5 do not follow.
