/**
 * Shared helpers for `metadata/repos.yaml` mutation.
 *
 * Writers that add entries use `addRepoEntry`; writers that record survey outcomes use
 * `recordSurveyResult`; operators recovering from a misclassified survey result use
 * `resetSurveyResult` to clear `last_survey_at`/`last_survey_status` back to null. All
 * three are pure functions that never mutate inputs. `addRepoEntry` is idempotent on
 * duplicate repo identities and preserves existing entries as-is unless a privacy-state
 * change requires canonical identifiers to be redacted.
 */

import {createHash} from 'node:crypto'

import {
  assertReposFile,
  type DiscoveryChannel,
  type OnboardingStatus,
  type RepoEntry,
  type ReposFile,
  type SurveyStatus,
} from './schemas.ts'

const REDACTED_OWNER = '[REDACTED]'

export interface RepoIdentityInput {
  owner: string
  repo: string
  private?: boolean
  node_id?: string
  /**
   * Numeric REST `repository.id` (GitHub's `databaseId`). Optional: absent when the probe
   * did not return a positive integer. Like `node_id`, this promotes to main with the entry
   * but must NEVER be embedded in a rendered/logged public surface (issue text, commit
   * message, log line). Written onto redacted entries so the denylist secondary guard is
   * format-independent.
   */
  database_id?: number
}

function assertPrivateNodeId(input: Pick<RepoIdentityInput, 'private' | 'node_id'>): void {
  if (input.private === true && (input.node_id === undefined || input.node_id.trim() === '')) {
    throw new Error('node_id is required for private repos')
  }
}

function definedPrivacyFields(
  input: Pick<RepoIdentityInput, 'private' | 'node_id' | 'database_id'>,
): Partial<RepoEntry> {
  const fields: Partial<RepoEntry> = {}

  if (input.private !== undefined) {
    fields.private = input.private
  }

  if (input.node_id !== undefined) {
    fields.node_id = input.node_id
  }

  if (input.database_id !== undefined) {
    fields.database_id = input.database_id
  }

  return fields
}

interface FindRepoEntryOptions {
  /**
   * Match by `node_id` only. Never consults `database_id` or owner/name, so a write-back keyed
   * by a stale or reused name cannot reach a row that belongs to a different repository, and
   * a renamed repository is never matched through its old name. Requires `input.node_id`;
   * without one nothing matches.
   */
  identityOnly?: boolean
}

function isNodeIdMatch(entry: RepoEntry, nodeId: string): boolean {
  return entry.node_id === nodeId || (entry.owner === REDACTED_OWNER && entry.name === nodeId)
}

function findRepoEntryIndex(
  repos: readonly RepoEntry[],
  input: RepoIdentityInput,
  options: FindRepoEntryOptions = {},
): number {
  const identityMatches: number[] = []
  if (input.node_id !== undefined) {
    const nodeId = input.node_id
    repos.forEach((entry, index) => {
      if (isNodeIdMatch(entry, nodeId)) {
        identityMatches.push(index)
      }
    })
  }
  if (options.identityOnly !== true && input.database_id !== undefined) {
    repos.forEach((entry, index) => {
      if (entry.database_id === input.database_id && !identityMatches.includes(index)) {
        identityMatches.push(index)
      }
    })
  }

  if (identityMatches.length > 1) {
    throw new DuplicateRepoIdentityError({node_id: input.node_id, database_id: input.database_id})
  }
  if (identityMatches.length === 1) {
    return identityMatches[0] ?? -1
  }
  if (options.identityOnly === true) {
    return -1
  }

  return repos.findIndex(entry => entry.owner === input.owner && entry.name === input.repo)
}

/**
 * Pure predicate: true iff `input.node_id` is already tracked under a different owner/name than
 * `input` carries (a pending rename or a transfer). Used by the invitation handler to leave the
 * row alone and skip dispatching a survey that would only record a mismatch.
 *
 * Redacted stored rows never conflict: their name is the node ID, so there is nothing to compare.
 * Inputs without a `node_id` never conflict (no identity to anchor on). Throws
 * `DuplicateRepoIdentityError` when the node ID matches more than one row, like the writers do.
 */
