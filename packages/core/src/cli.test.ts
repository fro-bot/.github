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
    expect(result.stderr).toContain('error: missing required argument `<path>` for command `<path>`\n')
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

  it('strips a sequence an action splits across two writes', async () => {
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          action: context => {
            context.stdout(`${ESC}[`)
            context.stdout(`31mred${ESC}[0m\n`)
            context.stderr(`${ESC}[`)
            context.stderr(`1mbold${ESC}[22m\n`)
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 0, stdout: 'red\n', stderr: 'bold\n'})
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

describe('dotted option names', () => {
  // goke writes a dotted option name into nested objects. These names are harmless to goke, so a
  // regression cannot poison this process; the hostile names run in their own process in
  // `cli.pollution.test.ts`.
  const config = (action: () => void, usageCode = 64): CliConfig => ({
    name: 'x',
    usageCode,
    commands: [
      defineCommand({
        readOnly: false,
        options: {flag: {flag: '--flag', schema: z.boolean().optional()}},
        action,
      }),
    ],
  })

  it.each([
    [['--a.b=1'], '--a.b'],
    [['--a.b', '1'], '--a.b'],
    [['--a.b.c=1'], '--a.b.c'],
    [['--no-a.b'], '--no-a.b'],
    [['-a.b'], '-a.b'],
    [['---a.b=1'], '---a.b'],
    [['--.a'], '--.a'],
    [['--a.'], '--a.'],
    [['--flag', '--a.b=1'], '--a.b'],
    [['--a.b=1.5'], '--a.b'],
    [['-1.5.x'], '-1.5.x'],
    [['-x-1.5'], '-x-1.5'],
  ])('rejects %j as a usage error naming %s, and runs nothing', async (argv, named) => {
    const action = vi.fn()
    const result = await run(config(action), argv)
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^error: unsupported dotted option name `[^`]+`\n/u)
    expect(result.stderr).toContain(`error: unsupported dotted option name \`${named}\`\n`)
    expect(result.stderr).toContain('Usage:')
    expect(action).not.toHaveBeenCalled()
  })

  it('writes the usage error to the usage stream of the CLI', async () => {
    const result = await run({...usageShape([]), usageStream: 'stdout', usageCode: 3}, ['--a.b=1'])
    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toBe('error: unsupported dotted option name `--a.b`\n')
  })

  it('names the flag as written, without its value, and without ANSI', async () => {
    const result = await run(config(vi.fn()), [`--a.${ESC}[31mred${ESC}[0m=secret`])
    expect(result.stderr).toContain('error: unsupported dotted option name `--a.red`\n')
    expect(result.stderr).not.toContain('secret')
    expect(result.stderr).not.toContain(ESC)
  })

  it('names the first dotted flag when several are given', async () => {
    const result = await run(config(vi.fn()), ['--a.b', '--c.d'])
    expect(result.stderr).toContain('`--a.b`')
    expect(result.stderr).not.toContain('`--c.d`')
  })

  it.each([
    [['--limit', '-1.5']],
    [['--limit=-1.5']],
    [['--limit', '-12.5']],
    [['--limit', '1.5']],
    [['--limit=1.5']],
    [['--mode', 'a.b']],
    [['--mode=a.b']],
    [['--mode', 'v1.2.3', '--limit', '2']],
  ])('lets a dot in a value through: %j', async argv => {
    const seen: unknown[] = []
    const result = await run(
      {
        name: 'x',
        commands: [
          defineCommand({
            readOnly: true,
            options: {
              limit: {flag: '--limit <n>', schema: z.number().optional()},
              mode: {flag: '--mode <m>', schema: z.string().optional()},
            },
            action: context => {
              seen.push(context.options)
            },
          }),
        ],
      },
      argv,
    )
    expect(result.stderr).not.toContain('dotted')
    expect(result.exitCode).toBe(0)
    expect(seen).toHaveLength(1)
  })

  it('lets a dot in a positional through', async () => {
    const seen: unknown[] = []
    const result = await run(
      {
        name: 'x',
        commands: [
          defineCommand({
            readOnly: true,
            positionals: [{name: 'path', kind: 'optional'}],
            action: context => {
              seen.push(context.positionals.path)
            },
          }),
        ],
      },
      ['metadata/repos.yaml'],
    )
    expect(result.exitCode).toBe(0)
    expect(seen).toEqual(['metadata/repos.yaml'])
  })

  it('does not look past `--`: what follows is rejected as arguments after the terminator', async () => {
    const result = await run(config(vi.fn()), ['--', '--a.b=1'])
    expect(result.exitCode).toBe(64)
    expect(result.stderr).toContain('error: unexpected arguments after `--`\n')
    expect(result.stderr).not.toContain('dotted')
  })

  it.each([
    ['a dotted long flag', {nested: {flag: '--a.b <v>', schema: z.string().optional()}}, '--a.b'],
    ['a dotted alias', {port: {flag: '-p, --net.port <n>', schema: z.number().optional()}}, '--net.port'],
    ['a dotted short alias', {port: {flag: '-p.q, --port <n>', schema: z.number().optional()}}, '-p.q'],
    ['a dotted boolean flag', {on: {flag: '--feature.on', schema: z.boolean().optional()}}, '--feature.on'],
  ])('rejects a command that declares %s', async (_label, options, named) => {
    const command = defineCommand({readOnly: true, options, action: () => {}})
    await expect(run({name: 'x', commands: [command]}, [])).rejects.toThrow(
      new TypeError(`x: option flag \`${named}\` has a dotted name, which the runner does not accept`),
    )
  })

  it('names the command when a named command declares one', async () => {
    const command = defineCommand({
      name: 'plan',
      readOnly: true,
      options: {nested: {flag: '--a.b <v>', schema: z.string().optional()}},
      action: () => {},
    })
    await expect(run({name: 'x', noArgv: 'usage', commands: [command]}, [])).rejects.toThrow(
      new TypeError('x plan: option flag `--a.b` has a dotted name, which the runner does not accept'),
    )
  })

  it('accepts a dot in a value placeholder or description, which is not part of the name', async () => {
    const command = defineCommand({
      readOnly: true,
      options: {file: {flag: '--file <name.txt>', schema: z.string().optional().describe('a file.txt')}},
      action: () => {},
    })
    await expect(run({name: 'x', commands: [command]}, [])).resolves.toMatchObject({exitCode: 0})
  })
})

