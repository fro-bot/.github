import {createHash, randomBytes} from 'node:crypto'
import process from 'node:process'
import {assertReposFile} from './schemas.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ItemStatus =
  'pending' | 'intent' | 'dispatched' | 'completed' | 'failed' | 'blocked' | 'deferred' | 'needs-attention'

export interface DispatchTarget {
  owner: string
  name: string
}

export interface DispatchItem {
  id: string
  target: DispatchTarget
  promptHash: string
  status: ItemStatus
  correlationId?: string
  epoch?: number
  /**
   * Full SHA-256 hex digest of a CSPRNG-minted raw per-item nonce (R6). The
   * raw nonce itself is NEVER persisted here or anywhere in the public
   * marker — it is delivered only via the dispatch prompt. Set at
   * confirmed-dispatch time (and, defensively, at the preceding intent
   * write) alongside `correlationId`; never derived from `hashState`
   * (64-bit truncation) or `Date.now()/Math.random()`.
   */
  nonceHash?: string
  /**
   * Set only when `status === 'needs-attention'` (R9/R9a): why no terminal
   * receipt has resolved this item yet. `no-receipt` = no authentic receipt
   * seen and the item is past the SLA; `unparseable-receipt` = a bot-authored
   * receipt marker is present but failed strict field validation. Cleared
   * the moment a later authentic well-formed receipt resolves the item.
   */
  needsAttentionReason?: 'no-receipt' | 'unparseable-receipt'
  /**
   * Diagnostic-only annotation (Unit 5), set ONLY when
   * `needsAttentionReason === 'no-receipt'`: whether the demoted run-lookup
   * collaborator found a concluded run for this item ('ran-no-report') or no
   * run at all ('never-ran'). NEVER influences terminal/non-terminal state —
   * receipts (R7), the SLA (R9), and the registry gate are the only state
   * drivers. Purely forensic signal for the operator (R8: no PR polling for
   * completion; run-lookup is diagnostic, not authoritative).
   */
  noReceiptDiagnostic?: 'ran-no-report' | 'never-ran'
}

export interface GoalState {
  goal: string
  items: DispatchItem[]
  approvalFingerprint?: string
  markerHash: string
}

export interface MarkerData {
  hash: string
  state: Omit<GoalState, 'markerHash'>
}

export interface TrackerComment {
  author: {login: string}
  body: string
}

export interface DecompositionResult {
  ok: boolean
  items: DispatchItem[]
  error?: string
  /** Machine-checkable failure discriminant, set only when `ok` is false. */
  reason?: 'too-many-items' | 'no-items' | 'malformed'
}

/** Worker-reported outcome vocabulary for a completion receipt. `blocked` is the pre-dispatch gate outcome, never a worker status. */
export type ResultStatus = 'success' | 'noop' | 'failed'

/**
 * Completion receipt posted by a worker to the coordination issue. `nonce`
 * is the RAW per-item nonce as posted by the worker — the parser never
 * hashes it or compares it against a stored `nonceHash` (that gate lives in
 * track's resolver, Unit 4).
 */
export interface CrossRepoResult {
  correlationId: string
  nonce: string
  status: ResultStatus
  summary: string
  pr?: string
}

/**
 * Outcome of parsing a receipt comment body. `absent` = no receipt marker
 * present at all; `malformed` = a receipt marker was found but failed
 * strict field validation — the two are distinct outcomes (mirrors
 * `parseDecomposition`'s "checklist-shaped but invalid" vs "no checklist").
 */
export interface ParseResultOutcome {
  ok: boolean
  result?: CrossRepoResult
  reason?: 'absent' | 'malformed'
}

export type GateResult = 'ok' | 'blocked-not-onboarded' | 'blocked-ineligible'

/** Minimal shape of a registry entry needed for the gate — mirrors `RepoEntry`. */
export interface GateEntry {
  owner: string
  name: string
  has_fro_bot_workflow: boolean
  private?: boolean
}

export interface DispatchPlanInput {
  state: GoalState
  fingerprint: string
  otherOpenGoalMarkers: GoalState[]
}

export interface DispatchPlanResult {
  toDispatch: DispatchItem[]
  deferred: DispatchItem[]
  blocked: DispatchItem[]
  toDispatchCount: number
  deferredCount: number
  blockedCount: number
}

/**
 * Registry-gate signal only (Unit 5): the run/PR terminal-resolution
 * precedence table is gone — receipts (R7) and the SLA (R9) are applied
 * directly by `runTrack` before `planSnapshot` runs. The gate is the only
 * remaining out-of-band signal `planSnapshot` still resolves, because it can
 * flip an item to `blocked` independent of any receipt.
 */
export interface SnapshotSignals {
  [itemId: string]: {gateBlocked?: boolean}
}

export interface SnapshotPlanInput {
  state: GoalState
  signals: SnapshotSignals
}

export interface SnapshotPlanResult {
  state: GoalState
  allTerminal: boolean
  shouldWrite: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** HTML marker prefix embedded in coordination-issue comments. */
export const MARKER_PREFIX = 'cross-repo-dispatch:'

/** Fro Bot identities permitted to author state marker comments. Mirrors rollout-tracker. */
export const FROBOT_COMMENT_AUTHORS: ReadonlySet<string> = new Set(['fro-bot', 'fro-bot[bot]'])

/** Owner repos eligible as dispatch targets — v1 is owner-repos-only. */
export const ELIGIBLE_OWNERS: ReadonlySet<string> = new Set(['fro-bot', 'marcusrbrown'])

/** Hard cap on items per goal, keeping the serialized marker well under GitHub's comment limit. */
export const MAX_ITEMS_PER_GOAL = 20

const ITEM_STATUSES: ReadonlySet<ItemStatus> = new Set([
  'pending',
  'intent',
  'dispatched',
  'completed',
  'failed',
  'blocked',
  'deferred',
  'needs-attention',
])

/** 24h SLA (R9), named tunable: wall-age from confirm-time `epoch` before a no-receipt item surfaces `needs-attention`. */
export const RECEIPT_SLA_MS = 24 * 60 * 60 * 1000

const TERMINAL_STATUSES: ReadonlySet<ItemStatus> = new Set(['completed', 'failed', 'blocked'])

const IN_FLIGHT_STATUSES: ReadonlySet<ItemStatus> = new Set(['intent', 'dispatched'])

// ─── Marker parse / serialize ────────────────────────────────────────────────

function isDispatchTarget(value: unknown): value is DispatchTarget {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).owner === 'string' &&
    typeof (value as Record<string, unknown>).name === 'string'
  )
}

function isDispatchItem(value: unknown): value is DispatchItem {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return false
  if (!isDispatchTarget(record.target)) return false
  if (typeof record.promptHash !== 'string') return false
  if (typeof record.status !== 'string' || !ITEM_STATUSES.has(record.status as ItemStatus)) return false
  if (record.correlationId !== undefined && typeof record.correlationId !== 'string') return false
  if (record.epoch !== undefined && typeof record.epoch !== 'number') return false
  if (record.nonceHash !== undefined && typeof record.nonceHash !== 'string') return false
  if (
    record.needsAttentionReason !== undefined &&
    record.needsAttentionReason !== 'no-receipt' &&
    record.needsAttentionReason !== 'unparseable-receipt'
  ) {
    return false
  }
  if (
    record.noReceiptDiagnostic !== undefined &&
    record.noReceiptDiagnostic !== 'ran-no-report' &&
    record.noReceiptDiagnostic !== 'never-ran'
  ) {
    return false
  }
  return true
}