export function findNodeNameConflict(repos: readonly RepoEntry[], input: RepoIdentityInput): boolean {
  const index = findRepoEntryIndex(repos, input, {identityOnly: true})
  const match = index === -1 ? undefined : repos[index]
  if (match === undefined || match.owner === REDACTED_OWNER) {
    return false
  }

  return match.owner !== input.owner || match.name !== input.repo
}

/**
 * Pure predicate: true iff a public `input` with a `node_id` matches no stored node but its
 * owner/name is held by a row for a DIFFERENT node (a repository deleted and recreated under the
 * same name). `addRepoEntry` leaves the file unchanged in that case, so the caller must not
 * dispatch a survey either: the survey would be keyed on the new node while the tracked page
 * belongs to the old one.
 *
 * Never true for a private input (it is stored redacted under its node ID), for a node that matches
 * a row (that is {@link findNodeNameConflict}'s case), for a redacted stored row (its name is a node
 * ID, not a repo name) or for a row without a `node_id` (nothing to disagree with).
 */
export function findNameHeldByOtherNode(repos: readonly RepoEntry[], input: RepoIdentityInput): boolean {
  if (input.private === true || input.node_id === undefined) {
    return false
  }
  if (findRepoEntryIndex(repos, input, {identityOnly: true}) !== -1) {
    return false
  }

  return repos.some(
    entry =>
      entry.owner !== REDACTED_OWNER &&
      entry.node_id !== undefined &&
      entry.owner === input.owner &&
      entry.name === input.repo,
  )
}

export function normalizeRepoEntryForStorage(entry: RepoEntry, input: Partial<RepoIdentityInput> = {}): RepoEntry {
  const nextPrivate = input.private ?? entry.private
  const nextNodeId = input.node_id ?? entry.node_id ?? (entry.owner === REDACTED_OWNER ? entry.name : undefined)
  const nextDatabaseId = input.database_id ?? entry.database_id

  if (nextPrivate === true) {
    assertPrivateNodeId({private: true, node_id: nextNodeId})
    const redactedName = nextNodeId
    if (redactedName === undefined) {
      throw new Error('node_id is required for private repos')
    }

    if (
      entry.owner === REDACTED_OWNER &&
      entry.name === redactedName &&
      entry.private === true &&
      entry.node_id === redactedName &&
      entry.database_id === nextDatabaseId
    ) {
      return entry
    }

    const redacted: RepoEntry = {
      ...entry,
      owner: REDACTED_OWNER,
      name: redactedName,
      private: true,
      node_id: redactedName,
    }
    if (nextDatabaseId !== undefined) {
      redacted.database_id = nextDatabaseId
    }
    return redacted
  }

  const nextOwner = input.private === false && input.owner !== undefined ? input.owner : entry.owner
  const nextName = input.private === false && input.repo !== undefined ? input.repo : entry.name
  const nextEntry = {
    ...entry,
    owner: nextOwner,
    name: nextName,
    ...definedPrivacyFields({private: input.private, node_id: nextNodeId, database_id: input.database_id}),
  }

  if (
    nextEntry.owner === entry.owner &&
    nextEntry.name === entry.name &&
    nextEntry.private === entry.private &&
    nextEntry.node_id === entry.node_id &&
    nextEntry.database_id === entry.database_id
  ) {
    return entry
  }

  return nextEntry
}

/**
 * Per-channel base survey interval, in days. The actual eligibility date adds a
 * deterministic jitter of 0..{@link JITTER_MAX_DAYS} days on top.
 *
 * - `collab` (30d): operator-invited collaborator repos
 * - `owned` (14d): repos in the fro-bot org itself; tightest cadence so the agent's own
 *   surface area stays current
 * - `contrib` (21d): cross-org repos surfaced via `metadata/allowlist.yaml`
 */
export const CHANNEL_INTERVAL_DAYS = {
  collab: 30,
  owned: 14,
  contrib: 21,
} as const satisfies Record<DiscoveryChannel, number>

