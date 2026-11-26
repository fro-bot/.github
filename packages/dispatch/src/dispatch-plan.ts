/** The pure planners (registry gate, dispatch plan, snapshot plan) and the prompt safety policy and builder. */

import {serializeMarker} from './dispatch-marker.ts'
import {
  ELIGIBLE_OWNERS,
  IN_FLIGHT_STATUSES,
  MAX_PROMPT_LENGTH,
  TERMINAL_STATUSES,
  type DispatchItem,
  type DispatchPlanInput,
  type DispatchPlanResult,
  type DispatchTarget,
  type GateEntry,
  type GateReason,
  type GateResult,
  type GoalState,
  type ReceiptCapability,
  type SnapshotPlanInput,
  type SnapshotPlanResult,
} from './dispatch-model.ts'
import {buildResultMarker} from './dispatch-receipts.ts'

/**
 * Owner-only, fail-closed registry gate.
 * - `blocked-not-onboarded` when the entry lacks the Fro Bot workflow.
 * - `blocked-ineligible` when the owner is not in the eligible set, the repo
 *   is not definitively public, or the entry is missing from the registry.
 * - `blocked-archived` when the entry's status is `archived`, whatever else is true of it. The caller looks a
 *   target up by name, and an archived row keeps its stored name through a rename on GitHub, so the new name
 *   finds no row and is `blocked-ineligible`.
 */
export function gateTarget(entry: GateEntry | undefined): GateResult {
  if (entry === undefined) return 'blocked-ineligible'
  if (entry.onboarding_status === 'archived') return 'blocked-archived'
  if (!ELIGIBLE_OWNERS.has(entry.owner)) return 'blocked-ineligible'
  if (entry.private !== false) return 'blocked-ineligible'
  if (!entry.has_fro_bot_workflow) return 'blocked-not-onboarded'
  return 'ok'
}

/** The brief a prompt names: `program-domains.json@<commit>#<domain>`, as a domain program's checklist line writes it. */
export interface BriefReference {
  commit: string
  domain: string
}

const BRIEF_UNREADABLE = 'the domain brief cannot be read'

/**
 * The domain brief an item's prompt names, if it names one. Any occurrence of `program-domains.json` makes a prompt a
 * domain item: a prompt that never names the file is `null` and is dispatched as ever. A domain item must name the
 * file exactly once, as `program-domains.json@<40 lowercase hex>#<domain key>`: the file name starts the prompt or
 * follows whitespace, the key is `[a-z0-9][a-z0-9-]*` (the domain file's key rule) and ends the prompt, or is
 * followed by whitespace or by a full stop and then whitespace or the end. A second mention of any form, a half-written
 * reference, or a key followed by anything else (`#safe/../../other`) is `'malformed'`, so no prompt can carry a
 * reference that this check reads and another reader reads differently. The scan is index arithmetic and anchored
 * patterns of fixed length: no quantifier is nested, so it is linear.
 */
export function parseBriefReference(prompt: string): BriefReference | 'malformed' | null {
  const file = 'program-domains.json'
  const mentions = prompt.split(file).length - 1
  if (mentions === 0) return null
  if (mentions > 1) return 'malformed'
  const at = prompt.indexOf(file)
  if (at > 0 && !/\s/.test(prompt.charAt(at - 1))) return 'malformed'
  const rest = prompt.slice(at + file.length)
  const commit = rest.slice(1, 41)
  if (!rest.startsWith('@') || !/^[\da-f]{40}$/.test(commit) || rest.charAt(41) !== '#') return 'malformed'
  const tail = rest.slice(42)
  let end = 0
  while (end < tail.length && (end === 0 ? /[a-z\d]/ : /[a-z\d-]/).test(tail.charAt(end))) end += 1
  if (end === 0) return 'malformed'
  const after = tail.slice(end)
  const ends = after === '' || /^\s/.test(after) || /^\.(?:\s|$)/.test(after)
  return ends ? {commit, domain: tail.slice(0, end)} : 'malformed'
}

/**
 * The program's node ID for each repository of one domain, read from the text of `program-domains.json` at the
 * pinned commit, keyed by the lower-cased `owner/name`. Dispatch reads no more of the file than this, and it keeps
 * its own small parser: `@fro-bot/status-truth` owns the file's full schema and imports this package, so it
 * cannot be imported back. Any shape problem, a missing domain, an empty domain, a repository with no node ID or a
 * repository listed twice fails with one fixed message that names nothing of the content.
 */
