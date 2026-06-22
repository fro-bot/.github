/**
 * Proposal-issue opening for the C1 learning-capture pipeline.
 *
 * Given a set of candidates (from the harvest digest) and agent-authored proposal bodies,
 * opens `learning-proposal` issues — but only after each body passes a fail-closed
 * private-identifier scan, with same-run in-memory dedup.
 *
 * Architecture: pure planning core (`planProposals`) + I/O shell (`createProposals`).
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

import {readFile} from 'node:fs/promises'
import process from 'node:process'
import {parse} from 'yaml'

import {buildMergeShaMarker, LEARNING_PROPOSAL_LABEL, type Candidate, type OctokitClient} from './capture-c1-harvest.ts'
import {buildPrivateNameTokens} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the pure planning core. */
export interface PlanProposalsInput {
  /** Candidates from the harvest digest. */
  candidates: Candidate[]
  /**
   * Agent-authored proposal body per mergeSha.
   * Candidates with no entry in this map are skipped.
   */
  proposalBodies: Map<string, string>
  /** Private identifier tokens for the privacy gate (R4). */
  privateTokens: Set<string>
  /**
   * merge_shas already created this run (same-run dedup guard, R3).
   * Populated by the caller from prior createProposals calls or from
   * the cross-run seen-set built by fetchProposedMergeShas.
   */
  alreadyCreatedShas: Set<string>
}

/** A single proposal ready to be created as a GitHub issue. */
export interface ProposalToCreate {
  mergeSha: string
  /** Body with the merge-SHA marker already appended. */
  body: string
}

/** Result of the pure planning core. */
export interface PlanProposalsResult {
  toCreate: ProposalToCreate[]
  /** Number of proposals blocked by the privacy gate (R4). */
  blockedOnPrivacy: number
  /** Number of proposals skipped because the mergeSha was already created. */
  skippedDuplicate: number
}

/** Label descriptor for ensureLabelsExist. */
export interface LabelDescriptor {
  name: string
  color: string
  description: string
}

/** Counts returned by createProposals. */
export interface CreateProposalsCounts {
  created: number
  failed: number
  blockedOnPrivacy: number
  skippedDuplicate: number
}

// ---------------------------------------------------------------------------
// Privacy gate (R4) — pure, fail-closed
// ---------------------------------------------------------------------------

/**
 * Returns true if the proposal body contains any private identifier token.
 *
 * The body is lowercased before scanning. The caller MUST block (skip) the
 * proposal on true. Never redacts — block only. Counts-only telemetry.
 *
 * Pure function: no I/O, fully testable.
 */
