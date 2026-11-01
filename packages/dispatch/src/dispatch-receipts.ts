/**
 * Text parsing of coordination comments: the planner's checklist, the worker's completion receipt (with its
 * escape repair) and the three-gate receipt resolver, plus the nonce primitives that bind a receipt to its item.
 */

import {createHash, randomBytes} from 'node:crypto'
import {
  FROBOT_COMMENT_AUTHORS,
  MAX_ITEMS_PER_GOAL,
  type CrossRepoResult,
  type DecompositionResult,
  type DispatchItem,
  type ParseResultOutcome,
  type ResultStatus,
  type TrackerComment,
} from './dispatch-model.ts'

const CHECKLIST_LINE = /^[-*+]\s*\[[ x]\]\s+([\w-]+)\/([\w.-]+): (.+)$/i

/** Loose task-list shape check — anything matching this MUST also satisfy `CHECKLIST_LINE`. */
export const LOOSE_TASK_LIST_PREFIX = /^[-*+]\s*\[[ x]\]/i

/** Delimited region the planner emits around its checklist (see `fro-bot.yaml`). Optional. */
const ITEMS_REGION_START = '<!-- fro-bot:cross-repo-items:start -->'

const ITEMS_REGION_END = '<!-- fro-bot:cross-repo-items:end -->'

/** Delimited region a worker emits around its completion receipt (see `fro-bot.yaml`). Optional. */
const RESULT_REGION_START = '<!-- fro-bot:cross-repo-result:start -->'

const RESULT_REGION_END = '<!-- fro-bot:cross-repo-result:end -->'

/** Marker prefix identifying a completion-receipt HTML comment. */
const RESULT_MARKER_PREFIX = 'fro-bot:cross-repo-result '

const RESULT_STATUSES: ReadonlySet<ResultStatus> = new Set(['success', 'noop', 'failed'])

/**
 * Extract the substring between the delimited region markers, if both are
 * present in order. Returns null when the region is absent (caller falls
 * back to scanning the whole body tolerantly).
 */
function extractItemsRegion(body: string): string | null {
  return extractDelimitedRegion(body, ITEMS_REGION_START, ITEMS_REGION_END)
}

/**
 * Generic delimited-region extractor: returns the substring between
 * `startMarker` and `endMarker` (in order) when both are present, else null
 * so the caller falls back to scanning the whole body tolerantly. Shared by
 * `extractItemsRegion` (decomposition) and the receipt region below.
 */
function extractDelimitedRegion(body: string, startMarker: string, endMarker: string): string | null {
  const startIndex = body.indexOf(startMarker)
  if (startIndex === -1) return null
  const afterStart = startIndex + startMarker.length
  const endIndex = body.indexOf(endMarker, afterStart)
  if (endIndex === -1) return null
  return body.slice(afterStart, endIndex)
}

/** Extract the substring between the receipt region markers, if both present. */
function extractResultRegion(body: string): string | null {
  return extractDelimitedRegion(body, RESULT_REGION_START, RESULT_REGION_END)
}

interface ChecklistCollectResult {
  ok: boolean
  items: DispatchItem[]
}

/**
 * Scan `scope` line by line: task-list-shaped lines must fully match
 * `CHECKLIST_LINE` or the whole scan fails malformed; anything else
 * (prose, headers, HTML, table rows, footers) is skipped. Item ids are
 * assigned by ORDINAL among collected items, not source line index, so
 * surrounding prose can shift without changing ids.
 */
function collectChecklistItems(scope: string): ChecklistCollectResult {
  const lines = scope
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const items: DispatchItem[] = []
  for (const line of lines) {
    if (!LOOSE_TASK_LIST_PREFIX.test(line)) continue

    const match = CHECKLIST_LINE.exec(line)
    if (match === null) return {ok: false, items: []}
    const [, owner, name, prompt] = match
    if (owner === undefined || name === undefined || prompt === undefined) return {ok: false, items: []}

    items.push({
      id: `item-${items.length + 1}`,
      target: {owner, name},
      promptHash: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
      status: 'pending',
    })
  }

  return {ok: true, items}
}

