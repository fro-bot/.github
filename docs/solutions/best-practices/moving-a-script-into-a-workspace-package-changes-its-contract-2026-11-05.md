---
title: Moving a script into a workspace package changes its contract — capture parity, then audit what the move exposes
date: 2026-11-05
category: best-practices
module: packages/core/src/cli.ts
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - moving a `scripts/*.ts` module into `packages/*/src` and leaving a shim at the old path
  - putting a hand-parsed CLI onto the shared goke runner
  - a moved function gains an `env` or `cwd` parameter
  - a regex or parser becomes reachable through a package export
  - a file that resolves paths from its own location moves
tags:
  - workspace-packages
  - refactor-parity
  - cli-shim
  - codeql
  - redos
  - env-threading
  - fail-closed
  - scripts-consolidation
---

# Moving a script into a workspace package changes its contract — capture parity, then audit what the move exposes

## Context

The scripts consolidation (`docs/plans/2026-10-24-001-refactor-scripts-workspace-packages-plan.md`) moved `scripts/*.ts` into private `@fro-bot/*` packages. A six-line `scripts/<name>.ts` shim stays at each old path, so callers in workflows and agent prompts did not change. Most moved CLIs now run on the shared runner `runCli` (`packages/core/src/cli.ts:445`) in a `*-cli.ts` module. `wiki-context-expand` and `correction-lifecycle` keep their hand-written parsers.

A move changes behaviour that neither the type checker nor the test suite sees. The runner rejects argv the old script ignored. CodeQL treats a package export's parameters as untrusted input. A function that takes `env` or `cwd` can still read the ambient values. Anything computed from the file's own path moves with it.

## Guidance

1. **Capture parity before the move.**
   - Record exit status, output, written files and API calls for every real invocation and for edge-case argv. Run the capture twice to show it is deterministic.
   - After the move, compare against it. Investigate every difference and accept only the changes the plan approves for that CLI.
   - This migration approved three: argv no caller sends now exits 1 with usage, an uncaught throw prints its message without a stack, and the changes the plan names explicitly.
2. **Thread the supplied `env` and `cwd` everywhere.** Every read, every write and every child process uses them. `process.env` is only the default for direct callers. Prove it three ways:
   - Set conflicting ambient and supplied values, and assert the supplied values win.
   - Omit a supplied variable, and assert the ambient one is not used.
   - Give `cwd` a directory distinct from the process directory.
3. **Test every regex the move exposes against adversarial input.**
   - Include inputs with many partial matches, not just one long match.
   - Replace superlinear patterns with a linear implementation and compare it with the original.
   - Make sure the scaling test fails on the old implementation.
   - Run cases that could be exponential in a child process with a hard timeout.

   [`equivalence-refactors-need-differential-proofs-past-the-bound`](equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md) and [`calibrate-performance-guards-before-trusting-bounds`](calibrate-performance-guards-before-trusting-bounds-2026-10-09.md) cover how to build those tests.

4. **Re-derive paths relative to the moved file, and test that a moved gate still fails closed.** Cover the real repository root, the trigger coverage, and a missing config.
   - The mutation gate pins `findRepositoryRoot` (`packages/ci-checks/src/repository-root.ts:14`) and lists every file it loads in `FIXED_TRIGGER_FILES` (`packages/ci-checks/src/check-mutation-guards.ts:1508`).
   - Use `import.meta.main` in an executable shim. A guard of the form `import.meta.url === \`file://${process.argv[1]}\``is false for a path the URL form escapes, so the shim exits 0 without running.`scripts/check-mutation-guards.ts:7`uses`import.meta.main`; the other shims still use the URL comparison.
5. **Recheck mutation-test reachability and isolation.** Follow [`a-mutation-score-can-measure-nothing`](a-mutation-score-can-measure-nothing-2026-09-08.md).
6. **Check main's open code-scanning alerts after each merge, not only the PR's.**
7. **Check each gate's exit status before pushing.** Stop if any gate fails. This applies even when output is piped through `tee`, where the pipeline's status is not the gate's.

## Why This Matters

- **Parity capture found three commands that acted on argv no caller sends.** `reconcile-repos --bogus` reconciled, `rename-tracked-repo --help` renamed, and `dispatch-renovate pln` dispatched.
- **CodeQL raised `js/polynomial-redos` on regexes that had been silent under `scripts/`.** It flagged five package exports, and adversarial inputs found further quadratic patterns plus one exponential pattern that CodeQL had not flagged. One alert opened on main after its PR had merged. Main's alerts showed it; the PR's did not.
- **Env and `cwd` leaks showed up the same way each time.** A gateway URL, a secret, a run link, a `git` environment and a `git status` directory each came from the process instead of the caller. Each test passed because its ambient values matched the supplied ones.
- **Reviewing the moved gate exposed a changed-file gate bypass.** The bypass predated the move. A file renamed out of a guarded path, or a renamed mutation test, passed both changed-file gates because only the new path was listed. `fetchChangedFiles` (`packages/core/src/wiki-authority.ts:207`) now includes `previous_filename` and fails closed at GitHub's 3,000-file cap.

## When to Apply

Use this checklist whenever any `applies_when` condition holds for a change.

## Examples

`findCoverageBlock` (`packages/knowledge/src/drafted-solutions-pr-body.ts:231`) is a linear scan that replaces `/<!-- fro-bot:drafted-solutions-coverage v1\r?\n([\s\S]*?)\r?\n-->/`. With many start markers and no terminator, that pattern's lazy payload rescans from every start, which takes quadratic time. `drafted-solutions-coverage-block-scan.test.ts` compares the two on seeded inputs. `regex-scaling.test.ts` calls the scan directly, because `parseCoverageBlock` rejects a second marker before the scan ever runs.

`runCli` (`packages/reports/src/gateway-announce.ts:216`) passes `GATEWAY_ANNOUNCE_DISABLED`, `GATEWAY_WEBHOOK_SECRET` and `GATEWAY_PRESENCE_URL` as an empty string when the supplied env lacks them, so `announce` cannot borrow them from `process.env`. With the secret or URL missing, it reports missing configuration. With the kill switch missing, the kill switch is off. `gateway-announce.test.ts:998` stubs `fetch` and conflicting ambient values, then asserts the supplied URL and signature. The missing-variable cases follow it.

## Related

- [`cli-boundary-contracts-and-portable-tests`](cli-boundary-contracts-and-portable-tests-2026-11-02.md): the runner's pre-parse guards and portable subprocess oracles.
- [`a-mutation-score-can-measure-nothing`](a-mutation-score-can-measure-nothing-2026-09-08.md): the Stryker side of a move.
- [`equivalence-refactors-need-differential-proofs-past-the-bound`](equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md) and [`calibrate-performance-guards-before-trusting-bounds`](calibrate-performance-guards-before-trusting-bounds-2026-10-09.md): differential and scaling tests.
