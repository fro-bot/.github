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

## [2026-04-18 00:00] ingest | marcusrbrown/extend-vscode

Initial survey of `marcusrbrown/extend-vscode` (SHA `a4dcbbb`). Created repo page `marcusrbrown--extend-vscode.md` and topic page `vscode-extensions.md`. Updated `index.md` to catalog both pages.

Key findings:

- VS Code extension toolkit, modular architecture with central `ExtensionController`
- TypeScript, MIT, pnpm 10.33.0, tsup build, dual Node/Web extension targets
- Feature modules: commands, webviews, tree views, status bar, tasks, telemetry, logging, configuration
- Generated types from package.json via `vscode-ext-gen`
- Vitest unit + web tests, `@vscode/test-electron` integration, Playwright visual regression
- Semantic-release publishing to VS Code Marketplace, OpenVSIX, and npm
- Emergency rollback workflow with per-platform support
- Extends `@bfra.me/eslint-config` and `@bfra.me/tsconfig`
- Renovate extends `marcusrbrown/renovate-config#4.5.0` + `sanity-io/renovate-config`
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- AI context: `llms.txt`, `.github/copilot-instructions.md`, `.ai/`, `.cursor/` directories
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Version 0.1.0 (pre-release), created 2020-11-16, last push 2026-04-17

Sources: https://github.com/marcusrbrown/extend-vscode (SHA a4dcbbb175828a60855053d778fd21903a3d73d6)

## [2026-04-18 00:00] ingest | marcusrbrown/mrbro.dev

Initial survey of `marcusrbrown/mrbro.dev` (SHA `51f5cab`). Created repo page `marcusrbrown--mrbro-dev.md` and topic page `github-pages.md`. Updated `index.md` to catalog both pages.

Key findings:

- Developer portfolio site: React 19, TypeScript (strict), Vite 7 (SWC), deployed to GitHub Pages at mrbro.dev
- Advanced theme system with 10+ presets, custom theme creator, JSON schema validation (Ajv), import/export
- GitHub API integration for dynamic blog and project showcase (no CMS)
- Comprehensive test infrastructure: Vitest (unit), Playwright (E2E, visual regression, accessibility), Lighthouse CI (performance)
- **Fro Bot workflow present and active** — `fro-bot.yaml` (PR review, daily maintenance) and `fro-bot-autoheal.yaml` (daily CI repair, security, code quality, production site review via agent-browser)
- Shares `@bfra.me/*` config ecosystem and `marcusrbrown/renovate-config` with [[marcusrbrown--ha-config]]
- Notable conventions: PascalCase hook files, no barrel exports, pure ESM, SWC over Babel, Shiki externalized in build
- Coverage below enforced 80% thresholds on statements (70.81%), functions (60.4%), lines (70.81%)
- Copilot coding agent configured with setup steps and pre-tool-use hooks

Sources: https://github.com/marcusrbrown/mrbro.dev (SHA 51f5cab5c77768b761d9f0a688ac7436cc5a06f4)

## [2026-04-18 00:00] ingest | marcusrbrown/marcusrbrown

Survey of `marcusrbrown/marcusrbrown` (SHA `af78e68`). Created repo page `marcusrbrown--marcusrbrown.md` and topic page `github-actions-ci.md`. Updated `index.md` to catalog both pages.

Key findings:

- GitHub profile README repo, public, TypeScript-powered with template-driven content generation
- Automated profile updates every 6 hours via `muesli/readme-scribe` and custom TypeScript scripts
- Sponsor tracking pipeline: GitHub GraphQL API fetch, template rendering, auto-PR via `peter-evans/create-pull-request`
- Badge automation: `@bfra.me/badge-config`, technology detection, shields.io client, caching layer
- A/B testing framework for sponsor conversion content (`templates/variants/`)
- Content analytics and mobile responsiveness testing scripts
- CI: markdownlint + tsc + eslint via `main.yaml`; profile generation via `update-profile.yaml`
- Dev tooling: pnpm 10.31.0, Node 24.14.0 (mise), Vitest 4.0.18, `@bfra.me/*` shared configs
- Renovate extends `marcusrbrown/renovate-config#4.5.1`, post-upgrade runs bootstrap + fix
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Automated commits by `mrbro-bot[bot]` (app 137683033), not Fro Bot
- **No Fro Bot agent workflow detected** — follow-up PR recommended
- Cross-cutting GitHub Actions patterns extracted to new topic page `github-actions-ci.md`

