---
type: topic
title: Docker Containers
created: 2026-04-18
updated: 2026-09-25
sources:
  - url: https://github.com/fro-bot/agent
    sha: 9918ee0036100a11e61bf80bd85efa00b90b8852
    accessed: 2026-09-25
  - url: https://github.com/fro-bot/dashboard
    sha: 0c7489de29fd6f430468a021ebd1178088d16f03
    accessed: 2026-09-23
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: b7bcd528f511809e0f5906af42ca6ff131c1ff1e
    accessed: 2026-09-15
  - url: https://github.com/fro-bot/dashboard
    sha: a11f1b7dc5c3cf2ae021eb6c147b0d8fca0684f0
    accessed: 2026-09-09
tags: [docker, containers, multi-arch, oci, security, ci-cd, hadolint, cve, renovate, alpine, trivy, sarif, multi-stage, non-root, ignore-unfixed, manifest-verification, native-arm-runners]
related:
  - marcusrbrown--containers
  - bfra-me--ha-addon-repository
  - fro-bot--dashboard
  - fro-bot--agent
  - github-actions-ci
  - home-assistant
---

# Docker Containers

Docker container build patterns, security practices, and CI/CD integration observed across the Fro Bot ecosystem.

## Repos Using Docker

- [[marcusrbrown--containers]] — Primary container collection with multi-arch builds, Python automation, and template system
- [[bfra-me--ha-addon-repository]] — HA add-on template; four-arch (`aarch64`/`amd64`/`armhf`/`armv7`) builds via `home-assistant/builder` with cosign signing to GHCR, digest-pinned `ARG BUILD_FROM`, `repology` custom manager for apk pins
- [[fro-bot--dashboard]] (added 2026-09-09) — single-arch `node:24-slim` app image, three-stage (`builder` → `prod-deps` → runtime), digest-pinned, CalVer-tagged to GHCR, smoke-tested by digest before promotion, two-phase Trivy scan on the release path
- [[fro-bot--agent]] (added 2026-09-25) — `deploy/` compose stack (gateway, workspace, mitmproxy), two digest-pinned `node:24.21.0-alpine` multi-stage images. The workspace image splits a root, capability-trimmed service from an unprivileged uid-10001 agent (see below)

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
- **Strip package managers from the runtime stage** (2026-09-23, [[fro-bot--dashboard]]): before `USER node`, the final stage runs `rm -rf` on `npm`/`npx`/`pnpm`/`pnpx`/`corepack`/`yarn`/`yarnpkg`, their `lib/node_modules` trees, and root caches. It copies only `node_modules/` from a `prod-deps` stage, with no manifests and no lockfile. The `node:*` base images ship all of these, so a runtime image that "only runs `node src/server.ts`" still carries a working fetch-and-install toolchain unless someone removes it. The cost is one layer. The payoff is that a compromised process cannot `npx` its way to a second-stage payload.

