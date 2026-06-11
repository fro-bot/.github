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

## [2026-04-24 18:00] ingest | marcusrbrown/infra

Incremental re-survey of `marcusrbrown/infra` (SHA `9306b9b`, 2026-04-24). Updated repo page `marcusrbrown--infra.md` and topic page `github-actions-ci.md`. Index unchanged (both pages already cataloged).

Delta from prior survey (SHA `20de047`, 2026-04-18):

- **Deploy pipeline split** (#165, 2026-04-20): Monolithic `deploy.yaml` split into dedicated `deploy-keeweb.yaml` and `deploy-cliproxy.yaml` workflows, each with independent path filtering, environment gating, and secret validation. `deploy.yaml` retained as thin `workflow_call` orchestrator (dispatch-only). Total workflows: 9 → 11.
- **Convention enforcement** (#161, #167, 2026-04-21): New `packages/cli/src/conventions.test.ts` mechanically gates root AGENTS.md rules pre-merge via Bun tests. `(enforced)` marker drift detection ensures test assertions and AGENTS.md markers stay in sync. Per-app invariants also verified.
- **Fro Bot agent bumped:** v0.40.2 → v0.41.4 (SHA `28bcadbf`). Autohealing expanded to include CLIProxy health monitoring (#155): reachability, environment secrets, host keys, indirect OAuth token health inference.
- **CLI version:** 0.4.3 → 0.4.5. Rate limit retry fix in cliproxy setup (#176). Workflow name references updated for split deploy pipeline (#166).
- **CLIProxyAPI Docker image:** v6.9.30 → v6.9.35 (multiple digest rotations via Renovate). Caddy updated to 2.11.2-alpine.
- **Renovate config:** Added rule to disable `bfra-me/.github` digest updates (#157).
- **Dependencies:** `actions/setup-node` → v6.4.0, `bfra-me/.github` reusable workflows updated, `lint-staged` → 16.1.2, `eslint-config-prettier` → 10.1.8.
- **Open issues:** 4 (2 autohealing reports, 1 rate limit investigation #144, 1 Dependency Dashboard). 0 open PRs.
- **No contradictions** with prior survey — all prior findings confirmed and extended.

Sources: https://github.com/marcusrbrown/infra (SHA 9306b9bef8e6d3c6f821ee0c4df99e24acb750ac)

## [2026-04-24 07:37] ingest | repo:marcusrbrown/infra

Surveyed marcusrbrown/infra and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/infra

## [2026-04-25 00:00] ingest | marcusrbrown/tokentoilet

Re-survey of `marcusrbrown/tokentoilet` (SHA `97e96c1`, unchanged from 2026-04-24). Updated repo page `marcusrbrown--tokentoilet.md` with new source entry and survey history row. Bumped `updated` date on topic page `web3-defi.md`. Index unchanged (both pages already cataloged).

Delta from prior survey (SHA `97e96c1`, 2026-04-24):

- SHA unchanged (`97e96c1`): latest commit is `chore(deps): update fro-bot/agent to v0.41.4 (#934)` from 2026-04-22
- Recent commits since last survey are exclusively Renovate dependency bumps: `bfra-me/.github` v4.16.8 (#933), `pnpm/action-setup` v6.0.3 (#931), `actions/setup-node` v6.4.0 (#927), TypeScript v6.0.3 (#926) — all already captured in prior survey
- Open issues: 25 → 26
- Open PRs: 5 (all Renovate) — same major-version PRs pending: wagmi v3 (#837), lucide-react v1 (#835), `@eslint-react/eslint-plugin` v4 (#909), `@bfra.me/eslint-config` ^0.51.0 (#897). New: lockfile maintenance (#929)
- Repository structure, application code, CI workflows, Fro Bot integration, Vercel deployment, and conventions all identical to prior survey
- **Fro Bot workflow present** — `fro-bot/agent@v0.41.4`, no change
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/tokentoilet (SHA 97e96c1425a9232e5b783c680cade8505e1c8de1)

## [2026-04-25 06:50] ingest | repo:marcusrbrown/tokentoilet

Surveyed marcusrbrown/tokentoilet and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/tokentoilet

## [2026-04-25 12:00] ingest | marcusrbrown/.github

Re-survey of `marcusrbrown/.github` (SHA `4e4fd28`, unchanged from 2026-04-24). Updated repo page `marcusrbrown--github.md` with new source entry and survey history row. No new topic/entity/comparison pages warranted — all existing pages remain accurate.

Key findings:

- SHA unchanged (`4e4fd28`): latest commit is `ci(renovate): expand PR trigger (#360)` from 2026-04-23
- All 15 files, 3 workflows, settings, and community health files identical to prior survey
- 2 open issues (#37 — move to another settings action, #214 — Dependency Dashboard), 0 open PRs
- 3 stars, 2 watchers
- Probot settings, Renovate config, Prettier config, branch protection all unchanged
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

Sources: https://github.com/marcusrbrown/.github (SHA 4e4fd28e9cc19f22324cd3037bbd53a9e2c0cf14)

## [2026-04-25 06:54] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-25 06:57] ingest | marcusrbrown/extend-vscode

Re-survey of `marcusrbrown/extend-vscode` (SHA `342872f8`, unchanged from 2026-04-20). Updated repo page `marcusrbrown--extend-vscode.md` with new source entry and delta log. Bumped `updated` date on topic page `vscode-extensions.md`. Index unchanged (both pages already cataloged).

No repository changes detected — HEAD unchanged at `342872f8` for 5 days. Same 4 open Renovate PRs (#466–#469) pending merge. Open issues: 5 (#142, #162, #317–#319). Full dependency snapshot confirmed. **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

Sources: https://github.com/marcusrbrown/extend-vscode (SHA 342872f8de739c03a0263e188395be7ab70457b6)

## [2026-04-25 06:59] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-25 12:00] ingest | marcusrbrown/infra

Re-survey of `marcusrbrown/infra` (SHA `9306b9b`, unchanged from 2026-04-24). Updated repo page `marcusrbrown--infra.md` with new source entry and survey history row. No new topic/entity/comparison pages warranted — all existing pages remain accurate.

Delta from prior survey (SHA `9306b9b`, 2026-04-24):

- SHA unchanged (`9306b9b`): latest commit is `chore(🦋📦): version packages (#170)` from 2026-04-24
- Open issues: 4 → 5 (new autohealing report #178 from 2026-04-25, clean report: no errored PRs)
- Open PRs: 0 (unchanged)
- All 11 workflows, Fro Bot v0.41.4, CLI v0.4.5, deploy pipeline, conventions tests, infrastructure components all identical to prior survey
- **Fro Bot workflow present** — no change
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/infra (SHA 9306b9bef8e6d3c6f821ee0c4df99e24acb750ac)

## [2026-04-25 07:03] ingest | repo:marcusrbrown/infra

Surveyed marcusrbrown/infra and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/infra

## [2026-04-25 12:00] ingest | marcusrbrown/marcusrbrown.github.io

Initial survey of `marcusrbrown/marcusrbrown.github.io` (SHA `ec4b785`). Created repo page `marcusrbrown--marcusrbrown-github-io.md`. Updated topic pages `github-pages.md` and `github-actions-ci.md`. Updated `index.md` to catalog the new page.

Key findings:

- Personal brand site deployed to GitHub Pages at marcusrbrown.com (custom domain via CNAME in `public/`)
- React 19 + TypeScript 6.0 (strict) + Vite 7 + pnpm 10.33.0 + Node 22+, pure ESM
- Single-page portfolio with anchor-linked sections: About, Experience, Skills, Contact — no routing
- PascalCase hook convention (`UseScrollReveal.ts`), consistent with [[marcusrbrown--mrbro-dev]]
- Comprehensive CI pipeline: 6 parallel quality gate jobs (lint, build, test, type-check, dependency audit)
- **Fro Bot workflow present** (`fro-bot/agent@v0.41.4`): PR review with structured verdict, daily maintenance at 15:30 UTC, @fro-bot mention support
- **No Fro Bot autoheal workflow** — present in sibling repos (mrbro.dev, vbs, containers, etc.)
- **No Probot `settings.yml`** — branch protection not managed via Probot (unusual for Marcus repos)
- Renovate extends `marcusrbrown/renovate-config#4.5.8`, reusable workflow via `bfra-me/.github` v4.16.8
- Copilot setup steps workflow present; AGENTS.md and copilot-instructions.md comprehensive
- Accessibility testing via vitest-axe + axe-core
- Related to [[marcusrbrown--mrbro-dev]] (both React+Vite GitHub Pages sites, different scope)
- Recent activity is exclusively Renovate dependency bumps

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io (SHA ec4b7854bee556aadd301950392268f70817d800)

## [2026-04-25 07:08] ingest | repo:marcusrbrown/marcusrbrown.github.io

Surveyed marcusrbrown/marcusrbrown.github.io and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io

## [2026-04-26 12:00] ingest | marcusrbrown/.github

Re-survey of `marcusrbrown/.github` (SHA `99906ef`, up from `4e4fd28`). Updated repo page `marcusrbrown--github.md`. No new topic/entity/comparison pages warranted.

Delta from prior survey (SHA `4e4fd28`, 2026-04-25):

- **Renovate schedule re-enabled:** Two commits (#361, #362) re-enabled the cron schedule trigger and set it to `15 */4 * * *` (every 4 hours at :15). Previously the schedule was commented out in favor of pure event-driven execution.
- Only file changed: `.github/workflows/renovate.yaml` (+2 / -2 lines)
- 2 open issues (#37, #214), 0 open PRs (unchanged)
- 3 stars, 2 watchers (unchanged)
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

Sources: https://github.com/marcusrbrown/.github (SHA 99906ef)

## [2026-04-26 12:00] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-26 07:11] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-26 07:14] ingest | marcusrbrown/extend-vscode

Incremental re-survey of `marcusrbrown/extend-vscode` (SHA `b457a34f`, up from `342872f8`). Updated repo page `marcusrbrown--extend-vscode.md` with new source entry and delta log. Bumped `updated` date on topic page `vscode-extensions.md`. Index unchanged (both pages already cataloged).

Delta from prior survey (SHA `342872f8`, 2026-04-25):

- One Renovate dependency bump merged, breaking a 5-day dormant streak: `typescript-eslint` → v8.59.0 (#481, 2026-04-25)
- All other dependencies, repository structure, architecture, workflows, publishing pipeline, and Probot settings unchanged
- Same 4 open Renovate PRs (#466–#469) pending merge
- Open issues: 5 (#142, #162, #317–#319)
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

Sources: https://github.com/marcusrbrown/extend-vscode (SHA b457a34f032149b03dddaca99eacca14eac91367)

## [2026-04-26 07:16] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-26 12:00] ingest | marcusrbrown/infra

Incremental re-survey of `marcusrbrown/infra` (SHA `cd3bb16`, up from `9306b9b`). Updated repo page `marcusrbrown--infra.md` and topic page `github-actions-ci.md`. Index unchanged (both pages already cataloged).

Delta from prior survey (SHA `9306b9b`, 2026-04-25):

- **Fro Bot agent bumped:** v0.41.4 → v0.42.1 (SHA `6c45d8ce66b0b69f1b80b23f283ed455deb59517`, #183)
- **New autohealing category 8: Upstream Modernization Watch** (#182, 2026-04-25) — Sunday-only scan of pinned upstreams (CLIProxyAPI, Caddy, fro-bot/agent, bfra-me/.github) for config/feature adoption opportunities. Claude-only filter for CLIProxyAPI. Action policy: low-risk mechanical changes get draft PR, workflow/config changes documented in tracking issue only. Renovate still owns version bumps.
- **CLIProxy container healthcheck switched to `/healthz`** (#181, 2026-04-25) — Docker healthcheck now uses `wget --spider http://localhost:8317/healthz` with 30s interval, 5s timeout, 3 retries, 10s start period
- **CLI version:** 0.4.5 → 0.4.6 (Changesets release #180)
- **CLIProxyAPI Docker tag:** v6.9.35 → v6.9.38 (#179, Renovate digest rotation)
- **Open issues:** 5 → 4 (autohealing report #184 added, prior reports closed)
- **Open PRs:** 0 (unchanged)
- Repository structure, apps, deploy pipeline, conventions, branch protection all unchanged
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/infra (SHA cd3bb1631e67563c58df099feda5c53ea2e78d18)

## [2026-04-26 12:00] ingest | repo:marcusrbrown/infra

Surveyed marcusrbrown/infra and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/infra

## [2026-04-26 07:21] ingest | repo:marcusrbrown/infra

Surveyed marcusrbrown/infra and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/infra

## [2026-04-26 12:00] ingest | marcusrbrown/mrbro.dev

Incremental re-survey of `marcusrbrown/mrbro.dev` (SHA `d8c0e43`, up from `51f5cab`). Updated repo page `marcusrbrown--mrbro-dev.md`. No new topic/entity/comparison pages warranted — existing `github-pages.md` and `github-actions-ci.md` remain accurate. Index unchanged (page already cataloged).

Delta from prior survey (SHA `51f5cab`, 2026-04-18):

- **Fro Bot agent bumped:** v0.38.0 → v0.41.3 (SHA `36c9850c2ac6e6d4d532662fca2ca89bd2bc559d`), across both `fro-bot.yaml` and `fro-bot-autoheal.yaml`
- **`opencode-config` secret added** to both fro-bot workflows (#135, 2026-04-19)
- **Renovate config preset bumped:** `marcusrbrown/renovate-config#4.5.7` → `#4.5.8`
- **bfra-me/.github reusable workflows:** updated to v4.16.7 (SHA `a518e036563790803ccbd2d90d6a1eb2e08d2fa1`)
- **Security remediations via pnpm overrides:** `basic-ftp` 5.3.0 (#136), `lodash`/`lodash-es` >=4.18.0 (#109), `brace-expansion` >=5.0.5, `path-to-regexp` >=0.1.13, `picomatch` >=4.0.4. Vite upgraded to v7.3.2 for security fix (#121)
- **actions/setup-node** updated to v6.4.0 (#137)
- **No `.github/settings.yml`** — Probot Settings not configured, unusual for Marcus repos. Branch protection managed via scripts instead
- **Open issues:** 39 (majority are Daily Autohealing Reports — multiple separate daily issues open rather than rolling single issue, possible autoheal behavioral drift)
- **Open PRs:** 4 (#85/#87 stale security fixes from fro-bot/Copilot, #142 non-major deps from Renovate, #145 fro-bot hook rename)
- **TypeScript** still at ^5.6.3 (sibling repos have moved to v6)
- **package.json `repository.url`** incorrectly points to `marcusrbrown.github.io.git` — copy artifact from sibling repo
- Added `marcusrbrown--marcusrbrown-github-io` as related repo in frontmatter (sibling React+Vite GitHub Pages site)
- No contradictions with prior survey — all findings confirmed and extended
- Recent commits are exclusively Renovate dependency bumps and security fixes; no structural changes

Sources: https://github.com/marcusrbrown/mrbro.dev (SHA d8c0e43a471aa41b030890122d75450b5626b981)

## [2026-04-26 12:00] ingest | repo:marcusrbrown/mrbro.dev

Surveyed marcusrbrown/mrbro.dev and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/mrbro.dev

## [2026-04-26 07:26] ingest | repo:marcusrbrown/mrbro.dev

Surveyed marcusrbrown/mrbro.dev and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/mrbro.dev

## [2026-04-27 12:00] ingest | marcusrbrown/.github

Incremental re-survey of `marcusrbrown/.github` (SHA `3fb30a4`, up from `99906ef`). Updated repo page `marcusrbrown--github.md` and topic page `probot-settings.md`. Index unchanged (all pages already cataloged).

Delta from prior survey (SHA `99906ef`, 2026-04-26):

- **bfra-me/.github reusable workflows bumped:** v4.16.8 → v4.16.9 (SHA `4b85695b1ef6f57b52e29c92c027efeec65de2be`) in both `renovate.yaml` and `update-repo-settings.yaml` (PR #363, 2026-04-27)
- Only files changed: `.github/workflows/renovate.yaml` and `.github/workflows/update-repo-settings.yaml`
- 2 open issues (#37 — move to another settings action, #214 — Dependency Dashboard), 0 open PRs (unchanged)
- 3 stars, 2 watchers (unchanged)
- Repository structure, CI pipeline, Prettier config, Renovate config, settings, and community health files all unchanged
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward

Sources: https://github.com/marcusrbrown/.github (SHA 3fb30a4)

## [2026-04-27 07:47] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-04-27 12:00] ingest | marcusrbrown/extend-vscode

Re-survey of `marcusrbrown/extend-vscode` (SHA `b457a34f`, unchanged from 2026-04-26). Updated repo page `marcusrbrown--extend-vscode.md` with new source entry and delta log. Bumped `updated` date on topic page `vscode-extensions.md`. Index unchanged (both pages already cataloged).

No repository content changes detected since prior survey. HEAD still at `b457a34f` (`typescript-eslint` v8.59.0 bump, #481). Last push: 2026-04-25T15:12:46Z. Same 4 open Renovate PRs (#466–#469) pending merge. Open issues: 5 (#142, #162, #317–#319). Repo metadata: 1 star, 1 watcher, not archived.

Full dependency snapshot captured with expanded coverage (added `eslint-config-prettier`, `@vitest/ui`, `@vitest/coverage-v8`, `tsx`, `semantic-release-vsce`, `jiti`, `ovsx`, `type-fest`). All prior findings confirmed — no contradictions.

**Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward.

Sources: https://github.com/marcusrbrown/extend-vscode (SHA b457a34f032149b03dddaca99eacca14eac91367)

## [2026-04-27 07:52] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-04-27 12:00] ingest | marcusrbrown/infra

Incremental re-survey of `marcusrbrown/infra` (SHA `938fa7c`, up from `cd3bb16`). Updated repo page `marcusrbrown--infra.md`. Index unchanged (page already cataloged). No new topic/entity/comparison pages warranted — delta is dependency bumps only.

Delta from prior survey (SHA `cd3bb16`, 2026-04-26):

- **Fro Bot agent bumped:** v0.42.1 → v0.42.2 (SHA `94d8a156570d68d2461ab496b589e63bdcd6ba84`, #185)
- **CLIProxyAPI Docker tag:** v6.9.38 → v6.9.39 (#186, Renovate digest rotation)
- **bfra-me/.github reusable workflows:** v4.16.8 → v4.16.9 (SHA `4b85695b1ef6f57b52e29c92c027efeec65de2be`, #188) — affects `renovate.yaml` and `update-repo-settings.yaml`
- **Open issues:** 4 → 5 (new autohealing report #189 from 2026-04-27)
- **Open PRs:** 0 → 1 (#187 — Changesets version packages, by mrbro-bot)
- CLI version unchanged at v0.4.6; Caddy unchanged at 2.11.2-alpine
- Repository structure, apps, deploy pipeline, conventions, branch protection all unchanged
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/infra (SHA 938fa7c5fb1d10e844a214048e7928afe3095b79)

## [2026-04-27 07:57] ingest | repo:marcusrbrown/infra

Surveyed marcusrbrown/infra and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/infra

## [2026-04-27 12:00] ingest | marcusrbrown/opencode-copilot-delegate

Incremental re-survey of `marcusrbrown/opencode-copilot-delegate` (SHA `02cac9c`, up from `bea3f57`). Updated repo page `marcusrbrown--opencode-copilot-delegate.md` and topic page `opencode-plugins.md`. Index unchanged (both pages already cataloged).

Delta from prior survey (SHA `bea3f57`, 2026-04-23):

- **Implementation complete:** All `src/` files are now working code, not TODO stubs. The 11-task implementation plan has been executed.
- **CI active on main:** `ci.yaml` runs lint (Biome), typecheck, build, and unit tests. Required status check for branch protection.
- **Fro Bot merged and active:** `fro-bot.yaml` with `fro-bot/agent@v0.42.2` (SHA `94d8a156570d68d2461ab496b589e63bdcd6ba84`). PR review (structured verdict) + daily autohealing (16:00 UTC, 4-category sweep, perpetual single-issue strategy). Required status check.
- **Renovate active:** Extends `marcusrbrown/renovate-config#4.5.8`, post-upgrade runs bun install + fix + build.
- **Release pipeline:** Changesets via `changesets/action@v1.7.0`, GitHub App token auth, npm provenance.
- **Update Repo Settings workflow added:** Probot settings sync extending `fro-bot/.github:common-settings.yaml`
- **Copilot Setup Steps workflow added**
- **Biome upgraded:** 1.9.4 → 2.4.13 (major version bump)
- **TypeScript:** Now at ^6.0.3 (was unspecified version in scaffold)
- **Runtime dependency added:** `fkill` 10.0.3 for cross-platform process tree kill
- **Mise tooling added:** Bun 1.3.13, opencode-ai 1.14.27, @github/copilot 1.0.36
- **Branch protection configured:** Required checks (Fro Bot, CI, Renovate), enforce admins, linear history
- **3 open issues:** #38 (integration tests not in CI), #26 (Daily Autohealing Report), #25 (Dependency Dashboard)
- **0 open PRs** (all onboarding PRs merged)
- **`docs/solutions/` directory added** for documented solutions with YAML frontmatter
- Added `fkill` process tree management pattern to `opencode-plugins.md` topic page

Sources: https://github.com/marcusrbrown/opencode-copilot-delegate (SHA 02cac9c024744a290c9257d5c740d2a83e2c8e42)

## [2026-04-27 08:04] ingest | repo:marcusrbrown/opencode-copilot-delegate

Surveyed marcusrbrown/opencode-copilot-delegate and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/opencode-copilot-delegate

## [2026-04-28 00:00] ingest | marcusrbrown/renovate-config

Initial survey of `marcusrbrown/renovate-config` (SHA `bf13a82`). Created repo page `marcusrbrown--renovate-config.md`. Updated topic page `github-actions-ci.md` (added to repos list, Renovate config section, and Fro Bot agent table). Updated `index.md` to catalog the new page. No new topic/entity/comparison pages created — existing pages cover all cross-cutting concerns.

Key findings:

- Canonical dependency-update policy repo consumed by every `marcusrbrown/*` and `fro-bot/*` repository (16 known downstream consumers documented)
- Three preset files: `default.json` (primary, extends `bfra-me/renovate-config#5.2.1`), `onboarding.json` (new repo bootstrap), `archived-repository.json` (archived repo minimal policy)
- Self-referential Renovate config in `.github/renovate.json5` — uses `local>marcusrbrown/renovate-config` with custom regex manager tracking `bfra-me/renovate-config` preset pin
- `default.json` key policies: no rate limiting, semver range preservation, npm unpublish safety, GitHub Action digest pinning, immediate PR creation for own-org packages with zero minimum release age
- semantic-release pipeline with bare semver tags and major version branch updates (`v4`, `v5`, etc.) enabling downstream `#v4` floating pins
- Latest release: `4.5.8` (2026-04-17), Node.js 24.15.0, pnpm 10.33.2
- ESLint via `@bfra.me/eslint-config` (single re-export, no local overrides), Prettier via `@bfra.me/prettier-config/120-proof`
- **Fro Bot workflow present and active** (`fro-bot/agent@v0.42.2`): Renovate-domain-specific PR review (schema compliance, backward compat, downstream PR storm risk), daily maintenance at 15:30 UTC
- **Fro Bot Autoheal present** (daily 03:30 UTC): 5-category sweep — errored PRs, security, config validation & preset quality, developer experience, bfra-me ecosystem health
- Probot settings extend `fro-bot/.github:common-settings.yaml`, branch protection requires Analyze, CodeQL, Fro Bot, Lint, Release, Renovate checks
- Comprehensive AGENTS.md with Renovate preset authoring patterns and testing strategies
- 7 workflows total: main.yaml (lint + release), fro-bot.yaml, fro-bot-autoheal.yaml, renovate.yaml (reusable from bfra-me), codeql-analysis.yaml, scorecard.yaml, update-repo-settings.yaml
- Consumer version pins vary: most on `#4.5.8`, `copiloting` on floating `#v4`, `containers`/`extend-vscode` on older `#4.5.0`
- 46 open issues, 0 stars — issue count likely reflects dependency dashboard + autohealing reports

Sources: https://github.com/marcusrbrown/renovate-config (SHA bf13a82fca143cd0cdcc9c5f12ef56c2b5196c20)

## [2026-04-28 00:00] ingest | repo:marcusrbrown/renovate-config

Surveyed marcusrbrown/renovate-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/renovate-config

## [2026-04-28 07:48] ingest | repo:marcusrbrown/renovate-config

Surveyed marcusrbrown/renovate-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/renovate-config

## [2026-04-30 21:00] ingest | marcusrbrown/sparkle

Re-survey of `marcusrbrown/sparkle` (SHA `712ab1b`, up from `770356b`). Updated repo page `marcusrbrown--sparkle.md`. Updated topic page `github-actions-ci.md` to include sparkle in repos list, Renovate config section, and Fro Bot agent table. Added sparkle to `index.md` (was missing from catalog despite existing page). No new topic/entity/comparison pages created.

Delta from prior survey (SHA `770356b`, 2026-04-28):

- **Renovate config preset bumped:** `marcusrbrown/renovate-config#4.5.8` → `#4.5.9` (#1614, 2026-04-30)
- **bfra-me/.github reusable workflows bumped:** v4.16.9 → v4.16.11 (#1612, #1613, 2026-04-30) — affects `renovate.yaml` and `update-repo-settings.yaml`
- **Lockfile maintenance:** #1611 (2026-04-27)
- Repository structure, architecture, workspace packages, CI pipeline, documentation pipeline, Probot settings, conventions all unchanged
- **Still no Fro Bot agent workflow** — follow-up PR recommended
- Open issues: 5 (#57 Uplift sparkle, #212 Dependency Dashboard, #876 Astro Phase 6, #1507 Storybook test-runner, #1604 Astro v6 security update)
- Recent commits are exclusively Renovate dependency bumps — no structural changes since prior survey

Sources: https://github.com/marcusrbrown/sparkle (SHA 712ab1bc2fdcd59ec9b8a2d71ad6d9ca88a023c5)

## [2026-05-01 03:55] ingest | repo:marcusrbrown/sparkle

Surveyed marcusrbrown/sparkle and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/sparkle

## [2026-05-01 12:00] ingest | marcusrbrown/sparkle

Re-survey of `marcusrbrown/sparkle` (SHA `712ab1b`, unchanged from 2026-04-30). Updated repo page `marcusrbrown--sparkle.md` with new source entry, survey history row, and open PRs/issues section. Index unchanged (page already cataloged). No new topic/entity/comparison pages warranted.

Delta from prior survey (SHA `712ab1b`, 2026-04-30):

- SHA unchanged (`712ab1b`): latest commit is `chore(deps): update marcusrbrown/renovate-config preset to v4.5.9 (#1614)` from 2026-04-30
- Open PRs: 2 — #1604 (Astro v6 security update, Renovate) and #1507 (Storybook test-runner bump, Renovate)
- Open issues: 5 — #57 (Uplift sparkle), #212 (Dependency Dashboard), #876 (Astro Phase 6), plus 2 Renovate PRs reflected as issues
- All prior survey observations confirmed: workspace layout, build graph, tech stack, CI pipeline, documentation pipeline, Probot settings, developer tooling, conventions
- Renovate preset at `#4.5.9`, `bfra-me/.github` at v4.16.11, pnpm 10.33.2, Node 24.15.0, TypeScript 5.9.3
- **Still no Fro Bot agent workflow** — follow-up PR recommendation carried forward
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/sparkle (SHA 712ab1bc2fdcd59ec9b8a2d71ad6d9ca88a023c5)

## [2026-05-01 07:43] ingest | repo:marcusrbrown/sparkle

Surveyed marcusrbrown/sparkle and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/sparkle

## [2026-05-06 12:00] ingest | marcusrbrown/tokentoilet

Incremental re-survey of `marcusrbrown/tokentoilet` (SHA `0aa1d9a`, up from `97e96c1`). Updated repo page `marcusrbrown--tokentoilet.md` and topic page `web3-defi.md`. Index unchanged (both pages already cataloged).

Delta from prior survey (SHA `97e96c1`, 2026-04-25):

- **Fro Bot agent bumped:** v0.41.4 → v0.42.6 (SHA `80b2c18bb1c70df96b3f150c7827c13ca0e35655`) — four intermediate releases (v0.42.1, v0.42.2, v0.42.5, v0.42.6)
- **pnpm bumped:** 10.33.0 → 10.33.2 (#937, #943)
- **Tailwind CSS bumped:** 4.2.2 → 4.2.4 (#938)
- **postcss bumped:** 8.5.10 → 8.5.12 (#951, #952)
- **pnpm/action-setup updated:** v6.0.3 → v6.0.5 (#966)
- **Open issues:** 26 → 30 (net gain from autohealing reports)
- **Open PRs:** 6 (wagmi v3 #837, lucide-react v1 #835, eslint-config #897, lockfile maintenance #929, Copilot security fix #941, postcss #974). `@eslint-react/eslint-plugin` v4 (#909) no longer in open PRs
- **Copilot coding agent active:** PR #941 authored by GitHub Copilot (security overrides for postcss/axios + setState-in-effect lint fix). Three Copilot branches observed: `copilot/fix-lint-issues`, `copilot/address-review-concerns`, `copilot/resolve-daily-autohealing-report-2026-04-26`
- All commits since prior survey are exclusively Renovate dependency bumps — no structural changes, no application code changes
- Repository structure, MVP disposal flow, CI pipeline, Vercel deployment, conventions all unchanged
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/tokentoilet (SHA 0aa1d9a02f1a8ba5cbd95818fb6157318cf9f20b)

## [2026-05-06 07:52] ingest | repo:marcusrbrown/tokentoilet

Surveyed marcusrbrown/tokentoilet and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/tokentoilet

## [2026-05-07 06:00] ingest | marcusrbrown/vbs

Incremental re-survey of `marcusrbrown/vbs` (SHA `b3c415b`, up from `dd10e05`). Updated repo page `marcusrbrown--vbs.md`. Index unchanged (page already cataloged). No new topic/entity/comparison pages warranted — delta is exclusively Renovate dependency bumps.

Delta from prior survey (SHA `dd10e05`, 2026-04-25):

- **`fro-bot/agent` bumped:** v0.41.4 → v0.42.8 (through v0.42.1, v0.42.4, v0.42.5, v0.42.6, v0.42.7; SHA `fee26493b0f82a9a00241fe24fb0aede8174d1d2`)
- **Renovate config preset bumped:** `marcusrbrown/renovate-config#4.5.8` → `#4.5.9` (PR #537)
- **`bfra-me/.github` reusable workflows:** v4.16.8 → v4.16.12 (PRs #528, #536, #543)
- **pnpm bumped:** 10.33.0 → 10.33.2
- **Non-major dependency batches:** eslint, vitest, prettier, lint-staged, codecov-action, and others via PRs #527, #533, #549
- **Open PRs:** 7 (6 stacking Star Trek data updates #454–#546, 1 Copilot feature PR #458)
- **Open issues:** 30 (net growth from ~23, majority autohealing reports)
- **Accumulating data-update PRs:** 6 unmerged weekly data PRs (data-29 through data-34) — possible review bottleneck
- All 15 commits since prior survey are Renovate-authored; no structural or application code changes
- Repository structure, architecture, CI pipeline, conventions, Fro Bot integration all unchanged
- No contradictions with prior ingest

Sources: https://github.com/marcusrbrown/vbs (SHA b3c415bc4e0e25dd4e5ca8ccdc5ae7aaac9cbdec)

## [2026-05-07 04:05] ingest | repo:marcusrbrown/vbs

Surveyed marcusrbrown/vbs and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/vbs

## [2026-05-08 12:00] ingest | fro-bot/agent

Re-survey of `fro-bot/agent` (SHA `ef6b952`, unchanged from 2026-05-07). Updated repo page `fro-bot--agent.md` with additive detail. Updated `index.md` entry description. No new topic/entity/comparison pages warranted.

Delta from prior survey (SHA `ef6b952`, 2026-05-07):

- SHA unchanged (`ef6b952`): latest commit is `fix(deps): update dependency @aws-sdk/client-s3 to v3.1040.0 (#595)` from 2026-05-04
- **Structural discrepancy found:** `src/services/` contains `artifact/` (upload.ts, upload.test.ts, index.ts) — not `object-store/` as documented in AGENTS.md and prior survey's architecture table. S3 object-store code may have been refactored or consolidated elsewhere. Noted as contradiction in page.
- **Workspace package detail added:** `@fro-bot/action` (apps/action) depends on `@fro-bot/runtime` (packages/runtime) via workspace protocol. Runtime exports `@bfra.me/es` and `@opencode-ai/sdk` as direct deps.
- **Documentation artifacts cataloged:** `docs/` contains 7 subdirectories (audits, brainstorms, examples, ideation, plans, solutions, wiki). `FEATURES.md` documents v1.4 MVP with 73 features across 12 categories. `PRD.md` and `RFCS.md` also present at repo root.
- **pnpm-workspace.yaml security overrides documented:** 11 package overrides for supply-chain hardening.
- 7 open issues, 0 stars, 0 forks, latest release v0.42.8 (2026-05-06)
- All 15 recent commits are Renovate dependency bumps — no structural changes since initial survey
- No contradictions with prior ingest beyond the `artifact/` vs `object-store/` discrepancy
- **Fro Bot workflow present and self-hosted** — unchanged

Sources: https://github.com/fro-bot/agent (SHA ef6b9525583d13f9443b80e6ceffff8af978410a)

## [2026-05-08 15:02] ingest | repo:fro-bot/agent

Surveyed fro-bot/agent and updated the control-plane wiki.

Sources: https://github.com/fro-bot/agent

## [2026-05-17 04:30] ingest | marcusrbrown/ha-config

Re-survey of `marcusrbrown/ha-config` (SHA `f80fbc1`, up from `f7ec803` on 2026-04-24). Updated `marcusrbrown--ha-config.md` additively with a fourth survey row; appended a pin-drift note to topic page `home-assistant.md`. No structural changes to packages (still 11) or custom_components (still 10).

Deltas since prior survey:

- Renovate preset crossed a major boundary: `marcusrbrown/renovate-config#4.5.8 → #5.2.0` (PR #776, merged 2026-05-16)
- Reusable workflows from `bfra-me/.github` advanced v4.16.8 → v4.16.17 (pinned SHA `5cb8bc230d36f005cd2de807fe408b428a44c4d5`) for both `renovate.yaml` and `update-repo-settings.yaml`
- Open issue count 1 → 3: Renovate has queued #777 (esphome v2026 major) and #766 (asyncio-mqtt v0.16.2) in addition to the dashboard
- `.HA_VERSION` still pinned at `2025.6.3` across three surveys spanning ~11 months — flagged as a CI pin-drift footgun on the [[home-assistant]] topic page
- Fro Bot agent workflow still absent — follow-up draft PR remains warranted

Sources: https://github.com/marcusrbrown/ha-config (SHA f80fbc124c0765b8685c3cd98fe3d8eff832e872)

## [2026-05-17 21:19] ingest | repo:marcusrbrown/ha-config

Surveyed marcusrbrown/ha-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/ha-config

## [2026-05-18 08:56] ingest | marcusrbrown/marcusrbrown.github.io

Incremental re-survey of `marcusrbrown/marcusrbrown.github.io` (SHA `4cd8198`, up from `ec4b785` on 2026-04-25). Additive update to repo page `marcusrbrown--marcusrbrown-github-io.md`. Index unchanged (page already cataloged with accurate description). No new topic/entity/comparison pages warranted — `github-pages.md` and `github-actions-ci.md` already cover the cross-cutting concerns observed here.

Deltas since prior survey:

- **Fro Bot agent bumped seven times in three weeks:** v0.41.4 → v0.42.6 → v0.42.7 → v0.43.0 → v0.43.1 → v0.43.2 → v0.43.3 → **v0.44.0** (current, pinned via SHA `b030b53b1b47b1bed77a581222706c900cc63b0e`)
- **Autoheal integrated into `fro-bot.yaml` itself (PR #407, 2026-05-14)** — added as a second cron (`30 3 * * *`) and a `workflow_dispatch` `mode` input (review/maintenance/autoheal). Architecturally distinct from the sibling-repo pattern that uses a separate `fro-bot-autoheal.yaml`.
- **Autoheal prompt has 8 categories** (Errored PRs, Security, Code Quality, DX, Production Site Review, Quality Gates Verification, Cross-Project Intelligence Inbound, Upstream Modernization Watch Sundays-only) vs 5 in [[marcusrbrown--vbs]] / [[marcusrbrown--mrbro-dev]]
- **Renovate preset major-version jump:** `marcusrbrown/renovate-config#4.5.8 → #5.2.0` (PR #406, 2026-05-16). Same upgrade dropped the `fast-uri` security override mid-PR and had to be restored to clear `pnpm audit` failures from GHSA-q3j6-qgpj-74h6 / GHSA-v39h-62p7-jpjc.
- **New files:** `lhci.config.js` at repo root (Lighthouse CI config, no dedicated workflow yet) and `TESTING.md` (15KB testing doc)
- **New script:** `analyze-build` (`tsx scripts/analyze-build.ts`) for bundle analysis (PR #410)
- **`bfra-me/.github` reusable workflows:** v4.16.8 → v4.16.17
- **pnpm:** 10.33.0 → 10.33.4 (#404)
- **Open issues:** 2 → 4 (added autoheal report #409 and coverage flag #411)
- Two earlier "missing" gaps are now closed: autoheal (integrated as mode) and performance (lhci config present). Two remain: no Probot `settings.yml`, no CodeQL/Scorecard.
- First observed instance of `fro-bot` co-authoring a direct commit in this repo (PR #406 security fix)

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io (SHA 4cd8198991618f216b940b6a6c13e1a09fd7979d)

## [2026-05-18 08:58] ingest | repo:marcusrbrown/marcusrbrown.github.io

Surveyed marcusrbrown/marcusrbrown.github.io and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io

## [2026-05-19 00:00] ingest | marcusrbrown/marcusrbrown.github.io

No-op re-survey of `marcusrbrown/marcusrbrown.github.io` (SHA `4cd8198`, unchanged since 2026-05-18). Additive update to repo page only — appended a survey-history row and a third source entry. Index unchanged (page already cataloged). No topic/entity/comparison pages touched.

Findings:

- HEAD unchanged at `4cd8198` (`chore(deps): update all non-major dependencies (#416)`, 2026-05-18). Last push 2026-05-18T09:41:00Z.
- Open issues: 4 (#411 test branch coverage <80%, #409 Daily Autohealing Report, #260 Daily Maintenance Report, #6 Dependency Dashboard) — identical to 2026-05-18.
- Open PRs: 0. Recent activity window since prior survey is empty (no new Renovate batches landed).
- Fro Bot workflow file inspected directly: agent still pinned at `fro-bot/agent@b030b53b1b47b1bed77a581222706c900cc63b0e # v0.44.0`. `AUTOHEAL_CRON='30 3 * * *'` and `MAINTENANCE_CRON='30 15 * * *'` env vars confirm the single-file three-mode design described in the prior survey is intact.
- No contradictions with prior ingest. Two known gaps remain: no Probot `settings.yml`, no CodeQL/Scorecard workflows.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io (SHA 4cd8198991618f216b940b6a6c13e1a09fd7979d)

## [2026-05-19 08:43] ingest | repo:marcusrbrown/marcusrbrown.github.io

Surveyed marcusrbrown/marcusrbrown.github.io and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io

## [2026-05-20 08:39] ingest | marcusrbrown/marcusrbrown.github.io

No-op re-survey at SHA `4cd8198` — still HEAD, unchanged since 2026-05-18. Additive update to the repo page: appended a 2026-05-20 row to the Survey History table, added an in-flight note for fro-bot/agent v0.44.1 (PR #417) to the agent-cadence bullet, refreshed frontmatter `updated:` and appended a fourth source entry. Index entry updated for freshness; no topic, entity, or comparison pages required edits.

Findings:

- HEAD: `4cd8198` (`chore(deps): update all non-major dependencies (#416)`, 2026-05-18). Last push 2026-05-19T09:37:26Z (no commits since 05-18; the push timestamp moved without a HEAD change — likely a tag or branch update).
- Open issues: 4 (#411, #409, #260, #6) — unchanged.
- Open PRs: 1 — **#417** `chore(deps): update fro-bot/agent to v0.44.1` on `renovate/all-minor-patch`, labeled `automerge` / `dependencies` / `github-actions` / `renovate` / `patch` / `action`. Will land under the existing automerge policy without human review.
- `package.json` re-verified: `packageManager: pnpm@10.33.4`, `engines.node >=22.0.0`, `engines.pnpm ^10.28.2`, React `^19.0.0`, TypeScript `^6.0.0`, Vite `^7.0.6`, Vitest `^4.0.0`, `@types/node ^24.0.0`. No drift from prior survey.
- Fro Bot workflow head re-read: `inputs.mode` choice list `[review, maintenance, autoheal]` default `autoheal`, autoheal cron `30 3 * * *`, maintenance cron `30 15 * * *`. Single-file three-mode design intact.
- No structural drift. Two known gaps still open: no Probot `settings.yml`, no CodeQL/Scorecard workflows.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io (SHA 4cd8198991618f216b940b6a6c13e1a09fd7979d)

## [2026-05-20 08:40] ingest | repo:marcusrbrown/marcusrbrown.github.io

Surveyed marcusrbrown/marcusrbrown.github.io and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io

## [2026-05-20 09:55] ingest | bfra-me/ha-addon-repository

Initial survey of `bfra-me/ha-addon-repository` (SHA `0a163c3f`). Created repo page `bfra-me--ha-addon-repository.md`. Updated topic page `home-assistant.md` to wikilink the new repo and document multi-arch add-on builds + `frenck/action-addon-linter` sibling-tool relationship. Updated `index.md` to catalog the new page.

Key findings:

- GitHub template repo (`is_template: true`) under bfra-me org — blueprint for HA add-on collections. Apache-2.0. Created 2022-10-08.
- Single example add-on (`example/`, slug `example`, v1.2.2): four arches (`armhf`/`armv7`/`aarch64`/`amd64`), s6-overlay (`init: false`), AppArmor profile, OCI labels, tempio binary install from `home-assistant/tempio` releases.
- HA base images split: Alpine 3.23 for 64-bit, 3.22 for 32-bit ARM (upstream lag). Dockerfile uses `ARG BUILD_FROM=...@sha256:...` so Renovate rotates the digest via custom Dockerfile manager; `build.yaml` deliberately uses tag-only with `pinDigests: false`.
- Four workflows, all SHA-pinned actions: `main.yaml` (prepare→lint-addon (frenck/action-addon-linter v2.21.0) + Prettier 3.8.3 → build-addon matrix with `home-assistant/builder@2026.03.2`, `--cosign`, `id-token: write` to GHCR), `fro-bot.yaml`, `renovate.yaml` (reusable `bfra-me/.github` v4.16.16), `update-repo-settings.yaml` (v4.16.16, daily 14:15 UTC).
- **Fro Bot agent present and active:** `fro-bot/agent@v0.43.1`. Add-on-aware PR review prompt (Dockerfile pinning, config/build.yaml validity, bashio/shellcheck, AppArmor integrity, breaking interface changes, translation completeness) with structured `PASS|CONDITIONAL|REJECT` verdict. Daily 15:30 UTC autoheal sweep across four categories (errored PRs, security, health & maintenance, DX).
- **Distinctive Fro Bot pattern:** maintains a single perpetual issue titled exactly `Daily Autohealing Report` with prepended dated update sections — diverges from sibling repos that create new issues per cycle.
- Renovate extends `bfra-me/renovate-config#5.2.1` + `:enablePreCommit` — **different preset family** from the rest of the surveyed ecosystem (which uses `marcusrbrown/renovate-config#4.5.x`). Custom managers for `build.yaml` arch keys, `Dockerfile` `ARG BUILD_FROM=...@sha256:...`, and Alpine packages via repology (`alpine_3_20/{pkg}`). Python capped at `<=3.13`.
- Probot settings extend `.github:common-settings.yaml` (resolves to bfra-me org `.github`, not Marcus's). Branch protection requires `Prepare`, `Lint`, `Build`, `Renovate / Renovate`, `Fro Bot`; strict + linear history + enforce-admins + 1 reviewer with stale-review dismissal.
- Tooling: Node 22.11.0, Python 3.13.13 via `.tool-versions`. Devcontainer, pre-commit, markdownlint-cli2, Prettier, Cursor rules all configured.
- 5 open issues, 0 open PRs at survey time.
- No CodeQL/Scorecard/Trivy — security delegated to Renovate + autoheal sweep. Reasonable for a template.

Cross-ecosystem relationship: this is the add-on build/publish counterpart to [[marcusrbrown--ha-config]] (which consumes add-ons & integrations). The two `frenck/action-*` tools are siblings: `action-addon-linter` validates the add-on contract here; `action-home-assistant` validates running configs there.

Sources: https://github.com/bfra-me/ha-addon-repository (SHA 0a163c3fa8846704103658142fa742f40d165743)

## [2026-05-20 16:13] ingest | repo:bfra-me/ha-addon-repository

Surveyed bfra-me/ha-addon-repository and updated the control-plane wiki.

Sources: https://github.com/bfra-me/ha-addon-repository

## [2026-05-20 18:00] ingest | bfra-me/.github

Initial survey of `bfra-me/.github` (SHA `a81be4c5d5c93824fdcc426418c9433d5e5bd9be`). Created repo page `bfra-me--github.md`. Updated topic pages `probot-settings.md` (added bfra-me org template as third common-settings source) and `github-actions-ci.md` (added bfra-me/.github to repo list). Updated `index.md` to catalog the new page.

Key findings:

- Org control center for `@bfra-me`. Public, MIT, template (`is_template: true`), created 2022-03-17. Marketed as a `.github` template but runs as a full TypeScript pnpm monorepo (`@bfra.me/.github` v4.16.18, private root).
- Workspace: 4 packages — root + 3 custom actions under `.github/actions/*` (`renovate-changesets`, `update-metadata`, `update-repository-settings`). Root is itself a workspace member (`packages: ['.', '.github/actions/*']`) with `ignoreWorkspaceRootCheck: true`. `shamefullyHoist: true`, `savePrefix: ''`. All actions use Node.js 24 runtime and ship pre-built `dist/`.
- Toolchain: Node 24.15.0 (`.node-version`), pnpm 10.33.4, TypeScript 6.0.3 strict, Vitest 4.1.6, ESLint 10.4.0, Prettier 3.8.3, husky 9.1.7, lint-staged 16.4.0, Changesets 2.31.0.
- **17 workflows.** Notable: `main.yaml` (Quality Check), `fro-bot.yaml` (per-repo persona with three modes via `workflow_dispatch` choice), `fro-bot-autoheal-org.yaml` (org-wide weekday sweep at `0 5 * * 1-5` over all non-archived bfra-me repos, serial processing, dedup against existing bot items, defers dep bumps to Renovate, scope-capped to minimal/reversible fixes), `renovate.yaml` + `trigger-org-renovate.yaml` (self-hosted Renovate fan-out via `@bfra-me/renovate-action`), `update-repo-settings.yaml` (consumes local `update-repository-settings` action), plus CodeQL, Scorecard, Container Scan, Secret Scan, License Compliance, Dependency Review, Copilot setup, PR Triage, Auto-Release.
- **Fro Bot agent: `v0.44.2`** (SHA `b97877b2`) — ahead of most ecosystem repos (typically `v0.41.x`–`v0.43.x`). PR review prompt is security-focused for an org control center: enforces SHA-pinned actions with version comments, blocks workflow injection via untrusted input in `run:` blocks, requires `dist/` rebuild for action source changes, manually-authored changesets only (`pnpm changeset` CLI explicitly banned), strict TypeScript (no `any`, no `@ts-ignore`, ESM only).
- **Third common-settings source surfaced.** This repo ships `common-settings.yaml` as the org-wide template for `@bfra-me` repos, parallel to `marcusrbrown/.github:common-settings.yaml` (personal) and `fro-bot/.github:common-settings.yaml` (Fro Bot org). Repo's own `settings.yml` self-extends; branch protection requires 12 status checks (Advanced Security Analysis, CodeQL, Container Scan, Create Renovate Changeset, Fro Bot, GitGuardian Scan, License Scan, Quality Check, Release, Renovate, Review Dependencies, Triage) with `required_approving_review_count: 0` — governance leans on checks, not reviewers. Linear history, admin enforcement enabled.
- Renovate: `.github/renovate.json5` extends `local>bfra-me/.github:internal.json5`, `automergeType: pr`. Trivy versioned via `github-releases`. `elstudio/actions-settings` disabled (consumed via local action). Mise manager disabled (workaround). Post-upgrade runs `pnpm run bootstrap && pnpm run build && pnpm run fix`. `metadata/renovate.yaml` is the org-wide config inherited by other `bfra-me/*` repos.
- AGENTS.md documents conventions and anti-patterns: changesets manually authored, scoped to closest package; ESM only; shared `@bfra.me/*` configs; `bfra-me[bot]` app auth; Vitest coverage 80/80/80/75; reusable workflows resolve cross-repo checkout via `GITHUB_WORKFLOW_REF` (not `github.workflow_sha`, which resolves to the caller in `workflow_call`).
- 5 open issues, 1 open PR at survey time. Latest commit (`a81be4c`, 2026-05-20T09:42:00Z): Renovate bump of `fro-bot/agent` to v0.44.2 (PR #2200) with auto-generated changeset.
- Follow-up flagged on the repo page: the Probot settings landscape now has three common-settings sources (`marcusrbrown/.github`, `fro-bot/.github`, `bfra-me/.github`). Mapping which repos extend which — and reconciling whether `bfra-me` and `fro-bot` org templates should converge — is a candidate for a future survey/comparison page.

Sources: https://github.com/bfra-me/.github (SHA a81be4c5d5c93824fdcc426418c9433d5e5bd9be)

## [2026-05-20 16:28] ingest | repo:bfra-me/.github

Surveyed bfra-me/.github and updated the control-plane wiki.

Sources: https://github.com/bfra-me/.github

## [2026-05-20 17:14] ingest | bfra-me/works

Initial survey of `bfra-me/works` (SHA `ef14b26085dab318fffad1b6c3062292f8ae60b8`). Created repo page `bfra-me--works.md`. Updated topic pages `github-actions-ci.md` (added repo to list and Fro Bot table) and `probot-settings.md` (added bfra-me/works as a representative consumer of the `bfra-me/.github:common-settings.yaml` template). Updated `index.md` to catalog the new page.

Key findings:

- The `@bfra-me` **tooling monorepo** — the shared-library counterpart to [[bfra-me--github]] (which is the org control plane). Public, MIT, created 2020-10-27. Private root `@bfra.me/works` v0.0.0-development.
- Workspace: 11 entries (root + `docs` + `scripts` + 8 `packages/*`). pnpm 10.33.4, Node 24.15.0, TypeScript 6.0.3 strict (`noUncheckedIndexedAccess`), Vitest 4.1.6, ESLint 10.4.0, Prettier 3.8.3, Changesets 2.31.0, husky 9.1.7, manypkg 0.25.1 with `workspaceProtocol: require`. `autoInstallPeers`, `shamefullyHoist`, `strictPeerDependencies`, `shellEmulator`, `savePrefix: ''`.
- **8 published packages**: `@bfra.me/eslint-config@0.51.1`, `@bfra.me/prettier-config@0.16.9` (variants: 80/100/120-proof, semi, default, define-config), `@bfra.me/tsconfig@0.13.1`, `@bfra.me/es@0.1.0` (subpath exports for async/env/error/functional/module/result/types/validation/watcher), `@bfra.me/create@0.7.14` (CLI, optional OpenAI/Anthropic AI enhance), `@bfra.me/badge-config@0.2.0`, `@bfra.me/doc-sync@0.1.9` (CLI), `@bfra.me/semantic-release@0.3.7`, `@bfra.me/workspace-analyzer@0.2.8` (latest release 2026-05-16, CLI + JSON output). All build to `lib/` via tsup, except `@bfra.me/create` which builds to `dist/`. Docs site is Astro Starlight with MDX/content-validation tests and automated version-badge sync.
- **11 workflows + 1 Markdown doc file** under `.github/workflows/`. Every workflow consumes the local composite action `.github/actions/pnpm-install`. Notable: `main.yaml` (Prepare → parallel Lint+type-coverage / Test / Build / Workspace Analysis → CI), `release.yaml` (Changesets, triggered by `workflow_run` after Main on main + Sunday `0 18 * * 0` + dispatch with `force-release` toggle, uses `bfra-me[bot]` app token for schedule/`workflow_run`), `docs.yaml` (Astro Starlight build + GH Pages deploy), `docs-sync.yaml` (path-filtered doc-sync automation with dry-run dispatch input), `renovate.yaml` (calls reusable `bfra-me/.github` v4.16.18), `renovate-changeset.yaml` (auto-changesets for bfra-me/renovate bot PRs), `update-repo-settings.yaml` (calls reusable v4.16.0), `cache-cleanup.yaml`, plus CodeQL/Scorecard/Dependency Review.
- **Fro Bot agent v0.44.2** (SHA `b97877b2`) — parity with [[bfra-me--github]]. Single-file three-mode workflow (PR review / Daily Maintenance Report / Daily Autohealing Report) with `workflow_dispatch` mode choice and `workflow_call` reusable input. Schedule: maintenance `0 16 * * *`, autoheal `30 3 * * *`. Maintains exactly one rolling open issue per mode (`Daily Maintenance Report` and `Daily Autohealing Report`) with consolidation logic for duplicates and 14-day historical-summary collapse. Autoheal is a 5-category sweep with strict guardrails: trusted-author whitelist (`renovate[bot]`, `dependabot[bot]`, `fro-bot`, write-access humans), Renovate owns routine bumps (Fro Bot only touches versions for confirmed security advisories), no workflow/lockfile/prompt mods while repairing PRs, never push to default branch, never weaken guardrails to make checks pass. PR review prompt is TypeScript-monorepo-specific (Result<T,E> usage, explicit named exports, no `export *`, subpath export breaking-change awareness, monorepo build-order impact). Formatting/lint nits explicitly out of scope.
- **Probot settings**: `.github/settings.yml` extends `.github:common-settings.yaml` (resolves to bfra-me org, same as [[bfra-me--ha-addon-repository]]). Branch protection requires 12 status checks: Analyze, Build, CI, CodeQL, Create Renovate Changeset, Fro Bot, Lint, Prepare, Renovate / Renovate, Review Dependencies, Test, Workspace Analysis. `enforce_admins: true`, `required_linear_history: true`, `required_pull_request_reviews: null` (governance leans on checks, not reviewers — matches [[bfra-me--github]] posture).
- **Renovate**: `.github/renovate.json5` extends `github>bfra-me/.github:internal.json5#v4.16.18` + `sanity-io/renovate-config:semantic-commit-type` + `security:minimumReleaseAgeNpm`. `addLabels: ['{{{parentDir}}}']` for monorepo directory labeling. ignorePaths include `packages/create/**/templates/**` (template fixtures aren't real deps). Notable rules: `@anthropic-ai/sdk` 0.x minor automerge, `bfra-me/renovate-config` SemVer pinning, `fetch-mock <12.0.0`, `@swc/**` every 2 weeks Sunday, Mise manager disabled. `patch.automerge: true`, `platformAutomerge: false`. Post-upgrade: `pnpm bootstrap && pnpm build && pnpm fix`.
- AGENTS.md conventions: TypeScript strict mode (no `any`/`@ts-ignore`/`@ts-expect-error`), pure ESM (no `require()`), explicit named exports, `Result<T,E>` from `@bfra.me/es/result` never throw, lib/ output (dist/ only for create), tests in `packages/*/test/**/*.test.ts`, manypkg-enforced `workspace:` protocol, build order `tsconfig → prettier-config → eslint-config → others` handled by streaming, lint-staged on commit via husky, `.yaml` not `.yml`.
- 38 open issues, 1 open PR at survey time. Latest release: `@bfra.me/workspace-analyzer@0.2.8` (2026-05-16).
- **Cross-ecosystem relationship**: `bfra-me/works` is the **source** of the `@bfra.me/*` configs and utilities consumed by name across the wider Fro Bot ecosystem (eslint-config, prettier-config, tsconfig, es, semantic-release, workspace-analyzer all show up as devDependencies elsewhere). Pairs with [[bfra-me--github]] (control plane) as the org's two-repo nucleus, and shares the single-issue rolling-update Fro Bot pattern with [[bfra-me--ha-addon-repository]].
- No follow-up Fro Bot draft PR needed — the workflow is present, current, and at the leading edge (v0.44.2).

Sources: https://github.com/bfra-me/works (SHA ef14b26085dab318fffad1b6c3062292f8ae60b8)

## [2026-05-20 17:15] ingest | repo:bfra-me/works

Surveyed bfra-me/works and updated the control-plane wiki.

Sources: https://github.com/bfra-me/works

## [2026-05-21 04:30] ingest | marcusrbrown/opencode-copilot-delegate

Incremental re-survey of `marcusrbrown/opencode-copilot-delegate` (SHA `2744ce7`, v0.12.0 on npm, up from `02cac9c` / v0.1.0 on 2026-04-27). Additively rewrote repo page `marcusrbrown--opencode-copilot-delegate.md` to absorb 11 minor releases. Updated topic page `opencode-plugins.md` with hard-won loader/runtime gotchas surfaced across those releases. Updated `index.md` description. Index unchanged in structure (page already cataloged).

Key deltas since prior survey (v0.1.0 → v0.12.0):

- **Fourth tool added (v0.12.0):** `copilot_resume` wraps `copilot --resume=<target>` with UUID validation against the local session store, automatic workspace-path reuse from prior plugin tasks whose session ID matches, CLI no-match-error normalization, and path-injection rejection. `TaskState`/`OutputEnvelope` gain `origin: spawn|resume|connect` discriminator and surface the upstream Copilot session UUID as `copilot_session_id` on the envelope.
- **Two-half plugin architecture (v0.10.0+):** Server plugin remains the default; opt-in `./tui` export adds `/copilot-status` via `@opentui/solid`. `package.json` declares `oc-plugin: [server, tui]`. Build target split — server `target: node` (Node-loadable, CI-gated), TUI `target: bun`.
- **Public-surface hardening (v0.12.0):** Plugin entry now exports only `default`; helper moved to `src/lib/rpc-cleanup.ts`. CI gate between Build and Unit tests asserts the export shape using `node --input-type=module -e "import(...)"`. Tests/package-exports.test.ts mirrors locally. References the Systematic v2.5.0/v2.12.1 regression class.
- **Orphan subprocess reaper (v0.2.0+):** PID-file identity-gated reaper for foreign-instance subprocesses, hardened across v0.3.0 (streaming worker pool, combined `ps` query), v0.4.0 (configurable timeouts + cooperative `AbortSignal` cancellation, `timedOut: boolean` in `ReapResult`), v0.8.0 (race-safe truncate/unlink helpers), v0.9.0 (`O_NOFOLLOW` + symlinked-parent-dir rejection against same-user attacks). All runtime warnings now share `[copilot-delegate]` prefix.
- **Per-process plugin singleton (v0.8.0 → v0.11.0):** `globalThis` Symbol guard; **duplicate invocations now return empty hooks `{}`** to prevent double-registration when both user-level and project-level `opencode.json` list the plugin. Diverges from Systematic PR #352 (per-load registration) because this plugin's `doInit` binds a TCP port + writes a PID file — re-running would race on exclusive resources.
- **TUI slash command (v0.12.0):** Feature-detects `api.keymap.registerLayer` (OpenCode 1.14.44+) vs `api.command.register` (1.14.41 fallback) vs neither (defensive warn). Mirrors Magic Context dual-path pattern from commit 5fe1c4f.
- **Per-parameter tool description survival (v0.5.0–v0.7.0):** Agent discovery rewritten — `BUILTIN_AGENTS` constant removed since standalone `@github/copilot` CLI ships zero of those legacy names. Tool schemas patched via `_zod.toJSONSchema` override in `src/lib/normalize-tool-arg-schemas.ts` so descriptions survive the host-zod ≠ plugin-zod module boundary. `zod` pinned `^4.3.0` direct + `overrides` to dodge dual-zod TS2883.
- **TUI re-entrancy fix (v0.10.1):** Pressing Escape on `/copilot-status` previously froze the TUI via re-entrant dialog close handling.
- **Observability (v0.9.0):** `killProcessTree` classifies fkill failures by probing the process *group* (`process.kill(-pid, 0)`); ESRCH suppressed, others preserve original throw. `notifyCompletion` fallback `client.app.log` wrapped in try/catch with structured SDK shape so synchronous SDK throws can't escape the documented "never throws" contract.
- **`setStatus` lifecycle tightening (v0.8.0):** Terminal → non-terminal transitions explicitly forbidden; closes an unintended resurrection path no caller exercised but the prior contract permitted.
- **Toolchain:** Bun 1.3.13 → 1.3.14, Biome 2.4.13 → 2.4.15, mise pins `opencode-ai` 1.14.27 → 1.15.4 and `@github/copilot` 1.0.36 → 1.0.48. `@opencode-ai/plugin` peer narrowed `>=1.14.0` → `>=1.14.41` (v0.12.0). `@opencode-ai/sdk` peer dep removed (v0.6.0) — was never imported.
- **CI/automation:** Fro Bot agent `v0.42.2` → `v0.44.3` (SHA `b928e797`). Renovate preset `marcusrbrown/renovate-config#4.5.8` → `#5.2.0` (major bump). 6 workflows unchanged. Branch protection unchanged. Probot settings still extend `.github:common-settings.yaml`.
- **Tests:** Grew from ~6 to 21 unit files plus integration. New coverage: pid-file, orphan-reaper, continuity-checks, continuity-validation, plugin-singleton, rpc-server, rpc-contract, rpc-cleanup, normalize-tool-arg-schemas, package-exports, resume, task-status, task-registry, cancel-helper. Integration suite still gated out of CI per #38.
- **Open issues unchanged:** 3 (#38 integration tests, #26 daily autoheal report, #25 dep dashboard). 4 open PRs (3 Renovate, 1 Fro Bot self-correction #134 tightening `@types/node` LTS rule).

No contradictions with prior ingest. The 2026-04-23 "TODO stubs" claim was already resolved by the 2026-04-27 survey; the page now reflects the full 11-release hardening arc on top of that foundation.

Sources: https://github.com/marcusrbrown/opencode-copilot-delegate (SHA 2744ce7fc07660baa4f17bfff3656141888261cf)

## [2026-05-21 08:54] ingest | repo:marcusrbrown/opencode-copilot-delegate

Surveyed marcusrbrown/opencode-copilot-delegate and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/opencode-copilot-delegate

## [2026-05-22 08:36] ingest | fro-bot/systematic

Re-surveyed `fro-bot/systematic` (gh-pages SHA `12cae87`, source SHA `dae829a` of [[marcusrbrown--systematic]]). Additively updated [[fro-bot--systematic]] to reflect changes since the 2026-05-07 initial survey:

- **Registry advanced v2.7.3 → v2.20.6.** `index.json` now lists 103 components vs ~96 at prior survey: 51 agents (+ unknown delta), 47 skills, **2 bundles** and **2 profiles** (new V2 component types now materialized in the deployed artifact), and 1 plugin entry. The bundle/profile component types are net-new in this survey window.
- **Hosted JSON Schema is now a public contract.** `schemas/latest/` and `schemas/v2/systematic-config.schema.json` are served. `$id` on the v2 file is `https://fro.bot/systematic/schemas/v2/systematic-config.schema.json`, which makes that URL the canonical pinned reference for IDE autocomplete on `systematic.json` / `systematic.jsonc`. Draft-07. Top-level keys: `agents`, `categories`, `disabled_skills`, `disabled_agents`, `disabled_commands`, `bootstrap`. Loader does not fetch or validate against it — it exists purely to flip on editor support. Renaming or restructuring these URLs silently breaks every consumer that pinned them, so the deploy target has effectively grown a third consumer contract on top of the rendered docs and the OCX registry.
- **New static files** — `404.html` (Starlight not-found page) and `og-image.png` (Open Graph share image).
- **Deploy cadence intensified.** Multiple deploys per day during active source-repo windows (e.g., five on 2026-05-21 between 18:27 and 23:12 UTC), suggesting CI fans out per merged commit rather than per release tag. Captured the last 10 deploys with both `gh-pages` and source SHAs to make rollback diagnostics easier.
- **Branches, issues, PRs unchanged in structure.** `gh-pages` (default) + `renovate/configure`. Issue #1 (CodeQL/Scorecard parity) still open; PR #2 (Renovate onboarding) still open and unmerged — Renovate has minimal applicability to a static-HTML repo, so the noise concern from the prior survey still stands.
- **No Fro Bot workflow** in this repo. Same conclusion as 2026-05-07: not warranted; the source repo [[marcusrbrown--systematic]] holds the agent integration. Recorded explicitly in the repo page so the constraint check passes without a follow-up draft PR.

Cross-page updates:
- Added a "Hosted JSON Schema is now a public contract" note to [[opencode-plugins]] under "Documentation Deployment" so the schema-URL stability constraint is discoverable from the topic side, not just the repo page.
- Refreshed the [[fro-bot--systematic]] entry in `index.md` from the placeholder one-liner to a substantive descriptor matching schema convention.

No contradictions with the 2026-05-07 ingest. All prior content preserved; survey-history table extended with the new row.

Sources: https://github.com/fro-bot/systematic (SHA 12cae87)

## [2026-05-22 08:39] ingest | repo:fro-bot/systematic

Surveyed fro-bot/systematic and updated the control-plane wiki.

Sources: https://github.com/fro-bot/systematic

## [2026-05-23 00:00] ingest | marcusrbrown/renovate-config

Incremental re-survey of `marcusrbrown/renovate-config` (SHA `3478c88`, up from `bf13a82` on 2026-04-28). Additively updated repo page `marcusrbrown--renovate-config.md` and topic page `github-actions-ci.md`. Refreshed `index.md` entry description. No new topic/entity/comparison pages warranted — the v5 jump and autoheal architecture shift slot into existing pages.

Deltas since prior survey:

- **Major-version boundary crossed:** v4.5.8 → v5.2.0 (seven releases: 4.5.9, 5.0.1, 5.0.2, 5.1.0, 5.1.1, 5.2.0, plus 5.0.1 intermediate). Breaking change: minimum allowed version floor raised `>=4.0.0` → `>=5.0.0`.
- **`default.json` policy changes:** Added `group:allNonMajor` to extends; dropped `:disableRateLimiting` (now defers to bfra-me base preset defaults); added a new packageRule that ungroups 0.x packages (`matchCurrentVersion: /^0\./` → `groupName: null`) as the safety valve against PR storms from unstable libs.
- **Autoheal consolidated into `fro-bot.yaml`:** The separate `fro-bot-autoheal.yaml` is gone. Single-file design with one daily schedule (15:30 UTC) covers PR review + maintenance + autoheal. Mirrors the architecture observed in [[marcusrbrown--marcusrbrown-github-io]] (which uses a `mode` enum dispatch input) and the rolling-perpetual-issue pattern in [[bfra-me--ha-addon-repository]] / [[bfra-me--works]].
- **Autoheal categories went from 5 → 6.** Removed: "bfra-me Ecosystem Health" (folded into category 5 Cross-Project Intelligence Inbound, which now surveys `marcusrbrown/.github`, `bfra-me/renovate-config`, `fro-bot/agent`). Added: category 6 **Upstream Modernization Watch (Sundays only)**, gated by `IS_SUNDAY_UTC` env var via a preflight `date -u +%u` step. At-most-one-draft-PR-per-scan policy; never bumps pinned versions (Renovate-owned).
- **Fro Bot agent:** v0.42.2 → v0.44.3 (SHA `b928e79729f01b563feabee26a0525a3b48501a6`).
- **Toolchain:** pnpm 10.33.2 → 11.1.3 (major), lint-staged 16.4.0 → 17.0.5 (major), eslint 10.2.1 → 10.4.0, `@bfra.me/eslint-config` 0.51.0 → 0.51.1, `@bfra.me/prettier-config` → 0.16.9.
- **pnpm overrides added** for supply-chain hardening: `fast-uri >=3.1.2`, `flatted >=3.4.2`, `handlebars >=4.7.9`, `lodash-es >=4.18.0`, `picomatch@2 ^2.3.2`, `picomatch@4 ^4.0.4`. None existed at prior survey.
- **Open issues:** 46 → 6. The single-perpetual-issue strategy in the autoheal prompt consolidates and auto-closes dated daily reports — explains the cleanup.
- **Open PRs:** 0 → 1 (#1311 picomatch@2 v4 by mrbro-bot, awaiting v5 floor consumer migrations).
- **Downstream v4→v5 migration wave:** [[marcusrbrown--ha-config]], [[marcusrbrown--marcusrbrown-github-io]], and [[marcusrbrown--opencode-copilot-delegate]] all bumped to `#5.2.0` (per their respective wiki pages); no consumer required manual config overrides for the breaking change. Holdouts on v4.x: `containers`, `extend-vscode`, `marcusrbrown`, `esphome-life`, `copiloting` (floating `#v4`), `gpt`, `dotfiles`, `vbs`, `mrbro-dev`, `tokentoilet`, `infra`, `github`, `marcusrbrown`, `sparkle`.
- Probot settings, branch protection, CodeQL/Scorecard, semantic-release pipeline (bare semver tags, major-branch updates), self-referential Renovate config all unchanged.
- No contradictions with prior ingest. The 2026-04-28 page already correctly described v4.5.8 state; the new survey row extends survey history without overwriting.

Sources: https://github.com/marcusrbrown/renovate-config (SHA 3478c88753d113b21c7cf10d9e58fd2f9be7e96a)

## [2026-05-23 07:51] ingest | repo:marcusrbrown/renovate-config

Surveyed marcusrbrown/renovate-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/renovate-config

## [2026-05-24 12:00] ingest | marcusrbrown/.dotfiles

Incremental re-survey of `marcusrbrown/.dotfiles` (SHA `0bb24f0`, 2026-05-24). Updated repo page `marcusrbrown--dotfiles.md`, topic page `dotfiles.md`, and entity page `mise.md`. Updated `index.md` entry with current state summary. No new pages created — existing topic/entity coverage remains accurate.

Delta from prior survey (SHA `ae026c1`, 2026-04-22):

- **Fro Bot agent v0.41.3 → v0.44.3** (SHA `b928e79`). Workflow gains a dedicated `Close stale daily reports` step on `schedule` triggers — auto-closes `fro-bot`-authored daily reports older than 3 days with cross-platform `date -u -d` / `-v-3d` fallback. Schedule prompt re-shaped: Developer Experience category is now report-only ("Formatting is handled manually by the repo owner"). Hard guard against querying Dependabot/vulnerability-alert APIs added (PAT 404 by design on user-owned repos).
- **Renovate preset 4.5.8 → 5.2.0** — crossed the v4→v5 boundary documented in [[marcusrbrown--renovate-config]] (2026-05-13). Joins the migration wave noted in the renovate-config wiki entry.
- **New Renovate custom manager** for pinned npm plugin versions inside `.config/opencode/opencode.json` and `tui.json` — matches `"name@x.y.z"` patterns so OpenCode plugins now flow through Renovate. Automerge list expanded to include `fro-bot/agent`, `ast-grep`, and `opencode-copilot-delegate`.
- **OpenCode plugin stack overhaul:**
  - `oh-my-openagent@3.17.4` → `oh-my-opencode-slim@1.1.1` (replacement, new config file `oh-my-opencode-slim.jsonc`)
  - `@ex-machina/opencode-anthropic-auth@1.7.4` → `@cortexkit/opencode-anthropic-auth@1.2.2` (vendor switch)
  - `@cortexkit/opencode-magic-context` 0.13.0 → 0.21.8
  - `@cortexkit/aft-opencode` 0.14.0 → 0.29.1
  - `@franlol/opencode-md-table-formatter` removed
  - **New**: `opencode-copilot-delegate@0.12.0` (consumes [[marcusrbrown--opencode-copilot-delegate]] sibling repo — first dotfiles release pulling it out of v0.1.0 scaffold)
  - `@fro.bot/systematic` pinned at 2.23.4 (was floating `latest`)
- **Custom OpenAI provider models** (`openai/gpt-5.5`, `openai/gpt-5.5-fast`) declared in `opencode.json` for the first time — 272K context, 32K output.
- **Magic-context reshape:** historian migrated to custom `openai/gpt-5.5-fast` (with Copilot/Anthropic now fallbacks only). Dreamer reverted to direct `anthropic/claude-sonnet-4-6` with `inject_docs: true`, pinned key files, user memories. Sidekick disabled. Token thresholds dropped from 4 entries to 2. Percentage thresholds tightened for Anthropic Sonnet/Opus (40% → 55%); new `openai/gpt-5.5` entry at 80%. Experimental block now centers on `auto_search` and `git_commit_indexing`.
- **mise tool deltas:** Node 24.15.0 → 24.16.0, Python 3.14.4 → 3.14.5, Go 1.26.2 → 1.26.3, Bun 1.3.13 → 1.3.14, Deno 2.7.13 → 2.8.0, pnpm 10.33.0 → 11.2.1 (major), npm 11.12.1 → 11.15.0, ZLS 0.15.0 → 0.16.0, ast-grep 0.40.5 → 0.42.3, Playwright 1.59.1 → 1.60.0, Puppeteer 24.41.0 → 25.0.4, agent-browser 0.26.0 → 0.27.0, ocx 2.0.7 → 2.0.11, opencode-ai 1.14.18 → 1.15.5, tsx 4.21.0 → 4.22.3, biome 2.4.12 → 2.4.15, cargo-binstall 1.15.5 → 1.19.1, typescript-language-server 5.1.3 → 5.2.0, poetry 2.3.4 → 2.4.1. **New:** `@github/copilot@1.0.51` (GitHub Copilot CLI), `aqua:gitleaks/gitleaks@8.30.1` (secret scanner). **Removed from `[tools]`:** `@cortexkit/opencode-magic-context`, `@cortexkit/aft-opencode` (moved to OpenCode plugin slot), `remark-language-server`, `lolcrab`.
- **New repo-scoped skill:** `.agents/skills/agent-browser/` — joins copilot-cli, test-driven-development, and writing-skills.
- **Repo metadata:** primary language is now TypeScript (212K) over Shell (55K) — driven by growth in `.config/opencode/`, agent skills, and devcontainer features. Open issues 19 → 4. Stars 18 (new field).
- Probot settings, devcontainer architecture, bare-repo pattern, branch protection, GPG signing, XDG layout, and Brewfile all unchanged.

Sources: https://github.com/marcusrbrown/.dotfiles (SHA 0bb24f05e29fbd4c70eb9dca9611055e7bef7c5f)

## [2026-05-24 08:08] ingest | repo:marcusrbrown/.dotfiles

Surveyed marcusrbrown/.dotfiles and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.dotfiles

## [2026-05-25 09:11] ingest | repo:marcusrbrown/.github

Incremental re-survey of `marcusrbrown/.github` (SHA `0b780fd`, 2026-05-25). Updated repo page `marcusrbrown--github.md`, topic page `probot-settings.md`, and `index.md` summary. No new pages — existing wikilinks remain valid.

Delta from prior survey (SHA `3fb30a4`, 2026-04-27):

- **Pure dependency churn.** Twelve commits since 2026-04-27, all Renovate-authored `chore(deps)` updates merged by `mrbro-bot[bot]`. No structural changes to workflows, settings, or community health files.
- **`bfra-me/.github` reusable workflows:** v4.16.9 → v4.16.20 (11 sequential patch bumps via PRs #363, #364, #365, #367, #368, #369, #370, #371, #372, #373, #374, #375). Both `renovate.yaml` and `update-repo-settings.yaml` now pinned at SHA `dc366698`.
- **`marcusrbrown/renovate-config` preset:** v4.5.8 → v4.5.9 (PR #366, 2026-04-30). Repo remains on v4.x — explicitly listed among the v4 holdouts in [[marcusrbrown--renovate-config]] (2026-05-13 v4→v5 boundary not yet crossed for this config-only repo).
- **No new files, no removed files.** `common-settings.yaml` unchanged at 18115 bytes (label set, branch protection, merge strategy, collaborator model all identical). `.github/settings.yml` unchanged. Renovate cadence still `15 */4 * * *`.
- **Fro Bot integration status:** still no `fro-bot.yaml` workflow. `fro-bot` retains `push` collaborator permission via inherited settings but is not in the active CI/merge loop. Recommendation from prior survey carries forward — a follow-up draft PR adding the single-file three-mode workflow (per [[marcusrbrown--marcusrbrown-github-io]]) remains open.
- **Repo metadata:** size 552K, 3 stars, description "GitHub defaults", topics unchanged (`github`, `repository`, `settings`).
- No contradictions with prior wiki content. All updates are additive — version refresh in source list, new survey-history row, and a refreshed Fro Bot Integration note that acknowledges Renovate-only authorship of recent PRs.

Sources: https://github.com/marcusrbrown/.github (SHA 0b780fdba1b5b0ae6280aaaf28f625e3db142278)

## [2026-05-25 09:34] ingest | repo:marcusrbrown/.github

Surveyed marcusrbrown/.github and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.github

## [2026-05-26 08:49] ingest | marcusrbrown/extend-vscode

Re-survey of `marcusrbrown/extend-vscode` (SHA `516a9eb4`, up from `b457a34f`). Updated repo page `marcusrbrown--extend-vscode.md`, bumped `updated` date on topic page `vscode-extensions.md`, refreshed `index.md` summary line. Added `marcusrbrown--renovate-config` to the repo page's `related` frontmatter.

Delta from prior survey (SHA `b457a34f`, 2026-04-27):

- **Renovate preset crossed v4 → v5 boundary** (PR #487, 2026-05-14): `marcusrbrown/renovate-config#4.5.0` → `#5.2.0`. extend-vscode is now on the v5 line documented in [[marcusrbrown--renovate-config]] (`group:allNonMajor` + 0.x ungrouping policy). This is the headline structural shift since the prior survey.
- **Three major-version PRs that had been pending since 2026-04-23 closed end of April:** `eslint` v10 (#467, 2026-04-30), `eslint-plugin-node-dependencies` v2 (#468, 2026-04-30), `jsdom` v29 (#469, 2026-04-29). Only `typescript` v6 (#466) remains outstanding as the sole pending major.
- **`tsup` pinning drift corrected** (#488, 2026-05-14): bumped from `^8.0.2` range to pinned `8.5.1`. The repo's devDependency block now uses exact pins uniformly — a useful invariant for future contributors.
- **Other patches merged 2026-04-29 → 2026-05-21:** Node.js → v24.16.0 (`.node-version`, #493), `eslint` → 10.4.0 (#492), `tsx` → 4.22.0 (#491), `@types/vscode` → 1.118.0 (#490, prior #483 → 1.116.0), `@playwright/test` → 1.60.0 (#489), `jiti` → 2.7.0 (#486), `eslint-plugin-no-only-tests` → 3.4.0 (#484), `jsdom` → 29.1.0 (#482).
- **Repository structure, build (tsup dual-target), CI workflows (six unchanged), publishing pipeline (Marketplace + OpenVSIX + npm via semantic-release), Probot settings (`fro-bot/.github:common-settings.yaml`), and branch protection (`Renovate / Renovate`, `Run Checks`, linear history, admin enforcement) all unchanged.**
- **Open issues:** 5 (#142, #162, #317–#319) — unchanged. **Open PRs:** 1 (#466, `typescript` v6).
- **Still no Fro Bot agent workflow.** Follow-up PR recommendation carried forward across now five+ surveys — extend-vscode and `marcusrbrown/.github` remain the two main holdouts in Marcus's portfolio without `fro-bot.yaml`.
- No contradictions with prior wiki content. All updates additive.

Sources: https://github.com/marcusrbrown/extend-vscode (SHA 516a9eb442f97212f45d890e65fb7d7642566206)

## [2026-05-26 08:49] ingest | repo:marcusrbrown/extend-vscode

Surveyed marcusrbrown/extend-vscode and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/extend-vscode

## [2026-05-27 08:58] ingest | marcusrbrown/infra

Incremental survey of `marcusrbrown/infra` at SHA `2f9bafd6cdb03d9ed28ee336d99d5f7bf09a3dfb` (push 2026-05-26). Updated repo page `marcusrbrown--infra.md` and topic page `github-actions-ci.md`. Updated `index.md` catalog entry. No new pages created — existing `github-actions-ci.md` already captures the split-deploy pattern and conventions-test pattern this repo pioneered.

Delta from prior survey (SHA `938fa7c`, 2026-04-27):

- **Major new app: `apps/gateway/`** (Fro Bot Discord client + workspace runner + mitmproxy stack at `gateway.fro.bot`, added #264 on 2026-05-18). Upstream `fro-bot/agent` pinned via `apps/gateway/upstream.json` at `v0.44.2`. Three-service Docker Compose deployment. Secrets materialized via SSH stdin only (never argv); checksum-after-success invariant in `/opt/gateway/.secrets-checksum` prevents silent stale-credential states. Discord registration poll has ~90s budget with 429-aware backoff and token-sanitized error surfaces.
- **New `packages/shared/`** (#290, 2026-05-23): shared DigitalOcean droplet helpers (`ssh`, `scp`, `validateDoctl`, `dropletExists`, `pinHostKeys`, etc.) consumed by `apps/cliproxy` and `apps/gateway` provision scripts. Private (`@marcusrbrown/infra-shared`, never published).
- **New workflow** `deploy-gateway.yaml` — third per-app deploy workflow in the split pipeline pattern (12 workflows total, up from 11). The thin `deploy.yaml` orchestrator now coordinates all three apps.
- **Fro Bot agent** v0.42.2 → v0.44.3 across multiple bumps (#251, #252, #274, #281, #282).
- **Renovate preset:** v4 → v5 major boundary crossed at 2026-05-17 (#242). Now extends `marcusrbrown/renovate-config#5.2.0` + `group:allNonMajor` for safer grouping.
- **Major dependency bumps:** TypeScript 6.0.3, ESLint 10.4.0, `@bfra.me/eslint-config` 0.51.1, `@bfra.me/tsconfig` 0.13.1, Changesets 2.31.0.
- **CLI v0.4.6 → v0.7.0** with MCP fidelity refactor for status-only commands (#296), gateway commands (status/deploy/logs/backup/restore), parsing of `docker compose ps` NDJSON output (#278), and OpenAI provider opt-in for `cliproxy setup --harness opencode` (#307). Codex device-code OAuth login added (#303).
- **CLIProxyAPI:** v6.9.39 → v6.10.9 (digest-pinned). Caddy: 2.11.2-alpine → 2.11.3-alpine.
- **Gateway hardening:** ControlMaster SSH multiplexing for deploys (#277), pinned droplet host keys in `.github/known_hosts` (#272), `validateGatewayHost` rejects `-`-prefixed values pre-SSH-invocation, no-argv-for-secrets invariant.
- **Operational documentation:** new Discord token-lifecycle runbook (#284, `docs/runbooks/`); plan reconciliation for cliproxy deployment + conventions tests (#253); compound learning entry for gateway first-deploy 5-wave cascade (#280, `docs/solutions/`).
- **Convention enforcement extended:** `predicate-quantifier:every` rule on `dorny/paths-filter` with negations (#254).
- **AGENTS.md updates:** Root expanded to cover gateway alongside keeweb + cliproxy; new per-app `apps/gateway/AGENTS.md` and `packages/shared/AGENTS.md`.
- **Open issues:** 5 → 38 (mostly tracked plan work + autohealing reports + Dependency Dashboard); **open PRs:** 1 → 0.

No contradictions with prior surveys — all earlier findings remain accurate, the repo has expanded additively.

Sources: https://github.com/marcusrbrown/infra (SHA 2f9bafd6cdb03d9ed28ee336d99d5f7bf09a3dfb)

## [2026-05-27 08:59] ingest | repo:marcusrbrown/infra

Surveyed marcusrbrown/infra and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/infra

## [2026-05-28 04:51] ingest | marcusrbrown/cortexkit_anthropic-auth

Initial survey of `marcusrbrown/cortexkit_anthropic-auth` at SHA `517d385` (default branch `marcusrbrown/main`). Created repo page `marcusrbrown--cortexkit-anthropic-auth.md`. Updated `opencode-plugins.md` topic (added repo to plugin table, new "Cross-Process OAuth Refresh Locking" section, frontmatter source/tags refresh). Updated `index.md` to catalog the new repo page.

Key findings:

- Public fork of `cortexkit/anthropic-auth`. Bun workspace monorepo with `core`, `opencode`, `pi`, `e2e-tests` packages. MIT, TypeScript 6.0.3, Bun 1.3.14 (mise), Biome 2.4.15, Lefthook 2.1.6.
- Two packages published from the fork under `@marcusrbrown/*` at `1.2.2-mb.2`: `anthropic-auth-core` (shared) and `opencode-anthropic-auth` (plugin + CLI). Pi package `@cortexkit/pi-anthropic-auth` is `private: true` in this fork — release contract explicitly excludes it.
- Provides Claude Pro/Max OAuth for OpenCode (`/connect anthropic`) and Pi (`/login anthropic`) with fallback accounts, quota-aware routing (5h/7d Claude quota gates with `failClosedOnUnknownQuota` default), persistent 1-hour prompt cache controls (`/claude-cache`, `/claude-cachekeep`), fast mode toggle (`/claude-fast`), live quota visibility (`/claude-quota`), request dumps (`/claude-dump`), and an optional user-owned Cloudflare Worker relay.
- Sidecar config: `~/.config/opencode/anthropic-auth.json` (env `OPENCODE_ANTHROPIC_AUTH_FILE`) for OpenCode; `~/.pi/agent/anthropic-auth.json` (env `PI_ANTHROPIC_AUTH_FILE`, `PI_AGENT_DIR`) for Pi. Same JSON schema across both agents.
- Release-path hardening worth carrying forward: jittered background OAuth refresh (`1.2.2`), cross-process atomic refresh lock to prevent rotated-refresh-token races and `invalid_grant` losers (`1.1.3`/`1.2.2`), wait-and-rejoin on contention, refresh endpoint failover to `api.anthropic.com/v1/oauth/token` after `platform.claude.com` returned OAuth `429` repeatedly (`1.2.1`).
- Workflows: `ci.yml` (PR-only: typecheck, build, test, Biome format/lint, SHA-pinned actions) and `release.yaml` (tag/dispatch with tag-commit integrity check, version-keyed concurrency, OIDC trusted publishing + provenance, no `NPM_TOKEN`, no `mb` dist-tag lane, `npm publish --tag latest`, no CI manifest mutation — manifests must already match the release version per `version-sync.mjs --validate`).
- Dependabot (not Renovate) — `enable-beta-ecosystems: true`, weekly bun + github-actions. Deliberate divergence from the rest of Marcus's ecosystem.
- Captures (`captures/`) are gitignored — mitmproxy HTTPS interception of Claude Code / OpenCode system prompts. PII-sensitive; any PR touching them should be flagged.
- **No Fro Bot workflow detected.** Noted on the repo page; follow-up draft PR should propose a Fro-Bot config tuned for release-sensitive, OAuth-sensitive repos (review/triage scope only — must not touch version-sync or the OIDC publish path).

No contradictions with existing wiki content. Additive updates only.

Sources: https://github.com/marcusrbrown/cortexkit_anthropic-auth (SHA 517d38596432429a8fc5f78612edc80a1c3f3dc6)

## [2026-05-28 04:54] ingest | repo:marcusrbrown/cortexkit_anthropic-auth

Surveyed marcusrbrown/cortexkit_anthropic-auth and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/cortexkit_anthropic-auth

## [2026-05-28 09:04] ingest | marcusrbrown/systematic

Incremental re-survey of `marcusrbrown/systematic` (SHA `9b75707`, 2026-05-28). Updated repo page `marcusrbrown--systematic.md`, bumped opencode-plugins topic page source set, and refreshed index entry. No new topic/entity/comparison pages warranted — all cross-cuts already cataloged.

Delta from prior survey (SHA `420ef650`, 2026-05-06):

- ~80 commits, v2.7.3 → v2.24.0 (17 minor + many patch releases). Repo is post-launch-surface-cleanup era.
- **Bundled assets:** skills 46 → 47 (new: `release-notes-narrative` project-scoped; `test-driven-development` + `writing-skills` + `writing-systematic-skills` imported from obra/superpowers in #394). Agents 50 → 51 (review category now 28). Deprecation surface marks `orchestrating-swarms` and `claude-permissions-optimizer` (#401).
- **Workflow consolidation (#446):** `fro-bot.yaml` and `fro-bot-autoheal.yaml` merged into a single workflow with three operating modes (review, maintenance, autoheal) routed via an inline `PROMPT` ternary on `event_name × mode × cron`. Workflow count 9 → 8.
- **Fro Bot agent:** v0.42.7 → v0.45.0 (SHA `8aac0fc3`).
- **Release-notes-narrative pipeline (v2.22–v2.23):** New project-scoped skill (#429) dispatched via `@semantic-release/exec` successCmd (#430), with extracted shell script (#432), bash-escaped Lodash render (#431), timestamp-based run identification (#434), and `correlation-id` input on `fro-bot.yaml` (#433).
- **Source-tree changes:** `plugin-singleton.ts` removed (its semantics folded into the broader factory layer). New modules: `config-schema.ts` (Zod schema for `systematic.json`), `config.ts` (Zod per-issue diagnostics), `skill-catalog.ts` (bootstrap injection of available skills, #365), `bundled-names.ts` (typed bundled-name validation, #384), `agent-colors.ts`, `agent-overlays.ts` (memoized per OpencodeClient, #383; empty-cache to unknown, #378), `model-availability.ts` (discovery-before-validation, #372, #376), `source-model-defaults.ts`.
- **Zod config schema arc (v2.14–v2.17):** Typed `systematic.json` validation with per-issue diagnostics, IDE autocomplete via published JSON Schema at `fro.bot/systematic/schemas/v2/`, factory pattern construction (#393), schema-drift CI gate.
- **Overlay hardening (v2.20.x):** Empty-cache and empty-discovery collapse to unknown status, per-client memoization, project-local Systematic overrides global Systematic output (#370).
- **Documentation modernization:** Architecture (#422), main-loop, philosophy (#421), launch-surface (README, home, Quick Start, config docs — #428), design-iterator and docs aligned with Impeccable design laws (#418, #419). New `docs:verify` script for local CI-parity pre-checks (#445).
- **OpenCode dep bumped through:** v1.14.49 → v1.15.10. Starlight to ^0.39.0 (#444). `@semantic-release/exec` pinned at 7.1.0 (#435).
- **Open issues:** 4 → 3 (renovate PR #327 from prior survey is merged). 0 open PRs at survey time.
- **Stars:** 14 → 22. **Fork count:** 1.
- **Renovate config + Probot settings:** Unchanged in intent. Renovate adds OpenCode group name (#425).
- **Fro Bot integration:** Fully active (no follow-up needed for missing workflow). Inline documentation added in #450 (PROMPT routing precedence — the release-notes-narrative automation depends on `workflow_dispatch` `prompt` taking precedence over mode default) and #451 (fork-guard asymmetry across PR-adjacent event types — only `issue_comment` needs explicit API-query because `github.event.pull_request` is null on that path).
- **No contradictions** with prior survey; `plugin-singleton.ts` was noted as added in v2.7.2 and is now folded into the broader factory layer (durable singleton semantics preserved via config-handler entry point).

Sources: https://github.com/marcusrbrown/systematic (SHA 9b7570782190d540b4d57abdd94cf7ca8e1984f1)

## [2026-05-28 09:05] ingest | repo:marcusrbrown/systematic

Surveyed marcusrbrown/systematic and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/systematic

## [2026-05-29 08:55] ingest | marcusrbrown/ha-config

Re-survey of `marcusrbrown/ha-config` (SHA `33cca05`, 12 days after prior survey). Updated repo page additively with a fourth survey row; updated `index.md` summary; no topic-page edits required (the `home-assistant` page's `.HA_VERSION` pin-drift footgun callout is already accurate and only deepens with the additional staleness).

Key findings:

- Structural surface unchanged: still 11 packages, 10 custom components, ESPHome submodule, no Fro Bot workflow.
- `.HA_VERSION` still pinned at `2025.6.3` — now ~11 months stale; the package-based config is being validated against a frozen HA release while pip-resolved deps advance freely.
- Pure Renovate churn since 2026-05-17: `bfra-me/.github` reusable workflow v4.16.17 → v4.16.21 (four patch bumps in 11 days), `pipelinecomponents/remark-lint` digest pin `829aa31` (#790), four esphome submodule digest updates (#782, #784, #786, #787, #789).
- Same 3 open issues (#427 Dependency Dashboard, #766 asyncio-mqtt v0.16.2, #777 esphome v2026), same 0 open PRs.
- New observation: `mrbro-bot[bot]` (GitHub ID `137683033`) is co-authoring some recent Renovate merges (e.g. #790). First sighting of a non-fro-bot automation actor on this repo — worth tracking on subsequent passes.
- **No Fro Bot workflow** for the fourth consecutive survey. Persistence across nearly a year suggests this is intentional: the repo is Renovate-only autopilot and doesn't need PR review or triage automation since virtually all merges are bot-authored.

No contradictions with prior surveys.

Sources: https://github.com/marcusrbrown/ha-config (SHA 33cca0534ca2b0dbbb7db4235912c1f225458beb)

## [2026-05-29 08:57] ingest | repo:marcusrbrown/ha-config

Surveyed marcusrbrown/ha-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/ha-config

## [2026-05-30 08:01] ingest | bfra-me/ha-addon-repository

No-op re-survey of `bfra-me/ha-addon-repository` (SHA `0a163c3f`, unchanged from 2026-05-20). HEAD on `main` has been dormant for 14 days while Renovate accumulates queued PRs on side branches. Additive update only: appended a 2026-05-30 row to the Survey History table, added a `Drift Watch` section noting two emerging signals, refreshed frontmatter `updated:` date, appended a second source entry. Updated `index.md` description with the queued v0.46.1 Fro Bot bump for freshness. No topic, entity, or comparison pages required edits.

Findings:

- HEAD unchanged at `0a163c3f` (`chore(deps): update dependency prettier to v3.8.3 (#551)`, 2026-05-16). `pushedAt` is 2026-05-30 because Renovate keeps re-pushing side branches, but `main` itself is stationary.
- Open issues: 5 → 6 (#554 `Daily Autohealing Report` continues to accrue dated update sections under the perpetual-issue pattern; #4 Dependency Dashboard unchanged).
- Open PRs: 0 → 4, all Renovate, all unmerged: #556 (`bfra-me/.github` reusable v4.16.16 → v4.16.21), #557 (`fro-bot/agent` v0.43.1 → v0.46.1 — three minor versions of agent runtime missed), #558 (HA `amd64-base:3.23` digest rotation to `4b7bff6`), #559 (`docker/login-action` v4.2.0).
- Workflow content inspected: `fro-bot.yaml` still pins `fro-bot/agent@v0.43.1`. `SCHEDULE_PROMPT` env literal still hardcodes "bfra-me/.github reusable workflow version (currently v4.16.6)" — a stale comment relative to the actual `uses:` pin at v4.16.16. Self-corrects via the agent's live SHA comparison, but worth parameterising on next workflow edit.
- No structural drift to workflows, settings, the `example/` add-on, or the Renovate config family (`bfra-me/renovate-config#5.2.1`).
- Cross-ecosystem note: this repo lags the agent fleet by 3 minor versions and the `bfra-me/.github` reusable by 5 patch versions. The four queued Renovate PRs cover that drift entirely — bottleneck is review/merge cadence, not Renovate coverage.

Sources: https://github.com/bfra-me/ha-addon-repository (SHA 0a163c3fa8846704103658142fa742f40d165743)

## [2026-05-30 08:03] ingest | repo:bfra-me/ha-addon-repository

Surveyed bfra-me/ha-addon-repository and updated the control-plane wiki.

Sources: https://github.com/bfra-me/ha-addon-repository

## [2026-05-31 00:30] ingest | bfra-me/works

Incremental re-survey of `bfra-me/works` (SHA `cd4a52d`, 2026-05-31; prior `ef14b26`, 2026-05-20). Updated repo page `bfra-me--works.md` and index entry. No new topic/entity/comparison pages warranted — deltas are agent pin advances and dependency bumps, not structural.

Delta:

- **Fro Bot agent:** v0.44.2 → v0.46.1 (#3503) → v0.47.0 (#3510), both merged 2026-05-30. PR #3491 ("Fix Fro Bot mode/prompt resolution for dispatch and reusable runs") patched the inline shell mode-resolution block for `workflow_dispatch` and `workflow_call` paths just ahead of the v0.47.0 bump.
- **bfra-me/.github reusable workflows + Renovate baseline:** v4.16.18 → v4.16.21 (both `renovate.yaml` workflow ref and `internal.json5#v4.16.21` extends).
- **pnpm:** 10.33.4 → 10.34.1 (via #3511 then #3514).
- **Published package versions:** All 9 unchanged (`@bfra.me/badge-config@0.2.0`, `create@0.7.14`, `doc-sync@0.1.9`, `es@0.1.0`, `eslint-config@0.51.1`, `prettier-config@0.16.9`, `semantic-release@0.3.7`, `tsconfig@0.13.1`, `workspace-analyzer@0.2.8` — last release still 2026-05-16).
- **Workflow inventory, package layout, Probot settings, branch protection (12 required checks), build/release pipeline:** identical.
- **Open issues:** 38 (unchanged). **Open PRs:** 1 → 2.
- No contradictions with prior ingest. `bfra-me/works` is currently the bleeding-edge agent adopter; sibling [[bfra-me--github]] and [[bfra-me--ha-addon-repository]] should be re-surveyed to confirm whether they have followed to v0.47.0.

Sources: https://github.com/bfra-me/works (SHA cd4a52d7d9ad59c8770784d9411d688e9a7d50db)

## [2026-05-31 08:27] ingest | repo:bfra-me/works

Surveyed bfra-me/works and updated the control-plane wiki.

Sources: https://github.com/bfra-me/works

## [2026-06-01 10:35] ingest | repo:marcusrbrown/marcusrbrown.github.io

Dependency-drift re-survey of `marcusrbrown/marcusrbrown.github.io` (SHA `1a428e2`, 2026-06-01; prior `4cd8198`, 2026-05-20). Updated repo page `marcusrbrown--marcusrbrown-github-io.md` (frontmatter, Fro Bot version, comparison table, new delta-log section, survey-history row) and its index entry. No new topic/entity/comparison pages warranted — the deltas are agent pin advances and dependency bumps, not structural.

Delta:

- **Fro Bot agent v0.44.0 → v0.48.1** across six bumps (#417 v0.44.1, #420 v0.46.0, #421 v0.46.1, #424 v0.48.0); `main` pin now `fro-bot/agent@80f1fa11d8e25280d388947c0a28875ed18cdc25 # v0.48.1`, folded in with non-major batch #425. The in-flight PR #417 from the 2026-05-20 survey has merged.
- **pnpm** 10.33.4 → 10.34.1 (#423); **`bfra-me/.github`** v4.16.17 → v4.16.21 (#419).
- Core stack unchanged: React ^19, TypeScript ^6, Vite ^7.0.6, Vitest ^4, `@types/node ^24`. Security overrides `fast-uri >=3.1.2` / `flatted >=3.4.2` intact.
- Workflow inventory (ci, copilot-setup-steps, deploy, fro-bot, renovate), single-file three-mode Fro Bot design, and crons (`30 3` autoheal / `30 15` maintenance) all unchanged.
- Open issues steady at 4 (#411, #409, #260, #6); 0 open PRs. Standing gaps hold: no Probot `settings.yml`, no CodeQL/Scorecard. No contradictions with prior ingests.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io (SHA 1a428e231d4d3be7de40bbc016192cc14cb5190b)

## [2026-06-01 10:36] ingest | repo:marcusrbrown/marcusrbrown.github.io

Surveyed marcusrbrown/marcusrbrown.github.io and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/marcusrbrown.github.io

## [2026-06-02 00:00] ingest | marcusrbrown/mrbro.dev

Incremental re-survey of `marcusrbrown/mrbro.dev` (SHA `7a49abc`, 2026-05-28; prior `88f7a4a`, 2026-05-21). Updated repo page `marcusrbrown--mrbro-dev.md` (frontmatter source/updated, issue/PR counts, rewrote Security Posture section, added Fro Bot prompt-hardening subsection, survey-history row) and refreshed its `index.md` entry. No new topic/entity/comparison pages warranted — the deltas are a dependency-hardening migration and a cross-repo prompt port, not structural code change.

Delta from prior survey (SHA `88f7a4a`, 2026-05-21):

- **pnpm `overrides` migrated `package.json` → `pnpm-workspace.yaml`** (#177, alongside `onlyBuiltDependencies` + `shamefullyHoist: true`). The list expanded to ~20 entries, each with an inline GHSA comment naming the advisory and the transitive path. New pins since 2026-05-21: `qs ^6.15.2` (GHSA-q8mj-m7cp-5q26), `ws ^8.20.1` (GHSA-58qx-3vcg-4xpx), `tmp >=0.2.6` (GHSA-52f5-9888-hmc6, best-effort — `@lhci/cli`/`external-editor` pin below safe range, #179), `rollup >=4.59.0`, `js-yaml >=4.1.1`, `flatted >=3.4.2`, `ajv >=8.18.0`, `mdast-util-to-hast >=13.2.1`, `minimatch >=10.2.3`, `yauzl >=3.2.1`, `@isaacs/brace-expansion >=5.0.1`, `brace-expansion ^5.0.6`. Most enter via `@lhci/cli` (Lighthouse) transitive trees. A new `pnpm audit` CI dependency-audit gate (#177) is the forcing function keeping this list current.
- **Fro Bot prompt hardening (#176, 2026-05-24):** ported 5 surgical prompt inserts from [[marcusrbrown--marcusrbrown]], developed during a 2026-05-23 session that fixed a 1.5-year silent automation outage (root cause: finalize job gated on `needs: prepare` where `prepare` had an `if:`, so the implicit `success()` guard skipped the downstream job every scheduled run). Inserts: skipped-needs trap detection + `continue-on-error` red-flag (PR review prompt), 7-day workflow-health monitor (maintenance prompt), plus two voice-preserving inserts. Clean example of cross-repo intelligence: a bug fixed in one managed repo propagates as a review heuristic into siblings.
- **Fro Bot agent unchanged at v0.43.0** (SHA `1563f298`); single-file three-mode workflow intact (autoheal `30 3`, maintenance `30 15`).
- **Open issues 8 → 4** (the four pin-version PRs inflating the count merged; canonical rolling pair #162/#13 + #1 dashboard + #48 triage hold). **Open PRs 5** (all Renovate: #180 prettier, #178 tmp override, #175, #172, #168).
- TypeScript still 5.9.3 (pre-v6), pnpm 10.33.4, Vitest 4.1.4. No structural code/layout change.
- **Fro Bot workflow present and current** — no follow-up draft PR needed.
- No contradictions with prior ingest — all findings confirmed and extended.

Sources: https://github.com/marcusrbrown/mrbro.dev (SHA 7a49abc3d2d945880cc1db1f4edbddcd71ad0142)

## [2026-06-02 09:24] ingest | repo:marcusrbrown/mrbro.dev

Surveyed marcusrbrown/mrbro.dev and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/mrbro.dev

## [2026-06-03 10:15] ingest | repo:fro-bot/agent

Re-survey of `fro-bot/agent` (SHA `d0f39a2`, v0.51.0, 2026-06-03; prior `8632cf4`, v0.44.3, 2026-05-22). Updated repo page `fro-bot--agent.md` (frontmatter sources/updated/tags, overview table, workspace layout, action inputs, new Workspace Agent + gateway-evolution sections, Renovate constants, dependency table, downstream consumers, workspace-packages table, survey-history row) and its `index.md` entry. No new topic/entity/comparison pages warranted — the deltas are structural feature growth within the existing repo, not a new cross-cutting concept (Hono and Effect remain confined to this repo's daemon/sandbox halves; if a second repo adopts either, an entity page is justified).

Delta from prior survey (v0.44.3 → v0.51.0, seven minors):

- **`apps/workspace-agent` shipped (v0.45.0, #674)** — a Hono HTTP service running *inside* the workspace container on port 9100 (internal `sandbox-net` only). Handles sandboxed git ops so the gateway never touches `docker.sock`. `/clone` is hardened against untrusted input: internally-derived dest paths, `[A-Za-z0-9._-]+` owner/repo validation, `GIT_ASKPASS` token injection (never argv), post-clone realpath escape check, atomic temp-dir rename, 4 KB body cap, 19 distinct error codes. v0.50.0 (#725/#728) built the executor image and provisioned OpenCode model/provider/auth — the `workspace` compose service is no longer a placeholder.
- **Gateway became a working Discord control plane** — channel↔repo bindings store + GitHub App auth (v0.45.0), `/fro-bot add-project` (v0.46.0), `@fro-bot` mention→OpenCode execution (v0.48.0), sensitive-tool **approval prompts** + boot provider-semantics self-test + opt-in announce/presence endpoint (v0.51.0). Gateway `src/` now `approvals/`, `bindings/`, `discord/`, `execute/`, `github/`, `http/`, `workspace-api/`.
- **OMO Slim** added as opt-in orchestration (v0.49.0, #722): `enable-omo-slim` input (mutually exclusive with `enable-omo`), `omo-slim-preset` (default `openai`), pinned `DEFAULT_OMO_SLIM_VERSION = '1.1.1'` (stable line, not the 2.0.0-beta channel), fifth Renovate custom regex manager.
- **Action inputs expanded** — `skip-cache`, `omo-providers`, and a full S3/KMS surface (`s3-key-prefix`, `s3-expected-bucket-owner`, `s3-allow-insecure-endpoint`, `s3-kms-key-id`, `s3-sse`, `aws-region`).
- **Shared layer relocated** — pinned-version constants now live in `packages/runtime/src/shared/constants.ts`; the action's Layer 0 re-exports from the runtime. Both a root `src/` and `apps/action/src/` coexist (action still ships from root `dist/`); the action's migration into `apps/action` is in progress.
- **Deps/tooling** — `@aws-sdk/client-s3` 3.1045→3.1057, `tsdown` 0.22.0→0.22.1, Vitest 4.1.6→4.1.7, `@actions/cache` 6.0.0→6.0.1, ESLint 10.3→10.4, `hono` 4.12.23 + `@hono/node-server` 1.19.14 new; Node 24.16.0-alpine in Docker images; `pnpm.overrides` fully migrated to `pnpm-workspace.yaml` (v0.45.0, #665) with `brace-expansion` bumped to >=5.0.6 at v0.51.0 (#734); `vite` pin 8.0.13→8.0.14. Stars 1→2.
- **Open regression (#741):** at v0.51.0 the workspace egress is broken — mitmproxy on the internal-only `sandbox-net` returns 502 on all outbound, so `/fro-bot add-project` clones fail. Noted on the repo page; tracks the cost of fail-closed proxy posture meeting a network with no permitted egress route.
- **Fro Bot workflow present and self-hosted** (`fro-bot.yaml` dogfoods `uses: ./`; daily DMR 15:30 UTC, weekly wiki Sun 20:00 UTC). No follow-up draft PR needed.
- No contradictions with prior ingest — the 2026-05-22 prediction that `services/object-store/` migrated into `@fro-bot/runtime` is reinforced by the shared-constants relocation into runtime.

Survey limited to directory listings, README/AGENTS files, manifests, workflows, and release notes per untrusted-input constraint. Modified only `knowledge/wiki/repos/fro-bot--agent.md`, `knowledge/index.md`, `knowledge/log.md`.

Sources: https://github.com/fro-bot/agent (SHA d0f39a25b443b60e51da709b9d13065d6a62d157)

## [2026-06-03 10:16] ingest | repo:fro-bot/agent

Surveyed fro-bot/agent and updated the control-plane wiki.

Sources: https://github.com/fro-bot/agent

## [2026-06-04 09:10] ingest | marcusrbrown/renovate-config

Re-survey of `marcusrbrown/renovate-config` (SHA `499f0ca`, was `3478c88` at 2026-05-23). Additive update to `marcusrbrown--renovate-config.md`. No preset policy change — this was a dependency-churn cycle, not a behavior change.

Key findings:

- **Preset policy stable.** Latest release still `5.2.0`; `default.json` extends/packageRules and the bfra-me base pin `#5.2.1` are byte-identical to the prior survey. `onboarding.json`, `archived-repository.json`, and the self-referential `.github/renovate.json5` (regex manager + postUpgradeTasks) unchanged.
- **Fro Bot agent jumped v0.44.3 → v0.52.1** (SHA `28cf93a`) — eight Renovate-authored minor bumps (#1338–#1353) in ~12 days, tracking [[fro-bot--agent]]'s release cadence. Runner action pins also advanced: checkout v6.0.3, setup-node v6.4.0, pnpm/action-setup v6.0.8.
- **bfra-me renovate reusable workflow** v4.16.9 → v4.16.23 (#1337 → #1354).
- **Tooling bumps:** pnpm 11.1.3 → 11.5.0, eslint 10.4.0 → 10.4.1, eslint-plugin-prettier 5.5.5 → 5.5.6, lint-staged 17.0.5 → 17.0.7. pnpm supply-chain overrides unchanged.
- **Cross-Project Intelligence focus-list evolved:** the schedule prompt now leads with two of Marcus's other repos selected for agentic-safety / autohealing-strategy intelligence. Both are **private** — names and contents deliberately omitted from the wiki per the public-only invariant. Documented the evolution generically on the repo page.
- **Open-issue composition drift:** count holds at 6, but the active perpetual issue is now #1314 (a new number), and legacy `Daily Maintenance Report` (#1111) + three `Weekly Maintenance Report — YYYY-MM-DD` issues persist. The autoheal cleanup matcher only sweeps `Daily Autohealing Report — YYYY-MM-DD` dated issues, so these differently-titled legacy reports linger. Flagged as a manual-cleanup / broadened-matcher candidate.
- Fro Bot workflow present and active — no follow-up draft PR needed.

Survey limited to directory listings, README/AGENTS files, manifests, and workflow files per untrusted-input constraint. Modified only `knowledge/wiki/repos/marcusrbrown--renovate-config.md`, `knowledge/index.md`, `knowledge/log.md`.

Sources: https://github.com/marcusrbrown/renovate-config (SHA 499f0cac43d2077ab5498ed7b213366cbc74e079)

## [2026-06-04 09:08] ingest | repo:marcusrbrown/renovate-config

Surveyed marcusrbrown/renovate-config and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/renovate-config

## [2026-06-04 14:42] ingest | repo:fro-bot/agent

Re-surveyed `fro-bot/agent` at SHA `34abe2abc779e942444df86342956542dbfc6b3c` (was `d0f39a2` @ 2026-06-03). Release jumped v0.51.0 → v0.53.1 (three releases). Updated `knowledge/wiki/repos/fro-bot--agent.md` additively and refreshed the `index.md` catalog entry.

Key findings:

- **New `packages/harness` (`@fro.bot/harness`)** shipped at v0.53.0 (#752) — a published, public, OIDC-trust-published patched-OpenCode CLI built via [cortexkit/orw](https://github.com/cortexkit/orw)'s LLM-merge integration method. It is now "the default OpenCode for Fro Bot," replacing the stock OpenCode download in action setup, and is the workspace's **only published** member (the others are private). Workspace is now **5 members**. Added a full "Harness" section (CLI contract, provenance model, per-platform distribution, carry policy) and a "Build / Publish Pipeline" subsection.
- **New `harness-release.yaml` workflow** (10 workflows total) — fenced to manual dispatch / `harness-v*` tag. Strong supply-chain posture: read-only build job with **no `id-token`** (untrusted LLM-merge + upstream build), OIDC trusted-publish scoped to a separate job, per-platform `optionalDependencies` injected at publish time to keep `pnpm-lock.yaml` clean. Bootstrap caveat noted (npm trusted publishing requires pre-existing packages).
- **OpenCode pinned to 1.15.13** (#742, SDK + CLI) to clear the 1.14.42+ `/event` SSE `SyncEvent` regression (upstream #27959). The new event contract (`message.part.updated` / `message.part.delta`) drove the gateway tool-progress migration (#744, v0.52.0); legacy handlers retained as fallback. Renovate caps OpenCode at 1.15.13. `harness.config.json` bases its integration on this same `base_version: 1.15.13`. `DEFAULT_MODEL` documented as `opencode/big-pickle`.
- **Egress regression #741 resolved** by #747 (v0.52.1) — workspace egress restored + configurable proxy allowlist. Follow-on hardening open as #746 (DNS-rebinding TOCTOU + topology-guard bypass) and #745 (live mitmproxy egress smoke test).
- **Cold-boot supervisor regression #749 fixed** by #755 (v0.53.1) — prevents the `apps/workspace-agent` OpenCode supervisor cold-boot readiness hang.
- Open issues 2 → 6, open PRs 5 → 4 (all Renovate/CI dep bumps). Stars steady at 2.
- Fro Bot workflow present and self-hosted (`fro-bot.yaml` self-references `./`; daily DMR 15:30 UTC, weekly wiki Sun 20:00 UTC) — no follow-up draft PR needed.

Survey limited to directory listings, README/AGENTS files, manifests, constants, and workflow files per untrusted-input constraint. Modified only `knowledge/wiki/repos/fro-bot--agent.md`, `knowledge/index.md`, `knowledge/log.md`.

Sources: https://github.com/fro-bot/agent (SHA 34abe2abc779e942444df86342956542dbfc6b3c)

## [2026-06-04 14:46] ingest | repo:fro-bot/agent

Surveyed fro-bot/agent and updated the control-plane wiki.

Sources: https://github.com/fro-bot/agent

## [2026-06-04 15:20] ingest | repo:fro-bot/tokentoilet

Surveyed fro-bot/tokentoilet (SHA `a141424`) and created its repo page. The target is a **public fork** of [[marcusrbrown--tokentoilet]] living under the `fro-bot` account — public, so safe for the wiki per the public-only invariant.

Key findings:

- **Frozen fork, not a divergent project.** Created 2026-04-14, last pushed 2026-04-16, then static. It captures the upstream pre-MVP codebase state (before the Sepolia `/flush` disposal flow merged on the parent in PR #911). No fork-specific divergence beyond version lag was observed in the surveyed surfaces.
- **~Month behind upstream on every axis.** Fork sits on wagmi v2 / pnpm 10.33.0 / Next 16.1.4 / TS 6.0.2 / ESLint 10.1.0; upstream has since crossed wagmi v2→v3 and pnpm v10→v11 (Next 16.2.6). Storybook alpha-addon drift inherited from upstream.
- **Fro Bot workflow present** (`fro-bot.yaml`) — requirement satisfied, no missing-workflow follow-up draft needed. But it pins **`fro-bot/agent@v0.37.0`** (SHA `7fa1422`), ~16 minor versions behind [[fro-bot--agent]]'s v0.53.1 and behind upstream's v0.45.0. Daily schedule (`30 3 * * *`), full PR-review + five-category autoheal prompts. The actionable gap is the stale agent pin and the open question of whether the fork's automation is intentionally live.
- **Doc drift:** `readme.md`/`mvp.md` badges advertise Next 14 / TS 5.7 / Tailwind 3.4 — stale by two major Next versions vs the real `package.json` (Next 16 / TS 6 / Tailwind 4). Upstream-inherited, not fork-introduced. No license file (inherits upstream's no-license state).

Touched pages: created `knowledge/wiki/repos/fro-bot--tokentoilet.md`; cross-linked [[marcusrbrown--tokentoilet]] (fork note + `related` + source); added the fork to [[web3-defi]] repositories list; cataloged in `knowledge/index.md`. Modified only `knowledge/wiki/**`, `knowledge/index.md`, and `knowledge/log.md`. Survey limited to directory listings, README, manifest, and workflow files per untrusted-input constraint.

Sources: https://github.com/fro-bot/tokentoilet (SHA a141424e89c133a3c8e1a7544f31193afc5af21c)

## [2026-06-04 15:19] ingest | repo:fro-bot/tokentoilet

Surveyed fro-bot/tokentoilet and updated the control-plane wiki.

Sources: https://github.com/fro-bot/tokentoilet

## [2026-06-04 16:00] maintenance | privacy-gate:wiki-attribution

Removed the `fro-bot--tokentoilet` wiki page. `fro-bot/tokentoilet` has no entry in `metadata/repos.yaml`, so `check-wiki-private-presence.ts` flagged the page as an `unattributable-page` and fail-closed the data→main promotion. An unattributable wiki page is a privacy leak by the gate's contract regardless of the underlying repo's actual visibility — the gate cannot prove the source is public without a `private: false` entry.

Removed: deleted `knowledge/wiki/repos/fro-bot--tokentoilet.md`; dropped the catalog line from `knowledge/index.md`; removed the fork note + `related` entry from [[marcusrbrown--tokentoilet]]; removed the repositories-list entry from [[web3-defi]]. The prior survey entries above are left intact as chronological record; their `fro-bot--tokentoilet` mentions are backtick file-path text, not live wikilinks, so no broken links remain.

Verified: ran the gate against the data tree (grandfather = main wiki) — `no private wiki leaks detected`, exit 0. With the page restored the gate reports `Leak count: 1`, confirming the orphan was the sole leak. Did not touch `metadata/repos.yaml` or anything outside `knowledge/`.

Sources: scripts/check-wiki-private-presence.ts

## [2026-06-05 00:00] ingest | marcusrbrown/sparkle

Re-survey of `marcusrbrown/sparkle` (SHA `e03e317`). Updated `knowledge/wiki/repos/marcusrbrown--sparkle.md` and `knowledge/index.md`.

Key findings (delta from 2026-05-23 at SHA `e757fa6`):

- **Fro Bot agent workflow landed** — `fro-bot.yaml` present, agent v0.54.2. This resolves the gap flagged across all prior surveys. Triggers: PR events, issue events (trusted authors), `@fro-bot` mentions, schedule at 05:00 (autoheal) and 17:00 UTC (maintenance), workflow_dispatch.
- **pnpm** bumped `10.33.4` → `10.34.1` (root `packageManager` field).
- **Workflow count:** 6 → 7 (fro-bot.yaml added).
- **`opencode.jsonc`** added at repo root — points OpenCode `instructions` to `.github/copilot-instructions.md`.
- **PR #1604** (Astro v6 security) no longer open — resolved between surveys.
- **Issue #57** ("Uplift sparkle") closed.
- **New fro-bot issues:** #1665 (perpetual "Daily Autohealing Report"), #1664 (stale TODO/FIXME review).
- **New fro-bot PRs:** #1681 (Turbo task graph fix — `@sparkle/test-utils#build` missing from test task deps), #1663 (API docs regen).
- **Open issues:** 4 (up from 3). **Open PRs:** 3 (up from 2).
- `llms.txt` references pnpm `10.33.4` but actual is `10.34.1` — minor doc drift flagged in page.
- Node.js 24.16.0, TypeScript strict, ESM-only, `@bfra.me` toolchain, Renovate preset v5.2.0 — all unchanged.

Touched pages: `knowledge/wiki/repos/marcusrbrown--sparkle.md` (updated frontmatter, overview, tooling, CI/CD table, Fro Bot section rewritten from "missing" to "active", open PRs/issues section, survey history, notable patterns, developer tooling, shared ecosystem patterns table, key files table); `knowledge/index.md` (updated sparkle catalog line).

Sources: https://github.com/marcusrbrown/sparkle (SHA e03e3173c70087d08e0def5196db624de964bf50)

## [2026-06-05 08:58] ingest | repo:marcusrbrown/sparkle

Surveyed marcusrbrown/sparkle and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/sparkle

## [2026-06-06 00:00] ingest | marcusrbrown/.dotfiles

Incremental survey from SHA `0bb24f0` (2026-05-24) to SHA `70c211bc` (2026-06-06). 71 commits. Updated `marcusrbrown--dotfiles.md` and `index.md`.

Key changes:

- **Fro Bot agent**: v0.44.3 → v0.55.1 (18 version jumps across 71 commits, including v0.45–v0.55 series)
- **Auth plugin migrated**: `@cortexkit/opencode-anthropic-auth@1.2.2` → `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (Marcus's own published fork via [[marcusrbrown--cortexkit-anthropic-auth]])
- **Default model declared**: `opencode-go/kimi-k2.6` as top-level model in `opencode.json`
- **oh-my-opencode-slim routing**: 4 named presets (`openai`, `opencode-go`, `copilot`, `mixed`); active preset `mixed` uses `anthropic/claude-opus-4-8` as orchestrator; `ce` skill removed from presets
- **General/explore agents disabled** in `opencode.json`
- **Discord MCP server added** (disabled by default)
- **New config files**: `aft.jsonc` (AFT plugin config), `systematic.jsonc` (systematic skills config)
- **Plugin versions bumped**: magic-context 0.21.8 → 0.22.4, aft-opencode 0.29.1 → 0.35.4, systematic 2.23.4 → 2.28.0
- **magic-context updates**: Historian model changed to `openai/gpt-5.5` (full), `claude-opus-4-8` added to cache TTL, `temporal_awareness: true`, `system_prompt_injection` block added
- **Tool version bumps**: rust 1.96.0, go 1.26.4, pnpm 11.5.1, npm 11.16.0, opencode-ai 1.16.2, biome 2.4.16, deno 2.8.2
- **Renovate**: semver versioning for OpenCode plugin regex manager, cross-series prerelease upgrade support
- **bfra-me/.github** bumped to v4.16.21

Sources: https://github.com/marcusrbrown/.dotfiles (SHA 70c211bc269b4bb8c476a3929fd976bc51153b1c)

## [2026-06-06 08:09] ingest | repo:marcusrbrown/.dotfiles

Surveyed marcusrbrown/.dotfiles and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/.dotfiles

## [2026-06-07 08:33] ingest | marcusrbrown/containers

Incremental re-survey of `marcusrbrown/containers` (SHA `8aeadf73`, 2026-06-06). Updated repo page `marcusrbrown--containers.md`, topic page `github-actions-ci.md`, and `index.md` description. No new topic/entity/comparison pages warranted — changes slot into existing cross-cutting pages.

Delta from prior survey (SHA `6f8a1014`, 2026-05-25):

- **AI config scaffold merged** (PR #584, 2026-06-06): long-pending Copilot SWE-agent PR finally lands. Adds first-class `containers ai config` CLI subcommand (`--init`, `--validate`, `--file` flags), `ai_config.example.yaml` canonical reference config, and three new docs (`docs/AI_CONFIGURATION.md`, `docs/AI_CLI_GUIDE.md`, `docs/AI_VERIFICATION_REPORT.md`). The CLI is now self-bootstrapping for AI feature setup.
- **Security patch** (PR #620, 2026-06-06): qs 6.15.2, express 4.22.2, and idna 3.17 patched in Express template and Python transitive deps.
- **Fro Bot agent jumped v0.44.0 → v0.55.0** (SHA `f73a3e59...`, PR #630, 2026-06-05) — largest single-survey version jump observed for this repo.
- **dorny/paths-filter bumped v3 → v4** (SHA `fbd0ab8f...`, PR #607) — minor interface change; the `v4.0.1` pin resolves the v4 PR in flight noted in the prior survey.
- **pnpm bumped 10.33.0 → 10.34.1** (PR #622). Note: v10.34.x `.tar.gz` assets are missing from the Aqua backend, so pnpm was temporarily reverted to 10.33.0 in one commit (#624) before the aqua backend caught up.
- **Node.js bumped 24.15.0 → 24.16.0** (mise.toml).
- **openai bumped >=2.36.0 → >=2.41.0,<2.42.0** (PR #628).
- **Continuous Node.js/Debian base image digest rotation** (#621–#630 range).
- **Open PRs at survey time:** 3 (Copilot pytest PR #583 still pending since 2026-04-18; two mrbro-bot Renovate pin PRs #611/#612). Open issues: 6.
- **Observed drift:** `bfra-me/.github` reusable renovate workflow still pinned at v4.16.0 (SHA `65caa6a...`) — behind the ecosystem median of v4.16.21+ seen in sibling repos. Renovate has PRs in flight to address this. Flagged as a potential drift candidate in the repo page.

No contradictions with prior surveys. Repository structure, container variants, template system, Dockerfile patterns, CI pipeline, and branch protection are unchanged.

Sources: https://github.com/marcusrbrown/containers (SHA 8aeadf737140077d3e976d30d70caee9cd09a885)

## [2026-06-07 08:38] ingest | repo:marcusrbrown/containers

Surveyed marcusrbrown/containers and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/containers

## [2026-06-08 00:00] ingest | marcusrbrown/gpt

Incremental re-survey of `marcusrbrown/gpt` (SHA `36b50c9`, up from `aac0103` on 2026-05-27). Updated repo page `marcusrbrown--gpt.md` and topic page `langchain.md`. Updated `index.md` description. No new topic/entity/comparison pages warranted — delta is dependency hygiene and an accessibility fix.

Delta from prior survey (SHA `aac0103`, 2026-05-27):

- **`fro-bot/agent` bumped:** v0.45.0 → v0.57.0 (SHA `4470582693390235d4ab6fce1049373225025590`). `actions/checkout` pinned at v6.0.3 (`df4cb1c`). New `opencode-config` secret input added to agent step.
- **LangChain updates:** `langchain` 1.4.2 → 1.4.4, `@langchain/langgraph` 1.3.2 → 1.3.5.
- **Dependency bumps:** `vite` 8.0.14 → 8.0.16, `react-router-dom` 7.15.1 → 7.17.0, `openai` → 6.42.0, `dexie` 4.4.2 → 4.4.3, `vitest` 4.1.7 → 4.1.8, `@vitest/eslint-plugin` 1.6.18 → 1.6.19, `@vitest/coverage-v8` 4.1.7 → 4.1.8, `eslint` 10.4.0 → 10.4.1, `@types/node` → 24.12.4, `lucide-react` → 0.577.0, `lint-staged` → 16.4.0, `pnpm` 10.33.4 → 10.34.1, `@typescript/native-preview` → 7.0.0-dev.20260604.1.
- **Accessibility fix:** Removed nested sidebar landmark (PR #2525, 2026-06-08). AGENTS.md updated for Vite 8 alignment.
- Single three-mode `fro-bot.yaml` workflow confirmed — no separate `fro-bot-autoheal.yaml`. Open issues: 25.
- No structural or application-code changes.

Sources: https://github.com/marcusrbrown/gpt (SHA 36b50c9254c1795edd75331a4b0dad07961a49e1)

## [2026-06-08 10:02] ingest | repo:marcusrbrown/gpt

Surveyed marcusrbrown/gpt and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/gpt

## [2026-06-09 00:00] ingest | marcusrbrown/cortexkit_anthropic-auth

Incremental re-survey of `marcusrbrown/cortexkit_anthropic-auth` (SHA `99fdbe9`, 2026-05-31). Updated `marcusrbrown--cortexkit-anthropic-auth.md`, `opencode-plugins.md` topic page, and `index.md`.

Key delta from prior survey (SHA `517d385`, 2026-05-28):

- **Fro Bot workflow landed** — `fro-bot.yaml` present, agent v0.45.0 (SHA `8aac0fc`). This resolves the "no Fro Bot workflow" gap flagged in the prior survey. Three-mode: review/maintenance/autoheal. Weekly maintenance Monday 09:00 UTC, daily autoheal 03:30 UTC. Release invariants are baked directly into every prompt env-var, covering both the constraint list and the "never break npm Trusted Publishing/OIDC" rule.
- **Version bumped**: `1.2.2-mb.2` → `1.2.5-mb.3` for both `@marcusrbrown/anthropic-auth-core` and `@marcusrbrown/opencode-anthropic-auth`. Pi stays private at upstream `1.2.5`.
- **Bundled skill added**: `.agents/skills/anthropic-auth-upstream-release/SKILL.md` — covers upstream sync and fork release procedure. First repo-local operational skill observed in the Marcus ecosystem.
- **New script**: `scripts/analyze-claude-dumps.mjs` with volatile-field (`cch`) filtering.
- **Upstream sync landed**: `chore(sync): merge upstream v1.2.5` on 2026-05-28 — fork is tracking upstream actively.
- **New changelog entries**: `1.2.3` (OAuth refresh realignment with live-tested request shape + `Retry-After` backoff), `1.2.4` (serialize fallback-account OAuth refreshes across processes), `1.2.5` (quota snapshot reuse for rate-limited probe paths).
- **Repo size**: 387 KB → 520 KB.
- **Open issues**: 0 → 1 (#11 "Daily Autohealing Report" perpetual issue, under `marcusrbrown`).
- **Open PRs**: 0.
- **`@opencode-ai/plugin` devDep**: bumped to `1.15.5`.

Topic update: `opencode-plugins.md` received a new "Bundled Skill for Upstream Sync" section documenting the `.agents/skills/` pattern and adding the updated source SHA.

Sources: https://github.com/marcusrbrown/cortexkit_anthropic-auth (SHA 99fdbe906c5875893d363c904f6e6bc066d997b1)

## [2026-06-09 00:00] ingest | repo:marcusrbrown/cortexkit_anthropic-auth

Surveyed marcusrbrown/cortexkit_anthropic-auth and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/cortexkit_anthropic-auth

## [2026-06-09 08:50] ingest | repo:marcusrbrown/cortexkit_anthropic-auth

Surveyed marcusrbrown/cortexkit_anthropic-auth and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/cortexkit_anthropic-auth

## [2026-06-09 12:00] ingest | marcusrbrown/tokentoilet

Survey of `marcusrbrown/tokentoilet` (SHA `76d543e`). Updated existing repo page `marcusrbrown--tokentoilet.md`. Updated `index.md` entry. This is the 7th survey of this repo.

Key deltas since last survey (2026-05-28, SHA `db6dbcc`):

- **Fro Bot agent: v0.45.0 → v0.59.0** — 14 Renovate-merged releases in 12 days, the fastest agent version churn in the portfolio. SHA updated to `feb5365dca6dc56752e1258d1ca66afa7b035e04`.
- **pnpm 11.3.0 → 11.5.2** — Non-major bump via Renovate batch update.
- **Next.js 16.2.6 → 16.2.7, React 19.2.6 → 19.2.7** — Patch increments landed cleanly.
- **vite 8.0.14 → 8.0.16, vitest 4.1.7 → 4.1.8, eslint 10.4.0 → 10.4.1, Storybook 10.4.1 → 10.4.2** — Non-major tooling bumps.
- **Renovate preset bumped: #5.2.0 → #5.2.1**
- **bfra-me/.github reusable workflow: → v4.16.24** — Both renovate.yaml and update-repo-settings.yaml updated.
- **PR #1033 (blocking):** `@bfra.me/eslint-config` v0.51.1 Renovate PR open since 2026-05-16 with lint failures (TypeScript type errors in test files). Only open PR as of this survey.
- **Design system / Web3 validation failures stable:** 5 missing component test/story files, 2 Web3 validation issues — unchanged across 12+ daily autohealing reports. Human decision needed.
- **Abandoned deps accumulating:** 6 packages flagged (led by `crypto-js` last updated 2023-10-24). `@metamask/sdk` and `@metamask/sdk-communication-layer` deprecated with no replacement PRs.
- **`copilot-instructions.md` added to `.github/`** — GitHub Copilot coding agent instructions now present alongside AGENTS.md and Fro Bot workflow.
- **Renovate preset updated:** `marcusrbrown/renovate-config` bumped to `5.2.1` in `.github/renovate.json5`.

No new topic, entity, or comparison pages warranted by this survey — all observations are updates to the existing repo page.

Sources: https://github.com/marcusrbrown/tokentoilet (SHA 76d543e213abdc2823c1e0c2a7b0fdcdf7bc9727)

## [2026-06-09 15:44] ingest | repo:marcusrbrown/tokentoilet

Surveyed marcusrbrown/tokentoilet and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/tokentoilet

## [2026-06-10 04:00] ingest | marcusrbrown/vbs

Survey of `marcusrbrown/vbs` (SHA `abe4998`). Updated existing repo page `marcusrbrown--vbs.md` (5th survey), updated [[github-actions-ci]] Fro Bot Agent table (vbs row added), updated `index.md` entry.

Key deltas since last survey (2026-05-29, SHA `69db16a`), 28 commits over 9 days:

- **Unified single-job Fro Bot workflow (PR #594, 2026-05-30, Fro Bot-authored):** separate `fro-bot-autoheal` job removed from `fro-bot.yaml`; autoheal routed through the single `fro-bot` job via mode-based PROMPT dispatch. `both` mode dropped (now `review`/`maintenance`/`autoheal`, default `autoheal`). Schedule concurrency now keys on `github.event.schedule`. Fork-PR + bot-author guard added at job `if` level. Matches `marcusrbrown/marcusrbrown` and tokentoilet pattern.
- **opencode-config job secret (PR #593, Marcus-authored)** — the sole human commit in the delta.
- **Fro Bot agent: v0.46.0 → v0.55.4** — 15 Renovate bumps in 9 days, full upstream cadence.
- **Renovate preset #5.2.0 → #5.2.1; pnpm 10.33.4 → 10.34.1; vite pinned 7.3.2 → 7.3.5; bfra-me/.github → v4.16.23.**
- **Open PRs: 1 → 0** (long-open #577 vite pin merged). Open issues: 14 → 13. No application code changes; maintenance autopilot aside from CI consolidation.
- Contradiction handling: prior "three operating modes + both" description superseded additively; no license file at root carried forward unchanged.

Fro Bot workflow is present and active — no follow-up onboarding PR needed.

Sources: https://github.com/marcusrbrown/vbs (SHA abe4998fdd597743219edf5c0249b71cc00c9e56)

## [2026-06-10 04:00] ingest | repo:marcusrbrown/vbs

Surveyed marcusrbrown/vbs and updated the control-plane wiki.

Sources: https://github.com/marcusrbrown/vbs

## [2026-06-10 09:05] ingest | bfra-me/ha-addon-repository

Third survey of `bfra-me/ha-addon-repository` (SHA `0a163c3f`, unchanged). Updated repo page `bfra-me--ha-addon-repository.md` (survey-history row, drift watch, identity), updated `index.md` entry.

Key deltas since last survey (2026-05-30):

- **`main` HEAD frozen for 25 days** — last merge was prettier 3.8.3 (#551) on 2026-05-16. No content drift on workflows, settings, or the `example/` add-on.
- **Renovate queue grew 4 → 5 PRs, all green but BLOCKED on REVIEW_REQUIRED:** #556 (`bfra-me/.github` → v4.16.24, blocked 27 days), #557 (`fro-bot/agent` → v0.59.1, now a 16-minor-version jump from pinned v0.43.1), #558 (HA `amd64-base:3.23` digest), #559 (`docker/login-action` v4.2.0), new #560 (`actions/checkout` v6.0.3).
- **Review-required deadlock identified:** branch protection requires 1 approving review with `enforce_admins: true`, but nobody is reviewing. The `Daily Autohealing Report` (#554, updating daily) has escalated to assigning approval tasks to Copilot — the review pipeline, not CI, is the bottleneck. Recorded in Drift Watch with remediation options.
- Fro Bot workflow present and active — no onboarding follow-up needed.
- No new topic/entity/comparison pages warranted; existing cross-references ([[home-assistant]], [[probot-settings]], [[fro-bot--agent]]) remain accurate.

Sources: https://github.com/bfra-me/ha-addon-repository (SHA 0a163c3fa8846704103658142fa742f40d165743)

## [2026-06-10 09:08] ingest | repo:bfra-me/ha-addon-repository

Surveyed bfra-me/ha-addon-repository and updated the control-plane wiki.

Sources: https://github.com/bfra-me/ha-addon-repository

## [2026-06-11 09:51] ingest | bfra-me/works

Third survey of `bfra-me/works` (SHA `499b215`). Updated repo page `bfra-me--works.md` (identity, Fro Bot pin, Renovate baseline, cross-repo links, follow-ups, survey-history row), updated [[github-actions-ci]] (workflow inventory line + Fro Bot table row), updated `index.md` entry.

Key deltas since last survey (2026-05-31, SHA `cd4a52d`):

- **`fro-bot/agent` v0.47.0 → v0.60.0** — 13 automerged Renovate bumps across 2026-05-31→06-10 (v0.55.x ladder through v0.59.1, landing v0.60.0 in #3649). Fleet-leading pin; sharp contrast with [[bfra-me--ha-addon-repository]] still review-deadlocked at v0.43.1.
- **`bfra-me/.github` reusable renovate workflow + `internal.json5` baseline v4.16.21 → v4.16.25** (#3651, HEAD commit). `update-repo-settings.yaml` still pinned at v4.16.0.
- **Node 24.15.0 → 24.16.0.** pnpm 10.34.1, TypeScript 6.0.3 unchanged.
- **Release stall observation:** last npm publish remains 2026-05-16; Changesets PR #3652 accumulates `@bfra.me/create@0.7.15` + sibling patch bumps.
- **3 Fro Bot-authored PRs open without review** (#3508 workspace-analyzer comparator peer ranges, #3619 security template vitest bump, #3620 AGENTS docs) — milder form of the review-pipeline gap seen at ha-addon-repository. Recorded under Open Questions / Follow-Ups.
- Workflow inventory (11 + 1 doc), package layout, workspace config, Probot settings, branch protection, conventions all unchanged.

Fro Bot workflow present and active — no onboarding follow-up needed. No new topic/entity/comparison pages warranted.

Sources: https://github.com/bfra-me/works (SHA 499b2156515414fd1d85561b52efcce4fb93536d)

## [2026-06-11 09:52] ingest | repo:bfra-me/works

Surveyed bfra-me/works and updated the control-plane wiki.

Sources: https://github.com/bfra-me/works
