# Wiki Schema

This document defines conventions for the Fro Bot knowledge wiki — a persistent, compounding knowledge system following the [Karpathy wiki pattern](https://gist.github.com/karpathy/1dd0294ef9567971c1e4348a90d69285).

## Three-Layer Architecture

1. **Raw sources** — upstream repositories, documentation, and artifacts referenced by URL and commit SHA. Never copied into the wiki; only referenced.
2. **Wiki** (`knowledge/wiki/`) — LLM-compiled, persistent, cross-referenced pages that compound over time. The wiki is the primary knowledge artifact. Public-only invariant: the wiki carries knowledge about public repositories only — no page, name, or content for a private repository ever reaches it (enforced at survey dispatch, wiki ingest, and the `data → main` promotion gate). The automated promotion gate enforces the public-only invariant for `wiki/repos/` pages by slug attribution; non-repo wiki areas rely on the in-progress companion content scan and authoring discipline.
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

- **Weekly lint**: scans for broken wikilinks, orphan pages, stale claims, missing cross-references, and knowledge gaps.
- **Ingest validation**: every ingest operation validates output against this schema before committing.
- **Index consistency**: `index.md` MUST list every page in `wiki/`. Orphan pages (in wiki but not index) are flagged by lint.

## Editing the wiki

The `knowledge/wiki/<subdir>/*.md` pages, `knowledge/index.md`, and `knowledge/log.md` are enforced as Fro-Bot-writable-only on `main`. A CI job (`Check Wiki Authority`, backed by `scripts/check-wiki-authority.ts`) fails any PR that modifies them unless authored by `fro-bot` or `fro-bot[bot]`. This keeps `main` aligned with `data`, which is the authoritative wiki source. The same data-authoritative invariant applies to `metadata/repos.yaml`: it is written only on `data` and promoted to `main` — `main` is never the origin of edits to either the wiki content tree or `repos.yaml` outside of a promotion PR.

For intentional manual edits (correcting a factual error the agent hasn't caught, for example), land the change on `data` and let the existing promotion flow land it on `main`:

```bash
git worktree add ../fro-bot-.github-data data
cd ../fro-bot-.github-data
# edit the wiki page or append a manual-edit log entry
git add knowledge/...
git commit -m "docs(knowledge): <what changed and why>"
git push origin data
```

The `Merge Data Branch` workflow promotes `data → main` on a weekly schedule (or run it immediately via `gh workflow run merge-data.yaml`). The promotion PR is authored by `fro-bot[bot]`, which passes the guard.

This file (`knowledge/schema.md`) and `knowledge/README.md` / `knowledge/wiki/README.md` remain editable through normal PRs to `main` — the guard targets only the agent-authored content tree, not conventions or scaffolding docs.

## Provenance boundary

The promotion gate's attribution check (`scripts/check-wiki-private-presence.ts`) confirms that a slug-matching `wiki/repos/` page declares its public repository in structured `sources[].url` with an exact owner/repo match. This stops decoy-URL mis-attribution, but it trusts the page's own declared sources — it does not independently prove the page body genuinely concerns that repository.

This is a defense-in-depth layer, not the primary provenance control. The real provenance boundary is enforced upstream: every wiki write is authored under Fro Bot's identity, the `data` branch is the sole writer, and the authority guard rejects any other origin. A page can only reach the attribution check by passing through those controls, so there is no path for an untrusted actor to plant a page with forged self-declared sources.

Content-level provenance (cross-checking page body against trusted generator metadata) is intentionally not built. It would add real machinery — the generator would need to emit verifiable provenance the gate could check — for a layer that has no reachable attack given the upstream identity and sole-writer controls. The trade is not worth it today; this note records the residual so the decision is explicit and revisitable if the upstream controls ever weaken.