**Hadolint DL3025 (`HEALTHCHECK`/`CMD`/`ENTRYPOINT` shell vs. JSON form):** [[marcusrbrown--containers]] carries open code-scanning alerts (#283/#285) for shell-form `HEALTHCHECK CMD` in both `node/*` Dockerfiles. Shell form wraps the command in `/bin/sh -c`, which reintroduces a shell process between the init system and the probe — undercutting the `tini`-as-PID-1 signal-handling discipline the same Dockerfiles otherwise enforce. JSON exec notation (`HEALTHCHECK CMD ["curl", "-f", "http://localhost:3000/health"]`) is the fix; the proposed patch (PR #723) has been green and unmerged since 2026-07-30.

### Multi-Architecture

Multi-arch builds target `linux/amd64` and `linux/arm64` via Docker Buildx with QEMU. Build arguments `TARGETPLATFORM`, `TARGETOS`, and `TARGETARCH` are declared for platform-aware logic.

#### One generic base beats per-architecture bases (2026-09-15)

[[bfra-me--ha-addon-repository]] replaced a per-arch base-image scheme with a single arch-agnostic one and wrote the reason into its `AGENTS.md` as a hard rule:

> `build-image` injects only `BUILD_ARCH` and `BUILD_VERSION`. Add-on Dockerfiles must use a generic multi-platform base such as `ghcr.io/home-assistant/base:<tag>@sha256:<digest>`, never a per-architecture `{arch}-base` image. **A per-architecture base can silently put the wrong architecture inside another tag.**

The old shape was a `build.yaml` mapping four architectures to four `{arch}-base` images, each independently pinned, consumed through `ARG BUILD_FROM`. Three failure modes fall out of that design and all of them are silent:

- **Cross-contamination.** The arch → base mapping and the arch the builder is told to produce are two separate declarations. If they disagree, you publish an `aarch64`-tagged image containing `amd64` binaries. Nothing fails; the image runs on the wrong host and dies at exec time, in production, on someone else's hardware.
- **Independent drift.** Four pins rotate at four rates. This repo carried `:3.23` for 64-bit and `:3.22` for 32-bit ARM for months because upstream lags on 32-bit — a real divergence in the userland of images shipped under one add-on version.
- **A larger pin surface for no benefit.** A multi-platform manifest resolves the right layer by the *builder's* platform. The per-arch indirection reimplements, by hand and in YAML, something the registry already does correctly.

With a single `FROM ghcr.io/home-assistant/base:3.24@sha256:…` there is exactly one pin, and the architecture comes from the runner rather than from a lookup table that can be wrong.

**Native runners over QEMU.** The same change moved the matrix to `amd64 → ubuntu-24.04` and `aarch64 → ubuntu-24.04-arm`, with an explicit `::error::Unsupported architecture` default arm that fails rather than silently dropping a target. This is only clean because the repo simultaneously dropped `armhf`/`armv7` — there are no GitHub-hosted 32-bit ARM runners, so any 32-bit target forces the emulation path back for the whole matrix. **The decision to keep 32-bit ARM support is therefore also a decision to keep QEMU**, and it should be costed as one.

**Verify the published manifest, not the push.** The same repo's `publish-manifest` job reads the pushed reference back with `docker buildx imagetools inspect --raw`, projects the declared arch list into expected `{os, architecture}` pairs, and fails on a difference — filtering `platform.os != "unknown"` so attestation manifests do not make a correct 2-platform manifest look like 4. A green push proves bytes were accepted; it does not prove the manifest lists the platforms you declared. See [[github-actions-ci]].

**Separate build from publish by permission, not by flag.** The prior design ran one job with a `--test` flag on PRs and a full build on push — meaning the fork-reachable path executed inside a job declaring `packages: write` + `id-token: write`. The current design splits them: `build-addon` (pull requests, `contents: read`, `push: 'false'`) and `publish-addon` (default branch only, `packages: write` + `id-token: write`, cosign). A flag that gates publishing is a correctness control; a permission that makes publishing impossible is a security control, and only the second survives a bug in the flag.

## CI/CD Patterns

### Build Pipeline

The observed pattern uses a two-phase workflow:

1. **Change detection** — identify which Dockerfiles changed (excluding archived/template dirs)
2. **Matrix build** — parallel per-container jobs using `docker/build-push-action`

Registry push is gated on `github.event_name != 'pull_request'` to prevent PR builds from publishing.

### Security Scanning

Trivy is used for both vulnerability scanning (image scan) and misconfiguration scanning (config scan). Results are uploaded as SARIF for GitHub Security tab integration. Hadolint provides static Dockerfile linting with SARIF output.

#### Split Visibility From Enforcement: The Two-Phase Trivy Scan (2026-09-09)

From [[fro-bot--dashboard]]'s `release.yaml` (present since ≤2026-08-08, first recorded 2026-09-09). The release job scans the freshly built candidate image **by digest, twice, with opposite policies**:

| Phase | Purpose | Key settings |
| --- | --- | --- |
| 1. Report | Full picture into code scanning | `severity: HIGH,CRITICAL`, `limit-severities-for-sarif: true`, **`exit-code: '0'`**, `format: sarif` → upload as artifact (5-day retention) **and** `codeql-action/upload-sarif` under a dedicated `category: trivy/release-image` |
| 2. Enforce | Fail only on what a maintainer can fix | same action + same Trivy version, **`ignore-unfixed: true`**, **`exit-code: '1'`** |

Both phases use the same pinned action (`aquasecurity/trivy-action` v0.36.0) and the same explicit `version: v0.72.0` scanner pin, so the two runs cannot disagree because of tool drift. A `$GITHUB_STEP_SUMMARY` block records the digest, artifact name, code-scanning category, and severity floor, so the run is self-describing without opening the SARIF.

This is the correct resolution of the tension recorded under *Base Image Pinning* above: **digest pinning buys reproducibility, not freshness**, so a digest-pinned base will carry HIGH/CRITICAL CVEs with no upstream fix available. A single blocking scan against that reality has exactly two stable end states — every release blocked, or the severity floor quietly raised until the gate means nothing. Splitting the concerns keeps the complete HIGH/CRITICAL picture visible in code scanning while gating releases only on findings that have a patch. The reasoning is written down in-repo at `docs/solutions/best-practices/trivy-base-image-alerts-unfixable-by-design-2026-08-30.md`.

Two details worth copying:

- **Scan the digest, not the tag.** `image-ref: ghcr.io/<repo>@<digest>` scans exactly the artifact that will be promoted, and the digest is regex-validated (`^[a-f0-9]{64}$`) before use.
- **Mint privileged credentials after third-party steps.** The workflow carries an explicit comment that the publication App token is created only once all third-party actions have finished — so the scanner, the uploader, and the builder never run with the release identity in their environment. Cheap ordering discipline that survives a compromised action.

#### Prefer the Image's Stock Non-Root User (2026-09-09)

[[fro-bot--dashboard]] replaced a bespoke `addgroup --system --gid 1001 dashboard` / `adduser … --uid 1001` block with plain `USER node` (uid **1000**, already present in every `node:*` image). Less Dockerfile, one fewer layer, and — the actual motivation, per the PR title `fix(docker): run as the node user to match deployment` — the container UID now matches what the deployment environment expects for volume ownership.

The transferable part is the second half of that change: the release pipeline **asserted the old UID**. `release.yaml` smoke-tests the candidate with `docker run --rm "$IMG" node -p 'process.getuid()'` and failed if it was not `1001`; the same PR updated the assertion to `1000`. A UID assertion in the smoke test is a good idea precisely because it turns a silent permissions regression into a release failure — but it means the runtime identity is now specified in two places, and changing one without the other blocks every release. **If you assert a container's UID in CI, treat the Dockerfile `USER` line and the assertion as a single coupled edit**, the same discipline the *Renovate Custom Managers* entry below prescribes for base-image and package-set version pairs.

#### Two Identities in One Container, Proven at Production Privilege (2026-09-25)

`USER node` fits when one process needs no privilege. [[fro-bot--agent]]'s workspace image (#1661,
unreleased as of 2026-09-25) shows the harder case: a supervisor that needs *some* root to set up
protected state, hosting an agent that should never have it.

