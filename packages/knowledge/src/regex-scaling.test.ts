/**
 * Scaling guards for the regexes that GitHub-controlled or agent-controlled text reaches through an
 * exported function of this package: pattern-proposal and learning-proposal issue bodies (the hidden
 * markers), solution-doc frontmatter, the drafted PR's coverage block, job logs, and the agent's pattern
 * statement.
 *
 * Each case builds an input that is the worst shape for a pattern with adjacent or overlapping
 * quantifiers, in one long run and as many separate matches in one document, and asserts that
 * quadrupling it does not multiply the time by sixteen. A quadratic operation costs about 16x per
 * quadrupling and a linear one about 4x, so the ceiling of 8x leaves a factor of two on both sides.
 *
 * Every case also proves that its input reaches the code under test: `reaches` runs the same shape at
 * a small size and checks an output that only a full walk of the text can produce.
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

import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {buildLogExcerpt, parseMergeShaMarker} from './capture-learnings-harvest.ts'
import {derivePatternProposalTitle} from './capture-patterns-open.ts'
import {
  collectLearningProposalSources,
  collectSolutionDocSources,
  parsePatternProposalFingerprint,
  parsePatternProposalSourceIds,
  parsePatternProposalSupersedes,
  tokenizeTitle,
} from './capture-patterns-synthesis.ts'
import {parseCoverageBlock, renderPrBody, type CoverageRow} from './drafted-solutions-pr-body.ts'

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

interface ScalingCase {
  readonly name: string
  readonly make: (size: number) => string
  /** Checks, on the same shape at a small size, that the text reaches the pattern and is walked to its end. */
  readonly reaches: (input: string) => void
}

const SOURCE_IDS_PREFIX = '<!-- pattern-proposal:source-ids='
const SOURCE_IDS_TAIL = `\n${SOURCE_IDS_PREFIX}a,b -->`

/** The input then a well-formed marker on a later line: only a walk past every earlier prefix finds it. */
const findsTailMarker = (input: string): void => {
  expect(parsePatternProposalSourceIds(`${input}${SOURCE_IDS_TAIL}`)).toEqual(['a', 'b'])
}

describe('the pattern-proposal markers scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const cases: ScalingCase[] = [
    {name: 'unclosed source-ids prefixes repeated', make: repeat(SOURCE_IDS_PREFIX), reaches: findsTailMarker},
    {name: 'source-ids prefixes each followed by a', make: repeat(`${SOURCE_IDS_PREFIX}a`), reaches: findsTailMarker},
    {
      name: 'source-ids prefixes each followed by an almost-close',
      make: repeat(`${SOURCE_IDS_PREFIX} --`),
      reaches: findsTailMarker,
    },
    {
      name: 'source-ids prefixes on separate lines, none closed',
      make: repeat(`${SOURCE_IDS_PREFIX}a b\n`),
      reaches: findsTailMarker,
    },
    {
      name: 'one source-ids prefix and a long run with no close',
      make: (size: number) => `${SOURCE_IDS_PREFIX}${'a'.repeat(size)}`,
      reaches: findsTailMarker,
    },
  ]
  it.each(cases)('source-ids: $name', ({make, reaches}) => {
    reaches(make(SMALL))
    expect(growthRatio(make, SMALL, input => parsePatternProposalSourceIds(input))).toBeLessThan(CEILING)
  })

  const fixedWidth: ScalingCase[] = [
    {
      name: 'fingerprint prefixes with 63 hex digits, repeated',
      make: repeat(`<!-- pattern-proposal:fingerprint=${'a'.repeat(63)}`),
      reaches: input => {
        expect(parsePatternProposalFingerprint(`${input}<!-- pattern-proposal:fingerprint=${'b'.repeat(64)} -->`)).toBe(
          'b'.repeat(64),
        )
      },
    },
    {
      name: 'supersedes prefixes with 63 hex digits, repeated',
      make: repeat(`<!-- pattern-proposal:supersedes=${'a'.repeat(63)}`),
      reaches: input => {
        expect(parsePatternProposalSupersedes(`${input}<!-- pattern-proposal:supersedes=${'b'.repeat(64)} -->`)).toBe(
          'b'.repeat(64),
        )
      },
    },
  ]
  it.each(fixedWidth)('$name', ({make, reaches}) => {
    reaches(make(SMALL))
    const parse = make === fixedWidth[0]?.make ? parsePatternProposalFingerprint : parsePatternProposalSupersedes
    expect(growthRatio(make, SMALL, input => parse(input))).toBeLessThan(CEILING)
  })
})

