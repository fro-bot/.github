---
type: repo
title: "marcusrbrown/containers"
created: 2026-04-18
updated: 2026-06-07
sources:
  - url: https://github.com/marcusrbrown/containers
    sha: e582f856844ac1dd52fc8739f1a9aa8398248e6e
    accessed: 2026-04-18
  - url: https://github.com/marcusrbrown/containers
    sha: fa17128f14da06eb5b6ba0bea8569385857f9b3d
    accessed: 2026-04-21
  - url: https://github.com/marcusrbrown/containers
    sha: 1b782ff8b0a94615492de36f7f9b1d57e4663113
    accessed: 2026-04-22
  - url: https://github.com/marcusrbrown/containers
    sha: 6f8a10145eb743f71896bac881b269e403e5672e
    accessed: 2026-05-25
  - url: https://github.com/marcusrbrown/containers
    sha: 8aeadf737140077d3e976d30d70caee9cd09a885
    accessed: 2026-06-07
tags: [docker, containers, dockerfiles, multi-arch, python, github-actions, ci-cd, security-scanning, ai, ollama, sqlite]
aliases: [containers]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/containers

A container development ecosystem with curated Dockerfiles, Python automation scripts, AI-powered template intelligence, and comprehensive CI/CD for multi-architecture builds. The oldest repo in Marcus's public portfolio (created 2016-12-19), still actively maintained.

## Overview

- **Purpose:** Container collection and automation framework
- **Default branch:** `main`
- **Primary language:** Python
- **Created:** 2016-12-19
- **Last push:** 2026-06-06 (as of 2026-06-07 survey; HEAD `8aeadf73` from 2026-06-06)
- **Topics:** `automation`, `containers`, `docker`, `docker-compose`, `dockerfiles`, `scripts`
- **Registries:** GHCR (`ghcr.io`), Docker Hub (`docker.io/marcusrbrown`, legacy alias `igetgames`)

## Repository Structure

### Active Containers

| Container      | Base Image                              | Size Class | Purpose                        |
| -------------- | --------------------------------------- | ---------- | ------------------------------ |
| `node/alpine`  | `node:24-alpine@sha256:d1b3b4da...` (digest-pinned) | ~70 MB     | Lightweight Node.js 24 runtime |
| `node/release` | `node:24-bookworm-slim@sha256:03eae3e...` (digest-pinned) | ~160 MB    | Full-compat Node.js 24 runtime |

Both variants use multi-architecture build args (`TARGETPLATFORM`, `TARGETARCH`), run as non-root (`node` user), use `tini` as PID 1, and include health checks on `:3000/health`. Node.js version pinned at `22.17.0` via `NODE_VERSION` build arg (note: base image is `node:24` but the `NODE_VERSION` env var reflects `22.17.0` — this reflects the Node.js version embedded in the image, not the major tag). Base image digests are rotated regularly by Renovate.

### Archived Containers

- `archived/parity/` — Ethereum Parity client (branch and release variants). No longer built by CI.

### Template System

A `templates/` directory provides starter Dockerfiles for multiple stacks (entirely excluded from linting, formatting, and CI detection):

- `templates/base/alpine/` — Alpine base with docker-compose
- `templates/apps/nodejs/express/` — Express.js application (TypeScript, with `nodemon.json`, `src/app.ts`, middleware, route structure)
- `templates/apps/python/fastapi/` — FastAPI with docker-compose and requirements.txt
- `templates/databases/postgresql/` — PostgreSQL
- `templates/databases/redis/` — Redis cache with persistence, cluster mode, AOF, configurable eviction policy _(new as of 2026-04-21 survey)_
- `templates/infrastructure/nginx/` — Nginx reverse proxy with SSL, load balancing, gzip, rate limiting, caching _(template.yaml confirmed present)_
- `templates/microservices/go/` — Go microservice with go.mod

