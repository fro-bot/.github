import {describe, expect, it, vi} from 'vitest'

import {
  CORRECTIONS_PATH,
  flagCorrectionForReconfirmation,
  getCorrectionLifecycle,
  getCorrectionsForPage,
  parseCorrections,
  readCorrections,
  reconfirmCorrection,
  recordCorrection,
  retireCorrection,
  serializeCorrections,
  writeCorrections,
  type CorrectionsFile,
} from './corrections.ts'
import {buildWikiIngestChanges} from './wiki-ingest.ts'

const emptyCorrections: CorrectionsFile = {version: 1, corrections: []}

const correctionInput = {
  id: 'correction-1',
  pageNodeId: 'R_123',
  span: {text: 'The corrected fact.', start: 0, end: 19},
  serverDerivedAttribution: {actor: 'marcusrbrown', recorded_at: '2026-08-29T12:00:00.000Z'},
}

describe('corrections sidecar', () => {
  it('records server-derived attribution and remains readable by survey tooling', async () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const raw = serializeCorrections(recorded)
    const result = await readCorrections(
      async () => raw,
      () => undefined,
    )

    expect(result.warnings).toEqual([])
    expect(getCorrectionsForPage(result.corrections, 'R_123')).toEqual([
      expect.objectContaining({
        page_node_id: 'R_123',
        attribution: correctionInput.serverDerivedAttribution,
        state: 'active',
      }),
    ])
    expect(raw).not.toContain('knowledge/wiki')
  })

  it('writes the sidecar at the guarded system-owned path', async () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    let writtenPath = ''
    let writtenContent = ''
    await writeCorrections(recorded, async (path, content) => {
      writtenPath = path
      writtenContent = content
    })

    expect(writtenPath).toBe(CORRECTIONS_PATH)
    expect(parseCorrections(writtenContent)).toEqual(recorded)
  })

  it('supports the correction lifecycle transitions', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const reconfirmation = flagCorrectionForReconfirmation(recorded, correctionInput.id)
    expect(reconfirmation.corrections[0]?.state).toBe('needs-reconfirmation')

    const active = reconfirmCorrection(reconfirmation, correctionInput.id)
    expect(active.corrections[0]?.state).toBe('active')

    const replacement = recordCorrection(active, {
      ...correctionInput,
      id: 'correction-2',
      span: {text: 'The superseding fact.'},
      supersedesId: correctionInput.id,
    })
    expect(replacement.corrections[0]).toEqual(
      expect.objectContaining({state: 'superseded', superseded_by: 'correction-2'}),
    )
    expect(retireCorrection(replacement, 'correction-2').corrections[1]?.state).toBe('retired')
  })

  it('accepts legacy records while optional rollout fields are absent', () => {
    const legacy = parseCorrections(
      `version: 1\ncorrections:\n  - id: legacy\n    page_node_id: R_123\n    span:\n      text: Legacy fact\n`,
    )

    const legacyRecord = legacy.corrections[0]
    expect(legacyRecord).toEqual({
      id: 'legacy',
      page_node_id: 'R_123',
      span: {text: 'Legacy fact'},
    })
    if (legacyRecord === undefined) throw new Error('expected legacy correction fixture')
    expect(getCorrectionLifecycle(legacyRecord)).toBe('active')
  })

  it('keeps page corrections attached to node_id across a slug migration', () => {
    const recorded = recordCorrection(emptyCorrections, correctionInput)
    const migration = buildWikiIngestChanges({
      existingFiles: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/log.md': '# Wiki Log\n',
        'knowledge/wiki/repos/alice--old.md': [
          '---',
          'type: repo',
          'title: alice/old',
          'node_id: R_123',
          'created: 2026-08-28',
          'updated: 2026-08-28',
          '---',
          '',
          'The old page.',
          '',
        ].join('\n'),
      },
      operation: 'manual-edit',
      target: 'repo:alice/new',
      summary: 'Rename repository page.',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      sources: [],
      trackedRepoNodeIds: new Map([['alice--new', 'R_123']]),
      targetNodeId: 'R_123',
      pages: [
        {
          path: 'knowledge/wiki/repos/alice--new.md',
          content: [
            '---',
            'type: repo',
            'title: alice/new',
            'created: 2026-08-29',
            'updated: 2026-08-29',
            '---',
            '',
            'The renamed page.',
            '',
          ].join('\n'),
        },
      ],
    })

    expect(migration.deletedPaths).toContain('knowledge/wiki/repos/alice--old.md')
    expect(migration.files['knowledge/wiki/repos/alice--new.md']).toContain('node_id: R_123')
    expect(getCorrectionsForPage(recorded, 'R_123')).toHaveLength(1)
    expect(getCorrectionsForPage(recorded, 'alice--old')).toEqual([])
  })

  it('fails soft on malformed reads and emits a warning', async () => {
    const warn = vi.fn()
    const result = await readCorrections(
      async () => 'version: 1\ncorrections:\n  - id: broken\n    page_node_id: R_123\n    span: nope\n',
      warn,
    )

    expect(result.corrections).toEqual(emptyCorrections)
    expect(result.warnings).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(CORRECTIONS_PATH))
  })

  it('treats an empty corrections file as a clean no-op', async () => {
    const warn = vi.fn()
    const result = await readCorrections(async () => '', warn)

    expect(result).toEqual({corrections: emptyCorrections, warnings: []})
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails hard on malformed writes', async () => {
    const malformed: unknown = {
      version: 1,
      corrections: [{id: 'broken', page_node_id: 'R_123', span: {text: ''}}],
    }

    await expect(writeCorrections(malformed, async () => undefined)).rejects.toMatchObject({
      code: 'INVALID_CORRECTIONS',
    })
  })
})
