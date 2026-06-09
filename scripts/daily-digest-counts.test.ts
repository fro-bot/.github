import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {deriveCounts} from './daily-digest-counts.ts'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

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

  it('happy path: 3 public + 1 private, 2 surveyed today → repos_tracked:3, surveys_today:2, should_post:true', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'alpha', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'beta', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'gamma', private: false, last_survey_at: YESTERDAY},
      {owner: 'acme', name: 'private-repo', private: true, last_survey_at: TODAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 3,
      surveys_today: 2,
      should_post: true,
      count_status: 'ok',
    })
  })

  // ─── Quiet day ────────────────────────────────────────────────────────────

  it('quiet day: 0 surveyed today → surveys_today:0, should_post:false, count_status:ok', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'alpha', private: false, last_survey_at: YESTERDAY},
      {owner: 'acme', name: 'beta', private: false, last_survey_at: YESTERDAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 2,
      surveys_today: 0,
      should_post: false,
      count_status: 'ok',
    })
  })

  // ─── Private excluded from repos_tracked ─────────────────────────────────

  it('private entries are excluded from repos_tracked', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'pub', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'priv', private: true, last_survey_at: TODAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result.repos_tracked).toBe(1)
    expect(result.count_status).toBe('ok')
  })

  // ─── Missing `private` not counted as public ──────────────────────────────

  it('entry missing `private` field is NOT counted as public (repos_tracked)', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'pub', private: false, last_survey_at: TODAY},
      // no `private` key at all
      {owner: 'acme', name: 'unknown', last_survey_at: TODAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    // Only the explicitly-public entry counts
    expect(result.repos_tracked).toBe(1)
    expect(result.count_status).toBe('ok')
  })

  // ─── Empty repos ─────────────────────────────────────────────────────────

  it('empty repos list → zeros, should_post:false, no throw', () => {
    const yaml = 'version: 1\nrepos: []\n'

    const result = deriveCounts(yaml, TODAY)

    expect(result).toEqual({
      repos_tracked: 0,
      surveys_today: 0,
      should_post: false,
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

  it('count_status:error is distinguishable from a genuine quiet day (should_post:false, count_status:ok)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const errorResult = deriveCounts(null as unknown as string, TODAY)
    const quietResult = deriveCounts(
      makeYaml([{owner: 'acme', name: 'pub', private: false, last_survey_at: YESTERDAY}]),
      TODAY,
    )

    // Both have should_post:false, but count_status differs
    expect(errorResult.should_post).toBe(false)
    expect(quietResult.should_post).toBe(false)
    expect(errorResult.count_status).toBe('error')
    expect(quietResult.count_status).toBe('ok')

    stderrSpy.mockRestore()
  })

  // ─── UTC date boundary ────────────────────────────────────────────────────

  it('UTC date boundary: today-UTC counts, yesterday does not (fixed clock)', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'surveyed-today', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'surveyed-yesterday', private: false, last_survey_at: YESTERDAY},
    ])

    const result = deriveCounts(yaml, TODAY)

    expect(result.surveys_today).toBe(1)
    expect(result.should_post).toBe(true)
  })

  it('UTC date boundary: when today is yesterday, neither entry counts', () => {
    const yaml = makeYaml([
      {owner: 'acme', name: 'surveyed-today', private: false, last_survey_at: TODAY},
      {owner: 'acme', name: 'surveyed-yesterday', private: false, last_survey_at: YESTERDAY},
    ])

    // Advance "today" to a future date — neither entry matches
    const result = deriveCounts(yaml, '2026-06-09')

    expect(result.surveys_today).toBe(0)
    expect(result.should_post).toBe(false)
    expect(result.count_status).toBe('ok')
  })
})