export function proposalBodyHasPrivateLeak(body: string, privateTokens: Set<string>): boolean {
  const lower = body.toLowerCase()
  for (const token of privateTokens) {
    if (lower.includes(token)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Private token set builder (mirrors solutions-query.ts buildPrivateTokenSet)
// ---------------------------------------------------------------------------

/**
 * Build a flat set of private identifier tokens from a list of `owner/name` strings.
 * Tokens: [owner/name, owner--name, computeRepoSlug(owner, name)] — lowercased.
 * Entries with `[REDACTED]` owner or name are skipped.
 */
function buildPrivateTokenSet(privateNames: string[]): Set<string> {
  const tokens = new Set<string>()
  for (const nameWithOwner of privateNames) {
    const slashIndex = nameWithOwner.indexOf('/')
    if (slashIndex < 1) continue
    const owner = nameWithOwner.slice(0, slashIndex)
    const name = nameWithOwner.slice(slashIndex + 1)
    if (owner === '[REDACTED]' || name === '[REDACTED]') continue
    for (const token of buildPrivateNameTokens(nameWithOwner)) {
      tokens.add(token.toLowerCase())
    }
  }
  return tokens
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
 *   and posting unscanned proposals would violate R4.
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
      'capture-c1-propose: could not read metadata/repos.yaml — privacy gate cannot operate; no proposals will be posted',
      {cause: error},
    )
  }

  let parsed: unknown
  try {
    parsed = parse(reposYaml)
  } catch (error: unknown) {
    throw new Error(
      'capture-c1-propose: could not parse metadata/repos.yaml — privacy gate cannot operate; no proposals will be posted',
      {cause: error},
    )
  }

  if (!isRecord(parsed)) {
    throw new TypeError(
      'capture-c1-propose: metadata/repos.yaml has unexpected shape — privacy gate cannot operate; no proposals will be posted',
    )
  }

  const repos = parsed.repos
  if (!Array.isArray(repos)) {
    throw new TypeError(
      'capture-c1-propose: metadata/repos.yaml missing repos array — privacy gate cannot operate; no proposals will be posted',
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
    `capture-c1-propose: loaded private token set (private-repo count=${privateNames.length}, token-count=${tokenSet.size})\n`,
  )
  return tokenSet
}

// ---------------------------------------------------------------------------
// Pure planning core
// ---------------------------------------------------------------------------

/**
 * Plan which proposals to create, applying the privacy gate and same-run dedup.
 *
 * For each candidate:
 * 1. Skip if no agent-authored body is available.
 * 2. Skip if the mergeSha is already in alreadyCreatedShas (same-run dedup, R3).
 * 3. Skip if the body contains a private token (privacy gate, R4).
 * 4. Otherwise: append the merge-SHA marker to the body and add to toCreate.
 *
 * Pure function: no I/O, fully testable.
 */
export function planProposals(input: PlanProposalsInput): PlanProposalsResult {
  const toCreate: ProposalToCreate[] = []
  let blockedOnPrivacy = 0
  let skippedDuplicate = 0

  for (const candidate of input.candidates) {
    const body = input.proposalBodies.get(candidate.mergeSha)

    // Skip candidates with no agent-authored body
    if (body === undefined || body === '') {
      continue
    }

    // Same-run dedup (R3): skip if already created this run
    if (input.alreadyCreatedShas.has(candidate.mergeSha)) {
      skippedDuplicate += 1
      continue
    }

    // Privacy gate (R4): block if body contains a private identifier
    if (proposalBodyHasPrivateLeak(body, input.privateTokens)) {
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
          `capture-c1-propose: label check failed for "${name}" (status=${status}); excluding from issue labels\n`,
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
          `capture-c1-propose: label creation failed for "${name}" (status=${status}); excluding from issue labels\n`,
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
 * Derive a proposal issue title from a mergeSha.
 * Uses only the merge SHA (public, safe for this public repo) — no owner/repo/number prose.
 * Short SHA = first 8 chars.
 */
function deriveProposalTitle(mergeSha: string): string {
  const shortSha = mergeSha.slice(0, 8)
  return `Learning proposal: review-heavy PR (${shortSha})`
}

// ---------------------------------------------------------------------------
// I/O shell: createProposals
// ---------------------------------------------------------------------------

const LEARNING_PROPOSAL_LABEL_DESCRIPTOR: LabelDescriptor = {
  name: LEARNING_PROPOSAL_LABEL,
  color: '0075ca',
  description: 'Candidate learning from a multi-round-review PR',
}

/**
 * Open GitHub issues for the planned proposals.
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
export async function createProposals(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  toCreate: ProposalToCreate[],
): Promise<{created: number; failed: number}> {
  if (toCreate.length === 0) {
    return {created: 0, failed: 0}
  }

  // Label preflight
  const confirmedLabels = await ensureLabelsExist(octokit, owner, repo, [LEARNING_PROPOSAL_LABEL_DESCRIPTOR])

  // Same-run in-memory Set (guards eventual-consistency race, R3)
  const createdThisRun = new Set<string>()

  let created = 0
  let failed = 0

  for (const item of toCreate) {
    // Same-run Set guard: skip if this mergeSha was already created in this invocation
    if (createdThisRun.has(item.mergeSha)) {
      process.stderr.write(`capture-c1-propose: same-run duplicate skipped (sha-prefix=${item.mergeSha.slice(0, 8)})\n`)
      continue
    }

    const title = deriveProposalTitle(item.mergeSha)
    const labels = [LEARNING_PROPOSAL_LABEL].filter(l => confirmedLabels.has(l))

    try {
      await octokit.rest.issues.create({
        owner,
        repo,
        title,
        body: item.body,
        labels,
      } as unknown as Parameters<OctokitClient['rest']['issues']['create']>[0])

      // Mark as created only after the API call succeeds
      createdThisRun.add(item.mergeSha)
      created += 1
    } catch (error: unknown) {
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      process.stderr.write(`capture-c1-propose: issue creation failed (status=${status}); continuing\n`)
    }
  }

  process.stderr.write(`capture-c1-propose: proposals created=${created} failed=${failed}\n`)

  return {created, failed}
}