Sources: https://github.com/marcusrbrown/marcusrbrown (SHA af78e68d510b24152531f7fdafe9bff35a58f071)

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

## [2026-04-18 05:00] ingest | marcusrbrown/tokentoilet

Follow-up survey of `marcusrbrown/tokentoilet` (SHA `0ed90a6`, same as prior ingest). Additive update to existing repo page `marcusrbrown--tokentoilet.md`.

Changes:

- Added `related` cross-references to `marcusrbrown--ha-config` and `marcusrbrown--vbs` in frontmatter
- Added "Shared Ecosystem Patterns" section with cross-repo comparison table (Probot, Renovate, ESLint, Prettier, pnpm, Fro Bot, Copilot, AGENTS.md)
- Specified Renovate preset version (`#4.5.8`), post-upgrade tasks, and `lucide-react` monthly automerge rule
- Documented branch protection details from `settings.yml` (required checks, linear history, admin enforcement)
- No contradictions with prior ingest — all findings confirmed at same commit SHA

Sources: https://github.com/marcusrbrown/tokentoilet (SHA 0ed90a61784b5b85dcf925bb1255e794c4f5d6a3)

## [2026-04-18 05:31] ingest | marcusrbrown/infra

Survey of `marcusrbrown/infra` (SHA `20de047`). Created repo page `marcusrbrown--infra.md` and topic page `github-actions-ci.md`. Updated `index.md` to catalog both pages.

Key findings:

- Bun workspace monorepo (`apps/*` + `packages/*`) for personal infrastructure management
- Two apps: KeeWeb v1.18.7 static site deploy at `kw.igg.ms` (SSH/rsync to `box.heatvision.co`), CLIProxyAPI Docker Compose stack at `cliproxy.fro.bot` (shared Claude proxy for Fro Bot agents)
- Published CLI package `@marcusrbrown/infra` v0.4.3 on npm — deploy triggers, health checks, MCP bridge (`infra mcp`)
- CLI framework: goke + Zod Standard Schemas + @goke/mcp for MCP tool exposure
- CI: ESLint + TypeScript + Bun tests in parallel; Node 24 pinned for ES2024 API compat (ESLint shebang pitfall)
- Deploy: path-filtered via `dorny/paths-filter`, environment-gated (keeweb + cliproxy environments), post-deploy health checks
- Release: Changesets + npm publish with provenance
- **Fro Bot workflow present** (`fro-bot/agent@v0.40.2`) — PR review with structured verdict, 7-category daily autohealing, cross-project intelligence, live site review via browser automation
- Shared ecosystem with ha-config: both extend `fro-bot/.github:common-settings.yaml`, `marcusrbrown/renovate-config`, and `@bfra.me/*` shared configs
- Compound learning pattern: `docs/solutions/` with YAML frontmatter
- 9 workflows total, all using `.yaml` extension and SHA-pinned actions with version comments

Sources: https://github.com/marcusrbrown/infra (SHA 20de04713bf01294217dee4d3b64d5d7cfb2426e)

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

## [2026-04-19 13:58] ingest | repo:fro-bot/.github

Persisted durable knowledge from the workflow_dispatch interaction on fro-bot/.github.

Sources: https://github.com/fro-bot/.github@f1cecf6f7b43ad815f4d8446d0b75992293d2004

## [2026-04-21 00:00] ingest | marcusrbrown/copiloting

Incremental survey of `marcusrbrown/copiloting` (latest SHA `904352923eff555699384071c1c9db87557adb44`, 2026-04-20). Updated repo page `marcusrbrown--copiloting.md` with changes since 2026-04-18 survey.

Changes recorded:

