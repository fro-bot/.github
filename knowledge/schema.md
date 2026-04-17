# Wiki Schema

This document defines conventions for the Fro Bot knowledge wiki — a persistent, compounding knowledge system following the [Karpathy wiki pattern](https://gist.github.com/karpathy/1dd0294ef9567971c1e4348a90d69285).

## Three-Layer Architecture

1. **Raw sources** — upstream repositories, documentation, and artifacts referenced by URL and commit SHA. Never copied into the wiki; only referenced.
2. **Wiki** (`knowledge/wiki/`) — LLM-compiled, persistent, cross-referenced pages that compound over time. The wiki is the primary knowledge artifact.
3. **Schema** (this file) — conventions governing the wiki layer: page types, frontmatter, naming, cross-references, and maintenance rules.

## Page Types

| Type         | Directory                     | Purpose                                              |
| ------------ | ----------------------------- | ---------------------------------------------------- |
| `repo`       | `knowledge/wiki/repos/`       | Per-repository knowledge page                        |
| `topic`      | `knowledge/wiki/topics/`      | Cross-cutting technical topic (e.g., testing, CI/CD) |
| `entity`     | `knowledge/wiki/entities/`    | Named entity (person, org, tool, service)            |
| `comparison` | `knowledge/wiki/comparisons/` | Side-by-side analysis of alternatives                |

## Frontmatter

Every wiki page MUST include YAML frontmatter:

```yaml
---
type: repo | topic | entity | comparison
title: Human-readable page title
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources:
  - url: https://github.com/owner/repo
    sha: abc123
    accessed: YYYY-MM-DD
tags: [relevant, tags]
---
```

Required fields: `type`, `title`, `created`, `updated`. Optional fields: `sources`, `tags`, `aliases`, `related`.

## Filename Conventions

- Lowercase kebab-case: `my-repo-name.md`
- Repo pages: `{owner}--{repo}.md` (double-dash separates owner from repo)
- Topic pages: descriptive slug, e.g., `github-actions-ci.md`
- Entity pages: entity name slug, e.g., `vitest.md`
- Comparison pages: `{a}-vs-{b}.md`

## Cross-References (Wikilinks)

Use `[[filename]]` wikilink syntax (without `.md` extension):

```markdown
See [[vitest]] for testing patterns used across repos. Compare with [[jest-vs-vitest]] for migration rationale.
```

Wikilinks MUST point to existing pages. Broken links are flagged by weekly lint.

## Update Rules

- **Additive by default**: new knowledge augments existing pages; it does not replace prior content unless explicitly contradicted by a newer source.
- **Contradictions**: when new information contradicts existing content, note both versions with dates and sources. Do not silently overwrite.
- **Staleness**: pages not updated in 90+ days are candidates for lint review.
- **Page size**: aim for 500-2000 words per page. Split larger pages into sub-topics.

## Index and Log

- `knowledge/index.md` — master catalog organized by page type. Updated on every ingest operation.
- `knowledge/log.md` — append-only chronological record of all wiki operations (ingest, query, lint, manual edit).

### Log Entry Format

```markdown
## [YYYY-MM-DD HH:MM] <operation> | <target>

<brief description of what changed and why>

Sources: <URLs or references>
```

Operations: `ingest`, `query`, `lint`, `manual-edit`.

## Maintenance

- **Weekly lint** (Unit 17): scans for broken wikilinks, orphan pages, stale claims, missing cross-references, and knowledge gaps.
- **Ingest validation**: every ingest operation validates output against this schema before committing.
- **Index consistency**: `index.md` MUST list every page in `wiki/`. Orphan pages (in wiki but not index) are flagged by lint.
