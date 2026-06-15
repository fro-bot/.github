---
type: repo
title: "marcusrbrown/tokentoilet"
created: 2026-04-18
updated: 2026-06-09
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
tags: [next-js, react, web3, defi, wagmi, reown-appkit, tailwindcss, vitest, storybook, vercel, typescript, sepolia]
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
- **Last push:** 2026-06-09
- **Homepage:** https://v0-token-toilet-mrbro-dev.vercel.app
- **Topics:** `next-js`, `react`
- **License:** None specified
- **Visibility:** Public
- **Package manager:** pnpm 11.5.2 (was 11.3.0 as of 2026-05-28; bumped in non-major batch)
- **Open issues:** 3 (Dependency Dashboard #995, Daily Autohealing Report #1013, stable since 2026-05-28)
- **Open PRs:** 1 (`@bfra.me/eslint-config` v0.51.1 Renovate PR #1033 — has lint failures, blocked on TypeScript type errors in test files)

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

## Tech Stack

| Layer      | Technology                  | Version                        |
| ---------- | --------------------------- | ------------------------------ |
| Framework  | Next.js (App Router)        | 16.2.7                         |
| UI library | React                       | 19.2.7                         |
| Language   | TypeScript                  | 6.0.3                          |
| Web3       | Wagmi v3 + Reown AppKit     | wagmi ^3.0.0 / appkit ^1.7.18  |
| Styling    | Tailwind CSS v4 (CSS-first) | 4.3.0                          |
| Testing    | Vitest                      | 4.1.8                          |
| Components | Storybook                   | 10.4.2 (mixed with stale 9.0.0-alpha.* addons) |
| Deployment | Vercel (GitHub integration) | —                              |
| State      | TanStack React Query        | ^5.66.0                        |
| Validation | Zod                         | ^4.1.8                         |
| Build      | Vite (dev tooling)          | 8.0.16                         |
| Lint       | ESLint                      | 10.4.1                         |

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

**Fro Bot workflow is present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.59.0` (SHA `feb5365dca6dc56752e1258d1ca66afa7b035e04`, bumped rapidly via Renovate from v0.45.0 through v0.55.x to v0.59.0 between 2026-05-28 and 2026-06-09) with:

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
- **Renovate:** Via reusable workflow, extends `marcusrbrown/renovate-config#5.2.1` (bumped from 5.2.0 between surveys). Post-upgrade tasks run `pnpm install` + `pnpm run fix`. Custom rule: `lucide-react` 0.x minor automerge monthly; v1 pending approval in Dependency Dashboard. Same preset ecosystem as [[marcusrbrown--ha-config]] and [[marcusrbrown--vbs]].
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
| Renovate preset      | `marcusrbrown/renovate-config#5.2.1`   | `#4.5.8`        | `#4.5.8` |
| ESLint config        | `@bfra.me/eslint-config`               | N/A (YAML repo) | Same     |
| Prettier config      | `@bfra.me/prettier-config/120-proof`   | N/A             | Same     |
| Package manager      | pnpm 11.5.2                            | N/A (YAML repo) | pnpm     |
| Fro Bot workflow     | Present (v0.59.0)                      | **Missing**     | Present  |
| Copilot setup steps  | Present                                | Not present     | Present  |
| AGENTS.md            | Present                                | Not present     | Present  |

## Notable Observations

- **MVP shipped:** The ERC-20 disposal flow (PR #911) is the first functional Web3 feature — burns tokens to a dead address on Sepolia. Smart contracts, NFT receipts, charity integration, token fountain, and multi-chain support remain on the roadmap.
- **Heavy test infrastructure:** Co-located tests for every hook, with wallet-specific test suites (MetaMask, WalletConnect, Coinbase). 1103 tests passing, 12 skipped as of 2026-06-09. Coverage: ~61% statements/lines, ~57% functions. 4 stale TODOs in `hooks/use-wallet.integration.test.ts` (2025-09-29, >240 days old) requesting E2E migration.
- **Storybook alpha:** Using Storybook 10.4.2 / 9.0.0-alpha.* releases — mixed pinning is a known footgun (addons at alpha vs. core at stable). 5 of 15 components missing required test/story files: button, card, input, modal, toast-notifications.
- **TypeScript 6:** Early adopter of TS 6.0.3.
- **No license:** The repo has no license file specified, which is unusual for a public repository.
- **Persistent lint warnings (not errors):** 8 lint warnings on `main`: 4 `@eslint-react/jsx-no-leaked-dollar` false positives (currency `$` display in JSX), 2 ref naming, 2 setState-in-effect. `process.env.NODE_ENV` used in 4 source files directly instead of `env` import — unresolved tension between the mandate and `NODE_ENV` not being in `experimental__runtimeEnv`.
- **Web3 validation false positives:** `scripts/validate-web3-integration.ts` flags 2 issues: multi-chain support config.ts false-positive, and Button missing Web3 variant styles. These have persisted without resolution across multiple daily autohealing runs.
- **Security posture clean:** 0 moderate+ vulnerabilities on `main` as of 2026-06-09. 1 low advisory (elliptic, no patched version). `qs` advisory resolved in a prior cycle.
- **Fro Bot agent rapid churn:** v0.45.0 → v0.59.0 between 2026-05-28 and 2026-06-09 (14 separate Renovate PRs merged). Aggressive Renovate automerge cadence for `fro-bot/agent` is intentional per workflow config.
- **Blocked Renovate PR:** `@bfra.me/eslint-config` v0.51.1 (PR #1033) has been open since 2026-05-16 with lint failures. TypeScript type errors in test files prevent automerge. Assigned to marcusrbrown for manual resolution.
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
