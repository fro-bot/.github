import type {WikiLintJsonReport} from './wiki-lint.ts'
import {appendFile, readFile} from 'node:fs/promises'
import process from 'node:process'

import {Octokit} from '@octokit/rest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OctokitClient = Octokit

export interface ExistingIssue {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly body: string | null | undefined
}

export interface IssueDraft {
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
}

export interface IssueUpdate {
  readonly issueNumber: number
  readonly comment: string
}

export interface ReopenAction {
  readonly issueNumber: number
  readonly comment: string
}

export interface CloseAction {
  readonly issueNumber: number
}

export interface IssueLifecyclePlan {
  readonly toOpen: readonly IssueDraft[]
  readonly toUpdate: readonly IssueUpdate[]
  readonly toReopen: readonly ReopenAction[]
  readonly toClose: readonly CloseAction[]
}

export interface PlanInput {
  readonly report: WikiLintJsonReport
  readonly openIssues: readonly ExistingIssue[]
  readonly recentlyClosedIssues: readonly ExistingIssue[]
}

export interface SyncParams {
  readonly octokit: OctokitClient
  readonly owner: string
  readonly repo: string
  readonly plan: IssueLifecyclePlan
}

export interface SyncResult {
  readonly counters: {
    opened: number
    updated: number
    reopened: number
    closed: number
    failed: number
  }
  readonly errors: string[]
}

// ---------------------------------------------------------------------------
// Hidden marker patterns
// ---------------------------------------------------------------------------

const FINGERPRINT_MARKER_PATTERN = /<!-- wiki-lint:subject:fingerprint=([a-f0-9]+) -->/u
const FAILURE_CLASS_MARKER_PATTERN = /<!-- wiki-lint:subject:failure-class=([\w-]+) -->/u

function extractFingerprint(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = FINGERPRINT_MARKER_PATTERN.exec(body)
  return match === null ? null : (match[1] ?? null)
}

function extractFailureClass(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = FAILURE_CLASS_MARKER_PATTERN.exec(body)
  return match === null ? null : (match[1] ?? null)
}

// ---------------------------------------------------------------------------
// Issue body builders
// ---------------------------------------------------------------------------

function buildFindingBody(
  fingerprint: string,
  kind: string,
  path: string,
  message: string,
  generatedAt: string,
  snapshotSha: string | null,
): string {
  const shaLine = snapshotSha === null ? '' : `\n**Snapshot SHA:** \`${snapshotSha}\``
  return [
    `<!-- wiki-lint:subject:fingerprint=${fingerprint} -->`,
    '',
    `**Kind:** \`${kind}\``,
    `**Path:** \`${path}\``,
    `**Message:** ${message}${shaLine}`,
    '',
    `First detected at \`${generatedAt}\`.`,
  ].join('\n')
}

function buildFailureBody(failureClass: string, generatedAt: string): string {
  return [
    `<!-- wiki-lint:subject:failure-class=${failureClass} -->`,
    '',
    `**Failure class:** \`${failureClass}\``,
    '',
    `First detected at \`${generatedAt}\`.`,
  ].join('\n')
}

function buildRecurrenceComment(generatedAt: string, snapshotSha: string | null): string {
  const shaNote = snapshotSha === null ? '' : ` (snapshot: \`${snapshotSha}\`)`
  return `Recurrence detected at \`${generatedAt}\`${shaNote}.`
}

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isNullOrString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function assertShape(condition: boolean, reason: string): asserts condition {
  if (!condition) {
    process.stderr.write(`wiki-lint-issues: invalid report shape: ${reason}\n`)
    process.exit(1)
  }
}

