/**
 * Coverage state for the drafted-solutions PR, carried in the PR body.
 *
 * The body holds one machine block: an HTML comment wrapping JSON. GitHub preserves comments
 * verbatim across PR-body edits and API reads, and the block never renders. Harvest reads it to
 * learn which proposals the open draft already covers; publish renders the whole body from it.
 *
 * Fail-closed boundary: an unparseable, duplicated, truncated, or schema-invalid block is an
 * error result, never a guess. Only a newly created PR may legitimately have no block.
 * Nothing here checks that evidence is TRUE — evidence references are for reviewers.
 */

import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'

import {isRecord} from './capture-learnings-privacy.ts'
import {isAllowedDraftedSolutionPath} from './wiki-handoff-core.ts'

export const COVERAGE_OUTCOMES = ['new-doc', 'extension', 'covered', 'unverified'] as const
export type CoverageOutcome = (typeof COVERAGE_OUTCOMES)[number]

export const EVIDENCE_KINDS = ['pr', 'review', 'ci-run', 'file'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** One thing a kept claim rests on: a PR, review, CI run, or file. */
export interface EvidenceReference {
  kind: EvidenceKind
  ref: string
}

/** One processed learning proposal. */
export interface CoverageRow {
  /** Proposal issue number. */
  issue: number
  outcome: CoverageOutcome
  /** `docs/solutions/<category>/*.md` for new-doc, extension, and covered rows; null for unverified. */
  targetDoc: string | null
  /** Commit the claims were verified against. */
  sourceSha: string
  evidence: EvidenceReference[]
  /** Claims from the proposal that were dropped or narrowed. */
  droppedClaims: string[]
  /** {@link hashProposalBody} of the proposal body this row was drafted from. */
  bodyHash: string
  /** Required (non-blank) for covered and unverified rows. */
  reason: string
}

export type CoverageResult = {ok: true; rows: CoverageRow[]} | {ok: false; reason: string}

/** Where the body being parsed came from: a PR this run is creating, or one already open. */
export type BodyContext = 'new-pr' | 'existing-pr'

const BLOCK_VERSION = 1
const BLOCK_MARKER = '<!-- fro-bot:drafted-solutions-coverage'
const BLOCK_START = `${BLOCK_MARKER} v${BLOCK_VERSION}`
const BLOCK_PATTERN = /<!-- fro-bot:drafted-solutions-coverage v1\r?\n([\s\S]*?)\r?\n-->/

const ROW_KEYS = ['issue', 'outcome', 'targetDoc', 'sourceSha', 'evidence', 'droppedClaims', 'bodyHash', 'reason']
const EVIDENCE_KEYS = ['kind', 'ref']

const MAX_EVIDENCE_PER_ROW = 50
const MAX_CLAIMS_PER_ROW = 50
const MAX_REF_LENGTH = 500
const MAX_CLAIM_LENGTH = 1000
const MAX_REASON_LENGTH = 2000

/** sha256 hex of a proposal body, with CRLF normalized so API round trips do not change it. */
export function hashProposalBody(body: string): string {
  return createHash('sha256')
    .update(Buffer.from(body.replaceAll('\r\n', '\n'), 'utf8'))
    .digest('hex')
}

function fail(reason: string): {ok: false; reason: string} {
  return {ok: false, reason}
}

function describeKeyMismatch(record: Record<string, unknown>, expected: readonly string[]): string | undefined {
  const unknownKeys = Object.keys(record).filter(key => !expected.includes(key))
  if (unknownKeys.length > 0) return `unknown key(s): ${unknownKeys.join(', ')}`
  const missingKeys = expected.filter(key => !(key in record))
  if (missingKeys.length > 0) return `missing key(s): ${missingKeys.join(', ')}`
  return undefined
}

const OUTCOME_SET: ReadonlySet<unknown> = new Set(COVERAGE_OUTCOMES)
const EVIDENCE_KIND_SET: ReadonlySet<unknown> = new Set(EVIDENCE_KINDS)

function isOutcome(value: unknown): value is CoverageOutcome {
  return OUTCOME_SET.has(value)
}

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return EVIDENCE_KIND_SET.has(value)
}