/**
 * Parse a planner checklist comment body into closed-vocabulary items.
 * Grammar: `- [ ] <owner>/<name>: <prompt>` per line. Prefers the delimited
 * `fro-bot:cross-repo-items` region when present; otherwise scans the whole
 * body tolerantly, skipping non-checklist-shaped prose/HTML lines. A line
 * that IS task-list-shaped but fails the strict grammar is still a parse
 * error — never free-text passthrough into item fields.
 */
export function parseDecomposition(commentBody: string): DecompositionResult {
  const region = extractItemsRegion(commentBody)
  const scope = region ?? commentBody

  const collected = collectChecklistItems(scope)
  if (!collected.ok) {
    return {
      ok: false,
      items: [],
      error: 'checklist-shaped line failed to match the required grammar',
      reason: 'malformed',
    }
  }

  if (collected.items.length === 0) {
    return {ok: false, items: [], error: 'empty decomposition', reason: 'no-items'}
  }

  if (collected.items.length > MAX_ITEMS_PER_GOAL) {
    return {
      ok: false,
      items: [],
      error: `item count ${collected.items.length} exceeds cap of ${MAX_ITEMS_PER_GOAL}`,
      reason: 'too-many-items',
    }
  }

  return {ok: true, items: collected.items}
}

/**
 * Extract a promptHash → raw prompt text map from a planner checklist body,
 * using the SAME `collectChecklistItems` helper (region preference + strict
 * loose-then-strict line classification) as `parseDecomposition`. Pure, no
 * I/O. If the scope is malformed (a task-list-shaped line fails the strict
 * grammar), no items are collected and the map is empty — this deliberately
 * mirrors `parseDecomposition`'s failure rather than silently emitting a
 * partial map that hides the malformed line. Used by the dispatch shell to
 * recover the item prompt text for a `DispatchItem` (which stores only the
 * hash) without trusting free text.
 */
export function extractItemPrompts(commentBody: string): Map<string, string> {
  const region = extractItemsRegion(commentBody)
  const scope = region ?? commentBody

  const collected = collectChecklistItems(scope)
  const prompts = new Map<string, string>()
  if (!collected.ok) return prompts

  // Re-derive prompt text alongside the hash `collectChecklistItems` already
  // computed, using the same line classification so both stay in lockstep.
  const lines = scope
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  for (const line of lines) {
    if (!LOOSE_TASK_LIST_PREFIX.test(line)) continue
    const match = CHECKLIST_LINE.exec(line)
    if (match === null) continue
    const prompt = match[3]
    if (prompt === undefined) continue
    const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 16)
    prompts.set(hash, prompt)
  }

  return prompts
}

/**
 * Build the completion-receipt comment body: the `:start`/`:end` delimited
 * region wrapping the JSON marker, mirroring the decomposition region
 * convention. `receipt.nonce` is the RAW nonce — callers are responsible for
 * only calling this from a worker context where posting the raw nonce
 * publicly is the intended, documented behavior (R6c).
 */
export function buildResultMarker(receipt: CrossRepoResult): string {
  const payload = {
    correlation_id: receipt.correlationId,
    nonce: receipt.nonce,
    status: receipt.status,
    summary: receipt.summary,
    ...(receipt.pr === undefined ? {} : {pr: receipt.pr}),
  }
  const marker = `<!-- ${RESULT_MARKER_PREFIX}${JSON.stringify(payload)} -->`
  return [RESULT_REGION_START, marker, RESULT_REGION_END].join('\n')
}

/**
 * Parse a single `fro-bot:cross-repo-result {json}` marker out of `scope`,
 * scanning the WHOLE string (not anchored to region boundaries) so a bare
 * marker amid prose or inside a fenced block still parses. Returns null when
 * no such marker is found; throws nothing — malformed JSON/field validation
 * is the caller's job so "marker found but invalid" and "no marker" stay
 * distinguishable outcomes.
 *
 * The `-->` terminator is string-aware: a `-->` that appears inside a
 * double-quoted JSON string value (e.g. a `summary` containing a literal
 * arrow) does not close the marker — only an out-of-string `-->` does. This
 * mirrors `repairJsonStringEscapes`'s string-scope discipline: a string is
 * entered on `"`, exited on an unescaped `"`, and `\"`/`\\` inside a string
 * do not toggle scope. If an occurrence's prefix is found but no
 * out-of-string `-->` follows before the end of `scope`, that occurrence is
 * treated as an incomplete marker (skipped), matching how the old
 * non-greedy regex would simply fail to match it.
 */
