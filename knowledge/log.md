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

## [2026-04-18 08:00] ingest | marcusrbrown/gpt

Survey of `marcusrbrown/gpt` (SHA `60bd62e`). Created repo page `marcusrbrown--gpt.md` and entity page `fro-bot-agent.md`. Updated `index.md` to catalog both pages.

Key findings:

- Local-first GPT creation platform deployed at gpt.mrbro.dev (GitHub Pages)
- React 19 + TypeScript 5.9 + Vite 7 + HeroUI + TailwindCSS 4 + IndexedDB (Dexie) + Web Crypto (AES-GCM)
- Multi-provider LLM abstraction via `BaseLLMProvider`: OpenAI, Anthropic, Ollama, Azure
- LangChain integration + MCP (Model Context Protocol) client support
- 13 RFCs documenting architectural decisions (IndexedDB, security, providers, MCP, Tauri desktop app plan)
- Uses tsgo (`@typescript/native-preview`) for faster type checking
- Zod 4 schema-first validation pattern, strict TypeScript mode
- Comprehensive test pyramid: Vitest (unit), Playwright (E2E, a11y, visual, performance), Lighthouse (Core Web Vitals)
- **Full Fro Bot agent integration** — PR review workflow, daily maintenance, and daily autoheal (fro-bot/agent@v0.40.2)
- Autoheal workflow covers errored PRs, security, code quality, DX, and quality gates with hard safety boundaries
- Shared ecosystem infra with marcusrbrown/ha-config: Renovate config, Probot settings, @bfra.me/\* configs, pnpm
- Deno Jupyter notebooks for agent R&D (repo-ranger, gpt-architect, baroque-bitch)
- Entity page created for `fro-bot-agent` documenting operational modes and adoption status across repos

Sources: https://github.com/marcusrbrown/gpt (SHA 60bd62e86caa1a07610c2162d9ffbb917d172dc3)
