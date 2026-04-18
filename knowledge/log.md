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
