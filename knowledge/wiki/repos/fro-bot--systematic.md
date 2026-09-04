---
type: repo
title: fro-bot/systematic
created: 2026-05-07
updated: 2026-09-04
node_id: R_kgDORLx6ew
sources:
  - url: https://github.com/fro-bot/systematic
    sha: 73fa108
    accessed: 2026-05-07
  - url: https://github.com/fro-bot/systematic
    sha: 12cae87
    accessed: 2026-05-22
  - url: https://github.com/fro-bot/systematic
    sha: 33cc55a
    accessed: 2026-06-04
  - url: https://github.com/fro-bot/systematic
    sha: 28400b1
    accessed: 2026-06-14
  - url: https://github.com/fro-bot/systematic
    sha: e75ddeb
    accessed: 2026-06-25
  - url: https://github.com/fro-bot/systematic
    sha: c712560
    accessed: 2026-07-08
  - url: https://github.com/fro-bot/systematic
    sha: 8395976
    accessed: 2026-07-22
  - url: https://github.com/fro-bot/systematic
    sha: 1938bb1
    accessed: 2026-08-06
  - url: https://github.com/fro-bot/systematic
    sha: a40e544
    accessed: 2026-08-21
  - url: https://github.com/fro-bot/systematic
    sha: 8e26a01
    accessed: 2026-09-04
tags:
  - documentation
  - github-pages
  - astro
  - starlight
  - opencode
  - plugin
  - ocx
  - json-schema
  - renovate
  - semantic-release
  - conventional-commits
related:
  - marcusrbrown--systematic
  - marcusrbrown--dotfiles
---

# fro-bot/systematic

Documentation deployment target for [[marcusrbrown--systematic]]. Hosts the Starlight/Astro docs site for the `@fro.bot/systematic` OpenCode plugin at **https://fro.bot/systematic/**.

## Overview

