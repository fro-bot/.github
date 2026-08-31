import {join} from 'node:path'
import process from 'node:process'

import {
  CORRECTIONS_PATH,
  CorrectionStoreError,
  parseCorrections,
  serializeCorrections,
  type CorrectionsFile,
} from '@fro-bot/wiki-write-core/corrections'
import {describe, expect, it} from 'vitest'
import {buildHelp, CorrectionLifecycleCliError, findRepositoryRoot, main, toFailure} from './correction-lifecycle.ts'

const attribution = {actor: 'marcusrbrown', recorded_at: '2026-08-30T12:00:00.000Z'}

const activeFile: CorrectionsFile = {
  version: 1,
  corrections: [
    {
      id: 'active',
      page_node_id: 'R_123',
      span: {text: 'The active fact.'},
      attribution,
      state: 'active',
    },
  ],
}

const activeCorrection = activeFile.corrections[0]
if (activeCorrection === undefined) throw new Error('expected active correction fixture')

const untouchedCorrection = {
  id: 'untouched',
  page_node_id: 'R_999',
  span: {text: 'An untouched fact.'},
  attribution,
  state: 'active' as const,
}

function dependencies(file: CorrectionsFile, actor: string | undefined = 'marcusrbrown') {
  let writtenPath = ''
  let writtenContent = ''
  const stdoutLines: string[] = []
  const stderrLines: string[] = []
  const env: Record<string, string | undefined> = {GITHUB_ACTOR: actor}
  let cwd: string | undefined = process.cwd()
  let repositoryRoot: string | undefined = process.cwd()
  return {
    env,
    now: () => new Date('2026-08-30T12:00:00.000Z'),
    readFile: async () => serializeCorrections(file),
    writeFile: async (path: string, content: string) => {
      writtenPath = path
      writtenContent = content
    },
    stdout: (value: string) => stdoutLines.push(value),
    stderr: (value: string) => stderrLines.push(value),
    get cwd() {
      return cwd
    },
    set cwd(value: string | undefined) {
      cwd = value
    },
    get repositoryRoot() {
      return repositoryRoot
    },
    set repositoryRoot(value: string | undefined) {
      repositoryRoot = value
    },
    get writtenPath() {
      return writtenPath
    },
    get writtenContent() {
      return writtenContent
    },
    stdoutLines,
    stderrLines,
  }
}

