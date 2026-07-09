/**
 * Agent proposal-body validation and deterministic pattern-proposal issue opener.
 *
 * The agent reads only the versioned candidate digest and writes a versioned temp
 * JSON body file keyed by fingerprint. It never calls GitHub, reads the corpus, or
 * receives private token data. This module validates that body file and, only after
 * every surface passes the shared public-output gate, opens at most three pattern
 * proposal issues.
 *
 * Architecture: pure planning core (`planPatternProposalOpens`) + I/O shell
 * (`openPatternProposalIssues`). The pure core is fully unit-testable with injected
 * inputs; the I/O shell performs Octokit calls only.
 *
 * Fail-soft vs. fail-closed:
 * - Per-candidate body validation errors (missing body, agent-skipped, invalid drafted
 *   body, privacy-gate block) fail soft: skip that candidate, count the reason, and
 *   continue with the rest.
 * - Systemic failures (token-load failure, label preflight failure) fail closed: no
 *   proposals are opened for the whole run.
 *
 * Privacy contract:
 * - `PublicOutputTokens` must come from a successful `makePublicOutputTokens` call
 *   built from both loaded private tokens and loaded redacted canonical IDs. A failed
 *   token load must be passed through as the `loaded:false` variant — never an empty
 *   Set proxy — so `applyPublicOutputGate` fails closed automatically.
 * - Every title/body surface is validated through `applyPublicOutputGate` before it
 *   is queued for posting. No surface bypasses the gate.
 * - stdout/stderr/result JSON/workflow summaries carry counts only: no body text,
 *   markers, fingerprints, source titles, source links, or raw errors.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {PatternCandidateDigest} from './capture-patterns-cluster.ts'
import {readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'
import {isRecord} from './capture-learnings-privacy.ts'
import {
  buildPatternProposalMarkers,
  PATTERN_PROPOSAL_LABEL,
  PATTERN_PROPOSAL_REQUIRED_LABELS,
  type ExistingPatternProposals,
} from './capture-patterns-synthesis.ts'
import {applyPublicOutputGate, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Octokit client type (derived, never handwritten)
// ---------------------------------------------------------------------------

export interface PatternProposalOpenOctokitClient {
  readonly rest: {
    readonly issues: {
      readonly getLabel: (params: {owner: string; repo: string; name: string}) => Promise<unknown>
      readonly createLabel: (params: {
        owner: string
        repo: string
        name: string
        color: string
        description: string
      }) => Promise<unknown>
      readonly create: (params: {
        owner: string
        repo: string
        title: string
        body: string
        labels: string[]
      }) => Promise<{data: {number: number}}>
    }
  }
}

// ---------------------------------------------------------------------------
// Body-file schema
// ---------------------------------------------------------------------------

export const PATTERN_PROPOSAL_BODY_FILE_SCHEMA_VERSION = 1

/** Closed vocabulary of agent-skipped reasons. */
export const AGENT_SKIPPED_REASONS = [
  'insufficient-evidence',
  'different-behaviors',
  'low-confidence',
  'duplicate-of-existing-proposal',
  'unsafe-evidence',
] as const

export type AgentSkippedReason = (typeof AGENT_SKIPPED_REASONS)[number]

/** A candidate the agent drafted a proposal body for. */
export interface DraftedPatternProposalBody {
  outcome: 'drafted'
  patternStatement: string
  rationale: string
  sourceReferences: string[]
  evidenceCount: number
  suggestedNextAction: string
}

/** A candidate the agent explicitly declined to draft, with a closed-vocabulary reason. */
export interface AgentSkippedPatternProposalBody {
  outcome: 'agent-skipped'
  reason: AgentSkippedReason
}

export type PatternProposalBody = DraftedPatternProposalBody | AgentSkippedPatternProposalBody

/** Versioned body file written by the agent, keyed by candidate fingerprint. */
export interface PatternProposalBodyFile {
  schemaVersion: number
  bodies: Record<string, unknown>
}

const DRAFTED_ALLOWED_FIELDS = new Set([
  'outcome',
  'patternStatement',
  'rationale',
  'sourceReferences',
  'evidenceCount',
  'suggestedNextAction',
])

const AGENT_SKIPPED_ALLOWED_FIELDS = new Set(['outcome', 'reason'])

export interface BodyValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Validate a single candidate body against the closed schema.
 *
 * Allowed drafted fields: pattern statement, rationale, public-safe source references,
 * evidence count, suggested next action. Any other field rejects the candidate.
 * Agent-skipped bodies must carry a closed-vocabulary reason. Unknown outcome values
 * or non-object input are rejected.
 *
 * Pure function: no I/O. Content-level privacy scanning happens separately via the
 * public-output gate — this only enforces schema shape.
 */