describe('option names every object already has', () => {
  // goke keeps options and aliases in plain objects. `__proto__` goes to the inherited setter and never
  // becomes an own option, so the unknown-option check cannot see it and the action would run with
  // exit 0; `constructor`, `hasOwnProperty` and the like make goke call a method of Object.prototype,
  // and a TypeError escapes `runCli`.
  const rooted = (action: () => void, options: boolean): CliConfig => ({
    name: 'x',
    usageCode: 64,
    commands: [
      defineCommand({
        readOnly: false,
        ...(options ? {options: {flag: {flag: '--flag', schema: z.boolean().optional()}}} : {}),
        action,
      }),
    ],
  })

  it.each([
    [['--__proto__'], '--__proto__'],
    [['--__proto__=attacker'], '--__proto__'],
    [['--__proto__='], '--__proto__'],
    [['--__proto__', 'attacker'], '--__proto__'],
    [['--no-__proto__'], '--no-__proto__'],
    [['--no-__proto__=attacker'], '--no-__proto__'],
    [['-__proto__'], '-__proto__'],
    [['---__proto__=attacker'], '---__proto__'],
    [['-no-__proto__'], '-no-__proto__'],
    [['--flag', '--__proto__'], '--__proto__'],
    [['--constructor'], '--constructor'],
    [['--constructor=x'], '--constructor'],
    [['--constructor', 'x'], '--constructor'],
    [['--hasOwnProperty'], '--hasOwnProperty'],
    [['--isPrototypeOf'], '--isPrototypeOf'],
    [['--__defineGetter__'], '--__defineGetter__'],
    [['--__defineSetter__'], '--__defineSetter__'],
    [['--__lookupGetter__'], '--__lookupGetter__'],
    [['--__lookupSetter__'], '--__lookupSetter__'],
    [['--propertyIsEnumerable'], '--propertyIsEnumerable'],
    [['--toLocaleString'], '--toLocaleString'],
    [['--toString'], '--toString'],
    [['--toString=1'], '--toString'],
    [['--valueOf'], '--valueOf'],
    [['--no-constructor'], '--no-constructor'],
    [['--no-toString=x'], '--no-toString'],
    [['-constructor'], '-constructor'],
    [['---valueOf'], '---valueOf'],
    [['--flag', '--constructor'], '--constructor'],
  ])(
    'rejects %j as a usage error naming %s, resolving rather than rejecting, and runs nothing',
    async (argv, named) => {
      for (const options of [false, true]) {
        const action = vi.fn()
        const result = await run(rooted(action, options), argv)
        expect(result.exitCode).toBe(64)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain(`error: unsupported option name \`${named}\`\n`)
        expect(result.stderr).toContain('Usage:')
        expect(result.stderr).not.toContain('attacker')
        expect(action).not.toHaveBeenCalled()
      }
    },
  )

  it('writes the usage error to the usage stream of the CLI', async () => {
    const result = await run({...usageShape([]), usageStream: 'stdout', usageCode: 3}, ['--__proto__=1'])
    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toBe('error: unsupported option name `--__proto__`\n')
  })

  it('strips ANSI from the name it reports', async () => {
    const result = await run(rooted(vi.fn(), false), [`--__proto__=${ESC}[31mred${ESC}[0m`])
    expect(result.stderr).toContain('error: unsupported option name `--__proto__`\n')
    expect(result.stderr).not.toContain(ESC)
  })

  it('reports a dotted name as dotted even when it is built on __proto__', async () => {
    const result = await run(rooted(vi.fn(), false), ['--__proto__.x=1'])
    expect(result.stderr).toContain('error: unsupported dotted option name `--__proto__.x`\n')
  })

  it.each([
    [['--__Proto__'], '--__Proto__'],
    [['--__proto-_'], '--__proto-_'],
    [['--_-proto__'], '--_-proto__'],
    [['--proto__'], '--proto__'],
    [['--__proto'], '--__proto'],
    [['--my__proto__'], '--my__proto__'],
    [['--a-__proto__'], '--a-__proto__'],
    [['--no-a-__proto__'], '--noA-__proto__'],
    [['--no-no-__proto__'], '--noNo-__proto__'],
    [['--__proto__x'], '--__proto__x'],
    [['--prototype'], '--prototype'],
    [['--prototype=x'], '--prototype'],
    [['--Constructor'], '--Constructor'],
    [['--to-string'], '--toString'],
    [['--has-own-property'], '--hasOwnProperty'],
    [['--constructors'], '--constructors'],
    [['--no-a-constructor'], '--noA-constructor'],
  ])('leaves %j to goke, which rejects it as an unknown option', async (argv, named) => {
    const action = vi.fn()
    const result = await run(rooted(action, false), argv)
    expect(result.exitCode).toBe(64)
    expect(result.stderr).toContain(`error: Unknown option \`${named}\`\n`)
    expect(result.stderr).not.toContain('unsupported')
    expect(action).not.toHaveBeenCalled()
  })

  it('only looks at option names: __proto__ as a value or a positional is not rejected', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          positionals: [{name: 'path', kind: 'optional'}],
          options: {mode: {flag: '--mode <m>', schema: z.string().optional()}},
          action: context => {
            seen.push([context.positionals.path, context.options.mode])
          },
        }),
      ],
    }
    expect((await run(config, ['__proto__', '--mode', '__proto__'])).exitCode).toBe(0)
    expect((await run(config, ['--mode=__proto__'])).exitCode).toBe(0)
    expect(seen).toEqual([
      ['__proto__', '__proto__'],
      [undefined, '__proto__'],
    ])
  })

  it('does not look past `--`: what follows is rejected as arguments after the terminator', async () => {
    const result = await run(rooted(vi.fn(), false), ['--', '--__proto__'])
    expect(result.stderr).toContain('error: unexpected arguments after `--`\n')
    expect(result.stderr).not.toContain('unsupported')
  })
})