| Attribute       | Value                                                |
| --------------- | ---------------------------------------------------- |
| Created         | 2026-02-09                                           |
| Repo id         | `1153202811` (`node_id` `R_kgDORLx6ew`)              |
| Last push       | 2026-08-25T08:00:31Z — **10 days before the 2026-09-04 survey** (prior: 2026-08-20) |
| Default branch  | `gh-pages`                                           |
| Language        | HTML (static build output)                           |
| License         | None specified                                       |
| Stars           | 0 (forks 0)                                          |
| Open issues     | 2 (#1, #3); 0 open PRs (unchanged 2026-09-04; #3 now ~10 weeks stale, #1 ~6 months) |
| Pages URL       | https://fro.bot/systematic/                          |
| Visibility      | Public                                               |
| Description     | "Documentation site for @marcusrbrown/systematic" (added since the 2026-05-22 survey; the repo previously carried no description) |

## Purpose

This repo is **not a fork** of `marcusrbrown/systematic`. It is a standalone repository whose sole purpose is to receive automated documentation deployments from the source repo. The `gh-pages` branch is the default (and only substantive) branch — there is no application source code here.

Every commit is authored by `fro-bot[bot]` with messages in the format:

```
Deploy docs from marcusrbrown/systematic@<sha>
```

The deploy workflow lives in `marcusrbrown/systematic` (the `docs.yaml` workflow). This repo is simply the push target.

**Correction 2026-09-04 — the fan-out is release-gated, not push-gated.** Earlier records here hedged between "fans out per merge" and "fan-out-per-release." The 2026-09-04 interval settles it with a clean natural experiment: between the last deploy's source commit (`c5273ee8`, 2026-08-25T07:58:24Z) and source `main` HEAD `4cea0620` (2026-09-03T01:17:27Z) there are **16 commits and zero deploys**. All sixteen are non-releasable conventional-commit types — one `docs(solutions):` and fifteen `chore(deps)`/`chore(dev)` Renovate automerges. No `feat:`/`fix:` means no semantic-release publish, and no publish means no deploy. Every one of the 15 deploys in this interval maps 1:1 onto an npm publish (see [Deploy Cadence](#deploy-cadence)). The gate is the release, not the merge.

This matters for reading the repo's staleness. A `gh-pages` HEAD that has not moved in 10 days is, here, **the correct output of a healthy pipeline** — a truthful signal that nothing user-visible shipped — not the frozen-tree-hiding-a-dead-daemon pattern recorded at [[bfra-me--ha-addon-repository]] and [[marcusrbrown--cortexkit-anthropic-auth]]. Distinguishing the two costs one API call: check the producer's **release** feed, not its `pushed_at`. Source `pushed_at` was `2026-09-04T08:42:40Z` (same day as this survey, from open PR branches) while its last release was `v3.15.0` on 2026-08-25 — reading `pushed_at` alone would have reported an active upstream and made this deploy target look broken.

## Contents

The `gh-pages` branch contains the built Starlight/Astro static site:

- `index.html` — Landing page
- `404.html` — Starlight not-found page (added 2026-05-22 survey)
- `favicon.svg` — Site favicon (new since the 2026-05-22 survey)
- `_astro/` — Bundled CSS, JS, and image assets
- `components/` — OCX component pages (one per agent/skill)
- `getting-started/` — Getting started guides
- `guides/` — Philosophy, main loop, agent install, conversion guides
- `privacy/` — Privacy policy page (`privacy/index.html`, new since the 2026-05-22 survey)
- `reference/` — Generated reference pages for skills and agents
- `schemas/` — Hosted JSON Schemas for the user config file (added 2026-05-22 survey)
- `pagefind/` — Client-side search index
- `.well-known/ocx.json` — OCX registry pointer (`{"version":1,"registry":"/systematic/index.json"}`)
- `index.json` — OCX component registry for `ocx` CLI installation
- `og-image.png` — Open Graph share image
- `.nojekyll` — Disables Jekyll processing
- `sitemap-index.xml`, `sitemap-0.xml` — Sitemap for search engines

## OCX Registry

The `.well-known/ocx.json` file points to the OCX component registry at `/systematic/index.json`. This enables the `ocx` CLI to discover and install individual skills and agents from the documentation site URL. The registry uses V2 schema (since `@fro.bot/systematic` v2.6.0).

### 2026-09-04 survey — registry current at v3.12.4 → v3.15.0; burst-then-drought, and the mirror is provably faithful

No structural change. The tree, the OCX pointer, the component count, and the schema property set are all unmoved. What this interval adds is **measurement precision on the deploy contract itself**, obtained because the pipeline went quiet long enough to test.

- **`index.json` advertises v3.15.0** (up from v3.12.4), matching npm `dist-tags.latest` = `3.15.0` (published 2026-08-25T07:59:53Z). Tenth consecutive survey where the registry version equals `latest`; the mirror invariant holds without exception.
- **Component count flat at 73** for the **fourth consecutive survey** — unchanged since the v3 major boundary on 2026-07-22, now ~6 weeks. Breakdown identical: 37 agents, 31 skills, 2 bundles, 2 profiles, 1 plugin. Namespace (`systematic`), name (`Systematic`), author (`Marcus R. Brown <human@fro.bot>`) stable. Registry component ids remain type-prefixed (`agent-correctness-reviewer`, etc.).
- **Config schema property set flat at 10** — second consecutive non-mutating interval, but see [Schema unchanged 2026-09-04](#schema-unchanged-2026-09-04) for why "unchanged" is a weaker claim than it reads.
- `.well-known/ocx.json` unchanged (`{"version":1,"registry":"/systematic/index.json"}`). Root tree unchanged; still no `.github/` after 15 more deploys.
- **HEAD `8e26a01`, 2026-08-25T08:00:30Z — frozen 10 days.** Not a fault; see the [correction under Purpose](#purpose). Thirty-one npm publishes landed 2026-08-13 → 08-25, then the release train stopped because the upstream interval contained only `docs:`/`chore:` commits.

**Cross-artifact consistency check (new this survey).** The registry and the hosted config schema are emitted by the same build from the same commit, so they can be diffed against each other. They agree: the schema's `agents` object enumerates exactly **37 bare agent names**, matching the registry's 37 `agent` components one for one, plus 37 `category/name` qualified aliases (74 keys total). No drift. This is the first time the two published artifacts have been cross-checked rather than tracked independently — worth repeating each survey, since a mismatch would mean the catalog and the IDE contract disagree about what exists.

### 2026-08-21 survey — steady v3 minor train (v3.6.0 → v3.12.4); config schema held flat

No structural change. Fourth consecutive survey confirming the two-axis pattern — but this interval the axes moved in the opposite way from the last three: **the OCX catalog version advanced while the config schema stayed frozen.** HEAD is a docs deploy (`a40e544`, 2026-08-20 01:16, source `f615006`) — the **v3.12.4** release, published 2026-08-20 01:15 and deployed ~1 min later, holding the fan-out-per-release rhythm.

- **`index.json` advertises v3.12.4** (up from v3.6.0), matching the latest source release ([[marcusrbrown--systematic]] `dist-tags.latest` = 3.12.4).
- **Component count is flat at 73** — unchanged since the v3 contraction settled at the major boundary. Breakdown identical: 37 agents, 31 skills, 2 bundles, 2 profiles, 1 plugin. Namespace (`systematic`), name (`Systematic`), and author (`Marcus R. Brown <human@fro.bot>`) stable.
- **Config schema property set is flat at 10** — no additions this interval (see [Schema unchanged 2026-08-21](#schema-unchanged-2026-08-21)). This breaks the three-in-a-row streak of in-place schema mutations; the additive churn (`skills_as_commands` → v3 rebase → `pi_subagents`/`workflow_guard`) has paused while the catalog kept shipping minors.
- `.well-known/ocx.json` unchanged (`{"version":1,"registry":"/systematic/index.json"}`).

**Off-branch note (npm, not this deploy target):** a **`2.33.4`** was published to npm 2026-08-18 22:11 — a backport/patch on the retired v2 line — but `dist-tags.latest` remained **3.12.4** and this repo only ever mirrors `latest`, so the v2 patch never fanned out here. The corresponding source SHA (`ecb4750`) does have a deploy (`37cc26c`, 2026-08-18 22:12), but the registry it published still advertised the v3 line. The v2 URL path stays 404 (see below); the v2 npm patch does not resurrect the v2 schema host.

### 2026-08-06 survey — steady v3 patch train (v3.2.5 → v3.6.0)

No structural change. The v3 line advanced cleanly along its minor/patch train and the deploy target mirrored it faithfully, as it has every survey. HEAD is a docs deploy (`1938bb1`, 2026-08-04 16:41, source `83dfacd`) — the **v3.6.0** release, published 2026-08-04 16:40 and deployed ~1 min later, holding the fan-out-per-release rhythm.

- **`index.json` advertises v3.6.0** (up from v3.2.5), matching the latest source release ([[marcusrbrown--systematic]] v3.6.0).
- **Component count is flat at 73** — the v3 contraction settled at the major boundary and has not moved since. Breakdown unchanged: 37 agents, 31 skills, 2 bundles, 2 profiles, 1 plugin. Namespace (`systematic`), name (`Systematic`), and author (`Marcus R. Brown <human@fro.bot>`) stable.
- `.well-known/ocx.json` unchanged (`{"version":1,"registry":"/systematic/index.json"}`).

The one durable delta this interval is on the **user-config schema, not the catalog** — the property set grew 8 → 10 (see [Schema property changes observed 2026-08-06](#schema-property-changes-observed-2026-08-06-pi_subagents-workflow_guard)). Confirms the pattern from the v2 line: minor releases evolve the config surface additively while the OCX catalog stays frozen between majors.

### 2026-07-22 survey — v2 → v3 major crossing

The source plugin ([[marcusrbrown--systematic]]) crossed the **v2 → v3 major boundary**, and it propagated cleanly to this deploy target. As of the 2026-07-22 survey (HEAD `8395976`, source `ab42f8a`):

- **`index.json` advertises v3.2.5** (up from v2.33.2), matching the latest source release (v3.2.5, published 2026-07-22 01:01; deployed 01:03 — ~2 min lag, the same fan-out-per-release rhythm).
- **Component count dropped 104 → 73** — the first *contraction* since surveys began (every prior interval was flat or additive). The major bump pruned the catalog rather than growing it.

| Type      | 2026-07-08 (v2.33.2) | 2026-07-22 (v3.2.5) | Δ    |
| --------- | -------------------- | ------------------- | ---- |
| `agent`   | 51                   | 37                  | −14  |
| `skill`   | 48                   | 31                  | −17  |
| `bundle`  | 2                    | 2                   | 0    |
| `profile` | 2                    | 2                   | 0    |
| `plugin`  | 1                    | 1                   | 0    |
| **total** | **104**              | **73**              | **−31** |

Namespace (`systematic`), name (`Systematic`), and author (`Marcus R. Brown <human@fro.bot>`) are all stable. The −31 agent+skill contraction is a source-side curation event in [[marcusrbrown--systematic]]; the deploy target is a faithful mirror and simply reflects it. `.well-known/ocx.json` is unchanged (`{"version":1,"registry":"/systematic/index.json"}`).

As of the 2026-07-08 survey, `index.json` advertised **v2.33.2** (up from v2.32.0 at the 2026-06-25 survey), still matching the latest source release (v2.33.2, published 2026-07-07 10:41; deployed 10:43). The 104-component breakdown is **unchanged** — 51 agents, 48 skills, 2 bundles, 2 profiles, 1 plugin. Namespace (`systematic`), name (`Systematic`), and author (`Marcus R. Brown <human@fro.bot>`) are all stable. The figures below still describe the current component split.

As of the 2026-06-25 survey, `index.json` was **unchanged** from the 2026-06-14 survey — same version, namespace, author, and 104-component breakdown. The figures below still hold.

As of the 2026-06-14 survey, `index.json` advertises:

| Field        | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| `name`       | `Systematic`                                                 |
| `namespace`  | `systematic`                                                 |
| `version`    | `2.31.0` (up from v2.24.0 at the 2026-06-04 survey — see [[marcusrbrown--systematic]] for source-side release history; this still matches the latest source release, which is now v2.31.0, published 2026-06-07) |
| `author`     | `Marcus R. Brown <human@fro.bot>`                            |
| `components` | 104 total                                                    |

Component breakdown (2026-06-14 survey):

| Type      | Count |
| --------- | ----- |
| `agent`   | 51    |
| `skill`   | 48    |
| `bundle`  | 2     |
| `profile` | 2     |
| `plugin`  | 1     |

The `bundle` and `profile` types (V2 registry capabilities) were new in the 2026-05-22 survey. The v2.24.0 → v2.31.0 advance added exactly one component: skill count rose 47 → 48 (agents, bundles, profiles, and the single plugin are unchanged). The 48 skills now published: `agent-browser`, `agent-native-architecture`, `agent-native-audit`, `andrew-kane-gem-writer`, `ce-brainstorm`, `ce-compound`, `ce-compound-refresh`, `ce-ideate`, `ce-plan`, `ce-review`, `ce-work`, `changelog`, `claude-permissions-optimizer`, `compound-docs`, `deepen-plan`, `deploy-docs`, `dhh-rails-style`, `document-review`, `dspy-ruby`, `every-style-editor`, `feature-video`, `frontend-design`, `gemini-imagegen`, `generate-command`, `git-clean-gone-branches`, `git-commit`, `git-commit-push-pr`, `git-worktree`, `lfg`, `onboarding`, `orchestrating-subagents`, `orchestrating-swarms`, `proof`, `rclone`, `report-bug-ce`, `reproduce-bug`, `resolve-pr-feedback`, `setup`, `slfg`, `test-browser`, `test-driven-development`, `test-xcode`, `todo-create`, `todo-resolve`, `todo-triage`, `using-systematic`, `writing-skills`, `writing-systematic-skills`.

## Hosted JSON Schemas

The `schemas/` tree appeared on `gh-pages` between the 2026-05-07 survey and now. As of the 2026-09-04 survey, two URLs are served, still on the **v3 major path** (`schemas/v2/` and `schemas/v4/` both return HTTP 404 — v3 remains the only served major, fifth consecutive confirmation):

- `https://fro.bot/systematic/schemas/latest/systematic-config.schema.json`
- `https://fro.bot/systematic/schemas/v3/systematic-config.schema.json`

Both are draft-07 JSON Schemas matching the `systematic.json` config shape consumed by `marcusrbrown/systematic`'s `config-handler.ts`. `latest` remains byte-equivalent to `v3` (its `$id` points at the v3 URL).

### Schema unchanged 2026-09-04

The top-level property set is **unchanged at ten** on both `latest` and `v3` — no additions or removals since 2026-08-06, now the second consecutive non-mutating interval:

`$schema`, `agents`, `bootstrap`, `categories`, `disabled_agents`, `disabled_commands`, `disabled_skills`, `pi_subagents`, `skills_as_commands`, `workflow_guard`.

Declaration order in the served file is `$schema, agents, categories, disabled_skills, disabled_agents, disabled_commands, bootstrap, workflow_guard, pi_subagents, skills_as_commands`. All other surveyed surface is stable: draft-07, `$id` hard-pinned at the v3 URL on both files, `latest` ≡ `v3`, no top-level `title`, description `Systematic user configuration file (systematic.json / systematic.jsonc)`, `additionalProperties: false` at the root.

**Refinement: "the schema is unchanged" has been measuring the wrong thing.** Four surveys have tracked this schema by counting top-level properties. That metric is nearly blind. The served file is **38,180 bytes with 74 `definitions` entries**, and its `agents` property is a *closed enumeration of the entire bundled agent roster* (`additionalProperties: false`, 74 explicit keys = 37 bare + 37 `category/name`). Adding or removing a single agent upstream rewrites the schema body while leaving the top-level count at ten — so three of the four "schema frozen" readings on this page are claims about a header, not about content.

The two-axis model still holds at the level it was stated (catalog version and top-level config surface do move independently), but the axes are not orthogonal underneath: **the schema's nested agent enumeration is a mirror of the catalog.** Fixed baseline for future surveys, so nested mutation becomes detectable:

| Fingerprint (v3, 2026-09-04) | Value |
| ---------------------------- | ----- |
| Bytes                        | 38,180 |
| SHA-256 (first 16 hex)       | `0e82797b9f8f43ed` |
| `definitions` entries        | 74 |
| `agents` enumerated keys     | 74 (37 bare + 37 qualified) |
| Top-level properties         | 10 |

**Asymmetric strictness — `agents` is closed, `categories` is open.** `agents` names every valid key and rejects the rest; `categories` is `{propertyNames: {type: string}, additionalProperties: <overlay>}` — any string is a valid category name. The bundled categories are real and finite (`review`, `research`, `design`, `document-review`, … ; [[marcusrbrown--dotfiles]] recorded a `workflow` category arriving in 3.15.0), but none of them appear in the schema. Consequence for a user editing `systematic.json`: **misspell an agent and the editor underlines it; misspell a category and the editor is silent and the overlay does nothing.** The failure that costs more to debug is the one the schema declines to catch. Generalized in [[opencode-plugins]].

**Non-standard `trust` keyword.** The schema carries 16 occurrences of a `"trust"` keyword with values `any` and `project-or-higher`, attached to fields such as `model`, `temperature`, `top_p`, and per-agent `skills`. Draft-07 validators ignore unknown keywords, so this annotation is inert for every consumer except Systematic's own loader — it is not enforced, not surfaced in IDEs, and not visible to anyone reading the schema through a validator. The naming strongly implies a config-source trust tier (which fields a project-level file may set versus which require user-level config); that reading is inference, not something the schema states. Either way it is a semantically load-bearing distinction published through a channel that no standard tool reads. Also generalized in [[opencode-plugins]].

The schema host is still **v3-only** — `schemas/v2/` and `schemas/v4/` both return HTTP 404 (re-confirmed).

### Schema unchanged 2026-08-21

As of the 2026-08-21 survey the top-level property set is **unchanged at ten** on both `latest` and `v3` — no additions or removals since 2026-08-06:

`$schema`, `agents`, `bootstrap`, `categories`, `disabled_agents`, `disabled_commands`, `disabled_skills`, `pi_subagents`, `skills_as_commands`, `workflow_guard`.

All other schema surface is stable: draft-07 `$schema`, `$id` hard-pinned at the v3 URL on both files, no top-level `title`, description `Systematic user configuration file (systematic.json / systematic.jsonc)`, `latest` ≡ v3. The schema host is still **v3-only** — `schemas/v2/` and `schemas/v4/` both return HTTP 404 (re-confirmed this survey; the 2026-08-18 npm `2.33.4` v2 backport did **not** re-serve the v2 schema path).

This is the **first interval since 2026-06-25 where the config schema did not mutate.** The prior three surveys each recorded an additive field change under the current major URL; this one records a hold. The two-axis model still applies — the catalog version advanced v3.6.0 → v3.12.4 while the schema surface stayed put — but the specific pairing inverted: last three intervals it was "catalog frozen, schema grows"; here it is "catalog grows, schema frozen."

### Schema property changes observed 2026-08-06 (`pi_subagents`, `workflow_guard`)

The top-level property set **grew from eight to ten** on both `latest` and `v3` — two additive fields since the 2026-07-22 survey:

- **`pi_subagents`** — surfaces a source-side capability in [[marcusrbrown--systematic]] to route subagents through Pi.
- **`workflow_guard`** — a config knob for the guarded-workflow control surface (the same guard machinery that gates unit/epoch completion in the systematic runtime).

The full set is now: `$schema`, `agents`, `bootstrap`, `categories`, `disabled_agents`, `disabled_commands`, `disabled_skills`, `pi_subagents`, `skills_as_commands`, `workflow_guard`. Both additions are optional and backward-compatible; all other schema surface is stable (draft-07 `$schema`, `$id` hard-pinned at the v3 URL on both files, no top-level `title`, description `Systematic user configuration file (systematic.json / systematic.jsonc)`).

This is the **third consecutive interval where the user-config schema mutated in place under the current major URL** (`skills_as_commands` at 2026-07-08, then the v3 rebasing at 2026-07-22, now `pi_subagents`/`workflow_guard`). The established precedent holds: the `vN/` path mutates additively within a major and is replaced wholesale at the next major. Consumers pinned to `schemas/v3/` will see the two new optional properties with no error; consumers who pinned the now-dead `schemas/v2/` are still broken.

The top-level property set was **eight** through the v2 → v3 crossing (`$schema`, `agents`, `bootstrap`, `categories`, `disabled_agents`, `disabled_commands`, `disabled_skills`, `skills_as_commands`) — the major bump reshaped the plugin catalog, not the user-config surface. As of the **2026-08-06 survey it is ten**: the v3 minor train added `pi_subagents` and `workflow_guard` additively (see [Schema property changes observed 2026-08-06](#schema-property-changes-observed-2026-08-06-pi_subagents-workflow_guard)).

### Schema shape changes observed 2026-07-22 — **v2 URL removed (breaking)**

The predicted major-version event fired. The 2026-07-08 record warned: *"if a v3 ever ships, a `latest` whose `$id` is hard-pinned to v2 would mis-advertise its own identity. Worth re-checking at the next major."* v3 shipped, and the schema host reshaped:

- **`schemas/v2/systematic-config.schema.json` now returns HTTP 404.** The `v2/` directory is gone from the `gh-pages` tree entirely; `schemas/` now contains only `latest/` and `v3/`.
- **`schemas/v3/systematic-config.schema.json` serves** with `$id` hard-pinned at the v3 URL, draft-07, no top-level `title`, `description` = `Systematic user configuration file (systematic.json / systematic.jsonc)`.
- **`schemas/latest/` is byte-equivalent to v3**: its `$id` now points at the v3 URL (same latest-≡-current pattern seen at v2), same description, same eight-property set.

**This is a breaking change for any consumer pinned to `schemas/v2/`.** The prior survey flagged this exact risk ("treat it like a public API"). The build does not keep old major paths around — when the source majored to v3, the v2 schema path was dropped rather than frozen. Editors and tools that pinned `$schema` to the v2 URL will now fail to resolve it (silent loss of autocomplete/validation, no error surfaced to the user). The precedent is now confirmed: **major versions replace the path wholesale; they do not co-serve.** A consumer wanting stability should pin `latest/` (which floats) or accept that `vN/` paths are dropped at the next major.

### Schema shape changes observed 2026-07-08

As of the 2026-07-08 survey the top-level property set was: `$schema`, `agents`, `bootstrap`, `categories`, `disabled_agents`, `disabled_commands`, `disabled_skills`, `skills_as_commands` — **eight** properties (a **new field** `skills_as_commands` since 2026-06-25; every survey before that recorded seven). At that survey the served paths were `schemas/latest/` and `schemas/v2/`.

The schema's own `$schema` property is documented as informational only — the loader does not fetch or validate against it. Its purpose is to flip on field-level autocomplete in VSCode, Zed, IntelliJ, and any other editor that resolves `$schema` URLs.

Consequence: this deployment target is no longer purely a docs site. It is also a schema host — but **not a stable one across majors.** As the 2026-07-22 survey confirmed, breaking the URL shape of `schemas/vN/systematic-config.schema.json` at a major bump silently breaks IDE autocomplete in every consumer that pinned the old `vN` URL. Treat it like a public API that reserves the right to drop old major paths.

### Schema property change observed 2026-07-08 (`skills_as_commands`)

One additive change since the 2026-06-25 survey, on **both** `latest` and `v2`:

- **New top-level property `skills_as_commands`.** The property set grew from seven to eight (`$schema/agents/bootstrap/categories/disabled_agents/disabled_commands/disabled_skills` → same plus `skills_as_commands`). This tracks a source-side config capability in [[marcusrbrown--systematic]] — a knob to surface skills as invokable commands. All other schema surface is stable: draft-07 `$schema`, `$id` still hard-pinned at the v2 URL on both files (latest ≡ v2), no top-level `title`, same `description` (`Systematic user configuration file (systematic.json / systematic.jsonc)`).

This contradicts the 2026-06-25 record that the schema was byte-stable; that survey's snapshot was accurate for its interval, but the field set is no longer frozen. The "treat it like a public API" warning below now has teeth: consumers pinned to `schemas/v2/` will see the new optional property, which is additive and backward-compatible — but the precedent is that v2 mutates in place rather than versioning up. A breaking change under the same URL would silently propagate.

As of the 2026-06-25 survey, both schemas were **byte-stable** vs. 2026-06-14: `latest` and `v2` were identical (same draft-07 `$schema`, same `$id` hard-pinned at the v2 URL, no top-level `title`, same `description`, same seven-property set). That held for that interval.

### Schema shape changes observed 2026-06-14

Two changes since the 2026-06-04 survey, both contradicting prior recorded facts:

1. **Human-readable label moved from `title` to `description`.** The 2026-06-04 survey recorded both schemas as *titled* `Systematic user configuration file (systematic.json / systematic.jsonc)`. As of 2026-06-14, neither schema carries a top-level `title` key at all; that exact string is now the top-level `description`. The label content is identical — only the JSON key changed (`title` → `description`).
2. **`schemas/latest/` now serves a `$id` pointing at the v2 URL.** The `latest` schema's `$id` is now `https://fro.bot/systematic/schemas/v2/systematic-config.schema.json` — identical to the v2 file. Previously the `latest` variant was understood to carry its own `latest` URL as `$id`. Practically, `latest` and `v2` are now byte-equivalent on the fields surveyed (same `$id`, same `description`, same property set), so the two paths currently resolve to the same canonical reference. This is benign while v2 is the only major, but if a v3 ever ships, a `latest` whose `$id` is hard-pinned to v2 would mis-advertise its own identity. Worth re-checking at the next major.

## Branches

As of 2026-08-21, only one branch remains (unchanged since 2026-07-08):

| Branch               | Purpose                              |
| -------------------- | ------------------------------------ |
| `gh-pages` (default) | Built documentation site (build output only) |

The `renovate/configure` branch documented at the 2026-06-14 survey is gone: PR #2 **merged** on 2026-06-24 and the branch was deleted. See [Renovate](#renovate).

**Update 2026-07-08:** the `.github/renovate.json5` that PR #2 merged onto `gh-pages` has been **wiped by the docs build** — exactly the outcome the 2026-06-25 survey flagged as "worth watching." HEAD is `c712560` (a `Deploy docs from marcusrbrown/systematic@f6727e9c...` commit); the root tree no longer contains a `.github/` directory. The deploy pipeline overwrites the branch wholesale rather than preserving stray files, so any config committed directly to the deploy branch is transient. Net: the deploy branch is back to pure build output, and the merged Renovate config lived on `gh-pages` for roughly two days before the next build erased it.

## Open Issues

| #  | Title                                              | Status |
| -- | -------------------------------------------------- | ------ |
| 1  | Enable code scanning (CodeQL / Scorecard) for coverage parity | Open   |
| 3  | Action Required: Fix Renovate Configuration        | Open (2026-06-24, Renovate-authored; now moot — config file gone) |

Issue #2 was a PR (now merged). Issue #3 is Renovate's standard config-error notice: "There is an error with this repository's Renovate configuration that needs to be fixed. As a precaution, Renovate will stop PRs until it is resolved." It was opened minutes after PR #2 merged — the merged config was already failing to resolve (see [Renovate](#renovate)).

**Update 2026-07-08:** issue #3 is still **open**, but the config it complains about no longer exists on `gh-pages` (the docs build wiped `.github/renovate.json5`). The issue is now effectively stale — there is no config for Renovate to resolve, so it will neither self-heal nor re-error. It should be closed manually; it is not tracking a live fault.

**Update 2026-07-22:** unchanged — both #1 and #3 remain **open**. Issue #3 is now ~4 weeks stale with no config on the branch for it to reference; the docs build has overwritten `gh-pages` many times since (14 deploys 2026-07-14 → 2026-07-22) and never restored a `.github/` dir. Still a manual-close candidate, not a live fault.

**Update 2026-08-06:** still unchanged — both #1 and #3 **open**, neither touched this interval (#3 last updated 2026-06-26, now ~6 weeks stale; #1 last updated 2026-03-09). The root tree at HEAD `1938bb1` confirms no `.github/` dir after 17 more deploys. Issue #3 remains a manual-close candidate tracking a config that no longer exists; issue #1 (CodeQL/Scorecard parity) is inapplicable to a build-output-only branch with no source to scan.

**Update 2026-08-21:** still unchanged — both #1 and #3 **open**, neither touched this interval (#3 last updated 2026-06-26, now ~8 weeks stale; #1 last updated 2026-03-09). The root tree at HEAD `a40e544` confirms no `.github/` dir after 16 more deploys. `open_issues_count` reads 2 (both true issues; no open PRs). Both remain manual-close/inapplicable as noted.

**Update 2026-09-04:** still unchanged — both #1 and #3 **open**, untouched for a sixth consecutive survey (#3 last updated 2026-06-26, now ~10 weeks stale; #1 last updated 2026-03-09, ~6 months). The root tree at HEAD `8e26a01` confirms no `.github/` dir after 15 more deploys. `open_issues_count` reads 2, no open PRs, single branch. The queue is not a backlog — it is two items that no process is ever going to touch, because nothing in this repo runs on a schedule and nothing here can be fixed by a deploy. Six surveys of "unchanged" is enough evidence to call them **inert**: #3 references a config file that has not existed since 2026-06-26, and #1 asks for code scanning on a branch containing no source. Closing both is a one-time manual action with no automation path.

## Fro Bot Workflow

**No Fro Bot agent workflow detected.** This is expected — the repo contains only static build output. No PR review, autoheal, or maintenance workflows are present. Only GitHub's built-in `pages-build-deployment` and `Dependency Graph` dynamic workflows are active.

A Fro Bot workflow is not recommended for this repo. The source repo ([[marcusrbrown--systematic]]) already has full Fro Bot integration covering the documentation source.

**Re-confirmed 2026-09-04 (tenth survey).** `actions/workflows` returns `total_count: 2`, both GitHub-synthesised: `pages-build-deployment` and `Dependency Graph`, both `active`. `metadata/repos.yaml` records `has_fro_bot_workflow: false` for this repo, which is accurate and should stay that way. The standing recommendation is unchanged and is now backed by the release-gating finding above: **any agent onboarded here would be reviewing build output it cannot change.** `gh-pages` is overwritten wholesale on every deploy (proven when the 2026-06 Renovate config was erased two days after merge), so an autoheal daemon could not land a durable fix even if it found one, and a PR-review daemon would be reviewing generated HTML. No follow-up draft PR is warranted; if fleet tooling flags this repo as un-onboarded, the correct resolution is an explicit exemption, not a workflow.

## Renovate

**Resolved 2026-07-08: the config was overwritten by the next docs build, as predicted.** The 2026-06-25 survey flagged that a config file on the deploy branch "will be overwritten or orphaned by the next docs build unless the source-repo build pipeline preserves it." It was not preserved. The first docs deploy after PR #2 merged (`29f137d`, 2026-06-26) replaced the full `gh-pages` tree and dropped `.github/renovate.json5`. Renovate never had a durable config here; the onboarding attempt left only a stale open issue (#3). The lesson stands: **do not commit persistent config to a wholesale-overwritten deploy branch.** If Renovate is genuinely wanted for this repo, it needs a source of truth the build won't clobber — but as noted below, there is nothing here for it to update anyway.

**Historical (2026-06-24 → 2026-06-26):** PR #2 merged `.github/renovate.json5` directly onto the deploy branch (commit `e75ddeb`). This was a notable shift: `gh-pages` is otherwise the build-output branch, and every prior commit was a `fro-bot[bot]` "Deploy docs from ..." build.

The merged config:

```json5
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>fro-bot/renovate-config"]
}
```

**Contradiction vs. prior survey:** the 2026-06-14 survey recorded the unmerged `renovate/configure` branch extending `github>bfra-me/renovate-config`. The version that actually merged extends `github>fro-bot/renovate-config` — the preset source was swapped from the `bfra-me` org to the `fro-bot` org before merge.

The preset was **failing to resolve.** Renovate opened issue #3 ("Action Required: Fix Renovate Configuration") on 2026-06-24, halting all PRs. The likely cause was that `github>fro-bot/renovate-config` did not resolve to a usable preset (the `fro-bot/renovate-config` repo is not in the surveyed wiki and may not exist or may lack a default config); the analogous tracked preset is [[marcusrbrown--renovate-config]], which serves both `marcusrbrown/*` and `fro-bot/*` repos. This is now moot — the config file that pointed at the broken preset is gone (see the 2026-07-08 resolution above).

Given that the repo still contains only static HTML output (no `package.json`, no manifests), Renovate had nothing to update even had the preset resolved — the onboarding added operational surface without a clear dependency target.

## Collaborators

- `fro-bot` — sole collaborator (push access)

## Relationship to marcusrbrown/systematic

| Aspect          | `marcusrbrown/systematic`           | `fro-bot/systematic`                     |
| --------------- | ----------------------------------- | ---------------------------------------- |
| Purpose         | Source code + plugin + docs source  | Built docs deployment target             |
| Default branch  | `main`                              | `gh-pages`                               |
| Contains code   | Yes (TypeScript, Bun)               | No (static HTML)                         |
| npm package     | `@fro.bot/systematic`               | N/A                                      |
| Fro Bot agent   | Yes (PR review, autoheal, weekly)   | No (not needed)                          |
| Renovate        | Active                              | Config wiped by build 2026-07 (stale issue #3) |
| Commits by      | Various (Marcus, Renovate, Fro Bot) | `fro-bot[bot]` only                      |
| Pages URL       | N/A                                 | https://fro.bot/systematic/              |

The documentation build pipeline flows: `marcusrbrown/systematic` → Astro build → push to `fro-bot/systematic:gh-pages` → GitHub Pages serves at `fro.bot/systematic/`.

## Deploy Cadence

Deployments track **releases** of `@fro.bot/systematic`, one deploy per npm publish. (Earlier text here read "fans out per merge rather than per release tag"; that was wrong and is corrected under [Purpose](#purpose) — 16 non-releasable source commits produced zero deploys.) Activity is markedly bursty, because the release train itself is bursty.

### 2026-09-04 survey — 15 deploys in a 49.5-hour window, then 10 days of silence

The interval since 2026-08-21 is not a rhythm at all. It is a 3.2-day gap, a 49.5-hour burst, and a 10-day stop:

- `a40e544` (2026-08-20T01:16) → `0a150b3` (2026-08-23T06:30): **3.2 days, no deploys.**
- `0a150b3` → `8e26a01` (2026-08-25T08:00): **15 deploys in 49.5 hours**, 1:1 with npm publishes `3.13.0` → `3.15.0`.
- `8e26a01` → 2026-09-04: **10.0 days, no deploys**, and no npm publishes either (`modified` on the npm packument is `2026-08-25T07:59:54Z`).

**Deploy lag is sub-minute, not "~1–2 min."** Prior surveys reported minute-resolution figures. Measured at second resolution across all 15 deploys this interval, the publish→deploy-commit lag is **31–45 s, mean ~36 s**. The earlier readings were a rounding artifact of comparing `HH:MM` timestamps, not a pipeline that has since gotten faster.

| Publish (UTC)        | Version  | gh-pages SHA | Source SHA  | Lag  |
| -------------------- | -------- | ------------ | ----------- | ---- |
| 2026-08-25T07:59:53Z | `3.15.0` | `8e26a01`    | `c5273ee8`  | 37 s |
| 2026-08-25T06:25:52Z | `3.14.5` | `a6a4738`    | `7eedd18b`  | 41 s |
| 2026-08-24T21:28:46Z | `3.14.4` | `73b4d65`    | `8a3fc20d`  | 40 s |
| 2026-08-24T04:56:13Z | `3.14.3` | `3de146e`    | `afc3e0bd`  | 33 s |
| 2026-08-24T03:19:23Z | `3.14.2` | `3f2f168`    | `d267a654`  | 45 s |
| 2026-08-24T02:29:15Z | `3.14.1` | `0bd4ba6`    | `fa2a720e`  | 39 s |
| 2026-08-23T23:44:43Z | `3.14.0` | `ca47d64`    | `1e3d512d`  | 34 s |
| 2026-08-23T23:12:19Z | `3.13.7` | `2f07102`    | `7aa6e297`  | 32 s |
| 2026-08-23T20:30:45Z | `3.13.6` | `400711d`    | `6dcd1e8f`  | 34 s |
| 2026-08-23T18:34:49Z | `3.13.5` | `dfa8fb8`    | `0c9532b3`  | 38 s |
| 2026-08-23T16:06:44Z | `3.13.4` | `03976df`    | `cf7544cc`  | 34 s |
| 2026-08-23T15:11:26Z | `3.13.3` | `facd3e6`    | `476a3b6f`  | 31 s |
| 2026-08-23T14:27:45Z | `3.13.2` | `521ede8`    | `2c67976a`  | 35 s |
| 2026-08-23T07:54:18Z | `3.13.1` | `300d11d`    | `7bec6707`  | 32 s |
| 2026-08-23T06:30:03Z | `3.13.0` | `0a150b3`    | `2fedc270`  | 42 s |

**Correction to the 2026-08-21 reading.** That survey characterised its window as "daily-to-multi-per-day, a sustained rhythm rather than a single burst." Its own deploy table contradicts that: nothing landed between 2026-08-04T16:41 and 2026-08-13T21:10 — a **9.2-day drought** — after which 25 releases landed in 11.5 days. Averaging 16 deploys over 16 days produced a "daily" number describing an interval that contained no daily behaviour. Combined with the present 10-day stop, the durable shape of this pipeline is **burst-and-drought at ~10-day period**, driven entirely by whether upstream is shipping `feat:`/`fix:` commits or grinding through Renovate `chore:` traffic. A future survey that lands inside a drought should not read it as a fault.

### 2026-08-21 survey

The cadence **held its steady daily-to-multi-per-day rhythm** through the v3 minor train (but see the correction above). HEAD is a docs deploy (`a40e544`, 2026-08-20 01:16, source `f615006`) — the **v3.12.4** release, published 01:15 and deployed ~1 min later. **Sixteen deploys** landed between 2026-08-04 (17:00) and 2026-08-20 — a sustained rhythm (double deploys on 2026-08-13, 2026-08-17, and a four-deploy cluster on 2026-08-18 tracking the v3.12.0 → v3.12.2 patch train plus the off-line `2.33.4` v2 backport) rather than a single burst. The fan-out-per-release rhythm holds: each source release lands here within ~1–2 minutes.

Deploys observed on the 2026-08-21 survey (new since 2026-08-06):

| Date (UTC)         | gh-pages SHA | Source SHA  | Notes                    |
| ------------------ | ------------ | ----------- | ------------------------ |
| 2026-08-20 01:16   | `a40e544`    | `f615006`   | v3.12.4 release (01:15)  |
| 2026-08-19 18:47   | `e66eb85`    | `24edab1`   | v3.12.3 (18:46)          |
| 2026-08-18 23:07   | `7c27132`    | `58f3fd7`   | v3.12.2 (23:06)          |
| 2026-08-18 22:12   | `37cc26c`    | `ecb4750`   | npm `2.33.4` v2 backport (22:11); registry still v3 `latest` |
| 2026-08-18 21:13   | `afe56cd`    | `04272fe`   | v3.12.1 (21:11)          |
| 2026-08-18 20:02   | `8e40198`    | `2dd3cf4`   | v3.12.0 (20:01)          |
| 2026-08-17 23:24   | `d293e52`    | `4cead30`   | v3.11.0 (23:23)          |
| 2026-08-17 07:42   | `79ee3ab`    | `070b741`   | v3.10.2 (07:41)          |
| 2026-08-17 06:53   | `53490ce`    | `efd0fda`   |                          |
| 2026-08-17 00:38   | `21e1d8b`    | `1569e66`   |                          |
| 2026-08-16 14:57   | `58802ab`    | `a875314`   |                          |
| 2026-08-15 23:23   | `2f02feb`    | `ca304a2`   |                          |
| 2026-08-15 00:16   | `fef2f8d`    | `ef40082`   |                          |
| 2026-08-14 05:39   | `679ead9`    | `365dd3a`   |                          |
| 2026-08-13 21:22   | `ccdf249`    | `3b4b5fc`   |                          |
| 2026-08-13 21:10   | `7f351a5`    | `a34e8a4`   |                          |

**Prior interval (2026-08-06 survey):** the cadence **stayed active but steadied** into the v3 minor train. HEAD was a docs deploy (`1938bb1`, 2026-08-04 16:41, source `83dfacd`) — the **v3.6.0** release, published 16:40 and deployed ~1 min later. **Seventeen deploys** landed between 2026-07-22 and 2026-08-04 — a sustained multi-per-day-to-daily rhythm (double deploys on 2026-07-25, 2026-07-27, 2026-07-28, 2026-07-31, 2026-08-03) rather than a single burst. The fan-out-per-release rhythm holds: each source release lands here within ~1–2 minutes.

Deploys observed on the 2026-08-06 survey (new since 2026-07-22):

| Date (UTC)         | gh-pages SHA | Source SHA  | Notes                    |
| ------------------ | ------------ | ----------- | ------------------------ |
| 2026-08-04 16:41   | `1938bb1`    | `83dfacd`   | v3.6.0 release (16:40)   |
| 2026-08-04 04:37   | `90a580b`    | `87ebf7b`   |                          |
| 2026-08-03 08:43   | `4a17e44`    | `30bd8a6`   |                          |
| 2026-08-03 08:38   | `cccc908`    | `f9a55e5`   |                          |
| 2026-08-03 04:21   | `69d1494`    | `a3459f5`   |                          |
| 2026-08-01 15:10   | `ae3eede`    | `c37f588`   |                          |
| 2026-08-01 05:14   | `b76441a`    | `02f7b24`   |                          |
| 2026-07-31 21:55   | `5b4e878`    | `7c12ecf`   |                          |
| 2026-07-31 17:48   | `1acdfcf`    | `3420c5c`   |                          |
| 2026-07-31 16:44   | `e5e14ae`    | `ec7252f`   |                          |
| 2026-07-30 06:33   | `c74efcf`    | `06e1c1d`   |                          |
| 2026-07-28 16:21   | `5f06ef2`    | `e5986ad`   |                          |
| 2026-07-28 04:27   | `b7c2df5`    | `a83730c`   |                          |
| 2026-07-27 16:51   | `5aa922f`    | `8bd44a1`   |                          |
| 2026-07-27 03:17   | `573b3c8`    | `d05b68f`   |                          |
| 2026-07-25 20:49   | `b669e7b`    | `897c6e6`   |                          |
| 2026-07-25 20:45   | `c5ec1ba`    | `18ea18e`   |                          |

**Prior interval (2026-07-22 survey):** the cadence **intensified sharply** across the v3 run-up. HEAD was a docs deploy (`8395976`, 2026-07-22 01:03, source `ab42f8a`) — the v3.2.5 release, deployed ~2 min after publication. Fourteen deploys landed between 2026-07-14 and 2026-07-22, clustering on 2026-07-17 (7 deploys in one day) and 2026-07-19 (3 deploys), tracking the v2 → v3 major and its `3.x` patch train. The fan-out-per-merge rhythm holds: each source release lands here within ~2 minutes.

Deploys observed on the 2026-07-22 survey (new since 2026-07-08):

| Date (UTC)         | gh-pages SHA | Source SHA  | Notes                    |
| ------------------ | ------------ | ----------- | ------------------------ |
| 2026-07-22 01:03   | `8395976`    | `ab42f8a`   | v3.2.5 release (01:01)   |
| 2026-07-21 16:09   | `2848c89`    | `027172b`   |                          |
| 2026-07-21 04:44   | `1f6721e`    | `c82e0f0`   |                          |
| 2026-07-19 09:48   | `23abacf`    | `f5b2a7a`   |                          |
| 2026-07-19 08:21   | `eacff3c`    | `7fa0e0f`   |                          |
| 2026-07-19 07:01   | `6e1af74`    | `5fff5e8`   |                          |
| 2026-07-18 21:56   | `235dee5`    | `3601f8e`   |                          |
| 2026-07-17 23:26   | `3760e3a`    | `ed2fda2`   |                          |
| 2026-07-17 09:19   | `1000d00`    | (7 deploys 2026-07-17) |             |
| 2026-07-14 05:23   | `d55715b`    |             |                          |

**Prior interval (2026-07-08 survey):** the cadence **re-intensified** around the v2.33.x releases. HEAD was a docs deploy (`c712560`, 2026-07-07 10:43, source `f6727e9c`) — build output, not the Renovate merge. Three deploys landed on 2026-07-07 alone, tracking the v2.33.0 → v2.33.1 → v2.33.2 release sequence (each source release deployed within ~2 minutes of publication). The interval before that was quiet: one deploy 2026-06-26, one 2026-07-04.

Deploys observed on the 2026-07-08 survey (new since 2026-06-25):

| Date (UTC)         | gh-pages SHA | Source SHA  | Notes                    |
| ------------------ | ------------ | ----------- | ------------------------ |
| 2026-07-07 10:43   | `c712560`    | `f6727e9`   | v2.33.2 release (10:41)  |
| 2026-07-07 03:52   | `4f367e7`    | `48a94e4`   | v2.33.1 release (03:51)  |
| 2026-07-07 01:27   | `a126ae3`    | `142c090`   | v2.33.0 release (01:26)  |
| 2026-07-04 18:06   | `70960fe`    | `015e665`   |                          |
| 2026-06-26 16:20   | `29f137d`    | `29c7e3a`   | First build after PR #2 merge — wiped `.github/renovate.json5` |

**Prior interval (2026-06-25 survey):** the cadence had **cooled sharply** after the early-June burst: only two docs deploys, both clustered around the v2.32.0 release (published 2026-06-15 00:11, deployed 00:12). At that survey the most recent commit on `gh-pages` was not a deploy at all — it was the Renovate PR #2 merge (`e75ddeb`, 2026-06-24), so HEAD was briefly non-build-output. That is no longer the case.

Deploys observed on the 2026-06-25 survey (new since 2026-06-14):

| Date (UTC)         | gh-pages SHA | Source SHA  |
| ------------------ | ------------ | ----------- |
| 2026-06-15 00:12   | `1821a92`    | `70f1891`   |
| 2026-06-14 21:05   | `d0dfd32`    | `9ab70d6`   |

Latest deploys observed on 2026-06-14 (source SHAs are the `marcusrbrown/systematic` commit each deploy was built from). The cadence re-intensified into a multi-per-day rhythm on 2026-06-05 and 2026-06-07, tracking the run-up to the v2.31.0 release (published 2026-06-07 09:19, deployed at 09:20):

| Date (UTC)         | gh-pages SHA | Source SHA  |
| ------------------ | ------------ | ----------- |
| 2026-06-07 09:20   | `28400b1`    | `75622be`   |
| 2026-06-07 07:48   | `17c6122`    | `bae4aea`   |
| 2026-06-07 07:17   | `78f9c2f`    | `16270b3`   |
| 2026-06-07 03:49   | `3bb89b7`    | `9dd0b4c`   |
| 2026-06-05 23:06   | `015f562`    | `870127c`   |
| 2026-06-05 18:47   | `479aeff`    | `2b44a48`   |
| 2026-06-05 15:41   | `9044ca6`    | `3b9d0e6`   |
| 2026-06-05 07:21   | `30a36a3`    | `c3032ee`   |
| 2026-06-05 05:21   | `d5e217a`    | `ce121dd`   |
| 2026-06-04 06:34   | `33cc55a`    | `9914b6c`   |
| 2026-05-30 15:52   | `6e9b231`    | `1594a7e`   |
| 2026-05-30 02:56   | `08eb5f6`    | `7a91b88`   |
| 2026-05-30 01:05   | `96a40f2`    | `a958aeb`   |
| 2026-05-27 05:38   | `a056444`    | `1065d83`   |
| 2026-05-27 05:19   | `335fce6`    | `357107e`   |
| 2026-05-26 23:15   | `fc81e43`    | `0a75480`   |
| 2026-05-24 00:20   | `c4362a2`    | `5568ffc`   |
| 2026-05-24 00:05   | `d6b384e`    | `5dc7101`   |
| 2026-05-23 23:59   | `b4d05ef`    | `d0c6486`   |

Deploys observed on the 2026-05-22 survey:

| Date (UTC)         | gh-pages SHA | Source SHA  |
| ------------------ | ------------ | ----------- |
| 2026-05-21 23:12   | `12cae87`    | `dae829a`   |
| 2026-05-21 22:25   | `bf26128`    | `3810786`   |
| 2026-05-21 18:49   | `f59ab5e`    | `3b1515e`   |
| 2026-05-21 18:40   | `bf76020`    | `1425dd6`   |
| 2026-05-21 18:27   | `cbaced6`    | `e8a981e`   |
| 2026-05-21 04:16   | `ffa2463`    | `9551607`   |
| 2026-05-21 03:50   | `1bd39c8`    | `350a637`   |
| 2026-05-18 18:09   | `b841b51`    | `4c780cb`   |
| 2026-05-18 03:03   | `a3e28f3`    | `402ef5c`   |
| 2026-05-17 20:53   | `9254502`    | `862a098`   |

Earlier deploys remain documented from the prior survey:

| Date       | Source SHA  | Likely version |
| ---------- | ----------- | -------------- |
| 2026-05-05 | `072e755`   | v2.7.3         |
| 2026-05-04 | `088598e`   | v2.7.2         |
| 2026-05-01 | `7d361ce`   | v2.7.1         |
| 2026-04-30 | `2e9453a`   | v2.7.0         |
| 2026-04-28 | `b80f4ce`   | v2.6.1         |
| 2026-04-25 | `581f357`   | v2.6.0         |
| 2026-03-27 | `d0fcffa`   | (pre-survey)   |

## Survey History

| Date       | SHA        | Delta                    |
| ---------- | ---------- | ------------------------ |
| 2026-05-07 | `73fa108`  | Initial survey           |
| 2026-05-22 | `12cae87`  | Registry advanced v2.7.3 → v2.20.6; 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin); `schemas/{latest,v2}/systematic-config.schema.json` now hosted; `404.html` and `og-image.png` added; deploy cadence visibly intensified |
| 2026-06-04 | `33cc55a`  | Registry advanced v2.20.6 → v2.24.0 (now matches latest source release); component counts unchanged (103: 51/47/2/2/1); `favicon.svg` and `privacy/index.html` added; repo description set to "Documentation site for @marcusrbrown/systematic"; schema `$id`/shape and `.well-known/ocx.json` unchanged; deploy cadence cooled from the May burst; no Fro Bot workflow (still expected); issue #1 and PR #2 still open |
| 2026-06-14 | `28400b1`  | Registry advanced v2.24.0 → v2.31.0 (still matches latest source release, published 2026-06-07); components 103 → 104 — skills 47 → 48, all other types unchanged (51/2/2/1); schema config field set unchanged BUT two shape contradictions vs. prior survey: human-readable label moved `title` → `description` on both schemas, and `schemas/latest/` `$id` now hard-points at the v2 URL (latest ≡ v2 on surveyed fields); `.well-known/ocx.json` unchanged; gh-pages tree structure unchanged; deploy cadence re-intensified to multi-per-day around the v2.31.0 release; no Fro Bot workflow (still expected); issue #1 and PR #2 still open |
| 2026-06-25 | `e75ddeb`  | **Structural shift on the deploy branch.** Renovate PR #2 merged onto `gh-pages` (`.github/renovate.json5`, commit `e75ddeb`) and the `renovate/configure` branch was deleted — first non-build, human-intent commit on the deploy branch; HEAD is no longer docs build output. Merged config extends `github>fro-bot/renovate-config` — **contradicts** the 2026-06-14 record of the unmerged branch extending `github>bfra-me/renovate-config` (preset source swapped bfra-me → fro-bot before merge). Preset fails to resolve: new issue #3 "Action Required: Fix Renovate Configuration" (2026-06-24), Renovate halted. Issue #2 now merged (was PR). Registry **unchanged** at v2.32.0 / 104 components (51/48/2/2/1, still matches latest source release v2.32.0 published 2026-06-15). Schemas **byte-stable** vs. prior (latest ≡ v2, no `title`, description label, same props). `.well-known/ocx.json` unchanged. gh-pages content tree otherwise unchanged. Deploy cadence cooled to 2 deploys (2026-06-14, 2026-06-15) clustered on the v2.32.0 release. Still no Fro Bot workflow (only `pages-build-deployment` + `Dependency Graph` dynamic) — still expected |
| 2026-07-08 | `c712560`  | **Prediction confirmed: Renovate config wiped by the build.** The docs build resumed on `gh-pages` and the first deploy after PR #2 (`29f137d`, 2026-06-26) overwrote the tree wholesale, dropping `.github/renovate.json5`; the root tree no longer has a `.github/` dir. HEAD is docs build output again (`c712560`, source `f6727e9`). Issue #3 still open but now **stale/moot** — no config remains for Renovate to resolve. **Registry advanced v2.32.0 → v2.33.2** (still matches latest source release v2.33.2, published 2026-07-07); 104 components unchanged (51/48/2/2/1). **New schema property `skills_as_commands`** on both `latest` and `v2` (property set 7 → 8, additive) — **contradicts** the 2026-06-25 "byte-stable" record; all other schema surface stable (draft-07, `$id` pinned at v2, no `title`, same `description`). `.well-known/ocx.json` unchanged. gh-pages content tree otherwise unchanged. Deploy cadence re-intensified: 3 deploys on 2026-07-07 tracking the v2.33.0/.1/.2 release train (each deployed ~2 min after publish), plus deploys 2026-06-26 and 2026-07-04. Still no Fro Bot workflow (only `pages-build-deployment` + `Dependency Graph` dynamic) — still expected |
| 2026-07-22 | `8395976`  | **v2 → v3 major crossing propagated from source.** Registry advanced **v2.33.2 → v3.2.5** (matches latest source release v3.2.5, published 2026-07-22 01:01, deployed 01:03). **First-ever component contraction: 104 → 73** — agents 51 → 37 (−14), skills 48 → 31 (−17); bundles/profiles/plugin unchanged (2/2/1). **Breaking schema-host change: `schemas/v2/` now returns HTTP 404** — the `v2/` dir was dropped and replaced by `schemas/v3/`; `latest` `$id` now points at the v3 URL (latest ≡ v3). Property set stable at 8 (`skills_as_commands` retained); draft-07, no `title`, same `description`. **Confirms the 2026-07-08 prediction** that a v3 would reshape the pinned-URL contract — majors replace the path wholesale, they do not co-serve; any consumer pinned to `schemas/v2/` is now broken. `.well-known/ocx.json` unchanged. gh-pages tree otherwise stable (still no `.github/`). Issues #1 and #3 still open (#3 ~4 weeks stale). Deploy cadence intensified: 14 deploys 2026-07-14 → 2026-07-22 (7 on 2026-07-17 alone) tracking the v3 major + 3.x train. Still no Fro Bot workflow (only `pages-build-deployment` + `Dependency Graph` dynamic) — still expected |
| 2026-08-06 | `1938bb1`  | **No structural change — steady v3 minor train.** Registry advanced **v3.2.5 → v3.6.0** (matches latest source release v3.6.0, published 2026-08-04 16:40, deployed 16:41 — ~1 min lag). **Component count flat at 73** (37 agents / 31 skills / 2 bundles / 2 profiles / 1 plugin) — the v3 contraction settled at the major boundary and has not moved. **User-config schema grew 8 → 10 properties**: `pi_subagents` and `workflow_guard` added additively on both `latest` and `v3` (third consecutive interval the schema mutated in place under the current major URL). Schema host still v3-only (`schemas/v2/` and `schemas/v4/` both 404); `latest` ≡ v3, draft-07, no `title`, same `description`. `.well-known/ocx.json` unchanged. gh-pages tree stable (still no `.github/` after 17 more deploys). Issues #1 and #3 still open, neither touched (#3 ~6 weeks stale). Deploy cadence stayed active but steadied: 17 deploys 2026-07-22 → 2026-08-04 (sustained multi-per-day-to-daily, no single burst). Still no Fro Bot workflow (only `pages-build-deployment` + `Dependency Graph` dynamic) — still expected |
| 2026-09-04 | `8e26a01`  | **No structural change; the interval's value is measurement, not delta.** Registry advanced **v3.12.4 → v3.15.0** (= npm `dist-tags.latest`, published 2026-08-25T07:59:53Z, deployed +37 s). **Component count flat at 73** for the fourth straight survey (~6 weeks since the v3 boundary). **Schema top-level property set flat at 10** (second non-mutating interval) — but recorded a **refinement**: the served schema is 38,180 B / 74 `definitions`, and its `agents` object is a *closed enumeration of the whole agent roster* (74 keys = 37 bare + 37 qualified, `additionalProperties: false`), so "schema unchanged" as previously measured was a claim about a header, not content; a byte/definition fingerprint is now recorded. **New cross-artifact check:** schema's 37 bare agent names match the registry's 37 `agent` components exactly. **New footgun:** `agents` is closed while `categories` is open-keyed — an agent typo is caught in-editor, a category typo is silently accepted and does nothing. **New observation:** 16 occurrences of a non-standard `"trust"` keyword (`any` / `project-or-higher`) that draft-07 validators ignore entirely. **Correction:** the fan-out is **release-gated, not push-gated** — 16 source commits (1 `docs:`, 15 `chore:`) since the last deploy produced zero deploys and zero publishes; the 10-day frozen HEAD is correct pipeline output, not a dead daemon, and `pushed_at` on the source (2026-09-04, PR branches) would have misdiagnosed it. **Correction:** the 2026-08-21 "sustained daily rhythm" reading averaged across a 9.2-day drought; true shape is burst-and-drought (15 deploys in a 49.5 h window, then 10 days silent). Deploy lag re-measured at second resolution: **31–45 s, mean ~36 s**, not the "~1–2 min" carried since 2026-06. Schema host still v3-only (`v2`/`v4` 404, 5th confirm); `latest` ≡ v3. `.well-known/ocx.json` and gh-pages tree unchanged (still no `.github/`). Issues #1 and #3 open and untouched for a 6th survey (#3 ~10 weeks stale, #1 ~6 months) — now called **inert**, manual-close only. Still no Fro Bot workflow (only `pages-build-deployment` + `Dependency Graph`) — still correct |
| 2026-08-21 | `a40e544`  | **No structural change — steady v3 minor train, axes inverted.** Registry advanced **v3.6.0 → v3.12.4** (matches latest source release v3.12.4, published 2026-08-20 01:15, deployed 01:16 — ~1 min lag). **Component count flat at 73** (37 agents / 31 skills / 2 bundles / 2 profiles / 1 plugin) — unchanged since the v3 major boundary. **User-config schema held flat at 10 properties** — no additions or removals since 2026-08-06 (first non-mutating schema interval since 2026-06-25; breaks the three-in-a-row additive streak). This interval the two axes moved opposite to the prior three: catalog version grew while schema surface stayed frozen. Schema host still v3-only (`schemas/v2/` and `schemas/v4/` both 404, re-confirmed); `latest` ≡ v3, draft-07, no `title`, same `description`. **Off-branch:** npm `2.33.4` v2 backport published 2026-08-18 but `dist-tags.latest` stayed 3.12.4, so it never fanned out here and did not re-serve the v2 schema path. `.well-known/ocx.json` unchanged. gh-pages tree stable (still no `.github/` after 16 more deploys). Issues #1 and #3 still open, neither touched (#3 ~8 weeks stale). Deploy cadence held steady: 16 deploys 2026-08-04 → 2026-08-20 (daily-to-multi-per-day, four-deploy cluster on 2026-08-18). Still no Fro Bot workflow (only `pages-build-deployment` + `Dependency Graph` dynamic) — still expected |
