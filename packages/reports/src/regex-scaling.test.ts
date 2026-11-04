/**
 * Scaling guards for the patterns that GitHub-controlled or agent-controlled text reaches through an
 * exported function of this package: the previous report issue body (version marker, edge checklist),
 * issue titles and solution-doc titles and modules (tokenizer), solution-doc frontmatter, the server URL
 * a run stamp prints, and the metadata file the daily digest parses.
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
 *
 * Every input must reach the code under test. The `reach` tests below pin that with an output assertion
 * for each case, so a case cannot pass because its input was rejected before the pattern ran.
 */

import process from 'node:process'
import {makePublicOutputTokens} from '@fro-bot/privacy/status-truth-public-output'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {deriveCounts} from './daily-digest-counts.ts'
import {
  buildClassKey,
  buildEdgeFingerprint,
  parseEdgeChecklistLine,
  parseLiveStateSummary,
  parseReportVersionMarker,
  recoverPriorTickState,
} from './improvement-metrics-core.ts'
import {splitFrontmatter, tokenizeText} from './improvement-metrics-detect.ts'
import {renderReportBody} from './improvement-metrics-report.ts'

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
// A 300-digit run is still a finite number, so a reach check can read it back through the parser.
const REACH_DIGITS = 300
const FINGERPRINT = 'a'.repeat(64)

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------------------------------------------
// The previous report issue body
// ---------------------------------------------------------------------------------------------------------------
const MARKER_CASES = [
  {
    name: 'one version prefix and a long digit run with no close',
    make: (size: number) => `<!-- improvement-metrics:report:version=${'1'.repeat(size)}`,
  },
  {
    name: 'one version prefix and a long minus run',
    make: (size: number) => `<!-- improvement-metrics:report:version=${'-'.repeat(size)}`,
  },
  {
    name: 'many version prefixes, each with digits and no close',
    make: repeat('<!-- improvement-metrics:report:version=11 '),
  },
]

const CHECKLIST_CASES = [
  {
    name: 'one edge prefix and a long hex run',
    make: (size: number) => `<!-- improvement-metrics:edge=${'a'.repeat(size)}`,
  },
  {
    name: 'many edge prefixes, each one hex digit short',
    make: repeat(`<!-- improvement-metrics:edge=${'a'.repeat(63)} `),
  },
  {name: 'a long line with no marker', make: (size: number) => `- [ ] ${' '.repeat(size)}`},
]

/**
 * The live-state pattern is anchored, so a scan is one attempt per input. The input has to get the digit runs
 * and the `-unchecked-` separator past the pattern and fail only at the end: a valid prefix, a long digit run,
 * then a suffix that breaks the `$`.
 */
const LIVE_STATE_CASES = [
  {
    name: 'a long first digit run, a valid rest and a failing suffix',
    make: (size: number) => `checked-${'1'.repeat(size)}-unchecked-1x`,
  },
  {
    name: 'a valid prefix, a long second digit run and a failing suffix',
    make: (size: number) => `checked-1-unchecked-${'1'.repeat(size)}x`,
  },
]

/** The input is rejected, and only by its last character: without it the summary parses with finite numbers. */
function liveStateReachesTheEnd(input: string): boolean {
  const accepted = parseLiveStateSummary(input.slice(0, -1))
  return (
    parseLiveStateSummary(input) === null &&
    accepted !== null &&
    Number.isFinite(accepted.checked) &&
    Number.isFinite(accepted.unchecked)
  )
}

/** Inputs of the shapes this suite used before: each is turned away before the scan has done any work. */
const OLD_LIVE_STATE_INPUTS = [
  {name: 'a digit run and a bare separator', input: `checked-${'1'.repeat(REACH_DIGITS)}-unchecked-`},
  {name: 'repeated bare summaries', input: repeat('checked-1-unchecked-')(REACH_DIGITS)},
]

/**
 * A frontmatter document of `prefix0: 1`, `prefix1: 1`, ... lines, which is valid YAML with distinct keys, so
 * the parsed mapping counts the lines the scan went past. The document has no closing fence.
 */