describe('the learning-proposal merge marker scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const marker = `<!-- captured-learning:merge_sha=${'a'.repeat(39)}`
  const make = repeat(marker)
  const tail = `<!-- captured-learning:merge_sha=${'b'.repeat(40)} -->`
  it('parseMergeShaMarker: prefixes with 39 hex digits, repeated', () => {
    expect(parseMergeShaMarker(`${make(SMALL)}${tail}`)).toBe('b'.repeat(40))
    expect(growthRatio(make, SMALL, input => parseMergeShaMarker(input))).toBeLessThan(CEILING)
  })

  it('collectLearningProposalSources: one issue per hostile body', () => {
    const run = (input: string) =>
      collectLearningProposalSources([{number: 1, body: input, title: 't', createdAt: '', labels: []}])
    expect(run(`${make(SMALL)}${tail}`).sources.map(source => source.id)).toEqual(['b'.repeat(40)])
    expect(growthRatio(make, SMALL, input => run(input))).toBeLessThan(CEILING)
  })
})

describe('the solution-doc frontmatter and title tokens scale linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const PATH = 'docs/solutions/best-practices/a.md'
  const collect = (content: string) => collectSolutionDocSources({[PATH]: content}, 'sha')
  const cases: ScalingCase[] = [
    {
      name: 'a frontmatter fence with no close',
      make: (size: number) => `---\n${repeat('a\n')(size)}`,
      reaches: input => {
        // No close fence: the doc has no frontmatter, so the title falls back to the file stem.
        expect(collect(input).sources.map(source => source.title)).toEqual(['a'])
      },
    },
    {
      name: 'a frontmatter fence and repeated fence-like lines',
      make: (size: number) => `---\n${repeat('\n---x')(size)}`,
      reaches: input => {
        expect(collect(input).sources.map(source => source.title)).toEqual(['a'])
      },
    },
    {
      name: 'a closed frontmatter block holding a long title',
      make: (size: number) => `---\ntitle: ${'word '.repeat(size / 5)}\n---\nbody`,
      reaches: input => {
        expect(collect(input).sources[0]?.signals.titleTokens).toContain('word')
      },
    },
  ]
  it.each(cases)('collectSolutionDocSources: $name', ({make, reaches}) => {
    reaches(make(SMALL))
    expect(growthRatio(make, SMALL, input => collect(input))).toBeLessThan(CEILING)
  })

  it.each([
    {name: 'a run of non-alphanumerics then abc', make: (size: number) => `${'!'.repeat(size)}abc`},
    {name: 'alternating abc and punctuation', make: repeat('abc!')},
  ])('tokenizeTitle: $name', ({make}) => {
    expect(tokenizeTitle(make(40))).toContain('abc')
    expect(growthRatio(make, SMALL, input => tokenizeTitle(input))).toBeLessThan(CEILING)
  })
})

