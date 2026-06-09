import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {deriveCounts} from './daily-digest-counts.ts'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

// TODAY is the injected "todayUtc" clock value passed to deriveCounts.
// YESTERDAY is the prior UTC day — the window deriveCounts now counts surveys in.
const TODAY = '2026-06-08'
const YESTERDAY = '2026-06-07'

function makeYaml(repos: object[]): string {
  const lines = ['version: 1', 'repos:']
  for (const repo of repos) {
    const entries = Object.entries(repo as Record<string, unknown>)
    if (entries.length === 0) {
      lines.push('  - {}')
      continue
    }
    const [first, ...rest] = entries
    if (first !== undefined) {
      lines.push(`  - ${first[0]}: ${JSON.stringify(first[1])}`)
    }
    for (const [k, v] of rest) {
      lines.push(`    ${k}: ${JSON.stringify(v)}`)
    }
  }
  return lines.join('\n')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deriveCounts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Happy path ───────────────────────────────────────────────────────────

  it('happy path: 3 public + 1 private, 2 surveyed yesterday → repos_tracked:3, surveys_today:2, should_post:true', () => {
    // surveys_today counts the PRIOR UTC day (yesterdayUtc), not todayUtc.
    // Entries with last_survey_at == YESTERDAY are the settled prior-day count.
    const yaml = makeYaml([
      {owner: 'acme', name: 'alpha', private: false, last_survey_at: YESTERDAY},
      {owner: 'acme', name: 'beta', private: false, last_survey_at: YESTERDAY},
      {owner: 'acme', name: 'gamma', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'private-repo', private: true, last_survey_at: YESTERDAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 3,
      surveys_today: 2,
      should_post: true,
      count_status: 'ok',
    })
  })

  // ─── Zero prior-day surveys still posts ───────────────────────────────────

  it('zero prior-day surveys → surveys_today:0, should_post:true (posts anyway on count_status:ok)', () => {
    // should_post is now count_status === 'ok', not surveysToday > 0.
    // A quiet day is valid signal — the digest fires regardless.
    const yaml = makeYaml([
      {owner: 'acme', name: 'alpha', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'beta', private: false, last_survey_at: TODAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 2,
      surveys_today: 0,
      should_post: true,
      count_status: 'ok',
    })
  })

  // ─── Private excluded from repos_tracked ─────────────────────────────────

  it('private entries are excluded from repos_tracked', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'pub', private: false, last_survey_at: YESTERDAY},
      {owner: 'acme', name: 'priv', private: true, last_survey_at: YESTERDAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result.repos_tracked).toBe(1)
    expect(result.count_status).toBe('ok')
  })

  // ─── Missing `private` not counted as public ──────────────────────────────

  it('entry missing `private` field is NOT counted as public (repos_tracked)', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'pub', private: false, last_survey_at: YESTERDAY},
      // no `private` key at all
      {owner: 'acme', name: 'unknown', last_survey_at: YESTERDAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    // Only the explicitly-public entry counts
    expect(result.repos_tracked).toBe(1)
    expect(result.count_status).toBe('ok')
  })

  // ─── Empty repos ─────────────────────────────────────────────────────────

  it('empty repos list → zeros, should_post:true (count_status:ok), no throw', () => {
    // Empty repos is a valid read — should_post:true because count_status:ok.
    const yaml = 'version: 1\nrepos: []\n'

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 0,
      surveys_today: 0,
      should_post: true,
      count_status: 'ok',
    })
  })

  // ─── Missing/malformed file → count_status:'error' ───────────────────────

  it('null/undefined input → count_status:error, should_post:false, no throw', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const result = deriveCounts(null as unknown as string, TODAY)

    expect(result.count_status).toBe('error')
    expect(result.should_post).toBe(false)
    expect(result.repos_tracked).toBe(0)
    expect(result.surveys_today).toBe(0)
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('malformed YAML → count_status:error, should_post:false, no throw', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const result = deriveCounts('{not: valid: yaml: [}', TODAY)

    expect(result.count_status).toBe('error')
    expect(result.should_post).toBe(false)
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('YAML with no repos key → count_status:error, should_post:false, no throw', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const result = deriveCounts('version: 1\n', TODAY)

    expect(result.count_status).toBe('error')
    expect(result.should_post).toBe(false)
    expect(stderrSpy).toHaveBeenCalled()
  })

  // ─── count_status:'error' distinguishable from quiet day ─────────────────

  it('count_status:error is distinguishable from a genuine quiet day (should_post:true, count_status:ok)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const errorResult = deriveCounts(null as unknown as string, TODAY)
    // A quiet day: no surveys on YESTERDAY — but count_status is ok, so should_post:true.
    const quietResult = deriveCounts(
      makeYaml([{owner: 'acme', name: 'pub', private: false, last_survey_at: TODAY}]),
      TODAY,
    )

    // Error path: should_post:false, count_status:error
    expect(errorResult.should_post).toBe(false)
    expect(errorResult.count_status).toBe('error')

    // Quiet day: should_post:true (posts anyway), count_status:ok
    expect(quietResult.should_post).toBe(true)
    expect(quietResult.count_status).toBe('ok')

    stderrSpy.mockRestore()
  })

  // ─── UTC date boundary ────────────────────────────────────────────────────

  it('UTC date boundary: yesterday counts, today does NOT (fixed clock)', () => {
    // deriveCounts(yaml, TODAY) should count last_survey_at == YESTERDAY, not TODAY.
    const yaml = makeYaml([
      {owner: 'acme', name: 'surveyed-yesterday', private: false, last_survey_at: YESTERDAY},
      {owner: 'acme', name: 'surveyed-today', private: false, last_survey_at: TODAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result.surveys_today).toBe(1)
    expect(result.should_post).toBe(true)
  })

  it('UTC date boundary: when clock advances, prior-day window shifts correctly', () => {
    // When todayUtc is '2026-06-09', yesterdayUtc is '2026-06-08' (== TODAY).
    // The entry with last_survey_at == TODAY should now be counted.
    const yaml = makeYaml([
      {owner: 'acme', name: 'surveyed-today', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'surveyed-yesterday', private: false, last_survey_at: YESTERDAY},
    ])

    // Advance "today" by one day — TODAY becomes yesterday
    const result = deriveCounts(yaml, '2026-06-09')

    expect(result.surveys_today).toBe(1) // TODAY entry now matches as yesterday
    expect(result.should_post).toBe(true)
    expect(result.count_status).toBe('ok')
  })

  // ─── Month and year boundary yesterday derivation ─────────────────────────

  it('month boundary: todayUtc=2026-03-01 → yesterdayUtc=2026-02-28 (non-leap year)', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'feb28', private: false, last_survey_at: '2026-02-28'},
      {owner: 'acme', name: 'mar01', private: false, last_survey_at: '2026-03-01'},
    ])

    const result = deriveCounts(yaml, '2026-03-01')

    expect(result.surveys_today).toBe(1) // only feb28 matches
    expect(result.should_post).toBe(true)
    expect(result.count_status).toBe('ok')
  })

  it('month boundary: todayUtc=2024-03-01 → yesterdayUtc=2024-02-29 (leap year)', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'feb29', private: false, last_survey_at: '2024-02-29'},
      {owner: 'acme', name: 'mar01', private: false, last_survey_at: '2024-03-01'},
    ])

    const result = deriveCounts(yaml, '2024-03-01')

    expect(result.surveys_today).toBe(1) // only feb29 matches
    expect(result.should_post).toBe(true)
    expect(result.count_status).toBe('ok')
  })

  it('year boundary: todayUtc=2026-01-01 → yesterdayUtc=2025-12-31', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'dec31', private: false, last_survey_at: '2025-12-31'},
      {owner: 'acme', name: 'jan01', private: false, last_survey_at: '2026-01-01'},
    ])

    const result = deriveCounts(yaml, '2026-01-01')

    expect(result.surveys_today).toBe(1) // only dec31 matches
    expect(result.should_post).toBe(true)
    expect(result.count_status).toBe('ok')
  })

  // ─── Malformed repos[] elements → count_status:'error' (Fix B) ───────────

  it('repos:[null] → count_status:error (malformed entry, not silent skip)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // Raw YAML with a null element in repos array
    const yaml = 'version: 1\nrepos:\n  - ~\n'

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 0,
      surveys_today: 0,
      should_post: false,
      count_status: 'error',
    })
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('repos:["x"] (scalar string element) → count_status:error (malformed entry)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // Raw YAML with a scalar string element in repos array
    const yaml = 'version: 1\nrepos:\n  - "x"\n'

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 0,
      surveys_today: 0,
      should_post: false,
      count_status: 'error',
    })
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('repos:[[...]] (array element) → count_status:error (not a silent quiet day)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // YAML where a repos element is itself an array — typeof [] === 'object' so the
    // old guard missed this; the Array.isArray() addition closes the gap.
    const yaml = 'version: 1\nrepos:\n  - - owner: acme\n    - name: alpha\n'

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 0,
      surveys_today: 0,
      should_post: false,
      count_status: 'error',
    })
    expect(stderrSpy).toHaveBeenCalled()
  })

  // ─── Strengthen missing-private test (full exact result object) ───────────

  it('entry missing `private` field — full exact result object', () => {
    // The explicitly-public entry has last_survey_at == YESTERDAY → counted.
    // The unknown-private entry is excluded from repos_tracked entirely.
    const yaml = makeYaml([
      {owner: 'acme', name: 'pub', private: false, last_survey_at: YESTERDAY},
      // no `private` key at all
      {owner: 'acme', name: 'unknown', last_survey_at: YESTERDAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 1,
      surveys_today: 1,
      should_post: true,
      count_status: 'ok',
    })
  })
})
