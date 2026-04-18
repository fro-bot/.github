/**
 * Shared helpers for `metadata/repos.yaml` mutation.
 *
 * Writers that add entries use `addRepoEntry`; writers that record survey outcomes use
 * `recordSurveyResult`. Both are pure functions that never mutate inputs. `addRepoEntry`
 * is idempotent on duplicate `owner+name` and preserves existing entries as-is.
 */

import {assertReposFile, type OnboardingStatus, type ReposFile, type SurveyStatus} from './schemas.ts'

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

  const updated = {
    ...match,
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

export class RepoEntryNotFoundError extends Error {
  readonly code = 'REPO_ENTRY_NOT_FOUND'

  constructor(
    readonly owner: string,
    readonly repo: string,
  ) {
    super(`metadata/repos.yaml has no entry for ${owner}/${repo}`)
    this.name = 'RepoEntryNotFoundError'
  }
}
