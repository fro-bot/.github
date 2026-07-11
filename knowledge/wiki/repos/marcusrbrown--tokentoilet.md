---
type: repo
title: "marcusrbrown/tokentoilet"
created: 2026-04-18
updated: 2026-07-04
sources:
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 0ed90a61784b5b85dcf925bb1255e794c4f5d6a3
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 97e96c1425a9232e5b783c680cade8505e1c8de1
    accessed: 2026-04-24
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 97e96c1425a9232e5b783c680cade8505e1c8de1
    accessed: 2026-04-25
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 0aa1d9a02f1a8ba5cbd95818fb6157318cf9f20b
    accessed: 2026-05-06
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: db6dbcc2d289d23377d3d80b19d5e4273008a1b2
    accessed: 2026-05-28
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 76d543e213abdc2823c1e0c2a7b0fdcdf7bc9727
    accessed: 2026-06-09
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 3be6b7675bab3d7f207c3ea6e1dc439c541cb0c8
    accessed: 2026-06-20
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: c6e10e0515d83d00fcece101f1b6d6b0549f5a95
    accessed: 2026-07-04
tags: [next-js, react, web3, defi, wagmi, reown-appkit, tailwindcss, vitest, storybook, vercel, typescript, sepolia, alchemy, viem]
aliases: [tokentoilet]
related:
  - marcusrbrown--ha-config
  - marcusrbrown--vbs
---

# marcusrbrown/tokentoilet

A [[web3-defi]] application for disposing of unwanted ERC-20 and ERC-721 tokens, converting "wallet dust" into charitable contributions. Built with Next.js 16, React 19, TypeScript 6, Wagmi v2, and Reown AppKit. Deployed to Vercel.

## Overview