/**
 * Maximum jitter added to a base interval, in days. The actual jitter for a given
 * `(owner, repo, baseDate)` triple is in `[0, JITTER_MAX_DAYS]` and is deterministic.
 */
export const JITTER_MAX_DAYS = 3

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface ComputeNextEligibleAtInput {
  owner: string
  repo: string
  channel: DiscoveryChannel
  baseDate: Date
}

/**
 * Compute the ISO date (YYYY-MM-DD, UTC) when a repo becomes eligible for its next
 * survey, given the base date (typically `last_survey_at`), the discovery channel
 * (which sets the base interval), and the repo identifiers (which seed jitter).
 *
 * Formula: `baseDate + CHANNEL_INTERVAL_DAYS[channel] + jitter` days, where jitter is
 * derived deterministically from `${owner}/${repo}@${baseDate-as-YYYY-MM-DD-UTC}`
 * via SHA-256 → first 4 bytes as big-endian uint32 → modulo `(JITTER_MAX_DAYS + 1)`.
 *
 * Midnight stability: the jitter seed is the YYYY-MM-DD slice of `baseDate` in UTC,
 * NOT the full Date. Two calls with `baseDate` values 1 ms apart on the same UTC day
 * produce identical outputs; calls on opposite sides of UTC midnight may differ
 * because the seed string itself differs. This contract is required so within-process
 * `commitMetadata` 409 retries (the mutator re-runs against the same `at` value) write
 * the same eligibility date. Cross-process retries (e.g., human re-trigger after
 * `CONFLICT_EXHAUSTED`) capture the retry's clock, so eligibility may shift by 1 day if
 * the retry crosses UTC midnight; callers that need cross-process stability should pin
 * `at` to a logical instant such as the original workflow's `github.run_started_at`.
 */
export function computeNextEligibleAt(input: ComputeNextEligibleAtInput): string {
  const surveyDateString = input.baseDate.toISOString().slice(0, 10)
  const seed = `${input.owner}/${input.repo}@${surveyDateString}`
  const hash = createHash('sha256').update(seed).digest()
  const uint32 = hash.readUInt32BE(0)
  const jitterDays = uint32 % (JITTER_MAX_DAYS + 1)

  const baseMs = Date.parse(`${surveyDateString}T00:00:00Z`)
  const offsetDays = CHANNEL_INTERVAL_DAYS[input.channel] + jitterDays
  const eligibleMs = baseMs + offsetDays * MS_PER_DAY

  return new Date(eligibleMs).toISOString().slice(0, 10)
}

export interface AddRepoEntryInput {
  owner: string
  repo: string
  now: Date
  /** Whether the repo is private. When true, `node_id` is required and owner/name are redacted. */
  private?: boolean
  /** GitHub GraphQL global node ID. Required when `private` is true. */
  node_id?: string
  /**
   * Numeric REST `repository.id` (GitHub's `databaseId`). Optional: absent when the probe
   * did not return a positive integer. Like `node_id`, this promotes to main with the entry
   * but must NEVER be embedded in a rendered/logged public surface (issue text, commit
   * message, log line). Written onto redacted entries so the denylist secondary guard is
   * format-independent.
   */
  database_id?: number
  /**
   * Onboarding status for the new entry. Defaults to `'pending'` to match the original
   * invitation-acceptance path. Reconcile passes `'pending-review'` when the repo owner is
   * not in `metadata/allowlist.yaml`.
   */
  onboarding_status?: OnboardingStatus
  /**
   * Which discovery channel surfaced this newcomer. Defaults to `'collab'` to match the
   * original invitation-acceptance path. Reconcile passes `'owned'` for fro-bot org repos
   * discovered via the App's installation enumeration, and `'contrib'` for repos surfaced
   * through `metadata/allowlist.yaml`'s `approved_contrib_*` lists.
   *
   * Sticky after first write — neither reconcile nor any other writer auto-rewrites this
   * field. Operators re-classify by editing `metadata/repos.yaml` on the `data` branch.
   */
  discovery_channel?: DiscoveryChannel
}

