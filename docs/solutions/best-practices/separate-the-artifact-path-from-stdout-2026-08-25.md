---
title: Separate the artifact path from stdout
date: 2026-08-25
category: best-practices
module: improvement-metrics
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - "a command writes structured output to an environment-configured file path and also emits a summary to stdout"
  - "a workflow uses tee or a redirect to persist a command's stdout as a JSON artifact"
  - "a downstream step reads a file whose schema differs from the producer's stdout schema"
  - "a repeated shell shape needs to be classified before a generalized cleanup is proposed"
related_components:
  - tooling
  - documentation
tags:
  - github-actions
  - bash
  - artifacts
  - validation
  - test-seam
  - anti-recurrence
  - improvement-metrics
---

# Separate the artifact path from stdout

## Context

Issue #3694 exposed a shell-level schema collision in the improvement-metrics pipeline. The detect script wrote a structured `{digest, edges}` object to the path supplied by `IMPROVEMENT_METRICS_DIGEST_PATH`, then emitted a different, flat counts-only result to stdout. The workflow piped stdout through `tee` into that same path.

> **Learning: A `tee` on a command's stdout will silently clobber a file that the same command already wrote to via an env-configured path.**
>
> Source PR (merge commit `d3acd503c21c488f172f88c5f4e4b063bdcc0c89`) went through two substantive review rounds. The reviewer flagged a wiring defect that would break the feature on its first live dispatch: a detect script wrote a rich `{digest, edges}` object to a file whose path came from an environment variable, then wrote a *different*, flat counts-only shape to **stdout**. The workflow piped that stdout through `tee` into the very same file path. Because `tee` writes after the node process exits, the file ended up containing the stdout shape, not the structured object the downstream report step expected — every consumer field came back `undefined` and the report step threw a `TypeError` on every non-dry-run run.
>
> The reusable lesson: when a program writes structured output to a known file path AND emits a summary to stdout, never route that stdout back into the same path with `tee` (or any redirect). The two writers race and the shell wins last, overwriting the deliberate file with the wrong schema. Keep the file path and the stdout stream as distinct sinks, or have exactly one writer own the file. A guard around the downstream read (validating the expected shape before dereferencing) would also have surfaced the mismatch loudly instead of as a bare `TypeError`.

`tee` writes after the node process exits. The deliberate structured file write therefore happened first, and the shell's stdout copy won last. The report step read the flat shape as if it were `{digest, edges}`: consumer fields became `undefined`, and every non-dry-run report threw a `TypeError`.

The source PR went through two substantive review rounds and merged as `d3acd503c21c488f172f88c5f4e4b063bdcc0c89`, titled `fix(improvement-metrics): stop tee from clobbering the detect digest file`. The relevant remedy is a detect step whose script-owned artifact path is not also a `tee` target. A full verification then checked every matching `node ... | tee ...json` site instead of treating the surface pattern as proof of a defect:

| Site | `tee` target | Script's own configured output path | Verdict |
| --- | --- | --- | --- |
| `capture-learnings.yaml:69` | `harvest-result.json` | `capture-learnings-digest.json` | FINE |
| `capture-learnings.yaml:196` | `open-output.json` | `capture-learnings-result.json` | FINE |
| `capture-patterns.yaml:74` | `detect-result.json` | `capture-patterns-digest.json` | FINE |
| `capture-patterns.yaml:281` | `open-output.json` | `capture-patterns-result.json` | FINE |
| `reconcile-repos.yaml:76` | `reconcile-result.json` | none | FINE |
| `improvement-metrics.yaml:173` | `improvement-metrics-result.json` | `improvement-metrics-result.json` | LATENT |

The five FINE sites have one writer for the `tee` target: either the script writes a different configured path or, for `reconcile-repos.ts`, the script has no file writer at all. Their workflow summary steps read those exact `tee` outputs, so removing the pipes would break working steps. The improvement-metrics report site is latent, not currently broken: its stdout and result-file JSON agree today, but the script and `tee` still share ownership of the path.