const keyed = (prefix: string) => (size: number) => {
  let text = '---\n'
  for (let index = 0; text.length < size; index += 1) text += `${prefix}${String(index)}: 1\n`
  return text
}

const FRONTMATTER_CASES = [
  {name: 'a fence and a long value', make: (size: number) => `---\na: ${'a'.repeat(size)}\n`},
  {name: 'a fence and many keyed lines', make: keyed('k')},
  {name: 'a fence and many lines that begin with two dashes', make: keyed('--')},
  {name: 'a fence and many lines that begin with one dash', make: keyed('-')},
]

/** Number of `key: value` lines between the opening fence and the end of `input`. */
const bodyLines = (input: string) => input.split('\n').length - 2

/**
 * The document never closes, so the lazy scan runs to its end: with a closing fence appended, the whole body
 * parses to a mapping that holds every line. A long value is one key.
 */
function frontmatterScanReachesTheEnd(input: string): boolean {
  if (Object.keys(splitFrontmatter(input)).length > 0) return false
  const closed = splitFrontmatter(`${input}---\n`)
  const expected = input.includes(': aaa') ? 1 : bodyLines(input)
  return expected > 0 && Object.keys(closed).length === expected
}

/** Inputs of the shapes this suite used before: the first fence-like line closed them, or no fence began them. */
const OLD_FRONTMATTER_INPUTS = [
  {name: 'repeated fence-like lines, which close at the first one', input: `---\n${repeat('\n---')(1000)}x`},
  {name: 'repeated near-closing lines that are not a mapping', input: `---\n${repeat('\n--x')(1000)}`},
  {name: 'a repeated duplicate key', input: `---\n${repeat('a: b\n')(1000)}`},
  {name: 'no fence at all', input: 'a'.repeat(1000)},
]

describe('the report issue body patterns scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each(MARKER_CASES)('version marker: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        parseReportVersionMarker(text)
      }),
    ).toBeLessThan(CEILING)
  })

  it.each(CHECKLIST_CASES)('checklist line: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        parseEdgeChecklistLine(text)
      }),
    ).toBeLessThan(CEILING)
  })

  it.each([
    {name: 'many ticked lines', make: repeat(`- [x] <!-- improvement-metrics:edge=${FINGERPRINT} -->\n`)},
    {
      name: 'many lines one hex digit short',
      make: repeat(`- [x] <!-- improvement-metrics:edge=${'a'.repeat(63)} -->\n`),
    },
    {name: 'one very long line', make: (size: number) => `- [x] ${'x'.repeat(size)}`},
  ])('prior tick recovery: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        recoverPriorTickState(text)
      }),
    ).toBeLessThan(CEILING)
  })

  it.each(LIVE_STATE_CASES)('live-state summary: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        parseLiveStateSummary(text)
      }),
    ).toBeLessThan(CEILING)
  })
})

describe('the class key and fingerprint guards scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'a long clean field', make: (size: number) => 'a'.repeat(size)},
    {name: 'a long field of printable characters', make: repeat('a/b.c-d_e ')},
  ])('buildClassKey: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        buildClassKey({module: text, component: text, problem_type: text})
      }),
    ).toBeLessThan(CEILING)
  })

  it('buildEdgeFingerprint: a long clean input', () => {
    expect(
      growthRatio(repeat('a/b.c-d_e '), SMALL, text => {
        buildEdgeFingerprint(text, text)
      }),
    ).toBeLessThan(CEILING)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Issue titles, solution-doc titles, modules and frontmatter
// ---------------------------------------------------------------------------------------------------------------
describe('the tokenizer and frontmatter patterns scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'a non-alphanumeric run then a word', make: (size: number) => `${'!'.repeat(size)}abc`},
    {name: 'a dash run then a word', make: (size: number) => `${'-'.repeat(size)}abc`},
    {name: 'a word then a dash run', make: (size: number) => `abc${'-'.repeat(size)}`},
    {name: 'alternating word and dash', make: repeat('abc-')},
    {name: 'alternating punctuation and letter', make: repeat('!a')},
  ])('tokenizeText: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        tokenizeText(text)
      }),
    ).toBeLessThan(CEILING)
  })

  it.each(FRONTMATTER_CASES)('splitFrontmatter: $name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        splitFrontmatter(text)
      }),
    ).toBeLessThan(CEILING)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The run stamp in the report body
