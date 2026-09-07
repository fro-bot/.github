---
type: repo
title: marcusrbrown/marcusrbrown
created: 2026-04-18
updated: 2026-09-07
node_id: MDEwOlJlcG9zaXRvcnkzMTk5Mjg2NjE=
sources:
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: 958be8df530c79e6313a24c9abec0f8f19012de8
    accessed: 2026-09-07
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: df85b7dfaea37c0f1e74ba2c21f04b61b89fceed
    accessed: 2026-08-19
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: abff9705c315aa203fd5449648f4b27813cdd1a6
    accessed: 2026-07-20
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: 08bd1ad6665563867e17d174a098ce9cf1a39ddc
    accessed: 2026-07-06
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: 3ed89ff3878705f43aa1e17c0def2f6f71efa077
    accessed: 2026-06-22
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: b26dd18884df26ac593c8d423ed0ed8b0e9bb393
    accessed: 2026-06-12
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: e39577cba2ef663d8fd25ff9b26c66f8b3460a42
    accessed: 2026-06-02
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: de594cdd416b60d92caba6684492659620a22439
    accessed: 2026-05-18
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/marcusrbrown
    sha: af78e68d510b24152531f7fdafe9bff35a58f071
    accessed: 2026-04-18
tags:
  - profile-readme
  - typescript
  - github-actions
  - automation
  - badges
  - sponsors
  - readme-scribe
  - fro-bot
  - propose-without-merge
  - required-checks
  - retention-policy
  - generated-content
  - supply-chain-cooldown
aliases:
  - marcusrbrown-profile
related:
  - marcusrbrown--ha-config
  - marcusrbrown--github
  - marcusrbrown--mrbro-dev
  - marcusrbrown--marcusrbrown-com
  - bfra-me--ha-addon-repository
  - bfra-me--renovate-action
  - marcusrbrown--systematic
  - marcusrbrown--cortexkit-anthropic-auth
  - fro-bot--agent
  - github-actions-ci
---

# marcusrbrown/marcusrbrown

Marcus R. Brown's GitHub profile README repository. A TypeScript-powered automation system that generates and maintains his public GitHub profile, including sponsor tracking, badge automation, A/B content testing, and scheduled profile updates via [[github-actions-ci]].

## Overview

- **Purpose:** GitHub profile README with automated content generation
- **Default branch:** `main`
- **Language:** TypeScript
- **Created:** 2020-12-09
- **Last push:** 2026-09-07 (was 2026-07-20 at the 2026-08-19 survey)
- **Repo id / `node_id`:** `319928661` / `MDEwOlJlcG9zaXRvcnkzMTk5Mjg2NjE=`
- **License:** MIT
- **Topics:** `github`, `readme-profile`, `profile-readme`, `awesome-readme`, `typescript`, `markdown`
- **Collaborators:** `marcusrbrown` (admin), `fro-bot` (push)

## Repository Structure

This is not a simple static README. It is a full TypeScript project with templating, API integrations, testing, and CI automation.

### Key Directories

| Directory    | Purpose                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `templates/` | Mustache-style `.tpl.md` templates for generated content                     |
| `scripts/`   | TypeScript CLI tools for badge updates, sponsor data, analytics, A/B testing |
| `utils/`     | Shared utilities (GitHub API client, logger, badge cache, shields.io client) |
| `types/`     | TypeScript type definitions (sponsors, badges, analytics)                    |
| `__tests__/` | Vitest unit tests for utilities and scripts                                  |
| `assets/`    | Profile images and static assets                                             |
| `docs/`      | Internal documentation (badge migration, conversion optimization)            |
| `.ai/`       | AI-generated content strategy docs and sponsor persona research              |
| `.agents/`   | Agent skills — incl. `sync-sponsors-bio/` (script-backed bio sync, added by 2026-06-02) |

### Generated Files (Do Not Edit Directly)

| Template                      | Output          |
| ----------------------------- | --------------- |
| `templates/README.tpl.md`     | `README.md`     |
| `templates/SPONSORME.tpl.md`  | `SPONSORME.md`  |
| `templates/BADGES.tpl.md`     | `BADGES.md`     |
| `templates/HIGHLIGHTS.tpl.md` | `HIGHLIGHTS.md` |

A/B test variants live in `templates/variants/` (e.g., `SPONSORME-benefits.tpl.md`, `SPONSORME-urgency.tpl.md`).

### Script Inventory

| Script                            | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `update-badges.ts`                | Fetches badge data from shields.io and updates BADGES.md |
| `update-sponsors.ts`              | Generates SPONSORME.md from fetched sponsor data         |
| `fetch-sponsors-data.ts`          | Retrieves sponsorship data from GitHub GraphQL API       |
| `profile-analytics.ts`            | Collects and reports profile analytics                   |
| `ab-test-cli.ts`                  | CLI for running content A/B tests                        |
| `ab-testing-framework.ts`         | Core A/B testing logic                                   |
| `content-performance-tracking.ts` | Content performance monitoring                           |
| `mobile-responsiveness-tester.ts` | Mobile layout verification                               |

### Utility Modules

