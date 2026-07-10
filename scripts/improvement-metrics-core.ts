/**
 * Pure core for the improvement-metric loop: closed-vocabulary report states,
 * codified-class identity keys, source-type classification, event->class edge
 * fingerprints, and report-issue marker/checklist live-state build/parse.
 *
 * Pure module: no I/O, no Octokit, no network. Every function here is a
 * deterministic transform over its inputs.
 *
 * Strip-only safe: no enums, namespaces, parameter properties, or `any`.
 */

import {createHash} from 'node:crypto'

// ---------------------------------------------------------------------------
// Report state (closed vocabulary)
// ---------------------------------------------------------------------------

/** Closed vocabulary of improvement-metric report states. */
export const REPORT_STATES = ['insufficient-signal', 'ambiguous', 'healthy', 'failing'] as const

/** A recognized improvement-metric report state. */
export type ReportState = (typeof REPORT_STATES)[number]

/**
 * Recover a report state from a raw string, rejecting any value outside the
 * closed vocabulary. Never coerces — an unrecognized string returns `null`.
 */
export function recoverReportState(raw: string): ReportState | null {
  return (REPORT_STATES as readonly string[]).includes(raw) ? (raw as ReportState) : null
}

// ---------------------------------------------------------------------------
// Codified-class identity key
// ---------------------------------------------------------------------------

/** Sentinel segment used for any missing class-key field. */
const CLASS_KEY_SENTINEL = 'unknown'

/** Stable separator joining class-key segments. Cannot collide with field values (forbidden below). */
const CLASS_KEY_SEPARATOR = '\u0001'

/**
 * Characters forbidden in a class-key field value: the separator itself, newlines,
 * and any other ASCII control character. A field containing one of these could
 * corrupt the key's segment boundaries.
 */
// eslint-disable-next-line no-control-regex -- intentional: rejects raw control chars (incl. \n, \r) in field values
const CLASS_KEY_FORBIDDEN_PATTERN = /[\u0000-\u001F\u007F]/u

/** Frontmatter fields used to derive a codified-class identity key. */
export interface ClassKeyFrontmatter {
  module?: string
  component?: string
  problem_type?: string
}

/**
 * Build a codified-class identity key from frontmatter fields.
 *
 * Deterministic string output, order-independent of how fields are supplied on
 * the input object (segment order is always `module`, `component`, `problem_type`).
 * Any missing field is replaced with a fixed sentinel segment — never throws for
 * missing fields. Fail-fast: throws if any field value contains a control
 * character or newline that could corrupt the separator-delimited key.
 */
export function buildClassKey(frontmatter: ClassKeyFrontmatter): string {
  const segments = [frontmatter.module, frontmatter.component, frontmatter.problem_type].map(value => {
    if (value === undefined || value === '') return CLASS_KEY_SENTINEL
    if (CLASS_KEY_FORBIDDEN_PATTERN.test(value)) {
      throw new Error('improvement-metrics-core: class-key field contains a forbidden control character')
    }
    return value
  })
  return segments.join(CLASS_KEY_SEPARATOR)
}

/**
 * Render a class key for human display, replacing the internal control-character
 * separator with a readable delimiter. Display-only: never feed the result back
 * into fingerprinting or parsing — the canonical key from `buildClassKey` is the
 * identity, this is cosmetic.
 */
export function formatClassKeyForDisplay(classKey: string): string {
  return classKey.split(CLASS_KEY_SEPARATOR).join(' › ')
}

// ---------------------------------------------------------------------------
// Source-type classification (closed vocabulary)
// ---------------------------------------------------------------------------

/** Closed vocabulary of source types eligible for the improvement-metric loop. */
export const SOURCE_TYPES = ['learning-proposal', 'pattern-proposal', 'status-truth'] as const

/** A recognized source type, or the `unknown` sentinel. */
export type SourceType = (typeof SOURCE_TYPES)[number] | 'unknown'

/**
 * Classify an issue's labels into exactly one recognized source type, or the
 * `unknown` sentinel when no label in the closed set is present. Single-pass
 * over `SOURCE_TYPES` in fixed priority order — deterministic even when
 * multiple recognized labels are present.
 */
