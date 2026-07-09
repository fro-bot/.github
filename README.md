<div align="center">

<img src="./assets/banner.svg" alt="Fro Bot .github Banner" width="100%" />

# Fro Bot .github Repository

> Community health files and automated control center for the AI-powered GitHub bot

[![Build Status](https://img.shields.io/github/actions/workflow/status/fro-bot/.github/main.yaml?branch=main&style=for-the-badge&label=Build&labelColor=0D0216&color=00BCD4)](https://github.com/fro-bot/.github/actions?query=workflow%3Amain) [![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/fro-bot/.github/badge?style=for-the-badge&labelColor=0D0216&color=E91E63)](https://securityscorecards.dev/viewer/?uri=github.com/fro-bot/.github) [![License](https://img.shields.io/badge/License-MIT-FFC107?style=for-the-badge&labelColor=0D0216&color=FFC107)](LICENSE.md)

[Overview](#overview) · [Features](#features) · [Branding](#branding) · [Getting Started](#getting-started) · [Repository Structure](#repository-structure) · [Development](#development)

</div>

## Overview

Fro Bot is an AI-powered GitHub bot for repository review, maintenance, and control-plane automation. This repository is the org-level control center: community health files, shared configuration, workflow definitions, metadata state, the knowledge wiki, and agent guidance for managed repositories.

**What Fro Bot Does:**

- Reviews pull requests and triages issues under the `@fro-bot` identity
- Accepts allowlisted collaborator invitations, stars onboarded repositories, and tracks them in auditable metadata
- Ingests collaborator repositories into the knowledge wiki and lints the authoritative snapshot from `data`
- Dispatches Renovate across tracked repos and refreshes org metadata on schedule
- Enforces consistent repository settings, branch protections, and community-health defaults

## Features

🤖 **AI-Powered Automation**

- Pull request review, issue triage, and scheduled oversight via the Fro Bot agent workflows
- Repo-ingest, journal, and social-broadcast plumbing for autonomous status updates
- Knowledge capture through the Karpathy-style wiki and `docs/solutions/` learnings

🔧 **Repository Management**

- Centralized community health files (`README.md`, `SECURITY.md`, `LICENSE.md`)
- Automated repository settings synchronization via Probot Settings
- Auditable control-plane state in `metadata/*.yaml` on the `data` branch

🚀 **CI/CD Integration**

- GitHub Actions workflows for CI, reconcile/onboarding, metadata promotion, and wiki linting
- Automated dependency management with Renovate plus tracked-repo dispatch
- Security scanning with CodeQL, Dependency Review, and OpenSSF Scorecard

⚙️ **Development Standards**

- Node 24 native TypeScript scripts with strict type-checking and strip-only compatibility checks
- ESLint + Prettier enforcement and colocated Vitest coverage for `scripts/*.ts`
- Canonical AI-assistant guidance in [`.github/copilot-instructions.md`](.github/copilot-instructions.md)

## Branding

This repository is the central hub for Fro Bot's visual identity. It contains the brand assets, design tokens, and automation to apply consistent branding across all Fro Bot repositories.

### Assets

| Asset | Description |
| --- | --- |
| [`assets/banner.svg`](assets/banner.svg) | Social banner for this repo (1280×640) |
| [`assets/banner-template.svg`](assets/banner-template.svg) | Parametric SVG template with `{{PLACEHOLDER}}` tokens |
| [`assets/styleguide.md`](assets/styleguide.md) | Complete design system (colors, typography, spacing, components) |
| [`assets/fro-bot.png`](assets/fro-bot.png) | Brand avatar |
| [`branding/README-template.md`](branding/README-template.md) | Skeleton README following brand guidelines |
| [`branding/tokens.css`](branding/tokens.css) | CSS design tokens for downstream use |

### Apply Branding to a Repo

Use the **Apply Branding** workflow to apply the template to any Fro Bot repository:

1. Go to **Actions** → **Apply Branding**
2. Enter the target repository (e.g. `fro-bot/some-repo`)
3. Optionally provide a tagline
4. Run the workflow

The workflow will generate a branded banner, styled README, and open a PR in the target repo.

### Design System

The Fro Bot visual identity follows the **Afrofuturism × Cyberpunk** aesthetic:

| Token              | Color     | Usage                  |
| ------------------ | --------- | ---------------------- |
| `--frobot-void`    | `#0D0216` | Deepest background     |
| `--frobot-purple`  | `#1A0B2E` | Primary dark surface   |
| `--frobot-cyan`    | `#00BCD4` | Primary accent, links  |
| `--frobot-magenta` | `#E91E63` | Secondary accent, CTAs |
| `--frobot-amber`   | `#FFC107` | Highlights, badges     |

See the full [styleguide](assets/styleguide.md) for typography, spacing, WCAG compliance, and component patterns.

## Getting Started

This repository provides shared configurations and automation for the Fro Bot ecosystem. To contribute or customize:

### Prerequisites

- **Node.js** 24 (pinned in [`mise.toml`](mise.toml); native TypeScript execution, no build step)
- **pnpm** 11.9.0 (pinned in `packageManager`)
- **Git** for version control
- Optional: [`mise`](https://mise.jdx.dev/) to auto-install the pinned toolchain

### Local Development

1. **Clone the repository:**

   ```bash
   git clone https://github.com/fro-bot/.github.git
   cd .github
   ```

2. **Install dependencies:**

   ```bash
   pnpm bootstrap
   ```

3. **Run quality checks:**

   ```bash
   # Type checking
   pnpm check-types

   # Linting (ESLint runs Prettier via eslint-plugin-prettier)
   pnpm lint

   # Tests (Vitest, colocated as scripts/*.test.ts)
   pnpm test

   # Coverage
   pnpm coverage
   ```

4. **Auto-fix issues:**

   ```bash
   # Auto-fix lint and formatting via ESLint
   pnpm fix
   ```

> [!TIP] This repository follows strict development standards. Make sure to run quality checks before committing changes.

## Repository Structure

```text
.github/
├── .agents/                # Repo-scoped agent skills
│   └── skills/             # Self-contained SKILL.md references
├── .github/                # GitHub-specific configurations
│   ├── actions/setup/      # Composite bootstrap action
│   ├── hooks/              # Copilot governance hooks
│   ├── workflows/          # 25 GitHub Actions workflows (see Automation)
│   ├── copilot-instructions.md  # Canonical AI-assistant guidance
│   ├── renovate.json5      # Dependency management config
│   └── settings.yml        # Repository settings via Probot
├── assets/                 # Brand assets (banner, avatar, styleguide)
├── branding/               # Downstream branding templates
│   ├── README-template.md  # Skeleton README applied by Apply Branding workflow
│   └── tokens.css          # CSS design tokens
├── docs/                   # Planning artifacts (brainstorms, plans, solutions, archive)
├── knowledge/              # Karpathy-style LLM wiki
│   ├── schema.md           # Conventions for wiki entries
│   ├── index.md            # Catalog of all wiki pages
│   ├── log.md              # Chronological ingest log
│   └── wiki/{repos,topics,entities,comparisons}/
├── metadata/               # Versioned control-plane state (YAML)
├── persona/                # Fro Bot voice and character definition
├── scripts/                # TypeScript entrypoints (Node 24 native TS)
├── common-settings.yaml    # Shared repository settings for downstream repos
├── eslint.config.ts        # Linting configuration
├── mise.toml               # Pinned tool versions
├── package.json            # Project metadata and scripts
├── tsconfig.json           # TypeScript configuration
└── vitest.config.ts        # Test runner configuration
```

### Key Configuration Files

| File | Purpose |
| --- | --- |
| [`common-settings.yaml`](common-settings.yaml) | Shared repository settings applied across Fro Bot projects |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | Canonical AI-assistant guidance for contributions to this repo |
| [`.github/settings.yml`](.github/settings.yml) | Probot-managed settings for this repository (branch protection, required checks) |
| [`.github/renovate.json5`](.github/renovate.json5) | Automated dependency management configuration |
| [`eslint.config.ts`](eslint.config.ts) | Lint + format configuration (ESLint runs Prettier via `eslint-plugin-prettier`) |
| [`mise.toml`](mise.toml) | Pinned Node, pnpm, and Python versions |
| [`tsconfig.json`](tsconfig.json) | TypeScript strict-mode configuration (native TS execution) |
| [`vitest.config.ts`](vitest.config.ts) | Vitest configuration for colocated `scripts/*.test.ts` files |

## Automation

### GitHub Actions Workflows

Quality gates:

| Workflow | Purpose | Trigger |
| --- | --- | --- |
| **Main** | Lint, type checking, tests, and workflow validation | PR, push to main, dispatch |
| **CodeQL** | Security vulnerability analysis | PR, push to main, weekly |
| **Dependency Review** | Block PRs introducing known-vulnerable packages | Pull request |
| **Scorecard supply-chain security** | OpenSSF supply-chain security posture | Push to main, weekly |
| **Copilot Setup Steps** | Environment bootstrap for GitHub Copilot coding agent | PR/push touching the file |
| **Check Private Leak** | Triggered follow-up on private-leak sentinel findings | Workflow run |
| **Private Leak Sentinel** | Scan PRs for accidental private-data exposure | Pull request |

Fro Bot control plane:

| Workflow | Purpose | Trigger |
| --- | --- | --- |
| **Fro Bot** | Core agent: PR review, issue triage, scheduled oversight, manual tasks | Issues, PR events, schedule, dispatch, workflow_call |
| **Capture Learnings** | Capture and commit knowledge-wiki learnings to the `data` branch | Schedule, dispatch |
| **Capture Patterns** | Detect recurring correction patterns across accepted learnings and solution docs, then draft human-reviewed pattern proposals | Manual dispatch |
| **Poll Invitations** | Accept allowlisted collaboration invitations | Every 15 minutes, dispatch |
| **Reconcile Repos** | Reconcile collaborator access against `metadata/repos.yaml`; dispatch surveys for stale repos; auto-stars collab/contrib repos | Daily 05:17 UTC, dispatch |
| **Survey Repo** | Ingest a repository into the knowledge wiki; dispatched by Reconcile Repos or manually via `gh workflow run survey-repo.yaml -f node_id=<node_id>` | Dispatch (by Reconcile Repos) |
| **Merge Data Branch** | Promote autonomous `data`-branch commits to `main` | Sunday 22:00 UTC, dispatch |
| **Update Metadata** | Refresh `metadata/renovate.yaml` from the fro-bot org scan | Daily 04:30 UTC, dispatch |
| **Dispatch Renovate** | Dispatch Renovate runs across repos tracked in `metadata/renovate.yaml` | Every 4 hours at `:30`, dispatch |
| **Gateway Rollout Tracker** | Track and report on gateway rollout status across managed repos | Schedule, dispatch |
| **Status Truth** | Detect drift in typed public coordination claims and manage proposal issues with counts-only summaries | Sunday 21:00 UTC, dispatch |
| **Reset Survey Status** | Manually clear stale survey state for one or more tracked repos on `data` | Manual dispatch |
| **Wiki Lint** | Lint the authoritative wiki snapshot restored from `origin/data` | Sunday 20:00 UTC, dispatch |

Repository management:

| Workflow | Purpose | Trigger |
| --- | --- | --- |
| **Apply Branding** | Apply brand template (banner + README) to a Fro Bot repo | Manual dispatch |
| **Update Repo Settings** | Sync `.github/settings.yml` via Probot | Push to main, daily 04:05 UTC, dispatch |
| **Manage Cache** | Clean up workflow caches | PR close, Sunday 00:00 UTC, dispatch |
| **Manage Issues** | Issue-hygiene automation | Daily 01:30 UTC, reusable, dispatch |
| **Renovate** | Automated dependency updates | Hourly, PR/issue events, dispatch |

> [!NOTE] The Fro Bot PR-review workflow triggers on `ready_for_review` and `review_requested` to reduce duplicate runs. For ad hoc reviews outside those events, mention `@fro-bot` in the PR conversation.

### Repository Settings Management

Fro Bot uses [Probot Settings](https://probot.github.io/apps/settings/) to synchronize repository configurations across managed repositories. The settings enforce consistent:

- Branch protection rules
- Required status checks
- Security policies
- Collaboration settings

### Control Plane State

Runtime state lives in version-controlled YAML under [`metadata/`](metadata/) (allowlist, tracked repos, Renovate targets, social cooldowns). See [`metadata/README.md`](metadata/README.md) for schemas and update conventions. Autonomous writes target the unprotected `data` branch and promote to `main` via the **Merge Data Branch** workflow. `Update Metadata`, invitation handling, reconcile, social cooldown writes, and wiki ingest all follow that model.

### Knowledge Wiki

Fro Bot maintains a [Karpathy-style LLM wiki](knowledge/) (`schema.md`, `index.md`, `log.md`, plus `wiki/{repos,topics,entities,comparisons}/`) that compounds cross-repo knowledge. The **Survey Repo** workflow ingests repositories into the wiki; **Reconcile Repos** schedules those surveys; **Wiki Lint** validates the authoritative snapshot restored from `origin/data` before reporting findings.

A small wiki context excerpt is injected into every agent run by default. When that baseline is insufficient, Fro Bot may optionally invoke `scripts/wiki-context-expand.ts` (`linked` or `query` mode) during a run to pull a bounded, read-only set of additional wiki excerpts — capped at 3 pages and 8 KiB per invocation, filtered through the same public-context safety gate as baseline retrieval.

When a completed scan reports a purely mechanical finding, **Wiki Lint**'s `wiki-repair` job self-heals it in the same run: `index-drift` and `orphan-page` regenerate the wiki index, and `missing-frontmatter`/`invalid-frontmatter` get a per-page frontmatter repair limited to two derivable fields — `type` (from the page's directory) and `title` (copied verbatim from an existing H1). Every other finding, including any other frontmatter field, requires judgment and stays on the issue-only lifecycle (open/update/reopen/close via `wiki-lint-issue-sync`). Repairs commit to the `data` branch through the existing atomic-commit envelope and ride the normal `data → main` promotion path (auto-merge when the promoted diff is knowledge/metadata-only); they never touch `main` directly. Repair commit messages are a fixed, counts-free template — never page slugs, titles, or repo names. Issue closure for a repaired finding still runs through the next **Wiki Lint** scan's close-on-clear behavior, not the repair job itself.

To manually re-survey a repo, pass its GitHub GraphQL `node_id` as the dispatch input:

```bash
# Look up the node_id
gh api graphql -f query='query{repository(owner:"<owner>",name:"<repo>"){id}}' --jq '.data.repository.id'

# Dispatch the survey
gh workflow run survey-repo.yaml -f node_id=<node_id>
```

The `node_id` for each tracked repo is stored in `metadata/repos.yaml` on the `data` branch.

### Status-Truth Proposals

Machine-verifiable claims live in [docs/status.md](docs/status.md).

The **Status Truth** workflow detects drift between documented status claims and live GitHub state, then opens fingerprinted proposal issues for review. Each proposal contains structured evidence fields (kind, claimed state, live state, proposed correction) and a hidden fingerprint marker for lifecycle tracking.

**Reviewing a proposal:**

Apply one of the following labels to record your decision. The loop reads these labels on the next run.

| Label | Meaning | Effect on future runs |
| --- | --- | --- |
| `status-truth:accepted` | Drift is real; correction is valid | Non-terminal: issue may reopen if drift recurs |
| `status-truth:rejected` | Claim was correct; finding was wrong | **Terminal:** suppresses future matching findings |
| `status-truth:false-positive` | Finding is a systematic false alarm | **Terminal:** suppresses future matching findings |
| `status-truth:manually-fixed` | Drift corrected by hand | Non-terminal: auto-closes when drift clears |
| `status-truth:superseded` | A newer finding replaces this one | Non-terminal: preserved for history; may reopen if the same drift recurs |

**Terminal labels** (`rejected`, `false-positive`) permanently suppress future findings with the same fingerprint. Use them when the claim kind is systematically wrong for this source, not just transiently stale.

**Non-terminal labels** (`accepted`, `manually-fixed`, `superseded`) preserve history and allow the loop to reopen the issue if the same drift returns, or auto-close it when the drift clears.

**Marking a proposal false-positive:**

1. Open the proposal issue.
2. Apply the `status-truth:false-positive` label.
3. Optionally add a comment explaining why (e.g., "this PR reference is intentionally historical").
4. Close the issue. The loop will not reopen it for the same fingerprint.

**Marking a proposal accepted:**

1. Apply the `status-truth:accepted` label.
2. Make the correction (update the doc, close the PR, etc.).
3. Close the issue or leave it open — the loop will auto-close it when the drift clears on the next complete scan.

**Marking a proposal superseded:**

Use `status-truth:superseded` when a newer finding or a broader correction makes this specific proposal obsolete, but you want to preserve the history.

1. Apply the `status-truth:superseded` label.
2. Optionally add a comment linking to the replacement issue or correction.
3. Close the issue. The loop treats `superseded` as non-terminal: if the same drift fingerprint returns, the issue will be reopened.

**Workflow summary:** Each run emits aggregate counts by claim kind (opened, updated, reopened, closed, suppressed). No file paths, fingerprints, or claim text appear in workflow logs — evidence lives in the proposal issues after privacy gating.

**Plan-consistency proposals:**

Every plan under `docs/plans/` is checked automatically for consistency between its frontmatter `status` and its implementation-unit checkboxes (`- [x] **Unit N: ...**`). No prose claim is required — the checkboxes are the claim.

The drift rule: a plan marked `active` whose units are all checked gets a proposal to flip its status to `complete`. Everything else is either current or unresolved — unchecked units on a `complete` plan, unsupported status values, and unrecognizable unit markers are all counted as unresolved and never proposed.

Applying `status-truth:rejected` or `status-truth:false-positive` to a plan-consistency proposal permanently exempts that plan from future consistency proposals. Removing or renaming a plan file clears its finding on the next scan; any open proposal for it auto-closes as resolved.

**Correction PRs (currently disarmed):**

`plan-consistency` is the first graduated claim kind, but graduation alone doesn't open PRs — the repository variable and manual dispatch input below still both have to be set.

The Status Truth workflow can, once armed, open a pull request that applies a proposal's correction directly instead of waiting on a human edit. No PR opens today. Three independent, reviewed keys must all be true at once before one can:

1. The repository variable `STATUS_TRUTH_PRS_ENABLED` is set to `true`.
2. At least one claim kind is present in the graduated-kinds set in `scripts/status-truth-prs.ts` — added only via a reviewed code change, never a config toggle.
3. A manual `workflow_dispatch` run explicitly sets the `open_prs` input to `true`. Scheduled runs never open PRs, no matter how the other two keys are set.

Any single key missing produces zero PR actions; eligible findings fall back to proposal-only, same as today.

**Graduation policy:** a claim kind becomes eligible for the graduated set only after it has accumulated at least one explicit `status-truth:accepted` outcome on a real proposal — resolved-positive outcomes count toward this bar but can't satisfy it alone. Graduating a kind is a one-line reviewed code change adding it to the set, made after that evidence exists. A `status-truth:false-positive` outcome on a graduated kind removes it from the set via another reviewed change; re-graduating it later requires fresh accepted signal, not just reverting the removal.

**Execution posture, once armed:**

- At most one new correction PR opens per run; further eligible findings are counted as blocked and stay proposal-only. An already-open PR being rediscovered doesn't consume that slot, so a long-lived PR can't starve other findings.
- Each correction PR touches exactly one file, within the same allowed-path prefixes as proposals. Forbidden paths and privacy-gate failures downgrade to proposal-only, same as the detect step.
- Before any push, the corrected content is re-verified against the live base-branch file, not just the report snapshot — stale drift never gets force-corrected.
- If a fingerprint's drift clears on a complete scan while its correction PR is still open, the bot closes its own PR with a brief comment and deletes the branch. If the linked proposal later gets a terminal label (`status-truth:rejected` or `status-truth:false-positive`), the same closure happens regardless of drift state. Merged PRs are never touched.
- The bot never merges, approves, enables automerge, force-pushes, or retargets a correction PR — closing its own stale PRs and deleting its own branches are the only PR-state mutations it can make. A human always merges.

### Recurring Pattern Proposals

The **Capture Patterns** workflow looks for repeated correction behavior across the accepted learning corpus — `docs/solutions/` entries and `learning-proposal` issues in this repo — and drafts human-reviewed proposals for patterns worth codifying as durable lessons. It never authors or edits `docs/solutions/` directly; every pattern proposal is a decision log entry a human reviews and, if accepted, turns into a doc themselves.

The loop is proposal-only and manual-first: `workflow_dispatch` defaults to dry-run, and there is no scheduled trigger in this initial slice. A dry run plans and drafts candidates but never opens issues or mints an issue-writing token; only an explicit live dispatch (`dry_run: false`) does both.

**Reviewing a proposal:**

Apply exactly one outcome label to record your decision:

| Label | Meaning |
| --- | --- |
| `pattern-proposal:accepted` | Pattern is real and durable; source material is retired from future clustering immediately |
| `pattern-proposal:deferred` | Not yet — needs more independent evidence before reconsideration |
| `pattern-proposal:rejected` | Pattern is not real, or too weak to codify |
| `pattern-proposal:superseded` | A newer proposal replaces this one; permanently suppressed |

A closed proposal without one of these labels is `needs-outcome` — a derived state, not an operator label, that conservatively suppresses re-proposal of the same sources until new independent evidence appears.

**Caps and evidence:** at most three new proposals open per run, ranked by independent source count, accepted-doc presence, and recency. Deterministic scripts own source loading, deduplication, suppression, privacy gating, and issue mutations; the agent only judges evidence and drafts bounded proposal bodies from a curated, privacy-gated digest — it never edits repo files, reads raw solution text, or receives private tokens.

### Cross-Repo Goal Dispatch

Fro Bot coordinates a single goal across multiple owner repos (`fro-bot/*`, `marcusrbrown/*`) through an open → decompose → approve → dispatch → track lifecycle:

1. **Open a goal issue.** Describe a multi-repo goal and mention `@fro-bot`. Label the issue `cross-repo-goal`.
2. **Review the proposed decomposition.** The bot posts a per-repo work-item checklist as a comment. Edit it freely before approving — nothing dispatches yet.
3. **Approve.** Applying the `dispatch-approved` label triggers dispatch. Only an approval applied by the repository owner (the operator) is honored; any other applier has the label removed and nothing runs.
4. **Dispatch.** Each approved item runs as a worker agent in its target repo. Targets are restricted to owner repos already onboarded to Fro Bot's automation.
5. **Track to completion.** A periodic tracker snapshots each item's run outcome to the issue. The issue closes automatically once every item reaches a terminal state (completed, failed, or blocked).

If you need to re-approve after reopening a closed goal issue, reopening automatically clears the prior approval — reapply the `dispatch-approved` label to fire a fresh dispatch.

Each dispatch carries only the universal `prompt` input — no `correlation_id` or other custom input, since target repos are autonomous and only guarantee `prompt`. The correlation id and a per-item nonce ride inside the prompt itself; the worker reports completion by posting a receipt comment on the coordination issue, which a periodic tracker verifies (author, correlation id, and `hash(nonce)`) before resolving the item.

The nonce binds a receipt to its item: the coordination issue stores only `hash(nonce)`, and the raw nonce reaches the worker only through the prompt. One caveat worth stating plainly — a target repo running Fro Bot with `OPENCODE_PROMPT_ARTIFACT` enabled publishes the rendered prompt (raw nonce included) as a downloadable Actions artifact. Where that's set on a target, item-level nonce isolation falls back to trusting that target's worker and its `FRO_BOT_PAT`.

**Why push, not poll.** Tracking used to correlate a dispatched item to its worker run by matching a `correlation_id` against the run name — until target repos turned out to only guarantee a `prompt` input, and GitHub's dispatch API gives you a `204` with no run id back anyway. So the model flipped: the worker already knows how it went, and it already holds a credential that can write back to the coordination issue. The worker posts, a scheduled tracker reads. Tracking never polls PR state or the Actions API for completion; a `pr` URL in a receipt is operator-facing metadata, nothing more.

**The receipt.** When a worker finishes an item — success, no-op, or failure — it posts a comment on the coordination issue containing a delimited region:

```html
<!-- fro-bot:cross-repo-result:start -->
<!-- fro-bot:cross-repo-result {"correlation_id":"...","nonce":"...","status":"success","summary":"...","pr":"..."} -->
<!-- fro-bot:cross-repo-result:end -->
```

`status` is exactly one of `success | noop | failed` — a no-op is a valid, mandatory receipt, not a missing one. The parser prefers the region but tolerates surrounding prose and a trailing run-summary block, same as the goal-decomposition checklist parser; a bot-authored comment that has a marker but botches the fields is `unparseable-receipt`, not silently accepted and not treated the same as no receipt at all.

**Three gates before a receipt moves anything.** All of these have to hold: the comment is authored by `fro-bot`, its `correlation_id` matches a dispatched item, and `hash(nonce)` matches that item's stored `nonceHash`. Author alone isn't enough — every worker shares the same bot identity and correlation ids sit in plain sight on the issue — so a per-item nonce is the real lock. Its hash is the only thing that ever touches the public marker; the raw value only ever appears in that item's dispatch prompt. Reading the marker gets an attacker nothing to forge with. Whichever authentic receipt arrives first, by comment order, is the one that resolves the item, and a resolved item never flips again — which matters because the raw nonce becomes public the moment the real worker posts it, and a later replay of that now-public nonce still can't undo a completed or failed item.

**24h SLA and the "did it even run" question.** An item with no authentic receipt within 24 hours of confirmed dispatch surfaces as `needs-attention` rather than sitting silently dispatched forever. It's reversible — a late, genuine receipt still resolves it — so a slow worker isn't punished for being slow. Because a missing receipt is the most likely failure mode (agents drift off prompt formats more often than you'd like), a diagnostic run-lookup kicks in at that point, purely for operator context: it tags the no-receipt item `dispatch-accepted-no-receipt` by default, or `run-observed-no-receipt` if the Actions API shows a completed correlated run. That lookup never resolves state on its own, and it never claims `never-ran` — a missing run-name correlation is not proof the worker didn't run, just that nothing was observed.

**Receipt accountability is metadata-declared, not prompt-declared.** Whether a missing receipt is a broken contract is an operator-managed capability in `metadata/repos.yaml` (`cross_repo_receipts`, see [`metadata/README.md`](metadata/README.md)), snapshotted onto each item at dispatch time — never inferred from the dispatch prompt and never self-reported by the target. Targets without the capability are `legacy-best-effort`: still dispatchable, and accepted nonce-verified receipts from them still resolve items, but a missing receipt is diagnostic-only, not a broken contract. This distinction exists because #3652, A3's first real cross-repo goal, proved some targets have local response policies (e.g. "post exactly one comment," or treating cross-repo comment instructions as suspicious) that a prompt cannot override — three targets posted accepted receipts, one completed local triage and refused the receipt as prompt-injection-shaped, one completed with no visible receipt. A local-only completion comment or a green Actions run is useful operator signal, but it is never a completion oracle; only an accepted, nonce-verified receipt resolves an item.

**When an item gets stuck wrong.** First-authentic-receipt-wins is a deliberate anti-spoof choice, but it means a bad early receipt (or your own mistake) can lock an item somewhere you don't want it. There's no undo command for that yet — the fix is editing the coordination issue's state marker comment directly to correct the item's status.

**What's still open.** Every worker authenticates with the `FRO_BOT_PAT` available to that target repo, so this is a shared worker-trust design, not per-item authorization. A compromised target worker or PAT can still forge a receipt for any item whose nonce it can obtain. GitHub does not provide an issue-scoped receipt token, and pushing a separate token through the dispatch prompt would only move the leak. Further hardening requires a real target-side policy change or a receipt broker, not control-plane theater.

## Development

### Code Quality Standards

This repository enforces strict quality standards:

- **TypeScript**: Strict mode enabled with comprehensive type checking
- **ESLint**: Custom configuration based on `@bfra.me/eslint-config`
- **Prettier**: Consistent code formatting with 120-character line length
- **Security**: Regular security scanning and vulnerability assessments

### AI Development Guidelines

[`.github/copilot-instructions.md`](.github/copilot-instructions.md) is the canonical guidance for AI coding agents (GitHub Copilot, OpenCode, and others) contributing to this repo. It covers:

- Canonical-context reading order and repository contract
- Required verification commands and quality gates
- High-risk do/don't patterns (package manager, workflow setup, type safety, scope control)
- Security and safety constraints
- Platform-specific notes (GitHub Copilot coding agent, Copilot hooks)

Repo-scoped agent skills live in [`.agents/skills/`](.agents/skills/) for techniques specific to this repository's conventions.

> [!NOTE] These guidelines ensure consistent AI assistant behavior and maintain code quality across the project.

## Resources

**Fro Bot Ecosystem:**

- [Fro Bot Organization](https://github.com/fro-bot) - Main organization page
- [Security Policy](SECURITY.md) - Vulnerability reporting and security guidelines

**Development Tools:**

- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript development
- [ESLint](https://eslint.org/) - JavaScript/TypeScript linting
- [Prettier](https://prettier.io/) - Code formatting
- [Renovate](https://renovatebot.com/) - Automated dependency management

**GitHub Resources:**

- [GitHub Actions](https://docs.github.com/en/actions) - CI/CD workflows
- [Probot](https://probot.github.io/) - GitHub app framework
- [OpenSSF Scorecard](https://securityscorecards.dev/) - Security assessment
