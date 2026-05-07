---
type: repo
title: "marcusrbrown/poly"
created: 2026-05-07
updated: 2026-05-07
sources:
  - url: https://github.com/marcusrbrown/poly
    sha: e4abf2671a3efdc989a177d29adea641dbe52a9e
    accessed: 2026-05-07
tags: [python, polymarket, trading-bot, market-making, arbitrage, obsidian, sops, age, sqlite, asyncio, uv]
aliases: [poly]
related:
  - marcusrbrown--tokentoilet
---

# marcusrbrown/poly

Private repository and Obsidian vault for a Polymarket trading bot project. Two-person developer collaboration between Marcus and a partner. Currently pivoting from arbitrage (Phase 1, disqualified by experimental evidence) to market making (Phase 2, active development).

## Overview

- **Purpose:** Polymarket bot — market making via CLOB API, extending the open-source `warproxxx/poly-maker` reference implementation
- **Default branch:** `main`
- **Created:** 2026-05-05
- **Last push:** 2026-05-07
- **License:** Private/proprietary
- **Visibility:** Private (Fro Bot has collaborator access)
- **Language:** Python (79 KB as of survey)
- **Package manager:** uv (Python 3.12.x pinned)
- **Open issues:** Not enumerated (private)

## Architecture

### Repository Shape

Hybrid Obsidian vault + code repo. Markdown research notes and Python production code coexist under a single trunk-based git workflow.

| Path | Purpose |
|------|---------|
| `architecture/` | System diagrams, component overviews (1 file: `0001-system-overview.md`) |
| `decisions/` | ADRs — numbered, dated (6 files: `0001` through `0005` + README) |
| `research/` | Polymarket mechanics, reference bot walkthroughs (4 files) |
| `strategies/` | One file per strategy idea with status frontmatter (4 strategies + README) |
| `experiments/` | Dated folders, one per experiment (4 experiments from 2026-05-06) |
| `runbooks/` | Operational procedures (2 runbooks + README) |
| `deploy/` | Deployment configs (placeholder with README) |
| `scripts/` | Shared utility scripts (placeholder) |
| `src/` | Production bot code (placeholder `.gitkeep` — scaffolding pending per ADR-0005) |
| `docs/` | Brainstorms and planning artifacts |
| `secrets/` | SOPS-encrypted config (`secrets.enc.yaml`) |
| `.obsidian/` | Tracked Obsidian config (workspace/cache/plugins gitignored) |

### Tech Stack (decided in ADR-0005, not yet scaffolded)

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | Python 3.12.x | Matches py-clob-client, py_order_utils ecosystem |
| Package manager | uv | Used in all experiments |
| State store | SQLite (stdlib `sqlite3`, WAL mode) | 5 tables: markets, orders, fills, marks, positions |
| Logging | stdlib `logging` + JSON formatter | JSON-per-line to stdout, `jq`-queryable |
| Config | SOPS + age encrypted YAML, decrypted at boot | Strategy params in separate plaintext `config/strategy.yml` |
| CLI | `argparse`, single `poly` command | Subcommands: `check`, `paper-trade`, `trade`, `status`, `cancel-all` |
| Runtime | asyncio event loop | Isolated heartbeat task, `asyncio.to_thread()` for SQLite |
| Lint/format | ruff | Replaces black, isort, flake8 |
| Type checking | mypy (strict) | Thin vendor boundary for untyped SDK deps |
| Testing | pytest | Test tree mirrors `src/poly/` |

### Dependency Direction (codified in ADR-0005)

`cli → maker → exchange + rewards + state`, with `config` and `logging` cross-cutting. Cyclic imports are a code-review blocker.

### Safety Architecture

**Capability injection on both sides** (ADR-0005 Decision 7): `OrderSubmitter` and `FillIngester` are injected interfaces. Stage 0/1 use simulated implementations; Stage 2+ use live implementations. The maker loop never instantiates live versions directly. Belt-and-suspenders `POLY_LIVE_ORDERS=1` env flag required for live order submission.

## Strategic Context

### Phase 1 — Arbitrage (disqualified)

ADR-0001 chose arb-first phasing. Four structurally-related experiments on 2026-05-06 disqualified all tested snapshot-arb variants:

| Experiment | Result |
|-----------|--------|
| Cross-outcome edge survey (29,729 markets) | 0 gross-positive |
| Cross-market basket arb (3,069 neg-risk events) | 30 gross-positive, 0 net-positive after fees |
| Temporal monotonicity (137 clusters, 442 pairs) | 0 violations |
| Depth-aware edge survey (1,500 markets × 6 sizes) | 0 gross-positive |

Root cause: Polymarket's 1¢ minimum tick + active market makers eliminate static snapshot arbitrage.

### Phase 2 — Market Making (active, ADR-0004)

