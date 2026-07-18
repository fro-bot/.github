---
type: repo
title: "marcusrbrown/dev-like"
created: 2026-07-12
updated: 2026-07-12
sources:
  - url: https://github.com/marcusrbrown/dev-like
    sha: c7defd9c89568909f8a598b1e3d37b204414e257
    accessed: 2026-07-12
tags: [agent-skills, claude-code, plugin, marketplace, npm, cli, registry, osint, engineering-culture, changesets, bun, mit, provenance, no-fro-bot-workflow]
aliases: [dev-like]
related:
  - opencode-plugins
  - github-actions-ci
  - marcusrbrown--systematic
  - fro-bot--systematic
  - marcusrbrown--mothership
---

# marcusrbrown/dev-like

**dev-like** profiles a tech company or developer's engineering culture from **public sources only** and distills it into an installable, spec-compliant [Agent Skill](https://agentskills.io): `develop-like-every`, `develop-like-theo`, `develop-like-<your-heroes>`. Its tagline: _"Steal the workflow, not the code. `/dev-like Every` and your agent develops like the shops you admire — with receipts."_ Every claim in a generated skill links to the public source it came from: **no source, no claim.**

This is OSINT for developer culture, packaged to the open Agent Skills standard. As of the initial survey it is a brand-new repo (created 2026-07-11), still self-described as "brainstorm/scaffold."

## Overview

| Attribute        | Value                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Created          | 2026-07-11 (initial survey 2026-07-12, HEAD `c7defd9`)                                     |
| Last push        | 2026-07-11                                                                                 |
| Description      | Profile a shop's engineering culture from public sources and install `develop-like-<target>` agent skills. `/dev-like Every` |
| Language         | JavaScript (GitHub primary language; substance is `.mjs` Node + Markdown + JSON data)     |
| Runtime          | Node `>=20` (CLI) + Bun (CI / lockfile `bun.lock`)                                         |
| Package manager  | Bun (`bun install --frozen-lockfile`)                                                      |
| Package          | `dev-like` v0.1.1 (npm; `bin: dev-like` → `bin/cli.mjs`); plugin manifest v0.1.0           |
| License          | MIT (`LICENSE` at root)                                                                    |
| Visibility       | Public                                                                                     |
| Stars / Forks    | 1 / 0                                                                                      |
| Open issues      | 1                                                                                          |
| Topics           | `agent-skills`, `ai-agents`, `claude-code`, `codex`, `cursor`, `engineering-culture`      |
| Homepage         | (none; `#readme`)                                                                          |
| Runtime deps     | **Zero** ("zero runtime dependencies is a feature"); sole devDep `@changesets/cli ^2.29.7` |

## What it is: one repo, four artifacts

Per `AGENTS.md`, the repo is simultaneously:

1. **An Agent Skill** (`skills/dev-like/`) — the `/dev-like` router skill that works in any harness.
2. **A Claude Code plugin + marketplace** (`.claude-plugin/plugin.json` + `marketplace.json`) — a plugin named `dev-like` with a root `SKILL.md` yields the bare `/dev-like` slash command.
3. **An npm package** (`dev-like`, CLI in `bin/cli.mjs`) — a thin, deterministic installer/resolver.
4. **A data registry** (`registry/`) — cached, distilled culture profiles. This is described as "the moat."

Three install surfaces from one repo:

```
npx skills add marcusrbrown/dev-like     # universal: symlinks into 55 detected harnesses (skills.sh)
/plugin marketplace add marcusrbrown/dev-like && /plugin install dev-like   # Claude Code
npx dev-like every                        # CLI: cached registry install
```

## How the skill works

The `skills/dev-like/SKILL.md` router runs a resolve → branch workflow:

1. **Resolve** — fetch `registry/index.json` (raw GitHub URL) and match the target against slugs + aliases, case-insensitive (`Every` → `every`; `theo.gg`, `t3.gg`, `Theo Browne` → `theo`).
2. **Cache hit → install** — fetch `registry/<slug>/profile.md` + `entry.json`, state the profile date / consent tier / top sources, then distill into a `develop-like-<slug>` skill written to `.agents/skills/develop-like-<slug>/` and mirrored into `.claude/skills/` (symlink preferred, copy fallback). Offers an optional `<slug>-developer` reviewer/pair persona.
3. **Cache miss → collect, distill, contribute** — run a live OSINT collection workflow across a ranked source taxonomy (revealed preference beats stated preference), build a cited profile, generate the skill, then **offer** (opt-in, never automatic) to PR the new profile back to the registry.