export function validateWikiLintJsonReport(raw: unknown): asserts raw is WikiLintJsonReport {
  if (!isRecord(raw)) {
    process.stderr.write('wiki-lint-issues: invalid report shape: root is not an object\n')
    process.exit(1)
  }

  assertShape(isNumber(raw.schema_version), 'schema_version is not a number')
  assertShape(isNumber(raw.fingerprint_version), 'fingerprint_version is not a number')
  assertShape(
    raw.status === 'clean' || raw.status === 'findings' || raw.status === 'execution-failure',
    `status "${String(raw.status)}" is not valid`,
  )
  assertShape(isBoolean(raw.scan_complete), 'scan_complete is not a boolean')
  assertShape(isNullOrString(raw.snapshot_sha), 'snapshot_sha is not string | null')
  assertShape(isString(raw.generated_at), 'generated_at is not a string')
  assertShape(
    raw.failure_class === null || raw.failure_class === 'snapshot-restore' || raw.failure_class === 'lint-execution',
    `failure_class "${String(raw.failure_class)}" is not valid`,
  )
  assertShape(isBoolean(raw.repair_eligible), 'repair_eligible is not a boolean')
  assertShape(Array.isArray(raw.findings), 'findings is not an array')

  for (const [i, finding] of (raw.findings as unknown[]).entries()) {
    if (!isRecord(finding)) {
      process.stderr.write(`wiki-lint-issues: invalid report shape: findings[${i}] is not an object\n`)
      process.exit(1)
    }
    assertShape(isString(finding.kind), `findings[${i}].kind is not a string`)
    assertShape(
      finding.severity === 'deterministic' || finding.severity === 'advisory',
      `findings[${i}].severity "${String(finding.severity)}" is not valid`,
    )
    assertShape(isString(finding.path), `findings[${i}].path is not a string`)
    assertShape(isNullOrString(finding.target), `findings[${i}].target is not string | null`)
    assertShape(isString(finding.message), `findings[${i}].message is not a string`)
    assertShape(isString(finding.fingerprint), `findings[${i}].fingerprint is not a string`)
  }

  assertShape(Array.isArray(raw.freshness), 'freshness is not an array')

  if (!isRecord(raw.counts)) {
    process.stderr.write('wiki-lint-issues: invalid report shape: counts is not an object\n')
    process.exit(1)
  }

  for (const field of [
    'findings_total',
    'findings_deterministic',
    'findings_advisory',
    'pages_scanned',
    'pages_stale',
  ] as const) {
    assertShape(isNumber(raw.counts[field]), `counts.${field} is not a number`)
  }

  // Semantic constraint: execution-failure must have a non-null failure_class
  if (raw.status === 'execution-failure' && raw.failure_class === null) {
    process.stderr.write('wiki-lint-issues: execution-failure report missing failure_class\n')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Pure lifecycle planner
// ---------------------------------------------------------------------------

export function planIssueLifecycle(input: PlanInput): IssueLifecyclePlan {
  const {report, openIssues, recentlyClosedIssues} = input

  // Build lookup maps from existing issues
  const openByFingerprint = new Map<string, ExistingIssue>()
  const openByFailureClass = new Map<string, ExistingIssue>()
  const closedByFingerprint = new Map<string, ExistingIssue>()
  const closedByFailureClass = new Map<string, ExistingIssue>()

  for (const issue of openIssues) {
    const fp = extractFingerprint(issue.body)
    if (fp !== null) {
      openByFingerprint.set(fp, issue)
      continue
    }
    const fc = extractFailureClass(issue.body)
    if (fc !== null) openByFailureClass.set(fc, issue)
  }

  for (const issue of recentlyClosedIssues) {
    const fp = extractFingerprint(issue.body)
    if (fp !== null) {
      closedByFingerprint.set(fp, issue)
      continue
    }
    const fc = extractFailureClass(issue.body)
    if (fc !== null) closedByFailureClass.set(fc, issue)
  }

  const toOpen: IssueDraft[] = []
  const toUpdate: IssueUpdate[] = []
  const toReopen: ReopenAction[] = []
  const toClose: CloseAction[] = []

  // Track which fingerprints are active in this report
  const currentFingerprints = new Set<string>()

  // Deduplicate findings by fingerprint within the same report
  const seenFingerprintsInReport = new Set<string>()
  let duplicateCount = 0

  // Process deterministic findings only (advisory are ignored per spec)
  for (const finding of report.findings) {
    if (finding.severity !== 'deterministic') continue

    const {fingerprint} = finding

    // Deduplicate: skip if we've already processed this fingerprint in this report
    if (seenFingerprintsInReport.has(fingerprint)) {
      duplicateCount++
      continue
    }
    seenFingerprintsInReport.add(fingerprint)

    currentFingerprints.add(fingerprint)

    const openIssue = openByFingerprint.get(fingerprint)
    if (openIssue !== undefined) {
      // Already open — add recurrence comment
      toUpdate.push({
        issueNumber: openIssue.number,
        comment: buildRecurrenceComment(report.generated_at, report.snapshot_sha),
      })
      continue
    }

    const closedIssue = closedByFingerprint.get(fingerprint)
    if (closedIssue !== undefined) {
      // Was closed — reopen it
      toReopen.push({
        issueNumber: closedIssue.number,
        comment: buildRecurrenceComment(report.generated_at, report.snapshot_sha),
      })
      continue
    }

    // New finding — open an issue
    toOpen.push({
      title: `Wiki lint: ${finding.kind} in ${finding.path}`,
      body: buildFindingBody(
        fingerprint,
        finding.kind,
        finding.path,
        finding.message,
        report.generated_at,
        report.snapshot_sha,
      ),
      labels: ['wiki-lint', 'wiki-lint-finding'],
    })
  }

  if (duplicateCount > 0) {
    process.stderr.write(
      `wiki-lint-issues: skipped ${duplicateCount} duplicate findings (fingerprint collision in same report)\n`,
    )
  }

  // Process execution failure
  if (report.status === 'execution-failure' && report.failure_class !== null) {
    const fc = report.failure_class

    const openFailureIssue = openByFailureClass.get(fc)
    if (openFailureIssue === undefined) {
      const closedFailureIssue = closedByFailureClass.get(fc)
      if (closedFailureIssue === undefined) {
        toOpen.push({
          title: `Wiki lint failure: ${fc}`,
          body: buildFailureBody(fc, report.generated_at),
          labels: ['wiki-lint', 'wiki-lint-failure'],
        })
      } else {
        toReopen.push({
          issueNumber: closedFailureIssue.number,
          comment: buildRecurrenceComment(report.generated_at, report.snapshot_sha),
        })
      }
    } else {
      toUpdate.push({
        issueNumber: openFailureIssue.number,
        comment: buildRecurrenceComment(report.generated_at, report.snapshot_sha),
      })
    }
  }

  // Close-on-clear: only when scan was complete and not an execution failure
  const canClose = report.status !== 'execution-failure' && report.scan_complete

  if (canClose) {
    for (const [fp, issue] of openByFingerprint) {
      if (!currentFingerprints.has(fp)) {
        toClose.push({issueNumber: issue.number})
      }
    }

    // Close failure-class issues when scan completed without that failure class
    for (const [fc, issue] of openByFailureClass) {
      if (report.failure_class !== fc) {
        toClose.push({issueNumber: issue.number})
      }
    }
  }

  return {toOpen, toUpdate, toReopen, toClose}
}

// ---------------------------------------------------------------------------
// I/O shell
// ---------------------------------------------------------------------------

export async function syncWikiLintIssues(params: SyncParams): Promise<SyncResult> {
  const {octokit, owner, repo, plan} = params
  const counters = {opened: 0, updated: 0, reopened: 0, closed: 0, failed: 0}
  const errors: string[] = []

  // Open new issues
  for (const draft of plan.toOpen) {
    try {
      await octokit.rest.issues.create({owner, repo, title: draft.title, body: draft.body, labels: [...draft.labels]})
      counters.opened++
    } catch (error) {
      counters.failed++
      errors.push(`Failed to open issue "${draft.title}": ${String(error)}`)
    }
  }

  // Update existing open issues (add recurrence comment)
  for (const update of plan.toUpdate) {
    try {
      await octokit.rest.issues.createComment({owner, repo, issue_number: update.issueNumber, body: update.comment})
      counters.updated++
    } catch (error) {
      counters.failed++
      errors.push(`Failed to comment on issue #${update.issueNumber}: ${String(error)}`)
    }
  }

  // Reopen closed issues
  for (const reopen of plan.toReopen) {
    try {
      await octokit.rest.issues.update({owner, repo, issue_number: reopen.issueNumber, state: 'open'})
      await octokit.rest.issues.createComment({owner, repo, issue_number: reopen.issueNumber, body: reopen.comment})
      counters.reopened++
    } catch (error) {
      counters.failed++
      errors.push(`Failed to reopen issue #${reopen.issueNumber}: ${String(error)}`)
    }
  }

  // Close resolved issues
  for (const close of plan.toClose) {
    try {
      await octokit.rest.issues.update({owner, repo, issue_number: close.issueNumber, state: 'closed'})
      counters.closed++
    } catch (error) {
      counters.failed++
      errors.push(`Failed to close issue #${close.issueNumber}: ${String(error)}`)
    }
  }

  return {counters, errors}
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function loadOctokit(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is not set')
  return new Octokit({auth: token})
}

const KNOWN_SCHEMA_VERSION = 1
const KNOWN_FINGERPRINT_VERSION = 1

async function main(): Promise<void> {
  const jsonPath = process.env.WIKI_LINT_JSON_PATH ?? process.argv[2]
  if (jsonPath === undefined || jsonPath === '') {
    process.stderr.write('wiki-lint-issues: WIKI_LINT_JSON_PATH or first argument is required\n')
    process.exit(1)
  }

  let rawReport: unknown
  try {
    const raw = await readFile(jsonPath, 'utf8')
    rawReport = JSON.parse(raw)
  } catch (error) {
    process.stderr.write(`wiki-lint-issues: failed to read ${jsonPath}: ${String(error)}\n`)
    process.exit(1)
  }

  // Validate shape before any version checks or network calls
  validateWikiLintJsonReport(rawReport)

  const report = rawReport

  if (report.schema_version !== KNOWN_SCHEMA_VERSION) {
    process.stderr.write(
      `wiki-lint-issues: unknown schema_version ${report.schema_version}, expected ${KNOWN_SCHEMA_VERSION}\n`,
    )
    process.exit(1)
  }

  if (report.fingerprint_version !== KNOWN_FINGERPRINT_VERSION) {
    process.stderr.write(
      `wiki-lint-issues: unknown fingerprint_version ${report.fingerprint_version}, expected ${KNOWN_FINGERPRINT_VERSION}\n`,
    )
    process.exit(1)
  }

  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? 'fro-bot'
  const repo = (process.env.GITHUB_REPOSITORY ?? 'fro-bot/.github').split('/')[1] ?? '.github'

  const octokit = await loadOctokit()

  // Fetch open wiki-lint issues
  const openIssues: ExistingIssue[] = []
  const recentlyClosedIssues: ExistingIssue[] = []

  for await (const response of octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    labels: 'wiki-lint',
    state: 'open',
    per_page: 100,
  })) {
    for (const issue of response.data) {
      openIssues.push({number: issue.number, state: 'open', body: issue.body})
    }
  }

  // Fetch recently closed (last 100)
  const closedResponse = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: 'wiki-lint',
    state: 'closed',
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
  })
  for (const issue of closedResponse.data) {
    recentlyClosedIssues.push({number: issue.number, state: 'closed', body: issue.body})
  }

  const plan = planIssueLifecycle({report, openIssues, recentlyClosedIssues})
  const result = await syncWikiLintIssues({octokit, owner, repo, plan})

  // Write to GITHUB_STEP_SUMMARY
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath !== undefined && summaryPath !== '') {
    const table = [
      '## Wiki Lint Issue Sync',
      '',
      '| Action | Count |',
      '|--------|-------|',
      `| Opened | ${result.counters.opened} |`,
      `| Updated | ${result.counters.updated} |`,
      `| Reopened | ${result.counters.reopened} |`,
      `| Closed | ${result.counters.closed} |`,
      `| Failed | ${result.counters.failed} |`,
      '',
    ].join('\n')
    await appendFile(summaryPath, table)
  }

  // Write to GITHUB_OUTPUT
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    const lines = [
      `opened=${result.counters.opened}`,
      `updated=${result.counters.updated}`,
      `reopened=${result.counters.reopened}`,
      `closed=${result.counters.closed}`,
      `failed=${result.counters.failed}`,
      '',
    ].join('\n')
    await appendFile(outputPath, lines)
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      process.stderr.write(`wiki-lint-issues: ${error}\n`)
    }
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    process.stderr.write(`wiki-lint-issues: unhandled error: ${String(error)}\n`)
    process.exit(1)
  })
}
