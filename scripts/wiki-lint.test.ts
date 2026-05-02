import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiLintModulePromise: Promise<{
  lintWikiSnapshot: typeof import('./wiki-lint.js').lintWikiSnapshot
  runWikiLint: typeof import('./wiki-lint.js').runWikiLint
  writeWikiLintFailureOutputs: typeof import('./wiki-lint.js').writeWikiLintFailureOutputs
  writeWikiLintOutputs: typeof import('./wiki-lint.js').writeWikiLintOutputs
}> = import(`./wiki-lint${'.js'}`)
const {lintWikiSnapshot, runWikiLint, writeWikiLintFailureOutputs, writeWikiLintOutputs} = await wikiLintModulePromise

function buildPage(params: {
  path: string
  type: 'repo' | 'topic' | 'entity' | 'comparison'
  title: string
  updated?: string
  tags?: string[]
  bodyLines?: string[]
}): [string, string] {
  return [
    params.path,
    [
      '---',
      `type: ${params.type}`,
      `title: ${params.title}`,
      'created: 2026-04-16',
      `updated: ${params.updated ?? '2026-04-16'}`,
      ...(params.tags === undefined ? [] : [`tags: [${params.tags.join(', ')}]`]),
      '---',
      '',
      ...(params.bodyLines ?? ['Body text.']),
      '',
    ].join('\n'),
  ]
}

function buildIndex(lines: string[]): string {
  return [
    '# Wiki Index',
    '',
    'Master catalog of all wiki pages, organized by type.',
    '',
    ...lines,
    '',
    '---',
    '',
    '_Footer._',
    '',
  ].join('\n')
}

