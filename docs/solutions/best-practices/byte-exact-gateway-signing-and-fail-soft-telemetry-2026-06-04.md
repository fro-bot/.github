---
title: Byte-exact HMAC signing and fail-soft telemetry for an already-shipped verifier
date: 2026-06-04
category: best-practices
module: gateway-announce
problem_type: best_practice
component: tooling
severity: medium
last_updated: 2026-06-04
verified: 2026-06-04
applies_when:
  - Integrating with an already-deployed HMAC verifier
  - Signing an outbound webhook or POST payload
  - Best-effort telemetry must not fail the host workflow
  - A value flows into a public or rendered surface
  - Timestamp and body must stay byte-identical across systems
tags:
  - hmac
  - webhook-signing
  - raw-body
  - fail-soft
  - redaction
  - telemetry
  - github-actions
related_components:
  - survey-repo.yaml
  - poll-invitations.yaml
  - wiki-ingest.ts
---

# Byte-exact HMAC signing and fail-soft telemetry for an already-shipped verifier

## Context

The control plane gained a presence feature: detect an event (a completed survey, an
accepted invitation), sign a payload, and POST it to a separate gateway service that
renders and posts the message to Discord as the bot user. The gateway was **already
shipped and deployed** before the control-plane POST side was built — so the design
document predated the running code.

The requirements doc assumed one signing contract; the deployed gateway implemented a
different one. Reconciling the doc against the **shipped code** (not the other way
around) was the difference between a working integration and a stream of silent `401`s.

## Guidance

### 1. Sign the exact bytes you send — reconcile against shipped code, not the design doc

The brainstorm assumed JSON canonicalization (sort keys, re-serialize, then sign). The
deployed gateway signs the **raw request body bytes**: `HMAC(secret, timestamp + "." + rawBody)`.
Canonicalizing before signing would have produced a signature over different bytes than
were sent — every request rejected.

Capture the timestamp once and serialize once, then sign and send those same bytes:

```ts
function hmacSha256Hex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

// Capture the timestamp ONCE — it drives both the body field and the header.
const ts = getNow()
// Serialize ONCE — sign these exact bytes, send these exact bytes.
const body = JSON.stringify(payload)
// HMAC-SHA256(secret, "<timestamp>.<body>") — matches the gateway's formula.
const sig = hmacSha256Hex(secret, `${ts}.${body}`)
```

Two byte-equality traps the verifier enforces:

- **`fired_at` in the body must byte-match the timestamp header.** The gateway returns
  `400` on mismatch. A single `ts` string must populate both `payload.fired_at` and the
  `X-Gateway-Timestamp` header — never format them separately.
- **No canonicalization.** "Sign what you send" — the bytes handed to `JSON.stringify`
  are the bytes signed and the bytes POSTed.

