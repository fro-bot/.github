---
date: 2026-07-10
topic: web-viewable-wiki
---

# Web-Viewable Knowledge Wiki

## Summary

Publish the Karpathy knowledge wiki as a read-only web digital garden — clickable wikilinks, backlinks, full-text search, and an interactive node-graph — built with Quartz v4 from the `knowledge/wiki/` tree and served from GitHub Pages on this repo. The primary audience is the operator, who today cannot browse the wiki as the connected graph it is; public discoverability is a deliberate secondary upside.

---

## Problem Frame

Fro Bot surveys 25+ repositories into a cross-referenced Karpathy-style wiki (40 pages today across repos, topics, entities, comparisons) that grows on every survey. The wiki is the primary knowledge artifact, and it is designed as a graph: pages cross-reference each other with `[[wikilink]]` syntax, carry structured frontmatter (`title`, `type`, `sources`, `tags`, `related`), and are cataloged in `index.md`.

But no human can browse it as one. On GitHub, wikilinks are inert text, the graph is invisible, `sources` don't resolve to their upstream URLs, and navigating from a repo page to a related topic means manually opening files. The compounding knowledge base is effectively write-only — an agent-internal artifact that the operator can't read as the connected knowledge system it is. The value already exists on disk; the reading surface is missing.

---

## Actors

- A1. Operator (Marcus): browses the rendered wiki to navigate cross-repo knowledge, follow the graph, and search. The primary human audience.
- A2. Public reader: any visitor to the public site. The wiki is public-safe by design, so this actor sees exactly what the operator sees — no privileged view.
- A3. Fro Bot (agent): continues to author wiki content on the `data` branch as today. Unchanged by this work; it is the content producer, not a consumer of the web surface.
- A4. Publish pipeline: the CI workflow that scans, builds, and deploys the site when wiki content lands on `main`.

---

## Key Flows

- F1. Browse and navigate the graph
  - **Trigger:** Operator or public reader opens the site.
  - **Actors:** A1, A2
  - **Steps:** Land on a home/index view organized by page type (repos/topics/entities/comparisons) → open a page → rendered frontmatter shows title, type, tags, sources as clickable upstream links → follow a `[[wikilink]]` to a related page → consult backlinks ("what links here") to move up the graph → open the interactive graph view to see the neighborhood visually.
  - **Outcome:** The reader traverses the connected knowledge base without touching raw markdown or GitHub file navigation.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R8

- F2. Search for a topic
  - **Trigger:** Reader wants a page or concept by keyword.
  - **Actors:** A1, A2
  - **Steps:** Invoke client-side full-text search → matches rank across page titles and body → select a result → land on the page.
  - **Outcome:** Reader reaches relevant knowledge without knowing the slug or browsing the tree.
  - **Covered by:** R7

- F3. Publish on content change
  - **Trigger:** Wiki content lands on `main` (via the weekly `data → main` promotion, or any push touching `knowledge/wiki/`).
  - **Actors:** A4
  - **Steps:** CI runs a whole-tree private-presence scan on the content to be published → on pass, Quartz builds the static site → deploy to GitHub Pages. On scan failure, publish is blocked.
  - **Outcome:** The live site reflects current `main` wiki content; nothing publishes if the safety scan fails.
  - **Covered by:** R9, R10, R11, R12, R13

- F4. Take down content published in error
  - **Trigger:** Operator identifies a page that should not be public (a mistaken publish, or content that needs redaction faster than the next promotion).
  - **Actors:** A1, A4
  - **Steps:** Operator invokes the emergency unpublish path → the page or the whole site is removed from the public surface without waiting for the weekly cadence.
  - **Outcome:** The offending content is off the public site quickly; correction of the source follows the normal `data`-branch path.
  - **Covered by:** R15

---

## Requirements

**Rendering and navigation**
- R1. Render the wiki content tree — `knowledge/wiki/` pages (repos, topics, entities, comparisons) plus `knowledge/index.md` and `knowledge/schema.md` as browsable pages. Do not render `knowledge/log.md`, and do not treat "everything under `knowledge/`" as in scope.
- R2. Resolve `[[wikilink]]` and `[[wikilink|label]]` references to working links between rendered pages, honoring the `{owner}--{repo}` slug convention and frontmatter `aliases`.
- R3. Render page frontmatter as human-readable metadata: title, type, created/updated dates, tags, and `related`.
- R4. Render each page's `sources` as clickable links to the upstream URL (with SHA/accessed context where present).
- R5. Provide a landing/index view organized by the four page types, mirroring the structure of `index.md`.
- R6. Provide backlinks on each page ("what links here"), derived from the inbound wikilink graph.

