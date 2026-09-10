---
type: topic
title: Dotfiles Management
created: 2026-04-18
updated: 2026-09-10
sources:
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: fe0144c0e9fc0168fc4ed9aa9fa0492df4846599
    accessed: 2026-09-10
  - url: https://github.com/marcusrbrown/.dotfiles
    sha: 347958930a27f22f630996c1d0d65e02416218f0
    accessed: 2026-08-26
tags: [dotfiles, shell, configuration, bare-git-repo, xdg, dormant-config, excludes-file, git-dir-leak, entry-point, dead-code, curl-pipe-sh]
related:
  - marcusrbrown--dotfiles
  - mise
---

# Dotfiles Management

Patterns and conventions for managing shell and development environment configuration files across machines.

## Repos Using Dotfiles Patterns

- [[marcusrbrown--dotfiles]] — Marcus's primary dotfiles repo (bare git, XDG-compliant, multi-shell)

## Management Approaches

### Bare Git Repository (used by Marcus)

The `GIT_DIR` / `GIT_WORK_TREE` pattern treats `$HOME` as the working tree and a hidden directory (e.g., `~/.dotfiles`) as the git dir. No symlinks, no wrapper tools.

Key mechanics:

- Allowlist `.gitignore`: ignore everything by default (`/*`), un-ignore specific paths
- All operations via alias: `alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'`
- Untracked files hidden by default (bare repo config)
- New files must be explicitly allowlisted before tracking

**Tradeoffs:** Zero dependencies beyond git. Full git history and branching for configs. But requires care — accidental `git add .` from `$HOME` could stage sensitive files. The allowlist pattern mitigates this.

#### Two bare-repo-specific footguns (2026-09-10, [[marcusrbrown--dotfiles]])

Both come from the same structural fact — **the git dir lives inside the work tree**, and the pattern *requires* the two environment variables — which makes each wrong answer look like the natural implementation.

**1. Never name the `core.excludesFile` `.gitignore`.** If the allowlist file sits at `$GIT_DIR/.gitignore` and `$GIT_DIR` is inside `$GIT_WORK_TREE` (e.g. `$HOME/.dotfiles/.gitignore`), git reads it **twice**: once as `core.excludesFile`, and again as an ordinary per-directory ignore file for the `.dotfiles/` directory. In the second reading the leading `/*` **re-anchors to `.dotfiles/`** and every `!/path/...` negation resolves to a path that never exists. The observable symptom is subtle and easy to misattribute: allowlist entries appear correct, `git check-ignore -v` points at a plausible line, but newly-added files still refuse to stage. Name the file something git will not pick up on its own — here `.dotfiles/ignore` — and **record the reason at both ends** (a header comment in the git config that sets `excludesFile`, plus a line in the README), because otherwise renaming it back to `.gitignore` looks like tidying rather than a regression.

**2. Never export `GIT_DIR`/`GIT_WORK_TREE` process-wide.** Anything that shells out to `git` internally — a package manager, build tool, or language version manager — inherits them silently and gets redirected at the dotfiles repo. This is latent until some dependency starts using `git` internally, at which point it presents as a regression with **no corresponding repository change**. Scope them instead:

```bash
# per command
git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" status

# per invocation via the alias, which does not export
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'

# neutralize inheritance in scratch experiments
env -u GIT_DIR -u GIT_WORK_TREE git init /tmp/scratch
```

The exposure is highest in containers, where a devcontainer `remoteEnv` block applies to **every** remote process including `postCreateCommand`. The diagnostic is a **single-variable flip**: run the same command twice in the same container changing only the environment. If only the exported run fails, it is a process-wide git-env leak, not a defect in the tool being blamed. See [[marcusrbrown--dotfiles]] for the worked case (8 consecutive failures on a required, admin-enforced check; mise 2026.9.0 as the trigger).

### Alternative Approaches (not used)

- **GNU Stow** — Symlink farm manager. Simple, but symlinks can confuse tools.
- **chezmoi** — Template-based dotfile manager with encryption. More complex, adds a dependency.
- **rcm** — Thoughtbot's dotfile manager. Convention-based, symlink approach.
- **yadm** — Yet Another Dotfiles Manager. Wraps git with dotfile-specific features.

## Conventions Observed

### XDG Base Directory Compliance

