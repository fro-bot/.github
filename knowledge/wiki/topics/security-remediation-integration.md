---
type: topic
title: Security remediation integration and evidence boundaries
created: 2026-09-30
updated: 2026-10-06
sources:
  - url: https://github.com/fro-bot/.github/pull/3954
    sha: b23f85ebb60f114c5f42a2c8aad680234e382be1
    accessed: 2026-10-06
  - url: https://github.com/fro-bot/.github/pull/3954#issuecomment-6010263024
    accessed: 2026-10-06
  - url: https://github.com/advisories/GHSA-68fv-2mgg-jv7q
    accessed: 2026-10-06
  - url: https://github.com/fro-bot/.github/pull/3942#issuecomment-5904530000
    accessed: 2026-09-30
  - url: https://github.com/fro-bot/.github/pull/3941
    sha: 3da53a7ba41b6265c8aed19dde50ac885c4f129e
    accessed: 2026-09-30
  - url: https://github.com/fro-bot/.github/pull/3942
    sha: 07c802ba9274511c4f08e9a91396e7b685190596
    accessed: 2026-09-30
  - url: https://github.com/fro-bot/agent
    sha: 27d08f8201656db6da2c60758bd4a0579fa2f6bb
    accessed: 2026-09-30
  - url: https://github.com/fro-bot/.github/pull/3946#issuecomment-5925981518
    accessed: 2026-10-02
  - url: https://github.com/fro-bot/.github/blob/b96b9904b20ed086304e184807d90c06cc3365b4/.github/renovate.json5
    sha: b96b9904b20ed086304e184807d90c06cc3365b4
    accessed: 2026-10-02
tags: [security, dependencies, integration, ci, evidence]
---

# Security remediation integration and evidence boundaries

## 2026-09-30 — independent fixes can form a merge-gate deadlock