// ---------------------------------------------------------------------------------------------------------------
describe('the workflow run URL in the report body scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const tokens = makePublicOutputTokens({privateTokens: new Set(), redactedCanonicalIds: new Set()})
  const digest = {
    windowDays: 90,
    anchors: 4,
    discovery: 3,
    priorDiscovery: 1,
    confirmedRecidivism: 0,
    backlogCount: 0,
    oldestPendingAgeDays: null,
    state: 'healthy',
  } as const

  /** The body a run renders when `GITHUB_SERVER_URL` is `serverUrl`. */
  function render(serverUrl: string): string {
    vi.stubEnv('GITHUB_SERVER_URL', serverUrl)
    vi.stubEnv('GITHUB_REPOSITORY', 'o/r')
    vi.stubEnv('GITHUB_RUN_ID', '7')
    return renderReportBody(digest, [], tokens, {generatedAt: new Date('2026-11-01T00:00:00Z')})
  }

  it.each([
    {name: 'a slash run then x', make: (size: number) => `${'/'.repeat(size)}x`},
    {name: 'x then a slash run', make: (size: number) => `x${'/'.repeat(size)}`},
    {name: 'alternating slashes and x', make: repeat('//x')},
    {name: 'a slash run and nothing else', make: (size: number) => '/'.repeat(size)},
    {name: 'a slash run between two x', make: (size: number) => `x${'/'.repeat(size)}x`},
  ])('$name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        render(text)
      }),
    ).toBeLessThan(CEILING)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The metadata file the daily digest parses
