import {Buffer} from 'node:buffer'
import {spawnSync, type spawn} from 'node:child_process'
import {EventEmitter} from 'node:events'
import {chmodSync, fstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  buildSummary,
  hasFlagAfterCommand,
  parseRoute,
  RouteStderrUsageError,
  runCommand,
  runRouteStderr,
  type CommandResult,
  type Route,
  type RouteStderrPlan,
} from './route-stderr.ts'

const CHILD = fileURLToPath(new URL('../fixtures/route-stderr-child.ts', import.meta.url))
const RUNNER = fileURLToPath(new URL('../fixtures/route-stderr-run.ts', import.meta.url))

const WARNING: Route = {prefix: 'wiki-ingest:warning:', heading: 'Wiki ingest warnings'}
const FINDING: Route = {prefix: 'wiki-ingest:finding:', heading: 'Wiki ingest findings'}

let dir = ''
let summaryPath = ''
let outputPath = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'route-stderr-'))
  summaryPath = join(dir, 'summary')
  outputPath = join(dir, 'output')
  writeFileSync(summaryPath, '')
  writeFileSync(outputPath, '')
})

afterEach(() => {
  rmSync(dir, {recursive: true, force: true})
})

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    GITHUB_STEP_SUMMARY: summaryPath,
    GITHUB_OUTPUT: outputPath,
    ...extra,
  }
}

interface Ran {
  readonly code: number
  readonly replayed: Buffer
  readonly summary: string
  readonly output: string
}

async function run(plan: RouteStderrPlan, env: Record<string, string>): Promise<Ran> {
  const chunks: Uint8Array[] = []
  const code = await runRouteStderr(plan, {
    env,
    replay: chunk => {
      chunks.push(chunk)
    },
  })
  return {
    code,
    replayed: Buffer.concat(chunks),
    summary: readFileSync(summaryPath, 'utf8'),
    output: readFileSync(outputPath, 'utf8'),
  }
}

/** A plan whose command is the fixture child, which writes what `CASE_*` says. */
function childPlan(overrides: Partial<RouteStderrPlan> = {}): RouteStderrPlan {
  return {routes: [WARNING], summary: 'filtered', command: [process.execPath, CHILD], ...overrides}
}

describe('parseRoute', () => {
  it('splits a spec at the first equals sign', () => {
    expect(parseRoute('wiki-ingest:warning:=Wiki ingest warnings')).toStrictEqual(WARNING)
    expect(parseRoute('a=b=c')).toStrictEqual({prefix: 'a', heading: 'b=c'})
  })

  it.each([
    [''],
    ['no-separator'],
    ['=heading'],
    ['prefix='],
    ['pre\nfix=heading'],
    ['prefix=head\ning'],
    ['p=h\r'],
    ['p\r=h'],
  ])('rejects %j with a fixed message that does not echo the spec', spec => {
    let message = ''
    try {
      parseRoute(spec)
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RouteStderrUsageError)
      message = (error as Error).message
    }
    expect(message).toBe('--route needs <prefix>=<heading>, with a non-empty prefix and heading on one line')
  })
})

