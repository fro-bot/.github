# Copilot Instructions for Fro Bot .github Repository

## Project Overview

This is the foundational `.github` repository for Fro Bot, an AI-powered GitHub bot ecosystem. It serves as the automated control center containing community health files, shared configurations, and workflows that power repository management across all Fro Bot projects.

## Architecture & Key Components

### Repository Structure
- **Community Health Files**: Centralized README, SECURITY, LICENSE, CODEOWNERS
- **Automation Hub**: GitHub Actions workflows, custom actions, and Probot settings
- **Configuration Templates**: Shared ESLint, TypeScript, and Renovate configurations
- **Development Standards**: AI development guidelines in `.cursorrules`

### Core Configuration Pattern
All configuration extends from `@bfra.me/*` packages:
- TypeScript: `@bfra.me/tsconfig` with strict mode
- ESLint: `@bfra.me/eslint-config`
- Prettier: `@bfra.me/prettier-config/120-proof` (120 char limit)

## Development Workflows

### Essential Commands
```bash
# Quality check pipeline (run before commits)
pnpm check-types    # TypeScript strict checking
pnpm lint          # ESLint validation
pnpm check-format  # Prettier formatting check

# Auto-fix workflow
pnpm fix           # Auto-fix linting issues
pnpm format        # Auto-format code

# Bootstrap (not npm install)
pnpm bootstrap     # Installs with --prefer-offline --loglevel warn
```

### GitHub Actions Setup Pattern
All workflows use the custom setup action at `.github/actions/setup/action.yaml`:
- Installs mise for tool version management
- Configures pnpm cache with monthly rotation
- Runs `pnpm bootstrap` for dependency installation

## TypeScript Patterns & Standards

### Type Safety Rules
- **Avoid ES6 classes** - Use functions and interfaces instead
- **No `any` types** - Use `unknown` for uncertain types, leverage built-in utilities
- **Explicit return types** required for all functions
- **Const assertions** for fixed values: `as const`

### Utility Type Usage
```typescript
// Prefer built-in utility types
type UserUpdate = Partial<User>           // Not custom partial interface
type UserName = Pick<User, 'name'>        // Not extracting manually
type UserNoId = Omit<User, 'id'>          // Not custom exclusion

// Use const assertions for fixed data
const CONFIG_KEYS = ['api', 'cache'] as const
type ConfigKey = typeof CONFIG_KEYS[number]
```

### Documentation Standards
- **JSDoc for public APIs** with `@param`, `@returns`, `@throws`
- **Comments explain "why"** not "what" - focus on business logic reasoning
- **Meaningful error messages** with context and actionable guidance

### Testing with Vitest
- Leverage Vitest's type-checking support
- Use `expectTypeOf` for type assertions in tests
- Prefer `unknown` over `any` in test mocks

### Logging Standards
```typescript
// Use consola instead of console
import { consola } from 'consola'

consola.info('Repository settings updated')    // Not console.log
consola.error('Failed to sync settings', err)  // Not console.error
```

## Automation & Integration Patterns

### Renovate Configuration
- Extends `github>bfra-me/renovate-config#v4.1.1`
- Disables patch updates except TypeScript/Python
- Groups GitHub Actions (except @bfra-me scope)
- Auto-merges during non-office hours

### Repository Settings Management
Uses Probot Settings app to sync `common-settings.yaml` across all repositories:
- Branch protection rules
- Required status checks
- Security policies
- Collaboration settings

### Workflow Triggers
- **Main workflow**: PR events + push to main + manual dispatch
- **CodeQL**: PR, push, scheduled security scans
- **Renovate**: Scheduled dependency updates
- **Scorecard**: Push to main for security assessment

## Project-Specific Conventions

### Package Manager
- **Always use pnpm** (v10.15.0+), never npm/yarn
- **Frozen lockfile** enforced in CI
- **Bootstrap script** for installation with specific flags

### File Naming & Organization
- Configuration files at root level
- GitHub-specific configs in `.github/`
- Shared templates in `workflow-templates/`
- Assets organized in `assets/`

### Dependency Management
- Scope: `@fro-bot` for internal packages
- External configs from `@bfra.me/*` ecosystem
- Security scanning via OpenSSF Scorecard
- Automated updates via Renovate with approval gates

### AI Development Guidelines
Reference `.cursorrules` for comprehensive AI assistant behavior:
- Generate strict TypeScript with proper imports
- Preserve existing formatting and patterns
- Update documentation alongside code changes
- Consider monorepo context and package boundaries
