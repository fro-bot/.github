---
type: repo
title: marcusrbrown/panthea
created: 2026-09-26
updated: 2026-09-26
node_id: R_kgDOJt6i0Q
sources:
  - url: https://github.com/marcusrbrown/panthe.ai
    sha: e5022aaa6e9970e66b41ad68334f2fb7781658e7
    accessed: 2026-09-26
  - url: https://github.com/marcusrbrown/panthe.ai
    sha: f0c4ff0119bfb82feb0591950247cdd9e0596c17
    accessed: 2026-09-26
  - url: https://github.com/marcusrbrown/panthea
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

# marcusrbrown/panthe.ai

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
