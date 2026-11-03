/**
 * Scaling guards for the regexes that GitHub-controlled or agent-controlled text reaches through an
 * exported function of this package: issue bodies (the wiki-lint markers), wiki and solution page
 * bodies, PR titles and bodies (query tokens), git status output and query text.
 *
 * Each case builds an input that is the worst shape for a pattern with adjacent or overlapping
 * quantifiers, in one long run and as many separate matches in one document, and asserts that
 * quadrupling it does not multiply the time by sixteen. A quadratic operation costs about 16x per
 * quadrupling and a linear one about 4x, so the ceiling of 8x leaves a factor of two on both sides.
 *
 * The time at each size is the best of three timings, taken adjacent in time. Contention only adds
 * time, so the best run is the one least disturbed. The operation repeats until the smaller size takes
 * long enough to read.
 *
 * The rule: a case measures the growth ratio up to three times and passes at the first measurement under
 * the ceiling. A linear operation measures about 4x, but a call that takes well under a millisecond at the
 * small size lets one scheduler or collection pause push a single ratio over the ceiling; that noise is
 * independent between measurements, so a retry clears it. A quadratic operation measures about 16x on
 * every attempt and never drops under 8x, so every attempt fails and the case fails. The small size is
 * repeated until it takes 50 ms of CPU time, capped at 4,096 repetitions.
 */

import {Buffer} from 'node:buffer'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {assembleSolutionsContext} from './solutions-query.ts'
import {validateQuery} from './wiki-context-expand.ts'
import {parseGitStatusPorcelainZ} from './wiki-handoff-core.ts'
import {planIssueLifecycle} from './wiki-lint-issues.ts'
import {assembleWikiContext} from './wiki-query.ts'

const BEST_OF = 3
const READABLE_MILLISECONDS = 50
const MAXIMUM_REPETITIONS = 4096
const ATTEMPTS = 3
const GROWTH = 4
const CEILING = 8
// A quadratic operation on the largest input here takes a few seconds, three times at each size.
const SUITE_TIMEOUT_MILLISECONDS = 120_000

function cpuMilliseconds(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) operation()
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1_000
}

function bestMilliseconds(operation: () => void, repetitions: number): number {
  return Math.min(...Array.from({length: BEST_OF}, () => cpuMilliseconds(operation, repetitions)))
}

function repetitionsToRead(operation: () => void): number {
  let repetitions = 1
  while (cpuMilliseconds(operation, repetitions) < READABLE_MILLISECONDS && repetitions < MAXIMUM_REPETITIONS) {
    repetitions *= 2
  }
  return repetitions
}

/** One measurement: time at four times the size over time at the size, each the best of three. */
function measureGrowth(make: (size: number) => string, size: number, run: (input: string) => void): number {
  const small = make(size)
  const large = make(size * GROWTH)
  const runSmall = () => {
    run(small)
  }
  const runLarge = () => {
    run(large)
  }
  runSmall()
  runLarge()
  const repetitions = repetitionsToRead(runSmall)
  const smallTime = bestMilliseconds(runSmall, repetitions)
  const largeTime = bestMilliseconds(runLarge, repetitions)
  return largeTime / Math.max(smallTime, 0.01)
}

/**
 * The growth ratio, measured up to ATTEMPTS times, stopping at the first measurement under the ceiling.
 * A linear operation sits at 4x, but a sub-millisecond call at the small size lets one scheduler or
 * collection pause swing a single ratio past the ceiling. That noise is independent between
 * measurements, so a linear case passes on a retry. A quadratic operation measures about 16x every
 * time, so every attempt stays over the ceiling and the case still fails. Returns the smallest ratio.
 */
function growthRatio(make: (size: number) => string, size: number, run: (input: string) => void): number {
  let smallest = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    smallest = Math.min(smallest, measureGrowth(make, size, run))
    if (smallest < CEILING) break
  }
  return smallest
}

