import type {ReposFile} from './schemas.ts'

import {describe, expect, it} from 'vitest'
import {
  addRepoEntry,
  computeNextEligibleAt,
  recordSurveyResult,
  RepoEntryNotFoundError,
  resetSurveyResult,
} from './repos-metadata.ts'

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
      discovery_channel: 'collab',
      next_survey_eligible_at: null,
    })
  })

  // Cadence-and-discovery: defaults discovery_channel to 'collab' when not specified
  it("defaults discovery_channel to 'collab' when not specified", () => {
    const result = addRepoEntry(EMPTY_REPOS, {owner: 'alice', repo: 'project', now: NOW})
    expect(result.repos[0]?.discovery_channel).toBe('collab')
  })

  // Cadence-and-discovery: defaults next_survey_eligible_at to null (never-surveyed = immediately eligible)
  it('defaults next_survey_eligible_at to null', () => {
    const result = addRepoEntry(EMPTY_REPOS, {owner: 'alice', repo: 'project', now: NOW})
    expect(result.repos[0]?.next_survey_eligible_at).toBeNull()
  })

  // Cadence-and-discovery: accepts and persists owned channel for fro-bot org repos
  it("accepts 'owned' discovery_channel for fro-bot org repos", () => {
    const result = addRepoEntry(EMPTY_REPOS, {
      owner: 'fro-bot',
      repo: 'agent',
      now: NOW,
      discovery_channel: 'owned',
    })
    expect(result.repos[0]?.discovery_channel).toBe('owned')
  })

  // Cadence-and-discovery: accepts and persists contrib channel for cross-org repos
  it("accepts 'contrib' discovery_channel for cross-org repos", () => {
    const result = addRepoEntry(EMPTY_REPOS, {
      owner: 'bfra-me',
      repo: '.github',
      now: NOW,
      discovery_channel: 'contrib',
    })
    expect(result.repos[0]?.discovery_channel).toBe('contrib')
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
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
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
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
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
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
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
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
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

describe('recordSurveyResult', () => {
  // Behavioral contract: writes ISO date + status on a matching entry
  it('writes last_survey_at (ISO date) and last_survey_status when the entry exists', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const result = recordSurveyResult(current, {
      owner: 'alice',
      repo: 'project',
      at: new Date('2026-04-18T05:34:00Z'),
      status: 'success',
    })

    expect(result.repos[0]?.last_survey_at).toBe('2026-04-18')
    expect(result.repos[0]?.last_survey_status).toBe('success')
  })

  // Behavioral contract: pure — original input unchanged
  it('does not mutate the input file', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const snapshot = structuredClone(current)
    recordSurveyResult(current, {
      owner: 'alice',
      repo: 'project',
      at: NOW,
      status: 'success',
    })

    expect(current).toEqual(snapshot)
  })

  // Behavioral contract: preserves sibling entries unchanged
  it('preserves other entries verbatim while updating only the match', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'first',
          added: '2026-04-01',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-04-02',
          last_survey_status: 'success',
          has_fro_bot_workflow: true,
          has_renovate: true,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
        {
          owner: 'bob',
          name: 'second',
          added: '2026-04-15',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const result = recordSurveyResult(current, {
      owner: 'bob',
      repo: 'second',
      at: new Date('2026-04-18T00:00:00Z'),
      status: 'success',
    })

    // First entry untouched
    expect(result.repos[0]).toEqual(current.repos[0])
    // Second entry updated
    expect(result.repos[1]?.last_survey_at).toBe('2026-04-18')
    expect(result.repos[1]?.last_survey_status).toBe('success')
    // Pending entry promoted to onboarded on successful survey
    expect(result.repos[1]?.onboarding_status).toBe('onboarded')
    expect(result.repos[1]?.added).toBe('2026-04-15')
  })

  // Behavioral contract: records failure outcomes too
  it("accepts 'failure' as a valid status value", () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const result = recordSurveyResult(current, {
      owner: 'alice',
      repo: 'project',
      at: NOW,
      status: 'failure',
    })

    expect(result.repos[0]?.last_survey_status).toBe('failure')
  })

  // Behavioral contract: typed error when the entry is missing
  it('throws RepoEntryNotFoundError when the target repo has no entry', () => {
    const current: ReposFile = {version: 1, repos: []}

    expect(() =>
      recordSurveyResult(current, {
        owner: 'ghost',
        repo: 'nowhere',
        at: NOW,
        status: 'success',
      }),
    ).toThrow(RepoEntryNotFoundError)
  })

  // Lifecycle promotion: pending → onboarded on first successful survey
  it('promotes onboarding_status from pending to onboarded on successful survey', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const result = recordSurveyResult(current, {
      owner: 'alice',
      repo: 'project',
      at: new Date('2026-04-18T05:34:00Z'),
      status: 'success',
    })

    expect(result.repos[0]?.onboarding_status).toBe('onboarded')
    expect(result.repos[0]?.last_survey_status).toBe('success')
  })

  // Negative: failure does NOT promote pending to onboarded
  it('preserves pending onboarding_status on failed survey', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const result = recordSurveyResult(current, {
      owner: 'alice',
      repo: 'project',
      at: NOW,
      status: 'failure',
    })

    expect(result.repos[0]?.onboarding_status).toBe('pending')
    expect(result.repos[0]?.last_survey_status).toBe('failure')
  })

  // Negative: success on already-onboarded does not change status
  it('does not change onboarding_status when already onboarded', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-03-01',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const result = recordSurveyResult(current, {
      owner: 'alice',
      repo: 'project',
      at: NOW,
      status: 'success',
    })

    expect(result.repos[0]?.onboarding_status).toBe('onboarded')
  })
})

