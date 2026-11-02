/**
 * The hidden markers in a proposal issue body: the fingerprint, live-state and kind markers, their builders and parsers, the recovery of a claim kind from an older body, and the closed vocabulary of claim kinds that keeps arbitrary body text out of telemetry keys. Also the cooldown after a terminal close.
 *
 * A leaf: it imports nothing from the package.
 */

/** Marker prefix for fingerprint in issue body. */
const FINGERPRINT_MARKER_PREFIX = 'status-truth:fingerprint='

/** Marker prefix for live-state in issue body. */
const LIVE_STATE_MARKER_PREFIX = 'status-truth:live-state='

/** Pattern to extract fingerprint from hidden marker. Must be lowercase hex. */
const FINGERPRINT_MARKER_PATTERN = /<!-- status-truth:fingerprint=([a-f0-9]+) -->/u

/** Pattern to extract live-state from hidden marker. */
const LIVE_STATE_MARKER_PATTERN = /<!-- status-truth:live-state=([\w-]+) -->/u

/** Marker prefix for claim kind in issue body. */
const KIND_MARKER_PREFIX = 'status-truth:kind='

/** Pattern to extract claim kind from hidden marker. Claim kinds are lowercase words and hyphens only. */
const KIND_MARKER_PATTERN = /<!-- status-truth:kind=([a-z-]+) -->/u

/** Pattern to extract claim kind from the visible `**Kind:** \`<kind>\`` proposal body line. */
const VISIBLE_KIND_LINE_PATTERN = /\*\*Kind:\*\* `([a-z-]+)`/u

/**
 * Closed vocabulary of recognized claim kinds for telemetry bucketing.
 * Kept in sync with `ClaimKind` in report-model.ts. Any recovered kind
 * text outside this set is bucketed as 'unknown' — telemetry keys must never
 * carry arbitrary body text.
 */
const KNOWN_CLAIM_KINDS: ReadonlySet<string> = new Set<string>([
  'pr-state',
  'issue-state',
  'release-tag-state',
  'plan-status',
  'rollout-tracker-status',
  'plan-consistency',
])

/**
 * Extract the fingerprint from a proposal issue body hidden marker.
 * Returns null if the body is absent, empty, or the marker is malformed.
 */
export function extractProposalFingerprint(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = FINGERPRINT_MARKER_PATTERN.exec(body)
  if (match === null) return null
  const value = match[1]
  // Require at least one hex character (empty value is malformed)
  if (value === undefined || value === '') return null
  return value
}

/**
 * Extract the recorded live-state from a proposal issue body hidden marker.
 * Returns null if absent or malformed.
 */
export function extractRecordedLiveState(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = LIVE_STATE_MARKER_PATTERN.exec(body)
  if (match === null) return null
  const value = match[1]
  if (value === undefined || value === '') return null
  return value
}

/**
 * Build the hidden marker line for a fingerprint.
 */
export function buildFingerprintMarker(fingerprint: string): string {
  return `<!-- ${FINGERPRINT_MARKER_PREFIX}${fingerprint} -->`
}

/**
 * Build the hidden marker line for a live-state.
 */
export function buildLiveStateMarker(liveState: string): string {
  return `<!-- ${LIVE_STATE_MARKER_PREFIX}${liveState} -->`
}

/**
 * Extract the claim kind from a proposal issue body hidden marker.
 * Returns null if the body is absent, empty, or the marker is malformed.
 */
export function extractProposalKind(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = KIND_MARKER_PATTERN.exec(body)
  if (match === null) return null
  const value = match[1]
  if (value === undefined || value === '') return null
  return value
}

/**
 * Build the hidden marker line for a claim kind.
 */
export function buildKindMarker(kind: string): string {
  return `<!-- ${KIND_MARKER_PREFIX}${kind} -->`
}

/**
 * Recover the claim kind for a proposal issue, for telemetry bucketing only.
 *
 * Precedence:
 * 1. Hidden `status-truth:kind=` marker (present on all proposals created after
 *    this marker was introduced).
 * 2. Visible `**Kind:** \`<kind>\`` body line (proposals created before the marker
 *    existed).
 * 3. 'unknown' when neither is present.
 *
 * Recovered text is validated against the closed vocabulary of known claim kinds
 * (`KNOWN_CLAIM_KINDS`). Any unrecognized value — from a malicious or malformed
 * body — is bucketed as 'unknown' rather than propagated into telemetry counts
 * keys.
 */
export function recoverProposalKind(body: string | null | undefined): string {
  const markerKind = extractProposalKind(body)
  if (markerKind !== null && KNOWN_CLAIM_KINDS.has(markerKind)) return markerKind

  if (body !== null && body !== undefined && body !== '') {
    const visibleMatch = VISIBLE_KIND_LINE_PATTERN.exec(body)
    const visibleKind = visibleMatch?.[1]
    if (visibleKind !== undefined && KNOWN_CLAIM_KINDS.has(visibleKind)) return visibleKind
  }

  return 'unknown'
}

/** Seven-day cooldown duration in milliseconds. */
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Returns true when the given ISO 8601 closedAt timestamp is within the
 * seven-day cooldown window relative to `now`.
 *
 * Pure function: no I/O, no side effects. Accepts `now` for deterministic tests.
 *
 * Boundary: exactly seven days ago is NOT within cooldown (returns false).
 */
export function isWithinCooldown(closedAt: string, now: Date): boolean {
  const closedMs = new Date(closedAt).getTime()
  const elapsedMs = now.getTime() - closedMs
  return elapsedMs < COOLDOWN_MS
}
