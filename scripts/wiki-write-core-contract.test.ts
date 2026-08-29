import {lintWikiSnapshot as packageLintWikiSnapshot} from '@fro-bot/wiki-write-core'
import {describe, expect, it} from 'vitest'
import {lintWikiSnapshot as cliLintWikiSnapshot} from './wiki-lint.ts'

describe('wiki write core entrypoint contract', () => {
  it('keeps package and workflow CLI lint findings identical', () => {
    const files = {
      'knowledge/index.md': [
        '# Wiki Index',
        '',
        '## Repos',
        '',
        '- [[alice--project]] — alice/project',
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
        '',
        '---',
        '',
      ].join('\n'),
      'knowledge/wiki/repos/alice--project.md': [
        '---',
        'type: repo',
        'title: alice/project',
        'created: 2026-08-29',
        'updated: 2026-08-29',
        '---',
        '',
        'Project notes.',
        'See [[missing-page]].',
        '',
      ].join('\n'),
    }

    const params = {files, now: new Date('2026-08-29T00:00:00.000Z')}
    const packageResult = packageLintWikiSnapshot(params)
    const cliResult = cliLintWikiSnapshot(params)

    expect(packageResult).toEqual(cliResult)
    expect(packageResult.deterministicFindings).toEqual(
      expect.arrayContaining([expect.objectContaining({kind: 'broken-wikilink'})]),
    )
  })
})
