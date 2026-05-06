---
type: repo
title: "marcusrbrown/poly — Polymarket Bot (Arbitrage + Market Making)"
created: 2026-05-06
updated: 2026-05-06
sources:
  - url: https://github.com/marcusrbrown/poly
    sha: 5cdc962c29c24279722ca8eab389742163497962
    accessed: 2026-05-06
tags: [polymarket, arbitrage, market-making, prediction-markets, web3, obsidian, private, sops, age]
related:
  - marcusrbrown--tokentoilet
  - marcusrbrown--dotfiles
---

# marcusrbrown/poly

Private two-person collaboration repo (Marcus + @thejustinwalsh) for a Polymarket bot project. Dual-purpose: Obsidian vault for research/planning and codebase for production bot code.

## Strategy

Two-phase approach documented in ADR-0001:

1. **Phase 1 — Arbitrage:** Cross-outcome, cross-market, and cross-venue mispricing capture. Lower capital floor, faster validation, bootstraps working capital.
2. **Phase 2 — Market Making:** Extends [`warproxxx/poly-maker`](https://github.com/warproxxx/poly-maker), funded by Phase 1 returns.

## Repository Shape

| Path | Purpose |
| --- | --- |
| `architecture/` | System diagrams, component overviews (1 ADR: `0001-system-overview.md`) |
| `decisions/` | ADRs (4 files: arb-first-mm-second, encrypted-config-sops-age, wallet-topology-type-2-safe) |
| `research/` | Notes on Polymarket mechanics: CLOB API, poly-maker walkthrough, dappboris DeepWiki notes |
| `strategies/` | One file per strategy idea with frontmatter status (cross-market, cross-outcome, cross-venue arbs + market-making) |
| `experiments/` | Dated folders, one per experiment (scaffold only — `.gitkeep`) |
| `runbooks/` | Operational procedures (1: `encrypted-config-bootstrap.md`) |
| `deploy/` | Deployment configs (scaffold — `.gitkeep`) |
| `scripts/` | Shared utility scripts (scaffold — `.gitkeep`) |
| `src/` | Production bot code (scaffold — `.gitkeep`; Python likely per AGENTS.md) |
| `docs/brainstorms/` | Planning artifacts (1: `2026-05-05-vault-scaffold-requirements.md`) |
| `secrets/` | sops+age encrypted config (`secrets.enc.yaml`) |
| `.obsidian/` | Tracked Obsidian vault config (app, appearance, plugins, graph, hotkeys) |

## Key Decisions (ADRs)

- **ADR-0001:** Arb-first, market-making second — lower capital floor, faster validation loop
- **ADR-0002:** sops + age for encrypted config — public-key encryption, no hosted KMS dependency
- **ADR-0003:** Signature type 2 (Polymarket Safe) wallet topology

## Security & Secrets

- **sops + age encryption** for secrets: `.sops.yaml` at repo root, encrypts `secrets/*.yaml|yml|json|env`
- Single age recipient key: `age1eupfsk2dxqxqy9ff9qmpf50uu5ynxezwqhdt8ax3qnu2fwcjyd2snfkkzz`
- Machine-level defenses inherited from [[marcusrbrown--dotfiles]]: global gitignore (credential-shape filenames), gitleaks pre-commit hook
- **Never commit:** API keys, wallet seeds, RPC URLs with embedded auth, exchange credentials

## Conventions

- **Markdown-first:** Obsidian wikilinks acceptable, relative links preferred for portability
- **ADR format:** Title, Status, Context, Decision, Consequences — short and decisive
- **Strategy files:** Require YAML frontmatter with `status: idea|prototype|live|shelved`
- **Experiment folders:** Dated (`YYYY-MM-DD-<slug>/`), each with own README (Hypothesis, Setup, Method, Results, Conclusions)
- **Git conventions:** Trunk-based, conventional commits, short-lived branches (`feat/`, `fix/`, `research/`, `experiment/`, `chore/`, `docs/`), squash-merge to main
- **Writing style:** Direct, terse, no fluff, evidence-cited, code blocks fenced with language tag

## Technical Stack (as planned)

- **Language:** Python (likely, per AGENTS.md — TBD)
- **Config encryption:** sops 3.x + age
- **Reference implementations:** `warproxxx/poly-maker`, `dappboris-dev/polymarket-trading-bot` (404'd, DeepWiki cached)
- **Market protocol:** Polymarket CLOB API
- **Wallet:** Type 2 Polymarket Safe (per ADR-0003)

## Collaborators

- `marcusrbrown` (owner)
- `thejustinwalsh` (collaborator)
- `fro-bot` (collaborator — write access)

## Repository Metadata

- **Visibility:** Private
- **License:** Proprietary (all rights reserved)
- **Created:** 2026-05-05
- **Last push:** 2026-05-06
- **Default branch:** main
- **Language:** None detected (vault is mostly markdown; `src/` is scaffold)
- **Topics:** None set
- **Pages:** No
- **Issues:** 0 open
- **PRs:** 0 open
- **Commits:** 6 (initial scaffold through sops bootstrap)

## Fro Bot Integration

- **`fro-bot` is a collaborator** with write access
- **No `.github/` directory exists** — no workflows, no CI, no Fro Bot agent workflow, no Renovate, no Probot settings
- **No Fro Bot agent workflow detected** — follow-up PR recommended to add `fro-bot.yaml` with research/vault-aware review prompts
- No `settings.yml`, no branch protection visible via API (may be configured in GitHub UI)

## Cross-References

- [[marcusrbrown--tokentoilet]] — sibling Web3 project (DeFi token disposal); shares crypto domain knowledge
- [[marcusrbrown--dotfiles]] — machine-level security defenses (gitleaks, global gitignore) that poly relies on
- [[web3-defi]] — broader Web3 development patterns in the ecosystem

## Survey Notes

- This is a very early-stage repo (6 commits, created 2026-05-05) — mostly scaffolding and research notes
- Production code has not landed yet; `src/` contains only `.gitkeep`
- The Obsidian vault pattern is unique among Marcus's repos — first instance of tracked `.obsidian/` config
- Two-person collab with @thejustinwalsh is novel for the ecosystem (most repos are solo with Fro Bot as automated collaborator)
- Prediction markets / arbitrage is a new domain not previously represented in the portfolio
