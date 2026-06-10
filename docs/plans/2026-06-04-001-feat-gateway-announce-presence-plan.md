---
title: 'feat: Control-plane gateway-announce for Fro Bot Discord presence'
type: feat
status: complete
date: 2026-06-04
completed: 2026-06-09
origin: docs/brainstorms/2026-05-23-discord-presence-via-control-plane-events-requirements.md
deepened: 2026-06-04
---

# feat: Control-plane gateway-announce for Fro Bot Discord presence

## Overview

Add a control-plane signer, `scripts/gateway-announce.ts`, that POSTs HMAC-signed event payloads to
the Fro Bot gateway's `POST /v1/announce` endpoint, and wire it into two event-firing workflows so
Fro Bot posts in-character messages in Fronomenal **as the Fro Bot Discord user** when it completes
a survey or accepts repository invitations. The gateway side already shipped (agent PR #697,
2026-05-30) and is deployed via `marcusrbrown/infra`; this plan builds only the POST side against
that shipped contract.

The signing model is the load-bearing detail: the gateway verifies
`HMAC-SHA256(secret, "<timestamp>.<rawBody>")` over the **exact request body bytes** — no JSON
canonicalization. The control plane therefore signs the precise bytes it sends, and the body's
`fired_at` must be byte-identical to the `X-Gateway-Timestamp` header (the gateway 400s on
mismatch).

## Problem Frame