export function parseBriefDomain(text: string, domain: string): ReadonlyMap<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(BRIEF_UNREADABLE)
  }
  const domains: unknown = isObject(parsed) ? parsed.domains : undefined
  if (!Array.isArray(domains)) throw new Error(BRIEF_UNREADABLE)
  // The key must name exactly one domain: the first of two would be a choice the file never made.
  const matching: unknown[] = domains.filter(candidate => isObject(candidate) && candidate.key === domain)
  if (matching.length !== 1) throw new Error(BRIEF_UNREADABLE)
  const entry: unknown = matching[0]
  const repos: unknown = isObject(entry) ? entry.repos : undefined
  if (!Array.isArray(repos) || repos.length === 0) throw new Error(BRIEF_UNREADABLE)
  const ids = new Map<string, string>()
  for (const repo of repos) {
    const name: unknown = isObject(repo) ? repo.nameWithOwner : undefined
    const nodeId: unknown = isObject(repo) ? repo.nodeId : undefined
    if (typeof name !== 'string' || name === '' || typeof nodeId !== 'string' || nodeId === '') {
      throw new Error(BRIEF_UNREADABLE)
    }
    if (ids.has(name.toLowerCase())) throw new Error(BRIEF_UNREADABLE)
    ids.set(name.toLowerCase(), nodeId)
  }
  return ids
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Whether a domain item's target is the repository the program means. Dispatch does not take the preflight's word
 * for identity: the target name must resolve to exactly one registry row (ignoring case), that row's node ID must
 * equal the program's node ID for the name, and no other row may carry that node ID. A target the domain does not
 * list, a name with no row, or a row with another or no node ID is a mismatch; a name or node ID that resolves to
 * more than one row is ambiguous. `null` means the identity holds.
 */
export function checkBriefIdentity(input: {
  registry: readonly GateEntry[]
  target: DispatchTarget
  programIds: ReadonlyMap<string, string>
}): GateReason | null {
  const name = `${input.target.owner}/${input.target.name}`.toLowerCase()
  const programId = input.programIds.get(name)
  if (programId === undefined) return 'brief-identity-mismatch'
  const byName = input.registry.filter(entry => `${entry.owner}/${entry.name}`.toLowerCase() === name)
  if (byName.length > 1) return 'brief-identity-ambiguous'
  if (byName[0]?.node_id !== programId) return 'brief-identity-mismatch'
  if (input.registry.filter(entry => entry.node_id === programId).length > 1) return 'brief-identity-ambiguous'
  return null
}

/** The only value the coordinator recognizes for an opted-in receipt contract. */
const RECEIPT_CAPABILITY_VALUE = 'coordination-issue-v1'

/**
 * Classify a registry entry's operator-declared receipt contract. A missing entry or a
 * missing field is `legacy-best-effort`, not a stronger claim. An unrecognized non-empty
 * value fails closed with a parse/validation error rather than silently downgrading —
 * mirrors `assertReposFile`'s fail-closed posture (see `packages/wiki-write-core/src/schemas.ts`).
 */
export function classifyReceiptCapability(entry: GateEntry | undefined): ReceiptCapability {
  if (entry === undefined) return 'legacy-best-effort'
  if (entry.cross_repo_receipts === undefined) return 'legacy-best-effort'
  if (entry.cross_repo_receipts === RECEIPT_CAPABILITY_VALUE) return 'receipt-accountable'
  throw new Error(
    `cross_repo_receipts: unrecognized value "${entry.cross_repo_receipts}" (expected "${RECEIPT_CAPABILITY_VALUE}")`,
  )
}

/**
 * Which items to dispatch now. Only `pending` items are planned; `blocked`
 * items are reported separately. Defers items whose target has an in-flight (intent/dispatched) item in any
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
    // Only `pending` is dispatchable, matching the executor's re-check.
    if (item.status !== 'pending') continue

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

/**
 * Apply the registry-gate signal per dispatched item (the only remaining
 * out-of-band terminal driver — receipts and the SLA are applied by the
 * caller before this runs; run/PR terminal-resolution
 * precedence table entirely), compute allTerminal (→ close), and idempotency
 * (identical markerHash → no write).
 */
export function planSnapshot(input: SnapshotPlanInput): SnapshotPlanResult {
  const updatedItems = input.state.items.map<DispatchItem>(item => {
    const signal = input.signals[item.id]
    if (signal === undefined) return item
    if (TERMINAL_STATUSES.has(item.status)) return item
    if (signal.gateBlocked !== true) return item
    return {...item, status: 'blocked'}
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

export interface CoordinationIssueRef {
  owner: string
  repo: string
  number: number
}

/**
 * Build the receipt-carrying dispatch prompt: the item's prompt text plus a
 * machine-contract block with the correlation id, the raw nonce, the
 * coordination issue as structured fields + canonical URL, literal `success`
 * and `noop` receipt examples, the `declined` and `countered` answers, the mandatory-receipt rule, and a self-validate
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
    'Post a receipt with status `declined` when you will not do this ask, with the reason in the summary.',
    'Post a receipt with status `countered` when you propose a different change, with the proposal in the summary.',
    'Post either before doing any work; neither completes the item.',
    'After posting either, stop: do not do the original ask or the proposed alternative. A revised ask needs a fresh approved dispatch.',
    '',
    'Self-validate before finishing: echo the resolved destination',
    `(owner=${coordinationIssue.owner}, repo=${coordinationIssue.repo}, number=${coordinationIssue.number}),`,
    'post the receipt comment, then re-read your posted comment. If the',
    'fro-bot:cross-repo-result marker is absent from what you posted, edit the',
    'comment to add it before declaring the work done.',
  ].join('\n')
}
