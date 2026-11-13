---
title: A status line must not mean two things
date: 2026-11-14
category: best-practices
module: packages/wiki-ops/src/knowledge-mcp.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a step prints one line for both "ran and found nothing" and "never ran"
  - an observability output is read by a person or a script after the run
  - a producer can leave evidence at start that a consumer reads later
  - the fact a reader needs sits in a stream the reader cannot fetch
tags:
  - observability
  - job-summary
  - step-log
  - call-log
  - knowledge-mcp
  - renovate-approve
---

# A status line must not mean two things

## Context

The knowledge-tool summary step printed `Knowledge tools: no calls recorded.` when the server ran and no tool was called, and when the call log never existed. The line could not say whether the tools were there. The logs of `fro-bot.yaml` held 33 such lines across 31 runs from 2026-11-12 to 2026-11-13, for example run 43489008878. [#4219](https://github.com/fro-bot/.github/pull/4219) split the line into three outcomes after [#4136](https://github.com/fro-bot/.github/pull/4136) added the summary and [#4188](https://github.com/fro-bot/.github/pull/4188) added the step-log copy.

The Renovate approver had the same shape. A `yielded` row named no PR in the step log, only in the job summary, which the run-log CLI and the REST API do not return ([#4220](https://github.com/fro-bot/.github/pull/4220), on the yield rule of [#4207](https://github.com/fro-bot/.github/pull/4207)).

## Guidance

1. **Give each state that a reader must tell apart its own fixed line, and test each line.** The step prints a table, `Knowledge tools: server started, no calls.` or `Knowledge tools: no call log found (the server did not start, or the run had no log path).` (`.github/actions/knowledge-mcp-summary/action.yaml:46-58`; `scripts/knowledge-mcp-summary-action.test.ts:39-40`).
2. **Have the producer leave evidence when it starts, so absent differs from zero.** `serve` creates the call log empty once the transport is attached (`packages/wiki-ops/src/knowledge-mcp.ts:313-314`, `createCallLog` at `:123-131`). An empty file is zero calls, and no file is no server.
3. **Word the line to what the evidence proves.** The file is created before the client initializes, and `@goke/mcp` keeps its `Server` private (`knowledge-mcp.ts:18-21`), so the line says `server started`. A line that said `available` would claim that the agent saw the tools, and the file does not prove it.
4. **Treat what the reader cannot read as absent.** The step requires `-f` and `-r` before it reads (`action.yaml:37`), and an unreadable file prints the no-log line (`scripts/knowledge-mcp-summary-action.test.ts:146-159`). Without it a file the step cannot open would print `server started`.
5. **Print the same text where the reader can fetch it.** `emit` writes to stdout and to the job summary (`action.yaml:43-45`, `:60-61`). `yielded` rows now end with the blocking PR (`packages/registry/src/renovate-approve.ts:782-789`, `stdoutRow`).
6. **Carry the value as data on the row and format it in one place.** `yieldedTo` is set where the row is built (`renovate-approve.ts:135-136`, `:634-638`) and `stdoutRow` appends ` to #<n>`. Nothing parses the detail text. Print the number only, never a title.
7. **Pin every other outcome as unchanged.** `packages/registry/src/renovate-approve.test.ts:2798-2820` checks that the 19 other outcome codes print `renovate-approve: #<n> <outcome>`.
8. **Read the live output after the merge.** A live `server started, no calls` line is in run 43509825059, 2026-11-13T21:22:19Z, a pull request run created three minutes after the merge (2026-11-13T21:17:52Z). A live `yielded to` row is `renovate-approve: #4217 yielded to #4221` in run 43520124873, 2026-11-13T22:32:54Z; runs such as 43512257282 printed `#4217 yielded` before the change.

## Why This Matters

A line with two meanings reports success for a failure. Counting `no calls recorded` as "the agent chose not to search" credits a server that may never have started. A row that omits the blocker sends the reader to a stream they cannot fetch, or to a guess. Each rule closes one of these routes.

## When to Apply

- A step prints a count, and zero can mean a clean run or a missing input.
- A summary, a log and an API each show part of a result, and the reader has one of them.
- A new line claims more than "the file exists" or "the call returned".

## Examples

The three-outcome branch of the step (`action.yaml:46-58`):

```bash
emit() {
  if [ "$found" = no ]; then
    printf 'Knowledge tools: no call log found (the server did not start, or the run had no log path).\n\n'
  elif [ -z "$counts" ]; then
    printf 'Knowledge tools: server started, no calls.\n\n'
  else
    printf '### Knowledge tool calls\n\n| Tool | Code | Calls |\n| --- | --- | ---: |\n'
    while read -r count tool code; do
      printf '| %s | %s | %s |\n' "$tool" "$code" "$count"
    done <<< "$counts"
    printf '\n'
  fi
}
```

The row text, with the blocker as data (`renovate-approve.ts:786-789`):

<!-- verify: stdoutRow from packages/registry/src/renovate-approve.ts -->
```ts
export function stdoutRow(row: Row): string {
  const target = row.yieldedTo === undefined ? '' : ` to #${String(row.yieldedTo)}`
  return `renovate-approve: #${String(row.number)} ${row.outcome}${target}\n`
}
```

```text
renovate-approve: #4217 yielded to #4221   (outcome yielded, yieldedTo 4221)
renovate-approve: #4217 behind             (any other outcome)
```

## Related

- [Count the observed handler boundary](count-the-observed-handler-boundary-2026-11-09.md): what a call-log line counts.
- [Extend status vocabularies across every reporting surface](status-vocabulary-must-cover-every-report-surface-2026-08-31.md): an unavailable source is its own state, not the clean one.
- [Read the test before crediting a requirement to it](read-the-test-before-crediting-a-requirement-to-it-2026-11-14.md): a static proxy is not the thing it stands for; a test title is not the requirement, as the line `server started` is not `available`.
- [An import closure does not see what a test reads at run time](an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md): a static proxy is not the thing it stands for; here an existing call log is not proof that the agent saw the tools (rule 3).
- [Check the first live event before trusting an event-driven workflow](check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md): rule 8, applied to a log line.
- [Observability before structural change](observability-before-structural-change-2026-06-09.md): evidence first, then the fix.
- [Separate the artifact path from stdout](separate-the-artifact-path-from-stdout-2026-08-25.md): which stream a result belongs in.
