import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiIngestModulePromise: Promise<{
  mergeWikiLogs: typeof import('./wiki-ingest.js').mergeWikiLogs
  rebuildWikiIndex: typeof import('./wiki-ingest.js').rebuildWikiIndex
}> = import(`./wiki-ingest${'.js'}`)
const {mergeWikiLogs, rebuildWikiIndex} = await wikiIngestModulePromise

function wikiPage(params: {
  path: string
  type: 'repo' | 'topic' | 'entity' | 'comparison'
  title: string
}): [string, string] {
  return [
    params.path,
    [
      '---',
      `type: ${params.type}`,
      `title: ${params.title}`,
      'created: 2026-04-16',
      'updated: 2026-04-16',
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  ]
}

describe('rebuildWikiIndex', () => {
  it('regenerates the index from a wiki-file snapshot with no prior index text', () => {
    // #given a wiki snapshot with two repo pages and no existing index
    const wikiFiles = Object.fromEntries([
      wikiPage({path: 'knowledge/wiki/repos/fro-bot--agent.md', type: 'repo', title: 'Fro Bot Agent'}),
      wikiPage({path: 'knowledge/wiki/repos/fro-bot--github.md', type: 'repo', title: 'Fro Bot .github'}),
    ])

    // #when the index is rebuilt from ground truth
    const index = rebuildWikiIndex({wikiFiles})

    // #then all pages appear under their section in title order
    expect(index).toContain('## Repos')
    expect(index).toContain('- [[fro-bot--agent]] — Fro Bot Agent')
    expect(index).toContain('- [[fro-bot--github]] — Fro Bot .github')
    expect(index.indexOf('Fro Bot .github')).toBeLessThan(index.indexOf('Fro Bot Agent'))
    expect(index).toContain('## Topics')
    expect(index).toContain('_No topic pages yet.')
  })

  it('preserves custom header and footer text from an existing index', () => {
    // #given an existing index with operator-authored header and footer prose
    const existingIndex = [
      '# Wiki Index',
      '',
      '> Manually authored note: this is our source of truth.',
      '',
      '## Repos',
      '',
      '- [[stale-entry]] — Stale Entry',
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
      '_Custom footer copy kept across rebuilds._',
      '',
    ].join('\n')
    const wikiFiles = Object.fromEntries([
      wikiPage({path: 'knowledge/wiki/repos/fro-bot--agent.md', type: 'repo', title: 'Fro Bot Agent'}),
    ])

    // #when the index is rebuilt against the existing document
    const index = rebuildWikiIndex({existingIndex, wikiFiles})

    // #then the custom header prose and footer copy survive
    expect(index).toContain('> Manually authored note: this is our source of truth.')
    expect(index).toContain('_Custom footer copy kept across rebuilds._')
    // #and the stale entry is replaced by what's actually on disk
    expect(index).toContain('- [[fro-bot--agent]] — Fro Bot Agent')
    expect(index).not.toContain('stale-entry')
  })

  it('handles an empty wiki snapshot by emitting the empty-section placeholders', () => {
    // #given an empty wiki snapshot
    // #when the index is rebuilt
    const index = rebuildWikiIndex({wikiFiles: {}})

    // #then every section shows its empty-state placeholder
    expect(index).toContain('_No repo pages yet.')
    expect(index).toContain('_No topic pages yet.')
    expect(index).toContain('_No entity pages yet.')
    expect(index).toContain('_No comparison pages yet.')
  })
})

describe('mergeWikiLogs', () => {
  it('concatenates entries from multiple inputs in chronological order', () => {
    // #given two log.md snapshots — one from main, one from a PR — with disjoint entries
    const mainLog = [
      '# Wiki Log',
      '',
      'Chronological record of all wiki operations.',
      '',
      '---',
      '',
      '_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._',
      '',
      '## [2026-04-17 10:00] ingest | repo:marcusrbrown/esphome.life',
      '',
      'Surveyed esphome.life.',
      '',
      'Sources: https://github.com/marcusrbrown/esphome.life@abc123',
      '',
    ].join('\n')
    const prLog = [
      '# Wiki Log',
      '',
      'Chronological record of all wiki operations.',
      '',
      '---',
      '',
      '_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._',
      '',
      '## [2026-04-18 05:34] ingest | repo:marcusrbrown/.dotfiles',
      '',
      'Surveyed .dotfiles.',
      '',
      'Sources: https://github.com/marcusrbrown/.dotfiles@def456',
      '',
    ].join('\n')

    // #when the logs are merged
    const merged = mergeWikiLogs([mainLog, prLog])

    // #then both entries appear in timestamp order under the canonical header
    expect(merged).toContain('# Wiki Log')
    expect(merged).toContain('## [2026-04-17 10:00] ingest | repo:marcusrbrown/esphome.life')
    expect(merged).toContain('## [2026-04-18 05:34] ingest | repo:marcusrbrown/.dotfiles')
    expect(merged.indexOf('esphome.life')).toBeLessThan(merged.indexOf('.dotfiles'))
  })

  it('deduplicates entries that appear in multiple sources', () => {
    // #given two log.md snapshots sharing one identical entry
    const sharedEntry = [
      '## [2026-04-17 10:00] ingest | repo:marcusrbrown/esphome.life',
      '',
      'Surveyed esphome.life.',
      '',
      'Sources: https://github.com/marcusrbrown/esphome.life@abc123',
      '',
    ].join('\n')
    const withShared = `# Wiki Log\n\n---\n\n${sharedEntry}`

    // #when merging two copies of the same log
    const merged = mergeWikiLogs([withShared, withShared])

    // #then the shared entry appears exactly once (dedupe by timestamp+target)
    const occurrences = merged.match(/## \[2026-04-17 10:00\] ingest \| repo:marcusrbrown\/esphome\.life/gu) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('tolerates empty or undefined log inputs without emitting garbage', () => {
    // #given a mix of empty, undefined, and valid log inputs
    const validLog = [
      '# Wiki Log',
      '',
      '---',
      '',
      '## [2026-04-18 00:00] ingest | repo:fro-bot/.github',
      '',
      'A single entry.',
      '',
      'Sources: none',
      '',
    ].join('\n')

    // #when the merger skips the empty/undefined inputs
    const merged = mergeWikiLogs([undefined, '', validLog])

    // #then only the valid entry survives
    expect(merged).toContain('## [2026-04-18 00:00] ingest | repo:fro-bot/.github')
    expect(merged).toContain('# Wiki Log')
  })

  it('produces a deterministic canonical header even when all inputs are empty', () => {
    // #given nothing to merge
    // #when the merger is invoked on empty inputs
    const merged = mergeWikiLogs([undefined, ''])

    // #then the canonical header emerges alone, no entries
    expect(merged).toContain('# Wiki Log')
    expect(merged).toContain('append-only')
    expect(merged).not.toContain('## [')
  })
})