Four bundled reference files drive the phases: `references/profiling.md` (collection), `references/distilling.md` (profile → skill), `references/harnesses.md` (harness paths), `references/registry.md` (contribution/PR flow).

## Registry & consent model

The registry is the durable data layer. Each entry validates against `registry/schema/entry.schema.json` (JSON Schema draft 2020-12). Required fields: `slug`, `name`, `kind` (`org` | `person`), `consentTier`, `updated`, `sources` (min 1). Each source carries `url`, `fetched`, `tier`, optional `note`.

**Consent tiers (descending trust):** `self-published` > `stated` > `observed` > `social`. A schema `allOf` rule enforces the ethics floor: **`kind: person` entries may only be `self-published` or `stated`** — you cannot build a person's profile purely from social posts. Orgs may use the full taxonomy.

Seed registry (2 entries, both `updated: 2026-07-11`):

| Slug    | Name         | Kind   | Consent tier     | Aliases                                       |
| ------- | ------------ | ------ | ---------------- | --------------------------------------------- |
| `every` | Every        | org    | `self-published` | `every.to`, `everyinc`, `every inc`           |
| `theo`  | Theo Browne  | person | `stated`         | `theo.gg`, `t3.gg`, `t3`, `theo browne`, `t3dotgg` |

The `every` entry is sourced primarily from **EveryInc's compound-engineering-plugin** (the same `ce:*` / compound-engineering lineage that powers Fro Bot's own [[marcusrbrown--systematic]] workflows) plus Dan Shipper / Kieran Klaassen essays and podcasts — 11 provenance-linked sources. The `theo` entry draws from create-t3-app docs, t3.gg blog posts, and the t3-oss/pingdotgg GitHub orgs — 9 sources.

`registry/OPTOUT.md` codifies a removal path: open an `optout: <slug or name>` issue or email the maintainer; removal within **48 hours**, no questions asked. Listed targets are a hard stop for the collection workflow (currently empty).

## CI/CD & release engineering

Two workflows, **no Fro Bot workflow** (see Open Threads):

