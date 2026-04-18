# Wiki Log

Chronological record of all wiki operations.

---

_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._

## [2025-06-18 00:00] ingest | marcusrbrown/ha-config

Initial survey of `marcusrbrown/ha-config` (SHA `83784bc`). Created repo page `marcusrbrown--ha-config.md` and topic page `home-assistant.md`. Updated `index.md` to catalog both pages.

Key findings:

- Home Assistant config repo, public, package-based architecture with 11 domain packages
- 10 custom components (bermuda, bhyve, ble_monitor, browser_mod, hacs, mail_and_packages, remote_homeassistant, sengledng, solaredge_modbus_multi, toyota_na)
- ESPHome configs linked via git submodule to `marcusrbrown/esphome.life`
- CI pipeline: YAML lint, Remark lint, Prettier, HA config validation (frenck/action-home-assistant)
- Renovate extends `marcusrbrown/renovate-config`, pre-commit managed via mise/aqua
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- HA version pinned at 2025.6.3, Python deps: esphome 2025.12.7, yamllint 1.38.0

Sources: https://github.com/marcusrbrown/ha-config (SHA 83784bc3a212c10cd358be4da9425e46aa6e90f0)

## [2025-06-18 01:00] ingest | marcusrbrown/.github

Survey of `marcusrbrown/.github` (SHA `be01029`). Created repo page `marcusrbrown--github.md` and topic page `probot-settings.md`. Updated `index.md` to catalog both pages.

Key findings:

- Personal `.github` repo providing GitHub defaults and community health files for `marcusrbrown` repositories
- Contains canonical `common-settings.yaml` — the Probot Settings template extended by other Marcus repos
- Settings divergence documented: personal template (no PR reviews, Marcus admin) vs. fro-bot org template (1 reviewer required, fro-bot admin)
- CI pipeline: Prettier-only — appropriate for a YAML/Markdown repo with no application code
- Renovate extends `marcusrbrown/renovate-config#4.5.1`, post-upgrade runs Prettier 3.8.1
- Shared workflows from `bfra-me/.github@v4.4.0` for Renovate and settings sync
- Community health files: Contributor Covenant v1.4, MIT license, GitHub Sponsors
- `fro-bot` listed as collaborator (push) confirming Fro Bot write access
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Updated `marcusrbrown--ha-config` cross-reference context: ha-config extends `fro-bot/.github` settings, not `marcusrbrown/.github`

Sources: https://github.com/marcusrbrown/.github (SHA be01029971bc8b50fbd2b660fadc7341da26e03c)

## [2026-04-18 00:00] ingest | marcusrbrown/containers

Survey of `marcusrbrown/containers` (SHA `e582f85`). Created repo page `marcusrbrown--containers.md`. Created topic pages `docker-containers.md` and `github-actions-ci.md`. Updated `index.md` to catalog all three new pages.

Key findings:

- Container collection repo, public, oldest in Marcus's portfolio (created 2016-12-19), actively maintained
- Two active Node.js container variants: Alpine (~70 MB) and Bookworm-slim (~160 MB), both Node 24, multi-arch (amd64+arm64)
- Archived Ethereum Parity containers excluded from all CI pipelines
- Python automation layer (Poetry, Python 3.13): Dockerfile generation, metrics collection, image tagging, AI-powered template intelligence (OpenAI + Anthropic)
- Template system covering Alpine base, Express.js, FastAPI, PostgreSQL, Nginx, Go microservices
- Comprehensive CI: multi-arch builds via Buildx+QEMU, Trivy security scanning, Hadolint, Black/isort/pylint, pre-commit, Prettier
- Publishes to GHCR and Docker Hub (legacy `igetgames` alias in settings homepage)
- All GitHub Actions and base images SHA/digest-pinned; OCI label convention with clear CI-injected vs static split
- **Fro Bot workflow present** (`fro-bot.yaml`, `fro-bot/agent@v0.40.0`) — PR review with container-specific prompts, daily autohealing schedule at 14:30 UTC
- Renovate extends `marcusrbrown/renovate-config#4.5.0`, Probot settings extend `fro-bot/.github:common-settings.yaml`
- Shared `@bfra.me/*` config heritage with `ha-config` repo — new `github-actions-ci` topic page cross-references both