export function validatePatternProposalBody(input: unknown): BodyValidationResult {
  if (!isRecord(input)) {
    return {valid: false, reason: 'body is not an object'}
  }

  const outcome = input.outcome
  if (outcome === 'drafted') {
    const keys = Object.keys(input)
    for (const key of keys) {
      if (!DRAFTED_ALLOWED_FIELDS.has(key)) {
        return {valid: false, reason: `unapproved field: ${key}`}
      }
    }
    if (typeof input.patternStatement !== 'string' || input.patternStatement === '') {
      return {valid: false, reason: 'missing patternStatement'}
    }
    if (typeof input.rationale !== 'string' || input.rationale === '') {
      return {valid: false, reason: 'missing rationale'}
    }
    if (
      !Array.isArray(input.sourceReferences) ||
      !input.sourceReferences.every((r): r is string => typeof r === 'string')
    ) {
      return {valid: false, reason: 'missing or malformed sourceReferences'}
    }
    if (typeof input.evidenceCount !== 'number' || input.evidenceCount < 0) {
      return {valid: false, reason: 'missing or malformed evidenceCount'}
    }
    if (typeof input.suggestedNextAction !== 'string' || input.suggestedNextAction === '') {
      return {valid: false, reason: 'missing suggestedNextAction'}
    }
    return {valid: true}
  }

  if (outcome === 'agent-skipped') {
    const keys = Object.keys(input)
    for (const key of keys) {
      if (!AGENT_SKIPPED_ALLOWED_FIELDS.has(key)) {
        return {valid: false, reason: `unapproved field: ${key}`}
      }
    }
    const reason = input.reason
    if (typeof reason !== 'string' || !(AGENT_SKIPPED_REASONS as readonly string[]).includes(reason)) {
      return {valid: false, reason: 'unrecognized agent-skipped reason'}
    }
    return {valid: true}
  }

  return {valid: false, reason: 'unknown outcome'}
}

// ---------------------------------------------------------------------------
// Title/body rendering
// ---------------------------------------------------------------------------

/**
 * Derive a pattern-proposal issue title from the drafted pattern statement.
 * The title is still validated through the public-output gate before posting.
 */
export function derivePatternProposalTitle(body: DraftedPatternProposalBody): string {
  const normalized = body.patternStatement.replaceAll(/\s+/gu, ' ').trim()
  const maxStatementLength = 58
  const statement =
    normalized.length > maxStatementLength ? `${normalized.slice(0, maxStatementLength - 1).trimEnd()}…` : normalized
  return `Pattern proposal: ${statement}`
}

/**
 * Render the full pattern-proposal issue body: pattern statement, rationale,
 * public-safe source references, evidence count, suggested next action, followed
 * by hidden machine markers (fingerprint + sorted source IDs).
 */
export function renderPatternProposalIssueBody(params: {
  digest: PatternCandidateDigest
  body: DraftedPatternProposalBody
}): string {
  const {digest, body} = params
  const referencesList = body.sourceReferences.map(ref => `- ${ref}`).join('\n')
  const sections = [
    `## Pattern`,
    body.patternStatement,
    ``,
    `## Rationale`,
    body.rationale,
    ``,
    `## Source references`,
    referencesList,
    ``,
    `## Evidence count`,
    String(digest.evidenceCount),
    ``,
    `## Suggested next action`,
    body.suggestedNextAction,
    ``,
    buildPatternProposalMarkers({
      fingerprint: digest.fingerprint,
      sourceIds: digest.sourceIds,
      supersedes: digest.supersedes,
    }),
  ]
  return sections.join('\n')
}

// ---------------------------------------------------------------------------
// Pure planning core
// ---------------------------------------------------------------------------

/** A single pattern proposal ready to be created as a GitHub issue. */
export interface PatternProposalToOpen {
  fingerprint: string
  title: string
  body: string
}

/** Counts-only telemetry for the plan step. No prose, fingerprints, or titles. */
export interface PlanPatternProposalOpensCounts {
  candidatesExamined: number
  drafted: number
  agentSkipped: number
  missingBody: number
  invalidBody: number
  blockedOnPrivacy: number
  skippedDuplicateSameRun: number
  skippedDuplicateExisting: number
}

export interface PlanPatternProposalOpensResult {
  toCreate: PatternProposalToOpen[]
  counts: PlanPatternProposalOpensCounts
}

