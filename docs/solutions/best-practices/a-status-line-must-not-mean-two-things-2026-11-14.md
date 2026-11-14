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

The knowledge-tool summary step printed `Knowledge tools: no calls recorded.` when the server ran and no tool was called, and when the call log never existed. The line could not say whether the tools were there. The summary came with [#4136](https://github.com/fro-bot/.github/pull/4136) and the step-log copy with [#4188](https://github.com/fro-bot/.github/pull/4188). Counting the `fro-bot.yaml` runs created between the merges of #4188 and #4219, and matching the emitted line in each run log, gives 33 such lines across 31 runs from 2026-11-12 to 2026-11-13, for example run 43489008878. [#4219](https://github.com/fro-bot/.github/pull/4219) split the line into three outcomes.

The Renovate approver had the same shape. When it holds a ready Renovate PR because another open pull request from this repository, by a user account, comes first, the row is `yielded`. That row named no PR in the step log, only in the job summary, which the run-log CLI and the REST API do not return ([#4220](https://github.com/fro-bot/.github/pull/4220), on the yield rule of [#4207](https://github.com/fro-bot/.github/pull/4207)).

## Guidance

1. **Give each state that a reader must tell apart its own fixed line, and test each line.** The step prints a table, `Knowledge tools: server started, no calls.` or `Knowledge tools: no call log found (the server did not start, or the run had no log path).` (`.github/actions/knowledge-mcp-summary/action.yaml:46-58`; `scripts/knowledge-mcp-summary-action.test.ts:39-40`).
2. **Have the producer leave evidence when it starts, and read each state for what it proves.** `serve` creates the call log empty once the transport is attached (`packages/wiki-ops/src/knowledge-mcp.ts:313-314`, `createCallLog` at `:123-131`, the header comment at `:18-23`). An empty readable log means that the transport attached and no matching call was recorded. A missing or unreadable log is no evidence either way: the server did not start, no path reached it, or the create failed, and `createCallLog` swallows a failed create. Appends can fail the same way (`respond`, `:138-146`), the summary counts only lines of the exact `<tool> <code>` shape (`.github/actions/knowledge-mcp-summary/action.yaml:39`), and the survey's three attempts share one log (`action.yaml:33-34`). Neither state proves that no request arrived.
3. **Word the line to what the evidence proves.** The file is created before the client initializes, and `@goke/mcp` keeps its `Server` private (`knowledge-mcp.ts:18-21`), so the line says `server started`. A line that said `available` would claim that the agent saw the tools, and the file does not prove it.
4. **Report a missing or unreadable log as no log, not as zero calls.** The step requires `-f` and `-r` before it reads (`action.yaml:37`), and an unreadable file prints the no-log line (`scripts/knowledge-mcp-summary-action.test.ts:146-159`). Without the readability check an unreadable file could be read as an empty log and print `server started, no calls`.
5. **Put the fact each reader needs in a stream that reader can fetch.** `emit` writes the same text to stdout and to the job summary (`action.yaml:43-45`, `:60-61`). The step log is the stream that the run-log CLI and the REST API return. `yielded` rows now end with the blocking PR (`packages/registry/src/renovate-approve.ts:782-789`, `stdoutRow`).
6. **Carry the value as data on the row and format it in one place.** `yieldedTo` is set where the row is built (`renovate-approve.ts:135-136`, `:634-638`) and `stdoutRow` appends ` to #<n>`. Nothing parses the detail text. The row prints the number only: a pull request title is free text from the author, and the number is an integer from the open list.
7. **Test that every other outcome's line is unchanged.** `packages/registry/src/renovate-approve.test.ts:2798-2820` checks that the 19 other outcome codes print `renovate-approve: #<n> <outcome>`, so a reader that matches those rows keeps working.
8. **Read the live output after the merge.** A live `server started, no calls` line is in run 43509825059: a pull request run, created 2026-11-13T21:20:35Z after the merge of #4219 at 21:17:52Z, printed it at 21:22:19Z. A live `yielded to` row is `renovate-approve: #4217 yielded to #4221` in run 43520124873, 2026-11-13T22:32:54Z; runs such as 43512257282 printed `#4217 yielded` before the change.

## Why This Matters

A line with two meanings can hide a failure behind a normal-looking line. Counting `no calls recorded` as "the agent chose not to search" credits a server that may never have started. A row that omits the blocker sends the reader to a stream they cannot fetch, or to a guess. Each rule closes one of these routes.

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
renovate-approve: #4217 yielded to #4221
```

## Related

- [Count the observed handler boundary](count-the-observed-handler-boundary-2026-11-09.md): what a call-log line counts.
- [Extend status vocabularies across every reporting surface](status-vocabulary-must-cover-every-report-surface-2026-08-31.md): an unavailable source is its own state, not the clean one.
- [Read the test before crediting a requirement to it](read-the-test-before-crediting-a-requirement-to-it-2026-11-14.md): a static proxy is not the thing it stands for; a test title is not the requirement, as the line `server started` is not `available`.
- [An import closure does not see what a test reads at run time](an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md): a static proxy is not the thing it stands for; here an existing call log is not proof that the agent saw the tools (rule 3).
- [Check the first live event before trusting an event-driven workflow](check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md): rule 8, applied to a log line.
- [Observability before structural change](observability-before-structural-change-2026-06-09.md): evidence first, then the fix.
- [Separate the artifact path from stdout](separate-the-artifact-path-from-stdout-2026-08-25.md): which stream a result belongs in.
