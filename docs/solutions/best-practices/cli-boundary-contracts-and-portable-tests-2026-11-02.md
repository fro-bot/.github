---
title: CLI boundary contracts need pre-parse guards and portable test oracles
date: 2026-11-02
category: best-practices
module: packages/core/src/cli.ts
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - a shared CLI runner accepts untrusted argv through an object-building parser
  - a parser and a schema both provide defaults or positional validation
  - subprocess tests depend on output delivery or immediate process exit
tags:
  - cli
  - parser-boundary
  - prototype-pollution
  - schema-defaults
  - subprocess-tests
  - portable-assertions
---

# CLI boundary contracts need pre-parse guards and portable test oracles

## Context

PR #4081 introduced the shared goke runner. Review reproduced prototype mutation before
post-parse validation, missing required positionals reaching actions, and schema defaults being
processed twice. It also found a test requiring forced exit to truncate stdout, although Bun
sometimes delivered the entire payload. The merged corrections remain in current main's
`packages/core/src/cli.ts` and its regression suites.

## Guidance

1. **Guard before the parser can mutate state.** Post-parse rejection cannot undo writes through
   inherited properties. This runner rejects every dotted option name and names found in
   `Object.prototype` before `cli.parse()`, and rejects those names in declarations too. A
   `__proto__`/`constructor`/`prototype` segment blocklist was insufficient: inherited methods and
   arrays provided other traversal paths. This rule is specific to the parser's object-building
   behavior, not a universal ban on dots in values or positionals.
2. **Validate declarations against the runner's own mapping.** Reject optional-before-required
   positionals and nonterminal variadics during configuration checking. Before invoking an action,
   independently check required values at the indices the runner will actually map.
3. **Give defaults one owner.** Register goke commands with `ignoreOptionDefaultValue()` and let
   schema preparation apply defaults once. Preserve default metadata in help and continue validating
   explicit values against full schemas. Test omitted values against `schema.parse(undefined)`;
   transforms and refinements make double processing observable.
4. **Assert the promised output, not a possible failure mode.** `runCliMain` writes output and sets
   `process.exitCode`, allowing natural exit rather than forcing termination. Spawn the entrypoint
   under Bun and Node and compare the entire payload. Do not require `process.exit()` to truncate:
   possible truncation motivates defensive implementation but is not a portable test oracle.
5. **Isolate hostile-input probes.** Run each pollution case in a child process. Assert rejection,
   no action invocation, unchanged built-in descriptors, and working built-ins afterward, so a
   regression cannot poison the test runner itself.

## Why This Matters

An error result does not prove the parser left shared state unchanged. Likewise, a green validation
suite can conceal disagreement between parser defaults, schema semantics, and positional mapping.
Boundary tests must check both the result and the effects that happened before it.

The failed Test job in [run 41243557454](https://github.com/fro-bot/.github/actions/runs/41243557454)
reported `expected 300000 to be less than 300000` for the forced-exit control. The fixing diff
removed that control; the final suite retains exact natural-exit delivery. This is evidence of an
invalid mandatory-truncation assertion, not evidence that forced exit is safe on every pipe.

## When to Apply

- Wrapping a parser that constructs nested objects or keeps options in plain objects.
- Combining parser argument checks with a separately mapped action interface.
- Passing schema defaults through another default-producing layer.
- Testing process output where runtime and pipe behavior can vary.

## Examples

Verified regression cases in `packages/core/src/cli.test.ts`, `cli.pollution.test.ts`, and
`cli.spawn.test.ts` include:

| Case | Required contract |
| --- | --- |
| `--toString.call=attacker` or `--a.0=x --a.map.call=attacker` | Reject before parsing; built-ins unchanged; no action |
| Bare `--__proto__` | Reject before parsing, rather than silently running an action |
| `[scope] <confirmation>` declaration | Reject the unsupported layout |
| Omitted `z.string().trim().default('  keep spaces  ')` | Preserve the default's spaces, matching direct schema parsing |
| Omitted `z.number().min(10).default(1)` | Deliver `1`; an explicit `5` still fails validation |
| Natural exit after writing 300,000 `x` characters | Exit successfully and receive exactly the full string under Bun and Node |

## Related

- Source PR #4081, merge commit: `4f8659294dcd0d0c779c5e727f609ed0d09d33d4`.
- `docs/solutions/best-practices/calibrate-performance-guards-before-trusting-bounds-2026-10-09.md` —
  [calibrate performance guards](calibrate-performance-guards-before-trusting-bounds-2026-10-09.md);
  related test-oracle discipline, but timing calibration rather than parser and process contracts.
- `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md` —
  [test the integration seam](test-the-integration-seam-not-the-endpoints-2026-07-06.md);
  subprocess output needs the real process boundary, not just in-process sinks.
