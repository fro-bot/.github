---
title: Structured-First Attribution for Public-Allowlist Privacy Gates
date: 2026-06-04
last_updated: 2026-06-04
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
  - legacy pages exist without structured provenance and must not be over-blocked
  - a frontmatter key's PRESENCE (even if malformed) should change the trust decision
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

The wiki-presence gate (`scripts/check-wiki-private-presence.ts`) blocks a `data → main`
promotion when a wiki page's slug collides with a *private* repo's slug, unless the page can be
**attributed** to a *public* repo of the same slug. Attribution originally asked one question:
"does the page body contain `https://github.com/owner/name`?" That substring check is spoofable —
a page about a private repo could embed a decoy URL for a same-slug public repo and pass — and it
collided on prefixes (`.../repo` matched `.../repo-other`). The fix moved attribution to
structured frontmatter `sources[].url` with an exact-segment match, while keeping a body-substring
fallback so legacy pages without structured provenance aren't over-blocked.

## Guidance

### Prefer structured provenance; treat its presence as authoritative

When a page carries structured provenance (frontmatter `sources`), use it as the **sole**
authority and stop consulting the spoofable body substring. The decision hinges on a three-state
read of the key, not a truthy check:

- **key absent** → fall back to the legacy body-substring check (legacy pages pass as before)
- **key present but malformed** (scalar, null, non-array, or array with no usable URLs) → treat as
  **authoritative-with-no-match** → fail closed (block), do *not* rescue via body substring
- **key present with URLs** → authoritative; attribute only if a URL exactly matches

The "present-but-malformed → fail closed" branch is the subtle one: once a producer starts
emitting structured provenance, a *broken* `sources` block must not silently downgrade to the
weaker check, or the spoof vector reopens.

### Match identifiers by exact segments, never substring

Attribute by parsing the URL and comparing path **segments**, not `String.includes`. Require the
exact host, exact owner, and exact repo — allowing only a trailing path (`/blob/...`). Substring
matching admits a prefix collision (`owner/repo` ⊂ `owner/repo-other`) that under-blocks.

### Keep the fallback for legacy data, but only when provenance is truly absent

A hard cutover to structured-only would over-block every page written before the producer emitted
`sources`. Gate the fallback strictly on *absence* of the key — present-but-empty is not absence.

## Why This Matters

Attribution is a trust decision over influenceable content, so every loosening is a leak vector:

- **Substring attribution** lets a page assert false provenance with a decoy URL → a private page
  masquerades as a public one (under-block, the dangerous direction for a privacy gate).
- **Prefix-collision matching** silently attributes a page to the wrong (public) repo.
- **Truthy instead of present/absent** reopens the spoof the moment a `sources` block is malformed.

Each of these was found by review as an *under-block* hole — the gate passing something it should
block. For a privacy gate, the only safe failure direction is over-block (flag a borderline page);
under-block writes a private name to the public branch, which is unrecoverable.

## When to Apply

- A gate classifies influenceable content against an allowlist by "what is this about?"
- A slug or identifier can collide between a sensitive and a non-sensitive entity.
- Structured provenance exists (or can be added) that is stronger than a body mention.
- Legacy content lacks that provenance and must keep passing without weakening new content.
- You are comparing identifiers embedded in URLs or paths — reach for segment equality, not
  substring.

## Examples

### Three-state frontmatter read (presence, not truthiness)

```ts
// scripts/check-wiki-private-presence.ts — parseFrontmatterSources
// null → key ABSENT (legacy fallback); [] → key PRESENT but malformed (authoritative-no-match);
// string[] → key PRESENT with usable URLs.
if (!Object.prototype.hasOwnProperty.call(obj, 'sources')) return null
const sources = obj.sources
if (!Array.isArray(sources)) return []
```

### Exact-segment URL match (no prefix collision, https-only)

```ts
// sourceUrlMatchesRepo — strict host + exact owner/repo segments
if (parsed.protocol !== 'https:') return false
if (parsed.hostname !== 'github.com') return false
// segments[0] === owner && segments[1] === name (trailing /blob/... allowed)
```

### Structured-first decision with legacy fallback

```ts
// detectPrivateWikiLeaks
const structuredSources = parseFrontmatterSources(page.content)
if (structuredSources !== null) {
  // Structured sources present → authoritative. Body substring deliberately ignored
  // (closes the decoy-URL spoof). Present-but-unmatched → unattributable (fail closed).
  if (structuredSources.some(url => sourceUrlMatchesRepo(url, entry.owner, entry.name))) {
    // attributed → passes
  } else {
    leaks.push({filename: page.filename, reason: 'unattributable-page'})
  }
} else {
  // No parseable structured sources → legacy body-substring fallback (with migration warning).
  if (page.content.includes(expectedUrl)) {
    // attributed via body substring → passes, warn to add structured sources
  } else {
    leaks.push({filename: page.filename, reason: 'unattributable-page'})
  }
}
```

## Related

- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` — the
  companion promotion-diff gate; same fail-closed-under-uncertainty principle, different surface
  (content scan vs slug attribution).
- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — the
  fail-closed-on-unknown predicate this attribution model extends.
- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — verifying
  privacy inside the trusted workflow before a public side effect.
- Issues: #3419 (this refresh), #3408 (operator-actionable blocked output), #3418 (self-asserted
  provenance residual — a page lying about its own `sources` is bounded by agent identity + data
  sole-writer, not closeable at this attribution layer).
