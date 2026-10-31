import process from 'node:process'
import {afterEach, describe, expect, expectTypeOf, it, vi} from 'vitest'

import {defineCommand, runCli, runCliMain, z, type CliConfig, type CliResult, type Command} from './cli.ts'

const ESC = String.fromCodePoint(27)

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** A `dispatch-renovate`-shaped CLI: the root dispatches, `plan` is read-only. */
function dispatchShape(ran: string[]): CliConfig {
  return {
    name: 'dispatch',
    commands: [
      defineCommand({
        readOnly: false,
        action: context => {
          ran.push('dispatch')
          context.stdout('dispatched\n')
        },
      }),
      defineCommand({
        name: 'plan',
        readOnly: true,
        action: context => {
          ran.push('plan')
          context.stdout('planned\n')
        },
      }),
    ],
  }
}

/** An `enumerate-existing-leaks`-shaped CLI: no argv prints usage on stdout, `--help` exits 0. */
function usageShape(ran: unknown[]): CliConfig {
  return {
    name: 'enumerate',
    noArgv: 'usage',
    usageStream: 'stdout',
    helpCode: 0,
    commands: [
      defineCommand({
        readOnly: true,
        options: {
          private: {flag: '--private <spec>', schema: z.array(z.string()).optional()},
          branch: {flag: '--branch <ref>', schema: z.string().optional()},
        },
        action: context => {
          ran.push(context.options)
        },
      }),
    ],
  }
}

async function run(config: CliConfig, argv: readonly string[]): Promise<CliResult> {
  return runCli(config, {argv})
}

describe('config validation', () => {
  it('rejects a CLI that runs for no argv but has no root command', async () => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({name: 'plan', readOnly: true, action: () => {}})]}
    await expect(run(config, [])).rejects.toThrow(new TypeError('x: a CLI that runs for no argv needs a root command'))
  })

  it('rejects two root commands', async () => {
    const root = defineCommand({readOnly: true, action: () => {}})
    await expect(run({name: 'x', commands: [root, root]}, [])).rejects.toThrow(
      new TypeError('x: more than one root command'),
    )
  })

  it('accepts a usage CLI with no root command', async () => {
    const config: CliConfig = {
      name: 'x',
      noArgv: 'usage',
      commands: [defineCommand({name: 'plan', readOnly: true, action: () => {}})],
    }
    await expect(run(config, [])).resolves.toMatchObject({exitCode: 1})
  })
})

function capture(positionals: Parameters<typeof defineCommand>[0]['positionals']) {
  const seen: unknown[] = []
  const config: CliConfig = {
    name: 'x',
    commands: [
      defineCommand({
        readOnly: true,
        positionals,
        action: context => {
          seen.push(context.positionals)
        },
      }),
    ],
  }
  return {config, seen}
}

function limitCli(action: (value: unknown) => void): CliConfig {
  return {
    name: 'x',
    commands: [
      defineCommand({
        readOnly: true,
        options: {limit: {flag: '--limit <n>', schema: z.number().int().min(1).optional()}},
        action: context => {
          action(context.options.limit)
        },
      }),
    ],
  }
}

function throwing(thrown: () => unknown): CliConfig {
  return {
    name: 'x',
    commands: [
      defineCommand({
        readOnly: true,
        action: () => {
          throw thrown()
        },
      }),
    ],
  }
}

async function bareGoke(options: {readonly help: boolean; readonly exit: (code: number) => void}) {
  const goke = await import('goke')
  const output = {stdout: [] as string[], stderr: [] as string[]}
  const cli = goke.goke('bare', {
    stdout: {
      write: text => {
        output.stdout.push(text)
      },
    },
    stderr: {
      write: text => {
        output.stderr.push(text)
      },
    },
    exit: options.exit,
    columns: Number.POSITIVE_INFINITY,
  })
  if (options.help) cli.help()
  return {cli, output, goke}
}

async function standIn(overrides: Record<string, () => never>) {
  const real = await import('goke')
  class StandInGoke extends real.Goke {}
  Object.assign(StandInGoke.prototype, overrides)
  return {...real, Goke: StandInGoke} as unknown as typeof real
}

