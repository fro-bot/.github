# Wiki Index

Master catalog of all wiki pages, organized by type.

## Repos

- [[bfra-me--github]] — Org control center for `@bfra-me`; pnpm/TypeScript monorepo with 3 custom actions (`renovate-changesets`, `update-metadata`, `update-repository-settings`), 17 workflows, org-wide Fro Bot autoheal (weekdays), canonical `bfra-me/.github:common-settings.yaml`, Fro Bot agent v0.44.2
- [[bfra-me--ha-addon-repository]] — Template repository for a Home Assistant add-on repository (bfra-me org); multi-arch Docker builds via `home-assistant/builder`, GHCR publishing with cosign, Fro Bot agent v0.43.1 with add-on-aware review/autoheal
- [[bfra-me--renovate-action]] — bfra-me/renovate-action
- [[bfra-me--works]] — `@bfra-me` tooling monorepo (pnpm 10, TS 6, ESM); 8 published packages (`eslint-config`, `prettier-config`, `tsconfig`, `es`, `create`, `badge-config`, `doc-sync`, `semantic-release`, `workspace-analyzer`) + Astro Starlight docs; 11 workflows; Fro Bot agent v0.44.2 with three-mode single-file workflow (PR review / Daily Maintenance Report / Daily Autohealing Report)
- [[fro-bot--agent]] — GitHub Action harness for OpenCode + oMo agents with persistent session state; core runtime powering Fro Bot's PR review, issue triage, scheduled maintenance, and wiki-update capabilities across all managed repos
- [[fro-bot--fro-bot-github-io]] — fro-bot/fro-bot.github.io
- [[fro-bot--systematic]] — Built docs + OCX registry deployment target for `@fro.bot/systematic` at fro.bot/systematic/; `gh-pages`-only repo (no Fro Bot workflow needed); now also hosts the pinned JSON Schema for `systematic.json` user config at `/schemas/v2/`; registry advanced to v2.20.6 with 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin)
- [[marcusrbrown--dotfiles]] — Marcus's primary dotfiles repo: bare-git pattern, XDG-compliant, multi-shell (Bash + Zsh + Sheldon + Starship), mise-managed toolchain (Node 24.16/Python 3.14.5/Rust 1.95/Go 1.26.3/Bun 1.3.14/pnpm 11.2), published devcontainer image on GHCR, Fro Bot agent v0.44.3, Renovate preset v5.2.0; OpenCode plugin stack consumes [[marcusrbrown--systematic]] and [[marcusrbrown--opencode-copilot-delegate]]; first repo to declare custom `openai/gpt-5.5` provider models in OpenCode config
- [[marcusrbrown--github]] — Marcus's personal `.github` repo; GitHub defaults, community health files, and canonical Probot Settings template (`common-settings.yaml`); Prettier-only CI, `bfra-me/.github` reusable workflows pinned at v4.16.20, Renovate preset on v4.5.9 (v4 holdout), no Fro Bot workflow yet
- [[marcusrbrown--containers]] — Container collection and automation framework (Dockerfiles, multi-arch builds, Python CLI, AI-powered templates, CI/CD)
- [[marcusrbrown--copiloting]] — Polyglot AI/LLM experimentation monorepo (Python + TypeScript); LangChain tutorials, Flask + SvelteKit PDF chat app, Fro Bot agent workflows
- [[marcusrbrown--esphome-life]] — ESPHome firmware definitions for Olimex ESP32-PoE-ISO Bluetooth Proxies feeding [[marcusrbrown--ha-config]]; CI builds via `esphome/build-action@v7.2.0` + GitHub Pages deploy with ESP Web Tools; Renovate preset crossed v4 → v5 (`#5.2.0`), `bfra-me/.github` at v4.16.20; still no Fro Bot agent workflow; ESPHome 2025.12.7 pinned for 2+ months
- [[marcusrbrown--extend-vscode]] — VS Code extension toolkit (TypeScript, dual Node/Web targets, tsup, Vitest, semantic-release publishing)
- [[marcusrbrown--gpt]] — Local-first GPT creation platform (React 19, TypeScript 5.9, Vite 7, LangChain, MCP, IndexedDB, Web Crypto; deployed to gpt.mrbro.dev)
- [[marcusrbrown--ha-config]] — Marcus's Home Assistant configuration (public, CI-validated, package-based HA setup with custom components and ESPHome)
- [[marcusrbrown--infra]] — Bun workspace monorepo for personal infrastructure (KeeWeb deploy, CLIProxyAPI proxy, operational CLI with MCP bridge)
- [[marcusrbrown--marcusrbrown]] — GitHub profile README with TypeScript-powered automation (badge generation, sponsor tracking, A/B testing, scheduled updates)
- [[marcusrbrown--marcusrbrown-github-io]] — Personal brand site (React 19, TypeScript 6, Vite 7, GitHub Pages at marcusrbrown.com, single-page with anchor-link sections; Fro Bot single-file three-mode workflow at agent v0.44.0, v0.44.1 in flight)
- [[marcusrbrown--mrbro-dev]] — Marcus's developer portfolio (React 19, TypeScript, Vite 7, GitHub Pages at mrbro.dev, advanced theme system, Fro Bot agent + autoheal)
- [[marcusrbrown--opencode-copilot-delegate]] — OpenCode plugin: delegate tasks to GitHub Copilot CLI as background subprocesses; v0.12.0 with 4 tools (delegate/output/cancel/resume), opt-in `/copilot-status` TUI half, orphan-subprocess reaper with PID-file identity gate, per-process plugin singleton, localhost RPC layer
- [[marcusrbrown--renovate-config]] — Shareable Renovate configuration presets: canonical dependency-update policy for all `marcusrbrown/*` and `fro-bot/*` repos; v5.2.0 (v4→v5 boundary crossed 2026-05-13 with `group:allNonMajor` + 0.x ungrouping safety valve), Fro Bot v0.44.3 with autoheal merged into `fro-bot.yaml` and a new Sundays-only Upstream Modernization Watch category
- [[marcusrbrown--sparkle]] — TypeScript playground monorepo; cross-platform design system (React + React Native/Expo), component library (Radix + Tailwind), Astro Starlight docs, Turborepo, WASM web shell
- [[marcusrbrown--systematic]] — OpenCode plugin: structured engineering workflows (45 skills, 50 agents), npm `@fro.bot/systematic`, Bun + Biome + semantic-release
- [[marcusrbrown--tokentoilet]] — Web3 DeFi token disposal app (Next.js 16, React 19, TypeScript 6, Wagmi v2, Reown AppKit, Tailwind CSS v4, Vercel)
- [[marcusrbrown--vbs]] — Star Trek chronological viewing guide (TypeScript, Vite, D3.js, functional factories, GitHub Pages, Fro Bot active)

## Topics

- [[docker-containers]] — Docker container patterns: base image pinning, OCI labels, multi-arch builds, security scanning
- [[dotfiles]] — Dotfiles Management
- [[github-actions-ci]] — Cross-cutting GitHub Actions CI/CD patterns across the Fro Bot-managed ecosystem
- [[github-pages]] — Static site hosting via GitHub; deployment patterns and performance monitoring
- [[home-assistant]] — Open-source home automation platform; configuration patterns, CI validation, and ecosystem notes
- [[langchain]] — LLM application framework (Python + TypeScript); version notes and migration patterns
- [[opencode-plugins]] — OpenCode plugin development patterns: Plugin API, async notifications, tool registration, Bun build, skill integration
- [[polyglot-monorepo]] — Patterns for managing Python + TypeScript monorepos with independent toolchains
- [[probot-settings]] — Repository configuration management via Probot Settings; inheritance patterns, common-settings templates, and governance across repos
- [[vscode-extensions]] — VS Code extension development patterns, dual-target builds, and publishing tooling
- [[web3-defi]] — Web3 & DeFi Development

## Entities

- [[esphome]] — ESPHome
- [[mise]] — mise

## Comparisons

_No comparison pages yet. Pages will appear here as alternatives are analyzed._

---

_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._
