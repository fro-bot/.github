---
type: repo
title: marcusrbrown/Presentations
created: 2026-08-05
updated: 2026-09-17
sources:
  - url: https://github.com/marcusrbrown/Presentations
    sha: 34321a4c4a38c99c4bd8b683f267ddba05cd6fe4
    accessed: 2026-08-05
  - url: https://github.com/marcusrbrown/Presentations
    sha: 4613f9978b535207a333e48f1899d1500b2945c8
    accessed: 2026-09-01
  - url: https://github.com/marcusrbrown/Presentations
    sha: e510e237f5ac65164d4c259c1205f6adef5ab2ba
    accessed: 2026-09-17
tags:
  - presentations
  - slides
  - react
  - spectacle
  - slidev
  - github-pages
  - blockchain
  - llm
  - meetup
  - bun
  - opencode
  - shell
  - abandoned-dependencies
  - renovate
related:
  - marcusrbrown--github
  - marcusrbrown--renovate-config
  - marcusrbrown--mothership
  - marcusrbrown--mrbro-dev
  - marcusrbrown--esphome-life
  - marcusrbrown--marcusrbrown-com
  - marcusrbrown--tokentoilet
  - bfra-me--renovate-action
  - github-pages
  - github-actions-ci
  - probot-settings
node_id: MDEwOlJlcG9zaXRvcnk4MjcxMzM5Ng==
---

# marcusrbrown/Presentations

Marcus R. Brown's slide-deck archive — "A collection of presentations I've given." A polyglot **monorepo of independent talks**, each in its own top-level directory with its own build toolchain, published to [[github-pages]] at `marcusrbrown.github.io/Presentations/`. Created 2017-02-21; the oldest deck dates to that first commit, the newest was added 2026-08-04.

## Overview

- **Purpose:** Archive of conference/meetup presentation decks, one directory per talk
- **Default branch:** `main`
- **Created:** 2017-02-21
- **Repo id:** `82713396` · not a fork, not a template, `disabled: false`
- **Visibility:** Public (`private: false`, `visibility: public` — re-confirmed 2026-09-01)
- **License:** None declared

### 2026-09-17 (HEAD `e510e237`)

- **Last push:** 2026-09-17T01:04:33Z · **Updated:** 2026-09-17T01:02:00Z
- **Homepage:** `https://mrbro.dev/Presentations/` (unchanged) · **Pages:** enabled
- **Topics (10):** unchanged
- **Language:** Shell (unchanged) · **Size:** 5019 KB (was 5047)
- **Tree:** 53 entries / **42 blobs** — *identical to `4613f997`; not one file added or removed*
- **Stars:** 1 · **Watchers:** 1 · **Forks:** 0 · **Subscribers:** 2 · **Open issues:** 2 (was 3) = 1 PR + the dashboard issue
- **Visibility:** Public (`private: false`, `visibility: public` — re-confirmed) · **`archived: false`** on the live API for the third consecutive survey
- **License:** still none declared

> **Count correction (supersedes 2026-09-01).** The prior survey recorded the tree as "53 entries (33 blobs)". The blob count is **42**, and it cannot have changed in this interval — the `4613f997...e510e237` comparison lists seven modified files and **zero** additions or deletions. The 33 was an arithmetic error on the prior pass; the 53-entry total was correct. Recorded rather than silently fixed, per schema §Update Rules.

### 2026-09-01 (HEAD `4613f997`)

- **Last push:** 2026-08-31 · **Updated:** 2026-08-31
- **Homepage:** `https://mrbro.dev/Presentations/` — **changed** from `marcusrbrown.github.io/Presentations/`. Not a hosting move: `marcusrbrown.github.io` is the *user* Pages site, whose custom domain is `mrbro.dev` ([[marcusrbrown--mrbro-dev]]), so every project Pages path underneath it is served from the apex. The declared homepage was simply updated to the canonical URL in `chore: update repo settings (#62)`.
- **Topics (10, was 6):** added `opencode`, `cheap-llms`, `slides`, `slidev`
- **Language:** **Shell** (was JavaScript) — flipped by the ~33 KB of Bash added under `Cheap-LLMs-Meetup-Aug-2026/demo/`
- **Size:** 5047 KB · **Tree:** 53 entries (was 42 at `34321a4`)
- **Stars:** 1 · **Watchers:** 1 · **Forks:** 0 · **Open issues:** 3 (= 2 PRs + 1 dashboard issue)

### 2026-08-05 (HEAD `34321a4`)

- **Last push:** 2026-08-04
- **Homepage:** `https://marcusrbrown.github.io/Presentations/` (GitHub Pages enabled)
- **Topics:** `blockchain`, `ethereum`, `ethereum-classic`, `meetup`, `presentations`, `react`
- **Language:** JavaScript (11.7 KB) / HTML (4.2 KB) / CSS (0.4 KB) — small footprint; decks vendor their own deps
- **Stars:** 1 · **Watchers:** 1 · **Forks:** 0 · **Open issues:** 3

## 2026-09-17 survey — a frozen tree whose only human commit is an incident response

Third survey. **Nothing in the content tree moved.** All 14 commits between `4613f997` and `e510e237` touch pins and lockfiles only: four workflow/config one-liners, `yarn.lock`, `bun.lock`, and one line of `slides/package.json`. No deck changed, no script changed, `index.html` and the `demo/` harness are byte-identical. This is the first fully-inert content interval in the series, and it is exactly the interval that produced the sharpest finding — because the interesting thing happened to the automation, not to the archive.

Authorship: 13 commits `mrbro-bot[bot]`, **1 `marcusrbrown`** — and that one commit is this repo's entry in the fleet-wide `bfra-me/renovate-action` `tar` incident of 2026-09-04.

### The `tar` incident: third inside view, and the one that prices the fleet sweep

The mechanism is established at [[marcusrbrown--github]] (first view) and [[marcusrbrown--esphome-life]] (second). `bfra-me/.github` v4.25.0 carried `bfra-me/renovate-action` **10.34.0**, whose bundle left `tar` a devDependency; Renovate exits before servicing any dependency, so the pin that would deliver the fix is the pin that can no longer move. Presentations is the third repo, and the timings are exact:

| Event | Time (UTC) | Commit |
| --- | --- | --- |
| Poisoned pin merged (`#81`, v4.24.0 → **v4.25.0**, both workflow files) | **16:27:58** | `e6c60ed1` |
| Last Renovate run before the outage (`workflow_run`, `success`, **zero PRs**, 49 s) | 16:29:41 – 16:30:30 | run #188 |
| — *total silence, no Renovate run of any kind* — | **6 h 27 m** | — |
| Human pushes the fix branch; Renovate wakes on that branch's own workflow file | 22:57:39 | run #190 |
| Human merges `#82` — **`renovate.yaml` only, `+1/-1`** | **22:58:51** | `59953e1a` |
| Repaired Renovate re-opens the queue (4 branches in ~32 s) | 23:01:00 – 23:01:32 | — |
| Renovate self-heals the sibling file (`#83`, `update-repo-settings.yaml` → v4.25.1) | **23:02:47** | `23a81d9c` |

**Inert window 6 h 30 m 53 s.** The commit body on `#82` states the loop verbatim: *"Takes bfra-me/renovate-action 10.34.1, which restores tar in the Renovate runtime. Renovate on 10.34.0 exits before servicing any dependencies, so this pin cannot self-update."*

Three things this repo adds that the first two views could not.

**1. Without a cron, the outage is a deadlock, not a delay.** `renovate.yaml` here has **no `schedule:` trigger** — it fires on `issues.edited`, `pull_request.edited`, push to non-`main` branches, `workflow_dispatch`, and `workflow_run` on CI completion. The live chain is *merge → CI on `main` → `workflow_run` → Renovate pass*. A poisoned Renovate opens no PRs, so nothing merges, so CI never runs on `main`, so **no `workflow_run` ever fires**, so Renovate never runs again. The run history confirms it: run #188 ends 16:30:30 and the next Renovate run of any kind is at 22:57:39.

