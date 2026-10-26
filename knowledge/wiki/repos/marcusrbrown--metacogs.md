---
type: repo
title: marcusrbrown/metacogs
created: 2026-10-24
updated: 2026-10-24
sources:
  - url: https://github.com/marcusrbrown/metacogs
    sha: 2ef0e5c935f98e6c372c692dc9bbc2d42e403de5
    accessed: 2026-10-24
  - url: https://github.com/marcusrbrown/metacogs/blob/2ef0e5c935f98e6c372c692dc9bbc2d42e403de5/README.md
    sha: 2ef0e5c935f98e6c372c692dc9bbc2d42e403de5
    accessed: 2026-10-24
  - url: https://github.com/marcusrbrown/metacogs/blob/2ef0e5c935f98e6c372c692dc9bbc2d42e403de5/package.json
    sha: 2ef0e5c935f98e6c372c692dc9bbc2d42e403de5
    accessed: 2026-10-24
  - url: https://github.com/marcusrbrown/metacogs/blob/2ef0e5c935f98e6c372c692dc9bbc2d42e403de5/evals/reports/README.md
    sha: 2ef0e5c935f98e6c372c692dc9bbc2d42e403de5
    accessed: 2026-10-24
  - url: https://github.com/marcusrbrown/metacogs/blob/2ef0e5c935f98e6c372c692dc9bbc2d42e403de5/evals/runner/README.md
    sha: 2ef0e5c935f98e6c372c692dc9bbc2d42e403de5
    accessed: 2026-10-24
  - url: https://github.com/marcusrbrown/metacogs/tree/2ef0e5c935f98e6c372c692dc9bbc2d42e403de5/.github/workflows
    sha: 2ef0e5c935f98e6c372c692dc9bbc2d42e403de5
    accessed: 2026-10-24
tags:
  - agent-skills
  - reasoning
  - evaluation
  - opencode
  - bun
  - typescript
  - changesets
related:
  - github-actions-ci
node_id: R_kgDOVUNN9g
---

# marcusrbrown/metacogs

## Purpose and distribution

Public repository packaging explicit reasoning methods as portable Agent Skills.
The README describes short, inspectable procedures paired with helpers that
validate and store decision records. It reinterprets concepts from
`inanna-malick/metacog`; MIT licensing and upstream attribution are README claims,
not an independent license-file review. Altered cognition and jailbreak framing
are explicitly outside the stated project objectives.

Two skill directories exist at the surveyed SHA: `skills/synthesis/` and
`skills/counterfactual/`, each containing `SKILL.md` and `scripts/record.mjs`.
Synthesis is documented for reconciling analyses without double-counting shared
premises; counterfactual identifies a load-bearing assumption and the evidence
that would overturn it. Nine further concepts are described as hypotheses only.
The listing confirms a hypotheses file exists; its contents were not read.

Installation is documented as copying skill directories into a host-discovered
path, rather than installing an npm runtime package. The manifest is private,
version `0.1.0`, ESM, with Bun `1.4.4`, Node `>=22`, and only development
dependencies: Changesets CLI, Bun types, and TypeScript. The README describes each
record helper as one dependency-free Node 22+ file. These runtime and packaging
claims were not tested during this bounded survey.

## Records and host compatibility

The documented record includes the objective, evidence, assumptions, alternatives,
findings, next action, reopening condition, execution mode, status, and schema,
helper, method, and method-version identifiers. Malformed records are documented
as rejected before writing. Default storage is outside the repository under
`$XDG_STATE_HOME/metacogs/records/`, falling back to
`~/.local/state/metacogs/records/`. Project-local recording requires explicit
configuration. If the helper cannot run, the method reports `unrecorded` rather
than claiming durable storage.

The README's host matrix distinguishes evidence levels:

- **OpenCode 1.19.4:** both methods marked verified for the documented agent/judge
  model pair and October 23 evaluation.
- **Pi 1.3.0, Codex 0.162.1, Claude Code 2.1.270:** content-compatible but untested
  at model-execution level. Discovery smoke tests covered synthesis; counterfactual
  was not separately listed on these hosts.
- OpenCode, Pi, and Codex use `.agents/skills/`; Claude Code uses
  `.claude/skills/`. These are documented compatibility claims, not new smoke runs.

## Evaluation evidence and its limits

The root and evaluation READMEs describe local, credentialed baseline-versus-skill
campaigns with preregistered content hashes, negative fixtures, development
regression checks, and one-shot held-out reads. Raw transcripts remain local;
committed reports are allowlist projections of counts, intervals, hashes, model
identifiers, and outcome enums. Runner isolation, credential handling, and
one-shot custody protections are documented behaviors, not audited source-code
guarantees in this survey.

Reported synthesis epoch-3 held-out results are skill **19/20** versus baseline
**3/20**, delta **+0.80**, with zero false fires in 15 negative runs. Counterfactual
epoch 5 reports **18/20** versus **1/20**, delta **+0.85**, likewise zero in 15
negatives; its two skill-condition misses were judge errors. The model pair is
`openai/gpt-6-luna` / `anthropic/claude-haiku-5-5` on OpenCode 1.19.4. These numbers
are README-reported evidence; report JSON and fixtures were outside the read scope.

The documentation preserves important qualifications. Human review covered 39/39
synthesis and 38/38 counterfactual held-out judgments, but several criteria fell
below the 0.8 agreement floor and became advisory. Counterfactual's recomputed
outcomes were 17/20 versus 0/20. Its development threshold changed to a pooled bar
after earlier development results were observed. The stated gain primarily
measures visible reasoning procedure, not independently demonstrated answer
correctness, and generalization beyond this host/model/fixture family is unproven.

Historical sections remain explicitly dated: epoch-3 counterfactual initially
failed development gates and had unread held-outs; epoch 5 later passed and burned
its held-out set. Older runner sections saying human review was pending or free
access worked should not override later dated amendments or the current root
matrix. No older local repo page existed to contradict or replace.

## CI and release boundaries

See [[github-actions-ci]] for the related distinction between deterministic
repository checks and model-evaluation evidence.

The complete workflow directory contains only `ci.yml` and `release.yaml`.
CI runs on pushes and pull requests with read-only contents permission,
SHA-pinned checkout/setup actions, and frozen Bun installation. It runs typecheck,
`bun test`, generated-helper drift checks, host-matrix drift checks, and a secret
scan. It does **not** invoke live evaluation campaigns.

Release runs on `main` pushes or manual dispatch, serializes runs without
cancelling an active release, obtains an App token, checks out full history, and
installs with frozen dependencies and lifecycle scripts disabled. On `main`, it
calls the release script before Changesets creates or updates a version PR with
`bun run version`; the manifest expands that command to Changesets versioning
plus helper generation. The Changesets action disables its own GitHub-release
creation. Release-script internals, actual published artifacts, and live workflow
results were not inspected, so a separate passing CI run is not established as a
release prerequisite by these definitions alone.

**No Fro Bot workflow is present at this SHA.** A separate follow-up draft PR can
propose integration; the existing App-token release workflow is not a Fro Bot
agent workflow. This observation does not establish collaborator access, App
installation state, branch protections, or live automation health.