describe('no-argv category: runs', () => {
  it('runs the root command for no argv, with its output and exit 0', async () => {
    const ran: string[] = []
    const result = await run(dispatchShape(ran), [])
    expect(result).toEqual({exitCode: 0, stdout: 'dispatched\n', stderr: ''})
    expect(ran).toEqual(['dispatch'])
  })

  it('runs a named read-only command', async () => {
    const ran: string[] = []
    const result = await run(dispatchShape(ran), ['plan'])
    expect(result).toEqual({exitCode: 0, stdout: 'planned\n', stderr: ''})
    expect(ran).toEqual(['plan'])
  })

  it.each([['pln'], ['--help'], ['-h'], ['plan', 'extra'], ['--dry-run']])(
    'argv %j matches nothing declared: usage code, stdout empty, help on stderr, nothing dispatched',
    async (...argv) => {
      const ran: string[] = []
      const result = await run(dispatchShape(ran), argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
      expect(ran).toEqual([])
    },
  )
})

describe('no-argv category: usage', () => {
  it('prints usage on stdout, returns the usage code and runs nothing for no argv', async () => {
    const ran: unknown[] = []
    const result = await run(usageShape(ran), [])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--private <spec>')
    expect(result.stderr).toBe('')
    expect(ran).toEqual([])
  })

  it('prints the same usage for --help but returns the help code', async () => {
    const ran: unknown[] = []
    const noArgv = await run(usageShape(ran), [])
    const help = await run(usageShape(ran), ['--help'])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toBe(noArgv.stdout)
    expect(help.stderr).toBe('')
    expect(ran).toEqual([])
  })

  it('runs the root command once argv is not empty', async () => {
    const ran: unknown[] = []
    const result = await run(usageShape(ran), ['--branch', 'main', '--private', 'a'])
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
    expect(ran).toEqual([{branch: 'main', private: ['a']}])
  })

  it('returns the usage code for argv that matches nothing, with the error on stderr and usage on stdout', async () => {
    const ran: unknown[] = []
    const result = await run(usageShape(ran), ['--bogus'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error: Unknown option `--bogus`')
    expect(result.stdout).toContain('Usage:')
    expect(ran).toEqual([])
  })

  it('uses a custom usage code and keeps stdout empty when usage prints to stderr', async () => {
    const config: CliConfig = {
      name: 'x',
      usageCode: 2,
      commands: [defineCommand({readOnly: true, action: () => {}})],
    }
    const result = await run(config, ['stray'])
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unknown command: stray')
    expect(result.stderr).toContain('Usage:')
  })

  it('applies a custom usage code to a no-argv usage and a help code of its own', async () => {
    const config: CliConfig = {
      name: 'x',
      noArgv: 'usage',
      usageCode: 64,
      helpCode: 7,
      commands: [defineCommand({readOnly: true, action: () => {}})],
    }
    expect((await run(config, [])).exitCode).toBe(64)
    expect((await run(config, ['--help'])).exitCode).toBe(7)
  })
})

describe('declared positionals and flags', () => {
  it.each([
    [[], {first: undefined, second: undefined}],
    [['a'], {first: 'a', second: undefined}],
    [['a', 'b'], {first: 'a', second: 'b'}],
  ])('two optional positionals (daily-digest-counts) with argv %j', async (argv, expected) => {
    const {config, seen} = capture([
      {name: 'first', kind: 'optional'},
      {name: 'second', kind: 'optional'},
    ])
    expect((await run(config, argv)).exitCode).toBe(0)
    expect(seen).toEqual([expected])
  })

  it('one optional positional (resolve-private, wiki-lint-issues)', async () => {
    const {config, seen} = capture([{name: 'path', kind: 'optional'}])
    await run(config, ['metadata/repos.yaml'])
    await run(config, [])
    expect(seen).toEqual([{path: 'metadata/repos.yaml'}, {path: undefined}])
  })

  it.each([
    [[], []],
    [['a.json'], ['a.json']],
    [
      ['a.json', 'b.json', 'c.json'],
      ['a.json', 'b.json', 'c.json'],
    ],
  ])('variadic positionals (check-renovate-ranges) with argv %j', async (argv, expected) => {
    const {config, seen} = capture([{name: 'configs', kind: 'variadic'}])
    expect((await run(config, argv)).exitCode).toBe(0)
    expect(seen).toEqual([{configs: expected}])
  })

  it('a fixed positional followed by a variadic one', async () => {
    const {config, seen} = capture([
      {name: 'head', kind: 'required'},
      {name: 'rest', kind: 'variadic'},
    ])
    await run(config, ['a', 'b', 'c'])
    expect(seen).toEqual([{head: 'a', rest: ['b', 'c']}])
  })

  it('a missing required positional is a usage error', async () => {
    const {config, seen} = capture([{name: 'path', kind: 'required'}])
    const result = await run(config, [])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing required argument `<path>`')
    expect(seen).toEqual([])
  })

  it('a flag (check-private-leak --promotion), present and absent', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'leak',
      commands: [
        defineCommand({
          readOnly: true,
          options: {promotion: {flag: '--promotion', schema: z.boolean().optional()}},
          action: context => {
            seen.push(context.options.promotion)
          },
        }),
      ],
    }
    await run(config, ['--promotion'])
    await run(config, [])
    expect(seen).toEqual([true, undefined])
  })

  it('reads a kebab-case flag under its camelCase key', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {dryRun: {flag: '--dry-run', schema: z.boolean().optional()}},
          action: context => {
            seen.push(context.options)
          },
        }),
      ],
    }
    await run(config, ['--dry-run'])
    expect(seen).toEqual([{dryRun: true}])
  })
})