Sources: https://github.com/marcusrbrown/containers (SHA e582f856844ac1dd52fc8739f1a9aa8398248e6e)

## [2026-04-18 00:00] ingest | marcusrbrown/gpt

Initial survey of `marcusrbrown/gpt` (SHA `60bd62e`). Created repo page `marcusrbrown--gpt.md`. Updated `index.md` to catalog the new page. No new topic/entity/comparison pages created — cross-cutting topics (LangChain, MCP, local-first) are candidates for standalone pages once a second repo references them.

Key findings:

- Local-first GPT creation platform deployed to gpt.mrbro.dev (GitHub Pages)
- React 19 + TypeScript 5.9 + Vite 8 + HeroUI + TailwindCSS 4
- IndexedDB (Dexie 4.4.2) for client-side storage, Web Crypto (AES-GCM/PBKDF2) for API key encryption
- Multi-provider LLM abstraction via `BaseLLMProvider`: OpenAI, Anthropic, Azure, Ollama
- LangChain 1.3.3 + LangGraph 1.2.8 for AI orchestration, MCP SDK 1.29.0 for tool integration
- 13 RFCs documenting architectural decisions (storage through Tauri desktop app)
- 5 test dimensions: unit (Vitest), E2E (Playwright, currently disabled workflow), accessibility (axe-core), visual regression, performance (Lighthouse)
- **Full Fro Bot integration:** `fro-bot.yaml` (PR review, triage, daily maintenance at 15:30 UTC) and `fro-bot-autoheal.yaml` (daily autohealing at 03:30 UTC), both using `fro-bot/agent@v0.40.2`
- Renovate extends `marcusrbrown/renovate-config#4.5.8` with LangChain monorepo grouping
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- AGENTS.md hierarchy with directory-level guides for AI-assisted development
- Copilot coding agent support via `copilot-setup-steps.yaml`
- Uses `@bfra.me/*` shared configs (tsconfig, eslint, prettier)
- `@typescript/native-preview` (tsgo) for fast type-checking in build step
- Node.js 24.15.0, pnpm 10.33.0

Sources: https://github.com/marcusrbrown/gpt (SHA 60bd62e86caa1a07610c2162d9ffbb917d172dc3)

## [2026-04-18 02:32] ingest | marcusrbrown/vbs

Survey of `marcusrbrown/vbs` (SHA `a552e73`). Created repo page `marcusrbrown--vbs.md`. Updated `index.md` to catalog the new page.

Key findings:

- Star Trek chronological viewing guide — local-first TypeScript + Vite + D3.js web app deployed to GitHub Pages
- Functional factory architecture: no classes, no `this`, closure-based state, generic EventEmitters
- Comprehensive module set: progress tracking, search/filter, timeline visualization, metadata from 4 external sources (TMDB, Memory Alpha, TrekCore, STAPI), streaming service integration, theme management
- ~43 test files via Vitest 4.x with coverage (Codecov), type-level tests
- Automated Star Trek data pipeline: weekly generation from multi-source aggregation with quality scoring, validation, and PR creation
- **Fro Bot integration: fully active** — three workflows: PR review (`fro-bot.yaml`), daily maintenance reporting, nightly autoheal (`fro-bot-autoheal.yaml`) with 5-category healing (errored PRs, security, code quality, DX, data quality)
- Shared config ecosystem: `@bfra.me/eslint-config`, `@bfra.me/prettier-config`, `@bfra.me/tsconfig`, `marcusrbrown/renovate-config#4.5.8`
- Probot settings extend `fro-bot/.github:common-settings.yaml` (same pattern as `ha-config`)
- CI: lint + type-check + test with coverage + build; branch protection requires Build, Test, Fro Bot, Renovate
- Copilot coding agent setup workflow present
- pnpm 10.33.0, Node.js 22.x, TypeScript 5.9.x strict mode

Sources: https://github.com/marcusrbrown/vbs (SHA a552e7335af70122f68380440c78a415a785749f)

## [2026-04-18 03:30] ingest | marcusrbrown/tokentoilet

