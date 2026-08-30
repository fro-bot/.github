import {describe, expect, it, vi} from 'vitest'

import {readCorrections, verifyCorrectionSurvival, type CorrectionsFile} from './corrections.ts'
import {buildWikiIngestChanges, runWikiIngestCli, WikiIngestError} from './wiki-ingest.ts'
import {buildWikiLintJsonReport, type WikiLintResult} from './wiki-lint.ts'

const activeCorrection = {
  id: 'correction-active',
  page_node_id: 'R_123',
  span: {text: 'The corrected fact.'},
  attribution: {actor: 'marcusrbrown', recorded_at: '2026-08-29T12:00:00.000Z'},
  state: 'active' as const,
}

const page = (body: string): string =>
  [
    '---',
    'type: repo',
    'title: alice/project',
    'node_id: R_123',
    'created: 2026-08-29',
    'updated: 2026-08-29',
    '---',
    '',
    body,
    '',
  ].join('\n')

const topicPage = (nodeId: string, body: string): string =>
  [
    '---',
    'type: topic',
    'title: Related topic',
    `node_id: ${nodeId}`,
    'created: 2026-08-29',
    'updated: 2026-08-29',
    '---',
    '',
    body,
    '',
  ].join('\n')

describe('correction survival verification', () => {
  it('accepts an active correction that survives in the regenerated page', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The corrected fact.')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})

    const built = buildWikiIngestChanges({
      existingFiles: {'knowledge/index.md': '# Wiki Index\n', 'knowledge/log.md': '# Wiki Log\n'},
      operation: 'manual-edit',
      target: 'repo:alice/project',
      summary: 'Regenerated page.',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      sources: [],
      targetNodeId: 'R_123',
      corrections: {version: 1, corrections: [activeCorrection]},
      pages: [{path: 'knowledge/wiki/repos/alice--project.md', content: page('The corrected fact.')}],
    })
    expect(built.findings).toEqual([])
  })

  it('reports correction-eroded with a per-correction target when the span is absent', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({
        kind: 'correction-eroded',
        path: 'knowledge/wiki/repos/alice--project.md',
        target: 'correction-active',
      }),
    ])
  })

  it('derives distinct existing fingerprints from each correction target', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
      {
        version: 1,
        corrections: [activeCorrection, {...activeCorrection, id: 'correction-other', span: {text: 'Another fact.'}}],
      },
    )
    const lintResult: WikiLintResult = {
      ok: result.ok,
      deterministicFindings: result.deterministicFindings,
      advisoryFindings: result.advisoryFindings,
      summary: '',
      report: '',
      pages: [],
    }

    const report = buildWikiLintJsonReport({
      result: lintResult,
      status: 'findings',
      scanComplete: true,
      snapshotSha: null,
      generatedAt: '2026-08-29T12:00:00.000Z',
      failureClass: null,
    })
    expect(report.findings.map(finding => finding.fingerprint)).toHaveLength(2)
    expect(new Set(report.findings.map(finding => finding.fingerprint)).size).toBe(2)
  })

  it('ignores superseded and retired corrections but surfaces reconfirmation distinctly', () => {
    const corrections: CorrectionsFile = {
      version: 1,
      corrections: [
        {...activeCorrection, id: 'superseded', state: 'superseded'},
        {...activeCorrection, id: 'retired', state: 'retired'},
        {...activeCorrection, id: 'reconfirm', state: 'needs-reconfirmation'},
      ],
    }

    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
      corrections,
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'reconfirm'}),
    ])
  })

  it('treats an absent corrections file as a clean no-op', () => {
    expect(
      verifyCorrectionSurvival({'knowledge/wiki/repos/alice--project.md': page('Any content.')}, undefined),
    ).toEqual({
      ok: true,
      deterministicFindings: [],
      advisoryFindings: [],
    })
  })

  it('blocks ingest when regenerated content erodes an active correction', () => {
    let error: unknown
    try {
      buildWikiIngestChanges({
        existingFiles: {
          'knowledge/index.md': '# Wiki Index\n',
          'knowledge/log.md': '# Wiki Log\n',
        },
        operation: 'manual-edit',
        target: 'repo:alice/project',
        summary: 'Regenerated page.',
        timestamp: new Date('2026-08-29T12:00:00.000Z'),
        sources: [],
        targetNodeId: 'R_123',
        corrections: {version: 1, corrections: [activeCorrection]},
        pages: [{path: 'knowledge/wiki/repos/alice--project.md', content: page('The old fact.')}],
      })
    } catch (error_: unknown) {
      error = error_
    }

    expect(error).toBeInstanceOf(WikiIngestError)
    if (error instanceof WikiIngestError) {
      expect(error.code).toBe('CORRECTION_ERODED')
      expect(error.findings).toEqual([
        expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
      ])
    }
  })

  it('does not reach commit when malformed corrections are read', async () => {
    const commitWikiChanges = vi.fn()

    await expect(
      runWikiIngestCli({
        readCorrections: async () =>
          readCorrections(
            async () => 'version: 1\ncorrections:\n  - id: broken\n    page_node_id: R_123\n    span: nope\n',
          ),
        commitWikiChanges,
      }),
    ).rejects.toMatchObject({name: 'CorrectionStoreError', code: 'INVALID_CORRECTIONS'})
    expect(commitWikiChanges).not.toHaveBeenCalled()
  })

  it('permits the ingest path to continue when the corrections store is absent', async () => {
    const commitWikiChanges = vi.fn()

    await runWikiIngestCli({
      readCorrections: async () => ({corrections: {version: 1, corrections: []}, warnings: []}),
      commitWikiChanges,
    })

    expect(commitWikiChanges).not.toHaveBeenCalled()
  })

  it('commits unaffected pages while refusing only the page with eroded corrections', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {'knowledge/index.md': '# Wiki Index\n', 'knowledge/log.md': '# Wiki Log\n'},
      operation: 'manual-edit',
      target: 'repo:alice/project',
      summary: 'Regenerated pages.',
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      sources: [],
      targetNodeId: 'R_123',
      corrections: {version: 1, corrections: [activeCorrection]},
      pages: [
        {path: 'knowledge/wiki/repos/alice--project.md', content: page('The old fact.')},
        {path: 'knowledge/wiki/topics/related.md', content: topicPage('R_456', 'The related topic.')},
      ],
    })

    expect(result.files['knowledge/wiki/repos/alice--project.md']).toBeUndefined()
    expect(result.files['knowledge/wiki/topics/related.md']).toContain('The related topic.')
    expect(result.findings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', path: 'knowledge/wiki/repos/alice--project.md'}),
    ])
  })

  it('fails clearly without committing when every regenerated page is blocked', () => {
    let error: unknown
    try {
      buildWikiIngestChanges({
        existingFiles: {'knowledge/index.md': '# Wiki Index\n', 'knowledge/log.md': '# Wiki Log\n'},
        operation: 'manual-edit',
        target: 'repo:alice/project',
        summary: 'Regenerated pages.',
        timestamp: new Date('2026-08-29T12:00:00.000Z'),
        sources: [],
        targetNodeId: 'R_123',
        corrections: {
          version: 1,
          corrections: [activeCorrection, {...activeCorrection, id: 'correction-related', page_node_id: 'R_456'}],
        },
        pages: [
          {path: 'knowledge/wiki/repos/alice--project.md', content: page('The old fact.')},
          {path: 'knowledge/wiki/topics/related.md', content: topicPage('R_456', 'The other old fact.')},
        ],
      })
    } catch (error_: unknown) {
      error = error_
    }

    expect(error).toBeInstanceOf(WikiIngestError)
    if (error instanceof WikiIngestError) {
      expect(error.code).toBe('CORRECTION_ERODED')
      expect(error.findings.filter(finding => finding.kind === 'correction-eroded')).toHaveLength(2)
      expect(error.message).toContain('refused')
    }
  })
})
