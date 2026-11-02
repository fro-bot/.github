/**
 * The types, constants and type guards of a cross-repo coordination goal, which every other `dispatch-*` module builds on.
 * A leaf: it imports nothing from the package.
 */

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
   * Diagnostic-only annotation, set ONLY when `needsAttentionReason ===
   * 'no-receipt'`: what the coordinator can actually prove about a missing
   * receipt. `dispatch-accepted-no-receipt` is the conservative default —
   * dispatch was accepted but no accepted coordination receipt has arrived;
   * it never claims the worker never ran. `run-observed-no-receipt` upgrades
   * that default only when the (non-authoritative) Actions run-lookup finds
   * a completed correlated run with still no accepted receipt. NEVER
   * influences terminal/non-terminal state — receipts (R7), the SLA (R9),
   * and the registry gate are the only state drivers. Purely forensic
   * signal for the operator (R8: no PR polling for completion; run-lookup
   * is diagnostic, not authoritative, and a missing/failed lookup is never
   * read as proof the worker never ran).
   */
  noReceiptDiagnostic?: 'dispatch-accepted-no-receipt' | 'run-observed-no-receipt'
  /**
   * Snapshot of the target's operator-declared receipt contract capability at
   * the moment this item was dispatched — set from `classifyReceiptCapability`
   * just before the confirmed-dispatch marker write. NEVER re-derived from
   * current metadata after dispatch:
   * later `metadata/repos.yaml` drift must not retroactively change whether
   * an already-seeded item expected a receipt. Absent on legacy markers
   * (pre-Unit-2 or never confirmed) — those track under legacy/best-effort
   * semantics identically to an explicit `legacy-best-effort` value.
   */
  receiptContract?: ReceiptCapability
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
 * track's resolver).
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

/**
 * Operator-declared receipt contract classification for a target. Sourced only from the
 * data-branch `metadata/repos.yaml` field `cross_repo_receipts` (see `metadata/README.md`).
 * This is an administrative routing gate, not proof of runtime compliance — a target's own
 * workflow still owns whether it actually posts a coordination receipt.
 *
 * - `receipt-accountable` — the operator has declared this target supports the coordination
 *   receipt protocol (`cross_repo_receipts: 'coordination-issue-v1'`).
 * - `legacy-best-effort` — no capability declared (or no registry entry). Dispatchable under
 *   today's best-effort semantics; a missing receipt here must never be read as evidence the
 *   worker did not run or as `completed`.
 */
export type ReceiptCapability = 'receipt-accountable' | 'legacy-best-effort'

/** Minimal shape of a registry entry needed for the gate — mirrors `RepoEntry`. */
export interface GateEntry {
  owner: string
  name: string
  has_fro_bot_workflow: boolean
  private?: boolean
  /**
   * Optional operator-declared receipt contract capability. Only the data-branch
   * `metadata/repos.yaml` sole-writer path may set this — it is not a prompt-delivered or
   * target self-reported value. See `metadata/README.md` for the field's authority boundary.
   */
  cross_repo_receipts?: string
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
 * Registry-gate signal only: the run/PR terminal-resolution
 * precedence table is gone — receipts and the SLA are applied
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

export const TERMINAL_STATUSES: ReadonlySet<ItemStatus> = new Set(['completed', 'failed', 'blocked'])

export const IN_FLIGHT_STATUSES: ReadonlySet<ItemStatus> = new Set(['intent', 'dispatched'])

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
    record.noReceiptDiagnostic !== 'dispatch-accepted-no-receipt' &&
    record.noReceiptDiagnostic !== 'run-observed-no-receipt'
  ) {
    return false
  }
  if (
    record.receiptContract !== undefined &&
    record.receiptContract !== 'receipt-accountable' &&
    record.receiptContract !== 'legacy-best-effort'
  ) {
    return false
  }
  return true
}

export function isGoalStateBody(value: unknown): value is Omit<GoalState, 'markerHash'> {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.goal !== 'string') return false
  if (!Array.isArray(record.items) || !record.items.every(isDispatchItem)) return false
  if (record.approvalFingerprint !== undefined && typeof record.approvalFingerprint !== 'string') return false
  return true
}

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

/** Label marking a coordination issue as a cross-repo goal tracker. */
export const CROSS_REPO_GOAL_LABEL = 'cross-repo-goal'
