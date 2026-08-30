import {describe, expect, it, vi} from 'vitest'

import {verifyCorrectionSurvival} from './corrections-survival.ts'
import {readCorrections, type CorrectionsFile} from './corrections.ts'
import {buildWikiIngestChanges, runWikiIngestCli, WikiIngestError} from './wiki-ingest.ts'
import {buildWikiLintJsonReport, type WikiLintResult} from './wiki-lint.ts'

const activeCorrection = {
  id: 'correction-active',
  page_node_id: 'R_123',
  span: {text: 'The corrected fact.'},
  attribution: {actor: 'marcusrbrown', recorded_at: '2026-08-29T12:00:00.000Z'},
  state: 'active' as const,
}

const activeCorrections = (text: string): CorrectionsFile => ({
  version: 1,
  corrections: [{...activeCorrection, span: {text}}],
})

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

  it('does not mask prose after a leading inline-code span', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('`mise.toml` is minimal — only Bun 1.3.14 is pinned.')},
      {...activeCorrections('is minimal — only Bun 1.3.14 is pinned.')},
    )

    expect(result.ok).toBe(true)
  })

  it.each([
    ['a heading', '> quoted\n## Heading\nThe corrected fact.'],
    ['a list item', '> quoted\n- list item\nThe corrected fact.'],
  ])('resets blockquote state after %s', (_label, body) => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page(body)},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(true)
  })

  it('keeps correction text in a nested list item out of indented-code masking', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('- outer\n    - The corrected fact.')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(true)
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

  it('keeps a verbatim prose survival clean when the same text is also a link label', () => {
    const result = verifyCorrectionSurvival(
      {
        'knowledge/wiki/repos/alice--project.md': page(
          'The corrected fact.\n\nSee [The corrected fact.](https://example.com/source).',
        ),
      },
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
  })

  it.each([
    ['emphasis', 'The **corrected fact.**'],
    ['link', 'See [The corrected fact.](https://example.com/source).'],
    ['punctuation', 'The corrected fact!'],
  ])('classifies %s-only rewrites as needs-reconfirmation', (_label, body) => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page(body)},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
    ])
  })

  it('keeps genuine content changes as blocking erosion', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The changed fact.')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
    expect(result.advisoryFindings).toEqual([])
  })

  it.each([
    ['a fenced code block', '```\nThe corrected fact.\n```'],
    ['a blockquote', '> The corrected fact.'],
  ])('does not count a span present only inside %s as survival', (_label, body) => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page(body)},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
  })

  it('counts a prose occurrence even when the same span is also inside a code fence', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The corrected fact.\n\n```\nThe corrected fact.\n```')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
  })

  it.each([
    ['standalone indented code', 'prose\n\n    The corrected fact.'],
    ['indented content after a list item', '- outer\n\n    The corrected fact.'],
  ])('keeps %s from counting as correction survival', (_label, body) => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page(body)},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
  })

  it('handles nested link parentheses without treating the label as prose', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('[The corrected fact.](a_(b))')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
    ])
  })

  it('leaves an unclosed link bracket visible to the exact prose matcher', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('[The corrected fact.')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
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
        {...activeCorrection, id: 'superseded', state: 'superseded', superseded_by: 'replacement'},
        {...activeCorrection, id: 'retired', state: 'retired'},
        {...activeCorrection, id: 'reconfirm', state: 'needs-reconfirmation', reason: 'Upstream changed'},
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
      getChangedWikiPaths: async () => [],
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