Survey of `marcusrbrown/tokentoilet` (SHA `0ed90a6`). Created repo page `marcusrbrown--tokentoilet.md` and topic page `web3-defi.md`. Updated `index.md` to catalog both pages.

Key findings:

- Web3 DeFi token disposal app — "chump and dump" unwanted tokens to charity
- Next.js 16.2.3, React 19.2.5, TypeScript 6.0.2, Wagmi v2, Reown AppKit, Tailwind CSS v4, Vitest 4, Storybook 10 alpha
- Deployed to Vercel (preview on PRs, prod on main push)
- Extensive custom hooks layer: 12 hooks covering wallet, token operations, transaction queue, error handling — all with co-located tests
- Violet-branded glass morphism design system with 14+ UI components, WCAG 2.1 AA accessible
- **Fro Bot workflow present** (`fro-bot.yaml`, agent v0.40.2) — PR review with Web3 security focus, daily autohealing schedule at 03:30 UTC
- CI pipeline: lint, type-check, test, Next.js build, Storybook build, dependency review
- Dev tooling: `@bfra.me/eslint-config`, `@bfra.me/prettier-config/120-proof`, simple-git-hooks + lint-staged, `@t3-oss/env-nextjs` + Zod for typed env
- Renovate via reusable workflow, Probot settings via `bfra-me/.github`
- Early stage: smart contracts and core disposal mechanism not yet implemented per roadmap
- No license file specified (unusual for public repo)
- Copilot setup steps workflow present

Sources: https://github.com/marcusrbrown/tokentoilet (SHA 0ed90a61784b5b85dcf925bb1255e794c4f5d6a3)

## [2026-04-18 04:00] ingest | marcusrbrown/ha-config

Re-survey of `marcusrbrown/ha-config` (SHA `54a6727`). Updated repo page `marcusrbrown--ha-config.md` and topic page `home-assistant.md`. Index unchanged (already cataloged).

Delta from prior survey (SHA `83784bc`, 2025-06-18):

