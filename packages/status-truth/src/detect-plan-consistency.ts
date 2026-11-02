/**
 * The plan resolvers. `plan-status` reads the target plan file's frontmatter. `plan-consistency` audits each `docs/plans/*.md` file for a frontmatter status that disagrees with its unit checkboxes and builds its findings directly, outside the claim registry; its bounded corrector and re-verifier are what `status-truth-prs` writes with.
 */

import type {FileLister, FileReader} from './detect-extract.ts'
import {
  computeClaimFingerprint,
  type PublicStatusTruthFinding,
  type ResolverResult,
  type StatusTruthClaim,
} from './report-model.ts'

/**
 * Conservative supported status vocabulary from existing plan frontmatter.
 * Only these values are recognized as valid plan status; anything else is unresolved.
 */
export const SUPPORTED_PLAN_STATUSES: readonly string[] = ['active', 'complete', 'draft', 'cancelled', 'superseded']

/**
 * Parse YAML frontmatter from plan file content.
 *
 * Returns the `status` field value if present and non-empty, or null otherwise.
 * Does not throw — malformed frontmatter returns null (caller treats as unresolved).
 *
 * Pure function: no I/O.
 */
function parsePlanFrontmatterStatus(content: string): string | null {
  // Match YAML frontmatter block: ---\n...\n--- (supports both LF and CRLF line endings)
  const frontmatterMatch = /^---\r?\n([\s\S]+?)\r?\n---/u.exec(content)
  if (frontmatterMatch === null || frontmatterMatch[1] === undefined) {
    return null
  }

  const frontmatterText = frontmatterMatch[1]

  // Extract status field from frontmatter text using a simple line-based match.
  // This avoids a full YAML parse dependency while being robust for the known
  // plan frontmatter format (status is always a simple scalar string value).
  // Supports unquoted, double-quoted, and single-quoted values (e.g. status: "active").
  const statusMatch = /^status:\s*["']?(\w+)["']?\s*$/mu.exec(frontmatterText)
  if (statusMatch === null || statusMatch[1] === undefined) {
    return null
  }

  return statusMatch[1].toLowerCase()
}

/**
 * Resolve a plan-status claim against the target plan file's frontmatter.
 *
 * Resolution rules:
 * - File read failure → `unavailable` (caller counts as file-parse error)
 * - No frontmatter or missing status field → `unavailable`
 * - Status value not in SUPPORTED_PLAN_STATUSES → `unavailable`
 * - Status present and supported → `resolved` with the live status value
 *
 * The resolver returns the live status regardless of whether it matches the
 * claimed status. `detectStatusTruthClaims` performs the current/drifted
 * classification by comparing live state to claimed state.
 *
 * Raw file content and frontmatter text are never emitted to public output.
 *
 * @param params - Resolver parameters.
 * @param params.claimedPath - Repo-relative path to the target plan file (e.g., `docs/plans/foo.md`).
 * @param params.fileReader - Injected file reader for testability.
 */
export async function resolvePlanStatusClaim(params: {
  claimedPath: string
  fileReader: FileReader
}): Promise<ResolverResult> {
  const {claimedPath, fileReader} = params

  // Reject paths containing traversal segments before calling fileReader.
  // This is a defense-in-depth check: the grammar already excludes `..` via
  // the `[\w-]+` segment pattern, but the resolver validates independently
  // so that callers passing arbitrary paths are also protected.
  if (claimedPath.includes('..') || !claimedPath.startsWith('docs/plans/')) {
    return {status: 'unavailable'}
  }

  let content: string
  try {
    content = await fileReader(claimedPath)
  } catch {
    // File read failure (ENOENT, permission denied, etc.) → unavailable
    // Caller is responsible for incrementing the file-parse error count
    return {status: 'unavailable'}
  }

  const liveStatus = parsePlanFrontmatterStatus(content)

  if (liveStatus === null) {
    // No frontmatter or missing status field → unresolved
    return {status: 'unavailable'}
  }

  if (!SUPPORTED_PLAN_STATUSES.includes(liveStatus)) {
    // Unsupported status value → unresolved (conservative vocabulary)
    return {status: 'unavailable'}
  }

  return {status: 'resolved', state: liveStatus}
}

/**
 * Result of parsing implementation-unit checkbox markers from plan content.
 *
 * `recognized: false` covers both "no checkbox markers present" and "no
 * markers matched the recognized grammar" (e.g. heading-encoded units) —
 * both are treated identically by callers: an unresolved signal, never drifted.
 */
export type PlanUnitCheckboxParseResult =
  | {readonly recognized: true; readonly checkedUnits: number; readonly uncheckedUnits: number}
  | {readonly recognized: false}

/**
 * Matches exactly one top-level implementation-unit checkbox marker line:
 *   `- [x] **Unit N: <label>**`
 *   `- [ ] **Unit N: <label>**`
 *
 * Anchored to the start of the line (no leading whitespace), so indented/nested
 * checkboxes never match. Requires the bold label to open immediately after the
 * checkbox with a literal `Unit <digits>:` prefix and to close with `**` at the
 * end of the line — bold-less labels, non-"Unit N:" bold text, and heading-style
 * encodings (`### U1.` + `Status:` lines) all fall outside this grammar.
 */
const UNIT_CHECKBOX_LINE_PATTERN = /^- \[([ x])\] \*\*Unit \d+:.*\*\*\s*$/u

/**
 * Parse implementation-unit checkbox markers from plan file content.
 *
 * Pure function: no I/O. Recognizes only the top-level `- [x] **Unit N: ...**` /
 * `- [ ] **Unit N: ...**` grammar (see `UNIT_CHECKBOX_LINE_PATTERN`). Checkboxes
 * outside that exact form — plain task-list items, indented sub-tasks, bold-less
 * labels, or heading-encoded units — are never counted.
 *
 * Returns `{recognized: false}` when zero lines match the grammar (no markers
 * present, or all present checkboxes fall outside the recognized form). This
 * collapses "no markers" and "unrecognized encoding" into one signal: callers
 * must treat unrecognizable or malformed unit markers as unresolved, never
 * as drifted.
 */
export function parsePlanUnitCheckboxes(content: string): PlanUnitCheckboxParseResult {
  let checkedUnits = 0
  let uncheckedUnits = 0

  for (const line of content.split(/\r?\n/u)) {
    const match = UNIT_CHECKBOX_LINE_PATTERN.exec(line)
    if (match === null) continue
    if (match[1] === 'x') {
      checkedUnits++
    } else {
      uncheckedUnits++
    }
  }

  if (checkedUnits === 0 && uncheckedUnits === 0) {
    return {recognized: false}
  }

  return {recognized: true, checkedUnits, uncheckedUnits}
}

// ---------------------------------------------------------------------------
// Plan-consistency claim kind — self-audit of frontmatter status vs. unit
// completion markers. Does NOT join CLAIM_KIND_DEFINITIONS: that registry is
// regex-extraction only, and this kind's claims are synthesized directly from
// already-read plan file content rather than matched out of prose. There is
// no CLAIM_KIND_DEFINITIONS lookup for this kind anywhere in this module —
// every switch/lookup over the registry (classifyClaim's compound check,
// resolverTypeForKind, extractStatusTruthClaimsFromText's per-def loop,
// resolveFileParseClaims's per-def loop) only ever sees claims of kinds that
// DO have a definition, because plan-consistency findings are built and
// resolved entirely outside that pipeline (see scanPlanConsistencyFindings).
// ---------------------------------------------------------------------------

/**
 * Fixed sentinel for a plan-consistency claim whose frontmatter status is
 * missing, malformed, or outside SUPPORTED_PLAN_STATUSES. Raw frontmatter
 * text must never reach the claim, the report, or any public surface.
 */
export const PLAN_CONSISTENCY_UNSUPPORTED_STATUS = 'unsupported'

/**
 * Constant proposed correction for a drifted plan-consistency finding.
 * Built from normalized fields, not text replacement.
 */
const PLAN_CONSISTENCY_CORRECTION = 'status: complete'

/**
 * Constant normalizedText for every plan-consistency claim. Fixed (not
 * derived from unit state) so the fingerprint — which is a hash of kind,
 * path, sourceRef, and normalizedText — is stable across drift episodes for
 * the same plan path. Terminal outcome labels therefore act as a permanent
 * per-plan opt-out, which is documented operator behavior.
 */
const PLAN_CONSISTENCY_NORMALIZED_TEXT = 'plan-consistency audit'

/**
 * Build the synthetic plan-consistency claim for a single plan file.
 *
 * Pure function: no I/O. `claimedState` carries the frontmatter status only
 * when it is a member of SUPPORTED_PLAN_STATUSES; any other value (missing,
 * malformed, or outside the vocabulary) collapses to the fixed
 * `PLAN_CONSISTENCY_UNSUPPORTED_STATUS` sentinel before the claim is built,
 * so arbitrary frontmatter text can never reach the claim, report JSON, or
 * any public surface.
 */
export function buildPlanConsistencyClaim(path: string, content: string): StatusTruthClaim {
  const rawStatus = parsePlanFrontmatterStatus(content)
  const claimedState =
    rawStatus !== null && SUPPORTED_PLAN_STATUSES.includes(rawStatus) ? rawStatus : PLAN_CONSISTENCY_UNSUPPORTED_STATUS

  return {
    kind: 'plan-consistency',
    path,
    sourceRef: path,
    claimedState,
    normalizedText: PLAN_CONSISTENCY_NORMALIZED_TEXT,
  }
}

/** Result of resolving the plan-consistency drift matrix for one claim. */
export interface PlanConsistencyVerdictResult {
  readonly verdict: 'current' | 'drifted' | 'unresolved'
  readonly proposalEligible: boolean
  readonly proposedCorrection?: string
}

/**
 * The single resolver for the plan-consistency drift matrix.
 *
 * Returns the FINAL verdict for this kind directly — there is no
 * equality-based `classifyClaim` fallback path for plan-consistency, because
 * naive `liveState === claimedState` equality would misclassify `complete` +
 * unchecked units as drifted. This function is the one place the matrix is
 * encoded:
 *
 * - missing/malformed/unsupported claimed status → unresolved
 * - no recognizable unit markers → unresolved
 * - `active` + every recognized unit checked (>=1 checked unit) → drifted,
 *   proposal-eligible, correction `status: complete`
 * - `complete` + at least one unchecked unit → unresolved
 * - everything else (active+unfinished, complete+all-checked,
 *   draft/cancelled/superseded in any unit state) → current
 *
 * Pure function: no I/O.
 */
export function resolvePlanConsistencyVerdict(params: {
  claimedState: string
  units: PlanUnitCheckboxParseResult
}): PlanConsistencyVerdictResult {
  const {claimedState, units} = params

  if (!SUPPORTED_PLAN_STATUSES.includes(claimedState)) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  if (!units.recognized) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  const allUnitsChecked = units.checkedUnits > 0 && units.uncheckedUnits === 0
  const hasUncheckedUnits = units.uncheckedUnits > 0

  if (claimedState === 'active' && allUnitsChecked) {
    return {verdict: 'drifted', proposalEligible: true, proposedCorrection: PLAN_CONSISTENCY_CORRECTION}
  }

  if (claimedState === 'complete' && hasUncheckedUnits) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  return {verdict: 'current', proposalEligible: false}
}

/**
 * Bounded pure corrector for the plan-consistency claim kind.
 *
 * Rewrites exactly the frontmatter `status:` line to `status: complete`,
 * preserving every other byte of the input. Handles unquoted, double-quoted,
 * and single-quoted status values; the corrected line is always the
 * canonical unquoted form. `status:` occurrences in the plan body (outside
 * the frontmatter block) are never touched.
 *
 * Returns `null` — a no-correction signal — when the content has no
 * parseable frontmatter block or the frontmatter has no `status:` line.
 * Never returns a mangled file: the output is always either the original
 * content with only the frontmatter status line changed, or `null`.
 *
 * Pure function: no I/O.
 */
export function correctPlanConsistencyStatusLine(content: string): string | null {
  const frontmatterMatch = /^(---\r?\n)([\s\S]+?)(\r?\n---)/u.exec(content)
  if (frontmatterMatch === null) return null

  const [fullMatch, openDelim, frontmatterText, closeDelim] = frontmatterMatch
  if (openDelim === undefined || frontmatterText === undefined || closeDelim === undefined) return null

  const statusLinePattern = /^status:\s*["']?(\w+)["']?\s*$/mu
  const statusMatch = statusLinePattern.exec(frontmatterText)
  if (statusMatch === null) return null

  const correctedFrontmatterText = frontmatterText.replace(statusLinePattern, 'status: complete')
  const correctedFrontmatterBlock = `${openDelim}${correctedFrontmatterText}${closeDelim}`

  return (
    content.slice(0, frontmatterMatch.index) +
    correctedFrontmatterBlock +
    content.slice((frontmatterMatch.index ?? 0) + fullMatch.length)
  )
}

/**
 * Re-verify a plan-consistency correction through the full resolver
 * composition: corrected content → claim → checkbox parse → verdict.
 *
 * Exported for both the shell (live re-check, R6 TOCTOU guard) and tests.
 * Pure function: no I/O.
 */
export function reverifyPlanConsistencyCorrection(
  path: string,
  correctedContent: string,
): PlanConsistencyVerdictResult {
  const claim = buildPlanConsistencyClaim(path, correctedContent)
  const units = parsePlanUnitCheckboxes(correctedContent)
  return resolvePlanConsistencyVerdict({claimedState: claim.claimedState, units})
}

/** Repo-relative plan paths this kind audits: top-level `docs/plans/*.md` only. */
const PLAN_CONSISTENCY_PATH_PATTERN = /^docs\/plans\/[^/]+\.md$/u

/**
 * Scan `docs/plans/*.md` and emit one plan-consistency finding per plan.
 *
 * Bounded second pass: `scanStatusTruthClaims` consumes file contents
 * internally and returns only claims, so this builder reuses the same
 * injected `fileLister`/`fileReader` seams from `runDetect` and reads the
 * (small) plan corpus a second time, rather than widening the scan API.
 *
 * Each finding's verdict comes directly from `resolvePlanConsistencyVerdict`
 * — no `CLAIM_KIND_DEFINITIONS` entry and no `classifyClaim` equality
 * fallback are involved for this kind. `liveState` carries only normalized
 * unit counts (`checked=N unchecked=M`) when the unit grammar is recognized;
 * it is omitted when unrecognized, since there is nothing normalized to report.
 *
 * File read failures increment `scanErrors` and produce no finding for that
 * plan — consistent with existing scan-error accounting elsewhere in this
 * module; the caller must never fabricate a clean report from a partial scan.
 */
export async function scanPlanConsistencyFindings(params: {
  fileLister: FileLister
  fileReader: FileReader
}): Promise<{findings: PublicStatusTruthFinding[]; scanErrors: number}> {
  const {fileLister, fileReader} = params
  const paths = await fileLister()
  const findings: PublicStatusTruthFinding[] = []
  let scanErrors = 0

  for (const filePath of paths) {
    if (!PLAN_CONSISTENCY_PATH_PATTERN.test(filePath)) continue

    let content: string
    try {
      content = await fileReader(filePath)
    } catch {
      scanErrors++
      continue
    }

    const claim = buildPlanConsistencyClaim(filePath, content)
    const units = parsePlanUnitCheckboxes(content)
    const {verdict, proposalEligible, proposedCorrection} = resolvePlanConsistencyVerdict({
      claimedState: claim.claimedState,
      units,
    })
    const fingerprint = computeClaimFingerprint(claim.kind, claim.path, claim.sourceRef, claim.normalizedText)
    // Word-chars-and-hyphens only (no spaces or `=`) so this value round-trips
    // through the proposal issue body's hidden live-state marker, whose pattern
    // is `[\w-]+` (see LIVE_STATE_MARKER_PATTERN in status-truth-proposals.ts).
    const liveState = units.recognized ? `checked-${units.checkedUnits}-unchecked-${units.uncheckedUnits}` : undefined

    findings.push({
      kind: 'plan-consistency',
      path: claim.path,
      sourceRef: claim.sourceRef,
      verdict,
      fingerprint,
      claimedState: claim.claimedState,
      ...(liveState !== undefined && {liveState}),
      proposalEligible,
      ...(proposedCorrection !== undefined && {proposedCorrection}),
    })
  }

  return {findings, scanErrors}
}
