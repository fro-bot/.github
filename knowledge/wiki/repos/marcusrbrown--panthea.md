---
type: repo
title: marcusrbrown/panthea
created: 2026-09-26
updated: 2026-10-10
node_id: R_kgDOJt6i0Q
sources:
  - url: https://github.com/marcusrbrown/panthe.ai
    sha: e5022aaa6e9970e66b41ad68334f2fb7781658e7
    accessed: 2026-09-26
  - url: https://github.com/marcusrbrown/panthe.ai
    sha: f0c4ff0119bfb82feb0591950247cdd9e0596c17
    accessed: 2026-09-26
  - url: https://github.com/marcusrbrown/panthea
    sha: c74fe32b46ecdf332b916295a18c1c2a8d11d008
    accessed: 2026-10-10
tags:
  - repository-stub
  - no-workflow
  - bun
  - tauri
  - simulation
related:
  - github-actions-ci
  - marcusrbrown--mothership
---

# marcusrbrown/panthea

## 2026-10-10 — Studio and repository automation

At `c74fe32`, the public repository resolves as `marcusrbrown/panthea`; the
earlier `panthe.ai` URLs and September observations below remain historical
provenance. This bounded survey reads directory listings, READMEs, manifests,
and workflows only. It does not independently inspect implementation, run
scenarios, or establish release/deployment status.

**Dated contradiction:** the September absence of Fro Bot is superseded at
this commit. The complete, non-truncated tree now contains four workflows:
`ci.yaml`, `fro-bot.yaml`, `renovate.yaml`, and `update-repo-settings.yaml`.
Fro Bot onboarding is present; the earlier recommendation to draft onboarding
does not apply to this snapshot. See [[github-actions-ci]] for its delivery
and verification contracts.

### Workspace expansion and authoring interface

- The workspace now adds `apps/studio` and `tools/studio`, retaining the
  desktop/client/simulation apps and eight package boundaries. Root workspace
  globs additionally include `tools/probes/*`. Bun remains **1.4.2**,
  TypeScript **5.9.3**; Biome is **2.5.15** and the root test command is
  `bun test --parallel=4`. The client and Studio manifests pin React **19.3.0**
  and Tauri API **2.12.1**, with Three.js **0.185.1**, Three Flatland
  **0.1.0-alpha.10**, and Vite **7.3.6**. Both inspected Rust manifests pin
  `tauri = "=2.12.1"`; Studio also pins the Tauri CLI to **2.12.1**.
- `tools/studio/README.md` describes a headless CLI sharing
  `@panthea/assets/studio` with the app, rather than owning a separate pipeline.
  Its session protocol is newline-delimited JSON with request IDs; stdout
  carries results, stderr diagnostics. Generation failures exit nonzero.
  The documented operations cover generation, conformance, editing, packing,
  approval, and publication, with read-only inspection available while another
  process owns the writer lock. Approval/publication require explicit revision
  confirmation and refuse `--yes`; `derive` is explicitly unsupported.
- That CLI README states macOS/POSIX scope and fake-server/fake-editor test
  limits. It also refers to a packaged-app parity record under
  `docs/evidence/asset-studio/unit7/README.md`, while its closing Limits section
  still calls the real model path and app shell separate work. Preserve this
  documentation tension: manifests and directory presence establish an app
  surface, not independent proof that every real-model or packaged path works.

### Evidence scope and documentation drift

The root README still says implementation is “in progress from M0,” and the
docs index still opens with “Ready for implementation planning.” Meanwhile,
`tools/scenarios/m2-greek-cast/README.md` reports **27 scripted steps** and
**22 positive controls** against a compiled sidecar, including restart,
perception isolation, causal relationships, stale proposals, and archive
checks. Those reported measurements are stronger than the root scaffold
description but remain source-authored evidence, not executions by this
survey. The README explicitly excludes the packaged desktop view and warns
that scripted plumbing does not establish model reasoning quality. Its M2
exit contract requires both a full one-hour unattended PASS and owner approval
of rated episodes; this survey does not establish that exit.

A smaller, concrete drift: the desktop `Cargo.toml` comment calls the JS API
pin **2.12.0**, while the inspected client manifest is **2.12.1**. The actual
inspected crate/API pins agree; the comment is historical wording, not evidence
of a current dependency mismatch.