describe('resetSurveyResult', () => {
  // Behavioral contract: clear last_survey_at + last_survey_status back to null
  it('resets last_survey_at and last_survey_status to null on the target entry', () => {
    // #given a repo entry marked as successfully surveyed on 2026-04-19
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'marcusrbrown',
          name: '.dotfiles',
          added: '2026-04-18',
          onboarding_status: 'pending',
          last_survey_at: '2026-04-19',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    // #when the entry is reset
    const result = resetSurveyResult(current, {owner: 'marcusrbrown', repo: '.dotfiles'})

    // #then both survey fields become null; other fields are preserved exactly
    expect(result.repos[0]).toEqual({
      owner: 'marcusrbrown',
      name: '.dotfiles',
      added: '2026-04-18',
      onboarding_status: 'pending',
      last_survey_at: null,
      last_survey_status: null,
      has_fro_bot_workflow: false,
      has_renovate: false,
      discovery_channel: 'collab',
      next_survey_eligible_at: null,
    })
  })

  // Behavioral contract: pure function — never mutates input
  it('returns a fresh top-level object without mutating inputs', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-17',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-04-18',
          last_survey_status: 'failure',
          has_fro_bot_workflow: true,
          has_renovate: true,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }
    const snapshot = structuredClone(current)

    const result = resetSurveyResult(current, {owner: 'alice', repo: 'project'})

    // #then the original object is untouched; the new object is a distinct reference
    expect(current).toEqual(snapshot)
    expect(result).not.toBe(current)
    expect(result.repos).not.toBe(current.repos)
  })

  // Behavioral contract: leaves other entries untouched — surgical reset, not broadcast
  it('leaves non-target entries exactly as they were', () => {
    // #given two entries, one of which we will reset
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'keep-me',
          added: '2026-04-17',
          onboarding_status: 'pending',
          last_survey_at: '2026-04-18',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
        {
          owner: 'bob',
          name: 'reset-me',
          added: '2026-04-18',
          onboarding_status: 'pending',
          last_survey_at: '2026-04-19',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    // #when only the second entry is reset
    const result = resetSurveyResult(current, {owner: 'bob', repo: 'reset-me'})

    // #then the first entry is preserved verbatim, the second is reset
    expect(result.repos[0]?.last_survey_at).toBe('2026-04-18')
    expect(result.repos[0]?.last_survey_status).toBe('success')
    expect(result.repos[1]?.last_survey_at).toBeNull()
    expect(result.repos[1]?.last_survey_status).toBeNull()
  })

  // Behavioral contract: typed error when the entry is missing
  it('throws RepoEntryNotFoundError when the target repo has no entry', () => {
    const current: ReposFile = {version: 1, repos: []}

    // #when resetting a nonexistent entry
    // #then the shared RepoEntryNotFoundError surfaces (same typed error used by recordSurveyResult)
    expect(() => resetSurveyResult(current, {owner: 'ghost', repo: 'nowhere'})).toThrow(RepoEntryNotFoundError)
  })

  // Cadence model: reset clears next_survey_eligible_at so onboarded entries are dispatched again
  // Recovery contract under cadence: reset MUST clear next_survey_eligible_at, otherwise an
  // onboarded entry's dispatch gate (isEligibleForSurvey) silently keeps the entry blocked
  // until the eligibility date passes — defeating the recovery primitive.
  it('clears next_survey_eligible_at to null so onboarded entries become dispatch-eligible immediately', () => {
    // #given an onboarded entry with a future eligibility date set by a successful survey
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-01',
          onboarding_status: 'onboarded',
          last_survey_at: '2026-05-01',
          last_survey_status: 'success',
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: '2026-05-31',
        },
      ],
    }

    // #when the entry is reset
    const result = resetSurveyResult(current, {owner: 'alice', repo: 'project'})

    // #then all three survey-tracking fields are null
    expect(result.repos[0]?.last_survey_at).toBeNull()
    expect(result.repos[0]?.last_survey_status).toBeNull()
    expect(result.repos[0]?.next_survey_eligible_at).toBeNull()
    // #and other fields are preserved (onboarded status, channel)
    expect(result.repos[0]?.onboarding_status).toBe('onboarded')
    expect(result.repos[0]?.discovery_channel).toBe('collab')
  })
})

