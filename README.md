<div align="center">

<img src="./assets/banner.svg" alt="Fro Bot .github Banner" width="100%" />

# Fro Bot .github Repository

> Community health files and automated control center for the AI-powered GitHub bot

[![Build Status](https://img.shields.io/github/actions/workflow/status/fro-bot/.github/main.yaml?branch=main&style=for-the-badge&label=Build&labelColor=0D0216&color=00BCD4)](https://github.com/fro-bot/.github/actions?query=workflow%3Amain) [![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/fro-bot/.github/badge?style=for-the-badge&labelColor=0D0216&color=E91E63)](https://securityscorecards.dev/viewer/?uri=github.com/fro-bot/.github) [![License](https://img.shields.io/badge/License-MIT-FFC107?style=for-the-badge&labelColor=0D0216&color=FFC107)](LICENSE.md)

[Overview](#overview) · [Features](#features) · [Branding](#branding) · [Getting Started](#getting-started) · [Repository Structure](#repository-structure) · [Development](#development)

</div>

## Overview

Fro Bot is an AI-powered GitHub bot designed to enhance repository management through intelligent automation. This repository serves as the foundational control center containing community health files, shared configurations, and automation workflows that power Fro Bot's functionality across all managed repositories.

**What Fro Bot Does:**

- Reviews pull requests and provides intelligent feedback
- Monitors repository activity and offers insights and recommendations
- Maintains documentation and keeps links up to date
- Automatically stars repositories contributed to by followed users
- Enforces consistent repository settings and security policies

## Features

🤖 **AI-Powered Automation**

- Intelligent pull request reviews with contextual feedback
- Automated documentation maintenance and link verification
- Smart repository monitoring with actionable insights

🔧 **Repository Management**

- Centralized community health files (README, SECURITY, CODEOWNERS)
- Automated repository settings synchronization via Probot
- Consistent development environment configuration

🚀 **CI/CD Integration**

- Comprehensive GitHub Actions workflows for quality assurance
- Automated dependency management with Renovate
- Security scanning with CodeQL and OpenSSF Scorecard

⚙️ **Development Standards**

- Strict TypeScript configuration with comprehensive linting
- Automated code formatting and style enforcement
- AI development guidelines and best practices

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

- **Node.js** (version 20 or higher)
- **pnpm** (version 10.15.0 or higher)
- **Git** for version control

### Local Development

1. **Clone the repository:**

   ```bash
   git clone https://github.com/fro-bot/.github.git
   cd .github
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Run quality checks:**

   ```bash
   # Type checking
   pnpm check-types

   # Linting
   pnpm lint

   # Code formatting
   pnpm check-format
   ```

4. **Auto-fix issues:**

   ```bash
   # Fix linting issues
   pnpm fix

   # Format code
   pnpm format
   ```

> [!TIP] This repository follows strict development standards. Make sure to run quality checks before committing changes.

## Repository Structure

```text
.github/
├── .github/                 # GitHub-specific configurations
│   ├── workflows/          # GitHub Actions workflows
│   │   ├── apply-branding.yaml  # Brand template automation
│   │   ├── fro-bot.yaml         # Core Fro Bot agent workflow
│   │   └── ...                  # Other workflows
│   ├── actions/            # Custom GitHub Actions
│   ├── settings.yml        # Repository settings via Probot
│   └── renovate.json5      # Dependency management config
├── assets/                 # Brand assets
│   ├── banner.svg          # This repo's social banner (1280×640)
│   ├── banner-template.svg # Parametric SVG template
│   ├── fro-bot.png         # Brand avatar
│   └── styleguide.md       # Complete design system
├── branding/               # Branding templates
│   ├── README-template.md  # Skeleton README
│   └── tokens.css          # CSS design tokens
├── workflow-templates/     # Reusable workflow templates
├── common-settings.yaml    # Shared repository settings
├── .cursorrules           # AI development guidelines
├── eslint.config.ts       # Linting configuration
├── tsconfig.json          # TypeScript configuration
└── package.json           # Project metadata and scripts
```

### Key Configuration Files

| File                                               | Purpose                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| [`common-settings.yaml`](common-settings.yaml)     | Template for repository settings across all Fro Bot projects |
| [`.cursorrules`](.cursorrules)                     | Comprehensive AI development rules and standards             |
| [`eslint.config.ts`](eslint.config.ts)             | Code quality and style enforcement rules                     |
| [`.github/renovate.json5`](.github/renovate.json5) | Automated dependency management configuration                |

## Automation

### GitHub Actions Workflows

| Workflow           | Purpose                                       | Trigger            |
| ------------------ | --------------------------------------------- | ------------------ |
| **Main**           | Linting, type checking, and quality assurance | PR, push to main   |
| **CodeQL**         | Security vulnerability analysis               | PR, push, schedule |
| **Renovate**       | Automated dependency updates                  | Schedule           |
| **Scorecard**      | Security posture assessment                   | Push to main       |
| **Apply Branding** | Apply brand template to any Fro Bot repo      | Manual dispatch    |

> [!NOTE] The Fro Bot PR-review workflow triggers on `ready_for_review` and `review_requested` to reduce duplicate runs. For ad hoc reviews outside those events, mention `@fro-bot` in the PR conversation.

### Repository Settings Management

Fro Bot uses [Probot Settings](https://probot.github.io/apps/settings/) to automatically synchronize repository configurations across all managed repositories. The settings ensure consistent:

- Branch protection rules
- Required status checks
- Security policies
- Collaboration settings

## Development

### Code Quality Standards

This repository enforces strict quality standards:

- **TypeScript**: Strict mode enabled with comprehensive type checking
- **ESLint**: Custom configuration based on `@bfra.me/eslint-config`
- **Prettier**: Consistent code formatting with 120-character line length
- **Security**: Regular security scanning and vulnerability assessments

### AI Development Guidelines

The [`.cursorrules`](.cursorrules) file contains comprehensive guidelines for AI-assisted development, including:

- Project-specific architecture rules
- Technology stack preferences
- Quality validation strategies
- Automation and maintenance procedures

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