describe('declared option names every object already has', () => {
  const declare = (flag: string, name = 'option'): Command =>
    defineCommand({readOnly: true, options: {[name]: {flag, schema: z.string().optional()}}, action: () => {}})

  it.each([
    ['--constructor <v>', '--constructor'],
    ['--__proto__ <v>', '--__proto__'],
    ['--toString', '--toString'],
    ['-t, --valueOf <v>', '--valueOf'],
    ['-c, --hasOwnProperty', '--hasOwnProperty'],
    ['--no-constructor', '--no-constructor'],
    ['-constructor', '-constructor'],
  ])('rejects a command that declares %s', async (flag, named) => {
    await expect(run({name: 'x', commands: [declare(flag)]}, [])).rejects.toThrow(
      new TypeError(`x: option flag \`${named}\` names a property every object has, which the runner does not accept`),
    )
  })

  it('names the command when a named command declares one', async () => {
    const command = defineCommand({
      name: 'plan',
      readOnly: true,
      options: {bad: {flag: '--constructor <v>', schema: z.string().optional()}},
      action: () => {},
    })
    await expect(run({name: 'x', noArgv: 'usage', commands: [command]}, [])).rejects.toThrow(
      new TypeError(
        'x plan: option flag `--constructor` names a property every object has, which the runner does not accept',
      ),
    )
  })

  it.each([
    ['--proto__ <v>'],
    ['--constructors <v>'],
    ['--my-constructor <v>'],
    ['--prototype <v>'],
    ['--to-string <v>'],
    ['--Constructor <v>'],
    ['-p, --port <constructor>'],
    ['--file <toString>'],
  ])('accepts a command that declares %s', async flag => {
    await expect(run({name: 'x', commands: [declare(flag)]}, [])).resolves.toMatchObject({exitCode: 0})
  })

  it('reports a dotted declaration as dotted even when it names a property every object has', async () => {
    await expect(run({name: 'x', commands: [declare('--constructor.x <v>')]}, [])).rejects.toThrow(
      new TypeError('x: option flag `--constructor.x` has a dotted name, which the runner does not accept'),
    )
  })
})

