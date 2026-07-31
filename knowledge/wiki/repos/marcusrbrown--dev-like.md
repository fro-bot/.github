---
type: repo
title: "marcusrbrown/dev-like"
created: 2026-07-12
updated: 2026-07-31
sources:
  - url: https://github.com/marcusrbrown/dev-like
    sha: c7defd9c89568909f8a598b1e3d37b204414e257
    accessed: 2026-07-12
  - url: https://github.com/marcusrbrown/dev-like
    sha: a2a30b693f46bb55baf47b2a9788df36e90d1b35
    accessed: 2026-07-31
tags: [agent-skills, claude-code, plugin, marketplace, npm, cli, registry, osint, engineering-culture, changesets, bun, mit, provenance, fro-bot-workflow, autoheal, astro-starlight, evals]
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

This is OSINT for developer culture, packaged to the open Agent Skills standard. At the initial survey (2026-07-12) it was a brand-new repo (created 2026-07-11), self-described as "brainstorm/scaffold." **By the second survey (2026-07-31, HEAD `a2a30b6`) it has shipped**: npm package at **v0.4.1**, a live **Astro/Starlight docs site** at `mrbro.dev/dev-like/`, the registry grown from 2 → **5 profiles**, a **paired A/B eval harness** (`evals/`), and — resolving the biggest prior open thread — a **full Fro Bot workflow** with Renovate and Probot Settings. The "scaffold" label is retired.

## Overview

Values reflect the **2026-07-31 survey** (HEAD `a2a30b6`); the parenthetical shows the 2026-07-12 initial-survey value where it changed.

| Attribute        | Value                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Created          | 2026-07-11                                                                                 |
| Last push        | 2026-07-31 (was 2026-07-11)                                                                |
| Description      | Profile a shop's engineering culture from public sources and install `develop-like-<target>` agent skills. `/dev-like Every` |
| Language         | JavaScript (GitHub primary language; substance is `.mjs` Node + Markdown + JSON data, now + Astro/TS docs site) |
| Runtime          | Node `>=20` (CLI) + Bun (CI / lockfile `bun.lock`)                                         |
| Package manager  | Bun (`bun install --frozen-lockfile`); Bun **workspaces** `["docs", "."]`                 |
| Package          | `dev-like` **v0.4.1** (was v0.1.1) (npm; `bin: dev-like` → `bin/cli.mjs`); plugin manifest **v0.4.1** (was v0.1.0) |
| License          | MIT (`LICENSE` at root)                                                                    |
| Visibility       | Public                                                                                     |
| Stars / Forks    | 2 / 1 (was 1 / 0)                                                                          |
| Open issues      | 2 (was 1)                                                                                  |
| Topics           | + `portfolio` added → `agent-skills`, `ai-agents`, `claude-code`, `codex`, `cursor`, `engineering-culture`, `portfolio` |
| Homepage         | **`https://mrbro.dev/dev-like/`** (was none) — Astro/Starlight docs site                   |
| Runtime deps     | **Zero** ("zero runtime dependencies is a feature"); sole root devDep `@changesets/cli 2.31.1` (was `^2.29.7`) + a `docs/` workspace with its own build deps |

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

**Registry (2026-07-31): grown 2 → 5 profiles**, each now shipping a fully-generated `develop-like-<slug>` skill in-repo (`registry/<slug>/skill/develop-like-<slug>/` with `SKILL.md` + `personas/<slug>-developer.md` + `references/{sources,stack,workflow}.md`):

| Slug        | Name         | Kind   | Consent tier     | Updated     | Sources | Aliases                                       |
| ----------- | ------------ | ------ | ---------------- | ----------- | ------- | --------------------------------------------- |
| `37signals` | 37signals    | org    | `self-published` | 2026-07-16  | 10      | `basecamp`, `37signals llc`, `thirtysevensignals` |
| `every`     | Every        | org    | `self-published` | 2026-07-11  | 11      | `every.to`, `everyinc`, `every inc`           |
| `linear`    | Linear       | org    | `self-published` | 2026-07-16  | 6       | `linear.app`, `linear method`                 |
| `oxide`     | Oxide        | org    | `self-published` | 2026-07-11  | 17      | `oxide computer`, `oxide computer company`, `oxidecomputer`, `oxide.computer` |
| `theo`      | Theo Browne  | person | `stated`         | 2026-07-11  | 9       | `theo.gg`, `t3.gg`, `t3`, `theo browne`, `t3dotgg` |

