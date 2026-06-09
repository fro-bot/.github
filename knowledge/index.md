# Wiki Index

Master catalog of all wiki pages, organized by type.

## Repos

- [[bfra-me--github]] — Org control center for `@bfra-me`; pnpm/TypeScript monorepo with 3 custom actions (`renovate-changesets`, `update-metadata`, `update-repository-settings`), 17 workflows, org-wide Fro Bot autoheal (weekdays), canonical `bfra-me/.github:common-settings.yaml`, Fro Bot agent v0.44.2
- [[bfra-me--ha-addon-repository]] — Template repository for a Home Assistant add-on repository (bfra-me org); multi-arch Docker builds via `home-assistant/builder`, GHCR publishing with cosign, Fro Bot agent v0.43.1 with add-on-aware review/autoheal (Renovate PR #557 queuing v0.46.1; HEAD unchanged on `main` for 14 days as of 2026-05-30)
- [[bfra-me--renovate-action]] — bfra-me/renovate-action
- [[bfra-me--works]] — `@bfra-me` tooling monorepo (pnpm 10.34.1, TS 6, ESM); 9 published packages (`eslint-config`, `prettier-config`, `tsconfig`, `es`, `create`, `badge-config`, `doc-sync`, `semantic-release`, `workspace-analyzer`) + Astro Starlight docs; 11 workflows; Fro Bot agent v0.47.0 (jumped v0.44.2 → v0.46.1 → v0.47.0 on 2026-05-30 alongside PR #3491 fixing dispatch/reusable-call mode resolution); `bfra-me/.github` reusable workflows + Renovate baseline at v4.16.21
- [[fro-bot--agent]] — GitHub Action harness for OpenCode + oMo agents with persistent session state; core runtime powering Fro Bot's PR review, issue triage, scheduled maintenance, and wiki-update across all managed repos. v0.53.1: 5-member pnpm workspace (action + `workspace-agent` Hono sandbox + runtime + Discord `gateway` + new published `@fro.bot/harness` patched-OpenCode CLI); harness is now "the default OpenCode for Fro Bot," built via cortexkit/orw LLM-merge integration and OIDC-trust-published via fenced `harness-release.yaml`; OpenCode pinned to 1.15.13 (#742, SSE event-contract fix) driving gateway tool-progress migration (#744); egress regression #741 resolved (#747, configurable allowlist) with follow-on hardening #746/#745; cold-boot supervisor regression #749 fixed (#755)
- [[fro-bot--fro-bot-github-io]] — fro-bot/fro-bot.github.io
- [[fro-bot--systematic]] — Built docs + OCX registry deployment target for `@fro.bot/systematic` at fro.bot/systematic/; `gh-pages`-only repo (no Fro Bot workflow needed); now also hosts the pinned JSON Schema for `systematic.json` user config at `/schemas/v2/`; registry advanced to v2.20.6 with 103 components (51 agents, 47 skills, 2 bundles, 2 profiles, 1 plugin)
- [[marcusrbrown--dotfiles]] — Marcus's primary dotfiles repo: bare-git pattern, XDG-compliant, multi-shell (Bash + Zsh + Sheldon + Starship), mise-managed toolchain (Node 24.16/Python 3.14.5/Rust 1.96/Go 1.26.4/Bun 1.3.14/pnpm 11.5.1), published devcontainer image on GHCR, Fro Bot agent v0.55.1, Renovate preset v5.2.0; OpenCode plugin stack: `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.3` (own fork), `@fro.bot/systematic@2.28.0`, `oh-my-opencode-slim` 4-preset config (active: `mixed` with Opus 4-8 orchestrator), default model `opencode-go/kimi-k2.6`, Discord MCP (disabled)
- [[marcusrbrown--github]] — Marcus's personal `.github` repo; GitHub defaults, community health files, and canonical Probot Settings template (`common-settings.yaml`); Prettier-only CI, `bfra-me/.github` reusable workflows pinned at v4.16.20, Renovate preset on v4.5.9 (v4 holdout), no Fro Bot workflow yet
- [[marcusrbrown--containers]] — Container collection and automation framework (Dockerfiles, multi-arch builds, Python CLI, AI-powered templates with first-class `ai config` CLI scaffold, CI/CD); Fro Bot agent v0.55.0
- [[marcusrbrown--copiloting]] — Polyglot AI/LLM experimentation monorepo (Python + TypeScript); LangChain tutorials, Flask + SvelteKit PDF chat app, Fro Bot agent workflows
- [[marcusrbrown--cortexkit-anthropic-auth]] — Fork of `cortexkit/anthropic-auth`: Claude Pro/Max OAuth, fallback accounts, quota routing, prompt-cache controls, optional Cloudflare Worker relay for both OpenCode and Pi; Bun workspace monorepo, Biome 2.4.15, MIT, published as `@marcusrbrown/{anthropic-auth-core,opencode-anthropic-auth}@1.2.5-mb.3` (Pi package private in fork); default branch `marcusrbrown/main`; Fro Bot active at v0.45.0; bundled upstream-sync/fork-release skill at `.agents/skills/anthropic-auth-upstream-release/`
- [[marcusrbrown--esphome-life]] — marcusrbrown/esphome.life
- [[marcusrbrown--extend-vscode]] — VS Code extension toolkit (TypeScript, dual Node/Web targets, tsup, Vitest, semantic-release to Marketplace+OpenVSIX+npm); Renovate preset crossed v4→v5 (#5.2.0) on 2026-05-14, eslint v10 / jsdom v29 / eslint-plugin-node-dependencies v2 majors landed end of April, `typescript` v6 (#466) remains the sole pending major; **still no Fro Bot agent workflow**
- [[marcusrbrown--gpt]] — Local-first GPT creation platform (React 19, TypeScript 5.9, Vite 8, LangChain 1.4.4, MCP, IndexedDB, Web Crypto; deployed to gpt.mrbro.dev; Fro Bot agent v0.57.0)
- [[marcusrbrown--ha-config]] — Marcus's Home Assistant configuration (public, CI-validated, package-based HA setup with custom components and ESPHome); 11 packages, 10 custom components, `.HA_VERSION` pinned at 2025.6.3 (11-month freeze), Renovate-only autopilot with bfra-me/.github reusable workflows at v4.16.21, still no Fro Bot workflow after four surveys, new `mrbro-bot[bot]` co-author seen on recent merges
- [[marcusrbrown--infra]] — Bun workspace monorepo for personal infrastructure (KeeWeb deploy, CLIProxyAPI proxy, Fro Bot Discord gateway, operational CLI with MCP bridge); 12 workflows, CLI v0.7.0, Fro Bot agent v0.44.3, Renovate preset v5.2.0, TypeScript 6, ESLint 10
- [[marcusrbrown--marcusrbrown]] — GitHub profile README with TypeScript-powered automation (badge generation, sponsor tracking, A/B testing, scheduled updates)
- [[marcusrbrown--marcusrbrown-github-io]] — Personal brand site (React 19, TypeScript 6, Vite 7, GitHub Pages at marcusrbrown.com, single-page with anchor-link sections; Fro Bot single-file three-mode workflow at agent v0.48.1)
- [[marcusrbrown--mrbro-dev]] — Marcus's developer portfolio (React 19, TypeScript 5.9.3, Vite 7, GitHub Pages at mrbro.dev, advanced theme system, single-file three-mode Fro Bot at agent v0.43.0); pnpm overrides migrated to `pnpm-workspace.yaml` (~20 GHSA-annotated entries, driven by a `pnpm audit` CI gate); Fro Bot review/maintenance prompts hardened via cross-repo port from [[marcusrbrown--marcusrbrown]] (skipped-needs trap, workflow-health monitor)
- [[marcusrbrown--opencode-copilot-delegate]] — OpenCode plugin: delegate tasks to GitHub Copilot CLI as background subprocesses; v0.12.0 with 4 tools (delegate/output/cancel/resume), opt-in `/copilot-status` TUI half, orphan-subprocess reaper with PID-file identity gate, per-process plugin singleton, localhost RPC layer
- [[marcusrbrown--renovate-config]] — Shareable Renovate configuration presets: canonical dependency-update policy for all `marcusrbrown/*` and `fro-bot/*` repos; v5.2.0 (v4→v5 boundary crossed 2026-05-13 with `group:allNonMajor` + 0.x ungrouping safety valve); 2026-06-04 survey: preset policy unchanged, Fro Bot agent jumped v0.44.3 → v0.52.1, bfra-me renovate reusable workflow v4.16.23, pnpm 11.5.0; Cross-Project Intelligence focus-list now leads with private repos (names withheld per public-only invariant); legacy maintenance-report issues lingering outside autoheal cleanup matcher
- [[marcusrbrown--sparkle]] — TypeScript playground monorepo; cross-platform design system (React + React Native/Expo), component library (Radix + Tailwind), Astro Starlight docs, Turborepo, WASM web shell; Fro Bot agent v0.54.2 active (autoheal 05:00 + maintenance 17:00 UTC)
- [[marcusrbrown--systematic]] — OpenCode plugin: structured engineering workflows (49 skills, 51 agents) at v2.31.0; Bun + Biome + Zod-typed `systematic.json` config schema + semantic-release; single three-mode `fro-bot.yaml` workflow at agent v0.59.0; all 51 agents have explicit `mode: subagent` and `temperature:` with content-integrity gates; `npx skills` portable install path; `orchestrating-subagents` skill (v2.28.0); `argument-hint` enforcement (v2.31.0)
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