describe('positional declarations', () => {
  const define = (positionals: Parameters<typeof defineCommand>[0]['positionals']): Command =>
    defineCommand({readOnly: true, positionals, action: () => {}})
  const config = (command: Command): CliConfig => ({name: 'x', commands: [command]})

  it('rejects an optional positional before a required one', async () => {
    const command = define([
      {name: 'scope', kind: 'optional'},
      {name: 'confirmation', kind: 'required'},
    ])
    await expect(run(config(command), [])).rejects.toThrow(
      new TypeError('x: required positional `confirmation` cannot follow optional positional `scope`'),
    )
  })

  it('rejects a variadic positional that is not last', async () => {
    const command = define([
      {name: 'files', kind: 'variadic'},
      {name: 'target', kind: 'required'},
    ])
    await expect(run(config(command), [])).rejects.toThrow(
      new TypeError('x: variadic positional `files` must be the last positional'),
    )
  })

  it('rejects a variadic positional before an optional one', async () => {
    const command = define([
      {name: 'files', kind: 'variadic'},
      {name: 'extra', kind: 'optional'},
    ])
    await expect(run(config(command), [])).rejects.toThrow(
      new TypeError('x: variadic positional `files` must be the last positional'),
    )
  })

  it('rejects a bad layout on a named command too, and says which command', async () => {
    const command = defineCommand({
      name: 'plan',
      readOnly: true,
      positionals: [
        {name: 'a', kind: 'optional'},
        {name: 'b', kind: 'required'},
      ],
      action: () => {},
    })
    await expect(run({name: 'x', noArgv: 'usage', commands: [command]}, [])).rejects.toThrow(
      new TypeError('x plan: required positional `b` cannot follow optional positional `a`'),
    )
  })

  it.each([
    ['none', []],
    [
      'required then optional',
      [
        {name: 'a', kind: 'required'},
        {name: 'b', kind: 'optional'},
      ],
    ],
    [
      'required then required',
      [
        {name: 'a', kind: 'required'},
        {name: 'b', kind: 'required'},
      ],
    ],
    [
      'optional then optional',
      [
        {name: 'a', kind: 'optional'},
        {name: 'b', kind: 'optional'},
      ],
    ],
    [
      'required then variadic',
      [
        {name: 'a', kind: 'required'},
        {name: 'rest', kind: 'variadic'},
      ],
    ],
    [
      'optional then variadic',
      [
        {name: 'a', kind: 'optional'},
        {name: 'rest', kind: 'variadic'},
      ],
    ],
    ['variadic alone', [{name: 'rest', kind: 'variadic'}]],
  ] as const)('accepts %s', async (_label, positionals) => {
    const command = define([...positionals])
    await expect(run(config(command), [])).resolves.toBeDefined()
  })

  it('a required positional that goke let through reaches no action: the runner checks its own mapping', async () => {
    const real = await import('goke')
    const action = vi.fn()
    const command = defineCommand({
      readOnly: true,
      positionals: [
        {name: 'scope', kind: 'required'},
        {name: 'confirmation', kind: 'required'},
      ],
      action,
    })
    // goke's own required-argument check passes; only the runner's mapping can catch the gap.
    const importGoke = async () => {
      class LenientGoke extends real.Goke {}
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const original = real.Goke.prototype.command
      LenientGoke.prototype.command = function command(
        this: InstanceType<typeof real.Goke>,
        ...args: Parameters<typeof original>
      ) {
        const registered = original.apply(this, args) as InstanceType<typeof real.Command>
        registered.checkRequiredArgs = () => {}
        return registered
      } as typeof original
      return {...real, Goke: LenientGoke} as unknown as typeof real
    }
    const result = await runCli(config(command), {argv: ['repo'], importGoke})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error: missing required argument `<confirmation>`\n')
    expect(action).not.toHaveBeenCalled()
  })
})

