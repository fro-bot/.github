---
title: A token minted for one installation cannot speak for another — mint per-owner, fail loud
date: 2026-07-06
category: best-practices
module: scripts/cross-repo-dispatch.ts
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - a coordinator acts on repos across more than one owner or App installation
  - you are minting a GitHub App token and about to reuse it beyond its installation
  - a tracking or reconcile pass treats a missing token as a terminal state
tags:
  - github-app
  - installation-token
  - cross-repo
  - least-privilege
  - credential-topology
  - fail-loud
---

# A token minted for one installation cannot speak for another — mint per-owner, fail loud

## Context

Cross-repo dispatch minted a single token scoped to the coordinating repo's owner and used it to
`createWorkflowDispatch` into repos owned by a *different* account. It returned `403 Resource not
accessible by integration` even though the token carried `actions: write`. The 403 was not a missing
permission you could grant — it was an **installation boundary** being pretended away. A GitHub App
token minted for owner A's installation has no authority in owner B's installation, full stop.

## Guidance

Split the credential topology by role, and mint a distinct token per installation you act against:

- **Control-plane credential** — narrow scope (e.g. `issues: write` restricted to the coordinating
  repo) for marker/comment/close operations on the coordination surface.
- **Per-owner target tokens** — one minted for each installation the coordinator dispatches into,
  each scoped to what that target action needs (`actions: write` for dispatch). Route target
  operations through an owner-keyed token map; fail closed if an eligible owner has no token.

When the owners belong to different GitHub Apps (here: a `fro-bot` App for `fro-bot/*` targets and a
separate `mrbro-bot` App for `marcusrbrown/*` targets), mint from the matching App's credentials per
owner. The consumer code only ever sees an owner→token map and does not care which App minted each
entry — keep the App private keys in the workflow mint layer, out of the script.

## Why This Matters

"One token, one call" thinking silently breaks in a multi-installation system, and the failure is a
runtime 403 rather than a compile error. Getting the topology right up front avoids a class of
"works for my repos, 403s for yours" bugs. There is also a **fail-loud** invariant that is
load-bearing for correctness downstream: the mint steps are **not** `continue-on-error`, so a
misconfigured or missing App secret fails the whole job and the token map is always fully populated.

## When to Apply

- A coordinator acts on repos across more than one owner/installation.
- You are minting a GitHub App token and about to reuse it beyond the installation it was minted for.
- A tracking/reconcile pass treats a missing token as a terminal state (e.g. `blocked`).

## Examples

A subtle operational invariant surfaced in review and is worth recording next to the fix: the
token-gap handling in the tracking pass assumes dispatch-time mint parity. Because mints fail loud,
the token map is always complete, so a token gap can only mean broken infra — not an expected runtime
state. If a future change removes an owner from the mint set or reintroduces `continue-on-error`, an
already-dispatched item could be silently re-marked `blocked`, overwriting a real `completed`/`failed`
conclusion. Annotate the token-gap path so nobody softens the mints without seeing that consequence.

Minor but reusable hygiene note: interpolating a token map as inline JSON in a workflow `env:` block
is safe *only* because App tokens (`ghs_[A-Za-z0-9_]+`) are auto-masked and their charset cannot break
JSON quoting or inject a key. Safety that depends on the value's charset deserves a comment so it is
not accidentally extended to values without that guarantee.

## Related

- Source PR (merge commit): `a3dca8f8d603b1f2719b022addfb17751dd7095a`
- `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md` — the
  complementary lesson that a *second* credential gives rotation isolation, not permission isolation;
  scope at mint time. This doc is the installation-boundary counterpart: even correctly-scoped, a
  token cannot cross into another installation.
- `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md` — the dispatch
  loop these tokens serve
