import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiQueryModulePromise: Promise<{
  assembleWikiContext: typeof import('./wiki-query.js').assembleWikiContext
}> = import(`./wiki-query${'.js'}`)
const {assembleWikiContext} = await wikiQueryModulePromise

describe('assembleWikiContext', () => {
  it('prioritizes the repo page for repo-local pull request context', () => {
    // #given repo, topic, and entity pages related to a pull request event
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': [
          '# Wiki Index',
          '',
          '## Repos',
          '',
          '- [[fro-bot--agent]] — Fro Bot Agent',
          '',
          '## Topics',
          '',
          '- [[vitest]] — Vitest',
          '',
          '## Entities',
          '',
          '- [[octokit]] — Octokit',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
          '',
        ].join('\n'),
        'knowledge/wiki/repos/fro-bot--agent.md': [
          '---',
          'type: repo',
          'title: Fro Bot Agent',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [agent, vitest, octokit]',
          '---',
          '',
          'Fro Bot Agent uses Vitest and Octokit in its workflow scripts.',
          '',
        ].join('\n'),
        'knowledge/wiki/topics/vitest.md': [
          '---',
          'type: topic',
          'title: Vitest',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [testing]',
          '---',
          '',
          'Vitest is the repo test runner.',
          '',
        ].join('\n'),
        'knowledge/wiki/entities/octokit.md': [
          '---',
          'type: entity',
          'title: Octokit',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [github]',
          '---',
          '',
          'Octokit powers GitHub API access.',
          '',
        ].join('\n'),
      },
      event: {
        eventName: 'pull_request',
        owner: 'fro-bot',
        repo: 'agent',
        title: 'feat: add atomic wiki ingest',
        body: 'This changes Vitest coverage and Octokit git data API usage.',
      },
    })

    // #when the wiki query assembles prompt context
    // #then the repo page is ranked first and the excerpt stays within budget
    expect(result.selectedPaths[0]).toBe('knowledge/wiki/repos/fro-bot--agent.md')
    expect(result.excerpt).toContain('Fro Bot Agent uses Vitest and Octokit')
    expect(result.byteLength).toBeLessThanOrEqual(5 * 1024)
  })

  it('enforces the hard 5kb context cap', () => {
    const largeBody = 'signal '.repeat(2000)

    // #given oversized wiki pages that would overflow the prompt budget
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': '# Wiki Index\n\n## Repos\n\n- [[fro-bot--agent]] — Fro Bot Agent\n',
        'knowledge/wiki/repos/fro-bot--agent.md': `---\ntype: repo\ntitle: Fro Bot Agent\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n${largeBody}\n`,
        'knowledge/wiki/topics/vitest.md': `---\ntype: topic\ntitle: Vitest\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n${largeBody}\n`,
      },
      event: {
        eventName: 'issues',
        owner: 'fro-bot',
        repo: 'agent',
        title: 'Issue about Vitest',
        body: largeBody,
      },
    })

    // #when the context builder truncates and packs excerpts
    // #then the final payload never exceeds 5kb
    expect(result.byteLength).toBeLessThanOrEqual(5 * 1024)
  })

  it('uses topical matches when repo context is absent', () => {
    // #given a schedule event with no repo-local target but a strong topical match
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/wiki/topics/github-actions-ci.md': [
          '---',
          'type: topic',
          'title: GitHub Actions CI',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [ci, workflows, actions]',
          '---',
          '',
          'GitHub Actions CI should pin actions and validate workflows.',
          '',
        ].join('\n'),
      },
      event: {
        eventName: 'schedule',
        title: 'Daily org oversight',
        body: 'Audit CI workflows and GitHub Actions usage across repos.',
      },
    })

    // #when the query scores wiki relevance without a repo slug
    // #then it still returns the strongest topical page
    expect(result.selectedPaths).toContain('knowledge/wiki/topics/github-actions-ci.md')
    expect(result.excerpt).toContain('GitHub Actions CI should pin actions')
  })
})