The consent-tier ethics floor holds across growth: **all four orgs are `self-published`** (documented engineering practices) and the sole `person` entry (`theo`) remains `stated` — no profile relies on the `observed`/`social` lower tiers, and the `person`→`stated`-or-better schema rule is honored. The `every` entry is sourced primarily from **EveryInc's compound-engineering-plugin** (the same `ce:*` / compound-engineering lineage that powers Fro Bot's own [[marcusrbrown--systematic]] workflows) plus Dan Shipper / Kieran Klaassen essays and podcasts. `oxide` is the most heavily-sourced profile (17 provenance links — RFDs, Oxide-and-Friends podcast, public repos), consistent with Oxide's unusually public engineering culture.

`registry/OPTOUT.md` codifies a removal path: open an `optout: <slug or name>` issue or email the maintainer; removal within **48 hours**, no questions asked. Listed targets are a hard stop for the collection workflow (currently empty).

## CI/CD & release engineering

By 2026-07-31 the two-workflow setup has grown to **seven workflows**, including a **Fro Bot workflow** (the prior "no Fro Bot workflow" thread is resolved — see [[github-actions-ci]]):

- **`ci.yaml`** — on push to `main` + PR. `permissions: contents: read`. Single `validate` job: checkout → `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile` → `bun run validate` → `bun run test`. `scripts/validate.mjs` enforces frontmatter + registry schema + index-sync invariants; `tests/validate.test.mjs` runs under `node --test`. `validate` now also runs `sync-release-version.mjs --check`, and `test` runs both `node --test tests/*.test.mjs` **and** `bun test tests/*.test.ts`.
- **`release.yaml`** — Changesets-driven npm publish via **OIDC trusted publishing** (no `NPM_TOKEN` / `NODE_AUTH_TOKEN` secrets). Version PRs are created via the **`mrbro-bot` GitHub App** (`APPLICATION_ID` / `APPLICATION_PRIVATE_KEY`, `create-github-app-token@v3.2.0`, SHA-pinned). Node 24, `npm@11.18.0` upgrade for OIDC, `id-token: write` + `registry-url` auth, `changesets/action@v1.9.0`, `persist-credentials: false`. The workflow header documents the exact npm-side trusted-publisher setup gotchas (exact workflow-filename + `repository.url` match, `npm >= 11.5.1`, public repo + public package for provenance). A `.github/scripts/alias-release.ts` + `bun run alias-release` step now handles release aliasing.
- **`fro-bot.yaml`** (NEW) — **two-mode** Fro Bot (autoheal + pr-review), agent pinned `fro-bot/agent@c29ac29 # v0.96.0`. Triggers: `issue_comment`, `pull_request_review_comment`, `issues`, `pull_request`, daily `schedule` (`30 14 * * *`), and `workflow_dispatch` (`mode` choice `autoheal`|`pr-review` + optional `prompt`). `permissions: contents: read`; concurrency keyed by issue/PR/run id, `cancel-in-progress: false`. Checkout uses `secrets.FRO_BOT_PAT`, `persist-credentials: false`, `fetch-depth: 0`; Bun install `--ignore-scripts`. Two large inline prompts (`AUTOHEAL_PROMPT`, `PR_REVIEW_PROMPT`) encode **repo-specific hard boundaries** — zero runtime deps, no registry/consent/OPTOUT/profile-prose edits (registry changes are human-gated), no release.yaml/OIDC/publish edits, no direct commit/merge to `main`, mandatory changesets for `registry|skills|bin|scripts` touches, and required verification gates (`bun run validate`, `bun run test`, `bun run --cwd docs test`, `bun run --cwd docs build`, `npm pack --dry-run`). Failures roll up to a single **"Fro Bot Autoheal"** issue (reopen-not-spam). See Notable patterns.
- **`site.yaml`** (NEW) — builds/deploys the Astro/Starlight docs site to GitHub Pages on `docs/**` / `registry/**` changes; runs `bun run validate` + `bun run --cwd docs test` + `bun run --cwd docs build`; `concurrency: pages`.
- **`link-check.yaml`** (NEW) — link validity gate (`scripts/check-links.mjs`).
- **`renovate.yaml`** (NEW) — self-hosted Renovate; config `.github/renovate.json5` extends `local>marcusrbrown/renovate-config` (see [[marcusrbrown--renovate-config]]) + sanity-io semantic-commit-type, ignores `evals/**` (intentionally-pinned eval fixtures), and LTS-only Node in Actions.
- **`update-repo-settings.yaml`** (NEW) — applies Probot Settings (`.github/settings.yml`), which `_extends: .github:common-settings.yaml` (this repo's org defaults) and enforces branch protection on `main`: `required_status_checks` strict on `validate` + **`Fro Bot`**, `enforce_admins`, `required_linear_history`.

Changesets config (`.changeset/config.json`): `access: public`, `baseBranch: main`, `commit: false`. This is the same **OIDC-trusted-publish + `mrbro-bot`-App-version-PR** release archetype seen across Marcus's published-package repos (cf. [[marcusrbrown--marcusrbrown]], [[marcusrbrown--extend-vscode]]).

## Ecosystem constraints captured in DESIGN.md

`DESIGN.md` records durable, dated (July 2026) facts about the agent-skills ecosystem this repo targets:

- **Spec:** agentskills.io — `SKILL.md` + YAML frontmatter (`name`, `description` required; `metadata` map; `allowed-tools` experimental). Directory name must match `name`. Progressive disclosure: ~100-token metadata → <5k-token body → on-demand references/scripts.
- **`.agents/skills/` is the vendor-neutral project path** (Codex, Cursor, Copilot, Gemini CLI, Amp, opencode, Cline, Warp, +30). Claude Code uses `.claude/skills/`. `npx skills add` (skills.sh, Vercel) symlinks one canonical copy into all detected harnesses — **55 supported**.
- **Claude Code:** commands are merged into skills; a plugin named `dev-like` with a root `SKILL.md` yields the bare `/dev-like` command. `$ARGUMENTS`, `argument-hint`, `context: fork` available. Marketplace = repo with `.claude-plugin/marketplace.json`.
- **Distribution reality:** skills are distributed from _git repos_ (skills.sh indexes installs); npm is for the CLI, not the skill content. dev-like ships both from one repo.
- **Positioning gap:** docs→skill generators and OSINT dev-profilers (GitRoll) and culture-as-plugin (Every's ~23k-star compound-engineering-plugin) all exist separately; nobody combines multi-source culture profiling → installable skill. That synthesis is the product.

## Docs site (`docs/`, landed 2026-07-31)

The planned Astro docs site from `DESIGN.md` has shipped as a Bun **workspace** (`docs/`) built on **Astro + Starlight**, deployed to `mrbro.dev/dev-like/` via `site.yaml`:

- Content in `docs/src/content/docs/` — `index.mdx` landing, `ethics.mdx`, and a `harness-support.md` matrix distinguishing **Verified** (install + invocation run end-to-end) from **Staged** (files land but live invocation unconfirmed): Claude Code (plugin marketplace + `npx skills add`) and GitHub Copilot CLI are Verified; Codex is Staged. Full transcripts live in `docs/demo/cross-harness-verification-2026-07-11.md`.
- Build-time **registry → docs pages** generation (`docs/scripts/generate-registry-pages.ts`) plus dynamic **OG-image** endpoints (`docs/src/pages/og/[...slug].png.ts`, `docs/src/lib/og-image.ts`), analytics (`docs/src/lib/analytics.ts`), and internal-link checking (`docs/scripts/check-internal-links.ts`). Custom components: `BeforeAfter`, `CopyCommand`, `Head`, `Header`.
- A `docs/tests/` suite (Bun) covers landing, link-check, registry-page generation, OG/analytics, and the site workflow.
- `docs/demo/` holds dated dry-run transcripts (`every`, `oxide`, `37signals`) and artifact-first / imperative-template evals — the receipts backing the profiles.

## Paired eval harness (`evals/`, landed 2026-07-31)

`evals/paired/` is an honest, self-critical **A/B eval** of whether an installed `develop-like-*` skill changes agent behavior. `run.mjs` drives a paired run over `evals/paired/fixture/` (a small `orders.js` bug-fix task): **ARM** has `develop-like-every` installed via `bin/cli.mjs`, **CONTROL** is the identical fixture with no skill. Results in `results/{arm,control}.jsonl` + `report.md`.

The `report.md` verdict is a documented **honest null result** at n=1: the skill *loaded* (ARM invoked it; CONTROL did not) and shifted tool-use/turn counts (6 vs 2 tool calls, 13 vs 7 turns) but did **not** move the signals that matter — plan-before-mutation, test-file-touched, ran-tests were flat across both arms. The report foregrounds its own determinism caveat (single run, not statistically powered) rather than overclaiming. This is a notable culture tell: the repo evaluates its own product skeptically and publishes the negative result. Renovate deliberately ignores `evals/**` so its intentionally-pinned fixtures aren't bumped.

## Notable patterns

- **OSINT-to-skill pipeline:** the novel synthesis — public engineering "exhaust" (shipped agent configs, linter/CI files, blogs, talks) → cited culture profile → installable per-harness skill. Provenance links are simultaneously the ethics story, the marketing hook ("with receipts"), and the anti-hallucination guardrail.
- **Consent tiers as a schema-enforced ethics floor:** the `person` → `stated`-or-better rule is encoded in JSON Schema (`allOf`/`if`/`then`), not left to reviewer discretion. Revealed preference (shipped configs) is explicitly ranked above stated preference.
- **Design-for-deletion registry:** `AGENTS.md` mandates that nothing outside `registry/<slug>/` and `registry/index.json` may reference a registry slug — each profile is removable in isolation (mirrors the design-for-deletion discipline seen in [[marcusrbrown--mothership]]).
- **Zero-runtime-dependency stance:** the CLI touches nothing beyond `raw.githubusercontent.com`, no telemetry, no postinstall. Adding a dependency requires explicit justification.
- **Thin-CLI / smart-skill split:** `bin/cli.mjs` does deterministic resolve + install of _cached_ profiles only; live profiling is explicitly deferred to the LLM-backed `/dev-like` skill ("Uncached targets: run `/dev-like <target>` in your agent instead").
- **Prompt-encoded invariant boundaries (2026-07-31):** unlike the fleet-standard three-mode `fro-bot.yaml`, dev-like runs a **two-mode** (autoheal + pr-review) workflow whose inline prompts hard-code the repo's own invariants as agent guardrails — zero-runtime-deps, human-gated registry/consent/OPTOUT/profile edits, no release-pipeline edits, mandatory changesets, and explicit verification gates before any PR. The repo teaches its autonomous maintainer the same rules `AGENTS.md` teaches humans, so provenance/consent ethics survive automation.
- **Skeptical self-evaluation (2026-07-31):** the `evals/paired/` harness publishes an honest **null result** on its own flagship skill rather than a marketing number, with a foregrounded n=1 determinism caveat — evidence discipline applied inward, mirroring the "no source, no claim" ethic applied outward.

## Relationship to the Fro Bot ecosystem

- **[[marcusrbrown--systematic]] / [[fro-bot--systematic]]** — dev-like's flagship `every` profile is distilled from EveryInc's compound-engineering-plugin, i.e. the same `ce:*` compound-engineering lineage that Fro Bot's own systematic skills descend from. dev-like is, in effect, a tool for packaging that culture (and others) into installable skills — a meta-layer over the same standard Fro Bot rides.
- **[[opencode-plugins]]** — dev-like targets the cross-harness Agent Skills standard (`.agents/skills/`) that opencode and 50+ harnesses consume; the `SKILL.md` + progressive-disclosure + references pattern is the same one used throughout the Fro Bot skill fleet.
- **[[github-actions-ci]]** — its OIDC-trusted-publish + Changesets + `mrbro-bot`-App-version-PR release pipeline is the fleet-standard published-package archetype. As of 2026-07-31 it also runs a Fro Bot workflow (two-mode, agent v0.96.0) and inherits org Probot Settings via `.github:common-settings.yaml`.
- **[[probot-settings]]** — `.github/settings.yml` `_extends: .github:common-settings.yaml` (this very repo, fro-bot/.github) and gates `main` on the `validate` + `Fro Bot` status checks with linear history — the same inheritance/governance pattern documented across the fleet.
- **Marcus-authored, `mrbro-bot`-operated:** version PRs are authored by the `mrbro-bot` GitHub App, consistent with the `mrbro-bot`-drives-releases pattern across Marcus's repos.

## Open threads / to re-confirm next survey

**Resolved since 2026-07-12:**

- ~~No Fro Bot workflow~~ — **RESOLVED.** `fro-bot.yaml` landed (two-mode autoheal + pr-review, agent v0.96.0). No draft onboarding PR needed.
- ~~No Renovate / no Probot Settings~~ — **RESOLVED.** `renovate.yaml` + `.github/renovate.json5` (extends [[marcusrbrown--renovate-config]]) and `update-repo-settings.yaml` + `.github/settings.yml` (extends `.github:common-settings.yaml`) both present.
- ~~First npm publish uncertain~~ — **RESOLVED.** Package is at **v0.4.1**, well past the v0.1.1 seed; OIDC trusted publishing is operational.
- ~~`brainstorm/scaffold` → shipped~~ — **RESOLVED.** Docs site landed (Astro/Starlight at `mrbro.dev/dev-like/`); the eval harness landed. Scaffold label retired.

**Still open / new:**

- **No CodeQL/Scorecard** observed among the seven workflows — the one remaining security-hardening gap from the original onboarding sweep. Candidate for a follow-up.
- **Registry growth cadence:** 2 → 5 profiles in ~3 weeks (`37signals`, `linear`, `oxide` added). All new entries are `mrbro`/self-authored orgs; **no community PR has yet landed** via the opt-in contribution flow — track whether external contributions arrive and whether any `person` entry beyond `theo` is added (watch the consent-tier floor holds).
- **Eval maturity:** `evals/paired/report.md` is an honest n=1 null result. Track whether a richer fixture or multi-run harness surfaces a measurable skill effect (or whether the null result persists).
- **`node >=20` vs Bun CI / Node 24 release:** engines floor still Node 20 while CI runs Bun and release runs Node 24 — watch for divergence.
- **Docs workspace deps:** the zero-runtime-dep stance covers the published package (`files:` excludes `docs/`), but the `docs/` Bun workspace now carries its own Astro/build dependency tree — confirm it stays out of the shipped npm tarball (`npm pack --dry-run` is in the Fro Bot verification gate).

## Survey History

| Date       | HEAD      | Notes                                                                                       |
| ---------- | --------- | ------------------------------------------------------------------------------------------- |
| 2026-07-12 | `c7defd9` | Initial survey. Brand-new repo (created 2026-07-11). Four-in-one artifact (skill + Claude plugin/marketplace + npm CLI + registry). 2 seed profiles (`every`, `theo`). OIDC-trusted-publish + Changesets + `mrbro-bot` release. Zero runtime deps. **No Fro Bot workflow** — onboarding follow-up candidate. |
| 2026-07-31 | `a2a30b6` | Second survey. **Scaffold → shipped.** npm **v0.1.1 → v0.4.1**; live Astro/Starlight docs site at `mrbro.dev/dev-like/` (`site.yaml`, workspace `docs/`); registry **2 → 5** profiles (+`37signals`/`linear`/`oxide`, all org `self-published`, each shipping a generated skill in-repo); new `evals/paired/` A/B harness (honest n=1 null result). **All four prior onboarding threads resolved:** Fro Bot workflow (two-mode autoheal+pr-review, agent **v0.96.0**, invariant-encoding prompts, rolling "Fro Bot Autoheal" issue), Renovate (`renovate.json5` extends [[marcusrbrown--renovate-config]]), Probot Settings (`settings.yml` extends `.github:common-settings.yaml`, gates `main` on `validate`+`Fro Bot`). Zero runtime deps holds. Stars 1→2, forks 0→1, +`portfolio` topic. Remaining gap: no CodeQL/Scorecard. |
