---
type: repo
title: marcusrbrown/.dotfiles
created: 2026-04-18
updated: 2026-09-10
node_id: MDEwOlJlcG9zaXRvcnkxODY5MTU0
sources:
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 2f2d1e6ac04999c5e61ee054fc585d9542cd3a74
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: dbab7ad7d666f96e4fd0f1b2dd20937f39281a92
    accessed: 2026-04-21
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: ae026c179cd91cb637443fe7d92bed75df3d6dba
    accessed: 2026-04-22
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 0bb24f05e29fbd4c70eb9dca9611055e7bef7c5f
    accessed: 2026-05-24
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 70c211bc269b4bb8c476a3929fd976bc51153b1c
    accessed: 2026-06-06
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 4df0c2d66dfa697c4de345afcd4075dd8f8109ac
    accessed: 2026-06-16
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: debcb8e26da6977fb80d6f531bb9e956e129e0ee
    accessed: 2026-06-27
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: e8ebc5cc3736d0c6f9d21a574687457dfd4edbb6
    accessed: 2026-07-10
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: cd03ad8b96fd6118bb782844ce27e6c703740857
    accessed: 2026-07-27
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 347958930a27f22f630996c1d0d65e02416218f0
    accessed: 2026-08-26
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: fe0144c0e9fc0168fc4ed9aa9fa0492df4846599
    accessed: 2026-09-10
tags:
  - dotfiles
  - configuration
  - zsh
  - bash
  - mise
  - sheldon
  - starship
  - devcontainer
  - bare-git-repo
  - opencode
  - magic-context
  - copilot-cli
  - systematic
  - gitleaks
  - kimi-k2
  - harness
  - opencode-doctor
  - sqlite-maintenance
  - deepseek
  - ollama-distill
  - oh-my-opencode-slim
  - openai-auth
  - bun-test
  - ci-matrix
  - dormant-config
  - git-dir-leak
  - excludes-file
  - prompt-cache
  - delivery-path
  - curl-pipe-sh
  - cache-budget
  - pi-harness
  - gpt-6
aliases:
  - dotfiles
related:
  - marcusrbrown--ha-config
  - marcusrbrown--systematic
  - marcusrbrown--opencode-copilot-delegate
  - pi-coding-agent
---

# marcusrbrown/.dotfiles

Marcus R. Brown's [[dotfiles]] repository. Uses a **bare git repository** pattern (`GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=$HOME`) to track shell and development environment configuration directly in `$HOME` without symlinks.

## 2026-09-10 Survey — the interval the repo audited itself

HEAD `fe0144c` (2026-09-10T07:11Z), 115 commits since `3479589`, 57 files touched, authorship `mrbro-bot[bot]` 75 / **`marcusrbrown` 40**. Four new `docs/solutions/` entries landed in eight days (8 total), and every one of them is a *false-signal* postmortem: an artifact that looked correct on inspection and was not. This is the first survey where the durable content is failures found, not versions bumped — though the versions moved too (four mise majors).

**1. A shell subsystem documented as live had not run since 2024 — 967 days.** `.config/bash/` held 28 tracked files; **two** were live (`exports`, `aliases`). The other 26 — `main`, `functions`, 19 `init.d/*.bash`, two `completion.d/*.bash`, `os_darwin`, `os_mingw`, `local.d/.gitkeep` — had **no referrer at all**, while `AGENTS.md` and both READMEs documented them as the live Bash chain (`.bashrc → main → functions → aliases → init.d/* → local.d/*`). Commit `b1b887f` (2024-01-10, "overhaul shells") moved the subsystem under `.config/bash/` and replaced a `.bashrc` that sourced `~/.bash_profile`/`~/.shrc` with a sheldon-only one; the subsystem's internal wiring survived the move unchanged, still pointing at pre-move `~/.bash/` paths (`functions:89` → `~/.bash/main`, `main:150` → `~/.bash/functions`), so its only remaining references were **to each other**, through a directory that no longer existed. It could not have been restored as written.

What accumulated in those 967 days is the point: `DOTNET_CLI_TELEMETRY_OPTOUT` lived in `init.d/dotnet.bash` and therefore **never applied** — a live privacy gap in a repo whose stated posture is privacy-first; `EDITOR`/`VISUAL`/`PAGER` were unset for the same reason; both READMEs instructed readers to write credentials to `.config/bash/local.d/` (`echo 'export MY_SECRET_TOKEN="..."' > ~/.config/bash/local.d/secrets`) into a void; `DISCORD_TOKEN` was empty in every shell while `local.d/discord.bash` sat there correct and readable; and **the Fro Bot maintenance prompt carried `init.d/` numbering and `local.d/` overrides as live conventions**, so the agent kept recommending a mechanism that could not work. Resolution was salvage-then-delete in separate commits — #2504 moved the four environment values into `exports` and gave bash a real init path, #2506 deleted the 26 files and corrected the docs. Generalized in [[dotfiles]]; the entry-point discipline generalizes past shells.