- **Purpose:** Web3 DeFi token disposal and charity donation platform
- **Default branch:** `main`
- **Created:** 2023-07-05
- **Last push:** 2026-07-03
- **Homepage:** https://v0-token-toilet-mrbro-dev.vercel.app
- **Topics:** `next-js`, `react`
- **License:** None specified
- **Visibility:** Public
- **Package manager:** pnpm 11.9.0 (was 11.7.0 as of 2026-06-20 → 11.8.0 → 11.9.0; bumped in non-major batches)
- **Open issues:** 4 (Dependency Dashboard #995, Daily Autohealing Report #1013, #1171 E2E migration for jsdom-limited wallet integration tests — replaces the closed #1142; #1189 docs drift: copilot instructions reference pnpm 11.7.0). Note: #1143 (design-system/Web3 validation gates) has been resolved and closed — see below.
- **Open PRs:** 0 (was 5 on 2026-06-20) — the entire queue cleared. #1033 (`@bfra.me/eslint-config` v0.51.1) landed 2026-06-20 after 35+ days blocked; both fro-bot security override PRs (#1156, #1144) and the lint-cleanup PR merged; Renovate is keeping pace with an empty backlog.

## Core Concept

Users send unwanted tokens (dust, defunct DAO governance tokens, worthless airdrops, abandoned NFTs) to Token Toilet. The application provides:

- Token disposal with on-chain proof (NFT receipts)
- Random token fountain (receive random tokens for charitable contributions)
- Automatic charity donation routing
- Multi-chain support planned: Ethereum, Polygon, Arbitrum

### MVP Status (as of 2026-04-17)

The MVP ERC-20 disposal flow landed in PR #911. The application now has a functional disposal path on Sepolia testnet:

- **Sepolia only for v1.0** — `SUPPORTED_CHAIN_IDS` locked to `[11155111]`; mainnet chains deferred
- **Burn address mechanism** — tokens are sent to a burn address (no smart contract yet); custom `TokenToilet.sol` / `CharitySprinkler.sol` / `ProofOfDisposal.sol` contracts remain on the roadmap
- **`/flush` route** — new page with multi-step `DisposalFlow` component
- **`NetworkGuard` component** — validates the user is on Sepolia before allowing disposal
- **`NetworkSwitcher` / `NetworkBadge`** — UI for switching to and displaying the required network
- **`useTokenDisposal` hook** — orchestrates ERC-20 burn transfers
- **Keyed `DisposalExecutor`** — each token gets a fresh hook instance to prevent stale state across multi-token disposals
- **`NEXT_PUBLIC_SEPOLIA_RPC_URL`** — new env var replacing hardcoded Alchemy demo key
- **Vercel deployment refactored** — redundant CI deploy jobs removed; Vercel GitHub integration handles preview (PRs) and production (main push) deploys; `framework: nextjs` added to `vercel.json`
- **Docs:** `docs/brainstorms/2026-04-16-mvp-rebaseline-requirements.md` and `docs/plans/2026-04-16-001-feat-mvp-disposal-flow-plan.md` (marked completed)

Still not implemented: smart contracts, NFT receipts, charity integration, token fountain, multi-chain support.

### Post-MVP Feature Work (as of 2026-07-03)

The 2026-06-20 → 2026-07-03 cycle broke the long dependency-churn-only streak with real application code — the first substantive feature work since the MVP disposal flow. This is the disposal path maturing from scaffold to functional:

- **Real token discovery via Alchemy** (PR #1179) — `use-token-discovery` now enumerates a connected wallet's actual ERC-20 holdings through `alchemy_getTokenBalances`, replacing any hardcoded/mock token list. Discovery is **fail-closed**: without `NEXT_PUBLIC_ALCHEMY_API_KEY` the app shows a "discovery unavailable" state rather than falling back to a static list. The Alchemy key is browser-exposed, so `.env.example` documents domain-allowlisting as the abuse control.
- **Transfer simulation before signature** (PR #1175) — disposal now simulates the transfer before prompting the user to sign, catching reverts before they cost a signature/gas. A concrete win from the Web3-security review rubric ("simulate before prompting signature").
- **Discovery error hardening** — three follow-up fixes: skip unmapped chains instead of aborting the whole scan (#1180), treat a rejected Alchemy key as *unavailable* rather than a retryable transient error (#1183), and surface structured discovery error messages in the UI instead of swallowing them (#1184). A `docs/solutions` learning was captured on provider error-shape (#1186) and consumer-verification (#1181).
- **Mainnet readiness spike — NO-GO** (#1178): an explicit spike concluded mainnet is deferred until discovery is proven correct. The Sepolia-only lock (`SUPPORTED_CHAIN_IDS: [11155111]`) stands. Stale multi-chain RPC env vars were dropped and the Sepolia override documented (#1176); invalid multi-chain integration tests were removed with E2E gaps tracked in #1171 (#1172).
- **Privacy: analytics telemetry defaults to opt-in / off** (PR #1174) — analytics is now off unless explicitly enabled. This aligns the app with Marcus's baseline no-unconsented-telemetry constraint; worth noting the default was flipped deliberately rather than shipping opt-out.
- **`viem` promoted to a direct devDependency** (2.54.1) — previously transitive under wagmi. Its appearance as a first-class dep tracks the token-enumeration/simulation work that reaches for viem primitives directly.

Still not implemented after this cycle: smart contracts, NFT receipts, charity routing, token fountain, mainnet/multi-chain. The roadmap items are unchanged — but the disposal path is now reading real chain state instead of stubs.

## Tech Stack

| Layer      | Technology                  | Version                        |
| ---------- | --------------------------- | ------------------------------ |
| Framework  | Next.js (App Router)        | 16.2.9                         |
| UI library | React                       | 19.2.7                         |
| Language   | TypeScript                  | 6.0.3                          |
| Web3       | Wagmi v3 + Reown AppKit     | wagmi ^3.0.0 / appkit ^1.7.18  |
| Styling    | Tailwind CSS v4 (CSS-first) | 4.3.1                          |
| Testing    | Vitest                      | 4.1.9                          |
| Components | Storybook                   | 10.4.6 (mixed with stale 9.0.0-alpha.* addons) |
| Deployment | Vercel (GitHub integration) | —                              |
| State      | TanStack React Query        | ^5.66.0                        |
| Validation | Zod                         | ^4.1.8                         |
| Chain RPC  | viem (now direct devDep)    | 2.54.1                         |
| Discovery  | Alchemy (`alchemy_getTokenBalances`) | via `NEXT_PUBLIC_ALCHEMY_API_KEY` |
| Build      | Vite (dev tooling)          | 8.1.2                          |
| Lint       | ESLint                      | 10.6.0                         |

## Repository Structure

### Key Directories

| Directory     | Purpose                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js App Router pages (layout, page, providers, globals.css, flush route)                       |
| `components/` | React components — `ui/` (design system), `web3/` (wallet/token components), theme, error boundary |
| `hooks/`      | Custom React hooks — wallet management, token operations, transaction queue                        |
| `lib/`        | Shared utilities and library code                                                                  |
| `config/`     | Build env, stubs, Web3 config                                                                      |
| `tests/`      | Test infrastructure                                                                                |
| `docs/`       | Development guides, design system docs, architecture                                               |
| `scripts/`    | Validation scripts (design system, Web3 integration)                                               |
| `.storybook/` | Storybook configuration                                                                            |
| `RFCs/`       | Request for Comments documents                                                                     |
| `public/`     | Static assets                                                                                      |
| `.ai/`        | AI-specific configuration                                                                          |

### Custom Hooks

The `hooks/` directory is extensive, with co-located tests for each hook:

- `use-wallet.ts` — Core wallet abstraction (wraps wagmi/AppKit). Components must use this, not direct wagmi hooks.
- `use-token-approval.ts` — ERC-20 token approval flows
- `use-token-balance.ts` — Token balance queries
- `use-token-discovery.ts` — Token discovery/listing
- `use-token-disposal.ts` — Token disposal operations
- `use-token-filtering.ts` — Token list filtering logic
- `use-token-metadata.ts` — Token metadata resolution
- `use-token-price.ts` — Token price feeds
- `use-transaction-queue.ts` — Transaction batching/sequencing
- `use-wallet-error-handler.ts` — Wallet error classification and handling
- `use-wallet-persistence.ts` — Wallet connection persistence
- `use-wallet-switcher.ts` — Multi-wallet switching

Wallet-specific test suites exist for MetaMask, WalletConnect, and Coinbase Wallet, plus integration and error classification tests.

### Design System

A violet-branded glass morphism design system with 14+ components in `components/ui/`:

- CSS-first Tailwind v4 — no `tailwind.config.ts`, no `@apply`
- Design tokens via CSS custom properties in `@theme` blocks
- Violet color palette (`violet-50` through `violet-900`) with semantic Web3 state tokens
- Glass morphism patterns (`bg-white/80 backdrop-blur-md`)
- WCAG 2.1 AA accessible
- Dark mode via `next-themes`
- Storybook for interactive component exploration

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI/CD Pipeline | `ci.yaml` | PR, push to `main`, dispatch | Lint, test, build, Storybook build, security audit |
| Fro Bot | `fro-bot.yaml` | PR, issues, comments, schedule (03:30 UTC), dispatch | AI agent for PR review, autohealing, triage |
| Renovate | `renovate.yaml` | Issue edit, PR events, push, CI completion, dispatch | Dependency management |
| Update Repo Settings | `update-repo-settings.yaml` | Push to `main`, daily cron (21:12 UTC), dispatch | Probot settings sync via `bfra-me/.github` |

### CI Jobs (ci.yaml)

Four jobs, with build depending on lint + test:

1. **Lint** — TypeScript type check (`tsc --noEmit`) + ESLint
2. **Test** — Vitest (coverage on push to `main`, basic run on PRs)
3. **Build** — Next.js production build (depends on lint + test)
4. **Build Storybook** — Storybook static build (depends on lint)
5. **Security Audit** — `actions/dependency-review-action` (PR only)

Environment: `SKIP_ENV_VALIDATION=true` for CI builds.

### Deployment

Vercel handles deployment via its GitHub integration:

- PRs receive preview deployments
- Pushes to `main` trigger production deployment
- `vercel.json` configures security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy) and a `/health` rewrite to `/api/health`
- Deployment branches: `main`, `staging`

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.82.0` (SHA `77d6a464487f7654a1f37d40abf9cd12c1b23762`, bumped rapidly via Renovate from v0.71.0 to v0.82.0 across ~15 releases between 2026-06-20 and 2026-07-03) with:

- **PR Review:** Structured review with Web3 security focus, mandatory verdict (PASS/CONDITIONAL/REJECT), specific review sections for blocking issues, Web3 security assessment, missing tests, risk assessment.
- **Daily Autohealing (schedule):** Five-category sweep — errored PRs, security, code quality/hygiene, developer experience, quality gates. Produces a single summary issue per run. Respects Renovate ownership of dependency bumps.
- **Dispatch:** Custom prompt support.
- **Concurrency:** Per-issue/PR, non-canceling.
- **Auth:** `FRO_BOT_PAT` for GitHub, `OPENCODE_AUTH_JSON` + `OPENCODE_CONFIG` + `OMO_PROVIDERS` for agent runtime.
- **Checkout:** Full history (`fetch-depth: 0`), with PR head ref resolution for comment-triggered runs.
- **Setup:** Uses `.github/actions/setup` (local composite action).

The Fro Bot workflow conditionals filter out: fork PRs, bot-authored PRs/issues, and non-collaborator comment triggers.

## Developer Tooling

- **AGENTS.md:** Concise AI coding agent instructions — commands, code style, key patterns, references.
- **`llms.txt`:** Full documentation links for LLM context.
- **`.cursorrules`:** AI development guidelines (referenced from AGENTS.md).
- **Copilot Setup Steps:** `copilot-setup-steps.yml` workflow present for GitHub Copilot coding agent.
- **simple-git-hooks + lint-staged:** Pre-commit runs ESLint --fix on staged files.
- **Prettier:** `@bfra.me/prettier-config/120-proof` (120 char line width).
- **ESLint:** `@bfra.me/eslint-config` with React, Next.js, and Prettier plugins.
- **Bundle analysis:** `@next/bundle-analyzer` available via `NEXT_BUILD_ENV_ANALYZE=true`.
- **Environment:** `@t3-oss/env-nextjs` + Zod for typed environment validation. Access via `import {env} from '@/env'`, never `process.env`.
- **Renovate:** Via reusable workflow, extends `marcusrbrown/renovate-config#5.2.4` (bumped 5.2.3 → 5.2.4 between surveys; tracks the [[marcusrbrown--renovate-config]] release line). Post-upgrade tasks run `pnpm install` + `pnpm run fix`. Custom rule: `lucide-react` 0.x minor automerge monthly; v1 pending approval in Dependency Dashboard. Same preset ecosystem as [[marcusrbrown--ha-config]] and [[marcusrbrown--vbs]].
- **Abandoned dependencies flagged by Renovate:** `@testing-library/user-event` (last updated 2025-01-21), `class-variance-authority` (2024-11-26), `clsx` (2024-04-23), `consola` (2025-03-18), `crypto-js` (2023-10-24), `vitest-axe` (2025-01-22). These are in the Dependency Dashboard #995 but no replacements have been actioned.
- **Deprecated packages:** `@metamask/sdk` and `@metamask/sdk-communication-layer` flagged as deprecated with no available replacement PRs.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml` via `bfra-me/.github` reusable workflow. Branch protection requires: Build, Build Storybook, Lint, Renovate, Security Audit, Test. Linear history enforced, admin enforcement enabled, no required PR reviews.

## Architecture Patterns

- **Web3 hook abstraction:** All wallet/chain interaction is mediated through custom hooks in `hooks/`. Components never import wagmi or AppKit directly — they use `useWallet` and the token-specific hooks.
- **`'use client'` boundary:** Web3 components require the React Server Components client directive.
- **Import alias:** `@/*` path alias enforced project-wide.
- **Error handling:** Web3 operations wrapped in try/catch with `console.error`. Connect/disconnect operations never throw.
- **Functional state updates:** `setX(prev => ...)` pattern enforced in useEffect to avoid stale closures.
- **CSP configuration:** Content Security Policy in `next.config.ts` whitelists WalletConnect, Reown, Alchemy, Infura, and CoinGecko endpoints.
- **Webpack/Turbopack aliases:** Stubs for `pino`, `thread-stream`, `sonic-boom` (server-only deps from MetaMask SDK); `@react-native-async-storage/async-storage` aliased to `false`.

## Security Configuration

- **CSP headers:** Defined in both `next.config.ts` and `vercel.json`
- **Security headers:** X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy
- **Remote image patterns:** Whitelisted domains for token images (CoinGecko, GitHub raw, IPFS gateways)
- **Dependency review:** `actions/dependency-review-action` on PRs (fail on moderate+)
- **Web3-specific:** No private keys in source, RPC endpoints via env vars, address validation, checksummed addresses
- **Permissions-Policy:** Camera, microphone, geolocation all denied

## Validation Scripts

- `scripts/validate-design-system.ts` — Verifies design system completeness
- `scripts/validate-web3-integration.ts` — Verifies Web3 integration patterns

## Shared Ecosystem Patterns

This repo participates in the same developer tooling ecosystem as [[marcusrbrown--ha-config]] and [[marcusrbrown--vbs]]:

| Pattern              | tokentoilet                            | ha-config       | vbs      |
| -------------------- | -------------------------------------- | --------------- | -------- |
| Probot settings base | `fro-bot/.github:common-settings.yaml` | Same            | Same     |
| Renovate preset      | `marcusrbrown/renovate-config#5.2.4`   | `#4.5.8`        | `#4.5.8` |
| ESLint config        | `@bfra.me/eslint-config`               | N/A (YAML repo) | Same     |
| Prettier config      | `@bfra.me/prettier-config/120-proof`   | N/A             | Same     |
| Package manager      | pnpm 11.9.0                            | N/A (YAML repo) | pnpm     |
| Fro Bot workflow     | Present (v0.82.0)                      | **Missing**     | Present  |
| Copilot setup steps  | Present                                | Not present     | Present  |
| AGENTS.md            | Present                                | Not present     | Present  |

## Notable Observations

- **MVP shipped:** The ERC-20 disposal flow (PR #911) is the first functional Web3 feature — burns tokens to a dead address on Sepolia. Smart contracts, NFT receipts, charity integration, token fountain, and multi-chain support remain on the roadmap.
- **Heavy test infrastructure:** Co-located tests for every hook, with wallet-specific test suites (MetaMask, WalletConnect, Coinbase). 1103 tests passing, 12 skipped as of 2026-06-09. Coverage: ~61% statements/lines, ~57% functions. 4 stale TODOs in `hooks/use-wallet.integration.test.ts` (2025-09-29, >240 days old) requesting E2E migration.
- **Storybook alpha:** Using Storybook 10.4.6 / 9.0.0-alpha.* releases — mixed pinning is a known footgun (addons at alpha vs. core at stable). **Update (2026-07-03):** the 5-of-15 missing component test/story files were completed in #1168 (design-system coverage closed, #1143 resolved); the alpha-vs-stable addon split itself persists.
- **TypeScript 6:** Early adopter of TS 6.0.3.
- **No license:** The repo has no license file specified, which is unusual for a public repository.
- **Persistent lint warnings (not errors):** 8 lint warnings on `main`: 4 `@eslint-react/jsx-no-leaked-dollar` false positives (currency `$` display in JSX), 2 ref naming, 2 setState-in-effect. `process.env.NODE_ENV` used in 4 source files directly instead of `env` import — unresolved tension between the mandate and `NODE_ENV` not being in `experimental__runtimeEnv`.
- **Web3 validation false positives:** `scripts/validate-web3-integration.ts` flagged 2 issues: multi-chain support config.ts false-positive, and Button missing Web3 variant styles. These persisted without resolution across multiple daily autohealing runs — **resolved 2026-07-03 in #1168**, which realigned the validator to actual MVP scope (Sepolia-only) rather than the deferred multi-chain vision.
- **Security posture clean:** 0 moderate+ vulnerabilities on `main` as of 2026-06-09. 1 low advisory (elliptic, no patched version). `qs` advisory resolved in a prior cycle. The two fro-bot security override PRs opened 2026-06-20 (#1156 undici/ws/form-data/js-yaml, #1144 esbuild) both merged this cycle.
- **Fro Bot agent rapid churn:** v0.45.0 → v0.59.0 between 2026-05-28 and 2026-06-09 (14 separate Renovate PRs merged). Aggressive Renovate automerge cadence for `fro-bot/agent` is intentional per workflow config.
- **Blocked Renovate PR (resolved):** `@bfra.me/eslint-config` v0.51.1 (PR #1033) was open since 2026-05-16 with lint failures from TypeScript type errors in test files. **Landed 2026-06-20** after 35+ days — the longest-blocked item in survey history finally cleared. The pinned `@bfra.me/eslint-config` is now `0.51.1`.
- **Deprecated MetaMask SDK:** `@metamask/sdk` and `@metamask/sdk-communication-layer` flagged deprecated with no replacement. The `useWallet` abstraction layer may buffer downstream impact, but the upstream abandonment is a risk to watch.
- **Abandoned deps accumulating:** 6 packages flagged as abandoned in Dependency Dashboard. `crypto-js` (last updated 2023) is the highest-risk given its role in cryptographic operations.

## Survey History

| Date       | SHA       | Delta |
| ---------- | --------- | ----- |
| 2026-04-18 | `0ed90a6` | Initial survey — frontend scaffolding, no functional disposal flow |
| 2026-04-18 | `0ed90a6` | Follow-up — added cross-references, Renovate/branch-protection details |
| 2026-04-24 | `97e96c1` | MVP disposal flow shipped (PR #911), Fro Bot v0.41.4, Next.js 16.2.4, TS 6.0.3 |
| 2026-04-25 | `97e96c1` | No code changes — SHA unchanged, open issues 25→26, lockfile maintenance PR #929 opened |
| 2026-05-06 | `0aa1d9a` | Dependency bumps only: Fro Bot v0.41.4→v0.42.6, pnpm 10.33.0→10.33.2, tailwindcss 4.2.2→4.2.4, postcss→8.5.12. Open issues 26→30. Copilot agent branches observed. |
| 2026-05-28 | `db6dbcc` | **Three majors crossed**: wagmi v2→v3, pnpm v10→v11 (11.3.0), Renovate preset v4→v5 (#5.2.0). Fro Bot v0.42.6→v0.45.0. Next.js 16.2.4→16.2.6, React 19.2.5→19.2.6, tailwindcss 4.2.4→4.3.0, postcss→8.5.15 (qs advisory patched, stale `pnpm.overrides` removed in #1064), vitest 4.0.7→4.1.7, vite→8.0.14, eslint→10.4.0. Fro Bot prompt updated (PR #1067) to port silent-outage workflow-health heuristics from marcusrbrown/marcusrbrown. Open issues 30→3, open PRs 6→1 — triage sweep. |
| 2026-06-09 | `76d543e` | **Dependency velocity sprint**: 20 commits since 2026-06-04, all Renovate non-major bumps + Fro Bot agent releases. Fro Bot v0.45.0→v0.59.0 (14 releases merged). pnpm 11.3.0→11.5.2. Next.js 16.2.6→16.2.7. React 19.2.6→19.2.7 (react monorepo). vite→8.0.16, vitest→4.1.8, eslint→10.4.1, Storybook→10.4.2. Renovate preset bumped to #5.2.1. bfra-me/.github reusable workflow→v4.16.24. Only 1 PR open (PR #1033, blocked). Perpetual autohealing issue #1013 active, design system / Web3 validation failures stable for 12+ days. |
| 2026-06-20 | `3be6b76` | **Continued Renovate/Fro Bot churn, no structural change**: ~40 commits since 2026-06-09, all dependency bumps. Fro Bot v0.59.0→v0.71.0 (~20 releases merged). pnpm 11.5.2→11.7.0. Next.js 16.2.7→16.2.9. Storybook→10.4.6, vitest→4.1.9, eslint→10.5.0, tailwindcss→4.3.1, prettier→3.8.4. Renovate preset #5.2.1→#5.2.3, bfra-me/.github→v4.16.27. Open PRs 1→5: two new fro-bot security overrides (#1156 undici/ws/form-data/js-yaml, #1144 esbuild) + lint cleanup #1157 + Renovate #1153; #1033 still blocked (35+ days). Autoheal extracted its two stable human-decision blockers into standalone issues #1142 (stale wallet-test TODOs) and #1143 (design-system/Web3 validation gates). New root docs: `CHANGELOG.md`, `CONTRIBUTING.md`, `mvp.md`, `.env.example`. |
| 2026-07-03 | `c6e10e0` | **Feature work resumes — disposal path matures from scaffold to functional**: the churn-only streak broke. Real token discovery via Alchemy `getTokenBalances` (#1179, fail-closed — no static fallback), transfer simulation before signature (#1175), discovery error hardening (#1180/#1183/#1184), analytics telemetry flipped to opt-in/off (#1174, privacy), design-system coverage completed + Web3 validator aligned to MVP (#1168, closes #1143), mainnet readiness spike → NO-GO (#1178). `viem` promoted to direct devDep (2.54.1). Dep churn continued underneath: Fro Bot v0.71.0→v0.82.0 (~15 releases), pnpm 11.7.0→11.9.0, Renovate preset #5.2.3→#5.2.4, prettier→3.9.4, vite→8.1.2, eslint→10.6.0, tailwindcss→4.3.2, bfra-me/.github→v4.16.33. Open PRs 5→0 (queue fully cleared; #1033 landed). Open issues: #1142 closed, #1143 resolved; new #1171 (E2E migration) and #1189 (docs drift). |

## Notable Deltas (2026-07-03)

- **Disposal path reads real chain state now.** The headline delta: token discovery enumerates a connected wallet's actual ERC-20 holdings via Alchemy (`alchemy_getTokenBalances`, #1179) instead of any mock/hardcoded list. The design is deliberately fail-closed — no `NEXT_PUBLIC_ALCHEMY_API_KEY` means a "discovery unavailable" state, never a silent static fallback. Since the key is browser-exposed, the abuse control is a domain allowlist configured in the Alchemy dashboard (documented in `.env.example`). This is the first cycle since the MVP that shipped substantive application code, not just dependency bumps.
- **Simulate before you sign.** Disposal now simulates the transfer before prompting for a signature (#1175), catching reverts before they burn a signature or gas. This is the Web3-security rubric enforcing itself in code — the same "simulate before prompting signature" line the Fro Bot PR-review prompt has been asserting.
- **Discovery error handling hardened three ways.** Skip unmapped chains instead of aborting the entire scan (#1180); treat a rejected Alchemy key as *unavailable* rather than a retryable transient (#1183, avoids a hot-loop retry against a permanently-bad key); surface structured discovery errors in the UI rather than swallowing them (#1184). Two `docs/solutions` learnings captured (provider error-shape #1186, consumer-verification #1181) — the autohealing knowledge-compounding loop working as intended.
- **Mainnet: explicit NO-GO.** A readiness spike (#1178) concluded mainnet stays deferred until discovery is proven correct. Stale multi-chain RPC env vars were dropped and the Sepolia override documented (#1176); invalid multi-chain integration tests removed with gaps tracked in #1171 (#1172). The Sepolia-only lock is now a documented decision, not just an unfinished feature.
- **Privacy default flipped the right way.** Analytics telemetry now defaults to opt-in / off (#1174). The default was deliberately set to off rather than shipping opt-out telemetry — consistent with the no-unconsented-telemetry baseline. Worth flagging as a principled default choice, not an accident.
- **Both long-standing autoheal blockers resolved.** #1143 (design-system: 5 missing component test/story files + Web3 validator false positives) is closed — #1168 completed design-system coverage and realigned the Web3 validator to actual MVP scope, ending the 12+-week recurring-failure streak documented in prior surveys. #1142 (stale wallet-test TODOs) was also closed; the underlying E2E-migration need now lives in #1171. The two validation false positives that "persisted without resolution across multiple daily autohealing runs" are finally gone.
- **PR queue fully cleared.** From 5 open PRs on 2026-06-20 to 0. The 35+-day-blocked `@bfra.me/eslint-config` v0.51.1 PR (#1033) landed 2026-06-20; both fro-bot security override PRs and the lint-cleanup PR merged. Renovate's backlog is empty — the highest-velocity repo in the portfolio is currently caught up.
- **Storybook alpha pin persists (unchanged footgun).** Core Storybook at 10.4.6, but `addon-essentials` (9.0.0-alpha.12), `addon-interactions` (9.0.0-alpha.10), `blocks` (9.0.0-alpha.17), and `test` (9.0.0-alpha.2) still lag on the 9.0 alpha line. Another full cycle, same mixed-pin footgun — this one is calcifying into a permanent fixture rather than a transient drift.
- **Docs-drift issue is a new hygiene signal.** #1189 flags that copilot instructions still reference pnpm 11.7.0 while the repo is on 11.9.0. Minor, but it's the autoheal loop catching its own stale internal docs — the kind of small daemon that keeps the chrome honest.

## Notable Deltas (2026-06-20)

- **Fro Bot agent v0.59.0 → v0.71.0:** ~20 Renovate-merged bumps in ~10 days, continuing the highest churn rate in the portfolio. The automerge config for `fro-bot/agent` remains aggressive and non-blocking by design. No workflow logic change — the agent pin (`9b89fb3`) is the only `fro-bot.yaml` delta; schedule still 03:30 UTC, workflow-health heuristics still present.
- **Security autoheal is now generating its own PRs:** Two fro-bot-authored security override PRs are open — #1156 (pnpm overrides for transitive `undici`, `ws`, `form-data`, `js-yaml` advisories) and #1144 (esbuild GHSA-gv7w-rqvm-qjhr → 0.28.1). Both report `pnpm audit` reduced to low-only and clean CI. This is the security category of the autoheal prompt acting on Dependabot alerts without duplicating Renovate's dependency ownership. Watch for whether they automerge or wait on human review.
- **Autoheal report decomposition:** The rolling Daily Autohealing Report (#1013) no longer carries the two long-lived human-decision blockers inline. They were extracted into dedicated tracking issues — #1142 (4 stale TODOs in `hooks/use-wallet.integration.test.ts`, all >90 days, requesting E2E migration) and #1143 (design-system validator: 5 missing component test/story files; Web3 validator false positives). Same unresolved problems documented in prior surveys, now with stable issue homes instead of recurring report noise.
- **Storybook alpha pin persists:** Core Storybook at 10.4.6, but `addon-essentials`/`addon-interactions`/`blocks`/`test` remain at `9.0.0-alpha.*`. The mixed-pin footgun flagged in earlier surveys is unchanged after another month of bumps — addons compiled against the 9.0 alpha API still lag the 10.x core.
- **#1033 aging past 35 days:** The `@bfra.me/eslint-config` v0.51.1 Renovate PR remains the longest-open item, still red on `Lint` due to test-file type errors. Autoheal explicitly skips it under dependency-ownership policy (non-security, Renovate-owned). Manual resolution still required.
- **New scaffolding docs:** `CHANGELOG.md`, `CONTRIBUTING.md`, `mvp.md`, and `.env.example` now present at root — repo hygiene additions, not feature work. No new application code, hooks, or smart contracts. MVP status (Sepolia burn-address ERC-20 disposal only) is unchanged; contracts, NFT receipts, charity routing, fountain, and multi-chain remain on the roadmap.

## Notable Deltas (2026-06-09)

- **Fro Bot agent sprint: v0.45.0 → v0.59.0:** 14 Renovate-merged bumps in under 12 days. The Renovate automerge config for `fro-bot/agent` is functioning as designed — aggressive, non-blocking. This pace is higher than any other repo in the portfolio and reflects how rapidly the agent harness is iterating.
- **pnpm 11.5.2:** Non-major bump from 11.3.0. No lockfile incompatibility observed.
- **React 19.2.7 + Next.js 16.2.7:** Minor patch increments. Both landed cleanly via Renovate.
- **Renovate preset #5.2.1:** Minor bump from #5.2.0. No behavioral changes expected per prior renovate-config survey.
- **bfra-me/.github v4.16.24:** Reusable Renovate/settings-sync workflow bumped. Renovate and update-repo-settings workflows both updated.
- **PR #1033 aging:** The `@bfra.me/eslint-config` v0.51.1 Renovate PR has now been open for 24+ days with lint failures. The TypeScript type errors in test files are the blocker. Automerge is configured but cannot engage while CI is red. This is the only open PR as of 2026-06-09.
- **Dependency quality risk compounds:** The 6 abandoned packages (led by `crypto-js` last updated 2023) and 2 deprecated MetaMask SDK packages have no active remediation. The `useWallet` abstraction provides some insulation, but `crypto-js` in a Web3 crypto context is a substantive risk.
- **Design system / Web3 validation: stable failures:** The 5 missing component test/story files and 2 Web3 validation issues have now appeared in 12+ consecutive daily autohealing reports without resolution. These are human-decision blockers, not autohealing candidates.

## Notable Deltas (2026-05-28)

- **wagmi v2 → v3:** The `wagmi: "^3.0.0"` major bump landed. This unblocks newer connector APIs but is a non-trivial upgrade — the open PR #837 from prior surveys is now merged or superseded. The `useWallet` abstraction layer is the firewall here: components should be unaffected as long as the hook surface stayed stable.
- **Renovate preset v4 → v5:** Aligns this repo with the `marcusrbrown/renovate-config#5.2.0` cutover documented in [[marcusrbrown--renovate-config]] (group-all-non-major behavior, 0.x ungrouping safety valve).
- **pnpm v10 → v11:** `packageManager` line updated to `pnpm@11.3.0`. No reported lockfile incompatibilities in subsequent commits.
- **Fro Bot prompt port:** PR #1067 ("port Fro Bot prompt improvements from marcusrbrown/marcusrbrown") added workflow-health heuristics — flag any workflow where >50% of expected runs failed in the last 7 days, or where scheduled runs produced zero successful auto-generated commits. Direct lesson from the 1.5-year silent outage caught in [[marcusrbrown--marcusrbrown]] in May 2026.
- **Open-issue triage:** Drop from 30 → 3 open issues across three weeks indicates either an aggressive cleanup pass or autoheal-driven closure. Open PRs collapsed similarly (6 → 1).
- **postcss security:** PR #1064 patched the `qs` advisory and removed stale `pnpm.overrides`. Worth noting the security category of the autoheal prompt is doing its job.
- **Storybook version drift:** A handful of `@storybook/*` packages remain pinned at `9.0.0-alpha.*` while the core monorepo moved to `10.4.1`. Mixed pinning is a known footgun for Storybook — addons compiled against the 9.0 alpha API may not load cleanly under 10.x. Candidate for a focused upgrade PR.