This is the complement of the sibling repos, not a repeat. [[marcusrbrown--github]] had a cron, so its outage manufactured **false green** — a scheduled run concluding `success` with zero output. Presentations had no cron, so its outage manufactured **no signal at all**. A monitor watching for failures saw nothing; a monitor watching for runs saw nothing; only a monitor watching for *output over a window* could have seen it. And the human was not merely faster than the machine — the machine had removed its own recovery path, because the trigger it needs (a merge) is the output it can no longer produce. Generalized into [[github-actions-ci]] alongside the existing `workflow_run`-chained-updater entry from [[marcusrbrown--marcusrbrown-com]].

Small confirming detail: the wake-up at 22:57:39 came from the **human's fix-branch push**, which ran `renovate.yaml` *from the branch* — i.e. already on v4.25.1. The repaired Renovate ran a minute before the PR merged.

**2. Two references to a poisoned tag are not two units of blast radius — correct wiring made the second one inert.** This repo has the same two-caller structure as [[marcusrbrown--esphome-life]]: `renovate.yaml` and `update-repo-settings.yaml` both pin `bfra-me/.github`, and `#81` bumped both to the poisoned tag. The human fixed **only** `renovate.yaml` and left the sibling on v4.25.0 — and nothing bad happened, because here `update-repo-settings.yaml` points at the *settings-sync* reusable workflow. It ran on the poisoned tag at 16:28:02, concluded `success` in 18 seconds, and never touched `renovate-action`. Full remediation took **3 m 56 s**.

At esphome.life the same second reference is **mis-pathed into the Renovate workflow**, so merging the fix re-executed the known-poisoned runner and full remediation needed 34 m 53 s more. The [[github-actions-ci]] "wrong-path `uses:` is an incident amplifier" finding therefore holds, but its scope needs narrowing: **the amplification is a property of the miswiring, not of having a second reference to the shared tag.** Blast radius is per-*consumer*, not per-*reference*. Presentations is the control that separates the two variables — same org, same tag, same two-file structure, same one-line minimal fix, correct wiring, ~9× faster close-out. That is the third time this repo has served as the control case against esphome.life.

**3. The fleet sweep now has three points, and propagation and remediation are asymmetric by three orders of magnitude.** Poisoned: Presentations 16:27:58, `marcusrbrown/.github` ~16:28, esphome.life 16:35:43 — **~8 minutes to propagate across the fleet**, fully automated. Repaired: `marcusrbrown/.github` 22:56, **Presentations 22:58:51**, esphome.life 23:01:26 — **~2.5 minutes per repo, serial, by hand, 6.5 hours later.** One diagnosis amortized across N repos; N manual PRs that do not. This is the concrete measurement behind the existing *recovery is O(repos), paid by a human, serially* rule.

### PR #54: clean, green, and 45 days unmerged

`chore(dev): pin dependency @slidev/cli to 52.20.1`, opened 2026-08-03, **still open**. Live state: `mergeable: true`, `mergeable_state: clean`, `auto_merge: null`, no `draft`, and all three required contexts green on the head SHA (`Build` success, `Test` success, `Renovate / Renovate` success; `Deploy` correctly `skipped`). Branch protection sets `required_pull_request_reviews: null`. **Nothing is blocking this PR.** One click merges it and nothing is asking anyone to click.

The prior survey's inference — "pin-type PRs fall outside the preset's automerge rules and nothing routes them to a human" — is **falsified as stated**: its sibling `#55` was the same class of `rangeStrategy: pin` PR and it automerged on 2026-09-05T00:00:34Z (58 minutes after the Renovate recovery, after 33 days open). The class is not excluded. What remains true is the observable: #54 has sat clean and green for 45 days with no gate that explains it.

The more interesting property is what the PR *costs*. Renovate rebases it onto every `main` commit — its title has drifted `52.19.1` → `52.20.1` and its `updated_at` is today — so each of the 14 interval commits bought it a fresh `Build` + `Test` + `Renovate` cycle, plus at least one `CI` run cancelled mid-rebase on `renovate/pin-dependencies`. **An auto-rebased open PR can never go stale, never conflict, and never fail, so every staleness, conflict, and failure detector is structurally blind to it.** Only an open-PR-*age* metric sees it at all. Generalized into [[github-actions-ci]].

### The pin landed on the dependency that cannot move and stalled on the one that does

`#55` merged, so `slides/package.json` now reads:

```json
"@slidev/cli": "^52.1.0",
"@slidev/theme-seriph": "0.25.0"
```

`@slidev/theme-seriph` is exact-pinned — and is still on Renovate's **abandoned** list (last release **2024-02-02**), so the pin is a semantic no-op exactly as the prior survey predicted (`^0.25.0` already resolved to the only release). Meanwhile `@slidev/cli`, which ships continuously, remains a floating caret, its pin PR is 45 days old, and **`renovate/slidev-cli-53.x` is simultaneously parked under _Pending Status Checks_** — a pin proposal and a major upgrade racing on the same package.

Stated plainly: the automation froze the dependency that was already frozen and left floating the one that actually churns. That is the inverse of what a risk-driven pin policy would do. Neither outcome was a decision; both are what the preset's automerge matrix happened to produce.

### Dependency Dashboard (#41) — 2026-09-17

- **Abandoned (3), unchanged:** `@slidev/theme-seriph` (2024-02-02), `gh-pages` (2025-01-02), `react-scripts` (2025-02-14). No action taken on any of them in 16 days.
- **Pending Approval (4), unchanged and still unchecked boxes:** `actions/checkout` v7, `actions/setup-node` v7, Node.js **v24 (now resolved at 24.21.0)**, react monorepo v19.
- **New — Pending Status Checks:** `renovate/slidev-cli-53.x` (`@slidev/cli` v53 major).
- **Open (1):** `#54`.
- **Vulnerabilities:** still none on osv.dev.
- **The `NODE_VERSION` footgun is now externally visible.** The dashboard's regex manager lists `node 20.20.2` **twice** under `ci.yaml` — one detection per `setup-node` step — which is the duplication the prior survey flagged, surfaced as two detected dependencies for one logical pin. Hoisting to workflow-level `env:` would collapse them.
- Also newly recorded: the 2017 deck carries `assert: npm:assert@2.1.0`, an aliased Node-polyfill dependency (the usual CRA 5 / webpack 5 accommodation), not noted on prior passes.

### Version deltas

| Thing | 2026-09-01 | 2026-09-17 |
| --- | --- | --- |
| `bfra-me/.github` reusable (both callers) | v4.23.0 `eb1772eb` | **v4.30.0** `5486c68e` — 7 minor boundaries in 16 days (`#80`–`#90`), one of them the poisoned v4.25.0 |
| `marcusrbrown/renovate-config` preset | `#5.2.12` | **`#5.2.13`** (`#84`) |
| `actions/deploy-pages` | v5 | **v5.0.1** `368f8252` (`#78` digest, `#79` version) |
| `actions/checkout` / `setup-node` / `setup-bun` / `configure-pages` / `upload-pages-artifact` | v4.4.0 / v4.4.0 / v2.2.0 / v6 / v5 | unchanged |
| `@slidev/theme-seriph` | `^0.25.0` | **`0.25.0`** (exact, `#55`) |

### Run health: zero failures, and a 23% boot-and-skip tax