describe('argv that does not fit the declaration', () => {
  it('rejects an extra positional on a root that declares positionals; goke alone would run and drop it', async () => {
    const action = vi.fn()
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          positionals: [
            {name: 'a', kind: 'optional'},
            {name: 'b', kind: 'optional'},
          ],
          action,
        }),
      ],
    }
    const result = await run(config, ['a', 'b', 'c'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('error: unexpected argument `c`')
    expect(action).not.toHaveBeenCalled()
  })

  it('rejects any positional on a root that declares none (the check-private-leak shape)', async () => {
    const action = vi.fn()
    const config: CliConfig = {name: 'leak', commands: [defineCommand({readOnly: true, action})]}
    const result = await run(config, ['stray'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unknown command: stray')
    expect(action).not.toHaveBeenCalled()
  })

  it('rejects arguments after `--`, and never hands the action an options[`--`] key', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {flag: {flag: '--flag', schema: z.boolean().optional()}},
          action: context => {
            seen.push(context.options)
          },
        }),
      ],
    }
    const trailing = await run(config, ['--flag', '--', 'extra'])
    expect(trailing.exitCode).toBe(1)
    expect(trailing.stderr).toContain('error: unexpected arguments after `--`')

    const plain = await run(config, ['--flag'])
    expect(plain.exitCode).toBe(0)
    expect(seen).toHaveLength(1)
    expect(Object.keys(seen[0] as object)).toEqual(['flag'])
    expect(JSON.stringify(seen[0])).not.toContain('--')
  })

  it('rejects a flag no command declares', async () => {
    const action = vi.fn()
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action})]}
    const result = await run(config, ['--bogus'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error: Unknown option `--bogus`')
    expect(action).not.toHaveBeenCalled()
  })
})

describe('zod refinements', () => {
  it.each([['0'], ['-3']])(
    'a value that violates `.min(1)` (%s) is a usage error and the action does not run',
    async value => {
      const action = vi.fn()
      const result = await run(limitCli(action), ['--limit', value])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('error: limit: ')
      expect(action).not.toHaveBeenCalled()
    },
  )

  it('runs the action with the value that satisfies it', async () => {
    const action = vi.fn()
    expect((await run(limitCli(action), ['--limit', '5'])).exitCode).toBe(0)
    expect(action).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('hands the action what zod parsed, transforms included', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {name: {flag: '--name <name>', schema: z.string().transform(value => value.toUpperCase())}},
          action: context => {
            seen.push(context.options.name)
          },
        }),
      ],
    }
    await run(config, ['--name', 'abc'])
    expect(seen).toEqual(['ABC'])
  })

  it('a missing value, a repeated scalar flag and a non-numeric value are exit-1 errors with the message on stderr', async () => {
    const action = vi.fn()
    const cli = limitCli(action)
    for (const argv of [['--limit'], ['--limit', '1', '--limit', '2'], ['--limit', 'abc']]) {
      const result = await run(cli, argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('error: ')
    }
    expect(action).not.toHaveBeenCalled()
  })
})

describe('--help', () => {
  it('on a CLI that documents no help is unmatched argv: usage code, stdout empty, help on stderr, no action', async () => {
    const action = vi.fn()
    const config: CliConfig = {name: 'leak', commands: [defineCommand({readOnly: true, action})]}
    for (const flag of ['--help', '-h']) {
      const result = await run(config, [flag])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
    }
    expect(action).not.toHaveBeenCalled()
  })

  it('on a CLI that documents help returns the help code with usage on the usage stream', async () => {
    const result = await run(usageShape([]), ['-h'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
  })

  it('lists each command and flag without wrapping a long description', async () => {
    const description = 'a very long description that goke would wrap to the terminal width '.repeat(6).trim()
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {mode: {flag: '--mode <mode>', schema: z.string().describe(description).optional()}},
          action: () => {},
        }),
      ],
    }
    const result = await run(config, ['--help'])
    expect(result.stderr).toContain(description)
  })
})