function isGoalStateBody(value: unknown): value is Omit<GoalState, 'markerHash'> {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.goal !== 'string') return false
  if (!Array.isArray(record.items) || !record.items.every(isDispatchItem)) return false
  if (record.approvalFingerprint !== undefined && typeof record.approvalFingerprint !== 'string') return false
  return true
}

/**
 * Produce a stable SHA-256 hex hash (16 chars) of the canonical goal state.
 * Latest-state-only: no history arrays are ever hashed.
 */
export function hashState(state: Omit<GoalState, 'markerHash'>): string {
  const stable = JSON.stringify(state, sortedReplacer)
  return createHash('sha256').update(stable).digest('hex').slice(0, 16)
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k]
    }
    return sorted
  }
  return value
}

/**
 * Extract the marker JSON from a comment body. Returns null if absent or malformed.
 * When multiple markers are present, the LAST one wins (latest state).
 */
export function extractMarker(body: string): MarkerData | null {
  if (!body) return null

  const markerRegex = /<!--\s*cross-repo-dispatch:([\s\S]*?)-->/g
  let lastMatch: RegExpExecArray | null = null
  for (;;) {
    const match = markerRegex.exec(body)
    if (match === null) break
    lastMatch = match
  }
  if (lastMatch === null) return null

  const jsonStr = lastMatch[1]
  if (jsonStr === undefined) return null

  try {
    const parsed: unknown = JSON.parse(jsonStr)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).hash !== 'string' ||
      !isGoalStateBody((parsed as Record<string, unknown>).state)
    ) {
      return null
    }
    return parsed as MarkerData
  } catch {
    return null
  }
}

/**
 * Author-filtered latest bot marker: rejects non-bot authors (including `marcusrbrown`).
 * Uses `findLast` semantics — the latest bot-authored marker comment body wins.
 */
export function selectStateMarker(comments: TrackerComment[]): MarkerData | null {
  const body =
    comments.findLast(
      comment => FROBOT_COMMENT_AUTHORS.has(comment.author.login) && extractMarker(comment.body) !== null,
    )?.body ?? ''
  return extractMarker(body)
}

const CHECKLIST_LINE = /^[-*+]\s*\[[ x]\]\s+([\w-]+)\/([\w.-]+): (.+)$/i

/** Loose task-list shape check — anything matching this MUST also satisfy `CHECKLIST_LINE`. */
const LOOSE_TASK_LIST_PREFIX = /^[-*+]\s*\[[ x]\]/i

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
 */