**2. `core.excludesFile` named `.gitignore` inside the git dir is read twice** (#2434 → #2435). With the git dir at `$HOME/.dotfiles` — *inside* the work tree — a file at `.dotfiles/.gitignore` is read both as `core.excludesFile` **and** as an ordinary per-directory ignore file, where the leading `/*` re-anchors to `.dotfiles/` and every `!/…` negation resolves to a path that never exists. Symptom: new `docs/` files needed an explicit `git add` despite matching allowlist entries. Fix is a rename to `.dotfiles/ignore` plus a comment in `.dotfiles/.gitconfig` recording *why the name matters*, so restoring the old name cannot look like tidying.

**3. `remoteEnv` exporting `GIT_DIR`/`GIT_WORK_TREE` broke `Devcontainer CI` for 8 consecutive runs** (2026-09-01 → 09-03) on a **required, `enforce_admins: true`** check, blocking every open PR — with **no repository change**. mise 2026.9.0, released 2026-09-01, began resolving Python's version list by cloning pyenv and shelling out to `git`; the process-wide `GIT_DIR` redirected those internal calls at the dotfiles bare repo, the pyenv tree never landed, and mise executed a `python-build` that did not exist. Latency to onset was one release: last pass 12:35, first failure 12:37. The devcontainer installed mise unpinned (`curl https://mise.run | sh`), so it adopted the new behavior the day it shipped with **no commit to correlate against** — and the `MISE_VERSION` pin in `main.yaml` covered only the separate `jdx/mise-action` job, which is why that job stayed green while the container died. Eight plausible hypotheses were tested and disproven against the published image before a single-variable flip (`env -u GIT_DIR` vs exported) settled it. Fixed by dropping both vars from `remoteEnv` (#2488) and pinning `MISE_VERSION` **forward** to the release that exposed the bug, not backward — pinning backward would mask the cause behind a stale toolchain.

**4. A pinned `curl | sh` installer needs `pipefail`, not just `set -e`.** #2497 pinned three installers (`MISE_VERSION 2026.9.4`, `UV_VERSION 0.12.10` via a versioned URL because uv bakes its version in, `STARSHIP_VERSION v1.26.0` via `-v`) and moved both feature scripts to `set -eo pipefail`, with the reason inline: *a versioned URL that 404s pipes an empty script into `sh`, which exits 0 and would hide a bad pin*. Pinning without `pipefail` converts a loud 404 into a silent no-op install.

**5. The CI cache defeated the verification it wrapped, and starved the cache budget doing it** (#2503). The `Install mise` job exists to prove every tool in `.config/mise/config.toml` installs cleanly; **a cache hit skips the install being verified**. Keyed on mise version × config hash × ref, it accumulated **nine ~993 MB entries — 8.9 GB of the repo's 10 GB budget** — and LRU-evicted every other cache, including the **~40 KB agent session caches that carry continuity between runs**. Now `cache: false` with the rationale committed above the step. Cataloged in [[github-actions-ci]].

**6. The maintenance prompt forbade its own fix path** — and the agent misdiagnosed it as a harness bug. For **five consecutive runs** Fro Bot detected the same 3-line `AGENTS.md` drift, applied it, and reported it fixed; report #2474 escalated it as "a caller-workflow bug, not a content problem." It was neither. Category 3 said *"If drift is found, open a PR with corrections"*, then *"Report findings but put actual fixes into category 4"* — and category 4 is report-only. Cross-category routing moved the work but not the permissions, leaving only an edit to the ephemeral Actions checkout. The repaired prompt does three separable things: names the delivery mechanism as steps (*create a branch, commit it, push, and open a PR*) rather than the outcome "open a PR"; keeps the exception **in place** instead of routing it; and **states the failure mode in the prompt** (*"Editing the working tree without opening a PR does not persist and will silently recur every run"*) so the agent can recognize the trap. It also now instructs the agent to verify shell load order **against a live shell** before documenting it. Fleet significance: this is the **prompt-layer** sibling of the workflow-layer delivery break in [[fro-bot--dashboard]] and [[marcusrbrown--tokentoilet]] — identical symptom (a green daemon that writes nothing), a third distinct root-cause layer after permissions and output-mode wiring.

**7. Explicit prompt-cache anchoring reaches only Anthropic-family models** (2026-09-10, upstream `anomalyco/opencode#48246`). OpenCode's `applyCaching()` places breakpoints on the first two system messages and the last two non-system messages — an anchor that advances every turn — but its call site gates on model family, so a model on `@ai-sdk/openai` never runs it and falls back to OpenAI's implicit prefix cache, which truncates at the first differing byte with nothing to re-anchor. Measured over 10 days: `claude-sonnet-5` 100.0% reuse (17,615 turns), `claude-opus-5` 100.0%, vs `gpt-6-astra` 92.1%, `gpt-5.6-sol` 64.9%, `github-copilot/gpt-5.4-mini` 80.1%, `github-copilot/gemini-3.5-flash` 91.3%. **`github-copilot` serves Claude at 100% and its own GPT/Gemini at 80/91% — same provider, opposite behavior**, which is what makes the split a *family* fact and not a provider fact. Three method rules fell out: normalize as `cached/(input+cached)` because Anthropic reports input exclusive of cache reads and OpenAI inclusive (`cached/input` produced a 12,509,400% row); collapse run-lengths into episodes before reading the numbers (144 collapsed turns → 84 onsets, median episode **1 turn**, 64 single-turn episodes carrying 48.2% of waste — so the headline "8.5% of turns cause 89% of waste" invited a threshold fix the data does not support); and read the formula in the installed bundle, not the config key name — Magic Context caps the history budget at `Math.min(executeThresholdPercentage, 80)`, so lowering the knob below 80 shrinks the budget and buys nothing while raising it above 80 does nothing at all. Cataloged in [[opencode-plugins]].

**8. `.config/cortexkit/` — the deleted plugin configs are back, at an upstream-owned path, now per-harness.** `magic-context.jsonc` and `aft.jsonc`, both deleted at SHA `e8ebc5c` (2026-07-10) with the note "now run on plugin defaults," have **returned** under `.config/cortexkit/`. The 2026-07-10 "material simplification" reading is superseded: the tuning came back once upstream gave it a stable home. Both files now carry **`"opencode": {…}` and `"pi": {…}` model blocks** — the first consumer-side sighting of [[pi-coding-agent]] anywhere in the fleet's local configuration, and evidence that the multi-harness split documented in [[marcusrbrown--systematic]] has reached the config layer. `dreamer` also replaced its single `00:00-08:00` window with a **nine-task cron scheduler** (`verify`, `verify-broad`, `curate`, `classify-memories`, `retrospective`, `maintain-docs`, `map-memories`, `evaluate-smart-notes`, `review-user-memories`).

**9. Stale MCP references are back, four-deep — and the previous survey's "fixed" was incidental.** OMO-slim's `librarian.mcps` now reads `["aha", "atlassian", "box", "context7", "gh_grep", "slack"]` while `opencode.json` registers exactly **two** servers (`context7`, `gh_grep`). Four names — `aha`, `atlassian`, `box`, `slack` — resolve to nothing. The 2026-08-26 survey recorded the `tavily` drift of 2026-07-10 as repaired "in lockstep, so no stale reference this time"; that lockstep was a coincidence of one edit, not an enforced invariant, and the drift returned wider the moment the preset roster grew. Nothing validates preset `mcps` names against the registered `mcp` block.

**10. Version churn — four mise majors in one window.** npm 11.19.0 → **12.0.2**, pnpm 11.22.0 → **12.3.4**, `npm:typescript` 6.0.3 → **7.0.2**, `typescript-language-server` 5.3.0 → **6.0.0**; node 24.21.0, go 1.27.1, rust 1.98.1, bun 1.4.2, deno 2.9.6, ast-grep 0.45.3. Fro Bot agent v0.105.0 → **v0.109.4** — still the ecosystem version leader, and notably *ahead of the control plane*, whose own 2026-09-10 pass recorded six `fro-bot/agent` pins frozen at v0.109.0 (see [[github-actions-ci]]). Harness `1.18.21-harness.22dee0ee` → **`1.18.29-harness.88b6b5fb`**; `@fro.bot/systematic` 3.15.0 → **3.16.5**.

**11. Daemon shape: healthy scheduler, inert content half.** Fro Bot is **15/15 green** on scheduled runs (2026-08-26 → 09-09, `30 15` UTC) and files a daily report. But **97 of the last 100 runs concluded `skipped`** — 65 `pull_request`, 30 `issues`, 2 `issue_comment` — with only 2 scheduled and 1 PR run executing. The trust gate blocks bot-authored PRs and issues, and the trigger surface is ~100% `mrbro-bot[bot]` Renovate traffic. Same census as [[marcusrbrown--tokentoilet]]; the difference is that here the scheduled half now actually delivers, because finding #6 restored its PR path.

## Overview

- **Purpose:** Synchronize shell configuration and dev environment across machines
- **Default branch:** `main`
- **Created:** 2011-06-09
- **Last push:** 2026-09-10
- **`node_id`:** `MDEwOlJlcG9zaXRvcnkxODY5MTU0` (repo id `1869154`)
- **License:** _Still undetectable (2026-09-10, SHA `fe0144c`):_ the GitHub License API continues to return `null` (`license: null`, `/license` endpoint 404) and no `LICENSE`/`UNLICENSE` file appears in the tree. This is now the **sixth consecutive survey** with no machine-detectable license (first flagged SHA `4df0c2d`, 2026-06-16). Prior surveys through SHA `70c211bc` (2026-06-06) recorded **The Unlicense (public domain)**. Treat license status as **unspecified**.
- **Topics:** `dotfiles`, `configuration`, `settings`, `preferences`, `zsh`, `sheldon`, `mise`, `starship`
- **Languages:** TypeScript (primary by size, ~362 KB), Shell (~34 KB, down from the Bash-subsystem deletion), Vim Script, JavaScript, Ruby
- **Tracked files:** 203 per `AGENTS.md` (was 196 @ 2026-08-26) — net of **26 deletions** under `.config/bash/` against new `docs/` and `.config/cortexkit/` additions
- **Open issues:** 6 (@ 2026-09-10; `open_issues_count` 7 = 6 issues + 1 PR; unchanged count from 2026-08-26 but fully rotated). Open: #1924 (OpenCode DB perf tuning beyond prune/vacuum), #444 (Renovate Dependency Dashboard) + **four** rolling `fro-bot` daily-maintenance reports (#2562/#2558/#2546/#2540). One open PR #2560 (`astral-sh/uv` → v0.12.12 — the pin introduced by #2497, now Renovate-visible). **#2434 closed 2026-08-26** by #2435 (the `.dotfiles/ignore` rename); **#2433 merged** (AFT legacy-index cleanup runbook). Note the daily-report overhang: the stale-report cleanup closes entries older than 3 days, and #2540 (09-06) is 4 days old at survey time — the step runs on `schedule` only, so the window is bounded by cron granularity, not broken.
- **Stars:** 20 (unchanged @ 2026-09-10; watchers 20, forks 0)

## Repository Architecture

### Bare Git Repo Pattern

The repo uses an allowlist ignore file — everything is ignored by default (`/*`), and tracked paths are explicitly un-ignored with `!/path` entries. All git operations require the dotfiles alias:

```bash
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
.dotfiles git status
```

**The allowlist file is `.dotfiles/ignore`, not `.dotfiles/.gitignore` (renamed 2026-08-26, #2435 — supersedes every prior survey).** The old name was read **twice**: once as `core.excludesFile`, and again as an ordinary per-directory ignore file, because the git dir sits inside the work tree at `$HOME/.dotfiles/`. In the second reading the leading `/*` re-anchors to `.dotfiles/` and every `!/…` negation resolves to a path that never exists — so allowlist entries silently failed to take effect (issue #2434: new `docs/` files needed an explicit `git add`). `.dotfiles/.gitconfig` now carries the reason as a header comment, and `.dotfiles/README.md` states it plainly: *"Renaming a file back to `.gitignore` here reintroduces that bug."* This is a bare-repo-specific footgun — it exists only because the git dir is a directory inside the work tree. Generalized in [[dotfiles]].

### Shell Configuration

Zsh is the daily shell; Bash is a minimal fallback. XDG-compliant — all configs live under `~/.config/`.

**Only two files under `.config/bash/` are live: `exports` and `aliases`** (as of #2506, 2026-09-04). See finding 1 above — the 26-file `main`/`functions`/`init.d/`/`completion.d/`/`local.d/` subsystem documented through the 2026-08-26 survey had **not executed since 2024-01-10** and was deleted after salvage.

**Zsh initialization chain (the daily shell):**

1. `.zshenv` → `ZDOTDIR/.zshenv`
2. `.zshrc` sources `.config/bash/exports` and `~/.zshrc.local`, then Sheldon (deferred loading, compiled cache)
3. Sheldon's `[plugins.aliases]` loads `.config/bash/aliases`
4. Prezto modules loaded for environment, history, directory

**Bash initialization chain (corrected 2026-09-04):**

1. `.profile` sources `.config/bash/exports` (login shells)
2. `.bashrc` sources `exports` **only if `command_exists` is undefined** (i.e. a non-login `bash -i`), then `aliases`
3. Sheldon (`plugins.bash.toml`) → `mise activate` + `starship init`, and nothing else

The `declare -F command_exists` guard in `.bashrc` is load-bearing: `aliases` calls `command_exists`, which is defined in `exports`; a login bash gets `exports` via `.profile`, a non-login `bash -i` reads only `.bashrc` and would otherwise source `aliases` with the helper undefined.

**Machine-local overrides are `*.local` files only** — `~/.zshrc.local` is the supported path. The `local.d/` directory mechanism documented through 2026-08-26 never worked and is gone; the runbook at `docs/runbooks/discord-admin-agent.md` was corrected to match (#2500–#2502).

_Superseded (recorded through 2026-08-26, now known to be documentation of dead code):_ `.bashrc` → `.config/bash/main` → `functions` → `aliases` → `init.d/*` (numbered prefixes, `d`-prefix to disable) → `local.d/*`.

### Key Directories

| Directory               | Purpose                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `.config/bash/`         | **Two files only** (since #2506): `exports` (shared env + helper functions) and `aliases` |
| `.config/zsh/`          | Zsh config and local plugin configs                                                    |
| `.config/sheldon/`      | Zsh plugin manager: `plugins.toml` (zsh), `plugins.bash.toml` (bash)                   |
| `.config/mise/`         | Tool version management: `config.toml`, `tasks/` (`distill`, `format`, `install`, `mise`, `opencode`, `print`) |
| `.config/git/`          | Global git config, ignore, attributes                                                  |
| `.config/cortexkit/`    | **New (2026-08-28):** upstream-owned cortexkit plugin config — `magic-context.jsonc`, `aft.jsonc` |
| `.config/starship.toml` | Cross-shell prompt (Catppuccin Mocha palette)                                          |
| `.claude/`              | Claude Code config: agents, commands, rules                                            |
| `.config/opencode/`     | OpenCode AI config (has own AGENTS.md)                                                 |
| `.devcontainer/`        | Devcontainer with custom features                                                      |
| `.dotfiles/`            | Bare repo metadata: `.gitconfig`, **`ignore`** (renamed from `.gitignore`, #2435), `.prettierrc.yaml`, `docs/` |
| `Brewfile`              | macOS Homebrew dependencies                                                            |
| `Library/LaunchAgents/` | macOS launch agents (`dev.mrbro.*` prefix)                                             |

### Tool Stack (via [[mise]])

Managed tool versions in `.config/mise/config.toml` (as of SHA `fe0144c`, 2026-09-10):

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.21.0       | Primary JS runtime; bumped from 24.19.0                   |
| npm                           | **12.0.2**    | **v11 → v12 major boundary** (was 11.19.0)                |
| bun                           | 1.4.2         | npm installs (`settings.npm.bun = true`); also the CI test runner (Script Tests matrix, bumped in lockstep) |
| pnpm                          | **12.3.4**    | **v11 → v12 major boundary** (was 11.22.0)                |
| python                        | 3.14.7        | Unchanged — but see the mise 2026.9.0 pyenv resolution change under `Devcontainer` |
| pipx                          | 1.17.2        | Bumped from 1.16.7                                        |
| pipx:poetry                   | 2.4.3         | Bumped from 2.4.1                                          |
| deno                          | 2.9.6         | Bumped from 2.9.5                                          |
| rust                          | 1.98.1        | Bumped from 1.98.0                                         |
| cargo-binstall                | 1.23.0        | Bumped from 1.22.0                                         |
| zig / zls                     | 0.15.2 / 0.16.0 | Unchanged                                                |
| go                            | 1.27.1        | Bumped from 1.27.0                                         |
| ast-grep                      | 0.45.3        | Bumped from 0.44.1 (first movement in three surveys)      |
| shfmt (aqua:mvdan/sh)         | 3.14.1        | Bumped from 3.13.1                                         |
| gitleaks (aqua:gitleaks)      | 8.30.1        | Unchanged                                                  |
| typescript                    | **7.0.2** (npm) | **v6 → v7 major boundary** (was 6.0.3, held since 2026-04-22) |
| playwright                    | 1.63.0 (npm)  | Bumped from 1.62.1                                         |
| prettier                      | 3.9.6 (npm)   | With `@bfra.me/prettier-config` 0.16.11 (both unchanged)  |
| @biomejs/biome                | 2.5.12 (npm)  | Bumped from 2.5.10                                         |
| rimraf                        | 6.1.3 (npm)   | Unchanged                                                  |
| tsx                           | 4.23.13 (npm) | Bumped from 4.23.12                                        |
| @anthropic-ai/claude-code     | 2.1.163 (npm) | Renovate updates disabled (manual); **unchanged for 3 surveys** (~6 weeks) |
| @fro.bot/harness              | **1.18.29-harness.88b6b5fb** (npm) | Patched-OpenCode CLI from [[fro-bot--agent]] (#2521); harness base `1.18.21` → `1.18.29`. Sole OpenCode binary — stock `opencode-ai` remains absent (2nd survey) |
| @github/copilot               | 1.0.83 (npm)  | Bumped from 1.0.80                                         |
| agent-browser                 | 0.36.0 (npm)  | Bumped from 0.34.0                                         |
| skills                        | 1.5.24 (npm)  | Bumped from 1.5.23                                         |
| ocx                           | 2.0.15 (npm)  | Unchanged                                                  |
| @marcusrbrown/infra           | latest (npm)  | Personal infra CLI ([[marcusrbrown--infra]])              |
| pyright                       | 1.1.413 (npm) | Unchanged                                                  |
| typescript-language-server    | **6.0.0** (npm) | **v5 → v6 major boundary** (was 5.3.0)                   |

**Four major boundaries in one window (SHA `fe0144c`, 2026-09-10):** npm v11 → v12, pnpm v11 → v12, `npm:typescript` v6 → v7, `typescript-language-server` v5 → v6. `[settings] idiomatic_version_file_enable_tools = ["node"]` is still declared; `[env]` (`UV_SYSTEM_CERTS`, templated `NPM_TOKEN`, redacted `~/.config/mise/.env.local`) is unchanged. No tools were added or removed this window — pure version movement, in contrast to the 2026-08-26 window's three removals.

#### Historical Snapshot (SHA `3479589`, 2026-08-26) — superseded

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.19.0       | Primary JS runtime; bumped from 24.18.0                   |
| npm                           | 11.19.0       | Bumped from 11.18.0                                        |
| bun                           | 1.4.0         | npm installs (`settings.npm.bun = true`); **major-ish bump 1.3.14 → 1.4.0** — also the CI test runner (see Script Tests matrix) |
| pnpm                          | 11.22.0       | Bumped from 11.17.0                                        |
| python                        | 3.14.7        | Bumped from 3.14.6                                         |
| pipx                          | 1.16.7        | **New explicit pin** (formerly implicit)                  |
| pipx:poetry                   | 2.4.1         | Python packaging                                           |
| deno                          | 2.9.5         | Bumped from 2.9.4                                          |
| rust                          | 1.98.0        | Bumped from 1.97.1                                         |
| cargo-binstall                | 1.22.0        | Cargo binary installer; bumped from 1.21.1                |
| zig                           | 0.15.2        | With ZLS 0.16.0                                            |
| go                            | 1.27.0        | Bumped from 1.26.5                                         |
| ast-grep                      | 0.44.1        | AST-aware search/replace (unchanged)                      |
| shfmt (aqua:mvdan/sh)         | 3.13.1        | Shell formatter                                           |
| gitleaks (aqua:gitleaks)      | 8.30.1        | Secret scanner                                            |
| typescript                    | 6.0.3 (npm)   |                                                           |
| playwright                    | 1.62.1 (npm)  | Bumped from 1.61.1                                         |
| prettier                      | 3.9.6 (npm)   | With `@bfra.me/prettier-config` 0.16.11 (was 0.16.9)      |
| @biomejs/biome                | 2.5.10 (npm)  | Bumped from 2.5.5                                          |
| rimraf                        | 6.1.3 (npm)   | Deep deletion utility                                     |
| tsx                           | 4.23.12 (npm) | TypeScript execution; bumped from 4.23.1                  |
| @anthropic-ai/claude-code     | 2.1.163 (npm) | Renovate updates disabled (manual); unchanged             |
| @fro.bot/harness              | 1.18.21-harness.22dee0ee (npm) | Patched-OpenCode CLI from [[fro-bot--agent]]; bumped from `1.18.5-harness.3a55d7d2`. Harness base now `1.18.21` |
| @github/copilot               | 1.0.80 (npm)  | GitHub Copilot CLI; bumped from 1.0.74                    |
| agent-browser                 | 0.34.0 (npm)  | Browser automation CLI for agents; bumped from 0.33.0     |
| skills                        | 1.5.23 (npm)  | Agent skills package; bumped from 1.5.20                  |
| ocx                           | 2.0.15 (npm)  | OpenCode extension runner; bumped from 2.0.11             |
| @marcusrbrown/infra           | latest (npm)  | Personal infra CLI                                        |
| pyright                       | 1.1.413 (npm) | Python type checker; bumped from 1.1.411                  |
| typescript-language-server    | 5.3.0 (npm)   | TypeScript language server                                |

**mise tool-set removals (SHA `3479589`, surveyed 2026-08-26):** three npm tools dropped from `[tools]` since 2026-07-27 — **`opencode-ai`** (stock CLI no longer pinned in mise; the `@fro.bot/harness` patched build now stands alone as the OpenCode binary), **`puppeteer`** (25.3.0), and **`vibe-tools`** (0.63.3). Playwright remains for browser automation. `pipx` gained an explicit pin (`1.16.7`). This is the first survey where stock `opencode-ai` is absent from the toolchain — the harness/stock lockstep noted at 2026-07-27 is now moot because only the harness build remains.

**Harness bump (SHA `3479589`, surveyed 2026-08-26):** `@fro.bot/harness` advanced `1.18.5-harness.3a55d7d2` → `1.18.21-harness.22dee0ee`, tracking the [[fro-bot--agent]] harness base rebase to `1.18.21`. With stock `opencode-ai` removed from mise, the harness build is the sole OpenCode CLI on the machine.

#### Historical Snapshot (SHA `cd03ad8`, 2026-07-27) — superseded

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.18.0       | Primary JS runtime                                        |
| python                        | 3.14.6        |                                                           |
| rust                          | 1.97.1        |                                                           |
| go                            | 1.26.5        |                                                           |
| bun                           | 1.3.14        | Used for npm package installs (`settings.npm.bun = true`) |
| deno                          | 2.9.4         |                                                           |
| pnpm                          | 11.17.0       |                                                           |
| npm                           | 11.18.0       |                                                           |
| opencode-ai                   | 1.18.5 (npm)  | Renovate updates disabled (manual)                        |
| @fro.bot/harness              | 1.18.5-harness.3a55d7d2 (npm) | Realigned with stock `opencode-ai@1.18.5`       |
| puppeteer                     | 25.3.0 (npm)  | Browser automation                                        |
| vibe-tools                    | 0.63.3 (npm)  | Vibe coding tools                                         |
| @biomejs/biome                | 2.5.5 (npm)   |                                                           |
| agent-browser                 | 0.33.0 (npm)  |                                                           |
| @github/copilot               | 1.0.74 (npm)  | GitHub Copilot CLI                                        |

**Harness/OpenCode realignment (SHA `cd03ad8`, surveyed 2026-07-27):** `@fro.bot/harness` advanced `1.17.14-harness.e98fbc0f` → `1.18.5-harness.3a55d7d2` and stock `opencode-ai` jumped `1.17.12` → `1.18.5`. The two are back in lockstep on the same base version (`1.18.5`) — the one-minor drift noted at 2026-07-10 (harness base `1.17.14` vs stock `1.17.12`) is closed. `@anthropic-ai/claude-code` continues its manual climb to `2.1.163`.

**Harness bump (SHA `e8ebc5c`, surveyed 2026-07-10):** `@fro.bot/harness` advanced `1.17.9-harness.bd89c818` → `1.17.14-harness.e98fbc0f`, continuing to track the [[fro-bot--agent]] harness base rebase (now `1.17.14`). The mise pin still mirrors the patched-OpenCode CLI the agent runtime runs, though stock `opencode-ai` (1.17.12) now sits one minor behind the harness base line.

**Harness bump (SHA `4b0c4d1`/`#1903`, surveyed 2026-06-27):** `@fro.bot/harness` advanced `1.17.6-harness.13169873` → `1.17.9-harness.bd89c818`, tracking the [[fro-bot--agent]] rebase of the harness base from `1.17.6` to `1.17.9` (SQLite-reliability carries). The mise pin and the agent's `DEFAULT_OPENCODE_VERSION` are now aligned on the same harness build — the local machine and CI runtime run the identical patched OpenCode binary.

**Notable addition (SHA `4df0c2d`, 2026-06-16):** `@fro.bot/harness` joined `[tools]` — Marcus pins the Fro Bot harness build (the patched-OpenCode CLI published by [[fro-bot--agent]]) directly in mise, alongside stock `opencode-ai@1.17.4`. This is the local-machine mirror of the harness-as-default-OpenCode cutover happening in the agent runtime.

**Notable removals from prior ingest (SHA `ae026c1`):** `@cortexkit/opencode-magic-context` and `@cortexkit/aft-opencode` are no longer in `[tools]` — they moved to the OpenCode `plugin` array in `opencode.json` (managed by a new Renovate custom manager for pinned npm plugin versions). `remark-language-server` and `lolcrab` entries dropped from mise config.

**Env additions:** `UV_SYSTEM_CERTS=true`, `NPM_TOKEN` templated from env, and a redacted env file pulled from `~/.config/mise/.env.local`.

#### Historical Snapshot (SHA `0bb24f0`, 2026-05-24)

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.16.0       | Primary JS runtime                                        |
| python                        | 3.14.5        |                                                           |
| rust                          | 1.95.0        |                                                           |
| go                            | 1.26.3        |                                                           |
| bun                           | 1.3.14        | Used for npm package installs (`settings.npm.bun = true`) |
| deno                          | 2.8.0         |                                                           |
| zig                           | 0.15.2        | With ZLS 0.16.0                                           |
| pnpm                          | 11.2.1        | Major bump from 10.x                                      |
| npm                           | 11.15.0       |                                                           |
| opencode-ai                   | 1.15.5 (npm)  | Renovate updates disabled                                 |
| agent-browser                 | 0.27.0 (npm)  | Browser automation CLI for agents                         |
| skills                        | 1.5.7 (npm)   | Agent skills package                                      |
| @github/copilot               | 1.0.51 (npm)  | GitHub Copilot CLI (new)                                  |
| @biomejs/biome                | 2.4.15 (npm)  |                                                           |
| tsx                           | 4.22.3 (npm)  | TypeScript execution                                      |
| pyright                       | 1.1.409 (npm) | Python type checker                                       |
| typescript-language-server    | 5.2.0 (npm)   | TypeScript language server                                |
| rust                          | 1.95.0        |                                                           |
| go                            | 1.26.3        |                                                           |
| pnpm                          | 11.2.1        |                                                           |

#### Historical Snapshot (SHA `ae026c1`, 2026-04-22)

| Tool                          | Version       | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| node                          | 24.15.0       | Primary JS runtime                                        |
| python                        | 3.14.4        |                                                           |
| rust                          | 1.95.0        |                                                           |
| go                            | 1.26.2        |                                                           |
| bun                           | 1.3.13        | Used for npm package installs (`settings.npm.bun = true`) |
| deno                          | 2.7.13        | Bumped from 2.7.12 via Renovate                          |
| zig                           | 0.15.2        | With ZLS 0.15.0                                           |
| pnpm                          | 10.33.0       |                                                           |
| npm                           | 11.12.1       |                                                           |
| prettier                      | 3.8.3 (npm)   | With `@bfra.me/prettier-config`                           |
| opencode-ai                   | 1.14.18 (npm) | Renovate updates disabled                                 |
| ast-grep                      | 0.40.5        | AST-aware search/replace                                  |
| typescript                    | 6.0.3 (npm)   |                                                           |
| playwright                    | 1.59.1 (npm)  |                                                           |
| puppeteer                     | 24.41.0 (npm) | Browser automation                                        |
| agent-browser                 | 0.26.0 (npm)  | Browser automation CLI for agents                         |
| skills                        | 1.5.1 (npm)   | Agent skills package                                      |
| ocx                           | 2.0.7 (npm)   | OpenCode extension runner                                 |
| @cortexkit/opencode-magic-context | 0.13.0 (npm) | Context management plugin (bumped from 0.12.0)       |
| @cortexkit/aft-opencode       | 0.14.0 (npm)  | AFT OpenCode plugin                                       |
| @marcusrbrown/infra            | latest (npm)  | Personal infra CLI                                         |
| @biomejs/biome                | 2.4.12 (npm)  | Re-added; was removed in prior ingest                     |
| vibe-tools                    | 0.63.3 (npm)  | Vibe coding tools (new)                                   |
| @anthropic-ai/claude-code     | 2.1.112 (npm) | Present but Renovate updates disabled                      |
| shfmt                         | 3.13.1 (aqua) | Shell formatter                                           |
| cargo-binstall                | 1.15.5        | Cargo binary installer                                    |
| tsx                           | 4.21.0 (npm)  | TypeScript execution (new)                                |
| rimraf                        | 6.1.3 (npm)   | Deep deletion utility (new)                               |
| pyright                       | 1.1.409 (npm) | Python type checker (new)                                  |
| remark-language-server        | 3.0.0 (npm)   | Markdown language server (new)                             |
| typescript-language-server    | 5.1.3 (npm)   | TypeScript language server (new)                          |
| lolcrab                       | 0.4.1 (github:mazznoer/lolcrab) | Rainbow coloring tool (new)                   |
| pipx:poetry                   | 2.3.4         | Python packaging (new)                                    |

Mise tasks defined in `tasks/dotfiles.toml` and `tasks/_mise.toml` — includes `format`, `install`, `opencode:doctor`.

### Zsh Plugin Stack (Sheldon)

Key plugins in `.config/sheldon/plugins.toml`:

- **zsh-defer** — Deferred loading for faster startup
- **zsh-autosuggestions** — Fish-like suggestions (async, strategy: history + completion)
- **fast-syntax-highlighting** — Syntax highlighting (work dir: `$XDG_CONFIG_HOME/fsh`)
- **zsh-history-substring-search** — History search with arrow key bindings
- **zsh-snap (znap)** — Lazy eval for mise, starship, rustup, cargo completions
- **Prezto** — Modules: environment, history, directory
- **zsh-utils** — Editor and completion
- **brew-keeper** — Homebrew maintenance (deferred)
- **ssh (zpm)** — SSH agent management
- **vscode-shell-integration** — VS Code terminal integration (conditional)
- **shellfish** — Secure Shellfish iOS SSH support

Custom Sheldon templates: `defer`, `inline`, `pretzo`, `source`, `znap`.

### Starship Prompt

Catppuccin Mocha palette. Custom format with powerline segments:

```
[username][directory][git_branch+status][language modules][cmd_duration][jobs][time][status]
```

Disabled modules: battery, gcloud, package, line_break. Command timeout: 1500ms.

### Git Configuration

Global config at `.config/git/config`:

- GPG signing enabled (`commit.gpgSign = true`)
- Rebase by default (`branch.autoSetupRebase = always`)
- Fast-forward only merges (`merge.ff = only`)
- Auto-prune on fetch (`fetch.prune = true`)
- Untracked cache enabled for performance
- LFS configured
- URL aliases: `gh:` for `git@github.com:`, `gst:` for gists
- `useConfigOnly = true` — requires explicit user config
- Includes `.gitconfig.local` for machine-specific settings

### macOS Tooling (Brewfile)

Notable brew packages: `bat`, `fzf`, `ripgrep`, `lsd`, `fd`, `git-delta`, `starship`, `gh`, `jq`, `shellcheck`, `shfmt`, `tmux`, `gnupg`, `pinentry-mac`, `wireguard-tools`.

Nerd fonts: FiraCode, FiraMono, JetBrains Mono, MesloLG, SauceCodePro.

Casks: Firefox, iTerm2, Raycast, Slack, Ghidra, Arduino IDE, HiddenBar.

Mac App Store: Xcode, Home Assistant, Draw Things, Data Jar, Apple Configurator.

VS Code extensions: 90+ extensions covering themes, language support, DevOps, AI (Copilot, Cody, Fig).

### Privacy-Focused Defaults

Telemetry disabled where possible:

- `HOMEBREW_NO_ANALYTICS=1`
- `PLATFORMIO_SETTING_ENABLE_TELEMETRY=No`
- `VIBE_TOOLS_NO_TELEMETRY=1`

### AI Agent Configuration

The repo includes configuration for multiple AI coding agents:

- **Claude Code** (`.claude/`): Custom agents (dotfiles-reviewer), commands, rules, `settings.json`
- **OpenCode** (`.config/opencode/`): Has its own `AGENTS.md`, plus `agents/` (one subagent, `research.md`), `commands/`, `scripts/` (`opencode-doctor.ts`, `ollama-distill.ts`, both with colocated Bun tests, plus `lib/` and `tsconfig.json`), `skills/` (11), `profiles/`, `ocx.jsonc`, `tui.json` (theme-only), and — new @ 2026-09-10 — `oh-my-opencode-slim/` holding `designer_append.md` / `orchestrator_append.md`
- **cortexkit plugins** (`.config/cortexkit/`, new @ 2026-08-28): `magic-context.jsonc`, `aft.jsonc` — see the plugin-ecosystem section
- **AGENTS.md** at repo root: Comprehensive project knowledge base for AI agents; refreshed at `90742fb` via `/init-deep`. **Materially corrected @ 2026-09-03/09-04** (#2498/#2506) — the structure tree, the shell-config table, the CONVENTIONS load-chain block, and the ANTI-PATTERNS list all described the dormant Bash subsystem and the double-read `.gitignore`. Tracked-file count 196 → 203

#### OpenCode Plugin Ecosystem (as of SHA `fe0144c`, 2026-09-10)

OpenCode plugins are pinned by version directly in `.config/opencode/opencode.json` (managed by a Renovate custom manager that matches `"name@x.y.z"` patterns inside `opencode.json` / `tui.json`):

| Plugin | Version | Purpose |
| --- | --- | --- |
| `@cortexkit/opencode-anthropic-auth` | 1.22.0 | Anthropic auth provider — upstream cortexkit package; bumped from 1.19.1 |
| `@cortexkit/opencode-openai-auth` | 0.7.1 | OpenAI auth provider (upstream cortexkit); bumped from 0.6.3 |
| `oh-my-opencode-slim` | 2.2.11 | Slimmed multi-agent routing layer; **version held**, but the config it reads changed substantially (see routing below) |
| `@cortexkit/opencode-magic-context` | 0.41.4 | Adaptive context management; bumped from 0.38.1 — **and re-acquired a config file** at `.config/cortexkit/magic-context.jsonc` |
| `@cortexkit/aft-opencode` | 0.55.1 | AFT plugin; bumped from 0.52.1 — **re-acquired** `.config/cortexkit/aft.jsonc` |
| `opencode-copilot-delegate` | 0.12.1 | Copilot-CLI delegation as a headless plugin (see [[marcusrbrown--opencode-copilot-delegate]]); held for a second survey after the 2026-08-26 re-add |
| `@fro.bot/systematic` | 3.16.5 | Systematic skills + agents; bumped from 3.15.0 (steady v3 minor train — see [[marcusrbrown--systematic]] / [[fro-bot--systematic]]) |

**`.config/cortexkit/` — deleted configs return, per-harness (SHA `fe0144c`, 2026-09-10; supersedes the 2026-07-10 "runs on plugin defaults" reading):** a new `.config/cortexkit/` directory holds `magic-context.jsonc` (3,252 B) and `aft.jsonc` (335 B). Both were **deleted** at SHA `e8ebc5c` (2026-07-10) and the page then recorded that as "a material simplification: two of the most heavily tuned config surfaces in the repo were deleted in one window, deferring behavior to upstream plugin defaults." That framing is now **superseded** — the tuning was not abandoned, it was waiting for upstream to give it a stable, plugin-owned path outside `.config/opencode/`. Both files declare upstream `$schema` URLs (`cortexkit/magic-context`, `cortexkit/aft`) and set `auto_update: false`.

The structurally interesting part is the **per-harness split**. `historian` and `dreamer` no longer carry a flat `model` key; each carries sibling `"opencode": {…}` and `"pi": {…}` blocks:

```jsonc
"historian": {
  "opencode": { "model": "anthropic/claude-sonnet-5", "variant": "medium" },
  "pi":       { "model": "anthropic/claude-sonnet-5" }
}
```

This is the **first consumer-side sighting of [[pi-coding-agent]] in the fleet's local configuration** — the multi-harness architecture documented source-side at [[marcusrbrown--systematic]] (one content source, three shipped adapters) has now reached the plugin-config layer of a *different* vendor's package. Note the asymmetry that mirrors the upstream capability matrix: the OpenCode block carries a `variant`, the Pi block does not.

`dreamer` also replaced its single `00:00-08:00` window with a **nine-task cron scheduler** — `verify` (`0 0 * * *`), `verify-broad` (`0 4 * * 0`), `curate`, `classify-memories` (`0 6 * * *`), `retrospective` (`0 5 * * *`), `maintain-docs` (empty schedule = disabled), `map-memories`, `evaluate-smart-notes`, `review-user-memories` (`promotion_threshold: 3`). `cache_ttl` and `execute_threshold_percentage` gained `anthropic/claude-sonnet-5`, `claude-opus-5`, the `gpt-5.6-*`/`-fast` family at 30 m / 80, and **`openai/gpt-6-astra`** at 30 m / 80. `sidekick` stays disabled; `temporal_awareness`, `history_budget_percentage: 0.15`, `historian_timeout_ms: 420000`, the memory block, and the Council `system_prompt_injection` skip-signature are carried forward from the pre-deletion config unchanged. `aft.jsonc` keeps `search_index`/`semantic_search: false` and `bridge.hang_threshold: 5`, and adds a `bash` block (`rewrite`/`compress`/`background` all `true`).

**MCP set holds at two — and the preset references drifted again (SHA `fe0144c`, 2026-09-10):** `opencode.json` still registers exactly `context7` (via `CONTEXT7_API_KEY` header) and `gh_grep` (`https://mcp.grep.app`). But OMO-slim's `librarian.mcps` now reads `["aha", "atlassian", "box", "context7", "gh_grep", "slack"]` in **every one of the six presets** — four names that resolve to nothing. The 2026-08-26 survey recorded the `tavily` drift of 2026-07-10 as repaired "in lockstep, so no stale reference this time"; **that lockstep was incidental, not enforced**, and the drift returned four-deep the moment the preset roster grew. There is no validation of preset `mcps` entries against the registered `mcp` block. `opencode.json` otherwise holds: `"snapshot": false`, `compaction.auto/prune: false`, `experimental.openTelemetry: false`, `lsp: true`, `general`/`explore` disabled, no top-level default `"model"`.

##### Historical Plugin Snapshot (SHA `3479589`, 2026-08-26) — superseded

| Plugin | Version | Purpose |
| --- | --- | --- |
| `@cortexkit/opencode-anthropic-auth` | 1.19.1 | Anthropic auth provider — upstream cortexkit package; bumped from 1.18.0 |
| `@cortexkit/opencode-openai-auth` | 0.6.3 | OpenAI auth provider (upstream cortexkit); bumped from 0.4.3 |
| `oh-my-opencode-slim` | 2.2.11 | Slimmed multi-agent routing layer; bumped from 2.2.8 (in-v2 minor) |
| `@cortexkit/opencode-magic-context` | 0.38.1 | Adaptive context management; bumped from 0.33.0 |
| `@cortexkit/aft-opencode` | 0.52.1 | AFT (Adaptive Fine-Tuning) OpenCode plugin; bumped from 0.48.1 |
| `opencode-copilot-delegate` | 0.12.1 | **Re-added** — Copilot-CLI delegation as a headless plugin (see [[marcusrbrown--opencode-copilot-delegate]]); had been dropped 2026-07-10 |
| `@fro.bot/systematic` | 3.15.0 | Systematic skills + agents; bumped from 3.3.0 (steady v3 minor train — see [[marcusrbrown--systematic]] / [[fro-bot--systematic]]) |

**`opencode-copilot-delegate` returned to the plugin array (SHA `3479589`, 2026-08-26 — contradicts 2026-07-10):** `opencode-copilot-delegate@0.12.1` is back in `opencode.json`'s `plugin` array after being dropped at SHA `e8ebc5c` (2026-07-10), when the note read "Copilot delegation now flows through the `copilot-cli` / `copilot-cloud-agent` skills rather than a loaded plugin." Both mechanisms now coexist: the headless plugin **and** the repo-scoped skills. The plugin pin matches the sibling repo's steady v0.12.1 release (see [[marcusrbrown--opencode-copilot-delegate]], now on Bun 1.4.0 / `@opentui` 0.4.x). This is a genuine reversal — the July "skill-driven, not plugin-driven" framing no longer holds.

**MCP set contracts to two remote servers (SHA `3479589`, 2026-08-26):** the `mcp` block now lists only **`context7`** and **`gh_grep`** — `websearch` (Exa) is **removed** (was present at 2026-07-27; drops 3 → 2), and the Grep.app server key was **renamed `grep_app` → `gh_grep`** (same URL `https://mcp.grep.app`). The OMO-slim `librarian` MCP arrays were updated in lockstep to `["context7", "gh_grep"]`, so no stale reference this time (unlike the 2026-07-10 `tavily` drift). `context7` still authenticates via `CONTEXT7_API_KEY` header. `opencode.json` retains `"snapshot": false`, `compaction.auto/prune: false`, `experimental.openTelemetry: false`, `lsp: true`; `general`/`explore` agents stay disabled; no top-level default `"model"` (routing delegated to OMO-slim).

**Systematic steady v3 minor climb (SHA `3479589`, 2026-08-26):** `@fro.bot/systematic` 3.3.0 → **3.15.0** — no major crossing, tracking the v3 minor train confirmed downstream at [[fro-bot--systematic]] (registry ~v3.12.4 @ 2026-08-21). `systematic.jsonc` still on the `schemas/v3/` config schema.

##### Historical Plugin Snapshot (SHA `cd03ad8`, 2026-07-27) — superseded

| Plugin | Version | Purpose |
| --- | --- | --- |
| `@cortexkit/opencode-anthropic-auth` | 1.18.0 | Anthropic auth provider — upstream cortexkit package |
| `@cortexkit/opencode-openai-auth` | 0.4.3 | OpenAI auth provider (upstream cortexkit) — new this window |
| `oh-my-opencode-slim` | 2.2.8 | Slimmed multi-agent routing layer; **major bump 1.1.2 → 2.2.8** |
| `@cortexkit/opencode-magic-context` | 0.33.0 | Adaptive context management |
| `@cortexkit/aft-opencode` | 0.48.1 | AFT (Adaptive Fine-Tuning) OpenCode plugin |
| `@fro.bot/systematic` | 3.3.0 | Systematic skills + agents; **major bump 2.33.2 → 3.3.0** |

**New OpenAI auth plugin added (SHA `cd03ad8`, 2026-07-27):** `@cortexkit/opencode-openai-auth@0.4.3` joined the `plugin` array alongside the existing Anthropic auth plugin. Both auth providers now come from the upstream cortexkit line — consistent with the OMO-slim active preset flip to `openai` (below), which routes most agents through `openai/gpt-5.6-*` models that need first-class OpenAI auth. Marcus's own fork `@marcusrbrown/opencode-anthropic-auth` remains unreferenced (fourth consecutive survey).

**Two major plugin bumps (SHA `cd03ad8`, 2026-07-27):** `oh-my-opencode-slim` crossed the **v1 → v2** boundary (1.1.2 → 2.2.8) and `@fro.bot/systematic` crossed the **v2 → v3** boundary (2.33.2 → 3.3.0). The `systematic.jsonc` schema tracks the v3 line (`schemas/v3/systematic-config.schema.json`). The final commit in this window (`cd03ad8`, PR #2191) was the systematic 3.2.8 → 3.3.0 bump alone; the v2→v3 crossing and the slim v2 landed earlier in the survey window.

**MCP set holds at three remote servers (SHA `cd03ad8`, 2026-07-27):** `context7`, `grep_app`, `websearch` (Exa). `tavily` remains removed. Config still adds `"snapshot": false` to the top level (new since 2026-07-10) alongside `compaction.auto/prune: false`, `experimental.openTelemetry: false`, `lsp: true`. The top-level default `"model"` key is still absent — routing stays delegated to OMO-slim presets.

**`opencode-copilot-delegate` dropped from headless `opencode.json` (SHA `e8ebc5c`, 2026-07-10):** The `plugin` array no longer lists `opencode-copilot-delegate@0.12.0`. It was present in both `opencode.json` and `tui.json` at SHA `debcb8e`; it is absent from `opencode.json` here. Copilot-CLI delegation now flows through the repo-scoped `copilot-cli` skill and the new `copilot-cloud-agent` skill rather than a loaded plugin. See [[marcusrbrown--opencode-copilot-delegate]] — the sibling repo still exists, but this repo no longer wires it as a headless plugin.

**Auth plugin steady on upstream cortexkit (SHA `e8ebc5c`, 2026-07-10):** `@cortexkit/opencode-anthropic-auth` continues climbing the upstream version line — now **1.13.0** (was 1.10.3 @ 2026-06-27). Third consecutive survey on the upstream fork; Marcus's own fork `@marcusrbrown/opencode-anthropic-auth` remains unreferenced. The [[marcusrbrown--cortexkit-anthropic-auth]] fork repo may still exist, but this repo no longer consumes it.

**Default model declaration removed (SHA `e8ebc5c`, 2026-07-10):** `opencode.json` no longer carries a top-level `"model"` key. The `"model": "opencode-go/kimi-k2.6"` default recorded through 2026-06-27 is gone — default routing is now delegated entirely to the `oh-my-opencode-slim` preset stack (active `mixed` preset → `anthropic/claude-opus-4-8` orchestrator) rather than a hard-coded headless default.

**Agents disabled in `opencode.json`:** `general` and `explore` remain explicitly disabled (`"disable": true`).

**`tavily` MCP server removed (SHA `e8ebc5c`, 2026-07-10):** The MCP set drops from four to **three** remote servers: `context7`, `grep_app`, `websearch` (Exa). `tavily` is gone from the `mcp` block. `websearch` moved its Exa API key and tool selection into the URL query string (`?exaApiKey={env:EXA_API_KEY}&tools=web_search_exa`); `context7` still authenticates via `CONTEXT7_API_KEY` header. Note: OMO-slim `librarian` presets still list `tavily` in their `mcps` array, so that reference is now stale relative to the actual MCP registration — a minor drift worth flagging on the next config pass.

**Discord MCP server removed (SHA `4df0c2d`):** The Docker-based `saseq/discord-mcp` server documented at SHA `70c211bc` is gone from `opencode.json`.

**Custom OpenAI provider models removed (SHA `4df0c2d`):** The inline `openai/gpt-5.5` and `openai/gpt-5.5-fast` `provider` model declarations recorded at SHA `70c211bc` are no longer present in `opencode.json` (slimmed; those model ids now resolve via provider defaults / the slim preset stack). `compaction` remains `auto: false`, `prune: false`; `experimental.openTelemetry: false`; `lsp: true`.

**Config files in `.config/opencode/` (SHA `e8ebc5c`, 2026-07-10):**
- `aft.jsonc` — **removed.** The dedicated AFT config file (documented through 2026-06-27 with `restrict_to_project_root: false`, `search_index`/`semantic_search: false`, `bridge.hang_threshold`) is gone (404). `@cortexkit/aft-opencode@0.46.0` now runs on plugin defaults.
- `magic-context.jsonc` — **removed.** The extensive per-model historian/dreamer/cache-TTL/threshold config (documented in detail below through 2026-06-27) is gone (404). `@cortexkit/opencode-magic-context@0.31.5` now runs on plugin defaults. This is a material simplification: two of the most heavily tuned config surfaces in the repo were deleted in one window, deferring behavior to upstream plugin defaults.
- `systematic.jsonc` — Systematic skills configuration file. **Retuned again (SHA `fe0144c`, 2026-09-10):** still on `schemas/v3/systematic-config.schema.json`, now tracking `@fro.bot/systematic@3.16.5`. Five categories held, but the **routing swung back toward Copilot and Anthropic and off `opencode-go`** (#2449 "switch models to github copilot", #2513 "lower systematic variant"): `design` → `github-copilot/gemini-3.5-flash`; `document-review` / `research` / **`review`** → `github-copilot/gpt-5.4-mini` variant low (the `review` seat, which moved onto Copilot at 2026-08-26, holds); **`workflow` → `anthropic/claude-sonnet-5` variant low** (was `opencode-go/gpt-5.6-luna`). Agents: **`repo-research-analyst` → `github-copilot/gpt-5.4-mini` low** (was `opencode-go/gpt-5.6-luna`), `spec-flow-analyzer` → `github-copilot/gemini-3.5-flash` high (held), **`systematic-implementer` → `anthropic/claude-sonnet-5` variant medium** (was `opencode-go/gpt-5.6-luna` high — both provider and variant lowered). `workflow_guard: { mode: "protected", debug: false }` is carried unchanged, so the v3 guard surface stays on for a second survey.
  - _Prior (SHA `3479589`, 2026-08-26):_ tracking 3.15.0. The `categories` block gained a fifth **`workflow`** category (→ `opencode-go/gpt-5.6-luna` variant low) alongside design → `github-copilot/gemini-3.5-flash`, document-review / research / review → `github-copilot/gpt-5.4-mini` variant low (the `review` seat moved off `openai/gpt-5.5` onto Copilot `gpt-5.4-mini`). `agents`: repo-research-analyst → `opencode-go/gpt-5.6-luna` variant low, spec-flow-analyzer → `github-copilot/gemini-3.5-flash` variant high, **systematic-implementer → `opencode-go/gpt-5.6-luna` variant high** (moved off `openai/gpt-5.6-luna`; temp field dropped). A new top-level **`workflow_guard: { mode: "protected", debug: false }`** block was added — the v3 workflow-guard surface (see [[fro-bot--systematic]] / [[opencode-plugins]] two-axis versioning).
  - _Prior (SHA `cd03ad8`, 2026-07-27):_ four categories (design → gemini-3.5-flash, document-review/research → gpt-5.4-mini low, review → `openai/gpt-5.5` low); agents repo-research-analyst → gpt-5.4-mini, spec-flow-analyzer → gemini-3.5-flash, systematic-implementer → `openai/gpt-5.6-luna` xhigh temp 0.1.
  - _Prior (SHA `e8ebc5c`, 2026-07-10):_ five categories (design → gemini-3.5-flash, docs → `opencode-go/kimi-k2.7-code`, document-review → gpt-5.4-mini, research → `opencode-go/minimax-m3`, review → `opencode-go/deepseek-v4-flash`); agents repo-research-analyst → `opencode-go/minimax-m3`, spec-flow-analyzer → gemini-3.5-flash, systematic-implementer → `anthropic/claude-sonnet-5` temp 0.1.

**`tui.json` reduced to theme-only (SHA `e8ebc5c`, 2026-07-10):** `tui.json` no longer carries a `plugin` array. It is now `{ "theme": "catppuccin" }` and nothing else. The separate TUI plugin stack documented through 2026-06-27 (slim/magic-context/aft/copilot-delegate) is gone — the TUI now inherits the single `opencode.json` plugin set instead of maintaining a divergent list.

#### Historical Plugin Snapshot (SHA `70c211bc`, 2026-06-06) — superseded

At `70c211bc` the auth plugin was `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (own fork), magic-context 0.22.4, aft 0.35.4, systematic 2.28.0, slim 1.1.1. A Discord MCP (`saseq/discord-mcp:1.0.0`, disabled) and inline custom `openai/gpt-5.5[-fast]` provider models were declared. All superseded by the table above.

#### Historical Plugin Snapshot (SHA `ae026c1`, 2026-04-22)

Previous stack — superseded by the table above. `oh-my-openagent` (3.17.4) and `@franlol/opencode-md-table-formatter` were removed; `oh-my-opencode-slim` replaces the multi-agent router. The Anthropic auth plugin migrated from `@ex-machina/*` to `@cortexkit/*` and downshifted from 1.7.4 to 1.2.2 (different package line). `opencode-copilot-delegate` joined the stack, consuming the sibling repo published as v0.12.0.

**MCP servers configured:**

| Server | URL | Purpose |
| --- | --- | --- |
| `context7` | `https://mcp.context7.com/mcp` | Documentation and context retrieval |
| `grep_app` | `https://mcp.grep.app` | Code search across GitHub repos |
| `tavily` | `https://mcp.tavily.com/mcp/` | Web search |
| `websearch` | `https://mcp.exa.ai/mcp` | Exa web search |

**OpenCode compaction:** `auto: false`, `prune: false` — compaction handled by magic-context plugin instead.

#### Magic Context Configuration (`.config/opencode/magic-context.jsonc`, SHA `70c211bc`, 2026-06-06)

The `opencode-magic-context` plugin (0.22.4) provides adaptive context compaction with model-specific thresholds:

- **Historian**: `openai/gpt-5.5` (fallbacks: `anthropic/claude-sonnet-4-6`, `github-copilot/claude-sonnet-4.6`) — temperature 0.1, variant medium, tool permissions hard-denied (`bash`, `webfetch`, `edit`). **Note:** Historian now uses `openai/gpt-5.5` (full, not fast) vs prior `openai/gpt-5.5-fast`.
- **Dreamer**: `anthropic/claude-sonnet-4-6` (fallbacks: `openai/gpt-5.4-mini`, `github-copilot/claude-sonnet-4.6`) — schedule `00:00-08:00`, `inject_docs: true`, `pin_key_files` (20k tokens, min 4 reads), `user_memories` (promotion threshold 3)
- **Sidekick**: disabled
- **Cache TTL**: 5m default; 59m for `anthropic/claude-sonnet-4-6`, `anthropic/claude-opus-4-6`, `anthropic/claude-opus-4-7`, **`anthropic/claude-opus-4-8`** (new)
- **Execute thresholds (%)**: 65 default; 55 for Anthropic Sonnet/Opus (4-6, 4-7); 80 for `openai/gpt-5.5`
- **Execute thresholds (tokens)**: `github-copilot/claude-opus-4.7` 80K, `github-copilot/claude-sonnet-4.6` 95K
- **Memory**: `auto_search` (min 20 chars, score ≥ 0.55), `git_commit_indexing` (365 days, max 2000 commits), injection budget 6000 tokens
- **New settings**: `temporal_awareness: true`, `caveman_text_compression: false`, `auto_drop_tool_age: 30`, `history_budget_percentage: 0.15`, `historian_timeout_ms: 420000`
- **`system_prompt_injection`**: enabled; skips injection when system prompt contains "You are the Council agent — a multi-LLM"

**Delta (SHA `a159c44`/`#1932`, 2026-06-27):** Plugin version 0.24.1 → 0.26.0. **Historian primary model switched** `openai/gpt-5.5` → **`opencode-go/deepseek-v4-flash`** — the cheap/fast `opencode-go` DeepSeek model now drives summarization, with `openai/gpt-5.5` demoted to first fallback (full chain: `gpt-5.5` → `anthropic/claude-sonnet-4-6` → `github-copilot/claude-sonnet-4.6`). New short-window cache TTLs added: `openai/gpt-5.5` and `openai/gpt-5.5-fast` both `10m`; both also gained `execute_threshold_percentage: 80`. `embedding.provider: "off"` recorded (no semantic embeddings) — consistent with the AFT `search_index`/`semantic_search` shutoff. Dreamer/Sidekick unchanged.

**Delta (SHA `4df0c2d`, 2026-06-16):** Plugin version 0.22.4 → 0.24.1. Historian/Dreamer/Sidekick model assignments unchanged. `anthropic/claude-fable-5` added to the 59m cache-TTL list (alongside Sonnet 4-6, Opus 4-6/4-7/4-8). Execute thresholds, memory, and `temporal_awareness`/`system_prompt_injection` blocks unchanged.

**Delta from prior ingest (SHA `0bb24f0`):** Historian model changed from `openai/gpt-5.5-fast` to `openai/gpt-5.5` (full model). `anthropic/claude-opus-4-8` added to 59m cache TTL. `temporal_awareness` flag added. `system_prompt_injection` block added (Council agent exclusion). Plugin version 0.21.8 → 0.22.4.

**Earlier delta (SHA `ae026c1`):** Historian migrated from `github-copilot/gpt-5.4` to `openai/gpt-5.5-fast`. Dreamer reverted to direct Anthropic model. Sidekick disabled outright. Plugin version 0.13.0 → 0.21.8.

#### oh-my-opencode-slim Routing (SHA `fe0144c`, 2026-09-10)

Config at `.config/opencode/oh-my-opencode-slim.jsonc` (plugin **2.2.11**, version held — the churn this window is entirely in the config, ~180 changed lines across #2449/#2450/#2472/#2476/#2511/#2512/#2516/#2528/#2541/#2542/#2543/#2545). **Active preset stays `mixed`** for a second survey.

**Preset roster 5 → 6.** Two new presets — **`mixed-astra`** (`openai/gpt-6-astra` orchestrator / `anthropic/claude-opus-5` oracle) and **`mixed-go`** (`claude-opus-5` orchestrator / `opencode-go/qwen3.7-max` oracle / `deepseek-v4-pro` council) — join `openai`, `opencode-go`, `mixed` (active), `mixed-fable`. Roster is now: `openai`, `opencode-go`, `mixed`, `mixed-astra`, `mixed-fable`, `mixed-go`.

**New `openai/gpt-6-astra` model line — the GPT-6 boundary (#2541/#2542).** `gpt-6-astra` takes the `mixed` **oracle** seat (`variant: medium`, raised from an initial low), the `mixed-astra` orchestrator, and the `mixed-fable` oracle. It also entered the Magic Context `cache_ttl` (30 m) and `execute_threshold_percentage` (80) tables. `gpt-5.6-sol`/`-luna`/`-terra` remain in service; `gpt-5.6-terra` no longer holds the council gamma seat.

**`mixed-fable` orchestrator → `anthropic/claude-fable-5-1`** (#2511, from `claude-fable-5`), variant lowered to `medium` (#2528).

**Active `mixed` preset agent assignments (SHA `fe0144c`, 2026-09-10):**

| Agent | Model | Notes |
| --- | --- | --- |
| orchestrator | `anthropic/claude-opus-5` | `variant: high`; skills **`["*", "!worktrees"]`** — first observed *negation* in a skills array; MCPs `["*", "!context7"]` |
| oracle | `openai/gpt-6-astra` | `variant: medium`; skills `ce:brainstorm` + **`ce:ideate`** (#2516) + `simplify` + `systematic:*` + **`reflect`** |
| council | `openai/gpt-5.6-sol` | Council routing |
| librarian | `openai/gpt-5.6-luna` | `variant: low`; MCPs `["aha","atlassian","box","context7","gh_grep","slack"]` — **four of six are unregistered**, see the MCP drift note above |
| explorer | `openai/gpt-5.6-luna` | `variant: low`; no skills/MCPs |
| designer | `openai/gpt-5.6-luna` | `variant: medium`; **moved off `github-copilot/gemini-3.5-flash`** (#2545); skills expanded to `agent-browser` + **`brand-voice`** + `content-research-writer` + `impeccable` + **`openai-imagegen`** + `systematic:*` |
| fixer | `anthropic/claude-sonnet-5` | `variant: medium` (#2512, was `openai/gpt-5.6-luna` high); skills gained **`ce:*`**, **`clonedeps`**, **`file-organizer`** |
| fast-generic | `github-copilot/gpt-5.4-mini` | `variant: low`; **now defined per-preset**, not once at the top level |

**Structural changes to the config shape (SHA `fe0144c`):**

- **Skill/MCP negation syntax is in use** — `skills: ["*", "!worktrees"]` on every orchestrator. The `worktrees` skill (added to `.config/opencode/skills/` at 2026-08-26) is explicitly withheld from the agent most likely to invoke it.
- **`fast-generic` moved into the preset shape.** The top-level `agents.fast-generic` block now carries only `prompt`, `orchestratorPrompt`, `skills`, `mcps` — the **model is set per preset** (`mixed`/`mixed-astra`/`mixed-fable`/`mixed-go` → `github-copilot/gpt-5.4-mini`; `openai` → the two-element fallback array `["openai/gpt-5.3-codex-spark", "github-copilot/gpt-5.4-mini"]`; `opencode-go` → `deepseek-v4-flash`). The 2026-08-26 "fallback array" observation is therefore narrowed: it survives only in the `openai` preset, not as a top-level property.
- **`backgroundJobs.strategy: "checkpoint-compatible"`** is new (alongside the carried `continueOnIdle: false`).
- **Council gamma moved `openai/gpt-5.6-terra` → `opencode-go/deepseek-v4-pro`** (`variant: high`); alpha `claude-opus-5` high, beta `github-copilot/gemini-3.5-flash` high.
- **New `.config/opencode/oh-my-opencode-slim/` directory** holding `designer_append.md` and `orchestrator_append.md` — per-agent prompt-append files, a surface that did not exist at 2026-08-26.
- **`.agents/skills/` grew 1 → 2**: `copilot-cli` joined by **`openai-imagegen`** (referenced by every preset's `designer`). `.config/opencode/skills/` holds at 11.

#### oh-my-opencode-slim Routing (SHA `3479589`, 2026-08-26) — superseded

Config at `.config/opencode/oh-my-opencode-slim.jsonc` (plugin **2.2.11**, in-v2 minor from 2.2.8). **Active preset flipped back `openai` → `mixed`** — reverting the 2026-07-27 flip to `openai`; `mixed` was the default through 2026-07-10 before the July experiment. The five-preset roster is unchanged (`openai`, `opencode-go`, `mixed` [active], `mixed-fable`, plus the top-level `fast-generic`). The `designer`/`fixer` skill triple `["agent-browser", "impeccable", "systematic:*"]` is unchanged.

**Anthropic line moved to `claude-opus-5` (SHA `3479589`, 2026-08-26):** the strongest-model seats migrated off `claude-opus-4-8` / `claude-sonnet-5` onto **`anthropic/claude-opus-5`**. In the active `mixed` preset it holds the **orchestrator** seat (`variant: high`); it also seats the `openai`-preset oracle and the `mixed-fable` orchestrator. OpenAI routing stays on the `gpt-5.6-*` family (`sol`/`luna`/`terra`).

**Active `mixed` preset agent assignments (SHA `3479589`, 2026-08-26):**

| Agent | Model | Notes |
| --- | --- | --- |
| orchestrator | `anthropic/claude-opus-5` | `variant: high`; all skills + MCPs except context7 |
| oracle | `openai/gpt-5.6-sol` | `variant: high`; skills `ce:brainstorm` + `simplify` + `systematic:*` |
| council | `openai/gpt-5.6-sol` | Council routing |
| librarian | `openai/gpt-5.6-luna` | `variant: low`; MCPs `context7`, `gh_grep` |
| explorer | `openai/gpt-5.6-luna` | `variant: low`; no skills/MCPs |
| designer | `github-copilot/gemini-3.5-flash` | `agent-browser` + `impeccable` + systematic skills |
| fixer | `openai/gpt-5.6-luna` | `variant: high`; `agent-browser` + `impeccable` + systematic skills |
| fast-generic | `["openai/gpt-5.3-codex-spark", "github-copilot/gpt-5.4-mini"]` | `variant: low`; **now a model fallback array** (was single `gpt-5.3-codex-spark`) — mechanical git/command work, destructive-history ops hard-banned |

**`fast-generic` gained a fallback chain (SHA `3479589`):** the top-level mechanical agent's `model` is now a two-element array `["openai/gpt-5.3-codex-spark", "github-copilot/gpt-5.4-mini"]` — a primary + Copilot fallback for the routine commit/validation delegate. The `opencode-go` preset now runs a `minimax-m3` orchestrator (`variant: thinking`) and `qwen3.7-max` oracle (`variant: max`), superseding the `kimi-k2.6`/`deepseek-v4-pro` shape.

#### oh-my-opencode-slim Routing (SHA `cd03ad8`, 2026-07-27) — superseded

Config at `.config/opencode/oh-my-opencode-slim.jsonc` (plugin **2.2.8**, major bump from 1.1.2). **Active preset flipped `mixed` → `openai`** — the first non-`mixed` default since the slim config landed. Preset roster reshuffled: the `copilot` preset was **dropped**, a new **`mixed-fable`** preset was added (`anthropic/claude-fable-5` orchestrator), leaving five presets: `openai` (active), `opencode-go`, `mixed`, `mixed-fable`. The `designer`/`fixer` skill triple `["agent-browser", "impeccable", "systematic:*"]` is unchanged across presets.

**New `gpt-5.6-*` model line (SHA `cd03ad8`, 2026-07-27):** OpenAI routing migrated onto the **`gpt-5.6`** family — `openai/gpt-5.6-sol` (orchestrator/oracle/council), `openai/gpt-5.6-luna` (librarian/explorer/fixer), `openai/gpt-5.6-terra` (council gamma). This supersedes the `gpt-5.5` / `gpt-5.4-mini` assignments recorded through 2026-07-10. The active `openai` preset now runs an `openai/gpt-5.6-sol` orchestrator (`variant: medium`) with an `anthropic/claude-sonnet-5` oracle (`variant: max`) — a cross-provider default that keeps the strongest reasoning model on the oracle seat.

**v2 config-shape additions (SHA `cd03ad8`, 2026-07-27):**
- **`agents.fast-generic`** — a new top-level custom agent on `openai/gpt-5.3-codex-spark` (`variant: low`) for routine mechanical command work (git status/diff/log recon, normal commits, no-edit validation like lint/typecheck/tests). Its prompt hard-bans destructive git history ops (amend, rebase, `reset --hard`, `clean`, force-push, branch deletion) unless explicitly requested — a guardrailed delegation target.
- **`council` block** now lives inside the slim config with a schema-driven `presets.default` (alpha `anthropic/claude-opus-4-8` variant high, beta `github-copilot/gemini-3.5-flash` variant high, gamma `openai/gpt-5.6-terra` variant xhigh).
- **`backgroundJobs.continueOnIdle: false`** — background subagents do not auto-continue on idle.

**Active `openai` preset agent assignments (SHA `cd03ad8`, 2026-07-27):**

| Agent | Model | Notes |
| --- | --- | --- |
| orchestrator | `openai/gpt-5.6-sol` | `variant: medium`; all skills + MCPs except context7/grep_app/websearch |
| oracle | `anthropic/claude-sonnet-5` | `variant: max`; skills `ce:brainstorm` + `simplify` only |
| council | `openai/gpt-5.6-sol` | Council routing |
| librarian | `openai/gpt-5.6-luna` | `variant: low`; web search MCPs (websearch, context7, grep_app) |
| explorer | `openai/gpt-5.6-luna` | `variant: low`; no skills/MCPs |
| designer | `github-copilot/gemini-3.5-flash` | `agent-browser` + `impeccable` + systematic skills |
| fixer | `openai/gpt-5.6-luna` | `variant: xhigh`; `agent-browser` + `impeccable` + systematic skills |

**`opencode-go` preset (SHA `cd03ad8`):** unchanged shape — `opencode-go/kimi-k2.6` orchestrator, `deepseek-v4-pro` oracle/council, `minimax-m3` librarian/explorer, `kimi-k2.6` designer, `deepseek-v4-flash` fixer.

#### Historical oh-my-opencode-slim Routing (SHA `e8ebc5c`, 2026-07-10) — superseded

Config was plugin 1.1.2, active preset **`mixed`** (4 presets: `openai`, `opencode-go`, `copilot`, `mixed`). The `designer`/`fixer` skill triple `["agent-browser", "impeccable", "systematic:*"]` was unchanged across all presets. Superseded by the v2 config above.

**Model migration to the `claude-*-5` / `gemini-3.5-flash` line (SHA `e8ebc5c`, 2026-07-10):** Anthropic Sonnet references moved off `claude-sonnet-4-6` onto **`claude-sonnet-5`** (fixer + council alpha), and `designer` moved off `github-copilot/gemini-3.1-pro-preview` onto **`github-copilot/gemini-3.5-flash`** across presets. The `mixed` orchestrator gained an explicit **`variant: xhigh`** (was unmarked). Fixer also gained `variant: low`.

**Active `mixed` preset agent assignments (2026-07-10 — superseded by the `openai` preset above):**

| Agent | Model | Notes |
| --- | --- | --- |
| orchestrator | `anthropic/claude-opus-4-8` | `variant: xhigh` (new); all skills + MCPs except context7 |
| oracle | `openai/gpt-5.5-fast` | `variant: high`; systematic skills only |
| council | `openai/gpt-5.5-fast` | Council routing |
| librarian | `github-copilot/gpt-5.4-mini` | `variant: low`; web search MCPs (websearch, context7, grep_app, tavily — tavily now stale, see MCP note) |
| explorer | `openai/gpt-5.4-mini` | `variant: low`; no skills/MCPs |
| designer | `github-copilot/gemini-3.5-flash` | `agent-browser` + `impeccable` + systematic skills; migrated off gemini-3.1-pro-preview |
| fixer | `anthropic/claude-sonnet-5` | `variant: low` (new); migrated off claude-sonnet-4-6 |

**Council default preset members (2026-07-10 — superseded by the schema-driven council block above):**
- alpha: `anthropic/claude-sonnet-5` (was `claude-sonnet-4-6`)
- beta: `github-copilot/gemini-3.1-pro-preview`
- gamma: `openai/gpt-5.4-mini`

**Other preset model migrations (SHA `e8ebc5c`):** `openai` and `copilot` preset fixers moved to `anthropic/claude-sonnet-5` / `github-copilot/claude-sonnet-4.6` respectively; `opencode-go` preset oracle/council now on `opencode-go/deepseek-v4-pro`, librarian/explorer on `opencode-go/minimax-m3`. Designers across presets are on `gemini-3.5-flash` (copilot/mixed/openai) or `opencode-go/kimi-k2.6` (opencode-go).

**`ce` skill removed from slim presets** (2026-06-04, commit `d9716ffc`) — CE workflow skills no longer injected by default from the OMO slim layer.

**Other preset highlights (SHA `4df0c2d`):**
- `opencode-go` preset: `opencode-go/kimi-k2.6` orchestrator, `opencode-go/deepseek-v4-pro` (oracle `variant: max`, council `variant: high`), `opencode-go/minimax-m3` for librarian/explorer (was prior minimax line), `opencode-go/deepseek-v4-flash` fixer
- `openai` preset: librarian/explorer on `openai/gpt-5.4-mini`, fixer `anthropic/claude-sonnet-4-6`
- `copilot` preset mirrors `openai` but routes librarian/explorer through `github-copilot/gpt-5.4-mini` and fixer through `github-copilot/claude-sonnet-4.6`
- `autoUpdate: false` — plugin auto-update disabled

#### Historical oh-my-opencode-slim Routing (SHA `0bb24f0`, 2026-05-24) — superseded

At the 0bb24f0 snapshot, routing details were not captured (schema transition period). The active preset was not yet confirmed in that survey. The current `mixed` preset represents the materially changed surface area.

#### opencode-doctor: SQLite DB Maintenance (new SHA `c719625`/`24a0ecb`, 2026-06-27)

The `.config/opencode/scripts/opencode-doctor.ts` diagnostic (run via `mise run opencode:doctor`) gained **SQLite session-DB health and self-reclaiming maintenance** — a durable operational fix worth recording. Root cause documented in-repo at `.dotfiles/docs/solutions/2026-06-25-opencode-sqlite-db-bloat-prune-vacuum.md`: OpenCode never prunes its session DB (`~/.local/share/opencode/opencode.db`), which had grown to **~13 GB**. `VACUUM` alone reclaims nothing because there are no free pages; the fix is to **prune old sessions first, then VACUUM**.

Two-stage capability:
- **Prune + VACUUM** (#1923) — health check plus prune-old-sessions-then-vacuum, guarded by an other-process check and a free-disk gate (free disk ≥ DB size × 1.1).
- **`--set-incremental-vacuum`** (#1926) — one-time conversion of the DB from `auto_vacuum=NONE` to `INCREMENTAL` (set the pragma, then a full rewriting VACUUM). After conversion, future prunes reclaim free pages incrementally without a full exclusive VACUUM. Reuses the prune path's safety gates via shared helpers. Reference guide at `.dotfiles/docs/opencode-doctor.md`.

This is the local-machine counterpart to the SQLite-reliability work carried in the [[fro-bot--agent]] harness build (the harness `base_version` rebase that the mise `@fro.bot/harness` pin tracks).

#### Ollama Distillation Pipeline (new SHA `e8ebc5c`, 2026-07-10)

A new local-LLM session-distillation tool joined the repo:

- **`.config/opencode/scripts/ollama-distill.ts`** (Bun script, with `ollama-distill.test.ts`) — reads recent OpenCode session transcripts directly from the `bun:sqlite` session DB, extracts text/reasoning message segments (discriminated on `kind`), chunks them, and runs local **Ollama** distillation to emit a Markdown report.
- **`.config/mise/tasks/distill`** — mise task wrapper: `mise run distill` → `bun run ~/.config/opencode/scripts/ollama-distill.ts`. Writes reports to `~/.local/state/ollama-distill/reports/`.

This pairs with the existing `opencode-doctor` SQLite maintenance work — both read the OpenCode session DB (`~/.local/share/opencode/opencode.db`) directly. The distill pipeline keeps summarization **local** (Ollama) rather than paying a hosted-model tax, consistent with the repo's cost-and-privacy posture. A `.config/opencode/agents/research.md` subagent was also added (external research via Context7/Grep.app/Exa, `edit`/`bash` denied).

#### New Repo-Scoped OpenCode Skills (`.config/opencode/skills/`, SHA `e8ebc5c`, 2026-07-10)

Six bespoke skills now live under `.config/opencode/skills/` (distinct from the single `.agents/skills/copilot-cli` bundle):

| Skill | Purpose |
| --- | --- |
| `clonedeps` | Clone dependency source into an ignored local workspace so OpenCode can inspect library internals |
| `codemap` | Generate hierarchical codemaps for unfamiliar repos (flagged expensive; explicit-invoke only) |
| `content-research-writer` | Research-backed content writing with citations, hooks, outline iteration (MIT-licensed) |
| `copilot-cloud-agent` | GitHub Copilot cloud-agent setup, CI env drift, MCP/hooks/auth troubleshooting |
| `file-organizer` | Cleanup of scattered/cluttered directories, dedup, folder restructuring |
| `simplify` | Behavior-preserving code simplification for clarity/maintainability |

**Skills trees (SHA `fe0144c`, 2026-09-10):** `.config/opencode/skills/` **holds at 11** — `clonedeps`, `codemap`, `content-research-writer`, `copilot-cloud-agent`, `deepwork`, `file-organizer`, `oh-my-opencode-slim`, `reflect`, `simplify`, `verification-planning`, `worktrees`. `.agents/skills/` **grew 1 → 2**: `copilot-cli` joined by **`openai-imagegen`**, which every preset's `designer` now loads. Note two names referenced by the OMO-slim presets that live in neither tree — `brand-voice` and `impeccable` — so they resolve from the `skills` npm package or another install path; the preset config does not validate skill names any more than it validates MCP names.

**Skills tree grew 6 → 11 (SHA `3479589`, 2026-08-26):** `.config/opencode/skills/` added five bespoke skills — `deepwork`, `oh-my-opencode-slim` (a skill mirroring the routing plugin), `reflect`, `verification-planning`, `worktrees` — joining the original six. Note the framing from 2026-07-10 ("`copilot-cloud-agent` is the likely replacement for the dropped `opencode-copilot-delegate` plugin — delegation now skill-driven") no longer holds cleanly: **`opencode-copilot-delegate@0.12.1` is back in `opencode.json`** this survey, so plugin-driven and skill-driven Copilot delegation now coexist.

#### OpenCode Runtime Env Toggles (bash exports, SHA `a159c44`, 2026-06-27)

`.config/bash/exports` adds two OpenCode runtime flags (joining the existing `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` / `OPENCODE_EXPERIMENTAL_WEBSOCKETS=true`):

- `OPENCODE_DISABLE_FFF=1`
- `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true` — disables the filesystem watcher (large home-dir working trees make the watcher expensive; consistent with the AFT search-index shutoff and `embedding.provider: "off"` — a coherent "turn off background indexing/watching" theme this survey).

#### Historical Agent Routing (SHA `ae026c1`, 2026-04-22) — superseded

Per-agent model assignments in the now-replaced `oh-my-openagent.json`:

| Agent | Model | Variant |
| --- | --- | --- |
| sisyphus | github-copilot/claude-opus-4.7 | medium |
| metis | github-copilot/claude-opus-4.7 | medium |
| momus | github-copilot/gpt-5.4 | xhigh |
| oracle | github-copilot/gpt-5.4 | high |
| multimodal-looker | github-copilot/gpt-5.4 | medium |
| librarian | github-copilot/claude-haiku-4.5 | — |
| explore | github-copilot/grok-code-fast-1 | — |

**Disabled agents:** `atlas`, `hephaestus`

**Category model assignments (new):**

| Category | Model | Variant |
| --- | --- | --- |
| visual-engineering | github-copilot/gemini-3.1-pro-preview | high |
| ultrabrain | github-copilot/gpt-5.4 | xhigh |
| deep | github-copilot/gpt-5.4 | medium |
| artistry | github-copilot/gemini-3.1-pro-preview | high |
| quick | github-copilot/gpt-5.4-mini | — |
| unspecified-low | github-copilot/claude-sonnet-4.6 | — |
| unspecified-high | github-copilot/claude-opus-4.7 | medium |
| writing | github-copilot/gemini-3-flash-preview | — |

**Other oh-my-openagent configuration:**
- `browser_automation_engine`: `agent-browser`
- `claude_code`: skills only (`skills: true`, all others `false`)
- `disabled_hooks`: context-window-monitor, preemptive-compaction, anthropic-context-window-limit-recovery, agent-usage-reminder, category-skill-reminder, comment-checker, directory-readme-injector, keyword-detector, todo-continuation-enforcer, write-existing-file-guard
- `disabled_skills`: git-master
- `hashline_edit: true`
- `sisyphus_agent`: `default_builder_enabled: true`, `planner_enabled: false`, `replace_plan: false`

**Delta from prior ingest (SHA `dbab7ad`):** All Anthropic direct models migrated to GitHub Copilot hosted equivalents. Opus upgraded from 4.6 to 4.7. `prometheus` agent removed. `atlas` and `hephaestus` disabled. `librarian` migrated from `opencode-go/minimax-m2.7` to `github-copilot/claude-haiku-4.5`. Category model assignments added for the first time. Browser automation engine, disabled hooks/skills arrays, hashline edit, and Sisyphus agent config all new additions.

#### Repo-Scoped Agent Skills (`.agents/skills/`, SHA `4df0c2d`, 2026-06-16)

| Skill | Path | Purpose |
| --- | --- | --- |
| `copilot-cli` | `.agents/skills/copilot-cli/` | Programmatic Copilot CLI delegation: auth, permissions, model selection, multi-repo `--add-dir`, JSONL output, bash-subprocess delegation pattern |

**Skills pruned (SHA `4df0c2d`):** `.agents/skills/` now holds only `copilot-cli`. The `agent-browser`, `test-driven-development`, and `writing-skills` repo-scoped skills present at SHA `0bb24f0` are gone — almost certainly because those skills are now provided by the upstream `@fro.bot/systematic@2.32.0` and `skills@1.5.11` packages (no need to vendor local copies). Only the bespoke `copilot-cli` skill, which has no upstream equivalent, remains repo-scoped.

### Devcontainer

Published pre-built image: `ghcr.io/marcusrbrown/dotfiles-devcontainer:latest`

Base image: `mcr.microsoft.com/devcontainers/base:2.1.9` (bumped from 2.1.7 @ 2026-07-10; unchanged @ 2026-09-10). Remote features: `common-utils:2.5.9`, `github-cli:1.1.2` (was 1.1.1), `node:2.1.0`, `lukewiwa/shellcheck:0.2.3`, `schlich/starship:0`.

#### The `remoteEnv` `GIT_DIR` leak (SHA `fe0144c`, 2026-09-10) — the interval's hardest failure

`devcontainer.json` used to set `GIT_DIR`/`GIT_WORK_TREE` in `remoteEnv`, which looks like the natural implementation of the bare-repo pattern and is the one place it must never go. `remoteEnv` applies to **every remote process**, including `postCreateCommand`. The defect was latent for as long as that file existed and detonated on **2026-09-01**, when mise `2026.9.0` began resolving Python's version list by cloning pyenv and running `python-build --definitions` — its first internal `git` invocations in this container. Those calls were redirected at the dotfiles bare repo, the pyenv tree never landed at the expected path, and mise executed a binary that did not exist. `Devcontainer CI` — a **required check with `enforce_admins: true`** — failed 8 consecutive runs (last pass 12:35, first failure 12:37) and blocked every open PR for ~2 days.

Three things make this worth carrying forward:

1. **A dependency release produced a repository regression with no repository commit.** The devcontainer installed mise via unpinned `curl https://mise.run | sh`, so it adopted the new upstream behavior the day it shipped. The `MISE_VERSION` pin that existed in `.github/workflows/main.yaml` covered only the separate `jdx/mise-action` job — which is exactly why that job stayed green while the container died, and why the green job was misleading rather than reassuring.
2. **Eight plausible hypotheses were tested and disproven** against the published image before the answer landed — including "mise 2026.9.x is broken," GitHub API rate limiting, `vscode`-user permissions, `~/.cache` ownership, the `pipx`/`poetry` chain, `cacheFrom` baking a partial pyenv checkout, and a repository change. One near-miss is recorded on purpose: an early grep appeared to show the last passing run on mise `2026.8.25`, but that string was `pbs-installer==2026.8.25`, a pipx dependency — treating the grep hit as fact would have anchored the whole investigation on a false timeline.
3. **The diagnostic is a single-variable flip**, and it is cheap: run the same command twice in the same container changing only the environment (`env -u GIT_DIR -u GIT_WORK_TREE mise install` vs `GIT_DIR=… mise install`). If only the second fails, it is a process-wide git-env leak, not a defect in the tool being blamed.

Fixes, all in this window:

- `remoteEnv` reduced to `GH_TOKEN` only, with the reason committed inline (#2488). The dotfiles clone is unaffected — `features/dotfiles-dev/install.sh` generates a `post-create.sh` that sets both variables **process-locally**, and each `postCreateCommand` runs as its own `/bin/sh -c`, so that export never reaches `mise install`.
- `MISE_VERSION` pinned **forward** to the release that exposed the bug (now `2026.9.4`), not backward — pinning backward would mask the cause behind a stale toolchain.
- `UV_VERSION 0.12.10` pinned via a versioned URL (the uv installer bakes its version in, so an env var does not work) and `STARSHIP_VERSION v1.26.0` via `-v` (#2497).
- Both feature scripts moved `set -e` → **`set -eo pipefail`**, with the reason inline: a versioned URL that 404s pipes an empty script into `sh`, which exits 0 and would hide a bad pin.
- The Renovate `_VERSION` custom manager's `managerFilePatterns` extended to cover `.devcontainer/features/mise/install.sh` and `.devcontainer/features/dotfiles-dev/install.sh`. A `# renovate:` comment alone does not make a version managed — before this, nothing watched the new pins and they would have drifted against the copy in `main.yaml`. (Confirmation that this took: open PR #2560 is Renovate proposing `astral-sh/uv` → v0.12.12.)

Custom features in `.devcontainer/features/`:

| Feature        | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `dotfiles-dev` | Clones bare repo, checks out main, generates `post-create.sh` |
| `mise`         | Installs mise, runs `mise install` post-create                |
| `sheldon`      | Installs Sheldon zsh plugin manager                           |
| `keychain`     | SSH/GPG key agent management from GitHub releases             |

Feature dependency chain: `common-utils` -> `sheldon`, `keychain` -> `dotfiles-dev` -> `mise`

Remote features: `common-utils`, `github-cli`, `node`, `shellcheck`, `starship`.

Container env sets all XDG directories, `GIT_DIR`, `GIT_WORK_TREE`, `GNUPGHOME`, `ZDOTDIR`.

Host requirements: 4 CPUs. Workspace mounted as Docker volume for performance.

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Main | `main.yaml` | push/PR/release/dispatch | Devcontainer CI + mise install validation + **Script Tests matrix (ubuntu + macOS, Bun)** |
| Fro Bot | `fro-bot.yaml` | PR/issue/comment/schedule/dispatch | AI-powered review, triage, daily maintenance |
| Renovate | `renovate.yaml` | (reusable from `bfra-me/.github`) | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | (reusable from `bfra-me/.github`) | Probot settings sync |

### Main Workflow Jobs

1. **Devcontainer CI** — Builds devcontainer image, pushes to GHCR on push/release, uses `cacheFrom` for PR builds. Runs `devcontainer-info` as smoke test.
2. **Install mise** — Checks out repo, installs mise via `jdx/mise-action@v4.3.0`; `MISE_VERSION` pinned to **`2026.9.4`** as of SHA `fe0144c` (was `2026.8.14`). Renovate tracks the action, the `MISE_VERSION` env var, and (new this window) the same marker inside the two devcontainer feature install scripts.

   **`cache: false` — a cache that defeated the verification it wrapped (#2503, 2026-09-04).** The job's whole purpose is to prove every tool in `.config/mise/config.toml` installs cleanly; **a cache hit skips the install being verified**, so the job could pass without ever exercising the thing under test. The second failure mode was worse and is the transferable one: keyed on mise version × config hash × ref, the cache accumulated **nine ~993 MB entries — 8.9 GB of the repo's 10 GB budget** — and LRU-evicted every other cache in the repository, including the **~40 KB agent session caches that carry continuity between Fro Bot runs**. A 993 MB entry and a 40 KB entry compete on equal terms in an LRU eviction over a shared quota; the large one always wins and the small, high-value one always loses. The rationale is committed as a comment above the step so the next person to "optimize" the job reads the reason first. Cataloged in [[github-actions-ci]].
3. **Script Tests (matrix) — durable, second survey (SHA `fe0144c`, 2026-09-10: Bun bumped `1.4.0` → **`1.4.2`** in lockstep with the mise pin; structure otherwise byte-stable).** Introduced at SHA `3479589` (`ci: run the script tests on macOS as well as Linux`, #2432) as a `script-tests-matrix` job running on `[ubuntu-latest, macos-latest]` (`fail-fast: false`). Each leg: sets up Bun via `oven-sh/setup-bun@v2.2.0`, verifies `lsof` is present, then runs `bun test opencode-doctor.test.ts` and `bun test ollama-distill.test.ts` under `.config/opencode/scripts`. Tests needing a real OpenCode server binary self-skip when none resolves — no runner is installed in CI. A separate **`Script Tests` aggregator job** (`needs: [script-tests-matrix]`, `if: always()`) collapses the per-leg matrix names into one stable status context so branch protection has a single required check to bind to (a required matrix leg name would never report and would block every PR). This is the **first CI-enforced unit-test surface** for the repo's Bun/TypeScript operational scripts (`opencode-doctor`, `ollama-distill`), and the first cross-platform (macOS) CI leg. The scripts dir gained a `lib/` subdirectory and `tsconfig.json` to support the test harness.

### Branch Protection

Required status checks on `main`: Devcontainer CI, Fro Bot, Install mise, Renovate, and **Script Tests** (the matrix aggregator context, SHA `3479589`). Linear history enforced, **admin enforcement enabled** (`enforce_admins: true`), no required PR reviews. _2026-09-10: not re-read directly — the survey token gets `403 Resource not accessible by integration` on the branch-protection endpoint. Carried from the 2026-08-26 reading and independently corroborated by `docs/solutions/2026-09-03-devcontainer-git-dir-leak-mise-pyenv.md`, which cites `Devcontainer CI` as "a required check with `enforce_admins: true`" that blocked every open PR for the duration of the outage._

### Workflow health (SHA `fe0144c`, 2026-09-10)

Four active workflows plus the dynamic `copilot-swe-agent` entry; none `disabled_inactivity` (contrast [[marcusrbrown--cortexkit-anthropic-auth]]). `Main` is green across its last 10 runs on both `push` and `pull_request` — the 8-run `Devcontainer CI` outage of 2026-09-01 → 09-03 is fully closed.

`Fro Bot` is **15/15 `success` on scheduled runs** (2026-08-26 → 2026-09-09, `30 15` UTC, with two 19:xx stragglers on 08-27/08-28) and files a daily report. But across the last **100** runs of that workflow the conclusions break down as **65 `pull_request`/skipped, 30 `issues`/skipped, 2 `issue_comment`/skipped, 2 `schedule`/success, 1 `pull_request`/success** — i.e. **97 of 100 runs did no work**. The cause is benign and by design: the job-level trust gate blocks bot-authored PRs and issues, and the trigger surface is ~100% `mrbro-bot[bot]` Renovate traffic. This is the same census recorded at [[marcusrbrown--tokentoilet]] (98/100 skipped), and it means a "Fro Bot is healthy" claim resting on overall run conclusions is measuring almost nothing — only the 2 scheduled runs are evidence. The difference from tokentoilet is that here the executing half **does** deliver, because the prompt fix below restored its PR path.

## Fro Bot Integration

**Fro Bot workflow present** (`fro-bot.yaml`). Uses **`fro-bot/agent@v0.109.4`** (SHA `b799b64d102584774af338ddd26a4803d73ae192`) as of SHA `fe0144c` — bumped v0.105.0 → v0.109.4 this window (was `335e4f8`, v0.105.0). Single-file three-mode pattern; the workflow reads its model from the `FRO_BOT_MODEL` repo variable. `actions/checkout` holds at v7.0.1 (`3d3c42e`). The repo remains an **ecosystem version leader — and is now ahead of the control plane**: the [[github-actions-ci]] pass of the same date recorded six `fro-bot/agent` pins in `fro-bot/.github` frozen at v0.109.0 by a patch-suppression Renovate rule, while this repo (which has no such rule) is on v0.109.4. Single daily cron `30 15` (15:30 UTC) — the maintenance/oversight pass.

**The prompt changed materially this window (#2498, #2506) — first non-pin `fro-bot.yaml` body change since onboarding.** Two classes of edit:

1. **Delivery-path repair.** Category 3 (CONFIG QUALITY & REPO HYGIENE) previously said *"If drift is found, open a PR with corrections"* and then *"Report findings but put actual fixes into category 4"* — and category 4 (DEVELOPER EXPERIENCE) is report-only. The cross-category handoff moved the work but not the permission, so for **five consecutive runs** the agent detected the same 3-line `AGENTS.md` drift, edited the ephemeral Actions checkout, and honestly reported it fixed; report #2474 escalated it as *"a caller-workflow bug, not a content problem."* It was a prompt bug. The replacement names the mechanism as steps, keeps the exception in place, and **states the failure mode in the prompt itself**:

   > If drift is found, deliver the correction: create a branch, commit it, push, and open a PR. This is the one exception to this category's report-only default, so do not defer it to another category. Editing the working tree without opening a PR does not persist and will silently recur every run.

   It also adds a standing verification invariant: *"Before documenting shell load order, verify it against a live shell rather than reading the files — several scripts under `.config/bash/` have no referrer and never execute."*

2. **Dead-convention scrub.** Every reference to `init.d/` numbered prefixes and `local.d/` machine-local overrides is gone from the PR-review prompt, the maintenance prompt, and the hard-boundaries block — replaced by `.config/bash/exports` / `.config/bash/aliases` and `*.local` files. `.dotfiles/.gitignore` → `.dotfiles/ignore` throughout. This closes the third-order consequence of the dormant subsystem: the agent had been **teaching the dead conventions forward** in every review it wrote.

Two transferable rules from this, both cataloged in [[github-actions-ci]]: *a repeated identical "fixed" report is a missing delivery path, not a flaky one* (a flaky commit step produces intermittent success; a closed delivery path produces a perfectly consistent no-op), and *be skeptical of an agent's diagnosis of its own harness* — it can see that it made an edit and that the edit is gone, but not that its instructions never permitted the edit to leave the container.

Triggers: PR events (opened, synchronize, reopened, ready_for_review, review_requested), `issues` (opened, edited), `issue_comment`, `pull_request_review_comment`, daily schedule (15:30 UTC), `workflow_dispatch` with a required `prompt` input.

Concurrency: grouped by issue/PR number (with `github.run_id` fallback for schedule/dispatch), cancellation disabled.

**Stale-report cleanup:** A dedicated `Close stale daily reports` step runs on `schedule` only — queries open `fro-bot`-authored issues matching `Daily Maintenance Report in:title`, finds entries older than 3 days, and auto-closes them with reason `not planned`. Cross-platform `date -u -d` / `date -u -v-3d` fallback keeps the step portable.

**PR review prompt** (PR_REVIEW_PROMPT env) includes dotfiles-specific checks: **`.dotfiles/ignore` allowlist verification** (renamed from `.gitignore` @ 2026-09-10), shell startup correctness, macOS/Linux portability, security (no secrets — machine-specific config belongs in `*.local` files), convention compliance (shared env vars in `.config/bash/exports`, XDG, GPG signing, `dev.mrbro.*` LaunchAgents), devcontainer impact. _Superseded @ 2026-09-10: the "numbered `init.d`, `local.d`" convention checks were removed — they described a subsystem that had not executed since 2024._ Output structure is locked: required headings are `## Verdict` (`PASS | CONDITIONAL | REJECT`), `### Blocking issues`, `### Non-blocking concerns`, `### Security check`, `### Risk assessment`. Sections with no findings must render as `None`.

**Scheduled maintenance prompt** (SCHEDULE_PROMPT env) covers 6 categories — Errored PRs, Security, Config Quality & Repo Hygiene, Developer Experience (now report-only — "Formatting is handled manually by the repo owner"), Devcontainer & CI Health, Cross-Project Progressive Improvement (observation-only survey of all `marcusrbrown` repos). Single-issue daily report titled `Daily Maintenance Report — YYYY-MM-DD (UTC)`, with explicit table schemas for each category and explicit "do not query Dependabot/vulnerability-alert APIs" guard (Marcus's PAT is a collaborator token on user-owned repos and those endpoints 404 by design).

**Hard boundaries:** never force-push, never push directly to default branch, never merge PRs, never weaken tests/lints to make checks pass, do not modify `.github/workflows/`, shell init files, devcontainer config, or automation prompts unless it's a genuine bug fix with narrow scope. Cross-project monitoring (category 6) is strictly observation-only — no PRs, issues, comments, or clones in other repos.

**Author/trust gating** in the job-level `if`: forks blocked, bot-authored PRs/issues blocked, comment mentions only honored from `OWNER`/`MEMBER`/`COLLABORATOR` associations.

### Renovate

Extends **`marcusrbrown/renovate-config#5.2.13`** (was `#5.2.12` @ 2026-08-26) + `sanity-io/renovate-config:semantic-commit-type`. Major version crossed the v4→v5 boundary documented in [[marcusrbrown--renovate-config]] (2026-05-13). Two custom managers:

1. `_VERSION` regex manager, **scope widened @ 2026-09-10 (#2497)** from mise config files alone (`(^|/)\.?mise\.toml$`, `(^|/)\.?mise/config\.toml$`) to also cover `(^|/)\.devcontainer/features/mise/install\.sh$` and `(^|/)\.devcontainer/features/dotfiles-dev/install\.sh$`, with the description updated to say so. This is the rule that makes the three new `curl | sh` pins (`MISE_VERSION`, `UV_VERSION`, `STARSHIP_VERSION`) actually managed. The generalizable point is recorded in the repo's own postmortem: **a `# renovate:` comment alone does not make a version managed** — confirm a manager's file pattern covers the file (Renovate's debug log reports which files each manager matched), because an unmatched marker is worse than no marker, looking managed during review while drifting in practice. Same wrong-target class as the mis-pathed `uses:` case at [[marcusrbrown--esphome-life]], caught here at authoring time instead of ~100 commits later.
2. Pinned npm plugin version manager for `(^|/)\.config/opencode/opencode\.json$` and `tui\.json` — matches `"name@x.y.z"` patterns to surface OpenCode plugin updates. **Enhanced (2026-05-29):** Now uses semver versioning strategy and supports cross-series prerelease upgrades (e.g., `@marcusrbrown/opencode-anthropic-auth` mb.1 → mb.2 → mb.3 prerelease series).

Package rules:

- Patch updates enabled for `devcontainer`, `dockerfile`, `docker-compose`, `mise`.
- Devcontainer feature PRs get a custom commit topic and PR body columns (Package/Type/Update/Change/References) with rewritten links.
- Base image digest pinning disabled for `mcr.microsoft.com/devcontainers/base` (branch automerge, dashboard-approved).
- Renovate updates disabled for `@anthropic-ai/claude-code` and `opencode-ai` (manually managed).
- Automerge of unstable minor/patch (`v0.x`) updates for `@cortexkit/aft*`, `@cortexkit/*magic-context`, `fro-bot/agent`, `@franlol/opencode-md-table-formatter`, `agent-browser`, `ast-grep`, `opencode-copilot-delegate` — extends `bfra-me/renovate-config:automerge.json5#5.2.7` (was `#5.2.1` @ 2026-07-27).

Settings: `prCreation: immediate`, `rebaseWhen: behind-base-branch`, ignores `mergeConfidence:age-confidence-badges` and `mergeConfidence:all-badges` presets.

### Probot Settings

Extends `fro-bot/.github:common-settings.yaml`. Confirms membership in the Fro Bot-managed ecosystem.

## Notable Patterns

- **Documentation as a lagging indicator (2026-09-10):** the interval's four postmortems share one shape — a plausible-looking artifact that never executes, reported as working by something that could not observe the difference. A dormant shell subsystem, an ignore file read at the wrong anchor, an agent editing a checkout that gets discarded, and a cache hit standing in for the install it was supposed to verify. All four passed inspection; none survived execution. The repo's own conclusion, worth quoting: *"Dormant configuration is worse than absent configuration because it absorbs work that appears to succeed. Absent config produces an error; dormant config accepts the edit, reports nothing, and does nothing."*
- **Salvage-then-delete, in separate commits (2026-09-10):** removing 26 dormant files was split into #2504 (salvage the four values the dead scripts were supposed to set) and #2506 (delete). Salvage changes behavior; deletion does not. Separated, either reverts alone. The repo also declined to *restore* the subsystem — reviving it would have activated 967 days of untested behavior at once (a prompt competing with starship, `gcloud`/`nix`/`p4`/`rvm` init for tools that are not installed, and an `ssh-agent` script that would have overwritten gpg-agent's `SSH_AUTH_SOCK`).
- **Scrub dead names from reference docs; never from failure records (2026-09-10):** a first pass at the cleanup rewrote the *learning* docs too, replacing `init.d/pager.bash` and `local.d/discord.bash` with prose like "a former entry point" — deleting the evidence those docs existed to preserve. The test is whether a document **recommends** the path or **explains why it failed**.
- **Bare git repo without symlinks:** The entire `$HOME` is the working tree. No stow, chezmoi, or rcm — just native git with an allowlist ignore pattern. Requires discipline but avoids all symlink tooling.
- **XDG compliance:** All configs under `~/.config/`, data under `~/.local/share/`, cache under `~/.cache/`. Even in devcontainer, XDG vars are explicitly set.
- **Deferred Zsh loading:** Sheldon + zsh-defer pattern for fast shell startup. Plugins loaded lazily after the prompt renders.
- **Znap eval pattern:** Mise, starship, and rustup activated via `znap eval` for cached initialization — avoids re-evaluating `eval "$(tool init zsh)"` on every shell start.
- **Multi-agent AI setup:** Both Claude Code and OpenCode configured with project-specific rules and agents. AGENTS.md serves as the canonical knowledge base.
- **Published devcontainer image:** Pre-built image on GHCR enables fast Codespaces and cross-machine parity.
- **Cross-project health monitoring:** Fro Bot's scheduled prompt includes observation-only scanning of all `marcusrbrown` repos for CI health, missing workflows, and stale PRs.
- **Copilot-hosted model routing:** _Recorded 2026-04-22, long since superseded._ At that snapshot all OpenCode agents routed through `github-copilot/*` hosted models. Routing has since oscillated across `anthropic/*`, `openai/*`, `opencode-go/*`, and `github-copilot/*` several times per quarter (see the OMO-slim routing sections). As of 2026-09-10 the active `mixed` preset is genuinely mixed: `anthropic/claude-opus-5` orchestrator, `openai/gpt-6-astra` oracle, `openai/gpt-5.6-luna` librarian/explorer/designer, `anthropic/claude-sonnet-5` fixer, `github-copilot/gpt-5.4-mini` fast-generic. The durable observation is not any particular provider — it is that **model routing is the fastest-churning surface in the repo**, and that finding 7 above supplies a first non-preference reason to prefer one family: explicit prompt-cache anchoring only reaches Anthropic-family models.

## Cross-References

- Shares [[mise]] tooling and Renovate config patterns with [[marcusrbrown--ha-config]]. The mise 2026.9.0 pyenv-resolution change recorded here is an upstream behavior shift with fleet reach — see [[mise]]
- Consumes [[marcusrbrown--systematic]] as `@fro.bot/systematic@3.16.5` via OpenCode plugin slot (was 3.15.0; steady v3 minor train, `workflow_guard` held); cross-confirmed downstream at [[fro-bot--systematic]]
- **First consumer-side sighting of [[pi-coding-agent]]:** `.config/cortexkit/magic-context.jsonc` and `aft.jsonc` now carry sibling `"opencode"` / `"pi"` model blocks. The multi-harness split documented source-side at [[marcusrbrown--systematic]] has reached a third-party plugin's config schema
- Consumes [[fro-bot--agent]] both as the `fro-bot/agent@v0.109.4` workflow action (was v0.105.0) and as the `@fro.bot/harness@1.18.29-harness.88b6b5fb` CLI build pinned in mise (harness base `1.18.29`); stock `opencode-ai` still absent, so the harness build remains the sole OpenCode binary. Its `applyCaching()` family gate is the subject of finding 7 above
- [[marcusrbrown--opencode-copilot-delegate]] consumed as a headless OpenCode plugin (`opencode-copilot-delegate@0.12.1`, held for a second survey); coexists with the `copilot-cli` / `copilot-cloud-agent` skills
- Anthropic auth: on upstream `@cortexkit/opencode-anthropic-auth@1.22.0` (was 1.19.1 @ 2026-08-26); Marcus's fork [[marcusrbrown--cortexkit-anthropic-auth]] remains unconsumed here across six surveys — and that fork's own workflow is now `disabled_inactivity`, so the fork is doubly dormant. Companion `@cortexkit/opencode-openai-auth@0.7.1` (was 0.6.3) backs the OpenAI routing
- Shares the `impeccable` design-lint skill with [[fro-bot--dashboard]] (dotfiles wires it into OMO-slim `designer`/`fixer` agents; dashboard, as of its 2026-07-23 survey, now vendors the same skill in-repo at `.agents/skills/impeccable/` plus an Impeccable OpenCode plugin at `.opencode/impeccable/`, alongside its CI Design Check). Both repos also independently closed an agent **delivery break** — dashboard at the workflow layer (output-mode + credential scoping), dotfiles at the prompt layer
- Tracks [[marcusrbrown--renovate-config]] at v5.2.13 (was v5.2.12; v4→v5 boundary crossed)
- Both repos extend `fro-bot/.github:common-settings.yaml` for Probot settings
- Both repos use reusable workflows from `bfra-me/.github`
- Dotfiles devcontainer features could be consumed by other repos via the published GHCR image

## Survey History

| Accessed   | SHA       | Highlights                                                                                                                                                     |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-18 | `2f2d1e6` | Initial survey: bare repo, devcontainer, agent v0.40.2, Renovate 4.5.8                                                                                         |
| 2026-04-21 | `dbab7ad` | Incremental: tool version bumps                                                                                                                                |
| 2026-04-22 | `ae026c1` | OpenCode model routing overhaul (Anthropic → Copilot), magic-context 0.13.0, copilot-cli skill added                                                           |
| 2026-05-24 | `0bb24f0` | Agent v0.41.3 → v0.44.3, Renovate preset 4.5.8 → 5.2.0 (major boundary), `oh-my-opencode-slim` replaces `oh-my-openagent`, `opencode-copilot-delegate` consumed, custom OpenAI gpt-5.5 models declared, `gitleaks` added, `agent-browser` skill added, stale-report auto-close step |
| 2026-06-06 | `70c211bc` | Agent v0.44.3 → v0.55.1 (18 version jumps in 71 commits), auth plugin switched to `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (own fork), default model `opencode-go/kimi-k2.6` declared, `oh-my-opencode-slim` 4-preset config with active `mixed` preset (Opus 4-8 orchestrator), Discord MCP added (disabled), `aft.jsonc` + `systematic.jsonc` config files added, general/explore agents disabled, `ce` skill removed from slim presets, Renovate semver + cross-series prerelease support, magic-context 0.21.8 → 0.22.4 (temporal_awareness, system_prompt_injection) |
| 2026-06-16 | `4df0c2d` | Agent v0.55.1 → v0.65.0; `@fro.bot/harness@1.17.6-harness.13169873` added to mise (harness-as-default cutover mirror); **auth plugin reverted** to upstream `@cortexkit/opencode-anthropic-auth@1.9.2` (fork dropped — contradiction noted); **license now undetectable** (API 404, no LICENSE file — was The Unlicense); Discord MCP + inline custom `openai/gpt-5.5[-fast]` provider models removed from `opencode.json`; magic-context 0.22.4 → 0.24.1 (claude-fable-5 cache TTL), aft 0.35.4 → 0.39.2 (`bridge.hang_threshold`), systematic 2.28.0 → 2.32.0, slim 1.1.1 → 1.1.2 (mixed preset librarian → `github-copilot/gpt-5.4-mini`); `.agents/skills/` pruned to `copilot-cli` only; tool bumps (pnpm 11.6.0, npm 11.17.0, python 3.14.6, biome 2.5.0, opencode-ai 1.17.4) |
| 2026-06-27 | `debcb8e` | Agent v0.65.0 → v0.79.1 (14 minors, web-operator wave); `@fro.bot/harness` 1.17.6 → 1.17.9-harness.bd89c818 (aligns with agent base rebase); **license still undetectable** (2nd consecutive survey, `licenseInfo: null`); **opencode-doctor gains SQLite DB prune+VACUUM + `--set-incremental-vacuum`** (fixes ~13 GB session-DB bloat); magic-context 0.24.1 → 0.26.0 with **historian → `opencode-go/deepseek-v4-flash`** (gpt-5.5 demoted to fallback); AFT `search_index`/`semantic_search` disabled + `embedding.provider: off`; OMO-slim `designer`/`fixer` standardized on `agent-browser`+`impeccable`+systematic skills; auth 1.9.2 → 1.10.3, aft 0.39.2 → 0.39.4, systematic 2.32.0 → 2.32.1; new bash OpenCode env toggles (`OPENCODE_DISABLE_FFF=1`, `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true`); `mise-action@v4.2.0`/`MISE_VERSION 2026.6.14`; tool bumps (node 24.18, pnpm 11.9, deno 2.9, biome 2.5.1, agent-browser 0.29.1, copilot 1.0.64); stars 18 → 20, open issues 4 → 6 |
| 2026-07-27 | `cd03ad8` | Agent v0.84.3 → v0.95.0; `actions/checkout` v6.0.3 → v7.0.1; `@fro.bot/harness` 1.17.14 → **1.18.5-harness.3a55d7d2** and stock `opencode-ai` 1.17.12 → 1.18.5 (**realigned in lockstep on base 1.18.5**); **license still undetectable** (4th consecutive survey); **`oh-my-opencode-slim` v1→v2 major** (1.1.2 → 2.2.8) — **active preset flipped `mixed` → `openai`**, `copilot` preset dropped, new `mixed-fable` preset added; new **`openai/gpt-5.6-*` model line** (sol/luna/terra) + `gpt-5.3-codex-spark`; new top-level `agents.fast-generic` mechanical agent; council block moved into slim config; `backgroundJobs.continueOnIdle: false`; **`@fro.bot/systematic` v2→v3 major** (2.33.2 → 3.3.0), `systematic.jsonc` retuned to v3 schema (4 categories, systematic-implementer → `openai/gpt-5.6-luna`); **new `@cortexkit/opencode-openai-auth@0.4.3` plugin**; auth 1.13.0 → 1.18.0, magic-context 0.31.5 → 0.33.0, aft 0.46.0 → 0.48.1; `opencode.json` gained `"snapshot": false`; tool bumps (rust 1.97.1, deno 2.9.4, pnpm 11.17.0, ast-grep 0.44.1, biome 2.5.5, prettier 3.9.6, cargo-binstall 1.21.1, agent-browser 0.33.0, skills 1.5.20, copilot 1.0.74, claude-code 2.1.163, tsx 4.23.1); stars 20 (unchanged), open issues 6 → 5 |
| 2026-08-26 | `3479589` | Agent v0.95.0 → **v0.105.0** (crosses cosmetic v0.100); `@fro.bot/harness` 1.18.5 → **1.18.21-harness.22dee0ee**; **stock `opencode-ai` dropped from mise** (harness build sole OpenCode CLI); **license still undetectable** (5th consecutive survey); **new CI Script Tests matrix** (ubuntu + macOS, Bun 1.4.0) running `opencode-doctor.test.ts`/`ollama-distill.test.ts` + stable aggregator status context (#2432, first CI unit-test surface + first macOS leg); mise: **`puppeteer`/`vibe-tools` dropped**, `pipx` pinned, node 24.19.0/rust 1.98.0/go 1.27.0/bun 1.4.0/pnpm 11.22.0/deno 2.9.5/biome 2.5.10/tsx 4.23.12/playwright 1.62.1/copilot 1.0.80/agent-browser 0.34.0/ocx 2.0.15; **`opencode-copilot-delegate@0.12.1` re-added** to `opencode.json` (reverses 2026-07-10 drop); **OMO-slim active preset flipped back `openai` → `mixed`** (2.2.11), Anthropic seat → **`claude-opus-5`** (mixed orchestrator), `fast-generic` now a model fallback array; **MCP 3 → 2** (`websearch`/Exa removed, `grep_app` renamed `gh_grep`); systematic 3.3.0 → **3.15.0** (+`workflow` category, +`workflow_guard` block, systematic-implementer → `opencode-go/gpt-5.6-luna`); auth 1.18.0 → 1.19.1, openai-auth 0.4.3 → 0.6.3, magic-context 0.33.0 → 0.38.1, aft 0.48.1 → 0.52.1; skills tree 6 → 11 (+deepwork/oh-my-opencode-slim/reflect/verification-planning/worktrees); Renovate preset 5.2.0 → 5.2.12; mise-action v4.2.0 → v4.3.0, MISE_VERSION 2026.7.5 → 2026.8.14; stars 20, open issues 5 → 6 (+#2434 docs allowlist) |
| 2026-09-10 | `fe0144c` | **The interval the repo audited itself** — 115 commits (75 bot / 40 `marcusrbrown`), 57 files, four new `docs/solutions/` postmortems in eight days. **(1) A shell subsystem documented as live had not run since 2024-01-10 — 967 days**: 26 of 28 files under `.config/bash/` had no referrer, `DOTNET_CLI_TELEMETRY_OPTOUT` never applied, both READMEs pointed credentials into a void, and the Fro Bot prompt taught the dead conventions forward; salvaged (#2504) then deleted (#2506). **(2) `.dotfiles/.gitignore` → `.dotfiles/ignore`** (#2434/#2435) — the old name was read twice, the second time anchored to `.dotfiles/`, silently voiding allowlist entries. **(3) `remoteEnv` `GIT_DIR` leak broke `Devcontainer CI` 8 consecutive runs** (09-01 → 09-03, required + `enforce_admins`) with no repo change, when mise 2026.9.0 started shelling out to `git` for pyenv; fixed by dropping the vars (#2488) and pinning `MISE_VERSION` **forward** to 2026.9.4. **(4) Pinned `curl \| sh` installers moved to `set -eo pipefail`** (a 404'd versioned URL pipes an empty script into `sh`, exit 0) + `UV_VERSION 0.12.10` / `STARSHIP_VERSION v1.26.0`, with the Renovate `_VERSION` manager widened to the feature scripts (#2497). **(5) `Install mise` cache disabled** (#2503) — it skipped the install it existed to verify **and** hoarded 8.9 GB of a 10 GB budget in nine ~993 MB entries, LRU-evicting the ~40 KB agent session caches. **(6) The maintenance prompt forbade its own fix path** — 5 days of "fixed" reports that never persisted, because category 3 routed fixes to report-only category 4; repaired with concrete delivery steps + an in-prompt statement of the failure mode (#2498). **(7) Prompt-cache anchoring is Anthropic-family-only** (`anomalyco/opencode#48246`): claude 100% reuse vs gpt-6-astra 92.1% / gpt-5.6-sol 64.9%, and `github-copilot` serves Claude at 100% while serving its own models at 80–91% — a family split, not a provider split. **(8) `.config/cortexkit/` — `magic-context.jsonc`/`aft.jsonc` return** (deleted 2026-07-10) with **per-harness `"opencode"`/`"pi"` model blocks** (first consumer-side [[pi-coding-agent]] sighting) and a nine-task dreamer cron scheduler. **(9) Stale MCP refs return four-deep** (`aha`/`atlassian`/`box`/`slack` in every preset's `librarian.mcps`, none registered) — the 2026-08-26 "fixed in lockstep" was incidental. **(10) Four mise majors**: npm 11 → **12.0.2**, pnpm 11 → **12.3.4**, typescript 6 → **7.0.2**, typescript-language-server 5 → **6.0.0**; node 24.21.0, go 1.27.1, rust 1.98.1, bun 1.4.2, deno 2.9.6, ast-grep 0.45.3, shfmt 3.14.1, biome 2.5.12. Agent v0.105.0 → **v0.109.4** (ahead of the control plane's frozen v0.109.0 pins); harness → **1.18.29-harness.88b6b5fb**; systematic → **3.16.5**; auth 1.22.0 / openai-auth 0.7.1 / magic-context 0.41.4 / aft 0.55.1. OMO-slim presets 5 → **6** (`mixed-astra`, `mixed-go`; `mixed` still active), new **`openai/gpt-6-astra`** line, `mixed-fable` → `claude-fable-5-1`, orchestrator skills gained a negation (`["*", "!worktrees"]`), `fast-generic` moved per-preset, `backgroundJobs.strategy: "checkpoint-compatible"`, new `oh-my-opencode-slim/{designer,orchestrator}_append.md`. `systematic.jsonc` routed back to Copilot + `claude-sonnet-5`. `.agents/skills/` 1 → 2 (+`openai-imagegen`). Renovate preset 5.2.12 → 5.2.13. **License still undetectable (6th consecutive survey)**; stars 20, open count 7 (fully rotated); Fro Bot 15/15 scheduled green but **97 of last 100 runs `skipped`** |
| 2026-07-10 | `e8ebc5c` | Agent v0.79.1 → v0.84.3; `@fro.bot/harness` 1.17.9 → 1.17.14-harness.e98fbc0f; **license still undetectable** (3rd consecutive survey); **`magic-context.jsonc` and `aft.jsonc` config files deleted** — both plugins now run on defaults; `tui.json` reduced to theme-only (plugin array dropped); `opencode.json` **default `"model": opencode-go/kimi-k2.6` removed** (routing deferred to OMO-slim presets); **`tavily` MCP removed** (4→3 servers; websearch Exa moved key/tools to URL query — OMO librarian tavily ref now stale); **`opencode-copilot-delegate` plugin dropped** from opencode.json/tui.json; auth 1.10.3 → 1.13.0, magic-context 0.26.0 → 0.31.5, aft 0.39.4 → 0.46.0, systematic 2.32.1 → 2.33.2; OMO-slim models migrated to `claude-sonnet-5` / `gemini-3.5-flash`, mixed orchestrator `variant: xhigh`; `systematic.jsonc` gained categories + agents model routing; **new `ollama-distill` local-LLM session-distillation pipeline** (`distill` mise task); 6 new repo-scoped OpenCode skills (clonedeps, codemap, content-research-writer, copilot-cloud-agent, file-organizer, simplify) + `research` subagent; devcontainer base 2.1.7 → 2.1.9; `MISE_VERSION 2026.7.5`; tool bumps (rust 1.97, go 1.26.5, pnpm 11.10, npm 11.18, deno 2.9.2, prettier 3.9.4, biome 2.5.2, opencode-ai 1.17.12, claude-code 2.1.128, agent-browser 0.31.1, copilot 1.0.68, puppeteer 25.3.0, tsx 4.23.0); stars 20, issues 6 (unchanged) |
