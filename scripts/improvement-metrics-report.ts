/**
 * Public-safe report rendering + perpetual-issue upsert for the improvement-metric loop.
 *
 * Pure render functions (`renderReportBody`, `renderRunSummary`) came from Unit 3.
 * Unit 4 adds the I/O shell: `upsertReportIssue` finds the single perpetual report
 * issue by label, decides create-vs-update by version marker, and rewrites the body
 * in place while preserving operator tick-state for edges still present — the
 * repo's first `issues.update({body})`. `main()` wires the digest file to the shell.
 *
 * Every rendered surface is routed through `applyPublicOutputGate` before it is
 * returned. A gate failure blocks that surface outright (throws
 * `ReportRenderBlockedError`) — there is no advisory-only fallback (R19). The
 * upsert shell catches that error and performs NO create/update (fail-closed).
 *
 * The candidate checklist is public-safe by construction: `DetectEdge` (from
 * `improvement-metrics-detect.ts`) carries only `{fingerprint, classKey, eventId,
 * eventUrl, eventCreatedAt, ticked}` — no source title or body excerpt is even in
 * scope for these render functions, which makes the R20 denylist structural
 * rather than a runtime check (R20).
 *
 * Strip-only safe: no enums, namespaces, parameter properties, or `any`.
 */