Sources: [README](https://github.com/marcusrbrown/panthea/blob/c74fe32b46ecdf332b916295a18c1c2a8d11d008/README.md),
[workspace manifest](https://github.com/marcusrbrown/panthea/blob/c74fe32b46ecdf332b916295a18c1c2a8d11d008/package.json),
[Studio CLI README](https://github.com/marcusrbrown/panthea/blob/c74fe32b46ecdf332b916295a18c1c2a8d11d008/tools/studio/README.md),
[M2 scenario README](https://github.com/marcusrbrown/panthea/blob/c74fe32b46ecdf332b916295a18c1c2a8d11d008/tools/scenarios/m2-greek-cast/README.md).

## 2026-09-26 re-survey — first implementation scaffold

**Contradiction resolved by chronology:** the initial survey at `f0c4ff0` found a three-file placeholder with no CI. At `e5022aa` (committed 2026-09-26T23:19:55Z), `main` instead contains a Bun workspace, documentation, a Tauri shell, a React/Three.js client, a simulation package, and one CI workflow. The initial observation below was correct for the older commit but is **not** the current repository state. The README calls application implementation "in progress from M0"; the directory layout and dependency manifests establish a scaffold, not a completed simulation.

The README describes Panthea as a local-first simulation of autonomous mythological characters. Its accepted MVP scope is seven Greek gods spanning a mortal town, Olympus, and the Underworld, with observation, mortal participation, and a Universe operator console. The docs index describes 49 traceable MVP obligations, seven architecture decision records (two accepted and five proposed), and explicit research/probes; those are plans and decisions, not shipped runtime behavior.

### Current workspace and quality gate

- Root `package.json`: private `panthea@0.1.0`, Bun **1.4.2**, TypeScript **5.9.3**, Biome **2.5.14**; workspaces `apps/*`, `packages/*`, `tools/*`. `check` chains typecheck, lint, and Bun tests.
- `apps/client`: React **19.2.8**, Three.js **0.185.1**, Three Flatland **0.1.0-alpha.10**, Vite **7.3.6**, Tauri JS API **2.12.0**. `apps/desktop`: Tauri CLI **2.12.0** and Rust shell (`tauri = "=2.12.0"` in `Cargo.toml`), deliberately pinning the Rust/JS sides together. `apps/simulation`: Bun watch/start, typecheck and test scripts; no external dependencies declared in its manifest.
- The tree includes eight `packages/` (`agents`, `assets`, `behaviors`, `content`, `contracts`, `persistence`, `telemetry`, `world`) and three `tools/` (`content`, `probes`, `scenarios`), each with a manifest. Directory names indicate intended boundaries, not proof of finished implementations.
- `.github/workflows/ci.yaml` is the **only workflow** in the complete non-truncated tree: PR/push on `main` and dispatch; read-only permissions; SHA-pinned checkout and setup-bun; frozen Bun install followed by typecheck, lint and tests on Ubuntu; a separate macOS Rust job checks formatting and `cargo clippy --locked --all-targets -- -D warnings`. The workflow is present, but no live run outcomes were surveyed. **No Fro Bot workflow is present** at this new commit either; a separate draft onboarding PR can be considered.
- The README calls for WebGPU where available and WebGL2 as the baseline. The `tools/probes/webgpu-wkwebview/README.md` documents an unsigned Swift/WKWebView probe on macOS 15.7.9 that observed `navigator.gpu` undefined even after toggling private flags. Its own caveat is that a signed Tauri app may behave differently; treat this as evidence for retaining a WebGL2 fallback, not a universal WebGPU impossibility claim. See [[marcusrbrown--mothership]] for another Tauri desktop architecture in the portfolio, without assuming the apps share code.

### Historical initial survey (`f0c4ff0`)

Public MIT-licensed repository with a minimal initial commit. At the 2026-09-26 survey, `main` still points to its 2023-06-11 founding commit (`f0c4ff0`). The only README content is the heading `# panthe.ai`; it does not describe a product, technology stack, deployment, or relationship to other projects. The repository name alone is insufficient evidence for any of those claims.

## Observed layout

The complete, non-truncated `main` tree contains three root files: `README.md`, `LICENSE`, and `.gitignore`. There are no directories, manifests, or `.github/workflows/` files in that snapshot. No CI, dependency-management, or **Fro Bot workflow** is visible; a separate follow-up draft PR could propose Fro Bot onboarding if this repository becomes active. Absence here describes the surveyed commit, not a claim about external deployments or future plans.

The automation status at both snapshots is recorded in [[github-actions-ci]].

## Survey history

| Date       | Commit    | Observation                                                                       |
| ---------- | --------- | --------------------------------------------------------------------------------- |
| 2026-09-26 | `f0c4ff0` | Initial survey; README heading only, three root files, no workflows or manifests. |
| 2026-09-26 | `e5022aa` | New Bun/Tauri workspace scaffold and two-job CI; still no Fro Bot workflow.       |
| 2026-10-10 | `c74fe32` | Studio app/CLI, three CI jobs, four workflows including Fro Bot; bounded source survey. |