export function classifySourceType(labels: readonly string[]): SourceType {
  for (const type of SOURCE_TYPES) {
    if (labels.includes(type)) return type
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Edge fingerprint
// ---------------------------------------------------------------------------

/** Control separator joining the two immutable edge-fingerprint inputs. */
const EDGE_FINGERPRINT_SEPARATOR = '\u0001'

// Rejects raw control chars (incl. \n, \r) in edge inputs, but permits \u0001 (0x01) since a
// well-formed classKey from buildClassKey legitimately embeds it as the segment separator
// (CLASS_KEY_SEPARATOR) — buildEdgeFingerprint(buildClassKey(...), eventId) is the intended
// composition and must not fail-fast on that separator.
// eslint-disable-next-line no-control-regex -- intentional control-char denylist
const EDGE_FINGERPRINT_FORBIDDEN_PATTERN = /[\0\u0002-\u001F\u007F]/u

/**
 * Build a stable, lowercase hex sha256 fingerprint for an (event -> class) edge.
 *
 * Identity is based solely on `classKey` and `eventId` — an operator checklist
 * tick keyed on this fingerprint survives issue body rewrites and reordering.
 * Fail-fast: throws if either input contains a control character or newline
 * that could corrupt the separator-delimited hash input.
 */
export function buildEdgeFingerprint(classKey: string, eventId: string): string {
  for (const value of [classKey, eventId]) {
    if (EDGE_FINGERPRINT_FORBIDDEN_PATTERN.test(value)) {
      throw new Error('improvement-metrics-core: edge fingerprint input contains a forbidden control character')
    }
  }
  return createHash('sha256').update(`${classKey}${EDGE_FINGERPRINT_SEPARATOR}${eventId}`).digest('hex')
}

// ---------------------------------------------------------------------------
// Report-issue version marker
// ---------------------------------------------------------------------------

const REPORT_VERSION_MARKER_PATTERN = /<!-- improvement-metrics:report:version=(-?\d+) -->/u

/**
 * Build the hidden report-issue version marker line.
 * Fail-fast: throws on a non-integer or negative version.
 */
export function buildReportVersionMarker(version: number): string {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('improvement-metrics-core: report version marker requires a non-negative integer')
  }
  return `<!-- improvement-metrics:report:version=${version} -->`
}

/**
 * Parse the hidden report-issue version marker from a body.
 * Returns `null` when absent or malformed (non-integer, negative).
 */
export function parseReportVersionMarker(body: string): number | null {
  const match = REPORT_VERSION_MARKER_PATTERN.exec(body)
  const raw = match?.[1]
  if (raw === undefined) return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return null
  return value
}

// ---------------------------------------------------------------------------
// Per-edge checklist encoding
// ---------------------------------------------------------------------------

const EDGE_MARKER_PATTERN = /<!-- improvement-metrics:edge=([a-f0-9]{64}) -->/u
const EDGE_CHECKLIST_LINE_PATTERN = /^- \[([ x]?)\] <!-- improvement-metrics:edge=([a-f0-9]{64}) -->$/u

/** Recovered edge checklist entry. */
export interface EdgeChecklistEntry {
  fingerprint: string
  checked: boolean
}

/**
 * Build a per-edge checklist line pairing a GFM checkbox with a hidden edge
 * fingerprint marker.
 */
export function buildEdgeChecklistLine(entry: EdgeChecklistEntry): string {
  const box = entry.checked ? 'x' : ' '
  return `- [${box}] <!-- improvement-metrics:edge=${entry.fingerprint} -->`
}

/**
 * Parse a per-edge checklist line back into `{ fingerprint, checked }`.
 *
 * A malformed checkbox (neither `[ ]` nor `[x]`) parses as `checked: false` —
 * fail-safe, never treated as checked. Returns `null` when no edge marker is
 * present at all.
 */
export function parseEdgeChecklistLine(line: string): EdgeChecklistEntry | null {
  const strictMatch = EDGE_CHECKLIST_LINE_PATTERN.exec(line)
  if (strictMatch !== null) {
    return {fingerprint: strictMatch[2] ?? '', checked: strictMatch[1] === 'x'}
  }
  const markerMatch = EDGE_MARKER_PATTERN.exec(line)
  const fingerprint = markerMatch?.[1]
  if (fingerprint === undefined) return null
  return {fingerprint, checked: false}
}

/**
 * Recover ticked edge fingerprints from a prior report issue body by scanning
 * every line for a checklist entry (`parseEdgeChecklistLine`).
 *
 * Shared by the detect and report modules so the tick-recovery logic cannot
 * drift between the two I/O shells.
 */
export function recoverPriorTickState(body: string): Set<string> {
  const ticked = new Set<string>()
  for (const line of body.split('\n')) {
    const entry = parseEdgeChecklistLine(line.trim())
    if (entry !== null && entry.checked) ticked.add(entry.fingerprint)
  }
  return ticked
}

// ---------------------------------------------------------------------------
// Live-state summary encoding (mirrors status-truth-proposals.ts)
// ---------------------------------------------------------------------------

const LIVE_STATE_SUMMARY_PATTERN = /^checked-(\d+)-unchecked-(\d+)$/u

/** Build the `checked-N-unchecked-M` live-state summary string. */
export function buildLiveStateSummary(counts: {checked: number; unchecked: number}): string {
  return `checked-${counts.checked}-unchecked-${counts.unchecked}`
}

/** Parse a `checked-N-unchecked-M` live-state summary string. Null if malformed. */
export function parseLiveStateSummary(raw: string): {checked: number; unchecked: number} | null {
  const match = LIVE_STATE_SUMMARY_PATTERN.exec(raw)
  if (match === null) return null
  const checked = Number(match[1])
  const unchecked = Number(match[2])
  if (!Number.isInteger(checked) || !Number.isInteger(unchecked)) return null
  return {checked, unchecked}
}

// ---------------------------------------------------------------------------
// Report-issue label
// ---------------------------------------------------------------------------

/** Fixed label applied to every improvement-metrics report issue. */
export const IMPROVEMENT_METRICS_REPORT_LABEL = 'improvement-metrics-report'

/** Label descriptor shape, ready for `.github/settings.yml` and runtime label preflight. */
export interface ImprovementMetricsLabelDescriptor {
  readonly name: string
  readonly color: string
  readonly description: string
}

/** Descriptor row for the improvement-metrics report label. */
export const IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR: ImprovementMetricsLabelDescriptor = {
  name: IMPROVEMENT_METRICS_REPORT_LABEL,
  color: '0e8a16',
  description: 'Improvement-metric loop report tracking event -> codified-class edges',
}