The control-plane remediation pass opened two dedicated security PRs against the same `main` snapshot: [undici #3941](https://github.com/fro-bot/.github/pull/3941) and [brace-expansion #3942](https://github.com/fro-bot/.github/pull/3942). Each changed only the existing security floor in `pnpm-workspace.yaml` and that package's resolution in `pnpm-lock.yaml`. The delivery contract prohibited bundling unrelated dependency changes, so the split was deliberate.

The first PR moved undici from 8.10.0 to 8.10.2 and excluded versions below the patched floor. The second moved brace-expansion from 5.0.9 to 5.0.12. npm audit confirmed three high undici advisories and two high brace-expansion advisories. Both are transitive development dependencies; this establishes vulnerable dependency presence, not demonstrated exploitation in a production service.

Both individual branches passed bootstrap, types, and tests. Both failed required Lint: `scripts/check-override-floors.ts` audits the standing dependency graph, so the unfixed package still fails even when that package is outside the PR's diff. Combining the exact two diffs locally passed all four repository commands, with 4,079 tests passing and zero high/critical npm audit findings. At this observation, both PRs remained open and neither standalone branch was green.

This is a delivery dependency, not a reason to weaken the security gate. A correctly isolated patch can be globally unmergeable when another independent advisory is present in a whole-tree required check. Before promising a merge order, verify whether the first PR can actually satisfy required checks alone. If not, escalate integration coordination explicitly. Preserve each dedicated change's review evidence, obtain authorization for any combined delivery, and test that integrated tree. Do not lower the severity threshold, suppress the advisories, bypass branch protection, or repeatedly rerun unchanged branches.

The [remediation evidence](https://github.com/fro-bot/.github/pull/3942#issuecomment-5904530000) distinguishes **per-PR verification**, **combined local verification**, and **merged default-branch posture**. Those are three different claims: a combined green local run does not turn either remote standalone PR green, and an open patched PR does not remove an advisory from `main`.

## Advisory snapshots have different clocks

The same run's GitHub Dependabot snapshot listed two high undici alerts, while npm audit returned the third undici high advisory and both brace-expansion high advisories. Individual GitHub Advisory Database records confirmed those severities and patched ranges before edits. An absent repository alert was therefore not evidence that the published advisory was absent.

For remediation, combine repository-alert evidence with the package registry's advisory response, then resolve disagreements against the individual upstream advisory. Name the source, patched version, and comparison scope. This run used same-major patch remediation; it did not survey major-version drift. Keep the override's removal condition next to the floor so later routine updates cannot erase the reason for the constraint.

## Additional reporting can complement an existing required gate

[[fro-bot--agent]] has a source-verified [OSV workflow](https://github.com/fro-bot/agent/blob/27d08f8201656db6da2c60758bd4a0579fa2f6bb/.github/workflows/osv-scanner.yaml) that separates PR introduction checks from full-tree reporting. The PR path compares base and head; push, scheduled, and merge-group paths upload full-tree findings to Code Scanning without failing on standing findings. This is a declared workflow contract, not a measured scanner-success result from this survey. It is useful as an additional posture channel; adopting it here would not authorize replacing or weakening the existing override-floor gate.

See [[github-actions-ci]] for related distinctions between successful jobs, executed checks, and delivered artifacts. The practical rule is to record which boundary each green signal proves before using it as authority for the next one.

## 2026-10-02 — the same standing advisory can block unrelated update artifacts

The [October 2 remediation evidence](https://github.com/fro-bot/.github/pull/3941#issuecomment-5945924199) reconfirmed the two standalone security PRs remained blocked. A third PR, [the routine reusable-workflow update #3946](https://github.com/fro-bot/.github/pull/3946), now carries the same dependency-floor failure in two channels: its Lint check run and its legacy `renovate/artifacts` commit status.

The [artifact diagnostic](https://github.com/fro-bot/.github/pull/3946#issuecomment-5925981518) names `pnpm run fix` as the failed command. At the trusted [`b96b990` snapshot](https://github.com/fro-bot/.github/blob/b96b9904b20ed086304e184807d90c06cc3365b4/.github/renovate.json5), `postUpgradeTasks` runs bootstrap followed by that command. The fix script runs the whole lint chain before ESLint's formatter, so the standing undici and brace-expansion advisories stop artifact generation even though this PR only updates Actions workflows. There is no evidence here of an additional lockfile-generation or formatter defect.

An artifact failure is a delivery symptom, not automatically a second root cause. Inspect the command diagnostic and both status channels before authoring a repair. In this case the smallest next step is resolving the already-recorded security integration dependency, then letting Renovate refresh its artifacts. Do not remove post-upgrade checks, weaken the advisory gate, or add unrelated security upgrades to a routine version-update branch merely to make its status green. The two high-level observations remain distinct: dedicated patches exist, and the default branch is still vulnerable until an authorized integration lands.

## 2026-10-06 — an integration proof expires when the advisory population changes

The next [remediation pass](https://github.com/fro-bot/.github/pull/3954#issuecomment-6010263024) found a sixth high advisory on the unchanged `b96b990` main snapshot: [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), where indexed source-map section offsets in `source-map-js` before 1.2.2 can block the event loop. Its repository-alert snapshot still showed only the older high undici records, while npm audit and the individual advisory confirmed the new finding. The advisory's September 18 publication date is not the date this pass first observed it in the registry audit; those clocks must not be conflated.

Dedicated [PR #3954](https://github.com/fro-bot/.github/pull/3954) at `b23f85e` adds a `source-map-js >=1.2.2` floor and resolves only that package from 1.2.1 to 1.2.2 in `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Registry version/integrity checks, installation, types, 4,079 tests, and independent ESLint passed. The patched branch removes this advisory and reduces high audit findings from six to five; its global Lint gate still fails on the undici/brace-expansion findings already covered by #3941/#3942. A patch delivered as an open PR has not repaired main.

The September 30 combined-tree result above remains valid historical evidence for that day's advisory population. It is **not current proof** that combining only those two original fixes yields zero high findings: the October 6 scan introduces a third independent remediation target. A whole-tree advisory gate can change its answer without a repository commit, so record both the tested revision and the advisory observation time. Revalidate the approved integrated tree containing all currently required dedicated fixes; do not carry an old green integration result forward, suppress a newly observed advisory, or repeatedly rerun an unchanged blocked branch. [[github-actions-ci]] records the broader distinction between execution evidence and delivered outcomes.