function extractResultMarkerJson(scope: string): string | null {
  const markerRegex = /<!--\s*fro-bot:cross-repo-result\s([\s\S]*?)-->/g
  let lastMatch: RegExpExecArray | null = null
  for (;;) {
    const match = markerRegex.exec(scope)
    if (match === null) break
    lastMatch = match
  }
  return lastMatch?.[1] ?? null
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

/**
 * Parse a worker completion-receipt comment body. Prefers the delimited
 * `cross-repo-result` region when present (mirroring `extractItemsRegion`'s
 * region-preference); a bare marker without the region still parses via the
 * body-scan fallback for backward tolerance. Strict on fields: valid JSON,
 * required `correlation_id` + `nonce` + `status` (status one of the closed
 * vocabulary) — anything else is `malformed`, distinct from `absent` (no
 * receipt marker found at all). Returns the RAW nonce as posted; this
 * function never hashes it or sees a stored `nonceHash` (Unit 4's job).
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
    return {ok: false, reason: 'malformed'}
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

/**
 * Stable, order-insensitive but membership-sensitive fingerprint: items are
 * sorted by a canonical key of target+promptHash before hashing, so cosmetic
 * reordering doesn't invalidate approval while adding/removing an item does.
 */
export function computeApprovalFingerprint(items: DispatchItem[]): string {
  const canonicalKeys = items
    .map(item => `${item.target.owner}/${item.target.name}:${item.promptHash}`)
    .sort((a, b) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify(canonicalKeys)).digest('hex').slice(0, 16)
}

/** Serialize goal state (sans markerHash) into the canonical state used for hashing. */
function canonicalStateBody(state: GoalState): Omit<GoalState, 'markerHash'> {
  return {
    goal: state.goal,
    items: state.items,
    ...(state.approvalFingerprint === undefined ? {} : {approvalFingerprint: state.approvalFingerprint}),
  }
}

/** Compute the markerHash for a goal state over its canonical (latest-state-only) body. */
export function serializeMarker(state: GoalState): MarkerData {
  const body = canonicalStateBody(state)
  return {hash: hashState(body), state: body}
}

/** Build the full comment body embedding the state marker. */
export function buildMarkerComment(state: GoalState): string {
  const marker = serializeMarker(state)
  return `<!-- ${MARKER_PREFIX}${JSON.stringify(marker)} -->`
}

// ─── Planner: registry gate ──────────────────────────────────────────────────

/**
 * Owner-only, fail-closed registry gate.
 * - `blocked-not-onboarded` when the entry lacks the Fro Bot workflow.
 * - `blocked-ineligible` when the owner is not in the eligible set, the repo
 *   is not definitively public, or the entry is missing from the registry.
 */
export function gateTarget(entry: GateEntry | undefined): GateResult {
  if (entry === undefined) return 'blocked-ineligible'
  if (!ELIGIBLE_OWNERS.has(entry.owner)) return 'blocked-ineligible'
  if (entry.private !== false) return 'blocked-ineligible'
  if (!entry.has_fro_bot_workflow) return 'blocked-not-onboarded'
  return 'ok'
}

// ─── Planner: dispatch plan ──────────────────────────────────────────────────

/**
 * Which items to dispatch now. Skips items already intent/dispatched/terminal.
 * Defers items whose target has an in-flight (intent/dispatched) item in any
 * OTHER open goal marker — same-target serialization.
 */
export function planDispatch(input: DispatchPlanInput): DispatchPlanResult {
  const inFlightTargets = new Set<string>()
  for (const other of input.otherOpenGoalMarkers) {
    for (const item of other.items) {
      if (IN_FLIGHT_STATUSES.has(item.status)) {
        inFlightTargets.add(`${item.target.owner}/${item.target.name}`)
      }
    }
  }

  const toDispatch: DispatchItem[] = []
  const deferred: DispatchItem[] = []
  const blocked: DispatchItem[] = []

  for (const item of input.state.items) {
    if (item.status === 'blocked') {
      blocked.push(item)
      continue
    }
    if (IN_FLIGHT_STATUSES.has(item.status) || TERMINAL_STATUSES.has(item.status)) continue

    const targetKey = `${item.target.owner}/${item.target.name}`
    if (inFlightTargets.has(targetKey)) {
      deferred.push(item)
      continue
    }
    toDispatch.push(item)
  }

  return {
    toDispatch,
    deferred,
    blocked,
    toDispatchCount: toDispatch.length,
    deferredCount: deferred.length,
    blockedCount: blocked.length,
  }
}

// ─── Planner: snapshot decision ──────────────────────────────────────────────

/**
 * Apply the registry-gate signal per dispatched item (the only remaining
 * out-of-band terminal driver — receipts and the SLA are applied by the
 * caller before this runs; Unit 5 removed the run/PR terminal-resolution
 * precedence table entirely), compute allTerminal (→ close), and idempotency
 * (identical markerHash → no write).
 */
export function planSnapshot(input: SnapshotPlanInput): SnapshotPlanResult {
  const updatedItems = input.state.items.map(item => {
    const signal = input.signals[item.id]
    if (signal === undefined) return item
    if (TERMINAL_STATUSES.has(item.status)) return item
    if (signal.gateBlocked !== true) return item
    return {...item, status: 'blocked' as ItemStatus}
  })

  const updatedState: GoalState = {
    ...input.state,
    items: updatedItems,
  }
  const marker = serializeMarker(updatedState)
  const finalState: GoalState = {...updatedState, markerHash: marker.hash}

  const allTerminal = updatedItems.every(item => TERMINAL_STATUSES.has(item.status))
  const shouldWrite = marker.hash !== input.state.markerHash

  return {state: finalState, allTerminal, shouldWrite}
}

// ─── Shells: shared octokit client shape ─────────────────────────────────────

/** Minimal Octokit-like client shared by both shells. Injected for testability. */
export interface CrossRepoDispatchOctokitClient {
  readonly rest: {
    readonly issues: {
      readonly listComments: (params: {
        owner: string
        repo: string
        issue_number: number
      }) => Promise<{data: {id: number; body?: string | null; user: {login: string} | null}[]}>
      readonly createComment: (params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<{data: {id: number}}>
      readonly updateComment: (params: {
        owner: string
        repo: string
        comment_id: number
        body: string
      }) => Promise<unknown>
      readonly update: (params: {
        owner: string
        repo: string
        issue_number: number
        state?: 'open' | 'closed'
        labels?: string[]
      }) => Promise<unknown>
      readonly removeLabel: (params: {
        owner: string
        repo: string
        issue_number: number
        name: string
      }) => Promise<unknown>
      readonly listForRepo: (params: {
        owner: string
        repo: string
        labels?: string
        state?: 'open' | 'closed' | 'all'
        per_page?: number
      }) => Promise<{data: {number: number}[]}>
    }
    readonly actions: {
      readonly createWorkflowDispatch: (params: {
        owner: string
        repo: string
        workflow_id: string
        ref: string
        inputs?: Record<string, string>
      }) => Promise<unknown>
      readonly listWorkflowRunsForRepo: (params: {
        owner: string
        repo: string
        workflow_id: string
        per_page?: number
      }) => Promise<{
        data: {
          workflow_runs: {
            id: number
            name?: string | null
            display_title?: string | null
            status: string | null
            conclusion: string | null
          }[]
        }
      }>
    }
  }
}

/** Target workflow file dispatched into every approved item's target repo. */
export const TARGET_WORKFLOW_ID = 'fro-bot.yaml'

/** Default ref dispatched against in target repos. */
export const TARGET_WORKFLOW_REF = 'main'

/** Actor required to approve dispatch — script-side gate independent of the workflow gate. */
export const REQUIRED_APPROVER = 'marcusrbrown'

/** Bounded retry count for compare-and-swap marker writes. */
export const CAS_MAX_RETRIES = 3

/** Upper bound on item-prompt length accepted by the safety policy. */
export const MAX_PROMPT_LENGTH = 4000

/** Patterns rejected by the item-prompt safety policy — credential/secret-looking content. */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
]

/**
 * Item-prompt safety policy: length-capped, no credential/secret-looking
 * content, owner-target only (enforced by `gateTarget` upstream). Pure.
 */
export function isPromptSafe(prompt: string): boolean {
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) return false
  return !CREDENTIAL_PATTERNS.some(pattern => pattern.test(prompt))
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

export interface CoordinationIssueRef {
  owner: string
  repo: string
  number: number
}

/**
 * Build the receipt-carrying dispatch prompt: the item's prompt text plus a
 * machine-contract block with the correlation id, the raw nonce, the
 * coordination issue as structured fields + canonical URL, literal `success`
 * and `noop` receipt examples, the mandatory-receipt rule, and a self-validate
 * step. The raw nonce is delivered ONLY here, never in the public marker;
 * callers must never log the return value verbatim.
 *
 * Residual leak: this becomes the target's `prompt` workflow_dispatch input.
 * A repo running the agent with `OPENCODE_PROMPT_ARTIFACT` enabled can publish
 * the rendered prompt (raw nonce included) as a downloadable Actions artifact.
 * Target workflows are autonomous and cannot be redacted from here, so where
 * that setting is present item-level nonce isolation falls back to trusting
 * the dispatched worker (already the loop's trust boundary). A real fix lives
 * in the agent or per-target workflow, not here.
 */
export function buildDispatchPrompt(input: {
  itemPrompt: string
  correlationId: string
  rawNonce: string
  coordinationIssue: CoordinationIssueRef
}): string {
  const {itemPrompt, correlationId, rawNonce, coordinationIssue} = input
  const issueUrl = `https://github.com/${coordinationIssue.owner}/${coordinationIssue.repo}/issues/${coordinationIssue.number}`

  const successExample = buildResultMarker({
    correlationId,
    nonce: rawNonce,
    status: 'success',
    summary: 'Concise summary of what changed.',
    pr: 'https://github.com/OWNER/REPO/pull/123',
  })
  const noopExample = buildResultMarker({
    correlationId,
    nonce: rawNonce,
    status: 'noop',
    summary: 'No change was needed; explain why.',
  })

  return [
    itemPrompt,
    '',
    '--- fro-bot cross-repo receipt contract (machine-readable, do not omit) ---',
    `correlation_id: ${correlationId}`,
    `nonce: ${rawNonce}`,
    'Coordination issue (post your receipt here, and ONLY here):',
    `  owner: ${coordinationIssue.owner}`,
    `  repo: ${coordinationIssue.repo}`,
    `  number: ${coordinationIssue.number}`,
    `  url: ${issueUrl}`,
    '',
    'RULE: You MUST post a completion receipt comment to the coordination issue above',
    'when you finish this work — even if the outcome is a no-op (nothing needed changing).',
    'A missing receipt is treated as a failure to report, not success.',
    '',
    'Example receipt for a successful change:',
    successExample,
    '',
    'Example receipt for a no-op (nothing needed changing):',
    noopExample,
    '',
    'Self-validate before finishing: echo the resolved destination',
    `(owner=${coordinationIssue.owner}, repo=${coordinationIssue.repo}, number=${coordinationIssue.number}),`,
    'post the receipt comment, then re-read your posted comment. If the',
    'fro-bot:cross-repo-result marker is absent from what you posted, edit the',
    'comment to add it before declaring the work done.',
  ].join('\n')
}

/**
 * Compare-and-swap a marker comment write. Re-reads the latest bot marker
 * immediately before writing; aborts+retries on hash mismatch against the
 * caller's expected prior hash. Bounded retries; persistent mismatch defers
 * (returns `ok:false`) rather than clobbering (single-writer discipline).
 */
export interface CasWriteInput {
  octokit: CrossRepoDispatchOctokitClient
  owner: string
  repo: string
  issueNumber: number
  expectedPriorHash: string | undefined
  nextState: GoalState
}

export interface CasWriteResult {
  ok: boolean
  reason?: 'mismatch'
}

/**
 * Read the latest bot-authored marker comment, including its comment id, so
 * callers can update that same comment in place rather than appending a new
 * one on every state transition (single-comment marker discipline).
 */
async function readLatestMarkerComment(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
  issueNumber: number,
): Promise<{marker: MarkerData; commentId: number} | null> {
  const response = await octokit.rest.issues.listComments({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
  })
  const commentId = response.data.findLast(
    comment => FROBOT_COMMENT_AUTHORS.has(comment.user?.login ?? '') && extractMarker(comment.body ?? '') !== null,
  )?.id
  if (commentId === undefined) return null

  const comments: TrackerComment[] = response.data.map(comment => ({
    author: {login: comment.user?.login ?? ''},
    body: comment.body ?? '',
  }))
  const marker = selectStateMarker(comments)
  if (marker === null) return null
  return {marker, commentId}
}

async function readLatestMarker(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
  issueNumber: number,
): Promise<MarkerData | null> {
  const found = await readLatestMarkerComment(octokit, repo, issueNumber)
  return found?.marker ?? null
}

async function casWriteMarker(input: CasWriteInput): Promise<CasWriteResult> {
  for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
    const found = await readLatestMarkerComment(
      input.octokit,
      {owner: input.owner, repo: input.repo},
      input.issueNumber,
    )
    const currentHash = found?.marker.hash

    if (currentHash !== input.expectedPriorHash) {
      // Someone else wrote since we last read. Retry against the latest state
      // only if our nextState was derived from a state that's still coherent;
      // callers that cannot re-derive a plan safely should treat this as defer.
      continue
    }

    const body = buildMarkerComment(input.nextState)
    if (found === null) {
      // Cold start: no bot marker comment exists yet.
      await input.octokit.rest.issues.createComment({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        body,
      })
    } else {
      // Update the existing marker comment in place — never append a new one.
      await input.octokit.rest.issues.updateComment({
        owner: input.owner,
        repo: input.repo,
        comment_id: found.commentId,
        body,
      })
    }
    return {ok: true}
  }
  return {ok: false, reason: 'mismatch'}
}

