---
type: topic
title: Docker Containers
created: 2026-04-18
updated: 2026-08-31
tags: [docker, containers, multi-arch, oci, security, ci-cd, hadolint, cve, renovate, alpine]
related:
  - marcusrbrown--containers
  - bfra-me--ha-addon-repository
  - github-actions-ci
  - home-assistant
---

# Docker Containers

Docker container build patterns, security practices, and CI/CD integration observed across the Fro Bot ecosystem.

## Repos Using Docker

- [[marcusrbrown--containers]] — Primary container collection with multi-arch builds, Python automation, and template system
- [[bfra-me--ha-addon-repository]] — HA add-on template; four-arch (`aarch64`/`amd64`/`armhf`/`armv7`) builds via `home-assistant/builder` with cosign signing to GHCR, digest-pinned `ARG BUILD_FROM`, `repology` custom manager for apk pins

## Dockerfile Patterns Observed

### Base Image Pinning

Production Dockerfiles pin base images by full SHA-256 digest (`FROM node:24-alpine@sha256:...`), not just tags. The Dockerfile syntax directive is also digest-pinned (`# syntax=docker/dockerfile:1.26@sha256:ecfaec9e...` as of 2026-08-30 in [[marcusrbrown--containers]]; progressed `1.23` → `1.24` (2026-05-13) → `1.25` (2026-07-30) → `1.26` (2026-08-30) via Renovate). This provides reproducible builds independent of tag mutability — and the digest is treated as _the_ reproducibility boundary, not individual package versions, because Alpine and Debian repos rotate package versions out from under exact-version pins.

**The cost of that boundary (observed 2026-08-30):** treating the digest as the sole reproducibility anchor means the image inherits whatever CVEs the upstream base carries between digest rotations. [[marcusrbrown--containers]]'s autoheal repeatedly surfaced `CVE-2026-14456` (HIGH, `libssl3`/`libcrypto3` 3.5.7-r0 → 3.5.8-r0) against `node:24-alpine` and repeatedly proposed the standard remedy — an `apk upgrade --no-cache` before `apk add`, which patches the base layer in-image without reintroducing brittle version pins. The remedy never landed (see the phantom-remediation pattern in [[github-actions-ci]]). The general point stands independent of that delivery failure: **digest pinning buys reproducibility, not freshness.** A digest-pinned base needs either an explicit in-image upgrade step or a fast digest-rotation cadence, or it will sit on known-vulnerable system packages between Renovate bumps.

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

**Hadolint DL3025 (`HEALTHCHECK`/`CMD`/`ENTRYPOINT` shell vs. JSON form):** [[marcusrbrown--containers]] carries open code-scanning alerts (#283/#285) for shell-form `HEALTHCHECK CMD` in both `node/*` Dockerfiles. Shell form wraps the command in `/bin/sh -c`, which reintroduces a shell process between the init system and the probe — undercutting the `tini`-as-PID-1 signal-handling discipline the same Dockerfiles otherwise enforce. JSON exec notation (`HEALTHCHECK CMD ["curl", "-f", "http://localhost:3000/health"]`) is the fix; the proposed patch (PR #723) has been green and unmerged since 2026-07-30.

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

### Action Major-Version Cadence

The Docker build toolchain actions are kept current through major boundaries by Renovate while retaining SHA pins. As of 2026-07-12, [[marcusrbrown--containers]] crossed a coordinated major sweep: `docker/build-push-action` v6 → v7, `docker/metadata-action` v5 → v6, `docker/login-action` v3 → v4, `docker/setup-buildx-action` v3 → v4, `docker/setup-qemu-action` v3 → v4 (plus `actions/checkout` v6 → v7). Each bump lands as a separate Renovate PR with an updated `# vN.N.N` comment on the pinned SHA.

Post-sweep the cadence settles into minor drift absorbed the same way — at the 2026-08-30 survey containers sat at `docker/login-action` v4.6.0, `docker/setup-buildx-action` v4.3.0, `hadolint/hadolint-action` v3.5.0, `github/codeql-action/upload-sarif` v4.37.0, and `actions/setup-python` v6 → v7, all as individual automerged Renovate PRs with no workflow-structure change. This is the same "SHA-pin-plus-Renovate absorbs even majors as ordinary churn" observation recorded for [[bfra-me--github]].

### Renovate Custom Managers Encode an Alpine Branch — and Then Drift (2026-08-31)

Observed in [[bfra-me--ha-addon-repository]]. Resolving bare `pkg=version` pins in a Dockerfile requires telling Renovate which distro package set to look in, typically via the `repology` datasource:

```json5
{
  customType: 'regex',
  managerFilePatterns: ['/(^|/|\\.)Dockerfile$/'],
  matchStrings: ['\\s\\s(?<package>[a-z0-9-]+)=(?<currentValue>[a-z0-9_.-]+)\\s+'],
  versioningTemplate: 'loose',
  datasourceTemplate: 'repology',
  depNameTemplate: 'alpine_3_20/{{package}}',
}
```

The Alpine release is **hard-coded into `depNameTemplate`**, and nothing links it to the base image the Dockerfile actually uses. In that repo the base images are `ghcr.io/home-assistant/{arch}-base:3.23` (64-bit) and `:3.22` (32-bit ARM) — the manager resolves against **Alpine 3.20**, three releases behind.

The failure mode is quiet in both directions: with no `apk` pins present the manager matches nothing and reports clean forever; the moment someone adds `apk add --no-cache foo=1.2.3-r0`, Renovate proposes versions from the wrong package set with full confidence. The regex is valid, the datasource is valid, the PR looks routine.

This is the same class as the wrong-`uses:`-path defect in [[github-actions-ci]]: **the configuration is syntactically correct and semantically aimed at the wrong target**, so every green run is evidence of nothing. Mitigations: bump the branch in the same PR that bumps the base image (treat them as one coupled change), or drop version-pinned `apk` lines entirely and rely on the digest-pinned base plus an `apk upgrade` step — which is already the preferred posture per *Base Image Pinning* above.

Extra weight when the file lives in a **template repository**: a wrong default propagates to every fork, and adding pinned apk packages is among the first things a forker does.

## Related Technologies

- **Docker Buildx** — Multi-platform build extension for Docker
- **QEMU** — User-mode CPU emulation for cross-architecture builds
- **Trivy** — Container vulnerability and misconfiguration scanner
- **Hadolint** — Dockerfile linter
- **tini** — Minimal init system for containers
- **OCI Image Spec** — Standard for container image metadata