All configuration follows the XDG spec:

- `XDG_CONFIG_HOME` (`~/.config/`) — configuration files
- `XDG_DATA_HOME` (`~/.local/share/`) — application data
- `XDG_CACHE_HOME` (`~/.cache/`) — cache files
- `XDG_STATE_HOME` (`~/.local/state/`) — state files

### Shell Init Organization

The `init.d/` pattern with numbered prefixes controls load order:

```
.config/bash/init.d/
  002-prompt.bash
  010-nvm.bash
  ...
```

Machine-local overrides in `local.d/` directories are gitignored — secrets and machine-specific paths never enter the repo.

**Superseded as a description of [[marcusrbrown--dotfiles]] (2026-09-10), and the reason is the durable part.** The pattern above is a real and common convention, but in that repo it had **not executed since 2024-01-10** — 967 days — and the wiki recorded it as live for five surveys because the source was read rather than run. Retained here as an approach; see the section below for how to tell a live layered loader from a dormant one.

### Dormant configuration: verify by executing, not by reading

A layered shell loader is unusually good at faking liveness. The scripts are well-formed, consistently numbered, and `command_exists`-guarded; reading them confirms the documented chain. Only a shell disproves it.

**How the break happens.** A framework migration rewrites the **entry point** without rewriting **what it loads**. Adopting a plugin manager (sheldon, zinit, oh-my-zsh) typically replaces `.bashrc`/`.zshrc` wholesale. If the loader's internals still reference their pre-migration paths, the subsystem's only remaining references are *to each other* — `functions` sourcing `~/.bash/main` while `main` sources `~/.bash/functions`, through a directory that no longer exists. Nothing errors, because nothing runs. In the observed case that state persisted through 967 days and hundreds of commits.

**Detection, cheapest first:**

- **The empty variable is the cheapest signal available.** One environment variable that should have a value and does not exposed all 26 dead files. Ask a live shell, not the file:
  ```console
  $ zsh -ic 'echo "PAGER=$PAGER"'   # init.d/pager.bash exports PAGER
  PAGER=
  $ zsh -ic 'alias ls'               # resolves to aliases:37, not init.d/ls.bash:23
  ```
- **Trace the entry point, not the contents.** A reference from another orphaned file is not a referrer.
- **When documentation and behavior disagree, the shell is authoritative.**

**Why it matters more than stale docs.** *Dormant configuration is worse than absent configuration, because it absorbs work that appears to succeed.* Absent config produces an error; dormant config accepts the edit, reports nothing, and does nothing. Three compounding consequences observed:

1. **Secrets guidance pointing into a void.** Both READMEs instructed readers to write credentials to `local.d/`; a token written there is never loaded, and the user believes it is.
2. **A silently absent privacy control.** `DOTNET_CLI_TELEMETRY_OPTOUT` lived in a dormant `init.d/dotnet.bash` and therefore never applied — a live gap in a repo whose stated posture is privacy-first. `EDITOR`/`VISUAL`/`PAGER` were unset for the same reason. Any opt-out that lives in a loader you have not executed is unverified.
3. **The dead convention propagates forward.** The repo's scheduled maintenance agent carried `init.d/` numbering and `local.d/` overrides in its prompt as live conventions, so it kept **recommending a mechanism that could not work** in every review it wrote. A dormant convention encoded in an agent prompt has a growth term the docs do not.

**Remediation shape — salvage, then delete, in separate commits.** Salvage changes behavior; deletion does not, so separated either reverts alone. Prefer this to *restoring* a long-dormant subsystem: restoration activates years of untested behavior at once (a competing prompt, init for tools that are not installed, and — the sharp one — an `ssh-agent` script that overwrites a `SSH_AUTH_SOCK` already provided by gpg-agent). Salvage the values, not the machinery:

```bash
: "${EDITOR:=vim}"          # assign-if-unset, so a caller's environment still wins
: "${VISUAL:=$EDITOR}"
: "${PAGER:=less}"
export EDITOR VISUAL PAGER
export DOTNET_CLI_TELEMETRY_OPTOUT=1   # keep OUTSIDE any HOST_OS == darwin block
```

That last comment is load-bearing: co-locating a cross-platform telemetry opt-out with `HOMEBREW_NO_ANALYTICS` inside a macOS branch leaves telemetry enabled in the Linux devcontainer — swapping one silent gap for another.