- `fro-bot/agent` bumped through four patch/minor releases: v0.40.2 → v0.41.0 → v0.41.1 → v0.41.2 → v0.41.3 (SHA `36c9850c2ac6e6d4d532662fca2ca89bd2bc559d`)
- `bfra-me/.github` reusable workflows updated v4.16.6 → v4.16.7 (SHA `a518e036563790803ccbd2d90d6a1eb2e08d2fa1`) — affects `renovate.yaml` and `update-repo-settings.yaml`
- `eslint` dev dependency now at 10.2.1 (PR #771)
- `axios` security patch merged (PR #727, 2026-04-18)
- `prettier` at 3.8.3, `mise` tool (jdx/mise) bumped multiple times via Renovate
- Majority of commits were lockfile maintenance (Renovate), no structural changes to repo layout, workflows logic, or Python/TS application code

No new topic or entity pages warranted — existing `langchain.md` and `polyglot-monorepo.md` remain accurate. No new anti-patterns or stale-import resolution observed.

Sources: https://github.com/marcusrbrown/copiloting (SHA 904352923eff555699384071c1c9db87557adb44)

## [2026-04-21 07:13] ingest | repo:marcusrbrown/copiloting

Surveyed marcusrbrown/copiloting and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/copiloting

## [2026-04-21 00:00] ingest | marcusrbrown/extend-vscode

Incremental re-survey of `marcusrbrown/extend-vscode` (SHA `342872f8`, 2026-04-20). Updated repo page `marcusrbrown--extend-vscode.md` and bumped `updated` date on topic page `vscode-extensions.md`. Index unchanged (both pages already cataloged from 2026-04-18 ingest).

Delta from prior survey (SHA `a4dcbbb`, 2026-04-18):

- Three Renovate dependency bumps merged: `type-fest` v5.6.0 (#480), `actions/setup-node` v6.4.0 (#479), `@vscode/vsce` v3.9.0 (#478)
- `bfra-me/.github` renovate reusable workflow now at SHA `65caa6a021ae4a6597bd915f276e1ab9d75dc071` (v4.16.0) — down from v4.16.6 in log entry for copiloting; likely a different reusable workflow pin
- Repository structure, architecture, dual-target build, publishing pipeline, and CI workflows all unchanged
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward from prior ingest
- Current dependency versions confirmed: TypeScript 5.9.3, Vitest 4.1.0, tsup ^8.0.2, eslint 9.39.0, pnpm 10.33.0, VS Code engine `^1.102.0`

Sources: https://github.com/marcusrbrown/extend-vscode (SHA 342872f8de739c03a0263e188395be7ab70457b6)

## [2026-04-22 13:40] ingest | marcusrbrown/.dotfiles

Incremental re-survey of `marcusrbrown/.dotfiles` (latest SHA `ae026c1`, 2026-04-22). Updated repo page `marcusrbrown--dotfiles.md`, topic page `dotfiles.md`, and entity page `mise.md`. Index unchanged (all pages already cataloged).

Delta from prior survey (SHA `dbab7ad`, 2026-04-21):

- **OpenCode model routing overhaul:** All Anthropic direct provider endpoints migrated to GitHub Copilot hosted equivalents. Opus upgraded 4.6 → 4.7. `prometheus` agent removed. `atlas` and `hephaestus` disabled. `librarian` migrated from `opencode-go/minimax-m2.7` to `github-copilot/claude-haiku-4.5`. Category model assignments added for first time: visual-engineering (gemini-3.1-pro), ultrabrain (gpt-5.4 xhigh), deep (gpt-5.4 medium), artistry (gemini-3.1-pro), quick (gpt-5.4-mini), unspecified-low (claude-sonnet-4.6), unspecified-high (claude-opus-4.7 medium), writing (gemini-3-flash)
- **Magic-context v0.13.0:** Historian model migrated to `github-copilot/gpt-5.4`. Added token thresholds for Copilot models (Opus 4.7 at 88K, Sonnet 4.6 at 95K, GPT-5.4 at 140K, Codex at 210K). Reduced history budget to 10%. Added temporal awareness, compaction markers, auto-drop tool age (15), historian timeout (420s)
- **New copilot-cli skill** added (`.agents/skills/copilot-cli/`): Covers non-interactive Copilot CLI delegation, auth, permissions, model selection, JSONL output, bash-subprocess delegation pattern
- **Renovate config:** `opencode-ai` updates now disabled alongside `@anthropic-ai/claude-code`. `opencode-anthropic-oauth` added to unstable automerge list
- **Mise tool changes:** `@biomejs/biome` re-added at 2.4.12, `vibe-tools` added at 0.63.3, `pipx:poetry` added at 2.3.4, language servers added (`pyright`, `remark-language-server`, `typescript-language-server`), `tsx`, `rimraf`, `lolcrab` (github:mazznoer) added. `deno` bumped to 2.7.13
- **Fro Bot workflow:** Unchanged — `fro-bot/agent@v0.41.3` (SHA `36c9850c2ac6e6d4d532662fca2ca89bd2bc559d`)
- **Repository structure, devcontainer, Probot settings, branch protection all unchanged**

Sources: https://github.com/marcusrbrown/.dotfiles (SHA ae026c179cd91cb637443fe7d92bed75df3d6dba)

## [2026-04-21 07:17] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-22 18:48] ingest | repo:marcusrbrown/.dotfiles

Surveyed marcusrbrown/.dotfiles and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.dotfiles

## [2026-04-22 19:00] ingest | marcusrbrown/.github

Re-survey of `marcusrbrown/.github` (SHA `be01029`). No change detected — repo content identical to 2026-04-21 survey. Updated repo page `marcusrbrown--github.md` with new source entry and survey history row. No new topic/entity/comparison pages warranted.

Key findings:

- SHA unchanged (`be01029`): latest commit is `chore(deps): update marcusrbrown/renovate-config preset to v4.5.1 (#354)` from 2026-03-12
- Repository structure, workflows, settings, and community health files all identical to prior survey
- 3 open issues, 0 open PRs, 3 stars, 2 watchers
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

Sources: https://github.com/marcusrbrown/.github (SHA be01029971bc8b50fbd2b660fadc7341da26e03c)

## [2026-04-22 21:56] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-22 22:30] ingest | marcusrbrown/containers

Incremental re-survey of `marcusrbrown/containers` (SHA `1b782ff8`, 2026-04-22). Updated repo page `marcusrbrown--containers.md`. Index unchanged (page already cataloged). No new topic/entity/comparison pages warranted — delta is digest rotations and a minor CI fix.

Delta from prior survey (SHA `fa17128f`, 2026-04-21):

- Multiple base image digest rotations via Renovate: Node.js Alpine (#588, #589, #590) and Debian bullseye-slim (#587)
- Cache cleanup workflow fix: gracefully handle missing cache keys (#585, 2026-04-19)
- Repository structure, Python automation, AI subsystem, template system, Fro Bot workflow all unchanged
- Fro Bot agent still at `v0.41.0` (SHA `fc1387ec...`)
- Renovate preset still `marcusrbrown/renovate-config#4.5.0`

Sources: https://github.com/marcusrbrown/containers (SHA 1b782ff8b0a94615492de36f7f9b1d57e4663113)

## [2026-04-22 22:00] ingest | repo:marcusrbrown/containers

Surveyed marcusrbrown/containers and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/containers

## [2026-04-23 00:00] ingest | marcusrbrown/copiloting

Incremental re-survey of `marcusrbrown/copiloting` (SHA `dcd661f`, 2026-04-22). Updated repo page `marcusrbrown--copiloting.md`. Index unchanged (page already cataloged). No new topic/entity/comparison pages warranted — delta is dependency patches.

Delta from prior survey (SHA `9043529`, 2026-04-21):

- `fro-bot/agent` bumped v0.41.3 → v0.41.4 (PR #776)
- `bfra-me/.github` reusable workflows updated v4.16.7 → v4.16.8 (PR #775)
- `uuid` security update to v14 (PR #777)
- `click` updated to v8.3.3 (PR #774)
- Repository structure, application code, CI workflows, and conventions all unchanged
- Fro Bot integration remains fully active (PR review, triage, daily maintenance, autoheal)

Sources: https://github.com/marcusrbrown/copiloting (SHA dcd661f3a403edc7ffe338a742680847aca38b19)

## [2026-04-23 00:50] ingest | repo:marcusrbrown/copiloting

Surveyed marcusrbrown/copiloting and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/copiloting

## [2026-04-23 12:00] ingest | marcusrbrown/esphome.life

Re-survey of `marcusrbrown/esphome.life` (SHA `e398c2e`, unchanged from 2026-04-21). Updated repo page `marcusrbrown--esphome-life.md` with survey history table. Created entity page `esphome.md` for the ESPHome framework. Updated topic page `home-assistant.md` to wikilink `[[esphome]]`. Updated `index.md` to catalog the new entity page.

No content changes detected in the repository — latest commit (`e398c2e`) is the Renovate dependency bump from 2026-03-12. All device configs, CI workflows, devcontainer settings, Probot settings, and Renovate configuration are identical to the prior survey.

Key findings:

- Repository unchanged since 2026-03-12 (SHA `e398c2e1e3ef8c68717df26fd67a99b5c91410d7`)
- All prior survey observations remain accurate: Olimex ESP32-PoE-ISO Bluetooth Proxies, package-based configs, partial CI coverage (1349f4 only), ESPHome 2025.12.7 pinned across CI and devcontainer
- Renovate preset still `marcusrbrown/renovate-config#4.5.1`, Probot settings extend `fro-bot/.github:common-settings.yaml`
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward
- Created `[[esphome]]` entity page to support cross-referencing from `[[marcusrbrown--esphome-life]]` and `[[home-assistant]]`

Sources: https://github.com/marcusrbrown/esphome.life (SHA e398c2e1e3ef8c68717df26fd67a99b5c91410d7)

## [2026-04-23 01:13] ingest | repo:marcusrbrown/esphome.life

Surveyed marcusrbrown/esphome.life and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/esphome.life

## [2026-04-23 12:00] ingest | marcusrbrown/extend-vscode

Incremental re-survey of `marcusrbrown/extend-vscode` (SHA `342872f8`, unchanged from 2026-04-21). Updated repo page `marcusrbrown--extend-vscode.md` with new source entry and delta log. No changes to topic or entity pages — `vscode-extensions.md` remains accurate. Index unchanged (page already cataloged).

Delta: no repository content changes detected since prior survey. Latest commit still `342872f8` (type-fest v5.6.0 bump, #480). Open issues: 9. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

Sources: https://github.com/marcusrbrown/extend-vscode (SHA 342872f8de739c03a0263e188395be7ab70457b6)

## [2026-04-23 01:38] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-23 14:00] ingest | marcusrbrown/opencode-copilot-delegate

Initial survey of `marcusrbrown/opencode-copilot-delegate` (SHA `bea3f57`). Created repo page `marcusrbrown--opencode-copilot-delegate.md` and topic page `opencode-plugins.md`. Updated `index.md` to catalog both pages.

Key findings:

- Brand-new OpenCode plugin repo (created 2026-04-23), v0.1.0 scaffold — all source files are TODO stubs with implementation plan
- Plugin registers three tools: `copilot_delegate`, `copilot_output`, `copilot_cancel` — delegates tasks to GitHub Copilot CLI as background subprocesses with async `<system-reminder>` completion notifications
- TypeScript (strict, ESM), Bun runtime/build, Biome linting, Changesets for versioning — diverges from other Marcus repos (Biome vs ESLint+Prettier, Bun vs pnpm, `bun test` vs Vitest)
- Comprehensive implementation plan at `docs/plans/2026-04-21-copilot-delegate-plugin.md` covering 11 ordered tasks with QA scenarios, risk mitigation, and documented design decisions
- Peer dependencies on `@opencode-ai/plugin >=1.14.0` and `@opencode-ai/sdk >=1.14.0`
- Auth precedence: `COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN > ~/.copilot/auth`
- Privacy posture: zero telemetry, token values never logged
- **No CI/Fro Bot/Renovate on main yet** — two open PRs pending: #2 (Fro Bot workflow), #3 (Renovate onboarding)
- Cross-references: [[marcusrbrown--dotfiles]] (copilot-cli skill update planned), [[opencode-plugins]] (first Marcus OpenCode plugin)

Sources: https://github.com/marcusrbrown/opencode-copilot-delegate (SHA bea3f576d7218900b9216a8a2c2947003660809b)

## [2026-04-23 06:26] ingest | repo:marcusrbrown/opencode-copilot-delegate

Surveyed marcusrbrown/opencode-copilot-delegate and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/opencode-copilot-delegate

## [2026-04-23 14:30] ingest | marcusrbrown/.github

Re-survey of `marcusrbrown/.github` (SHA `4e4fd28`). Updated repo page `marcusrbrown--github.md`, topic page `probot-settings.md`, and topic page `github-actions-ci.md`. Index unchanged (all pages already cataloged).

Delta from prior survey (SHA `be01029`, 2026-04-22):

- **Prettier upgraded:** 3.8.1 → 3.8.3 (both in CI workflow and renovate postUpgradeTasks)
- **Renovate config preset bumped:** `marcusrbrown/renovate-config#4.5.1` → `#4.5.8`
- **bfra-me/.github reusable workflows updated:** v4.4.0 → v4.16.8 (both renovate.yaml and update-repo-settings.yaml)
- **renovate.yaml restructured:** Added PR trigger (opened/reopened/synchronize/edited), issue edit trigger (non-bot), workflow_call/workflow_dispatch/workflow_run triggers, conditional logic for bot filtering; hourly schedule cron commented out
- **renovate.json5:** `prCreation` set to `'immediate'`
- **.prettierrc.yaml:** Added `.devcontainer/**/devcontainer*.json` to tab-width-4 override
- **Label count:** 48 labels (re-verified)
- **Open issues:** 2 (was 3)
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

No contradictions with prior ingest. Repository structure unchanged (same 15 files, no new paths).

Sources: https://github.com/marcusrbrown/.github (SHA 4e4fd28e9cc19f22324cd3037bbd53a9e2c0cf14)

## [2026-04-23 07:16] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-23 15:30] ingest | marcusrbrown/extend-vscode

Re-survey of `marcusrbrown/extend-vscode` (SHA `342872f8`, unchanged from 2026-04-21). Updated repo page `marcusrbrown--extend-vscode.md` with new source entry and delta log. Bumped `updated` date on topic page `vscode-extensions.md`. Index unchanged (both pages already cataloged).

No merged changes since prior survey. Four open Renovate PRs pending: #466 (TypeScript v6), #467 (ESLint v10), #468 (eslint-plugin-node-dependencies v2), #469 (jsdom v29). Repository content, architecture, workflows, and Probot settings all identical to prior survey. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

Sources: https://github.com/marcusrbrown/extend-vscode (SHA 342872f8de739c03a0263e188395be7ab70457b6)

## [2026-04-23 07:24] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-24 00:00] ingest | marcusrbrown/systematic

Initial survey of `marcusrbrown/systematic` (SHA `ef02119`). Created repo page `marcusrbrown--systematic.md`. Updated topic pages `opencode-plugins.md` and `github-actions-ci.md`. Updated `index.md` to catalog the new page.

Key findings:

- OpenCode plugin published as `@fro.bot/systematic` on npm, latest release v2.5.1 (2026-04-21)
- Adapted from CEP (Compound Engineering Plugin for Claude Code), now evolving independently
- 45 bundled skills (core CE workflows, dev tools, specialized, autonomous) and 50 bundled agents across 6 categories (design, docs, document-review, research, review, workflow)
- TypeScript (strict, ESM), Bun runtime, Biome linter — diverges from `@bfra.me/*` shared config ecosystem used by other Marcus repos
- Three plugin hooks: config (asset merging), tool (`systematic_skill`), system.transform (bootstrap injection)
- CLI for listing/converting assets, OCX registry for component-level distribution
- Starlight/Astro documentation site at fro.bot/systematic
- Semantic-release publishing with provenance; skill/agent content changes trigger patch releases
- 9 GitHub Actions workflows, all SHA-pinned
- **Fro Bot workflow present and active** (`fro-bot/agent@v0.41.4`): PR review with TypeScript/Bun/Biome-specific prompt (zero-class convention, plugin API security), weekly maintenance (Mon 09:00 UTC), daily autohealing (03:30 UTC, 4 categories)
- Renovate extends `marcusrbrown/renovate-config` + `sanity-io/renovate-config:semantic-commit-type`
- Probot settings extend `fro-bot/.github:common-settings.yaml`
- Copilot setup steps workflow present
- CodeQL + OpenSSF Scorecard workflows
- Cross-references established: `opencode-copilot-delegate` (sibling plugin), `dotfiles` (consumes systematic), `copiloting` (historical CEP experimentation)
- Added systematic CI patterns to `github-actions-ci.md` (Bun build + Node verify, Biome, semantic-release)
- Added plugin architecture patterns to `opencode-plugins.md` (config merging, system prompt injection, skill tool, OCX registry)

Sources: https://github.com/marcusrbrown/systematic (SHA ef02119abd801487dc0e53a43ac2d6b6433873ab)

## [2026-04-24 07:19] ingest | repo:marcusrbrown/systematic

Surveyed marcusrbrown/systematic and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/systematic

## [2026-04-24 12:00] ingest | marcusrbrown/.github

Re-survey of `marcusrbrown/.github` (SHA `4e4fd28`, unchanged from 2026-04-23). Updated repo page `marcusrbrown--github.md` with new source entry and survey history row. No new topic/entity/comparison pages warranted — all existing pages remain accurate.

Key findings:

- SHA unchanged (`4e4fd28`): latest commit is `ci(renovate): expand PR trigger (#360)` from 2026-04-23
- All 15 files, 3 workflows, settings, and community health files identical to prior survey
- 2 open issues (#37 — move to another settings action, #214 — Dependency Dashboard), 0 open PRs
- 3 stars, 2 watchers
- Probot settings, Renovate config, Prettier config, branch protection all unchanged
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

Sources: https://github.com/marcusrbrown/.github (SHA 4e4fd28e9cc19f22324cd3037bbd53a9e2c0cf14)

## [2026-04-24 07:23] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-24 12:00] ingest | marcusrbrown/extend-vscode

Re-survey of `marcusrbrown/extend-vscode` (SHA `342872f8`, unchanged from 2026-04-21). Updated repo page `marcusrbrown--extend-vscode.md` with new source entry and delta log. Bumped `updated` date on topic page `vscode-extensions.md`. Index unchanged (both pages already cataloged).

No repository content changes detected since prior survey. HEAD still at `342872f8` (type-fest v5.6.0 bump, #480). Last push 2026-04-20. Same 4 open Renovate PRs (#466–#469) pending merge. Open issues: 5 (#142, #162, #317–#319). 1 star, 1 watcher. Six workflows present; **still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

Sources: https://github.com/marcusrbrown/extend-vscode (SHA 342872f8de739c03a0263e188395be7ab70457b6)

## [2026-04-24 07:28] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-24 12:00] ingest | marcusrbrown/ha-config

Incremental re-survey of `marcusrbrown/ha-config` (SHA `f7ec803`, 2026-04-22). Updated repo page `marcusrbrown--ha-config.md`. Bumped `updated` on topic page `home-assistant.md`. Index unchanged (page already cataloged).

Delta from prior survey (SHA `54a6727`, 2026-04-18):

- `pre-commit` bumped 4.5.1 → 4.6.0 in `mise.toml` (#764)
- `bfra-me/.github` reusable workflows updated v4.16.6 → v4.16.8 (#763, #765)
- Renovate workflow trigger model expanded: added `workflow_run` on CI completion, `push` to non-main branches, `pull_request: [edited]`, and conditional bot filtering
- Repository structure, packages (11), custom components (10), HA version (2025.6.3), Python deps, Probot settings all unchanged
- Prettier at 3.8.3, Renovate config preset at `#4.5.8` (unchanged from prior survey)
- 0 open PRs, 1 open issue (#427 Dependency Dashboard)
- All 20 recent commits are exclusively Renovate dependency bumps — no structural changes
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward
- Added survey history table and expanded Renovate trigger model documentation to repo page

Sources: https://github.com/marcusrbrown/ha-config (SHA f7ec8038cca071e36848057d00d1c165cef5f357)

## [2026-04-24 07:32] ingest | repo:marcusrbrown/ha-config

Surveyed marcusrbrown/ha-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/ha-config
