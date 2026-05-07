/**
 * Shared helpers for `metadata/repos.yaml` mutation.
 *
 * Writers that add entries use `addRepoEntry`; writers that record survey outcomes use
 * `recordSurveyResult`; operators recovering from a misclassified survey result use
 * `resetSurveyResult` to clear `last_survey_at`/`last_survey_status` back to null. All
 * three are pure functions that never mutate inputs. `addRepoEntry` is idempotent on
 * duplicate `owner+name` and preserves existing entries as-is.
 */

import {createHash} from 'node:crypto'

import {
  assertReposFile,
  type DiscoveryChannel,
  type OnboardingStatus,
  type ReposFile,
  type SurveyStatus,
} from './schemas.ts'

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
 * (by reference) when an entry with the same `owner + name` already exists, regardless of
 * the requested `onboarding_status`. Callers that need to change status of an existing entry
 * must do so through a different code path.
 *
 * Pure function: never mutates `current` in place. When adding, returns a fresh top-level
 * object with a fresh `repos` array.
 */
export function addRepoEntry(current: unknown, input: AddRepoEntryInput): ReposFile {
  assertReposFile(current, 'repos')

  if (current.repos.some(entry => entry.owner === input.owner && entry.name === input.repo)) {
    return current
  }

  return {
    ...current,
    repos: [
      ...current.repos,
      {
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
      },
    ],
  }
}

export interface RecordSurveyResultInput {
  owner: string
  repo: string
  at: Date
  status: SurveyStatus
}

/**
 * Record the outcome of a Survey Repo run against an existing entry.
 *
 * Updates `last_survey_at` to the ISO date of `input.at` and `last_survey_status` to
 * `input.status`. Throws `RepoEntryNotFoundError` when the entry is missing — callers must
 * ensure the entry exists (typically via a prior reconcile run that called `addRepoEntry`).
 *
 * Reconcile's `>30d since last survey` staleness gate only engages when survey workflows
 * write their outcome back here. Without this write-back, reconcile treats every repo as
 * never-surveyed and re-dispatches the full access list every run.
 *
 * Pure function: never mutates `current` in place. Returns a fresh top-level object with a
 * fresh `repos` array.
 */
export function recordSurveyResult(current: unknown, input: RecordSurveyResultInput): ReposFile {
  assertReposFile(current, 'repos')

  const matchIndex = current.repos.findIndex(entry => entry.owner === input.owner && entry.name === input.repo)
  if (matchIndex === -1) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  const match = current.repos[matchIndex]
  if (match === undefined) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  // Promote pending → onboarded on first successful survey. This closes the
  // bootstrapping lifecycle: pending (added) → onboarded (first success) →
  // staleness-gated re-surveys. Without this promotion, pending repos would
  // never reach onboarded status and the staleness gate on the onboarded path
  // would never apply.
  const nextStatus =
    input.status === 'success' && match.onboarding_status === 'pending' ? 'onboarded' : match.onboarding_status

  // Compute the next-eligible date using the entry's discovery channel. The cadence
  // model writes this on every survey outcome — both success and failure — so a failed
  // survey doesn't immediately re-dispatch on the next reconcile cron (which would burn
  // dispatch slots while the underlying problem persists). Channel defaults to 'collab'
  // when the field is absent on a legacy entry that hasn't been migrated yet.
  const channel: DiscoveryChannel = match.discovery_channel ?? 'collab'
  const nextEligibleAt = computeNextEligibleAt({
    owner: input.owner,
    repo: input.repo,
    channel,
    baseDate: input.at,
  })

  const updated = {
    ...match,
    onboarding_status: nextStatus,
    last_survey_at: input.at.toISOString().slice(0, 10),
    last_survey_status: input.status,
    next_survey_eligible_at: nextEligibleAt,
  }

  const nextRepos = [...current.repos]
  nextRepos[matchIndex] = updated

  return {
    ...current,
    repos: nextRepos,
  }
}

export interface ResetSurveyResultInput {
  owner: string
  repo: string
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

  const matchIndex = current.repos.findIndex(entry => entry.owner === input.owner && entry.name === input.repo)
  if (matchIndex === -1) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  const match = current.repos[matchIndex]
  if (match === undefined) {
    throw new RepoEntryNotFoundError(input.owner, input.repo)
  }

  const updated = {
    ...match,
    last_survey_at: null,
    last_survey_status: null,
    next_survey_eligible_at: null,
  }

  const nextRepos = [...current.repos]
  nextRepos[matchIndex] = updated

  return {
    ...current,
    repos: nextRepos,
  }
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