**When cleaning up, scrub dead names from reference docs and never from failure records.** The test is whether a document *recommends* the path or *explains why it failed*. Rewriting `init.d/pager.bash` to "a former entry point" inside a postmortem deletes the evidence the postmortem exists to preserve.

**Applies beyond shells** — any layered config directory (`conf.d/`, `plugins.d/`, `init.d/`) whose loader you have not personally executed, any documented load chain written before a framework migration, and any machine-local override mechanism nobody has tested end to end.

### Pinning installers fetched over the network

Dotfiles and devcontainer features routinely bootstrap tools with `curl … | sh`. Unpinned, the environment changes on the upstream project's release schedule rather than on a reviewed commit — and the resulting failure looks like a repository regression with no repository change, which is expensive to diagnose. Two rules from [[marcusrbrown--dotfiles]] (#2497):

- **`set -e` is not enough; use `set -eo pipefail`.** A *pinned* installer URL that 404s pipes an empty script into `sh`, which exits `0`. Pinning without `pipefail` converts a loud 404 into a silent no-op install — strictly worse than not pinning, because the pin creates false confidence.
- **Different installers take their version differently.** mise reads `MISE_VERSION` from the environment; uv bakes its version into the script, so it must be pinned via a versioned URL (`https://astral.sh/uv/${UV_VERSION}/install.sh`); starship takes `-v`. Verify which, per installer.
- **A `# renovate:` comment does not make a version managed.** Confirm a manager's file pattern actually covers the file — an unmatched marker looks managed during review while drifting in practice. Same wrong-target class as the mis-pathed `uses:` case in [[marcusrbrown--esphome-life]].

### Privacy Defaults

Telemetry and analytics disabled by default for all tools that support it. This is a deliberate, consistent choice across the environment.

### Tool Version Management

[[mise]] manages runtime versions (Node, Python, Rust, Go, etc.) declaratively via `.config/mise/config.toml`. This replaces the older pattern of per-tool version managers (nvm, pyenv, etc.).

### Devcontainer Portability

Devcontainer configurations with custom features enable the same environment in Codespaces, VS Code Remote Containers, or any devcontainer-compatible runtime. Published images on GHCR provide instant startup without rebuilding.

## AI Agent Integration in Dotfiles

Marcus's dotfiles include a rich AI agent configuration layer, treating the development environment itself as an agentic platform:

- **OpenCode** (`.config/opencode/`): Full plugin stack — current state and version history live in [[marcusrbrown--dotfiles]]. As of 2026-09-10 (SHA `fe0144c`): the active OMO-slim preset is still `mixed`, but the roster grew 5 → **6** (`mixed-astra`, `mixed-go` added) and a new **`openai/gpt-6-astra`** line took the `mixed` oracle seat. Two structural moves worth naming: **skill/MCP negation syntax is now in use** (`skills: ["*", "!worktrees"]` on every orchestrator — allowlist-with-exceptions applied to agent capability, mirroring the repo's allowlist ignore philosophy), and **`fast-generic` moved from a single top-level definition into the per-preset shape**, so the mechanical delegate is now routed like every other seat. Separately, a new **`.config/cortexkit/`** directory restored the `magic-context.jsonc` / `aft.jsonc` tuning deleted in July — with **per-harness `"opencode"` / `"pi"` model blocks**, the first sighting of [[pi-coding-agent]] in a consumer's local config. Prior state as of 2026-08-26 (SHA `3479589`): the July experiment partially reverted — the OMO-slim **active preset flipped back `openai` → `mixed`** (plugin 2.2.11), with the Anthropic seat moved onto **`anthropic/claude-opus-5`** as the mixed orchestrator; OpenAI routing stays on the `gpt-5.6-*` line (sol/luna/terra). The top-level `fast-generic` mechanical agent now uses a **model fallback array** (`gpt-5.3-codex-spark` → `github-copilot/gpt-5.4-mini`). **`opencode-copilot-delegate@0.12.1` returned to the plugin array** (reversing the 2026-07-10 drop), so plugin-driven and skill-driven Copilot delegation now coexist. `@fro.bot/systematic` climbed the v3 minor train to 3.15.0 with a retuned `systematic.jsonc` (added a `workflow` category + a `workflow_guard` block). MCP set **contracted 3 → 2** (`websearch`/Exa removed; `grep_app` renamed `gh_grep`). `@cortexkit/opencode-magic-context` (0.38.1) and `@cortexkit/aft-opencode` (0.52.1) still run on **plugin defaults**. The top-level headless default model stays removed — routing is fully delegated to the slim presets.
  - _Prior (2026-07-27):_ `oh-my-opencode-slim` crossed a **v1→v2 major** (2.2.8), active preset flipped `mixed` → `openai`, `@fro.bot/systematic` crossed **v2→v3** (3.3.0), companion `@cortexkit/opencode-openai-auth` added.
- **Claude Code** (`.claude/`): Repo-scoped agents, commands, and rules
- **Repo-scoped skills**: `.agents/skills/copilot-cli` (non-interactive GitHub Copilot CLI delegation) remains the sole `.agents/` bundle, but as of 2026-07-10 a second skills tree lives under `.config/opencode/skills/` with six bespoke skills — `clonedeps`, `codemap`, `content-research-writer`, `copilot-cloud-agent`, `file-organizer`, `simplify`. See [[marcusrbrown--dotfiles]].
- **Local-LLM distillation**: A new `ollama-distill` pipeline (`.config/opencode/scripts/ollama-distill.ts`, `mise run distill`) reads the OpenCode session SQLite DB and produces Markdown summaries via local Ollama — keeping session summarization off hosted models.
- **AGENTS.md**: Canonical knowledge base for all AI agents operating in the repo

This pattern — dotfiles as AI agent configuration — is distinctive: the home directory becomes the ground truth for agent personas, model routing, and skill availability across all projects. A recurring theme in 2026-07 is **deferring to upstream plugin defaults** (deleting bespoke magic-context/aft config) while keeping bespoke logic where no upstream exists (local distillation, copilot delegation skills). Late July 2026 saw two upstream **major-version boundaries land together** (oh-my-opencode-slim v2, systematic v3) alongside a fresh `openai/gpt-5.6-*` model migration — the config tracks provider model churn aggressively while holding the structural conventions steady.

**Dotfiles as an agent-configuration surface has its own failure mode (2026-09-10).** When the home directory is the ground truth for agent personas and conventions, a stale convention does not merely mislead a human reader — it gets **taught forward** by every agent that loads it. Two instances landed in the same window: the maintenance prompt recommended `init.d/`/`local.d/` mechanisms that had not worked since 2024, and a maintenance category granted a fix path that a later routing instruction revoked, producing five consecutive days of honest "fixed" reports for a fix that never persisted. The generalizable pair: **audit agent prompts against live behavior on the same schedule you audit docs**, and **never route a fix into a category that forbids delivering it** — cross-category handoffs move the work but not the permissions. Both are cataloged in [[github-actions-ci]].

There is also now a **non-preference reason to care which model family the config routes to**: OpenCode's explicit prompt-cache anchoring only applies to Anthropic-family models, so a routing flip is also a cache-economics decision (see [[opencode-plugins]]). The config's habitual provider churn is not free.

A distinctive move from 2026-08-26: the repo's **operational agent-tooling scripts now have CI-enforced unit tests**. The Bun/TypeScript maintenance scripts under `.config/opencode/scripts/` (`opencode-doctor`, `ollama-distill`) are exercised by a `Script Tests` matrix on **both Linux and macOS** in the repo's `Main` workflow, with a stable aggregator status context wired into branch protection. Treating home-directory agent scripts as first-class, cross-platform-tested software — rather than throwaway glue — is a step beyond typical dotfiles hygiene. It also shows the config's churn is not monotonic: the same window that added test rigor also **reverted** two July decisions (active preset `openai` → `mixed`; re-adding the `opencode-copilot-delegate` plugin), a reminder that these are live-tuned experiments, not one-way migrations.

## Related Technologies

- **[[mise]]** — Polyglot tool version manager
- **Sheldon** — Zsh plugin manager with deferred loading
- **Starship** — Cross-shell prompt
- **Homebrew** — macOS package manager (Brewfile for declarative installs)
- **OpenCode** — AI coding environment with plugin architecture and MCP support
- **oh-my-openagent** — Multi-agent routing framework for OpenCode