describe('hasFlagAfterCommand', () => {
  it.each([
    [['--route', 'a=b', 'bun', 'x.ts', '--summary', 'all']],
    [['--route', 'a=b', 'bun', 'x.ts', '--route', 'x=y']],
    [['--route=a=b', 'bun', '--bogus']],
    [['bun', '-x']],
    [['bun', 'x.ts', '-']],
    [['--summary', 'all', '--route', 'a=b', 'bun', 'x.ts', '--conflict-exit=3']],
    [['--route', 'a=b', 'bun', 'x.ts', 'arg', '--help']],
    [['--conflict-exit', '3', '--conflict-output', 'c', 'bun', 'x.ts', '-h']],
  ])('is true for %j: a token that starts with a dash follows the command', argv => {
    expect(hasFlagAfterCommand(argv)).toBe(true)
  })

  it.each([
    [[]],
    [['--route', 'a=b', 'bun', 'x.ts']],
    [['--route', 'a=b', '--summary', 'all', '--conflict-exit', '3', '--conflict-output', 'c', 'bun', 'x.ts']],
    [['--route=a=b', '--summary=all', '--conflict-exit=3', '--conflict-output=c', 'bun', 'x.ts']],
    // A value that starts with a dash is still the option's value, not the command.
    [['--route', '-odd=heading', 'bun', 'x.ts']],
    [['--summary', '-1', 'bun']],
    [['--conflict-exit', '-1', '--conflict-output', '-c', 'bun']],
    // Each option takes the next token as its value, so a dash after that value comes before any command.
    [['--route', 'a=b', '-x']],
    [['--summary', 'all', '-x']],
    [['--conflict-exit', '3', '-x']],
    [['--conflict-output', 'c', '-x']],
    // No command at all: nothing follows one.
    [['--bogus', '-x', '-y']],
    [['--help']],
    [['-h']],
    [['--route']],
    [['--route', 'a=b']],
    // An unknown flag before the command is the runner's to reject, as is a separator.
    [['--bogus', 'bun', 'x.ts']],
    [['--', 'bun', '-x']],
    [['--route', 'a=b', '--', 'bun', 'x.ts']],
  ])('is false for %j', argv => {
    expect(hasFlagAfterCommand(argv)).toBe(false)
  })

  it('reads the first token that is not an option or an option value as the command', () => {
    expect(hasFlagAfterCommand(['--route', 'a=b', 'x', '--route', 'c=d'])).toBe(true)
    expect(hasFlagAfterCommand(['--route', 'a=b', '--route', 'c=d', 'x'])).toBe(false)
  })
})

describe('buildSummary in filtered mode', () => {
  it('writes the heading and each matching line with the prefix replaced by a bullet', () => {
    const stderr = 'wiki-ingest:warning:{"code":"a"}\nwiki-ingest:warning:second warning\n'
    expect(buildSummary(stderr, [WARNING], 'filtered')).toBe(
      '### Wiki ingest warnings\n- {"code":"a"}\n- second warning\n',
    )
  })

  it('writes one section per route that matches, in route order, whatever the order in stderr', () => {
    const stderr = 'wiki-ingest:finding:f1\nwiki-ingest:warning:w1\nwiki-ingest:finding:f2\nwiki-ingest:warning:w2\n'
    expect(buildSummary(stderr, [WARNING, FINDING], 'filtered')).toBe(
      '### Wiki ingest warnings\n- w1\n- w2\n### Wiki ingest findings\n- f1\n- f2\n',
    )
    expect(buildSummary(stderr, [FINDING, WARNING], 'filtered')).toBe(
      '### Wiki ingest findings\n- f1\n- f2\n### Wiki ingest warnings\n- w1\n- w2\n',
    )
  })

  it('writes no section for a route that matches nothing', () => {
    expect(buildSummary('wiki-ingest:finding:f1\n', [WARNING, FINDING], 'filtered')).toBe(
      '### Wiki ingest findings\n- f1\n',
    )
  })

  it('writes nothing when no line matches', () => {
    expect(buildSummary('', [WARNING], 'filtered')).toBe('')
    expect(buildSummary('error: boom\n', [WARNING], 'filtered')).toBe('')
    expect(buildSummary('x wiki-ingest:warning:nope\n wiki-ingest:warning:nope\n', [WARNING], 'filtered')).toBe('')
    expect(buildSummary('::warning::x\n', [WARNING], 'filtered')).toBe('')
  })

  it('ends every line with a newline, including a last line that had none', () => {
    expect(buildSummary('wiki-ingest:warning:last', [WARNING], 'filtered')).toBe('### Wiki ingest warnings\n- last\n')
  })

  it('keeps a carriage return, an empty message, a second prefix and Markdown as they are', () => {
    expect(buildSummary('wiki-ingest:warning:a\r\n', [WARNING], 'filtered')).toBe('### Wiki ingest warnings\n- a\r\n')
    expect(buildSummary('wiki-ingest:warning:\n', [WARNING], 'filtered')).toBe('### Wiki ingest warnings\n- \n')
    expect(buildSummary('wiki-ingest:warning:wiki-ingest:warning:inner\n', [WARNING], 'filtered')).toBe(
      '### Wiki ingest warnings\n- wiki-ingest:warning:inner\n',
    )
    expect(
      buildSummary('\nwiki-ingest:warning:# not a heading\n\nwiki-ingest:warning:- item\n', [WARNING], 'filtered'),
    ).toBe('### Wiki ingest warnings\n- # not a heading\n- - item\n')
  })

  it('does not match a route prefix that only sits inside another prefix', () => {
    expect(buildSummary('corrections:warning:c1\n', [WARNING], 'filtered')).toBe('')
  })
})

