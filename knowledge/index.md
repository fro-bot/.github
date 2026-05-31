# Wiki Index

Master catalog of all wiki pages, organized by type.

## Repos

- [[bfra-me--github]] — Org control center for `@bfra-me`; pnpm/TypeScript monorepo with 3 custom actions (`renovate-changesets`, `update-metadata`, `update-repository-settings`), 17 workflows, org-wide Fro Bot autoheal (weekdays), canonical `bfra-me/.github:common-settings.yaml`, Fro Bot agent v0.44.2
- [[bfra-me--ha-addon-repository]] — Template repository for a Home Assistant add-on repository (bfra-me org); multi-arch Docker builds via `home-assistant/builder`, GHCR publishing with cosign, Fro Bot agent v0.43.1 with add-on-aware review/autoheal (Renovate PR #557 queuing v0.46.1; HEAD unchanged on `main` for 14 days as of 2026-05-30)
- [[bfra-me--renovate-action]] — bfra-me/renovate-action
- [[bfra-me--works]] — `@bfra-me` tooling monorepo (pnpm 10.34.1, TS 6, ESM); 9 published packages (`eslint-config`, `prettier-config`, `tsconfig`, `es`, `create`, `badge-config`, `doc-sync`, `semantic-release`, `workspace-analyzer`) + Astro Starlight docs; 11 workflows; Fro Bot agent v0.47.0 (jumped v0.44.2 → v0.46.1 → v0.47.0 on 2026-05-30 alongside PR #3491 fixing dispatch/reusable-call mode resolution); `bfra-me/.github` reusable workflows + Renovate baseline at v4.16.21
- [[fro-bot--agent]] — GitHub Action harness for OpenCode + oMo agents with persistent session state; core runtime powering Fro Bot's PR review, issue triage, scheduled maintenance, and wiki-update capabilities across all managed repos
- [[fro-bot--fro-bot-github-io]] — fro-bot/fro-bot.github.io
- [[fro-bot--systematic]] — Built docs + OCX registry deployment target for `@fro.bot/systematic` at fro.bot/systematic/; `gh-pages`-only repo (no Fro Bot workflow needed); now also hosts the pinned JSON Schema for `systematic.json` user config at `/schemas/v2/`; registry advanced to v2.20.6 with 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin)
- [[marcusrbrown--dotfiles]] — Marcus's primary dotfiles repo: bare-git pattern, XDG-compliant, multi-shell (Bash + Zsh + Sheldon + Starship), mise-managed toolchain (Node 24.16/Python 3.14.5/Rust 1.95/Go 1.26.3/Bun 1.3.14/pnpm 11.2), published devcontainer image on GHCR, Fro Bot agent v0.44.3, Renovate preset v5.2.0; OpenCode plugin stack consumes [[marcusrbrown--systematic]] and [[marcusrbrown--opencode-copilot-delegate]]; first repo to declare custom `openai/gpt-5.5` provider models in OpenCode config
- [[marcusrbrown--github]] — Marcus's personal `.github` repo; GitHub defaults, community health files, and canonical Probot Settings template (`common-settings.yaml`); Prettier-only CI, `bfra-me/.github` reusable workflows pinned at v4.16.20, Renovate preset on v4.5.9 (v4 holdout), no Fro Bot workflow yet
- [[marcusrbrown--containers]] — Container collection and automation framework (Dockerfiles, multi-arch builds, Python CLI, AI-powered templates, CI/CD)
- [[marcusrbrown--copiloting]] — Polyglot AI/LLM experimentation monorepo (Python + TypeScript); LangChain tutorials, Flask + SvelteKit PDF chat app, Fro Bot agent workflows
- [[marcusrbrown--cortexkit-anthropic-auth]] — Fork of `cortexkit/anthropic-auth`: Claude Pro/Max OAuth, fallback accounts, quota routing, prompt-cache controls, optional Cloudflare Worker relay for both OpenCode and Pi; Bun workspace monorepo, Biome 2.4.15, MIT, published as `@marcusrbrown/{anthropic-auth-core,opencode-anthropic-auth}@1.2.2-mb.2` (Pi package private in fork); default branch `marcusrbrown/main`; no Fro Bot workflow yet
- [[marcusrbrown--esphome-life]] — marcusrbrown/esphome.life
- [[marcusrbrown--extend-vscode]] — VS Code extension toolkit (TypeScript, dual Node/Web targets, tsup, Vitest, semantic-release to Marketplace+OpenVSIX+npm); Renovate preset crossed v4→v5 (#5.2.0) on 2026-05-14, eslint v10 / jsdom v29 / eslint-plugin-node-dependencies v2 majors landed end of April, `typescript` v6 (#466) remains the sole pending major; **still no Fro Bot agent workflow**
- [[marcusrbrown--gpt]] — Local-first GPT creation platform (React 19, TypeScript 5.9, Vite 7, LangChain, MCP, IndexedDB, Web Crypto; deployed to gpt.mrbro.dev)
- [[marcusrbrown--ha-config]] — Marcus's Home Assistant configuration (public, CI-validated, package-based HA setup with custom components and ESPHome); 11 packages, 10 custom components, `.HA_VERSION` pinned at 2025.6.3 (11-month freeze), Renovate-only autopilot with bfra-me/.github reusable workflows at v4.16.21, still no Fro Bot workflow after four surveys, new `mrbro-bot[bot]` co-author seen on recent merges
- [[marcusrbrown--infra]] — Bun workspace monorepo for personal infrastructure (KeeWeb deploy, CLIProxyAPI proxy, Fro Bot Discord gateway, operational CLI with MCP bridge); 12 workflows, CLI v0.7.0, Fro Bot agent v0.44.3, Renovate preset v5.2.0, TypeScript 6, ESLint 10
- [[marcusrbrown--marcusrbrown]] — GitHub profile README with TypeScript-powered automation (badge generation, sponsor tracking, A/B testing, scheduled updates)
- [[marcusrbrown--marcusrbrown-github-io]] — Personal brand site (React 19, TypeScript 6, Vite 7, GitHub Pages at marcusrbrown.com, single-page with anchor-link sections; Fro Bot single-file three-mode workflow at agent v0.44.0, v0.44.1 in flight)
- [[marcusrbrown--mrbro-dev]] — Marcus's developer portfolio (React 19, TypeScript, Vite 7, GitHub Pages at mrbro.dev, advanced theme system, Fro Bot agent + autoheal)
- [[marcusrbrown--opencode-copilot-delegate]] — OpenCode plugin: delegate tasks to GitHub Copilot CLI as background subprocesses; v0.12.0 with 4 tools (delegate/output/cancel/resume), opt-in `/copilot-status` TUI half, orphan-subprocess reaper with PID-file identity gate, per-process plugin singleton, localhost RPC layer
- [[marcusrbrown--renovate-config]] — Shareable Renovate configuration presets: canonical dependency-update policy for all `marcusrbrown/*` and `fro-bot/*` repos; v5.2.0 (v4→v5 boundary crossed 2026-05-13 with `group:allNonMajor` + 0.x ungrouping safety valve), Fro Bot v0.44.3 with autoheal merged into `fro-bot.yaml` and a new Sundays-only Upstream Modernization Watch category
- [[marcusrbrown--sparkle]] — TypeScript playground monorepo; cross-platform design system (React + React Native/Expo), component library (Radix + Tailwind), Astro Starlight docs, Turborepo, WASM web shell
- [[marcusrbrown--systematic]] — OpenCode plugin: structured engineering workflows (47 skills, 51 agents) at v2.24.0; Bun + Biome + Zod-typed `systematic.json` config schema + semantic-release; `fro-bot.yaml` and `fro-bot-autoheal.yaml` consolidated into a single three-mode workflow (#446), agent v0.45.0; new `release-notes-narrative` skill drives automated narrative releases via `@semantic-release/exec`
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
