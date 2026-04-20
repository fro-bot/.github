---
title: Inventory-Driven Doc Drift Cleanup Pattern
category: documentation-gaps
problem_type: documentation_gap
component: documentation
resolution_type: process_improvement
severity: medium
date: 2026-04-18
last_updated: 2026-04-18
module: README.md, SECURITY.md, .github/copilot-instructions.md, metadata/README.md
tags:
  [documentation, drift, readme, security-policy, copilot-instructions, agent-skills, inventory, pr-sequencing]
verified: true
---

## Context

The root-level community-health and AI-guidance docs (`README.md`, `SECURITY.md`, `.github/copilot-instructions.md`,
and subdirectory READMEs) describe a live control plane whose surface keeps changing — workflows, scripts, metadata
schemas, wiki pages, and persona assets land regularly. Without a disciplined refresh process, the docs drift: counts
go stale, runtime claims contradict the live repo, tree diagrams list files that were deleted, and AI-assistant
guidance keeps pointing at obsolete files.

Hand-editing each doc from the previous draft compounds the drift. Generic templates (Node 20, pnpm 10.15, "robust
CI/CD pipelines", invented workflow tables) creep back in. By the time a new contributor reads the docs, half the
factual claims are wrong.

## Guidance

Treat doc refreshes as inventory-driven, not memory-driven. Build the convention-encoding into a skill first, then
run small, independent, reviewable PRs that each fix a single doc-drift surface.

### 1. Encode the conventions as a skill before refactoring

Create `.agents/skills/generating-project-docs/SKILL.md` (or equivalent) with:

- **Pre-Generation Inventory** — the sources of truth (`package.json`, `.github/workflows/`, `scripts/`, `metadata/`,
  `knowledge/`, `persona/`, `mise.toml`, etc.) and exactly what to extract from each.
- **Style Rules** — brand badges, callouts, tables, code blocks, paths, voice constraints ("no 'robust', 'powerful',
  'leverages'", "no session/process leakage"). Encode the evolved repo-specific style.
- **Section Order** — per doc type (`README.md`, `SECURITY.md`, subdirectory READMEs).
- **Quality Checks** — security (no secrets / internal paths / identifying data), accuracy (counts match `ls` output,
  links resolve, no phantom files), style (heading hierarchy, language-tagged code blocks).

Exclude the skill's own SKILL.md from the repo's ESLint and markdownlint configs. Agent-skill format uses padded tables
and fixed sections; formatters mangle the human-readable padding.

### 2. Slice the refresh into independent PRs

Split work by concern, not by file, so each PR has a single reviewable purpose:

| Scope                                            | Example                                           | Why independent                                                  |
| ------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------- |
| Inventory refresh of the primary doc             | `README.md` counts + tree + workflow table        | Content rewrite; no file deletes                                 |
| Removal of a file superseded by another          | Delete `.cursorrules`; remove its references      | Mechanical; touches multiple files but does one thing            |
| Polish of adjacent docs that didn't fit scope #1 | `SECURITY.md` refresh + additional section growth | Expands other docs once the primary doc points at the new canon  |

Branch all three off current `main`. Merge order doesn't matter if the PRs don't overlap on the same lines; keep
overlap minimal.

### 3. Resolve predictable merge conflicts via preview branch

When PRs B and C both touch the same file but different regions, a local preview branch (`review/doc-drift-combined`)
lets you:

- See the exact conflict shape before either PR lands
- Run a single multi-reviewer pass over the combined post-merge state
- Produce a reusable conflict resolution recipe for whichever PR rebases last

Don't ship the preview branch. It exists only for review and dry-run merging.

### 4. Run parallel persona reviewers on the combined diff

For doc-only changes, skip the full 17-persona ce:review pipeline. Dispatch 4 focused reviewers in parallel:

- **correctness** — every factual claim (workflow names, crons, counts, paths, credential names) matches the live repo
- **project-standards** — conventions (voice, leakage, frontmatter, canonical-pointer coherence)
- **maintainability** — structural coherence, over/under-specificity, redundancy, missing cross-references
- **security** — SECURITY.md accuracy, no leaked secrets / PII / internal paths, posture claims verified

Skip testing, performance, api-contract, data-migrations, reliability, adversarial, and stack-specific personas for
doc-only diffs — they don't apply.

### 5. Consolidate residual polish into a single follow-up PR

Roll up all non-blocking items (from the bot review, the persona reviewers, or human spot-checks) into one follow-up
PR along with any compound / learning documentation. This keeps the primary PRs clean and scoped, and preserves the
learning pattern in the same reviewable artifact.

## Why This Matters

- **Compounding discipline.** The skill encodes the conventions once; every future refresh is inventory-driven, not
  memory-driven. Counts don't drift because they're re-derived from `ls` / `find` / `pnpm test` each time.
- **Smaller diffs, better reviews.** A single 90-line README refresh is reviewable in a minute. A 300-line omnibus PR
  that touches six files with four different concerns isn't.
- **Preview-branch conflict resolution catches the issue before either PR lands.** The alternative — learning about the
  conflict during rebase-after-merge — wastes a cycle.
- **Focused reviewer selection halves the reviewer context.** Spinning up testing / performance / migrations reviewers
  on doc-only PRs produces noise, not signal.
- **Consolidated polish PR preserves the "why".** Learning docs and mechanical fixes live in the same commit history as
  the work that produced them, so future contributors can trace the thread.

## When to Apply

Use this pattern when:

- The primary docs (README, SECURITY, AI-assistant guidance, subdirectory READMEs) haven't been refreshed in > 1 month
  and the repo has been actively changing
- A specific doc is known to be inaccurate (new contributor feedback, CI claim drift, broken links)
- An entire file is being superseded or removed (e.g., `.cursorrules` → `.github/copilot-instructions.md`) and
  downstream references need cleanup
- New subsystems have landed (tests, metadata, a knowledge wiki) that aren't reflected in the top-level docs
- Before a public milestone where doc accuracy matters

Skip this pattern for:

- Single-word typo fixes (just ship the fix directly)
- Content that belongs in a deep-contract doc (`knowledge/schema.md`, `persona/fro-bot-persona.md`) rather than a
  community-health doc — those have their own authoring rules
- Downstream-repo READMEs (the `apply-branding` workflow uses `branding/README-template.md` for those)

## Examples

### Session: doc drift cleanup, 2026-04-18

Four PRs captured the pattern end-to-end:

| PR                                                   | Scope                                                                              | Pattern Element  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| [#3129](https://github.com/fro-bot/.github/pull/3129) | Add `.agents/skills/generating-project-docs/SKILL.md`; exclude skill content from ESLint / markdownlint | Encode conventions first |
| [#3130](https://github.com/fro-bot/.github/pull/3130) | `README.md` inventory refresh — Node 24 / pnpm 10.33.0, accurate tree, all 16 workflows, point AI guidance at `.github/copilot-instructions.md` | Slice 1: primary doc |
| [#3131](https://github.com/fro-bot/.github/pull/3131) | Delete `.cursorrules`; remove references in `.gitattributes`, `.github/copilot-instructions.md`, `.markdownlint-cli2.yaml`, `llms.txt` | Slice 2: removal |
| [#3132](https://github.com/fro-bot/.github/pull/3132) | `SECURITY.md` refresh (main-branch model, drop npm contact form, add Automated Security Scanning); expand `.github/copilot-instructions.md` architecture + add Tests and Autonomous Commits subsections | Slice 3: adjacent polish |

Each PR was reviewed independently by the bot (all PASS, LOW risk, zero non-blocking concerns from automated review).
A combined preview branch (`review/doc-drift-combined`) exercised the one predictable conflict in
`.github/copilot-instructions.md` (PR B strips `.cursorrules` from the quality-gates bullet; PR C adds six new bullets
plus two subsections after it) and made the resolution mechanical. Four persona reviewers (correctness,
project-standards, maintainability, security) ran in parallel against the combined diff in ~1-2 minutes total,
surfacing two small polish items (generic cron wording, metadata/README.md cross-link) that rolled into a follow-up
PR alongside this compound doc.

### Inventory commands used

```bash
ls .github/workflows/                      # 16 workflow files
ls scripts/*.ts | grep -v test             # 12 production scripts
ls scripts/*.test.ts                       # 11 test files
pnpm test                                  # 186 tests
ls metadata/*.yaml                         # 4 metadata files
find knowledge/wiki -name '*.md' | wc -l   # 24 wiki pages
git log --oneline -15                      # recent-change context
```

### Common mistakes avoided

- **Carrying counts from previous draft.** All counts re-derived from live `ls` / `find` / `pnpm test` output.
- **Marketing language reintroduction.** `llms.txt` has pre-existing "robust" and "leverages" drift that future
  refreshes should clean up; the current PRs stayed scoped to `.cursorrules` removal in `llms.txt`.
- **Replacing evolved structure with a generic template.** Preserved the centered banner, for-the-badge style with
  `labelColor=0D0216`, the cyan / magenta / amber brand palette, and the existing section order.
- **Hand-written interface reuse.** Followed the OctokitClient-derived-type pattern (see
  [`runtime-errors/octokit-invitation-method-names-2026-04-17.md`](../runtime-errors/octokit-invitation-method-names-2026-04-17.md))
  throughout — no handwritten interfaces were introduced in the new surface.

## Related

- `.agents/skills/generating-project-docs/SKILL.md` — the skill this pattern operationalizes
- `docs/solutions/runtime-errors/octokit-invitation-method-names-2026-04-17.md` — sibling discipline doc