import type {DetectEdge, MetricsDigest} from './improvement-metrics-detect.ts'
import process from 'node:process'
import {isRecord} from './capture-learnings-privacy.ts'
import {
  buildEdgeChecklistLine,
  buildReportVersionMarker,
  IMPROVEMENT_METRICS_REPORT_LABEL,
  IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR,
  parseEdgeChecklistLine,
  parseReportVersionMarker,
} from './improvement-metrics-core.ts'
import {applyPublicOutputGate, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Gate-failure contract
// ---------------------------------------------------------------------------

/**
 * Thrown when a rendered surface fails `applyPublicOutputGate`. Fail-closed by
 * construction: the caller (Unit 4's I/O shell) must catch this and perform no
 * write, never fall back to an unsanitized or partially-sanitized body (R19).
 */
export class ReportRenderBlockedError extends Error {
  readonly surface: string
  readonly blockReason: string

  constructor(surface: string, blockReason: string) {
    super(`improvement-metrics-report: blocked rendering surface "${surface}": ${blockReason}`)
    this.name = 'ReportRenderBlockedError'
    this.surface = surface
    this.blockReason = blockReason
  }
}

/** Current report body schema version, embedded via the hidden version marker. */
export const REPORT_BODY_VERSION = 1

// ---------------------------------------------------------------------------
// Report body rendering
// ---------------------------------------------------------------------------

function renderCandidateChecklist(edges: readonly DetectEdge[]): string[] {
  if (edges.length === 0) {
    return ['(no pending or confirmed candidates this run)']
  }
  const sorted = [...edges].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
  return sorted.map(edge => {
    const checklistLine = buildEdgeChecklistLine({fingerprint: edge.fingerprint, checked: edge.ticked})
    return `${checklistLine}\n  - class: \`${edge.classKey}\` — ${edge.eventUrl}`
  })
}

/**
 * Render the perpetual report issue body from the digest + edge list.
 *
 * Public-safe by construction: the checklist is built only from each edge's
 * class key, public issue URL, and checkbox+fingerprint marker — never a
 * source title, body excerpt, or repo/branch name (R20). Ticked edges still
 * present in `edges` are re-emitted as `[x]` via `edge.ticked`.
 *
 * Below the `insufficient-signal` floor, no trend/interpretation line and no
 * candidate checklist are rendered (Unit 2 already suppresses candidate
 * surfacing at that floor, so `edges` is expected empty in that state).
 *
 * @throws {ReportRenderBlockedError} if the rendered body fails the public-output gate (R19).
 */
export function renderReportBody(
  digest: MetricsDigest,
  edges: readonly DetectEdge[],
  tokens: PublicOutputTokens,
): string {
  const lines: string[] = []

  lines.push('# Improvement Metrics')
  lines.push('')
  lines.push(`Report state: **${digest.state}**`)
  lines.push('')
  lines.push(`Window: ${digest.windowDays} days`)
  lines.push(`Codified anchors in window: ${digest.anchors}`)
  lines.push(`Discovery (newly codified classes): ${digest.discovery}`)
  lines.push(`Prior-window discovery: ${digest.priorDiscovery}`)
  lines.push(`Confirmed recidivism (ticked edges): ${digest.confirmedRecidivism}`)
  lines.push(
    `Pending backlog: ${digest.backlogCount}${
      digest.oldestPendingAgeDays === null ? '' : ` (oldest pending candidate: ${digest.oldestPendingAgeDays}d)`
    }`,
  )
  lines.push('')

  if (digest.state === 'insufficient-signal') {
    lines.push('_Below the minimum-volume floor — no trend or interpretation is claimed this run._')
  } else {
    lines.push('## Candidate recurrences')
    lines.push('')
    lines.push('Tick a checkbox below to confirm a recurrence. Confirmed edges persist across rewrites.')
    lines.push('')
    lines.push(...renderCandidateChecklist(edges))
  }

  lines.push('')
  lines.push(buildReportVersionMarker(REPORT_BODY_VERSION))

  const body = lines.join('\n')

  const gate = applyPublicOutputGate({
    surface: 'proposal-body',
    content: body,
    tokens,
    fingerprint: undefined,
  })

  if (!gate.allowed) {
    throw new ReportRenderBlockedError('proposal-body', gate.blockReason)
  }

  return gate.sanitizedContent
}

// ---------------------------------------------------------------------------
// Workflow run summary rendering
// ---------------------------------------------------------------------------

/**
 * Render the counts-only workflow step-summary line for the report job.
 *
 * Counts-only surface: `fingerprint` is always `undefined`, per the gate's
 * counts-only-surface enforcement.
 *
 * @throws {ReportRenderBlockedError} if the rendered summary fails the public-output gate (R19).
 */
export function renderRunSummary(digest: MetricsDigest, tokens: PublicOutputTokens): string {
  const summary =
    `Improvement Metrics: state=${digest.state} discovery=${digest.discovery}` +
    ` (prior=${digest.priorDiscovery}) confirmedRecidivism=${digest.confirmedRecidivism}` +
    ` backlog=${digest.backlogCount}${
      digest.oldestPendingAgeDays === null ? '' : ` oldestPendingAgeDays=${digest.oldestPendingAgeDays}`
    } window=${digest.windowDays}d anchors=${digest.anchors}`

  const gate = applyPublicOutputGate({
    surface: 'workflow-summary-row',
    content: summary,
    tokens,
    fingerprint: undefined,
  })

  if (!gate.allowed) {
    throw new ReportRenderBlockedError('workflow-summary-row', gate.blockReason)
  }

  return gate.sanitizedContent
}

// ---------------------------------------------------------------------------
// Tick-state recovery (mirrors improvement-metrics-detect.ts's recoverPriorTickState)
// ---------------------------------------------------------------------------

/**
 * Recover ticked edge fingerprints from a prior report issue body by scanning
 * every line for a checklist entry (Unit 1's `parseEdgeChecklistLine`).
 *
 * Duplicated locally (rather than imported from `improvement-metrics-detect.ts`)
 * to keep this module's upsert shell self-contained and independently testable
 * without pulling in the detect module's git/fs I/O surface.
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
// Narrow injected Octokit client interface
// ---------------------------------------------------------------------------

interface RawReportIssueListItem {
  readonly number: number
  readonly body?: string | null
}

/** Narrow injected Octokit-like client interface for the upsert shell. */
export interface ImprovementMetricsReportOctokitClient {
  readonly issues: {
    readonly listForRepo: (params: {
      owner: string
      repo: string
      labels?: string
      state: 'open' | 'closed' | 'all'
      per_page?: number
    }) => Promise<{data: RawReportIssueListItem[]}>
    readonly create: (params: {
      owner: string
      repo: string
      title: string
      body: string
      labels: string[]
    }) => Promise<{data: {number: number}}>
    readonly update: (params: {owner: string; repo: string; issue_number: number; body: string}) => Promise<unknown>
    readonly getLabel: (params: {owner: string; repo: string; name: string}) => Promise<unknown>
    readonly createLabel: (params: {
      owner: string
      repo: string
      name: string
      color: string
      description: string
    }) => Promise<unknown>
  }
}

/** Static issue title. NEVER data-derived — a security requirement (R10). */
export const IMPROVEMENT_METRICS_REPORT_TITLE = 'Improvement Metrics'

type ReportLogSink = (message: string) => void

const writeReportLog: ReportLogSink = message => process.stderr.write(message)

function isApiStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

/**
 * Ensure the improvement-metrics report label exists, mirroring
 * `capture-patterns-open.ts`'s `ensurePatternProposalLabelsExist`: getLabel 404 ->
 * createLabel, 422 idempotent. Returns whether the label is confirmed available.
 */
export async function ensureReportLabelExists(
  octokit: ImprovementMetricsReportOctokitClient,
  owner: string,
  repo: string,
  writeLog: ReportLogSink = writeReportLog,
): Promise<boolean> {
  const {name, color, description} = IMPROVEMENT_METRICS_REPORT_LABEL_DESCRIPTOR

  try {
    await octokit.issues.getLabel({owner, repo, name})
    return true
  } catch (getError: unknown) {
    if (!isApiStatus(getError, 404)) {
      writeLog('improvement-metrics-report: label check failed; cannot ensure report label\n')
      return false
    }
  }

  try {
    await octokit.issues.createLabel({owner, repo, name, color, description})
    return true
  } catch (createError: unknown) {
    if (isApiStatus(createError, 422)) {
      return true
    }
    writeLog('improvement-metrics-report: label creation failed; cannot ensure report label\n')
    return false
  }
}

// ---------------------------------------------------------------------------
// Upsert shell
// ---------------------------------------------------------------------------

/** Closed-vocabulary outcome of an upsert attempt. */
export type UpsertReportIssueOutcome = 'created' | 'updated' | 'noop' | 'blockedOnPrivacy' | 'labelUnavailable'

export interface UpsertReportIssueResult {
  outcome: UpsertReportIssueOutcome
  issueNumber: number | null
}

export interface UpsertReportIssueParams {
  octokit: ImprovementMetricsReportOctokitClient
  owner: string
  repo: string
  digest: MetricsDigest
  edges: readonly DetectEdge[]
  tokens: PublicOutputTokens
  /** In-memory guard against a same-run create-then-relist staleness duplicate. */
  createdIssueNumbers?: Set<number>
  writeLog?: ReportLogSink
}

/**
 * Upsert the single perpetual improvement-metrics report issue.
 *
 * Find-by-label -> decide create vs update by version marker -> rewrite the body
 * in place, re-emitting still-present ticked edges as `[x]` (operator confirmation
 * is never clobbered). Fails closed on a `ReportRenderBlockedError` (no
 * create/update). Carries an in-memory created-ID guard so a create-then-relist
 * within the same run cannot duplicate the issue.
 */
export async function upsertReportIssue(params: UpsertReportIssueParams): Promise<UpsertReportIssueResult> {
  const {octokit, owner, repo, digest, edges, tokens} = params
  const writeLog = params.writeLog ?? writeReportLog
  const createdIssueNumbers = params.createdIssueNumbers ?? new Set<number>()

  const listResponse = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    labels: IMPROVEMENT_METRICS_REPORT_LABEL,
    per_page: 10,
  })

  // Same-run staleness guard: a stale list-after-create response can omit the
  // issue this run already created. Prefer a known created-ID over a stale list.
  const existing =
    listResponse.data.find(issue => createdIssueNumbers.has(issue.number)) ?? listResponse.data[0] ?? null

  if (existing !== null) {
    const priorBody = existing.body ?? ''
    const priorTickState = recoverPriorTickState(priorBody)
    const priorVersion = parseReportVersionMarker(priorBody)

    const edgesWithPriorTicks = edges.map(edge => ({
      ...edge,
      ticked: edge.ticked || priorTickState.has(edge.fingerprint),
    }))

    let renderedBody: string
    try {
      renderedBody = renderReportBody(digest, edgesWithPriorTicks, tokens)
    } catch (error: unknown) {
      if (error instanceof ReportRenderBlockedError) {
        writeLog(`improvement-metrics-report: blocked rendering surface "${error.surface}"; no update performed\n`)
        return {outcome: 'blockedOnPrivacy', issueNumber: null}
      }
      throw error
    }

    if (priorVersion === REPORT_BODY_VERSION && renderedBody === priorBody) {
      return {outcome: 'noop', issueNumber: existing.number}
    }

    await octokit.issues.update({owner, repo, issue_number: existing.number, body: renderedBody})
    return {outcome: 'updated', issueNumber: existing.number}
  }

  let createdBody: string
  try {
    createdBody = renderReportBody(digest, edges, tokens)
  } catch (error: unknown) {
    if (error instanceof ReportRenderBlockedError) {
      writeLog(`improvement-metrics-report: blocked rendering surface "${error.surface}"; no create performed\n`)
      return {outcome: 'blockedOnPrivacy', issueNumber: null}
    }
    throw error
  }

  const labelConfirmed = await ensureReportLabelExists(octokit, owner, repo, writeLog)
  if (!labelConfirmed) {
    writeLog('improvement-metrics-report: report label unavailable; skipping create\n')
    return {outcome: 'labelUnavailable', issueNumber: null}
  }

  const createResponse = await octokit.issues.create({
    owner,
    repo,
    title: IMPROVEMENT_METRICS_REPORT_TITLE,
    body: createdBody,
    labels: [IMPROVEMENT_METRICS_REPORT_LABEL],
  })
  createdIssueNumbers.add(createResponse.data.number)

  return {outcome: 'created', issueNumber: createResponse.data.number}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface DigestFile {
  digest: MetricsDigest
  edges: DetectEdge[]
}

