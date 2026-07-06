---
title: Widen input tolerance in a repair layer that sits before a trust gate, never inside it
date: 2026-07-06
category: best-practices
module: scripts/cross-repo-dispatch.ts
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - accepting almost-valid human- or LLM-authored input for a strict machine format
  - that input feeds an authentication or authorization decision downstream
  - you are tempted to sanitize input inside the trust check itself
tags:
  - tolerant-parsing
  - trust-gate
  - strict-first-repair-second
  - json-escape
  - fail-closed
  - security-invariant
---

# Widen input tolerance in a repair layer that sits before a trust gate, never inside it

## Context

A cross-repo worker did its task correctly and posted a no-op completion receipt, but the item
stalled because the receipt's JSON `summary` contained `\#` — a worker markdown-escaped the `#`
before it went into JSON, and `\#` is not a legal JSON escape, so `JSON.parse` threw and the receipt
was classed unparseable. This is the recurring LLM-emits-a-machine-contract drift class: agents
escaping markdown characters (`#`, backtick, `*`, `_`, `[`) inside JSON string values. The work was
done; only the serialization drifted.

## Guidance

Accept slightly-malformed input with a **strict-first / repair-second** sequence, and place the
repair layer strictly **before** the trust gate — never inside it:

1. Try strict parse first. Valid input never touches the repair path.
2. Only on failure, run a **grammar-aware** repair (scoped to string literals, not a global regex),
   then retry.
3. If it still fails, keep the existing `malformed` outcome — a marker present but unrecoverable
   fails closed and stays visible, never degrading to "absent."

The security invariant to preserve: **the repair widens which candidate inputs get to attempt the
gates; it never touches the gates and cannot manufacture a valid credential.** Here the three
authenticity checks (author, correlation-id mapping, `hashNonce(receipt.nonce) === item.nonceHash`)
run unchanged after parsing. A repair layer can widen the door but must not be able to forge a key.

## Why This Matters

Widening tolerance is where security boundaries quietly erode if the repair is done in the wrong
place. The reason this repair is safe is worth stating as a reusable invariant: it cannot forge a
preimage. Nonces are minted from `randomBytes(32).toString('base64url')`, whose alphabet
(`[A-Za-z0-9_-]`) contains nothing the escape-repair walker rewrites — so a legitimate nonce passes
through untouched, while a nonce mangled by repair simply fails the hash gate. Tolerance only lets
more receipts *attempt* the gates; it can never move a forged one past them.

## When to Apply

- You need to accept human- or LLM-authored input that is *almost* valid for a strict machine format.
- That input feeds an authentication/authorization decision downstream.
- You are tempted to "clean up" the input inside the trust check — don't; repair before, gate after.

## Examples

Two secondary lessons carried the same weight as the main fix:

1. **Fail closed on genuinely-corrupt input.** The grammar-aware walker preserves valid escapes
   (`\" \\ \/ \b \f \n \r \t`, well-formed `\uXXXX`) and deliberately leaves malformed `\u` escapes
   and lone trailing backslashes broken rather than guessing intent. Do not invent bytes.
2. **The regression test that matters most proves a repaired-but-mismatched nonce is still
   rejected.** Without it, a future loosening of the repair could silently weaken the boundary and no
   test would notice.

A related edge from the same review: marker extraction that terminated at the first `-->` truncated a
receipt whose summary contained a literal `-->`. The fix made extraction string-scope-aware (only an
out-of-string `-->` terminates), the same discipline as the escape walker — parse structure with
awareness of string literals, not with a greedy delimiter match.

## Related

- Source PR (merge commit): `c936909bff90fd22f45c9201cb336e7acbd0ea8d`
- `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md` — the receipt
  design whose trust gate this tolerance sits in front of
- `docs/solutions/best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md` — a related
  "be liberal in what you accept, on your terms" pattern in a different layer