export interface PlanPatternProposalOpensInput {
  digestCandidates: PatternCandidateDigest[]
  bodyFile: PatternProposalBodyFile
  existing: ExistingPatternProposals
  publicOutputTokens: PublicOutputTokens
  /** Fingerprints already created earlier in this same run (same-run dedup guard). */
  alreadyCreatedFingerprints: Set<string>
}

function hasExistingProposal(existing: ExistingPatternProposals, fingerprint: string): boolean {
  const open = existing.openByFingerprint.get(fingerprint)
  const closed = existing.closedByFingerprint.get(fingerprint)
  return (open !== undefined && open.length > 0) || (closed !== undefined && closed.length > 0)
}

/**
 * Plan which pattern proposals to open from a validated digest + agent body file.
 *
 * Per-candidate order: missing body -> agent-skipped -> schema validation -> same-run
 * dedup -> existing-proposal dedup -> public-output gate (title, then body). Any
 * failure at a step counts that reason and skips only that candidate; remaining valid
 * candidates continue to be planned (fail soft).
 *
 * Pure function: no I/O, fully testable.
 */
export function planPatternProposalOpens(input: PlanPatternProposalOpensInput): PlanPatternProposalOpensResult {
  const counts: PlanPatternProposalOpensCounts = {
    candidatesExamined: input.digestCandidates.length,
    drafted: 0,
    agentSkipped: 0,
    missingBody: 0,
    invalidBody: 0,
    blockedOnPrivacy: 0,
    skippedDuplicateSameRun: 0,
    skippedDuplicateExisting: 0,
  }

  const toCreate: PatternProposalToOpen[] = []
  const createdThisPlan = new Set<string>(input.alreadyCreatedFingerprints)

  for (const digest of input.digestCandidates) {
    const rawBody = input.bodyFile.bodies[digest.fingerprint]

    if (rawBody === undefined) {
      counts.missingBody += 1
      continue
    }

    const validation = validatePatternProposalBody(rawBody)
    if (!validation.valid) {
      counts.invalidBody += 1
      continue
    }

    const body = rawBody as PatternProposalBody

    if (body.outcome === 'agent-skipped') {
      counts.agentSkipped += 1
      continue
    }

    if (input.alreadyCreatedFingerprints.has(digest.fingerprint) || createdThisPlan.has(digest.fingerprint)) {
      counts.skippedDuplicateSameRun += 1
      continue
    }

    if (hasExistingProposal(input.existing, digest.fingerprint)) {
      counts.skippedDuplicateExisting += 1
      continue
    }

    const title = derivePatternProposalTitle(body)
    const titleGate = applyPublicOutputGate({
      surface: 'proposal-title',
      content: title,
      tokens: input.publicOutputTokens,
      fingerprint: digest.fingerprint,
    })
    if (!titleGate.allowed) {
      counts.blockedOnPrivacy += 1
      continue
    }

    const renderedBody = renderPatternProposalIssueBody({digest, body})
    const bodyGate = applyPublicOutputGate({
      surface: 'proposal-body',
      content: renderedBody,
      tokens: input.publicOutputTokens,
      fingerprint: digest.fingerprint,
    })
    if (!bodyGate.allowed) {
      counts.blockedOnPrivacy += 1
      continue
    }

    createdThisPlan.add(digest.fingerprint)
    counts.drafted += 1
    toCreate.push({fingerprint: digest.fingerprint, title: titleGate.sanitizedContent, body: bodyGate.sanitizedContent})
  }

  return {toCreate, counts}
}

// ---------------------------------------------------------------------------
// Label preflight
// ---------------------------------------------------------------------------

function isApiStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

/**
 * Ensure the pattern-proposal labels exist in the repo, mirroring
 * `capture-learnings-open.ts`'s `ensureLabelsExist`. Returns the set of confirmed
 * label names; failures are logged counts-only and excluded from the set.
 */
type PatternLogSink = (message: string) => void

const writePatternOpenLog: PatternLogSink = message => process.stderr.write(message)