/**
 * Add a new repo entry to the repos metadata file. Idempotent: returns the input unchanged
 * (by reference) when an entry with the same node identity already exists and no private
 * redaction is needed, regardless of the requested `onboarding_status`. Callers that
 * need to change status of an existing entry must do so through a different code path.
 *
 * Matching is by `node_id` only (`identityOnly`). It never changes identity or visibility
 * fields on a match except to redact a repo that has gone private, and it never adds a second
 * row under an owner/name another node already holds.
 *
 * Pure function: never mutates `current` in place. When adding, returns a fresh top-level
 * object with a fresh `repos` array.
 *
 * Private entries are always written in redacted form (`owner: '[REDACTED]'`,
 * `name: <node_id>`). Public entries keep canonical owner/name and carry `node_id` when
 * supplied. Treat absence of `private` as "not yet observed" — downstream consumers must
 * default to fail-safe (treat-as-private) for entries lacking `private`.
 */
export function addRepoEntry(current: unknown, input: AddRepoEntryInput): ReposFile {
  assertReposFile(current, 'repos')
  assertPrivateNodeId(input)

  const matchIndex = findRepoEntryIndex(current.repos, input, {identityOnly: true})
  if (matchIndex !== -1) {
    const match = current.repos[matchIndex]
    // A node match is only ever touched by the private-redaction transform. A public input never
    // rewrites owner, name, node_id, database_id or private: renames belong to the operator
    // rename workflow and un-redaction belongs to reconcile's planner.
    if (match === undefined || input.private !== true) {
      return current
    }

    const normalized = normalizeRepoEntryForStorage(match, input)
    if (normalized === match) {
      return current
    }

    const nextRepos = [...current.repos]
    nextRepos[matchIndex] = normalized

    return {
      ...current,
      repos: nextRepos,
    }
  }

  // No node match. A non-private input whose owner/name is already held by a row with a different
  // (or no) node ID must not create a second row under the same name, and must not adopt that row.
  if (input.private !== true && current.repos.some(entry => entry.owner === input.owner && entry.name === input.repo)) {
    return current
  }

  const nextEntry = normalizeRepoEntryForStorage({
    owner: input.owner,
    name: input.repo,
    added: input.now.toISOString().slice(0, 10),
    onboarding_status: input.onboarding_status ?? 'pending',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: input.discovery_channel ?? 'collab',
    next_survey_eligible_at: null,
    ...definedPrivacyFields(input),
  })

  if (current.repos.some(entry => entry.node_id !== undefined && entry.node_id === nextEntry.node_id)) {
    return current
  }

  return {
    ...current,
    repos: [...current.repos, nextEntry],
  }
}

export interface RecordSurveyResultInput {
  owner: string
  repo: string
  private?: boolean
  /** Survey write-backs match rows by node ID only. */
  node_id: string
  at: Date
  status: SurveyStatus
}

/**
 * How a survey write-back related to the stored row it matched by node ID.
 *
 * - `recorded`: the survey target matched the row; the requested status was written.
 * - `name-mismatch`: the node ID matched but the stored owner/name differs from the survey
 *   target (a pending rename or a transfer). `failure` was recorded and the stored name kept.
 * - `visibility-mismatch`: the survey reported public for a row stored as private. Nothing was written.
 */
export type SurveyWriteBackOutcome = 'recorded' | 'name-mismatch' | 'visibility-mismatch'

export interface AppliedSurveyResult {
  file: ReposFile
  outcome: SurveyWriteBackOutcome
  /** The status written to the row: the requested one, `failure` on a name mismatch, none if nothing was written. */
  written: SurveyStatus | undefined
}

/**
 * Record the outcome of a Survey Repo run against an existing entry and report how the survey
 * target related to that entry. See {@link recordSurveyResult} for the file-only form.
 *
 * Rows are matched by `node_id` only. A missing `node_id` throws a status-only error; no node
 * match throws `RepoEntryNotFoundError` (nothing is written). On a match the stored `owner`,
 * `name`, `node_id`, `database_id` and `private` are kept: a survey can never rename a row.
 * The one visibility write left is the fail-safe redaction of a stored public row the survey
 * reports as private.
 *
 * Pure function: never mutates `current` in place.
 */