describe('action results and errors', () => {
  it('an action that returns a number exits with it', async () => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => 3})]}
    expect(await run(config, [])).toEqual({exitCode: 3, stdout: '', stderr: ''})
  })

  it('an async action that returns a number exits with it', async () => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: async () => 2})]}
    expect((await run(config, [])).exitCode).toBe(2)
  })

  it.each([
    ['a returned string', 'text'],
    ['a returned object', {code: 5}],
    ['undefined', undefined],
  ])('%s is not an exit code: exit 0', async (_label, value) => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => value})]}
    expect((await run(config, [])).exitCode).toBe(0)
  })

  it('a thrown Error reports its message alone, with no stack and no `exit:1` line', async () => {
    const result = await run(
      throwing(() => new Error('it broke')),
      [],
    )
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'it broke\n'})
  })

  it('a thrown non-Error is reported as a string', async () => {
    const result = await run(
      throwing(() => 'plain'),
      [],
    )
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'plain\n'})
  })

  it('an async rejection returns non-zero', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          action: async () => {
            await Promise.resolve()
            throw new Error('late')
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 1, stdout: '', stderr: 'late\n'})
  })

  it('keeps what the action wrote before it threw', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          action: context => {
            context.stdout('partial\n')
            context.stderr('note\n')
            throw new Error('then failed')
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 1, stdout: 'partial\n', stderr: 'note\nthen failed\n'})
  })

  it('uses the CLI error format and error exit code', async () => {
    const config: CliConfig = {
      name: 'x',
      errorExitCode: 0,
      errorFormat: error => `::error::x: ${error instanceof Error ? error.message : 'unknown'}\n`,
      commands: [
        defineCommand({
          readOnly: false,
          action: () => {
            throw new Error('network down')
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 0, stdout: '', stderr: '::error::x: network down\n'})
  })

  it('an error exit code of 2 is used as given', async () => {
    const config: CliConfig = {
      name: 'x',
      errorExitCode: 2,
      commands: [
        defineCommand({
          readOnly: false,
          action: () => {
            throw new Error('x')
          },
        }),
      ],
    }
    expect((await run(config, [])).exitCode).toBe(2)
  })

  it('writes output in order to the right stream', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          action: context => {
            context.stdout('one\n')
            context.stderr('warn\n')
            context.stdout('two\n')
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 0, stdout: 'one\ntwo\n', stderr: 'warn\n'})
  })

  it('gives the action the environment it was run with', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          action: context => {
            seen.push(context.env.TOKEN)
          },
        }),
      ],
    }
    await runCli(config, {argv: [], env: {TOKEN: 'abc'}})
    process.env.RUNNER_TEST_TOKEN = 'ambient'
    await run(
      {
        ...config,
        commands: [
          defineCommand({
            readOnly: true,
            action: context => {
              seen.push(context.env.RUNNER_TEST_TOKEN)
            },
          }),
        ],
      },
      [],
    )
    delete process.env.RUNNER_TEST_TOKEN
    expect(seen).toEqual(['abc', 'ambient'])
  })
})

describe('colour', () => {
  it('strips ANSI from an action error, from help and from a parse error', async () => {
    const config: CliConfig = {
      name: 'x',
      errorFormat: () => `${ESC}[31mred${ESC}[0m ${ESC}[1;4mbold${ESC}[22;24m\n`,
      commands: [
        defineCommand({
          readOnly: true,
          action: () => {
            throw new Error('x')
          },
        }),
      ],
    }
    const failed = await run(config, [])
    expect(failed.stderr).toBe('red bold\n')

    for (const argv of [['--help'], ['--bogus'], ['stray']]) {
      const result = await run(config, argv)
      expect(result.stderr).not.toContain(ESC)
      expect(result.stdout).not.toContain(ESC)
    }
  })

  it('under CI=true, parse errors, zod errors and help carry no ANSI and no stack', async () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('NO_COLOR', '')
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {limit: {flag: '--limit <n>', schema: z.number().int().min(1).optional()}},
          action: () => {},
        }),
      ],
    }
    for (const argv of [['--help'], ['--bogus'], ['--limit', '0'], ['--limit', 'abc'], ['--limit']]) {
      const result = await run(config, argv)
      expect(`${result.stdout}${result.stderr}`).not.toContain(ESC)
      expect(result.stderr).not.toMatch(/\n\s+at /u)
    }
    vi.unstubAllEnvs()
  })
})