export async function ensurePatternProposalLabelsExist(
  octokit: PatternProposalOpenOctokitClient,
  owner: string,
  repo: string,
  labels: readonly {name: string; color: string; description: string}[],
  writeLog: PatternLogSink = writePatternOpenLog,
): Promise<Set<string>> {
  const confirmed = new Set<string>()

  for (const {name, color, description} of labels) {
    try {
      await octokit.rest.issues.getLabel({owner, repo, name})
      confirmed.add(name)
      continue
    } catch (getError: unknown) {
      if (!isApiStatus(getError, 404)) {
        writeLog(`capture-patterns-open: label check failed; excluding from issue labels\n`)
        continue
      }
    }

    try {
      await octokit.rest.issues.createLabel({owner, repo, name, color, description})
      confirmed.add(name)
    } catch (createError: unknown) {
      if (isApiStatus(createError, 422)) {
        confirmed.add(name)
      } else {
        writeLog(`capture-patterns-open: label creation failed; excluding from issue labels\n`)
      }
    }
  }

  return confirmed
}

// ---------------------------------------------------------------------------
// I/O shell: openPatternProposalIssues
// ---------------------------------------------------------------------------

const MAX_PROPOSALS_PER_RUN = 3

export interface OpenPatternProposalIssuesResult {
  opened: number
  failed: number
  skippedLabelUnavailable: number
  skippedOverCap: number
}

/**
 * Open GitHub issues for the planned pattern proposals.
 *
 * Steps:
 * 1. No-op immediately if `toCreate` is empty (no label preflight call).
 * 2. Label preflight: `ensurePatternProposalLabelsExist` for all required labels.
 *    Fail-closed: every required label (not just the primary `pattern-proposal`
 *    label) must be confirmed available or created before any issue is opened —
 *    a newly opened proposal must never lack a terminal-outcome label it will need
 *    later. Any unconfirmed required label skips all opens for this run.
 * 3. Cap to at most `MAX_PROPOSALS_PER_RUN` issues.
 * 4. Create each remaining issue; one failure does not abort the rest.
 *
 * Returns counts-only telemetry. No fingerprints, titles, or body text in output.
 */
export async function openPatternProposalIssues(
  octokit: PatternProposalOpenOctokitClient,
  owner: string,
  repo: string,
  toCreate: PatternProposalToOpen[],
  writeLog: PatternLogSink = writePatternOpenLog,
): Promise<OpenPatternProposalIssuesResult> {
  if (toCreate.length === 0) {
    return {opened: 0, failed: 0, skippedLabelUnavailable: 0, skippedOverCap: 0}
  }

  const confirmedLabels = await ensurePatternProposalLabelsExist(
    octokit,
    owner,
    repo,
    PATTERN_PROPOSAL_REQUIRED_LABELS,
    writeLog,
  )

  // Fail closed unless every required label (primary + all outcome labels) is
  // confirmed — a newly opened proposal must never be missing a label it will need
  // for its eventual terminal outcome.
  const allRequiredLabelsConfirmed = PATTERN_PROPOSAL_REQUIRED_LABELS.every(({name}) => confirmedLabels.has(name))
  if (!allRequiredLabelsConfirmed) {
    writeLog(`capture-patterns-open: required label(s) unavailable; skipping ${toCreate.length} proposal(s)\n`)
    return {opened: 0, failed: 0, skippedLabelUnavailable: toCreate.length, skippedOverCap: 0}
  }

  const capped = toCreate.slice(0, MAX_PROPOSALS_PER_RUN)
  const skippedOverCap = Math.max(0, toCreate.length - capped.length)

  let opened = 0
  let failed = 0

  for (const item of capped) {
    try {
      await octokit.rest.issues.create({
        owner,
        repo,
        title: item.title,
        body: item.body,
        labels: [PATTERN_PROPOSAL_LABEL],
      })
      opened += 1
    } catch {
      failed += 1
      writeLog(`capture-patterns-open: issue creation failed; continuing\n`)
    }
  }

  writeLog(`capture-patterns-open: proposals opened=${opened} failed=${failed}\n`)

  return {opened, failed, skippedLabelUnavailable: 0, skippedOverCap}
}

// ---------------------------------------------------------------------------
// Entry point (deterministic open step reads digest + agent body file)
// ---------------------------------------------------------------------------

/** Counts-only result written to stdout and CAPTURE_PATTERNS_RESULT_PATH. */
interface PatternProposalOpenResult {
  candidatesExamined: number
  drafted: number
  agentSkipped: number
  missingBody: number
  invalidBody: number
  blockedOnPrivacy: number
  skippedDuplicateSameRun: number
  skippedDuplicateExisting: number
  proposalsOpened: number
  failed: number
  skippedLabelUnavailable: number
  skippedOverCap: number
  tokenLoadFailed: boolean
  bodyFileReadFailed: boolean
}