describe('buildSummary in all mode', () => {
  const corrections: Route = {prefix: 'corrections:warning:', heading: 'Correction context warnings'}

  it('writes the heading and the whole stderr when a line has the prefix, replacing only the prefix', () => {
    expect(buildSummary('note\ncorrections:warning:w1\nmore\n', [corrections], 'all')).toBe(
      '### Correction context warnings\nnote\n- w1\nmore\n',
    )
  })

  it('writes the warnings and a failure line that follows them', () => {
    expect(buildSummary('corrections:warning:w1\nfailed to read page\n', [corrections], 'all')).toBe(
      '### Correction context warnings\n- w1\nfailed to read page\n',
    )
  })

  it('writes nothing when only unprefixed text is present', () => {
    expect(buildSummary('REPO_NODE_ID is required\n', [corrections], 'all')).toBe('')
    expect(buildSummary('', [corrections], 'all')).toBe('')
    expect(buildSummary(' corrections:warning:nope\n', [corrections], 'all')).toBe('')
    expect(buildSummary('wiki-ingest:warning:w1\n', [corrections], 'all')).toBe('')
  })

  it('adds no newline to a last line that had none, and keeps carriage returns', () => {
    expect(buildSummary('corrections:warning:last', [corrections], 'all')).toBe(
      '### Correction context warnings\n- last',
    )
    expect(buildSummary('first\ncorrections:warning:last', [corrections], 'all')).toBe(
      '### Correction context warnings\nfirst\n- last',
    )
    expect(buildSummary('corrections:warning:a\r\nb\r\n', [corrections], 'all')).toBe(
      '### Correction context warnings\n- a\r\nb\r\n',
    )
  })

  it('leaves a later prefix inside a line alone', () => {
    expect(buildSummary('corrections:warning:corrections:warning:x\n', [corrections], 'all')).toBe(
      '### Correction context warnings\n- corrections:warning:x\n',
    )
  })

  it('replaces the prefix of an empty message', () => {
    expect(buildSummary('corrections:warning:\n', [corrections], 'all')).toBe('### Correction context warnings\n- \n')
  })
})

// Every `runCommand` test below drives a fake child: no process, no timer, no I/O, so a mutant that makes the
// command never settle fails the test in 500 ms rather than waiting out the 10 s default. The real-process
// tests further down are the killers for what a fake cannot show: inherited descriptors, the environment, the
// working directory, PATH lookup, large stderr, signals and exit codes.
const FAKE = {timeout: 500}

interface FakeChild extends EventEmitter {
  readonly stderr: EventEmitter
}

interface SpawnCall {
  readonly file: string
  readonly args: readonly string[]
  readonly options: unknown
}

/**
 * Runs `runCommand` against a fake child. `script` runs once the listeners are attached; an exception it throws
 * (an `emit` rethrows what a listener throws) rejects the result, so a listener that blows up fails the test at once.
 */
async function runFake(
  script: (child: FakeChild) => void,
  command: readonly string[] = ['tool'],
  env: Record<string, string | undefined> = {},
): Promise<{readonly result: CommandResult; readonly calls: readonly SpawnCall[]}> {
  const calls: SpawnCall[] = []
  return new Promise((resolve, reject) => {
    const spawnProcess = ((file: string, args: readonly string[], options: unknown) => {
      calls.push({file, args, options})
      const child: FakeChild = Object.assign(new EventEmitter(), {stderr: new EventEmitter()})
      queueMicrotask(() => {
        try {
          script(child)
        } catch (error: unknown) {
          reject(error)
        }
      })
      return child
    }) as unknown as typeof spawn
    runCommand(command, env, spawnProcess).then(result => {
      resolve({result, calls})
    }, reject)
  })
}

function startError(code: string): Error {
  return Object.assign(new Error(`spawn failed: ${code}`), {code})
}

const startLine = (code: string): string => `route-stderr: could not start the wrapped command (${code})\n`