describe('goke behaviour the runner depends on', () => {
  it('exits 0 silently on an unknown command when help is not registered', async () => {
    const exit = vi.fn()
    const {cli, output} = await bareGoke({help: false, exit})
    cli.command('plan')
    await cli.parse(['bun', 'bare', 'pln'])
    expect(exit).not.toHaveBeenCalled()
    expect(output).toEqual({stdout: [], stderr: []})
  })

  it('runs a root action with the declared positionals and drops the extras', async () => {
    const action = vi.fn()
    const {cli} = await bareGoke({help: true, exit: vi.fn()})
    cli.command('[a] [b]').action(action)
    await cli.parse(['bun', 'bare', 'a', 'b', 'c'])
    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0]?.slice(0, 2)).toEqual(['a', 'b'])
  })

  it('does not enforce a zod refinement', async () => {
    const action = vi.fn()
    const {cli} = await bareGoke({help: true, exit: vi.fn()})
    cli.command('').option('--limit <n>', z.number().int().min(1)).action(action)
    await cli.parse(['bun', 'bare', '--limit', '0'])
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('prints help to stdout and does not exit for --help', async () => {
    const exit = vi.fn()
    const {cli, output} = await bareGoke({help: true, exit})
    cli.command('')
    await cli.parse(['bun', 'bare', '--help'])
    expect(exit).not.toHaveBeenCalled()
    expect(output.stdout.join('')).toContain('Usage:')
    expect(output.stderr).toEqual([])
  })

  it('with a no-op exit, rejects with the original error on a parse error', async () => {
    const exit = vi.fn()
    const {cli, goke} = await bareGoke({help: true, exit})
    cli.command('').option('--limit <n>', z.number())
    const settled = await cli.parse(['bun', 'bare', '--limit', 'abc']).then(
      () => 'resolved',
      (error: unknown) => error,
    )
    expect(settled).toBeInstanceOf(goke.GokeError)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('with a no-op exit, resolves with the code only recorded on an async action error', async () => {
    const exit = vi.fn()
    const {cli} = await bareGoke({help: true, exit})
    cli.command('').action(async () => {
      await Promise.resolve()
      throw new Error('late failure')
    })
    await expect(cli.parse(['bun', 'bare'])).resolves.toBeDefined()
    // `parse()` resolved, so a caller that trusted the promise would report success; the code was only recorded.
    expect(exit).toHaveBeenCalledWith(1)
  })
})

/** A goke stand-in that records the raw name of every command registered. */
async function recordingGoke(rawNames: string[]) {
  const real = await import('goke')
  // The original is called back with the instance as `this`, so unbinding it here is deliberate.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = real.Goke.prototype.command
  class RecordingGoke extends real.Goke {}
  RecordingGoke.prototype.command = function command(
    this: InstanceType<typeof real.Goke>,
    ...args: Parameters<typeof original>
  ) {
    rawNames.push(args[0])
    return original.apply(this, args)
  } as typeof original
  return {...real, Goke: RecordingGoke} as unknown as typeof real
}

describe('what the runner hands goke', () => {
  it('names the root by its positional tokens alone and a command by its words then its tokens', async () => {
    const rawNames: string[] = []
    const importGoke = async () => recordingGoke(rawNames)
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({readOnly: true, action: () => {}}),
        defineCommand({
          name: 'plan',
          readOnly: true,
          positionals: [
            {name: 'head', kind: 'required'},
            {name: 'middle', kind: 'optional'},
            {name: 'rest', kind: 'variadic'},
          ],
          action: () => {},
        }),
        defineCommand({name: 'sub cmd', readOnly: true, action: () => {}}),
        defineCommand({
          name: 'other',
          readOnly: true,
          positionals: [{name: 'only', kind: 'optional'}],
          action: () => {},
        }),
      ],
    }
    await runCli(config, {argv: [], importGoke})
    expect(rawNames).toEqual(['', 'plan <head> [middle] [...rest]', 'sub cmd', 'other [only]'])
  })

  it('names a root with positionals by its tokens alone, with no leading space', async () => {
    const rawNames: string[] = []
    const importGoke = async () => recordingGoke(rawNames)
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          positionals: [
            {name: 'first', kind: 'optional'},
            {name: 'second', kind: 'optional'},
          ],
          action: () => {},
        }),
      ],
    }
    await runCli(config, {argv: [], importGoke})
    expect(rawNames).toEqual(['[first] [second]'])
  })

  it('imports goke with NO_COLOR set, and puts it back afterwards', async () => {
    const seen: (string | undefined)[] = []
    const importGoke = async () => {
      seen.push(process.env.NO_COLOR)
      return import('goke')
    }
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}

    vi.stubEnv('NO_COLOR', 'kept')
    await runCli(config, {argv: [], importGoke})
    expect(process.env.NO_COLOR).toBe('kept')

    delete process.env.NO_COLOR
    await runCli(config, {argv: [], importGoke})
    expect('NO_COLOR' in process.env).toBe(false)
    vi.unstubAllEnvs()

    expect(seen).toEqual(['1', '1'])
  })

  it('puts NO_COLOR back when the import fails', async () => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    vi.stubEnv('NO_COLOR', 'kept')
    await expect(
      runCli(config, {
        argv: [],
        importGoke: async () => {
          throw new Error('no goke')
        },
      }),
    ).rejects.toThrow('no goke')
    expect(process.env.NO_COLOR).toBe('kept')
    vi.unstubAllEnvs()
  })
})

