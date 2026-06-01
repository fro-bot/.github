# Fro Bot Discord Presence via Control-Plane Events

**Date:** 2026-05-23
**Status:** Requirements (revised after document-review)
**Scope:** Standard
**This document:** control-plane side only. The gateway-side feature is tracked in [fro-bot/agent#671](https://github.com/fro-bot/agent/issues/671).

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
   - Build canonical JSON payload (field ordering deterministic; see Payload Contract below)
   - Compute HMAC-SHA256 over the canonicalized payload bytes
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
  "rendered_text": null                            // v1: always null. v2 forward: pre-composed in-character message text. Gateway falls back to its templates when null.
}
```

**Canonicalization for signing**:
- Encode as JSON with **lexicographically sorted keys at every level**, no whitespace
- UTF-8 byte encoding
- HMAC-SHA256 over the canonical bytes, hex-encoded (lowercase)
- Signature transmitted in `X-Gateway-Signature` header (HMAC hex)
- Timestamp transmitted in `X-Gateway-Timestamp` header AND in the body's `fired_at` field; gateway MUST verify they match

**Replay window**: the gateway should reject requests where `|now - fired_at| > 5 minutes`. Strictly informational here; implementation is gateway-side.

**Constant-time comparison**: HMAC verification on the gateway side MUST use constant-time comparison. Stated as a requirement on the gateway issue; not enforceable from the POST side.

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

- Single retry on transient failure (network error, HTTP 5xx) with 5-second backoff
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

## Functional Requirements

- **R1**: `scripts/gateway-announce.ts` accepts event type, structured context, and timestamp from env vars and produces a canonicalized JSON payload matching the contract above
- **R2**: HMAC-SHA256 signature uses the `GATEWAY_WEBHOOK_SECRET` env var; signature is hex-encoded and transmitted in the `X-Gateway-Signature` header
- **R3**: The script POSTs to the URL in `GATEWAY_PRESENCE_URL` env var with `Content-Type: application/json`, `X-Gateway-Signature`, and `X-Gateway-Timestamp` headers
- **R4**: On HTTP 5xx or network error, the script retries exactly once after a 5-second backoff; on second failure, logs a structured stderr line and exits 0
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
- **Q4**: Test strategy for `scripts/gateway-announce.ts` — unit-test the canonicalization, HMAC, retry, and kill-switch logic with mocked fetch. No live integration test in CI (gateway is production).
- **Q5**: Should `gateway-announce.ts` use Node's built-in `crypto` for HMAC and built-in `fetch` for the POST, or pull in a dep? Lean toward built-in (matches repo's zero-dep ethos for control-plane scripts).
- **Q6**: Versioning policy on the contract — `v: 1` in the payload is the simple knob. When v2 ships the composer, it bumps to `v: 2` and gateway supports both during transition? Or does v2 stay `v: 1` since `rendered_text` was always in the contract? Planning decides.

## Out-of-Scope but Worth Flagging

- The gateway issue should require the gateway-side implementation to log every accepted announce request with a redacted summary (event type, timestamp, response status) — gives operator-visible audit trail without echoing payload content. Captured in the gateway issue, not enforced here.
- Audience demand validation (product-lens review concern): not gating v1 because the feature is the point regardless. Worth a post-v1 check: are the drops landing well? If quality from templates is poor, the composer (v2) becomes higher-priority.

## Related Work

- **Sunset PR #3368** — removed the journal-entry pipeline. Did not replace the channel; v1 here is the replacement
- **Explorer research (2026-05-23)** — capability matrix on `fro-bot/agent` gateway + `marcusrbrown/infra` deployment (informs the gateway issue contents)
- **`fro-bot/agent#671`** — gateway-side build (filed 2026-05-23)
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