Pivot to maker-side participation. The hypothesis is not "earn rewards because we post tight quotes" but: **earn rewards faster than adverse selection drains us, with calibrated market selection and quote pricing.**

Three-stage gating sequence:

1. **Stage 0 — Scaffold** (current): First code in `src/`, replay-only, no order placement. Working `poly check` + passing test suite.
2. **Stage 1 — Paper-trade** (14 days minimum, non-negotiable): Live data, simulated fills, T+5min and T+1hr post-fill drift measurement. Pass criterion: median post-fill drift at breakeven or above net of taker fees.
3. **Stage 2 — Micro-canary** ($500–$1K, 4 weeks): Real orders, conservative spread. Daily P&L floor (5%), rolling 7-day drawdown floor (15%), adverse-selection ceiling. Pass: cumulative net P&L positive after all costs.
4. **Stage 3 — Scale** (gated by Stage 2 pass): Follow-up ADR required. Not committed.

Explicit failure modes: Stage 1 or Stage 2 failure → shelve Polymarket, do not move goalposts.

### Strategy Files

| Strategy | Status |
|----------|--------|
| `cross-outcome-arb.md` | Shelved (disqualified by experiments) |
| `cross-market-arb.md` | Shelved (disqualified by experiments) |
| `cross-venue-arb.md` | Untested, deprioritized |
| `market-making.md` | Active — being promoted to fleshed-out hypothesis |

### ADR Registry

| ADR | Title | Status |
|-----|-------|--------|
| 0001 | Arb first, MM second | Superseded by 0004 |
| 0002 | Encrypted config — SOPS + age | Accepted |
| 0003 | Wallet topology — Type 2 Safe | Accepted |
| 0004 | Pivot to Phase 2 (maker-side) | Proposed |
| 0005 | Project structure and stack | Proposed |

## Security and Secrets

- **SOPS + age** for encrypted config (ADR-0002). Single age recipient key in `.sops.yaml`. Path regex: `^secrets/.+\.(yaml|yml|json|env)$`.
- **Encrypted file:** `secrets/secrets.enc.yaml`
- **Gitleaks** pre-commit hook expected (via Marcus's dotfiles `core.hooksPath`)
- **Wallet bootstrap** runbook at `runbooks/wallet-bootstrap.md` (ADR-0003 follow-through)

## Conventions

- **Git:** Trunk-based, conventional commits, short-lived branches (`feat/`, `fix/`, `research/`, `experiment/`, `chore/`, `docs/`)
- **Writing:** Direct, terse, evidence-cited. Obsidian wikilinks acceptable but relative markdown links preferred for portability.
- **ADR format:** Title, Status, Context, Decision, Consequences. Short.
- **Strategy files:** YAML frontmatter with status field (`idea` / `prototype` / `live` / `shelved`)
- **Experiments:** Dated folders with `README.md` (Hypothesis, Setup, Method, Results, Conclusions)
- **Money types:** Integer-cents or integer-micros in SQLite, `decimal.Decimal` in Python. No IEEE 754 floats for money.

## Tooling and CI

- **EditorConfig:** 2-space indent (4-space for Python), LF line endings, UTF-8, final newline
- **No `.github/` directory** — no workflows, no CI, no Renovate, no Probot settings
- **No Fro Bot agent workflow** — follow-up draft PR should be proposed to add `fro-bot.yaml`
- **No CI pipeline yet** — deferred per ADR-0005 out-of-scope until something deployable exists

## Ecosystem Divergence

This repo diverges significantly from the typical Marcus repo pattern:

| Dimension | Typical Marcus repo | poly |
|-----------|-------------------|------|
| Language | TypeScript/Node | Python |
| Package manager | pnpm | uv |
| Linting | ESLint + Prettier (`@bfra.me/*`) | ruff + mypy |
| Testing | Vitest | pytest |
| CI | GitHub Actions (SHA-pinned) | None |
| Fro Bot | Present | **Missing** |
| Renovate | `marcusrbrown/renovate-config` | None |
| Probot settings | `fro-bot/.github:common-settings.yaml` | None |
| License | MIT (usually) | Private/proprietary |

The Python ecosystem choice is driven by the upstream `py-clob-client` and `poly-maker` reference implementations. The absence of CI/Renovate/Fro Bot is intentional — deferred until deployable code exists.

## Cross-References

- [[web3-defi]] — poly operates in the DeFi/prediction-market space; [[marcusrbrown--tokentoilet]] is the other Web3 project
- [[polymarket-trading]] — cross-cutting topic page for Polymarket venue mechanics and trading patterns
- Reference repos: `warproxxx/poly-maker` (market-making bot), `dappboris-dev/polymarket-trading-bot` (via DeepWiki, original 404'd)

## Survey History

| Date | SHA | Delta |
|------|-----|-------|
| 2026-05-07 | `e4abf26` | Initial survey |