- **`ci.yaml`** — on push to `main` + PR. `permissions: contents: read`. Single `validate` job: `actions/checkout@v6` → `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile` → `bun run validate` → `bun run test`. `scripts/validate.mjs` enforces frontmatter + registry schema + index-sync invariants; `tests/validate.test.mjs` runs under `node --test`.
- **`release.yaml`** — Changesets-driven npm publish via **OIDC trusted publishing** (no `NPM_TOKEN` / `NODE_AUTH_TOKEN` secrets). Version PRs are created via the **`mrbro-bot` GitHub App** (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`, `create-github-app-token@v3.2.0`, SHA-pinned). Node 24, `npm@11.18.0` upgrade for OIDC, `id-token: write` + `registry-url` auth, `changesets/action@v1.9.0`, `persist-credentials: false`. The workflow header documents the exact npm-side trusted-publisher setup gotchas (exact workflow-filename + `repository.url` match, `npm >= 11.5.1`, public repo + public package for provenance).

Changesets config (`.changeset/config.json`): `access: public`, `baseBranch: main`, `commit: false`. This is the same **OIDC-trusted-publish + `mrbro-bot`-App-version-PR** release archetype seen across Marcus's published-package repos (cf. [[marcusrbrown--marcusrbrown]], [[marcusrbrown--extend-vscode]]).

## Ecosystem constraints captured in DESIGN.md

`DESIGN.md` records durable, dated (July 2026) facts about the agent-skills ecosystem this repo targets:

- **Spec:** agentskills.io — `SKILL.md` + YAML frontmatter (`name`, `description` required; `metadata` map; `allowed-tools` experimental). Directory name must match `name`. Progressive disclosure: ~100-token metadata → <5k-token body → on-demand references/scripts.
- **`.agents/skills/` is the vendor-neutral project path** (Codex, Cursor, Copilot, Gemini CLI, Amp, opencode, Cline, Warp, +30). Claude Code uses `.claude/skills/`. `npx skills add` (skills.sh, Vercel) symlinks one canonical copy into all detected harnesses — **55 supported**.
- **Claude Code:** commands are merged into skills; a plugin named `dev-like` with a root `SKILL.md` yields the bare `/dev-like` command. `$ARGUMENTS`, `argument-hint`, `context: fork` available. Marketplace = repo with `.claude-plugin/marketplace.json`.
- **Distribution reality:** skills are distributed from _git repos_ (skills.sh indexes installs); npm is for the CLI, not the skill content. dev-like ships both from one repo.
- **Positioning gap:** docs→skill generators and OSINT dev-profilers (GitRoll) and culture-as-plugin (Every's ~23k-star compound-engineering-plugin) all exist separately; nobody combines multi-source culture profiling → installable skill. That synthesis is the product.

## Notable patterns

- **OSINT-to-skill pipeline:** the novel synthesis — public engineering "exhaust" (shipped agent configs, linter/CI files, blogs, talks) → cited culture profile → installable per-harness skill. Provenance links are simultaneously the ethics story, the marketing hook ("with receipts"), and the anti-hallucination guardrail.
- **Consent tiers as a schema-enforced ethics floor:** the `person` → `stated`-or-better rule is encoded in JSON Schema (`allOf`/`if`/`then`), not left to reviewer discretion. Revealed preference (shipped configs) is explicitly ranked above stated preference.
- **Design-for-deletion registry:** `AGENTS.md` mandates that nothing outside `registry/<slug>/` and `registry/index.json` may reference a registry slug — each profile is removable in isolation (mirrors the design-for-deletion discipline seen in [[marcusrbrown--mothership]]).
- **Zero-runtime-dependency stance:** the CLI touches nothing beyond `raw.githubusercontent.com`, no telemetry, no postinstall. Adding a dependency requires explicit justification.
- **Thin-CLI / smart-skill split:** `bin/cli.mjs` does deterministic resolve + install of _cached_ profiles only; live profiling is explicitly deferred to the LLM-backed `/dev-like` skill ("Uncached targets: run `/dev-like <target>` in your agent instead").

## Relationship to the Fro Bot ecosystem

- **[[marcusrbrown--systematic]] / [[fro-bot--systematic]]** — dev-like's flagship `every` profile is distilled from EveryInc's compound-engineering-plugin, i.e. the same `ce:*` compound-engineering lineage that Fro Bot's own systematic skills descend from. dev-like is, in effect, a tool for packaging that culture (and others) into installable skills — a meta-layer over the same standard Fro Bot rides.
- **[[opencode-plugins]]** — dev-like targets the cross-harness Agent Skills standard (`.agents/skills/`) that opencode and 50+ harnesses consume; the `SKILL.md` + progressive-disclosure + references pattern is the same one used throughout the Fro Bot skill fleet.
- **[[github-actions-ci]]** — its OIDC-trusted-publish + Changesets + `mrbro-bot`-App-version-PR release pipeline is the fleet-standard published-package archetype.
- **Marcus-authored, `mrbro-bot`-operated:** version PRs are authored by the `mrbro-bot` GitHub App, consistent with the `mrbro-bot`-drives-releases pattern across Marcus's repos.

## Open threads / to re-confirm next survey

- **No Fro Bot workflow.** Only `ci.yaml` + `release.yaml` are present — there is no `.github/workflows/fro-bot.yaml`. A follow-up draft PR proposing Fro Bot onboarding (three-mode `fro-bot.yaml`, agent pin, review/triage/maintenance) could be proposed separately, matching the onboarding gap noted for [[marcusrbrown--mothership]] and others.
- **No Renovate config / no Probot Settings / no CodeQL/Scorecard** observed — candidates for the same onboarding sweep.
- **Registry growth:** only 2 seed entries (`every`, `theo`). Track new profiles and whether community PRs land via the opt-in contribution flow.
- **`brainstorm/scaffold` → shipped:** DESIGN.md self-labels the status as scaffold. Track whether the planned docs `site/` (Astro, Impeccable-styled) lands, and whether `HANDOFF.md` (session state, delete-when-stale) and `LAUNCH.md` (dependency-ordered roadmap) progress.
- **First npm publish:** package.json is at v0.1.1 but confirm whether `dev-like` has actually published to npm (OIDC trusted-publisher setup must be completed on npmjs.com before the first run).
- **`node >=20` vs Bun CI:** the package engines floor is Node 20 while CI runs on Bun and release runs on Node 24 — watch for divergence.

## Survey History

| Date       | HEAD      | Notes                                                                                       |
| ---------- | --------- | ------------------------------------------------------------------------------------------- |
| 2026-07-12 | `c7defd9` | Initial survey. Brand-new repo (created 2026-07-11). Four-in-one artifact (skill + Claude plugin/marketplace + npm CLI + registry). 2 seed profiles (`every`, `theo`). OIDC-trusted-publish + Changesets + `mrbro-bot` release. Zero runtime deps. **No Fro Bot workflow** — onboarding follow-up candidate. |
