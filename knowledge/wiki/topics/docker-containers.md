---
type: topic
title: Docker Containers
created: 2026-04-18
updated: 2026-09-22
sources:
  - url: https://github.com/marcusrbrown/infra
    sha: 3e4d76d40d92fa1bd0f9dc6511c9f6e41cd7fc79
    accessed: 2026-09-22
  - url: https://github.com/bfra-me/ha-addon-repository
    sha: b7bcd528f511809e0f5906af42ca6ff131c1ff1e
    accessed: 2026-09-15
  - url: https://github.com/fro-bot/dashboard
    sha: a11f1b7dc5c3cf2ae021eb6c147b0d8fca0684f0
    accessed: 2026-09-09
tags: [docker, containers, multi-arch, oci, security, ci-cd, hadolint, cve, renovate, alpine, trivy, sarif, multi-stage, non-root, ignore-unfixed, manifest-verification, native-arm-runners, reproducible-builds, source-date-epoch, buildkit-pinning, ghcr-pruning]
related:
  - marcusrbrown--containers
  - marcusrbrown--infra
  - bfra-me--ha-addon-repository
  - fro-bot--dashboard
  - github-actions-ci
  - home-assistant
---

# Docker Containers

Docker container build patterns, security practices, and CI/CD integration observed across the Fro Bot ecosystem.

## Repos Using Docker

- [[marcusrbrown--containers]] — Primary container collection with multi-arch builds, Python automation, and template system
- [[bfra-me--ha-addon-repository]] — HA add-on template; four-arch (`aarch64`/`amd64`/`armhf`/`armv7`) builds via `home-assistant/builder` with cosign signing to GHCR, digest-pinned `ARG BUILD_FROM`, `repology` custom manager for apk pins
- [[marcusrbrown--infra]] (added 2026-09-22) — gateway moved from on-droplet `git clone`+build to CI-built GHCR images (`infra-gateway`, `infra-workspace`) with fixed `SOURCE_DATE_EPOCH` + `rewrite-timestamp=true`, a pinned BuildKit image, report-only Trivy, and a dispatch-only fail-closed pruner for the untagged versions the tagging scheme generates
- [[fro-bot--dashboard]] (added 2026-09-09) — single-arch `node:24-slim` app image, three-stage (`builder` → `prod-deps` → runtime), digest-pinned, CalVer-tagged to GHCR, smoke-tested by digest before promotion, two-phase Trivy scan on the release path

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

## Related Technologies

- **Docker Buildx** — Multi-platform build extension for Docker
- **QEMU** — User-mode CPU emulation for cross-architecture builds
- **Trivy** — Container vulnerability and misconfiguration scanner
- **Hadolint** — Dockerfile linter
- **tini** — Minimal init system for containers
- **OCI Image Spec** — Standard for container image metadata

## Reproducible Image Builds Are Engineered, Not Inherited (2026-09-22)

From [[marcusrbrown--infra]], whose gateway deploy stopped building on the target host and became a
three-job CI pipeline (`build-images` → `scan-images` → `deploy-gateway`) pushing
`ghcr.io/marcusrbrown/infra-{gateway,workspace}` and injecting the resulting digests into the deploy.
The app README states the new invariant plainly: *"the droplet only pulls prebuilt artifacts — it never
builds images"*, with `docker compose up --build` on the host listed as an anti-pattern.

Three mechanics worth copying, each with the rationale committed next to it:

- **`SOURCE_DATE_EPOCH` must be a fixed constant, not commit-derived.** The comment in the workflow says
  why: a per-commit value changes the build argument on every run and destroys layer cache hits — you
  get determinism *within* a build and non-determinism *across* them, which is the opposite of the
  goal. The repo uses `'0'`.