const MARKER_PREFIX_REGEX = /<!--\s*fro-bot:cross-repo-result\s/g

function findMarkerTerminator(scope: string, payloadStart: number): number | null {
  let inString = false
  // Fallback for genuinely malformed JSON (e.g. an unterminated string that
  // never closes before EOF): if no out-of-string `-->` is ever found, fall
  // back to the first literal `-->` regardless of string state, mirroring
  // the old non-greedy-regex behavior so such payloads still reach
  // JSON.parse and surface as `malformed` rather than vanishing into
  // `absent`. A marker with no `-->` anywhere remains a true `absent`.
  let naiveFallback: number | null = null

  for (let i = payloadStart; i < scope.length; i++) {
    const ch = scope[i]
    const atArrow = ch === '-' && scope.startsWith('-->', i)

    if (atArrow && naiveFallback === null) naiveFallback = i

    if (inString) {
      if (ch === '\\') {
        // Skip the escaped character so `\"` and `\\` don't toggle/confuse scope.
        i += 1
        continue
      }
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (atArrow) return i
  }
  return naiveFallback
}

function extractResultMarkerJson(scope: string): string | null {
  let lastPayload: string | null = null
  MARKER_PREFIX_REGEX.lastIndex = 0
  for (;;) {
    const match = MARKER_PREFIX_REGEX.exec(scope)
    if (match === null) break

    const payloadStart = match.index + match[0].length
    const terminatorIndex = findMarkerTerminator(scope, payloadStart)
    if (terminatorIndex === null) continue

    lastPayload = scope.slice(payloadStart, terminatorIndex)
  }
  return lastPayload
}

/**
 * Best-effort, non-trust-bearing extraction of a `correlation_id` string
 * from a bot-authored receipt marker that failed strict JSON/field
 * validation (R6b). Used ONLY to attribute a distinct `unparseable-receipt`
 * non-terminal attention reason to the right item — never to resolve
 * terminal state, so a loose/partial match here carries no security weight.
 */
function extractLooseCorrelationId(body: string): string | null {
  const region = extractResultRegion(body)
  const scope = region ?? body
  const jsonStr = extractResultMarkerJson(scope)
  if (jsonStr === null) return null
  const match = /"correlation_id"\s*:\s*"([^"]+)"/.exec(jsonStr)
  return match?.[1] ?? null
}

function isValidResultPayload(value: unknown): value is {
  correlation_id: string
  nonce: string
  status: ResultStatus
  summary: string
  pr?: string
} {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.correlation_id !== 'string' || record.correlation_id.length === 0) return false
  if (typeof record.nonce !== 'string' || record.nonce.length === 0) return false
  if (typeof record.status !== 'string' || !RESULT_STATUSES.has(record.status as ResultStatus)) return false
  if (typeof record.summary !== 'string') return false
  if (record.pr !== undefined && typeof record.pr !== 'string') return false
  return true
}

const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

const HEX_DIGIT = /[0-9a-f]/i

/**
 * Repair markdown-style backslash-escapes (`\#`, `` \` ``, `\*`, `\_`, `\[`,
 * `\]`, etc.) that LLM workers occasionally emit inside JSON string values —
 * the drift class where an agent markdown-escapes a special character before
 * realizing it's writing JSON, not prose. Walks `raw` tracking whether the
 * cursor is inside a double-quoted string (an escaped quote `\"` does not
 * toggle string state) and only rewrites escapes found INSIDE strings; text
 * outside strings is passed through untouched.
 *
 * Inside a string, for each `\X`:
 * - a valid JSON escape (`\" \\ \/ \b \f \n \r \t`, or `\u` followed by
 *   exactly 4 hex digits) is preserved unchanged.
 * - a malformed `\u` (not followed by 4 hex digits) is left as-is —
 *   deliberately NOT repaired, so parsing still fails on genuinely broken
 *   unicode escapes rather than silently guessing at intent.
 * - a trailing/lone backslash (end of string, or immediately before the
 *   closing quote) is left as-is for the same reason.
 * - anything else (`\#`, `` \` ``, `\*`, `\_`, `\[`, `\]`, `\(`, ...) has the
 *   backslash dropped, keeping the literal character.
 *
 * Security note: this only widens which receipts can ATTEMPT JSON.parse.
 * The three trust gates in `resolveReceipts` (Fro Bot author, correlation_id
 * maps to a dispatched item, hash(nonce) === nonceHash) run unchanged AFTER
 * parse — repairing escapes cannot forge a nonce preimage or an author.
 */