- Prettier bumped 3.8.2 → 3.8.3 (CI env and Renovate post-upgrade)
- Renovate config preset bumped `marcusrbrown/renovate-config#4.5.7` → `#4.5.8`
- actions/checkout pinned at v6.0.2, bfra-me/.github at v4.16.6
- pre-commit-hooks pinned at v6.0.0
- Repository structure, packages, custom components, HA version (2025.6.3), Python deps all unchanged
- **Still no Fro Bot agent workflow** — recommendation for follow-up PR carried forward
- Recent commit activity is exclusively Renovate dependency bumps (PRs #753–#762)

Sources: https://github.com/marcusrbrown/ha-config (SHA 54a67275e00ed01a52f30399065d4fe6eaa4ee54)

## [2026-04-18 06:00] ingest | marcusrbrown/.dotfiles

Survey of `marcusrbrown/.dotfiles` (SHA `2f2d1e6`). Created repo page `marcusrbrown--dotfiles.md`, topic page `dotfiles.md`, and entity page `mise.md`. Updated `index.md` to catalog all three pages.

Key findings:

- Bare git repo pattern (`GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=$HOME`) with allowlist .gitignore
- Supports Bash and Zsh, fully XDG-compliant configuration under `~/.config/`
- Sheldon zsh plugin manager with deferred loading and znap eval caching for fast startup
- Starship prompt with Catppuccin Mocha palette
- mise manages 20+ tools: Node 24.15.0, Python 3.14.4, Rust 1.95.0, Go 1.26.2, Bun, Deno, Zig, TypeScript 6.0.2, plus CLI tools (Claude Code, OpenCode, ast-grep, Biome, Playwright)
- Published devcontainer image at `ghcr.io/marcusrbrown/dotfiles-devcontainer:latest` with 4 custom features (dotfiles-dev, mise, sheldon, keychain)
- **Fro Bot workflow present** (`fro-bot.yaml`, agent v0.40.2) — PR review, daily maintenance (6-category schedule prompt), and cross-project health monitoring
- Multi-agent AI setup: Claude Code (`.claude/`), OpenCode (`.config/opencode/`), root AGENTS.md
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Renovate extends `marcusrbrown/renovate-config#4.5.8` with custom mise version manager
- Privacy-focused: telemetry disabled for Homebrew, PlatformIO, vibe-tools
- GPG signing on commits, fast-forward only merges, auto-prune on fetch
- Comprehensive Brewfile: 40+ brew packages, 15+ casks, 13 Mac App Store apps, 90+ VS Code extensions

Cross-references established: dotfiles shares mise tooling, Renovate config patterns, and Probot settings with ha-config. Entity page for mise created to track cross-repo usage.

Sources: https://github.com/marcusrbrown/.dotfiles (SHA 2f2d1e6ac04999c5e61ee054fc585d9542cd3a74)

## [2026-04-18 12:00] ingest | marcusrbrown/copiloting

Survey of `marcusrbrown/copiloting` (SHA `cfc8bb6`). Created repo page `marcusrbrown--copiloting.md` and topic pages `langchain.md`, `polyglot-monorepo.md`. Updated `index.md` to catalog all three new pages.

Key findings:

- Polyglot Python 3.14 (Poetry) + TypeScript (pnpm 10) AI/LLM experimentation monorepo
- Flask + SvelteKit PDF chat app in `course/pdf-dist/`, Python LangChain course sections, TS tutorials
- Stack: LangChain ^1.2 (Python) / 0.0.212 (JS — very old), OpenAI ^2.0, Pydantic ^2.10, Vitest, pytest
- **Fro Bot workflow present** (`fro-bot.yaml`) — PR review, issue triage, daily maintenance, @fro-bot mentions
- **Fro Bot Autoheal workflow present** (`fro-bot-autoheal.yaml`) — daily auto-healing with progressive stale import migration
- CI uses path filtering (dorny/paths-filter) to run Node.js and Python jobs independently
- Renovate extends `marcusrbrown/renovate-config#v4`, settings extend `fro-bot/.github:common-settings.yaml`
- Copilot Setup Steps workflow present for GitHub Copilot agent bootstrap
- Known issue: Python application code uses stale pre-0.2 LangChain import paths despite deps being upgraded
- JS langchain version (0.0.212) significantly behind Python side (^1.2)
- Comprehensive AGENTS.md and .github/copilot-instructions.md for AI agent conventions

Sources: https://github.com/marcusrbrown/copiloting (SHA cfc8bb6d5e814c9918a6e55f4b6747c3a36e4fb1)

## [2026-04-18 12:00] ingest | marcusrbrown/vbs

Initial survey of `marcusrbrown/vbs` (SHA `a552e73`). Created repo page `marcusrbrown--vbs.md` and topic page `github-actions-ci.md`. Updated `index.md` to catalog both pages.

Key findings:

- Star Trek chronological viewing guide, TypeScript + Vite + D3.js, deployed to GitHub Pages
- Functional factory architecture: no classes, closure-based state, generic EventEmitters, strict TS
- Comprehensive metadata subsystem: 6 modules + 6 UI components sourcing from TMDB, Memory Alpha, TrekCore, STAPI
- Automated data generation pipeline with quality scoring, weekly via `update-star-trek-data.yaml`
- Functional composition utilities embedded: `pipe()`, `compose()`, `curry()`, `tap()`, async variants
- Generic storage adapters with `StorageAdapter<T>` interface; IndexedDB migration planned
- **Fro Bot agent workflow present and active** (`fro-bot.yaml` + `fro-bot-autoheal.yaml`)
  - PR review with VBS-specific convention checks (no `any`, no classes, `.js` extensions, `destroy()` methods)
  - Daily maintenance report (rolling issue, 14-day window)
  - Daily autoheal (5-category sweep: errored PRs, security, code quality, DX, data quality)
- CI: ESLint, type-check, Vitest coverage (Codecov), Vite build
- Renovate extends `marcusrbrown/renovate-config#4.5.8`, post-upgrade runs `pnpm install` + `pnpm fix`
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Created `github-actions-ci.md` topic page to capture cross-repo CI patterns (pin-by-SHA, shared setup actions, GitHub App tokens, Pages deployment)

Sources: https://github.com/marcusrbrown/vbs (SHA a552e7335af70122f68380440c78a415a785749f)