function captureValue(schema: z.ZodType): {config: CliConfig; seen: unknown[]} {
  const seen: unknown[] = []
  const config: CliConfig = {
    name: 'x',
    commands: [
      defineCommand({
        readOnly: true,
        options: {value: {flag: '--value <v>', schema}},
        action: context => {
          seen.push(context.options.value)
        },
      }),
    ],
  }
  return {config, seen}
}

describe('zod defaults', () => {
  it('an omitted string default that trims keeps exactly what schema.parse(undefined) gives', async () => {
    const schema = z.string().trim().default('  keep spaces  ')
    const {config, seen} = captureValue(schema)
    expect((await run(config, [])).exitCode).toBe(0)
    expect(seen).toEqual([schema.parse(undefined)])
    expect(seen).toEqual(['  keep spaces  '])
  })

  it('an omitted default that its own refinement would reject is not a usage error', async () => {
    const schema = z.number().min(10).default(1)
    const {config, seen} = captureValue(schema)
    const result = await run(config, [])
    expect(result.exitCode).toBe(0)
    expect(seen).toEqual([schema.parse(undefined)])
    expect(seen).toEqual([1])
  })

  it('an omitted transformed default is transformed once', async () => {
    const schema = z
      .string()
      .default('abc')
      .transform(value => `${value}!`)
    const {config, seen} = captureValue(schema)
    await run(config, [])
    expect(seen).toEqual([schema.parse(undefined)])
    expect(seen).toEqual(['abc!'])
  })

  it('an explicit value still goes through the full schema', async () => {
    const schema = z.string().trim().default('  keep spaces  ')
    const {config, seen} = captureValue(schema)
    await run(config, ['--value', '  explicit  '])
    expect(seen).toEqual(['explicit'])
    const bounded = captureValue(z.number().min(10).default(1))
    expect((await run(bounded.config, ['--value', '5'])).exitCode).toBe(1)
    expect(bounded.seen).toEqual([])
    expect((await run(bounded.config, ['--value', '12'])).exitCode).toBe(0)
    expect(bounded.seen).toEqual([12])
  })

  it('help still shows the default', async () => {
    const {config} = captureValue(z.string().trim().default('shown'))
    const result = await run(config, ['--help'])
    expect(result.stderr).toContain('(default: shown)')
  })

  it('an enum default is applied once and reaches the action', async () => {
    const seen: unknown[] = []
    const config: CliConfig = {
      name: 'x',
      commands: [
        defineCommand({
          readOnly: true,
          options: {mode: {flag: '--mode <m>', schema: z.enum(['a', 'b']).default('a')}},
          action: context => {
            seen.push(context.options.mode)
          },
        }),
      ],
    }
    await run(config, [])
    expect(seen).toEqual(['a'])
  })
})

