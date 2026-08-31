---
title: Extend status vocabularies across every reporting surface
date: 2026-08-31
last_updated: 2026-08-31
category: best-practices
module: .github/workflows/fro-bot.yaml
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "a report distinguishes clean, warning, error, or unverifiable states"
  - "a status vocabulary appears in prose, tables, schemas, parsers, or tests"
  - "an automated check can be unavailable, stale, empty, denied, or incomplete"
tags:
  - closed-vocabulary
  - status-truth
  - drift-detection
  - enumeration
  - github-actions
  - test-seam
  - anti-recurrence
---

# Extend status vocabularies across every reporting surface

## Context

The daily oversight contract changed in #3803 when `could-not-check` was separated from
`verified-clean`. An unavailable source, stale snapshot, access denial, or failed scan is
not evidence that the check passed. The current `SCHEDULE_PROMPT` in
`.github/workflows/fro-bot.yaml` defines `❔` for that state and requires the affected
source and reason to be named.

The change also tightened the bounded methods behind the report: paginated repository
enumeration, a read-access definition, ranked hotspots with linked evidence, explicit
aging and staleness clocks, complete tracked-repository coverage, and comparison against
the authoritative rollout source. Those instructions are operational contracts, not
decorative prose.

## Guidance

1. **Model unverifiable as a distinct state.** Never reuse the clean symbol for missing,
   stale, denied, empty, or failed input. A false green is a different outcome from a
   clean scan.
2. **Inventory the vocabulary's full surface before editing.** Search for the old
   symbols and words in legends, tables, schemas, parsers, serializers, fixtures, and
   tests. Update every enumerator in the same change.
3. **Keep one authoritative classification contract.** The legend, report placeholders,
   and output parser must agree on the same finite set and its meanings.
4. **Turn prose obligations into contract tests.** Parse the workflow prompt as the
   production YAML does, then assert the symbols, definitions, and bounded-method
   requirements that must not drift.
5. **Treat coverage as part of the status.** If a source could not be enumerated or a
   required comparison was skipped, report `could-not-check` even when every observed
   item looked clean.

## Why This Matters

Status reports are consumed as decisions. When clean and unverifiable collapse into one
symbol, an operator cannot tell whether the system found nothing or looked nowhere. That
ambiguity is a false-green class: the report appears healthy while its evidence boundary
is unknown.

Partial vocabulary changes are just as dangerous. If the legend teaches four symbols but
the table advertises three, consumers and downstream parsers receive conflicting contracts.
The missing symbol is not merely a display defect; it is a path for the old semantics to
return. Updating all enumerators and pinning the prompt in a test makes the contract
structurally harder to regress.

## When to Apply

- Adding an `unknown`, `unavailable`, `partial`, `stale`, or `could-not-check` outcome.
- Changing a report legend, placeholder table, JSON enum, parser, or status formatter.
- A workflow aggregates multiple sources and some sources can fail independently.
- Prompt text carries requirements about pagination, coverage, ranking, or authoritative
  sources.
- A clean status would be misleading if any required input was not observed.

## Examples

### The four-symbol report contract

The current Run Summary placeholders enumerate all four states:

```markdown
| Errored PRs | ✅/⚠️/❌/❔ | ... |
| Security | ✅/⚠️/❌/❔ | ... |
| Progressive Improvement | ✅/⚠️/❌/❔ | ... |
```

The legend then defines the distinction operationally:

```text
✅ = verified-clean
⚠️/❌ = warning or error
❔ = could-not-check
Use ✅ only when all required sources were checked and nothing was found.
Use ❔ when any source is unavailable, stale, empty, access denied, or scan failed.
Never render ✅ for could-not-check.
```

### Contract test at the production seam

`scripts/fro-bot-workflow-progressive-improvement.test.ts` parses the actual workflow
file, extracts `env.SCHEDULE_PROMPT`, and asserts both vocabulary and method coverage:

```ts
expect(prompt).toContain('✅/⚠️/❌/❔')
expect(prompt).toContain('paginated repository listing')
expect(prompt).toContain('could not be enumerated')
expect(prompt).toContain('top three repo hotspots')
expect(prompt).toContain('mark coverage partial')
expect(prompt).toMatch(/Never\s+render ✅ for could-not-check/)
```

The test does not prove that the bot followed the prompt at runtime. It does prove that
the checked-in prompt cannot silently lose the fourth state or its evidence requirements
without a failing suite. The same inventory must be applied to any schema enum, renderer,
or report fixture added later.

## Related

- [Closed-vocabulary identifiers for automated inspection and drift detection](closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md) — normalize external text into finite identifiers before it reaches reports or recovery logic.
- [Synthetic self-audit claim kinds for in-file drift detection](status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md) — use the artifact's own structure to expose drift instead of trusting prose claims.
- [A code path exercised only by pre-built fixtures is an untested seam — test the seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — verify prompt and file-mediated contracts at their real boundary.
- [Shared invariants need one implementation and an explicit removal path](shared-invariants-need-one-implementation-2026-08-31.md) — the same partial-application failure mode at a code and type boundary.