describe('usage output', () => {
  const HELP = 'x\n\nUsage:\n  $ x [options]\n\nCommands:\n  x\n\nOptions:\n  -h, --help  Display this message\n'

  it('prints exactly goke help for --help, once', async () => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    expect(await run(config, ['--help'])).toEqual({exitCode: 1, stdout: '', stderr: HELP})
  })

  it('prints the error line, then goke help once, for a usage error the runner found', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [defineCommand({readOnly: true, positionals: [{name: 'a', kind: 'optional'}], action: () => {}})],
    }
    const result = await run(config, ['one', 'two'])
    expect(result.stderr).toBe(
      'error: unexpected argument `two`\nx\n\nUsage:\n  $ x [a]\n\nCommands:\n  [a]\n\nOptions:\n  -h, --help  Display this message\n',
    )
  })

  it('prints help once, and no error line, for an unknown command', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({name: 'plan', readOnly: true, action: () => {}}),
        defineCommand({readOnly: true, action: () => {}}),
      ],
    }
    const result = await run(config, ['zzz'])
    expect(result.stderr.split('Usage:')).toHaveLength(2)
    expect(result.stderr).toContain('Unknown command: zzz')
    expect(result.stderr).not.toContain('undefined')
  })

  it('reports flags on a CLI with no root command as unrecognized arguments', async () => {
    const config: CliConfig = {
      name: 'x',
      noArgv: 'usage',
      commands: [defineCommand({name: 'plan', readOnly: true, action: () => {}})],
    }
    const result = await run(config, ['--bogus'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error: unrecognized arguments: --bogus\n')
    expect(result.stdout).toBe('')
  })

  it('lists every unrecognized argument, space separated', async () => {
    const config: CliConfig = {
      name: 'x',
      noArgv: 'usage',
      commands: [defineCommand({name: 'plan', readOnly: true, action: () => {}})],
    }
    const result = await run(config, ['--bogus', '--other', 'word'])
    expect(result.stderr).toContain('error: unrecognized arguments: --bogus --other word\n')
  })

  it('prints a parse error, goke hint and help in that order, each once', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {limit: {flag: '--limit <n>', schema: z.number().optional()}},
          action: () => {},
        }),
      ],
    }
    const result = await run(config, ['--limit', 'abc'])
    expect(result.stderr.startsWith('error: Invalid value for --limit: expected number, got "abc"\n')).toBe(true)
    expect(result.stderr).toContain('\nRun "x --help" for usage information.\n')
    expect(result.stderr.split('Usage:')).toHaveLength(2)
  })

  it('shows each positional kind in goke help as <required>, [optional] and [...variadic]', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          positionals: [
            {name: 'head', kind: 'required'},
            {name: 'middle', kind: 'optional'},
            {name: 'rest', kind: 'variadic'},
          ],
          action: () => {},
        }),
      ],
    }
    const result = await run(config, ['--help'])
    expect(result.stderr).toContain('$ x <head> [middle] [...rest]')
  })

  it('names the option and joins several zod issues with `; `, an array element by its index', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {
            limit: {flag: '--limit <n>', schema: z.number().min(1).optional()},
            sizes: {flag: '--sizes <n>', schema: z.array(z.number().min(1)).optional()},
          },
          action: () => {},
        }),
      ],
    }
    const result = await run(config, ['--limit', '0', '--sizes', '5', '--sizes', '0'])
    const [line] = result.stderr.split('\n')
    expect(line).toBe(
      'error: limit: Too small: expected number to be >=1; sizes.1: Too small: expected number to be >=1',
    )
  })
})

describe('the actions registered with goke', () => {
  it('are traps: goke never runs an action, and one that did would end the run as a usage error', async () => {
    const {Command} = await import('goke')
    const callbacks: (() => unknown)[] = []
    // The prototype is shared with the real class, so it is put back in `finally`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = Command.prototype.action
    Command.prototype.action = function action(this: InstanceType<typeof Command>, callback: () => unknown) {
      callbacks.push(callback)
      return original.call(this, callback)
    }
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    try {
      await runCli(config, {argv: []})
    } finally {
      Command.prototype.action = original
    }
    expect(callbacks).toHaveLength(1)
    expect(() => callbacks[0]?.()).toThrow()
  })
})

describe('failures inside goke itself', () => {
  it('lets an unexpected error from parse() reject, instead of reporting it as a usage error', async () => {
    const importGoke = async () =>
      standIn({
        parse: () => {
          throw new TypeError('goke broke')
        },
      })
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    await expect(runCli(config, {argv: [], importGoke})).rejects.toThrow(new TypeError('goke broke'))
  })

  it('lets an unexpected error from goke argument checks reject', async () => {
    const real = await import('goke')
    const importGoke = async () => {
      class StandInGoke extends real.Goke {
        override async parse(...args: Parameters<InstanceType<typeof real.Goke>['parse']>) {
          const parsed = await super.parse(...args)
          const command = this.matchedCommand
          if (command !== undefined) {
            command.checkUnknownOptions = () => {
              throw new TypeError('check broke')
            }
          }
          return parsed
        }
      }
      return {...real, Goke: StandInGoke} as unknown as typeof real
    }
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    await expect(runCli(config, {argv: [], importGoke})).rejects.toThrow(new TypeError('check broke'))
  })
})

describe('runCliMain', () => {
  const config: CliConfig = {
    name: 'x',
    commands: [
      defineCommand({
        readOnly: true,
        options: {code: {flag: '--code <n>', schema: z.number().optional()}},
        action: context => {
          context.stdout('out\n')
          context.stderr('err\n')
          return context.options.code ?? 0
        },
      }),
    ],
  }

  it('writes the result to the given streams and sets process.exitCode without exiting', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const written: string[] = []
    await runCliMain(config, {
      argv: ['--code', '4'],
      stdout: text => {
        written.push(`stdout:${text}`)
      },
      stderr: text => {
        written.push(`stderr:${text}`)
      },
    })
    expect(written).toEqual(['stdout:out\n', 'stderr:err\n'])
    expect(process.exitCode).toBe(4)
    expect(exit).not.toHaveBeenCalled()
  })

  it('writes nothing for an empty stream', async () => {
    const quiet: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    const stdout = vi.fn()
    const stderr = vi.fn()
    await runCliMain(quiet, {argv: [], stdout, stderr})
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
  })

  it('defaults to the process argv, environment and streams', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'script.ts', '--code', '6']
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await runCliMain(config)
    } finally {
      process.argv = originalArgv
    }
    expect(stdoutWrite).toHaveBeenCalledWith('out\n')
    expect(stderrWrite).toHaveBeenCalledWith('err\n')
    expect(process.exitCode).toBe(6)
  })
})