Each template has a `template.yaml` manifest defining parameters, files, dependencies, testing, and registry metadata. Corresponding documentation lives in `docs/templates/` with per-template README files.

### Python Automation (`scripts/`)

Poetry-managed Python project (requires Python >=3.13, <3.14). Key scripts exposed as CLI entry points:

| Entry Point | Script | Purpose |
| --- | --- | --- |
| `containers` | `scripts.containers_cli:main` | Main CLI interface (1340 LOC) |
| `generate-dockerfile` | `scripts.generate_dockerfile:main` | Dynamic Dockerfile generation with multi-arch support |
| `collect-docker-metrics` | `scripts.collect_docker_metrics:main` | Build time, image size, registry analytics |
| `generate-image-tags` | `scripts.generate_image_tags:main` | Semantic version tagging from metadata |
| `template-engine` | `scripts.template_engine:main` | Jinja2 template rendering engine |
| `template-testing` | `scripts.template_testing:main` | Template validation and health checks |
| `generate-docs` | `scripts.template_documentation:main` | Documentation generation (2071 LOC) |
| `ai-chat` | `scripts.ai_chat_interface:main` | Interactive AI assistant |
| `ai-analyze` | `scripts.template_intelligence:analyze_project` | AI-powered project analysis |
| `ai-recommend` | `scripts.template_intelligence:recommend_templates` | AI template recommendations |

Non-entrypoint scripts (internal use only):

| Script | Purpose |
| --- | --- |
| `ai_core.py` | Shared AI provider abstraction: Ollama, OpenAI, Anthropic (620 LOC) |
| `build_multiarch.py` | Multi-architecture build orchestration via `docker buildx` (513 LOC) |
| `containers_simple.py` | Simplified container operations (159 LOC) |
| `documentation_ai.py` | AI-enhanced documentation generation (613 LOC) |
| `predictive_maintenance.py` | SQLite-backed usage analytics, template health monitoring, proactive issue detection (987 LOC) |

Runtime dependencies: `openai` (>=2.41.0,<2.42.0), `anthropic` (>=0.30.0,<1.0.0), `jinja2`, `pyyaml`, `jsonschema`, `requests`, `urllib3 >=2.7.0` (security floor).

#### AI Subsystem Architecture

`ai_core.py` provides `AIProvider` — a shared abstraction over three providers:

- **Ollama** (default per `ai_config.yaml`): `llama3.2` (chat), `codellama` (code), `mistral` (analysis) — local inference at `http://localhost:11434`
- **OpenAI**: `gpt-4` for chat/code, `gpt-3.5-turbo` for analysis (disabled by default)
- **Anthropic**: `claude-3-sonnet-20240229` (disabled by default)

AI features include: template recommendation (confidence threshold 0.7), parameter inference (auto-apply at 0.9), code analysis with security scan, natural language (conversation memory, max 20 turns), predictive maintenance (weekly, SQLite analytics retention 365 days), documentation generation, and test generation. Response caching via SQLite with 24h TTL and 100MB cap. `ai_config.yaml` at repo root controls all toggles.

### AI Config Management (Added PR #584, 2026-06-06)

The long-pending Copilot-authored PR #584 ("Add first-class AI configuration scaffold, docs, and CLI init/validation flow") merged at HEAD `8aeadf73`. Key additions:

- **`ai config` subcommand** under the main `containers` CLI entry point:
  - `--init`: copies `ai_config.example.yaml` → `ai_config.yaml` (supports `--overwrite`)
  - `--validate`: validates an existing config against schema and provider connectivity
  - `--file`: specify alternate config path (default: `ai_config.yaml`)
- **`ai_config.example.yaml`** at repo root as canonical reference config
- **Documentation cluster** under `docs/`:
  - `AI_CONFIGURATION.md` — top-level config reference with supported keys
  - `AI_CLI_GUIDE.md` — `poetry run containers ai config` quickstart
  - `AI_VERIFICATION_REPORT.md` — test report from the Copilot SWE agent run

