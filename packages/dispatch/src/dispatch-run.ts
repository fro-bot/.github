/** The executors: `runDispatch` on an approval and `runTrack` on a schedule, with the compare-and-swap marker writes they share. */

import process from 'node:process'
import {retry} from '@fro-bot/core/retry'
import {
  buildMarkerComment,
  computeApprovalFingerprint,
  extractMarker,
  selectStateMarker,
  serializeMarker,
} from './dispatch-marker.ts'
import {
  CAS_MAX_RETRIES,
  FROBOT_COMMENT_AUTHORS,
  RECEIPT_SLA_MS,
  REQUIRED_APPROVER,
  TARGET_WORKFLOW_ID,
  TARGET_WORKFLOW_REF,
  TERMINAL_STATUSES,
  type BlockedReason,
  type CrossRepoDispatchOctokitClient,
  type DecompositionResult,
  type DispatchItem,
  type DispatchTarget,
  type GateEntry,
  type GateReason,
  type GoalState,
  type ItemStatus,
  type MarkerData,
  type ReceiptCapability,
  type ResultStatus,
  type SnapshotSignals,
  type TrackerComment,
} from './dispatch-model.ts'
import {
  buildDispatchPrompt,
  checkBriefIdentity,
  classifyReceiptCapability,
  gateTarget,
  isPromptSafe,
  parseBriefDomain,
  parseBriefReference,
  planDispatch,
  planSnapshot,
} from './dispatch-plan.ts'
import {
  computeCorrelationId,
  extractItemPrompts,
  hashNonce,
  LOOSE_TASK_LIST_PREFIX,
  parseDecomposition,
  resolveReceipts,
} from './dispatch-receipts.ts'

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

export async function readLatestMarker(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
  issueNumber: number,
): Promise<MarkerData | null> {
  const found = await readLatestMarkerComment(octokit, repo, issueNumber)
  return found?.marker ?? null
}