// ---------------------------------------------------------------------------------------------------------------
describe('the daily digest derivation scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  /** A document of whole entries, so no input is cut inside one. */
  const entries = (entry: string) => (size: number) => `repos:\n${entry.repeat(Math.ceil(size / entry.length))}`

  it.each([
    {name: 'many public repos', make: entries('  - {private: false, last_survey_at: 2026-10-31}\n')},
    {name: 'many private repos', make: entries('  - {private: true, last_survey_at: 2026-10-31}\n')},
  ])('$name', ({make}) => {
    expect(
      growthRatio(make, SMALL, text => {
        deriveCounts(text, '2026-11-01')
      }),
    ).toBeLessThan(CEILING)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Every scaling input reaches the code under test
// ---------------------------------------------------------------------------------------------------------------
describe('reach: each scaling input reaches the pattern it measures', () => {
  it.each(MARKER_CASES)('version marker: $name is read and has no closing text', ({make}) => {
    expect(parseReportVersionMarker(make(100))).toBeNull()
  })

  it('version marker: the closing text after a digit run is what makes it match', () => {
    expect(parseReportVersionMarker('<!-- improvement-metrics:report:version=12 -->')).toBe(12)
    expect(parseReportVersionMarker(`<!-- improvement-metrics:report:version=${'1'.repeat(40)}`)).toBeNull()
    expect(parseReportVersionMarker(`<!-- improvement-metrics:report:version=${'-'.repeat(40)}`)).toBeNull()
  })

  it.each(CHECKLIST_CASES)('checklist line: $name is read and has no complete marker', ({make}) => {
    expect(parseEdgeChecklistLine(make(200))).toBeNull()
  })

  it('checklist line: a complete marker in the same shape is found, so the cases above measure the scan', () => {
    expect(parseEdgeChecklistLine(`<!-- improvement-metrics:edge=${FINGERPRINT} -->`)).toEqual({
      fingerprint: FINGERPRINT,
      checked: false,
    })
    expect(recoverPriorTickState(`- [x] <!-- improvement-metrics:edge=${FINGERPRINT} -->\n`).size).toBe(1)
    expect(recoverPriorTickState(`- [x] <!-- improvement-metrics:edge=${'a'.repeat(63)} -->\n`).size).toBe(0)
  })

  it('live-state summary: a complete summary is found', () => {
    expect(parseLiveStateSummary('checked-3-unchecked-4')).toEqual({checked: 3, unchecked: 4})
  })

  it.each(LIVE_STATE_CASES)(
    'live-state summary: $name gets past both digit runs and fails only at the end',
    ({make}) => {
      expect(liveStateReachesTheEnd(make(REACH_DIGITS))).toBe(true)
      // The same shape at the scaling size, so the case measured is the case checked.
      expect(parseLiveStateSummary(make(SMALL))).toBeNull()
    },
  )

  it.each(OLD_LIVE_STATE_INPUTS)(
    'live-state summary: the old input $name is not reaching, so the check discriminates',
    ({input}) => {
      expect(liveStateReachesTheEnd(input)).toBe(false)
    },
  )

  it('class key and fingerprint: the long fields are accepted, so the guards scanned them', () => {
    const field = 'a/b.c-d_e '.repeat(50)
    expect(buildClassKey({module: field})).toContain(field)
    expect(buildEdgeFingerprint(field, field)).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('tokenizeText: each case yields the words it contains', () => {
    expect(tokenizeText(`${'!'.repeat(50)}abc`)).toEqual(['abc'])
    expect(tokenizeText(`abc${'-'.repeat(50)}`)).toEqual(['abc'])
    expect(tokenizeText('abc-'.repeat(3))).toEqual(['abc', 'abc', 'abc'])
    expect(tokenizeText('!a'.repeat(5))).toEqual([])
  })

  it('splitFrontmatter: a closed fence yields its mapping', () => {
    expect(splitFrontmatter('---\ntitle: T\n---\nbody')).toEqual({title: 'T'})
  })

  it.each(FRONTMATTER_CASES)(
    'splitFrontmatter: $name never closes, so the scan runs to the end of the body',
    ({make}) => {
      expect(frontmatterScanReachesTheEnd(make(SMALL))).toBe(true)
      expect(frontmatterScanReachesTheEnd(make(REACH_DIGITS))).toBe(true)
    },
  )

  it.each(OLD_FRONTMATTER_INPUTS)(
    'splitFrontmatter: the old input $name is not reaching, so the check discriminates',
    ({input}) => {
      expect(frontmatterScanReachesTheEnd(input)).toBe(false)
    },
  )

  it.each([
    ['a slash run then x', `${'/'.repeat(30)}x`, `${'/'.repeat(30)}x`],
    ['x then a slash run', `x${'/'.repeat(30)}`, 'x'],
    ['alternating slashes and x', '//x'.repeat(10), '//x'.repeat(10)],
    ['a slash run and nothing else', '/'.repeat(30), ''],
    ['a slash run between two x', `x${'/'.repeat(30)}x`, `x${'/'.repeat(30)}x`],
  ])('run URL: %s is trimmed of trailing slashes only, in the rendered stamp', (_name, serverUrl, trimmed) => {
    vi.stubEnv('GITHUB_SERVER_URL', serverUrl)
    vi.stubEnv('GITHUB_REPOSITORY', 'o/r')
    vi.stubEnv('GITHUB_RUN_ID', '7')
    const body = renderReportBody(
      {
        windowDays: 90,
        anchors: 4,
        discovery: 3,
        priorDiscovery: 1,
        confirmedRecidivism: 0,
        backlogCount: 0,
        oldestPendingAgeDays: null,
        state: 'healthy',
      },
      [],
      makePublicOutputTokens({privateTokens: new Set(), redactedCanonicalIds: new Set()}),
      {generatedAt: new Date('2026-11-01T00:00:00Z')},
    )
    expect(body).toContain(`[Source workflow run](${trimmed}/o/r/actions/runs/7)`)
  })

  it('daily digest: the generated documents are counted, so the derivation read them', () => {
    const text = `repos:\n${'  - {private: false, last_survey_at: 2026-10-31}\n'.repeat(5)}`
    expect(deriveCounts(text, '2026-11-01')).toMatchObject({repos_tracked: 5, surveys_today: 5, count_status: 'ok'})
  })
})