describe('correction-lifecycle CLI', () => {
  it.each([['--help'], ['help']])('prints machine-readable help for %s', async arg => {
    const deps = dependencies({version: 1, corrections: [activeCorrection]})

    const exitCode = await main([arg], deps)
    const output = JSON.parse(deps.stdoutLines[0] ?? '') as {
      ok: boolean
      commands: Record<string, unknown>
      failure_codes: string[]
    }

    expect(exitCode).toBe(0)
    expect(output.ok).toBe(true)
    expect(Object.keys(output.commands)).toEqual(['record', 'retire', 'reconfirm', 'supersede'])
    expect(output.failure_codes).toEqual(
      expect.arrayContaining([
        'INVALID_ARGUMENT',
        'MISSING_ACTOR',
        'INVALID_CORRECTIONS',
        'CORRECTION_NOT_FOUND',
        'INVALID_TRANSITION',
        'READ_FAILED',
        'WRITE_FAILED',
        'IO_FAILURE',
        'RUNTIME_FAILURE',
      ]),
    )
    expect(deps.writtenPath).toBe('')
  })

  it.each(['record', 'retire', 'reconfirm', 'supersede'])('prints per-command help for %s --help', async command => {
    const deps = dependencies({version: 1, corrections: [activeCorrection]})

    const exitCode = await main([command, '--help'], deps)
    const output = JSON.parse(deps.stdoutLines[0] ?? '') as {
      ok: boolean
      command: string
      required: string[]
      optional: string[]
    }

    expect(exitCode).toBe(0)
    expect(output).toMatchObject({ok: true, command})
    expect(output.required.length).toBeGreaterThan(0)
    expect(output.optional).toBeInstanceOf(Array)
  })

  it('does not treat --help in a value position as a successful write', async () => {
    const deps = dependencies(activeFile)

    const exitCode = await main(['record', '--id', 'x', '--node-id', 'R_1', '--text', '--help'], deps)

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
  })

  it('accepts an equals-form flag-shaped span as literal text', async () => {
    const deps = dependencies(activeFile)

    const exitCode = await main(['record', '--id', 'x', '--node-id', 'R_1', '--text=--help'], deps)

    expect(exitCode).toBe(0)
    expect(parseCorrections(deps.writtenContent).corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({id: 'x', span: {text: '--help'}})]),
    )
  })

  it('keeps every toFailure discriminant in the help contract', () => {
    const help = buildHelp()
    const produced = [
      toFailure(new CorrectionLifecycleCliError('INVALID_ARGUMENT', 'bad', 'fix')),
      toFailure(new CorrectionStoreError({code: 'READ_FAILED', path: CORRECTIONS_PATH, message: 'read failed'})),
      toFailure({code: 'EACCES', message: 'permission denied'}),
      toFailure(new Error('unexpected')),
    ]

    for (const failure of produced) expect(help.failure_codes).toContain(failure.error.code)
  })

  it('keeps failure descriptions keyed exactly by failure code', () => {
    const help = buildHelp()

    expect(new Set(Object.keys(help.failure_code_descriptions))).toEqual(new Set(help.failure_codes))
  })

  it.each([
    ['record', ['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A new fact.']],
    ['retire', ['retire', '--id', 'active']],
    ['reconfirm', ['reconfirm', '--id', 'reconfirm']],
  ])('supports %s with JSON output', async (_command, args) => {
    const file: CorrectionsFile =
      args[0] === 'reconfirm'
        ? {
            version: 1,
            corrections: [
              {
                id: 'reconfirm',
                page_node_id: 'R_123',
                span: {text: 'The active fact.'},
                attribution,
                state: 'needs-reconfirmation',
                reason: 'Review',
              },
              untouchedCorrection,
            ],
          }
        : {...activeFile, corrections: [...activeFile.corrections, untouchedCorrection]}
    const deps = dependencies(file)

    const exitCode = await main(args, deps)

    expect(exitCode).toBe(0)
    expect(deps.stderrLines).toEqual([])
    expect(deps.writtenPath).toBe(CORRECTIONS_PATH)
    expect(JSON.parse(deps.stdoutLines[0] ?? '')).toMatchObject({ok: true, command: args[0], path: CORRECTIONS_PATH})
    const written = parseCorrections(deps.writtenContent)
    expect(written.corrections.find(correction => correction.id === untouchedCorrection.id)).toEqual(
      untouchedCorrection,
    )
  })

  it('supports supersede through the package record operation', async () => {
    const deps = dependencies({...activeFile, corrections: [...activeFile.corrections, untouchedCorrection]})

    const exitCode = await main(
      [
        'supersede',
        '--id',
        'replacement',
        '--supersedes-id',
        'active',
        '--node-id',
        'R_123',
        '--text',
        'The new fact.',
      ],
      deps,
    )

    expect(exitCode).toBe(0)
    expect(JSON.parse(deps.stdoutLines[0] ?? '')).toMatchObject({ok: true, command: 'supersede'})
    expect(deps.writtenPath).toBe(CORRECTIONS_PATH)
    const written = parseCorrections(deps.writtenContent)
    expect(written.corrections.find(correction => correction.id === untouchedCorrection.id)).toEqual(
      untouchedCorrection,
    )
  })

  it('derives attribution from GITHUB_ACTOR and rejects argv spoofing', async () => {
    const deps = dependencies(activeFile, 'server-actor')

    const exitCode = await main(
      ['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A new fact.', '--actor', 'attacker'],
      deps,
    )

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
  })

  it('accepts spaced and multiline text values', async () => {
    const deps = dependencies(activeFile)
    const text = 'legacy flag is gone\nwith multiple words'

    const exitCode = await main(['record', '--id', 'new', '--node-id', 'R_456', '--text', text], deps)

    expect(exitCode).toBe(0)
    expect(parseCorrections(deps.writtenContent).corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({id: 'new', span: {text}})]),
    )
  })

  it('stores valid decimal start and end offsets for record and supersede', async () => {
    const recordDeps = dependencies(activeFile)
    const recordExitCode = await main(
      ['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A new fact.', '--start', '12', '--end', '34'],
      recordDeps,
    )

    expect(recordExitCode).toBe(0)
    expect(parseCorrections(recordDeps.writtenContent).corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({id: 'new', span: {text: 'A new fact.', start: 12, end: 34}})]),
    )

    const supersedeDeps = dependencies(activeFile)
    const supersedeExitCode = await main(
      [
        'supersede',
        '--id',
        'replacement',
        '--supersedes-id',
        'active',
        '--node-id',
        'R_123',
        '--text',
        'The new fact.',
        '--start=5',
        '--end=21',
      ],
      supersedeDeps,
    )

    expect(supersedeExitCode).toBe(0)
    expect(parseCorrections(supersedeDeps.writtenContent).corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: 'replacement', span: {text: 'The new fact.', start: 5, end: 21}}),
      ]),
    )
  })

  it.each(['-1', '1.5', '1e3', '0x10', ''])('rejects non-decimal --start values: %s', async value => {
    const deps = dependencies(activeFile)

    const exitCode = await main(
      ['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A fact.', '--start', value],
      deps,
    )

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
  })

  it('rejects non-decimal --end values', async () => {
    const deps = dependencies(activeFile)

    const exitCode = await main(
      ['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A fact.', '--end', '1.5'],
      deps,
    )

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
  })

  it('relays end-before-start span validation as a structured corrections failure', async () => {
    const deps = dependencies(activeFile)

    const exitCode = await main(
      ['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A fact.', '--start', '34', '--end', '12'],
      deps,
    )

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({
      ok: false,
      error: {code: 'INVALID_CORRECTIONS', path: 'input.span'},
    })
  })

  it('rejects lifecycle writes outside the repository root', async () => {
    const deps = dependencies(activeFile)
    deps.cwd = '/tmp'

    const exitCode = await main(['retire', '--id', 'active'], deps)

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_CONTEXT'}})
  })

  it('discovers the repository root from a workspace member and rejects that cwd', async () => {
    const deps = dependencies(activeFile)
    deps.repositoryRoot = undefined
    deps.cwd = join(process.cwd(), 'packages/wiki-write-core')

    const exitCode = await main(['retire', '--id', 'active'], deps)

    expect(findRepositoryRoot(deps.cwd)).toBe(process.cwd())
    expect(exitCode).toBe(1)
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_CONTEXT'}})
  })

  it('allows lifecycle writes from the discovered repository root', async () => {
    const deps = dependencies(activeFile)
    deps.repositoryRoot = undefined
    deps.cwd = process.cwd()

    const exitCode = await main(['retire', '--id', 'active'], deps)

    expect(findRepositoryRoot(deps.cwd)).toBe(process.cwd())
    expect(exitCode).toBe(0)
  })

  it('does not mistake an unrelated package.json for the repository root', () => {
    expect(findRepositoryRoot(join(process.cwd(), 'packages/wiki-write-core'))).toBe(process.cwd())
    expect(findRepositoryRoot('/tmp')).toBeUndefined()
  })

  it('fails when server-derived attribution is unavailable', async () => {
    const deps = dependencies(activeFile)
    deps.env.GITHUB_ACTOR = undefined

    const exitCode = await main(['record', '--id', 'new', '--node-id', 'R_456', '--text', 'A new fact.'], deps)

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'MISSING_ACTOR'}})
  })

  it('reports typed store failures with their stable JSON error shape', async () => {
    const deps = dependencies(activeFile)
    deps.readFile = async () => {
      throw new CorrectionStoreError({
        code: 'READ_FAILED',
        path: CORRECTIONS_PATH,
        message: 'corrections: unable to read knowledge/corrections.yaml',
      })
    }

    const exitCode = await main(['retire', '--id', 'active'], deps)

    expect(exitCode).toBe(1)
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toEqual({
      ok: false,
      error: {
        code: 'READ_FAILED',
        message: 'corrections: unable to read knowledge/corrections.yaml',
        remediation: 'Fix the corrections store or lifecycle transition and retry.',
        path: CORRECTIONS_PATH,
      },
    })
  })

  it.each([
    [
      'retired correction',
      {
        id: 'retired',
        page_node_id: 'R_123',
        span: {text: 'The active fact.'},
        attribution,
        state: 'retired' as const,
      },
    ],
    ['active correction', activeCorrection],
  ])('rejects invalid %s transitions with structured errors', async (label, correction) => {
    const deps = dependencies({version: 1, corrections: [correction]})
    const args =
      label === 'retired correction'
        ? [
            'supersede',
            '--id',
            'replacement',
            '--supersedes-id',
            correction.id,
            '--node-id',
            'R_123',
            '--text',
            'Replacement.',
          ]
        : ['reconfirm', '--id', correction.id]

    const exitCode = await main(args, deps)

    expect(exitCode).toBe(1)
    expect(deps.writtenContent).toBe('')
    expect(JSON.parse(deps.stderrLines[0] ?? '')).toMatchObject({ok: false, error: {code: 'INVALID_TRANSITION'}})
  })

  it('rejects repeated reconfirm and retire transitions', async () => {
    let currentFile: CorrectionsFile = {
      version: 1,
      corrections: [
        {
          id: 'reconfirm',
          page_node_id: 'R_123',
          span: {text: 'A fact.'},
          attribution,
          state: 'needs-reconfirmation',
          reason: 'Review',
        },
        {
          id: 'retire',
          page_node_id: 'R_123',
          span: {text: 'Another fact.'},
          attribution,
          state: 'active',
        },
      ],
    }
    const deps = dependencies(currentFile)
    deps.readFile = async () => serializeCorrections(currentFile)
    deps.writeFile = async (path: string, content: string) => {
      currentFile = parseCorrections(content)
      expect(path).toBe(CORRECTIONS_PATH)
    }

    expect(await main(['reconfirm', '--id', 'reconfirm'], deps)).toBe(0)
    expect(await main(['reconfirm', '--id', 'reconfirm'], deps)).toBe(1)
    expect(await main(['retire', '--id', 'retire'], deps)).toBe(0)
    expect(await main(['retire', '--id', 'retire'], deps)).toBe(1)
    expect(deps.stderrLines.filter(line => line.includes('INVALID_TRANSITION'))).toHaveLength(2)
  })
})