export function repairJsonStringEscapes(raw: string): string {
  let result = ''
  let inString = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (!inString) {
      result += ch
      if (ch === '"') inString = true
      continue
    }

    if (ch === '"') {
      inString = false
      result += ch
      continue
    }

    if (ch !== '\\') {
      result += ch
      continue
    }

    const next = raw[i + 1]
    if (next === undefined) {
      // Trailing lone backslash: leave as-is, don't invent meaning.
      result += ch
      continue
    }

    if (next === 'u') {
      const hex = raw.slice(i + 2, i + 6)
      if (hex.length === 4 && [...hex].every(c => HEX_DIGIT.test(c))) {
        result += raw.slice(i, i + 6)
        i += 5
      } else {
        // Malformed unicode escape: leave untouched so parse still fails.
        result += ch
      }
      continue
    }

    if (VALID_JSON_ESCAPES.has(next)) {
      result += ch + next
      i += 1
      continue
    }

    // Not a valid JSON escape introducer (markdown-style escape): drop the
    // backslash, keep the literal character.
    result += next
    i += 1
  }
  return result
}

/**
 * Parse a worker completion-receipt comment body. Prefers the delimited
 * `cross-repo-result` region when present (mirroring `extractItemsRegion`'s
 * region-preference); a bare marker without the region still parses via the
 * body-scan fallback for backward tolerance. Strict on fields: valid JSON,
 * required `correlation_id` + `nonce` + `status` (status one of the closed
 * vocabulary) — anything else is `malformed`, distinct from `absent` (no
 * receipt marker found at all). Returns the RAW nonce as posted; this
 * function never hashes it or sees a stored `nonceHash`.
 */
export function parseResult(body: string): ParseResultOutcome {
  const region = extractResultRegion(body)
  const scope = region ?? body

  const jsonStr = extractResultMarkerJson(scope)
  if (jsonStr === null) {
    return {ok: false, reason: 'absent'}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    // Strict parse failed — retry once against a repaired copy tolerant of
    // markdown-style backslash-escapes inside string values (e.g. `\#`). If
    // this still throws, fall through to the existing `malformed` outcome.
    try {
      parsed = JSON.parse(repairJsonStringEscapes(jsonStr))
    } catch {
      return {ok: false, reason: 'malformed'}
    }
  }

  if (!isValidResultPayload(parsed)) {
    return {ok: false, reason: 'malformed'}
  }

  const result: CrossRepoResult = {
    correlationId: parsed.correlation_id,
    nonce: parsed.nonce,
    status: parsed.status,
    summary: parsed.summary,
    ...(parsed.pr === undefined ? {} : {pr: parsed.pr}),
  }
  return {ok: true, result}
}

/**
 * Per-item outcome of applying the three-gate receipt resolver to a single
 * goal's comment stream. `terminal` carries the resolved `ResultStatus` when
 * an authentic receipt won the earliest-wins race; `attentionReason` is set
 * only when the item has no terminal receipt yet but is flagged
 * `needs-attention` (R9/R9a); `retainedUnconfirmed` marks an authentic
 * receipt seen for an item that is not yet confirmed-dispatched, so the
 * caller can re-evaluate it next pass instead of dropping it (early-receipt
 * tolerance).
 */
export interface ReceiptResolution {
  terminal?: ResultStatus
  attentionReason?: 'no-receipt' | 'unparseable-receipt'
  retainedUnconfirmed?: boolean
}