describe('runCommand with a fake spawn', () => {
  it('starts the file with its arguments, the supplied environment and inherited stdin and stdout', FAKE, async () => {
    const env = {PATH: '/bin', DROPPED: undefined}
    const {calls} = await runFake(child => child.emit('close', 0, null), ['tool', 'a', '--b', ''], env)
    expect(calls).toStrictEqual([
      {file: 'tool', args: ['a', '--b', ''], options: {env, stdio: ['inherit', 'inherit', 'pipe']}},
    ])
  })

  it('passes the supplied environment object through, not a copy', FAKE, async () => {
    const env = {PATH: '/bin'}
    const {calls} = await runFake(child => child.emit('close', 0, null), ['tool'], env)
    expect((calls[0]?.options as {env: unknown}).env).toBe(env)
  })

  it('resolves the exit code and every stderr chunk, in order', FAKE, async () => {
    const {result} = await runFake(child => {
      child.stderr.emit('data', Buffer.from('ab'))
      child.stderr.emit('data', Buffer.from('c\n'))
      child.emit('close', 3, null)
    })
    expect(result.code).toBe(3)
    expect(result.stderr.toString('utf8')).toBe('abc\n')
  })

  it('resolves an empty buffer for a command that wrote nothing', FAKE, async () => {
    const {result} = await runFake(child => child.emit('close', 0, null))
    expect(result.code).toBe(0)
    expect(Buffer.isBuffer(result.stderr)).toBe(true)
    expect(result.stderr.length).toBe(0)
  })

  it.each([
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGKILL', 137],
    ['SIGTERM', 143],
  ] as const)('exits 128 plus the number of %s when a signal ends the command', FAKE, async (signal, expected) => {
    const {result} = await runFake(child => {
      child.stderr.emit('data', Buffer.from('partial'))
      child.emit('close', null, signal)
    })
    expect(result.code).toBe(expected)
    expect(result.stderr.toString('utf8')).toBe('partial')
  })

  it('keeps an exit code of 0 and does not read the signal', FAKE, async () => {
    const {result} = await runFake(child => child.emit('close', 0, 'SIGTERM'))
    expect(result.code).toBe(0)
  })

  it.each([
    ['ENOENT', 127],
    ['EACCES', 126],
    ['EPERM', 126],
  ] as const)('resolves %s as exit %j with a fixed line that does not name the command', FAKE, async (code, exit) => {
    const {result} = await runFake(
      child => {
        child.emit('error', startError(code))
        child.emit('close', -2, null)
      },
      ['secret-tool', 'secret-arg'],
    )
    expect(result.code).toBe(exit)
    expect(result.stderr.toString('utf8')).toBe(startLine(code))
    expect(result.stderr.toString('utf8')).not.toContain('secret')
  })

  it('keeps the first outcome when an error follows a close', FAKE, async () => {
    const {result} = await runFake(child => {
      child.stderr.emit('data', Buffer.from('out'))
      child.emit('close', 1, null)
      child.emit('error', startError('ENOENT'))
    })
    expect(result.code).toBe(1)
    expect(result.stderr.toString('utf8')).toBe('out')
  })

  it('keeps the first outcome when a close follows an error', FAKE, async () => {
    const {result} = await runFake(child => {
      child.stderr.emit('data', Buffer.from('out'))
      child.emit('error', startError('EACCES'))
      child.emit('close', 1, null)
    })
    expect(result.code).toBe(126)
    expect(result.stderr.toString('utf8')).toBe(startLine('EACCES'))
  })

  it.each([
    ['ERR_INVALID_ARG_VALUE', 126],
    ['ENOENT', 127],
  ] as const)('resolves a spawn that throws %s as exit %j', FAKE, async (code, exit) => {
    const spawnProcess = (() => {
      throw startError(code)
    }) as unknown as typeof spawn
    const result = await runCommand(['tool'], {}, spawnProcess)
    expect(result.code).toBe(exit)
    expect(result.stderr.toString('utf8')).toBe(startLine(code))
  })
})

