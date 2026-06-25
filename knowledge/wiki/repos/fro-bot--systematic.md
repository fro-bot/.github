---
type: repo
title: "fro-bot/systematic"
created: 2026-05-07
updated: 2026-06-25
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
tags: [documentation, github-pages, astro, starlight, opencode, plugin, ocx, json-schema, renovate]
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
| Last push       | 2026-06-24                                           |
| Default branch  | `gh-pages`                                           |
| Language        | HTML (static build output)                           |
| License         | None specified                                       |
| Stars           | 0                                                    |
| Open issues     | 2 (#1, #3); 0 open PRs                               |
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

As of the 2026-06-25 survey, `index.json` is **unchanged** from the 2026-06-14 survey — same version, namespace, author, and 104-component breakdown. The figures below still hold.

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

The `schemas/` tree appeared on `gh-pages` between the 2026-05-07 survey and now. Two URLs are served:

- `https://fro.bot/systematic/schemas/latest/systematic-config.schema.json`
- `https://fro.bot/systematic/schemas/v2/systematic-config.schema.json`

Both are draft-07 JSON Schemas. Top-level schema fields: `$schema`, `agents`, `categories`, `disabled_skills`, `disabled_agents`, `disabled_commands`, `bootstrap` — matching the `systematic.json` config shape consumed by `marcusrbrown/systematic`'s `config-handler.ts`. The field set is unchanged across all surveys to date.

The schema's own `$schema` property is documented as informational only — the loader does not fetch or validate against it. Its purpose is to flip on field-level autocomplete in VSCode, Zed, IntelliJ, and any other editor that resolves `$schema` URLs.

Consequence: this deployment target is no longer purely a docs site. It is now also a stable schema host. Renaming, restructuring, or breaking the URL shape of `schemas/v2/systematic-config.schema.json` would silently break IDE autocomplete in every consumer that pinned the v2 URL. Treat it like a public API.

As of the 2026-06-25 survey, both schemas are **byte-stable** vs. 2026-06-14: `latest` and `v2` remain identical (same draft-07 `$schema`, same `$id` hard-pinned at the v2 URL, no top-level `title`, same `description`, same property set `$schema/agents/bootstrap/categories/disabled_agents/disabled_commands/disabled_skills`). No new schema changes this interval.

### Schema shape changes observed 2026-06-14

Two changes since the 2026-06-04 survey, both contradicting prior recorded facts:

1. **Human-readable label moved from `title` to `description`.** The 2026-06-04 survey recorded both schemas as *titled* `Systematic user configuration file (systematic.json / systematic.jsonc)`. As of 2026-06-14, neither schema carries a top-level `title` key at all; that exact string is now the top-level `description`. The label content is identical — only the JSON key changed (`title` → `description`).
2. **`schemas/latest/` now serves a `$id` pointing at the v2 URL.** The `latest` schema's `$id` is now `https://fro.bot/systematic/schemas/v2/systematic-config.schema.json` — identical to the v2 file. Previously the `latest` variant was understood to carry its own `latest` URL as `$id`. Practically, `latest` and `v2` are now byte-equivalent on the fields surveyed (same `$id`, same `description`, same property set), so the two paths currently resolve to the same canonical reference. This is benign while v2 is the only major, but if a v3 ever ships, a `latest` whose `$id` is hard-pinned to v2 would mis-advertise its own identity. Worth re-checking at the next major.

## Branches

As of 2026-06-25, only one branch remains:

| Branch               | Purpose                              |
| -------------------- | ------------------------------------ |
| `gh-pages` (default) | Built documentation site (+ now `.github/renovate.json5`) |

The `renovate/configure` branch documented at the 2026-06-14 survey is gone: PR #2 **merged** on 2026-06-24 and the branch was deleted. See [Renovate](#renovate) — this merge is the first non-build, human-intent commit ever landed directly on the deploy branch.

## Open Issues

| #  | Title                                              | Status |
| -- | -------------------------------------------------- | ------ |
| 1  | Enable code scanning (CodeQL / Scorecard) for coverage parity | Open   |
| 3  | Action Required: Fix Renovate Configuration        | Open (new 2026-06-24, Renovate-authored) |

Issue #2 was a PR (now merged). Issue #3 is Renovate's standard config-error notice: "There is an error with this repository's Renovate configuration that needs to be fixed. As a precaution, Renovate will stop PRs until it is resolved." It was opened minutes after PR #2 merged — the merged config is already failing to resolve (see [Renovate](#renovate)).

## Fro Bot Workflow

**No Fro Bot agent workflow detected.** This is expected — the repo contains only static build output. No PR review, autoheal, or maintenance workflows are present. Only GitHub's built-in `pages-build-deployment` and `Dependency Graph` dynamic workflows are active.

A Fro Bot workflow is not recommended for this repo. The source repo ([[marcusrbrown--systematic]]) already has full Fro Bot integration covering the documentation source.

## Renovate

**Now configured on `gh-pages` (2026-06-24), and already erroring.** PR #2 merged `.github/renovate.json5` directly onto the deploy branch (commit `e75ddeb`). This is a notable shift: `gh-pages` is otherwise the build-output branch, and every prior commit was a `fro-bot[bot]` "Deploy docs from ..." build. A config file living on the deploy branch will be overwritten or orphaned by the next docs build unless the source-repo build pipeline preserves it — worth watching at the next survey.

The merged config:

```json5
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>fro-bot/renovate-config"]
}
```

**Contradiction vs. prior survey:** the 2026-06-14 survey recorded the unmerged `renovate/configure` branch extending `github>bfra-me/renovate-config`. The version that actually merged extends `github>fro-bot/renovate-config` — the preset source was swapped from the `bfra-me` org to the `fro-bot` org before merge.

The preset is **failing to resolve.** Renovate opened issue #3 ("Action Required: Fix Renovate Configuration") on 2026-06-24, halting all PRs until fixed. The likely cause is that `github>fro-bot/renovate-config` does not resolve to a usable preset (the `fro-bot/renovate-config` repo is not in the surveyed wiki and may not exist or may lack a default config); the analogous tracked preset is [[marcusrbrown--renovate-config]], which serves both `marcusrbrown/*` and `fro-bot/*` repos. Either way, the durable finding is: Renovate is wired but broken here.

Given that the repo still contains only static HTML output (no `package.json`, no manifests), Renovate has nothing to update even once the preset resolves — the onboarding adds operational surface without a clear dependency target.

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
| Renovate        | Active                              | Configured 2026-06-24 but erroring (issue #3) |
| Commits by      | Various (Marcus, Renovate, Fro Bot) | `fro-bot[bot]` only                      |
| Pages URL       | N/A                                 | https://fro.bot/systematic/              |

The documentation build pipeline flows: `marcusrbrown/systematic` → Astro build → push to `fro-bot/systematic:gh-pages` → GitHub Pages serves at `fro.bot/systematic/`.

## Deploy Cadence

Based on commit history, deployments track releases of `@fro.bot/systematic`. Recent activity is markedly bursty — multiple deploys per day during active development windows on the source repo, suggesting CI fans out per merge rather than per release tag.

As of the 2026-06-25 survey, the cadence has **cooled sharply** after the early-June burst: only two docs deploys in the ~17 days since the v2.31.0 release window, both clustered around the v2.32.0 release (published 2026-06-15 00:11, deployed 00:12). The most recent commit on `gh-pages` is not a deploy at all — it is the Renovate PR #2 merge (`e75ddeb`, 2026-06-24). HEAD is therefore no longer build output.

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
