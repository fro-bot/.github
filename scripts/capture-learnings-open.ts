/**
 * Opens learning-proposal issues from harvested candidate pull requests.
 *
 * Given a set of candidates (from the harvest digest) and agent-authored proposal bodies,
 * opens `learning-proposal` issues — but only after each body passes a fail-closed
 * private-identifier scan, with same-run in-memory dedup.
 *
 * Architecture: pure planning core (`planLearnings`) + I/O shell (`openLearningIssues`).
 * The pure core is fully unit-testable with injected inputs.
 * The I/O shell does Octokit calls and disk reads.
 *
 * Fail-closed privacy contract:
 * - If `loadPrivateTokensFromDisk` throws or returns an error sentinel, the caller
 *   MUST NOT post any proposals (no private set loaded ⇒ no proposals posted).
 * - The privacy gate blocks on a hit; it never redacts. Counts-only telemetry.
 * - Private names are never logged; only counts appear in output.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'
import {parse} from 'yaml'

import {
  buildMergeShaMarker,
  createOctokitFromEnv,
  LEARNING_PROPOSAL_LABEL,
  type Candidate,
  type CandidateDigest,
  type OctokitClient,
} from './capture-learnings-harvest.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the pure planning core. */
export interface PlanLearningsInput {
  /** Candidates from the harvest digest. */
  candidates: Candidate[]
  /**
   * Agent-authored proposal body per mergeSha.
   * Candidates with no entry in this map are skipped.
   */
  learningBodies: Map<string, string>
  /** Private identifier tokens for the privacy gate. */
  privateTokens: Set<string>
  /**
   * merge_shas already created this run (same-run dedup guard).
   * Populated by the caller from prior openLearningIssues calls or from
   * the cross-run seen-set built by fetchOpenedLearningShas.
   */
  alreadyCreatedShas: Set<string>
}

/** A single learning ready to be created as a GitHub issue. */
export interface LearningToOpen {
  mergeSha: string
  /** Body with the merge-SHA marker already appended. */
  body: string
}

/** Result of the pure planning core. */
export interface PlanLearningsResult {
  toCreate: LearningToOpen[]
  /** Number of learnings blocked by the privacy gate. */
  blockedOnPrivacy: number
  /** Number of learnings skipped because the mergeSha was already created. */
  skippedDuplicate: number
}

/** Label descriptor for ensureLabelsExist. */
export interface LabelDescriptor {
  name: string
  color: string
  description: string
}

/** Counts returned by openLearningIssues. */
export interface OpenLearningsCounts {
  created: number
  failed: number
  blockedOnPrivacy: number
  skippedDuplicate: number
  skippedLabelUnavailable: number
}

// ---------------------------------------------------------------------------
// Privacy gate — pure, fail-closed
// ---------------------------------------------------------------------------

/**
 * Returns true if the learning body contains any private identifier token.
 *
 * The body is lowercased before scanning. The caller MUST block (skip) the
 * learning on true. Never redacts — block only. Counts-only telemetry.
 *
 * Pure function: no I/O, fully testable.
 */
