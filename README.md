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
- **pnpm** 11.8.0 (pinned in `packageManager`)
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
│   ├── workflows/          # 23 GitHub Actions workflows (see Automation)
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
| **Poll Invitations** | Accept allowlisted collaboration invitations | Every 15 minutes, dispatch |
| **Reconcile Repos** | Reconcile collaborator access against `metadata/repos.yaml`; dispatch surveys for stale repos; auto-stars collab/contrib repos | Daily 05:17 UTC, dispatch |
| **Survey Repo** | Ingest a repository into the knowledge wiki; dispatched by Reconcile Repos or manually via `gh workflow run survey-repo.yaml -f node_id=<node_id>` | Dispatch (by Reconcile Repos) |
| **Merge Data Branch** | Promote autonomous `data`-branch commits to `main` | Sunday 22:00 UTC, dispatch |
| **Update Metadata** | Refresh `metadata/renovate.yaml` from the fro-bot org scan | Daily 04:30 UTC, dispatch |
| **Dispatch Renovate** | Dispatch Renovate runs across repos tracked in `metadata/renovate.yaml` | Every 4 hours at `:30`, dispatch |
| **Gateway Rollout Tracker** | Track and report on gateway rollout status across managed repos | Schedule, dispatch |
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

To manually re-survey a repo, pass its GitHub GraphQL `node_id` as the dispatch input:

```bash
# Look up the node_id
gh api graphql -f query='query{repository(owner:"<owner>",name:"<repo>"){id}}' --jq '.data.repository.id'

# Dispatch the survey
gh workflow run survey-repo.yaml -f node_id=<node_id>
```

The `node_id` for each tracked repo is stored in `metadata/repos.yaml` on the `data` branch.

### Status-Truth Proposals

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