// ─── Dispatch shell ───────────────────────────────────────────────────────────

export interface LabeledEventPayload {
  label: {name: string}
  sender: {login: string}
  issue: {number: number}
}

export interface RepoRepository {
  owner: string
  repo: string
}

export interface RunDispatchInput {
  octokit: CrossRepoDispatchOctokitClient
  event: LabeledEventPayload
  repo: RepoRepository
  approveLabel: string
  loadRegistry: () => Promise<GateEntry[]>
  loadOtherOpenGoalMarkers: () => Promise<GoalState[]>
  findRunByCorrelationId: (target: DispatchTarget, correlationId: string) => Promise<boolean>
  createWorkflowDispatch: (params: {
    owner: string
    repo: string
    workflow_id: string
    ref: string
    inputs: {prompt: string}
  }) => Promise<void>
  nonceSource: () => string
  resultPath?: string
  /**
   * Owner-aware credential check. fro-bot and marcusrbrown are separate App
   * installations, so a target's owner needs its OWN minted token — one
   * token can't span both. When omitted, every owner is assumed reachable
   * (single-client legacy wiring). Returning false fails an eligible target
   * closed (counted `blocked`) instead of dispatching with the wrong owner's
   * token and eating a 403.
   */
  hasTargetToken?: (owner: string) => boolean
}

export interface RunDispatchCounts {
  refused: number
  dispatched: number
  deferred: number
  blocked: number
  reconciled: number
  skippedUnsafePrompt: number
  casDeferred: number
  seedRejected: number
  dispatchError: number
}

export interface RunDispatchResult {
  counts: RunDispatchCounts
}

function emptyDispatchCounts(): RunDispatchCounts {
  return {
    refused: 0,
    dispatched: 0,
    deferred: 0,
    blocked: 0,
    reconciled: 0,
    skippedUnsafePrompt: 0,
    casDeferred: 0,
    seedRejected: 0,
    dispatchError: 0,
  }
}

/**
 * Dispatch shell: executes an approved goal on the `issues.labeled` event.
 * Script-side actor gate, fingerprint CAS approval record, two-phase
 * (intent → confirm) sequential per-item dispatch with correlation-id
 * reconciliation on resume.
 */
