---
title: Verify the Whole Public Perimeter Before Declaring a Value Non-Leaking
date: 2026-06-22
last_updated: 2026-07-04
problem_type: security_issue
category: security-issues
component: development_workflow
module: github-workflows
severity: high
verified: 2026-06-22
tags:
  - privacy
  - redaction
  - public-surface
  - verification
  - canonical-id
  - review-habit
applies_when:
  - a change writes or derives a value that could identify a redacted entity
  - a PR body or review claims a sensitive value "appears on no public surface"
  - a redacted entity's stable canonical identifier (node_id, numeric database_id) is present anywhere in the change
  - a denylist or redaction guard has a design invariant about which identifiers are retained vs rendered
---

# Verify the Whole Public Perimeter Before Declaring a Value Non-Leaking

## Context

A PR committed canonical `database_id` values for redacted repositories into a markdown file in
a public repo. The PR body claimed the values "appear on no public surface," having checked run
logs and confirmed the summary output was counts-only. That verification was incomplete.

Run logs are one surface. The committed file itself is another. The diff is another. The PR body
and review comments are others. Checking only run logs and concluding "not public" missed the
most obvious surface: the file being committed.

The deeper issue: a `database_id` is a stable canonical identifier. It resolves directly via
`GET /repositories/{id}` back to the repo's current owner and name — defeating the entire point
of redaction. A redacted entity's stable canonical id (whether `node_id` or numeric
`database_id`) is a leak by construction, regardless of where it appears. The denylist's design
invariant is that only the internal `node_id` is retained and nothing canonical is rendered
publicly. Writing a `database_id` to a tracked public file violates that invariant, full stop.

Merged at `fce8bd5439696f906221b38302e3c65bdda03654`.

## Guidance

### 1. Enumerate every public surface before claiming non-exposure

Before declaring a value non-leaking, list every surface the change touches and confirm absence
on each:

| Surface | How to check |
|---|---|
| Committed file contents | `git show HEAD:<path>` or read the file |
| Diff | `git diff HEAD~1` — values in context lines count |
| PR body | Read the PR description |
| Review comments | Read all review threads |
| Run logs | Check workflow run output |
| Issue/comment bodies | Any issue or comment created by the change |

Checking one surface and stopping is not verification. The surface you didn't check is where the
leak will be.

### 2. Treat a redacted entity's stable canonical id as a leak by construction

A `node_id` in its legacy base64 form or a numeric `database_id` both resolve back to the
repo's owner and name via public GitHub APIs. Storing either in a public file defeats redaction,
regardless of intent or context. The test is not "is this value sensitive-looking?" but "does
this value resolve to a redacted entity?" If yes, it must not appear on any public surface.

When a denylist or redaction guard has a design invariant (e.g. "only internal `node_id` is
retained; no canonical identifier is rendered"), treat any change that writes a canonical
identifier to a tracked public file as a privacy boundary violation — not a style nit, not a
minor issue.

### 3. Treat the invariant as the gate, not the intent

A change can have good intent and still violate a privacy invariant. The invariant is the
authoritative check. If the invariant says "no canonical id in public files" and the change
writes one, the change is wrong — even if the author believed the value was safe, even if the
run logs look clean.

When reviewing a change that touches redaction or denylist logic, state the invariant explicitly
and verify the change against it, not against the author's description of what they checked.

## Related

- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — the same fail-closed discipline applied to workflow-side privacy checks before any public side effect.
- [Privacy-gate promotion leak prevention](../best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md) — scanning the full promotion diff (not just filenames) to catch in-body mentions of private identifiers.
- [Byte-exact gateway signing and fail-soft telemetry](../best-practices/byte-exact-gateway-signing-and-fail-soft-telemetry-2026-06-04.md) — a related pattern of verifying exact values at a trust boundary rather than relying on prose descriptions.
- `scripts/status-truth-public-output.ts` — a live example of whole-perimeter enforcement: every public output surface (proposal bodies, workflow summary rows, run display names) routes through one gate, and counts-only surfaces (`workflow-summary-row`, `workflow-step-summary`, `workflow-run-display-name`) are structurally forbidden from carrying a fingerprint or canonical-ID parameter — the gate blocks if one is provided.
