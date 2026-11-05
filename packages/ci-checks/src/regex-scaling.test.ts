/* eslint-disable no-template-curly-in-string -- the fixtures are source text that holds a literal `${` */
/**
 * Scaling guards for the patterns and scans that text a pull request controls reaches through an exported function of
 * this package: the source of a `mutate` or `testFiles` entry and of everything it imports (the import-closure
 * scanners and the directive scanner), the barrel check, and the markdown of `docs/solutions` and of the repository
 * (fence, comment and verify-marker scans).
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

import {spawnSync} from 'node:child_process'
import process from 'node:process'
import {resolveMarkdownLinks} from '@fro.bot/wiki-write-core/markdown-links'
import {describe, expect, it} from 'vitest'
import {stripBarrelExports} from './barrel-exports.ts'
import {
  directSpecifiers,
  froBotPackageSourceFiles,
  markVitestTypeArguments,
  scanDirectiveViolations,
  wikiWriteCoreSubpathSourceFiles,
} from './check-mutation-guards.ts'
import {extractCodeBlocks, findCommentSpans} from './check-solutions-examples.ts'
import {isPureReexportBarrel} from './mutation-guards-reach.ts'

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

/** The import-closure scanners read a source file: the relative-import, package-name and template-literal scans. */
function scanImports(source: string): void {
  // A package manifest read returns a manifest, anything else the source under test.
  const read = (path: string): string =>
    path.endsWith('package.json')
      ? '{"name":"@fro-bot/core","exports":{".":"./src/index.ts","./guards":"./src/guards.ts"}}'
      : source
  directSpecifiers('packages/ci-checks/src/x.ts', read)
  wikiWriteCoreSubpathSourceFiles('packages/ci-checks/src/x.ts', read)
  froBotPackageSourceFiles('packages/ci-checks/src/x.ts', read)
}

describe('the import-closure scans scale linearly in a source file', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'many template literal imports with a literal interpolation', make: repeat("import(`./a${'.js'}`)\n")},
    {
      name: 'many template literal imports with an interpolation that never closes',
      make: repeat("import(`./a${'.js\\\\`)\n"),
    },
    {name: 'vi.mock type arguments that never close, on one line', make: repeat('vi.mock<')},
    {name: 'vi.importActual type arguments that never close, on one line', make: repeat('vi.importActual<')},
    {
      name: 'vi.mock type arguments that close, many on one line',
      make: repeat("vi.mock<typeof import('@fro-bot/core/guards')>('@fro-bot/core/guards'); "),
    },
    {name: 'from followed by a long run of spaces', make: (size: number) => `from${' '.repeat(size)}x`},
    {
      name: 'many from clauses with a long specifier and no closing quote',
      make: repeat("from './aaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    },
    {
      name: 'a package specifier with a long name and no closing quote',
      make: (size: number) => `from '@fro-bot/${'a'.repeat(size)}`,
    },
    {
      name: 'many package specifiers with a long subpath and no closing quote',
      make: repeat("from '@fro-bot/core/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "),
    },
    {name: 'import( followed by a long run of spaces', make: (size: number) => `import(${' '.repeat(size)}x`},
    {name: 'many import( calls with a backtick and no close', make: repeat('import(`./aaaaaaaaaaaaaaaaaaaaaaaaaaaa ')},
    {name: 'many real imports', make: repeat("import {a} from './a.ts'\nimport('./b.ts')\n")},
  ])('$name', ({make}) => {
    expect(growthRatio(make, SMALL, scanImports)).toBeLessThan(CEILING)
  })
})

/**
 * Runs `code` as an ES module in a child process, with the module path of this package's `check-mutation-guards.ts` in
 * `argv[1]` and `args` after it. The child is killed when `timeoutMs` passes, so an operation that stops returning fails the
 * test by timeout instead of hanging the worker. Bun runs the production scripts; Node loads the same modules in CI, and its
 * regex engine is the one that backtracks without limit (Bun's gives up after about 0.7 s and returns no match).
 */
function runInChild(runtime: 'bun' | 'node', code: string, args: readonly string[], timeoutMs: number) {
  const gate = new URL('check-mutation-guards.ts', import.meta.url).pathname
  const flags = runtime === 'bun' ? ['--no-install', '--no-env-file', '--eval'] : ['--input-type=module', '--eval']
  return spawnSync(runtime, [...flags, code, gate, ...args], {
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    timeout: timeoutMs,
  })
}