- **Keep the service at uid 0, trim it to the capabilities it uses.** Compose sets `user: '0:0'`,
  `cap_drop: [ALL]`, and adds back `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, KILL`, plus
  `no-new-privileges:true` and core dumps off. The Dockerfile says `USER 0:0` explicitly, so the choice is
  documented rather than inherited.
- **Drop the untrusted workload to a fixed no-login uid with `setpriv --reuid --regid --clear-groups`.**
  This works on a numeric uid with no `/etc/passwd` lookup, and it clears supplementary groups so no root
  group survives. The Dockerfile points to an entrypoint rationale comparing `setpriv`, `su-exec`, and
  `runuser`. That rationale was not read in this survey.
- **Give each identity its own `HOME`.** The service's `HOME` is a root-only `/var/lib/workspace-agent/home`,
  not `/root`, so anything written under `$HOME` (global git config) is outside the agent's reach and the
  agent's home is outside the service's accidental writes.
- **Put secrets under a root-only tmpfs, not at `/run/secrets`.** Top-level `/run/secrets/*` binds are
  readable by any uid in the container. Nesting them under `/run/workspace-agent` (tmpfs, `mode=0700,uid=0`)
  makes the less-privileged uid unable to read them. Credentials reach the agent-uid provisioning step on
  stdin, never argv.