describe('usageText', () => {
  const TEXT = 'Usage: tool --private <spec>\n\nA hand-written usage text.\n'
  const withText = (extra: Partial<CliConfig> = {}): CliConfig => ({
    name: 'x',
    usageText: TEXT,
    commands: [defineCommand({readOnly: true, action: () => {}})],
    ...extra,
  })

  it('is what --help prints, in place of goke help, on the usage stream with the help code', async () => {
    const result = await run(withText({usageStream: 'stdout', helpCode: 0}), ['--help'])
    expect(result).toEqual({exitCode: 0, stdout: TEXT, stderr: ''})
  })

  it('is what a CLI whose no-argv mode is usage prints', async () => {
    const result = await run(withText({noArgv: 'usage', usageStream: 'stdout'}), [])
    expect(result).toEqual({exitCode: 1, stdout: TEXT, stderr: ''})
  })

  it('follows the error line on a usage error, and goke help is not printed', async () => {
    const result = await run(withText({usageCode: 64}), ['--bogus'])
    expect(result.exitCode).toBe(64)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`error: Unknown option \`--bogus\`\n${TEXT}`)
    expect(result.stderr).not.toContain('Display this message')
  })

  it('goes to stdout for a usage error when the CLI prints usage there', async () => {
    const result = await run(withText({usageStream: 'stdout'}), ['--bogus'])
    expect(result.stdout).toBe(TEXT)
    expect(result.stderr).toBe('error: Unknown option `--bogus`\n')
  })

  it('does not change what a run prints', async () => {
    const config: CliConfig = {
      name: 'x',
      usageText: TEXT,
      commands: [
        defineCommand({
          readOnly: true,
          action: context => {
            context.stdout('ran\n')
          },
        }),
      ],
    }
    expect(await run(config, [])).toEqual({exitCode: 0, stdout: 'ran\n', stderr: ''})
  })
})