describe('computeNextEligibleAt', () => {
  // Determinism: same (owner, repo, baseDate) yields the same output across calls
  it('is deterministic for the same inputs', () => {
    const baseDate = new Date('2026-05-01T00:00:00Z')
    const a = computeNextEligibleAt({owner: 'alice', repo: 'project', channel: 'collab', baseDate})
    const b = computeNextEligibleAt({owner: 'alice', repo: 'project', channel: 'collab', baseDate})
    expect(a).toBe(b)
  })

  // Per-channel base interval: collab = 30d
  it('returns an ISO date 30..33 days after baseDate for collab channel', () => {
    const baseDate = new Date('2026-05-01T12:00:00Z')
    const result = computeNextEligibleAt({owner: 'alice', repo: 'project', channel: 'collab', baseDate})
    const resultMs = Date.parse(`${result}T00:00:00Z`)
    const baseMs = Date.parse('2026-05-01T00:00:00Z')
    const diffDays = (resultMs - baseMs) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeGreaterThanOrEqual(30)
    expect(diffDays).toBeLessThanOrEqual(33)
  })

  // Per-channel base interval: owned = 14d
  it('returns an ISO date 14..17 days after baseDate for owned channel', () => {
    const baseDate = new Date('2026-05-01T12:00:00Z')
    const result = computeNextEligibleAt({owner: 'fro-bot', repo: 'agent', channel: 'owned', baseDate})
    const resultMs = Date.parse(`${result}T00:00:00Z`)
    const baseMs = Date.parse('2026-05-01T00:00:00Z')
    const diffDays = (resultMs - baseMs) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeGreaterThanOrEqual(14)
    expect(diffDays).toBeLessThanOrEqual(17)
  })

  // Per-channel base interval: contrib = 21d
  it('returns an ISO date 21..24 days after baseDate for contrib channel', () => {
    const baseDate = new Date('2026-05-01T12:00:00Z')
    const result = computeNextEligibleAt({owner: 'bfra-me', repo: '.github', channel: 'contrib', baseDate})
    const resultMs = Date.parse(`${result}T00:00:00Z`)
    const baseMs = Date.parse('2026-05-01T00:00:00Z')
    const diffDays = (resultMs - baseMs) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeGreaterThanOrEqual(21)
    expect(diffDays).toBeLessThanOrEqual(24)
  })

  // Midnight stability contract: seed is YYYY-MM-DD slice, NOT the Date object.
  // Two calls 50ms apart on the same UTC date produce the same output.
  // Two calls on opposite sides of UTC midnight produce DIFFERENT outputs.
  it('uses the YYYY-MM-DD slice of baseDate as the seed (midnight-stable)', () => {
    // Same UTC date, 50ms apart → same seed → same output
    const sameDay1 = computeNextEligibleAt({
      owner: 'alice',
      repo: 'project',
      channel: 'collab',
      baseDate: new Date('2026-05-05T12:00:00.000Z'),
    })
    const sameDay2 = computeNextEligibleAt({
      owner: 'alice',
      repo: 'project',
      channel: 'collab',
      baseDate: new Date('2026-05-05T12:00:00.050Z'),
    })
    expect(sameDay1).toBe(sameDay2)

    // Opposite sides of midnight → different YYYY-MM-DD → seeds differ → outputs differ.
    // Exact outputs computed offline using the same SHA-256 + first-4-bytes-uint32 + mod-4
    // formula. Pinning exact outputs (vs a tolerance) ensures any drift in seed format,
    // hash algorithm, or jitter modulus is caught immediately.
    //
    // alice/project @ 2026-05-04 collab → 2026-06-05 (30d + 2d jitter)
    // alice/project @ 2026-05-05 collab → 2026-06-06 (30d + 2d jitter)
    // Same jitter bucket here, but the +1d shift in baseDate carries through.
    const beforeMidnight = computeNextEligibleAt({
      owner: 'alice',
      repo: 'project',
      channel: 'collab',
      baseDate: new Date('2026-05-04T23:59:59.999Z'),
    })
    const afterMidnight = computeNextEligibleAt({
      owner: 'alice',
      repo: 'project',
      channel: 'collab',
      baseDate: new Date('2026-05-05T00:00:00.001Z'),
    })
    expect(beforeMidnight).toBe('2026-06-05')
    expect(afterMidnight).toBe('2026-06-06')
    expect(beforeMidnight).not.toBe(afterMidnight)
  })

  // Different repo pairs at the same baseDate produce different jitter (sample distribution check)
  it('produces different jitter values across distinct (owner, repo) pairs', () => {
    const baseDate = new Date('2026-05-01T12:00:00Z')
    const results = [
      computeNextEligibleAt({owner: 'alice', repo: 'one', channel: 'collab', baseDate}),
      computeNextEligibleAt({owner: 'alice', repo: 'two', channel: 'collab', baseDate}),
      computeNextEligibleAt({owner: 'bob', repo: 'one', channel: 'collab', baseDate}),
      computeNextEligibleAt({owner: 'bob', repo: 'two', channel: 'collab', baseDate}),
      computeNextEligibleAt({owner: 'carol', repo: 'three', channel: 'collab', baseDate}),
    ]
    // Across 5 distinct pairs, expect at least 2 distinct outputs (jitter range is 0..3 days).
    const distinct = new Set(results)
    expect(distinct.size).toBeGreaterThanOrEqual(2)
  })

  // Output format: ISO YYYY-MM-DD only, no time component
  it('returns ISO date strings of the form YYYY-MM-DD', () => {
    const result = computeNextEligibleAt({
      owner: 'alice',
      repo: 'project',
      channel: 'collab',
      baseDate: new Date('2026-05-01T00:00:00Z'),
    })
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // Exact-output pinning per channel: locks the deterministic SHA-256 jitter formula
  // to specific outputs. If any of these break, the seed format, hash algorithm, or
  // jitter modulus changed silently — range-regex tests would have missed it.
  it('produces exact deterministic outputs for pinned (owner, repo, channel, baseDate) fixtures', () => {
    expect(
      computeNextEligibleAt({
        owner: 'alice',
        repo: 'project',
        channel: 'collab',
        baseDate: new Date('2026-05-01T12:00:00Z'),
      }),
    ).toBe('2026-06-03')

    expect(
      computeNextEligibleAt({
        owner: 'fro-bot',
        repo: 'agent',
        channel: 'owned',
        baseDate: new Date('2026-05-01T12:00:00Z'),
      }),
    ).toBe('2026-05-15')

    expect(
      computeNextEligibleAt({
        owner: 'bfra-me',
        repo: '.github',
        channel: 'contrib',
        baseDate: new Date('2026-05-01T12:00:00Z'),
      }),
    ).toBe('2026-05-22')
  })

  // Year-boundary arithmetic: 2026-12-31 + 30d + jitter must roll into 2027 correctly.
  // Pins MS-based date math against a future refactor to component-based date arithmetic
  // (e.g., setUTCDate) that could regress month/year-boundary edges undetected.
  it('handles year-boundary arithmetic correctly', () => {
    // Computed offline: alice/project @ 2026-12-31 collab = 2027-02-02 (30d + 3d jitter)
    expect(
      computeNextEligibleAt({
        owner: 'alice',
        repo: 'project',
        channel: 'collab',
        baseDate: new Date('2026-12-31T12:00:00Z'),
      }),
    ).toBe('2027-02-02')
  })
})

describe('recordSurveyResult — next_survey_eligible_at', () => {
  // Cadence wiring: success outcome writes next_survey_eligible_at via computeNextEligibleAt
  it('sets next_survey_eligible_at on successful survey using collab interval', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const at = new Date('2026-05-01T12:00:00Z')
    const result = recordSurveyResult(current, {owner: 'alice', repo: 'project', at, status: 'success'})

    const eligibleAt = result.repos[0]?.next_survey_eligible_at
    expect(eligibleAt).not.toBeNull()
    // Collab base 30d + jitter 0..3 → 2026-05-31..2026-06-03
    expect(eligibleAt).toMatch(/^2026-(05-31|06-0[1-3])$/)
  })

  // Cadence wiring: failure outcome ALSO writes next_survey_eligible_at (using same formula)
  it('sets next_survey_eligible_at on failed survey using the same formula', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const at = new Date('2026-05-01T12:00:00Z')
    const result = recordSurveyResult(current, {owner: 'alice', repo: 'project', at, status: 'failure'})

    const eligibleAt = result.repos[0]?.next_survey_eligible_at
    expect(eligibleAt).not.toBeNull()
    expect(eligibleAt).toMatch(/^2026-(05-31|06-0[1-3])$/)
  })

  // Cadence wiring: per-channel intervals — owned uses 14d
  it('uses owned-channel interval (14d) for an owned-channel entry', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'agent',
          added: '2026-04-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'owned',
          next_survey_eligible_at: null,
        },
      ],
    }

    const at = new Date('2026-05-01T12:00:00Z')
    const result = recordSurveyResult(current, {owner: 'fro-bot', repo: 'agent', at, status: 'success'})

    const eligibleAt = result.repos[0]?.next_survey_eligible_at
    expect(eligibleAt).not.toBeNull()
    // Owned base 14d + jitter 0..3 → 2026-05-15..2026-05-18
    expect(eligibleAt).toMatch(/^2026-05-1[5-8]$/)
  })

  // Cadence wiring: per-channel intervals — contrib uses 21d
  it('uses contrib-channel interval (21d) for a contrib-channel entry', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'bfra-me',
          name: '.github',
          added: '2026-04-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'contrib',
          next_survey_eligible_at: null,
        },
      ],
    }

    const at = new Date('2026-05-01T12:00:00Z')
    const result = recordSurveyResult(current, {owner: 'bfra-me', repo: '.github', at, status: 'success'})

    const eligibleAt = result.repos[0]?.next_survey_eligible_at
    expect(eligibleAt).not.toBeNull()
    // Contrib base 21d + jitter 0..3 → 2026-05-22..2026-05-25
    expect(eligibleAt).toMatch(/^2026-05-2[2-5]$/)
  })

  // Cadence wiring: legacy entry (discovery_channel undefined) falls back to collab interval
  // Pins the contract that the `match.discovery_channel ?? 'collab'` fallback in recordSurveyResult
  // exists for: legacy entries without the field still get a valid eligibility date computed.
  it('uses collab interval (30d) for legacy entries with discovery_channel undefined', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'legacy-repo',
          added: '2026-01-01',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          // discovery_channel intentionally omitted — simulates a legacy entry
          // that hasn't been migrated to the cadence model yet.
          next_survey_eligible_at: null,
        },
      ],
    }

    const at = new Date('2026-05-01T12:00:00Z')
    const result = recordSurveyResult(current, {owner: 'alice', repo: 'legacy-repo', at, status: 'success'})

    const eligibleAt = result.repos[0]?.next_survey_eligible_at
    expect(eligibleAt).not.toBeNull()
    // Collab fallback: base 30d + jitter 0..3 → 2026-05-31..2026-06-03
    expect(eligibleAt).toMatch(/^2026-(05-31|06-0[1-3])$/)
  })

  // Cadence wiring: pending → onboarded promotion still works alongside next_survey_eligible_at write
  it('still promotes pending → onboarded on first success while writing next_survey_eligible_at', () => {
    const current: ReposFile = {
      version: 1,
      repos: [
        {
          owner: 'alice',
          name: 'project',
          added: '2026-04-01',
          onboarding_status: 'pending',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
        },
      ],
    }

    const at = new Date('2026-05-01T12:00:00Z')
    const result = recordSurveyResult(current, {owner: 'alice', repo: 'project', at, status: 'success'})

    expect(result.repos[0]?.onboarding_status).toBe('onboarded')
    expect(result.repos[0]?.next_survey_eligible_at).not.toBeNull()
  })
})
