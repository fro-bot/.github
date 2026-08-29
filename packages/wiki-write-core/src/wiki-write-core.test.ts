import {describe, expect, it} from 'vitest'

import {
  buildWikiIngestChanges,
  checkPrivateLeakWithAdapter,
  maskCodeContent,
  reconstructFrontmatter,
  validateRenderingPolicy,
} from './index.ts'

describe('wiki write core', () => {
  it('renders manual-edit operations distinctly in the append-only log', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/log.md': '# Wiki Log\n',
      },
      operation: 'manual-edit',
      target: 'repo:alice/project',
      summary: 'Corrected the project description.',
      timestamp: new Date('2026-08-29T12:34:00.000Z'),
      sources: [],
      pages: [
        {
          path: 'knowledge/wiki/repos/alice--project.md',
          content: [
            '---',
            'type: repo',
            'title: alice/project',
            'created: 2026-08-29',
            'updated: 2026-08-29',
            '---',
            '',
            'Project notes.',
            '',
          ].join('\n'),
        },
      ],
    })

    expect(result.files['knowledge/log.md']).toContain('manual-edit | repo:alice/project')
  })

  it('returns a rendering finding for scriptable HTML', () => {
    expect(
      validateRenderingPolicy({
        path: 'knowledge/wiki/topics/security.md',
        content: '<script>alert(1)</script>',
      }),
    ).toEqual([
      expect.objectContaining({
        kind: 'unsafe-html',
        path: 'knowledge/wiki/topics/security.md',
      }),
    ])
  })

  it('does not flag script examples inside fenced code blocks', () => {
    expect(
      validateRenderingPolicy({
        path: 'knowledge/wiki/topics/security.md',
        content: ['```html', '<script>alert(1)</script>', '```'].join('\n'),
      }),
    ).toEqual([])
  })

  it('keeps content masked after a mismatched fence marker', () => {
    const masked = maskCodeContent(
      ['```html', '<script>alert(1)</script>', '~~~', '<script>still code</script>'].join('\n'),
    )

    expect(masked).not.toContain('<script>')
  })

  it('masks inline code content', () => {
    const masked = maskCodeContent('Safe text with `<script>alert(1)</script>` inline.')

    expect(masked).not.toContain('<script>')
    expect(masked).toContain('Safe text with ')
  })

  it('fails the pure privacy gate through an injected authority adapter', async () => {
    const result = await checkPrivateLeakWithAdapter(
      {
        async resolvePrivateRepositoryNames() {
          return ['acme/private-repo']
        },
      },
      {
        content: 'The private repository is documented here.',
        diff: [
          'diff --git a/knowledge/wiki/topics/security.md b/knowledge/wiki/topics/security.md',
          '--- a/knowledge/wiki/topics/security.md',
          '+++ b/knowledge/wiki/topics/security.md',
          '@@ -1 +1 @@',
          '+See acme/private-repo for details.',
        ].join('\n'),
        override: {titlePrefixed: false, isOperator: false},
      },
    )

    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/security.md']})
  })

  it('reconstructs frontmatter while preserving system-owned fields', () => {
    const result = reconstructFrontmatter(
      ['---', 'type: repo', 'title: old', 'node_id: R_123', 'created: 2026-08-28', '---', '', 'old body', ''].join(
        '\n',
      ),
      'new body',
      ['type', 'title', 'node_id', 'created'],
    )

    expect(result).toContain('node_id: R_123')
    expect(result).toContain('\nnew body\n')
  })
})
