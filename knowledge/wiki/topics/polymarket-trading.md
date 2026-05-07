---
type: topic
title: "Polymarket Trading"
created: 2026-05-07
updated: 2026-05-07
sources:
  - url: https://github.com/marcusrbrown/poly
    sha: e4abf2671a3efdc989a177d29adea641dbe52a9e
    accessed: 2026-05-07
tags: [polymarket, trading, market-making, arbitrage, clob, prediction-markets, python]
---

# Polymarket Trading

Patterns, mechanics, and findings related to Polymarket prediction-market trading across the Fro Bot-managed ecosystem. Primary repository: [[marcusrbrown--poly]].

## Repositories

- [[marcusrbrown--poly]] — Private Polymarket bot project (arbitrage → market making)

## Venue Mechanics (from poly research notes)

Polymarket operates a Central Limit Order Book (CLOB) for binary outcome tokens. Key properties documented in `poly/research/`:

- **Minimum tick:** 1¢ — acts as a hard floor that eliminates most static snapshot arbitrage
- **Heartbeat:** 10-second PING required; missed heartbeats cancel all open orders
- **Order types:** Limit orders via CLOB API, EIP-712 signed
- **Neg-risk events:** Multi-outcome markets where sub-outcomes share a risk pool
- **Rewards program:** Liquidity rewards paid to market makers via `S = ((v - s) / v)² × b` formula — incentivizes tight quotes near midpoint

## Arbitrage Findings (Phase 1, disqualified)

Four experiments on 2026-05-06 structurally disqualified same-venue snapshot arbitrage:

1. **Cross-outcome:** `YES_bid + NO_bid > 1` never observed across 29,729 active binary markets
2. **Cross-market basket:** 30 gross-positive baskets out of 2,671 neg-risk events; 0 survived per-leg taker fees
3. **Temporal monotonicity:** 0 violations across 442 directional pairs in 137 monotonic clusters
4. **Depth-aware:** Book deterioration is monotonic with size — arb is worse, not better, below top-of-book

All four measure the same structural constraint: venue tick-size + maker-side defense.

### Untested Variants

| Variant | Status | Assessed likelihood |
|---------|--------|-------------------|
| Cross-event logical implication | Deprioritized | High (same MMs, same tick) |
| Microsecond-window streaming arb | High-cost | Unknown (races same MMs) |
| Cross-venue (Polymarket ↔ Kalshi/sportsbooks) | Untested | Unknown (different shape) |

## Market-Making Strategy (Phase 2, active)

The poly project's market-making hypothesis centers on **adverse-selection mitigation, not just rewards capture**. The reference implementation `warproxxx/poly-maker` reported a net loss attributed to directional risk + bugs — but directional risk *is* adverse selection in market making.

### Key Design Decisions

- **Capability injection:** `OrderSubmitter` + `FillIngester` interfaces allow stage transitions (paper → live) without architectural rewrites
- **Post-fill mark-to-market:** Every fill marked at T+5min and T+1hr to measure drift signal; missed marks recorded as NULL, not dropped
- **Integer money types:** Cents/micros in SQLite, `decimal.Decimal` in Python — IEEE 754 float noise would poison the 14-day drift signal
- **Crash recovery:** Venue (CLOB API) is source of truth on every startup; local SQLite reconciled against venue state
- **Single-process asyncio:** Isolated heartbeat task that strategy logic cannot block; SQLite via `asyncio.to_thread()`

### Gating Sequence

| Stage | Duration | Capital | Pass criterion |
|-------|----------|---------|---------------|
| 0 (scaffold) | Current | $0 | Working `poly check` + passing tests |
| 1 (paper-trade) | 14 days min | $0 | Median T+1hr post-fill drift ≥ breakeven net of fees |
| 2 (micro-canary) | 4 weeks | $500–$1K | Cumulative net P&L positive after all costs |
| 3 (scale) | TBD | TBD | Follow-up ADR required |

### Reference Implementations

- **`warproxxx/poly-maker`** — Open-source Polymarket market-making bot; primary reference for auth, websocket, orderbook math, order placement. Author reported net loss.
- **`dappboris-dev/polymarket-trading-bot`** — Referenced via DeepWiki (original repo 404'd); gap-filler documentation
- **[Substack writeup](https://tezlee.substack.com/p/i-cloned-a-polymarket-market-making)** — Author's notes on cloning poly-maker

## Python SDK Ecosystem

The Polymarket Python ecosystem that poly targets:

| Package | Purpose |
|---------|---------|
| `py-clob-client` | CLOB API client (orders, book, trades) |
| `py_order_utils` | Order construction + EIP-712 signing |
| `poly_eip712_structs` | EIP-712 typed data structures |

All three are pinned to exact versions in `pyproject.toml` (per ADR-0005). Python 3.12.x chosen over latest stable for ecosystem compatibility — crypto/web3 SDKs lag CPython releases.

## Relationship to Web3 Ecosystem

Polymarket operates on Polygon (L2). The poly project interfaces with the CLOB API layer rather than directly with on-chain contracts, distinguishing it from the ERC-20/ERC-721 token interaction patterns in [[marcusrbrown--tokentoilet]]. The projects share a Web3 domain but have no code or dependency overlap — different languages (Python vs TypeScript), different chains (Polygon vs Sepolia/Ethereum), different interaction layers (CLOB API vs on-chain transactions).