const repeat = (unit: string) => (size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

const SMALL = 20_000
const FRONTMATTER = '---\ntype: topic\ntitle: T\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n'

const REPORT = {
  schema_version: 1,
  fingerprint_version: 1,
  status: 'clean',
  scan_complete: true,
  snapshot_sha: null,
  generated_at: '2026-11-01T00:00:00.000Z',
  failure_class: null,
  repair_eligible: false,
  findings: [],
  freshness: [],
  counts: {findings_total: 0, findings_deterministic: 0, findings_advisory: 0, pages_scanned: 0, pages_stale: 0},
} as const

/** The lint markers read an issue body: the fingerprint and the failure-class patterns. */
function readIssueBody(body: string): void {
  planIssueLifecycle({
    report: REPORT,
    openIssues: [{number: 1, state: 'open', body}],
    recentlyClosedIssues: [{number: 2, state: 'closed', body}],
  })
}

describe('the wiki-lint issue markers scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'unclosed fingerprint prefixes repeated', make: repeat('<!-- wiki-lint:subject:fingerprint=abc ')},
    {
      name: 'one fingerprint prefix and a long hex run with no close',
      make: (size: number) => `<!-- wiki-lint:subject:fingerprint=${'a'.repeat(size)}`,
    },
    {
      name: 'many fingerprint prefixes, each with a hex run',
      make: repeat(`<!-- wiki-lint:subject:fingerprint=${'a'.repeat(50)} `),
    },
    {
      name: 'one failure-class prefix and a long run with no close',
      make: (size: number) => `<!-- wiki-lint:subject:failure-class=${'a-'.repeat(size / 2)}`,
    },
    {name: 'unclosed failure-class prefixes repeated', make: repeat('<!-- wiki-lint:subject:failure-class=a')},
  ])('$name', ({make}) => {
    expect(growthRatio(make, SMALL, readIssueBody)).toBeLessThan(CEILING)
  })
})

describe('the query token and whitespace patterns scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const query = (text: string) => {
    assembleWikiContext({
      files: {'knowledge/wiki/topics/a.md': `${FRONTMATTER}${text}`},
      event: {eventName: 'issues', owner: 'o', repo: 'r', title: text, body: text},
    })
  }
  it.each([
    {name: 'a whitespace run then x', make: (size: number) => `${' '.repeat(size)}x`},
    {name: 'alternating whitespace and x', make: repeat(' x')},
    {name: 'a run of non-alphanumerics then a', make: (size: number) => `${'!'.repeat(size)}a`},
    {name: 'dashes then x', make: (size: number) => `${'-'.repeat(size)}x`},
    {name: 'alternating dash and x', make: repeat('-x')},
  ])('wiki-query: $name', ({make}) => {
    expect(growthRatio(make, SMALL, query)).toBeLessThan(CEILING)
  })
})

describe('the repository slug trim scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  // `slugify` runs on the event's owner and repo, so the text goes in as both.
  const slug = (text: string) => {
    assembleWikiContext({files: {}, event: {eventName: 'issues', owner: text, repo: text}})
  }
  it.each([
    {name: 'a dash run then x', make: (size: number) => `${'-'.repeat(size)}x`},
    {name: 'alternating dash and x', make: repeat('-x')},
    {name: 'x then a dash run', make: (size: number) => `x${'-'.repeat(size)}`},
    {name: 'a dash run between two x', make: (size: number) => `x${'-'.repeat(size)}x`},
    {name: 'alternating underscore and dash', make: repeat('_-')},
    {name: 'a dash run and nothing else', make: (size: number) => '-'.repeat(size)},
  ])('slugify: $name', ({make}) => {
    expect(growthRatio(make, SMALL, slug)).toBeLessThan(CEILING)
  })
})

/**
 * A solution document that the event selects (its title and body hold the event token) and whose body is
 * `text`, with a byte budget just under the section, so `assembleSolutionsContext` truncates it: the
 * truncation strips trailing replacement characters with a pattern, and that pattern only runs on the
 * truncated section. The extra `x` tail keeps the cut inside the document, after `text`.
 */
