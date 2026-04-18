---
type: topic
title: Docker & Containers
created: 2026-04-18
updated: 2026-04-18
tags: [docker, containers, dockerfiles, multi-arch, ci-cd, oci]
related:
  - marcusrbrown--containers
---

# Docker & Containers

Container build, publish, and security patterns observed across the Fro Bot ecosystem.

## Repos Using Docker

- [[marcusrbrown--containers]] — Curated Dockerfiles with Python automation, AI-assisted template system, and multi-arch CI/CD

## Build Patterns Observed

### Multi-Architecture Builds

Production containers target both `linux/amd64` and `linux/arm64` using Docker Buildx with QEMU emulation. The build pipeline in [[marcusrbrown--containers]] uses `docker/setup-qemu-action` + `docker/setup-buildx-action` + `docker/build-push-action` with GHA cache (`type=gha`).

### Change-Detection Matrix

Rather than building all containers on every push, CI dynamically detects which Dockerfiles changed and generates a strategy matrix for only those containers. This pattern uses `git diff --name-only` with path filtering to exclude archived/template/system containers.

### Dual Registry Publishing

Images push to both GitHub Container Registry (GHCR, `ghcr.io`) and Docker Hub simultaneously, using separate `docker/login-action` steps and multi-value `images` in `docker/metadata-action`.

### OCI Label Compliance

Images follow [OCI Image Spec annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md). CI-injected labels (`created`, `revision`, `version`) are set by `docker/metadata-action`; static metadata (`title`, `description`, `vendor`, `source`, `licenses`, `base.name`, `base.digest`) is defined in Dockerfiles. The deprecated `org.label-schema.*` namespace has been removed.

## Security Patterns

### Trivy Scanning

Container security scanning uses `aquasecurity/trivy-action` in two modes:

1. **Image scan:** Builds the container, then scans the image for `CRITICAL` and `HIGH` severity vulnerabilities (unfixed ignored)
2. **Config scan:** Scans Dockerfiles and docker-compose files for misconfigurations

Both produce SARIF output uploaded to the GitHub Security tab via `github/codeql-action/upload-sarif`.

### Hadolint

Dockerfile linting with `hadolint/hadolint-action` catches best-practice violations (unpinned base images, missing cleanup, root user, etc.). Output as SARIF for GitHub integration.

## Tooling

- **Docker Buildx** — Multi-platform build driver
- **QEMU** — CPU emulation for cross-architecture builds
- **docker/metadata-action** — Automated OCI-compliant tag and label generation
- **Trivy** — Container and config vulnerability scanning
- **Hadolint** — Dockerfile linting