/**
 * Resolve the receipt-driven terminal/attention state for every item in
 * `items`, given the goal's ordered comment stream (chronological — earliest
 * first). Implements R6 (three-gate trust: author, correlation-id mapping,
 * hash-bound nonce), R6c (earliest-authentic-receipt-wins, never
 * `findLast`/latest), R6b (malformed bot-authored marker → distinct
 * `unparseable-receipt`), and early-receipt tolerance (an authentic receipt
 * for a not-yet-confirmed item is retained, never dropped). The SLA check
 * (R9) is a separate, purely time-based concern applied by the caller
 * (`runTrack`) using the injected clock — this resolver has no notion of
 * wall time. Pure.
 */
export function resolveReceipts(items: DispatchItem[], comments: TrackerComment[]): Map<string, ReceiptResolution> {
  const itemsByCorrelationId = new Map(
    items.filter(item => item.correlationId !== undefined).map(item => [item.correlationId as string, item]),
  )
  const resolutions = new Map<string, ReceiptResolution>()

  // Earliest-authentic-receipt-wins (R6c): walk comments in chronological
  // (given) order, never `findLast`/latest-wins, and never let a later
  // receipt overwrite an item that already has a terminal resolution.
  for (const comment of comments) {
    if (!FROBOT_COMMENT_AUTHORS.has(comment.author.login)) continue

    const outcome = parseResult(comment.body)
    if (!outcome.ok) {
      // `absent` (no receipt marker in this comment at all) is not a signal.
      if (outcome.reason !== 'malformed') continue

      // A bot-authored marker IS receipt-shaped but failed strict field
      // validation (R6b). Best-effort attribution to a dispatched item via a
      // loosely-recovered `correlation_id` (NOT trust-bearing — this never
      // resolves terminal state, it only flags non-terminal
      // `unparseable-receipt`, distinct from `no-receipt`).
      const looseCorrelationId = extractLooseCorrelationId(comment.body)
      if (looseCorrelationId === null) continue
      const item = itemsByCorrelationId.get(looseCorrelationId)
      if (item === undefined) continue

      const existing = resolutions.get(item.id)
      if (existing?.terminal !== undefined) continue
      resolutions.set(item.id, {...existing, attentionReason: 'unparseable-receipt'})
      continue
    }

    const receipt = outcome.result
    if (receipt === undefined) continue

    const item = itemsByCorrelationId.get(receipt.correlationId)
    if (item === undefined) {
      // Bot-authored comment whose id matches no item on this goal — ignored
      // entirely for state (gate b).
      continue
    }

    if (item.nonceHash === undefined || hashNonce(receipt.nonce) !== item.nonceHash) {
      // Gate (c) fails: forged/mismatched nonce. Ignored entirely — never
      // resolves, never counted as an attention signal.
      continue
    }

    // Early-receipt tolerance: an authentic receipt for an item that is not
    // yet confirmed-dispatched (no epoch yet, e.g. still 'intent'/'pending')
    // is retained for re-evaluation next pass, never dropped and never used
    // to resolve state now.
    if (item.epoch === undefined) {
      const existing = resolutions.get(item.id)
      if (existing?.terminal === undefined) {
        resolutions.set(item.id, {...existing, retainedUnconfirmed: true})
      }
      continue
    }

    const existing = resolutions.get(item.id)
    if (existing?.terminal !== undefined) {
      // Item already resolved from an EARLIER authentic receipt in this same
      // chronological walk — never flips (R6c replay safety).
      continue
    }

    resolutions.set(item.id, {terminal: receipt.status})
  }

  return resolutions
}

/** Compute a compact opaque correlation id: goal + item id + nonce, hashed. */
export function computeCorrelationId(goal: string, itemId: string, nonce: string): string {
  return createHash('sha256').update(`${goal}:${itemId}:${nonce}`).digest('hex').slice(0, 20)
}

/**
 * Mint a raw, in-memory-only per-item nonce with a CSPRNG. 32 bytes (256
 * bits) of entropy, base64url-encoded (URL/prompt-safe, no padding noise).
 * NEVER derived from `hashState` (64-bit truncation) or
 * `Date.now()`/`Math.random()` — those are not high-entropy secrets (R6).
 */
export function mintNonce(): string {
  return randomBytes(32).toString('base64url')
}

/** Full SHA-256 hex digest of a raw nonce, for storage as `nonceHash` (R6). Never truncated. */
export function hashNonce(rawNonce: string): string {
  return createHash('sha256').update(rawNonce).digest('hex')
}