describe('lintWikiSnapshot', () => {
  it('returns a clean result for a consistent wiki snapshot', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '- [[github-actions-ci]] — GitHub Actions CI',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        tags: ['automation'],
        bodyLines: ['See [[github-actions-ci]] for workflow conventions.'],
      }),
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
        tags: ['ci', 'automation'],
        bodyLines: ['See [[fro-bot--github]] for control-plane workflow patterns.'],
      }),
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual([])
    expect(result.summary).toContain('Deterministic findings: 0')
    expect(result.summary).toContain('Advisory findings: 0')
    expect(result.report).toContain('No findings.')
  })

  it('treats alias-backed wikilinks as valid references', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '- [[github-actions-ci]] — GitHub Actions CI',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        bodyLines: ['See [[workflow-patterns]] for reusable CI guidance.'],
      }),
      [
        'knowledge/wiki/topics/github-actions-ci.md',
        [
          '---',
          'type: topic',
          'title: GitHub Actions CI',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'aliases: [workflow-patterns]',
          '---',
          '',
          'See [[fro-bot--github]] for the control-plane implementation.',
          '',
        ].join('\n'),
      ],
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.deterministicFindings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({kind: 'broken-wikilink', target: 'workflow-patterns'})]),
    )
  })

  it('reports broken links, orphan pages, index drift, and missing required frontmatter as deterministic findings', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '- [[missing-from-disk]] — Missing From Disk',
          '',
          '## Topics',
          '',
          '_No topic pages yet._',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      [
        'knowledge/wiki/repos/fro-bot--github.md',
        [
          '---',
          'type: repo',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          '---',
          '',
          'See [[missing-topic]] for context.',
          '',
        ].join('\n'),
      ],
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
      }),
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'missing-frontmatter', path: 'knowledge/wiki/repos/fro-bot--github.md'}),
        expect.objectContaining({
          kind: 'broken-wikilink',
          path: 'knowledge/wiki/repos/fro-bot--github.md',
          target: 'missing-topic',
        }),
        expect.objectContaining({kind: 'orphan-page', path: 'knowledge/wiki/topics/github-actions-ci.md'}),
        expect.objectContaining({kind: 'index-drift', path: 'knowledge/index.md', target: 'missing-from-disk'}),
      ]),
    )
    expect(result.summary).toContain('Deterministic findings: 4')
    expect(result.report).toContain('broken-wikilink')
    expect(result.report).toContain('orphan-page')
    expect(result.report).toContain('index-drift')
    expect(result.report).toContain('missing-frontmatter')
  })

  it('reports malformed frontmatter as a deterministic finding instead of crashing the run', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '_No topic pages yet._',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      [
        'knowledge/wiki/repos/fro-bot--github.md',
        [
          '---',
          'type: repo',
          'title: Fro Bot .github',
          'created: 2026-04-16',
          'updated: [broken',
          '---',
          '',
          'Body text.',
          '',
        ].join('\n'),
      ],
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.ok).toBe(false)
    expect(result.deterministicFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'invalid-frontmatter', path: 'knowledge/wiki/repos/fro-bot--github.md'}),
      ]),
    )
  })

  it('labels stale claims, missing cross-references, and knowledge gaps as advisory findings', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '- [[github-actions-ci]] — GitHub Actions CI',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        updated: '2026-01-01',
        bodyLines: ['Workflow notes without any wikilinks or sources to related topics.'],
      }),
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
        bodyLines: ['Covers workflow pinning patterns.'],
      }),
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.ok).toBe(true)
    expect(result.deterministicFindings).toEqual([])
    expect(result.advisoryFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'stale-claim', path: 'knowledge/wiki/repos/fro-bot--github.md'}),
        expect.objectContaining({kind: 'missing-cross-reference', path: 'knowledge/wiki/repos/fro-bot--github.md'}),
        expect.objectContaining({kind: 'missing-cross-reference', path: 'knowledge/wiki/topics/github-actions-ci.md'}),
        expect.objectContaining({kind: 'knowledge-gap', path: 'knowledge/index.md'}),
      ]),
    )
    expect(result.summary).toContain('Deterministic findings: 0')
    expect(result.summary).toContain('Advisory findings: 4')
    expect(result.report).toContain('non-blocking advisory')
  })

  it('does not label a page stale when updated is not a valid date', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '_No topic pages yet._',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        updated: 'not-a-date',
        bodyLines: ['See [[fro-bot--github]] for workflow conventions.'],
      }),
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.advisoryFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'stale-claim', path: 'knowledge/wiki/repos/fro-bot--github.md'}),
      ]),
    )
  })

  it('labels disconnected non-repo pages as missing cross-references', () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '- [[github-actions-ci]] — GitHub Actions CI',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        bodyLines: ['See [[github-actions-ci]] for workflow conventions.'],
      }),
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
        bodyLines: ['Workflow notes without any wikilinks yet.'],
      }),
    ])

    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})

    expect(result.ok).toBe(true)
    expect(result.advisoryFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'missing-cross-reference',
          path: 'knowledge/wiki/topics/github-actions-ci.md',
        }),
      ]),
    )
    expect(result.advisoryFindings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({kind: 'knowledge-gap', path: 'knowledge/index.md'})]),
    )
  })

  it('writes the markdown artifact, workflow summary, and github outputs for findings', async () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '- [[github-actions-ci]] — GitHub Actions CI',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        updated: '2026-01-01',
        bodyLines: ['Workflow notes without any wikilinks or sources to related topics.'],
      }),
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
        bodyLines: ['Covers workflow pinning patterns.'],
      }),
    ])
    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})
    const tempDir = await mkdtemp(join(tmpdir(), 'wiki-lint-'))
    const reportPath = join(tempDir, 'wiki-lint-report.md')
    const summaryPath = join(tempDir, 'step-summary.md')
    const outputPath = join(tempDir, 'github-output.txt')

    const writeResult = await writeWikiLintOutputs({
      result,
      reportPath,
      githubStepSummaryPath: summaryPath,
      githubOutputPath: outputPath,
    })

    expect(writeResult.status).toBe('findings')
    expect(writeResult.reportPath).toBe(reportPath)
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('# Wiki Lint Report')
    await expect(readFile(summaryPath, 'utf8')).resolves.toContain('Advisory findings: 4')
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('status=findings')
    await expect(readFile(outputPath, 'utf8')).resolves.toContain(`report_path=${reportPath}`)
  })

  it('writes clean status outputs without changing the report shape', async () => {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '- [[fro-bot--github]] — Fro Bot .github',
          '',
          '## Topics',
          '',
          '- [[github-actions-ci]] — GitHub Actions CI',
          '',
          '## Entities',
          '',
          '_No entity pages yet._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet._',
        ]),
      ],
      buildPage({
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        type: 'repo',
        title: 'Fro Bot .github',
        tags: ['automation'],
        bodyLines: ['See [[github-actions-ci]] for workflow conventions.'],
      }),
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
        bodyLines: ['See [[fro-bot--github]] for the control-plane implementation.'],
      }),
    ])
    const result = lintWikiSnapshot({files, now: new Date('2026-05-02T00:00:00Z')})
    const tempDir = await mkdtemp(join(tmpdir(), 'wiki-lint-clean-'))
    const reportPath = join(tempDir, 'wiki-lint-report.md')
    const outputPath = join(tempDir, 'github-output.txt')

    const writeResult = await writeWikiLintOutputs({
      result,
      reportPath,
      githubOutputPath: outputPath,
    })

    expect(writeResult.status).toBe('clean')
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('No findings.')
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('status=clean')
  })

  it('writes a distinct execution-failure artifact and status output', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'wiki-lint-failure-'))
    const reportPath = join(tempDir, 'wiki-lint-report.md')
    const summaryPath = join(tempDir, 'step-summary.md')
    const outputPath = join(tempDir, 'github-output.txt')

    const writeResult = await writeWikiLintFailureOutputs({
      message: 'cannot lint wiki snapshot: origin/data is unavailable',
      reportPath,
      githubStepSummaryPath: summaryPath,
      githubOutputPath: outputPath,
    })

    expect(writeResult.status).toBe('execution-failure')
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('## Execution failure')
    await expect(readFile(summaryPath, 'utf8')).resolves.toContain('Execution failure')
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('status=execution-failure')
  })

  it('runs the full lint pipeline from disk and emits summary/report outputs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'wiki-lint-run-'))
    const reportPath = join(tempDir, 'wiki-lint-report.md')
    const summaryPath = join(tempDir, 'step-summary.md')
    const outputPath = join(tempDir, 'github-output.txt')
    const wikiDir = join(tempDir, 'knowledge', 'wiki', 'repos')
    await mkdir(wikiDir, {recursive: true})
    await writeFile(
      join(tempDir, 'knowledge', 'index.md'),
      buildIndex([
        '## Repos',
        '',
        '- [[fro-bot--github]] — Fro Bot .github',
        '',
        '## Topics',
        '',
        '_No topic pages yet._',
        '',
        '## Entities',
        '',
        '_No entity pages yet._',
        '',
        '## Comparisons',
        '',
        '_No comparison pages yet._',
      ]),
    )
    await writeFile(
      join(wikiDir, 'fro-bot--github.md'),
      [
        '---',
        'type: repo',
        'title: Fro Bot .github',
        'created: 2026-04-16',
        'updated: 2026-01-01',
        '---',
        '',
        'Workflow notes without cross references.',
        '',
      ].join('\n'),
    )

    const result = await runWikiLint({
      rootDir: tempDir,
      reportPath,
      githubStepSummaryPath: summaryPath,
      githubOutputPath: outputPath,
      now: new Date('2026-05-02T00:00:00Z'),
    })

    expect(result.status).toBe('findings')
    expect(result.result.advisoryFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'stale-claim'}),
        expect.objectContaining({kind: 'missing-cross-reference'}),
      ]),
    )
    await expect(readFile(summaryPath, 'utf8')).resolves.toContain('Advisory findings: 2')
    await expect(readFile(outputPath, 'utf8')).resolves.toContain(`report_path=${reportPath}`)
  })

  it('fails when knowledge/index.md is missing from disk', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'wiki-lint-missing-index-'))
    const reportPath = join(tempDir, 'wiki-lint-report.md')

    await expect(runWikiLint({rootDir: tempDir, reportPath})).rejects.toThrow(/knowledge\/index\.md/u)
  })

  it('requires the workflow to fail when the authoritative data snapshot cannot be restored', async () => {
    const workflow = await readFile('.github/workflows/wiki-lint.yaml', 'utf8')

    expect(workflow).toContain('fetch-depth: 1')
    expect(workflow).toContain('git ls-remote --exit-code origin data')
    expect(workflow).toContain('git fetch --depth=1 origin data')
    expect(workflow).toContain('cannot lint wiki snapshot')
    expect(workflow).toContain('exit 1')
    expect(workflow).toContain('continue-on-error: true')
    expect(workflow).toContain('WIKI_LINT_FAILURE_MESSAGE')
    expect(workflow).toContain("steps.restore-wiki.outcome == 'failure'")
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f')
  })
})
