/** The state marker embedded in a coordination issue's comments: hash, parse, select and serialize. */

import {createHash} from 'node:crypto'
import {
  FROBOT_COMMENT_AUTHORS,
  isGoalStateBody,
  MARKER_PREFIX,
  type DispatchItem,
  type GoalState,
  type MarkerData,
  type TrackerComment,
} from './dispatch-model.ts'

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
    for (const k of Object.keys(value).sort()) {
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