export function applySurveyResult(current: unknown, input: RecordSurveyResultInput): AppliedSurveyResult {
  assertReposFile(current, 'repos')
  assertPrivateNodeId(input)

  if (input.node_id === undefined || input.node_id.trim() === '') {
    throw new Error('node_id is required for survey write-back')
  }

  const matchIndex = findRepoEntryIndex(current.repos, input, {identityOnly: true})
  const match = matchIndex === -1 ? undefined : current.repos[matchIndex]
  if (match === undefined) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  const storedPrivate = match.private === true || match.owner === REDACTED_OWNER
  if (storedPrivate && input.private === false) {
    return {file: current, outcome: 'visibility-mismatch', written: undefined}
  }

  // A redacted row's name is its node ID, so there is no owner/name to compare against.
  const nameMismatch = match.owner !== REDACTED_OWNER && (match.owner !== input.owner || match.name !== input.repo)
  const status: SurveyStatus = nameMismatch ? 'failure' : input.status

  // Promote pending → onboarded on first successful survey. This closes the
  // bootstrapping lifecycle: pending (added) → onboarded (first success) →
  // staleness-gated re-surveys. Without this promotion, pending repos would
  // never reach onboarded status and the staleness gate on the onboarded path
  // would never apply.
  const nextStatus =
    status === 'success' && match.onboarding_status === 'pending' ? 'onboarded' : match.onboarding_status

  // Compute the next-eligible date using the entry's discovery channel. The cadence
  // model writes this on every survey outcome — both success and failure — so a failed
  // survey doesn't immediately re-dispatch on the next reconcile cron (which would burn
  // dispatch slots while the underlying problem persists). Channel defaults to 'collab'
  // when the field is absent on a legacy entry that hasn't been migrated yet.
  const channel: DiscoveryChannel = match.discovery_channel ?? 'collab'
  // Only the private-redaction transform may run here; identity and visibility fields otherwise
  // come from the stored row, never from the survey input.
  const normalizedMatch =
    input.private === true ? normalizeRepoEntryForStorage(match, {private: true, node_id: input.node_id}) : match
  const nextEligibleAt = computeNextEligibleAt({
    owner: normalizedMatch.owner,
    repo: normalizedMatch.name,
    channel,
    baseDate: input.at,
  })

  const updated: RepoEntry = {
    ...normalizedMatch,
    onboarding_status: nextStatus,
    last_survey_at: input.at.toISOString().slice(0, 10),
    last_survey_status: status,
    next_survey_eligible_at: nextEligibleAt,
  }

  const nextRepos = [...current.repos]
  nextRepos[matchIndex] = updated

  return {
    file: {
      ...current,
      repos: nextRepos,
    },
    outcome: nameMismatch ? 'name-mismatch' : 'recorded',
    written: status,
  }
}

/**
 * Record the outcome of a Survey Repo run against an existing entry.
 *
 * Updates `last_survey_at` to the ISO date of `input.at` and `last_survey_status` to
 * `input.status` (or `failure` when the survey target's owner/name no longer matches the row).
 * Throws `RepoEntryNotFoundError` when no row carries `input.node_id` — callers must
 * ensure the entry exists (typically via a prior reconcile run that called `addRepoEntry`).
 *
 * Reconcile's `>30d since last survey` staleness gate only engages when survey workflows
 * write their outcome back here. Without this write-back, reconcile treats every repo as
 * never-surveyed and re-dispatches the full access list every run.
 *
 * Pure function: never mutates `current` in place. Returns a fresh top-level object with a
 * fresh `repos` array. Callers that need the outcome use {@link applySurveyResult}.
 */
export function recordSurveyResult(current: unknown, input: RecordSurveyResultInput): ReposFile {
  return applySurveyResult(current, input).file
}

export interface ResetSurveyResultInput {
  owner: string
  repo: string
  private?: boolean
  node_id?: string
}