function parseEvidence(value: unknown, label: string): EvidenceReference[] | string {
  if (!Array.isArray(value)) return `${label}: evidence must be an array`
  if (value.length > MAX_EVIDENCE_PER_ROW) return `${label}: evidence has more than ${MAX_EVIDENCE_PER_ROW} entries`
  const evidence: EvidenceReference[] = []
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) return `${label}: evidence entries must be objects`
    const mismatch = describeKeyMismatch(entry, EVIDENCE_KEYS)
    if (mismatch !== undefined) return `${label}: evidence entry has ${mismatch}`
    const {kind, ref} = entry
    if (!isEvidenceKind(kind)) return `${label}: evidence kind must be one of ${EVIDENCE_KINDS.join(', ')}`
    if (typeof ref !== 'string' || ref.trim() === '' || ref.length > MAX_REF_LENGTH || /[\r\n]/.test(ref)) {
      return `${label}: evidence ref must be a single-line string of 1-${MAX_REF_LENGTH} characters`
    }
    evidence.push({kind, ref})
  }
  return evidence
}

function parseClaims(value: unknown, label: string): string[] | string {
  if (!Array.isArray(value)) return `${label}: droppedClaims must be an array`
  if (value.length > MAX_CLAIMS_PER_ROW) return `${label}: droppedClaims has more than ${MAX_CLAIMS_PER_ROW} entries`
  const claims: string[] = []
  for (const claim of value as unknown[]) {
    if (typeof claim !== 'string' || claim.trim() === '' || claim.length > MAX_CLAIM_LENGTH) {
      return `${label}: droppedClaims entries must be non-blank strings of at most ${MAX_CLAIM_LENGTH} characters`
    }
    claims.push(claim)
  }
  return claims
}

function parseRow(value: unknown, index: number): CoverageRow | string {
  if (!isRecord(value)) return `rows[${index}] must be an object`
  const mismatch = describeKeyMismatch(value, ROW_KEYS)
  if (mismatch !== undefined) return `rows[${index}] has ${mismatch}`

  const {issue, outcome, targetDoc, sourceSha, bodyHash, reason} = value
  const label = typeof issue === 'number' ? `rows[${index}] (#${issue})` : `rows[${index}]`

  if (typeof issue !== 'number' || !Number.isSafeInteger(issue) || issue <= 0) {
    return `${label}: issue must be a positive integer`
  }
  if (!isOutcome(outcome)) return `${label}: outcome must be one of ${COVERAGE_OUTCOMES.join(', ')}`
  if (typeof sourceSha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sourceSha)) {
    return `${label}: sourceSha must be a lowercase hex commit SHA`
  }
  if (typeof bodyHash !== 'string' || !/^[0-9a-f]{64}$/.test(bodyHash)) {
    return `${label}: bodyHash must be a sha256 hex digest`
  }
  if (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH) {
    return `${label}: reason must be a string of at most ${MAX_REASON_LENGTH} characters`
  }

  const evidence = parseEvidence(value.evidence, label)
  if (typeof evidence === 'string') return evidence
  const droppedClaims = parseClaims(value.droppedClaims, label)
  if (typeof droppedClaims === 'string') return droppedClaims

  if (outcome === 'unverified') {
    if (targetDoc !== null) return `${label}: targetDoc must be null for an unverified row`
  } else if (typeof targetDoc !== 'string' || !isAllowedDraftedSolutionPath(targetDoc)) {
    return `${label}: targetDoc must be a docs/solutions/<category>/*.md path for a ${outcome} row`
  }

  if ((outcome === 'new-doc' || outcome === 'extension') && evidence.length === 0) {
    return `${label}: a ${outcome} row needs at least one evidence reference`
  }
  if ((outcome === 'covered' || outcome === 'unverified') && reason.trim() === '') {
    return `${label}: a ${outcome} row needs a reason`
  }

  return {
    issue,
    outcome,
    targetDoc,
    sourceSha,
    evidence,
    droppedClaims,
    bodyHash,
    reason,
  }
}

/** Schema-validates rows from untrusted input (block JSON or agent output). Fail closed. */
export function validateCoverageRows(value: unknown): CoverageResult {
  if (!Array.isArray(value)) return fail('rows must be an array')
  const rows: CoverageRow[] = []
  const seen = new Set<number>()
  for (const [index, entry] of value.entries()) {
    const row = parseRow(entry, index)
    if (typeof row === 'string') return fail(row)
    if (seen.has(row.issue)) return fail(`duplicate row for issue #${row.issue}`)
    seen.add(row.issue)
    rows.push(row)
  }
  return {ok: true, rows}
}