async function readJsonFile<T>(path: string, label: string): Promise<T> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    throw new Error(`capture-patterns-open: could not read ${label} at ${path}`, {cause: error})
  }
  try {
    return JSON.parse(raw) as T
  } catch (error: unknown) {
    throw new Error(`capture-patterns-open: could not parse ${label} at ${path}`, {cause: error})
  }
}

async function main(): Promise<void> {
  // Detect is fail-soft because absence of candidates is safe signal. Open is
  // intentionally fail-hard on malformed inputs or missing credentials: after the
  // live gate, ambiguity must stop before any issue mutation.
  const {loadPrivateTokensFromDisk} = await import('./capture-learnings-privacy.ts')
  const {loadRedactedCanonicalIdsFromDisk} = await import('./status-truth-proposals.ts')
  const {makePublicOutputTokens} = await import('./status-truth-public-output.ts')
  const {fetchExistingPatternProposals} = await import('./capture-patterns-synthesis.ts')
  const {createOctokitFromEnv} = await import('./capture-learnings-harvest.ts')

  const digestPath = process.env.CAPTURE_PATTERNS_DIGEST_PATH
  const bodiesPath = process.env.CAPTURE_PATTERNS_BODIES_PATH
  const resultPath = process.env.CAPTURE_PATTERNS_RESULT_PATH

  if (digestPath === undefined || digestPath === '') {
    throw new Error('capture-patterns-open: CAPTURE_PATTERNS_DIGEST_PATH is required')
  }
  if (bodiesPath === undefined || bodiesPath === '') {
    throw new Error('capture-patterns-open: CAPTURE_PATTERNS_BODIES_PATH is required')
  }

  const digestCandidates = await readJsonFile<PatternCandidateDigest[]>(digestPath, 'candidate digest')

  let bodyFile: PatternProposalBodyFile
  let tokenLoadFailed = false
  let bodyFileReadFailed = false
  let publicOutputTokens: PublicOutputTokens

  const owner = 'fro-bot'
  const repo = '.github'
  try {
    bodyFile = await readJsonFile<PatternProposalBodyFile>(bodiesPath, 'agent body file')
  } catch {
    bodyFileReadFailed = true
    bodyFile = {schemaVersion: PATTERN_PROPOSAL_BODY_FILE_SCHEMA_VERSION, bodies: {}}
  }

  try {
    const [privateTokens, redactedCanonicalIds] = await Promise.all([
      loadPrivateTokensFromDisk(),
      loadRedactedCanonicalIdsFromDisk(),
    ])
    publicOutputTokens = makePublicOutputTokens({privateTokens, redactedCanonicalIds})
  } catch {
    tokenLoadFailed = true
    publicOutputTokens = {loaded: false, error: 'token load failed'}
  }

  const octokit = await createOctokitFromEnv()
  const existing = tokenLoadFailed
    ? {openByFingerprint: new Map(), closedByFingerprint: new Map(), invalidMarkerCount: 0}
    : await fetchExistingPatternProposals({
        octokit: octokit as unknown as Parameters<typeof fetchExistingPatternProposals>[0]['octokit'],
        owner,
        repo,
      })

  const plan = planPatternProposalOpens({
    digestCandidates: tokenLoadFailed || bodyFileReadFailed ? [] : digestCandidates,
    bodyFile,
    existing,
    publicOutputTokens,
    alreadyCreatedFingerprints: new Set(),
  })

  const openResult = await openPatternProposalIssues(
    octokit as unknown as PatternProposalOpenOctokitClient,
    owner,
    repo,
    plan.toCreate,
  )

  const result: PatternProposalOpenResult = {
    candidatesExamined: plan.counts.candidatesExamined,
    drafted: plan.counts.drafted,
    agentSkipped: plan.counts.agentSkipped,
    missingBody: plan.counts.missingBody,
    invalidBody: plan.counts.invalidBody,
    blockedOnPrivacy: plan.counts.blockedOnPrivacy,
    skippedDuplicateSameRun: plan.counts.skippedDuplicateSameRun,
    skippedDuplicateExisting: plan.counts.skippedDuplicateExisting,
    proposalsOpened: openResult.opened,
    failed: openResult.failed,
    skippedLabelUnavailable: openResult.skippedLabelUnavailable,
    skippedOverCap: openResult.skippedOverCap,
    tokenLoadFailed,
    bodyFileReadFailed,
  }

  const resultJson = `${JSON.stringify(result)}\n`
  process.stdout.write(resultJson)

  if (resultPath !== undefined && resultPath !== '') {
    try {
      await writeFile(resultPath, resultJson, {flag: 'w'})
    } catch {
      process.stderr.write(`capture-patterns-open: could not write result file\n`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