describe('the coverage block scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const MARKER = '<!-- fro-bot:drafted-solutions-coverage v1'
  const failureOf = (input: string): string => {
    const result = parseCoverageBlock(input, 'existing-pr')
    return result.ok ? '' : result.reason
  }
  const cases: ScalingCase[] = [
    {
      name: 'the block opener repeated: rejected as duplicated before any pattern runs',
      make: repeat(`${MARKER}\n`),
      reaches: input => {
        expect(failureOf(input)).toContain('duplicated')
      },
    },
    {
      name: 'one opener and a long unclosed body of blank lines',
      make: (size: number) => `${MARKER}\n${' \n'.repeat(size / 2)}`,
      reaches: input => {
        expect(failureOf(input)).toContain('truncated')
      },
    },
    {
      name: 'one opener and CRLF-heavy text with near-closes',
      make: (size: number) => `${MARKER}\r\n${'\r\n-'.repeat(size / 3)}`,
      reaches: input => {
        expect(failureOf(input)).toContain('truncated')
      },
    },
  ]
  it.each(cases)('parseCoverageBlock: $name', ({make, reaches}) => {
    reaches(make(SMALL))
    expect(growthRatio(make, SMALL, input => parseCoverageBlock(input, 'existing-pr'))).toBeLessThan(CEILING)
  })
})

describe('the job log excerpt scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'an error on every line', make: repeat('error: x\n')},
    {name: 'one very long line with no newline', make: (size: number) => 'x'.repeat(size)},
    {name: 'many short lines and one error at the end', make: (size: number) => `${'ok\n'.repeat(size / 3)}failed`},
  ])('buildLogExcerpt: $name', ({make}) => {
    // The budget cuts the excerpt, so only the head shows; the fallback path and the window path both ran.
    const excerpt = buildLogExcerpt(make(SMALL), 100)
    expect(excerpt.length).toBeLessThanOrEqual(100)
    expect(excerpt).not.toBe('')
    expect(growthRatio(make, SMALL, input => buildLogExcerpt(input, 100))).toBeLessThan(CEILING)
  })
})

describe('the agent pattern statement is trimmed in linear time', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'a whitespace run then x', make: (size: number) => `${' '.repeat(size)}x`},
    {name: 'alternating whitespace and x', make: repeat(' x')},
  ])('derivePatternProposalTitle: $name', ({make}) => {
    const title = derivePatternProposalTitle({
      outcome: 'drafted',
      patternStatement: make(SMALL),
      rationale: 'r',
      sourceReferences: [],
      evidenceCount: 0,
      suggestedNextAction: 'n',
    })
    expect(title.startsWith('Pattern proposal: x')).toBe(true)
    const run = (input: string) =>
      derivePatternProposalTitle({
        outcome: 'drafted',
        patternStatement: input,
        rationale: 'r',
        sourceReferences: [],
        evidenceCount: 0,
        suggestedNextAction: 'n',
      })
    expect(growthRatio(make, SMALL, input => run(input))).toBeLessThan(CEILING)
  })
})

describe('the PR body cell escape is length-capped before its pattern runs', () => {
  // `renderPrBody` validates the rows first, so a cell is at most a few hundred characters. The widest
  // note is three dropped claims and a reason, each made of whitespace and newlines.
  it('renders the widest whitespace-only notes in constant time', () => {
    const blank = (length: number) => `x${' \n'.repeat(length / 2 - 1)}x`
    const row: CoverageRow = {
      issue: 1,
      outcome: 'covered',
      targetDoc: 'docs/solutions/best-practices/a.md',
      sourceSha: 'a'.repeat(40),
      evidence: [],
      droppedClaims: [blank(100), blank(100), blank(100)],
      bodyHash: 'b'.repeat(64),
      reason: blank(300),
    }
    const startedAt = process.cpuUsage()
    const body = renderPrBody([row])
    const elapsed = process.cpuUsage(startedAt)
    expect(body).toContain('| #1 | covered |')
    expect((elapsed.user + elapsed.system) / 1_000).toBeLessThan(50)
  })

  it('rejects a cell longer than the cap before it renders', () => {
    const row = {
      issue: 1,
      outcome: 'unverified',
      targetDoc: null,
      sourceSha: 'a'.repeat(40),
      evidence: [],
      droppedClaims: [],
      bodyHash: 'b'.repeat(64),
      reason: ' \n'.repeat(1_000_000),
    }
    expect(() => renderPrBody([row as CoverageRow])).toThrow('cannot render invalid coverage rows')
  })
})
