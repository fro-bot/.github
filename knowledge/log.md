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