The discriminating question is one line: **does the script itself write the path that `tee` targets?** If no, the pipe is the sole writer and is correct. If yes, there are two writers and the shell's version wins because `tee` writes after the process exits.

## Guidance

1. **Give each output one explicit sink and schema.** If a program owns a structured artifact file, let the program write that file. Treat stdout as a separate human- or machine-facing stream with its own contract.
2. **Apply the discriminator before changing the shell.** For every `command | tee path` occurrence, compare `path` with the producer's configured output paths. Do not infer a bug from the presence of `tee` alone.
3. **Preserve a sole-writer pipe.** If the script does not write the `tee` target, the pipe is legitimate and may be load-bearing. In this repo, removing the five FINE pipes would leave the workflow summaries without the files they `jq`.
4. **Remove only the two-writer collision.** When the script itself writes the `tee` target, keep the file path and stdout stream distinct, or make exactly one writer own the path. The shell's later write must not overwrite a deliberate structured artifact.
5. **Do not generalize a surface-pattern fix without classifying each site.** A grep-based sweep that removes every `| tee` would have broken five working steps while fixing one latent issue. Identify the invariant first; then sweep for violations of that invariant.
6. **Validate the artifact at the consumer boundary.** `JSON.parse(raw) as DigestFile` only changes the TypeScript view; it does not prove that the file contains `digest` and `edges`. Reject a wrong shape with an actionable error before dereferencing consumer fields.
7. **Test the production boundary, not only the pure functions.** A regression test should run the real writer against a temporary file, read that file with the real reader, and assert the workflow command's target ownership. The file contract and the shell contract are separate seams.

## Why This Matters

The failure is easy to miss because both writers produce valid JSON. Syntax validation passes while the semantic contract is destroyed. The report does not fail at the write boundary; it fails later, when a consumer expects fields that the overwritten shape never had.

The cost is operational: the original live defect failed every non-dry-run report, while unit tests that passed pre-built `{digest, edges}` objects remained green. The verified current state is more precise: five matching pipes are correct and one is latent, not broken today, because `improvement-metrics-report.ts` sends logs to stderr and writes the same pure JSON to stdout and `IMPROVEMENT_METRICS_RESULT_PATH`. One future `console.log` or other stdout diagnostic would make that shared path destructive. A pattern-based cleanup would be worse than the latent risk because it would remove the five sole-writer outputs their summaries consume.

The downstream cast compounds the problem. A runtime shape guard would have turned a vague `TypeError` into a boundary error naming the malformed artifact and its expected fields. That does not make the two-writer pipeline safe, but it makes the next mismatch fail close to its cause.

## When to Apply

- A CLI writes JSON, YAML, or another structured artifact to a configured path and also prints a summary.
- A workflow uses `tee`, `>`, `>>`, command substitution, or another redirect and you need to determine whether the producer already owns that target.
- A downstream workflow step dereferences data parsed from a file produced by a previous step.
- A proposed cleanup targets a repeated shell shape across workflows; classify each target before editing.
- A report or diagnostic stream may gain future stdout output that is not part of the artifact schema.

## Examples

### Broken: two writers target one artifact path

The detect script deliberately wrote the structured file and separately emitted a flatter result:

```ts
// scripts/improvement-metrics-detect.ts
await writeImprovementMetricsDigestFile(digest, edges)
// Later, after the file write:
process.stdout.write(`${JSON.stringify(result)}\n`)
```

The broken workflow connected that stdout to the same artifact path:

```yaml
# .github/workflows/improvement-metrics.yaml (before the fix)
env:
  IMPROVEMENT_METRICS_DIGEST_PATH: ${{ runner.temp }}/improvement-metrics-digest.json
run: node scripts/improvement-metrics-detect.ts | tee "$RUNNER_TEMP/improvement-metrics-digest.json"
```

The second write was valid JSON but the wrong schema. It replaced `{digest, edges}` with the flat `result` object the report reader did not consume.

### Safe pattern: the detect process owns the file, stdout stays separate

For a site where the script itself owns the `tee` target, the safe detect-step pattern removes the redirect while retaining the configured file path:

```yaml
# .github/workflows/improvement-metrics.yaml (safe pattern for the defective site)
# Do NOT tee stdout into this same path: the script's own stdout is a
# different flat DetectResult shape (no `digest`/`edges` wrapper) than the
# file it writes via writeImprovementMetricsDigestFile, and tee
# would clobber the file after the script's write.
- name: 🔍 Detect improvement-metric edges
  id: detect
  env:
    GITHUB_TOKEN: ${{ github.token }}
    IMPROVEMENT_METRICS_DIGEST_PATH: ${{ runner.temp }}/improvement-metrics-digest.json
  run: node scripts/improvement-metrics-detect.ts
  shell: bash -Eeuo pipefail {0}
```

The important property is ownership, not the absence of a pipe: the file writer is the only writer for the digest path. No workflow change is made by this document. The five FINE sites retain their load-bearing pipes; only a verified two-writer collision warrants this correction.

### Fine beside latent: apply the discriminator

The five sibling sites use `tee` as the sole writer for its target. For example, the harvest script writes `capture-learnings-digest.json`, while the workflow captures its stdout separately as `harvest-result.json`:

```yaml
# .github/workflows/capture-learnings.yaml:69
env:
  CAPTURE_LEARNINGS_DIGEST_PATH: ${{ runner.temp }}/capture-learnings-digest.json
run: node scripts/capture-learnings-harvest.ts | tee "$RUNNER_TEMP/harvest-result.json"
```

That pipe is FINE and load-bearing; the summary step reads `harvest-result.json`. By contrast, the improvement-metrics report site gives `tee` the same path that the script writes:

```yaml
# .github/workflows/improvement-metrics.yaml:173
env:
  IMPROVEMENT_METRICS_RESULT_PATH: ${{ runner.temp }}/improvement-metrics-result.json
run: node scripts/improvement-metrics-report.ts | tee "$RUNNER_TEMP/improvement-metrics-result.json"
```

That site is LATENT rather than currently broken because the script's stdout and file JSON agree today. The discriminator, not the shared `| tee` surface, determines the verdict.

### Unvalidated: a TypeScript cast is not a runtime guard

The report reader currently parses arbitrary file contents and applies a compile-time cast:

```ts
// scripts/improvement-metrics-report.ts
export async function readDigestFile(path: string): Promise<DigestFile> {
  const {readFile} = await import('node:fs/promises')
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as DigestFile
}
```

A boundary guard should parse as `unknown`, validate the wrapper before returning it, and throw a useful error rather than allowing `digestFile.digest` or `digestFile.edges` to become `undefined`:

```ts
export async function readDigestFile(path: string): Promise<DigestFile> {
  const {readFile} = await import('node:fs/promises')
  const raw = await readFile(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('digest' in parsed) ||
    !('edges' in parsed) ||
    typeof parsed.digest !== 'object' ||
    parsed.digest === null ||
    !Array.isArray(parsed.edges)
  ) {
    throw new Error(`invalid improvement-metrics digest artifact: ${path}`)
  }

  return parsed as DigestFile
}
```

The real guard should validate the complete `MetricsDigest` and `DetectEdge` shapes, not only the wrapper. The example shows the important boundary: parse unknown data, check the expected structure, then narrow.

## Related

- [Test the integration seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — the same improvement-metrics failure also exposed a file-mediated seam that unit tests bypassed.
- [Loose-then-tight schema migration pattern](loose-then-tight-schema-migration-pattern-2026-05-05.md) — runtime schema validation guidance for producers and consumers that do not change atomically.
- [Diagnostic patches must fail loudly and preserve stderr](diagnostic-patches-observability-discipline-2026-05-20.md) — keep diagnostics visible without contaminating a structured output stream.
- [Autonomous-pipeline silent failures: status misclassification and additive-pipeline drift](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md) — related failure mode where a multi-step workflow records success after a downstream write failed.
- [Safe workflow consolidation: trace every invariant and caller](../workflow-issues/workflow-consolidation-invariant-trace-2026-06-24.md) — sibling workflow lesson: a point change is unsafe when it does not trace every repeated invariant and caller.
