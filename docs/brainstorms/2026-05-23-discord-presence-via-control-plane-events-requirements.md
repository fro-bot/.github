# Fro Bot Discord Presence via Control-Plane Events

**Date:** 2026-05-23 (reconciled against shipped gateway 2026-06-04)
**Status:** Requirements — gateway side SHIPPED; ready for `ce:plan`
**Scope:** Standard
**This document:** control-plane side only. The gateway-side feature shipped in [fro-bot/agent#671](https://github.com/fro-bot/agent/issues/671) via agent PR #697 (2026-05-30) and is deployed to Fronomenal through `marcusrbrown/infra`. The contract below has been reconciled against the shipped implementation (`packages/gateway/src/http/{announce-schema,announce-handler,hmac}.ts`); see the **Shipped-Gateway Reconciliation** section.

## Feature

The Fro Bot control plane (`fro-bot/.github`) POSTs structured event payloads to a webhook exposed by the Fro Bot gateway daemon (`fro-bot/agent`, deployed via `marcusrbrown/infra` to `gateway.fro.bot`). The gateway, which is already logged in to Discord as the **Fro Bot user identity**, posts a message in Fronomenal **as Fro Bot** for each event. This is the load-bearing constraint: posts must originate from the Fro Bot user account via discord.js, NOT from a Discord webhook URL (which would post as a webhook bot, not as Fro Bot). The character has presence in Fronomenal; the control plane is what gives that character things to say.

## Scope Split

| This repo (`fro-bot/.github`) — what this doc covers | The gateway (`fro-bot/agent`) — tracked in a separate issue |
|---|---|
| Detect events in workflows | HTTP server with `POST /v1/announce` endpoint |
| Build structured payload (event type, context, timestamp) | HMAC-SHA256 signature verification |
| Sign payload (HMAC-SHA256) | Replay protection (timestamp window) |
| POST to gateway webhook with retry-once | Templated rendering per event type (v1) |
| Resolve secrets, kill-switch, error handling | Post via existing discord.js client as Fro Bot identity |
| File the gateway issue with the contract spec | Channel routing config |

The gateway issue (titled "Fro Bot presence webhook") is the artifact that captures the gateway-side build. This document does NOT design the gateway side — it specifies the contract the gateway must implement.

## Problem

The Fro Bot character has presence in Fronomenal Discord via `gateway.fro.bot` but no way to talk about what it's actually doing. The control plane fires events every day (surveys complete, invitations accepted, daily reconcile runs, wiki-lint findings) but they stay invisible. The sunset of the GitHub-issue-based operational log (PR #3368) removed the wrong channel — issues nobody read — without replacing it with the right one. Fro Bot should drop in-character messages in Fronomenal when notable things happen, posted from its own Discord identity, not from an opaque webhook bot.

## Goals

1. **Control plane posts AS Fro Bot** in Fronomenal Discord for notable control-plane events — via the gateway's discord.js client, not via a Discord webhook URL
2. **Build the announce contract** (payload shape, auth, retry policy) so the gateway-side issue has everything it needs to implement against
3. **Reuse the existing gateway deployment** — don't rearchitect or relocate the gateway daemon
4. **Stay forward-compatible** with v2 LLM composition: the v1 payload can carry pre-rendered text in a `rendered_text` field; gateway templates when that's absent

## Non-Goals (v1)

- LLM composition of message text — deferred to v2; v1 uses gateway-side templates
- High-risk privacy events (visibility transition, integrity alerts) — those stay on GitHub-issue surfaces
- Daily reconcile summary event and wiki-lint findings event — added as fast-followers once the architecture proves out with the two narrowed event types
- Two-way conversation in Discord (gateway already handles `@fro-bot` mentions; not extending here)
- `self_improvement_observed` event type — no current trigger; add when the trigger exists, not as reserved contract surface
- Multi-channel routing — single Fronomenal channel for all v1 drops
- Durable queue / outage buffering — best-effort delivery with single-retry only
- Replacing Bluesky (already gated off in PR #3368; revival is a separate decision)
- Gateway-side implementation details (channel ID config, embed templates, discord.js wiring, HMAC verification, replay cache) — covered by the gateway-side issue

## Users

- **Marcus** — primary audience; sees Fro Bot's activity reflected in Fronomenal in Fro Bot's voice
- **Fronomenal members** — secondary audience; experience Fro Bot as a character with rhythm and personality

## Architecture (v1)

### Component overview

```
fro-bot/.github (control plane)            fro-bot/agent (gateway)
┌─────────────────────────────────┐        ┌───────────────────────┐
│  Event-firing workflow          │        │  POST /v1/announce    │
│  ┌─────────────────────────┐    │        │  ┌─────────────────┐  │
│  │ Event happens           │    │        │  │ Verify HMAC     │  │
│  │ (survey-repo,           │    │        │  └─────────────────┘  │
│  │  poll-invitations)      │    │        │           ↓           │
│  └────────────┬────────────┘    │        │  ┌─────────────────┐  │
│               ↓                 │   POST │  │ Replay window   │  │
│  ┌─────────────────────────┐    │   ───→ │  └─────────────────┘  │
│  │ Build payload + sign    │    │  HTTPS │           ↓           │
│  │ (HMAC-SHA256)           │    │        │  ┌─────────────────┐  │
│  └────────────┬────────────┘    │        │  │ Template render │  │
│               ↓                 │        │  │ (v1) OR use     │  │
│  ┌─────────────────────────┐    │        │  │ rendered_text   │  │
│  │ scripts/gateway-        │    │        │  │ (v2 forward)    │  │
│  │ announce.ts             │    │        │  └─────────────────┘  │
│  │ POST + retry-once       │    │        │           ↓           │
│  └─────────────────────────┘    │        │  ┌─────────────────┐  │
│                                 │        │  │ Post AS Fro Bot │  │
│  Kill switch (workflow var)     │        │  │ via discord.js  │  │
│  bypasses POST when set         │        │  └─────────────────┘  │
└─────────────────────────────────┘        └───────────────────────┘
                                                    ↓
                                           Fronomenal Discord server
                                           (channel ID from gateway config)
```

### What this repo builds

1. **`scripts/gateway-announce.ts`** — new TypeScript module, runs under Node 24 native TS. Responsibilities:
   - Read event type, structured context, and timestamp from env vars passed by the calling workflow step
   - Read `GATEWAY_WEBHOOK_SECRET` and `GATEWAY_PRESENCE_URL` from env
   - Build the JSON payload (serialized once via `JSON.stringify`; field ordering is irrelevant since the gateway signs raw bytes, not canonical JSON — see Shipped-Gateway Reconciliation)
   - Compute HMAC-SHA256 over `timestamp + "." + body` using the exact serialized body bytes
   - Honor kill-switch env var (when set, log and exit 0 without POSTing)
   - POST with single retry on transient failure (network error or HTTP 5xx); on final failure, log structured stderr warning and exit 0 (do not fail the workflow)
2. **Composer step in event-firing workflows** — added to:
   - `survey-repo.yaml` after a successful survey + wiki-commit, before the broadcast job
   - `poll-invitations.yaml` when ≥1 public invitation accepted
3. **Kill-switch infrastructure** — repo variable `GATEWAY_ANNOUNCE_DISABLED` (boolean). When set, `gateway-announce.ts` logs `gateway-announce: kill switch active; skipping POST` to stderr and exits 0
4. **Secrets contract documented in `metadata/README.md`** — `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_PRESENCE_URL` listed alongside existing repo secrets

### Payload Contract (v1)

The control plane sends this exact shape to `POST /v1/announce`:

```jsonc
{
  "v": 1,                                          // schema version; bumped on breaking changes
  "event_type": "survey_completed",                // one of: survey_completed | invitation_accepted
  "fired_at": "2026-05-23T19:30:00Z",              // ISO 8601, control-plane wall clock; signed in the body
  "context": {                                     // event-specific structured data; see Event Types below
    // event-specific keys
  },
  "rendered_text": null                            // REQUIRED field, type `string | null`. v1 always sends null but the key MUST be present (gateway schema rejects omission). v2 forward: pre-composed text; gateway templates when null.
}
```

**Signing — reconciled against shipped gateway (`hmac.ts`, agent PR #697)**:

The shipped gateway signs over the **exact raw request body bytes it receives** — there is NO JSON canonicalization. The control plane therefore signs the precise bytes it sends ("sign what you send"): serialize the payload once, sign those bytes, send those bytes. No key sorting, no re-serialization.

- **Signed message** = `<X-Gateway-Timestamp value>` + `"."` + `<raw JSON body bytes>` — a literal `.` delimiter between the timestamp string and the body bytes. (Shipped: `createHmac('sha256', secret).update(timestampHeader).update('.').update(rawBody)`.)
- **Algorithm**: HMAC-SHA256 with `GATEWAY_WEBHOOK_SECRET`.
- **Encoding**: lowercase hex, exactly 64 chars. No `v1=` prefix, no base64.
- **Signature header**: `X-Gateway-Signature`. **Timestamp header**: `X-Gateway-Timestamp`.
- **`fired_at` ↔ header**: the body's `fired_at` MUST be **byte-identical** to the `X-Gateway-Timestamp` header value — the gateway rejects with **400** on mismatch via raw string equality. The control plane sets both from the same ISO-8601 string in a single step.
- **Body size**: gateway caps the body at **8 KiB** (`ANNOUNCE_MAX_BODY_BYTES`); v1 payloads are well under this.

**Replay window**: gateway rejects when the timestamp is outside a **5-minute** window (shipped `REPLAY_WINDOW_MS = 5 * 60 * 1000`), and rejects a re-used signature (replay cache). Both return **401** (generic body — no oracle distinguishing bad-sig / stale / replay).

**Constant-time comparison**: verified on the gateway side (shipped); not enforceable from the POST side.

### v1 Event Types

| Event | When it fires | Context fields |
|---|---|---|
| `invitation_accepted` | After `poll-invitations.yaml` accepts ≥1 public invitation. Single POST aggregating all invitations in the cycle | `{count: number, repos: [{owner, name}, ...]}` |
| `survey_completed` | After a successful `survey-repo.yaml` run that landed wiki content on `data`. One POST per survey | `{owner: string, repo: string, slug: string, wiki_pages_changed: number}` |

Both event types include enough context for the gateway to render a template that names the specific repo or count, without needing to look anything up.

### Fast-Follower Events (not in v1)

These ship after v1 proves out the contract. Listed here so the gateway issue can stub embed colors / template slots:

- `reconcile_notable` — daily reconcile cron, gated on notability (dispatched > 0, floored > 0, newRepos > 0, byChannel changed, or lostAccess > 0)
- `wiki_lint_findings` — weekly wiki-lint run with findings ≥ 1 (depends on the open wiki-lint follow-up plan landing first)

### Outage Policy

- Single retry on transient failure (**network error or HTTP 5xx**, which includes the gateway's **503** drain/shutdown response) with 5-second backoff
- **Do NOT retry 4xx**: `400`/`401` indicate a signing, timestamp-mismatch, or schema bug that a retry cannot fix; `429` (rate-limited) won't clear within a single 5-second backoff and v1 volume is low. Treat all 4xx as terminal — log and exit 0.
- On final failure: structured stderr log line carrying event type and HTTP status (no canonical identifiers in the failure message — repos in the context field stay in the body, which isn't logged on failure), then exit 0
- Lost events are acceptable in v1; the control plane has its own audit trail (data-branch commits, metadata files, GitHub Actions run logs)
- No buffer, no queue, no replay

### Kill Switch

- Repo variable `GATEWAY_ANNOUNCE_DISABLED` — when set to any truthy value, `gateway-announce.ts` short-circuits before computing the HMAC or making the network call
- Used when the gateway is down for maintenance, or if v1 content turns out to be a problem and we need to mute the pipeline without editing workflows
- No fallback to webhook-based posting; the whole point is gateway-as-Fro-Bot, so silence is the correct behavior when the gateway is unavailable

### Privacy Boundary

Only `invitation_accepted` and `survey_completed` events ship in v1. Both carry public-repo identifiers exclusively:

- `survey_completed` only fires after the workflow's privacy-recheck step confirms `isPrivate === false` (existing guardrail; see `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`)
- `invitation_accepted` only includes public invitations (already gated in `scripts/handle-invitation.ts`)
- The fast-follower `reconcile_notable` will need an additional privacy review before shipping — the `byChannel` rollup could carry channel-classification telemetry that's meaningful only for public-discovery surfaces; that boundary is the fast-follower's problem to resolve

## Shipped-Gateway Reconciliation

The gateway side shipped in agent PR #697 (2026-05-30). This section pins the control-plane build to the gateway's actual implementation. Where the original brainstorm and the shipped code disagreed, **the shipped code wins** and the contract above has been updated to match.

| Aspect | Original brainstorm assumption | Shipped gateway reality | Control-plane action |
|---|---|---|---|
| Signing input | Canonical JSON (lexicographically sorted keys, re-serialized) | Raw request body bytes, no canonicalization | **Sign the exact bytes sent.** Serialize once, sign those bytes, send those bytes. Drop all key-sorting logic. |
| Signed message | HMAC over canonical body only | `HMAC(secret, timestamp + "." + rawBody)` — timestamp string + literal `.` + body bytes | Build the signed message as `timestamp + "." + body` with the exact body bytes. |
| `fired_at` vs header | "gateway MUST verify they match" (advisory) | Hard **400** on raw-string mismatch | Set `fired_at` and `X-Gateway-Timestamp` from one identical ISO-8601 string. |
| `rendered_text` | Optional, send `null` | Schema-**required** field, type `string \| null` | Always include the key with value `null` in v1. |
| Endpoint availability | Assumed always-on | Opt-in: live only when gateway has BOTH `GATEWAY_WEBHOOK_SECRET` and `GATEWAY_PRESENCE_CHANNEL_ID` | No control-plane code impact, but pre-flight: confirm the deployed gateway has both set (it is, per `marcusrbrown/infra`). Until then, the kill switch / black-hole tolerance (SC5) covers a not-listening endpoint. |
| Rejection statuses | 4xx vs 5xx unspecified | 413/429/400/401 (4xx terminal); 503 on drain (retryable) | Retry only network-error/5xx (incl. 503); treat 4xx as terminal. |
| Body size | unspecified | 8 KiB cap | v1 payloads are tiny; no action. |
| Replay/rate-limit | gateway-side | 5-min window, 60 req/min, dedup on signature | No control-plane action; informs SC3 expectations. |

**Net effect on the control-plane build:** *simpler* than the brainstorm — the canonicalization module (sort keys, stable re-serialize) is **deleted from scope**. The signer becomes: `const body = JSON.stringify(payload); const sig = hmacSha256Hex(secret, ` + "`${timestamp}.${body}`" + `)`. The one new sharp edge is that `payload.fired_at` must be set from the same `timestamp` variable used for the header, before `JSON.stringify`, so the signed body and the header agree.

## Functional Requirements

- **R1**: `scripts/gateway-announce.ts` accepts event type, structured context, and timestamp from env vars and produces a JSON payload matching the contract above, serialized once so the signed bytes equal the sent bytes (no canonicalization — the gateway signs raw body bytes)
- **R2**: HMAC-SHA256 signature uses the `GATEWAY_WEBHOOK_SECRET` env var; signature is hex-encoded and transmitted in the `X-Gateway-Signature` header
- **R3**: The script POSTs to the URL in `GATEWAY_PRESENCE_URL` env var with `Content-Type: application/json`, `X-Gateway-Signature`, and `X-Gateway-Timestamp` headers
- **R4**: On HTTP 5xx (including 503) or network error, the script retries exactly once after a 5-second backoff; on second failure, logs a structured stderr line and exits 0. 4xx responses (400/401/429) are terminal — no retry (a signing/schema bug or rate-limit won't clear on retry)
- **R5**: When the repo variable `GATEWAY_ANNOUNCE_DISABLED` is truthy, the script logs `gateway-announce: kill switch active; skipping POST` to stderr and exits 0 before any network call or HMAC computation
- **R6**: `survey-repo.yaml` invokes `gateway-announce.ts` in a new step after the `Record survey result` step, only when the recheck succeeded (same gate as the existing `Record survey result` step). Event type: `survey_completed`. Context: `{owner, repo, slug, wiki_pages_changed}`
- **R7**: `poll-invitations.yaml` invokes `gateway-announce.ts` when `steps.poll.outputs.public_invitations_accepted > 0`. Event type: `invitation_accepted`. Context: `{count, repos: [...]}` — repos populated from invitation handler output (will require a small change to `scripts/handle-invitation.ts` to emit the list)
- **R8**: `metadata/README.md` documents `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_PRESENCE_URL`, and `GATEWAY_ANNOUNCE_DISABLED` in the existing secrets/vars table
- **R9**: The payload contract is forward-compatible with a `rendered_text` field that the v2 composer (deferred) will populate; v1 callers always send `null`
- **R10**: The gateway-side feature is filed as a GitHub issue on `fro-bot/agent` capturing the contract above (endpoint shape, auth, replay window, constant-time comparison requirement, channel routing, templated rendering scope, posting AS Fro Bot via discord.js)

## Success Criteria

- **SC1**: A real `survey-repo.yaml` run lands a templated message in the Fronomenal target channel, posted by the Fro Bot Discord user account (visible message author: Fro Bot), within 30 seconds of the survey completing
- **SC2**: A real `poll-invitations.yaml` cycle accepting ≥1 public invitation lands a templated message in the same channel, same authorship
- **SC3**: A `curl` against the gateway endpoint with a deliberately wrong HMAC signature returns 4xx and produces NO Discord post (gateway-side test; verified after gateway feature ships)
- **SC4**: Setting `GATEWAY_ANNOUNCE_DISABLED=true` causes the next `survey-repo.yaml` or `poll-invitations.yaml` run to log the kill-switch line and produce no gateway request
- **SC5**: Simulating gateway unavailability (e.g., pointing `GATEWAY_PRESENCE_URL` at a black hole) causes the workflow to log the structured warning and continue without failing the run

## What This Replaces

The legacy `discord-notify.ts` webhook posting (still present, no callers as of PR #3368). Once v1 ships and proves stable, `discord-notify.ts` can be retired — the gateway-via-Fro-Bot path supersedes it. That retirement is a separate PR, not part of v1.

## What This Doesn't Replace

- The gateway's `@fro-bot` mention handler (still serves reactive interactions)
- The `/fro-bot ping` slash command (still serves as heartbeat)
- The existing GitHub PR review activity (different surface, different audience)
- Bluesky posting (still gated off in PR #3368; revival is a separate decision)

## Open Questions for Planning

- **Q1**: Output of `scripts/handle-invitation.ts` currently exposes only the count of accepted public invitations via step output. To populate `context.repos`, the script needs to also expose the list of repo identifiers (owner/name pairs) — either as a stringified JSON step output or via a small artifact file. Planning resolves the exact mechanism.
- **Q2**: The `Record survey result` step computes `SURVEY_STATUS` from a multi-step truth table. The gateway-announce step needs the same success gate; planning decides whether to reuse the same env-var pattern or extract a shared step output.
- **Q3**: `GATEWAY_PRESENCE_URL` — repo variable or repo secret? URLs aren't secret in the security sense, but the gateway endpoint URL is rarely-rotated and not useful to attackers without the HMAC secret. Probably variable; planning confirms.
- **Q4**: Test strategy for `scripts/gateway-announce.ts` — unit-test the signed-message construction (`timestamp + "." + body`, byte-exact), HMAC hex output against a known vector matching the gateway's `hmac.test.ts`, `fired_at`↔header equality, retry (5xx/503 only, 4xx terminal), and kill-switch logic with mocked fetch. No live integration test in CI (gateway is production).
- **Q5**: Should `gateway-announce.ts` use Node's built-in `crypto` for HMAC and built-in `fetch` for the POST, or pull in a dep? Lean toward built-in (matches repo's zero-dep ethos for control-plane scripts). **Reinforced by shipped reality**: the gateway uses Node `createHmac('sha256', ...)` with hex digest — `crypto.createHmac` on the control-plane side produces a byte-identical signature with no dep.
- **Q6**: Versioning policy on the contract — `v: 1` in the payload is the knob. **Resolved by shipped reality**: the gateway schema fixes `v` to literal `1` and `rendered_text` is already in the v1 schema, so v2's composer stays `v: 1` and simply populates `rendered_text` (no version bump, no dual-support transition needed). Confirm in planning.
- **Q7 (new, from reconciliation)**: The signer must set `fired_at` and the `X-Gateway-Timestamp` header from the **same** timestamp string, captured once before serialization, or the gateway 400s on mismatch. Planning pins this as an explicit single-source-of-timestamp requirement in `gateway-announce.ts`.
- **Q8 (new, from reconciliation)**: Pre-flight — confirm the deployed Fronomenal gateway has both `GATEWAY_WEBHOOK_SECRET` and `GATEWAY_PRESENCE_CHANNEL_ID` set (endpoint is opt-in). SC5 (black-hole tolerance) means a not-yet-configured endpoint won't break workflows, but SC1/SC2 (real posts land) can't pass until both are set on the `marcusrbrown/infra` deployment and the matching `GATEWAY_WEBHOOK_SECRET` is mirrored into this repo's secrets.

## Out-of-Scope but Worth Flagging

- The gateway issue should require the gateway-side implementation to log every accepted announce request with a redacted summary (event type, timestamp, response status) — gives operator-visible audit trail without echoing payload content. Captured in the gateway issue, not enforced here.
- Audience demand validation (product-lens review concern): not gating v1 because the feature is the point regardless. Worth a post-v1 check: are the drops landing well? If quality from templates is poor, the composer (v2) becomes higher-priority.

## Related Work

- **Sunset PR #3368** — removed the journal-entry pipeline. Did not replace the channel; v1 here is the replacement
- **Explorer research (2026-05-23)** — capability matrix on `fro-bot/agent` gateway + `marcusrbrown/infra` deployment (informs the gateway issue contents)
- **`fro-bot/agent#671`** — gateway-side build; **SHIPPED 2026-05-30 via agent PR #697** ("signed announce webhook"). Endpoint live (`POST /v1/announce`), opt-in (active only when the gateway has both `GATEWAY_WEBHOOK_SECRET` and `GATEWAY_PRESENCE_CHANNEL_ID` set), deployed to Fronomenal via `marcusrbrown/infra`. Gateway internals: `packages/gateway/src/http/{announce-schema,announce-handler,hmac,replay-cache,rate-limit}.ts`
- **`marcusrbrown/infra`** — will need a deploy secret rollout (`GATEWAY_WEBHOOK_SECRET`) and possibly env var (`GATEWAY_PRESENCE_CHANNEL_ID`) once the gateway side lands
- **PR #3293 / `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`** — the privacy gate on `survey-repo.yaml` is what makes `survey_completed` safe to broadcast
- **`scripts/handle-invitation.ts`** — needs a small change to expose the list of accepted repos (Q1 above)

## Review Disposition

This document was rewritten after a document-review pass surfaced 31 raw findings across 6 reviewers. Key disposition:

- **"Composer is over-scoped for v1"** (4-reviewer convergence) — accepted; composer deferred to v2, v1 uses gateway-side templates
- **"Audience demand assumed"** (product-lens) — acknowledged but not gating: the feature is the point regardless of measurable demand
- **"HMAC underspec"** (3 reviewers) — resolved: canonicalization, header layout, replay window, constant-time comparison all specified above
- **"`self_improvement_observed` shouldn't be in v1"** — accepted; removed from contract
- **"Wiki-lint coupling"** — accepted; wiki_lint_findings demoted to fast-follower
- **"No DoS posture / 200-ack overstates / kill switch missing"** — kill switch added; DoS posture is gateway-side (covered in gateway issue); 200-ack semantics also gateway-side
- **"Discord-notify role contradiction"** — resolved: discord-notify is retired after v1 ships, the gateway-via-Fro-Bot path supersedes it
- **"Architecture overcommits to one chat bridge"** — accepted as a tradeoff; Fronomenal is the only target and a different bridge would be a different brainstorm