This closes the gap where `ai_config.yaml` had to be created manually from tribal knowledge. The `containers` CLI is now self-bootstrapping for AI feature setup.

### Node.js Layer

Minimal — only Prettier formatting via `@bfra.me/prettier-config/120-proof`. Managed by pnpm 10.34.1.

## Dockerfile Patterns

Both active Dockerfiles follow consistent best practices:

- **Syntax directive:** `# syntax=docker/dockerfile:1.23@sha256:2780b5c3...` with digest pin (Alpine: `sha256:d1b3b4da...`, Bookworm-slim: `sha256:03eae3e...`)
- **Base image pinning:** Full `@sha256:...` digest pins on base images
- **OCI labels:** Follows OCI Image Spec annotations (title, description, version, vendor, source, licenses, base.name, base.digest). CI-injected labels (created, revision, version) are not hardcoded — `docker/metadata-action` handles those.
- **Build cache mounts:** `RUN --mount=type=cache` for package manager caches (`/var/cache/apk` or `/var/cache/apt`, `sharing=locked`)
- **Non-root execution:** Switches to `node` user (UID 1000) before `npm ci`
- **Layer optimization:** Package files copied before source for dependency cache hits
- **Init system:** `tini` for proper signal handling as PID 1
- **Health check:** `curl -f http://localhost:3000/health`
- **Entrypoint script:** `docker-entrypoint.sh` copied with `--chmod=755`
- **Alpine note:** `# NOTE: Alpine repos only serve the latest package version per release. Exact version pins break when repos rotate — the base image digest above is the reproducibility boundary.`

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Build & Publish | `build-publish.yaml` | Push (Dockerfile/scripts paths), PR, dispatch | Multi-arch build + registry push |
| Automated Testing | `test.yaml` | Push/PR to main, dispatch | Pre-commit, container builds, Python tests, linting, security scans |
| Container Scan | `container-scan.yaml` | Push/PR, weekly cron | Trivy vulnerability scanning |
| Dockerfile Generation | `dockerfile_generation.yaml` | dispatch | Automated Dockerfile generation |
| Metrics Collector | `metrics_collector.yaml` | schedule/dispatch | Container metrics collection |
| Release | `release.yaml` | push (tags)/dispatch | Release automation |
| Renovate | `renovate.yaml` | push/PR/dispatch | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | push/schedule/dispatch | Probot settings sync |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule (14:30 UTC daily), dispatch | AI agent for review, triage, autohealing |
| Cache Cleanup | `cache-cleanup.yaml` | PR close/schedule/dispatch | GHA cache management (graceful handling of missing cache keys) |

### Build & Publish Pipeline

The `build-publish.yaml` workflow implements a matrix-based multi-arch build:

1. **Detect Changes** — scans for changed Dockerfiles (excludes `archived/`, `templates/`, `.devcontainer/`)
2. **Build Multi-Arch** — per-container matrix job using `docker/build-push-action` with QEMU for cross-compilation
3. **Platforms:** `linux/amd64` + `linux/arm64`
4. **Registries:** GHCR and Docker Hub (push on main only, not on PRs)
5. **Tagging:** via `docker/metadata-action` — branch ref, PR ref, short SHA, `latest`
6. **Caching:** GitHub Actions cache (`type=gha`)
7. **Manual dispatch inputs:** `platforms` (default: `linux/amd64,linux/arm64`) and `push_images` (default: true)

### Test Pipeline

The `test.yaml` workflow runs:

1. **Pre-commit Checks** — `pre-commit run --all-files`
2. **Prepare** — file change detection via `dorny/paths-filter`
3. **Detect Containers** — finds changed Dockerfiles for test builds
4. **Container Builds** — matrix build + basic inspection (amd64 only, no push)
5. **Python Script Testing** — module import validation, Poetry entry point `--help` checks, `poetry check`
6. **Code Quality & Linting** — Hadolint (Dockerfile), Black (Python), isort, pylint, Prettier
7. **Security Scan** — Trivy vulnerability + config scanning with SARIF upload