**Discovery**
- R7. Provide client-side full-text search across page titles and body content.

**Graph**
- R8. Provide an interactive node-graph visualization of the wikilink network, navigable to pages.

**Publishing**
- R9. Build the site with Quartz v4 from the wiki tree on `main`.
- R10. Deploy the built site to GitHub Pages from this repository.
- R11. Rebuild and redeploy when wiki content changes land on `main`; no real-time freshness requirement.

**Publish-time safety**
- R12. Before publishing, run a private-presence scan across the entire published surface — repo, topic, entity, and comparison page bodies, `index.md`/`schema.md`, and the derived search index and graph payload — not only `wiki/repos/`. A scan failure blocks the deploy (fail-closed). This extends the existing `wiki/repos/`-only scan, which does not cover non-repo pages or derived artifacts.
- R13. As part of the publish scan, check `sources[].url` values and block publish if any source URL resolves to a private or internal location.
- R14. Provide a per-page link to the page's source on GitHub, giving a reader who spots an error a route to the existing `data`-branch correction path without a web-edit feature.
- R15. Provide an emergency unpublish path: the operator can take the public site (or a page) down quickly, independent of the weekly promotion cadence, for content published in error.

---

## Acceptance Examples

- AE1. **Covers R12.** Given a private repository name appears in a topic (non-repo) page body, when the publish pipeline runs, the whole-tree scan fails and no deploy occurs — even though the legacy `wiki/repos/`-only scan would have passed it.
- AE2. **Covers R11.** Given the weekly `data → main` promotion lands new wiki pages, when the promotion merges, the site rebuilds and the new pages appear without a manual trigger.
- AE3. **Covers R2, R6.** Given page A contains `[[B]]`, when the site renders, page A links to page B and page B lists page A in its backlinks.
- AE4. **Covers R2.** Given a wikilink targets a page by its alias rather than its slug, when the site renders, the link resolves to the correct page.
- AE5. **Covers R13.** Given a page's `sources[].url` points to a private GitHub URL, when the publish scan runs, the deploy is blocked.
- AE6. **Covers R15.** Given a page was published in error, when the operator invokes the unpublish path, the page is removed from the public site without waiting for the next promotion.

---

## Success Criteria

- The operator can start on any wiki page and reach any connected page by clicking — wikilinks, backlinks, graph, and search all work against the real 40-page corpus.
- The site is live on a public GitHub Pages URL and refreshes when wiki content lands on `main`.
- No private repository identifier ever appears on the published site: the publish pipeline provably blocks on a whole-tree scan (not just repo pages), and there is a fast path to remove content published in error.
- A downstream planner can build the pipeline without inventing content scope, safety behavior, or the render feature set — Quartz's fit against the slug/frontmatter conventions is the one open verification.

---

## Scope Boundaries

### Deferred for later

- Web-based editing of wiki pages from the browser. Editing stays on the existing `data`-branch → promotion path (R14 gives a link to it); a browser-edit flow needs the operator-auth spine (owned by `fro-bot/agent`) and is a separate slice.
- A branded `fro.bot` domain. Ship on the default GitHub Pages URL; the branded domain is a later CNAME, not a rebuild.
- Rendering `knowledge/log.md` — the append-only survey-operation record is high-volume churn and is excluded from the browsable site.

### Outside this product's identity

- An operator-only or authenticated view of the wiki. The wiki is public-safe by design, so there is no privileged content tier to gate; adding auth would contradict the public-only design.
- A second copy or divergent store of the wiki content. The site renders the existing `main` tree; it never becomes an alternate source of truth.
- Real-time or push-based freshness. Freshness follows the existing promotion cadence by design.

---

## Key Decisions

