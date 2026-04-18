---
name: generating-project-docs
description: Use when creating, refreshing, or updating project-level documentation in this repository — README.md, SECURITY.md, AI-assistant guidance, subdirectory READMEs, or any community-health file — including drift fixes, asset count refreshes, or new section additions
---

# Generating Project Documentation

## Overview

This repo is the Fro Bot control plane. Its documentation describes a live system whose surface (workflows, scripts, metadata, knowledge wiki, persona, brand assets) keeps changing. Generated docs go stale fast.

**Core principle:** Derive every fact from the live repository. Preserve the existing document's evolved structure. Never regress to a generic template.

If you cannot point at a file, command, or commit that justifies a sentence, do not write it.

## When to Use

- Refreshing `README.md` after new workflows, scripts, or metadata files land
- Fixing documentation drift (counts, structure, file inventories, runtime claims)
- Updating `SECURITY.md` when reporting channels, supported versions, or badges change
- Updating `.github/copilot-instructions.md` when AI-assistant conventions evolve
- Adding or refreshing a subdirectory `README.md` (e.g. `metadata/`, `persona/`, `branding/`, `scripts/`)
- Generating a section-scoped update (e.g. only the "Repository Structure" tree)

## When NOT to Use

- Authoring deep contract docs (`knowledge/schema.md`, `persona/fro-bot-persona.md`) — those have their own authoring rules
- Writing planning docs (`docs/plans/`, `docs/brainstorms/`, `docs/solutions/`) — those follow their own templates
- Generating downstream-repo READMEs — the `apply-branding` workflow uses `branding/README-template.md` for that

## Pre-Generation Inventory

Before writing anything, gather these from the live repo:

| Source | What to extract |
| --- | --- |
| `package.json` | name, description, scripts, packageManager (pnpm version), engines, repository |
| `README.md` (current) | banner, badges, navigation, section order, voice |
| `.github/workflows/` | workflow names, triggers, purposes (read each `name:` and top-level `on:` block) |
| `scripts/*.ts` | TypeScript entrypoints, exported functions, test counts (`pnpm test --reporter=basic`) |
| `metadata/*.yaml` | metadata files in scope and their schemas |
| `knowledge/{schema,index,log}.md` + `knowledge/wiki/` | wiki coverage stats (counts of repos/topics/entities) |
| `persona/`, `branding/`, `assets/` | character + brand asset inventory |
| `mise.toml` | tool versions (Node, pnpm) |
| `git log --oneline -15` | recent change context |

Counts (workflows, scripts, tests, metadata files, wiki pages) MUST come from `ls`, `find`, or `pnpm test` output. Never guess or carry over from the previous draft.

## Style Rules (Non-Negotiable)

These rules match this repo's evolved style. Match them exactly.

1. **Header block**: centered `<div align="center">` with `<img src="./assets/banner.svg" ... width="100%" />`, H1, single blockquote tagline, badge row, navigation row (bold links separated by `·`).
2. **Badges**: `style=for-the-badge`, `labelColor=0D0216`, brand colors:
   - Build / primary action: `color=00BCD4` (cyan)
   - Security / secondary: `color=E91E63` (magenta)
   - License / highlights: `color=FFC107` (amber)
3. **Callouts**: GitHub alerts `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`. Inline content on the same line after the marker.
4. **Tables**: prefer over bullet lists for inventories. Two-column tables for asset/config listings; three-column for workflow/credential mappings.
5. **Code blocks**: language-tagged. `bash` for shell, `yaml` for YAML, `json` for JSON, `typescript` for TS, `markdown` for skill/doc snippets, `text` for ASCII trees.
6. **Paths**: backticks for every file, directory, command, env var. Link to repo files via relative links: `[file](path/to/file)`.
7. **AI-assistant guidance**: cite `.github/copilot-instructions.md` as the canonical source. Subdirectory `README.md` files (e.g. `metadata/README.md`, `persona/README.md`) are the canonical source for that subsystem.
8. **Voice**: terse, declarative, fact-first. No marketing language. No phrase like "robust", "powerful", "leverages", "best-in-class". Mirror the existing README's tone.
9. **No session/process leakage**: never reference subagent names, internal work-queue numbering, plan paths, skill names, or session framing. Public docs read as if any competent engineer wrote them.