The Fro Bot character has presence in Fronomenal Discord but no way to talk about what it does. The
control plane fires notable events daily (surveys complete, invitations accepted) but they stay
invisible since the operational-log sunset (PR #3368). This plan gives the character things to say,
posted from its own Discord identity via the gateway — not from an opaque webhook bot. See origin:
`docs/brainstorms/2026-05-23-discord-presence-via-control-plane-events-requirements.md`.

## Requirements Trace

- R1. `scripts/gateway-announce.ts` reads event type, structured context, and timestamp from env and
  produces a JSON payload matching the shipped contract (`v:1`, `event_type`, `fired_at`, `context`,
  `rendered_text:null`), serialized once so signed bytes equal sent bytes.
- R2. HMAC-SHA256 over `"<timestamp>.<body>"` using `GATEWAY_WEBHOOK_SECRET`; lowercase hex (64
  chars); sent in `X-Gateway-Signature`.
- R3. POST to `GATEWAY_PRESENCE_URL` with `Content-Type: application/json`, `X-Gateway-Signature`,
  `X-Gateway-Timestamp`; `fired_at` byte-identical to the timestamp header.
- R4. Retry exactly once (5s backoff) on network error or HTTP 5xx (incl. 503); 4xx (400/401/429) is
  terminal. On final failure, log structured stderr and exit 0 (never fail the workflow).
- R5. Kill switch: when `GATEWAY_ANNOUNCE_DISABLED` is truthy, log and exit 0 before any HMAC
  computation or network call.
- R6. `survey-repo.yaml` invokes the signer after `Record survey result`, gated on the same success
  condition; event `survey_completed`, context `{owner, repo, slug, wiki_pages_changed}`.
- R7. `poll-invitations.yaml` invokes the signer when `public_invitations_accepted > 0`; event
  `invitation_accepted`, context `{count, repos:[{owner,name}]}` — requires `handle-invitation.ts`
  to emit the accepted-public-repos list.
- R8. `metadata/README.md` documents `GATEWAY_WEBHOOK_SECRET`, `GATEWAY_PRESENCE_URL`,
  `GATEWAY_ANNOUNCE_DISABLED`.
- R9. Payload carries `rendered_text:null` (schema-required key) — forward-compatible with the v2
  composer.

## Scope Boundaries

- No LLM message composition (v2; gateway templates render v1).
- No `reconcile_notable` / `wiki_lint_findings` events (fast-followers, post-v1).
- No high-risk privacy events (visibility transitions, integrity alerts) — stay on GitHub surfaces.
- No durable queue / outage buffering — best-effort, single-retry.
- No gateway-side work (shipped; this is POST-side only).
- No multi-channel routing — single Fronomenal channel (gateway config).

### Deferred to Separate Tasks

- Retiring `scripts/discord-notify.ts`: separate PR once v1 proves stable (origin "What This Replaces").
- Rollout in `marcusrbrown/infra` — setting `GATEWAY_WEBHOOK_SECRET` + `GATEWAY_PRESENCE_CHANNEL_ID`
  on the deployed gateway and mirroring `GATEWAY_WEBHOOK_SECRET`/`GATEWAY_PRESENCE_URL` into this
  repo's secrets/vars: operator task, prerequisite for SC1/SC2 (see Q8).

## Context & Research

### Relevant Code and Patterns

- `scripts/discord-notify.ts` — the closest sibling: exported pure `postDiscordEmbed(params)` with
  injectable `webhookUrl`, built-in `fetch` (line ~77), `import.meta.url` entrypoint guard (~128),
  429-retry loop, structured stderr, JSON to stdout. Mirror its shape (minus the webhook framing).
- `scripts/bluesky-post.ts` — injectable-seam + env-override pattern, entrypoint guard (~93).
- `.github/workflows/survey-repo.yaml` — `Record survey result` step gate:
  `if: ${{ !cancelled() && steps.survey-agent.conclusion != 'skipped' && steps.recheck.conclusion == 'success' }}`;
  env exposes `steps.resolve.outputs.{owner,repo}`, `inputs.node_id`, `steps.recheck.outputs.private`,
  and computes `SURVEY_STATUS`. `wiki-commit` step has `id: wiki-commit` but emits no page count.
- `.github/workflows/poll-invitations.yaml` — `id: poll` runs `handle-invitation.ts` with
  `GITHUB_TOKEN: ${{ secrets.FRO_BOT_POLL_PAT }}`; `Notify Discord` gated on
  `steps.poll.outputs.public_invitations_accepted > 0`.
- `scripts/handle-invitation.ts` — `formatInvitationGithubOutput` emits only
  `public_invitations_accepted=<n>`; `countPublicAcceptedInvitations` counts accepted non-redacted
  entries. Needs a second output for the repos list.
- `metadata/README.md` — "Workflow secret mapping" table; `vars.X` vs `secrets.X` convention
  (`vars.FRO_BOT_MODEL`, `secrets.FRO_BOT_PAT`).

### Institutional Learnings

- `docs/solutions/best-practices/diagnostic-patches-observability-discipline-2026-05-20.md` — never
  `2>/dev/null` a gate; structured stderr; `printf '%s\n' '--- marker ---'` (leading `---` trap).
- `docs/solutions/runtime-errors/node-strip-only-typescript-2026-04-18.md` — strip-only-safe syntax;
  the `Test Scripts Load` CI job must cover the new entrypoint.
- `docs/solutions/workflow-issues/github-actions-step-output-interpolation-2026-04-21.md` — pass
  `${{ steps.*.outputs.* }}` through `env:`, reference `${VAR}` in shell; never inline into `run:`.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — a best-effort
  announce step must NOT be folded into `SURVEY_STATUS`; its failure stays non-fatal and out of the
  required-step status aggregation.
- `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md` — only emit after
  the verified privacy gate; `survey_completed` rides behind the existing `recheck` gate.

### External References

- Shipped gateway contract (agent PR #697): `packages/gateway/src/http/{announce-schema,announce-handler,hmac}.ts`.
  Signed message `createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex')`;
  5-min replay window; 8 KiB body cap; 60 req/min; rejection codes 413/429/400/401/503.
- Node built-in `crypto.createHmac('sha256', ...)` produces a byte-identical signature — zero-dep.

## Key Technical Decisions

- **Sign exact bytes, no canonicalization.** `const body = JSON.stringify(payload)` once; sign
  `` `${timestamp}.${body}` ``; POST `body`. Matches the gateway's raw-body verification.
- **Single source of timestamp.** Capture one ISO-8601 string; set both `payload.fired_at` and the
  `X-Gateway-Timestamp` header from it before serializing. Prevents the gateway's 400-on-mismatch.
- **Built-in `crypto` + `fetch`, zero dep.** Consistent with `discord-notify.ts` and the repo's
  zero-dep control-plane ethos.
- **Fail-soft, best-effort.** Announce never fails a workflow (exit 0 on any final failure) and is
  excluded from `SURVEY_STATUS` aggregation — it is telemetry, not a required step.
- **Retry only 5xx/503/network.** 4xx is a signing/schema/rate-limit condition a 5s retry can't fix.
- **`GATEWAY_PRESENCE_URL` is a repo variable; `GATEWAY_WEBHOOK_SECRET` is a secret.** The URL isn't
  useful without the HMAC secret; matches the `vars`-for-config / `secrets`-for-credentials split.
- **Kill switch short-circuits first** — before HMAC or network, so it's a true mute.

## Open Questions

### Resolved During Planning

- Q1 (repos list for `context.repos`): add a `public_invitations_accepted_repos=<json>` step output
  to `handle-invitation.ts` alongside the existing count; derive from accepted non-redacted results.
- Q2 (survey success gate): reuse the `Record survey result` `if:` gate; do not extract a shared
  output.
- Q3 (`GATEWAY_PRESENCE_URL` var vs secret): repo **variable** (`vars.GATEWAY_PRESENCE_URL`).
- Q4 (test strategy): unit-test signed-message construction (byte-exact), HMAC hex against a known
  vector matching the gateway's `hmac.test.ts`, `fired_at`↔header equality, retry classification,
  kill switch — all with mocked `fetch`. No live CI integration test.
- Q5 (crypto/fetch dep): Node built-ins, no dep.
- Q6 (versioning): `v` stays literal `1`; v2 populates `rendered_text` without a version bump
  (shipped schema already carries the key).
- Q7 (single-timestamp requirement): explicit in Unit 1 — one timestamp string drives body + header.

### Deferred to Implementation

- Q8 (rollout pre-flight): confirming the deployed gateway has `GATEWAY_WEBHOOK_SECRET` +
  `GATEWAY_PRESENCE_CHANNEL_ID` and mirroring the secret/var into this repo is an operator task in
  `marcusrbrown/infra`. SC5 (black-hole tolerance) means the workflows ship safely before this; SC1/SC2
  can only be verified after. Not a code dependency.
- `wiki_pages_changed` exact source: the `wiki-commit` step emits no count today. Implementation
  decides whether to add a `pages_changed` output to that step or derive it from the porcelain the
  commit step already computes (favor a small step output; fall back to `0` if unavailable, since the
  field is descriptive, not gating).

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

```
workflow step (survey-repo / poll-invitations)
  └─ env: EVENT_TYPE, EVENT_CONTEXT_JSON, GATEWAY_PRESENCE_URL (var),
          GATEWAY_WEBHOOK_SECRET (secret), GATEWAY_ANNOUNCE_DISABLED (var)
      └─ node scripts/gateway-announce.ts
            1. kill switch? → log + exit 0
            2. ts = new Date().toISOString()
            3. payload = {v:1, event_type, fired_at: ts, context, rendered_text:null}
            4. body = JSON.stringify(payload)              # serialize ONCE
            5. sig  = hmacSha256Hex(secret, `${ts}.${body}`)
            6. POST url, body, headers{X-Gateway-Signature:sig, X-Gateway-Timestamp:ts}
                 ├─ 2xx → log ok, exit 0
                 ├─ 5xx/503/network → retry once (5s) → fail → log stderr, exit 0
                 └─ 4xx → terminal → log stderr, exit 0
```

## Implementation Units

- [x] **Unit 1: `scripts/gateway-announce.ts` signer + CLI**

**Goal:** A strip-only-safe, zero-dep module that builds the payload, signs the exact bytes, POSTs
with the retry/kill-switch policy, and never fails the workflow.

**Requirements:** R1, R2, R3, R4, R5, R9

**Dependencies:** None

**Files:**
- Create: `scripts/gateway-announce.ts`
- Test: `scripts/gateway-announce.test.ts`

**Approach:**
- Export a pure `announce(params)` with injectable seams: `fetch` (default `globalThis.fetch`),
  `secret`/`url`/`killSwitch` (default from env), `now` (default `() => new Date().toISOString()`),
  and a `sleep` injectable so the retry-backoff test doesn't wait 5s.
- Build `payload` with `rendered_text: null` always present; `fired_at` = the single `now()` string.
- `JSON.stringify(payload)` once; compute `crypto.createHmac('sha256', secret).update(ts).update('.').update(body).digest('hex')`.
- POST with `X-Gateway-Signature`/`X-Gateway-Timestamp` (= same `ts`) + `Content-Type: application/json`.
- Retry classification: network throw or `res.status >= 500` → one retry after `sleep(5000)`; `4xx`
  → terminal. Any final non-2xx/throw → structured stderr (event type + coarse status/error class
  ONLY) + return a result the CLI maps to exit 0.
- **Auth-material redaction (hard rule):** no stderr line, stdout JSON result, or thrown error may
  contain `GATEWAY_WEBHOOK_SECRET`, the derived `X-Gateway-Signature`, the `X-Gateway-Timestamp`, or
  the full request body/headers. Log only event type + coarse status/error class. (`context.repos`
  also stays out of failure logs per the privacy boundary.)
- Kill switch checked before steps 2-6.
- CLI wrapper under the `import.meta.url === \`file://${process.argv[1]}\`` guard: read
  `EVENT_TYPE`, `EVENT_CONTEXT_JSON` (parse), call `announce`, print JSON result to stdout, exit 0.

**Execution note:** Test-first. Write the signed-message + HMAC-vector test before the signer so the
byte-exact `"<ts>.<body>"` formula is locked against the gateway's `hmac.test.ts`.

**Patterns to follow:** `scripts/discord-notify.ts` (fetch + retry + entrypoint guard + stderr/stdout
split); `scripts/bluesky-post.ts` (env-override seams).

**Test scenarios:**
- Happy path: valid env → POST issued with correct URL, headers, and body; result indicates posted;
  exit 0.
- HMAC vector: given a fixed secret, timestamp, and body, the hex signature equals the value the
  gateway's formula produces (`createHmac('sha256',secret).update(ts).update('.').update(body).digest('hex')`).
- `fired_at`↔header: the POSTed body's `fired_at` byte-equals the `X-Gateway-Timestamp` header.
- Payload shape: `v===1`, `rendered_text` key present and `null`, `context` passed through verbatim.
- Edge case: `EVENT_CONTEXT_JSON` malformed → structured stderr, exit 0 (no POST).
- Error path: first attempt 503 → one retry after `sleep` → second 200 → posted (assert exactly one
  retry, sleep called once).
- Error path: two consecutive 5xx → structured stderr (status, no repo names), exit 0.
- Error path: network throw then throw → retried once, then stderr + exit 0.
- Error path: 400/401/429 → NO retry, structured stderr, exit 0.
- Kill switch: `GATEWAY_ANNOUNCE_DISABLED=true` → logs kill-switch line, no HMAC, no fetch, exit 0.
- Missing `GATEWAY_PRESENCE_URL` or `GATEWAY_WEBHOOK_SECRET` → skipped result + stderr, exit 0 (don't
  throw; mirror discord-notify's missing-config tolerance).
- Redaction: a failing POST's stderr/result contains the event type + coarse status but NOT any
  `context.repos` owner/name, the secret, the signature, the timestamp, or the request body.
- Redaction (success path): the stdout JSON result does not echo the secret or signature.

**Verification:** All scenarios pass with mocked `fetch`/`sleep`; `node -e "import('./scripts/gateway-announce.ts')"`
loads under strip-only; types + lint clean.

- [x] **Unit 2: `handle-invitation.ts` emits accepted-public-repos list**

**Goal:** Expose the list of accepted public repos so `poll-invitations.yaml` can build
`context.repos` for the announce.

**Requirements:** R7

**Dependencies:** None (parallel with Unit 1)

**Files:**
- Modify: `scripts/handle-invitation.ts`
- Modify: `scripts/handle-invitation.test.ts`

**Approach:**
- In `formatInvitationGithubOutput`, add a second line
  `public_invitations_accepted_repos=<json>` where the JSON is an array of `{owner, name}` from
  accepted non-redacted (public) results — reuse the exact predicate that
  `countPublicAcceptedInvitations` uses so count and list never disagree.
- Keep the existing `public_invitations_accepted=<n>` line unchanged (backward compatible).
- JSON must be single-line (GITHUB_OUTPUT is line-based); private/redacted entries excluded.

**Execution note:** Test-first — add the list-output assertion before the formatter change.

**Patterns to follow:** the existing `formatInvitationGithubOutput` / `countPublicAcceptedInvitations`
pair in `scripts/handle-invitation.ts`.

**Test scenarios:**
- Happy path: 2 accepted public + 1 accepted private → list output has exactly the 2 public
  `{owner,name}`; count output is `2`; list and count agree.
- Edge case: 0 accepted → count `0`, list output `[]`.
- Edge case: only private/redacted accepted → count `0`, list `[]` (no redacted names emitted).
- Integration: the emitted line is valid single-line JSON parseable by `JSON.parse`.

**Verification:** existing handle-invitation tests stay green; new list-output tests pass; no redacted
identifier appears in the list.

- [x] **Unit 3: Wire `survey_completed` into `survey-repo.yaml`**

**Goal:** Fire a `survey_completed` announce after a successful survey, best-effort, behind the
existing privacy/success gate.

**Requirements:** R6

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/survey-repo.yaml`

**Approach:**
- Add a step after `Record survey result`, gated on the same condition AND `SURVEY_STATUS == 'success'`
  (announce only when the survey actually landed). It rides behind the existing `recheck` privacy gate,
  so only public repos reach it.
- Pass values via `env:` (not inline into `run:`): `EVENT_TYPE: survey_completed`,
  `EVENT_CONTEXT_JSON` built from `steps.resolve.outputs.{owner,repo}`, the slug, and a
  `wiki_pages_changed` count; `GATEWAY_PRESENCE_URL: ${{ vars.GATEWAY_PRESENCE_URL }}`,
  `GATEWAY_WEBHOOK_SECRET: ${{ secrets.GATEWAY_WEBHOOK_SECRET }}`,
  `GATEWAY_ANNOUNCE_DISABLED: ${{ vars.GATEWAY_ANNOUNCE_DISABLED }}`.
- Source `wiki_pages_changed`: add a small `pages_changed` output to the `wiki-commit` step if cheap
  (count of changed `knowledge/wiki` paths it already stages); otherwise default `0` in the context
  builder (descriptive field, non-gating).
- Build `EVENT_CONTEXT_JSON` in a tiny shell step using env-passed values + `jq -nc` (or a heredoc),
  never raw `${{ }}` interpolation in the body string.
- Do NOT fold this step into `SURVEY_STATUS`; it is best-effort telemetry.
- Declare `GATEWAY_WEBHOOK_SECRET` in the workflow's secret usage; keep least-privilege permissions.

**Patterns to follow:** the `Record survey result` env-passing block; `Notify Discord` gating style.

**Test scenarios:** Test expectation: none — workflow YAML, no executable unit surface. Validation is
`actionlint` + a live `workflow_dispatch` (see Verification).

**Verification:** `actionlint` clean; the new step's `if:` matches the success+recheck gate; the
payload context is built from verified outputs only; secret appears only in this step's env. Live
proof deferred to rollout (SC1).

- [x] **Unit 4: Wire `invitation_accepted` into `poll-invitations.yaml`**

**Goal:** Fire a single aggregated `invitation_accepted` announce when ≥1 public invitation was
accepted.

**Requirements:** R7

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `.github/workflows/poll-invitations.yaml`

**Approach:**
- Add a step after `Poll invitations`, gated on `steps.poll.outputs.public_invitations_accepted > 0`.
- Build `EVENT_CONTEXT_JSON` = `{count, repos}` from `steps.poll.outputs.public_invitations_accepted`
  and `steps.poll.outputs.public_invitations_accepted_repos` (the Unit 2 JSON list), passed via `env:`.
- Same gateway env trio as Unit 3 (`vars.GATEWAY_PRESENCE_URL`, `secrets.GATEWAY_WEBHOOK_SECRET`,
  `vars.GATEWAY_ANNOUNCE_DISABLED`).
- Single POST aggregating the cycle (not per-repo).
- Declare `GATEWAY_WEBHOOK_SECRET` in the workflow's secret usage.

**Patterns to follow:** the existing `Notify Discord` step gating in `poll-invitations.yaml`.

**Test scenarios:** Test expectation: none — workflow YAML. Validation is `actionlint` + live dispatch
(SC2).

**Verification:** `actionlint` clean; step fires only when count > 0; `context.repos` comes from the
Unit 2 list output (public only); secret scoped to the step.

- [x] **Unit 5: Document secrets/vars in `metadata/README.md`**

**Goal:** Document the three new config values and which workflows consume them.

**Requirements:** R8

**Dependencies:** Units 3, 4 (names/usage finalized)

**Files:**
- Modify: `metadata/README.md`

**Approach:**
- Add `GATEWAY_WEBHOOK_SECRET` (secret), `GATEWAY_PRESENCE_URL` (variable), `GATEWAY_ANNOUNCE_DISABLED`
  (variable, kill switch) to the secrets/vars documentation, noting `survey-repo.yaml` and
  `poll-invitations.yaml` as consumers and the gateway-opt-in prerequisite (both gateway-side values
  must be set for the endpoint to be live).
- Keep first-person/operator tone; no plan/unit/session taxonomy in the doc.

**Patterns to follow:** the existing "Workflow secret mapping" table format.

**Test scenarios:** Test expectation: none — documentation.

**Verification:** markdownlint clean; table format matches existing rows; no taxonomy leakage.

## System-Wide Impact

- **Interaction graph:** Two workflows gain a best-effort trailing step; `handle-invitation.ts` gains
  one additive step output. No change to survey/invitation control flow or `SURVEY_STATUS`.
- **Error propagation:** Announce failures are swallowed (exit 0) by design — they never propagate to
  workflow status. This is intentional and called out so a future editor doesn't "fix" it into a
  failure.
- **State lifecycle risks:** None — no persistence, no `data` branch writes, no metadata mutation.
- **API surface parity:** The signed-bytes formula must stay byte-identical to the gateway's
  `hmac.ts`; any future gateway contract change (version bump, header rename) requires a matching
  control-plane change. Memory ID 4450 pins the current contract.
- **Integration coverage:** Unit tests prove the signer; the HMAC-vector test is the cross-system
  contract check. End-to-end (real Discord post) is verified live at rollout, not in CI.
- **Unchanged invariants:** `discord-notify.ts` stays (retired in a later PR); Bluesky stays gated
  off; the survey/invitation privacy gates are unchanged and remain the only thing that lets
  `survey_completed`/`invitation_accepted` carry public identifiers.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Signed bytes drift from gateway verification (canonicalization mistake) | Sign the exact `JSON.stringify` output; HMAC-vector test matches the gateway's `hmac.ts` formula |
| `fired_at` ≠ header → gateway 400 | Single timestamp string drives both; explicit test |
| Announce failure breaks a survey/invitation run | Fail-soft exit 0; excluded from `SURVEY_STATUS`; retry only 5xx/503 |
| Private identifier leaks into Discord | Rides behind existing recheck/public gates; only public events ship; stderr redaction on failure |
| Endpoint not yet configured on the gateway | SC5 black-hole tolerance — workflows ship safely; SC1/SC2 verified post-rollout (Q8) |
| Strip-only syntax regression | strip-only-safe code + `Test Scripts Load` CI covers the new entrypoint |
| Auth material (secret/signature) leaked into CI logs | Hard redaction rule in Unit 1: logs carry event type + coarse status only; explicit redaction tests for secret/signature/body |
| Runner clock skew > 5 min → gateway 401 (replay window) | `fired_at` uses runner wall clock; GitHub runners are NTP-synced so skew is sub-second in practice. Failure is a benign fail-soft 401 (no post), not a leak; noted for operators |
| Fail-soft hides repeated announce failures from workflow status | Accepted for telemetry; operator signal is the absence of expected Discord posts. A future health-check is out of v1 scope |

## Documentation / Operational Notes

- Rollout (operator, `marcusrbrown/infra`): set `GATEWAY_WEBHOOK_SECRET` + `GATEWAY_PRESENCE_CHANNEL_ID`
  on the deployed gateway; mirror `GATEWAY_WEBHOOK_SECRET` (secret) and `GATEWAY_PRESENCE_URL`
  (variable) into this repo. Until then the pipeline is silent-safe.
- Post-v1: assess template quality in Fronomenal; if weak, the v2 composer (`rendered_text`) rises in
  priority. Capture the signer pattern in `docs/solutions/` after live verification.

## Sources & References

- **Origin document:** docs/brainstorms/2026-05-23-discord-presence-via-control-plane-events-requirements.md
- Shipped gateway: `fro-bot/agent` PR #697 (#671), `packages/gateway/src/http/{announce-schema,announce-handler,hmac}.ts`
- Related code: `scripts/discord-notify.ts`, `scripts/bluesky-post.ts`, `scripts/handle-invitation.ts`,
  `.github/workflows/survey-repo.yaml`, `.github/workflows/poll-invitations.yaml`, `metadata/README.md`
- Related learnings: diagnostic-observability-discipline-2026-05-20, node-strip-only-typescript-2026-04-18,
  github-actions-step-output-interpolation-2026-04-21, autonomous-pipeline-silent-failures-2026-04-19,
  survey-workflow-side-privacy-gate-2026-05-16
- Contract memory: ID 4450
