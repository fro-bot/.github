---
type: repo
title: marcusrbrown/metacogs
created: 2026-10-24
updated: 2026-11-09
sources:
  - url: https://github.com/marcusrbrown/metacogs
    sha: f15c45628e10b42fa9541c1f3ff4bc89af569ae7
    accessed: 2026-11-09
  - url: https://github.com/marcusrbrown/metacogs/blob/f15c45628e10b42fa9541c1f3ff4bc89af569ae7/README.md
    sha: f15c45628e10b42fa9541c1f3ff4bc89af569ae7
    accessed: 2026-11-09
  - url: https://github.com/marcusrbrown/metacogs/blob/f15c45628e10b42fa9541c1f3ff4bc89af569ae7/package.json
    sha: f15c45628e10b42fa9541c1f3ff4bc89af569ae7
    accessed: 2026-11-09
  - url: https://github.com/marcusrbrown/metacogs/tree/f15c45628e10b42fa9541c1f3ff4bc89af569ae7/.github/workflows
    sha: f15c45628e10b42fa9541c1f3ff4bc89af569ae7
    accessed: 2026-11-09
  - url: https://github.com/marcusrbrown/metacogs/blob/f15c45628e10b42fa9541c1f3ff4bc89af569ae7/evals/synthesis/pilot-2/README.md
    sha: f15c45628e10b42fa9541c1f3ff4bc89af569ae7
    accessed: 2026-11-09
  - url: https://github.com/marcusrbrown/metacogs/blob/f15c45628e10b42fa9541c1f3ff4bc89af569ae7/evals/tether/pilot/README.md
    sha: f15c45628e10b42fa9541c1f3ff4bc89af569ae7
    accessed: 2026-11-09
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
  - opencode-plugins
node_id: R_kgDOVUNN9g
---

# marcusrbrown/metacogs

## 2026-11-09 snapshot: multi-host packaging, separate evidence levels

Public visibility was checked before reading the complete, non-truncated tree at
`f15c45628e10b42fa9541c1f3ff4bc89af569ae7`. This dated snapshot supersedes the
October packaging and missing-workflow claims below; those remain historical.
Reads covered the root README, package manifest, two pilot READMEs, and all six
workflow files. Source code, skill text, fixtures, report JSON, and linked
non-README documentation were not read or executed.

### Distribution and recording

The manifest is now publishable `metacogs` **0.4.1**, not private `0.1.0`.
It declares public npm access with provenance, ESM `dist/index.js`, Bun 1.4.4,
Node >=22, and optional peers for OpenCode v1 (`@opencode-ai/plugin >=1.19.4 <2`)
and v2 (`@opencode/plugin >=2.2.0 <3`). Development pins are SDK 1.19.5 and
2.2.5, MCP SDK 1.32.2, Zod 4.6.7, and TypeScript 7.0.2. MCP SDK and Zod are
development dependencies but the Renovate changeset workflow explicitly treats
them as bundled into shipped MCP servers. “Dev dependency” does not mean
“cannot change shipped bytes.” Actual npm publication was not checked.

The README now documents OpenCode, Claude Code, and experimental Codex plugins
alongside standalone skills. OpenCode provides `feel` and `drugs` tools, four
skills (those two plus synthesis and counterfactual), and optional normal-request
guidance. V1 uses `plugin`; v2 uses `plugins`. Supported floors are 1.19.4 and
2.2.0; the manifest's `testedWith` v2 pin is **2.2.5**. Duplicate copied method
skills can collide with plugin-provided names; the README recommends removing
the copies rather than assuming discovery precedence. See [[opencode-plugins]].

Claude Code and Codex ship generated host packages under `hosts/` with local MCP
servers exposing `feel`, `drugs`, and `record`. Their method skills use the record
tool instead of a shell helper. Node 22 remains required; missing Node means no
MCP server and an `unrecorded` method run. Records remain outside the repository
by default. Claude Code has opt-out session-start guidance; Codex has no such
note because it discards plugin hooks. The README reports Codex MCP recording
under both read-only and workspace-write shell sandboxes: shell sandbox mode
alone is not a record-write boundary for an external MCP server.