| Module                   | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `github-api.ts`          | Octokit-based GitHub API client                  |
| `logger.ts`              | Structured logger with emoji prefixes            |
| `badge-cache-manager.ts` | Badge data caching                               |
| `badge-config-loader.ts` | Badge configuration from `@bfra.me/badge-config` |
| `badge-detector.ts`      | Technology detection for auto-badging            |
| `shield-io-client.ts`    | shields.io API client                            |

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR to `main`, dispatch | Lint (markdownlint + tsc + eslint) |
| Update GitHub Profile | `update-profile.yaml` | push/PR, every 6 hours, dispatch | Generate profile content and commit/PR |
| Renovate | `renovate.yaml` | issue/PR edit, push, dispatch, Main completion | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push to `main`, daily cron, dispatch | Probot settings sync |
| Cleanup Cache | `cleanup-cache.yaml` | PR close, weekly, dispatch | Prune stale GHA cache entries |
| **Fro Bot** | `fro-bot.yaml` | PR events, issues (opened/edited), `@fro-bot` mentions, cron 04:30 + 16:30 UTC, dispatch | Three-mode agent: PR review / autoheal / maintenance (added 2026-06-02; `fro-bot/agent@v0.109.4` SHA-pinned `b799b64` as of 2026-09-07; `Fro Bot` is a required `main` status check since #1138 2026-08-09 — **but the job guard skips `[bot]` authors and `fro-bot` by name, so the required context resolves `skipped ⇒ pass` on ~98% of this repo's PRs**) |

All six workflows are `state: active`; the last 25 scheduled `Fro Bot` runs are 25/25 `success` (2026-09-07).

**Trigger overlap worth knowing:** `update-profile.yaml` fires on `pull_request` as well as `push`/`schedule`, and on PRs it commits regenerated `BADGES.md`/`SPONSORME.md` straight to the PR head. Every open PR in this repo therefore accretes generated-content commits it did not ask for (#1094 carries 37, #1100 carries 28), which (a) makes `updated_at` useless as a liveness signal, (b) pollutes every diff, and (c) is why the two `chore(lint)` PRs went `dirty`. It is also why the profile pipeline's own PR never has anything left to merge — see the 2026-09-07 findings.

### Profile Update Pipeline (update-profile.yaml)

The core automation workflow:

1. **Prepare** (PR only) — `dorny/paths-filter` checks if relevant files changed
2. **Finalize** — Runs on push/schedule/dispatch, or on PRs with relevant changes:
   - Fetches sponsor data via GitHub GraphQL API (`pnpm sponsors:fetch`)
   - Generates `SPONSORME.md` from template (`pnpm sponsors:update`)
   - Fetches badge data from shields.io (`pnpm badges:fetch`)
   - Generates `BADGES.md` from template (`pnpm badges:update`)
   - Copies `HIGHLIGHTS.md` from template
   - Generates `README.md` via `muesli/readme-scribe` from `templates/README.tpl.md`
   - Runs `pnpm fix` to clean up formatting
   - On PRs: commits directly to HEAD via `EndBug/add-and-commit`
   - On main: opens a PR via `peter-evans/create-pull-request` on branch `build/update-readme`

Commits are authored by `mrbro-bot[bot]` (app ID 137683033).

### Branch Protection

Required status checks on `main`: **CI, Fro Bot, Renovate / Renovate, Prepare, Finalize** (the `Fro Bot` context was added 2026-08-09 via #1138 — the agent's PR-review verdict is now a hard merge gate, not advisory). Linear history enforced, admin enforcement enabled (`enforce_admins: true`, so Marcus is gated too), no required PR reviews.

### Shared Workflows

`renovate.yaml` and `update-repo-settings.yaml` reference reusable workflows from `bfra-me/.github` (v4.4.0 at initial survey; **v4.26.0** as of 2026-09-07, SHA `5310cfc`). Authentication uses `APPLICATION_ID` and `APPLICATION_PRIVATE_KEY` secrets (GitHub App).

This pin is a single point of failure for dependency automation, and it failed on 2026-09-04: v4.25.0 carried a [[bfra-me--renovate-action]] build whose runtime was missing `tar`, Renovate exited before servicing any dependencies, and therefore could not open the PR that would fix it. Marcus cut the loop by hand in #1194; Renovate re-proposed the identical bump as a no-op one commit later (#1195).

## Developer Tooling

- **Package manager:** pnpm 11.9.0 (enforced via `preinstall` script, `only-allow pnpm`; crossed 10→11 major 2026-06-27). A root `pnpm-workspace.yaml` now carries `allowBuilds`/`onlyBuiltDependencies` (`esbuild`, `simple-git-hooks`, `unrs-resolver`), `shamefullyHoist: true`, `savePrefix: ''`, and a GHSA-annotated security-override ledger (`jiti <2.8.0`, `vite 7.3.6`, `postcss >=8.5.10`, `picomatch`, `fast-uri >=3.1.2`).
- **Node.js:** 24.18.0 (pinned in `.mise.toml`)
- **TypeScript:** Extends `@bfra.me/tsconfig`. Path alias `@/` maps to project root.
- **ESLint:** Extends `@bfra.me/eslint-config` (0.50.1). Ignores `.ai/`, `.cache/`, copilot instructions.
- **Prettier:** `@bfra.me/prettier-config/120-proof` (120-char line width), v3.9.4 (crossed 3.8→3.9 minor 2026-06-30).
- **Vitest:** 4.0.18, test runner with `@/` path alias. Tests in `__tests__/`.
- **markdownlint-cli2:** 0.20.0, markdown linting for generated and template files.
- **simple-git-hooks + lint-staged:** Pre-commit hooks run ESLint fix on staged files.
- **Renovate:** Extends `marcusrbrown/renovate-config#5.2.4` and `sanity-io/renovate-config:semantic-commit-type`. Groups markdownlint packages. Post-upgrade runs `pnpm bootstrap && pnpm fix`. (Was `#4.5.1` at initial survey; crossed v4→v5 boundary during the 2026-05 thaw.)
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` (identical to [[marcusrbrown--ha-config]] pattern).
- **mise:** Manages Node.js version; adds `node_modules/.bin` to PATH.
- **llms.txt:** Provides LLM-readable project map at repo root.

### Key Dependencies

| Package                 | Version  | Purpose                             |
| ----------------------- | -------- | ----------------------------------- |
| `@octokit/graphql`      | ^9.0.1   | GitHub GraphQL API for sponsor data |
| `@octokit/rest`         | ^22.0.0  | GitHub REST API client              |
| `@octokit/types`        | ^16.0.0  | GitHub API type definitions         |
| `@bfra.me/badge-config` | 0.2.0    | Badge configuration package         |
| `vitest`                | 4.0.18   | Test runner                         |
| `tsx`                   | ^4.20.3  | TypeScript script execution         |
| `jiti`                  | 2.6.1    | TypeScript config loader            |

## Fro Bot Integration

### 2026-09-07 update: no structural change — and four green gates are each covering a different hole

Survey at HEAD `958be8d` (`chore(deps): update bfra-me/.github action to v4.26.0 (#1204)`, 2026-09-07). 41 commits since `df85b7d`, **40 of them `mrbro-bot[bot]` Renovate merges and exactly one human commit**; 10 files touched, of which 6 are pure version tokens and one is `pnpm-lock.yaml`. `fro-bot.yaml` is `+1/-1` — the agent pin, nothing else. Branch protection, prompts, triggers, crons, the composite `setup` action, and the `.github/settings.yml` context list are all byte-stable. By the usual measure this is the quietest window this page has recorded.

It is also the window in which the most things turned out to be broken. Every workflow is `active`, the last 25 scheduled `Fro Bot` runs are 25/25 `success`, `main` is green, and the daemon wrote a report every single day. None of the five findings below produced a red anywhere.

#### 1. The required `Fro Bot` check excludes the author who writes ~98% of the PRs

The 2026-08-09 change (#1138) that made `Fro Bot` a required status check on `main` is still in place, and it is doing much less than the prior section claimed. The job guard at `fro-bot.yaml:536-553` refuses two author classes:

```yaml
!endsWith(github.event.pull_request.user.login || '', '[bot]') &&
(github.event.pull_request.user.login || '') != 'fro-bot'
```

A skipped job reports as **passing** to branch protection. So on every `mrbro-bot[bot]` (Renovate) PR and every `fro-bot` PR, the required check resolves `skipped ⇒ green` without the agent ever reading the diff. In this 41-commit window the check evaluated **one** PR — #1194, the sole human-authored change.

This is the [[bfra-me--ha-addon-repository]] mechanism (cataloged in [[github-actions-ci]] as *A Required Check That Cannot Fail Loudly*) reappearing with a different payload. There the skip masked a dead daemon. Here the daemon is healthy and the skip hollows out the gate precisely where it would matter most: **the agent's own security PRs are certified `mergeable_state: clean` partly because the reviewer declined to review them.** Verified directly on #1094's head SHA `7c09752` — `CI: success`, `Prepare: success`, `Finalize: success`, `Renovate / Renovate: success`, **`Fro Bot: skipped`**.

The guard itself is correct — you do not want the agent grading its own homework, and you do not want it burning a run on every Renovate patch. The error is upstream of the guard: **making a self-excluding check *required* on a repo whose PR stream is almost entirely bot-authored buys the appearance of a gate and roughly none of the substance.**

#### 2. Four green, mergeable security PRs have been stranded 44–61 days

Six PRs are open. Five are `fro-bot`-authored, and four of those are remediation work that the repo's own `AUTOHEAL_PROMPT` category 2 (SECURITY) produced and then never delivered:

| PR | Subject | Opened | Age | Mergeable | Commits on branch |
| --- | --- | --- | --- | --- | --- |
| #1094 | `js-yaml` + `brace-expansion` overrides | 2026-07-21 | 48 d | `clean` | 37 |
| #1100 | `fast-uri` ≥3.1.5 + `linkify-it` override | 2026-07-22 | 47 d | `clean` | 28 |
| #1107 | `postcss` ≥8.5.23 override | 2026-07-25 | 44 d | `clean` | 22 |
| #1095 | `chore(lint)` auto-fixes | 2026-07-21 | 48 d | `dirty` | 6 |
| #1055 | `chore(lint)` auto-fixes | 2026-07-08 | 61 d | `dirty` | 21 |

These are not redundant re-proposals of pins already in the tree. Each raises a floor against advisories that postdate the existing ledger entry — #1107 moves `postcss` `>=8.5.10 → >=8.5.23` citing GHSA-r28c-9q8g-f849 (high) and two more; #1100 moves `fast-uri` `>=3.1.2 → >=3.1.5` citing three new GHSAs; #1094 adds `js-yaml >=4.3.1 <5` (high) and — the sophisticated bit — **per-parent-scoped** `brace-expansion` floors, `minimatch@3>brace-expansion: '>=1.1.16 <2'` and `minimatch@10>brace-expansion: '>=5.0.7'`, because two incompatible `minimatch` major lines pull it in. That is a correct, non-obvious fix written by the agent, sitting green for 48 days.

In the same window 40 Renovate PRs merged same-day. The only variable separating the two populations is automerge eligibility — the pattern first isolated on [[marcusrbrown--marcusrbrown-com]], confirmed here with a sharper cost: the stranded population is not cosmetic drift, it is **four unpatched high-severity transitive advisories on a repo where the daemon already did the work.**

The two `chore(lint)` PRs are the [[marcusrbrown--marcusrbrown-com]] DEDUPLICATION failure again, and this time the resolution is visible. #1055 (2026-07-08) and #1095 (2026-07-21) are near-identical proposals both patching the `scripts/update-sponsors.ts` fence generator; both are now `dirty`; and the fix actually landed via a **third** sibling, **#1117, merged 2026-08-10**. Two of the three siblings rot, conflicting with the merged one, and nothing closes them. The prior 2026-07-20 section recorded #1055 as evidence that "autoheal graduated from writing reports to shipping fixes" — **superseded**: #1055 never merged. The graduation was real, but it happened through a differently-numbered PR a month later.

#### 3. The profile pipeline has not delivered through its own path in 28 days — Renovate is delivering for it

This is the most consequential finding, and it is invisible from every dashboard.

`update-profile.yaml` runs on `push`, on `schedule` every 6 hours, **and on `pull_request`** — and on PRs it commits regenerated content directly to the PR head via `EndBug/add-and-commit`. Renovate PRs are PRs. So every dependency branch gets the freshly generated `BADGES.md`/`SPONSORME.md` written onto it, and that content merges to `main` as a rider on a `chore(deps)` commit.

The evidence is unambiguous. Every commit touching `BADGES.md` or `SPONSORME.md` in this window is a Renovate merge — `#1188 (pnpm v11.25.0)`, `#1190 (tsx v4.23.13)`, `#1186 (simple-git-hooks v2.14.0)`, and so on. Meanwhile:

- **The last `build:` commit on `main` is #1129, 2026-08-10 — 28 days ago.**
- **Ten consecutive `build/update-readme` PRs (#1140 → #1189) have been opened and every one closed unmerged or is still open.** Zero merged.
- **`README.md` has not changed on `main` since 2026-05-23 — 107 days**, across roughly 428 scheduled pipeline runs, all green.

The pipeline's own PR is reliably cannibalized: whatever Renovate merges first carries the same regenerated content to `main`, leaving `create-pull-request` with an empty or near-empty diff to close. The dedicated delivery path is a decoy that runs every six hours and goes green.

The coupling is load-bearing and undocumented: **profile freshness is now a function of Renovate PR volume.** This page already records what happens when that volume goes to zero — the 2026-03-12 → 2026-05-14 preset stall. Under today's topology that stall would have frozen the public profile for two months while `Update GitHub Profile` reported success 240 times. The PR body still asks a human to "review the changes and merge this pull request if you approve"; nobody has, ten times running.

#### 4. Nobody audits the generated artifact, only the process that generates it

Because generated content now rides in on dependency PRs, the diffs are visible in the commit graph — and they show the badge generator producing wrong output on `main` right now:

- **`![TypeScript badge](…/TypeScript-24.13.3-…)`.** TypeScript is not in `package.json` at all, in either dependency map. `24.13.3` is exactly `@types/node`.
- **`![ESLint badge](…/ESLint-5.5.6-…)`.** ESLint is not a direct dependency either; the ecosystem is on 10.x. `5.5.6` is exactly `eslint-plugin-prettier`.
- **Categories reshuffle between runs.** In this window Go moved from *Languages* (`primary`) to *Development Tools & Platforms* (`used`), Docker left *Cloud & Infrastructure* for *Development Tools*, and **ESLint landed under *Cloud & Infrastructure***. React flipped `used → primary`. None of this tracks a change in the repo.
- **`_Badge data automatically updated every 6 hours via GitHub Actions_`** is rendered directly beneath the badges. It is the exact class of stale date-bound claim the repo's own `PR_REVIEW_PROMPT` instructs the agent to flag, printed on the artifact the agent never reviews.

The autoheal sweep audits lint cleanliness, security advisories, stale TODOs, `llms.txt` drift, and its own quality gates. It runs `pnpm badges:update` as a *smoke test* — it checks that generation **succeeds**, never that the output is **true**. A green generator emitting `TypeScript 24.13.3` on Marcus's public profile is the cleanest available example of the difference.

#### 5. The rolling-report retention clause works here — which relocates the cortexkit diagnosis

`fro-bot.yaml` carries the fleet-standard 50,000-character archival clause (lines 173-175 for maintenance, 486-489 for autoheal). Unlike [[marcusrbrown--cortexkit-anthropic-auth]] #11, **here it fires**: #936 carries six recorded archival events and #926 two, with explicit markers ("_[Archived 1 older update (2026-08-31 section) on 2026-09-06 - issue body approaching the 50,000-character bound]_"). The daemon is executing the clause on schedule.

Measured at survey time, #936 is **47,849 characters** holding **six** dated sections plus a 1,158-character Historical Summary:

| Section | Chars |
| --- | --- |
| 2026-09-06 | 8,574 |
| 2026-09-05 | 7,946 |
| 2026-09-04 | 8,024 |
| 2026-09-03 | 7,954 |
| 2026-09-02 | 7,700 |
| 2026-09-01 | 6,493 |
| Historical Summary | 1,158 |

Per-section floor ≈ **7,780 characters**. 50,000 ÷ 7,780 = **6**. The observed steady state is exactly the arithmetic prediction — a third quantitative confirmation of the rule derived from [[marcusrbrown--systematic]] #153 (see [[github-actions-ci]], *A Retention Policy With Two Numbers Nobody Multiplied*).

This repo adds a **third** unreachable number the systematic case did not have. The maintenance prompt asks for two retention behaviours on top of the cap:

- *"replace any individual daily sections older than **14 days** with a single Historical Summary"* → 14 × 7,780 ≈ **108,900 chars**, about **1.7× GitHub's hard 65,536-character issue-body limit**. Not merely over the soft cap — over the platform ceiling.
- *"…removing all but the **30 most recent** daily sections"* → 30 × 7,780 ≈ **233,000 chars**, **≈4.7× the 50,000 threshold this clause exists to enforce.** The prescribed remedy for approaching 50,000 is a target that guarantees 233,000.

Three numbers, none reachable, and the issue survives only because the model silently ignores all three and converges on six. **Correction to the fleet reading:** the 2026-09-05 comparison table attributes cortexkit #11's unbounded growth to the clause being "a soft prose budget, no enforcement." This repo runs the same clause, from the same prompt lineage, and it executes reliably eight times over. That weakens *unexecutable clause* as the explanation for cortexkit and strengthens the other finding already on that page — the daemon there had stopped writing at all six weeks before it was disabled. A clause cannot fail to fire if nothing is firing.

#### The one human commit is the interesting one

**#1194 (`chore(ci): bump bfra-me/.github to v4.25.1`, marcusrbrown, 2026-09-04)** is the only non-Renovate commit in 41. Its body:

> Takes bfra-me/renovate-action 10.34.1, which restores tar in the Renovate runtime. Renovate on 10.34.0 exits before servicing any dependencies, so this pin cannot self-update.

`bfra-me/.github` v4.25.0 shipped a [[bfra-me--renovate-action]] build whose container was missing `tar`; Renovate died at startup, therefore Renovate could not open the PR that fixes Renovate. A human had to reach in and cut the loop. Renovate then re-proposed the identical bump one commit later (#1195) — a no-op catch-up on a fix it was structurally incapable of authoring. **A self-updating dependency has no recovery path from a version of itself that fails before it reaches its work queue**; the bootstrap has to come from outside. Cataloged in [[github-actions-ci]].

#### New: a supply-chain cooldown that a bot waives on its own behalf

`pnpm-workspace.yaml` gained a `minimumReleaseAgeExclude` block (first appearance on this repo), written incrementally by five Renovate PRs between 2026-08-23 and 2026-08-26:

```yaml
minimumReleaseAgeExclude:
  - '@bfra.me/eslint-config@0.51.2 || 0.52.1'
  - '@bfra.me/prettier-config@0.16.10 || 0.16.11'
  - '@bfra.me/tsconfig@0.13.2'
```

pnpm 11 ships a publish-age cooldown as a defense against freshly compromised releases. This block waives it, per version, for the packages Renovate wants to install *right now* — added by the same automation the cooldown exists to slow down. The waivers are version-scoped, so they are not a live hole, but nothing prunes them: `0.51.2` and `0.16.10` are already superseded by `0.52.1` and `0.16.11` and remain in the file. It is an append-only exemption ledger with no reaper, and it is first-party packages today by accident of which dependencies happen to be fast-moving, not by policy.

#### Carried items, unchanged

- **#1087** (jq fork-detection bug) — still open, **not touched since it was filed on 2026-07-19**, 50 days. Verified verbatim at HEAD: line 577 is still `--jq '.head.repo.fork // "unknown"'`; line 540's job guard is still correct. Same reconciliation as 2026-08-19.
- **#1056** (stale TODO) — 61 days open; `utils/badge-detector.ts:72` still reads `// TODO: Load from @bfra.me/badge-config package when available`. The finding is still true and the fix is one line.
- **#1039** (llms.txt drift) — 67 days open, and **partially self-healed while nobody was looking**: the map now covers `templates/sponsor-testimonials.tpl.md`, `.agents/skills/sync-sponsors-bio/SKILL.md`, and the newer test files. Still missing `HIGHLIGHTS.md` and `templates/HIGHLIGHTS.tpl.md` — a first-class generated output absent from the project map — plus `.ai/plan/` and `assets/`. An issue that outlived most of its own finding.
- **#925** (Fro Bot evolution tracker) — untouched since 2026-05-23. Its four follow-ups (bound `timeout: 0`, migrate `FRO_BOT_PAT` → GitHub App token, perpetual-issue TOCTOU, prompt tuning) are all still open questions; `timeout: 0` is still at line 648.
- Perpetual-issue contract satisfied and stable: #936 (103 comments) and #926 (99 comments) both open, no oscillation. Sixth consecutive stable window.

**Version movement.** Agent pin **v0.100.0 → v0.109.4** (`b799b64`, ~20 bumps #1157–#1203) — this repo is the **ecosystem version leader**, ahead of [[marcusrbrown--infra]] (v0.109.3) and [[marcusrbrown--dotfiles]] (v0.105.0). `bfra-me/.github` **v4.18.0 → v4.26.0** — eight minor boundaries in 19 days, the fastest run this page has recorded. pnpm 11.22.0 → **11.25.0**, Node 24.19.0 → **24.20.0**, `@bfra.me/eslint-config` 0.51.1 → **0.52.1** (minor boundary), `@bfra.me/prettier-config` 0.16.9 → **0.16.11**, `@bfra.me/tsconfig` 0.13.1 → **0.13.2**, vitest/`@vitest/ui` 4.1.10 → **4.1.11**, tsx 4.23.12 → **4.23.13**, `simple-git-hooks` 2.13.1 → **2.14.0**, renovate-config `#5.2.12` → **#5.2.13**. The GHSA override ledger in `pnpm-workspace.yaml` is byte-identical; no `[SECURITY]` or `fix(security)` commits landed this window — which is the point of finding 2, since three were sitting green the whole time.

### 2026-08-19 update: Fro Bot becomes a merge gate; agent crosses v1.00-adjacent v0.100.0; autoheal prompt gains a Quality Gates category; fork preflight bug still open

Survey at HEAD `df85b7d` (`chore(deps): update bfra-me/.github to v4.18.0`, 2026-08-19). 61 commits since the 2026-07-20 window, still overwhelmingly the `mrbro-bot[bot]` Renovate treadmill, but three of them are governance/tooling changes that matter.

**Fro Bot is now a required status check on `main` (#1138, Marcus, 2026-08-09).** `.github/settings.yml` branch protection `required_status_checks.contexts` went from `[CI, Renovate / Renovate, Prepare, Finalize]` to **`[CI, Fro Bot, Renovate / Renovate, Prepare, Finalize]`**. The agent's PR-review verdict is no longer advisory — a red or missing `Fro Bot` check now *blocks the merge button*. This is the same move [[marcusrbrown--dev-like]] made (agent wired into its own merge gate via `.github:common-settings.yaml`), but here it lands as a direct edit to this repo's Probot settings rather than through the shared template. `enforce_admins: true` still holds, so even Marcus is gated. The daemon graduated from reviewer to gatekeeper — the review it writes now has teeth.

**tsconfig slimmed toward `@bfra.me/tsconfig` defaults (#1137 + #1139, Marcus).** Two back-to-back chores removed `baseUrl` (#1137) and `moduleResolution` (#1139) from `tsconfig.json`, deferring both to the extended `@bfra.me/tsconfig` base — the local config now carries only the `@/*` path alias, `resolveJsonModule`, `allowImportingTsExtensions`, `noPropertyAccessFromIndexSignature: false`, and `noEmit`. `.agents/skills/**/*` is now in the `include` set (the `sync-sponsors-bio` skill is type-checked). Same "keep local config minimal, lean on `@bfra.me/*`" discipline documented across the cluster.

**Autoheal prompt reorganized: a Quality Gates Verification category (5) was inserted.** The `AUTOHEAL_PROMPT` now runs **1 ERRORED PRs → 2 SECURITY → 3 CODE QUALITY & REPO HYGIENE → 4 DEVELOPER EXPERIENCE → 5 QUALITY GATES VERIFICATION → 6 CROSS-PROJECT INTELLIGENCE (INBOUND ONLY) → 7 UPSTREAM MODERNIZATION WATCH (SUNDAYS ONLY)**. Category 5 explicitly re-runs the project's gates on the default branch (`pnpm lint` 0-error, `pnpm test` all-pass, `pnpm sponsors:update` + `pnpm badges:update` template-generation smoke tests, and `actionlint` if on PATH), routing minimal fixes into the category-4 PR and complex ones into an issue. Cross-Project Intelligence and Upstream Modernization renumbered from 6/7 to 6/7 unchanged in position but now sit *after* an explicit gate-verification pass — the sweep now proves the tree is green before it reports. `git log -S` origin-attributes all three (`head.repo.fork` job-guard, `Validate review mode inputs`, `QUALITY GATES VERIFICATION`) to onboarding commit #924, so the *strings* have existed since 2026-06-02; the prior-survey wiki text under-recorded the autoheal category set. Corrected here: the 2026-06-02 onboarding already shipped the Quality Gates and review-mode-validation machinery.

**Fork-detection bug #1087 is still open — and the prior survey conflated two guards.** Reconciliation: there are two fork checks. (1) The **job-level `if:`** (line 540) uses `!github.event.pull_request.head.repo.fork` — correct, never buggy. (2) The **comment-trigger preflight step** (line 577) still uses `gh api … --jq '.head.repo.fork // "unknown"'`, and jq's `//` treats boolean `false` as absent, so a legitimate *same-repo* PR resolves to `"unknown"` and `[ "$is_fork" != "false" ]` refuses it. The 2026-07-20 page attributed #1087 to "line 577" but also implied the job `if:` was the buggy surface; the bug is *only* in the preflight step, and it remains verbatim at HEAD. Still warrants the `// empty` (or explicit `== null`) fix. The daemon audits its own chrome but hasn't yet patched the crack it found.

**Everything else is pure treadmill.** Agent pin rolled **v0.93.1 → v0.100.0** (`7b9a281`, ~20 bumps #1105–#1152, crossing the cosmetic v0.100 boundary — still 0.x, no v1 semantics), still SHA-pinned, still tracking [[fro-bot--agent]]. pnpm 11.13.1 → **11.22.0**, Node 24.18.0 → **24.19.0**, Prettier 3.9.5 → **3.9.6**, tsx 4.23.1 → **4.23.12**, `bfra-me/.github` v4.16.38 → **v4.18.0** (the `update-repo-settings`/`renovate` reusable-workflow source), renovate-config `#5.2.7` → **#5.2.12**. The `pnpm-workspace.yaml` GHSA override ledger is byte-identical (`vite 7.3.6`, `postcss >=8.5.10`, `picomatch`, `fast-uri >=3.1.2`, `jiti <2.8.0`) — the vite override from 2026-07-06 is still holding, no new `[SECURITY]`/`fix(security)` commits this window. Autoheal continues shipping real work: #1061 (template-vs-generated README sync, re-landed) and #1117 (`chore(lint): apply auto-fixes from autohealing run`) are both in-window. New `templates/sponsor-testimonials.tpl.md` joins the template set; `.ai/plan/` directory added alongside `.ai/docs/`.

### 2026-07-20 update: autoheal matures from report-noise into concrete fix PRs; agent self-catches a workflow bug; pure treadmill otherwise, agent at v0.93.1

Two weeks of motion, and for the first time the operational signal is more interesting than the dependency graph.

**Autoheal graduated from writing reports to shipping fixes.** The 2026-07-06 survey noted the first "actionable" autoheal finding (llms.txt drift #1039). Since then the autoheal sweep has started opening real remediation PRs and precise hygiene issues rather than logging noise into the perpetual report:

- **PR #1055** (`chore(lint): apply auto-fixes from autohealing run`, fro-bot, 2026-07-08) — category-4 (developer experience) caught three `markdown/fenced-code-language` warnings in `SPONSORME.md`, traced them to bare code fences emitted by `scripts/update-sponsors.ts`, and fixed the *generator* (`` ```text `` fence) so future generations stop reintroducing the warning. This is root-cause remediation on a generated-content repo, not a cosmetic patch of the output.
- **PR #1061** (`chore(templates): sync README.tpl.md formatting with README.md`, fro-bot, 2026-07-10) — category-3 template-vs-generated-content drift check found `templates/README.tpl.md` and `README.md` had diverged in whitespace/emphasis since #928, even though `update-profile.yaml` does a straight `cp`. Exactly the template-to-generated drift the PR-review prompt watches for, now caught proactively by autoheal.
- **Issue #1056** (`Stale TODOs`, fro-bot, 2026-07-08) — category-3 `git blame` scan surfaced a single >90-day annotation (`utils/badge-detector.ts:72`, a `TODO: Load from @bfra.me/badge-config`, introduced 2025-08-13 in #603, ~11 months old). Precise and bounded, not a report dump.

**Fro Bot found a bug in its own workflow.** Issue **#1087** (`fro-bot.yaml: jq fork-detection bug refuses comment triggers on same-repo PRs`, fro-bot, 2026-07-19) is the standout: the autoheal sweep caught that the fork-refusal preflight (line 577) uses `--jq '.head.repo.fork // "unknown"'`, and jq's `//` operator treats boolean `false` as "no value" — so a *legitimate same-repo* PR (`fork == false`) resolves to the string `"unknown"` and gets refused. The hardening step documented as a real security gap closed in the 2026-06-02 survey has a latent false-positive that blocks Fro Bot's own comment-triggered reviews on non-fork PRs. The daemon audited its own chrome and found a crack. This is a genuine correctness bug (`// false` should be `// empty` or an explicit `== null` check) and warrants a fix PR — the fork guard is *over*-refusing, which fails closed on security but breaks the legitimate comment-trigger path.

**Dependency motion is otherwise pure treadmill.** 32 commits since 2026-07-06, every one a `mrbro-bot[bot]` Renovate bump — zero direct `fix(security)` commits, zero `fro-bot.yaml` body changes. The agent pin rolled **v0.83.1 → v0.93.1** (`a4976f4`, ~18 bumps #1050–#1085), still SHA-pinned, still tracking [[fro-bot--agent]]. pnpm stayed in the 11.x line (11.9.0 → 11.13.1), Prettier crossed 3.9.4 → 3.9.5, `bfra-me/.github` v4.16.34 → v4.16.38, renovate-config `#5.2.4 → #5.2.7`. The `pnpm-workspace.yaml` security override ledger is unchanged (same `vite 7.3.6` / `postcss` / `picomatch` / `fast-uri` / `jiti` pins).

**Perpetual-issue contract holds.** Both #936 (Daily Maintenance Report) and #926 (Daily Autohealing Report) are open — "exactly one open maintenance issue" is satisfied. No close/reopen oscillation observed this window, the first stable state across the last four surveys (churning → closed → reopened → stable). Generated-content PR rotated **#1048 → #1088** (`build: update generated profile content`, `mrbro-bot[bot]`), plus a `chore(deps): maintain lockfiles` PR #1070 (mrbro-bot) in the open set. `fro-bot.yaml` body structurally unchanged: bare-dispatch-prompt fallback (line 635), crons 04:30/16:30 UTC, `IS_SUNDAY_UTC` category-7 gate, fork-refusal preflight (now known-buggy per #1087), and `persist-credentials: false` all intact.

### 2026-07-06 update: pnpm crosses 10→11, security overrides migrate to workspace, maintenance issue reopened, agent at v0.83.1

Two structural shifts break the pure-treadmill pattern of the last three surveys.

**1. pnpm crossed the 10 → 11 major boundary (10.34.4 → 11.9.0)** via a `[SECURITY]`-labeled Renovate chain (#1021 v11, #1024 v11.8.0, #1025 v11.9.0, 2026-06-27), matching the fleet-wide cut already recorded in [[bfra-me--works]], [[bfra-me--renovate-action]], and [[marcusrbrown--containers]]. `packageManager` in `package.json` reads `pnpm@11.9.0`.

**2. A `pnpm-workspace.yaml` appeared at repo root** — the first time this repo carries workspace-level pnpm config. It does three things:

- **`allowBuilds` + `onlyBuiltDependencies`** (`esbuild`, `simple-git-hooks`, `unrs-resolver`) — the pnpm 10/11 approved-build-scripts gate, mirroring the block [[bfra-me--works]] added in the same window.
- **Security override block** — GHSA-annotated transitive pins driven by Dependabot alerts on this repo's security tab: `vite: 7.3.6` (five advisories), `postcss >=8.5.10`, `picomatch >=4.0.4 || >=2.3.2 <3`, `fast-uri >=3.1.2`. The pre-existing `jiti: <2.8.0` pin also moved here. This is the same **`pnpm-workspace.yaml`-as-override-ledger** pattern documented on [[marcusrbrown--mrbro-dev]] (the `pnpm audit` CI gate sibling) — Marcus is standardizing security overrides into the workspace file across the profile-repo cluster rather than scattering them in `package.json` `pnpm.overrides`.
- **`shamefullyHoist: true`, `savePrefix: ''`** — flat node_modules + exact-version saves.

The override block is accompanied by a **direct security-fix commit #1038** (`fix(security): bump vite to 7.3.6 (GHSA-fx2h-pf6j-xcff, high)`, 2026-07-04). This is a live example of the autoheal prompt's dependency-ownership carve-out: Renovate owns routine bumps, but a confirmed high-severity advisory is a permitted manual/agent version change. The commit is a labeled `fix(security)` rather than an autoheal PR, so authorship attribution to Fro Bot vs. Marcus is not directly confirmable from the commit graph alone.

**Workflow body changed for the first time since 2026-06-02.** Commit #1045 (`fix(fro-bot): honor a bare workflow_dispatch prompt regardless of mode`) added a fallback to the `PROMPT` expression: a `workflow_dispatch` carrying an `inputs.prompt` now resolves to that prompt even when no `mode` is selected (line 632-635 of `fro-bot.yaml`). The three-mode design, crons (04:30 / 16:30 UTC), fork-head refusal preflight, `IS_SUNDAY_UTC` category-7 gate, and `persist-credentials: false` checkout are otherwise unchanged. The workflow also grew a **`marcusrbrown/mrbro.dev` focus-repo entry** in the cross-project intelligence list (alongside `tokentoilet` and `vbs`) — the cross-repo prompt-hardening loop with [[marcusrbrown--mrbro-dev]] now runs bidirectionally.

**Perpetual-issue oscillation reversed again.** On 2026-06-22 the "Daily Maintenance Report" #936 was *closed* (zero open maintenance issue — contract unsatisfied). As of 2026-07-06 **#936 is reopened** (both #936 and #926 open), so the "exactly one open maintenance issue" contract is satisfied again — but the three-survey history (churning → closed → reopened) confirms this surface is not stable, exactly the schedule-concurrency TOCTOU that tracker #925 anticipated.

**New autoheal-surfaced issue #1039** (`llms.txt drift: several files missing from project map`, fro-bot-authored, 2026-07-02): the autoheal sweep caught the root `llms.txt` map falling out of sync with the actual file tree — a concrete, actionable finding rather than report noise. Generated-content PR rotated **#1007 → #1048** (`build/update-readme`, `mrbro-bot[bot]`, 2026-07-06), same 6-hour steady state.

Agent pin moved **v0.75.0 → v0.83.1** (`d1786f3`) — ~16 Renovate bumps in the window (#1017–#1050), still SHA-pinned, still ecosystem version co-leader tracking [[fro-bot--agent]].

### 2026-06-22 update: maintenance issue closed, agent at v0.75.0

Ten more days of pure version-treadmill motion. The `fro-bot.yaml` workflow body is structurally unchanged from 2026-06-12 — same three-mode design, same fork-head refusal preflight, same `IS_SUNDAY_UTC` category-7 gate, same `persist-credentials: false` checkout. Only the agent pin moved: **`fro-bot/agent` v0.61.0 → v0.75.0** (`a12463f`), 14 Renovate-authored bumps in 10 days (#982–#1008, frequently several per day). The action stays SHA-pinned, consistent with the PR review prompt's own third-party-action rule.

Notable operational shift on the perpetual-issue front:

- **The maintenance issue oscillation has settled — closed, not churning.** On 2026-06-12 the "Daily Maintenance Report" #936 was caught in a daily close/reopen loop between the autoheal (closes ~06:00 UTC) and maintenance (reopens ~17:30 UTC) runs. As of 2026-06-22, **#936 is closed (closed 2026-06-22) and is no longer in the open set.** Only one perpetual issue remains open: "Daily Autohealing Report" #926 (created 2026-05-23, still active). This means the maintenance schedule (cron `30 16 * * *`) is no longer reopening #936 — either the maintenance run stopped resurrecting it or it is now consolidating into a different surface. The perpetual-issue contract ("exactly one *open* maintenance issue at all times") is therefore **not currently satisfied** for maintenance: there is zero open maintenance issue, not one. This is the inverse of the 2026-06-12 churn — worth watching against tracker #925's schedule-concurrency follow-up.
- **Open items down to 3:** #926 (autoheal report), #925 (evolution tracker), #284 (dependency dashboard). PR #960 (the long-lived `build/update-readme` generated-content PR) has cycled; the current generated-content PR is **#1007** (`build/update-readme`, `mrbro-bot[bot]`, opened 2026-06-22) — same 6-hour-refresh steady state, new PR number.

The composite `.github/actions/setup` action and `mrbro-bot[bot]`/`fro-bot` identity separation remain unchanged. No drift in the prompt bodies, trigger surface, or hardening posture since the 2026-06-12 survey.

### 2026-06-12 update: Renovate version treadmill, agent at v0.61.0

Ten days after onboarding, the Fro Bot workflow is fully routine. Renovate has merged **17 `fro-bot/agent` bumps since 2026-06-02** (v0.51.0 → v0.61.0 via #952–#980, often several per day), confirming the dependency-ownership boundary works as designed — every bump is Renovate-authored, none came from autoheal. The action is now **SHA-pinned** (`6794bf5` # v0.61.0) rather than tag-pinned, consistent with the PR review prompt's own "pinned SHAs for third-party actions" rule.

Workflow trigger surface has grown since the 2026-06-02 survey: `issues: [opened, edited]` is now a trigger (gated to non-bot OWNER/MEMBER/COLLABORATOR authors), alongside the original PR/comment/schedule/dispatch set. A `workflow_dispatch` `mode` choice input (review/maintenance/autoheal, default autoheal) with a required-prompt validation step for review mode is also present.

Operational observations from issue event history:

- **Daily close/reopen oscillation on #936 (Daily Maintenance Report):** fro-bot reopens it each afternoon (~17:30 UTC) and closes it each morning (~06:00 UTC) — e.g., reopened 2026-06-11T17:48, closed 2026-06-12T06:02. The perpetual-issue contract says exactly one *open* maintenance issue should exist at all times; the autoheal run appears to be closing it and the maintenance run reopening it, a daily churn loop. #926 (Daily Autohealing Report) stays open (20 comments). This is the schedule-concurrency/perpetual-issue friction anticipated in tracker #925, now empirically visible.
- **PR #960** (`build/update-readme`, generated content) has been open since 2026-06-04 and is updated every 6 hours by the profile pipeline — normal steady-state for this repo's design.
- Open items are down to 4: #960 (build PR), #926 (autoheal report), #925 (evolution tracker), #284 (dependency dashboard).

The composite `.github/actions/setup` action (pnpm store cache keyed by year-month + lockfile hash, `pnpm/action-setup` SHA-pinned) handles install; checkout remains `persist-credentials: false` with the comment-trigger fork-head refusal preflight intact.

### 2026-06-02 update: Fro Bot workflow is now live (contradiction resolved)

**Fro Bot workflow present and active** (`fro-bot.yaml`, `fro-bot/agent@v0.50.0`, SHA `de04256`). This **contradicts the prior survey claim** below — the onboarding gap that stood across the 2026-04-18 → 2026-05-18 surveys has been closed. The workflow landed via PR #924 during a dedicated "Fro Bot initial setup session" (referenced in evolution tracker issue #925), and the agent pin has since rolled forward v0.44.3 → v0.48.0 → v0.49.0 → v0.50.0 via Renovate (#946, #949, #950).

The workflow is a **single-file three-mode design** — the same architecture seen in [[marcusrbrown--marcusrbrown-github-io]] and [[marcusrbrown--systematic]] (consolidated `fro-bot.yaml`, no separate `fro-bot-autoheal.yaml`):

| Mode | Trigger | Prompt | Purpose |
| --- | --- | --- | --- |
| **review** | `pull_request` (opened/sync/reopened/ready/review_requested), `@fro-bot` mentions on issue/PR/discussion comments (OWNER/MEMBER/COLLABORATOR only) | `PR_REVIEW_PROMPT` | Structured verdict review (PASS/CONDITIONAL/REJECT) with profile-repo-specific focus: automation integrity, template-to-generated drift, content-freshness (stale date-bound claims), TypeScript strict, skipped-needs `!cancelled()` trap |
| **maintenance** | `schedule` cron `30 16 * * *` (16:30 UTC), dispatch | `MAINTENANCE_PROMPT` | Single perpetual "Daily Maintenance Report" issue (#936); 14-day rolling window, content-freshness scan, cross-project intelligence |
| **autoheal** | `schedule` cron `30 4 * * *` (04:30 UTC), dispatch (default) | `AUTOHEAL_PROMPT` | Single perpetual "Daily Autohealing Report" issue (#926); 7 categories incl. Sunday-only Upstream Modernization Watch (category 7), gated on `IS_SUNDAY_UTC` |

Notable hardening in this workflow relative to earlier sibling workflows:

- **Fork-head refusal for comment triggers:** A dedicated preflight step resolves the PR via API and refuses fork heads before any checked-out code runs — `issue_comment` events carry no `pull_request` payload, so the job-level fork guard alone is insufficient. This is a real security gap closed, not boilerplate.
- **`persist-credentials: false`** on checkout; `FRO_BOT_PAT` scoped to this repo only (contents/issues/PRs/discussions write, no org/admin/secrets).
- **Sunday-only category cadence** via `IS_SUNDAY_UTC` env detected in a preflight `date -u +%u` step.
- **Schedule staggering** documented inline: autoheal 04:30 UTC (off mrbro.dev/tokentoilet 03:30, update-repo-settings 02:55), maintenance 16:30 UTC (1h after mrbro.dev's 15:30).

**Dependency ownership boundary** is explicit in the autoheal prompt: Renovate owns routine version bumps; Fro Bot may only change versions to remediate a confirmed critical/high security advisory. Generated content stays on the `build/update-readme` branch under the `mrbro-bot[bot]` committer identity — the two bot identities remain cleanly separated (Fro Bot reviews/heals, mrbro-bot commits generated content).

Open follow-ups tracked in **issue #925 (Fro Bot evolution tracker)**: bound the `timeout: 0` once run-duration baselines exist; migrate `FRO_BOT_PAT` → GitHub App token (reuse existing `APPLICATION_ID`/`APPLICATION_PRIVATE_KEY`); schedule-concurrency TOCTOU on the perpetual issue; prompt-tuning after 2–3 schedule runs.

### Prior survey claim (retained for history — superseded 2026-06-02)

> **No Fro Bot workflow detected.** The repository does not contain a `fro-bot.yaml` workflow. Automated commits are handled by `mrbro-bot[bot]`, a separate GitHub App. A follow-up draft PR should be proposed to add the Fro Bot agent workflow for automated PR review.

The repo references `fro-bot/.github:common-settings.yaml` in its Probot settings, and `fro-bot` is a collaborator with push access — the onboarding readiness noted across prior surveys has now been realized.

## Open Work Items

### 2026-09-07 snapshot (current)

Seven open issues, six open PRs.

| # | Kind | Title | Author | Created | Age | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| #1094 | PR | `fix(security)`: js-yaml + brace-expansion overrides | fro-bot | 2026-07-21 | 48 d | `mergeable_state: clean`, 37 branch commits. Per-parent-scoped `minimatch@3>brace-expansion` / `minimatch@10>brace-expansion` floors |
| #1095 | PR | `chore(lint)`: auto-fixes from autohealing run | fro-bot | 2026-07-21 | 48 d | `dirty` — duplicate of #1055; fix landed via #1117 |
| #1100 | PR | `fix(security)`: fast-uri ≥3.1.5 + linkify-it | fro-bot | 2026-07-22 | 47 d | `clean`, 28 branch commits. Three GHSAs newer than the tree's `>=3.1.2` |
| #1107 | PR | `fix(security)`: postcss ≥8.5.23 | fro-bot | 2026-07-25 | 44 d | `clean`, 22 branch commits. GHSA-r28c-9q8g-f849 (high) + 2 |
| #1055 | PR | `chore(lint)`: auto-fixes from autohealing run | fro-bot | 2026-07-08 | 61 d | `dirty`. **Never merged** — supersedes the 2026-07-20 claim |
| #1189 | PR | `build:` update generated profile content | mrbro-bot[bot] | 2026-09-01 | 6 d | Tenth in an unmerged run since 2026-08-10 |
| #1087 | Issue | jq fork-detection bug refuses same-repo comment triggers | fro-bot | 2026-07-19 | 50 d | Untouched since filing. Line 577 verbatim at HEAD |
| #1056 | Issue | Stale TODOs | fro-bot | 2026-07-08 | 61 d | `utils/badge-detector.ts:72` unchanged |
| #1039 | Issue | llms.txt drift | fro-bot | 2026-07-02 | 67 d | Partially self-healed; `HIGHLIGHTS.md`/`.tpl.md` still absent from the map |
| #936 | Issue | Daily Maintenance Report | fro-bot | 2026-05-24 | — | Perpetual. 47,849 chars / 6 sections / 103 comments |
| #926 | Issue | Daily Autohealing Report | fro-bot | 2026-05-23 | — | Perpetual. 36,941 chars / 99 comments |
| #925 | Issue | Fro Bot evolution tracker | marcusrbrown | 2026-05-23 | — | Untouched since filing; all four follow-ups still open |
| #284 | Issue | Dependency Dashboard | mrbro-bot[bot] | 2024-02-22 | — | Standard Renovate dashboard |

The shape is the finding: **every open PR except one is agent-authored, green, and unmerged**, while 40 Renovate PRs merged same-day in the same window.

### 2026-04 snapshot (retained for history — superseded)

| # | Title | Author | Created | Notes |
| --- | --- | --- | --- | --- |
| #895 | Action Required: Fix Renovate Configuration | mrbro-bot[bot] | 2026-03-12 | **Blocks all Renovate PRs** — regex parse error in `marcusrbrown/renovate-config` preset resolution |
| #284 | Dependency Dashboard | mrbro-bot[bot] | 2024-02-22 | Standard Renovate dashboard issue |

**Renovate is stalled.** Issue #895 reports an invalid regex in the Renovate preset resolution chain, preventing all dependency update PRs since 2026-03-12. The error references `marcusrbrown/renovate-config` with a malformed RE2 expression. This means dependencies have not been updated for over 6 weeks and the profile update pipeline's 6-hour schedule is the only active automation.

## Notable Patterns

- **Template-driven generation:** All public-facing markdown is generated from `.tpl.md` templates. Editing the output files directly is a footgun; they get overwritten every 6 hours.
- **A/B testing for profile content:** Unusual for a profile repo. The `templates/variants/` directory and `ab-test-cli.ts` suggest active experimentation with sponsor conversion messaging.
- **Content performance analytics:** `profile-analytics.ts` and `content-performance-tracking.ts` treat the profile README as a measurable surface.
- **Badge automation pipeline:** Technology badges are not manually curated. `badge-detector.ts` discovers technologies, `badge-cache-manager.ts` caches results, and `shield-io-client.ts` generates the shields.
- **Shared config ecosystem:** All tooling configs extend `@bfra.me/*` packages, keeping local config minimal. Same pattern observed in [[marcusrbrown--ha-config]] and [[marcusrbrown--github]] for Renovate and Probot settings.
- **`mrbro-bot[bot]` vs `fro-bot` (updated 2026-06-02):** The two bot identities now coexist with clean separation of duties. `mrbro-bot[bot]` (app 137683033) owns generated-content commits on `build/update-readme`; `fro-bot` (via `fro-bot.yaml`) owns PR review, autoheal, and maintenance. Earlier surveys (through 2026-05-18) noted Fro Bot was not yet integrated — that gap is now closed.
- **Dependency drift risk (resolved 2026-05-18, retained for history):** The 2026-04 survey noted Renovate stalled since 2026-03-12, accumulating drift. That stall cleared with the 2026-05-14 preset fix (#897 → renovate-config 5.2.0); every survey since (2026-05-18 through 2026-07-20) shows Renovate fully healthy, this repo frequently *leading* the ecosystem on the `fro-bot/agent` pin. This bullet is superseded — see the dated Version Comparison snapshots.
- **Autoheal as an active remediation surface (2026-07-20; qualified 2026-09-07):** By the 2026-07-20 survey, the autoheal mode had shifted from writing perpetual-report entries to opening concrete fix PRs (#1055, #1061) and precise hygiene issues (#1056), and even auditing its own workflow (#1087 fork-detection bug). The autoheal loop is now a genuine maintenance actor on this repo, not just a reporter — a pattern worth watching for adoption across the sibling repos in [[fro-bot--agent]]'s focus list. **Qualified 2026-09-07:** the *authoring* half is real and has held; the *delivery* half has not. #1055 never merged (its fix landed via sibling #1117 on 2026-08-10), and four green remediation PRs have been stranded 44–61 days. The daemon is a productive author with no merge path — measure the merged set, not the opened set.
- **The delivery path is not the pipeline that owns it (2026-09-07):** `update-profile.yaml` regenerates content onto *every* PR head, so generated `BADGES.md`/`SPONSORME.md` reaches `main` as a rider on Renovate `chore(deps)` merges. Its own `build/update-readme` PR is left with an empty diff and closed — ten consecutive, zero merged, no `build:` commit since 2026-08-10, `README.md` untouched since 2026-05-23. Profile freshness is now a function of Renovate PR volume, which this repo has already demonstrated can drop to zero for two months.
- **Green generation is not correct output (2026-09-07):** the autoheal quality-gate category runs `pnpm badges:update` and checks that it *succeeds*. On `main` right now the generator publishes `TypeScript 24.13.3` (that is `@types/node`; TypeScript is not a dependency), `ESLint 5.5.6` (that is `eslint-plugin-prettier`), files ESLint under *Cloud & Infrastructure*, and captions the block "updated every 6 hours" beneath content whose delivery path has been closed for 28 days. Smoke-testing a generator says nothing about the truth of what it emits.
- **A required check that excludes an author is not a gate on that author (2026-09-07):** `Fro Bot` became a required context on `main` in #1138, but the job guard skips `[bot]` authors and `fro-bot` by name, and skipped ⇒ passing. Across 41 commits the check evaluated exactly one PR. The agent's own security PRs show `Fro Bot: skipped` alongside four green checks. Same mechanism as [[bfra-me--ha-addon-repository]], opposite consequence: there it hid a dead daemon, here it certifies the daemon's unreviewed output.

## Version Comparison (vs. Ecosystem)

### 2026-09-07 snapshot

| Dependency | This Repo | Delta vs 2026-08-19 |
| --- | --- | --- |
| `fro-bot/agent` | **v0.109.4** (`b799b64`, SHA-pinned) | v0.100.0 → v0.109.4 — ~20 bumps (#1157–#1203); **ecosystem version leader** (vs [[marcusrbrown--infra]] v0.109.3) |
| `bfra-me/.github` | **v4.26.0** (`5310cfc`) | v4.18.0 → v4.26.0 — **eight minor boundaries in 19 days** |
| `pnpm` | 11.25.0 | 11.22.0 → 11.25.0 (stays 11.x) |
| `Node.js` | 24.20.0 | 24.19.0 → 24.20.0 (`.mise.toml`) |
| `marcusrbrown/renovate-config` | `#5.2.13` | 5.2.12 → 5.2.13 (#1197) |
| `@bfra.me/eslint-config` | 0.52.1 | 0.51.1 → 0.52.1 — **minor boundary** (#1163/#1169) |
| `@bfra.me/prettier-config` | 0.16.11 | 0.16.9 → 0.16.11 (#1164/#1166) |
| `@bfra.me/tsconfig` | 0.13.2 | 0.13.1 → 0.13.2 (#1170) |
| `vitest` / `@vitest/ui` | 4.1.11 | 4.1.10 → 4.1.11 (#1159) |
| `tsx` | 4.23.13 | 4.23.12 → 4.23.13 (#1190) |
| `simple-git-hooks` | 2.14.0 | 2.13.1 → 2.14.0 (#1186) |
| `Prettier` | 3.9.6 | unchanged |
| `@types/node` | 24.13.3 | unchanged |
| `@bfra.me/badge-config` | 0.2.0 | unchanged |
| `jiti` | 2.7.0 (`<2.8.0`) | unchanged (pin in `pnpm-workspace.yaml`) |
| `markdownlint-cli2` | 0.20.0 | unchanged |
| `eslint-plugin-prettier` | 5.5.6 | unchanged |
| `eslint-config-prettier` | 10.1.8 | unchanged |

`pnpm-workspace.yaml` GHSA override ledger byte-identical (`vite 7.3.6`, `postcss >=8.5.10`, `picomatch`, `fast-uri >=3.1.2`, `jiti <2.8.0`) — **and four PRs raising three of those floors against newer advisories are open and green** (#1094/#1100/#1107). New `minimumReleaseAgeExclude` block (pnpm 11 cooldown waivers for `@bfra.me/*`, added by Renovate across #1163–#1170). **Structural (non-deps) changes: none.** `fro-bot.yaml` is `+1/-1` (agent pin only); branch protection contexts, prompts, crons, and the composite `setup` action are byte-stable.

### 2026-08-19 snapshot

| Dependency | This Repo | Delta vs 2026-07-20 |
| --- | --- | --- |
| `fro-bot/agent` | v0.100.0 (`7b9a281`, SHA-pinned) | v0.93.1 → v0.100.0 — ~20 bumps (#1105–#1152), crosses cosmetic v0.100 (still 0.x) |
| `pnpm` | 11.22.0 | 11.13.1 → 11.22.0 (stays 11.x) |
| `marcusrbrown/renovate-config` | `#5.2.12` | 5.2.7 → 5.2.12 |
| `bfra-me/.github` | v4.18.0 | v4.16.38 → v4.18.0 (#1156) |
| `Node.js` | 24.19.0 | 24.18.0 → 24.19.0 (`.mise.toml`) |
| `Prettier` | 3.9.6 | 3.9.5 → 3.9.6 |
| `tsx` | 4.23.12 | 4.23.1 → 4.23.12 |
| `@types/node` | 24.13.3 | unchanged |
| `vitest` / `@vitest/ui` | 4.1.10 | unchanged |
| `@bfra.me/eslint-config` | 0.51.1 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `@bfra.me/badge-config` | 0.2.0 | unchanged |
| `jiti` | 2.7.0 (`<2.8.0`) | unchanged (pin in `pnpm-workspace.yaml`) |
| `markdownlint-cli2` | 0.20.0 | unchanged |

`pnpm-workspace.yaml` security override ledger byte-identical (`vite 7.3.6`, `postcss >=8.5.10`, `picomatch`, `fast-uri >=3.1.2`). Renovate fully healthy; merge stream still dominated by `fro-bot/agent` releases. No `[SECURITY]`/`fix(security)` commits this window. **Structural (non-deps) changes: #1138 (Fro Bot → required status check on `main`), #1137/#1139 (tsconfig `baseUrl`/`moduleResolution` removed).**

### 2026-07-20 snapshot

| Dependency | This Repo | Delta vs 2026-07-06 |
| --- | --- | --- |
| `fro-bot/agent` | v0.93.1 (`a4976f4`, SHA-pinned) | v0.83.1 → v0.93.1 — ~18 Renovate bumps (#1050–#1085) |
| `pnpm` | 11.13.1 | 11.9.0 → 11.13.1 (#1054/#1074/#1083/#1086, stays in 11.x) |
| `marcusrbrown/renovate-config` | `#5.2.7` | 5.2.4 → 5.2.7 (#1071/#1082) |
| `bfra-me/.github` | v4.16.38 | v4.16.34 → v4.16.38 (#1057/#1079/#1089) |
| `Node.js` | 24.18.0 | unchanged (`.mise.toml`) |
| `Prettier` | 3.9.5 | 3.9.4 → 3.9.5 (#1065) |
| `tsx` | 4.23.1 | 4.22.5 → 4.23.1 (#1051/#1081) |
| `@types/node` | 24.13.3 | 24.13.2 → 24.13.3 (#1076) |
| `vitest` / `@vitest/ui` | 4.1.10 | 4.1.9 → 4.1.10 (#1059) |
| `@bfra.me/eslint-config` | 0.51.1 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `@bfra.me/badge-config` | 0.2.0 | unchanged |
| `jiti` | 2.7.0 (`<2.8.0`) | unchanged (pin in `pnpm-workspace.yaml`) |
| `markdownlint-cli2` | 0.20.0 | unchanged |

`pnpm-workspace.yaml` security override ledger unchanged (`vite 7.3.6`, `postcss >=8.5.10`, `picomatch`, `fast-uri >=3.1.2`). Renovate fully healthy; merge stream still dominated by `fro-bot/agent` releases. No `[SECURITY]`-labeled or direct `fix(security)` commits this window — the vite override from the 2026-07-06 window is holding.

### 2026-07-06 snapshot

| Dependency | This Repo | Delta vs 2026-06-22 |
| --- | --- | --- |
| `fro-bot/agent` | v0.83.1 (`d1786f3`, SHA-pinned) | v0.75.0 → v0.83.1 — ~16 Renovate bumps (#1017–#1050) |
| `pnpm` | **11.9.0** | 10.34.4 → 11.9.0 — **major 10→11 boundary crossed** (#1021/#1024/#1025, `[SECURITY]`) |
| `marcusrbrown/renovate-config` | `#5.2.4` | 5.2.3 → 5.2.4 (#1035) |
| `bfra-me/.github` | v4.16.34 | v4.16.27 → v4.16.34 (#1049) |
| `Node.js` | 24.18.0 | 24.17.0 → 24.18.0 (`.mise.toml`) |
| `Prettier` | 3.9.4 | 3.8.4 → 3.9.4 — **minor boundary** (#1032/#1041/#1043) |
| `tsx` | 4.22.5 | 4.22.4 → 4.22.5 (#1047) |
| `@types/node` | 24.13.2 | unchanged |
| `vitest` / `@vitest/ui` | 4.1.9 | unchanged |
| `@bfra.me/eslint-config` | 0.51.1 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `jiti` | 2.7.0 (`<2.8.0`) | unchanged (pin relocated to `pnpm-workspace.yaml`) |
| `markdownlint-cli2` | 0.20.0 | unchanged |
| `actions/cache` | v5.1.0 | v5.0.x → v5.1.0 (#1020) |

New in this window: `pnpm-workspace.yaml` security override block — `vite: 7.3.6`, `postcss >=8.5.10`, `picomatch >=4.0.4 || >=2.3.2 <3`, `fast-uri >=3.1.2` (all GHSA-annotated). Renovate remains fully healthy; the merge stream is still dominated by `fro-bot/agent` releases with pnpm/Prettier majors/minors interleaved.

### 2026-06-22 snapshot

| Dependency | This Repo | Delta vs 2026-06-12 |
| --- | --- | --- |
| `fro-bot/agent` | v0.75.0 (`a12463f`, SHA-pinned) | v0.61.0 → v0.75.0 — 14 Renovate bumps in 10 days (#982–#1008) tracking [[fro-bot--agent]] release cadence |
| `marcusrbrown/renovate-config` | `#5.2.3` | 5.2.1 → 5.2.3 (#983) |
| `bfra-me/.github` | v4.16.27 | v4.16.25 → v4.16.27 (#988, #995) |
| `pnpm` | 10.34.4 | 10.34.1 → 10.34.4 (#984, #987) |
| `Node.js` | 24.17.0 | 24.16.0 → 24.17.0 (#997, `.mise.toml`) |
| `vitest` / `@vitest/ui` | 4.1.9 | 4.1.8 → 4.1.9 (#999) |
| `tsx` | 4.22.4 | unchanged |
| `Prettier` | 3.8.4 | 3.8.3 → 3.8.4 (#981) |
| `@types/node` | 24.13.2 | 24.12.4 → 24.13.2 (#991) |
| `@bfra.me/eslint-config` | 0.51.1 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `jiti` | 2.7.0 | unchanged |
| `markdownlint-cli2` | 0.20.0 | unchanged |

Renovate remains fully healthy; the merge stream is still dominated by `fro-bot/agent` releases. This repo continues to lead the ecosystem on the agent pin.

### 2026-06-12 snapshot

| Dependency | This Repo | Delta vs 2026-06-02 |
| --- | --- | --- |
| `fro-bot/agent` | v0.61.0 (`6794bf5`, SHA-pinned) | v0.50.0 → v0.61.0 — 17 Renovate bumps in 10 days; this repo now leads the ecosystem with [[bfra-me--renovate-action]] (v0.60.0 as of 2026-06-11) |
| `marcusrbrown/renovate-config` | `#5.2.1` | 5.2.0 → 5.2.1 |
| `bfra-me/.github` | v4.16.25 | → v4.16.25 (#979) |
| `pnpm` | 10.34.1 | unchanged |
| `Node.js` | 24.16.0 | unchanged (`.mise.toml`) |
| `vitest` / `@vitest/ui` | 4.1.8 | 4.1.7 → 4.1.8 (#958) |
| `tsx` | 4.22.4 | 4.22.3 → 4.22.4 (#953) |
| `actions/checkout` | v6.0.3 (SHA-pinned) | → v6.0.3 (#951) |
| `@bfra.me/eslint-config` | 0.51.1 | unchanged |
| `Prettier` | 3.8.3 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `@types/node` | 24.12.4 | unchanged |
| `jiti` | 2.7.0 | unchanged |

Renovate is fully healthy; the merge stream is dominated by `fro-bot/agent` releases tracking the upstream [[fro-bot--agent]] release cadence.

### 2026-06-02 snapshot

| Dependency | This Repo | Delta vs 2026-05-18 |
| --- | --- | --- |
| `fro-bot/agent` | v0.50.0 (`de04256`) | **newly present** — workflow added via #924, then bumped v0.44.3 → v0.50.0 |
| `marcusrbrown/renovate-config` | `#5.2.0` | unchanged |
| `pnpm` | 10.34.1 | 10.33.4 → 10.34.1 |
| `Node.js` | 24.16.0 | 24.15.0 → 24.16.0 |
| `@bfra.me/eslint-config` | 0.51.1 | **0.50.1 → 0.51.1** — the trailing item flagged on 2026-05-18 is resolved |
| `vitest` / `@vitest/ui` | 4.1.7 | 4.1.6 → 4.1.7 |
| `tsx` | 4.22.3 | 4.22.0 → 4.22.3 |
| `Prettier` | 3.8.3 | unchanged |
| `@bfra.me/prettier-config` | 0.16.9 | unchanged |
| `@bfra.me/tsconfig` | 0.13.1 | unchanged |
| `@types/node` | 24.12.4 | unchanged |
| `eslint-config-prettier` | 10.1.8 | newly listed |
| `eslint-plugin-prettier` | 5.5.6 | newly listed |
| `markdownlint` | 0.40.0 | newly listed |
| `jiti` | 2.7.0 | unchanged |

The 2026-05-18 outstanding item — `@bfra.me/eslint-config` pinned at 0.50.1 while the ecosystem advanced past 0.51.0 — has cleared. Renovate is healthy and the only open PR is the routine generated-content build (#945, `mrbro-bot[bot]`).

### 2026-05-18 snapshot (post-thaw)

| Dependency | This Repo | Ecosystem Latest | Delta vs 2026-04-24 |
| --- | --- | --- | --- |
| `marcusrbrown/renovate-config` | `#5.2.0` | `#5.2.0` | `#4.5.1` → `#5.2.0` (major bump; preset regex fixed) |
| `bfra-me/.github` | v4.16.18 | v4.16.18 | v4.4.0 → v4.16.18 |
| `pnpm` | 10.33.4 | 10.33.4 | 10.31.0 → 10.33.4 |
| `Prettier` | 3.8.3 | 3.8.3 | 3.8.1 → 3.8.3 |
| `@bfra.me/prettier-config` | 0.16.9 | 0.16.9 | (newly pinned) |
| `@bfra.me/tsconfig` | 0.13.1 | 0.13.1 | (newly pinned) |
| `@bfra.me/eslint-config` | 0.50.1 | ≥0.51.0 | unchanged — still trailing |
| `Node.js` | 24.15.0 | 24.15.0 | 24.14.0 → 24.15.0 |
| `vitest` / `@vitest/ui` | 4.1.6 | 4.1.6 | 4.0.18 → 4.1.6 |
| `tsx` | 4.22.0 | 4.22.0 | 4.20.3 → 4.22.0 |
| `jiti` | 2.7.0 (`<2.8.0`) | 2.x | 2.6.1 → 2.7.0 |
| `@types/node` | 24.12.4 | 24.12.4 | (newly pinned) |
| `lint-staged` | 16.4.0 | 16.4.0 | unchanged |
| `simple-git-hooks` | 2.13.1 | 2.13.1 | unchanged |

### 2026-04-24 snapshot (pre-thaw, retained for history)

| Dependency | This Repo | Ecosystem Latest |
| --- | --- | --- |
| `marcusrbrown/renovate-config` | `#4.5.1` | `#4.5.8` |
| `bfra-me/.github` | v4.4.0 | v4.16.8 |
| `pnpm` | 10.31.0 | 10.33.0 |
| `Prettier` | 3.8.1 | 3.8.3 |
| `@bfra.me/eslint-config` | 0.50.1 | ≥0.51.0 |
| `Node.js` | 24.14.0 | 24.15.0 |

## 2026-05-18 Update: Renovate Thaw

The Renovate stall documented on 2026-04-24 has cleared. Issue #895 closed 2026-05-14T06:25:44Z. Marcus shipped #897 (`ci(renovate): update marcusrbrown/renovate-config preset to 5.2.0`) at 2026-05-14T06:20:01Z, which fixed the malformed RE2 regex in the preset chain. Within the same hour, Renovate flushed the backlog:

- #900: chore(deps) update all non-major dependencies
- #901: prettier → 3.8.3
- #902: jiti → `<2.8.0`
- #904 / #908: vitest monorepo → 4.1.5 → 4.1.6
- #898/#905: pin + bump `@bfra.me/prettier-config` to 0.16.7 → 0.16.8 → 0.16.9 (#910)
- #899/#906/#911: pin + bump `@bfra.me/tsconfig` to 0.12.2 → 0.13.0 → 0.13.1
- #907: chore(dev) pin dependencies (added `@types/node` 24.12.4)
- #909: `@types/node` → 24.12.4
- #912 → #915: rolling `bfra-me/.github` v4.16.17 → v4.16.18
- #913 / #914: tsx 4.21.1 → 4.22.0

The 6-week dependency drift documented previously is largely gone. Outstanding trailing item: `@bfra.me/eslint-config` is still pinned at 0.50.1 while the ecosystem advanced past 0.51.0 — Renovate has not opened a PR for this, suggesting either a deliberate pin or a missing range allowance. Worth verifying before next survey.

The "newly pinned" rows above reflect #907's pin sweep: previously caret-ranged dev deps were locked to exact versions, aligning with the rest of the ecosystem.

### Updated Open Work Items

| # | Title | Author | State | Notes |
| --- | --- | --- | --- | --- |
| #284 | Dependency Dashboard | mrbro-bot[bot] | open | Standard Renovate dashboard issue |
| #895 | Action Required: Fix Renovate Configuration | mrbro-bot[bot] | **closed** 2026-05-14 | Resolved by #897 (preset → 5.2.0) |

Backlog is back to baseline. The profile update pipeline (every 6 hours) and Renovate are both healthy.

## Survey History

| Date | SHA | Delta |
| --- | --- | --- |
| 2026-04-18 | `af78e68` | Initial survey |
| 2026-04-24 | `af78e68` | SHA unchanged; documented Renovate stall (issue #895), dependency drift vs ecosystem, fro-bot collaborator confirmed, open work items added |
| 2026-05-18 | `de594cd` | Renovate thaw confirmed (#895 closed, preset → 5.2.0 via #897); 18 dependency PRs landed 2026-05-14 → 2026-05-18; bumped `bfra-me/.github` v4.4.0 → v4.16.18, `pnpm` 10.31.0 → 10.33.4, `vitest` 4.0.18 → 4.1.6, `tsx` 4.20.3 → 4.22.0, `Node.js` 24.14.0 → 24.15.0, `Prettier` 3.8.1 → 3.8.3; new pinned deps added (`@bfra.me/prettier-config` 0.16.9, `@bfra.me/tsconfig` 0.13.1, `@types/node` 24.12.4); `@bfra.me/eslint-config` 0.50.1 still trailing; no Fro Bot workflow yet — follow-up PR still warranted |
| 2026-06-02 | `e39577c` | **Fro Bot onboarded** — `fro-bot.yaml` single-file three-mode workflow landed via #924 (evolution tracker #925), `fro-bot/agent` v0.44.3 → v0.50.0; contradicts prior "no Fro Bot workflow" claim, now resolved. New `.agents/skills/sync-sponsors-bio/` skill + `sponsors:bio:sync` script. Dep deltas: `pnpm` 10.33.4 → 10.34.1, `Node.js` 24.15.0 → 24.16.0, `@bfra.me/eslint-config` 0.50.1 → 0.51.1 (trailing item resolved), `vitest` 4.1.6 → 4.1.7, `tsx` 4.22.0 → 4.22.3. Perpetual issues live: Daily Maintenance Report #936, Daily Autohealing Report #926 |
| 2026-06-12 | `b26dd18` | **Steady state, version treadmill** — `fro-bot/agent` v0.50.0 → v0.61.0 (17 Renovate bumps, now SHA-pinned `6794bf5`); renovate-config preset 5.2.0 → 5.2.1; `bfra-me/.github` → v4.16.25; vitest → 4.1.8, tsx → 4.22.4; `issues: [opened, edited]` trigger + dispatch `mode` input added to `fro-bot.yaml`. Operational finding: daily close/reopen oscillation on maintenance issue #936 between autoheal (closes ~06:00 UTC) and maintenance (reopens ~17:30 UTC) runs — perpetual-issue churn anticipated in #925 now observable. Open items down to 4 |
| 2026-06-22 | `3ed89ff` | **Treadmill continues, maintenance issue now closed** — `fro-bot/agent` v0.61.0 → v0.75.0 (14 Renovate bumps #982–#1008, SHA `a12463f`); renovate-config 5.2.1 → 5.2.3; `bfra-me/.github` → v4.16.27; pnpm → 10.34.4; Node → 24.17.0; vitest → 4.1.9; Prettier → 3.8.4; `@types/node` → 24.13.2. `fro-bot.yaml` body unchanged (no trigger/prompt/hardening drift). Operational shift: the #936 close/reopen oscillation resolved into a **closed** state — #936 closed 2026-06-22, no longer in open set; only #926 (autoheal) remains open, so there is now *zero* open maintenance issue (inverse of prior churn, contract still unsatisfied). Generated-content PR rotated #960 → #1007. Open items: 3 (#926, #925, #284) |
| 2026-07-06 | `08bd1ad` | **Structural: pnpm 10→11 major + security overrides migrate to `pnpm-workspace.yaml`** — `fro-bot/agent` v0.75.0 → v0.83.1 (~16 bumps #1017–#1050, SHA `d1786f3`); **pnpm 10.34.4 → 11.9.0** (`[SECURITY]` #1021/#1024/#1025); **Prettier 3.8.4 → 3.9.4** (minor); renovate-config 5.2.3 → 5.2.4; `bfra-me/.github` v4.16.27 → v4.16.34; Node → 24.18.0; tsx → 4.22.5; `actions/cache` → v5.1.0. **New `pnpm-workspace.yaml`** with `allowBuilds`/`onlyBuiltDependencies` + GHSA-annotated override ledger (`vite 7.3.6`, `postcss`, `picomatch`, `fast-uri`; `jiti` pin relocated) — matches [[marcusrbrown--mrbro-dev]] override-ledger pattern. Direct `fix(security)` commit #1038 (vite 7.3.6). **First `fro-bot.yaml` body change since onboarding**: #1045 bare-dispatch-prompt fallback + `mrbro.dev` added to focus-repo list. **#936 reopened** (both #936/#926 open — contract satisfied again, but three-survey history = churn/closed/reopened = unstable). New autoheal issue #1039 (llms.txt drift). Generated PR #1007 → #1048 |
| 2026-07-20 | `abff970` | **Autoheal matures: report-noise → concrete fix PRs; agent self-catches a workflow bug** — `fro-bot/agent` v0.83.1 → v0.93.1 (~18 bumps #1050–#1085, SHA `a4976f4`); pnpm 11.9.0 → 11.13.1 (stays 11.x); Prettier 3.9.4 → 3.9.5; renovate-config 5.2.4 → 5.2.7; `bfra-me/.github` v4.16.34 → v4.16.38; tsx → 4.23.1; vitest → 4.1.10; `@types/node` → 24.13.3; Node unchanged (24.18.0). `fro-bot.yaml` body structurally unchanged (no trigger/prompt/hardening drift). **Operational shift: autoheal now ships remediation** — PR #1055 (fix markdownlint fence in `update-sponsors.ts` generator), PR #1061 (template-vs-generated README drift), issue #1056 (stale TODO in `badge-detector.ts`). **Self-audit bug: issue #1087** — fork-refusal preflight (line 577) uses jq `.head.repo.fork // "unknown"`, which mis-resolves same-repo `false` to `"unknown"` and over-refuses legitimate comment-triggered reviews; warrants a fix PR. Perpetual issues #936 + #926 both open — contract satisfied and **stable** (no oscillation, first stable window in 4 surveys). Pure Renovate treadmill (32 commits, all mrbro-bot); no direct `fix(security)`. Generated PR #1048 → #1088 |
| 2026-08-19 | `df85b7d` | **Fro Bot becomes a merge gate; agent crosses v0.100.0; autoheal category set corrected** — `fro-bot/agent` v0.93.1 → v0.100.0 (~20 bumps #1105–#1152, SHA `7b9a281`, still 0.x); pnpm 11.13.1 → 11.22.0; Node 24.18.0 → 24.19.0; Prettier 3.9.5 → 3.9.6; tsx → 4.23.12; renovate-config 5.2.7 → 5.2.12; `bfra-me/.github` v4.16.38 → v4.18.0 (#1156). **Structural: #1138 added `Fro Bot` to `main` required status checks** (`.github/settings.yml` contexts `[CI, Fro Bot, Renovate / Renovate, Prepare, Finalize]`, `enforce_admins: true`) — review verdict now blocks merge. **#1137/#1139** removed tsconfig `baseUrl`/`moduleResolution` (defers to `@bfra.me/tsconfig`); `.agents/skills/**/*` now type-checked. **Reconciliation:** autoheal `AUTOHEAL_PROMPT` runs 7 categories with **QUALITY GATES VERIFICATION at #5** (present since onboarding #924 per `git log -S`; prior page under-recorded it). **#1087 still open** — the *preflight step* (line 577) still uses jq `// "unknown"`; the job-level `if:` (line 540) was never buggy (prior page conflated the two). New `templates/sponsor-testimonials.tpl.md`, `.ai/plan/` dir. Override ledger byte-identical; no `fix(security)`. Autoheal shipped #1061/#1117 in-window |
| 2026-09-07 | `958be8d` | **No structural change — and four green gates each covering a different hole.** 41 commits, 40 `mrbro-bot[bot]` Renovate + **one human**; `fro-bot.yaml` is `+1/-1` (agent pin only); branch protection, prompts, crons, `setup` action all byte-stable; 25/25 scheduled runs `success`. **(1)** The required `Fro Bot` check skips `[bot]` authors and `fro-bot` **by name** (`fro-bot.yaml:536-553`), and skipped ⇒ passing — so across 41 commits it evaluated **one** PR (#1194, the human one), and the agent's own PRs certify `clean` with `Fro Bot: skipped` (verified on #1094 head `7c09752`). Same mechanism as [[bfra-me--ha-addon-repository]], inverted consequence. **(2)** Six open PRs, five `fro-bot`-authored; **four green, mergeable security PRs stranded 44–61 days** (#1094 js-yaml + per-parent-scoped `minimatch@3>brace-expansion`/`minimatch@10>brace-expansion`, #1100 fast-uri ≥3.1.5 + linkify-it, #1107 postcss ≥8.5.23 — each raising a floor against advisories **newer** than the tree's ledger, not re-proposing it) while 40 Renovate PRs merged same-day; #1055/#1095 are duplicate `chore(lint)` siblings both now `dirty`, the fix having landed via a **third** sibling #1117 on 2026-08-10 — **supersedes** the 2026-07-20 claim that #1055 shipped. **(3)** The profile pipeline **has not delivered through its own path in 28 days**: last `build:` commit is #1129 (2026-08-10), ten consecutive `build/update-readme` PRs (#1140→#1189) all unmerged, `README.md` unchanged since 2026-05-23 (107 days, ~428 green scheduled runs) — because `update-profile.yaml` also runs on `pull_request` and commits regenerated content onto every PR head, so `BADGES.md`/`SPONSORME.md` reach `main` exclusively as riders on Renovate `chore(deps)` merges. Profile freshness is now coupled to Renovate PR volume. **(4)** The generated artifact is unaudited: `main` publishes `TypeScript 24.13.3` (= `@types/node`; TypeScript is not a dependency), `ESLint 5.5.6` (= `eslint-plugin-prettier`), ESLint filed under *Cloud & Infrastructure*, and a "updated every 6 hours" caption over a closed delivery path — the quality-gate category smoke-tests that generation *succeeds*, never that output is *true*. **(5)** The 50,000-char archival clause **does fire here** (6 recorded events on #936, 2 on #926); #936 measures **47,849 chars / 6 sections**, per-section floor ≈7,780, and 50,000 ÷ 7,780 = 6 — the observed steady state equals the arithmetic, a third confirmation of the [[marcusrbrown--systematic]] #153 rule. This repo adds a third unreachable number: the "14 days of individual sections" rule implies ~108,900 chars, **1.7× GitHub's hard 65,536 body limit**, and the "keep 30 most recent" remedy implies ~233,000, **4.7× the threshold it enforces**. **Corrects** the fleet reading that attributed [[marcusrbrown--cortexkit-anthropic-auth]] #11's overrun to an unexecutable clause. **Human commit #1194** broke a **Renovate self-update deadlock** — `bfra-me/.github` v4.25.0 shipped a [[bfra-me--renovate-action]] runtime missing `tar`, Renovate exited before servicing dependencies, so the pin could not self-update; Renovate re-proposed the same bump as a no-op one commit later (#1195). New `minimumReleaseAgeExclude` block in `pnpm-workspace.yaml` — pnpm 11 publish-age cooldown waived per-version by Renovate for `@bfra.me/*`, append-only with no reaper (`0.51.2`/`0.16.10` already superseded and still listed). Versions: agent v0.100.0 → **v0.109.4** (`b799b64`, **ecosystem leader**), `bfra-me/.github` v4.18.0 → **v4.26.0** (8 minors / 19 days), pnpm → 11.25.0, Node → 24.20.0, `@bfra.me/eslint-config` 0.51.1 → **0.52.1**, prettier-config → 0.16.11, tsconfig → 0.13.2, vitest → 4.1.11, tsx → 4.23.13, simple-git-hooks → 2.14.0, renovate-config → #5.2.13. Carried: #1087 untouched since filing (50 d, line 577 verbatim), #1056 (61 d, TODO still at `badge-detector.ts:72`), #1039 (67 d, **partially self-healed** — map now covers `sponsor-testimonials.tpl.md` and the sync-sponsors-bio skill, still omits `HIGHLIGHTS.md`/`HIGHLIGHTS.tpl.md`), #925 untouched since 2026-05-23 (`timeout: 0` still at line 648). Perpetual-issue contract satisfied and stable for a sixth window (#936 103 comments, #926 99) |