export async function runDispatch(input: RunDispatchInput): Promise<RunDispatchResult> {
  const counts = emptyDispatchCounts()

  // 1. Script-side actor gate, independent of the workflow gate.
  if (input.event.sender.login !== REQUIRED_APPROVER || input.event.label.name !== input.approveLabel) {
    try {
      await input.octokit.rest.issues.removeLabel({
        owner: input.repo.owner,
        repo: input.repo.repo,
        issue_number: input.event.issue.number,
        name: input.event.label.name,
      })
    } catch {
      // Label removal is best-effort; the refusal is still counted.
    }
    counts.refused = 1
    await writeResult(input.resultPath, {counts})
    return {counts}
  }

  const issueNumber = input.event.issue.number

  // 2. Read the issue's bot marker.
  const commentsResponse = await input.octokit.rest.issues.listComments({
    owner: input.repo.owner,
    repo: input.repo.repo,
    issue_number: issueNumber,
  })
  const comments: TrackerComment[] = commentsResponse.data.map(comment => ({
    author: {login: comment.user?.login ?? ''},
    body: comment.body ?? '',
  }))
  let marker = selectStateMarker(comments)
  if (marker === null) {
    // Cold start: no state marker exists yet. Seed one from the latest
    // bot-authored decomposition checklist so approving a goal actually
    // dispatches it instead of silently bailing.
    let decomposition: DecompositionResult | undefined
    for (let i = comments.length - 1; i >= 0; i -= 1) {
      const comment = comments[i]
      if (comment === undefined || !FROBOT_COMMENT_AUTHORS.has(comment.author.login)) continue
      const parsed = parseDecomposition(comment.body)
      if (parsed.ok && parsed.items.length > 0) {
        decomposition = parsed
        break
      }
      // The latest bot comment that looks like a checklist but failed to
      // parse as one (over the item cap, or a task-list-shaped line that
      // fails the strict grammar) is a distinct outcome from "no checklist
      // found at all" — surface it instead of silently falling through to
      // older comments or bailing indistinguishably.
      const looksLikeChecklist = comment.body.split('\n').some(line => LOOSE_TASK_LIST_PREFIX.test(line.trim()))
      if (looksLikeChecklist && (parsed.reason === 'too-many-items' || parsed.reason === 'malformed')) {
        counts.seedRejected = 1
        await writeResult(input.resultPath, {counts})
        return {counts}
      }
    }
    if (decomposition === undefined) {
      await writeResult(input.resultPath, {counts})
      return {counts}
    }
    const seedState: GoalState = {
      goal: `issue-${issueNumber}`,
      items: decomposition.items,
      markerHash: '',
    }
    const serializedSeed = serializeMarker(seedState)
    const seededState: GoalState = {...seedState, markerHash: serializedSeed.hash}
    const seedCas = await casWriteMarker({
      octokit: input.octokit,
      owner: input.repo.owner,
      repo: input.repo.repo,
      issueNumber,
      expectedPriorHash: undefined,
      nextState: seededState,
    })
    if (!seedCas.ok) {
      counts.casDeferred = 1
      await writeResult(input.resultPath, {counts})
      return {counts}
    }
    marker = serializedSeed
  }

  const prompts = extractItemPrompts(comments.map(comment => comment.body).join('\n'))

  const registry = await input.loadRegistry()
  const registryByKey = new Map<string, GateEntry>()
  for (const entry of registry) {
    registryByKey.set(`${entry.owner}/${entry.name}`, entry)
  }

  // Apply the registry gate up front — items whose target is ineligible move
  // to 'blocked' before dispatch planning, distinct from a not-onboarded gate.
  let state: GoalState = {...marker.state, markerHash: marker.hash}
  const gatedItems = state.items.map(item => {
    if (item.status !== 'pending') return item
    const gate = gateTarget(registryByKey.get(`${item.target.owner}/${item.target.name}`))
    if (gate !== 'ok') return {...item, status: 'blocked' as ItemStatus}
    // An eligible target owner missing a minted dispatch token is an ops
    // misconfiguration (App-installation mint didn't cover this owner) —
    // fail this item closed rather than dispatch with the wrong token.
    if (input.hasTargetToken !== undefined && !input.hasTargetToken(item.target.owner)) {
      return {...item, status: 'blocked' as ItemStatus}
    }
    return item
  })
  state = {...state, items: gatedItems}

  // 3. Compute current approval fingerprint; store as approval record via CAS.
  const fingerprint = computeApprovalFingerprint(state.items)
  const priorHash = marker.hash
  if (state.approvalFingerprint !== fingerprint) {
    const withApproval: GoalState = {...state, approvalFingerprint: fingerprint}
    const serialized = serializeMarker(withApproval)
    const approvalState: GoalState = {...withApproval, markerHash: serialized.hash}
    const cas = await casWriteMarker({
      octokit: input.octokit,
      owner: input.repo.owner,
      repo: input.repo.repo,
      issueNumber,
      expectedPriorHash: priorHash,
      nextState: approvalState,
    })
    if (!cas.ok) {
      counts.casDeferred = 1
      await writeResult(input.resultPath, {counts})
      return {counts}
    }
    state = approvalState
  }

  // Resume reconciliation pass: any pre-existing 'intent' item (from a prior
  // crashed run) is reconciled by correlation-id lookup BEFORE any dispatch
  // planning runs — `planDispatch` treats intent as in-flight and
  // would never surface it as dispatchable, so this pass runs first.
  for (const item of state.items) {
    if (item.status !== 'intent' || item.correlationId === undefined) continue
    const found = await input.findRunByCorrelationId(item.target, item.correlationId)
    if (!found) continue

    const latestMarkerForReconcile = await readLatestMarker(input.octokit, input.repo, issueNumber)
    if (latestMarkerForReconcile === null) continue
    const flipped = flipItemStatus(latestMarkerForReconcile, item.id, 'dispatched', item.epoch ?? Date.now())
    const cas = await casWriteMarker({
      octokit: input.octokit,
      owner: input.repo.owner,
      repo: input.repo.repo,
      issueNumber,
      expectedPriorHash: latestMarkerForReconcile.hash,
      nextState: flipped,
    })
    if (cas.ok) {
      counts.reconciled += 1
      state = flipped
    } else {
      counts.casDeferred += 1
    }
  }

  const otherOpenGoalMarkers = await input.loadOtherOpenGoalMarkers()
  const plan = planDispatch({state, fingerprint, otherOpenGoalMarkers})
  counts.deferred = plan.deferredCount
  counts.blocked = plan.blockedCount

  // 5/6. Sequential per-item dispatch with re-read+re-compare before each item.
  for (const item of plan.toDispatch) {
    // Re-read + re-compare fingerprint before each item — halt on mismatch.
    const latestMarker = await readLatestMarker(input.octokit, input.repo, issueNumber)
    if (latestMarker === null || latestMarker.state.approvalFingerprint !== fingerprint) {
      break
    }

    const currentItem = latestMarker.state.items.find(candidate => candidate.id === item.id)
    if (currentItem === undefined) continue
    if (currentItem.status !== 'pending') continue

    const prompt = prompts.get(currentItem.promptHash)
    if (prompt === undefined || !isPromptSafe(prompt)) {
      counts.skippedUnsafePrompt += 1
      continue
    }

    // Mint the RAW nonce fresh, in-memory only, via a CSPRNG (input.nonceSource
    // is the injectable CSPRNG collaborator — see runDispatchCli's default,
    // which uses node:crypto randomBytes, never Date.now()/Math.random()).
    // Only its full SHA-256 hash is ever persisted to the (public) marker;
    // the raw value is never stored in `currentItem` — a re-dispatch of a
    // still-pending item always mints a fresh nonce.
    const rawNonce = input.nonceSource()
    const nonceHash = hashNonce(rawNonce)
    const correlationId = currentItem.correlationId ?? computeCorrelationId(state.goal, currentItem.id, rawNonce)

    // Write 'intent' before dispatching (two-phase persistence). Only the
    // hash is persisted here; `epoch` is set only on confirmed dispatch below.
    const intentState = flipItemStatus(latestMarker, currentItem.id, 'intent', undefined, {
      correlationId,
      nonceHash,
    })
    const intentCas = await casWriteMarker({
      octokit: input.octokit,
      owner: input.repo.owner,
      repo: input.repo.repo,
      issueNumber,
      expectedPriorHash: latestMarker.hash,
      nextState: intentState,
    })
    if (!intentCas.ok) {
      counts.casDeferred += 1
      continue
    }

    const dispatchPrompt = buildDispatchPrompt({
      itemPrompt: prompt,
      correlationId,
      rawNonce,
      coordinationIssue: {owner: input.repo.owner, repo: input.repo.repo, number: issueNumber},
    })

    try {
      await input.createWorkflowDispatch({
        owner: currentItem.target.owner,
        repo: currentItem.target.name,
        workflow_id: TARGET_WORKFLOW_ID,
        ref: TARGET_WORKFLOW_REF,
        // Prompt-only input: target repos' fro-bot.yaml universally declares
        // only `prompt` via workflow_dispatch. A `correlation_id` input 422s
        // ("Unexpected inputs provided") against that schema — the correlation
        // id and nonce ride inside dispatchPrompt instead (see buildDispatchPrompt).
        inputs: {prompt: dispatchPrompt},
      })
    } catch {
      // Transient dispatch failure (403/network) on this target must not
      // abort the whole cohort. The item is already persisted as 'intent'
      // (crash-safe); a future labeled event resumes and reconciles it by
      // correlation-id. Counts-only outcome — no error detail is logged,
      // since it could leak transport/token context.
      counts.dispatchError += 1
      continue
    }

    // Flip to 'dispatched' + epoch via CAS.
    const dispatchedState = flipItemStatus(
      {hash: intentState.markerHash, state: intentState},
      currentItem.id,
      'dispatched',
      Date.now(),
    )
    const confirmCas = await casWriteMarker({
      octokit: input.octokit,
      owner: input.repo.owner,
      repo: input.repo.repo,
      issueNumber,
      expectedPriorHash: intentState.markerHash,
      nextState: dispatchedState,
    })
    if (confirmCas.ok) {
      counts.dispatched += 1
    } else {
      // Crash-after-confirm-write-failure: item stays 'intent'; a future
      // resume reconciles it by correlation-id.
      counts.casDeferred += 1
    }
  }

  await writeResult(input.resultPath, {counts})
  return {counts}
}

