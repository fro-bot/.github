/**
 * Shared helpers for `metadata/repos.yaml` mutation.
 *
 * Any script that adds entries to the repos file should use `addRepoEntry` so every writer
 * produces byte-compatible entry shapes. `addRepoEntry` is for NEW entries only; it is
 * idempotent on duplicate `owner+name` and preserves the existing entry as-is (it does NOT
 * update status of existing entries — callers that need status transitions should produce
 * fresh entries inline, since a generic "update status" helper would obscure intent).
 */

import {assertReposFile, type OnboardingStatus, type ReposFile} from './schemas.ts'

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
