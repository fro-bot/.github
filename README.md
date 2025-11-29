# Fro Bot .github Repository

<p align="center">
  <img src="./assets/fro-bot.png" alt="Fro Bot" height="128" />
</p>

<p align="center">
  Community health files and automated control center for the AI-powered GitHub bot
</p>

<p align="center">
  <a href="https://github.com/fro-bot/.github/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/fro-bot/.github?sort=semver&style=for-the-badge&logo=github&label=release" /></a>
  <a href="https://github.com/fro-bot/.github/actions?query=workflow%3Amain"><img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/fro-bot/.github/main.yaml?branch=main&style=for-the-badge&logo=github-actions&logoColor=white&label=build" /></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/fro-bot/.github"><img alt="OpenSSF Scorecard" src="https://api.securityscorecards.dev/projects/github.com/fro-bot/.github/badge?style=for-the-badge" /></a>
  <a href="LICENSE.md"><img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" /></a>
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#repository-structure">Repository Structure</a> •
  <a href="#development">Development</a>
</p>

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

>
> [!TIP] This repository follows strict development standards. Make sure to run quality checks before committing changes.

## Repository Structure

```text
.github/
├── .github/                 # GitHub-specific configurations
│   ├── workflows/          # GitHub Actions workflows
│   ├── actions/            # Custom GitHub Actions
│   ├── settings.yml        # Repository settings via Probot
│   └── renovate.json5      # Dependency management config
├── assets/                 # Project assets (logos, images)
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

| Workflow      | Purpose                                       | Trigger            |
| ------------- | --------------------------------------------- | ------------------ |
| **Main**      | Linting, type checking, and quality assurance | PR, push to main   |
| **CodeQL**    | Security vulnerability analysis               | PR, push, schedule |
| **Renovate**  | Automated dependency updates                  | Schedule           |
| **Scorecard** | Security posture assessment                   | Push to main       |

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

>
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
