---
date: 2026-09-04
topic: counterexample-proven-guards
origin: docs/ideation/2026-09-04-open-ideation.md
---

# Counterexample-Proven Guards

## Summary

Add scoped mutation testing over the gate surface so that a guard whose check can be removed without turning any test red fails CI as a surviving mutant. The check is required on pull requests that touch gate code, surviving mutants are allowed only by reasoned per-mutant exception, and a spike confirms native TypeScript instrumentation before anything is wired in.

---

## Problem Frame

This repository's load-bearing guards — privacy and private-leak gates, wiki authority, lockfile coverage, package contract drift, correction survival — almost all have negative tests, and several have hand-written mutation proofs. The convention is real and is cited in three plans as established practice.

What failed three times in two weeks was not a missing negative test but a vacuous one:

- A rewrite guard shipped with a fixture the rewrite never matched, so the test passed with the extension filter deleted (`scripts/build-wiki-write-core.test.ts`, caught by review one merge after the guard landed).
- Two scaling guards ran their counterexamples and passed against both the vulnerable and the fixed implementation; their own comments conceded they could not discriminate. They cost CI time and then flaked (removed in #3810).
- A credential-boundary test in the dashboard's private writer read two of ninety-eight files, so a new file importing the write client would have passed it silently.

In every case the guard was green whether or not the check existed. The only detector today is a human reading the test and asking "would this fail if I deleted the `if`?" — a question asked by hand in eight implementation briefs this fortnight and forgotten at least three times. Nothing structural asks it.

---

## Requirements

**Detection**

- R1. Mutation testing runs over a bounded set of gate modules and their tests; a mutant that survives — every test stays green with the check altered or removed — is a failure.
- R2. The mutated set is enumerated explicitly and limited to guard code: privacy and leak gates, wiki authority, lockfile gates, package contract and drift checks, correction survival, and the shared gate package's rejection paths. General scripts and workflow-shape tests are not mutated.
- R3. Timing and complexity guards are excluded from mutation; they keep their existing discrimination meta-test, because a mutant that changes algorithmic complexity does not change correctness-test outcomes.

**Exceptions**

- R4. A surviving mutant may be accepted only through a per-mutant exception that names the mutant and states why it is inert; a numeric survival threshold is not an acceptable exception mechanism.
- R5. Exceptions are reviewed like code: they live in the repository, appear in the diff, and are subject to Fro Bot review.
- R6. An exception is placed on the line it excuses and scoped to that line, so any edit to the excused code carries the exception into the same diff for re-review; file-wide or region-wide suppression is not acceptable.

**Gating**

- R7. The check is a required status. On pull requests that modify none of the files in R8, its job is skipped by a job-level condition so the required context still resolves; a workflow-level path filter that leaves the context pending is not acceptable.
- R8. The check runs when a pull request modifies a mutated module, its tests, the exception list, the mutation configuration, the test runner configuration, or the dependency manifest or lockfile — anything that changes what is mutated or how mutants are executed.
- R9. When the check cannot produce a verdict — instrumentation failure, runner crash, timeout — it fails closed and reports the failure class distinctly from "surviving mutants found."
- R10. The check reports each surviving mutant with file, location, and the mutation applied, so the fix is locatable without rerunning locally.

**Rollout**

- R11. A spike instruments one gate module under Node 24 native TypeScript and confirms the runner loads mutated sources before any workflow or dependency change lands.
- R12. The first full run over the mutated set is treated as a cleanup baseline: every surviving mutant is either fixed or given an exception before the check becomes required.

---

## Acceptance Examples

- AE1. **Covers R1, R10.** Given a guard `if (!authorized) throw`, when the mutant `if (false) throw` leaves all tests green, the check fails and names the file, line, and mutation.
- AE2. **Covers R4, R5.** Given a surviving mutant that toggles a logging branch with no rejection consequence, when an exception naming that mutant and its reason is added, the check passes and the exception appears in the pull request diff.
- AE3. **Covers R6.** Given an accepted exception, when a later pull request rewrites the excused line, the exception appears in that pull request's diff beside the change; an exception that suppresses a whole file or region fails the check.
- AE4. **Covers R7, R8.** Given a pull request that changes only a workflow prompt, when CI runs, the mutation job is skipped and the required context resolves as satisfied.
- AE5. **Covers R8.** Given a pull request that changes only the mutation configuration, when CI runs, the mutation check runs even though no mutated module changed.
- AE6. **Covers R1, R8.** Given a pull request that adds a new rejection branch to a mutated gate module without a test that fails when the branch is removed, when CI runs, the mutation check fails.
- AE7. **Covers R9.** Given the runner cannot load an instrumented module, when the check runs, it fails and reports an instrumentation failure rather than zero surviving mutants.
- AE8. **Covers R3.** Given the wikilink parser is made quadratic, when the mutation check runs, it does not report this (correctness tests pass); the existing scaling meta-test remains the detector for that class.

---

## Success Criteria

- A guard that can be neutered without any test going red cannot merge into a mutated module; the three incidents above would each have been caught before merge.
- Discrimination proof stops being a manual requirement in implementation briefs for the mutated set.
- The check runs in a bounded time on gate-path pull requests and does not run at all on others.
- Every accepted surviving mutant has a stated reason a reviewer can disagree with.
- A planner can read this document and enumerate the mutated modules, the exception format, the trigger condition, and the failure vocabulary without inventing any of them.

---

## Scope Boundaries

- Timing and scaling guards: excluded from mutation; existing meta-test unchanged.
- CI-topology fidelity (checkout depth, credentials, event payload) — a separate idea from the same ideation; not folded in.
- A registry of load-bearing guards, or a lint rule requiring a counterexample helper — rejected in favor of detecting load-bearing-ness directly.
- Mutating `scripts/**` or `packages/**` wholesale — the mutated set is enumerated, not globbed over everything.
- `fro-bot/dashboard`'s `wiki-writer` guards — the freshest incident, but that repository adopts the pattern as a follow-on once it is proven here.
- Cross-repository rollout tooling.

---

## Key Decisions

- Mutation testing over a shared assertion helper: a helper verifies a counterexample is present; only mutation verifies it is load-bearing, and load-bearing is the failure that recurred.
- Per-mutant exceptions over a survival threshold: a percentage collapses "known-inert" and "real vacuity" into one number, which is the status-vocabulary failure this repository already has a written rule against.
- Required on gate-path pull requests over advisory: an advisory check on a repository with one operator becomes a report nobody reads; the cost is a front-loaded cleanup (R12).
- Skipped job over path-filtered workflow: branch protection's required contexts are static, and a skipped job reports success while an untriggered workflow leaves the context pending. `Check Wiki Authority` already uses this shape.
- Line-scoped exceptions over calendar expiry or a content-bound ignorer: a directive on the excused line is the mutation framework's native mechanism, needs no repository-owned plugin, and re-enters review whenever the line changes because it is part of the same diff.
- Enumerated mutated set over a glob: keeps runtime bounded and makes scope creep a visible diff.
- Existing hand-written mutation proofs stay: they document the specific defect the author had in mind; mutation testing is the floor beneath them, not a replacement.

---

## Dependencies / Assumptions

- StrykerJS 10 with the Vitest runner supports Vitest 4 and Node 24, and mutates parsed TypeScript without a separate transpile step. Whether mutated output stays valid under Node's strip-only loader is unverified until the spike (R9).
- The Vitest runner forces per-test coverage analysis, which is what keeps a scoped run to minutes rather than the full suite per mutant.
- Adding the mutation framework is a new development dependency with a lockfile change; that is the operator's approval to grant at planning time.
- `.github/settings.yml` is the source of required status checks; making the check required is a branch-protection change and follows the same approval gate as other required-check additions.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] The exact module list. Candidates from the scan: `scripts/check-private-leak.ts`, `scripts/check-wiki-authority.ts`, `scripts/check-repo-onboarded.ts`, `scripts/wiki-lockfile-gates.ts`, `scripts/wiki-context-safety.ts`, `scripts/build-wiki-write-core.ts`, and in `packages/wiki-write-core/src`: `private-leak-adapter.ts`, `gate-contract.ts`, `corrections-survival.ts`, `privacy.ts`. Planning confirms each is a rejection surface and not a pure transform.
- [Affects R8][Technical] How the changed-file set is computed inside the job (diff against the merge base versus a path-filter action), and whether transitive imports of a mutated module should extend the trigger beyond the enumerated list.
- [Affects R4, R6][Technical] How the non-empty-reason and line-scope rules are enforced, since the framework treats the reason as optional.
- [Affects R9][Technical] The timeout and the failure-class vocabulary, aligned with the repository's existing clean / could-not-check distinction.
- [Affects R11][Needs research] Whether any mutation operators produce output Node's strip-only loader rejects, and which operators are noise for guard code (string literal mutations in error messages, for instance) and should be excluded up front.
- [Affects R1][Needs research] Realistic runtime for the enumerated set on the hosted runner; the estimate is single-digit minutes, and the spike should measure one module to calibrate.

---

## Sources / Research

- `docs/ideation/2026-09-04-open-ideation.md` — origin; idea 1, with the three incidents and the rejected alternatives.
- `scripts/wiki-lockfile-gates.test.ts`, `packages/wiki-write-core/src/regex-redos-regressions.test.ts`, `scripts/build-wiki-write-core.test.ts`, `scripts/wiki-context-safety.test.ts`, `scripts/improvement-metrics-integration.test.ts` — existing hand-written mutation proofs; the convention this work makes structural.
- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md` — the "fails when the gate is removed" pattern stated as a rule.
- `docs/solutions/best-practices/calibrate-classifiers-on-adjudicated-ground-truth-2026-07-11.md` — a prior mutation proof that passed for the wrong reason.
- `docs/solutions/best-practices/status-vocabulary-must-cover-every-report-surface-2026-08-31.md` — the rule behind R4 and R9.
- `.github/workflows/main.yaml` (`check-wiki-authority`) — the existing required job gated by a job-level condition; the shape R7 reuses.
- `vitest.config.ts` — include globs and the 10-second default timeout the runner inherits.
- StrykerJS Vitest runner documentation — Vitest 4 support since 9.4.0; per-test coverage analysis is forced; `mutate` and `testFiles` scope the run.