/**
 * Reads the coverage block from a PR body. A new PR with no block is empty coverage; an
 * existing PR with no block is an error, because a lost block would silently re-draft (and
 * re-close) every proposal.
 */
export function parseCoverageBlock(body: string | null | undefined, context: BodyContext): CoverageResult {
  const text = body ?? ''
  const occurrences = text.split(BLOCK_MARKER).length - 1

  if (occurrences === 0) {
    return context === 'new-pr' ? {ok: true, rows: []} : fail('coverage block is missing from the PR body')
  }
  if (occurrences > 1) return fail(`coverage block is duplicated (${occurrences} copies)`)

  const match = BLOCK_PATTERN.exec(text)
  if (match?.[1] === undefined) {
    return fail(`coverage block is truncated or malformed (expected "${BLOCK_START}" ... "-->")`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(match[1])
  } catch (error: unknown) {
    return fail(`coverage block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isRecord(payload)) return fail('coverage block payload must be a JSON object')
  const mismatch = describeKeyMismatch(payload, ['version', 'rows'])
  if (mismatch !== undefined) return fail(`coverage block payload has ${mismatch}`)
  if (payload.version !== BLOCK_VERSION) return fail(`coverage block version must be ${BLOCK_VERSION}`)

  return validateCoverageRows(payload.rows)
}

function sortByIssue(rows: readonly CoverageRow[]): CoverageRow[] {
  return [...rows].sort((a, b) => a.issue - b.issue)
}

/** Adds incoming rows; a row for an already-listed proposal replaces the old one. Sorted by issue. */
export function mergeCoverageRows(existing: readonly CoverageRow[], incoming: readonly CoverageRow[]): CoverageRow[] {
  const byIssue = new Map<number, CoverageRow>()
  for (const row of existing) byIssue.set(row.issue, row)
  for (const row of incoming) byIssue.set(row.issue, row)
  return sortByIssue([...byIssue.values()])
}

function escapeCell(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', String.raw`\|`)
    .replaceAll(/\s*[\r\n]\s*/g, ' ')
}

function renderBlock(rows: readonly CoverageRow[]): string {
  // `<` and `>` only occur inside JSON strings; escaping them keeps row text from ever closing
  // the comment or forging a second marker. JSON.parse restores them.
  const json = JSON.stringify({version: BLOCK_VERSION, rows}, null, 2)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('>', String.raw`\u003e`)
  return `${BLOCK_START}\n${json}\n-->`
}

function renderRow(row: CoverageRow): string {
  const evidence = row.evidence.map(entry => `${entry.kind}: ${entry.ref}`).join('; ')
  const notes = [...row.droppedClaims.map(claim => `Dropped: ${claim}`), row.reason].filter(note => note !== '')
  const cells = [
    `#${row.issue}`,
    row.outcome,
    row.targetDoc ?? '-',
    evidence === '' ? '-' : evidence,
    notes.length === 0 ? '-' : notes.join('; '),
  ]
  return `| ${cells.map(cell => escapeCell(cell)).join(' | ')} |`
}

/**
 * Renders the whole PR body: summary, evidence table, one `Closes #N` line per row (sorted),
 * machine block last. Throws on rows that would not re-parse, so every rendered body is readable.
 */
export function renderPrBody(rows: readonly CoverageRow[]): string {
  const validated = validateCoverageRows(rows)
  if (!validated.ok) throw new Error(`cannot render invalid coverage rows: ${validated.reason}`)
  const sorted = sortByIssue(validated.rows)

  const count = (outcome: CoverageOutcome): number => sorted.filter(row => row.outcome === outcome).length
  const sections = [
    '## Drafted solution docs',
    sorted.length === 0
      ? 'No learning proposals are covered yet.'
      : `Drafted from ${sorted.length} learning ${sorted.length === 1 ? 'proposal' : 'proposals'}: ` +
        `${count('new-doc')} new, ${count('extension')} extended, ${count('covered')} already covered, ` +
        `${count('unverified')} unverified. Review the evidence, then merge manually; merging closes the proposals below.`,
  ]

  if (sorted.length > 0) {
    sections.push(
      [
        '| Proposal | Outcome | Target doc | Evidence | Notes |',
        '| --- | --- | --- | --- | --- |',
        ...sorted.map(row => renderRow(row)),
      ].join('\n'),
      sorted.map(row => `Closes #${row.issue}`).join('\n'),
    )
  }

  sections.push(renderBlock(sorted))
  return `${sections.join('\n\n')}\n`
}