/** Counts-only result JSON written to stdout and IMPROVEMENT_METRICS_RESULT_PATH. */
interface ReportResult {
  outcome: UpsertReportIssueOutcome | null
  tokenLoadFailure: boolean
  digestReadFailure: boolean
}

async function readDigestFile(path: string): Promise<DigestFile> {
  const {readFile} = await import('node:fs/promises')
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as DigestFile
}

/**
 * CLI entry point for the report step: token-load-before-API fail-closed
 * ordering, read the digest written by detect, upsert the perpetual report
 * issue, and write a counts-only result JSON.
 *
 * Best-effort: a digest read failure is fail-soft (no write, presence bit set).
 * A token-load failure is fail-closed (no create/update, presence bit set).
 */
async function main(): Promise<void> {
  const owner = 'fro-bot'
  const repo = '.github'

  const result: ReportResult = {
    outcome: null,
    tokenLoadFailure: false,
    digestReadFailure: false,
  }

  const digestPath = process.env.IMPROVEMENT_METRICS_DIGEST_PATH
  const resultPath = process.env.IMPROVEMENT_METRICS_RESULT_PATH

  const {loadPrivateTokensFromDisk} = await import('./capture-learnings-privacy.ts')
  const {loadRedactedCanonicalIdsFromDisk} = await import('./status-truth-proposals.ts')
  const {makePublicOutputTokens} = await import('./status-truth-public-output.ts')

  let tokens: PublicOutputTokens
  try {
    const [privateTokens, redactedCanonicalIds] = await Promise.all([
      loadPrivateTokensFromDisk(),
      loadRedactedCanonicalIdsFromDisk(),
    ])
    tokens = makePublicOutputTokens({privateTokens, redactedCanonicalIds})
  } catch {
    result.tokenLoadFailure = true
    tokens = {loaded: false, error: 'token load failure'}
  }

  if (!result.tokenLoadFailure && digestPath !== undefined && digestPath !== '') {
    let digestFile: DigestFile | null = null
    try {
      digestFile = await readDigestFile(digestPath)
    } catch {
      result.digestReadFailure = true
    }

    if (digestFile !== null) {
      const {createOctokitFromEnv} = await import('./capture-learnings-harvest.ts')
      const rawOctokit = await createOctokitFromEnv()
      const octokit = (rawOctokit as unknown as {rest: ImprovementMetricsReportOctokitClient}).rest

      const upsertResult = await upsertReportIssue({
        octokit,
        owner,
        repo,
        digest: digestFile.digest,
        edges: digestFile.edges,
        tokens,
      })
      result.outcome = upsertResult.outcome
    }
  } else if (digestPath === undefined || digestPath === '') {
    result.digestReadFailure = true
  }

  const resultJson = `${JSON.stringify(result)}\n`
  process.stdout.write(resultJson)

  if (resultPath !== undefined && resultPath !== '') {
    try {
      const {writeFile} = await import('node:fs/promises')
      await writeFile(resultPath, resultJson, {flag: 'w'})
    } catch {
      process.stderr.write('improvement-metrics-report: could not write result file\n')
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
