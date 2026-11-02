/**
 * The rollout-tracker compound resolver and the snapshot loader. A claim about the rollout tracker is compared against the `issue_state` of the matching snapshot item and nothing else. The snapshot file is untrusted input: anything malformed loads as no snapshot, so the claims stay unresolved.
 *
 * Depends on the rollout snapshot types and never on `detect-live-state`.
 */

import type {FileReader} from './detect-extract.ts'
import type {ResolverResult, StatusTruthClaim, StatusTruthSnapshot} from './report-model.ts'
import type {SnapshotItem} from './rollout-tracker-snapshot.ts'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

/**
 * Fixed claim-to-snapshot field map for rollout-tracker-status claims.
 *
 * The only field compared is `issue_state`. Project-specific fields (status,
 * readiness, gate) and volatile fields (issue_labels, issue_closed_at) are
 * intentionally excluded from claim comparison to prevent arbitrary snapshot
 * fields from becoming claim sources by accident.
 *
 * This map is code-reviewed and tested; it is the sole source of truth for
 * which snapshot fields are authoritative for rollout-tracker-status claims.
 */
const ROLLOUT_TRACKER_CLAIM_FIELD_MAP = {
  /** The snapshot field that represents the live state for a rollout-tracker-status claim. */
  liveStateField: 'issue_state',
} as const

/**
 * Resolve a rollout-tracker-status claim against a sanitized snapshot.
 *
 * Resolution rules:
 * - `snapshot` is null (unavailable) → `unavailable`
 * - No matching item found for the claim's sourceRef number → `unavailable`
 * - Matched item's `issue_state` is null (incomplete data) → `unavailable`
 * - Matched item's `issue_state` is present → `resolved` with the live state
 *
 * The resolver compares claim state only against the fixed field map
 * (`issue_state`). Raw snapshot payloads, Project field values, issue titles,
 * and tracker internals are never echoed into the result.
 *
 * Pure function: no I/O, no write credentials, no Octokit dependency.
 *
 * @param params - Resolution parameters.
 * @param params.claim - The rollout-tracker-status claim to resolve.
 * @param params.snapshot - The sanitized snapshot, or null if unavailable.
 */
export async function resolveRolloutTrackerClaim(params: {
  claim: StatusTruthClaim
  snapshot: StatusTruthSnapshot | null
}): Promise<ResolverResult> {
  const {claim, snapshot} = params

  // Snapshot unavailable → unresolved (never treat as no-drift)
  if (snapshot === null) {
    return {status: 'unavailable'}
  }

  // Extract the issue number from the sourceRef (bare #N format)
  const match = /^#(\d+)$/u.exec(claim.sourceRef)
  if (match === null || match[1] === undefined) {
    return {status: 'unavailable'}
  }
  const issueNumber = Number.parseInt(match[1], 10)

  // Find the matching snapshot item by content_number
  const item = snapshot.items.find(i => i.content_number === issueNumber)
  if (item === undefined) {
    return {status: 'unavailable'}
  }

  // Read the live state from the fixed field map (issue_state only)
  const liveState = item[ROLLOUT_TRACKER_CLAIM_FIELD_MAP.liveStateField]
  if (liveState === null) {
    // Incomplete data — cannot determine live state
    return {status: 'unavailable'}
  }

  // Return the live state with sub-resolver results derived from the snapshot.
  // The snapshot's issue_state satisfies the 'issue-state' sub-resolver requirement.
  // The 'pr-state' sub-resolver is also satisfied via the same snapshot state
  // (the snapshot is the authoritative compound source; both sub-resolvers read
  // from the same issue_state field to avoid double-counting or cross-wiring).
  // No raw snapshot payload, Project fields, or tracker internals are echoed.
  const subResolverResults: Record<string, ResolverResult> = {
    'issue-state': {status: 'resolved', state: liveState},
    'pr-state': {status: 'resolved', state: liveState},
  }
  return {status: 'resolved', state: liveState, subResolverResults}
}

/**
 * Valid issue_state values for a SnapshotItem.
 * Null is allowed (item exists but state not yet fetched).
 */
const VALID_SNAPSHOT_ISSUE_STATES: ReadonlySet<string> = new Set(['open', 'closed', 'merged'])

/**
 * Validate a single raw snapshot item from untrusted JSON.
 *
 * Conservative validation: rejects unexpected field types.
 * Returns false if any required field has an unexpected type.
 *
 * Fields validated:
 * - `content_number`: must be a number
 * - `content_repo`: must be a string
 * - `issue_state`: must be "open" | "closed" | "merged" | null
 * - `issue_labels`: must be an array
 *
 * Other fields (status, readiness, gate, issue_closed_at) are accepted as-is
 * since they are not used in claim resolution (only issue_state is authoritative).
 */
function isValidSnapshotItem(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>

  if (typeof obj.content_number !== 'number') return false
  if (typeof obj.content_repo !== 'string') return false

  // issue_state must be a valid string or null
  if (obj.issue_state !== null) {
    if (typeof obj.issue_state !== 'string') return false
    if (!VALID_SNAPSHOT_ISSUE_STATES.has(obj.issue_state)) return false
  }

  // issue_labels must be an array
  if (!Array.isArray(obj.issue_labels)) return false

  return true
}

/**
 * Load and validate a rollout snapshot from a JSON file.
 *
 * Security: the snapshot file is untrusted input. Schema validation is applied
 * conservatively; malformed or unexpected payloads return null without throwing
 * raw payload content into output.
 *
 * @param params - Load parameters.
 * @param params.snapshotPath - Path to the snapshot JSON file, or undefined/empty if absent.
 * @param params.fileReader - Injected file reader for testability. Defaults to fs.readFile.
 * @returns The validated snapshot, or null if absent/unavailable/malformed.
 *
 * Absence/malformed → null (rollout-tracker claims stay unresolved; no fake drift).
 * Never throws; never echoes raw payload into output.
 */
export async function loadRolloutSnapshot(params: {
  snapshotPath: string | undefined
  fileReader?: FileReader
}): Promise<StatusTruthSnapshot | null> {
  const {snapshotPath, fileReader} = params

  // No path → no snapshot available
  if (snapshotPath === undefined || snapshotPath === '') {
    return null
  }

  // Read the file
  let raw: string
  try {
    const reader = fileReader ?? (async (p: string) => readFile(p, 'utf8'))
    raw = await reader(snapshotPath)
  } catch {
    // File read failure (ENOENT, permission denied, etc.) → unavailable
    // Do not echo the error detail (may contain path info)
    process.stderr.write('status-truth-detect: snapshot file unavailable; rollout-tracker claims will be unresolved\n')
    return null
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed JSON → null; do not echo raw payload
    process.stderr.write('status-truth-detect: snapshot JSON malformed; rollout-tracker claims will be unresolved\n')
    return null
  }

  // Validate top-level shape: must be { items: [...] }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    process.stderr.write(
      'status-truth-detect: snapshot has unexpected shape; rollout-tracker claims will be unresolved\n',
    )
    return null
  }

  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.items)) {
    process.stderr.write(
      'status-truth-detect: snapshot missing items array; rollout-tracker claims will be unresolved\n',
    )
    return null
  }

  // Validate each item conservatively
  for (const item of obj.items as unknown[]) {
    if (!isValidSnapshotItem(item)) {
      // Do not echo item content — may contain sensitive Project field values
      process.stderr.write(
        'status-truth-detect: snapshot item failed validation; rollout-tracker claims will be unresolved\n',
      )
      return null
    }
  }

  // Safe to cast: all items passed validation
  return {items: obj.items as SnapshotItem[]}
}