export function learningBodyHasPrivateLeak(body: string, privateTokens: Set<string>): boolean {
  const lower = body.toLowerCase()
  for (const token of privateTokens) {
    if (lower.includes(token)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApiStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

// ---------------------------------------------------------------------------
// Disk loader for private token set
// ---------------------------------------------------------------------------

/**
 * Load the private identifier token set from `metadata/repos.yaml`.
 *
 * Reads the overlay-checked-out metadata file, filters `private: true` non-redacted
 * entries, and builds the token set via `buildPrivateNameTokens`.
 *
 * Fail-closed contract:
 * - If the file cannot be read or parsed, this function THROWS.
 * - The caller MUST NOT post any proposals when this throws (no private set ⇒ no proposals).
 * - This is intentional: a missing overlay means the privacy gate cannot operate,
 *   and posting unscanned proposals would violate the privacy-gate contract.
 *
 * Counts-only: private names are never logged; only counts appear in stderr.
 *
 * @param readFileFn - Injectable readFile for testing (defaults to node:fs/promises readFile).
 */
export async function loadPrivateTokensFromDisk(
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<Set<string>> {
  let reposYaml: string

  try {
    reposYaml = await readFileFn('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    throw new Error(
      'capture-learnings-open: could not read metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
      {cause: error},
    )
  }

  let parsed: unknown
  try {
    parsed = parse(reposYaml)
  } catch (error: unknown) {
    throw new Error(
      'capture-learnings-open: could not parse metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
      {cause: error},
    )
  }

  if (!isRecord(parsed)) {
    throw new TypeError(
      'capture-learnings-open: metadata/repos.yaml has unexpected shape — privacy gate cannot operate; no learnings will be posted',
    )
  }

  const repos = parsed.repos
  if (!Array.isArray(repos)) {
    throw new TypeError(
      'capture-learnings-open: metadata/repos.yaml missing repos array — privacy gate cannot operate; no learnings will be posted',
    )
  }

  const privateNames: string[] = []
  for (const entry of repos) {
    if (!isRecord(entry)) continue
    if (entry.private !== true) continue
    const owner = entry.owner
    const name = entry.name
    if (typeof owner !== 'string' || typeof name !== 'string' || owner === '[REDACTED]' || name === '[REDACTED]') {
      continue
    }
    privateNames.push(`${owner}/${name}`)
  }

  const tokenSet = buildPrivateTokenSet(privateNames)
  process.stderr.write(
    `capture-learnings-open: loaded private token set (private-repo count=${privateNames.length}, token-count=${tokenSet.size})\n`,
  )
  return tokenSet
}

// ---------------------------------------------------------------------------
// Pure planning core
// ---------------------------------------------------------------------------

/**
 * Plan which learnings to create, applying the privacy gate and same-run dedup.
 *
 * For each candidate:
 * 1. Skip if no agent-authored body is available.
 * 2. Skip if the mergeSha is already in alreadyCreatedShas (same-run dedup).
 * 3. Skip if the body contains a private token (privacy gate).
 * 4. Otherwise: append the merge-SHA marker to the body and add to toCreate.
 *
 * Pure function: no I/O, fully testable.
 */
export function planLearnings(input: PlanLearningsInput): PlanLearningsResult {
  const toCreate: LearningToOpen[] = []
  let blockedOnPrivacy = 0
  let skippedDuplicate = 0

  for (const candidate of input.candidates) {
    const body = input.learningBodies.get(candidate.mergeSha)

    // Skip candidates with no agent-authored body
    if (body === undefined || body === '') {
      continue
    }

    // Same-run dedup: skip if already created this run
    if (input.alreadyCreatedShas.has(candidate.mergeSha)) {
      skippedDuplicate += 1
      continue
    }

    // Privacy gate: block if body contains a private identifier
    if (learningBodyHasPrivateLeak(body, input.privateTokens)) {
      blockedOnPrivacy += 1
      continue
    }

    // Append the immutable merge-SHA marker to the body
    const bodyWithMarker = `${body}\n\n${buildMergeShaMarker(candidate.mergeSha)}`
    toCreate.push({mergeSha: candidate.mergeSha, body: bodyWithMarker})
  }

  return {toCreate, blockedOnPrivacy, skippedDuplicate}
}

// ---------------------------------------------------------------------------
// Label preflight (mirrors reconcile-repos.ts ensureLabelsExist)
// ---------------------------------------------------------------------------

/**
 * Ensure a set of labels exist in the repo. For each label:
 * - If it exists (getLabel succeeds): confirmed.
 * - If 404: attempt createLabel.
 *   - createLabel succeeds or 422 (race — already created): confirmed.
 *   - createLabel other failure: excluded from returned set (log and continue).
 * - getLabel non-404 failure: excluded from returned set (log and continue).
 *
 * Returns a Set<string> of confirmed-usable label names. The caller MUST filter
 * the issue payload to only these labels before calling issues.create.
 */
export async function ensureLabelsExist(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  labels: readonly LabelDescriptor[],
): Promise<Set<string>> {
  const confirmed = new Set<string>()

  for (const {name, color, description} of labels) {
    try {
      await octokit.rest.issues.getLabel({owner, repo, name})
      confirmed.add(name)
      continue
    } catch (getError: unknown) {
      if (!isApiStatus(getError, 404)) {
        const status = isRecord(getError) && typeof getError.status === 'number' ? getError.status : 'unknown'
        process.stderr.write(
          `capture-learnings-open: label check failed for "${name}" (status=${status}); excluding from issue labels\n`,
        )
        continue
      }
    }

    // Label not found (404) — create it
    try {
      await octokit.rest.issues.createLabel({owner, repo, name, color, description})
      confirmed.add(name)
    } catch (createError: unknown) {
      if (isApiStatus(createError, 422)) {
        // Race with another writer — label now exists; include it
        confirmed.add(name)
      } else {
        const status = isRecord(createError) && typeof createError.status === 'number' ? createError.status : 'unknown'
        process.stderr.write(
          `capture-learnings-open: label creation failed for "${name}" (status=${status}); excluding from issue labels\n`,
        )
      }
    }
  }

  return confirmed
}

// ---------------------------------------------------------------------------
// Issue title derivation
// ---------------------------------------------------------------------------

/**
 * Derive a learning issue title from a mergeSha.
 * Uses only the merge SHA (public, safe for this public repo) — no owner/repo/number prose.
 * Short SHA = first 8 chars.
 */
function deriveLearningTitle(mergeSha: string): string {
  const shortSha = mergeSha.slice(0, 8)
  return `Learning proposal: review-heavy PR (${shortSha})`
}

// ---------------------------------------------------------------------------
// I/O shell: openLearningIssues
// ---------------------------------------------------------------------------

const LEARNING_PROPOSAL_LABEL_DESCRIPTOR: LabelDescriptor = {
  name: LEARNING_PROPOSAL_LABEL,
  // Color matches .github/settings.yml (hex without '#', as GitHub createLabel requires)
  color: '0e8a16',
  description: 'Candidate learning proposed from a multi-round-review PR',
}

/**
 * Open GitHub issues for the planned learnings.
 *
 * Steps:
 * 1. Label preflight: ensureLabelsExist([LEARNING_PROPOSAL_LABEL]).
 * 2. For each toCreate item:
 *    a. Same-run Set guard: skip if mergeSha already created this invocation.
 *    b. issues.create with confirmed labels + body (which already contains the marker).
 *    c. On success: add mergeSha to the in-memory Set.
 *    d. On failure: log counts-only, continue (one failure does not abort the rest).
 *
 * Returns counts-only telemetry. No private names in any output.
 */
export async function openLearningIssues(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  toCreate: LearningToOpen[],
): Promise<{created: number; failed: number; skippedLabelUnavailable: number}> {
  if (toCreate.length === 0) {
    return {created: 0, failed: 0, skippedLabelUnavailable: 0}
  }

  // Label preflight
  const confirmedLabels = await ensureLabelsExist(octokit, owner, repo, [LEARNING_PROPOSAL_LABEL_DESCRIPTOR])

  // Fail-closed on labeling: if the required label is not confirmed, skip ALL learnings.
  // An unlabeled learning is invisible to the seen-set query (which filters by label)
  // and would be re-proposed forever — worse than skipping.
  if (!confirmedLabels.has(LEARNING_PROPOSAL_LABEL)) {
    process.stderr.write(
      `capture-learnings-open: label "${LEARNING_PROPOSAL_LABEL}" unavailable; skipping ${toCreate.length} learning(s) (label-unavailable)\n`,
    )
    return {created: 0, failed: 0, skippedLabelUnavailable: toCreate.length}
  }

  // Same-run in-memory Set (guards eventual-consistency race)
  const createdThisRun = new Set<string>()

  let created = 0
  let failed = 0

  for (const item of toCreate) {
    // Same-run Set guard: skip if this mergeSha was already created in this invocation
    if (createdThisRun.has(item.mergeSha)) {
      process.stderr.write(
        `capture-learnings-open: same-run duplicate skipped (sha-prefix=${item.mergeSha.slice(0, 8)})\n`,
      )
      continue
    }

    const title = deriveLearningTitle(item.mergeSha)

    try {
      await octokit.rest.issues.create({
        owner,
        repo,
        title,
        body: item.body,
        labels: [LEARNING_PROPOSAL_LABEL],
      } as unknown as Parameters<OctokitClient['rest']['issues']['create']>[0])

      // Mark as created only after the API call succeeds
      createdThisRun.add(item.mergeSha)
      created += 1
    } catch (error: unknown) {
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      process.stderr.write(`capture-learnings-open: issue creation failed (status=${status}); continuing\n`)
    }
  }

  process.stderr.write(`capture-learnings-open: learnings created=${created} failed=${failed}\n`)

  return {created, failed, skippedLabelUnavailable: 0}
}

// ---------------------------------------------------------------------------
// Entry point (deterministic open step reads digest + agent bodies)
// ---------------------------------------------------------------------------

/**
 * CLI entry point for the deterministic open step.
 *
 * Handoff contract:
 * - Reads the harvest digest from the path in CAPTURE_LEARNINGS_DIGEST_PATH env var
 *   (a JSON file containing a CandidateDigest written by the harvest step).
 * - Reads agent-authored proposal bodies from the path in CAPTURE_LEARNINGS_BODIES_PATH
 *   env var (a JSON file: Record<mergeSha, bodyText> written by the agent step).
 * - Loads the private token set from metadata/repos.yaml (fail-closed: throws if
 *   the file cannot be read or parsed — no proposals posted without the privacy gate).
 * - Calls planLearnings (privacy gate + same-run dedup) then openLearningIssues.
 * - Writes a counts-only JSON result to CAPTURE_LEARNINGS_RESULT_PATH (if set) and stdout.
 *
 * Privacy guarantee: the agent never receives owner/repo/number prose (the digest
 * carries only merge_sha + signals). The privacy gate runs here, deterministically,
 * not at agent discretion. A missing or unreadable metadata/repos.yaml is fatal.
 *
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

/** Counts-only result written to stdout and CAPTURE_LEARNINGS_RESULT_PATH. */
interface OpenResult {
  examined: number
  candidatesAfterDedup: number
  learningsOpened: number
  blockedOnPrivacy: number
  skippedDuplicate: number
  skippedLabelUnavailable: number
  failed: number
}

async function readJsonFile<T>(path: string, label: string): Promise<T> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    throw new Error(`capture-learnings-open: could not read ${label} at ${path}`, {cause: error})
  }
  try {
    return JSON.parse(raw) as T
  } catch (error: unknown) {
    throw new Error(`capture-learnings-open: could not parse ${label} at ${path}`, {cause: error})
  }
}

async function main(): Promise<void> {
  const digestPath = process.env.CAPTURE_LEARNINGS_DIGEST_PATH
  const bodiesPath = process.env.CAPTURE_LEARNINGS_BODIES_PATH
  const resultPath = process.env.CAPTURE_LEARNINGS_RESULT_PATH

  if (digestPath === undefined || digestPath === '') {
    throw new Error('capture-learnings-open: CAPTURE_LEARNINGS_DIGEST_PATH is required')
  }
  if (bodiesPath === undefined || bodiesPath === '') {
    throw new Error('capture-learnings-open: CAPTURE_LEARNINGS_BODIES_PATH is required')
  }

  // Read the harvest digest (written by the harvest step)
  const digest = await readJsonFile<CandidateDigest>(digestPath, 'harvest digest')

  // Read agent-authored bodies (written by the agent step): Record<mergeSha, bodyText>
  const bodiesRecord = await readJsonFile<Record<string, string>>(bodiesPath, 'agent bodies')
  const learningBodies = new Map<string, string>(Object.entries(bodiesRecord))

  // Fail-closed: load private tokens — throws if metadata/repos.yaml is unreadable
  const privateTokens = await loadPrivateTokensFromDisk()

  const octokit = await createOctokitFromEnv()
  const owner = 'fro-bot'
  const repo = '.github'

  // Plan learnings: privacy gate + same-run dedup
  const plan = planLearnings({
    candidates: digest.candidates,
    learningBodies,
    privateTokens,
    alreadyCreatedShas: new Set<string>(),
  })

  // Open the planned learning issues
  const {created, failed, skippedLabelUnavailable} = await openLearningIssues(octokit, owner, repo, plan.toCreate)

  const result: OpenResult = {
    examined: digest.telemetry.multiRoundCandidates,
    // The count actually fed into planning — digest.candidates is already capped to
    // MAX_LEARNINGS_PER_RUN, so this reflects what was processed, not the pre-cap total.
    candidatesAfterDedup: digest.candidates.length,
    learningsOpened: created,
    blockedOnPrivacy: plan.blockedOnPrivacy,
    skippedDuplicate: plan.skippedDuplicate,
    skippedLabelUnavailable,
    failed,
  }

  const resultJson = `${JSON.stringify(result)}\n`
  process.stdout.write(resultJson)

  if (resultPath !== undefined && resultPath !== '') {
    try {
      await writeFile(resultPath, resultJson, {flag: 'w'})
    } catch (error: unknown) {
      process.stderr.write(`capture-learnings-open: could not write result to ${resultPath}: ${String(error)}\n`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
