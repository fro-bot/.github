import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {checkSolutionsExamplesCli, main} from './check-solutions-examples-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-solutions-examples-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

function checkout(name: string, files: Readonly<Record<string, string>>): string {
  const directory = join(root, name)
  mkdirSync(directory, {recursive: true})
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), text)
  }
  return directory
}

const LIB = 'export function add(a: number, b: number): number {\n  return a + b\n}\n'
const DOC = (body: string): string => `# Doc\n\n${body}\n`
const GOOD = {
  'docs/solutions/x/doc.md': DOC('<!-- verify: add from src/lib.ts -->\n```ts\nconst total = add(1, 2)\n```'),
  'src/lib.ts': LIB,
}

async function run(directory: string, argv: readonly string[] = []) {
  vi.spyOn(process, 'cwd').mockReturnValue(directory)
  return runCli(checkSolutionsExamplesCli(), {argv, env: {}})
}

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = checkSolutionsExamplesCli()
    expect(config.name).toBe('check-solutions-examples')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(checkSolutionsExamplesCli()).not.toBe(checkSolutionsExamplesCli())
  })
})

describe('a run', () => {
  it('exits 0 with no output when every example parses and every verify marker holds', async () => {
    expect(await run(checkout('good', GOOD))).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('exits 0 when there is no docs/solutions directory', async () => {
    expect(await run(checkout('empty', {'README.md': 'x'}))).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('prints a parse finding as path:line -> message on stderr and exits 1', async () => {
    const result = await run(checkout('parse', {'docs/solutions/x/doc.md': DOC('```ts\nconst = ;\n```')}))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^docs\/solutions\/x\/doc\.md:4 -> .+\n$/u)
  })

  it('prints a broken verify marker, a symbol finding, as path:line -> [symbol in file] reason and exits 1', async () => {
    const result = await run(
      checkout('symbol', {
        'docs/solutions/x/doc.md': DOC('<!-- verify: add from src/lib.ts -->\n```ts\nadd(1)\n```'),
        'src/lib.ts': LIB,
      }),
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/^docs\/solutions\/x\/doc\.md:5 -> \[add in src\/lib\.ts\] .+\n$/u)
  })

  it('prints a directive finding (a typo in the verify keyword) as path:line -> reason and exits 1', async () => {
    const result = await run(
      checkout('directive', {
        'docs/solutions/x/doc.md': DOC('<!-- verifies: add from src/lib.ts -->\n```ts\nadd(1, 2)\n```'),
        'src/lib.ts': LIB,
      }),
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/^docs\/solutions\/x\/doc\.md:3 -> .+\n$/u)
  })

  it('prints directive findings before parse findings before symbol findings', async () => {
    const result = await run(
      checkout('order', {
        'docs/solutions/x/doc.md': DOC(
          [
            '```ts\nconst = ;\n```',
            '<!-- verify: add from src/lib.ts -->\n```ts\nadd(1)\n```',
            '<!-- verifies: add from src/lib.ts -->\n```ts\nadd(1, 2)\n```',
          ].join('\n\n'),
        ),
        'src/lib.ts': LIB,
      }),
    )
    const lines = result.stderr.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain(':12 -> ')
    expect(lines[1]).toContain(':4 -> ')
    expect(lines[2]).toContain('[add in src/lib.ts]')
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing checked',
    async argv => {
      const result = await run(checkout('usage', GOOD), argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(
      checkout('main', {'docs/solutions/x/doc.md': DOC('```ts\nconst = ;\n```')}),
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/check-solutions-examples.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/^docs\/solutions\/x\/doc\.md:4 -> /u)
    expect(exit).not.toHaveBeenCalled()
  })
})
