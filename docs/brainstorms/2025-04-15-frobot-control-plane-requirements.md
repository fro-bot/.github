---
date: 2025-04-15
topic: frobot-control-plane
---

# Fro Bot Autonomous Control Plane

## Problem Frame

Fro Bot today is a **reactive tool** — it responds when poked via `@fro-bot` mention, schedule, or dispatch. The `.github` repo functions as a thin prompt wrapper over a single agent workflow. While this works, it doesn't compound value: Fro Bot has no memory between invocations, no persistent knowledge of repos it works in, no social presence, and no ability to improve its own behavior.

The goal is to transform Fro Bot into an **autonomous GitHub persona** — a playful trickster-helper character rooted in the Afrofuturism × Cyberpunk aesthetic. The character is intrinsically valuable: Fro Bot should be witty, opinionated, occasionally surprising, and genuinely useful in ways that make people smile. The automation is how the character acts in the world.

This `.github` repo becomes the **control plane** that drives the Fro Bot persona: persistent memory, event routing, tiered autonomy, cross-platform presence, and self-improvement — all tracked in GitHub, growing in public.

## Requirements

### Persona & Voice

- R1. Fro Bot has a consistent **playful trickster-helper** personality across all interactions — PR reviews, issue responses, social posts, and commit messages
- R2. The Afrofuturism × Cyberpunk aesthetic (defined in `assets/styleguide.md`) is expressed naturally in Fro Bot's voice, not forced — it's who the character is, not a skin
- R3. Fro Bot has opinions and shares them. It doesn't just execute — it reacts, celebrates wins, calls out bad patterns, and occasionally surprises
- R4. Persona behavior is defined in a **persona document** (prompt instructions) that lives in this repo and is versioned alongside the control plane

### GitHub Event Handling (V1 Core Loop)

- R5. Fro Bot responds to **collaboration invites** from approved users:
  - Verifies the inviting user is on an allowlist
  - Accepts the invitation
  - Performs initial repo survey (structure, languages, patterns, existing workflows)
  - Stars the repo
  - May propose adding a `fro-bot.yaml` workflow with tailored prompts if not already installed
- R6. Fro Bot responds to **issue and PR events** in repos where it's a collaborator, following existing `fro-bot.yaml` patterns but with persona-consistent voice
- R7. Fro Bot performs **scheduled oversight** across all repos where it's a collaborator — health checks, security updates, dependency reviews, DX improvements
- R8. Fro Bot handles **Renovate metadata tracking** with smart dispatch:
  - Maintains a `metadata/renovate.yaml` tracking which repos have Renovate
  - Dispatches Renovate runs across repos with deduplication (check if already running before dispatch)
  - Adapted from the `bfra-me/.github` pattern with the improvement of run-status checking pre-dispatch

### Memory & State (GitHub-Native)

- R9. All persistent state lives in GitHub — auditable, versioned, public:
  - **Metadata files** (`metadata/*.yaml`) for structured state (repo inventory, Renovate tracking, activity metrics)
  - **Issues as journal** — Fro Bot maintains a running journal of its activity, decisions, and reflections via GitHub Issues
  - **Discussions for reflection** — periodic self-assessment and milestone tracking
- R10. Fro Bot builds a **knowledge base** per repo it collaborates on, using the Karpathy LLM wiki pattern (already prototyped in `fro-bot/agent/docs/wiki`):
  - Repo structure and conventions
  - Common patterns and anti-patterns observed
  - Contributor preferences and workflow notes
  - Known gotchas and past issues
- R11. Knowledge base grows incrementally with each interaction and is persisted in a discoverable location (this repo or a dedicated knowledge repo)

### Self-Improvement