- **Migrate old volumes fail-closed.** Existing root-owned data on a named volume has to be re-owned. The
  migration is `lstat`/`lchown` only (no following symlinks, no `git`), marked complete per item,
  resumable, and bounded by a deadline. If the deadline is hit, the container refuses to start rather than
  run on mixed ownership. The healthcheck `start_period` has to grow to cover that deadline (45 s → 360 s
  here). Otherwise the orchestrator kills a healthy migration mid-flight.
- **Smoke-test at production privilege.** CI defines a single `WORKSPACE_DOCKER_SECURITY_FLAGS` env that
  mirrors the compose security settings and appends it to **every** `docker run` of the image. The
  in-file reason: "a smoke test that runs with more privilege than production doesn't prove production
  works." A separate harness then *attempts* each isolation violation and asserts that it fails. This is
  the same coupling lesson as the UID assertion above, one level up: if CI runs the container with a
  different privilege set than production, the security claims are only checked in production.

One gap has already surfaced: open #1663 reports that the image has **no init**, so orphaned tool
processes under the new uid become zombies. The `tini`-as-PID-1 item under *Security Hardening* above is
the standard answer. A privilege split creates more short-lived child processes, which makes an init more
necessary, not less.

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

#### Fixed the value, not the class (2026-09-15)

[[bfra-me--ha-addon-repository]] now reads `depNameTemplate: 'alpine_3_24/{{package}}'`, matching the new single base image `ghcr.io/home-assistant/base:3.24@sha256:…`. Correct today.

**The defect class survives intact.** The branch is still hard-coded in `renovate.json5` and the base image tag still lives in the Dockerfile, with no link between them. Renovate's own `Home Assistant Add-ons` package rule will propose the next base bump as routine churn; nothing in that PR touches the manager, and nothing fails if it does not. The repo is one automated, automergeable base-image bump away from reproducing the exact state this section was written about — and it will reproduce it silently, because the manager is still inert (no `apk` version pins exist in the example add-on) and an inert manager cannot be wrong in a way anyone observes.

Recording the correction is worth less than recording what it teaches: **fixing a coupled-constant defect by editing the constant leaves the coupling undeclared, so the fix has the lifetime of the next bump.** The durable repairs are unchanged from above — couple the two edits in one PR, template the branch off the base tag, or add a lint asserting `depNameTemplate`'s branch equals the base image's tag. The last is the only one that survives an inattentive maintainer, and it is a three-line check.

Corollary for surveys: a value that is correct on inspection tells you nothing about whether the mechanism that made it wrong was addressed. Check whether the *link* was established, not whether the *number* matches.

#### The package-manager version declared twice (2026-09-23)

A second instance of the coupled-constant class, in an application image rather than an add-on template. [[fro-bot--dashboard]]'s `Dockerfile` runs `corepack prepare pnpm@11.8.0 --activate` in both build stages, while `package.json` declares `packageManager: pnpm@11.27.0`. Renovate has bumped `packageManager` repeatedly (11.8.0 → … → 11.25.0 → 11.26.0 → 11.27.0) and never touched the Dockerfile line. The regex for `corepack prepare <pm>@<ver>` is not a default manager, so the second copy is invisible to the bot.

Corepack's documented precedence gives the project's `packageManager` field priority inside the project directory. The `prepare --activate` version is then only a global fallback, so the build most likely runs 11.27.0 and the stale line is dead code that *looks* authoritative. That is inferred from corepack semantics, not read from a build log. Either reading is a defect. If the field wins, the Dockerfile documents a version the build does not use. If the fallback ever wins (for example, after a `WORKDIR` or `COPY` reorder that runs `pnpm` before `package.json` lands), a frozen-lockfile install runs under a pnpm 19 minor versions older than the one that wrote the lockfile.

Repair options, best first: drop the version from `prepare` (`corepack enable` alone honors `packageManager`); or derive it at build time from `package.json`; or add a Renovate `customManagers` regex that couples the two. Survey check: **`grep` every `Dockerfile` for `corepack prepare` and diff the version against `packageManager`.**

## Related Technologies

- **Docker Buildx** — Multi-platform build extension for Docker
- **QEMU** — User-mode CPU emulation for cross-architecture builds
- **Trivy** — Container vulnerability and misconfiguration scanner
- **Hadolint** — Dockerfile linter
- **tini** — Minimal init system for containers
- **OCI Image Spec** — Standard for container image metadata