- Read-only render, editing deferred: matches how the north-star splits R3 (the read-only view is spine-independent; the editable path depends on the operator-auth spine). Ships control-plane-native and now. R14's source link keeps "edit deferred" from feeling broken — a reader who spots an error still has a correction route.
- Quartz v4 over a general SSG or a custom build: for the full digital-garden feature set (wikilinks, backlinks, search, graph), Quartz ships these as configuration rather than code we own and maintain.
- Full digital garden including the interactive graph: the wiki's value is the connected graph, and the render should show it. Quartz absorbs the graph as config, so it carries little marginal cost over the rest of the garden; it also doubles as a public showcase of the autonomous-knowledge pipeline.
- GitHub Pages on this repo over the infra Caddy fleet: content is public-safe and read-only, so Pages fits with zero infra and zero cost; a branded domain is a cheap later CNAME.
- The publish-time scan is load-bearing, not belt-and-suspenders: the upstream public-only invariant is strongly enforced only for `wiki/repos/` pages (slug attribution); topic/entity/comparison pages rely on weaker authoring discipline — exactly the pages a crawlable, indexed public render newly exposes. So the pre-publish scan must cover the whole published surface, and it is a real requirement (R12/R13), not an optional guard.
- Publishing widens the exposure model: a public git branch is readable but not indexed or aggregated; GitHub Pages is crawlable, search-indexed, and archive-cached. This is why the safety posture is whole-tree scan (R12) plus a fast takedown path (R15), not just reliance on the repo-level invariant.

---

## Dependencies / Assumptions

- The wiki's public-only invariant (no private repo page, name, or content reaches `knowledge/wiki/`) holds and is enforced at survey dispatch, ingest, and `data → main` promotion — but strongly only for `wiki/repos/` (slug attribution); non-repo pages rely on authoring discipline plus the publish-time scan this work adds.
- The existing private-presence scan (`scripts/check-wiki-private-presence.ts`) covers only `wiki/repos/` and must be extended to the whole published surface for R12 — it is a starting point, not a drop-in.
- The wiki content tree and its `{owner}--{repo}` slug + frontmatter conventions are stable (governed by `knowledge/schema.md`).
- GitHub Pages is available for this repository.
- Quartz v4 is a framework dependency, not a free config layer: it needs a pinned version, an upgrade/ownership policy, and a defined minimal surface so a major bump breaking slug/frontmatter/graph handling stays localized.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Needs research] Does Quartz v4 resolve the `{owner}--{repo}` double-dash slug convention and the custom frontmatter (`type`, `sources[].url`, `aliases`, `related`) cleanly, or is a light content-adapter step needed at build time? Verify current Quartz capabilities via @librarian before committing.
- [Affects R12][Technical] Extend the private-presence scan from `wiki/repos/`-only to the whole published surface (all page bodies, index/schema, and the Quartz-generated search index and graph payload). Reuse vs. rewrite of `scripts/check-wiki-private-presence.ts`.
- [Affects R9, R10, R11][Technical] Where the Quartz project/config lives, whether the build runs against the `main` tree directly or a prepared subset (excluding `log.md`), the Pages deploy mechanism, and how a `data → main` content merge triggers a rebuild.
- [Affects R15][Technical] Emergency unpublish mechanism for GitHub Pages (disable Pages, revert the deploy, or serve a takedown) and its cache-invalidation story.
- [Affects R8][Needs research] Quartz graph-view configuration and whether it needs tuning for a 40-page corpus.
- [Affects R14][Technical] Quartz's git-source/edit-link configuration and pointing it at the correct source path and branch.

---

## Sources / Research

- `knowledge/schema.md` — wiki conventions: page types, frontmatter contract, `{owner}--{repo}` slug rule, `[[wikilink]]` syntax, the public-only invariant (and its explicit note that the promotion gate enforces it for `wiki/repos/` by slug attribution while non-repo areas rely on the in-progress companion content scan and authoring discipline), and the `data`-branch authority/promotion model.
- `knowledge/index.md` — the catalog the type-organized landing view mirrors.
- `scripts/wiki-utils.ts` — existing wikilink extraction, page resolver, and graph-edge helpers (`WIKI_ROOT`, wikilink collection, path/slug/alias resolver).
- `scripts/check-wiki-private-presence.ts` — the existing private-presence scan; covers only `knowledge/wiki/repos/` today and is the starting point for the whole-tree scan R12 requires.
- `.github/workflows/merge-data.yaml` — the `data → main` promotion that gates wiki content onto `main` and its existing private-wiki-page block step.
- `knowledge/wiki/topics/github-pages.md` and the `fro-bot/systematic` Starlight→`gh-pages` cross-repo deploy documented in `knowledge/wiki/topics/opencode-plugins.md` — prior static-site deploy patterns in the org.
- North-star doc `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md` (R3): the read-only view is spine-independent; the editable path depends on R1/the spine.