describe('a bare `--`', () => {
  it('is non-empty argv that matches nothing: the usage error, and the root action does not run', async () => {
    const action = vi.fn()
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: false, action})]}
    const result = await run(config, ['--'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('error: unexpected `--`\n')
    expect(result.stderr).toContain('Usage:')
    expect(action).not.toHaveBeenCalled()
  })

  it('does not dispatch on a dispatch-shaped CLI', async () => {
    const ran: string[] = []
    const result = await run(dispatchShape(ran), ['--'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(ran).toEqual([])
  })

  it('uses the usage code and usage stream of a CLI whose no-argv mode is usage', async () => {
    const ran: unknown[] = []
    const config: CliConfig = {...usageShape(ran), usageCode: 64}
    const result = await run(config, ['--'])
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toBe('error: unexpected `--`\n')
    expect(ran).toEqual([])
  })

  it('is rejected after a flag as well', async () => {
    const action = vi.fn()
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {flag: {flag: '--flag', schema: z.boolean().optional()}},
          action,
        }),
      ],
    }
    const result = await run(config, ['--flag', '--'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error: unexpected `--`\n')
    expect(action).not.toHaveBeenCalled()
  })

  it('keeps the message for values after it', async () => {
    const config: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}
    const result = await run(config, ['--', 'extra'])
    expect(result.stderr).toContain('error: unexpected arguments after `--`\n')
  })
})

describe('ANSI in the output the runner writes', () => {
  const sgr = `${ESC}[31mred${ESC}[0m`

  it.each([
    ['an unknown option', [`--bogus${sgr}`], 'Unknown option'],
    ['an unexpected positional', ['one', `two${sgr}`], 'unexpected argument'],
  ])('strips it from the usage error for %s', async (_label, argv, message) => {
    const config: CliConfig = {
      name: 'x',
      commands: [defineCommand({readOnly: true, positionals: [{name: 'a', kind: 'optional'}], action: () => {}})],
    }
    const result = await run(config, argv)
    expect(result.stderr).toContain(message)
    expect(result.stderr).toContain('red')
    expect(result.stderr).not.toContain(ESC)
  })

  it('strips it from the unrecognized-arguments error', async () => {
    const config: CliConfig = {
      name: 'x',
      noArgv: 'usage',
      commands: [defineCommand({name: 'plan', readOnly: true, action: () => {}})],
    }
    const result = await run(config, [`--bogus${sgr}`])
    expect(result.stderr).toContain('error: unrecognized arguments: --bogusred\n')
    expect(result.stderr).not.toContain(ESC)
  })

  it('strips it from a zod message', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {mode: {flag: '--mode <mode>', schema: z.string().refine(() => false, `bad ${sgr}`)}},
          action: () => {},
        }),
      ],
    }
    const result = await run(config, ['--mode', 'a'])
    expect(result.stderr).toContain('mode: bad red')
    expect(result.stderr).not.toContain(ESC)
  })

  it('strips it from what an action writes to stdout and stderr', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          action: context => {
            context.stdout(`${sgr} out\n`)
            context.stderr(`${ESC}[1;4mbold${ESC}[22;24m err\n`)
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 0, stdout: 'red out\n', stderr: 'bold err\n'})
  })
})

/** An import that waits at a gate, so overlapping runs are both inside it at once. */
function gatedImport(seen: (string | undefined)[], gate: Promise<void>) {
  return async () => {
    seen.push(process.env.NO_COLOR)
    await gate
    return import('goke')
  }
}

