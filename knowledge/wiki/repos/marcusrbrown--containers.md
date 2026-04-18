---
type: repo
title: "marcusrbrown/containers"
created: 2026-04-18
updated: 2026-04-18
sources:
  - url: https://github.com/marcusrbrown/containers
    sha: e582f856844ac1dd52fc8739f1a9aa8398248e6e
    accessed: 2026-04-18
tags: [docker, containers, dockerfiles, multi-arch, python, github-actions, ci-cd, automation]
aliases: [containers]
related:
  - marcusrbrown--ha-config
---

# marcusrbrown/containers

Container development ecosystem with Dockerfiles, Python automation scripts, AI-powered template tooling, and multi-architecture CI/CD pipelines. Published to both GHCR and Docker Hub.

## Overview

- **Purpose:** Curated Dockerfiles with automation framework for generation, metrics, tagging, and AI-assisted containerization
- **Default branch:** `main`
- **Language:** Python (primary), plus Node.js tooling
- **Created:** 2016-12-19
- **Last push:** 2026-04-17
- **License:** MIT
- **Topics:** `automation`, `containers`, `docker`, `docker-compose`, `dockerfiles`, `scripts`
- **Docker Hub:** [hub.docker.com/u/igetgames](https://hub.docker.com/u/igetgames/)

## Repository Structure

### Active Containers

| Path            | Description                            |
| --------------- | -------------------------------------- |
| `node/alpine/`  | Alpine Linux Node.js image (~70MB)     |
| `node/release/` | Debian Bookworm Node.js image (~160MB) |

### Archived Containers

| Path                       | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `archived/parity/branch/`  | Ethereum Parity client (dev builds from branches) |
| `archived/parity/release/` | Ethereum Parity client (stable releases)          |

Archived containers are excluded from CI builds, scans, and Renovate.

### Templates

The `templates/` directory contains Dockerfile template categories:

- `apps` — Application templates
- `base` — Base image templates
- `databases` — Database templates
- `infrastructure` — Infrastructure templates
- `microservices` — Microservice templates

Templates are excluded from CI builds and Renovate path filters.

### Python Scripts

The `scripts/` directory contains the automation framework (15 modules), exposed as Poetry CLI entry points:

| Entry Point              | Script                      | Purpose                                               |
| ------------------------ | --------------------------- | ----------------------------------------------------- |
| `containers`             | `containers_cli.py`         | Main CLI (includes AI subcommands)                    |
| `generate-dockerfile`    | `generate_dockerfile.py`    | Dynamic Dockerfile generation with multi-arch support |
| `collect-docker-metrics` | `collect_docker_metrics.py` | Build time, image size, and registry analytics        |
| `generate-image-tags`    | `generate_image_tags.py`    | Metadata-based semantic tagging                       |
| `template-engine`        | `template_engine.py`        | Template rendering engine                             |
| `template-testing`       | `template_testing.py`       | Template validation                                   |
| `generate-docs`          | `template_documentation.py` | Documentation generation                              |
| `ai-chat`                | `ai_chat_interface.py`      | Interactive AI assistant                              |
| `ai-analyze`             | `template_intelligence.py`  | Project analysis and template recommendations         |
| `ai-recommend`           | `template_intelligence.py`  | AI template recommendations                           |

Additional modules without CLI entry points: `ai_core.py`, `build_multiarch.py`, `containers_simple.py`, `documentation_ai.py`, `predictive_maintenance.py`.

### AI Integration

The AI features depend on `openai>=2.32.0,<2.33.0` and `anthropic>=0.30.0,<1.0.0`. Capabilities include template recommendations, project analysis, automated parameter inference, code review, documentation generation, and predictive maintenance.

### Documentation

| File                             | Purpose                         |
| -------------------------------- | ------------------------------- |
| `docs/AI_CLI_GUIDE.md`           | Complete AI feature guide       |
| `docs/AI_VERIFICATION_REPORT.md` | AI verification report          |
| `docs/CI_BUILD_FIXES.md`         | CI build troubleshooting        |
| `docs/MULTI_ARCH.md`             | Multi-architecture build guide  |
| `AGENTS.md`                      | AI agent development guidelines |
| `TEMPLATE_SYSTEM_README.md`      | Template system documentation   |

## CI/CD Pipeline

### Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Build and Publish | `build-publish.yaml` | Push (Dockerfile/scripts changes), PR, dispatch | Multi-arch container builds to GHCR + Docker Hub |
| Container Security Scan | `container-scan.yaml` | Push, PR, weekly cron | Trivy vulnerability scanning (fs scan), SARIF upload |
| Automated Testing | `test.yaml` | Push/PR to `main`, dispatch | Pre-commit, container builds, Python tests, linting, security scans |
| Dockerfile Generation | `dockerfile_generation.yaml` | — | Automated Dockerfile generation |
| Metrics Collector | `metrics_collector.yaml` | — | Performance metrics collection |
| Release | `release.yaml` | — | Release automation |
| Cache Cleanup | `cache-cleanup.yaml` | — | GHA cache management |
| Fro Bot | `fro-bot.yaml` | PR, issue, comment, schedule, dispatch | AI-powered PR review, triage, daily autohealing |
| Renovate | `renovate.yaml` | — | Dependency updates |
| Update Repo Settings | `update-repo-settings.yaml` | — | Probot settings sync |

### Build Pipeline (build-publish.yaml)

The build pipeline uses a **change-detection matrix strategy**:

1. `detect-changes` job finds modified Dockerfiles (excluding `archived/`, `templates/`, `.devcontainer/`, `.github/`)
2. `build-multiarch` job runs per changed container with:
   - QEMU emulation for `linux/amd64` + `linux/arm64`
   - Docker Buildx with GHA cache
   - `docker/metadata-action` for OCI-compliant tagging (branch, PR, SHA, latest)
   - Push to both GHCR (`ghcr.io/marcusrbrown/{image}`) and Docker Hub (`marcusrbrown/{image}`)
   - Tag validation to prevent malformed tags

### Test Pipeline (test.yaml)

Multi-job pipeline with path-based filtering:

1. **Pre-commit Checks** — Always runs (`pre-commit run --all-files`)
2. **Prepare** — `dorny/paths-filter` detects relevant changes (Python, Dockerfile, YAML)
3. **Detect Containers** — Finds changed container directories for matrix testing
4. **Container Builds** — Buildx build per container (amd64 only, no push)
5. **Python Tests** — Import validation, pytest, entry point verification, `poetry check`
6. **Linting** — Hadolint (Dockerfiles), Black + isort (Python), pylint, Prettier (Node.js)
7. **Security Scan** — Trivy image scan + config scan per container, SARIF upload

### Security

- **Trivy** scans both built images and filesystem configs, uploads SARIF to GitHub Security tab
- **Hadolint** lints Dockerfiles with SARIF output
- SHA-pinned GitHub Actions throughout all workflows
- `contents: read` default permissions with scoped escalation (`security-events: write`)

### OCI Label Policy

Images follow [OCI Image Spec annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md):

- CI-injected labels (via `docker/metadata-action`): `created`, `revision`, `version`
- Dockerfile-defined labels: `title`, `description`, `vendor`, `source`, `licenses`, `base.name`, `base.digest`
- Deprecated `org.label-schema.*` labels have been removed

## Developer Tooling

- **mise.toml:** Node.js 24.15.0, pnpm 10.33.0, Poetry (latest), pre-commit (latest), Python 3.13
- **Poetry:** Build system (`poetry-core>=2.0.0`). Python `>=3.13,<3.14`. Dev deps: pytest, pytest-cov, pytest-mock, black, isort, pylint, yamllint
- **pnpm + package.json:** Prettier formatting via `@bfra.me/prettier-config/120-proof`
- **Pre-commit:** Configured via `.pre-commit-config.yaml` (runs in CI as first test job)
- **Linting:** Black (line-length 88, py313), isort (black profile), pylint, Hadolint, yamllint, Prettier
- **Renovate:** Extends `marcusrbrown/renovate-config#4.5.0`. Python pinned to 3.13. Patch updates disabled except for TypeScript and Python. `aquasecurity/trivy-action` uses github-releases versioning. Post-upgrade runs `pnpm install && pnpm format`.
- **Probot Settings:** Extends `fro-bot/.github:common-settings.yaml`
- **DevContainer:** Docker-in-Docker setup with mise tool management
- **EditorConfig + Prettier + .gitattributes:** Consistent formatting enforcement

### Branch Protection

Required status checks on `main`: Code Quality & Linting, Container Scan, Detect Changed Containers, Fro Bot, Pre-commit Checks, Prepare, Python Script Testing, Renovate, Security Scanning, Test Container Builds. Linear history enforced, admin enforcement enabled.

## Fro Bot Integration

**Fro Bot workflow is present** (`fro-bot.yaml`). The workflow uses `fro-bot/agent@v0.40.0` (SHA-pinned) with:

- **PR Review:** Dockerfile best practices, multi-arch correctness, Python quality, Actions security, breaking change detection. Structured verdict format (PASS/CONDITIONAL/REJECT).
- **Daily Autohealing** (14:30 UTC): Fixes errored PRs, addresses security alerts, updates outdated deps, enforces linting consistency. Uses a single perpetual "Daily Autohealing Report" issue rather than daily issues. Delegates tasks to Fro Bot (PAT-powered) and Copilot (assigned PRs).
- **Mention-triggered:** Responds to `@fro-bot` mentions in issue/PR/discussion comments from OWNER/MEMBER/COLLABORATOR.
- **Dispatch:** Custom prompt support via `workflow_dispatch`.

Concurrency is scoped per issue/PR/discussion number. Bot-authored events are excluded to prevent loops.

## Notable Patterns

- **Multi-arch by default:** All active containers target both `linux/amd64` and `linux/arm64` via QEMU + Buildx.
- **Change-detection matrix:** Both build and test pipelines dynamically discover which containers changed, avoiding unnecessary builds.
- **Dual registry publishing:** Images push to both GHCR and Docker Hub simultaneously.
- **AI-augmented tooling:** The Python automation framework includes LLM-powered features (template intelligence, predictive maintenance, documentation generation) using OpenAI and Anthropic APIs.
- **Archived containers excluded from everything:** `archived/` is filtered out of CI, builds, scans, Renovate, and linting.
- **Template system:** A Jinja2-based template engine generates Dockerfiles from parameterized templates across five categories, with AI-assisted parameter inference.
- **Poetry + pnpm dual ecosystem:** Python manages the automation scripts and AI tooling; Node.js handles formatting (Prettier). Both are orchestrated via mise.
