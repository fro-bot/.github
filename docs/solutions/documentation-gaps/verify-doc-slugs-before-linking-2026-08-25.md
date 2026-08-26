---
title: Verify doc slugs before linking
date: 2026-08-25
category: documentation-gaps
module: wiki-site
problem_type: documentation_gap
component: documentation
severity: medium
applies_when:
  - "adding or editing a relative link between Markdown documents"
  - "a Related section points to a descriptive filename rather than a verified corpus slug"
  - "one broken documentation link has been found and sibling copies may exist"
tags:
  - documentation
  - drift
  - inventory
  - tooling
  - frontmatter-hygiene
---

# Verify doc slugs before linking

## Context

Issue #3696 exposed a documentation defect that looked small and was not. The source PR was merge commit
`3233ffabd921e678014a5049a9b6d1777bb3ea93`, which added the knowledge-track document
`docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`. Its only review blocker was a
dead `Related` link. The document pointed at the nonexistent slug
`structured-first-attribution-for-public-allowlist-privacy-gates.md`; the existing corpus slug was
`wiki-page-structured-attribution-2026-06-04.md`.

The bad slug had already propagated to a sibling document through copy-paste. The corrected target was the slug every
other document in the corpus already used for the same page. A knowledge doc whose value is partly navigability cannot
treat a dead ancestor pointer as a cosmetic nit.

## Guidance

1. **Resolve the target against the corpus, not memory.** When adding a relative link, list the destination directory
   and reuse the exact filename already used by sibling references. Do not invent a descriptive slug from the page title.
2. **Validate the path from the source file's directory.** Check the relative path on disk, including its category prefix
   (`../best-practices/`, `../security-issues/`, and so on). A link that looks correct from the repository root can still
   be wrong from the document that contains it.
3. **Sweep for the same bad slug.** Once one dead target is found, search all documentation for that exact string.
   Copy-paste propagation means the first broken link is evidence of a corpus-level defect, not proof of a one-file typo.
4. **Add a machine-enforced link-target check.** This repository currently has no automated Markdown link checker in
   `package.json`, `.github/workflows/`, or its lint configuration. `pnpm lint` covers the configured lint surface, but
   it does not prove that relative documentation targets exist. A CI check should resolve every relative Markdown link
   from its source file and fail on missing targets.
5. **Record the audit state without hiding unrelated defects.** Fix the link in the document being authored, but report
   other broken links found in the live corpus separately. Do not silently broaden the change into an unrelated cleanup.

## Why This Matters

Documentation cross-references are part of the interface. A dead `Related` pointer breaks the reader's path through the
knowledge corpus, makes related patterns harder to discover, and lets future authors copy the same defect. The failure is
quiet: Markdown lint can pass while navigation is broken. Without an automated target check, only a deliberate corpus
audit catches it.

The live audit for this document checked 95 Markdown files and 104 relative links across `docs/solutions/**/*.md` and
`knowledge/**/*.md`. It found one broken link, which remains unfixed by design:
`knowledge/wiki/topics/home-assistant.md:52` targets `esphome`, and no file exists at the resolved relative path
`knowledge/wiki/topics/esphome`. The current state is part of the learning: a discovered broken slug should trigger a
sweep and an explicit report, not a misleading claim that the entire corpus is clean.

## When to Apply

- Adding a `Related` entry to a solution doc or knowledge page.
- Copying a cross-reference from a neighboring document.
- Renaming, moving, or recategorizing a Markdown document.
- Reviewing a documentation PR whose prose is correct but whose navigability has not been checked.
- Finding one dead relative link and deciding whether it is isolated.

## Examples

### Incident pattern from issue #3696

The broken reference was:

```markdown
[structured-first-attribution-for-public-allowlist-privacy-gates](structured-first-attribution-for-public-allowlist-privacy-gates.md)
```

The verified corpus reference was:

```markdown
[Wiki page structured attribution](wiki-page-structured-attribution-2026-06-04.md)
```

The second slug is not a stylistic preference. It is the file that exists and the one the rest of the corpus already
uses. The first slug was a copy-paste fossil: once one neighbor carried it, another inherited it.

### Minimal link audit

For each Markdown file, resolve every relative link from that file's directory and fail the check when the target file is
absent. Skip external URLs and fragment-only links; validate the path before considering the anchor.

```text
source: docs/solutions/best-practices/example.md
target: ../runtime-errors/node-strip-only-typescript-2026-04-18.md
resolve: docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md
result: exists
```

### Self-refuting documentation

This document's own `Related` section would refute its guidance if even one target were guessed or left unchecked. Every
link below was resolved against the live file listing before authoring was complete.

## Related

- [Inventory-driven doc drift cleanup pattern](doc-drift-cleanup-pattern-2026-04-18.md) — inventory the live corpus instead of carrying forward remembered structure.
- [Structured-first attribution for public-allowlist privacy gates](../best-practices/wiki-page-structured-attribution-2026-06-04.md) — the corrected target slug from issue #3696.
- [Verify in the CI topology, not just locally](../best-practices/verify-in-the-ci-topology-not-just-locally-2026-07-11.md) — verification must match the environment and topology that matter.
