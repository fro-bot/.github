---
type: repo
title: "marcusrbrown/dev-like"
created: 2026-07-12
updated: 2026-08-30
sources:
  - url: https://github.com/marcusrbrown/dev-like
    sha: c7defd9c89568909f8a598b1e3d37b204414e257
    accessed: 2026-07-12
  - url: https://github.com/marcusrbrown/dev-like
    sha: a2a30b693f46bb55baf47b2a9788df36e90d1b35
    accessed: 2026-07-31
  - url: https://github.com/marcusrbrown/dev-like
    sha: 218aa444da9e7ffafffecfdbae50b6229427c6c6
    accessed: 2026-08-30
tags: [agent-skills, claude-code, plugin, marketplace, npm, cli, registry, osint, engineering-culture, changesets, bun, mit, provenance, fro-bot-workflow, autoheal, astro-starlight, evals, renovate-automerge, steady-state]
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

**The third survey (2026-08-30, HEAD `218aa444`) finds the ship at anchor.** Thirty commits in four weeks, every one a `mrbro-bot[bot]` Renovate automerge; the blob path list is byte-identical to `a2a30b6` (135 files at both SHAs), and `ci.yaml` / `renovate.json5` / `settings.yml` / `package.json` / `README.md` / `AGENTS.md` / `registry/index.json` are byte-identical too. No new profile, no publish since 2026-07-20. See [Delta Log — 2026-08-30](#delta-log--2026-08-30-steady-state-null-verdict-interval).

## Overview

Values reflect the **2026-07-31 survey** (HEAD `a2a30b6`); the parenthetical shows the 2026-07-12 initial-survey value where it changed.

**Re-verified at the 2026-08-30 survey** (HEAD `218aa444`, repo id `1297795539`, `private: false`): every row below still holds except **Stars / Forks → 2 / 0** (a fork was removed) and **Open issues → 2** (`#41` Dependency Dashboard, `#10` rolling autoheal; **0 open PRs**). `package.json` is byte-identical, so package version, license, engines, workspaces, and the zero-runtime-dep stance are unchanged. Repo `updated_at` 2026-08-29, `pushed_at` 2026-08-28, size 2073 KB, 7 topics, `main` default, not archived, discussions off.

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

## Ecosystem constraints captured in DESIGN.md (file removed — see correction)

> **Correction (2026-08-30, contradiction with the 2026-07-31 entry).** `DESIGN.md` and `LAUNCH.md` were present at the **initial** survey SHA `c7defd9` (2026-07-12, 31 blobs) but are **absent** from the tree at `a2a30b6` (2026-07-31) and at `218aa444` (2026-08-30). The 2026-07-31 survey carried this section forward without re-verifying the file's existence. The ecosystem facts below remain the best record of the constraints the repo was designed against and are retained as durable knowledge, but they should be read as **dated July-2026 design context, not a live file**. The surviving in-repo invariant sheet is the 15-line `AGENTS.md` (see below); the narrative material largely lives on in `docs/` (`docs/brainstorms/`, `docs/plans/`, the Starlight content tree).

The (removed) `DESIGN.md` recorded durable, dated (July 2026) facts about the agent-skills ecosystem this repo targets:

- **Spec:** agentskills.io — `SKILL.md` + YAML frontmatter (`name`, `description` required; `metadata` map; `allowed-tools` experimental). Directory name must match `name`. Progressive disclosure: ~100-token metadata → <5k-token body → on-demand references/scripts.
- **`.agents/skills/` is the vendor-neutral project path** (Codex, Cursor, Copilot, Gemini CLI, Amp, opencode, Cline, Warp, +30). Claude Code uses `.claude/skills/`. `npx skills add` (skills.sh, Vercel) symlinks one canonical copy into all detected harnesses — **55 supported**.
- **Claude Code:** commands are merged into skills; a plugin named `dev-like` with a root `SKILL.md` yields the bare `/dev-like` command. `$ARGUMENTS`, `argument-hint`, `context: fork` available. Marketplace = repo with `.claude-plugin/marketplace.json`.
- **Distribution reality:** skills are distributed from _git repos_ (skills.sh indexes installs); npm is for the CLI, not the skill content. dev-like ships both from one repo.
- **Positioning gap:** docs→skill generators and OSINT dev-profilers (GitRoll) and culture-as-plugin (Every's ~23k-star compound-engineering-plugin) all exist separately; nobody combines multi-source culture profiling → installable skill. That synthesis is the product.

## Invariant sheet & institutional memory (recorded 2026-08-30; present since ≤2026-07-31)

Two structures were present at the 2026-07-31 SHA but went unrecorded; both are durable and worth naming.

**`AGENTS.md` is a 15-line invariant sheet, not a handbook.** It states six things and stops: the four-artifact identity; zero-runtime-deps-is-a-feature; `scripts/validate.mjs` enforces registry invariants and persons require consent tier `stated` or better; provenance is non-negotiable (no claim without a source URL, in profiles *and* in generated skills); design-for-deletion (nothing outside `registry/<slug>/` and `registry/index.json` may reference a slug); and a pointer to `docs/solutions/`. The inline Fro Bot prompts are far longer than the file they defer to — the agent guardrails are the elaboration, `AGENTS.md` is the axiom set.

**`docs/solutions/` is a compound-docs corpus** — 9 categorized past-problem writeups across `best-practices/`, `integration-issues/`, `test-failures/`, `workflow-issues/`, each with YAML frontmatter (`module`, `tags`, `problem_type`) for retrieval. This is the **same convention `fro-bot/.github` itself uses** for `docs/solutions/`, arrived at independently in a repo whose whole thesis is packaging other shops' practices. Sampled entries are specific and unglamorous — `bun-changesets-oidc-release-pipeline`, `astro-component-scripts-are-per-page`, `mdx-bypasses-markdown-pipeline`, `renovate-pinned-dependency-without-bun-lockfile-refresh`, `assert-workflow-action-pinning-invariants-not-exact-shas`, `live-data-fixtures-break-on-data-improvement`, `scrub-tracked-file-from-public-git-history`. The last two are the receipts for choices visible elsewhere in the tree (the removed `DESIGN.md`/`LAUNCH.md` and the Renovate `evals/**` ignore).

Also under-recorded: `.github/ISSUE_TEMPLATE/{optout,profile-request}.yml` + `config.yml` + `PULL_REQUEST_TEMPLATE.md` — the `registry/OPTOUT.md` removal path is a **first-class issue form**, not just prose. An ethics policy with a form attached is an ethics policy someone can actually use.

## Docs site (`docs/`, landed 2026-07-31)

The planned Astro docs site from `DESIGN.md` has shipped as a Bun **workspace** (`docs/`) built on **Astro + Starlight**, deployed to `mrbro.dev/dev-like/` via `site.yaml`:

- Content in `docs/src/content/docs/` — `index.mdx` landing, `ethics.mdx`, and a `harness-support.md` matrix distinguishing **Verified** (install + invocation run end-to-end) from **Staged** (files land but live invocation unconfirmed): Claude Code (plugin marketplace + `npx skills add`) and GitHub Copilot CLI are Verified; Codex is Staged. Full transcripts live in `docs/demo/cross-harness-verification-2026-07-11.md`.
- Build-time **registry → docs pages** generation (`docs/scripts/generate-registry-pages.ts`) plus dynamic **OG-image** endpoints (`docs/src/pages/og/[...slug].png.ts`, `docs/src/lib/og-image.ts`), analytics (`docs/src/lib/analytics.ts`), and internal-link checking (`docs/scripts/check-internal-links.ts`). Custom components: `BeforeAfter`, `CopyCommand`, `Head`, `Header`.
- A `docs/tests/` suite (Bun) covers landing, link-check, registry-page generation, OG/analytics, and the site workflow.
- `docs/demo/` holds dated dry-run transcripts (`every`, `oxide`, `37signals`) and artifact-first / imperative-template evals — the receipts backing the profiles.

## Paired eval harness (`evals/`, landed 2026-07-31)

`evals/paired/` is an honest, self-critical **A/B eval** of whether an installed `develop-like-*` skill changes agent behavior. `run.mjs` drives a paired run over `evals/paired/fixture/` (a small `orders.js` bug-fix task): **ARM** has `develop-like-every` installed via `bin/cli.mjs`, **CONTROL** is the identical fixture with no skill. Results in `results/{arm,control}.jsonl` + `report.md`.

The `report.md` verdict is a documented **honest null result** at n=1: the skill *loaded* (ARM invoked it; CONTROL did not) and shifted tool-use/turn counts (6 vs 2 tool calls, 13 vs 7 turns) but did **not** move the signals that matter — plan-before-mutation, test-file-touched, ran-tests were flat across both arms. The report foregrounds its own determinism caveat (single run, not statistically powered) rather than overclaiming. This is a notable culture tell: the repo evaluates its own product skeptically and publishes the negative result. Renovate deliberately ignores `evals/**` so its intentionally-pinned fixtures aren't bumped.

### Second harness: `evals/triggers/` (recorded 2026-08-30; present since ≤2026-07-31)

The prior survey saw only the paired harness. There is a **second, structurally different eval**: `evals/triggers/` measures whether a skill's frontmatter `description` alone makes a judge load-or-skip correctly. Method is skill-creator style — a fresh judge sees **only** the `description`, then rules on 10 should-trigger + 10 near-miss prompts, ×3 independent repetitions (60 verdicts per skill). The near-miss sets are adversarial by design, targeting the exact collisions the naming invites: `"Every"` the company vs `every` the quantifier, `"Oxide"` the company vs oxidation vs Rust-on-bare-metal, and profiling-an-application vs profiling-a-culture.

Results (2026-07-11) are **10/10 trigger, 10/10 skip, 0 unstable rows** for `dev-like`, `develop-like-every`, and `develop-like-oxide`. The notes record the fix that got there: `develop-like-every`'s `({{kindLabel}})` disambiguator ("Every (the company)") was added *after* an earlier probe flagged the bare word as collision-prone, and the 60-verdict run above is post-fix. The README instructs a re-run whenever a description changes.

Taken together the two harnesses are a coherent evidence posture rather than a marketing one: the trigger evals show a **positive** result on a question the repo can actually control (does the description route correctly), while the paired harness publishes a **null** result on the harder question (does the skill change downstream behavior). Reporting both, unweighted, is the same "no source, no claim" discipline applied to its own efficacy claims.

## Notable patterns

- **OSINT-to-skill pipeline:** the novel synthesis — public engineering "exhaust" (shipped agent configs, linter/CI files, blogs, talks) → cited culture profile → installable per-harness skill. Provenance links are simultaneously the ethics story, the marketing hook ("with receipts"), and the anti-hallucination guardrail.
- **Consent tiers as a schema-enforced ethics floor:** the `person` → `stated`-or-better rule is encoded in JSON Schema (`allOf`/`if`/`then`), not left to reviewer discretion. Revealed preference (shipped configs) is explicitly ranked above stated preference.
- **Design-for-deletion registry:** `AGENTS.md` mandates that nothing outside `registry/<slug>/` and `registry/index.json` may reference a registry slug — each profile is removable in isolation (mirrors the design-for-deletion discipline seen in [[marcusrbrown--mothership]]).
- **Zero-runtime-dependency stance:** the CLI touches nothing beyond `raw.githubusercontent.com`, no telemetry, no postinstall. Adding a dependency requires explicit justification.
- **Thin-CLI / smart-skill split:** `bin/cli.mjs` does deterministic resolve + install of _cached_ profiles only; live profiling is explicitly deferred to the LLM-backed `/dev-like` skill ("Uncached targets: run `/dev-like <target>` in your agent instead").
- **Prompt-encoded invariant boundaries (2026-07-31):** unlike the fleet-standard three-mode `fro-bot.yaml`, dev-like runs a **two-mode** (autoheal + pr-review) workflow whose inline prompts hard-code the repo's own invariants as agent guardrails — zero-runtime-deps, human-gated registry/consent/OPTOUT/profile edits, no release-pipeline edits, mandatory changesets, and explicit verification gates before any PR. The repo teaches its autonomous maintainer the same rules `AGENTS.md` teaches humans, so provenance/consent ethics survive automation.
- **Skeptical self-evaluation (2026-07-31, extended 2026-08-30):** the `evals/paired/` harness publishes an honest **null result** on its own flagship skill rather than a marketing number, with a foregrounded n=1 determinism caveat. The companion `evals/triggers/` harness publishes a **positive** result (60 verdicts/skill, 10/10 trigger + 10/10 skip, adversarial near-miss sets) on the narrower question of description routing — and records the pre-fix failure that motivated the `({{kindLabel}})` disambiguator. Publishing both, unweighted, is "no source, no claim" turned inward.
- **Converged-autoheal null-verdict steady state (2026-08-30):** 53 daily runs, one rolling issue, zero PRs, zero issue spam. The prompt's explicit "if no safe fix exists, do not open a PR" clause plus reopen-not-spam issue lookup make *doing nothing* a first-class, reportable outcome. Most fleet repos accrete an agent-authored PR backlog instead; dev-like's daemon converges and stays converged. The distinguishing prompt property is that it grants a null verdict, so the agent is never pressured into speculative work to justify the run.
- **Automerge-covered surface ⇒ no backlog (2026-08-30):** with zero runtime deps and a 135-file tree, dev-like's entire mutable surface at rest is *action pins* — which Renovate automerges. Result: 30 commits and 0 open PRs in four weeks. The propose-without-merge backlogs elsewhere in the fleet ([[marcusrbrown--sparkle]], [[marcusrbrown--mrbro-dev]]) are a merge-gate-plus-surface-area problem, not an agent-productivity problem. This repo is the control case.
- **Invariant enforcer that skips its own manifest (2026-08-30):** `registry/index.json` declares a `$schema` that doesn't exist, and neither `validate.mjs` (never resolves `$schema`) nor `check-links.mjs` (only checks `https://` provenance URLs) can see it. The per-entry schema is rigorously enforced; the index above it isn't checked at all. A reminder that validation coverage tends to stop one level short of the thing doing the validating.

## Delta Log — 2026-08-30 (steady-state, null-verdict interval)

Third survey. HEAD `218aa444` (`chore(deps): update fro-bot/agent to v0.105.1 (#94)`, 2026-08-28T12:19Z), up from `a2a30b6` (2026-07-31). Public confirmed (`private: false`, id `1297795539`). Reads limited to directory listings, README/manifest/workflow files, and the unauthenticated public GitHub API — `gh` had no token (`GH_TOKEN` unset), the same credential gap tracked across the fleet.

### The tree did not move

**30 commits since 2026-07-31, all `mrbro-bot[bot]` Renovate automerges.** Zero human commits, zero feature commits. Tree-level proof: the recursive blob path list is **byte-identical** at `a2a30b6` and `218aa444` (135 files each, `diff` empty). File-level proof: `.github/workflows/ci.yaml`, `site.yaml`, `link-check.yaml`, `.github/renovate.json5`, `.github/settings.yml`, `package.json`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, and `registry/index.json` all diff clean. `fro-bot.yaml` differs on exactly **one line** — the agent pin.

Everything the prior page describes structurally — four-in-one artifact, seven workflows, two-mode Fro Bot, consent-tier schema floor, zero runtime deps, docs workspace, both eval harnesses — is durable and re-confirmed.

### What actually changed (dependency churn only)

| Pin                                   | 2026-07-31   | 2026-08-30   | Notes                                                        |
| ------------------------------------- | ------------ | ------------ | ------------------------------------------------------------ |
| `fro-bot/agent`                       | `v0.96.0` (`c29ac29`) | **`v0.105.1`** (`e9501a9`) | 12 merged bumps; crosses cosmetic v0.100, still 0.x. Ties [[marcusrbrown--sparkle]] and [[marcusrbrown--dotfiles]] at the fleet front |
| `bfra-me/.github` reusable workflows  | `v4.16.42`   | **`v4.22.0`** | Both `renovate.yaml` and `update-repo-settings.yaml`; 12 minor releases of [[bfra-me--github]] consumed without incident |
| `npm` (release OIDC prereq)           | `11.18.0`    | `11.19.0`     | `release.yaml` global install; OIDC trusted-publish floor is `>= 11.5.1` |
| `playwright` (docs devDep)            | `1.62.0`     | `1.62.1`      | Only manifest change in `docs/package.json` + `bun.lock`      |
| `actions/checkout` / `oven-sh/setup-bun` | v6.1.0 / v2.2.0 | unchanged | Still full-SHA pinned                                        |

Docs workspace pins otherwise held: Astro `^7.0.0`, Starlight `^0.41.0`, `astro-og-canvas ^0.11.0`, `rehype-mermaid ^3.0.0`, `sharp ^0.35.0`, `canvaskit-wasm 0.41.1`, `remark-gfm 4.0.1`. Root devDep still the single `@changesets/cli 2.31.1`. **Zero runtime deps holds** — third consecutive survey.

### Publish drought: ~40 days

npm `dev-like` `dist-tags.latest` is still **`0.4.1`**, published **2026-07-20**. All six releases (`0.1.1` → `0.4.1`) landed in a **9-day burst** (2026-07-11 → 07-20); nothing since. GitHub releases agree (latest `v0.4.1`, 2026-07-20). The dual tag scheme is confirmed: `v0.4.1` and `dev-like@0.4.1` both point at `a443887` — that is the `alias-release.ts` / `bun run alias-release` step doing its job.

Registry frozen with it: still **5 profiles**, and every `updated` field in `registry/index.json` is unchanged (`37signals` 2026-07-16, `every` 2026-07-11, `linear` 2026-07-16, `oxide` 2026-07-11, `theo` 2026-07-11). The registry-growth thread from 2026-07-31 gets a hard answer for this window: **no growth, and still no community PR**. The consent-tier floor holds trivially because nothing was added.

`site.yaml` is path-filtered on `docs/**`/`registry/**`; its last run was **2026-08-03**. The docs site isn't broken, it's simply had nothing to rebuild.

### Queue inversion: zero open PRs

**Open PRs: 0. Open issues: 2** — `#41 Dependency Dashboard` (`mrbro-bot[bot]`) and `#10 Fro Bot Autoheal` (the rolling issue). Every Renovate PR in the window (#65–#94) opened and merged, most same-day.

This is the **inverse** of the propose-without-merge backlog documented at [[marcusrbrown--sparkle]] (15 open PRs, 13 fro-bot-authored, none merging) and [[marcusrbrown--mrbro-dev]] (4 carried PRs, trunk frozen 29 days, a security remediation unmerged ~23 days). Same daemon, same operator, opposite queue behavior. The discriminator isn't the agent — it's that dev-like's entire mutable surface at rest is *action pins*, which Renovate automerges without a human in the loop, and there is no accumulating agent-authored work for a human gate to stall on. Small surface + automerge coverage = no backlog. A useful control case: the fleet's PR backlogs are a merge-gate problem, not an agent-productivity problem.

### Converged autoheal: 53 comments, no PRs

Rolling issue `#10` (opened 2026-07-15) now carries **53 comments** from daily scheduled runs. Every recent verdict is a variant of **"No safe fix found. Repo remains healthy. No PR opened."** Sampled runs (2026-08-15, 08-24, 08-25, 08-27, 08-28, 08-29) walk the prompt's four categories in strict order and terminate clean each time: CI/Release/Site/Link-Check all green; Dependabot shows 4 historical alerts (Astro XSS ×3, sharp/libvips) all `state: fixed` with zero open; `bun run validate` passes on the skill + 5 registry entries; no open PRs to deduplicate against.

The design is doing exactly what it was written to do. The prompt's "if no safe fix exists, do not open a PR — update the rolling issue instead" clause plus the reopen-not-spam issue lookup produce a **stable null-verdict steady state**: 6 weeks of daily runs, one issue, zero speculative PRs, zero issue spam. Contrast the six near-identical stacked `chore(lint)` PRs at [[marcusrbrown--sparkle]]. Cataloged in [[github-actions-ci]].

### New finding: a comment delivered as a literal `@path`

The 2026-08-26 autoheal comment on `#10` ([`issuecomment-5427087533`](https://github.com/marcusrbrown/dev-like/issues/10#issuecomment-5427087533)) has a body that is, in full, the 40-character string:

```
@/tmp/opencode/autoheal-comment-final.md
```

That is an unexpanded file-reference argument. `gh issue comment --body "@/path/to/file"` does **not** read the file — `@`-expansion is not a `--body` feature; `--body-file <path>` is the flag that reads from disk. The run wrote its report to a temp file and then handed the path to the wrong flag, so a full autoheal report was silently replaced by a dangling pointer to a file on a runner that no longer exists. One report of 53 evaporated, and nothing flagged it: the workflow step succeeded, the comment posted, the issue looked updated.

This is a durable agent-delivery footgun, not a dev-like bug — any agent that composes long output to a temp file and posts it via `gh` can hit it. Cataloged in [[github-actions-ci]].

### New finding: dangling `$schema` in `registry/index.json`

`registry/index.json` opens with `"$schema": "./schema/index.schema.json"`. That file does not exist — `registry/schema/` contains **only** `entry.schema.json` (the raw URL for `index.schema.json` returns 404 at HEAD).

Neither gate catches it. `scripts/validate.mjs` reads `index.json` with `JSON.parse` and never resolves `$schema` (its only interaction with the schema directory is skipping the name `schema` when enumerating slug dirs). `scripts/check-links.mjs` is a **provenance link-rot checker** scoped to `https://` URLs cited from `entry.json`/`profile.md` — relative paths are out of scope by construction. So autoheal category 3 ("schema / generated drift") has reported clean across all 53 runs while the registry's own manifest points at a schema that isn't there.

Low severity — it's an editor/tooling hint, not a validation dependency, and the per-entry `entry.schema.json` (which *does* exist and *is* enforced) carries the real invariants including the `person` → `stated`-or-better `allOf`. But it is exactly the class of drift this repo's thesis is built on catching, sitting one directory above the validator. Two fixes, either fine: author `registry/schema/index.schema.json`, or drop the `$schema` line. The interesting part is the meta-lesson — **an invariant enforcer that doesn't validate its own manifest**.

### Prompt boundaries not previously recorded

The `AUTOHEAL_PROMPT` body is byte-identical to 2026-07-31, but the prior page under-recorded it. Two boundaries deserve naming:

- **"Do not re-enable Renovate."** Renovate is unambiguously live (all 30 commits are its work), so this reads as a scoped guard — most plausibly against the agent unwinding the `evals/**` ignore in `renovate.json5` that keeps the intentionally-pinned eval fixtures frozen. Worth re-confirming intent next survey.
- **"Do not delete dead code flagged by AFT or any tool without independently verified evidence it is unreachable."** A named-tool skepticism clause: the agent may not act on a static-analysis reachability claim it hasn't independently corroborated. Sensible in a repo where "generated skill" files legitimately look unreferenced.

Also: the four autoheal categories are an explicit **strict-order ladder with early exit** — (1) CI/site/link-check/Fro-Bot failures, (2) security advisories, (3) schema/generated drift, (4) docs/tests/changesets/artifact hygiene — "stopping at the first category with a safe, evidence-backed fix." And `PR_REVIEW_PROMPT` explicitly forbids invoking `ce:review` or any `ce:*` authoring workflow ("this is a focused, single-pass review, not a formal review pipeline run"), plus a hard review-only mode (no edits, commits, branches, or PR modification beyond comments) and a fixed four-heading verdict structure.

### Security posture

Unchanged and re-confirmed by the daemon's own probes: **code scanning is not enabled** (the API returns 404, no analysis configured), so the no-CodeQL/Scorecard gap carries into a second survey. Dependabot is active with 4 historical alerts, all fixed, zero open. Renovate + the `bfra-me/.github` reusable workflows carry the dependency-advisory path — the same division of labor [[fro-bot--dashboard]] landed on. Given a repo with zero runtime deps and a 135-file surface, the marginal value of CodeQL here is genuinely lower than elsewhere in the fleet; Scorecard is the cheaper win.

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

**Still open / new** (status as of the 2026-08-30 survey):

- **No CodeQL/Scorecard** — carried, second survey. Autoheal's own probe confirms code scanning returns 404 (not configured). Dependabot + Renovate + `bfra-me/.github` reusable workflows cover the advisory path; Scorecard is the cheap remaining win. Candidate for a follow-up draft PR.
- **Registry growth stalled** — 2 → 5 profiles in the first 3 weeks, then **0 in the next 4** (all `updated` fields byte-identical). Still **no community PR** via the opt-in contribution flow, and still one `person` entry (`theo`). Open question: is the registry deliberately curated-slow, or is the contribution funnel not converting? The `profile-request.yml` issue form exists and has produced nothing.
- **Publish drought ~40 days** — npm latest `0.4.1` (2026-07-20); six releases in a 9-day burst then silence. Track whether the next substantive change resumes the Changesets cadence or whether the project has reached a deliberate feature-complete rest state.
- **`registry/schema/index.schema.json` missing** (NEW) — `registry/index.json`'s `$schema` points at a file that doesn't exist; invisible to both `validate.mjs` and `check-links.mjs`. Either author the schema or drop the line. Re-check next survey.
- **`--body` vs `--body-file` `@path` leak** (NEW) — one autoheal comment (2026-08-26) posted as the literal string `@/tmp/opencode/autoheal-comment-final.md`. Confirm whether this recurs; if so it's a harness-side fix, not a repo-side one.
- **"Do not re-enable Renovate" boundary** (NEW) — the autoheal prompt forbids it while Renovate is demonstrably live. Confirm the intended scope (most likely the `evals/**` ignore in `renovate.json5`) rather than assuming it's stale copy.
- **Eval maturity** — `evals/paired/report.md` is still an honest n=1 null result; `evals/triggers/` results are dated 2026-07-11 and its README mandates a re-run whenever a description changes. Neither has been re-run this window. Track whether a richer fixture surfaces a measurable skill effect.
- **`node >=20` vs Bun CI / Node 24 release** — engines floor still Node 20 while CI runs Bun and release runs Node 24 (now on `npm@11.19.0`). Unchanged; watch for divergence.
- **Docs workspace deps** — the zero-runtime-dep stance covers the published package (`files:` excludes `docs/`), but the `docs/` Bun workspace carries its own Astro 7 / Starlight / sharp / canvaskit tree. `npm pack --dry-run` remains in the Fro Bot verification gate; still holding.
- **Site workflow dormancy** — `site.yaml` last ran 2026-08-03 (path-filtered, nothing to rebuild). Benign now, but a long-dormant deploy path is a path whose next run is unrehearsed. Worth a re-verify if `docs/**` moves after a long gap.
- **Wiki-side: page size** (housekeeping) — this page is now ~5.6k words, past `schema.md`'s 500–2000 word guidance. Repo-page filenames are load-bearing (the promotion gate attributes by `{owner}--{repo}` slug), so a split must extract *topic* pages rather than shard the repo page. The natural candidates are the registry/consent-model and eval-harness sections, both of which are really cross-cutting Agent-Skills-ecosystem material. Deferred to lint rather than done unilaterally mid-survey.

## Survey History

| Date       | HEAD      | Notes                                                                                       |
| ---------- | --------- | ------------------------------------------------------------------------------------------- |
| 2026-07-12 | `c7defd9` | Initial survey. Brand-new repo (created 2026-07-11). Four-in-one artifact (skill + Claude plugin/marketplace + npm CLI + registry). 2 seed profiles (`every`, `theo`). OIDC-trusted-publish + Changesets + `mrbro-bot` release. Zero runtime deps. **No Fro Bot workflow** — onboarding follow-up candidate. |
| 2026-08-30 | `218aa444` | Third survey. **Steady state — the tree did not move.** 30 commits, all `mrbro-bot[bot]` Renovate automerges; recursive blob path list byte-identical to `a2a30b6` (135 files); `ci.yaml`/`renovate.json5`/`settings.yml`/`package.json`/`README.md`/`AGENTS.md`/`registry/index.json` all diff clean; `fro-bot.yaml` differs on one line. Deltas: agent **v0.96.0 → v0.105.1** (`e9501a9`, 12 bumps, crosses cosmetic v0.100), `bfra-me/.github` reusable **v4.16.42 → v4.22.0**, `npm` 11.18.0 → 11.19.0, `playwright` 1.62.0 → 1.62.1. **Publish drought ~40 days** (npm latest `0.4.1`, 2026-07-20; all six releases in a 9-day July burst); **registry frozen at 5** profiles, no community PR. **Queue inverted vs the fleet: 0 open PRs**, 2 open issues (#41 Dependency Dashboard, #10 rolling autoheal) — every Renovate PR merged same-day. **Converged autoheal:** 53 comments on #10, all "No safe fix found. Repo remains healthy. No PR opened." Two new findings: **(1)** the 2026-08-26 autoheal comment posted as a literal `@/tmp/opencode/autoheal-comment-final.md` (`gh --body` doesn't expand `@`; `--body-file` does) — one of 53 reports lost silently; **(2)** `registry/index.json` `$schema` points at a nonexistent `registry/schema/index.schema.json`, invisible to both `validate.mjs` and `check-links.mjs`. **Correction:** `DESIGN.md`/`LAUNCH.md` were absent already at `a2a30b6` — the 2026-07-31 page carried that section forward unverified. Recorded late: 15-line `AGENTS.md` invariant sheet, 9-doc `docs/solutions/` compound-docs corpus (same `module`/`tags`/`problem_type` convention as `fro-bot/.github`), `evals/triggers/` second harness (60 verdicts/skill, 10/10 + 10/10), OPTOUT issue forms, and the "no re-enable Renovate" / AFT-skepticism autoheal boundaries. Gap carried: no CodeQL/Scorecard (code scanning API 404). Stars 2, forks 1 → 0. |
| 2026-07-31 | `a2a30b6` | Second survey. **Scaffold → shipped.** npm **v0.1.1 → v0.4.1**; live Astro/Starlight docs site at `mrbro.dev/dev-like/` (`site.yaml`, workspace `docs/`); registry **2 → 5** profiles (+`37signals`/`linear`/`oxide`, all org `self-published`, each shipping a generated skill in-repo); new `evals/paired/` A/B harness (honest n=1 null result). **All four prior onboarding threads resolved:** Fro Bot workflow (two-mode autoheal+pr-review, agent **v0.96.0**, invariant-encoding prompts, rolling "Fro Bot Autoheal" issue), Renovate (`renovate.json5` extends [[marcusrbrown--renovate-config]]), Probot Settings (`settings.yml` extends `.github:common-settings.yaml`, gates `main` on `validate`+`Fro Bot`). Zero runtime deps holds. Stars 1→2, forks 0→1, +`portfolio` topic. Remaining gap: no CodeQL/Scorecard. |