Across the last 100 workflow runs (2026-09-05 → 2026-09-17) there are **no failures**. Breakdown: `CI` 18 PR + 7 push success, 1 PR cancelled (the #54 rebase); `Renovate` 21 push + 8 `workflow_run` + 3 `pull_request` success; `Update Repo Settings` 12 schedule + 7 push success; and **23 `Renovate` / `issues` / `skipped`**.

Those 23 are the `issues.edited` runs firing on Renovate's own dashboard rewrites — 90 such runs lifetime, every one skipped at the job level with `started_at == completed_at` (0 s). At ~23% of all runs this is the cheapest instance of the no-op run storm recorded in the fleet, and unlike the [[marcusrbrown--tokentoilet]] and [[marcusrbrown--dotfiles]] cases it costs no runner minutes.

> **Contradiction recorded, not resolved: the guard's behavior does not follow from its text.** `renovate.yaml`'s job condition is
>
> ```yaml
> if: >
>   (github.event.action == 'edited' && !contains(github.actor, '[bot]')) ||
>   (github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success')
> ```
>
> For a bot-authored `issues.edited` event the first disjunct is false, but the second disjunct's `github.event_name != 'workflow_run'` is **true**, so a literal reading makes the whole expression true and the job should run. Observed behavior is the opposite and is unambiguous: 90 for 90 skipped, instantly, at the job level. A read-only survey cannot close the gap between the text and the outcome. The reportable property is the gap itself — **a guard whose observed behavior cannot be derived by reading it is a guard nobody can safely edit**, and the first person to "simplify" this condition has no way to predict what they will break. Splitting it into named `workflow_run`-only and edit-only conditions would make it verifiable.

## Repository Structure

Each presentation is a self-contained subtree. There is no root `package.json` — the repo is not a workspace, just a directory collection under shared `.github/` governance.

| Path | Purpose | First seen |
| --- | --- | --- |
| `.github/workflows/ci.yaml` | CI: build + test + **assemble and deploy both decks to Pages** (deploy half added 2026-08-05, `#60`) | 2026-08-05 |
| `.github/workflows/renovate.yaml` | Renovate runner (reusable from `bfra-me/.github@v4.23.0`) | 2026-08-05 |
| `.github/workflows/update-repo-settings.yaml` | Probot settings sync (reusable from `bfra-me/.github@v4.23.0`) | 2026-08-05 |
| `.github/settings.yml` | Probot settings, extends `.github:common-settings.yaml` | 2026-08-05 |
| `.github/renovate.json5` | Renovate config (extends `marcusrbrown/renovate-config#5.2.12`) | 2026-08-05 |
| `.editorconfig`, `.gitignore` | Editor / VCS hygiene (root `.gitignore` is now OpenCode-aware — see below) | 2026-08-05 |
| `README.md` | One-line title + CI badge (no index of decks) | 2026-08-05 |
| `index.html` | **Root landing page** — hand-written, dependency-free static HTML/CSS deck index; the Pages site root | 2026-09-01 |
| `Blockchain-Meetup-Feb-2017/` | **Deck 1** — Create React App + Spectacle | 2026-08-05 |
| `Cheap-LLMs-Meetup-Aug-2026/` | **Deck 2** — Slidev, added 2026-08-04 | 2026-08-05 |
| `Cheap-LLMs-Meetup-Aug-2026/OUTLINE.md` | Talk outline + research notes (**re-added**; see contradiction below) | 2026-09-01 |
| `Cheap-LLMs-Meetup-Aug-2026/GLOSSARY.md` | Term glossary for the LLM talk | 2026-09-01 |
| `Cheap-LLMs-Meetup-Aug-2026/demo/` | **Live-demo rehearsal harness** — `run-preset.sh`, `run-preset.test.sh`, `reset-demo.sh`, `NOTES.md`, `prompt.txt` | 2026-09-01 |
| `Cheap-LLMs-Meetup-Aug-2026/slides/components/ImageZoom.vue` | Slidev Vue component backing the deck's zoom support (`#58`) | 2026-09-01 |

The 2026-09-01 tree is **53 entries (33 blobs)**, up from 42 at `34321a4`. Growth is entirely inside `Cheap-LLMs-Meetup-Aug-2026/` plus the new root `index.html`; the 2017 deck's subtree is byte-identical apart from a `yarn.lock` maintenance pass (502656 → 501106 bytes).

### Root `.gitignore` is OpenCode-aware (2026-09-01)

```gitignore
# Opencode
!.opencode/
.opencode/*
!.opencode/commands/
!.opencode/themes/
!.opencode/tui.json
.worktrees
```

An ignore-everything-then-allowlist pattern for an agent workspace, plus `.worktrees`. **No `.opencode/` files are actually tracked** — this is anticipatory hygiene, written before the directory exists, so that a future commit can't accidentally sweep in session state. Matches the newly-added `opencode` repo topic and the demo harness's OpenCode config manipulation (below). A slide archive is now carrying agent-workspace boundaries.

## Presentations

### Blockchain-Meetup-Feb-2017 (Deck 1)

The founding artifact. A **Create React App** single-page slide deck built on **Spectacle 10.2.3** (React presentation framework).

- **Stack:** React 18.3.1 + ReactDOM 18.3.1, `react-scripts` 5.0.1, `spectacle` 10.2.3, `gh-pages` 6.3.0 for deploy
- **Package manager:** Yarn (`yarn.lock`, `yarn install --frozen-lockfile` in CI)
- **Scripts:** `start`/`build`/`test`/`eject` (CRA defaults) + `predeploy`/`deploy` (gh-pages to `build/`)
- **Structure:** `src/{App,Demo,Introduction,Overview,renderSlideSet}.js` — slides composed as React components; `public/{index,404}.html`
- **`homepage`:** `https://marcusrbrown.github.io/Presentations` (drives CRA's relative-path build)
- Modernized well past its 2017 origins: React 16-era CRA scaffolds have been bumped to React 18 / react-scripts 5, and the deps carry `renovate:` annotations. This is the only deck the CI pipeline builds and tests.

### Cheap-LLMs-Meetup-Aug-2026 (Deck 2)

Added 2026-08-04 (`chore: add 2026-08-04 presentation (#49)`). Working title on the slide subtree: **"$200 Intelligence on a $10 Budget"** — a talk for the "Cracked Claude Cowork and Codex Club" (Aug 4 & 5, 2026). A nine-year jump in toolchain from Deck 1.

- **Stack:** [Slidev](https://sli.dev) — `@slidev/cli` ^52.1.0 + `@slidev/theme-seriph` ^0.25.0. Markdown-driven slides (`slides.md`), not React components.
- **Package manager:** **Bun** (`bun.lock`, `bun install` / `bun run dev|build|export`) — diverges from Deck 1's Yarn and from the pnpm norm elsewhere in Marcus's ecosystem.
- **Layout:** `Cheap-LLMs-Meetup-Aug-2026/slides/{slides.md, package.json, bun.lock, public/images/*}`. Assets include `aa-intelligence-vs-cost.png` and a `repo-qr.png`.
- **Workflow:** `bun run dev` presents at `localhost:3030` (presenter mode `/presenter`); `bun run build` emits a static SPA in `dist/`; `bun run export` renders PDF via playwright-chromium. Speaker notes are inline HTML comments in `slides.md`.
- **Provenance note (2026-08-05):** the deck's README references a sibling `../OUTLINE.md` with research notes, but that file was **deliberately removed from source control** (`chore: update slides, outline, and add QR png (#50)` — "remove OUTLINE.md from source control"). Not surveyed; content unknown by design.

The two decks bracket the archive's evolution: a 2017 React/Spectacle SPA at one end, a 2026 Slidev/Bun Markdown deck at the other. No shared build tooling between them — each talk is frozen in the stack of its era.

#### 2026-09-01 update to Deck 2

The Slidev deck stopped being a bare `slides.md` and grew into a full talk kit across `#57`–`#60`:

- `slides.md` 12203 → 13847 bytes; frontmatter confirmed (`theme: seriph`, `title: '$200 Intelligence on a $10 Budget'`, `titleTemplate: '%s — Marcus R. Brown'`, `highlighter: shiki`, `transition: fade`, `mdc: true`). Subtitle on the title slide: **"Kimi Models & More."** Speaker notes remain inline HTML comments; the title-slide note records a 30-minute slot with ~12 minutes of live demo.
- **Zoom support** (`#58`): new `slides/components/ImageZoom.vue`, a Slidev Vue component. `public/images/aa-intelligence-vs-cost.png` was regenerated at 141587 → 319973 bytes — consistent with a higher-resolution asset shipped to survive zooming.
- `slides/package.json` `build` script now carries an explicit base path: `slidev build slides.md --base /Presentations/Cheap-LLMs-Meetup-Aug-2026/`. That is the hook the new Pages assembly step depends on.
- New sibling docs `GLOSSARY.md` (4876 B) and `demo/NOTES.md` (14250 B).
- `Cheap-LLMs-Meetup-Aug-2026/.gitignore` still excludes agent working docs: `HANDOFF.md`, `TALK-TRACK.md`, `DEMO-RUNBOOK.md`. Deliberately-ephemeral prep artifacts, not surveyed.

##### Contradiction resolved: `OUTLINE.md` is back

The 2026-08-05 survey recorded `OUTLINE.md` as **deliberately removed from source control**. That was correct at `34321a4` — the recursive tree at that SHA contains no such blob. At `4613f997` the file is **present at 15788 bytes**, and `slides/README.md` still links it as `../OUTLINE.md`.

Both observations stand; the removal was reverted between 2026-08-04 and 2026-08-31. Most likely reading: the outline was pulled during the pre-talk scramble to keep in-flight prep private, then restored once the talk had been delivered and the notes became archive material rather than working state. The `.gitignore` in the same directory shows the durable line — `HANDOFF.md`/`TALK-TRACK.md`/`DEMO-RUNBOOK.md` are *permanently* out; `OUTLINE.md` and `GLOSSARY.md` are in. **Prior page content superseded, not deleted** (schema §Update Rules).

### Demo rehearsal harness (`Cheap-LLMs-Meetup-Aug-2026/demo/`, new 2026-09-01)

`feat(demo): add repeatable preset rehearsal harness (#57)` added ~33 KB of Bash. This is the single most surprising thing in the repo: **a slide-deck archive containing a hermetic, unit-tested rehearsal rig for a live demo.**

| File | Size | Role |
| --- | --- | --- |
| `run-preset.sh` | 15982 B | Driver — runs the demo under a chosen OpenCode model preset |
| `run-preset.test.sh` | 16896 B | **Test suite for the driver** (`assert_eq`/`assert_contains`/`assert_file`/`assert_clean_repo`) |
| `reset-demo.sh` | 1885 B | Returns the demo worktree to a pinned baseline commit |
| `NOTES.md` | 14250 B | Demo runbook |
| `prompt.txt` | 1726 B | The prompt fed to the agent on stage |

Engineering notes:

- **Both scripts are `set -euo pipefail` with a real signal discipline.** `run-preset.sh` installs `trap`s on `EXIT`/`INT`/`TERM`, and its `on_exit` handler runs `perform_reset_after` then `cleanup_temp`, preserving the original exit status unless the reset itself fails. A live demo that dies mid-run still leaves a clean tree.
- **`reset-demo.sh` is defensive to the point of paranoia** before it will `git reset --hard`: the target must exist, be a git worktree, be the worktree *root* (`rev-parse --show-toplevel` must equal the resolved path), have `remote.origin.url` **and** `pushurl` both equal to the expected remote, contain the pinned baseline commit object, and have the demo branch present. Only then does it destroy state — and it re-checks `git status --porcelain` afterward and exits non-zero if anything survived. This is the correct shape for a destructive helper: prove identity, then act.
- **The demo target is [[marcusrbrown--mothership]]** — `EXPECTED_REMOTE=git@github.com:marcusrbrown/mothership.git`, `DEMO_BRANCH=demo/cccc-aug-2026`, pinned `BASELINE` commit, and a RED-test hint printed on reset (`bun test src/app/StartupHandshake.test.ts -t 'LiveServerStatus'`). The talk demos agents doing TDD on Marcus's own agentic IDE. First cross-repo demo coupling recorded in this wiki.
- **`run-preset.sh` manipulates the operator's global OpenCode config** (`${HOME}/.config/opencode/opencode.json`) and provisions its own temporary config dir (`RUN_PRESET_OWN_OPENCODE_CONFIG_DIR`), cleaned up on exit — the mechanism behind "preset-switchable model sets" in the deck's `info` blurb. Related model-preset machinery lives in [[marcusrbrown--dotfiles]].
- **Hard-coded operator path:** `DEFAULT_REPO=/Users/mrbrown/src/github.com/marcusrbrown/.demo-workspaces/…`, overridable via `MOTHERSHIP_DEMO_REPO`. Single-operator by design; the env override is the portability seam.

> **Footgun: the repo grew a test suite and the CI gate doesn't run it.** `run-preset.test.sh` is a genuine 17 KB assertion harness, and `ci.yaml` never invokes it. Meanwhile CI *does* run `yarn test` for the 2017 deck, whose only test is CRA's stock `App.test.js` smoke render (375 B). The gate covers the trivial suite and skips the substantial one. Cheap fix: one `bash Cheap-LLMs-Meetup-Aug-2026/demo/run-preset.test.sh` step in the `test` job — though note the tests likely assume a local isolated repo fixture (`ISOLATED_REPO`), so hosted-runner viability is unverified from a read-only survey.

### Root landing page (`index.html`, new 2026-09-01)

A single hand-written, **zero-dependency** HTML file that serves as the Pages root and indexes the decks (`Presentations · Marcus R. Brown`, per-deck cards with `.deck-meta`/`.tag`/`.deck-link`). No build step, no framework, no bundler — it is copied verbatim into `_site/index.html` by CI.

Notable because of *how* it is styled: the entire palette is declared in **OKLCH** custom properties (`--bg: oklch(0.99 0.003 40)`, `--accent: oklch(0.4 0.17 250)`), with inline comments justifying WCAG AA contrast on both light and dark schemes, a `prefers-color-scheme: dark` block whose background is annotated *"Matches Spectacle #1F2022"* (the 2017 deck's chrome), `a:focus-visible` outlines, `max-width: 65ch`, and `aria-label` on the archive section. That is the same OKLCH-first, accessibility-gated design vocabulary enforced by the `.impeccable` design gate in [[marcusrbrown--mrbro-dev]] and [[fro-bot--dashboard]] — applied here in a plain `.html` file with no tooling to enforce it. The design standard travelled without the gate.

## CI/CD Pipeline

### ci.yaml — 2026-08-05 state (superseded)

Single-purpose: it builds and tests **only** `Blockchain-Meetup-Feb-2017` (hard-coded `working-directory`). The Slidev deck has no CI coverage.

- **Triggers:** `pull_request`, `push` to `main`, `workflow_dispatch`
- **Concurrency:** `${{ github.workflow }}-<head_ref|ref>`, cancel-in-progress
- **Jobs:** `Build` (yarn install --frozen-lockfile → `yarn build`) and `Test` (→ `yarn test`), both on `ubuntu-latest`, Node **20.20.2** (pinned via `NODE_VERSION` env with a `renovate:` annotation)
- **Actions:** `actions/checkout` (SHA-pinned v4.4.0), `actions/setup-node` (SHA-pinned v4.4.0)

### ci.yaml — 2026-09-01 state: CI became the Pages deploy pipeline

`feat(deploy): publish both presentation decks (#60)` roughly doubled the workflow (1398 → 3102 bytes) and changed its category. It is no longer a build gate; it is the **publishing pipeline for the whole archive**, on the modern `configure-pages` → `upload-pages-artifact` → `deploy-pages` artifact model.

Triggers, concurrency, and `permissions: contents: read` at workflow level are unchanged. Job graph is now three jobs:

| Job | Change |
| --- | --- |
| `Build` | Still defaults to `working-directory: Blockchain-Meetup-Feb-2017` and runs `yarn install --frozen-lockfile` → `yarn build`. **Then** installs Bun (`oven-sh/setup-bun` v2.2.0, SHA `0c5077e5`), runs `bun install --frozen-lockfile` + `bun run build` in `Cheap-LLMs-Meetup-Aug-2026/slides`, assembles `_site/` (copies root `index.html`, `Blockchain-Meetup-Feb-2017/build/.`, and `slides/dist/.` into per-deck subdirectories), then `configure-pages` v6 + `upload-pages-artifact` v5 — both **guarded by `if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'`** |
| `Test` | Unchanged — 2017 deck only, `yarn test` |
| `Deploy` | **New.** `needs: [build, test]`, same main-only `if:`, job-scoped `permissions: {contents: read, pages: write, id-token: write}`, `environment: github-pages` with `url: ${{ steps.deployment.outputs.page_url }}`, single `actions/deploy-pages` v5 step |

Three things worth naming:

1. **Deploy model migrated, and the old one is now dead weight.** The 2017 deck's `package.json` still carries `gh-pages 6.3.0` plus `predeploy`/`deploy` scripts that push `build/` to a `gh-pages` branch. Nothing invokes them any more — CI publishes via the Pages artifact API. `gh-pages` is *also* on Renovate's abandoned-dependencies list (below). Two independent signals that it should be deleted.
2. **The elevated permissions are correctly scoped.** `pages: write` + `id-token: write` live only on the `Deploy` job; `Build` and `Test` keep the workflow-level `contents: read`. This is the shape the fleet's CI least-privilege issues ([[marcusrbrown--mrbro-dev]] #287) keep converging on, arrived at here on the first try.
3. **PR builds exercise the assembly but never publish.** The `mkdir`/`cp` assembly step is unguarded, so a PR that breaks the `_site` layout fails in CI rather than at deploy time. Deliberate and correct — the guarded steps are exactly the three that touch Pages.

> **Carried footgun (still present, now doubled):** `NODE_VERSION` is declared under each `setup-node` step's `env:` block and consumed by `with.node-version: ${{ env.NODE_VERSION }}` on the same step. It resolves — the `env` context is available to `steps.*.with` — but it reads backwards and the pattern is now duplicated across the `Build` and `Test` jobs, so a refactor has two places to get wrong. Hoist it to workflow-level `env:` and the `renovate:` annotation still works.

#### 2026-09-17: the publishing half of the pipeline has no gate and one monitor

`ci.yaml` is structurally unchanged (3102 → 3106 bytes, the `actions/deploy-pages` v5 → v5.0.1 bump). Two properties of the job graph are worth naming now that the deploy path has run for six weeks:

1. **`Deploy` cannot be a required status check, by construction.** Branch protection requires `['Build', 'Test', 'Renovate / Renovate']`. `Deploy` is guarded `if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'`, so on every pull request it reports `skipped` — confirmed on `#54`'s head SHA. A job that is always skipped on PRs can never satisfy a required context, so putting the publish step in the same workflow as the gate steps permanently excludes it from branch protection. That is the correct trade here (you do not want to gate merges on a production deploy), but it should be a deliberate one: the consequence is that **a broken deploy blocks nothing**.
2. **The README badge is the only deploy monitor in the repo.** `README.md` is a title plus a single shield pointed at `actions/workflow/status/.../ci.yaml?branch=main`, which reflects the whole run conclusion on `main` — including `Deploy`. There is no deployment-failure notification, no separate deploy workflow with its own badge, and no required check covering it. The archive's publishing health is observable in exactly one place, and that place is an image in a file nobody opens. Recorded in [[github-pages]].

> **New footgun: `Node.js v24` is a parked dashboard checkbox.** `NODE_VERSION: 20.20.2` is two majors behind the fleet baseline (24.19/24.20). The bump exists as an unchecked *Pending Approval* item on the dependency dashboard, not a PR — the same "major updates land as boxes nobody clicks" failure mode recorded for `tempio` at [[bfra-me--ha-addon-repository]] and ESPHome at [[marcusrbrown--esphome-life]]. Here it is comparatively harmless (CRA 5 on Node 24 is the real question), but the mechanism is identical.

### renovate.yaml / update-repo-settings.yaml

Both delegate to `bfra-me/.github` reusable workflows, authenticated via `APPLICATION_ID` / `APPLICATION_PRIVATE_KEY` GitHub App secrets — the same hybrid-trigger Renovate model documented on [[marcusrbrown--github]] and across [[github-actions-ci]]. `update-repo-settings.yaml` runs on push-to-main, a daily `19 14 * * *` cron, and dispatch.

- **2026-08-05:** both pinned at SHA `dd02bc5f` (v4.16.44)
- **2026-09-17:** both pinned at SHA `5486c68e` (**v4.30.0**) — seven more minor boundaries in 16 days (v4.24.0 → v4.25.0 → v4.25.1 → v4.26.0 → v4.27.0 → v4.28.0 → v4.29.0 → v4.30.0, PRs `#80`–`#90`). The two refs **diverged for 3 m 56 s** on 2026-09-04 — the only time in the series they have not moved together — because the human fix targeted `renovate.yaml` alone. One of these bumps, **v4.25.0**, is the poisoned tag; see the incident section above.
- **2026-09-01:** both pinned at SHA `eb1772eb` (**v4.23.0**) — seven minor boundaries in 22 days (v4.16.45 → v4.16.47 → v4.17.0 → v4.17.1 → v4.18.0 → v4.19.0 → v4.20.0 → v4.21.0 → v4.22.0 → v4.23.0, PRs #64–#77), every one a same-day `mrbro-bot[bot]` automerge. Matches the identical churn burst seen at [[marcusrbrown--esphome-life]] over the same window.

#### Control case: this repo's settings sync points at the right workflow

`update-repo-settings.yaml` here calls `bfra-me/.github/.github/workflows/update-repo-settings.yaml@…`. [[marcusrbrown--esphome-life]]'s file of the same name calls `…/workflows/renovate.yaml` — a mis-pathed `uses:` that has been groomed by Renovate for 13+ months without ever applying a setting.

Presentations is the **control** that proves that defect is a miswiring rather than a missing upstream capability: same org, same reusable-workflow family, same two-secret signature, same daily cron shape — correct target here, wrong target there. Actions history confirms `Update Repo Settings` concluding `success` on its `19 14` cron on 2026-08-28, 08-29, 08-30, and 08-31. Recorded in [[probot-settings]].

#### Renovate as a required check comes from the `push` trigger, not `pull_request`

`renovate.yaml` triggers on `issues.edited`, `pull_request.edited`, `push` to any branch except `main`, `workflow_dispatch`, and `workflow_run` on CI completion — while `settings.yml` now requires the **`Renovate / Renovate`** context on `main` (added in `#62`). The context therefore reaches a PR head SHA via the *branch push*, not via a `pull_request` event.

That works for every PR this repo actually receives (all branches are pushed to the repo itself by `mrbro-bot[bot]`). It would not work for a fork PR: no push to this repo means no `Renovate` check run means a permanently unsatisfiable required context. Low practical risk on a 0-fork personal archive; worth flagging because the failure is silent and only manifests on the first outside contribution. The `issues.edited` runs are visibly `skipped` in the run history (the `!contains(github.actor, '[bot]')` guard firing against Renovate's own dashboard rewrites) — the same boot-a-runner-to-skip cost pattern catalogued at [[bfra-me--ha-addon-repository]], at far lower volume here.

## Probot Settings (.github/settings.yml)

Extends `.github:common-settings.yaml` (resolves to [[marcusrbrown--github]]'s personal template, not the org template). Repo-specific overrides:

- **Description / homepage / topics** set to match the archive
- **Branch protection on `main`:** required status checks `Build` + `Test` (non-strict), `enforce_admins: true`, `required_linear_history: true`, no required PR reviews
- **`archived: true`** — declared in settings

2026-09-01 deltas to `settings.yml` (668 → 733 bytes, via `chore: update repo settings (#62)`):

- `homepage` → `https://mrbro.dev/Presentations/`
- `topics` list extended with `opencode`, `cheap-llms`, `slides`, `slidev`
- Required status checks **`['Build', 'Test', 'Renovate / Renovate']`** — Renovate promoted to a merge gate
- `archived: true` **still present**

### Contradiction: archive intent vs. live state

The settings file declares `archived: true`, and there is a commit `chore: archive repository (#48)`. **But the live GitHub API reports `archived: false`** at survey time (2026-08-05), and the repo has active commits *after* #48 (#49 added a new deck, #50–#56 followed). Two readings:

1. The archive flag was set in `settings.yml` but the Probot settings sync has not (or cannot) flip a repo to archived, so the declared state and the live state have diverged.
2. Archiving was reverted in practice — the Aug-2026 talk arrived and the repo went active again — but the `archived: true` line in `settings.yml` was never removed.

Either way, `settings.yml` and reality disagree. If the intent is "keep it live for new talks," drop the `archived: true` line so the settings sync stops asserting a state nobody wants. If the intent is "archive after this talk," expect the next successful settings-sync run to freeze the repo. Recorded here per the additive/contradiction rule; not resolved by this survey.

#### 2026-09-01: resolved in favour of reading 1 — `archived` is declared but never applied

Reading 2 predicted "the next successful settings-sync run will freeze the repo." That prediction is now falsified with evidence, and the mechanism is the more interesting finding.

Four facts, all from this survey:

1. `settings.yml` still declares `archived: true` — **and a human edited that exact file on 2026-08-05** (`#62`, which rewrote `homepage`, `topics`, and the required-check list) and left the line in place. This is no longer plausibly an oversight nobody looked at.
2. `update-repo-settings.yaml` points at the **correct** upstream reusable workflow (unlike [[marcusrbrown--esphome-life]]), so the sync path is real.
3. The Actions history shows `Update Repo Settings` concluding **`success`** on its daily `19 14` cron on 2026-08-28, 08-29, 08-30 and 08-31, plus on the 08-31 push to `main`. The sync ran and passed, repeatedly.
4. The live API still reports **`archived: false`**, and the repo merged 21 PRs and shipped a whole new deploy pipeline in the interim.

A correctly-wired sync succeeding daily for ~6 months against a file that says `archived: true`, on a repo that is not archived, admits one conclusion: **the Probot Settings app does not apply `repository.archived`** — it silently ignores the key rather than failing on it. Generalized into [[probot-settings]].

Two consequences worth carrying:

- **`archived: true` here is inert, not a time bomb.** The earlier "expect the next sync to freeze the repo" warning is withdrawn. The line should still be deleted — declarative config that the reconciler quietly drops is worse than no config, because it reads as an enforced state to every future reader (including this wiki's own first survey, which flagged it as a live risk).
- **A green settings-sync run proves the workflow ran, not that the file was applied.** Same shape as the [[marcusrbrown--esphome-life]] finding from a different direction: there, the workflow succeeded while syncing the wrong thing; here, the workflow succeeds while dropping part of the right thing. In neither case does the check tell you the declared state is the live state. Only a read-back diff does.

#### 2026-09-17: third confirmation, and one more green run inside the incident

`settings.yml` is **byte-identical at 733 bytes** — `archived: true` still declared, required contexts still `['Build', 'Test', 'Renovate / Renovate']`, `enforce_admins: true`, `required_pull_request_reviews: null`. Since the last survey `Update Repo Settings` has concluded `success` **19 more times** (12 scheduled `19 14` passes + 7 push passes) while the live API continues to report `archived: false`. Roughly six months and ~100 green runs now stand behind the conclusion that Probot Settings silently ignores `repository.archived`.

One incident-adjacent detail worth keeping: `Update Repo Settings` ran on the **poisoned** v4.25.0 pin at 16:28:02 on 2026-09-04 and concluded `success` in 18 seconds. The `tar` defect lived in `bfra-me/renovate-action`, which that reusable workflow does not invoke — so this caller's poisoned reference was genuinely inert. A green settings-sync run says nothing about the file *and* nothing about the tag it is pinned to.

Cosmetic note: the folded `topics:` block scalar ends with a trailing comma (`slidev,`). The live topic list is 10 entries, so the empty trailing element is being dropped somewhere in the parse chain rather than creating a phantom topic. Harmless, but it is one more thing in this file whose behavior is established by observation rather than by the document.

## Renovate

`.github/renovate.json5` extends `github>marcusrbrown/renovate-config#5.2.10` — on the current v5 line of [[marcusrbrown--renovate-config]] (unlike [[marcusrbrown--github]] itself, which is still a v4.x holdout). One custom rule: **`spectacle` major updates auto-approve** in the dependency dashboard (`dependencyDashboardApproval: false` for major bumps of `spectacle`) — a pragmatic exception since Spectacle only lives in the frozen 2017 deck and a major bump there is low-stakes. Recent history is `mrbro-bot[bot]`-authored dependency maintenance (`fix(deps): update all non-major dependencies (#53)`, lockfile maintenance) plus the Aug-2026 content additions.

**2026-09-01:** preset pin advanced `#5.2.10` → **`#5.2.12`** (`#63`); the `spectacle` rule is byte-identical. The file is otherwise unchanged at 276 bytes.

### Dependency Dashboard (#41) — 2026-09-01

Every one of the 21 commits since the last survey's HEAD is Renovate maintenance except the six human commits `#57`–`#60`, `#62`. The dashboard, however, shows the queue is not as clean as the merge cadence suggests.

**Abandoned Dependencies (3)** — Renovate's `abandonmentThreshold` detection:

| Datasource | Package | Last release |
| --- | --- | --- |
| npm | `react-scripts` | 2025-02-14 |
| npm | `gh-pages` | 2025-01-02 |
| bun | `@slidev/theme-seriph` | **2024-02-02** |

This is the survey's sharpest observation. `react-scripts` is Create React App, which upstream has formally stopped recommending — it is the *entire* build toolchain of Deck 1. `gh-pages` is the deploy path `#60` just orphaned. And `@slidev/theme-seriph` — the theme of the **brand-new 2026 deck**, chosen three weeks ago — has had no release since February 2024, making it *older* in maintenance terms than most of the 2017 deck's stack.

The two decks are nine years apart and both rest on abandoned foundations. The archive's stated premise is "each talk frozen in the stack of its era"; the corollary nobody plans for is that a *newly chosen* dependency can already be frozen at selection time. Abandonment is a property of the upstream, not of your commit date.

**Pending Approval (4 majors, all unchecked boxes, no PRs):**

- `actions/checkout` v4.4.0 → **v7.0.1** (three majors behind)
- `actions/setup-node` v4.4.0 → **v7.0.0**
- Node.js → **v24** (pinned 20.20.2)
- react monorepo → **v19** (`react`, `react-dom` at 18.3.1)

**Open PRs (2), both stalled ~28 days** — `#54` (pin `@slidev/cli` to 52.19.1) and `#55` (pin `@slidev/theme-seriph` to 0.25.0), opened 2026-08-03. Every *version-bump* PR in this repo automerges same-day; these two are `rangeStrategy: pin` proposals (converting `^52.1.0` → an exact pin), and they alone have not merged. The parsimonious read is that pin-type PRs fall outside the preset's automerge rules and nothing routes them to a human — but the preset's automerge matrix was not read this survey, so treat that as inference, not fact. Note `#55` is semantically a no-op: `^0.25.0` already resolves to `0.25.0` (the only release since 2024).

**Vulnerabilities:** none reported on osv.dev.

**Detected dependencies:** 8 github-actions entries in `ci.yaml` (all SHA-pinned *with* version comments, so all tracked — no `setup-yq`-class blind spot as at [[bfra-me--ha-addon-repository]]), 1 each in `renovate.yaml`/`update-repo-settings.yaml`, 2 bun deps, 6 npm deps.

## Fro Bot Integration

**No Fro Bot agent workflow detected.** There is no `fro-bot.yaml`; automation is limited to Renovate + Probot settings sync, and every merge is authored by `mrbro-bot[bot]` — Fro Bot is not in the loop. This matches the gap on sibling low-activity personal repos ([[marcusrbrown--github]], [[marcusrbrown--esphome-life]], [[marcusrbrown--ha-config]]).

**Recommendation (2026-08-05, open):** if this repo is meant to stay live for future talks, a follow-up draft PR could add the single-file three-mode Fro Bot workflow (the canonical shape from [[marcusrbrown--marcusrbrown-github-io]] / [[marcusrbrown--renovate-config]]). But weigh it against the pending archive decision above — wiring an autonomous agent into a repo that may be archived is wasted chrome. Resolve the archive contradiction first; then decide.

**2026-09-01 — still no `fro-bot.yaml` (second consecutive survey), and the blocker is gone.** The prior recommendation was conditioned on resolving the archive question first. That condition is now met: `archived: true` is inert (above), the repo has merged 21 PRs and shipped a deploy pipeline in 27 days, and it publishes a live public site. This is an active repo, not an archive.

The case is stronger than "hygiene," because this survey produced four concrete items a resident autoheal daemon would plausibly have raised:

1. `run-preset.test.sh` exists and CI never runs it.
2. `gh-pages` + the `predeploy`/`deploy` scripts are dead code after `#60`, and flagged abandoned upstream.
3. `@slidev/theme-seriph` was adopted three weeks ago and is already abandoned (2024-02-02) — worth a deliberate decision, not a silent inheritance.
4. `archived: true` is misleading dead config that should be deleted.

The counter-argument is real and should be weighed: this is a 1-star personal archive with 0 forks, ~2 human commits per year outside talk season, and Renovate already drains its queue same-day. Adding a daily agent buys four low-severity findings against a standing runner cost and a new PR backlog surface — and the fleet evidence ([[marcusrbrown--sparkle]] at 15 unmerged autoheal PRs, [[bfra-me--works]] at 12) says agents on low-attention repos accumulate proposals nobody merges. A follow-up draft PR should be proposed separately; if it lands, prefer the **converged-autoheal null-verdict** shape from [[marcusrbrown--dev-like]] (report to one rolling issue, PR only when a fix is unambiguous) over the propose-everything shape.

**2026-09-17 — still no `fro-bot.yaml` (third consecutive survey), and the interval supplied the strongest evidence either way.**

For: every one of the four findings listed above survived a full 16-day interval untouched. `gh-pages` and its `predeploy`/`deploy` scripts are still in `Blockchain-Meetup-Feb-2017/package.json`, dead since `#60` and flagged abandoned upstream. `run-preset.test.sh` is still not invoked by `ci.yaml`. `archived: true` is still declared. `@slidev/theme-seriph` did get a version pin, but by routine `rangeStrategy: pin` maintenance rather than by any decision about its abandonment. Nothing in the repo notices any of this, because nothing in the repo is looking.

Against, and it is now quantified: the repo's real risk in this interval was a **6 h 30 m Renovate deadlock**, and a resident daily autoheal agent would not have caught it. The agent's own scheduled trigger would have been the only thing still running, and its finding — "the tree is unchanged and CI is green" — would have been true and useless. What was needed is an out-of-band *delivery* monitor (PRs opened per window, or the dashboard issue's `updated_at`), which is a fleet-level instrument, not a per-repo agent. See [[github-actions-ci]].

The balanced read after three surveys: a resident agent here would produce a short, slowly-repeating list of hygiene findings and would not have improved the one incident that actually mattered. Recommendation stands but stays low priority, and the **delivery monitor is the higher-value build**.

### 2026-09-17 sidebar: the 2017 deck's README is the stock CRA scaffold

Not previously recorded, and it is the largest text blob in the repository. `Blockchain-Meetup-Feb-2017/README.md` is **73,486 bytes** — nearly 15× the deck's entire `src/` tree — and it is the verbatim, unmodified Create React App template README, still linking `facebookincubator/create-react-app` (the org name from before the rename) and still documenting `npm run eject`. It says nothing about the presentation.

It composes with the abandoned-`react-scripts` thread rather than standing alone: the deck's build tool is unmaintained upstream, and its documentation is a nine-year-old scaffold artifact for that tool, pointing at an organization that no longer exists. Related and equally stale: the deck's `package.json` still sets `"homepage": "https://marcusrbrown.github.io/Presentations/Blockchain-Meetup-Feb-2017/"` while the repo homepage moved to `mrbro.dev/Presentations/`. That one is harmless in practice — CRA uses `homepage` only to compute the asset base path, and the path component is identical between the two hostnames — but it is now the non-canonical URL, and a future reader will reasonably believe otherwise.

## Notable Patterns

- **One directory = one frozen talk:** decks are not migrated to a shared toolchain; each keeps the stack it shipped with (Spectacle/CRA 2017, Slidev/Bun 2026). The archive is a stratigraphic record of Marcus's tooling over nine years.
- **CI covers only the buildable deck** *(2026-08-05; superseded 2026-09-01)*: `ci.yaml` hard-codes the 2017 subtree; the Markdown-based Slidev deck needs no build gate to be presentable, so it gets none. **As of `#60` both decks build in CI** — but the coverage inversion persists in a new form: CI runs the 2017 deck's 375-byte stock smoke test and skips the 17 KB Bash assertion suite.
- **Governance without an agent:** shared `.github/` (Renovate + settings sync + branch protection) provides hygiene; there is no PR-review automation because the repo takes almost no external PRs.
- **Declared-vs-live drift:** the `archived: true` / live-`false` split is a clean example of Probot settings declaring an intent the platform state doesn't reflect. **2026-09-01:** root-caused — the reconciler drops the key silently, so this is a *reconciler coverage gap*, not a sync failure.
- **A frozen archive is not a frozen repo** *(new 2026-09-01)*: the premise "each talk keeps the stack of its era" governs the *decks*, not the infrastructure around them. In 27 days the shared layer gained a Pages deploy pipeline, a Bun toolchain in CI, a hand-written landing page, and 33 KB of tested Bash — while both deck subtrees stayed semantically still. Surveys that sample only the content directories would report no change.
- **Newly chosen ≠ maintained** *(new 2026-09-01)*: `@slidev/theme-seriph`, selected in August 2026, had its last release in February 2024. Recency of *adoption* says nothing about liveness of the *upstream*; Renovate's abandonment detection is the only thing that surfaced it, and only because `bun.lock` was checked in (`#56`) to make the deck visible to the scanner at all.
- **Design standards travel further than the gates that enforce them** *(new 2026-09-01)*: the root `index.html` is OKLCH-first with inline WCAG-AA contrast justification, focus-visible rings, and a `65ch` measure — the full `.impeccable` vocabulary from [[marcusrbrown--mrbro-dev]] / [[fro-bot--dashboard]] — in a file with no build step, no linter, and no design gate to check it.
- **An inert tree is not an inert repo** *(new 2026-09-17; sharpens the 2026-09-01 entry below)*: the 2026-09-01 survey observed that the infrastructure moved while the decks stood still. This interval went one step further — **nothing at all moved except pins**, and it still contained the most consequential event in the repo's recorded history (a 6.5-hour updater deadlock). A survey that diffs the tree reports "no change" and misses the whole interval; a survey that reads the run history and the merge timeline finds the incident. Sample the automation, not the artifact.
- **A self-chained updater removes its own recovery path** *(new 2026-09-17)*: `renovate.yaml` has no `schedule:`; its next run is triggered by the CI run of the merge it just produced. When it stopped producing merges it stopped scheduling itself, and the outage became a deadlock rather than a delay. Liveness that is conditional on your own output is not liveness.
- **The pin landed on the frozen dependency and stalled on the moving one** *(new 2026-09-17)*: `@slidev/theme-seriph` (one release since February 2024) got exact-pinned; `@slidev/cli` (ships continuously) stayed a floating caret with a 45-day-old pin PR and a v53 major queued behind it. Automerge matrices produce pin outcomes that are uncorrelated with pin *value*.
- **Destructive helpers should prove identity before acting** *(new 2026-09-01)*: `reset-demo.sh` validates worktree-ness, root-ness, both remote URLs, baseline commit existence, and branch existence before `git reset --hard`, then re-checks `--porcelain` afterward and fails if anything survived. A reusable template for any "reset to known state" script.

## Survey History

| Date | SHA | Changes |
| --- | --- | --- |
| 2026-09-17 | `e510e237` | **Third survey — content tree frozen, automation is the story.** 14 commits, **13 `mrbro-bot[bot]` / 1 `marcusrbrown`**; tree unchanged at 53 entries / **42 blobs** with zero files added or removed (prior page's "33 blobs" corrected). **(1) Third inside view of the 2026-09-04 `tar` incident**: `#81` installed the poisoned `bfra-me/.github` v4.25.0 at **16:27:58** (earliest of the three known repos); Renovate's last pass concluded `success` in 49 s with zero PRs at 16:30:30, then **6 h 27 m of total silence** because `renovate.yaml` has **no `schedule:`** and its only live trigger is `workflow_run` on a CI run of a merge it can no longer produce — a **deadlock, not a delay**, and the complement of [[marcusrbrown--github]]'s false-green cron. Human `#82` at **22:58:51** (`renovate.yaml` only, `+1/-1`, commit body states the loop verbatim); repaired Renovate re-opened the queue at 23:01 and self-healed the sibling file via `#83` at **23:02:47** (+3 m 56 s). **Inert window 6 h 30 m 53 s.** Fleet sweep now three-pointed: poisoned across the fleet in **~8 min**, repaired by hand at **~2.5 min/repo** 6.5 hours later. **Corrects the "incident amplifier" scope** — this repo has the same two-caller structure as [[marcusrbrown--esphome-life]] but correct wiring, so the un-fixed second reference was **inert** (18 s green settings sync on the poisoned tag) and close-out was ~9× faster; amplification is a property of the mis-pathed `uses:`, not of the second reference. **(2) `#54` clean/green/unmerged 45 days** — `mergeable_state: clean`, all 3 required contexts green, `auto_merge: null`, `required_pull_request_reviews: null`; rebased onto every `main` commit (title drifted 52.19.1 → 52.20.1), so it burns a CI cycle per commit and **can never trip a staleness, conflict, or failure detector**. Prior "pin PRs aren't automerged" inference **falsified**: sibling `#55` automerged 09-05 after 33 days. **(3) Pin risk inverted** — abandoned `@slidev/theme-seriph` exact-pinned `0.25.0` (semantic no-op), churning `@slidev/cli` still `^52.1.0` with v53 parked in *Pending Status Checks*. **(4) `archived: true` third confirmation** — `settings.yml` byte-identical at 733 B, 19 more green `Update Repo Settings` runs, live `archived: false`. **(5) Zero failures in 100 runs / 12 days**; 23 % are `Renovate`/`issues`/`skipped` at 0 s, and the job guard's observed behavior **cannot be derived from its text** (contradiction recorded, unresolved). **(6) `Deploy` can never be a required context** (always `skipped` on PRs); the README badge is the repo's only deploy monitor. **(7) 2017 deck README is the verbatim 73,486-byte CRA scaffold**, still linking `facebookincubator/create-react-app`; `gh-pages` dead code and all three abandoned deps untouched for a third survey. Deps: `bfra-me/.github` v4.23.0 → **v4.30.0** (`#80`–`#90`), preset `#5.2.12` → `#5.2.13`, `actions/deploy-pages` → v5.0.1. Open issues 3 → 2. **Still no Fro Bot workflow.** |
| 2026-09-01 | `4613f997` | **Second survey — structural change.** Tree 42 → 53 entries; all growth in `Cheap-LLMs-Meetup-Aug-2026/` + new root `index.html`. **(1) `ci.yaml` became the Pages deploy pipeline** (`#60`, 1398 → 3102 B): `Build` now also builds the Slidev deck via `oven-sh/setup-bun` v2.2.0, assembles `_site/`, and uploads a Pages artifact; new main-only `Deploy` job with job-scoped `pages: write` + `id-token: write` and a `github-pages` environment. `gh-pages` deploy scripts in Deck 1 are now dead code. **(2) `demo/` rehearsal harness** (`#57`): ~33 KB of `set -euo pipefail` Bash — `run-preset.sh` (trap-based reset-on-exit, temporary OpenCode config dir), `reset-demo.sh` (six-way identity check before `git reset --hard`), and `run-preset.test.sh` (17 KB assertion suite **that CI never runs**); demo target is [[marcusrbrown--mothership]] at a pinned baseline. Flipped repo `language` JS → **Shell**. **(3) Root `index.html`** — zero-dependency OKLCH/WCAG-AA landing page, `.impeccable` design vocabulary with no gate enforcing it. **(4) Archive contradiction resolved:** correctly-wired settings sync succeeded daily (08-28…08-31) for ~6 months against `archived: true` on a repo that is not archived ⇒ Probot Settings silently ignores `repository.archived`; the "next sync will freeze the repo" warning is withdrawn. **(5) `OUTLINE.md` re-added** (15788 B), superseding the "deliberately removed" note; `GLOSSARY.md` + `demo/NOTES.md` new. **(6) Dashboard:** 3 abandoned deps (`react-scripts` 2025-02-14, `gh-pages` 2025-01-02, `@slidev/theme-seriph` **2024-02-02** — adopted three weeks ago), 4 unchecked pending majors (checkout v7, setup-node v7, Node v24, react v19), 2 pin PRs (#54/#55) stalled ~28 days while every version bump automerges same-day. Deps: `bfra-me/.github` v4.16.44 → **v4.23.0** (10 minor boundaries, #64–#77), preset `#5.2.10` → `#5.2.12`. `settings.yml` gained `Renovate / Renovate` as a required check, `homepage` → `mrbro.dev/Presentations/`, +4 topics. Root `.gitignore` now OpenCode-aware. Still no Fro Bot workflow (2nd survey). 1 star, 3 open issues. |
| 2026-08-05 | `34321a4` | Initial ingest. Two decks: `Blockchain-Meetup-Feb-2017` (React 18 / Spectacle 10 / CRA, Yarn) and `Cheap-LLMs-Meetup-Aug-2026` (Slidev 52 / Bun, added #49 on 2026-08-04). `.github/`: `ci.yaml` (builds+tests 2017 deck only, Node 20.20.2), `renovate.yaml` + `update-repo-settings.yaml` (reusable `bfra-me/.github` v4.16.44), `settings.yml` (extends `.github:common-settings.yaml`), `renovate.json5` (extends `marcusrbrown/renovate-config#5.2.10`, spectacle-major auto-approve). **Contradiction flagged:** `settings.yml` `archived: true` + `chore: archive repository (#48)` vs. live API `archived: false` and post-#48 activity. No Fro Bot workflow; `mrbro-bot[bot]` authors merges. 1 star, 3 open issues. |