// The lookup `${'...'}` had two ways to consume a backslash, so a run of them without the closing quote took exponential
// time: about 1.5x per added backslash, hours at 200. The ratio test cannot measure that, because the old code never
// returns at the larger size, so the operation runs in a child process that is killed on a deadline.
const TEMPLATE_LOOKUP_CHILD = `
const {directSpecifiers} = await import(process.argv[1])
const results = process.argv.slice(2).map(count => {
  const source = 'import(\`./x\${' + "'" + '\\\\'.repeat(Number(count)) + '\`)'
  return [count, directSpecifiers('packages/ci-checks/src/x.ts', () => source)]
})
console.log(JSON.stringify(results))
`

describe('the template literal lookup does not backtrack exponentially', () => {
  it.each(['bun', 'node'] as const)(
    'under %s, returns at once for runs of 200, 2,000 and 20,000 backslashes inside an interpolation that never closes',
    runtime => {
      const run = runInChild(runtime, TEMPLATE_LOOKUP_CHILD, ['200', '2000', '20000'], 20_000)
      expect(run.signal).toBeNull()
      expect(run.status).toBe(0)
      expect(JSON.parse(run.stdout)).toEqual([
        ['200', []],
        ['2000', []],
        ['20000', []],
      ])
    },
  )

  // The harness must fail by timeout, not hang: the pattern this lookup replaced, on a run it cannot finish in the deadline.
  it('kills a Node child that runs the old pattern on 60 backslashes, so a reintroduced exponential fails by timeout', () => {
    // The old pattern, as a literal here and as source text in the child.
    const oldPattern = /\$\{\s*(['"])((?:\\.|(?!\1).)*)\1\s*\}/gu
    const oldPatternChild = `
const old = new RegExp(process.argv[2], process.argv[3])
const source = "\${'" + '\\\\'.repeat(60)
console.log(source.replaceAll(old, '').length)
`
    const startedAt = performance.now()
    const run = runInChild('node', oldPatternChild, [oldPattern.source, oldPattern.flags], 1500)
    expect(run.signal).toBe('SIGKILL')
    expect(run.stdout).toBe('')
    expect(performance.now() - startedAt).toBeLessThan(10_000)
  })
})

describe('the directive scanner scales linearly in a line and in a file', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const scan = (content: string): void => {
    scanDirectiveViolations([{file: 'a.ts', content}])
  }
  it.each([
    {name: 'one line of Stryker disable phrases', make: repeat('Stryker disable ')},
    {
      name: 'one line of Stryker disable phrases with a colon and a reason each',
      make: repeat('Stryker disable next-line all: because '),
    },
    {
      name: 'one line of Stryker disable phrases ended by a carriage return',
      make: (size: number) => `${'Stryker disable '.repeat(size / 16)}\r`,
    },
    {name: 'one line of block comment openers with no close', make: repeat('/*')},
    {name: 'one line of block comments with a close', make: repeat('/* a */ ')},
    {name: 'one line of quote characters', make: repeat('"\'`')},
    {name: 'one line of escaped quotes', make: repeat(String.raw`"\"`)},
    {name: 'many lines of directives', make: repeat('// Stryker disable next-line all: because\n')},
    {name: 'many short lines', make: repeat('a\n')},
  ])('$name', ({make}) => {
    expect(growthRatio(make, SMALL, scan)).toBeLessThan(CEILING)
  })
})

describe('the barrel check scales linearly in a source file', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  const check = (content: string): void => {
    isPureReexportBarrel('packages/ci-checks/src/x.ts', () => content)
  }
  it.each([
    {name: 'export brace openers that never close', make: repeat('export{')},
    {name: 'export type brace openers that never close', make: repeat('export type {')},
    {
      name: 'export brace openers with one close at the end and no from',
      make: (size: number) => `${'export {'.repeat(size / 8)}}`,
    },
    {name: 'export star openers with no from', make: repeat('export * ')},
    {name: 'export star as openers with no from', make: repeat('export * as a ')},
    {name: 'export star from with an unclosed specifier', make: repeat("export * from 'aaaaaaaaaaaaaaaaaaaa ")},
    {
      name: 'many real barrel statements',
      make: repeat("export * from './a.ts'\nexport {b} from './b.ts'\nexport type {C} from './c.ts'\n"),
    },
    {name: 'a long run of spaces after export', make: (size: number) => `export${' '.repeat(size)}x`},
    {
      // Every head shares the one close, and the close is followed by a long run of spaces with no `from`.
      name: 'many brace heads sharing one close, then a long whitespace run with no from',
      make: (size: number) => `${'export{'.repeat(size / 16)}}${' '.repeat((size * 9) / 16)}x`,
    },
  ])('$name', ({make}) => {
    expect(growthRatio(make, SMALL, check)).toBeLessThan(CEILING)
  })
})

/** A document of one indented, never-closed fence followed by `line` repeated up to `size` characters. */
function indentedFenceBody(line: string): (size: number) => string {
  return size => `  \`\`\`ts\n${repeat(line)(size)}`
}

describe(
  'the solutions example scan scales linearly in a markdown document',
  {timeout: SUITE_TIMEOUT_MILLISECONDS},
  () => {
    const scan = (content: string): void => {
      extractCodeBlocks(content, 'docs/solutions/x.md')
    }
    it.each([
      {name: 'comment openers that never close', make: repeat('<!--')},
      {name: 'comment openers that never close, each with verify nearby', make: repeat('<!-- verify ')},
      {name: 'many separate closed comments', make: repeat('<!-- a -->\n')},
      {
        name: 'many separate closed annotations above fences',
        make: repeat('<!-- verify: a from b.ts -->\n```ts fragment\n```\n'),
      },
      {name: 'many separate closed comments on one line', make: repeat('<!-- a -->')},
      {
        name: 'one annotation with a very long symbol',
        make: (size: number) => `<!-- verify: ${'a'.repeat(size)} from b.ts -->\n\`\`\`ts fragment\n\`\`\`\n`,
      },
      {
        name: 'one annotation with a long run of spaces between the words',
        make: (size: number) =>
          `<!-- verify: a${' '.repeat(size)}from${' '.repeat(size)}b.ts -->\n\`\`\`ts fragment\n\`\`\`\n`,
      },
      {
        name: 'one annotation with many words',
        make: (size: number) => `<!-- verify: ${'a '.repeat(size / 2)}from b.ts -->\n\`\`\`ts fragment\n\`\`\`\n`,
      },
      {name: 'fence openers with no close', make: repeat('```ts\n')},
      {name: 'many closed fences', make: repeat('```ts fragment\n```\n')},
      {name: 'a fence line of spaces', make: (size: number) => `${' '.repeat(size)}\`\`\`ts\n`},
      {
        name: 'a fence info string of many words',
        make: (size: number) => `\`\`\`ts ${'a '.repeat(size / 2)}\n\`\`\`\n`,
      },
      {name: 'a fence info string of spaces', make: (size: number) => `\`\`\`ts${' '.repeat(size)}x\n\`\`\`\n`},
      // The fence is indented two spaces and never closes, so every following line is a body line that goes through dedent:
      // a line with less indent than the fence takes the leading-whitespace branch.
      {
        name: 'an indented fence with a long body of lines indented less than the fence',
        make: indentedFenceBody(' x\n'),
      },
      {name: 'an indented fence with a long body of unindented lines', make: indentedFenceBody('x\n')},
      {
        name: 'an indented fence with a long body of lines indented more than the fence',
        make: indentedFenceBody('    x\n'),
      },
    ])('$name', ({make}) => {
      expect(growthRatio(make, SMALL, scan)).toBeLessThan(CEILING)
    })
  },
)

describe(
  'the markdown link scan of @fro.bot/wiki-write-core scales linearly in a document',
  {timeout: SUITE_TIMEOUT_MILLISECONDS},
  () => {
    const scan = (content: string): void => {
      resolveMarkdownLinks(content, 'README.md', {files: {'README.md': content}})
    }
    it.each([
      {name: 'link openers that never close, on one line', make: repeat('[a](')},
      {name: 'bracket openers on one line', make: repeat('[')},
      {name: 'many separate links on one line', make: repeat('[a](b.md) ')},
      {name: 'many separate links, one per line', make: repeat('[a](b.md)\n')},
      {name: 'backtick openers with no close', make: repeat('`a [b](c.md) ')},
    ])('$name', ({make}) => {
      expect(growthRatio(make, SMALL, scan)).toBeLessThan(CEILING)
    })
  },
)

// A scaling case proves nothing if its input never reaches the pattern. These assertions read the output of each worst-case
// input, so a case that an early return or an upstream strip turned into a no-op would fail here.
describe('the worst-case inputs reach the scans they measure', () => {
  const size = 4000

  it('unclosed type-argument heads reach the marker scan and are left unmarked; closed ones are marked', () => {
    const unclosed = 'vi.mock<'.repeat(size / 8)
    expect(markVitestTypeArguments(unclosed)).toBe(unclosed)
    expect(markVitestTypeArguments(`${'vi.mock<'.repeat(100)}>(`)).toContain('\uE000')
    const closed = "vi.mock<typeof import('@fro-bot/core/guards')>('@fro-bot/core/guards'); ".repeat(size / 70)
    const read = (path: string): string =>
      path.endsWith('package.json') ? '{"name":"@fro-bot/core","exports":{"./guards":"./src/guards.ts"}}' : closed
    expect(froBotPackageSourceFiles('packages/ci-checks/src/x.ts', read).length).toBe(Math.floor(size / 70))
  })

  it('heads that share one close reach the barrel strip, each one failing on the same missing from clause', () => {
    const shared = `${'export{'.repeat(size / 16)}}${' '.repeat((size * 9) / 16)}x`
    expect(shared.length).toBeGreaterThanOrEqual(size)
    expect(stripBarrelExports(shared)).toBe(shared)
    expect(isPureReexportBarrel('x.ts', () => shared)).toBe(false)
    const withClause = `${'export{'.repeat(size / 16)}} from 'a'${' '.repeat((size * 9) / 16)}x`
    expect(stripBarrelExports(withClause)).toBe('x')
  })

  it('unclosed brace heads reach the barrel strip and survive it; complete statements are removed', () => {
    const unclosed = 'export{'.repeat(size / 7)
    expect(stripBarrelExports(unclosed)).toBe(unclosed)
    expect(isPureReexportBarrel('x.ts', () => unclosed)).toBe(false)
    const complete = "export * from './a.ts'\nexport {b} from './b.ts'\nexport type {C} from './c.ts'\n".repeat(
      size / 70,
    )
    expect(stripBarrelExports(complete).trim()).toBe('')
    expect(isPureReexportBarrel('x.ts', () => complete)).toBe(true)
  })

  it('comment openers reach the span scan: none close, or each closes', () => {
    const opened = findCommentSpans('<!--'.repeat(size / 4))
    expect(opened.spans).toHaveLength(0)
    expect(opened.unterminated).toHaveLength(size / 4)
    const closed = findCommentSpans('<!-- a -->\n'.repeat(size / 11))
    expect(closed.spans).toHaveLength(Math.floor(size / 11))
    expect(closed.unterminated).toHaveLength(0)
    expect(closed.spans.at(-1)?.startLine).toBe(Math.floor(size / 11))
  })

  it('an indented fence reaches the body and dedent loop: one block whose lines are the body lines, dedented', () => {
    const lines = 300
    for (const [line, dedented] of [
      [' x', 'x'],
      ['x', 'x'],
      ['    x', '  x'],
    ] as const) {
      const result = extractCodeBlocks(`  \`\`\`ts\n${`${line}\n`.repeat(lines)}`, 'docs/solutions/x.md')
      expect(result.blocks).toHaveLength(1)
      const block = result.blocks[0]
      expect(block?.line).toBe(1)
      expect(block?.code.split('\n')).toEqual([...Array.from({length: lines}, () => dedented), ''])
    }
  })

  it('a document of fences reaches the block extractor', () => {
    const result = extractCodeBlocks(
      '<!-- verify: a from b.ts -->\n```ts fragment\n```\n'.repeat(size / 45),
      'docs/solutions/x.md',
    )
    expect(result.blocks).toHaveLength(Math.floor(size / 45))
    expect(result.blocks[0]?.annotations).toEqual([{symbol: 'a', file: 'b.ts'}])
  })

  it('a line of directives reaches the directive scanner', () => {
    const violations = scanDirectiveViolations([{file: 'a.ts', content: 'Stryker disable '.repeat(size / 16)}])
    expect(violations).toHaveLength(size / 16)
  })

  it('an interpolation reaches the template literal lookup: a closed one is inlined, an unclosed one is not', () => {
    // Short on purpose: the long runs belong to the child-process cases above, because a regression would hang this worker.
    expect(directSpecifiers('packages/ci-checks/src/x.ts', () => "import(`./x${'.js'}`)")).toEqual([
      'packages/ci-checks/src/x.ts',
    ])
    expect(directSpecifiers('packages/ci-checks/src/x.ts', () => "import(`./x${'\\\\\\`)")).toEqual([])
  })
})