function flipItemStatus(
  marker: MarkerData,
  itemId: string,
  status: ItemStatus,
  epoch: number | undefined,
  extra: {correlationId?: string; nonceHash?: string} = {},
): GoalState {
  const items = marker.state.items.map(item => {
    if (item.id !== itemId) return item
    return {
      ...item,
      status,
      ...(epoch === undefined ? {} : {epoch}),
      ...(extra.correlationId === undefined ? {} : {correlationId: extra.correlationId}),
      ...(extra.nonceHash === undefined ? {} : {nonceHash: extra.nonceHash}),
    }
  })
  const nextState: GoalState = {...marker.state, items, markerHash: ''}
  const serialized = serializeMarker(nextState)
  return {...nextState, markerHash: serialized.hash}
}

// ─── Tracking shell ─────────────────────────────────────────────────────────

export interface OpenGoalIssue {
  issueNumber: number
  marker: MarkerData
}

export interface RunTrackInput {
  octokit: CrossRepoDispatchOctokitClient
  repo: RepoRepository
  loadOpenGoalIssues: () => Promise<OpenGoalIssue[]>
  loadRegistry: () => Promise<GateEntry[]>
  /**
   * Demoted to a NON-AUTHORITATIVE diagnostic (Unit 5, R8/R9/R12): consulted
   * ONLY to annotate an already-`needs-attention`/`no-receipt` item with
   * "ran but didn't report" vs "never ran". Its return value never changes
   * any item's terminal/non-terminal state — receipts are the sole
   * completion oracle (R7) and the SLA is the sole `needs-attention` driver
   * (R9).
   */
  findRunConclusion: (target: DispatchTarget, correlationId: string) => Promise<'success' | 'failure' | undefined>
  resultPath?: string
  /** Same owner-aware credential check as `RunDispatchInput.hasTargetToken`. */
  hasTargetToken?: (owner: string) => boolean
  /** Injectable clock for the SLA check (R9) — defaults to `Date.now`. Tests inject a fixed value. */
  now?: () => number
  /** Overrides the default `RECEIPT_SLA_MS` tunable — test-only escape hatch. */
  slaMs?: number
}

export interface RunTrackCounts {
  goalsProcessed: number
  itemsCompleted: number
  itemsFailed: number
  itemsBlocked: number
  itemsNeedsAttention: number
  itemsStillOpen: number
  goalsClosed: number
  idempotentNoop: number
  casDeferred: number
}

export interface RunTrackResult {
  counts: RunTrackCounts
}

function emptyTrackCounts(): RunTrackCounts {
  return {
    goalsProcessed: 0,
    itemsCompleted: 0,
    itemsFailed: 0,
    itemsBlocked: 0,
    itemsNeedsAttention: 0,
    itemsStillOpen: 0,
    goalsClosed: 0,
    idempotentNoop: 0,
    casDeferred: 0,
  }
}

/**
 * Tracking shell: resolves each dispatched (or `needs-attention`) item's
 * terminal state SOLELY from AUTHENTIC completion receipts (R6/R7) plus the
 * 24h SLA (R9) and the registry gate — the receipt is the sole completion
 * oracle (R8: no PR polling, no run polling for completion). Run-lookup is
 * demoted to a NON-AUTHORITATIVE diagnostic (Unit 5): for an item that ends
 * up `needs-attention`/`no-receipt`, it annotates whether the worker's run
 * concluded ("ran but didn't report") or never ran ("never ran") — this
 * NEVER changes terminal/non-terminal state, only the diagnostic detail
 * surfaced to the operator. Closes the coordination issue when every item is
 * terminal (`completed`/`failed`/`blocked`) — `needs-attention` and
 * `pending`/`dispatched` keep it open (R11). Reopen is handled by the
 * workflow's `issues.reopened` step, not here.
 */
export async function runTrack(input: RunTrackInput): Promise<RunTrackResult> {
  const counts = emptyTrackCounts()

  const registry = await input.loadRegistry()
  const registryByKey = new Map<string, GateEntry>()
  for (const entry of registry) {
    registryByKey.set(`${entry.owner}/${entry.name}`, entry)
  }

  const openGoals = await input.loadOpenGoalIssues()
  const now = input.now?.() ?? Date.now()
  const slaMs = input.slaMs ?? RECEIPT_SLA_MS

  for (const goalIssue of openGoals) {
    counts.goalsProcessed += 1
    const state: GoalState = {...goalIssue.marker.state, markerHash: goalIssue.marker.hash}

    const commentsResponse = await input.octokit.rest.issues.listComments({
      owner: input.repo.owner,
      repo: input.repo.repo,
      issue_number: goalIssue.issueNumber,
    })
    const comments: TrackerComment[] = commentsResponse.data.map(comment => ({
      author: {login: comment.user?.login ?? ''},
      body: comment.body ?? '',
    }))

    // Receipts are the sole completion oracle (R7): resolve every eligible
    // item (dispatched or already needs-attention — reversible per R9a) from
    // its earliest authentic receipt (R6c) before falling back to the
    // legacy run-lookup/PR-search signal path below for anything a receipt
    // did not resolve.
    const receiptResolutions = resolveReceipts(state.items, comments)

    const preItems = state.items.map(item => {
      if (TERMINAL_STATUSES.has(item.status)) return item

      const resolution = receiptResolutions.get(item.id)
      if (resolution?.terminal !== undefined) {
        const nextStatus: ItemStatus = resolution.terminal === 'failed' ? 'failed' : 'completed'
        return {...item, status: nextStatus, needsAttentionReason: undefined}
      }
      if (resolution?.attentionReason !== undefined) {
        return {...item, status: 'needs-attention' as ItemStatus, needsAttentionReason: resolution.attentionReason}
      }
      return item
    })

    // Registry-gate signal only: the run/PR terminal-resolution precedence
    // table is gone (R8) — a gate-block is the only remaining out-of-band
    // driver `planSnapshot` still applies to a non-terminal item.
    const signals: SnapshotSignals = {}
    for (const item of preItems) {
      if (item.status !== 'dispatched') continue

      const gate = gateTarget(registryByKey.get(`${item.target.owner}/${item.target.name}`))
      if (gate !== 'ok') {
        signals[item.id] = {gateBlocked: true}
        continue
      }
      // Invariant: this token-gap branch is only safe because the workflow's per-owner
      // mint steps are NOT continue-on-error — a failed mint fails the whole job, so by
      // the time this script runs the token map is always fully populated for every
      // eligible owner. If continue-on-error is ever re-added to the mints (or an owner
      // is dropped from the mint set while remaining in ELIGIBLE_OWNERS), an
      // already-dispatched item could be silently re-marked blocked on the next track
      // pass, overwriting a real completed/failed conclusion. Do not soften the mints
      // without addressing this.
      if (input.hasTargetToken !== undefined && !input.hasTargetToken(item.target.owner)) {
        signals[item.id] = {gateBlocked: true}
      }
    }

    // Apply the SLA needs-attention flag directly (R9). No authentic receipt
    // and past the confirm-time SLA -> needs-attention/no-receipt. An item
    // never confirmed (`epoch` unset) is never SLA-aged (a pre-confirm crash
    // is a dispatch failure, not an SLA miss).
    const preItemsWithSla = preItems.map(item => {
      if (item.status !== 'dispatched') return item
      if (item.epoch !== undefined && now - item.epoch > slaMs) {
        return {...item, status: 'needs-attention' as ItemStatus, needsAttentionReason: 'no-receipt' as const}
      }
      return item
    })

    // Diagnostic-only annotation (Unit 5, R8/R9/R12): run-lookup is consulted
    // ONLY for an item that just became `needs-attention`/`no-receipt`, and
    // ONLY to distinguish "ran but didn't report" from "never ran" for the
    // operator. This NEVER changes terminal/non-terminal state — the item
    // stays `needs-attention` either way.
    const preItemsWithDiagnostic = await Promise.all(
      preItemsWithSla.map(async item => {
        if (item.status !== 'needs-attention' || item.needsAttentionReason !== 'no-receipt') return item
        if (item.correlationId === undefined) return item

        const runConclusion = await input.findRunConclusion(item.target, item.correlationId)
        const noReceiptDiagnostic: NonNullable<DispatchItem['noReceiptDiagnostic']> =
          runConclusion === undefined ? 'never-ran' : 'ran-no-report'
        return {...item, noReceiptDiagnostic}
      }),
    )

    const snapshot = planSnapshot({state: {...state, items: preItemsWithDiagnostic}, signals})

    for (const item of snapshot.state.items) {
      const previous = state.items.find(candidate => candidate.id === item.id)
      if (previous === undefined || previous.status === item.status) continue
      if (item.status === 'completed') counts.itemsCompleted += 1
      else if (item.status === 'failed') counts.itemsFailed += 1
      else if (item.status === 'blocked') counts.itemsBlocked += 1
      else if (item.status === 'needs-attention') counts.itemsNeedsAttention += 1
    }
    counts.itemsStillOpen += snapshot.state.items.filter(
      item => item.status === 'dispatched' || item.status === 'needs-attention',
    ).length

    if (!snapshot.shouldWrite) {
      counts.idempotentNoop += 1
      continue
    }

    const cas = await casWriteMarker({
      octokit: input.octokit,
      owner: input.repo.owner,
      repo: input.repo.repo,
      issueNumber: goalIssue.issueNumber,
      expectedPriorHash: goalIssue.marker.hash,
      nextState: snapshot.state,
    })
    if (!cas.ok) {
      counts.casDeferred += 1
      continue
    }

    if (snapshot.allTerminal) {
      const completed = snapshot.state.items.filter(item => item.status === 'completed').length
      const failed = snapshot.state.items.filter(item => item.status === 'failed').length
      const blocked = snapshot.state.items.filter(item => item.status === 'blocked').length
      await input.octokit.rest.issues.createComment({
        owner: input.repo.owner,
        repo: input.repo.repo,
        issue_number: goalIssue.issueNumber,
        body: `Goal complete. completed=${completed} failed=${failed} blocked=${blocked}`,
      })
      await input.octokit.rest.issues.update({
        owner: input.repo.owner,
        repo: input.repo.repo,
        issue_number: goalIssue.issueNumber,
        state: 'closed',
      })
      counts.goalsClosed += 1
    }
  }

  await writeResult(input.resultPath, {counts})
  return {counts}
}