/**
 * Reset survey-tracking fields to `null` on an existing entry, forcing reconcile to
 * treat the repo as never-surveyed and re-dispatch on the next cron.
 *
 * Clears three fields:
 * - `last_survey_at` (legacy staleness signal)
 * - `last_survey_status` (legacy success/failure marker)
 * - `next_survey_eligible_at` (cadence-engine eligibility gate)
 *
 * All three must be cleared together. Under the cadence model, `next_survey_eligible_at`
 * is the authoritative dispatch gate (see `isEligibleForSurvey` in `reconcile-repos.ts`);
 * leaving it populated would cause `classifyTracked` to silently skip the entry even
 * after reset, defeating the recovery contract.
 *
 * Used to recover from misclassified survey outcomes — e.g. when a wiki-commit failure
 * was recorded as `success` under an older `SURVEY_STATUS` expression, causing the
 * dispatch gate to skip the repo for the full cadence window despite no wiki content
 * landing.
 *
 * Throws `RepoEntryNotFoundError` when the entry is missing — callers should enumerate
 * known contaminated entries and fail loudly on typos.
 *
 * Pure function: never mutates `current` in place. Returns a fresh top-level object with
 * a fresh `repos` array.
 */
export function resetSurveyResult(current: unknown, input: ResetSurveyResultInput): ReposFile {
  assertReposFile(current, 'repos')
  assertPrivateNodeId(input)

  const matchIndex = findRepoEntryIndex(current.repos, input)
  if (matchIndex === -1) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  const match = current.repos[matchIndex]
  if (match === undefined) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  const updated = normalizeRepoEntryForStorage({
    ...normalizeRepoEntryForStorage(match, input),
    last_survey_at: null,
    last_survey_status: null,
    next_survey_eligible_at: null,
  })

  const nextRepos = [...current.repos]
  nextRepos[matchIndex] = updated

  return {
    ...current,
    repos: nextRepos,
  }
}

/**
 * Pure predicate: returns true iff `metadata/repos.yaml` has an entry whose
 * `owner` and `name` exactly match the given `owner` and `repo` strings
 * AND whose `private` field is explicitly `false`.
 *
 * This intentionally requires `private === false` (strict equality). An entry
 * with `private` absent or `private: true` does NOT match — mirroring the
 * promotion privacy gate in `buildPublicSlugMap` (check-wiki-private-presence.ts),
 * which only admits wiki pages for repos with explicit `private === false`.
 * Absent/undefined `private` is treated as private (fail-safe default).
 *
 * Does NOT use node_id or redacted-entry matching — this predicate is for the
 * public-promotable presence check only, not for locating entries by identity key.
 *
 * Does NOT throw on a missing entry — that is the whole point of a boolean
 * predicate. If `current` is not a valid repos file, `assertReposFile` throws
 * and the caller decides how to handle it (fail-closed).
 *
 * Pure: no I/O, no mutation of `current`.
 */
export function publicRepoEntryExists(current: unknown, owner: string, repo: string): boolean {
  assertReposFile(current, 'repos')
  return current.repos.some(entry => entry.owner === owner && entry.name === repo && entry.private === false)
}

export class RepoEntryNotFoundError extends Error {
  readonly code = 'REPO_ENTRY_NOT_FOUND'
  // Explicit field declarations + assignment in the constructor body, not parameter properties.
  // Node's strip-only TypeScript mode rejects `constructor(readonly owner: string)` syntax with
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at runtime even though tsc and Vitest both accept it.
  readonly owner: string
  readonly repo: string

  constructor(owner: string, repo: string) {
    super(`metadata/repos.yaml has no entry for ${owner}/${repo}`)
    this.name = 'RepoEntryNotFoundError'
    this.owner = owner
    this.repo = repo
  }
}

export class DuplicateRepoIdentityError extends Error {
  readonly code = 'DUPLICATE_REPO_IDENTITY'
  readonly node_id: string | undefined
  readonly database_id: number | undefined

  constructor(input: {node_id?: string; database_id?: number}) {
    const identifier = input.node_id === undefined ? 'unknown identity' : `node_id=${input.node_id}`
    super(`duplicate repo identity match during metadata write-back (${identifier})`)
    this.name = 'DuplicateRepoIdentityError'
    this.node_id = input.node_id
    this.database_id = input.database_id
  }
}