describe('runRouteStderr plan validation', () => {
  // A command that cannot start resolves with exit 127 after a failed `spawn`, with no process left running, so
  // these accept cases are cheap and the validation mutants die in the first tests of the file. They go through
  // `runRouteStderr` and the real `spawn`, so they keep the default timeout: only the fake-spawn tests above are
  // free of I/O and safe to hold to 500 ms.
  const MISSING = 'route-stderr-no-such-command'

  it('accepts a plan of two routes with different prefixes', async () => {
    const ran = await run(childPlan({routes: [WARNING, FINDING], command: [MISSING]}), baseEnv())
    expect(ran.code).toBe(127)
  })

  it.each([[1], [255]])('accepts the conflict exit code %j', async exitCode => {
    const ran = await run(childPlan({conflict: {exitCode, output: 'conflict'}, command: [MISSING]}), baseEnv())
    expect(ran.code).toBe(127)
    expect(ran.output).toBe('')
  })

  it.each([['a'], ['Z'], ['5'], ['_'], ['-'], ['Page_conflict-2']])('accepts the output name %j', async output => {
    const ran = await run(childPlan({conflict: {exitCode: 127, output}, command: [MISSING]}), baseEnv())
    expect(ran.output).toBe(`${output}=true\n`)
  })

  it.each([['a=b'], ['a b'], ['a\nb'], [''], ['a<<b']])(
    'rejects the output name %j before the command runs',
    async output => {
      const argvFile = join(dir, 'argv.json')
      await expect(
        run(childPlan({conflict: {exitCode: 3, output}}), baseEnv({CASE_EXIT: '3', CASE_ARGV_FILE: argvFile})),
      ).rejects.toThrow('--conflict-output must be made of letters, digits, _ and -')
      expect(() => readFileSync(argvFile)).toThrow()
    },
  )

  it.each([[0], [256], [-1], [1.5], [Number.NaN]])(
    'rejects the exit code %j before the command runs',
    async exitCode => {
      const argvFile = join(dir, 'argv.json')
      await expect(
        run(childPlan({conflict: {exitCode, output: 'conflict'}}), baseEnv({CASE_ARGV_FILE: argvFile})),
      ).rejects.toThrow('--conflict-exit must be an integer from 1 to 255')
      expect(() => readFileSync(argvFile)).toThrow()
    },
  )

  describe('usage', () => {
    const cases: [string, RouteStderrPlan, string][] = [
      ['no command', childPlan({command: []}), 'a command to run is required'],
      ['no route', childPlan({routes: []}), 'at least one --route is required'],
      [
        'all mode with two routes',
        childPlan({routes: [WARNING, FINDING], summary: 'all'}),
        '--summary all takes exactly one --route',
      ],
      [
        'a repeated prefix',
        childPlan({routes: [WARNING, {prefix: WARNING.prefix, heading: 'Other'}]}),
        'each --route prefix may appear once',
      ],
    ]

    it.each(cases)('rejects %s before the command runs', async (_name, plan, message) => {
      const argvFile = join(dir, 'argv.json')
      await expect(run(plan, baseEnv({CASE_ARGV_FILE: argvFile}))).rejects.toThrow(message)
      expect(() => readFileSync(argvFile)).toThrow()
    })

    it('is a RouteStderrUsageError', async () => {
      await expect(run(childPlan({command: []}), baseEnv())).rejects.toBeInstanceOf(RouteStderrUsageError)
    })

    it('accepts all mode with exactly one route', async () => {
      const ran = await run(childPlan({summary: 'all'}), baseEnv({CASE_STDERR: 'x\n'}))
      expect(ran.code).toBe(0)
    })
  })
})