async function casWriteMarker(input: CasWriteInput): Promise<CasWriteResult> {
  return retry(
    async (): Promise<CasWriteResult> => {
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
        return {ok: false, reason: 'mismatch'}
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
    },
    {attempts: CAS_MAX_RETRIES, retryResult: result => !result.ok},
  )
}

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
  /**
   * The text of `program-domains.json` of `repo` at `commit`, for an item whose prompt names a domain brief. Without
   * it, or when it throws, such an item is blocked as `brief-unreadable`; an item that names no brief never calls it.
   */
  loadBriefFile?: (repo: RepoRepository, commit: string) => Promise<string>
  /**
   * The node ID of the repository that `target` names right now, read once for a domain item after its brief identity
   * check passes and before any intent is written. Without it, or when it throws or answers nothing, the item is held.
   */
  loadLiveNodeId?: (target: DispatchTarget) => Promise<string>
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
  /** Items left pending because a read they need before dispatch failed; each needs the operator to reapply the label. */
  held: number
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
    held: 0,
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
  // Also classify the receipt capability here, before any dispatch side effect:
  // an unrecognized `cross_repo_receipts` value must fail closed at this point,
  // not later at confirmed-dispatch time after `createWorkflowDispatch` already ran.
  let state: GoalState = {...marker.state, markerHash: marker.hash}
  const held = new Set<string>()
  const briefFiles = new Map<string, Promise<string>>()
  const briefFile = async (commit: string): Promise<string> => {
    const loaded = briefFiles.get(commit) ?? loadBrief(input, commit)
    briefFiles.set(commit, loaded)
    return loaded
  }
  const gateItem = async (item: DispatchItem): Promise<DispatchItem> => {
    if (item.status !== 'pending') return item
    const registryEntry = registryByKey.get(`${item.target.owner}/${item.target.name}`)
    classifyReceiptCapability(registryEntry)
    const gate = gateTarget(registryEntry)
    if (gate !== 'ok') return {...withoutHold(item), status: 'blocked'}
    // An eligible target owner missing a minted dispatch token is an ops
    // misconfiguration (App-installation mint didn't cover this owner) —
    // fail this item closed rather than dispatch with the wrong token.
    if (input.hasTargetToken !== undefined && !input.hasTargetToken(item.target.owner)) {
      return {...withoutHold(item), status: 'blocked'}
    }
    // A domain item names a brief, and dispatch checks for itself that the target is the repository that brief
    // names. It does not take the checklist author's word for it, or the preflight's, or the registry's: after the
    // brief says the name is right, the repository behind the name is read live. A read that fails holds the item
    // pending and marks it, so the operator is told; nothing retries it by itself, and the operator reapplies the
    // label. Every other failure is a fact about the prompt, the commit or the repository, and blocks for good.
    const reason = await briefGateReason(item, prompts.get(item.promptHash), registry, briefFile, input.loadLiveNodeId)
    if (reason === 'retry') {
      held.add(item.id)
      return {...item, hold: 'brief-read-failed'}
    }
    if (reason !== null) return {...withoutHold(item), status: 'blocked', gateReason: reason}
    return withoutHold(item)
  }
  const gatedItems: DispatchItem[] = []
  for (const item of state.items) {
    gatedItems.push(await gateItem(item))
  }
  state = {...state, items: gatedItems}

  // 3. Compute current approval fingerprint; store as approval record via CAS.
  const fingerprint = computeApprovalFingerprint(state.items)
  const priorHash = marker.hash
  // What a run learned about a domain item (a terminal block, or a hold) is written to the marker, and only that: any
  // other gate block is left to the registry, as before.
  const learned = state.items.filter(item => {
    const stored = marker.state.items.find(candidate => candidate.id === item.id)
    return item.gateReason !== stored?.gateReason || item.hold !== stored?.hold
  })
  if (state.approvalFingerprint !== fingerprint || learned.length > 0) {
    const approved = state.approvalFingerprint !== fingerprint
    const persisted = approved
      ? state.items
      : marker.state.items.map(stored => learned.find(item => item.id === stored.id) ?? stored)
    const withApproval: GoalState = {...state, items: persisted, approvalFingerprint: fingerprint}
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
    state = {...approvalState, items: state.items}
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
    const receiptContract = classifyReceiptCapability(registryByKey.get(`${item.target.owner}/${item.target.name}`))
    const flipped = flipItemStatus(latestMarkerForReconcile, item.id, 'dispatched', item.epoch ?? Date.now(), {
      receiptContract,
    })
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
  // An item held for a read that failed is neither deferred nor blocked: nothing about it is final, and it is counted
  // on its own so the job can say so.
  const dispatchable = plan.toDispatch.filter(item => !held.has(item.id))
  counts.held = plan.toDispatch.length - dispatchable.length
  counts.deferred = plan.deferredCount
  counts.blocked = plan.blockedCount

  // 5/6. Sequential per-item dispatch with re-read+re-compare before each item.
  for (const item of dispatchable) {
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

    // Flip to 'dispatched' + epoch via CAS. Snapshot the target's current
    // receipt-contract capability onto the item HERE, at confirmed-dispatch
    // time — never re-derived later from current metadata.
    const receiptContract = classifyReceiptCapability(
      registryByKey.get(`${currentItem.target.owner}/${currentItem.target.name}`),
    )
    const dispatchedState = flipItemStatus(
      {hash: intentState.markerHash, state: intentState},
      currentItem.id,
      'dispatched',
      Date.now(),
      {receiptContract},
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

/** One read of a pinned brief; a rejected read is kept, so every item that names the commit is blocked by it. */
async function loadBrief(input: RunDispatchInput, commit: string): Promise<string> {
  if (input.loadBriefFile === undefined) throw new Error('no way to read a domain brief')
  return input.loadBriefFile(input.repo, commit)
}

/** An item without its hold mark: a run that dispatches or blocks it has nothing left to say about a failed read. */
function withoutHold(item: DispatchItem): DispatchItem {
  const rest = {...item}
  delete rest.hold
  return rest
}

/**
 * What the gate does with an item whose prompt names a domain brief: `null` when the prompt names none or the target
 * is the repository the brief names; a reason that blocks the item for good; or `'retry'` when a read it needs failed
 * this run (the brief at its commit, or the repository behind the name), which holds the item pending. A read that
 * fails carries no detail.
 */
async function briefGateReason(
  item: DispatchItem,
  prompt: string | undefined,
  registry: readonly GateEntry[],
  readBrief: (commit: string) => Promise<string>,
  readLiveNodeId: ((target: DispatchTarget) => Promise<string>) | undefined,
): Promise<GateReason | 'retry' | null> {
  if (prompt === undefined) return null
  const reference = parseBriefReference(prompt)
  if (reference === null) return null
  if (reference === 'malformed') return 'brief-reference-invalid'
  let text: string
  try {
    text = await readBrief(reference.commit)
  } catch {
    return 'retry'
  }
  let programIds: ReadonlyMap<string, string>
  try {
    programIds = parseBriefDomain(text, reference.domain)
  } catch {
    return 'brief-content-invalid'
  }
  const identity = checkBriefIdentity({registry, target: item.target, programIds})
  if (identity !== null) return identity
  // The registry says the name is right; the repository behind it now must say so too.
  const programId = programIds.get(`${item.target.owner}/${item.target.name}`.toLowerCase())
  let live: string
  try {
    if (readLiveNodeId === undefined) return 'retry'
    live = await readLiveNodeId(item.target)
  } catch {
    return 'retry'
  }
  if (live === '') return 'retry'
  return live === programId ? null : 'brief-identity-mismatch'
}

function flipItemStatus(
  marker: MarkerData,
  itemId: string,
  status: ItemStatus,
  epoch: number | undefined,
  extra: {correlationId?: string; nonceHash?: string; receiptContract?: ReceiptCapability} = {},
): GoalState {
  const items = marker.state.items.map(item => {
    if (item.id !== itemId) return item
    return {
      ...item,
      status,
      ...(epoch === undefined ? {} : {epoch}),
      ...(extra.correlationId === undefined ? {} : {correlationId: extra.correlationId}),
      ...(extra.nonceHash === undefined ? {} : {nonceHash: extra.nonceHash}),
      ...(extra.receiptContract === undefined ? {} : {receiptContract: extra.receiptContract}),
    }
  })
  const nextState: GoalState = {...marker.state, items, markerHash: ''}
  const serialized = serializeMarker(nextState)
  return {...nextState, markerHash: serialized.hash}
}

/**
 * The item state an authentic receipt status resolves to. Explicit per status, with no default branch, so a new
 * status fails to compile here instead of silently completing the item. `declined` and `countered` end the attempt
 * as terminal `blocked`: the item is neither completed nor left to age into `needs-attention`.
 */
function itemOutcomeForReceipt(status: ResultStatus): {status: ItemStatus; blockedReason?: BlockedReason} {
  switch (status) {
    case 'success':
    case 'noop':
      return {status: 'completed'}
    case 'failed':
      return {status: 'failed'}
    case 'declined':
    case 'countered':
      return {status: 'blocked', blockedReason: status}
  }
}

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
   * Demoted to a NON-AUTHORITATIVE diagnostic: consulted
   * ONLY to annotate an already-`needs-attention`/`no-receipt` item with
   * run-observed vs not-observed context. Its return value never changes
   * any item's terminal/non-terminal state — receipts are the sole
   * completion oracle and the SLA is the sole `needs-attention` driver.
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
  /** Pending items marked as held for a failed read; each needs the operator to reapply the label. */
  itemsHeld: number
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
    itemsHeld: 0,
  }
}

/**
 * Tracking shell: resolves each dispatched (or `needs-attention`) item's
 * terminal state SOLELY from AUTHENTIC completion receipts plus the
 * 24h SLA and the registry gate — the receipt is the sole completion
 * oracle. Run-lookup is demoted to a NON-AUTHORITATIVE diagnostic: for an item that ends
 * up `needs-attention`/`no-receipt`, it annotates whether the worker's run
 * was observed as concluded or not observed — this
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

    const preItems = state.items.map<DispatchItem>(item => {
      if (TERMINAL_STATUSES.has(item.status)) return item

      const resolution = receiptResolutions.get(item.id)
      if (resolution?.terminal !== undefined) {
        const outcome = itemOutcomeForReceipt(resolution.terminal)
        return {
          ...item,
          status: outcome.status,
          needsAttentionReason: undefined,
          noReceiptDiagnostic: undefined,
          ...(outcome.blockedReason === undefined ? {} : {blockedReason: outcome.blockedReason}),
        }
      }
      if (resolution?.attentionReason !== undefined) {
        return {
          ...item,
          status: 'needs-attention',
          needsAttentionReason: resolution.attentionReason,
          ...(resolution.attentionReason === 'unparseable-receipt' ? {noReceiptDiagnostic: undefined} : {}),
        }
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
    const preItemsWithSla = preItems.map<DispatchItem>(item => {
      if (item.status !== 'dispatched') return item
      if (item.epoch !== undefined && now - item.epoch > slaMs) {
        return {...item, status: 'needs-attention', needsAttentionReason: 'no-receipt' as const}
      }
      return item
    })

    // Diagnostic-only annotation (R1/R3/R4): run-lookup is consulted ONLY for
    // an item that just became `needs-attention`/`no-receipt`, and only to
    // upgrade the conservative default when a completed correlated run is
    // observed. This NEVER changes terminal/non-terminal state — the item
    // stays `needs-attention` either way — and a missing/failed lookup is
    // never read as proof the worker never ran; it keeps the conservative
    // default instead.
    const preItemsWithDiagnostic = await Promise.all(
      preItemsWithSla.map(async item => {
        if (item.status !== 'needs-attention' || item.needsAttentionReason !== 'no-receipt') return item
        if (item.correlationId === undefined) return item

        const runConclusion = await input.findRunConclusion(item.target, item.correlationId)
        const noReceiptDiagnostic: NonNullable<DispatchItem['noReceiptDiagnostic']> =
          runConclusion === undefined ? 'dispatch-accepted-no-receipt' : 'run-observed-no-receipt'
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
    counts.itemsHeld += snapshot.state.items.filter(
      item => item.status === 'pending' && item.hold === 'brief-read-failed',
    ).length
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
