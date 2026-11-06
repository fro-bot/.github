import {Buffer} from 'node:buffer'
import {spawnSync} from 'node:child_process'
import {chmodSync, fstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  buildSummary,
  parseRoute,
  RouteStderrUsageError,
  runRouteStderr,
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