describe('NO_COLOR around the goke import', () => {
  const EMPTY: CliConfig = {name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}

  it.each([
    ['absent', undefined],
    ['set to a value', 'kept'],
    ['set to an empty string', ''],
  ])('leaves NO_COLOR as it found it (%s) after overlapping runs with their own import', async (_label, initial) => {
    if (initial === undefined) vi.stubEnv('NO_COLOR', 'placeholder')
    else vi.stubEnv('NO_COLOR', initial)
    if (initial === undefined) delete process.env.NO_COLOR
    const seen: (string | undefined)[] = []
    let open: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const importGoke = gatedImport(seen, gate)

    const pending = Promise.all([
      runCli(EMPTY, {argv: [], importGoke}),
      runCli(EMPTY, {argv: [], importGoke}),
      runCli(EMPTY, {argv: [], importGoke}),
    ])
    await Promise.resolve()
    open()
    await pending

    expect(seen).toEqual(['1', '1', '1'])
    if (initial === undefined) expect('NO_COLOR' in process.env).toBe(false)
    else expect(process.env.NO_COLOR).toBe(initial)
    vi.unstubAllEnvs()
  })

  it('keeps NO_COLOR set for a slow import after a faster overlapping one has finished', async () => {
    vi.stubEnv('NO_COLOR', 'kept')
    const seenBySlow: (string | undefined)[] = []
    let open: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const fast = runCli(EMPTY, {argv: [], importGoke: async () => import('goke')})
    const slow = runCli(EMPTY, {
      argv: [],
      importGoke: async () => {
        await gate
        seenBySlow.push(process.env.NO_COLOR)
        return import('goke')
      },
    })
    await fast
    expect(process.env.NO_COLOR).toBe('1')
    open()
    await slow

    expect(seenBySlow).toEqual(['1'])
    expect(process.env.NO_COLOR).toBe('kept')
    vi.unstubAllEnvs()
  })

  it.each([
    ['absent', undefined],
    ['set to a value', 'kept'],
  ])('leaves NO_COLOR as it found it (%s) after overlapping runs on the default import', async (_label, initial) => {
    vi.stubEnv('NO_COLOR', initial ?? 'placeholder')
    if (initial === undefined) delete process.env.NO_COLOR
    vi.resetModules()
    const fresh = await import('./cli.ts')

    await Promise.all([fresh.runCli(EMPTY, {argv: []}), fresh.runCli(EMPTY, {argv: []})])

    if (initial === undefined) expect('NO_COLOR' in process.env).toBe(false)
    else expect(process.env.NO_COLOR).toBe(initial)
    vi.unstubAllEnvs()
  })

  it('sets and restores NO_COLOR once for the default import, however many runs follow', async () => {
    vi.stubEnv('NO_COLOR', 'kept')
    const writes: string[] = []
    const realEnvironment = process.env
    process.env = new Proxy(realEnvironment, {
      set(target, key, value: string) {
        if (key === 'NO_COLOR') writes.push(`set ${value}`)
        return Reflect.set(target, key, value)
      },
      deleteProperty(target, key) {
        if (key === 'NO_COLOR') writes.push('delete')
        return Reflect.deleteProperty(target, key)
      },
    })
    try {
      vi.resetModules()
      const fresh = await import('./cli.ts')
      await fresh.runCli(EMPTY, {argv: []})
      expect(writes).toEqual(['set 1', 'set kept'])
      await fresh.runCli(EMPTY, {argv: []})
      await Promise.all([fresh.runCli(EMPTY, {argv: []}), fresh.runCli(EMPTY, {argv: []})])
      expect(writes).toEqual(['set 1', 'set kept'])
    } finally {
      process.env = realEnvironment
      vi.unstubAllEnvs()
    }
  })

  it('does not use the cached import for a seam: each seam run goes through its own import', async () => {
    const calls: number[] = []
    const importGoke = async () => {
      calls.push(calls.length)
      return import('goke')
    }
    await runCli(EMPTY, {argv: [], importGoke})
    await runCli(EMPTY, {argv: [], importGoke})
    expect(calls).toEqual([0, 1])
  })
})

describe('a command exposes no unchecked way to run its action', () => {
  it('has no run member on its type', () => {
    expectTypeOf<Command>().not.toHaveProperty('run')
  })

  it('gives the action the types its schemas parse to', () => {
    defineCommand({
      readOnly: true,
      options: {
        limit: {flag: '--limit <n>', schema: z.number().optional()},
        name: {flag: '--name <name>', schema: z.string().default('x')},
      },
      action: context => {
        expectTypeOf(context.options.limit).toEqualTypeOf<number | undefined>()
        expectTypeOf(context.options.name).toEqualTypeOf<string>()
      },
    })
  })

  const limited = (seen: unknown[]) =>
    defineCommand({
      readOnly: true,
      options: {limit: {flag: '--limit <n>', schema: z.number().int().min(1)}},
      action: context => {
        seen.push(context.options.limit)
      },
    })
  const io = {
    positionals: {},
    env: {},
    stdout: () => {},
    stderr: () => {},
  }

  it('prepare refuses options a schema rejects, with the issue text, and runs nothing', () => {
    const seen: unknown[] = []
    const prepared = limited(seen).prepare({limit: '5'})
    expect(prepared).toEqual({ok: false, message: 'limit: Invalid input: expected number, received string'})
    const refined = limited(seen).prepare({limit: 0})
    expect(refined).toEqual({ok: false, message: 'limit: Too small: expected number to be >=1'})
    expect(seen).toEqual([])
  })

  it('prepare hands the action what the schemas parsed, and only when run', () => {
    const seen: unknown[] = []
    const prepared = limited(seen).prepare({limit: 5})
    expect(prepared.ok).toBe(true)
    expect(seen).toEqual([])
    if (prepared.ok) prepared.run(io)
    expect(seen).toEqual([5])
  })

  it('prepare returns the action result', () => {
    const command = defineCommand({readOnly: true, action: () => 7})
    const prepared = command.prepare({})
    expect(prepared.ok && prepared.run(io)).toBe(7)
  })
})
