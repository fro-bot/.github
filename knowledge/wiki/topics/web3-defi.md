---
type: topic
title: "Web3 & DeFi Development"
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
  - url: https://github.com/fro-bot/tokentoilet
    sha: a141424e89c133a3c8e1a7544f31193afc5af21c
    accessed: 2026-06-04
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: 3be6b7675bab3d7f207c3ea6e1dc439c541cb0c8
    accessed: 2026-06-20
  - url: https://github.com/marcusrbrown/tokentoilet
    sha: c6e10e0515d83d00fcece101f1b6d6b0549f5a95
    accessed: 2026-07-04
tags: [web3, defi, wagmi, reown-appkit, walletconnect, ethereum, sepolia, erc-20, erc-721, alchemy, viem]
---

# Web3 & DeFi Development

Patterns, tooling, and conventions for Web3 and decentralized finance (DeFi) applications across the Fro Bot-managed ecosystem.

## Repositories

- [[marcusrbrown--tokentoilet]] — Token disposal and charity donation DeFi app (Next.js + Wagmi + Reown AppKit)

## Wallet Integration Stack

The ecosystem currently standardizes on:

| Component         | Tool                                            | Notes                                    |
| ----------------- | ----------------------------------------------- | ---------------------------------------- |
| React hooks       | Wagmi v3 (as of 2026-05-28 in [[marcusrbrown--tokentoilet]]) | Core wallet/chain interaction primitives; major bump from v2 landed via PR #837 lineage |
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

## MVP Architecture (2026-04-17)

The first functional disposal flow (PR #911 in [[marcusrbrown--tokentoilet]]) uses a burn-address mechanism on Sepolia:

- **No smart contracts yet** — tokens are sent to a dead address; custom contracts (`TokenToilet.sol`, `CharitySprinkler.sol`, `ProofOfDisposal.sol`) are roadmap items
- **Multi-step UI:** `DisposalFlow` component orchestrates token selection → network validation → approval → burn transfer
- **`NetworkGuard`** validates the connected wallet is on Sepolia before rendering disposal UI
- **Keyed `DisposalExecutor`** — each token gets a fresh `useTokenDisposal` hook instance via React key, preventing stale `isSuccess`/`error` state across multi-token disposals
- **Deployment:** Vercel GitHub integration handles preview (PRs) and production (main push) — no CI deploy jobs

## Token Discovery via Alchemy (2026-07-03)

The first non-scaffold discovery implementation landed in [[marcusrbrown--tokentoilet]] (PR #1179). Patterns worth carrying forward to other Web3 apps:

- **Enumerate real holdings, not a static list.** `useTokenDiscovery` calls Alchemy's `alchemy_getTokenBalances` with the connected wallet address to list actual ERC-20 balances. The wallet address is sent to Alchemy — this is the required data flow for discovery to function and is documented as such in `.env.example`.
- **Fail closed, never fall back to a hardcoded list.** With no `NEXT_PUBLIC_ALCHEMY_API_KEY`, the app renders a "discovery unavailable" state. A silent static-list fallback would mislead users about their actual holdings; the absence of a key is surfaced, not papered over.
- **Browser-exposed key → domain allowlist.** The Alchemy key is a `NEXT_PUBLIC_*` var, so it reaches the client. The abuse control is not secrecy but a domain allowlist configured in the Alchemy dashboard.
- **Rejected key ≠ transient error.** A 401/rejected key is classified as *unavailable* (permanent), not *retryable* (#1183). This prevents a hot retry loop hammering the provider with a key that will never succeed.
- **Skip, don't abort.** An unmapped chain skips that chain rather than aborting the whole scan (#1180) — partial discovery beats total failure.
- **Surface structured errors.** Discovery errors propagate to the UI as structured messages (#1184), not swallowed console noise. Provider error-shape captured as a `docs/solutions` learning (#1186).

## Simulate Before Signing (2026-07-03)

[[marcusrbrown--tokentoilet]] PR #1175 added a transfer simulation step before prompting the user for a signature. Simulating the transaction catches reverts before they cost a signature or gas. This is now an enforced expectation in the Fro Bot Web3-security review rubric ("simulate before prompting signature") — a pattern that should generalize to any signature-gated on-chain write.

## Privacy: Telemetry Defaults Off (2026-07-03)

Analytics telemetry in [[marcusrbrown--tokentoilet]] defaults to opt-in / off (PR #1174). The default was deliberately set to off rather than shipping opt-out telemetry, consistent with the no-unconsented-telemetry baseline that governs the ecosystem. When adding any analytics to a Web3 app here, off-by-default is the required posture.

## Mainnet Readiness: Explicit No-Go (2026-07-03)

A readiness spike (#1178) concluded [[marcusrbrown--tokentoilet]] stays Sepolia-only until token discovery is proven correct. The `SUPPORTED_CHAIN_IDS: [11155111]` lock is now a documented decision backed by a spike, not merely an unfinished feature. Stale multi-chain RPC env vars were removed (#1176) and invalid multi-chain integration tests deleted with E2E gaps tracked separately (#1172). Pattern: gate mainnet on read-path correctness (discovery) before write-path expansion.

## Migration Notes: Wagmi v2 → v3 (2026-05-28)

The `useWallet` abstraction in [[marcusrbrown--tokentoilet]] paid off during the wagmi v2 → v3 upgrade — the firewall between components and the wagmi API meant the major version bump largely contained itself inside the `hooks/` directory. The pattern's value: every component that uses `useWallet` instead of `useAccount`/`useConnect` directly is one less site that needs touching when wagmi changes shape. Watch for this when migrating other Web3 apps in the portfolio.
