import {
  CORRECTIONS_PATH,
  CorrectionStoreError,
  parseCorrections,
  serializeCorrections,
  type CorrectionsFile,
} from '@fro-bot/wiki-write-core/corrections'
import {describe, expect, it} from 'vitest'
import {main} from './correction-lifecycle.ts'

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
