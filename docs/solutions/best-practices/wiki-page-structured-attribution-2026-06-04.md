---
title: Structured-First Attribution for Public-Allowlist Privacy Gates
date: 2026-06-04
last_updated: 2026-11-12
verified: 2026-06-04
category: best-practices
module: github-workflows
problem_type: best_practice
component: development_workflow
severity: high
related_components:
  - tooling
  - documentation
applies_when:
  - a gate decides whether a page is "about" an allowlisted public entity by its content
  - page content is attacker-or-agent-influenceable and a slug can collide with a private name
  - frontmatter carries structured provenance that is stronger than a body substring
  - a page without readable provenance must be blocked, not judged by a weaker test
  - several readers find the frontmatter block, and a page can hide its real provenance from one of them
tags:
  - privacy-gate
  - attribution
  - fail-closed
  - frontmatter
  - spoofing
  - wiki
  - allowlist
  - url-matching
---

# Structured-First Attribution for Public-Allowlist Privacy Gates

## Context

The wiki-presence gate (`packages/privacy/src/check-wiki-private-presence.ts`) blocks a `data → main`
promotion when a wiki page's slug collides with a *private* repo's slug, unless the page can be
**attributed** to a *public* repo of the same slug. Attribution originally asked one question:
"does the page body contain `https://github.com/owner/name`?" That substring check is spoofable —
a page about a private repo could embed a decoy URL for a same-slug public repo and pass — and it
collided on prefixes (`.../repo` matched `.../repo-other`). The first fix moved attribution to
structured frontmatter `sources[].url` with an exact-segment match, but kept the body substring as
a fallback for pages without structured provenance. That fallback was the remaining route: every
way a page could make its real `sources` unreadable (no block, a block that is never closed, invalid
YAML, a block that is not a mapping, a `---x` or `----` line that ends the block early, a mapping
with no `sources` key) fell through to the body check, so a decoy URL in the body passed it. A
per-parser-error patch of the fallback (#4185) was closed after its review reproduced the decoy route
again. The fallback is gone: the gate now requires a valid block with a matching source.

## Guidance

### Structured provenance is the only authority

A public repo page passes only when its frontmatter block is valid, parses as a YAML mapping, and
its `sources` has a URL that matches the repository. Every other state is one result:

- **no block, a block that is never closed, invalid YAML, a non-mapping** → blocked, `unattributable-page`
- **a mapping with no `sources` key, or `sources` that is not an array, or an array with no usable URLs** →
  blocked, `unattributable-page`
- **`sources` with URLs, none of which match** → blocked, `unattributable-page`
- **`sources` with a URL that exactly matches** → passes, whatever the body says

There is no state that selects a weaker test. A fallback keyed on "the provenance could not be read"
is a route for an attacker to make it unreadable, and each new unreadable shape needs its own patch.
Removing the fallback closes the whole class, so the gate needs no rule written for any one shape.

The body is never read, and the gate prints no page text and no parser message: a blocked page is
reported by its fixed reason code only.

### One splitter decides where the block is

The gate finds the block with the shared `splitFrontmatterBlock` from `@fro.bot/wiki-write-core`
(through `parseFrontmatterDocument`), not with its own regex. A copy of the block regex that ends the
block at the first line starting with `---` lets `---x: y` hide the keys after it from the reader that
matters. When a security decision reads a structure that other code also reads, give them one reader.

### Match identifiers by exact segments, never substring

Attribute by parsing the URL and comparing path **segments**, not `String.includes`. Require the
exact host, exact owner, and exact repo — allowing only a trailing path (`/blob/...`). Substring
matching admits a prefix collision (`owner/repo` ⊂ `owner/repo-other`) that under-blocks.

### Make the writer produce what the gate requires

A gate that requires a field needs a writer that supplies it, or the first strict run blocks real
pages. The ingest adds the target repository's URL to the target's page when that page lists no
sources, so a surveyed public repo page carries its own attribution. A page that lists sources is never
changed by the writer, and a page whose sources do not match stays blocked.

## Why This Matters

Attribution is a trust decision over influenceable content, so every loosening is a leak vector:

- **Substring attribution** lets a page assert false provenance with a decoy URL → a private page
  masquerades as a public one (under-block, the dangerous direction for a privacy gate).
- **Prefix-collision matching** silently attributes a page to the wrong (public) repo.
- **A fallback for unreadable provenance** reopens the spoof the moment a page can be shaped so its
  `sources` are not read.

Each of these was found by review as an *under-block* hole — the gate passing something it should
block. For a privacy gate, the only safe failure direction is over-block (flag a borderline page);
under-block writes a private name to the public branch, which is unrecoverable.

## When to Apply

- A gate classifies influenceable content against an allowlist by "what is this about?"
- A slug or identifier can collide between a sensitive and a non-sensitive entity.
- Structured provenance exists (or can be added) that is stronger than a body mention.
- The writer can be changed to supply the provenance, so no legacy content needs a weaker path.
- You are comparing identifiers embedded in URLs or paths — reach for segment equality, not
  substring.

## Examples

### Reading the sources of a page: unreadable is not a state of its own

```ts
// packages/privacy/src/check-wiki-private-presence.ts — parseFrontmatterSources
// null → the block cannot be read (none, unclosed, invalid YAML, not a mapping); the error is dropped
// [] → a mapping with no usable `sources`; string[] → the URLs it lists.
try {
  values = parseFrontmatterDocument(content).values
} catch {
  return null
}
const sources = values.sources
if (!Array.isArray(sources)) return []
```

### Exact-segment URL match (no prefix collision, https-only)

```ts
// sourceUrlMatchesRepo — strict host + exact owner/repo segments
if (parsed.protocol !== 'https:') return false
if (parsed.hostname !== 'github.com') return false
// segments[0] === owner && segments[1] === name (trailing /blob/... allowed)
```

### Structured-only decision

<!-- verify: parseFrontmatterSources from packages/privacy/src/check-wiki-private-presence.ts -->
<!-- verify: sourceUrlMatchesRepo from packages/privacy/src/check-wiki-private-presence.ts -->
```ts
// detectPrivateWikiLeaks
const sources = parseFrontmatterSources(page.content)
if (sources !== null && sources.some(url => sourceUrlMatchesRepo(url, entry.owner, entry.name))) {
  // attributed → passes, whatever the body says
} else {
  // no readable block, no sources key, or no matching URL → blocked. The body is not consulted.
  leaks.push({filename: page.filename, reason: 'unattributable-page'})
}
```

## Related

- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` — the
  companion promotion-diff gate; same fail-closed-under-uncertainty principle, different surface
  (content scan vs slug attribution). See also its "See also — privacy-gate correctness patterns"
  index for the full cluster of gate docs.
- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — the
  fail-closed-on-unknown predicate this attribution model extends.
- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — verifying
  privacy inside the trusted workflow before a public side effect.
- `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md` —
  cites this doc's structured-provenance-over-body-text pattern.
- `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md`
  — cites this doc's structured-metadata-over-body-text pattern.
- `docs/plans/2026-11-12-001-refactor-shared-frontmatter-splitter-plan.md` — the plan that replaced
  the copied block regexes with one splitter and removed the fallback.
- Issues: #3419 (this refresh), #3408 (operator-actionable blocked output), #3418 (self-asserted
  provenance residual — a page lying about its own `sources` is bounded by agent identity + data
  sole-writer, not closeable at this attribution layer), #4148 (the shared splitter), closed #4185
  (the per-copy patch).