- **`SOURCE_DATE_EPOCH` alone is not enough.** It rewrites config, history, and index timestamps but
  **not layer tar-entry timestamps**; those require `rewrite-timestamp=true` on the exporter
  (`outputs: type=registry,rewrite-timestamp=true`, BuildKit ≥ v0.13). Setting only the env var
  produces images that look reproducible in the config blob and differ in the layers.
- **Pin BuildKit itself.** `docker/setup-buildx-action` with
  `driver-opts: image=moby/buildkit:v0.33.0`, on the stated grounds that *"the preinstalled buildx on
  ubuntu-latest is an uncontrolled input otherwise."* This is the gap most repos leave open: the action
  is SHA-pinned, the base image is digest-pinned, and the builder that turns one into the other is
  whatever the runner image shipped this week. **A builder is a build input.**

Also: `outputs: type=registry` is used instead of `push: true`, with the note that it is shorthand for
`type=image,push=true` — the export declares the push rather than relying on the flag merging into it.
When you need exporter options at all, declaring the whole export in one place avoids a flag/exporter
disagreement.

### Report-Only Scanning Behind a `needs:` Edge

The same pipeline's `scan-images` job is `continue-on-error: true` **and** runs Trivy with
`--exit-code 0`, writing a table into `$GITHUB_STEP_SUMMARY`. `deploy-gateway` declares
`needs: [build-images, scan-images]`.

That edge reads as a security gate in every summary view and is not one — the job cannot fail, and if
it somehow did, `continue-on-error` would absorb it. Compare the **two-phase Trivy scan** recorded from
[[fro-bot--dashboard]] (2026-09-09), which deliberately splits visibility from enforcement: a
report-everything SARIF pass at `exit-code: 0` *plus* a second pass that actually fails the build on the
severities you have decided to block. Here only the first phase exists.

The rule: **a `needs:` edge to a job that cannot fail is documentation, not a dependency.** If the scan
is intentionally advisory — and for a freshly-adopted scan on an upstream-authored Dockerfile it
reasonably is — say so, and drop the edge or add the enforcing phase. Advisory-first gate promotion is
a legitimate pattern (see [[github-actions-ci]], 2026-09-21); what is not legitimate is an advisory gate
wearing the shape of a blocking one. Trivy being digest-pinned here
(`ghcr.io/aquasecurity/trivy:0.74.0@sha256:62b1e65e…`) is the right call and unrelated to the gap.

### A Commit-Derived Tag on a Commit-Independent Image Manufactures Garbage

The images are tagged `${upstream_ref}-${github.sha}`. The image content is a pure function of the
upstream ref and the two Dockerfiles, so any repository commit touching the deploy path republishes
byte-identical content under a fresh tag — which the repo has already filed against itself
(*"Gateway image rebuilds fire on commits that cannot change the image"*). Each rebuild also detaches
the prior digest from its tag, and untagged GHCR versions accumulate.

The collector shipped before the fix: a dispatch-only `prune-packages.yaml` running a fail-closed
pruner over a fixed two-package target set, dry-run by default, aborting on incomplete pagination, on a
tagged manifest that is itself an index, on any untagged digest referenced as a child manifest, on an
untagged count above a cap, and on a package with zero tagged versions. Full gate list and the
generalized destructive-automation shape are in [[github-actions-ci]].

Two container-specific notes from that design:

- **Refuse to prune what you do not model.** The pruner aborts on any tagged manifest that is a
  manifest list / image index rather than attempting to walk it. For a multi-arch repo that means the
  pruner simply never runs — which is the correct answer for a delete path operating on a data model it
  cannot verify.
- **An untagged version is not the same as an orphan.** A multi-arch index's per-platform children are
  untagged by construction and load-bearing. Any "delete untagged versions" automation that does not
  resolve tagged manifests and collect their child digests will eventually delete a live architecture
  out from under a tag that still resolves.

The upstream lesson is about the tag, though: derive the tag from the inputs that determine the image.
A content-addressed or upstream-ref-only tag removes both the rebuild churn and the pruning problem it
creates.