const SOLUTION_PATH = 'docs/solutions/best-practices/a.md'
const SOLUTION_TAIL = 'x'.repeat(2000)

function solutionsContext(text: string, withFrontmatter = true) {
  const body = `monorepo ${text}${SOLUTION_TAIL}`
  const content = withFrontmatter ? `---\ntitle: monorepo\nproblem_type: build_error\n---\n\n${body}` : body
  return assembleSolutionsContext({
    files: {[SOLUTION_PATH]: content, 'docs/solutions/best-practices/b.md': text},
    event: {eventName: 'x', title: 'monorepo', body: 'monorepo'},
    privateNames: ['o/r'],
    now: new Date('2026-11-01T00:00:00.000Z'),
    // The section is about 130 bytes longer than the body; this budget cuts it inside the `x` tail.
    maxBytes: Buffer.byteLength(body, 'utf8') + 60,
  })
}

const SOLUTION_CASES = [
  {name: 'a frontmatter fence with no close', make: (size: number) => `---\n${repeat('a\n')(size)}`},
  {name: 'a frontmatter fence and repeated fence-like lines', make: (size: number) => `---\n${repeat('\n---x')(size)}`},
  {name: 'a whitespace run then x', make: (size: number) => `${' '.repeat(size)}x`},
  {name: 'a run of replacement characters then a', make: (size: number) => `${'\uFFFD'.repeat(size)}a`},
  {name: 'replacement characters alternating with a', make: repeat('\uFFFDa')},
  {name: 'a replacement run of 50 then a, repeated', make: repeat(`${'\uFFFD'.repeat(50)}a`)},
]

describe('the solution page patterns scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each(SOLUTION_CASES)('solutions-query: $name', ({make}) => {
    expect(growthRatio(make, SMALL, text => solutionsContext(text))).toBeLessThan(CEILING)
  })

  // The documents must reach the truncation, or the replacement-character cases measure nothing. A
  // truncated section ends in the ellipsis, keeps the replacement run it was cut inside, and is selected.
  it.each(SOLUTION_CASES.filter(({name}) => name.includes('replacement')))(
    'solutions-query: $name reaches the truncation that strips trailing replacement characters',
    ({make}) => {
      const result = solutionsContext(make(SMALL))
      expect(result.selectedPaths).toEqual([SOLUTION_PATH])
      expect(result.excerpt.endsWith('\u2026')).toBe(true)
      expect(result.excerpt.split('\uFFFD').length - 1).toBeGreaterThan(SMALL / 4)
      expect(result.excerpt).not.toContain(SOLUTION_TAIL)
    },
  )
})

describe('git status parsing scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'NUL-separated short fields', make: repeat('a\0')},
    {name: 'records with renames', make: repeat('R  new.md\0old.md\0')},
    {name: 'one long path', make: (size: number) => ` M ${'a/'.repeat(size / 2)}\0`},
  ])('$name', ({make}) => {
    expect(growthRatio(make, SMALL, input => parseGitStatusPorcelainZ(input))).toBeLessThan(CEILING)
  })
})

describe('query validation is capped before any pattern runs', () => {
  it.each([
    {name: 'a long run after "ignore"', make: (size: number) => `ignore${' '.repeat(size)}x`},
    {name: 'repeated "ignore all"', make: repeat('ignore all ')},
    {name: 'a long run after "system"', make: (size: number) => `system${' '.repeat(size)}x`},
  ])('$name is rejected at the length cap in constant time', ({make}) => {
    const startedAt = process.cpuUsage()
    const verdict = validateQuery(make(1_000_000))
    const elapsed = process.cpuUsage(startedAt)
    expect(verdict).toEqual({valid: false})
    expect((elapsed.user + elapsed.system) / 1_000).toBeLessThan(50)
  })
})