describe('onUsage', () => {
  const hooked = (
    onUsage: (env: Readonly<Record<string, string | undefined>>) => void,
    extra: Partial<CliConfig> = {},
  ) =>
    ({
      name: 'x',
      onUsage,
      commands: [defineCommand({readOnly: true, action: () => {}})],
      ...extra,
    }) satisfies CliConfig

  it.each([
    ['unmatched argv', ['stray']],
    ['an unknown flag', ['--bogus']],
    ['--help', ['--help']],
    ['a bare --', ['--']],
    ['a dotted flag', ['--a.b=1']],
    ['an inherited name', ['--constructor']],
  ])('runs once for %s, with the env of the run, before the result returns', async (_label, argv) => {
    const onUsage = vi.fn()
    const result = await runCli(hooked(onUsage), {argv, env: {TOKEN: 'abc'}})
    expect(result.exitCode).toBe(1)
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({TOKEN: 'abc'})
  })

  it('runs for a no-argv usage CLI and for a zod refinement failure', async () => {
    const onUsage = vi.fn()
    await runCli(hooked(onUsage, {noArgv: 'usage'}), {argv: [], env: {}})
    expect(onUsage).toHaveBeenCalledTimes(1)

    const refined = vi.fn()
    const config: CliConfig = {
      name: 'x',
      onUsage: refined,
      commands: [
        defineCommand({
          readOnly: true,
          options: {limit: {flag: '--limit <n>', schema: z.number().min(1).optional()}},
          action: () => {},
        }),
      ],
    }
    await runCli(config, {argv: ['--limit', '0'], env: {}})
    expect(refined).toHaveBeenCalledTimes(1)
  })

  it('defaults to the process environment', async () => {
    const onUsage = vi.fn()
    vi.stubEnv('ONUSAGE_PROBE', 'present')
    await runCli(hooked(onUsage), {argv: ['stray']})
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(onUsage.mock.calls[0]?.[0]).toMatchObject({ONUSAGE_PROBE: 'present'})
    vi.unstubAllEnvs()
  })

  it('does not run when the action runs, or when it throws or returns a code', async () => {
    const onUsage = vi.fn()
    const make = (action: () => unknown): CliConfig => ({
      name: 'x',
      onUsage,
      commands: [defineCommand({readOnly: true, action})],
    })
    await run(
      make(() => {}),
      [],
    )
    await run(
      make(() => {
        throw new Error('x')
      }),
      [],
    )
    await run(
      make(() => 3),
      [],
    )
    expect(onUsage).not.toHaveBeenCalled()
  })

  it('is absent by default: a usage error without it still returns', async () => {
    const result = await run({name: 'x', commands: [defineCommand({readOnly: true, action: () => {}})]}, ['stray'])
    expect(result.exitCode).toBe(1)
  })
})

