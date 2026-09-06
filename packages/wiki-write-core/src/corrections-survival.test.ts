import {readFile} from 'node:fs/promises'

import {describe, expect, it, vi} from 'vitest'

import {normalizeCorrectionText} from './correction-text.ts'
import {maskMarkdownLinks, normalizeFormattingText, verifyCorrectionSurvival} from './corrections-survival.ts'
import {parseCorrections, readCorrections, type CorrectionsFile} from './corrections.ts'
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
  it('uses the shared storage normalizer rather than a private duplicate', async () => {
    const source = await readFile(new URL('./corrections-survival.ts', import.meta.url), 'utf8')

    // Whitespace-tolerant: instrumented copies of this file are re-emitted by a code generator.
    expect(source).toMatch(/import\s*\{\s*normalizeCorrectionText\s*\}\s*from\s*'\.\/correction-text\.ts'/u)
    expect(source).not.toMatch(/function normalizeCorrectionText\s*\(/u)
    expect(normalizeCorrectionText('  shared\nnormalizer  ')).toBe('shared normalizer')
  })

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

  it('rejects a raw corrections object that has not been schema-validated', () => {
    expect(() =>
      verifyCorrectionSurvival(
        {'knowledge/wiki/repos/alice--project.md': page('The corrected fact.')},
        // Bypasses parseCorrections/readCorrections to prove verifyCorrectionSurvival itself
        // enforces the schema via assertCorrectionsFile, not merely its callers.
        {version: 2, corrections: []} as unknown as CorrectionsFile,
      ),
    ).toThrow(/expected 1/u)
  })

  it('enforces a legacy no-state correction exactly like an active correction', () => {
    const legacy = parseCorrections(
      `version: 1\ncorrections:\n  - id: legacy\n    page_node_id: R_123\n    span:\n      text: The corrected fact.\n`,
    )

    const result = verifyCorrectionSurvival({'knowledge/wiki/repos/alice--project.md': page('The old fact.')}, legacy)

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'legacy'}),
    ])
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

  it('includes machine-readable lifecycle recovery data on correction findings', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
      {
        version: 1,
        corrections: [
          activeCorrection,
          {...activeCorrection, id: 'reconfirm', state: 'needs-reconfirmation', reason: 'Review'},
        ],
      },
    )

    expect(result.deterministicFindings[0]).toMatchObject({
      kind: 'correction-eroded',
      path: 'knowledge/wiki/repos/alice--project.md',
      target: 'correction-active',
      recovery: {lifecycle: 'active', action: 'restore-span'},
    })
    expect(result.advisoryFindings[0]).toMatchObject({
      kind: 'correction-needs-reconfirmation',
      path: 'knowledge/wiki/repos/alice--project.md',
      target: 'reconfirm',
      recovery: {lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction'},
    })
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
      {
        kind: 'correction-needs-reconfirmation',
        path: 'knowledge/wiki/repos/alice--project.md',
        target: 'correction-active',
        recovery: {lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction'},
        message:
          'Correction correction-active appears preserved with formatting-only changes and needs operator reconfirmation.',
      },
    ])
  })

  it('states the reconfirmation message and recovery data exactly for a pre-erosion needs-reconfirmation state', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('Anything.')},
      {version: 1, corrections: [{...activeCorrection, state: 'needs-reconfirmation', reason: 'Review'}]},
    )

    expect(result.advisoryFindings).toEqual([
      {
        kind: 'correction-needs-reconfirmation',
        path: 'knowledge/wiki/repos/alice--project.md',
        target: 'correction-active',
        recovery: {lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction'},
        message: 'Correction correction-active needs operator reconfirmation before it is enforced.',
      },
    ])
  })

  it('states the erosion message exactly', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result.deterministicFindings).toEqual([
      {
        kind: 'correction-eroded',
        path: 'knowledge/wiki/repos/alice--project.md',
        target: 'correction-active',
        recovery: {lifecycle: 'active', action: 'restore-span'},
        message: 'Active correction correction-active was not found in the regenerated page.',
      },
    ])
  })

  it('recognizes a markdown link with a multi-character url and substitutes only its label', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('start [middle](xy) end')},
      activeCorrections('middle end'),
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
    ])
  })

  it('recognizes a labeled wiki link and substitutes only its label, not its target', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('alpha [[Target|Beta]] gamma')},
      activeCorrections('alpha Beta'),
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
    ])
  })

  it.each([
    ['a labeled wiki link with an Obsidian-style embed prefix', 'foo![[T|L]]bar', 'foolbar'],
    ['a bare wiki link with an embed prefix directly against a letter', 'foo![[T]]bar', 'footbar'],
    ['a bare wiki link with an embed prefix after a space', 'foo ![[T]]bar', 'foo tbar'],
  ])(
    'recognizes %s (the leading `!` is consumed by the match, not left as a separator)',
    (_label, body, expectedFormattingText) => {
      const result = verifyCorrectionSurvival(
        {'knowledge/wiki/repos/alice--project.md': page(body)},
        activeCorrections(expectedFormattingText),
      )

      expect(result.ok).toBe(true)
      expect(result.deterministicFindings).toEqual([])
      expect(result.advisoryFindings).toEqual([
        expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
      ])
    },
  )

  it('is case-insensitive by lowercasing, not uppercasing — a German ß is not letter-for-letter equal to "ss" once folded', () => {
    // ß.toUpperCase() === 'SS' but ß.toLowerCase() === ß, so lower- vs uppercase-folding this
    // pair produces different equality outcomes; this pins the direction the docstring commits to.
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('Die Straße ist neu.')},
      activeCorrections('Die STRASSE ist neu.'),
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
    expect(result.advisoryFindings).toEqual([])
  })

  it('collapses a run of whitespace the punctuation strip produces into exactly one space', () => {
    // Three adjacent separators strip to three individual spaces (the strip step matches one
    // non-alphanumeric character at a time); only the trailing `\s+` collapse reduces that run
    // to the single space the correction's own span was authored with.
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('word1---word2')},
      activeCorrections('word1 word2'),
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
    ])
  })

  it('strips a non-alphanumeric separator to whitespace, not to nothing, so adjacent words stay separated', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('word1_word2')},
      activeCorrections('word1 word2'),
    )

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([
      expect.objectContaining({kind: 'correction-needs-reconfirmation', target: 'correction-active'}),
    ])
  })

  it('does not let inline emphasis markers splitting a word coincidentally match the word joined back together', () => {
    // If the punctuation strip deleted separators instead of spacing them, "un**believable**"
    // would collapse to "unbelievable" and wrongly read as a formatting-only match.
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('This is un**believable** stuff.')},
      activeCorrections('unbelievable'),
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
    expect(result.advisoryFindings).toEqual([])
  })

  it('does not let a run of whitespace collapse away entirely and coincidentally join two separate words', () => {
    // If the trailing `\s+` collapse deleted whitespace instead of reducing it to one space,
    // "un   believable" (three real spaces) would wrongly read as "unbelievable".
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('This is un   believable stuff.')},
      activeCorrections('unbelievable'),
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
    expect(result.advisoryFindings).toEqual([])
  })

  it('masks a markdown link whose url nests parentheses four levels deep, with multi-character content at the deepest level', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('start [middle](a_(b_(c_(d_(ee))))) end')},
      activeCorrections('start end'),
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
  })

  it('blocks as erosion, not needs-reconfirmation, when the span normalizes to no letters or digits', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
      activeCorrections('!!!'),
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', target: 'correction-active'}),
    ])
    expect(result.advisoryFindings).toEqual([])
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
      {'knowledge/wiki/repos/alice--project.md': page('[The corrected fact.](a_(bb))')},
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

  it('does not let an unrelated link elsewhere in the page interfere with exact matching', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('[a](1) The corrected fact. [b](2)')},
      {version: 1, corrections: [activeCorrection]},
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
  })

  it('masks unicode link labels and targets, including astral characters, without breaking prose matching', () => {
    const result = verifyCorrectionSurvival(
      {
        'knowledge/wiki/repos/alice--project.md': page('café ☕ is a nice drink. [🚀 launch](https://x.com/🎉page)'),
      },
      activeCorrections('café ☕ is a nice drink.'),
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
  })

  it('replaces a masked link with whitespace rather than deleting it, so adjacent words stay separated', () => {
    const result = verifyCorrectionSurvival(
      {'knowledge/wiki/repos/alice--project.md': page('wordone[link](url)wordtwo')},
      activeCorrections('wordone wordtwo'),
    )

    expect(result).toEqual({ok: true, deterministicFindings: [], advisoryFindings: []})
  })

  it('resolves the finding path from the fallback build when the page was removed from the regenerated set', () => {
    const result = verifyCorrectionSurvival(
      {},
      {version: 1, corrections: [activeCorrection]},
      {'knowledge/wiki/repos/alice--project.md': page('The old fact.')},
    )

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', path: 'knowledge/wiki/repos/alice--project.md'}),
    ])
  })

  it('falls back to the corrections store path when the page is absent from both builds, and treats its prose as genuinely empty rather than any placeholder', () => {
    // The span text deliberately matches Stryker's own string-literal placeholder: if the
    // empty-prose branch (`page === undefined ? '' : ...`) were replaced by any non-empty
    // string, this correction would wrongly appear to survive.
    const result = verifyCorrectionSurvival({}, activeCorrections('Stryker was here'), {})

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual([
      expect.objectContaining({kind: 'correction-eroded', path: 'knowledge/corrections.yaml'}),
    ])
  })

  it('resolves a correction by its page_node_id even when an unrelated page has a non-string frontmatter node_id', () => {
    // frontmatter.node_id is `unknown`; an unquoted YAML integer parses as a number, not a
    // string. It must not crash indexing and must not shadow a legitimately string-keyed page.
    const numericIdPage = [
      '---',
      'type: topic',
      'title: Numeric',
      'node_id: 456',
      'created: 2026-08-29',
      'updated: 2026-08-29',
      '---',
      '',
      'Unrelated content.',
      '',
    ].join('\n')
    const result = verifyCorrectionSurvival(
      {
        'knowledge/wiki/repos/alice--project.md': page('The corrected fact.'),
        'knowledge/wiki/topics/numeric.md': numericIdPage,
      },
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

// Verbatim copy of the combined markdown/wikilink regex and renderer this module used before
// the split into normalizeFormattingText's two independent patterns (see git history for
// corrections-survival.ts prior to this test). Kept only as a differential-test oracle.
function renderVisibleLinkTextReference(
  _match: string,
  markdownText: string | undefined,
  wikiTarget: string | undefined,
  wikiLabel: string | undefined,
): string {
  return markdownText ?? wikiLabel ?? wikiTarget ?? ''
}

function normalizeFormattingTextReference(value: string): string {
  const markdownLinkPattern = /!?(?:\[([^\]]*)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/gu
  return value
    .normalize('NFKC')
    .replaceAll(markdownLinkPattern, renderVisibleLinkTextReference)
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase()
}

/** Enumerates every string over `alphabet` of each length from 1 to `maxLength`, inclusive. */
function* enumerateStrings(alphabet: readonly string[], maxLength: number): Generator<string> {
  for (let length = 1; length <= maxLength; length += 1) {
    const total = alphabet.length ** length
    for (let index = 0; index < total; index += 1) {
      let remaining = index
      const characters: string[] = []
      for (let position = 0; position < length; position += 1) {
        characters.push(alphabet[remaining % alphabet.length] as string)
        remaining = Math.floor(remaining / alphabet.length)
      }
      yield characters.join('')
    }
  }
}

// Verbatim port of the char-scanning algorithm this module replaced (see git history for
// corrections-survival.ts prior to this test). Kept only as a differential-test oracle.
function maskMarkdownLinksReference(content: string): string {
  const masked = content.split('')
  let open = -1
  let index = 0
  while (index < content.length) {
    if (content[index] === '[') open = index
    if (content[index] === ']' && content[index + 1] === '(' && open !== -1) {
      let close = index + 2
      let depth = 1
      while (close < content.length && depth > 0) {
        if (content[close] === '(') depth += 1
        else if (content[close] === ')') depth -= 1
        close += 1
      }
      if (depth === 0) {
        for (let maskIndex = open; maskIndex < close; maskIndex += 1) masked[maskIndex] = ' '
        index = close
        open = -1
        continue
      }
    }
    index += 1
  }
  return masked.join('')
}

describe('normalizeFormattingText exhaustive differential against the pre-refactor implementation', () => {
  it('matches the reference implementation for every string up to length 7 over the link-syntax alphabet', () => {
    const alphabet = ['[', ']', '(', ')', '|', '!', 'a', ' ']
    let checked = 0
    for (const candidate of enumerateStrings(alphabet, 7)) {
      checked += 1
      const actual = normalizeFormattingText(candidate)
      const expected = normalizeFormattingTextReference(candidate)
      if (actual !== expected) {
        throw new Error(
          `normalizeFormattingText diverged for ${JSON.stringify(candidate)}: got ${JSON.stringify(actual)}, reference gave ${JSON.stringify(expected)}`,
        )
      }
    }
    expect(checked).toBe(2_396_744)
  })
})

describe('maskMarkdownLinks against the pre-refactor char-scanning reference implementation', () => {
  it('documents a known divergence from the reference implementation for a malformed, unclosed nested link', () => {
    // [](]() : the reference implementation's `open` pointer survives a failed inner-paren
    // match and is reused by a LATER `](`, masking the whole string; the shipped regex has no
    // equivalent "retry from an earlier failed open" behavior and leaves it unmasked. Found by
    // exhaustive differential testing (all 6^k strings, k=1..7, over ['[',']','(',')','a',' ']:
    // 335,922 cases, 1 divergence, this is it). Not yet resolved — see the plan's 5B-1 Result
    // block for the accept/fix decision. This test pins the CURRENT (diverging) behavior so a
    // future change to either implementation is a conscious, reviewed decision, not a silent
    // regression discovered by accident.
    const input = '[](]()'
    expect(maskMarkdownLinksReference(input)).toBe('      ')
    expect(maskMarkdownLinks(input)).toBe('[](]()')
  })
})
