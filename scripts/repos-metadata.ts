/**
 * Shared helpers for `metadata/repos.yaml` mutation.
 *
 * Writers that add entries use `addRepoEntry`; writers that record survey outcomes use
 * `recordSurveyResult`; operators recovering from a misclassified survey result use
 * `resetSurveyResult` to clear `last_survey_at`/`last_survey_status` back to null. All
 * three are pure functions that never mutate inputs. `addRepoEntry` is idempotent on
 * duplicate `owner+name` and preserves existing entries as-is.
 */

import {
  assertReposFile,
  type DiscoveryChannel,
  type OnboardingStatus,
  type ReposFile,
  type SurveyStatus,
} from './schemas.ts'

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

  const updated = {
    ...match,
    onboarding_status: nextStatus,
    last_survey_at: input.at.toISOString().slice(0, 10),
    last_survey_status: input.status,
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
 * Reset `last_survey_at` and `last_survey_status` to `null` on an existing entry.
 *
 * Used to recover from misclassified survey outcomes — e.g. when a wiki-commit failure
 * was recorded as `success` under an older `SURVEY_STATUS` expression, causing the
 * reconcile staleness gate to skip the repo for 30 days despite no wiki content landing.
 * Clearing the fields back to `null` forces reconcile to treat the repo as never-surveyed
 * and re-dispatch it on the next cron.
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
