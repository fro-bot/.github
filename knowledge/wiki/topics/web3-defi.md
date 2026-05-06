---
type: topic
title: "Web3 & DeFi Development"
created: 2026-04-18
updated: 2026-05-06
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
tags: [web3, defi, wagmi, reown-appkit, walletconnect, ethereum, sepolia, erc-20, erc-721, polymarket, prediction-markets, arbitrage]
---

# Web3 & DeFi Development

Patterns, tooling, and conventions for Web3 and decentralized finance (DeFi) applications across the Fro Bot-managed ecosystem.

## Repositories

- [[marcusrbrown--tokentoilet]] — Token disposal and charity donation DeFi app (Next.js + Wagmi + Reown AppKit)
- [[marcusrbrown--poly]] — Polymarket bot (arbitrage + market making); private collab, Obsidian vault + code (early stage, 2026-05-05)

## Wallet Integration Stack

The ecosystem currently standardizes on:

| Component         | Tool                                            | Notes                                    |
| ----------------- | ----------------------------------------------- | ---------------------------------------- |
| React hooks       | Wagmi v2                                        | Core wallet/chain interaction primitives |
| Modal/UI          | Reown AppKit (formerly WalletConnect Web3Modal) | Wallet connection modal and UI           |
| Query layer       | TanStack React Query                            | Async state for chain reads/writes       |
| Supported wallets | MetaMask, WalletConnect, Coinbase Wallet        | Per test suites in tokentoilet           |
| Chains (v1.0 MVP) | Sepolia testnet only                            | `SUPPORTED_CHAIN_IDS: [11155111]`; mainnet chains (Ethereum, Polygon, Arbitrum) deferred |

## Architectural Conventions

These patterns are enforced in [[marcusrbrown--tokentoilet]] via AGENTS.md and Fro Bot PR review prompts:

1. **Hook abstraction layer:** Components never import wagmi or AppKit directly. A `useWallet` hook wraps all wallet state; domain hooks (`useTokenApproval`, `useTokenBalance`, etc.) wrap specific operations.
2. **`'use client'` boundary:** All Web3 components require the RSC client directive since wallet state is inherently client-side.
3. **Error handling:** Web3 operations use try/catch with `console.error`. Connect/disconnect operations must never throw — failures are surfaced via state, not exceptions.
4. **Functional state updates:** `setX(prev => ...)` pattern required in useEffect to prevent stale closure bugs common in async wallet flows.
5. **Address handling:** Checksummed addresses, validated before use.
6. **Token approvals:** Infinite approvals flagged during review; amount validation required.

## Security Patterns

- **CSP:** WalletConnect, Reown, Alchemy, Infura whitelisted in Content-Security-Policy connect-src
- **No secrets in source:** Private keys, mnemonics, RPC API keys must use environment variables, never hardcoded
- **Reentrancy awareness:** Contract interaction patterns reviewed for reentrancy concerns
- **Dependency review:** `actions/dependency-review-action` at moderate+ severity on PRs

## Testing Patterns

- Co-located test files (`*.test.ts(x)`) alongside hook/component source
- Mocked wallet providers (wagmi, AppKit) in test setup
- Wallet-specific test suites per connector (MetaMask, WalletConnect, Coinbase)
- Computed property names for hook mocks to avoid ESLint warnings
- Vitest as test runner with coverage via `@vitest/coverage-v8`

## Environment Configuration

- Typed env validation via `@t3-oss/env-nextjs` + Zod
- Access via `import {env} from '@/env'`, never `process.env`
- `SKIP_ENV_VALIDATION=true` in CI builds
- `NEXT_PUBLIC_SEPOLIA_RPC_URL` for testnet RPC endpoint (replaces hardcoded Alchemy demo key as of MVP)

## Prediction Markets (Polymarket)

A second Web3 sub-domain entered the ecosystem with [[marcusrbrown--poly]] (2026-05-05). Key differences from the tokentoilet DeFi pattern:

- **Protocol:** Polymarket CLOB API (not EVM smart contracts in v1)
- **Strategy:** Algorithmic trading — arbitrage first, market-making second
- **Stack:** Python (planned), sops+age for secrets, Obsidian vault for research — no React/Next.js frontend
- **Wallet topology:** Polymarket Safe (signature type 2, per ADR-0003)
- **Collaboration model:** Two-person dev collab (Marcus + @thejustinwalsh), not solo + Fro Bot

This represents a fundamentally different Web3 surface — server-side trading bots vs. client-side DeFi UIs.

## MVP Architecture (2026-04-17)

The first functional disposal flow (PR #911 in [[marcusrbrown--tokentoilet]]) uses a burn-address mechanism on Sepolia:

- **No smart contracts yet** — tokens are sent to a dead address; custom contracts (`TokenToilet.sol`, `CharitySprinkler.sol`, `ProofOfDisposal.sol`) are roadmap items
- **Multi-step UI:** `DisposalFlow` component orchestrates token selection → network validation → approval → burn transfer
- **`NetworkGuard`** validates the connected wallet is on Sepolia before rendering disposal UI
- **Keyed `DisposalExecutor`** — each token gets a fresh `useTokenDisposal` hook instance via React key, preventing stale `isSuccess`/`error` state across multi-token disposals
- **Deployment:** Vercel GitHub integration handles preview (PRs) and production (main push) — no CI deploy jobs