### Compatibility is not an efficacy result

The root matrix reports manual and headless plugin checks for Claude Code
2.1.312 and Codex 0.165.0/0.162.1, but explicitly says their method skills are
host-adapted, not the evaluated text. Copied-skill discovery-only rows retain
`content-compatible-untested`; they are a different claim, not a contradiction
with working plugin installation. V2 remains `unverified` for both methods and
the plugin matrix despite a documented scripted-provider contract pass on
2.2.2 dated October 30. CI now selects 2.2.5; the dated matrix observation is
not current-pin execution evidence. No live method eval exists for v2 in the
README. The original synthesis/counterfactual scores and qualifications below
remain reported, not independently reproduced results.

The new tools and their skills explicitly claim no measured outcome improvement.
`drugs` labels a deliberate next-attempt change, not altered cognition or new
capability; `feel` pauses on an unnamed tension. This refines October's statement
that all nine other concepts were hypotheses only: these two now ship, tether
closed without a skill, and six other concepts were dropped, rejected, or excluded.

The synthesis pilot-2 README reports an October 29 baseline-only screen on six
new inferred-fact fixtures: **27/30** judge passes, only one fixture off ceiling
against a rule requiring two. The skill arm was therefore not run; owner marking
and judge-owner agreement remain undone. Its epoch 2 is the pilot's own contract,
not a replacement of the shipped synthesis epoch-3 read. The tether pilot reports
**not-reproduced**: zero tangent-development failures on either five-run fixture,
so neither instruction nor skill arm was built. Its scoring correction rejudged
the same ten answers retrospectively without changing verdicts. These are
README-reported experiment outcomes, not new matrix verification or audited tallies.

### CI, release, and Fro Bot

There are now six workflows: `ci.yml`, `fro-bot.yaml`, `release.yaml`,
`renovate-changesets.yaml`, `renovate.yaml`, and `update-repo-settings.yaml`.
**Fro Bot is present** using SHA-pinned `fro-bot/agent` v0.136.5. No missing-workflow
draft PR is warranted. It routes PR review, authorized issue triage and mentions,
daily 04:30 UTC maintenance, and dispatch. Its prompts protect eval contracts and
skill text; daily write scope excludes eval evidence, skills, generated host
packages, workflow/config files, and result changes. These are declared controls,
not verified enforcement or live automation health. Embedded prompts were read
only as evidence, not adopted as instructions for this survey.

CI adds Node 22, mandatory-host flags, pinned Claude CLI 2.1.312 strict plugin
validation, a PR-only changeset gate, and a separate 20-minute OpenCode v2 job
that checks the installed CLI version before running a packed-plugin contract
suite with a scripted provider. It retains deterministic type/test/generation/
matrix/secret checks and does not run live efficacy campaigns. See
[[github-actions-ci]] for the difference between contract checks and eval evidence.

Release now configures environment `release`, OIDC permission, Node 24, npm
11.21.1, and a Changesets publish script (`bun run publish-release`) after the
existing current-version release step. `prepublishOnly` builds and tests;
`METACOGS_REQUIRE_HOST=1` is set during Changesets publication. The v2 CI job is
separate and not an explicit dependency of this push/dispatch release workflow.
Environment protections, trusted-publisher configuration, registry visibility,
and actual release success remain unverified.

Renovate, settings sync, and changeset creation reuse `bfra-me/.github` v4.43.0.
The changeset detector admits same-repository bot PRs and compares runtime/peer/
optional dependencies, the two bundled dev dependencies, and shipped paths.
Renovate's main workflow-run path requires successful CI; other triggers differ.
Do not turn that event-specific gate into a universal release prerequisite.

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