// ─── Production collaborators ─────────────────────────────────────────────────

/** Label marking a coordination issue as a cross-repo goal tracker. */
export const CROSS_REPO_GOAL_LABEL = 'cross-repo-goal'

/** Bounded page size for recent-run lookups — correlation ids are recent by construction. */
const RUN_LOOKUP_PAGE_SIZE = 30

/**
 * Find the `fro-bot.yaml` run in `target` whose run-name/display_title
 * contains `correlationId`. Matches the echo format in
 * `.github/workflows/fro-bot.yaml`'s `run-name:` (` (correlationId)` suffix
 * on manual dispatch runs). Bounded to the most recent runs — a correlation
 * id is looked up shortly after the dispatch that minted it.
 */
export async function findWorkflowRunByCorrelationId(
  octokit: CrossRepoDispatchOctokitClient,
  target: DispatchTarget,
  correlationId: string,
): Promise<{id: number; status: string | null; conclusion: string | null} | null> {
  const response = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner: target.owner,
    repo: target.name,
    workflow_id: TARGET_WORKFLOW_ID,
    per_page: RUN_LOOKUP_PAGE_SIZE,
  })
  const match = response.data.workflow_runs.find(run => (run.display_title ?? run.name ?? '').includes(correlationId))
  if (match === undefined) return null
  return {id: match.id, status: match.status, conclusion: match.conclusion}
}

/** Factory: `findRunByCorrelationId` collaborator — run existence, any status. */
export function findRunByCorrelationId(
  octokit: CrossRepoDispatchOctokitClient,
): (target: DispatchTarget, correlationId: string) => Promise<boolean> {
  return async (target, correlationId) => {
    const run = await findWorkflowRunByCorrelationId(octokit, target, correlationId)
    return run !== null
  }
}

/** Factory: `findRunConclusion` collaborator — conclusion only once the run has completed. */
export function findRunConclusion(
  octokit: CrossRepoDispatchOctokitClient,
): (target: DispatchTarget, correlationId: string) => Promise<'success' | 'failure' | undefined> {
  return async (target, correlationId) => {
    const run = await findWorkflowRunByCorrelationId(octokit, target, correlationId)
    if (run === null || run.status !== 'completed') return undefined
    return run.conclusion === 'success' ? 'success' : 'failure'
  }
}

/**
 * Enumerate this repo's OPEN `cross-repo-goal`-labeled issues and resolve
 * each one's latest bot-authored state marker. Issues without a readable
 * marker are skipped (nothing to track yet).
 */
export async function loadOpenGoalIssues(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
): Promise<OpenGoalIssue[]> {
  const issuesResponse = await octokit.rest.issues.listForRepo({
    owner: repo.owner,
    repo: repo.repo,
    labels: CROSS_REPO_GOAL_LABEL,
    state: 'open',
    per_page: 100,
  })

  const results: OpenGoalIssue[] = []
  for (const issue of issuesResponse.data) {
    const marker = await readLatestMarker(octokit, repo, issue.number)
    if (marker === null) continue
    results.push({issueNumber: issue.number, marker})
  }
  return results
}

/**
 * Enumerate OTHER open `cross-repo-goal` issues' marker states (excluding
 * `currentIssueNumber`) for same-target in-flight serialization in
 * `planDispatch`.
 */
export async function loadOtherOpenGoalMarkers(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
  currentIssueNumber: number,
): Promise<GoalState[]> {
  const issuesResponse = await octokit.rest.issues.listForRepo({
    owner: repo.owner,
    repo: repo.repo,
    labels: CROSS_REPO_GOAL_LABEL,
    state: 'open',
    per_page: 100,
  })

  const results: GoalState[] = []
  for (const issue of issuesResponse.data) {
    if (issue.number === currentIssueNumber) continue
    const marker = await readLatestMarker(octokit, repo, issue.number)
    if (marker === null) continue
    results.push({...marker.state, markerHash: marker.hash})
  }
  return results
}

// ─── CLI shell ────────────────────────────────────────────────────────────────

