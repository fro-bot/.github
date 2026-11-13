---
title: Count the observed handler boundary, not every incoming request
date: 2026-11-09
category: best-practices
module: packages/wiki-ops/src/knowledge-mcp.ts
problem_type: best_practice
component: tooling
severity: medium
last_updated: 2026-11-14
applies_when:
  - handler instrumentation is summarized as request usage
  - adapters can reject arguments before handlers run
  - optional diagnostics must not affect tool results
tags:
  - observability
  - mcp
  - lifecycle-boundaries
  - fail-soft
---

# Count the observed handler boundary, not every incoming request

## Context

PR #4136 added optional knowledge-tool call logging. Review identified a contract ambiguity:
logging occurs when handlers complete, but the MCP adapter can reject arguments before invoking
them. The follow-up clarified that boundary in `packages/wiki-ops/README.md` without runtime changes.

## Guidance

Describe the observed lifecycle event explicitly. These counts are best-effort completed-handler
usage, not a complete incoming-request count or an audit trail. Missing records cannot establish
that no requests arrived: adapter rejection and append failure both lie outside the count.

Keep diagnostic writes independent of tool results. The server appends only a fixed tool name and
`ok` or a fixed error code, omitting arguments, queries, paths and results. It ignores append failures.
The summary action reads its log path through environment data rather than interpolating it into
shell source, and prints only lines matching its restricted tool/code format.

The summary separates three outcomes ([#4219](https://github.com/fro-bot/.github/pull/4219)). A missing or
unreadable log prints `Knowledge tools: no call log found (the server did not start, or the run had no log path).`
A log with no matching line prints `Knowledge tools: server started, no calls.` Recorded calls print a table.
An empty log still does not prove that no request arrived: adapter rejections and failed appends stay outside
the count. [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md)
covers why the three outcomes are three lines.

## Why This Matters

A correct count at one boundary becomes misleading when described as a count at another. Optional
usage diagnostics intentionally tolerate lost records; an audit claim would require a different
completeness and delivery contract.

## When to Apply

Use this distinction for adapter-backed tools and middleware where validation can precede handler
execution, especially when logging is optional or fail-soft.

## Examples

- A completed handler can record `wiki_search ok`.
- A request missing the required query can be rejected by the adapter with no handler log line.
- An unwritable log still leaves the tool's returned result unchanged.

The PR's spawned-server test exercises a real request-to-log seam. Review accepted that evidence,
but explicitly left live GitHub summary delivery unverified. A live run has since printed the step-log line:
[run 43509825059](https://github.com/fro-bot/.github/actions/runs/43509825059) shows
`Knowledge tools: server started, no calls.` (2026-11-13T21:22:19Z). Neither proves all requests are logged.

## Related

- Source PR #4136: merge `3e69886432ac401cb39a924f1fe224d5d4bfa08d`.
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): the three summary outcomes and the live line.
- [Test the integration seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md) — `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md`.