### Branch Protection

Required status checks on `main`: Code Quality & Linting, Container Scan, Detect Changed Containers, Fro Bot, Pre-commit Checks, Prepare, Python Script Testing, Renovate, Security Scanning, Test Container Builds. Linear history enforced, admin enforcement enabled, no required PR reviews.

### Action Pinning

All GitHub Actions are SHA-pinned with version comments. Key actions (as of 2026-04-21):

- `actions/checkout` — `v6.0.2` (SHA `de0fac2e...`)
- `actions/setup-python` — `v6.2.0` (SHA `a309ff8b...`)
- `actions/setup-node` — `v6.4.0` _(bumped 2026-04-20)_
- `docker/build-push-action` — `v6.19.2`
- `docker/setup-buildx-action` — `v3.12.0`
- `docker/metadata-action` — `v5.10.0`
- `dorny/paths-filter` — `v3.0.2` (SHA `de90cc6f...`)
- `aquasecurity/trivy-action` — `0.35.0`
- `fro-bot/agent` — `v0.55.0` (SHA `f73a3e59...`) _(jumped v0.40.0 → v0.41.0 → v0.43.0 → v0.44.0 → v0.55.0)_
- `dorny/paths-filter` — `v4.0.1` (SHA `fbd0ab8f...`) _(bumped from v3.0.2, PR #607)_

## Fro Bot Integration

**Fro Bot workflow present** (`fro-bot.yaml`). Uses `fro-bot/agent@v0.55.0` (SHA `f73a3e59...`) with:

- **PR Review:** Container-specific review prompt focusing on Dockerfile best practices, multi-arch correctness, Python quality, Actions security, and breaking changes. Structured verdict format (PASS/CONDITIONAL/REJECT). Black/isort/Prettier style nits explicitly excluded.
- **Daily Schedule (14:30 UTC):** Autohealing routine — fixes errored PRs, addresses security alerts, updates major dependency versions, ensures linting consistency. Manages a single perpetual "Daily Autohealing Report" issue instead of creating new daily issues.
- **Auth:** `FRO_BOT_PAT` secret, `OPENCODE_AUTH_JSON`, model from `FRO_BOT_MODEL` var, plus `OMO_PROVIDERS` and `OPENCODE_CONFIG` secrets _(`OMO_PROVIDERS`/`OPENCODE_CONFIG` added 2026-04-17)_.
- **Concurrency:** per-issue/PR/discussion, no cancellation of in-progress runs.
- **Filters:** Skips bot-authored PRs/issues, requires `@fro-bot` mention for comments (OWNER/MEMBER/COLLABORATOR only).
- **AGENTS.md present** at repo root, `.github/workflows/AGENTS.md`, and `scripts/AGENTS.md` — comprehensive agent guidance for Dockerfile style, Python patterns, YAML style, GitHub Actions pinning, and anti-patterns.

## Developer Tooling

- **Poetry:** Build system (`poetry-core>=2.0.0,<3.0.0`), dev deps include `pytest ^9.0`, `pytest-cov ^7.0`, `pytest-mock ^3.0`, `black >=26.3.1`, `isort ^8.0`, `pylint ^4.0`, `yamllint ^1.0`.
- **Black:** line-length 88, target Python 3.13, excludes `templates/`.
- **isort:** Black-compatible profile.
- **Prettier:** `@bfra.me/prettier-config/120-proof` via pnpm 10.34.1.
- **Pre-commit:** Run via CI, includes all Python and Dockerfile linting.
- **Hadolint:** Dockerfile linting with SARIF output.
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.0`. Ignores `templates/`, constrains Python to 3.13.x, disables lockfile maintenance and patch updates (except TypeScript and Python). Post-upgrade runs `pnpm install && pnpm format`. Rebase when behind base branch.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml`.
- **DevContainer:** Docker-in-Docker setup with mise tool management.
- **mise:** Polyglot tool version manager. Pinned: Node.js 24.16.0, pnpm 10.34.1, Poetry latest, pre-commit latest, Python 3.13. Venv auto-created at `.venv`.
- **Tests:** `tests/test_dockerfile_policy.py` — Dockerfile policy validation. Known issue: policy tests intentionally fail against current state (tracking issue).

## Notable Patterns

- **Digest-pinned everything:** Base images, Dockerfile syntax directive, and all GitHub Actions use SHA/digest pins for reproducibility.
- **OCI label contract:** Clear separation between CI-injected labels (via `docker/metadata-action`) and static Dockerfile labels. Deprecated `org.label-schema.*` labels explicitly removed.
- **Archived containers excluded from CI:** `archived/` directory is filtered out of all build, test, and scan workflows.
- **Template system:** A dual `templates/` + `docs/templates/` structure provides both runnable Dockerfiles and documentation for each stack template. Templates are excluded from linting, formatting, CI detection, yamllint, Prettier, and dockerfilelint — they are intentionally standalone.
- **AI-powered tooling:** CLI includes LLM-backed commands (Ollama preferred locally, OpenAI and Anthropic as cloud fallbacks) for template recommendations, project analysis, interactive chat, and predictive maintenance with SQLite-backed analytics.
- **Shared infrastructure:** Uses the same `@bfra.me/*` configs, `marcusrbrown/renovate-config`, and `fro-bot/.github:common-settings.yaml` as other Marcus repos (cf. [[marcusrbrown--ha-config]]).
- **Anti-pattern documentation:** AGENTS.md files explicitly list anti-patterns (do not hardcode OCI `created`/`revision` labels, do not touch `archived/`, do not run linters against `templates/`).
- **Reproducibility boundary philosophy:** Comments in Dockerfiles explain that the base image digest is the reproducibility boundary, not individual package versions — Alpine and Debian repos rotate package versions, making pin-by-version fragile.

## Change History (Surveys)

| Date | SHA | Notable Changes |
| --- | --- | --- |
| 2026-04-18 | `e582f856` | Initial survey. Agent `v0.40.0`, `fro-bot.yaml` PR review + daily autohealing confirmed. |
| 2026-04-21 | `fa17128f` | Agent bumped to `v0.41.0`. `actions/setup-node` bumped to v6.4.0. `OMO_PROVIDERS`/`OPENCODE_CONFIG` secrets added to Fro Bot job. Node.js base images digest-rotated. `predictive_maintenance.py` (987 LOC, SQLite analytics) and `ai_core.py` Ollama support documented. Redis template (`templates/databases/redis/`) confirmed present. AGENTS.md coverage at root, workflows, and scripts directories. `pytest` updated (CVE-2025-71176). |
| 2026-04-22 | `1b782ff8` | Incremental re-survey. Multiple base image digest rotations via Renovate (#587–#590). Cache cleanup workflow fix: gracefully handle missing cache keys (#585). Node Alpine base image now `sha256:d1b3b4da...`, Bookworm-slim `sha256:03eae3e...`. No structural changes to repo, workflows, or Python automation layer. |
| 2026-05-25 | `6f8a1014` | Incremental re-survey. **Renovate preset crossed v4 → v5 boundary** (`marcusrbrown/renovate-config#5.2.0`, #608, 2026-05-20) — aligns with [[marcusrbrown--renovate-config]] v5 ecosystem migration. **Fro Bot agent advanced four releases:** v0.41.0 → v0.42.1 → v0.43.0 → v0.44.0 (#591, #603, #609). **`docker/dockerfile` syntax directive bumped to v1.24** (#604, 2026-05-13). **urllib3 CVE patch:** explicit `urllib3 >=2.7.0` added to `pyproject.toml` (#602, 2026-05-13). **`openai` dependency tracked aggressively:** bumped through 2.33.0 → 2.34.0 → 2.35.1 → 2.36.0 across May (#592, #594, #595, #597). **Renovate postUpgradeTasks now includes `poetry lock`** (#596, 2026-05-14) — keeps the Poetry lockfile in sync after dependency bumps, previously a manual step. Express template/runtime versions pinned and redundant `argparse` dep removed (#582, 2026-04-29). Continuous Node.js base image digest rotation cadence (#599–#618). Open Renovate PRs in flight: `dorny/paths-filter` v4 (#607) and a non-major bundle (#614). No structural changes to repo layout, workflows, Python automation, or AI subsystem. |
| 2026-06-07 | `8aeadf73` | Incremental re-survey. **AI config scaffold merged** (PR #584, 2026-06-06): long-pending Copilot SWE-agent PR lands first-class `containers ai config --init/--validate` CLI subcommand, `ai_config.example.yaml`, and three doc files (`AI_CONFIGURATION.md`, `AI_CLI_GUIDE.md`, `AI_VERIFICATION_REPORT.md`). **Security fix** (PR #620, 2026-06-06): qs 6.15.2, express 4.22.2, idna 3.17 patched in Express and Python template deps. **Fro Bot agent jumped v0.44.0 → v0.55.0** (#630). **dorny/paths-filter bumped v3 → v4** (#607). **pnpm 10.34.1** (#622). **Node.js 24.16.0** (mise.toml). **openai >=2.41.0** (#628). Continuous Node.js/Debian base image digest rotation cadence. Open issues: 6 (Dep Dashboard #415, Daily Autohealing #533, Tech Debt test coverage #555, Copilot pytest PR #583, two Renovate dev-dependency pin PRs #611/#612). |

## Delta — 2026-06-07 Survey

Key state confirmed at HEAD `8aeadf73`:

- **Fro Bot workflow:** `fro-bot/agent@v0.55.0` (SHA `f73a3e59...`), same 14:30 UTC daily schedule, same structured PR review prompt (Verdict / Blocking / Non-blocking / Missing tests / Risk assessment), same autohealing categories (errored PRs, security, health & maintenance, DX), and same single perpetual "Daily Autohealing Report" issue strategy.
- **Renovate config:** Extends `marcusrbrown/renovate-config#5.2.0` (unchanged from prior survey). `postUpgradeTasks` runs `poetry lock && pnpm install && pnpm format`. Reusable workflow pinned at `bfra-me/.github@65caa6a021ae4a6597bd915f276e1ab9d75dc071` (v4.16.0 — **behind** the ecosystem median of v4.16.23+; possible drift candidate).
- **Toolchain (`mise.toml`):** Node 24.16.0 (up from 24.15.0), pnpm 10.34.1 (up from 10.33.0), Poetry latest, pre-commit latest, Python 3.13. `.venv` auto-created.
- **Python deps (`pyproject.toml`):** `openai >=2.41.0,<2.42.0` (up from 2.36.0), `anthropic >=0.30.0,<1.0.0`, `urllib3 >=2.7.0` (security floor), `pyyaml >=6.0.2,<7.0.0`, `requests >=2.33.0,<3.0.0`, `jinja2 >=3.0.0,<4.0.0`, `jsonschema >=4.0.0,<5.0.0`. Dev deps unchanged.
- **Poetry script entry points:** Stable at 10 entry points — no additions from the PR #584 AI config subcommand (implemented as a subcommand under the existing `containers` entry point, not a new top-level entry point).
- **Workflows (11 total):** Same set — `build-publish`, `cache-cleanup`, `container-scan`, `dockerfile_generation`, `fro-bot`, `metrics_collector`, `release`, `renovate`, `test`, `update-repo-settings`, plus `.github/workflows/AGENTS.md`.
- **Open PRs:** 3 total. Copilot pytest coverage PR #583 still pending (was pending since 2026-04-18). Two mrbro-bot Renovate dev-dependency pin PRs #611/#612 open.
- **Open issues:** 6. Daily Autohealing Report #533, Dependency Dashboard #415, tech debt test coverage #555, and the two open PRs reflected as issues.
- **Security remediation (PR #620, 2026-06-06):** qs 6.15.2, express 4.22.2, and idna 3.17 security updates applied. These affect the Express.js template and Python deps respectively — template security hygiene, not the core container runtime.

No contradictions with prior surveys. Repository structure, container variants (node/alpine, node/release), template system, AI subsystem architecture, Dockerfile patterns, CI pipeline, and branch protection are all unchanged. Active surface area since prior survey: Renovate-driven dependency hygiene (Node.js base digests, openai tracking, pnpm/Node bumps), the Fro Bot agent v4→v5 major jump (#630), the merged AI config CLI scaffold (PR #584), and the security patch (PR #620).

## Delta — 2026-05-25 Survey

Key state confirmed at HEAD `6f8a1014`:

- **Fro Bot workflow:** `fro-bot/agent@v0.44.0` (SHA `b030b53b...`), same 14:30 UTC daily schedule, same structured PR review prompt (Verdict / Blocking / Non-blocking / Missing tests / Risk assessment) and autohealing categories (errored PRs, security, health & maintenance, DX). Single perpetual "Daily Autohealing Report" issue still the persistence pattern.
- **Renovate config (`renovate.json5`):** Extends `marcusrbrown/renovate-config#5.2.0`. `postUpgradeTasks` now runs `poetry lock && pnpm install && pnpm format` (the `poetry lock` step is the new piece). Python pinned `>=3.13,<3.14`. `templates/` still ignored. Patch updates disabled except for TypeScript and Python. `aquasecurity/trivy-action` uses `github-releases` versioning.
- **Toolchain (`mise.toml`):** Unchanged — Node 24.15.0, pnpm 10.33.0, Poetry latest, pre-commit latest, Python 3.13. `.venv` auto-created.
- **Python deps (`pyproject.toml`):** `openai >=2.36.0,<2.37.0`, `anthropic >=0.30.0,<1.0.0`, `urllib3 >=2.7.0` (security floor), `pyyaml`, `requests`, `jinja2`, `jsonschema`. Dev: `pytest ^9.0`, `pytest-cov ^7.0`, `black >=26.3.1`, `isort ^8.0`, `pylint ^4.0`, `yamllint ^1.0`. Build system `poetry-core>=2.0.0,<3.0.0`.
- **Poetry script entry points:** Stable since prior survey — 10 entry points (`containers`, `generate-dockerfile`, `collect-docker-metrics`, `generate-image-tags`, `template-engine`, `template-testing`, `generate-docs`, `ai-chat`, `ai-analyze`, `ai-recommend`).
- **Workflows (11 total):** Same set as prior survey — `build-publish`, `cache-cleanup`, `container-scan`, `dockerfile_generation`, `fro-bot`, `metrics_collector`, `release`, `renovate`, `test`, `update-repo-settings`, plus the workflows-level `AGENTS.md` reference doc.
- **Open PRs:** 6 total. Notable: copilot-swe-agent PRs #583 (pytest coverage for AI/template/CLI/predictive-maintenance modules) and #584 (first-class AI configuration scaffold + CLI init/validation flow) have been pending since 2026-04-18 — both touch the AI subsystem documented above and remain unmerged.

No contradictions with prior surveys. Repository structure, container variants, template system, AI subsystem architecture, Dockerfile patterns, CI pipeline, branch protection, and developer tooling all unchanged from the 2026-04-22 survey. Active surface area for the period was: Renovate-driven dependency hygiene (Node.js base digests, openai, Debian base digests), the v4→v5 Renovate preset boundary crossing, and the Fro Bot agent version cadence.