async function writeResult(resultPath: string | undefined, result: unknown): Promise<void> {
  const json = `${JSON.stringify(result)}\n`
  process.stdout.write(json)
  if (resultPath === undefined || resultPath === '') return
  const {writeFile} = await import('node:fs/promises')
  try {
    await writeFile(resultPath, json, {flag: 'w'})
  } catch {
    process.stderr.write('cross-repo-dispatch: could not write result: error-class=write-failure\n')
  }
}

type CrossRepoOctokitConstructor = new (params: {
  auth: string
  request: {timeout: number}
}) => CrossRepoDispatchOctokitClient

async function loadOctokitConstructor(): Promise<CrossRepoOctokitConstructor> {
  const {Octokit} = await import('@octokit/rest')
  return Octokit as unknown as CrossRepoOctokitConstructor
}

async function createOctokitForToken(token: string): Promise<CrossRepoDispatchOctokitClient> {
  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token, request: {timeout: 15_000}})
}

async function createOctokitFromEnv(): Promise<CrossRepoDispatchOctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    throw new Error('cross-repo-dispatch: GITHUB_TOKEN is required in the environment')
  }
  return createOctokitForToken(token)
}

/** Env var carrying the owner→token JSON map minted per-owner in the workflow. */
const TARGET_TOKENS_ENV_VAR = 'CROSS_REPO_DISPATCH_TARGET_TOKENS'

/**
 * Parse the owner→token JSON map. The App private key never enters this
 * script — only already-minted per-owner tokens, one per eligible owner
 * (fro-bot and marcusrbrown are separate App installations; one token can't
 * span both). Malformed/absent input yields an empty map (fail-closed: every
 * target owner is then treated as missing a token).
 */
export function parseTargetTokens(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [owner, token] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof token === 'string' && token !== '') result[owner] = token
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Per-owner target-repo client resolver. fro-bot and marcusrbrown are
 * separate App installations — a token minted for one owner 403s against
 * the other's repos, so every target-repo operation (dispatch,
 * run-lookup, PR search) must go through the client for THAT target's
 * owner, never the control-plane client.
 */
export interface TargetClientResolver {
  targetClientFor: (owner: string) => CrossRepoDispatchOctokitClient
  hasTargetToken: (owner: string) => boolean
}

/** Build a resolver from an owner→client map. Missing owner throws (fail-closed misconfiguration). */
export function createTargetClientResolver(
  clientsByOwner: ReadonlyMap<string, CrossRepoDispatchOctokitClient>,
): TargetClientResolver {
  return {
    targetClientFor: owner => {
      const client = clientsByOwner.get(owner)
      if (client === undefined) {
        throw new Error(`cross-repo-dispatch: no dispatch token minted for owner "${owner}"`)
      }
      return client
    },
    hasTargetToken: owner => clientsByOwner.has(owner),
  }
}

/** Build the owner→client map from the parsed token map, reusing one client per distinct token. */
async function buildTargetClients(
  tokens: Record<string, string>,
): Promise<Map<string, CrossRepoDispatchOctokitClient>> {
  const clientsByToken = new Map<string, CrossRepoDispatchOctokitClient>()
  const clientsByOwner = new Map<string, CrossRepoDispatchOctokitClient>()
  for (const [owner, token] of Object.entries(tokens)) {
    let client = clientsByToken.get(token)
    if (client === undefined) {
      client = await createOctokitForToken(token)
      clientsByToken.set(token, client)
    }
    clientsByOwner.set(owner, client)
  }
  return clientsByOwner
}

async function loadRegistryFromDisk(): Promise<GateEntry[]> {
  const {readFile} = await import('node:fs/promises')
  const {parse} = await import('yaml')
  try {
    const raw: unknown = parse(await readFile('metadata/repos.yaml', 'utf8'))
    assertReposFile(raw, 'repos')
    return raw.repos.map(entry => ({
      owner: entry.owner,
      name: entry.name,
      has_fro_bot_workflow: entry.has_fro_bot_workflow,
      private: entry.private,
    }))
  } catch {
    return []
  }
}

function parseRepository(raw: string | undefined): RepoRepository {
  const [owner, repo] = (raw ?? '').split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
    throw new Error('cross-repo-dispatch: GITHUB_REPOSITORY must be in owner/repo format')
  }
  return {owner, repo}
}

async function targetClientResolverFromEnv(): Promise<TargetClientResolver> {
  const tokens = parseTargetTokens(process.env[TARGET_TOKENS_ENV_VAR])
  const clientsByOwner = await buildTargetClients(tokens)
  return createTargetClientResolver(clientsByOwner)
}

export async function runDispatchCli(
  createOctokit: () => Promise<CrossRepoDispatchOctokitClient> = createOctokitFromEnv,
  createTargetClientResolverFn: () => Promise<TargetClientResolver> = targetClientResolverFromEnv,
): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  const approveLabel = process.env.CROSS_REPO_DISPATCH_APPROVE_LABEL ?? 'dispatch-approved'
  const resultPath = process.env.CROSS_REPO_DISPATCH_RESULT_PATH

  if (eventPath === undefined || eventPath === '') {
    process.stderr.write('cross-repo-dispatch: GITHUB_EVENT_PATH is required for dispatch mode\n')
    process.exitCode = 1
    return
  }

  const {readFile} = await import('node:fs/promises')
  const event = JSON.parse(await readFile(eventPath, 'utf8')) as LabeledEventPayload
  const repo = parseRepository(process.env.GITHUB_REPOSITORY)
  const octokit = await createOctokit()
  const {targetClientFor, hasTargetToken} = await createTargetClientResolverFn()

  await runDispatch({
    octokit,
    event,
    repo,
    approveLabel,
    loadRegistry: loadRegistryFromDisk,
    loadOtherOpenGoalMarkers: async () => loadOtherOpenGoalMarkers(octokit, repo, event.issue.number),
    findRunByCorrelationId: async (target, correlationId) =>
      findRunByCorrelationId(targetClientFor(target.owner))(target, correlationId),
    createWorkflowDispatch: async params => {
      await targetClientFor(params.owner).rest.actions.createWorkflowDispatch(params)
    },
    nonceSource: mintNonce,
    resultPath,
    hasTargetToken,
  })
}

export async function runTrackCli(
  createOctokit: () => Promise<CrossRepoDispatchOctokitClient> = createOctokitFromEnv,
  createTargetClientResolverFn: () => Promise<TargetClientResolver> = targetClientResolverFromEnv,
): Promise<void> {
  const resultPath = process.env.CROSS_REPO_DISPATCH_RESULT_PATH
  const repo = parseRepository(process.env.GITHUB_REPOSITORY)
  const octokit = await createOctokit()
  const {targetClientFor, hasTargetToken} = await createTargetClientResolverFn()

  await runTrack({
    octokit,
    repo,
    loadOpenGoalIssues: async () => loadOpenGoalIssues(octokit, repo),
    loadRegistry: loadRegistryFromDisk,
    findRunConclusion: async (target, correlationId) =>
      findRunConclusion(targetClientFor(target.owner))(target, correlationId),
    resultPath,
    hasTargetToken,
  })
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode === 'dispatch') {
    await runDispatchCli()
  } else if (mode === 'track') {
    await runTrackCli()
  } else {
    process.stderr.write('cross-repo-dispatch: expected argv[2] to be "dispatch" or "track"\n')
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
