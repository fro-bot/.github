import {CORRECTIONS_PATH, serializeCorrections, type CorrectionsFile} from '@fro-bot/wiki-write-core/corrections'
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
            ],
          }
        : activeFile
    const deps = dependencies(file)

    const exitCode = await main(args, deps)

    expect(exitCode).toBe(0)
    expect(deps.stderrLines).toEqual([])
    expect(deps.writtenPath).toBe(CORRECTIONS_PATH)
    expect(JSON.parse(deps.stdoutLines[0] ?? '')).toMatchObject({ok: true, command: args[0], path: CORRECTIONS_PATH})
  })

  it('supports supersede through the package record operation', async () => {
    const deps = dependencies(activeFile)

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
})