Pin the contract with a test that recomputes the signature **independently** (so the test
can't drift in lockstep with a buggy signer):

```ts
const expectedSig = createHmac('sha256', TEST_SECRET)
  .update(TEST_TS)
  .update('.')
  .update(sentBody)
  .digest('hex')
expect(sentSig).toBe(expectedSig)
```

### 2. Fail-soft telemetry that cannot break the host workflow

Presence is best-effort. A quiet, slow, or unreachable gateway must never break a survey
or a poll. Four properties enforce that:

- **Always exit 0** at the CLI; the announce step is **excluded from the job's success
  aggregation**.
- **Per-attempt timeout** via `AbortSignal.timeout` so a hung gateway can't stall the
  step until the job timeout.
- **Single retry on transient failure only** (5xx / network throw / timeout); `4xx` is
  terminal.
- **Every non-posted result names its reason** through a discriminated union, so no
  `{posted:false}` is silently shapeless:

```ts
export type AnnounceResult =
  | {posted: true; status: number}
  | {posted: false; skipped: 'kill-switch' | 'missing-config'}
  | {posted: false; failure: 'http'; status: number}
  | {posted: false; failure: 'network'}
  | {posted: false; failure: 'missing-event-type'}
  | {posted: false; failure: 'invalid-event-type'}
  | {posted: false; failure: 'missing-context'}
  | {posted: false; failure: 'malformed-context'}

const doPost = async (): Promise<Response> =>
  fetchImpl(url, {method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs)})
```

The workflow gate keeps the announce downstream of the real work and never lets it
contribute to status:

```yaml
- name: 📣 Announce survey to gateway
  if: >-
    ${{ !cancelled() && steps.recheck.conclusion == 'success' &&
    steps.survey-agent.conclusion == 'success' &&
    (steps.wiki-commit.conclusion == 'success' || steps.wiki-commit.conclusion == 'skipped') }}
```

### 3. Never render a placeholder value into a public surface

The payload carried `wiki_pages_changed: 0` as a hardcoded placeholder. The gateway's
template renders that number **verbatim** into the Discord message
(`Surveyed owner/repo, added N wiki entries`). A decorative placeholder is fine in an
internal struct, but the moment it reaches a rendered public surface it becomes a
published lie — every announce would have claimed "added 0 entries."

The schema also declared the field **required**, so "drop the field" was not an option —
it had to carry a real value. The producer already knew the count; it just wasn't
emitting it:

```ts
const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/

export function countWikiPages(paths: string[]): number {
  return paths.filter(p => WIKI_PAGE_PATTERN.test(p)).length
}

async function emitPagesChanged(n: number): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    await appendFile(outputPath, `pages_changed=${n}\n`)
  }
}
```

Thread it through the workflow via an env var (never interpolate `${{ steps.* }}`
directly into a `run:` shell), with a `0` fallback for the legitimate no-op case so
`--argjson` always receives a valid number:

```yaml
env:
  WIKI_PAGES_CHANGED: ${{ steps.wiki-commit.outputs.pages_changed || '0' }}
run: |
  EVENT_CONTEXT_JSON="$(jq -nc \
    --arg owner "$REPO_OWNER" \
    --arg repo "$REPO_NAME" \
    --arg slug "$REPO_SLUG" \
    --argjson pages "${WIKI_PAGES_CHANGED:-0}" \
    '{owner: $owner, repo: $repo, slug: $slug, wiki_pages_changed: $pages}')"
```

### 4. Redaction discipline on a signed POST

A signing path handles a secret, a computed signature, a timestamp, and a body. None of
those belong in logs. Emit only the event type and a coarse status:

```ts
process.stderr.write(`gateway-announce: event_type=${params.eventType} status=${retryRes.status} posted=false\n`)
```

Prove it with a test that computes the real secret/signature/body and asserts they are
**absent** from captured stderr — not merely that some redaction ran.

## Why This Matters

- **Contract drift is a silent failure.** A signature mismatch surfaces as `401`/`400`
  with no payload detail. Reconciling against the deployed verifier's code up front
  avoids a debugging spiral over bytes you can't see.
- **Telemetry must not endanger the work it observes.** Best-effort presence that can
  stall or fail a survey would trade real autonomous work for a Discord message.
- **A placeholder on a public surface is a trust bug**, not a cosmetic one — it ships a
  wrong number to every reader.

## When to Apply

- Integrating with a deployed HMAC verifier you don't control in the same change.
- Sending best-effort telemetry from inside a CI/automation workflow.
- Any value that flows into a public or rendered surface.
- Any POST path that must never fail its parent job.
- Any signed payload where timestamp and body must stay byte-identical across systems.

## Examples

**Signing-contract reconciliation — the corrected shape:**

```ts
const ts = getNow()                          // one timestamp
const body = JSON.stringify(payload)         // one serialization
const sig = hmacSha256Hex(secret, `${ts}.${body}`)  // sign the bytes you send
// header X-Gateway-Timestamp = ts ; payload.fired_at = ts  (byte-identical)
```

**Placeholder → real value:**

```yaml
# Before — renders "added 0 wiki entries" to Discord, always
'{owner: $owner, repo: $repo, slug: $slug, wiki_pages_changed: 0}'
```

```ts
// After — the producer emits the real count
const pagesChanged = countWikiPages(committedPagePaths)
await emitPagesChanged(pagesChanged)
```

## Related

- `docs/solutions/best-practices/autonomous-pipeline-minimum-progress-floor-2026-05-17.md` — best-effort telemetry must not abort the pipeline; this extends it with timeout/retry policy for a signed POST.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — aggregate status must reflect every required step; honored by excluding the announce from job success.
- `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md` — stderr discipline; this applies the same discipline with the opposite operational goal (fail-soft, not fail-loud).
- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md` — public-surface leak prevention; this adds the "don't render a placeholder public value" rule.
- `docs/solutions/workflow-issues/github-actions-step-output-interpolation-2026-04-21.md` — pass step outputs through `env:`, never interpolate into `run:`.
- `docs/solutions/best-practices/requirements-doc-survives-verification-2026-06-24.md` — reconcile against the deployed verifier's code, not the design doc; the "live source over prose" discipline generalized to requirements documents.