describe('help spelled with a value', () => {
  // goke parses `--help false` and `--help=false` as `help: false`, so the root action used to run
  // for what is, by any reading, an attempt to ask for help. Any use of the help flag is a help
  // request: the action never runs and the output is the help `--help` prints.
  const helpSpellings = [
    ['--help=false'],
    ['--help', 'false'],
    ['--help=true'],
    ['--help='],
    ['-h=false'],
    ['-h', 'false'],
    ['-h=true'],
    ['-h='],
    ['--mode', 'x', '--help=false'],
    ['--help=false', '--mode', 'x'],
    ['--help', 'false', '--mode', 'x'],
  ]

  // goke reads the value of these as a positional, so its help names a different usage line than a
  // plain --help does. They already stop; they are held to the same help code and stream.
  const positionalLeaks = [['--help', 'foo'], ['--help=0'], ['-h=0'], ['-h', 'foo']]

  const configWith = (ran: string[], extra: Partial<CliConfig> = {}): CliConfig => ({
    name: 'tool',
    usageStream: 'stdout',
    helpCode: 0,
    usageCode: 7,
    commands: [
      defineCommand({
        readOnly: true,
        options: {mode: {flag: '--mode <m>', schema: z.string().optional()}},
        action: () => {
          ran.push('root')
        },
      }),
    ],
    ...extra,
  })

  it.each(helpSpellings)('%j never runs the action and prints what a plain --help prints', async (...argv) => {
    const ran: string[] = []
    const plain = await run(configWith(ran), ['--help'])
    const result = await run(configWith(ran), argv)
    expect(ran).toEqual([])
    expect(result).toEqual(plain)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toBe('')
  })

  it.each(helpSpellings)(
    '%j follows the CLI help code and stream, on stderr with the default stream',
    async (...argv) => {
      const ran: string[] = []
      const config = configWith(ran, {usageStream: 'stderr', helpCode: 3})
      const plain = await run(config, ['--help'])
      const result = await run(config, argv)
      expect(ran).toEqual([])
      expect(result).toEqual(plain)
      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
    },
  )

  it.each(helpSpellings)('%j still runs onUsage and honours usageText', async (...argv) => {
    const seen: unknown[] = []
    const ran: string[] = []
    const config = configWith(ran, {onUsage: env => seen.push(env), usageText: 'custom usage\n'})
    const result = await runCli(config, {argv, env: {X: '1'}})
    expect(ran).toEqual([])
    expect(seen).toEqual([{X: '1'}])
    expect(result).toEqual({exitCode: 0, stdout: 'custom usage\n', stderr: ''})
  })

  it.each(positionalLeaks)(
    '%j stops at help with the help code and stream even though goke names its usage differently',
    async (...argv) => {
      const ran: string[] = []
      const result = await run(configWith(ran), argv)
      expect(ran).toEqual([])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('Usage:')
    },
  )

  it('treats a help value the same on a no-argv usage CLI', async () => {
    const ran: unknown[] = []
    const plain = await run(usageShape(ran), ['--help'])
    const result = await run(usageShape(ran), ['--help=false'])
    expect(ran).toEqual([])
    expect(result).toEqual(plain)
    expect(result.exitCode).toBe(0)
  })

  it('prints the help of a named command for a valued help flag, as a plain --help does', async () => {
    const ran: string[] = []
    const plain = await run(dispatchShape(ran), ['plan', '--help'])
    const result = await run(dispatchShape(ran), ['plan', '--help=false'])
    expect(ran).toEqual([])
    expect(result).toEqual(plain)
  })

  it('leaves a plain --help and -h exactly as they were', async () => {
    const ran: string[] = []
    const long = await run(configWith(ran), ['--help'])
    const short = await run(configWith(ran), ['-h'])
    expect(short).toEqual(long)
    expect(long.stdout).toBe(
      [
        'tool',
        '',
        'Usage:',
        '  $ tool [options]',
        '',
        'Commands:',
        '  tool',
        '',
        'Options:',
        '  --mode <m>',
        '  -h, --help  Display this message',
        '',
      ].join('\n'),
    )
  })

  it.each([['--no-help'], ['--no-h'], ['-no-help']])('%j is a usage error and runs nothing', async argv => {
    const ran: string[] = []
    const result = await run(configWith(ran), [argv])
    expect(ran).toEqual([])
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toMatch(/^error: unsupported option name `-+no-h(elp)?`\n/u)
    expect(result.stdout).toContain('Usage:')
  })

  it('does not treat the value of another option, or anything after --, as a help flag', async () => {
    const ran: string[] = []
    const ok = await run(configWith(ran), ['--mode=--help'])
    expect(ran).toEqual(['root'])
    expect(ok.exitCode).toBe(0)
    const afterDashes = await run(configWith(ran), ['--', '--help=false'])
    expect(afterDashes.exitCode).toBe(7)
    expect(ran).toEqual(['root'])
  })

  it("a help flag that is another option's missing value is the existing needs-a-value error", async () => {
    const ran: string[] = []
    const result = await run(configWith(ran), ['--mode', '--help'])
    expect(ran).toEqual([])
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toContain('option `--mode <m>` needs a value')
  })

  it.each([['-hx'], ['-xh'], ['-hh'], ['-hmode']])('the cluster %s cannot reach the action', async cluster => {
    const ran: string[] = []
    const config: CliConfig = {
      name: 'tool',
      commands: [
        defineCommand({
          readOnly: true,
          options: {x: {flag: '-x', schema: z.boolean().optional()}},
          action: () => {
            ran.push('root')
          },
        }),
      ],
    }
    const result = await run(config, [cluster])
    expect(ran).toEqual([])
    expect(result.exitCode).not.toBe(-1)
  })

  it('is not fooled by names that only contain help', async () => {
    const ran: string[] = []
    const config: CliConfig = {
      name: 'tool',
      commands: [
        defineCommand({
          readOnly: true,
          options: {helper: {flag: '--helper <v>', schema: z.string().optional()}},
          action: context => {
            ran.push(`helper=${context.options.helper ?? ''}`)
          },
        }),
      ],
    }
    const result = await run(config, ['--helper=false'])
    expect(ran).toEqual(['helper=false'])
    expect(result.exitCode).toBe(0)
  })
})