- R12. Fro Bot tracks **behavioral metrics**:
  - PR review acceptance rate (reviews that led to merged PRs without further changes)
  - Issue resolution quality (issues closed by Fro Bot's suggestions)
  - Response helpfulness signals (emoji reactions, follow-up comments)
  - Onboarding success rate (repos where proposed workflows were adopted)
- R13. Fro Bot periodically **proposes prompt improvements** based on metric trends — stored as draft PRs to this repo for human review
- R14. Self-improvement changes require **human approval** before taking effect — Fro Bot suggests, human decides
- R15. Improvement history is tracked in git — every change to persona, prompts, or behavior is a versioned commit with rationale

### Trust & Autonomy (Tiered Model)

- R16. **Autonomous (no approval needed)**:
  - Star repos, accept invites from approved users
  - Comment on issues/PRs in repos where it's a collaborator
  - Perform read-only surveys and knowledge base updates
  - Post to social channels
  - Create journal issues in its own repos
- R17. **Approval required (propose and wait)**:
  - Propose adding workflows to repos
  - Open PRs with code changes
  - Modify its own prompts/persona (self-improvement)
  - Dispatch cross-repo operations (Renovate, branding)
- R18. **Explicit human authorization only**:
  - Push directly to branches
  - Merge PRs
  - Cross-repo writes (commit to repos other than its own)
  - Modify trust tier definitions or allowlists
- R19. Approval workflows use GitHub's existing mechanisms — PR reviews for code/config changes, issue labels or reactions for operational approvals

### Cross-Platform Output (V1: Broadcast Only)

- R20. Fro Bot posts **curated highlights** to Discord and BlueSky — it chooses what's interesting enough to share, like a real social media personality
- R21. Content types: new repo onboarded, notable PR review, self-improvement milestone, weekly digest, personality-consistent commentary on its own work
- R22. Social output is **in character** — same trickster-helper voice as GitHub interactions
- R23. Discord and BlueSky are **output-only in V1** — no bidirectional event handling yet

### Releases & Versioning

- R24. Control plane changes are versioned using **changesets** — adapted from the `bfra-me/.github` pattern
- R25. Releases create GitHub releases with changelogs, git tags, and floating major branches
- R26. Workflow template pins are auto-updated on release via a `release.ts`-style script

## Success Criteria

- SC1. Fro Bot can accept a collaboration invite, survey a repo, and propose a tailored workflow — end to end, autonomously, with personality
- SC2. Fro Bot's knowledge base for a repo grows over 5+ interactions and demonstrably improves response quality
- SC3. Behavioral metrics are tracked and at least one prompt improvement is proposed based on data within the first month of operation
- SC4. Social posts on Discord/BlueSky are consistently in character and curated (not every-event spam)
- SC5. Trust tiers are enforced — autonomous actions happen without prompting, approval-required actions wait, and high-risk actions are blocked without explicit authorization

## Scope Boundaries

- **In scope**: GitHub event handling, GitHub-native memory, knowledge base, self-improvement proposals, social broadcast, Renovate smart dispatch, changeset releases, persona definition
- **Not in scope for V1**: Bidirectional Discord/BlueSky (input from social), multi-user support (only Marcus's repos), third-party integrations beyond Discord/BlueSky, web dashboard, monetization
- **Explicitly deferred**: Custom GitHub App (continue using PAT + existing App for V1, evaluate App migration for V2 based on privilege-splitting needs)

## Key Decisions

- **Persona is primary**: Fro Bot is a character first, tool second. Design decisions favor personality expression over pure efficiency
- **GitHub-native state**: No external database. All memory lives in GitHub (metadata YAML, issues, discussions, wiki-pattern knowledge base)
- **Tiered autonomy**: Three trust tiers with GitHub-native approval mechanisms (PR reviews, issue labels)
- **Curated social output**: Fro Bot chooses what to share, not a firehose. Quality over quantity
- **Karpathy wiki pattern**: Knowledge base follows the LLM wiki approach already prototyped in `fro-bot/agent`
- **bfra-me patterns adapted**: Renovate smart dispatch and changeset releases ported from `bfra-me/.github` with improvements

## Dependencies / Assumptions

- `fro-bot/agent` action continues as the execution engine — control plane dispatches, agent executes
- `FRO_BOT_PAT` (or future App token) has sufficient permissions for cross-repo operations
- Discord webhook/bot and BlueSky API access are available (credentials to be provisioned)
- Karpathy wiki pattern in `fro-bot/agent/docs/wiki` is stable enough to build on

## Outstanding Questions

### Deferred to Planning

- [Affects R5, R7][Technical] How should the user allowlist be structured and where should it live? (metadata YAML vs repo settings vs environment)
- [Affects R9][Technical] Should the journal/knowledge repos be separate from the control plane repo, or subdirectories within it?
- [Affects R10, R11][Needs research] What's the right granularity for wiki entries — per-repo file, per-topic, or per-interaction?
- [Affects R12][Technical] How do we collect behavioral metrics from the agent action's output? Does fro-bot/agent expose structured feedback?
- [Affects R20-R23][Needs research] Discord webhook vs bot for output? BlueSky API auth flow and rate limits?
- [Affects R24-R26][Technical] Exact changeset config and release script adaptations needed for fro-bot's structure
- [Affects R8][Technical] Best approach for "check if Renovate is already running" pre-dispatch — `gh run list` polling or workflow concurrency?

## Next Steps

→ `/ce:plan` for structured implementation planning
