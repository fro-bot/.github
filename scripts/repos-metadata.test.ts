import type {ReposFile} from './schemas.ts'

import {describe, expect, it} from 'vitest'
import {addRepoEntry} from './repos-metadata.ts'

const EMPTY_REPOS: ReposFile = {version: 1, repos: []}
const NOW = new Date('2026-04-17T12:00:00Z')

describe('addRepoEntry', () => {
  // Behavioral contract: default onboarding_status is 'pending'
  it("defaults onboarding_status to 'pending' when not specified", () => {
    const result = addRepoEntry(EMPTY_REPOS, {owner: 'alice', repo: 'project', now: NOW})
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]?.onboarding_status).toBe('pending')
  })

  // Behavioral contract: all default fields present
  it('produces an entry with all default fields populated', () => {
    const result = addRepoEntry(EMPTY_REPOS, {owner: 'alice', repo: 'project', now: NOW})
    expect(result.repos[0]).toEqual({
      owner: 'alice',
      name: 'project',
      added: '2026-04-17',
      onboarding_status: 'pending',
      last_survey_at: null,
      last_survey_status: null,
      has_fro_bot_workflow: false,
      has_renovate: false,
    })
  })

  // Extended behavior: accepts pending-review status
  it("accepts 'pending-review' onboarding_status for non-allowlisted newcomers", () => {
    const result = addRepoEntry(EMPTY_REPOS, {
      owner: 'bob',
      repo: 'sus-repo',
      now: NOW,
      onboarding_status: 'pending-review',
    })
    expect(result.repos[0]?.onboarding_status).toBe('pending-review')
  })

  // Extended behavior: accepts any valid OnboardingStatus
  it('accepts any valid OnboardingStatus value', () => {
    for (const status of ['pending', 'onboarded', 'failed', 'lost-access', 'pending-review'] as const) {
      const result = addRepoEntry(EMPTY_REPOS, {
        owner: 'carol',
        repo: `proj-${status}`,
        now: NOW,
        onboarding_status: status,
      })
      expect(result.repos[0]?.onboarding_status).toBe(status)
    }
  })

  // Behavioral contract: idempotent on duplicate owner+name
  it('returns current unchanged when an entry with the same owner+name already exists', () => {
    const existing: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-01-01',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-02-01',
          last_survey_status: 'success',
          has_fro_bot_workflow: true,
          has_renovate: true,
        },
      ],
    }
    const result = addRepoEntry(existing, {owner: 'alice', repo: 'project', now: NOW})
    expect(result).toBe(existing)
  })

  // Behavioral contract: idempotency ignores requested status (existing entry preserved)
  it('preserves existing entry status even when a different status is requested', () => {
    const existing: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-01-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    const result = addRepoEntry(existing, {
      owner: 'alice',
      repo: 'project',
      now: NOW,
      onboarding_status: 'pending-review',
    })
    expect(result).toBe(existing)
    expect(result.repos[0]?.onboarding_status).toBe('onboarded')
  })

  // Purity contract: returns a fresh top-level object
  it('returns a fresh top-level object when adding (no in-place mutation)', () => {
    const result = addRepoEntry(EMPTY_REPOS, {owner: 'alice', repo: 'project', now: NOW})
    expect(result).not.toBe(EMPTY_REPOS)
    expect(result.repos).not.toBe(EMPTY_REPOS.repos)
    expect(EMPTY_REPOS.repos).toHaveLength(0)
  })

  // Schema validation: rejects malformed current input
  it('throws when current is not a valid ReposFile', () => {
    expect(() => addRepoEntry({version: 2, repos: []}, {owner: 'a', repo: 'b', now: NOW})).toThrow()
    expect(() => addRepoEntry(null, {owner: 'a', repo: 'b', now: NOW})).toThrow()
    expect(() => addRepoEntry({repos: []}, {owner: 'a', repo: 'b', now: NOW})).toThrow()
  })

  // Date handling: ISO date slice
  it('formats `added` as YYYY-MM-DD from the `now` Date', () => {
    const result = addRepoEntry(EMPTY_REPOS, {
      owner: 'alice',
      repo: 'project',
      now: new Date('2026-12-31T23:59:59Z'),
    })
    expect(result.repos[0]?.added).toBe('2026-12-31')
  })

  // Append order: new entries go at the end, existing entries preserved in order
  it('appends a new entry after existing entries, preserving order', () => {
    const existing: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'first',
          added: '2026-01-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
        {
          owner: 'bob',
          name: 'second',
          added: '2026-02-01',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    const result = addRepoEntry(existing, {owner: 'carol', repo: 'third', now: NOW})
    expect(result.repos).toHaveLength(3)
    expect(result.repos[0]?.name).toBe('first')
    expect(result.repos[1]?.name).toBe('second')
    expect(result.repos[2]?.name).toBe('third')
  })
})