## Section Order

For `README.md`, preserve this order (matches current main-branch README):

1. Centered header (banner, H1, tagline, badges, nav)
2. Overview (with "What Fro Bot Does" or equivalent)
3. Features (categorized, emoji-led headings allowed for top-level groups only)
4. Branding (assets table, design system snippet)
5. Getting Started (Prerequisites, Local Development with numbered steps)
6. Repository Structure (ASCII tree + key configuration files table)
7. Automation (workflows table)
8. Development (code quality standards, AI development guidelines pointer)
9. Resources (categorized link list)

For `SECURITY.md`, preserve: reporting channel, supported versions table, OpenSSF badges. Do not add new sections without justification.

For subdirectory `README.md`, follow the pattern in `metadata/README.md` and `persona/README.md`: Files (with schemas) → Update convention → Credential expectations (if any) → See also.

For section-scoped updates: read the current document, locate the section by heading, replace only that section's content. Preserve surrounding structure exactly.

## Generation Flow

1. **Inventory** — gather everything from "Pre-Generation Inventory". Count things; don't estimate.
2. **Diff against current doc** — for each section, identify what changed (new files, removed files, renamed scripts, count drift).
3. **Write minimal diff** — update only what changed. Keep voice, structure, and untouched sections exactly as they are.
4. **Verify** — run the security and accuracy checks below. Re-read the doc end-to-end.

## Quality Checks

**Security (always):**

- No tokens, API keys, secrets, or PAT contents
- No internal-only URLs, IPs, or local paths (e.g. `/Users/...`)
- No real identifying data beyond what's already public on the repo
- Generic, redacted example data only

**Accuracy (always):**

- Every count matches the inventory (`ls`, `find`, `pnpm test` output)
- Every workflow listed has a real `.github/workflows/*.yaml` file
- Every script listed has a real `scripts/*.ts` file
- Every link resolves (relative paths exist, external URLs are correct)
- Every badge URL points at a real workflow / service / endpoint
- No phantom files or features

**Style (always):**

- Markdown lints clean (`pnpm lint` covers files not excluded in `.markdownlint-cli2.yaml`)
- Headings monotonically increase (H1 → H2 → H3, no skipping)
- Code blocks all have language tags
- All file references use backticks

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Carrying over counts from previous draft | Re-derive every count from a live `ls` / `find` / `pnpm test` run |
| Adding "Robust", "Powerful", "Enterprise-grade" language | Delete it. State the fact instead. |
| Listing a workflow that doesn't exist | Cross-check against `ls .github/workflows/` |
| Using bare `<img>` instead of `<picture>` or `<img ... width="100%" />` | Match the existing header block exactly |
| Wrong badge color/style | Check brand tokens above; `style=for-the-badge` + `labelColor=0D0216` |
| Replacing the evolved structure with a generic template | Read the current doc first; preserve sections you aren't updating |
| Inventing new top-level sections | Get explicit approval before adding a new H2 |
| Leaking session/plan/skill/subagent names into docs | Public docs describe the system, not how it was built |

## Quick Reference

```bash
# Inventory commands (run before writing)
ls .github/workflows/                      # workflow count + names
ls scripts/*.ts | grep -v test             # production script count
ls scripts/*.test.ts                       # test file count
pnpm test --reporter=basic 2>&1 | tail -5  # actual test count
ls metadata/*.yaml                         # metadata file count
find knowledge/wiki -name '*.md' | wc -l   # wiki page count
git log --oneline -15                      # recent change context

# Verification (run after writing)
pnpm lint <changed-files>                  # markdown + style check
git diff README.md                         # review own diff
```

## Reference Lineage

This skill adapts the project-specific `/generate-readme` command from the [Systematic project](https://github.com/marcusrbrown/systematic/blob/main/.opencode/commands/generate-readme.md) to this repo's voice, structure, and asset inventory. When refreshing, check Systematic's command for new patterns worth pulling in.