describe('runRouteStderr', () => {
  it('returns the exit code of the command, and replays its stderr unchanged', async () => {
    for (const exit of ['0', '1', '2', '3', '255']) {
      const ran = await run(childPlan(), baseEnv({CASE_EXIT: exit, CASE_STDERR: 'plain\n'}))
      expect(ran.code).toBe(Number(exit))
      expect(ran.replayed.toString('utf8')).toBe('plain\n')
    }
  })

  it('replays bytes that are not valid UTF-8 exactly', async () => {
    const plan = childPlan({
      command: [process.execPath, '-e', 'process.stderr.write(Buffer.from([0xff, 0xfe, 0x0a, 0x00, 0x41]))'],
    })
    const ran = await run(plan, baseEnv())
    expect([...ran.replayed]).toStrictEqual([0xff, 0xfe, 0x0a, 0x00, 0x41])
  })

  it('replays a stderr larger than a pipe buffer or a default process buffer', async () => {
    const size = 3 * 1024 * 1024
    const plan = childPlan({
      command: [process.execPath, '-e', String.raw`process.stderr.write('a'.repeat(${String(size)}) + '\n')`],
    })
    const ran = await run(plan, baseEnv())
    expect(ran.code).toBe(0)
    expect(ran.replayed.length).toBe(size + 1)
  })

  it('replays nothing, and calls replay at most once, for an empty stderr', async () => {
    const calls: Uint8Array[] = []
    const code = await runRouteStderr(childPlan(), {
      env: baseEnv(),
      replay: chunk => {
        calls.push(chunk)
      },
    })
    expect(code).toBe(0)
    expect(calls.map(chunk => chunk.length)).toStrictEqual([])
  })

  it('appends the matching lines to the step summary, and nothing when none match', async () => {
    const matched = await run(childPlan(), baseEnv({CASE_STDERR: 'wiki-ingest:warning:w1\n'}))
    expect(matched.summary).toBe('### Wiki ingest warnings\n- w1\n')
    writeFileSync(summaryPath, 'earlier\n')
    const unmatched = await run(childPlan(), baseEnv({CASE_STDERR: 'plain\n'}))
    expect(unmatched.summary).toBe('earlier\n')
  })

  it('appends to a summary that already has content', async () => {
    writeFileSync(summaryPath, 'earlier\n')
    const ran = await run(childPlan(), baseEnv({CASE_STDERR: 'wiki-ingest:warning:w1\n'}))
    expect(ran.summary).toBe('earlier\n### Wiki ingest warnings\n- w1\n')
  })

  it('still writes the summary when the command fails', async () => {
    const ran = await run(childPlan(), baseEnv({CASE_EXIT: '1', CASE_STDERR: 'wiki-ingest:warning:w1\nboom\n'}))
    expect(ran.code).toBe(1)
    expect(ran.summary).toBe('### Wiki ingest warnings\n- w1\n')
  })

  it('writes no summary when GITHUB_STEP_SUMMARY is unset', async () => {
    const env = baseEnv({CASE_STDERR: 'wiki-ingest:warning:w1\n'})
    delete (env as Partial<typeof env>).GITHUB_STEP_SUMMARY
    const ran = await run(childPlan(), env)
    expect(ran.code).toBe(0)
    expect(ran.summary).toBe('')
  })

  it('uses the all mode for the whole stderr', async () => {
    const corrections: Route = {prefix: 'corrections:warning:', heading: 'Correction context warnings'}
    const ran = await run(
      childPlan({routes: [corrections], summary: 'all'}),
      baseEnv({CASE_STDERR: 'corrections:warning:w1\nfailed\n', CASE_EXIT: '1'}),
    )
    expect(ran.code).toBe(1)
    expect(ran.summary).toBe('### Correction context warnings\n- w1\nfailed\n')
  })

  describe('conflict output', () => {
    const conflict = {exitCode: 3, output: 'conflict'}

    it('writes conflict=true on the conflict exit code only, after what the command wrote', async () => {
      const ran = await run(
        childPlan({conflict}),
        baseEnv({CASE_EXIT: '3', CASE_OUTPUT: 'pages_changed=0\n', CASE_STDERR: 'wiki-ingest:finding:f\n'}),
      )
      expect(ran.code).toBe(3)
      expect(ran.output).toBe('pages_changed=0\nconflict=true\n')
    })

    it.each(['0', '1', '2', '4'])('writes nothing for exit %s', async exit => {
      const ran = await run(childPlan({conflict}), baseEnv({CASE_EXIT: exit}))
      expect(ran.code).toBe(Number(exit))
      expect(ran.output).toBe('')
    })

    it('writes nothing when no conflict is declared, even on exit 3', async () => {
      const ran = await run(childPlan(), baseEnv({CASE_EXIT: '3'}))
      expect(ran.code).toBe(3)
      expect(ran.output).toBe('')
    })

    it('names the output as declared', async () => {
      const ran = await run(childPlan({conflict: {exitCode: 7, output: 'clash'}}), baseEnv({CASE_EXIT: '7'}))
      expect(ran.output).toBe('clash=true\n')
    })

    it('fails, and says why, when the exit code matches but GITHUB_OUTPUT is unset', async () => {
      const env = baseEnv({CASE_EXIT: '3'})
      delete (env as Partial<typeof env>).GITHUB_OUTPUT
      await expect(run(childPlan({conflict}), env)).rejects.toThrow('GITHUB_OUTPUT is required')
    })

    it('does not need GITHUB_OUTPUT on another exit code', async () => {
      const env = baseEnv({CASE_EXIT: '1'})
      delete (env as Partial<typeof env>).GITHUB_OUTPUT
      const ran = await runRouteStderr(childPlan({conflict}), {env, replay: () => undefined})
      expect(ran).toBe(1)
    })

    it.each([[1], [255]])('accepts the exit code %j', async exitCode => {
      const ran = await run(
        childPlan({conflict: {exitCode, output: 'conflict'}}),
        baseEnv({CASE_EXIT: String(exitCode)}),
      )
      expect(ran.output).toBe('conflict=true\n')
    })

    it('accepts an output name of letters, digits, underscore and dash', async () => {
      const ran = await run(childPlan({conflict: {exitCode: 3, output: 'Page_conflict-2'}}), baseEnv({CASE_EXIT: '3'}))
      expect(ran.output).toBe('Page_conflict-2=true\n')
    })
  })

  describe('the command', () => {
    it('receives its arguments literally, with no shell', async () => {
      const argvFile = join(dir, 'argv.json')
      const hostile = [
        '$(touch pwned)',
        '`touch pwned`',
        '; touch pwned',
        '| cat',
        '"quoted"',
        "it's",
        '*',
        '~',
        'a b',
        '',
      ]
      await run(childPlan({command: [process.execPath, CHILD, ...hostile]}), baseEnv({CASE_ARGV_FILE: argvFile}))
      expect(JSON.parse(readFileSync(argvFile, 'utf8'))).toStrictEqual(hostile)
    })

    it('sees the supplied environment, and not the ambient one', async () => {
      const outFile = join(dir, 'env.json')
      const script =
        'require("fs").writeFileSync(process.env.OUT_FILE, JSON.stringify({a: process.env.ROUTE_AMBIENT ?? null, s: process.env.ROUTE_SUPPLIED ?? null}))'
      process.env.ROUTE_AMBIENT = 'ambient'
      try {
        await run(
          childPlan({command: [process.execPath, '-e', script]}),
          baseEnv({OUT_FILE: outFile, ROUTE_SUPPLIED: 'supplied'}),
        )
      } finally {
        delete process.env.ROUTE_AMBIENT
      }
      expect(JSON.parse(readFileSync(outFile, 'utf8'))).toStrictEqual({a: null, s: 'supplied'})
    })

    it('runs in the working directory of the router', async () => {
      const outFile = join(dir, 'cwd.txt')
      const script = 'require("fs").writeFileSync(process.env.OUT_FILE, process.cwd())'
      await run(childPlan({command: [process.execPath, '-e', script]}), baseEnv({OUT_FILE: outFile}))
      expect(readFileSync(outFile, 'utf8')).toBe(process.cwd())
    })

    it('is found on the supplied PATH', async () => {
      const bin = join(dir, 'bin')
      const tool = join(bin, 'route-stderr-probe')
      const marker = join(dir, 'ran')
      writeFileSync(join(dir, 'probe-script'), `#!/bin/sh\necho ok > "${marker}"\nexit 5\n`)
      const {mkdirSync, copyFileSync} = await import('node:fs')
      mkdirSync(bin)
      copyFileSync(join(dir, 'probe-script'), tool)
      chmodSync(tool, 0o755)
      const ran = await run(
        childPlan({command: ['route-stderr-probe']}),
        baseEnv({PATH: `${bin}:${process.env.PATH ?? ''}`}),
      )
      expect(ran.code).toBe(5)
      expect(readFileSync(marker, 'utf8')).toBe('ok\n')
    })

    it('exits 127 with a fixed line that does not name the command when it is not found', async () => {
      const ran = await run(childPlan({command: ['route-stderr-no-such-command', 'secret-arg']}), baseEnv())
      expect(ran.code).toBe(127)
      expect(ran.replayed.toString('utf8')).toBe('route-stderr: could not start the wrapped command (ENOENT)\n')
    })

    it('exits 126 when the command cannot be executed', async () => {
      const file = join(dir, 'not-executable')
      writeFileSync(file, '#!/bin/sh\nexit 0\n')
      chmodSync(file, 0o644)
      const ran = await run(childPlan({command: [file]}), baseEnv())
      expect(ran.code).toBe(126)
      expect(ran.replayed.toString('utf8')).toBe('route-stderr: could not start the wrapped command (EACCES)\n')
    })

    it('still routes the summary of the start failure line', async () => {
      const ran = await run(
        childPlan({routes: [{prefix: 'route-stderr: ', heading: 'Router'}], command: ['route-stderr-no-such-command']}),
        baseEnv(),
      )
      expect(ran.summary).toBe('### Router\n- could not start the wrapped command (ENOENT)\n')
    })

    it('exits 126 with the error code when the system refuses to start it at all', async () => {
      const ran = await run(childPlan({command: ['a\u0000b']}), baseEnv())
      expect(ran.code).toBe(126)
      expect(ran.replayed.toString('utf8')).toBe(
        'route-stderr: could not start the wrapped command (ERR_INVALID_ARG_VALUE)\n',
      )
    })

    it('leaves out a supplied variable whose value is undefined', async () => {
      const outFile = join(dir, 'env.json')
      const script =
        'require("fs").writeFileSync(process.env.OUT_FILE, JSON.stringify({u: process.env.ROUTE_UNSET ?? null}))'
      const code = await runRouteStderr(childPlan({command: [process.execPath, '-e', script]}), {
        env: {...baseEnv({OUT_FILE: outFile}), ROUTE_UNSET: undefined},
        replay: () => undefined,
      })
      expect(code).toBe(0)
      expect(JSON.parse(readFileSync(outFile, 'utf8'))).toStrictEqual({u: null})
    })

    it("gives the command the router's own stdin and stdout, and a pipe of its own for stderr", async () => {
      const outFile = join(dir, 'fds.json')
      const script = [
        'const {fstatSync, writeFileSync} = require("fs")',
        'const id = fd => { const s = fstatSync(fd); return [s.dev, s.ino, s.rdev, s.mode].join(":") }',
        'writeFileSync(process.env.OUT_FILE, JSON.stringify([id(0), id(1), id(2)]))',
      ].join('; ')
      await run(childPlan({command: [process.execPath, '-e', script]}), baseEnv({OUT_FILE: outFile}))
      const id = (fd: number): string => {
        const stat = fstatSync(fd)
        return [stat.dev, stat.ino, stat.rdev, stat.mode].join(':')
      }
      const [stdin, stdout, stderr] = JSON.parse(readFileSync(outFile, 'utf8')) as string[]
      expect(stdin).toBe(id(0))
      expect(stdout).toBe(id(1))
      expect(stderr).not.toBe(id(2))
    })

    it('inherits stdin and stdout, and keeps only stderr for itself', () => {
      const plan: RouteStderrPlan = {
        routes: [WARNING],
        summary: 'filtered',
        command: [
          process.execPath,
          '-e',
          String.raw`process.stdin.pipe(process.stdout); process.stderr.write("wiki-ingest:warning:w1\n")`,
        ],
      }
      const spawned = spawnSync(process.execPath, [RUNNER, JSON.stringify(plan)], {
        input: 'from stdin\n',
        env: baseEnv(),
        encoding: 'utf8',
      })
      expect(spawned.status).toBe(0)
      expect(spawned.stdout).toBe('from stdin\n')
      expect(spawned.stderr).toBe('wiki-ingest:warning:w1\n')
      expect(readFileSync(summaryPath, 'utf8')).toBe('### Wiki ingest warnings\n- w1\n')
    })

    it('writes one section per route in a plan with two routes', async () => {
      const ran = await run(
        childPlan({routes: [WARNING, FINDING]}),
        baseEnv({CASE_STDERR: 'wiki-ingest:finding:f1\nwiki-ingest:warning:w1\n'}),
      )
      expect(ran.summary).toBe('### Wiki ingest warnings\n- w1\n### Wiki ingest findings\n- f1\n')
    })

    it('exits 128 plus the signal number when a signal ends it', async () => {
      const plan = childPlan({command: [process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")']})
      const ran = await run(plan, baseEnv())
      expect(ran.code).toBe(143)
    })
  })
})

// Last on purpose: this is a real process, and the fake-spawn tests above settle every other outcome.
describe('runCommand with the real spawn', () => {
  it('is the default spawn, with no seam injected', async () => {
    const result = await runCommand([process.execPath, '-e', 'process.stderr.write("real"); process.exit(4)'], {
      PATH: process.env.PATH,
    })
    expect(result.code).toBe(4)
    expect(result.stderr.toString('utf8')).toBe('real')
  })
})
