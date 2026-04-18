---
type: topic
title: Docker Containers
created: 2026-04-18
updated: 2026-04-18
tags: [docker, containers, multi-arch, oci, security, ci-cd]
related:
  - marcusrbrown--containers
---

# Docker Containers

Docker container build patterns, security practices, and CI/CD integration observed across the Fro Bot ecosystem.

## Repos Using Docker

- [[marcusrbrown--containers]] — Primary container collection with multi-arch builds, Python automation, and template system

## Dockerfile Patterns Observed

### Base Image Pinning

Production Dockerfiles pin base images by full SHA-256 digest (`FROM node:24-alpine@sha256:...`), not just tags. The Dockerfile syntax directive is also digest-pinned (`# syntax=docker/dockerfile:1.23@sha256:...`). This provides reproducible builds independent of tag mutability.

### OCI Label Convention

Labels follow the [OCI Image Spec annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md). Static metadata (title, description, vendor, source, licenses, base image info) is defined in the Dockerfile. Dynamic metadata (created, revision, version) is injected at build time by `docker/metadata-action` in CI. The deprecated `org.label-schema.*` namespace is explicitly avoided.

### Build Cache Optimization

- `RUN --mount=type=cache` for package manager caches (APK, APT)
- Package manifest files (`package*.json`) copied before source code for layer cache hits on dependency installation
- GHA cache (`type=gha`) for BuildKit layer caching in CI

### Security Hardening

- Non-root user execution (`USER node`)
- `tini` as PID 1 init system for proper signal handling
- Minimal package installation (`--no-install-recommends`, `apk add --no-cache`)
- Health checks defined in the Dockerfile
- Entrypoint scripts with explicit `--chmod=755`

### Multi-Architecture

Multi-arch builds target `linux/amd64` and `linux/arm64` via Docker Buildx with QEMU. Build arguments `TARGETPLATFORM`, `TARGETOS`, and `TARGETARCH` are declared for platform-aware logic.

## CI/CD Patterns

### Build Pipeline

The observed pattern uses a two-phase workflow:

1. **Change detection** — identify which Dockerfiles changed (excluding archived/template dirs)
2. **Matrix build** — parallel per-container jobs using `docker/build-push-action`

Registry push is gated on `github.event_name != 'pull_request'` to prevent PR builds from publishing.

### Security Scanning

Trivy is used for both vulnerability scanning (image scan) and misconfiguration scanning (config scan). Results are uploaded as SARIF for GitHub Security tab integration. Hadolint provides static Dockerfile linting with SARIF output.

### Tagging Strategy

`docker/metadata-action` generates tags: branch ref, PR ref, short SHA (prefixed with branch name), `latest` (on default branch only).

## Related Technologies

- **Docker Buildx** — Multi-platform build extension for Docker
- **QEMU** — User-mode CPU emulation for cross-architecture builds
- **Trivy** — Container vulnerability and misconfiguration scanner
- **Hadolint** — Dockerfile linter
- **tini** — Minimal init system for containers
- **OCI Image Spec** — Standard for container image metadata
